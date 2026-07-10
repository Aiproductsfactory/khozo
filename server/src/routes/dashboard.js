import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import {
  listReports, listFoundReports, listActivity, listUsers,
  listAudit, verifyAuditChain, updateFoundReport, updateReport, addActivity, addAudit, addUser, findUserByEmail,
  BASE_TOTAL_MISSING, BASE_TOTAL_FOUND,
} from '../store.js';
import { authRequired, passwordChangeRequired, publicUser, requireRole } from '../auth.js';
import { scopeActivity, scopeAudit, scopeFoundReports, scopeReports, scopeLabel } from '../scope.js';
import { matchEngineInfo } from '../match.js';

const router = Router();
const PUBLIC_DIRECTORY_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara'];
const NETWORK_ALERT_ROLES = ['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'];
const NETWORK_ALERT_AUDIENCES = {
  all_operational: 'All operational stakeholders',
  police_rpf: 'Police / SJPU / AHTU / RPF',
  records: 'DCRB / Crime records bureau',
  welfare: 'CWC / DCPU / CCI / JJB / DLSA',
  legal: 'DLSA / legal services',
  adoption: 'SARA / SAA adoption desks',
  ngo: 'NGO partners',
};
const NETWORK_ROLE_LABELS = {
  admin: 'State admin',
  state_nodal: 'State nodal officer',
  sara: 'SARA adoption desk',
  crime_bureau: 'Crime records bureau',
  dcrb: 'DCRB',
  dlsa: 'DLSA legal aid',
  police: 'Police station',
  sjpu: 'SJPU',
  ahtu: 'AHTU',
  cwc: 'CWC',
  dcpu: 'DCPU',
  rpf: 'RPF post',
  cci: 'CCI',
  saa: 'SAA',
  jjb: 'JJB',
};
const STATE_COVERAGE_ROLES = ['admin', 'state_nodal', 'sara', 'crime_bureau'];
const DISTRICT_COVERAGE_ROLES = ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb'];
const PUBLIC_EMERGENCY_CONTACTS = [
  { label: 'Childline', phone: '1098' },
  { label: 'Police emergency', phone: '112' },
  { label: 'Railway helpline', phone: '139' },
];
const PUBLIC_INCIDENT_ROUTES = {
  missing_child: {
    label: 'Missing child',
    primary: '1098',
    secondary: ['112'],
    localRoles: ['sjpu', 'police', 'ahtu', 'dcrb', 'cwc', 'dcpu', 'dlsa', 'saa'],
    instructions: 'Call 1098 first for child-protection intake; call 112 immediately if there is active danger.',
  },
  immediate_danger: {
    label: 'Immediate danger',
    primary: '112',
    secondary: ['1098'],
    localRoles: ['police', 'sjpu', 'ahtu', 'dcrb', 'cwc', 'dlsa'],
    instructions: 'Call 112 first for emergency response, then 1098 for child-protection support.',
  },
  welfare: {
    label: 'Shelter or welfare support',
    primary: '1098',
    secondary: ['112'],
    localRoles: ['cwc', 'dcpu', 'cci', 'saa', 'jjb', 'dlsa'],
    instructions: 'Call 1098 for child welfare support and use local CWC/DCPU/DLSA/SAA desks for follow-up.',
  },
  railway: {
    label: 'Railway or station sighting',
    primary: '139',
    secondary: ['1098', '112'],
    localRoles: ['rpf', 'police', 'sjpu', 'ahtu', 'dcrb', 'cwc'],
    instructions: 'Call 139 for railway response; use 1098/112 based on protection or emergency need.',
  },
};

function redactedPublicContact(u) {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    org: u.org || null,
    phone: u.phone || null,
    jurisdiction: u.jurisdiction,
  };
}

function emergencyByPhone(phone) {
  return PUBLIC_EMERGENCY_CONTACTS.find((item) => item.phone === phone) || null;
}

function publicEmergencyPlan(incidentType, contacts) {
  const key = PUBLIC_INCIDENT_ROUTES[incidentType] ? incidentType : 'missing_child';
  const route = PUBLIC_INCIDENT_ROUTES[key];
  const roles = new Set(route.localRoles);
  const localContacts = contacts
    .filter((contact) => roles.has(contact.role))
    .sort((a, b) => route.localRoles.indexOf(a.role) - route.localRoles.indexOf(b.role)
      || String(a.org || a.name).localeCompare(String(b.org || b.name)));
  return {
    incidentType: key,
    label: route.label,
    instructions: route.instructions,
    primary: emergencyByPhone(route.primary),
    secondary: route.secondary.map(emergencyByPhone).filter(Boolean),
    localRoles: route.localRoles,
    localContacts,
  };
}

router.get('/public/directory', (req, res) => {
  const state = String(req.query.state || '').trim().toLowerCase();
  const district = String(req.query.district || '').trim().toLowerCase();
  const role = String(req.query.role || '').trim();
  const incidentType = String(req.query.incidentType || '').trim();
  const scopedUsers = listUsers()
    .filter((u) => PUBLIC_DIRECTORY_ROLES.includes(u.role))
    .filter((u) => !state || String(u.jurisdiction?.state || '').toLowerCase() === state)
    .filter((u) => !district || String(u.jurisdiction?.district || '').toLowerCase() === district);
  const publicContacts = scopedUsers.map(redactedPublicContact);
  const users = publicContacts
    .filter((u) => !role || u.role === role)
    .sort((a, b) =>
      [a.jurisdiction?.state || '', a.jurisdiction?.district || '', a.role, a.name].join('|')
        .localeCompare([b.jurisdiction?.state || '', b.jurisdiction?.district || '', b.role, b.name].join('|'))
    );
  res.json({
    directory: users,
    emergency: PUBLIC_EMERGENCY_CONTACTS,
    emergencyPlan: publicEmergencyPlan(incidentType, publicContacts),
  });
});

router.use(authRequired, passwordChangeRequired);

