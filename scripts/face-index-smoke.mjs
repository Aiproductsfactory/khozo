/**
 * The one-to-many face index layer (shared/face-index.js), with a fake
 * in-memory provider standing in for Aarakshak's gallery.
 *
 *   - no index is configured by default, and a half-configured one is off;
 *   - a fault inside a provider never fails the request that called it;
 *   - registering a verified case with a photo enrols it; a citizen intake is
 *     enrolled only once an officer verifies it; closing, confirming found and
 *     anonymising remove it; reopening enrols it again;
 *   - a new sighting asks the index for 50 faces and spends the pairwise
 *     comparison (and its confirmation) on that shortlist, plus any open case
 *     the index does not hold yet - and on nothing else;
 *   - an index that does not answer falls back to the nearest-first budget.
 *
 * The routes are called directly with an in-memory store; the comparisons go
 * through the Worker engine against a stubbed Aarakshak. No network.
 *
 *   node scripts/face-index-smoke.mjs
 */
import process from 'node:process';

import registerReportRoutes from '../shared/routes/reports.js';
import registerDashboardRoutes from '../shared/routes/dashboard.js';
import { createFaceIndex, safeFaceIndex } from '../shared/face-index.js';
import { detectPerson, rankMatches, rankSightingMatches } from '../worker/src/match.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
};

console.log('Khozo one-to-many face index\n');

// --- Configuration -------------------------------------------------------------
for (const key of ['AARAKSHAK_GALLERY_URL', 'AARAKSHAK_GALLERY_KEY', 'AARAKSHAK_API_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) delete process.env[key];
const none = createFaceIndex({});
check('no index is configured by default', none.name === 'none' && none.enabled === false && (await none.search(Buffer.from('x'), 50)) === null);
check('a URL without a key leaves it off', createFaceIndex({ AARAKSHAK_GALLERY_URL: 'https://gallery.example' }).enabled === false);
const gallery = createFaceIndex({ AARAKSHAK_GALLERY_URL: 'https://gallery.example', AARAKSHAK_GALLERY_KEY: 'k' }, { fetchImpl: async () => { throw new Error('not called'); } });
check('Aarakshak\'s gallery is enabled when both are set', gallery.name === 'aarakshak-gallery' && gallery.enabled === true);
const broken = safeFaceIndex({ name: 'broken', enabled: true, enroll: async () => { throw new Error('boom'); }, search: async () => { throw new Error('boom'); }, remove: async () => { throw new Error('boom'); } });
const quiet = console.warn;
console.warn = () => {};
check('a provider fault is contained', (await broken.search(Buffer.from('x'), 50)) === null && (await broken.enroll('r_1', Buffer.from('x'))).ok === false);
console.warn = quiet;

// --- A fake index and a stubbed Aarakshak ---------------------------------------
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const photo = (person, role) => Buffer.concat([JPEG_HEAD, Buffer.from(`FACE:${person}:${role};`)]);
const personIn = (buf) => /FACE:(\w+):/.exec(Buffer.from(buf).toString('latin1'))?.[1] || null;

function memoryIndex() {
  const faces = new Map();
  const log = [];
  return {
    name: 'memory-test',
    enabled: true,
    faces,
    log,
    failSearch: false,
    async enroll(caseId, buf) {
      log.push(['enroll', caseId]);
      faces.set(caseId, personIn(buf));
      return { ok: true };
    },
    async search(buf, topK) {
      log.push(['search', topK]);
      if (this.failSearch) return null;
      const probe = personIn(buf);
      return [...faces.entries()]
        .map(([caseId, person]) => ({ caseId, score: person === probe ? 0.97 : 0.1 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
    async remove(caseId) {
      log.push(['remove', caseId]);
      faces.delete(caseId);
      return { ok: true };
    },
  };
}

const compared = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).includes('aarakshak')) throw new Error(`unexpected fetch to ${url}`);
  const markers = [...Buffer.from(init.body).toString('latin1').matchAll(/FACE:(\w+):(\w+);/g)];
  // "<sighting person>~<case person>" for every comparison; a photo probed
  // against itself (the face screen) is not one.
  if (markers.length === 2 && markers[0][0] !== markers[1][0]) compared.push(`${markers[0][1]}~${markers[1][1]}`);
  const same = markers.length === 2 && markers[0][1] === markers[1][1];
  return new Response(JSON.stringify({ score: same ? 0.9 : 0.02, source_faces: [{}], target_faces: [{}] }), { status: 200 });
};
const env = { AARAKSHAK_API_KEY: 'k' };

// --- An in-memory store, and the routes ------------------------------------------
const db = { reports: [], foundReports: [], audit: [], activity: [], notifications: [], photos: new Map() };
const users = [
  { id: 'u_police', role: 'police', name: 'Station', jurisdiction: { state: 'Gujarat', district: 'Ahmedabad' } },
  { id: 'u_super', role: 'super_admin', name: 'National', jurisdiction: {} },
  { id: 'u_parent', role: 'parent', name: 'A parent', jurisdiction: {} },
];
const [police, superAdmin, parent] = users;
const find = (rows, id) => rows.find((r) => r.id === id) || null;
const update = (rows) => (id, patch) => {
  const row = find(rows, id);
  if (!row) return null;
  Object.assign(row, patch);
  return row;
};
const index = memoryIndex();
const pass = (_req, _res, next) => next();
const deps = {
  listReports: () => db.reports,
  findReport: (id) => find(db.reports, id),
  addReport: (r) => db.reports.unshift(r),
  updateReport: update(db.reports),
  listFoundReports: () => db.foundReports,
  findFoundReport: (id) => find(db.foundReports, id),
  addFoundReport: (f) => db.foundReports.unshift(f),
  updateFoundReport: update(db.foundReports),
  listUsers: () => users,
  addActivity: (row) => db.activity.push(row),
  addAudit: (row) => db.audit.push(row),
  addNotification: (row) => db.notifications.push(row),
  listActivity: () => db.activity,
  listAudit: () => db.audit,
  savePhoto: async (key, buf) => {
    db.photos.set(`${key}.jpg`, buf);
    return `${key}.jpg`;
  },
  readPhoto: async (key) => db.photos.get(key) || null,
  photoMimeType: () => 'image/jpeg',
  authRequired: pass,
  optionalAuth: pass,
  passwordChangeRequired: pass,
  requireRole: () => pass,
  auditPublicRateLimit: () => {},
  clientIp: () => 'test',
  fixedWindowRateLimit: () => pass,
  rankMatches: (buf, hints) => rankMatches(env, buf, hints, { reports: db.reports, readPhoto: deps.readPhoto }),
  rankSightingMatches: (buf, hints) => rankSightingMatches(env, buf, hints, { foundReports: db.foundReports, reports: db.reports, readPhoto: deps.readPhoto }),
  detectPerson: (buf) => detectPerson(env, buf),
  faceIndex: index,
  upload: { single: () => pass },
  fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  settings: {},
};

function harness(register) {
  const routes = [];
  const router = {
    use: () => router,
    ...Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) => [
      method,
      (path, ...handlers) => {
        routes.push({ method: method.toUpperCase(), path, handler: handlers.flat().at(-1) });
        return router;
      },
    ])),
  };
  register(router, deps);
  return async (method, path, { params = {}, user = null, body = {}, file = null } = {}) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`no route ${method} ${path}`);
    let status = 200;
    let payload = null;
    const res = {
      status(code) { status = code; return res; },
      json(data) { payload = data; return res; },
      type() { return res; },
      send() { return res; },
      end() { return res; },
    };
    await route.handler({ params, query: {}, user, body, file, headers: {} }, res);
    return { status, payload };
  };
}
const reports = harness(registerReportRoutes);
const dashboard = harness(registerDashboardRoutes);

