# Khozo privacy notice

> **DRAFT for legal review — not legal advice.**
> Version 0.1 · 17 October 2026 · Fill every `[placeholder]` before publishing.
> Publish in English, Gujarati, Hindi and Marathi, the languages the app already offers.
>
> The plain-language public version is live in the app as the Privacy page (`/privacy`,
> `web/src/pages/Privacy.jsx`), in all four languages. Until a department signs an MoU for its
> area it names Khozo as responsible; this longer draft is the department version for legal review.

**Who is responsible.** [Department name and address] (the "Department") decides how your
information is used. It is the **data fiduciary**. [Operator legal name] runs the Khozo
software for the Department and is its **data processor**: it may use your information
only on the Department's instructions.

## What Khozo is for

Khozo helps police and child-welfare desks find missing children, women and adults and
bring them home safely. It is used for nothing else: not for advertising, not for selling
data, not for watching people, and not for training AI models.

## What the public never sees

- **No names or photos of any missing person.** There is no public gallery, no public
  search and no public appeal on Khozo.
- A shared link to a case shows only Khozo's general picture, never the person.
- If you send a sighting, your receipt **never says whether your photo matched anyone.**
- A family's case number shows only the case status. It shows no name, photo or place.

## What we collect, and why

| When you... | We collect | Why |
|---|---|---|
| **Send a sighting** (no login needed) | Up to three photos, if you add them. The place, taken from the photo's GPS, your phone's location, or what you type. Who you saw (child, woman or adult), rough age, gender and a note. If you opened the form by scanning a poster, which poster it was (a short code such as "kalupur"), to count which posters help. If you saw a woman or an adult, what made you think they need help: an adult may choose not to be found, so a photo of someone who is fine should not be sent. *Optional:* your name and phone, and the type of a photo ID with **only its last 4 digits** (we never store the full number). | To compare the face with missing persons, send the report to the right desk, and call you if an officer needs more detail. If you tick "keep my identity confidential", desks see "Confidential citizen" instead of your name and phone. |
| **Register a missing person** (parent, NGO or police) | Name, up to five photos, age, gender, height, weight, marks, clothing, languages, health or safety needs, date missing, Aadhaar number (optional), the guardian's name, phone, email and address, and your declaration. | To search for the person and contact the family. |
| **A department loads its own register** | The same details, from the department's records. Some records are marked **police-only**: only police desks can see them. | To search the department's existing cases. |
| **Have an account** (officer, parent, NGO) | Name, email, phone, password (stored scrambled), role and office. Every action an officer takes is recorded under the officer's name. The public list of desks shows offices, never officers' names or phones. | To let you sign in, and to keep an honest record of who did what. |
| **File a grievance** | Name (optional), phone, email, district, and what happened. | To answer your complaint. |
| **Visit the site** | Your internet (IP) address, held briefly to block misuse. | Security. |

## How face matching works

A sighting photo is compared with the photos of open cases, and a new case photo with
recent sightings. **Aarakshak**, an Indian face-recognition service, makes the comparison.
On the current service **AWS Rekognition** (Mumbai region) checks Aarakshak's best results.
A match score is only a hint. **An officer checks in person before anything is decided,
and before any family is told.** [Reviewer note: Khozo requires a written verification
record; the SOP requires it to be in person. See dpia.md G5.]

## Legal basis

[Legal to complete.] The Department carries out its duties under law, including the
Juvenile Justice (Care and Protection of Children) Act, 2015 [and the police or WCD laws
that empower it]. Under the Digital Personal Data Protection Act, 2023 this is processing
by the State for a function under law [s.7(c)] and, where an offence is involved, for its
investigation [s.17(1)(c)] [legal to confirm both]. For children, the DPDP Rules, 2025
(Rule 12, Fourth Schedule, Part B, item 1) allow processing in a child's interest by those
acting under law without a parent's consent. When you send a sighting or register a case,
you choose to give us the information and tick a box to agree to the photo's use. Most
DPDP Act duties begin on about 13 May 2027; this notice already follows them.

## Children

A missing child is a "child in need of care and protection" (JJ Act 2015, s.2(14)(vii)).
The law (s.74) forbids anyone to publish anything that identifies such a child, unless the
Child Welfare Committee or the Board permits it in writing. In Gujarat, police may
publicise a missing child only after that permission (Gujarat JJ Rules 2019, Rule 101(4)).
Khozo itself never publishes. A child who is found is taken to the Child Welfare Committee
or Childline 1098.

## Adults: women and anyone over 18

An adult has the right not to be found. If you are traced, an officer speaks to you first.
**Your family is told where you are only if you agree.** A relative who registered you sees
only what they entered, never where you were found.

## Who handles your information

[Operator] runs Khozo · **Cloudflare** runs the website and servers, and (when switched on) checks that a sighting was sent by a person rather than a program · **Supabase** hosts the
database that holds all records and photos · **Aarakshak** compares faces · **Amazon Web
Services** (Rekognition, Mumbai region) makes a second face check on the current service ·
**OpenStreetMap Nominatim** turns a sighting's map position into a district · **Google
Fonts** supplies the Gujarati and Hindi letters (your browser contacts Google when a page
opens) · **[SMS provider]**, once connected, sends sign-up codes. Details are in
[data-processors.md](data-processors.md).

**Where it is stored:** in a database in [Supabase region, e.g. Mumbai, India — confirm].
Cloudflare's network, Nominatim and Google Fonts may handle some data outside India.

## How long we keep it

| Record | Kept for |
|---|---|
| A sighting and its photos | 180 days, unless an officer extends it because a case needs it |
| A missing-person case and its photos | 10 years from registration [Department may set less] |
| The record of officers' actions | Permanently; it cannot be changed |
| Accounts and grievances | [Department to set] |
| A sighting waiting to send on your device (website) | 72 hours, encrypted |

**Today an officer reviews records when their time is up; automatic deletion is still
being built.** [Delete this line once it is live.] Full table:
[retention-schedule.md](retention-schedule.md).

## Your rights

You may ask to **see** the information about you, **correct** it, **delete** it (where the
law allows: police may have to keep some records for an investigation), **withdraw** your
consent to a sighting photo, **name someone** to act for you, and **complain** (DPDP Act
ss.11 to 14).

**How:** use the grievance form on Khozo and choose "Data privacy", or write to the
Grievance Officer below. Give your sighting receipt or case number if you have one. We
reply within [30] days. If you are not satisfied, you may go to the Data Protection Board
of India [once it is in operation — legal to confirm].

**Grievance Officer:** [Name], [Designation], [Department], [Address] · [Email] · [Phone] ·
[Office hours]

**In an emergency:** a child in danger, call 1098 or 112. A woman in danger, call 112 or the
Women Helpline 181. Anyone else, 112.

*Last updated: [date].*
