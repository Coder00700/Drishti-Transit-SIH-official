"""Bounded JSON/GeoJSON/CSV conversion. SQL and arbitrary executable formats are rejected."""
import csv
import io
import json
import math
from pathlib import PurePath
from fastapi import HTTPException

def point(value):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError('Use WGS84 [longitude, latitude] coordinates.')
    if any(isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) for x in value):
        raise ValueError('Coordinates must be finite numbers.')
    if not (-180 <= value[0] <= 180 and -90 <= value[1] <= 90):
        raise ValueError('Coordinates are outside WGS84 bounds.')
    return value

def geometry(value):
    if not isinstance(value, dict) or set(value) != {'type', 'coordinates'}:
        raise ValueError('Geometry needs only type and coordinates.')
    kind, coordinates = value['type'], value['coordinates']
    if kind == 'Point':
        point(coordinates)
    elif kind == 'LineString':
        if not isinstance(coordinates, list) or not 2 <= len(coordinates) <= 2000:
            raise ValueError('A road line requires 2–2000 coordinate pairs.')
        for p in coordinates:
            point(p)
        if len({tuple(p) for p in coordinates}) < 2:
            raise ValueError('A road stretch needs distinct points.')
    else:
        raise ValueError('This import supports Point and LineString geometry only.')
    return value

def parse(filename, content):
    try:
        extension = PurePath(filename).suffix.lower()
        if extension == '.csv':
            rows = list(csv.DictReader(io.StringIO(content)))
        elif extension in ('.json', '.geojson'):
            data = json.loads(content)
            if isinstance(data, dict) and data.get('type') == 'FeatureCollection':
                if data.get('crs'):
                    raise ValueError('Reproject to WGS84 before export; custom CRS is not accepted.')
                rows = []
                for feature in data['features']:
                    if feature.get('type') != 'Feature':
                        raise ValueError('Expected GeoJSON Features.')
                    rows.append({**feature['properties'], 'geometry': feature['geometry']})
            else:
                rows = data
        else:
            raise ValueError('Use .geojson, .json or .csv. Export SQL/PostGIS as GeoJSON first.')
        if not isinstance(rows, list) or not 1 <= len(rows) <= 1000:
            raise ValueError('Each batch must contain 1–1000 road observations.')
        result, seen = [], set()
        for index, row in enumerate(rows):
            allowed = {'road_id', 'geometry', 'latitude', 'longitude', 'severity', 'confidence', 'model_version', 'observed_at'}
            if not isinstance(row, dict) or set(row) - allowed:
                raise ValueError(f'Row {index + 1}: unexpected fields. Keep private evidence out of road exports.')
            road_id = str(row['road_id']).strip()
            if not road_id or len(road_id) > 100 or road_id in seen:
                raise ValueError('Road IDs must be unique, nonempty and at most 100 characters.')
            seen.add(road_id)
            geo = row.get('geometry')
            if isinstance(geo, str):
                geo = json.loads(geo)
            if geo is None:
                geo = {'type': 'Point', 'coordinates': [float(row['longitude']), float(row['latitude'])]}
            confidence = float(row['confidence'])
            if not math.isfinite(confidence) or not 0 <= confidence <= 1:
                raise ValueError('Confidence must be between 0 and 1.')
            severity = row['severity']
            if severity not in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL'):
                raise ValueError('Severity must be LOW, MODERATE, HIGH or CRITICAL.')
            from datetime import datetime, timezone
            observed = datetime.fromisoformat(str(row['observed_at']).replace('Z', '+00:00'))
            if observed.tzinfo is None or observed > datetime.now(timezone.utc):
                raise ValueError('Observation time must include a timezone and cannot be in the future.')
            model = str(row['model_version']).strip()
            if not 1 <= len(model) <= 100:
                raise ValueError('Supply the model version.')
            result.append({'road_id': road_id, 'geometry': geometry(geo), 'severity': severity,
                           'confidence': confidence, 'model_version': model, 'observed_at': observed})
        return result
    except (ValueError, KeyError, TypeError, AttributeError, OverflowError, csv.Error) as exc:
        raise HTTPException(422, str(exc)[:250]) from None

