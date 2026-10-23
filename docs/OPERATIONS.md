# Running Khozo

How khozo.org is deployed, checked, rolled back and kept safe. Names of settings only: no value of any password, key or token belongs in this repository, which is public.

## 1. What runs where

| Part | Service | Notes |
| --- | --- | --- |
| Website, API, scheduled jobs | Cloudflare Worker `khozo` | Serves khozo.org and www.khozo.org. Jobs every 15 minutes and nightly (`wrangler.jsonc` `triggers`). **Workers Free plan as of 22 Oct 2026**, in a personal account (§5). |
| Database | Supabase Postgres, reached through Cloudflare Hyperdrive `f8ebd8b17c5449288a5bdaefb9ac57cd` | Query caching must stay off on the Hyperdrive config (`wrangler.jsonc`). |
| Face matching | Aarakshak (`AARAKSHAK_*`), AWS Rekognition (`AWS_*`, `KHOZO_REKOGNITION_*`) | Aarakshak's search across all cases at once (the gallery) needs Aarakshak's permission for live use. |
| Phone alerts | Expo push (`EXPO_ACCESS_TOKEN`) | |
| SMS | none connected (`KHOZO_SMS_GATEWAY_URL`, `KHOZO_SMS_API_KEY`) | DPIA G6. Family SMS and station SMS wait for a gateway. |
| Bot check | Cloudflare Turnstile (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`) | Built; off until the three are set (§4). |
| Code | GitHub `Aiproductsfactory/khozo` | **Public.** `main` is kept equal to what is live. |

## 2. Deploy

1. Start from what is live. `main` is what is live; build on it, or on the branch the last deploy came from. Two sessions deploying different branches undo each other's work.
2. Run the tests: `npm run test:all` (both server types) and `npm run i18n:check`.
3. Check the account: `npx wrangler whoami` must show the account that holds the `khozo` Worker.
4. Deploy, in PowerShell:
   ```
   $env:NODE_OPTIONS='--dns-result-order=ipv4first'
   npm run deploy
   ```
   The IPv4 setting avoids "fetch failed" from this office's network. If the upload succeeds but the domain or cron step fails, run `npx wrangler triggers deploy`.
5. Check it from outside: `npm run check:live`. It reads public pages only and changes nothing.
6. Write down the Worker version the deploy printed, and move `main` to the deployed commit (`git push origin <commit>:main`; a fast-forward only).

**Roll back:** `npx wrangler deployments list` shows recent versions; `npx wrangler rollback <version-id>` puts one back. Then move `main` back to that version's commit.

## 3. Change the database password (DPIA G20)

The Postgres password was committed in `scripts/test-supabase-basic-auth.mjs` (commit `baae704`) and is in the public history of every branch. Deleting the file or rewriting history does not help: copies exist. Change the password:

1. Supabase → the Khozo project → Project Settings → Database → **Reset database password**. Save the new one in the password store, outside this repository.
2. Point Hyperdrive at it:
   `npx wrangler hyperdrive update f8ebd8b17c5449288a5bdaefb9ac57cd --origin-password "<new password>"`
   (check the flag with `npx wrangler hyperdrive update --help`), then `npx wrangler hyperdrive get f8ebd8b17c5449288a5bdaefb9ac57cd` and confirm caching is still disabled.
3. If the Worker also has a `DATABASE_URL` secret, set it again: `npx wrangler secret put DATABASE_URL`.
4. Update `DATABASE_URL` in every local `.env` that scripts use.
5. `npm run check:live`, then sign in to the console and open a case, to prove the database answers.
6. Mark G20 closed in `docs/governance/dpia.md` with the date.

## 4. Switch on the bot check (Turnstile)

1. Cloudflare dashboard → Turnstile → **Add widget**: name "Khozo", hostnames `khozo.org` and `www.khozo.org`, mode **Managed**.
2. Set the three settings on the Worker:
   ```
   npx wrangler secret put TURNSTILE_SITE_KEY
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put TURNSTILE_HOSTNAMES      # khozo.org,www.khozo.org
   ```
3. `npm run check:live` must now say the bot check is **ON**.

A report with no token, or an old token from a phone that had no signal, is still accepted under a stricter limit, so the offline queue keeps working; only a false token is refused (`shared/human-check.js`).

## 5. Before the campaign: plan and accounts (DPIA G21)

- [ ] **Workers Paid plan** (about US$5 a month): Cloudflare → Workers & Pages → Plans. The Free plan stops any request after 10 ms of computing, which a public campaign will hit. No code change is needed.
- [ ] **Each account belongs to Aegis, not a person**, with **two named administrators** and two-step login on each:
  - [ ] Cloudflare (Worker, Hyperdrive, Turnstile, domain DNS)
  - [ ] Supabase (database)
  - [ ] AWS (Rekognition)
  - [ ] Aarakshak (API and gallery keys)
  - [ ] Expo (push alerts)
  - [ ] the registrar that holds khozo.org
  - [ ] GitHub `Aiproductsfactory` (repository owners)
- [ ] Record who holds each, where its recovery codes are, and when each key was last changed, in the private register outside this repository (`D:\khozo-private`).
- [ ] Heavy-use test, and the plan for an outage or a data leak (feasibility report, condition C6).

## 6. Settings the Worker reads

Set each with `npx wrangler secret put <NAME>` (or as a plain variable in the dashboard when it is not secret). Never commit a value.

- **Must be set:** `KHOZO_JWT_SECRET`, `KHOZO_FIELD_HASH_KEY`, `KHOZO_EXPORT_SIGNING_KEY` (and `KHOZO_EXPORT_SIGNING_KEY_ID`), `KHOZO_RATE_LIMIT_AUDIT_SALT`
- **Database:** Hyperdrive binding `HYPERDRIVE`; `DATABASE_URL` only for scripts
- **Face matching:** `AARAKSHAK_API_URL`, `AARAKSHAK_API_KEY`, `AARAKSHAK_THRESHOLD`, `AARAKSHAK_TIMEOUT_MS`, `AARAKSHAK_GALLERY_URL`, `AARAKSHAK_GALLERY_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `KHOZO_REKOGNITION_ENDPOINT`, `KHOZO_REKOGNITION_CONFIRM`
- **Matching limits:** `KHOZO_MATCH_CANDIDATES` (25 by default: how many cases a sighting is compared with when the gallery is off), `KHOZO_REVERSE_MATCH_CANDIDATES`, `KHOZO_SECOND_OPINION_TOP_N`, `KHOZO_EXTRA_PAIR_BUDGET`, `KHOZO_MATCH_CONCURRENCY`
- **Alerts:** `EXPO_ACCESS_TOKEN`, `KHOZO_SMS_GATEWAY_URL`, `KHOZO_SMS_API_KEY`
- **Bot check:** `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`
- **Rate limits:** `KHOZO_FOUND_REPORT_LIMIT`, `KHOZO_UNVERIFIED_FOUND_REPORT_LIMIT`, `KHOZO_LOGIN_LIMIT`, `KHOZO_OTP_LIMIT`, `KHOZO_REGISTER_LIMIT`, `KHOZO_GRIEVANCE_LIMIT`, `KHOZO_GRIEVANCE_STATUS_LIMIT`, `KHOZO_SIGHTING_STATUS_LIMIT`, `KHOZO_CASE_STATUS_LIMIT`, `KHOZO_BULLETIN_LIMIT`, `KHOZO_DIRECTORY_LIMIT`, `KHOZO_VIDEO_SEARCH_LIMIT`
- **CCTV checks from Khozo Desktop:** `KHOZO_DESKTOP_JOB_LIMIT` (240 by default: requests one officer's laptop may make in each rate-limit window, for faces and progress), `KHOZO_DESKTOP_DECISION_LIMIT` (120 by default: decisions, counted apart so a "Same person" is never held up behind faces) and `KHOZO_DESKTOP_JOB_FACES` (5000 by default: faces one check may send to be compared). The checks are kept in the `video_jobs` table (`server/sql/003_video_jobs.sql`). Run `node scripts/migrate.mjs` with the deploy; if it is forgotten, the Worker makes the table itself on the first CCTV check request or within 15 minutes (`worker/src/db.js` `ensureVideoJobsTable`), and alerts the super admins if it cannot. Until the table is there, the desktop app sends faces through the browser's route and "Same person" as a case note.
- **Khozo Desktop's newest version:** `KHOZO_DESKTOP_LATEST_VERSION`, `KHOZO_DESKTOP_LATEST_SHA256`, and optionally `KHOZO_DESKTOP_DOWNLOAD_URL` (private `https` link) and `KHOZO_DESKTOP_LATEST_NOTES`. See `desktop/README.md`, "Giving out a new version".

## 7. Known traps

- **"fetch failed" from Wrangler:** set `NODE_OPTIONS=--dns-result-order=ipv4first` (§2).
- **A build or render that hangs with the CPU at 100%** and `node.exe` processes nothing can end: on the Aegis machine this was Quick Heal stalling file reads. Restart, and exclude the project folder from real-time scanning. A hung process stays until the computer restarts, so never retry in a loop.
- **Work from more than one session at once:** say which branch you are deploying before you deploy, and build on what is live (§2).
