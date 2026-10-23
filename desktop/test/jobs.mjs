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
import { fork, spawnSync } from 'node:child_process';
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
  const calls = { searches: [], notes: [], started: [], progress: [], decisions: [], closed: [] };
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
    getCase: async (id) => ({ id, childName: 'Test Person', status: 'missing', extraPhotos: [] }),
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
    closeVideoJob: async (caseId, jobId) => { reach(); calls.closed.push(jobId); return { job: {} }; },
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
}

fs.rmSync(tmp, { recursive: true, force: true });
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
