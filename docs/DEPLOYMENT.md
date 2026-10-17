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
AARAKSHAK_API_KEY=<key>                 # optional: face matching (proposes)
AWS_ACCESS_KEY_ID=...                   # optional: Rekognition confirms, both builds
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-south-1
AARAKSHAK_GALLERY_URL=...               # optional: one-to-many index (off unless
AARAKSHAK_GALLERY_KEY=...               #   both are set; see One-to-many index)
AARAKSHAK_GALLERY_NAME=khozo-sandbox    # optional: the gallery the key should open
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

All 18 seeded accounts shared the password `khozo123` and their bcrypt hashes were
publicly readable for a period. Official accounts are rotated with
`scripts/rotate-account-passwords.mjs` (new passwords go to a CSV outside the
repository); only the low-privilege demo parent and NGO accounts keep the shared
password. `scripts/reset-passwords.mjs` now refuses any non-local database.

---

## 3. Face matching

Tiering: **Aarakshak proposes → AWS Rekognition confirms (and compares alone where Aarakshak cannot) → no candidate.** Nothing non-biometric ever produces a score.

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

Aarakshak proposes; Rekognition confirms. The rules are in
`shared/match-pipeline.js`, which both builds run (the Worker reaches
Rekognition with a signed fetch, `worker/src/rekognition.js`; the Node build
with the AWS SDK), so the two cannot drift. `npm run smoke:match-engines`
runs both against the same stand-in providers and fails on any difference.

1. **Second opinion.** Aarakshak's top `KHOZO_SECOND_OPINION_TOP_N` (default 5)
   candidates are re-scored by Rekognition. A candidate Rekognition scores at or
   above `KHOZO_REKOGNITION_CONFIRM` (0.80) is *corroborated* and keeps the
   **lower** of the two scores: a second opinion confirms, it never inflates.
   Taking the higher let one engine overrule the other, so two engines that
   disagreed produced a more confident number than either alone. A candidate
   Rekognition scores below the bar is withheld: two engines looked and did not
   agree. Where both answered and differ by 0.25 or more the candidate is
   flagged `enginesDisagree` for the reviewer.
2. **No single-engine veto.** A pair Aarakshak could not answer for - no face
   found, an error, a timeout - is *unknown*, not a score of 0, and Rekognition
   compares it on its own, held to the same 0.80 bar (`secondOpinion:
   'sole_engine'`). The face screen works the same way: Aarakshak finding no
   face sends the photo to Rekognition before it is called "no person".
3. **The "not checked" lane.** A candidate Rekognition is configured for but
   did not answer for - an error, a photo over its 5 MB limit, a WebP it cannot
   read, no face found by it - is kept as an uncorroborated lead, flagged
   `notChecked` with the reason, never confirmed and never silently dropped.
4. Every candidate records which engines answered for it (`enginesAnswered`,
   `engines`), and every result is stored with the thresholds it was judged
   against and a `configHash` of the engine settings
   (`shared/match-config.js`).

Re-scoring only the shortlist costs `N + 5` calls instead of `2N`. Set
`KHOZO_SECOND_OPINION_TOP_N=0` to make Rekognition a pure fallback (candidates
are then uncorroborated leads). Faces are never stored in Rekognition: it is
only asked to compare two photos it is shown.

### Candidates, and walking them

A sighting keeps up to five strong candidates (`matchCandidates`), best first:
corroborated ones before single-engine ones, then by score. `matchedReportId` is
the best one still proposed. An officer who rejects it ("Not this person - show
next") or refers the sighting on marks it rejected (`rejectedLinks`), and the
sighting moves to the next candidate - that case's police officers are alerted
- or, with none left, back to the reporter's own district and the no-match (or
CWC) queue. A link the reverse search made goes back to exactly where it was. A
rejected pair is never proposed again, in either direction.

The forward pool leaves out found and closed cases, unverified citizen intakes
and found-child intake records. Within each nearest-first tier, a case whose
sex and plausible current age (age at missing plus the years since) fit the
sighting comes first - a tie-break, never a filter. A formal found-child intake
keeps its own copy of the sighting photo for the case retention period, and the
reverse search (a new case against the stored sightings) also covers open
intakes whose sighting can no longer be compared.

Case photos are screened when registered (`photoCheck`: `usable`, `no_face`,
`multiple_faces` or `unchecked`). Registration is never refused; the case is
flagged in the console and police can replace the photo
(`POST /api/reports/:id/photo`), which checks it again and re-runs the reverse
search.

### Searching again

- `POST /api/reports/found/:id/rematch` (police roles, in scope) re-runs the
  forward search for one sighting ("Search again" in the console).
