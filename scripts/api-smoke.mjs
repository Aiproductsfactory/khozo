import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  duplicateScore,
  FAMILY_SMS_MESSAGES,
  nonFamilyPhoneSet,
  PERSON_CONSENT_REQUIRED,
  PUBLIC_APPEALS_DISABLED,
  VERIFICATION_REQUIRED,
  publicSightingStatus,
  SIGHTING_RECEIVED_WINDOW_MS,
  SIGHTING_REVIEW_WINDOW_MS,
} from '../shared/case-domain.js';
import registerReportRoutes from '../shared/routes/reports.js';
import khozoWorker from '../worker/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The developer's own JSON store. The suite never writes to it: the server
// under test gets a fresh temporary data directory (KHOZO_DATA_DIR), and this
// file's hash is checked at the end to prove it was left alone.
const devDbFile = path.join(root, 'server', 'data', 'db.json');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'khozo-api-smoke-'));
const port = Number(process.env.KHOZO_SMOKE_PORT || 4400);
const base = `http://localhost:${port}/api`;

/**
 * The same suite runs against both runtimes, because they share their route
 * handlers: `--runtime express` (default) starts the Node API, `--runtime
 * worker` starts the Cloudflare Worker's router shim on Node. A result that
 * differs between the two is a bug in the runtime glue, which is the part that
 * used to drift silently and 404 in production.
 */
const RUNTIMES = {
  express: { entry: 'src/index.js', cwd: path.join(root, 'server') },
  worker: { entry: 'scripts/worker-shim-server.mjs', cwd: root },
};
const runtimeFlag = process.argv.indexOf('--runtime');
const runtimeName = runtimeFlag === -1 ? 'express' : process.argv[runtimeFlag + 1] || 'express';
const runtime = RUNTIMES[runtimeName];
if (!runtime) {
  console.error(`Unknown runtime "${runtimeName}". Use one of: ${Object.keys(RUNTIMES).join(', ')}`);
  process.exit(1);
}

let server;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, pathName, { token, body, form, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  let payload;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${pathName}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${method} ${pathName} failed with ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function expectStatus(status, fn, label) {
  try {
    await fn();
  } catch (err) {
    assert(err.status === status, `${label}: expected ${status}, got ${err.status || err.message}`);
    return err.data || {};
  }
  throw new Error(`${label}: expected ${status}, request succeeded`);
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

function tinyPngFile() {
  return new File([TINY_PNG], 'tiny.png', { type: 'image/png' });
}

/**
 * A photograph of "person <label>" for the stand-in face engine below: the
 * tiny PNG with a marker after its last chunk (image decoders ignore trailing
 * bytes). Two photos with the same label are the same face. `role` says
 * whether it is a case photo or a sighting photo, so the stand-in can check
 * which one the engine sent as the source.
 */
function facePhotoFile(label, role = 'sighting') {
  return new File([Buffer.concat([TINY_PNG, Buffer.from(`KHOZO-SMOKE-FACE:${label}:${role};`)])], `face-${label}.png`, { type: 'image/png' });
}

/**
 * A stand-in for the Aarakshak face-comparison API, so both directions of
 * matching run end to end with no network call and no real face.
 *
 * The API runtimes are pointed at it through AARAKSHAK_API_URL and a test key,
 * with AWS credentials blanked so Rekognition is not configured. It answers the
 * way the real provider does: two photos carrying the same face marker score
 * 0.91 (the genuine-match range), two different faces score 0.03, and a photo
 * with no marker - the plain tiny PNG the rest of the suite uploads - has "no
 * detectable face". `down` makes it fail with 503, the outage the /rematch
 * route exists to recover from.
 */
async function startFakeAarakshak() {
  // `pairs` records [source role, target role] for every two-face comparison;
  // `probes` counts a photo compared with itself (the person/face screen).
  const fake = { down: false, downOnce: 0, calls: 0, pairs: [], probes: 0, key: 'smoke-aarakshak-key', url: null, server: null };
  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      fake.calls += 1;
      if (req.headers['x-api-key'] !== fake.key) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ detail: 'invalid api key' }));
      }
      if (fake.down || fake.downOnce > 0) {
        if (fake.downOnce > 0) fake.downOnce -= 1;
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        return res.end('service unavailable');
      }
      const body = Buffer.concat(chunks).toString('latin1');
      const faces = [...body.matchAll(/KHOZO-SMOKE-FACE:([A-Za-z0-9_-]+):(\w+);/g)];
      if (faces.length < 2) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ detail: 'No detectable face in one of the images' }));
      }
      if (faces[0][0] === faces[1][0]) fake.probes += 1;
      else fake.pairs.push([faces[0][2], faces[1][2]]);
      // A group photo: the screen reports two faces in it.
      const group = /KHOZO-SMOKE-GROUP;/.test(body);
      const same = faces[0][1] === faces[1][1];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        score: same ? 0.91 : 0.03,
        decision_band: same ? 'strong_match' : 'no_match',
        source_faces: group ? [{}, {}] : [{}],
        target_faces: group ? [{}, {}] : [{}],
        source_quality_score: 0.9,
        target_quality_score: 0.9,
      }));
    });
  });
  await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${fake.server.address().port}/api/v1/compare`;
  return fake;
}

/** Calls a route handler directly with stubbed dependencies (no server). */
function routeHarness(deps) {
  const routes = [];
  const router = {
    use: () => router,
    ...Object.fromEntries(
      ['get', 'post', 'put', 'patch', 'delete'].map((method) => [
        method,
        (routePath, ...handlers) => {
          routes.push({ method: method.toUpperCase(), path: routePath, handler: handlers.flat().at(-1) });
          return router;
        },
      ])
    ),
  };
  const pass = (_req, _res, next) => next();
  registerReportRoutes(router, {
    listReports: () => deps.reports,
    findReport: (id) => deps.reports.find((r) => r.id === id) || null,
    listFoundReports: () => deps.foundReports || [],
    findFoundReport: (id) => (deps.foundReports || []).find((f) => f.id === id) || null,
    listUsers: () => deps.users || [],
    addReport: () => {}, updateReport: () => {}, addFoundReport: () => {}, updateFoundReport: () => {},
    addActivity: () => {}, addAudit: () => {}, addNotification: () => {},
    savePhoto: async (key) => key,
    readPhoto: async () => TINY_PNG,
    photoMimeType: () => 'image/png',
    authRequired: pass, optionalAuth: pass, passwordChangeRequired: pass,
    requireRole: () => pass,
    auditPublicRateLimit: () => {}, clientIp: () => 'test',
    fixedWindowRateLimit: () => pass,
    rankMatches: async () => ({ candidates: [], engine: { provider: 'none', biometric: false } }),
    detectPerson: async () => ({ verdict: 'unverified' }),
    upload: { single: () => pass },
    settings: {},
    // Per-check stand-ins: a recorded updateReport, an SMS gateway's settings
    // and a fetch that answers for it.
    ...(deps.overrides || {}),
  });
  return async (method, routePath, { params = {}, query = {}, user = null, body = {} } = {}) => {
    const route = routes.find((r) => r.method === method && r.path === routePath);
    assert(route, `route ${method} ${routePath} should be registered`);
    let status = 200;
    let payload = null;
    let sent = null;
    const res = {
      status(code) { status = code; return res; },
      json(data) { payload = data; return res; },
      type() { return res; },
      send(data) { sent = data; return res; },
      end() { return res; },
    };
    await route.handler({ params, query, user, body, headers: {} }, res);
    return { status, payload, sent };
  };
}

/**
 * A case published as a public appeal before appeals were switched off keeps
 * its `bulletin.published === true` flag. No data migration clears it, so every
 * public read must ignore it. Checked on the route handlers directly, because
 * the API can no longer create such a record.
 */
async function legacyAppealChecks() {
  const legacy = {
    id: 'r_legacyAppeal',
    childName: 'Legacy Appeal Child',
    age: 7,
    gender: 'Female',
    state: 'Gujarat',
    district: 'Surat',
    status: 'missing',
    intakeStatus: 'verified',
    firNo: 'FIR/2026/4242',
    externalIds: [{ idType: 'trackchild', externalId: 'TC-LEGACY-1', label: 'TrackChild ID' }],
    photoFile: 'r_legacyAppeal.png',
    bulletin: { published: true, publishedAt: '2026-10-01T00:00:00.000Z', agency: 'Legacy desk' },
    createdAt: Date.parse('2026-10-01T00:00:00.000Z'),
  };
  // A record handed over on condition that only police see it. No family holds
  // its id, so the public status lookup must not resolve it either.
  const policeOnly = {
    id: 'r_policeOnly1',
    childName: 'Police Only Child',
    age: 11,
    gender: 'Female',
    state: 'Gujarat',
    district: 'Ahmedabad',
    status: 'found',
    intakeStatus: 'verified',
    visibility: 'police',
    createdAt: Date.parse('2026-10-02T00:00:00.000Z'),
  };
  const call = routeHarness({ reports: [legacy, policeOnly] });
  const policeOnlyStatus = await call('GET', '/public/status/:ref', { params: { ref: policeOnly.id } });
  assert(policeOnlyStatus.status === 404, `public status must not resolve a police-only record, got ${policeOnlyStatus.status}`);
  const leaks = (payload) => /Legacy Appeal Child|r_legacyAppeal\.png|TC-LEGACY-1|FIR\/2026\/4242/.test(JSON.stringify(payload));

  const list = await call('GET', '/public/bulletins');
  assert(list.status === 200 && Array.isArray(list.payload.bulletins) && list.payload.bulletins.length === 0, 'a legacy published case must not be listed publicly');
  const page = await call('GET', '/public/bulletins/:id', { params: { id: legacy.id } });
  assert(page.status === 404 && !leaks(page.payload), 'a legacy published case must not have a public page');
  const search = await call('GET', '/public/search', { query: { q: 'Legacy' } });
  assert(search.status === 200 && search.payload.results.length === 0, 'public search must not find a legacy published case by name');
  const summary = await call('GET', '/public/summary');
  assert(summary.payload.summary.publicBulletins === 0 && !leaks(summary.payload), 'public summary must count no appeals and name nobody');
  const photo = await call('GET', '/photo/:key', { params: { key: legacy.id } });
  assert(photo.status === 401 && photo.sent === null, `a legacy published photo must not be served without a token, got ${photo.status}`);
  for (const ref of [legacy.firNo, 'TC-LEGACY-1']) {
    const byRef = await call('GET', '/public/status/:ref', { params: { ref } });
    assert(byRef.status === 404, `public status must not resolve ${ref}`);
  }
  const byId = await call('GET', '/public/status/:ref', { params: { ref: legacy.id } });
  assert(byId.status === 200 && !leaks(byId.payload), 'public status by case id must not name a legacy published case');
  assert(
    Object.keys(byId.payload.status).sort().join() === 'id,message,nextStep,personCategory,registeredAt,status,statusLabel,updatedAt',
    `public status payload keys changed: ${Object.keys(byId.payload.status).sort().join()}`
  );
  const publish = await call('POST', '/:id/bulletin', { params: { id: legacy.id }, body: { publish: true }, user: { id: 'u', role: 'super_admin' } });
  assert(publish.status === 403 && publish.payload.error === PUBLIC_APPEALS_DISABLED, 'publishing must be refused with the fixed message');

  // The /child/:id share preview: the plain document with the default card,
  // and the case store is never read (no database binding is given here).
  const doc = '<html><head><title>Khozo</title><!-- share:start --><meta property="og:image" content="https://khozo.org/assets/share-default.jpg?v=2" /><!-- share:end --></head><body></body></html>';
  const asked = [];
  const env = {
    ASSETS: {
      fetch: async (req) => {
        asked.push(new URL(req.url).pathname);
        return new Response(doc, { status: 200, headers: { 'content-type': 'text/html' } });
      },
    },
  };
  const preview = await khozoWorker.fetch(new Request(`https://khozo.test/child/${legacy.id}`), env, { waitUntil() {} });
  const previewHtml = await preview.text();
  assert(preview.status === 200, `/child/:id should serve the app document, got ${preview.status}`);
  assert(previewHtml === doc, '/child/:id must serve the SPA document unchanged, with the default share card');
  assert(asked.join() === '/', `/child/:id should ask the asset server for "/" only, asked ${asked.join()}`);
}

/**
 * The sighting receipt's stage is a function of time alone.
 *
 * It used to follow officers' decisions, and only sightings the engines linked
 * to a case were reliably decided, so "closed" came to mean "matched". Here the
 * same submission time with every outcome an officer or engine can produce
 * must read identically at every point in its life, and the stages must still
 * move: received, then under review, then closed.
 */
function receiptStageChecks() {
  const sentAt = Date.parse('2026-10-01T10:00:00.000Z');
  const base = { createdAt: sentAt, foundLocation: 'Near Kalupur bus stand', personCategory: 'woman' };
  const outcomes = [
    { id: 'f_a', status: 'no_match' },
    { id: 'f_b', status: 'pending_review', matchedReportId: 'r_x', matchScore: 0.91 },
    { id: 'f_c', status: 'matched', matchedReportId: 'r_x', publicStage: 'closed' },
    { id: 'f_d', status: 'rejected', matchedReportId: 'r_x', publicStage: 'closed' },
    { id: 'f_e', status: 'referred_cwc', publicStage: 'under_review' },
    { id: 'f_f', status: 'cwc_followup_complete', publicStage: 'closed' },
    { id: 'f_g', status: 'formalized_case', publicStage: 'under_review' },
  ].map((row) => ({ ...base, ...row }));
  const stripId = ({ id, ...rest }) => rest;
  const at = [
    [sentAt + 60 * 1000, 'received'],
    [sentAt + SIGHTING_RECEIVED_WINDOW_MS + 60 * 1000, 'under_review'],
    [sentAt + SIGHTING_REVIEW_WINDOW_MS + 60 * 1000, 'closed'],
  ];
  for (const [now, expected] of at) {
    const seen = outcomes.map((row) => JSON.stringify(stripId(publicSightingStatus(row, now))));
    assert(new Set(seen).size === 1, `every outcome must read the same at ${new Date(now).toISOString()}: ${[...new Set(seen)].join(' | ')}`);
    const stage = publicSightingStatus(outcomes[0], now).stage;
    assert(stage === expected, `a sighting sent ${Math.round((now - sentAt) / 3600000)}h ago should read "${expected}", got "${stage}"`);
  }
}

/**
 * How an officer records that a match is the person: sent with every
 * confirmation (POST /reports/found/:id/review with decision 'matched', and
 * POST /reports/:id/confirm-match).
 */
const SMOKE_VERIFICATION = {
  method: 'in_person',
  verifiedBy: 'Smoke Verifier Inspector',
  place: 'Smoke Police Station, Mumbai',
  note: 'Compared the birthmark and the school ID card with the guardian present.',
};

/**
 * Jurisdiction fails closed, checked on the route handlers themselves: an
 * account the API can no longer create (a district desk with no district, a
 * state desk with no state) must see nothing, and a district desk matches on
 * its state as well as the district's name.
 */
async function scopeRouteChecks() {
  const verified = { status: 'missing', intakeStatus: 'verified', registeredById: 'u_somebody' };
  const reports = [
    { id: 'r_mhAurangabad', childName: 'Maharashtra Aurangabad Child', state: 'Maharashtra', district: 'Aurangabad', ...verified },
    { id: 'r_brAurangabad', childName: 'Bihar Aurangabad Child', state: 'Bihar', district: 'Aurangabad', ...verified },
    { id: 'r_mhMumbai', childName: 'Mumbai Suburban Child', state: 'Maharashtra', district: 'Mumbai Suburban District', ...verified },
  ];
  const foundReports = [
    { id: 'f_unplaced', status: 'no_match', foundLocation: 'Somewhere' },
    { id: 'f_mhAurangabad', status: 'no_match', state: 'Maharashtra', district: 'Aurangabad', foundLocation: 'Bus stand' },
    { id: 'f_brAurangabad', status: 'no_match', state: 'Bihar', district: 'Aurangabad', foundLocation: 'Bus stand' },
  ];
  const call = routeHarness({ reports, foundReports });
  const cases = async (role, jurisdiction) =>
    (await call('GET', '/', { user: { id: `u_${role}`, role, jurisdiction } })).payload.reports.map((r) => r.id).sort().join();
  const sightings = async (role, jurisdiction) =>
    (await call('GET', '/found/all', { user: { id: `u_${role}`, role, jurisdiction } })).payload.foundReports.map((f) => f.id).sort().join();

  for (const role of ['police', 'cwc', 'dlsa']) {
    assert(await cases(role, { state: 'Maharashtra' }) === '', `a ${role} desk with no district must see no case`);
    assert(await sightings(role, { state: 'Maharashtra' }) === '', `a ${role} desk with no district must see no sighting, not even an unplaced one`);
    assert(await cases(role, { district: 'Aurangabad' }) === '', `a ${role} desk with a district but no state must see no case`);
  }
  for (const role of ['admin', 'state_nodal', 'crime_bureau']) {
    assert(await cases(role, {}) === '', `a ${role} desk with no state must see no case`);
    assert(await sightings(role, {}) === '', `a ${role} desk with no state must see no sighting`);
  }
  const mhPolice = { state: 'Maharashtra', district: 'Aurangabad' };
  assert(await cases('police', mhPolice) === 'r_mhAurangabad', `Aurangabad police in Maharashtra must not see Bihar's Aurangabad: ${await cases('police', mhPolice)}`);
  assert(await cases('police', { state: 'Bihar', district: 'Aurangabad' }) === 'r_brAurangabad', 'and Bihar police see only theirs');
  assert(await sightings('police', mhPolice) === 'f_mhAurangabad,f_unplaced', `sightings follow the state too: ${await sightings('police', mhPolice)}`);
  const other = await call('GET', '/:id', { params: { id: 'r_brAurangabad' }, user: { id: 'u_police', role: 'police', jurisdiction: mhPolice } });
  assert(other.status === 403, `opening the other state's case should be refused, got ${other.status}`);
  assert(await cases('police', { state: 'Maharashtra', district: 'Mumbai' }) === 'r_mhMumbai', 'district aliases still apply (Mumbai Suburban District is Mumbai)');
  assert(await cases('admin', { state: 'Maharashtra' }) === 'r_mhAurangabad,r_mhMumbai', 'a state desk sees its state');
  assert(await cases('super_admin', {}) === 'r_brAurangabad,r_mhAurangabad,r_mhMumbai', 'the super admin is the national role');
}

/**
 * Telling the family, against a stand-in SMS gateway: an SMS is recorded only
 * when the gateway takes it, and a woman's family is not texted or offered to
 * the officer without her consent.
 */
async function familySmsChecks() {
  const base = {
    personCategory: 'child', state: 'Gujarat', district: 'Surat', status: 'missing', intakeStatus: 'verified',
    parentName: 'Smoke Sms Parent', parentPhone: '98765 00300', parentPhoneSource: 'provided',
  };
  const child = { ...base, id: 'r_smsChild', childName: 'Smoke Sms Child' };
  const woman = { ...base, id: 'r_smsWoman', childName: 'Smoke Sms Woman', personCategory: 'woman' };
  const officer = { id: 'u_smsPolice', role: 'police', name: 'Surat Smoke Officer', org: 'Surat City Police', phone: '0261-2400100', jurisdiction: { state: 'Gujarat', district: 'Surat' } };
  const updates = [];
  const audits = [];
  const sent = [];
  const harness = (gatewayOk) => routeHarness({
    reports: [child, woman],
    users: [officer],
    overrides: {
      updateReport: (id, patch) => updates.push({ id, patch }),
      addAudit: (row) => audits.push(row),
      settings: { smsGatewayUrl: 'https://sms-gateway.smoke.test/send', smsApiKey: 'smoke-sms-key' },
      fetchImpl: async (url, init) => {
        sent.push({ url, init });
        return { ok: gatewayOk, status: gatewayOk ? 200 : 500 };
      },
    },
  });
  const reset = () => { updates.length = 0; audits.length = 0; sent.length = 0; };

  let call = harness(true);
  const ok = await call('POST', '/:id/send-sms', { params: { id: child.id }, user: officer, body: {} });
  assert(ok.status === 200 && ok.payload.sent === true && ok.payload.phone === '98765 00300', `a gateway that takes the SMS should be reported as sent: ${JSON.stringify(ok.payload)}`);
  assert(ok.payload.message === FAMILY_SMS_MESSAGES.sent, 'the sent answer should use the fixed sentence');
  assert(sent.length === 1 && sent[0].url === 'https://sms-gateway.smoke.test/send', 'the SMS should go to the configured gateway, once');
  assert(sent[0].init.headers.Authorization === 'Bearer smoke-sms-key', 'the gateway key should be sent as a bearer token');
  const sms = JSON.parse(sent[0].init.body);
  assert(sms.to === '9876500300', `the SMS should go to the family's digits, got ${sms.to}`);
  assert(sms.message.includes(child.id) && !sms.message.includes(child.childName) && !sms.message.includes('Surat,'), 'the SMS names the case id, never the person or where they are');
  assert(updates.some((u) => u.id === child.id && u.patch.smsSent === true && u.patch.familyInformedAt && u.patch.familyContacts?.[0]?.via === 'gateway'), 'a sent SMS should be recorded on the case');
  assert(audits.some((row) => row.action === 'case.sms_sent' && row.metadata?.phoneSuffix === '0300'), 'a sent SMS should be audited');

  reset();
  call = harness(false);
  const refused = await call('POST', '/:id/send-sms', { params: { id: child.id }, user: officer, body: {} });
  assert(refused.status === 200 && refused.payload.sent === false && refused.payload.reason === 'gateway_failed' && refused.payload.phone === '98765 00300',
    `a gateway that refuses should be reported as not sent, with the number to call: ${JSON.stringify(refused.payload)}`);
  assert(refused.payload.message === FAMILY_SMS_MESSAGES.gateway_failed, 'a refused SMS should tell the officer to call');
  assert(!updates.some((u) => u.patch.smsSent === true), 'a refused SMS must not be recorded as sent');
  assert(audits.some((row) => row.action === 'case.sms_not_sent' && row.metadata?.reason === 'gateway_failed'), 'a refused SMS should be audited as not sent');

  reset();
  call = harness(true);
  const confirmed = await call('POST', '/:id/confirm-match', { params: { id: child.id }, user: officer, body: { sendSms: true, verification: SMOKE_VERIFICATION } });
  assert(confirmed.status === 200 && confirmed.payload.familyNotified === true && sent.length === 1, `confirm-match with a gateway should text the family: ${JSON.stringify(confirmed.payload)}`);
  const withoutVerification = await call('POST', '/:id/confirm-match', { params: { id: child.id }, user: officer, body: { sendSms: true } });
  assert(withoutVerification.status === 400 && withoutVerification.payload.error === VERIFICATION_REQUIRED, 'confirm-match without a verification should be refused');

  reset();
  const womanConfirmed = await call('POST', '/:id/confirm-match', { params: { id: woman.id }, user: officer, body: { sendSms: true, verification: SMOKE_VERIFICATION } });
  assert(
    womanConfirmed.payload.familyNotified === false && womanConfirmed.payload.familyPhone === null && womanConfirmed.payload.personConsentRequired === true && sent.length === 0,
    `a woman's family is neither texted nor offered to the officer without her consent: ${JSON.stringify(womanConfirmed.payload)}`
  );
  const womanSms = await call('POST', '/:id/send-sms', { params: { id: woman.id }, user: officer, body: {} });
  assert(womanSms.status === 409 && womanSms.payload.code === 'person_consent_required' && sent.length === 0, 'an SMS to a woman\'s family without consent is refused');
  const womanConsented = await call('POST', '/:id/send-sms', { params: { id: woman.id }, user: officer, body: { personConsent: true } });
  assert(womanConsented.payload.sent === true && sent.length === 1, 'with her consent recorded, the SMS goes');
}

function textFile() {
  return new File(['not an image'], 'note.txt', { type: 'text/plain' });
}

function addDeclaration(form, signer = 'Smoke Declarant') {
  form.set('declarationAccepted', 'true');
  form.set('declarationSignerName', signer);
  form.set('relationshipToChild', 'guardian');
  form.set('declarationSignerRole', 'parent');
  form.set('declarationMethod', 'digital');
  return form;
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const health = await request('GET', '/health');
      if (health.ok) return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('API did not become healthy');
}

async function login(email) {
  const data = await request('POST', '/auth/login', { body: { email, password: 'khozo123' } });
  assert(data.token, `Missing token for ${email}`);
  return data;
}

async function publicOtp(phone) {
  const data = await request('POST', '/auth/otp/start', { body: { phone } });
  assert(data.demoOtp, 'demo OTP should be returned outside production');
  return data.demoOtp;
}

