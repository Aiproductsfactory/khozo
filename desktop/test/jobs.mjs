/**
 * Checks Khozo Desktop's jobs (app/jobs.js) with the real scan worker, run
 * as a child process, and a stand-in for Khozo:
 *
 * - a job reads its video and finishes; its record and pictures on disk are
 *   encrypted;
 * - a job paused part-way carries on from where it stopped;
 * - the time window in clock time, and the note "Same person" adds to a case;
 * - the role list matches Khozo's, and every screen word is in Hindi and Gujarati;
 * - Khozo's record of a check: made once, told where the check stopped, the
 *   officer's decisions sent (the face and the frame for "Same person", no
 *   picture for "Not this person"), kept on the laptop while Khozo cannot be
 *   reached and sent once when it can, closed when the job is deleted; and on
 *   a Khozo without check records, "Same person" as a case note.
 *
 * With KHOZO_SMOKE_VIDEO set to a clip with faces (the demo clip), a whole
 * job is also run through Khozo's answers and an officer's decision.
 *
 *   cd desktop && node test/jobs.mjs
 */
import { fork, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createJobs, noteFor, windowFor } from '../app/jobs.js';
import { loadKey, open, secureFiles, seal } from '../app/secure-store.js';
import { VIDEO_ROLES, canSearchCase } from '../app/roles.js';
import { KEYS, TRANSLATIONS } from '../app/renderer/i18n.js';
import { ffmpegPath } from '../scanner/ffmpeg.js';
import { KhozoError } from '../scanner/khozo.js';
import { isStreamAddress, safeAddress } from '../scanner/live.js';
import { readModelCard } from '../scanner/recognizer.js';
import { loadDetector } from '../scanner/detector.js';
import { scanFile } from '../scanner/scan.js';
import sharp from 'sharp';
import { POLICE_ROLES } from '../../shared/scope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khozo-desktop-jobs-'));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The scan worker as a child process, as the app runs it as a utility process. */
function startWorker() {
  const child = fork(path.join(here, '..', 'app', 'scan-worker.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced' });
  const pending = new Map();
  let alive = true;
  child.on('message', (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.event) p.onEvent?.(m);
    else { pending.delete(m.id); if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error)); }
  });
  child.on('exit', () => { alive = false; for (const p of pending.values()) p.reject(new Error('stopped')); pending.clear(); });
  return {
    request(type, task, onEvent) {
      if (!alive) return Promise.reject(new Error('stopped'));
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, onEvent }); child.send({ id, type, ...task }); });
    },
    kill() { if (alive) child.kill(); alive = false; },
  };
}

/**
 * A stand-in for Khozo: the first face of each request is "likely", the rest
 * "unlikely". `keeps: false` is a Khozo without check records (not yet
 * updated); `online = false` is a laptop that cannot reach Khozo.
 */
function fakeClient({ keeps = true } = {}) {
  const calls = { searches: [], notes: [], started: [], progress: [], decisions: [], closed: [], closeBodies: [], openStarted: [], openFaces: [], leads: [], openProgress: [], openClosed: [], caseReads: 0 };
  let online = true;
  // Set by a test: what Khozo answers a decision with, and how a start is refused.
  const knobs = { decisionRefusal: null, startRefusal: null, startDelayMs: 0 };
  const reach = () => { if (!online) throw new KhozoError('No connection to Khozo (ECONNREFUSED)', 0); };
  const compare = async (caseId, form, job = {}) => {
    const faces = [...form.getAll('photo'), ...form.getAll('extraPhotos')];
    const first = Buffer.from(await faces[0].arrayBuffer());
    calls.searches.push({ caseId, ...job, faces: faces.length, camera: form.get('cameraPlace'), times: form.get('times'), firstBytes: first.subarray(0, 2).toString('hex'), side: (await sharp(first).metadata()).width });
    return { results: faces.map((_, index) => ({ index, verdict: index === 0 && calls.searches.length === 1 ? 'likely' : 'unlikely', enginesAnswered: ['aarakshak'] })) };
  };
  return {
    calls,
    knobs,
    set online(value) { online = value; },
    getCase: async (id) => { calls.caseReads += 1; return { id, childName: 'Test Person', status: 'missing', extraPhotos: [] }; },
    photo: async () => { throw new Error('no photo'); },
    videoSearch: async (caseId, form) => { reach(); return compare(caseId, form); },
    addNote: async (caseId, note) => { reach(); calls.notes.push({ caseId, note }); return { ok: true }; },
    startVideoJob: async (caseId, body) => {
      reach();
      if (knobs.startDelayMs) await sleep(knobs.startDelayMs);
      if (knobs.startRefusal) throw knobs.startRefusal;
      if (!keeps) throw new KhozoError('No route for POST /api/reports/r_test/video-jobs', 404, { error: 'No route for POST /api/reports/r_test/video-jobs' });
      calls.started.push({ caseId, body });
      return { job: { id: `vj_${body.jobKey}` } };
    },
    videoJobFaces: async (caseId, jobId, form) => { reach(); return compare(caseId, form, { jobId, fileKey: form.get('fileKey'), batch: form.get('batch'), keys: form.get('keys') }); },
    videoJobProgress: async (caseId, jobId, body) => { reach(); calls.progress.push({ jobId, ...body }); return { job: {} }; },
    videoJobDecision: async (caseId, jobId, form) => {
      reach();
      if (knobs.decisionRefusal) throw knobs.decisionRefusal;
      const decision = form.get('decision');
      const photo = form.get('photo');
      calls.decisions.push({
        jobId, key: form.get('key'), decision, fileKey: form.get('fileKey'), t: form.get('t'), seenAt: form.get('seenAt'), verdict: form.get('verdict'),
        photos: form.getAll('photo').length, extras: form.getAll('extraPhotos').length,
        photoSide: photo ? (await sharp(Buffer.from(await photo.arrayBuffer())).metadata().catch(() => ({}))).width : null,
      });
      return { decision: { decision, sightingId: decision === 'same' ? `f_${calls.decisions.length}` : undefined } };
    },
    closeVideoJob: async (caseId, jobId, body = {}) => { reach(); calls.closed.push(jobId); calls.closeBodies.push({ jobId, body }); return { job: {} }; },
    // Checks against open cases: the first face sent is close to a case the officer can open.
    openCaseCount: async () => { reach(); return { enabled: true, cases: 240, area: { kind: 'state', state: 'Gujarat' } }; },
    startOpenCaseCheck: async (body) => {
      reach();
      if (!keeps) throw new KhozoError('No route for POST /api/reports/open-case-checks', 404, { error: 'No route for POST /api/reports/open-case-checks' });
      calls.openStarted.push({ body });
      return { job: { id: `vj_${body.jobKey}` } };
    },
    openCaseFace: async (jobId, form) => {
      reach();
      const photo = Buffer.from(await form.get('photo').arrayBuffer());
      calls.openFaces.push({ jobId, key: form.get('key'), fileKey: form.get('fileKey'), t: form.get('t'), side: (await sharp(photo).metadata()).width });
      const first = calls.openFaces.length === 1;
      return { verdict: first ? 'likely' : 'unlikely', leads: first ? [{ id: 'ld_in1', fileKey: 0, faceKey: form.get('key'), t: Number(form.get('t')), status: 'open', inScope: true, rank: 1, aarakshak: 0.8, rekognition: 0.97, case: { id: 'r_in', name: 'Asha' } }] : [] };
    },
    openCaseLead: async (jobId, leadId, form) => {
      reach();
      const decision = form.get('decision');
      calls.leads.push({ jobId, leadId, decision, seenAt: form.get('seenAt'), photos: form.getAll('photo').length, extras: form.getAll('extraPhotos').length });
      return { lead: { id: leadId, status: decision === 'same' ? 'sent' : 'not', ...(decision === 'same' && leadId === 'ld_in1' ? { sightingId: 'f_open_1' } : {}) } };
    },
    openCaseProgress: async (jobId, body) => { reach(); calls.openProgress.push({ jobId, ...body }); return { job: {} }; },
    closeOpenCaseCheck: async (jobId) => { reach(); calls.openClosed.push(jobId); return { job: {} }; },
  };
}

