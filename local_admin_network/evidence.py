from datetime import timedelta
from uuid import uuid4, UUID
from fastapi import APIRouter, Depends, HTTPException, Request
from . import schemas as s, storage
from .routes import router, db, get_scoped
from .security import actor, event, limit, areas_for
from .store import AREAS, now

def validate_track(body):
    previous = -1
    max_gap = 0
    for point in body.gps:
        if point.video_ms <= previous or point.video_ms > body.duration_ms:
            raise HTTPException(422, 'GPS video offsets must increase and stay inside the recording duration.')
        elapsed = (point.timestamp - body.recorded_at).total_seconds() * 1000
        if abs(elapsed - point.video_ms - body.gps_offset_ms) > 3000:
            raise HTTPException(422, 'GPS timestamps do not match the recording timeline. Correct the timing offset.')
        if previous >= 0:
            max_gap = max(max_gap, point.video_ms - previous)
        previous = point.video_ms
    if body.recorded_at > now() + timedelta(minutes=5):
        raise HTTPException(422, 'Recording time is in the future.')
    return {'max_gap_ms': max_gap, 'max_accuracy_m': max(p.accuracy_m for p in body.gps),
            'first_video_ms': body.gps[0].video_ms, 'last_video_ms': body.gps[-1].video_ms,
            'timing_source': body.timing_source, 'gps_is_device_reported': True}

def location_at(gps, video_ms, max_gap_ms=5000, max_accuracy_m=25):
    """Return no location when outside coverage, inaccurate, or across a GPS gap."""
    for a, b in zip(gps, gps[1:]):
        if a['video_ms'] <= video_ms <= b['video_ms']:
            gap = b['video_ms'] - a['video_ms']
            if gap <= 0 or gap > max_gap_ms or max(a['accuracy_m'], b['accuracy_m']) > max_accuracy_m:
                return None
            ratio = (video_ms - a['video_ms']) / gap
            return {'latitude': a['latitude'] + (b['latitude'] - a['latitude']) * ratio,
                    'longitude': a['longitude'] + (b['longitude'] - a['longitude']) * ratio,
                    'accuracy_m': max(a['accuracy_m'], b['accuracy_m']), 'method': 'INTERPOLATED_DEVICE_GPS'}
    return None

def safe_evidence(row):
    fields = ('id', 'area_id', 'filename', 'byte_size', 'duration_ms', 'recorded_at', 'status', 'quality',
              'created_at', 'review_note', 'consent_active', 'source_type')
    return {k: row.get(k) for k in fields}

def current_contributor(request, row):
    return row.get('consent_active') and request.app.state.authority_contributor_allowed(row['contributor_id'], row.get('consent_accepted_at'))

@router.get('/evidence')
def inbox(request: Request, admin=Depends(actor)):
    rows = db(request).evidence.find({'area_id': {'$in': list(areas_for(admin))}, 'consent_active': True,
                                    'status': {'$in': ['READY', 'DRIVE_REFERENCE', 'ACCEPTED', 'REJECTED']}}).sort('created_at', -1).limit(100)
    return [safe_evidence(r) for r in rows if current_contributor(request, r)]

@router.get('/evidence/{item_id}/manifest')
def manifest(item_id: str, request: Request, admin=Depends(actor)):
    row = get_scoped(request, 'evidence', item_id, admin)
    if not current_contributor(request, row):
        raise HTTPException(403, 'Contributor consent is no longer active.')
    return {**safe_evidence(row), 'gps': row['gps'], 'gps_offset_ms': row['gps_offset_ms']}

@router.post('/evidence/{item_id}/review')
def review(item_id: str, body: s.EvidenceReview, request: Request, admin=Depends(actor)):
    row = get_scoped(request, 'evidence', item_id, admin)
    if not current_contributor(request, row) or row['status'] not in ('READY', 'DRIVE_REFERENCE'):
        raise HTTPException(409, 'This recording is no longer available for review.')
    result = db(request).evidence.update_one({'_id': item_id, 'status': row['status'], 'consent_active': True},
        {'$set': {'status': body.action, 'review_note': body.note}, '$push': {'history': event(admin, body.action)}})
    if not result.modified_count:
        raise HTTPException(409, 'Another admin reviewed this recording. Refresh the inbox.')
    return {'ok': True}

@router.post('/evidence/{item_id}/download')
def download(item_id: str, request: Request, admin=Depends(actor)):
    row = get_scoped(request, 'evidence', item_id, admin)
    if not current_contributor(request, row) or row['status'] not in ('READY', 'DRIVE_REFERENCE', 'ACCEPTED'):
        raise HTTPException(403, 'Recording access is unavailable.')
    if row.get('archive', {}).get('state') == 'LOCAL_VERIFIED':
        local_file(row)
        return {'url': '/api/v1/authority/evidence/' + item_id + '/file',
                'expires_in': None, 'notice': 'Private core file; an active authorized session is required.'}
    return {'url': row['drive_url'] if row.get('drive_url') else storage.download_url(row),
            'expires_in': None if row.get('drive_url') else 120,
            'notice': 'Drive access is controlled by the owner.' if row.get('drive_url') else 'Private link expires in two minutes.'}