const declaration = { declarationAccepted: 'true', declarationSignerName: 'Smoke', relationshipToChild: 'guardian', declarationMethod: 'digital', photoConsent: 'true' };
const fileOf = (buf) => ({ buffer: buf, mimetype: 'image/jpeg', size: buf.length, originalname: 'p.jpg' });
const register = async (user, person, fields = {}) => {
  const res = await reports('POST', '/', {
    user,
    body: { childName: `Child ${person}`, age: '9', gender: 'Male', state: 'Gujarat', district: 'Ahmedabad', allowDuplicate: 'true', ...declaration, ...fields },
    file: fileOf(photo(person, 'case')),
  });
  if (res.status !== 201) throw new Error(`registration failed: ${JSON.stringify(res.payload)}`);
  return res.payload.report;
};

try {
  // An open case registered before the index was switched on: on file, open,
  // with a photo, and not in the index.
  db.photos.set('r_legacy.jpg', photo('L', 'case'));
  db.reports.push({
    id: 'r_legacy', childName: 'Child L', age: 9, gender: 'Male', state: 'Gujarat', district: 'Ahmedabad',
    status: 'missing', intakeStatus: 'verified', photoFile: 'r_legacy.jpg', createdAt: Date.now() - 86400000,
  });

  const x = await register(police, 'X');
  const y = await register(police, 'Y');
  const z = await register(police, 'Z');
  check('registering a verified case with a photo enrols it',
    ['X', 'Y', 'Z'].every((p, i) => index.faces.get([x, y, z][i].id) === p) && find(db.reports, x.id).faceIndex?.status === 'enrolled',
    JSON.stringify(index.log));

  const pending = await register(parent, 'W');
  check('a citizen intake is not enrolled before an officer verifies it', !index.faces.has(pending.id));
  await reports('POST', '/:id/verify-intake', { params: { id: pending.id }, user: police, body: { note: 'Verified at the station' } });
  check('and is once verified', index.faces.get(pending.id) === 'W');

  // A sighting: the index's shortlist, then the unindexed case, and nothing else.
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await register(police, `O${i}`);
  }
  compared.length = 0;
  index.log.length = 0;
  const seen = await reports('POST', '/found', {
    user: null,
    body: { foundLocation: 'Kalupur station', state: 'Gujarat', district: 'Ahmedabad', photoConsent: 'true', reporterPhone: '9000003001' },
    file: fileOf(photo('X', 'sighting')),
  });
  const sighting = find(db.foundReports, seen.payload.foundReport.id);
  check('a new sighting asks the index for 50 faces', index.log.some(([op, k]) => op === 'search' && k === 50), JSON.stringify(index.log));
  check('and links the face the shortlist and the pairwise comparison agree on',
    sighting.matchedReportId === x.id && sighting.matchEngine?.pool?.source === 'index' && sighting.matchEngine.index?.hits >= 1,
    JSON.stringify({ matchedReportId: sighting.matchedReportId, pool: sighting.matchEngine?.pool, index: sighting.matchEngine?.index }));
  check('the case the index does not hold is still compared', compared.some((pair) => pair.endsWith('~L')), compared.join());
  check('the pool says how the budget was spent',
    sighting.matchEngine.pool.fromIndex >= 1 && sighting.matchEngine.pool.unindexed === 1, JSON.stringify(sighting.matchEngine.pool));
  check('the configuration hash names the index in use', typeof sighting.matchEngine.configHash === 'string');

  // With a tight budget, only the shortlist's best is compared.
  process.env.KHOZO_MATCH_CANDIDATES = '1';
  compared.length = 0;
  const tight = await reports('POST', '/found', {
    user: null,
    body: { foundLocation: 'Kalupur station', state: 'Gujarat', district: 'Ahmedabad', photoConsent: 'true', reporterPhone: '9000003002' },
    file: fileOf(photo('Y', 'sighting')),
  });
  delete process.env.KHOZO_MATCH_CANDIDATES;
  check('the pairwise comparison is spent on the index\'s shortlist, best first',
    compared.length === 1 && compared[0] === 'Y~Y' && find(db.foundReports, tight.payload.foundReport.id).matchedReportId === y.id, compared.join());

  // An index that does not answer: the nearest-first budget, and it is recorded.
  index.failSearch = true;
  const fallback = await reports('POST', '/found', {
    user: null,
    body: { foundLocation: 'Kalupur station', state: 'Gujarat', district: 'Ahmedabad', photoConsent: 'true', reporterPhone: '9000003003' },
    file: fileOf(photo('Z', 'sighting')),
  });
  index.failSearch = false;
  const fell = find(db.foundReports, fallback.payload.foundReport.id);
  check('an index that does not answer falls back to the pairwise budget',
    fell.matchedReportId === z.id && fell.matchEngine.pool?.source === 'budget' && fell.matchEngine.index?.error === 'no_answer', JSON.stringify(fell.matchEngine.index));

  // Leaving the index.
  index.log.length = 0;
  await reports('POST', '/:id/close-case', { params: { id: y.id }, user: police, body: { reason: 'restored_family', foundLocation: 'Home', note: 'Closed in the index smoke' } });
  check('closing a case removes it from the index', !index.faces.has(y.id) && find(db.reports, y.id).faceIndex?.status === 'removed');

  const verification = { method: 'in_person', verifiedBy: 'Smoke Inspector', place: 'Kalupur PS', note: 'Identified by the mother in person at the station.' };
  await reports('POST', '/found/:id/review', { params: { id: sighting.id }, user: police, body: { decision: 'matched', verification } });
  check('confirming a case found removes it from the index', find(db.reports, x.id).status === 'found' && !index.faces.has(x.id), JSON.stringify(index.log));

  await reports('POST', '/:id/reopen', { params: { id: x.id }, user: police, body: { reason: 'The family says this is not the child.' } });
  check('reopening a case enrols it again', index.faces.get(x.id) === 'X');

  await dashboard('POST', '/privacy/retention/:type/:id', {
    params: { type: 'report', id: z.id },
    user: superAdmin,
    body: { decision: 'anonymize', approvalReference: 'SMOKE-IDX-1' },
  });
  check('anonymising a case removes it from the index', !index.faces.has(z.id) && find(db.reports, z.id).faceIndex?.status === 'removed');

  // Replacing a photo replaces the face in the index.
  const replaced = await reports('POST', '/:id/photo', { params: { id: x.id }, user: police, body: {}, file: fileOf(photo('X2', 'case')) });
  check('replacing a case photo replaces its face in the index', replaced.status === 200 && index.faces.get(x.id) === 'X2', JSON.stringify(replaced.payload));
} finally {
  globalThis.fetch = realFetch;
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Face index checks passed.');