const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), crypto.randomBytes(200), Buffer.from('ffd9', 'hex')]);

/** A finished job written straight to disk, as one the laptop read earlier: two people, both answered by Khozo. */
function plantJob(root, files, id) {
  const job = {
    id, caseId: 'r_test', caseName: 'Test Person', caseFir: '', officer: { id: 'u1', name: 'PSI Test' },
    createdAt: new Date().toISOString(), status: 'done', window: null,
    settings: { fps: 2, maxSide: 960, line: 0.25, top: 10, firstPass: false },
    files: [{
      path: path.join(tmp, 'gone.mp4'), name: 'gate1.mp4', bytes: 73400320, duration: 60, width: 1280, height: 720,
      camera: 'Kalupur railway station, gate 1', recordedFrom: '2026-10-20T14:30:05', from: 0, to: null, outside: false,
      segments: [{ index: 0, from: 0, to: 60, done: true, tracks: [
        { id: 's0-1', time: 11.5, firstTime: 10, lastTime: 13, quality: 0.9, picture: 'p1.jpg' },
        { id: 's0-2', time: 30, firstTime: 29, lastTime: 31, quality: 0.8, picture: 'p2.jpg' },
      ] }],
      scanned: true, scored: false, sent: true, scanTo: 60, sha256: 'c'.repeat(64),
    }],
    scores: {},
    answers: { '0:s0-1': { verdict: 'likely', engines: ['aarakshak', 'rekognition'] }, '0:s0-2': { verdict: 'possible', engines: ['aarakshak'] } },
    decisions: {},
  };
  files.writeJson(path.join(root, id, 'job.bin'), job);
  for (const picture of ['p1.jpg', 'p2.jpg']) files.write(path.join(root, id, 'files', '0', picture), JPEG);
}

async function until(test, ms = 10000) {
  const start = Date.now();
  while (!test() && Date.now() - start < ms) await sleep(50);
  return test();
}

async function untilDone(jobs, id, ms = 180000) {
  const start = Date.now();
  for (;;) {
    const job = jobs.get(id);
    if (['done', 'error', 'paused'].includes(job.status)) return job;
    if (Date.now() - start > ms) return job;
    await sleep(200);
  }
}

// ---- small parts ---------------------------------------------------------------------

console.log('Parts');
{
  const key = crypto.randomBytes(32);
  const sealed = seal(key, Buffer.from('a face'));
  check('sealed bytes open with the key', open(key, sealed).toString() === 'a face' && !sealed.includes(Buffer.from('a face')));
  let tampered = false;
  try { sealed[sealed.length - 1] ^= 1; open(key, sealed); } catch { tampered = true; }
  check('changed bytes are refused', tampered);
  const kf = path.join(tmp, 'key.bin');
  const k1 = loadKey(kf, { wrap: (b) => Buffer.from(b.toString('hex')), unwrap: (b) => Buffer.from(b.toString(), 'hex') });
  const k2 = loadKey(kf, { wrap: (b) => Buffer.from(b.toString('hex')), unwrap: (b) => Buffer.from(b.toString(), 'hex') });
  check('the install key is made once and read back', k1.equals(k2) && k1.length === 32);

  const file = { recordedFrom: '2026-10-20T09:30:00', duration: 4 * 3600 };
  const w = windowFor(file, { mode: 'clock', from: '10:00', to: '12:00' });
  check('a clock window becomes times in the video', w.from === 1800 && w.to === 9000, JSON.stringify(w));
  const night = windowFor({ recordedFrom: '2026-10-20T22:00:00', duration: 6 * 3600 }, { mode: 'clock', from: '23:30', to: '01:00' });
  check('a window past midnight is read across it', night.from === 5400 && night.to === 10800, JSON.stringify(night));
  const after = windowFor({ recordedFrom: '2026-10-20T22:00:00', duration: 6 * 3600 }, { mode: 'clock', from: '01:00', to: '02:00' });
  check('an early-morning window is the next morning', after.from === 10800 && after.to === 14400, JSON.stringify(after));
  check('a window that misses the video says so', windowFor(file, { mode: 'clock', from: '20:00', to: '21:00' }).outside === true);
  const video = windowFor(file, { mode: 'video', from: '1:00:00', to: '1:30:00' });
  check('a window in video time is read as it is', video.from === 3600 && video.to === 5400);
  check('a clock window without the start time reads the whole video', windowFor({ duration: 60 }, { mode: 'clock', from: '10:00', to: '11:00' }).noClock === true);

  const note = noteFor({
    job: { caseId: 'r_test' },
    file: { camera: 'Kalupur railway station, gate 1', name: 'gate1.mp4', bytes: 73400320, sha256: 'c'.repeat(64), recordedFrom: '2026-10-20T14:30:05' },
    track: { time: 11.5 },
    verdict: 'likely',
    officer: { name: 'PSI Test' },
  });
  check('the case note says where, when, what the engines said and who looked', note.includes('Kalupur railway station, gate 1') && note.includes('0:11') && note.includes('both agree') && note.includes('c'.repeat(64)) && note.includes('PSI Test') && note.includes('lead, not an identification') && note.length <= 1000, note);

  check('the desktop’s police roles are Khozo’s', JSON.stringify([...VIDEO_ROLES].sort()) === JSON.stringify([...POLICE_ROLES].sort()));
  check('found, closed and unverified cases are not offered', !canSearchCase({ status: 'found' }) && !canSearchCase({ status: 'closed' }) && !canSearchCase({ status: 'missing', intakeStatus: 'pending_verification' }) && canSearchCase({ status: 'missing' }));

  const missing = [];
  const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const lang of ['hi', 'gu']) {
    for (const key of KEYS) {
      if (!TRANSLATIONS[lang][key]) missing.push(`${lang}:${key}`);
      else if (placeholders(TRANSLATIONS[lang][key]) !== placeholders(TRANSLATIONS.en[key])) missing.push(`${lang}:${key} placeholders`);
    }
  }
  check('every screen word is in Hindi and Gujarati, with the same blanks', missing.length === 0, missing.join(', '));
}

