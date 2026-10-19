# Khozo standard operating procedure for desk officers

> **DRAFT for legal review — not legal advice.**
> Version 0.1 · 17 October 2026 · Issued by [authority, e.g. Commissioner of Police /
> Commissioner, WCD] under [order no., date]. Applies to every officer who holds a Khozo
> account for [Department]. Times in `[brackets]` are proposals for the Department to set.

## 1. Five rules that never change

1. **A score is not a decision.** Never confirm a match because the number is high. Confirm
   only after you, or an officer you name, have checked the person's identity **in person**.
2. **Never share a missing person's name, photo or case publicly**: not on social media, not
   in WhatsApp groups, not with the press. For a child, publicity needs the written
   permission of the Child Welfare Committee or the Board (JJ Act s.74; in Gujarat, Rule
   101(4) of the Gujarat JJ Rules 2019).
3. **An adult decides who is told.** For a woman or anyone over 18, tell the family where
   she is only if she agrees.
4. **A found child goes to the Child Welfare Committee**, within 24 hours (JJ Act s.31(1)
   [legal to confirm]). The Committee decides on restoration.
5. **Police-only records stay with police.** Do not show, print or forward them to anyone
   who could not open them in Khozo.

Everything you do in Khozo is written to an audit log under your name, and that log cannot
be changed.

## 2. Who can do what

| Action in Khozo | Roles that can |
|---|---|
| See cases and sightings | Desks for their own district (police station, SJPU, AHTU, DCRB, DLSA, CWC, DCPU, RPF, CCI, SAA, JJB) or state (admin, state nodal, SARA, crime bureau) (`shared/scope.js:73-105`) |
| See police-only records | Police, SJPU, AHTU, DCRB, crime bureau, admin, super admin (`shared/scope.js:61`) |
| **Confirm a match** | Police, SJPU, admin, super admin only |
| Reject a match, or refer a sighting to CWC/1098 | Any review desk in scope |
| Record the CWC outcome of an unmatched sighting | CWC, DCPU, admin, super admin, state nodal, SARA |
| Open a found-child intake from a sighting | CWC, DCPU, CCI, SAA, police, SJPU, admin, state nodal, SARA |
| Verify a parent's or NGO's registration | Police, SJPU, CWC, DCPU, admin, state nodal |
| Record that the family was contacted | Police roles and CWC |
| Reopen a found or closed case | Police roles |
| Bulk-import a register | Police, SJPU, admin, super admin |
| Anonymise a record | Admin, state nodal, super admin, with an approval reference |

*(From `shared/case-domain.js:25-50` and the role lists in `shared/routes/reports.js` and
`shared/routes/dashboard.js`.)*

## 3. The daily queue

At the start of each shift, in this order:

| # | Where | What to do | Time limit |
|---|---|---|---|
| 1 | **Bell: "Possible match" alerts** (high priority) | Open each. It goes only to police who can open the case. | Open within [1 hour] |
| 2 | **Matches** page, status *pending review* | Review each possible match (section 4). | Start the same shift |
| 3 | **Bell: "Match confirmed — rescue required"** | The person must be reached. Send a team to the place in the alert. | At once |
| 4 | **Sightings** page, unmatched, in your area | Child: refer to CWC/1098, or act yourself. Woman or adult: police follow-up. | Within [24 hours] |
| 5 | Sightings with **no state or district** | These reach every desk in the country. If the place is in your area, place it in your district from the sighting (police and command desks can), and record a note. | Within [4 hours] |
| 6 | **Cases**, status *intake pending* | Check a parent's or NGO's registration: speak to the complainant, see an ID or the FIR. Only then verify it. It is not face-searched until you do. | Within [48 hours] |
| 7 | **Bell: "High trafficking risk"** (AHTU and SJPU) | Review the case's reasons with the investigating officer and add a case note (section 11). | Within [24 hours] |
| 8 | **Privacy review** (nodal officer, monthly) | Act on every record marked *expired* or *due soon* (section 10). | Monthly |

## 4. Reviewing a possible match

Open the comparison. Both photographs are shown side by side, uncropped, with each engine's
score.

**Check side by side, and write down what you saw:**

- [ ] Face shape, eyes, eyebrows, nose, ears, mouth and teeth, hairline.
- [ ] Moles, scars, birthmarks and identification marks in the case against the sighting
      photo and note.
- [ ] Age: is it plausible for the time since the person went missing? Old register photos
      (some are from 2007) need care: a child's face changes a great deal.
- [ ] Gender, height, build, language, clothing.
- [ ] Place and time: could the person have reached where the sighting was taken?
- [ ] Photo-quality warnings shown on the sighting.
- [ ] **Engines disagree** flag, and whether two engines or only one compared the faces.
      One engine alone is a weaker lead; so is a candidate flagged **Not checked by a second
      engine** (the second engine was asked and did not answer, or cannot read the photo).
