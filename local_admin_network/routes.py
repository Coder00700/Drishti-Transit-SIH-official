import hashlib
import secrets
from datetime import timedelta
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query
from pymongo.errors import DuplicateKeyError
from deployment.render.mongo_store import digest, password_matches
from . import schemas as s
from .imports import parse
from .store import AREAS, now, areas_for, clean
from .security import PREFIX, COOKIE, DUMMY, actor, scope, public_admin, limit, audit, event

router = APIRouter(prefix=PREFIX)
public = APIRouter(prefix='/api/v1/authority-public')

def db(request):
    return request.app.state.authority_db()

def get_scoped(request, collection, item_id, admin):
    row = db(request)[collection].find_one({'_id': item_id})
    if not row or row['area_id'] not in areas_for(admin):
        raise HTTPException(404, 'Item not found in your jurisdiction.')
    return row

@router.get('/capabilities')
def capabilities(request: Request):
    return {'demo': getattr(request.app.state, 'authority_demo', False), 'formats': ['geojson', 'json', 'csv'],
            'storage_configured': all(__import__('os').environ.get(k) for k in ('R2_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'))}

@router.post('/login')
def login(body: s.Login, request: Request, response: Response):
    database = db(request)
    # Standalone service ignores forwarded IPs. Render gateway sets a trusted client IP.
    ip = request.headers.get('x-drishti-client-ip', '') if getattr(request.app.state, 'authority_gateway', False) else request.client.host
    limit(database, 'ip:' + ip)
    limit(database, 'id:' + body.secure_id)
    admin = database.admins.find_one({'secure_id': body.secure_id, 'active': True})
    if not password_matches(body.password, admin['password_hash'] if admin else DUMMY) or not admin:
        raise HTTPException(401, 'The ID or password is incorrect.')
    old = request.cookies.get(COOKIE)
    if old:
        database.sessions.delete_one({'_id': digest(old)})
    token = secrets.token_urlsafe(32)
    database.sessions.insert_one({'_id': digest(token), 'admin_id': admin['_id'], 'expires_at': now() + timedelta(hours=4)})
    response.set_cookie(COOKIE, token, httponly=True, secure=request.app.state.authority_secure,
                        samesite='strict', path=PREFIX, max_age=14400)
    audit(database, admin, 'LOGIN', admin['id'])
    return {'admin': public_admin(admin), 'csrf': digest(token + ':csrf')}

@router.get('/me')
def me(request: Request, admin=Depends(actor)):
    return {'admin': public_admin(admin), 'csrf': digest(request.cookies[COOKIE] + ':csrf')}

@router.post('/logout')
def logout(request: Request, response: Response, admin=Depends(actor)):
    db(request).sessions.delete_one({'_id': digest(request.cookies[COOKIE])})
    response.delete_cookie(COOKIE, path=PREFIX, secure=request.app.state.authority_secure, httponly=True, samesite='strict')
    return {'ok': True}

@router.get('/areas')
def areas(admin=Depends(actor)):
    return [a for a in AREAS if a['id'] in areas_for(admin)]

@router.get('/team')
def team(request: Request, admin=Depends(actor)):
    allowed = list(areas_for(admin))
    active = [{**public_admin(a), 'status': 'ACTIVE'} for a in db(request).admins.find({'area_id': {'$in': allowed}})]
    invited = [{'id': row['_id'], 'secure_id': 'pending-activation', 'name': row['display_name'],
                'area_id': row['area_id'], 'level': row['level'], 'slot': row['slot'], 'status': row['status']}
               for row in db(request).admin_invites.find({
                   'area_id': {'$in': allowed}, 'status': {'$ne': 'ACTIVATED'},
               })]
    return active + invited

@router.get('/research')
def research(request: Request, admin=Depends(actor)):
    fields = ('id', 'area_id', 'title', 'source_url', 'source_owner', 'kind', 'status',
              'publication', 'photo_proof_url', 'notice', 'created_at')
    rows = db(request).research_queue.find({'area_id': {'$in': list(areas_for(admin))}}).sort([('area_id', 1), ('title', 1)]).limit(100)
    return [{key: row.get(key) for key in fields} for row in rows]

@router.get('/report-requests')
def report_requests(request: Request, admin=Depends(actor)):
    fields = ('id', 'area_id', 'request_type', 'requested_role', 'status', 'instructions', 'created_at')
    rows = db(request).report_requests.find({'area_id': {'$in': list(areas_for(admin))}}).sort('area_id', 1).limit(100)
    return [{key: row.get(key) for key in fields} for row in rows]

