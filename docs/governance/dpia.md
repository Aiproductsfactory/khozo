# Khozo data protection impact assessment (DPIA)

> **DRAFT for legal review — not legal advice.**
> Version 0.1 · 17 October 2026 · Prepared by [name, Operator] for [Department name].
>
> **How to read the code references.** Files that other work is changing every day
> (`shared/routes/*.js`) are cited by route or function name, e.g. `reports.js`
> `POST /found`. Stable files are cited by `file:line` as read on 17 October 2026. Some
> controls below exist only in the working tree on that date and are not yet deployed;
> they are marked *(working tree)*. Engineering confirms each one when it reaches
> production.

## 1. Summary

Khozo processes the faces, locations and life circumstances of missing children, women and
adults, takes photographs from anonymous members of the public, and holds police records
shared on the condition that only police see them. Each of these alone would call for an
assessment. Together they make Khozo a high-risk system.

Much of the protection is already in the code: no public gallery, a sighting receipt that
cannot reveal a match, police-only records, two face engines that must agree, a recorded
identity check before a case is marked found, adult consent before a family is told, and a
tamper-evident audit log. When this draft was written, several things the policy promises
were **not true in the code** (section 7): photographs survived anonymisation, Aadhaar
numbers were stored in plain text, nothing was deleted when its retention period ended, and
names stayed for ever in the audit log. Fixes for these and the other code gaps were written
on 18 October 2026 and await deployment; section 7 says which.

**Conclusion (draft):** Khozo may hold a department's records for a supervised pilot once
the gaps marked *Before MoU* in section 7 are closed, or accepted by the Department in
writing with a date. The gaps marked *Before scale* must close before use beyond the pilot.

## 2. Context