// ---- a job with the real worker ---------------------------------------------------------

console.log('Jobs');
const video = path.join(tmp, 'test.mp4');
spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-t', '40', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', video]);
{
  const key = crypto.randomBytes(32);
  const files = secureFiles(key);
  const client = fakeClient();
  const root = path.join(tmp, 'jobs-a');
  const jobs = createJobs({ root, files, key, startWorker, getClient: () => client, officer: { id: 'u1', name: 'PSI Test' }, checkpointMs: 150 });
  const id = jobs.create({ report: { id: 'r_test', childName: 'Test Person' }, files: [{ path: video, name: 'test.mp4', bytes: fs.statSync(video).size, duration: 40, width: 640, height: 360, camera: 'Test camera' }] });
  const done = await untilDone(jobs, id);
  check('a job reads its video and finishes', done.status === 'done' && done.files[0].state === 'done', `${done.status} ${done.error || ''}`);
  const record = fs.readFileSync(path.join(root, id, 'job.bin'));
  check('the job record on disk is encrypted', !record.includes(Buffer.from('Test Person')) && files.readJson(path.join(root, id, 'job.bin')).caseName === 'Test Person');

  // Paused part-way, then carried on.
  const id2 = jobs.create({ report: { id: 'r_test', childName: 'Test Person' }, files: [{ path: video, name: 'test.mp4', bytes: 1, duration: 40, width: 640, height: 360, camera: 'Test camera' }] });
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const job = jobs.get(id2);
    if (job.files[0].progress > 0.2) break;
    await sleep(50);
  }
  jobs.pause(id2);
  const paused = await untilDone(jobs, id2);
  const reached = paused.files[0].progress;
  check('a job can be paused part-way', paused.status === 'paused' && reached > 0 && reached < 1, `${paused.status} at ${reached}`);
  jobs.start(id2);
  await sleep(300);
  const resumed = await untilDone(jobs, id2);
  check('a paused job carries on and finishes', resumed.status === 'done' && resumed.files[0].progress === 1, `${resumed.status} ${resumed.error || ''}`);
  const told = await until(() => client.calls.progress.some((p) => p.jobId === `vj_${id}` && p.status === 'done'));
  const said = told && JSON.parse(client.calls.progress.find((p) => p.jobId === `vj_${id}` && p.status === 'done').files)[0];
  check('Khozo is told where a finished check stopped', told && said.secondsRead === 40 && said.state === 'done' && /^[0-9a-f]{64}$/.test(said.sha256 || ''), JSON.stringify(said));
  check('each job makes its check on Khozo once', client.calls.started.filter((c) => c.body.jobKey === id).length === 1 && client.calls.started.filter((c) => c.body.jobKey === id2).length === 1);

  // Opened again, as after a restart.
  const again = createJobs({ root, files, key, startWorker, getClient: () => client, officer: { id: 'u1', name: 'PSI Test' } });
  check('jobs are read back after a restart', again.list().length === 2);
  again.remove(id);
  check('deleting a job removes its folder', !fs.existsSync(path.join(root, id)) && again.list().length === 1);
  check('deleting a job closes its check on Khozo', client.calls.closed.includes(`vj_${id}`));
}

// ---- Khozo's record of a check -----------------------------------------------------------

