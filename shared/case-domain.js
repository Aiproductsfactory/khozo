/**
 * Khozo case-domain rules: the vocabulary, validation and public-payload
 * redaction shared by both backends.
 *
 * Two runtimes serve the same API — Express (`server/`) for local development
 * and the Cloudflare Worker (`worker/`) in production — and they drifted:
 * endpoints existed on one and 404'd on the other, and the redaction rules that
 * decide what a public bulletin may reveal about a child were copied by hand.
 * In a child-protection system that divergence is the bug that matters, so the
 * rules live here once and both runtimes import them.
 *
 * Everything in this module is pure. Anything needing storage takes the records
 * it operates on as an argument, because the two runtimes read them differently
 * (Express from a synchronous in-memory replica, the Worker from Postgres over
 * Hyperdrive per request).
 */

import crypto from 'node:crypto';

import { canAccessReport, sameDistrictPlace, sameStatePlace } from './scope.js';
import { PHOTO_MAX_BYTES, detectImageMime } from './photo-format.js';
import { extraPhotosView } from './photo-set.js';
import { canonicalPlace } from './geo/index.js';
import { isFullAadhaar, maskAadhaar, storedAadhaarFingerprint } from './privacy.js';

const DAY = 86400000;
const REPORT_PHOTO_RETENTION_DAYS = 3650;
const SIGHTING_PHOTO_RETENTION_DAYS = 180;
const FORMAL_CASE_ROLES = ['police', 'sjpu', 'admin', 'super_admin'];
const REPORT_CREATE_ROLES = ['police', 'sjpu', 'admin', 'super_admin', 'parent', 'ngo'];
/** A missing person's gender, as a case records it. */
const REPORT_GENDERS = ['Male', 'Female', 'Other', 'Unknown'];
/**
 * Who is told that a family or an NGO has registered a case: the desks that
 * verify it (police and SJPU) and the child welfare committee of the district.
 */
