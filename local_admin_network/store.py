import os
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import urlsplit

WARD_SOURCE = 'https://mcdonline.nic.in/portal/downloadFile/mcd_map_full_zone_image_cd_23030712390030_230322122342342.pdf'

def ward(area_id, name, parent_id, number):
    return {'id': area_id, 'name': name, 'level': 'LOCAL', 'parent_id': parent_id,
            'official_reference': {'type': 'MCD_WARD_2022', 'ward_number': number, 'url': WARD_SOURCE}}

AREAS = [
    {'id': 'delhi', 'name': 'Delhi', 'level': 'GLOBAL', 'parent_id': None,
     'designation': 'DRISHTI_PROJECT_AUTHORITY'},
    {'id': 'west-delhi', 'name': 'West Delhi coverage zone', 'level': 'DISTRICT', 'parent_id': 'delhi',
     'designation': 'PROJECT_COVERAGE_ZONE'},
    {'id': 'east-delhi', 'name': 'East Delhi coverage zone', 'level': 'DISTRICT', 'parent_id': 'delhi',
     'designation': 'PROJECT_COVERAGE_ZONE'},
    {'id': 'south-delhi', 'name': 'South Delhi coverage zone', 'level': 'DISTRICT', 'parent_id': 'delhi',
     'designation': 'PROJECT_COVERAGE_ZONE'},
    {'id': 'north-delhi', 'name': 'North Delhi coverage zone', 'level': 'DISTRICT', 'parent_id': 'delhi',
     'designation': 'PROJECT_COVERAGE_ZONE'},
    # West: 15 consecutive official West Zone wards, plus the two original pilot localities.
    *[ward(i, n, 'west-delhi', w) for i, n, w in [
        ('punjabi-bagh','Punjabi Bagh',92),('madipur','Madipur',93),('raghubir-nagar','Raghubir Nagar',94),
        ('vishnu-garden','Vishnu Garden',95),('rajouri-garden','Rajouri Garden',96),
        ('chaukhandi-nagar','Chaukhandi Nagar',97),('subhash-nagar','Subhash Nagar',98),
        ('hari-nagar','Hari Nagar',99),('fateh-nagar','Fateh Nagar',100),('tilak-nagar','Tilak Nagar',101),
        ('khyala','Khyala',102),('keshopur','Keshopur',103),('janakpuri-south','Janakpuri South',104),
        ('mahavir-enclave-west','Mahaveer Enclave',105),('janakpuri-west','Janakpuri West',106)]],
    ward('nangloi','Nangloi','west-delhi',34), ward('uttam-nagar','Uttam Nagar','west-delhi',115),
    # East: 15 consecutive Shahdara South Zone wards.
    *[ward(i, n, 'east-delhi', w) for i, n, w in [
        ('new-ashok-nagar','New Ashok Nagar',190),('mayur-vihar-1','Mayur Vihar Phase I',191),
        ('trilokpuri','Trilokpuri',192),('kondli','Kondli',193),('gharoli','Gharoli',194),
        ('kalyanpuri','Kalyanpuri',195),('mayur-vihar-2','Mayur Vihar Phase II',196),
        ('patparganj','Patparganj',197),('vinod-nagar','Vinod Nagar',198),('mandawali','Mandawali',199),
        ('pandav-nagar','Pandav Nagar',200),('lalita-park','Lalita Park',201),('shakarpur','Shakarpur',202),
        ('laxmi-nagar','Laxmi Nagar',203),('preet-vihar','Preet Vihar',204)]],
    # South: 15 consecutive official South Zone wards.
    *[ward(i, n, 'south-delhi', w) for i, n, w in [
        ('hauz-khas','Hauz Khas',148),('malviya-nagar','Malviya Nagar',149),('green-park','Green Park',150),
        ('munirka','Munirka',151),('rk-puram','R.K. Puram',152),('vasant-vihar','Vasant Vihar',153),
        ('lado-sarai','Lado Sarai',154),('mehrauli','Mehrauli',155),('vasant-kunj','Vasant Kunj',156),
        ('aya-nagar','Aya Nagar',157),('bhati','Bhati',158),('chhatarpur','Chhatarpur',159),
        ('said-ul-ajaib','Said-ul-Ajaib',160),('deoli','Deoli',161),('tigri','Tigri',162)]],
    # North: 15 consecutive Narela/Civil Line wards from the official map.
    *[ward(i, n, 'north-delhi', w) for i, n, w in [
        ('narela','Narela',1),('bankner','Bankner',2),('holambi-kalan','Holambi Kalan',3),
        ('alipur','Alipur',4),('bakhtawarpur','Bakhtawarpur',5),('burari','Burari',6),
        ('kadipur','Kadipur',7),('mukundpur','Mukundpur',8),('sant-nagar','Sant Nagar',9),
        ('jharoda','Jharoda',10),('timarpur','Timarpur',11),('malka-ganj','Malka Ganj',12),
        ('mukherjee-nagar','Mukherjee Nagar',13),('dhirpur','Dhirpur',14),('adarsh-nagar','Adarsh Nagar',15)]],
]
# Operating jurisdictions, not a claim about official revenue-district boundaries.

