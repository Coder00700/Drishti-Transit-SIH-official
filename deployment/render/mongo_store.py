"""Cloud-only identity store. No PostgreSQL fallback, migrations or AI imports."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone
from functools import lru_cache

from pymongo import MongoClient


def now():
    return datetime.now(timezone.utc)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password):
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return salt.hex() + ':' + key.hex()


def password_matches(password, stored):
    try:
        salt, expected = stored.split(':')
        if len(salt) != 32 or len(expected) != 64:
            return False
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt),
                                n=16384, r=8, p=1, dklen=32).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, AttributeError):
        return False


@lru_cache(maxsize=1)
def database():
    uri = os.environ.get('MONGODB_URI', '')
    # Atlas SRV only, with TLS and normal certificate/hostname verification enforced.
    if not uri.startswith('mongodb+srv://'):
        raise RuntimeError('Configure the rotated Atlas URI in server secrets.')
    client = MongoClient(uri, tls=True, tlsAllowInvalidCertificates=False,
                         tlsAllowInvalidHostnames=False, serverSelectionTimeoutMS=5000,
                         connectTimeoutMS=5000, socketTimeoutMS=5000, maxPoolSize=10,
                         tz_aware=True, retryWrites=True, appname='drishti-cloud-portal')
    return client[os.environ.get('MONGODB_DATABASE', 'Users')]


def logins(db):
    return db[os.environ.get('MONGODB_LOGIN_COLLECTION', 'login')]


def ensure_indexes(db):
    # Operator command only: runtime credentials do not need createIndex privileges.
    # Never convert existing datasheet documents or silently overwrite duplicates.
    logins(db).create_index('email', unique=True, name='unique_email')
    logins(db).create_index('phone', unique=True, name='unique_phone')
    db.sessions.create_index('expires_at', expireAfterSeconds=0, name='expire_sessions')
    db.rate_limits.create_index('expires_at', expireAfterSeconds=0, name='expire_limits')
    db.otp.create_index('expires_at', expireAfterSeconds=0, name='expire_otp')


def require_indexes(db):
    indexes = list(logins(db).list_indexes())
    for field in ('email', 'phone'):
        if not any(i.get('unique') and list(i['key'].items()) == [(field, 1)] for i in indexes):
            raise RuntimeError('Required account indexes have not been created.')
