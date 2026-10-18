// Scheduled operations: health checks with alerts, and the nightly backup.
//
// Outages used to be invisible. /api/health answered "ok" without touching the
// database, and a face provider that failed for hours (the 3 September key
// incident, worker/src/match.js) showed up only when someone noticed matches
// had stopped. The Worker now checks itself every 15 minutes and tells the
// super admins when something is wrong: an in-app alert always, and an e-mail
// when the Email Sending binding (EMAIL) and KHOZO_ALERT_EMAIL are configured.
//
// State lives in the notifications table: an alert for a given problem is not
// raised again while an unread one for the same problem, less than six hours
// old, is still waiting. That keeps a long outage to a few alerts, not one
// every quarter of an hour, without a table of its own.
import * as db from './db.js';
import { matchEngineInfo } from './match.js';
import { createRequestStore } from './store-sync.js';
import { createFaceIndex } from '../../shared/face-index.js';
import { runRetentionSweep } from '../../shared/retention.js';

// Secrets arrive as typed; a stray byte-order mark once broke a key for hours.
const cleanSecret = (value) => String(value || '').replace(/^﻿/, '').trim();

const AARAKSHAK_API_URL = 'https://aarakshak.com/api/v1/compare';
const ALERT_KIND = 'ops_alert';
const REALERT_AFTER_MS = 6 * 60 * 60 * 1000;
const BACKUP_KEEP_DAYS = 35;

// A 1x1 JPEG: enough for the provider to answer, so the check proves the
// endpoint is reachable and the key accepted without sending anyone's photo.
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function bytesFromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function timed(fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - started, detail };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, detail: String(err?.message || err).slice(0, 300) };
  }
}

/** The database answers a trivial query. Used by /api/health and the checks. */
export async function checkDatabase(env, ctx, io = db) {
  return timed(async () => {
    const { rows } = await io.query(env, 'select 1 as ok', [], ctx);
    if (rows?.[0]?.ok !== 1) throw new Error('unexpected answer');
    return 'answered';
  });
}

async function checkAarakshak(env) {
  const key = cleanSecret(env?.AARAKSHAK_API_KEY);
  if (!key) return { ok: false, ms: 0, detail: 'AARAKSHAK_API_KEY is not set' };
  return timed(async () => {
    const form = new FormData();
    const img = new Blob([bytesFromB64(TINY_JPEG_B64)], { type: 'image/jpeg' });
    form.append('source', img, 'probe.jpg');
    form.append('target', img, 'probe.jpg');
    const res = await fetch(AARAKSHAK_API_URL, {
      method: 'POST',
      headers: { 'X-API-Key': key },
      body: form,
      signal: AbortSignal.timeout(10000),
    });
    // A 4xx about the image (no face in a 1x1 picture) still proves the service
    // is up and the key accepted; refusing the key or failing is the problem.
    if (res.status === 401 || res.status === 403) throw new Error(`key refused (HTTP ${res.status})`);
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });
}

async function checkReviewBacklog(env, ctx, io) {
  return timed(async () => {
    const { rows } = await io.query(
      env,
      `select count(*)::int as n from public.found_reports
        where status = 'pending_review' and created_at < now() - interval '48 hours'`,
      [],
      ctx,
    );
    const n = rows?.[0]?.n || 0;
    if (n > 0) throw new Error(`${n} possible match(es) waiting for police review for more than 48 hours`);
    return 'no overdue reviews';
  });
}

async function checkSilentMatching(env, ctx, io) {
  // Photos received in the last 24 hours that no face engine compared, while
  // an engine is configured: the signature of a quiet provider outage.
  if (!matchEngineInfo(env).aarakshakConfigured) return { ok: true, ms: 0, detail: 'no provider configured' };
  return timed(async () => {
    const { rows } = await io.query(
      env,
      `select count(*)::int as n from public.found_reports
        where photo_file is not null
          and created_at > now() - interval '24 hours'
          and coalesce(data->'matchEngine'->>'biometric', 'false') <> 'true'`,
      [],
      ctx,
    );
    const n = rows?.[0]?.n || 0;
    if (n > 0) throw new Error(`${n} sighting photo(s) in the last 24 hours were not compared by any face engine`);
    return 'every recent photo was compared';
  });
}

export async function runHealthChecks(env, ctx, io = db) {
  const [database, aarakshak, backlog, silentMatching] = await Promise.all([
    checkDatabase(env, ctx, io),
    checkAarakshak(env),
    checkReviewBacklog(env, ctx, io).catch((e) => ({ ok: false, detail: String(e) })),
    checkSilentMatching(env, ctx, io).catch((e) => ({ ok: false, detail: String(e) })),
  ]);
  return { at: new Date().toISOString(), checks: { database, aarakshak, backlog, silentMatching } };
}

const LABELS = {
  database: 'Database unreachable',
  aarakshak: 'Face engine (Aarakshak) not answering',
  backlog: 'Possible matches waiting too long',
  silentMatching: 'Sighting photos not being compared',
  backup: 'Nightly backup failed',
  retention: 'Nightly retention job failed',
};