- `POST /api/dashboard/rematch-sightings` (super admin) does it in batches of at
  most 20 (`{ limit, since }` in, `{ processed, remaining, linked, failed,
  since }` out) for every unlinked sighting whose last search had no biometric
  answer, had failed comparisons, left cases out under a smaller budget, or ran
  under another `configHash`. Repeat with the returned `since` until
  `remaining` is 0. Run it after an outage, after configuring Rekognition or an
  index, or after changing a threshold.
- `POST /api/reports/found/:id/place` sets the district of a sighting the
  reporter gave none for, routes it to that district's desks and searches from
  there.

The Worker retries one Aarakshak call once on a network fault or a 5xx, as the
Node build does.

### Uploads

Both builds refuse a photo over 8 MB with 413 (multer on Express, the router on
the Worker) and anything that is not a JPEG, PNG or WebP - by declared type and
by its first bytes. WebP is accepted, but Rekognition cannot read it, so its
candidates land in the "not checked" lane.

### One-to-many index

A sighting is compared pairwise against `KHOZO_MATCH_CANDIDATES` (25) open
cases, nearest first. That stays the active path until an index provider is
configured. The owners' decision is that the one-to-many index is
**Aarakshak's own gallery** (API v2, <https://aarakshak.com/openapi.json>, tag
`gallery-v2`), not Rekognition collections. `shared/face-index.js` is the
engine-agnostic layer:

- provider `none` (the default): disabled, every call a no-op;
- provider `aarakshak-gallery`: enabled only when both `AARAKSHAK_GALLERY_URL`
  and `AARAKSHAK_GALLERY_KEY` are set.

Switching it on (Worker):

```sh
# The key reaches Khozo's technical contact out of band. Paste it at the
# prompt; it never goes in a file, a commit, a chat or a document.
npx wrangler secret put AARAKSHAK_GALLERY_KEY
npx wrangler secret put AARAKSHAK_GALLERY_URL     # https://aarakshak.com
npx wrangler secret put AARAKSHAK_GALLERY_NAME    # khozo-sandbox
```

`AARAKSHAK_GALLERY_URL` is the host; `/api/v2` on the end is accepted. The key
is bound to one gallery, so no request names it; `AARAKSHAK_GALLERY_NAME` is
only compared with what `GET /api/v2/gallery` reports, and a mismatch shows in
red on the sightings page.

What is sent: the opaque case id (`r_...`) and the photo - never a name, and
none of the optional metadata (sex, birth year, state, district), because a
search is never narrowed by what a family estimated. Aarakshak keeps the face
template, not the photo. Each enrolment carries its own `Idempotency-Key`,
reused by its one retry.

With the provider enabled, registering (or verifying, or reopening) a case
enrols its photo; closing, confirming found and anonymising remove it, and the
case keeps Aarakshak's signed deletion receipt (`faceIndex.receipt`). The
forward search asks the gallery for its 50 closest faces, across every face in
the sighting photo, then spends the pairwise comparison and the Rekognition
confirmation on that shortlist, plus any open case the gallery does not hold
yet and any enrolled in the last 10 seconds (the gallery takes about five to
index a face). A gallery that does not answer, is rate-limited, or finds no
face in the sighting falls back to the nearest-first budget.

The pilot key allows **30 requests a minute**, shared by live searches and
enrolments; a 429 is never retried in the request path. A photo the gallery
refuses (no face, several faces, face too small) is flagged on the case for
the officer, and replacing the photo enrols it.

**Backfill.** Cases registered before the provider was enabled are not in the
gallery. On the sightings page the national desk sees how many open cases the
gallery holds and **Fill the face search gallery**, which runs
`POST /api/dashboard/face-index/backfill` batch after batch at about 20 calls a
minute, until nothing is left. Each batch first removes faces that should not
be there (cases found, closed or anonymised; Khozo case ids with no case on
file - unless they are most of the gallery, which means the list of cases did
not load), then enrols open cases the gallery does not hold. Faces whose id is
not a Khozo case id are never touched. `GET /api/dashboard/face-index` is the
same status as JSON.

### Latency

One comparison takes ~1.8s, and a sighting is compared against up to
`KHOZO_MATCH_CANDIDATES` (25) open cases. Run sequentially that is 45 seconds of
upload spinner, so comparisons run `KHOZO_MATCH_CONCURRENCY` (5) at a time.
Lower the concurrency or the candidate cap if the provider rate-limits. On the
Worker the concurrency is capped at 5: an invocation holds at most six outbound
connections and queues the rest with their 12-second abort already running, so
a wider fan-out silently drops the last comparisons. Registering a case compares
its photo with up to `KHOZO_REVERSE_MATCH_CANDIDATES` (50) stored sightings the
same way, about 18 seconds at 1.8s a call, inside the registration request. The
engine's `comparedAgainst` counts the comparisons that answered.

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
