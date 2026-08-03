# Khozo deployment guide

Covers where the backend should run, what still has to change before it can, and
how to get the Android app onto Google Play.

---

## 1. Backend hosting

### Recommended shape

```
   Android app  ─┐
                 ├─► Khozo API (Express, Node 20)  ─►  Supabase Postgres
   Web dashboard ┘        on Render / Fly / VM              Supabase Storage (photos)
```

**Supabase provides the database and file storage. It does not run the API.** The
API is an Express server and needs its own host. Deploying "on Supabase" means
Supabase Postgres + Storage behind a Node service — Edge Functions are Deno and
would mean rewriting all 60+ routes, which is not worth doing.

Recommended host: **Render** (Web Service, Node 20, free tier works for a pilot).
Fly.io or a small VM are equally fine. Whatever you pick must give you:

- HTTPS with a real certificate — the app refuses to build against `http://` in
  production, and Play will reject plaintext transmission of personal data
- Environment variables (never commit secrets — see §2)
- A persistent disk **or** object storage for photos

### Can Cloudflare host the backend?

**The website yes, the API no — and the repo is already set up for exactly that.**

`worker/index.js` serves `web/dist` as static assets with SPA routing, and proxies
`/api/*` to whatever `API_ORIGIN` points at. That is the correct shape: Cloudflare
fronts everything, the Express API runs elsewhere.

Cloudflare Workers run V8 isolates, not Node. The API cannot run there as written:

| Dependency | Why it will not run on Workers |
| --- | --- |
| `express` | Needs `node:http`; Workers have no HTTP server API |
| `node:fs` | No filesystem — used by both the data store and photo storage |
| `multer` | Built on Node streams and `fs` |
| `bcryptjs` | Runs, but burns CPU time against the Worker limit on every login |

Porting would mean rewriting 60+ routes onto Hono, swapping `multer` for Web
`FormData`, `fs` photos for R2, and `jsonwebtoken` for `jose`. Weeks of work for
no benefit over a Node host that costs a few dollars a month.

**Recommended: keep Cloudflare in front.**

```
  Android app ─┐
               ├─► Cloudflare Worker ─┬─► /api/*  → API_ORIGIN (Render/Fly/VM)
  Browser ─────┘   (khozo.org)        └─► /*      → web/dist (global CDN)
                                                        │
                                                        └─► Supabase Postgres + Storage
```

This gets you HTTPS with a managed certificate (which the production Android build
requires), DDoS protection and caching in front of the public bulletin endpoints,
one origin for both clients so there is no CORS to configure, and the ability to
keep the API host off the public internet.

Deploy:

```bash
npx wrangler deploy                                    # site + proxy worker
npx wrangler secret put API_ORIGIN                     # e.g. https://khozo-api.onrender.com
```

Then point the mobile app at the Cloudflare origin, not the API host directly:

```bash
KHOZO_ENV=production KHOZO_API_URL=https://khozo.org npx expo prebuild -p android
```

**What about Cloudflare Pages?** Same answer, same reason. Pages Functions execute
on the identical `workerd` runtime as Workers — no `node:http`, no `node:fs`. Pages
is the older way of doing what `wrangler.jsonc` already does via Workers Static
Assets, so switching would be a step backwards, not a way to host the API.

If you would rather keep everything on Cloudflare, **Cloudflare Containers** runs a
real Node image and would take the Express app unmodified — but it is priced well
above a small Render/Fly instance for this workload.

### Why not the current setup

`server/src/store.js` keeps everything in one JSON file rewritten on every save.
That is fine for a demo and unacceptable in production:

| Problem | Consequence |
| --- | --- |
| Whole file rewritten per write | Two concurrent writes silently lose one |
| No transactions | A crash mid-write truncates the entire database |
| No indexes | Every query is a full scan |
| Single instance only | Cannot scale or run zero-downtime deploys |

Photos were also held in memory; that is **fixed** — they now persist to
`server/data/uploads/` and survive restarts. On a host with an ephemeral
filesystem they still need to move to Supabase Storage.

### Running the migration

```bash
cp .env.example .env          # then fill in DATABASE_URL
node scripts/migrate-to-postgres.mjs --check     # connectivity + which tables exist
node scripts/migrate-to-postgres.mjs --schema    # apply server/sql/001_schema.sql
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

### Remaining: photo storage

Every data access already funnels through `store.js`, which is what makes this
tractable — the route handlers do not need to change.

1. Create the Postgres schema (`users`, `reports`, `found_reports`, `grievances`,
   `activity`, `audit`) with real columns, not a `jsonb` blob.
2. Reimplement the exported functions in `store.js` against Supabase.
   `addAudit` must stay append-only and keep the hash chain.
3. Move photo read/write (`savePhoto` / `readPhoto` / `deletePhoto`) to a
   **private** Supabase Storage bucket; serve via signed URLs from the API so the
   jurisdiction check in `GET /api/reports/photo/:key` still applies.
4. Keep RLS enabled with **no policies**, and connect using the `service_role`
   key. Authorisation stays in Express, where the 16-role jurisdiction logic
   already lives. Do not expose PostgREST to clients.

> RLS with no policies denies everything to the anon key. That is deliberate:
> the anon key is public by design, so it must be able to reach nothing.

### Required environment variables

```bash
NODE_ENV=production
KHOZO_JWT_SECRET=<64+ random chars>     # server refuses to boot without it
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server-side only, never in the app
AARAKSHAK_API_KEY=<key>                 # optional: tier 1 face matching
AWS_ACCESS_KEY_ID=...                   # optional: tier 2 fallback
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-south-1
KHOZO_EXPORT_SIGNING_KEY=<random>       # signs case handoff exports
```

---

## 2. Secrets

Previously committed to the repo and **must be treated as compromised**:

- Supabase publishable key and project URL (`store.js`) — removed
- Aarakshak API key (`match.js`) — removed, now env-only
- JWT signing secret default — the server now refuses to start in production
  without `KHOZO_JWT_SECRET`, because a known secret lets anyone mint a
  `super_admin` token

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
KHOZO_API_URL=https://api.khozo.org \
KHOZO_VERSION_CODE=1 \
npx expo prebuild --platform android --clean

cd android && ./gradlew bundleRelease
# -> app/build/outputs/bundle/release/app-release.aab
```

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