const INTAKE_ALERT_ROLES = ['police', 'sjpu', 'cwc'];
/** How long a family's report may wait for an officer before it is overdue. */
const INTAKE_OVERDUE_MS = 24 * 3600000;
const REVIEW_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'admin', 'super_admin', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const CWC_FOLLOWUP_ROLES = ['cwc', 'dcpu', 'admin', 'super_admin', 'state_nodal', 'sara'];
const FOUND_INTAKE_ROLES = ['cwc', 'dcpu', 'cci', 'saa', 'police', 'sjpu', 'admin', 'super_admin', 'state_nodal', 'sara'];
const CASE_WORKFLOW_ROLES = REVIEW_ROLES;
const CASE_CLOSE_ROLES = ['police', 'sjpu', 'admin', 'super_admin', 'cwc', 'dcpu', 'cci', 'saa', 'jjb', 'state_nodal', 'sara'];
const CASE_NOTE_ROLES = REVIEW_ROLES;
const CCI_CARE_ROLES = ['cci', 'saa', 'cwc', 'dcpu', 'admin', 'super_admin', 'state_nodal', 'sara'];
const JJB_PROCEEDING_ROLES = ['jjb', 'cwc', 'dcpu', 'admin', 'super_admin', 'state_nodal'];
const STATE_ESCALATION_ROLES = ['state_nodal', 'sara', 'admin', 'super_admin'];
const BUREAU_REPORT_ROLES = ['dcrb', 'crime_bureau', 'state_nodal', 'admin', 'super_admin'];
const RESTORATION_PLAN_ROLES = ['cwc', 'dcpu', 'cci', 'saa', 'jjb', 'rpf', 'police', 'sjpu', 'ahtu', 'admin', 'super_admin', 'state_nodal', 'sara'];
const EXTERNAL_ID_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'crime_bureau', 'admin', 'super_admin', 'state_nodal', 'sara'];
const CASE_HANDOFF_EXPORT_ROLES = REVIEW_ROLES;
const WELFARE_REFERRAL_ROLES = ['cwc', 'dcpu', 'cci', 'saa', 'jjb', 'dlsa', 'admin', 'super_admin', 'state_nodal', 'sara'];
const LEGAL_AID_REFERRAL_ROLES = ['dlsa', 'cwc', 'dcpu', 'jjb', 'police', 'sjpu', 'ahtu', 'admin', 'super_admin', 'state_nodal'];
const ADOPTION_RECORD_ROLES = ['saa', 'sara', 'cwc', 'dcpu', 'cci', 'admin', 'super_admin', 'state_nodal'];
const CASE_ASSESSMENT_ROLES = ['cwc', 'dcpu', 'cci', 'saa', 'jjb', 'admin', 'super_admin', 'state_nodal', 'sara'];
const PRODUCTION_RECORD_ROLES = ['police', 'sjpu', 'ahtu', 'rpf', 'cwc', 'dcpu', 'admin', 'super_admin', 'state_nodal'];
const INTAKE_VERIFY_ROLES = ['police', 'sjpu', 'admin', 'super_admin', 'cwc', 'dcpu', 'state_nodal'];
const BULLETIN_ROLES = ['police', 'sjpu', 'admin', 'super_admin', 'state_nodal'];
const CASE_TRANSFER_ROLES = ['super_admin', 'admin', 'state_nodal'];
const CASE_ASSIGN_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const CASE_ASSIGNABLE_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau', 'admin'];
const INVESTIGATION_CHECKLIST_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'admin', 'super_admin', 'state_nodal', 'crime_bureau'];
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Score at or above which a sighting is routed to police review. See use below. */
const MATCH_REVIEW_THRESHOLD = Number(
  (typeof process !== 'undefined' && process.env?.KHOZO_MATCH_REVIEW_THRESHOLD) || 0.35
);
const CASE_ASSIGNMENT_TYPES = {
  investigation: 'Investigation owner',
  welfare: 'Welfare follow-up owner',
  railway: 'Railway / transit owner',
  cci: 'CCI care owner',
  adoption: 'Adoption follow-up owner',
  jjb: 'JJB proceeding owner',
  bureau: 'Records bureau owner',
  legal: 'Legal aid owner',
};
const INVESTIGATION_CHECKLIST_ITEMS = {
  fir_registered: 'FIR / GD registered',
  trackchild_updated: 'TrackChild record updated',
  khoyapaya_checked: 'Khoya-Paya checked',
  cctns_linked: 'CCTNS / police system linked',
  ncrb_scrb_alerted: 'NCRB / SCRB alerted',
  lookout_circulated: 'Lookout notice circulated',
  railway_rpf_alerted: 'Railway / RPF alerted',
  childline_1098_alerted: 'Childline 1098 alerted',
  cwc_informed: 'CWC informed',
  media_bulletin_reviewed: 'Media / bulletin decision reviewed',
  family_statement_recorded: 'Family statement recorded',
  last_seen_verified: 'Last-seen location verified',
};
const CHILD_VULNERABILITY_CATEGORIES = {
  unaccompanied: 'Unaccompanied / lost',
  trafficking_risk: 'Trafficking risk',
  child_labour_risk: 'Child labour risk',
  medical_attention: 'Needs medical attention',
  mental_health_support: 'Needs mental-health support',
  disability_support: 'Disability support required',
  language_barrier: 'Language / interpreter support',
  shelter_required: 'Shelter required',
  abuse_risk: 'Abuse / exploitation risk',
};
const PRODUCED_BY_TYPES = {
  police: 'Police / SJPU',
  cwc: 'CWC',
  dcpu: 'DCPU',
  rpf: 'RPF',
  ngo: 'NGO',
  citizen: 'Citizen / parent',
  self: 'Child self-reported',
  other: 'Other authority',
};
const EDUCATION_LEVELS = {
  unknown: 'Unknown',
  not_enrolled: 'Not enrolled',
  primary: 'Primary',
  upper_primary: 'Upper primary',
  secondary: 'Secondary',
  senior_secondary: 'Senior secondary',
};
const YES_NO_UNKNOWN = {
  yes: 'Yes',
  no: 'No',
  unknown: 'Unknown',
};
const DECLARATION_METHODS = {
  digital: 'Digital self-declaration',
  verbal_recorded: 'Verbal declaration recorded by officer',
  paper_signed: 'Paper declaration signed',
};
const CASE_WORKFLOW_ACTIONS = {
  refer_cwc: { status: 'under_review', audit: 'case.referred_cwc', activity: 'Referred case to CWC', label: 'Referred to CWC' },
  assign_cci: { status: 'under_review', audit: 'case.assigned_cci', activity: 'Assigned case to CCI care follow-up', label: 'Assigned to CCI care follow-up' },
  refer_jjb: { status: 'under_review', audit: 'case.referred_jjb', activity: 'Referred case to JJB', label: 'Referred to JJB' },
  escalate_state: { status: 'under_review', audit: 'case.escalated_state', activity: 'Escalated case to state nodal officer', label: 'Escalated to state nodal officer' },
  notify_crime_bureau: { status: 'under_review', audit: 'case.notified_crime_bureau', activity: 'Notified crime records bureau', label: 'Crime records bureau notified' },
};
const CASE_CLOSE_REASONS = {
  restored_family: 'Restored to family',
  transferred_cci: 'Transferred to CCI',
  adoption: 'Adoption / sponsorship / aftercare',
  repatriated: 'Repatriated',
  death: 'Death recorded',
  traced_not_reunited: 'Traced, reunification pending',
  other: 'Other closure',
};
const CWC_FOLLOWUP_OUTCOMES = {
  child_located_safe: 'Child located safe',
  shelter_intake_required: 'Shelter / CCI intake required',
  escalated_police: 'Escalated to police',
  duplicate_or_invalid: 'Duplicate or invalid sighting',
};
const CCI_ADMISSION_TYPES = {
  temporary_shelter: 'Temporary shelter',
  restoration_pending: 'Restoration pending',
  medical_care: 'Medical care',
  counselling: 'Counselling',
  aftercare_followup: 'Aftercare follow-up',
};
const CCI_SERVICE_TYPES = {
  education: 'Education',
  vocational_training: 'Vocational training',
  recreation: 'Recreation',
  health_care: 'Health care',
  counselling: 'Counselling',
  family_tracing: 'Family tracing',
};
const CCI_PROGRESS_STATES = {
  intake: 'Intake',
  active: 'Active',
  review_due: 'Review due',
  ready_for_restoration: 'Ready for restoration',
  completed: 'Completed',
};
const JJB_PROCEEDING_TYPES = {
  preliminary_hearing: 'Preliminary hearing',
  social_investigation_order: 'Social investigation order',
  rehabilitation_direction: 'Rehabilitation direction',
  family_tracing_direction: 'Family tracing direction',
  final_order_review: 'Final order review',
};
const STATE_ESCALATION_TYPES = {
  inter_district_coordination: 'Inter-district coordination',
  interstate_coordination: 'Interstate coordination',
  resource_support: 'Resource support',
  policy_exception: 'Policy exception',
  urgent_rescue_coordination: 'Urgent rescue coordination',
};
const STATE_ESCALATION_LEVELS = {
  district_to_state: 'District to state',
  state_task_force: 'State task force',
  interstate_desk: 'Interstate desk',
  national_command: 'National command',
};
const BUREAU_REPORT_TYPES = {
  ncrb_missing_child_update: 'NCRB missing-child update',
  scrb_state_update: 'SCRB state update',
  interstate_alert: 'Interstate alert',
  recurring_pattern_review: 'Recurring pattern review',
  final_trace_update: 'Final trace update',
};
const BUREAU_LEVELS = {
  ncrb: 'NCRB',
  scrb: 'SCRB',
  state_control_room: 'State control room',
};
const BUREAU_PRIORITIES = {
  routine: 'Routine',
  priority: 'Priority',
  urgent: 'Urgent',
};
const SIGHTING_ID_PROOF_TYPES = {
  aadhaar: 'Aadhaar',
  voter_id: 'Voter ID',
  passport: 'Passport',
  driving_license: 'Driving licence',
  other: 'Other photo ID',
};
const EXTERNAL_ID_TYPES = {
  trackchild: 'TrackChild ID',
  khoyapaya: 'Khoya-Paya ID',
  ncrb: 'NCRB ID',
  scrb: 'SCRB ID',
  cctns: 'CCTNS / FIR link',
  ghar: 'GHAR restoration ID',
  state_portal: 'State portal ID',
  other: 'Other external ID',
};
const RESTORATION_TYPES = {
  family_restoration: 'Family restoration',
  interstate_transfer: 'Interstate restoration',
  inter_district_transfer: 'Inter-district restoration',
  international_repatriation: 'International repatriation',
  cci_aftercare: 'CCI aftercare follow-up',
};
const RESTORATION_STATUSES = {
  planned: 'Planned',
  documents_pending: 'Documents pending',
  transit_scheduled: 'Transit scheduled',
  handed_over: 'Handed over',
  followup_due: 'Follow-up due',
  completed: 'Completed',
};
const RESTORATION_SUPPORTS = {
  interpreter: 'Interpreter requested',
  escort: 'Escort required',
  medical: 'Medical support',
  counsellor: 'Counsellor support',
  documents: 'Document verification',
  other: 'Other support',
};
const RESTORATION_TRAVEL_MODES = {
  rail: 'Rail',
  road: 'Road',
  air: 'Air',
  mixed: 'Mixed route',
  local_handover: 'Local handover',
  not_required: 'Not required',
};
const RESTORATION_DOCUMENT_STATUSES = {
  not_started: 'Not started',
  pending: 'Pending',
  verified: 'Verified',
  exception_approved: 'Exception approved',
};
const RESTORATION_FUNDING_SOURCES = {
  dcpu: 'DCPU',
  cwc: 'CWC',
  state: 'State',
  ngo: 'NGO / CSR',
  family: 'Family',
  not_required: 'Not required',
};
const WELFARE_SCHEMES = {
  sponsorship: 'Sponsorship care',
  foster_care: 'Foster care',
  adoption_facilitation: 'Adoption facilitation',
  aftercare: 'Aftercare',
  counselling: 'Counselling',
  medical_support: 'Medical support',
  education_support: 'Education support',
  family_strengthening: 'Family strengthening',
};
const WELFARE_STATUSES = {
  referred: 'Referred',
  eligibility_review: 'Eligibility review',
  approved: 'Approved',
  active: 'Active',
  completed: 'Completed',
  rejected: 'Rejected',
};
const LEGAL_AID_SERVICE_TYPES = {
  legal_aid: 'Legal aid',
  victim_compensation: 'Victim compensation',
  court_support: 'Court support',
  counselling_order_support: 'Counselling / protection order support',
  document_affidavit: 'Document or affidavit support',
  other: 'Other legal service',
};
const LEGAL_AID_STATUSES = {
  referred: 'Referred',
  application_filed: 'Application filed',
  approved: 'Approved',
  active: 'Active',
  completed: 'Completed',
  rejected: 'Rejected',
};
const ADOPTION_RECORD_TYPES = {
  cwc_order: 'CWC adoption order / declaration',
  legally_free_declaration: 'Legally free declaration',
  carings_registration: 'CARINGS registration',
  saa_intake: 'SAA intake',
  sara_review: 'SARA review',
  pre_adoption_foster_care: 'Pre-adoption foster care',
  followup_visit: 'Follow-up visit',
  other: 'Other adoption action',
};
const ADOPTION_STATUSES = {
  initiated: 'Initiated',
  pending_documents: 'Documents pending',
  cwc_review: 'CWC review',
  carings_updated: 'CARINGS updated',
  saa_care: 'SAA care',
  sara_review: 'SARA review',
  completed: 'Completed',
  on_hold: 'On hold',
};
const CASE_ASSESSMENT_TYPES = {
  social_investigation_report: 'Social Investigation Report',
  individual_care_plan: 'Individual Care Plan',
  family_assessment: 'Family assessment',
  risk_assessment: 'Risk assessment',
  rehabilitation_plan: 'Rehabilitation plan',
};
const CASE_RISK_LEVELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};
const PRODUCTION_TYPES = {
  cwc: 'Produced before CWC',
  jjb: 'Produced before JJB',
  emergency_medical: 'Emergency medical production',
  cci_intake: 'Produced for CCI intake',
};
const PRODUCTION_OUTCOMES = {
  care_order_pending: 'Care order pending',
  sent_medical: 'Sent for medical care',
  sent_cci: 'Sent to CCI',
  restored_guardian: 'Restored to guardian',
  police_inquiry: 'Police inquiry pending',
  repatriation_started: 'Repatriation started',
};

const HANDOFF_TARGET_SYSTEMS = {
  trackchild: 'TrackChild / Mission Vatsalya',
  khoyapaya: 'Khoya-Paya',
  ghar: 'GHAR restoration',
  cctns: 'CCTNS / police',
  ncrb: 'NCRB / SCRB',
  state_portal: 'State child-protection portal',
  generic: 'Generic child-protection handoff',
};

/**
 * Who a case (or a sighting) is about.
 *
 * Khozo began as a missing-children register, so every record written before
 * this field existed is about a child, and a record or client that does not
 * send it still means a child. `personCategoryOf` is the one place that default
 * lives; nothing else should read `personCategory` raw.
 *
 * Adults are not children. The child-protection machinery (CWC, JJB, CCI,
 * adoption, Childline 1098) has no jurisdiction over them, and an adult who
 * left of their own accord — or a woman leaving a violent home — can be put in
 * danger by a public appeal or by a "found" message that reaches the family.
 * That is why the console never offers "alert the family" as the next step for
 * an adult, why a family SMS for an adult needs the person's recorded consent,
 * and why the wording a citizen sees follows the category.
 */