- [ ] The age the missing person **would be now** (shown beside the sighting's estimate:
      their age when they went missing plus the years since), not their age on the FIR.
- [ ] A case photo flagged **not usable for matching** or **group photo**: replace it with a
      clear photo of the person alone (Cases → Case photo).

**Then decide:**

| If | Do |
|---|---|
| Clearly a different person | **Not this person — show next.** The sighting moves to the next candidate the engines proposed (that case's officers are alerted), or, with none left, back to its own district and queue; a sighting linked by a newly registered case goes back to where it was. The same case is never proposed for it again. |
| A child, and you cannot verify quickly | **Refer to CWC/1098**, and keep looking. |
| Possibly the same person | **Go and verify in person** (section 5). Do not confirm yet. |

Never contact the family at this stage.

**A photo of someone who is not missing.** The public form can be misused to photograph
strangers, women and girls above all. When a sighting with no match to decide shows a
person who is plainly not missing and not in need, press **Not a concern…** and choose:

- **Not a concern**: taken in good faith, but the person needs nothing from us.
- **Misuse**: the photo was not taken to help anyone. It appears on the **Public abuse**
  page that the command desks check, and is counted in the monthly MIS report.

Either way the photo is deleted at once and the sighting keeps nothing that identifies
anyone. This cannot be undone, and your name is recorded against the decision. **Never use it to
clear a queue**: a child alone, a person who seems confused or hurt, or a sighting you are
unsure of is followed up, not dismissed. A woman's or adult's sighting shows why the reporter
thought she needs help; "no reason given" is a reason to look harder, not to dismiss.

## 5. In-person verification (before "Confirm")

1. Go to the place and time in the sighting. Take [a woman officer for a girl or a woman]
   [Department to confirm].
2. Find the person. Speak to them calmly; for a child, with a CWC member or counsellor where
   possible.
3. Check identity: the face in person against the case photo; their name, parents' names,
   village or address, school; identification marks; any documents. **Never ask for or use
   Aadhaar biometrics**: Khozo has no Aadhaar search, and identity information can be
   disclosed only on a High Court judge's order (Aadhaar Act ss.29(1), 33(1)).
4. In Khozo, press **Confirm** and fill the verification record: **method**, **who
   verified** (name and rank), **where**, and **what you checked**. Khozo refuses a
   confirmation without it.
5. Choose **In person**. The form also offers video call, documents and "other"; use those
   only with the written approval of [the SHO / SP], and say why in the note. *(The code
   accepts them; this SOP does not, without approval: DPIA G5.)*

If you find it is not the person, **reject** the match, and record what you saw.

## 6. Telling the family

**Child**

1. After the verification is recorded, the investigating officer **calls or visits** the
   guardian on the case.
2. Before saying where the child is, check that you are speaking to the real guardian: the
   complainant on the FIR, or a document.
3. Tell them that the child has been found and safe, and that the CWC will decide on
   restoration. Give the CWC's place and time.
4. In Khozo, **record the contact**: call or visit, and a short note.
5. Khozo sends an SMS only when a gateway is connected, and only says "there is news, please
   contact [desk]". If it says no SMS was sent, **you must call**. *(No gateway is
   connected today: DPIA G6.)*

**Woman or adult**

1. Speak to her **alone and in private** first. Ask whether she agrees that her family may be
   told, and what they may be told.
2. If she **agrees**: tick the consent box, then contact the family as for a child, and in the
   note say how she agreed, when, and who was present. *(Khozo stores only that consent was
   given, not these details, so the note is the record: DPIA G7.)*
3. If she **does not agree**: do not tell the family where she is. You may tell the
   complainant only that she has been traced and is safe [legal to confirm]. Khozo's public
   status page already says only that, and that any contact is arranged with her consent.
4. If she is in danger: 112, the Women Helpline 181, or the One Stop Centre (Sakhi).

## 7. Handing over to CWC or Childline 1098

| Situation | Action in Khozo | Outside Khozo |
|---|---|---|
| Child found, case matched | Confirm with verification; add a **production record** | Produce before the CWC within 24 hours; Khozo flags a delay |
| Child seen, no match | **Refer to CWC/1098** | Call 1098 if the child is in immediate need |
| Child taken into care, no case | **Open formal intake** from the sighting | CWC order; CCI admission |
| Woman or adult | No CWC referral (no CWC jurisdiction over adults) | Police follow-up; One Stop Centre if needed |

## 8. Reopening a case

If a confirmed person turns out to be someone else, or goes missing again, or a case was
closed in error:

1. Press **Reopen** and give the reason (at least 10 characters). The case goes back to
   *missing* and back into the search; what it recorded before is kept in its history.
2. If the family had been told, **call them yourself the same day** and explain.
3. Tell [the SHO / nodal officer] within [24 hours].

*(Reopen is in the latest version and must be deployed before this SOP is issued: DPIA G8.)*

## 9. Police-only records

