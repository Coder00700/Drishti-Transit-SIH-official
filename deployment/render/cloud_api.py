"""Small cloud account service; local AI and capture pipelines are not imported."""
import hmac
import os
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from .models import Register, Login, Consent, OtpSend, OtpCheck, POLICY_VERSION
from .verification import capabilities, verify_call
from .mongo_store import database, logins, now, digest, password_hash, password_matches, require_indexes

PREFIX = '/api/v1/contributors'
COOKIE = 'drishti_contributor'
SAFE_USER = ('id', 'full_name', 'email', 'phone', 'email_verified', 'phone_verified',
             'terms_version', 'privacy_version', 'accepted_at', 'withdrawn_at', 'deletion_requested_at')
DUMMY_HASH = password_hash(secrets.token_urlsafe(32))
MAX_BODY = 16384

def publication_replica_enabled():
    return os.environ.get('PUBLICATION_REPLICA_ENABLED') == 'true'


def local_mode():
    # Explicit developer-only profile. Never accepted on a Render deployment.
    return os.environ.get('DRISHTI_LOCAL_MONGO') == 'true' and not os.environ.get('RENDER')


def valid_configuration():
    if os.environ.get('DRISHTI_LOCAL_MONGO') == 'true':
        if not local_mode() or os.environ.get('PORTAL_ORIGIN') != 'http://127.0.0.1:3000':
            raise RuntimeError('The local Mongo profile is restricted to loopback development.')
        return
    origin = os.environ.get('PORTAL_ORIGIN', '')
    url = urlsplit(origin)
    if url.scheme != 'https' or not url.netloc or url.username or url.password or url.path or url.query or url.fragment:
        raise RuntimeError('PORTAL_ORIGIN must be an exact HTTPS origin without a trailing slash.')
    if len(os.environ.get('EDGE_SHARED_SECRET', '')) < 32:
        raise RuntimeError('Configure a strong Cloudflare gateway secret.')


@asynccontextmanager
async def lifespan(app):
    try:
        valid_configuration()
        # Fail closed if the database or uniqueness constraints are unavailable.
        db = database()
        db.command('ping')
        require_indexes(db)
        if publication_replica_enabled():
            from .public_store import current_release
            public_db, _ = current_release()
            public_db.command('ping')
        # A sleeping free PostGIS service must not take down account/login APIs.
        try:
            from .postgis_store import enabled as postgis_enabled, ensure_schema, start_bootstrap
            if postgis_enabled():
                ensure_schema()
                start_bootstrap()
        except Exception:
            pass
    except (PyMongoError, RuntimeError, ValueError):
        # Do not leak connection details into platform startup tracebacks.
        raise RuntimeError('Cloud startup blocked: check private settings, database access and required indexes.') from None
    yield


app = FastAPI(title='Drishti cloud portal', docs_url=None, redoc_url=None,
              openapi_url=None, lifespan=lifespan)


class Boundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        if local_mode():
            # Reject remote peers, alternative Host headers and forwarding tricks.
            peer_host = (scope.get('client') or ('', 0))[0]
            allowed_host = headers.get(b'host') == b'127.0.0.1:8001'
            forwarded = any(k in headers for k in (b'forwarded', b'x-forwarded-for', b'x-forwarded-host', b'x-forwarded-proto'))
            if peer_host not in ('127.0.0.1', '::1') or not allowed_host or forwarded:
                return await JSONResponse({'detail': 'Local contributor API accepts loopback requests only.'}, 403)(scope, receive, send)
        elif scope['path'] != '/health':
            expected = os.environ.get('EDGE_SHARED_SECRET', '')
            supplied = headers.get(b'x-drishti-edge', b'').decode('latin1')
            if len(expected) < 32 or not hmac.compare_digest(supplied, expected):
                return await JSONResponse({'detail': 'Use the website API gateway.'}, 403)(scope, receive, send)
        if scope['method'] not in ('GET', 'HEAD', 'OPTIONS'):
            origin = headers.get(b'origin', b'').decode('latin1')
            if not origin or origin != os.environ.get('PORTAL_ORIGIN'):
                return await JSONResponse({'detail': 'Invalid request origin.'}, 403)(scope, receive, send)
        # Buffer a small, bounded JSON body before it reaches FastAPI/Pydantic.
        chunks, size = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            data = message.get('body', b'')
            size += len(data)
            if size > MAX_BODY:
                return await JSONResponse({'detail': 'Cloud account requests are limited to 16 KB. Media ingestion is deferred.'}, 413)(scope, receive, send)
            chunks.append(data)
            if not message.get('more_body'):
                break
        consumed = False

        async def bounded_receive():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {'type': 'http.request', 'body': b''.join(chunks), 'more_body': False}
            return await receive()

        async def safe_send(message):
            if message['type'] == 'http.response.start':
                message['headers'] = list(message.get('headers', [])) + [
                    (b'cache-control', b'no-store'), (b'x-content-type-options', b'nosniff'),
                    (b'referrer-policy', b'no-referrer'), (b'x-frame-options', b'DENY')]
            await send(message)
        await self.app(scope, bounded_receive, safe_send)


app.add_middleware(Boundary)


@app.exception_handler(PyMongoError)
async def database_error(request, exc):
    return JSONResponse({'detail': 'Account service temporarily unavailable.'}, 503)


@app.exception_handler(RequestValidationError)
async def input_error(request, exc):
    # Pydantic's default errors include the submitted input (possibly a password).
    return JSONResponse({'detail': [{'loc': e['loc'], 'msg': e['msg']} for e in exc.errors()]}, 422)


def limit(key, maximum, seconds):
    current = now()
    bucket = int(current.timestamp()) // seconds
    row = database().rate_limits.find_one_and_update(
        {'_id': digest(key + ':' + str(bucket))},
        {'$inc': {'attempts': 1}, '$setOnInsert': {'expires_at': current + timedelta(seconds=seconds * 2)}},
        upsert=True, return_document=ReturnDocument.AFTER)
    if row['attempts'] > maximum:
        raise HTTPException(429, 'Too many attempts. Please wait before retrying.', headers={'Retry-After': str(seconds)})


def peer(request):
    if local_mode():
        return request.client.host
    # Only trusted gateway requests reach this code. Edge overwrites this header.
    return request.headers.get('x-drishti-client-ip', 'unknown')[:64]


def actor(request: Request):
    token = request.cookies.get(COOKIE, '')
    if not token or len(token) > 100:
        raise HTTPException(401, 'Please sign in.')
    session = database().sessions.find_one({'_id': digest(token), 'expires_at': {'$gt': now()}})
    user = logins(database()).find_one({'_id': session['user_id'], 'schema_version': 1,
                                      'deletion_requested_at': None}, {'password_hash': 0}) if session else None
    if not user:
        raise HTTPException(401, 'Your session expired. Please sign in again.')
    if request.method not in ('GET', 'HEAD'):
        if not hmac.compare_digest(request.headers.get('x-contributor-csrf', ''), digest(token + ':csrf')):
            raise HTTPException(403, 'Invalid session protection token. Reload and retry.')
    return user


def set_session(response, user_id, old_token=''):
    token = secrets.token_urlsafe(32)
    db = database()
    if old_token:
        db.sessions.delete_one({'_id': digest(old_token)})
    db.sessions.insert_one({'_id': digest(token), 'user_id': user_id, 'expires_at': now() + timedelta(hours=8)})
    response.set_cookie(COOKIE, token, max_age=28800, secure=not local_mode(), httponly=True,
                        samesite='strict', path=PREFIX)
    return digest(token + ':csrf')


