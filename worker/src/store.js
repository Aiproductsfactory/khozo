import crypto from 'node:crypto';
import path from 'node:path';
import { query, upsertRecord, savePhotoBlob, readPhotoBlob, deletePhotoBlob, photoBlobStats } from './db.js';

export const BASE_TOTAL_MISSING = 10468;
export const BASE_TOTAL_FOUND = 4068;

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

// User methods
export async function listUsers(env) {
  const { rows } = await query(env, 'select data from public.users');
  return rows.map((r) => r.data);
}

export async function findUserById(env, id) {
  if (!id) return null;
  const { rows } = await query(env, 'select data from public.users where id = $1 or data->>\'id\' = $1 limit 1', [id]);
  return rows.length ? rows[0].data : null;
}

export async function findUserByEmail(env, email) {
  if (!email) return null;
  const clean = String(email).trim().toLowerCase();
  const { rows } = await query(
    env,
    'select data from public.users where lower(email) = $1 or lower(data->>\'email\') = $1 limit 1',
    [clean]
  );
  return rows.length ? rows[0].data : null;
}

export async function addUser(env, user) {
  await upsertRecord(env, 'users', user);
  return user;
}

export async function updateUser(env, id, patch) {
  const user = await findUserById(env, id);
  if (!user) return null;
  const updated = { ...user, ...patch };
  await upsertRecord(env, 'users', updated);
  return updated;
}

// Report methods
export async function listReports(env) {
  const { rows } = await query(env, 'select data from public.reports order by created_at desc');
  return rows.map((r) => r.data);
}

export async function findReport(env, queryStr) {
  if (!queryStr) return null;
  const { rows } = await query(
    env,
    'select data from public.reports where id = $1 or photo_file = $1 or data->>\'id\' = $1 or data->>\'photoFile\' = $1 limit 1',
    [queryStr]
  );
  return rows.length ? rows[0].data : null;
}

export async function addReport(env, report) {
  await upsertRecord(env, 'reports', report);
  return report;
}

export async function updateReport(env, id, patch) {
  const report = await findReport(env, id);
  if (!report) return null;
  const updated = { ...report, ...patch };
  await upsertRecord(env, 'reports', updated);
  return updated;
}

// Found report (sighting) methods
export async function listFoundReports(env) {
  const { rows } = await query(env, 'select data from public.found_reports order by created_at desc');
  return rows.map((r) => r.data);
}

export async function findFoundReport(env, queryStr) {
  if (!queryStr) return null;
  const { rows } = await query(
    env,
    'select data from public.found_reports where id = $1 or photo_file = $1 or data->>\'id\' = $1 or data->>\'photoFile\' = $1 limit 1',
    [queryStr]
  );
  return rows.length ? rows[0].data : null;
}

export async function addFoundReport(env, report) {
  await upsertRecord(env, 'found_reports', report);
  return report;
}

export async function updateFoundReport(env, id, patch) {
  const report = await findFoundReport(env, id);
  if (!report) return null;
  const updated = { ...report, ...patch };
  await upsertRecord(env, 'found_reports', updated);
  return updated;
}

// Grievance methods
export async function listGrievances(env) {
  const { rows } = await query(env, 'select data from public.grievances order by created_at desc');
  return rows.map((r) => r.data);
}

export async function findGrievance(env, id) {
  const { rows } = await query(env, 'select data from public.grievances where id = $1', [id]);
  return rows.length ? rows[0].data : null;
}

export async function addGrievance(env, grievance) {
  await upsertRecord(env, 'grievances', grievance);
  return grievance;
}

export async function updateGrievance(env, id, patch) {
  const g = await findGrievance(env, id);
  if (!g) return null;
  const updated = { ...g, ...patch };
  await upsertRecord(env, 'grievances', updated);
  return updated;
}

// Activity log methods
export async function listActivity(env) {
  const { rows } = await query(env, 'select data from public.activity order by ts desc');
  return rows.map((r) => r.data);
}

export async function addActivity(env, act) {
  const entry = { id: act.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), ...act };
  await upsertRecord(env, 'activity', entry);
  return entry;
}

// Audit log methods
export async function listAudit(env) {
  const { rows } = await query(env, 'select data from public.audit order by ts desc');
  return rows.map((r) => r.data);
}

export async function addAudit(env, entry) {
  const { rows } = await query(env, 'select data from public.audit order by ts desc limit 1');
  const prevHash = rows.length ? rows[0].data?.hash || null : null;
  const row = {
    id: entry.id || `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    ...entry,
    prevHash,
  };
  row.hash = auditHash(row, prevHash);
  await upsertRecord(env, 'audit', row);
  return row;
}

export async function verifyAuditChain(env) {
  const auditRows = await listAudit(env);
  const chronological = auditRows.slice().reverse();
  let prevHash = null;
  for (const row of chronological) {
    const expected = auditHash(row, prevHash);
    if (row.prevHash !== prevHash || row.hash !== expected) {
      return { valid: false, brokenAt: row.id };
    }
    prevHash = row.hash;
  }
  return { valid: true, count: auditRows.length };
}

// Photo storage methods
export async function savePhoto(env, filename, buffer, mime) {
  await savePhotoBlob(env, filename, buffer, mime);
  return filename;
}

export async function readPhoto(env, filename) {
  const res = await readPhotoBlob(env, filename);
  return res ? res.buffer : null;
}

export function photoMimeType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}
