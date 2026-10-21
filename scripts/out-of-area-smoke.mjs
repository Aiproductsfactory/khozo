/**
 * Checks what happens when a person from one district's case is seen in
 * another - a child from an Ahmedabad case seen in Mumbai, or anywhere else in
 * India:
 *
 *   - the possible-match alert names where the person was seen, not the case's
 *     district the sighting is filed under, and says it is outside theirs;
 *   - the case's officers can ask the police there to help
 *     (POST /found/:id/local-police), and only police desks covering that
 *     place are told and may open the sighting - never the case;
 *   - those police can answer (POST /found/:id/local-police/reply), and the
 *     case's officers are told;
 *   - someone registered as a missing child who is 18 or over today is
 *     treated as an adult: their family is not told where they are without
 *     their consent (isAdultCase in shared/case-domain.js).
 *
 * Handlers are called directly with stubbed dependencies: no server, no
 * database, no network.
 *
 *   node scripts/out-of-area-smoke.mjs
 */

import process from 'node:process';

import registerReportRoutes from '../shared/routes/reports.js';
import { canSeeLocalPoliceRequest, scopeFoundReports, seenOutsideCaseDistrict } from '../shared/scope.js';
import { grewUpWhileMissing, isAdultCase, publicCaseStatus } from '../shared/case-domain.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('Khozo sightings outside the case’s district\n');

const YEAR = 365.25 * 86400000;

// --- Grown up while missing -----------------------------------------------------
{
  const longAgo = { id: 'r_old', personCategory: 'child', age: 15, dateOfMissing: '2010-06-01', status: 'missing' };
  const recent = { id: 'r_new', personCategory: 'child', age: 9, dateOfMissing: new Date(Date.now() - YEAR).toISOString(), status: 'missing' };
  const noAge = { id: 'r_noage', personCategory: 'child', dateOfMissing: '2008-01-01', status: 'missing' };
  check('a girl missing at 15 in 2010 is an adult today', isAdultCase(longAgo) && grewUpWhileMissing(longAgo));
  check('a child missing at 9 last year is still a child', !isAdultCase(recent) && !grewUpWhileMissing(recent));
  check('with no age recorded, the category decides', !isAdultCase(noAge));
  check('a woman’s case is an adult’s, and did not grow up while missing', isAdultCase({ personCategory: 'woman' }) && !grewUpWhileMissing({ personCategory: 'woman' }));
  check('turning 18 counts', isAdultCase({ personCategory: 'child', age: 17, dateOfMissing: new Date(Date.now() - 1.2 * YEAR).toISOString() }));
  const status = publicCaseStatus({ ...longAgo, status: 'found' });
  check('the family’s status page treats her as an adult', status.adult === true && /consent/i.test(status.message));
  check('and still names nobody', !('age' in status) && !('childName' in status));
}

// --- Where a sighting was seen ------------------------------------------------------
const CASE_AHD = {
  id: 'r_1', status: 'missing', state: 'Gujarat', district: 'Ahmedabad', personCategory: 'child', age: 12,
  dateOfMissing: new Date(Date.now() - 2 * YEAR).toISOString(), childName: 'Asha Test', parentName: 'Parent Test', parentPhone: '9000000001',
  visibility: 'police', photoFile: 'r_1.jpg', createdAt: Date.now() - 2 * YEAR,
};
const CASE_GROWN = {
  id: 'r_2', status: 'missing', state: 'Gujarat', district: 'Ahmedabad', personCategory: 'child', age: 15,
  dateOfMissing: '2010-06-01', childName: 'Grown Test', parentName: 'Parent Two', parentPhone: '9000000002',
  visibility: 'police', photoFile: 'r_2.jpg', createdAt: Date.parse('2010-06-02'),
};
const MUMBAI = { state: 'Maharashtra', district: 'Mumbai' };
const AHMEDABAD = { state: 'Gujarat', district: 'Ahmedabad' };

