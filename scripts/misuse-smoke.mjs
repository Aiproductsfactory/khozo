/**
 * Checks the controls that keep the public sighting form from becoming a way
 * to photograph strangers, women and girls above all:
 *
 *   - the bot check (shared/human-check.js): Cloudflare's answers are read
 *     the way its documentation says, and a report is refused only for a
 *     false token, never for a missing or expired one or an outage;
 *   - the reason asked before a woman's or an adult's report
 *     (shared/sighting-misuse.js) is recorded when given and never required;
 *   - "Not a concern" (POST /found/:id/dismiss) deletes the photo at once,
 *     keeps nothing identifying, and refuses what it must not touch.
 *
 * Handlers are called directly with stubbed dependencies: no server, no
 * database, no network.
 *
 *   node scripts/misuse-smoke.mjs
 */

import process from 'node:process';

import registerReportRoutes from '../shared/routes/reports.js';
import { createHumanCheck, HUMAN_CHECK_FIELD, humanCheckConfig, verifyHumanToken } from '../shared/human-check.js';
import { concernReasonOf, dismissalReasonOf } from '../shared/sighting-misuse.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('Khozo misuse controls\n');

// --- The bot check's settings ------------------------------------------------
{
  const full = { TURNSTILE_SITE_KEY: '0xSITE', TURNSTILE_SECRET: '0xSECRET', TURNSTILE_HOSTNAMES: 'khozo.org, WWW.khozo.org' };
  check('the check is off without its keys', humanCheckConfig({}) === null);
  check('the check is off without hostnames', humanCheckConfig({ ...full, TURNSTILE_HOSTNAMES: ' ' }) === null);
  check('the check is off without a secret', humanCheckConfig({ ...full, TURNSTILE_SECRET: '' }) === null);
  const config = humanCheckConfig(full);
  check('hostnames are read as a lower-case list', config?.hostnames.has('khozo.org') && config.hostnames.has('www.khozo.org'));
}

// --- Siteverify's answers ------------------------------------------------------
const config = humanCheckConfig({ TURNSTILE_SITE_KEY: '0xSITE', TURNSTILE_SECRET: '0xSECRET', TURNSTILE_HOSTNAMES: 'khozo.org' });
const siteverify = (answer, { status = 200, throws = false, calls = [] } = {}) => async (url, init) => {
  calls.push({ url, body: String(init?.body || '') });
  if (throws) throw new Error('network down');
  return { ok: status >= 200 && status < 300, status, json: async () => answer };
};
const passed = { success: true, action: 'sighting', hostname: 'khozo.org' };
{
  const calls = [];
  const result = await verifyHumanToken('tok-1', { config, remoteip: '203.0.113.9', fetchImpl: siteverify(passed, { calls }) });
  check('a good token passes', result === 'passed', result);
  check('siteverify gets the secret, the token and the address', /secret=0xSECRET/.test(calls[0]?.body) && /response=tok-1/.test(calls[0]?.body) && /remoteip=203\.0\.113\.9/.test(calls[0]?.body));
  check('it is called at Cloudflare, from the server', calls[0]?.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
}
check('a token Cloudflare rejects fails',
  (await verifyHumanToken('tok', { config, fetchImpl: siteverify({ success: false, 'error-codes': ['invalid-input-response'] }) })) === 'failed');
check('a token for another action fails',
  (await verifyHumanToken('tok', { config, fetchImpl: siteverify({ ...passed, action: 'login' }) })) === 'failed');
check('a token from another site fails',
  (await verifyHumanToken('tok', { config, fetchImpl: siteverify({ ...passed, hostname: 'khozo.example' }) })) === 'failed');
check('a token issued on localhost fails on a production allowlist',
  (await verifyHumanToken('tok', { config, fetchImpl: siteverify({ ...passed, hostname: 'localhost' }) })) === 'failed');
check('an old or reused token is expired, not false',
  (await verifyHumanToken('tok', { config, fetchImpl: siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }) })) === 'expired');
check('a wrong secret is the deployment’s fault, not the sender’s',
  (await verifyHumanToken('tok', { config, fetchImpl: siteverify({ success: false, 'error-codes': ['invalid-input-secret'] }) })) === 'unavailable');
