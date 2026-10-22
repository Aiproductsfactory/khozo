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

import { POLICE_ROLES, SEEN_OUTSIDE_HINT, canAccessReport, canSeeLocalPoliceRequest, isPoliceOnly, sameDistrict, sameDistrictPlace, sameState, sameStatePlace, scopeFoundReports, scopeReports, seenOutsideCaseDistrict } from '../scope.js';
import { resolveSightingLocation, reverseGeocode } from '../geocode.js';
import { sightingScreenVerdict } from '../face-screen.js';
import { campaignSourceOf } from '../campaign-source.js';
import { createHumanCheck, HUMAN_CHECK_ACTION } from '../human-check.js';
import { concernReasonOf, dismissalApproval, dismissalReasonOf } from '../sighting-misuse.js';
import { anonymiseSighting } from '../retention.js';
import { canonicalPlace, placeFields } from '../geo/index.js';
import { expectedAgeAt, isForwardPoolCase, isFoundChildIntake, isRematchEligible, isReverseMatchCandidate, wasLinkRejected } from '../match-pool.js';
import { createSightingMatcher, engineRecordOf, engineSummary, evidenceOf, isReverseLinked, reportedLocationOf } from '../sighting-matching.js';
import { detectImageMime } from '../photo-format.js';
import {
  MAIN_PHOTO, MAX_CASE_PHOTOS, MAX_SIGHTING_PHOTOS, TOO_MANY_PHOTOS,
  extraPhotoKey, extraPhotoUrl, extraPhotosOf, extraPhotosView, isBadFacePhoto, isExtraPhotoId, leadPhotoOf, photoCountOf,
} from '../photo-set.js';
import { sendSms, smsGatewayConfigured } from '../sms.js';
import { STATION_OUTCOMES, alertPhones, canSeeStationAlert, stationAlertSentTo, escalateStationAlert, stationAlertOpen, stationAlertWords, stationDeskOf, stationDesksFor, stationName } from '../station-alerts.js';
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
  storedImageMime,
  PHOTO_TOO_LARGE,
  validateMissingReport,
  validateFoundReport,
  inferLocationScope,
  jurisdictionError,
  INTAKE_ALERT_ROLES,
} from '../case-domain.js';
import { assessTraffickingRisk } from '../trafficking.js';
import { NO_FAMILY_CONTACT_ROLES, aadhaarFields, deskCaseView } from '../privacy.js';
import { stripImageMetadata } from '../photo-strip.js';

