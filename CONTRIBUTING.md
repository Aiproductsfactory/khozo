# Contributing to Khozo

Khozo is open source under the [Apache License 2.0](LICENSE). Contributions
from police departments, state IT teams, NGOs and individuals are welcome.

## Run it

```bash
npm install
npm run dev        # API on :4000, web app on :5173, seeded test data
```

Without `DATABASE_URL` the API uses a local JSON store, so this needs no setup.
Local test logins are listed in the README (Accounts).

## Before you open a pull request

```bash
npm run test:all     # API contract on both runtimes, scoping, matching, audit chain…
npm run i18n:check   # every interface string translated (gu, hi, mr)
npm run build        # the web app builds
```

All three must pass. If you change behaviour, add or update a check in the
relevant `scripts/*-smoke.mjs`.

## Rules that are not negotiable

- **No real case data in the repository.** No names, photographs, phone
  numbers, FIR numbers or registers of real people — not in code, tests,
  fixtures, screenshots or issues. Test data is synthetic.
- **No public identity disclosure.** The public never sees a missing person's
  name or photo, and a sighting reporter is never told whether their photo
  matched (`shared/case-domain.js`, `isPublicAppeal`). Changes that weaken this
  will not be merged.
- **Jurisdiction and police-only rules live in one place** (`shared/scope.js`).
  Every route that reads a record goes through it.
- **Both runtimes behave the same.** Route handlers live in `shared/routes/`
  and run on Express and the Cloudflare Worker; keep them runtime-neutral.
- **Every interface string goes through `t()`** (see `web/src/i18n.jsx`) and
  gets Gujarati, Hindi and Marathi translations.
- **No secrets in the repository.** Use environment variables or Worker secrets.

## Security issues

Please report them privately; see [SECURITY.md](SECURITY.md).
