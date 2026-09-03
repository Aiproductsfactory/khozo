/**
 * Checks that reporting a spotted child reaches the people who can act on it.
 *
 * This is the flow that was broken in production: a citizen tapped "I spotted a
 * child", the sighting was stored, and it appeared on nobody's dashboard. Two
 * causes, both covered here:
 *
 *   1. A sighting whose reporter gave no state or district matched no
 *      jurisdiction, and the scoping filter then hid it from every role except
 *      the super admin. An unrouted report has to land in someone's queue.
 *   2. Nothing told anyone it had arrived. Every authority account is now
 *      notified the moment a sighting is submitted.
 *
 * Runs against the Express runtime on the isolated JSON store, so it needs no
 * database and makes no network calls.
 *
 *   node scripts/sighting-alert-smoke.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(root, 'server', 'data', 'db.json');
const backupFile = path.join(root, 'server', 'data', 'db.json.alert.bak');
const port = Number(process.env.KHOZO_ALERT_PORT || 4600);
const base = `http://localhost:${port}/api`;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function call(pathname, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text.slice(0, 200) };
  }
  return { status: res.status, payload };
}

const login = async (email) =>
  (await call('/auth/login', { method: 'POST', body: { email, password: 'khozo123' } })).payload;

let server;
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('API did not become healthy');
}

async function run() {
  if (fs.existsSync(dbFile)) {
    fs.copyFileSync(dbFile, backupFile);
    fs.rmSync(dbFile, { force: true });
  }
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(root, 'server'),
    env: { ...process.env, DATABASE_URL: '', PORT: String(port), KHOZO_FOUND_REPORT_LIMIT: '50' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (buf) => process.stderr.write(`[api] ${buf}`));
  await waitForServer();

  console.log('Khozo sighting alert flow\n');

  // A citizen reports a child with no state or district — the common case, and
  // the one that used to disappear.
  const form = new FormData();
  form.append('foundLocation', 'Outside the bus stand, near the tea stalls');
  form.append('note', 'Child alone, looked about seven, wearing a red shirt.');
  form.append('reporterName', 'Passer-by');
  form.append('reporterPhone', '9000000111');

  const submitted = await call('/reports/found', { method: 'POST', form });
  check('an unlocated sighting is accepted', submitted.status === 201, `HTTP ${submitted.status}`);
  const sightingId = submitted.payload?.foundReport?.id;
  check('the reporter gets a receipt id', Boolean(sightingId), sightingId || 'none');

  // Every role that reviews sightings must be able to see it.
  const ROLES = [
    ['superadmin@khozo.org', 'super admin'],
    ['admin@khozo.org', 'state admin'],
    ['police@khozo.org', 'police station'],
    ['cwc@khozo.org', 'CWC desk'],
    ['dcpu@khozo.org', 'DCPU officer'],
    ['rpf@khozo.org', 'RPF post'],
    ['nodal@khozo.org', 'state nodal officer'],
  ];

  for (const [email, label] of ROLES) {
    const account = await login(email);
    const queue = await call('/reports/found/all', { token: account.token });
    const visible = (queue.payload?.foundReports || []).some((f) => f.id === sightingId);
    check(`${label} sees the sighting in the review queue`, visible);

    const inbox = await call('/dashboard/notifications', { token: account.token });
    const alert = (inbox.payload?.notifications || []).find((n) => n.scope?.foundReportId === sightingId);
    check(`${label} is notified`, Boolean(alert), alert ? `unread: ${inbox.payload.unread}` : 'no notification');
    if (alert) {
      check(
        `the alert to ${label} does not name a child`,
        !/childName|"name"/i.test(JSON.stringify(alert)),
        'a sighting alert must carry location and time only'
      );
    }
  }

  // A parent account is not an authority and must not be told about every
  // sighting in the country.
  const parent = await login('parent@khozo.org');
  const parentInbox = await call('/dashboard/notifications', { token: parent.token });
  check(
    'a parent is not alerted about other people\'s sightings',
    (parentInbox.payload?.notifications || []).length === 0,
    `${parentInbox.payload?.notifications?.length ?? '?'} notifications`
  );

  // Read state is per officer.
  const police = await login('police@khozo.org');
  const before = await call('/dashboard/notifications', { token: police.token });
  check('the officer has unread alerts', before.payload.unread > 0, `unread: ${before.payload.unread}`);

  await call('/dashboard/notifications/read', { method: 'POST', token: police.token, body: {} });
  const after = await call('/dashboard/notifications', { token: police.token });
  check('marking read clears that officer\'s badge', after.payload.unread === 0, `unread: ${after.payload.unread}`);

  const otherOfficer = await login('cwc@khozo.org');
  const otherInbox = await call('/dashboard/notifications', { token: otherOfficer.token });
  check(
    'another officer\'s badge is unaffected',
    otherInbox.payload.unread > 0,
    `unread: ${otherInbox.payload.unread}`
  );

  // A located sighting still routes normally.
  const located = new FormData();
  located.append('foundLocation', 'Guwahati railway station, platform 2');
  located.append('state', 'Assam');
  located.append('district', 'Kamrup Metropolitan');
  located.append('note', 'Child alone near the ticket counter.');
  located.append('reporterName', 'Station volunteer');
  located.append('reporterPhone', '9000000222');

  const assam = await call('/reports/found', { method: 'POST', form: located });
  check('a sighting outside the old hardcoded cities keeps its location', assam.payload?.foundReport?.state === 'Assam', `state: ${assam.payload?.foundReport?.state}`);
  check('and its district', assam.payload?.foundReport?.district === 'Kamrup Metropolitan', `district: ${assam.payload?.foundReport?.district}`);
}

try {
  await run();
} catch (err) {
  check('the flow ran end to end', false, err.message);
} finally {
  if (server) server.kill();
  if (fs.existsSync(backupFile)) {
    fs.copyFileSync(backupFile, dbFile);
    fs.rmSync(backupFile, { force: true });
  }
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Sighting alert checks passed.');