const AHD_POLICE = { id: 'u_ahd', role: 'police', name: 'Ahmedabad Crime Branch', phone: '079-0000-0001', jurisdiction: AHMEDABAD };
const AHD_CWC = { id: 'u_ahd_cwc', role: 'cwc', name: 'Ahmedabad CWC', jurisdiction: AHMEDABAD };
const MUM_POLICE = { id: 'u_mum', role: 'police', name: 'Mumbai Station', phone: '022-0000-0001', jurisdiction: MUMBAI };
const MUM_CWC = { id: 'u_mum_cwc', role: 'cwc', name: 'Mumbai CWC', jurisdiction: MUMBAI };
const MAH_ADMIN = { id: 'u_mah', role: 'admin', name: 'Maharashtra State Desk', jurisdiction: { state: 'Maharashtra' } };
const SURAT_POLICE = { id: 'u_surat', role: 'police', name: 'Surat Station', jurisdiction: { state: 'Gujarat', district: 'Surat' } };
const PATNA_POLICE = { id: 'u_patna', role: 'police', name: 'Patna Station', jurisdiction: { state: 'Bihar', district: 'Patna' } };
const USERS = [AHD_POLICE, AHD_CWC, MUM_POLICE, MUM_CWC, MAH_ADMIN, SURAT_POLICE, PATNA_POLICE];

// A Mumbai sighting a strong match filed under the Ahmedabad case.
const SIGHTING = {
  id: 'f_m1', status: 'pending_review', personCategory: 'child', ageApprox: 14, gender: 'Female',
  ...AHMEDABAD, reportedLocation: { ...MUMBAI },
  foundLocation: 'Platform 4, Mumbai Central', geoAddress: 'Mumbai Central station, Mumbai', lat: 18.97, lng: 72.82,
  note: 'Alone, crying', reporterName: 'Passer-by', reporterPhone: '9111111111',
  photoFile: 'f_m1.jpg', matchedReportId: 'r_1', matchScore: 0.9,
  matchCandidates: [
    { reportId: 'r_1', score: 0.9, status: 'proposed' },
    { reportId: 'r_2', score: 0.8, status: 'proposed' },
  ],
  createdAt: Date.now(),
};

check('a Mumbai sighting of an Ahmedabad case is outside the case’s district', seenOutsideCaseDistrict(SIGHTING, CASE_AHD));
check('an Ahmedabad sighting of an Ahmedabad case is not', !seenOutsideCaseDistrict({ ...SIGHTING, reportedLocation: { ...AHMEDABAD } }, CASE_AHD));
check('"Ahmadabad" is the same district as "Ahmedabad"', !seenOutsideCaseDistrict({ ...SIGHTING, reportedLocation: { state: 'Gujarat', district: 'Ahmadabad' } }, CASE_AHD));
check('a sighting with no place is not called outside', !seenOutsideCaseDistrict({ ...SIGHTING, reportedLocation: {} }, CASE_AHD));
check('Mumbai police cannot open the linked sighting by the ordinary rules', scopeFoundReports(MUM_POLICE, [SIGHTING], [CASE_AHD]).length === 0);
check('nobody is asked yet', !canSeeLocalPoliceRequest(MUM_POLICE, SIGHTING));

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

function harness(initial = [SIGHTING], reports = [CASE_AHD, CASE_GROWN]) {
  const sightings = initial.map((row) => structuredClone(row));
  const cases = reports.map((row) => structuredClone(row));
  const audit = [];
  const notes = [];
  const { router, routes } = recorder();
  registerReportRoutes(router, {
    listReports: () => cases,
    listFoundReports: () => sightings,
    listUsers: () => USERS,
    addFoundReport: (row) => sightings.push(row),
    addActivity: () => {},
    addAudit: (row) => audit.push(row),
    addNotification: (row) => notes.push(row),
    savePhoto: async (key) => key,
    readPhoto: async (key) => (key === 'f_m1.jpg' ? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]) : null),
    photoMimeType: () => 'image/jpeg',
    findReport: (id) => cases.find((r) => r.id === id) || null,
    findFoundReport: (id) => sightings.find((s) => s.id === id) || null,
    addReport: () => {},
    updateReport: (id, patch) => {
      const row = cases.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return row;
    },
    updateFoundReport: (id, patch) => {
      const row = sightings.find((s) => s.id === id);
      if (row) Object.assign(row, patch);
      return row;
    },
    deletePhoto: async () => true,
    rewriteActivity: () => {},
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
  const handler = (method, path) => routes.find((r) => r.method === method && r.path === path)?.handler;
  return { sightings, cases, audit, notes, handler };
}

async function call(handler, { body = {}, params = {}, query = {}, user = null } = {}) {
  const req = { body, params, query, headers: {}, user };
  let status = 200;
  let payload = null;
  const res = {
    status(code) { status = code; return res; },
    json(data) { payload = data; return res; },
    type() { return res; },
    set() { return res; },
    send(data) { payload = data; return res; },
    end() { return res; },
  };
  await handler(req, res);
  return { status, payload };
}

