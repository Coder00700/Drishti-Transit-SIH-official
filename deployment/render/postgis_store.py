"""Public, read-only PostGIS map store with an optional OSM demo bootstrap.

The geometry imported from OpenStreetMap is real reference geometry.  Severity
values are deterministic synthetic demo values and are always labelled as such.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DELHI_BBOX = (76.84, 28.40, 77.35, 28.89)
_BOOTSTRAP_LOCK = threading.Lock()
_BOOTSTRAP_STARTED = False


def enabled() -> bool:
    return bool(os.environ.get("DATABASE_URL", "").strip())


def _driver():
    import psycopg
    from psycopg.rows import dict_row
    return psycopg, dict_row


def _connection():
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn.startswith(("postgres://", "postgresql://")):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL TLS connection URI.")
    psycopg, dict_row = _driver()
    return psycopg.connect(dsn, row_factory=dict_row, connect_timeout=8,
                           options="-c statement_timeout=15000")


def ensure_schema() -> None:
    if not enabled():
        return
    with _connection() as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS public_map_features (
                id text PRIMARY KEY,
                feature_kind text NOT NULL CHECK (feature_kind IN ('ROAD','TRANSIT')),
                name text NOT NULL,
                road_class text,
                data_mode text NOT NULL CHECK (data_mode IN ('REFERENCE','DEMO','VERIFIED')),
                severity text CHECK (severity IN ('LOW','MODERATE','HIGH','CRITICAL')),
                confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
                source text NOT NULL,
                source_url text,
                observed_at timestamptz,
                properties jsonb NOT NULL DEFAULT '{}'::jsonb,
                geometry geometry(Geometry,4326) NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS public_map_features_geometry_gist ON public_map_features USING gist (geometry)")
        conn.execute("CREATE INDEX IF NOT EXISTS public_map_features_mode_kind ON public_map_features (data_mode, feature_kind)")


def _bounds(values: dict) -> tuple[float, float, float, float]:
    try:
        result = tuple(float(values.get(key, fallback)) for key, fallback in zip(
            ("minLng", "minLat", "maxLng", "maxLat"), DELHI_BBOX))
    except (TypeError, ValueError):
        raise ValueError("Invalid map bounds.") from None
    min_lng, min_lat, max_lng, max_lat = result
    if not (DELHI_BBOX[0] - .2 <= min_lng < max_lng <= DELHI_BBOX[2] + .2 and
            DELHI_BBOX[1] - .2 <= min_lat < max_lat <= DELHI_BBOX[3] + .2):
        raise ValueError("Map bounds are outside the Delhi service area.")
    return result


def features(values: dict, data_mode: str, limit: int = 700) -> dict:
    min_lng, min_lat, max_lng, max_lat = _bounds(values)
    limit = min(max(int(limit), 1), 1000)
    with _connection() as conn:
        rows = list(conn.execute("""
            SELECT id, name, road_class, data_mode, severity, confidence, source,
                   source_url, observed_at, properties, ST_AsGeoJSON(geometry)::json AS geometry
            FROM public_map_features
            WHERE feature_kind='ROAD' AND data_mode=%s
              AND geometry && ST_MakeEnvelope(%s,%s,%s,%s,4326)
            ORDER BY id LIMIT %s
        """, (data_mode, min_lng, min_lat, max_lng, max_lat, limit + 1)).fetchall())
    truncated = len(rows) > limit
    output = []
    for row in rows[:limit]:
        props = dict(row.get("properties") or {})
        props.update({key: row.get(key) for key in
                      ("id", "name", "road_class", "data_mode", "severity", "confidence",
                       "source", "source_url", "observed_at")})
        if props.get("observed_at"):
            props["observed_at"] = props["observed_at"].isoformat()
        output.append({"type": "Feature", "geometry": row["geometry"], "properties": props})
    return {"type": "FeatureCollection", "features": output, "truncated": truncated,
            "data_mode": data_mode, "source": "Aiven PostgreSQL/PostGIS"}


def summary() -> dict:
    with _connection() as conn:
        rows = conn.execute("""
            SELECT data_mode, count(*) AS count
            FROM public_map_features WHERE feature_kind='ROAD' GROUP BY data_mode
        """).fetchall()
        updated = conn.execute("SELECT max(updated_at) AS value FROM public_map_features").fetchone()["value"]
    return {"counts": {row["data_mode"]: row["count"] for row in rows},
            "updated_at": updated.isoformat() if updated else None,
            "store": "Aiven PostgreSQL/PostGIS"}


def _synthetic_severity(identifier: str) -> tuple[str, float]:
    value = int(hashlib.sha256(identifier.encode()).hexdigest()[:8], 16) % 100
    if value < 12:
        return "HIGH", .88
    if value < 42:
        return "MODERATE", .76
    return "LOW", .69


def _download_osm() -> list[dict]:
    min_lng, min_lat, max_lng, max_lat = DELHI_BBOX
    bbox = f"{min_lat},{min_lng},{max_lat},{max_lng}"
    query = (f'[out:json][timeout:60];way["highway"~"motorway|trunk|primary|secondary|tertiary"]'
             f'({bbox});out tags geom;')
    payload = urlencode({"data": query}).encode()
    last_error = None
    for endpoint in ("https://overpass-api.de/api/interpreter",
                     "https://overpass.kumi.systems/api/interpreter"):
        try:
            request = Request(endpoint, data=payload,
                              headers={"User-Agent": "DrishtiTransit-SIH-demo/1.0"})
            with urlopen(request, timeout=75) as response:
                return json.loads(response.read().decode("utf-8")).get("elements", [])
        except Exception as exc:
            last_error = exc
    raise RuntimeError("OpenStreetMap import is temporarily unavailable.") from last_error


def bootstrap_osm_demo() -> dict:
    """Idempotently populate real OSM geometry with synthetic demo condition labels."""
    elements = _download_osm()
    prepared = []
    observed = datetime.now(timezone.utc)
    for item in elements:
        coords = [[p.get("lon"), p.get("lat")] for p in item.get("geometry", [])]
        if len(coords) < 2 or any(None in pair for pair in coords):
            continue
        tags = item.get("tags") or {}
        identifier = f'osm-way-{item.get("id")}'
        severity, confidence = _synthetic_severity(identifier)
        prepared.append((identifier, tags.get("name") or "Unnamed major road",
                         tags.get("highway"), severity, confidence,
                         "OpenStreetMap geometry + synthetic Drishti severity",
                         f'https://www.openstreetmap.org/way/{item.get("id")}', observed,
                         json.dumps({"synthetic": True, "osm_way_id": item.get("id"),
                                     "disclaimer": "Real OSM geometry; synthetic demo severity—not a field assessment."}),
                         json.dumps({"type": "LineString", "coordinates": coords})))
    with _connection() as conn:
        with conn.cursor() as cur:
            cur.executemany("""
                INSERT INTO public_map_features
                    (id,feature_kind,name,road_class,data_mode,severity,confidence,source,
                     source_url,observed_at,properties,geometry,updated_at)
                VALUES (%s,'ROAD',%s,%s,'DEMO',%s,%s,%s,%s,%s,%s,
                        ST_SetSRID(ST_GeomFromGeoJSON(%s),4326),now())
                ON CONFLICT (id) DO UPDATE SET name=excluded.name, road_class=excluded.road_class,
                    severity=excluded.severity, confidence=excluded.confidence,
                    source=excluded.source, source_url=excluded.source_url,
                    observed_at=excluded.observed_at, properties=excluded.properties,
                    geometry=excluded.geometry, updated_at=now()
            """, prepared)
    return {"imported": len(prepared), "mode": "DEMO", "geometry": "OpenStreetMap",
            "severity": "synthetic"}


def _bootstrap_worker() -> None:
    try:
        ensure_schema()
        with _connection() as conn:
            count = conn.execute("SELECT count(*) AS value FROM public_map_features WHERE data_mode='DEMO'").fetchone()["value"]
        if count < 500:
            bootstrap_osm_demo()
    except Exception:
        # The public API stays available; /status exposes whether data arrived.
        return


def start_bootstrap() -> None:
    global _BOOTSTRAP_STARTED
    if not enabled() or os.environ.get("POSTGIS_DEMO_BOOTSTRAP", "true") != "true":
        return
    with _BOOTSTRAP_LOCK:
        if _BOOTSTRAP_STARTED:
            return
        _BOOTSTRAP_STARTED = True
    threading.Thread(target=_bootstrap_worker, name="postgis-demo-bootstrap", daemon=True).start()
