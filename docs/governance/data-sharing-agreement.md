# Data-sharing and processing agreement (MoU) — template

> **DRAFT for legal review — not legal advice.**
> Version 0.1 · 17 October 2026. Every `[placeholder]` must be filled or struck out.
> Clauses in *italics* explain the clause to the drafter and are deleted before signature.

**This Memorandum of Understanding** is made on [date] at [place]

**between**

**[Department name]**, [address], acting through [designation of authorised officer]
(the **"Department"**, the *data fiduciary*);

**and**

**[Operator legal name]**, [CIN / registration number], [registered office], acting through
[name, designation] (the **"Operator"**, the *data processor*).

## Recitals

A. The Operator runs Khozo, open-source software (Apache-2.0) that helps police and
child-welfare desks trace missing children, women and adults, by matching photographs
sent by members of the public with photographs of registered missing persons.

B. The Department is responsible, under [the Juvenile Justice (Care and Protection of
Children) Act, 2015 / the police law of the State / other], for tracing missing persons
and for the care and protection of children.

C. A missing child is a child in need of care and protection (JJ Act s.2(14)(vii)), whose
identity may not be disclosed except with the written permission of the Board or Child
Welfare Committee (JJ Act s.74) [and, in Gujarat, may be publicised by police only after that
permission: Gujarat JJ Rules 2019, Rule 101(4)].

D. The Supreme Court, in *G. Ganesh v. State of Tamil Nadu* (SLP(Crl) No. 11263/2025), by
orders of 22 May, 5 August and 5 October 2026, has directed that missing-person portals be
integrated, with the NCRB coordinating.

E. The Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025 (G.S.R. 846(E),
notified 13 November 2025) apply; most of their duties come into force on or about
13 May 2027. The parties adopt them now as the standard for this MoU.

## 1. Definitions

"**Personal Data**", "**Data Principal**", "**Personal Data Breach**" and "**Processing**"
have their meanings in the DPDP Act. "**Department Data**" means all Personal Data the
Department shares with, or causes to be collected through, Khozo under this MoU, including
photographs, sightings routed to the Department, and the audit log of actions on them.
"**Sub-processor**" means a third party the Operator engages to process Department Data.
"**Police-only**" has the meaning in clause 4.3.

## 2. Roles

2.1 The Department is the data fiduciary for Department Data. The Operator is its data
processor and processes Department Data only on the Department's documented instructions:
this MoU, the Officer SOP (`officer-sop.md`), and written instructions from the nodal officer
named in Schedule 6.

2.2 If the Operator believes an instruction breaks the law, it says so in writing before
acting on it.

2.3 [*Legal to settle.* On the shared khozo.org service, a sighting from a member of the public
belongs to no department until it is routed. State who is the fiduciary for that intake, or
whether the departments using the service are joint fiduciaries. DPIA gap G26.]

## 3. Purpose limitation

3.1 Department Data may be processed **only** to:
(a) trace missing children, women and adults, and verify their identity;
(b) restore them safely, and refer children to the Child Welfare Committee, Childline 1098
and other authorities under the JJ Act;
(c) keep the records and statistics the law requires, and report to the NCRB and to portals
the Department or a court directs (Schedule 1, Part C);
(d) investigate an offence connected with the disappearance, where the Department so decides;
(e) operate, secure, audit and support Khozo for those purposes.

3.2 Department Data must **not** be processed to: identify suspects, protesters or any person
who is not missing; monitor any place or crowd; check immigration or citizenship; profile,
score or advertise to anyone; sell or license; or any purpose not in clause 3.1.

3.3 Every photograph compared by Khozo's face engines must be of a person registered as
missing, or a sighting sent in to find one. *Khozo's code compares only open, verified cases
(`shared/match-pool.js:81-84`); it cannot stop an officer registering someone who is not
missing. This clause and the audit in clause 13 are the control.*

## 4. Records shared and who may see them

4.1 The record sets, fields, photographs and visibility are listed in **Schedule 1**. The
Department shares only the fields needed for clause 3.1, and warrants that it may lawfully
share them.

4.2 **Default visibility.** A record is visible to the Department's desks for its
jurisdiction according to role (`shared/scope.js`). Parents and NGOs see only the records they
registered, in a restricted view that never shows where a person was found
(`shared/case-domain.js:705-747`).