function uniquePassword() {
  return `KhozoSmoke-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function futureDate(days = 30) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Missing women and adult persons, alongside children.
 *
 * Covers the personCategory field (validation, the adult age limits, the
 * child default for every record and client that predates it, and the payloads
 * that carry it), the adult-consent rule for family alerts, the police-only
 * visibility flag, and the duplicate false positive that blocked bulk imports.
 */
async function personCategoryChecks({ superAdmin, sjpu, cwc, parent }) {
  // --- Duplicate score: an agency phone is not evidence of family ----------
  // When a case has no guardian number the route records the registering
  // officer's phone instead. Every case that desk registers then shares it,
  // which used to add +0.28 and flag unrelated children as duplicates.
  const officerPhone = '022-2400-1120';
  const nonFamily = nonFamilyPhoneSet([{ role: 'sjpu', phone: officerPhone }, { role: 'parent', phone: '9788197570' }]);
  const unrelatedA = { childName: 'Ramesh Patel', gender: 'Male', age: 8, state: 'Gujarat', district: 'Surat', parentPhone: officerPhone };
  const unrelatedB = { childName: 'Kiran Shah', gender: 'Male', age: 9, state: 'Gujarat', district: 'Surat', parentPhone: officerPhone };
  assert(duplicateScore(unrelatedA, unrelatedB) >= 0.58, 'regression precondition: an uncorrected shared officer phone crosses the duplicate threshold');
  assert(duplicateScore(unrelatedA, unrelatedB, { nonFamilyPhones: nonFamily }) < 0.58, 'an agency account phone must not count as duplicate evidence');
  assert(
    duplicateScore({ ...unrelatedA, parentPhoneSource: 'registering_officer' }, { ...unrelatedB, parentPhoneSource: 'registering_officer' }) < 0.58,
    'a phone recorded as the registering officer fallback must not count as duplicate evidence'
  );
  assert(
    duplicateScore({ ...unrelatedA, parentPhone: '9876500001' }, { ...unrelatedB, childName: 'Ramesh Patel', parentPhone: '9876500001' }, { nonFamilyPhones: nonFamily }) >= 0.58,
    'a shared family phone should still count toward a duplicate'
  );
  assert(
    duplicateScore({ ...unrelatedA, parentPhone: '9788197570' }, { ...unrelatedB, childName: 'Ramesh Patel', parentPhone: '9788197570' }, { nonFamilyPhones: nonFamily }) >= 0.58,
    'a parent account phone is a family phone and should still count'
  );

  // The same through the API: one SJPU desk registers two different children
  // without guardian numbers. Before the fix the second was refused as a
  // duplicate of the first (and of every earlier blank-phone case in Mumbai).
  assert(sjpu.user?.phone, 'SJPU demo account should have a phone for the duplicate regression');
  const blankPhoneCases = [];
  for (const [name, age] of [['Ramesh Patel', '8'], ['Kiran Shah', '9']]) {
    const form = new FormData();
    form.set('childName', name);
    addDeclaration(form, 'Smoke Bulk Officer');
    form.set('gender', 'Male');
    form.set('age', age);
    form.set('state', 'Maharashtra');
    form.set('district', 'Mumbai');
    const created = await request('POST', '/reports', { token: sjpu.token, form });
    assert(created.report.parentPhoneSource === 'registering_officer', 'a blank guardian phone should be recorded as the officer fallback');
    assert(created.report.personCategory === 'child', 'a report without personCategory should default to child');
    blankPhoneCases.push(created.report);
  }

  // --- personCategory validation and the adult age limits -----------------
  const caseForm = (fields) => {
    const form = new FormData();
    addDeclaration(form, 'Smoke Category Declarant');
    form.set('state', 'Maharashtra');
    form.set('district', 'Mumbai');
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  };
  await expectStatus(400, () => request('POST', '/reports', { token: sjpu.token, form: caseForm({ childName: 'Smoke Bad Category', personCategory: 'elder', age: '40' }) }), 'unknown person category');
  await expectStatus(400, () => request('POST', '/reports', { token: sjpu.token, form: caseForm({ childName: 'Smoke Young Woman', personCategory: 'woman', age: '15' }) }), 'woman under 18');
  await expectStatus(400, () => request('POST', '/reports', { token: sjpu.token, form: caseForm({ childName: 'Smoke Young Adult', personCategory: 'adult', age: '17' }) }), 'adult under 18');
  await expectStatus(400, () => request('POST', '/reports', { token: sjpu.token, form: caseForm({ childName: 'Smoke Old Adult', personCategory: 'adult', age: '111' }) }), 'adult over 110');
  await expectStatus(400, () => request('POST', '/reports', { token: sjpu.token, form: caseForm({ childName: 'Smoke Male Woman', personCategory: 'woman', age: '30', gender: 'Male' }) }), 'woman recorded as Male');
  await expectStatus(400, () => request('POST', '/reports', { token: sjpu.token, form: caseForm({ childName: 'Smoke Adult Child', age: '25' }) }), 'child category keeps the 18 age limit');

  const woman = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Smoke Missing Woman', personCategory: 'woman', age: '32', parentPhone: '9876500111', parentName: 'Smoke Husband' }),
  });
  assert(woman.report.personCategory === 'woman', 'a missing woman should be stored with personCategory woman');
  assert(woman.report.gender === 'Female', 'a missing woman should default to Female');
  assert(woman.report.age === 32, 'a missing woman should accept an adult age');
  assert(woman.report.status === 'missing', 'an SJPU-registered woman case should be an active missing case');
  assert(!woman.report.bulletin?.published, 'an adult case should not be a public bulletin by default');
  const adult = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Smoke Missing Adult', personCategory: 'adult', age: '74', gender: 'Male', parentPhone: '9876500112' }),
  });
  assert(adult.report.personCategory === 'adult', 'a missing adult should be stored with personCategory adult');
  assert(adult.report.age === 74, 'a missing adult should accept an elderly age');

  // --- Payloads carry the category -----------------------------------------
  const sjpuCases = await request('GET', '/reports', { token: sjpu.token });
  assert(sjpuCases.reports.every((row) => ['child', 'woman', 'adult'].includes(row.personCategory)), 'every listed case should carry personCategory');
  assert(sjpuCases.reports.find((row) => row.id === woman.report.id)?.personCategory === 'woman', 'case list should mark the woman case');
  assert(sjpuCases.reports.find((row) => row.childName === 'Imran')?.personCategory === 'child', 'a seeded case without the field should list as child');
  const womenOnly = await request('GET', '/reports?category=woman', { token: sjpu.token });
  assert(womenOnly.reports.length >= 1 && womenOnly.reports.every((row) => row.personCategory === 'woman'), 'case list should filter by category');
  const womanDetail = await request('GET', `/reports/${woman.report.id}`, { token: sjpu.token });
  assert(womanDetail.report.personCategory === 'woman', 'case detail should carry personCategory');
  // The public lookup takes the Khozo case id only; an FIR number is guessable.
  await expectStatus(404, () => request('GET', `/reports/public/status/${encodeURIComponent(woman.report.firNo)}`), 'public case status by FIR number');
  const womanStatus = await request('GET', `/reports/public/status/${woman.report.id}`);
  assert(womanStatus.status.personCategory === 'woman', 'public case status should carry personCategory');
  assert(womanStatus.status.nextStep.includes('181'), 'public case status for a woman should point to the Women Helpline 181');
  assert(!womanStatus.status.nextStep.includes('1098'), 'public case status for a woman should not point to Childline 1098');
  assert(!('publicName' in womanStatus.status), 'public case status should carry no name field at all');
  assert(!JSON.stringify(womanStatus).includes('Smoke Missing Woman'), 'public case status should never name the person');

  const categoryStats = await request('GET', '/dashboard/stats', { token: sjpu.token });
  assert(categoryStats.categorySplit?.find((row) => row.category === 'woman')?.active >= 1, 'dashboard stats should split active cases by category');
  assert(categoryStats.categorySplit?.find((row) => row.category === 'child')?.total >= 1, 'dashboard stats should count children');
  const categoryMis = await request('GET', '/dashboard/mis', { token: sjpu.token });
  assert(categoryMis.demographics.byCategory?.some((row) => row.name === 'Woman'), 'MIS should break cases down by category');
  assert(categoryMis.demographics.byAgeBand?.some((row) => row.name === '31-59'), 'MIS age bands should place adults in adult bands');
  const directory = await request('GET', '/dashboard/public/directory');
  assert(directory.emergency.some((row) => row.phone === '181'), 'public directory should include the Women Helpline 181');

  // --- Sightings of a woman / adult ----------------------------------------
  const sightingForm = (fields, phone) => {
    const form = new FormData();
    form.set('foundLocation', 'Near Surat railway station');
    form.set('state', 'Gujarat');
    form.set('district', 'Surat');
    form.set('note', 'Smoke category sighting');
    form.set('reporterPhone', phone);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  };
  await expectStatus(400, () => request('POST', '/reports/found', { form: sightingForm({ ageApprox: '30' }, '9000000701') }), 'child sighting with an adult age');
  await expectStatus(400, () => request('POST', '/reports/found', { form: sightingForm({ personCategory: 'adult', ageApprox: '12' }, '9000000702') }), 'adult sighting with a child age');
  await expectStatus(400, () => request('POST', '/reports/found', { form: sightingForm({ personCategory: 'elder' }, '9000000703') }), 'sighting with unknown category');
  const womanSighting = await request('POST', '/reports/found', { form: sightingForm({ personCategory: 'woman', ageApprox: '30' }, '9000000704') });
  assert(womanSighting.foundReport.status === 'received', 'a woman sighting receipt should be neutral');
  assert(womanSighting.review === NEUTRAL_SIGHTING_RECEIPT, 'a woman sighting receipt should use the neutral review text');
  assert(womanSighting.candidates.length === 0, 'a public receipt should never list candidates');
  assert(womanSighting.foundReport.personCategory === 'woman', 'sighting receipt should carry personCategory');
  const storedWomanSighting = (await request('GET', '/reports/found/all', { token: superAdmin.token })).foundReports.find((row) => row.id === womanSighting.foundReport.id);
  assert(storedWomanSighting?.personCategory === 'woman', 'stored sighting should carry personCategory');
  assert(storedWomanSighting.ageApprox === 30, 'a woman sighting should accept an adult approximate age');
  assert(storedWomanSighting.gender === 'Female', 'a woman sighting should default to Female');
  assert(storedWomanSighting.referredTo1098 === false, 'an adult sighting should not be referred to Childline 1098');
  const womanSightingStatus = await request('GET', `/reports/found/status/${womanSighting.foundReport.id}`);
  assert(womanSightingStatus.status.stage === 'received', 'a woman sighting status should start at the received stage');
  assert(womanSightingStatus.status.nextStep.includes('181'), 'public sighting status for a woman should point to the Women Helpline 181');
  const womanIntake = await request('POST', `/reports/found/${womanSighting.foundReport.id}/formal-intake`, {
    token: superAdmin.token,
    body: { childName: 'Unknown woman Surat', intakeAuthority: 'One Stop Centre Surat', note: 'Smoke formal intake for an adult woman sighting.' },
  });
  assert(womanIntake.report.personCategory === 'woman', 'formal intake from a woman sighting should stay a woman case');
  assert(womanIntake.report.age === 30, 'formal intake from a woman sighting should keep the adult age');
  // A police officer filing from the console still sees the real outcome.
  const officerSighting = await request('POST', '/reports/found', { token: sjpu.token, form: sightingForm({}, '9000000705') });
  assert(officerSighting.foundReport.status === 'no_match', 'a police officer filing a sighting should see the stored status');
  assert('matchScore' in officerSighting.foundReport, 'a police officer filing a sighting should see the match score');
  // A non-police desk gets the public receipt: the comparison also runs
  // against police-only records, which a CWC desk may not see.
  const deskSighting = await request('POST', '/reports/found', { token: cwc.token, form: sightingForm({}, '9000000706') });
  assert(
    deskSighting.foundReport.status === 'received' && !('matchScore' in deskSighting.foundReport) && deskSighting.review === NEUTRAL_SIGHTING_RECEIPT,
    'a CWC desk filing a sighting should get the neutral receipt'
  );

  // --- A confirmation records how the identity was verified ------------------
  const confirmWoman = (body) => request('POST', `/reports/${woman.report.id}/confirm-match`, { token: sjpu.token, body });
  const unverified = await expectStatus(400, () => confirmWoman({ sendSms: true, foundLocation: 'Smoke location' }), 'confirm a match without recording the verification');
  assert(unverified.error === VERIFICATION_REQUIRED, `a confirmation without verification should say why: ${unverified.error}`);
  await expectStatus(400, () => confirmWoman({ verification: { ...SMOKE_VERIFICATION, note: 'Looked ok' } }), 'a verification note under 10 characters');
  await expectStatus(400, () => confirmWoman({ verification: { ...SMOKE_VERIFICATION, method: 'telepathy' } }), 'an unknown verification method');
  await expectStatus(400, () => confirmWoman({ verification: { ...SMOKE_VERIFICATION, place: '' } }), 'a verification with no place');
  await expectStatus(400, () => confirmWoman({ verification: { ...SMOKE_VERIFICATION, verifiedBy: { name: 'x' } } }), 'a verification whose verifier is an object');
  assert((await request('GET', `/reports/${woman.report.id}`, { token: sjpu.token })).report.status === 'missing', 'a refused confirmation leaves the case as it was');

  // --- A traced adult decides whether the family is told -------------------
  const womanFound = await confirmWoman({ sendSms: true, foundLocation: 'Smoke location', verification: SMOKE_VERIFICATION });
  assert(womanFound.report.status === 'found', 'a woman case can be confirmed found');
  assert(womanFound.report.smsSent === false, 'confirming an adult as found must not alert the family without consent');
  assert(
    womanFound.familyNotified === false && womanFound.familyPhone === null && womanFound.personConsentRequired === true,
    `no family number is offered for a woman who has not consented: ${JSON.stringify({ ...womanFound, report: undefined })}`
  );
  assert(
    womanFound.report.verification?.method === 'in_person' &&
      womanFound.report.verification.verifiedBy === SMOKE_VERIFICATION.verifiedBy &&
      womanFound.report.verification.place === SMOKE_VERIFICATION.place &&
      womanFound.report.verification.note === SMOKE_VERIFICATION.note &&
      womanFound.report.verification.recordedByRole === 'sjpu',
    `the verification should be stored on the case: ${JSON.stringify(womanFound.report.verification)}`
  );
  assert(
    womanFound.report.workflow?.some((e) => e.action === 'match_confirmed' && e.verification?.place === SMOKE_VERIFICATION.place),
    'the match_confirmed workflow event should carry the verification'
  );
  const womanConsent = await expectStatus(409, () => request('POST', `/reports/${woman.report.id}/send-sms`, { token: sjpu.token, body: {} }), 'family alert for an adult without consent');
  assert(womanConsent.error === PERSON_CONSENT_REQUIRED && womanConsent.code === 'person_consent_required', 'the consent refusal is unchanged');
  // No gateway is connected in this run: the answer says so, gives the number
  // to call, and the case does not claim an SMS.
  const consented = await request('POST', `/reports/${woman.report.id}/send-sms`, { token: sjpu.token, body: { personConsent: true } });
  assert(
    consented.sent === false && consented.reason === 'no_gateway' && consented.phone === '9876500111' && consented.message === FAMILY_SMS_MESSAGES.no_gateway,
    `with no gateway, send-sms should say no SMS went and give the family's number: ${JSON.stringify({ ...consented, report: undefined })}`
  );
  assert(consented.report.smsSent === false, 'with no gateway, the case must not record an SMS');
  // The officer calls instead, and records it.
  const contactWoman = (token, body) => request('POST', `/reports/${woman.report.id}/family-contacted`, { token, body });
  await expectStatus(409, () => contactWoman(sjpu.token, { method: 'call' }), 'family contact for a woman without consent');
  await expectStatus(400, () => contactWoman(sjpu.token, { method: 'pigeon', personConsent: true }), 'an unknown family contact method');
  await expectStatus(400, () => contactWoman(sjpu.token, { method: 'call', note: { said: 'x' }, personConsent: true }), 'a family contact note that is an object');
  await expectStatus(403, () => contactWoman(parent.token, { method: 'call', personConsent: true }), 'a parent records a family contact');
  const contacted = await contactWoman(sjpu.token, { method: 'call', note: 'Spoke to her sister, with her consent', personConsent: true });
  const contact = contacted.report.familyContacts?.[0];
  assert(
    contacted.report.familyContacts.length === 1 && contact.method === 'call' && contact.byRole === 'sjpu' && contact.byId === sjpu.user.id &&
      contact.note === 'Spoke to her sister, with her consent' && contact.at && contacted.report.familyInformedAt === contact.at,
    `the family contact should be recorded: ${JSON.stringify(contacted.report.familyContacts)}`
  );
  assert(contacted.report.workflow.some((e) => e.action === 'family_contacted'), 'a family contact is a workflow event');
  assert(contacted.report.smsSent === false, 'a recorded call is not an SMS');
  const childFound = await request('POST', `/reports/${blankPhoneCases[0].id}/confirm-match`, {
    token: sjpu.token,
    body: { sendSms: true, foundLocation: 'Smoke location', verification: SMOKE_VERIFICATION },
  });
  assert(
    childFound.report.smsSent === false && childFound.familyNotified === false && childFound.familyReason === 'no_gateway' && childFound.familyMessage === FAMILY_SMS_MESSAGES.no_gateway,
    `confirming a child as found must not claim an SMS when none went: ${JSON.stringify({ ...childFound, report: undefined })}`
  );
  assert(childFound.familyPhone === null, "the registering officer's own number is not offered as the family's");
  const cwcContact = await request('POST', `/reports/${blankPhoneCases[0].id}/family-contacted`, { token: cwc.token, body: { method: 'visit' } });
  assert(cwcContact.report.familyContacts?.[0]?.byRole === 'cwc' && cwcContact.report.familyContacts[0].method === 'visit', 'a CWC desk can record that it told the family');
  const consentAudit = (await request('GET', '/dashboard/audit', { token: superAdmin.token })).audit;
  const confirmRow = consentAudit.find((row) => row.action === 'case.match_confirmed' && row.targetId === woman.report.id);
  assert(confirmRow?.metadata?.verification?.method === 'in_person', 'the confirmation audit row should carry the verification');
  assert(!confirmRow.summary.includes(SMOKE_VERIFICATION.verifiedBy), 'the audit summary should not name who verified');
  assert(consentAudit.some((row) => row.action === 'case.family_contacted' && row.targetId === woman.report.id && row.metadata?.method === 'call'), 'a family contact should be audited');
  assert(consentAudit.some((row) => row.action === 'case.sms_not_sent' && row.targetId === woman.report.id && row.metadata?.reason === 'no_gateway'), 'an SMS that could not go should be audited');
  const recoveredSearch = await request('GET', '/reports/public/search?status=found');
  assert(recoveredSearch.results.length === 0, 'public search should never return a case, recovered or not');

  // --- Police-only visibility ----------------------------------------------
  const restricted = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Smoke Restricted Case', age: '12', gender: 'Female', parentPhone: '9876500113', visibility: 'police' }),
  });
  assert(restricted.report.visibility === 'police', 'a police role should be able to mark a case police-only');
  await expectStatus(400, () => request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Smoke Bad Visibility', age: '12', gender: 'Male', parentPhone: '9876500114', visibility: 'public' }),
  }), 'unknown visibility value');
  const parentVisibilityForm = new FormData();
  parentVisibilityForm.set('childName', 'Smoke Parent Visibility');
  addDeclaration(parentVisibilityForm);
  parentVisibilityForm.set('age', '6');
  parentVisibilityForm.set('gender', 'Female');
  parentVisibilityForm.set('parentPhone', '9876500115');
  parentVisibilityForm.set('visibility', 'police');
  const parentVisibility = await request('POST', '/reports', { token: parent.token, form: parentVisibilityForm });
  assert(!('visibility' in parentVisibility.report), 'visibility from a non-police role should be ignored');
}

const NEUTRAL_SIGHTING_RECEIPT = 'Thank you. Your report has reached the police and child-protection desks for this area. Keep your receipt number to track it.';

/**
 * Matching in both directions, against the stand-in face engine, and who is
 * told what about it.
 *
 *   forward  a sighting of a registered case is linked when it arrives, and
 *            its reporter cannot tell that from a sighting of nobody: not from
 *            the receipt, not from the status lookup, and not from the inbox of
 *            any desk that cannot open the case;
 *   reverse  a sighting of someone not yet reported is linked when the case is
 *            registered (POST /reports answers sightingMatches), again by
 *            POST /reports/:id/rematch after a provider outage, and when a
 *            family's intake is verified; an officer who rejects a reverse link
 *            puts the sighting back where it was;
 *   rule 2   a police-only case is never revealed to a non-police desk: not by
 *            the sighting response, an alert, the review queue or the public
 *            status lookup;
 *   rule 4   an officer decides every match; a woman's family learns nothing
 *            from her case page, and parent and NGO accounts are never alerted.
 */
