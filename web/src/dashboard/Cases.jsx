import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  fmtDate, StatusBadge, Avatar, roleLabel,
  CategoryBadge, genderLabel, isAdultCase, personCategoryOf, PERSON_CATEGORY_OPTIONS,
  asList, txt, txtList, PhoneLink, ProtectedImage,
} from '../lib.jsx';
import { ErrorBoundary } from '../components.jsx';
import { useT, msg, currentLocale } from '../i18n.jsx';
import { useDisplay } from '../useDisplay.js';
import { useBackClose } from '../useBackClose.js';
import { POLICE_ROLES } from '../../../shared/scope.js';
import { photoNeedOf } from '../../../shared/photo-need.js';
import { MAIN_PHOTO, MAX_CASE_PHOTOS, extraPhotoUrl, viewPhotosOf } from '../../../shared/photo-set.js';
import { ActionMessage, ActionToast, useAction } from './useAction.jsx';
import { ConfirmMatchDialog, FamilyContactList, FamilyContactPanel, ReopenCasePanel, faceIndexFlag, photoCheckFlag } from './Reunite.jsx';
import { preparePhoto } from '../photoPrep.js';
import { RISK_BADGES, riskReasonLabel } from './riskLabels.js';
import { CASE_CREATE_ROLES } from './routes.js';
import NavIcon from './NavIcon.jsx';
import PhotoViewer from './PhotoViewer.jsx';

// Video, loaded only when an officer opens it (web/src/video/): searching a
// CCTV export for this person, and photos taken from a family's video.
const VideoCaseSearch = lazy(() => import('../video/VideoCaseSearch.jsx'));
const VideoFacePicker = lazy(() => import('../video/VideoFacePicker.jsx'));

/** "Trafficking risk: high" on a case row, when the case was raised. */
function RiskBadge({ risk, className = '' }) {
  const t = useT();
  const badge = RISK_BADGES[risk?.level];
  if (!badge) return null;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${badge.className} ${className}`}>
      {t(badge.label)}
    </span>
  );
}

const FORMAL_ACTION_ROLES = ['super_admin', 'admin', 'police', 'sjpu'];
const WORKFLOW_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const CASE_CLOSE_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'cwc', 'dcpu', 'cci', 'saa', 'jjb', 'state_nodal', 'sara'];
const CASE_ASSIGN_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const INVESTIGATION_CHECKLIST_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'state_nodal', 'crime_bureau'];
const INTAKE_VERIFY_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'cwc', 'dcpu', 'state_nodal'];
// Public appeals are off (shared/case-domain.js isPublicAppeal). These roles
// see the notice, and can still withdraw an appeal published before the rule.
const BULLETIN_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'state_nodal'];
// Who may re-run the photo search against earlier sightings: the same police
// roles that see police-provided records (shared/scope.js).
const REMATCH_ROLES = POLICE_ROLES;
const CASE_TRANSFER_ROLES = ['super_admin', 'admin', 'state_nodal'];
// Taking a found or closed case back to missing (POST /reports/:id/reopen).
const REOPEN_ROLES = POLICE_ROLES;
// Replacing a case photo that cannot be matched (POST /reports/:id/photo).
const PHOTO_REPLACE_ROLES = POLICE_ROLES;

/**
 * A small flag for a case whose photos cannot be matched: no face, or only a
 * group photo (shared/photo-need.js). A bad main photo beside a usable one is
 * not flagged: matching uses the usable one.
 */
function photoChipVerdict(report) {
  const need = photoNeedOf(report);
  const main = report?.photoCheck?.verdict;
  // 'weak' (the gallery refused it) on a main photo whose own check found no
  // face or a group still shows that flag.
  if (need === 'group' || (need === 'weak' && main === 'multiple_faces')) return 'multiple_faces';
  if (need === 'no_face' || (need === 'weak' && main === 'no_face')) return 'no_face';
  return null;
}

function PhotoCheckChip({ report }) {
  const t = useT();
  const verdict = photoChipVerdict(report);
  if (!verdict) return null;
  const flag = photoCheckFlag({ verdict });
  return (
    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${flag.className}`}>
      {verdict === 'multiple_faces' ? t('Group photo') : t('Photo not usable for matching')}
    </span>
  );
}
const CCI_CARE_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'];
const JJB_PROCEEDING_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'jjb', 'state_nodal'];
const STATE_ESCALATION_ROLES = ['super_admin', 'admin', 'state_nodal', 'sara'];
const BUREAU_REPORT_ROLES = ['super_admin', 'admin', 'state_nodal', 'crime_bureau', 'dcrb'];
const RESTORATION_PLAN_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'cci', 'saa', 'jjb', 'rpf', 'state_nodal', 'sara'];
const EXTERNAL_ID_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'state_nodal', 'sara', 'crime_bureau'];
const WELFARE_REFERRAL_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'cci', 'saa', 'jjb', 'dlsa', 'state_nodal', 'sara'];
const LEGAL_AID_REFERRAL_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'jjb', 'dlsa', 'state_nodal'];
const ADOPTION_RECORD_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'];
const CASE_ASSESSMENT_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'cci', 'saa', 'jjb', 'state_nodal', 'sara'];
const PRODUCTION_RECORD_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'rpf', 'cwc', 'dcpu', 'state_nodal'];
const WORKFLOW_ACTIONS = [
  { id: 'refer_cwc', childOnly: true, label: msg('Refer CWC'), roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dcpu', 'rpf', 'cci', 'jjb', 'state_nodal', 'crime_bureau'] },
  { id: 'assign_cci', childOnly: true, label: msg('Assign CCI'), roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'state_nodal'] },
  { id: 'refer_jjb', childOnly: true, label: msg('Refer JJB'), roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'cci', 'state_nodal'] },
  { id: 'escalate_state', label: msg('Refer to the State'), roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'cwc', 'dcpu', 'rpf', 'cci', 'jjb', 'crime_bureau'] },
  { id: 'notify_crime_bureau', label: msg('Notify Bureau'), roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'state_nodal'] },
];
const ASSIGNMENT_TYPES = [
  { id: 'investigation', label: msg('Investigation owner') },
  { id: 'welfare', label: msg('Welfare follow-up owner') },
  { id: 'railway', label: msg('Railway / transit owner') },
  { id: 'cci', childOnly: true, label: msg('CCI care owner') },
  { id: 'adoption', childOnly: true, label: msg('Adoption follow-up owner') },
  { id: 'jjb', childOnly: true, label: msg('JJB proceeding owner') },
  { id: 'bureau', label: msg('Records bureau owner') },
  { id: 'legal', label: msg('Legal aid owner') },
];
const INVESTIGATION_CHECKLIST_ITEMS = [
  { id: 'fir_registered', label: msg('FIR / GD registered') },
  { id: 'trackchild_updated', childOnly: true, label: msg('TrackChild updated') },
  { id: 'khoyapaya_checked', childOnly: true, label: msg('Khoya-Paya checked') },
  { id: 'cctns_linked', label: msg('CCTNS linked') },
  { id: 'ncrb_scrb_alerted', label: msg('NCRB / SCRB alerted') },
  { id: 'lookout_circulated', label: msg('Lookout circulated') },
  { id: 'railway_rpf_alerted', label: msg('Railway / RPF alerted') },
  { id: 'childline_1098_alerted', childOnly: true, label: msg('1098 alerted') },
  { id: 'cwc_informed', childOnly: true, label: msg('CWC informed') },
  { id: 'media_bulletin_reviewed', label: msg('Bulletin reviewed') },
  { id: 'family_statement_recorded', label: msg('Family statement') },
  { id: 'last_seen_verified', label: msg('Last-seen verified') },
];
const CASE_CLOSE_REASONS = [
  { id: 'restored_family', label: msg('Restored to family') },
  { id: 'transferred_cci', childOnly: true, label: msg('Transferred to CCI') },
  { id: 'adoption', childOnly: true, label: msg('Adoption / aftercare') },
  { id: 'repatriated', label: msg('Repatriated') },
  { id: 'death', label: msg('Death recorded') },
  { id: 'traced_not_reunited', label: msg('Traced, pending reunification') },
  { id: 'other', label: msg('Other closure') },
];
const CCI_ADMISSION_TYPES = [
  { id: 'temporary_shelter', label: msg('Temporary shelter') },
  { id: 'restoration_pending', label: msg('Restoration pending') },
  { id: 'medical_care', label: msg('Medical care') },
  { id: 'counselling', label: msg('Counselling') },
  { id: 'aftercare_followup', label: msg('Aftercare follow-up') },
];
const CCI_SERVICE_TYPES = [
  { id: 'education', label: msg('Education') },
  { id: 'vocational_training', label: msg('Vocational training') },
  { id: 'recreation', label: msg('Recreation') },
  { id: 'health_care', label: msg('Health care') },
  { id: 'counselling', label: msg('Counselling') },
  { id: 'family_tracing', label: msg('Family tracing') },
];
const CCI_PROGRESS_STATES = [
  { id: 'intake', label: msg('Report check') },
  { id: 'active', label: msg('Active') },
  { id: 'review_due', label: msg('Review due') },
  { id: 'ready_for_restoration', label: msg('Ready for restoration') },
  { id: 'completed', label: msg('Completed') },
];
const JJB_PROCEEDING_TYPES = [
  { id: 'preliminary_hearing', label: msg('Preliminary hearing') },
  { id: 'social_investigation_order', label: msg('Social investigation order') },
  { id: 'rehabilitation_direction', label: msg('Rehabilitation direction') },
  { id: 'family_tracing_direction', label: msg('Family tracing direction') },
  { id: 'final_order_review', label: msg('Final order review') },
];
const STATE_ESCALATION_TYPES = [
  { id: 'inter_district_coordination', label: msg('Inter-district coordination') },
  { id: 'interstate_coordination', label: msg('Interstate coordination') },
  { id: 'resource_support', label: msg('Resource support') },
  { id: 'policy_exception', label: msg('Policy exception') },
  { id: 'urgent_rescue_coordination', label: msg('Urgent rescue coordination') },
];
const STATE_ESCALATION_LEVELS = [
  { id: 'district_to_state', label: msg('District to state') },
  { id: 'state_task_force', label: msg('State task force') },
  { id: 'interstate_desk', label: msg('Interstate desk') },
  { id: 'national_command', label: msg('National desk') },
];
const BUREAU_REPORT_TYPES = [
  { id: 'ncrb_missing_child_update', label: msg('NCRB missing-child update') },
  { id: 'scrb_state_update', label: msg('SCRB state update') },
  { id: 'interstate_alert', label: msg('Interstate alert') },
  { id: 'recurring_pattern_review', label: msg('Recurring pattern review') },
  { id: 'final_trace_update', label: msg('Final trace update') },
];
const BUREAU_LEVELS = [
  { id: 'ncrb', label: msg('NCRB') },
  { id: 'scrb', label: msg('SCRB') },
  { id: 'state_control_room', label: msg('State control room') },
];
const BUREAU_PRIORITIES = [
  { id: 'routine', label: msg('Routine') },
  { id: 'priority', label: msg('Priority') },
  { id: 'urgent', label: msg('Urgent') },
];
const RESTORATION_TYPES = [
  { id: 'family_restoration', label: msg('Family restoration') },
  { id: 'interstate_transfer', label: msg('Interstate restoration') },
  { id: 'inter_district_transfer', label: msg('Inter-district restoration') },
  { id: 'international_repatriation', label: msg('International repatriation') },
  { id: 'cci_aftercare', label: msg('CCI aftercare follow-up') },
];
const RESTORATION_STATUSES = [
  { id: 'planned', label: msg('Planned') },
  { id: 'documents_pending', label: msg('Documents pending') },
  { id: 'transit_scheduled', label: msg('Transit scheduled') },
  { id: 'handed_over', label: msg('Handed over') },
  { id: 'followup_due', label: msg('Follow-up due') },
  { id: 'completed', label: msg('Completed') },
];
const RESTORATION_SUPPORTS = [
  { id: 'interpreter', label: msg('Interpreter') },
  { id: 'escort', label: msg('Escort') },
  { id: 'medical', label: msg('Medical') },
  { id: 'counsellor', label: msg('Counsellor') },
  { id: 'documents', label: msg('Documents') },
  { id: 'other', label: msg('Other') },
];
const RESTORATION_TRAVEL_MODES = [
  { id: 'rail', label: msg('Rail') },
  { id: 'road', label: msg('Road') },
  { id: 'air', label: msg('Air') },
  { id: 'mixed', label: msg('Mixed route') },
  { id: 'local_handover', label: msg('Local handover') },
  { id: 'not_required', label: msg('Not required') },
];
const RESTORATION_DOCUMENT_STATUSES = [
  { id: 'not_started', label: msg('Not started') },
  { id: 'pending', label: msg('Pending') },
  { id: 'verified', label: msg('Verified') },
  { id: 'exception_approved', label: msg('Exception approved') },
];
const RESTORATION_FUNDING_SOURCES = [
  { id: 'dcpu', label: msg('DCPU') },
  { id: 'cwc', label: msg('CWC') },
  { id: 'state', label: msg('State') },
  { id: 'ngo', label: msg('NGO / CSR') },
  { id: 'family', label: msg('Family') },
  { id: 'not_required', label: msg('Not required') },
];
const EXTERNAL_ID_TYPES = [
  { id: 'trackchild', label: msg('TrackChild ID') },
  { id: 'khoyapaya', label: msg('Khoya-Paya ID') },
  { id: 'ncrb', label: msg('NCRB ID') },
  { id: 'scrb', label: msg('SCRB ID') },
  { id: 'cctns', label: msg('CCTNS / FIR link') },
  { id: 'ghar', label: msg('GHAR restoration ID') },
  { id: 'state_portal', label: msg('State portal ID') },
  { id: 'other', label: msg('Other external ID') },
];
const WELFARE_SCHEMES = [
  { id: 'sponsorship', label: msg('Sponsorship care') },
  { id: 'foster_care', label: msg('Foster care') },
  { id: 'adoption_facilitation', label: msg('Adoption facilitation') },
  { id: 'aftercare', label: msg('Aftercare') },
  { id: 'counselling', label: msg('Counselling') },
  { id: 'medical_support', label: msg('Medical support') },
  { id: 'education_support', label: msg('Education support') },
  { id: 'family_strengthening', label: msg('Family strengthening') },
];
const WELFARE_STATUSES = [
  { id: 'referred', label: msg('Referred') },
  { id: 'eligibility_review', label: msg('Eligibility review') },
  { id: 'approved', label: msg('Approved') },
  { id: 'active', label: msg('Active') },
  { id: 'completed', label: msg('Completed') },
  { id: 'rejected', label: msg('Rejected') },
];
const LEGAL_AID_SERVICE_TYPES = [
  { id: 'legal_aid', label: msg('Legal aid') },
  { id: 'victim_compensation', label: msg('Victim compensation') },
  { id: 'court_support', label: msg('Court support') },
  { id: 'counselling_order_support', label: msg('Counselling / protection order support') },
  { id: 'document_affidavit', label: msg('Document or affidavit support') },
  { id: 'other', label: msg('Other legal service') },
];
const LEGAL_AID_STATUSES = [
  { id: 'referred', label: msg('Referred') },
  { id: 'application_filed', label: msg('Application filed') },
  { id: 'approved', label: msg('Approved') },
  { id: 'active', label: msg('Active') },
  { id: 'completed', label: msg('Completed') },
  { id: 'rejected', label: msg('Rejected') },
];
const ADOPTION_RECORD_TYPES = [
  { id: 'cwc_order', label: msg('CWC adoption order / declaration') },
  { id: 'legally_free_declaration', label: msg('Legally free declaration') },
  { id: 'carings_registration', label: msg('CARINGS registration') },
  { id: 'saa_intake', label: msg('SAA admission') },
  { id: 'sara_review', label: msg('SARA review') },
  { id: 'pre_adoption_foster_care', label: msg('Pre-adoption foster care') },
  { id: 'followup_visit', label: msg('Follow-up visit') },
  { id: 'other', label: msg('Other adoption action') },
];
const ADOPTION_STATUSES = [
  { id: 'initiated', label: msg('Initiated') },
  { id: 'pending_documents', label: msg('Documents pending') },
  { id: 'cwc_review', label: msg('CWC review') },
  { id: 'carings_updated', label: msg('CARINGS updated') },
  { id: 'saa_care', label: msg('SAA care') },
  { id: 'sara_review', label: msg('SARA review') },
  { id: 'completed', label: msg('Completed') },
  { id: 'on_hold', label: msg('On hold') },
];
const CASE_ASSESSMENT_TYPES = [
  { id: 'social_investigation_report', label: msg('Social Investigation Report') },
  { id: 'individual_care_plan', label: msg('Individual Care Plan') },
  { id: 'family_assessment', label: msg('Family assessment') },
  { id: 'risk_assessment', label: msg('Risk assessment') },
  { id: 'rehabilitation_plan', label: msg('Rehabilitation plan') },
];
const CASE_RISK_LEVELS = [
  { id: 'low', label: msg('Low') },
  { id: 'medium', label: msg('Medium') },
  { id: 'high', label: msg('High') },
  { id: 'critical', label: msg('Critical') },
];
const PRODUCTION_TYPES = [
  { id: 'cwc', label: msg('Produced before CWC') },
  { id: 'jjb', label: msg('Produced before JJB') },
  { id: 'emergency_medical', label: msg('Emergency medical production') },
  { id: 'cci_intake', label: msg('Produced for CCI admission') },
];
const PRODUCTION_OUTCOMES = [
  { id: 'care_order_pending', label: msg('Care order pending') },
  { id: 'sent_medical', label: msg('Sent for medical care') },
  { id: 'sent_cci', label: msg('Sent to CCI') },
  { id: 'restored_guardian', label: msg('Restored to guardian') },
  { id: 'police_inquiry', label: msg('Police inquiry pending') },
  { id: 'repatriation_started', label: msg('Repatriation started') },
];

