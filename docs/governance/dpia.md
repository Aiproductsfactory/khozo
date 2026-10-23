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
| Store | Photos (up to three); location; reporter's name and phone in full; ID type and **last 4 digits only** (`shared/case-domain.js:1322-1327`); match evidence | Supabase: `found_reports`, `photo_blobs` | **180 days** (`case-domain.js:24`) | Desks in that district or state; every review desk if no place was given (`shared/scope.js:135-141`); a sighting matched to a police-only case, police only |
| Alert | Where and when, never who | Every review-role account in the country (`reports.js` `notifyAuthorities`); a possible match only to the police who can open that case (`caseOfficers`, `alertSighting`) | `notifications`, no expiry | Recipients |
| Receipt | Receipt id, "received", the place the reporter gave | The citizen (`reports.js` `POST /found`, `officerView` branch) | — | Anyone with the id sees a stage that depends only on time (`case-domain.js:585-631`) |

### Flow B — A parent or NGO registers a missing person

| Step | Data | Goes to | Stored | Who can see it |
|---|---|---|---|---|
| Account | Name, email, password, phone, one-time code | SMS gateway when connected (`shared/sms.js`; `auth.js` `POST /otp/start`) | `users`, no expiry; password as a bcrypt hash | The account holder; admins |
| Register | Name, up to five photos (consent box required; the extra photos are given under the same consent or register basis, and police may add more later, audited as `case.photos_added`), Aadhaar (optional, plain text), profile, guardian contacts, declaration | `reports.js` `POST /` | `reports`, `photo_blobs`; **10 years from registration** (`case-domain.js:23`) | The registrant, through a restricted view (`case-domain.js:725-747`); desks in that district |
| Wait | — | Status `intake_pending` | — | **Not compared with any sighting until an officer verifies it** (`shared/match-pool.js:77-84`; `reports.js` `POST /:id/verify-intake`) |

### Flow C — Police register a case

As Flow B, but verified at once. Registering also compares the photo (the one of its photos that shows one face) with up to 50 stored
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

CWC referral, found-child intake (which keeps its own copy of the sighting's photos that show one person), production records (checked against 24 hours, `reports.js`
`POST /:id/production-record`), care, restoration, legal-aid and adoption records are added
to the case. A signed hand-off export for TrackChild, Khoya-Paya, CCTNS or NCRB leaves out
guardian contacts, identity numbers, photos and free-text notes (`case-domain.js:815-829`),
but includes name, age, gender and district. An officer downloads it and sends it on by hand.

### Flow G — Grievances

Name, phone, email, district, subject and description (`grievances.js` `POST /`), seen by
desks in that state or district. No retention period is set.

### Flow H — Video (`shared/video-search.js`, `web/src/video/`)

A video is never uploaded, in either use. It is opened by the browser on the device that
has it. Faces are found there by a small detector that only finds faces (YuNet, run by
onnxruntime-web); it cannot recognise anyone.

| Step | Data | Goes to | Stored | Who can see it |
|---|---|---|---|---|
| Pictures from a video (public form, case registration, adding a case photo) | The faces found, as small pictures, and the moment each was seen; the person picks up to 3 (a sighting) or 5 (a case) | The person's own browser | Not stored until sent | The person |
| Send | The chosen pictures, as the photos, and for a sighting the moments ("0:12, 0:47", `videoFrames`) | `reports.js` `POST /found` or `POST /` | As any photo of that record; the sighting keeps `fromVideo.times` | As Flow A or C |
| CCTV search: read | The whole video, on the officer's computer; its SHA-256 fingerprint, computed there | The officer's browser | Not stored | The officer |
| CCTV search: compare | Up to 300 face pictures, the clearest of each person seen, 5 a request, with the camera's place, the file's name, size, length and fingerprint | `reports.js` `POST /:id/video-search` (police roles, a case they can open, the cases the reverse search runs for); each picture to Aarakshak, and to Rekognition only when Aarakshak puts it at or above the review line or cannot read it (`shared/match-pipeline.js` `compareFramesWithCase`) | **No picture and no face template is kept.** The audit row keeps the officer, case, camera place, file details and fingerprint, each picture's moment, verdict and scores | Audit readers |
| Result | A verdict a picture: likely, possible, not a match, no face, not checked | The officer | A case note only if the officer adds one | Desks that can open the case |

### Flow H2 — Long CCTV footage on a police laptop (Khozo Desktop, `desktop/`, `shared/video-jobs.js`)

For footage of 30 minutes to many hours. The officer signs in with their Khozo account; police
roles only, for an open, verified case they can open. The video stays on the laptop.