def current_consent(user):
    if user.get('withdrawn_at') or user.get('privacy_version') != POLICY_VERSION:
        raise HTTPException(403, 'Accept the current privacy notice first.')


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'cloud-portal', 'ai_execution': False}


@app.get(PREFIX + '/capabilities')
def get_capabilities():
    return {**capabilities(), 'policy_version': POLICY_VERSION, 'identity_store': 'mongodb',
            'registration_enabled': os.getenv('ALLOW_REGISTRATION') == 'true',
            'vehicle_onboarding': False, 'capture': False, 'drive_references': False,
            'recording_submission': False,
            'admin_visibility': False, 'assessment_mode': 'DEFERRED_LOCAL_BATCH',
            'notice': 'MongoDB account pilot only. Vehicle documents, Drive permissions and capture ingestion are not connected to these accounts yet.'}


@app.post(PREFIX + '/register', status_code=201)
def register(item: Register, request: Request, response: Response):
    if os.getenv('ALLOW_REGISTRATION') != 'true':
        raise HTTPException(503, 'Public registration is not open yet.')
    limit('register:' + peer(request), 5, 3600)
    user_id = str(uuid4())
    user = {'_id': user_id, 'id': user_id, 'schema_version': 1, 'role': 'contributor',
            'full_name': item.full_name, 'email': item.email, 'phone': item.phone,
            'password_hash': password_hash(item.password), 'email_verified': False, 'phone_verified': False,
            'terms_version': POLICY_VERSION, 'privacy_version': POLICY_VERSION, 'accepted_at': now(),
            'withdrawn_at': None, 'deletion_requested_at': None, 'created_at': now()}
    try:
        logins(database()).insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(409, 'Account could not be created. Sign in if already registered.')
    return {'id': user_id, 'csrf': set_session(response, user_id, request.cookies.get(COOKIE, ''))}


@app.post(PREFIX + '/login')
def login(item: Login, request: Request, response: Response):
    limit('login-ip:' + peer(request), 30, 900)
    limit('login-email:' + item.email, 10, 900)
    user = logins(database()).find_one({'email': item.email, 'schema_version': 1, 'deletion_requested_at': None})
    valid = password_matches(item.password, user.get('password_hash', DUMMY_HASH) if user else DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, 'Email or password is incorrect.')
    return {'csrf': set_session(response, user['_id'], request.cookies.get(COOKIE, ''))}


@app.get(PREFIX + '/me')
def me(request: Request, user=Depends(actor)):
    return {'user': {key: user.get(key) for key in SAFE_USER}, 'vehicles': [],
            'csrf': digest(request.cookies[COOKIE] + ':csrf')}


@app.post(PREFIX + '/logout')
def logout(request: Request, response: Response, user=Depends(actor)):
    database().sessions.delete_one({'_id': digest(request.cookies[COOKIE])})
    response.delete_cookie(COOKIE, path=PREFIX, secure=not local_mode(), httponly=True, samesite='strict')
    return {'status': 'signed_out'}


@app.post(PREFIX + '/consent')
def consent(item: Consent, user=Depends(actor)):
    logins(database()).update_one({'_id': user['_id'], 'deletion_requested_at': None}, {'$set': {
        'terms_version': POLICY_VERSION, 'privacy_version': POLICY_VERSION, 'accepted_at': now(), 'withdrawn_at': None}})
    return {'status': 'accepted', 'policy_version': POLICY_VERSION}


@app.post(PREFIX + '/withdraw')
def withdraw(user=Depends(actor)):
    logins(database()).update_one({'_id': user['_id']}, {'$set': {'withdrawn_at': now()}})
    database().otp.delete_many({'user_id': user['_id']})
    return {'status': 'withdrawn'}