check('an outage is unavailable',
  (await verifyHumanToken('tok', { config, fetchImpl: siteverify(null, { throws: true }) })) === 'unavailable');
check('an HTTP error is unavailable',
  (await verifyHumanToken('tok', { config, fetchImpl: siteverify({}, { status: 502 }) })) === 'unavailable');
{
  const calls = [];
  const result = await verifyHumanToken('x'.repeat(2049), { config, fetchImpl: siteverify(passed, { calls }) });
  check('an oversized token fails without a call', result === 'failed' && calls.length === 0);
}

// --- The middleware ------------------------------------------------------------
async function through(middleware, { body = {}, user = null } = {}) {
  const req = { body, user, headers: {} };
  let status = null;
  let payload = null;
  let nexted = false;
  const res = {
    status(code) { status = code; return res; },
    json(data) { payload = data; return res; },
  };
  await middleware(req, res, () => { nexted = true; });
  return { req, status, payload, nexted };
}
{
  let strict = 0;
  const strictLimit = (_req, _res, next) => { strict += 1; next(); };
  const off = await through(createHumanCheck({ config: null, strictLimit }));
  check('off, every report goes through unmarked', off.nexted && off.req.humanCheck === null && strict === 0);

  const on = (answer) => createHumanCheck({ config, fetchImpl: siteverify(answer), clientIp: () => '203.0.113.9', strictLimit });
  const signedIn = await through(on(passed), { user: { id: 'u1', role: 'ngo' } });
  check('a signed-in account is not challenged', signedIn.nexted && signedIn.req.humanCheck === null);

  strict = 0;
  const good = await through(on(passed), { body: { [HUMAN_CHECK_FIELD]: 'tok' } });
  check('a passed check goes through at the ordinary limit', good.nexted && good.req.humanCheck === 'passed' && strict === 0);

  strict = 0;
  const missing = await through(on(passed), { body: {} });
  check('no token is accepted, marked and held to the strict limit', missing.nexted && missing.req.humanCheck === 'missing' && strict === 1);

  strict = 0;
  const expired = await through(on({ success: false, 'error-codes': ['timeout-or-duplicate'] }), { body: { [HUMAN_CHECK_FIELD]: 'old' } });
  check('an expired token (an offline queue) is accepted under the strict limit', expired.nexted && expired.req.humanCheck === 'expired' && strict === 1);

  strict = 0;
  const down = await through(createHumanCheck({ config, fetchImpl: siteverify(null, { throws: true }), strictLimit }), { body: { [HUMAN_CHECK_FIELD]: 'tok' } });
  check('an outage does not turn a reporter away', down.nexted && down.req.humanCheck === 'unavailable' && strict === 1);

  const bad = await through(on({ success: false, 'error-codes': ['invalid-input-response'] }), { body: { [HUMAN_CHECK_FIELD]: 'forged' } });
  check('a false token is refused with 403', !bad.nexted && bad.status === 403 && bad.payload?.code === 'human_check_failed');
}

// --- Reasons ----------------------------------------------------------------------
check('a known concern reason is kept', concernReasonOf(' asked_for_help ') === 'asked_for_help');
check('an unknown concern reason is dropped', concernReasonOf('looked nice') === null && concernReasonOf({}) === null);
check('only the two dismissal reasons exist', dismissalReasonOf('misuse') === 'misuse' && dismissalReasonOf('not_a_concern') === 'not_a_concern' && dismissalReasonOf('other') === null);

// --- The routes ----------------------------------------------------------------------
function recorder() {
  const routes = [];
  const router = {
    use: () => router,
    ...Object.fromEntries(
      ['get', 'post', 'put', 'patch', 'delete'].map((method) => [
        method,
        (path, ...handlers) => {
          routes.push({ method: method.toUpperCase(), path, handler: handlers.flat().at(-1) });
          return router;
        },
      ])
    ),
  };
  return { router, routes };
}

