"""Small cached adapters for public weather, transport and traffic feeds."""
import json
import os
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

_CACHE = {}
_LOCK = threading.Lock()


def _json(url, ttl, key):
    now = time.time()
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and cached[0] > now:
            return cached[1]
    request = Request(url, headers={'User-Agent': 'DrishtiTransit/1.0 public prototype'})
    with urlopen(request, timeout=8) as response:
        value = json.loads(response.read().decode('utf-8'))
    with _LOCK:
        _CACHE[key] = (now + ttl, value)
    return value


def weather(latitude=28.65, longitude=77.10):
    params = urlencode({'latitude': latitude, 'longitude': longitude,
        'current': 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
        'daily': 'precipitation_probability_max,precipitation_sum', 'timezone': 'Asia/Kolkata', 'forecast_days': 2})
    raw = _json('https://api.open-meteo.com/v1/forecast?' + params, 600,
                ('weather', round(latitude, 2), round(longitude, 2)))
    current = raw.get('current', {})
    daily = raw.get('daily', {})
    return {'provider': 'Open-Meteo', 'latitude': raw.get('latitude'), 'longitude': raw.get('longitude'),
        'temperature_c': current.get('temperature_2m'), 'feels_like_c': current.get('apparent_temperature'),
        'humidity_percent': current.get('relative_humidity_2m'), 'precipitation_mm': current.get('precipitation'),
        'wind_kmh': current.get('wind_speed_10m'), 'weather_code': current.get('weather_code'),
        'rain_probability_percent': (daily.get('precipitation_probability_max') or [None])[0],
        'observed_at': current.get('time'), 'live': True}


def transit(min_lat=28.45, min_lng=76.90, max_lat=28.88, max_lng=77.35):
    bbox = f'{min_lat},{min_lng},{max_lat},{max_lng}'
    query = f'''[out:json][timeout:20];(way["railway"~"subway|light_rail|rail"]({bbox});node["railway"="station"]({bbox}););out tags geom;'''
    url = 'https://overpass-api.de/api/interpreter?' + urlencode({'data': query})
    try:
        raw = _json(url, 21600, ('transit', bbox))
    except Exception:
        # Never draw invented transit geometry when the community service is busy.
        return {'type': 'FeatureCollection', 'features': [],
        'provider': 'OpenStreetMap Overpass', 'schematic': False,
        'notice': 'Transit geometry is temporarily unavailable; no approximate lines are drawn.',
        'delhi_bus_gtfs': 'https://otd.delhi.gov.in/', 'realtime_bus_authorized': False}
    features = []
    for item in raw.get('elements', []):
        tags = item.get('tags', {})
        if item.get('type') == 'node':
            geometry = {'type': 'Point', 'coordinates': [item.get('lon'), item.get('lat')]}
        else:
            coords = [[point['lon'], point['lat']] for point in item.get('geometry', [])]
            if len(coords) < 2:
                continue
            geometry = {'type': 'LineString', 'coordinates': coords}
        features.append({'type': 'Feature', 'geometry': geometry, 'properties': {
            'id': str(item.get('id')), 'name': tags.get('name') or tags.get('name:en') or 'Rail corridor',
            'railway': tags.get('railway'), 'operator': tags.get('operator'), 'source': 'OpenStreetMap'}})
    return {'type': 'FeatureCollection', 'features': features[:1500], 'provider': 'OpenStreetMap Overpass',
            'delhi_bus_gtfs': 'https://otd.delhi.gov.in/', 'realtime_bus_authorized': False}


def traffic(min_lat=28.45, min_lng=76.90, max_lat=28.88, max_lng=77.35):
    api_key = os.environ.get('TOMTOM_TRAFFIC_API_KEY', '')
    if not api_key:
        return {'type': 'FeatureCollection', 'features': [], 'provider': 'TomTom Traffic',
                'configured': False, 'notice': 'Traffic provider key is not configured.'}
    params = urlencode({'key': api_key, 'bbox': f'{min_lng},{min_lat},{max_lng},{max_lat}',
        'fields': '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},startTime,endTime}}}',
        'language': 'en-GB', 'timeValidityFilter': 'present'})
    raw = _json('https://api.tomtom.com/traffic/services/5/incidentDetails?' + params, 60,
                ('traffic', round(min_lat, 2), round(min_lng, 2), round(max_lat, 2), round(max_lng, 2)))
    return {'type': 'FeatureCollection', 'features': raw.get('incidents', []),
            'provider': 'TomTom Traffic', 'configured': True}