4.3 **Police-only option.** A record set marked *police-only* in Schedule 1 is stored with
`visibility: 'police'`. It is then visible only to police roles in the record's jurisdiction
(police, SJPU, AHTU, DCRB, crime bureau, admin, super admin); never to CWC, DCPU, CCI, SAA,
JJB or DLSA desks, parents or NGOs; its public case lookup never resolves; and an alert that
a sighting may match it goes only to police who can open it (`shared/scope.js:53-71`;
`shared/routes/reports.js` `caseOfficers`, `GET /public/status/:ref`). Its photographs are
still compared with sightings from anywhere in India: that is the purpose of sharing it.

4.4 **Aadhaar.** No Aadhaar number is shared until the Operator confirms in writing that
Aadhaar numbers are encrypted at rest and masked on screen (DPIA G2). No Aadhaar biometric is
ever shared or sought: core biometric information may not be shared for any purpose (Aadhaar
Act s.29(1)), and identity information may be disclosed only on a High Court judge's order
after hearing UIDAI and the person (s.33(1)).

4.5 **Public disclosure.** Neither party publishes the name, photograph or any identifying
particular of a person in Department Data. Khozo has no public gallery, search or appeal
(`case-domain.js:485-507`). Any publicity of a child is for the Department alone, through its
own channels, after the written permission in Recital C.

4.6 **Privileged accounts.** The `super_admin` role sees every record of every department,
police-only included (`shared/scope.js:75-76`). Super-admin accounts on a service holding
Department Data are held only by [named officers / the Operator's named support staff under
clause 8.3]. The Department approves every account with `admin`, `state_nodal` or
`crime_bureau` rights over its jurisdiction, and every account is provisioned with a
jurisdiction (DPIA G9).

## 5. Security

5.1 The Operator keeps the measures in **Schedule 2** and reasonable security safeguards
under DPDP Act s.8(5) [and Rule 6 — legal to confirm the detail], and completes the measures
Schedule 2 lists as outstanding by the dates given there.

5.2 The Operator does not lower any measure in Schedule 2 without the Department's written
consent.

5.3 Department Data is held in a database shared with other departments' data. Separation is
by access rules in code. [Option: the Department may require its own database, at
[cost], under clause 15.3.]

## 6. Sub-processors

6.1 The Department authorises the sub-processors in **Schedule 3** (`data-processors.md`),
for the data and purposes listed there only.

6.2 The Operator gives the Department [30] days' written notice of any new or replacement
sub-processor, or of a change in what one receives or where. The Department may object
within [15] days; if it does, the change is not made for Department Data.

6.3 The Operator binds each sub-processor to terms no less protective than this MoU, including
clauses 3, 7, 9, 10 and 11, and remains liable to the Department for it.

## 7. Data localisation

7.1 Department Data, including backups and logs, is **stored in India**: [Supabase project
region, e.g. ap-south-1 Mumbai — confirm].

