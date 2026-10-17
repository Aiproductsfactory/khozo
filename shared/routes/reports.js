/**
 * Missing-child case, sighting and public-bulletin routes.
 *
 * Registered against a router by both runtimes: Express in `server/` and a
 * Worker-side router shim in `worker/`. Every capability the two runtimes
 * implement differently — storage, photo blobs, token verification, multipart
 * parsing, face matching — arrives through `deps` rather than being imported,
 * which is what lets one copy of this logic serve both.
 *
 * Handlers are written against the Express `(req, res)` contract. The Worker
 * shim implements the same contract, so this file needs no runtime branching.
 */

import { nanoid } from 'nanoid';

import { POLICE_ROLES, canAccessReport, isPoliceOnly, sameStatePlace, scopeFoundReports, scopeReports } from '../scope.js';
import { resolveSightingLocation } from '../geocode.js';
import { canonicalPlace, placeFields } from '../geo/index.js';
import { isReverseMatchCandidate, wasLinkRejected } from '../match-pool.js';
import { sendSms, smsGatewayConfigured } from '../sms.js';
// The case vocabulary, validation and public-redaction rules are shared with the
// Cloudflare Worker build so the two runtimes cannot drift apart. See
// shared/case-domain.js.
import {
  DAY,
  REPORT_PHOTO_RETENTION_DAYS,
  SIGHTING_PHOTO_RETENTION_DAYS,
  FORMAL_CASE_ROLES,
  REPORT_CREATE_ROLES,
  REVIEW_ROLES,
  CWC_FOLLOWUP_ROLES,
  FOUND_INTAKE_ROLES,
  CASE_WORKFLOW_ROLES,
  CASE_CLOSE_ROLES,
  CASE_NOTE_ROLES,
  CCI_CARE_ROLES,
  JJB_PROCEEDING_ROLES,
  STATE_ESCALATION_ROLES,
  BUREAU_REPORT_ROLES,
  RESTORATION_PLAN_ROLES,
  EXTERNAL_ID_ROLES,
  CASE_HANDOFF_EXPORT_ROLES,
  WELFARE_REFERRAL_ROLES,
  LEGAL_AID_REFERRAL_ROLES,
  ADOPTION_RECORD_ROLES,
  CASE_ASSESSMENT_ROLES,
  PRODUCTION_RECORD_ROLES,
  INTAKE_VERIFY_ROLES,
  BULLETIN_ROLES,
  CASE_TRANSFER_ROLES,
  CASE_ASSIGN_ROLES,
  CASE_ASSIGNABLE_ROLES,
  INVESTIGATION_CHECKLIST_ROLES,
  ALLOWED_IMAGE_TYPES,
  MATCH_REVIEW_THRESHOLD,
  CASE_ASSIGNMENT_TYPES,
  INVESTIGATION_CHECKLIST_ITEMS,
  CHILD_VULNERABILITY_CATEGORIES,
  PRODUCED_BY_TYPES,
  EDUCATION_LEVELS,
  YES_NO_UNKNOWN,
  DECLARATION_METHODS,
  CASE_WORKFLOW_ACTIONS,
  CASE_CLOSE_REASONS,
  CWC_FOLLOWUP_OUTCOMES,
  CCI_ADMISSION_TYPES,
  CCI_SERVICE_TYPES,
  CCI_PROGRESS_STATES,
  JJB_PROCEEDING_TYPES,
  STATE_ESCALATION_TYPES,
  STATE_ESCALATION_LEVELS,
  BUREAU_REPORT_TYPES,
  BUREAU_LEVELS,
  BUREAU_PRIORITIES,
  SIGHTING_ID_PROOF_TYPES,
  EXTERNAL_ID_TYPES,
  RESTORATION_TYPES,
  RESTORATION_STATUSES,
  RESTORATION_SUPPORTS,
  RESTORATION_TRAVEL_MODES,
  RESTORATION_DOCUMENT_STATUSES,
  RESTORATION_FUNDING_SOURCES,
  WELFARE_SCHEMES,
  WELFARE_STATUSES,
  LEGAL_AID_SERVICE_TYPES,
  LEGAL_AID_STATUSES,
  ADOPTION_RECORD_TYPES,
  ADOPTION_STATUSES,
  CASE_ASSESSMENT_TYPES,
  CASE_RISK_LEVELS,
  PRODUCTION_TYPES,
  PRODUCTION_OUTCOMES,
  HANDOFF_TARGET_SYSTEMS,
  POLICE_VISIBILITY_ROLES,
  REPORT_VISIBILITY_VALUES,
  personCategoryOf,
  isAdultCategory,
  isAdultCase,
  categoryAge,
  nonFamilyPhoneSet,
  familyPhone,
  isPendingCitizenIntake,
  generatedFirNo,
  canTransferToJurisdiction,
  canAssignUserToReport,
  assignableUsersForReport,
  isPublicAppeal,
  PUBLIC_APPEALS_DISABLED,
  bulletinPayload,
  publicSearchPayload,
  publicSightingStatus,
  publicCaseStatus,
  isCitizenRole,
  citizenCaseView,
  stable,
  signedCaseExport,
  latestRecord,
  safeRecordSummary,
  caseHandoffPayload,
  norm,
  nameOverlap,
  duplicateScore,
  findDuplicateCandidates,
  duplicatePayload,
  isTruthy,
  retentionUntil,
  cleanText,
  invalidValue,
  readFields,
  nestedValueField,
  parseVerification,
  VERIFICATION_REQUIRED,
  FAMILY_CONTACT_METHODS,
  PERSON_CONSENT_REQUIRED,
  FAMILY_SMS_MESSAGES,
  familySmsText,
  parseDateInput,
  parseDateTimeInput,
  optionalDateInput,
  listValues,
  enumValue,
  buildChildProfile,
  buildReportDeclaration,
  buildFoundChildDeclaration,
  digits,
  maskProofNumber,
  publicReporterName,
  optionalNumber,
  validateImageFile,
  validateMissingReport,
  validateFoundReport,
  inferLocationScope,
  jurisdictionError,
  INTAKE_ALERT_ROLES,
} from '../case-domain.js';