async function twoWayMatchingChecks({ superAdmin, sjpu, cwc, dlsa, ngo, parent, fake }) {
  const where = { state: 'Maharashtra', district: 'Mumbai' };
  const pune = { state: 'Maharashtra', district: 'Pune' };
  const thane = { state: 'Maharashtra', district: 'Thane' };
  const caseForm = (fields, label) => {
    const form = new FormData();
    addDeclaration(form, 'Smoke Two-Way Declarant');
    for (const [key, value] of Object.entries({ ...where, ...fields })) form.set(key, value);
    if (label) {
      form.set('photoConsent', 'true');
      form.set('photo', facePhotoFile(label, 'case'));
    }
    return form;
  };
  const sightingForm = (label, phone, { at = where, foundLocation = 'Near Dadar flower market', personCategory = null } = {}) => {
    const form = new FormData();
    form.set('foundLocation', foundLocation);
    form.set('state', at.state);
    form.set('district', at.district);
    form.set('note', 'Two-way smoke sighting');
    form.set('reporterPhone', phone);
    if (personCategory) form.set('personCategory', personCategory);
    form.set('photoConsent', 'true');
    form.set('photo', facePhotoFile(label));
    return form;
  };
  const storedSighting = async (id) =>
    (await request('GET', '/reports/found/all', { token: superAdmin.token })).foundReports.find((row) => row.id === id);
  const storedCase = async (id) => (await request('GET', `/reports/${id}`, { token: superAdmin.token })).report;
  const inbox = async (account) => (await request('GET', '/dashboard/notifications', { token: account.token })).notifications;
  const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const STATUS_KEYS = 'foundLocation,id,message,nextStep,stage,submittedAt';

  // --- Forward: a sighting of a registered case, and a sighting of nobody ---
  // The case is in Mumbai and both sightings are reported in Pune. A strong
  // match moves the stored sighting to the case's district, so a receipt or an
  // alert worded from the stored record instead of the reporter's own place
  // would differ between the two.
  const caseA = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Aarav Deshmukh', gender: 'Male', age: '9', parentPhone: '9876500201' }, 'A'),
  });
  assert(caseA.sightingMatches === 0, `a case with no stored sighting of that face should link none, got ${caseA.sightingMatches}`);
  const atPune = { at: pune, foundLocation: 'Near Pune railway station' };
  const forwardPairsFrom = fake.pairs.length;
  const matchedReceipt = await request('POST', '/reports/found', { form: sightingForm('A', '9000000801', atPune) });
  const forwardPairs = fake.pairs.slice(forwardPairsFrom);
  assert(
    forwardPairs.some(([, target]) => target === 'case') && forwardPairs.every(([source]) => source === 'sighting'),
    `the forward search should send the sighting photo as the source: ${JSON.stringify(forwardPairs)}`
  );
  const unmatchedReceipt = await request('POST', '/reports/found', { form: sightingForm('Z', '9000000802', atPune) });
  const matchedStored = await storedSighting(matchedReceipt.foundReport.id);
  const unmatchedStored = await storedSighting(unmatchedReceipt.foundReport.id);
  // Preconditions: the engines really did tell the two apart, and the match
  // moved the stored sighting to the case's district.
  assert(matchedStored?.matchedReportId === caseA.report.id && matchedStored.status === 'pending_review', 'a sighting of a registered face should be linked for review');
  assert(matchedStored.matchEngine?.provider === 'aarakshak-live-v1' && matchedStored.matchEngine?.biometric === true, 'the forward link should come from the face engine');
  assert(!unmatchedStored?.matchedReportId && unmatchedStored.status === 'no_match', 'a sighting of an unregistered face should stay unlinked');
  assert(matchedStored.district === 'Mumbai' && unmatchedStored.district === 'Pune', 'precondition: a strong match takes the case jurisdiction');
  // What the two reporters were told is identical, and is their own place.
  assert(
    matchedReceipt.foundReport.state === 'Maharashtra' && matchedReceipt.foundReport.district === 'Pune',
    `the public receipt must echo the reporter's location, never the matched case's: ${JSON.stringify(matchedReceipt.foundReport)}`
  );
  assert(
    JSON.stringify(without(matchedReceipt.foundReport, ['id', 'retentionUntil'])) === JSON.stringify(without(unmatchedReceipt.foundReport, ['id', 'retentionUntil'])) &&
      matchedReceipt.review === unmatchedReceipt.review &&
      matchedReceipt.candidates.length === 0 && unmatchedReceipt.candidates.length === 0,
    'a matched and an unmatched sighting should get the same receipt'
  );
  const matchedStatus = (await request('GET', `/reports/found/status/${matchedReceipt.foundReport.id}`)).status;
  const unmatchedStatus = (await request('GET', `/reports/found/status/${unmatchedReceipt.foundReport.id}`)).status;
  assert(Object.keys(matchedStatus).sort().join() === STATUS_KEYS, `sighting status keys changed: ${Object.keys(matchedStatus).sort().join()}`);
  assert(
    JSON.stringify(without(matchedStatus, ['id', 'submittedAt'])) === JSON.stringify(without(unmatchedStatus, ['id', 'submittedAt'])),
    'a matched and an unmatched sighting should read the same on the public status lookup'
  );
  assert(matchedStatus.stage === 'received', `a matched sighting awaiting review should read "received", got ${matchedStatus.stage}`);
  assert(!JSON.stringify(matchedStatus).includes('Aarav') && !JSON.stringify(matchedStatus).includes(caseA.report.id), 'the status lookup should not reveal the matched case');

  // Alerts: the police officers who own the case are told it may match; every
  // other desk gets exactly what an unmatched sighting raises.
  const caseAlert = (await inbox(sjpu)).find((row) => row.scope?.foundReportId === matchedReceipt.foundReport.id);
  assert(
    caseAlert?.scope?.matched === true && caseAlert.title === 'Possible match — child spotted' && caseAlert.priority === 'high',
    `the case's police officers should be told the sighting may match: ${JSON.stringify(caseAlert || null)}`
  );
  const cwcInbox = await inbox(cwc);
  const deskCopy = (id) => {
    const row = cwcInbox.find((n) => n.scope?.foundReportId === id);
    return row ? { kind: row.kind, title: row.title, body: row.body, priority: row.priority, inJurisdiction: row.inJurisdiction, scope: without(row.scope, ['foundReportId']) } : null;
  };
  const deskMatched = deskCopy(matchedReceipt.foundReport.id);
  const deskUnmatched = deskCopy(unmatchedReceipt.foundReport.id);
  assert(
    deskMatched && JSON.stringify(deskMatched) === JSON.stringify(deskUnmatched),
    `a desk that does not own the case must get the same alert for a matched and an unmatched sighting: ${JSON.stringify(deskMatched)} vs ${JSON.stringify(deskUnmatched)}`
  );
  assert(!deskMatched.body.includes('Mumbai') && deskMatched.scope.district === 'Pune', "another desk's alert must not carry the matched case's district");

  // --- Reverse, at registration: the sighting came first ----------------------
  const earlyReceipt = await request('POST', '/reports/found', { form: sightingForm('B', '9000000803') });
  const earlyBefore = await storedSighting(earlyReceipt.foundReport.id);
  assert(earlyBefore.status === 'no_match' && !earlyBefore.matchedReportId, 'a sighting of someone not yet reported should be stored unlinked');
  assert(earlyBefore.screening?.verdict === 'person', 'the stand-in engine should screen a face photo as a person');
  const earlyStatusBefore = (await request('GET', `/reports/found/status/${earlyReceipt.foundReport.id}`)).status;
  const callsBefore = fake.calls;
  const pairsBefore = fake.pairs.length;
  const caseB = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Bhavna Kulkarni', gender: 'Female', age: '12', parentPhone: '9876500202' }, 'B'),
  });
  assert(fake.calls > callsBefore, 'registering a case with a photo should run face comparisons against stored sightings');
  const reversePairs = fake.pairs.slice(pairsBefore);
  assert(
    reversePairs.length > 0 && reversePairs.every(([source, target]) => source === 'sighting' && target === 'case'),
    `the reverse search should send the sighting photo as the source, as the forward one does: ${JSON.stringify(reversePairs)}`
  );
  assert(caseB.sightingMatches === 1, `registering the case should link the earlier sighting, got ${caseB.sightingMatches}`);
  const earlyAfter = await storedSighting(earlyReceipt.foundReport.id);
  assert(earlyAfter.matchedReportId === caseB.report.id, 'the earlier sighting should be linked to the new case');
  assert(earlyAfter.status === 'pending_review' && earlyAfter.referralStatus === 'Police review pending', 'a reverse link should wait for police review like a forward one');
  assert(earlyAfter.matchScore >= 0.35 && earlyAfter.matchEngine?.biometric === true, 'a reverse link should keep the engine evidence');
  assert(earlyAfter.reverseMatch?.trigger === 'registration' && earlyAfter.reverseMatch?.previousStatus === 'no_match', 'a reverse link should record how it was made');
  assert(earlyAfter.reverseMatch?.previous?.status === 'no_match' && earlyAfter.reverseMatch.previous.district === 'Mumbai', 'a reverse link should keep what it overwrote');
  assert(earlyAfter.state === 'Maharashtra' && earlyAfter.district === 'Mumbai', 'a reverse link should take the case jurisdiction');
  const unmatchedStill = await storedSighting(unmatchedReceipt.foundReport.id);
  assert(!unmatchedStill.matchedReportId, 'a different face should not be linked by the reverse search');
  const earlyStatusAfter = (await request('GET', `/reports/found/status/${earlyReceipt.foundReport.id}`)).status;
  assert(JSON.stringify(earlyStatusAfter) === JSON.stringify(earlyStatusBefore), 'the reporter of an earlier sighting must not see any change when it is linked');
  const sjpuQueue = await request('GET', '/reports/found/all', { token: sjpu.token });
  assert(sjpuQueue.foundReports.some((row) => row.id === earlyReceipt.foundReport.id && row.matchedReport?.id === caseB.report.id), 'the case officer should see the linked sighting in the review queue');
  const sjpuCases = await request('GET', '/reports', { token: sjpu.token });
  assert(sjpuCases.reports.find((row) => row.id === caseB.report.id)?.pendingMatch?.foundReportId === earlyReceipt.foundReport.id, 'the case list should show the pending match');
  const reverseAudit = await request('GET', '/dashboard/audit', { token: superAdmin.token });
  assert(reverseAudit.audit.some((row) => row.action === 'sighting.reverse_matched' && row.targetId === earlyReceipt.foundReport.id), 'a reverse link should be audited');
  const sjpuAlerts = await inbox(sjpu);
  const reverseAlert = sjpuAlerts.find((row) => row.scope?.foundReportId === earlyReceipt.foundReport.id && row.scope?.matched === true);
  assert(reverseAlert && reverseAlert.title === 'Possible match — child spotted' && reverseAlert.priority === 'high', 'officers should be alerted to a reverse link like a forward one');
  assert(!reverseAlert.body.includes('Bhavna') && !reverseAlert.body.includes(caseB.report.id), 'the alert should not name the person');
  assert(
    !(await inbox(cwc)).some((row) => row.scope?.foundReportId === earlyReceipt.foundReport.id && row.scope?.matched === true),
    'a desk that is not police must not be told that a reverse link was made'
  );

  // --- Reverse, by /rematch after a provider outage -----------------------------
  const caseC = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Chirag Patil', gender: 'Male', age: '6', parentPhone: '9876500203' }, 'C'),
  });
  assert(caseC.sightingMatches === 0, 'no stored sighting of the third face yet');
  fake.down = true;
  const outageReceipt = await request('POST', '/reports/found', { form: sightingForm('C', '9000000804') });
  fake.down = false;
  const outageStored = await storedSighting(outageReceipt.foundReport.id);
  assert(!outageStored.matchedReportId && outageStored.status === 'no_match', 'a sighting during a provider outage cannot be matched');
  await expectStatus(403, () => request('POST', `/reports/${caseC.report.id}/rematch`, { token: parent.token }), 'parent rematch');
  await expectStatus(403, () => request('POST', `/reports/${caseC.report.id}/rematch`, { token: cwc.token }), 'CWC rematch (not a police role)');
  await expectStatus(404, () => request('POST', '/reports/r_not_a_case/rematch', { token: sjpu.token }), 'rematch an unknown case');
  // An outage during the re-match itself is reported as "no comparison", not
  // as "compared and found nothing".
  fake.down = true;
  const rematchDown = await request('POST', `/reports/${caseC.report.id}/rematch`, { token: sjpu.token });
  fake.down = false;
  assert(rematchDown.sightingMatches === 0 && rematchDown.engine?.biometric === false && rematchDown.engine?.comparedAgainst === 0, `a re-match during an outage should say no face was compared: ${JSON.stringify(rematchDown.engine)}`);
  const rematch = await request('POST', `/reports/${caseC.report.id}/rematch`, { token: sjpu.token });
  assert(rematch.sightingMatches === 1, `rematch should link the sighting missed during the outage, got ${rematch.sightingMatches}`);
  assert(rematch.engine?.provider === 'aarakshak-live-v1' && rematch.engine?.biometric === true, 'rematch should report the engine that compared');
  assert(rematch.engine.comparedAgainst >= 1 && rematch.engine.comparedAgainst <= rematch.engine.pool.compared, 'rematch should report the comparisons that answered');
  const outageAfter = await storedSighting(outageReceipt.foundReport.id);
  assert(outageAfter.matchedReportId === caseC.report.id && outageAfter.reverseMatch?.trigger === 'rematch', 'rematch should link like registration does');
  const rematchAgain = await request('POST', `/reports/${caseC.report.id}/rematch`, { token: sjpu.token });
  assert(rematchAgain.sightingMatches === 0, 'a linked sighting is not linked twice');
  const noPhotoCase = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Esha Naik', gender: 'Female', age: '10', parentPhone: '9876500205' }, null),
  });
  assert(noPhotoCase.sightingMatches === 0, 'a case without a photo links nothing');
  await expectStatus(409, () => request('POST', `/reports/${noPhotoCase.report.id}/rematch`, { token: sjpu.token }), 'rematch a case without a photo');

  // --- A family registering is not told, and its intake is not compared until verified ---
  const familySighting = await request('POST', '/reports/found', { form: sightingForm('D', '9000000805') });
  const familyCase = await request('POST', '/reports', {
    token: parent.token,
    form: caseForm({ childName: 'Diya Shinde', gender: 'Female', age: '8', parentPhone: '9876500204' }, 'D'),
  });
  assert(familyCase.sightingMatches === null, 'a family registering a case is not told whether any sighting matched');
  await expectStatus(409, () => request('POST', `/reports/${familyCase.report.id}/rematch`, { token: sjpu.token }), 'rematch an unverified intake');
  // Anyone can register as a parent or NGO, so an unverified intake is not
  // compared in either direction: not with the sightings already stored...
  const familyUnverified = await storedSighting(familySighting.foundReport.id);
  assert(!familyUnverified.matchedReportId, 'an unverified family intake is not compared with stored sightings');
  // ...and not with a sighting that arrives before an officer verifies it.
  const familyLater = await request('POST', '/reports/found', { form: sightingForm('D', '9000000809') });
  const familyLaterStored = await storedSighting(familyLater.foundReport.id);
  assert(!familyLaterStored.matchedReportId && familyLaterStored.status === 'no_match', 'a new sighting must not be matched against an unverified intake');
  const familyVerified = await request('POST', `/reports/${familyCase.report.id}/verify-intake`, { token: sjpu.token, body: { note: 'Verified at the station' } });
  assert(familyVerified.sightingMatches === 2, `verifying the intake should run the sighting search over both sightings, got ${familyVerified.sightingMatches}`);
  const familyLinked = await storedSighting(familySighting.foundReport.id);
  assert(familyLinked.matchedReportId === familyCase.report.id && familyLinked.reverseMatch?.trigger === 'intake_verified', 'the sighting is linked for officers to review once the intake is verified');
  const familyActivity = await request('GET', '/dashboard/activity', { token: parent.token });
  assert(
    !familyActivity.activity.some((row) => row.scope?.matchedReportId === familyCase.report.id),
    'the family activity feed should not show a sighting linked to their case'
  );
  const familySightingStatus = (await request('GET', `/reports/found/status/${familySighting.foundReport.id}`)).status;
  assert(familySightingStatus.stage === 'received', 'the family-case sighting reporter still sees "received"');

  // --- Rule 2: a police-only case, from desks that may not see it -------------
  // Registered in Thane, where the desk sightings below are reported too, so
  // it is first in their comparison budget.
  const policeOnly = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Pallavi Police Only', gender: 'Female', age: '11', parentPhone: '9876500206', visibility: 'police', ...thane }, 'P'),
  });
  assert(policeOnly.report.visibility === 'police', 'precondition: the case is police-only');
  const atThane = { at: thane, foundLocation: 'Thane station footbridge' };
  for (const [desk, phone] of [[cwc, '9000000810'], [dlsa, '9000000811']]) {
    const role = desk.user.role;
    const filed = await request('POST', '/reports/found', { token: desk.token, form: sightingForm('P', phone, atThane) });
    assert(
      filed.review === NEUTRAL_SIGHTING_RECEIPT && filed.candidates.length === 0 && filed.foundReport.status === 'received' && !('matchScore' in filed.foundReport),
      `a ${role} desk must not learn that a sighting matched a police-only case: ${JSON.stringify(filed)}`
    );
    const stored = await storedSighting(filed.foundReport.id);
    assert(stored.matchedReportId === policeOnly.report.id, `precondition: the ${role} sighting is linked to the police-only case`);
    await expectStatus(403, () => request('GET', `/reports/${policeOnly.report.id}`, { token: desk.token }), `${role} reads a police-only case`);
    assert(!(await request('GET', '/reports', { token: desk.token })).reports.some((r) => r.id === policeOnly.report.id), `a police-only case is hidden from the ${role} case list`);
    await expectStatus(403, () => request('GET', `/reports/photo/${policeOnly.report.id}`, { token: desk.token }), `${role} fetches a police-only photo`);
    assert(
      !(await request('GET', '/reports/found/all', { token: desk.token })).foundReports.some((f) => f.matchedReportId === policeOnly.report.id),
      `the ${role} review queue hides sightings matched to a police-only case`
    );
    const deskAlerts = (await inbox(desk)).filter((row) => row.scope?.foundReportId === filed.foundReport.id);
    assert(
      deskAlerts.length === 1 && deskAlerts[0].scope.matched === false && deskAlerts[0].priority === 'normal' && deskAlerts[0].title === 'Child spotted',
      `a ${role} desk must get only the alert an unmatched sighting raises: ${JSON.stringify(deskAlerts)}`
    );
  }
  // A police officer whose best match is outside their jurisdiction is not
  // told where that case is held; one who may open it sees the match.
  const outOfScope = await request('POST', '/reports/found', { token: sjpu.token, form: sightingForm('P', '9000000812', atThane) });
  assert(outOfScope.review === NEUTRAL_SIGHTING_RECEIPT && outOfScope.candidates.length === 0, 'a match outside the officer\'s scope is not shown to them');
  const inScope = await request('POST', '/reports/found', { token: superAdmin.token, form: sightingForm('P', '9000000813', atThane) });
  assert(inScope.foundReport.status === 'pending_review' && inScope.candidates.length >= 1 && inScope.candidates[0].score >= 0.35, 'an officer who may open the case sees the match');
  await expectStatus(404, () => request('GET', `/reports/public/status/${policeOnly.report.id}`), 'public status of a police-only case');
  await request('POST', `/reports/${policeOnly.report.id}/confirm-match`, { token: superAdmin.token, body: { sendSms: false, foundLocation: 'Thane station footbridge', verification: SMOKE_VERIFICATION } });
  for (const account of [cwc, dlsa, ngo, parent]) {
    assert(
      !(await inbox(account)).some((row) => row.kind === 'match_confirmed' && row.scope?.reportId === policeOnly.report.id),
      `${account.user.role} must not be alerted that a police-only case was traced`
    );
  }
  assert(
    (await inbox(superAdmin)).some((row) => row.kind === 'match_confirmed' && row.scope?.reportId === policeOnly.report.id),
    "the case's police officers are told the match was confirmed"
  );

  // --- An officer's decision (POST /found/:id/review) ---------------------------
  const caseN = await request('POST', '/reports', { token: sjpu.token, form: caseForm({ childName: 'Nikhil Rao', gender: 'Male', age: '8', parentPhone: '9876500208' }, 'N') });
  const caseM = await request('POST', '/reports', { token: sjpu.token, form: caseForm({ childName: 'Meera Joshi', gender: 'Female', age: '7', parentPhone: '9876500209' }, 'M') });
  const toConfirm = await request('POST', '/reports/found', { form: sightingForm('N', '9000000814') });
  const toReject = await request('POST', '/reports/found', { form: sightingForm('M', '9000000815') });
  const neverReviewed = await request('POST', '/reports/found', { form: sightingForm('U', '9000000818') });
  assert((await storedSighting(toConfirm.foundReport.id)).matchedReportId === caseN.report.id, 'precondition: linked to case N');
  assert((await storedSighting(toReject.foundReport.id)).matchedReportId === caseM.report.id, 'precondition: linked to case M');
  await expectStatus(403, () => request('POST', `/reports/found/${toConfirm.foundReport.id}/review`, { token: cwc.token, body: { decision: 'matched' } }), 'CWC confirms a match');
  assert((await storedSighting(toConfirm.foundReport.id)).status === 'pending_review', 'a refused confirmation leaves the sighting as it was');
  const unverifiedReview = await expectStatus(400, () => request('POST', `/reports/found/${toConfirm.foundReport.id}/review`, { token: sjpu.token, body: { decision: 'matched' } }), 'confirm a sighting match without verification');
  assert(unverifiedReview.error === VERIFICATION_REQUIRED, `the refusal should say why: ${unverifiedReview.error}`);
  await expectStatus(400, () => request('POST', `/reports/found/${toConfirm.foundReport.id}/review`, {
    token: sjpu.token,
    body: { decision: 'matched', verification: { ...SMOKE_VERIFICATION, method: 'guess' } },
  }), 'confirm a sighting match with an unknown verification method');
  assert((await storedSighting(toConfirm.foundReport.id)).status === 'pending_review', 'a confirmation without verification leaves the sighting as it was');
  assert((await storedCase(caseN.report.id)).status === 'missing', 'and leaves the case missing');
  const confirmedReview = await request('POST', `/reports/found/${toConfirm.foundReport.id}/review`, {
    token: sjpu.token,
    body: { decision: 'matched', note: 'Checked against the station diary', verification: SMOKE_VERIFICATION },
  });
  assert(
    confirmedReview.report?.status === 'found' && confirmedReview.familyNotified === false && confirmedReview.familyPhone === '9876500208',
    `confirming a sighting tells nobody, and gives the officer the family's number: ${JSON.stringify({ ...confirmedReview, report: confirmedReview.report?.status, foundReport: undefined })}`
  );
  await request('POST', `/reports/found/${toReject.foundReport.id}/review`, { token: sjpu.token, body: { decision: 'rejected', note: 'Different child; the scar is on the other arm' } });
  assert((await storedCase(caseN.report.id)).status === 'found', 'confirming a match marks the case found');
  // "Not this person" is about the candidate, not the sighting: with no other
  // candidate left it goes back to the no-match queue, at the reporter's own
  // place, and the case it was rejected for is never proposed for it again.
  const rejectedStored = await storedSighting(toReject.foundReport.id);
  assert(
    rejectedStored.status === 'no_match' && !rejectedStored.matchedReportId && rejectedStored.district === where.district,
    `a rejected forward match with no other candidate goes back to its queue: ${JSON.stringify({ status: rejectedStored.status, matchedReportId: rejectedStored.matchedReportId })}`
  );
  assert(
    rejectedStored.rejectedLinks?.some((l) => l.reportId === caseM.report.id && l.direction === 'forward') &&
      rejectedStored.matchCandidates?.find((c) => c.reportId === caseM.report.id)?.status === 'rejected',
    'the rejected case is recorded on the sighting and its candidate marked rejected'
  );
  const searchedAgain = await request('POST', `/reports/found/${toReject.foundReport.id}/rematch`, { token: sjpu.token });
  assert(
    searchedAgain.linked === false && !(await storedSighting(toReject.foundReport.id)).matchedReportId,
    'searching again never proposes a case an officer rejected for the sighting'
  );
  const confirmedSighting = await storedSighting(toConfirm.foundReport.id);
  assert(
    confirmedSighting.verification?.verifiedBy === SMOKE_VERIFICATION.verifiedBy && confirmedSighting.verification.method === 'in_person' &&
      confirmedSighting.reviewNote === 'Checked against the station diary' && confirmedSighting.reviewedByRole === 'sjpu',
    `the sighting should keep the verification and the reviewer note: ${JSON.stringify(without(confirmedSighting, ['screening', 'matchEngine']))}`
  );
  assert((await storedSighting(toReject.foundReport.id)).reviewNote === 'Different child; the scar is on the other arm', 'a rejection keeps the reviewer note');
  const confirmedCaseN = await storedCase(caseN.report.id);
  assert(
    confirmedCaseN.verification?.place === SMOKE_VERIFICATION.place &&
      confirmedCaseN.workflow?.some((e) => e.action === 'match_confirmed' && e.verification?.method === 'in_person' && e.foundReportId === toConfirm.foundReport.id),
    'the case should keep the verification, and a match_confirmed workflow event carrying it'
  );
  const sightingConfirmAudit = (await request('GET', '/dashboard/audit', { token: superAdmin.token })).audit
    .find((row) => row.action === 'sighting.match_confirmed' && row.targetId === toConfirm.foundReport.id);
  assert(sightingConfirmAudit?.metadata?.verification?.place === SMOKE_VERIFICATION.place && !sightingConfirmAudit.summary.includes(SMOKE_VERIFICATION.verifiedBy),
    'the sighting confirmation audit should carry the verification in its metadata, not a name in its summary');
  const decided = await Promise.all([toConfirm, toReject, neverReviewed].map(async (r) => (await request('GET', `/reports/found/status/${r.foundReport.id}`)).status));
  const decidedViews = decided.map((s) => JSON.stringify(without(s, ['id', 'submittedAt'])));
  assert(new Set(decidedViews).size === 1, `a confirmed, a rejected and a never-reviewed sighting must read the same: ${decidedViews.join(' | ')}`);

  // --- Reopening a found case puts it back among the cases sightings are compared with ---
  const whileFound = await request('POST', '/reports/found', { form: sightingForm('N', '9000000819') });
  assert(!(await storedSighting(whileFound.foundReport.id)).matchedReportId, 'precondition: a found case is not compared with new sightings');
  const reopenN = (token, body) => request('POST', `/reports/${caseN.report.id}/reopen`, { token, body });
  await expectStatus(403, () => reopenN(parent.token, { reason: 'The parent says this is not their child' }), 'a parent reopens a case');
  await expectStatus(403, () => reopenN(cwc.token, { reason: 'The CWC says this is not the child' }), 'a CWC desk reopens a case');
  await expectStatus(400, () => reopenN(sjpu.token, { reason: 'short' }), 'reopen with a reason under 10 characters');
  await expectStatus(400, () => reopenN(sjpu.token, { reason: { text: 'an object reason' } }), 'reopen with an object reason');
  const stillMissing = await expectStatus(409, () => request('POST', `/reports/${caseM.report.id}/reopen`, { token: sjpu.token, body: { reason: 'Reopening a case that is still missing' } }), 'reopen a case that is still missing');
  assert(stillMissing.error === 'Only a found or closed case can be reopened', `the refusal should say why: ${stillMissing.error}`);
  const reopened = await reopenN(sjpu.token, { reason: 'The family says the child at the shelter is not Nikhil.' });
  assert(
    reopened.report.status === 'missing' && !reopened.report.verification && !reopened.report.foundLocation && !reopened.report.foundAt && reopened.report.matchScore === 0,
    `a reopened case should be missing again, with the found state cleared: ${JSON.stringify(without(reopened.report, ['workflow', 'reopenHistory']))}`
  );
  assert(reopened.report.workflow.some((e) => e.action === 'reopened' && e.note === 'The family says the child at the shelter is not Nikhil.' && e.previousStatus === 'found'), 'reopening is a workflow event with the reason');
  assert(reopened.report.reopenHistory?.[0]?.verification?.method === 'in_person' && reopened.report.reopenHistory[0].previousStatus === 'found', 'what the found state recorded is kept in reopenHistory');
  const afterReopen = await request('POST', '/reports/found', { form: sightingForm('N', '9000000820') });
  const linkedAgain = await storedSighting(afterReopen.foundReport.id);
  assert(linkedAgain.matchedReportId === caseN.report.id && linkedAgain.status === 'pending_review', 'a reopened case is compared with new sightings again');
  const reopenAudit = (await request('GET', '/dashboard/audit', { token: superAdmin.token })).audit.find((row) => row.action === 'case.reopened' && row.targetId === caseN.report.id);
  assert(reopenAudit?.metadata?.previousStatus === 'found' && reopenAudit.actorRole === 'sjpu', 'reopening should be audited');

  // A privacy retention review moves a matched sighting into the CWC queue;
  // the reporter's lookup must not show it.
  for (const r of [matchedReceipt, unmatchedReceipt]) {
    await request('POST', `/dashboard/privacy/retention/foundReport/${r.foundReport.id}`, { token: superAdmin.token, body: { decision: 'close' } });
  }
  assert((await storedSighting(matchedReceipt.foundReport.id)).status === 'referred_cwc', 'precondition: the retention review moved the matched sighting');
  const afterCloseMatched = (await request('GET', `/reports/found/status/${matchedReceipt.foundReport.id}`)).status;
  const afterCloseUnmatched = (await request('GET', `/reports/found/status/${unmatchedReceipt.foundReport.id}`)).status;
  assert(
    JSON.stringify(without(afterCloseMatched, ['id', 'submittedAt'])) === JSON.stringify(without(afterCloseUnmatched, ['id', 'submittedAt'])),
    'a retention review must not reveal which sighting had matched'
  );

  // --- Rule 4: a woman's family learns nothing from the case page --------------
  const womanCase = await request('POST', '/reports', {
    token: parent.token,
    form: caseForm({ childName: 'Sunita Pawar', personCategory: 'woman', gender: 'Female', age: '29', parentPhone: '9876500210' }, 'W'),
  });
  await request('POST', `/reports/${womanCase.report.id}/verify-intake`, { token: sjpu.token, body: { note: 'Verified at the station' } });
  await request('POST', `/reports/${womanCase.report.id}/notes`, { token: sjpu.token, body: { note: 'She fears her husband; do not share her location.' } });
  const womanSighting = await request('POST', '/reports/found', {
    form: sightingForm('W', '9000000816', { foundLocation: 'One Stop Centre, Shahibaug', personCategory: 'woman' }),
  });
  assert((await storedSighting(womanSighting.foundReport.id)).matchedReportId === womanCase.report.id, 'precondition: the sighting is linked to her case');
  await request('POST', `/reports/found/${womanSighting.foundReport.id}/review`, { token: sjpu.token, body: { decision: 'matched', verification: SMOKE_VERIFICATION } });
  const familyDetail = (await request('GET', `/reports/${womanCase.report.id}`, { token: parent.token })).report;
  const familyRow = (await request('GET', '/reports', { token: parent.token })).reports.find((r) => r.id === womanCase.report.id);
  for (const view of [familyDetail, familyRow]) {
    assert(view?.status === 'found', 'the family may know the case is traced');
    for (const field of ['foundLocation', 'notes', 'matchScore', 'workflow', 'cciCareRecords', 'closure', 'verification', 'familyContacts', 'foundAt']) {
      assert(!(field in view), `the family must not see ${field} on a traced woman's case`);
    }
    assert(!/Shahibaug|fears her husband/.test(JSON.stringify(view)), 'the family must not see where she was found or what officers recorded');
    assert(view.smsSent !== true, 'no family alert without her consent');
  }
  assert((await storedCase(womanCase.report.id)).foundLocation === 'One Stop Centre, Shahibaug', 'officers still see where she was found');

  // --- A reverse link an officer rejects puts the sighting back ---------------
  // A child sighting a CWC desk is following up, then a police-only register
  // row with a lookalike photo. The link must not take the referral away for
  // good, and the same case must not be proposed for it again.
  const referred = await request('POST', '/reports/found', { form: sightingForm('R', '9000000817') });
  await request('POST', `/reports/found/${referred.foundReport.id}/review`, { token: sjpu.token, body: { decision: 'refer_cwc' } });
  const cwcSees = async () => (await request('GET', '/reports/found/all', { token: cwc.token })).foundReports.some((f) => f.id === referred.foundReport.id);
  assert(await cwcSees(), 'precondition: the CWC desk is following the sighting up');
  const lookalike = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Rekha Register Row', gender: 'Female', age: '9', parentPhone: '9876500211', visibility: 'police', ...thane }, 'R'),
  });
  assert(lookalike.sightingMatches === 1, `the reverse search should link the referred sighting, got ${lookalike.sightingMatches}`);
  const linkedReferral = await storedSighting(referred.foundReport.id);
  assert(
    linkedReferral.matchedReportId === lookalike.report.id && linkedReferral.district === 'Thane' && linkedReferral.reverseMatch?.previous?.status === 'referred_cwc',
    'precondition: the referral is linked to the police-only case'
  );
  await request('POST', `/reports/found/${referred.foundReport.id}/review`, { token: superAdmin.token, body: { decision: 'rejected' } });
  const restored = await storedSighting(referred.foundReport.id);
  assert(
    restored.status === 'referred_cwc' && restored.district === 'Mumbai' && !restored.matchedReportId && restored.rejectedLinks?.[0]?.reportId === lookalike.report.id,
    `rejecting a reverse link should put the sighting back where it was: ${JSON.stringify(without(restored, ['screening', 'matchEngine']))}`
  );
  assert(await cwcSees(), 'the CWC desk gets the sighting back');
  const rematchLookalike = await request('POST', `/reports/${lookalike.report.id}/rematch`, { token: superAdmin.token });
  assert(rematchLookalike.sightingMatches === 0, 'a link an officer rejected is not proposed again');
  const followup = await request('POST', `/reports/found/${referred.foundReport.id}/cwc-followup`, {
    token: cwc.token,
    body: { outcome: 'child_located_safe', note: 'Smoke follow-up after a rejected lookalike' },
  });
  assert(followup.foundReport.status === 'cwc_followup_complete', 'the CWC desk can complete its follow-up');

  // --- Parent and NGO accounts are never alerted about sightings or matches ---
  for (const account of [ngo, parent]) {
    const rows = await inbox(account);
    assert(
      !rows.some((row) => row.scope?.foundReportId || ['sighting_reported', 'sighting_screening', 'match_confirmed'].includes(row.kind)),
      `${account.user.role} accounts must not be alerted about sightings: ${JSON.stringify(rows.slice(0, 2))}`
    );
  }
}

/**
 * The DPIA's personal-data gaps, closed (docs/governance/dpia.md section 7):
 *
 *   G1   anonymising a case deletes its photograph's bytes and clears the
 *        profile, notes, FIR number and contacts; the activity feed stops
 *        naming the person
 *   G2   an Aadhaar number is stored masked with a keyed fingerprint, and the
 *        fingerprint still catches a second registration of the same child
 *   G4   the permanent audit log names cases by id
 *   G15  an imported register photo records its basis, not a consent
 *   G23  a CCI desk sees a case without the family's phone, e-mail or address
 */
async function privacyGapChecks({ superAdmin, sjpu, cci }) {
  const mumbai = { state: 'Maharashtra', district: 'Mumbai' };
  const caseForm = (fields, { photo = null, basis = 'consent' } = {}) => {
    const form = new FormData();
    addDeclaration(form, 'Smoke Privacy Declarant');
    for (const [key, value] of Object.entries({ ...mumbai, gender: 'Female', age: '13', ...fields })) form.set(key, value);
    if (photo) {
      if (basis === 'consent') form.set('photoConsent', 'true');
      else form.set('photoBasis', basis);
      form.set('photo', photo);
    }
    return form;
  };

  // G2: the number is never stored, and still catches a duplicate.
  const aadhaarCase = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Meera Aadhaar Smoke', childAadhar: '432187651098', parentPhone: '9000003301', identificationMark: 'Crescent scar on the left wrist' }),
  });
  assert(aadhaarCase.report.childAadhar === 'XXXX XXXX 1098', `an Aadhaar number is stored masked: ${aadhaarCase.report.childAadhar}`);
  assert(!('childAadharHash' in aadhaarCase.report), 'the Aadhaar fingerprint is never sent to a client');
  const storedJson = fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8');
  assert(!storedJson.includes('432187651098'), 'the whole Aadhaar number is not in the store');
  const second = await expectStatus(409, () => request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'M. Kumari', childAadhar: '432187651098', parentPhone: '9000003302', age: '14' }),
  }), 'a second registration with the same Aadhaar number');
  assert(second.duplicateCandidates?.some((c) => c.reportId === aadhaarCase.report.id), 'the fingerprint finds the first registration');
  const notSame = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Unrelated Boy Smoke', childAadhar: '999988881098', parentPhone: '9000003303', age: '6', gender: 'Male' }),
  });
  assert(notSame.report.id, 'a number sharing only the last four digits is not a duplicate');

  // Soft identifiers are searchable.
  const byMark = await request('GET', `/reports?q=${encodeURIComponent('crescent scar')}`, { token: sjpu.token });
  assert(byMark.reports.some((r) => r.id === aadhaarCase.report.id), 'an identification mark finds the case');

  // G23: a CCI desk sees the case, not the family's contacts.
  const cciView = await request('GET', `/reports/${aadhaarCase.report.id}`, { token: cci.token });
  assert(cciView.report.parentPhone === null && cciView.report.address === null && cciView.report.familyContactWithheld, `a CCI desk does not see family contacts: ${JSON.stringify({ phone: cciView.report.parentPhone })}`);
  const sjpuView = await request('GET', `/reports/${aadhaarCase.report.id}`, { token: sjpu.token });
  assert(sjpuView.report.parentPhone === '9000003301', 'the police still see the family contact');
  const cciList = await request('GET', '/reports', { token: cci.token });
  assert(cciList.reports.length > 0 && !cciList.reports.some((r) => r.parentPhone || r.parentEmail || r.address), 'a CCI desk list carries no family contact');

  // G15: a register photo is not a consent.
  const imported = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({ childName: 'Register Photo Smoke', parentPhone: '9000003304', age: '10', allowDuplicate: 'true' }, { photo: tinyPngFile(), basis: 'department_register' }),
  });
  assert(imported.report.photoBasis === 'department_register' && imported.report.photoConsent === false, `a register photo records its basis: ${JSON.stringify({ basis: imported.report.photoBasis, consent: imported.report.photoConsent })}`);

  // G1 and G4: anonymising deletes the photo and every identifying field.
  const doomed = await request('POST', '/reports', {
    token: sjpu.token,
    form: caseForm({
      childName: 'Zarina Anonymise Smoke', parentPhone: '9000003305', age: '11', allowDuplicate: 'true',
      address: '14 Smoke Lane, Dharavi', identificationMark: 'Mole under the right eye', circumstances: 'Left with a man offering work',
    }, { photo: tinyPngFile() }),
  });
  const photoPath = path.join(dataDir, 'uploads', doomed.report.photoFile);
  assert(fs.existsSync(photoPath), 'precondition: the case photo is stored');
  const firNo = doomed.report.firNo;
  await request('POST', `/reports/${doomed.report.id}/notes`, { token: sjpu.token, body: { note: 'Smoke note naming Zarina and her uncle' } });
  await request('POST', `/dashboard/privacy/retention/report/${doomed.report.id}`, {
    token: superAdmin.token,
    body: { decision: 'anonymize', approvalReference: 'SMOKE-G1-ORDER', approvalType: 'privacy_officer' },
  });
  assert(!fs.existsSync(photoPath), 'anonymising deletes the photograph itself');
  const after = (await request('GET', `/reports/${doomed.report.id}`, { token: superAdmin.token })).report;
  const afterJson = JSON.stringify(after);
  for (const text of ['Zarina', 'Dharavi', 'Mole under', 'offering work', '9000003305', 'her uncle', firNo].filter(Boolean)) {
    assert(!afterJson.includes(text), `an anonymised case keeps nothing identifying: found "${text}"`);
  }
  assert(after.firNo === null && after.photoFile === null && after.identificationProfile === null, 'the FIR number, photo and profile are cleared');
  assert(after.gender === 'Female' && Number(after.age) === 11 && after.district, 'statistics survive anonymisation');
  const activity = (await request('GET', '/dashboard/activity', { token: superAdmin.token })).activity;
  assert(!JSON.stringify(activity).includes('Zarina Anonymise Smoke'), 'the activity feed stops naming an anonymised person');
  const audit = (await request('GET', '/dashboard/audit', { token: superAdmin.token })).audit;
  assert(!JSON.stringify(audit).includes('Zarina') && !JSON.stringify(audit).includes('Meera Aadhaar'), 'the audit log names cases by id, never by name');

  // G3: the retention schedule, planned and (with an order) applied.
  const plan = await request('POST', '/dashboard/privacy/retention-sweep', { token: superAdmin.token, body: {} });
  assert(plan.applied === false && typeof plan.summary?.sightingsToAnonymise === 'number' && Array.isArray(plan.plan?.cases?.review), `a dry run returns the plan: ${JSON.stringify(plan.summary)}`);
  await expectStatus(400, () => request('POST', '/dashboard/privacy/retention-sweep', { token: superAdmin.token, body: { apply: true } }), 'applying the retention schedule without an order');
  await expectStatus(403, () => request('POST', '/dashboard/privacy/retention-sweep', { token: sjpu.token, body: {} }), 'a district desk running the retention schedule');
  const applied = await request('POST', '/dashboard/privacy/retention-sweep', { token: superAdmin.token, body: { apply: true, approvalReference: 'SMOKE-RETENTION-1' } });
  assert(
    applied.applied === true && applied.done.sightingsAnonymised === applied.summary.sightingsToAnonymise && applied.done.casesAnonymised === applied.summary.casesToAnonymise,
    `an applied sweep does what its plan said: ${JSON.stringify({ summary: applied.summary, done: applied.done })}`
  );
}

/**
 * Strict input: a write route refuses a field sent with the wrong shape
 * (`Invalid value for <field>`) instead of storing it. The scenario this
 * prevents: a public sighting whose location is a JSON object, stored as one,
 * crashing every desk's screen that renders it.
 *
 * Each public request comes from its own client address so the rate limits
 * the rest of the suite trips do not apply.
 */
async function strictInputChecks({ superAdmin, sjpu }) {
  const from = (n) => ({ 'x-forwarded-for': `203.0.113.${n}`, 'cf-connecting-ip': `203.0.113.${n}` });
  const refusedWith = async (field, fn, label) => {
    const data = await expectStatus(400, fn, label);
    assert(data.error === `Invalid value for ${field}`, `${label}: expected "Invalid value for ${field}", got "${data.error}"`);
  };

  // POST /found, the public sighting.
  const sighting = (body, n) => request('POST', '/reports/found', { headers: from(n), body });
  await refusedWith('foundLocation', () => sighting({ foundLocation: { x: 1 }, note: 'Object location smoke', reporterPhone: '9000000901' }, 70), 'a sighting whose location is an object');
  await refusedWith('lat', () => sighting({ foundLocation: 'Near the smoke bus stand', lat: 'north', reporterPhone: '9000000902' }, 71), 'a sighting whose latitude is not a number');
  await refusedWith('note', () => sighting({ foundLocation: 'Near the smoke bus stand', note: ['a', { b: 1 }], reporterPhone: '9000000903' }, 72), 'a sighting whose note is a list of objects');
  await refusedWith('reporterName', () => sighting({ foundLocation: 'Near the smoke bus stand', reporterName: 42, reporterPhone: '9000000904' }, 73), 'a sighting whose reporter name is a number');
  const stored = (await request('GET', '/reports/found/all', { token: superAdmin.token })).foundReports;
  assert(
    stored.every((f) => typeof f.foundLocation === 'string' && (f.note == null || typeof f.note === 'string')),
    'no sighting may be stored with a location or note that is not text'
  );
  assert(!stored.some((f) => /Object location smoke/.test(JSON.stringify(f))), 'a refused sighting must not be stored');
  const textSighting = await sighting({ foundLocation: '  Near the smoke ferry wharf  ', note: 'Text sighting for the strict input checks', reporterPhone: '9000000905' }, 74);
  const textStored = (await request('GET', '/reports/found/all', { token: superAdmin.token })).foundReports.find((f) => f.id === textSighting.foundReport.id);
  assert(textStored?.foundLocation === 'Near the smoke ferry wharf', `a sighting location should be stored trimmed, got ${JSON.stringify(textStored?.foundLocation)}`);

  // POST /reports, case registration (and every bulk-import row).
  await refusedWith('childName', () => request('POST', '/reports', { token: sjpu.token, body: { childName: { first: 'Asha' }, age: 9, declarationAccepted: true } }), 'a case whose name is an object');
  const ageForm = new FormData();
  ageForm.set('childName', 'Smoke Strict Age');
  addDeclaration(ageForm);
  ageForm.set('age', 'nine');
  await refusedWith('age', () => request('POST', '/reports', { token: sjpu.token, form: ageForm }), 'a case whose age is not a number');
  await refusedWith('address', () => request('POST', '/reports', { token: sjpu.token, body: { childName: 'Smoke Strict Address', address: ['a', ['b']], declarationAccepted: true } }), 'a case whose address is a nested list');

  // POST /found/:id/formal-intake.
  const intake = (body) => request('POST', `/reports/found/${textSighting.foundReport.id}/formal-intake`, { token: superAdmin.token, body });
  await refusedWith('note', () => intake({ childName: 'Unknown child', intakeAuthority: 'Smoke CWC', note: { text: 'x' } }), 'a formal intake whose note is an object');
  await refusedWith('guardianName', () => intake({ childName: 'Unknown child', intakeAuthority: 'Smoke CWC', guardianName: 123, note: 'Strict intake note long enough' }), 'a formal intake whose guardian is a number');

  // Grievance creation and public registration.
  await refusedWith('subject', () => request('POST', '/grievances', { headers: from(75), body: { subject: { x: 1 }, description: 'A grievance whose subject is an object', phone: '9000000906' } }), 'a grievance whose subject is an object');
  await refusedWith('name', () => request('POST', '/auth/register', { headers: from(76), body: { name: { x: 1 }, email: 'smoke.objectname@example.org', password: 'whatever-123', phone: '9000000907', otp: '000000' } }), 'a registration whose name is an object');

  // Other case writes that stored a field as sent.
  const strictCase = await request('POST', '/reports', {
    token: sjpu.token,
    body: { childName: 'Smoke Strict Workflow', age: '10', gender: 'Male', declarationAccepted: 'true', state: 'Maharashtra', district: 'Mumbai' },
  });
  await refusedWith('note', () => request('POST', `/reports/${strictCase.report.id}/case-workflow`, { token: sjpu.token, body: { action: 'refer_cwc', note: { x: 1 } } }), 'a workflow note that is an object');
  await refusedWith('foundLocation', () => request('POST', `/reports/${strictCase.report.id}/close-case`, { token: sjpu.token, body: { reason: 'restored_family', foundLocation: { x: 1 } } }), 'a closure location that is an object');

  // A closed case can be reopened too, by police.
  const closed = await request('POST', `/reports/${strictCase.report.id}/close-case`, {
    token: sjpu.token,
    body: { reason: 'restored_family', foundLocation: 'Smoke family home', note: 'Closed for the reopen check' },
  });
  assert(closed.report.status === 'closed', 'precondition: the case is closed');
  const reopened = await request('POST', `/reports/${strictCase.report.id}/reopen`, { token: superAdmin.token, body: { reason: 'Closed in error; the child was not restored.' } });
  assert(reopened.report.status === 'missing' && !reopened.report.closure && !reopened.report.foundLocation, 'a reopened closed case is missing again, with the closure cleared');
  assert(reopened.report.reopenHistory?.[0]?.closure?.reason === 'restored_family', 'the closure it had is kept in reopenHistory');
  await expectStatus(409, () => request('POST', `/reports/${strictCase.report.id}/reopen`, { token: superAdmin.token, body: { reason: 'Reopening it a second time' } }), 'reopen a case that is already open');
}