def local_file(row):
    from .archive import archive_root
    from uuid import UUID
    try:
        root = archive_root()
        path = (root / (str(UUID(row['id'])) + '.video')).resolve()
        if path.parent != root or not path.is_file() or path.stat().st_size != row['byte_size']:
            raise ValueError('Unavailable archive')
        return path
    except Exception:
        raise HTTPException(503, 'The core archive is unavailable. Retry when the core server is online.') from None

@router.get('/evidence/{item_id}/file')
def archived_file(item_id: str, request: Request, admin=Depends(actor)):
    from fastapi.responses import FileResponse
    row = get_scoped(request, 'evidence', item_id, admin)
    if not current_contributor(request, row) or row['status'] not in ('READY', 'ACCEPTED') or row.get('archive', {}).get('state') != 'LOCAL_VERIFIED':
        raise HTTPException(403, 'Recording access is unavailable.')
    return FileResponse(local_file(row), filename=str(UUID(row['id'])) + '.video', media_type='application/octet-stream')

def contributor_router(contributor_actor, consent_check):
    """Mount under the existing contributor session boundary, never accept a posted user ID."""
    routes = APIRouter(prefix='/api/v1/contributors/evidence')

    def owner(request, item_id, user):
        consent_check(user)
        row = db(request).evidence.find_one({'_id': item_id, 'contributor_id': user['id']})
        if not row or not row.get('consent_active'):
            raise HTTPException(404, 'Recording not found.')
        if row.get('consent_accepted_at') != user.get('accepted_at'):
            raise HTTPException(403, 'This recording belongs to an earlier sharing consent. Create a new submission.')
        return row

    @routes.get('')
    def listing(request: Request, user=Depends(contributor_actor)):
        return [safe_evidence(r) for r in db(request).evidence.find({'contributor_id': user['id']}).sort('created_at', -1).limit(100)]

    @routes.get('/areas')
    def areas(user=Depends(contributor_actor)):
        return [a for a in AREAS if a['level'] == 'LOCAL']

    @routes.post('', status_code=201)
    def create(body: s.Evidence, request: Request, user=Depends(contributor_actor)):
        consent_check(user)
        # Fleet streams require separately authenticated device enrollment.
        # A browser-provided vehicle type must never bypass this limit.
        if body.duration_ms > 120000:
            raise HTTPException(422, 'Private road-damage clips must be no longer than two minutes.')
        if body.area_id not in {a['id'] for a in AREAS if a['level'] == 'LOCAL'}:
            raise HTTPException(422, 'Select a supported locality.')
        limit(db(request), 'evidence:' + user['id'], 10, 86400)
        quality = validate_track(body)
        item_id = str(uuid4())
        row = {**body.model_dump(), '_id': item_id, 'id': item_id, 'contributor_id': user['id'],
               'consent_accepted_at': user.get('accepted_at'),
               'object_key': 'private/recordings/' + item_id, 'consent_active': True, 'quality': quality,
               'status': 'DRIVE_REFERENCE' if body.drive_url else 'UPLOADING',
               'source_type': 'DRIVE' if body.drive_url else 'R2', 'created_at': now(), 'history': []}
        row['vehicle_class'] = 'PRIVATE'
        if not body.drive_url:
            row['upload_id'] = storage.begin(row['object_key'], body.content_type)
        try:
            db(request).evidence.insert_one(row)
        except Exception:
            if row.get('upload_id'):
                storage.abort(row)
            raise
        return {**safe_evidence(row), 'part_size': storage.PART_SIZE}

    @routes.post('/{item_id}/part')
    def part(item_id: str, body: s.Part, request: Request, user=Depends(contributor_actor)):
        row = owner(request, item_id, user)
        if row['status'] != 'UPLOADING' or row['created_at'] < now() - timedelta(days=1):
            raise HTTPException(409, 'This upload is closed or expired.')
        count = (row['byte_size'] + storage.PART_SIZE - 1) // storage.PART_SIZE
        if body.part_number > count:
            raise HTTPException(422, 'Invalid part number.')
        limit(db(request), 'part:' + user['id'], 400, 3600)
        return {'url': storage.part_url(row, body.part_number)}

    @routes.post('/{item_id}/complete')
    def complete(item_id: str, body: s.CompleteUpload, request: Request, user=Depends(contributor_actor)):
        row = owner(request, item_id, user)
        if row['status'] == 'READY':
            return {'ok': True}
        if row['status'] != 'UPLOADING':
            raise HTTPException(409, 'Upload is not pending.')
        storage.finish(row, body.parts)
        db(request).evidence.update_one({'_id': item_id, 'consent_active': True, 'status': 'UPLOADING'}, {'$set': {'status': 'READY'}})
        return {'ok': True}

    @routes.post('/{item_id}/withdraw')
    def withdraw(item_id: str, request: Request, user=Depends(contributor_actor)):
        row = db(request).evidence.find_one({'_id': item_id, 'contributor_id': user['id']})
        if not row:
            raise HTTPException(404, 'Recording not found.')
        db(request).evidence.update_one({'_id': item_id}, {'$set': {'consent_active': False, 'status': 'WITHDRAWN'}})
        if row['status'] == 'UPLOADING':
            storage.abort(row)
        return {'ok': True}

    return routes

