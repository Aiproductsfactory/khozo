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
import { auditHead, verifyAuditLinks } from '../../shared/audit-chain.js';
import path from 'node:path';

import {
  query,
  upsertRecord,
  upsertMany,
  readVersioned,
  updateIfVersion,
  savePhotoBlob,
  readPhotoBlob,
  deletePhotoBlob,
  photoBlobStats,
} from './db.js';

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
const POSTGRES = { query, upsertRecord, upsertMany, readVersioned, updateIfVersion, savePhotoBlob, readPhotoBlob, deletePhotoBlob, photoBlobStats };

/** The tables a replica holds whole, and how each is read. */
const HYDRATED = {
  users: 'select data from public.users',
  reports: 'select data from public.reports order by created_at desc nulls last',
  foundReports: 'select data from public.found_reports order by created_at desc nulls last',
  grievances: 'select data from public.grievances order by created_at desc nulls last',
  videoJobs: 'select data from public.video_jobs order by created_at desc nulls last',
  activity: 'select data from public.activity order by ts desc',
  audit: 'select data from public.audit order by ts desc',
};
const ALL_TABLES = Object.keys(HYDRATED);

/**
 * CCTV checks from the desktop app keep every face they sent, so a long check
 * is a large row and the table grows with every check. A request reads them
 * whole only to anonymise a case (the retention routes and the nightly run).
 * The check routes read the one case's checks; the command centre reads every
 * check without its per-face batches; every other request reads none.
 */
const VIDEO_JOBS_OF_CASE = 'videoJobsOfCase';
const VIDEO_JOB_SUMMARIES = 'videoJobSummaries';
const VIDEO_JOB_VIEWS = {
  [VIDEO_JOBS_OF_CASE]: 'select data from public.video_jobs where report_id = $1 order by created_at desc nulls last',
  [VIDEO_JOB_SUMMARIES]: "select data - 'batches' as data from public.video_jobs order by created_at desc nulls last",
};
/** What a request reads when no rule below says otherwise: everything but the CCTV checks. */
const DEFAULT_TABLES = ALL_TABLES.filter((name) => name !== 'videoJobs');

/**
 * `auditTail` in a request's tables: only the newest audit rows, enough to
 * append to the chain without reading all of it. The chain's head is the
 * newest row nothing follows (shared/audit-chain.js auditHead), and a row
 * that follows another is always newer, so the newest rows hold it. Listing
 * the log or checking the chain from them is refused.
 */
const AUDIT_TAIL = 'auditTail';
const AUDIT_TAIL_SQL = 'select data from public.audit order by ts desc limit 64';

/**
 * Requests that are answered from part of the replica.
 *
 * The alert inbox is polled every twenty seconds by every open console and by
 * the officer app, and it reads only the signed-in account and that account's
 * own alerts. Loading every case, sighting and audit row for it was most of
 * the Worker's CPU, and on the Free plan's 10 ms limit most of the requests
 * that limit cut off (20 Oct 2026: 457 of 776 in a day).
 */