/**
 * The candidate list, searching again, placing a sighting, and the case photo
 * check, against the stand-in face engine, on both runtimes.
 *
 *   walk      a sighting keeps every strong candidate; "not this person" moves
 *             it to the next, alerting that case's officers, and a rejected
 *             pair is never proposed again; a desk sees only the candidates it
 *             may open
 *   rescue    confirm-match alerts for the sighting it confirms, at the place
 *             the child was seen, not for the newest linked sighting
 *   pool      closed cases and found-child intakes are never compared with a
 *             new sighting; a found-child intake keeps a copy of the photo and
 *             is reached by the reverse search
 *   rematch   POST /found/:id/rematch and the super-admin batch re-run the
 *             forward search; one retry absorbs a single provider fault
 *   place     POST /found/:id/place sets an unplaced sighting's district and
 *             searches from there
 *   photo     a case photo is screened (usable / no face / group photo / not
 *             checked), can be replaced, and uploads are held to 8 MB and to
 *             real JPEG, PNG or WebP bytes
 */
async function candidateAndPhotoChecks({ superAdmin, admin, sjpu, cwc, parent, fake }) {
  const mumbai = { state: 'Maharashtra', district: 'Mumbai' };
  const thane = { state: 'Maharashtra', district: 'Thane' };
  let phone = 9000001100;
  const nextPhone = () => String(phone++);
  const caseForm = (fields, photo) => {
    const form = new FormData();
    addDeclaration(form, 'Smoke Candidate Declarant');
    // Several smoke children share an age and a district; duplicate detection
    // is not what these checks are about.
    form.set('allowDuplicate', 'true');
    for (const [key, value] of Object.entries({ ...mumbai, gender: 'Male', age: '9', ...fields })) form.set(key, value);
    if (photo) {
      form.set('photoConsent', 'true');
      form.set('photo', photo);
    }
    return form;
  };
  const sightingForm = (photo, { at = mumbai, foundLocation = 'Near Dadar flower market' } = {}) => {
    const form = new FormData();
    form.set('foundLocation', foundLocation);
    if (at?.state) form.set('state', at.state);
    if (at?.district) form.set('district', at.district);
    form.set('note', 'Candidate smoke sighting');
    form.set('reporterPhone', nextPhone());
    form.set('photoConsent', 'true');
    form.set('photo', photo);
    return form;
  };
  const register = (token, fields, photo) => request('POST', '/reports', { token, form: caseForm(fields, photo) });
  const sight = (photo, options) => request('POST', '/reports/found', { form: sightingForm(photo, options) });
  const stored = async (id) => (await request('GET', '/reports/found/all', { token: superAdmin.token })).foundReports.find((row) => row.id === id);
  const storedCase = async (id) => (await request('GET', `/reports/${id}`, { token: superAdmin.token })).report;
  const inbox = async (account) => (await request('GET', '/dashboard/notifications', { token: account.token })).notifications;
  const groupPhoto = (label) => new File([Buffer.concat([TINY_PNG, Buffer.from(`KHOZO-SMOKE-FACE:${label}:case;KHOZO-SMOKE-GROUP;`)])], `group-${label}.png`, { type: 'image/png' });

  // --- The candidate list, and walking it -------------------------------------
  // Two open cases of the same face: one in Mumbai, one in Thane.
  const k1 = await register(sjpu.token, { childName: 'Kiran Walk One', parentPhone: '9876500301' }, facePhotoFile('K', 'case'));
  const k2 = await register(superAdmin.token, { childName: 'Kiran Walk Two', parentPhone: '9876500302', ...thane }, facePhotoFile('K', 'case'));
  const walked = await sight(facePhotoFile('K'));
  const first = await stored(walked.foundReport.id);
  const proposed = (first.matchCandidates || []).filter((c) => c.status === 'proposed');
  assert(
    proposed.length === 2 && proposed[0].reportId === k1.report.id && proposed[1].reportId === k2.report.id &&
      proposed[0].rank === 1 && proposed[1].rank === 2 && first.matchedReportId === k1.report.id,
    `a sighting keeps every strong candidate, nearest first: ${JSON.stringify(proposed.map((c) => [c.reportId, c.rank]))}`
  );
  assert(
    proposed.every((c) => c.aarakshakScore >= 0.35 && c.rekognitionScore === null && c.corroborated === false &&
      c.enginesAnswered.join() === 'aarakshak' && c.engines?.rekognition === 'not_configured'),
    `each candidate records which engines answered: ${JSON.stringify(proposed[0])}`
  );
  assert(
    first.matchEngine?.configHash && /^[0-9a-f]{16}$/.test(first.matchEngine.configHash) && first.matchEngine.thresholds?.review === 0.35 &&
      first.matchEngine.pool?.openWithPhotos >= 2 && first.matchEngine.comparedAgainst >= 2,
    `a search is stored with its thresholds and configuration hash: ${JSON.stringify(first.matchEngine)}`
  );
  const sjpuView = (await request('GET', '/reports/found/all', { token: sjpu.token })).foundReports.find((row) => row.id === walked.foundReport.id);
  assert(
    sjpuView?.matchCandidates?.length === 1 && sjpuView.matchCandidates[0].reportId === k1.report.id && sjpuView.matchCandidates[0].report?.expectedAge >= 9,
    'a desk sees only the candidates it may open, with the age each would be now'
  );
  await expectStatus(403, () => request('POST', `/reports/found/${walked.foundReport.id}/review`, { token: parent.token, body: { decision: 'rejected' } }), 'a parent rejects a candidate');
  const notThisPerson = await request('POST', `/reports/found/${walked.foundReport.id}/review`, { token: sjpu.token, body: { decision: 'rejected', note: 'Not him: no scar on the chin' } });
  assert(notThisPerson.advanced === true && notThisPerson.foundReport === null, `rejecting the closest case moves to the next, which this desk cannot open: ${JSON.stringify(notThisPerson)}`);
  const second = await stored(walked.foundReport.id);
  assert(
    second.matchedReportId === k2.report.id && second.status === 'pending_review' && second.district === 'Thane' &&
      second.reportedLocation?.district === 'Mumbai' &&
      second.matchCandidates.find((c) => c.reportId === k1.report.id)?.status === 'rejected' &&
      second.rejectedLinks?.some((l) => l.reportId === k1.report.id),
    `the next candidate is proposed, in its case's jurisdiction: ${JSON.stringify({ matchedReportId: second.matchedReportId, district: second.district, status: second.status })}`
  );
  const adminAlert = (await inbox(admin)).find((row) => row.scope?.foundReportId === walked.foundReport.id && row.scope?.matched === true && row.scope?.district === 'Thane');
  assert(adminAlert && adminAlert.priority === 'high' && !adminAlert.body.includes('Kiran'), "the next case's police officers are alerted, without a name");
  const lastOne = await request('POST', `/reports/found/${walked.foundReport.id}/review`, { token: superAdmin.token, body: { decision: 'rejected' } });
  assert(lastOne.advanced === false, 'with no candidate left nothing is proposed');
  const rested = await stored(walked.foundReport.id);
  assert(
    rested.status === 'no_match' && !rested.matchedReportId && rested.state === 'Maharashtra' && rested.district === 'Mumbai' &&
      rested.matchCandidates.filter((c) => c.status === 'rejected').length === 2,
    `the sighting goes back to the reporter's own district and queue: ${JSON.stringify({ status: rested.status, district: rested.district })}`
  );
  const again = await request('POST', `/reports/found/${walked.foundReport.id}/rematch`, { token: sjpu.token });
  assert(again.linked === false && !(await stored(walked.foundReport.id)).matchedReportId, 'a rejected pair is never proposed again');
  const reverseAgain = await request('POST', `/reports/${k1.report.id}/rematch`, { token: sjpu.token });
  assert(reverseAgain.sightingMatches === 0, 'not from the case side either');
  await expectStatus(403, () => request('POST', `/reports/found/${walked.foundReport.id}/rematch`, { token: cwc.token }), 'a CWC desk searches a sighting again');
  await expectStatus(404, () => request('POST', '/reports/found/f_not_a_sighting/rematch', { token: sjpu.token }), 'search again for an unknown sighting');

  // --- The rescue alert goes where the confirmed sighting was seen -------------
  const rescueCase = await register(sjpu.token, { childName: 'Rescue Smoke Child', parentPhone: '9876500303' }, facePhotoFile('RS', 'case'));
  const seenInPune = await sight(facePhotoFile('RS'), { at: { state: 'Maharashtra', district: 'Pune' }, foundLocation: 'Swargate bus depot' });
  const seenInNashik = await sight(facePhotoFile('RS'), { at: { state: 'Maharashtra', district: 'Nashik' }, foundLocation: 'Nashik Road station' });
  assert((await stored(seenInPune.foundReport.id)).matchedReportId === rescueCase.report.id && (await stored(seenInNashik.foundReport.id)).matchedReportId === rescueCase.report.id, 'precondition: both sightings are linked');
  await expectStatus(409, () => request('POST', `/reports/${rescueCase.report.id}/confirm-match`, {
    token: sjpu.token,
    body: { sendSms: false, foundReportId: walked.foundReport.id, verification: SMOKE_VERIFICATION },
  }), 'confirm a case with a sighting that is not linked to it');
  await request('POST', `/reports/${rescueCase.report.id}/confirm-match`, {
    token: sjpu.token,
    body: { sendSms: false, foundReportId: seenInPune.foundReport.id, verification: SMOKE_VERIFICATION },
  });
  const rescue = (await inbox(sjpu)).find((row) => row.kind === 'match_confirmed' && row.scope?.reportId === rescueCase.report.id);
  assert(
    rescue?.scope?.foundReportId === seenInPune.foundReport.id && /Swargate bus depot/.test(rescue.body) && /Pune/.test(rescue.body) && !/Nashik/.test(rescue.body),
    `the rescue alert is for the confirmed sighting, where it was seen: ${JSON.stringify(rescue)}`
  );
  const confirmedPune = await stored(seenInPune.foundReport.id);
  assert(confirmedPune.status === 'matched' && confirmedPune.matchCandidates.find((c) => c.reportId === rescueCase.report.id)?.status === 'confirmed', 'the confirmed sighting and its candidate are marked confirmed');

  // --- The pool: closed cases and found-child intakes are not compared ---------
  const closedCase = await register(sjpu.token, { childName: 'Closed Smoke Child', parentPhone: '9876500304' }, facePhotoFile('CL', 'case'));
  await request('POST', `/reports/${closedCase.report.id}/close-case`, { token: sjpu.token, body: { reason: 'restored_family', foundLocation: 'Home', note: 'Closed before any sighting' } });
  const afterClose = await sight(facePhotoFile('CL'));
  assert(!(await stored(afterClose.foundReport.id)).matchedReportId, 'a closed case is not compared with a new sighting');

  const foundChild = await sight(facePhotoFile('FI'));
  const intake = await request('POST', `/reports/found/${foundChild.foundReport.id}/formal-intake`, {
    token: cwc.token,
    body: { childName: 'Unknown child FI', intakeAuthority: 'Smoke Shelter Home', note: 'Taken into care after the sighting smoke check.', ageApprox: '9', gender: 'Male' },
  });
  const tenYears = Date.now() + 3000 * 86400000;
  assert(
    intake.report.photoFile && intake.report.photoFile !== (await stored(foundChild.foundReport.id)).photoFile &&
      intake.report.photoCheck?.verdict === 'usable' && Date.parse(intake.report.retentionUntil) > tenYears,
    `a found-child intake keeps its own copy of the photo, screened, for the case retention period: ${JSON.stringify({ photoFile: intake.report.photoFile, photoCheck: intake.report.photoCheck, retentionUntil: intake.report.retentionUntil })}`
  );
  const intakePhoto = await fetch(`${base}/reports/photo/${intake.report.id}`, { headers: { Authorization: `Bearer ${cwc.token}` } });
  assert(intakePhoto.ok && (await intakePhoto.arrayBuffer()).byteLength > 0, 'the intake photo is served to the desk that holds the child');
  const sameChildAgain = await sight(facePhotoFile('FI'), { at: thane });
  assert((await stored(sameChildAgain.foundReport.id)).matchedReportId !== intake.report.id, 'a sighting is never matched with a found-child intake');
  // The intake stands in for its sighting once the sighting itself may no
  // longer be compared: here, after a privacy officer anonymised it.
  await request('POST', `/dashboard/privacy/retention/foundReport/${foundChild.foundReport.id}`, {
    token: superAdmin.token,
    body: { decision: 'anonymize', approvalReference: 'SMOKE-ORDER-77', approvalType: 'privacy_officer' },
  });
  await request('POST', `/dashboard/privacy/retention/foundReport/${sameChildAgain.foundReport.id}`, {
    token: superAdmin.token,
    body: { decision: 'anonymize', approvalReference: 'SMOKE-ORDER-78', approvalType: 'privacy_officer' },
  });
  const missingFI = await register(sjpu.token, { childName: 'Farhan Intake Smoke', parentPhone: '9876500305' }, facePhotoFile('FI', 'case'));
  const viaIntake = await stored(foundChild.foundReport.id);
  assert(
    missingFI.sightingMatches === 1 && viaIntake.matchedReportId === missingFI.report.id && viaIntake.reverseMatch?.viaIntakeReportId === intake.report.id,
    `the reverse search reaches a found child in care through the intake: ${JSON.stringify({ sightingMatches: missingFI.sightingMatches, matchedReportId: viaIntake.matchedReportId, reverseMatch: viaIntake.reverseMatch })}`
  );
  await expectStatus(409, () => request('POST', `/reports/${intake.report.id}/rematch`, { token: sjpu.token }), 'compare a found-child intake with sightings');

  // --- Searching again, one sighting and in batches -----------------------------
  fake.down = true;
  const missedSighting = await sight(facePhotoFile('RM'));
  const missedCase = await register(sjpu.token, { childName: 'Rehan Rematch Smoke', parentPhone: '9876500306' }, facePhotoFile('RM', 'case'));
  const batchSighting = await sight(facePhotoFile('RB'));
  const batchCase = await register(sjpu.token, { childName: 'Ritu Batch Smoke', gender: 'Female', parentPhone: '9876500307' }, facePhotoFile('RB', 'case'));
  fake.down = false;
  const missed = await stored(missedSighting.foundReport.id);
  assert(!missed.matchedReportId && missed.matchEngine?.biometric === false, 'precondition: no face was compared during the outage');
  assert(missedCase.report.photoCheck?.verdict === 'unchecked' && missedCase.report.photoCheck.faces === null, `a case photo no engine could screen is "not checked": ${JSON.stringify(missedCase.report.photoCheck)}`);
  const searched = await request('POST', `/reports/found/${missedSighting.foundReport.id}/rematch`, { token: sjpu.token });
  assert(
    searched.linked === true && searched.engine?.biometric === true && searched.engine.comparedAgainst >= 1 &&
      searched.foundReport?.matchedReportId === missedCase.report.id,
    `searching a sighting again links what the outage missed: ${JSON.stringify({ linked: searched.linked, engine: searched.engine })}`
  );
  const rematchAudit = (await request('GET', '/dashboard/audit', { token: superAdmin.token })).audit.find((row) => row.action === 'sighting.rematched' && row.targetId === missedSighting.foundReport.id);
  assert(rematchAudit?.metadata?.linked === true && rematchAudit.metadata.configHash, 'searching again is audited with the configuration it ran under');

  await expectStatus(403, () => request('POST', '/dashboard/rematch-sightings', { token: sjpu.token, body: {} }), 'a police desk runs the re-match batch');
  let since = null;
  let batchRuns = 0;
  let lastBatch = null;
  do {
    // eslint-disable-next-line no-await-in-loop
    lastBatch = await request('POST', '/dashboard/rematch-sightings', { token: superAdmin.token, body: { limit: 20, ...(since ? { since } : {}) } });
    since = lastBatch.since;
    batchRuns += 1;
    assert(lastBatch.processed <= 20, 'a batch is at most 20 sightings');
  } while (lastBatch.remaining > 0 && batchRuns < 12);
  assert(lastBatch.remaining === 0, `the batch runs to the end: ${JSON.stringify(lastBatch)}`);
  assert((await stored(batchSighting.foundReport.id)).matchedReportId === batchCase.report.id, 'the batch links the sighting the outage missed');
  const quiet = await request('POST', '/dashboard/rematch-sightings', { token: superAdmin.token, body: { limit: 20, since } });
  assert(quiet.processed === 0 && quiet.remaining === 0, 'a sighting searched in this run is not searched again in it');

  // One provider fault is retried rather than losing the comparison.
  const retryCase = await register(sjpu.token, { childName: 'Retry Smoke Child', parentPhone: '9876500308' }, facePhotoFile('RT', 'case'));
  fake.downOnce = 1;
  const retried = await sight(facePhotoFile('RT'));
  fake.downOnce = 0;
  assert((await stored(retried.foundReport.id)).matchedReportId === retryCase.report.id, 'a single provider fault is retried');

  // --- Placing a sighting --------------------------------------------------------
  fake.down = true;
  const unplaced = await sight(facePhotoFile('PL'), { at: null, foundLocation: 'Outside a temple, place not given' });
  const placeCase = await register(superAdmin.token, { childName: 'Pooja Placement Smoke', gender: 'Female', parentPhone: '9876500309', ...thane }, facePhotoFile('PL', 'case'));
  fake.down = false;
  assert(!(await stored(unplaced.foundReport.id)).district, 'precondition: the sighting has no district');
  const place = (account, body) => request('POST', `/reports/found/${unplaced.foundReport.id}/place`, { token: account.token, body });
  await expectStatus(403, () => place(cwc, { state: 'Maharashtra', district: 'Thane' }), 'a CWC desk places a sighting');
  await expectStatus(403, () => place(sjpu, { state: 'Gujarat', district: 'Surat' }), 'a police desk places a sighting in another state');
  await expectStatus(400, () => place(admin, { state: 'Maharashtra' }), 'a placement with no district');
  const placed = await place(admin, { state: ' Maharashtra ', district: 'Thane district' });
  const afterPlace = await stored(unplaced.foundReport.id);
  assert(
    afterPlace.reportedLocation?.state === 'Maharashtra' && afterPlace.reportedLocation?.district === 'Thane' && afterPlace.locationSource === 'officer' &&
      placed.linked === true && afterPlace.matchedReportId === placeCase.report.id,
    `placing a sighting sets its district and searches from there: ${JSON.stringify({ reportedLocation: afterPlace.reportedLocation, linked: placed.linked, matchedReportId: afterPlace.matchedReportId })}`
  );
  const placedAudit = (await request('GET', '/dashboard/audit', { token: superAdmin.token })).audit.find((row) => row.action === 'sighting.placed' && row.targetId === unplaced.foundReport.id);
  assert(placedAudit?.metadata?.to?.district === 'Thane', 'a placement is audited');
  const unplacedText = new FormData();
  unplacedText.set('foundLocation', 'Bus shelter, place unknown');
  unplacedText.set('note', 'Child alone, no photo');
  unplacedText.set('reporterPhone', nextPhone());
  const textUnplaced = await request('POST', '/reports/found', { form: unplacedText });
  await request('POST', `/reports/found/${textUnplaced.foundReport.id}/place`, { token: admin.token, body: { state: 'Maharashtra', district: 'Mumbai' } });
  assert(
    (await inbox(cwc)).some((row) => row.scope?.foundReportId === textUnplaced.foundReport.id && /placed in your district/.test(row.body) && row.scope.matched === false),
    "the desks of the district a sighting is placed in are told it is theirs"
  );

  // --- The case photo check, and replacing a photo ------------------------------
  const usable = await register(sjpu.token, { childName: 'Usable Photo Smoke', parentPhone: '9876500310' }, facePhotoFile('PC1', 'case'));
  assert(usable.report.photoCheck?.verdict === 'usable' && usable.report.photoCheck.faces === 1, `a case photo with one face is usable: ${JSON.stringify(usable.report.photoCheck)}`);
  const group = await register(sjpu.token, { childName: 'Group Photo Smoke', parentPhone: '9876500311' }, groupPhoto('PC2'));
  assert(group.report.photoCheck?.verdict === 'multiple_faces' && group.report.photoCheck.faces === 2, `a group photo is flagged: ${JSON.stringify(group.report.photoCheck)}`);
  const noFace = await register(sjpu.token, { childName: 'No Face Photo Smoke', parentPhone: '9876500312' }, tinyPngFile());
  assert(noFace.report.photoCheck?.verdict === 'no_face' && noFace.report.status === 'missing', `a photo with no face is flagged and the case still registered: ${JSON.stringify(noFace.report.photoCheck)}`);
  const parentCase = await register(parent.token, { childName: 'Parent Photo Smoke', parentPhone: '9876500313' }, facePhotoFile('PC4', 'case'));
  assert(!('photoCheck' in parentCase.report), 'a family is not shown the photo check');

  const waitingSighting = await sight(facePhotoFile('PC3'));
  const replaceForm = (photo, consent = false) => {
    const form = new FormData();
    if (photo) form.set('photo', photo);
    if (consent) form.set('photoConsent', 'true');
    return form;
  };
  const replace = (account, id, form) => request('POST', `/reports/${id}/photo`, { token: account.token, form });
  await expectStatus(403, () => replace(cwc, noFace.report.id, replaceForm(facePhotoFile('PC3', 'case'))), 'a CWC desk replaces a case photo');
  await expectStatus(403, () => replace(parent, noFace.report.id, replaceForm(facePhotoFile('PC3', 'case'))), 'a parent replaces a case photo');
  await expectStatus(404, () => replace(sjpu, 'r_not_a_case', replaceForm(facePhotoFile('PC3', 'case'))), 'replace the photo of an unknown case');
  await expectStatus(400, () => replace(sjpu, noFace.report.id, replaceForm(null)), 'replace a photo without a photo');
  const notAnImage = await expectStatus(400, () => replace(sjpu, noFace.report.id, replaceForm(new File([Buffer.from('this is a text file, honestly')], 'fake.png', { type: 'image/png' }))), 'replace a photo with bytes that are no image');
  assert(/does not look like a JPG, PNG or WebP image/.test(notAnImage.error), `the refusal says why: ${notAnImage.error}`);
  const replaced = await replace(sjpu, noFace.report.id, replaceForm(facePhotoFile('PC3', 'case')));
  assert(
    replaced.photoCheck?.verdict === 'usable' && replaced.report.photoCheck?.verdict === 'usable' && replaced.report.photoFile !== noFace.report.photoFile &&
      /\?v=/.test(replaced.report.photoUrl) && replaced.sightingMatches === 1,
    `a replaced photo is checked again and compared with the stored sightings: ${JSON.stringify({ photoCheck: replaced.photoCheck, sightingMatches: replaced.sightingMatches })}`
  );
  assert((await stored(waitingSighting.foundReport.id)).matchedReportId === noFace.report.id, 'the sighting the new photo matches is linked for review');
  const replaceAudit = (await request('GET', '/dashboard/audit', { token: superAdmin.token })).audit.find((row) => row.action === 'case.photo_replaced' && row.targetId === noFace.report.id);
  assert(replaceAudit?.metadata?.photoCheck === 'usable' && replaceAudit.metadata.previousPhotoCheck === 'no_face', 'replacing a photo is audited');
  const servedPhoto = await fetch(`${base}/reports/photo/${noFace.report.id}`, { headers: { Authorization: `Bearer ${sjpu.token}` } });
  assert(servedPhoto.ok && Buffer.from(await servedPhoto.arrayBuffer()).includes(Buffer.from('KHOZO-SMOKE-FACE:PC3:case;')), 'the case serves the new photo');
  assert((await storedCase(noFace.report.id)).photoCheck?.verdict === 'usable', 'the case keeps the new check');

  // --- Upload limits ----------------------------------------------------------------
  const tooLarge = Buffer.concat([TINY_PNG, Buffer.alloc(8 * 1024 * 1024 + 1024, 0x20)]);
  const largeForm = sightingForm(new File([tooLarge], 'huge.png', { type: 'image/png' }));
  const refusedLarge = await expectStatus(413, () => request('POST', '/reports/found', { form: largeForm }), 'a sighting photo over 8 MB');
  assert(/larger than 8 MB/.test(refusedLarge.error || ''), `a photo over 8 MB is refused with the reason: ${JSON.stringify(refusedLarge)}`);
  const fakeJpeg = sightingForm(new File([Buffer.from('GIF89a this is not a jpeg at all')], 'photo.jpg', { type: 'image/jpeg' }));
  const refusedBytes = await expectStatus(400, () => request('POST', '/reports/found', { form: fakeJpeg }), 'a sighting photo whose bytes are no image');
  assert(refusedBytes.error === 'Sighting photo does not look like a JPG, PNG or WebP image', `refused by its bytes: ${refusedBytes.error}`);
  const gif = sightingForm(new File([Buffer.from('GIF89a')], 'photo.gif', { type: 'image/gif' }));
  await expectStatus(400, () => request('POST', '/reports/found', { form: gif }), 'a sighting photo of a type other than JPEG, PNG or WebP');
}

let fakeAarakshak;

/**
 * The gazetteer through the running API, on both runtimes: the pickers' lists
 * (served by the Worker without loading the case store), a place stored by
 * its canonical name and LGD code, and a family's report alerting the desks
 * that verify it. The resolvers themselves are checked in scripts/geo-smoke.mjs.
 */
async function jurisdictionApiChecks({ superAdmin, parent, police, cwc }) {
  const states = await fetch(`${base}/geo/states`);
  const stateBody = await states.json();
  assert(states.ok && stateBody.states?.length === 36, `GET /geo/states should list 36 states and UTs, got ${stateBody.states?.length}`);
  assert(/public/.test(states.headers.get('cache-control') || ''), 'GET /geo/states should be publicly cacheable');
  const gujarat = await request('GET', '/geo/districts?state=24');
  const ahmedabad = gujarat.districts?.find((d) => d.code === '438');
  assert(ahmedabad?.names?.gu === 'અમદાવાદ' && ahmedabad.names.hi && ahmedabad.names.mr, 'GET /geo/districts?state=24 should list Ahmedabad in four languages');
  await expectStatus(400, () => request('GET', '/geo/districts'), 'district list with no state');
  await expectStatus(404, () => request('GET', '/geo/districts?state=Atlantis'), 'district list for an unknown state');

  const caseIn = (fields) => {
    const form = new FormData();
    addDeclaration(form, 'Smoke Jurisdiction Declarant');
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  };
  const official = await request('POST', '/reports', {
    token: superAdmin.token,
    form: caseIn({ childName: 'Smoke Gazetteer Officer Case', age: '11', gender: 'Female', state: 'GUJARAT', district: 'Ahmdabad', parentPhone: '9876500201' }),
  });
  assert(
    official.report.state === 'Gujarat' && official.report.stateCode === '24' && official.report.district === 'Ahmedabad' && official.report.districtCode === '438',
    `an officer's "GUJARAT" / "Ahmdabad" should be stored canonical with codes, got ${JSON.stringify([official.report.state, official.report.district, official.report.stateCode, official.report.districtCode])}`
  );
  const refused = await expectStatus(400, () => request('POST', '/reports', {
    token: superAdmin.token,
    form: caseIn({ childName: 'Smoke Gazetteer Nowhere', age: '11', gender: 'Female', state: 'Gujarat', district: 'Maninagar', parentPhone: '9876500202' }),
  }), 'an officer case in an unknown district');
  assert(refused.code === 'unknown_district' && refused.options === '/api/geo/districts?state=24', 'the refusal should point at the district list');

  // A family's report in Mumbai, typed in Marathi: alerts the Mumbai police
  // and CWC desks (shared/routes/reports.js alertIntake), without a name.
  const family = await request('POST', '/reports', {
    token: parent.token,
    form: caseIn({ childName: 'Smoke Gazetteer Family Child', age: '7', state: 'महाराष्ट्र', district: 'मुंबई', parentPhone: '9876500203' }),
  });
  assert(family.report.status === 'intake_pending' && family.report.districtCode === '482', `a family's Marathi place should resolve to Mumbai, got ${family.report.district}`);
  assert(family.report.gender === 'Unknown', `a family's report with no gender should record Unknown, got ${family.report.gender}`);
  for (const [account, label] of [[police, 'police'], [cwc, 'CWC']]) {
    const inbox = await request('GET', '/dashboard/notifications', { token: account.token });
    const alert = inbox.notifications.find((n) => n.kind === 'intake_pending' && n.scope?.reportId === family.report.id);
    assert(alert, `the ${label} desk of the district should be alerted to a family's report`);
    assert(!JSON.stringify(alert).includes('Smoke Gazetteer Family Child'), `the ${label} alert must not name the person`);
  }
  const stats = await request('GET', '/dashboard/stats', { token: police.token });
  assert(stats.intakes?.pending >= 1 && stats.intakes.oldest.some((row) => row.id === family.report.id), 'the station overview should list the intake waiting on it');
}

