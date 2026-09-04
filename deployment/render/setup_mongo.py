"""Run from repository root: python -m deployment.render.setup_mongo [--create-account]."""
import argparse
from getpass import getpass
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from pydantic import ValidationError
from pymongo.errors import PyMongoError

from .models import Register
from .mongo_store import database, ensure_indexes, logins, now, password_hash


def main():
    parser = argparse.ArgumentParser(description='Create cloud identity indexes and optionally a private contributor account.')
    parser.add_argument('--create-account', action='store_true')
    args = parser.parse_args()
    load_dotenv(Path(__file__).with_name('.env'), override=False)
    try:
        db = database()
        db.command('ping')
        ensure_indexes(db)
        print('Required identity indexes are ready. Existing documents were not migrated.')
        if not args.create_account:
            return
        email = input('Account email: ').strip()
        full_name = input('Full name: ').strip()
        phone = input('Your phone in +91 format (required; not marked verified): ').strip()
        password = getpass('New private password (12+ characters, not the one shared in chat): ')
        if password != getpass('Repeat password: '):
            raise ValueError('Passwords did not match.')
        # Validate format without recording consent on somebody else's behalf.
        item = Register(email=email, full_name=full_name, phone=phone, password=password,
                        adult=True, terms_accepted=True, privacy_accepted=True, policy_version='2026-09-04-v2')
        uid = str(uuid4())
        logins(db).insert_one({'_id': uid, 'id': uid, 'schema_version': 1, 'role': 'contributor',
            'full_name': item.full_name, 'email': item.email, 'phone': item.phone,
            'password_hash': password_hash(item.password), 'email_verified': False, 'phone_verified': False,
            'terms_version': 'PENDING', 'privacy_version': 'PENDING', 'accepted_at': None,
            'withdrawn_at': None, 'deletion_requested_at': None, 'created_at': now()})
        print('Contributor account created. Accept the notice after login, then verify both contacts. No administrator privileges granted.')
    except ValidationError:
        raise SystemExit('Account not created: check email, name, +91 phone and minimum 12-character password. Values were not printed.')
    except (PyMongoError, RuntimeError, ValueError):
        raise SystemExit('Setup did not complete. Check private settings, network access, database roles and duplicate existing records. No credentials were printed.')


if __name__ == '__main__':
    main()
