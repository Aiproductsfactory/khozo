/**
 * Checking CCTV footage against open cases (Khozo Desktop "mode 2",
 * shared/open-case-checks.js and the /api/reports/open-case-checks routes),
 * on both runtimes, with no real face and no network.
 *
 * Three local stand-ins: Aarakshak's gallery (the one-to-many index) and its
 * pairwise compare, and AWS Rekognition. Every photo carries a marker naming
 * the person in it, and each stand-in answers from the markers. The store is
 * seeded with 240 open cases in the face index, among them:
 *
 *   PLANT   the person in the footage, a case the Mumbai officer can open
 *   FAR     a case in Pune: in the officer's state, not the officer's district
 *   GUJ     a case in Gujarat: outside the officer's area altogether
 *   WEAK    Aarakshak scores the pair 0.40, under the bar's 0.45
 *   AWSLOW  AWS scores the pair 0.85, under the bar's 0.90
 *   CROWD   five other cases look more like the face to the index, so the
 *           case is sixth: outside the index's five closest
 *   NOIDX   not in the face index
 *   BOY     a man of 30, outside the officer's narrowing
 *   FOUND   a case already found
 *
 *   node scripts/open-case-checks-smoke.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPEN_CASE_BAR, clearsOpenCaseBar, leadIdFor, leadView, newOpenCaseCheck, openCaseArea, openCaseFiltersOf, openCasesFor, openCaseSettingsOf, shortlistOf,
} from '../shared/open-case-checks.js';
import { closedVideoJobPatch, videoJobView } from '../shared/video-jobs.js';
import { desktopPolicyOf, liveUntilOf, liveWatchProblem } from '../shared/desktop-policy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
};

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
const photo = (person) => Buffer.concat([TINY_PNG, Buffer.from(`KHOZO-OC-FACE:${person};`)]);
const personIn = (buffer) => /KHOZO-OC-FACE:([A-Za-z0-9_]+);/.exec(buffer.toString('latin1'))?.[1] || null;
const peopleIn = (buffer) => [...buffer.toString('latin1').matchAll(/KHOZO-OC-FACE:([A-Za-z0-9_]+);/g)].map((m) => m[1]);

// ---- The rules, without a server ---------------------------------------------

console.log('The rules');
{
  const settings = openCaseSettingsOf({});
  check('off unless switched on, district desks search their state, and the bar is the spec\'s', !settings.on && settings.area === 'state'
    && settings.bar.top === 5 && settings.bar.aarakshak === 0.45 && settings.bar.rekognition === 0.9);
  const on = openCaseSettingsOf({ openCases: 'on', openCasesArea: 'district', openCasesTop: '3', openCasesAarakshak: 'x', openCasesRekognition: '2' });
  check('a setting that is not a number in range keeps the spec\'s line', on.on && on.area === 'district' && on.bar.top === 3 && on.bar.aarakshak === 0.45 && on.bar.rekognition === 0.9);

  const mumbai = { id: 'u_m', role: 'police', jurisdiction: { state: 'Maharashtra', district: 'Mumbai' } };
  check('a district desk searches its state, or its district', openCaseArea(mumbai).kind === 'state' && openCaseArea(mumbai, 'district').district === 'Mumbai');
  check('the super admin searches the country', openCaseArea({ role: 'super_admin' }).kind === 'country');

  check('filters: a wrong sex, age or date is refused', [{ sex: 'x' }, { ageFrom: 'ten' }, { ageFrom: 12, ageTo: 8 }, { missingFrom: '12/03/2026' }].every((f) => openCaseFiltersOf(f).error));
  const { filters } = openCaseFiltersOf({ sex: 'female', ageFrom: '8', ageTo: '16', district: 'Mumbai', missingFrom: '2026-01-01' });
  check('filters: read as numbers and dates', filters.sex === 'female' && filters.ageFrom === 8 && filters.ageTo === 16 && filters.missingFrom === '2026-01-01');

  const indexed = { provider: 'aarakshak-gallery', status: 'enrolled' };
  const cases = [
    { id: 'a', status: 'missing', photoFile: 'a', state: 'Maharashtra', district: 'Mumbai', gender: 'female', age: 10, dateOfMissing: '2026-05-01', faceIndex: indexed },
    { id: 'b', status: 'missing', photoFile: 'b', state: 'Maharashtra', district: 'Pune', gender: 'male', age: 10, dateOfMissing: '2026-05-01', faceIndex: indexed },
    { id: 'c', status: 'missing', photoFile: 'c', state: 'Gujarat', district: 'Ahmedabad', gender: 'female', age: 10, faceIndex: indexed },
    { id: 'd', status: 'missing', photoFile: 'd', state: 'Maharashtra', district: 'Mumbai', faceIndex: indexed },
    { id: 'e', status: 'missing', photoFile: 'e', state: 'Maharashtra', district: 'Mumbai', gender: 'female', age: 10 },
    { id: 'f', status: 'found', photoFile: 'f', state: 'Maharashtra', district: 'Mumbai', faceIndex: indexed },
    { id: 'g', status: 'missing', state: 'Maharashtra', district: 'Mumbai', faceIndex: indexed },
  ];
  const all = openCasesFor({ user: mumbai, reports: cases, indexName: 'aarakshak-gallery' });
  check('the state\'s open cases with a photo, those in the index searched', all.open.map((r) => r.id).join() === 'a,b,d,e' && all.searched.map((r) => r.id).join() === 'a,b,d' && all.notInIndex === 1);
  const girls = openCasesFor({ user: mumbai, reports: cases, filters, indexName: 'aarakshak-gallery' });
  check('narrowed: a case that does not say its sex or age is kept', girls.searched.map((r) => r.id).join() === 'a,d');
  check('the district setting keeps to the district', openCasesFor({ user: mumbai, reports: cases, areaSetting: 'district', indexName: 'aarakshak-gallery' }).searched.map((r) => r.id).join() === 'a,d');
  check('a desk outside the police finds nothing', openCasesFor({ user: { role: 'cwc', jurisdiction: mumbai.jurisdiction }, reports: cases, indexName: 'aarakshak-gallery' }).searched.length === 0);

  const hits = ['x', 'a', 'y', 'b', 'd', 'z', 'q', 'r', 's', 't'].map((caseId, i) => ({ caseId, score: 1 - i / 20 }));
  const allowed = new Set(['a', 'b', 'd', 'q', 'r', 's', 't']);
  check('the shortlist is the five closest of the check\'s own cases, in the index\'s order', shortlistOf(hits, allowed).map((s) => `${s.caseId}${s.rank}`).join() === 'a1,b2,d3,q4,r5');
  check('the bar needs both engines, each above its line',
    clearsOpenCaseBar({ primaryScore: 0.45, secondOpinionScore: 0.9 }, OPEN_CASE_BAR)
    && !clearsOpenCaseBar({ primaryScore: 0.44, secondOpinionScore: 0.99 }, OPEN_CASE_BAR)
    && !clearsOpenCaseBar({ primaryScore: 0.9, secondOpinionScore: 0.89 }, OPEN_CASE_BAR)
    && !clearsOpenCaseBar({ primaryScore: 0.9, secondOpinionScore: null }, OPEN_CASE_BAR));
  check('a lead\'s name is the same every time, and differs by case', leadIdFor('vj_1', 'p1', 'a') === leadIdFor('vj_1', 'p1', 'a') && leadIdFor('vj_1', 'p1', 'a') !== leadIdFor('vj_1', 'p1', 'b'));

  const lead = { id: 'ld_x', fileKey: 0, faceKey: 'p1', t: 3, caseId: 'b', rank: 2, aarakshak: 0.7, rekognition: 0.98 };
  const outside = leadView(lead, cases[1], mumbai);
  check('a case the officer cannot open is never named, scored or described', outside.inScope === false && !JSON.stringify(outside).includes('"b"') && outside.aarakshak === undefined && outside.case === undefined);
  const inside = leadView({ ...lead, caseId: 'a' }, cases[0], mumbai, { decision: 'same', sightingId: 'f_1' });
  check('a case the officer can open comes with the case and the scores', inside.inScope && inside.case.id === 'a' && inside.aarakshak === 0.7 && inside.status === 'sent' && inside.sightingId === 'f_1');

  const job = newOpenCaseCheck({ id: 'vj_t1', user: { ...mumbai, name: 'PSI' }, body: { jobKey: 'k', device: 'LAPTOP-7' }, files: [], filters, area: openCaseArea(mumbai), searched: 2, bar: OPEN_CASE_BAR });
  job.leads = { ld_x: lead };
  job.decisions = { ld_x: { decision: 'same', fileKey: 0, t: 3, sightingId: 'f_hidden', byName: 'PSI', caseId: 'b' } };
  const view = videoJobView(job);
  check('a check against open cases has no case, and its view names no case and no sighting', view.mode === 'open_cases' && view.reportId === null && view.sightings.length === 0
    && view.decisions[0].sightingId === null && !JSON.stringify(view).includes('"b"') && view.device === 'LAPTOP-7' && view.openCases.casesSearched === 2 && view.openCases.leads === 1);
  const closed = closedVideoJobPatch(job);
  check('closing it keeps which case each lead was, without the scores', closed.leads.ld_x.caseId === 'b' && closed.leads.ld_x.aarakshak === undefined);

  const policyOff = desktopPolicyOf({});
  check('laptop answers and live watches are off unless switched on', !policyOff.laptopAnswers && !policyOff.liveWatch && policyOff.liveWatchHours === 12 && policyOff.laptopLine === 0.35);
  const policyOn = desktopPolicyOf({ laptopAnswers: 'on', liveWatch: 'yes', liveWatchHours: '4', laptopLine: '2' });
  check('the hours are read, and a line out of range keeps Aarakshak\'s 0.35', policyOn.laptopAnswers && policyOn.liveWatch && policyOn.liveWatchHours === 4 && policyOn.laptopLine === 0.35);
  check('a watch must end later than now and within the hours', liveUntilOf(new Date(Date.now() + 3600000).toISOString(), policyOn).until && liveUntilOf(new Date(Date.now() + 5 * 3600000).toISOString(), policyOn).error && liveUntilOf('soon', policyOn).error);
  const watchJob = { live: { until: new Date(Date.now() - 20 * 60000).toISOString() } };
  check('faces are refused 10 minutes after a watch ends, and while it is switched off', liveWatchProblem(watchJob, policyOn)?.code === 'live_ended'
    && liveWatchProblem({ live: { until: new Date(Date.now() - 5 * 60000).toISOString() } }, policyOn) === null && liveWatchProblem(watchJob, policyOff)?.code === 'live_off' && liveWatchProblem({}, policyOff) === null);
}

// ---- The stand-ins -----------------------------------------------------------

const gallery = new Map(); // case id -> person
const lookalikes = new Map(); // case id -> the person it looks more like than their own case does
const calls = { search: 0, compare: 0, rekognition: 0 };
const AARAKSHAK = { WEAK: 0.4 };
const AWS = { AWSLOW: 85 };
const hashScore = (text) => {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return 0.05 + (h / 1000) * 0.35;
};

const standIn = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const send = (status, data, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(data));
    };
    // AWS Rekognition CompareFaces.
    if (String(req.headers['x-amz-target'] || '').includes('CompareFaces')) {
      calls.rekognition += 1;
      const json = JSON.parse(body.toString('utf8'));
      const [a] = peopleIn(Buffer.from(json.SourceImage?.Bytes || '', 'base64'));
      const [b] = peopleIn(Buffer.from(json.TargetImage?.Bytes || '', 'base64'));
      if (!a || !b) return send(400, { __type: 'InvalidParameterException', message: 'There are no faces in the image.' }, { 'x-amzn-errortype': 'InvalidParameterException:' });
      const box = { Width: 0.5, Height: 0.5, Left: 0.25, Top: 0.25 };
      const similarity = a === b ? AWS[a] ?? 97 : 0;
      return send(200, { SourceImageFace: { BoundingBox: box, Confidence: 99 }, FaceMatches: similarity ? [{ Similarity: similarity, Face: { BoundingBox: box } }] : [], UnmatchedFaces: similarity ? [] : [{ BoundingBox: box }] });
    }
    if (req.headers['x-api-key'] !== 'oc-key') return send(401, { detail: 'invalid api key' });
    // Aarakshak's pairwise compare.
    if (req.url.startsWith('/api/v1/compare')) {
      calls.compare += 1;
      const people = peopleIn(body);
      if (people.length < 2) return send(422, { detail: 'No detectable face in one of the images' });
      const same = people[0] === people[1];
      const score = same ? AARAKSHAK[people[0]] ?? 0.9 : 0.02;
      return send(200, { score, decision_band: score >= 0.35 ? 'match' : 'no_match', source_faces: [{}], target_faces: [{}], source_quality_score: 0.9, target_quality_score: 0.9 });
    }
    // Aarakshak's gallery (v2).
    if (req.url === '/api/v2/gallery') return send(200, { gallery_id: 'oc-smoke', case_count: gallery.size, face_count: gallery.size });
    if (req.url === '/api/v2/search' && req.method === 'POST') {
      calls.search += 1;
      const probe = personIn(body);
      if (!probe) return send(200, { faces: [] });
      const topK = Number(/name="top_k"\r\n\r\n(\d+)/.exec(body.toString('latin1'))?.[1] || 50);
      const matches = [...gallery].map(([caseId, person]) => ({
        case_id: caseId,
        score: lookalikes.get(caseId) === probe ? 0.9 : person === probe ? 0.85 : hashScore(`${probe}|${caseId}`),
      })).sort((x, y) => y.score - x.score).slice(0, topK);
      return send(200, { faces: [{ matches }] });
    }
    if (req.url === '/api/v2/cases' && req.method === 'POST') {
      const id = /name="case_id"\r\n\r\n([^\r]+)/.exec(body.toString('latin1'))?.[1];
      const person = personIn(body);
      if (id && person) gallery.set(id, person);
      return send(201, { faces_enrolled: person ? 1 : 0, photos: [{ status: person ? 'enrolled' : 'no_face', photo_index: 0 }] });
    }
    if (req.method === 'DELETE' && req.url.startsWith('/api/v2/cases/')) {
      gallery.delete(decodeURIComponent(req.url.slice('/api/v2/cases/'.length)));
      return send(200, { faces_deleted: 1 });
    }
    return send(404, { detail: 'not here' });
  });
});
await new Promise((resolve) => standIn.listen(0, '127.0.0.1', resolve));
const standInUrl = `http://127.0.0.1:${standIn.address().port}`;

// ---- The cases ---------------------------------------------------------------

const DAY = 86400000;
const enrolled = { provider: 'aarakshak-gallery', status: 'enrolled', at: new Date(Date.now() - 30 * DAY).toISOString() };
const caseRow = (id, person, extra = {}) => ({
  id,
  childName: `Case ${person}`,
  personCategory: 'child',
  status: 'missing',
  gender: 'female',
  age: 11,
  dateOfMissing: '2026-06-01',
  state: 'Maharashtra',
  district: 'Mumbai',
  photoFile: `${id}.png`,
  visibility: 'police',
  intakeStatus: 'verified',
  registeredByRole: 'police',
  faceIndex: enrolled,
  createdAt: Date.now() - 100 * DAY,
  ...extra,
});
const PLANTED = [
  caseRow('r_oc_plant', 'PLANT'),
  caseRow('r_oc_far', 'FAR', { district: 'Pune' }),
  caseRow('r_oc_guj', 'GUJ', { state: 'Gujarat', district: 'Ahmedabad' }),
  caseRow('r_oc_weak', 'WEAK'),
  caseRow('r_oc_awslow', 'AWSLOW'),
  caseRow('r_oc_crowd', 'CROWD'),
  ...[1, 2, 3, 4, 5].map((n) => caseRow(`r_oc_decoy${n}`, `DECOY${n}`)),
  caseRow('r_oc_noidx', 'NOIDX', { faceIndex: null }),
  caseRow('r_oc_boy', 'BOY', { gender: 'male', age: 30 }),
  caseRow('r_oc_found', 'FOUND', { status: 'found' }),
  // A found child: the desktop's "Find this person" may start from its photo (scenario 5).
  caseRow('r_oc_foundchild', 'FCHILD', { caseOrigin: 'found_child_intake', status: 'under_review', faceIndex: null }),
];
const DISTRICTS = ['Mumbai', 'Pune', 'Thane', 'Nagpur', 'Nashik'];
const FILLERS = Array.from({ length: 226 }, (_, i) => caseRow(`r_oc_f${String(i).padStart(3, '0')}`, `F${i}`, { district: DISTRICTS[i % DISTRICTS.length], gender: i % 10 ? 'female' : 'male', age: 6 + (i % 12) }));
const CASES = [...PLANTED, ...FILLERS];
const inMaharashtraIndex = CASES.filter((r) => r.state === 'Maharashtra' && r.faceIndex && r.status === 'missing').length;

function seedGallery() {
  gallery.clear();
  for (const r of CASES) if (r.faceIndex) gallery.set(r.id, r.childName.slice(5));
  for (let n = 1; n <= 5; n += 1) lookalikes.set(`r_oc_decoy${n}`, 'CROWD');
}

// ---- The runtimes ------------------------------------------------------------

const RUNTIMES = {
  express: { entry: 'src/index.js', cwd: path.join(root, 'server') },
  worker: { entry: 'scripts/worker-shim-server.mjs', cwd: root },
};
let base = '';

async function request(method, route, { token, body, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${route}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function start(runtime, dataDir, port, env = {}) {
  const child = spawn(process.execPath, [runtime.entry], {
    cwd: runtime.cwd,
    env: {
      ...process.env,
      DATABASE_URL: '',
      KHOZO_DATA_DIR: dataDir,
      PORT: String(port),
      KHOZO_LOGIN_LIMIT: '200',
      KHOZO_DESKTOP_JOB_FACES: '30',
      AARAKSHAK_API_URL: `${standInUrl}/api/v1/compare`,
      AARAKSHAK_API_KEY: 'oc-key',
      AARAKSHAK_TIMEOUT_MS: '5000',
      AARAKSHAK_GALLERY_URL: standInUrl,
      AARAKSHAK_GALLERY_KEY: 'oc-key',
      AWS_ACCESS_KEY_ID: 'AKIAOPENCASESMOKE',
      AWS_SECRET_ACCESS_KEY: 'open-case-secret',
      AWS_REGION: 'ap-south-1',
      AWS_MAX_ATTEMPTS: '1',
      KHOZO_REKOGNITION_ENDPOINT: standInUrl,
      KHOZO_DESKTOP_OPEN_CASES: 'on',
      KHOZO_DESKTOP_LAPTOP_ANSWERS: 'on',
      KHOZO_DESKTOP_LIVE_WATCH: 'on',
      KHOZO_DESKTOP_LIVE_WATCH_HOURS: '6',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (buf) => { if (process.env.SMOKE_VERBOSE) process.stderr.write(`[api] ${buf}`); });
  child.stdout.on('data', (buf) => { if (process.env.SMOKE_VERBOSE) process.stdout.write(`[api] ${buf}`); });
  return child;
}

async function waitFor(child) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  child.kill();
  throw new Error('The API did not start');
}

const stop = (child) => new Promise((resolve) => {
  if (child.exitCode != null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

const login = async (email) => (await request('POST', '/auth/login', { body: { email, password: 'khozo123' } })).data.token;

function faceForm(person, { fileKey = 0, key, t = 12.5 } = {}) {
  const form = new FormData();
  if (person !== undefined) form.append('photo', new File([person ? photo(person) : TINY_PNG], 'face.png', { type: 'image/png' }));
  form.append('fileKey', String(fileKey));
  form.append('key', key);
  form.append('t', String(t));
  return form;
}

function leadForm(decision, person) {
  const form = new FormData();
  form.append('decision', decision);
  if (person) {
    form.append('photo', new File([photo(person)], 'face.png', { type: 'image/png' }));
    form.append('extraPhotos', new File([TINY_PNG], 'frame.png', { type: 'image/png' }));
  }
  form.append('seenAt', '2026-10-20T09:00:12.500Z');
  return form;
}

async function runOn(name, runtime, port) {
  console.log(`\n${name}`);
  base = `http://127.0.0.1:${port}/api`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `khozo-open-cases-${name}-`));
  try {
    // Seeded once by the server, then given the open cases, their photos and two more officers.
    let child = start(runtime, dataDir, port);
    await waitFor(child);
    await stop(child);
    const dbFile = path.join(dataDir, 'db.json');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const police = db.users.find((u) => u.email === 'police@khozo.org');
    db.users.push(
      { ...police, id: 'u_pune', name: 'PSI Pune Desk', email: 'pune.police@khozo.org', jurisdiction: { level: 'district', state: 'Maharashtra', district: 'Pune', station: null } },
      { ...police, id: 'u_guj', name: 'PSI Ahmedabad Desk', email: 'guj.police@khozo.org', jurisdiction: { level: 'district', state: 'Gujarat', district: 'Ahmedabad', station: null } },
    );
    db.reports.push(...CASES);
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    for (const r of CASES) fs.writeFileSync(path.join(dataDir, 'uploads', r.photoFile), photo(r.childName.slice(5)));
    fs.writeFileSync(dbFile, JSON.stringify(db));
    seedGallery();
    child = start(runtime, dataDir, port);
    await waitFor(child);

    const mumbai = await login('police@khozo.org');
    const pune = await login('pune.police@khozo.org');
    const guj = await login('guj.police@khozo.org');
    const superAdmin = await login('superadmin@khozo.org');
    const cwc = await login('cwc@khozo.org');

    // F15: how many cases.
    const all = await request('GET', '/reports/open-case-checks/cases', { token: mumbai });
    check('the screen can say how many open cases a check searches', all.status === 200 && all.data.enabled && all.data.cases === inMaharashtraIndex && all.data.area.kind === 'state' && all.data.notInIndex >= 1, JSON.stringify(all.data));
    const narrowed = await request('GET', '/reports/open-case-checks/cases?sex=female&ageFrom=8&ageTo=14', { token: mumbai });
    check('narrowing by sex and age searches fewer', narrowed.data.cases > 0 && narrowed.data.cases < all.data.cases, `${narrowed.data.cases} of ${all.data.cases}`);
    check('a narrowing that makes no sense is refused', (await request('GET', '/reports/open-case-checks/cases?ageFrom=20&ageTo=10', { token: mumbai })).status === 400);
    check('a desk outside the police cannot ask', (await request('GET', '/reports/open-case-checks/cases', { token: cwc })).status === 403);
    check('the super admin searches the whole country', (await request('GET', '/reports/open-case-checks/cases', { token: superAdmin })).data.area?.kind === 'country');

    // Starting.
    const files = JSON.stringify([{ key: 0, name: 'cst-gate2.mp4', bytes: 5e9, seconds: 36000, cameraPlace: 'CSMT station, gate 2', lat: 18.9398, lng: 72.8355, recordedFrom: '2026-10-20T09:00:00.000Z' }]);
    const body = { jobKey: 'oc_job_1', appVersion: '0.3.0', device: 'PS-POWAI-LAPTOP2', files, sex: 'female', ageFrom: 6, ageTo: 17 };
    const started = await request('POST', '/reports/open-case-checks', { token: mumbai, body });
    const job = started.data.job;
    check('a check against open cases starts, with no case, and says how many cases it searches', started.status === 201 && job.mode === 'open_cases' && job.reportId === null && job.openCases.casesSearched > 200 && job.device === 'PS-POWAI-LAPTOP2', JSON.stringify({ status: started.status, openCases: job?.openCases, device: job?.device }));
    const again = await request('POST', '/reports/open-case-checks', { token: mumbai, body });
    check('a start sent twice gives back the same check', again.data.repeated && again.data.job.id === job.id);
    check('a narrowing that leaves no case is refused', (await request('POST', '/reports/open-case-checks', { token: mumbai, body: { ...body, jobKey: 'oc_job_none', ageFrom: 100, ageTo: 110 } })).data.code === 'no_cases');

    // F16: each face.
    const face = (person, key, token = mumbai) => request('POST', `/reports/open-case-checks/${job.id}/faces`, { token, form: faceForm(person, { key }) });
    const plant = await face('PLANT', 'p_plant');
    const plantLead = plant.data.leads?.[0];
    check('T2.1: the planted case is found among more than 200 open cases', plant.status === 200 && plant.data.verdict === 'likely' && plant.data.leads.length === 1 && plantLead.inScope && plantLead.case.id === 'r_oc_plant' && plantLead.rank === 1, JSON.stringify(plant.data));
    check('the officer is shown the case, its age and both engines\' scores', plantLead?.case?.name === 'Case PLANT' && plantLead.aarakshak === 0.9 && plantLead.rekognition === 0.97);
    const far = await face('FAR', 'p_far');
    const farLead = far.data.leads?.[0];
    check('T2.2: a case outside the officer\'s district is a lead with nothing that says which case', far.data.verdict === 'likely' && farLead && farLead.inScope === false
      && !JSON.stringify(far.data).includes('r_oc_far') && !JSON.stringify(far.data).includes('Case FAR') && farLead.aarakshak === undefined, JSON.stringify(far.data));
    const farAgain = (await face('FAR', 'p_far2')).data.leads?.[0];
    check('two faces close to the same case outside the area share a name for it that is not the case', farAgain && farAgain.caseKey === farLead.caseKey && /^oc_/.test(farLead.caseKey) && !farLead.caseKey.includes('r_oc'));
    check('a case outside the officer\'s state is not searched', (await face('GUJ', 'p_guj')).data.verdict === 'unlikely');
    check('Aarakshak under 0.45: not shown', (await face('WEAK', 'p_weak')).data.leads?.length === 0);
    check('AWS under 0.90: not shown', (await face('AWSLOW', 'p_awslow')).data.leads?.length === 0);
    const crowd = await face('CROWD', 'p_crowd');
    check('a case sixth in the index\'s order is not shown, even if both engines agree', crowd.data.verdict === 'unlikely' && crowd.data.leads.length === 0, JSON.stringify(crowd.data));
    check('a case not in the index is not shown', (await face('NOIDX', 'p_noidx')).data.leads?.length === 0);
    check('a case outside the narrowing is not shown', (await face('BOY', 'p_boy')).data.leads?.length === 0);
    check('a case already found is not shown', (await face('FOUND', 'p_found')).data.leads?.length === 0);
    const searchesBefore = calls.search;
    const noFace = await face('', 'p_noface');
    check('a face the index cannot read is "no answer", not kept, and asked again next time', noFace.data.verdict === 'no_answer' && (await face('', 'p_noface')).data.verdict === 'no_answer' && calls.search === searchesBefore + 2);
    const repeat = await face('PLANT', 'p_plant');
    check('a face sent again is answered from the record, not searched again', repeat.data.repeated && repeat.data.leads[0].id === plantLead.id && calls.search === searchesBefore + 2);
    check('only the officer who started the check can add to it', (await face('PLANT', 'p_other', pune)).status === 403);
    check('a face needs its picture', (await request('POST', `/reports/open-case-checks/${job.id}/faces`, { token: mumbai, form: faceForm(undefined, { key: 'p_nopic' }) })).status === 400);

    // F17: sending.
    const send = (lead, decision, person) => request('POST', `/reports/open-case-checks/${job.id}/leads/${lead.id}`, { token: mumbai, form: leadForm(decision, person) });
    const sent = await send(plantLead, 'same', 'PLANT');
    check('"Send to that case" makes a sighting of the case the officer can open', sent.status === 201 && sent.data.lead.status === 'sent' && sent.data.lead.sightingId, JSON.stringify(sent.data));
    const sentFar = await send(farLead, 'same', 'FAR');
    check('T2.2: sending to a case outside the district says only "sent"', sentFar.status === 201 && sentFar.data.lead.status === 'sent' && !sentFar.data.lead.sightingId && !JSON.stringify(sentFar.data).includes('r_oc_far'), JSON.stringify(sentFar.data));
    check('a face sent cannot be taken back from the laptop', (await send(farLead, 'not')).data.code === 'already_sighting');
    check('sending twice makes one sighting', (await send(plantLead, 'same', 'PLANT')).data.repeated === true);

    const punes = await request('GET', '/reports/found/all', { token: pune });
    const farSighting = (punes.data.foundReports || punes.data.reports || punes.data || []).find?.((f) => f.matchedReportId === 'r_oc_far');
    check('T2.2: the Pune case\'s officers have the sighting, waiting for their review', farSighting && farSighting.status === 'pending_review' && /cannot open this case/.test(farSighting.note || ''), JSON.stringify(punes.data).slice(0, 300));
    const mumbais = await request('GET', '/reports/found/all', { token: mumbai });
    const mumbaiRows = mumbais.data.foundReports || mumbais.data.reports || mumbais.data || [];
    check('the Mumbai officer sees the sighting of their own case, and not the Pune one', mumbaiRows.some?.((f) => f.matchedReportId === 'r_oc_plant') && !mumbaiRows.some?.((f) => f.matchedReportId === 'r_oc_far'));
    const puneInbox = await request('GET', '/dashboard/notifications', { token: pune });
    const inbox = puneInbox.data.notifications || puneInbox.data || [];
    check('T2.2: the Pune case\'s officers are told', inbox.some?.((n) => /found a face close to this person/.test(n.body || '')), JSON.stringify(puneInbox.data).slice(0, 300));
    const gujInbox = await request('GET', '/dashboard/notifications', { token: guj });
    check('and no officer elsewhere is', !(gujInbox.data.notifications || []).some((n) => /found a face close to this person/.test(n.body || '')));

    // Progress, the command centre, closing.
    const done = await request('POST', `/reports/open-case-checks/${job.id}/progress`, { token: mumbai, body: { status: 'done', files: JSON.stringify([{ key: 0, secondsRead: 36000, peopleSeen: 410, state: 'done', sha256: 'e'.repeat(64) }]) } });
    check('progress is kept', done.data.job?.progressStatus === 'done' && done.data.job.hours === 10);
    const centre = await request('GET', '/dashboard/video-checks', { token: mumbai });
    const listed = centre.data.recent?.find((j) => j.id === job.id);
    check('the command centre counts the check, by the officer\'s own district', listed && listed.mode === 'open_cases' && listed.confirmed === 2 && listed.openCases.leads === 3 && centre.data.totals.cases >= 0
      && !JSON.stringify(listed).includes('r_oc_far') && listed.decisions.every((d) => d.sightingId === null), JSON.stringify(listed).slice(0, 300));
    const gujCentre = await request('GET', '/dashboard/video-checks', { token: guj });
    check('and a desk elsewhere does not see it', !gujCentre.data.recent?.some((j) => j.id === job.id));
    const closed = await request('POST', `/reports/open-case-checks/${job.id}/close`, { token: mumbai, body: {} });
    check('closing keeps the record', closed.data.job?.status === 'closed');
    check('a closed check takes no more faces', (await face('PLANT', 'p_late')).data.code === 'closed');
    const stored = JSON.parse(fs.readFileSync(dbFile, 'utf8')).videoJobs.find((j) => j.id === job.id);
    check('a closed check keeps no scores', stored && Object.values(stored.leads).every((l) => l.aarakshak === undefined && l.rekognition === undefined && l.caseId));

    // The audit: one row on each case a face was close to; none of them on the officer's own rows.
    const audit = JSON.parse(fs.readFileSync(dbFile, 'utf8')).audit;
    const onFar = audit.filter((a) => a.targetId === 'r_oc_far' && a.action === 'case.video_open_case_lead');
    check('each face close to a case has its own audit row on that case, in its district', onFar.length === 2 && onFar.every((a) => a.scope.district === 'Pune'));
    check('the officer\'s own rows never name a case', audit.filter((a) => a.action === 'video.open_case_searched').every((a) => !JSON.stringify(a).includes('r_oc_')) && audit.some((a) => a.action === 'video.open_case_searched'));
    check('the sending is audited on the case', audit.some((a) => a.action === 'sighting.video_open_case_sent' && a.scope.reportId === 'r_oc_far'));

    // The face budget (KHOZO_DESKTOP_JOB_FACES=30 here).
    const second = (await request('POST', '/reports/open-case-checks', { token: mumbai, body: { ...body, jobKey: 'oc_job_2' } })).data.job;
    let refusal = null;
    for (let i = 0; i < 32 && !refusal; i += 1) {
      const r = await request('POST', `/reports/open-case-checks/${second.id}/faces`, { token: mumbai, form: faceForm(`F${i}`, { key: `b${i}` }) });
      if (r.status !== 200) refusal = r;
    }
    check('a check stops at its face budget', refusal?.data?.code === 'face_budget', JSON.stringify(refusal?.data));

    // Scenario 5: a found child's photo is the probe for "Find this person", from the desktop only.
    const childJob = await request('POST', '/reports/r_oc_foundchild/video-jobs', { token: mumbai, body: { jobKey: 'fc_1', device: 'PS-POWAI-LAPTOP2', files } });
    check('scenario 5: the desktop may check footage for a found child', childJob.status === 201, JSON.stringify(childJob.data));
    const browser = new FormData();
    browser.append('photo', new File([photo('FCHILD')], 'face.png', { type: 'image/png' }));
    check('the browser\'s short check still may not', (await request('POST', '/reports/r_oc_foundchild/video-search', { token: mumbai, form: browser })).status === 409);

    // T2.5 and T2.6: a second officer, and two laptops, on one case.
    const one = (await request('POST', '/reports/r_oc_plant/video-jobs', { token: mumbai, body: { jobKey: 'l1', device: 'LAPTOP-A', files } })).data.job;
    const sjpu = await login('sjpu@khozo.org');
    const two = (await request('POST', '/reports/r_oc_plant/video-jobs', { token: sjpu, body: { jobKey: 'l2', device: 'LAPTOP-B', files } })).data.job;
    const faces = new FormData();
    faces.append('photo', new File([photo('PLANT')], 'face.png', { type: 'image/png' }));
    faces.append('fileKey', '0');
    faces.append('batch', 'b1');
    faces.append('keys', 'k1');
    faces.append('times', '42');
    await request('POST', `/reports/r_oc_plant/video-jobs/${one.id}/faces`, { token: mumbai, form: faces });
    const decide = new FormData();
    decide.append('key', 'k1');
    decide.append('decision', 'not');
    decide.append('fileKey', '0');
    decide.append('t', '42');
    await request('POST', `/reports/r_oc_plant/video-jobs/${one.id}/decisions`, { token: mumbai, form: decide });
    const auditBefore = JSON.parse(fs.readFileSync(dbFile, 'utf8')).audit.filter((a) => a.action === 'case.video_jobs_viewed').length;
    const review = await request('GET', '/reports/r_oc_plant/video-jobs', { token: sjpu });
    const mine = review.data.jobs?.find((j) => j.id === one.id);
    check('T2.5: a second officer sees every decision and who made it', mine?.decisions?.[0]?.markedBy === 'PSI R. Kamble' && mine.decisions[0].decision === 'not' && mine.decisions[0].seenAt === '2026-10-20T09:00:42.000Z', JSON.stringify(mine?.decisions));
    check('T2.6: two laptops on one case each show their laptop and officer', review.data.jobs?.some((j) => j.id === two.id && j.device === 'LAPTOP-B' && j.createdByName) && mine.device === 'LAPTOP-A');
    const auditAfter = JSON.parse(fs.readFileSync(dbFile, 'utf8')).audit.filter((a) => a.action === 'case.video_jobs_viewed');
    check('opening a case\'s checks is audited', auditAfter.length === auditBefore + 1 && auditAfter.some((a) => a.targetId === 'r_oc_plant'));

    // T2.3: moments from three cameras, marked out of order, on the route in time order.
    const three = JSON.stringify([
      { key: 0, name: 'gate.mp4', seconds: 600, cameraPlace: 'Gate camera', lat: 18.94, lng: 72.83, recordedFrom: '2026-10-20T10:00:00.000Z' },
      { key: 1, name: 'bus.mp4', seconds: 600, cameraPlace: 'Bus stand camera', lat: 18.96, lng: 72.84, recordedFrom: '2026-10-20T11:00:00.000Z' },
      { key: 2, name: 'market.mp4', seconds: 600, cameraPlace: 'Market camera', recordedFrom: '2026-10-20T09:30:00.000Z' },
    ]);
    const route = (await request('POST', '/reports/r_oc_plant/video-jobs', { token: mumbai, body: { jobKey: 'route1', device: 'LAPTOP-A', files: three } })).data.job;
    for (const [fileKey, t] of [[1, 30], [2, 90], [0, 300]]) {
      const same = new FormData();
      same.append('key', `m${fileKey}`);
      same.append('decision', 'same');
      same.append('fileKey', String(fileKey));
      same.append('t', String(t));
      same.append('photo', new File([photo('PLANT')], 'face.png', { type: 'image/png' }));
      // eslint-disable-next-line no-await-in-loop
      await request('POST', `/reports/r_oc_plant/video-jobs/${route.id}/decisions`, { token: mumbai, form: same });
    }
    const onRoute = (await request('GET', '/reports/r_oc_plant/video-jobs', { token: sjpu })).data.route || [];
    const fromChecks = onRoute.filter((m) => !m.fromOpenCases).map((m) => m.cameraPlace);
    check('T2.3: moments from three cameras are on the route in time order', fromChecks.join() === 'Market camera,Gate camera,Bus stand camera'
      && onRoute.find((m) => m.cameraPlace === 'Gate camera')?.lat === 18.94 && onRoute.every((m) => m.sightingId), JSON.stringify(onRoute.map((m) => [m.cameraPlace, m.seenAt])));
    check('a face another district sent from a check against open cases is on the route too', onRoute.some((m) => m.fromOpenCases && m.cameraPlace === 'CSMT station, gate 2'));

    // Phase 3: what the app may do beyond one case's videos (shared/desktop-policy.js).
    const version = await request('GET', '/dashboard/desktop-version', { token: mumbai });
    check('Khozo tells the app it may give laptop answers and watch a live camera, and for how long', version.data.policy?.laptopAnswers === true && version.data.policy.liveWatch === true
      && version.data.policy.liveWatchHours === 6 && version.data.policy.laptopLine === 0.35, JSON.stringify(version.data.policy));
    const liveFiles = JSON.stringify([{ key: 0, name: 'Live camera', cameraPlace: 'CSMT station, platform 4 (live)', lat: 18.94, lng: 72.83, recordedFrom: new Date().toISOString(), live: true }]);
    const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
    const startLive = (body) => request('POST', '/reports/r_oc_plant/video-jobs', { token: mumbai, body: { device: 'PS-POWAI-LAPTOP2', files: liveFiles, ...body } });
    const watch = await startLive({ jobKey: 'live_1', liveUntil: inHours(2), keepsTemplate: 'yes' });
    check('a live watch starts for one case, until a set time, and says the laptop keeps the case\'s signatures', watch.status === 201 && watch.data.job.live?.until && watch.data.job.videos[0].live === true
      && watch.data.job.laptopTemplate?.kept === true && watch.data.job.laptopTemplate.deletedAt === null, JSON.stringify(watch.data).slice(0, 300));
    check('a watch longer than the allowed hours is refused', (await startLive({ jobKey: 'live_2', liveUntil: inHours(7) })).status === 400);
    check('a watch that ends before now is refused', (await startLive({ jobKey: 'live_3', liveUntil: inHours(-1) })).status === 400);
    const twoCameras = JSON.stringify([JSON.parse(liveFiles)[0], { ...JSON.parse(liveFiles)[0], key: 1 }]);
    check('a watch is of one camera', (await startLive({ jobKey: 'live_4', liveUntil: inHours(1), files: twoCameras })).status === 400);
    check('a live camera is never watched against every open case', (await request('POST', '/reports/open-case-checks', { token: mumbai, body: { ...body, jobKey: 'oc_live', files: liveFiles } })).data.code === 'live_one_case');
    const liveFace = new FormData();
    liveFace.append('photo', new File([photo('PLANT')], 'face.png', { type: 'image/png' }));
    liveFace.append('fileKey', '0');
    liveFace.append('batch', 'w1');
    liveFace.append('keys', '0:w0-t1');
    liveFace.append('times', '12.0');
    const liveAnswer = await request('POST', `/reports/r_oc_plant/video-jobs/${watch.data.job.id}/faces`, { token: mumbai, form: liveFace });
    check('a face from the live camera is compared with the case, as from a video', liveAnswer.status === 200 && liveAnswer.data.results?.[0]?.verdict === 'likely', JSON.stringify(liveAnswer.data));
    const deletedAt = new Date().toISOString();
    const closedWatch = await request('POST', `/reports/r_oc_plant/video-jobs/${watch.data.job.id}/close`, { token: mumbai, body: { templateDeletedAt: deletedAt } });
    check('T3.2: closing the watch records when the laptop deleted the case\'s signatures', closedWatch.data.job?.laptopTemplate?.deletedAt === deletedAt, JSON.stringify(closedWatch.data.job?.laptopTemplate));
    const watchReport = await request('GET', `/reports/r_oc_plant/video-jobs/${watch.data.job.id}/report`, { token: mumbai });
    check('… and the court report says so, with the watch\'s times', watchReport.data.check?.caseTemplateOnLaptop?.deletedAt === deletedAt && watchReport.data.check?.live?.until === watch.data.job.live.until);
    const liveAudit = JSON.parse(fs.readFileSync(dbFile, 'utf8')).audit;
    check('starting a live watch is audited as such, with its end', liveAudit.some((a) => a.action === 'case.live_watch_started' && a.metadata?.live?.until === watch.data.job.live.until && a.scope.reportId === 'r_oc_plant'));

    await stop(child);

    // Switched off.
    child = start(runtime, dataDir, port, { KHOZO_DESKTOP_OPEN_CASES: '', KHOZO_DESKTOP_LAPTOP_ANSWERS: '', KHOZO_DESKTOP_LIVE_WATCH: '' });
    await waitFor(child);
    const token = await login('police@khozo.org');
    const off = await request('GET', '/reports/open-case-checks/cases', { token });
    check('switched off, the app is told so and nothing starts', off.data.enabled === false && off.data.reason === 'off'
      && (await request('POST', '/reports/open-case-checks', { token, body: { ...body, jobKey: 'oc_off' } })).status === 403);
    const offPolicy = (await request('GET', '/dashboard/desktop-version', { token })).data.policy;
    check('without the switches, no laptop answers and no live watch', offPolicy && offPolicy.laptopAnswers === false && offPolicy.liveWatch === false);
    check('a live watch is refused while it is switched off', (await request('POST', '/reports/r_oc_plant/video-jobs', { token, body: { jobKey: 'live_off', files: JSON.stringify([{ key: 0, cameraPlace: 'A camera (live)', live: true }]), liveUntil: new Date(Date.now() + 3600000).toISOString() } })).data.code === 'live_off');
    await stop(child);

    // No second engine: the bar cannot be met, so it does not run.
    child = start(runtime, dataDir, port, { AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' });
    await waitFor(child);
    const noAws = await request('GET', '/reports/open-case-checks/cases', { token: await login('police@khozo.org') });
    check('without AWS the bar cannot be met, and the app is told why', noAws.data.enabled === false && noAws.data.reason === 'engines');
    await stop(child);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

let port = 4870;
for (const [name, runtime] of Object.entries(RUNTIMES)) {
  // eslint-disable-next-line no-await-in-loop
  await runOn(name === 'express' ? 'The Node build' : 'The Worker\'s routes', runtime, port);
  port += 1;
}
standIn.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}`);
  process.exit(1);
}
console.log('Open-case check tests passed.');
