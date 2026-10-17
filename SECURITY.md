# Security policy

Khozo holds records of missing children, women and adults, including records
that police departments share on the condition that only police see them. A
weakness here can put a person at risk, so please report it privately.

## Reporting a vulnerability

Use GitHub's private reporting: open the repository's **Security** tab and
choose **Report a vulnerability**. Do not open a public issue, and do not include
real case data, photographs or personal details in the report.

Please include what you found, how to reproduce it against a local instance
(`npm run dev` runs one with seeded test data), and what an attacker could do
with it. We aim to acknowledge reports within 3 working days.

## Scope

In scope: the web app (`web/`), the API route handlers (`shared/`), both
runtimes (`server/`, `worker/`), the mobile app (`mobile/`) and the scripts in
`scripts/`.

Out of scope: denial-of-service by volume, findings that need a compromised
officer account to begin with, and third-party services (Cloudflare, the
database host, the face-matching providers) beyond how Khozo uses them.

## Never test against the live service

Do not run tests, scans or proofs of concept against `khozo.org` or any
production deployment. It holds real people's records. Use a local instance.
