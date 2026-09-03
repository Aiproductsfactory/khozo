# Khozo deployment guide

Covers where the backend should run, what still has to change before it can, and
how to get the Android app onto Google Play.

---

## 1. Hosting

### The shape it actually has

```
  Android app ─┐
               ├─► Cloudflare Worker ─┬─► /api/*  → shared/routes, run on workerd
  Browser ─────┘  khozo.*.workers.dev └─► /*      → web/dist on the global CDN
                                              │
                                              └─► Hyperdrive ─► Postgres
                                                               (records + photo bytes)
```

One deploy serves the site and the API together. There is no separate backend to
host, no origin server to keep online, and no CORS between the clients and the
API because they share an origin.

This guide previously described an Express service on Render with the Worker
proxying `/api/*` to it via `API_ORIGIN`. That is no longer the shape, and
`API_ORIGIN` is no longer read by anything.

### How the API runs on Workers

The route handlers live in `shared/routes/` and are written against Express's
`(req, res)` contract. The Worker supplies that contract itself rather than
carrying a second, hand-ported copy of the routes:

| Node dependency | What the Worker uses instead |
| --- | --- |
| `express` router | `worker/src/http/router.js` — path params, middleware chain, `res.status().json()` |
| `multer` | Web `FormData`, parsed by the same shim into `req.file` |
| `jsonwebtoken` | `jose` |
| in-memory store | `worker/src/store-sync.js` — the dataset hydrated per request over Hyperdrive |
| `@aws-sdk/client-rekognition` | `worker/src/match.js`, a fetch-based provider client |

`server/` still runs the same handlers on Node for local development, and
`npm run smoke:worker` runs the full API contract through the Worker's stack on
Node so the two cannot drift apart unnoticed. They did once: the Worker had
fallen about forty endpoints behind, and the public sighting upload — the flow
the product exists for — answered 404 in production while every test passed.

### Deploying

```bash
node scripts/migrate.mjs      # idempotent; safe to re-run
npm run test:all              # no server, database or network needed
npx wrangler deploy           # builds web/dist and uploads both
```

### The public domain

`wrangler deploy` publishes to `khozo.<subdomain>.workers.dev`. To serve
`khozo.org`, attach it to the Worker as a **Custom Domain** — Workers & Pages →
`khozo` → Settings → Domains & Routes → Add → Custom Domain — and again for
`www.khozo.org`. Cloudflare writes the DNS records and issues the certificate
itself.

Do not point an `A` record at an IP: there is no origin server to point at. A
registrar's parked-domain `A` records left in place are the trap here — Cloudflare
proxies them faithfully and keeps serving the registrar's "Launching Soon" page,
so the zone looks correctly configured while the site is still a placeholder.
Delete every `A` record on the apex before adding the custom domain.

### Hyperdrive: caching must stay disabled

```bash
npx wrangler hyperdrive get <id>                       # caching.disabled must be true
npx wrangler hyperdrive update <id> --caching-disabled
```

Hyperdrive caches read queries by default. With caching on, a sighting reported
by a citizen was written to Postgres and then missing from every officer's
review queue, because the dashboards read a cached result set that predated it.
The row was in the database; the API returned a list without it.

Caching is a reasonable trade for a read-heavy public site. It is not one for a
queue where a row that arrives late is a child nobody is looking for yet.

### Storage

Records and photo bytes both live in Postgres — photos in `photo_blobs`, fetched
by key on demand and never hydrated with the rest of the dataset. Nothing is
written to a local filesystem, which is what makes the Worker viable and what
stops a redeploy destroying the photographs attached to open cases.

The per-request hydration is the deliberate trade in `worker/src/store-sync.js`:
six SELECTs per request buys synchronous reads for the jurisdiction-scoping code,
which is the code least worth rewriting in a child-protection system. It is
right at district or state pilot volume, and needs to become real queries past
roughly 10^5 cases.

### Local development

```bash
npm run dev     # Express API on :4000, Vite on :5173
```

With no `DATABASE_URL` the API uses a seeded JSON file, so a clean checkout runs
with no setup at all.


### Running the migration

```bash
cp .env.example .env                    # then fill in DATABASE_URL
node scripts/migrate.mjs --dry-run      # list the SQL files that would run
node scripts/migrate.mjs                # apply every file in server/sql, in order
```

Each SQL file is idempotent (`create table if not exists`, `add column if not
exists`), so re-running is a no-op and there is no migration ledger to keep in
sync with the database. Run it before any deploy that adds a table or column.

To move an existing JSON-file dataset into Postgres for the first time:

```bash
node scripts/migrate-to-postgres.mjs --check     # connectivity + which tables exist
node scripts/migrate-to-postgres.mjs             # copy db.json into Postgres
node scripts/migrate-to-postgres.mjs --verify    # row counts
```

Get `DATABASE_URL` from Supabase → Project Settings → Database → Connection
string → URI. Use port **5432** (session pooler) for the schema step; the running
API can use **6543** (transaction pooler).

The data migration runs in a single transaction — a partial migration is worse
than none — and every row is an upsert, so it is safe to re-run. `audit` uses
`ON CONFLICT DO NOTHING` because the table is append-only.