const AHMEDABAD_POLICE = { id: 'u_police', role: 'police', name: 'Station', jurisdiction: { state: 'Gujarat', district: 'Ahmedabad' } };
const SURAT_POLICE = { id: 'u_surat', role: 'police', name: 'Surat Station', jurisdiction: { state: 'Gujarat', district: 'Surat' } };

// The case a linked sighting points to, in the same district: scope hides a
// sighting linked to a case the desk cannot open.
const CASE_R1 = { id: 'r_1', status: 'missing', state: 'Gujarat', district: 'Ahmedabad', personCategory: 'woman', createdAt: Date.now() };

function harness(initial = [], reports = [CASE_R1]) {
  const sightings = initial.map((row) => ({ ...row }));
  const audit = [];
  const deleted = [];
  const rewrites = [];
  const { router, routes } = recorder();
  registerReportRoutes(router, {
    listReports: () => reports,
    listFoundReports: () => sightings,
    listUsers: () => [AHMEDABAD_POLICE, SURAT_POLICE],
    addFoundReport: (row) => sightings.push(row),
    addActivity: () => {},
    addAudit: (row) => audit.push(row),
    addNotification: () => {},
    savePhoto: async (key) => key,
    readPhoto: async () => null,
    photoMimeType: () => 'image/jpeg',
    findReport: (id) => reports.find((r) => r.id === id) || null,
    findFoundReport: (id) => sightings.find((s) => s.id === id) || null,
    addReport: () => {},
    updateReport: () => {},
    updateFoundReport: (id, patch) => {
      const row = sightings.find((s) => s.id === id);
      if (row) Object.assign(row, patch);
      return row;
    },
    deletePhoto: async (key) => { deleted.push(key); return true; },
    rewriteActivity: (fn) => rewrites.push(fn),
    authRequired: (_req, _res, next) => next(),
    optionalAuth: (_req, _res, next) => next(),
    passwordChangeRequired: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
    auditPublicRateLimit: () => {},
    clientIp: () => 'test',
    fixedWindowRateLimit: () => (_req, _res, next) => next(),
    rankMatches: async () => ({ candidates: [], engine: { provider: 'stub', modelVersion: null, biometric: false } }),
    detectPerson: async () => ({ verdict: 'person', faces: 1, provider: 'stub', checkedAt: Date.now() }),
    upload: { single: () => (_req, _res, next) => next() },
    fetchImpl: async () => { throw new Error('no network in this test'); },
    settings: {},
  });
  const handler = (method, path) => routes.find((r) => r.method === method && r.path === path).handler;
  return { sightings, audit, deleted, rewrites, handler };
}

async function call(handler, { body = {}, params = {}, user = null, file = null, humanCheck } = {}) {
  const req = { body, params, query: {}, headers: {}, user, file };
  if (humanCheck !== undefined) req.humanCheck = humanCheck;
  let status = 200;
  let payload = null;
  const res = {
    status(code) { status = code; return res; },
    json(data) { payload = data; return res; },
  };
  await handler(req, res);
  return { status, payload };
}

// A sighting of a woman, with a reason and a bot-check result.
{
  const { sightings, handler } = harness();
  const res = await call(handler('POST', '/found'), {
    body: { personCategory: 'woman', ageApprox: '30', foundLocation: 'Kalupur station', state: 'Gujarat', district: 'Ahmedabad', note: 'Asked me to call her brother', concernReason: 'asked_for_help' },
    humanCheck: 'expired',
  });
  check('a woman’s sighting with a reason is accepted', res.status === 201, `HTTP ${res.status} ${res.payload?.error || ''}`);
  check('the reason is recorded', sightings[0]?.concernReason === 'asked_for_help');
  check('the bot-check result is recorded', sightings[0]?.humanCheck === 'expired');
  check('neither is in the reporter’s receipt', res.payload && !('concernReason' in (res.payload.foundReport || {})) && !('humanCheck' in (res.payload.foundReport || {})));
}

const base = {
  id: 'f_d1', status: 'no_match', state: 'Gujarat', district: 'Ahmedabad', personCategory: 'woman',
  foundLocation: 'Law Garden, near the stalls', lat: 23.02, lng: 72.56, note: 'Girl in a blue dress',
  reporterName: 'Passer-by', reporterPhone: '9111111111', photoFile: 'f_d1.jpg', photoUrl: '/api/reports/photo/f_d1.jpg',
  campaignSource: 'law-garden', concernReason: 'other', createdAt: Date.now(),
};