- They come from a police department's own register, shared on the condition that only police
  see them. CWC, DCPU, CCI, adoption and legal-aid desks, parents and NGOs cannot see them, and
  their case numbers do not work on the public status page.
- Their photographs are still compared with every public sighting. A possible match is sent
  only to police who can open the case.
- Do not print, screenshot or forward them. If a CWC needs details to protect a found child,
  give only what that child's care needs, through the formal referral, and note it.
- Do not change a police-only record to open visibility without [the Department's written
  order].

## 10. Keeping and deleting records (nodal officer)

Every month, open **Privacy review**:

| Marked | Do |
|---|---|
| *Expired* or *due soon* | Decide: **extend** (only if an open case or court proceeding needs it; note why), **close**, or **anonymise** (admin, state nodal or super admin; an approval or order reference is required) |
| A sighting linked to an open case | Extend it, so it is kept while the case is open |

Every night Khozo lists what has reached its date and alerts the super admins. It deletes on its
own only once the Department has approved the retention schedule and the Operator has switched
enforcement on; until then this monthly review is what ends a record's life. Anonymising deletes
the photograph and everything that identifies the person (DPIA G1). An open case past its date
is never removed automatically: review it and record the decision.

## 11. Trafficking-risk prompts (AHTU, SJPU and police)

- A case can carry **Trafficking risk: high** or **elevated**, with the reasons listed on the case.
  It is worked out from what was recorded: flags, age, the circumstances, a previous
  disappearance, other adolescents missing from the same district. It is a prompt to look
  again, never evidence and never a finding.
- A **high** prompt alerts the AHTU and SJPU desks that can open the case. Within [24 hours], the
  AHTU desk reviews it with the investigating officer and adds a case note: action taken, or why
  none is needed.
- **Trafficking patterns** (Oversight menu) shows district surges, repeat disappearances, shared
  contact numbers, movement between districts and states, and sighting hotspots. Review it
  [weekly]; raise a pattern with the SP / DCP and, for movement across states, the other state's
  AHTU through the nodal officer.
- Never tell a family or the press that a case was raised for trafficking risk. CWC and DCPU
  desks see the prompt for protection decisions; CCI, adoption, JJB and legal-aid desks do not,
  so share what a child's care needs through the formal referral.

## 12. What never to share publicly

- A missing person's name, photo, age, address, school or anything else that identifies them.
- The existence of a case, or a case number.
- Where a traced woman or adult is.
- Who sent a sighting, especially a reporter who asked to stay confidential.
- Match scores, or whether a citizen's photo matched anyone.
- Anything from a police-only record.

Use the Network page's WhatsApp links only to reach another desk, and never send a photo, name
or case through WhatsApp.

## 13. Escalation timelines

| Event | Who | Escalate to | Within |
|---|---|---|---|
| Possible match not reviewed | Desk officer | SHO / SJPU in-charge | [4 hours] |
| High trafficking-risk prompt not reviewed | AHTU desk | AHTU in-charge and SP / DCP | [24 hours] |
| Confirmed child not produced before CWC | Investigating officer | SP / DCP and CWC | 24 hours |
| Adult traced; consent not yet asked | Investigating officer | SHO | [Same day] |
| Citizen or NGO intake not verified | Station | SJPU | [48 hours] |
| Case reopened after the family was told | Officer reopening | SHO and nodal officer | [24 hours] |
| Lost phone or laptop, shared password, or a suspected breach | Anyone | Nodal officer, who tells the Operator | **[1 hour]**; the Operator tells CERT-In within 6 hours |
| A request from the press or public for case details | Anyone | Nodal officer / PRO | Do not answer; pass on at once |
| A Data Principal asks to see, correct or delete data | Anyone | Grievance Officer | [2 working days] |

## 14. Your account

- Never share your password. Log out on shared computers: a sign-in lasts 7 days.
- Change your password when told to, and at once if you think someone else knows it. Changing
  it signs your account out on every other phone and computer.
- When you transfer or retire, [your SHO tells the nodal officer], who closes the account
  within [7 days].

---

### Annex A — Verification record

| Field | Entry |
|---|---|
| Case id / sighting id | |
| Method | In person / other (approval ref: ) |
| Verified by (name, rank, station) | |
| Place, date and time | |
| Present | |
| What was checked (face, marks, names, documents) | |
| Result | Same person / not the same person / unsure |

### Annex B — Adult consent record (keep in the case note)

| Field | Entry |
|---|---|
| Spoken to alone? | Yes / No (why) |
| Does she agree her family may be told? | Yes / No |
| What may they be told? | Traced only / where she is / contact details |
| How was consent given? | Spoken / written / signed |
| Witness | |
| Officer, date and time | |

### Annex C — Family contact record

| Field | Entry |
|---|---|
| Case id | |
| Method | Call / visit |
| Person spoken to, and how their identity was checked | |
| What they were told | |
| Officer, date and time | |