/**
 * Roles that may mark a case `visibility: 'police'` when registering it. From
 * anyone else the field is ignored, not rejected, so an ordinary client that
 * happens to send it still files its report. The access rule that the value
 * drives lives in shared/scope.js.
 */
const POLICE_VISIBILITY_ROLES = ['super_admin', 'admin', 'crime_bureau', 'police', 'sjpu', 'ahtu', 'dcrb'];
const REPORT_VISIBILITY_VALUES = ['police'];

const PERSON_CATEGORIES = {
  child: 'Child',
  woman: 'Woman',
  adult: 'Adult person',
};
const PERSON_CATEGORY_AGE_LIMITS = {
  child: { min: 0, max: 18 },
  woman: { min: 18, max: 110 },
  adult: { min: 18, max: 110 },
};
function personCategoryOf(record) {
  const value = record?.personCategory;
  return PERSON_CATEGORIES[value] ? value : 'child';
}

function isAdultCategory(category) {
  return category === 'woman' || category === 'adult';
}

function isAdultCase(record) {
  return isAdultCategory(personCategoryOf(record));
}

/** Absent means child. Anything else that is not a known category is an error. */
function parsePersonCategory(value) {
  const text = cleanText(value, 20).toLowerCase();
  if (!text) return { value: 'child' };
  if (!PERSON_CATEGORIES[text]) return { error: 'Person category must be child, woman, or adult' };
  return { value: text };
}

/** Age bounds for a category, checked the same way for a case and a sighting. */
function categoryAge(value, label, category) {
  const limits = PERSON_CATEGORY_AGE_LIMITS[category] || PERSON_CATEGORY_AGE_LIMITS.child;
  if (isAdultCategory(category)) {
    if (value === undefined || value === null || value === '') return { value: null };
    const n = Number(value);
    if (Number.isFinite(n) && n < limits.min) {
      return { error: `${label} must be at least 18 for a woman or adult person; register anyone under 18 as a child` };
    }
  }
  return optionalNumber(value, label, { ...limits, integer: true });
}

/** The emergency line a member of the public is pointed to, by category. */
function publicHelplineText(category, kind) {
  if (kind === 'bulletin') {
    if (category === 'woman') return 'If you have information, submit a sighting through Khozo or contact 112 / local police. Women Helpline: 181.';
    if (category === 'adult') return 'If you have information, submit a sighting through Khozo or contact 112 / local police.';
    return 'If you have information, submit a sighting through Khozo or contact 1098 / local police.';
  }
  if (kind === 'danger') {
    if (category === 'woman') return 'If she appears to be in immediate danger, call 112. The Women Helpline 181 and the One Stop Centre (Sakhi) can also help.';
    if (category === 'adult') return 'If the person appears to be in immediate danger, call 112.';
    return 'If the child appears to be in immediate danger, call 1098 or 112.';
  }
  // kind === 'case'
  if (category === 'woman') return 'If you have information, submit a sighting or contact 112 / Women Helpline 181.';
  if (category === 'adult') return 'If you have information, submit a sighting or contact 112.';
  return 'If you have information, submit a sighting or contact 1098 / 112.';
}

function isPendingCitizenIntake(report) {
  return report?.status === 'intake_pending' || report?.intakeStatus === 'pending_verification';
}