console.log('Khozo’s record of a check');
{
  const key = crypto.randomBytes(32);
  const files = secureFiles(key);
  const officer = { id: 'u1', name: 'PSI Test' };
  const frames = [];
  const frameOf = async (file, track) => { frames.push(track.time); return JPEG; };

  const client = fakeClient();
  const root = path.join(tmp, 'jobs-sync');
  plantJob(root, files, 'job_sync_a');
  plantJob(root, files, 'job_sync_b');
  const jobs = createJobs({ root, files, key, startWorker, getClient: () => client, officer, appVersion: '0.1.0', frameOf });

  const same = await jobs.decide('job_sync_a', '0:s0-1', 'same');
  const made = client.calls.started.find((c) => c.body.jobKey === 'job_sync_a');
  const madeFiles = made ? JSON.parse(made.body.files) : [];
  check('the check is made on Khozo with the videos, the cameras and the app', client.calls.started.length === 1 && made.body.appVersion === '0.1.0' && madeFiles[0]?.cameraPlace === 'Kalupur railway station, gate 1' && madeFiles[0]?.recordedFrom === new Date(Date.parse('2026-10-20T14:30:05')).toISOString(), JSON.stringify(made?.body));
  const sent = client.calls.decisions[0];
  check('"Same person" sends the face, the whole frame and the moment', sent?.decision === 'same' && sent.photos === 1 && sent.extras === 1 && frames[0] === 11.5 && sent.fileKey === '0' && sent.t === '11.5' && sent.verdict === 'likely' && sent.seenAt === new Date(Date.parse('2026-10-20T14:30:05') + 11500).toISOString(), JSON.stringify(sent));
  check('Khozo’s sighting is kept with the decision', same.saved === true && same.via === 'check' && same.sightingId === 'f_1' && jobs.get('job_sync_a').sync.kept === true && client.calls.notes.length === 0);
  await jobs.decide('job_sync_a', '0:s0-2', 'not');
  const not = client.calls.decisions[1];
  check('"Not this person" is sent with no picture', not?.decision === 'not' && not.photos === 0 && not.extras === 0 && frames.length === 1);

  client.online = false;
  const waiting = await jobs.decide('job_sync_b', '0:s0-1', 'same');
  check('a decision Khozo cannot take waits on the laptop', waiting.saved === false && jobs.get('job_sync_b').sync.decisionsWaiting === 1 && client.calls.decisions.length === 2);
  client.online = true;
  await Promise.all([jobs.syncAll(), jobs.syncAll()]);
  const later = jobs.get('job_sync_b').everyone.find((p) => p.key === '0:s0-1').decision;
  check('… and goes once when Khozo can be reached', later.saved === true && Boolean(later.sightingId) && client.calls.decisions.filter((d) => d.jobId === 'vj_job_sync_b').length === 1 && jobs.get('job_sync_b').sync.decisionsWaiting === 0);
  const reread = createJobs({ root, files, key, startWorker, getClient: () => client, officer });
  check('the check’s id on Khozo is kept with the job', reread.get('job_sync_a').sync.kept === true);

  const older = fakeClient({ keeps: false });
  const root2 = path.join(tmp, 'jobs-older');
  plantJob(root2, files, 'job_older');
  const jobs2 = createJobs({ root: root2, files, key, startWorker, getClient: () => older, officer, frameOf });
  const noted = await jobs2.decide('job_older', '0:s0-1', 'same');
  check('on a Khozo without check records, "Same person" is a case note', noted.saved === true && noted.via === 'note' && older.calls.notes.length === 1 && older.calls.notes[0].note.includes('Kalupur railway station, gate 1') && jobs2.get('job_older').sync.olderKhozo === true);
  await jobs2.decide('job_older', '0:s0-2', 'not');
  check('… and "Not this person" stays on the laptop', older.calls.notes.length === 1 && older.calls.decisions.length === 0);

  // A Khozo that was older is asked again later, and a missing case is not mistaken for one.
  const updated = fakeClient();
  const root3 = path.join(tmp, 'jobs-updated');
  plantJob(root3, files, 'job_later');
  const planted = files.readJson(path.join(root3, 'job_later', 'job.bin'));
  planted.server = { available: false, checkedAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString() };
  files.writeJson(path.join(root3, 'job_later', 'job.bin'), planted);
  const signedOutCalls = [];
  const jobs3 = createJobs({ root: root3, files, key, startWorker, getClient: () => updated, officer, frameOf, onSignedOut: () => signedOutCalls.push(1) });
  const retried = await jobs3.decide('job_later', '0:s0-1', 'same');
  check('a Khozo that kept no checks is asked again after some hours', retried.via === 'check' && updated.calls.started.length === 1);

  const gone = fakeClient();
  gone.knobs.startRefusal = new KhozoError('Report not found', 404, { error: 'Report not found' });
  const root4 = path.join(tmp, 'jobs-gone');
  plantJob(root4, files, 'job_gone');
  const jobs4 = createJobs({ root: root4, files, key, startWorker, getClient: () => gone, officer, frameOf });
  const goneDecision = await jobs4.decide('job_gone', '0:s0-1', 'same');
  check('a case Khozo no longer has is a refusal, not an older Khozo', goneDecision.saved === false && goneDecision.refused === true && gone.calls.notes.length === 0 && jobs4.get('job_gone').sync.olderKhozo === false);

  // Refusals are not sent again; a sign-in Khozo no longer takes ends the session, jobs kept.
  updated.knobs.decisionRefusal = new KhozoError('This case is closed', 409, { error: 'This case is closed' });
  const refused = await jobs3.decide('job_later', '0:s0-2', 'same');
  const sentBefore = updated.calls.decisions.length;
  await jobs3.syncAll();
  check('a decision Khozo refused is not sent again by itself, and the officer sees why', refused.refused === true && /closed/.test(refused.error) && updated.calls.decisions.length === sentBefore && jobs3.unsent() === 0);
  updated.knobs.decisionRefusal = new KhozoError('Session expired', 401, { error: 'Session expired' });
  const expired = await jobs3.decide('job_later', '0:s0-2', 'not');
  check('when Khozo no longer takes the sign-in, the app is told once and the decision waits', signedOutCalls.length === 1 && expired.saved === false && !expired.refused && jobs3.unsent() === 1);

  // Two decisions at once on a job Khozo has no check for yet: one check is made, not two.
  const slow = fakeClient();
  slow.knobs.startDelayMs = 300;
  const root5 = path.join(tmp, 'jobs-slow');
  plantJob(root5, files, 'job_slow');
  const jobs5 = createJobs({ root: root5, files, key, startWorker, getClient: () => slow, officer, frameOf });
  await Promise.all([jobs5.decide('job_slow', '0:s0-1', 'same'), jobs5.decide('job_slow', '0:s0-2', 'not')]);
  check('two decisions at once make one check on Khozo, not two', slow.calls.started.length === 1 && slow.calls.decisions.length === 2);

  // Deleting a job while Khozo cannot be reached: the close waits, and goes later.
  slow.online = false;
  jobs5.remove('job_slow');
  await sleep(100);
  check('a job deleted while offline does not lose its close', slow.calls.closed.length === 0 && fs.existsSync(path.join(root5, 'closes.bin')));
  slow.online = true;
  const reopened = createJobs({ root: root5, files, key, startWorker, getClient: () => slow, officer, frameOf });
  await reopened.syncAll();
  check('… it goes when Khozo is back, even after the app was closed', slow.calls.closed.includes('vj_job_slow') && files.readJson(path.join(root5, 'closes.bin')).length === 0);

  // The 30-day clean-up keeps a job until Khozo has its decisions.
  const root6 = path.join(tmp, 'jobs-old');
  plantJob(root6, files, 'job_old');
  const oldJob = files.readJson(path.join(root6, 'job_old', 'job.bin'));
  oldJob.decisions = { '0:s0-1': { decision: 'same', at: '2026-09-01T00:00:00Z', saved: false, error: 'No connection to Khozo', offline: true } };
  oldJob.updatedAt = '2026-09-01T00:00:00Z';
  files.writeJson(path.join(root6, 'job_old', 'job.bin'), oldJob);
  const jobs6 = createJobs({ root: root6, files, key, startWorker, getClient: () => slow, officer, frameOf });
  jobs6.sweep(30);
  check('the 30-day clean-up keeps a job whose decisions have not reached Khozo', jobs6.list().length === 1);

  // Khozo's limit on decisions: the decision waits and goes later, it is not a refusal.
  const busy = fakeClient();
  busy.knobs.decisionRefusal = new KhozoError('Too many requests', 429, { error: 'Too many requests' }, 60);
  const root7 = path.join(tmp, 'jobs-busy');
  plantJob(root7, files, 'job_busy');
  const jobs7 = createJobs({ root: root7, files, key, startWorker, getClient: () => busy, officer, frameOf });
  const held = { ...(await jobs7.decide('job_busy', '0:s0-1', 'same')) };
  busy.knobs.decisionRefusal = null;
  await jobs7.syncAll();
  const went = jobs7.get('job_busy').toCheck.find((p) => p.key === '0:s0-1').decision;
  check('a decision held back by Khozo\'s limit waits, then goes', held.saved === false && held.offline === true && !held.refused && went.saved === true);
}

