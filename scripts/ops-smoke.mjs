/**
 * Checks the Worker's scheduled operations (worker/src/ops.js) against fakes:
 * a failing check alerts each super admin once and not again while unread; a
 * healthy run alerts nobody; the nightly backup is encrypted, leaves out
 * password hashes, decrypts with the key, and refuses to run without one.
 *
 *   node scripts/ops-smoke.mjs
 */
import process from 'node:process';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import { raiseAlerts, runBackup, runHealthChecks } from '../worker/src/ops.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

function fakeIo({ dbUp = true, overdue = 0 } = {}) {
  const notifications = [];
  return {
    notifications,
    async query(_env, sql, params = []) {
      if (/select 1 as ok/.test(sql)) {
        if (!dbUp) throw new Error('connection refused');
        return { rows: [{ ok: 1 }] };
      }
      if (/role = 'super_admin'/.test(sql)) return { rows: [{ id: 'u_sa1' }, { id: 'u_sa2' }] };
      if (/from public\.notifications where kind/.test(sql)) {
        return { rows: notifications.filter((n) => n.kind === params[0] && !n.readAt && n.ts > params[1]).map((data) => ({ data })) };
      }
      if (/status = 'pending_review'/.test(sql)) return { rows: [{ n: overdue }] };
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
      const table = /from public\.(\w+)/.exec(sql)?.[1];
      if (table === 'users') return { rows: [{ data: { id: 'u_1', email: 'a@example.org', passwordHash: '$2b$secret' } }] };
      return { rows: [{ data: { id: `${table}_1` } }] };
    },
    async upsertMany(_env, table, rows) {
      if (table === 'notifications') notifications.push(...rows);
    },
  };
}

const env = {}; // no Aarakshak key: that check reports "not set", which is itself an alert

// Healthy database, nothing overdue: only the missing provider key alerts.
{
  const io = fakeIo();
  const { checks: results } = await runHealthChecks(env, null, io);
  check('a reachable database passes', results.database.ok === true);
  check('a missing face-engine key is reported', results.aarakshak.ok === false && /not set/.test(results.aarakshak.detail));
  const raised = await raiseAlerts(env, null, results, Date.now(), io);
  check('one alert per failing check, to every super admin', raised.length === 1 && io.notifications.length === 2, `${raised.length} raised, ${io.notifications.length} rows`);
  const again = await raiseAlerts(env, null, results, Date.now() + 15 * 60000, io);
  check('the same problem is not re-alerted while the alert is unread', again.length === 0 && io.notifications.length === 2);
  io.notifications.forEach((n) => { n.readAt = Date.now(); });
  const afterRead = await raiseAlerts(env, null, results, Date.now() + 30 * 60000, io);
  check('once read, a persisting problem alerts again', afterRead.length === 1);
}

// Database down and overdue reviews.
{
  const io = fakeIo({ dbUp: false, overdue: 3 });
  const { checks: results } = await runHealthChecks({ AARAKSHAK_API_KEY: '' }, null, io);
  check('an unreachable database fails the check', results.database.ok === false && /refused/.test(results.database.detail));
  const io2 = fakeIo({ overdue: 3 });
  const r2 = (await runHealthChecks(env, null, io2)).checks;
  check('overdue possible matches are reported', r2.backlog.ok === false && /3 possible match/.test(r2.backlog.detail));
}

// Nothing failing: nobody is alerted.
{
  const io = fakeIo();
  const raised = await raiseAlerts(env, null, { database: { ok: true }, backlog: { ok: true } }, Date.now(), io);
  check('a healthy run alerts nobody', raised.length === 0 && io.notifications.length === 0);
}

// Backup.
{
  const key = crypto.randomBytes(32);
  const stored = new Map();
  const bucket = {
    async put(k, body, opts) { stored.set(k, { body: Buffer.from(body), opts }); },
    async list() { return { objects: [...stored.keys()].map((key) => ({ key })) }; },
    async delete(keys) { for (const k of [].concat(keys)) stored.delete(k); },
  };
  const skipped = await runBackup({}, null, new Date('2026-10-17T20:30:00Z'), fakeIo());
  check('no bucket bound: the backup is skipped, not failed', skipped.ok === true && /not bound/.test(skipped.skipped));
  const refused = await runBackup({ BACKUPS: bucket }, null, new Date('2026-10-17T20:30:00Z'), fakeIo());
  check('no key: the backup refuses to write unencrypted', refused.ok === false && /KHOZO_BACKUP_KEY/.test(refused.detail) && stored.size === 0);

  stored.set('daily/2026-08-01.json.gz.aesgcm', { body: Buffer.alloc(1) }); // older than 35 days
  const done = await runBackup({ BACKUPS: bucket, KHOZO_BACKUP_KEY: key.toString('base64') }, null, new Date('2026-10-17T20:30:00Z'), fakeIo());
  const obj = stored.get('daily/2026-10-17.json.gz.aesgcm');
  check('the backup is written under the day', done.ok === true && Boolean(obj), done.detail);
  check('backups older than 35 days are removed', !stored.has('daily/2026-08-01.json.gz.aesgcm') && done.removed === 1);
  const b = obj.body;
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(b.length - 16));
  const json = JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()])).toString('utf8'));
  check('it decrypts with the key and holds every table', json.format === 'khozo.backup.v1' && Object.keys(json.tables).length === 7);
  check('password hashes are not in the backup', !JSON.stringify(json).includes('$2b$secret'));
  let wrongKey = false;
  try {
    const bad = crypto.createDecipheriv('aes-256-gcm', crypto.randomBytes(32), b.subarray(0, 12));
    bad.setAuthTag(b.subarray(b.length - 16));
    Buffer.concat([bad.update(b.subarray(12, b.length - 16)), bad.final()]);
  } catch { wrongKey = true; }
  check('another key cannot read it', wrongKey);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) process.exit(1);
console.log('Ops checks passed.');