@app.post(PREFIX + '/deletion-request')
def delete_account(response: Response, user=Depends(actor)):
    logins(database()).update_one({'_id': user['_id']}, {'$set': {'deletion_requested_at': now(), 'withdrawn_at': now()}})
    database().sessions.delete_many({'user_id': user['_id']})
    database().otp.delete_many({'user_id': user['_id']})
    response.delete_cookie(COOKIE, path=PREFIX, secure=not local_mode(), httponly=True, samesite='strict')
    return {'status': 'deletion_requested', 'message': 'Access revoked. Operator must complete account erasure and backup retention review.'}


@app.post(PREFIX + '/otp/send')
def otp_send(item: OtpSend, user=Depends(actor)):
    current_consent(user)
    limit('otp-minute:' + user['_id'] + item.channel, 1, 60)
    limit('otp-hour:' + user['_id'] + item.channel, 5, 3600)
    destination = user['email'] if item.channel == 'email' else user['phone']
    result = verify_call('Verifications', {'To': destination, 'Channel': item.channel}, item.channel)
    if result.get('status') != 'pending' or not result.get('sid'):
        raise HTTPException(502, 'OTP provider did not confirm delivery initiation.')
    database().otp.replace_one({'_id': user['_id'] + ':' + item.channel}, {
        '_id': user['_id'] + ':' + item.channel, 'user_id': user['_id'], 'sid': result['sid'],
        'attempts': 0, 'expires_at': now() + timedelta(minutes=10)}, upsert=True)
    return {'status': 'sent', 'expires_in_seconds': 600}


@app.post(PREFIX + '/otp/check')
def otp_check(item: OtpCheck, user=Depends(actor)):
    current_consent(user)
    key = user['_id'] + ':' + item.channel
    challenge = database().otp.find_one_and_update({'_id': key, 'expires_at': {'$gt': now()}, 'attempts': {'$lt': 5}},
        {'$inc': {'attempts': 1}}, return_document=ReturnDocument.AFTER)
    if not challenge:
        raise HTTPException(400, 'OTP expired or too many attempts. Request a new code.')
    result = verify_call('VerificationCheck', {'VerificationSid': challenge['sid'], 'Code': item.code}, item.channel)
    if result.get('status') != 'approved':
        raise HTTPException(400, 'OTP was not approved.')
    removed = database().otp.delete_one({'_id': key, 'sid': challenge['sid'], 'expires_at': {'$gt': now()}})
    if not removed.deleted_count:
        raise HTTPException(400, 'OTP was superseded or already used.')
    field = 'email_verified' if item.channel == 'email' else 'phone_verified'
    changed = logins(database()).update_one({'_id': user['_id'], 'withdrawn_at': None,
        'deletion_requested_at': None, 'privacy_version': POLICY_VERSION}, {'$set': {field: True}})
    if not changed.matched_count:
        raise HTTPException(403, 'Consent or account state changed. No verification was granted.')
    return {'status': 'verified', 'channel': item.channel}


@app.get(PREFIX + '/activity')
def activity(user=Depends(actor)):
    return {'sessions': [], 'gps': [], 'media': []}


@app.api_route(PREFIX + '/{reserved:path}', methods=['GET', 'POST', 'PUT', 'DELETE'])
def deferred_contributor(reserved: str, user=Depends(actor)):
    raise HTTPException(503, 'This cloud contribution feature is deferred; no file, GPS or video was stored.')


@app.get('/api/v1/public/overview')
def overview():
    if publication_replica_enabled():
        from .public_store import overview as published_overview
        result = published_overview()
        try:
            from .postgis_store import enabled as postgis_enabled, summary
            if postgis_enabled():
                spatial = summary()
                result['coverage']['roads'] = spatial['counts'].get('VERIFIED', 0)
                result['spatial_store'] = spatial
        except Exception:
            result['spatial_store'] = {'store': 'Aiven PostgreSQL/PostGIS', 'status': 'STARTING'}
        return result
    return {'coverage': {'roads': 0, 'cells': 0}, 'updates': [],
            'reports': {'published': 0, 'resolved': 0, 'in_progress': 0, 'window': 'No cloud publication yet'},
            'model': {'status': 'DEFERRED_LOCAL_BATCH', 'label': 'Local batch assessment; publication not connected'},
            'publication_status': 'NOT_CONNECTED', 'as_of': now()}


