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
 *   - an index that does not answer falls back to the nearest-first budget;
 *   - a case enrolled seconds ago, which the gallery cannot find yet, is still
 *     compared pairwise;
 *   - the Aarakshak v2 adapter sends exactly what its contract says - the
 *     opaque case id and the photo, never a name or metadata - retries a
 *     broken call once with the same Idempotency-Key, never retries a 429,
 *     and reads refusals, searches, receipts and the gallery list;
 *   - the backfill removes before it enrols, leaves faces that are not
 *     Khozo's alone, does not resend a refused photo, and stops at a 429.
 *

 * The routes are called directly with an in-memory store; the comparisons go
 * through the Worker engine against a stubbed Aarakshak. No network.
 *
 *   node scripts/face-index-smoke.mjs
 */
import process from 'node:process';

import registerReportRoutes from '../shared/routes/reports.js';
import registerDashboardRoutes from '../shared/routes/dashboard.js';
import registerFaceIndexAdminRoutes from '../shared/routes/face-index-admin.js';
import { aarakshakGalleryIndex, createFaceIndex, isRetryableIndexFailure, safeFaceIndex } from '../shared/face-index.js';
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

// --- The Aarakshak v2 adapter, against a fake gallery ----------------------------
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const photo = (person, role) => Buffer.concat([JPEG_HEAD, Buffer.from(`FACE:${person}:${role};`)]);
const personIn = (buf) => /FACE:(\w+):/.exec(Buffer.from(buf).toString('latin1'))?.[1] || null;

/** Aarakshak's /api/v2, as far as Khozo uses it. `queue` overrides the next answers. */
function fakeGallery() {
  const requests = [];
  const queue = [];
  const reply = (status, body, requestId = `req-${requests.length}`) =>
    new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId } });
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body ? Buffer.from(init.body).toString('latin1') : '';
    requests.push({ method: init.method, path: u.pathname, query: u.search, headers, body });
    if (queue.length) {
      const next = queue.shift();
      if (next === 'network') throw new TypeError('fetch failed');
      return reply(next.status, next.body, next.requestId);
    }
    if (init.method === 'POST' && u.pathname === '/api/v2/cases') {
      const caseId = /name="case_id"\r\n\r\n([^\r]+)/.exec(body)?.[1];
      return reply(201, {
        case: { case_id: caseId, metadata: {}, faces: [], created_at: 'now', updated_at: 'now' },
        photos: [{ photo_index: 0, status: 'enrolled', face_id: `f_${caseId}`, faces_detected: 1, box: null, detected_boxes: [], quality_score: 0.82, warnings: [] }],
        faces_enrolled: 1,
        model: { model_version: 'm1', embedding_model: 'e1', score: 'cosine' },
      });
    }
    if (init.method === 'POST' && u.pathname === '/api/v2/search') {
      return reply(200, {
        gallery_id: 'khozo-sandbox', faces_detected: 2, top_k: 50, min_score: null, model: {},
        faces: [
          { box: {}, quality_score: 0.9, warnings: [], matches: [{ case_id: 'r_aaaa1111', face_id: 'f1', score: 0.71 }, { case_id: 'r_bbbb2222', face_id: 'f2', score: 0.40 }] },
          { box: {}, quality_score: 0.6, warnings: [], matches: [{ case_id: 'r_bbbb2222', face_id: 'f3', score: 0.88 }, { case_id: 'r_cccc3333', face_id: 'f4', score: -0.2 }] },
        ],
      });
    }
    if (init.method === 'DELETE' && u.pathname.startsWith('/api/v2/cases/')) {
      return reply(200, { case_id: decodeURIComponent(u.pathname.split('/').pop()), case_id_sha256: 'ab12', faces_deleted: 1, deleted_at: '2026-10-17T10:00:00Z', signature: 'sig==' });
    }
    if (init.method === 'GET' && u.pathname === '/api/v2/gallery') {
      return reply(200, { gallery_id: 'khozo-sandbox', label: 'Khozo sandbox', owner: 'khozo', case_count: 3, face_count: 4, limits: { max_faces: 4000, requests_per_minute: 30 }, model: { model_version: 'm1', embedding_model: 'e1', score: 'cosine' } });
    }
    if (init.method === 'GET' && u.pathname === '/api/v2/cases') {
      const all = ['r_aaaa1111', 'r_bbbb2222', 'r_cccc3333'];
      const offset = Number(u.searchParams.get('offset')) || 0;
      const limit = Number(u.searchParams.get('limit')) || 1000;
      return reply(200, { case_ids: all.slice(offset, offset + limit), total: all.length, offset, limit });
    }
    return reply(404, { detail: 'Not Found' });
  }
  return { requests, queue, fetchImpl };
}

