# Khozo data processors and other recipients

> **DRAFT for legal review — not legal advice.**
> Version 0.1 · 17 October 2026 · Schedule 3 to the data-sharing agreement.
> Maintained by [Operator]. A change needs [30] days' notice to each Department
> (agreement clause 6.2). Entries marked [confirm] must be checked against the provider's
> contract and the live configuration before signature.

## Summary

| # | Who | Receives personal data? | Where | Contract in place |
|---|---|---|---|---|
| 1 | Cloudflare, Inc. | Yes: all traffic | Global edge network; [regional processing not configured] | [Cloudflare terms / DPA — confirm] |
| 2 | Supabase Inc. (database host) | Yes: every record and photo | [Project region — confirm] | [Supabase DPA — confirm] |
| 3 | Aarakshak ([legal entity — confirm]) | Yes: face images | Microsoft Azure, Central India (Aarakshak, 17 Oct 2026) | [DPA to sign; templates only, deletion certificate offered] |
| 4 | Amazon Web Services (Rekognition) | Yes: face images | `ap-south-1` Mumbai by default | [AWS customer agreement and DPA; AI opt-out — confirm] |
| 5 | OpenStreetMap Foundation (Nominatim) | Yes: sighting coordinates | [Outside India — confirm] | None: public service under its usage policy |
| 6 | Google LLC (Google Fonts) | Yes: visitors' IP addresses | Global | None: public service |
| 7 | SMS gateway ([provider]) | Yes, once connected: phone numbers | [India — to be chosen] | [to be signed] |
| 8 | Email | **No: Khozo sends no email today** | — | — |

No analytics, advertising or crash-reporting service was found in `web/` or `mobile/`
(source and `package.json` checked on 17 October 2026).

## 1. Cloudflare, Inc.

| | |
|---|---|
| What it does | Runs the Khozo API and serves the web app (Cloudflare Workers and static assets, `wrangler.jsonc`); connects the Worker to Postgres (Hyperdrive); keeps Worker logs (`"observability": { "enabled": true }`). |
| What it receives | Every request and response: photographs, sighting details, case records shown to officers, sign-in tokens, and the user's IP address. TLS ends at Cloudflare. |
| What it stores | No case records (Hyperdrive query caching must stay off: `wrangler.jsonc`, `docs/DEPLOYMENT.md` §1). Worker logs: [retention per plan, location — confirm]. |
| Where | The Cloudflare data centre nearest the user; Indian users are usually served in India, but this is not guaranteed. [Regional processing (Data Localisation Suite) is not configured — confirm and decide.] |
| Why | Hosting, with no separate server to run. |
| Open points | Who owns the account and which plan it is on (DPIA G21); log retention against CERT-In's 180 days in India (G17). |

## 2. Supabase Inc. (Postgres host)

| | |
|---|---|
| What it does | Hosts the Postgres database that is Khozo's system of record (`docs/DEPLOYMENT.md` §1; `.env.example`). |
| What it receives | All of it: users, cases, sightings, grievances, activity, notifications, the audit log (`server/sql/001_schema.sql`), and every photograph as bytes in `photo_blobs` (`001_schema.sql:32`). |
| Where | [Project region — confirm, e.g. ap-south-1 Mumbai]. Supabase runs on [AWS — confirm]. |
| Security | Row-level security on every table with no policies, so the public key reaches nothing; only the API connects, with the service role (`001_schema.sql:182-188`). Encryption at rest: [confirm]. |
| Backups | [Frequency and retention per plan — confirm]. Deleted data stays in backups until they expire (retention-schedule.md). |
| Open points | The database password was once committed to the public repository; confirm it was rotated (DPIA G20). |

## 3. Aarakshak