const OPERATIONAL_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau'];
const PRIVACY_VIEW_ROLES = OPERATIONAL_ROLES;
const PRIVACY_REVIEW_ROLES = ['super_admin', 'admin', 'police', 'sjpu', 'ahtu', 'cwc', 'dcpu', 'state_nodal'];
const PRIVACY_EXPORT_ROLES = ['super_admin', 'admin', 'state_nodal', 'crime_bureau'];
const PRIVACY_ANONYMIZE_ROLES = ['super_admin', 'admin', 'state_nodal'];
const CCI_REGISTER_ROLES = ['super_admin', 'admin', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'];
const ABUSE_REVIEW_ROLES = ['super_admin', 'admin', 'state_nodal', 'crime_bureau'];
const ABUSE_ACTIONS = new Set([
  'security.public_rate_limited',
  'auth.otp_failed',
  'auth.privileged_registration_blocked',
]);
const ABUSE_DISPOSITION_ACTIONS = new Set([
  'security.abuse_signal_reviewed',
  'security.abuse_signal_escalated',
  'security.abuse_signal_dismissed',
]);
const ABUSE_DISPOSITIONS = {
  reviewed: 'security.abuse_signal_reviewed',
  escalated: 'security.abuse_signal_escalated',
  dismissed: 'security.abuse_signal_dismissed',
};
const PROVISIONABLE_ROLES = ['admin', 'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau', 'ngo'];
const LEVEL_BY_ROLE = {
  admin: 'state',
  state_nodal: 'state',
  sara: 'state',
  crime_bureau: 'state',
  police: 'station',
  sjpu: 'district',
  ahtu: 'district',
  dcrb: 'district',
  dlsa: 'district',
  cwc: 'district',
  dcpu: 'district',
  rpf: 'station',
  cci: 'district',
  saa: 'district',
  jjb: 'district',
  ngo: 'citizen',
};

function canProvisionRole(actor, role) {
  if (actor.role === 'super_admin') return PROVISIONABLE_ROLES.includes(role);
  if (['admin', 'state_nodal', 'sara'].includes(actor.role)) {
    return ['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb', 'sara', 'crime_bureau', 'ngo'].includes(role);
  }
  if (actor.role === 'crime_bureau') return ['police', 'sjpu', 'ahtu', 'dcrb', 'rpf'].includes(role);
  return false;
}

function scopedJurisdiction(actor, role, requested = {}) {
  const level = LEVEL_BY_ROLE[role];
  if (!level) return null;
  const actorState = actor.jurisdiction?.state || null;
  const actorDistrict = actor.jurisdiction?.district || null;
  const state = requested.state || actorState;
  const district = requested.district || (level === 'state' ? null : actorDistrict);
  const station = ['station'].includes(level) ? requested.station || null : null;

  if (actor.role !== 'super_admin') {
    if (actorState && state !== actorState) return null;
    if (actor.role === 'crime_bureau' && actorState && state !== actorState) return null;
  }
  if (['police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'dcpu', 'rpf', 'cci', 'saa', 'jjb'].includes(actor.role)) return null;
  return { level, state: state || null, district: district || null, station };
}

function scopeNetworkUsers(actor, users) {
  if (actor.role === 'super_admin') return users;
  const actorState = actor.jurisdiction?.state || null;
  if (['admin', 'state_nodal', 'sara', 'crime_bureau'].includes(actor.role)) {
    return users.filter((u) => {
      if (u.role === 'super_admin') return true;
      if (!actorState) return true;
      return u.jurisdiction?.state === actorState;
    });
  }
  return [];
}

function jurisdictionKey(state, district = '') {
  return [state || 'Unassigned', district || ''].join('|');
}

function jurisdictionLabel(state, district = '') {
  return [district, state].filter(Boolean).join(', ') || state || 'Unassigned';
}

function networkCoverage(actor) {
  const users = scopeNetworkUsers(actor, listUsers()).filter((u) => u.role !== 'super_admin');
  const reports = scopeReports(actor, listReports());
  const stateNames = new Set();
  const districtMap = new Map();

  const addState = (state) => {
    const value = String(state || actor.jurisdiction?.state || '').trim();
    if (value) stateNames.add(value);
  };
  const addDistrict = (state, district) => {
    const cleanState = String(state || actor.jurisdiction?.state || '').trim();
    const cleanDistrict = String(district || '').trim();
    if (!cleanState || !cleanDistrict) return;
    districtMap.set(jurisdictionKey(cleanState, cleanDistrict), { state: cleanState, district: cleanDistrict });
  };

  for (const u of users) {
    addState(u.jurisdiction?.state);
    addDistrict(u.jurisdiction?.state, u.jurisdiction?.district);
  }
  for (const r of reports) {
    addState(r.state);
    addDistrict(r.state, r.district);
  }
  if (actor.jurisdiction?.state) addState(actor.jurisdiction.state);

  const countFor = (role, state, district = null) => users
    .filter((u) => u.role === role)
    .filter((u) => !state || u.jurisdiction?.state === state)
    .filter((u) => district == null || u.jurisdiction?.district === district)
    .length;

  const stateRows = [...stateNames].sort().map((state) => {
    const roles = STATE_COVERAGE_ROLES.map((role) => {
      const count = countFor(role, state);
      return { role, label: NETWORK_ROLE_LABELS[role], count, required: 1, status: count >= 1 ? 'covered' : 'missing' };
    });
    return {
      type: 'state',
      state,
      district: null,
      label: jurisdictionLabel(state),
      roles,
      missingRoles: roles.filter((row) => row.status === 'missing').map((row) => row.role),
    };
  });

  const districtRows = [...districtMap.values()]
    .sort((a, b) => jurisdictionLabel(a.state, a.district).localeCompare(jurisdictionLabel(b.state, b.district)))
    .map(({ state, district }) => {
      const roles = DISTRICT_COVERAGE_ROLES.map((role) => {
        const count = countFor(role, state, district);
        return { role, label: NETWORK_ROLE_LABELS[role], count, required: 1, status: count >= 1 ? 'covered' : 'missing' };
      });
      return {
        type: 'district',
        state,
        district,
        label: jurisdictionLabel(state, district),
        roles,
        missingRoles: roles.filter((row) => row.status === 'missing').map((row) => row.role),
      };
    });

  const rows = [...stateRows, ...districtRows];
  const requiredSlots = rows.reduce((sum, row) => sum + row.roles.length, 0);
  const coveredSlots = rows.reduce((sum, row) => sum + row.roles.filter((role) => role.status === 'covered').length, 0);
  const gaps = rows
    .filter((row) => row.missingRoles.length)
    .flatMap((row) => row.missingRoles.map((role) => ({
      state: row.state,
      district: row.district,
      level: row.type,
      role,
      label: NETWORK_ROLE_LABELS[role],
      jurisdiction: row.label,
    })))
    .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.label.localeCompare(b.label));

  return {
    scope: scopeLabel(actor),
    totals: {
      jurisdictions: rows.length,
      stateJurisdictions: stateRows.length,
      districtJurisdictions: districtRows.length,
      requiredSlots,
      coveredSlots,
      missingSlots: requiredSlots - coveredSlots,
      coveragePct: requiredSlots ? Math.round((coveredSlots / requiredSlots) * 100) : 100,
    },
    rows,
    gaps,
  };
}

function temporaryPassword() {
  return `Khozo-${nanoid(6)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function monthKey(ts) {
  const d = new Date(ts);
  return d.toLocaleString('en-IN', { month: 'short' });
}

function ageDays(ts) {
  const numeric = Number(ts);
  const time = Number.isFinite(numeric) ? numeric : new Date(ts || 0).getTime();
  return Math.max(0, Math.floor((Date.now() - Number(time || 0)) / 86400000));
}

function latestCaseTouch(report) {
  const candidates = [
    report.createdAt,
    report.lastWorkflowAt ? new Date(report.lastWorkflowAt).getTime() : null,
    report.lastNoteAt ? new Date(report.lastNoteAt).getTime() : null,
    report.closure?.closedAt ? new Date(report.closure.closedAt).getTime() : null,
  ].filter((v) => Number.isFinite(Number(v)));
  return candidates.length ? Math.max(...candidates.map(Number)) : report.createdAt;
}

function dateValue(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function daysUntil(value) {
  const time = dateValue(value);
  if (!time) return null;
  return Math.ceil((time - Date.now()) / 86400000);
}

function dueAlertPriority(days) {
  if (days === null) return null;
  if (days < 0 || days <= 7) return 'high';
  if (days <= 30) return 'medium';
  return null;
}

function dueDetail(label, date, days) {
  if (days < 0) return `${label} overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} (${date})`;
  if (days === 0) return `${label} due today (${date})`;
  return `${label} due in ${days} day${days === 1 ? '' : 's'} (${date})`;
}

function formalRecordAlerts(report) {
  const base = {
    reportId: report.id,
    status: report.status,
    district: report.district || null,
    state: report.state || null,
  };
  const alerts = [];
  const addDueAlerts = (records, config) => {
    if (!Array.isArray(records)) return;
    for (const record of records) {
      const date = config.date(record);
      const days = daysUntil(date);
      const priority = dueAlertPriority(days);
      if (!priority) continue;
      alerts.push({
        id: `${config.type}_${record.id || report.id}_${date}`,
        type: config.type,
        priority,
        title: `${report.childName} ${config.title}`,
        detail: dueDetail(config.label, date, days),
        dueDate: date,
        daysUntil: days,
        ageDays: days < 0 ? Math.abs(days) + 30 : Math.max(0, 30 - days),
        ...base,
      });
    }
  };

  addDueAlerts(report.cciCareRecords, {
    type: 'cci_review_due',
    title: 'has CCI review due',
    label: 'CCI review',
    date: (record) => record.nextReviewDate,
  });
  addDueAlerts(report.jjbProceedings, {
    type: 'jjb_hearing_due',
    title: 'has JJB hearing due',
    label: 'JJB hearing',
    date: (record) => record.nextHearingDate,
  });
  addDueAlerts(report.stateEscalations, {
    type: 'state_escalation_due',
    title: 'has escalation action due',
    label: 'State escalation',
    date: (record) => record.dueDate,
  });
  addDueAlerts(report.bureauReports, {
    type: 'bureau_review_due',
    title: 'has bureau review due',
    label: 'Bureau review',
    date: (record) => record.nextReviewDate,
  });
  addDueAlerts(report.restorationPlans, {
    type: 'restoration_due',
    title: 'has restoration action due',
    label: 'Restoration plan',
    date: (record) => record.plannedDate || record.followupDate,
  });
  addDueAlerts(report.welfareReferrals, {
    type: 'welfare_review_due',
    title: 'has welfare review due',
    label: 'Welfare review',
    date: (record) => record.reviewDate,
  });
  addDueAlerts(report.legalAidReferrals, {
    type: 'legal_aid_review_due',
    title: 'has legal-aid follow-up due',
    label: 'Legal aid follow-up',
    date: (record) => record.hearingDate || record.reviewDate,
  });
  addDueAlerts(report.adoptionRecords, {
    type: 'adoption_review_due',
    title: 'has adoption follow-up due',
    label: 'Adoption follow-up',
    date: (record) => record.nextReviewDate || record.orderDate,
  });
  addDueAlerts(report.caseAssessments, {
    type: 'case_assessment_review_due',
    title: 'has case assessment review due',
    label: 'Case assessment review',
    date: (record) => record.nextReviewDate,
  });

  if (Array.isArray(report.productionRecords)) {
    for (const record of report.productionRecords) {
      if (record.deadlineStatus !== 'delayed') continue;
      alerts.push({
        id: `production_delayed_${record.id || report.id}`,
        type: 'production_delayed',
        priority: 'high',
        title: `${report.childName} production breached 24h`,
        detail: `${record.label || 'Production'} recorded after ${record.hoursToProduce ?? '24+'} hours`,
        dueDate: record.deadlineAt || null,
        ageDays: ageDays(record.producedAt || record.recordedAt),
        ...base,
      });
    }
  }

  return alerts;
}

function statusCounts(rows) {
  return rows.reduce((acc, row) => {
    const key = row.status || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function groupCounts(rows, keyFn) {
  return Object.entries(rows.reduce((acc, row) => {
    const key = keyFn(row) || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function ageBand(age) {
  const n = Number(age);
  if (!Number.isFinite(n) || n < 0) return 'Unknown';
  if (n <= 5) return '0-5';
  if (n <= 10) return '6-10';
  if (n <= 14) return '11-14';
  return '15-18';
}

function registeredSource(report) {
  if (report.registeredByRole === 'police') return 'Police/FIR';
  if (report.registeredByRole === 'sjpu') return 'SJPU/FIR';
  if (report.registeredByRole === 'ahtu') return 'AHTU rescue';
  if (report.registeredByRole === 'dcrb') return 'DCRB records';
  if (report.registeredByRole === 'saa') return 'SAA adoption';
  if (report.createdByRole === 'ngo' || report.registeredByRole === 'ngo') return 'NGO';
  if (report.createdByRole === 'parent' || report.registeredByRole === 'parent') return 'Citizen/parent';
  if (report.registeredByRole) return report.registeredByRole.replaceAll('_', ' ');
  return 'Unknown';
}

function latestFormalAlerts(reports) {
  return reports
    .flatMap((r) => formalRecordAlerts(r))
    .filter((alert) => [
      'cci_review_due',
      'jjb_hearing_due',
      'state_escalation_due',
      'bureau_review_due',
      'restoration_due',
      'welfare_review_due',
      'legal_aid_review_due',
      'adoption_review_due',
      'case_assessment_review_due',
      'production_delayed',
    ].includes(alert.type));
}

function abuseSeverity(row) {
  if (row.action === 'security.public_rate_limited') {
    const overBy = Number(row.metadata?.count || 0) - Number(row.metadata?.limit || 0);
    if (overBy >= 5) return 'high';
    return 'medium';
  }
  if (row.action === 'auth.privileged_registration_blocked') return 'high';
  return Number(row.metadata?.attempts || 0) >= 3 ? 'high' : 'medium';
}

function abuseSla(row, disposition) {
  const status = disposition?.status || 'open';
  const severity = abuseSeverity(row);
  const hours = severity === 'high' ? 4 : 24;
  const dueAt = Number(row.ts || 0) + hours * 60 * 60 * 1000;
  const now = Date.now();
  const closed = ['reviewed', 'escalated', 'dismissed'].includes(status);
  return {
    hours,
    dueAt,
    state: closed ? 'closed' : now > dueAt ? 'breached' : now + 60 * 60 * 1000 > dueAt ? 'due_soon' : 'open',
    overdueMinutes: closed || now <= dueAt ? 0 : Math.ceil((now - dueAt) / 60000),
  };
}

function abuseSignalVisible(actor, row) {
  if (actor.role === 'super_admin') return true;
  if (row.actorRole === 'public' && (!row.scope || (!row.scope.state && !row.scope.district))) return true;
  const scopedIds = new Set(scopeAudit(actor, listAudit(), listReports()).map((item) => item.id));
  return scopedIds.has(row.id);
}

function abuseDispositionMap(actor) {
  const scopedIds = new Set(scopeAudit(actor, listAudit(), listReports()).map((item) => item.id));
  const rows = listAudit()
    .filter((row) => ABUSE_DISPOSITION_ACTIONS.has(row.action))
    .filter((row) => actor.role === 'super_admin' || scopedIds.has(row.id) || row.actorId === actor.id)
    .sort((a, b) => b.ts - a.ts);
  const latest = new Map();
  for (const row of rows) {
    const signalId = row.metadata?.signalId;
    if (!signalId || latest.has(signalId)) continue;
    latest.set(signalId, {
      status: row.metadata?.disposition || row.action.replace('security.abuse_signal_', ''),
      action: row.action,
      ts: row.ts,
      actorName: row.actorName,
      actorRole: row.actorRole,
      noteLength: row.metadata?.noteLength || 0,
    });
  }
  return latest;
}

function publicAbuseRows(actor) {
  const dispositions = abuseDispositionMap(actor);
  const rows = listAudit()
    .filter((row) => ABUSE_ACTIONS.has(row.action))
    .filter((row) => abuseSignalVisible(actor, row))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 100)
    .map((row) => {
      const disposition = dispositions.get(row.id) || { status: 'open' };
      return {
        id: row.id,
        ts: row.ts,
        action: row.action,
        severity: abuseSeverity(row),
        summary: row.summary,
        targetType: row.targetType || null,
        targetId: row.targetId || null,
        actorRole: row.actorRole || null,
        scope: row.scope || {},
        disposition,
        sla: abuseSla(row, disposition),
        signal: {
          limiter: row.metadata?.limiter || null,
          route: row.metadata?.route || null,
          method: row.metadata?.method || null,
          identityHash: row.metadata?.identityHash ? String(row.metadata.identityHash).slice(0, 16) : null,
          count: row.metadata?.count || null,
          limit: row.metadata?.limit || null,
          retryAfterSeconds: row.metadata?.retryAfterSeconds || null,
          attempts: row.metadata?.attempts || null,
          phoneSuffix: row.metadata?.phoneSuffix || null,
          requestedRole: row.metadata?.requestedRole || null,
        },
      };
    });

  return rows;
}

function readinessChecks(actor) {
  const auditIntegrity = verifyAuditChain();
  const engine = matchEngineInfo();
  const abuseRows = publicAbuseRows(actor);
  const isProduction = process.env.NODE_ENV === 'production';
  return [
    {
      id: 'storage',
      label: 'Data storage',
      status: 'warning',
      detail: 'JSON file store is suitable for demo/pilot review only; use SQLite/Postgres before multi-agency live use.',
    },
    {
      id: 'audit_integrity',
      label: 'Audit integrity',
      status: auditIntegrity.ok ? 'pass' : 'fail',
      detail: auditIntegrity.ok ? `${auditIntegrity.checked} audit events hash-verified` : `Audit chain failed at ${auditIntegrity.failedId || 'unknown event'}`,
    },
    {
      id: 'export_signing',
      label: 'Signed exports',
      status: process.env.KHOZO_EXPORT_SIGNING_KEY ? 'pass' : 'warning',
      detail: process.env.KHOZO_EXPORT_SIGNING_KEY ? 'HMAC export signing key configured' : 'Demo HMAC export key in use; replace with managed key for production.',
    },
    {
      id: 'otp',
      label: 'OTP delivery',
      status: isProduction ? 'warning' : 'warning',
      detail: isProduction ? 'Production mode hides demo OTP but no SMS gateway is configured in this demo.' : 'Demo OTP is returned by API for pilot testing; wire real SMS gateway before launch.',
    },
    {
      id: 'match_provider',
      label: 'Aarakshak recognition',
      status: engine.biometric ? 'pass' : 'warning',
      detail: engine.biometric ? `${engine.provider} / ${engine.modelVersion}` : `${engine.provider} is a non-biometric workflow scorer; Aarakshak API remains future integration.`,
    },
    {
      id: 'public_abuse',
      label: 'Public abuse monitoring',
      status: abuseRows.some((row) => row.sla?.state === 'breached') ? 'warning' : 'pass',
      detail: `${abuseRows.length} redacted abuse signals monitored; ${abuseRows.filter((row) => row.sla?.state === 'breached').length} SLA breached.`,
    },
    {
      id: 'offline_queue',
      label: 'Offline public capture',
      status: 'pass',
      detail: 'PWA manifest, service worker, encrypted IndexedDB queue, TTL, and retry telemetry are present for field reporting.',
    },
    {
      id: 'automated_tests',
      label: 'Automated verification',
      status: 'warning',
      detail: 'Smoke suites cover API, route guards, PWA queue, redaction, exports, and audit behavior; broaden into full regression suite before launch.',
    },
  ];
}

function readinessSummary(checks) {
  return {
    pass: checks.filter((row) => row.status === 'pass').length,
    warning: checks.filter((row) => row.status === 'warning').length,
    fail: checks.filter((row) => row.status === 'fail').length,
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

function signedExport(payload, type) {
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

function sameHex(a, b) {
  if (!/^[a-f0-9]+$/i.test(String(a || '')) || !/^[a-f0-9]+$/i.test(String(b || ''))) return false;
  const aa = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifySignedExport(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, reason: 'invalid_export' };
  }
  const { signature, ...payload } = envelope;
  if (!signature || typeof signature !== 'object') return { ok: false, reason: 'missing_signature' };

  const type = signature.type;
  if (!['audit_export', 'privacy_export', 'mis_export', 'case_handoff_export', 'public_abuse_export'].includes(type)) return { ok: false, type: type || null, reason: 'unsupported_type' };
  if (signature.algorithm !== 'sha256-hmac') return { ok: false, type, reason: 'unsupported_algorithm' };

  const key = process.env.KHOZO_EXPORT_SIGNING_KEY || 'khozo-demo-export-signing-key';
  const canonical = JSON.stringify(stable(payload));
  const expectedDigest = crypto.createHash('sha256').update(canonical).digest('hex');
  const expectedValue = crypto.createHmac('sha256', key).update(`${type}.${expectedDigest}`).digest('hex');
  const digestOk = sameHex(signature.digest, expectedDigest);
  const valueOk = sameHex(signature.value, expectedValue);

  return {
    ok: digestOk && valueOk,
    type,
    keyId: signature.keyId || null,
    digest: signature.digest || null,
    expectedDigest,
    reason: digestOk && valueOk ? null : digestOk ? 'signature_mismatch' : 'digest_mismatch',
  };
}

// Headline stats + chart series, scoped to the caller's jurisdiction.
router.get('/stats', (req, res) => {
  const all = scopeReports(req.user, listReports());
  const scopedFound = scopeFoundReports(req.user, listFoundReports(), listReports());
  const found = all.filter((r) => r.status === 'found');
  const missing = all.filter((r) => r.status === 'missing');
  const review = all.filter((r) => r.status === 'under_review');
  const closed = all.filter((r) => r.status === 'closed');

  // For the national view, blend in the deck's headline totals so the numbers read realistically.
  const national = req.user.role === 'super_admin';
  const totalMissing = (national ? BASE_TOTAL_MISSING : 0) + missing.length + review.length;
  const totalFound = (national ? BASE_TOTAL_FOUND : 0) + found.length + closed.length;

  // State-wise breakdown.
  const byState = {};
  for (const r of all) {
    const k = r.state || 'Unknown';
    byState[k] = byState[k] || { state: k, missing: 0, found: 0 };
    if (r.status === 'found' || r.status === 'closed') byState[k].found++;
    else byState[k].missing++;
  }

  // Last-6-months trend of registrations vs reunions.
  const months = [];
  const nowD = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
    months.push({ key: d.toLocaleString('en-IN', { month: 'short' }), registered: 0, reunited: 0 });
  }
  const idxByKey = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const r of all) {
    const k = monthKey(r.createdAt);
    if (k in idxByKey) months[idxByKey[k]].registered++;
    if ((r.status === 'found' || r.status === 'closed') && k in idxByKey) months[idxByKey[k]].reunited++;
  }

  res.json({
    scope: scopeLabel(req.user),
    role: req.user.role,
    cards: {
      totalMissing,
      totalFound,
      activeCases: missing.length + review.length,
      pendingMatches: scopedFound.filter((f) => f.status === 'pending_review').length,
      reunificationRate: totalMissing + totalFound ? Math.round((totalFound / (totalMissing + totalFound)) * 100) : 0,
    },
    byState: Object.values(byState).sort((a, b) => b.missing + b.found - (a.missing + a.found)),
    trend: months,
    statusSplit: [
      { name: 'Missing', value: missing.length },
      { name: 'Under review', value: review.length },
      { name: 'Found', value: found.length },
      { name: 'Closed', value: closed.length },
    ],
  });
});

// Recent activity feed for the dashboard.
router.get('/activity', (req, res) => {
  res.json({ activity: scopeActivity(req.user, listActivity(), listReports()).slice(0, 12) });
});

router.get('/readiness', requireRole(...OPERATIONAL_ROLES), (req, res) => {
  const checks = readinessChecks(req.user);
  res.json({
    generatedAt: new Date().toISOString(),
    scope: scopeLabel(req.user),
    environment: process.env.NODE_ENV || 'development',
    summary: readinessSummary(checks),
    checks,
  });
});

router.get('/fraud', requireRole(...ABUSE_REVIEW_ROLES), (req, res) => {
  const rows = publicAbuseRows(req.user);
  res.json({
    scope: scopeLabel(req.user),
    totals: {
      signals: rows.length,
      open: rows.filter((row) => row.disposition?.status === 'open').length,
      reviewed: rows.filter((row) => row.disposition?.status === 'reviewed').length,
      escalated: rows.filter((row) => row.disposition?.status === 'escalated').length,
      dismissed: rows.filter((row) => row.disposition?.status === 'dismissed').length,
      slaBreached: rows.filter((row) => row.sla?.state === 'breached').length,
      slaDueSoon: rows.filter((row) => row.sla?.state === 'due_soon').length,
      high: rows.filter((row) => row.severity === 'high').length,
      rateLimited: rows.filter((row) => row.action === 'security.public_rate_limited').length,
      otpFailures: rows.filter((row) => row.action === 'auth.otp_failed').length,
      blockedPrivilegedSignups: rows.filter((row) => row.action === 'auth.privileged_registration_blocked').length,
    },
    byLimiter: groupCounts(rows, (row) => row.signal.limiter || row.action),
    byAction: groupCounts(rows, (row) => row.action),
    signals: rows,
  });
});

router.get('/fraud/export', requireRole(...ABUSE_REVIEW_ROLES), (req, res) => {
  const rows = publicAbuseRows(req.user);
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'security.abuse_report_exported',
    targetType: 'publicAbuseReport',
    summary: `Exported public abuse report with ${rows.length} signals`,
    scope: { state: req.user.jurisdiction?.state || null, district: req.user.jurisdiction?.district || null },
    metadata: {
      signalCount: rows.length,
      open: rows.filter((row) => row.disposition?.status === 'open').length,
      escalated: rows.filter((row) => row.disposition?.status === 'escalated').length,
      slaBreached: rows.filter((row) => row.sla?.state === 'breached').length,
    },
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    generatedBy: { id: req.user.id, role: req.user.role, name: req.user.name },
    scope: scopeLabel(req.user),
    totals: {
      signals: rows.length,
      high: rows.filter((row) => row.severity === 'high').length,
      open: rows.filter((row) => row.disposition?.status === 'open').length,
      reviewed: rows.filter((row) => row.disposition?.status === 'reviewed').length,
      escalated: rows.filter((row) => row.disposition?.status === 'escalated').length,
      dismissed: rows.filter((row) => row.disposition?.status === 'dismissed').length,
      slaBreached: rows.filter((row) => row.sla?.state === 'breached').length,
      slaDueSoon: rows.filter((row) => row.sla?.state === 'due_soon').length,
    },
    byAction: groupCounts(rows, (row) => row.action),
    byLimiter: groupCounts(rows, (row) => row.signal.limiter || row.action),
    signals: rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      action: row.action,
      severity: row.severity,
      scope: row.scope || {},
      disposition: row.disposition || { status: 'open' },
      sla: row.sla,
      source: {
        limiter: row.signal?.limiter || null,
        route: row.signal?.route || null,
        method: row.signal?.method || null,
        identityHash: row.signal?.identityHash || null,
        count: row.signal?.count || null,
        limit: row.signal?.limit || null,
      },
    })),
  };
  res.json(signedExport(payload, 'public_abuse_export'));
});

router.post('/fraud/:id/disposition', requireRole(...ABUSE_REVIEW_ROLES), (req, res) => {
  const signal = listAudit().find((row) => row.id === req.params.id && ABUSE_ACTIONS.has(row.action));
  if (!signal || !abuseSignalVisible(req.user, signal)) return res.status(404).json({ error: 'Abuse signal not found in your scope' });

  const disposition = String(req.body?.disposition || '').trim();
  const note = String(req.body?.note || '').trim();
  if (!ABUSE_DISPOSITIONS[disposition]) return res.status(400).json({ error: 'Disposition must be reviewed, escalated, or dismissed' });
  if (note.length > 280) return res.status(400).json({ error: 'Disposition note must be 280 characters or less' });

  const audit = addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: ABUSE_DISPOSITIONS[disposition],
    targetType: 'abuseSignal',
    targetId: signal.id,
    summary: `Marked public abuse signal ${disposition}`,
    scope: {
      state: signal.scope?.state || req.user.jurisdiction?.state || null,
      district: signal.scope?.district || null,
      signalId: signal.id,
    },
    metadata: {
      signalId: signal.id,
      disposition,
      signalAction: signal.action,
      limiter: signal.metadata?.limiter || null,
      severity: abuseSeverity(signal),
      noteLength: note.length,
    },
  });
  if (disposition === 'escalated') {
    addActivity({
      actor: req.user.name,
      actorId: req.user.id,
      action: 'Escalated public abuse signal',
      target: signal.metadata?.limiter || signal.action,
      icon: 'security',
      scope: {
        state: signal.scope?.state || req.user.jurisdiction?.state || null,
        district: signal.scope?.district || null,
      },
    });
  }
  res.json({
    disposition: {
      status: disposition,
      action: audit.action,
      ts: audit.ts,
      actorName: audit.actorName,
      actorRole: audit.actorRole,
      noteLength: note.length,
    },
  });
});

router.get('/cci-register', requireRole(...CCI_REGISTER_ROLES), (req, res) => {
  const rows = scopeReports(req.user, listReports())
    .flatMap((report) => {
      const careRecords = Array.isArray(report.cciCareRecords) ? report.cciCareRecords : [];
      return careRecords.map((record) => {
        const reviewDays = daysUntil(record.nextReviewDate);
        return {
          id: record.id,
          reportId: report.id,
          childName: report.childName,
          age: report.age ?? null,
          gender: report.gender || null,
          caseStatus: report.status,
          cciName: record.cciName,
          admissionType: record.admissionType,
          admissionLabel: record.label,
          admissionDate: record.admissionDate,
          nextReviewDate: record.nextReviewDate,
          reviewDays,
          reviewStatus: reviewDays == null ? 'not_scheduled' : reviewDays < 0 ? 'overdue' : reviewDays <= 7 ? 'due_soon' : 'scheduled',
          state: report.state || null,
          district: report.district || null,
          recordedAt: record.recordedAt,
          recordedByRole: record.actorRole || null,
        };
      });
    })
    .sort((a, b) => {
      const aReview = dateValue(a.nextReviewDate) || Number.MAX_SAFE_INTEGER;
      const bReview = dateValue(b.nextReviewDate) || Number.MAX_SAFE_INTEGER;
      return aReview - bReview || String(a.cciName || '').localeCompare(String(b.cciName || ''));
    });
  const activeRows = rows.filter((row) => !['found', 'closed'].includes(row.caseStatus));
  res.json({
    scope: scopeLabel(req.user),
    totals: {
      records: rows.length,
      activeChildren: activeRows.length,
      overdueReviews: rows.filter((row) => row.reviewStatus === 'overdue').length,
      dueSoonReviews: rows.filter((row) => row.reviewStatus === 'due_soon').length,
      institutions: new Set(rows.map((row) => row.cciName).filter(Boolean)).size,
    },
    byInstitution: groupCounts(rows, (row) => row.cciName),
    byAdmissionType: groupCounts(rows, (row) => row.admissionLabel),
    register: rows,
  });
});

router.get('/followups', requireRole(...OPERATIONAL_ROLES), (req, res) => {
  const scopedReports = scopeReports(req.user, listReports());
  const scopedFound = scopeFoundReports(req.user, listFoundReports(), listReports());
  const openReports = scopedReports.filter((r) => ['missing', 'under_review'].includes(r.status));
  const reportAlerts = openReports.flatMap((r) => {
    const alerts = [];
    const caseAge = ageDays(r.createdAt);
    const touchedDays = ageDays(latestCaseTouch(r));
    if (caseAge >= 30) {
      alerts.push({
        id: `case_age_${r.id}`,
        type: 'case_overdue',
        priority: caseAge >= 90 ? 'high' : 'medium',
        title: `${r.childName} open for ${caseAge} days`,
        detail: [r.district, r.state].filter(Boolean).join(', ') || 'Location missing',
        ageDays: caseAge,
        reportId: r.id,
        status: r.status,
        district: r.district || null,
        state: r.state || null,
      });
    }
    if (touchedDays >= 14) {
      alerts.push({
        id: `case_touch_${r.id}`,
        type: 'case_no_recent_update',
        priority: touchedDays >= 30 ? 'high' : 'medium',
        title: `${r.childName} needs a follow-up note`,
        detail: `No workflow/note update for ${touchedDays} days`,
        ageDays: touchedDays,
        reportId: r.id,
        status: r.status,
        district: r.district || null,
        state: r.state || null,
      });
    }
    return [...alerts, ...formalRecordAlerts(r)];
  });
  const sightingAlerts = scopedFound
    .filter((f) => f.status === 'pending_review' && ageDays(f.createdAt) >= 2)
    .map((f) => ({
      id: `sighting_${f.id}`,
      type: 'pending_sighting',
      priority: ageDays(f.createdAt) >= 7 ? 'high' : 'medium',
      title: `Sighting pending ${ageDays(f.createdAt)} days`,
      detail: f.foundLocation || 'Unknown location',
      ageDays: ageDays(f.createdAt),
      foundReportId: f.id,
      matchedReportId: f.matchedReportId || null,
      district: f.district || null,
      state: f.state || null,
    }));
  const alerts = [...reportAlerts, ...sightingAlerts]
    .sort((a, b) => (a.priority === b.priority ? b.ageDays - a.ageDays : a.priority === 'high' ? -1 : 1))
    .slice(0, 25);
  res.json({
    scope: scopeLabel(req.user),
    totals: {
      alerts: alerts.length,
      high: alerts.filter((a) => a.priority === 'high').length,
      caseOverdue: alerts.filter((a) => a.type === 'case_overdue').length,
      staleUpdates: alerts.filter((a) => a.type === 'case_no_recent_update').length,
      pendingSightings: alerts.filter((a) => a.type === 'pending_sighting').length,
      formalFollowups: alerts.filter((a) => !['case_overdue', 'case_no_recent_update', 'pending_sighting'].includes(a.type)).length,
    },
    alerts,
  });
});

// Super Admin / Admin: roster of stakeholders in the network (drill-down).
router.get('/network', requireRole('super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'), (req, res) => {
  const users = scopeNetworkUsers(req.user, listUsers()).map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, org: u.org, phone: u.phone,
    jurisdiction: u.jurisdiction,
  }));
  res.json({ users, coverage: networkCoverage(req.user) });
});

router.post('/network/users', requireRole('super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau'), (req, res) => {
  const { name, email, role, phone, org, state, district, station } = req.body || {};
  if (!name || !email || !role) return res.status(400).json({ error: 'Name, email, and role are required' });
  if (!canProvisionRole(req.user, role)) return res.status(403).json({ error: 'You cannot provision this role' });
  if (findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });

  const jurisdiction = scopedJurisdiction(req.user, role, { state, district, station });
  if (!jurisdiction) return res.status(403).json({ error: 'Requested jurisdiction is outside your provisioning scope' });

  const initialPassword = temporaryPassword();
  const user = addUser({
    id: `u_${nanoid(8)}`,
    name,
    email,
    passwordHash: bcrypt.hashSync(initialPassword, 8),
    role,
    phone: phone || null,
    org: org || null,
    jurisdiction,
    provisionedBy: req.user.id,
    mustChangePassword: true,
    createdAt: Date.now(),
  });
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'auth.privileged_user_provisioned',
    targetType: 'user',
    targetId: user.id,
    summary: `Provisioned ${role} account for ${name}`,
    scope: { state: jurisdiction.state, district: jurisdiction.district },
    metadata: { role, email, mustChangePassword: true },
  });
  res.status(201).json({ user: publicUser(user), initialPassword });
});

router.post('/network/alerts', requireRole(...NETWORK_ALERT_ROLES), (req, res) => {
  const { audience = 'all_operational', state, district, subject, message, caseRef } = req.body || {};
  if (!NETWORK_ALERT_AUDIENCES[audience]) {
    return res.status(400).json({ error: `Audience must be one of ${Object.keys(NETWORK_ALERT_AUDIENCES).join(', ')}` });
  }
  const cleanSubject = String(subject || '').trim().slice(0, 160);
  const cleanMessage = String(message || '').trim().slice(0, 1000);
  const cleanState = String(state || req.user.jurisdiction?.state || '').trim();
  const cleanDistrict = String(district || '').trim();
  const cleanCaseRef = String(caseRef || '').trim().slice(0, 120) || null;
  if (cleanSubject.length < 4) return res.status(400).json({ error: 'Alert subject must be at least 4 characters' });
  if (cleanMessage.length < 10) return res.status(400).json({ error: 'Alert message must be at least 10 characters' });
  if (req.user.role !== 'super_admin') {
    const actorState = req.user.jurisdiction?.state || null;
    if (actorState && cleanState && cleanState !== actorState) {
      return res.status(403).json({ error: 'Network alert state is outside your scope' });
    }
  }

  const allowedRolesByAudience = {
    all_operational: OPERATIONAL_ROLES.filter((role) => role !== 'super_admin'),
    police_rpf: ['police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'crime_bureau'],
    records: ['dcrb', 'crime_bureau', 'police', 'sjpu', 'ahtu', 'rpf'],
    welfare: ['cwc', 'dcpu', 'cci', 'saa', 'jjb', 'dlsa', 'state_nodal', 'sara'],
    legal: ['dlsa', 'cwc', 'dcpu', 'jjb', 'state_nodal'],
    adoption: ['sara', 'saa', 'cwc', 'dcpu', 'cci', 'state_nodal'],
    ngo: ['ngo'],
  };
  const recipients = scopeNetworkUsers(req.user, listUsers())
    .filter((u) => allowedRolesByAudience[audience].includes(u.role))
    .filter((u) => !cleanState || u.jurisdiction?.state === cleanState)
    .filter((u) => !cleanDistrict || u.jurisdiction?.district === cleanDistrict)
    .map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      org: u.org || null,
      email: u.email || null,
      phone: u.phone || null,
      jurisdiction: u.jurisdiction,
    }));

  const now = Date.now();
  const alert = {
    id: `net_${now}_${nanoid(6)}`,
    audience,
    audienceLabel: NETWORK_ALERT_AUDIENCES[audience],
    subject: cleanSubject,
    message: cleanMessage,
    caseRef: cleanCaseRef,
    state: cleanState || null,
    district: cleanDistrict || null,
    recipientCount: recipients.length,
    createdAt: now,
  };
  addActivity({
    actor: req.user.name,
    action: `Sent network alert: ${NETWORK_ALERT_AUDIENCES[audience]}`,
    target: cleanSubject,
    icon: 'sms',
    actorId: req.user.id,
    scope: { state: alert.state, district: alert.district, caseRef: cleanCaseRef },
  });
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'network.alert_sent',
    targetType: 'networkAlert',
    targetId: alert.id,
    summary: `Sent network alert to ${recipients.length} ${NETWORK_ALERT_AUDIENCES[audience]} recipients`,
    scope: { state: alert.state, district: alert.district, caseRef: cleanCaseRef },
    metadata: {
      audience,
      subject: cleanSubject,
      messageLength: cleanMessage.length,
      recipientCount: recipients.length,
      recipientRoles: [...new Set(recipients.map((row) => row.role))].sort(),
      caseRefPresent: Boolean(cleanCaseRef),
    },
  });
  res.status(201).json({ alert, recipients });
});

router.get('/audit', requireRole(...OPERATIONAL_ROLES), (req, res) => {
  const rows = scopeAudit(req.user, listAudit(), listReports())
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 100);
  res.json({ audit: rows, integrity: verifyAuditChain() });
});

router.get('/audit/export', requireRole(...OPERATIONAL_ROLES), (req, res) => {
  const rows = scopeAudit(req.user, listAudit(), listReports())
    .slice()
    .sort((a, b) => b.ts - a.ts);
  const integrityBeforeExport = verifyAuditChain();
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'audit.report_exported',
    targetType: 'auditReport',
    summary: `Exported audit log with ${rows.length} events`,
    scope: { state: req.user.jurisdiction?.state || null, district: req.user.jurisdiction?.district || null },
    metadata: { count: rows.length },
  });
  const integrityAfterExport = verifyAuditChain();
  const payload = {
    generatedAt: new Date().toISOString(),
    generatedBy: { id: req.user.id, role: req.user.role, name: req.user.name },
    scope: scopeLabel(req.user),
    integrity: integrityBeforeExport,
    exportAuditIntegrity: integrityAfterExport,
    totals: {
      events: rows.length,
      actors: new Set(rows.map((row) => row.actorId || row.actorName).filter(Boolean)).size,
      actions: new Set(rows.map((row) => row.action).filter(Boolean)).size,
    },
    audit: rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      actorId: row.actorId || null,
      actorName: row.actorName || null,
      actorRole: row.actorRole || null,
      action: row.action,
      targetType: row.targetType || null,
      targetId: row.targetId || null,
      summary: row.summary || null,
      scope: row.scope || {},
      metadata: row.metadata || {},
    })),
  };
  res.json(signedExport(payload, 'audit_export'));
});

router.get('/audit/integrity', requireRole(...OPERATIONAL_ROLES), (req, res) => {
  const integrity = verifyAuditChain();
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'audit.integrity_checked',
    targetType: 'auditLog',
    summary: `Checked audit integrity: ${integrity.ok ? 'valid' : 'failed'}`,
    scope: { state: req.user.jurisdiction?.state || null, district: req.user.jurisdiction?.district || null },
    metadata: { ok: integrity.ok, checked: integrity.checked, headHash: integrity.headHash || null, failedId: integrity.failedId || null },
  });
  res.json({ integrity, checkedAt: new Date().toISOString(), scope: scopeLabel(req.user) });
});

router.post('/export/verify', requireRole(...OPERATIONAL_ROLES), (req, res) => {
  const result = verifySignedExport(req.body);
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'export.signature_verified',
    targetType: 'signedExport',
    summary: `Verified ${result.type || 'unknown'} export signature: ${result.ok ? 'valid' : 'failed'}`,
    scope: { state: req.user.jurisdiction?.state || null, district: req.user.jurisdiction?.district || null },
    metadata: {
      ok: result.ok,
      type: result.type || null,
      keyId: result.keyId || null,
      digest: result.digest || null,
      reason: result.reason || null,
    },
  });
  res.json({ ...result, verifiedAt: new Date().toISOString() });
});

router.get('/mis', requireRole(...OPERATIONAL_ROLES), (req, res) => {
  const reports = scopeReports(req.user, listReports());
  const foundReports = scopeFoundReports(req.user, listFoundReports(), listReports());
  const auditRows = scopeAudit(req.user, listAudit(), listReports());
  const openReports = reports.filter((r) => ['missing', 'under_review', 'intake_pending'].includes(r.status));
  const verifiedReports = reports.filter((r) => r.intakeStatus === 'verified' || ['police', 'sjpu', 'ahtu', 'dcrb', 'saa'].includes(r.registeredByRole));
  const pendingIntake = reports.filter((r) => r.status === 'intake_pending' || r.intakeStatus === 'pending_verification');
  const publishedBulletins = reports.filter((r) => r.bulletin?.published);
  const pendingSightings = foundReports.filter((f) => f.status === 'pending_review' || f.status === 'no_match');
  const overdueCases = openReports.filter((r) => ageDays(r.createdAt) >= 30);
  const staleCases = openReports.filter((r) => ageDays(latestCaseTouch(r)) >= 14);
  const oldSightings = foundReports.filter((f) => f.status === 'pending_review' && ageDays(f.createdAt) >= 2);
  const formalAlerts = latestFormalAlerts(openReports);
  const productionRecords = reports.flatMap((r) => (Array.isArray(r.productionRecords) ? r.productionRecords : []));
  const delayedProduction = productionRecords.filter((record) => record.deadlineStatus === 'delayed');
  const withinProduction = productionRecords.filter((record) => record.deadlineStatus === 'within_24h');
  const privacyDue = [...reports, ...foundReports].filter((row) => {
    const days = daysUntil(row.retentionUntil);
    return days != null && days <= 30;
  });

  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'mis.report_generated',
    targetType: 'misReport',
    summary: `Generated MIS report for ${scopeLabel(req.user)}`,
    scope: { state: req.user.jurisdiction?.state || null, district: req.user.jurisdiction?.district || null },
    metadata: { reportCount: reports.length, sightingCount: foundReports.length },
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    generatedBy: { id: req.user.id, name: req.user.name, role: req.user.role },
    scope: scopeLabel(req.user),
    totals: {
      reports: reports.length,
      activeCases: openReports.length,
      verifiedCases: verifiedReports.length,
      pendingCitizenIntake: pendingIntake.length,
      sightings: foundReports.length,
      pendingSightings: pendingSightings.length,
      publishedBulletins: publishedBulletins.length,
      overdueCases: overdueCases.length,
      staleCases: staleCases.length,
      formalFollowups: formalAlerts.length,
      productionRecords: productionRecords.length,
      productionDelayed: delayedProduction.length,
      productionWithin24h: withinProduction.length,
      privacyDue: privacyDue.length,
    },
    caseStatus: statusCounts(reports),
    sightingStatus: statusCounts(foundReports),
    demographics: {
      byAgeBand: groupCounts(reports, (r) => ageBand(r.age)),
      byGender: groupCounts(reports, (r) => r.gender),
      byRegistrationSource: groupCounts(reports, registeredSource),
    },
    compliance: {
      formalFollowups: groupCounts(formalAlerts, (alert) => alert.type.replaceAll('_', ' ')),
      production: [
        { name: 'within 24h', count: withinProduction.length },
        { name: 'delayed', count: delayedProduction.length },
      ],
      pendingWork: [
        { name: 'overdue cases', count: overdueCases.length },
        { name: 'stale case updates', count: staleCases.length },
        { name: 'old pending sightings', count: oldSightings.length },
        { name: 'formal follow-ups due', count: formalAlerts.length },
      ],
    },
    byState: groupCounts(reports, (r) => r.state),
    byDistrict: groupCounts(reports, (r) => r.district).slice(0, 12),
    workflowActions: groupCounts(
      reports.flatMap((r) => Array.isArray(r.workflow) ? r.workflow : []),
      (event) => event.label || event.action
    ),
    recentAudit: auditRows
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        ts: row.ts,
        action: row.action,
        actorRole: row.actorRole,
        summary: row.summary,
        targetType: row.targetType,
      })),
  };
  res.json(signedExport(payload, 'mis_export'));
});

function privacyCapabilities(user) {
  return {
    canReview: PRIVACY_REVIEW_ROLES.includes(user.role),
    canExport: PRIVACY_EXPORT_ROLES.includes(user.role),
    canAnonymize: PRIVACY_ANONYMIZE_ROLES.includes(user.role),
  };
}

function retentionState(item) {
  const days = daysUntil(item.retentionUntil);
  if (days == null) return 'missing_retention';
  if (days < 0) return 'expired';
  if (days <= 30) return 'due_soon';
  return 'active';
}

function anonymizationApproval(body = {}) {
  const reference = String(body.approvalReference || '').trim().slice(0, 120);
  const type = String(body.approvalType || 'privacy_officer').trim().slice(0, 60) || 'privacy_officer';
  const note = String(body.approvalNote || '').trim();
  return { reference, type, noteLength: note.length };
}

router.get('/privacy/retention', requireRole(...PRIVACY_VIEW_ROLES), (req, res) => {
  const scopedReports = scopeReports(req.user, listReports());
  const scopedFound = scopeFoundReports(req.user, listFoundReports(), listReports());
  const reportRows = scopedReports
    .filter((r) => r.photoUrl || r.retentionUntil)
    .map((r) => ({
      id: r.id,
      type: 'report',
      subject: r.childName,
      status: r.status,
      location: [r.district, r.state].filter(Boolean).join(', '),
      dataPurpose: r.dataPurpose || 'missing_child_investigation',
      photoConsent: !!r.photoConsent,
      retentionUntil: r.retentionUntil || null,
      retentionState: retentionState(r),
      daysUntilRetention: daysUntil(r.retentionUntil),
    }));
  const sightingRows = scopedFound.map((f) => ({
    id: f.id,
    type: 'foundReport',
    subject: f.reporterName || 'Public sighting',
    status: f.status,
    location: f.foundLocation,
    dataPurpose: f.dataPurpose || 'sighting_review_and_child_protection',
    photoConsent: !!f.photoConsent,
    retentionUntil: f.retentionUntil || null,
    retentionState: retentionState(f),
    daysUntilRetention: daysUntil(f.retentionUntil),
  }));
  const rows = [...reportRows, ...sightingRows].sort((a, b) => {
    const aa = a.retentionUntil ? new Date(a.retentionUntil).getTime() : Number.MAX_SAFE_INTEGER;
    const bb = b.retentionUntil ? new Date(b.retentionUntil).getTime() : Number.MAX_SAFE_INTEGER;
    return aa - bb;
  });
  res.json({ retention: rows, capabilities: privacyCapabilities(req.user) });
});

router.post('/privacy/retention/:type/:id', requireRole(...PRIVACY_REVIEW_ROLES), (req, res) => {
  const { type, id } = req.params;
  const { decision, extendDays = 180 } = req.body || {};
  if (!['extend', 'close', 'anonymize'].includes(decision)) return res.status(400).json({ error: 'Decision must be extend, close or anonymize' });
  if (decision === 'anonymize' && !PRIVACY_ANONYMIZE_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only command privacy officers can anonymize records' });
  }
  const approval = anonymizationApproval(req.body);
  if (decision === 'anonymize' && approval.reference.length < 6) {
    return res.status(400).json({ error: 'Anonymization requires an approval/order reference of at least 6 characters' });
  }

  const scopedReports = scopeReports(req.user, listReports());
  const scopedFound = scopeFoundReports(req.user, listFoundReports(), listReports());
  const now = Date.now();
  const nextRetention = new Date(now + Math.max(1, Number(extendDays)) * 86400000).toISOString();

  if (type === 'report') {
    const report = scopedReports.find((r) => r.id === id);
    if (!report) return res.status(404).json({ error: 'Report not found in your scope' });
    const patch = decision === 'extend'
      ? { retentionUntil: nextRetention, privacyReviewStatus: 'retention_extended' }
      : decision === 'anonymize'
        ? {
            childName: `Anonymized ${report.id}`,
            childAadhar: null,
            photoUrl: null,
            parentName: 'Anonymized',
            parentPhone: null,
            parentEmail: null,
            address: null,
            privacyReviewStatus: 'anonymized',
            anonymizedAt: new Date(now).toISOString(),
            anonymizationApproval: approval,
          }
        : { privacyReviewStatus: 'case_retention_reviewed' };
    updateReport(id, patch);
    const auditAction = decision === 'extend'
      ? 'privacy.retention_extended'
      : decision === 'anonymize'
        ? 'privacy.record_anonymized'
        : 'privacy.retention_reviewed';
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: auditAction,
      targetType: 'report',
      targetId: id,
      summary: `${decision === 'extend' ? 'Extended' : decision === 'anonymize' ? 'Anonymized' : 'Reviewed'} retention for ${report.childName}`,
      scope: { state: report.state, district: report.district, reportId: id },
      metadata: decision === 'anonymize' ? {
        privacyReviewStatus: patch.privacyReviewStatus,
        anonymizedAt: patch.anonymizedAt,
        approvalType: approval.type,
        approvalReference: approval.reference,
        approvalNoteLength: approval.noteLength,
      } : patch,
    });
    addActivity({ actor: req.user.name, action: `${decision === 'extend' ? 'Extended' : decision === 'anonymize' ? 'Anonymized' : 'Reviewed'} privacy retention`, target: report.childName, icon: 'eye', scope: { state: report.state, district: report.district, reportId: id } });
    return res.json({ item: { ...report, ...patch } });
  }

  if (type === 'foundReport') {
    const found = scopedFound.find((f) => f.id === id);
    if (!found) return res.status(404).json({ error: 'Sighting not found in your scope' });
    const patch = decision === 'extend'
      ? { retentionUntil: nextRetention, privacyReviewStatus: 'retention_extended' }
      : decision === 'anonymize'
        ? {
            photoUrl: null,
            lat: null,
            lng: null,
            reporterName: 'Anonymized citizen',
            reporterPhone: null,
            note: null,
            privacyReviewStatus: 'anonymized',
            anonymizedAt: new Date(now).toISOString(),
            anonymizationApproval: approval,
          }
        : { status: found.status === 'pending_review' ? 'referred_cwc' : found.status, privacyReviewStatus: 'retention_reviewed', referralStatus: found.referralStatus || 'Privacy retention reviewed' };
    updateFoundReport(id, patch);
    const auditAction = decision === 'extend'
      ? 'privacy.retention_extended'
      : decision === 'anonymize'
        ? 'privacy.record_anonymized'
        : 'privacy.retention_reviewed';
    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: auditAction,
      targetType: 'foundReport',
      targetId: id,
      summary: `${decision === 'extend' ? 'Extended' : decision === 'anonymize' ? 'Anonymized' : 'Reviewed'} retention for sighting at ${found.foundLocation}`,
      scope: { state: found.state, district: found.district, matchedReportId: found.matchedReportId },
      metadata: decision === 'anonymize' ? {
        privacyReviewStatus: patch.privacyReviewStatus,
        anonymizedAt: patch.anonymizedAt,
        approvalType: approval.type,
        approvalReference: approval.reference,
        approvalNoteLength: approval.noteLength,
      } : patch,
    });
    addActivity({ actor: req.user.name, action: `${decision === 'extend' ? 'Extended' : decision === 'anonymize' ? 'Anonymized' : 'Reviewed'} privacy retention`, target: found.foundLocation, icon: 'eye', scope: { state: found.state, district: found.district, matchedReportId: found.matchedReportId } });
    return res.json({ item: { ...found, ...patch } });
  }

  return res.status(400).json({ error: 'Unknown retention item type' });
});

router.get('/privacy/export', requireRole(...PRIVACY_EXPORT_ROLES), (req, res) => {
  const scopedReports = scopeReports(req.user, listReports());
  const scopedFound = scopeFoundReports(req.user, listFoundReports(), listReports());
  const reportItems = scopedReports
    .filter((r) => r.photoUrl || r.retentionUntil || r.privacyReviewStatus)
    .map((r) => ({
      type: 'report',
      id: r.id,
      status: r.status,
      district: r.district || null,
      state: r.state || null,
      photoConsent: !!r.photoConsent,
      dataPurpose: r.dataPurpose || 'missing_child_investigation',
      retentionUntil: r.retentionUntil || null,
      privacyReviewStatus: r.privacyReviewStatus || null,
      anonymizedAt: r.anonymizedAt || null,
      anonymizationApproval: r.anonymizationApproval ? {
        type: r.anonymizationApproval.type || null,
        reference: r.anonymizationApproval.reference || null,
        noteLength: r.anonymizationApproval.noteLength || 0,
      } : null,
    }));
  const sightingItems = scopedFound.map((f) => ({
    type: 'foundReport',
    id: f.id,
    status: f.status,
    location: f.foundLocation,
    matchedReportId: f.matchedReportId || null,
    photoConsent: !!f.photoConsent,
    dataPurpose: f.dataPurpose || 'sighting_review_and_child_protection',
    retentionUntil: f.retentionUntil || null,
    privacyReviewStatus: f.privacyReviewStatus || null,
    anonymizedAt: f.anonymizedAt || null,
    anonymizationApproval: f.anonymizationApproval ? {
      type: f.anonymizationApproval.type || null,
      reference: f.anonymizationApproval.reference || null,
      noteLength: f.anonymizationApproval.noteLength || 0,
    } : null,
  }));
  const items = [...reportItems, ...sightingItems];
  addAudit({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'privacy.report_exported',
    targetType: 'privacyReport',
    summary: `Exported privacy report with ${items.length} records`,
    scope: { state: req.user.jurisdiction?.state || null, district: req.user.jurisdiction?.district || null },
    metadata: { count: items.length },
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    generatedBy: { id: req.user.id, role: req.user.role, name: req.user.name },
    scope: scopeLabel(req.user),
    totals: {
      records: items.length,
      anonymized: items.filter((i) => i.privacyReviewStatus === 'anonymized').length,
      missingRetention: items.filter((i) => !i.retentionUntil).length,
    },
    items,
  };
  res.json(signedExport(payload, 'privacy_export'));
});

export default router;