const PARTIAL = [
  { method: 'GET', path: '/api/dashboard/notifications', tables: ['users'] },
  // The officer app registering its phone for alerts, and the test alert.
  { method: 'POST', path: '/api/dashboard/push-token', tables: ['users'] },
  { method: 'POST', path: '/api/dashboard/push-token/remove', tables: ['users'] },
  { method: 'POST', path: '/api/dashboard/push-test', tables: ['users'] },
  // A photo (GET /api/reports/photo/:key): whose record it is, and who is
  // asking. The Sightings page asks for one per sighting and per case, thirty
  // or more at once, and each loaded every grievance, activity and audit row
  // only to send one image - 2.9 s a photo against 1.3 s for the inbox poll
  // (22 Oct 2026), and some photos not there after half a minute.
  { method: 'GET', prefix: '/api/reports/photo/', tables: ['users', 'reports', 'foundReports'] },
  // Searching a video for one person (POST /api/reports/:id/video-search):
  // up to sixty requests a search, each needing only the officer, the case
  // and the end of the audit chain to append its record to.
  { method: 'POST', pattern: /^\/api\/reports\/[^/]+\/video-search$/, tables: ['users', 'reports', AUDIT_TAIL] },
  // A CCTV check from the desktop app (POST /api/reports/:id/video-jobs, and
  // its faces, progress and close): the officer, the case, the case's checks
  // and the end of the audit chain. A decision can make a sighting, so it
  // loads everything else too.
  { method: 'POST', pattern: /^\/api\/reports\/[^/]+\/video-jobs(\/[^/]+\/(faces|progress|close))?$/, tables: ['users', 'reports', VIDEO_JOBS_OF_CASE, AUDIT_TAIL] },
  { method: 'POST', pattern: /^\/api\/reports\/[^/]+\/video-jobs\/[^/]+\/decisions$/, tables: [...DEFAULT_TABLES, VIDEO_JOBS_OF_CASE] },
  { method: 'GET', pattern: /^\/api\/reports\/[^/]+\/video-jobs$/, tables: ['users', 'reports', VIDEO_JOBS_OF_CASE] },
  // The command centre's CCTV checks page: the checks of the cases the desk can see, without their batches.
  { method: 'GET', path: '/api/dashboard/video-checks', tables: ['users', 'reports', VIDEO_JOB_SUMMARIES] },
  // Anonymising a case also anonymises its checks (shared/retention.js).
  { method: 'POST', prefix: '/api/dashboard/privacy/retention', tables: ALL_TABLES },
];

/** Which tables a request needs hydrated: everything but the CCTV checks, unless listed above. */
export function tablesForRequest(method, pathname) {
  const route = PARTIAL.find((r) => r.method === method && (
    r.pattern ? r.pattern.test(pathname) : r.prefix ? pathname.startsWith(r.prefix) : r.path === pathname
  ));
  return route ? route.tables : DEFAULT_TABLES;
}