// ---- a check against open cases ------------------------------------------------------------

/** A finished check against open cases, as the laptop read it: three people, two of them close to a case. */
function plantOpenJob(root, files, id) {
  const job = {
    id, mode: 'open_cases', caseId: null, caseName: '', caseFir: '',
    openCases: { filters: { sex: 'female', ageFrom: 6, ageTo: 17 }, casesSearched: 240, area: { kind: 'state', state: 'Gujarat', district: null } },
    photoYears: null, officer: { id: 'u1', name: 'PSI Test' },
    createdAt: new Date().toISOString(), status: 'done', window: null,
    settings: { fps: 2, maxSide: 960, line: 0.25, top: 10, firstPass: false },
    files: [{
      path: path.join(tmp, 'gone.mp4'), name: 'platform1.mp4', bytes: 73400320, duration: 60, width: 1280, height: 720,
      camera: 'Kalupur railway station, platform 1', recordedFrom: '2026-10-20T14:30:05', from: 0, to: null, outside: false,
      segments: [{ index: 0, from: 0, to: 60, done: true, tracks: [
        { id: 's0-1', time: 11.5, firstTime: 10, lastTime: 13, quality: 0.9, picture: 'p1.jpg' },
        { id: 's0-2', time: 30, firstTime: 29, lastTime: 31, quality: 0.8, picture: 'p2.jpg' },
        { id: 's0-3', time: 15, firstTime: 14, lastTime: 16, quality: 0.7, picture: 'p3.jpg' },
      ] }],
      scanned: true, scored: false, sent: true, scanTo: 60, sha256: 'c'.repeat(64),
    }],
    scores: {},
    answers: {
      '0:s0-1': { verdict: 'likely', leads: [{ id: 'ld_in1', fileKey: 0, faceKey: '0:s0-1', t: 11.5, status: 'open', inScope: true, rank: 1, aarakshak: 0.81, rekognition: 0.98, case: { id: 'r_in', name: 'Asha', ageNow: 12, district: 'Ahmedabad' } }] },
      '0:s0-2': { verdict: 'likely', leads: [{ id: 'ld_out1', fileKey: 0, faceKey: '0:s0-2', t: 30, status: 'open', inScope: false, caseKey: 'oc_far' }] },
      '0:s0-3': { verdict: 'likely', leads: [{ id: 'ld_out2', fileKey: 0, faceKey: '0:s0-3', t: 15, status: 'open', inScope: false, caseKey: 'oc_far' }] },
    },
    decisions: {},
  };
  files.writeJson(path.join(root, id, 'job.bin'), job);
  for (const picture of ['p1.jpg', 'p2.jpg', 'p3.jpg']) files.write(path.join(root, id, 'files', '0', picture), JPEG);
}