| | |
|---|---|
| System | Web app (`web/`), Android app (`mobile/`), API on a Cloudflare Worker (`worker/index.js`, routes in `shared/routes/`), Postgres hosted by Supabase and reached through Cloudflare Hyperdrive (`wrangler.jsonc`; `docs/DEPLOYMENT.md` §1). Photographs are stored in the same database, table `photo_blobs` (`server/sql/001_schema.sql:32`). |
| Data fiduciary | [Department name], for its own records and for sightings routed to it. [Legal to settle who is the fiduciary for public sightings on the shared khozo.org service before any department receives them: gap G26.] |
| Data processor | [Operator legal name]. Sub-processors: [data-processors.md](data-processors.md). |
| People affected | Missing children, women and adults; their guardians; members of the public who send sightings; officers and desk staff. |
| Scale | [Number] department records; [number] sightings a month expected; [number] officer accounts. One database serves every state and department (G10). |
| Already in place | [Confirm: the Gujarat Police (Ahmedabad City) register of missing children has been imported to khozo.org as police-only records (`scripts/import-gujarat-cases.mjs`). This DPIA and the MoU must cover those records, or they should be removed until they do.] |
| Legal frame | JJ Act 2015 ss.2(14)(vii) and 74; Gujarat JJ Rules 2019 r.101(4); DPDP Act 2023 and DPDP Rules 2025 (G.S.R. 846(E), notified 13 Nov 2025; most duties, including s.9, from about 13 May 2027; Rule 12 with Fourth Schedule Part B item 1 exempts s.9(1) and 9(3) for processing in a child's interest by those acting under law); Aadhaar Act ss.29(1) and 33(1); CERT-In Directions of 28 April 2022; Supreme Court, *G. Ganesh v. State of T.N.*, SLP(Crl) 11263/2025, orders of 22 May, 5 Aug and 5 Oct 2026 directing portal integration with NCRB coordinating. |

## 3. Data flows

Each table follows one flow. "Kept" is what the code sets; section 7 says where it is not
enforced.

### Flow A — A citizen sends a sighting (no login)

| Step | Data | Goes to | Stored | Who can see it |
|---|---|---|---|---|
| Capture | Up to three photos (`shared/photo-set.js`); GPS from the first photo, or the phone's location (`web/src/pages/Capture.jsx:181-208`); place, category, age, gender, note; the poster code the form was opened from, if any (`?src=`, `shared/campaign-source.js`; counted in the MIS report, cleared on anonymisation); for a woman or adult, why the reporter thinks she needs help (`shared/sighting-misuse.js`); optional name, phone, ID type and number; when Turnstile is on, a one-time token sent to Cloudflare to check the sender is a person (`shared/human-check.js`) | The citizen's browser or app | If offline: web queue AES-GCM encrypted, 72 h (`web/src/offlineQueue.js:7,38`); app outbox unencrypted, no expiry (`mobile/src/services/queue.js`) | The citizen |
| Submit | All of the above | Cloudflare Worker, `reports.js` `POST /found` | — | — |
| Locate | Latitude and longitude, only when the reporter did not type both state and district | OpenStreetMap Nominatim, called from the Worker (`shared/geocode.js:21,116-133`) | Not by Khozo | Nominatim |
| Screen | The photo; with several, one after another until one shows a person, which becomes the main photo (`shared/routes/reports.js` `POST /found`) | Aarakshak; Rekognition if Aarakshak does not answer (`worker/src/match.js:237-276`) | The verdict, on the record; each other photo screened keeps its own | — |
| Match | The lead photo (the first that shows one face) and up to 25 open cases' lead photos, same district first (`shared/match-pool.js:81-89`; `worker/src/match.js:545`); then, for the five most similar cases only, the other photos of both, at most 20 more comparisons a search (`shared/match-pipeline.js` `compareOtherPairs`, `KHOZO_EXTRA_PAIR_BUDGET`) | Aarakshak; its top 5 to Rekognition, each on the case's best pair (`worker/src/match.js:383-410,447`) | Scores and engine, on the record (`reports.js` `matchEvidence`) | Officers |
| Store | Photo; location; reporter's name and phone in full; ID type and **last 4 digits only** (`shared/case-domain.js:1322-1327`); match evidence | Supabase: `found_reports`, `photo_blobs` | **180 days** (`case-domain.js:24`) | Desks in that district or state; every review desk if no place was given (`shared/scope.js:135-141`); a sighting matched to a police-only case, police only |
| Alert | Where and when, never who | Every review-role account in the country (`reports.js` `notifyAuthorities`); a possible match only to the police who can open that case (`caseOfficers`, `alertSighting`) | `notifications`, no expiry | Recipients |
| Receipt | Receipt id, "received", the place the reporter gave | The citizen (`reports.js` `POST /found`, `officerView` branch) | — | Anyone with the id sees a stage that depends only on time (`case-domain.js:585-631`) |

### Flow B — A parent or NGO registers a missing person

| Step | Data | Goes to | Stored | Who can see it |
|---|---|---|---|---|
| Account | Name, email, password, phone, one-time code | SMS gateway when connected (`shared/sms.js`; `auth.js` `POST /otp/start`) | `users`, no expiry; password as a bcrypt hash | The account holder; admins |
| Register | Name, up to five photos (consent box required; the extra photos are given under the same consent or register basis, and police may add more later, audited as `case.photos_added`), Aadhaar (optional, plain text), profile, guardian contacts, declaration | `reports.js` `POST /` | `reports`, `photo_blobs`; **10 years from registration** (`case-domain.js:23`) | The registrant, through a restricted view (`case-domain.js:725-747`); desks in that district |
| Wait | — | Status `intake_pending` | — | **Not compared with any sighting until an officer verifies it** (`shared/match-pool.js:77-84`; `reports.js` `POST /:id/verify-intake`) |

### Flow C — Police register a case

As Flow B, but verified at once. Registering also compares the photo with up to 50 stored
sightings, nearest first (`reports.js` `matchStoredSightings`; `worker/src/match.js:569`). A
police role may mark the case **police-only** (`case-domain.js:376`).

### Flow D — A department imports its register

| Step | Data | Goes to | Stored | Who can see it |
|---|---|---|---|---|
| Prepare | Spreadsheet or CSV with photos | Read in the officer's own browser (`web/src/bulk/*`); the file itself is never uploaded | On the officer's computer | The officer |
| Send | One case per request, as Flow C | `reports.js` `POST /` | As Flow C; `visibility: 'police'` when "restrict to police" is chosen (`web/src/bulk/records.js:348`); the Gujarat script always sets it (`scripts/import-gujarat-cases.mjs:195`) | Police-only: police roles in scope only (`shared/scope.js:53-71`) |
| Note | `photoConsent` is sent as `true` for every imported row (`web/src/bulk/importer.js:118`; `scripts/import-gujarat-cases.mjs:339`) | | | Gap G15 |

### Flow E — Review, confirmation and telling the family

| Step | Who | What the code does |
|---|---|---|
| Compare | Officers in scope | Both photographs side by side, uncropped, with both engines' scores (`web/src/dashboard/Reunite.jsx` *(working tree)*) |
| Confirm | Police, SJPU, admin, super admin only (`reports.js` `POST /found/:id/review`, `POST /:id/confirm-match`) | Refused without a verification record: method, who verified, where, and a note of at least 10 characters (`case-domain.js` `parseVerification`) *(working tree)*. The method may be in person, video call, documents or other: **the code does not insist on in person** (the SOP does). |
| Tell a child's family | Police roles; CWC may record a contact | An SMS goes only through a connected gateway, and is recorded only if the gateway accepted it; otherwise the officer is told to call and records the call or visit (`reports.js` `smsFamily`, `POST /:id/family-contacted`; `shared/sms.js`) *(working tree)*. The SMS says there is news and whom to call, never where the person is (`case-domain.js` `familySmsText`). |
| Tell an adult's family | Police roles | Refused unless the officer records that the person consented (`PERSON_CONSENT_REQUIRED`) *(working tree for the contact record)*. |
| Undo | Police roles | `POST /:id/reopen` takes a found or closed case back to missing, with a reason, and keeps the history *(working tree)*. |

### Flow F — Referral and hand-off

CWC referral, found-child intake, production records (checked against 24 hours, `reports.js`
`POST /:id/production-record`), care, restoration, legal-aid and adoption records are added
to the case. A signed hand-off export for TrackChild, Khoya-Paya, CCTNS or NCRB leaves out
guardian contacts, identity numbers, photos and free-text notes (`case-domain.js:815-829`),
but includes name, age, gender and district. An officer downloads it and sends it on by hand.

### Flow G — Grievances

Name, phone, email, district, subject and description (`grievances.js` `POST /`), seen by
desks in that state or district. No retention period is set.

## 4. Necessity and proportionality

| Question | Answer |
|---|---|
| Purpose | Tracing missing persons and restoring them safely; child-protection referral; the portal integration the Supreme Court has directed in *G. Ganesh*. |
| Is face matching necessary? | A sighting without a name can only be linked to a case by the face, or by an officer's memory. Matching runs only against open, verified cases with photos (`match-pool.js:81-84`); an unverified citizen intake is never compared (`match-pool.js:77-79`). |
| Minimisation in place | Only the last 4 digits of a reporter's ID are kept; the public sees no identity; alerts carry place and time only; parents see only what they entered; hand-off exports drop contacts and identity numbers; the public desk directory lists offices, not officers (`dashboard.js` `publicDesk`) *(working tree)*. |
| Minimisation missing | Aadhaar is collected and kept in plain text (G2); a "confidential" reporter's phone is still stored in full; CCI, SAA, DLSA and JJB desks see every case in their district in full (G23). |
| Less intrusive option | A text-only sighting is accepted and never face-matched (`reports.js` `POST /found`). |

## 5. Risks

L = likelihood, S = severity (Low, Medium, High), before the controls.

| # | Risk | L | S | Controls in the code | Residual |
|---|---|---|---|---|---|
| R1 | **Misidentification.** A lookalike is confirmed; the wrong family is told, or the wrong child handed over; the real case drops out of the search. | M | H | Only biometric engines produce candidates (`reports.js` `isStrongMatch`); thresholds calibrated on real pairs (`docs/DEPLOYMENT.md` §3); a candidate is withheld unless Rekognition also scores ≥ 0.80 (`worker/src/match.js:360-362,447`) and the lower score is shown; engine disagreement flagged; only police roles confirm; a verification record is required; a wrong confirmation can be reopened *(working tree)*. | Medium. The code accepts a video call or documents as verification. Accuracy across age gap, skin tone and photo quality is unmeasured (6 genuine and 4 impostor pairs). If Rekognition is dropped, as the landing page says it will be in production, Aarakshak alone surfaces candidates from 0.35 and must be re-tested. |
| R2 | **Missed match.** A real match is never compared. | M | H | Nearest-first budget of 25 cases per sighting and 50 sightings per case (`match-pool.js:37-66`); the reverse search covers a case reported after the sighting. | Medium. Beyond a few hundred open cases in an area, distant cases are not compared (`docs/DEPLOYMENT.md` §3). |
| R3 | **Function creep.** Faces used to look for suspects, protesters or anyone not missing. | M | H | Only open, verified case photos are compared; rematch is police-only and audited (`reports.js` `POST /:id/rematch`). | Medium. Nothing technical stops an officer registering a person who is not missing. MoU purpose limits and a monthly audit review are the control. Closed cases and cases past retention are still compared (G3). |
| R4 | **Breach, or misuse of an account.** | M | H | No database access with the public key: RLS on with no policies (`001_schema.sql:182-188`); photos only with a token and jurisdiction (`reports.js` `GET /photo/:key`); the server will not start without a JWT secret (`docs/DEPLOYMENT.md` §2); rate limits. | **High** until G2, G9, G10 and G20 close: no MFA, 7-day tokens in browser storage, one database for every state, plain-text Aadhaar. |
| R5 | **A trafficker or abuser uses the public upload** to learn whether a child or woman is being looked for, or where she was seen, or to flood the desks. | M | H | The same receipt for every reporter (`reports.js` `POST /found`); a receipt stage that depends only on time (`case-domain.js:585-631`); case lookup by random id only, and a police-only case never resolves (`reports.js` `GET /public/status/:ref`); no public gallery or search (`case-domain.js:505`); share previews never carry a case (`worker/index.js` `childCaseDocument`); unverified intakes not compared; parents never see where a person was found (`case-domain.js:725-747`) or a transfer (`scope.js:173-179`); adult consent before family contact. Against photographing strangers: the form asks why a woman or adult needs help before it sends, and says to photograph her only if she asked for help or cannot look after herself; an officer's "Not a concern" deletes the photo at once, and "misuse" reaches the public-abuse queue and the MIS report (`shared/sighting-misuse.js`, `reports.js` `POST /found/:id/dismiss`). | Medium. Rate limits live in memory in each Worker instance (`worker/src/http/express-compat.js:20,152-163`); Turnstile is built but off until configured (G12). A determined sender who answers the question falsely is caught only by an officer's review. |
| R6 | **Re-identification** after "anonymisation", or from exports, logs, photo metadata or location. | H | M | Hand-off exports drop contacts and IDs; alerts carry no identity. | **High.** Anonymising leaves the photograph, profile and notes, and the audit log keeps names for ever (G1, G4). Web uploads keep EXIF (G13). Coordinates go to Nominatim (G11). The rate-limit hash uses a public salt (G18). |
| R7 | **Keeping data too long.** | H | M | Retention dates are set and shown (`dashboard.js` `retentionState`); anonymising needs an approval reference of 6 or more characters and an admin, state nodal or super admin (`dashboard.js` `PRIVACY_ANONYMIZE_ROLES`). | **High** until G3 and G24 close. |
| R8 | **A child identified in public**, against JJ Act s.74. | L | H | Public appeals are off in one place (`case-domain.js:485-507`); publishing answers 403 (`reports.js` `POST /:id/bulletin`). | Low inside Khozo. Officers can still share outside it, e.g. the directory's WhatsApp links (`web/src/dashboard/Network.jsx:91`). The SOP is the control. |
| R9 | **Data leaves India**, or rests with a foreign provider. | M | M | Rekognition defaults to Mumbai (`worker/src/rekognition.js:69`). | Medium until G11 closes: the region is an environment setting; the Supabase region, Cloudflare's processing location and the providers' retention are unconfirmed. |
| R10 | **Bad imported data**: names garbled by legacy Gujarati fonts or transliteration; a consent flag that was never given. | M | M | Converters are tested (`scripts/bulk-import-smoke.mjs`); duplicate checks. | Medium (G15). |
| R11 | **A family is never told.** | M | H | No "SMS sent" unless a gateway accepted it; the officer is given the number and asked to record the call *(working tree)*. | Medium: depends on the SOP until a gateway is connected. |
| R12 | **Wide visibility** of unplaced sightings and of every alert. | H | L | Alerts carry place and time only; opening the record needs jurisdiction. | Medium. A sighting with no place, photo included, is open to every review desk in the country (`scope.js:135-141`), and no officer can assign it a place (G22). |
| R13 | **Audit log tampering or loss.** | L | M | UPDATE and DELETE blocked by a trigger (`001_schema.sql:194-203`); the hash chain detects edited and deleted rows and counts concurrent branches (`shared/audit-chain.js`); a gap can only be acknowledged in the log itself. | Low to medium. TRUNCATE, or a database owner dropping the trigger, is not blocked. Gaps since 1 Aug 2026 have been acknowledged (`shared/audit-chain.js` header). |
| R14 | **Outage** during a live search. | M | H | Writes are flushed before the response is sent (`worker/index.js`). | Medium. [Confirm the Cloudflare plan; CPU-limit errors (HTTP 503) have been seen.] |

## 6. Controls that exist today

| Control | Where |
|---|---|
| The public never sees a name or photo | `case-domain.js:485-507` (`isPublicAppeal` is always false); `reports.js` `GET /photo/:key` needs a token and jurisdiction |
| A sighting receipt cannot reveal a match | `case-domain.js:567-631`; `reports.js` `POST /found` |
| Police-only records | `scope.js:53-71`; match alerts only to that case's police (`reports.js` `caseOfficers`) |
| Parents and NGOs see only their own cases, in a restricted view | `scope.js:98-103`; `case-domain.js:705-747` |
| Unverified citizen cases are not face-searched | `match-pool.js:68-84` |
| Two engines must agree; a score never decides | `worker/src/match.js:383-410,447`; `reports.js` `isStrongMatch` |
| Only police roles confirm; a verification record is required | `reports.js` `POST /found/:id/review`, `POST /:id/confirm-match`; `case-domain.js` `parseVerification` *(working tree)* |
| No false "SMS sent"; family contact recorded | `shared/sms.js`; `reports.js` `smsFamily`, `POST /:id/family-contacted` *(working tree)* |
| Adult consent before family contact | `reports.js` `POST /:id/send-sms`, `POST /:id/family-contacted`, `POST /:id/confirm-match` |
| A wrong confirmation can be reopened | `reports.js` `POST /:id/reopen` *(working tree)* |
| Reporter's ID kept as the last 4 digits | `case-domain.js:1322-1327` |
| A confidential reporter is hidden from desks | `reports.js` `GET /found/all` |
| Database closed to the public key | `001_schema.sql:182-188` |
| Append-only, hash-chained audit log | `001_schema.sql:194-203`; `shared/audit-chain.js` |
| Privacy review queue: extend, close, or anonymise with an approval reference | `dashboard.js` `GET /privacy/retention`, `POST /privacy/retention/:type/:id`, `GET /privacy/export` |
| Hand-off export minimised and signed | `case-domain.js:756-829` |
| Production before the CWC checked against 24 hours | `reports.js` `POST /:id/production-record` |
| Public desk directory lists offices, not officers | `dashboard.js` `publicDesk` *(working tree)* |

## 7. Open gaps

Each is being fixed unless marked otherwise; engineering updates the Status column as each is
merged and deployed. On 18 October 2026 every gap that is a matter of code rather than policy
was fixed on the branch `dpia-and-trafficking-fixes`, with a test for each (`npm run test:all`:
`smoke:privacy`, `smoke:photo-strip`, and the API smoke suite on both runtimes). "Fixed in code"
means merged code, not production: confirm each against the deployed service before signature.
**Before MoU**: close it, or the Department accepts it in writing with a date, before records
are shared. **Before scale**: close before use beyond the pilot.

| # | Gap | Evidence | When | Status |
|---|---|---|---|---|
| G1 | **Photographs are not deleted when a record is anonymised.** Only `photoUrl` is cleared; the bytes stay in `photo_blobs`. `deletePhoto` exists but nothing calls it. Also left behind: the profile, notes, FIR number, declaration signer, workflow, care records, `foundLocation` (often the GPS coordinates as text), and on a sighting the reporter's display name, visible phone and masked ID. | `dashboard.js` `POST /privacy/retention/:type/:id`; `server/src/store.js:632`; `worker/src/db.js:202` | Before MoU | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): anonymising deletes the photograph and clears every field not on an allow-list (`shared/privacy.js`, `shared/retention.js`); activity rows are rewritten to the id. [Confirm deployed] Since a record can hold several photos (branch `multi-photo`, 19 Oct 2026), anonymising, removing a photo and both purge scripts delete every one of them (`photoFilesOf`, `shared/photo-set.js`). |
| G2 | **Aadhaar numbers stored in plain text**, and shown to the registering parent and to every desk in scope. No personal field is encrypted at application level. | `reports.js` `POST /`; `case-domain.js:725-731` | Before MoU | Fixed in code for new cases (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): only the last four digits and a keyed fingerprint are stored (`shared/privacy.js`). Existing cases: run `scripts/migrate-aadhaar.mjs --apply` after deploying. [Confirm deployed and migrated] |
| G3 | **No retention job.** The Worker has no scheduled handler and `wrangler.jsonc` no cron, so nothing happens when a date passes. Expired sightings are only left out of the reverse search; closed cases and cases past retention are still compared with every new sighting. | `worker/index.js` (fetch only); `match-pool.js:81-84,133` | Before MoU | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): a nightly retention plan alerts the super admins (`worker/src/ops.js` `runRetention`, `shared/retention.js`) and anonymises only with `KHOZO_RETENTION_ENFORCE=on`. Closed and anonymised cases are out of matching; an open case past its date is flagged for review, never removed. [Confirm deployed; Department decision on enforcement] |
| G4 | **Names in the permanent logs.** Audit and activity summaries carry the person's name, including "Anonymized retention for [name]". The audit log cannot be edited, so these can never be erased. | `reports.js` `POST /` (`case.fir_registered`); `dashboard.js` anonymise audit row | Before scale | Fixed in code for new entries (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): summaries name cases and sightings by id, and the closing note is out of the audit metadata. Rows already written cannot change without breaking the hash chain. [Confirm deployed] |
| G5 | **"Verified" does not mean "in person".** A verification record is now required, but the code accepts video call, documents or other. | `case-domain.js` `VERIFICATION_METHODS` | Before MoU: SOP rule | SOP closes it; [decide whether the code should insist] |
| G6 | **No SMS gateway connected.** Family SMS and parent/NGO sign-up codes need one. Until then families are called. | `dashboard.js` readiness note; `shared/sms.js` | Before scale | Open |
| G7 | **Adult consent is a yes/no flag.** It is stored in the audit metadata of a family contact, but not how it was obtained or who witnessed it. | `reports.js` `POST /:id/family-contacted` | Before MoU | Partly fixed *(working tree)* |
| G8 | **Fixes not yet live.** Verification record, reopen, honest SMS and family-contact record exist only in the working tree on 17 Oct 2026. | `git status` | Before MoU | [Confirm deployed]. The same applies to every fix marked "Fixed in code" below. |
| G9 | **Account security.** No MFA; 7-day tokens kept in browser storage with no way to revoke them; bcrypt cost 8; an account provisioned without a jurisdiction sees everything at its level. | `express-compat.js:14`; `web/src/auth.jsx:23`; `auth.js` `bcrypt.hashSync(…, 8)`; `scope.js:81-97` | Before MoU (jurisdiction); before scale (the rest) | Partly fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): token versions let a password change or `POST /api/auth/logout-all` end every session; bcrypt cost 10, upgraded at sign-in; a deployed Worker without `KHOZO_JWT_SECRET` refuses tokens; jurisdiction fails closed (`scope.js` `hasJurisdiction`). Open: MFA, token lifetime, browser storage. |
| G10 | **One shared database** for every department; separation is enforced in code only. `super_admin` sees every record, police-only included. | `scope.js:75-76` | Before MoU: the MoU names who may hold super admin | Open |
| G11 | **Localisation not shown.** Supabase region unconfirmed; Cloudflare processing not pinned to India; Nominatim and Google Fonts outside India; the AWS region is an environment setting. The landing page says "A child's face never leaves India" and that records stay in "the Department's own database". | `rekognition.js:69`; `geocode.js:21`; `web/index.html:10-12`; `web/src/pages/Landing.jsx` (Sovereignty section) | Before MoU | Open |
| G12 | **Weak abuse controls on the public upload**: an in-memory, per-instance rate limit; no CAPTCHA. | `express-compat.js:20,152-163`; `reports.js` `foundReportLimit` | Before scale | Partly fixed in code (branch `poster-qr-source`, 19 Oct 2026): the limit is keyed on the network address alone (a typed phone number used to reset it); Cloudflare Turnstile on the form, off until `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` and `TURNSTILE_HOSTNAMES` are set, refusing only a false token and holding a report without a passed check to a stricter limit (`shared/human-check.js`). Open: limits are still per Worker instance; the Turnstile widget must be created and its keys set. [Confirm deployed] |
| G13 | **EXIF kept** on web uploads (GPS, device). Photos are stored as received. | `reports.js` `storePhoto` | Before scale | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): GPS, device, comment, XMP and trailer data are stripped from every upload before it is stored or sent to a face engine; the orientation flag is kept (`shared/photo-strip.js`). [Confirm deployed] |
| G14 | **App outbox unencrypted, with no expiry.** | `mobile/src/services/queue.js` | Before scale | Partly fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): unsent reports are removed after 72 hours (`queue.js` `QUEUE_TTL_MS`). Open: encryption at rest. Needs an app rebuild. |
| G15 | **Imports claim a photo consent** nobody gave. They should record "basis: department register". | `web/src/bulk/importer.js:118`; `scripts/import-gujarat-cases.mjs:339` | Before MoU | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): imports send `photoBasis: department_register`, recorded on the case instead of a consent. [Confirm deployed] |
| G16 | **Wording that does not match the code.** "Retained for 180 days unless escalated": nothing extends it on escalation. "Retained for the case lifecycle": it is 10 years from registration. The app says a confidential reporter's name and number are "hidden from the case record": they are stored, and hidden only on screen. | `Capture.jsx:40,50,60`; `web/src/dashboard/RegisterChild.jsx:327-329`; `mobile/src/screens/ReportSightingScreen.jsx:512` | Before MoU | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): the registration form states the 10-year period, the app says a confidential reporter's details are stored but hidden on screen, and the retention job keeps an escalated sighting with its case. [Confirm deployed; app rebuild] |
| G17 | **Logs and incident response.** Cloudflare logs are on; their retention and location are unconfirmed. CERT-In requires ICT logs kept for 180 days in India [legal to confirm it applies]. No written incident plan. | `wrangler.jsonc` `observability` | Before MoU | Open |
| G18 | **Rate-limit audit hash uses a fixed public salt**, so a phone number or IP behind it can be recovered. | `express-compat.js:120-127` | Before scale | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): an HMAC under `KHOZO_RATE_LIMIT_AUDIT_SALT`, or a key derived from the JWT secret (`shared/privacy.js`). [Confirm deployed] |
| G19 | **Export signing falls back to a public demo key** if `KHOZO_EXPORT_SIGNING_KEY` is unset. | `case-domain.js:762-763` | Before MoU: confirm it is set | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): without `KHOZO_EXPORT_SIGNING_KEY` the key is derived from the JWT secret, never a repository constant. [Confirm the explicit key is set] |
| G20 | **The database password was committed** to the public repository's history. | `docs/DEPLOYMENT.md` §2 | Before MoU: confirm rotated | [Confirm] |
| G21 | **Hosting accounts and plan.** | — | Before MoU: [confirm the Cloudflare and Supabase accounts belong to the Operator organisation, not a person, and record the plan's limits] | [Confirm] |
| G22 | **Unplaced sightings** are open to every review desk, and no action exists to place one. | `scope.js:135-141` | Before scale | Fixed in code: `reports.js` `POST /found/:id/place` lets an officer place a sighting; until then it reaches every review desk. |
| G23 | **Broad desk access.** CCI, SAA, DLSA and JJB desks see every non-police-only case in their district in full, Aadhaar and guardian contacts included. | `scope.js:84-97`; `reports.js` `GET /` | Before scale | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): CCI, SAA, JJB and DLSA desks see cases without the family's phone, e-mail or address, and every desk sees Aadhaar masked (`shared/privacy.js` `deskCaseView`). [Department to confirm the role list] |
| G24 | **No retention at all** for accounts, notifications, activity and grievances. | `001_schema.sql`; `grievances.js` `POST /` | Before scale | Partly fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): `KHOZO_NOTIFICATION_RETENTION_DAYS` and `KHOZO_ACTIVITY_RETENTION_DAYS` delete older rows nightly once set. Open: accounts and grievances. [Department to set the periods] |
| G25 | A found-child case opened from a sighting **reuses the sighting's photograph** (180 days) inside a 10-year case. | `reports.js` `POST /found/:id/formal-intake` | Before scale | Fixed in code: the intake keeps its own copy of the photo for the case period (`reports.js` `POST /found/:id/formal-intake`). |
| G26 | **Who is the fiduciary** for public sightings on the shared service. | — | Before MoU | [Legal] |
| G27 | **No written evidence** that AWS's AI-services opt-out is set, or that Aarakshak keeps nothing and trains on nothing. | — | Before MoU | [Confirm in writing] |

## 8. Residual risk and decision

| | Now | After the *Before MoU* gaps close |
|---|---|---|
| Misidentification (R1, R11) | Medium (High if G8 is not deployed) | Medium |
| Breach and misuse (R4) | High | Medium |
| Re-identification and over-retention (R6, R7) | High | Medium |
| Public-upload abuse (R5) | Medium | Medium; Low after G12 |

[Department decision: proceed / proceed with conditions / do not proceed.]

## 9. Consultation

| Who | Date | Outcome |
|---|---|---|
| [Department nodal officer] | [date] | |
| [Child Welfare Committee representative] | [date] | |
| [Legal adviser] | [date] | |
| [Operator security lead] | [date] | |

## 10. Sign-off

| Role | Name and designation | Signature | Date |
|---|---|---|---|
| Prepared by (Operator) | [ ] | | |
| Reviewed by (Department nodal officer) | [ ] | | |
| Legal review | [ ] | | |
| Approved for the data fiduciary (Department) | [ ] | | |
| Conditions of approval | [gaps accepted, with dates] | | |

Next review: [date, within 12 months, or sooner on any change to a flow, engine or processor].