| Step | Data | Goes to | Stored | Who can see it |
|---|---|---|---|---|
| Read | The whole video; the faces in it, kept as small pictures, and each face's five points | The officer's laptop | Encrypted on that laptop (AES-256-GCM, the key held by Windows for that user), in the officer's own folder. Deleted when the job is deleted, when the officer signs out, or 30 days after it was last touched once Khozo has its decisions (`desktop/app/jobs.js` `sweep`) | The officer |
| First pass | Each face compared on the laptop with the case's photos, with Aarakshak's own model; only the closest are sent | The laptop | The case's photos are held in memory only | The officer |
| Start the check | The case, the videos (name, size, length, fingerprint), each camera's place and map point, the recording start | `reports.js` `POST /:id/video-jobs` | The check's record (`video_jobs`), kept with the case | Desks that can open the case; the command centre sees counts only |
| Compare | Up to 5 face pictures a request and 5,000 a check (`KHOZO_DESKTOP_JOB_FACES`), with each face's moment and the laptop's name for the person | `reports.js` `POST /:id/video-jobs/:jobId/faces`; each picture to Aarakshak, and to Rekognition as in Flow H | **No picture is kept.** The check keeps, for each face, its moment, what it was found to be and the engines' scores **until the check is closed**; then only what it was found to be. The audit row keeps each face's moment and verdict, not its scores | Desks that can open the case |
| Decide | "Same person": the face picture and the whole frame. "Not this person": nothing but the decision | `POST .../decisions` | "Same person" becomes a police sighting of the case, waiting for review, kept as any sighting (Flow C); "not" is counted for false alarms | As a sighting; the case's officers are alerted |
| Anonymise | When the case is anonymised, its checks lose file names, recording times and scores; the counts stay | `shared/retention.js` | — | — |

### Flow H3 — Footage against open cases (Khozo Desktop, `shared/open-case-checks.js`)

For footage from a busy place with no one case: a railway station, a bus stand. **Off** unless
`KHOZO_DESKTOP_OPEN_CASES` is on, which waits on Aarakshak's written permission to use its gallery
live (A3) and the legal advice in the desktop specification (section 16). Police roles only.

| Step | Data | Goes to | Stored | Who can see it |
|---|---|---|---|---|
| Narrow | The officer chooses sex, an age band, a district and when the person went missing; Khozo says how many open cases that is. District desks search their state (`KHOZO_DESKTOP_OPEN_CASES_AREA=district`: their district); state desks their state | `reports.js` `GET /open-case-checks/cases` | — | The officer |
| Read | As Flow H2. No case photo and no case template is on the laptop | The officer's laptop | As Flow H2 | The officer |
| Search | Each person's clearest face, one a request, up to 600 a video and 5,000 a check | `POST /open-case-checks/:jobId/faces`: Aarakshak's index (50 closest), then the closest five of the officer's chosen cases compared pairwise by Aarakshak and Rekognition | **No picture is kept.** A face is shown only when the case is in the index's five closest **and** Aarakshak is at least 0.45 **and** Rekognition at least 0.90. The check keeps each face's moment and answer, and for each such face the case and both scores **until the check is closed**; then the case alone | The officer sees a case only if they can open it; for any other case, only that one exists |
| Send | "Send to the case": the face picture and the whole frame | `POST /open-case-checks/:jobId/leads/:leadId` | A police sighting of that case, waiting for its officers' review (Flow C); an officer who cannot open the case is told only "sent" | That case's officers, who are alerted |
| Audit | One row per face searched, on the officer's place, naming no case; one row per face close to a case, on that case's place | `addAudit` | As the audit log | Audit readers of each place |

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
| R15 | **Bystanders in CCTV.** Searching a camera recording compares the faces of everyone in it, none of whom is missing, and could be turned to finding someone who is not missing. | M | H | The video stays on the officer's computer; each face is compared with one case's photo only, never searched across cases or kept (`shared/routes/reports.js` `POST /:id/video-search`); police roles only, for open, verified cases; the camera's place is required; every request is audited with the file's fingerprint (`case.video_searched`); at most 300 faces a search, 5 a request, 200 requests a quarter-hour an officer. Khozo Desktop (Flow H2) reads far longer footage, so it allows up to 5,000 faces a check; with Aarakshak's model on the laptop only the faces closest to the case's photo are sent, usually a few dozen a video. The faces found stay encrypted on the officer's laptop until the job is deleted, the officer signs out, or 30 days pass. | Medium. The same gap as R3: nothing stops an officer registering a person who is not missing and then searching footage for them. The monthly audit review must read `case.video_searched` rows against open cases. Faces are sent to Aarakshak and Rekognition under the existing agreements; [confirm both agreements cover faces of people who are not in any case]. |