@app.get('/api/v1/public/vehicles')
def vehicles():
    return {'vehicles': [], 'expires_after_seconds': 90, 'as_of': now(),
            'notice': 'Public location publishing is not connected. Recorded GPS is never presented as live.'}


@app.get('/api/v1/public/weather')
def public_weather(latitude: float = 28.65, longitude: float = 77.10):
    if not 28.2 <= latitude <= 29.1 or not 76.7 <= longitude <= 77.6:
        raise HTTPException(422, 'Coordinates must be within the Delhi service area.')
    try:
        from .external_feeds import weather
        return weather(latitude, longitude)
    except Exception:
        raise HTTPException(503, 'Weather data is temporarily unavailable.') from None


@app.get('/api/v1/public/air-quality')
def public_air_quality(latitude: float = 28.65, longitude: float = 77.10):
    if not 28.2 <= latitude <= 29.1 or not 76.7 <= longitude <= 77.6:
        raise HTTPException(422, 'Coordinates must be within the Delhi service area.')
    try:
        from .external_feeds import air_quality
        return air_quality(latitude, longitude)
    except Exception:
        raise HTTPException(503, 'Air-quality data is temporarily unavailable.') from None


@app.get('/api/v1/public/transit')
def public_transit():
    try:
        from .external_feeds import transit
        return transit()
    except Exception:
        raise HTTPException(503, 'Transit map data is temporarily unavailable.') from None


@app.get('/api/v1/public/traffic')
def public_traffic():
    try:
        from .external_feeds import traffic
        return traffic()
    except Exception:
        raise HTTPException(503, 'Traffic data is temporarily unavailable.') from None


@app.get('/api/v1/public/demo/overview')
def public_demo_overview():
    from .public_store import demo_overview
    return demo_overview()


@app.get('/api/v1/public/demo/roads')
def public_demo_roads(request: Request, area_id: str = ''):
    try:
        from .postgis_store import enabled as postgis_enabled, features
        if postgis_enabled():
            result = features(dict(request.query_params), 'DEMO')
            if result['features']:
                result['synthetic'] = True
                result['disclaimer'] = 'Real OpenStreetMap geometry; synthetic demonstration severity—not a field assessment.'
                return result
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception:
        pass
    from .public_store import demo_roads
    return demo_roads(area_id=area_id)


@app.get('/api/v1/public/roads')
@app.get('/api/v1/public/grid')
@app.get('/api/v1/public/assessments')
def pending_map(request: Request):
    if request.url.path.endswith('/roads'):
        try:
            from .postgis_store import enabled as postgis_enabled, features
            if postgis_enabled():
                return features(dict(request.query_params), 'VERIFIED')
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except Exception:
            raise HTTPException(503, 'PostGIS road layer is starting. Please retry shortly.') from None
    if publication_replica_enabled():
        if request.url.path.endswith('/grid'):
            return {'type': 'FeatureCollection', 'features': [], 'truncated': False}
        from .public_store import roads as published_roads
        try:
            offset = min(max(int(request.query_params.get('offset', '0')), 0), 100000)
        except ValueError:
            raise HTTPException(422, 'Invalid map offset.') from None
        return published_roads(area_id=request.query_params.get('area_id', ''), offset=offset)
    raise HTTPException(503, 'The cloud road-data publication connection is deferred. Basemap tiles remain available.')


@app.api_route('/api/v1/internal/assessment-batches', methods=['POST'])
@app.api_route('/api/v1/internal/review-jobs', methods=['GET'])
def pending_worker():
    # No ingestion implementation or worker credentials until the separate AI phase.
    raise HTTPException(503, 'Local batch-review integration is deferred and disabled.')
