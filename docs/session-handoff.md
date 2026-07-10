# Khozo Session Handoff

Date: 2026-06-05

## Current Status

Khozo is built as a working local demo/pilot MVP.

Local dev server was started successfully with:

```bash
npm run dev
```

Confirmed local ports:

- Web app: http://localhost:5173
- API: http://localhost:4000

## Demo Login

Use any seeded account with password `khozo123`.

Recommended first login:

- Email: `superadmin@khozo.org`
- Password: `khozo123`

Other useful roles:

- `police@khozo.org`
- `parent@khozo.org`
- `ngo@khozo.org`

## Verification Already Run

Passing:

- `npm run build -w web`
- `npm run smoke:web-routes`
- `npm run smoke:api`
- `npm run smoke:pwa`

Known failing check:

- `npm run smoke:web-render`

Failure summary: the script gets past sandbox/process permission when run elevated, then Vite SSR fails to load `react-router-dom` via `/node_modules/react-router-dom/dist/index.js`. This appears to be a smoke-test/module-resolution issue, not a core app build failure.

## Main Pending Work

- Fix `scripts/web-render-smoke.mjs` Vite SSR dependency import/resolution.
- Replace the JSON data store with Postgres or SQLite before multi-user pilot use.
- Integrate real Aarakshak/face-recognition behind `server/src/match.js`.
- Expand smoke checks into a fuller automated test suite.
- Productionize OTP/SMS, CAPTCHA/WAF/abuse controls, audit immutability, anonymization/deletion workflows, and PWA/offline field-device hardening.