function generatedFirNo() {
  return `FIR/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Why a place an officer entered cannot be stored, or null.
 *
 * An officer registering a case, transferring one, or provisioning a desk
 * picks a state and a district from the gazetteer's lists (GET /api/geo/states,
 * GET /api/geo/districts?state=CODE); text that names neither is refused with
 * the list to choose from, because a case filed under a district that does
 * not exist is a case no district desk will ever see. A citizen's sighting or
 * a family's report is never refused for this: its unrecognised text is kept
 * (canonicalPlace, `districtText`) and the record reaches every district desk
 * of the state instead.
 *
 * `input` is what was sent ({ state, district }); `place` is canonicalPlace's
 * answer for it.
 */
function jurisdictionError(input = {}, place = canonicalPlace(input)) {
  const state = String(input.state || '').trim();
  const district = String(input.district || '').trim();
  if ((state || input.stateCode) && !place.stateCode) {
    return {
      error: `"${state || input.stateCode}" is not a state or union territory of India. Choose one from the list.`,
      code: 'unknown_state',
      field: 'state',
      options: '/api/geo/states',
    };
  }
  if ((district || input.districtCode) && !place.districtCode) {
    if (!place.stateCode) {
      return {
        error: 'Choose the state before the district.',
        code: 'unknown_state',
        field: 'state',
        options: '/api/geo/states',
      };
    }
    return {
      error: `"${district || input.districtCode}" is not a district of ${place.state}. Choose one from the list.`,
      code: 'unknown_district',
      field: 'district',
      options: `/api/geo/districts?state=${encodeURIComponent(place.stateCode)}`,
    };
  }
  return null;
}

function canTransferToJurisdiction(user, target) {
  if (!(target.state || target.stateCode) || !(target.district || target.districtCode)) return false;
  if (user.role === 'super_admin') return true;
  return sameStatePlace(target, user.jurisdiction || {});
}

function canAssignUserToReport(actor, assignee, report) {
  if (!assignee || !CASE_ASSIGNABLE_ROLES.includes(assignee.role)) return false;
  if (!canAccessReport(actor, report)) return false;

  const mine = assignee.jurisdiction || {};
  const hasUserState = Boolean(mine.state || mine.stateCode);
  const hasUserDistrict = Boolean(mine.district || mine.districtCode);
  const reportHasDistrict = Boolean(report.district || report.districtCode);
  const stateOk = !hasUserState || sameStatePlace(mine, report);

  if (assignee.role === 'admin') return stateOk;
  if (['state_nodal', 'sara', 'crime_bureau'].includes(assignee.role)) return stateOk;
  // A case placed in the state but in no district yet is every district
  // desk's to pick up (shared/scope.js), so any of them may be assigned it.
  return stateOk && (!hasUserDistrict || !reportHasDistrict || sameDistrictPlace(mine, report));
}

function assignableUsersForReport(actor, report, allUsers = []) {
  return allUsers
    .filter((user) => canAssignUserToReport(actor, user, report))
    .map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      org: user.org || null,
      jurisdiction: user.jurisdiction || {},
    }))
    .sort((a, b) =>
      [a.role, a.jurisdiction?.state || '', a.jurisdiction?.district || '', a.name].join('|')
        .localeCompare([b.role, b.jurisdiction?.state || '', b.jurisdiction?.district || '', b.name].join('|'))
    );
}

/**
 * Whether a case may be shown to the public: its name, its photo, its page.
 *
 * Never, by the owner's decision of 16 October 2026. The public never sees the
 * name or the photograph of any missing person, child, woman or adult. There
 * are no public bulletins or appeals: citizens can only send sightings, and
 * Khozo never tells them who anyone is or whether their photo matched anyone.
 * A family sees its own case by logging in (shared/scope.js: a parent sees the
 * cases they registered), and tracks it publicly only by the Khozo case id it
 * was given, which returns a status and no identity.
 *
 * This is the one switch every public read goes through: the bulletin list
 * and page, public search, the anonymous photo route, the public summary and
 * the /child/:id share preview. It used to be `report.bulletin?.published ===
 * true`, an officer's per-case choice; records that still carry that flag stay
 * invisible without a data migration, because nothing reads the flag to decide
 * public visibility any more. Officers can still clear it (unpublish), and can
 * no longer set it (POST /api/reports/:id/bulletin answers 403).
 */
// eslint-disable-next-line no-unused-vars
function isPublicAppeal(report) {
  return false;
}

/** The message a refused publish request answers with. */
const PUBLIC_APPEALS_DISABLED =
  'Public appeals are disabled on Khozo: names and photos of missing persons are never shown to the public.';

function bulletinPayload(report) {
  const publishedAt = report.bulletin?.publishedAt || new Date(report.createdAt || Date.now()).toISOString();
  const personCategory = personCategoryOf(report);
  return {
    id: report.id,
    personCategory,
    childName: report.childName,
    age: report.age ?? null,
    gender: report.gender || null,
    district: report.district || null,
    state: report.state || null,
    lastSeen: [report.district, report.state].filter(Boolean).join(', ') || 'Location under review',
    dateOfMissing: report.dateOfMissing || null,
    publishedAt,
    agency: report.bulletin?.agency || 'Khozo public bulletin desk',
    instructions: publicHelplineText(personCategory, 'bulletin'),
    photoUrl: report.photoUrl || (report.photoFile ? `/api/reports/photo/${report.id}` : null),
    // Only an active missing case is ever published as a bulletin, but the
    // status still has to be stated: the public list renders it, and decides
    // from it whether to offer "submit a sighting" or "track this case".
    status: report.status,
    statusLabel: 'Active public bulletin',
  };
}

function publicSearchPayload(report) {
  const published = isPublicAppeal(report) && report.status === 'missing';
  const recovered = ['found', 'closed'].includes(report.status);
  const personCategory = personCategoryOf(report);
  return {
    id: report.id,
    personCategory,
    resultType: published ? 'active_bulletin' : recovered ? 'recovered_status' : 'case_status',
    publicName: published ? report.childName : 'Identity restricted',
    ageBand: report.age == null ? null : `${Math.max(0, Number(report.age) - 1)}-${Number(report.age) + 1}`,
    gender: report.gender || null,
    district: report.district || null,
    state: report.state || null,
    status: report.status,
    statusLabel: recovered ? 'Recovered / closed by agency' : published ? 'Active public bulletin' : 'Under official review',
    lastSeen: published ? [report.district, report.state].filter(Boolean).join(', ') || 'Location under review' : null,
    dateOfMissing: report.dateOfMissing || null,
    publishedAt: published ? report.bulletin?.publishedAt || null : null,
    agency: published ? report.bulletin?.agency || 'Khozo public bulletin desk' : null,
    instructions: published
      ? publicHelplineText(personCategory, 'bulletin')
      : 'For exact case status, use the case/FIR/external-ID lookup or contact the responsible agency.',
  };
}

/**
 * Where a sighting stands, as its reporter may know it.
 *
 * Three stages, and none of them says whether the photograph matched anyone,
 * because the stage is a function of time alone: `received` for the first day
 * after the report was sent, `under_review` until the review window has passed,
 * then `closed`. Nothing an officer or a face engine does to the record moves
 * it, and nothing about the record but its submission time is read.
 *
 * It used to follow the officers' decisions, which leaked the outcome: only a
 * sighting the engines linked to a case raised a high-priority alert and sat in
 * the Matches queue, so only those were reliably confirmed or rejected, and a
 * receipt that read `closed` within a day meant "your photograph matched a
 * missing person". For a woman or an adult it was close to certain, because an
 * unmatched adult sighting had no web action that closed it at all. A stage
 * that depends on time cannot say anything about the match.
 *
 * Records written while the stage followed decisions still carry a
 * `publicStage` field; it is ignored.
 */
const SIGHTING_STAGES = ['received', 'under_review', 'closed'];
/** How long a sighting reads `received`. */
const SIGHTING_RECEIVED_WINDOW_MS = DAY;
/** How long after submission a sighting reads `under_review` before `closed`. */
const SIGHTING_REVIEW_WINDOW_MS = 30 * DAY;

/** A stored timestamp (epoch ms, numeric string or ISO date) as epoch ms, or 0. */
function timestampOf(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  const t = Number.isFinite(n) ? n : Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function sightingPublicStage(foundReport, now = Date.now()) {
  const submitted = timestampOf(foundReport?.createdAt);
  if (!submitted) return 'received';
  const elapsed = now - submitted;
  if (elapsed < SIGHTING_RECEIVED_WINDOW_MS) return 'received';
  if (elapsed < SIGHTING_REVIEW_WINDOW_MS) return 'under_review';
  return 'closed';
}

const SIGHTING_STAGE_MESSAGES = {
  received: 'Your report has been received and is waiting for review by the responsible officers.',
  under_review: 'Your report is being reviewed by the responsible officers.',
  closed: 'The review period for this report has ended. Thank you for reporting.',
};

/**
 * The public receipt lookup for a sighting.
 *
 * Only what the reporter already knows (their receipt id, when they sent it,
 * the place they typed) plus a stage that does not depend on the match
 * outcome. Deliberately absent: the status, the referral wording, the
 * jurisdiction (on a strong match that is overwritten with the matched case's,
 * so it would tell the reporter where the person they saw is from), and the
 * category's own wording beyond the emergency line for the category the
 * reporter themselves chose.
 */
function publicSightingStatus(foundReport, now = Date.now()) {
  const stage = sightingPublicStage(foundReport, now);
  return {
    id: foundReport.id,
    stage,
    submittedAt: foundReport.createdAt || null,
    foundLocation: foundReport.foundLocation || null,
    message: SIGHTING_STAGE_MESSAGES[stage],
    nextStep: publicHelplineText(personCategoryOf(foundReport), 'danger'),
  };
}

/** Latest moment a case's public status could have changed, as epoch ms. */
function caseStatusUpdatedAt(report) {
  const times = [
    report.createdAt,
    report.verifiedAt,
    report.lastWorkflowAt,
    report.closure?.closedAt,
  ]
    .map((value) => (typeof value === 'number' ? value : Date.parse(value || '')))
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.max(...times) : report.createdAt || null;
}

/**
 * The public case lookup, for a family holding its Khozo case id.
 *
 * A status and nothing that identifies anyone: no name, age or age band,
 * gender, district or state, FIR or external id, photo, or workflow labels.
 * It is reached only by the case id (see GET /api/reports/public/status/:ref),
 * which is random and given to the family at registration; FIR numbers and
 * external ids are guessable and no longer resolve publicly.
 */
function publicCaseStatus(report) {
  const active = ['missing', 'under_review', 'intake_pending'].includes(report.status);
  const personCategory = personCategoryOf(report);
  const adult = isAdultCategory(personCategory);
  return {
    id: report.id,
    status: report.status,
    statusLabel: report.status === 'intake_pending'
      ? 'Citizen/NGO intake pending verification'
      : report.status === 'missing'
        ? 'Missing case active'
        : report.status === 'under_review'
          ? 'Under official review'
          : report.status === 'found'
            ? 'Found / traced'
            : report.status === 'closed'
              ? 'Case closed'
              : 'Status under review',
    message: active
      ? 'The case is active with the responsible agency.'
      : report.status === 'found'
        // A traced adult decides who is told where they are. Saying more than
        // "traced" to whoever holds the case number can lead an abuser to them.
        ? (adult
          ? 'The person has been traced by an authorized agency. Any contact is arranged only with their consent.'
          : 'The child has been marked found or traced by an authorized agency.')
        : report.status === 'closed'
          ? 'The case has been closed by an authorized agency.'
          : 'The case is saved for official review.',
    nextStep: active
      ? publicHelplineText(personCategory, 'case')
      : 'For urgent concerns, contact the responsible police/CWC desk or emergency helplines.',
    registeredAt: report.createdAt || null,
    updatedAt: caseStatusUpdatedAt(report),
    // Who the case is about (child / woman / adult) decides the helpline the
    // page offers. It is the family's own case, and it names nobody.
    personCategory,
  };
}

/**
 * Accounts anyone can create for themselves (a phone and an OTP is enough):
 * a parent or relative, and an NGO. They see only the cases they registered
 * (shared/scope.js), and only through citizenCaseView.
 */
const CITIZEN_ROLES = ['parent', 'ngo'];

function isCitizenRole(role) {
  return CITIZEN_ROLES.includes(role);
}

/**
 * What the person who registered a case is shown of it, when they are a
 * parent, a relative or an NGO rather than an officer.
 *
 * An allow-list: what they told Khozo, and where the case stands. Everything
 * the agencies added is left out - where the person was found or seen, officer
 * notes, shelter and care records, restoration plans, production and court
 * records, workflow notes, match scores. A family is told about a trace by an
 * officer, never by a field appearing on a page, and for a woman or an adult
 * that is a matter of safety: the relative who registered her may be the
 * person she left, and she decides whether they learn where she is (an
 * officer records her consent before the family is contacted).
 *
 * The case's district is the one it was registered in. Officers may move a
 * case to the district it is being worked from, which for a traced person is
 * where they are now.
 */
const CITIZEN_CASE_FIELDS = [
  'id', 'personCategory', 'firNo', 'childName', 'childAadhar', 'gender', 'age', 'height', 'weight',
  'identificationProfile', 'vulnerabilityProfile', 'declaration', 'hasIdentificationProfile', 'hasVulnerabilityProfile',
  'dateOfMissing', 'photoUrl', 'photoConsent', 'dataPurpose', 'retentionUntil',
  'status', 'intakeStatus', 'intakeSource', 'verifiedAt',
  'parentName', 'parentPhone', 'parentPhoneSource', 'parentEmail', 'address', 'zip',
  'smsSent', 'registeredByRole', 'registeredById', 'createdAt', 'anonymizedAt',
];

function citizenCaseView(report) {
  if (!report) return report;
  const view = {};
  for (const key of CITIZEN_CASE_FIELDS) {
    if (key in report) view[key] = report[key];
  }
  const registered = Array.isArray(report.transfers) && report.transfers[0]?.from ? report.transfers[0].from : report;
  view.state = registered.state || null;
  view.district = registered.district || null;
  view.stateCode = registered.stateCode || null;
  view.districtCode = registered.districtCode || null;
  // What the family wrote for a district the gazetteer did not recognise.
  view.districtText = registered.districtText || null;
  view.personCategory = personCategoryOf(report);
  // A number stored whole before Khozo stopped storing them is shown masked.
  if ('childAadhar' in view) view.childAadhar = maskAadhaar(view.childAadhar);
  // The other photos the family gave, by where to fetch them - not ones the
  // police added later, and not what the face checks made of any: that is
  // the desks' business (shared/photo-set.js).
  const given = new Set((Array.isArray(report.extraPhotos) ? report.extraPhotos : [])
    .filter((p) => p && p.addedById && p.addedById === report.registeredById)
    .map((p) => p.id));
  view.extraPhotos = extraPhotosView(report).filter((p) => given.has(p.id)).map(({ id, url }) => ({ id, url }));
  return view;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stable(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function signedCaseExport(payload, type = 'case_handoff_export', signing = {}) {
  const algorithm = 'sha256-hmac';
  const keyId = signing.keyId || 'demo-local';
  const key = signing.key || 'khozo-demo-export-signing-key';
  const canonical = JSON.stringify(stable(payload));
  const digest = crypto.createHash('sha256').update(canonical).digest('hex');
  const value = crypto.createHmac('sha256', key).update(`${type}.${digest}`).digest('hex');
  return {
    ...payload,
    signature: {
      type,
      algorithm,
      keyId,
      digest,
      value,
      generatedAt: new Date().toISOString(),
    },
  };
}

function latestRecord(records, dateKey = 'recordedAt') {
  if (!Array.isArray(records) || records.length === 0) return null;
  return records
    .slice()
    .sort((a, b) => new Date(b[dateKey] || b.recordedAt || 0).getTime() - new Date(a[dateKey] || a.recordedAt || 0).getTime())[0];
}

function safeRecordSummary(record, fields = []) {
  if (!record) return null;
  return fields.reduce((acc, field) => {
    if (record[field] !== undefined && record[field] !== null && record[field] !== '') acc[field] = record[field];
    return acc;
  }, {});
}

function caseHandoffPayload(report, actor, { targetSystem, purpose, includeOperationalHistory }) {
  const latestCci = latestRecord(report.cciCareRecords);
  const latestRestoration = latestRecord(report.restorationPlans);
  const latestProduction = latestRecord(report.productionRecords);
  const latestAssessment = latestRecord(report.caseAssessments);
  const latestWelfare = latestRecord(report.welfareReferrals);
  const latestAdoption = latestRecord(report.adoptionRecords);
  const latestLegalAid = latestRecord(report.legalAidReferrals);
  const targetLabel = HANDOFF_TARGET_SYSTEMS[targetSystem] || HANDOFF_TARGET_SYSTEMS.generic;
  const workflow = Array.isArray(report.workflow) ? report.workflow : [];
  return {
    exportType: 'case_handoff',
    schemaVersion: 'khozo.case_handoff.v1',
    generatedAt: new Date().toISOString(),
    generatedBy: {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      jurisdiction: actor.jurisdiction || {},
    },
    targetSystem,
    targetLabel,
    purpose,
    privacy: {
      redactionLevel: 'operational_minimum',
      excludes: [
        'guardian contact details',
        'child identity numbers',
        'protected photos',
        'free-text care notes',
        'assessment findings',
        'legal/adoption sensitive notes',
      ],
    },
    case: {
      id: report.id,
      firNo: report.firNo || null,
      status: report.status,
      intakeStatus: report.intakeStatus || null,
      intakeSource: report.intakeSource || null,
      caseOrigin: report.caseOrigin || 'missing_child_report',
      personCategory: personCategoryOf(report),
      child: {
        name: report.childName || 'Identity restricted',
        age: report.age ?? null,
        gender: report.gender || null,
      },
      location: {
        state: report.state || null,
        district: report.district || null,
        foundLocation: report.foundLocation || null,
      },
      dates: {
        registeredAt: report.createdAt || null,
        dateOfMissing: report.dateOfMissing || null,
        verifiedAt: report.verifiedAt || null,
        lastWorkflowAt: report.lastWorkflowAt || null,
      },
      publicBulletin: isPublicAppeal(report),
      sourceFoundReportId: report.sourceFoundReportId || null,
      externalIds: (Array.isArray(report.externalIds) ? report.externalIds : []).map((row) => ({
        idType: row.idType,
        label: row.label,
        externalId: row.externalId,
        issuingSystem: row.issuingSystem,
        issuedDate: row.issuedDate || null,
      })),
      assignment: report.assignedToId ? {
        assigneeId: report.assignedToId,
        assigneeName: report.assignedToName,
        assigneeRole: report.assignedToRole,
        assigneeOrg: report.assignedToOrg || null,
        assignmentType: report.currentAssignmentType || null,
        assignedAt: report.lastAssignmentAt || null,
      } : null,
    },
    profile: {
      identificationCaptured: Boolean(report.hasIdentificationProfile),
      vulnerabilityCaptured: Boolean(report.hasVulnerabilityProfile),
      vulnerabilityCategories: report.vulnerabilityProfile?.categories || [],
      producedByType: report.vulnerabilityProfile?.producedByType || null,
      educationLevel: report.vulnerabilityProfile?.educationLevel || null,
      disabilityStatus: report.vulnerabilityProfile?.disabilityStatus || null,
      mentalHealthConcern: report.vulnerabilityProfile?.mentalHealthConcern || null,
    },
    latestRecords: {
      cciCare: safeRecordSummary(latestCci, ['admissionType', 'label', 'cciName', 'admissionDate', 'nextReviewDate', 'progressStatus', 'progressLabel', 'serviceLabels']),
      restoration: safeRecordSummary(latestRestoration, ['restorationType', 'label', 'status', 'statusLabel', 'plannedDate', 'followupDate', 'toState', 'toDistrict', 'documentStatus', 'fundingSource']),
      production: safeRecordSummary(latestProduction, ['productionType', 'label', 'outcome', 'outcomeLabel', 'rescueAt', 'producedAt', 'deadlineStatus']),
      assessment: safeRecordSummary(latestAssessment, ['assessmentType', 'label', 'riskLevel', 'riskLabel', 'assessmentDate', 'nextReviewDate']),
      welfare: safeRecordSummary(latestWelfare, ['scheme', 'label', 'status', 'statusLabel', 'agencyName', 'referredDate', 'reviewDate']),
      adoption: safeRecordSummary(latestAdoption, ['recordType', 'label', 'status', 'statusLabel', 'agencyName', 'orderDate', 'nextReviewDate']),
      legalAid: safeRecordSummary(latestLegalAid, ['serviceType', 'label', 'status', 'statusLabel', 'authorityName', 'referredDate', 'hearingDate', 'reviewDate']),
    },
    counts: {
      workflowEvents: workflow.length,
      cciCareRecords: Array.isArray(report.cciCareRecords) ? report.cciCareRecords.length : 0,
      restorationPlans: Array.isArray(report.restorationPlans) ? report.restorationPlans.length : 0,
      productionRecords: Array.isArray(report.productionRecords) ? report.productionRecords.length : 0,
      assessments: Array.isArray(report.caseAssessments) ? report.caseAssessments.length : 0,
      externalIds: Array.isArray(report.externalIds) ? report.externalIds.length : 0,
    },
    workflow: includeOperationalHistory
      ? workflow.slice(-12).map((event) => ({
        ts: event.ts || null,
        action: event.action,
        label: event.label || event.action,
        actorRole: event.actorRole || null,
      }))
      : [],
  };
}

/**
 * Persists an uploaded image and returns the URL the clients fetch it from.
 *
 * The stored filename is recorded on the record itself (`photoFile`) so the
 * bytes can be found again after a restart - both to serve the photo and to
 * compare it during face matching.
 */
function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function nameOverlap(a, b) {
  const aa = new Set(norm(a).split(/\s+/).filter(Boolean));
  const bb = new Set(norm(b).split(/\s+/).filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let hit = 0;
  for (const part of aa) if (bb.has(part)) hit++;
  return hit / Math.max(aa.size, bb.size);
}

/** A phone number reduced to its last ten digits, for set membership. */
function phoneKey(value) {
  const d = digits(value);
  return d.length >= 7 ? d.slice(-10) : '';
}

/**
 * Phones that belong to an agency rather than a family: every account that is
 * not a parent (police stations, SJPU, CWC, NGOs...). Built by the caller from
 * its user list, because this module does not read storage.
 */
function nonFamilyPhoneSet(users = []) {
  const set = new Set();
  for (const user of users) {
    if (!user || user.role === 'parent') continue;
    const key = phoneKey(user.phone);
    if (key) set.add(key);
  }
  return set;
}

/**
 * The guardian phone on a record, or null when it is not evidence of family.
 *
 * When an officer registers a case without a guardian number, the route fills
 * in the officer's own phone so the case has a contact. That number is the
 * same on every case the officer registers, so treating it as a family phone
 * made two unrelated children registered by one desk look like the same child
 * (+0.28, enough with a shared district to cross the 0.58 threshold) and
 * blocked bulk imports of official registers. A number that is recorded as the
 * registering officer's fallback, or that belongs to any agency account, says
 * nothing about who the child is, so it does not count.
 */
function familyPhone(record, nonFamilyPhones) {
  if (!record?.parentPhone) return null;
  if (record.parentPhoneSource === 'registering_officer') return null;
  if (nonFamilyPhones?.size && nonFamilyPhones.has(phoneKey(record.parentPhone))) return null;
  return String(record.parentPhone).trim() || null;
}

/**
 * Whether two cases carry the same Aadhaar number. Cases store a keyed
 * fingerprint, never the number (shared/privacy.js); a case stored before
 * that rule still has the whole number, which is fingerprinted here. A masked
 * "XXXX XXXX 1234" is never compared: thousands of children share the last
 * four digits.
 */
function sameAadhaar(candidate, incoming, aadhaarKey) {
  const a = storedAadhaarFingerprint(candidate, aadhaarKey);
  const b = storedAadhaarFingerprint(incoming, aadhaarKey);
  if (a && b) return a === b;
  return isFullAadhaar(candidate.childAadhar) && isFullAadhaar(incoming.childAadhar)
    && digits(candidate.childAadhar) === digits(incoming.childAadhar);
}

function duplicateScore(candidate, incoming, { nonFamilyPhones = null, aadhaarKey = null } = {}) {
  let score = 0;
  score += nameOverlap(candidate.childName, incoming.childName) * 0.32;
  const candidatePhone = familyPhone(candidate, nonFamilyPhones);
  const incomingPhone = familyPhone(incoming, nonFamilyPhones);
  if (candidatePhone && incomingPhone && candidatePhone === incomingPhone) score += 0.28;
  if (sameAadhaar(candidate, incoming, aadhaarKey)) score += 0.45;
  // "Unknown" twice is two people nobody recorded, not a shared fact.
  if (candidate.gender && incoming.gender && candidate.gender !== 'Unknown' && candidate.gender === incoming.gender) score += 0.08;
  if (candidate.age != null && incoming.age != null) {
    const diff = Math.abs(Number(candidate.age) - Number(incoming.age));
    score += Math.max(0, 0.12 - diff * 0.04);
  }
  // Places by LGD code where both carry one (shared/geo), else by name.
  const sameStateHere = candidate.stateCode && incoming.stateCode
    ? candidate.stateCode === incoming.stateCode
    : Boolean(norm(candidate.state)) && norm(candidate.state) === norm(incoming.state);
  const sameDistrictHere = candidate.districtCode && incoming.districtCode
    ? candidate.districtCode === incoming.districtCode
    : Boolean(norm(candidate.district)) && norm(candidate.district) === norm(incoming.district);
  if (sameStateHere) score += 0.08;
  if (sameDistrictHere) score += 0.1;
  return Math.min(0.99, Number(score.toFixed(2)));
}

function findDuplicateCandidates(user, incoming, allReports = [], scopeReports = (_u, rows) => rows, { nonFamilyPhones = null, aadhaarKey = null } = {}) {
  return scopeReports(user, allReports)
    .map((report) => ({ report, score: duplicateScore(report, incoming, { nonFamilyPhones, aadhaarKey }) }))
    .filter((c) => c.score >= 0.58)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function duplicatePayload(user, candidate) {
  const base = {
    reportId: candidate.report.id,
    personCategory: personCategoryOf(candidate.report),
    childName: candidate.report.childName,
    age: candidate.report.age,
    gender: candidate.report.gender,
    status: candidate.report.status,
    district: candidate.report.district,
    state: candidate.report.state,
    score: candidate.score,
  };
  if (['parent', 'ngo'].includes(user.role)) return base;
  return {
    ...base,
    parentName: candidate.report.parentName,
    parentPhone: candidate.report.parentPhone,
  };
}

function isTruthy(v) {
  return v === true || v === 'true' || v === 'on' || v === '1' || v === 1;
}

function retentionUntil(days) {
  return new Date(Date.now() + days * DAY).toISOString();
}

function cleanText(v, max = 140) {
  const text = String(v || '').trim();
  return text.length <= max ? text : text.slice(0, max);
}

// ---- Strict request bodies -------------------------------------------------
//
// A route used to copy what it was sent straight onto the record:
// `foundLocation: b.foundLocation || 'Unknown'`. A JSON body of
// {"foundLocation": {"x": 1}} was then stored as an object, and every desk
// whose screen rendered that sighting crashed, because React cannot render an
// object as text. cleanText() alone does not catch it either: it turns the
// object into the string "[object Object]" and stores that.
//
// So a write route names the fields it reads and what each must be, and any
// field that is present with the wrong shape is refused with
// `Invalid value for <field>` before anything is written. Text is trimmed and
// cut to a length here; fields a validator later checks for "too long" are read
// with a generous limit so that check still runs.

/** The refusal for a field sent with the wrong shape. */
function invalidValue(field) {
  return `Invalid value for ${field}`;
}

function isNumericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text === '' || Number.isFinite(Number(text));
}

/**
 * Reads `body` against `spec`, a map of field name to rule:
 *
 *   'text' | ['text', max]   a string, trimmed and cut to `max` (default 140)
 *   'secret'                 a string, kept exactly as sent (passwords)
 *   'number'                 a number, or a string holding one (or empty)
 *   'flag'                   a boolean, string or number (isTruthy reads it)
 *   'list' | ['list', max]   a string or an array of strings, each cleaned
 *
 * Absent, undefined and null fields are skipped. Returns `{ error, field }` for
 * the first field with the wrong shape, else `{ body }`: the original body
 * with the named fields replaced by their cleaned values. Fields the spec does
 * not name pass through unchanged, so a route must name every field it stores.
 */
function readFields(body, spec) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const cleaned = {};
  for (const [field, rule] of Object.entries(spec)) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (value === undefined || value === null) continue;
    const [kind, limit] = Array.isArray(rule) ? rule : [rule];
    const refuse = { error: invalidValue(field), field };
    if (kind === 'text') {
      if (typeof value !== 'string') return refuse;
      cleaned[field] = cleanText(value, limit ?? 140);
    } else if (kind === 'secret') {
      if (typeof value !== 'string') return refuse;
    } else if (kind === 'number') {
      if (!isNumericValue(value)) return refuse;
      cleaned[field] = typeof value === 'string' ? value.trim() : value;
    } else if (kind === 'flag') {
      if (!['boolean', 'string', 'number'].includes(typeof value)) return refuse;
      if (typeof value === 'string') cleaned[field] = cleanText(value, 10);
    } else if (kind === 'list') {
      if (Array.isArray(value)) {
        if (value.some((item) => typeof item !== 'string')) return refuse;
        cleaned[field] = value.slice(0, 50).map((item) => cleanText(item, limit ?? 60));
      } else if (typeof value === 'string') {
        cleaned[field] = cleanText(value, 1000);
      } else {
        return refuse;
      }
    }
  }
  return { body: { ...source, ...cleaned } };
}

/**
 * The first top-level field holding something no write route stores as sent:
 * an object, or an array with anything but strings and numbers in it. `allow`
 * names the fields that are objects by design (a match confirmation's
 * `verification`). Returns the field name, or null.
 */
function nestedValueField(body, allow = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const [field, value] of Object.entries(body)) {
    if (value === null || value === undefined || allow.includes(field)) continue;
    if (Array.isArray(value)) {
      if (value.some((item) => item !== null && !['string', 'number'].includes(typeof item))) return field;
    } else if (typeof value === 'object') {
      return field;
    }
  }
  return null;
}

// ---- Confirming an identity --------------------------------------------------
//
// A confirmed match tells a family their child is found and starts a rescue,
// and until now the record kept only that somebody pressed the button. An
// officer now records how they satisfied themselves that the person found is
// the person missing: how (in person, by video, from documents), who checked,
// where, and what they saw. A confirmation without it is refused.

const VERIFICATION_METHODS = {
  in_person: 'In person',
  video_call: 'Video call',
  documents: 'Documents',
  other: 'Other',
};

const VERIFICATION_REQUIRED = 'Record how the identity was verified before confirming';

/**
 * `body.verification` as stored, or null when it is missing or incomplete.
 * Accepts the object itself or its JSON text (a form post).
 */
function parseVerification(value, user = null) {
  let input = value;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { method, verifiedBy, place, note } = input;
  if (typeof method !== 'string' || !VERIFICATION_METHODS[method]) return null;
  if ([verifiedBy, place, note].some((field) => typeof field !== 'string')) return null;
  const by = cleanText(verifiedBy, 120);
  const where = cleanText(place, 180);
  const how = cleanText(note, 1000);
  if (by.length < 2 || where.length < 2 || how.length < 10) return null;
  return {
    method,
    methodLabel: VERIFICATION_METHODS[method],
    verifiedBy: by,
    place: where,
    note: how,
    recordedAt: new Date().toISOString(),
    recordedById: user?.id || null,
    recordedByName: user?.name || null,
    recordedByRole: user?.role || null,
  };
}

// ---- Telling the family --------------------------------------------------------

/** How an officer reached a family, recorded by POST /api/reports/:id/family-contacted. */
const FAMILY_CONTACT_METHODS = {
  call: 'Phone call',
  visit: 'Visit',
  sms: 'SMS',
};

/** The refusal when a woman or adult has not agreed to her family being told. */
const PERSON_CONSENT_REQUIRED =
  'Verify with the person first; share their location with the family only with their consent';

/**
 * What an officer is told when Khozo did not send the family an SMS. Fixed
 * sentences, so the console can translate them (web/src/serverMessages.js).
 */
const FAMILY_SMS_MESSAGES = {
  sent: 'SMS sent to the family.',
  no_gateway: 'No SMS gateway is connected. Call the family directly and record the call.',
  gateway_failed: 'The SMS gateway did not accept the message. Call the family directly and record the call.',
  no_family_phone: 'No family phone number is recorded on this case. Record how the family was contacted.',
  not_requested: 'The family has not been told yet. Call them and record the call.',
  consent_required: PERSON_CONSENT_REQUIRED,
};

/**
 * The text Khozo sends a family. It says there is news and who to call, never
 * where the person is: a message can be read by whoever holds the phone.
 */
function familySmsText(report, officer) {
  const desk = cleanText(officer?.org || officer?.name, 80) || 'the police desk handling it';
  const phone = cleanText(officer?.phone, 20);
  return `Khozo: there is news about the case you registered (${report.id}). Please contact ${desk}${phone ? ` on ${phone}` : ''}.`;
}

function parseDateInput(value, label) {
  const text = cleanText(value, 40);
  if (!text) return { error: `${label} is required` };
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) return { error: `${label} is invalid` };
  return { value: text, time };
}

function parseDateTimeInput(value, label) {
  const text = cleanText(value, 60);
  if (!text) return { error: `${label} is required` };
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) return { error: `${label} is invalid` };
  return { value: text, time };
}

function optionalDateInput(value, label, { minTime, maxTime } = {}) {
  if (!value) return { value: null, time: null };
  const parsed = parseDateInput(value, label);
  if (parsed.error) return parsed;
  if (minTime != null && parsed.time < minTime) return { error: `${label} cannot be in the past` };
  if (maxTime != null && parsed.time > maxTime) return { error: `${label} cannot be in the future` };
  return parsed;
}

function listValues(value, allowed, maxItems = 6) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return raw
    .map((item) => cleanText(item, 40))
    .filter((item) => allowed[item])
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, maxItems);
}

function enumValue(value, allowed, fallback = null) {
  const text = cleanText(value, 40);
  if (!text) return fallback;
  return allowed[text] ? text : null;
}

function buildChildProfile(body = {}) {
  const vulnerabilityCategories = listValues(body.vulnerabilityCategories, CHILD_VULNERABILITY_CATEGORIES, 8);
  const producedByType = enumValue(body.producedByType, PRODUCED_BY_TYPES, null);
  const educationLevel = enumValue(body.educationLevel, EDUCATION_LEVELS, 'unknown') || 'unknown';
  const disabilityStatus = enumValue(body.disabilityStatus, YES_NO_UNKNOWN, 'unknown') || 'unknown';
  const mentalHealthConcern = enumValue(body.mentalHealthConcern, YES_NO_UNKNOWN, 'unknown') || 'unknown';
  const identificationProfile = {
    complexion: cleanText(body.complexion, 80) || null,
    build: cleanText(body.build, 80) || null,
    hair: cleanText(body.hair, 120) || null,
    clothing: cleanText(body.clothing, 200) || null,
    languages: cleanText(body.languages, 160) || null,
    birthMark: cleanText(body.birthMark, 200) || null,
    identificationMark: cleanText(body.identificationMark, 240) || null,
  };
  const vulnerabilityProfile = {
    producedByType,
    producedByLabel: producedByType ? PRODUCED_BY_TYPES[producedByType] : null,
    educationLevel,
    educationLabel: EDUCATION_LEVELS[educationLevel],
    disabilityStatus,
    disabilityLabel: YES_NO_UNKNOWN[disabilityStatus],
    mentalHealthConcern,
    mentalHealthConcernLabel: YES_NO_UNKNOWN[mentalHealthConcern],
    categories: vulnerabilityCategories,
    categoryLabels: vulnerabilityCategories.map((item) => CHILD_VULNERABILITY_CATEGORIES[item]),
    circumstances: cleanText(body.circumstances, 600) || null,
  };
  return {
    identificationProfile,
    vulnerabilityProfile,
    hasIdentificationProfile: Object.values(identificationProfile).some(Boolean),
    hasVulnerabilityProfile: Boolean(
      producedByType ||
      vulnerabilityCategories.length ||
      educationLevel !== 'unknown' ||
      disabilityStatus !== 'unknown' ||
      mentalHealthConcern !== 'unknown' ||
      vulnerabilityProfile.circumstances
    ),
  };
}

function buildReportDeclaration(body = {}, user) {
  const method = enumValue(body.declarationMethod, DECLARATION_METHODS, 'digital') || 'digital';
  return {
    accepted: isTruthy(body.declarationAccepted),
    acceptedAt: Date.now(),
    method,
    methodLabel: DECLARATION_METHODS[method],
    signerName: cleanText(body.declarationSignerName || body.parentName || user.name, 120) || user.name,
    signerRole: cleanText(body.declarationSignerRole || (user.role === 'parent' ? 'parent' : user.role), 80),
    relationshipToChild: cleanText(body.relationshipToChild || (user.role === 'parent' ? 'parent' : 'official'), 80),
    statementVersion: 'missing_child_intake_v1',
  };
}

function buildFoundChildDeclaration(foundReport, user) {
  return {
    accepted: true,
    acceptedAt: Date.now(),
    method: 'verbal_recorded',
    methodLabel: DECLARATION_METHODS.verbal_recorded,
    signerName: user.name,
    signerRole: user.role,
    relationshipToChild: 'authorized child-protection intake',
    statementVersion: 'found_child_intake_v1',
    sourceFoundReportId: foundReport.id,
  };
}

function digits(v) {
  return String(v || '').replace(/\D/g, '');
}

function maskProofNumber(value) {
  const raw = String(value || '').replace(/\s+/g, '').trim();
  if (!raw) return null;
  const suffix = raw.slice(-4);
  return `${'*'.repeat(Math.max(0, Math.min(8, raw.length - 4)))}${suffix}`;
}

function publicReporterName(foundReport) {
  return foundReport.confidentialReporter ? 'Confidential citizen' : foundReport.reporterName || 'Anonymous citizen';
}

function optionalNumber(value, label, { min, max, integer = false } = {}) {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: `${label} must be a number` };
  if (integer && !Number.isInteger(n)) return { error: `${label} must be a whole number` };
  if (min != null && n < min) return { error: `${label} must be at least ${min}` };
  if (max != null && n > max) return { error: `${label} must be at most ${max}` };
  return { value: n };
}

/** The refusal for an upload over the size limit, as both runtimes send it (413). */
const PHOTO_TOO_LARGE = 'Photo is larger than 8 MB. Choose a smaller photo or retake it.';

/**
 * Refuses a photo that is not a JPEG, PNG or WebP: first by its declared type,
 * then by its bytes. A HEIC or a PDF renamed .jpg passes the first check and
 * neither face engine can read it; the comparison would then fail as "no
 * answer" with nothing on the record to say why. The size limit is enforced by
 * the upload layer before this runs (multer on Express, the router on the
 * Worker), and checked again here for a body that reached a route another way.
 */
function validateImageFile(file, label = 'Photo') {
  if (!file) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    return `${label} must be a JPG, PNG, or WebP image`;
  }
  const size = Number(file.size ?? file.buffer?.length ?? 0);
  if (size > PHOTO_MAX_BYTES || (file.buffer?.length || 0) > PHOTO_MAX_BYTES) return PHOTO_TOO_LARGE;
  if (file.buffer && !detectImageMime(file.buffer)) {
    return `${label} does not look like a JPG, PNG or WebP image`;
  }
  return null;
}

/**
 * The MIME type a photo is stored as: what its bytes are, whatever the phone
 * declared (a PNG sent as image/jpeg is stored and served as a PNG).
 */
function storedImageMime(file) {
  return (file?.buffer && detectImageMime(file.buffer)) || file?.mimetype || 'image/jpeg';
}

function validateMissingReport(body, file) {
  const errors = [];
  const category = parsePersonCategory(body.personCategory);
  if (category.error) errors.push(category.error);
  const personCategory = category.value || 'child';
  const adult = isAdultCategory(personCategory);
  if (!cleanText(body.childName, 80)) errors.push(adult ? 'Name of the missing person is required' : 'Child name is required');
  const imageError = validateImageFile(file, adult ? 'Photo' : 'Child photo');
  if (imageError) errors.push(imageError);
  const age = categoryAge(body.age, 'Age', personCategory);
  const height = optionalNumber(body.height, 'Height', { min: 20, max: 220 });
  const weight = optionalNumber(body.weight, 'Weight', { min: 1, max: adult ? 250 : 150 });
  for (const check of [age, height, weight]) if (check.error) errors.push(check.error);
  if (personCategory === 'woman' && body.gender === 'Male') errors.push('Gender for a missing woman must be Female or Other');
  if (body.childAadhar && !/^\d{12}$/.test(digits(body.childAadhar))) errors.push('Child Aadhar must be 12 digits');
  if (body.parentPhone && !/^\d{7,15}$/.test(digits(body.parentPhone))) errors.push('Guardian mobile number must be 7 to 15 digits');
  // "Unknown" is an answer: a register row, or a family that will not say,
  // is better recorded as not known than defaulted to a boy.
  if (body.gender && !REPORT_GENDERS.includes(body.gender)) errors.push('Gender must be Male, Female, Other, or Unknown');
  if (body.producedByType && !PRODUCED_BY_TYPES[body.producedByType]) errors.push(`Produced-by type must be one of ${Object.keys(PRODUCED_BY_TYPES).join(', ')}`);
  if (body.educationLevel && !EDUCATION_LEVELS[body.educationLevel]) errors.push(`Education level must be one of ${Object.keys(EDUCATION_LEVELS).join(', ')}`);
  if (body.disabilityStatus && !YES_NO_UNKNOWN[body.disabilityStatus]) errors.push('Disability status must be yes, no, or unknown');
  if (body.mentalHealthConcern && !YES_NO_UNKNOWN[body.mentalHealthConcern]) errors.push('Mental-health concern must be yes, no, or unknown');
  if (!isTruthy(body.declarationAccepted)) errors.push('Reporter declaration is required before submitting a missing-child report');
  if (body.declarationMethod && !DECLARATION_METHODS[body.declarationMethod]) errors.push(`Declaration method must be one of ${Object.keys(DECLARATION_METHODS).join(', ')}`);
  if (cleanText(body.declarationSignerName, 120).length < String(body.declarationSignerName || '').trim().length) errors.push('Declaration signer name is too long');
  if (cleanText(body.relationshipToChild, 80).length < String(body.relationshipToChild || '').trim().length) errors.push('Relationship to child is too long');
  const vulnerabilityCategories = Array.isArray(body.vulnerabilityCategories)
    ? body.vulnerabilityCategories
    : String(body.vulnerabilityCategories || '').split(',').filter(Boolean);
  for (const category of vulnerabilityCategories) {
    if (!CHILD_VULNERABILITY_CATEGORIES[cleanText(category, 40)]) {
      errors.push(`Vulnerability category must be one of ${Object.keys(CHILD_VULNERABILITY_CATEGORIES).join(', ')}`);
      break;
    }
  }
  if (body.dateOfMissing) {
    const missingAt = new Date(body.dateOfMissing).getTime();
    if (!Number.isFinite(missingAt)) errors.push('Date of missing is invalid');
    else if (missingAt > Date.now() + DAY) errors.push('Date of missing cannot be in the future');
  }
  if (errors.length) return { errors };
  return { age: age.value, height: height.value, weight: weight.value, personCategory };
}

function validateFoundReport(body, file) {
  const errors = [];
  // Who was seen. Absent means a child, so the existing public form and any
  // queued offline report keep working unchanged.
  const category = parsePersonCategory(body.personCategory);
  if (category.error) errors.push(category.error);
  const personCategory = category.value || 'child';
  const imageError = validateImageFile(file, 'Sighting photo');
  if (imageError) errors.push(imageError);
  const ageApprox = categoryAge(body.ageApprox, 'Approximate age', personCategory);
  const lat = optionalNumber(body.lat, 'Latitude', { min: -90, max: 90 });
  const lng = optionalNumber(body.lng, 'Longitude', { min: -180, max: 180 });
  for (const check of [ageApprox, lat, lng]) if (check.error) errors.push(check.error);
  if (body.reporterPhone && !/^\d{7,15}$/.test(digits(body.reporterPhone))) errors.push('Reporter mobile number must be 7 to 15 digits');
  if (body.idProofType && !SIGHTING_ID_PROOF_TYPES[body.idProofType]) errors.push(`Photo ID proof type must be one of ${Object.keys(SIGHTING_ID_PROOF_TYPES).join(', ')}`);
  if (body.idProofNumber && String(body.idProofNumber).replace(/\s+/g, '').length < 4) errors.push('Photo ID proof number must include at least 4 characters');
  if (body.gender && !['Male', 'Female', 'Other'].includes(body.gender)) errors.push('Gender must be Male, Female, or Other');
  if (cleanText(body.foundLocation, 180).length < String(body.foundLocation || '').trim().length) errors.push('Found location is too long');
  if (cleanText(body.note, 500).length < String(body.note || '').trim().length) errors.push('Sighting note is too long');
  if (errors.length) return { errors };
  return { ageApprox: ageApprox.value, lat: lat.value, lng: lng.value, personCategory };
}

/**
 * Where a sighting belongs, for jurisdiction routing.
 *
 * This used to guess the state from a hardcoded list of city names — "mumbai",
 * "dadar", "goa", "delhi" — which meant a sighting anywhere else in India got
 * no jurisdiction at all, and an unlocated sighting is one no district officer
 * can see. A child reported in Guwahati was invisible to everyone.
 *
 * So there is no guessing now. The location is what the reporter selected; if
 * they gave none, the sighting is `unassigned` and every review role sees it
 * until an officer places it. An unrouted report must land in someone's queue,
 * never in nobody's.
 */
function inferLocationScope(body = {}) {
  const { resolved, ...place } = canonicalPlace({
    state: cleanText(body.state, 80),
    district: cleanText(body.district, 80),
    stateCode: cleanText(body.stateCode, 8),
    districtCode: cleanText(body.districtCode, 40),
  });
  return { ...place, unassigned: !place.state && !place.district && !place.districtText };
}


export {
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
  PERSON_CATEGORIES,
  PERSON_CATEGORY_AGE_LIMITS,
  personCategoryOf,
  isAdultCategory,
  isAdultCase,
  parsePersonCategory,
  categoryAge,
  publicHelplineText,
  phoneKey,
  nonFamilyPhoneSet,
  familyPhone,
  isPendingCitizenIntake,
  generatedFirNo,
  canTransferToJurisdiction,
  jurisdictionError,
  REPORT_GENDERS,
  INTAKE_ALERT_ROLES,
  INTAKE_OVERDUE_MS,
  canAssignUserToReport,
  assignableUsersForReport,
  isPublicAppeal,
  PUBLIC_APPEALS_DISABLED,
  bulletinPayload,
  publicSearchPayload,
  SIGHTING_STAGES,
  SIGHTING_RECEIVED_WINDOW_MS,
  SIGHTING_REVIEW_WINDOW_MS,
  sightingPublicStage,
  publicSightingStatus,
  publicCaseStatus,
  CITIZEN_ROLES,
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
  VERIFICATION_METHODS,
  VERIFICATION_REQUIRED,
  parseVerification,
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
  PHOTO_TOO_LARGE,
  validateImageFile,
  storedImageMime,
  validateMissingReport,
  validateFoundReport,
  inferLocationScope,
};
