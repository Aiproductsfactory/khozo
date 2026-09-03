import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDate, StatusBadge, Avatar, ROLE_LABELS } from '../lib.jsx';

const FORMAL_ACTION_ROLES = ['super_admin', 'admin', 'police', 'sjpu'];
const WORKFLOW_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const CASE_CLOSE_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'cwc', 'dcpu', 'cci', 'saa', 'jjb', 'state_nodal', 'sara'];
const CASE_ASSIGN_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const INVESTIGATION_CHECKLIST_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'state_nodal', 'crime_bureau'];
const INTAKE_VERIFY_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'cwc', 'dcpu', 'state_nodal'];
const BULLETIN_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'state_nodal'];
const CASE_TRANSFER_ROLES = ['super_admin', 'admin', 'state_nodal'];
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
  { id: 'refer_cwc', label: 'Refer CWC', roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dcpu', 'rpf', 'cci', 'jjb', 'state_nodal', 'crime_bureau'] },
  { id: 'assign_cci', label: 'Assign CCI', roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'state_nodal'] },
  { id: 'refer_jjb', label: 'Refer JJB', roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'cci', 'state_nodal'] },
  { id: 'escalate_state', label: 'Escalate State', roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'cwc', 'dcpu', 'rpf', 'cci', 'jjb', 'crime_bureau'] },
  { id: 'notify_crime_bureau', label: 'Notify Bureau', roles: ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'state_nodal'] },
];
const ASSIGNMENT_TYPES = [
  { id: 'investigation', label: 'Investigation owner' },
  { id: 'welfare', label: 'Welfare follow-up owner' },
  { id: 'railway', label: 'Railway / transit owner' },
  { id: 'cci', label: 'CCI care owner' },
  { id: 'adoption', label: 'Adoption follow-up owner' },
  { id: 'jjb', label: 'JJB proceeding owner' },
  { id: 'bureau', label: 'Records bureau owner' },
  { id: 'legal', label: 'Legal aid owner' },
];
const INVESTIGATION_CHECKLIST_ITEMS = [
  { id: 'fir_registered', label: 'FIR / GD registered' },
  { id: 'trackchild_updated', label: 'TrackChild updated' },
  { id: 'khoyapaya_checked', label: 'Khoya-Paya checked' },
  { id: 'cctns_linked', label: 'CCTNS linked' },
  { id: 'ncrb_scrb_alerted', label: 'NCRB / SCRB alerted' },
  { id: 'lookout_circulated', label: 'Lookout circulated' },
  { id: 'railway_rpf_alerted', label: 'Railway / RPF alerted' },
  { id: 'childline_1098_alerted', label: '1098 alerted' },
  { id: 'cwc_informed', label: 'CWC informed' },
  { id: 'media_bulletin_reviewed', label: 'Bulletin reviewed' },
  { id: 'family_statement_recorded', label: 'Family statement' },
  { id: 'last_seen_verified', label: 'Last-seen verified' },
];
const CASE_CLOSE_REASONS = [
  { id: 'restored_family', label: 'Restored to family' },
  { id: 'transferred_cci', label: 'Transferred to CCI' },
  { id: 'adoption', label: 'Adoption / aftercare' },
  { id: 'repatriated', label: 'Repatriated' },
  { id: 'death', label: 'Death recorded' },
  { id: 'traced_not_reunited', label: 'Traced, pending reunification' },
  { id: 'other', label: 'Other closure' },
];
const CCI_ADMISSION_TYPES = [
  { id: 'temporary_shelter', label: 'Temporary shelter' },
  { id: 'restoration_pending', label: 'Restoration pending' },
  { id: 'medical_care', label: 'Medical care' },
  { id: 'counselling', label: 'Counselling' },
  { id: 'aftercare_followup', label: 'Aftercare follow-up' },
];
const CCI_SERVICE_TYPES = [
  { id: 'education', label: 'Education' },
  { id: 'vocational_training', label: 'Vocational training' },
  { id: 'recreation', label: 'Recreation' },
  { id: 'health_care', label: 'Health care' },
  { id: 'counselling', label: 'Counselling' },
  { id: 'family_tracing', label: 'Family tracing' },
];
const CCI_PROGRESS_STATES = [
  { id: 'intake', label: 'Intake' },
  { id: 'active', label: 'Active' },
  { id: 'review_due', label: 'Review due' },
  { id: 'ready_for_restoration', label: 'Ready for restoration' },
  { id: 'completed', label: 'Completed' },
];
const JJB_PROCEEDING_TYPES = [
  { id: 'preliminary_hearing', label: 'Preliminary hearing' },
  { id: 'social_investigation_order', label: 'Social investigation order' },
  { id: 'rehabilitation_direction', label: 'Rehabilitation direction' },
  { id: 'family_tracing_direction', label: 'Family tracing direction' },
  { id: 'final_order_review', label: 'Final order review' },
];
const STATE_ESCALATION_TYPES = [
  { id: 'inter_district_coordination', label: 'Inter-district coordination' },
  { id: 'interstate_coordination', label: 'Interstate coordination' },
  { id: 'resource_support', label: 'Resource support' },
  { id: 'policy_exception', label: 'Policy exception' },
  { id: 'urgent_rescue_coordination', label: 'Urgent rescue coordination' },
];
const STATE_ESCALATION_LEVELS = [
  { id: 'district_to_state', label: 'District to state' },
  { id: 'state_task_force', label: 'State task force' },
  { id: 'interstate_desk', label: 'Interstate desk' },
  { id: 'national_command', label: 'National command' },
];
const BUREAU_REPORT_TYPES = [
  { id: 'ncrb_missing_child_update', label: 'NCRB missing-child update' },
  { id: 'scrb_state_update', label: 'SCRB state update' },
  { id: 'interstate_alert', label: 'Interstate alert' },
  { id: 'recurring_pattern_review', label: 'Recurring pattern review' },
  { id: 'final_trace_update', label: 'Final trace update' },
];
const BUREAU_LEVELS = [
  { id: 'ncrb', label: 'NCRB' },
  { id: 'scrb', label: 'SCRB' },
  { id: 'state_control_room', label: 'State control room' },
];
const BUREAU_PRIORITIES = [
  { id: 'routine', label: 'Routine' },
  { id: 'priority', label: 'Priority' },
  { id: 'urgent', label: 'Urgent' },
];
const RESTORATION_TYPES = [
  { id: 'family_restoration', label: 'Family restoration' },
  { id: 'interstate_transfer', label: 'Interstate restoration' },
  { id: 'inter_district_transfer', label: 'Inter-district restoration' },
  { id: 'international_repatriation', label: 'International repatriation' },
  { id: 'cci_aftercare', label: 'CCI aftercare follow-up' },
];
const RESTORATION_STATUSES = [
  { id: 'planned', label: 'Planned' },
  { id: 'documents_pending', label: 'Documents pending' },
  { id: 'transit_scheduled', label: 'Transit scheduled' },
  { id: 'handed_over', label: 'Handed over' },
  { id: 'followup_due', label: 'Follow-up due' },
  { id: 'completed', label: 'Completed' },
];
const RESTORATION_SUPPORTS = [
  { id: 'interpreter', label: 'Interpreter' },
  { id: 'escort', label: 'Escort' },
  { id: 'medical', label: 'Medical' },
  { id: 'counsellor', label: 'Counsellor' },
  { id: 'documents', label: 'Documents' },
  { id: 'other', label: 'Other' },
];
const RESTORATION_TRAVEL_MODES = [
  { id: 'rail', label: 'Rail' },
  { id: 'road', label: 'Road' },
  { id: 'air', label: 'Air' },
  { id: 'mixed', label: 'Mixed route' },
  { id: 'local_handover', label: 'Local handover' },
  { id: 'not_required', label: 'Not required' },
];
const RESTORATION_DOCUMENT_STATUSES = [
  { id: 'not_started', label: 'Not started' },
  { id: 'pending', label: 'Pending' },
  { id: 'verified', label: 'Verified' },
  { id: 'exception_approved', label: 'Exception approved' },
];
const RESTORATION_FUNDING_SOURCES = [
  { id: 'dcpu', label: 'DCPU' },
  { id: 'cwc', label: 'CWC' },
  { id: 'state', label: 'State' },
  { id: 'ngo', label: 'NGO / CSR' },
  { id: 'family', label: 'Family' },
  { id: 'not_required', label: 'Not required' },
];
const EXTERNAL_ID_TYPES = [
  { id: 'trackchild', label: 'TrackChild ID' },
  { id: 'khoyapaya', label: 'Khoya-Paya ID' },
  { id: 'ncrb', label: 'NCRB ID' },
  { id: 'scrb', label: 'SCRB ID' },
  { id: 'cctns', label: 'CCTNS / FIR link' },
  { id: 'ghar', label: 'GHAR restoration ID' },
  { id: 'state_portal', label: 'State portal ID' },
  { id: 'other', label: 'Other external ID' },
];
const WELFARE_SCHEMES = [
  { id: 'sponsorship', label: 'Sponsorship care' },
  { id: 'foster_care', label: 'Foster care' },
  { id: 'adoption_facilitation', label: 'Adoption facilitation' },
  { id: 'aftercare', label: 'Aftercare' },
  { id: 'counselling', label: 'Counselling' },
  { id: 'medical_support', label: 'Medical support' },
  { id: 'education_support', label: 'Education support' },
  { id: 'family_strengthening', label: 'Family strengthening' },
];
const WELFARE_STATUSES = [
  { id: 'referred', label: 'Referred' },
  { id: 'eligibility_review', label: 'Eligibility review' },
  { id: 'approved', label: 'Approved' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'rejected', label: 'Rejected' },
];
const LEGAL_AID_SERVICE_TYPES = [
  { id: 'legal_aid', label: 'Legal aid' },
  { id: 'victim_compensation', label: 'Victim compensation' },
  { id: 'court_support', label: 'Court support' },
  { id: 'counselling_order_support', label: 'Counselling / protection order support' },
  { id: 'document_affidavit', label: 'Document or affidavit support' },
  { id: 'other', label: 'Other legal service' },
];
const LEGAL_AID_STATUSES = [
  { id: 'referred', label: 'Referred' },
  { id: 'application_filed', label: 'Application filed' },
  { id: 'approved', label: 'Approved' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'rejected', label: 'Rejected' },
];
const ADOPTION_RECORD_TYPES = [
  { id: 'cwc_order', label: 'CWC adoption order / declaration' },
  { id: 'legally_free_declaration', label: 'Legally free declaration' },
  { id: 'carings_registration', label: 'CARINGS registration' },
  { id: 'saa_intake', label: 'SAA intake' },
  { id: 'sara_review', label: 'SARA review' },
  { id: 'pre_adoption_foster_care', label: 'Pre-adoption foster care' },
  { id: 'followup_visit', label: 'Follow-up visit' },
  { id: 'other', label: 'Other adoption action' },
];
const ADOPTION_STATUSES = [
  { id: 'initiated', label: 'Initiated' },
  { id: 'pending_documents', label: 'Documents pending' },
  { id: 'cwc_review', label: 'CWC review' },
  { id: 'carings_updated', label: 'CARINGS updated' },
  { id: 'saa_care', label: 'SAA care' },
  { id: 'sara_review', label: 'SARA review' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On hold' },
];
const CASE_ASSESSMENT_TYPES = [
  { id: 'social_investigation_report', label: 'Social Investigation Report' },
  { id: 'individual_care_plan', label: 'Individual Care Plan' },
  { id: 'family_assessment', label: 'Family assessment' },
  { id: 'risk_assessment', label: 'Risk assessment' },
  { id: 'rehabilitation_plan', label: 'Rehabilitation plan' },
];
const CASE_RISK_LEVELS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'critical', label: 'Critical' },
];
const PRODUCTION_TYPES = [
  { id: 'cwc', label: 'Produced before CWC' },
  { id: 'jjb', label: 'Produced before JJB' },
  { id: 'emergency_medical', label: 'Emergency medical production' },
  { id: 'cci_intake', label: 'Produced for CCI intake' },
];
const PRODUCTION_OUTCOMES = [
  { id: 'care_order_pending', label: 'Care order pending' },
  { id: 'sent_medical', label: 'Sent for medical care' },
  { id: 'sent_cci', label: 'Sent to CCI' },
  { id: 'restored_guardian', label: 'Restored to guardian' },
  { id: 'police_inquiry', label: 'Police inquiry pending' },
  { id: 'repatriation_started', label: 'Repatriation started' },
];

