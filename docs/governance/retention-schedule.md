# Khozo retention schedule

> **DRAFT for legal review — not legal advice.**
> Version 0.1 · 17 October 2026 · Schedule 4 to the data-sharing agreement.
> "In the code" is what Khozo does today. "Department decision" is what the Department sets
> before signature; until it does, the code's period applies. [Legal to check every period
> against the Department's record-retention rules and any court order.]

## The one thing to know first

**Khozo now acts on retention dates, but deletes only once the Department says so.** Every night
the Worker plans the schedule below (`shared/retention.js`, run from `worker/src/ops.js`
`runRetention`) and tells the super admins what has reached its date. It anonymises records
only when the deployment sets `KHOZO_RETENTION_ENFORCE=on`, which the Operator does once the
Department approves this schedule in writing. Until then the plan is a notice and the
Privacy review queue is where officers act; a super admin can also run the schedule from
`POST /api/dashboard/privacy/retention-sweep`, which needs an approval reference.

Anonymising, by the job or by an officer, deletes the photograph and clears every field not
on an allow-list of non-identifying fields (DPIA G1, fixed on the branch
`dpia-and-trafficking-fixes`, 18 October 2026; confirm it is deployed).

## Schedule

| # | Record | Holds | In the code | Source | End of period, today | Department decision |
|---|---|---|---|---|---|---|
| 1 | **Missing-person case** (registered by police, parent or NGO, or imported) | Name, photo, Aadhaar (optional), profile, guardian contacts, declaration, workflow, care, legal and adoption records | `retentionUntil` = registration + **3,650 days (10 years)** | `shared/case-domain.js:23`; `shared/routes/reports.js` `POST /` | Marked expired; kept | Open case: kept while open, reviewed every [year]. **Found or closed: kept 10 years from the day it ended** (or its own date, whichever is later), so the record and its photographs are there if the same person goes missing again (`shared/retention.js` `caseKeepUntil`, 22 Oct 2026). Closing a case removes it from matching and from the face index; it deletes nothing. [Department to confirm the 10 years.] *An imported case missing since 2007 gets a fresh 10 years from its import.* |
| 2 | **Case photograph** | Image bytes in `photo_blobs` | Same as the case | `server/sql/001_schema.sql:32` | Deleted when the case is anonymised | As row 1; deleted with the case |
| 3 | **Found-child case** opened from a sighting | As row 1; its photo is the sighting's | 10 years | `reports.js` `POST /found/:id/formal-intake` | Kept | As row 1. The case keeps its own copy of the photo for the case period (DPIA G25, fixed). |
| 4 | **Sighting** and its photo | Photo, place and GPS, category, age, gender, note, reporter's name and phone, ID type and last 4 digits, match evidence | `retentionUntil` = submission + **180 days** | `case-domain.js:24`; `reports.js` `POST /found` | Anonymised, photo deleted, unless escalated: a confirmed match, or a link waiting on an open case, is kept as long as that case (`shared/retention.js`). With enforcement off, listed for review | 180 days, extended while linked to an open case, as the upload form tells the citizen. |
| 5 | **Sighting receipt stage** (public) | Not a record: what the receipt page shows | *Received* for 1 day, *under review* to 30 days, then *closed* | `case-domain.js:585-587` | — | — |
| 6 | **Sighting waiting to send** (web) | The full form and photo, on the citizen's device | **72 hours**, AES-GCM encrypted | `web/src/offlineQueue.js:7,38` | Removed from the queue | — |
| 7 | **Sighting waiting to send** (Android app) | The form and photo, on the device | **72 hours**, not encrypted | `mobile/src/services/queue.js` `QUEUE_TTL_MS` | Removed from the phone | [Encrypt, as on the web: DPIA G14] |
| 8 | **User account** | Name, email, phone, role, office, jurisdiction, password hash | **No limit** | `001_schema.sql` (`users`) | — | [Disable within [7] days of transfer or retirement; delete [N] months after disabling, keeping the id in the audit log] |
| 9 | **Sign-in session** | Token in the browser | **7 days**; ended early by a password change or "sign out everywhere" | `worker/src/http/express-compat.js:14`; `web/src/auth.jsx:23` | Expires | [Shorter: DPIA G9] |
| 10 | **Sign-up code** (OTP) | Phone number and code, in server memory | **10 minutes** | `shared/routes/auth.js` `OTP_TTL_MS` | Deleted | — |
| 11 | **Rate-limit counters** | IP address and phone, in server memory; the audit log keeps only an HMAC under a deployment secret | **15-minute window**, per server instance | `express-compat.js:15,20` | Discarded | — |
| 12 | **Audit log** | Who did what, when, to which record; entries from 18 Oct 2026 name records **by id only**, older ones include the person's name | **Permanent**; UPDATE and DELETE are refused by the database | `001_schema.sql:194-203` | Never | [Keep [N] years.] *Names already written cannot be removed without breaking the hash chain; new entries carry ids only (DPIA G4).* |
| 13 | **Activity feed** | Officer, action, and the person's name, rewritten to the record id when it is anonymised | **No limit** unless `KHOZO_ACTIVITY_RETENTION_DAYS` is set | `001_schema.sql` (`activity`); `worker/src/ops.js` | Deleted nightly once set | [[2] years] |
| 14 | **Notifications** | Recipient, title, where and when a person was seen | **No limit** unless `KHOZO_NOTIFICATION_RETENTION_DAYS` is set | `server/sql/002_notifications.sql`; `worker/src/ops.js` | Deleted nightly once set | [[90] days] |
| 15 | **Grievance** | Name, phone, email, district, subject, description, history | **No limit** | `shared/routes/grievances.js` `POST /` | — | [[3] years after closure] |
| 16 | **Exports** (hand-off, MIS, privacy, audit) | As each export | Not held by Khozo once downloaded | `case-domain.js:756-829`; `dashboard.js` export routes | — | The Department's own records rules |
| 17 | **Database backups** | Everything above | [Per Supabase plan — confirm] | — | Expire on their own schedule | Deleted data stays until backups expire; state the maximum: [N] days |
| 18 | **Cloudflare Worker logs** | Request details; any errors logged | [Per Cloudflare plan — confirm] | `wrangler.jsonc` `observability` | Expire | [180 days in India if CERT-In's direction applies — legal to confirm: DPIA G17] |
| 19 | **Face-engine copies** | Images sent for comparison | Not stored by Khozo at the provider | `worker/src/match.js`; `worker/src/rekognition.js` | — | **None** kept by Aarakshak or AWS: confirm in writing (agreement clause 10.2) |
| 20 | **CCTV checks from Khozo Desktop** | The case, the officer, each video's name, size, fingerprint, camera place and map point, recording start; how far the laptop got; for each face sent, its moment, what it was found to be, and the engines' scores until the check is closed; the officer's decisions | **As long as the case**; scores dropped when the check is closed; file names, recording times and scores dropped when the case is anonymised | `server/sql/003_video_jobs.sql`; `shared/video-jobs.js` `closedVideoJobPatch`, `anonymisedVideoJobPatch` | Anonymised with the case | [Keep with the case] |
| 21 | **Face pictures on an officer's laptop** (Khozo Desktop) | The faces found in the officer's videos, encrypted | Until the job is deleted, the officer signs out, or 30 days after it was last touched (once Khozo has its decisions) | `desktop/app/jobs.js` `remove`, `sweep`; `desktop/app/secure-store.js` | Deleted from the laptop | [30 days] |
| 23 | **A case's face signatures on a laptop** (Khozo Desktop, laptop answers) | Numbers made from the case's photos, never the photos, encrypted | The check's life: deleted when the check is deleted, the officer signs out, or 30 days pass; Khozo records when | `desktop/app/jobs.js` `signaturesOfCase`, `remove`; `shared/routes/reports.js` close `templateDeletedAt` | Deleted from the laptop | [The check's life] |
| 24 | **Faces from a live camera** (Khozo Desktop) | Only faces close to the case: the face and the whole frame, encrypted. Nothing of anyone else; nothing of the stream recorded | Until the watch is deleted, the officer signs out, or 30 days pass | `desktop/scanner/live.js`; `desktop/app/jobs.js` `runLive` | Deleted from the laptop | [30 days] |
| 22 | **Checks against open cases** (Khozo Desktop) | The officer, their place, the narrowing and how many cases it searched; each video's name, size, fingerprint, camera place and recording start; for each face searched, its moment and answer; for each face close to a case, which case and, until the check is closed, both scores; the officer's word on each | Scores dropped when the check is closed. **No end date yet**: the record has no case to be anonymised with | `server/sql/003_video_jobs.sql` (`report_id` empty); `shared/open-case-checks.js`; `shared/video-jobs.js` `closedVideoJobPatch` | — | [Decide a period, for example 1 year after closing, then drop file names, recording times and the cases named] |