{
  const { sightings, audit, deleted, rewrites, handler } = harness([base]);
  const dismiss = handler('POST', '/found/:id/dismiss');
  const res = await call(dismiss, { params: { id: 'f_d1' }, body: { reason: 'misuse' }, user: AHMEDABAD_POLICE });
  const row = sightings[0];
  check('a desk in scope can dismiss a sighting as misuse', res.status === 200, `HTTP ${res.status} ${res.payload?.error || ''}`);
  check('the photo is deleted at once', deleted.includes('f_d1.jpg') && !row.photoFile && !row.photoUrl);
  check('it is closed and anonymised', row.status === 'dismissed' && Boolean(row.anonymizedAt) && row.anonymizationApproval === 'dismissed:misuse');
  const text = JSON.stringify(row);
  const leaks = ['Law Garden', 'blue dress', 'Passer-by', '9111111111', 'law-garden'].filter((t) => text.includes(t));
  check('nothing identifying is left, the poster code included', leaks.length === 0 && row.lat === null, leaks.join(', '));
  check('the activity log is rewritten too', rewrites.length === 1);
  const entry = audit.find((a) => a.action === 'sighting.dismissed_misuse');
  check('the audit log records who dismissed it and why', entry?.actorId === 'u_police' && entry.metadata?.reason === 'misuse');
  check('the audit entry names no place or poster', entry && !JSON.stringify(entry).includes('Law Garden') && !JSON.stringify(entry).includes('law-garden'));
  const again = await call(dismiss, { params: { id: 'f_d1' }, body: { reason: 'misuse' }, user: AHMEDABAD_POLICE });
  check('it cannot be dismissed twice', again.status === 409);
}

{
  const { audit, handler } = harness([base]);
  const res = await call(handler('POST', '/found/:id/dismiss'), { params: { id: 'f_d1' }, body: { reason: 'not_a_concern' }, user: AHMEDABAD_POLICE });
  check('"not a concern" closes it too', res.status === 200 && res.payload?.foundReport?.status === 'dismissed');
  check('"not a concern" is not raised as misuse', audit.some((a) => a.action === 'sighting.dismissed') && !audit.some((a) => a.action === 'sighting.dismissed_misuse'));
}

{
  const { sightings, deleted, handler } = harness([base]);
  const res = await call(handler('POST', '/found/:id/dismiss'), { params: { id: 'f_d1' }, body: { reason: 'misuse' }, user: SURAT_POLICE });
  check('a desk outside the district cannot dismiss it', res.status === 404 && deleted.length === 0 && sightings[0].photoFile === 'f_d1.jpg');
}

for (const [label, patch, code] of [
  ['a sighting with a match to decide', { status: 'pending_review', matchedReportId: 'r_1' }, 409],
  ['a confirmed sighting', { status: 'matched', matchedReportId: 'r_1' }, 409],
  ['a sighting a found-person case was opened from', { formalReportId: 'r_2' }, 409],
]) {
  const { deleted, handler } = harness([{ ...base, ...patch }]);
  const res = await call(handler('POST', '/found/:id/dismiss'), { params: { id: 'f_d1' }, body: { reason: 'not_a_concern' }, user: AHMEDABAD_POLICE });
  check(`${label} cannot be dismissed`, res.status === code && deleted.length === 0, `HTTP ${res.status}`);
}

{
  const { handler } = harness([base]);
  const res = await call(handler('POST', '/found/:id/dismiss'), { params: { id: 'f_d1' }, body: { reason: 'boring' }, user: AHMEDABAD_POLICE });
  check('a dismissal needs one of the two reasons', res.status === 400);
}

{
  const { handler } = harness();
  const res = await call(handler('GET', '/public/human-check'));
  check('the form is told the check is off', res.payload?.siteKey === null && res.payload?.action === 'sighting');
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.error('Misuse checks failed.');
  process.exit(1);
}
console.log('Misuse checks passed.');