@router.get('/dashboard')
def dashboard(request: Request, admin=Depends(actor)):
    query = {'area_id': {'$in': list(areas_for(admin))}}
    database = db(request)
    return {'drafts': database.content.count_documents({**query, 'publication': 'DRAFT'}),
            'published': database.content.count_documents({**query, 'publication': 'PUBLISHED'}),
            'evidence_pending': database.evidence.count_documents({**query, 'status': 'READY', 'consent_active': True}),
            'datasets': database.imports.count_documents({**query, 'status': 'VALIDATED'}),
            'open_report_requests': database.report_requests.count_documents({**query, 'status': 'OPEN'}),
            'research_candidates': database.research_queue.count_documents(query)}

def content_valid(body):
    if body.kind == 'ALERT' and (body.expires_at is None or not now() < body.expires_at <= now() + timedelta(days=7)):
        raise HTTPException(422, 'Alerts require an expiry within the next seven days.')
    if body.status == 'RESOLVED' and len(body.resolution_note.strip()) < 10:
        raise HTTPException(422, 'Explain the resolution and evidence before marking this report resolved.')

@router.get('/content')
def content_list(request: Request, admin=Depends(actor), offset: int = Query(0, ge=0, le=10000)):
    return [clean(r) for r in db(request).content.find({'area_id': {'$in': list(areas_for(admin))}}).sort('updated_at', -1).skip(offset).limit(100)]

@router.post('/content', status_code=201)
def create_content(body: s.Content, request: Request, admin=Depends(actor)):
    scope(admin, body.area_id)
    content_valid(body)
    item_id = str(uuid4())
    row = {**body.model_dump(), '_id': item_id, 'id': item_id, 'revision': 1, 'publication': 'DRAFT',
           'created_by': admin['id'], 'updated_at': now(), 'history': [event(admin, 'CREATED')]}
    db(request).content.insert_one(row)
    return clean(row)

@router.put('/content/{item_id}')
def edit_content(item_id: str, body: s.EditContent, request: Request, admin=Depends(actor)):
    row = get_scoped(request, 'content', item_id, admin)
    scope(admin, body.area_id)
    if row['area_id'] != body.area_id or row['kind'] != body.kind:
        raise HTTPException(422, 'An update cannot move an item to another area or category.')
    content_valid(body)
    fields = body.model_dump(exclude={'revision'})
    changed = db(request).content.update_one({'_id': item_id, 'revision': body.revision},
        {'$set': {**fields, 'publication': 'DRAFT', 'updated_at': now()}, '$inc': {'revision': 1}, '$push': {'history': event(admin, 'EDITED')}})
    if not changed.modified_count:
        raise HTTPException(409, 'Another admin updated this item. Refresh before editing.')
    return clean(db(request).content.find_one({'_id': item_id}))

@router.post('/content/{item_id}/transition')
def transition(item_id: str, body: s.Transition, request: Request, admin=Depends(actor)):
    row = get_scoped(request, 'content', item_id, admin)
    if body.action == 'publish':
        content_valid(s.Content(**{k: row[k] for k in s.Content.model_fields}))
    result = db(request).content.update_one({'_id': item_id, 'revision': body.revision},
        {'$set': {'publication': 'PUBLISHED' if body.action == 'publish' else 'WITHDRAWN', 'updated_at': now()},
         '$inc': {'revision': 1}, '$push': {'history': event(admin, body.action.upper())}})
    if not result.modified_count:
        raise HTTPException(409, 'Item changed. Refresh and review the latest revision.')
    return {'ok': True}

@router.post('/imports', status_code=201)
def import_roads(body: s.ImportFile, request: Request, admin=Depends(actor)):
    scope(admin, body.area_id, global_only=True)
    if body.area_id not in {a['id'] for a in AREAS if a['level'] == 'LOCAL'}:
        raise HTTPException(422, 'Choose the locality covered by this dataset.')
    limit(db(request), 'imports:' + admin['id'], 20, 3600)
    rows = parse(body.filename, body.content)
    checksum = hashlib.sha256(body.content.encode()).hexdigest()
    existing = db(request).imports.find_one({'area_id': body.area_id, 'checksum': checksum})
    if existing:
        if existing['status'] != 'VALIDATED':
            raise HTTPException(409, 'This import is incomplete; inspect it before retrying.')
        return clean(existing)
    batch_id = str(uuid4())
    batch = {'_id': batch_id, 'id': batch_id, 'area_id': body.area_id, 'filename': body.filename,
             'checksum': checksum, 'status': 'STAGING', 'count': len(rows), 'created_at': now(),
             'history': [event(admin, 'IMPORTED')]}
    try:
        db(request).imports.insert_one(batch)
    except DuplicateKeyError:
        raise HTTPException(409, 'The same import is already being processed.') from None
    # Failed writes leave an unpublishable STAGING import, never a partial public dataset.
    db(request).roads.insert_many([{**r, 'area_id': body.area_id, 'batch_id': batch_id} for r in rows])
    db(request).imports.update_one({'_id': batch_id}, {'$set': {'status': 'VALIDATED'}})
    return {**clean(batch), 'status': 'VALIDATED'}

