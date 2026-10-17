# Khozo retention schedule

> **DRAFT for legal review — not legal advice.**
> Version 0.1 · 17 October 2026 · Schedule 4 to the data-sharing agreement.
> "In the code" is what Khozo does today. "Department decision" is what the Department sets
> before signature; until it does, the code's period applies. [Legal to check every period
> against the Department's record-retention rules and any court order.]

## The one thing to know first

**Khozo sets retention dates but does not act on them.** There is no scheduled job: the Worker
has only a request handler (`worker/index.js`) and `wrangler.jsonc` declares no cron. When a
date passes, the record is marked *expired* in the Privacy review queue
(`shared/routes/dashboard.js` `retentionState`: *expired* after the date, *due soon* within 30
days) and stays exactly as it was until an officer acts. Anonymising today also leaves the
photograph in the database (see "What happens at the end"). Both are being fixed (DPIA G1, G3);
until then the monthly review in the Officer SOP, section 10, is the only control.

## Schedule

| # | Record | Holds | In the code | Source | End of period, today | Department decision |
|---|---|---|---|---|---|---|
| 1 | **Missing-person case** (registered by police, parent or NGO, or imported) | Name, photo, Aadhaar (optional), profile, guardian contacts, declaration, workflow, care, legal and adoption records | `retentionUntil` = registration + **3,650 days (10 years)** | `shared/case-domain.js:23`; `shared/routes/reports.js` `POST /` | Marked expired; kept | [Open case: kept while open, reviewed every [year]. Found or closed: [N] years after closure.] *The code counts from registration, not from closure or the date of going missing: an imported case missing since 2007 gets a fresh 10 years from its import.* |
| 2 | **Case photograph** | Image bytes in `photo_blobs` | Same as the case | `server/sql/001_schema.sql:32` | Kept, **even after anonymising** | As row 1; deleted with the case |
| 3 | **Found-child case** opened from a sighting | As row 1; its photo is the sighting's | 10 years | `reports.js` `POST /found/:id/formal-intake` | Kept | As row 1. *The case points to the sighting's photo (row 4, 180 days): copy the photo into the case, or extend the sighting with it (DPIA G25).* |
| 4 | **Sighting** and its photo | Photo, place and GPS, category, age, gender, note, reporter's name and phone, ID type and last 4 digits, match evidence | `retentionUntil` = submission + **180 days** | `case-domain.js:24`; `reports.js` `POST /found` | Marked expired; left out of the reverse search (`shared/match-pool.js:133`); still visible and stored | 180 days. **Extend** while linked to an open case. *The upload form says "retained for 180 days unless escalated" (`web/src/pages/Capture.jsx:40,50,60`); nothing extends it automatically on a match. An officer extends it by 180 days at a time (`dashboard.js` `extendDays = 180`).* |
| 5 | **Sighting receipt stage** (public) | Not a record: what the receipt page shows | *Received* for 1 day, *under review* to 30 days, then *closed* | `case-domain.js:585-587` | — | — |
| 6 | **Sighting waiting to send** (web) | The full form and photo, on the citizen's device | **72 hours**, AES-GCM encrypted | `web/src/offlineQueue.js:7,38` | Removed from the queue | — |
| 7 | **Sighting waiting to send** (Android app) | The form and photo, on the device | **No limit**, not encrypted | `mobile/src/services/queue.js` | Kept until sent or removed | [72 hours, encrypted, as on the web: DPIA G14] |
| 8 | **User account** | Name, email, phone, role, office, jurisdiction, password hash | **No limit** | `001_schema.sql` (`users`) | — | [Disable within [7] days of transfer or retirement; delete [N] months after disabling, keeping the id in the audit log] |
| 9 | **Sign-in session** | Token in the browser | **7 days**; cannot be revoked | `worker/src/http/express-compat.js:14`; `web/src/auth.jsx:23` | Expires | [Shorter, with revocation: DPIA G9] |
| 10 | **Sign-up code** (OTP) | Phone number and code, in server memory | **10 minutes** | `shared/routes/auth.js` `OTP_TTL_MS` | Deleted | — |
| 11 | **Rate-limit counters** | IP address and phone, in server memory | **15-minute window**, per server instance | `express-compat.js:15,20` | Discarded | — |
| 12 | **Audit log** | Who did what, when, to which record; summaries **include the person's name** | **Permanent**; UPDATE and DELETE are refused by the database | `001_schema.sql:194-203` | Never | [Keep [N] years.] *Names already written cannot be removed without breaking the hash chain; new entries should carry ids only (DPIA G4).* |
| 13 | **Activity feed** | Officer, action, and the person's name | **No limit** | `001_schema.sql` (`activity`) | — | [[2] years] |
| 14 | **Notifications** | Recipient, title, where and when a person was seen | **No limit** | `server/sql/002_notifications.sql` | — | [[90] days] |
| 15 | **Grievance** | Name, phone, email, district, subject, description, history | **No limit** | `shared/routes/grievances.js` `POST /` | — | [[3] years after closure] |
| 16 | **Exports** (hand-off, MIS, privacy, audit) | As each export | Not held by Khozo once downloaded | `case-domain.js:756-829`; `dashboard.js` export routes | — | The Department's own records rules |
| 17 | **Database backups** | Everything above | [Per Supabase plan — confirm] | — | Expire on their own schedule | Deleted data stays until backups expire; state the maximum: [N] days |
| 18 | **Cloudflare Worker logs** | Request details; any errors logged | [Per Cloudflare plan — confirm] | `wrangler.jsonc` `observability` | Expire | [180 days in India if CERT-In's direction applies — legal to confirm: DPIA G17] |
| 19 | **Face-engine copies** | Images sent for comparison | Not stored by Khozo at the provider | `worker/src/match.js`; `worker/src/rekognition.js` | — | **None** kept by Aarakshak or AWS: confirm in writing (agreement clause 10.2) |

## What happens at the end

**Today** (in the Privacy review queue, `dashboard.js` `POST /privacy/retention/:type/:id`):

| Decision | Who | What it does |
|---|---|---|
| **Extend** | Super admin, admin, police, SJPU, AHTU, CWC, DCPU, state nodal | Sets a new date [default +180 days]. *The reason is not recorded: put it in a case note.* |
| **Close** (mark reviewed) | Same | Records the review. A sighting still pending review is moved to the CWC queue. |
| **Anonymise** | Admin, state nodal, super admin only, with an approval or order reference of at least 6 characters | **Case:** replaces the name with "Anonymized [id]" and clears Aadhaar, photo link, guardian name, phone, email and address. **Sighting:** clears the photo link, latitude and longitude, reporter's name and phone, and the note. |

**What anonymising leaves behind today** (DPIA G1), all of which a Department should expect to be
removed once the fix lands:

- the **photograph bytes** in `photo_blobs` (only the link is cleared; `deletePhoto`,
  `server/src/store.js:632`, is never called);
- on a case: the identification and vulnerability profile, FIR number, declaration signer,
  notes, workflow, care, legal and adoption records, and `foundLocation`;
- on a sighting: `foundLocation` (often the GPS coordinates written as text by the upload page,
  `Capture.jsx:197-205`), the reporter's display name and visible phone, and the masked ID;
- the person's **name in audit and activity entries**, including the anonymisation entry itself.

**Intended, once fixed** (Department to approve):

1. A daily job marks records that reach their date and alerts the nodal officer [30] days before.
2. At the date, unless an officer has extended it with a recorded reason, the record is
   anonymised and **its photograph deleted**, and its exclusion from all matching is automatic.
3. Each deletion is written to the audit log by id, without the name.
4. A monthly report of deletions goes to the nodal officer.
5. On termination of the agreement, everything is exported and then deleted, including from
   sub-processors and, when they expire, backups (agreement clause 15).

## Approval

| | Name and designation | Signature | Date |
|---|---|---|---|
| Department records officer | [ ] | | |
| Department nodal officer | [ ] | | |
| Operator | [ ] | | |