// Asking for help.
{
  const h = harness();
  const ask = h.handler('POST', '/found/:id/local-police');
  check('the ask route exists', typeof ask === 'function');

  const notOwner = await call(ask, { params: { id: 'f_m1' }, user: MUM_POLICE });
  check('only the case’s officers can ask', notOwner.status === 403, `HTTP ${notOwner.status}`);

  const res = await call(ask, { params: { id: 'f_m1' }, body: { note: 'A scar on the left hand' }, user: AHD_POLICE });
  check('the case’s officer can ask the police where the child was seen', res.status === 200, `HTTP ${res.status} ${res.payload?.error || ''}`);
  check('it reports which desks were told', res.payload?.desksAlerted === 2 && /Mumbai, Maharashtra/.test(res.payload?.place || ''), JSON.stringify({ n: res.payload?.desksAlerted, place: res.payload?.place }));

  const told = h.notes.filter((n) => n.kind === 'local_police_request');
  const to = new Set(told.map((n) => n.userId));
  check('Mumbai police and the Maharashtra state desk are told', to.has('u_mum') && to.has('u_mah'), [...to].join(', '));
  check('no CWC, no other district and not the asker are told', !to.has('u_mum_cwc') && !to.has('u_surat') && !to.has('u_patna') && !to.has('u_ahd'));
  const body = told[0]?.body || '';
  check('the alert says where, who is asking and how to reach them', /Mumbai Central/.test(body) && /Ahmedabad Crime Branch/.test(body) && /079-0000-0001/.test(body), body);
  check('the alert names nobody', !/Asha|Parent/.test(body) && !/9000000001/.test(body));
  check('the alert says to take a child to the CWC', /Child Welfare Committee/.test(body));
  check('the request is audited', h.audit.some((a) => a.action === 'sighting.local_police_requested' && a.metadata?.desksAlerted === 2));

  const asked = h.sightings[0];
  check('Mumbai police may now open the sighting', canSeeLocalPoliceRequest(MUM_POLICE, asked));
  check('Mumbai CWC and Patna police still may not', !canSeeLocalPoliceRequest(MUM_CWC, asked) && !canSeeLocalPoliceRequest(PATNA_POLICE, asked));
  check('Mumbai police still cannot act on the match', scopeFoundReports(MUM_POLICE, [asked], h.cases).length === 0);

  const review = await call(h.handler('POST', '/found/:id/review'), { params: { id: 'f_m1' }, body: { decision: 'rejected' }, user: MUM_POLICE });
  check('Mumbai police cannot reject or confirm the match', review.status === 403, `HTTP ${review.status}`);

  const list = await call(h.handler('GET', '/found/local-police'), { user: MUM_POLICE });
  const request = list.payload?.requests?.[0];
  check('Mumbai police see the request', list.payload?.requests?.length === 1 && request?.id === 'f_m1');
  const text = JSON.stringify(request || {});
  check('they see the sighting, not the case', !/Asha|Parent Test|9000000001|matchedReport|matchCandidates|r_1/.test(text), text.slice(0, 200));
  check('they see the place, the photo and who is asking', request?.photoUrl === '/api/reports/photo/f_m1' && request?.localPolice?.requestedByName === 'Ahmedabad Crime Branch' && request?.localPolice?.contactPhone === '079-0000-0001');
  const ownList = await call(h.handler('GET', '/found/local-police'), { user: AHD_POLICE });
  check('the case’s own officers do not see it as a request to them', ownList.payload?.requests?.length === 0);
  const cwcList = await call(h.handler('GET', '/found/local-police'), { user: MUM_CWC });
  check('Mumbai CWC sees no request', cwcList.payload?.requests?.length === 0);

  const photo = h.handler('GET', '/photo/:key');
  const mumPhoto = await call(photo, { params: { key: 'f_m1' }, user: MUM_POLICE });
  check('Mumbai police can see the sighting’s photo', mumPhoto.status === 200, `HTTP ${mumPhoto.status}`);
  const cwcPhoto = await call(photo, { params: { key: 'f_m1' }, user: MUM_CWC });
  check('Mumbai CWC cannot', cwcPhoto.status === 403, `HTTP ${cwcPhoto.status}`);
  const casePhoto = await call(photo, { params: { key: 'r_1' }, user: MUM_POLICE });
  check('nor can Mumbai police see the case’s photo', casePhoto.status === 403, `HTTP ${casePhoto.status}`);

  // Answering.
  const reply = h.handler('POST', '/found/:id/local-police/reply');
  const stranger = await call(reply, { params: { id: 'f_m1' }, body: { outcome: 'found' }, user: PATNA_POLICE });
  check('police who were not asked cannot answer', stranger.status === 403, `HTTP ${stranger.status}`);
  const blank = await call(reply, { params: { id: 'f_m1' }, body: { outcome: 'update' }, user: MUM_POLICE });
  check('an update needs words', blank.status === 400);
  const before = h.notes.length;
  const found = await call(reply, { params: { id: 'f_m1' }, body: { outcome: 'found', note: 'With us at Mumbai Central; taking her to the CWC' }, user: MUM_POLICE });
  check('Mumbai police can answer that they found her', found.status === 200 && found.payload?.request?.localPolice?.replies?.length === 1, `HTTP ${found.status} ${found.payload?.error || ''}`);
  const back = h.notes.slice(before);
  check('the case’s officers are told at once', back.some((n) => n.userId === 'u_ahd' && n.priority === 'high' && /found/i.test(n.title)), JSON.stringify(back.map((n) => [n.userId, n.title])));
  check('nobody else is', back.every((n) => n.userId === 'u_ahd'));
  check('the answer is audited', h.audit.some((a) => a.action === 'sighting.local_police_replied' && a.metadata?.outcome === 'found'));

  // The link is decided: the request closes with it.
  h.sightings[0].matchedReportId = null;
  check('once the link is gone, the request is closed', !canSeeLocalPoliceRequest(MUM_POLICE, h.sightings[0]));
}

