import hmac
import secrets
from datetime import timedelta
from fastapi import HTTPException, Request
from pymongo import ReturnDocument
from deployment.render.mongo_store import digest, password_hash, password_matches
from .store import now, areas_for

PREFIX = '/api/v1/authority'
COOKIE = 'drishti_authority'
DUMMY = password_hash(secrets.token_urlsafe(32))

def limit(db, key, maximum=20, seconds=900):
    bucket = int(now().timestamp()) // seconds
    row = db.limits.find_one_and_update({'_id': digest(f'{key}:{bucket}')},
        {'$inc': {'count': 1}, '$setOnInsert': {'expires_at': now() + timedelta(seconds=seconds * 2)}},
        upsert=True, return_document=ReturnDocument.AFTER)
    if row['count'] > maximum:
        raise HTTPException(429, 'Too many attempts. Try again later.', headers={'Retry-After': str(seconds)})

def actor(request: Request):
    db = request.app.state.authority_db()
    token = request.cookies.get(COOKIE, '')
    if not token or len(token) > 100:
        raise HTTPException(401, 'Sign in to your authority account.')
    session = db.sessions.find_one({'_id': digest(token), 'expires_at': {'$gt': now()}})
    admin = db.admins.find_one({'_id': session['admin_id'], 'active': True}) if session else None
    if not admin:
        raise HTTPException(401, 'Session expired. Sign in again.')
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and not hmac.compare_digest(
            request.headers.get('x-authority-csrf', ''), digest(token + ':csrf')):
        raise HTTPException(403, 'Session protection failed. Refresh the page.')
    return admin

def scope(admin, area_id, global_only=False):
    if global_only and admin['level'] != 'GLOBAL':
        raise HTTPException(403, 'Only the Delhi global authority can publish road datasets.')
    if area_id not in areas_for(admin):
        raise HTTPException(403, 'This area is outside your authority.')

def public_admin(admin):
    result = {k: admin[k] for k in ('id', 'secure_id', 'name', 'area_id', 'level', 'slot')}
    result['must_change_password'] = bool(admin.get('must_change_password', False))
    result['credential_scope'] = admin.get('credential_scope', 'STANDARD')
    return result

def event(admin, action):
    return {'actor_id': admin['id'], 'action': action, 'at': now()}

def audit(db, admin, action, target, area_id=None):
    db.audit.insert_one({**event(admin, action), 'target': target, 'area_id': area_id or admin['area_id']})

