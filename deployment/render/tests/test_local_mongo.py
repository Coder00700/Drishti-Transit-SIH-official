"""Loopback-only profile must never relax the deployed gateway boundary."""
import os
import unittest
from unittest.mock import patch, Mock
import mongomock
from fastapi.testclient import TestClient
from deployment.render import cloud_api as api
from deployment.render.mongo_store import ensure_indexes


class LocalBoundary(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'DRISHTI_LOCAL_MONGO': 'true', 'RENDER': '',
            'PORTAL_ORIGIN': 'http://127.0.0.1:3000', 'MONGODB_LOGIN_COLLECTION': 'login',
            'ALLOW_REGISTRATION': 'true'})
        self.env.start()
        self.db = mongomock.MongoClient(tz_aware=True).Users
        self.db.command = Mock(return_value={'ok': 1})
        ensure_indexes(self.db)
        self.store = patch.object(api, 'database', return_value=self.db)
        self.store.start()

    def tearDown(self):
        self.store.stop()
        self.env.stop()

    def client(self, peer='127.0.0.1'):
        return TestClient(api.app, base_url='http://127.0.0.1:8001', client=(peer, 50001),
                          headers={'Origin': 'http://127.0.0.1:3000'})

    def test_localhost_gets_capabilities_without_gateway_secret(self):
        with self.client() as client:
            self.assertEqual(client.get(api.PREFIX + '/capabilities').status_code, 200)
            self.assertEqual(client.get(api.PREFIX + '/me').status_code, 401)

    def test_remote_peer_and_forwarded_headers_are_rejected(self):
        with self.client('192.0.2.1') as client:
            self.assertEqual(client.get('/health').status_code, 403)
        with self.client() as client:
            for header in ('Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto'):
                self.assertEqual(client.get('/health', headers={header: '127.0.0.1'}).status_code, 403)
            self.assertEqual(client.get('/health', headers={'Host': 'evil.test'}).status_code, 403)

    def test_loopback_cookie_and_csrf(self):
        with self.client() as client:
            response = client.post(api.PREFIX + '/register', json={
                'email': 'local@example.test', 'phone': '+919123456789', 'password': 'local-test-password',
                'full_name': 'Local Test', 'adult': True, 'terms_accepted': True,
                'privacy_accepted': True, 'policy_version': api.POLICY_VERSION})
            self.assertEqual(response.status_code, 201)
            self.assertNotIn('secure', response.headers['set-cookie'].lower())
            self.assertIn('httponly', response.headers['set-cookie'].lower())
            self.assertEqual(client.get(api.PREFIX + '/me').status_code, 200)
            self.assertEqual(client.post(api.PREFIX + '/logout').status_code, 403)
            self.assertEqual(client.post(api.PREFIX + '/logout', headers={
                'x-contributor-csrf': response.json()['csrf']}).status_code, 200)

    def test_profile_is_invalid_on_render_or_remote_origin(self):
        with patch.dict(os.environ, {'RENDER': 'true'}):
            self.assertFalse(api.local_mode())
            with self.assertRaises(RuntimeError):
                api.valid_configuration()
        with patch.dict(os.environ, {'PORTAL_ORIGIN': 'http://192.0.2.1:3000'}):
            with self.assertRaises(RuntimeError):
                api.valid_configuration()


if __name__ == '__main__':
    unittest.main()