/** Milliseconds for sorting, whether a record holds an ISO string or a number. */
function toMs(value) {
  const ms = typeof value === 'number' ? value : new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/*
 * How the register can be ordered. Newest registered stays the default; the
 * longest missing is how a review of stale cases starts, and the most recently
 * missing is where the first hours are still being spent.
 */
const missingAt = (r) => toMs(r.dateOfMissing || r.createdAt);
const SORTS = {
  registered: { label: msg('Newest registered'), compare: (a, b) => toMs(b.createdAt) - toMs(a.createdAt) },
  missing_recent: { label: msg('Missing most recently'), compare: (a, b) => missingAt(b) - missingAt(a) },
  missing_longest: { label: msg('Missing longest'), compare: (a, b) => missingAt(a) - missingAt(b) },
};

// Rows drawn at a time. A state register runs to thousands of cases, and each
// row's photograph is a request of its own: all of them at once froze a phone.
const PAGE_SIZE = 50;

// The deck's "Basic Table": the operational register of children, scoped by role.
export default function Cases() {
  const t = useT();
  // Record text (names, references, addresses) in the reader's script.
  const d = useDisplay();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [districtFilter, setDistrictFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  // Every action in this page runs through one wrapper (useAction.jsx).
  const action = useAction();
  const [loadError, setLoadError] = useState('');
  // { report, sightingId } while the confirmation dialog is open.
  const [confirming, setConfirming] = useState(null);
  // The family phone a confirmation answered with, for a case showing none.
  const [familyPhoneHint, setFamilyPhoneHint] = useState({ id: '', phone: '' });
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState('registered');
  // Only the cases with a possible match waiting for an officer's decision.
  const [matchOnly, setMatchOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const loadRun = useRef(0);
  // A link can open the list filtered (/app/cases?status=intake_pending, from
  // the Overview's "Intakes to verify").
  const [status, setStatus] = useState(() => {
    try {
      const wanted = new URLSearchParams(window.location.search).get('status') || '';
      return ['intake_pending', 'missing', 'under_review', 'found', 'closed'].includes(wanted) ? wanted : '';
    } catch {
      return '';
    }
  });
  const [selected, setSelected] = useState(null);
  // The case whose photos are open full size (PhotoViewer), and the photo
  // it opens on: { caseId, startId }.
  const [photoView, setPhotoView] = useState(null);
  // Phone only: the area and date filters are folded away until asked for.
  const [filtersOpen, setFiltersOpen] = useState(false);
  useBackClose(!!selected, () => setSelected(null));
  const [closure, setClosure] = useState({ reason: 'restored_family', note: '', foundLocation: '' });
  const [verify, setVerify] = useState({ firNo: '', note: '' });
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [assignment, setAssignment] = useState({ assigneeId: '', assignmentType: 'investigation', dueDate: '', note: '' });
  const [investigationChecklist, setInvestigationChecklist] = useState({
    items: ['fir_registered', 'trackchild_updated'],
    officerName: user.name || '',
    stationDiaryNo: '',
    actionDate: new Date().toISOString().slice(0, 10),
    followupDate: '',
    note: '',
  });
  const [transfer, setTransfer] = useState({ state: user.jurisdiction?.state || '', district: '', station: '', reason: '' });
  const [cciCare, setCciCare] = useState({
    admissionType: 'temporary_shelter',
    cciName: user.org || '',
    admissionDate: new Date().toISOString().slice(0, 10),
    nextReviewDate: '',
    services: [],
    progressStatus: 'intake',
    healthStatus: '',
    educationStatus: '',
    counsellingStatus: '',
    familyTracingStatus: '',
    carePlan: '',
  });
  const [jjbProceeding, setJjbProceeding] = useState({
    proceedingType: 'preliminary_hearing',
    boardName: user.role === 'jjb' ? user.org || '' : '',
    caseNo: '',
    orderDate: new Date().toISOString().slice(0, 10),
    nextHearingDate: '',
    directions: '',
  });
  const [stateEscalation, setStateEscalation] = useState({
    escalationType: 'inter_district_coordination',
    escalationLevel: user.role === 'state_nodal' ? 'state_task_force' : 'district_to_state',
    priority: 'priority',
    authorityName: user.role === 'state_nodal' ? user.org || '' : '',
    referenceNo: '',
    escalatedDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    actionRequired: '',
  });
  const [bureauReport, setBureauReport] = useState({
    reportType: 'ncrb_missing_child_update',
    bureauLevel: user.role === 'crime_bureau' ? 'scrb' : 'state_control_room',
    priority: 'routine',
    referenceNo: '',
    submittedDate: new Date().toISOString().slice(0, 10),
    nextReviewDate: '',
    summary: '',
  });
  const [restorationPlan, setRestorationPlan] = useState({
    restorationType: 'family_restoration',
    status: 'planned',
    fromState: user.jurisdiction?.state || '',
    fromDistrict: user.jurisdiction?.district || '',
    toState: '',
    toDistrict: '',
    guardianName: '',
    handoverAuthority: user.org || '',
    plannedDate: '',
    followupDate: '',
    travelMode: 'not_required',
    travelDate: '',
    escortAuthority: '',
    escortContact: '',
    documentStatus: 'pending',
    documentReference: '',
    fundingSource: 'not_required',
    fundingReference: '',
    supports: [],
    remarks: '',
  });
  const [externalId, setExternalId] = useState({
    idType: 'trackchild',
    externalId: '',
    issuingSystem: 'Mission Vatsalya / TrackChild',
    issuedDate: new Date().toISOString().slice(0, 10),
    remarks: '',
  });
  const [welfareReferral, setWelfareReferral] = useState({
    scheme: 'sponsorship',
    status: 'referred',
    agencyName: user.org || '',
    referralNo: '',
    referredDate: new Date().toISOString().slice(0, 10),
    reviewDate: '',
    eligibilityNote: '',
  });
  const [legalAidReferral, setLegalAidReferral] = useState({
    serviceType: 'legal_aid',
    status: 'referred',
    authorityName: user.org || '',
    applicationNo: '',
    referredDate: new Date().toISOString().slice(0, 10),
    hearingDate: '',
    reviewDate: '',
    note: '',
  });
  const [adoptionRecord, setAdoptionRecord] = useState({
    recordType: 'carings_registration',
    status: 'initiated',
    agencyName: user.org || '',
    caringsId: '',
    orderNo: '',
    orderDate: new Date().toISOString().slice(0, 10),
    nextReviewDate: '',
    note: '',
  });
  const [caseAssessment, setCaseAssessment] = useState({
    assessmentType: 'social_investigation_report',
    riskLevel: 'medium',
    assessorName: user.name || '',
    assessmentDate: new Date().toISOString().slice(0, 10),
    nextReviewDate: '',
    findings: '',
    carePlan: '',
    recommendation: '',
  });
  const [productionRecord, setProductionRecord] = useState({
    productionType: 'cwc',
    outcome: 'care_order_pending',
    authorityName: user.org || '',
    orderNo: '',
    rescueAt: '',
    producedAt: '',
    nextAction: '',
  });
  const [caseNote, setCaseNote] = useState('');
  // { caseId, count, engine } after "Search earlier sightings" answers.
  const [rematch, setRematch] = useState(null);
  // A replacement case photo being chosen, and what the server said of it.
  const [photoReplace, setPhotoReplace] = useState({ caseId: '', file: null, consent: false });
  // Photos the family brought, to add beside the others (POST /:id/photos).
  const [photoAdd, setPhotoAdd] = useState({ caseId: '', files: [], consent: false });
  // Which case's video panels are open: the CCTV search, and photos from a
  // family's video. Each is closed again when another case is opened.
  const [videoSearchOpen, setVideoSearchOpen] = useState(null);
  const [videoPhotosOpen, setVideoPhotosOpen] = useState(null);
  const [photoResult, setPhotoResult] = useState(null);
  const canAct = FORMAL_ACTION_ROLES.includes(user.role);

  /** Filter options drawn from the caseload, so nothing offered returns zero. */
  const facets = useMemo(
    () => ({
      states: [...new Set(rows.map((r) => txt(r.state)).filter(Boolean))].sort(),
      districts: [
        ...new Set(
          rows
            .filter((r) => !stateFilter || r.state === stateFilter)
            .map((r) => txt(r.district))
            .filter(Boolean)
        ),
      ].sort(),
    }),
    [rows, stateFilter]
  );

  /**
   * Newest first, and filtered by area, gender and date.
   *
   * The list arrived in whatever order the store returned, so a case registered
   * this morning could sit anywhere in it. The most recent record is the one an
   * officer is most likely to be looking for.
   */
  const visibleRows = useMemo(() => {
    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate).getTime() + 86399999 : null;
    return rows
      .filter((r) => {
        if (stateFilter && r.state !== stateFilter) return false;
        if (districtFilter && r.district !== districtFilter) return false;
        if (genderFilter && r.gender !== genderFilter) return false;
        if (categoryFilter && personCategoryOf(r) !== categoryFilter) return false;
        if (matchOnly && !r.pendingMatch) return false;
        if (from || to) {
          const when = new Date(r.dateOfMissing || r.createdAt || 0).getTime();
          if (!Number.isFinite(when)) return false;
          if (from && when < from) return false;
          if (to && when > to) return false;
        }
        return true;
      })
      .slice()
      .sort((SORTS[sort] || SORTS.registered).compare);
  }, [rows, stateFilter, districtFilter, genderFilter, categoryFilter, fromDate, toDate, sort, matchOnly]);
  const pageRows = visibleRows.slice(0, limit);
  const matchWaiting = useMemo(() => rows.filter((r) => r.pendingMatch).length, [rows]);
  // A new search or filter starts again from the top of the list.
  useEffect(() => setLimit(PAGE_SIZE), [rows, stateFilter, districtFilter, genderFilter, categoryFilter, fromDate, toDate, sort, matchOnly]);
  const activeFilters = [stateFilter, districtFilter, genderFilter, categoryFilter, fromDate, toDate, matchOnly].filter(Boolean).length;
  const canWorkflow = WORKFLOW_ROLES.includes(user.role);
  const canAssignCase = CASE_ASSIGN_ROLES.includes(user.role);
  const canRecordInvestigationChecklist = INVESTIGATION_CHECKLIST_ROLES.includes(user.role);
  const canCloseCase = CASE_CLOSE_ROLES.includes(user.role);
  const canVerifyIntake = INTAKE_VERIFY_ROLES.includes(user.role);
  const canManageBulletin = BULLETIN_ROLES.includes(user.role);
  const canRematch = REMATCH_ROLES.includes(user.role);
  const canTransferCase = CASE_TRANSFER_ROLES.includes(user.role);
  const canReopen = REOPEN_ROLES.includes(user.role);
  const canReplacePhoto = PHOTO_REPLACE_ROLES.includes(user.role);
  const canRecordCciCare = CCI_CARE_ROLES.includes(user.role);
  const canRecordJjbProceeding = JJB_PROCEEDING_ROLES.includes(user.role);
  const canRecordStateEscalation = STATE_ESCALATION_ROLES.includes(user.role);
  const canRecordBureauReport = BUREAU_REPORT_ROLES.includes(user.role);
  const canRecordRestorationPlan = RESTORATION_PLAN_ROLES.includes(user.role);
  const canLinkExternalId = EXTERNAL_ID_ROLES.includes(user.role);
  const canRecordWelfareReferral = WELFARE_REFERRAL_ROLES.includes(user.role);
  const canRecordLegalAidReferral = LEGAL_AID_REFERRAL_ROLES.includes(user.role);
  const canRecordAdoption = ADOPTION_RECORD_ROLES.includes(user.role);
  const canRecordCaseAssessment = CASE_ASSESSMENT_ROLES.includes(user.role);
  const canRecordProduction = PRODUCTION_RECORD_ROLES.includes(user.role);
  // Whether the open case is a woman or adult person: the child-protection
  // steps are not offered, and a traced adult is verified before any family
  // is told where they are.
  const adultCase = selected ? isAdultCase(selected) : false;
  const forCase = (option) => !adultCase || !option.childOnly;
  const workflowActions = WORKFLOW_ACTIONS.filter((a) => a.roles.includes(user.role)).filter(forCase);
  const assignmentTypes = ASSIGNMENT_TYPES.filter(forCase);
  const checklistItems = INVESTIGATION_CHECKLIST_ITEMS.filter(forCase);
  const closeReasons = CASE_CLOSE_REASONS.filter(forCase);

  // The register itself. A failure is said out loud: an empty table and a
  // table that could not load must not look the same.
  const load = () => {
    const run = ++loadRun.current;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    return api.get(`/reports?${params}`)
      .then((d) => {
        const fresh = asList(d?.reports).filter((r) => r && typeof r === 'object' && r.id);
        // A slower reply to an earlier search must not replace a newer one.
        if (run !== loadRun.current) return fresh;
        setRows(fresh);
        setLoadError('');
        // The open case keeps the list's view of its unconfirmed sighting.
        setSelected((prev) => {
          if (!prev) return prev;
          const row = fresh.find((r) => r.id === prev.id);
          return row ? { ...prev, pendingMatch: row.pendingMatch ?? null } : prev;
        });
        return fresh;
      })
      .catch((e) => {
        if (run === loadRun.current) setLoadError(txt(e?.message) || 'Request failed');
        return null;
      });
  };
  // The search runs as the officer types, a moment after the last key, rather
  // than only on Enter; the status filter applies at once.
  useEffect(() => {
    const id = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [status, q]);

  // Arriving from an alert or a sighting card (/app/cases?id=…) opens that
  // case rather than leaving the officer to find it in the list.
  const [search] = useSearchParams();
  const openId = search.get('id') || '';
  const openedFor = useRef('');
  useEffect(() => {
    if (!openId || openedFor.current === openId) return;
    const row = rows.find((r) => r.id === openId);
    if (row) {
      setSelected(row);
      openedFor.current = openId;
    }
  }, [openId, rows]);

  // A message about the last case must not sit on the next one.
  const clearAction = action.clear;
  useEffect(() => { clearAction(); }, [selected?.id, clearAction]);

  /**
   * An action answers with the updated case. The list's `pendingMatch` (the
   * strongest unconfirmed sighting) is not part of that answer, so it is
   * carried over from what was on screen.
   */
  const showReport = (report) => {
    if (!report || typeof report !== 'object') return;
    setSelected((prev) => ({
      ...report,
      pendingMatch: report.pendingMatch !== undefined
        ? report.pendingMatch
        : prev && prev.id === report.id ? prev.pendingMatch ?? null : null,
    }));
  };

  useEffect(() => {
    if (!selected || !canAssignCase || ['found', 'closed', 'intake_pending'].includes(selected.status)) {
      setAssignableUsers([]);
      return;
    }
    api.get(`/reports/${selected.id}/assignable-users`)
      .then((data) => {
        const users = asList(data?.users).filter((item) => item && item.id);
        setAssignableUsers(users);
        setAssignment((prev) => {
          const preferred = users.some((item) => item.id === selected.assignedToId)
            ? selected.assignedToId
            : users[0]?.id || '';
          return { ...prev, assigneeId: preferred };
        });
      })
      .catch(() => setAssignableUsers([]));
  }, [selected?.id, selected?.status, selected?.assignedToId, canAssignCase]);

  /**
   * The dialog's submit. With a linked sighting the sighting is confirmed
   * (which marks the case found); without one the case records an in-person
   * recovery. Either way the server requires the verification record, and a
   * refusal throws so its reason shows in the dialog. Nobody is messaged: the
   * family panel that replaces this section is where the officer calls them.
   */
  const submitConfirmation = async (verification) => {
    const { report, sightingId } = confirming;
    const data = sightingId
      ? await api.post(`/reports/found/${sightingId}/review`, { decision: 'matched', verification })
      : await api.post(`/reports/${report.id}/confirm-match`, {
          verification,
          foundLocation: txt(report.foundLocation) || verification.place,
        });
    setFamilyPhoneHint({ id: report.id, phone: txt(data?.familyPhone) });
    setConfirming(null);
    const fresh = data?.report ? data : await api.get(`/reports/${report.id}`).catch(() => null);
    if (fresh?.report) showReport({ ...fresh.report, pendingMatch: null });
    load();
  };

  const caseWorkflow = (r, workflowAction) => action.run('workflow', async () => {
    const data = await api.post(`/reports/${r.id}/case-workflow`, { action: workflowAction });
    showReport(data.report);
    load();
  }, msg('Handover recorded.'));

  const assignOwner = (r) => action.run('assign', async () => {
    // A child-only owner type picked on an earlier case is not offered here.
    const assignmentType = assignmentTypes.some((type) => type.id === assignment.assignmentType)
      ? assignment.assignmentType
      : 'investigation';
    const data = await api.post(`/reports/${r.id}/assign-owner`, { ...assignment, assignmentType });
    showReport(data.report);
    setAssignment((current) => ({ ...current, dueDate: '', note: '' }));
    load();
  }, msg('Owner assigned.'));

  const closeCase = (r) => action.run('close', async () => {
    const data = await api.post(`/reports/${r.id}/close-case`, {
      reason: closeReasons.some((reason) => reason.id === closure.reason) ? closure.reason : closeReasons[0].id,
      note: closure.note,
      foundLocation: closure.foundLocation || txt(r.foundLocation) || undefined,
    });
    showReport(data.report);
    setClosure({ reason: 'restored_family', note: '', foundLocation: '' });
    load();
  }, msg('Case closed.'));

  const addNote = (r) => action.run('note', async () => {
    const data = await api.post(`/reports/${r.id}/notes`, { note: caseNote });
    showReport(data.report);
    setCaseNote('');
    load();
  }, msg('Note added.'));

  const verifyIntake = (r) => action.run('verify', async () => {
    const data = await api.post(`/reports/${r.id}/verify-intake`, verify);
    showReport(data.report);
    setVerify({ firNo: '', note: '' });
    load();
  }, msg('Report checked.'));

  // Only ever called to withdraw: publishing is refused by the server.
  const withdrawBulletin = (r) => action.run('bulletin', async () => {
    const data = await api.post(`/reports/${r.id}/bulletin`, { publish: false });
    if (data.report) showReport(data.report);
    load();
  }, msg('The old public appeal was withdrawn.'));

  /*
   * Compares this case's photo with sightings already received that are not
   * linked to any case. Possible matches land in the Matches queue exactly as
   * a forward match does; an officer still confirms each one, and the person
   * who sent the sighting is never told anything.
   */
  const searchEarlierSightings = (r) => {
    setRematch(null);
    return action.run('rematch', async () => {
      const data = await api.post(`/reports/${r.id}/rematch`);
      // The server's engine summary: { provider, biometric, comparedAgainst,
      // note }. `biometric: false` means no face was compared at all (no
      // provider answered, or the search could not run), which is a different
      // answer from "compared, and nothing matched".
      const engine = data.engine && typeof data.engine === 'object'
        ? {
            provider: txt(data.engine.provider),
            biometric: Boolean(data.engine.biometric),
            comparedAgainst: Number(data.engine.comparedAgainst) || 0,
            note: txt(data.engine.note),
          }
        : null;
      setRematch({ caseId: r.id, count: Number(data.sightingMatches) || 0, engine });
      load();
    });
  };

  /*
   * Replaces a case photo that has no face in it, or shows a group: the new
   * one is checked for a face, replaces the old one in the search, and is
   * compared with the sightings already received. Nobody outside the police
   * is told anything.
   */
  const replacePhoto = (r) => action.run('photo', async () => {
    const chosen = photoReplace.caseId === r.id ? photoReplace.file : null;
    if (!chosen) return;
    const form = new FormData();
    form.set('photo', await preparePhoto(chosen));
    if (photoReplace.consent) form.set('photoConsent', 'true');
    const data = await api.postForm(`/reports/${r.id}/photo`, form);
    if (data?.report) showReport(data.report);
    setPhotoReplace({ caseId: '', file: null, consent: false });
    setPhotoResult({ caseId: r.id, photoCheck: data?.photoCheck || null, sightingMatches: Number(data?.sightingMatches) || 0 });
    load();
  }, msg('Photo replaced.'));

  /*
   * More photos of the person (shared/photo-set.js): each is checked for a
   * face, the gallery is given the whole set, and the stored sightings are
   * searched again with the clearest new one.
   */
  const addPhotos = (r) => action.run('photos', async () => {
    const chosen = photoAdd.caseId === r.id ? photoAdd.files : [];
    if (!chosen.length) return;
    const form = new FormData();
    // A case with no photo yet: the first becomes its main photo (as `photo`),
    // so all five fit; the server holds at most four beside a main one.
    for (const [i, file] of chosen.entries()) {
      form.append(i === 0 && !txt(r.photoUrl) ? 'photo' : 'extraPhotos', await preparePhoto(file));
    }
    if (photoAdd.consent) form.set('photoConsent', 'true');
    const data = await api.postForm(`/reports/${r.id}/photos`, form);
    if (data?.report) showReport(data.report);
    setPhotoAdd({ caseId: '', files: [], consent: false });
    setPhotoResult({ caseId: r.id, photoCheck: data?.mainPhotoCheck || null, sightingMatches: Number(data?.sightingMatches) || 0, searched: data?.searched !== false });
    load();
  }, msg('Photos added.'));

  /** Makes one of the other photos the main one: shown on the case, compared first. */
  const makeMainPhoto = (r, photoId) => action.run('photos', async () => {
    const data = await api.post(`/reports/${r.id}/photos/${encodeURIComponent(photoId)}/main`, {});
    if (data?.report) showReport(data.report);
    load();
  }, msg('Main photo changed.'));

  const removePhoto = (r, photoId) => {
    if (!window.confirm(t('Remove this photo from the case? It is deleted.'))) return;
    action.run('photos', async () => {
      const data = await api.del(`/reports/${r.id}/photos/${encodeURIComponent(photoId)}`);
      if (data?.report) showReport(data.report);
      load();
    }, msg('Photo removed.'));
  };

  const exportHandoff = (r, targetSystem = 'trackchild') => action.run('export', async () => {
    const params = new URLSearchParams({
      targetSystem,
      includeHistory: 'true',
      purpose: 'Operational cross-system reconciliation',
    });
    const data = await api.get(`/reports/${r.id}/handoff-export?${params}`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `khozo-case-handoff-${r.id}-${targetSystem}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, msg('Handover file downloaded.'));

  const transferJurisdiction = (r) => action.run('transfer', async () => {
    const data = await api.post(`/reports/${r.id}/transfer-jurisdiction`, transfer);
    showReport(data.report);
    setTransfer({ state: user.jurisdiction?.state || '', district: '', station: '', reason: '' });
    load();
  }, msg('Case transferred.'));

  const recordCciCare = (r) => action.run('cci', async () => {
    const data = await api.post(`/reports/${r.id}/cci-care`, cciCare);
    showReport(data.report);
    setCciCare({
      admissionType: 'temporary_shelter',
      cciName: user.org || '',
      admissionDate: new Date().toISOString().slice(0, 10),
      nextReviewDate: '',
      services: [],
      progressStatus: 'intake',
      healthStatus: '',
      educationStatus: '',
      counsellingStatus: '',
      familyTracingStatus: '',
      carePlan: '',
    });
    load();
  }, msg('Record saved.'));

  const recordJjbProceeding = (r) => action.run('jjb', async () => {
    const data = await api.post(`/reports/${r.id}/jjb-proceeding`, jjbProceeding);
    showReport(data.report);
    setJjbProceeding({
      proceedingType: 'preliminary_hearing',
      boardName: user.role === 'jjb' ? user.org || '' : '',
      caseNo: '',
      orderDate: new Date().toISOString().slice(0, 10),
      nextHearingDate: '',
      directions: '',
    });
    load();
  }, msg('Record saved.'));

  const recordStateEscalation = (r) => action.run('escalation', async () => {
    const data = await api.post(`/reports/${r.id}/state-escalation`, stateEscalation);
    showReport(data.report);
    setStateEscalation({
      escalationType: 'inter_district_coordination',
      escalationLevel: user.role === 'state_nodal' ? 'state_task_force' : 'district_to_state',
      priority: 'priority',
      authorityName: user.role === 'state_nodal' ? user.org || '' : '',
      referenceNo: '',
      escalatedDate: new Date().toISOString().slice(0, 10),
      dueDate: '',
      actionRequired: '',
    });
    load();
  }, msg('Record saved.'));

  const recordBureauReport = (r) => action.run('bureau', async () => {
    const data = await api.post(`/reports/${r.id}/bureau-report`, bureauReport);
    showReport(data.report);
    setBureauReport({
      reportType: 'ncrb_missing_child_update',
      bureauLevel: user.role === 'crime_bureau' ? 'scrb' : 'state_control_room',
      priority: 'routine',
      referenceNo: '',
      submittedDate: new Date().toISOString().slice(0, 10),
      nextReviewDate: '',
      summary: '',
    });
    load();
  }, msg('Record saved.'));

  const setRestorationSupport = (id) => {
    setRestorationPlan((current) => ({
      ...current,
      supports: current.supports.includes(id)
        ? current.supports.filter((item) => item !== id)
        : [...current.supports, id],
    }));
  };

  const setCciService = (id) => {
    setCciCare((current) => ({
      ...current,
      services: current.services.includes(id)
        ? current.services.filter((item) => item !== id)
        : [...current.services, id],
    }));
  };

  const setInvestigationChecklistItem = (id) => {
    setInvestigationChecklist((current) => ({
      ...current,
      items: current.items.includes(id)
        ? current.items.filter((item) => item !== id)
        : [...current.items, id],
    }));
  };

  const recordInvestigationChecklist = (r) => action.run('checklist', async () => {
    const data = await api.post(`/reports/${r.id}/investigation-checklist`, {
      ...investigationChecklist,
      // A box ticked on a child's case and hidden for this one is not sent.
      items: investigationChecklist.items.filter((id) => checklistItems.some((item) => item.id === id)),
    });
    showReport(data.report);
    setInvestigationChecklist({
      items: ['fir_registered', 'trackchild_updated'],
      officerName: user.name || '',
      stationDiaryNo: '',
      actionDate: new Date().toISOString().slice(0, 10),
      followupDate: '',
      note: '',
    });
    load();
  }, msg('Record saved.'));

  const recordRestorationPlan = (r) => action.run('restoration', async () => {
    const data = await api.post(`/reports/${r.id}/restoration-plan`, restorationPlan);
    showReport(data.report);
    setRestorationPlan({
      restorationType: 'family_restoration',
      status: 'planned',
      fromState: user.jurisdiction?.state || '',
      fromDistrict: user.jurisdiction?.district || '',
      toState: '',
      toDistrict: '',
      guardianName: '',
      handoverAuthority: user.org || '',
      plannedDate: '',
      followupDate: '',
      travelMode: 'not_required',
      travelDate: '',
      escortAuthority: '',
      escortContact: '',
      documentStatus: 'pending',
      documentReference: '',
      fundingSource: 'not_required',
      fundingReference: '',
      supports: [],
      remarks: '',
    });
    load();
  }, msg('Record saved.'));

  const linkExternalId = (r) => action.run('external-id', async () => {
    const data = await api.post(`/reports/${r.id}/external-id`, externalId);
    showReport(data.report);
    setExternalId({
      idType: 'trackchild',
      externalId: '',
      issuingSystem: 'Mission Vatsalya / TrackChild',
      issuedDate: new Date().toISOString().slice(0, 10),
      remarks: '',
    });
    load();
  }, msg('External ID linked.'));

  const recordWelfareReferral = (r) => action.run('welfare', async () => {
    const data = await api.post(`/reports/${r.id}/welfare-referral`, welfareReferral);
    showReport(data.report);
    setWelfareReferral({
      scheme: 'sponsorship',
      status: 'referred',
      agencyName: user.org || '',
      referralNo: '',
      referredDate: new Date().toISOString().slice(0, 10),
      reviewDate: '',
      eligibilityNote: '',
    });
    load();
  }, msg('Record saved.'));

  const recordLegalAidReferral = (r) => action.run('legal-aid', async () => {
    const data = await api.post(`/reports/${r.id}/legal-aid-referral`, legalAidReferral);
    showReport(data.report);
    setLegalAidReferral({
      serviceType: 'legal_aid',
      status: 'referred',
      authorityName: user.org || '',
      applicationNo: '',
      referredDate: new Date().toISOString().slice(0, 10),
      hearingDate: '',
      reviewDate: '',
      note: '',
    });
    load();
  }, msg('Record saved.'));

  const recordAdoption = (r) => action.run('adoption', async () => {
    const data = await api.post(`/reports/${r.id}/adoption-record`, adoptionRecord);
    showReport(data.report);
    setAdoptionRecord({
      recordType: 'carings_registration',
      status: 'initiated',
      agencyName: user.org || '',
      caringsId: '',
      orderNo: '',
      orderDate: new Date().toISOString().slice(0, 10),
      nextReviewDate: '',
      note: '',
    });
    load();
  }, msg('Record saved.'));

  const recordCaseAssessment = (r) => action.run('assessment', async () => {
    const data = await api.post(`/reports/${r.id}/case-assessment`, caseAssessment);
    showReport(data.report);
    setCaseAssessment({
      assessmentType: 'social_investigation_report',
      riskLevel: 'medium',
      assessorName: user.name || '',
      assessmentDate: new Date().toISOString().slice(0, 10),
      nextReviewDate: '',
      findings: '',
      carePlan: '',
      recommendation: '',
    });
    load();
  }, msg('Record saved.'));

  const recordProduction = (r) => action.run('production', async () => {
    const data = await api.post(`/reports/${r.id}/production-record`, productionRecord);
    showReport(data.report);
    setProductionRecord({
      productionType: 'cwc',
      outcome: 'care_order_pending',
      authorityName: user.org || '',
      orderNo: '',
      rescueAt: '',
      producedAt: '',
      nextAction: '',
    });
    load();
  }, msg('Record saved.'));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('Cases & FIRs')}</h2>
          <p className="text-sm text-gray-500">
            {rows.length === 1 ? t('1 record in your area') : t('{n} records in your area', { n: rows.length })}
          </p>
        </div>
        {CASE_CREATE_ROLES.includes(user.role) && (
          <Link to="/app/register" className="btn-primary hidden sm:inline-flex">
            <NavIcon name="plus" className="h-4 w-4 shrink-0" /> {t('Register a missing person')}
          </Link>
        )}
      </div>

      {/*
        One toolbar: search and status on the first row, then area, gender and
        date, applied to the rows already in hand. A caseload is searched by
        "girls, this district, last fortnight" far more often than by name.
        On a phone the second row folds away behind one button.
      */}
      <div className="card p-3 sm:p-4">
        <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:gap-3">
          <form role="search" className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto" onSubmit={(e) => { e.preventDefault(); load(); }}>
            <NavIcon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              className="field field-icon"
              placeholder={t('Search name, FIR, place...')}
              aria-label={t('Search name, FIR, place...')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <select className="field min-w-0 flex-1 sm:w-48 sm:flex-none" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Status')}>
            <option value="">{t('All statuses')}</option>
            <option value="intake_pending">{t('Waiting to be checked')}</option>
            <option value="missing">{t('Missing')}</option>
            <option value="under_review">{t('Under review')}</option>
            <option value="found">{t('Found')}</option>
            <option value="closed">{t('Closed')}</option>
          </select>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className={`btn-ghost sm:hidden ${activeFilters ? 'ring-2 ring-khozo' : ''}`}
          >
            {activeFilters ? t('Filters ({n})', { n: activeFilters }) : t('Filters')}
          </button>
        </div>

        <div className={`mt-3 grid-cols-2 gap-3 border-t border-black/5 pt-3 sm:grid sm:grid-cols-3 xl:grid-cols-6 ${filtersOpen ? 'grid' : 'hidden'}`}>
          <div className="min-w-0">
            <label className="label">{t('State')}</label>
            <select className="field" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              <option value="">{t('Any state')}</option>
              {facets.states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label">{t('District')}</label>
            <select className="field" value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}>
              <option value="">{t('Any district')}</option>
              {facets.districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label">{t('Gender')}</label>
            <select className="field" value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)}>
              <option value="">{t('Any')}</option>
              <option value="Male">{t('Male')}</option>
              <option value="Female">{t('Female')}</option>
              <option value="Other">{t('Other')}</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="label">{t('Who is missing')}</label>
            <select className="field" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">{t('Anyone')}</option>
              {PERSON_CATEGORY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{t(option.label)}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label">{t('Missing from')}</label>
            <input type="date" className="field" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label className="label">{t('Missing to')}</label>
            <input type="date" className="field" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>

        {/*
          The cases waiting on an officer's decision, a tap away, and the order
          to read the register in. "Possible match" is the engine's proposal,
          never an identity: the toggle finds the cases to check, not answers.
        */}
        <div className={`mt-3 flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/5 pt-3 ${filtersOpen ? 'flex' : 'hidden sm:flex'}`}>
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium ring-1 ${matchOnly ? 'bg-amber-50 text-amber-900 ring-amber-300' : 'text-gray-600 ring-black/10 hover:bg-gray-50'}`}>
            <input type="checkbox" checked={matchOnly} onChange={(e) => setMatchOnly(e.target.checked)} />
            {t('Possible match waiting ({n})', { n: matchWaiting })}
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <span className="shrink-0">{t('Sort')}</span>
            <select className="field min-w-0 sm:w-52" value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([key, option]) => <option key={key} value={key}>{t(option.label)}</option>)}
            </select>
          </label>
          <p className="text-xs font-medium text-gray-500 sm:ml-auto">
            {t('{shown} of {total} shown', { shown: visibleRows.length, total: rows.length })}
          </p>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => { setStateFilter(''); setDistrictFilter(''); setGenderFilter(''); setCategoryFilter(''); setFromDate(''); setToDate(''); setMatchOnly(false); }}
              className="px-2 text-xs font-semibold text-khozo-dark hover:underline"
            >
              {t('Clear filters')}
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          {t('The case register could not load: {error}', { error: t(loadError) })}{' '}
          <button type="button" onClick={() => load()} className="font-semibold underline">{t('Retry')}</button>
        </div>
      )}

      {/*
        On a phone each case is a card: who, their status and any match
        waiting, then the facts an officer scans for. The wide register below
        is the same list for a desk screen.
      */}
      <ul className="space-y-3 sm:hidden">
        {pageRows.map((r) => (
          <li key={r.id} className="card overflow-hidden">
            <button type="button" className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setSelected(r)}>
              <Avatar name={d(r.childName)} src={r.photoUrl} size={52} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold capitalize">{d(r.childName)}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
                  <CategoryBadge category={personCategoryOf(r)} />
                  <span>{genderLabel(r.gender, personCategoryOf(r))} / {t('age {age}', { age: txt(r.age) || '-' })}</span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={r.status} />
                  <RiskBadge risk={r.traffickingRisk} />
                </span>
              </span>
              <span aria-hidden="true" className="mt-3 text-2xl leading-none text-gray-300">›</span>
            </button>
            {r.pendingMatch ? (
              <Link
                to={`/app/matches?id=${encodeURIComponent(r.pendingMatch.foundReportId)}`}
                className="mx-4 -mt-1 mb-3 flex min-h-11 items-center rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800 ring-1 ring-amber-200"
              >
                {t('Possible match · {pct}% similar · not verified', { pct: Math.round((Number(r.pendingMatch.score) || 0) * 100) })}
                {r.pendingMatch.corroborated ? ` · ${t('two checks')}` : ''}
                {r.pendingMatch.notChecked ? ` · ${t('not checked a second time')}` : ''}
              </Link>
            ) : null}
            {photoChipVerdict(r) && (
              <span className="mx-4 -mt-1 mb-3 block"><PhotoCheckChip report={r} /></span>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-black/5 px-4 py-3 text-sm">
              <div className="min-w-0">
                <dt className="text-gray-500">{t('FIR no.')}</dt>
                <dd className="truncate font-medium">{d(r.firNo) || '-'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-gray-500">{t('Missing since')}</dt>
                <dd className="font-medium">{fmtDate(r.dateOfMissing)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-gray-500">{t('Address')}</dt>
                <dd className="font-medium">{d.places(r.district, r.state) || d(r.address) || '-'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-gray-500">{t('Parent / contact')}</dt>
                <dd className="font-medium">
                  <span className="block truncate">{d(r.parentName) || '-'}</span>
                  <PhoneLink phone={r.parentPhone} />
                </dd>
              </div>
              {d(r.foundLocation) && (
                <div className="col-span-2 min-w-0">
                  <dt className="text-gray-500">{t('Found location')}</dt>
                  <dd className="font-medium">{d(r.foundLocation)}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
        {visibleRows.length === 0 && (
          <li className="card px-4 py-10 text-center text-gray-400">{t('No records found.')}</li>
        )}
      </ul>

      {/*
        The desk register. Eight columns where there were ten: the found
        location sits under the status it belongs to, and the place under the
        date the person went missing. Workflow and source give way below a
        wide screen; both are in the case panel. A click anywhere on a row
        opens the case; the name stays a button for the keyboard. On a narrow
        desk screen the table scrolls sideways and the action stays pinned.
      */}
      <div className="card hidden overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="whitespace-nowrap border-b border-black/5 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">{t('Missing person')}</th>
                <th className="px-4 py-3">{t('Status')}</th>
                <th className="px-4 py-3">{t('FIR no.')}</th>
                <th className="px-4 py-3">{t('Missing since')}</th>
                <th className="px-4 py-3">{t('Parent / contact')}</th>
                <th className="hidden px-4 py-3 xl:table-cell">{t('Steps taken')}</th>
                <th className="hidden px-4 py-3 xl:table-cell">{t('Source')}</th>
                {canAct && <th className="sticky right-0 bg-slate-50 px-4 py-3 text-right shadow-[-6px_0_6px_-6px_rgb(0_0_0/0.15)]">{t('Actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr
                  key={r.id}
                  onClick={(e) => { if (!e.target.closest('a, button')) setSelected(r); }}
                  className="group cursor-pointer border-b border-black/5 align-top transition-colors last:border-0 hover:bg-[#f7fbf1]"
                >
                  <td className="min-w-[13rem] px-4 py-3">
                    <button className="flex items-center gap-3 text-left" onClick={() => setSelected(r)}>
                      <Avatar name={d(r.childName)} src={r.photoUrl} size={40} />
                      <div className="min-w-0">
                        <p className="font-semibold capitalize text-gray-900">{d(r.childName)}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                          <CategoryBadge category={personCategoryOf(r)} />
                          <span className="whitespace-nowrap">{genderLabel(r.gender, personCategoryOf(r))} / {t('age {age}', { age: txt(r.age) || '-' })}</span>
                        </p>
                      </div>
                    </button>
                  </td>
                  <td className="min-w-[11rem] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={r.status} />
                      <RiskBadge risk={r.traffickingRisk} />
                    </div>
                    {/* An unconfirmed match is the most urgent fact about a case and
                        it does not change the case's status; without this line the
                        row reads "Missing" while the Matches queue holds a 71%. */}
                    {r.pendingMatch ? (
                      <Link
                        to={`/app/matches?id=${encodeURIComponent(r.pendingMatch.foundReportId)}`}
                        className="mt-1.5 inline-block max-w-[15rem] rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold leading-snug text-amber-800 ring-1 ring-amber-200 hover:bg-amber-200"
                      >
                        {t('Possible match · {pct}% similar · not verified', { pct: Math.round((Number(r.pendingMatch.score) || 0) * 100) })}
                        {r.pendingMatch.corroborated ? ` · ${t('two checks')}` : ''}
                        {r.pendingMatch.notChecked ? ` · ${t('not checked a second time')}` : ''}
                      </Link>
                    ) : null}
                    {d(r.foundLocation) && (
                      <p className="mt-1 max-w-[15rem] text-xs text-gray-500">
                        <span className="font-medium text-gray-600">{t('Found location')}:</span> {d(r.foundLocation)}
                      </p>
                    )}
                    <div><PhotoCheckChip report={r} /></div>
                  </td>
                  <td className="max-w-[11rem] px-4 py-3 text-gray-700">{d(r.firNo) || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3">
                    <p className="whitespace-nowrap font-medium text-gray-800">{fmtDate(r.dateOfMissing)}</p>
                    <p className="mt-0.5 max-w-[12rem] text-xs text-gray-500">{d.places(r.district, r.state) || d(r.address) || '-'}</p>
                  </td>
                  <td className="max-w-[14rem] px-4 py-3">
                    <p className="text-gray-700">{d(r.parentName) || '-'}</p>
                    <p className="text-xs"><PhoneLink phone={r.parentPhone} /></p>
                  </td>
                  <td className="hidden px-4 py-3 text-gray-600 xl:table-cell">{txt(r.workflowStatus) || <span className="text-gray-300">-</span>}</td>
                  <td className="hidden px-4 py-3 xl:table-cell"><span className="inline-block whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{roleLabel(r.registeredByRole)}</span></td>
                  {canAct && (
                    <td className="sticky right-0 whitespace-nowrap bg-white px-4 py-3 text-right shadow-[-6px_0_6px_-6px_rgb(0_0_0/0.15)] transition-colors group-hover:bg-[#f7fbf1]">
                      <button
                        onClick={() => setSelected(r)}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors ${
                          r.status === 'found' && r.familyInformedAt
                            ? 'text-gray-500 ring-gray-200 hover:bg-gray-50'
                            : 'text-khozo-dark ring-khozo/30 hover:bg-khozo-light'
                        }`}
                      >
                        {r.status === 'found' && r.familyInformedAt
                          ? t('Family informed')
                          : r.status === 'found' && !isAdultCase(r)
                            ? t('Call the family')
                            : t('Review')}
                        <span aria-hidden="true">→</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr><td colSpan={canAct ? 8 : 7} className="px-4 py-12 text-center text-gray-400">{t('No records found.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* The rest of a long register, fifty at a time. */}
      {visibleRows.length > limit && (
        <div className="flex flex-col items-center gap-2 py-2">
          <button type="button" className="btn-ghost" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            {t('Show {n} more', { n: Math.min(PAGE_SIZE, visibleRows.length - limit) })}
          </button>
          <p className="text-xs text-gray-500">{t('{shown} of {total} shown', { shown: pageRows.length, total: visibleRows.length })}</p>
        </div>
      )}

      {/*
        The case opens as a panel on a desk screen and as a full-screen sheet
        on a phone, with a back bar that stays in reach while the officer
        scrolls the record. The phone's Back button closes it too.
      */}
      {selected && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <div
            data-case-sheet
            role="dialog"
            aria-modal="true"
            aria-label={d(selected.childName) || selected.id}
            className="animate-sheet-in h-full w-full max-w-lg overflow-y-auto overscroll-contain bg-white shadow-xl sm:animate-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-black/5 bg-white/95 px-2 py-1 backdrop-blur sm:hidden">
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t('Close')}
                className="grid h-11 w-11 place-items-center rounded-xl text-gray-700 hover:bg-gray-100"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
              <p className="min-w-0 flex-1 truncate text-base font-semibold capitalize">{d(selected.childName)}</p>
              <span className="pr-2"><StatusBadge status={selected.status} /></span>
            </div>
            <div className="p-4 sm:p-6">
            <ErrorBoundary resetKey={selected.id}>
            {/*
              The photograph first and large enough to compare a face with:
              it is what an officer checks a person against. Then the record
              in four groups — who, when and where, family, the case itself —
              where it was one grid of twenty equal fields. A blank stays
              visible, muted: "no FIR number" is itself something to act on.
            */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-4">
                {/* Opens the photo whole, beside the sighting when one is
                    waiting, for the officer to compare faces by eye. */}
                {txt(selected.photoUrl) ? (
                  <button
                    type="button"
                    onClick={() => setPhotoView({ caseId: selected.id, startId: selected.pendingMatch?.photoPair?.case || MAIN_PHOTO })}
                    className="group relative shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khozo"
                    aria-label={t('View full photo')}
                    title={t('View full photo')}
                  >
                    <Avatar name={d(selected.childName)} src={selected.photoUrl} size={96} />
                    {viewPhotosOf(selected).length > 1 && (
                      <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">
                        {t('{n} photos', { n: viewPhotosOf(selected).length })}
                      </span>
                    )}
                    <span className="absolute bottom-1 right-1 grid h-7 w-7 place-items-center rounded-md bg-black/60 text-white transition group-hover:bg-black/80">
                      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
                    </span>
                  </button>
                ) : (
                  <Avatar name={d(selected.childName)} src={selected.photoUrl} size={96} />
                )}
                <div className="min-w-0 pt-1">
                  <h3 className="text-xl font-bold capitalize leading-tight">{d(selected.childName)}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <CategoryBadge category={personCategoryOf(selected)} />
                    <StatusBadge status={selected.status} />
                    <RiskBadge risk={selected.traffickingRisk} />
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    {t('Missing since')} {fmtDate(selected.dateOfMissing)}
                  </p>
                  {txt(selected.photoUrl) && (
                    <button
                      type="button"
                      onClick={() => setPhotoView({ caseId: selected.id, startId: selected.pendingMatch?.photoPair?.case || MAIN_PHOTO })}
                      className="mt-1 text-sm font-semibold text-khozo-dark underline decoration-dotted underline-offset-2 hover:text-khozo"
                    >
                      {selected.pendingMatch?.foundReportId
                        ? t('Compare with the sighting')
                        : viewPhotosOf(selected).length > 1 ? t('View all {n} photos', { n: viewPhotosOf(selected).length }) : t('View full photo')}
                    </button>
                  )}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="hidden rounded-lg px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-ink sm:inline">{t('Close')}</button>
            </div>

            <div className="mt-6 space-y-5">
              {[
                [t('Identity'), [
                  [t('Gender'), genderLabel(selected.gender, personCategoryOf(selected)) || '-'],
                  [t('Age'), txt(selected.age) || '-'],
                  [t('Height'), txt(selected.height) ? `${txt(selected.height)} cm` : '-'],
                  [t('Weight'), txt(selected.weight) ? `${txt(selected.weight)} kg` : '-'],
                  [t('Aadhar'), txt(selected.childAadhar) || '-'],
                ]],
                [t('When and where'), [
                  [t('Missing since'), fmtDate(selected.dateOfMissing)],
                  [t('Location'), d.places(selected.district, selected.state) || '-'],
                  [t('Address'), d(selected.address) || '-'],
                  [t('Found at'), d(selected.foundLocation) || '-'],
                ]],
                [t('Family'), [
                  [adultCase ? t('Family contact') : t('Parent'), d(selected.parentName) || '-'],
                  [t('Contact'), txt(selected.parentPhone)
                    ? <PhoneLink phone={selected.parentPhone} />
                    : selected.familyContactWithheld ? <span className="text-xs font-normal text-gray-500">{t('Withheld: contact the family through the police or CWC')}</span> : '-'],
                ]],
                [t('Case record'), [
                  // The only reference the family can use on the public Track my case page.
                  [t('Case ID'), <span className="font-mono text-xs">{selected.id}</span>],
                  [t('FIR no.'), d(selected.firNo) || '-'],
                  [t('Steps taken'), txt(selected.workflowStatus) || '-'],
                  [t('Assigned to'), txt(selected.assignedToName) ? `${txt(selected.assignedToName)} (${roleLabel(selected.assignedToRole)})` : '-'],
                  [t('Match score'), Number(selected.matchScore) ? `${Math.round(Number(selected.matchScore) * 100)}%` : '-'],
                  [t('Declaration'), selected.declaration?.accepted ? `${txt(selected.declaration.signerName) || t('Signer')} / ${txt(selected.declaration.methodLabel) || t('Accepted')}` : '-'],
                  [t('Closure'), txt(selected.closure?.label) || '-'],
                ]],
              ].map(([title, rows]) => (
                <section key={title}>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-gray-50/80 p-3 text-sm ring-1 ring-black/5">
                    {rows.map(([k, v]) => (
                      <div key={k} className="min-w-0">
                        <dt className="text-xs text-gray-500">{k}</dt>
                        <dd className={`break-words font-medium ${v === '-' ? 'text-gray-300' : 'text-ink'}`}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>

            {RISK_BADGES[selected.traffickingRisk?.level] && (
              <div className="mt-6 rounded-xl border border-red-100 bg-red-50/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{t('Trafficking risk')}</p>
                  <RiskBadge risk={selected.traffickingRisk} />
                </div>
                <p className="mt-2 text-xs text-gray-600">{t('Raised because:')}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
                  {asList(selected.traffickingRisk?.reasons).map((r) => <li key={r.code}>{riskReasonLabel(t, r)}</li>)}
                </ul>
                <p className="mt-2 text-xs text-gray-500">{t('A prompt to review with the investigating officer, not a finding.')}</p>
              </div>
            )}

            {/*
              Whether this photo can be matched at all. A photo with no face,
              or of a group, is never refused at registration; it is flagged
              here, and police can replace it. The face search gallery may
              refuse a photo the check passed (a face too small to enrol).
            */}
            {(photoCheckFlag(selected.photoCheck) || faceIndexFlag(selected.faceIndex) || photoNeedOf(selected) || viewPhotosOf(selected).length > 1 || (canReplacePhoto && !selected.anonymizedAt)) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">
                  {t('Photos of the person')}{' '}
                  <span className="font-normal text-gray-400">{t('{n} of {total}', { n: viewPhotosOf(selected).length, total: MAX_CASE_PHOTOS })}</span>
                </p>
                {/* What to do about a photo that will not match: the family
                    is the one who has a better one (shared/photo-need.js). */}
                {photoNeedOf(selected) && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                    {photoNeedOf(selected) === 'no_photo'
                      ? t('No photo: no sighting can be matched with this case by face. Ask the family for a recent, clear photo of the face.')
                      : t('Ask the family for a better photo: recent, the face clearly visible and large, the person alone, in good light. If they have several, use the clearest.')}
                  </p>
                )}
                {photoCheckFlag(selected.photoCheck) && ['no_face', 'multiple_faces'].includes(selected.photoCheck?.verdict) && !photoNeedOf(selected) ? (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                    {t('The main photo does not show one clear face, but another photo of this case does, and matching uses that one. You can make it the main photo.')}
                  </p>
                ) : photoCheckFlag(selected.photoCheck) ? (
                  <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-semibold ring-1 ${photoCheckFlag(selected.photoCheck).className}`}>
                    {t(photoCheckFlag(selected.photoCheck).label)}
                  </p>
                ) : selected.photoCheck?.verdict === 'usable' ? (
                  <p className="mt-1 text-xs text-emerald-700">{t('One face found: the photo can be used for matching.')}</p>
                ) : null}
                {faceIndexFlag(selected.faceIndex) && (
                  <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-semibold ring-1 ${faceIndexFlag(selected.faceIndex).className}`}>
                    {t(faceIndexFlag(selected.faceIndex).label)}
                  </p>
                )}
                {/* Every photo, the main one first; each opens full size. */}
                {viewPhotosOf(selected).length > 0 && (
                  <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {viewPhotosOf(selected).map((p) => (
                      <li key={p.id} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setPhotoView({ caseId: selected.id, startId: p.id })}
                          className="relative block aspect-square w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-black/5 hover:ring-khozo/50"
                          aria-label={p.id === MAIN_PHOTO ? t('Main photo') : t('Other photo')}
                        >
                          <ProtectedImage src={p.src} alt="" className="h-full w-full object-cover" />
                          {p.id === MAIN_PHOTO && (
                            <span className="absolute left-1 top-1 rounded bg-khozo px-1.5 py-0.5 text-[10px] font-bold text-white">{t('Main')}</span>
                          )}
                          {['no_face', 'multiple_faces'].includes(p.check?.verdict) && (
                            <span className="absolute inset-x-0 bottom-0 bg-amber-500/90 px-1 py-0.5 text-[10px] font-semibold text-white">
                              {p.check.verdict === 'no_face' ? t('No face found') : t('Group photo')}
                            </span>
                          )}
                        </button>
                        {canReplacePhoto && !selected.anonymizedAt && p.id !== MAIN_PHOTO && (
                          <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] font-semibold">
                            <button type="button" disabled={action.pending} onClick={() => makeMainPhoto(selected, p.id)} className="text-khozo-dark hover:underline">{t('Make main')}</button>
                            <button type="button" disabled={action.pending} onClick={() => removePhoto(selected, p.id)} className="text-red-700 hover:underline">{t('Remove')}</button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canReplacePhoto && !selected.anonymizedAt && viewPhotosOf(selected).length < MAX_CASE_PHOTOS && (
                  <div className="mt-4 rounded-lg bg-gray-50 p-3 ring-1 ring-black/5">
                    <p className="text-xs font-semibold text-gray-700">{t('Add photos the family has')}</p>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {t('Different ages and angles help. Each is checked for a face and compared with the sightings already received. Up to {n} more.', { n: MAX_CASE_PHOTOS - viewPhotosOf(selected).length })}
                    </p>
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      className="mt-2 block min-h-11 w-full text-sm text-gray-600 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-white file:px-3 file:text-sm file:font-semibold file:text-ink hover:file:bg-gray-100"
                      onChange={(e) => setPhotoAdd({
                        caseId: selected.id,
                        files: [...(e.target.files || [])].slice(0, MAX_CASE_PHOTOS - viewPhotosOf(selected).length),
                        consent: photoAdd.caseId === selected.id && photoAdd.consent,
                      })}
                    />
                    {!selected.photoConsent && selected.photoBasis !== 'department_register' && (
                      <label className="mt-2 flex gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={photoAdd.caseId === selected.id && photoAdd.consent}
                          onChange={(e) => setPhotoAdd((prev) => ({ ...prev, caseId: selected.id, consent: e.target.checked }))}
                        />
                        <span>{t('Consent to use these photos has been recorded')}</span>
                      </label>
                    )}
                    {photoAdd.caseId === selected.id && photoAdd.fromVideo && photoAdd.files.length > 0 && (
                      <p className="mt-2 text-xs text-gray-600">{t('{n} picture(s) chosen from a video.', { n: photoAdd.files.length })}</p>
                    )}
                    <details
                      className="group mt-2 rounded-lg ring-1 ring-black/10 open:bg-white"
                      open={videoPhotosOpen === selected.id}
                      onToggle={(e) => setVideoPhotosOpen(e.currentTarget.open ? selected.id : null)}
                    >
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
                        <span>{t('Advanced options: take photos from a video')}</span>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </summary>
                      {videoPhotosOpen === selected.id && (
                        <div className="border-t border-black/5 p-3">
                          <Suspense fallback={<p className="text-sm text-gray-500">{t('Loading…')}</p>}>
                            <VideoFacePicker
                              key={selected.id}
                              max={MAX_CASE_PHOTOS - viewPhotosOf(selected).length}
                              purpose="case"
                              onUse={(files) => {
                                setPhotoAdd((prev) => ({ caseId: selected.id, files, fromVideo: true, consent: prev.caseId === selected.id && prev.consent }));
                                setVideoPhotosOpen(null);
                              }}
                              onCancel={() => setVideoPhotosOpen(null)}
                            />
                          </Suspense>
                        </div>
                      )}
                    </details>
                    <button
                      type="button"
                      className="btn-ghost mt-2 w-full"
                      disabled={action.pending || photoAdd.caseId !== selected.id || !photoAdd.files.length || (!selected.photoConsent && selected.photoBasis !== 'department_register' && !photoAdd.consent)}
                      onClick={() => addPhotos(selected)}
                    >
                      {action.busy('photos')
                        ? t('Uploading the photos…')
                        : photoAdd.caseId === selected.id && photoAdd.files.length > 1
                          ? t('Add {n} photos', { n: photoAdd.files.length })
                          : t('Add photo')}
                    </button>
                  </div>
                )}
                <ActionMessage action={action} id="photos" />
                {canReplacePhoto && !selected.anonymizedAt && (
                  <>
                    {viewPhotosOf(selected).length > 1 && (
                      <p className="mt-4 text-xs font-semibold text-gray-700">{t('Replace the main photo')}</p>
                    )}
                    <p className="mt-3 text-xs text-gray-600">
                      {txt(selected.photoUrl)
                        ? t('Replace it with a clear, recent photo of the person alone. The new photo is checked for a face and compared with the sightings already received.')
                        : t('Add a clear, recent photo of the person alone. It is checked for a face and compared with the sightings already received.')}
                    </p>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="mt-3 block min-h-11 w-full text-sm text-gray-600 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:text-sm file:font-semibold file:text-ink hover:file:bg-gray-200"
                      onChange={(e) => setPhotoReplace({ caseId: selected.id, file: e.target.files?.[0] || null, consent: photoReplace.caseId === selected.id && photoReplace.consent })}
                    />
                    {!selected.photoConsent && (
                      <label className="mt-2 flex gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={photoReplace.caseId === selected.id && photoReplace.consent}
                          onChange={(e) => setPhotoReplace((prev) => ({ ...prev, caseId: selected.id, consent: e.target.checked }))}
                        />
                        <span>{t('Consent to use this photo has been recorded')}</span>
                      </label>
                    )}
                    <button
                      type="button"
                      className="btn-ghost mt-2 w-full"
                      disabled={action.pending || photoReplace.caseId !== selected.id || !photoReplace.file || (!selected.photoConsent && !photoReplace.consent)}
                      onClick={() => replacePhoto(selected)}
                    >
                      {action.busy('photo') ? t('Uploading the photo…') : txt(selected.photoUrl) ? t('Replace photo') : t('Add photo')}
                    </button>
                    <ActionMessage action={action} id="photo" />
                    {photoResult?.caseId === selected.id && !action.busy('photo') && (
                      <p className="mt-2 text-xs text-gray-600">
                        {photoResult.searched === false
                          ? t('Earlier sightings were not searched: none of the new photos shows one clear face.')
                          : photoResult.sightingMatches > 0
                            ? t('Checked against earlier sightings: {n} possible match(es) sent for review', { n: photoResult.sightingMatches })
                            : t('Checked against earlier sightings: no possible match found.')}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {(selected.hasIdentificationProfile || selected.hasVulnerabilityProfile) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Identification & vulnerability profile')}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {[
                    [t('Complexion'), txt(selected.identificationProfile?.complexion) || '-'],
                    [t('Build'), txt(selected.identificationProfile?.build) || '-'],
                    [t('Hair'), txt(selected.identificationProfile?.hair) || '-'],
                    [t('Clothing'), d(selected.identificationProfile?.clothing) || '-'],
                    [t('Languages'), txt(selected.identificationProfile?.languages) || '-'],
                    [t('Birth mark'), txt(selected.identificationProfile?.birthMark) || '-'],
                    [t('Identification mark'), d(selected.identificationProfile?.identificationMark) || '-'],
                    [t('Produced by'), txt(selected.vulnerabilityProfile?.producedByLabel) || '-'],
                    [t('Education'), txt(selected.vulnerabilityProfile?.educationLabel) || '-'],
                    [t('Disability support'), txt(selected.vulnerabilityProfile?.disabilityLabel) || '-'],
                    [t('Mental-health concern'), txt(selected.vulnerabilityProfile?.mentalHealthConcernLabel) || '-'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs uppercase tracking-wide text-gray-400">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                {asList(selected.vulnerabilityProfile?.categoryLabels).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {asList(selected.vulnerabilityProfile.categoryLabels).map(txt).filter(Boolean).map((label) => (
                      <span key={label} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{label}</span>
                    ))}
                  </div>
                )}
                {txt(selected.vulnerabilityProfile?.circumstances) && (
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{txt(selected.vulnerabilityProfile.circumstances).split('\n').map(d).join('\n')}</p>
                )}
              </div>
            )}

            {canVerifyIntake && selected.status === 'intake_pending' && (
              <div className="mt-6 rounded-xl bg-sky-50 p-4">
                <p className="text-sm font-medium">{t('Check this citizen or NGO report')}</p>
                <p className="text-xs text-gray-600">{t('Check this report and make it a formal missing-child case before it is handed over, closed or used for alerts.')}</p>
                <div className="mt-3 space-y-3">
                  <input
                    className="field w-full"
                    value={verify.firNo}
                    onChange={(e) => setVerify((v) => ({ ...v, firNo: e.target.value }))}
                    placeholder={t('FIR / GD number, or leave blank to auto-generate')}
                  />
                  <textarea
                    className="field min-h-20 w-full"
                    value={verify.note}
                    onChange={(e) => setVerify((v) => ({ ...v, note: e.target.value }))}
                    placeholder={t('Verification note')}
                  />
                  <button onClick={() => verifyIntake(selected)} disabled={action.pending} className="btn-primary w-full">{t('Check report')}</button>
                  <ActionMessage action={action} id="verify" />
                </div>
              </div>
            )}

            {/*
              Confirming opens the verification dialog. With a sighting waiting
              on the case it confirms that sighting; with none it records an
              in-person recovery, and only once the officer has filled in how
              identity was verified. Nobody is messaged either way.
            */}
            {canAct && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl bg-khozo-light p-4">
                <p className="text-sm font-medium">
                  {adultCase ? t('Confirm this person has been found?') : t('Confirm this child has been found?')}
                </p>
                <p className="text-xs text-gray-600">
                  {selected.pendingMatch?.foundReportId
                    ? t('A sighting is waiting on this case. Compare the photographs and record how identity was verified.')
                    : t('No sighting is linked to this case. Use this only when the person has been found and their identity verified in person.')}
                </p>
                {adultCase && (
                  <p className="mt-1 text-xs font-medium text-amber-800">{t('Verify with the person first; share their location with the family only with their consent.')}</p>
                )}
                <button
                  type="button"
                  disabled={action.pending}
                  onClick={() => {
                    action.clear();
                    setConfirming({
                      report: selected,
                      sightingId: txt(selected.pendingMatch?.foundReportId),
                      score: Number(selected.pendingMatch?.score) || 0,
                    });
                  }}
                  className="btn-primary mt-3 w-full"
                >
                  {selected.pendingMatch?.foundReportId ? t('Confirm match…') : t('Record an in-person recovery…')}
                </button>
              </div>
            )}

            {/*
              After a case is found: call the family, then record it. Khozo sends
              nothing on its own, so nothing here says a message went out.
            */}
            {canAct && selected.status === 'found' && (
              <FamilyContactPanel
                report={selected}
                phoneHint={familyPhoneHint.id === selected.id ? familyPhoneHint.phone : ''}
                action={action}
                onReport={(report) => { showReport(report); load(); }}
              />
            )}
            {(!canAct || selected.status !== 'found') && asList(selected.familyContacts).length > 0 && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <FamilyContactList report={selected} />
              </div>
            )}

            {/* The same rule the server applies (POST /reports/:id/rematch): a
                stored case photo (a found-child intake shows the sighting's
                photo but has none of its own), a verified intake, and a case
                that is neither found nor closed. */}
            {canRematch && selected.photoFile && selected.caseOrigin !== 'found_child_intake'
              && !['found', 'closed', 'intake_pending'].includes(selected.status)
              && selected.intakeStatus !== 'pending_verification' && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Earlier sightings')}</p>
                <p className="text-xs text-gray-600">
                  {t('Compare this case photo with sightings already received that are not linked to a case. Possible matches go to Matches; an officer confirms each one, and the person who sent the sighting is told nothing.')}
                </p>
                <button
                  type="button"
                  className="btn-ghost mt-3 w-full"
                  disabled={action.pending}
                  onClick={() => searchEarlierSightings(selected)}
                >
                  {action.busy('rematch') ? t('Searching earlier sightings...') : t('Search earlier sightings')}
                </button>
                <ActionMessage action={action} id="rematch" />
                {rematch?.caseId === selected.id && !action.busy('rematch') && (
                    <div className="mt-2 text-xs">
                      {rematch.count > 0 ? (
                        <p className="font-medium text-amber-800">
                          {t('Checked against earlier sightings: {n} possible match(es) sent for review', { n: rematch.count })}{' '}
                          <Link to="/app/matches" className="font-semibold text-khozo hover:underline">{t('Open Matches')}</Link>
                        </p>
                      ) : rematch.engine && !rematch.engine.biometric ? (
                        <p className="font-medium text-amber-800">{t('No face comparison was made. Try again later.')}</p>
                      ) : (
                        <p className="text-gray-600">{t('Checked against earlier sightings: no possible match found.')}</p>
                      )}
                      {rematch.engine && !rematch.engine.biometric && rematch.engine.note && (
                        <p className="mt-1 text-gray-600">{t(rematch.engine.note)}</p>
                      )}
                      {rematch.engine?.biometric && (
                        <p className="mt-1 text-gray-400">
                          {t('Matched by: {engine}', { engine: rematch.engine.provider })}
                          {' · '}
                          {t('Compared with {n} earlier sighting(s)', { n: rematch.engine.comparedAgainst })}
                        </p>
                      )}
                    </div>
                )}
              </div>
            )}

            {/* Searching a CCTV export for this person (web/src/video/VideoCaseSearch.jsx):
                the same cases and roles as the search above (POST /reports/:id/video-search). */}
            {canRematch && selected.photoFile && selected.caseOrigin !== 'found_child_intake'
              && !['found', 'closed', 'intake_pending'].includes(selected.status)
              && selected.intakeStatus !== 'pending_verification' && !selected.anonymizedAt && (
              <details
                className="group mt-6 rounded-xl border border-black/5 open:bg-gray-50/40"
                open={videoSearchOpen === selected.id}
                onToggle={(e) => setVideoSearchOpen(e.currentTarget.open ? selected.id : null)}
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                  <span>
                    <span className="block text-sm font-medium">{t('Search a CCTV video for this person')}</span>
                    <span className="mt-0.5 block text-xs text-gray-600">{t('Find the faces in a video on this computer and compare each with this case’s photo.')}</span>
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                {videoSearchOpen === selected.id && (
                  <div className="border-t border-black/5 p-4">
                    <Suspense fallback={<p className="text-sm text-gray-500">{t('Loading…')}</p>}>
                      <VideoCaseSearch key={selected.id} report={selected} />
                    </Suspense>
                  </div>
                )}
              </details>
            )}

            {canManageBulletin && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-xs text-gray-600">{t('Public appeals are disabled: Khozo never shows names or photos to the public.')}</p>
                {/* An appeal published before the rule is already hidden from the
                    public; withdrawing it just tidies the record. */}
                {selected.bulletin?.published && (
                  <button type="button" onClick={() => withdrawBulletin(selected)} disabled={action.pending} className="btn-ghost mt-3 w-full">
                    {t('Withdraw the old public appeal')}
                  </button>
                )}
                <ActionMessage action={action} id="bulletin" />
              </div>
            )}

            {canWorkflow && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Case notes')}</p>
                <p className="text-xs text-gray-600">{t('Add a note about the handover for the police, CWC, CCI, JJB and senior officers.')}</p>
                <textarea
                  className="field mt-3 min-h-20 w-full"
                  value={caseNote}
                  onChange={(e) => setCaseNote(e.target.value)}
                  placeholder={t('Investigation update, contact attempt, care follow-up...')}
                />
                <button className="btn-ghost mt-2 w-full" disabled={action.pending || caseNote.trim().length < 3} onClick={() => addNote(selected)}>
                  {t('Add note')}
                </button>
                <ActionMessage action={action} id="note" />
                {asList(selected.notes).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.notes).slice().reverse().slice(0, 4).map((note, i) => (
                      <div key={txt(note?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="whitespace-pre-wrap text-gray-700">{d(note?.note)}</p>
                        <p className="mt-1 text-gray-400">{txt(note?.actorName)} / {new Date(note?.ts).toLocaleString(currentLocale())}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canAssignCase && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Case ownership')}</p>
                <p className="text-xs text-gray-600">
                  {adultCase
                    ? t('Assign a responsible desk or officer for the current investigation, welfare, railway, legal-aid, or bureau follow-up.')
                    : t('Assign a responsible desk or officer for the current investigation, welfare, railway, CCI, JJB, or bureau follow-up.')}
                </p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={assignmentTypes.some((type) => type.id === assignment.assignmentType) ? assignment.assignmentType : 'investigation'}
                    onChange={(e) => setAssignment((a) => ({ ...a, assignmentType: e.target.value }))}
                  >
                    {assignmentTypes.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={assignment.assigneeId}
                    onChange={(e) => setAssignment((a) => ({ ...a, assigneeId: e.target.value }))}
                    disabled={assignableUsers.length === 0}
                  >
                    {assignableUsers.length === 0 && <option value="">{t('No officer in this area to assign')}</option>}
                    {assignableUsers.map((person) => (
                      <option key={person.id} value={person.id}>
                        {txt(person.name)} / {roleLabel(person.role)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field w-full"
                    type="date"
                    value={assignment.dueDate}
                    onChange={(e) => setAssignment((a) => ({ ...a, dueDate: e.target.value }))}
                  />
                  <textarea
                    className="field min-h-16 w-full"
                    value={assignment.note}
                    onChange={(e) => setAssignment((a) => ({ ...a, note: e.target.value }))}
                    placeholder={t('Assignment context or deadline reason')}
                  />
                  <button className="btn-primary w-full" disabled={action.pending || !assignment.assigneeId} onClick={() => assignOwner(selected)}>
                    {t('Assign owner')}
                  </button>
                  <ActionMessage action={action} id="assign" />
                </div>
                {asList(selected.assignments).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.assignments).slice().reverse().slice(0, 3).map((item, i) => (
                      <div key={txt(item?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(item?.assignmentLabel)}: {txt(item?.assigneeName)}</p>
                        <p>{txt(item?.assignedByName)} / {new Date(item?.assignedAt).toLocaleString(currentLocale())}</p>
                        {item.dueDate && <p className="mt-1 text-gray-500">{t('Due {date}', { date: fmtDate(item.dueDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordInvestigationChecklist && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Investigation checklist')}</p>
                <p className="text-xs text-gray-600">
                  {adultCase
                    ? t('Record police coordination across FIR/GD, CCTNS, NCRB/SCRB, railway, and lookout decisions.')
                    : t('Record police/SJPU coordination across FIR/GD, TrackChild, CCTNS, NCRB/SCRB, railway, 1098, CWC, and lookout decisions.')}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {checklistItems.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={investigationChecklist.items.includes(item.id)}
                        onChange={() => setInvestigationChecklistItem(item.id)}
                      />
                      <span>{t(item.label)}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 space-y-3">
                  <input
                    className="field w-full"
                    value={investigationChecklist.officerName}
                    onChange={(e) => setInvestigationChecklist((c) => ({ ...c, officerName: e.target.value }))}
                    placeholder={t('Officer / desk name')}
                  />
                  <input
                    className="field w-full"
                    value={investigationChecklist.stationDiaryNo}
                    onChange={(e) => setInvestigationChecklist((c) => ({ ...c, stationDiaryNo: e.target.value }))}
                    placeholder={t('Station diary / coordination reference')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={investigationChecklist.actionDate}
                      onChange={(e) => setInvestigationChecklist((c) => ({ ...c, actionDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={investigationChecklist.followupDate}
                      onChange={(e) => setInvestigationChecklist((c) => ({ ...c, followupDate: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-16 w-full"
                    value={investigationChecklist.note}
                    onChange={(e) => setInvestigationChecklist((c) => ({ ...c, note: e.target.value }))}
                    placeholder={t('Coordination note')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || !investigationChecklist.items.some((id) => checklistItems.some((item) => item.id === id)) || investigationChecklist.officerName.trim().length < 3 || !investigationChecklist.actionDate}
                    onClick={() => recordInvestigationChecklist(selected)}
                  >
                    {t('Record checklist')}
                  </button>
                  <ActionMessage action={action} id="checklist" />
                </div>
                {asList(selected.investigationChecklist).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.investigationChecklist).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txtList(record.itemLabels)}</p>
                        <p>{txt(record.officerName)} / {txt(record.actorName)}</p>
                        {record.stationDiaryNo && <p className="mt-1 text-gray-500">{t('Ref: {ref}', { ref: record.stationDiaryNo })}</p>}
                        {record.followupDate && <p className="mt-1 text-gray-400">{t('Follow-up: {date}', { date: fmtDate(record.followupDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canWorkflow && !['found', 'closed', 'intake_pending'].includes(selected.status) && workflowActions.length > 0 && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Care in an institution')}</p>
                <p className="text-xs text-gray-600">
                  {adultCase
                    ? t('Record a handover to the State or the crime records bureau, without confirming that the person has been found.')
                    : t('Record a handover to the CWC, CCI, JJB, the State or the crime records bureau, without confirming that the child is home.')}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {workflowActions.map((workflowAction) => (
                    <button key={workflowAction.id} onClick={() => caseWorkflow(selected, workflowAction.id)} disabled={action.pending} className="btn-ghost py-2 text-xs">
                      {t(workflowAction.label)}
                    </button>
                  ))}
                </div>
                <ActionMessage action={action} id="workflow" />
                {asList(selected.workflow).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.workflow).slice().reverse().slice(0, 3).map((event, i) => (
                      <div key={txt(event?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(event?.label)}</p>
                        <p>{txt(event?.actorName)} / {new Date(event?.ts).toLocaleString(currentLocale())}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordCciCare && !adultCase && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('CCI care record')}</p>
                <p className="text-xs text-gray-600">{t('Record admission, care plan and next welfare review after the CWC or DCPU hands the child over.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={cciCare.admissionType}
                    onChange={(e) => setCciCare((c) => ({ ...c, admissionType: e.target.value }))}
                  >
                    {CCI_ADMISSION_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={cciCare.cciName}
                    onChange={(e) => setCciCare((c) => ({ ...c, cciName: e.target.value }))}
                    placeholder={t('CCI / shelter name')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={cciCare.admissionDate}
                      onChange={(e) => setCciCare((c) => ({ ...c, admissionDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={cciCare.nextReviewDate}
                      onChange={(e) => setCciCare((c) => ({ ...c, nextReviewDate: e.target.value }))}
                    />
                  </div>
                  <select
                    className="field w-full"
                    value={cciCare.progressStatus}
                    onChange={(e) => setCciCare((c) => ({ ...c, progressStatus: e.target.value }))}
                  >
                    {CCI_PROGRESS_STATES.map((progress) => <option key={progress.id} value={progress.id}>{t(progress.label)}</option>)}
                  </select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CCI_SERVICE_TYPES.map((service) => (
                      <label key={service.id} className="flex items-center gap-2 rounded-lg border border-black/5 px-3 py-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={cciCare.services.includes(service.id)}
                          onChange={() => setCciService(service.id)}
                        />
                        {t(service.label)}
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      value={cciCare.healthStatus}
                      onChange={(e) => setCciCare((c) => ({ ...c, healthStatus: e.target.value }))}
                      placeholder={t('Health care progress')}
                    />
                    <input
                      className="field w-full"
                      value={cciCare.educationStatus}
                      onChange={(e) => setCciCare((c) => ({ ...c, educationStatus: e.target.value }))}
                      placeholder={t('Education progress')}
                    />
                    <input
                      className="field w-full"
                      value={cciCare.counsellingStatus}
                      onChange={(e) => setCciCare((c) => ({ ...c, counsellingStatus: e.target.value }))}
                      placeholder={t('Counselling progress')}
                    />
                    <input
                      className="field w-full"
                      value={cciCare.familyTracingStatus}
                      onChange={(e) => setCciCare((c) => ({ ...c, familyTracingStatus: e.target.value }))}
                      placeholder={t('Family tracing progress')}
                    />
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={cciCare.carePlan}
                    onChange={(e) => setCciCare((c) => ({ ...c, carePlan: e.target.value }))}
                    placeholder={t('Care plan, medical/counselling needs, guardian contact plan...')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || cciCare.cciName.trim().length < 3 || cciCare.carePlan.trim().length < 10 || !cciCare.admissionDate}
                    onClick={() => recordCciCare(selected)}
                  >
                    {t('Record CCI care')}
                  </button>
                  <ActionMessage action={action} id="cci" />
                </div>
                {asList(selected.cciCareRecords).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.cciCareRecords).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.cciName)}</p>
                        <p>{txt(record.actorName)} / {new Date(record.recordedAt).toLocaleString(currentLocale())}</p>
                        {record.progressLabel && <p className="mt-1 text-gray-500">{t('Progress: {status}', { status: record.progressLabel })}</p>}
                        {txtList(record.serviceLabels) && <p className="mt-1 text-gray-400">{txtList(record.serviceLabels, ' / ')}</p>}
                        {record.serviceProgress && (
                          <p className="mt-1 text-gray-500">
                            {[record.serviceProgress.healthStatus, record.serviceProgress.educationStatus, record.serviceProgress.counsellingStatus, record.serviceProgress.familyTracingStatus].map(txt).filter(Boolean).join(' / ')}
                          </p>
                        )}
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.carePlan)}</p>
                        {record.nextReviewDate && <p className="mt-1 text-gray-400">{t('Next review: {date}', { date: fmtDate(record.nextReviewDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordJjbProceeding && !adultCase && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('JJB proceeding')}</p>
                <p className="text-xs text-gray-600">{t('Record board orders, social investigation directions, and next hearing dates.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={jjbProceeding.proceedingType}
                    onChange={(e) => setJjbProceeding((j) => ({ ...j, proceedingType: e.target.value }))}
                  >
                    {JJB_PROCEEDING_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={jjbProceeding.boardName}
                    onChange={(e) => setJjbProceeding((j) => ({ ...j, boardName: e.target.value }))}
                    placeholder={t('JJB / board name')}
                  />
                  <input
                    className="field w-full"
                    value={jjbProceeding.caseNo}
                    onChange={(e) => setJjbProceeding((j) => ({ ...j, caseNo: e.target.value }))}
                    placeholder={t('JJB case number, if available')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={jjbProceeding.orderDate}
                      onChange={(e) => setJjbProceeding((j) => ({ ...j, orderDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={jjbProceeding.nextHearingDate}
                      onChange={(e) => setJjbProceeding((j) => ({ ...j, nextHearingDate: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={jjbProceeding.directions}
                    onChange={(e) => setJjbProceeding((j) => ({ ...j, directions: e.target.value }))}
                    placeholder={t('Board directions, social investigation order, rehabilitation actions...')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || jjbProceeding.boardName.trim().length < 3 || jjbProceeding.directions.trim().length < 10 || !jjbProceeding.orderDate}
                    onClick={() => recordJjbProceeding(selected)}
                  >
                    {t('Record JJB proceeding')}
                  </button>
                  <ActionMessage action={action} id="jjb" />
                </div>
                {asList(selected.jjbProceedings).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.jjbProceedings).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.boardName)}</p>
                        <p>{txt(record.actorName)} / {new Date(record.recordedAt).toLocaleString(currentLocale())}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.directions)}</p>
                        {record.nextHearingDate && <p className="mt-1 text-gray-400">{t('Next hearing: {date}', { date: fmtDate(record.nextHearingDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordStateEscalation && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Referral to the State')}</p>
                <p className="text-xs text-gray-600">{t('Record state nodal coordination, urgent rescue support, or interstate action requests.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={stateEscalation.escalationType}
                    onChange={(e) => setStateEscalation((s) => ({ ...s, escalationType: e.target.value }))}
                  >
                    {STATE_ESCALATION_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      className="field w-full"
                      value={stateEscalation.escalationLevel}
                      onChange={(e) => setStateEscalation((s) => ({ ...s, escalationLevel: e.target.value }))}
                    >
                      {STATE_ESCALATION_LEVELS.map((level) => <option key={level.id} value={level.id}>{t(level.label)}</option>)}
                    </select>
                    <select
                      className="field w-full"
                      value={stateEscalation.priority}
                      onChange={(e) => setStateEscalation((s) => ({ ...s, priority: e.target.value }))}
                    >
                      {BUREAU_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{t(priority.label)}</option>)}
                    </select>
                  </div>
                  <input
                    className="field w-full"
                    value={stateEscalation.authorityName}
                    onChange={(e) => setStateEscalation((s) => ({ ...s, authorityName: e.target.value }))}
                    placeholder={t('Authority / nodal desk')}
                  />
                  <input
                    className="field w-full"
                    value={stateEscalation.referenceNo}
                    onChange={(e) => setStateEscalation((s) => ({ ...s, referenceNo: e.target.value }))}
                    placeholder={t('Reference number, if issued')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={stateEscalation.escalatedDate}
                      onChange={(e) => setStateEscalation((s) => ({ ...s, escalatedDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={stateEscalation.dueDate}
                      onChange={(e) => setStateEscalation((s) => ({ ...s, dueDate: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={stateEscalation.actionRequired}
                    onChange={(e) => setStateEscalation((s) => ({ ...s, actionRequired: e.target.value }))}
                    placeholder={t('Action required, coordination support, rescue resources, interstate request...')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || stateEscalation.authorityName.trim().length < 3 || stateEscalation.actionRequired.trim().length < 10 || !stateEscalation.escalatedDate}
                    onClick={() => recordStateEscalation(selected)}
                  >
                    {t('Record referral to the State')}
                  </button>
                  <ActionMessage action={action} id="escalation" />
                </div>
                {asList(selected.stateEscalations).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.stateEscalations).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.levelLabel)} / {txt(record.label)}</p>
                        <p>{txt(record.actorName)} / {new Date(record.recordedAt).toLocaleString(currentLocale())}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.actionRequired)}</p>
                        {record.referenceNo && <p className="mt-1 text-gray-400">{t('Ref: {ref}', { ref: record.referenceNo })}</p>}
                        {record.dueDate && <p className="mt-1 text-gray-400">{t('Due: {date}', { date: fmtDate(record.dueDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordBureauReport && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('NCRB / SCRB report')}</p>
                <p className="text-xs text-gray-600">{t('Record state or national crime-records reporting for interstate alerts, pattern review, or trace updates.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={bureauReport.reportType}
                    onChange={(e) => setBureauReport((b) => ({ ...b, reportType: e.target.value }))}
                  >
                    {BUREAU_REPORT_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      className="field w-full"
                      value={bureauReport.bureauLevel}
                      onChange={(e) => setBureauReport((b) => ({ ...b, bureauLevel: e.target.value }))}
                    >
                      {BUREAU_LEVELS.map((level) => <option key={level.id} value={level.id}>{t(level.label)}</option>)}
                    </select>
                    <select
                      className="field w-full"
                      value={bureauReport.priority}
                      onChange={(e) => setBureauReport((b) => ({ ...b, priority: e.target.value }))}
                    >
                      {BUREAU_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{t(priority.label)}</option>)}
                    </select>
                  </div>
                  <input
                    className="field w-full"
                    value={bureauReport.referenceNo}
                    onChange={(e) => setBureauReport((b) => ({ ...b, referenceNo: e.target.value }))}
                    placeholder={t('Reference number, if issued')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={bureauReport.submittedDate}
                      onChange={(e) => setBureauReport((b) => ({ ...b, submittedDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={bureauReport.nextReviewDate}
                      onChange={(e) => setBureauReport((b) => ({ ...b, nextReviewDate: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={bureauReport.summary}
                    onChange={(e) => setBureauReport((b) => ({ ...b, summary: e.target.value }))}
                    placeholder={t('Report summary, alert rationale, interstate coordination notes...')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || bureauReport.summary.trim().length < 10 || !bureauReport.submittedDate}
                    onClick={() => recordBureauReport(selected)}
                  >
                    {t('Record bureau report')}
                  </button>
                  <ActionMessage action={action} id="bureau" />
                </div>
                {asList(selected.bureauReports).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.bureauReports).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.bureauLabel)} / {txt(record.label)}</p>
                        <p>{txt(record.actorName)} / {new Date(record.recordedAt).toLocaleString(currentLocale())}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.summary)}</p>
                        {record.referenceNo && <p className="mt-1 text-gray-400">{t('Ref: {ref}', { ref: record.referenceNo })}</p>}
                        {record.nextReviewDate && <p className="mt-1 text-gray-400">{t('Next review: {date}', { date: fmtDate(record.nextReviewDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canLinkExternalId && selected.status !== 'intake_pending' && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('External system IDs')}</p>
                <p className="text-xs text-gray-600">{t('Link TrackChild, NCRB, CCTNS, GHAR, or state portal identifiers for cross-system traceability.')}</p>
                <button className="btn-ghost mt-3 w-full" disabled={action.pending} onClick={() => exportHandoff(selected)}>
                  {t('Download the file for TrackChild')}
                </button>
                <ActionMessage action={action} id="export" />
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={externalId.idType}
                    onChange={(e) => setExternalId((x) => ({ ...x, idType: e.target.value }))}
                  >
                    {EXTERNAL_ID_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={externalId.externalId}
                    onChange={(e) => setExternalId((x) => ({ ...x, externalId: e.target.value }))}
                    placeholder={t('External ID / reference number')}
                  />
                  <input
                    className="field w-full"
                    value={externalId.issuingSystem}
                    onChange={(e) => setExternalId((x) => ({ ...x, issuingSystem: e.target.value }))}
                    placeholder={t('Issuing system / desk')}
                  />
                  <input
                    className="field w-full"
                    type="date"
                    value={externalId.issuedDate}
                    onChange={(e) => setExternalId((x) => ({ ...x, issuedDate: e.target.value }))}
                  />
                  <textarea
                    className="field min-h-16 w-full"
                    value={externalId.remarks}
                    onChange={(e) => setExternalId((x) => ({ ...x, remarks: e.target.value }))}
                    placeholder={t('Linking remarks')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || externalId.externalId.trim().length < 3}
                    onClick={() => linkExternalId(selected)}
                  >
                    {t('Link external ID')}
                  </button>
                  <ActionMessage action={action} id="external-id" />
                </div>
                {asList(selected.externalIds).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.externalIds).slice().reverse().slice(0, 4).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.externalId)}</p>
                        <p>{txt(record.issuingSystem)} / {txt(record.actorName)}</p>
                        {record.issuedDate && <p className="mt-1 text-gray-400">{t('Issued: {date}', { date: fmtDate(record.issuedDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordRestorationPlan && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Restoration / repatriation')}</p>
                <p className="text-xs text-gray-600">{t('Record restoration route, handover authority, supports, and follow-up dates after rescue or CCI/JJB review.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={restorationPlan.restorationType}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, restorationType: e.target.value }))}
                  >
                    {RESTORATION_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={restorationPlan.status}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, status: e.target.value }))}
                  >
                    {RESTORATION_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{t(statusOption.label)}</option>)}
                  </select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      value={restorationPlan.fromState}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, fromState: e.target.value }))}
                      placeholder={txt(selected.state) || t('From state')}
                    />
                    <input
                      className="field w-full"
                      value={restorationPlan.fromDistrict}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, fromDistrict: e.target.value }))}
                      placeholder={txt(selected.district) || t('From district')}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      value={restorationPlan.toState}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, toState: e.target.value }))}
                      placeholder={t('To state')}
                    />
                    <input
                      className="field w-full"
                      value={restorationPlan.toDistrict}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, toDistrict: e.target.value }))}
                      placeholder={t('To district')}
                    />
                  </div>
                  <input
                    className="field w-full"
                    value={restorationPlan.guardianName}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, guardianName: e.target.value }))}
                    placeholder={txt(selected.parentName) || t('Guardian / receiving person')}
                  />
                  <input
                    className="field w-full"
                    value={restorationPlan.handoverAuthority}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, handoverAuthority: e.target.value }))}
                    placeholder={t('CWC / DCPU / police / embassy authority')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={restorationPlan.plannedDate}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, plannedDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={restorationPlan.followupDate}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, followupDate: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      className="field w-full"
                      value={restorationPlan.travelMode}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, travelMode: e.target.value }))}
                    >
                      {RESTORATION_TRAVEL_MODES.map((mode) => <option key={mode.id} value={mode.id}>{t(mode.label)}</option>)}
                    </select>
                    <input
                      className="field w-full"
                      type="date"
                      value={restorationPlan.travelDate}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, travelDate: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      value={restorationPlan.escortAuthority}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, escortAuthority: e.target.value }))}
                      placeholder={t('Escort authority')}
                    />
                    <input
                      className="field w-full"
                      value={restorationPlan.escortContact}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, escortContact: e.target.value }))}
                      placeholder={t('Escort contact')}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      className="field w-full"
                      value={restorationPlan.documentStatus}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, documentStatus: e.target.value }))}
                    >
                      {RESTORATION_DOCUMENT_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{t(statusOption.label)}</option>)}
                    </select>
                    <input
                      className="field w-full"
                      value={restorationPlan.documentReference}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, documentReference: e.target.value }))}
                      placeholder={t('Document reference')}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      className="field w-full"
                      value={restorationPlan.fundingSource}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, fundingSource: e.target.value }))}
                    >
                      {RESTORATION_FUNDING_SOURCES.map((source) => <option key={source.id} value={source.id}>{t(source.label)}</option>)}
                    </select>
                    <input
                      className="field w-full"
                      value={restorationPlan.fundingReference}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, fundingReference: e.target.value }))}
                      placeholder={t('Funding reference')}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {RESTORATION_SUPPORTS.map((support) => (
                      <label key={support.id} className="flex items-center gap-2 rounded-lg border border-black/5 px-3 py-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={restorationPlan.supports.includes(support.id)}
                          onChange={() => setRestorationSupport(support.id)}
                        />
                        {t(support.label)}
                      </label>
                    ))}
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={restorationPlan.remarks}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, remarks: e.target.value }))}
                    placeholder={t('Restoration route, document checks, handover terms, aftercare follow-up...')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || restorationPlan.toState.trim().length < 2 || restorationPlan.toDistrict.trim().length < 2 || restorationPlan.handoverAuthority.trim().length < 3 || restorationPlan.remarks.trim().length < 10}
                    onClick={() => recordRestorationPlan(selected)}
                  >
                    {t('Record restoration plan')}
                  </button>
                  <ActionMessage action={action} id="restoration" />
                </div>
                {asList(selected.restorationPlans).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.restorationPlans).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.statusLabel)}</p>
                        <p>{txt(record.actorName)} / {new Date(record.recordedAt).toLocaleString(currentLocale())}</p>
                        <p className="mt-1 text-gray-700">{[record.to?.district, record.to?.state].map(txt).filter(Boolean).join(', ')}</p>
                        {record.travel && (
                          <p className="mt-1 text-gray-500">
                            {txt(record.travel.modeLabel)}{record.travel.travelDate ? ` / ${t('travel {date}', { date: fmtDate(record.travel.travelDate) })}` : ''}{record.travel.escortAuthority ? ` / ${t('escort {name}', { name: record.travel.escortAuthority })}` : ''}
                          </p>
                        )}
                        {record.documents && <p className="mt-1 text-gray-500">{t('Documents: {status}', { status: record.documents.statusLabel })}</p>}
                        {record.funding && <p className="mt-1 text-gray-500">{t('Funding: {source}', { source: record.funding.sourceLabel })}</p>}
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.remarks)}</p>
                        {txtList(record.supportLabels) && <p className="mt-1 text-gray-400">{txtList(record.supportLabels, ' / ')}</p>}
                        {record.followupDate && <p className="mt-1 text-gray-400">{t('Follow-up: {date}', { date: fmtDate(record.followupDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordWelfareReferral && !adultCase && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Welfare referral')}</p>
                <p className="text-xs text-gray-600">{t('Record sponsorship, foster care, adoption, aftercare, counselling, medical, education, or family-strengthening referrals.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={welfareReferral.scheme}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, scheme: e.target.value }))}
                  >
                    {WELFARE_SCHEMES.map((scheme) => <option key={scheme.id} value={scheme.id}>{t(scheme.label)}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={welfareReferral.status}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, status: e.target.value }))}
                  >
                    {WELFARE_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{t(statusOption.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={welfareReferral.agencyName}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, agencyName: e.target.value }))}
                    placeholder={t('DCPU / CWC / agency / NGO desk')}
                  />
                  <input
                    className="field w-full"
                    value={welfareReferral.referralNo}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, referralNo: e.target.value }))}
                    placeholder={t('Referral / scheme number')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={welfareReferral.referredDate}
                      onChange={(e) => setWelfareReferral((w) => ({ ...w, referredDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={welfareReferral.reviewDate}
                      onChange={(e) => setWelfareReferral((w) => ({ ...w, reviewDate: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={welfareReferral.eligibilityNote}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, eligibilityNote: e.target.value }))}
                    placeholder={t('Eligibility basis, family situation, immediate support needs...')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || welfareReferral.agencyName.trim().length < 3 || welfareReferral.eligibilityNote.trim().length < 10 || !welfareReferral.referredDate}
                    onClick={() => recordWelfareReferral(selected)}
                  >
                    {t('Record welfare referral')}
                  </button>
                  <ActionMessage action={action} id="welfare" />
                </div>
                {asList(selected.welfareReferrals).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.welfareReferrals).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.statusLabel)}</p>
                        <p>{txt(record.agencyName)} / {txt(record.actorName)}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.eligibilityNote)}</p>
                        {record.referralNo && <p className="mt-1 text-gray-400">{t('Ref: {ref}', { ref: record.referralNo })}</p>}
                        {record.reviewDate && <p className="mt-1 text-gray-400">{t('Review: {date}', { date: fmtDate(record.reviewDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordLegalAidReferral && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Legal-aid referral')}</p>
                <p className="text-xs text-gray-600">{t('Record DLSA legal aid, victim compensation, court support, and document or affidavit follow-up.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={legalAidReferral.serviceType}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, serviceType: e.target.value }))}
                  >
                    {LEGAL_AID_SERVICE_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={legalAidReferral.status}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, status: e.target.value }))}
                  >
                    {LEGAL_AID_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{t(statusOption.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={legalAidReferral.authorityName}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, authorityName: e.target.value }))}
                    placeholder={t('DLSA / legal services authority')}
                  />
                  <input
                    className="field w-full"
                    value={legalAidReferral.applicationNo}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, applicationNo: e.target.value }))}
                    placeholder={t('Application / case reference')}
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      className="field w-full"
                      type="date"
                      value={legalAidReferral.referredDate}
                      onChange={(e) => setLegalAidReferral((l) => ({ ...l, referredDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={legalAidReferral.hearingDate}
                      onChange={(e) => setLegalAidReferral((l) => ({ ...l, hearingDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={legalAidReferral.reviewDate}
                      onChange={(e) => setLegalAidReferral((l) => ({ ...l, reviewDate: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={legalAidReferral.note}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, note: e.target.value }))}
                    placeholder={t('Legal support need, application status, next action...')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || legalAidReferral.authorityName.trim().length < 3 || legalAidReferral.note.trim().length < 10 || !legalAidReferral.referredDate}
                    onClick={() => recordLegalAidReferral(selected)}
                  >
                    {t('Record legal-aid referral')}
                  </button>
                  <ActionMessage action={action} id="legal-aid" />
                </div>
                {asList(selected.legalAidReferrals).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.legalAidReferrals).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.statusLabel)}</p>
                        <p>{txt(record.authorityName)} / {txt(record.actorName)}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.note)}</p>
                        {record.applicationNo && <p className="mt-1 text-gray-400">{t('Ref: {ref}', { ref: record.applicationNo })}</p>}
                        {record.hearingDate && <p className="mt-1 text-gray-400">{t('Hearing: {date}', { date: fmtDate(record.hearingDate) })}</p>}
                        {record.reviewDate && <p className="mt-1 text-gray-400">{t('Review: {date}', { date: fmtDate(record.reviewDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordAdoption && !adultCase && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Adoption / CARINGS record')}</p>
                <p className="text-xs text-gray-600">{t('Record CWC orders, declarations that a child is free for adoption, SAA admission, SARA review, CARINGS updates, or foster care before adoption.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={adoptionRecord.recordType}
                    onChange={(e) => setAdoptionRecord((a) => ({ ...a, recordType: e.target.value }))}
                  >
                    {ADOPTION_RECORD_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={adoptionRecord.status}
                    onChange={(e) => setAdoptionRecord((a) => ({ ...a, status: e.target.value }))}
                  >
                    {ADOPTION_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{t(statusOption.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={adoptionRecord.agencyName}
                    onChange={(e) => setAdoptionRecord((a) => ({ ...a, agencyName: e.target.value }))}
                    placeholder={t('SAA / SARA / CWC authority')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      value={adoptionRecord.caringsId}
                      onChange={(e) => setAdoptionRecord((a) => ({ ...a, caringsId: e.target.value }))}
                      placeholder={t('CARINGS reference')}
                    />
                    <input
                      className="field w-full"
                      value={adoptionRecord.orderNo}
                      onChange={(e) => setAdoptionRecord((a) => ({ ...a, orderNo: e.target.value }))}
                      placeholder={t('Order / declaration number')}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={adoptionRecord.orderDate}
                      onChange={(e) => setAdoptionRecord((a) => ({ ...a, orderDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={adoptionRecord.nextReviewDate}
                      onChange={(e) => setAdoptionRecord((a) => ({ ...a, nextReviewDate: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={adoptionRecord.note}
                    onChange={(e) => setAdoptionRecord((a) => ({ ...a, note: e.target.value }))}
                    placeholder={t('Adoption follow-up status, document gap, next action...')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || adoptionRecord.agencyName.trim().length < 3 || adoptionRecord.note.trim().length < 10 || !adoptionRecord.orderDate}
                    onClick={() => recordAdoption(selected)}
                  >
                    {t('Record adoption follow-up')}
                  </button>
                  <ActionMessage action={action} id="adoption" />
                </div>
                {asList(selected.adoptionRecords).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.adoptionRecords).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.statusLabel)}</p>
                        <p>{txt(record.agencyName)} / {txt(record.actorName)}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.note)}</p>
                        {record.caringsId && <p className="mt-1 text-gray-400">CARINGS: {txt(record.caringsId)}</p>}
                        {record.orderNo && <p className="mt-1 text-gray-400">{t('Order: {no}', { no: record.orderNo })}</p>}
                        {record.nextReviewDate && <p className="mt-1 text-gray-400">{t('Review: {date}', { date: fmtDate(record.nextReviewDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordCaseAssessment && !adultCase && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('SIR / care assessment')}</p>
                <p className="text-xs text-gray-600">{t('Record social investigation, individual care plan, risk, family, or rehabilitation assessment details.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={caseAssessment.assessmentType}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, assessmentType: e.target.value }))}
                  >
                    {CASE_ASSESSMENT_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={caseAssessment.riskLevel}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, riskLevel: e.target.value }))}
                  >
                    {CASE_RISK_LEVELS.map((risk) => <option key={risk.id} value={risk.id}>{t(risk.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={caseAssessment.assessorName}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, assessorName: e.target.value }))}
                    placeholder={t('Assessor / probation officer / CWC member')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="date"
                      value={caseAssessment.assessmentDate}
                      onChange={(e) => setCaseAssessment((a) => ({ ...a, assessmentDate: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="date"
                      value={caseAssessment.nextReviewDate}
                      onChange={(e) => setCaseAssessment((a) => ({ ...a, nextReviewDate: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-20 w-full"
                    value={caseAssessment.findings}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, findings: e.target.value }))}
                    placeholder={t('Findings')}
                  />
                  <textarea
                    className="field min-h-20 w-full"
                    value={caseAssessment.carePlan}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, carePlan: e.target.value }))}
                    placeholder={t('Individual care plan / rehabilitation actions')}
                  />
                  <textarea
                    className="field min-h-16 w-full"
                    value={caseAssessment.recommendation}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, recommendation: e.target.value }))}
                    placeholder={t('Recommendation')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || caseAssessment.assessorName.trim().length < 3 || caseAssessment.findings.trim().length < 10 || caseAssessment.carePlan.trim().length < 10 || !caseAssessment.assessmentDate}
                    onClick={() => recordCaseAssessment(selected)}
                  >
                    {t('Record assessment')}
                  </button>
                  <ActionMessage action={action} id="assessment" />
                </div>
                {asList(selected.caseAssessments).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.caseAssessments).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.riskLabel)}</p>
                        <p>{txt(record.assessorName)} / {txt(record.actorName)}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.findings)}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.carePlan)}</p>
                        {record.nextReviewDate && <p className="mt-1 text-gray-400">{t('Review: {date}', { date: fmtDate(record.nextReviewDate) })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordProduction && !adultCase && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('CWC / JJB production')}</p>
                <p className="text-xs text-gray-600">{t('Record rescue-to-production timing, authority, outcome, and 24-hour deadline status.')}</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={productionRecord.productionType}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, productionType: e.target.value }))}
                  >
                    {PRODUCTION_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={productionRecord.outcome}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, outcome: e.target.value }))}
                  >
                    {PRODUCTION_OUTCOMES.map((outcome) => <option key={outcome.id} value={outcome.id}>{t(outcome.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={productionRecord.authorityName}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, authorityName: e.target.value }))}
                    placeholder={t('CWC / JJB / medical authority')}
                  />
                  <input
                    className="field w-full"
                    value={productionRecord.orderNo}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, orderNo: e.target.value }))}
                    placeholder={t('Order / production number')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="field w-full"
                      type="datetime-local"
                      value={productionRecord.rescueAt}
                      onChange={(e) => setProductionRecord((p) => ({ ...p, rescueAt: e.target.value }))}
                    />
                    <input
                      className="field w-full"
                      type="datetime-local"
                      value={productionRecord.producedAt}
                      onChange={(e) => setProductionRecord((p) => ({ ...p, producedAt: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="field min-h-20 w-full"
                    value={productionRecord.nextAction}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, nextAction: e.target.value }))}
                    placeholder={t('Next action after production')}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={action.pending || productionRecord.authorityName.trim().length < 3 || productionRecord.nextAction.trim().length < 10 || !productionRecord.rescueAt || !productionRecord.producedAt}
                    onClick={() => recordProduction(selected)}
                  >
                    {t('Record production')}
                  </button>
                  <ActionMessage action={action} id="production" />
                </div>
                {asList(selected.productionRecords).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {asList(selected.productionRecords).slice().reverse().slice(0, 3).map((record, i) => (
                      <div key={txt(record?.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{txt(record.label)} / {txt(record.outcomeLabel)}</p>
                        <p>{txt(record.authorityName)} / {txt(record.actorName)}</p>
                        <p className="mt-1 text-gray-700">{t('{n}h', { n: record.hoursToProduce })} / {record.deadlineStatus === 'within_24h' ? t('within 24h') : t('delayed')}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(record.nextAction)}</p>
                        {record.orderNo && <p className="mt-1 text-gray-400">{t('Order: {no}', { no: record.orderNo })}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canTransferCase && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Transfer to another area')}</p>
                <p className="text-xs text-gray-600">{t('Move this case to another district when investigation or child-protection follow-up shifts.')}</p>
                <div className="mt-3 grid gap-2">
                  <input className="field w-full" value={transfer.state} onChange={(e) => setTransfer((prev) => ({ ...prev, state: e.target.value }))} placeholder={t('Target state')} />
                  <input className="field w-full" value={transfer.district} onChange={(e) => setTransfer((prev) => ({ ...prev, district: e.target.value }))} placeholder={t('Target district')} />
                  <input className="field w-full" value={transfer.station} onChange={(e) => setTransfer((prev) => ({ ...prev, station: e.target.value }))} placeholder={t('Target station / desk')} />
                  <textarea className="field min-h-16 w-full" value={transfer.reason} onChange={(e) => setTransfer((prev) => ({ ...prev, reason: e.target.value }))} placeholder={t('Transfer reason')} />
                  <button className="btn-ghost w-full" disabled={action.pending || !transfer.state.trim() || !transfer.district.trim()} onClick={() => transferJurisdiction(selected)}>
                    {t('Transfer case')}
                  </button>
                  <ActionMessage action={action} id="transfer" />
                </div>
                {asList(selected.transfers).length > 0 && (
                  <p className="mt-2 text-xs text-gray-400">{asList(selected.transfers).length === 1 ? t('1 transfer recorded.') : t('{n} transfers recorded.', { n: asList(selected.transfers).length })}</p>
                )}
              </div>
            )}

            {canCloseCase && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">{t('Close case outcome')}</p>
                <p className="text-xs text-gray-600">{t('Record the final TrackChild-style outcome after CWC/police review.')}</p>
                <div className="mt-3 space-y-3">
                  <select className="field w-full" value={closeReasons.some((reason) => reason.id === closure.reason) ? closure.reason : closeReasons[0].id} onChange={(e) => setClosure((c) => ({ ...c, reason: e.target.value }))}>
                    {closeReasons.map((reason) => <option key={reason.id} value={reason.id}>{t(reason.label)}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={closure.foundLocation}
                    onChange={(e) => setClosure((c) => ({ ...c, foundLocation: e.target.value }))}
                    placeholder={txt(selected.foundLocation) || t('Restoration / transfer location')}
                  />
                  <textarea
                    className="field min-h-20 w-full"
                    value={closure.note}
                    onChange={(e) => setClosure((c) => ({ ...c, note: e.target.value }))}
                    placeholder={t('Closure note')}
                  />
                  <button onClick={() => closeCase(selected)} disabled={action.pending} className="btn-primary w-full">{t('Close case')}</button>
                  <ActionMessage action={action} id="close" />
                </div>
              </div>
            )}

            {canReopen && ['found', 'closed'].includes(selected.status) && (
              <ReopenCasePanel
                report={selected}
                action={action}
                onReport={(report) => { showReport({ ...report, pendingMatch: null }); load(); }}
              />
            )}

            </ErrorBoundary>
            </div>
          </div>
        </div>
      )}

      {selected && photoView?.caseId === selected.id && (
        <ErrorBoundary>
          <PhotoViewer
            title={d(selected.childName) || selected.id}
            onClose={() => setPhotoView(null)}
            panes={[
              {
                label: t('Case photos'),
                startId: photoView.startId,
                photos: viewPhotosOf(selected).map((p) => ({
                  id: p.id,
                  src: p.src,
                  caption: [
                    p.id === MAIN_PHOTO && t('Main photo'),
                    txt(selected.age) && t('age {n}', { n: txt(selected.age) }),
                    selected.dateOfMissing && `${t('Missing since')} ${fmtDate(selected.dateOfMissing)}`,
                  ].filter(Boolean).join(' · '),
                })),
              },
              selected.pendingMatch?.foundReportId && {
                label: t('Sighting photos'),
                startId: selected.pendingMatch.photoPair?.sighting || MAIN_PHOTO,
                photos: (asList(selected.pendingMatch.sightingPhotoIds).length ? asList(selected.pendingMatch.sightingPhotoIds) : [MAIN_PHOTO]).map((id) => ({
                  id,
                  src: id === MAIN_PHOTO
                    ? `/api/reports/photo/${encodeURIComponent(selected.pendingMatch.foundReportId)}`
                    : extraPhotoUrl(encodeURIComponent(selected.pendingMatch.foundReportId), id),
                  caption: t('Possible match · {pct}% similar · not verified', { pct: Math.round((Number(selected.pendingMatch.score) || 0) * 100) }),
                })),
              },
            ].filter(Boolean)}
            footer={selected.pendingMatch?.foundReportId ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('Looking at the photos does not confirm a match. Confirming asks how the person was verified: in person, by video or from documents.')}</span>
                <Link
                  to={`/app/matches?id=${encodeURIComponent(selected.pendingMatch.foundReportId)}`}
                  className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-white/90"
                >
                  {t('Open this sighting')}
                </Link>
              </div>
            ) : null}
          />
        </ErrorBoundary>
      )}

      {confirming && (
        <ErrorBoundary>
          <ConfirmMatchDialog
            report={confirming.report}
            sighting={confirming.sightingId
              ? {
                  id: confirming.sightingId,
                  matchScore: confirming.score,
                  personCategory: confirming.report.personCategory,
                  // Which photos the score is for, so the dialog shows that pair.
                  photoPair: confirming.report.pendingMatch?.photoPair || null,
                  extraPhotos: asList(confirming.report.pendingMatch?.sightingPhotoIds).filter((id) => id !== MAIN_PHOTO).map((id) => ({ id })),
                }
              : null}
            action={action}
            onSubmit={submitConfirmation}
            onCancel={() => { setConfirming(null); action.clear(); }}
          />
        </ErrorBoundary>
      )}

      <ActionToast action={action} />
    </div>
  );
}