/** The case a CCTV check request is about, for reading only that case's checks. */
export function reportIdOf(pathname) {
  const m = /^\/api\/reports\/([^/]+)\/video-jobs/.exec(pathname || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

/**
 * Hydrates the dataset and returns the synchronous store the shared routes use,
 * plus a `flush` that persists everything the request changed.
 *
 * `tables` limits the hydrate to the named tables. A table left out is not an
 * empty table: touching it throws, so a route that starts reading or writing
 * one fails loudly rather than answering from an empty list, or appending an
 * audit row to a chain it cannot see.
 */
export async function createRequestStore(env, ctx, io = POSTGRES, { tables: requested = ALL_TABLES, reportId = null } = {}) {
  // Only the end of the audit chain, unless the whole of it is loaded anyway.
  const auditTailOnly = requested.includes(AUDIT_TAIL) && !requested.includes('audit');
  // Part of the CCTV checks (VIDEO_JOB_VIEWS), unless the whole table is loaded anyway.
  const videoView = requested.includes('videoJobs') ? null : requested.find((name) => VIDEO_JOB_VIEWS[name]) || null;
  if (videoView === VIDEO_JOBS_OF_CASE && !reportId) throw new Error('Reading one case\'s CCTV checks needs the case');
  const tables = requested.filter((name) => name !== AUDIT_TAIL && !VIDEO_JOB_VIEWS[name]);
  const unknown = tables.filter((name) => !HYDRATED[name]);
  if (unknown.length) throw new Error(`Unknown store table: ${unknown.join(', ')}`);
  // The CCTV checks' table comes with server/sql/003_video_jobs.sql. A Worker
  // deployed before that has run reads it as empty and offers no CCTV check
  // routes (they answer 501, and the desktop app uses the browser's route),
  // rather than failing every request that loads all tables.
  const missing = new Set();
  const reads = [...tables, ...(auditTailOnly ? [AUDIT_TAIL] : []), ...(videoView ? [videoView] : [])];
  const loaded = await Promise.all(
    reads.map((name) => io
      .query(env, name === AUDIT_TAIL ? AUDIT_TAIL_SQL : VIDEO_JOB_VIEWS[name] || HYDRATED[name], name === VIDEO_JOBS_OF_CASE ? [reportId] : undefined)
      .then((r) => r.rows.map((row) => row.data).filter(Boolean))
      .catch((err) => {
        if (!(name === 'videoJobs' || VIDEO_JOB_VIEWS[name]) || err?.code !== '42P01') throw err; // 42P01: no such table
        missing.add('videoJobs');
        return [];
      }))
  );
  const auditTail = auditTailOnly ? loaded[reads.indexOf(AUDIT_TAIL)] : null;
  const videoRows = videoView ? loaded[reads.indexOf(videoView)] : null;

  // Notifications are read for one officer at a time, so unlike the tables
  // above they are fetched per request rather than hydrated wholesale — the
  // fan-out is one row per authority per sighting and grows fastest of all.
  const db = { notifications: [] };
  for (const name of ALL_TABLES) {
    const index = tables.indexOf(name);
    if (index >= 0) db[name] = loaded[index];
    else if (name === 'audit' && auditTail) db.audit = auditTail;
    else if (name === 'videoJobs' && videoRows) db.videoJobs = videoRows;
    else {
      Object.defineProperty(db, name, {
        get() {
          throw new Error(`The ${name} table was not loaded for this request`);
        },
      });
    }
  }
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
  // The command centre reads checks without their batches (VIDEO_JOB_SUMMARIES): writing one back would lose them.
  const readOnlyChecks = () => {
    if (videoView === VIDEO_JOB_SUMMARIES) throw new Error('These CCTV checks were read without their batches and cannot be changed in this request');
  };
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

    /**
     * Changes a sighting only if it is still what the caller decided on,
     * checked and written in one step against the database rather than this
     * request's copy.
     *
     * For the reverse search (shared/routes/reports.js matchStoredSightings),
     * which decides to link a sighting seconds after this replica was read,
     * after a round of face comparisons. Meanwhile another request may have
     * linked the same sighting to another case, an officer may have rejected
     * it, recorded a CWC follow-up, or anonymised it. The flush writes whole
     * rows, so linking from the stale copy would silently undo that work, and
     * undo an anonymisation by writing the reporter's name and phone back.
     *
     * So: read the row as it is now; if `isEligible` no longer holds, leave it
     * (and refresh this request's copy); otherwise write `makePatch(row)` over
     * it on condition that it has not changed since that read. The write is
     * made here, not at the flush, and the row is not left dirty, so the flush
     * cannot write it a second time. Returns the linked row, or null.
     */
    async claimFoundReport(id, makePatch, isEligible = () => true) {
      const local = store.findFoundReport(id);
      if (!local) return null;
      // Added or already changed by this request: there is no other copy of
      // these changes to race with, so the replica is the truth.
      if (dirty.get('found_reports')?.has(local.id)) {
        if (!isEligible(local)) return null;
        return store.updateFoundReport(local.id, makePatch(local));
      }
      const current = await io.readVersioned(env, 'found_reports', local.id, ctx);
      if (!current) return null;
      replace(db.foundReports, local.id, current.data);
      if (!isEligible(current.data)) return null;
      const linked = { ...current.data, ...makePatch(current.data) };
      const written = await io.updateIfVersion(env, 'found_reports', linked, current.version, ctx);
      if (!written) return null;
      return replace(db.foundReports, local.id, linked);
    },

    /**
     * As claimFoundReport, for a case: writes `makePatch(row)` over the case
     * row as it is now, only if `isEligible` still holds and nobody changed
     * the row since it was read. For a change to a case's photos, which runs
     * for seconds (face checks) while another officer may change them too.
     */
    async claimReport(id, makePatch, isEligible = () => true) {
      const local = store.findReport(id);
      if (!local) return null;
      if (dirty.get('reports')?.has(local.id)) {
        if (!isEligible(local)) return null;
        return store.updateReport(local.id, makePatch(local));
      }
      const current = await io.readVersioned(env, 'reports', local.id, ctx);
      if (!current) return null;
      replace(db.reports, local.id, current.data);
      if (!isEligible(current.data)) return null;
      const written = { ...current.data, ...makePatch(current.data) };
      if (!(await io.updateIfVersion(env, 'reports', written, current.version, ctx))) return null;
      return replace(db.reports, local.id, written);
    },

    // --- CCTV checks from the desktop app (shared/video-jobs.js) ---
    listVideoJobs: () => db.videoJobs,
    findVideoJob: (id) => (id ? db.videoJobs.find((j) => j.id === id) || null : null),
    addVideoJob(job) {
      readOnlyChecks();
      db.videoJobs.unshift(job);
      return markDirty('video_jobs', job);
    },
    updateVideoJob(id, patch) {
      readOnlyChecks();
      const job = store.findVideoJob(id);
      if (!job) return null;
      return markDirty('video_jobs', replace(db.videoJobs, id, { ...job, ...patch }));
    },
    /**
     * Changes a check from its stored version, not this request's copy: the
     * laptop sends one check faces for two videos, its progress and a
     * decision at the same time, and writing back the whole record read at
     * the start would undo the others. Compare-and-set, tried again when
     * another request got there first.
     */
    async changeVideoJob(id, makePatch) {
      readOnlyChecks();
      const local = store.findVideoJob(id);
      if (!local) return null;
      // Added or already changed by this request: there is no other copy to race with.
      if (dirty.get('video_jobs')?.has(local.id)) return store.updateVideoJob(id, makePatch(local));
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const current = await io.readVersioned(env, 'video_jobs', id, ctx);
        if (!current) return null;
        const written = { ...current.data, ...makePatch(current.data) };
        if (await io.updateIfVersion(env, 'video_jobs', written, current.version, ctx)) return replace(db.videoJobs, id, written);
      }
      throw new Error('This check is being changed by several requests at once. Try again.');
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
    /** `fn(row)` returns the fields to change, or null (see server/src/store.js). */
    rewriteActivity(fn) {
      let changed = 0;
      for (const row of db.activity) {
        const patch = fn(row);
        if (!patch) continue;
        Object.assign(row, patch);
        markDirty('activity', row);
        changed += 1;
      }
      return changed;
    },

    // --- Tamper-evident audit log ---
    listAudit: () => {
      if (auditTailOnly) throw new Error('Only the end of the audit table was loaded for this request');
      return db.audit;
    },
    addAudit(entry) {
      const prevHash = auditHead(db.audit);
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
    verifyAuditChain(rows) {
      if (rows === undefined && auditTailOnly) throw new Error('Only the end of the audit table was loaded for this request');
      rows = rows ?? db.audit;
      return verifyAuditLinks(rows, auditHash);
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
    /** Deletes a photograph's bytes: anonymisation, retention, a replaced photo. */
    async deletePhoto(key) {
      if (!key || typeof io.deletePhotoBlob !== 'function') return false;
      return io.deletePhotoBlob(env, String(key), ctx);
    },
    photoMimeType,
    photoBlobStats: () => io.photoBlobStats(env, ctx),
  };

  /**
   * Persists every record the request changed. Audit rows go last so a partial
   * failure cannot leave the hash chain ahead of the data it describes.
   */
  async function flush() {
    const order = ['users', 'reports', 'found_reports', 'grievances', 'video_jobs', 'notifications', 'activity', 'audit'];
    for (const table of order) {
      const rows = dirty.get(table);
      if (!rows?.size) continue;
      // eslint-disable-next-line no-await-in-loop
      await io.upsertMany(env, table, [...rows.values()], ctx);
    }
    dirty.clear();
  }

  if (missing.has('videoJobs')) {
    for (const name of ['listVideoJobs', 'findVideoJob', 'addVideoJob', 'updateVideoJob', 'changeVideoJob']) store[name] = null;
  }
  return { store, flush, hasWrites: () => dirty.size > 0 };
}
