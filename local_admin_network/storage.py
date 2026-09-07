"""Private R2 multipart adapter. Video bytes travel directly between device and R2."""
import os
from functools import wraps
from fastapi import HTTPException

PART_SIZE = 8 * 1024 * 1024

def storage_operation(fn):
    @wraps(fn)
    def protected(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, 'Private storage is unavailable. Keep the device copy and retry later.') from None
    return protected

def client():
    required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
    if not all(os.environ.get(k) for k in required):
        raise HTTPException(503, 'Private video storage is not configured. Keep your local recording or use a private Drive reference.')
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        raise HTTPException(503, 'The video storage adapter must be installed by the operator.') from None
    return boto3.client('s3', endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        region_name='auto', config=Config(signature_version='s3v4', s3={'addressing_style': 'path'},
        connect_timeout=5, read_timeout=15, retries={'max_attempts': 2}))

def bucket():
    return os.environ['R2_BUCKET']

@storage_operation
def begin(key, content_type):
    return client().create_multipart_upload(Bucket=bucket(), Key=key, ContentType=content_type)['UploadId']

@storage_operation
def part_url(row, number):
    return client().generate_presigned_url('upload_part', Params={'Bucket': bucket(), 'Key': row['object_key'],
        'UploadId': row['upload_id'], 'PartNumber': number}, ExpiresIn=900)

@storage_operation
def finish(row, submitted):
    api = client()
    try:
        parts = api.list_parts(Bucket=bucket(), Key=row['object_key'], UploadId=row['upload_id']).get('Parts', [])
    except Exception as exc:
        # A prior completion can succeed at R2 while the response/database write fails.
        if getattr(exc, 'response', {}).get('Error', {}).get('Code') != 'NoSuchUpload':
            raise
        stored = api.head_object(Bucket=bucket(), Key=row['object_key'])
        if stored['ContentLength'] != row['byte_size'] or stored['ContentType'] != row['content_type']:
            raise HTTPException(409, 'Stored recording does not match the declared file.') from None
        return
    expected_count = (row['byte_size'] + PART_SIZE - 1) // PART_SIZE
    if len(parts) != expected_count or len(submitted) != expected_count:
        raise HTTPException(409, 'Upload is incomplete. Resume the missing parts.')
    supplied = {p.part_number: p.etag for p in submitted}
    for i, part in enumerate(parts, 1):
        expected_size = min(PART_SIZE, row['byte_size'] - (i - 1) * PART_SIZE)
        if part['PartNumber'] != i or part['Size'] != expected_size or supplied.get(i) != part['ETag']:
            raise HTTPException(409, 'Uploaded parts do not match the declared file. Restart this upload.')
    api.complete_multipart_upload(Bucket=bucket(), Key=row['object_key'], UploadId=row['upload_id'],
        MultipartUpload={'Parts': [{'PartNumber': p['PartNumber'], 'ETag': p['ETag']} for p in parts]})

@storage_operation
def download_url(row):
    return client().generate_presigned_url('get_object', Params={'Bucket': bucket(), 'Key': row['object_key'],
        'ResponseContentDisposition': 'attachment'}, ExpiresIn=120)

@storage_operation
def abort(row):
    if row.get('upload_id'):
        client().abort_multipart_upload(Bucket=bucket(), Key=row['object_key'], UploadId=row['upload_id'])