## What happens at the end

**Today** (in the Privacy review queue, `dashboard.js` `POST /privacy/retention/:type/:id`):

| Decision | Who | What it does |
|---|---|---|
| **Extend** | Super admin, admin, police, SJPU, AHTU, CWC, DCPU, state nodal | Sets a new date [default +180 days]. *The reason is not recorded: put it in a case note.* |
| **Close** (mark reviewed) | Same | Records the review. A sighting still pending review is moved to the CWC queue. |
| **Anonymise** | Admin, state nodal, super admin only, with an approval or order reference of at least 6 characters | Keeps only non-identifying fields: category, gender, age, district and state, status, dates (the date gone missing to the month), vulnerability categories, closure reason, and history as kinds and dates without text. **Deletes the photograph.** Removes the case from the face index and rewrites its activity rows to the id. |

**What anonymising leaves behind** (DPIA G1, fixed in code on 18 October 2026): nothing that
names or locates the person. What stays is listed above. Two things cannot be erased: the
person's name in audit entries written before that date (removing it would break the hash
chain), and copies in database backups until they expire (row 17).

**How the schedule runs** (Department to approve before enforcement is switched on):

1. A nightly job lists records that have reached their date, and those due within 30 days, and alerts the super admins. *(Built; the nodal officer is not yet a recipient.)*
2. At the date, unless an officer has extended it or it was escalated, the record is
   anonymised and **its photograph deleted**, and its exclusion from all matching is automatic.
   An open case is never anonymised by the job; it is flagged for review. *(Built; runs when
   `KHOZO_RETENTION_ENFORCE=on`.)*
3. Each deletion is written to the audit log by id, without the name. *(Built.)*
4. A monthly report of deletions goes to the nodal officer.
5. On termination of the agreement, everything is exported and then deleted, including from
   sub-processors and, when they expire, backups (agreement clause 15).

## Approval

| | Name and designation | Signature | Date |
|---|---|---|---|
| Department records officer | [ ] | | |
| Department nodal officer | [ ] | | |
| Operator | [ ] | | |
