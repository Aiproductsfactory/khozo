# Project Khozo

> **Your 1 click — "A missing child can return home"**
> An initiative by Aegis School of Data Science & AI, Mumbai — *AI for Social Good*.

A full-stack platform that helps **citizens, NGOs, police, and government** reunite missing
children (and women / persons) with their families using photo reporting and face-match search.

This repository implements the system described in the Khozo deck & proposal:

- **Public landing / intro site** — pitched at prospective customers, the Police department,
  the Government of India, and State Governments.
- **Multi-stakeholder dashboards** with a role hierarchy:
  - **Super Admin** — Govt of India / State Govt / Police Commissioner (nationwide overview)
  - **Admin** — Asst. Commissioner of Police (jurisdiction overview)
  - **User (Police)** — Police Station (registers FIRs, confirms matches, alerts parents)
  - **Parent / Public** — reports a missing child, or uploads a photo of a child they spotted
  - **NGO** — assists like the public
- **Register FIR**, **Police Register**, and a **Capture → Detect → Locate → Match** report flow.

## Tech stack

| Layer    | Choice                                                        |
|----------|---------------------------------------------------------------|
| Web      | Vite + React + React Router + Tailwind CSS + Recharts          |
| Mobile   | Expo / React Native (Android field app)                        |
| API      | One set of route handlers, run by two runtimes (see below)     |
| Storage  | Postgres (photos included), or a JSON file store with no config |
| Matching | Aarakshak face comparison, AWS Rekognition fallback, local heuristic last |

### One API, two runtimes

The route handlers live in `shared/routes/` and are run by both:

- **Express** (`server/`) for local development, against an in-memory replica of
  the dataset that is hydrated from Postgres at boot — or a JSON file when
  `DATABASE_URL` is unset, so the project runs with no setup at all.
- **Cloudflare Worker** (`worker/`) in production, against a per-request replica
  hydrated over Hyperdrive, behind a small Express-compatible router shim.

They previously had a route file each. The copies drifted, the deployed Worker
fell about forty endpoints behind, and the public sighting upload — the product's
central flow — answered 404 in production while every test still passed. Sharing
the handlers is what stops that recurring; `npm run test:coverage` is what
catches it if it starts to.

## Run it

```bash
# 1. install
npm install            # root: installs both workspaces

# 2. start backend + frontend together
npm run dev
```

- Web app: http://localhost:5173
- API:     http://localhost:4000

Without `DATABASE_URL` the API uses the seeded JSON store, so this works on a
clean checkout.

## Tests

```bash
npm run test:all
```

Runs with no server, database or network:

| Script                | Checks                                                              |
|-----------------------|---------------------------------------------------------------------|
| `test:coverage`       | every API path the web and mobile clients call is actually served    |
| `smoke:api`           | the full API contract against the Express runtime                    |
| `smoke:worker`        | the same contract against the Worker's router and middleware         |
| `smoke:alerts`        | a reported sighting reaches every authority's queue and alert inbox  |
| `smoke:store`         | the Worker's per-request store replica, including the audit chain    |
| `smoke:web-routes`    | dashboard route guards match the roles they claim                    |
| `smoke:pwa`           | the service worker and offline sighting queue                        |

Two more need something running, so they are not in `test:all`:

```bash
npm run test:accounts -- --api https://khozo.swastik-kumar.workers.dev   # every role against a live API
npm run test:images                                                       # face-match pipeline; see test-assets/faces/README.md
```

## When a child is spotted

The flow the whole platform exists for, and the one worth understanding before
changing anything near it:

1. A citizen taps **I spotted a child** on the web app or in the field app, and
   attaches a photo. No account, no login.
2. The photo is compared against every open case with a stored photograph.
3. **Every authority account is alerted immediately** — police, SJPU, AHTU, CWC,
   DCPU, RPF, CCI, SAA, JJB, DLSA, the state and national desks, and registered
   NGOs. The alert says where and when; it never names the child, and opening
   the record behind it still goes through the ordinary jurisdiction rules.
   Parents are not alerted: they hear about their own child from an officer.
4. The sighting lands in the review queue of the officers whose jurisdiction it
   falls in — or, if the reporter gave no location, in **every** review queue,
   because an unrouted report has to reach someone.
5. An officer confirms, rejects or refers it. Only then is the family contacted.

The reporter gets a receipt id and can track the status publicly, and is never
told which child was matched.

## Deploy to Cloudflare Workers

```bash
node scripts/migrate.mjs   # idempotent; apply before the first deploy of a change
npx wrangler deploy
```

Wrangler builds `web/dist` and uploads it with the Worker, which serves the
static app and the API together — there is no separate backend to host. The
Worker needs a Hyperdrive binding to the Postgres instance (already in
`wrangler.jsonc`) and these secrets:

```bash
npx wrangler secret put KHOZO_JWT_SECRET
npx wrangler secret put KHOZO_EXPORT_SIGNING_KEY
npx wrangler secret put AARAKSHAK_API_KEY
```

**Hyperdrive query caching must stay off.** With it on, a sighting is written to
Postgres and then missing from every dashboard, because the reads come back from
a cache that predates it:

```bash
npx wrangler hyperdrive get <id>                      # caching.disabled must be true
npx wrangler hyperdrive update <id> --caching-disabled
```

### Demo logins (seeded)

| Role        | Email                   | Password   |
|-------------|-------------------------|------------|
| Super Admin | superadmin@khozo.org    | khozo123   |
| Admin       | admin@khozo.org         | khozo123   |
| Police User | police@khozo.org        | khozo123   |
| Parent      | parent@khozo.org        | khozo123   |
| NGO         | ngo@khozo.org           | khozo123   |

Thirteen further official roles (SJPU, AHTU, DCRB, DLSA, CWC, DCPU, RPF, CCI,
SAA, JJB, state nodal, SARA, crime bureau) are seeded on the same password —
`npm run test:accounts` lists them all.

## Structure

```
khozo/
  shared/           route handlers, case rules and jurisdiction scoping, used by both runtimes
    routes/         the API itself
    case-domain.js  case vocabulary, validation, public-payload redaction
    scope.js        who may see which case
  server/           Express runtime: store, auth, matching, JSON-file fallback
  worker/           Cloudflare runtime: router shim, per-request store replica, matching
  web/              Vite + React single-page app
  mobile/           Expo / React Native field app
  scripts/          tests, seeding, migrations, deck tooling
  test-assets/      local-only test fixtures
```