export default function registerReportRoutes(router, deps) {
  const {
    listReports, addReport, findReport, updateReport,
    listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
    listUsers, addActivity, addAudit, addNotification,
    savePhoto, readPhoto, photoMimeType,
    authRequired, optionalAuth, passwordChangeRequired, requireRole,
    auditPublicRateLimit, clientIp, fixedWindowRateLimit,
    rankMatches,
    // The reverse search: a newly registered case's photo against the stored
    // sightings. Optional only so that a harness exercising other routes need
    // not stub it; both runtimes supply it.
    rankSightingMatches = null,
    // Links a stored sighting to a case only if it is still what the search
    // saw: `(id, makePatch, isEligible) => Promise<linked record | null>`. The
    // Worker supplies it, because its store is a per-request copy read seconds
    // before the comparisons finish, and another request may have linked,
    // reviewed or anonymised the sighting meanwhile. Express has one live
    // in-memory store, where re-reading the row just before writing is enough.
    claimFoundReport = null,
    detectPerson,
    upload,
    // Injectable so the reverse geocoder can be stubbed in tests rather than
    // reaching OpenStreetMap from a test run.
    fetchImpl = fetch,
    settings = {},
  } = deps;

  const protectedRoute = [authRequired, passwordChangeRequired];

  // ---- Strict request bodies (readFields in shared/case-domain.js) -----------
  //
  // No write route here stores an object it was sent. Every JSON body is
  // checked once, before any handler: a top-level field holding an object, or
  // an array of anything but strings and numbers, is refused with
  // `Invalid value for <field>`. Only a match confirmation's `verification` is
  // an object by design. A multipart body is flat strings by construction and
  // is read after the upload is parsed, by each route's own field list.
  router.use((req, res, next) => {
    const field = nestedValueField(req.body, ['verification']);
    if (field) return res.status(400).json({ error: invalidValue(field) });
    return next();
  });

  /** The fields a case registration (POST /, one bulk-import row too) reads. */
  const REPORT_FIELDS = {
    personCategory: ['text', 20],
    visibility: ['text', 20],
    childName: ['text', 120],
    childAadhar: ['text', 20],
    gender: ['text', 10],
    age: 'number',
    height: 'number',
    weight: 'number',
    dateOfMissing: ['text', 40],
    firNo: ['text', 80],
    dataPurpose: ['text', 80],
    parentName: ['text', 120],
    parentPhone: ['text', 20],
    parentEmail: ['text', 160],
    address: ['text', 300],
    state: ['text', 80],
    district: ['text', 80],
    // The codes the district picker sends with the names (shared/geo).
    stateCode: ['text', 8],
    districtCode: ['text', 40],
    zip: ['text', 12],
    // Profile fields; buildChildProfile cuts each to its own length.
    complexion: ['text', 400],
    build: ['text', 400],
    hair: ['text', 400],
    clothing: ['text', 400],
    languages: ['text', 400],
    birthMark: ['text', 400],
    identificationMark: ['text', 400],
    circumstances: ['text', 1200],
    producedByType: ['text', 40],
    educationLevel: ['text', 40],
    disabilityStatus: ['text', 40],
    mentalHealthConcern: ['text', 40],
    vulnerabilityCategories: 'list',
    // Read long so validateMissingReport can still refuse them as too long.
    declarationSignerName: ['text', 400],
    declarationSignerRole: ['text', 200],
    relationshipToChild: ['text', 400],
    declarationMethod: ['text', 40],
    declarationAccepted: 'flag',
    photoConsent: 'flag',
    allowDuplicate: 'flag',
  };

  /** The fields a sighting (POST /found) reads. */
  const FOUND_FIELDS = {
    personCategory: ['text', 20],
    // Read long so validateFoundReport can still refuse them as too long.
    foundLocation: ['text', 2000],
    note: ['text', 4000],
    reporterName: ['text', 120],
    reporterPhone: ['text', 20],
    confidentialReporter: 'flag',
    ageApprox: 'number',
    gender: ['text', 10],
    state: ['text', 80],
    district: ['text', 80],
    stateCode: ['text', 8],
    districtCode: ['text', 40],
    lat: 'number',
    lng: 'number',
    idProofType: ['text', 40],
    idProofNumber: ['text', 40],
    photoConsent: 'flag',
  };

  /** The fields a formal found-child intake reads. */
  const FORMAL_INTAKE_FIELDS = {
    childName: ['text', 80],
    guardianName: ['text', 120],
    intakeAuthority: ['text', 140],
    note: ['text', 800],
    admissionDate: ['text', 40],
    nextReviewDate: ['text', 40],
    ageApprox: 'number',
    gender: ['text', 10],
    state: ['text', 80],
    district: ['text', 80],
    complexion: ['text', 400],
    build: ['text', 400],
    hair: ['text', 400],
    clothing: ['text', 400],
    languages: ['text', 400],
    birthMark: ['text', 400],
    identificationMark: ['text', 400],
    circumstances: ['text', 1200],
    producedByType: ['text', 40],
    educationLevel: ['text', 40],
    disabilityStatus: ['text', 40],
    mentalHealthConcern: ['text', 40],
    vulnerabilityCategories: 'list',
  };

  /** A case workflow event, as appended to `report.workflow`. */
  function workflowEvent(user, action, label, note = null, extra = {}) {
    const now = Date.now();
    return {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action,
      label,
      note: note || null,
      ...extra,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
    };
  }

  /** The patch that appends `event` to a case's workflow. */
  function withWorkflowEvent(report, event) {
    return {
      workflow: [...(Array.isArray(report.workflow) ? report.workflow : []), event],
      workflowStatus: event.label,
      lastWorkflowAction: event.action,
      lastWorkflowAt: new Date(event.ts).toISOString(),
    };
  }

  /**
   * What a confirmed match writes on the case: found, where, how the identity
   * was verified (parseVerification), and the workflow event that carries it.
   */
  function matchConfirmedPatch(report, user, { verification, foundLocation, matchScore, foundReportId = null }) {
    const event = workflowEvent(user, 'match_confirmed', 'Match confirmed', verification.note, {
      verification,
      foundReportId,
    });
    return {
      status: 'found',
      foundLocation,
      matchScore,
      verification,
      foundAt: new Date(event.ts).toISOString(),
      ...withWorkflowEvent(report, event),
    };
  }

  // ---- Telling the family -------------------------------------------------------
  //
  // Khozo used to mark `smsSent: true` and answer "SMS sent to <phone>" with no
  // gateway connected at all, so an officer believed the family had been told
  // and did not call them. Now an SMS is recorded only when the gateway took
  // it (shared/sms.js); otherwise the officer is given the family's number and
  // asked to call, and records the call (POST /:id/family-contacted).

  /**
   * The family's phone, or null when the case holds none: a number recorded as
   * the registering officer's own, or any agency account's, is not the family's
   * (familyPhone in shared/case-domain.js).
   */
  function familyPhoneOf(report) {
    return familyPhone(report, nonFamilyPhoneSet(listUsers()));
  }

  /** A family contact, as kept in `report.familyContacts`. */
  function familyContact(user, method, note = null, extra = {}) {
    return {
      at: new Date().toISOString(),
      byId: user.id,
      byName: user.name,
      byRole: user.role,
      method,
      note: note || null,
      ...extra,
    };
  }

  /**
   * Sends the family the case SMS if Khozo can, and records what happened.
   * Returns `{ sent, reason, phone }`; reason is one of FAMILY_SMS_MESSAGES.
   * Never throws: a gateway fault is an answer, not an error.
   */
  async function smsFamily(report, user, trigger) {
    const phone = familyPhoneOf(report);
    let outcome;
    if (!smsGatewayConfigured(settings)) {
      outcome = { sent: false, reason: 'no_gateway', phone };
    } else if (!phone) {
      outcome = { sent: false, reason: 'no_family_phone', phone: null };
    } else {
      const result = await sendSms({ to: digits(phone), message: familySmsText(report, user) }, { settings, fetchImpl });
      outcome = result.sent
        ? { sent: true, reason: 'sent', phone }
        : { sent: false, reason: 'gateway_failed', phone, gatewayStatus: result.status ?? null };
    }
    const scope = { state: report.state, district: report.district, reportId: report.id };
    if (outcome.sent) {
      const current = findReport(report.id) || report;
      const contact = familyContact(user, 'sms', null, { via: 'gateway' });
      updateReport(report.id, {
        smsSent: true,
        smsSentAt: contact.at,
        familyInformedAt: contact.at,
        familyContacts: [...(Array.isArray(current.familyContacts) ? current.familyContacts : []), contact],
      });
      addActivity({ actor: user.name, action: `SMS alert sent to ${report.parentName || 'parent'}`, target: report.childName, icon: 'sms', actorId: user.id, scope });
    }
    addAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: outcome.sent ? 'case.sms_sent' : 'case.sms_not_sent',
      targetType: 'report',
      targetId: report.id,
      summary: outcome.sent ? `SMS alert sent for ${report.childName}` : `No SMS sent for ${report.childName}: ${outcome.reason}`,
      scope,
      metadata: {
        trigger,
        reason: outcome.reason,
        phoneSuffix: phone ? digits(phone).slice(-4) : null,
        gatewayStatus: outcome.gatewayStatus ?? null,
      },
    });
    return outcome;
  }

  /**
   * Alerts authority accounts that a child (or a woman, or a person) has been
   * spotted.
   *
   * Deliberately not scoped to the district the sighting falls in. A citizen
   * reporting a child rarely knows which jurisdiction they are standing in, and
   * a trafficked child is by definition moving between them; an alert that only
   * reaches one district is the alert that arrives too late. So every
   * authority — police, SJPU, AHTU, DCRB, CWC, DCPU, RPF, CCI, SAA, JJB, DLSA,
   * the state and national desks — is told, and the message carries only where
   * and when.
   *
   * Only official desks (REVIEW_ROLES). Parents and NGOs are never notified:
   * anyone can create either account with a phone number, and an inbox that
   * listed every sighting, or said which ones "may match", would tell a member
   * of the public whether the photo they sent matched a missing person. A
   * family is told about its own case by an officer.
   *
   * `recipients` overrides the audience with an explicit list of accounts
   * (see caseOfficers); `exclude` leaves accounts out by id.
   *
   * Opening the sighting behind the alert still goes through the ordinary
   * jurisdiction rules, so knowing that a child was seen does not grant access
   * to that child's record.
   */
  function notifyAuthorities({ kind, title, body, priority = 'normal', scope = {}, roles = null, recipients = null, exclude = null }) {
    const audience = (recipients || listUsers()).filter(
      (u) => REVIEW_ROLES.includes(u.role) && (!roles || roles.includes(u.role)) && !exclude?.has(u.id)
    );
    for (const recipient of audience) {
      addNotification({
        userId: recipient.id,
        kind,
        title,
        body,
        priority,
        scope,
        // Lets an officer see at a glance whether this one is theirs to action,
        // without hiding the rest from them.
        // States compare by LGD code ("GUJARAT" and "ગુજરાત" are one state).
        inJurisdiction:
          !(scope.state || scope.stateCode) ||
          !(recipient.jurisdiction?.state || recipient.jurisdiction?.stateCode) ||
          sameStatePlace(recipient.jurisdiction, scope),
      });
    }
    return audience.length;
  }

  /**
   * The only accounts told that a sighting may match a case, or that a match
   * was confirmed: police officers who can open that case.
   *
   * "Possible match" is the one fact a lookalike photo must not leak. Sent to
   * every desk it told non-police desks that a police-only record exists and
   * where (shared/scope.js), and it told anyone holding a sighting receipt
   * whether their photo had matched. The officers who own the case are the ones
   * who have to act on it.
   */
  function caseOfficers(report) {
    if (!report) return [];
    return listUsers().filter((u) => POLICE_ROLES.includes(u.role) && canAccessReport(u, report));
  }

  /** "Ahmedabad, Gujarat": where a case was registered, for an alert. */
  function caseWhere(report) {
    return [report.district || report.districtText, report.state].filter(Boolean).join(', ') || 'an unrecorded place';
  }

  /**
   * Tells the desks of a district that a family or an NGO has registered a
   * case and is waiting for it to be verified.
   *
   * A citizen's registration used to alert nobody. It sat as intake_pending,
   * appeared in no queue, and was never compared with a sighting, because the
   * face search waits for an officer's verification (POST /:id/verify-intake).
   * So the police and SJPU desks that verify it, and the CWC of the district,
   * are told the moment it arrives: the district, the case id and what to do,
   * never the person's name (an alert is read on a shared station phone).
   *
   * The audience is whoever may open the case (shared/scope.js), so a report
   * placed in a state but no district reaches every district desk of that
   * state. With no such desk on Khozo yet, the state and national desks are
   * told instead, so the report is never nobody's.
   */
  function alertIntake(report) {
    const users = listUsers();
    let recipients = users.filter((u) => INTAKE_ALERT_ROLES.includes(u.role) && canAccessReport(u, report));
    if (!recipients.length) {
      recipients = users.filter((u) => ['admin', 'state_nodal', 'super_admin'].includes(u.role) && canAccessReport(u, report));
    }
    const category = personCategoryOf(report);
    const who = category === 'woman' ? 'missing woman' : category === 'adult' ? 'missing person' : 'missing child';
    return notifyAuthorities({
      kind: 'intake_pending',
      title: `New ${who} report to verify`,
      body: `A family or NGO registered a ${who} report in ${caseWhere(report)} (case ${report.id}). Verify it with them: face matching starts only after an officer verifies the report.`,
      priority: 'high',
      recipients,
      scope: {
        state: report.state || null,
        stateCode: report.stateCode || null,
        district: report.district || null,
        districtCode: report.districtCode || null,
        reportId: report.id,
        intake: true,
      },
    });
  }

  // ---- Linking a sighting to a case: shared by both directions ---------------
  //
  // A sighting is linked to a case by the forward search (a new sighting
  // against the open cases, POST /found) and by the reverse search (a newly
  // registered case against the stored sightings, POST / and POST /:id/rematch).
  // The rule, the evidence kept on the record and the officers' alert are the
  // same whichever way round the link was found, so they live here once.

  /**
   * Whether a comparison result is put in front of an officer.
   *
   * Calibrated against real Aarakshak output: photographs of the same person
   * score 0.48-0.86, different people score below 0.07. 0.6 sat inside the
   * genuine-match range and routed real matches away from police review. This
   * only decides whether an officer is shown the candidate - a human still
   * confirms - so it is set to catch matches, not to be conservative. A
   * candidate reaches an officer only when a biometric engine compared the
   * faces: the non-biometric scorer produces no candidates, and this guard makes
   * that a property of the route rather than of one module.
   */
  function isStrongMatch(candidate, engine) {
    return Boolean(candidate) && Boolean(engine?.biometric) && candidate.score >= MATCH_REVIEW_THRESHOLD;
  }

  /** What the comparison found, as kept on the sighting for the reviewer. */
  function matchEvidence(best, matchEngine) {
    // Photo quality is recorded for the reviewer but deliberately does NOT gate
    // routing. Gating on it was tried and rejected: the provider raises
    // `low_detector_confidence` on plenty of genuine matches too, so the filter
    // dropped a real one. Surfacing an extra face for a human to reject costs an
    // officer a minute; suppressing a real match costs a child.
    const lowQualityPhoto = Boolean(best?.lowQuality || best?.warnings?.length);
    return {
      photoQualityWarnings: best?.warnings?.length ? best.warnings : null,
      lowQualityPhoto: lowQualityPhoto || null,
      matchScore: best ? best.score : 0,
      // Both engines' numbers, kept rather than recomputed-and-dropped. The row
      // deliberately shows the LOWER of the two, so an officer looking at 52%
      // cannot tell from that number alone whether one engine was conservative
      // or the two disagreed. These fields are what the compare view reads to
      // answer that; without them it silently renders a single-engine story.
      primaryScore: best?.primaryScore ?? null,
      secondOpinionScore: best?.secondOpinionScore ?? null,
      secondOpinionProvider: best?.secondOpinionProvider || null,
      secondOpinion: best?.secondOpinion || null,
      enginesDisagree: best?.enginesDisagree ?? null,
      // Kept on the record, not just returned once. A reviewer deciding what a
      // score means has to know whether it came from a face comparison or from
      // the non-biometric fallback, and an auditor has to know months later.
      matchEngine: {
        provider: matchEngine.provider,
        modelVersion: matchEngine.modelVersion || null,
        biometric: Boolean(matchEngine.biometric),
        // Survives even when every candidate was withheld, which is the case
        // where the queue would otherwise read as "nothing was found" when what
        // actually happened is "two engines looked and would not agree".
        corroborated: Boolean(matchEngine.corroborated),
        secondOpinion: matchEngine.secondOpinion || null,
        comparedAgainst: matchEngine.comparedAgainst ?? null,
      },
    };
  }

  /** "Near the bus stand, Surat, Gujarat": a place, for an alert. */
  function placeText(foundLocation, { state, district } = {}) {
    return `${foundLocation}${state ? `, ${[district, state].filter(Boolean).join(', ')}` : ''}`;
  }

  /** Where the sighting itself was, for an alert. */
  function sightingWhere(sighting) {
    return placeText(sighting.foundLocation, sighting);
  }

  /**
   * The jurisdiction the reporter gave (or their phone placed them in). A
   * strong match overwrites the sighting's own state and district with the
   * matched case's, so this is kept separately; records from before it was
   * kept fall back to the sighting's current jurisdiction.
   */
  function reportedLocationOf(sighting) {
    if (sighting?.reportedLocation) return sighting.reportedLocation;
    return { state: sighting?.state || null, district: sighting?.district || null };
  }

  /**
   * Alerts authorities about a sighting. An alert carries where and when and the
   * category the reporter chose; never who the person is.
   *
   * Two copies:
   *   - the police officers who can open the matched case, if there is one
   *     (caseOfficers), are told it is a possible match, at high priority, with
   *     the case's jurisdiction;
   *   - every other desk, when `broadcast` is set, gets exactly the alert an
   *     unmatched sighting raises: the place the reporter gave, normal
   *     priority, nothing about a match. A desk that cannot open the case - or
   *     anyone holding a desk account and the receipt of a sighting they sent -
   *     cannot read the match from its inbox.
   */
  function alertSighting(sighting, { matchedReport = null, broadcast = true, matchedBody = null } = {}) {
    const personCategory = personCategoryOf(sighting);
    const officers = matchedReport ? caseOfficers(matchedReport) : [];
    if (officers.length) {
      notifyAuthorities({
        kind: 'sighting_reported',
        title: personCategory === 'woman'
          ? 'Possible match — woman spotted'
          : personCategory === 'adult' ? 'Possible match — person spotted' : 'Possible match — child spotted',
        body: matchedBody || `A sighting was reported at ${sightingWhere(sighting)}.`,
        priority: 'high',
        recipients: officers,
        // `matched` lets the alert open the page that actually contains the
        // record: an unmatched sighting is not on the Matches queue, so routing
        // there by default lands the officer on an empty page.
        scope: { state: sighting.state, district: sighting.district, foundReportId: sighting.id, matched: true },
      });
    }
    if (broadcast) {
      const reported = reportedLocationOf(sighting);
      notifyAuthorities({
        kind: 'sighting_reported',
        title: personCategory === 'woman' ? 'Woman spotted' : personCategory === 'adult' ? 'Person spotted' : 'Child spotted',
        body: `A sighting was reported at ${placeText(sighting.foundLocation, reported)}.`,
        priority: 'normal',
        exclude: new Set(officers.map((u) => u.id)),
        scope: { state: reported.state || null, district: reported.district || null, foundReportId: sighting.id, matched: false },
      });
    }
    return officers;
  }

  /**
   * The sighting fields a reverse link overwrites, as they were before it. Kept
   * on the link so an officer who rejects it puts the sighting back exactly
   * where it was: in its own district, in the CWC or police workflow it was in.
   */
  const LINK_RESTORED_FIELDS = [
    'status', 'state', 'district', 'referralStatus', 'referredTo1098',
    'matchScore', 'primaryScore', 'secondOpinionScore', 'secondOpinionProvider', 'secondOpinion',
    'enginesDisagree', 'matchEngine', 'photoQualityWarnings', 'lowQualityPhoto',
  ];

  function previousSightingFields(sighting) {
    return Object.fromEntries(LINK_RESTORED_FIELDS.map((key) => [key, sighting[key] ?? null]));
  }

  /** A sighting whose current link to a case was made by the reverse search. */
  function isReverseLinked(sighting) {
    return Boolean(
      sighting?.matchedReportId &&
      sighting.reverseMatch?.previous &&
      sighting.reverseMatch.reportId === sighting.matchedReportId
    );
  }

  /**
   * The reverse search: compares a case's photo with the stored sightings and
   * links each one the engines agree on, exactly as the forward search links a
   * strong match - the sighting moves to the Matches queue (`pending_review`,
   * `matchedReportId`), takes the case's jurisdiction so the case's officers
   * see it, and keeps the engines' evidence. The police officers who can open
   * the case are alerted, without being told who the person is (alertSighting);
   * nobody else is told anything new.
   *
   * What the link overwrote is kept on it (`reverseMatch.previous`): a
   * lookalike linked to a sighting a CWC desk was already following up must not
   * take that sighting away from them for good. An officer who rejects the link
   * restores it (POST /found/:id/review), and the same case is not proposed for
   * it again (`rejectedLinks`).
   *
   * Exists because the forward search only ever looks at the cases that exist
   * when a sighting arrives. A child photographed at a railway station on
   * Monday and reported missing on Wednesday was never compared with that
   * photo; now registering the case is what compares them.
   *
   * Runs inside the request, never after the response: the Worker's store
   * replica is flushed at the end of the request, so work left running after it
   * could be lost. A failure here never fails the registration that triggered
   * it - the case is already stored, and an officer can run /rematch.
   *
   * The person who sent the sighting is told nothing, and their receipt cannot
   * show it: its stage depends on nothing but time (publicSightingStatus).
   */
  async function matchStoredSightings(report, { trigger, actor }) {
    const result = (sightingMatches, engine) => ({ sightingMatches, engine: engineSummary(engine) });
    if (!report?.photoFile || report.anonymizedAt) {
      return result(0, { provider: 'none', biometric: false, reason: 'The case has no photo to compare.' });
    }
    if (typeof rankSightingMatches !== 'function') {
      return result(0, { provider: 'none', biometric: false, reason: 'Reverse matching is not available on this runtime.' });
    }
    try {
      const photo = await readPhoto(report.photoFile);
      if (!photo) return result(0, { provider: 'none', biometric: false, reason: 'The case photo could not be read.' });
      const { candidates, engine } = await rankSightingMatches(photo, {
        state: report.state,
        district: report.district,
        reportId: report.id,
      });

      const eligible = (row) => isReverseMatchCandidate(row) && !wasLinkRejected(row, report.id);
      const linkPatch = (row, candidate) => ({
        ...matchEvidence(candidate, engine),
        matchedReportId: report.id,
        // The case's jurisdiction, as on a forward match, so the officers
        // who own the case are the ones who see the sighting.
        state: report.state || null,
        district: report.district || null,
        status: 'pending_review',
        referralStatus: 'Police review pending',
        reverseMatch: {
          reportId: report.id,
          trigger,
          previousStatus: row.status,
          previous: previousSightingFields(row),
          matchedAt: new Date().toISOString(),
        },
      });

      let linked = 0;
      for (const candidate of candidates) {
        if (!isStrongMatch(candidate, engine)) continue;
        // Re-read rather than trust the ranking's snapshot: a sighting another
        // request linked, reviewed or anonymised in the meantime is not taken
        // over. On Express the store is live, so checking and writing with no
        // await between them is enough. The Worker's store is a copy read when
        // the request began, seconds of comparisons ago, so there the check
        // and the write happen together against the database (claimFoundReport).
        const current = findFoundReport(candidate.sighting?.id);
        if (!current || !eligible(current)) continue;
        let sighting;
        if (typeof claimFoundReport === 'function') {
          // eslint-disable-next-line no-await-in-loop
          sighting = await claimFoundReport(current.id, (row) => linkPatch(row, candidate), eligible);
          if (!sighting) continue;
        } else {
          const patch = linkPatch(current, candidate);
          updateFoundReport(current.id, patch);
          sighting = { ...current, ...patch };
        }
        const previousStatus = sighting.reverseMatch.previousStatus;
        addActivity({
          actor: 'Khozo matching',
          action: 'Linked an earlier sighting to a newly registered case for police review',
          target: sighting.foundLocation,
          icon: 'upload',
          scope: { state: sighting.state, district: sighting.district, matchedReportId: report.id },
        });
        addAudit({
          actorName: 'Khozo matching',
          actorRole: 'system',
          action: 'sighting.reverse_matched',
          targetType: 'foundReport',
          targetId: sighting.id,
          summary: `Linked earlier sighting at ${sighting.foundLocation} to case ${report.id} for police review`,
          scope: { matchedReportId: report.id, state: sighting.state, district: sighting.district },
          metadata: {
            reportId: report.id,
            trigger,
            triggeredByRole: actor?.role || null,
            previousStatus,
            matchScore: sighting.matchScore,
            matchEngine: sighting.matchEngine,
          },
        });
        // Only the case's police officers hear about it. Every desk was told
        // about this sighting when it arrived; a second alert to them now would
        // be the news that it matched someone.
        alertSighting(sighting, {
          matchedReport: report,
          broadcast: false,
          matchedBody: `An earlier sighting at ${sightingWhere(sighting)} may match a newly registered case.`,
        });
        linked += 1;
      }
      return result(linked, engine);
    } catch (err) {
      console.warn('[reports] reverse sighting match failed:', err?.message || err);
      return result(0, { provider: 'none', biometric: false, reason: 'The comparison could not be completed.' });
    }
  }

  /** The engine as an officer is told about it: no candidate, no score. */
  function engineSummary(engine) {
    if (!engine) return null;
    return {
      provider: engine.provider || 'none',
      modelVersion: engine.modelVersion || null,
      biometric: Boolean(engine.biometric),
      corroborated: Boolean(engine.corroborated),
      comparedAgainst: engine.comparedAgainst ?? 0,
      pool: engine.pool || null,
      note: engine.reason || engine.note || null,
    };
  }

  const foundReportLimit = fixedWindowRateLimit({
    name: 'public_found_report',
    limit: 10,
    envLimit: settings.foundReportLimit,
    key: (req) => `${clientIp(req)}:${String(req.body?.reporterPhone || '').trim()}`,
    onLimit: auditPublicRateLimit,
  });
  const publicCaseStatusLimit = fixedWindowRateLimit({
    name: 'public_case_status',
    limit: 30,
    envLimit: settings.caseStatusLimit,
    key: (req) => `${clientIp(req)}:${norm(req.params.ref)}`,
    onLimit: auditPublicRateLimit,
  });
  const publicSightingStatusLimit = fixedWindowRateLimit({
    name: 'public_sighting_status',
    limit: 30,
    envLimit: settings.sightingStatusLimit,
    key: (req) => `${clientIp(req)}:${norm(req.params.id)}`,
    onLimit: auditPublicRateLimit,
  });
  const publicBulletinLimit = fixedWindowRateLimit({
    name: 'public_bulletins',
    limit: 120,
    envLimit: settings.bulletinLimit,
    key: (req) => clientIp(req),
    onLimit: auditPublicRateLimit,
  });

  async function storePhoto(key, file) {
    if (!file) return { photoUrl: null, photoFile: null };
    const photoFile = await savePhoto(key, file.buffer, file.mimetype);
    return {
      photoUrl: photoFile ? `/api/reports/photo/${key}` : null,
      photoFile,
    };
  }


  router.get('/photo/:key', optionalAuth, async (req, res) => {
    const report = findReport(req.params.key);
    const found = findFoundReport(req.params.key);
    const record = report || found;
    if (!record) return res.status(404).end();

    // No photo is readable without a token: the public never sees the face of
    // a missing person (isPublicAppeal). Serving every verified missing case
    // anonymously (which is what "status === missing" once did) handed out a
    // browsable gallery of children's faces to anyone who could guess a case
    // id, and an officer-published bulletin is no longer an exception.
    const isPublicPhoto = Boolean(report) && isPublicAppeal(report) && !report.anonymizedAt;

    if (!isPublicPhoto) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (report && !canAccessReport(req.user, report)) {
        return res.status(403).json({ error: 'Photo is outside your jurisdiction' });
      }
      if (found && scopeFoundReports(req.user, [found], listReports()).length !== 1) {
        return res.status(403).json({ error: 'Photo is outside your jurisdiction' });
      }
    }

    const buffer = record.photoFile ? await readPhoto(record.photoFile) : null;
    if (!buffer) return res.status(404).end();
    res.type(photoMimeType(record.photoFile)).send(buffer);
  });

  // ---- Missing-child reports / FIRs -----------------------------------------

  /**
   * The public appeal list. Always empty: no case is ever a public appeal
   * (isPublicAppeal in shared/case-domain.js). The endpoint stays so that an
   * installed app or a cached page asking for it gets an empty list rather
   * than an error, and so that the one switch is the only thing that decides.
   */
  router.get('/public/bulletins', publicBulletinLimit, (req, res) => {
    let rows = listReports().filter((r) =>
      isPublicAppeal(r) &&
      r.status === 'missing' &&
      r.intakeStatus !== 'pending_verification' &&
      !r.anonymizedAt
    );
    const state = String(req.query.state || '').trim().toLowerCase();
    const district = String(req.query.district || '').trim().toLowerCase();
    if (state) rows = rows.filter((r) => String(r.state || '').toLowerCase() === state);
    if (district) rows = rows.filter((r) => String(r.district || '').toLowerCase() === district);
    rows = rows
      .slice()
      .sort((a, b) => new Date(b.bulletin?.publishedAt || b.createdAt || 0) - new Date(a.bulletin?.publishedAt || a.createdAt || 0))
      .slice(0, 100);
    res.json({ bulletins: rows.map(bulletinPayload) });
  });

  /**
   * One public appeal, by id. Always 404, for any id: no case is a public
   * appeal, and the answer must not differ between a case that exists and one
   * that does not, or the endpoint would confirm that a person is missing.
   */
  router.get('/public/bulletins/:id', publicBulletinLimit, (req, res) => {
    const report = findReport(req.params.id);
    const visible =
      report &&
      isPublicAppeal(report) &&
      report.status === 'missing' &&
      report.intakeStatus !== 'pending_verification' &&
      !report.anonymizedAt;
    if (!visible) return res.status(404).json({ error: 'No public bulletin for this case' });
    res.json({ bulletin: bulletinPayload(report) });
  });

  /**
   * Aggregate counts for the public landing page.
   *
   * Exists because that page used to display a fixed "10,468 missing / 4,068
   * reunited" under a heading that read "Live national overview". Numbers shown
   * to the public about missing children have to be the real ones, even while
   * they are small.
   *
   * Counts only, never a record: nothing here identifies a child.
   */
  router.get('/public/summary', publicBulletinLimit, (req, res) => {
    const rows = listReports().filter((r) => !r.anonymizedAt);
    const active = rows.filter((r) => r.status === 'missing' || r.status === 'under_review');
    const reunited = rows.filter((r) => r.status === 'found' || r.status === 'closed');
    const published = rows.filter((r) => isPublicAppeal(r) && r.status === 'missing');
    const sightings = listFoundReports();
    const reviewed = sightings.filter((f) => !['pending_review', 'no_match'].includes(f.status));

    res.json({
      summary: {
        activeCases: active.length,
        reunited: reunited.length,
        publicBulletins: published.length,
        sightingsReceived: sightings.length,
        sightingsActioned: reviewed.length,
        statesCovered: new Set(rows.map((r) => r.state).filter(Boolean)).size,
        agenciesOnboard: new Set(listUsers().filter((u) => u.role !== 'parent').map((u) => u.org || u.role)).size,
      },
      generatedAt: new Date().toISOString(),
    });
  });

  /**
   * Public search. Always an empty result: it searches public appeals only,
   * and there are none (isPublicAppeal). It used to also list recovered
   * children with an age band, gender and district, so that typing a name
   * answered whether that child was on Khozo and where from - a disclosure
   * whatever the name field said. A family follows its own case by its Khozo
   * case id (GET /public/status/:ref) or by logging in.
   */
  router.get('/public/search', publicBulletinLimit, (req, res) => {
    let rows = listReports().filter((r) =>
      isPublicAppeal(r) &&
      !r.anonymizedAt &&
      r.status === 'missing' &&
      r.intakeStatus !== 'pending_verification'
    );
    // Free text over the fields a member of the public actually knows: the
    // name on an appeal, or the place. Filtering happens here rather than in
    // the browser because the endpoint caps at 100 records.
    const q = String(req.query.q || '').trim().toLowerCase();
    const state = String(req.query.state || '').trim().toLowerCase();
    const district = String(req.query.district || '').trim().toLowerCase();
    const gender = String(req.query.gender || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.childName, r.district, r.state]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    const ageMin = Number(req.query.ageMin);
    const ageMax = Number(req.query.ageMax);
    if (state) rows = rows.filter((r) => String(r.state || '').toLowerCase() === state);
    if (district) rows = rows.filter((r) => String(r.district || '').toLowerCase() === district);
    if (gender) rows = rows.filter((r) => String(r.gender || '').toLowerCase() === gender);
    if (['missing', 'found', 'closed'].includes(status)) rows = rows.filter((r) => r.status === status);
    if (Number.isFinite(ageMin)) rows = rows.filter((r) => Number(r.age) >= ageMin);
    if (Number.isFinite(ageMax)) rows = rows.filter((r) => Number(r.age) <= ageMax);
    rows = rows
      .slice()
      .sort((a, b) => {
        const aTime = new Date(a.bulletin?.publishedAt || a.closure?.closedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.bulletin?.publishedAt || b.closure?.closedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 100);
    res.json({ results: rows.map(publicSearchPayload) });
  });

  /**
   * A family's public case lookup, by the Khozo case id only.
   *
   * The case id is random and is given to the family when the case is
   * registered. FIR numbers ("FIR/2026/1234") and external ids are sequential
   * or printed on paperwork, so anyone could walk them; they no longer resolve
   * here (404, the same answer as an id that does not exist). The payload is a
   * status with no identity in it (publicCaseStatus).
   *
   * The id is matched exactly; a differently-cased entry is accepted only when
   * it identifies exactly one case, so a typo can never land on someone else's.
   *
   * A police-only record (visibility 'police', shared/scope.js) never resolves:
   * no family was handed its id, so the only way to hold one is to have seen it
   * where it should not have been, and its status is police data.
   */
  router.get('/public/status/:ref', publicCaseStatusLimit, (req, res) => {
    const ref = cleanText(req.params.ref, 140);
    const rows = listReports().filter((r) => !r.anonymizedAt && !isPoliceOnly(r));
    let report = ref ? rows.find((r) => r.id === ref) : null;
    if (!report && ref) {
      const loose = rows.filter((r) => norm(r.id) === norm(ref));
      if (loose.length === 1) report = loose[0];
    }
    if (!report) return res.status(404).json({ error: 'Case reference not found' });
    res.json({ status: publicCaseStatus(report) });
  });

  // Scoped list for the logged-in stakeholder.
  router.get('/', protectedRoute, (req, res) => {
    let rows = scopeReports(req.user, listReports());
    const { status, q, category } = req.query;
    if (status) rows = rows.filter((r) => r.status === status);
    if (category) rows = rows.filter((r) => personCategoryOf(r) === category);
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter((r) =>
        [r.childName, r.parentName, r.firNo, r.address, r.state, r.district]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      );
    }
    // A match an officer has not yet confirmed lives on the sighting, not the
    // case, so a case list that reads only case status shows "missing" for a
    // child whose face two engines agreed on ten minutes ago. Surface the
    // strongest unconfirmed match per case, computed from the sightings this
    // caller is already allowed to see -- nothing crosses a jurisdiction line
    // that the Matches page would not show them anyway.
    const pendingByCase = new Map();
    for (const f of scopeFoundReports(req.user, listFoundReports(), rows)) {
      if (f.status !== 'pending_review' || !f.matchedReportId) continue;
      const prev = pendingByCase.get(f.matchedReportId);
      if (!prev || (f.matchScore || 0) > prev.score) {
        pendingByCase.set(f.matchedReportId, {
          foundReportId: f.id,
          score: f.matchScore || 0,
          corroborated: Boolean(f.matchEngine?.corroborated),
          at: f.createdAt || null,
        });
      }
    }
    // A parent or NGO sees what they registered and where it stands, never
    // what the agencies added to it (citizenCaseView).
    const citizen = isCitizenRole(req.user.role);
    res.json({
      reports: rows.map((r) => ({
        ...(citizen ? citizenCaseView(r) : r),
        // Records written before the field existed are children; say so
        // explicitly so no client has to know the default.
        personCategory: personCategoryOf(r),
        pendingMatch: citizen ? null : pendingByCase.get(r.id) || null,
      })),
    });
  });

  // Register a missing child. Parents/NGOs file a report; police file a formal FIR.
  router.post('/', protectedRoute, requireRole(...REPORT_CREATE_ROLES), upload.single('photo'), async (req, res) => {
    const read = readFields(req.body, REPORT_FIELDS);
    if (read.error) return res.status(400).json({ error: read.error, errors: [read.error] });
    const b = read.body;
    const validation = validateMissingReport(b, req.file);
    if (validation.errors) return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    if (req.file && !isTruthy(b.photoConsent)) {
      return res.status(400).json({ error: 'Photo consent is required before uploading a child image' });
    }
    const id = `r_${nanoid(8)}`;
    const isPolice = FORMAL_CASE_ROLES.includes(req.user.role);
    const personCategory = validation.personCategory || 'child';
    const adult = isAdultCategory(personCategory);
    const childProfile = buildChildProfile(b);
    const declaration = buildReportDeclaration(b, req.user);
    // Nobody's gender is assumed. The form used to start on Male and a case
    // sent without one was stored as a boy; now the form makes the reporter
    // choose (Unknown is a choice), and a client that sends none records
    // Unknown. A missing woman is Female.
    const gender = b.gender || (personCategory === 'woman' ? 'Female' : 'Unknown');
    // Where the case belongs, as canonical names and LGD codes (shared/geo):
    // what the form sent, else the registering account's own jurisdiction. An
    // account's district is only assumed for a case in the account's state.
    // An officer must name a real district (jurisdictionError); a family's
    // unrecognised text is kept as `districtText` and the case reaches every
    // district desk of its state.
    const own = req.user.jurisdiction || {};
    const sentState = Boolean(b.state || b.stateCode);
    const inOwnState = !sentState || sameStatePlace({ state: b.state, stateCode: b.stateCode }, own);
    const sentDistrict = Boolean(b.district || b.districtCode);
    const placeInput = {
      state: sentState ? b.state || null : own.state || null,
      stateCode: sentState ? b.stateCode || null : own.stateCode || null,
      district: sentDistrict ? b.district || null : inOwnState ? own.district || null : null,
      districtCode: sentDistrict ? b.districtCode || null : inOwnState ? own.districtCode || null : null,
    };
    const placeResult = canonicalPlace(placeInput);
    if (isPolice) {
      const refused = jurisdictionError(placeInput, placeResult);
      if (refused) return res.status(400).json({ ...refused, errors: [refused.error] });
    }
    const { resolved: _placeResolved, ...place } = placeResult;
    // Where the contact number came from. A parent filing for their own child
    // gives their own number, which is a family phone; an officer or NGO who
    // leaves it blank gets their desk's number as the contact, which is not
    // evidence of who the child is and must never make two cases look alike.
    const parentPhone = b.parentPhone || req.user.phone;
    const parentPhoneSource = b.parentPhone
      ? 'provided'
      : req.user.role === 'parent' ? 'reporter' : 'registering_officer';
    // Optional restriction of the case to police desks. Only police roles may
    // set it; from anyone else it is ignored rather than refused, so a parent
    // or NGO client that sends it still files the report.
    let visibility = null;
    const requestedVisibility = (b.visibility || '').toLowerCase();
    if (requestedVisibility && POLICE_VISIBILITY_ROLES.includes(req.user.role)) {
      if (!REPORT_VISIBILITY_VALUES.includes(requestedVisibility)) {
        return res.status(400).json({ error: `Visibility must be one of ${REPORT_VISIBILITY_VALUES.join(', ')}` });
      }
      visibility = requestedVisibility;
    }
    const incoming = {
      personCategory,
      childName: b.childName,
      childAadhar: b.childAadhar || null,
      gender,
      age: validation.age,
      parentPhone,
      parentPhoneSource,
      ...place,
      identificationProfile: childProfile.identificationProfile,
      vulnerabilityProfile: childProfile.vulnerabilityProfile,
    };
    const duplicateCandidates = findDuplicateCandidates(req.user, incoming, listReports(), scopeReports, {
      nonFamilyPhones: nonFamilyPhoneSet(listUsers()),
    });
    const allowDuplicate = b.allowDuplicate === true || b.allowDuplicate === 'true';
    if (duplicateCandidates.length && !allowDuplicate) {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'case.duplicate_warning',
        targetType: 'report',
        summary: `Potential duplicate report blocked for ${b.childName}`,
        scope: { state: incoming.state, district: incoming.district },
        metadata: { candidateIds: duplicateCandidates.map((c) => c.report.id), topScore: duplicateCandidates[0].score },
      });
      return res.status(409).json({
        error: 'Possible duplicate case found',
        duplicateCandidates: duplicateCandidates.map((c) => duplicatePayload(req.user, c)),
      });
    }
    const report = {
      id,
      personCategory,
      ...(visibility ? { visibility } : {}),
      firNo: b.firNo || (isPolice ? generatedFirNo() : null),
      childName: b.childName,
      childAadhar: b.childAadhar || null,
      gender,
      age: validation.age,
      height: validation.height,
      weight: validation.weight,
      identificationProfile: childProfile.identificationProfile,
      vulnerabilityProfile: childProfile.vulnerabilityProfile,
      declaration,
      hasIdentificationProfile: childProfile.hasIdentificationProfile,
      hasVulnerabilityProfile: childProfile.hasVulnerabilityProfile,
      dateOfMissing: b.dateOfMissing || new Date().toISOString(),
      ...(await storePhoto(id, req.file)),
      photoConsent: req.file ? true : isTruthy(b.photoConsent),
      dataPurpose: b.dataPurpose || (adult ? 'missing_person_investigation' : 'missing_child_investigation'),
      retentionUntil: retentionUntil(REPORT_PHOTO_RETENTION_DAYS),
      status: isPolice ? 'missing' : 'intake_pending',
      intakeStatus: isPolice ? 'verified' : 'pending_verification',
      intakeSource: isPolice ? 'official_fir' : 'citizen_report',
      verifiedAt: isPolice ? Date.now() : null,
      verifiedById: isPolice ? req.user.id : null,
      verifiedByName: isPolice ? req.user.name : null,
      parentName: b.parentName || req.user.name,
      parentPhone,
      parentPhoneSource,
      parentEmail: b.parentEmail || null,
      address: b.address || null,
      ...place,
      zip: b.zip || null,
      foundLocation: null,
      matchScore: 0,
      smsSent: false,
      registeredByRole: req.user.role,
      registeredById: req.user.id,
      createdAt: Date.now(),
    };
    addReport(report);
    addActivity({ actor: req.user.name, action: isPolice ? 'Registered an FIR' : adult ? 'Submitted missing-person intake for verification' : 'Submitted missing-child intake for verification', target: report.childName, icon: 'plus', actorId: req.user.id, scope: { state: report.state, district: report.district, reportId: report.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: isPolice ? 'case.fir_registered' : 'case.report_registered',
      targetType: 'report',
      targetId: report.id,
      summary: `${isPolice ? 'Registered FIR' : 'Submitted citizen/NGO intake'} for ${report.childName}`,
      scope: { state: report.state, district: report.district },
      metadata: {
        personCategory,
        visibility,
        photoConsent: report.photoConsent,
        dataPurpose: report.dataPurpose,
        retentionUntil: report.retentionUntil,
        intakeStatus: report.intakeStatus,
        hasIdentificationProfile: report.hasIdentificationProfile,
        vulnerabilityCategories: report.vulnerabilityProfile.categories,
        producedByType: report.vulnerabilityProfile.producedByType,
        declarationAccepted: true,
        declarationMethod: declaration.method,
        declarationSignerRole: declaration.signerRole,
        relationshipToChild: declaration.relationshipToChild,
      },
    });
    if (duplicateCandidates.length && allowDuplicate) {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'case.duplicate_override',
        targetType: 'report',
        targetId: report.id,
        summary: `Created ${report.childName} after duplicate warning override`,
        scope: { state: report.state, district: report.district },
      metadata: { candidateIds: duplicateCandidates.map((c) => c.report.id), topScore: duplicateCandidates[0].score, retentionUntil: report.retentionUntil },
    });
    }
    // A family's or an NGO's report waits for an officer, so the officers who
    // verify it are told it is there (alertIntake).
    if (isPendingCitizenIntake(report)) alertIntake(report);
    // Two-way matching: a case registered with a photo is compared with the
    // sightings already stored, inside this request (see matchStoredSightings).
    // Bulk imports arrive here one row at a time, so they are covered too.
    //
    // A citizen or NGO intake waits for an officer's verification first: each
    // comparison is a paid provider call, the demo parent and NGO logins are
    // public, and an unverified registration should not be able to spend the
    // comparison budget. verify-intake runs the same search.
    const reverse = report.photoFile && !isPendingCitizenIntake(report)
      ? await matchStoredSightings(report, { trigger: 'registration', actor: req.user })
      : { sightingMatches: 0 };
    res.status(201).json({
      report: isCitizenRole(req.user.role) ? citizenCaseView(report) : report,
      // How many stored sightings were linked to this case for police review.
      // Told to the officers who register formal cases. A parent or NGO
      // registering a case gets null whatever was found: a family is not told
      // that someone resembling their child was seen until an officer has
      // confirmed it.
      sightingMatches: FORMAL_CASE_ROLES.includes(req.user.role) ? reverse.sightingMatches : null,
    });
  });

  // ---- Public "I spotted a child" uploads + face match ----------------------

  router.get('/found/status/:id', publicSightingStatusLimit, (req, res) => {
    const found = findFoundReport(req.params.id);
    if (!found) return res.status(404).json({ error: 'Sighting receipt not found' });
    res.json({ status: publicSightingStatus(found) });
  });

  // Public endpoint (no auth): citizen uploads a photo and gets a review-safe receipt.
  // optionalAuth only so that an officer filing a sighting from the console is
  // shown the match result; a member of the public never is (see the response).
  router.post('/found', optionalAuth, upload.single('photo'), foundReportLimit, async (req, res) => {
    const read = readFields(req.body, FOUND_FIELDS);
    if (read.error) return res.status(400).json({ error: read.error, errors: [read.error] });
    const b = read.body;
    const validation = validateFoundReport(b, req.file);
    if (validation.errors) return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    if (req.file && !isTruthy(b.photoConsent)) {
      return res.status(400).json({ error: 'Photo consent is required before submitting a sighting image' });
    }
    if (!req.file && !String(b.note || '').trim() && !String(b.foundLocation || '').trim()) {
      return res.status(400).json({ error: 'Add a photo or enough sighting details to help CWC/Childline review the report' });
    }
    const id = `f_${nanoid(8)}`;
    // Who was seen. The comparison below still runs against every open case
    // whatever the category: a reporter's guess at "child" or "woman" for a
    // sixteen-year-old is exactly the judgement that should not narrow a search.
    const personCategory = validation.personCategory || 'child';
    const adultSighting = isAdultCategory(personCategory);

    // Screening decides who hears about this report: a public upload endpoint
    // receives whatever a phone camera happened to be pointed at, and alerting
    // every authority in the country about a photo of the floor is how officers
    // learn to ignore the alert that matters.
    //
    // It runs alongside the match rather than before it. Both call the same
    // provider, the citizen is waiting on the response, and the ordinary case
    // is a real photograph of a real child that needs both answers anyway.
    //
    // The location is resolved first because it decides which cases the photo
    // is compared against: the comparison budget is spent on the sighting's own
    // district and state before anywhere else (shared/match-pool.js).
    const locationScope = await resolveSightingLocation({ ...b, lat: validation.lat, lng: validation.lng }, { fetchImpl });
    const [screening, matchResult] = await Promise.all([
      detectPerson(req.file?.buffer || null),
      rankMatches(req.file?.buffer || null, {
        gender: b.gender,
        ageApprox: validation.ageApprox,
        state: locationScope.state,
        district: locationScope.district,
        stateCode: locationScope.stateCode || null,
        districtCode: locationScope.districtCode || null,
      }),
    ]);
    const { candidates, engine: matchEngine } = matchResult;
    const canRunMatch = !!req.file;
    const best = candidates[0];
    // The same rule the reverse search applies (isStrongMatch above).
    const hasStrongMatch = canRunMatch && isStrongMatch(best, matchEngine);
    // Where the sighting is filed: the matched case's jurisdiction on a strong
    // match, else where the reporter was. Either way canonical names with LGD
    // codes, and an unrecognised district kept as text (shared/geo).
    const reportedPlace = {
      state: locationScope.state || null,
      stateCode: locationScope.stateCode || null,
      district: locationScope.district || null,
      districtCode: locationScope.districtCode || null,
      districtText: locationScope.districtText || null,
    };
    const matchedScope = hasStrongMatch && (best.report.state || best.report.district || best.report.stateCode)
      ? placeFields({ ...best.report, district: best.report.district || best.report.districtText })
      : null;
    const filedPlace = matchedScope || reportedPlace;
    // The phone's coordinates fill in the jurisdiction the reporter did not
    // type. What they did type always wins; a failed lookup changes nothing.
    const confidentialReporter = isTruthy(b.confidentialReporter);
    const reporterName = cleanText(b.reporterName, 120) || 'Anonymous citizen';
    const idProofType = SIGHTING_ID_PROOF_TYPES[b.idProofType] ? b.idProofType : null;
    const idProofNumberMasked = idProofType ? maskProofNumber(b.idProofNumber) : null;
    const fr = {
      id,
      ...(await storePhoto(id, req.file)),
      foundLocation: cleanText(b.foundLocation, 180) || 'Unknown',
      lat: validation.lat,
      lng: validation.lng,
      reporterName,
      reporterDisplayName: confidentialReporter ? 'Confidential citizen' : reporterName,
      reporterPhone: b.reporterPhone || null,
      reporterPhoneVisible: confidentialReporter ? null : b.reporterPhone || null,
      confidentialReporter,
      identityConfidential: confidentialReporter,
      idProofType,
      idProofLabel: idProofType ? SIGHTING_ID_PROOF_TYPES[idProofType] : null,
      idProofNumberMasked,
      idProofVerified: Boolean(idProofType && idProofNumberMasked),
      note: cleanText(b.note, 500) || null,
      personCategory,
      ageApprox: validation.ageApprox,
      gender: ['Male', 'Female', 'Other'].includes(b.gender)
        ? b.gender
        : personCategory === 'woman' ? 'Female' : null,
      ...filedPlace,
      // Where the reporter was. `state`/`district` above become the matched
      // case's on a strong match; this never does, so anything told to people
      // who may not know about the match (the alert every desk gets, the
      // reporter's receipt) is worded from it.
      reportedLocation: reportedPlace,
      matchedReportId: hasStrongMatch ? best.report.id : null,
      // Scores, both engines' numbers and the engine itself (matchEvidence).
      ...matchEvidence(best, matchEngine),
      status: hasStrongMatch ? 'pending_review' : 'no_match',
      photoConsent: req.file ? true : isTruthy(b.photoConsent),
      dataPurpose: adultSighting
        ? (req.file ? 'sighting_review_and_missing_person_tracing' : 'text_sighting_police_intake')
        : (req.file ? 'sighting_review_and_child_protection' : 'text_sighting_childline_intake'),
      retentionUntil: retentionUntil(SIGHTING_PHOTO_RETENTION_DAYS),
      // Childline 1098 is a child-protection line; an adult's sighting goes to police.
      referredTo1098: !adultSighting,
      referralStatus: hasStrongMatch
        ? 'Police review pending'
        : adultSighting ? 'Police intake queued' : 'Childline/CWC intake queued',
      // What the screen found, kept on the record so a reviewer can see why the
      // report was routed the way it was rather than guessing.
      screening: {
        ...screening,
        // A text-only report has no photo to screen and is a person's account of
        // seeing a child, so it alerts on its own terms.
        raisesAlert: !req.file || screening.verdict === 'person',
      },
      locationSource: locationScope.source || 'reporter',
      createdAt: Date.now(),
    };
    addFoundReport(fr);
    addActivity({ actor: publicReporterName(fr), action: adultSighting ? 'Reported a sighting of a missing person' : 'Uploaded a spotted-child photo', target: fr.foundLocation, icon: 'upload', scope: { state: fr.state, district: fr.district, matchedReportId: fr.matchedReportId } });
    addAudit({
      actorName: publicReporterName(fr),
      actorRole: 'public',
      action: 'sighting.submitted',
      targetType: 'foundReport',
      targetId: fr.id,
      summary: `Public sighting submitted at ${fr.foundLocation}`,
      scope: { matchedReportId: fr.matchedReportId, state: fr.state, district: fr.district },
      metadata: { personCategory, matchScore: fr.matchScore, status: fr.status, matchEngine, matchAttempted: canRunMatch, confidentialReporter, idProofType, idProofCaptured: fr.idProofVerified },
    });
    // A confirmed biometric match overrides the screen for the officers who own
    // the matched case: the screen is a cheap guard against uploads with no
    // person in them, two engines agreeing on a face is a far stronger
    // statement than one probe deciding it saw nobody, and letting the weaker
    // signal suppress the stronger one means the alert that matters most is the
    // one nobody receives. Every other desk gets what an unmatched sighting with
    // the same screening result would raise, so the match cannot be read from
    // their inboxes (alertSighting).
    const caseOfficerIds = new Set(
      alertSighting(fr, {
        matchedReport: hasStrongMatch ? best.report : null,
        broadcast: fr.screening.raisesAlert,
      }).map((u) => u.id)
    );
    if (!fr.screening.raisesAlert) {
      // Screened out, not discarded. One person still looks at it, because the
      // screen can be wrong and the cost of it being wrong is a real sighting
      // that nobody read.
      const reported = reportedLocationOf(fr);
      const where = placeText(fr.foundLocation, reported);
      notifyAuthorities({
        kind: 'sighting_screening',
        title: fr.screening.verdict === 'no_person' ? 'Upload with no person in it' : 'Unscreened upload',
        body:
          fr.screening.verdict === 'no_person'
            ? `An upload at ${where} contained no recognisable person. Queued for your review.`
            : `An upload at ${where} could not be screened — no detection provider answered. Queued for your review.`,
        priority: 'normal',
        roles: ['super_admin'],
        exclude: caseOfficerIds,
        scope: { state: reported.state || null, district: reported.district || null, foundReportId: fr.id },
      });
    }
    if (!hasStrongMatch && adultSighting) {
      addAudit({
        actorName: 'Khozo intake',
        actorRole: 'system',
        action: 'sighting.police_queued',
        targetType: 'foundReport',
        targetId: fr.id,
        summary: `Queued unmatched missing-person sighting for police follow-up at ${fr.foundLocation}`,
        scope: { state: fr.state, district: fr.district },
      });
    } else if (!hasStrongMatch) {
      addActivity({ actor: 'Khozo intake', action: 'Queued report for 1098/CWC follow-up', target: fr.foundLocation, icon: 'referral', scope: { state: fr.state, district: fr.district } });
      addAudit({
        actorName: 'Khozo intake',
        actorRole: 'system',
        action: 'sighting.cwc_queued',
        targetType: 'foundReport',
        targetId: fr.id,
        summary: `Queued unmatched sighting for 1098/CWC follow-up at ${fr.foundLocation}`,
        scope: { state: fr.state, district: fr.district },
      });
    }
    // What the person who submitted this is told.
    //
    // A member of the public learns nothing about whether the photograph
    // resembled anyone: not a score, not a candidate's age band, not "possible
    // match". A receipt that says "possible match" is itself a disclosure - it
    // tells a stranger that the person they photographed is a missing child,
    // or a woman someone is looking for - and anyone can point a camera and
    // submit. So every public reporter gets the same receipt whatever the
    // engines found. The full result stays on the record for officers.
    //
    // A police officer filing from the console sees the result, for the cases
    // they may open. Everyone else gets the receipt: a parent or NGO account,
    // and every non-police desk (CWC, DCPU, CCI, ...), because the comparison
    // runs against police-only records too (shared/scope.js) and a desk that
    // may not open such a record must not be able to test a face against it.
    // So does an officer whose best match is a case outside their scope: the
    // result would tell them where that case is held.
    const officerView =
      Boolean(req.user) &&
      POLICE_ROLES.includes(req.user.role) &&
      (!hasStrongMatch || canAccessReport(req.user, best.report));
    if (!officerView) {
      return res.status(201).json({
        foundReport: {
          id: fr.id,
          status: 'received',
          personCategory,
          foundLocation: fr.foundLocation,
          // Where the reporter was, not fr.state/district: on a strong match
          // those are overwritten with the matched case's jurisdiction, which
          // would tell the reporter where the person they saw is from.
          state: locationScope.state,
          district: locationScope.district,
          referralStatus: 'Received for review',
          retentionUntil: fr.retentionUntil,
        },
        review: 'Thank you. Your report has reached the police and child-protection desks for this area. Keep your receipt number to track it.',
        candidates: [],
      });
    }
    // Only cases this officer may open: an unscoped list would describe
    // records in other districts, and police-only ones to nobody else.
    const visibleCandidates = candidates.filter((c) => canAccessReport(req.user, c.report));
    res.status(201).json({
      foundReport: {
        id: fr.id,
        status: fr.status,
        personCategory,
        foundLocation: fr.foundLocation,
        state: fr.state,
        district: fr.district,
        matchScore: hasStrongMatch ? fr.matchScore : visibleCandidates[0]?.score ?? 0,
        referralStatus: fr.referralStatus,
        referredTo1098: fr.referredTo1098,
        retentionUntil: fr.retentionUntil,
        matchEngine: {
          provider: matchEngine.provider,
          modelVersion: matchEngine.modelVersion,
          biometric: matchEngine.biometric,
        },
      },
      review: hasStrongMatch
        ? 'Possible match found. Police will review before any identity or family details are shared.'
        : req.file
          ? (adultSighting
            ? 'No strong match yet. The report is saved and queued for police follow-up.'
            : 'No strong match yet. The report is saved and queued for Childline/CWC follow-up.')
          : (adultSighting
            ? 'Your text sighting is saved and queued for police follow-up. No face-match search was run because no photo was uploaded.'
            : 'Your text sighting is saved and queued for Childline/CWC follow-up. No face-match search was run because no photo was uploaded.'),
      candidates: visibleCandidates
        .map((c, index) => ({
          rank: index + 1,
          score: c.score,
          personCategory: personCategoryOf(c.report),
          ageBand: c.report.age == null ? 'Unknown' : `${Math.max(0, c.report.age - 1)}-${c.report.age + 1}`,
          gender: c.report.gender,
        })),
    });
  });

  router.get('/found/all', protectedRoute, requireRole(...REVIEW_ROLES), (req, res) => {
    const scopedFound = scopeFoundReports(req.user, listFoundReports(), listReports());
    const reportsById = Object.fromEntries(scopeReports(req.user, listReports()).map((r) => [r.id, r]));
    res.json({
      foundReports: scopedFound.map((f) => {
        const matched = f.matchedReportId ? reportsById[f.matchedReportId] : null;
        return {
          ...f,
          personCategory: personCategoryOf(f),
          reporterName: publicReporterName(f),
          reporterPhone: f.confidentialReporter ? null : f.reporterPhone || null,
          reporterPhoneVisible: f.confidentialReporter ? null : f.reporterPhone || null,
          matchedReport: matched ? {
            id: matched.id,
            personCategory: personCategoryOf(matched),
            childName: matched.childName,
            age: matched.age,
            gender: matched.gender,
            address: matched.address,
            state: matched.state,
            district: matched.district,
            parentName: matched.parentName,
            parentPhone: matched.parentPhone,
            status: matched.status,
            photoUrl: matched.photoUrl || (matched.photoFile ? `/api/reports/photo/${matched.id}` : null),
            retentionUntil: matched.retentionUntil,
            dataPurpose: matched.dataPurpose,
          } : null,
        };
      }),
    });
  });

  /**
   * An officer's decision on a sighting: confirm the match, reject it, or refer
   * the sighting to Childline/CWC.
   *
   * Confirming is for police and command roles only, and marks the case found.
   *
   * A link the reverse search made (a newly registered case matched a sighting
   * already on file) is undone, not closed, when an officer rejects it or
   * refers the sighting on: the sighting goes back to the district, status and
   * referral it had before (`reverseMatch.previous`), so a CWC desk that was
   * following it up gets it back, and the case is recorded in `rejectedLinks`
   * so it is not proposed for that sighting again. A lookalike must not be able
   * to take a child-protection referral out of the CWC queue for good.
   *
   * The reporter's receipt does not change whichever way it is decided: its
   * stage depends only on time (publicSightingStatus).
   */
  router.post('/found/:id/review', protectedRoute, requireRole(...REVIEW_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    const visible = scopeFoundReports(req.user, [f], listReports()).length === 1;
    if (!visible) return res.status(403).json({ error: 'Found report is outside your jurisdiction' });

    const read = readFields(req.body, { decision: ['text', 20], note: ['text', 500] });
    if (read.error) return res.status(400).json({ error: read.error });
    const { decision } = read.body; // 'matched' | 'rejected' | 'refer_cwc'
    if (!['matched', 'rejected', 'refer_cwc'].includes(decision)) {
      return res.status(400).json({ error: 'Review decision must be matched, rejected or refer_cwc' });
    }
    if (decision === 'matched' && !FORMAL_CASE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Only police or command roles can confirm reunification' });
    }
    // Checked before anything is written, so a refused confirmation leaves the
    // sighting exactly as it was.
    const matchedCase = decision === 'matched' && f.matchedReportId ? findReport(f.matchedReportId) : null;
    if (decision === 'matched' && f.matchedReportId && !canAccessReport(req.user, matchedCase)) {
      return res.status(403).json({ error: 'Matched case is outside your jurisdiction' });
    }
    // Confirming says the person found is the person missing, and the record
    // keeps how the officer knows: in person, by video, from documents; who
    // checked, where, and what they saw.
    const verification = decision === 'matched' ? parseVerification(req.body?.verification, req.user) : null;
    if (decision === 'matched' && !verification) {
      return res.status(400).json({ error: VERIFICATION_REQUIRED });
    }
    // The reviewer's own note (the mobile app has always sent one), kept with
    // who decided and when, whichever way it was decided.
    const reviewNote = read.body.note || null;
    const reviewed = {
      reviewDecision: decision,
      reviewNote,
      reviewedAt: new Date().toISOString(),
      reviewedById: req.user.id,
      reviewedByName: req.user.name,
      reviewedByRole: req.user.role,
    };

    const undoReverseLink = decision !== 'matched' && isReverseLinked(f);
    const restored = undoReverseLink
      ? {
          ...f.reverseMatch.previous,
          matchedReportId: null,
          reverseMatch: null,
          rejectedLinks: [
            ...(Array.isArray(f.rejectedLinks) ? f.rejectedLinks : []),
            {
              reportId: f.matchedReportId,
              decision,
              trigger: f.reverseMatch.trigger || null,
              matchScore: f.matchScore ?? null,
              linkedAt: f.reverseMatch.matchedAt || null,
              decidedAt: new Date().toISOString(),
              decidedById: req.user.id,
              decidedByRole: req.user.role,
            },
          ],
        }
      : null;

    if (decision === 'refer_cwc') {
      updateFoundReport(f.id, {
        ...(restored || {}),
        ...reviewed,
        status: 'referred_cwc',
        referredTo1098: true,
        referralStatus: 'Referred to Childline/CWC',
      });
      const after = findFoundReport(f.id);
      addActivity({ actor: req.user.name, action: 'Referred sighting to 1098/CWC', target: f.foundLocation, icon: 'referral', actorId: req.user.id, scope: { state: after.state, district: after.district, matchedReportId: after.matchedReportId } });
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.referred_cwc',
        targetType: 'foundReport',
        targetId: f.id,
        summary: `Referred sighting at ${f.foundLocation} to 1098/CWC`,
        scope: { matchedReportId: f.matchedReportId },
        metadata: {
          ...(undoReverseLink ? { reverseLinkUndone: true, unlinkedReportId: f.matchedReportId } : {}),
          noteLength: reviewNote ? reviewNote.length : 0,
        },
      });
      return res.json({ foundReport: after });
    }

    if (restored) {
      updateFoundReport(f.id, { ...restored, ...reviewed });
    } else {
      const reviewedStatus = decision === 'matched' ? 'matched' : 'rejected';
      updateFoundReport(f.id, {
        ...reviewed,
        ...(verification ? { verification } : {}),
        status: reviewedStatus,
        referralStatus: decision === 'matched' ? 'Police match confirmed' : 'Police rejected match',
      });
    }
    if (decision === 'matched' && matchedCase) {
      const r = matchedCase;
      updateReport(f.matchedReportId, matchConfirmedPatch(r, req.user, {
        verification,
        foundLocation: f.foundLocation,
        matchScore: f.matchScore,
        foundReportId: f.id,
      }));
      addActivity({ actor: req.user.name, action: 'Confirmed sighting match', target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.match_confirmed',
        targetType: 'foundReport',
        targetId: f.id,
        // The summary names no one who verified: the verification itself is
        // in the metadata.
        summary: `Confirmed sighting match for ${r.childName} (${verification.methodLabel})`,
        scope: { state: r.state, district: r.district, reportId: r.id },
        metadata: { matchScore: f.matchScore, verification, noteLength: reviewNote ? reviewNote.length : 0 },
      });
    } else if (decision === 'matched') {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.match_confirmed',
        targetType: 'foundReport',
        targetId: f.id,
        summary: `Confirmed sighting at ${f.foundLocation} (${verification.methodLabel})`,
        scope: { state: f.state, district: f.district },
        metadata: { matchScore: f.matchScore, verification, noteLength: reviewNote ? reviewNote.length : 0 },
      });
    } else if (decision === 'rejected') {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.rejected',
        targetType: 'foundReport',
        targetId: f.id,
        summary: undoReverseLink
          ? `Rejected the link between the sighting at ${f.foundLocation} and a newly registered case; the sighting is back where it was`
          : `Rejected sighting match at ${f.foundLocation}`,
        scope: { matchedReportId: f.matchedReportId },
        metadata: {
          ...(undoReverseLink
            ? { reverseLinkUndone: true, unlinkedReportId: f.matchedReportId, restoredStatus: restored.status }
            : {}),
          noteLength: reviewNote ? reviewNote.length : 0,
        },
      });
    }
    if (decision === 'matched' && matchedCase) {
      // Confirming here sends nobody anything; the answer says so, as
      // confirm-match does, with the number to call when the family may be told.
      const adult = isAdultCase(matchedCase);
      return res.json({
        foundReport: findFoundReport(f.id),
        report: findReport(matchedCase.id),
        familyNotified: false,
        familyPhone: adult ? null : familyPhoneOf(matchedCase),
        familyReason: adult ? 'consent_required' : 'not_requested',
        familyMessage: FAMILY_SMS_MESSAGES[adult ? 'consent_required' : 'not_requested'],
        ...(adult ? { personConsentRequired: true } : {}),
      });
    }
    res.json({ foundReport: findFoundReport(f.id) });
  });

  router.post('/found/:id/cwc-followup', protectedRoute, requireRole(...CWC_FOLLOWUP_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    const visible = scopeFoundReports(req.user, [f], listReports()).length === 1;
    if (!visible) return res.status(403).json({ error: 'Found report is outside your jurisdiction' });
    if (!['no_match', 'referred_cwc'].includes(f.status)) {
      return res.status(409).json({ error: 'Only unmatched or CWC-referred sightings can receive CWC follow-up outcomes' });
    }

    const read = readFields(req.body, { outcome: ['text', 40], note: ['text', 500] });
    if (read.error) return res.status(400).json({ error: read.error });
    const { outcome, note } = read.body;
    if (!CWC_FOLLOWUP_OUTCOMES[outcome]) {
      return res.status(400).json({ error: `Outcome must be one of ${Object.keys(CWC_FOLLOWUP_OUTCOMES).join(', ')}` });
    }
    const cleanedNote = cleanText(note, 500);
    const followup = {
      outcome,
      label: CWC_FOLLOWUP_OUTCOMES[outcome],
      note: cleanedNote || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      completedAt: new Date().toISOString(),
    };
    const patch = {
      status: 'cwc_followup_complete',
      referredTo1098: true,
      referralStatus: `CWC follow-up complete: ${followup.label}`,
      cwcFollowup: followup,
    };
    updateFoundReport(f.id, patch);
    addActivity({
      actor: req.user.name,
      action: `Recorded CWC follow-up: ${followup.label}`,
      target: f.foundLocation,
      icon: 'check',
      actorId: req.user.id,
      scope: { state: f.state, district: f.district, matchedReportId: f.matchedReportId },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.cwc_followup_completed',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `CWC follow-up recorded for sighting at ${f.foundLocation}: ${followup.label}`,
      scope: { state: f.state, district: f.district, matchedReportId: f.matchedReportId },
      metadata: { outcome, noteLength: cleanedNote.length },
    });
    res.json({ foundReport: findFoundReport(f.id) });
  });

  router.post('/found/:id/formal-intake', protectedRoute, requireRole(...FOUND_INTAKE_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    const visible = scopeFoundReports(req.user, [f], listReports()).length === 1;
    if (!visible) return res.status(403).json({ error: 'Found report is outside your jurisdiction' });
    if (f.formalReportId) return res.status(409).json({ error: 'This sighting is already linked to a formal found-child intake' });
    if (['matched', 'rejected'].includes(f.status)) {
      return res.status(409).json({ error: 'Matched or rejected sightings cannot be converted to found-child intake' });
    }
    const read = readFields(req.body, FORMAL_INTAKE_FIELDS);
    if (read.error) return res.status(400).json({ error: read.error });
    req.body = read.body;

    // A formal intake inherits who the sighting was of, so an adult's record is
    // not quietly filed as a child's.
    const personCategory = personCategoryOf(f);
    const childName = cleanText(req.body?.childName, 80) || (isAdultCategory(personCategory) ? 'Unknown person' : 'Unknown child');
    const guardianName = cleanText(req.body?.guardianName, 120) || 'Unknown guardian';
    const intakeAuthority = cleanText(req.body?.intakeAuthority, 140) || req.user.org || req.user.name;
    const note = cleanText(req.body?.note, 800);
    if (childName.length < 2) return res.status(400).json({ error: 'Child name or temporary identifier must be at least 2 characters' });
    if (intakeAuthority.length < 3) return res.status(400).json({ error: 'Intake authority must be at least 3 characters' });
    if (note.length < 10) return res.status(400).json({ error: 'Intake note must be at least 10 characters' });

    const admissionDate = req.body?.admissionDate
      ? parseDateInput(req.body.admissionDate, 'Admission date')
      : { value: new Date().toISOString().slice(0, 10), time: Date.now() };
    if (admissionDate.error) return res.status(400).json({ error: admissionDate.error });
    if (admissionDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Admission date cannot be in the future' });

    let nextReviewDate = null;
    if (req.body?.nextReviewDate) {
      const parsed = parseDateInput(req.body.nextReviewDate, 'Next review date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Next review date cannot be in the past' });
      nextReviewDate = parsed.value;
    }

    const age = categoryAge(req.body?.ageApprox ?? f.ageApprox, 'Approximate age', personCategory);
    if (age.error) return res.status(400).json({ error: age.error });
    const gender = ['Male', 'Female', 'Other'].includes(req.body?.gender) ? req.body.gender : f.gender || 'Other';
    const state = cleanText(req.body?.state, 80) || f.state || req.user.jurisdiction?.state || null;
    const district = cleanText(req.body?.district, 80) || f.district || req.user.jurisdiction?.district || null;
    const reportId = `r_${nanoid(8)}`;
    const now = Date.now();
    const declaration = buildFoundChildDeclaration(f, req.user);
    const childProfile = buildChildProfile({
      ...req.body,
      clothing: req.body?.clothing || f.note || null,
      vulnerabilityCategories: req.body?.vulnerabilityCategories || ['unaccompanied', 'shelter_required'],
      producedByType: req.body?.producedByType || 'cwc',
    });
    const intakeRecord = {
      id: `cci_${now}_${Math.random().toString(36).slice(2, 7)}`,
      admissionType: 'temporary_shelter',
      label: CCI_ADMISSION_TYPES.temporary_shelter,
      cciName: intakeAuthority,
      admissionDate: admissionDate.value,
      nextReviewDate,
      carePlan: note,
      services: ['counselling', 'family_tracing'],
      serviceLabels: ['Counselling', 'Family tracing'],
      progressStatus: 'intake',
      progressLabel: CCI_PROGRESS_STATES.intake,
      serviceProgress: {
        healthStatus: null,
        educationStatus: null,
        counsellingStatus: null,
        familyTracingStatus: 'Family tracing initiated from found-child intake.',
      },
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
      sourceFoundReportId: f.id,
    };
    const workflowEvent = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'found_child_intake_created',
      label: 'Found-child intake formalized',
      note: `${intakeAuthority} / ${f.foundLocation || 'location under review'}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const report = {
      id: reportId,
      personCategory,
      firNo: null,
      childName,
      childAadhar: null,
      gender,
      age: age.value,
      height: null,
      weight: null,
      identificationProfile: childProfile.identificationProfile,
      vulnerabilityProfile: childProfile.vulnerabilityProfile,
      declaration,
      hasIdentificationProfile: childProfile.hasIdentificationProfile,
      hasVulnerabilityProfile: true,
      dateOfMissing: null,
      photoUrl: f.photoUrl || null,
      photoConsent: Boolean(f.photoConsent),
      dataPurpose: 'found_child_protection_intake',
      retentionUntil: retentionUntil(REPORT_PHOTO_RETENTION_DAYS),
      status: 'under_review',
      intakeStatus: 'verified',
      intakeSource: 'found_child_sighting',
      caseOrigin: 'found_child_intake',
      sourceFoundReportId: f.id,
      sourceFoundReportReceipt: f.id,
      foundChildIntake: {
        foundReportId: f.id,
        intakeAuthority,
        intakeNote: note,
        createdAt: new Date(now).toISOString(),
        createdById: req.user.id,
        createdByName: req.user.name,
        reporterConfidential: Boolean(f.confidentialReporter),
      },
      verifiedAt: now,
      verifiedById: req.user.id,
      verifiedByName: req.user.name,
      parentName: guardianName,
      parentPhone: null,
      parentEmail: null,
      address: f.foundLocation || null,
      state,
      district,
      zip: null,
      foundLocation: f.foundLocation || null,
      matchScore: Number(f.matchScore || 0),
      smsSent: false,
      registeredByRole: req.user.role,
      registeredById: req.user.id,
      cciCareRecords: [intakeRecord],
      lastCciCareAt: intakeRecord.recordedAt,
      workflow: [workflowEvent],
      workflowStatus: workflowEvent.label,
      lastWorkflowAction: workflowEvent.action,
      lastWorkflowAt: intakeRecord.recordedAt,
      createdAt: now,
    };
    addReport(report);
    updateFoundReport(f.id, {
      status: 'formalized_case',
      formalReportId: report.id,
      referralStatus: 'Formal found-child intake opened',
      cwcFollowup: f.cwcFollowup || {
        outcome: 'shelter_intake_required',
        label: CWC_FOLLOWUP_OUTCOMES.shelter_intake_required,
        note: null,
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        completedAt: new Date(now).toISOString(),
      },
    });
    addActivity({
      actor: req.user.name,
      action: 'Opened formal found-child intake',
      target: childName,
      icon: 'care',
      actorId: req.user.id,
      scope: { state, district, reportId: report.id, foundReportId: f.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.formal_intake_created',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Opened formal found-child intake for ${childName}`,
      scope: { state, district, reportId: report.id, foundReportId: f.id },
      metadata: {
        formalReportId: report.id,
        intakeAuthority,
        admissionDate: intakeRecord.admissionDate,
        nextReviewDate,
        noteLength: note.length,
        reporterConfidential: Boolean(f.confidentialReporter),
      },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.found_child_intake_created',
      targetType: 'report',
      targetId: report.id,
      summary: `Formal found-child intake created from sighting ${f.id}`,
      scope: { state, district, reportId: report.id, foundReportId: f.id },
      metadata: {
        sourceFoundReportId: f.id,
        intakeAuthority,
        admissionDate: intakeRecord.admissionDate,
        nextReviewDate,
        noteLength: note.length,
        retentionUntil: report.retentionUntil,
      },
    });
    res.status(201).json({ foundReport: findFoundReport(f.id), report: findReport(report.id), careRecord: intakeRecord });
  });

  /**
   * Police confirm a match: the case is found, and the record keeps how the
   * identity was verified (`verification`, required).
   *
   * With `sendSms`, Khozo texts the family through the gateway - and says so
   * only when the gateway took the message. The answer always says whether the
   * family was told (`familyNotified`) and, when it was not, the family's
   * number and what to do instead, so the officer calls them and records the
   * call (POST /:id/family-contacted).
   *
   * A woman or adult decides whether their family is told where they are. A
   * woman who left a violent home is put back in danger by an automatic
   * "found" message, so for a woman or adult nothing is sent, and no family
   * number is offered, until the officer records that the person consented
   * (`personConsent: true`).
   */
  router.post('/:id/confirm-match', protectedRoute, requireRole('police', 'sjpu', 'admin', 'super_admin'), async (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before match confirmation' });
    const read = readFields(req.body, {
      foundLocation: ['text', 180],
      matchScore: 'number',
      sendSms: 'flag',
      personConsent: 'flag',
    });
    if (read.error) return res.status(400).json({ error: read.error });
    const verification = parseVerification(req.body?.verification, req.user);
    if (!verification) return res.status(400).json({ error: VERIFICATION_REQUIRED });
    const b = read.body;
    const foundLocation = b.foundLocation || '';
    const consent = req.body?.personConsent === true;
    const adult = isAdultCase(r);
    const familyMayBeTold = !adult || consent;
    const wantsSms = isTruthy(b.sendSms);

    updateReport(r.id, matchConfirmedPatch(r, req.user, {
      verification,
      foundLocation: foundLocation || r.foundLocation || 'Reported location',
      matchScore: b.matchScore != null && b.matchScore !== '' ? Number(b.matchScore) : r.matchScore,
    }));

    let family;
    if (!familyMayBeTold) family = { sent: false, reason: 'consent_required', phone: null };
    else if (wantsSms) family = await smsFamily(findReport(r.id), req.user, 'confirm_match');
    else family = { sent: false, reason: 'not_requested', phone: familyPhoneOf(r) };

    addActivity({ actor: req.user.name, action: family.sent ? 'Confirmed match & alerted parent' : 'Confirmed match', target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.match_confirmed',
      targetType: 'report',
      targetId: r.id,
      // Names no one who verified; the verification is in the metadata.
      summary: `${family.sent ? 'Confirmed match and alerted parent' : 'Confirmed match'} for ${r.childName} (${verification.methodLabel})`,
      scope: { state: r.state, district: r.district },
      metadata: { sendSms: wantsSms, smsSent: family.sent, familyNotified: family.sent, familyReason: family.reason, verification },
    });
    // A confirmed match is the moment a rescue starts, and until now it raised
    // no alert at all: the officer who pressed the button knew, and nobody
    // carrying a phone did. The sighting's location travels in the body,
    // because that is where somebody has to physically go, and its id travels
    // in the scope so tapping the notification opens that sighting rather than
    // a list the officer then has to search.
    const confirmedSighting = listFoundReports()
      .filter((f) => f.matchedReportId === r.id)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    // Where the child was seen, not where the case was filed — a case opened in
    // one district is routinely closed by a sighting in another, and the rescue
    // belongs to the sighting. An officer's explicit entry outranks both.
    const rescueState = confirmedSighting?.state || r.state;
    const rescueDistrict = confirmedSighting?.district || r.district;
    const rescueLocation =
      foundLocation || confirmedSighting?.foundLocation || r.foundLocation || 'location under review';
    const rescueWhere = `${rescueLocation}${rescueState ? `, ${[rescueDistrict, rescueState].filter(Boolean).join(', ')}` : ''}`;
    // The alert goes to the police officers who can open this case and nobody
    // else (caseOfficers). Sent to every desk, it told CWC, NGOs and the rest
    // that a police-only record had been traced and where, and its scope gave
    // them the case id; for a woman or an adult it put her location in front of
    // people she had not agreed to be found by. Like every alert it says where,
    // not who.
    notifyAuthorities({
      kind: 'match_confirmed',
      title: 'Match confirmed — rescue required',
      body: `A match was confirmed at ${rescueWhere}. Proceed for rescue.`,
      priority: 'high',
      recipients: caseOfficers(findReport(r.id)),
      scope: {
        state: rescueState,
        district: rescueDistrict,
        reportId: r.id,
        foundReportId: confirmedSighting?.id,
      },
    });
    res.json({
      report: findReport(r.id),
      familyNotified: family.sent,
      familyPhone: family.phone,
      ...(family.sent ? {} : { familyReason: family.reason, familyMessage: FAMILY_SMS_MESSAGES[family.reason] }),
      ...(adult && !consent ? { personConsentRequired: true } : {}),
    });
  });

  /**
   * Reopens a case marked found or closed: the match was wrong, the child went
   * missing again, or the case was closed in error.
   *
   * Police roles only, for a case they may open. The case goes back to
   * `missing`, and so back into the pool every new sighting is compared with
   * (shared/match-pool.js); what the found or closed state recorded - the
   * closure, where the person was found, the verification, whether the family
   * was told - is cleared from the live record and kept in `reopenHistory`,
   * and the reason is a workflow event and an audit row.
   */
  router.post('/:id/reopen', protectedRoute, requireRole(...POLICE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    const read = readFields(req.body, { reason: ['text', 500] });
    if (read.error) return res.status(400).json({ error: read.error });
    if (!['found', 'closed'].includes(r.status)) {
      return res.status(409).json({ error: 'Only a found or closed case can be reopened' });
    }
    if (r.anonymizedAt) return res.status(409).json({ error: 'Anonymised cases cannot be reopened' });
    const reason = read.body.reason || '';
    if (reason.length < 10) {
      return res.status(400).json({ error: 'Give a reason of at least 10 characters for reopening the case' });
    }

    const event = workflowEvent(req.user, 'reopened', 'Case reopened', reason, { previousStatus: r.status });
    const reopening = {
      at: new Date(event.ts).toISOString(),
      byId: req.user.id,
      byName: req.user.name,
      byRole: req.user.role,
      reason,
      previousStatus: r.status,
      closure: r.closure || null,
      foundLocation: r.foundLocation || null,
      foundAt: r.foundAt || null,
      verification: r.verification || null,
      smsSent: Boolean(r.smsSent),
      familyInformedAt: r.familyInformedAt || null,
    };
    updateReport(r.id, {
      status: 'missing',
      closure: null,
      foundLocation: null,
      foundAt: null,
      matchScore: 0,
      verification: null,
      smsSent: false,
      smsSentAt: null,
      familyInformedAt: null,
      reopenedAt: reopening.at,
      reopenHistory: [...(Array.isArray(r.reopenHistory) ? r.reopenHistory : []), reopening],
      ...withWorkflowEvent(r, event),
    });
    addActivity({ actor: req.user.name, action: 'Reopened the case', target: r.childName, icon: 'referral', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.reopened',
      targetType: 'report',
      targetId: r.id,
      summary: `Reopened case for ${r.childName} (was ${r.status})`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { previousStatus: r.status, reason, reasonLength: reason.length },
    });
    res.json({ report: findReport(r.id) });
  });

  /**
   * Re-runs the reverse search for one case  /**
   * Re-runs the reverse search for one case: its photo against the stored
   * sightings, linking the ones the engines agree on (matchStoredSightings).
   *
   * For when registration could not compare - a provider was down, the photo
   * was added later, or sightings have arrived through a path that missed this
   * case - and for an officer who wants to look again. Police roles only, and
   * only for a case in their scope. The people who sent those sightings are
   * told nothing.
   */
  router.post('/:id/rematch', protectedRoute, requireRole(...POLICE_ROLES), async (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (r.anonymizedAt) return res.status(409).json({ error: 'Anonymised cases are not compared with sightings' });
    if (!r.photoFile) return res.status(409).json({ error: 'This case has no photo to compare with sightings' });
    if (r.status === 'found') return res.status(409).json({ error: 'Found cases are not compared with sightings' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases are not compared with sightings' });
    // The same rule registration follows: an unverified intake is a stranger's
    // photograph until an officer verifies it, and verifying it runs this search.
    if (isPendingCitizenIntake(r)) {
      return res.status(409).json({ error: 'Citizen/NGO intake must be verified before it is compared with sightings' });
    }

    const reverse = await matchStoredSightings(r, { trigger: 'rematch', actor: req.user });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.sightings_rematched',
      targetType: 'report',
      targetId: r.id,
      summary: `Compared case ${r.id} with stored sightings: ${reverse.sightingMatches} linked for review`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        sightingMatches: reverse.sightingMatches,
        provider: reverse.engine?.provider || null,
        comparedAgainst: reverse.engine?.comparedAgainst ?? 0,
      },
    });
    res.json({ sightingMatches: reverse.sightingMatches, engine: reverse.engine });
  });

  /**
   * Texts the family about their case, through the gateway.
   *
   * Answers `sent: true` only when the gateway took the message. With no
   * gateway connected the answer is `sent: false, reason: 'no_gateway'` with
   * the family's number and the instruction to call them, and nothing on the
   * case changes: the officer records the call with POST /:id/family-contacted.
   */
  router.post('/:id/send-sms', protectedRoute, requireRole('police', 'sjpu', 'admin', 'super_admin'), async (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before parent SMS alerts' });
    if (isAdultCase(r) && req.body?.personConsent !== true) {
      return res.status(409).json({ error: PERSON_CONSENT_REQUIRED, code: 'person_consent_required' });
    }
    const outcome = await smsFamily(r, req.user, 'send_sms');
    res.json({
      ok: outcome.sent,
      sent: outcome.sent,
      ...(outcome.sent ? {} : { reason: outcome.reason }),
      phone: outcome.phone,
      message: FAMILY_SMS_MESSAGES[outcome.reason],
      report: findReport(r.id),
    });
  });

  /**
   * Records that an officer told the family: a call, a visit, or an SMS from
   * their own phone. Police and CWC desks, for a case they may open.
   *
   * For a woman or adult the officer must record that the person agreed to her
   * family being told (`personConsent: true`), as for an SMS.
   */
  router.post('/:id/family-contacted', protectedRoute, requireRole(...POLICE_ROLES, 'cwc'), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    const read = readFields(req.body, { method: ['text', 20], note: ['text', 500], personConsent: 'flag' });
    if (read.error) return res.status(400).json({ error: read.error });
    const { method } = read.body;
    if (!FAMILY_CONTACT_METHODS[method]) {
      return res.status(400).json({ error: 'Contact method must be call, visit or sms' });
    }
    if (isAdultCase(r) && req.body?.personConsent !== true) {
      return res.status(409).json({ error: PERSON_CONSENT_REQUIRED, code: 'person_consent_required' });
    }
    const note = read.body.note || null;
    const contact = familyContact(req.user, method, note);
    const event = workflowEvent(req.user, 'family_contacted', 'Family contacted', note, { method });
    updateReport(r.id, {
      familyContacts: [...(Array.isArray(r.familyContacts) ? r.familyContacts : []), contact],
      familyInformedAt: contact.at,
      ...withWorkflowEvent(r, event),
    });
    addActivity({ actor: req.user.name, action: `Recorded family contact: ${FAMILY_CONTACT_METHODS[method]}`, target: r.childName, icon: 'sms', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.family_contacted',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded family contact for ${r.childName}: ${FAMILY_CONTACT_METHODS[method]}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { method, noteLength: note ? note.length : 0, personConsent: req.body?.personConsent === true },
    });
    res.json({ report: findReport(r.id) });
  });

  router.post('/:id/case-workflow', protectedRoute, requireRole(...CASE_WORKFLOW_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before institutional handoff' });

    const read = readFields(req.body, { action: ['text', 40], note: ['text', 500] });
    if (read.error) return res.status(400).json({ error: read.error });
    const { action, note } = read.body;
    const config = CASE_WORKFLOW_ACTIONS[action];
    if (!config) {
      return res.status(400).json({ error: `Action must be one of ${Object.keys(CASE_WORKFLOW_ACTIONS).join(', ')}` });
    }
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found/reunited or closed cases cannot be moved into institutional workflow' });

    const event = {
      id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      action,
      label: config.label,
      note: note || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const patch = {
      status: config.status,
      workflow,
      workflowStatus: config.label,
      lastWorkflowAction: action,
      lastWorkflowAt: new Date(event.ts).toISOString(),
    };
    updateReport(r.id, patch);
    addActivity({ actor: req.user.name, action: config.activity, target: r.childName, icon: 'referral', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: config.audit,
      targetType: 'report',
      targetId: r.id,
      summary: `${config.label} for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { action, note: note || null },
    });
    res.json({ report: findReport(r.id) });
  });

  router.get('/:id/assignable-users', protectedRoute, requireRole(...CASE_ASSIGN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    res.json({ users: assignableUsersForReport(req.user, r, listUsers()) });
  });

  router.post('/:id/assign-owner', protectedRoute, requireRole(...CASE_ASSIGN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before owner assignment' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive owner assignments' });

    const assigneeId = cleanText(req.body?.assigneeId, 80);
    const assignee = listUsers().find((user) => user.id === assigneeId);
    if (!assignee) return res.status(404).json({ error: 'Assignee not found' });
    if (!canAssignUserToReport(req.user, assignee, r)) return res.status(403).json({ error: 'Assignee is outside this case jurisdiction or role scope' });

    const assignmentType = cleanText(req.body?.assignmentType, 40) || 'investigation';
    if (!CASE_ASSIGNMENT_TYPES[assignmentType]) {
      return res.status(400).json({ error: `Assignment type must be one of ${Object.keys(CASE_ASSIGNMENT_TYPES).join(', ')}` });
    }
    let dueDate = null;
    if (req.body?.dueDate) {
      const parsed = parseDateInput(req.body.dueDate, 'Due date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Due date cannot be in the past' });
      dueDate = parsed.value;
    }

    const now = Date.now();
    const note = cleanText(req.body?.note, 500);
    const assignment = {
      id: `assign_${now}_${Math.random().toString(36).slice(2, 7)}`,
      assignmentType,
      assignmentLabel: CASE_ASSIGNMENT_TYPES[assignmentType],
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      assigneeRole: assignee.role,
      assigneeOrg: assignee.org || null,
      assigneeJurisdiction: assignee.jurisdiction || {},
      dueDate,
      note: note || null,
      assignedById: req.user.id,
      assignedByName: req.user.name,
      assignedByRole: req.user.role,
      assignedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'assign_owner',
      label: `${assignment.assignmentLabel}: ${assignee.name}`,
      note: note || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const assignments = [...(Array.isArray(r.assignments) ? r.assignments : []), assignment];
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    updateReport(r.id, {
      assignments,
      assignedToId: assignee.id,
      assignedToName: assignee.name,
      assignedToRole: assignee.role,
      assignedToOrg: assignee.org || null,
      assignmentStatus: 'assigned',
      currentAssignmentType: assignmentType,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'assign_owner',
      lastWorkflowAt: assignment.assignedAt,
      lastAssignmentAt: assignment.assignedAt,
    });
    addActivity({
      actor: req.user.name,
      action: `Assigned ${CASE_ASSIGNMENT_TYPES[assignmentType].toLowerCase()}`,
      target: r.childName,
      icon: 'assignment',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.assigned_owner',
      targetType: 'report',
      targetId: r.id,
      summary: `Assigned ${CASE_ASSIGNMENT_TYPES[assignmentType].toLowerCase()} for ${r.childName} to ${assignee.name}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        assignmentType,
        assigneeId: assignee.id,
        assigneeRole: assignee.role,
        assigneeOrg: assignee.org || null,
        dueDate,
        noteLength: note.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), assignment });
  });

  router.post('/:id/investigation-checklist', protectedRoute, requireRole(...INVESTIGATION_CHECKLIST_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before investigation checklist updates' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive investigation checklist updates' });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const selectedItems = [...new Set(items.map((item) => cleanText(item, 60)).filter(Boolean))];
    const invalid = selectedItems.filter((item) => !INVESTIGATION_CHECKLIST_ITEMS[item]);
    if (invalid.length) {
      return res.status(400).json({ error: `Checklist items must be one of ${Object.keys(INVESTIGATION_CHECKLIST_ITEMS).join(', ')}` });
    }
    if (selectedItems.length === 0) return res.status(400).json({ error: 'Select at least one investigation checklist item' });

    const actionDate = req.body?.actionDate ? optionalDateInput(req.body.actionDate, 'Action date', { maxTime: Date.now() + DAY }) : { value: new Date().toISOString().slice(0, 10) };
    if (actionDate.error) return res.status(400).json({ error: actionDate.error });
    const officerName = cleanText(req.body?.officerName || req.user.name, 140);
    const stationDiaryNo = cleanText(req.body?.stationDiaryNo, 120) || null;
    const followupDate = req.body?.followupDate ? optionalDateInput(req.body.followupDate, 'Follow-up date') : { value: null };
    if (followupDate.error) return res.status(400).json({ error: followupDate.error });
    const note = cleanText(req.body?.note, 1000);
    if (officerName.length < 3) return res.status(400).json({ error: 'Officer or desk name is required' });

    const now = Date.now();
    const checklistRecord = {
      id: `inv_${now}_${Math.random().toString(36).slice(2, 7)}`,
      items: selectedItems,
      itemLabels: selectedItems.map((item) => INVESTIGATION_CHECKLIST_ITEMS[item]),
      officerName,
      stationDiaryNo,
      actionDate: actionDate.value,
      followupDate: followupDate.value,
      note: note || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'investigation_checklist_updated',
      label: `Investigation checklist: ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`,
      note: stationDiaryNo ? `Diary ${stationDiaryNo}` : null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const investigationChecklist = [...(Array.isArray(r.investigationChecklist) ? r.investigationChecklist : []), checklistRecord];
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    updateReport(r.id, {
      investigationChecklist,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'investigation_checklist_updated',
      lastWorkflowAt: checklistRecord.recordedAt,
      lastInvestigationChecklistAt: checklistRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: 'Updated investigation checklist',
      target: r.childName,
      icon: 'checklist',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.investigation_checklist_updated',
      targetType: 'report',
      targetId: r.id,
      summary: `Updated investigation checklist for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        items: selectedItems,
        itemCount: selectedItems.length,
        stationDiaryPresent: Boolean(stationDiaryNo),
        actionDate: checklistRecord.actionDate,
        followupDate: checklistRecord.followupDate,
        noteLength: note.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), checklistRecord });
  });

  router.post('/:id/close-case', protectedRoute, requireRole(...CASE_CLOSE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before case closure' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Case is already closed' });

    const read = readFields(req.body, { reason: ['text', 40], note: ['text', 500], foundLocation: ['text', 180] });
    if (read.error) return res.status(400).json({ error: read.error });
    const { reason, note, foundLocation } = read.body;
    if (!CASE_CLOSE_REASONS[reason]) {
      return res.status(400).json({ error: `Closure reason must be one of ${Object.keys(CASE_CLOSE_REASONS).join(', ')}` });
    }
    if (reason === 'restored_family' && !r.foundLocation && !foundLocation) {
      return res.status(400).json({ error: 'Found/restoration location is required before closing as restored to family' });
    }

    const now = Date.now();
    const closure = {
      reason,
      label: CASE_CLOSE_REASONS[reason],
      note: cleanText(note, 500) || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      closedAt: new Date(now).toISOString(),
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'close_case',
      label: `Closed: ${closure.label}`,
      note: closure.note,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    }];
    const patch = {
      status: 'closed',
      closure,
      workflow,
      workflowStatus: `Closed: ${closure.label}`,
      lastWorkflowAction: 'close_case',
      lastWorkflowAt: closure.closedAt,
      foundLocation: foundLocation || r.foundLocation || null,
    };
    updateReport(r.id, patch);
    addActivity({ actor: req.user.name, action: `Closed case: ${closure.label}`, target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.closed',
      targetType: 'report',
      targetId: r.id,
      summary: `Closed case for ${r.childName}: ${closure.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: closure,
    });
    res.json({ report: findReport(r.id) });
  });

  router.post('/:id/notes', protectedRoute, requireRole(...CASE_NOTE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    const noteText = cleanText(req.body?.note, 1000);
    if (noteText.length < 3) return res.status(400).json({ error: 'Case note must be at least 3 characters' });
    const note = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      note: noteText,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const notes = [...(Array.isArray(r.notes) ? r.notes : []), note];
    updateReport(r.id, { notes, lastNoteAt: new Date(note.ts).toISOString() });
    addActivity({ actor: req.user.name, action: 'Added case note', target: r.childName, icon: 'note', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.note_added',
      targetType: 'report',
      targetId: r.id,
      summary: `Added case note for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { noteLength: noteText.length },
    });
    res.status(201).json({ report: findReport(r.id), note });
  });

  router.post('/:id/cci-care', protectedRoute, requireRole(...CCI_CARE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before CCI care recording' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive new CCI care records' });

    const { admissionType } = req.body || {};
    if (!CCI_ADMISSION_TYPES[admissionType]) {
      return res.status(400).json({ error: `Admission type must be one of ${Object.keys(CCI_ADMISSION_TYPES).join(', ')}` });
    }
    const cciName = cleanText(req.body?.cciName, 140);
    const carePlan = cleanText(req.body?.carePlan, 1200);
    const services = listValues(req.body?.services, CCI_SERVICE_TYPES);
    const progressStatus = cleanText(req.body?.progressStatus, 40) || 'intake';
    if (!CCI_PROGRESS_STATES[progressStatus]) {
      return res.status(400).json({ error: `Progress status must be one of ${Object.keys(CCI_PROGRESS_STATES).join(', ')}` });
    }
    const healthStatus = cleanText(req.body?.healthStatus, 240) || null;
    const educationStatus = cleanText(req.body?.educationStatus, 240) || null;
    const counsellingStatus = cleanText(req.body?.counsellingStatus, 240) || null;
    const familyTracingStatus = cleanText(req.body?.familyTracingStatus, 240) || null;
    const admissionDate = parseDateInput(req.body?.admissionDate, 'Admission date');
    if (admissionDate.error) return res.status(400).json({ error: admissionDate.error });
    if (admissionDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Admission date cannot be in the future' });
    if (cciName.length < 3) return res.status(400).json({ error: 'CCI name must be at least 3 characters' });
    if (carePlan.length < 10) return res.status(400).json({ error: 'Care plan must be at least 10 characters' });

    let nextReviewDate = null;
    if (req.body?.nextReviewDate) {
      const parsed = parseDateInput(req.body.nextReviewDate, 'Next review date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Next review date cannot be in the past' });
      nextReviewDate = parsed.value;
    }

    const now = Date.now();
    const careRecord = {
      id: `cci_${now}_${Math.random().toString(36).slice(2, 7)}`,
      admissionType,
      label: CCI_ADMISSION_TYPES[admissionType],
      cciName,
      admissionDate: admissionDate.value,
      nextReviewDate,
      carePlan,
      services,
      serviceLabels: services.map((item) => CCI_SERVICE_TYPES[item]),
      progressStatus,
      progressLabel: CCI_PROGRESS_STATES[progressStatus],
      serviceProgress: {
        healthStatus,
        educationStatus,
        counsellingStatus,
        familyTracingStatus,
      },
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'cci_care_recorded',
      label: `CCI care recorded: ${careRecord.label}`,
      note: `${careRecord.cciName}${nextReviewDate ? ` / review ${nextReviewDate}` : ''}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const cciCareRecords = [...(Array.isArray(r.cciCareRecords) ? r.cciCareRecords : []), careRecord];
    updateReport(r.id, {
      status: 'under_review',
      cciCareRecords,
      lastCciCareAt: careRecord.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'cci_care_recorded',
      lastWorkflowAt: careRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'care',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.cci_care_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded CCI care for ${r.childName}: ${careRecord.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        admissionType,
        cciName,
        admissionDate: careRecord.admissionDate,
        nextReviewDate,
        carePlanLength: carePlan.length,
        services,
        progressStatus,
        healthStatusLength: healthStatus ? healthStatus.length : 0,
        educationStatusLength: educationStatus ? educationStatus.length : 0,
        counsellingStatusLength: counsellingStatus ? counsellingStatus.length : 0,
        familyTracingStatusLength: familyTracingStatus ? familyTracingStatus.length : 0,
      },
    });
    res.status(201).json({ report: findReport(r.id), careRecord });
  });

  router.post('/:id/jjb-proceeding', protectedRoute, requireRole(...JJB_PROCEEDING_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before JJB proceeding recording' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive new JJB proceeding records' });

    const { proceedingType } = req.body || {};
    if (!JJB_PROCEEDING_TYPES[proceedingType]) {
      return res.status(400).json({ error: `Proceeding type must be one of ${Object.keys(JJB_PROCEEDING_TYPES).join(', ')}` });
    }
    const boardName = cleanText(req.body?.boardName, 140);
    const caseNo = cleanText(req.body?.caseNo, 80) || null;
    const directions = cleanText(req.body?.directions, 1200);
    const orderDate = parseDateInput(req.body?.orderDate, 'Order date');
    if (orderDate.error) return res.status(400).json({ error: orderDate.error });
    if (orderDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Order date cannot be in the future' });
    if (boardName.length < 3) return res.status(400).json({ error: 'JJB name must be at least 3 characters' });
    if (directions.length < 10) return res.status(400).json({ error: 'Directions must be at least 10 characters' });

    let nextHearingDate = null;
    if (req.body?.nextHearingDate) {
      const parsed = parseDateInput(req.body.nextHearingDate, 'Next hearing date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Next hearing date cannot be in the past' });
      nextHearingDate = parsed.value;
    }

    const now = Date.now();
    const proceeding = {
      id: `jjb_${now}_${Math.random().toString(36).slice(2, 7)}`,
      proceedingType,
      label: JJB_PROCEEDING_TYPES[proceedingType],
      boardName,
      caseNo,
      orderDate: orderDate.value,
      nextHearingDate,
      directions,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'jjb_proceeding_recorded',
      label: `JJB proceeding recorded: ${proceeding.label}`,
      note: `${proceeding.boardName}${nextHearingDate ? ` / next hearing ${nextHearingDate}` : ''}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const jjbProceedings = [...(Array.isArray(r.jjbProceedings) ? r.jjbProceedings : []), proceeding];
    updateReport(r.id, {
      status: 'under_review',
      jjbProceedings,
      lastJjbProceedingAt: proceeding.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'jjb_proceeding_recorded',
      lastWorkflowAt: proceeding.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'hearing',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.jjb_proceeding_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded JJB proceeding for ${r.childName}: ${proceeding.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        proceedingType,
        boardName,
        caseNo,
        orderDate: proceeding.orderDate,
        nextHearingDate,
        directionsLength: directions.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), proceeding });
  });

  router.post('/:id/state-escalation', protectedRoute, requireRole(...STATE_ESCALATION_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before state escalation recording' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot receive new state escalation records' });

    const { escalationType, escalationLevel, priority = 'priority' } = req.body || {};
    if (!STATE_ESCALATION_TYPES[escalationType]) {
      return res.status(400).json({ error: `Escalation type must be one of ${Object.keys(STATE_ESCALATION_TYPES).join(', ')}` });
    }
    if (!STATE_ESCALATION_LEVELS[escalationLevel]) {
      return res.status(400).json({ error: `Escalation level must be one of ${Object.keys(STATE_ESCALATION_LEVELS).join(', ')}` });
    }
    if (!BUREAU_PRIORITIES[priority]) {
      return res.status(400).json({ error: `Priority must be one of ${Object.keys(BUREAU_PRIORITIES).join(', ')}` });
    }
    const authorityName = cleanText(req.body?.authorityName, 140);
    const referenceNo = cleanText(req.body?.referenceNo, 100) || null;
    const actionRequired = cleanText(req.body?.actionRequired, 1200);
    const escalatedDate = parseDateInput(req.body?.escalatedDate, 'Escalation date');
    if (escalatedDate.error) return res.status(400).json({ error: escalatedDate.error });
    if (escalatedDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Escalation date cannot be in the future' });
    if (authorityName.length < 3) return res.status(400).json({ error: 'Authority name must be at least 3 characters' });
    if (actionRequired.length < 10) return res.status(400).json({ error: 'Action required must be at least 10 characters' });

    let dueDate = null;
    if (req.body?.dueDate) {
      const parsed = parseDateInput(req.body.dueDate, 'Due date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Due date cannot be in the past' });
      dueDate = parsed.value;
    }

    const now = Date.now();
    const stateEscalation = {
      id: `state_${now}_${Math.random().toString(36).slice(2, 7)}`,
      escalationType,
      label: STATE_ESCALATION_TYPES[escalationType],
      escalationLevel,
      levelLabel: STATE_ESCALATION_LEVELS[escalationLevel],
      priority,
      priorityLabel: BUREAU_PRIORITIES[priority],
      authorityName,
      referenceNo,
      escalatedDate: escalatedDate.value,
      dueDate,
      actionRequired,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'state_escalation_recorded',
      label: `State escalation recorded: ${stateEscalation.label}`,
      note: [stateEscalation.levelLabel, stateEscalation.priorityLabel, stateEscalation.referenceNo].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const stateEscalations = [...(Array.isArray(r.stateEscalations) ? r.stateEscalations : []), stateEscalation];
    updateReport(r.id, {
      status: 'under_review',
      stateEscalations,
      lastStateEscalationAt: stateEscalation.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'state_escalation_recorded',
      lastWorkflowAt: stateEscalation.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'escalation',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.state_escalation_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded state escalation for ${r.childName}: ${stateEscalation.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        escalationType,
        escalationLevel,
        priority,
        authorityName,
        referenceNo,
        escalatedDate: stateEscalation.escalatedDate,
        dueDate,
        actionRequiredLength: actionRequired.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), stateEscalation });
  });

  router.post('/:id/bureau-report', protectedRoute, requireRole(...BUREAU_REPORT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before bureau reporting' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new bureau report records' });

    const { reportType, bureauLevel, priority = 'routine' } = req.body || {};
    if (!BUREAU_REPORT_TYPES[reportType]) {
      return res.status(400).json({ error: `Report type must be one of ${Object.keys(BUREAU_REPORT_TYPES).join(', ')}` });
    }
    if (!BUREAU_LEVELS[bureauLevel]) {
      return res.status(400).json({ error: `Bureau level must be one of ${Object.keys(BUREAU_LEVELS).join(', ')}` });
    }
    if (!BUREAU_PRIORITIES[priority]) {
      return res.status(400).json({ error: `Priority must be one of ${Object.keys(BUREAU_PRIORITIES).join(', ')}` });
    }
    const referenceNo = cleanText(req.body?.referenceNo, 100) || null;
    const summary = cleanText(req.body?.summary, 1200);
    const submittedDate = parseDateInput(req.body?.submittedDate, 'Submission date');
    if (submittedDate.error) return res.status(400).json({ error: submittedDate.error });
    if (submittedDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Submission date cannot be in the future' });
    if (summary.length < 10) return res.status(400).json({ error: 'Bureau summary must be at least 10 characters' });

    let nextReviewDate = null;
    if (req.body?.nextReviewDate) {
      const parsed = parseDateInput(req.body.nextReviewDate, 'Next review date');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.time < Date.now() - DAY) return res.status(400).json({ error: 'Next review date cannot be in the past' });
      nextReviewDate = parsed.value;
    }

    const now = Date.now();
    const bureauReport = {
      id: `bureau_${now}_${Math.random().toString(36).slice(2, 7)}`,
      reportType,
      label: BUREAU_REPORT_TYPES[reportType],
      bureauLevel,
      bureauLabel: BUREAU_LEVELS[bureauLevel],
      priority,
      priorityLabel: BUREAU_PRIORITIES[priority],
      referenceNo,
      submittedDate: submittedDate.value,
      nextReviewDate,
      summary,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'bureau_report_recorded',
      label: `${bureauReport.bureauLabel} report recorded: ${bureauReport.label}`,
      note: [bureauReport.referenceNo, bureauReport.priorityLabel].filter(Boolean).join(' / ') || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const bureauReports = [...(Array.isArray(r.bureauReports) ? r.bureauReports : []), bureauReport];
    updateReport(r.id, {
      status: r.status === 'found' ? r.status : 'under_review',
      bureauReports,
      lastBureauReportAt: bureauReport.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'bureau_report_recorded',
      lastWorkflowAt: bureauReport.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'bureau',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.bureau_report_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded ${bureauReport.bureauLabel} report for ${r.childName}: ${bureauReport.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        reportType,
        bureauLevel,
        priority,
        referenceNo,
        submittedDate: bureauReport.submittedDate,
        nextReviewDate,
        summaryLength: summary.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), bureauReport });
  });

  router.post('/:id/external-id', protectedRoute, requireRole(...EXTERNAL_ID_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before external ID linking' });

    const idType = cleanText(req.body?.idType, 40);
    if (!EXTERNAL_ID_TYPES[idType]) {
      return res.status(400).json({ error: `External ID type must be one of ${Object.keys(EXTERNAL_ID_TYPES).join(', ')}` });
    }
    const externalId = cleanText(req.body?.externalId, 120);
    const issuingSystem = cleanText(req.body?.issuingSystem, 140) || EXTERNAL_ID_TYPES[idType];
    const remarks = cleanText(req.body?.remarks, 800);
    const issuedDate = req.body?.issuedDate ? optionalDateInput(req.body.issuedDate, 'Issued date', { maxTime: Date.now() + DAY }) : { value: null };
    if (issuedDate.error) return res.status(400).json({ error: issuedDate.error });
    if (externalId.length < 3) return res.status(400).json({ error: 'External ID must be at least 3 characters' });
    const existing = Array.isArray(r.externalIds) ? r.externalIds : [];
    if (existing.some((row) => row.idType === idType && row.externalId.toLowerCase() === externalId.toLowerCase())) {
      return res.status(409).json({ error: 'This external ID is already linked to the case' });
    }

    const now = Date.now();
    const externalRecord = {
      id: `ext_${now}_${Math.random().toString(36).slice(2, 7)}`,
      idType,
      label: EXTERNAL_ID_TYPES[idType],
      externalId,
      issuingSystem,
      issuedDate: issuedDate.value,
      remarks,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'external_id_linked',
      label: `External ID linked: ${externalRecord.label}`,
      note: `${externalRecord.issuingSystem} / ${externalRecord.externalId}`,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const externalIds = [...existing, externalRecord];
    updateReport(r.id, {
      externalIds,
      lastExternalIdAt: externalRecord.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'external_id_linked',
      lastWorkflowAt: externalRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'link',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.external_id_linked',
      targetType: 'report',
      targetId: r.id,
      summary: `Linked ${externalRecord.label} for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        idType,
        externalId,
        issuingSystem,
        issuedDate: externalRecord.issuedDate,
        remarksLength: remarks.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), externalRecord });
  });

  router.post('/:id/restoration-plan', protectedRoute, requireRole(...RESTORATION_PLAN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before restoration planning' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new restoration plans' });

    const { restorationType, status = 'planned' } = req.body || {};
    if (!RESTORATION_TYPES[restorationType]) {
      return res.status(400).json({ error: `Restoration type must be one of ${Object.keys(RESTORATION_TYPES).join(', ')}` });
    }
    if (!RESTORATION_STATUSES[status]) {
      return res.status(400).json({ error: `Restoration status must be one of ${Object.keys(RESTORATION_STATUSES).join(', ')}` });
    }
    const fromState = cleanText(req.body?.fromState || r.state, 80);
    const fromDistrict = cleanText(req.body?.fromDistrict || r.district, 80);
    const toState = cleanText(req.body?.toState, 80);
    const toDistrict = cleanText(req.body?.toDistrict, 80);
    const guardianName = cleanText(req.body?.guardianName || r.parentName, 120) || null;
    const handoverAuthority = cleanText(req.body?.handoverAuthority, 140);
    const remarks = cleanText(req.body?.remarks, 1200);
    const supports = listValues(req.body?.supports, RESTORATION_SUPPORTS);
    const travelMode = cleanText(req.body?.travelMode, 40) || 'not_required';
    const documentStatus = cleanText(req.body?.documentStatus, 40) || 'pending';
    const fundingSource = cleanText(req.body?.fundingSource, 40) || 'not_required';
    if (!RESTORATION_TRAVEL_MODES[travelMode]) {
      return res.status(400).json({ error: `Travel mode must be one of ${Object.keys(RESTORATION_TRAVEL_MODES).join(', ')}` });
    }
    if (!RESTORATION_DOCUMENT_STATUSES[documentStatus]) {
      return res.status(400).json({ error: `Document status must be one of ${Object.keys(RESTORATION_DOCUMENT_STATUSES).join(', ')}` });
    }
    if (!RESTORATION_FUNDING_SOURCES[fundingSource]) {
      return res.status(400).json({ error: `Funding source must be one of ${Object.keys(RESTORATION_FUNDING_SOURCES).join(', ')}` });
    }
    const plannedDate = optionalDateInput(req.body?.plannedDate, 'Planned date', { minTime: Date.now() - DAY });
    if (plannedDate.error) return res.status(400).json({ error: plannedDate.error });
    const followupDate = optionalDateInput(req.body?.followupDate, 'Follow-up date', { minTime: Date.now() - DAY });
    if (followupDate.error) return res.status(400).json({ error: followupDate.error });
    const travelDate = optionalDateInput(req.body?.travelDate, 'Travel date', { minTime: Date.now() - DAY });
    if (travelDate.error) return res.status(400).json({ error: travelDate.error });
    const escortAuthority = cleanText(req.body?.escortAuthority, 140) || null;
    const escortContact = cleanText(req.body?.escortContact, 40) || null;
    const documentReference = cleanText(req.body?.documentReference, 120) || null;
    const fundingReference = cleanText(req.body?.fundingReference, 120) || null;
    if (escortContact && !/^\d{7,15}$/.test(digits(escortContact))) return res.status(400).json({ error: 'Escort contact must be 7 to 15 digits' });
    if (toState.length < 2 || toDistrict.length < 2) return res.status(400).json({ error: 'Target state and district are required' });
    if (handoverAuthority.length < 3) return res.status(400).json({ error: 'Handover authority must be at least 3 characters' });
    if (remarks.length < 10) return res.status(400).json({ error: 'Restoration remarks must be at least 10 characters' });

    const now = Date.now();
    const restorationPlan = {
      id: `restore_${now}_${Math.random().toString(36).slice(2, 7)}`,
      restorationType,
      label: RESTORATION_TYPES[restorationType],
      status,
      statusLabel: RESTORATION_STATUSES[status],
      from: { state: fromState || null, district: fromDistrict || null },
      to: { state: toState, district: toDistrict },
      guardianName,
      handoverAuthority,
      supports,
      supportLabels: supports.map((item) => RESTORATION_SUPPORTS[item]),
      plannedDate: plannedDate.value,
      followupDate: followupDate.value,
      travel: {
        mode: travelMode,
        modeLabel: RESTORATION_TRAVEL_MODES[travelMode],
        travelDate: travelDate.value,
        escortAuthority,
        escortContact,
      },
      documents: {
        status: documentStatus,
        statusLabel: RESTORATION_DOCUMENT_STATUSES[documentStatus],
        reference: documentReference,
      },
      funding: {
        source: fundingSource,
        sourceLabel: RESTORATION_FUNDING_SOURCES[fundingSource],
        reference: fundingReference,
      },
      remarks,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'restoration_plan_recorded',
      label: `Restoration plan recorded: ${restorationPlan.label}`,
      note: [restorationPlan.statusLabel, toDistrict, toState].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const restorationPlans = [...(Array.isArray(r.restorationPlans) ? r.restorationPlans : []), restorationPlan];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      restorationPlans,
      lastRestorationPlanAt: restorationPlan.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'restoration_plan_recorded',
      lastWorkflowAt: restorationPlan.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'restore',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.restoration_plan_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded restoration plan for ${r.childName}: ${restorationPlan.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id, targetState: toState, targetDistrict: toDistrict },
      metadata: {
        restorationType,
        status,
        from: restorationPlan.from,
        to: restorationPlan.to,
        handoverAuthority,
        supports,
        plannedDate: restorationPlan.plannedDate,
        followupDate: restorationPlan.followupDate,
        travelMode,
        travelDate: restorationPlan.travel.travelDate,
        escortAuthorityPresent: Boolean(escortAuthority),
        escortContactPresent: Boolean(escortContact),
        documentStatus,
        documentReferencePresent: Boolean(documentReference),
        fundingSource,
        fundingReferencePresent: Boolean(fundingReference),
        guardianNamePresent: Boolean(guardianName),
        remarksLength: remarks.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), restorationPlan });
  });

  router.post('/:id/welfare-referral', protectedRoute, requireRole(...WELFARE_REFERRAL_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before welfare referral' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new welfare referrals' });

    const scheme = cleanText(req.body?.scheme, 50);
    const status = cleanText(req.body?.status, 50) || 'referred';
    if (!WELFARE_SCHEMES[scheme]) {
      return res.status(400).json({ error: `Scheme must be one of ${Object.keys(WELFARE_SCHEMES).join(', ')}` });
    }
    if (!WELFARE_STATUSES[status]) {
      return res.status(400).json({ error: `Status must be one of ${Object.keys(WELFARE_STATUSES).join(', ')}` });
    }
    const agencyName = cleanText(req.body?.agencyName, 140);
    const referralNo = cleanText(req.body?.referralNo, 100) || null;
    const eligibilityNote = cleanText(req.body?.eligibilityNote, 1200);
    const referredDate = parseDateInput(req.body?.referredDate, 'Referral date');
    if (referredDate.error) return res.status(400).json({ error: referredDate.error });
    if (referredDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Referral date cannot be in the future' });
    if (agencyName.length < 3) return res.status(400).json({ error: 'Agency name must be at least 3 characters' });
    if (eligibilityNote.length < 10) return res.status(400).json({ error: 'Eligibility note must be at least 10 characters' });

    const reviewDate = optionalDateInput(req.body?.reviewDate, 'Review date', { minTime: Date.now() - DAY });
    if (reviewDate.error) return res.status(400).json({ error: reviewDate.error });

    const now = Date.now();
    const welfareReferral = {
      id: `welfare_${now}_${Math.random().toString(36).slice(2, 7)}`,
      scheme,
      label: WELFARE_SCHEMES[scheme],
      status,
      statusLabel: WELFARE_STATUSES[status],
      agencyName,
      referralNo,
      referredDate: referredDate.value,
      reviewDate: reviewDate.value,
      eligibilityNote,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'welfare_referral_recorded',
      label: `Welfare referral recorded: ${welfareReferral.label}`,
      note: [welfareReferral.statusLabel, welfareReferral.agencyName, welfareReferral.referralNo].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const welfareReferrals = [...(Array.isArray(r.welfareReferrals) ? r.welfareReferrals : []), welfareReferral];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      welfareReferrals,
      lastWelfareReferralAt: welfareReferral.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'welfare_referral_recorded',
      lastWorkflowAt: welfareReferral.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'welfare',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.welfare_referral_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded welfare referral for ${r.childName}: ${welfareReferral.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        scheme,
        status,
        agencyName,
        referralNo,
        referredDate: welfareReferral.referredDate,
        reviewDate: welfareReferral.reviewDate,
        eligibilityNoteLength: eligibilityNote.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), welfareReferral });
  });

  router.post('/:id/legal-aid-referral', protectedRoute, requireRole(...LEGAL_AID_REFERRAL_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before legal-aid referral' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new legal-aid referrals' });

    const serviceType = cleanText(req.body?.serviceType, 60);
    const status = cleanText(req.body?.status, 60) || 'referred';
    if (!LEGAL_AID_SERVICE_TYPES[serviceType]) {
      return res.status(400).json({ error: `Service type must be one of ${Object.keys(LEGAL_AID_SERVICE_TYPES).join(', ')}` });
    }
    if (!LEGAL_AID_STATUSES[status]) {
      return res.status(400).json({ error: `Status must be one of ${Object.keys(LEGAL_AID_STATUSES).join(', ')}` });
    }
    const authorityName = cleanText(req.body?.authorityName || req.user.org || req.user.name, 140);
    const applicationNo = cleanText(req.body?.applicationNo, 100) || null;
    const note = cleanText(req.body?.note, 1200);
    const referredDate = parseDateInput(req.body?.referredDate, 'Referral date');
    if (referredDate.error) return res.status(400).json({ error: referredDate.error });
    if (referredDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Referral date cannot be in the future' });
    const hearingDate = optionalDateInput(req.body?.hearingDate, 'Hearing date', { minTime: Date.now() - DAY });
    if (hearingDate.error) return res.status(400).json({ error: hearingDate.error });
    const reviewDate = optionalDateInput(req.body?.reviewDate, 'Review date', { minTime: Date.now() - DAY });
    if (reviewDate.error) return res.status(400).json({ error: reviewDate.error });
    if (authorityName.length < 3) return res.status(400).json({ error: 'Authority name must be at least 3 characters' });
    if (note.length < 10) return res.status(400).json({ error: 'Legal-aid note must be at least 10 characters' });

    const now = Date.now();
    const legalAidReferral = {
      id: `legal_${now}_${Math.random().toString(36).slice(2, 7)}`,
      serviceType,
      label: LEGAL_AID_SERVICE_TYPES[serviceType],
      status,
      statusLabel: LEGAL_AID_STATUSES[status],
      authorityName,
      applicationNo,
      referredDate: referredDate.value,
      hearingDate: hearingDate.value,
      reviewDate: reviewDate.value,
      note,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'legal_aid_referral_recorded',
      label: `Legal-aid referral recorded: ${legalAidReferral.label}`,
      note: [legalAidReferral.statusLabel, legalAidReferral.authorityName, legalAidReferral.applicationNo].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const legalAidReferrals = [...(Array.isArray(r.legalAidReferrals) ? r.legalAidReferrals : []), legalAidReferral];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      legalAidReferrals,
      lastLegalAidReferralAt: legalAidReferral.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'legal_aid_referral_recorded',
      lastWorkflowAt: legalAidReferral.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'legal',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.legal_aid_referral_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded legal-aid referral for ${r.childName}: ${legalAidReferral.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        serviceType,
        status,
        authorityName,
        applicationNoPresent: Boolean(applicationNo),
        referredDate: legalAidReferral.referredDate,
        hearingDate: legalAidReferral.hearingDate,
        reviewDate: legalAidReferral.reviewDate,
        noteLength: note.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), legalAidReferral });
  });

  router.post('/:id/adoption-record', protectedRoute, requireRole(...ADOPTION_RECORD_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before adoption follow-up' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new adoption records' });

    const recordType = cleanText(req.body?.recordType, 70);
    const status = cleanText(req.body?.status, 70) || 'initiated';
    if (!ADOPTION_RECORD_TYPES[recordType]) {
      return res.status(400).json({ error: `Adoption record type must be one of ${Object.keys(ADOPTION_RECORD_TYPES).join(', ')}` });
    }
    if (!ADOPTION_STATUSES[status]) {
      return res.status(400).json({ error: `Status must be one of ${Object.keys(ADOPTION_STATUSES).join(', ')}` });
    }
    const agencyName = cleanText(req.body?.agencyName || req.user.org || req.user.name, 140);
    const caringsId = cleanText(req.body?.caringsId, 100) || null;
    const orderNo = cleanText(req.body?.orderNo, 100) || null;
    const note = cleanText(req.body?.note, 1200);
    const orderDate = parseDateInput(req.body?.orderDate, 'Order/action date');
    if (orderDate.error) return res.status(400).json({ error: orderDate.error });
    if (orderDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Order/action date cannot be in the future' });
    const nextReviewDate = optionalDateInput(req.body?.nextReviewDate, 'Next review date', { minTime: Date.now() - DAY });
    if (nextReviewDate.error) return res.status(400).json({ error: nextReviewDate.error });
    if (agencyName.length < 3) return res.status(400).json({ error: 'Agency name must be at least 3 characters' });
    if (note.length < 10) return res.status(400).json({ error: 'Adoption follow-up note must be at least 10 characters' });

    const now = Date.now();
    const adoptionRecord = {
      id: `adoption_${now}_${Math.random().toString(36).slice(2, 7)}`,
      recordType,
      label: ADOPTION_RECORD_TYPES[recordType],
      status,
      statusLabel: ADOPTION_STATUSES[status],
      agencyName,
      caringsId,
      orderNo,
      orderDate: orderDate.value,
      nextReviewDate: nextReviewDate.value,
      note,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'adoption_recorded',
      label: `Adoption follow-up recorded: ${adoptionRecord.label}`,
      note: [adoptionRecord.statusLabel, adoptionRecord.agencyName, adoptionRecord.caringsId ? 'CARINGS linked' : null].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const adoptionRecords = [...(Array.isArray(r.adoptionRecords) ? r.adoptionRecords : []), adoptionRecord];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      adoptionRecords,
      lastAdoptionRecordAt: adoptionRecord.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'adoption_recorded',
      lastWorkflowAt: adoptionRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'adoption',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.adoption_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded adoption follow-up for ${r.childName}: ${adoptionRecord.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        recordType,
        status,
        agencyName,
        caringsIdPresent: Boolean(caringsId),
        orderNoPresent: Boolean(orderNo),
        orderDate: adoptionRecord.orderDate,
        nextReviewDate: adoptionRecord.nextReviewDate,
        noteLength: note.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), adoptionRecord });
  });

  router.post('/:id/case-assessment', protectedRoute, requireRole(...CASE_ASSESSMENT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before case assessment' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new case assessments' });

    const assessmentType = cleanText(req.body?.assessmentType, 60);
    const riskLevel = cleanText(req.body?.riskLevel, 40) || 'medium';
    if (!CASE_ASSESSMENT_TYPES[assessmentType]) {
      return res.status(400).json({ error: `Assessment type must be one of ${Object.keys(CASE_ASSESSMENT_TYPES).join(', ')}` });
    }
    if (!CASE_RISK_LEVELS[riskLevel]) {
      return res.status(400).json({ error: `Risk level must be one of ${Object.keys(CASE_RISK_LEVELS).join(', ')}` });
    }
    const assessmentDate = parseDateInput(req.body?.assessmentDate, 'Assessment date');
    if (assessmentDate.error) return res.status(400).json({ error: assessmentDate.error });
    if (assessmentDate.time > Date.now() + DAY) return res.status(400).json({ error: 'Assessment date cannot be in the future' });
    const nextReviewDate = optionalDateInput(req.body?.nextReviewDate, 'Next review date', { minTime: Date.now() - DAY });
    if (nextReviewDate.error) return res.status(400).json({ error: nextReviewDate.error });
    const assessorName = cleanText(req.body?.assessorName || req.user.name, 140);
    const findings = cleanText(req.body?.findings, 1600);
    const carePlan = cleanText(req.body?.carePlan, 1600);
    const recommendation = cleanText(req.body?.recommendation, 1200);
    if (assessorName.length < 3) return res.status(400).json({ error: 'Assessor name must be at least 3 characters' });
    if (findings.length < 10) return res.status(400).json({ error: 'Findings must be at least 10 characters' });
    if (carePlan.length < 10) return res.status(400).json({ error: 'Care plan must be at least 10 characters' });

    const now = Date.now();
    const assessment = {
      id: `assessment_${now}_${Math.random().toString(36).slice(2, 7)}`,
      assessmentType,
      label: CASE_ASSESSMENT_TYPES[assessmentType],
      riskLevel,
      riskLabel: CASE_RISK_LEVELS[riskLevel],
      assessorName,
      assessmentDate: assessmentDate.value,
      nextReviewDate: nextReviewDate.value,
      findings,
      carePlan,
      recommendation: recommendation || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'case_assessment_recorded',
      label: `Case assessment recorded: ${assessment.label}`,
      note: [assessment.riskLabel, assessment.nextReviewDate ? `review ${assessment.nextReviewDate}` : null].filter(Boolean).join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const caseAssessments = [...(Array.isArray(r.caseAssessments) ? r.caseAssessments : []), assessment];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      caseAssessments,
      lastCaseAssessmentAt: assessment.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'case_assessment_recorded',
      lastWorkflowAt: assessment.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'assessment',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.assessment_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded ${assessment.label} for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        assessmentType,
        riskLevel,
        assessorName,
        assessmentDate: assessment.assessmentDate,
        nextReviewDate: assessment.nextReviewDate,
        findingsLength: findings.length,
        carePlanLength: carePlan.length,
        recommendationLength: recommendation.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), assessment });
  });

  router.post('/:id/production-record', protectedRoute, requireRole(...PRODUCTION_RECORD_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before production recording' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases cannot receive new production records' });

    const productionType = cleanText(req.body?.productionType, 50);
    const outcome = cleanText(req.body?.outcome, 60) || 'care_order_pending';
    if (!PRODUCTION_TYPES[productionType]) {
      return res.status(400).json({ error: `Production type must be one of ${Object.keys(PRODUCTION_TYPES).join(', ')}` });
    }
    if (!PRODUCTION_OUTCOMES[outcome]) {
      return res.status(400).json({ error: `Outcome must be one of ${Object.keys(PRODUCTION_OUTCOMES).join(', ')}` });
    }
    const rescueAt = parseDateTimeInput(req.body?.rescueAt, 'Rescue time');
    const producedAt = parseDateTimeInput(req.body?.producedAt, 'Production time');
    if (rescueAt.error) return res.status(400).json({ error: rescueAt.error });
    if (producedAt.error) return res.status(400).json({ error: producedAt.error });
    if (rescueAt.time > Date.now() + DAY) return res.status(400).json({ error: 'Rescue time cannot be in the future' });
    if (producedAt.time > Date.now() + DAY) return res.status(400).json({ error: 'Production time cannot be in the future' });
    if (producedAt.time < rescueAt.time) return res.status(400).json({ error: 'Production time cannot be before rescue time' });
    const authorityName = cleanText(req.body?.authorityName, 140);
    const orderNo = cleanText(req.body?.orderNo, 100) || null;
    const nextAction = cleanText(req.body?.nextAction, 1000);
    if (authorityName.length < 3) return res.status(400).json({ error: 'Authority name must be at least 3 characters' });
    if (nextAction.length < 10) return res.status(400).json({ error: 'Next action must be at least 10 characters' });

    const deadlineAt = rescueAt.time + DAY;
    const hoursToProduce = Number(((producedAt.time - rescueAt.time) / 3600000).toFixed(1));
    const deadlineStatus = producedAt.time <= deadlineAt ? 'within_24h' : 'delayed';
    const now = Date.now();
    const productionRecord = {
      id: `prod_${now}_${Math.random().toString(36).slice(2, 7)}`,
      productionType,
      label: PRODUCTION_TYPES[productionType],
      outcome,
      outcomeLabel: PRODUCTION_OUTCOMES[outcome],
      authorityName,
      orderNo,
      rescueAt: rescueAt.value,
      producedAt: producedAt.value,
      deadlineAt: new Date(deadlineAt).toISOString(),
      hoursToProduce,
      deadlineStatus,
      nextAction,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      recordedAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'production_recorded',
      label: `Production recorded: ${productionRecord.label}`,
      note: [productionRecord.outcomeLabel, deadlineStatus === 'within_24h' ? 'within 24h' : 'delayed'].join(' / '),
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const productionRecords = [...(Array.isArray(r.productionRecords) ? r.productionRecords : []), productionRecord];
    updateReport(r.id, {
      status: r.status === 'found' ? 'under_review' : r.status,
      productionRecords,
      lastProductionRecordAt: productionRecord.recordedAt,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'production_recorded',
      lastWorkflowAt: productionRecord.recordedAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'hearing',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.production_recorded',
      targetType: 'report',
      targetId: r.id,
      summary: `Recorded production before authority for ${r.childName}: ${productionRecord.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        productionType,
        outcome,
        authorityName,
        orderNo,
        rescueAt: productionRecord.rescueAt,
        producedAt: productionRecord.producedAt,
        hoursToProduce,
        deadlineStatus,
        nextActionLength: nextAction.length,
      },
    });
    res.status(201).json({ report: findReport(r.id), productionRecord });
  });

  router.post('/:id/transfer-jurisdiction', protectedRoute, requireRole(...CASE_TRANSFER_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before jurisdiction transfer' });
    if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot be transferred' });

    const targetInput = {
      state: cleanText(req.body?.state, 80),
      district: cleanText(req.body?.district, 80),
      stateCode: cleanText(req.body?.stateCode, 8),
      districtCode: cleanText(req.body?.districtCode, 40),
    };
    // A case is moved to a real district, by its canonical name and code.
    const targetPlace = canonicalPlace(targetInput);
    const unknownPlace = (targetInput.state || targetInput.district) && jurisdictionError(targetInput, targetPlace);
    if (unknownPlace) return res.status(400).json(unknownPlace);
    const target = {
      state: targetPlace.state || '',
      stateCode: targetPlace.stateCode,
      district: targetPlace.district || '',
      districtCode: targetPlace.districtCode,
      station: cleanText(req.body?.station, 120) || null,
    };
    const reason = cleanText(req.body?.reason, 500);
    if (!canTransferToJurisdiction(req.user, target)) {
      return res.status(403).json({ error: 'Target jurisdiction is outside your transfer authority' });
    }
    const sameCode = (a, b) => String(a || '') === String(b || '');
    const current = canonicalPlace(r);
    if (sameCode(target.stateCode, current.stateCode) && sameCode(target.districtCode, current.districtCode) && target.station === (r.station || null)) {
      return res.status(400).json({ error: 'Target jurisdiction is the same as current jurisdiction' });
    }

    const now = Date.now();
    const transfer = {
      from: {
        state: r.state || null,
        stateCode: r.stateCode || null,
        district: r.district || null,
        districtCode: r.districtCode || null,
        districtText: r.districtText || null,
        station: r.station || null,
      },
      to: target,
      reason: reason || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      transferredAt: new Date(now).toISOString(),
    };
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'transfer_jurisdiction',
      label: `Transferred to ${[target.district, target.state].filter(Boolean).join(', ')}`,
      note: reason || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const transfers = [...(Array.isArray(r.transfers) ? r.transfers : []), transfer];
    updateReport(r.id, {
      state: target.state,
      stateCode: target.stateCode,
      district: target.district,
      districtCode: target.districtCode,
      districtText: null,
      station: target.station,
      transfers,
      workflow,
      workflowStatus: event.label,
      lastWorkflowAction: 'transfer_jurisdiction',
      lastWorkflowAt: transfer.transferredAt,
    });
    addActivity({
      actor: req.user.name,
      action: event.label,
      target: r.childName,
      icon: 'transfer',
      actorId: req.user.id,
      scope: { state: target.state, district: target.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.jurisdiction_transferred',
      targetType: 'report',
      targetId: r.id,
      summary: `Transferred ${r.childName} from ${[transfer.from.district, transfer.from.state].filter(Boolean).join(', ') || 'unscoped'} to ${[target.district, target.state].filter(Boolean).join(', ')}`,
      scope: { state: target.state, district: target.district, reportId: r.id, previousState: transfer.from.state, previousDistrict: transfer.from.district },
      metadata: { from: transfer.from, to: transfer.to, reasonLength: reason.length },
    });
    res.json({ report: findReport(r.id) });
  });

  router.post('/:id/verify-intake', protectedRoute, requireRole(...INTAKE_VERIFY_ROLES), async (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (!isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Report intake is already verified' });

    const { firNo, note } = req.body || {};
    const now = Date.now();
    const event = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      action: 'verify_intake',
      label: 'Citizen intake verified',
      note: cleanText(note, 500) || null,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
    };
    const workflow = [...(Array.isArray(r.workflow) ? r.workflow : []), event];
    const patch = {
      status: 'missing',
      intakeStatus: 'verified',
      firNo: cleanText(firNo, 80) || r.firNo || generatedFirNo(),
      verifiedAt: now,
      verifiedById: req.user.id,
      verifiedByName: req.user.name,
      workflow,
      workflowStatus: 'Citizen intake verified',
      lastWorkflowAction: 'verify_intake',
      lastWorkflowAt: new Date(now).toISOString(),
    };
    updateReport(r.id, patch);
    addActivity({ actor: req.user.name, action: 'Verified citizen missing-child intake', target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.intake_verified',
      targetType: 'report',
      targetId: r.id,
      summary: `Verified citizen/NGO intake for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { firNo: patch.firNo, noteLength: event.note ? event.note.length : 0 },
    });
    // Registration skipped the search for this intake (it was unverified then);
    // now that an officer has verified it, compare it with stored sightings.
    const verified = findReport(r.id);
    const reverse = verified.photoFile
      ? await matchStoredSightings(verified, { trigger: 'intake_verified', actor: req.user })
      : { sightingMatches: 0 };
    res.json({ report: findReport(r.id), sightingMatches: reverse.sightingMatches });
  });

  /**
   * Publishing a public appeal is refused: names and photos of missing persons
   * are never shown to the public (isPublicAppeal). The request is refused
   * before the case is even looked up, so the answer is the same for every id.
   *
   * Unpublishing still works, so that a case published before the rule can be
   * cleaned up: it clears the flag, which no public read consults any more.
   */
  router.post('/:id/bulletin', protectedRoute, requireRole(...BULLETIN_ROLES), (req, res) => {
    const publish = req.body?.publish !== false;
    if (publish) return res.status(403).json({ error: PUBLIC_APPEALS_DISABLED, code: 'public_appeals_disabled' });

    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });

    const now = Date.now();
    const bulletin = {
      ...(r.bulletin || {}),
      published: false,
      unpublishedAt: new Date(now).toISOString(),
      unpublishedById: req.user.id,
      unpublishedByName: req.user.name,
    };
    updateReport(r.id, { bulletin });
    addActivity({
      actor: req.user.name,
      action: 'Unpublished public bulletin',
      target: r.childName,
      icon: 'eye',
      actorId: req.user.id,
      scope: { state: r.state, district: r.district, reportId: r.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.bulletin_unpublished',
      targetType: 'report',
      targetId: r.id,
      summary: `Unpublished public bulletin for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { published: false },
    });
    res.json({ report: findReport(r.id), bulletin: null });
  });

  router.get('/:id/handoff-export', protectedRoute, requireRole(...CASE_HANDOFF_EXPORT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before handoff export' });

    const requestedTarget = cleanText(req.query.targetSystem, 40);
    const targetSystem = HANDOFF_TARGET_SYSTEMS[requestedTarget] ? requestedTarget : 'generic';
    const purpose = cleanText(req.query.purpose, 160) || `Case handoff for ${HANDOFF_TARGET_SYSTEMS[targetSystem]}`;
    const includeOperationalHistory = req.query.includeHistory === 'true' || req.query.includeHistory === '1';
    const payload = caseHandoffPayload(r, req.user, { targetSystem, purpose, includeOperationalHistory });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.handoff_exported',
      targetType: 'report',
      targetId: r.id,
      summary: `Exported redacted case handoff for ${r.childName} to ${HANDOFF_TARGET_SYSTEMS[targetSystem]}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        targetSystem,
        includeOperationalHistory,
        externalIdCount: payload.counts.externalIds,
        workflowEventCount: payload.counts.workflowEvents,
      },
    });
    res.json(signedCaseExport(payload, 'case_handoff_export', settings.exportSigning));
  });

  router.get('/:id', protectedRoute, (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
    const view = isCitizenRole(req.user.role) ? citizenCaseView(r) : r;
    res.json({ report: { ...view, personCategory: personCategoryOf(r) } });
  });


  return router;
}
