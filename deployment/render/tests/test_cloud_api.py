"""Isolated contract/security checks. Never connects to Atlas or local Postgres."""
import os
import sys
import unittest
from datetime import timedelta
from unittest.mock import patch, Mock

import mongomock
from fastapi.testclient import TestClient

from deployment.render import cloud_api as api
from deployment.render.mongo_store import ensure_indexes, require_indexes, password_hash, password_matches, now

ORIGIN = 'https://portal.example.test'
SECRET = 'isolated-test-gateway-secret-' + 'x' * 32
PASSWORD = 'isolated-test-password-1234'


class CloudAccounts(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).Users
        self.db.command = Mock(return_value={'ok': 1})
        self.env = patch.dict(os.environ, {'PORTAL_ORIGIN': ORIGIN, 'EDGE_SHARED_SECRET': SECRET,
            'ALLOW_REGISTRATION': 'true', 'MONGODB_LOGIN_COLLECTION': 'login'})
        self.env.start()
        ensure_indexes(self.db)
        self.store = patch.object(api, 'database', return_value=self.db)
        self.store.start()
        self.client = TestClient(api.app, base_url=ORIGIN, headers={
            'x-drishti-edge': SECRET, 'x-drishti-client-ip': '192.0.2.1', 'origin': ORIGIN})
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.store.stop()
        self.env.stop()

    def register(self, email='someone@example.test', phone='+919123456789'):
        response = self.client.post(api.PREFIX + '/register', json={
            'email': email, 'phone': phone, 'password': PASSWORD, 'full_name': 'Test Contributor',
            'adult': True, 'terms_accepted': True, 'privacy_accepted': True, 'policy_version': api.POLICY_VERSION})
        self.assertEqual(response.status_code, 201, response.text)
        self.client.headers['x-contributor-csrf'] = response.json()['csrf']
        return response

    def test_hash_salted(self):
        a, b = password_hash(PASSWORD), password_hash(PASSWORD)
        self.assertNotEqual(a, b)
        self.assertTrue(password_matches(PASSWORD, a))
        self.assertFalse(password_matches('wrong', a))
        self.assertFalse(password_matches(PASSWORD, 'plaintext'))

    def test_exact_collection_and_no_secrets_in_profile(self):
        response = self.register()
        stored = self.db.login.find_one({'email': 'someone@example.test'})
        self.assertNotIn(PASSWORD, str(stored))
        self.assertEqual(stored['role'], 'contributor')
        me = self.client.get(api.PREFIX + '/me')
        self.assertEqual(me.status_code, 200)
        self.assertNotIn('password_hash', me.text)
        self.assertNotIn('_id', me.json()['user'])
        self.assertNotIn('role', me.json()['user'])
        cookie = response.headers['set-cookie'].lower()
        for attribute in ('secure', 'httponly', 'samesite=strict', 'path=/api/v1/contributors'):
            self.assertIn(attribute, cookie)
        self.assertIn('no-store', me.headers['cache-control'])

    def test_gateway_denied_direct_or_spoofed(self):
        for value in ('', 'incorrect'):
            result = self.client.get(api.PREFIX + '/me', headers={'x-drishti-edge': value})
            self.assertEqual(result.status_code, 403)
        self.assertEqual(self.client.get('/health', headers={'x-drishti-edge': ''}).status_code, 200)

    def test_csrf_and_origin(self):
        self.register()
        body = {'accepted': True, 'policy_version': api.POLICY_VERSION}
        self.assertEqual(self.client.post(api.PREFIX + '/consent', json=body,
            headers={'origin': 'https://evil.test'}).status_code, 403)
        self.assertEqual(self.client.post(api.PREFIX + '/consent', json=body,
            headers={'x-contributor-csrf': 'wrong'}).status_code, 403)

    def test_session_expiry_and_logout(self):
        self.register()
        self.assertEqual(self.client.post(api.PREFIX + '/logout').status_code, 200)
        self.assertEqual(self.client.get(api.PREFIX + '/me').status_code, 401)
        response = self.client.post(api.PREFIX + '/login', json={'email': 'someone@example.test', 'password': PASSWORD})
        self.assertEqual(response.status_code, 200)
        self.db.sessions.update_many({}, {'$set': {'expires_at': now() - timedelta(seconds=1)}})
        self.assertEqual(self.client.get(api.PREFIX + '/me').status_code, 401)

    def test_validation_does_not_echo_password_or_allow_operators(self):
        response = self.client.post(api.PREFIX + '/login', json={'email': {'$ne': None}, 'password': PASSWORD})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(PASSWORD, response.text)
        self.assertNotIn('input', response.text)

    def test_closed_registration(self):
        with patch.dict(os.environ, {'ALLOW_REGISTRATION': 'false'}):
            response = self.client.get(api.PREFIX + '/capabilities')
            self.assertFalse(response.json()['registration_enabled'])
            valid = {'email': 'a@example.test', 'phone': '+919123456789', 'password': PASSWORD,
                'full_name': 'Test User', 'adult': True, 'terms_accepted': True,
                'privacy_accepted': True, 'policy_version': api.POLICY_VERSION}
            self.assertEqual(self.client.post(api.PREFIX + '/register', json=valid).status_code, 503)
            self.assertEqual(self.db.login.count_documents({}), 0)

    def test_weak_password_rejected_not_logged(self):
        payload = {'email': 'a@example.test', 'phone': '+919123456789', 'password': 'short-pass',
            'full_name': 'Test User', 'adult': True, 'terms_accepted': True,
            'privacy_accepted': True, 'policy_version': api.POLICY_VERSION}
        response = self.client.post(api.PREFIX + '/register', json=payload)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('short-pass', response.text)

    def test_private_profiles_are_owner_scoped(self):
        self.register()
        first = self.client.get(api.PREFIX + '/me').json()['user']['id']
        self.register('another@example.test', '+919123456780')
        second = self.client.get(api.PREFIX + '/me').json()['user']['id']
        self.assertNotEqual(first, second)
        self.assertNotIn('someone@example.test', self.client.get(api.PREFIX + '/me').text)

    def test_deletion_revokes_sessions(self):
        self.register()
        cookie = self.client.cookies.get(api.COOKIE)
        self.assertEqual(self.client.post(api.PREFIX + '/deletion-request').status_code, 200)
        response = self.client.get(api.PREFIX + '/me', headers={'cookie': f'{api.COOKIE}={cookie}'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.post(api.PREFIX + '/login', json={
            'email': 'someone@example.test', 'password': PASSWORD}).status_code, 401)

    def test_rate_limit_failed_login(self):
        for i in range(10):
            self.assertEqual(self.client.post(api.PREFIX + '/login', json={
                'email': 'missing@example.test', 'password': PASSWORD}).status_code, 401)
        self.assertEqual(self.client.post(api.PREFIX + '/login', json={
            'email': 'missing@example.test', 'password': PASSWORD}).status_code, 429)

    def test_bound_request_and_disabled_media(self):
        self.register()
        self.assertEqual(self.client.post(api.PREFIX + '/anything', content=b'a' * 16385).status_code, 413)
        self.assertEqual(self.client.post(api.PREFIX + '/vehicles', json={}).status_code, 503)
        self.assertEqual(self.client.post('/api/v1/internal/assessment-batches', json={}).status_code, 503)
        self.assertEqual(self.client.get('/api/v1/public/assessments').status_code, 503)
        self.assertFalse(self.client.get('/health').json()['ai_execution'])

    def test_no_admin_or_raw_local_routes(self):
        for path in ('/docs', '/openapi.json', '/api/v1/admin/login', '/api/v1/recordings'):
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_no_contact_verification_without_provider(self):
        self.register()
        with patch.object(api, 'verify_call', side_effect=api.HTTPException(503, 'Not configured')):
            result = self.client.post(api.PREFIX + '/otp/send', json={'channel': 'sms', 'delivery_consent': True})
            self.assertEqual(result.status_code, 503)
        self.assertFalse(self.db.login.find_one({})['phone_verified'])

    def test_otp_success_is_single_use_and_bounded(self):
        self.register()
        with patch.object(api, 'verify_call', return_value={'status': 'pending', 'sid': 'test-sid'}):
            self.assertEqual(self.client.post(api.PREFIX + '/otp/send', json={'channel': 'email', 'delivery_consent': True}).status_code, 200)
        with patch.object(api, 'verify_call', return_value={'status': 'approved'}):
            body = {'channel': 'email', 'code': '123456'}
            self.assertEqual(self.client.post(api.PREFIX + '/otp/check', json=body).status_code, 200)
            self.assertEqual(self.client.post(api.PREFIX + '/otp/check', json=body).status_code, 400)
        self.assertTrue(self.db.login.find_one({})['email_verified'])
        self.assertFalse(self.db.login.find_one({})['phone_verified'])

    def test_required_unique_indexes(self):
        require_indexes(self.db)
        self.db.login.drop_index('unique_email')
        with self.assertRaises(RuntimeError):
            require_indexes(self.db)

    def test_duplicate_phone_and_email_are_rejected(self):
        self.register()
        payload = {'email': 'other@example.test', 'phone': '+919123456789', 'password': PASSWORD,
            'full_name': 'Test User', 'adult': True, 'terms_accepted': True,
            'privacy_accepted': True, 'policy_version': api.POLICY_VERSION}
        self.assertEqual(self.client.post(api.PREFIX + '/register', json=payload).status_code, 409)
        payload.update(email='someone@example.test', phone='+919123456788')
        self.assertEqual(self.client.post(api.PREFIX + '/register', json=payload).status_code, 409)
        self.assertEqual(self.db.login.count_documents({}), 1)

    def test_login_rotates_old_session(self):
        self.register()
        old = self.client.cookies.get(api.COOKIE)
        response = self.client.post(api.PREFIX + '/login', json={'email': 'someone@example.test', 'password': PASSWORD})
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(old, self.client.cookies.get(api.COOKIE))
        self.assertEqual(self.client.get(api.PREFIX + '/me', headers={'cookie': api.COOKIE + '=' + old}).status_code, 401)

    def test_withdrawn_account_cannot_verify_until_reconsent(self):
        self.register()
        self.assertEqual(self.client.post(api.PREFIX + '/withdraw').status_code, 200)
        self.assertEqual(self.client.post(api.PREFIX + '/otp/send', json={'channel': 'email', 'delivery_consent': True}).status_code, 403)
        self.assertEqual(self.client.post(api.PREFIX + '/consent', json={'accepted': True, 'policy_version': api.POLICY_VERSION}).status_code, 200)
        self.assertIsNone(self.client.get(api.PREFIX + '/me').json()['user']['withdrawn_at'])

    def test_configuration_rejects_unsafe_origin_and_short_secret(self):
        for settings in ({'PORTAL_ORIGIN': 'http://example.test'}, {'PORTAL_ORIGIN': ORIGIN + '/'},
                         {'EDGE_SHARED_SECRET': 'short'}):
            with patch.dict(os.environ, settings):
                with self.assertRaises(RuntimeError):
                    api.valid_configuration()

    def test_no_ai_imports(self):
        for module in ('cv2', 'torch', 'ultralytics', 'backend', 'backend.app.main', 'backend.app.database'):
            self.assertNotIn(module, sys.modules)


if __name__ == '__main__':
    unittest.main()
