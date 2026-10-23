/**
 * Checks Khozo Desktop's jobs (app/jobs.js) with the real scan worker, run
 * as a child process, and a stand-in for Khozo:
 *
 * - a job reads its video and finishes; its record and pictures on disk are
 *   encrypted;
 * - a job paused part-way carries on from where it stopped;
 * - the time window in clock time, and the note "Same person" adds to a case;
 * - the role list matches Khozo's, and every screen word is in Hindi and Gujarati.
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

/** A stand-in for Khozo: the first face of each request is "likely", the rest "unlikely". */
function fakeClient() {
  const calls = { searches: [], notes: [] };
  return {
    calls,
    getCase: async (id) => ({ id, childName: 'Test Person', status: 'missing', extraPhotos: [] }),
    photo: async () => { throw new Error('no photo'); },
    videoSearch: async (caseId, form) => {
      const faces = [...form.getAll('photo'), ...form.getAll('extraPhotos')];
      calls.searches.push({ caseId, faces: faces.length, camera: form.get('cameraPlace'), times: form.get('times'), firstBytes: Buffer.from(await faces[0].arrayBuffer()).subarray(0, 2).toString('hex') });
      return { results: faces.map((_, index) => ({ index, verdict: index === 0 && calls.searches.length === 1 ? 'likely' : 'unlikely', enginesAnswered: ['aarakshak'] })) };
    },
    addNote: async (caseId, note) => { calls.notes.push({ caseId, note }); return { ok: true }; },
  };
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

  // Opened again, as after a restart.
  const again = createJobs({ root, files, key, startWorker, getClient: () => client, officer: { id: 'u1', name: 'PSI Test' } });
  check('jobs are read back after a restart', again.list().length === 2);
  again.remove(id);
  check('deleting a job removes its folder', !fs.existsSync(path.join(root, id)) && again.list().length === 1);
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
  check('only face pictures are sent, five at most a request, with the camera', client.calls.searches.every((s) => s.faces <= 5 && s.firstBytes === 'ffd8' && s.camera === 'Kalupur railway station, gate 1'));
  check('Khozo’s answer is on the person, in clock time', job.toCheck.length === 1 && job.toCheck[0].verdict === 'likely' && /2:30|14:30/.test(job.toCheck[0].clock || ''), JSON.stringify(job.toCheck[0]));
  const someone = job.everyone[0];
  const rel = decodeURIComponent(someone.picture.split('/').slice(5).join('/'));
  const onDisk = fs.readFileSync(path.join(root, id, 'files', '0', rel));
  check('face pictures on disk are encrypted, and open as JPEG', onDisk.subarray(0, 2).toString('hex') !== 'ffd8' && jobs.picture(id, 0, rel).subarray(0, 2).toString('hex') === 'ffd8');
  const decision = await jobs.decide(id, job.toCheck[0].key, 'same');
  check('"Same person" adds a note to the case', decision.saved === true && client.calls.notes.length === 1 && client.calls.notes[0].note.includes('Kalupur railway station, gate 1'));
  await jobs.decide(id, job.everyone.at(-1).key, 'not');
  check('"Not this person" is kept on the laptop only', client.calls.notes.length === 1 && jobs.get(id).everyone.at(-1).decision.decision === 'not');
}

fs.rmSync(tmp, { recursive: true, force: true });
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
