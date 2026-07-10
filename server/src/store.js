// Khozo data store.
// A tiny file-backed JSON repository so the whole app runs with zero external services.
// Everything goes through this module, so swapping in Postgres later means rewriting only this file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** @type {{users:any[], reports:any[], foundReports:any[], grievances:any[], activity:any[], audit:any[]}} */
let db = { users: [], reports: [], foundReports: [], grievances: [], activity: [], audit: [] };

function persist() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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

function auditPayload(row, prevHash) {
  return {
    id: row.id,
    ts: row.ts,
    actorId: row.actorId || null,
    actorName: row.actorName || 'System',
    actorRole: row.actorRole || 'system',
    action: row.action,
    targetType: row.targetType || null,
    targetId: row.targetId || null,
    summary: row.summary || '',
    scope: row.scope || {},
    metadata: row.metadata || {},
    prevHash: prevHash || null,
  };
}

function auditHash(row, prevHash = row.prevHash || null) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stable(auditPayload(row, prevHash))))
    .digest('hex');
}

function normalizeAuditChain() {
  let changed = false;
  const chronological = db.audit.slice().reverse();
  let prevHash = null;
  for (const row of chronological) {
    const expected = auditHash(row, prevHash);
    if (row.prevHash !== prevHash || row.hash !== expected) {
      row.prevHash = prevHash;
      row.hash = expected;
      changed = true;
    }
    prevHash = row.hash;
  }
  return changed;
}

function stakeholderUsers(now = Date.now()) {
  const hash = (pw) => bcrypt.hashSync(pw, 8);
  return [
    {
      id: 'u_cwc',
      name: 'Mumbai CWC Desk',
      email: 'cwc@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'cwc',
      phone: '022-2400-1098',
      org: 'Child Welfare Committee',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: null },
      createdAt: now,
    },
    {
      id: 'u_dcpu',
      name: 'Mumbai DCPU Officer',
      email: 'dcpu@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'dcpu',
      phone: '022-2400-2200',
      org: 'District Child Protection Unit',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: null },
      createdAt: now,
    },
    {
      id: 'u_rpf',
      name: 'RPF Mumbai Central',
      email: 'rpf@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'rpf',
      phone: '139',
      org: 'Railway Protection Force',
      jurisdiction: { level: 'station', state: 'Maharashtra', district: 'Mumbai', station: 'Mumbai Central RPF' },
      createdAt: now,
    },
    {
      id: 'u_sjpu',
      name: 'Mumbai SJPU Desk',
      email: 'sjpu@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'sjpu',
      phone: '022-2400-1120',
      org: 'Special Juvenile Police Unit',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: 'Mumbai SJPU' },
      createdAt: now,
    },
    {
      id: 'u_ahtu',
      name: 'Mumbai AHTU Desk',
      email: 'ahtu@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'ahtu',
      phone: '022-2400-1130',
      org: 'Anti Human Trafficking Unit',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: 'Mumbai AHTU' },
      createdAt: now,
    },
    {
      id: 'u_cci',
      name: 'Mumbai CCI Intake',
      email: 'cci@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'cci',
      phone: '022-2400-3300',
      org: 'Child Care Institution',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: null },
      createdAt: now,
    },
    {
      id: 'u_saa',
      name: 'Mumbai SAA Desk',
      email: 'saa@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'saa',
      phone: '022-2400-3310',
      org: 'Specialised Adoption Agency',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: 'Mumbai SAA' },
      createdAt: now,
    },
    {
      id: 'u_jjb',
      name: 'Mumbai JJB Desk',
      email: 'jjb@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'jjb',
      phone: '022-2400-4400',
      org: 'Juvenile Justice Board',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: null },
      createdAt: now,
    },
    {
      id: 'u_state_nodal',
      name: 'Maharashtra State Nodal Officer',
      email: 'nodal@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'state_nodal',
      phone: '022-2400-5500',
      org: 'State Child Protection Society',
      jurisdiction: { level: 'state', state: 'Maharashtra', district: null, station: null },
      createdAt: now,
    },
    {
      id: 'u_sara',
      name: 'Maharashtra SARA Desk',
      email: 'sara@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'sara',
      phone: '022-2400-5520',
      org: 'State Adoption Resource Agency',
      jurisdiction: { level: 'state', state: 'Maharashtra', district: null, station: null },
      createdAt: now,
    },
    {
      id: 'u_crime_bureau',
      name: 'Maharashtra Crime Records Bureau',
      email: 'crimebureau@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'crime_bureau',
      phone: '022-2400-6600',
      org: 'Crime Records Bureau',
      jurisdiction: { level: 'state', state: 'Maharashtra', district: null, station: null },
      createdAt: now,
    },
    {
      id: 'u_dcrb',
      name: 'Mumbai DCRB Desk',
      email: 'dcrb@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'dcrb',
      phone: '022-2400-6610',
      org: 'District Crime Records Bureau',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: 'Mumbai DCRB' },
      createdAt: now,
    },
    {
      id: 'u_dlsa',
      name: 'Mumbai DLSA Legal Aid Desk',
      email: 'dlsa@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'dlsa',
      phone: '022-2400-7710',
      org: 'District Legal Services Authority',
      jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Mumbai', station: 'Mumbai DLSA' },
      createdAt: now,
    },
  ];
}