| | |
|---|---|
| What it does | The primary face engine. Compares two face images and returns a similarity score (`worker/src/match.js:6`, `POST https://aarakshak.com/api/v1/compare`). |
| What it receives | **Pairs of face images**: a sighting photo with each of up to 25 open-case photos (`worker/src/match.js:545`); a new case photo with each of up to 50 stored sightings (`worker/src/match.js:569`); and each sighting photo against itself, to check that it shows a person (`worker/src/match.js:237-255`). Police-only case photos are among them. No names or other fields are sent. |
| Where | Microsoft Azure, Central India region; nothing stored outside India (Aarakshak's written reply of 17 Oct 2026). [Confirm in the DPA.] |
| Retention and training | Aarakshak states it never stores photos, only face templates with their box and quality score (gallery API), that deleting a person removes their templates at once, and that deleting a gallery returns a signed deletion certificate (17 Oct 2026). [Still to confirm in writing: no use for training, clause 10.2.] |
| Accuracy limits | Aarakshak's model is validated on adults only. It is not yet measured on children, on photos taken years apart, or on post-mortem photographs; every result is a candidate for an officer, never an identification (17 Oct 2026). |
| Why | Matching sightings with missing persons. |

## 4. Amazon Web Services — Rekognition

| | |
|---|---|
| What it does | The confirming engine: re-scores Aarakshak's top 5 candidates and withholds any it scores below 0.80; takes over if Aarakshak does not answer; and screens a photo for a face when Aarakshak cannot (`worker/src/match.js:360-410,476-510`; `worker/src/rekognition.js`). |
| What it receives | Pairs of face images through `CompareFaces`. No names. |
| Where | `ap-south-1` (Mumbai) unless `AWS_REGION` is set otherwise (`worker/src/rekognition.js:69`). The agreement fixes the region (clause 7.3). |
| Retention and training | AWS may use content processed by some AI services to improve them unless an AI-services opt-out policy is applied. **Action:** the AWS account owner applies an AI-services opt-out policy covering Rekognition (AWS Organizations → Policies → AI services opt-out policies, attached to the account), as Aarakshak also asked on 17 Oct 2026. [Record the date applied.] |
| Status | Configured and answering on the live service (provider probe, 17 Oct 2026). Name it as a sub-processor in every department's data-sharing agreement. Removing it changes how matches are filtered (DPIA R1). |

## 5. OpenStreetMap Foundation — Nominatim

| | |
|---|---|
| What it does | Turns a sighting's latitude and longitude into a state and district, so the report reaches the right desk (`shared/geocode.js`). |
| What it receives | The coordinates only, and only when the reporter did not type both state and district (`shared/geocode.js:116-133`). The request comes from the Worker with Khozo's User-Agent (`shared/geocode.js:25`), not from the citizen's phone, so Nominatim does not see the citizen's IP. |
| Where | [OpenStreetMap Foundation servers, outside India — confirm.] |
| Why | Routing. A failed lookup changes nothing; the sighting then reaches every desk. |
| Open points | The coordinates of where a child or woman was seen leave India. [Replace with a self-hosted geocoder or an Indian provider by [date]: DPIA G11.] |

## 6. Google LLC — Google Fonts

| | |
|---|---|
| What it does | Supplies the Noto Sans Gujarati and Devanagari fonts (`web/index.html:10-12`). |
| What it receives | Every visitor's browser contacts `fonts.googleapis.com` and `fonts.gstatic.com` on each page, including the public sighting page and the officer console: IP address, browser details and the site's address. |
| Where | Global. |
| Open points | [Self-host the fonts with the web app by [date]: DPIA G11.] This is a small change and removes Google entirely. |

## 7. SMS gateway — [provider]

| | |
|---|---|
| Status | **Not connected** (the console's readiness panel says so: `shared/routes/dashboard.js` readiness). Until it is, parents and NGOs cannot sign themselves up, and officers call families. |
| What it would receive | A phone number and a message: a 6-digit sign-up code (`shared/routes/auth.js`), or "there is news about the case you registered ([case id]), please contact [desk] on [phone]", never a location (`shared/case-domain.js` `familySmsText`; `shared/sms.js`). |
| Requirements | An Indian provider, registered on DLT [confirm]; no retention of message text beyond [N] days; no other use. |

## 8. Email

Khozo sends **no email**: no email code exists in `shared/`, `server/`, `worker/` or `web/`.
Email addresses are stored as sign-in names, and on cases and grievances as contact details. If
email alerts are added, the provider is listed here first.

## Recipients that are not processors

| Who | What | How |
|---|---|---|
| CWC, JJB, NCRB, TrackChild, Khoya-Paya, CCTNS, State portals | A signed case hand-off export without guardian contacts, identity numbers or photos (`shared/case-domain.js:815-829`) | Downloaded by an officer and sent by the Department under its own authority |
| WhatsApp | Nothing from Khozo. The Network page links to a desk's number (`web/src/dashboard/Network.jsx:91`); anything sent is the officer's act | The SOP forbids sending case details |
| GitHub | Source code and the Android app download; must never hold personal data (`SECURITY.md`; `scripts/import-gujarat-cases.mjs` header) | — |

## Change log

| Date | Change | Notice given |
|---|---|---|
| 17 Oct 2026 | First version | — |
