# Drishti Transit (SIH-official)

Clean deployment source for the Drishti Transit SIH project. This is an independent
student prototype, **not a government-operated service or claim of official affiliation**.

**Release status:** ready to configure and deploy as a restricted account/basemap
pilot. It is not a completed road-management production release.

## Public and private boundaries

This **GitHub repository is private**. Both Cloudflare and Render may deploy from
the same private repository. A private repository does not make a deployed website
private; application authentication and authorization determine data access.

| Component | Audience | Hosting |
|---|---|---|
| Homepage and street/satellite basemap | Public visitors | Cloudflare Pages |
| Login page and contributor account UI | Page is visible; account data requires login | Cloudflare Pages + protected Render API |
| Account/session/consent/OTP API | Authenticated users, owner-scoped data | Render |
| Contributor identity documents | No direct browser access | MongoDB Atlas, `Users.login` |
| Public road geometry and reviewed results | Future approved publication only | Future cloud PostgreSQL/PostGIS + Render APIs |
| Locality admin operations | Future authenticated, locality-scoped administrators | Future Render APIs + Cloudflare UI |
| Training, model weights, raw video/GPS and local review workspace | Local operators only | Local VM; excluded from this repository |

## Source layout

```
frontend/                    React website source; cloud build disables local-only features
deployment/cloudflare/       Pages build + same-origin protected API gateway
deployment/render/           independent lightweight FastAPI/MongoDB account service
docs/DEPLOY.md               exact host settings and release checks
docs/ARCHITECTURE.md         target local-AI/cloud-publication architecture
scripts/check_release.mjs   local/CI source hygiene check
```

The old backend, local PostgreSQL configuration, recordings, account imports and
AI packages are not included. The Render entry point imports only its own modules.
Frontend source retains some dormant local-pilot components for compatibility;
the cloud build removes their routes/controls. They do not imply enabled cloud APIs.

## Working now

- MongoDB account login, password hashing, owner-only profile, session expiry,
  logout, consent, withdrawal, deletion requests and real-provider OTP adapter.
- Unique contact indexes, temporary-record expiry indexes and bounded login attempts.
- Fixed-upstream Cloudflare API gateway, same-origin session cookies, CSRF/origin
  checks and JSON/body limits. No generic proxy, admin route or upload gateway.
- Public homepage and basemaps with honest empty/unconnected states.
- 25 isolated account/security tests, 6 gateway tests and 3 frontend tests.

## Intentionally not enabled

Cloud PostGIS road overlays, reviewed AI publication, admin-desk authorization,
repair progress/highlight publishing, contributor vehicles/RC/media/Drive
integration, real OTP delivery configuration and account recovery remain release
work. Existing local roads/results are not copied automatically.

`ALLOW_REGISTRATION=false` by default. Do not open enrollment until OTP, privacy
contacts, retention/erasure, backups, abuse protections and hosted security checks
are complete. No government verification or completed model quality is claimed.

## Deploy

Follow [docs/DEPLOY.md](docs/DEPLOY.md). Cloudflare root is
`deployment/cloudflare`, build `npm run build`, output `build`. Render runs from
repository root with `deployment.render.cloud_api:app`. MongoDB credentials go
only into Render's secret settings, never frontend or Cloudflare settings.

The repository does not contain working passwords, a connection URI or a gateway
secret. Supply these privately in your hosting dashboards. No website deployment
is performed simply by uploading this source repository.

## Local checks

Use Python 3.14 and Node 22 or a compatible newer Node version:

```text
python -m pip install -r deployment/render/requirements-test.txt
python -B -m unittest discover -s deployment/render/tests -q
node --test deployment/cloudflare/tests/*.test.mjs
node scripts/check_release.mjs
```

Install frontend dependencies with `npm ci` inside `frontend/`, then run
`npm run check`, `npm test`, and `npm run build`.

The cloud package is built using `npm run build` inside `deployment/cloudflare/`.
Build from a fresh checkout. The packager deliberately refuses to overwrite an
existing output directory, preventing accidental inclusion of stale assets.