| R16 | **Searching passers-by across every open case.** A check against open cases (Flow H3) compares each face in a busy place's footage with hundreds of cases: many more chances of a false alarm, and a tool that could be turned to finding anyone in the index. | M | H | Off unless switched on after Aarakshak's permission and legal advice; police roles only; the officer narrows the cases first; a face is shown only above a higher bar than a one-case check (index top five, Aarakshak 0.45 and Rekognition 0.90, "possible" never shown); a case outside the officer's area is never named to them, and the face goes to that case's own officers to look at; each face searched and each face close to a case is audited, the latter on the case's own place; 5,000 faces a check; nothing about the people searched is kept but their moment and answer. | Medium to high until measured. The false-alarm rate per hour of footage is not known until Phase 1's checks are counted (`/app/cctv-checks`) and the solved-case calibration (spec Phase 0) is done. The bar should be set from those numbers before the switch is turned on. |

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
| G8 | **Fixes not yet live.** Verification record, reopen, honest SMS and family-contact record exist only in the working tree on 17 Oct 2026. | `git status` | Before MoU | Deployed. On 22 Oct 2026 every branch marked "Fixed in code" below (`dpia-and-trafficking-fixes`, `poster-qr-source`, `plain-language`, `multi-photo`, `photo-capture-quality`) was confirmed inside the live version (7779215, `main`); `npm run check:live` confirms a deploy from outside. |
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
| G20 | **The database password was committed** to the public repository's history: `scripts/test-supabase-basic-auth.mjs`, commit `baae704`, reachable from `main` and every branch on the public repository. | `docs/DEPLOYMENT.md` §2 | **Now**: the repository is public | Open until rotated. Steps in `docs/OPERATIONS.md` §3 (new password in Supabase, then the Hyperdrive config and every `DATABASE_URL`). Deleting the file or rewriting history does not help: copies already exist. |
| G21 | **Hosting accounts and capacity.** On 22 Oct 2026 the site runs in a personal Cloudflare account, and deploys need that person. It has not yet been tested with the number of reports a public campaign may bring. | — | Before MoU and before the campaign | Open. Put Cloudflare, Supabase, AWS, the domain and GitHub under the Operator, with two administrators each (checklist in `docs/OPERATIONS.md` §5). Test the site under heavy use before launch (feasibility report, condition C6). |
| G22 | **Unplaced sightings** are open to every review desk, and no action exists to place one. | `scope.js:135-141` | Before scale | Fixed in code: `reports.js` `POST /found/:id/place` lets an officer place a sighting; until then it reaches every review desk. |
| G23 | **Broad desk access.** CCI, SAA, DLSA and JJB desks see every non-police-only case in their district in full, Aadhaar and guardian contacts included. | `scope.js:84-97`; `reports.js` `GET /` | Before scale | Fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): CCI, SAA, JJB and DLSA desks see cases without the family's phone, e-mail or address, and every desk sees Aadhaar masked (`shared/privacy.js` `deskCaseView`). [Department to confirm the role list] |
| G24 | **No retention at all** for accounts, notifications, activity and grievances. | `001_schema.sql`; `grievances.js` `POST /` | Before scale | Partly fixed in code (branch `dpia-and-trafficking-fixes`, 18 Oct 2026): `KHOZO_NOTIFICATION_RETENTION_DAYS` and `KHOZO_ACTIVITY_RETENTION_DAYS` delete older rows nightly once set. Open: accounts and grievances. [Department to set the periods] |
| G25 | A found-child case opened from a sighting **reuses the sighting's photograph** (180 days) inside a 10-year case. | `reports.js` `POST /found/:id/formal-intake` | Before scale | Fixed in code: the intake keeps its own copy of the photo for the case period (`reports.js` `POST /found/:id/formal-intake`). Since a sighting can carry up to three photos (branch `multi-photo`), the intake also copies those of its other photos whose check shows one person, under the same photo ids, for the case period; a group photo or one with no person stays with the sighting and is deleted with it. |
| G26 | **Who is the fiduciary** for public sightings on the shared service. | — | Before MoU | [Legal] |
| G27 | **No written evidence** that AWS's AI-services opt-out is set, or that Aarakshak keeps nothing and trains on nothing. Switching on the face index (search every open case at once) changes this: Aarakshak would then hold a face template of every open case, the Department's police-only register included. | — | Before MoU; before the face index is switched on | Open. Data-sharing agreement 10.3 sets the terms (templates and case ids only, in India, no training, removed on closure with a receipt, Department's written agreement first); request to Aarakshak drafted 22 Oct 2026. [Confirm in writing] |

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