function ensureStakeholderUsers() {
  let changed = false;
  for (const user of stakeholderUsers()) {
    if (!db.users.some((u) => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase())) {
      db.users.push(user);
      changed = true;
    }
  }
  if (changed) persist();
}

function mumbaiStakeholderSighting(now = Date.now()) {
  return {
    id: 'f_mumbai_cwc',
    photoUrl: null,
    foundLocation: 'Dadar Railway Station concourse, Mumbai',
    lat: 19.018, lng: 72.843,
    reporterName: 'RPF Volunteer',
    reporterPhone: '139',
    note: 'Child seen alone near platform entry, approx 7 yrs',
    matchedReportId: 'r_10',
    matchScore: 0.76,
    status: 'pending_review',
    photoConsent: false,
    dataPurpose: 'sighting_review_and_child_protection',
    retentionUntil: new Date(now + 180 * 86400000).toISOString(),
    referredTo1098: true,
    referralStatus: 'Police/CWC review pending',
    createdAt: now - 2 * 86400000,
  };
}

function ensureStakeholderDemoData() {
  let changed = false;
  if (!db.foundReports.some((f) => f.id === 'f_mumbai_cwc')) {
    db.foundReports.unshift(mumbaiStakeholderSighting());
    changed = true;
  }
  if (changed) persist();
}

function inferActivityScope(row) {
  const target = String(row.target || '').toLowerCase();
  if (target.includes('suresh')) return { state: 'Tamil Nadu', district: 'Perambalur', reportId: 'r_1' };
  if (target.includes('kabir') || target.includes('mumbai') || target.includes('powai')) return { state: 'Maharashtra', district: 'Mumbai' };
  if (target.includes('margao') || target.includes('goa')) return { state: 'Goa', district: 'South Goa' };
  return null;
}

function ensureActivityScopes() {
  let changed = false;
  for (const row of db.activity) {
    if (!row.scope) {
      const scope = inferActivityScope(row);
      if (scope) {
        row.scope = scope;
        changed = true;
      }
    }
  }
  if (changed) persist();
}

function ensureSeedOwnership() {
  let changed = false;
  const parent = db.users.find((u) => u.id === 'u_parent');
  const ngo = db.users.find((u) => u.id === 'u_ngo');
  for (const report of db.reports) {
    if (!report.declaration) {
      report.declaration = {
        accepted: true,
        acceptedAt: report.createdAt || Date.now(),
        method: 'digital',
        methodLabel: 'Digital self-declaration',
        signerName: report.parentName || report.registeredByName || 'Seed data',
        signerRole: report.registeredByRole || 'system',
        relationshipToChild: report.registeredByRole === 'parent' ? 'parent' : report.registeredByRole || 'official',
        statementVersion: 'missing_child_intake_v1',
      };
      changed = true;
    }
    if (parent && report.parentPhone === parent.phone && report.registeredById !== parent.id) {
      report.registeredById = parent.id;
      report.registeredByRole = 'parent';
      changed = true;
    }
    if (ngo && report.childName === 'Kabir' && report.registeredById !== ngo.id) {
      report.registeredById = ngo.id;
      report.registeredByRole = 'ngo';
      changed = true;
    }
  }
  if (changed) persist();
}

