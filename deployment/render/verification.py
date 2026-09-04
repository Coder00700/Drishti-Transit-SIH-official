"""Real-provider OTP adapter for the cloud service; no local-backend imports."""
import base64
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from fastapi import HTTPException


def capabilities():
    configured = all(os.getenv(k) for k in ('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'))
    return {'sms_otp': configured,
            'email_otp': configured and os.getenv('TWILIO_VERIFY_EMAIL_ENABLED') == 'true',
            'rto_api': False,
            'rto_note': 'Authorized RTO access is required. No government verification is claimed.'}


def verify_call(resource: str, fields: dict, channel: str) -> dict:
    if resource not in ('Verifications', 'VerificationCheck') or channel not in ('email', 'sms'):
        raise HTTPException(400, 'Unsupported verification request')
    if not capabilities()['email_otp' if channel == 'email' else 'sms_otp']:
        raise HTTPException(503, 'OTP delivery is not configured. Configure Twilio Verify and email delivery first.')
    service = os.environ['TWILIO_VERIFY_SERVICE_SID']
    if not re.fullmatch(r'VA[0-9a-fA-F]{32}', service):
        raise HTTPException(503, 'OTP service configuration is invalid')
    auth = base64.b64encode((os.environ['TWILIO_ACCOUNT_SID'] + ':' + os.environ['TWILIO_AUTH_TOKEN']).encode()).decode()
    request = Request(f'https://verify.twilio.com/v2/Services/{service}/{resource}',
                      data=urlencode(fields).encode(), method='POST',
                      headers={'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urlopen(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code == 404 and resource == 'VerificationCheck':
            raise HTTPException(400, 'OTP expired or was already used; request a new code') from exc
        if exc.code == 429:
            raise HTTPException(429, 'OTP service rate limit reached; retry later') from exc
        raise HTTPException(502, 'OTP provider rejected the request; check configuration and recipient eligibility') from exc
    except (URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(502, 'OTP provider is unavailable; no verification was granted') from exc