console.log('A check against open cases');
{
  const key = crypto.randomBytes(32);
  const files = secureFiles(key);
  const officer = { id: 'u1', name: 'PSI Test' };
  const frameOf = async () => JPEG;
  const client = fakeClient();
  const root = path.join(tmp, 'jobs-open');
  plantOpenJob(root, files, 'job_open_a');
  const jobs = createJobs({ root, files, key, startWorker, getClient: () => client, officer, appVersion: '0.3.0', device: 'TEST-LAPTOP', frameOf });

  const view = jobs.get('job_open_a');
  check('the faces are grouped by case, a case the officer can open first', view.mode === 'open_cases' && view.groups.length === 2 && view.groups[0].inScope && view.groups[0].caseId === 'r_in' && view.groups[0].case.name === 'Asha' && view.counts.leads === 3);
  check('two faces close to one case outside the area are shown together', view.groups[1].leads.map((l) => l.id).join() === 'ld_out2,ld_out1');
  check('a case outside the officer\'s area comes with nothing that says which', view.groups[1].inScope === false && view.groups[1].caseId === null && view.groups[1].case === null && !JSON.stringify(view.groups[1]).includes('r_in'));

  const sent = await jobs.decideLead('job_open_a', 'ld_in1', 'same');
  const start = client.calls.openStarted[0];
  check('the check is made on Khozo with the narrowing, the videos and this laptop, and no case', client.calls.openStarted.length === 1 && start.body.sex === 'female' && start.body.ageFrom === 6 && start.body.device === 'TEST-LAPTOP'
    && JSON.parse(start.body.files)[0].cameraPlace === 'Kalupur railway station, platform 1' && !('caseId' in start.body) && client.calls.started.length === 0, JSON.stringify(start?.body));
  const lead = client.calls.leads[0];
  check('"Same person: send to the case" sends the face, the whole frame and the moment', lead?.leadId === 'ld_in1' && lead.decision === 'same' && lead.photos === 1 && lead.extras === 1 && lead.seenAt === new Date(Date.parse('2026-10-20T14:30:05') + 11500).toISOString(), JSON.stringify(lead));
  check('… and Khozo\'s sighting is kept with it', sent.saved === true && sent.sightingId === 'f_open_1');
  const together = jobs.get('job_open_a').groups[0].leads[0].person.together;
  check('seen together: the person 3.5 seconds away is shown, the one 18.5 seconds away is not', together?.length === 1 && together[0].key === '0:s0-3', JSON.stringify(together));

  client.online = false;
  const waiting = await jobs.decideLead('job_open_a', 'ld_out1', 'same');
  check('sending to a case outside the area waits on the laptop while Khozo cannot be reached', waiting.saved === false && waiting.offline === true && jobs.unsent('job_open_a') === 1);
  client.online = true;
  await Promise.all([jobs.syncAll(), jobs.syncAll()]);
  const went = jobs.get('job_open_a').groups[1].leads.find((l) => l.id === 'ld_out1').decision;
  check('… and goes once when it can, with only "sent" back', went.saved === true && went.sightingId === null && client.calls.leads.filter((l) => l.leadId === 'ld_out1').length === 1);
  check('a face sent cannot be marked otherwise from here', jobs.get('job_open_a').groups[1].leads.find((l) => l.id === 'ld_out1').decision.decision === 'same');

  plantOpenJob(root, files, 'job_open_b');
  const reread = createJobs({ root, files, key, startWorker, getClient: () => client, officer, device: 'TEST-LAPTOP', frameOf });
  await reread.decideLead('job_open_b', 'ld_out1', 'not');
  check('"Do not send" sends no picture of anyone', client.calls.leads.at(-1).decision === 'not' && client.calls.leads.at(-1).photos === 0);
  let unknown = null;
  try { await reread.decideLead('job_open_b', 'ld_nope', 'same'); } catch (err) { unknown = err.message; }
  check('a lead that is not in the check is refused', /No such face/.test(unknown || ''));

  const job = files.readJson(path.join(root, 'job_open_b', 'job.bin'));
  job.sync = { progressPending: true };
  files.writeJson(path.join(root, 'job_open_b', 'job.bin'), job);
  const third = createJobs({ root, files, key, startWorker, getClient: () => client, officer, device: 'TEST-LAPTOP', frameOf });
  await third.syncAll();
  check('where a check against open cases stopped goes to its own record on Khozo', client.calls.openProgress.some((p) => p.jobId === 'vj_job_open_b' && p.status === 'done') && client.calls.progress.length === 0);
  third.remove('job_open_b');
  third.remove('job_open_a');
  await until(() => client.calls.openClosed.includes('vj_job_open_b') && client.calls.openClosed.includes('vj_job_open_a'));
  check('deleting it closes it on Khozo', client.calls.openClosed.includes('vj_job_open_b') && client.calls.closed.length === 0);
  check('two checks deleted one after the other are both closed at once, not one at the next sync', client.calls.openClosed.includes('vj_job_open_a'));

  // A Khozo that does not check against open cases: the officer is told, nothing falls back to a case.
  const older = fakeClient({ keeps: false });
  const root2 = path.join(tmp, 'jobs-open-older');
  plantOpenJob(root2, files, 'job_open_older');
  const jobs2 = createJobs({ root: root2, files, key, startWorker, getClient: () => older, officer, frameOf });
  const refused = await jobs2.decideLead('job_open_older', 'ld_in1', 'same');
  check('on a Khozo without checks against open cases, the officer is told and nothing is sent elsewhere', refused.refused === true && /cannot check footage against open cases/.test(refused.error) && older.calls.notes.length === 0 && older.calls.leads.length === 0);

  // Scenario 8: how old the case photo is, from when the person went missing.
  const root3 = path.join(tmp, 'jobs-old-photo');
  const jobs3 = createJobs({ root: root3, files, key, startWorker, getClient: () => client, officer });
  const threeYears = new Date(Date.now() - 3.2 * 365.25 * 86400000).toISOString().slice(0, 10);
  const oldId = jobs3.create({ report: { id: 'r_test', childName: 'Test Person', dateOfMissing: threeYears }, window: { mode: 'video', from: '1:00:00' }, files: [{ path: video, name: 'test.mp4', bytes: 1, duration: 40, width: 640, height: 360, camera: 'Test camera' }] });
  const oldJob = await untilDone(jobs3, oldId);
  check('scenario 8: a case missing for three years says its photo is at least three years old', oldJob.photoYears === 3, String(oldJob.photoYears));
}

// ---- a whole job on a clip with faces ----------------------------------------------------