async function run() {
  // The public-disclosure rules that the API can no longer be driven into
  // breaking (a legacy published record, the /child/:id share preview), and
  // the receipt stage's independence from the outcome.
  await legacyAppealChecks();
  receiptStageChecks();
  await scopeRouteChecks();
  await familySmsChecks();

  fakeAarakshak = await startFakeAarakshak();
  devDbHashBefore = fileHash(devDbFile);
  server = spawn(process.execPath, [runtime.entry], {
    cwd: runtime.cwd,
    env: {
      ...process.env,
      // Run against an isolated JSON store, not the real database and not the
      // developer's db.json: a fresh temporary directory, seeded by the server
      // on start and deleted afterwards. This suite deliberately trips rate
      // limits and abuse paths - none of which belongs in the live Postgres
      // instance - and two runs at once must not share a file.
      DATABASE_URL: '',
      KHOZO_DATA_DIR: dataDir,
      PORT: String(port),
      KHOZO_FOUND_REPORT_LIMIT: '2',
      KHOZO_REGISTER_LIMIT: '20',
      KHOZO_LOGIN_LIMIT: '40',
      KHOZO_CASE_STATUS_LIMIT: '2',
      KHOZO_SIGHTING_STATUS_LIMIT: '2',
      KHOZO_GRIEVANCE_STATUS_LIMIT: '2',
      // Face comparison goes to the stand-in above, never to a real provider:
      // Aarakshak is pointed at it, and Rekognition is left unconfigured.
      AARAKSHAK_API_URL: fakeAarakshak.url,
      AARAKSHAK_API_KEY: fakeAarakshak.key,
      AARAKSHAK_TIMEOUT_MS: '5000',
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
      KHOZO_REKOGNITION_ENDPOINT: '',
      // No one-to-many index (shared/face-index.js): the pairwise budget.
      AARAKSHAK_GALLERY_URL: '',
      AARAKSHAK_GALLERY_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (buf) => process.stdout.write(`[api] ${buf}`));
  server.stderr.on('data', (buf) => process.stderr.write(`[api] ${buf}`));
  await waitForServer();

  const superAdmin = await login('superadmin@khozo.org');
  const admin = await login('admin@khozo.org');
  const sjpu = await login('sjpu@khozo.org');
  const ahtu = await login('ahtu@khozo.org');
  const dcrb = await login('dcrb@khozo.org');
  const dlsa = await login('dlsa@khozo.org');
  const cwc = await login('cwc@khozo.org');
  const saa = await login('saa@khozo.org');
  const jjb = await login('jjb@khozo.org');
  const sara = await login('sara@khozo.org');
  const crimeBureau = await login('crimebureau@khozo.org');
  const parent = await login('parent@khozo.org');

  await jurisdictionApiChecks({ superAdmin, parent, police: await login('police@khozo.org'), cwc });

  const parentReports = await request('GET', '/reports', { token: parent.token });
  assert(parentReports.reports.some((row) => row.childName === 'suresh'), 'demo parent should see owned seeded report');
  // The public directory lists desks, never the officers staffing them.
  const DESK_KEYS = 'district,org,role,roleLabel,state';
  const roster = (await request('GET', '/dashboard/network', { token: superAdmin.token })).users;
  const personal = roster.flatMap((u) => [u.id, u.name, u.phone, u.email]).filter((v) => v && String(v).length > 3).map(String);
  const assertDesks = (rows, label) => {
    const odd = rows.find((row) => Object.keys(row).sort().join() !== DESK_KEYS);
    assert(!odd, `${label}: every entry should be a desk with only ${DESK_KEYS}, got ${JSON.stringify(odd)}`);
    const text = JSON.stringify(rows);
    const leaked = personal.find((value) => text.includes(value));
    assert(!leaked, `${label} must not carry any account id, name, phone or email (found ${leaked})`);
    const keys = rows.map((row) => [row.role, row.org, row.state, row.district].join('|'));
    assert(new Set(keys).size === keys.length, `${label} should list each desk once`);
  };
  const publicDirectory = await request('GET', '/dashboard/public/directory');
  assert(publicDirectory.emergency.some((row) => row.phone === '1098'), 'public directory should include Childline');
  for (const role of ['sjpu', 'ahtu', 'dcrb', 'dlsa', 'cwc', 'saa', 'sara']) {
    assert(publicDirectory.directory.some((row) => row.role === role), `public directory should include ${role} desks`);
  }
  assertDesks(publicDirectory.directory, 'public directory');
  assert(publicDirectory.directory.find((row) => row.role === 'sjpu')?.roleLabel === 'SJPU', 'a desk should carry its role label');
  const mumbaiDirectory = await request('GET', '/dashboard/public/directory?state=Maharashtra&district=Mumbai');
  assert(mumbaiDirectory.directory.length > 0, 'Mumbai public directory should include desks');
  assert(mumbaiDirectory.directory.every((row) => row.state === 'Maharashtra'), 'public directory state filter should apply');
  assert(mumbaiDirectory.directory.every((row) => row.district === 'Mumbai'), 'public directory district filter should apply');
  const dangerRouting = await request('GET', '/dashboard/public/directory?state=Maharashtra&district=Mumbai&incidentType=immediate_danger');
  assert(dangerRouting.emergencyPlan.primary?.phone === '112', 'immediate danger route should prioritize ERSS 112');
  assert(dangerRouting.emergencyPlan.secondary.some((row) => row.phone === '1098'), 'immediate danger route should include Childline backup');
  for (const role of ['sjpu', 'ahtu', 'dcrb', 'dlsa', 'police']) {
    assert(dangerRouting.emergencyPlan.localContacts.some((row) => row.role === role), `immediate danger route should include ${role} desks`);
  }
  assertDesks(dangerRouting.emergencyPlan.localContacts, 'emergency route desks');
  const welfareRouting = await request('GET', '/dashboard/public/directory?state=Maharashtra&district=Mumbai&incidentType=welfare');
  assert(welfareRouting.emergencyPlan.primary?.phone === '1098', 'welfare route should prioritize Childline 1098');
  for (const role of ['cwc', 'dcpu', 'saa', 'dlsa']) {
    assert(welfareRouting.emergencyPlan.localContacts.some((row) => row.role === role), `welfare route should include ${role} desks`);
  }
  const railwayRouting = await request('GET', '/dashboard/public/directory?state=Maharashtra&district=Mumbai&incidentType=railway');
  assert(railwayRouting.emergencyPlan.primary?.phone === '139', 'railway route should prioritize railway helpline 139');
  assert(railwayRouting.emergencyPlan.secondary.some((row) => row.phone === '1098'), 'railway route should include Childline backup');
  assert(railwayRouting.emergencyPlan.localContacts.some((row) => row.role === 'rpf'), 'railway route should include RPF desks');
  const sjpuDirectory = await request('GET', '/dashboard/public/directory?role=sjpu');
  assert(sjpuDirectory.directory.length > 0 && sjpuDirectory.directory.every((row) => row.role === 'sjpu'), 'the role filter should apply');
  assertDesks(sjpuDirectory.directory, 'SJPU public directory');
  // Rate limited per address: 60 a minute. A separate client address, so the
  // rest of the suite keeps its own allowance.
  const burst = { 'x-forwarded-for': '203.0.113.61', 'cf-connecting-ip': '203.0.113.61' };
  for (let i = 0; i < 60; i += 1) await request('GET', '/dashboard/public/directory', { headers: burst });
  await expectStatus(429, () => request('GET', '/dashboard/public/directory', { headers: burst }), 'public directory rate limit');
  const grievance = await request('POST', '/grievances', {
    body: {
      grievanceType: 'sighting_followup',
      reportToLevel: 'cwc',
      name: 'Smoke Grievance Citizen',
      phone: '9000000888',
      email: 'smoke.grievance@example.org',
      state: 'Maharashtra',
      district: 'Mumbai',
      linkedReceiptId: 'f_public_receipt',
      subject: 'Smoke grievance follow-up',
      description: 'Smoke grievance description should stay out of audit payloads and only appear in the grievance queue.',
      attachmentName: 'smoke-supporting-note.pdf',
    },
  });
  assert(grievance.grievance.id?.startsWith('g_'), 'public grievance should return receipt id');
  assert(grievance.grievance.status === 'submitted', 'public grievance should start submitted');
  const grievanceStatus = await request('GET', `/grievances/status/${grievance.grievance.id}`);
  assert(grievanceStatus.grievance.id === grievance.grievance.id, 'public grievance status should resolve by receipt id');
  assert(!('description' in grievanceStatus.grievance), 'public grievance status should not expose description');
  await request('GET', `/grievances/status/${grievance.grievance.id}`);
  await expectStatus(429, () => request('GET', `/grievances/status/${grievance.grievance.id}`), 'public grievance status rate limit');
  await expectStatus(404, () => request('GET', '/grievances/status/g_missing_receipt'), 'missing public grievance receipt');
  const adoptionGrievance = await request('POST', '/grievances', {
    body: {
      grievanceType: 'adoption_carings',
      reportToLevel: 'saa',
      name: 'Smoke Adoption Citizen',
      phone: '9000000889',
      email: 'smoke.adoption.grievance@example.org',
      state: 'Maharashtra',
      district: 'Mumbai',
      linkedReceiptId: 'CARINGS/SMOKE/GRIEVANCE',
      subject: 'Smoke adoption grievance',
      description: 'CARINGS smoke grievance detail should stay out of audit payloads and only appear in the grievance queue.',
      attachmentName: 'smoke-carings-note.pdf',
    },
  });
  assert(adoptionGrievance.grievance.grievanceType === 'adoption_carings', 'adoption grievance should preserve type');
  assert(adoptionGrievance.grievance.reportToLevel === 'saa', 'adoption grievance should preserve SAA report-to level');
  assert(adoptionGrievance.grievance.grievanceLabel === 'Adoption / CARINGS support', 'adoption grievance should return public label');
  assert(adoptionGrievance.grievance.reportToLabel === 'SAA', 'adoption grievance should return SAA public label');
  await expectStatus(403, () => request('POST', '/auth/register', {
    body: {
      name: 'Blocked Public Police',
      email: 'blocked.public.police@khozo.org',
      password: 'khozo123',
      role: 'police',
      phone: '9788197572',
      state: 'Maharashtra',
      district: 'Mumbai',
    },
  }), 'public privileged registration blocked');
  await expectStatus(400, () => request('POST', '/auth/register', {
    body: {
      name: 'No OTP Parent',
      email: 'no.otp.parent@khozo.org',
      password: 'khozo123',
      role: 'parent',
      phone: '9788197571',
      state: 'Tamil Nadu',
      district: 'Perambalur',
    },
  }), 'public registration without OTP');
  const samePhoneOtp = await publicOtp('9788197570');
  await expectStatus(400, () => request('POST', '/auth/register', {
    body: {
      name: 'Bad OTP Parent',
      email: 'bad.otp.parent@khozo.org',
      password: 'khozo123',
      role: 'parent',
      phone: '9788197570',
      otp: '000000',
      state: 'Tamil Nadu',
      district: 'Perambalur',
    },
  }), 'public registration wrong OTP');
  const samePhone = await request('POST', '/auth/register', {
    body: {
      name: 'Same Phone Parent',
      email: 'same.phone.parent@khozo.org',
      password: 'khozo123',
      role: 'parent',
      phone: '9788197570',
      otp: samePhoneOtp,
      state: 'Tamil Nadu',
      district: 'Perambalur',
    },
  });
  const samePhoneReports = await request('GET', '/reports', { token: samePhone.token });
  assert(samePhoneReports.reports.length === 0, 'unverified same-phone parent should not inherit another parent report');

  const badAgeReportForm = new FormData();
  badAgeReportForm.set('childName', 'Impossible Age Child');
  badAgeReportForm.set('age', '27');
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: badAgeReportForm }), 'invalid child age');

  const noDeclarationForm = new FormData();
  noDeclarationForm.set('childName', 'No Declaration Child');
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: noDeclarationForm }), 'missing report declaration');

  const futureReportForm = new FormData();
  futureReportForm.set('childName', 'Future Missing Child');
  addDeclaration(futureReportForm);
  futureReportForm.set('dateOfMissing', '2999-01-01');
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: futureReportForm }), 'future missing date');

  const badFileReportForm = new FormData();
  badFileReportForm.set('childName', 'Bad File Child');
  addDeclaration(badFileReportForm);
  badFileReportForm.set('photoConsent', 'true');
  badFileReportForm.set('photo', textFile());
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: badFileReportForm }), 'non-image child photo');

  const photoReportForm = new FormData();
  photoReportForm.set('childName', 'Smoke Photo Child');
  addDeclaration(photoReportForm, 'Smoke Report Declarant');
  photoReportForm.set('gender', 'Female');
  photoReportForm.set('age', '6');
  photoReportForm.set('state', 'Tamil Nadu');
  photoReportForm.set('district', 'Perambalur');
  photoReportForm.append('vulnerabilityCategories', 'unaccompanied');
  photoReportForm.append('vulnerabilityCategories', 'language_barrier');
  photoReportForm.set('producedByType', 'citizen');
  photoReportForm.set('educationLevel', 'primary');
  photoReportForm.set('disabilityStatus', 'unknown');
  photoReportForm.set('mentalHealthConcern', 'no');
  photoReportForm.set('complexion', 'Smoke complexion detail should stay private.');
  photoReportForm.set('clothing', 'Smoke clothing detail should stay private.');
  photoReportForm.set('identificationMark', 'Smoke identification mark should stay private.');
  photoReportForm.set('circumstances', 'Smoke Form-J circumstances should stay out of audit payloads and public lookup.');
  photoReportForm.set('photoConsent', 'true');
  photoReportForm.set('photo', tinyPngFile());
  const photoReport = await request('POST', '/reports', { token: parent.token, form: photoReportForm });
  assert(photoReport.report.photoUrl, 'photo report should include photoUrl');
  assert(photoReport.report.status === 'intake_pending', 'citizen report should start as pending intake');
  assert(photoReport.report.declaration?.accepted === true, 'missing-child report should store accepted declaration');
  assert(photoReport.report.declaration?.signerName === 'Smoke Report Declarant', 'missing-child declaration should store signer name');
  assert(photoReport.report.identificationProfile?.clothing?.includes('Smoke clothing detail'), 'missing-child report should store identification profile');
  assert(photoReport.report.vulnerabilityProfile?.categories?.includes('language_barrier'), 'missing-child report should store vulnerability categories');
  const badProfileForm = new FormData();
  badProfileForm.set('childName', 'Bad Profile Child');
  addDeclaration(badProfileForm);
  badProfileForm.set('vulnerabilityCategories', 'bad_category');
  await expectStatus(400, () => request('POST', '/reports', { token: parent.token, form: badProfileForm }), 'invalid vulnerability category');
  await expectStatus(403, () => request('POST', `/reports/${photoReport.report.id}/bulletin`, {
    token: superAdmin.token,
    body: { publish: true },
  }), 'publish pending citizen intake');
  await expectStatus(409, () => request('POST', `/reports/${photoReport.report.id}/confirm-match`, {
    token: superAdmin.token,
    body: { sendSms: true },
  }), 'confirm pending citizen intake');
  await expectStatus(409, () => request('POST', `/reports/${photoReport.report.id}/case-workflow`, {
    token: superAdmin.token,
    body: { action: 'refer_cwc' },
  }), 'workflow pending citizen intake');
  await expectStatus(403, () => request('POST', `/reports/${photoReport.report.id}/verify-intake`, {
    token: parent.token,
    body: { note: 'Parent cannot verify intake' },
  }), 'parent verify intake');
  const verifiedPhotoReport = await request('POST', `/reports/${photoReport.report.id}/verify-intake`, {
    token: superAdmin.token,
    body: { note: 'Smoke verification of citizen intake' },
  });
  assert(verifiedPhotoReport.report.status === 'missing', 'verified citizen intake should become a missing case');
  assert(verifiedPhotoReport.report.intakeStatus === 'verified', 'verified citizen intake should record verified status');
  assert(verifiedPhotoReport.report.firNo, 'verified citizen intake should receive a formal FIR/GD number');
  // FIR/GD numbers are sequential and printed on paperwork, so they no longer
  // resolve publicly; only the random Khozo case id given to the family does.
  await expectStatus(404, () => request('GET', `/reports/public/status/${encodeURIComponent(verifiedPhotoReport.report.firNo)}`), 'public case status by FIR/GD number');
  const publicCaseStatus = await request('GET', `/reports/public/status/${photoReport.report.id}`);
  assert(publicCaseStatus.status.id === photoReport.report.id, 'public case status should resolve by the Khozo case id');
  assert(publicCaseStatus.status.status === 'missing', 'public case status should expose safe case status');
  assert(
    Object.keys(publicCaseStatus.status).sort().join() === 'id,message,nextStep,personCategory,registeredAt,status,statusLabel,updatedAt',
    `public case status should carry only the reduced fields, got ${Object.keys(publicCaseStatus.status).sort().join()}`
  );
  assert(!JSON.stringify(publicCaseStatus).includes('Smoke Photo Child'), 'public case status should never include the name');
  assert(!JSON.stringify(publicCaseStatus).includes(verifiedPhotoReport.report.firNo), 'public case status should not expose the FIR number');
  assert(typeof publicCaseStatus.status.updatedAt === 'number' && publicCaseStatus.status.updatedAt >= publicCaseStatus.status.registeredAt, 'public case status should say when it last changed');
  assert(!('parentPhone' in publicCaseStatus.status), 'public case status should not expose parent phone');
  assert(!('parentName' in publicCaseStatus.status), 'public case status should not expose parent name');
  assert(!('childAadhar' in publicCaseStatus.status), 'public case status should not expose Aadhar');
  assert(!('address' in publicCaseStatus.status), 'public case status should not expose exact address');
  assert(!('photoUrl' in publicCaseStatus.status), 'public case status should not expose protected photo URL');
  assert(!('declaration' in publicCaseStatus.status), 'public case status should not expose report declaration');
  assert(!JSON.stringify(publicCaseStatus).includes('Smoke Report Declarant'), 'public case status should not expose declaration signer');
  assert(!('identificationProfile' in publicCaseStatus.status), 'public case status should not expose identification profile');
  assert(!('vulnerabilityProfile' in publicCaseStatus.status), 'public case status should not expose vulnerability profile');
  assert(!JSON.stringify(publicCaseStatus).includes('Smoke identification mark'), 'public case status should not expose identifying marks');
  await request('GET', `/reports/public/status/${photoReport.report.id}`);
  await expectStatus(429, () => request('GET', `/reports/public/status/${photoReport.report.id}`), 'public case status rate limit');
  await expectStatus(404, () => request('GET', '/reports/public/status/CASE-NOT-FOUND'), 'missing public case reference');
  const sjpuStats = await request('GET', '/dashboard/stats', { token: sjpu.token });
  assert(sjpuStats.scope === 'Mumbai SJPU', `SJPU scope should be Mumbai SJPU, got ${sjpuStats.scope}`);
  const readiness = await request('GET', '/dashboard/readiness', { token: superAdmin.token });
  // Storage reports what is actually configured, so assert it matches reality
  // rather than pinning it to the old JSON-file default.
  // This suite always runs against the JSON store (see DATABASE_URL above), so
  // storage must report the warning that tells an operator to move to Postgres.
  const storageCheck = readiness.checks.find((row) => row.id === 'storage');
  assert(storageCheck && storageCheck.status === 'warning',
    `storage readiness should warn in JSON mode, got ${storageCheck && storageCheck.status}`);
  assert(readiness.summary.warning >= 1, 'readiness should flag demo/pilot warnings');
  assert(readiness.checks.some((row) => row.id === 'audit_integrity' && row.status === 'pass'), 'readiness should verify audit integrity');
  assert(readiness.checks.some((row) => row.id === 'match_provider' && row.detail), 'readiness should include match provider status');
  assert(readiness.checks.some((row) => row.id === 'public_abuse'), 'readiness should include public abuse monitoring');
  await expectStatus(403, () => request('GET', '/dashboard/readiness', { token: parent.token }), 'parent readiness report');
  // The panel describes the deployment, so it is the national operator's alone.
  for (const [account, label] of [[admin, 'state admin'], [sjpu, 'SJPU'], [crimeBureau, 'crime bureau'], [sara, 'SARA']]) {
    await expectStatus(403, () => request('GET', '/dashboard/readiness', { token: account.token }), `${label} readiness report`);
  }
  const sjpuForm = new FormData();
  sjpuForm.set('childName', 'SJPU Smoke Child');
  addDeclaration(sjpuForm, 'Smoke SJPU Declarant');
  sjpuForm.set('gender', 'Male');
  sjpuForm.set('age', '8');
  sjpuForm.set('state', 'Maharashtra');
  sjpuForm.set('district', 'Mumbai');
  sjpuForm.set('firNo', 'SJPU/SMOKE/2026/01');
  const sjpuReport = await request('POST', '/reports', { token: sjpu.token, form: sjpuForm });
  assert(sjpuReport.report.status === 'missing', 'SJPU should register verified formal cases');
  assert(sjpuReport.report.intakeStatus === 'verified', 'SJPU cases should start verified');
  assert(sjpuReport.report.registeredByRole === 'sjpu', 'SJPU case should preserve registered role');
  const sjpuReports = await request('GET', '/reports', { token: sjpu.token });
  assert(sjpuReports.reports.some((row) => row.id === sjpuReport.report.id), 'SJPU should see own district report');
  const sjpuMis = await request('GET', '/dashboard/mis', { token: sjpu.token });
  assert(sjpuMis.demographics.byRegistrationSource.some((row) => row.name === 'SJPU/FIR'), 'MIS should identify SJPU/FIR source');
  const ahtuStats = await request('GET', '/dashboard/stats', { token: ahtu.token });
  assert(ahtuStats.scope === 'Mumbai AHTU', `AHTU scope should be Mumbai AHTU, got ${ahtuStats.scope}`);
  const ahtuReports = await request('GET', '/reports', { token: ahtu.token });
  assert(ahtuReports.reports.some((row) => row.district === 'Mumbai'), 'AHTU should see Mumbai district reports');
  await expectStatus(403, () => request('POST', `/reports/${sjpuReport.report.id}/confirm-match`, {
    token: ahtu.token,
    body: { sendSms: true },
  }), 'AHTU confirm match');
  const dcrbStats = await request('GET', '/dashboard/stats', { token: dcrb.token });
  assert(dcrbStats.scope === 'Mumbai DCRB', `DCRB scope should be Mumbai DCRB, got ${dcrbStats.scope}`);
  const dcrbReports = await request('GET', '/reports', { token: dcrb.token });
  assert(dcrbReports.reports.some((row) => row.district === 'Mumbai'), 'DCRB should see Mumbai district reports');
  await expectStatus(403, () => request('POST', `/reports/${sjpuReport.report.id}/confirm-match`, {
    token: dcrb.token,
    body: { sendSms: true },
  }), 'DCRB confirm match');
  const dlsaStats = await request('GET', '/dashboard/stats', { token: dlsa.token });
  assert(dlsaStats.scope === 'Mumbai DLSA', `DLSA scope should be Mumbai DLSA, got ${dlsaStats.scope}`);
  const dlsaReports = await request('GET', '/reports', { token: dlsa.token });
  assert(dlsaReports.reports.some((row) => row.district === 'Mumbai'), 'DLSA should see Mumbai district reports');
  await expectStatus(403, () => request('POST', `/reports/${sjpuReport.report.id}/confirm-match`, {
    token: dlsa.token,
    body: { sendSms: true },
  }), 'DLSA confirm match');
  const saaStats = await request('GET', '/dashboard/stats', { token: saa.token });
  assert(saaStats.scope === 'Mumbai SAA', `SAA scope should be Mumbai SAA, got ${saaStats.scope}`);
  const saaReports = await request('GET', '/reports', { token: saa.token });
  assert(saaReports.reports.some((row) => row.district === 'Mumbai'), 'SAA should see Mumbai district reports');
  await expectStatus(403, () => request('POST', `/reports/${sjpuReport.report.id}/confirm-match`, {
    token: saa.token,
    body: { sendSms: true },
  }), 'SAA confirm match');
  const saraStats = await request('GET', '/dashboard/stats', { token: sara.token });
  assert(saraStats.scope === 'Maharashtra', `SARA scope should be Maharashtra, got ${saraStats.scope}`);
  const saraReports = await request('GET', '/reports', { token: sara.token });
  assert(saraReports.reports.some((row) => row.state === 'Maharashtra'), 'SARA should see Maharashtra reports');
  assert(!saraReports.reports.some((row) => row.state === 'Goa'), 'SARA should not see Goa reports');
  await expectStatus(403, () => request('POST', `/reports/${photoReport.report.id}/transfer-jurisdiction`, {
    token: parent.token,
    body: { state: 'Karnataka', district: 'Bengaluru Urban', reason: 'Parent cannot transfer jurisdiction' },
  }), 'parent jurisdiction transfer');
  const transferredPhotoReport = await request('POST', `/reports/${photoReport.report.id}/transfer-jurisdiction`, {
    token: superAdmin.token,
    body: { state: 'Karnataka', district: 'Bengaluru Urban', station: 'Bengaluru CWC Desk', reason: 'Smoke cross-state transfer' },
  });
  assert(transferredPhotoReport.report.state === 'Karnataka', 'transfer should update case state');
  assert(transferredPhotoReport.report.district === 'Bengaluru Urban', 'transfer should update case district');
  assert(transferredPhotoReport.report.transfers?.length === 1, 'transfer history should be recorded');
  // Public appeals are disabled: the public never sees the name or photo of a
  // missing person, so publishing is refused for a verified case too.
  try {
    await request('POST', `/reports/${photoReport.report.id}/bulletin`, { token: superAdmin.token, body: { publish: true } });
    throw new Error('publishing a public appeal should be refused');
  } catch (err) {
    assert(err.status === 403, `publishing a public appeal should answer 403, got ${err.status || err.message}`);
    assert(err.data?.error === PUBLIC_APPEALS_DISABLED, `publish refusal should explain the rule, got ${err.data?.error}`);
  }
  await expectStatus(403, () => request('POST', `/reports/${photoReport.report.id}/bulletin`, { token: superAdmin.token, body: {} }), 'publish by default body');
  await expectStatus(403, () => request('POST', '/reports/r_not_a_case/bulletin', { token: superAdmin.token, body: { publish: true } }), 'publish for an unknown id');
  const afterRefusal = await request('GET', `/reports/${photoReport.report.id}`, { token: superAdmin.token });
  assert(afterRefusal.report.bulletin?.published !== true, 'a refused publish must not mark the case published');
  const publicBulletins = await request('GET', '/reports/public/bulletins');
  assert(Array.isArray(publicBulletins.bulletins) && publicBulletins.bulletins.length === 0, 'the public bulletin list should always be empty');
  await expectStatus(404, () => request('GET', `/reports/public/bulletins/${photoReport.report.id}`), 'public bulletin page for a real case');
  await expectStatus(404, () => request('GET', '/reports/public/bulletins/r_not_a_case'), 'public bulletin page for an unknown id');
  await expectStatus(401, () => request('GET', `/reports/photo/${photoReport.report.id}`), 'anonymous photo of a verified missing case');
  const publicSearch = await request('GET', '/reports/public/search?state=Karnataka&status=missing');
  assert(publicSearch.results.length === 0, 'public search should never return a case');
  const nameSearch = await request('GET', `/reports/public/search?q=${encodeURIComponent('Smoke Photo Child')}`);
  assert(nameSearch.results.length === 0, 'searching a name publicly should return nothing');
  const recoveredSearch = await request('GET', '/reports/public/search?status=found&state=Maharashtra');
  assert(recoveredSearch.results.length === 0, 'public search should not list recovered cases either');
  const publicSummary = await request('GET', '/reports/public/summary');
  assert(publicSummary.summary.publicBulletins === 0, 'public summary should count no public appeals');
  assert(Number.isInteger(publicSummary.summary.activeCases) && publicSummary.summary.activeCases > 0, 'public summary should still count active cases');
  assert(!JSON.stringify(publicSummary).includes('Smoke Photo Child') && !JSON.stringify(publicSummary).includes(photoReport.report.id), 'public summary should carry counts only');
  // Unpublishing still works, so a case published before the rule can be cleaned up.
  const unpublishedBulletin = await request('POST', `/reports/${photoReport.report.id}/bulletin`, {
    token: superAdmin.token,
    body: { publish: false },
  });
  assert(unpublishedBulletin.report.bulletin?.published === false, 'unpublish should still clear the flag');
  assert(unpublishedBulletin.bulletin === null, 'unpublish should return no bulletin payload');
  await expectStatus(401, () => request('GET', photoReport.report.photoUrl.replace('/api', '')), 'anonymous report photo access');
  const parentPhoto = await fetch(`${base}${photoReport.report.photoUrl.replace('/api', '')}`, {
    headers: { Authorization: `Bearer ${parent.token}` },
  });
  assert(parentPhoto.ok, `parent should fetch own photo, got ${parentPhoto.status}`);
  await expectStatus(403, () => request('GET', photoReport.report.photoUrl.replace('/api', ''), { token: samePhone.token }), 'same-phone report photo access');

  const cwcStats = await request('GET', '/dashboard/stats', { token: cwc.token });
  assert(cwcStats.scope === 'Mumbai', `CWC scope should be Mumbai, got ${cwcStats.scope}`);
  const cwcReportsAfterTransfer = await request('GET', '/reports', { token: cwc.token });
  assert(!cwcReportsAfterTransfer.reports.some((row) => row.id === photoReport.report.id), 'Mumbai CWC should not see transferred Karnataka case');
  const cwcMis = await request('GET', '/dashboard/mis', { token: cwc.token });
  assert(cwcMis.scope === 'Mumbai', `CWC MIS scope should be Mumbai, got ${cwcMis.scope}`);
  assert(cwcMis.totals.reports >= 1, 'CWC MIS should include scoped reports');
  assert(cwcMis.demographics?.byAgeBand?.length > 0, 'CWC MIS should include age-band demographics');
  assert(cwcMis.demographics?.byGender?.length > 0, 'CWC MIS should include gender demographics');
  assert(cwcMis.demographics?.byRegistrationSource?.length > 0, 'CWC MIS should include registration-source split');
  assert(Array.isArray(cwcMis.compliance?.pendingWork), 'CWC MIS should include pending-work compliance split');
  assert(cwcMis.signature?.type === 'mis_export', 'CWC MIS should include signature type');
  assert(cwcMis.signature?.algorithm === 'sha256-hmac', 'CWC MIS should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(cwcMis.signature?.digest || ''), 'CWC MIS should include SHA-256 digest');
  const cwcMisVerify = await request('POST', '/dashboard/export/verify', {
    token: cwc.token,
    body: cwcMis,
  });
  assert(cwcMisVerify.ok === true, 'MIS signature should verify');
  assert(cwcMisVerify.type === 'mis_export', 'MIS signature verification should return type');
  const tamperedMisVerify = await request('POST', '/dashboard/export/verify', {
    token: cwc.token,
    body: { ...cwcMis, totals: { ...cwcMis.totals, reports: cwcMis.totals.reports + 1 } },
  });
  assert(tamperedMisVerify.ok === false, 'tampered MIS signature should fail verification');
  assert(!cwcMis.byState.some((row) => row.name === 'Goa'), 'CWC MIS should not include Goa cases');
  await expectStatus(403, () => request('GET', '/dashboard/mis', { token: parent.token }), 'parent MIS report');
  const cwcFollowups = await request('GET', '/dashboard/followups', { token: cwc.token });
  assert(cwcFollowups.scope === 'Mumbai', `CWC follow-up scope should be Mumbai, got ${cwcFollowups.scope}`);
  assert(cwcFollowups.alerts.some((row) => row.district === 'Mumbai'), 'CWC should see Mumbai follow-up alerts');
  assert(!cwcFollowups.alerts.some((row) => row.state === 'Goa'), 'CWC should not see Goa follow-up alerts');
  await expectStatus(403, () => request('GET', '/dashboard/followups', { token: parent.token }), 'parent follow-up alerts');
  const cwcGrievances = await request('GET', '/grievances', { token: cwc.token });
  const cwcGrievance = cwcGrievances.grievances.find((row) => row.id === grievance.grievance.id);
  assert(cwcGrievance, 'Mumbai CWC should see Mumbai grievance');
  assert(cwcGrievance.description.includes('Smoke grievance description'), 'CWC grievance queue should include full description');
  const goaGrievance = await request('POST', '/grievances', {
    body: {
      grievanceType: 'service_access',
      reportToLevel: 'dcpu',
      state: 'Goa',
      district: 'South Goa',
      subject: 'Goa smoke grievance',
      description: 'Goa smoke grievance should stay outside Mumbai CWC scope.',
    },
  });
  const cwcGrievancesAfterGoa = await request('GET', '/grievances', { token: cwc.token });
  assert(!cwcGrievancesAfterGoa.grievances.some((row) => row.id === goaGrievance.grievance.id), 'Mumbai CWC should not see Goa grievance');
  const saaGrievances = await request('GET', '/grievances', { token: saa.token });
  const saaAdoptionGrievance = saaGrievances.grievances.find((row) => row.id === adoptionGrievance.grievance.id);
  assert(saaAdoptionGrievance, 'Mumbai SAA should see Mumbai adoption grievance');
  assert(saaAdoptionGrievance.description.includes('CARINGS smoke grievance detail'), 'SAA grievance queue should include adoption grievance details');
  const saraGrievances = await request('GET', '/grievances', { token: sara.token });
  assert(saraGrievances.grievances.some((row) => row.id === adoptionGrievance.grievance.id), 'Maharashtra SARA should see in-state adoption grievance');
  await expectStatus(403, () => request('GET', '/grievances', { token: parent.token }), 'parent grievance queue');
  await expectStatus(403, () => request('POST', `/grievances/${grievance.grievance.id}/status`, {
    token: parent.token,
    body: { status: 'under_review', publicMessage: 'Parent cannot update grievance status' },
  }), 'parent grievance status update');
  const updatedGrievance = await request('POST', `/grievances/${grievance.grievance.id}/status`, {
    token: cwc.token,
    body: {
      status: 'under_review',
      publicMessage: 'CWC desk has taken this grievance for review.',
      note: 'Internal smoke grievance note should not be exported through audit metadata.',
    },
  });
  assert(updatedGrievance.grievance.status === 'under_review', 'CWC should update grievance status');
  assert(updatedGrievance.grievance.publicMessage.includes('CWC desk'), 'updated grievance response should show public message');
  const updatedAdoptionGrievance = await request('POST', `/grievances/${adoptionGrievance.grievance.id}/status`, {
    token: sara.token,
    body: {
      status: 'referred',
      publicMessage: 'SARA desk has referred this adoption grievance to the SAA desk.',
      note: 'Internal CARINGS grievance note should not be exported through audit metadata.',
    },
  });
  assert(updatedAdoptionGrievance.grievance.status === 'referred', 'SARA should update adoption grievance status');
  assert(updatedAdoptionGrievance.grievance.publicMessage.includes('SARA desk'), 'SARA adoption grievance update should show public message');
  await expectStatus(403, () => request('POST', '/reports', {
    token: cwc.token,
    form: new FormData(),
  }), 'CWC report creation');

  const dupForm = new FormData();
  dupForm.set('childName', 'suresh');
  addDeclaration(dupForm);
  dupForm.set('gender', 'Male');
  dupForm.set('age', '4');
  dupForm.set('parentPhone', '9788197570');
  dupForm.set('state', 'Tamil Nadu');
  dupForm.set('district', 'Perambalur');
  try {
    await request('POST', '/reports', { token: parent.token, form: dupForm });
    throw new Error('parent duplicate report unexpectedly succeeded');
  } catch (err) {
    assert(err.status === 409, `parent duplicate report expected 409, got ${err.status || err.message}`);
    const duplicate = err.data?.duplicateCandidates?.[0];
    assert(duplicate, 'duplicate warning should include a candidate');
    assert(!('parentPhone' in duplicate), 'public duplicate warning should not expose parentPhone');
    assert(!('parentName' in duplicate), 'public duplicate warning should not expose parentName');
  }

  await expectStatus(400, () => request('POST', '/reports/found', { form: new FormData() }), 'empty text sighting');

  const badSightingPhone = new FormData();
  badSightingPhone.set('foundLocation', 'Near CST station, Mumbai');
  badSightingPhone.set('note', 'Lost child near station');
  badSightingPhone.set('reporterPhone', '123');
  await expectStatus(400, () => request('POST', '/reports/found', { form: badSightingPhone }), 'invalid reporter phone');

  const badSightingGeo = new FormData();
  badSightingGeo.set('foundLocation', 'Near CST station, Mumbai');
  badSightingGeo.set('note', 'Lost child near station');
  badSightingGeo.set('lat', '120');
  await expectStatus(400, () => request('POST', '/reports/found', { form: badSightingGeo }), 'invalid sighting latitude');

  await expectStatus(400, () => {
    const badProof = new FormData();
    badProof.set('foundLocation', 'Near CST station, Mumbai');
    badProof.set('note', 'Invalid proof type should be rejected');
    badProof.set('reporterPhone', '9000000998');
    badProof.set('idProofType', 'ration_card');
    return request('POST', '/reports/found', { form: badProof });
  }, 'invalid sighting id proof type');

  const sightingForm = new FormData();
  sightingForm.set('foundLocation', 'Outside CST station, Mumbai');
  sightingForm.set('state', 'Maharashtra');
  sightingForm.set('district', 'Mumbai');
  sightingForm.set('note', 'Child appears lost, blue shirt, about 8 years');
  sightingForm.set('ageApprox', '8');
  sightingForm.set('gender', 'Male');
  sightingForm.set('reporterPhone', '9000000001');
  const textSighting = await request('POST', '/reports/found', { form: sightingForm });
  // A public reporter is told nothing about the match outcome: the same neutral
  // receipt whatever the engines found. The real outcome is on the record.
  assert(textSighting.foundReport.status === 'received', 'public sighting receipt should carry a neutral status');
  assert(!('matchScore' in textSighting.foundReport), 'public sighting receipt should not expose a match score');
  assert(textSighting.candidates.length === 0, 'public sighting receipt should not return candidates');
  assert(textSighting.review === NEUTRAL_SIGHTING_RECEIPT, 'public sighting receipt should use the neutral review text');
  assert(textSighting.foundReport.personCategory === 'child', 'a sighting without personCategory should default to child');
  {
    const stored = (await request('GET', '/reports/found/all', { token: cwc.token })).foundReports.find((row) => row.id === textSighting.foundReport.id);
    assert(stored?.status === 'no_match', 'text sighting should be stored as no_match');
    assert(stored?.matchScore === 0, 'text sighting should not score a match');
    assert(stored?.personCategory === 'child', 'stored sighting should default to child');
    assert(stored?.referredTo1098 === true, 'a child sighting should still be referred to 1098');
  }
  const sightingStatus = await request('GET', `/reports/found/status/${textSighting.foundReport.id}`);
  assert(sightingStatus.status.id === textSighting.foundReport.id, 'public sighting status should resolve by receipt id');
  assert(sightingStatus.status.stage === 'received', 'a new sighting status should be at the received stage');
  assert(
    Object.keys(sightingStatus.status).sort().join() === 'foundLocation,id,message,nextStep,stage,submittedAt',
    `public sighting status should carry only the neutral fields, got ${Object.keys(sightingStatus.status).sort().join()}`
  );
  assert(sightingStatus.status.foundLocation === 'Outside CST station, Mumbai', 'public sighting status should echo the place the reporter typed');
  assert(!('matchedReportId' in sightingStatus.status), 'public sighting status should not expose matched report id');
  assert(!('reporterPhone' in sightingStatus.status), 'public sighting status should not expose reporter phone');
  assert(!('photoUrl' in sightingStatus.status), 'public sighting status should not expose photo URL');
  await request('GET', `/reports/found/status/${textSighting.foundReport.id}`);
  await expectStatus(429, () => request('GET', `/reports/found/status/${textSighting.foundReport.id}`), 'public sighting status rate limit');
  await expectStatus(404, () => request('GET', '/reports/found/status/f_missing_receipt'), 'missing public sighting receipt');
  const cwcSightingsAfterMumbaiText = await request('GET', '/reports/found/all', { token: cwc.token });
  assert(
    cwcSightingsAfterMumbaiText.foundReports.some((row) => row.id === textSighting.foundReport.id),
    'Mumbai CWC should see Mumbai text sighting'
  );
  await expectStatus(403, () => request('POST', `/reports/found/${textSighting.foundReport.id}/cwc-followup`, {
    token: parent.token,
    body: { outcome: 'child_located_safe', note: 'Parent cannot close welfare follow-up' },
  }), 'parent CWC follow-up');
  const cwcFollowup = await request('POST', `/reports/found/${textSighting.foundReport.id}/cwc-followup`, {
    token: cwc.token,
    body: { outcome: 'shelter_intake_required', note: 'CWC smoke follow-up recorded for shelter intake' },
  });
  assert(cwcFollowup.foundReport.status === 'cwc_followup_complete', 'CWC follow-up should complete sighting workflow');
  assert(cwcFollowup.foundReport.cwcFollowup?.outcome === 'shelter_intake_required', 'CWC follow-up outcome should be recorded');
  assert(!('cwcFollowup' in sightingStatus.status), 'public status should not expose CWC note details');

  const confidentialForm = new FormData();
  confidentialForm.set('foundLocation', 'Near Byculla station, Mumbai');
  confidentialForm.set('state', 'Maharashtra');
  confidentialForm.set('district', 'Mumbai');
  confidentialForm.set('note', 'Confidential citizen saw a child waiting near station exit');
  confidentialForm.set('reporterName', 'Confidential Smoke Reporter');
  confidentialForm.set('reporterPhone', '9000000003');
  confidentialForm.set('confidentialReporter', 'true');
  confidentialForm.set('idProofType', 'aadhaar');
  confidentialForm.set('idProofNumber', '123456789012');
  const confidentialSighting = await request('POST', '/reports/found', { form: confidentialForm });
  assert(confidentialSighting.foundReport.status === 'received', 'confidential text sighting receipt should be neutral');
  assert(!('reporterPhone' in confidentialSighting.foundReport), 'public confidential sighting response should not expose reporter phone');
  const confidentialStatus = await request('GET', `/reports/found/status/${confidentialSighting.foundReport.id}`);
  assert(!('reporterPhone' in confidentialStatus.status), 'public confidential status should not expose reporter phone');
  const cwcConfidentialSightings = await request('GET', '/reports/found/all', { token: cwc.token });
  const confidentialRow = cwcConfidentialSightings.foundReports.find((row) => row.id === confidentialSighting.foundReport.id);
  assert(confidentialRow, 'CWC should see scoped confidential sighting');
  assert(confidentialRow.status === 'no_match', 'confidential text sighting should be queued');
  assert(confidentialRow.reporterName === 'Confidential citizen', 'confidential reporter name should be masked for reviewers');
  assert(confidentialRow.reporterPhone === null, 'confidential reporter phone should be hidden for reviewers');
  assert(confidentialRow.idProofType === 'aadhaar', 'confidential sighting should store proof type');
  assert(confidentialRow.idProofNumberMasked === '********9012', 'confidential sighting should store masked proof number only');
  assert(confidentialRow.idProofVerified === true, 'confidential sighting should mark proof metadata captured');
  await expectStatus(403, () => request('POST', `/reports/found/${confidentialSighting.foundReport.id}/formal-intake`, {
    token: parent.token,
    body: {
      childName: 'Parent cannot formalize found child',
      intakeAuthority: 'Parent',
      note: 'Parent cannot open formal found-child intake',
    },
  }), 'parent found-child formal intake');
  const foundChildIntake = await request('POST', `/reports/found/${confidentialSighting.foundReport.id}/formal-intake`, {
    token: cwc.token,
    body: {
      childName: 'Unknown child CST intake',
      guardianName: 'Unknown guardian',
      intakeAuthority: 'Smoke Found Child Intake Home',
      admissionDate: '2026-01-12',
      nextReviewDate: futureDate(30),
      ageApprox: '8',
      gender: 'Male',
      note: 'Formal found child intake smoke note should not be written to audit payloads.',
    },
  });
  assert(foundChildIntake.foundReport.status === 'formalized_case', 'formal intake should mark sighting as formalized');
  assert(foundChildIntake.foundReport.formalReportId === foundChildIntake.report.id, 'formalized sighting should link formal report id');
  assert(foundChildIntake.report.caseOrigin === 'found_child_intake', 'formal report should record found-child case origin');
  assert(foundChildIntake.report.intakeSource === 'found_child_sighting', 'formal report should record found sighting intake source');
  assert(foundChildIntake.report.sourceFoundReportId === confidentialSighting.foundReport.id, 'formal report should link source found report');
  assert(foundChildIntake.report.status === 'under_review', 'formal found-child case should start under review');
  assert(foundChildIntake.report.parentPhone === null, 'formal found-child case should not invent guardian phone');
  assert(foundChildIntake.report.cciCareRecords?.some((row) => row.cciName === 'Smoke Found Child Intake Home'), 'formal found-child intake should create a CCI care record');
  assert(foundChildIntake.report.lastWorkflowAction === 'found_child_intake_created', 'formal found-child intake should update workflow');
  const formalizedSightingStatus = await request('GET', `/reports/found/status/${confidentialSighting.foundReport.id}`);
  // The stage depends only on time since the report was sent: what officers do
  // with a sighting is not the reporter's to read (publicSightingStatus).
  assert(formalizedSightingStatus.status.stage === 'received', 'a formal intake must not move the public sighting stage');
  assert(!('formalReportId' in formalizedSightingStatus.status), 'public sighting status should not expose formal report id');
  const goaForm = new FormData();
  goaForm.set('foundLocation', 'Margao bus stand, Goa');
  goaForm.set('state', 'Goa');
  goaForm.set('district', 'South Goa');
  goaForm.set('note', 'Child appears lost near bus stand');
  goaForm.set('reporterPhone', '9000000002');
  const goaSighting = await request('POST', '/reports/found', { form: goaForm });
  const cwcSightingsAfterGoaText = await request('GET', '/reports/found/all', { token: cwc.token });
  assert(
    !cwcSightingsAfterGoaText.foundReports.some((row) => row.id === goaSighting.foundReport.id),
    'Mumbai CWC should not see Goa unmatched text sighting'
  );
  const cwcActivity = await request('GET', '/dashboard/activity', { token: cwc.token });
  assert(
    cwcActivity.activity.some((row) => row.target === 'Outside CST station, Mumbai'),
    'Mumbai CWC should see Mumbai sighting activity'
  );
  assert(
    !cwcActivity.activity.some((row) => row.target === 'Margao bus stand, Goa'),
    'Mumbai CWC should not see Goa sighting activity'
  );

  for (let i = 0; i < 2; i++) {
    const floodForm = new FormData();
    floodForm.set('foundLocation', `Rate limit smoke location ${i}`);
    floodForm.set('state', 'Maharashtra');
    floodForm.set('district', 'Mumbai');
    floodForm.set('note', 'Repeated public sighting test');
    floodForm.set('reporterPhone', '9000000999');
    await request('POST', '/reports/found', { form: floodForm });
  }
  const blockedFlood = new FormData();
  blockedFlood.set('foundLocation', 'Rate limit smoke location blocked');
  blockedFlood.set('state', 'Maharashtra');
  blockedFlood.set('district', 'Mumbai');
  blockedFlood.set('note', 'Repeated public sighting test');
  blockedFlood.set('reporterPhone', '9000000999');
  await expectStatus(429, () => request('POST', '/reports/found', { form: blockedFlood }), 'public sighting rate limit');
  const publicAbuse = await request('GET', '/dashboard/fraud', { token: superAdmin.token });
  assert(publicAbuse.totals.rateLimited >= 4, 'public abuse queue should include rate-limit signals');
  assert(publicAbuse.totals.otpFailures >= 1, 'public abuse queue should include OTP failure signals');
  assert(
    publicAbuse.signals.some((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_found_report'),
    'public abuse queue should include found-report limiter signal'
  );
  assert(
    publicAbuse.signals.some((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_case_status'),
    'public abuse queue should include case-status limiter signal'
  );
  assert(
    publicAbuse.signals.some((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_sighting_status'),
    'public abuse queue should include sighting-status limiter signal'
  );
  assert(
    publicAbuse.signals.some((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_grievance_status'),
    'public abuse queue should include grievance-status limiter signal'
  );
  assert(
    publicAbuse.signals.every((row) => !row.signal?.identityHash || /^[a-f0-9]{16}$/.test(row.signal.identityHash)),
    'public abuse queue should expose only truncated hashed identities'
  );
  const abuseSignal = publicAbuse.signals.find((row) => row.action === 'security.public_rate_limited' && row.signal?.limiter === 'public_found_report');
  assert(abuseSignal?.disposition?.status === 'open', 'new public abuse signal should start open');
  assert(abuseSignal.sla?.hours === 24, 'medium public abuse signal should have 24h SLA');
  assert(['open', 'due_soon', 'breached'].includes(abuseSignal.sla?.state), 'open public abuse signal should expose active SLA state');
  const privilegedAbuse = publicAbuse.signals.find((row) => row.action === 'auth.privileged_registration_blocked');
  assert(privilegedAbuse?.severity === 'high', 'privileged signup abuse should be high severity');
  assert(privilegedAbuse?.sla?.hours === 4, 'high public abuse signal should have 4h SLA');
  const abuseDisposition = await request('POST', `/dashboard/fraud/${abuseSignal.id}/disposition`, {
    token: superAdmin.token,
    body: {
      disposition: 'escalated',
      note: 'Public abuse escalation smoke note should stay out of audit payloads.',
    },
  });
  assert(abuseDisposition.disposition.status === 'escalated', 'public abuse disposition should be saved');
  const publicAbuseAfterDisposition = await request('GET', '/dashboard/fraud', { token: superAdmin.token });
  const dispositionRow = publicAbuseAfterDisposition.signals.find((row) => row.id === abuseSignal.id);
  assert(dispositionRow?.disposition?.status === 'escalated', 'public abuse queue should show latest disposition');
  assert(dispositionRow?.sla?.state === 'closed', 'disposed public abuse signal should close SLA');
  assert(publicAbuseAfterDisposition.totals.escalated >= 1, 'public abuse totals should count escalated signals');
  assert(typeof publicAbuseAfterDisposition.totals.slaBreached === 'number', 'public abuse totals should include breached SLA count');
  const abuseActivity = await request('GET', '/dashboard/activity', { token: superAdmin.token });
  const escalatedAbuseActivity = abuseActivity.activity.find((row) => row.action === 'Escalated public abuse signal');
  assert(escalatedAbuseActivity, 'escalated public abuse signal should appear in command activity feed');
  assert(escalatedAbuseActivity.target === 'public_found_report', 'abuse activity target should be limiter name only');
  assert(!JSON.stringify(escalatedAbuseActivity).includes('9000000999'), 'abuse activity should not expose raw reporter phone');
  assert(!JSON.stringify(escalatedAbuseActivity).includes('Public abuse escalation smoke note'), 'abuse activity should not expose disposition note');
  await expectStatus(400, () => request('POST', `/dashboard/fraud/${abuseSignal.id}/disposition`, {
    token: superAdmin.token,
    body: { disposition: 'unknown' },
  }), 'invalid public abuse disposition');
  await expectStatus(403, () => request('POST', `/dashboard/fraud/${abuseSignal.id}/disposition`, {
    token: parent.token,
    body: { disposition: 'reviewed' },
  }), 'parent public abuse disposition');
  assert(!JSON.stringify(publicAbuse).includes('9000000999'), 'public abuse queue should not expose raw reporter phone');
  assert(!JSON.stringify(publicAbuse).includes(verifiedPhotoReport.report.firNo), 'public abuse queue should not expose raw FIR/GD reference');
  assert(!JSON.stringify(publicAbuse).includes(textSighting.foundReport.id), 'public abuse queue should not expose raw sighting receipt id');
  assert(!JSON.stringify(publicAbuse).includes(grievance.grievance.id), 'public abuse queue should not expose raw grievance receipt id');
  assert(!JSON.stringify(publicAbuseAfterDisposition).includes('Public abuse escalation smoke note'), 'public abuse queue should not expose disposition note text');
  const abuseExport = await request('GET', '/dashboard/fraud/export', { token: superAdmin.token });
  assert(abuseExport.signature?.type === 'public_abuse_export', 'public abuse export should include signature type');
  assert(abuseExport.signature?.algorithm === 'sha256-hmac', 'public abuse export should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(abuseExport.signature?.digest || ''), 'public abuse export should include SHA-256 digest');
  assert(abuseExport.signals.some((row) => row.id === abuseSignal.id && row.disposition?.status === 'escalated'), 'public abuse export should include disposition state');
  assert(abuseExport.signals.every((row) => !row.source?.identityHash || /^[a-f0-9]{16}$/.test(row.source.identityHash)), 'public abuse export should include only truncated identity hashes');
  assert(!JSON.stringify(abuseExport).includes('9000000999'), 'public abuse export should not expose raw reporter phone');
  assert(!JSON.stringify(abuseExport).includes(verifiedPhotoReport.report.firNo), 'public abuse export should not expose raw FIR/GD reference');
  assert(!JSON.stringify(abuseExport).includes(textSighting.foundReport.id), 'public abuse export should not expose raw sighting receipt id');
  assert(!JSON.stringify(abuseExport).includes(grievance.grievance.id), 'public abuse export should not expose raw grievance receipt id');
  assert(!JSON.stringify(abuseExport).includes('Public abuse escalation smoke note'), 'public abuse export should not expose disposition note text');
  const abuseVerify = await request('POST', '/dashboard/export/verify', {
    token: superAdmin.token,
    body: abuseExport,
  });
  assert(abuseVerify.ok === true, 'public abuse export signature should verify');
  assert(abuseVerify.type === 'public_abuse_export', 'public abuse export verification should return type');
  const tamperedAbuseExport = { ...abuseExport, totals: { ...abuseExport.totals, signals: abuseExport.totals.signals + 1 } };
  const tamperedAbuseVerify = await request('POST', '/dashboard/export/verify', {
    token: superAdmin.token,
    body: tamperedAbuseExport,
  });
  assert(tamperedAbuseVerify.ok === false, 'tampered public abuse export signature should fail verification');
  await expectStatus(403, () => request('GET', '/dashboard/fraud/export', { token: parent.token }), 'parent public abuse export');
  await expectStatus(403, () => request('GET', '/dashboard/fraud', { token: parent.token }), 'parent public abuse queue');

  const reports = await request('GET', '/reports', { token: cwc.token });
  const openReport = reports.reports.find((r) => r.status !== 'found');
  assert(openReport, 'Expected at least one open CWC report');
  const assignableUsers = await request('GET', `/reports/${openReport.id}/assignable-users`, { token: cwc.token });
  assert(assignableUsers.users.some((row) => row.id === 'u_cwc'), 'assignable users should include scoped CWC desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_sjpu'), 'assignable users should include scoped SJPU desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_ahtu'), 'assignable users should include scoped AHTU desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_dcrb'), 'assignable users should include scoped DCRB desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_dlsa'), 'assignable users should include scoped DLSA desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_saa'), 'assignable users should include scoped SAA desk');
  assert(assignableUsers.users.some((row) => row.id === 'u_sara'), 'assignable users should include state SARA desk');
  assert(!assignableUsers.users.some((row) => row.role === 'parent' || row.role === 'ngo'), 'assignable users should exclude public roles');
  await expectStatus(403, () => request('GET', `/reports/${openReport.id}/assignable-users`, {
    token: parent.token,
  }), 'parent assignable users');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/assign-owner`, {
    token: parent.token,
    body: {
      assigneeId: 'u_cwc',
      assignmentType: 'welfare',
      note: 'Parent cannot assign case owner',
    },
  }), 'parent case owner assignment');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/assign-owner`, {
    token: cwc.token,
    body: {
      assigneeId: 'u_parent',
      assignmentType: 'welfare',
      note: 'Public account cannot own operational case work',
    },
  }), 'public role case owner assignment');
  const assignment = await request('POST', `/reports/${openReport.id}/assign-owner`, {
    token: cwc.token,
    body: {
      assigneeId: 'u_cwc',
      assignmentType: 'welfare',
      dueDate: futureDate(30),
      note: 'Assignment smoke note should not be written to audit payloads.',
    },
  });
  assert(assignment.report.assignedToId === 'u_cwc', 'case owner assignment should set current assignee');
  assert(assignment.report.assignmentStatus === 'assigned', 'case owner assignment should set assignment status');
  assert(assignment.report.assignments?.length > 0, 'case owner assignment should append assignment history');
  assert(assignment.report.lastWorkflowAction === 'assign_owner', 'case owner assignment should update workflow action');
  assert(assignment.assignment.note.includes('Assignment smoke note'), 'case assignment response should include assignment note for operational users');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/investigation-checklist`, {
    token: parent.token,
    body: {
      items: ['fir_registered'],
      officerName: 'Parent cannot record checklist',
    },
  }), 'parent investigation checklist');
  const investigationChecklist = await request('POST', `/reports/${openReport.id}/investigation-checklist`, {
    token: ahtu.token,
    body: {
      items: ['fir_registered', 'trackchild_updated', 'cctns_linked', 'ncrb_scrb_alerted', 'childline_1098_alerted'],
      officerName: 'Smoke AHTU Investigation Desk',
      stationDiaryNo: 'INV/SMOKE/2026/01',
      actionDate: '2026-06-04',
      followupDate: futureDate(30),
      note: 'Investigation checklist smoke note should not be written to audit payloads.',
    },
  });
  assert(investigationChecklist.report.investigationChecklist?.length > 0, 'investigation checklist should append a structured record');
  assert(investigationChecklist.checklistRecord.items.includes('trackchild_updated'), 'investigation checklist should preserve selected TrackChild action');
  assert(investigationChecklist.checklistRecord.note.includes('Investigation checklist smoke note'), 'investigation checklist response should include operational note');
  assert(investigationChecklist.report.lastWorkflowAction === 'investigation_checklist_updated', 'investigation checklist should update workflow action');
  const dcrbChecklist = await request('POST', `/reports/${openReport.id}/investigation-checklist`, {
    token: dcrb.token,
    body: {
      items: ['trackchild_updated', 'cctns_linked', 'ncrb_scrb_alerted'],
      officerName: 'Smoke DCRB Records Desk',
      stationDiaryNo: 'DCRB/SMOKE/2026/01',
      actionDate: '2026-06-04',
      note: 'DCRB records smoke note should not be written to audit payloads.',
    },
  });
  assert(dcrbChecklist.checklistRecord.items.includes('ncrb_scrb_alerted'), 'DCRB should record records-focused checklist items');
  const workflow = await request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'assign_cci' },
  });
  assert(workflow.report.lastWorkflowAction === 'assign_cci', 'workflow action was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/cci-care`, {
    token: parent.token,
    body: {
      admissionType: 'temporary_shelter',
      cciName: 'Smoke CCI Home',
      admissionDate: '2026-01-10',
      carePlan: 'CCI smoke care plan should not be visible to parent role',
    },
  }), 'parent CCI care record');
  const cciCare = await request('POST', `/reports/${openReport.id}/cci-care`, {
    token: cwc.token,
    body: {
      admissionType: 'temporary_shelter',
      cciName: 'Smoke CCI Home',
      admissionDate: '2026-01-10',
      nextReviewDate: futureDate(30),
      services: ['education', 'health_care', 'counselling', 'family_tracing'],
      progressStatus: 'active',
      healthStatus: 'Smoke CCI health care progress note should not be written to audit payloads.',
      educationStatus: 'Smoke CCI education progress note should not be written to audit payloads.',
      counsellingStatus: 'Smoke CCI counselling progress note should not be written to audit payloads.',
      familyTracingStatus: 'Smoke CCI family tracing progress note should not be written to audit payloads.',
      carePlan: 'CCI smoke care plan: temporary shelter, counselling review, and guardian tracing.',
    },
  });
  assert(cciCare.report.cciCareRecords?.length > 0, 'CCI care record should be appended to report');
  assert(cciCare.report.lastCciCareAt, 'CCI care record should update lastCciCareAt');
  assert(cciCare.report.lastWorkflowAction === 'cci_care_recorded', 'CCI care should update workflow action');
  assert(cciCare.report.workflowStatus?.includes('CCI care recorded'), 'CCI care should update workflow status');
  assert(cciCare.careRecord.services.includes('education'), 'CCI care should preserve structured services');
  assert(cciCare.careRecord.progressStatus === 'active', 'CCI care should preserve progress status');
  assert(cciCare.careRecord.serviceProgress?.healthStatus?.includes('health care progress'), 'CCI care should preserve service progress');
  const cciRegister = await request('GET', '/dashboard/cci-register', { token: cwc.token });
  assert(cciRegister.scope === 'Mumbai', `CCI register scope should be Mumbai, got ${cciRegister.scope}`);
  assert(cciRegister.totals.records >= 1, 'CCI register should count care records');
  assert(cciRegister.totals.institutions >= 1, 'CCI register should count institutions');
  assert(cciRegister.register.some((row) => row.reportId === openReport.id && row.cciName === 'Smoke CCI Home'), 'CCI register should include scoped care record');
  assert(cciRegister.register.some((row) => row.reportId === foundChildIntake.report.id && row.cciName === 'Smoke Found Child Intake Home'), 'CCI register should include formalized found-child intake');
  assert(!cciRegister.register.some((row) => row.state === 'Goa'), 'CCI register should exclude Goa records from Mumbai CWC scope');
  assert(cciRegister.byAdmissionType.some((row) => row.name === 'Temporary shelter'), 'CCI register should include admission type split');
  await expectStatus(403, () => request('GET', '/dashboard/cci-register', { token: parent.token }), 'parent CCI register');
  await expectStatus(403, () => request('GET', '/dashboard/cci-register', { token: crimeBureau.token }), 'crime bureau CCI register');
  const jjbWorkflow = await request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'refer_jjb' },
  });
  assert(jjbWorkflow.report.lastWorkflowAction === 'refer_jjb', 'JJB referral workflow action was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/jjb-proceeding`, {
    token: parent.token,
    body: {
      proceedingType: 'preliminary_hearing',
      boardName: 'Smoke JJB Board',
      orderDate: '2026-01-11',
      directions: 'JJB smoke directions should not be visible to parent role',
    },
  }), 'parent JJB proceeding record');
  const jjbProceeding = await request('POST', `/reports/${openReport.id}/jjb-proceeding`, {
    token: jjb.token,
    body: {
      proceedingType: 'social_investigation_order',
      boardName: 'Smoke JJB Board',
      caseNo: 'JJB/SMOKE/2026/01',
      orderDate: '2026-01-11',
      nextHearingDate: futureDate(30),
      directions: 'JJB smoke directions: social investigation, rehabilitation review, and guardian tracing.',
    },
  });
  assert(jjbProceeding.report.jjbProceedings?.length > 0, 'JJB proceeding should be appended to report');
  assert(jjbProceeding.report.lastJjbProceedingAt, 'JJB proceeding should update lastJjbProceedingAt');
  assert(jjbProceeding.report.lastWorkflowAction === 'jjb_proceeding_recorded', 'JJB proceeding should update workflow action');
  assert(jjbProceeding.report.workflowStatus?.includes('JJB proceeding recorded'), 'JJB proceeding should update workflow status');
  const stateWorkflow = await request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'escalate_state' },
  });
  assert(stateWorkflow.report.lastWorkflowAction === 'escalate_state', 'state escalation workflow action was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/state-escalation`, {
    token: parent.token,
    body: {
      escalationType: 'inter_district_coordination',
      escalationLevel: 'state_task_force',
      authorityName: 'Smoke State Nodal Desk',
      escalatedDate: '2026-01-12',
      actionRequired: 'State smoke action should not be visible to parent role',
    },
  }), 'parent state escalation record');
  const stateEscalation = await request('POST', `/reports/${openReport.id}/state-escalation`, {
    token: superAdmin.token,
    body: {
      escalationType: 'interstate_coordination',
      escalationLevel: 'national_command',
      priority: 'urgent',
      authorityName: 'Smoke National Command Desk',
      referenceNo: 'STATE/SMOKE/2026/01',
      escalatedDate: '2026-01-12',
      dueDate: futureDate(30),
      actionRequired: 'State smoke action: coordinate interstate rescue, district resource support, and nodal review.',
    },
  });
  assert(stateEscalation.report.stateEscalations?.length > 0, 'state escalation should be appended to report');
  assert(stateEscalation.report.lastStateEscalationAt, 'state escalation should update lastStateEscalationAt');
  assert(stateEscalation.report.lastWorkflowAction === 'state_escalation_recorded', 'state escalation should update workflow action');
  assert(stateEscalation.report.workflowStatus?.includes('State escalation recorded'), 'state escalation should update workflow status');
  const bureauWorkflow = await request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'notify_crime_bureau' },
  });
  assert(bureauWorkflow.report.lastWorkflowAction === 'notify_crime_bureau', 'crime bureau notification workflow action was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/bureau-report`, {
    token: parent.token,
    body: {
      reportType: 'ncrb_missing_child_update',
      bureauLevel: 'ncrb',
      submittedDate: '2026-01-12',
      summary: 'Bureau smoke report should not be visible to parent role',
    },
  }), 'parent bureau report record');
  const bureauReport = await request('POST', `/reports/${openReport.id}/bureau-report`, {
    token: crimeBureau.token,
    body: {
      reportType: 'interstate_alert',
      bureauLevel: 'scrb',
      priority: 'priority',
      referenceNo: 'SCRB/SMOKE/2026/01',
      submittedDate: '2026-01-12',
      nextReviewDate: futureDate(30),
      summary: 'Bureau smoke report: interstate alert, pattern review, and district coordination.',
    },
  });
  assert(bureauReport.report.bureauReports?.length > 0, 'bureau report should be appended to report');
  assert(bureauReport.report.lastBureauReportAt, 'bureau report should update lastBureauReportAt');
  assert(bureauReport.report.lastWorkflowAction === 'bureau_report_recorded', 'bureau report should update workflow action');
  assert(bureauReport.report.workflowStatus?.includes('report recorded'), 'bureau report should update workflow status');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/external-id`, {
    token: parent.token,
    body: {
      idType: 'trackchild',
      externalId: 'TC-SMOKE-2026-01',
      issuingSystem: 'Mission Vatsalya TrackChild',
      remarks: 'Parent cannot link external IDs',
    },
  }), 'parent external id link');
  const externalId = await request('POST', `/reports/${openReport.id}/external-id`, {
    token: crimeBureau.token,
    body: {
      idType: 'trackchild',
      externalId: 'TC-SMOKE-2026-01',
      issuingSystem: 'Mission Vatsalya TrackChild',
      issuedDate: '2026-01-13',
      remarks: 'External ID smoke linking remarks should not be written to audit metadata.',
    },
  });
  assert(externalId.report.externalIds?.some((row) => row.externalId === 'TC-SMOKE-2026-01'), 'external id should be linked to report');
  assert(externalId.report.lastExternalIdAt, 'external id should update lastExternalIdAt');
  assert(externalId.report.lastWorkflowAction === 'external_id_linked', 'external id should update workflow action');
  assert(externalId.report.workflowStatus?.includes('External ID linked'), 'external id should update workflow status');
  // External ids are printed on other systems' paperwork; they no longer
  // resolve on the public lookup (only the Khozo case id does).
  await expectStatus(404, () => request('GET', '/reports/public/status/TC-SMOKE-2026-01'), 'public case status by external TrackChild ID');
  await expectStatus(403, () => request('GET', `/reports/${openReport.id}/handoff-export?targetSystem=trackchild`, {
    token: parent.token,
  }), 'parent case handoff export');
  const handoffExport = await request('GET', `/reports/${openReport.id}/handoff-export?targetSystem=trackchild&includeHistory=true`, {
    token: crimeBureau.token,
  });
  assert(handoffExport.exportType === 'case_handoff', 'case handoff export should declare export type');
  assert(handoffExport.schemaVersion === 'khozo.case_handoff.v1', 'case handoff export should declare schema version');
  assert(handoffExport.targetSystem === 'trackchild', 'case handoff export should preserve target system');
  assert(handoffExport.case.id === openReport.id, 'case handoff export should include case id');
  assert(handoffExport.case.externalIds.some((row) => row.externalId === 'TC-SMOKE-2026-01'), 'case handoff export should include external IDs');
  assert(handoffExport.profile.vulnerabilityCaptured === true, 'case handoff export should include safe vulnerability flags');
  assert(handoffExport.workflow.length > 0, 'case handoff export should include redacted workflow history when requested');
  assert(handoffExport.signature?.type === 'case_handoff_export', 'case handoff export should include signature type');
  assert(handoffExport.signature?.algorithm === 'sha256-hmac', 'case handoff export should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(handoffExport.signature?.digest || ''), 'case handoff export should include SHA-256 digest');
  assert(/^[a-f0-9]{64}$/.test(handoffExport.signature?.value || ''), 'case handoff export should include HMAC signature');
  assert(!JSON.stringify(handoffExport).includes('External ID smoke linking remarks'), 'case handoff export should not expose external ID remarks');
  assert(!JSON.stringify(handoffExport).includes(openReport.parentPhone || '9788197570'), 'case handoff export should not expose guardian phone');
  const handoffVerify = await request('POST', '/dashboard/export/verify', {
    token: crimeBureau.token,
    body: handoffExport,
  });
  assert(handoffVerify.ok === true, 'case handoff export signature should verify');
  assert(handoffVerify.type === 'case_handoff_export', 'case handoff export verification should return type');
  const tamperedHandoffVerify = await request('POST', '/dashboard/export/verify', {
    token: crimeBureau.token,
    body: { ...handoffExport, targetSystem: 'ghar' },
  });
  assert(tamperedHandoffVerify.ok === false, 'tampered case handoff signature should fail verification');
  await expectStatus(409, () => request('POST', `/reports/${openReport.id}/external-id`, {
    token: crimeBureau.token,
    body: {
      idType: 'trackchild',
      externalId: 'TC-SMOKE-2026-01',
      issuingSystem: 'Mission Vatsalya TrackChild',
    },
  }), 'duplicate external id link');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/external-id`, {
    token: crimeBureau.token,
    body: {
      idType: 'unknown_system',
      externalId: 'BAD-SMOKE',
    },
  }), 'invalid external id type');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/restoration-plan`, {
    token: parent.token,
    body: {
      restorationType: 'family_restoration',
      status: 'planned',
      toState: 'Maharashtra',
      toDistrict: 'Mumbai',
      handoverAuthority: 'Smoke CWC Desk',
      remarks: 'Parent cannot record GHAR restoration route',
    },
  }), 'parent restoration plan record');
  const restorationPlan = await request('POST', `/reports/${openReport.id}/restoration-plan`, {
    token: cwc.token,
    body: {
      restorationType: 'interstate_transfer',
      status: 'documents_pending',
      fromState: 'Maharashtra',
      fromDistrict: 'Mumbai',
      toState: 'Karnataka',
      toDistrict: 'Bengaluru Urban',
      guardianName: 'Smoke Guardian',
      handoverAuthority: 'Smoke CWC Bengaluru',
      plannedDate: futureDate(30),
      followupDate: futureDate(30),
      travelMode: 'rail',
      travelDate: futureDate(30),
      escortAuthority: 'Smoke DCPU Escort Desk',
      escortContact: '9000000456',
      documentStatus: 'verified',
      documentReference: 'RESTORE/DOC/SMOKE/2026/01',
      fundingSource: 'dcpu',
      fundingReference: 'FUND/SMOKE/2026/01',
      supports: ['interpreter', 'escort', 'documents'],
      remarks: 'GHAR smoke restoration route should not be written to audit payloads.',
    },
  });
  assert(restorationPlan.report.restorationPlans?.length > 0, 'restoration plan should be appended to report');
  assert(restorationPlan.report.lastRestorationPlanAt, 'restoration plan should update lastRestorationPlanAt');
  assert(restorationPlan.report.lastWorkflowAction === 'restoration_plan_recorded', 'restoration plan should update workflow action');
  assert(restorationPlan.report.workflowStatus?.includes('Restoration plan recorded'), 'restoration plan should update workflow status');
  assert(restorationPlan.restorationPlan.supports.includes('interpreter'), 'restoration plan should preserve selected support needs');
  assert(restorationPlan.restorationPlan.travel?.mode === 'rail', 'restoration plan should preserve travel mode');
  assert(restorationPlan.restorationPlan.travel?.escortAuthority === 'Smoke DCPU Escort Desk', 'restoration plan should preserve escort authority');
  assert(restorationPlan.restorationPlan.documents?.status === 'verified', 'restoration plan should preserve document status');
  assert(restorationPlan.restorationPlan.funding?.source === 'dcpu', 'restoration plan should preserve funding source');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/welfare-referral`, {
    token: parent.token,
    body: {
      scheme: 'sponsorship',
      status: 'referred',
      agencyName: 'Smoke DCPU Desk',
      referredDate: '2026-01-21',
      eligibilityNote: 'Parent cannot record welfare referral',
    },
  }), 'parent welfare referral record');
  const welfareReferral = await request('POST', `/reports/${openReport.id}/welfare-referral`, {
    token: cwc.token,
    body: {
      scheme: 'sponsorship',
      status: 'eligibility_review',
      agencyName: 'Smoke DCPU Sponsorship Desk',
      referralNo: 'WELFARE/SMOKE/2026/01',
      referredDate: '2026-01-21',
      reviewDate: futureDate(30),
      eligibilityNote: 'Welfare smoke eligibility note should not be written to audit payloads.',
    },
  });
  assert(welfareReferral.report.welfareReferrals?.length > 0, 'welfare referral should be appended to report');
  assert(welfareReferral.report.lastWelfareReferralAt, 'welfare referral should update lastWelfareReferralAt');
  assert(welfareReferral.report.lastWorkflowAction === 'welfare_referral_recorded', 'welfare referral should update workflow action');
  assert(welfareReferral.report.workflowStatus?.includes('Welfare referral recorded'), 'welfare referral should update workflow status');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/legal-aid-referral`, {
    token: parent.token,
    body: {
      serviceType: 'legal_aid',
      status: 'referred',
      authorityName: 'Smoke DLSA Desk',
      referredDate: '2026-01-21',
      note: 'Parent cannot record legal aid referral',
    },
  }), 'parent legal-aid referral record');
  const legalAidReferral = await request('POST', `/reports/${openReport.id}/legal-aid-referral`, {
    token: dlsa.token,
    body: {
      serviceType: 'victim_compensation',
      status: 'application_filed',
      authorityName: 'Smoke DLSA Compensation Desk',
      applicationNo: 'LEGAL/SMOKE/2026/01',
      referredDate: '2026-01-21',
      hearingDate: futureDate(30),
      reviewDate: futureDate(30),
      note: 'Legal aid smoke note should not be written to audit payloads.',
    },
  });
  assert(legalAidReferral.report.legalAidReferrals?.length > 0, 'legal-aid referral should be appended to report');
  assert(legalAidReferral.report.lastLegalAidReferralAt, 'legal-aid referral should update lastLegalAidReferralAt');
  assert(legalAidReferral.report.lastWorkflowAction === 'legal_aid_referral_recorded', 'legal-aid referral should update workflow action');
  assert(legalAidReferral.report.workflowStatus?.includes('Legal-aid referral recorded'), 'legal-aid referral should update workflow status');
  assert(legalAidReferral.legalAidReferral.applicationNo === 'LEGAL/SMOKE/2026/01', 'legal-aid referral should preserve application number in case record');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/adoption-record`, {
    token: parent.token,
    body: {
      recordType: 'carings_registration',
      status: 'initiated',
      agencyName: 'Smoke SAA Desk',
      orderDate: '2026-01-21',
      note: 'Parent cannot record adoption follow-up',
    },
  }), 'parent adoption record');
  const adoptionRecord = await request('POST', `/reports/${openReport.id}/adoption-record`, {
    token: saa.token,
    body: {
      recordType: 'carings_registration',
      status: 'carings_updated',
      agencyName: 'Smoke SAA Adoption Desk',
      caringsId: 'CARINGS/SMOKE/2026/01',
      orderNo: 'ADOPT/ORDER/SMOKE/2026/01',
      orderDate: '2026-01-21',
      nextReviewDate: futureDate(30),
      note: 'Adoption smoke note should not be written to audit payloads.',
    },
  });
  assert(adoptionRecord.report.adoptionRecords?.length > 0, 'adoption record should be appended to report');
  assert(adoptionRecord.report.lastAdoptionRecordAt, 'adoption record should update lastAdoptionRecordAt');
  assert(adoptionRecord.report.lastWorkflowAction === 'adoption_recorded', 'adoption record should update workflow action');
  assert(adoptionRecord.report.workflowStatus?.includes('Adoption follow-up recorded'), 'adoption record should update workflow status');
  assert(adoptionRecord.adoptionRecord.caringsId === 'CARINGS/SMOKE/2026/01', 'adoption record should preserve CARINGS reference in case record');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/case-assessment`, {
    token: parent.token,
    body: {
      assessmentType: 'social_investigation_report',
      riskLevel: 'medium',
      assessorName: 'Smoke Assessor',
      assessmentDate: '2026-01-22',
      findings: 'Parent cannot record social investigation findings',
      carePlan: 'Parent cannot record individual care plan',
    },
  }), 'parent case assessment record');
  const caseAssessment = await request('POST', `/reports/${openReport.id}/case-assessment`, {
    token: cwc.token,
    body: {
      assessmentType: 'social_investigation_report',
      riskLevel: 'high',
      assessorName: 'Smoke CWC Assessor',
      assessmentDate: '2026-01-22',
      nextReviewDate: futureDate(30),
      findings: 'SIR smoke findings should not be written to audit payloads.',
      carePlan: 'ICP smoke care plan should not be written to audit payloads.',
      recommendation: 'Smoke recommendation should stay in case record only.',
    },
  });
  assert(caseAssessment.report.caseAssessments?.length > 0, 'case assessment should be appended to report');
  assert(caseAssessment.report.lastCaseAssessmentAt, 'case assessment should update lastCaseAssessmentAt');
  assert(caseAssessment.report.lastWorkflowAction === 'case_assessment_recorded', 'case assessment should update workflow action');
  assert(caseAssessment.report.workflowStatus?.includes('Case assessment recorded'), 'case assessment should update workflow status');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/production-record`, {
    token: parent.token,
    body: {
      productionType: 'cwc',
      outcome: 'care_order_pending',
      authorityName: 'Smoke CWC Bench',
      rescueAt: '2026-01-22T08:00',
      producedAt: '2026-01-22T18:00',
      nextAction: 'Parent cannot record CWC production',
    },
  }), 'parent production record');
  const productionRecord = await request('POST', `/reports/${openReport.id}/production-record`, {
    token: cwc.token,
    body: {
      productionType: 'cwc',
      outcome: 'sent_cci',
      authorityName: 'Smoke CWC Bench',
      orderNo: 'CWC/PROD/SMOKE/2026/01',
      rescueAt: '2026-01-22T08:00',
      producedAt: '2026-01-22T18:00',
      nextAction: 'Production next action smoke text should not be written to audit payloads.',
    },
  });
  assert(productionRecord.report.productionRecords?.length > 0, 'production record should be appended to report');
  assert(productionRecord.report.lastProductionRecordAt, 'production record should update lastProductionRecordAt');
  assert(productionRecord.report.lastWorkflowAction === 'production_recorded', 'production record should update workflow action');
  assert(productionRecord.report.workflowStatus?.includes('Production recorded'), 'production record should update workflow status');
  assert(productionRecord.productionRecord.deadlineStatus === 'within_24h', 'production record should compute 24h deadline status');
  const delayedProductionRecord = await request('POST', `/reports/${openReport.id}/production-record`, {
    token: cwc.token,
    body: {
      productionType: 'cwc',
      outcome: 'care_order_pending',
      authorityName: 'Smoke CWC Bench',
      orderNo: 'CWC/PROD/SMOKE/2026/02',
      rescueAt: '2026-01-22T08:00',
      producedAt: '2026-01-23T15:00',
      nextAction: 'Production next action smoke text should not be written to audit payloads.',
    },
  });
  assert(delayedProductionRecord.productionRecord.deadlineStatus === 'delayed', 'production record should flag delayed 24h production');
  const formalFollowups = await request('GET', '/dashboard/followups', { token: cwc.token });
  assert(formalFollowups.totals.formalFollowups >= 6, 'formal record dates should contribute to dashboard follow-up totals');
  for (const type of [
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
  ]) {
    assert(formalFollowups.alerts.some((row) => row.type === type && row.reportId === openReport.id), `CWC follow-ups should include ${type}`);
  }
  assert(!formalFollowups.alerts.some((row) => row.state === 'Goa'), 'formal follow-up alerts should stay scoped away from Goa');
  const cwcMisAfterFormalRecords = await request('GET', '/dashboard/mis', { token: cwc.token });
  assert(cwcMisAfterFormalRecords.totals.formalFollowups >= 6, 'MIS should count formal follow-ups due');
  assert(cwcMisAfterFormalRecords.totals.productionRecords >= 2, 'MIS should count production records');
  assert(cwcMisAfterFormalRecords.totals.productionWithin24h >= 1, 'MIS should count within-24h production records');
  assert(cwcMisAfterFormalRecords.totals.productionDelayed >= 1, 'MIS should count delayed production records');
  assert(
    cwcMisAfterFormalRecords.compliance.formalFollowups.some((row) => row.name === 'production delayed'),
    'MIS should include production delayed in formal follow-up split'
  );
  assert(
    cwcMisAfterFormalRecords.compliance.production.some((row) => row.name === 'delayed' && row.count >= 1),
    'MIS should include delayed production compliance count'
  );
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/production-record`, {
    token: cwc.token,
    body: {
      productionType: 'bad_production',
      outcome: 'sent_cci',
      authorityName: 'Smoke CWC Bench',
      rescueAt: '2026-01-22T08:00',
      producedAt: '2026-01-22T18:00',
      nextAction: 'Invalid production type should be rejected',
    },
  }), 'invalid production type');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/case-assessment`, {
    token: cwc.token,
    body: {
      assessmentType: 'unknown_assessment',
      riskLevel: 'medium',
      assessorName: 'Smoke Assessor',
      assessmentDate: '2026-01-22',
      findings: 'Invalid assessment type should be rejected',
      carePlan: 'Invalid assessment type should be rejected',
    },
  }), 'invalid case assessment type');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/welfare-referral`, {
    token: cwc.token,
    body: {
      scheme: 'bad_scheme',
      status: 'referred',
      agencyName: 'Smoke DCPU Desk',
      referredDate: '2026-01-21',
      eligibilityNote: 'Invalid welfare scheme should be rejected',
    },
  }), 'invalid welfare scheme');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/legal-aid-referral`, {
    token: dlsa.token,
    body: {
      serviceType: 'bad_legal_service',
      status: 'referred',
      authorityName: 'Smoke DLSA Desk',
      referredDate: '2026-01-21',
      note: 'Invalid legal service should be rejected',
    },
  }), 'invalid legal-aid service');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/adoption-record`, {
    token: saa.token,
    body: {
      recordType: 'bad_adoption_record',
      status: 'initiated',
      agencyName: 'Smoke SAA Desk',
      orderDate: '2026-01-21',
      note: 'Invalid adoption record should be rejected',
    },
  }), 'invalid adoption record type');
  await expectStatus(400, () => request('POST', `/reports/${openReport.id}/restoration-plan`, {
    token: cwc.token,
    body: {
      restorationType: 'bad_type',
      status: 'planned',
      toState: 'Karnataka',
      toDistrict: 'Bengaluru Urban',
      handoverAuthority: 'Smoke CWC Bengaluru',
      remarks: 'Invalid restoration type should be rejected',
    },
  }), 'invalid restoration type');
  const noteResult = await request('POST', `/reports/${openReport.id}/notes`, {
    token: cwc.token,
    body: { note: 'CWC smoke note: family verification and care follow-up recorded.' },
  });
  assert(noteResult.report.notes.some((row) => row.note.includes('family verification')), 'case note was not recorded');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/notes`, {
    token: parent.token,
    body: { note: 'Parent should not add notes to a CWC-scoped case' },
  }), 'parent case note outside scope');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/confirm-match`, {
    token: cwc.token,
    body: { sendSms: true },
  }), 'CWC confirm match');
  const closedCase = await request('POST', `/reports/${openReport.id}/close-case`, {
    token: cwc.token,
    body: { reason: 'restored_family', foundLocation: 'CWC Mumbai restoration desk', note: 'Family restoration verified in smoke test' },
  });
  assert(closedCase.report.status === 'closed', 'case closure should set status closed');
  assert(closedCase.report.closure?.reason === 'restored_family', 'case closure reason was not recorded');
  await expectStatus(409, () => request('POST', `/reports/${openReport.id}/case-workflow`, {
    token: cwc.token,
    body: { action: 'refer_jjb' },
  }), 'workflow on closed case');
  await expectStatus(403, () => request('POST', `/reports/${openReport.id}/close-case`, {
    token: parent.token,
    body: { reason: 'other' },
  }), 'parent close case');

  const cwcPrivacy = await request('GET', '/dashboard/privacy/retention', { token: cwc.token });
  assert(cwcPrivacy.capabilities.canReview === true, 'CWC should be able to review privacy retention');
  assert(cwcPrivacy.capabilities.canExport === false, 'CWC should not be able to export privacy reports');
  assert(cwcPrivacy.capabilities.canAnonymize === false, 'CWC should not be able to anonymize records');
  const cwcRetention = cwcPrivacy.retention[0];
  assert(cwcRetention, 'Expected CWC privacy queue to include a scoped record');
  await request('POST', `/dashboard/privacy/retention/${cwcRetention.type}/${cwcRetention.id}`, {
    token: cwc.token,
    body: { decision: 'close' },
  });
  await expectStatus(403, () => request('POST', `/dashboard/privacy/retention/${cwcRetention.type}/${cwcRetention.id}`, {
    token: cwc.token,
    body: { decision: 'anonymize' },
  }), 'CWC privacy anonymize');
  await expectStatus(403, () => request('GET', '/dashboard/privacy/export', { token: cwc.token }), 'CWC privacy export');

  const crimePrivacy = await request('GET', '/dashboard/privacy/retention', { token: crimeBureau.token });
  assert(crimePrivacy.capabilities.canReview === false, 'crime bureau privacy queue should be read-only');
  assert(crimePrivacy.capabilities.canExport === true, 'crime bureau should export privacy reports');
  const privacyExport = await request('GET', '/dashboard/privacy/export', { token: crimeBureau.token });
  assert(privacyExport.signature?.type === 'privacy_export', 'privacy export should include signature type');
  assert(privacyExport.signature?.algorithm === 'sha256-hmac', 'privacy export should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(privacyExport.signature?.digest || ''), 'privacy export should include SHA-256 digest');
  assert(/^[a-f0-9]{64}$/.test(privacyExport.signature?.value || ''), 'privacy export should include HMAC signature');
  const privacyVerify = await request('POST', '/dashboard/export/verify', {
    token: crimeBureau.token,
    body: privacyExport,
  });
  assert(privacyVerify.ok === true, 'privacy export signature should verify');
  assert(privacyVerify.type === 'privacy_export', 'privacy export verification should return type');
  const crimeReportRetention = crimePrivacy.retention.find((row) => row.type === 'report');
  if (crimeReportRetention) {
    await expectStatus(403, () => request('POST', `/dashboard/privacy/retention/report/${crimeReportRetention.id}`, {
      token: crimeBureau.token,
      body: { decision: 'close' },
    }), 'crime bureau privacy mutation');
  }

  const adminPrivacy = await request('GET', '/dashboard/privacy/retention', { token: admin.token });
  assert(adminPrivacy.capabilities.canAnonymize === true, 'admin should be able to anonymize scoped privacy records');
  const adminSightingRetention = adminPrivacy.retention.find((row) => row.type === 'foundReport');
  assert(adminSightingRetention, 'Expected admin privacy queue to include a sighting');
  await expectStatus(400, () => request('POST', `/dashboard/privacy/retention/foundReport/${adminSightingRetention.id}`, {
    token: admin.token,
    body: { decision: 'anonymize' },
  }), 'anonymize without approval reference');
  await request('POST', `/dashboard/privacy/retention/foundReport/${adminSightingRetention.id}`, {
    token: admin.token,
    body: {
      decision: 'anonymize',
      approvalType: 'privacy_officer',
      approvalReference: 'PO-APPROVAL-2026-01',
      approvalNote: 'Privacy approval smoke note should stay out of audit payloads.',
    },
  });
  const privacyExportAfterAnonymize = await request('GET', '/dashboard/privacy/export', { token: crimeBureau.token });
  assert(
    privacyExportAfterAnonymize.items.some((row) => row.type === 'foundReport' && row.id === adminSightingRetention.id && row.anonymizationApproval?.reference === 'PO-APPROVAL-2026-01'),
    'privacy export should include anonymization approval reference'
  );
  assert(
    !JSON.stringify(privacyExportAfterAnonymize).includes('Privacy approval smoke note'),
    'privacy export should not include anonymization approval note text'
  );

  const created = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke CCI Provision',
      email: 'smoke.cci.provision@khozo.org',
      role: 'cci',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke CCI',
    },
  });
  assert(created.user.role === 'cci', 'provisioned user should be CCI');
  assert(created.user.mustChangePassword === true, 'provisioned user should be marked for password change');
  assert(created.initialPassword && created.initialPassword !== 'khozo123', 'provisioned user should receive a unique temporary password');
  const createdSjpu = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke SJPU Provision',
      email: 'smoke.sjpu.provision@khozo.org',
      role: 'sjpu',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke SJPU',
    },
  });
  assert(createdSjpu.user.role === 'sjpu', 'provisioned user should be SJPU');
  assert(createdSjpu.user.jurisdiction?.district === 'Mumbai', 'provisioned SJPU should stay in requested district');
  const createdAhtu = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke AHTU Provision',
      email: 'smoke.ahtu.provision@khozo.org',
      role: 'ahtu',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke AHTU',
    },
  });
  assert(createdAhtu.user.role === 'ahtu', 'provisioned user should be AHTU');
  assert(createdAhtu.user.jurisdiction?.district === 'Mumbai', 'provisioned AHTU should stay in requested district');
  const createdDcrb = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke DCRB Provision',
      email: 'smoke.dcrb.provision@khozo.org',
      role: 'dcrb',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke DCRB',
    },
  });
  assert(createdDcrb.user.role === 'dcrb', 'provisioned user should be DCRB');
  assert(createdDcrb.user.jurisdiction?.district === 'Mumbai', 'provisioned DCRB should stay in requested district');
  const createdDlsa = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke DLSA Provision',
      email: 'smoke.dlsa.provision@khozo.org',
      role: 'dlsa',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke DLSA',
    },
  });
  assert(createdDlsa.user.role === 'dlsa', 'provisioned user should be DLSA');
  assert(createdDlsa.user.jurisdiction?.district === 'Mumbai', 'provisioned DLSA should stay in requested district');
  const createdSaa = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke SAA Provision',
      email: 'smoke.saa.provision@khozo.org',
      role: 'saa',
      state: 'Maharashtra',
      district: 'Mumbai',
      org: 'Smoke SAA',
    },
  });
  assert(createdSaa.user.role === 'saa', 'provisioned user should be SAA');
  assert(createdSaa.user.jurisdiction?.district === 'Mumbai', 'provisioned SAA should stay in requested district');
  const createdSara = await request('POST', '/dashboard/network/users', {
    token: superAdmin.token,
    body: {
      name: 'Smoke SARA Provision',
      email: 'smoke.sara.provision@khozo.org',
      role: 'sara',
      state: 'Maharashtra',
      org: 'Smoke SARA',
    },
  });
  assert(createdSara.user.role === 'sara', 'provisioned user should be SARA');
  assert(createdSara.user.jurisdiction?.state === 'Maharashtra', 'provisioned SARA should stay in requested state');
  const createdPunePolice = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke Pune Police Coverage',
      email: 'smoke.pune.police.coverage@khozo.org',
      role: 'police',
      state: 'Maharashtra',
      district: 'Pune',
      org: 'Smoke Pune Police Coverage Desk',
    },
  });
  const adminNetworkBeforeDcpu = await request('GET', '/dashboard/network', { token: admin.token });
  assert(adminNetworkBeforeDcpu.coverage?.totals?.missingSlots > 0, 'network coverage should identify missing stakeholder desks');
  assert(adminNetworkBeforeDcpu.coverage.rows.some((row) => row.district === 'Pune' && row.roles.some((role) => role.role === 'dcpu' && role.status === 'missing')), 'Pune coverage should flag missing DCPU before provisioning');
  const createdDcpu = await request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: {
      name: 'Smoke DCPU Coverage',
      email: 'smoke.dcpu.coverage@khozo.org',
      role: 'dcpu',
      state: 'Maharashtra',
      district: 'Pune',
      org: 'Smoke DCPU Coverage Desk',
    },
  });
  assert(createdDcpu.user.role === 'dcpu', 'provisioned coverage user should be DCPU');
  const adminNetworkAfterDcpu = await request('GET', '/dashboard/network', { token: admin.token });
  assert(adminNetworkAfterDcpu.coverage.rows.some((row) => row.district === 'Pune' && row.roles.some((role) => role.role === 'dcpu' && role.status === 'covered')), 'Pune coverage should mark DCPU covered after provisioning');
  assert(adminNetworkAfterDcpu.coverage.totals.missingSlots === adminNetworkBeforeDcpu.coverage.totals.missingSlots - 1, 'network coverage missing count should decrease after DCPU provisioning');
  await expectStatus(401, () => request('POST', '/auth/login', {
    body: { email: 'smoke.cci.provision@khozo.org', password: 'khozo123' },
  }), 'provisioned account shared password login');
  const provisionedLogin = await request('POST', '/auth/login', {
    body: { email: 'smoke.cci.provision@khozo.org', password: created.initialPassword },
  });
  assert(provisionedLogin.user.mustChangePassword === true, 'provisioned login should expose password-change requirement');
  await expectStatus(403, () => request('GET', '/dashboard/stats', {
    token: provisionedLogin.token,
  }), 'provisioned user dashboard before password change');
  await expectStatus(403, () => request('GET', '/reports', {
    token: provisionedLogin.token,
  }), 'provisioned user reports before password change');
  const newProvisionedPassword = uniquePassword();
  await expectStatus(400, () => request('POST', '/auth/change-password', {
    token: provisionedLogin.token,
    body: { currentPassword: created.initialPassword, newPassword: created.initialPassword },
  }), 'password change to same temporary password');
  const changedProvisioned = await request('POST', '/auth/change-password', {
    token: provisionedLogin.token,
    body: { currentPassword: created.initialPassword, newPassword: newProvisionedPassword },
  });
  assert(changedProvisioned.user.mustChangePassword === false, 'password change should clear forced-change flag');
  // A password change signs out every other session; this one carries on
  // with the token it is handed back.
  assert(typeof changedProvisioned.token === 'string' && changedProvisioned.token !== provisionedLogin.token, 'password change should return a fresh token');
  await expectStatus(401, () => request('GET', '/dashboard/stats', { token: provisionedLogin.token }), 'token issued before a password change');
  await request('GET', '/dashboard/stats', { token: changedProvisioned.token });
  await expectStatus(401, () => request('POST', '/auth/login', {
    body: { email: 'smoke.cci.provision@khozo.org', password: created.initialPassword },
  }), 'temporary password after password change');
  const provisionedRelogin = await request('POST', '/auth/login', {
    body: { email: 'smoke.cci.provision@khozo.org', password: newProvisionedPassword },
  });
  assert(provisionedRelogin.user.mustChangePassword === false, 'new password login should not require password change');
  // Signing out everywhere ends every session, the caller's too.
  await request('POST', '/auth/logout-all', { token: provisionedRelogin.token });
  await expectStatus(401, () => request('GET', '/auth/me', { token: provisionedRelogin.token }), 'token after signing out everywhere');
  await expectStatus(401, () => request('GET', '/auth/me', { token: changedProvisioned.token }), 'other session after signing out everywhere');
  const goaPolice = await request('POST', '/dashboard/network/users', {
    token: superAdmin.token,
    body: {
      name: 'Smoke Goa Police',
      email: 'smoke.goa.police@khozo.org',
      role: 'police',
      state: 'Goa',
      district: 'South Goa',
      org: 'Smoke Police',
    },
  });
  const superNetwork = await request('GET', '/dashboard/network', { token: superAdmin.token });
  assert(superNetwork.users.some((row) => row.id === goaPolice.user.id), 'super admin should see Goa provisioned user');
  const adminNetwork = await request('GET', '/dashboard/network', { token: admin.token });
  assert(adminNetwork.users.some((row) => row.id === created.user.id), 'Maharashtra admin should see in-state provisioned user');
  assert(adminNetwork.users.some((row) => row.id === createdSjpu.user.id), 'Maharashtra admin should see in-state SJPU user');
  assert(adminNetwork.users.some((row) => row.id === createdAhtu.user.id), 'Maharashtra admin should see in-state AHTU user');
  assert(adminNetwork.users.some((row) => row.id === createdDcrb.user.id), 'Maharashtra admin should see in-state DCRB user');
  assert(adminNetwork.users.some((row) => row.id === createdDlsa.user.id), 'Maharashtra admin should see in-state DLSA user');
  assert(adminNetwork.users.some((row) => row.id === createdSaa.user.id), 'Maharashtra admin should see in-state SAA user');
  assert(adminNetwork.users.some((row) => row.id === createdSara.user.id), 'Maharashtra admin should see in-state SARA user');
  assert(adminNetwork.users.some((row) => row.id === createdPunePolice.user.id), 'Maharashtra admin should see in-state Pune police coverage user');
  assert(adminNetwork.users.some((row) => row.id === createdDcpu.user.id), 'Maharashtra admin should see in-state DCPU coverage user');
  assert(!adminNetwork.users.some((row) => row.id === goaPolice.user.id), 'Maharashtra admin should not see Goa provisioned user');
  assert(!adminNetwork.coverage.rows.some((row) => row.state === 'Goa'), 'Maharashtra network coverage should not include Goa jurisdictions');
  const sjpuNetworkAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'police_rpf',
      state: 'Maharashtra',
      district: 'Mumbai',
      subject: 'Smoke police SJPU alert',
      message: 'SJPU police alert body should not be written to audit metadata.',
    },
  });
  assert(sjpuNetworkAlert.recipients.some((row) => row.role === 'sjpu'), 'police/RPF audience should include SJPU recipients');
  assert(sjpuNetworkAlert.recipients.some((row) => row.role === 'ahtu'), 'police/RPF audience should include AHTU recipients');
  assert(sjpuNetworkAlert.recipients.some((row) => row.role === 'dcrb'), 'police/RPF audience should include DCRB recipients');
  assert(sjpuNetworkAlert.recipients.every((row) => ['police', 'sjpu', 'ahtu', 'dcrb', 'rpf', 'crime_bureau'].includes(row.role)), 'police/RPF audience should stay in police/SJPU/AHTU/DCRB/RPF/bureau roles');
  const recordsAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'records',
      state: 'Maharashtra',
      district: 'Mumbai',
      subject: 'Smoke records bureau alert',
      message: 'Records bureau alert body should not be written to audit metadata.',
    },
  });
  assert(recordsAlert.recipients.some((row) => row.role === 'dcrb'), 'records audience should include DCRB recipients');
  assert(!recordsAlert.recipients.some((row) => row.role === 'crime_bureau'), 'district records audience should not include state-only bureau recipients');
  assert(recordsAlert.recipients.every((row) => ['dcrb', 'crime_bureau', 'police', 'sjpu', 'ahtu', 'rpf'].includes(row.role)), 'records audience should stay in record/police roles');
  const stateRecordsAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'records',
      state: 'Maharashtra',
      subject: 'Smoke state records bureau alert',
      message: 'State records bureau alert body should not be written to audit metadata.',
    },
  });
  assert(stateRecordsAlert.recipients.some((row) => row.role === 'crime_bureau'), 'state records audience should include crime bureau recipients');
  assert(stateRecordsAlert.recipients.some((row) => row.role === 'dcrb'), 'state records audience should include district DCRB recipients');
  const networkAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'welfare',
      state: 'Maharashtra',
      district: 'Mumbai',
      caseRef: 'TC-SMOKE-2026-01',
      subject: 'Smoke network alert',
      message: 'Network alert smoke body should not be written to audit metadata.',
    },
  });
  assert(networkAlert.alert.recipientCount >= 1, 'network alert should find in-scope recipients');
  assert(networkAlert.recipients.every((row) => row.jurisdiction?.state === 'Maharashtra'), 'network alert recipients should stay in-state');
  assert(networkAlert.recipients.every((row) => !row.jurisdiction?.district || row.jurisdiction.district === 'Mumbai'), 'network alert recipients should stay in district when district is selected');
  assert(networkAlert.recipients.some((row) => row.role === 'dlsa'), 'welfare network alert should include DLSA recipients');
  assert(networkAlert.recipients.some((row) => row.role === 'saa'), 'welfare network alert should include SAA recipients');
  assert(networkAlert.recipients.every((row) => ['cwc', 'dcpu', 'cci', 'saa', 'jjb', 'dlsa', 'state_nodal', 'sara'].includes(row.role)), 'welfare network alert should target welfare/legal/adoption roles');
  const legalAlert = await request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'legal',
      state: 'Maharashtra',
      district: 'Mumbai',
      subject: 'Smoke DLSA legal alert',
      message: 'Legal aid alert body should not be written to audit metadata.',
    },
  });
  assert(legalAlert.recipients.some((row) => row.role === 'dlsa'), 'legal audience should include DLSA recipients');
  assert(legalAlert.recipients.every((row) => ['dlsa', 'cwc', 'dcpu', 'jjb', 'state_nodal'].includes(row.role)), 'legal audience should stay in DLSA/welfare oversight roles');
  const districtAdoptionAlert = await request('POST', '/dashboard/network/alerts', {
    token: sara.token,
    body: {
      audience: 'adoption',
      state: 'Maharashtra',
      district: 'Mumbai',
      subject: 'Smoke SARA adoption alert',
      message: 'Adoption alert body should not be written to audit metadata.',
    },
  });
  assert(districtAdoptionAlert.recipients.some((row) => row.role === 'saa'), 'district adoption audience should include SAA recipients');
  assert(districtAdoptionAlert.recipients.every((row) => ['sara', 'saa', 'cwc', 'dcpu', 'cci', 'state_nodal'].includes(row.role)), 'district adoption audience should stay in SARA/SAA/welfare oversight roles');
  assert(districtAdoptionAlert.recipients.every((row) => row.jurisdiction?.state === 'Maharashtra'), 'district adoption audience should stay in-state');
  assert(districtAdoptionAlert.recipients.every((row) => !row.jurisdiction?.district || row.jurisdiction.district === 'Mumbai'), 'district adoption audience should respect district filter');
  const stateAdoptionAlert = await request('POST', '/dashboard/network/alerts', {
    token: sara.token,
    body: {
      audience: 'adoption',
      state: 'Maharashtra',
      subject: 'Smoke SARA state adoption alert',
      message: 'State adoption alert body should not be written to audit metadata.',
    },
  });
  assert(stateAdoptionAlert.recipients.some((row) => row.role === 'sara'), 'state adoption audience should include SARA recipients');
  assert(stateAdoptionAlert.recipients.every((row) => ['sara', 'saa', 'cwc', 'dcpu', 'cci', 'state_nodal'].includes(row.role)), 'state adoption audience should stay in SARA/SAA/welfare oversight roles');
  await expectStatus(403, () => request('POST', '/dashboard/network/alerts', {
    token: admin.token,
    body: {
      audience: 'welfare',
      state: 'Goa',
      district: 'South Goa',
      subject: 'Out of scope alert',
      message: 'Admin cannot alert outside state',
    },
  }), 'admin outside-state network alert');
  await expectStatus(403, () => request('POST', '/dashboard/network/alerts', {
    token: parent.token,
    body: {
      audience: 'ngo',
      subject: 'Parent alert',
      message: 'Parent cannot send network alerts',
    },
  }), 'parent network alert');
  await expectStatus(403, () => request('POST', '/dashboard/network/users', {
    token: admin.token,
    body: { name: 'Outside CCI', email: 'outside.smoke@khozo.org', role: 'cci', state: 'Gujarat', district: 'Ahmedabad' },
  }), 'admin outside-state provisioning');
  await expectStatus(403, () => request('POST', '/dashboard/network/users', {
    token: parent.token,
    body: { name: 'Bad Police', email: 'bad.police@khozo.org', role: 'police' },
  }), 'parent provisioning');

  // Provisioning fails closed: a district desk needs a district, a state desk a
  // state, and only the super admin, a state admin or the crime bureau create
  // police accounts.
  const provision = (account, body) => request('POST', '/dashboard/network/users', { token: account.token, body });
  const noDistrict = await expectStatus(400, () => provision(admin, { name: 'Smoke No District', email: 'smoke.nodistrict@khozo.org', role: 'police', state: 'Maharashtra' }), 'a police account without a district');
  assert(noDistrict.error === 'A district is required for this role', `the refusal should say why: ${noDistrict.error}`);
  const noDistrictCwc = await expectStatus(400, () => provision(admin, { name: 'Smoke No District CWC', email: 'smoke.nodistrict.cwc@khozo.org', role: 'cwc' }), 'a CWC account without a district');
  assert(noDistrictCwc.error === 'A district is required for this role', `the refusal should say why: ${noDistrictCwc.error}`);
  const noState = await expectStatus(400, () => provision(superAdmin, { name: 'Smoke No State SARA', email: 'smoke.nostate.sara@khozo.org', role: 'sara' }), 'a state desk without a state');
  assert(noState.error === 'A state is required for this role', `the refusal should say why: ${noState.error}`);
  const noStatePolice = await expectStatus(400, () => provision(superAdmin, { name: 'Smoke No State Police', email: 'smoke.nostate.police@khozo.org', role: 'police', district: 'Pune' }), 'a district desk without a state');
  assert(noStatePolice.error === 'A state is required for this role', `the refusal should say why: ${noStatePolice.error}`);
  const nodal = await login('nodal@khozo.org');
  for (const role of ['police', 'sjpu', 'ahtu', 'dcrb']) {
    for (const [account, label] of [[nodal, 'state nodal'], [sara, 'SARA']]) {
      await expectStatus(403, () => provision(account, { name: `Smoke ${label} ${role}`, email: `smoke.${account.user.role}.${role}@khozo.org`, role, state: 'Maharashtra', district: 'Pune' }), `${label} provisions ${role}`);
    }
  }
  const nodalCwc = await provision(nodal, { name: 'Smoke Nodal CWC', email: 'smoke.nodal.cwc@khozo.org', role: 'cwc', district: 'Pune', org: 'Smoke Pune CWC' });
  assert(nodalCwc.user.role === 'cwc' && nodalCwc.user.jurisdiction?.state === 'Maharashtra' && nodalCwc.user.jurisdiction?.district === 'Pune', 'the state nodal officer provisions a CWC desk in its own state');
  await expectStatus(403, () => provision(nodal, { name: 'Smoke Outside CWC', email: 'smoke.nodal.outside@khozo.org', role: 'cwc', state: 'Gujarat', district: 'Surat' }), 'state nodal provisions outside its state');
  const bureauPolice = await provision(crimeBureau, { name: 'Smoke Bureau Police', email: 'smoke.bureau.police@khozo.org', role: 'police', state: 'Maharashtra', district: 'Nagpur', station: 'Smoke Sitabuldi PS' });
  assert(bureauPolice.user.jurisdiction?.district === 'Nagpur' && bureauPolice.user.jurisdiction?.station === 'Smoke Sitabuldi PS', 'the crime bureau provisions a police station in its state');
  const objectName = await expectStatus(400, () => provision(admin, { name: { first: 'Smoke' }, email: 'smoke.objectname@khozo.org', role: 'cwc', district: 'Pune' }), 'provisioning with an object name');
  assert(objectName.error === 'Invalid value for name', `the refusal should name the field: ${objectName.error}`);

  const audit = await request('GET', '/dashboard/audit', { token: admin.token });
  assert(audit.integrity?.ok === true, 'audit chain should verify on audit list');
  assert(audit.audit.some((row) => row.action === 'auth.privileged_user_provisioned'), 'missing provisioning audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes(created.initialPassword)),
    'temporary password should not be written to audit events'
  );
  assert(audit.audit.some((row) => row.action === 'auth.password_changed'), 'missing password change audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes(newProvisionedPassword)),
    'new password should not be written to audit events'
  );
  assert(audit.audit.some((row) => row.action === 'case.assigned_owner'), 'missing case owner assignment audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Assignment smoke note')),
    'case assignment notes should not be written to audit events'
  );
  assert(audit.audit.some((row) => row.action === 'case.investigation_checklist_updated'), 'missing investigation checklist audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Investigation checklist smoke note')),
    'investigation checklist notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('DCRB records smoke note')),
    'DCRB checklist notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('INV/SMOKE/2026/01')),
    'station diary references should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('DCRB/SMOKE/2026/01')),
    'DCRB station diary references should not be written to audit events'
  );
  assert(audit.audit.some((row) => row.action === 'case.assigned_cci'), 'missing workflow audit event');
  assert(audit.audit.some((row) => row.action === 'case.cci_care_recorded'), 'missing CCI care audit event');
  assert(audit.audit.some((row) => row.action === 'sighting.formal_intake_created'), 'missing sighting formal intake audit event');
  assert(audit.audit.some((row) => row.action === 'case.found_child_intake_created'), 'missing found-child case intake audit event');
  assert(audit.audit.some((row) => row.action === 'case.referred_jjb'), 'missing JJB referral audit event');
  assert(audit.audit.some((row) => row.action === 'case.jjb_proceeding_recorded'), 'missing JJB proceeding audit event');
  assert(audit.audit.some((row) => row.action === 'case.escalated_state'), 'missing state escalation workflow audit event');
  assert(audit.audit.some((row) => row.action === 'case.state_escalation_recorded'), 'missing state escalation audit event');
  assert(audit.audit.some((row) => row.action === 'case.notified_crime_bureau'), 'missing crime bureau notification audit event');
  assert(audit.audit.some((row) => row.action === 'case.bureau_report_recorded'), 'missing bureau report audit event');
  assert(audit.audit.some((row) => row.action === 'case.external_id_linked'), 'missing external id audit event');
  assert(audit.audit.some((row) => row.action === 'case.handoff_exported'), 'missing case handoff export audit event');
  assert(audit.audit.some((row) => row.action === 'case.restoration_plan_recorded'), 'missing restoration plan audit event');
  assert(audit.audit.some((row) => row.action === 'case.welfare_referral_recorded'), 'missing welfare referral audit event');
  assert(audit.audit.some((row) => row.action === 'case.legal_aid_referral_recorded'), 'missing legal-aid referral audit event');
  assert(audit.audit.some((row) => row.action === 'case.adoption_recorded'), 'missing adoption record audit event');
  assert(audit.audit.some((row) => row.action === 'case.assessment_recorded'), 'missing case assessment audit event');
  assert(audit.audit.some((row) => row.action === 'case.production_recorded'), 'missing production record audit event');
  assert(audit.audit.some((row) => row.action === 'grievance.submitted'), 'missing grievance submitted audit event');
  assert(audit.audit.some((row) => row.action === 'grievance.status_updated'), 'missing grievance status audit event');
  assert(audit.audit.some((row) => row.action === 'network.alert_sent'), 'missing network alert audit event');
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Network alert smoke body')),
    'network alert body should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke Form-J circumstances')),
    'child profile circumstances should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke Report Declarant')),
    'report declaration signer should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke identification mark')),
    'child identification marks should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('SJPU police alert body')),
    'SJPU network alert body should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Records bureau alert body')),
    'records network alert body should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('State records bureau alert body')),
    'state records network alert body should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('temporary shelter, counselling review')),
    'CCI care plan details should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke CCI health care progress note')),
    'CCI health progress text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Formal found child intake smoke note')),
    'found-child formal intake notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke CCI education progress note')),
    'CCI education progress text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke CCI counselling progress note')),
    'CCI counselling progress text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke CCI family tracing progress note')),
    'CCI family tracing progress text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('social investigation, rehabilitation review')),
    'JJB directions should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('coordinate interstate rescue')),
    'state escalation action text should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('interstate alert, pattern review')),
    'bureau report summary should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('External ID smoke linking remarks')),
    'external id remarks should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('GHAR smoke restoration route')),
    'restoration remarks should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('9000000456')),
    'restoration escort contact should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('RESTORE/DOC/SMOKE')),
    'restoration document reference should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('FUND/SMOKE')),
    'restoration funding reference should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Welfare smoke eligibility note')),
    'welfare eligibility notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Legal aid smoke note')),
    'legal-aid notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('LEGAL/SMOKE/2026/01')),
    'legal-aid application references should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Adoption smoke note')),
    'adoption notes should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('CARINGS/SMOKE/2026/01')),
    'CARINGS references should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('ADOPT/ORDER/SMOKE/2026/01')),
    'adoption order references should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('SIR smoke findings')),
    'case assessment findings should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('ICP smoke care plan')),
    'case assessment care plans should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Production next action smoke text')),
    'production next action should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Confidential Smoke Reporter')),
    'confidential reporter name should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('123456789012')),
    'raw id proof number should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Smoke grievance description')),
    'grievance description should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Internal smoke grievance note')),
    'grievance internal note should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('CARINGS smoke grievance detail')),
    'adoption grievance description should not be written to audit events'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Internal CARINGS grievance note')),
    'adoption grievance internal note should not be written to audit events'
  );
  await expectStatus(403, () => request('GET', '/dashboard/audit/export', { token: parent.token }), 'parent audit export');
  await expectStatus(403, () => request('GET', '/dashboard/audit/integrity', { token: parent.token }), 'parent audit integrity');
  await expectStatus(403, () => request('POST', '/dashboard/export/verify', {
    token: parent.token,
    body: privacyExport,
  }), 'parent export signature verify');
  const auditIntegrity = await request('GET', '/dashboard/audit/integrity', { token: admin.token });
  assert(auditIntegrity.integrity?.ok === true, 'audit integrity endpoint should verify hash chain');
  assert(auditIntegrity.integrity.checked > 0, 'audit integrity should check at least one event');
  const auditExport = await request('GET', '/dashboard/audit/export', { token: admin.token });
  assert(auditExport.scope === 'Maharashtra', `audit export scope should be Maharashtra, got ${auditExport.scope}`);
  assert(auditExport.signature?.type === 'audit_export', 'audit export should include signature type');
  assert(auditExport.signature?.algorithm === 'sha256-hmac', 'audit export should include signature algorithm');
  assert(/^[a-f0-9]{64}$/.test(auditExport.signature?.digest || ''), 'audit export should include SHA-256 digest');
  assert(/^[a-f0-9]{64}$/.test(auditExport.signature?.value || ''), 'audit export should include HMAC signature');
  assert(auditExport.integrity?.ok === true, 'audit export should include valid pre-export integrity');
  assert(auditExport.exportAuditIntegrity?.ok === true, 'audit export should include valid post-export integrity');
  const auditVerify = await request('POST', '/dashboard/export/verify', {
    token: admin.token,
    body: auditExport,
  });
  assert(auditVerify.ok === true, 'audit export signature should verify');
  assert(auditVerify.type === 'audit_export', 'audit export verification should return type');
  const tamperedAuditExport = { ...auditExport, totals: { ...auditExport.totals, events: auditExport.totals.events + 1 } };
  const tamperedVerify = await request('POST', '/dashboard/export/verify', {
    token: admin.token,
    body: tamperedAuditExport,
  });
  assert(tamperedVerify.ok === false, 'tampered audit export signature should fail verification');
  assert(tamperedVerify.reason === 'digest_mismatch', 'tampered audit export should report digest mismatch');
  assert(auditExport.totals.events >= audit.audit.length, 'audit export should include at least the visible audit rows');
  assert(auditExport.audit.some((row) => row.action === 'case.state_escalation_recorded'), 'audit export should include scoped state escalation event');
  assert(!auditExport.audit.some((row) => row.scope?.state === 'Goa'), 'Maharashtra audit export should not include Goa-scoped events');
  assert(
    !JSON.stringify(auditExport).includes('coordinate interstate rescue'),
    'audit export should not include redacted state escalation action text'
  );
  assert(audit.audit.some((row) => row.action === 'case.note_added'), 'missing case note audit event');
  assert(audit.audit.some((row) => row.action === 'case.closed'), 'missing case closure audit event');
  assert(audit.audit.some((row) => row.action === 'privacy.record_anonymized'), 'missing privacy anonymization audit event');
  assert(
    audit.audit.some((row) => row.action === 'privacy.record_anonymized' && row.metadata?.approvalReference === 'PO-APPROVAL-2026-01'),
    'privacy anonymization audit should include approval reference'
  );
  assert(
    !audit.audit.some((row) => JSON.stringify(row).includes('Privacy approval smoke note')),
    'privacy anonymization approval note should not be written to audit events'
  );
  const nationalAudit = await request('GET', '/dashboard/audit', { token: superAdmin.token });
  const nationalAuditExport = await request('GET', '/dashboard/audit/export', { token: superAdmin.token });
  assert(nationalAuditExport.audit.some((row) => row.action === 'audit.report_exported'), 'national audit export should include export audit event');
  assert(nationalAuditExport.audit.some((row) => row.action === 'audit.integrity_checked'), 'national audit export should include integrity check audit event');
  assert(nationalAuditExport.audit.some((row) => row.action === 'export.signature_verified'), 'national audit export should include signature verification audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'auth.public_user_registered'), 'missing public registration audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'auth.otp_started'), 'missing OTP start audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'auth.otp_failed'), 'missing OTP failure audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'security.public_rate_limited'), 'missing public rate-limit audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'security.abuse_signal_escalated'), 'missing public abuse disposition audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'security.abuse_report_exported'), 'missing public abuse export audit event');
  assert(
    !nationalAudit.audit.some((row) => JSON.stringify(row).includes(samePhoneOtp)),
    'OTP code should not be written to audit events'
  );
  assert(
    !nationalAudit.audit.some((row) => JSON.stringify(row).includes('9000000999')),
    'raw public reporter phone should not be written to rate-limit audit events'
  );
  assert(
    !nationalAudit.audit.some((row) => JSON.stringify(row).includes('Public abuse escalation smoke note')),
    'public abuse disposition note should not be written to audit events'
  );
  assert(
    !nationalAuditExport.audit
      .filter((row) => row.action === 'export.signature_verified')
      .some((row) => JSON.stringify(row).includes('privacyReviewStatus')),
    'signature verification audit should not store uploaded export payloads'
  );
  assert(nationalAudit.audit.some((row) => row.action === 'case.intake_verified'), 'missing intake verification audit event');
  assert(!nationalAudit.audit.some((row) => row.action === 'case.bulletin_published'), 'a refused publish must not be audited as published');
  assert(nationalAudit.audit.some((row) => row.action === 'case.bulletin_unpublished'), 'missing bulletin unpublish audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'case.jurisdiction_transferred'), 'missing jurisdiction transfer audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'mis.report_generated'), 'missing MIS report audit event');
  assert(nationalAudit.audit.some((row) => row.action === 'sighting.cwc_followup_completed'), 'missing CWC follow-up audit event');

  await personCategoryChecks({ superAdmin, sjpu, cwc, parent });
  await twoWayMatchingChecks({ superAdmin, sjpu, cwc, dlsa, ngo: await login('ngo@khozo.org'), parent, fake: fakeAarakshak });
  await candidateAndPhotoChecks({ superAdmin, admin, sjpu, cwc, parent, fake: fakeAarakshak });
  await strictInputChecks({ superAdmin, sjpu });
  await privacyGapChecks({ superAdmin, sjpu, cci: await login('cci@khozo.org') });

  console.log(`API smoke checks passed (${runtimeName} runtime).`);
}

function fileHash(file) {
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}

let devDbHashBefore = null;

async function cleanup() {
  if (server && !server.killed) {
    server.kill();
    await sleep(250);
  }
  if (fakeAarakshak?.server) {
    fakeAarakshak.server.closeAllConnections?.();
    await new Promise((resolve) => fakeAarakshak.server.close(resolve));
  }
  // The run's db.json and uploaded photos live only in the temporary data
  // directory. Windows can hold a just-killed server's file handles for a
  // moment, so removal is retried.
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  const devDbHashAfter = fileHash(devDbFile);
  if (devDbHashAfter !== devDbHashBefore) {
    console.error(`server/data/db.json changed during the run (${devDbHashBefore} -> ${devDbHashAfter}); the suite must never write to it.`);
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);