Once `DATABASE_URL` is set the API uses Postgres automatically; unset it and the
JSON file store is used, which is what the local test suites run against.

### How the data layer works

The application reads its data synchronously in **262 places**, many inside
`.filter()` callbacks in the jurisdiction-scoping logic. Rewriting those as async
would touch every route and every access-control helper — the highest-risk code
in the system — so instead:

- **Postgres is the system of record.** Each mutation queues a single-row upsert.
- **The process keeps the dataset in memory** and serves reads from it, so
  `store.js`'s synchronous API and all 262 call sites are unchanged.
- **Boot hydrates** memory from Postgres; an empty database is seeded.
- The `audit` table has a trigger rejecting `UPDATE`/`DELETE`, so application
  bugs cannot rewrite history — only append to it.

Consequences worth knowing before you scale:

| | |
| --- | --- |
| **Single writer** | Two API instances would each cache and diverge. Run one, or convert reads to async queries first. |
| **Crash window** | Writes queued in the last few milliseconds can be lost on a hard crash. `SIGINT`/`SIGTERM` flush first, so ordinary deploys do not lose data. |
| **Memory** | The full dataset is resident. Fine to ~10⁵ cases. |

### Photo storage

Photographs are **in Postgres**, in `photo_blobs`, keyed by the record they
belong to. They are fetched by key on demand and are never part of the dataset
hydration, so image bytes never sit in memory alongside the case records.

This is why the Worker is viable at all, and why a redeploy cannot destroy the
photographs attached to open cases — there is no local filesystem involved on
either runtime.

Access still goes through `GET /api/reports/photo/:key`, which applies the
jurisdiction check. A photo is served without a token **only** when an officer
has deliberately published that case as a public bulletin; anything else needs
a token and a jurisdiction that covers the case.

RLS is enabled on every table with **no policies**, and the API connects with
the service role, which bypasses RLS. That is deliberate: the anon key is public
by design, so it must be able to reach nothing. Authorisation lives in
`shared/scope.js`, where the 18-role jurisdiction logic already is. Do not
expose PostgREST to clients.

### Required environment variables