if (process.env.KHOZO_SMOKE_VIDEO) {
  console.log('A whole job on a clip with faces');
  const key = crypto.randomBytes(32);
  const files = secureFiles(key);
  const client = fakeClient();
  const root = path.join(tmp, 'jobs-b');
  const jobs = createJobs({ root, files, key, startWorker, getClient: () => client, officer: { id: 'u1', name: 'PSI Test' } });
  const clip = process.env.KHOZO_SMOKE_VIDEO;
  const id = jobs.create({ report: { id: 'r_test', childName: 'Test Person' }, files: [{ path: clip, name: path.basename(clip), bytes: fs.statSync(clip).size, duration: 24, width: 1280, height: 720, camera: 'Kalupur railway station, gate 1', recordedFrom: '2026-10-20T14:30:05' }] });
  const job = await untilDone(jobs, id);
  check('people are found and sent to Khozo', job.status === 'done' && job.counts.people > 0 && client.calls.searches.length > 0, `${job.status} ${job.counts.people} people`);
  check('the faces go to the check on Khozo, each batch named', client.calls.searches.every((s) => s.jobId === `vj_${id}` && s.fileKey === '0' && /^[0-9a-f]{24}$/.test(s.batch || '')));
  check('only face pictures are sent, five at most a request, with the camera', client.calls.searches.every((s) => s.faces <= 5 && s.firstBytes === 'ffd8' && s.camera === 'Kalupur railway station, gate 1'));
  check('Khozo’s answer is on the person, in clock time', job.toCheck.length === 1 && job.toCheck[0].verdict === 'likely' && /2:30|14:30/.test(job.toCheck[0].clock || ''), JSON.stringify(job.toCheck[0]));
  const someone = job.everyone[0];
  const rel = decodeURIComponent(someone.picture.split('/').slice(5).join('/'));
  const onDisk = fs.readFileSync(path.join(root, id, 'files', '0', rel));
  check('face pictures on disk are encrypted, and open as JPEG', onDisk.subarray(0, 2).toString('hex') !== 'ffd8' && jobs.picture(id, 0, rel).subarray(0, 2).toString('hex') === 'ffd8');
  const decision = await jobs.decide(id, job.toCheck[0].key, 'same');
  check('"Same person" becomes a sighting of the case', decision.saved === true && Boolean(decision.sightingId) && client.calls.decisions.at(-1).photos === 1);
  await jobs.decide(id, job.everyone.at(-1).key, 'not');
  check('"Not this person" is sent with no picture', client.calls.decisions.at(-1).decision === 'not' && client.calls.decisions.at(-1).photos === 0 && jobs.get(id).everyone.at(-1).decision.decision === 'not');
  check('the engines get each face at 240 px, the size they find faces best', client.calls.searches.every((s) => s.side === 240), JSON.stringify(client.calls.searches.map((s) => s.side)));
  check('"Same person" still sends the picture itself, not the small copy', client.calls.decisions.find((d) => d.decision === 'same')?.photoSide > 240, JSON.stringify(client.calls.decisions.map((d) => d.photoSide)));
  check('each face is sent with the laptop\'s name for the person', client.calls.searches.every((s) => s.keys && s.keys.split(',').length === s.faces && s.keys.split(',').every((k) => /^0:/.test(k))));

  // Khozo's limit on faces: the laptop waits as Khozo asks, then carries on.
  const slowed = fakeClient();
  let limitedOnce = false;
  const plainFaces = slowed.videoJobFaces;
  slowed.videoJobFaces = async (...args) => {
    if (!limitedOnce) { limitedOnce = true; throw new KhozoError('Too many requests', 429, { error: 'Too many requests' }, 1); }
    return plainFaces(...args);
  };
  const slowedJobs = createJobs({ root: path.join(tmp, 'jobs-slowed'), files, key, startWorker, getClient: () => slowed, officer: { id: 'u1', name: 'PSI Test' } });
  const slowedId = slowedJobs.create({ report: { id: 'r_test', childName: 'Test Person' }, files: [{ path: clip, name: path.basename(clip), bytes: fs.statSync(clip).size, duration: 24, width: 1280, height: 720, camera: 'Kalupur railway station, gate 1' }] });
  const slowedJob = await untilDone(slowedJobs, slowedId);
  check('when Khozo asks the laptop to slow down, it waits and finishes', limitedOnce && slowedJob.status === 'done' && slowed.calls.searches.length > 0, `${slowedJob.status} ${slowedJob.error || ''}`);

  // A check that reaches its face budget finishes with what was answered, and says so.
  const full = fakeClient();
  full.videoJobFaces = async () => { throw new KhozoError('This check has sent the 5000 faces one check may send.', 409, { error: 'budget', code: 'face_budget' }); };
  const fullJobs = createJobs({ root: path.join(tmp, 'jobs-full'), files, key, startWorker, getClient: () => full, officer: { id: 'u1', name: 'PSI Test' } });
  const fullId = fullJobs.create({ report: { id: 'r_test', childName: 'Test Person' }, files: [{ path: clip, name: path.basename(clip), bytes: fs.statSync(clip).size, duration: 24, width: 1280, height: 720, camera: 'Kalupur railway station, gate 1' }] });
  const fullJob = await untilDone(fullJobs, fullId);
  check('a check that reaches its face budget finishes and says so, instead of failing', fullJob.status === 'done' && fullJob.notice === 'face_budget', `${fullJob.status} ${fullJob.notice} ${fullJob.error || ''}`);

  // A check of the clip against open cases: each person searched on Khozo, one a request.
  const openClient = fakeClient();
  const openJobs = createJobs({ root: path.join(tmp, 'jobs-open-clip'), files, key, startWorker, getClient: () => openClient, officer: { id: 'u1', name: 'PSI Test' }, device: 'TEST-LAPTOP' });
  const openId = openJobs.create({ openCases: { filters: {}, casesSearched: 240 }, files: [{ path: clip, name: path.basename(clip), bytes: fs.statSync(clip).size, duration: 24, width: 1280, height: 720, camera: 'Kalupur railway station, gate 1', recordedFrom: '2026-10-20T14:30:05' }] });
  const openJob = await untilDone(openJobs, openId);
  check('a check against open cases sends each person, one a request, at 240 px', openJob.status === 'done' && openClient.calls.openFaces.length === openJob.counts.people && openClient.calls.openFaces.every((f) => f.side === 240 && /^0:/.test(f.key) && f.fileKey === '0'), `${openJob.status} ${openJob.error || ''} ${openClient.calls.openFaces.length} of ${openJob.counts.people}`);
  check('no case is read on the laptop for it', openClient.calls.caseReads === 0 && openJob.model === null);
  check('its one lead is shown under its case', openJob.groups.length === 1 && openJob.groups[0].caseId === 'r_in');
}

// ---- Phase 3: answers on the laptop, and a live camera ---------------------------------------

console.log('Answers on the laptop when Khozo has not answered');
{
  const key = crypto.randomBytes(32);
  const files = secureFiles(key);
  const officer = { id: 'u1', name: 'PSI Test' };
  const client = fakeClient();
  const root = path.join(tmp, 'jobs-laptop');
  plantJob(root, files, 'job_laptop');
  const planted = files.readJson(path.join(root, 'job_laptop', 'job.bin'));
  Object.assign(planted, { keepsTemplate: true, laptopAnswers: { line: 0.35 }, answers: {}, scores: { '0:s0-1': 0.61, '0:s0-2': 0.2 } });
  files.writeJson(path.join(root, 'job_laptop', 'job.bin'), planted);
  files.writeJson(path.join(root, 'job_laptop', 'case.bin'), { signatures: [{ photo: 0, signature: [0.1, 0.2] }] });
  const jobs = createJobs({ root, files, key, startWorker, getClient: () => client, officer, appVersion: '0.4.0' });
  const before = jobs.get('job_laptop');
  check('a face close on this laptop is shown while Khozo has not answered, marked as the laptop\'s', before.toCheck.length === 1 && before.toCheck[0].key === '0:s0-1' && before.toCheck[0].verdict === 'laptop' && before.counts.laptop === 1);
  check('a face below the line is not', !before.toCheck.some((p) => p.key === '0:s0-2'));
  const kept = files.readJson(path.join(root, 'job_laptop', 'job.bin'));
  kept.answers = { '0:s0-1': { verdict: 'unlikely', engines: ['aarakshak', 'rekognition'] } };
  files.writeJson(path.join(root, 'job_laptop', 'job.bin'), kept);
  const after = createJobs({ root, files, key, startWorker, getClient: () => client, officer }).get('job_laptop');
  check('Khozo\'s answer takes the laptop\'s place', after.toCheck.length === 0 && after.counts.laptop === 0);
  const decided = await jobs.decide('job_laptop', '0:s0-1', 'not');
  const start = client.calls.started.find((c) => c.body.jobKey === 'job_laptop');
  check('Khozo is told the laptop keeps the case\'s signatures for the check', start?.body.keepsTemplate === 'yes' && decided.saved === true);
  jobs.remove('job_laptop');
  await until(() => client.calls.closeBodies.some((c) => c.jobId === 'vj_job_laptop'));
  const close = client.calls.closeBodies.find((c) => c.jobId === 'vj_job_laptop');
  check('T3.2: deleting the check deletes the kept signatures, and Khozo is told when', !fs.existsSync(path.join(root, 'job_laptop', 'case.bin')) && Number.isFinite(Date.parse(close?.body?.templateDeletedAt || '')));

  const plainRoot = path.join(tmp, 'jobs-no-laptop');
  const plain = createJobs({ root: plainRoot, files, key, startWorker, getClient: () => client, officer, getPolicy: () => ({ laptopAnswers: true, laptopLine: 0.4 }) });
  const id = plain.create({ report: { id: 'r_test', childName: 'Test Person' }, window: { mode: 'video', from: '1:00:00' }, files: [{ path: video, name: 'test.mp4', bytes: 1, duration: 40, width: 640, height: 360, camera: 'Test camera' }] });
  await untilDone(plain, id);
  check('without Aarakshak\'s model on the laptop there are no laptop answers, whatever Khozo allows', plain.get(id).keepsTemplate === false && plain.get(id).laptopAnswers === null);
  check('a stream address shows without its password', safeAddress('rtsp://admin:secret@192.168.1.64:554/ch1') === 'rtsp://***@192.168.1.64:554/ch1' && isStreamAddress('rtsp://cam/1') && !isStreamAddress('C:\\video.mp4'));
}

