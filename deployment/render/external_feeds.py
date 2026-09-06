"""Small cached adapters for public weather, transport and traffic feeds."""
import json
import os
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

_CACHE = {}
_COOLDOWNS = {}
_LOCK = threading.Lock()
_PROVIDER_COOLDOWN_SECONDS = 45


def _json(url, ttl, key):
    now = time.time()
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and cached[0] > now:
            return cached[1]
    request = Request(url, headers={
        'User-Agent': 'DrishtiTransit/1.0 https://drishti-transit-sih-official.pages.dev/',
        'Accept': 'application/json',
    })
    with urlopen(request, timeout=8) as response:
        value = json.loads(response.read().decode('utf-8'))
    with _LOCK:
        _CACHE[key] = (now + ttl, value)
    return value


def _provider_json(provider, url, ttl, key):
    """Call one provider, briefly bypassing it after network/server failure."""
    now = time.time()
    with _LOCK:
        if _COOLDOWNS.get(provider, 0) > now:
            raise RuntimeError(f'{provider} is cooling down')
    try:
        value = _json(url, ttl, key)
    except Exception:
        with _LOCK:
            _COOLDOWNS[provider] = now + _PROVIDER_COOLDOWN_SECONDS
        raise
    with _LOCK:
        _COOLDOWNS.pop(provider, None)
    return value


def weather(latitude=28.65, longitude=77.10):
    params = urlencode({'latitude': latitude, 'longitude': longitude,
        'current': 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
        'daily': 'precipitation_probability_max,precipitation_sum', 'timezone': 'Asia/Kolkata', 'forecast_days': 2})
    try:
        raw = _provider_json('Open-Meteo weather', 'https://api.open-meteo.com/v1/forecast?' + params, 600,
                             ('weather', round(latitude, 2), round(longitude, 2)))
        current = raw.get('current', {})
        daily = raw.get('daily', {})
        return {'provider': 'Open-Meteo', 'fallback': False,
            'latitude': raw.get('latitude'), 'longitude': raw.get('longitude'),
            'temperature_c': current.get('temperature_2m'), 'feels_like_c': current.get('apparent_temperature'),
            'humidity_percent': current.get('relative_humidity_2m'), 'precipitation_mm': current.get('precipitation'),
            'wind_kmh': current.get('wind_speed_10m'), 'weather_code': current.get('weather_code'),
            'rain_probability_percent': (daily.get('precipitation_probability_max') or [None])[0],
            'observed_at': current.get('time'), 'live': True}
    except Exception:
        pass
    try:
        met_url = ('https://api.met.no/weatherapi/locationforecast/2.0/compact?' +
                   urlencode({'lat': latitude, 'lon': longitude}))
        raw = _provider_json('MET Norway weather', met_url, 600,
                             ('weather-met-no', round(latitude, 2), round(longitude, 2)))
        point = raw['properties']['timeseries'][0]
        details = point['data']['instant']['details']
        next_hour = point['data'].get('next_1_hours', {}).get('details', {})
        return {'provider': 'MET Norway', 'fallback': True, 'latitude': latitude, 'longitude': longitude,
            'temperature_c': details.get('air_temperature'), 'feels_like_c': details.get('air_temperature'),
            'humidity_percent': details.get('relative_humidity'),
            'precipitation_mm': next_hour.get('precipitation_amount'),
            'wind_kmh': round(float(details.get('wind_speed', 0)) * 3.6, 1), 'weather_code': None,
            'rain_probability_percent': next_hour.get('probability_of_precipitation'),
            'observed_at': point.get('time'), 'live': True}
    except Exception:
        pass
    raw = _provider_json('wttr.in weather', 'https://wttr.in/Delhi?format=j1', 600,
                         ('weather-wttr', 'Delhi'))
    current = (raw.get('current_condition') or [{}])[0]
    today = (raw.get('weather') or [{}])[0]
    hourly = today.get('hourly') or []
    rain = max((int(row.get('chanceofrain') or 0) for row in hourly), default=None)
    return {'provider': 'wttr.in', 'fallback': True, 'latitude': latitude, 'longitude': longitude,
        'temperature_c': float(current['temp_C']), 'feels_like_c': float(current['FeelsLikeC']),
        'humidity_percent': int(current['humidity']), 'precipitation_mm': float(current['precipMM']),
        'wind_kmh': float(current['windspeedKmph']), 'weather_code': None,
        'rain_probability_percent': rain, 'observed_at': current.get('localObsDateTime'), 'live': True}


