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

import { canAccessReport } from './scope.js';

const DAY = 86400000;
const REPORT_PHOTO_RETENTION_DAYS = 3650;
const SIGHTING_PHOTO_RETENTION_DAYS = 180;
const FORMAL_CASE_ROLES = ['police', 'sjpu', 'admin', 'super_admin'];
const REPORT_CREATE_ROLES = ['police', 'sjpu', 'admin', 'super_admin', 'parent', 'ngo'];
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

function isPendingCitizenIntake(report) {
  return report?.status === 'intake_pending' || report?.intakeStatus === 'pending_verification';
}

function generatedFirNo() {
  return `FIR/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`;
}

function canTransferToJurisdiction(user, target) {
  if (!target.state || !target.district) return false;
  if (user.role === 'super_admin') return true;
  return target.state === user.jurisdiction?.state;
}

function canAssignUserToReport(actor, assignee, report) {
  if (!assignee || !CASE_ASSIGNABLE_ROLES.includes(assignee.role)) return false;
  if (!canAccessReport(actor, report)) return false;

  const reportState = report.state || null;
  const reportDistrict = report.district || null;
  const userState = assignee.jurisdiction?.state || null;
  const userDistrict = assignee.jurisdiction?.district || null;

  if (assignee.role === 'admin') return !userState || userState === reportState;
  if (['state_nodal', 'sara', 'crime_bureau'].includes(assignee.role)) return !userState || userState === reportState;
  return (!userState || userState === reportState) && (!userDistrict || userDistrict === reportDistrict);
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

function bulletinPayload(report) {
  const publishedAt = report.bulletin?.publishedAt || new Date(report.createdAt || Date.now()).toISOString();
  return {
    id: report.id,
    childName: report.childName,
    age: report.age ?? null,
    gender: report.gender || null,
    district: report.district || null,
    state: report.state || null,
    lastSeen: [report.district, report.state].filter(Boolean).join(', ') || 'Location under review',
    dateOfMissing: report.dateOfMissing || null,
    publishedAt,
    agency: report.bulletin?.agency || 'Khozo public bulletin desk',
    instructions: 'If you have information, submit a sighting through Khozo or contact 1098 / local police.',
    photoUrl: report.photoUrl || (report.photoFile ? `/api/reports/photo/${report.id}` : null),
    // Only an active missing case is ever published as a bulletin, but the
    // status still has to be stated: the public list renders it, and decides
    // from it whether to offer "submit a sighting" or "track this case".
    status: report.status,
    statusLabel: 'Active public bulletin',
  };
}

function publicSearchPayload(report) {
  const published = report.bulletin?.published === true && report.status === 'missing';
  const recovered = ['found', 'closed'].includes(report.status);
  return {
    id: report.id,
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
      ? 'If you have information, submit a sighting through Khozo or contact 1098 / local police.'
      : 'For exact case status, use the case/FIR/external-ID lookup or contact the responsible agency.',
  };
}

function publicSightingStatus(foundReport) {
  return {
    id: foundReport.id,
    status: foundReport.status,
    foundLocation: foundReport.foundLocation || 'Location under review',
    state: foundReport.state || null,
    district: foundReport.district || null,
    submittedAt: foundReport.createdAt || null,
    referralStatus: foundReport.referralStatus || null,
    referredTo1098: Boolean(foundReport.referredTo1098),
    reviewStage: foundReport.status === 'matched'
      ? 'review_complete'
      : foundReport.status === 'rejected'
        ? 'review_closed'
        : foundReport.status === 'formalized_case'
          ? 'formal_case_created'
        : foundReport.status === 'referred_cwc'
          ? 'childline_cwc_referred'
          : foundReport.status === 'cwc_followup_complete'
            ? 'cwc_followup_complete'
          : foundReport.status === 'pending_review'
            ? 'police_review_pending'
            : 'cwc_intake_queued',
    message: foundReport.status === 'matched'
      ? 'The sighting has been reviewed by an authorized officer.'
      : foundReport.status === 'rejected'
        ? 'The sighting was reviewed and closed by the responsible team.'
        : foundReport.status === 'formalized_case'
          ? 'The child-protection team has opened a formal found-child intake record.'
        : foundReport.status === 'referred_cwc'
          ? 'The sighting has been referred to Childline/CWC for follow-up.'
          : foundReport.status === 'cwc_followup_complete'
            ? 'CWC/DCPU follow-up has been recorded for this sighting.'
          : foundReport.status === 'pending_review'
            ? 'The sighting is queued for police review.'
            : 'The sighting is saved and queued for Childline/CWC intake.',
    nextStep: 'If the child appears to be in immediate danger, call 1098 or 112.',
  };
}

function publicCaseStatus(report, lookupRef = '') {
  const externalIds = Array.isArray(report.externalIds) ? report.externalIds : [];
  const matchedExternal = externalIds.find((row) => norm(row.externalId) === norm(lookupRef));
  const latestWorkflow = Array.isArray(report.workflow) && report.workflow.length
    ? report.workflow.slice().sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))[0]
    : null;
  const published = report.bulletin?.published === true;
  const active = ['missing', 'under_review', 'intake_pending'].includes(report.status);
  return {
    id: report.id,
    status: report.status,
    intakeStatus: report.intakeStatus || null,
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
    publicName: published ? report.childName : 'Identity restricted',
    ageBand: report.age == null ? null : `${Math.max(0, Number(report.age) - 1)}-${Number(report.age) + 1}`,
    gender: report.gender || null,
    district: report.district || null,
    state: report.state || null,
    firNo: report.firNo || null,
    externalId: matchedExternal ? {
      idType: matchedExternal.idType,
      label: matchedExternal.label,
      issuingSystem: matchedExternal.issuingSystem,
      externalId: matchedExternal.externalId,
    } : null,
    registeredAt: report.createdAt || null,
    dateOfMissing: report.dateOfMissing || null,
    publicBulletin: published,
    workflowStage: latestWorkflow ? latestWorkflow.label || latestWorkflow.action : null,
    closureReason: report.closure?.reasonLabel || null,
    message: active
      ? 'The case is active with the responsible agency.'
      : report.status === 'found'
        ? 'The child has been marked found or traced by an authorized agency.'
        : report.status === 'closed'
          ? 'The case has been closed by an authorized agency.'
          : 'The case is saved for official review.',
    nextStep: active
      ? 'If you have information, submit a sighting or contact 1098 / 112.'
      : 'For urgent concerns, contact the responsible police/CWC desk or emergency helplines.',
  };
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
      publicBulletin: Boolean(report.bulletin?.published),
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