7.2 Department Data is processed only in India, except as Schedule 3 lists, with the reason
and a date by which it will end. At signature these are: Cloudflare's network (requests may
pass through data centres outside India); OpenStreetMap Nominatim (a sighting's coordinates);
Google Fonts (a visitor's IP address). The Operator [self-hosts the fonts and replaces or
self-hosts the geocoder by [date]].

7.3 The face engines run in India: Aarakshak at [location — confirm]; AWS Rekognition only in
`ap-south-1` (Mumbai). *The region is an environment setting (`worker/src/rekognition.js:69`);
this clause fixes it.*

7.4 No transfer is made to a country the Central Government restricts under DPDP Act s.16.

## 8. Confidentiality and personnel

8.1 Only Operator personnel who need access for clause 3.1(e) have it, each bound in writing to
confidentiality, trained on this MoU, and listed to the Department on request.

8.2 The Operator does not view Department Data in the ordinary course. It may do so to fix a
fault or answer an incident, with the nodal officer's prior consent, or after the event within
[24] hours in an emergency, and every such access is in the audit log.

8.3 Operator personnel do not hold operational accounts on a service holding Department Data,
except [named support accounts], used under clause 8.2.

## 9. No onward sharing

9.1 The Operator does not disclose Department Data to anyone except: its sub-processors under
clause 6; the bodies the Department directs in writing (Schedule 1, Part C), such as the CWC,
JJB, NCRB, TrackChild or Khoya-Paya; or as required by law.

9.2 If a law or a court requires disclosure, the Operator tells the Department first, unless the
law forbids it, and discloses no more than required.

## 10. No use for training models

10.1 Neither the Operator nor any sub-processor uses Department Data, including photographs,
face templates, scores or officers' decisions, to train, fine-tune, test, benchmark or improve
any model or product.

10.2 Before signature the Operator gives written evidence that: AWS's AI-services opt-out
policy is applied to the account used for Rekognition; and Aarakshak keeps no image, template
or result after answering, and trains on nothing it receives. [DPIA G27.]

10.3 Test and demonstration data never includes Department Data. *The repository already
forbids real case data (`scripts/import-gujarat-cases.mjs` header; `SECURITY.md`).*

## 11. Retention and deletion

11.1 Each record type is kept for the period in **Schedule 4** (`retention-schedule.md`) and then
deleted or anonymised as stated there.

11.2 Deletion includes the photographs. *Today anonymising a record leaves its photograph in
the database (DPIA G1), and no job runs when a period ends (G3). The Operator fixes both by
[date]; until then the nodal officer runs the monthly review in the SOP.*

11.3 The audit log is kept for [period]. The Operator stops writing names into new audit
entries by [date] (DPIA G4).

## 12. Personal data breach

12.1 The Operator tells the nodal officer of any Personal Data Breach, or reasonable suspicion of
one, **without delay and within [2] hours of becoming aware**, by phone and email (Schedule 6).

12.2 The Operator reports a cyber incident to CERT-In **within 6 hours** of noticing it, as the
CERT-In Directions of 28 April 2022 require, and copies the Department. The parties keep their
ICT logs for 180 days within India as those Directions require [legal to confirm application;
DPIA G17].

12.3 The Operator then gives the Department, as soon as known: what happened and when; the data
and people affected; the likely consequences; what has been done to contain it; and a contact.
It supports the Department in informing the Data Protection Board and each affected Data
Principal under DPDP Act s.8(6) [and Rule 7, including a detailed report to the Board within 72
hours — legal to confirm], once in force, and earlier as good practice.

12.4 The Operator keeps a written incident response plan, tests it [yearly], and shares it with
the Department.

## 13. Audit rights

13.1 The Department, or an auditor it appoints (a CERT-In empanelled auditor for security), may
audit the Operator's compliance on [15] days' notice, and at once after a breach.

13.2 The Operator provides on request: the audit log for Department Data with a hash-chain
verification (`shared/audit-chain.js`); the privacy export (`dashboard.js` `GET /privacy/export`);
the list of accounts and roles; sub-processor terms; and penetration test reports.

13.3 The Department reviews the audit log [monthly] for use outside clause 3.

13.4 The Operator fixes any finding within the time the auditor sets, or [30] days.

## 14. Rights of Data Principals and grievances

14.1 The Operator passes to the Department, within [2] working days, any request or complaint it
receives about Department Data, and helps the Department answer it within the time the law sets.

14.2 The Department's Grievance Officer is named in the privacy notice (`privacy-notice.md`).

## 15. Return and export of data

15.1 On request, and on termination, the Operator gives the Department within [30] days a complete
export of Department Data: records as JSON, photographs as the original image files with their
keys, and the audit log with its hashes and a verification of the chain.

15.2 After the Department confirms the export is complete, the Operator deletes Department Data,
including from sub-processors, within [30] days, and from backups when they expire, at most
[N] days later. It gives the Department a signed certificate of deletion.

15.3 Khozo is open source. The Department may run its own copy, and the Operator gives reasonable
help to move it, at [rates].

## 16. Term and termination

16.1 This MoU runs for [2] years from [date] and may be renewed in writing.

16.2 Either party may end it on [90] days' written notice.

16.3 The Department may end it at once, by written notice, for a breach of clauses 3, 7, 9 or 10,
or for a Personal Data Breach caused by the Operator's failure to keep Schedule 2.

16.4 For any other breach, the other party may end it if the breach is not cured within [30] days
of written notice.

16.5 Clauses 8, 9, 10, 11, 12, 15 and 17 survive termination.

## 17. General

17.1 **Fees:** [none / as in a separate agreement].
17.2 **Liability and indemnity:** [to be drafted].
17.3 **Governing law and disputes:** the laws of India; [courts at / arbitration under].
17.4 **Changes:** only in writing signed by both parties.
17.5 **Conditions precedent:** no Department Data is shared until the conditions in **Schedule 5**
are met or waived in writing.

---

## Schedule 1 — Records shared

**Part A: record sets**

| # | Record set | Source | Fields | Photos | Visibility | Import method | Records |
|---|---|---|---|---|---|---|---|
| 1 | [e.g. Register of missing children, [unit], [years]] | [Department] | Name, age, gender, date missing, FIR or diary reference, police station, complainant's name and phone, description [list] | Yes / No | **Police-only** / all desks in jurisdiction | Bulk import (`web/src/bulk/`) or script | [N] |
| 2 | [ ] | | | | | | |

**Part B: fields never shared:** [e.g. Aadhaar numbers until DPIA G2 closes; medical records;
names of accused persons].

**Part C: onward recipients the Department directs:** [CWC [district]; NCRB; TrackChild; Khoya-Paya;
State portal].

## Schedule 2 — Security measures

| Measure | In place on [date] | Where |
|---|---|---|
| All traffic over HTTPS; app and API on one origin | Yes | `wrangler.jsonc` |
| Database closed to the public key: RLS on, no policies; the API alone connects | Yes | `server/sql/001_schema.sql:182-188` |
| Role- and jurisdiction-based access on every read | Yes | `shared/scope.js` |
| Photos served only with a token and jurisdiction | Yes | `reports.js` `GET /photo/:key` |
| Append-only, hash-chained audit log | Yes | `001_schema.sql:194-203`; `shared/audit-chain.js` |
| Server refuses to start without a JWT secret | Yes | `docs/DEPLOYMENT.md` §2 |
| Public rate limits | Partly: per instance | `worker/src/http/express-compat.js` |
| Verification record before a case is marked found | [Deployed?] | `case-domain.js` `parseVerification` |
| Multi-factor sign-in for officers | **No: by [date]** | DPIA G9 |
| Shorter sessions with revocation | **No: by [date]** | DPIA G9 |
| Encryption of Aadhaar and other identifiers | **No: by [date]** | DPIA G2 |
| Photo deletion on anonymise; automatic retention | **No: by [date]** | DPIA G1, G3 |
| CAPTCHA on public upload | **No: by [date]** | DPIA G12 |
| EXIF stripped from uploads | **No: by [date]** | DPIA G13 |
| Logs kept 180 days in India | **No: by [date]** | DPIA G17 |
| Database password rotated after exposure | [Confirm] | DPIA G20 |
| Hosting accounts held by the Operator organisation | [Confirm] | DPIA G21 |
| Yearly penetration test by a CERT-In empanelled auditor | [By date] | |

## Schedule 3 — Sub-processors

As in [data-processors.md](data-processors.md), version [ ], dated [ ].

## Schedule 4 — Retention

As in [retention-schedule.md](retention-schedule.md), version [ ], dated [ ], with the
Department's choices filled in.

## Schedule 5 — Conditions precedent

Before any Department Data is shared (or, for data already shared, by [date]):

1. DPIA signed by both parties (`dpia.md`).
2. DPIA gaps marked *Before MoU* closed, or accepted in writing with a date: [list].
3. The verification, reopen and family-contact controls deployed to production (DPIA G8).
4. Written evidence under clause 10.2.
5. Supabase region confirmed in India (clause 7.1).
6. Privacy notice published in [languages] (`privacy-notice.md`).
7. Officer SOP issued and every desk officer briefed (`officer-sop.md`).

## Schedule 6 — Contacts and escalation

| | Department | Operator |
|---|---|---|
| Nodal officer | [name, designation, phone, email] | [name, phone, email] |
| Security / breach contact (24×7) | [ ] | [ ] |
| Grievance Officer | [ ] | — |
| Signatory | [ ] | [ ] |

---

**Signed** for the Department: ______________________ [name, designation, seal, date]

**Signed** for the Operator: ______________________ [name, designation, date]

Witnesses: 1. ______________________ 2. ______________________
