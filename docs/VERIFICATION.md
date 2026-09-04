# Release verification

Checked locally on 2026-09-04 against this clean source snapshot:

| Check | Result |
|---|---|
| Standalone cloud API and local-boundary unit tests | 25 passed |
| Cloudflare gateway tests | 6 passed |
| Frontend tests | 3 passed |
| Frontend TypeScript checks | Passed |
| Fresh locked frontend dependency install | Passed |
| Cloud-mode frontend build and Pages packaging | Passed |
| Source hygiene and staged whitespace checks | Passed |
| Private local credential/account-value comparison | No matches in staged source |
| Online dependency vulnerability audit | Not verified: registry endpoint timed out |

Python tests used the existing local dependency environment, but ran from this
standalone checkout. The tests assert that the cloud entry point does not import
the old backend. They do not prove a fresh Render dependency installation or a
live cloud deployment. The frontend was installed afresh from its lockfile.

Security tests use isolated test data, not production account changes. The source
scan is a basic safeguard, not a full independent security audit. Re-run online
dependency auditing (including Python dependencies) before public deployment.

No Cloudflare/Render service was published during preparation. Hosted TLS,
secrets, MongoDB network access, live OTP, two-account isolation, load behavior,
backups and recovery must be verified after hosting configuration. Keep public
registration closed until the gates in [DEPLOY.md](DEPLOY.md) are satisfied.

Cloud PostGIS publication, locality administration, media workflows and AI
integration remain separate unfinished features; passing these checks does not
make those features operational.