// A sighting in the case's own district: nothing to ask.
{
  const h = harness([{ ...SIGHTING, reportedLocation: { ...AHMEDABAD } }]);
  const res = await call(h.handler('POST', '/found/:id/local-police'), { params: { id: 'f_m1' }, user: AHD_POLICE });
  check('asking is refused for a sighting in the case’s own district', res.status === 409, `HTTP ${res.status}`);
}

// Seen somewhere with no police desk on Khozo: the officer is told to phone.
{
  const h = harness([{ ...SIGHTING, reportedLocation: { state: 'Assam', district: 'Kamrup Metropolitan' } }]);
  const res = await call(h.handler('POST', '/found/:id/local-police'), { params: { id: 'f_m1' }, user: AHD_POLICE });
  check('with no police desk there, nobody is alerted and the officer is told', res.status === 200 && res.payload?.desksAlerted === 0, `HTTP ${res.status} ${JSON.stringify(res.payload?.desksAlerted)}`);
}

// The possible-match alert names where the person was seen.
{
  const h = harness();
  const res = await call(h.handler('POST', '/found/:id/review'), { params: { id: 'f_m1' }, body: { decision: 'rejected' }, user: AHD_POLICE });
  check('rejecting moves the sighting to the next candidate', res.status === 200, `HTTP ${res.status} ${res.payload?.error || ''}`);
  const alert = h.notes.find((n) => n.kind === 'sighting_reported' && n.userId === 'u_ahd' && /Possible match/.test(n.title));
  const body = alert?.body || '';
  check('the next case’s officers are told it may match', Boolean(alert), JSON.stringify(h.notes.map((n) => n.title)));
  check('the alert names Mumbai, where the child was seen', /Mumbai/.test(body) && !/Ahmedabad, Gujarat/.test(body), body);
  check('and says it is outside their district', /outside your district/.test(body), body);
}

// The consent rule for someone who grew up while missing.
{
  const h = harness();
  const sms = await call(h.handler('POST', '/:id/send-sms'), { params: { id: 'r_2' }, body: {}, user: AHD_POLICE });
  check('no SMS to the family of a woman missing since childhood without her consent', sms.status === 409 && sms.payload?.code === 'person_consent_required', `HTTP ${sms.status} ${sms.payload?.code || sms.payload?.error || ''}`);
  const told = await call(h.handler('POST', '/:id/family-contacted'), { params: { id: 'r_2' }, body: { method: 'call' }, user: AHD_POLICE });
  check('nor a record that the family was told', told.status === 409, `HTTP ${told.status} ${told.payload?.error || ''}`);
  const child = await call(h.handler('POST', '/:id/send-sms'), { params: { id: 'r_1' }, body: {}, user: AHD_POLICE });
  check('a child’s family needs no such consent', child.payload?.code !== 'person_consent_required', `HTTP ${child.status} ${child.payload?.code || ''}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
