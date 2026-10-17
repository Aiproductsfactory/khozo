# Khozo governance documents

> **DRAFT for legal review — not legal advice.** Version 0.1 · 17 October 2026.

These are the documents a police or Women & Child Development department needs before it signs
a data-sharing MoU to use Khozo. They are written against the code, not against what Khozo
hopes to be: each fact cites the file it comes from, and wherever the code and the intended
policy differ, the document says so and points to the gap in the DPIA (section 7). Fill every
`[placeholder]`, have the Department's legal adviser review all six, and re-check the
DPIA gaps against the deployed code on the day of signature: several fixes were in the working
tree, not yet in production, when these were written. Khozo is an initiative of Aegis School of
Data Science & AI, Mumbai (repository `README.md`); the legal entity that signs as Operator must
be named.

| Document | What it is | Who signs or approves |
|---|---|---|
| [privacy-notice.md](privacy-notice.md) | The public notice for citizens, parents and officers: what is collected, why, who handles it, how long it is kept, and how to use your rights. | Approved by the Department (data fiduciary) and published in its name, in English, Gujarati, Hindi and Marathi. |
| [dpia.md](dpia.md) | The data protection impact assessment: data flows, risks, the controls in the code, and the open gaps. | Prepared by the Operator; reviewed by the Department's nodal officer and legal adviser; approved by the Department's authorised officer. |
| [data-sharing-agreement.md](data-sharing-agreement.md) | The MoU template between the Department (data fiduciary) and the Operator (data processor). | Signed by the Department's authorised signatory and the Operator's authorised signatory, with two witnesses. |
| [officer-sop.md](officer-sop.md) | The standard operating procedure for desk officers. | Issued by the Department as a standing order; each desk officer acknowledges it. |
| [data-processors.md](data-processors.md) | Every third party that receives personal data: what, where, why. Schedule 3 to the MoU. | Maintained by the Operator; each change approved by the Department. |
| [retention-schedule.md](retention-schedule.md) | How long each record is kept, and what happens at the end. Schedule 4 to the MoU. | Approved by the Department's records officer and nodal officer; carried out by the Operator. |

**Order of work:** DPIA first (it decides the conditions), then the retention and processor
schedules, then the MoU, then the privacy notice is published and the SOP issued before any
records are shared.