/**
 * Raises an alert per failing check to every super admin, unless an unread one
 * for the same check is still recent. Returns what was raised.
 */
export async function raiseAlerts(env, ctx, results, now = Date.now(), io = db) {
  const failing = Object.entries(results).filter(([, r]) => r && !r.ok);
  if (!failing.length) return [];

  const { rows: admins } = await io.query(env, `select id from public.users where role = 'super_admin'`, [], ctx);
  const { rows: open } = await io.query(
    env,
    `select data from public.notifications where kind = $1 and read_at is null and ts > $2`,
    [ALERT_KIND, now - REALERT_AFTER_MS],
    ctx,
  );
  const alreadyOpen = new Set(open.map((r) => `${r.data?.userId}|${r.data?.opsKey}`));

  const rows = [];
  const raised = [];
  for (const [key, result] of failing) {
    const title = LABELS[key] || `Check failed: ${key}`;
    let fresh = false;
    for (const admin of admins) {
      if (alreadyOpen.has(`${admin.id}|${key}`)) continue;
      fresh = true;
      rows.push({
        id: `n_ops_${now}_${key}_${admin.id}`.slice(0, 80),
        ts: now,
        readAt: null,
        userId: admin.id,
        kind: ALERT_KIND,
        opsKey: key,
        title,
        body: result.detail || '',
        priority: key === 'database' || key === 'aarakshak' ? 'high' : 'normal',
        scope: {},
      });
    }
    if (fresh) raised.push({ key, title, detail: result.detail || '' });
  }
  if (rows.length) await io.upsertMany(env, 'notifications', rows, ctx);
  if (raised.length) await emailAlerts(env, raised);
  return raised;
}

async function emailAlerts(env, raised) {
  const to = cleanSecret(env?.KHOZO_ALERT_EMAIL);
  if (!env?.EMAIL || !to) return;
  const from = cleanSecret(env?.KHOZO_ALERT_FROM) || 'alerts@khozo.org';
  const lines = raised.map((r) => `- ${r.title}: ${r.detail}`).join('\n');
  try {
    await env.EMAIL.send({
      to,
      from: { email: from, name: 'Khozo monitoring' },
      subject: `Khozo: ${raised.map((r) => r.title).join('; ')}`.slice(0, 180),
      text: `Khozo's scheduled check found a problem.\n\n${lines}\n\nOpen the console as super admin for details. Checks run every 15 minutes; this alert repeats at most every 6 hours while unread.`,
    });
  } catch (err) {
    console.warn('[ops] alert e-mail failed:', err?.message || err);
  }
}

// --- Nightly backup ------------------------------------------------------------
//
// A logical export of every table except photo bytes, gzipped and encrypted
// (AES-256-GCM) with KHOZO_BACKUP_KEY, written to the R2 bucket bound as
// BACKUPS. Photos are not in it: they are large and live in photo_blobs, so the
// database host's point-in-time recovery covers them (docs/RUNBOOK-backup.md).
// Password hashes are left out; a restore re-issues passwords.

const BACKUP_TABLES = ['users', 'reports', 'found_reports', 'grievances', 'notifications', 'activity', 'audit'];

async function backupKey(env) {
  const raw = cleanSecret(env?.KHOZO_BACKUP_KEY);
  if (!raw) return null;
  const bytes = bytesFromB64(raw);
  if (bytes.length !== 32) throw new Error('KHOZO_BACKUP_KEY must be 32 bytes, base64-encoded');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
}

export async function runBackup(env, ctx, now = new Date(), io = db) {
  if (!env?.BACKUPS) return { ok: true, skipped: 'R2 bucket not bound (BACKUPS)' };
  const key = await backupKey(env);
  if (!key) return { ok: false, detail: 'KHOZO_BACKUP_KEY is not set; refusing to write an unencrypted backup' };

  const tables = {};
  for (const table of BACKUP_TABLES) {
    const { rows } = await io.query(env, `select data from public.${table}`, [], ctx);
    tables[table] = rows.map((r) => {
      if (table !== 'users') return r.data;
      const { passwordHash, ...rest } = r.data || {};
      return rest;
    });
  }
  const payload = JSON.stringify({ format: 'khozo.backup.v1', createdAt: now.toISOString(), tables });
  const gz = await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, gz);
  const body = new Uint8Array(12 + sealed.byteLength);
  body.set(iv, 0);
  body.set(new Uint8Array(sealed), 12);

  const day = now.toISOString().slice(0, 10);
  const objectKey = `daily/${day}.json.gz.aesgcm`;
  await env.BACKUPS.put(objectKey, body, {
    customMetadata: { format: 'khozo.backup.v1', counts: JSON.stringify(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))) },
  });

  // Keep the last BACKUP_KEEP_DAYS dailies.
  const cutoff = new Date(now.getTime() - BACKUP_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const listed = await env.BACKUPS.list({ prefix: 'daily/' });
  const old = listed.objects.map((o) => o.key).filter((k) => k.slice(6, 16) < cutoff);
  if (old.length) await env.BACKUPS.delete(old);

  return { ok: true, detail: `${objectKey} (${body.length} bytes)`, removed: old.length };
}