def now():
    return datetime.now(timezone.utc)

@lru_cache(maxsize=1)
def database():
    from pymongo import MongoClient
    uri = os.environ.get('AUTHORITY_MONGODB_URI') or os.environ.get('MONGODB_URI', '')
    parsed = urlsplit(uri)
    local = (parsed.scheme == 'mongodb' and parsed.hostname in ('localhost', '127.0.0.1', '::1')
             and ',' not in parsed.netloc and not os.environ.get('RENDER'))
    if not uri.startswith('mongodb+srv://') and not local:
        raise RuntimeError('Configure the authority MongoDB connection privately.')
    return MongoClient(uri, tls=not local, serverSelectionTimeoutMS=5000,
                       connectTimeoutMS=5000, socketTimeoutMS=10000,
                       maxPoolSize=10, tz_aware=True)[os.environ.get('AUTHORITY_DATABASE', 'DrishtiAuthority')]

def setup(db):
    for name in ('admins', 'sessions', 'limits', 'content', 'imports', 'roads', 'publications',
                 'evidence', 'audit', 'areas', 'vehicles', 'transfer_jobs', 'storage_policy',
                 'admin_invites', 'local_admin_slots', 'report_requests', 'research_queue',
                 'demo_seed_runs'):
        if name not in db.list_collection_names():
            db.create_collection(name)
    for area in AREAS:
        db.areas.update_one({'_id': area['id']}, {'$set': area}, upsert=True)
    db.admins.create_index('secure_id', unique=True)
    db.admins.create_index([('area_id', 1), ('slot', 1)], unique=True)
    db.sessions.create_index('expires_at', expireAfterSeconds=0)
    db.limits.create_index('expires_at', expireAfterSeconds=0)
    db.content.create_index([('area_id', 1), ('kind', 1), ('publication', 1)])
    db.imports.create_index([('area_id', 1), ('checksum', 1)], unique=True)
    db.roads.create_index([('batch_id', 1), ('road_id', 1)], unique=True)
    db.roads.create_index([('geometry', '2dsphere')])
    db.evidence.create_index([('area_id', 1), ('status', 1), ('created_at', -1)])
    db.audit.create_index([('area_id', 1), ('at', -1)])
    db.vehicles.create_index('vehicle_id', unique=True)
    db.transfer_jobs.create_index([('state', 1), ('updated_at', 1)])
    db.admin_invites.create_index([('area_id', 1), ('slot', 1)], unique=True)
    db.local_admin_slots.create_index([('area_id', 1), ('slot', 1)], unique=True)
    db.report_requests.create_index([('area_id', 1), ('status', 1)])
    db.research_queue.create_index([('area_id', 1), ('source_url', 1)], unique=True)
    db.demo_seed_runs.create_index('dataset_id', unique=True)

def areas_for(admin):
    known = {x['id']: x for x in AREAS}
    allowed = {admin['area_id']}
    for _ in AREAS:
        allowed.update(x['id'] for x in known.values() if x['parent_id'] in allowed)
    return allowed

def clean(row):
    return {k: v for k, v in row.items() if k != '_id'}