// ---------------------------------------------------------------------------
// Seed data — modelled directly on the Khozo deck & proposal.
// Headline figures from the dashboard slide: Total Missing 10468, Total Found 4068.
// ---------------------------------------------------------------------------
function seed() {
  const hash = (pw) => bcrypt.hashSync(pw, 8);
  const now = Date.now();

  db.users = [
    {
      id: 'u_superadmin',
      name: 'National Command Centre',
      email: 'superadmin@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'super_admin',
      phone: '1800-110-100',
      org: 'Government of India · NCRB',
      jurisdiction: { level: 'national', state: null, district: null, station: null },
      createdAt: now,
    },
    {
      id: 'u_admin',
      name: 'A. Deshpande (ACP)',
      email: 'admin@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'admin',
      phone: '022-2400-1100',
      org: 'Asst. Commissioner of Police',
      jurisdiction: { level: 'state', state: 'Maharashtra', district: 'Mumbai', station: null },
      createdAt: now,
    },
    {
      id: 'u_police',
      name: 'PSI R. Kamble',
      email: 'police@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'police',
      phone: '022-2570-0100',
      org: 'Powai Police Station',
      jurisdiction: { level: 'station', state: 'Maharashtra', district: 'Mumbai', station: 'Powai PS' },
      createdAt: now,
    },
    {
      id: 'u_parent',
      name: 'Kannaiyan',
      email: 'parent@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'parent',
      phone: '9788197570',
      org: null,
      jurisdiction: { level: 'citizen', state: 'Tamil Nadu', district: 'Perambalur', station: null },
      createdAt: now,
    },
    {
      id: 'u_ngo',
      name: 'Bal Asha Trust',
      email: 'ngo@khozo.org',
      passwordHash: hash('khozo123'),
      role: 'ngo',
      phone: '022-2496-0000',
      org: 'Registered NGO',
      jurisdiction: { level: 'citizen', state: 'Maharashtra', district: 'Mumbai', station: null },
      createdAt: now,
    },
    ...stakeholderUsers(now),
  ];

  const day = 86400000;
  // Missing-child FIRs, drawn from the deck's admin-dashboard table.
  const reportSeed = [
    { childName: 'suresh', parentName: 'kannaiyan', phone: '9788197570', age: 4, gender: 'Male', address: 'kurur, 621104, Perambalur', state: 'Tamil Nadu', district: 'Perambalur', zip: '621104', daysAgo: 320, status: 'found', foundLocation: 'Mumbai', score: 0.94, userType: 'parent' },
    { childName: 'vishi', parentName: 'nema', phone: '1234567890', age: 3, gender: 'Female', address: 'powai, 423452, Ahmednagar', state: 'Maharashtra', district: 'Ahmednagar', zip: '423452', daysAgo: 318, status: 'found', foundLocation: 'Mumbai', score: 0.88, userType: 'parent' },
    { childName: 'dutta', parentName: 'a', phone: '9999998010', age: 3, gender: 'Male', address: 'mtnl, 98, Ahmednagar', state: 'Maharashtra', district: 'Ahmednagar', zip: '414001', daysAgo: 312, status: 'found', foundLocation: 'Mumbai', score: 0.81, userType: 'parent' },
    { childName: 'rohit', parentName: 'm', phone: '1234567098', age: 3, gender: 'Male', address: 'powai, 578657, Ahmednagar', state: 'Maharashtra', district: 'Ahmednagar', zip: '414001', daysAgo: 320, status: 'found', foundLocation: 'Mumbai', score: 0.79, userType: 'parent' },
    { childName: 'Aarav', parentName: 'Sunita', phone: '9012345678', age: 5, gender: 'Male', address: 'fqwe, 23, Ahmednagar', state: 'Maharashtra', district: 'Ahmednagar', zip: '414001', daysAgo: 320, status: 'missing', foundLocation: null, score: 0, userType: 'parent' },
    { childName: 'Meera', parentName: 'Kalpana', phone: '9087654321', age: 5, gender: 'Female', address: 'powai, 356645, Araria', state: 'Bihar', district: 'Araria', zip: '854311', daysAgo: 305, status: 'missing', foundLocation: null, score: 0, userType: 'parent' },
    { childName: 'Imran', parentName: 'Yusuf', phone: '4123567890', age: 3, gender: 'Male', address: 'powai, 400076, Mumbai', state: 'Maharashtra', district: 'Mumbai', zip: '400076', daysAgo: 320, status: 'missing', foundLocation: null, score: 0, userType: 'parent' },
    { childName: 'Priya', parentName: 'Latha', phone: '3214567890', age: 3, gender: 'Female', address: 'belapur, 2424323, Ahmednagar', state: 'Maharashtra', district: 'Ahmednagar', zip: '414001', daysAgo: 322, status: 'missing', foundLocation: null, score: 0, userType: 'police' },
    { childName: 'Ananya', parentName: 'Reema', phone: '9123456780', age: 3, gender: 'Female', address: 'powai, 400075, Ahmednagar', state: 'Maharashtra', district: 'Mumbai', zip: '400075', daysAgo: 60, status: 'missing', foundLocation: null, score: 0, userType: 'parent' },
    { childName: 'Kabir', parentName: 'Farhan', phone: '9870011223', age: 7, gender: 'Male', address: 'Andheri East, Mumbai', state: 'Maharashtra', district: 'Mumbai', zip: '400069', daysAgo: 14, status: 'missing', foundLocation: null, score: 0, userType: 'ngo' },
    { childName: 'Sofia', parentName: 'Maria', phone: '9765512340', age: 9, gender: 'Female', address: 'Panaji', state: 'Goa', district: 'North Goa', zip: '403001', daysAgo: 9, status: 'under_review', foundLocation: 'Margao', score: 0.72, userType: 'police' },
    { childName: 'Dev', parentName: 'Anil', phone: '9811122334', age: 6, gender: 'Male', address: 'Connaught Place', state: 'Delhi', district: 'New Delhi', zip: '110001', daysAgo: 4, status: 'missing', foundLocation: null, score: 0, userType: 'parent' },
  ];

  db.reports = reportSeed.map((r, i) => ({
    id: `r_${i + 1}`,
    firNo: r.status === 'missing' && r.userType !== 'police' ? null : `FIR/${2018 + (i % 6)}/${1000 + i}`,
    childName: r.childName,
    childAadhar: `${4000 + i}-${5000 + i}-${6000 + i}`,
    gender: r.gender,
    age: r.age,
    height: 90 + r.age * 5,
    weight: 12 + r.age * 2,
    dateOfMissing: new Date(now - r.daysAgo * day).toISOString(),
    photoUrl: null,
    status: r.status, // missing | under_review | found
    parentName: r.parentName,
    parentPhone: r.phone,
    parentEmail: null,
    address: r.address,
    state: r.state,
    district: r.district,
    zip: r.zip,
    foundLocation: r.foundLocation,
    matchScore: r.score,
    smsSent: r.status === 'found',
    registeredByRole: r.userType,
    registeredById: r.userType === 'police' ? 'u_police' : r.userType === 'ngo' ? 'u_ngo' : 'u_parent',
    createdAt: now - r.daysAgo * day,
  }));

  // Public "I spotted a child" uploads (deck: capture → locate → submit).
  db.foundReports = [
    {
      id: 'f_1',
      photoUrl: null,
      foundLocation: '17-A, Powai Internal Rd, Vikhroli West, Mumbai 400076',
      lat: 19.1183, lng: 72.9056,
      reporterName: 'A. Public',
      reporterPhone: '9000000001',
      note: 'found at powai, near Biryani House',
      matchedReportId: 'r_2',
      matchScore: 0.88,
      status: 'matched',
      createdAt: now - 318 * day,
    },
    {
      id: 'f_2',
      photoUrl: null,
      foundLocation: 'Margao Municipal Market, Goa',
      lat: 15.2832, lng: 73.9862,
      reporterName: 'NGO Volunteer',
      reporterPhone: '9000000002',
      note: 'Girl seen alone near market, approx 9 yrs',
      matchedReportId: 'r_11',
      matchScore: 0.72,
      status: 'pending_review',
      createdAt: now - 9 * day,
    },
    mumbaiStakeholderSighting(now),
  ];

  db.activity = [
    { id: 'a_1', ts: now - 3600000, actor: 'PSI R. Kamble', action: 'Confirmed match & alerted parent', target: 'suresh', icon: 'check', scope: { state: 'Tamil Nadu', district: 'Perambalur', reportId: 'r_1' } },
    { id: 'a_2', ts: now - 7200000, actor: 'A. Public', action: 'Uploaded a spotted-child photo', target: 'Powai, Mumbai', icon: 'upload', scope: { state: 'Maharashtra', district: 'Mumbai', matchedReportId: 'r_8' } },
    { id: 'a_3', ts: now - 86400000, actor: 'Bal Asha Trust', action: 'Registered a missing child', target: 'Kabir', icon: 'plus', actorId: 'u_ngo', scope: { state: 'Maharashtra', district: 'Mumbai', reportId: 'r_10' } },
    { id: 'a_4', ts: now - 2 * 86400000, actor: 'A. Deshpande (ACP)', action: 'Reviewed jurisdiction caseload', target: 'Mumbai', icon: 'eye', scope: { state: 'Maharashtra', district: 'Mumbai' } },
  ];
  db.audit = [
    {
      id: 'audit_1',
      ts: now - 3600000,
      actorId: 'u_police',
      actorName: 'PSI R. Kamble',
      actorRole: 'police',
      action: 'case.match_confirmed',
      targetType: 'report',
      targetId: 'r_1',
      summary: 'Confirmed match and alerted parent for suresh',
      scope: { state: 'Tamil Nadu', district: 'Perambalur' },
    },
  ];
  normalizeAuditChain();

  persist();
}

