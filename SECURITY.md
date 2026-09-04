# Security boundary and reporting

Keep this source repository private unless the owner explicitly chooses otherwise.
Public website assets are visible to visitors; never treat bundled values as secrets.
Protected account data lives only in server-side MongoDB collections. A private
repository is not a substitute for authentication, authorization or TLS.

Do not file public issues containing credentials, account data, RC documents,
raw GPS, footage, cookies or exploit evidence exposing users. Report suspected
vulnerabilities privately to the repository owner through an agreed secure channel.
A formal reporting contact must be set before public enrollment.

No production security certification is claimed. Registration remains closed by
default. OTP delivery, account recovery, erasure/retention and backup procedures,
dependency review, abuse controls and actual hosted checks are release gates.

The code supports a local loopback profile only for developer testing. Render
rejects it. Do not tunnel or publicly bind the local development launcher.

Run `node scripts/check_release.mjs` before committing. This is a basic source
hygiene scan, not a replacement for dedicated secret scanning and security review.
If a credential is committed, rotate/revoke it immediately; deleting the latest
file does not erase it from Git history.