// The deck's "Basic Table": the operational register of children, scoped by role.
export default function Cases() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [districtFilter, setDistrictFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
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
  const canAct = FORMAL_ACTION_ROLES.includes(user.role);

  /** Filter options drawn from the caseload, so nothing offered returns zero. */
  const facets = useMemo(
    () => ({
      states: [...new Set(rows.map((r) => r.state).filter(Boolean))].sort(),
      districts: [
        ...new Set(
          rows
            .filter((r) => !stateFilter || r.state === stateFilter)
            .map((r) => r.district)
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
        if (from || to) {
          const when = new Date(r.dateOfMissing || r.createdAt || 0).getTime();
          if (!Number.isFinite(when)) return false;
          if (from && when < from) return false;
          if (to && when > to) return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [rows, stateFilter, districtFilter, genderFilter, fromDate, toDate]);
  const canWorkflow = WORKFLOW_ROLES.includes(user.role);
  const canAssignCase = CASE_ASSIGN_ROLES.includes(user.role);
  const canRecordInvestigationChecklist = INVESTIGATION_CHECKLIST_ROLES.includes(user.role);
  const canCloseCase = CASE_CLOSE_ROLES.includes(user.role);
  const canVerifyIntake = INTAKE_VERIFY_ROLES.includes(user.role);
  const canManageBulletin = BULLETIN_ROLES.includes(user.role);
  const canTransferCase = CASE_TRANSFER_ROLES.includes(user.role);
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
  const workflowActions = WORKFLOW_ACTIONS.filter((a) => a.roles.includes(user.role));

  const load = () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    api.get(`/reports?${params}`).then((d) => setRows(d.reports)).catch(() => {});
  };
  useEffect(load, [status]);

  useEffect(() => {
    if (!selected || !canAssignCase || ['found', 'closed', 'intake_pending'].includes(selected.status)) {
      setAssignableUsers([]);
      return;
    }
    api.get(`/reports/${selected.id}/assignable-users`)
      .then((data) => {
        const users = data.users || [];
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

  const sendSms = async (r) => {
    const res = await api.post(`/reports/${r.id}/send-sms`, {});
    alert(res.message);
    load();
  };

  const confirmMatch = async (r) => {
    await api.post(`/reports/${r.id}/confirm-match`, { sendSms: true, foundLocation: r.foundLocation || 'Reported location' });
    setSelected(null);
    load();
  };

  const caseWorkflow = async (r, action) => {
    const data = await api.post(`/reports/${r.id}/case-workflow`, { action });
    setSelected(data.report);
    load();
  };

  const assignOwner = async (r) => {
    const data = await api.post(`/reports/${r.id}/assign-owner`, assignment);
    setSelected(data.report);
    setAssignment((current) => ({ ...current, dueDate: '', note: '' }));
    load();
  };

  const closeCase = async (r) => {
    const data = await api.post(`/reports/${r.id}/close-case`, {
      reason: closure.reason,
      note: closure.note,
      foundLocation: closure.foundLocation || r.foundLocation || undefined,
    });
    setSelected(data.report);
    setClosure({ reason: 'restored_family', note: '', foundLocation: '' });
    load();
  };

  const addNote = async (r) => {
    const data = await api.post(`/reports/${r.id}/notes`, { note: caseNote });
    setSelected(data.report);
    setCaseNote('');
    load();
  };

  const verifyIntake = async (r) => {
    const data = await api.post(`/reports/${r.id}/verify-intake`, verify);
    setSelected(data.report);
    setVerify({ firNo: '', note: '' });
    load();
  };

  const toggleBulletin = async (r, publish) => {
    const data = await api.post(`/reports/${r.id}/bulletin`, { publish });
    setSelected(data.report);
    load();
  };

  const exportHandoff = async (r, targetSystem = 'trackchild') => {
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
  };

  const transferJurisdiction = async (r) => {
    const data = await api.post(`/reports/${r.id}/transfer-jurisdiction`, transfer);
    setSelected(data.report);
    setTransfer({ state: user.jurisdiction?.state || '', district: '', station: '', reason: '' });
    load();
  };

  const recordCciCare = async (r) => {
    const data = await api.post(`/reports/${r.id}/cci-care`, cciCare);
    setSelected(data.report);
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
  };

  const recordJjbProceeding = async (r) => {
    const data = await api.post(`/reports/${r.id}/jjb-proceeding`, jjbProceeding);
    setSelected(data.report);
    setJjbProceeding({
      proceedingType: 'preliminary_hearing',
      boardName: user.role === 'jjb' ? user.org || '' : '',
      caseNo: '',
      orderDate: new Date().toISOString().slice(0, 10),
      nextHearingDate: '',
      directions: '',
    });
    load();
  };

  const recordStateEscalation = async (r) => {
    const data = await api.post(`/reports/${r.id}/state-escalation`, stateEscalation);
    setSelected(data.report);
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
  };

  const recordBureauReport = async (r) => {
    const data = await api.post(`/reports/${r.id}/bureau-report`, bureauReport);
    setSelected(data.report);
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
  };

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

  const recordInvestigationChecklist = async (r) => {
    const data = await api.post(`/reports/${r.id}/investigation-checklist`, investigationChecklist);
    setSelected(data.report);
    setInvestigationChecklist({
      items: ['fir_registered', 'trackchild_updated'],
      officerName: user.name || '',
      stationDiaryNo: '',
      actionDate: new Date().toISOString().slice(0, 10),
      followupDate: '',
      note: '',
    });
    load();
  };

  const recordRestorationPlan = async (r) => {
    const data = await api.post(`/reports/${r.id}/restoration-plan`, restorationPlan);
    setSelected(data.report);
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
  };

  const linkExternalId = async (r) => {
    const data = await api.post(`/reports/${r.id}/external-id`, externalId);
    setSelected(data.report);
    setExternalId({
      idType: 'trackchild',
      externalId: '',
      issuingSystem: 'Mission Vatsalya / TrackChild',
      issuedDate: new Date().toISOString().slice(0, 10),
      remarks: '',
    });
    load();
  };

  const recordWelfareReferral = async (r) => {
    const data = await api.post(`/reports/${r.id}/welfare-referral`, welfareReferral);
    setSelected(data.report);
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
  };

  const recordLegalAidReferral = async (r) => {
    const data = await api.post(`/reports/${r.id}/legal-aid-referral`, legalAidReferral);
    setSelected(data.report);
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
  };

  const recordAdoption = async (r) => {
    const data = await api.post(`/reports/${r.id}/adoption-record`, adoptionRecord);
    setSelected(data.report);
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
  };

  const recordCaseAssessment = async (r) => {
    const data = await api.post(`/reports/${r.id}/case-assessment`, caseAssessment);
    setSelected(data.report);
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
  };

  const recordProduction = async (r) => {
    const data = await api.post(`/reports/${r.id}/production-record`, productionRecord);
    setSelected(data.report);
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
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Cases &amp; FIRs</h2>
          <p className="text-sm text-gray-500">{rows.length} records in your scope</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form onSubmit={(e) => { e.preventDefault(); load(); }}>
            <input className="field w-56" placeholder="Search name, FIR, place..." value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <select className="field w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="intake_pending">Intake pending</option>
            <option value="missing">Missing</option>
            <option value="under_review">Under review</option>
            <option value="found">Found</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {/*
        Area, gender and date, applied to the rows already in hand. A caseload
        is searched by "girls, this district, last fortnight" far more often
        than by name, and there was no way to ask that.
      */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">State</label>
          <select className="field w-44" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            <option value="">Any state</option>
            {facets.states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">District</label>
          <select className="field w-44" value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}>
            <option value="">Any district</option>
            {facets.districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Gender</label>
          <select className="field w-32" value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)}>
            <option value="">Any</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <label className="label">Missing from</label>
          <input type="date" className="field w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Missing to</label>
          <input type="date" className="field w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <p className="text-xs font-medium text-gray-500">
            {visibleRows.length} of {rows.length} shown
          </p>
          {(stateFilter || districtFilter || genderFilter || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setStateFilter(''); setDistrictFilter(''); setGenderFilter(''); setFromDate(''); setToDate(''); }}
              className="text-xs font-semibold text-khozo hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Child</th>
                <th className="px-4 py-3">FIR no.</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">Found location</th>
                <th className="px-4 py-3">Parent / contact</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Missing since</th>
                <th className="px-4 py-3">Source</th>
                {canAct && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id} className="border-b border-black/5 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <button className="flex items-center gap-3 text-left" onClick={() => setSelected(r)}>
                      <Avatar name={r.childName} src={r.photoUrl} size={38} />
                      <div>
                        <p className="font-semibold capitalize">{r.childName}</p>
                        <p className="text-xs text-gray-400">{r.gender} / age {r.age ?? '-'}</p>
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.firNo || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                    {/* An unconfirmed match is the most urgent fact about a case and
                        it does not change the case's status; without this line the
                        row reads "Missing" while the Matches queue holds a 71%. */}
                    {r.pendingMatch ? (
                      <Link
                        to={`/app/matches?id=${encodeURIComponent(r.pendingMatch.foundReportId)}`}
                        className="mt-1 inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-200"
                      >
                        Matched — pending verification · {Math.round(r.pendingMatch.score * 100)}%
                        {r.pendingMatch.corroborated ? ' · two engines' : ''}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.workflowStatus || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.foundLocation || '-'}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700">{r.parentName || '-'}</p>
                    <p className="text-xs text-gray-400">{r.parentPhone || ''}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{[r.district, r.state].filter(Boolean).join(', ') || r.address || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(r.dateOfMissing)}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{ROLE_LABELS[r.registeredByRole] || r.registeredByRole}</span></td>
                  {canAct && (
                    <td className="px-4 py-3 text-right">
                      {r.status === 'found' ? (
                        <button onClick={() => sendSms(r)} className={`text-xs font-medium ${r.smsSent ? 'text-gray-400' : 'text-khozo hover:underline'}`}>
                          {r.smsSent ? 'alerted' : 'Send SMS'}
                        </button>
                      ) : (
                        <button onClick={() => setSelected(r)} className="text-xs font-medium text-khozo hover:underline">Review</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={canAct ? 10 : 9} className="px-4 py-10 text-center text-gray-400">No records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar name={selected.childName} src={selected.photoUrl} size={56} />
                <div>
                  <h3 className="text-xl font-bold capitalize">{selected.childName}</h3>
                  <StatusBadge status={selected.status} />
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-ink">Close</button>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                ['FIR no.', selected.firNo || '-'],
                ['Aadhar', selected.childAadhar || '-'],
                ['Gender', selected.gender],
                ['Age', selected.age ?? '-'],
                ['Height', selected.height ? `${selected.height} cm` : '-'],
                ['Weight', selected.weight ? `${selected.weight} kg` : '-'],
                ['Missing since', fmtDate(selected.dateOfMissing)],
                ['Match score', selected.matchScore ? `${Math.round(selected.matchScore * 100)}%` : '-'],
                ['Parent', selected.parentName || '-'],
                ['Contact', selected.parentPhone || '-'],
                ['Location', [selected.district, selected.state].filter(Boolean).join(', ') || '-'],
                ['Found at', selected.foundLocation || '-'],
                ['Workflow', selected.workflowStatus || '-'],
                ['Assigned to', selected.assignedToName ? `${selected.assignedToName} (${ROLE_LABELS[selected.assignedToRole] || selected.assignedToRole})` : '-'],
                ['Declaration', selected.declaration?.accepted ? `${selected.declaration.signerName || 'Signer'} / ${selected.declaration.methodLabel || 'Accepted'}` : '-'],
                ['Closure', selected.closure?.label || '-'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wide text-gray-400">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>

            {(selected.hasIdentificationProfile || selected.hasVulnerabilityProfile) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Identification &amp; vulnerability profile</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {[
                    ['Complexion', selected.identificationProfile?.complexion || '-'],
                    ['Build', selected.identificationProfile?.build || '-'],
                    ['Hair', selected.identificationProfile?.hair || '-'],
                    ['Clothing', selected.identificationProfile?.clothing || '-'],
                    ['Languages', selected.identificationProfile?.languages || '-'],
                    ['Birth mark', selected.identificationProfile?.birthMark || '-'],
                    ['Identification mark', selected.identificationProfile?.identificationMark || '-'],
                    ['Produced by', selected.vulnerabilityProfile?.producedByLabel || '-'],
                    ['Education', selected.vulnerabilityProfile?.educationLabel || '-'],
                    ['Disability support', selected.vulnerabilityProfile?.disabilityLabel || '-'],
                    ['Mental-health concern', selected.vulnerabilityProfile?.mentalHealthConcernLabel || '-'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs uppercase tracking-wide text-gray-400">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                {selected.vulnerabilityProfile?.categoryLabels?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selected.vulnerabilityProfile.categoryLabels.map((label) => (
                      <span key={label} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{label}</span>
                    ))}
                  </div>
                )}
                {selected.vulnerabilityProfile?.circumstances && (
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{selected.vulnerabilityProfile.circumstances}</p>
                )}
              </div>
            )}

            {canVerifyIntake && selected.status === 'intake_pending' && (
              <div className="mt-6 rounded-xl bg-sky-50 p-4">
                <p className="text-sm font-medium">Verify citizen / NGO intake</p>
                <p className="text-xs text-gray-600">Convert this intake into a formal missing-child case before handoff, closure, or alerts.</p>
                <div className="mt-3 space-y-3">
                  <input
                    className="field w-full"
                    value={verify.firNo}
                    onChange={(e) => setVerify((v) => ({ ...v, firNo: e.target.value }))}
                    placeholder="FIR / GD number, or leave blank to auto-generate"
                  />
                  <textarea
                    className="field min-h-20 w-full"
                    value={verify.note}
                    onChange={(e) => setVerify((v) => ({ ...v, note: e.target.value }))}
                    placeholder="Verification note"
                  />
                  <button onClick={() => verifyIntake(selected)} className="btn-primary w-full">Verify intake</button>
                </div>
              </div>
            )}

            {canAct && selected.status !== 'found' && selected.status !== 'intake_pending' && (
              <div className="mt-6 rounded-xl bg-khozo-light p-4">
                <p className="text-sm font-medium">Confirm this child has been found?</p>
                <p className="text-xs text-gray-600">This marks the case as reunited and alerts the parent by SMS.</p>
                <button onClick={() => confirmMatch(selected)} className="btn-primary mt-3 w-full">Confirm match &amp; alert parent</button>
              </div>
            )}

            {canManageBulletin && selected.status === 'missing' && selected.intakeStatus !== 'pending_verification' && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Public bulletin</p>
                <p className="text-xs text-gray-600">
                  Publish a privacy-safe public alert without contact numbers, Aadhar, exact address, or protected photos.
                </p>
                <button
                  onClick={() => toggleBulletin(selected, !selected.bulletin?.published)}
                  className={selected.bulletin?.published ? 'btn-ghost mt-3 w-full' : 'btn-primary mt-3 w-full'}
                >
                  {selected.bulletin?.published ? 'Unpublish bulletin' : 'Publish bulletin'}
                </button>
                {selected.bulletin?.published && (
                  <p className="mt-2 text-xs text-gray-400">Published by {selected.bulletin.publishedByName || 'agency'}.</p>
                )}
              </div>
            )}

            {canWorkflow && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Case notes</p>
                <p className="text-xs text-gray-600">Add handoff context for police, CWC, CCI, JJB, and command review.</p>
                <textarea
                  className="field mt-3 min-h-20 w-full"
                  value={caseNote}
                  onChange={(e) => setCaseNote(e.target.value)}
                  placeholder="Investigation update, contact attempt, care follow-up..."
                />
                <button className="btn-ghost mt-2 w-full" disabled={caseNote.trim().length < 3} onClick={() => addNote(selected)}>
                  Add note
                </button>
                {selected.notes?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.notes.slice().reverse().slice(0, 4).map((note) => (
                      <div key={note.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="whitespace-pre-wrap text-gray-700">{note.note}</p>
                        <p className="mt-1 text-gray-400">{note.actorName} / {new Date(note.ts).toLocaleString('en-IN')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canAssignCase && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Case ownership</p>
                <p className="text-xs text-gray-600">Assign a responsible desk or officer for the current investigation, welfare, railway, CCI, JJB, or bureau follow-up.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={assignment.assignmentType}
                    onChange={(e) => setAssignment((a) => ({ ...a, assignmentType: e.target.value }))}
                  >
                    {ASSIGNMENT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={assignment.assigneeId}
                    onChange={(e) => setAssignment((a) => ({ ...a, assigneeId: e.target.value }))}
                    disabled={assignableUsers.length === 0}
                  >
                    {assignableUsers.length === 0 && <option value="">No scoped assignees available</option>}
                    {assignableUsers.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name} / {ROLE_LABELS[person.role] || person.role}
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
                    placeholder="Assignment context or deadline reason"
                  />
                  <button className="btn-primary w-full" disabled={!assignment.assigneeId} onClick={() => assignOwner(selected)}>
                    Assign owner
                  </button>
                </div>
                {selected.assignments?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.assignments.slice().reverse().slice(0, 3).map((item) => (
                      <div key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{item.assignmentLabel}: {item.assigneeName}</p>
                        <p>{item.assignedByName} / {new Date(item.assignedAt).toLocaleString('en-IN')}</p>
                        {item.dueDate && <p className="mt-1 text-gray-500">Due {fmtDate(item.dueDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordInvestigationChecklist && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Investigation checklist</p>
                <p className="text-xs text-gray-600">Record police/SJPU coordination across FIR/GD, TrackChild, CCTNS, NCRB/SCRB, railway, 1098, CWC, and public bulletin decisions.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {INVESTIGATION_CHECKLIST_ITEMS.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={investigationChecklist.items.includes(item.id)}
                        onChange={() => setInvestigationChecklistItem(item.id)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 space-y-3">
                  <input
                    className="field w-full"
                    value={investigationChecklist.officerName}
                    onChange={(e) => setInvestigationChecklist((c) => ({ ...c, officerName: e.target.value }))}
                    placeholder="Officer / desk name"
                  />
                  <input
                    className="field w-full"
                    value={investigationChecklist.stationDiaryNo}
                    onChange={(e) => setInvestigationChecklist((c) => ({ ...c, stationDiaryNo: e.target.value }))}
                    placeholder="Station diary / coordination reference"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    placeholder="Coordination note"
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={investigationChecklist.items.length === 0 || investigationChecklist.officerName.trim().length < 3 || !investigationChecklist.actionDate}
                    onClick={() => recordInvestigationChecklist(selected)}
                  >
                    Record checklist
                  </button>
                </div>
                {selected.investigationChecklist?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.investigationChecklist.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.itemLabels?.join(', ')}</p>
                        <p>{record.officerName} / {record.actorName}</p>
                        {record.stationDiaryNo && <p className="mt-1 text-gray-500">Ref: {record.stationDiaryNo}</p>}
                        {record.followupDate && <p className="mt-1 text-gray-400">Follow-up: {fmtDate(record.followupDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canWorkflow && !['found', 'closed', 'intake_pending'].includes(selected.status) && workflowActions.length > 0 && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Institutional workflow</p>
                <p className="text-xs text-gray-600">Record CWC, CCI, JJB, state, or crime-records handoff without confirming reunification.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {workflowActions.map((action) => (
                    <button key={action.id} onClick={() => caseWorkflow(selected, action.id)} className="btn-ghost py-2 text-xs">
                      {action.label}
                    </button>
                  ))}
                </div>
                {selected.workflow?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.workflow.slice().reverse().slice(0, 3).map((event) => (
                      <div key={event.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{event.label}</p>
                        <p>{event.actorName} / {new Date(event.ts).toLocaleString('en-IN')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordCciCare && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">CCI care record</p>
                <p className="text-xs text-gray-600">Record admission, care plan, and next welfare review after CWC/DCPU handoff.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={cciCare.admissionType}
                    onChange={(e) => setCciCare((c) => ({ ...c, admissionType: e.target.value }))}
                  >
                    {CCI_ADMISSION_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={cciCare.cciName}
                    onChange={(e) => setCciCare((c) => ({ ...c, cciName: e.target.value }))}
                    placeholder="CCI / shelter name"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    {CCI_PROGRESS_STATES.map((progress) => <option key={progress.id} value={progress.id}>{progress.label}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    {CCI_SERVICE_TYPES.map((service) => (
                      <label key={service.id} className="flex items-center gap-2 rounded-lg border border-black/5 px-3 py-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={cciCare.services.includes(service.id)}
                          onChange={() => setCciService(service.id)}
                        />
                        {service.label}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="field w-full"
                      value={cciCare.healthStatus}
                      onChange={(e) => setCciCare((c) => ({ ...c, healthStatus: e.target.value }))}
                      placeholder="Health care progress"
                    />
                    <input
                      className="field w-full"
                      value={cciCare.educationStatus}
                      onChange={(e) => setCciCare((c) => ({ ...c, educationStatus: e.target.value }))}
                      placeholder="Education progress"
                    />
                    <input
                      className="field w-full"
                      value={cciCare.counsellingStatus}
                      onChange={(e) => setCciCare((c) => ({ ...c, counsellingStatus: e.target.value }))}
                      placeholder="Counselling progress"
                    />
                    <input
                      className="field w-full"
                      value={cciCare.familyTracingStatus}
                      onChange={(e) => setCciCare((c) => ({ ...c, familyTracingStatus: e.target.value }))}
                      placeholder="Family tracing progress"
                    />
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={cciCare.carePlan}
                    onChange={(e) => setCciCare((c) => ({ ...c, carePlan: e.target.value }))}
                    placeholder="Care plan, medical/counselling needs, guardian contact plan..."
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={cciCare.cciName.trim().length < 3 || cciCare.carePlan.trim().length < 10 || !cciCare.admissionDate}
                    onClick={() => recordCciCare(selected)}
                  >
                    Record CCI care
                  </button>
                </div>
                {selected.cciCareRecords?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.cciCareRecords.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.cciName}</p>
                        <p>{record.actorName} / {new Date(record.recordedAt).toLocaleString('en-IN')}</p>
                        {record.progressLabel && <p className="mt-1 text-gray-500">Progress: {record.progressLabel}</p>}
                        {record.serviceLabels?.length > 0 && <p className="mt-1 text-gray-400">{record.serviceLabels.join(' / ')}</p>}
                        {record.serviceProgress && (
                          <p className="mt-1 text-gray-500">
                            {[record.serviceProgress.healthStatus, record.serviceProgress.educationStatus, record.serviceProgress.counsellingStatus, record.serviceProgress.familyTracingStatus].filter(Boolean).join(' / ')}
                          </p>
                        )}
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.carePlan}</p>
                        {record.nextReviewDate && <p className="mt-1 text-gray-400">Next review: {fmtDate(record.nextReviewDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordJjbProceeding && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">JJB proceeding</p>
                <p className="text-xs text-gray-600">Record board orders, social investigation directions, and next hearing dates.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={jjbProceeding.proceedingType}
                    onChange={(e) => setJjbProceeding((j) => ({ ...j, proceedingType: e.target.value }))}
                  >
                    {JJB_PROCEEDING_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={jjbProceeding.boardName}
                    onChange={(e) => setJjbProceeding((j) => ({ ...j, boardName: e.target.value }))}
                    placeholder="JJB / board name"
                  />
                  <input
                    className="field w-full"
                    value={jjbProceeding.caseNo}
                    onChange={(e) => setJjbProceeding((j) => ({ ...j, caseNo: e.target.value }))}
                    placeholder="JJB case number, if available"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    placeholder="Board directions, social investigation order, rehabilitation actions..."
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={jjbProceeding.boardName.trim().length < 3 || jjbProceeding.directions.trim().length < 10 || !jjbProceeding.orderDate}
                    onClick={() => recordJjbProceeding(selected)}
                  >
                    Record JJB proceeding
                  </button>
                </div>
                {selected.jjbProceedings?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.jjbProceedings.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.boardName}</p>
                        <p>{record.actorName} / {new Date(record.recordedAt).toLocaleString('en-IN')}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.directions}</p>
                        {record.nextHearingDate && <p className="mt-1 text-gray-400">Next hearing: {fmtDate(record.nextHearingDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordStateEscalation && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">State escalation</p>
                <p className="text-xs text-gray-600">Record state nodal coordination, urgent rescue support, or interstate action requests.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={stateEscalation.escalationType}
                    onChange={(e) => setStateEscalation((s) => ({ ...s, escalationType: e.target.value }))}
                  >
                    {STATE_ESCALATION_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="field w-full"
                      value={stateEscalation.escalationLevel}
                      onChange={(e) => setStateEscalation((s) => ({ ...s, escalationLevel: e.target.value }))}
                    >
                      {STATE_ESCALATION_LEVELS.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
                    </select>
                    <select
                      className="field w-full"
                      value={stateEscalation.priority}
                      onChange={(e) => setStateEscalation((s) => ({ ...s, priority: e.target.value }))}
                    >
                      {BUREAU_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
                    </select>
                  </div>
                  <input
                    className="field w-full"
                    value={stateEscalation.authorityName}
                    onChange={(e) => setStateEscalation((s) => ({ ...s, authorityName: e.target.value }))}
                    placeholder="Authority / nodal desk"
                  />
                  <input
                    className="field w-full"
                    value={stateEscalation.referenceNo}
                    onChange={(e) => setStateEscalation((s) => ({ ...s, referenceNo: e.target.value }))}
                    placeholder="Reference number, if issued"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    placeholder="Action required, coordination support, rescue resources, interstate request..."
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={stateEscalation.authorityName.trim().length < 3 || stateEscalation.actionRequired.trim().length < 10 || !stateEscalation.escalatedDate}
                    onClick={() => recordStateEscalation(selected)}
                  >
                    Record state escalation
                  </button>
                </div>
                {selected.stateEscalations?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.stateEscalations.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.levelLabel} / {record.label}</p>
                        <p>{record.actorName} / {new Date(record.recordedAt).toLocaleString('en-IN')}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.actionRequired}</p>
                        {record.referenceNo && <p className="mt-1 text-gray-400">Ref: {record.referenceNo}</p>}
                        {record.dueDate && <p className="mt-1 text-gray-400">Due: {fmtDate(record.dueDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordBureauReport && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">NCRB / SCRB report</p>
                <p className="text-xs text-gray-600">Record state or national crime-records reporting for interstate alerts, pattern review, or trace updates.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={bureauReport.reportType}
                    onChange={(e) => setBureauReport((b) => ({ ...b, reportType: e.target.value }))}
                  >
                    {BUREAU_REPORT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="field w-full"
                      value={bureauReport.bureauLevel}
                      onChange={(e) => setBureauReport((b) => ({ ...b, bureauLevel: e.target.value }))}
                    >
                      {BUREAU_LEVELS.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
                    </select>
                    <select
                      className="field w-full"
                      value={bureauReport.priority}
                      onChange={(e) => setBureauReport((b) => ({ ...b, priority: e.target.value }))}
                    >
                      {BUREAU_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
                    </select>
                  </div>
                  <input
                    className="field w-full"
                    value={bureauReport.referenceNo}
                    onChange={(e) => setBureauReport((b) => ({ ...b, referenceNo: e.target.value }))}
                    placeholder="Reference number, if issued"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    placeholder="Report summary, alert rationale, interstate coordination notes..."
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={bureauReport.summary.trim().length < 10 || !bureauReport.submittedDate}
                    onClick={() => recordBureauReport(selected)}
                  >
                    Record bureau report
                  </button>
                </div>
                {selected.bureauReports?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.bureauReports.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.bureauLabel} / {record.label}</p>
                        <p>{record.actorName} / {new Date(record.recordedAt).toLocaleString('en-IN')}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.summary}</p>
                        {record.referenceNo && <p className="mt-1 text-gray-400">Ref: {record.referenceNo}</p>}
                        {record.nextReviewDate && <p className="mt-1 text-gray-400">Next review: {fmtDate(record.nextReviewDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canLinkExternalId && selected.status !== 'intake_pending' && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">External system IDs</p>
                <p className="text-xs text-gray-600">Link TrackChild, NCRB, CCTNS, GHAR, or state portal identifiers for cross-system traceability.</p>
                <button className="btn-ghost mt-3 w-full" onClick={() => exportHandoff(selected)}>
                  Export TrackChild handoff JSON
                </button>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={externalId.idType}
                    onChange={(e) => setExternalId((x) => ({ ...x, idType: e.target.value }))}
                  >
                    {EXTERNAL_ID_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={externalId.externalId}
                    onChange={(e) => setExternalId((x) => ({ ...x, externalId: e.target.value }))}
                    placeholder="External ID / reference number"
                  />
                  <input
                    className="field w-full"
                    value={externalId.issuingSystem}
                    onChange={(e) => setExternalId((x) => ({ ...x, issuingSystem: e.target.value }))}
                    placeholder="Issuing system / desk"
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
                    placeholder="Linking remarks"
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={externalId.externalId.trim().length < 3}
                    onClick={() => linkExternalId(selected)}
                  >
                    Link external ID
                  </button>
                </div>
                {selected.externalIds?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.externalIds.slice().reverse().slice(0, 4).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.externalId}</p>
                        <p>{record.issuingSystem} / {record.actorName}</p>
                        {record.issuedDate && <p className="mt-1 text-gray-400">Issued: {fmtDate(record.issuedDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordRestorationPlan && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Restoration / repatriation</p>
                <p className="text-xs text-gray-600">Record restoration route, handover authority, supports, and follow-up dates after rescue or CCI/JJB review.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={restorationPlan.restorationType}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, restorationType: e.target.value }))}
                  >
                    {RESTORATION_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={restorationPlan.status}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, status: e.target.value }))}
                  >
                    {RESTORATION_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{statusOption.label}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="field w-full"
                      value={restorationPlan.fromState}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, fromState: e.target.value }))}
                      placeholder={selected.state || 'From state'}
                    />
                    <input
                      className="field w-full"
                      value={restorationPlan.fromDistrict}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, fromDistrict: e.target.value }))}
                      placeholder={selected.district || 'From district'}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="field w-full"
                      value={restorationPlan.toState}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, toState: e.target.value }))}
                      placeholder="To state"
                    />
                    <input
                      className="field w-full"
                      value={restorationPlan.toDistrict}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, toDistrict: e.target.value }))}
                      placeholder="To district"
                    />
                  </div>
                  <input
                    className="field w-full"
                    value={restorationPlan.guardianName}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, guardianName: e.target.value }))}
                    placeholder={selected.parentName || 'Guardian / receiving person'}
                  />
                  <input
                    className="field w-full"
                    value={restorationPlan.handoverAuthority}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, handoverAuthority: e.target.value }))}
                    placeholder="CWC / DCPU / police / embassy authority"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="field w-full"
                      value={restorationPlan.travelMode}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, travelMode: e.target.value }))}
                    >
                      {RESTORATION_TRAVEL_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                    </select>
                    <input
                      className="field w-full"
                      type="date"
                      value={restorationPlan.travelDate}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, travelDate: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="field w-full"
                      value={restorationPlan.escortAuthority}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, escortAuthority: e.target.value }))}
                      placeholder="Escort authority"
                    />
                    <input
                      className="field w-full"
                      value={restorationPlan.escortContact}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, escortContact: e.target.value }))}
                      placeholder="Escort contact"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="field w-full"
                      value={restorationPlan.documentStatus}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, documentStatus: e.target.value }))}
                    >
                      {RESTORATION_DOCUMENT_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{statusOption.label}</option>)}
                    </select>
                    <input
                      className="field w-full"
                      value={restorationPlan.documentReference}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, documentReference: e.target.value }))}
                      placeholder="Document reference"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="field w-full"
                      value={restorationPlan.fundingSource}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, fundingSource: e.target.value }))}
                    >
                      {RESTORATION_FUNDING_SOURCES.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                    </select>
                    <input
                      className="field w-full"
                      value={restorationPlan.fundingReference}
                      onChange={(e) => setRestorationPlan((r) => ({ ...r, fundingReference: e.target.value }))}
                      placeholder="Funding reference"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {RESTORATION_SUPPORTS.map((support) => (
                      <label key={support.id} className="flex items-center gap-2 rounded-lg border border-black/5 px-3 py-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={restorationPlan.supports.includes(support.id)}
                          onChange={() => setRestorationSupport(support.id)}
                        />
                        {support.label}
                      </label>
                    ))}
                  </div>
                  <textarea
                    className="field min-h-24 w-full"
                    value={restorationPlan.remarks}
                    onChange={(e) => setRestorationPlan((r) => ({ ...r, remarks: e.target.value }))}
                    placeholder="Restoration route, document checks, handover terms, aftercare follow-up..."
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={restorationPlan.toState.trim().length < 2 || restorationPlan.toDistrict.trim().length < 2 || restorationPlan.handoverAuthority.trim().length < 3 || restorationPlan.remarks.trim().length < 10}
                    onClick={() => recordRestorationPlan(selected)}
                  >
                    Record restoration plan
                  </button>
                </div>
                {selected.restorationPlans?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.restorationPlans.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.statusLabel}</p>
                        <p>{record.actorName} / {new Date(record.recordedAt).toLocaleString('en-IN')}</p>
                        <p className="mt-1 text-gray-700">{[record.to?.district, record.to?.state].filter(Boolean).join(', ')}</p>
                        {record.travel && (
                          <p className="mt-1 text-gray-500">
                            {record.travel.modeLabel}{record.travel.travelDate ? ` / travel ${fmtDate(record.travel.travelDate)}` : ''}{record.travel.escortAuthority ? ` / escort ${record.travel.escortAuthority}` : ''}
                          </p>
                        )}
                        {record.documents && <p className="mt-1 text-gray-500">Documents: {record.documents.statusLabel}</p>}
                        {record.funding && <p className="mt-1 text-gray-500">Funding: {record.funding.sourceLabel}</p>}
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.remarks}</p>
                        {record.supportLabels?.length > 0 && <p className="mt-1 text-gray-400">{record.supportLabels.join(' / ')}</p>}
                        {record.followupDate && <p className="mt-1 text-gray-400">Follow-up: {fmtDate(record.followupDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordWelfareReferral && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Welfare referral</p>
                <p className="text-xs text-gray-600">Record sponsorship, foster care, adoption, aftercare, counselling, medical, education, or family-strengthening referrals.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={welfareReferral.scheme}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, scheme: e.target.value }))}
                  >
                    {WELFARE_SCHEMES.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.label}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={welfareReferral.status}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, status: e.target.value }))}
                  >
                    {WELFARE_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{statusOption.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={welfareReferral.agencyName}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, agencyName: e.target.value }))}
                    placeholder="DCPU / CWC / agency / NGO desk"
                  />
                  <input
                    className="field w-full"
                    value={welfareReferral.referralNo}
                    onChange={(e) => setWelfareReferral((w) => ({ ...w, referralNo: e.target.value }))}
                    placeholder="Referral / scheme number"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    placeholder="Eligibility basis, family situation, immediate support needs..."
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={welfareReferral.agencyName.trim().length < 3 || welfareReferral.eligibilityNote.trim().length < 10 || !welfareReferral.referredDate}
                    onClick={() => recordWelfareReferral(selected)}
                  >
                    Record welfare referral
                  </button>
                </div>
                {selected.welfareReferrals?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.welfareReferrals.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.statusLabel}</p>
                        <p>{record.agencyName} / {record.actorName}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.eligibilityNote}</p>
                        {record.referralNo && <p className="mt-1 text-gray-400">Ref: {record.referralNo}</p>}
                        {record.reviewDate && <p className="mt-1 text-gray-400">Review: {fmtDate(record.reviewDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordLegalAidReferral && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Legal-aid referral</p>
                <p className="text-xs text-gray-600">Record DLSA legal aid, victim compensation, court support, and document or affidavit follow-up.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={legalAidReferral.serviceType}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, serviceType: e.target.value }))}
                  >
                    {LEGAL_AID_SERVICE_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={legalAidReferral.status}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, status: e.target.value }))}
                  >
                    {LEGAL_AID_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{statusOption.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={legalAidReferral.authorityName}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, authorityName: e.target.value }))}
                    placeholder="DLSA / legal services authority"
                  />
                  <input
                    className="field w-full"
                    value={legalAidReferral.applicationNo}
                    onChange={(e) => setLegalAidReferral((l) => ({ ...l, applicationNo: e.target.value }))}
                    placeholder="Application / case reference"
                  />
                  <div className="grid grid-cols-3 gap-2">
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
                    placeholder="Legal support need, application status, next action..."
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={legalAidReferral.authorityName.trim().length < 3 || legalAidReferral.note.trim().length < 10 || !legalAidReferral.referredDate}
                    onClick={() => recordLegalAidReferral(selected)}
                  >
                    Record legal-aid referral
                  </button>
                </div>
                {selected.legalAidReferrals?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.legalAidReferrals.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.statusLabel}</p>
                        <p>{record.authorityName} / {record.actorName}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.note}</p>
                        {record.applicationNo && <p className="mt-1 text-gray-400">Ref: {record.applicationNo}</p>}
                        {record.hearingDate && <p className="mt-1 text-gray-400">Hearing: {fmtDate(record.hearingDate)}</p>}
                        {record.reviewDate && <p className="mt-1 text-gray-400">Review: {fmtDate(record.reviewDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordAdoption && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Adoption / CARINGS record</p>
                <p className="text-xs text-gray-600">Record CWC orders, legally-free declarations, SAA intake, SARA review, CARINGS updates, or pre-adoption foster care follow-up.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={adoptionRecord.recordType}
                    onChange={(e) => setAdoptionRecord((a) => ({ ...a, recordType: e.target.value }))}
                  >
                    {ADOPTION_RECORD_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={adoptionRecord.status}
                    onChange={(e) => setAdoptionRecord((a) => ({ ...a, status: e.target.value }))}
                  >
                    {ADOPTION_STATUSES.map((statusOption) => <option key={statusOption.id} value={statusOption.id}>{statusOption.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={adoptionRecord.agencyName}
                    onChange={(e) => setAdoptionRecord((a) => ({ ...a, agencyName: e.target.value }))}
                    placeholder="SAA / SARA / CWC authority"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="field w-full"
                      value={adoptionRecord.caringsId}
                      onChange={(e) => setAdoptionRecord((a) => ({ ...a, caringsId: e.target.value }))}
                      placeholder="CARINGS reference"
                    />
                    <input
                      className="field w-full"
                      value={adoptionRecord.orderNo}
                      onChange={(e) => setAdoptionRecord((a) => ({ ...a, orderNo: e.target.value }))}
                      placeholder="Order / declaration number"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
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
                    placeholder="Adoption follow-up status, document gap, next action..."
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={adoptionRecord.agencyName.trim().length < 3 || adoptionRecord.note.trim().length < 10 || !adoptionRecord.orderDate}
                    onClick={() => recordAdoption(selected)}
                  >
                    Record adoption follow-up
                  </button>
                </div>
                {selected.adoptionRecords?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.adoptionRecords.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.statusLabel}</p>
                        <p>{record.agencyName} / {record.actorName}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.note}</p>
                        {record.caringsId && <p className="mt-1 text-gray-400">CARINGS: {record.caringsId}</p>}
                        {record.orderNo && <p className="mt-1 text-gray-400">Order: {record.orderNo}</p>}
                        {record.nextReviewDate && <p className="mt-1 text-gray-400">Review: {fmtDate(record.nextReviewDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordCaseAssessment && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">SIR / care assessment</p>
                <p className="text-xs text-gray-600">Record social investigation, individual care plan, risk, family, or rehabilitation assessment details.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={caseAssessment.assessmentType}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, assessmentType: e.target.value }))}
                  >
                    {CASE_ASSESSMENT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={caseAssessment.riskLevel}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, riskLevel: e.target.value }))}
                  >
                    {CASE_RISK_LEVELS.map((risk) => <option key={risk.id} value={risk.id}>{risk.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={caseAssessment.assessorName}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, assessorName: e.target.value }))}
                    placeholder="Assessor / probation officer / CWC member"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    placeholder="Findings"
                  />
                  <textarea
                    className="field min-h-20 w-full"
                    value={caseAssessment.carePlan}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, carePlan: e.target.value }))}
                    placeholder="Individual care plan / rehabilitation actions"
                  />
                  <textarea
                    className="field min-h-16 w-full"
                    value={caseAssessment.recommendation}
                    onChange={(e) => setCaseAssessment((a) => ({ ...a, recommendation: e.target.value }))}
                    placeholder="Recommendation"
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={caseAssessment.assessorName.trim().length < 3 || caseAssessment.findings.trim().length < 10 || caseAssessment.carePlan.trim().length < 10 || !caseAssessment.assessmentDate}
                    onClick={() => recordCaseAssessment(selected)}
                  >
                    Record assessment
                  </button>
                </div>
                {selected.caseAssessments?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.caseAssessments.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.riskLabel}</p>
                        <p>{record.assessorName} / {record.actorName}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.findings}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.carePlan}</p>
                        {record.nextReviewDate && <p className="mt-1 text-gray-400">Review: {fmtDate(record.nextReviewDate)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canRecordProduction && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">CWC / JJB production</p>
                <p className="text-xs text-gray-600">Record rescue-to-production timing, authority, outcome, and 24-hour deadline status.</p>
                <div className="mt-3 space-y-3">
                  <select
                    className="field w-full"
                    value={productionRecord.productionType}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, productionType: e.target.value }))}
                  >
                    {PRODUCTION_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </select>
                  <select
                    className="field w-full"
                    value={productionRecord.outcome}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, outcome: e.target.value }))}
                  >
                    {PRODUCTION_OUTCOMES.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={productionRecord.authorityName}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, authorityName: e.target.value }))}
                    placeholder="CWC / JJB / medical authority"
                  />
                  <input
                    className="field w-full"
                    value={productionRecord.orderNo}
                    onChange={(e) => setProductionRecord((p) => ({ ...p, orderNo: e.target.value }))}
                    placeholder="Order / production number"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    placeholder="Next action after production"
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={productionRecord.authorityName.trim().length < 3 || productionRecord.nextAction.trim().length < 10 || !productionRecord.rescueAt || !productionRecord.producedAt}
                    onClick={() => recordProduction(selected)}
                  >
                    Record production
                  </button>
                </div>
                {selected.productionRecords?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selected.productionRecords.slice().reverse().slice(0, 3).map((record) => (
                      <div key={record.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">{record.label} / {record.outcomeLabel}</p>
                        <p>{record.authorityName} / {record.actorName}</p>
                        <p className="mt-1 text-gray-700">{record.hoursToProduce}h / {record.deadlineStatus === 'within_24h' ? 'within 24h' : 'delayed'}</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.nextAction}</p>
                        {record.orderNo && <p className="mt-1 text-gray-400">Order: {record.orderNo}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canTransferCase && !['found', 'closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Transfer jurisdiction</p>
                <p className="text-xs text-gray-600">Move this case to another district when investigation or child-protection follow-up shifts.</p>
                <div className="mt-3 grid gap-2">
                  <input className="field w-full" value={transfer.state} onChange={(e) => setTransfer((t) => ({ ...t, state: e.target.value }))} placeholder="Target state" />
                  <input className="field w-full" value={transfer.district} onChange={(e) => setTransfer((t) => ({ ...t, district: e.target.value }))} placeholder="Target district" />
                  <input className="field w-full" value={transfer.station} onChange={(e) => setTransfer((t) => ({ ...t, station: e.target.value }))} placeholder="Target station / desk" />
                  <textarea className="field min-h-16 w-full" value={transfer.reason} onChange={(e) => setTransfer((t) => ({ ...t, reason: e.target.value }))} placeholder="Transfer reason" />
                  <button className="btn-ghost w-full" disabled={!transfer.state.trim() || !transfer.district.trim()} onClick={() => transferJurisdiction(selected)}>
                    Transfer case
                  </button>
                </div>
                {selected.transfers?.length > 0 && (
                  <p className="mt-2 text-xs text-gray-400">{selected.transfers.length} jurisdiction transfer{selected.transfers.length === 1 ? '' : 's'} recorded.</p>
                )}
              </div>
            )}

            {canCloseCase && !['closed', 'intake_pending'].includes(selected.status) && (
              <div className="mt-6 rounded-xl border border-black/5 p-4">
                <p className="text-sm font-medium">Close case outcome</p>
                <p className="text-xs text-gray-600">Record the final TrackChild-style outcome after CWC/police review.</p>
                <div className="mt-3 space-y-3">
                  <select className="field w-full" value={closure.reason} onChange={(e) => setClosure((c) => ({ ...c, reason: e.target.value }))}>
                    {CASE_CLOSE_REASONS.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
                  </select>
                  <input
                    className="field w-full"
                    value={closure.foundLocation}
                    onChange={(e) => setClosure((c) => ({ ...c, foundLocation: e.target.value }))}
                    placeholder={selected.foundLocation || 'Restoration / transfer location'}
                  />
                  <textarea
                    className="field min-h-20 w-full"
                    value={closure.note}
                    onChange={(e) => setClosure((c) => ({ ...c, note: e.target.value }))}
                    placeholder="Closure note"
                  />
                  <button onClick={() => closeCase(selected)} className="btn-primary w-full">Close case</button>
                </div>
              </div>
            )}

            {canAct && selected.status === 'found' && !selected.smsSent && (
              <button onClick={() => { sendSms(selected); setSelected(null); }} className="btn-primary mt-6 w-full">Send SMS alert to parent</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