{
  const fake = fakeGallery();
  const g = aarakshakGalleryIndex({ url: 'https://gallery.example/api/v2/', key: ' sand​box-key﻿ ', gallery: 'khozo-sandbox', fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
  const quietWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const enrolled = await g.enroll('r_aaaa1111', photo('A', 'case'));
    const req = fake.requests.at(-1);
    check('enrolment posts the case to /api/v2/cases with the key, invisible characters removed, and an Idempotency-Key',
      req.method === 'POST' && req.path === '/api/v2/cases' && req.headers['x-api-key'] === 'sandbox-key' && /^khozo-enrol-r_aaaa1111-/.test(req.headers['idempotency-key'] || ''),
      JSON.stringify({ path: req.path, headers: req.headers }));
    const fields = [...req.body.matchAll(/; name="([^"]+)"/g)].map((m) => m[1]);
    check('it sends the opaque case id, replace=true and one photo - no name, no metadata',
      fields.join() === 'case_id,replace,images' && /name="replace"\r\n\r\ntrue/.test(req.body) && !/Child|sex|birth_year|state_code|district_code/.test(req.body),
      fields.join());
    check('and reads the enrolled face', enrolled.ok === true && enrolled.faceId === 'f_r_aaaa1111' && enrolled.quality === 0.82, JSON.stringify(enrolled));

    fake.queue.push({ status: 503, body: { detail: 'busy' }, requestId: 'rid-503' });
    const retried = await g.enroll('r_aaaa1111', photo('A', 'case'));
    const [first, second] = fake.requests.slice(-2);
    check('a 5xx is retried once, with the same Idempotency-Key',
      retried.ok === true && first.headers['idempotency-key'] === second.headers['idempotency-key'], JSON.stringify(retried));
    check('and the failure is logged with Aarakshak\'s X-Request-ID', warnings.some((w) => w.includes('rid-503')), warnings.join(' | '));
    check('a later enrolment of the same case gets a new key',
      new Set(fake.requests.filter((r) => r.path === '/api/v2/cases' && r.method === 'POST').map((r) => r.headers['idempotency-key'])).size === 2);

    const before = fake.requests.length;
    fake.queue.push({ status: 429, body: { detail: 'rate limited' } });
    const limited = await g.enroll('r_aaaa1111', photo('A', 'case'));
    check('a 429 is not retried, and says so', fake.requests.length === before + 1 && limited.ok === false && limited.reason === 'rate_limited', JSON.stringify(limited));

    fake.queue.push({ status: 201, body: { case: {}, photos: [{ photo_index: 0, status: 'multiple_faces', face_id: null, faces_detected: 2, warnings: [] }], faces_enrolled: 0, model: {} } });
    const several = await g.enroll('r_aaaa1111', photo('A', 'case'));
    fake.queue.push({ status: 422, body: { detail: { photos: [{ photo_index: 0, status: 'face_too_small', faces_detected: 1, quality_score: 0.2, warnings: ['small'] }] } } });
    const small = await g.enroll('r_aaaa1111', photo('A', 'case'));
    check('a refused photo comes back with Aarakshak\'s reason',
      several.ok === false && several.reason === 'multiple_faces' && small.ok === false && small.reason === 'face_too_small' && small.warnings[0] === 'small',
      JSON.stringify({ several, small }));

    // Aarakshak's own error body, { detail: { code, message } }.
    fake.queue.push({ status: 422, body: { detail: { code: 'no_face_detected', message: 'No face was detected in the image.' } } });
    const noFaceCode = await g.enroll('r_aaaa1111', photo('A', 'case'));
    fake.queue.push({ status: 422, body: { detail: { code: 'image_decode_failed', message: 'The image could not be decoded.' } } });
    const otherCode = await g.enroll('r_aaaa1111', photo('A', 'case'));
    fake.queue.push({ status: 401, body: { detail: { code: 'unauthorized', message: 'A valid X-API-Key header is required.' } } });
    const badKey = await g.enroll('r_aaaa1111', photo('A', 'case'));
    check('a 422 refusal is read for its reason and message; a refused key is retryable, not the photo\'s fault',
      noFaceCode.reason === 'no_face' && noFaceCode.detail === 'No face was detected in the image.' &&
        otherCode.reason === 'refused_image_decode_failed' && otherCode.detail === 'The image could not be decoded.' &&
        badKey.reason === 'unauthorized' && isRetryableIndexFailure('unauthorized') && !isRetryableIndexFailure('refused_image_decode_failed'),
      JSON.stringify({ noFaceCode, otherCode, badKey }));

    const hits = await g.search(photo('A', 'sighting'), 50);
    const searchReq = fake.requests.at(-1);
    check('search posts one image and top_k to /api/v2/search',
      searchReq.path === '/api/v2/search' && /name="top_k"\r\n\r\n50/.test(searchReq.body) && /name="image"; filename=/.test(searchReq.body));
    check('every face in the probe is searched, each case at its best score, best first',
      JSON.stringify(hits) === JSON.stringify([{ caseId: 'r_bbbb2222', score: 0.88 }, { caseId: 'r_aaaa1111', score: 0.71 }, { caseId: 'r_cccc3333', score: 0 }]),
      JSON.stringify(hits));
    fake.queue.push({ status: 200, body: { gallery_id: 'khozo-sandbox', faces_detected: 0, faces: [], top_k: 50, min_score: null, model: {} } });
    const noFace = await g.search(photo('A', 'sighting'), 50);
    const beforeSearch = fake.requests.length;
    fake.queue.push({ status: 429, body: { detail: 'rate limited' } });
    const limitedSearch = await g.search(photo('A', 'sighting'), 50);
    check('a probe with no face, or a 429, is no answer - the pairwise budget decides - and is not retried',
      noFace === null && limitedSearch === null && fake.requests.length === beforeSearch + 1);

    const gone = await g.remove('r_aaaa1111');
    const removeReq = fake.requests.at(-1);
    fake.queue.push({ status: 404, body: { detail: 'not found' } });
    const already = await g.remove('r_zzzz9999');
    check('removal deletes /api/v2/cases/{id} and keeps the signed receipt; already gone is done',
      removeReq.method === 'DELETE' && removeReq.path === '/api/v2/cases/r_aaaa1111' &&
        gone.ok && gone.receipt?.signature === 'sig==' && gone.receipt.caseIdSha256 === 'ab12' && already.ok === true,
      JSON.stringify({ gone, already }));

    const info = await g.info();
    const wrong = await aarakshakGalleryIndex({ url: 'https://gallery.example', key: 'k', gallery: 'someone-else', fetchImpl: fake.fetchImpl }).info();
    check('gallery info is read, and a key for another gallery is flagged',
      info.galleryId === 'khozo-sandbox' && info.faces === 4 && info.limits.max_faces === 4000 && info.galleryMatches === true && wrong.galleryMatches === false,
      JSON.stringify(info));
    const ids = await g.listCaseIds({ pageSize: 2 });
    check('the gallery list is read page by page',
      JSON.stringify(ids) === JSON.stringify(['r_aaaa1111', 'r_bbbb2222', 'r_cccc3333']) && fake.requests.at(-1).query === '?offset=2&limit=2', JSON.stringify(ids));
    check('a URL given with /api/v2 on the end is the same host', fake.requests.every((r) => r.path.startsWith('/api/v2/')));
  } finally {
    console.warn = quietWarn;
  }
}

// --- A fake index and a stubbed Aarakshak ---------------------------------------

function memoryIndex() {
  const faces = new Map();
  const log = [];
  return {
    name: 'memory-test',
    enabled: true,
    faces,
    log,
    failSearch: false,
    // One photo, or a case's set of them (shared/face-index.js): `faces`
    // holds the first photo's person, `sets` every person enrolled.
    sets: new Map(),
    async enroll(caseId, buf) {
      const bufs = Array.isArray(buf) ? buf : [buf];
      log.push(['enroll', caseId, bufs.length]);
      faces.set(caseId, personIn(bufs[0]));
      this.sets.set(caseId, bufs.map(personIn));
      return { ok: true, photos: bufs.map(() => ({ status: 'enrolled' })) };
    },
    async search(buf, topK) {
      log.push(['search', topK]);
      if (this.failSearch) return null;
      const probe = personIn(buf);
      return [...faces.entries()]
        .filter(([caseId]) => !this.hidden?.has(caseId))
        .map(([caseId, person]) => ({ caseId, score: (this.sets.get(caseId) || [person]).includes(probe) ? 0.97 : 0.1 }))
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

function harness(register, d = deps) {
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
  register(router, d);
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

  // A face enrolled seconds ago that the gallery cannot find yet (Aarakshak
  // indexes in about five seconds): still compared pairwise.
  const fresh = await register(police, 'N');
  index.hidden = new Set([fresh.id]);
  compared.length = 0;
  const early = await reports('POST', '/found', {
    user: null,
    body: { foundLocation: 'Kalupur station', state: 'Gujarat', district: 'Ahmedabad', photoConsent: 'true', reporterPhone: '9000003004' },
    file: fileOf(photo('N', 'sighting')),
  });
  check('a case enrolled seconds ago is compared pairwise until the gallery can find it',
    compared.includes('N~N') && find(db.foundReports, early.payload.foundReport.id).matchedReportId === fresh.id, compared.join());
  find(db.reports, fresh.id).faceIndex.at = new Date(Date.now() - 60000).toISOString();
  compared.length = 0;
  await reports('POST', '/found', {
    user: null,
    body: { foundLocation: 'Kalupur station', state: 'Gujarat', district: 'Ahmedabad', photoConsent: 'true', reporterPhone: '9000003005' },
    file: fileOf(photo('N', 'sighting')),
  });
  check('and once settled, the gallery\'s answer is trusted', !compared.includes('N~N'), compared.join());
  index.hidden = null;
} finally {

  globalThis.fetch = realFetch;
}

// --- The backfill -------------------------------------------------------------
{
  const old = new Date(Date.now() - 3600000).toISOString();
  const store = { reports: [], audit: [], photos: new Map() };
  const open = (id, person, extra = {}) => {
    store.photos.set(`${id}.jpg`, photo(person, 'case'));
    store.reports.push({ id, childName: `Child ${person}`, status: 'missing', intakeStatus: 'verified', photoFile: `${id}.jpg`, createdAt: Date.now(), ...extra });
  };
  open('r_open0001', 'P1');
  open('r_open0002', 'P2', { faceIndex: { provider: 'gallery-test', status: 'failed', reason: 'rate_limited', at: old } });
  open('r_bad00001', 'M', { faceIndex: { provider: 'gallery-test', status: 'failed', reason: 'multiple_faces', at: old } });
  open('r_marked01', 'P3', { faceIndex: { provider: 'gallery-test', status: 'enrolled', reason: null, at: old } });
  store.reports.push({ id: 'r_nophoto1', childName: 'Child Q', status: 'missing', intakeStatus: 'verified', photoFile: 'r_nophoto1.jpg', createdAt: Date.now() });
  open('r_refuse01', 'P4', { faceIndex: { provider: 'gallery-test', status: 'failed', reason: 'http_422', at: old } });
  open('r_weak0001', 'P5', { faceIndex: { provider: 'gallery-test', status: 'enrolled', reason: null, warnings: ['face_too_small'], at: old } });
  open('r_found001', 'F', { status: 'found', faceIndex: { provider: 'gallery-test', status: 'enrolled', reason: null, at: old } });
  open('r_closed01', 'C', { status: 'closed', faceIndex: { provider: 'gallery-test', status: 'enrolled', reason: null, at: old } });

  function galleryIndex(initial) {
    const faces = new Map(initial.map((id) => [id, 'x']));
    const log = [];
    return {
      name: 'gallery-test',
      enabled: true,
      faces,
      log,
      limitAfter: Infinity,
      async enroll(caseId, buf) {
        log.push(['enroll', caseId]);
        if (log.filter(([op]) => op === 'enroll').length > this.limitAfter) return { ok: false, reason: 'rate_limited' };
        if (personIn(buf) === 'M') return { ok: false, reason: 'multiple_faces' };
        faces.set(caseId, personIn(buf));
        return { ok: true, quality: 0.8 };
      },
      async search() {
        return [];
      },
      async remove(caseId) {
        log.push(['remove', caseId]);
        faces.delete(caseId);
        return { ok: true, receipt: { signature: 'sig' } };
      },
      async info() {
        return { galleryId: 'khozo-sandbox', cases: faces.size, faces: faces.size, limits: {}, galleryMatches: true };
      },
      async listCaseIds() {
        return [...faces.keys()];
      },
    };
  }
  const adminDeps = (idx, s) => ({
    ...deps,
    faceIndex: idx,
    listReports: () => s.reports,
    findReport: (id) => find(s.reports, id),
    updateReport: update(s.reports),
    readPhoto: async (key) => s.photos.get(key) || null,
    addAudit: (row) => s.audit.push(row),
  });
  const g = galleryIndex(['r_found001', 'r_stray001', 'aarakshak-demo-7', 'r_weak0001']);
  const admin = harness(registerFaceIndexAdminRoutes, adminDeps(g, store));

  const status = await admin('GET', '/face-index', { user: superAdmin });
  check('the status counts what the gallery holds and what it does not',
    status.payload.enabled && status.payload.gallery.galleryId === 'khozo-sandbox' && status.payload.counts.pending === 4 &&
      status.payload.counts.missingFromGallery === 1 && status.payload.counts.toRemove === 2 && status.payload.counts.needsPhoto === 1,
    JSON.stringify(status.payload.counts));
  check('and lists the cases that need a better photo by id and reason only',
    JSON.stringify(status.payload.needsPhoto.map((r) => Object.keys(r).sort())) === JSON.stringify([['at', 'id', 'reason']]) && status.payload.needsPhoto[0].reason === 'multiple_faces',
    JSON.stringify(status.payload.needsPhoto));

  check('it counts faces enrolled small or unclear, and lists other refusals with their reason',
    status.payload.counts.weak === 1 && status.payload.counts.refused === 1 && status.payload.refused[0].id === 'r_refuse01' && status.payload.refused[0].reason === 'http_422',
    JSON.stringify({ counts: status.payload.counts, refused: status.payload.refused }));

  const run = await admin('POST', '/face-index/backfill', { user: superAdmin, body: { limit: 20 } });
  const ops = g.log.map(([op, id]) => `${op}:${id}`);
  check('the backfill removes the found case and the stray Khozo id before it enrols',
    ops.includes('remove:r_found001') && ops.includes('remove:r_stray001') &&
      Math.max(ops.indexOf('remove:r_found001'), ops.indexOf('remove:r_stray001')) < ops.findIndex((o) => o.startsWith('enroll')),
    ops.join());
  check('a closed case the gallery does not hold is marked removed without a call',
    !ops.includes('remove:r_closed01') && find(store.reports, 'r_closed01').faceIndex.status === 'removed');
  check('a face that is not Khozo\'s is left alone', g.faces.has('aarakshak-demo-7'));
  check('it enrols new cases, rate-limited ones and ones missing from the gallery',
    ['r_open0001', 'r_open0002', 'r_marked01'].every((id) => g.faces.has(id) && find(store.reports, id).faceIndex.status === 'enrolled'), ops.join());
  check('a refused photo is not sent again, and a case with no photo on file is marked for one',
    !ops.includes('enroll:r_bad00001') && find(store.reports, 'r_nophoto1').faceIndex.reason === 'photo_missing');
  check('the batch reports its work and leaves nothing for this run',
    run.payload.enrolled === 3 && run.payload.removed === 3 && run.payload.rejected === 1 && run.payload.remaining === 0 && run.payload.rateLimited === false,
    JSON.stringify(run.payload));
  check('and is audited', store.audit.some((a) => a.action === 'face_index.backfill' && a.metadata.enrolled === 3));
  check('a photo refused for another reason is not sent again unasked', !ops.includes('enroll:r_refuse01'));
  const retry = await admin('POST', '/face-index/backfill', { user: superAdmin, body: { limit: 20, retryRefused: true } });
  check('and is, once, when the batch is asked to',
    retry.payload.enrolled === 1 && g.log.filter(([op, id]) => op === 'enroll' && id === 'r_refuse01').length === 1 && !g.log.some(([op, id]) => op === 'enroll' && id === 'r_bad00001') && retry.payload.remaining === 0,
    JSON.stringify(retry.payload));

  // A 429 stops the batch; the rate-limited case is due again in the same run.
  const store2 = { reports: [], audit: [], photos: new Map() };
  for (const n of [1, 2, 3]) {
    store2.photos.set(`r_rate000${n}.jpg`, photo(`R${n}`, 'case'));
    store2.reports.push({ id: `r_rate000${n}`, childName: 'x', status: 'missing', intakeStatus: 'verified', photoFile: `r_rate000${n}.jpg`, createdAt: Date.now() - n });
  }
  const g2 = galleryIndex([]);
  g2.limitAfter = 1;
  const admin2 = harness(registerFaceIndexAdminRoutes, adminDeps(g2, store2));
  const limited = await admin2('POST', '/face-index/backfill', { user: superAdmin, body: { limit: 20 } });
  check('a 429 stops the batch and asks for a minute\'s wait',
    limited.payload.rateLimited === true && limited.payload.waitMs === 60000 && g2.log.filter(([op]) => op === 'enroll').length === 2 && limited.payload.remaining === 2,
    JSON.stringify(limited.payload));
  g2.limitAfter = Infinity;
  const resumed = await admin2('POST', '/face-index/backfill', { user: superAdmin, body: { limit: 20, since: limited.payload.since } });
  check('and the same run picks the rate-limited case up again',
    resumed.payload.enrolled === 2 && resumed.payload.remaining === 0 && g2.faces.size === 3, JSON.stringify(resumed.payload));

  // A gallery mostly of Khozo ids with no case on file: nothing is removed.
  const g3 = galleryIndex(Array.from({ length: 12 }, (_, i) => `r_unknown${String(i).padStart(2, '0')}`));
  const admin3 = harness(registerFaceIndexAdminRoutes, adminDeps(g3, { reports: [], audit: [], photos: new Map() }));
  const guarded = await admin3('POST', '/face-index/backfill', { user: superAdmin, body: {} });
  check('a gallery that is mostly unknown to the cases loaded is not emptied',
    guarded.payload.unknownGuarded === true && g3.faces.size === 12 && guarded.payload.removed === 0, JSON.stringify(guarded.payload));

  const off = harness(registerFaceIndexAdminRoutes, adminDeps(createFaceIndex({}), store));
  const offStatus = await off('GET', '/face-index', { user: superAdmin });
  const offRun = await off('POST', '/face-index/backfill', { user: superAdmin, body: {} });
  check('without an index both say so and do nothing',
    offStatus.payload.enabled === false && offRun.payload.enabled === false && offRun.payload.processed === 0);
}

const failed = checks.filter((c) => !c.ok);

console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Face index checks passed.');