export default function registerReportRoutes(router, deps) {
  const {
    listReports, addReport, findReport, updateReport,
    listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
    listUsers, addActivity, addAudit, addNotification,
    // Optional so a harness need not stub it: drops a push token a device no
    // longer answers to (raiseStationAlert).
    updateUser = null,
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
    // The same for a case, when its photos change (writeCasePhotos).
    claimReport = null,
    detectPerson,
    upload,
    // Optional: removes a replaced case photo from storage (POST /:id/photo).
    deletePhoto = null,
    // Injectable so the reverse geocoder can be stubbed in tests rather than
    // reaching OpenStreetMap from a test run.
    fetchImpl = fetch,
    settings = {},
  } = deps;

  const protectedRoute = [authRequired, passwordChangeRequired];

  // Linking sightings and cases, both directions, the candidate list an
  // officer walks, the case photo check and the one-to-many index
  // (shared/sighting-matching.js). `deps.faceIndex` is the index provider
  // (shared/face-index.js); without one the pairwise budget is the search.
  const matcher = createSightingMatcher(deps);

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
    // Why Khozo may hold the photo: the family's consent, or (for an officer
    // importing a department's own register) the register itself.
    photoBasis: ['text', 40],
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
    // The poster code the form was opened from (shared/campaign-source.js).
    campaignSource: ['text', 80],
    // Why the reporter thought a woman or adult needs help (shared/sighting-misuse.js).
    concernReason: ['text', 40],
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
      addActivity({ actor: user.name, action: 'SMS alert sent to the family', target: report.childName, icon: 'sms', actorId: user.id, scope });
    }
    addAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: outcome.sent ? 'case.sms_sent' : 'case.sms_not_sent',
      targetType: 'report',
      targetId: report.id,
      summary: outcome.sent ? `SMS alert sent for case ${report.id}` : `No SMS sent for case ${report.id}: ${outcome.reason}`,
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

  /**
   * The trafficking-risk prompt for a case (shared/trafficking.js), worked
   * out from everything else Khozo holds: a repeat disappearance, other
   * adolescents missing from the same district, the circumstances recorded.
   */
  function riskFor(report) {
    return assessTraffickingRisk(report, {
      reports: listReports(),
      aadhaarKey: settings.fieldHashKey,
      nonFamilyPhones: nonFamilyPhoneSet(listUsers()),
    });
  }

  /**
   * Tells the Anti Human Trafficking Unit and SJPU desks that can open a case
   * that it was raised as high risk, with the reasons; the state's desks when
   * the district has neither yet. Only for a case an officer has registered
   * or verified: a stranger's unverified registration does not task an AHTU.
   * Like every alert, it names the case by id, never the person.
   */
  function alertTraffickingRisk(report, actor) {
    const risk = report?.traffickingRisk;
    if (!risk || risk.level !== 'high' || isPendingCitizenIntake(report)) return 0;
    const users = listUsers();
    let recipients = users.filter((u) => ['ahtu', 'sjpu'].includes(u.role) && canAccessReport(u, report));
    if (!recipients.length) {
      recipients = users.filter((u) => ['admin', 'crime_bureau', 'state_nodal'].includes(u.role) && canAccessReport(u, report));
    }
    if (!recipients.length) return 0;
    notifyAuthorities({
      kind: 'trafficking_risk',
      title: `High trafficking risk: case ${report.id}`,
      body: `Case ${report.id} in ${caseWhere(report)} was raised for: ${risk.reasons.map((r) => r.label.toLowerCase()).join('; ')}. A prompt to review the case with the investigating officer, not a finding.`,
      priority: 'high',
      recipients,
      scope: {
        state: report.state || null,
        stateCode: report.stateCode || null,
        district: report.district || null,
        districtCode: report.districtCode || null,
        reportId: report.id,
      },
    });
    addAudit({
      actorId: actor?.id || null,
      actorName: actor?.name || 'Khozo',
      actorRole: actor?.role || 'system',
      action: 'case.trafficking_risk_raised',
      targetType: 'report',
      targetId: report.id,
      summary: `Raised case ${report.id} as high trafficking risk for ${recipients.length} desk${recipients.length === 1 ? '' : 's'}`,
      scope: { state: report.state, district: report.district, reportId: report.id },
      metadata: { level: risk.level, score: risk.score, reasons: risk.reasons.map((r) => r.code), version: risk.version, recipients: recipients.length },
    });
    return recipients.length;
  }

  // ---- Linking a sighting to a case: shared by both directions ---------------
  //
  // A sighting is linked to a case by the forward search (a new sighting
  // against the open cases, POST /found) and by the reverse search (a newly
  // registered case against the stored sightings, POST / and POST /:id/rematch).
  // The rule, the evidence kept on the record and the candidate list live in
  // shared/sighting-matching.js; the alerts a new sighting raises stay here.

  /** "Near the bus stand, Surat, Gujarat": a place, for an alert. */
  function placeText(foundLocation, { state, district } = {}) {
    return `${foundLocation}${state ? `, ${[district, state].filter(Boolean).join(', ')}` : ''}`;
  }

  /**
   * Where the sighting itself was, for an alert: the place the reporter gave.
   * A strong match files the sighting under the case's district, and an alert
   * built from that told Ahmedabad officers a child seen in Mumbai had been
   * seen "..., Ahmedabad, Gujarat".
   */
  function sightingWhere(sighting) {
    return placeText(sighting.foundLocation, reportedLocationOf(sighting));
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
        body: `${matchedBody || `A sighting was reported at ${sightingWhere(sighting)}.`}${seenOutsideCaseDistrict(sighting, matchedReport) ? SEEN_OUTSIDE_HINT : ''}`,
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

  /** Drops push tokens Expo says no longer reach a device. */
  function dropDeadTokens(dead) {
    if (!updateUser || !dead.length) return;
    for (const userId of new Set(dead.map((d) => d.userId))) {
      const user = listUsers().find((u) => u.id === userId);
      if (!user) continue;
      const gone = new Set(dead.filter((d) => d.userId === userId).map((d) => d.token));
      updateUser(userId, { pushTokens: (user.pushTokens || []).filter((t) => !gone.has(t?.token)) });
    }
  }

  /**
   * Tells the police station that owns a sighting, on its phones: the nearest
   * station desk, and the station whose poster code was scanned
   * (shared/station-alerts.js). With no station desk to tell, the control room
   * is told at once. Never fails the report: an SMS or push outage is recorded
   * on the sighting, and the inbox alert is written regardless.
   */
  async function raiseStationAlert(sighting) {
    try {
      const users = listUsers();
      const picks = stationDesksFor(sighting, users);
      // Station alerts start state by state, as stations are given their
      // locations. Where no station desk is set up yet, the alert every desk
      // gets (alertSighting) stands alone: escalating every such sighting as
      // "no station near" would only repeat it at a louder pitch.
      if (!picks.length) {
        const seen = reportedLocationOf(sighting);
        const setUp = Boolean(seen.state || seen.stateCode)
          && users.some((u) => stationDeskOf(u) && sameStatePlace(u.jurisdiction || {}, seen));
        if (!setUp) return null;
      }
      const now = Date.now();
      const posterCode = campaignSourceOf(sighting.campaignSource);
      const scope = { foundReportId: sighting.id, stationAlert: true };
      const groups = ['nearest', 'poster'].map((reason) => picks.filter((p) => p.reason === reason)).filter((g) => g.length);
      const sent = await Promise.all(groups.map((group) => {
        const words = stationAlertWords(sighting, { kind: group[0].reason, posterCode });
        for (const pick of group) {
          addNotification({
            userId: pick.user.id,
            kind: 'station_alert',
            title: words.title,
            body: words.body,
            priority: 'high',
            scope,
            inJurisdiction: true,
          });
        }
        return alertPhones(group.map((p) => p.user), words, { data: { scope }, settings, fetchImpl });
      }));
      const phones = sent.flatMap((s) => s.results);
      dropDeadTokens(sent.flatMap((s) => s.dead));
      const stationAlert = {
        sentAt: now,
        desks: picks.map((p) => {
          const result = phones.find((r) => r.userId === p.user.id) || {};
          return {
            userId: p.user.id,
            name: p.user.name || null,
            station: stationName(p.user),
            reason: p.reason,
            distanceKm: p.distanceKm,
            push: result.push || null,
            sms: result.sms || null,
          };
        }),
        posterCode: posterCode || null,
        ack: null,
        replies: [],
        escalation: null,
      };
      updateFoundReport(sighting.id, { stationAlert });
      if (!picks.length) {
        const escalated = await escalateStationAlert({ ...sighting, stationAlert }, { users, now, addNotification, settings, fetchImpl });
        updateFoundReport(sighting.id, escalated.patch);
        dropDeadTokens(escalated.dead);
      }
      return findFoundReport(sighting.id)?.stationAlert || stationAlert;
    } catch (err) {
      console.error('[station-alert]', sighting?.id, err?.message || err);
      return null;
    }
  }

  // Keyed on the network address alone. It once included the phone number
  // typed into the form, which is optional free text: a different number on
  // each request made the limit no limit at all.
  const foundReportLimit = fixedWindowRateLimit({
    name: 'public_found_report',
    limit: 10,
    envLimit: settings.foundReportLimit,
    key: (req) => clientIp(req),
    onLimit: auditPublicRateLimit,
  });
  // With the bot check on (shared/human-check.js), a report that did not pass
  // it - sent from an offline queue, or while Cloudflare could not answer - is
  // accepted but held to this tighter limit.
  const unverifiedFoundReportLimit = fixedWindowRateLimit({
    name: 'public_found_report_unverified',
    limit: 3,
    envLimit: settings.unverifiedFoundReportLimit,
    key: (req) => clientIp(req),
    onLimit: auditPublicRateLimit,
  });
  const humanCheck = createHumanCheck({
    config: settings.humanCheck || null,
    fetchImpl,
    clientIp,
    strictLimit: unverifiedFoundReportLimit,
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

  /**
   * Strips an uploaded photo's GPS, device and capture metadata before any
   * handler, store or face engine sees it (shared/photo-strip.js, DPIA G13).
   * The orientation flag is kept so the face stays upright.
   */
  function withoutPhotoMetadata(req, _res, next) {
    if (req.file?.buffer) req.file.buffer = stripImageMetadata(req.file.buffer);
    for (const extra of Array.isArray(req.extraFiles) ? req.extraFiles : []) {
      if (extra?.buffer) extra.buffer = stripImageMetadata(extra.buffer);
    }
    next();
  }

  /**
   * The extra photos an upload carried beside the main one (`req.extraFiles`,
   * shared/photo-set.js), or why they are refused: more than `max`, or one
   * that is not a usable image. With no main photo the first extra becomes
   * it, so a client that sent only extras still has its photo kept. Runs
   * before the main photo is validated, which then covers a promoted one.
   */
  function uploadedExtras(req, max) {
    const extras = (Array.isArray(req.extraFiles) ? req.extraFiles : []).filter((f) => f?.buffer?.length);
    if (!req.file && extras.length) req.file = extras.shift();
    if (extras.length > max) return { error: TOO_MANY_PHOTOS, status: 400, extras: [] };
    for (const file of extras) {
      const error = validateImageFile(file, 'Photo');
      if (error) return { error, status: error === PHOTO_TOO_LARGE ? 413 : 400, extras: [] };
    }
    return { error: null, extras };
  }

  /**
   * Stores extra photos of a record, each under its own key. Returns the
   * `extraPhotos` entries (shared/photo-set.js) and each one's bytes by its
   * id, for the face checks and the gallery. A photo storage refused is left
   * out rather than recorded without its bytes.
   */
  async function storeExtraPhotos(recordId, files, actor, ids = []) {
    const entries = [];
    const buffers = {};
    for (const [i, file] of files.entries()) {
      const id = ids[i] || `p_${nanoid(8)}`;
      const stored = await savePhoto(extraPhotoKey(recordId, id), file.buffer, storedImageMime(file));
      if (!stored) continue;
      entries.push({
        id,
        file: stored,
        url: extraPhotoUrl(recordId, id),
        check: null,
        addedAt: new Date().toISOString(),
        addedById: actor?.id || null,
        addedByRole: actor?.role || null,
      });
      buffers[id] = file.buffer;
    }
    return { entries, buffers };
  }

  /**
   * A sighting photo's person screen in the words a case photo's face check
   * uses (`usable`, `no_face`, `multiple_faces`, `unchecked`), so the lead
   * photo is chosen by one rule for both (shared/photo-set.js leadPhotoOf).
   */
  function checkOfScreen(screen) {
    if (!screen || typeof screen !== 'object') return null;
    const verdict = sightingScreenVerdict(screen);
    const faces = Number.isFinite(Number(screen.faces)) ? Number(screen.faces) : null;
    return {
      faces,
      verdict: verdict === 'no_person' ? 'no_face' : ['person', 'unclear_face'].includes(verdict) ? (faces > 1 ? 'multiple_faces' : 'usable') : 'unchecked',
      provider: screen.provider || null,
      checkedAt: screen.checkedAt || new Date().toISOString(),
    };
  }

  /**
   * The face check of each extra photo, one after the other (the Worker's
   * outbound connections are few), written into its entry. Returns the
   * entries with their checks.
   */
  async function checkExtraPhotos(entries, buffers) {
    const checked = [];
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      const check = buffers[entry.id] ? await matcher.checkCasePhoto(buffers[entry.id]) : null;
      checked.push({ ...entry, check: check || null });
    }
    return checked;
  }

  async function storePhoto(key, file) {
    if (!file) return { photoUrl: null, photoFile: null };
    const photoFile = await savePhoto(key, file.buffer, storedImageMime(file));
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
      // The police asked to help where a sighting was made see its photo
      // (POST /found/:id/local-police), and so does the station it was sent
      // to (shared/station-alerts.js).
      if (found && scopeFoundReports(req.user, [found], listReports()).length !== 1 && !canSeeLocalPoliceRequest(req.user, found) && !canSeeStationAlert(req.user, found)) {
        return res.status(403).json({ error: 'Photo is outside your jurisdiction' });
      }
    }

    // An extra photo of the same record (?p=<id>, shared/photo-set.js): the
    // same person, so the same rule above decides who may see it.
    if (req.query?.p != null) {
      const photoId = String(req.query.p);
      let file = isExtraPhotoId(photoId) && !record.anonymizedAt
        ? extraPhotosOf(record).find((p) => p.id === photoId)?.file || null
        : null;
      let bytes = file ? await readPhoto(file) : null;
      // As for the main photo below: a sighting reached through its
      // found-child intake is shown with the intake's copy, which keeps the
      // sighting's photo ids.
      const viaIntake = found?.reverseMatch?.viaIntakeReportId;
      if (!bytes && isExtraPhotoId(photoId) && viaIntake && found.matchedReportId) {
        const intake = findReport(viaIntake);
        const copy = intake && !intake.anonymizedAt ? extraPhotosOf(intake).find((p) => p.id === photoId) : null;
        if (copy) {
          file = copy.file;
          bytes = await readPhoto(copy.file);
        }
      }
      if (!bytes) return res.status(404).end();
      return res.type(detectImageMime(bytes) || photoMimeType(file)).send(bytes);
    }

    let buffer = record.photoFile ? await readPhoto(record.photoFile) : null;
    let served = record.photoFile;
    // A sighting the reverse search reached through its found-child intake
    // (shared/sighting-matching.js) is reviewed on the intake's copy of the
    // photo when its own has gone with the sighting's retention period. Who
    // may see it is decided by the sighting, above: it is the same person.
    const viaIntakeId = found?.reverseMatch?.viaIntakeReportId;
    if (!buffer && viaIntakeId && found.matchedReportId) {
      const intake = findReport(viaIntakeId);
      if (intake?.photoFile && !intake.anonymizedAt) {
        buffer = await readPhoto(intake.photoFile);
        served = intake.photoFile;
      }
    }
    if (!buffer) return res.status(404).end();
    res.type(detectImageMime(buffer) || photoMimeType(served)).send(buffer);
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
  // The bot check's public site key for the sighting form, or null when the
  // check is off (shared/human-check.js). Only the site key: it is public.
  router.get('/public/human-check', (_req, res) => {
    res.json({ siteKey: settings.humanCheck?.siteKey || null, action: HUMAN_CHECK_ACTION });
  });

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
      // Marks, clothing, languages and hair are searched too: an officer
      // holding a description ("scar above left eyebrow", "speaks Bhojpuri")
      // finds the case without a usable photo. A desk that does not see the
      // family's address cannot search by it either.
      const addressVisible = !NO_FAMILY_CONTACT_ROLES.includes(req.user.role);
      rows = rows.filter((r) => {
        const profile = r.identificationProfile || {};
        return [
          r.id, r.childName, r.parentName, r.firNo, addressVisible ? r.address : null, r.state, r.district,
          profile.identificationMark, profile.birthMark, profile.clothing, profile.languages, profile.hair,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      });
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
          // The current candidate's own corroboration where it is recorded
          // (shared/sighting-matching.js), the search's for older records.
          corroborated: f.matchCorroborated ?? Boolean(f.matchEngine?.corroborated),
          // Rekognition was asked and did not answer: one engine's lead only.
          notChecked: Boolean(f.matchNotChecked),
          at: f.createdAt || null,
          // Which photo of each the score is for, and the sighting's other
          // photos, so the case panel opens the pair side by side
          // (shared/photo-set.js).
          photoPair: f.matchedPhotoPair || null,
          sightingPhotoIds: [MAIN_PHOTO, ...extraPhotosOf(f).map((p) => p.id)],
        });
      }
    }
    // A parent or NGO sees what they registered and where it stands, never
    // what the agencies added to it (citizenCaseView).
    const citizen = isCitizenRole(req.user.role);
    res.json({
      reports: rows.map((r) => ({
        ...(citizen ? citizenCaseView(r) : deskCaseView(req.user, r)),
        // Records written before the field existed are children; say so
        // explicitly so no client has to know the default.
        personCategory: personCategoryOf(r),
        pendingMatch: citizen ? null : pendingByCase.get(r.id) || null,
      })),
    });
  });

  // Register a missing child. Parents/NGOs file a report; police file a formal FIR.
  router.post('/', protectedRoute, requireRole(...REPORT_CREATE_ROLES), upload.single('photo'), withoutPhotoMetadata, async (req, res) => {
    const read = readFields(req.body, REPORT_FIELDS);
    if (read.error) return res.status(400).json({ error: read.error, errors: [read.error] });
    const b = read.body;
    // Up to four more photos of the person beside the main one (shared/photo-set.js).
    const extraUpload = uploadedExtras(req, MAX_CASE_PHOTOS - 1);
    if (extraUpload.error) return res.status(extraUpload.status).json({ error: extraUpload.error, errors: [extraUpload.error] });
    const extras = { entries: [], buffers: {} };
    const validation = validateMissingReport(b, req.file);
    if (validation.errors) return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    const isPolice = FORMAL_CASE_ROLES.includes(req.user.role);
    // A photo from a department's own register was not given with anyone's
    // consent, and the record must not claim it was (DPIA G15). Only officers
    // who register formal cases may give that basis.
    const photoBasis = req.file
      ? (b.photoBasis === 'department_register' && isPolice ? 'department_register' : isTruthy(b.photoConsent) ? 'consent' : null)
      : null;
    if (req.file && !photoBasis) {
      return res.status(400).json({ error: 'Photo consent is required before uploading a child image' });
    }
    const id = `r_${nanoid(8)}`;
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
    // The number itself is never stored: its last four digits and a keyed
    // fingerprint are (shared/privacy.js, DPIA G2).
    const aadhaar = aadhaarFields(b.childAadhar, settings.fieldHashKey);
    const incoming = {
      personCategory,
      childName: b.childName,
      ...aadhaar,
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
      aadhaarKey: settings.fieldHashKey,
    });
    const allowDuplicate = b.allowDuplicate === true || b.allowDuplicate === 'true';
    if (duplicateCandidates.length && !allowDuplicate) {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'case.duplicate_warning',
        targetType: 'report',
        summary: `Potential duplicate case blocked (closest: case ${duplicateCandidates[0].report.id})`,
        scope: { state: incoming.state, district: incoming.district },
        metadata: { candidateIds: duplicateCandidates.map((c) => c.report.id), topScore: duplicateCandidates[0].score },
      });
      return res.status(409).json({
        error: 'Possible duplicate case found',
        duplicateCandidates: duplicateCandidates.map((c) => duplicatePayload(req.user, c)),
      });
    }
    // Stored only now, past every refusal above, so none is left behind.
    if (req.file) Object.assign(extras, await storeExtraPhotos(id, extraUpload.extras, req.user));
    const report = {
      id,
      personCategory,
      ...(visibility ? { visibility } : {}),
      firNo: b.firNo || (isPolice ? generatedFirNo() : null),
      childName: b.childName,
      ...aadhaar,
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
      // Given under the same consent or register basis as the main photo.
      extraPhotos: extras.entries,
      // Who gave the main photo: a family sees only the photos it gave.
      photoAddedById: req.file ? req.user.id : null,
      photoConsent: req.file ? photoBasis === 'consent' : isTruthy(b.photoConsent),
      photoBasis,
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
    report.traffickingRisk = riskFor(report);
    addReport(report);
    addActivity({ actor: req.user.name, action: isPolice ? 'Registered an FIR' : adult ? 'Submitted missing-person intake for verification' : 'Submitted missing-child intake for verification', target: report.childName, icon: 'plus', actorId: req.user.id, scope: { state: report.state, district: report.district, reportId: report.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: isPolice ? 'case.fir_registered' : 'case.report_registered',
      targetType: 'report',
      targetId: report.id,
      summary: `${isPolice ? 'Registered FIR' : 'Submitted citizen/NGO intake'} as case ${report.id}`,
      scope: { state: report.state, district: report.district },
      metadata: {
        personCategory,
        visibility,
        photoConsent: report.photoConsent,
        photoBasis: report.photoBasis,
        photoCount: photoCountOf(report),
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
        summary: `Created case ${report.id} after duplicate warning override`,
        scope: { state: report.state, district: report.district },
      metadata: { candidateIds: duplicateCandidates.map((c) => c.report.id), topScore: duplicateCandidates[0].score, retentionUntil: report.retentionUntil },
    });
    }
    // A family's or an NGO's report waits for an officer, so the officers who
    // verify it are told it is there (alertIntake).
    if (isPendingCitizenIntake(report)) alertIntake(report);
    else alertTraffickingRisk(report, req.user);
    // Two-way matching: a case registered with a photo is compared with the
    // sightings already stored, inside this request (matchStoredSightings in
    // shared/sighting-matching.js). Bulk imports arrive here one row at a
    // time, so they are covered too. Alongside it, the photo is screened for a
    // face (`photoCheck`): a photo with no face, or a group photo, cannot be
    // matched, and the officer is told so on the case rather than finding out
    // when nothing ever matches. Neither ever blocks the registration.
    //
    // A citizen or NGO intake waits for an officer's verification first: each
    // comparison is a paid provider call, the demo parent and NGO logins are
    // public, and an unverified registration should not be able to spend the
    // comparison budget. verify-intake runs the same search and check.
    //
    // One after the other, not together: the Worker holds at most six
    // outbound connections, and the reverse search already uses five.
    const searchable = Boolean(report.photoFile) && !isPendingCitizenIntake(report);
    const photoCheck = searchable ? await matcher.checkCasePhoto(req.file?.buffer) : null;
    if (photoCheck) {
      updateReport(report.id, { photoCheck });
      report.photoCheck = photoCheck;
    }
    // Each extra photo is checked on its own: a family's second photo may be
    // the one with a clear face.
    if (searchable && report.extraPhotos.length) {
      const extraPhotos = await checkExtraPhotos(report.extraPhotos, extras.buffers);
      updateReport(report.id, { extraPhotos });
      report.extraPhotos = extraPhotos;
    }
    // The search leads with the photo that shows one face (leadPhotoOf): a
    // group or faceless main photo would spend every comparison for nothing.
    const checked = findReport(report.id) || report;
    const photoBuffers = { [MAIN_PHOTO]: req.file?.buffer, ...extras.buffers };
    const lead = leadPhotoOf(checked);
    const reverse = searchable
      ? await matcher.matchStoredSightings(checked, { trigger: 'registration', actor: req.user, photo: photoBuffers[lead?.id] || req.file?.buffer, photoId: photoBuffers[lead?.id] ? lead.id : MAIN_PHOTO })
      : { sightingMatches: 0 };
    if (searchable) await matcher.indexCase(findReport(report.id) || report, photoBuffers);
    res.status(201).json({
      report: isCitizenRole(req.user.role) ? citizenCaseView(report) : { ...deskCaseView(req.user, findReport(report.id) || report), photoCheck: report.photoCheck || null },
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
  router.post('/found', optionalAuth, upload.single('photo'), withoutPhotoMetadata, foundReportLimit, humanCheck, async (req, res) => {
    const read = readFields(req.body, FOUND_FIELDS);
    if (read.error) return res.status(400).json({ error: read.error, errors: [read.error] });
    const b = read.body;
    // Up to two more photos of the person beside the first (shared/photo-set.js).
    const extraUpload = uploadedExtras(req, MAX_SIGHTING_PHOTOS - 1);
    if (extraUpload.error) return res.status(extraUpload.status).json({ error: extraUpload.error, errors: [extraUpload.error] });
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
    const searchHints = {
      gender: b.gender,
      ageApprox: validation.ageApprox,
      state: locationScope.state,
      district: locationScope.district,
      stateCode: locationScope.stateCode || null,
      districtCode: locationScope.districtCode || null,
    };
    const sentFiles = req.file ? [req.file, ...extraUpload.extras] : [];
    let screening;
    let search;
    // The photos as they will be kept: [{ id, file, screen }], main first.
    let photos;
    if (sentFiles.length <= 1) {
      photos = sentFiles.map((file) => ({ id: MAIN_PHOTO, file, screen: null }));
      [screening, search] = await Promise.all([
        detectPerson(req.file?.buffer || null),
        // With a one-to-many index configured this asks it for a shortlist
        // first (shared/sighting-matching.js forwardSearch).
        matcher.forwardSearch(req.file?.buffer || null, searchHints),
      ]);
    } else {
      // Several photos: screened one after another until one clearly shows a
      // person. That one becomes the main photo and leads the search; the
      // others are compared only with the cases most like it
      // (shared/match-pipeline.js). One screen, usually.
      // Every photo is screened, so what each shows is known: an officer is
      // shown a photo with no person only on asking.
      // At the same time (three at most), so a report with several photos
      // takes no longer to screen than one with a single photo.
      const screens = await Promise.all(sentFiles.map((file) => detectPerson(file.buffer)));
      // Which photo leads: one that shows a person; else one with a face
      // too unclear to call; else one the screen could not judge; never one
      // it found empty while another may not be.
      const rank = (screen) => ({ person: 0, unclear_face: 1, unverified: 2 }[sightingScreenVerdict(screen)] ?? 3);
      const lead = screens.reduce((best, screen, i) => (rank(screen) < rank(screens[best]) ? i : best), 0);
      const order = [lead, ...sentFiles.map((_, i) => i).filter((i) => i !== lead)];
      photos = order.map((i, at) => ({ id: at === 0 ? MAIN_PHOTO : `p_${nanoid(8)}`, file: sentFiles[i], screen: screens[i] || null }));
      screening = photos[0].screen;
      search = await matcher.forwardSearch(photos[0].file.buffer, {
        ...searchHints,
        probeId: MAIN_PHOTO,
        // A photo the screen found empty is not compared with anyone.
        probeExtras: photos.slice(1).filter((p) => sightingScreenVerdict(p.screen) !== 'no_person').map((p) => ({ id: p.id, buffer: p.file.buffer })),
        // Another photo to the gallery only when the lead's face was unclear:
        // when the screen found no one, or could not run, no photo will do better.
        retryIndexWithExtras: sightingScreenVerdict(screening) === 'unclear_face',
      });
    }
    const mainPhotoFile = photos[0]?.file || null;
    const { candidates, engine: matchEngine } = search;
    const canRunMatch = !!req.file;
    // The strong candidates, best first (up to five, an officer walks them),
    // by the same rule the reverse search applies (isStrongMatch).
    const link = canRunMatch ? matcher.newSightingFields(search, { trigger: 'submitted' }) : null;
    const matchedCase = link?.matchedReport || null;
    const hasStrongMatch = Boolean(matchedCase);
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
    const matchedScope = hasStrongMatch && (matchedCase.state || matchedCase.district || matchedCase.stateCode)
      ? placeFields({ ...matchedCase, district: matchedCase.district || matchedCase.districtText })
      : null;
    const filedPlace = matchedScope || reportedPlace;
    // The phone's coordinates fill in the jurisdiction the reporter did not
    // type. What they did type always wins; a failed lookup changes nothing.
    const confidentialReporter = isTruthy(b.confidentialReporter);
    const reporterName = cleanText(b.reporterName, 120) || 'Anonymous citizen';
    const idProofType = SIGHTING_ID_PROOF_TYPES[b.idProofType] ? b.idProofType : null;
    const idProofNumberMasked = idProofType ? maskProofNumber(b.idProofNumber) : null;
    const storedExtras = await storeExtraPhotos(id, photos.slice(1).map((p) => p.file), null, photos.slice(1).map((p) => p.id));
    const fr = {
      id,
      ...(await storePhoto(id, mainPhotoFile)),
      // The other photos the reporter sent, each with what its screen found
      // when it was screened (shared/photo-set.js).
      extraPhotos: storedExtras.entries.map((entry) => ({
        ...entry,
        check: checkOfScreen(photos.find((p) => p.id === entry.id)?.screen),
      })),
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
      matchedReportId: hasStrongMatch ? matchedCase.id : null,
      // Every candidate an officer may walk through, and the current one's
      // scores: both engines' numbers, whether the second engine answered.
      matchCandidates: link?.matchCandidates || [],
      ...(link?.evidence || evidenceOf(null)),
      // The search itself: the engine that answered, how much it compared,
      // the thresholds and configuration it ran under.
      matchEngine: link?.matchEngine || engineRecordOf(matchEngine, { trigger: 'submitted' }),
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
        : adultSighting ? 'Sent to the police' : 'Sent to Childline and the CWC',
      // What the screen found, kept on the record so a reviewer can see why the
      // report was routed the way it was rather than guessing.
      screening: {
        ...screening,
        // A text-only report has no photo to screen and is a person's account of
        // seeing a child, so it alerts on its own terms. A photo alerts only
        // when it clearly shows a person: a small face in the background of a
        // photo of something else does not (shared/face-screen.js).
        raisesAlert: !req.file || sightingScreenVerdict(screening) === 'person',
      },
      locationSource: locationScope.source || 'reporter',
      // The street address of the phone's coordinates, for the officers who
      // go there. Never in the reporter's receipt (above).
      geoAddress: locationScope.address || null,
      // Which poster's code opened the form, for the MIS report's count of
      // which posters work. Not in the reporter's receipt.
      campaignSource: campaignSourceOf(b.campaignSource),
      // Why the reporter thought this person needs help; the form asks it for
      // a woman or an adult (shared/sighting-misuse.js).
      concernReason: concernReasonOf(b.concernReason),
      // The bot check's result: null when it is off or the sender is signed in
      // (shared/human-check.js).
      humanCheck: req.humanCheck ?? null,
      createdAt: Date.now(),
    };
    addFoundReport(fr);
    addActivity({ actor: publicReporterName(fr), action: adultSighting ? 'Reported a sighting of a missing person' : 'Uploaded a spotted-child photo', target: fr.foundLocation, icon: 'upload', scope: { state: fr.state, district: fr.district, matchedReportId: fr.matchedReportId, foundReportId: fr.id } });
    addAudit({
      actorName: publicReporterName(fr),
      actorRole: 'public',
      action: 'sighting.submitted',
      targetType: 'foundReport',
      targetId: fr.id,
      summary: `Public sighting ${fr.id} submitted`,
      scope: { matchedReportId: fr.matchedReportId, state: fr.state, district: fr.district },
      metadata: { personCategory, matchScore: fr.matchScore, status: fr.status, matchEngine: fr.matchEngine, candidateCount: fr.matchCandidates.length, matchAttempted: canRunMatch, photoCount: photoCountOf(fr), confidentialReporter, idProofType, idProofCaptured: fr.idProofVerified },
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
        matchedReport: hasStrongMatch ? matchedCase : null,
        broadcast: fr.screening.raisesAlert,
      }).map((u) => u.id)
    );
    // The station that can get there first, on its phones. Only for a report
    // that raises an alert at all: a photo with no person in it must not ring
    // a station's alarm at 2 am.
    if (fr.screening.raisesAlert) await raiseStationAlert(fr);
    if (!fr.screening.raisesAlert) {
      // Screened out, not discarded. One person still looks at it, because the
      // screen can be wrong and the cost of it being wrong is a real sighting
      // that nobody read.
      const reported = reportedLocationOf(fr);
      const where = placeText(fr.foundLocation, reported);
      const verdict = sightingScreenVerdict(fr.screening);
      notifyAuthorities({
        kind: 'sighting_screening',
        title: verdict === 'no_person'
          ? 'Upload with no person in it'
          : verdict === 'unclear_face' ? 'Upload with no clear person in it' : 'Unscreened upload',
        body:
          verdict === 'no_person'
            ? `An upload at ${where} contained no recognisable person. Queued for your review.`
            : verdict === 'unclear_face'
              ? `An upload at ${where} showed no clear person — only a small or unclear face. Queued for your review.`
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
        summary: `Queued unmatched missing-person sighting ${fr.id} for police follow-up`,
        scope: { state: fr.state, district: fr.district },
      });
    } else if (!hasStrongMatch) {
      addActivity({ actor: 'Khozo intake', action: 'Queued report for 1098/CWC follow-up', target: fr.foundLocation, icon: 'referral', scope: { state: fr.state, district: fr.district, foundReportId: fr.id } });
      addAudit({
        actorName: 'Khozo intake',
        actorRole: 'system',
        action: 'sighting.cwc_queued',
        targetType: 'foundReport',
        targetId: fr.id,
        summary: `Queued unmatched sighting ${fr.id} for 1098/CWC follow-up`,
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
      (!hasStrongMatch || canAccessReport(req.user, matchedCase));
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
            ? 'No strong match yet. The report is saved and sent to the police for follow-up.'
            : 'No strong match yet. The report is saved and sent to Childline and the CWC for follow-up.')
          : (adultSighting
            ? 'Your written report is saved and sent to the police. No face search was run because there was no photo.'
            : 'Your written report is saved and sent to Childline and the CWC. No face search was run because there was no photo.'),
      candidates: visibleCandidates
        .map((c, index) => ({
          rank: index + 1,
          score: c.score,
          personCategory: personCategoryOf(c.report),
          ageBand: c.report.age == null ? 'Unknown' : `${Math.max(0, c.report.age - 1)}-${c.report.age + 1}`,
          gender: c.report.gender,
          corroborated: Boolean(c.corroborated),
          notChecked: Boolean(c.notChecked),
        })),
    });
  });

  /**
   * What the review screen shows of a case a sighting may match: who, the
   * age they would be when the sighting was taken (age at missing plus the
   * years since), sex, when they went missing and how to recognise them, and
   * whether their photo can be matched at all. A desk that does not contact
   * families (shared/privacy.js NO_FAMILY_CONTACT_ROLES) gets no address or
   * family contact here either (DPIA G23).
   */
  function caseForReview(report, sighting, user = null) {
    const contactVisible = !NO_FAMILY_CONTACT_ROLES.includes(user?.role);
    return {
      id: report.id,
      personCategory: personCategoryOf(report),
      childName: report.childName,
      age: report.age,
      expectedAge: expectedAgeAt(report, sighting?.createdAt || Date.now()),
      gender: report.gender,
      dateOfMissing: report.dateOfMissing || null,
      address: contactVisible ? report.address : null,
      state: report.state,
      district: report.district,
      parentName: contactVisible ? report.parentName : null,
      parentPhone: contactVisible ? report.parentPhone : null,
      familyContactWithheld: contactVisible ? undefined : 'Withheld: contact the family through the police or CWC',
      status: report.status,
      photoUrl: report.photoUrl || (report.photoFile ? `/api/reports/photo/${report.id}` : null),
      photoCheck: report.photoCheck || null,
      // The case's other photos, so the reviewer can compare with each.
      extraPhotos: extraPhotosView(report),
      identificationMark: report.identificationProfile?.identificationMark || null,
      birthMark: report.identificationProfile?.birthMark || null,
      retentionUntil: report.retentionUntil,
      dataPurpose: report.dataPurpose,
    };
  }

  /**
   * A sighting as a review desk sees it. The reporter is masked as they asked,
   * and the candidate list holds only cases this desk may open: an unscoped
   * list would describe records in other districts, and police-only ones to
   * every desk.
   */
  function reviewerSightingView(f, reportsById, user = null) {
    const matched = f.matchedReportId ? reportsById[f.matchedReportId] : null;
    const candidates = (Array.isArray(f.matchCandidates) ? f.matchCandidates : [])
      .filter((c) => c && reportsById[c.reportId])
      .map((c) => ({ ...c, report: caseForReview(reportsById[c.reportId], f, user) }));
    return {
      ...f,
      // The cases an officer turned down, only those this desk may open.
      rejectedLinks: (Array.isArray(f.rejectedLinks) ? f.rejectedLinks : []).filter((l) => l && reportsById[l.reportId]),
      personCategory: personCategoryOf(f),
      // Where the person was seen. The card shows this, never the sighting's
      // own state and district, which a match sets to the case's.
      reportedLocation: reportedLocationOf(f),
      reporterName: publicReporterName(f),
      reporterPhone: f.confidentialReporter ? null : f.reporterPhone || null,
      reporterPhoneVisible: f.confidentialReporter ? null : f.reporterPhone || null,
      matchCandidates: candidates,
      matchedReport: matched ? caseForReview(matched, f, user) : null,
      // Reported outside the matched case's district: its officers may ask the
      // police there to help (POST /found/:id/local-police).
      seenOutsideCaseDistrict: matched ? seenOutsideCaseDistrict(f, matched) : false,
    };
  }

  /** The same view for one sighting, or null when this desk can no longer see it. */
  function reviewerSightingFor(user, f) {
    if (!f || scopeFoundReports(user, [f], listReports()).length !== 1) return null;
    const reportsById = Object.fromEntries(scopeReports(user, listReports()).map((r) => [r.id, r]));
    return reviewerSightingView(f, reportsById, user);
  }

  router.get('/found/all', protectedRoute, requireRole(...REVIEW_ROLES), (req, res) => {
    const scopedFound = scopeFoundReports(req.user, listFoundReports(), listReports());
    const reportsById = Object.fromEntries(scopeReports(req.user, listReports()).map((r) => [r.id, r]));
    res.json({
      foundReports: scopedFound.map((f) => reviewerSightingView(f, reportsById, req.user)),
    });
  });

  /**
   * An officer's decision on a sighting: confirm the match, reject it, or refer
   * the sighting to Childline/CWC.
   *
   * Confirming is for police and command roles only, and marks the case found.
   *
   * Rejecting a linked sighting says "not this person" about its current
   * candidate, not about the sighting: the candidate is marked rejected and
   * recorded in `rejectedLinks` (never proposed for this sighting again, in
   * either direction), and the sighting moves to the next candidate the
   * engines proposed - that case's police officers are alerted - or, when
   * none is left, back to where it belongs: the reporter's own district in the
   * no-match queue, or, for a link the reverse search made, the district,
   * status and referral it had before (`reverseMatch.previous`), so a CWC desk
   * that was following it up gets it back. Referring to Childline/CWC does the
   * same and ends in the CWC queue. A lookalike must not be able to take a
   * child-protection referral out of the CWC queue for good.
   *
   * The reporter's receipt does not change whichever way it is decided: its
   * stage depends only on time (publicSightingStatus).
   */
  router.post('/found/:id/review', protectedRoute, requireRole(...REVIEW_ROLES), async (req, res) => {
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

    // A linked sighting walks its candidate list (shared/sighting-matching.js).
    if (decision !== 'matched' && f.matchedReportId) {
      const unlinkedReportId = f.matchedReportId;
      const wasReverse = isReverseLinked(f);
      const { patch, next } = matcher.walkPatch(f, decision, req.user);
      updateFoundReport(f.id, { ...patch, ...reviewed });
      const after = findFoundReport(f.id);
      if (decision === 'refer_cwc') {
        addActivity({ actor: req.user.name, action: 'Referred sighting to 1098/CWC', target: f.foundLocation, icon: 'referral', actorId: req.user.id, scope: { state: after.state, district: after.district, matchedReportId: after.matchedReportId, foundReportId: f.id } });
      }
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: decision === 'refer_cwc' ? 'sighting.referred_cwc' : 'sighting.rejected',
        targetType: 'foundReport',
        targetId: f.id,
        summary: decision === 'refer_cwc'
          ? `Referred sighting ${f.id} to 1098/CWC`
          : next
            ? `Rejected the closest case for sighting ${f.id}; the next candidate is proposed`
            : wasReverse
              ? `Rejected the link between sighting ${f.id} and a newly registered case; the sighting is back where it was`
              : `Rejected the match for sighting ${f.id}; the sighting is back in its queue`,
        scope: { matchedReportId: unlinkedReportId },
        // Which case comes next is recorded on its own row below, scoped to
        // that case: this row is readable by the desks of the case rejected,
        // and the next may be one they may not open.
        metadata: {
          unlinkedReportId,
          direction: wasReverse ? 'reverse' : 'forward',
          ...(wasReverse && !next ? { reverseLinkUndone: true } : {}),
          advanced: Boolean(next),
          restoredStatus: after.status,
          noteLength: reviewNote ? reviewNote.length : 0,
        },
      });
      if (next) {
        addAudit({
          actorName: 'Khozo matching',
          actorRole: 'system',
          action: 'sighting.candidate_advanced',
          targetType: 'foundReport',
          targetId: f.id,
          summary: `Proposed the next candidate case for sighting ${f.id}`,
          scope: { matchedReportId: next.id, state: after.state, district: after.district },
          metadata: { reportId: next.id, matchScore: after.matchScore, decision },
        });
        matcher.alertCaseOfficers(after, next, `A sighting at ${sightingWhere(after)} may match a case.`);
      }
      // The sighting as this desk now sees it; null when it has moved to a
      // case this desk may not open.
      return res.json({ foundReport: reviewerSightingFor(req.user, after), advanced: Boolean(next) });
    }

    if (decision === 'refer_cwc') {
      updateFoundReport(f.id, {
        ...reviewed,
        status: 'referred_cwc',
        referredTo1098: true,
        referredCwcAt: reviewed.reviewedAt,
        referralStatus: 'Referred to Childline/CWC',
      });
      const after = findFoundReport(f.id);
      addActivity({ actor: req.user.name, action: 'Referred sighting to 1098/CWC', target: f.foundLocation, icon: 'referral', actorId: req.user.id, scope: { state: after.state, district: after.district, matchedReportId: after.matchedReportId, foundReportId: f.id } });
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.referred_cwc',
        targetType: 'foundReport',
        targetId: f.id,
        summary: `Referred sighting ${f.id} to 1098/CWC`,
        scope: { matchedReportId: f.matchedReportId },
        metadata: { noteLength: reviewNote ? reviewNote.length : 0 },
      });
      return res.json({ foundReport: after });
    }

    const reviewedStatus = decision === 'matched' ? 'matched' : 'rejected';
    updateFoundReport(f.id, {
      ...reviewed,
      ...(verification ? { verification } : {}),
      // The candidate the officer verified is recorded as confirmed.
      ...(decision === 'matched' && f.matchedReportId ? { matchCandidates: matcher.confirmedCandidates(f, req.user) } : {}),
      status: reviewedStatus,
      referralStatus: decision === 'matched' ? 'Police match confirmed' : 'Police rejected match',
    });
    if (decision === 'matched' && matchedCase) {
      const r = matchedCase;
      updateReport(f.matchedReportId, matchConfirmedPatch(r, req.user, {
        verification,
        foundLocation: f.foundLocation,
        matchScore: f.matchScore,
        foundReportId: f.id,
      }));
      // Found: no longer a face anyone is looking for.
      await matcher.unindexCase(findReport(r.id));
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
        summary: `Confirmed sighting match for case ${r.id} (${verification.methodLabel})`,
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
        summary: `Confirmed sighting ${f.id} (${verification.methodLabel})`,
        scope: { state: f.state, district: f.district },
        metadata: { matchScore: f.matchScore, verification, noteLength: reviewNote ? reviewNote.length : 0 },
      });
    } else {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.rejected',
        targetType: 'foundReport',
        targetId: f.id,
        summary: `Rejected sighting ${f.id}`,
        scope: { matchedReportId: f.matchedReportId },
        metadata: { noteLength: reviewNote ? reviewNote.length : 0 },
      });
    }
    if (decision === 'matched' && matchedCase) {
      // Confirming here sends nobody anything; the answer says so, as
      // confirm-match does, with the number to call when the family may be told.
      const adult = isAdultCase(matchedCase);
      return res.json({
        foundReport: findFoundReport(f.id),
        report: deskCaseView(req.user, findReport(matchedCase.id)),
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
      scope: { state: f.state, district: f.district, matchedReportId: f.matchedReportId, foundReportId: f.id },
    });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.cwc_followup_completed',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `CWC follow-up recorded for sighting ${f.id}: ${followup.label}`,
      scope: { state: f.state, district: f.district, matchedReportId: f.matchedReportId },
      metadata: { outcome, noteLength: cleanedNote.length },
    });
    res.json({ foundReport: findFoundReport(f.id) });
  });

  /**
   * Opens a formal record for a found child (or woman, or person) taken into
   * care. The sighting's photo is copied onto the new record, kept for the case
   * retention period rather than the sighting's, and screened for a face
   * (`photoCheck`): a missing case registered later is compared with it
   * (shared/match-pool.js selectSightingCandidates), so the child stays
   * findable after the sighting's own retention runs out.
   */
  router.post('/found/:id/formal-intake', protectedRoute, requireRole(...FOUND_INTAKE_ROLES), async (req, res) => {
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
    // The sighting's photo, copied: the intake keeps it as long as a case
    // record is kept, and the sighting's own copy goes with its retention.
    const sightingPhoto = f.photoFile && !f.anonymizedAt ? await readPhoto(f.photoFile) : null;
    const photo = sightingPhoto?.length
      ? await storePhoto(reportId, { buffer: sightingPhoto, mimetype: detectImageMime(sightingPhoto) || photoMimeType(f.photoFile) })
      : { photoUrl: null, photoFile: null };
    const photoCheck = photo.photoFile ? await matcher.checkCasePhoto(sightingPhoto) : null;
    // And its other photos that show one face (shared/photo-set.js), under the
    // same ids, so a match made on the copy names the sighting's photo. A
    // photo the reporter's screen never looked at is checked now; a group
    // photo or an empty one stays with the sighting and goes with it.
    const copiedExtras = [];
    for (const extra of photo.photoFile ? extraPhotosOf(f) : []) {
      if (isBadFacePhoto(extra)) continue;
      // eslint-disable-next-line no-await-in-loop
      const bytes = await Promise.resolve(readPhoto(extra.file)).catch(() => null);
      if (!bytes?.length) continue;
      // eslint-disable-next-line no-await-in-loop
      const check = extra.check?.verdict === 'usable' ? extra.check : await matcher.checkCasePhoto(bytes);
      if (check?.verdict !== 'usable') continue;
      // eslint-disable-next-line no-await-in-loop
      const copied = await storeExtraPhotos(reportId, [{ buffer: bytes, mimetype: detectImageMime(bytes) || photoMimeType(extra.file) }], req.user, [extra.id]);
      copiedExtras.push(...copied.entries.map((entry) => ({ ...entry, check })));
    }
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
      photoUrl: photo.photoUrl || f.photoUrl || null,
      photoFile: photo.photoFile,
      photoCopiedFrom: photo.photoFile ? f.id : null,
      photoCheck,
      extraPhotos: copiedExtras,
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
    // A child found alone and taken into care is exactly who an AHTU looks
    // for: assessed like any case, and a high level alerts the desk.
    report.traffickingRisk = riskFor(report);
    addReport(report);
    updateFoundReport(f.id, {
      status: 'formalized_case',
      formalReportId: report.id,
      referralStatus: 'Formal found-child case opened',
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
      summary: `Opened formal found-child intake as case ${reportId}`,
      scope: { state, district, reportId: report.id, foundReportId: f.id },
      metadata: {
        formalReportId: report.id,
        intakeAuthority,
        admissionDate: intakeRecord.admissionDate,
        nextReviewDate,
        noteLength: note.length,
        reporterConfidential: Boolean(f.confidentialReporter),
        photoCopied: Boolean(photo.photoFile),
        photoCheck: photoCheck?.verdict || null,
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
    alertTraffickingRisk(findReport(report.id), req.user);
    res.status(201).json({ foundReport: findFoundReport(f.id), report: deskCaseView(req.user, findReport(report.id)), careRecord: intakeRecord });
  });

  // ---- Searching again, placing a sighting, replacing a case photo ----------

  /**
   * Runs the forward search again for one sighting: its photo against the
   * open cases, as when it arrived (shared/sighting-matching.js
   * rematchSighting). For when the first search could not compare - a provider
   * was down, the budget was spent elsewhere, the settings have changed since -
   * and for an officer who wants to look again. The new candidates replace the
   * proposed ones; cases an officer rejected stay rejected. A search in which
   * no face was compared changes nothing but the record of the attempt.
   *
   * Police roles, for a sighting in their scope. The person who sent it is told
   * nothing. The answer carries the sighting only while this officer can still
   * see it: a sighting that now points at a case outside their jurisdiction
   * has moved to that case's officers.
   */
  router.post('/found/:id/rematch', protectedRoute, requireRole(...POLICE_ROLES), async (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    if (scopeFoundReports(req.user, [f], listReports()).length !== 1) {
      return res.status(403).json({ error: 'Found report is outside your jurisdiction' });
    }
    if (!f.photoFile) return res.status(409).json({ error: 'This sighting has no photo to compare' });
    if (f.anonymizedAt) return res.status(409).json({ error: 'Sightings whose details were removed are not compared with cases' });
    if (!isRematchEligible(f)) return res.status(409).json({ error: 'This sighting is closed and is not searched again' });

    const result = await matcher.rematchSighting(f, { trigger: 'rematch', actor: req.user });
    if (!result.ok) return res.status(result.conflict ? 409 : 422).json({ error: result.reason });
    const after = result.sighting;
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.rematched',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Searched the open cases again for sighting ${f.id}`,
      scope: { state: after.state, district: after.district, matchedReportId: after.matchedReportId || null },
      metadata: {
        trigger: 'rematch',
        provider: after.matchEngine?.provider || null,
        biometric: Boolean(after.matchEngine?.biometric),
        comparedAgainst: after.matchEngine?.comparedAgainst ?? 0,
        configHash: after.matchEngine?.configHash || null,
        linked: result.linked,
        // The photo's screen, when this search ran the one that never
        // answered when the sighting arrived.
        rescreened: result.rescreened || null,
      },
    });
    res.json({
      foundReport: reviewerSightingFor(req.user, findFoundReport(f.id)),
      engine: engineSummary(result.engine),
      linked: result.linked,
    });
  });

  /**
   * A place name as an officer typed it: trimmed, single-spaced, without a
   * trailing "District". Compared with others through sameDistrict
   * (shared/scope.js), which folds the known spellings together.
   *
   * TODO(jurisdiction): canonical state and district codes replace this once
   * the gazetteer lands; until then this is the same normalisation the
   * comparisons use, applied to what is stored.
   */
  function placeName(value) {
    return cleanText(value, 80).replace(/\s+/g, ' ').replace(/\s+district$/i, '').trim();
  }

  /** Who may place a sighting: the national desk, state desks and police. */
  const PLACEMENT_ROLES = [...new Set(['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau', ...POLICE_ROLES])];

  /**
   * Places a sighting the reporter gave no district for (or the wrong one):
   * sets its reported state and district, routes it to that district's desks,
   * and runs the forward search again from there, since the comparison budget
   * is spent on the sighting's own district first (shared/match-pool.js).
   *
   * The super admin may place a sighting anywhere; a state desk or a police
   * officer only within their own state, and only a sighting they can see. A
   * sighting linked to a case keeps the case's jurisdiction until an officer
   * decides the link; its reported place is what changes.
   */
  /**
   * Looks up the street address of a sighting's coordinates, for a sighting
   * sent before addresses were kept, and saves it. Any desk that can see the
   * sighting may ask; the answer is the same for everyone, so it is asked of
   * the geocoder once.
   */
  router.post('/found/:id/address', protectedRoute, requireRole(...REVIEW_ROLES), async (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    if (scopeFoundReports(req.user, [f], listReports()).length !== 1) {
      return res.status(403).json({ error: 'Found report is outside your jurisdiction' });
    }
    if (f.geoAddress) return res.json({ geoAddress: f.geoAddress });
    if (f.lat == null || f.lng == null || f.anonymizedAt) {
      return res.status(409).json({ error: 'This sighting has no location to look up' });
    }
    const resolved = await reverseGeocode(f.lat, f.lng, { fetchImpl });
    const geoAddress = resolved?.address || null;
    if (!geoAddress) return res.status(502).json({ error: 'The address could not be found. Open the location in Maps instead.' });
    // A sighting from before the reporter's place was kept apart from the
    // case's (reportedLocation), linked to a case, so that nothing on it says
    // where the person was seen: the coordinates say, and are kept now as
    // they would have been at intake. A place the reporter gave is never
    // replaced by one.
    const known = reportedLocationOf(f);
    const unplaced = !f.reportedLocation && !known.state && !known.district && Boolean(resolved.stateCode);
    const placed = unplaced
      ? {
          reportedLocation: {
            state: resolved.state,
            stateCode: resolved.stateCode,
            district: resolved.district || null,
            districtCode: resolved.districtCode || null,
            districtText: resolved.districtText || null,
          },
          locationSource: 'coordinates',
        }
      : {};
    updateFoundReport(f.id, { geoAddress, ...placed });
    if (unplaced) {
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.placed',
        targetType: 'foundReport',
        targetId: f.id,
        summary: `Placed sighting ${f.id} in ${[placed.reportedLocation.district || placed.reportedLocation.districtText, placed.reportedLocation.state].filter(Boolean).join(', ')} from its coordinates`,
        scope: { state: f.state || null, district: f.district || null, matchedReportId: f.matchedReportId || null },
        metadata: { from: known, to: placed.reportedLocation, source: 'coordinates' },
      });
    }
    res.json({ geoAddress, ...placed });
  });

  /**
   * An officer's own reading of a sighting photo — "no person in this photo",
   * or "there is a person" — recorded over the face screen's. A detector
   * that found a passer-by in the background of a photo of a signboard is
   * corrected by the person looking at it, and the correction is audited.
   * `verdict: null` withdraws it, and the screen's reading stands again.
   */
  router.post('/found/:id/screening', protectedRoute, requireRole(...REVIEW_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    if (scopeFoundReports(req.user, [f], listReports()).length !== 1) {
      return res.status(403).json({ error: 'Found report is outside your jurisdiction' });
    }
    if (!f.photoFile && !f.photoUrl) return res.status(409).json({ error: 'This sighting has no photo' });
    const verdict = req.body?.verdict ?? null;
    if (verdict !== null && verdict !== 'no_person' && verdict !== 'person') {
      return res.status(400).json({ error: 'Say whether the photo shows a person' });
    }
    const screening = { ...(f.screening || {}) };
    if (verdict) {
      screening.officer = { verdict, at: new Date().toISOString(), byId: req.user.id, byName: req.user.name, byRole: req.user.role };
    } else {
      delete screening.officer;
    }
    updateFoundReport(f.id, { screening });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: verdict ? 'sighting.screening_corrected' : 'sighting.screening_correction_withdrawn',
      targetType: 'foundReport',
      targetId: f.id,
      summary: verdict
        ? `Recorded that sighting ${f.id}'s photo ${verdict === 'no_person' ? 'shows no person' : 'shows a person'}`
        : `Withdrew the correction on sighting ${f.id}'s photo`,
      scope: { state: f.state || null, district: f.district || null, foundReportId: f.id },
      metadata: { verdict, engineVerdict: f.screening?.verdict || null },
    });
    res.json({ foundReport: reviewerSightingFor(req.user, findFoundReport(f.id)) });
  });

  router.post('/found/:id/place', protectedRoute, requireRole(...PLACEMENT_ROLES), async (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    if (scopeFoundReports(req.user, [f], listReports()).length !== 1) {
      return res.status(403).json({ error: 'Found report is outside your jurisdiction' });
    }
    const read = readFields(req.body, { state: ['text', 80], district: ['text', 80] });
    if (read.error) return res.status(400).json({ error: read.error });
    const state = placeName(read.body.state);
    const district = placeName(read.body.district);
    if (!state || !district) return res.status(400).json({ error: 'Give the state and the district the sighting belongs to' });
    if (req.user.role !== 'super_admin' && !sameState(state, req.user.jurisdiction?.state)) {
      return res.status(403).json({ error: 'You can place a sighting only in your own state' });
    }
    if (f.anonymizedAt || ['matched', 'rejected'].includes(f.status)) {
      return res.status(409).json({ error: 'A closed sighting cannot be placed' });
    }

    const previous = reportedLocationOf(f);
    const now = new Date().toISOString();
    updateFoundReport(f.id, {
      reportedLocation: { state, district },
      // A linked sighting is in the case's jurisdiction until the link is
      // decided; an unlinked one is where it was reported.
      ...(f.matchedReportId ? {} : { state, district }),
      // Where a rejected reverse link puts it back, too.
      ...(f.reverseMatch?.previous ? { reverseMatch: { ...f.reverseMatch, previous: { ...f.reverseMatch.previous, state, district } } } : {}),
      locationSource: 'officer',
      placement: {
        state,
        district,
        previous,
        at: now,
        byId: req.user.id,
        byName: req.user.name,
        byRole: req.user.role,
      },
    });
    const placed = findFoundReport(f.id);
    addActivity({ actor: req.user.name, action: 'Placed a sighting in a district', target: placed.foundLocation, icon: 'referral', actorId: req.user.id, scope: { state: placed.state, district: placed.district, matchedReportId: placed.matchedReportId, foundReportId: placed.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.placed',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Placed sighting ${f.id} in ${district}, ${state}`,
      scope: { state, district, matchedReportId: placed.matchedReportId || null },
      metadata: { from: previous, to: { state, district } },
    });

    // Routing: the desks of the district it now belongs to are told it is
    // theirs, as an unmatched sighting raises it (where and when, never who).
    if (!placed.matchedReportId) {
      const desks = listUsers().filter((u) =>
        REVIEW_ROLES.includes(u.role) &&
        u.id !== req.user.id &&
        sameState(u.jurisdiction?.state, state) &&
        sameDistrict(u.jurisdiction?.district, district)
      );
      if (desks.length) {
        const category = personCategoryOf(placed);
        notifyAuthorities({
          kind: 'sighting_reported',
          title: category === 'woman' ? 'Woman spotted' : category === 'adult' ? 'Person spotted' : 'Child spotted',
          body: `A sighting at ${placeText(placed.foundLocation, { state, district })} was placed in your district.`,
          priority: 'normal',
          recipients: desks,
          scope: { state, district, foundReportId: placed.id, matched: false },
        });
      }
    }

    // The search, from the sighting's new place.
    let search = null;
    if (placed.photoFile && isRematchEligible(placed)) {
      search = await matcher.rematchSighting(placed, { trigger: 'placed', actor: req.user });
    }
    res.json({
      foundReport: reviewerSightingFor(req.user, findFoundReport(f.id)),
      engine: search?.ok ? engineSummary(search.engine) : null,
      linked: Boolean(search?.linked),
    });
  });

  // ---- The police where the person was seen -----------------------------------
  //
  // A strong match files a sighting under the matched case's district, so a
  // child from an Ahmedabad case seen in Mumbai - or in Patna, or in Surat - is
  // reviewed by Ahmedabad's officers, who cannot go there. These routes let the
  // case's officers ask the police where the person was seen to help, and let
  // those police answer. The police asked see that one sighting (photo, place,
  // time, the note they were sent), never the case it may match: what is in
  // the case stays with the officers who own it (shared/scope.js,
  // canSeeLocalPoliceRequest).

  /**
   * Where a linked sighting was reported, when that is outside the matched
   * case's district: the place whose police can go there. Null when it is in
   * the case's own district (its officers are those police) or the reporter
   * gave no place at all.
   */
  function outOfAreaPlace(sighting, report) {
    if (!sighting || !report) return null;
    const place = placeFields(reportedLocationOf(sighting));
    const district = place.district || place.districtText || null;
    if (!place.state && !district) return null;
    if (sameDistrictPlace({ ...place, district }, report)) return null;
    return { ...place, district };
  }

  function placeLabel(place) {
    return [place?.district || place?.districtText, place?.state].filter(Boolean).join(', ') || 'an unrecorded place';
  }

  /** Police desks that can see the request, other than the case's own officers. */
  function localPoliceDesks(sighting, exclude = new Set()) {
    return listUsers().filter((u) => u.role !== 'super_admin' && !exclude.has(u.id) && canSeeLocalPoliceRequest(u, sighting));
  }

  /** What the police asked to help see: the sighting, never the case. */
  function localPoliceView(f) {
    const lp = f.localPolice || {};
    return {
      ...sightingOnlyView(f),
      localPolice: {
        requestedAt: lp.requestedAt,
        requestedByName: lp.requestedByName,
        requestedFrom: lp.requestedFrom,
        contactPhone: lp.contactPhone || null,
        note: lp.note || null,
        adult: Boolean(lp.adult),
        place: lp.place,
        replies: Array.isArray(lp.replies) ? lp.replies : [],
      },
    };
  }

  /**
   * A sighting as police outside its case see it: who, where, when, the
   * photo and the reporter's note, never the case it may match or how
   * closely.
   */
  function sightingOnlyView(f) {
    return {
      id: f.id,
      createdAt: f.createdAt,
      personCategory: personCategoryOf(f),
      ageApprox: f.ageApprox ?? null,
      gender: f.gender || null,
      foundLocation: f.foundLocation,
      geoAddress: f.geoAddress || null,
      lat: f.lat ?? null,
      lng: f.lng ?? null,
      reportedLocation: reportedLocationOf(f),
      note: f.note || null,
      concernReason: f.concernReason || null,
      reporterName: publicReporterName(f),
      reporterPhone: f.confidentialReporter ? null : f.reporterPhone || null,
      photoUrl: f.photoFile ? `/api/reports/photo/${f.id}` : null,
      extraPhotos: extraPhotosView(f),
    };
  }

  /**
   * The case's officers ask the police where the person was seen to help. The
   * police desks covering that place are alerted (where, when, who is asking
   * and how to reach them; never a name) and may open the sighting. With no
   * police desk for that place on Khozo yet, nobody is alerted and the answer
   * says so, so the officer phones the local police instead. Asking again
   * re-sends the alert, to desks added since as well.
   */
  router.post('/found/:id/local-police', protectedRoute, requireRole(...POLICE_ROLES), async (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    const matched = f.matchedReportId ? findReport(f.matchedReportId) : null;
    if (!matched || !canAccessReport(req.user, matched)) {
      return res.status(403).json({ error: 'Only the officers of the case this sighting may match can ask for help' });
    }
    if (f.anonymizedAt || ['matched', 'rejected'].includes(f.status)) {
      return res.status(409).json({ error: 'This sighting is closed' });
    }
    const place = outOfAreaPlace(f, matched);
    if (!place) {
      return res.status(409).json({ error: 'The sighting is in the case’s own district, or has no place recorded' });
    }
    const read = readFields(req.body, { note: ['text', 500], phone: ['text', 20] });
    if (read.error) return res.status(400).json({ error: read.error });
    const asker = listUsers().find((u) => u.id === req.user.id) || req.user;
    const contactPhone = cleanText(read.body.phone, 20) || asker.phone || null;
    const now = Date.now();
    const adult = isAdultCase(matched) || isAdultCategory(personCategoryOf(f));
    const previous = f.localPolice?.reportId === matched.id ? f.localPolice : null;
    updateFoundReport(f.id, {
      localPolice: {
        reportId: matched.id,
        place,
        requestedAt: now,
        firstRequestedAt: previous?.firstRequestedAt || previous?.requestedAt || now,
        requestedById: req.user.id,
        requestedByName: req.user.name,
        requestedByRole: req.user.role,
        requestedFrom: caseWhere(matched),
        contactPhone,
        note: cleanText(read.body.note, 500) || null,
        adult,
        replies: previous?.replies || [],
      },
    });
    const asked = findFoundReport(f.id);
    const officers = new Set(caseOfficers(matched).map((u) => u.id));
    const desks = localPoliceDesks(asked, officers);
    const category = personCategoryOf(asked);
    const who = category === 'woman' ? 'A woman' : category === 'adult' ? 'A person' : 'A child';
    const seen = placeText(asked.foundLocation, reportedLocationOf(asked));
    const care = adult
      ? 'If you find the person, ask whether they are safe and need help. They decide whether their family is told where they are.'
      : 'If you find the child, keep them safe and take them to the Child Welfare Committee.';
    const contact = `${req.user.name}${contactPhone ? `, ${contactPhone}` : ''}`;
    if (desks.length) {
      notifyAuthorities({
        kind: 'local_police_request',
        title: `Police in ${caseWhere(matched)} ask for your help`,
        body: `${who} seen at ${seen} may be the subject of a missing case held by police in ${caseWhere(matched)}. Please go to the place. ${care} Contact: ${contact}. Open the sighting in Khozo for the photo and the exact place.`,
        priority: 'high',
        recipients: desks,
        scope: { state: place.state || null, district: place.district || null, foundReportId: asked.id, localPolice: true },
      });
    }
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.local_police_requested',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Asked police in ${placeLabel(place)} to help with sighting ${f.id}`,
      scope: { state: matched.state, district: matched.district, matchedReportId: matched.id },
      metadata: { place: { state: place.state || null, district: place.district || null }, desksAlerted: desks.length, again: Boolean(previous) },
    });
    res.json({
      foundReport: reviewerSightingFor(req.user, asked),
      place: placeLabel(place),
      desksAlerted: desks.length,
    });
  });

  /** Sightings other police have asked this desk to help with. */
  router.get('/found/local-police', protectedRoute, requireRole(...POLICE_ROLES), (req, res) => {
    const requests = listFoundReports()
      .filter((f) => f.localPolice && canSeeLocalPoliceRequest(req.user, f))
      // A desk that owns the case reviews the sighting in its own queue.
      .filter((f) => {
        if (req.user.role === 'super_admin') return true;
        const matched = findReport(f.matchedReportId);
        return !matched || !canAccessReport(req.user, matched);
      })
      .sort((a, b) => (b.localPolice.requestedAt || 0) - (a.localPolice.requestedAt || 0))
      .map(localPoliceView);
    res.json({ requests });
  });

  const LOCAL_POLICE_OUTCOMES = {
    found: 'Found the person',
    not_found: 'Went to the place; the person was not there',
    update: 'Update',
  };

  /**
   * The police asked answer: found the person, not there, or an update. The
   * case's officers are told at once, and a find at high priority.
   */
  router.post('/found/:id/local-police/reply', protectedRoute, requireRole(...POLICE_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    if (!canSeeLocalPoliceRequest(req.user, f)) {
      return res.status(403).json({ error: 'No request for help on this sighting has reached your desk' });
    }
    const read = readFields(req.body, { outcome: ['text', 20], note: ['text', 500] });
    if (read.error) return res.status(400).json({ error: read.error });
    const outcome = read.body.outcome;
    if (!LOCAL_POLICE_OUTCOMES[outcome]) {
      return res.status(400).json({ error: 'Outcome must be found, not_found or update' });
    }
    const note = cleanText(read.body.note, 500) || null;
    if (outcome === 'update' && !note) return res.status(400).json({ error: 'Write the update' });
    const responder = listUsers().find((u) => u.id === req.user.id) || req.user;
    const desk = placeLabel(responder.jurisdiction || {});
    const reply = {
      at: Date.now(),
      byId: req.user.id,
      byName: req.user.name,
      byRole: req.user.role,
      byPhone: responder.phone || null,
      desk,
      outcome,
      note,
    };
    updateFoundReport(f.id, { localPolice: { ...f.localPolice, replies: [...(f.localPolice.replies || []), reply] } });
    const updated = findFoundReport(f.id);
    const matched = findReport(f.matchedReportId);
    if (matched) {
      const officers = caseOfficers(matched).filter((u) => u.id !== req.user.id);
      if (officers.length) {
        notifyAuthorities({
          kind: 'local_police_reply',
          title: outcome === 'found' ? `Police in ${desk} found the person` : `Reply from police in ${desk}`,
          body: `${LOCAL_POLICE_OUTCOMES[outcome]}${note ? `: ${note}` : '.'} (${req.user.name}${reply.byPhone ? `, ${reply.byPhone}` : ''}). Sighting at ${placeText(updated.foundLocation, reportedLocationOf(updated))}.`,
          priority: outcome === 'found' ? 'high' : 'normal',
          recipients: officers,
          scope: { state: matched.state, district: matched.district, foundReportId: f.id, matched: true },
        });
      }
    }
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.local_police_replied',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Police in ${desk} replied on sighting ${f.id}: ${LOCAL_POLICE_OUTCOMES[outcome]}`,
      scope: { state: matched?.state || null, district: matched?.district || null, matchedReportId: f.matchedReportId },
      metadata: { outcome },
    });
    res.json({ request: localPoliceView(updated) });
  });

  // --- The station a sighting was sent to ------------------------------------
  //
  // Every sighting that raises an alert is sent to the nearest station desk
  // and the station whose poster code was scanned (raiseStationAlert,
  // shared/station-alerts.js); if nobody answers, to the control room. Those
  // desks see the sighting, never the case it may match, and answer: "On it",
  // found, not there, or an update.

  /** What a station sees of a sighting it was sent. */
  function stationAlertView(f, user) {
    const alert = f.stationAlert || {};
    const desks = Array.isArray(alert.desks) ? alert.desks : [];
    const mine = desks.find((d) => d.userId === user.id) || null;
    const matched = f.matchedReportId ? findReport(f.matchedReportId) : null;
    return {
      ...sightingOnlyView(f),
      status: stationAlertOpen(f) ? 'open' : 'closed',
      stationAlert: {
        sentAt: alert.sentAt || null,
        reason: mine?.reason || (alert.escalation?.userIds?.includes(user.id) ? 'escalated' : null),
        distanceKm: mine?.distanceKm ?? null,
        station: mine?.station || null,
        posterCode: alert.posterCode || null,
        stations: desks.map((d) => ({ station: d.station, reason: d.reason, distanceKm: d.distanceKm ?? null })),
        ack: alert.ack || null,
        replies: Array.isArray(alert.replies) ? alert.replies : [],
        escalatedAt: alert.escalation?.at || null,
        // How to treat the person if found: an adult decides whether their
        // family is told, whatever age they went missing at.
        adult: isAdultCategory(personCategoryOf(f)) || Boolean(matched && isAdultCase(matched)),
      },
    };
  }

  /** Sightings sent to this desk as its station, or as the control room, newest first. */
  router.get('/found/station-alerts', protectedRoute, requireRole(...POLICE_ROLES), (req, res) => {
    const since = Date.now() - 30 * DAY;
    const alerts = listFoundReports()
      .filter((f) => stationAlertSentTo(req.user, f) && Number(f.stationAlert.sentAt || 0) >= since)
      .sort((a, b) => (b.stationAlert.sentAt || 0) - (a.stationAlert.sentAt || 0))
      .slice(0, 50)
      .map((f) => stationAlertView(f, req.user));
    res.json({ alerts });
  });

  /**
   * A station answers: "On it", found, not there, or an update. The first
   * answer stops the escalation. Everyone else told about the sighting hears
   * it, and so do the officers of a case it may match.
   */
  router.post('/found/:id/station-alert/reply', protectedRoute, requireRole(...POLICE_ROLES), (req, res) => {
    const f = findFoundReport(req.params.id);
    if (!f) return res.status(404).json({ error: 'Found report not found' });
    if (!canSeeStationAlert(req.user, f)) {
      return res.status(403).json({ error: 'This sighting was not sent to your station' });
    }
    const read = readFields(req.body, { outcome: ['text', 20], note: ['text', 500] });
    if (read.error) return res.status(400).json({ error: read.error });
    const outcome = read.body.outcome;
    if (!STATION_OUTCOMES[outcome]) {
      return res.status(400).json({ error: 'Outcome must be on_it, found, not_found or update' });
    }
    const note = cleanText(read.body.note, 500) || null;
    if (outcome === 'update' && !note) return res.status(400).json({ error: 'Write the update' });
    if (outcome === 'on_it' && !stationAlertOpen(f)) return res.status(409).json({ error: 'This sighting is closed' });
    const responder = listUsers().find((u) => u.id === req.user.id) || req.user;
    const desk = responder.jurisdiction?.station ? stationName(responder) : placeLabel(responder.jurisdiction || {});
    const reply = {
      at: Date.now(),
      byId: req.user.id,
      byName: req.user.name,
      byRole: req.user.role,
      byPhone: responder.alertPhone || responder.phone || null,
      desk,
      outcome,
      note,
    };
    const alert = f.stationAlert;
    updateFoundReport(f.id, {
      stationAlert: { ...alert, replies: [...(alert.replies || []), reply], ack: alert.ack || reply },
    });
    const updated = findFoundReport(f.id);
    const said = `${STATION_OUTCOMES[outcome]}${note ? `: ${note}` : '.'} (${req.user.name}, ${desk}${reply.byPhone ? `, ${reply.byPhone}` : ''})`;
    const toldIds = new Set([
      ...(alert.desks || []).map((d) => d.userId),
      ...(alert.escalation?.userIds || []),
    ]);
    toldIds.delete(req.user.id);
    const told = listUsers().filter((u) => toldIds.has(u.id));
    if (told.length) {
      notifyAuthorities({
        kind: 'station_alert_reply',
        title: outcome === 'found' ? `${desk} found the person` : `${desk}: ${STATION_OUTCOMES[outcome]}`,
        body: `${said}. Sighting near ${placeText(updated.foundLocation, reportedLocationOf(updated))}.`,
        priority: outcome === 'found' ? 'high' : 'normal',
        recipients: told,
        scope: { foundReportId: f.id, stationAlert: true },
      });
    }
    const matched = f.matchedReportId ? findReport(f.matchedReportId) : null;
    if (matched && outcome !== 'on_it') {
      const officers = caseOfficers(matched).filter((u) => u.id !== req.user.id && !toldIds.has(u.id));
      if (officers.length) {
        notifyAuthorities({
          kind: 'station_alert_reply',
          title: outcome === 'found' ? `Police at ${desk} found the person` : `Reply from police at ${desk}`,
          body: `${said}. Sighting at ${placeText(updated.foundLocation, reportedLocationOf(updated))}.`,
          priority: outcome === 'found' ? 'high' : 'normal',
          recipients: officers,
          scope: { state: matched.state, district: matched.district, foundReportId: f.id, matched: true },
        });
      }
    }
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.station_replied',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `${desk} answered sighting ${f.id}: ${STATION_OUTCOMES[outcome]}`,
      scope: { state: f.state || null, district: f.district || null, matchedReportId: f.matchedReportId || null, foundReportId: f.id },
      metadata: { outcome, first: !alert.ack, minutesAfterAlert: alert.sentAt ? Math.round((reply.at - alert.sentAt) / 60000) : null },
    });
    res.json({ alert: stationAlertView(updated, req.user) });
  });

  /**
   * "Not a concern": a sighting of someone who is not missing and not in need,
   * such as a stranger photographed in the street, is closed and its photo
   * deleted at once, instead of being kept for 180 days and compared with
   * every case registered meanwhile. The record keeps only what anonymisation
   * keeps (shared/privacy.js), the audit log says who decided and why, and the
   * public receipt is unchanged (its stage depends only on time).
   *
   * "Misuse" says the photo was not taken to help anyone: counted in the MIS
   * report and raised in the public-abuse queue for the command desks.
   *
   * Not for a sighting whose possible match is still to be decided (decide
   * that first), a confirmed one, or one a found-person case was opened from.
   */
  router.post('/found/:id/dismiss', protectedRoute, requireRole(...REVIEW_ROLES), async (req, res) => {
    const read = readFields(req.body, { reason: ['text', 20] });
    if (read.error) return res.status(400).json({ error: read.error });
    const reason = dismissalReasonOf(read.body.reason);
    if (!reason) return res.status(400).json({ error: 'Say whether the sighting is not a concern or misuse' });
    const f = findFoundReport(req.params.id);
    if (!f || scopeFoundReports(req.user, [f], listReports()).length !== 1) {
      return res.status(404).json({ error: 'Found report not found' });
    }
    if (f.anonymizedAt) return res.status(409).json({ error: 'This sighting is already closed and its details removed' });
    if (f.status === 'pending_review') return res.status(409).json({ error: 'Decide on the possible match first' });
    if (f.status === 'matched' || f.formalReportId) {
      return res.status(409).json({ error: 'This sighting is part of a case and cannot be dismissed' });
    }
    updateFoundReport(f.id, {
      status: 'dismissed',
      referralStatus: reason === 'misuse' ? 'Dismissed as misuse' : 'Dismissed: not a concern',
    });
    await anonymiseSighting(
      { updateFoundReport, deletePhoto, rewriteActivity: deps.rewriteActivity },
      findFoundReport(f.id),
      { approval: dismissalApproval(reason) }
    );
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: reason === 'misuse' ? 'sighting.dismissed_misuse' : 'sighting.dismissed',
      targetType: 'foundReport',
      targetId: f.id,
      summary: reason === 'misuse'
        ? `Dismissed sighting ${f.id} as misuse; its photo was deleted`
        : `Closed sighting ${f.id} as not a concern; its photo was deleted`,
      scope: { state: f.state || null, district: f.district || null },
      // Nothing that names a place or a person: the audit log is permanent.
      metadata: { reason, personCategory: personCategoryOf(f), hadPhoto: Boolean(f.photoFile) },
    });
    res.json({ foundReport: reviewerSightingFor(req.user, findFoundReport(f.id)) });
  });

  /**
   * Replaces a case's photo: the one on file has no face in it, is a group
   * photo, or a better one has come in. The new photo is screened for a face
   * (`photoCheck`), replaces the old one in the one-to-many index, and is
   * compared with the stored sightings (the reverse search) as a newly
   * registered case's would be. Audited.
   *
   * Police roles, for a case in their scope. Registration never refuses a
   * photo for being unusable; this is how it is put right.
   */
  router.post('/:id/photo', protectedRoute, requireRole(...POLICE_ROLES), upload.single('photo'), withoutPhotoMetadata, async (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
    if (r.anonymizedAt) return res.status(409).json({ error: 'A case whose details were removed cannot be given a new photo' });
    const read = readFields(req.body, { photoConsent: 'flag' });
    if (read.error) return res.status(400).json({ error: read.error });
    if (!req.file) return res.status(400).json({ error: 'Attach the new photo' });
    const imageError = validateImageFile(req.file, isAdultCase(r) ? 'Photo' : 'Child photo');
    if (imageError) return res.status(400).json({ error: imageError });
    if (!r.photoConsent && r.photoBasis !== 'department_register' && !isTruthy(read.body.photoConsent)) {
      return res.status(400).json({ error: 'Photo consent is required before uploading a child image' });
    }

    const previous = { photoFile: r.photoFile || null, photoCheck: r.photoCheck || null };
    // A new key each time, so no cache - the browser's or a CDN's - can go on
    // showing the old face under the case.
    const version = Date.now().toString(36);
    const photoFile = await savePhoto(`${r.id}-${version}`, req.file.buffer, storedImageMime(req.file));
    if (!photoFile) return res.status(500).json({ error: 'The photo could not be stored. Try again.' });
    const photoCheck = await matcher.checkCasePhoto(req.file.buffer);
    const now = new Date().toISOString();
    updateReport(r.id, {
      photoFile,
      photoUrl: `/api/reports/photo/${r.id}?v=${version}`,
      // A department's register photo replaced without a consent ticked
      // stays a register photo: nobody gave consent (DPIA G15).
      ...(r.photoConsent || isTruthy(read.body.photoConsent) ? { photoConsent: true } : {}),
      ...(!r.photoBasis && isTruthy(read.body.photoConsent) ? { photoBasis: 'consent' } : {}),
      photoCheck,
      photoReplacedAt: now,
      photoAddedById: req.user.id,
      photoReplacedById: req.user.id,
      photoHistory: [
        ...(Array.isArray(r.photoHistory) ? r.photoHistory : []),
        { replacedAt: now, byId: req.user.id, byRole: req.user.role, previousVerdict: previous.photoCheck?.verdict || null },
      ],
    });
    if (previous.photoFile && previous.photoFile !== photoFile && typeof deletePhoto === 'function') {
      await Promise.resolve(deletePhoto(previous.photoFile)).catch(() => {});
    }
    // A score worked out on the old main photo is no longer about the photo
    // shown as main.
    if (previous.photoFile) await renameCasePhotos(r.id, { [MAIN_PHOTO]: null });
    const updated = findReport(r.id);
    // The index holds the new face, not the old one.
    if (isForwardPoolCase(updated)) await matcher.indexCase(updated, req.file.buffer);
    const searchable = !['found', 'closed'].includes(updated.status) && !isPendingCitizenIntake(updated) && !isFoundChildIntake(updated);
    const reverse = searchable
      // Led by the photo that shows one face (leadPhotoOf): the new main
      // photo, unless its check found none or a group and another one has.
      ? await matcher.matchStoredSightings(updated, { trigger: 'photo_replaced', actor: req.user, photo: leadPhotoOf(updated)?.id === MAIN_PHOTO ? req.file.buffer : null })
      : { sightingMatches: 0, engine: null };
    addActivity({ actor: req.user.name, action: 'Replaced the case photo', target: r.childName, icon: 'upload', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.photo_replaced',
      targetType: 'report',
      targetId: r.id,
      summary: `Replaced the photo of case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        photoCheck: photoCheck.verdict,
        faces: photoCheck.faces,
        previousPhotoCheck: previous.photoCheck?.verdict || null,
        sightingMatches: reverse.sightingMatches,
        provider: reverse.engine?.provider || null,
      },
    });
    res.json({ report: deskCaseView(req.user, findReport(r.id)), photoCheck, sightingMatches: reverse.sightingMatches, engine: reverse.engine || null });
  });

  /**
   * Keeps the photo pairs stored on sightings (photoPair, matchedPhotoPair:
   * which photo of each a score was worked out on) pointing at the right
   * photos after a case's photos change. `rename` maps a case photo id to its
   * new id - the main photo became an extra, an extra the main one - or to
   * null when that photo is gone, so the console says so instead of showing
   * another photo as the one that matched.
   */
  async function renameCasePhotos(reportId, rename) {
    const renames = (id) => Object.prototype.hasOwnProperty.call(rename, id);
    // A match recorded before pairs were kept was scored on the main photos.
    const pairOf = (pair) => (pair && typeof pair === 'object' ? pair : { sighting: MAIN_PHOTO, case: MAIN_PHOTO });
    const fix = (pair) => (renames(pairOf(pair).case) ? { ...pairOf(pair), case: rename[pairOf(pair).case] } : pair);
    const patchOf = (f) => {
      const candidates = Array.isArray(f?.matchCandidates) ? f.matchCandidates : [];
      const patch = {};
      if (candidates.some((c) => c?.reportId === reportId && renames(pairOf(c.photoPair).case))) {
        patch.matchCandidates = candidates.map((c) => (c?.reportId === reportId ? { ...c, photoPair: fix(c.photoPair) } : c));
      }
      if (f?.matchedReportId === reportId && renames(pairOf(f.matchedPhotoPair).case)) patch.matchedPhotoPair = fix(f.matchedPhotoPair);
      return Object.keys(patch).length ? patch : null;
    };
    for (const f of listFoundReports()) {
      if (!patchOf(f)) continue;
      // Written on the row as it is now, not this request's copy of it: an
      // officer's decision or an anonymisation made meanwhile stands.
      if (typeof claimFoundReport === 'function') {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve(claimFoundReport(f.id, (row) => patchOf(row) || {}, (row) => Boolean(row) && !row.anonymizedAt)).catch(() => null);
      } else {
        const current = findFoundReport(f.id);
        const patch = current && !current.anonymizedAt ? patchOf(current) : null;
        if (patch) updateFoundReport(f.id, patch);
      }
    }
  }

  /**
   * Writes a change to a case's photos on the case as it is now: on the
   * Worker a compare-and-set on its row (claimReport) - its store is a copy
   * read when the request began, and a change another officer made meanwhile
   * would otherwise be written over; here, the live record. Returns the case
   * as written, or null when the change no longer fits it (the caller says so).
   */
  async function writeCasePhotos(id, makePatch, isEligible) {
    if (typeof claimReport === 'function') return claimReport(id, makePatch, isEligible);
    const current = findReport(id);
    if (!current || !isEligible(current)) return null;
    updateReport(id, makePatch(current));
    return findReport(id);
  }

  const PHOTOS_CHANGED = 'The photos of this case changed while you were working on them. Open the case again and try again.';

  /**
   * The checks every change to a case's photo set shares: the case exists, is
   * in this officer's scope and not anonymised. Returns the case, or sends the
   * refusal and returns null.
   */
  function photoSetCase(req, res) {
    const r = findReport(req.params.id);
    if (!r) {
      res.status(404).json({ error: 'Report not found' });
      return null;
    }
    if (!canAccessReport(req.user, r)) {
      res.status(403).json({ error: 'This report is outside your area' });
      return null;
    }
    if (r.anonymizedAt) {
      res.status(409).json({ error: 'A case whose details were removed cannot be given a new photo' });
      return null;
    }
    return r;
  }

  /**
   * Adds photos of the person to a case - the family brought more, or older
   * and newer ones - up to MAX_CASE_PHOTOS in all (shared/photo-set.js). With
   * no main photo yet, the first becomes it. Each is screened for a face on
   * its own, the face search gallery is given the whole set, and the stored
   * sightings are searched again with the clearest new photo (one search,
   * not one per photo: each is paid). Audited.
   *
   * Police roles, for a case in their scope, under the consent rule the
   * replace route uses.
   */
  router.post('/:id/photos', protectedRoute, requireRole(...POLICE_ROLES), upload.single('photo'), withoutPhotoMetadata, async (req, res) => {
    const r = photoSetCase(req, res);
    if (!r) return;
    const read = readFields(req.body, { photoConsent: 'flag' });
    if (read.error) return res.status(400).json({ error: read.error });
    const files = [req.file, ...(Array.isArray(req.extraFiles) ? req.extraFiles : [])].filter((f) => f?.buffer?.length);
    if (!files.length) return res.status(400).json({ error: 'Attach at least one photo' });
    const room = MAX_CASE_PHOTOS - photoCountOf(r);
    if (files.length > room) {
      return res.status(400).json({
        error: room > 0
          ? `This case can take ${room} more photo(s): a case holds at most ${MAX_CASE_PHOTOS}.`
          : `This case already holds ${MAX_CASE_PHOTOS} photos. Remove one first.`,
      });
    }
    for (const file of files) {
      const imageError = validateImageFile(file, isAdultCase(r) ? 'Photo' : 'Child photo');
      if (imageError) return res.status(imageError === PHOTO_TOO_LARGE ? 413 : 400).json({ error: imageError });
    }
    if (!r.photoConsent && r.photoBasis !== 'department_register' && !isTruthy(read.body.photoConsent)) {
      return res.status(400).json({ error: 'Photo consent is required before uploading a child image' });
    }

    const patch = {};
    let mainFile = null;
    if (!r.photoFile) {
      // The first photo a case without one is given becomes its main photo.
      mainFile = files.shift();
      const version = Date.now().toString(36);
      const photoFile = await savePhoto(`${r.id}-${version}`, mainFile.buffer, storedImageMime(mainFile));
      if (!photoFile) return res.status(500).json({ error: 'The photo could not be stored. Try again.' });
      Object.assign(patch, {
        photoFile,
        photoUrl: `/api/reports/photo/${r.id}?v=${version}`,
        photoCheck: await matcher.checkCasePhoto(mainFile.buffer),
        photoAddedById: req.user.id,
      });
    }
    const stored = await storeExtraPhotos(r.id, files, req.user);
    if (files.length && !stored.entries.length && !mainFile) return res.status(500).json({ error: 'The photos could not be stored. Try again.' });
    const added = await checkExtraPhotos(stored.entries, stored.buffers);
    // Written on the case as it is now: the checks above take seconds, and
    // another officer may have changed its photos meanwhile.
    const fits = (row) => Boolean(row) && !row.anonymizedAt && !(mainFile && row.photoFile)
      && photoCountOf(row) + (mainFile && !row.photoFile ? 1 : 0) + added.length <= MAX_CASE_PHOTOS;
    const written = await writeCasePhotos(r.id, (row) => ({
      ...patch,
      // A photo from a department's register was not given with anyone's
      // consent, and adding to it does not say it was (DPIA G15).
      ...(row.photoConsent || isTruthy(read.body.photoConsent) ? { photoConsent: true } : {}),
      ...(!row.photoBasis && isTruthy(read.body.photoConsent) ? { photoBasis: 'consent' } : {}),
      extraPhotos: [...extraPhotosOf(row), ...added],
    }), fits);
    if (!written) {
      if (typeof deletePhoto === 'function') {
        for (const file of [patch.photoFile, ...added.map((a) => a.file)].filter(Boolean)) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve(deletePhoto(file)).catch(() => {});
        }
      }
      return res.status(409).json({ error: PHOTOS_CHANGED });
    }
    const updated = findReport(r.id);
    if (isForwardPoolCase(updated)) await matcher.indexCase(updated, { ...(mainFile ? { main: mainFile.buffer } : {}), ...stored.buffers });
    // One reverse search, with the clearest of the new photos.
    const newPhotos = [
      ...(mainFile ? [{ id: 'main', buffer: mainFile.buffer, check: patch.photoCheck }] : []),
      ...added.map((entry) => ({ id: entry.id, buffer: stored.buffers[entry.id], check: entry.check })),
    ].filter((p) => p.buffer);
    // Only a photo that shows one face is worth a search: each comparison is paid.
    const probe = newPhotos.find((p) => p.check?.verdict === 'usable');
    const searchable = probe && !['found', 'closed'].includes(updated.status) && !isPendingCitizenIntake(updated) && !isFoundChildIntake(updated);
    const reverse = searchable
      ? await matcher.matchStoredSightings(updated, { trigger: 'photo_added', actor: req.user, photo: probe.buffer, photoId: probe.id })
      : { sightingMatches: 0, engine: null, notSearched: true };
    const count = added.length + (mainFile ? 1 : 0);
    addActivity({ actor: req.user.name, action: count === 1 ? 'Added a photo to the case' : `Added ${count} photos to the case`, target: r.childName, icon: 'upload', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.photos_added',
      targetType: 'report',
      targetId: r.id,
      summary: `Added ${count} photo(s) to case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: {
        added: count,
        becameMain: Boolean(mainFile),
        photoChecks: [patch.photoCheck?.verdict, ...added.map((a) => a.check?.verdict || null)].filter((v) => v !== undefined),
        photoCount: photoCountOf(updated),
        sightingMatches: reverse.sightingMatches,
        provider: reverse.engine?.provider || null,
      },
    });
    res.status(201).json({
      report: deskCaseView(req.user, findReport(r.id)),
      added: added.map((a) => ({ id: a.id, url: a.url, check: a.check })),
      mainPhotoCheck: patch.photoCheck || null,
      // False when no new photo shows one clear face, so no search was run.
      searched: !reverse.notSearched,
      sightingMatches: reverse.sightingMatches,
      engine: reverse.engine || null,
    });
  });

  /**
   * Removes one extra photo from a case: the wrong person, or a duplicate. The
   * file is deleted and the face search gallery is given the set that is
   * left. The main photo is replaced, not removed (POST /:id/photo). Audited.
   */
  router.delete('/:id/photos/:photoId', protectedRoute, requireRole(...POLICE_ROLES), async (req, res) => {
    const r = photoSetCase(req, res);
    if (!r) return;
    const extras = extraPhotosOf(r);
    const target = extras.find((p) => p.id === req.params.photoId);
    if (!target) return res.status(404).json({ error: 'Photo not found on this case' });
    // Whether the gallery may hold this photo's face: it was enrolled, or an
    // enrolment since failed and left whatever it held before.
    const inGallery = ['enrolled', 'failed'].includes(r.faceIndex?.status);
    const written = await writeCasePhotos(
      r.id,
      (row) => ({ extraPhotos: extraPhotosOf(row).filter((p) => p.id !== target.id) }),
      (row) => Boolean(row) && !row.anonymizedAt && extraPhotosOf(row).some((p) => p.id === target.id),
    );
    if (!written) return res.status(409).json({ error: PHOTOS_CHANGED });
    if (typeof deletePhoto === 'function') await Promise.resolve(deletePhoto(target.file)).catch(() => {});
    await renameCasePhotos(r.id, { [target.id]: null });
    // The removed face leaves the gallery before the rest go back in: if
    // enrolling the rest failed, the gallery would otherwise keep it - the
    // wrong person's face, matched as this case's.
    if (inGallery) await matcher.unindexCase(findReport(r.id));
    const updated = findReport(r.id);
    if (isForwardPoolCase(updated)) await matcher.indexCase(updated);
    addActivity({ actor: req.user.name, action: 'Removed a photo from the case', target: r.childName, icon: 'upload', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.photo_removed',
      targetType: 'report',
      targetId: r.id,
      summary: `Removed a photo from case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { photoId: target.id, photoCheck: target.check?.verdict || null, photoCount: photoCountOf(updated) },
    });
    res.json({ report: deskCaseView(req.user, updated) });
  });

  /**
   * Makes one of the extra photos the case's main photo - the one shown on
   * the case and compared first with every sighting - and keeps the old main
   * photo as an extra. Nothing is deleted or searched again: the set of faces
   * is the same. Audited.
   */
  router.post('/:id/photos/:photoId/main', protectedRoute, requireRole(...POLICE_ROLES), async (req, res) => {
    const r = photoSetCase(req, res);
    if (!r) return;
    const extras = extraPhotosOf(r);
    const target = extras.find((p) => p.id === req.params.photoId);
    if (!target) return res.status(404).json({ error: 'Photo not found on this case' });
    const now = new Date().toISOString();
    const formerId = `p_${nanoid(8)}`;
    // A new URL, so no cache goes on showing the old main photo.
    const version = Date.now().toString(36);
    let hadMain = Boolean(r.photoFile);
    const written = await writeCasePhotos(r.id, (row) => {
      const rowExtras = extraPhotosOf(row);
      const chosen = rowExtras.find((p) => p.id === target.id);
      hadMain = Boolean(row.photoFile);
      // The old main photo keeps who gave it (a record from before this was
      // kept: the registrant, unless the police replaced it).
      const formerGiver = row.photoAddedById !== undefined ? row.photoAddedById : row.photoReplacedById || row.registeredById || null;
      const former = row.photoFile
        ? [{ id: formerId, file: row.photoFile, url: extraPhotoUrl(row.id, formerId), check: row.photoCheck || null, addedAt: now, addedById: formerGiver, addedByRole: null }]
        : [];
      // The gallery's record of which photo is which follows the new ids.
      const renameId = (id) => (id === MAIN_PHOTO ? (former.length ? formerId : null) : id === chosen.id ? MAIN_PHOTO : id);
      return {
        photoFile: chosen.file,
        photoUrl: `/api/reports/photo/${row.id}?v=${version}`,
        photoCheck: chosen.check || null,
        photoAddedById: chosen.addedById || null,
        extraPhotos: [...former, ...rowExtras.filter((p) => p.id !== chosen.id)],
        ...(row.faceIndex && Array.isArray(row.faceIndex.photos)
          ? { faceIndex: { ...row.faceIndex, photos: row.faceIndex.photos.map((p) => ({ ...p, photoId: renameId(p?.photoId) })) } }
          : {}),
      };
    }, (row) => Boolean(row) && !row.anonymizedAt && extraPhotosOf(row).some((p) => p.id === target.id));
    if (!written) return res.status(409).json({ error: PHOTOS_CHANGED });
    await renameCasePhotos(r.id, { [MAIN_PHOTO]: hadMain ? formerId : null, [target.id]: MAIN_PHOTO });
    const updated = findReport(r.id);
    addActivity({ actor: req.user.name, action: 'Chose the main photo of the case', target: r.childName, icon: 'upload', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'case.main_photo_changed',
      targetType: 'report',
      targetId: r.id,
      summary: `Chose a new main photo for case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { photoId: target.id, photoCheck: target.check?.verdict || null, previousPhotoCheck: r.photoCheck?.verdict || null },
    });
    res.json({ report: deskCaseView(req.user, updated) });
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
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before match confirmation' });
    const read = readFields(req.body, {
      foundLocation: ['text', 180],
      matchScore: 'number',
      sendSms: 'flag',
      personConsent: 'flag',
      // The sighting this confirms, when there is one. It must be linked to
      // this case; the rescue alert is then sent for where it was seen.
      foundReportId: ['text', 60],
    });
    if (read.error) return res.status(400).json({ error: read.error });
    const verification = parseVerification(req.body?.verification, req.user);
    if (!verification) return res.status(400).json({ error: VERIFICATION_REQUIRED });
    const b = read.body;
    let sightingToConfirm = null;
    if (b.foundReportId) {
      sightingToConfirm = findFoundReport(b.foundReportId);
      if (!sightingToConfirm || sightingToConfirm.matchedReportId !== r.id || !['pending_review', 'matched'].includes(sightingToConfirm.status)) {
        return res.status(409).json({ error: 'That sighting is not linked to this case' });
      }
    }
    const foundLocation = b.foundLocation || '';
    const consent = req.body?.personConsent === true;
    const adult = isAdultCase(r);
    const familyMayBeTold = !adult || consent;
    const wantsSms = isTruthy(b.sendSms);

    updateReport(r.id, matchConfirmedPatch(r, req.user, {
      verification,
      foundLocation: foundLocation || sightingToConfirm?.foundLocation || r.foundLocation || 'Reported location',
      matchScore: b.matchScore != null && b.matchScore !== '' ? Number(b.matchScore) : sightingToConfirm?.matchScore ?? r.matchScore,
      foundReportId: sightingToConfirm?.id || null,
    }));
    if (sightingToConfirm?.status === 'pending_review') {
      updateFoundReport(sightingToConfirm.id, {
        reviewDecision: 'matched',
        reviewedAt: new Date().toISOString(),
        reviewedById: req.user.id,
        reviewedByName: req.user.name,
        reviewedByRole: req.user.role,
        verification,
        matchCandidates: matcher.confirmedCandidates(sightingToConfirm, req.user),
        status: 'matched',
        referralStatus: 'Police match confirmed',
      });
      addAudit({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'sighting.match_confirmed',
        targetType: 'foundReport',
        targetId: sightingToConfirm.id,
        summary: `Confirmed sighting match for case ${r.id} (${verification.methodLabel})`,
        scope: { state: r.state, district: r.district, reportId: r.id },
        metadata: { matchScore: sightingToConfirm.matchScore, verification, via: 'confirm_match' },
      });
    }
    // Found: no longer a face anyone is looking for.
    await matcher.unindexCase(findReport(r.id));

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
      summary: `${family.sent ? 'Confirmed match and alerted parent' : 'Confirmed match'} for case ${r.id} (${verification.methodLabel})`,
      scope: { state: r.state, district: r.district },
      metadata: { sendSms: wantsSms, smsSent: family.sent, familyNotified: family.sent, familyReason: family.reason, verification },
    });
    // A confirmed match is the moment a rescue starts, and until now it raised
    // no alert at all: the officer who pressed the button knew, and nobody
    // carrying a phone did. The sighting's location travels in the body,
    // because that is where somebody has to physically go, and its id travels
    // in the scope so tapping the notification opens that sighting rather than
    // a list the officer then has to search.
    //
    // The sighting is the one this confirmation is about: the one named in
    // the request, or else one an officer already confirmed for this case.
    // It used to be "the newest sighting linked to this case", which could be
    // a lookalike still awaiting review, and sent the rescue to the wrong place.
    const confirmedSighting = sightingToConfirm
      ? findFoundReport(sightingToConfirm.id)
      : listFoundReports()
        .filter((f) => f.matchedReportId === r.id && f.status === 'matched')
        .sort((a, b) => String(b.reviewedAt || '').localeCompare(String(a.reviewedAt || '')))[0] || null;
    // Where the child was seen, not where the case was filed — a case opened in
    // one district is routinely closed by a sighting in another, and the rescue
    // belongs to the sighting. A linked sighting carries the case's
    // jurisdiction, so it is the reporter's own place that is used. An
    // officer's explicit entry outranks both.
    const seenAt = confirmedSighting ? reportedLocationOf(confirmedSighting) : null;
    const rescueState = seenAt?.state || r.state;
    const rescueDistrict = seenAt?.district || r.district;
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
      report: deskCaseView(req.user, findReport(r.id)),
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
  router.post('/:id/reopen', protectedRoute, requireRole(...POLICE_ROLES), async (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
    const read = readFields(req.body, { reason: ['text', 500] });
    if (read.error) return res.status(400).json({ error: read.error });
    if (!['found', 'closed'].includes(r.status)) {
      return res.status(409).json({ error: 'Only a found or closed case can be reopened' });
    }
    if (r.anonymizedAt) return res.status(409).json({ error: 'A case whose details were removed cannot be reopened' });
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
      summary: `Reopened case ${r.id} (was ${r.status})`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { previousStatus: r.status, reason, reasonLength: reason.length },
    });
    // Missing again, so its face is searched for again.
    await matcher.indexCase(findReport(r.id));
    res.json({ report: deskCaseView(req.user, findReport(r.id)) });
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
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
    if (r.anonymizedAt) return res.status(409).json({ error: 'Cases whose details were removed are not compared with sightings' });
    if (!r.photoFile) return res.status(409).json({ error: 'This case has no photo to compare with sightings' });
    if (r.status === 'found') return res.status(409).json({ error: 'Found cases are not compared with sightings' });
    if (r.status === 'closed') return res.status(409).json({ error: 'Closed cases are not compared with sightings' });
    // A found child in care is matched by the missing cases registered after
    // it (the reverse search covers open found-child intakes); comparing it
    // with sightings would only find its own.
    if (isFoundChildIntake(r)) return res.status(409).json({ error: 'A found-child case is not compared with sightings' });
    // The same rule registration follows: an unverified intake is a stranger's
    // photograph until an officer verifies it, and verifying it runs this search.
    if (isPendingCitizenIntake(r)) {
      return res.status(409).json({ error: 'A citizen or NGO report must be checked before it is compared with sightings' });
    }

    const reverse = await matcher.matchStoredSightings(r, { trigger: 'rematch', actor: req.user });
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
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
    if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'A citizen or NGO report must be checked before the family is sent an SMS' });
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
      report: deskCaseView(req.user, findReport(r.id)),
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
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded family contact for case ${r.id}: ${FAMILY_CONTACT_METHODS[method]}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { method, noteLength: note ? note.length : 0, personConsent: req.body?.personConsent === true },
    });
    res.json({ report: deskCaseView(req.user, findReport(r.id)) });
  });

  router.post('/:id/case-workflow', protectedRoute, requireRole(...CASE_WORKFLOW_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `${config.label} for case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { action, note: note || null },
    });
    res.json({ report: deskCaseView(req.user, findReport(r.id)) });
  });

  router.get('/:id/assignable-users', protectedRoute, requireRole(...CASE_ASSIGN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
    res.json({ users: assignableUsersForReport(req.user, r, listUsers()) });
  });

  router.post('/:id/assign-owner', protectedRoute, requireRole(...CASE_ASSIGN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Assigned ${CASE_ASSIGNMENT_TYPES[assignmentType].toLowerCase()} for case ${r.id} to ${assignee.name}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), assignment });
  });

  router.post('/:id/investigation-checklist', protectedRoute, requireRole(...INVESTIGATION_CHECKLIST_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Updated investigation checklist for case ${r.id}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), checklistRecord });
  });

  router.post('/:id/close-case', protectedRoute, requireRole(...CASE_CLOSE_ROLES), async (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Closed case ${r.id}: ${closure.label}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      // The closing note stays on the case, which can be anonymised; the
      // permanent log keeps its length (DPIA G4).
      metadata: { reason: closure.reason, label: closure.label, closedAt: closure.closedAt, actorRole: closure.actorRole, noteLength: closure.note ? closure.note.length : 0 },
    });
    // Closed: no longer a face anyone is looking for.
    await matcher.unindexCase(findReport(r.id));
    res.json({ report: deskCaseView(req.user, findReport(r.id)) });
  });

  router.post('/:id/notes', protectedRoute, requireRole(...CASE_NOTE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Added case note for case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { noteLength: noteText.length },
    });
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), note });
  });

  router.post('/:id/cci-care', protectedRoute, requireRole(...CCI_CARE_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded CCI care for case ${r.id}: ${careRecord.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), careRecord });
  });

  router.post('/:id/jjb-proceeding', protectedRoute, requireRole(...JJB_PROCEEDING_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded JJB proceeding for case ${r.id}: ${proceeding.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), proceeding });
  });

  router.post('/:id/state-escalation', protectedRoute, requireRole(...STATE_ESCALATION_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded state escalation for case ${r.id}: ${stateEscalation.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), stateEscalation });
  });

  router.post('/:id/bureau-report', protectedRoute, requireRole(...BUREAU_REPORT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded ${bureauReport.bureauLabel} report for case ${r.id}: ${bureauReport.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), bureauReport });
  });

  router.post('/:id/external-id', protectedRoute, requireRole(...EXTERNAL_ID_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Linked ${externalRecord.label} for case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      // The reference stays on the case, which can be anonymised; the
      // permanent log keeps its last four characters (DPIA G4).
      metadata: {
        idType,
        externalIdSuffix: externalId.slice(-4),
        issuingSystem,
        issuedDate: externalRecord.issuedDate,
        remarksLength: remarks.length,
      },
    });
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), externalRecord });
  });

  router.post('/:id/restoration-plan', protectedRoute, requireRole(...RESTORATION_PLAN_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded restoration plan for case ${r.id}: ${restorationPlan.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), restorationPlan });
  });

  router.post('/:id/welfare-referral', protectedRoute, requireRole(...WELFARE_REFERRAL_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded welfare referral for case ${r.id}: ${welfareReferral.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), welfareReferral });
  });

  router.post('/:id/legal-aid-referral', protectedRoute, requireRole(...LEGAL_AID_REFERRAL_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded legal-aid referral for case ${r.id}: ${legalAidReferral.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), legalAidReferral });
  });

  router.post('/:id/adoption-record', protectedRoute, requireRole(...ADOPTION_RECORD_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded adoption follow-up for case ${r.id}: ${adoptionRecord.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), adoptionRecord });
  });

  router.post('/:id/case-assessment', protectedRoute, requireRole(...CASE_ASSESSMENT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded ${assessment.label} for case ${r.id}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), assessment });
  });

  router.post('/:id/production-record', protectedRoute, requireRole(...PRODUCTION_RECORD_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Recorded production before authority for case ${r.id}: ${productionRecord.label}`,
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
    res.status(201).json({ report: deskCaseView(req.user, findReport(r.id)), productionRecord });
  });

  router.post('/:id/transfer-jurisdiction', protectedRoute, requireRole(...CASE_TRANSFER_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Transferred case ${r.id} from ${[transfer.from.district, transfer.from.state].filter(Boolean).join(', ') || 'unscoped'} to ${[target.district, target.state].filter(Boolean).join(', ')}`,
      scope: { state: target.state, district: target.district, reportId: r.id, previousState: transfer.from.state, previousDistrict: transfer.from.district },
      metadata: { from: transfer.from, to: transfer.to, reasonLength: reason.length },
    });
    res.json({ report: deskCaseView(req.user, findReport(r.id)) });
  });

  router.post('/:id/verify-intake', protectedRoute, requireRole(...INTAKE_VERIFY_ROLES), async (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Verified citizen/NGO intake for case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { firNoRecorded: Boolean(patch.firNo), firNoSuffix: patch.firNo ? String(patch.firNo).slice(-4) : null, noteLength: event.note ? event.note.length : 0 },
    });
    // Registration skipped the search and the photo check for this intake (it
    // was unverified then); now that an officer has verified it, run both.
    const verified = findReport(r.id);
    const photo = verified.photoFile ? await readPhoto(verified.photoFile) : null;
    const photoCheck = photo && !verified.photoCheck ? await matcher.checkCasePhoto(photo) : null;
    if (photoCheck) updateReport(r.id, { photoCheck });
    // Its other photos too (shared/photo-set.js), before the search, which
    // leads with whichever of them shows one face.
    const unchecked = extraPhotosOf(verified).filter((p) => !p.check);
    if (photo && unchecked.length) {
      const buffers = {};
      for (const p of unchecked) {
        // eslint-disable-next-line no-await-in-loop
        buffers[p.id] = await Promise.resolve(readPhoto(p.file)).catch(() => null);
      }
      const checked = new Map((await checkExtraPhotos(unchecked, buffers)).map((p) => [p.id, p]));
      updateReport(r.id, { extraPhotos: extraPhotosOf(verified).map((p) => checked.get(p.id) || p) });
    }
    const reverse = verified.photoFile
      ? await matcher.matchStoredSightings(findReport(r.id), { trigger: 'intake_verified', actor: req.user })
      : { sightingMatches: 0 };
    if (photo) await matcher.indexCase(findReport(r.id), photo);
    // Verified, the case can task the AHTU: assess it again with everything
    // that has arrived since it was registered.
    updateReport(r.id, { traffickingRisk: riskFor(findReport(r.id)) });
    alertTraffickingRisk(findReport(r.id), req.user);
    res.json({ report: deskCaseView(req.user, findReport(r.id)), sightingMatches: reverse.sightingMatches });
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
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });

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
      summary: `Unpublished public bulletin for case ${r.id}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { published: false },
    });
    res.json({ report: deskCaseView(req.user, findReport(r.id)), bulletin: null });
  });

  router.get('/:id/handoff-export', protectedRoute, requireRole(...CASE_HANDOFF_EXPORT_ROLES), (req, res) => {
    const r = findReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
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
      summary: `Exported redacted case handoff for case ${r.id} to ${HANDOFF_TARGET_SYSTEMS[targetSystem]}`,
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
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'This report is outside your area' });
    const view = isCitizenRole(req.user.role) ? citizenCaseView(r) : deskCaseView(req.user, r);
    res.json({ report: { ...view, personCategory: personCategoryOf(r) } });
  });


  return router;
}