// --- Retention -----------------------------------------------------------------
//
// Every night the retention schedule is planned (shared/retention.js) and the
// super admins are told what is due: sightings past 180 days, closed cases
// past their date, open cases past their date (for review, never removed). It
// is carried out only where the Department has approved the schedule and the
// deployment says so with KHOZO_RETENTION_ENFORCE=on (DPIA G3).
//
// Notifications and the activity feed are kept indefinitely unless the
// Department sets a period: KHOZO_NOTIFICATION_RETENTION_DAYS and
// KHOZO_ACTIVITY_RETENTION_DAYS delete rows older than that (DPIA G24).

const RETENTION_KIND = 'retention_notice';

function positiveDays(value) {
  const n = Number(cleanSecret(value));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

export async function runRetention(env, ctx, { now = Date.now(), io = db, createStore = createRequestStore, faceIndex = null } = {}) {
  const enforce = cleanSecret(env?.KHOZO_RETENTION_ENFORCE).toLowerCase() === 'on';
  const { store, flush } = await createStore(env, ctx);
  const deps = {
    listReports: store.listReports,
    listFoundReports: store.listFoundReports,
    updateReport: store.updateReport,
    updateFoundReport: store.updateFoundReport,
    addAudit: store.addAudit,
    deletePhoto: store.deletePhoto,
    rewriteActivity: store.rewriteActivity,
    faceIndex: faceIndex || createFaceIndex(env),
  };
  const result = await runRetentionSweep(deps, { now, apply: enforce });
  const s = result.summary;
  const due = s.sightingsToAnonymise + s.casesToAnonymise + s.openCasesToReview;

  if (due || result.done.sightingsExtended) {
    const title = enforce
      ? `Retention: ${result.done.sightingsAnonymised} sightings and ${result.done.casesAnonymised} closed cases anonymised`
      : `Retention: ${s.sightingsToAnonymise} sightings and ${s.casesToAnonymise} closed cases past their date`;
    const body = [
      enforce ? null : 'Nothing has been deleted: automatic retention is off. Review them in Privacy review, or run the schedule from there.',
      s.openCasesToReview ? `${s.openCasesToReview} open case(s) have passed their retention date and need a review decision.` : null,
      s.sightingsKeptWithCase ? `${s.sightingsKeptWithCase} sighting(s) are kept because they belong to an open or confirmed case.` : null,
      s.dueSoonSightings + s.dueSoonCases ? `${s.dueSoonSightings + s.dueSoonCases} more record(s) reach their date within 30 days.` : null,
    ].filter(Boolean).join(' ');
    for (const admin of store.listUsers().filter((u) => u.role === 'super_admin')) {
      store.addNotification({ userId: admin.id, kind: RETENTION_KIND, title, body, priority: s.openCasesToReview ? 'high' : 'normal', scope: {} });
    }
  }
  if (result.applied || due) {
    store.addAudit({
      actorName: 'Khozo retention job',
      actorRole: 'system',
      action: result.applied ? 'privacy.retention_sweep_applied' : 'privacy.retention_sweep_planned',
      targetType: 'retention',
      summary: result.applied
        ? `Nightly retention: ${result.done.sightingsAnonymised} sightings and ${result.done.casesAnonymised} cases anonymised`
        : `Nightly retention plan: ${s.sightingsToAnonymise} sightings and ${s.casesToAnonymise} cases due`,
      scope: {},
      metadata: { ...s, ...result.done, enforce },
    });
  }
  await flush();

  const purged = {};
  const notificationDays = positiveDays(env?.KHOZO_NOTIFICATION_RETENTION_DAYS);
  if (notificationDays) {
    const { rowCount } = await io.query(env, 'delete from public.notifications where ts < $1', [now - notificationDays * 86400000], ctx);
    purged.notifications = rowCount || 0;
  }
  const activityDays = positiveDays(env?.KHOZO_ACTIVITY_RETENTION_DAYS);
  if (activityDays) {
    const { rowCount } = await io.query(env, 'delete from public.activity where ts < $1', [now - activityDays * 86400000], ctx);
    purged.activity = rowCount || 0;
  }

  return { ok: true, enforce, summary: s, done: result.done, purged, detail: `${due} due, enforce ${enforce ? 'on' : 'off'}` };
}

/** Cloudflare cron entry point; see "triggers" in wrangler.jsonc. */
export async function scheduled(event, env, ctx) {
  const results = (await runHealthChecks(env, ctx)).checks;
  if (event?.cron === '30 20 * * *') {
    results.backup = await runBackup(env, ctx).catch((err) => ({ ok: false, detail: String(err?.message || err) }));
    results.retention = await runRetention(env, ctx).catch((err) => ({ ok: false, detail: String(err?.message || err) }));
  }
  try {
    await raiseAlerts(env, ctx, results);
  } catch (err) {
    console.error('[ops] could not raise alerts:', err?.message || err, JSON.stringify(results));
  }
  console.log('[ops] checks', JSON.stringify(results));
}
