import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import {
  listReports, addReport, findReport, updateReport,
  listFoundReports, addFoundReport, findFoundReport, updateFoundReport,
  listUsers, addActivity, addAudit,
  savePhoto, readPhoto, photoMimeType,
} from '../store.js';
import { authRequired, passwordChangeRequired, requireRole } from '../auth.js';
import { canAccessReport, scopeFoundReports, scopeReports } from '../scope.js';
import { rankMatches } from '../match.js';
import { auditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../rateLimit.js';

const router = Router();
const protectedRoute = [authRequired, passwordChangeRequired];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
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
const MATCH_REVIEW_THRESHOLD = Number(process.env.KHOZO_MATCH_REVIEW_THRESHOLD || 0.35);
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
const foundReportLimit = fixedWindowRateLimit({
  name: 'public_found_report',
  limit: 10,
  envLimit: process.env.KHOZO_FOUND_REPORT_LIMIT,
  key: (req) => `${clientIp(req)}:${String(req.body?.reporterPhone || '').trim()}`,
  onLimit: auditPublicRateLimit,
});
const publicCaseStatusLimit = fixedWindowRateLimit({
  name: 'public_case_status',
  limit: 30,
  envLimit: process.env.KHOZO_CASE_STATUS_LIMIT,
  key: (req) => `${clientIp(req)}:${norm(req.params.ref)}`,
  onLimit: auditPublicRateLimit,
});
const publicSightingStatusLimit = fixedWindowRateLimit({
  name: 'public_sighting_status',
  limit: 30,
  envLimit: process.env.KHOZO_SIGHTING_STATUS_LIMIT,
  key: (req) => `${clientIp(req)}:${norm(req.params.id)}`,
  onLimit: auditPublicRateLimit,
});
const publicBulletinLimit = fixedWindowRateLimit({
  name: 'public_bulletins',
  limit: 120,
  envLimit: process.env.KHOZO_BULLETIN_LIMIT,
  key: (req) => clientIp(req),
  onLimit: auditPublicRateLimit,
});
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

function assignableUsersForReport(actor, report) {
  return listUsers()
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

function signedCaseExport(payload, type = 'case_handoff_export') {
  const algorithm = 'sha256-hmac';
  const keyId = process.env.KHOZO_EXPORT_SIGNING_KEY_ID || 'demo-local';
  const key = process.env.KHOZO_EXPORT_SIGNING_KEY || 'khozo-demo-export-signing-key';
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
async function storePhoto(key, file) {
  if (!file) return { photoUrl: null, photoFile: null };
  const photoFile = await savePhoto(key, file.buffer, file.mimetype);
  return {
    photoUrl: photoFile ? `/api/reports/photo/${key}` : null,
    photoFile,
  };
}

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

function findDuplicateCandidates(user, incoming) {
  return scopeReports(user, listReports())
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

function inferLocationScope(body = {}) {
  const text = [body.foundLocation, body.note].filter(Boolean).join(' ').toLowerCase();
  const state = body.state || (
    text.includes('mumbai') || text.includes('powai') || text.includes('dadar') || text.includes('cst') || text.includes('csmt')
      ? 'Maharashtra'
      : text.includes('margao') || text.includes('goa')
        ? 'Goa'
        : text.includes('delhi')
          ? 'Delhi'
          : null
  );
  const district = body.district || (
    state === 'Maharashtra' && (text.includes('mumbai') || text.includes('powai') || text.includes('dadar') || text.includes('cst') || text.includes('csmt'))
      ? 'Mumbai'
      : state === 'Goa' && text.includes('margao')
        ? 'South Goa'
        : null
  );
  return { state, district };
}

router.get('/photo/:key', protectedRoute, async (req, res) => {
  // Resolve the owning record first: the jurisdiction check is the access
  // control for the image, so an unknown key must never reach the filesystem.
  const report = findReport(req.params.key);
  if (report && !canAccessReport(req.user, report)) {
    return res.status(403).json({ error: 'Photo is outside your jurisdiction' });
  }
  const found = findFoundReport(req.params.key);
  if (found && scopeFoundReports(req.user, [found], listReports()).length !== 1) {
    return res.status(403).json({ error: 'Photo is outside your jurisdiction' });
  }
  const record = report || found;
  if (!record) return res.status(404).end();

  const buffer = record.photoFile ? await readPhoto(record.photoFile) : null;
  if (!buffer) return res.status(404).end();
  res.type(photoMimeType(record.photoFile)).send(buffer);
});

// ---- Missing-child reports / FIRs -----------------------------------------

router.get('/public/bulletins', publicBulletinLimit, (req, res) => {
  let rows = listReports().filter((r) =>
    r.status === 'missing' &&
    r.intakeStatus !== 'pending_verification' &&
    r.bulletin?.published === true &&
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

router.get('/public/search', publicBulletinLimit, (req, res) => {
  let rows = listReports().filter((r) =>
    !r.anonymizedAt &&
    (
      (r.status === 'missing' && r.intakeStatus !== 'pending_verification' && r.bulletin?.published === true) ||
      ['found', 'closed'].includes(r.status)
    )
  );
  const state = String(req.query.state || '').trim().toLowerCase();
  const district = String(req.query.district || '').trim().toLowerCase();
  const gender = String(req.query.gender || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
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

router.get('/public/status/:ref', publicCaseStatusLimit, (req, res) => {
  const ref = cleanText(req.params.ref, 140);
  const report = listReports().find((r) =>
    !r.anonymizedAt &&
    (
      norm(r.id) === norm(ref) ||
      (r.firNo && norm(r.firNo) === norm(ref)) ||
      (Array.isArray(r.externalIds) && r.externalIds.some((row) => norm(row.externalId) === norm(ref)))
    )
  );
  if (!report) return res.status(404).json({ error: 'Case reference not found' });
  res.json({ status: publicCaseStatus(report, ref) });
});

// Scoped list for the logged-in stakeholder.
router.get('/', protectedRoute, (req, res) => {
  let rows = scopeReports(req.user, listReports());
  const { status, q } = req.query;
  if (status) rows = rows.filter((r) => r.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) =>
      [r.childName, r.parentName, r.firNo, r.address, r.state, r.district]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }
  res.json({ reports: rows });
});

// Register a missing child. Parents/NGOs file a report; police file a formal FIR.
router.post('/', protectedRoute, requireRole(...REPORT_CREATE_ROLES), upload.single('photo'), async (req, res) => {
  const b = req.body || {};
  const validation = validateMissingReport(b, req.file);
  if (validation.errors) return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
  if (req.file && !isTruthy(b.photoConsent)) {
    return res.status(400).json({ error: 'Photo consent is required before uploading a child image' });
  }
  const id = `r_${nanoid(8)}`;
  const isPolice = FORMAL_CASE_ROLES.includes(req.user.role);
  const childProfile = buildChildProfile(b);
  const declaration = buildReportDeclaration(b, req.user);
  const incoming = {
    childName: b.childName,
    childAadhar: b.childAadhar || null,
    gender: b.gender || 'Male',
    age: validation.age,
    parentPhone: b.parentPhone || req.user.phone,
    state: b.state || req.user.jurisdiction?.state || null,
    district: b.district || req.user.jurisdiction?.district || null,
    identificationProfile: childProfile.identificationProfile,
    vulnerabilityProfile: childProfile.vulnerabilityProfile,
  };
  const duplicateCandidates = findDuplicateCandidates(req.user, incoming);
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
    firNo: b.firNo || (isPolice ? generatedFirNo() : null),
    childName: b.childName,
    childAadhar: b.childAadhar || null,
    gender: b.gender || 'Male',
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
    dataPurpose: b.dataPurpose || 'missing_child_investigation',
    retentionUntil: retentionUntil(REPORT_PHOTO_RETENTION_DAYS),
    status: isPolice ? 'missing' : 'intake_pending',
    intakeStatus: isPolice ? 'verified' : 'pending_verification',
    intakeSource: isPolice ? 'official_fir' : 'citizen_report',
    verifiedAt: isPolice ? Date.now() : null,
    verifiedById: isPolice ? req.user.id : null,
    verifiedByName: isPolice ? req.user.name : null,
    parentName: b.parentName || req.user.name,
    parentPhone: b.parentPhone || req.user.phone,
    parentEmail: b.parentEmail || null,
    address: b.address || null,
    state: b.state || req.user.jurisdiction?.state || null,
    district: b.district || req.user.jurisdiction?.district || null,
    zip: b.zip || null,
    foundLocation: null,
    matchScore: 0,
    smsSent: false,
    registeredByRole: req.user.role,
    registeredById: req.user.id,
    createdAt: Date.now(),
  };
  addReport(report);
  addActivity({ actor: req.user.name, action: isPolice ? 'Registered an FIR' : 'Submitted missing-child intake for verification', target: report.childName, icon: 'plus', actorId: req.user.id, scope: { state: report.state, district: report.district, reportId: report.id } });
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
  res.status(201).json({ report });
});

// ---- Public "I spotted a child" uploads + face match ----------------------

router.get('/found/status/:id', publicSightingStatusLimit, (req, res) => {
  const found = findFoundReport(req.params.id);
  if (!found) return res.status(404).json({ error: 'Sighting receipt not found' });
  res.json({ status: publicSightingStatus(found) });
});

// Public endpoint (no auth): citizen uploads a photo and gets a review-safe receipt.
router.post('/found', upload.single('photo'), foundReportLimit, async (req, res) => {
  const b = req.body || {};
  const validation = validateFoundReport(b, req.file);
  if (validation.errors) return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
  if (req.file && !isTruthy(b.photoConsent)) {
    return res.status(400).json({ error: 'Photo consent is required before submitting a sighting image' });
  }
  if (!req.file && !String(b.note || '').trim() && !String(b.foundLocation || '').trim()) {
    return res.status(400).json({ error: 'Add a photo or enough sighting details to help CWC/Childline review the report' });
  }
  const id = `f_${nanoid(8)}`;
  const matchResult = await rankMatches(req.file?.buffer || null, {
    gender: b.gender,
    ageApprox: validation.ageApprox,
  });
  const { candidates, engine: matchEngine } = matchResult;
  const canRunMatch = !!req.file;
  const best = candidates[0];
  // Calibrated against real Aarakshak output: photographs of the same person
  // score 0.48-0.86, different people score below 0.07. 0.6 sat inside the
  // genuine-match range and routed real matches away from police review.
  // This only decides whether an officer is shown the candidate - a human still
  // confirms - so it is set to catch matches, not to be conservative.
  // Photo quality is recorded for the reviewer but deliberately does NOT gate
  // routing. Gating on it was tried and rejected: the provider raises
  // `low_detector_confidence` on plenty of genuine matches too, so the filter
  // dropped a real one. Surfacing an extra face for a human to reject costs an
  // officer a minute; suppressing a real match costs a child.
  const lowQualityPhoto = Boolean(best?.lowQuality || best?.warnings?.length);
  const hasStrongMatch = canRunMatch && best && best.score >= MATCH_REVIEW_THRESHOLD;
  const matchedScope = hasStrongMatch ? { state: best.report.state || null, district: best.report.district || null } : {};
  const locationScope = inferLocationScope(b);
  const confidentialReporter = isTruthy(b.confidentialReporter);
  const reporterName = cleanText(b.reporterName, 120) || 'Anonymous citizen';
  const idProofType = SIGHTING_ID_PROOF_TYPES[b.idProofType] ? b.idProofType : null;
  const idProofNumberMasked = idProofType ? maskProofNumber(b.idProofNumber) : null;
  const fr = {
    id,
    ...(await storePhoto(id, req.file)),
    foundLocation: b.foundLocation || 'Unknown',
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
    note: b.note || null,
    ageApprox: validation.ageApprox,
    gender: ['Male', 'Female', 'Other'].includes(b.gender) ? b.gender : null,
    state: matchedScope.state || locationScope.state,
    district: matchedScope.district || locationScope.district,
    matchedReportId: hasStrongMatch ? best.report.id : null,
    photoQualityWarnings: best?.warnings?.length ? best.warnings : null,
    lowQualityPhoto: lowQualityPhoto || null,
    matchScore: best ? best.score : 0,
    status: hasStrongMatch ? 'pending_review' : 'no_match',
    photoConsent: req.file ? true : isTruthy(b.photoConsent),
    dataPurpose: req.file ? 'sighting_review_and_child_protection' : 'text_sighting_childline_intake',
    retentionUntil: retentionUntil(SIGHTING_PHOTO_RETENTION_DAYS),
    referredTo1098: true,
    referralStatus: hasStrongMatch ? 'Police review pending' : 'Childline/CWC intake queued',
    createdAt: Date.now(),
  };
  addFoundReport(fr);
  addActivity({ actor: publicReporterName(fr), action: 'Uploaded a spotted-child photo', target: fr.foundLocation, icon: 'upload', scope: { state: fr.state, district: fr.district, matchedReportId: fr.matchedReportId } });
  addAudit({
    actorName: publicReporterName(fr),
    actorRole: 'public',
    action: 'sighting.submitted',
    targetType: 'foundReport',
    targetId: fr.id,
    summary: `Public sighting submitted at ${fr.foundLocation}`,
    scope: { matchedReportId: fr.matchedReportId, state: fr.state, district: fr.district },
    metadata: { matchScore: fr.matchScore, status: fr.status, matchEngine, matchAttempted: canRunMatch, confidentialReporter, idProofType, idProofCaptured: fr.idProofVerified },
  });
  if (!hasStrongMatch) {
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
  res.status(201).json({
    foundReport: {
      id: fr.id,
      status: fr.status,
      foundLocation: fr.foundLocation,
      state: fr.state,
      district: fr.district,
      matchScore: fr.matchScore,
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
        ? 'No strong match yet. The report is saved and queued for Childline/CWC follow-up.'
        : 'Your text sighting is saved and queued for Childline/CWC follow-up. No face-match search was run because no photo was uploaded.',
    candidates: candidates.map((c, index) => ({
      rank: index + 1,
      score: c.score,
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
        reporterName: publicReporterName(f),
        reporterPhone: f.confidentialReporter ? null : f.reporterPhone || null,
        reporterPhoneVisible: f.confidentialReporter ? null : f.reporterPhone || null,
        matchedReport: matched ? {
          id: matched.id,
          childName: matched.childName,
          age: matched.age,
          gender: matched.gender,
          address: matched.address,
          state: matched.state,
          district: matched.district,
          parentName: matched.parentName,
          parentPhone: matched.parentPhone,
          status: matched.status,
          retentionUntil: matched.retentionUntil,
          dataPurpose: matched.dataPurpose,
        } : null,
      };
    }),
  });
});

router.post('/found/:id/review', protectedRoute, requireRole(...REVIEW_ROLES), (req, res) => {
  const f = findFoundReport(req.params.id);
  if (!f) return res.status(404).json({ error: 'Found report not found' });
  const visible = scopeFoundReports(req.user, [f], listReports()).length === 1;
  if (!visible) return res.status(403).json({ error: 'Found report is outside your jurisdiction' });

  const { decision } = req.body || {}; // 'matched' | 'rejected' | 'refer_cwc'
  if (!['matched', 'rejected', 'refer_cwc'].includes(decision)) {
    return res.status(400).json({ error: 'Review decision must be matched, rejected or refer_cwc' });
  }
  if (decision === 'matched' && !FORMAL_CASE_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only police or command roles can confirm reunification' });
  }

  if (decision === 'refer_cwc') {
    updateFoundReport(f.id, { status: 'referred_cwc', referredTo1098: true, referralStatus: 'Referred to Childline/CWC' });
    addActivity({ actor: req.user.name, action: 'Referred sighting to 1098/CWC', target: f.foundLocation, icon: 'referral', actorId: req.user.id, scope: { state: f.state, district: f.district, matchedReportId: f.matchedReportId } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.referred_cwc',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Referred sighting at ${f.foundLocation} to 1098/CWC`,
      scope: { matchedReportId: f.matchedReportId },
    });
    return res.json({ foundReport: findFoundReport(f.id) });
  }

  updateFoundReport(f.id, {
    status: decision === 'matched' ? 'matched' : 'rejected',
    referralStatus: decision === 'matched' ? 'Police match confirmed' : 'Police rejected match',
  });
  if (decision === 'matched' && f.matchedReportId) {
    const r = findReport(f.matchedReportId);
    if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Matched case is outside your jurisdiction' });
    updateReport(f.matchedReportId, { status: 'found', foundLocation: f.foundLocation, matchScore: f.matchScore });
    addActivity({ actor: req.user.name, action: 'Confirmed sighting match', target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.match_confirmed',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Confirmed sighting match for ${r.childName}`,
      scope: { state: r.state, district: r.district, reportId: r.id },
      metadata: { matchScore: f.matchScore },
    });
  } else {
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sighting.rejected',
      targetType: 'foundReport',
      targetId: f.id,
      summary: `Rejected sighting match at ${f.foundLocation}`,
      scope: { matchedReportId: f.matchedReportId },
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

  const { outcome, note } = req.body || {};
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

  const childName = cleanText(req.body?.childName, 80) || 'Unknown child';
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

  const age = optionalNumber(req.body?.ageApprox ?? f.ageApprox, 'Approximate age', { min: 0, max: 18, integer: true });
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

// Police confirm a match and (optionally) alert the parent by SMS.
router.post('/:id/confirm-match', protectedRoute, requireRole('police', 'sjpu', 'admin', 'super_admin'), (req, res) => {
  const r = findReport(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
  if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before match confirmation' });
  const { foundLocation, matchScore, sendSms } = req.body || {};
  updateReport(r.id, {
    status: 'found',
    foundLocation: foundLocation || r.foundLocation || 'Reported location',
    matchScore: matchScore != null ? Number(matchScore) : r.matchScore,
    smsSent: !!sendSms,
  });
  addActivity({ actor: req.user.name, action: sendSms ? 'Confirmed match & alerted parent' : 'Confirmed match', target: r.childName, icon: 'check', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'case.match_confirmed',
    targetType: 'report',
    targetId: r.id,
    summary: `${sendSms ? 'Confirmed match and alerted parent' : 'Confirmed match'} for ${r.childName}`,
    scope: { state: r.state, district: r.district },
    metadata: { sendSms: !!sendSms },
  });
  res.json({ report: findReport(r.id) });
});

router.post('/:id/send-sms', protectedRoute, requireRole('police', 'sjpu', 'admin', 'super_admin'), (req, res) => {
  const r = findReport(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
  if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before parent SMS alerts' });
  updateReport(r.id, { smsSent: true });
  addActivity({ actor: req.user.name, action: `SMS alert sent to ${r.parentName || 'parent'}`, target: r.childName, icon: 'sms', actorId: req.user.id, scope: { state: r.state, district: r.district, reportId: r.id } });
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'case.sms_sent',
    targetType: 'report',
    targetId: r.id,
    summary: `SMS alert sent for ${r.childName}`,
    scope: { state: r.state, district: r.district },
  });
  res.json({ ok: true, message: `SMS sent to ${r.parentPhone || 'parent'}`, report: findReport(r.id) });
});

router.post('/:id/case-workflow', protectedRoute, requireRole(...CASE_WORKFLOW_ROLES), (req, res) => {
  const r = findReport(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
  if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before institutional handoff' });

  const { action, note } = req.body || {};
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
  res.json({ users: assignableUsersForReport(req.user, r) });
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

  const { reason, note, foundLocation } = req.body || {};
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

  const target = {
    state: cleanText(req.body?.state, 80),
    district: cleanText(req.body?.district, 80),
    station: cleanText(req.body?.station, 120) || null,
  };
  const reason = cleanText(req.body?.reason, 500);
  if (!canTransferToJurisdiction(req.user, target)) {
    return res.status(403).json({ error: 'Target jurisdiction is outside your transfer authority' });
  }
  if (target.state === r.state && target.district === r.district && target.station === (r.station || null)) {
    return res.status(400).json({ error: 'Target jurisdiction is the same as current jurisdiction' });
  }

  const now = Date.now();
  const transfer = {
    from: { state: r.state || null, district: r.district || null, station: r.station || null },
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
    district: target.district,
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

router.post('/:id/verify-intake', protectedRoute, requireRole(...INTAKE_VERIFY_ROLES), (req, res) => {
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
  res.json({ report: findReport(r.id) });
});

router.post('/:id/bulletin', protectedRoute, requireRole(...BULLETIN_ROLES), (req, res) => {
  const r = findReport(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
  if (isPendingCitizenIntake(r)) return res.status(409).json({ error: 'Citizen/NGO intake must be verified before public bulletin publishing' });
  if (['found', 'closed'].includes(r.status)) return res.status(409).json({ error: 'Found or closed cases cannot be published as active public bulletins' });

  const publish = req.body?.publish !== false;
  const now = Date.now();
  const bulletin = publish
    ? {
        published: true,
        publishedAt: r.bulletin?.publishedAt || new Date(now).toISOString(),
        publishedById: req.user.id,
        publishedByName: req.user.name,
        agency: req.user.org || req.user.name,
      }
    : {
        ...(r.bulletin || {}),
        published: false,
        unpublishedAt: new Date(now).toISOString(),
        unpublishedById: req.user.id,
        unpublishedByName: req.user.name,
      };
  updateReport(r.id, { bulletin });
  addActivity({
    actor: req.user.name,
    action: publish ? 'Published public bulletin' : 'Unpublished public bulletin',
    target: r.childName,
    icon: publish ? 'broadcast' : 'eye',
    actorId: req.user.id,
    scope: { state: r.state, district: r.district, reportId: r.id },
  });
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: publish ? 'case.bulletin_published' : 'case.bulletin_unpublished',
    targetType: 'report',
    targetId: r.id,
    summary: `${publish ? 'Published' : 'Unpublished'} public bulletin for ${r.childName}`,
    scope: { state: r.state, district: r.district, reportId: r.id },
    metadata: { published: publish },
  });
  res.json({ report: findReport(r.id), bulletin: publish ? bulletinPayload(findReport(r.id)) : null });
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
  res.json(signedCaseExport(payload, 'case_handoff_export'));
});

router.get('/:id', protectedRoute, (req, res) => {
  const r = findReport(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (!canAccessReport(req.user, r)) return res.status(403).json({ error: 'Report is outside your jurisdiction' });
  res.json({ report: r });
});

export default router;
