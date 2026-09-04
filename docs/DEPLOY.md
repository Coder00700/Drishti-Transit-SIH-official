# Cloudflare + Render deployment

This repository deploys an account/basemap pilot, not the unfinished local AI app.
Do not publish real contributor enrollment until the release checks below pass.

## 1. MongoDB and credentials

Use the existing `Users.login` account collection. Do not re-import existing
accounts. The project operator has already tested local Atlas login and indexes;
verify that the cloud runtime credential has the following restricted access:

| Collection | Runtime permissions |
|---|---|
| `Users.login` | find, insert, update, listIndexes |
| `Users.sessions` | find, insert, remove |
| `Users.rate_limits` | find, insert, update |
| `Users.otp` | find, insert, update, remove |

Use Atlas custom collection-scoped roles, without broader inherited roles. The
setup operator needs createIndex/listIndexes and any required collection creation
rights. Runtime login cannot use a read-only credential because sessions and
rate limits must be written. Future public road readers need separate credentials.

For a fresh database only, copy `deployment/render/.env.example` to `.env` in the
same directory, fill it privately, and run from repository root:

```text
python -m pip install -r deployment/render/requirements.txt
python -m deployment.render.setup_mongo
```

This creates unique email/phone indexes and expiry indexes. Duplicate existing
data requires review; never drop the safeguards to bypass an error. Optional
`--create-account` prompts privately for a contributor account. It does not grant
administrator privileges or mark contacts/consent verified.

Rotate all credentials previously shared in chat. Enable MFA on hosting/source
accounts. Never commit `.env`, `.dev.vars`, imports, RCs, recordings or passwords.

## 2. Cloudflare Pages

Connect this private GitHub repository under Workers & Pages → Create application
→ Pages → Connect to Git. Grant access only to the intended repository.

| Setting | Value |
|---|---|
| Framework | None |
| Production branch | `main` |
| Root directory | `deployment/cloudflare` |
| Build command | `npm run build` |
| Output directory | `build` |
| Build variable | `NODE_VERSION=22` |

The first build serves the UI with explicit API setup errors. Record the actual
HTTPS Pages origin without a trailing slash. Only `/api/*` invokes the gateway;
static content stays on the CDN. Do not enable production secrets for previews.

## 3. Render web service

Connect the same private repository. Use Python runtime and the Free plan only
for a limited demo. Leave Root Directory empty (repository root).

Build command:

```text
pip install -r deployment/render/requirements.txt
```

Start command:

```text
python -m uvicorn deployment.render.cloud_api:app --host 0.0.0.0 --port $PORT --no-access-log --no-proxy-headers
```

Health path: `/health`. `.python-version` chooses Python 3.14's supported patch.
Optional Blueprint configuration is `deployment/render/render.yaml`.

Add privately in Render's Environment settings:

| Name | Value |
|---|---|
| `MONGODB_URI` | Rotated runtime Atlas database credential |
| `MONGODB_DATABASE` | `Users` |
| `MONGODB_LOGIN_COLLECTION` | `login` |
| `PORTAL_ORIGIN` | Exact production HTTPS Pages/custom-domain origin; no trailing slash |
| `EDGE_SHARED_SECRET` | New random secret, at least 32 characters |
| `ALLOW_REGISTRATION` | `false` |

Keep `DRISHTI_LOCAL_MONGO` unset. Never use `deployment.render.local_server` as the
hosted start command. That development profile is explicitly rejected on Render.

Open the Render service's Connect → Outbound tab. Add all its displayed outbound
IP ranges to Atlas Network Access. Do not default to allowing the entire internet.
Retry deployment after allowlisting if the initial startup failed. Missing
configuration, database access or indexes deliberately prevent startup.

## 4. Connect Cloudflare to Render

In Pages production Variables and Secrets, configure:

| Name | Value |
|---|---|
| `RENDER_API_ORIGIN` | Actual `https://YOUR-SERVICE.onrender.com` origin |
| `EDGE_SHARED_SECRET` | Same secret as Render, stored as a secret |

Redeploy Pages after saving. Never add the Mongo URI to Cloudflare or a `VITE_`
variable. The gateway only permits the configured Render origin and approved
public/account routes; admin, worker, old operations and file uploads are denied.
Changing to a custom website domain requires updating Render `PORTAL_ORIGIN`.

## 5. Validate before opening enrollment

- Homepage, direct deep links, login and privacy pages load over HTTPS.
- Street/satellite tiles display attribution; road overlays/AI are clearly
  marked unconnected. `/admin` is unavailable in the cloud build.
- Login, profile, reload, logout and session expiry work with the imported account.
- Cookies are Secure/HttpOnly/SameSite=Strict; CSRF and exact-Origin checks work.
- Direct Render private API calls without the gateway secret are rejected.
- Browser bundles contain no credentials; private responses are not cached.
- Test two-account isolation, bounded requests, rate limits and deletion requests.
- Configure real SMS/email OTP, operator contact, retention/erasure, backups,
  account recovery and operational alerts before changing registration to true.
- Run dependency/vulnerability and secret audits, then hosted load/security tests.

OTP server settings are `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_VERIFY_SERVICE_SID`, and `TWILIO_VERIFY_EMAIL_ENABLED=true` after email
delivery setup. Provider trials/costs apply. No default OTP or RTO verification
bypass is provided.

Render Free sleeps after 15 idle minutes and may take about a minute to wake.
Its disk is ephemeral: never store files or a database there. Free-tier hosting
does not guarantee production uptime, scaling or unlimited usage. Large video
transfers and local AI processing are not part of this deployment.

Official references: [Cloudflare Pages](https://developers.cloudflare.com/pages/get-started/git-integration/),
[Cloudflare secrets](https://developers.cloudflare.com/pages/functions/bindings/),
[Render FastAPI](https://render.com/docs/deploy-fastapi),
[Render IP ranges](https://render.com/docs/outbound-ip-addresses),
[Render Free limits](https://render.com/docs/free),
[Atlas roles](https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/).