@router.get('/imports')
def imports(request: Request, admin=Depends(actor)):
    return [clean(r) for r in db(request).imports.find({'area_id': {'$in': list(areas_for(admin))}}).sort('created_at', -1).limit(100)]

@router.get('/imports/{batch_id}')
def inspect_import(batch_id: str, request: Request, admin=Depends(actor)):
    batch = get_scoped(request, 'imports', batch_id, admin)
    active = db(request).publications.find_one({'_id': batch['area_id']})
    return {**clean(batch), 'active_batch_id': active['batch_id'] if active else None,
            'preview': [clean(r) for r in db(request).roads.find({'batch_id': batch_id}).limit(20)]}

@router.post('/imports/{batch_id}/publish')
def publish_batch(batch_id: str, body: s.PublishBatch, request: Request, admin=Depends(actor)):
    batch = get_scoped(request, 'imports', batch_id, admin)
    scope(admin, batch['area_id'], global_only=True)
    if batch['status'] != 'VALIDATED':
        raise HTTPException(409, 'Only a fully validated dataset can be published.')
    database = db(request)
    publication = {'batch_id': batch_id, 'area_id': batch['area_id'], 'updated_at': now()}
    try:
        if body.expected_batch_id is None:
            database.publications.insert_one({'_id': batch['area_id'], **publication, 'history': [event(admin, 'PUBLISHED:' + batch_id)]})
        else:
            changed = database.publications.update_one({'_id': batch['area_id'], 'batch_id': body.expected_batch_id},
                {'$set': publication, '$push': {'history': event(admin, 'PUBLISHED:' + batch_id)}})
            if not changed.matched_count:
                raise HTTPException(409, 'Publication changed. Review the currently published dataset.')
    except DuplicateKeyError:
        raise HTTPException(409, 'This locality already has a publication. Refresh before replacing it.') from None
    return {'ok': True, 'batch_id': batch_id}

@router.get('/audit')
def audit_list(request: Request, admin=Depends(actor)):
    query = {'area_id': {'$in': list(areas_for(admin))}}
    events = [clean(x) for x in db(request).audit.find(query).sort('at', -1).limit(100)]
    for collection in ('content', 'imports', 'publications', 'evidence'):
        for row in db(request)[collection].find(query).limit(500):
            events.extend({**e, 'target': str(row['_id']), 'area_id': row['area_id']} for e in row.get('history', []))
    return sorted(events, key=lambda e: e['at'], reverse=True)[:100]

@public.get('/areas')
def public_areas():
    return AREAS

@public.get('/content')
def public_content(request: Request, area_id: str = '', kind: str = '', offset: int = Query(0, ge=0, le=10000)):
    query = {'publication': 'PUBLISHED', '$or': [{'kind': {'$ne': 'ALERT'}}, {'expires_at': {'$gt': now()}}]}
    if area_id:
        query['area_id'] = area_id
    if kind:
        query['kind'] = kind
    fields = ('id', 'area_id', 'kind', 'title', 'summary', 'status', 'category', 'source', 'resolution_note', 'expires_at', 'updated_at')
    return [{k: r.get(k) for k in fields} for r in db(request).content.find(query).sort('updated_at', -1).skip(offset).limit(100)]

@public.get('/roads')
def public_roads(request: Request, area_id: str = '', offset: int = Query(0, ge=0, le=100000)):
    pointers = list(db(request).publications.find({'area_id': area_id} if area_id else {}))
    query = {'batch_id': {'$in': [p['batch_id'] for p in pointers]}}
    keys = ('minLng', 'minLat', 'maxLng', 'maxLat')
    if any(k in request.query_params for k in keys):
        try:
            import math
            west, south, east, north = [float(request.query_params[k]) for k in keys]
            if not all(math.isfinite(v) for v in (west, south, east, north)) or not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise ValueError()
        except (ValueError, KeyError):
            raise HTTPException(422, 'Supply a valid WGS84 map viewport.') from None
        query['geometry'] = {'$geoIntersects': {'$geometry': {'type': 'Polygon', 'coordinates': [
            [[west,south],[east,south],[east,north],[west,north],[west,south]]]}}}
    rows = list(db(request).roads.find(query).sort('road_id', 1).skip(offset).limit(501))
    return {'type': 'FeatureCollection', 'truncated': len(rows) > 500, 'next_offset': offset + 500 if len(rows) > 500 else None,
            'features': [{'type': 'Feature', 'geometry': r['geometry'], 'properties': {k: r[k] for k in
                ('road_id', 'area_id', 'severity', 'confidence', 'model_version', 'observed_at')}} for r in rows[:500]]}

