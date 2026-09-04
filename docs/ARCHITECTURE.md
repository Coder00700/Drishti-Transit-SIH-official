# Target architecture

1. Cloudflare serves public pages, the contributor login page and future admin UI.
2. Render serves lightweight application APIs. It does not run training/inference.
3. MongoDB Atlas holds identities, salted password hashes, consent and sessions.
4. A separate cloud PostgreSQL/PostGIS store will serve approved public road
   geometry, assessments, repair progress and highlights through Render.
5. A private local VM trains/fine-tunes YOLO/OmniView and runs video inference.
   Local PostgreSQL/PostGIS holds detailed evidence and candidate road findings.
6. Operators review candidates and publish sanitized, versioned updates through
   a future protected Render ingestion endpoint. The VM initiates the outbound
   connection; no public VM port or tunnel is required for this architecture.

Incoming videos are analysed, not automatically added to training. Training needs
permission-cleared annotations and independently held-out evaluation footage.
Select approximately 2–3 recordings of the same road section for corroboration;
agreement alone is not proof of accuracy. Align video timestamps and GPS. Never
invent coordinates for internet recordings with no verified location.

The future map combines observations into road-aligned stretches (potentially
100–200 m for continuous damage) with defined gap/direction/coverage rules.
Compute distance/grid sizes in a suitable metric CRS; publish EPSG:4326 GeoJSON.
Store model version, confidence meaning, timestamps, evidence provenance and
human confirmation/rejection. Grey/unobserved roads are not certified safe.

Public updates exclude raw video/GPS tracks, plates, owners, RCs, private source
IDs and secret Drive access links. Work progress and government project highlights
are human-reviewed administrative records, not AI-generated verified facts.

Future locality administrators must be scoped in API authorization, not just UI
filters. Each area's two admin slots need individual credentials, auditable
actions, strong authentication and no shared demo passwords in production.

Reserved worker routes currently return 503 and are not exposed by the public
gateway. They need dedicated worker authentication, idempotency/replay controls,
consent checks, leases/retries, schema validation and publication approval before
enablement. Do not reuse the Cloudflare gateway secret for worker publication.

The last published cloud data should remain available when the laptop is offline.
The local working database and cloud serving database are separate. Do not
expose PostgreSQL directly to browsers or silently dual-write identity stores.
