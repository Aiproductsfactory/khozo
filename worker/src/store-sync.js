/**
 * A synchronous, per-request replica of the Khozo dataset.
 *
 * The shared route handlers read data synchronously — often inside `.filter()`
 * callbacks in the jurisdiction-scoping helpers, which is the code least worth
 * rewriting in a child-protection system. The Express API gets that by holding
 * the dataset in memory for the process's lifetime. A Worker isolate cannot
 * safely do the same (it may be recycled or duplicated between requests, and a
 * stale cache would show one officer a case another has already closed), so the
 * dataset is hydrated per request instead, mutated in memory, and written back
 * before the response is released.
 *
 * At pilot volume this is six SELECTs over a Hyperdrive-pooled connection. It is
 * the right trade at district or state scale; past roughly 10^5 cases the reads
 * need to become real queries.
 */

import crypto from 'node:crypto';
import path from 'node:path';

import { query, upsertRecord, savePhotoBlob, readPhotoBlob, photoBlobStats } from './db.js';

export function photoMimeType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
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
  return crypto.createHash('sha256').update(JSON.stringify(stable(auditPayload(row, prevHash)))).digest('hex');
}

const norm = (v) => String(v || '').trim().toLowerCase();

/** Real Postgres access. Tests substitute this to run without a database. */
const POSTGRES = { query, upsertRecord, savePhotoBlob, readPhotoBlob, photoBlobStats };

/**
 * Hydrates the dataset and returns the synchronous store the shared routes use,
 * plus a `flush` that persists everything the request changed.
 */
export async function createRequestStore(env, ctx, io = POSTGRES) {
  const [users, reports, foundReports, grievances, activity, audit] = await Promise.all([
    io.query(env, 'select data from public.users'),
    io.query(env, 'select data from public.reports order by created_at desc nulls last'),
    io.query(env, 'select data from public.found_reports order by created_at desc nulls last'),
    io.query(env, 'select data from public.grievances order by created_at desc nulls last'),
    io.query(env, 'select data from public.activity order by ts desc'),
    io.query(env, 'select data from public.audit order by ts desc'),
  ]).then((results) => results.map((r) => r.rows.map((row) => row.data).filter(Boolean)));

  // Notifications are read for one officer at a time, so unlike the tables
  // above they are fetched per request rather than hydrated wholesale — the
  // fan-out is one row per authority per sighting and grows fastest of all.
  const db = { users, reports, foundReports, grievances, activity, audit, notifications: [] };
  let notificationsLoaded = false;
  async function loadNotifications(userId) {
    if (notificationsLoaded) return db.notifications;
    const { rows } = await io.query(
      env,
      'select data from public.notifications where user_id = $1 order by ts desc limit 200',
      [userId]
    );
    db.notifications = rows.map((row) => row.data).filter(Boolean);
    notificationsLoaded = true;
    return db.notifications;
  }

  // Records touched during this request, by table, so the flush writes only what
  // changed rather than the whole dataset.
  const dirty = new Map();
  const markDirty = (table, record) => {
    if (!record?.id) return record;
    if (!dirty.has(table)) dirty.set(table, new Map());
    dirty.get(table).set(record.id, record);
    return record;
  };

  /** Replaces a record in its array so later reads in the same request see it. */
  function replace(rows, id, updated) {
    const index = rows.findIndex((r) => r.id === id);
    if (index >= 0) rows[index] = updated;
    else rows.unshift(updated);
    return updated;
  }

  const store = {
    // --- Users ---
    listUsers: () => db.users,
    findUserById: (id) => (id ? db.users.find((u) => u.id === id) || null : null),
    findUserByEmail: (email) => (email ? db.users.find((u) => norm(u.email) === norm(email)) || null : null),
    addUser(user) {
      db.users.unshift(user);
      return markDirty('users', user);
    },
    updateUser(id, patch) {
      const user = store.findUserById(id);
      if (!user) return null;
      return markDirty('users', replace(db.users, id, { ...user, ...patch }));
    },

    // --- Missing-child reports ---
    listReports: () => db.reports,
    findReport: (ref) =>
      ref ? db.reports.find((r) => r.id === ref || r.photoFile === ref) || null : null,
    addReport(report) {
      db.reports.unshift(report);
      return markDirty('reports', report);
    },
    updateReport(id, patch) {
      const report = store.findReport(id);
      if (!report) return null;
      return markDirty('reports', replace(db.reports, report.id, { ...report, ...patch }));
    },

    // --- Sightings ---
    listFoundReports: () => db.foundReports,
    findFoundReport: (ref) =>
      ref ? db.foundReports.find((f) => f.id === ref || f.photoFile === ref) || null : null,
    addFoundReport(found) {
      db.foundReports.unshift(found);
      return markDirty('found_reports', found);
    },
    updateFoundReport(id, patch) {
      const found = store.findFoundReport(id);
      if (!found) return null;
      return markDirty('found_reports', replace(db.foundReports, found.id, { ...found, ...patch }));
    },

    // --- Grievances ---
    listGrievances: () => db.grievances,
    findGrievance: (id) => (id ? db.grievances.find((g) => g.id === id) || null : null),
    addGrievance(grievance) {
      db.grievances.unshift(grievance);
      return markDirty('grievances', grievance);
    },
    updateGrievance(id, patch) {
      const grievance = store.findGrievance(id);
      if (!grievance) return null;
      return markDirty('grievances', replace(db.grievances, id, { ...grievance, ...patch }));
    },

    // --- Authority notifications ---
    async listNotifications(userId) {
      const rows = await loadNotifications(userId);
      return rows.slice().sort((a, b) => b.ts - a.ts);
    },
    addNotification(entry) {
      const row = {
        id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        readAt: null,
        ...entry,
      };
      db.notifications.unshift(row);
      return markDirty('notifications', row);
    },
    async markNotificationsRead(userId, ids = null) {
      const rows = await loadNotifications(userId);
      const now = Date.now();
      const touched = [];
      for (const row of rows) {
        if (row.readAt) continue;
        if (ids && !ids.includes(row.id)) continue;
        row.readAt = now;
        markDirty('notifications', row);
        touched.push(row.id);
      }
      return touched;
    },

    // --- Activity feed ---
    listActivity: () => db.activity,
    addActivity(entry) {
      const row = { id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), ...entry };
      db.activity.unshift(row);
      return markDirty('activity', row);
    },

    // --- Tamper-evident audit log ---
    listAudit: () => db.audit,
    addAudit(entry) {
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
      return markDirty('audit', row);
    },
    verifyAuditChain(rows = db.audit) {
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
    },

    // --- Photo blobs ---
    async savePhoto(key, buffer, mime) {
      await io.savePhotoBlob(env, key, buffer, mime || 'image/jpeg', ctx);
      return key;
    },
    async readPhoto(key) {
      const blob = await io.readPhotoBlob(env, key, ctx);
      return blob ? blob.buffer : null;
    },
    photoMimeType,
    photoBlobStats: () => io.photoBlobStats(env, ctx),
  };

  /**
   * Persists every record the request changed. Audit rows go last so a partial
   * failure cannot leave the hash chain ahead of the data it describes.
   */
  async function flush() {
    const order = ['users', 'reports', 'found_reports', 'grievances', 'notifications', 'activity', 'audit'];
    for (const table of order) {
      const rows = dirty.get(table);
      if (!rows?.size) continue;
      for (const record of rows.values()) {
        // eslint-disable-next-line no-await-in-loop
        await io.upsertRecord(env, table, record, ctx);
      }
    }
    dirty.clear();
  }

  return { store, flush, hasWrites: () => dirty.size > 0 };
}