if (process.env.KHOZO_SMOKE_VIDEO && process.env.KHOZO_FACE_MODEL) {
  console.log('A live camera (the clip streamed over the network as a camera would)');
  const clip = process.env.KHOZO_SMOKE_VIDEO;
  const card = process.env.KHOZO_FACE_MODEL;
  const c = readModelCard(card);
  const model = { card, name: c.name, version: c.version, provider: c.provider, detectorPath: c.detectorPath || null, detectorScore: c.detectorScore };
  // The case photo: the clearest person in the clip, found by reading it once.
  const scanDir = path.join(tmp, 'live-scan');
  const detector = await loadDetector({ modelPath: model.detectorPath || undefined });
  const record = await scanFile(clip, { fps: 2, outDir: scanDir, detector, scoreMin: model.detectorScore ?? undefined });
  await detector.close();
  const best = [...record.tracks].sort((a, b) => b.quality - a.quality)[0];
  const casePhoto = fs.readFileSync(path.join(scanDir, best.picture));

  const runWatch = async ({ name, policy, goOffline = false }) => {
    const key = crypto.randomBytes(32);
    const files = secureFiles(key);
    const client = fakeClient();
    client.photo = async () => casePhoto;
    const alerts = [];
    const root = path.join(tmp, `jobs-live-${name}`);
    const port = 47000 + Math.floor(Math.random() * 2000);
    const sender = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', clip, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '25', '-f', 'mpegts', `udp://127.0.0.1:${port}?pkt_size=1316`], { stdio: 'ignore', windowsHide: true });
    const jobs = createJobs({ root, files, key, startWorker, getClient: () => client, officer: { id: 'u1', name: 'PSI Test' }, model, getPolicy: () => policy, onAlert: (jobId, p) => alerts.push({ at: Date.now(), p }) });
    const started = Date.now();
    const id = jobs.create({ report: { id: 'r_test', childName: 'Test Person' }, live: { address: `udp://127.0.0.1:${port}`, until: new Date(started + 120000).toISOString(), startedAt: new Date(started).toISOString() }, files: [{ camera: 'Kalupur railway station, platform 1 (live)' }] });
    // With no internet once the case's signatures are made: the laptop is on its own.
    if (goOffline) {
      await until(() => client.calls.caseReads > 0, 30000);
      await sleep(500);
      client.online = false;
    }
    await until(() => alerts.length > 0, 90000);
    await until(() => jobs.get(id).live.peopleSeen > 0, 30000);
    const view = jobs.get(id);
    jobs.pause(id);
    await untilDone(jobs, id, 30000);
    sender.kill();
    return { jobs, id, view, alerts, client, root, started };
  };

  const watched = await runWatch({ name: 'online', policy: { liveWatch: true } });
  console.log(`    first alert ${watched.alerts.length ? Math.round((watched.alerts[0].at - watched.started) / 100) / 10 : '-'} s after the stream started; ${watched.view.live.peopleSeen} people seen, ${watched.view.everyone.length} kept`);
  check('T3.3: a person close to the case is flagged to the desk within 60 seconds of the stream starting', watched.alerts.length > 0 && watched.alerts[0].at - watched.started <= 60000,
    `${watched.alerts.length ? Math.round((watched.alerts[0].at - watched.started) / 1000) : 'no'} s`);
  check('… on Khozo\'s answer, sent one face at a time with the camera place', watched.client.calls.searches.length > 0 && watched.client.calls.searches.every((s) => s.faces === 1 && s.camera === 'Kalupur railway station, platform 1 (live)'));
  const keptFaces = fs.readdirSync(path.join(watched.root, watched.id, 'files', '0', 'faces')).length;
  check('only faces close to the case are kept on the laptop, each with its whole frame', keptFaces === watched.view.everyone.length && keptFaces > 0
    && fs.readdirSync(path.join(watched.root, watched.id, 'files', '0', 'frames')).length === keptFaces && watched.view.live.peopleSeen >= keptFaces, `${keptFaces} kept, ${watched.view.live.peopleSeen} seen`);
  const frame = await watched.jobs.frame(watched.id, watched.view.everyone[0].key);
  check('"See full picture" shows the kept frame', frame.subarray(0, 2).toString('hex') === 'ffd8');
  const liveStart = watched.client.calls.started.find((s) => s.body.liveUntil);
  check('Khozo is told the watch\'s end, and the camera is marked live', liveStart && JSON.parse(liveStart.body.files)[0].live === true);

  const offline = await runWatch({ name: 'offline', policy: { liveWatch: true, laptopAnswers: true, laptopLine: 0.35 }, goOffline: true });
  console.log(`    with no internet: first alert ${offline.alerts.length ? Math.round((offline.alerts[0].at - offline.started) / 100) / 10 : '-'} s after the stream started`);
  check('scenario 10 with 11: with no internet, a face close on the laptop is flagged at once, marked as the laptop\'s', offline.alerts.length > 0 && offline.alerts[0].p.verdict === 'laptop' && offline.alerts[0].at - offline.started <= 60000,
    `${offline.alerts.length ? Math.round((offline.alerts[0].at - offline.started) / 1000) : 'no'} s, ${offline.alerts[0]?.p?.verdict}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