The Node build reads these from `.env`; the Worker reads them from its own
secrets (`npx wrangler secret put <NAME>`).

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...           # unset locally to use the JSON file store
KHOZO_JWT_SECRET=<64+ random chars>     # server refuses to boot without it
KHOZO_EXPORT_SIGNING_KEY=<random>       # signs case handoff exports
AARAKSHAK_API_KEY=<key>                 # optional: tier 1 face matching
AWS_ACCESS_KEY_ID=...                   # optional: tier 2 fallback (Node build only)
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-south-1
KHOZO_SMS_GATEWAY_URL=...               # required for public registration OTPs
KHOZO_SMS_API_KEY=...
```

The Worker reaches Postgres through its Hyperdrive binding rather than
`DATABASE_URL`, so that one is only needed by the Node build and the scripts.

---

## 2. Secrets

Previously committed to the repo and **must be treated as compromised**:

- Supabase publishable key and project URL (`store.js`) — removed
- Aarakshak API key (`match.js`) — removed, now env-only
- JWT signing secret default — the server now refuses to start in production
  without `KHOZO_JWT_SECRET`, because a known secret lets anyone mint a
  `super_admin` token
- **The Postgres password**, in plaintext in
  `scripts/test-supabase-basic-auth.mjs`, committed in `baae704` on a public
  repository. The file is deleted, but deletion does not remove it from git
  history: **rotate the database password.** Until then, anyone who reads the
  repository history holds the credentials to the case database.

All 18 seeded accounts share the password `khozo123` and their bcrypt hashes were
publicly readable for a period. **Rotate every password before go-live** and
delete or disable the demo accounts.

---

## 3. Face matching

Tiering: **Aarakshak → AWS Rekognition → non-biometric fallback.**

### Threshold calibration (measured, not assumed)

Aarakshak was benchmarked against pairs of real photographs:

| | Score range |
| --- | --- |
| Same person (6 pairs) | 0.48 – 0.86 |
| Different people (4 pairs) | −0.04 – 0.07 |

Two consequences drove the configuration:

1. **The provider's default `threshold=0.82` is wrong for this application.** It
   rejected five of six genuine matches. Khozo sends `0.35` instead and ignores
   the provider's `match` flag, ranking on the raw score.
2. **Scores can be negative** for clearly different faces, so they are clamped
   to 0 before ranking.

A score never decides anything on its own — it only decides whether an officer is
shown a candidate. For a missing child, failing to surface a match is far worse
than showing one extra face to review, so the thresholds are set to catch
matches. Bands used in the UI: `≥0.45` strong, `0.25–0.45` possible, below that
noise. Tune with `AARAKSHAK_THRESHOLD` and `KHOZO_MATCH_REVIEW_THRESHOLD`.

### Rekognition: second opinion, not just a fallback

Rekognition does two jobs:

1. **Failure fallback** — if Aarakshak is unreachable or rejects the key, it takes
   over the whole ranking.
2. **Second opinion** — on a healthy run it re-scores Aarakshak's top
   `KHOZO_SECOND_OPINION_TOP_N` (default 5) candidates.

The second job is the one that earns its cost. Two face models fail on different
inputs — pose, lighting, and above all the **age gap** between a registration
photo and a sighting a year later, which is the normal case for a missing child.
Ranking takes `max(aarakshak, rekognition)`: if either model recognises the
child, an officer sees the case. Where the two disagree by more than 0.25 the
candidate is flagged (`enginesDisagree`) rather than averaged, because "one
engine is confident and the other is not" is exactly what a human should look at.

Re-scoring only the shortlist costs `N + 5` calls instead of `2N`. Set
`KHOZO_SECOND_OPINION_TOP_N=0` to make Rekognition a pure failure fallback.

### Scaling limit to fix before real volume

A sighting is currently compared pairwise against `KHOZO_MATCH_CANDIDATES` (25)
open cases, chosen in arbitrary order. At a few hundred open cases that silently
misses most matches — a far bigger recall problem than which engine is used.

The fix is an indexed search rather than pairwise comparison. **Rekognition
Collections** (`IndexFaces` / `SearchFacesByImage`) searches millions of faces in
one call, which inverts the tiers usefully:

- Rekognition Collection → recall over *every* open case, returns a shortlist
- Aarakshak → precise verification of that shortlist

Do this before the case count outgrows the 25-candidate cap.

### Latency

One comparison takes ~1.8s, and a sighting is compared against up to
`KHOZO_MATCH_CANDIDATES` (25) open cases. Run sequentially that is 45 seconds of
upload spinner, so comparisons run `KHOZO_MATCH_CONCURRENCY` (5) at a time.
Raise the concurrency or lower the candidate cap if the provider rate-limits.

Each tier runs only if configured, and the engine reported to the dashboard names
the tier that actually produced the scores. With neither configured, the
readiness panel shows `match_provider: fail` and the API labels scores
non-biometric — it no longer claims Aarakshak is running when it is not.

To enable real matching, set `AARAKSHAK_API_KEY` (and optionally AWS
credentials), then verify with:

```bash
npm run seed:test-data
```

That registers three children from photographs, then submits sightings using
*different* photographs of the same people plus one control face that matches
nobody. It passes only if every genuine match outscores the control.

---

## 4. Google Play release

### Before you can ship

- [ ] Backend on HTTPS with the Postgres migration done
- [ ] All demo passwords rotated
- [ ] **Privacy policy published at a public URL** — mandatory, and this app
      handles children's data, location and photos
- [ ] Data safety form completed: photos, precise location, name, phone number
- [ ] Decide Families policy exposure. The app is *for* adults reporting about
      children, not for children — but the target audience declaration must be
      explicit, and Play scrutinises child-safety apps closely
- [ ] Remove the "face-match search alerts the right police station in real time"
      claim from the landing page and store listing until it is true

### Build

```bash
cd mobile

KHOZO_ENV=production \
KHOZO_API_URL=https://khozo.org \
KHOZO_VERSION_CODE=1 \
npx expo prebuild --platform android --clean

cd android && ./gradlew bundleRelease
# -> app/build/outputs/bundle/release/app-release.aab
```

`KHOZO_API_URL` is the Worker's own origin, not a separate API host. The Worker
serves the site and `/api/*` together, so this is whatever hostname the Worker
answers on: `https://khozo.org` once the custom domain is attached, and
`https://khozo.swastik-kumar.workers.dev` — the default in `mobile/app.config.js`
— until then. There is no `api.khozo.org`. An earlier version of this guide said
to use one, which would have shipped an app pointing at a hostname that does not
resolve.

Production builds set `usesCleartextTraffic=false`, enable ProGuard and resource
shrinking, and fail fast if the API URL is not HTTPS.

`KHOZO_VERSION_CODE` must increase on every upload — Play rejects a repeat.

### Signing

The release type is currently signed with the **debug** keystore, which Play will
not accept. Generate an upload key once:

```bash
keytool -genkeypair -v -keystore khozo-upload.jks \
  -alias khozo -keyalg RSA -keysize 4096 -validity 10000
```

Keep it out of the repo, add it to `android/gradle.properties` via environment
variables, and enrol in Play App Signing. **Losing this key means you can never
update the app.**

### Note on architectures

`android/gradle.properties` currently builds `arm64-v8a` only, to keep the native
build inside the memory available on the build machine. That covers most modern
devices but **excludes older 32-bit phones** — which matters for a public-safety
app in India. Restore the full list for the Play build:

```
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
```

An App Bundle splits these per device, so the download size does not suffer.

---

## 5. Tests kept in the repo

```bash
npm run seed:test-data   # realistic cases + sightings from real photographs
npm run test:accounts    # all 18 accounts: auth, permissions, jurisdiction scoping
npm run test:all         # the above plus API, route-guard and PWA smoke suites
```

`scripts/seed-test-data.mjs` reads from `D:/random images` by default; override
with `--images <dir>`. Both scripts exit non-zero on failure, so they can gate a
deploy in CI.