function duplicateScore(candidate, incoming) {
  let score = 0;
  score += nameOverlap(candidate.childName, incoming.childName) * 0.32;
  if (candidate.parentPhone && incoming.parentPhone && candidate.parentPhone === incoming.parentPhone) score += 0.28;
  if (candidate.childAadhar && incoming.childAadhar && candidate.childAadhar === incoming.childAadhar) score += 0.45;
  if (candidate.gender && incoming.gender && candidate.gender === incoming.gender) score += 0.08;
  if (candidate.age != null && incoming.age != null) {
    const diff = Math.abs(Number(candidate.age) - Number(incoming.age));
    score += Math.max(0, 0.12 - diff * 0.04);
  }
  if (norm(candidate.state) && norm(candidate.state) === norm(incoming.state)) score += 0.08;
  if (norm(candidate.district) && norm(candidate.district) === norm(incoming.district)) score += 0.1;
  return Math.min(0.99, Number(score.toFixed(2)));
}

function findDuplicateCandidates(user, incoming, allReports = [], scopeReports = (_u, rows) => rows) {
  return scopeReports(user, allReports)
    .map((report) => ({ report, score: duplicateScore(report, incoming) }))
    .filter((c) => c.score >= 0.58)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function duplicatePayload(user, candidate) {
  const base = {
    reportId: candidate.report.id,
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

function validateImageFile(file, label = 'Photo') {
  if (!file) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    return `${label} must be a JPG, PNG, or WebP image`;
  }
  return null;
}

function validateMissingReport(body, file) {
  const errors = [];
  if (!cleanText(body.childName, 80)) errors.push('Child name is required');
  const imageError = validateImageFile(file, 'Child photo');
  if (imageError) errors.push(imageError);
  const age = optionalNumber(body.age, 'Age', { min: 0, max: 18, integer: true });
  const height = optionalNumber(body.height, 'Height', { min: 20, max: 220 });
  const weight = optionalNumber(body.weight, 'Weight', { min: 1, max: 150 });
  for (const check of [age, height, weight]) if (check.error) errors.push(check.error);
  if (body.childAadhar && !/^\d{12}$/.test(digits(body.childAadhar))) errors.push('Child Aadhar must be 12 digits');
  if (body.parentPhone && !/^\d{7,15}$/.test(digits(body.parentPhone))) errors.push('Guardian mobile number must be 7 to 15 digits');
  if (body.gender && !['Male', 'Female', 'Other'].includes(body.gender)) errors.push('Gender must be Male, Female, or Other');
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
  return { age: age.value, height: height.value, weight: weight.value };
}

function validateFoundReport(body, file) {
  const errors = [];
  const imageError = validateImageFile(file, 'Sighting photo');
  if (imageError) errors.push(imageError);
  const ageApprox = optionalNumber(body.ageApprox, 'Approximate age', { min: 0, max: 18, integer: true });
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
  return { ageApprox: ageApprox.value, lat: lat.value, lng: lng.value };
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
  const state = cleanText(body.state, 80) || null;
  const district = cleanText(body.district, 80) || null;
  return { state, district, unassigned: !state && !district };
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
  isPendingCitizenIntake,
  generatedFirNo,
  canTransferToJurisdiction,
  canAssignUserToReport,
  assignableUsersForReport,
  bulletinPayload,
  publicSearchPayload,
  publicSightingStatus,
  publicCaseStatus,
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
};