export function init() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.users ||= [];
      db.reports ||= [];
      db.foundReports ||= [];
      db.grievances ||= [];
      db.activity ||= [];
      db.audit ||= [];
      ensureStakeholderUsers();
      ensureStakeholderDemoData();
      ensureActivityScopes();
      ensureSeedOwnership();
      if (normalizeAuditChain()) persist();
      return;
    } catch {
      // fall through to reseed on corrupt file
    }
  }
  seed();
}

// These headline counts come from the deck; live records are layered on top so the
// numbers stay believable while the seeded/added records drive the tables and charts.
export const BASE_TOTAL_MISSING = 10468;
export const BASE_TOTAL_FOUND = 4068;

// --- Users ---
export const findUserByEmail = (email) =>
  db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
export const findUserById = (id) => db.users.find((u) => u.id === id);
export const listUsers = () => db.users;
export function addUser(user) {
  db.users.push(user);
  persist();
  return user;
}
export function updateUser(id, patch) {
  const user = findUserById(id);
  if (!user) return null;
  Object.assign(user, patch);
  persist();
  return user;
}

// --- Reports (missing children / FIRs) ---
export const listReports = () => db.reports;
export const findReport = (id) => db.reports.find((r) => r.id === id);
export function addReport(report) {
  db.reports.unshift(report);
  persist();
  return report;
}
export function updateReport(id, patch) {
  const r = findReport(id);
  if (!r) return null;
  Object.assign(r, patch);
  persist();
  return r;
}

