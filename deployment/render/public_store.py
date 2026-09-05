"""Read-only access to allowlisted DrishtiPublic release snapshots."""
import os
from functools import lru_cache

from fastapi import HTTPException
from pymongo import MongoClient


def enabled():
    return os.environ.get('PUBLICATION_REPLICA_ENABLED') == 'true'


@lru_cache(maxsize=1)
def database():
    uri = os.environ.get('PUBLIC_MONGODB_URI') or os.environ.get('MONGODB_URI', '')
    name = os.environ.get('PUBLIC_DATABASE', 'DrishtiPublic')
    if not uri.startswith('mongodb+srv://') or name in ('Users', 'DrishtiCore', 'admin', 'local', 'config'):
        raise RuntimeError('Configure the dedicated public snapshot database.')
    return MongoClient(uri, tls=True, tlsAllowInvalidCertificates=False,
        tlsAllowInvalidHostnames=False, serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000, socketTimeoutMS=5000, maxPoolSize=10,
        tz_aware=True, retryWrites=False, appname='drishti-public-api')[name]


def current_release(db=None):
    db = db or database()
    pointer = db.state.find_one({'_id': 'current'})
    if not pointer:
        return db, None
    release_id = pointer.get('release_id')
    if not db.releases.find_one({'_id': release_id, 'state': 'READY'}):
        return db, None
    return db, release_id


def overview(db=None):
    db, release_id = current_release(db)
    if not release_id:
        return {'coverage': {'roads': 0, 'cells': 0}, 'updates': [],
                'reports': {'published': 0, 'resolved': 0, 'in_progress': 0,
                            'window': 'No approved cloud publication yet'},
                'model': {'status': 'DEFERRED_LOCAL_BATCH',
                          'label': 'Local assessment; global approval required'}}
    rows = list(db.content_snapshots.find({'release_id': release_id}, {'_id': 0, 'release_id': 0})
                .sort('updated_at', -1).limit(20))
    return {'coverage': {'roads': db.road_snapshots.count_documents({'release_id': release_id}), 'cells': 0},
            'updates': rows,
            'reports': {'published': len(rows),
                        'resolved': sum(row.get('status') == 'RESOLVED' for row in rows),
                        'in_progress': sum(row.get('status') == 'IN_PROGRESS' for row in rows),
                        'window': 'Current approved release'},
            'model': {'status': 'DEFERRED_LOCAL_BATCH',
                      'label': 'Local assessment; global approval required'}}


def roads(area_id='', offset=0, db=None):
    db, release_id = current_release(db)
    if not release_id:
        raise HTTPException(503, 'No approved road-data release is available yet.')
    query = {'release_id': release_id}
    if area_id:
        query['area_id'] = area_id
    rows = list(db.road_snapshots.find(query, {'_id': 0, 'release_id': 0})
                .sort('road_id', 1).skip(offset).limit(501))
    return {'type': 'FeatureCollection', 'truncated': len(rows) > 500,
            'next_offset': offset + 500 if len(rows) > 500 else None,
            'features': [{'type': 'Feature', 'geometry': row['geometry'],
                          'properties': {key: row.get(key) for key in
                          ('road_id', 'area_id', 'severity', 'confidence', 'model_version', 'observed_at')}}
                         for row in rows[:500]]}