def air_quality(latitude=28.65, longitude=77.10):
    params = urlencode({'latitude': latitude, 'longitude': longitude,
        'current': 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone', 'timezone': 'Asia/Kolkata'})
    raw = _provider_json('Open-Meteo air quality',
                'https://air-quality-api.open-meteo.com/v1/air-quality?' + params, 900,
                ('air-quality', round(latitude, 2), round(longitude, 2)))
    current = raw.get('current', {})
    return {'provider': 'Open-Meteo Air Quality', 'attribution': 'CAMS ENSEMBLE via Open-Meteo',
        'latitude': raw.get('latitude'), 'longitude': raw.get('longitude'),
        'us_aqi': current.get('us_aqi'), 'pm2_5': current.get('pm2_5'), 'pm10': current.get('pm10'),
        'nitrogen_dioxide': current.get('nitrogen_dioxide'), 'ozone': current.get('ozone'),
        'observed_at': current.get('time'), 'live': True}


def transit(min_lat=28.45, min_lng=76.90, max_lat=28.88, max_lng=77.35):
    bbox = f'{min_lat},{min_lng},{max_lat},{max_lng}'
    query = f'''[out:json][timeout:20];(way["railway"~"subway|light_rail|rail"]({bbox});node["railway"="station"]({bbox}););out tags geom;'''
    raw = None
    provider = None
    for name, base in (
        ('OpenStreetMap Overpass DE', 'https://overpass-api.de/api/interpreter?'),
        ('OpenStreetMap Overpass Private.coffee', 'https://overpass.private.coffee/api/interpreter?'),
    ):
        try:
            raw = _provider_json(name, base + urlencode({'data': query}), 21600, ('transit', name, bbox))
            provider = name
            break
        except Exception:
            continue
    if raw is None:
        # Never draw invented transit geometry when the community service is busy.
        return {'type': 'FeatureCollection', 'features': [],
        'provider': 'OpenStreetMap Overpass', 'schematic': False, 'live': False,
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
    return {'type': 'FeatureCollection', 'features': features[:1500], 'provider': provider, 'live': True,
            'delhi_bus_gtfs': 'https://otd.delhi.gov.in/', 'realtime_bus_authorized': False}


def traffic(min_lat=28.45, min_lng=76.90, max_lat=28.88, max_lng=77.35):
    api_key = os.environ.get('TOMTOM_TRAFFIC_API_KEY', '')
    if api_key:
        try:
            params = urlencode({'key': api_key, 'bbox': f'{min_lng},{min_lat},{max_lng},{max_lat}',
                'fields': '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},startTime,endTime}}}',
                'language': 'en-GB', 'timeValidityFilter': 'present'})
            raw = _provider_json('TomTom Traffic',
                'https://api.tomtom.com/traffic/services/5/incidentDetails?' + params, 60,
                ('traffic-tomtom', round(min_lat, 2), round(min_lng, 2), round(max_lat, 2), round(max_lng, 2)))
            return {'type': 'FeatureCollection', 'features': raw.get('incidents', []),
                    'provider': 'TomTom Traffic', 'configured': True, 'live': True, 'fallback': False}
        except Exception:
            pass
    here_key = os.environ.get('HERE_TRAFFIC_API_KEY', '')
    if here_key:
        try:
            params = urlencode({'in': f'bbox:{min_lng},{min_lat},{max_lng},{max_lat}',
                                'locationReferencing': 'shape', 'apiKey': here_key})
            raw = _provider_json('HERE Traffic', 'https://data.traffic.hereapi.com/v7/incidents?' + params,
                                 60, ('traffic-here', round(min_lat, 2), round(min_lng, 2),
                                      round(max_lat, 2), round(max_lng, 2)))
            return {'type': 'FeatureCollection', 'features': raw.get('results', []),
                    'provider': 'HERE Traffic', 'configured': True, 'live': True, 'fallback': True}
        except Exception:
            pass
    configured = bool(api_key or here_key)
    return {'type': 'FeatureCollection', 'features': [],
            'provider': 'Delhi Traffic Police advisories', 'configured': configured, 'live': False,
            'advisory_url': 'https://traffic.delhipolice.gov.in/traffic-diversions',
            'notice': ('Licensed traffic providers are temporarily unavailable; official advisories remain available.'
                       if configured else 'Official advisories are available; no licensed live incident feed is configured.')}