// --- Found reports (public uploads) ---
export const listFoundReports = () => db.foundReports;
export const findFoundReport = (id) => db.foundReports.find((f) => f.id === id);
export function addFoundReport(fr) {
  db.foundReports.unshift(fr);
  persist();
  return fr;
}
export function updateFoundReport(id, patch) {
  const f = findFoundReport(id);
  if (!f) return null;
  Object.assign(f, patch);
  persist();
  return f;
}

// --- Grievances / feedback ---
export const listGrievances = () => db.grievances;
export const findGrievance = (id) => db.grievances.find((g) => g.id === id);
export function addGrievance(grievance) {
  db.grievances.unshift(grievance);
  persist();
  return grievance;
}
export function updateGrievance(id, patch) {
  const g = findGrievance(id);
  if (!g) return null;
  Object.assign(g, patch);
  persist();
  return g;
}

// --- Activity feed ---
export const listActivity = () => db.activity;
export function addActivity(entry) {
  db.activity.unshift({ id: `a_${Date.now()}`, ts: Date.now(), ...entry });
  if (db.activity.length > 50) db.activity.length = 50;
  persist();
}

// --- Operational audit log ---
export const listAudit = () => db.audit;
export function verifyAuditChain(rows = db.audit) {
  const chronological = rows.slice().reverse();
  let prevHash = null;
  let checked = 0;
  for (const row of chronological) {
    const expected = auditHash(row, prevHash);
    if (row.prevHash !== prevHash || row.hash !== expected) {
      return {
        ok: false,
        checked,
        failedId: row.id,
        expectedHash: expected,
        actualHash: row.hash || null,
        expectedPrevHash: prevHash,
        actualPrevHash: row.prevHash || null,
      };
    }
    prevHash = row.hash;
    checked++;
  }
  return { ok: true, checked, headHash: prevHash };
}

export function addAudit(entry) {
  const prevHash = db.audit[0]?.hash || null;
  const row = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    actorId: entry.actorId || null,
    actorName: entry.actorName || 'System',
    actorRole: entry.actorRole || 'system',
    action: entry.action,
    targetType: entry.targetType || null,
    targetId: entry.targetId || null,
    summary: entry.summary || '',
    scope: entry.scope || {},
    metadata: entry.metadata || {},
    prevHash,
  };
  row.hash = auditHash(row, prevHash);
  db.audit.unshift(row);
  if (db.audit.length > 500) db.audit.length = 500;
  persist();
  return row;
}
