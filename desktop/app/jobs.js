// Jobs: one case, one or more videos, from start to the answers an officer
// looks at. Kept here, free of Electron, so it can be tested on its own.
//
// A job is either "Find this person" (one case) or a check against open
// cases (mode 2, shared/open-case-checks.js): no case on the laptop, and each
// person seen is searched among the open cases on Khozo.
//
// A job reads each video in turn (the scan worker), compares everyone seen
// with the case on the laptop when a face model is here, and sends the
// closest to Khozo while the next video is read. Everything is saved as it
// goes, encrypted (secure-store.js): a job stopped by the officer, a crash or
// a power cut carries on from its last saved point.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { formatVideoTime } from '../../web/src/video/faces.js';
import { FRAME_VERDICTS, isSmallVideo } from '../../shared/video-search.js';
import { sendFaces, sendOpenCaseFaces } from '../scanner/khozo.js';
import { chooseToSend } from '../scanner/local-match.js';
import { clockTime, VERDICT_WORDS } from '../scanner/review.js';
import { parseTime } from '../scanner/scan.js';
import { safeAddress } from '../scanner/live.js';

/** Without a face model on the laptop, at most this many people a video are sent, clearest first. */
export const SEND_LIMIT_WITHOUT_MODEL = 600;
/** With the first pass, how many pictures of one person go to Khozo: the one that scored best, then the clearest. */
export const PICTURES_TO_SEND = 3;
/**
 * With the first pass, how many of the closest people in a small video go to
 * Khozo (10 in any other). There the face model on the laptop ranks the
 * person among the closest but scores them low (an office camera at 352 x 288,
 * 23 Oct 2026: 0.10 where Rekognition gave 94), so a wider net goes to both of
 * Khozo's engines.
 */
export const SMALL_VIDEO_TOP = 30;
/**
 * The narrowest face kept, in the video's pixels, with a face model on
 * the laptop: 16, the finder's own floor, in every video. The browser keeps
 * 36 (MIN_FACE_PX) except in a small video, because every face it keeps is
 * sent; here the first pass sends only the closest few, and with five
 * pictures a person a 20 px face is matched well enough to be worth looking
 * at (23 Oct 2026, an office camera at 352 x 288: a volunteer found at 0.46
 * who at 36 px was never seen). Without the model, the browser's rule
 * (faces.js minFaceFor), as everyone found would be sent.
 */
export const SMALL_FACE_PX = 16;
/** A Khozo that kept no checks is asked again after this long: it may have been updated. */
const OLDER_KHOZO_RECHECK_MS = 6 * 3600 * 1000;

const JOB_FILE = 'job.bin';
/** The case's face signatures, kept encrypted for the check's life when Khozo allows laptop answers. */
const TEMPLATE_FILE = 'case.bin';
const OPEN_VERDICTS = ['likely', 'possible', 'not_agreed'];
/** "Look at these first", in order: Khozo's answers, then a face close on this laptop that Khozo has not answered yet. */
const FIRST_ORDER = ['likely', 'possible', 'not_agreed', 'laptop'];
/**
 * How many of the faces closest to the case on this laptop are shown for the
 * officer to look at when the face engines did not match them: an officer
 * can know a person the engines miss, and can send the face for review.
 */
export const CLOSEST_SHOWN = 5;
/** Seen together (spec F14): the people on the same camera within this many seconds of a confirmed moment. */
export const TOGETHER_SECONDS = 10;
const YEAR_MS = 365.25 * 86400000;

/** Whole years since a date or a time in milliseconds, or null. */
function yearsSince(value, now = Date.now()) {
  const at = Date.parse(value || '') || Number(value);
  return Number.isFinite(at) && at > 0 && at < now ? Math.floor((now - at) / YEAR_MS) : null;
}

/**
 * Where to read in one video, in seconds into the file, for the window the
 * officer chose: `{ from, to }`, or `{ outside: true }` when the window misses
 * the video. A window in clock time needs the time the recording starts; a
 * window that ends before it starts runs past midnight.
 */
export function windowFor(file, window) {
  if (!window || (!window.from && !window.to)) return { from: 0, to: null };
  if (window.mode === 'video') {
    return { from: parseTime(window.from) || 0, to: window.to ? parseTime(window.to) : null };
  }
  const start = Date.parse(file.recordedFrom || '');
  if (!Number.isFinite(start)) return { from: 0, to: null, noClock: true };
  const at = (value, dayOffset = 0) => {
    const [h, m = 0, s = 0] = String(value).split(':').map(Number);
    const d = new Date(start);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, s, 0);
    return d.getTime();
  };
  let from = window.from ? at(window.from) : start;
  let to = window.to ? at(window.to) : null;
  if (to != null && to <= from) to += 86400000;
  // A window earlier in the day than the recording's start may mean the next day.
  const end = start + (file.duration || 0) * 1000;
  if (to != null && to <= start && from + 86400000 < end) { from += 86400000; to += 86400000; }
  const out = { from: Math.max(0, (from - start) / 1000), to: to == null ? null : (to - start) / 1000 };
  if ((out.to != null && out.to <= 0) || (file.duration && out.from >= file.duration)) return { outside: true };
  return out;
}

/** The note an officer's "Same person" adds to the case, in words any desk can read later. */
export function noteFor({ job, file, track, verdict, officer }) {
  const clock = clockTime(file.recordedFrom, track.time, { dateStyle: 'medium', timeStyle: 'medium' });
  const engines = verdict === 'likely' ? 'Face engines: likely the same person, both agree.'
    : verdict === 'possible' ? 'Face engines: possibly the same person.'
      : verdict && VERDICT_WORDS[verdict] ? `Face engines: ${VERDICT_WORDS[verdict].toLowerCase()}.` : 'Face engines: not checked.';
  const mb = file.bytes ? `${Math.round(file.bytes / 1048576)} MB` : 'size not known';
  return [
    'CCTV check on a laptop (Khozo Desktop): an officer looked at this face and the video, and marked it as the same person.',
    `Camera: ${file.camera}.`,
    `Seen ${formatVideoTime(track.time)} into the video${clock ? ` (about ${clock})` : ''}.`,
    engines,
    `Video "${file.name}" (${mb})${file.sha256 ? `, fingerprint (SHA-256) ${file.sha256}` : ''}.`,
    `Marked by ${officer?.name || 'the officer'}${job.caseId ? ` for case ${job.caseId}` : ''}.`,
    'This is a lead, not an identification.',
  ].join(' ').slice(0, 1000);
}

const keyOf = (fileIndex, trackId) => `${fileIndex}:${trackId}`;
/** Decisions Khozo does not have yet and may still take (a refused one never will). */
const unsentOf = (job) => Object.values(job.decisions || {}).filter((d) => d.saved === false && !d.refused).length;
const tracksOf = (file) => (file.segments || []).flatMap((s) => s.tracks || []);
const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * The jobs of one officer on this laptop.
 *
 *   root           their folder (one per officer, so officers sharing a laptop never see each other's jobs)
 *   files          secureFiles(key), for job records and face pictures
 *   key            the same key, handed to the scan worker
 *   startWorker()  -> { request(type, task, onEvent) -> Promise, kill() }
 *   getClient()    -> the signed-in Khozo client
 *   model          { card, detectorPath, detectorScore, name, version, lines } or null;
 *                  `lines` (recognizer.js) are the model's own score lines, else Aarakshak's
 *   detectorPath   the YuNet file to find faces with (the app's own copy)
 *   officer        { id, name }
 *   appVersion     recorded with the check on Khozo
 *   device         this laptop's name, recorded with the check, so two laptops on one case can be told apart
 *   frameOf(file, track) -> JPEG   the whole frame, face marked, sent with "Same person"
 *   onChange(id)   a job changed; the window asks for it again
 *   onSignedOut()  Khozo no longer takes this officer's sign-in (expired, or the password changed); the jobs stay
 *   getPolicy()    what Khozo lets this app do (shared/desktop-policy.js), the last answer kept
 *   onAlert(id, person)   a live watch saw a face close to the case: tell the officer at the desk
 */
export function createJobs({
  root, files, key, startWorker, getClient, model = null, detectorPath = null, officer = {}, appVersion = null, device = null, frameOf = null,
  onChange = () => {}, onSignedOut = () => {}, getPolicy = () => ({}), onAlert = () => {}, checkpointMs = 30000, log = () => {},
}) {
  let toldSignedOut = false;
  const signedOut = () => {
    if (toldSignedOut) return;
    toldSignedOut = true;
    onSignedOut();
  };
  const finder = model?.detectorPath || detectorPath || null;
  const jobs = new Map();
  const caseSignatures = new Map(); // job id -> signatures, in memory only
  let active = null; // { id, controller, worker }
  const queue = [];

  fs.mkdirSync(root, { recursive: true });
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const job = files.readJson(path.join(root, entry.name, JOB_FILE));
      jobs.set(job.id, job);
    } catch (err) {
      log(`Job ${entry.name} could not be read: ${err.message}`);
    }
  }

  // Checks to close on Khozo for jobs deleted here, kept until Khozo has them.
  const CLOSES_FILE = path.join(root, 'closes.bin');
  let pendingCloses = [];
  try { pendingCloses = files.readJson(CLOSES_FILE); } catch { pendingCloses = []; }
  const saveCloses = () => files.writeJson(CLOSES_FILE, pendingCloses);
  let closing = null;
  function sendCloses() {
    closing ||= (async () => {
      // Each waiting close once a pass, including one added while the pass runs
      // (two checks deleted one after the other): it goes now, not at the next sync.
      const tried = new Set();
      for (let c = pendingCloses[0]; c; c = pendingCloses.find((x) => !tried.has(x.jobId))) {
        tried.add(c.jobId);
        const client = getClient();
        if (!client) break;
        try {
          if (c.mode === 'open_cases') await client.closeOpenCaseCheck(c.jobId);
          else await client.closeVideoJob(c.caseId, c.jobId, c.templateDeletedAt ? { templateDeletedAt: c.templateDeletedAt } : {});
        } catch (err) {
          if (err.status === 401) signedOut();
          // Not reached, or busy: tried again later. Anything else (gone, refused) is as closed as it will get.
          if (err.status === 0 || err.status === 401 || err.status === 429 || err.status >= 500) continue;
        }
        pendingCloses = pendingCloses.filter((x) => x.jobId !== c.jobId);
        saveCloses();
      }
    })().finally(() => { closing = null; });
    return closing;
  }

  const dirOf = (id) => path.join(root, id);
  const fileDir = (id, index) => path.join(dirOf(id), 'files', String(index));
  const save = (job) => {
    // A job deleted while its last request was still out is not written back.
    if (jobs.get(job.id) !== job) return;
    job.updatedAt = new Date().toISOString();
    files.writeJson(path.join(dirOf(job.id), JOB_FILE), job);
  };
  const changed = (job, persist = true) => {
    if (persist) save(job);
    onChange(job.id);
  };

  // ---- Khozo's record of the check (POST /reports/:id/video-jobs) ----------------
  //
  // Khozo keeps each check: the videos, how far the laptop got, the faces it
  // sent with the engines' answers, and the officer's decisions. Everything
  // waits here when Khozo cannot be reached and goes when it can. A Khozo
  // without these routes (not yet updated) gets the faces through the
  // browser's route and the "Same person" decisions as case notes.

  /** A recording start as the laptop's datetime-local value, as an ISO time. */
  const isoOf = (local) => (local && Number.isFinite(Date.parse(local)) ? new Date(Date.parse(local)).toISOString() : null);
  const seenAtOf = (file, track) => {
    const start = Date.parse(file.recordedFrom || '');
    return Number.isFinite(start) ? new Date(start + track.time * 1000).toISOString() : null;
  };

  /**
   * The check's id on Khozo, made the first time it is needed; null while
   * Khozo cannot be reached, or on a Khozo that does not keep checks. A
   * refusal that waiting will not change (signed out, no access, a closed
   * case) is thrown.
   */
  const starting = new Map(); // job id -> the request making its check, so it is never made twice at once
  function serverJob(job) {
    if (job.server?.jobId) return Promise.resolve(job.server.jobId);
    // An older Khozo may have been updated since: asked again after a while.
    if (job.server?.available === false && Date.now() - Date.parse(job.server.checkedAt || 0) < OLDER_KHOZO_RECHECK_MS) return Promise.resolve(null);
    if (!starting.has(job.id)) starting.set(job.id, startServerJob(job).finally(() => starting.delete(job.id)));
    return starting.get(job.id);
  }

  /** Whether a 404 means "this Khozo has no such route" (an older Khozo), not "no such case". */
  const routeMissing = (err) => err.status === 405 || err.status === 501 || (err.status === 404 && (!err.data?.error || /no route/i.test(err.data.error)));

  async function startServerJob(job) {
    const firstPass = model?.card && job.settings.firstPass;
    const videos = JSON.stringify(job.files.map((f, key) => ({
      key, name: f.name, bytes: f.bytes, seconds: f.duration, sha256: f.sha256 || null,
      cameraPlace: f.camera, lat: f.lat ?? null, lng: f.lng ?? null, recordedFrom: isoOf(f.recordedFrom), from: f.from, to: f.to,
      ...(f.live ? { live: true } : {}),
    })));
    try {
      const { job: made } = job.mode === 'open_cases'
        ? await getClient().startOpenCaseCheck({
          jobKey: job.id, appVersion, device, files: videos,
          ...Object.fromEntries(Object.entries(job.openCases?.filters || {}).filter(([, v]) => v != null && v !== '')),
        })
        : await getClient().startVideoJob(job.caseId, {
          jobKey: job.id, appVersion, device, files: videos,
          ...(firstPass ? { modelName: model.name, modelVersion: model.version, firstPassLine: job.settings.line, firstPassTop: job.settings.top } : {}),
          ...(job.keepsTemplate ? { keepsTemplate: 'yes' } : {}),
          ...(job.live ? { liveUntil: job.live.until } : {}),
        });
      job.server = { jobId: made.id, available: true };
      save(job);
      log(`Check kept on Khozo as ${made.id}`);
      return made.id;
    } catch (err) {
      // A check against open cases has no case to fall back on: it needs Khozo's own record.
      if (routeMissing(err) && job.mode === 'open_cases') throw new Error('This Khozo cannot check footage against open cases yet.');
      if (routeMissing(err) && job.live) throw new Error('This Khozo cannot watch a live camera yet.');
      if (routeMissing(err)) {
        job.server = { available: false, checkedAt: new Date().toISOString() };
        save(job);
        return null;
      }
      if (err.status === 0 || err.status === 429 || err.status >= 500) return null;
      if (err.status === 401) signedOut();
      throw err;
    }
  }

  /**
   * Where the faces go: the check on Khozo, or null for the browser's route
   * on an older Khozo. Waits, saying so, while Khozo cannot be reached.
   */
  async function checkFor(job, signal) {
    let pause = 30000;
    for (;;) {
      const jobId = await serverJob(job);
      if (jobId || job.server?.available === false || signal.aborted) return jobId;
      job.waiting = { reason: 'connection', seconds: pause / 1000 };
      changed(job, false);
      await sleep(pause, signal);
      pause = Math.min(pause * 2, 300000);
    }
  }

  /** What each video's state is, as Khozo's record of the check says it. */
  function fileState(f) {
    if (f.outside) return 'outside';
    if (f.error) return 'error';
    if (f.sent) return 'done';
    if (f.scanned) return 'checking';
    return f.scanTo ? 'reading' : 'waiting';
  }

  /**
   * Tells Khozo how far the laptop got; true once it is told. Marked as
   * waiting, and saved, before it goes: an app closed mid-send tells Khozo
   * where the check stopped the next time it opens.
   */
  async function syncProgress(job) {
    job.sync = { ...(job.sync || {}), progressPending: true };
    save(job);
    let jobId = null;
    try { jobId = await serverJob(job); } catch { /* the job itself reports it */ }
    if (!jobId) {
      if (job.server?.available === false) job.sync = { ...job.sync, progressPending: false };
      return false;
    }
    const status = job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : ['running', 'queued'].includes(job.status) ? 'running' : 'paused';
    try {
      const send = job.mode === 'open_cases' ? (body) => getClient().openCaseProgress(jobId, body) : (body) => getClient().videoJobProgress(job.caseId, jobId, body);
      await send({
        status,
        scanSeconds: Math.round(job.scanSeconds || 0),
        files: JSON.stringify(job.files.map((f, key) => ({
          key,
          secondsRead: Math.max(0, Math.round((f.scanTo ?? f.from ?? 0) - (f.from || 0))),
          // A live watch keeps only the faces close to the case, so it counts the others as it goes.
          peopleSeen: f.live ? f.peopleSeen ?? tracksOf(f).length : tracksOf(f).length,
          facesTooSmall: f.facesTooSmall || 0,
          state: fileState(f),
          sha256: f.sha256 || null,
        }))),
      });
      job.sync = { ...(job.sync || {}), progressPending: false, progressAt: new Date().toISOString() };
      return true;
    } catch (err) {
      if (err.status === 401) signedOut();
      // A refusal (a closed check, a closed case) is not sent again; a lost connection is.
      job.sync = { ...(job.sync || {}), progressPending: err.status === 0 || err.status === 429 || err.status >= 500 };
      return false;
    }
  }

  // While a video is read, Khozo hears how far it got every few minutes.
  const progressSent = new Map(); // job id -> when
  function progressSoon(job, everyMs = 120000) {
    if (Date.now() - (progressSent.get(job.id) || 0) < everyMs) return;
    progressSent.set(job.id, Date.now());
    syncProgress(job).then(() => save(job));
  }

  /** Sends one decision: to the check on Khozo, or, on an older Khozo, "Same person" as a case note. */
  const inFlight = new Set(); // `${job id}|${key}` while its decision is out, so it never goes twice at once
  async function syncDecision(job, k) {
    const flight = `${job.id}|${k}`;
    if (inFlight.has(flight)) return;
    inFlight.add(flight);
    try {
      await sendDecision(job, k);
    } finally {
      inFlight.delete(flight);
    }
  }

  /** A person's picture to show and send: the one the first pass scored best, else the clearest. */
  const bestPictureOf = (job, k, track) => job.bestPicture?.[k] || track.picture;

  /**
   * Which of a person's pictures go to Khozo (scan.js keeps up to five): with
   * the first pass, the one that scored best and then the clearest, up to
   * PICTURES_TO_SEND, under the person's one name, and Khozo keeps the best
   * answer; without it, the clearest one.
   */
  function picturesToSend(job, k, track) {
    const all = track.pictures?.length ? track.pictures.map((p) => p.file) : [track.picture];
    const best = job.bestPicture?.[k];
    if (!best) return all.slice(0, 1);
    return [best, ...all.filter((f) => f !== best)].slice(0, PICTURES_TO_SEND);
  }

  /** The whole frame with the face marked: kept from a live camera, or read again from the video. */
  async function frameBytes(job, index, file, track) {
    if (track.frame) return files.read(path.join(fileDir(job.id, index), track.frame));
    return frameOf ? frameOf(file, track) : null;
  }

  /** The face, and the whole frame with the face marked, for a sighting. */
  async function addPictures(form, job, index, file, track) {
    form.append('photo', new File([files.read(path.join(fileDir(job.id, index), bestPictureOf(job, keyOf(index, track.id), track)))], 'face.jpg', { type: 'image/jpeg' }));
    try {
      const frame = await frameBytes(job, index, file, track);
      if (frame) form.append('extraPhotos', new File([frame], 'frame.jpg', { type: 'image/jpeg' }));
    } catch { /* the video may have gone with its pen drive: the face alone */ }
  }

  /** Why a decision did not reach Khozo: `offline` goes again by itself, `refused` never will (the officer sees why). */
  function failed(d, err) {
    const offline = err.status === 0 || err.status === 429 || err.status >= 500;
    if (err.status === 401) signedOut();
    Object.assign(d, { saved: false, error: err.message, offline, refused: !offline && err.status !== 401 });
  }

  /**
   * Sends the officer's word on a lead of a check against open cases: "same"
   * sends the face and the frame to that case as a sighting; "not" sends no
   * picture of anyone. Khozo says only "sent" for a case outside the officer's area.
   */
  async function sendLeadDecision(job, leadId) {
    const d = job.decisions[leadId];
    const k = String(d?.person || '');
    const index = Number(k.split(':')[0]);
    const file = job.files[index];
    const track = file && tracksOf(file).find((t) => String(t.id) === k.slice(k.indexOf(':') + 1));
    if (!d || !track) return;
    try {
      const jobId = await serverJob(job);
      if (!jobId) {
        Object.assign(d, { saved: false, error: 'No connection to Khozo', offline: true });
        return;
      }
      const form = new FormData();
      form.append('decision', d.decision);
      const seenAt = seenAtOf(file, track);
      if (seenAt) form.append('seenAt', seenAt);
      if (d.decision === 'same') await addPictures(form, job, index, file, track);
      const res = await getClient().openCaseLead(jobId, leadId, form);
      Object.assign(d, { saved: true, via: 'check', sightingId: res.lead?.sightingId || null, error: null, offline: false });
    } catch (err) {
      failed(d, err);
    }
  }

  async function sendDecision(job, k) {
    if (job.mode === 'open_cases') return sendLeadDecision(job, k);
    const d = job.decisions[k];
    const index = Number(k.split(':')[0]);
    const trackId = k.slice(k.indexOf(':') + 1);
    const file = job.files[index];
    const track = file && tracksOf(file).find((t) => String(t.id) === trackId);
    if (!d || !track) return;
    try {
      const jobId = await serverJob(job);
      const client = getClient();
      if (jobId) {
        const form = new FormData();
        form.append('key', k);
        form.append('decision', d.decision);
        form.append('fileKey', String(index));
        form.append('t', String(track.time));
        if (job.answers[k]?.verdict) form.append('verdict', job.answers[k].verdict);
        if (job.scores[k] != null) form.append('closeness', String(job.scores[k]));
        const seenAt = seenAtOf(file, track);
        if (seenAt) form.append('seenAt', seenAt);
        // A "not this person" sends no picture of anyone.
        if (d.decision === 'same') await addPictures(form, job, index, file, track);
        const res = await client.videoJobDecision(job.caseId, jobId, form);
        Object.assign(d, { saved: true, via: 'check', sightingId: res.decision?.sightingId || null, error: null, offline: false });
      } else if (job.server?.available === false) {
        if (d.decision === 'same') await client.addNote(job.caseId, noteFor({ job, file, track, verdict: job.answers[k]?.verdict, officer }));
        Object.assign(d, { saved: true, via: d.decision === 'same' ? 'note' : 'laptop', error: null, offline: false });
      } else {
        Object.assign(d, { saved: false, error: 'No connection to Khozo', offline: true });
      }
    } catch (err) {
      failed(d, err);
    }
  }

  /** Sends what is waiting: decisions not yet sent, and progress Khozo has not heard. */
  async function syncPending(job) {
    let touched = false;
    for (const [k, d] of Object.entries(job.decisions || {})) {
      if (d.saved !== false || d.refused) continue;
      await syncDecision(job, k);
      touched = true;
    }
    if (job.sync?.progressPending && job.status !== 'running') {
      await syncProgress(job);
      touched = true;
    }
    if (touched) changed(job);
  }

  /**
   * A face's answer: Khozo's, or, where Khozo allows it and has not answered
   * yet (no internet), "laptop" for a face this laptop finds close to the case.
   */
  function verdictOf(job, k) {
    const khozo = job.answers[k]?.verdict || null;
    if (khozo && khozo !== 'no_answer') return khozo;
    return job.laptopAnswers && (job.scores[k] ?? -1) >= job.laptopAnswers.line ? 'laptop' : khozo;
  }

  function person(job, file, index, track) {
    const k = keyOf(index, track.id);
    return {
      key: k,
      fileIndex: index,
      camera: file.camera,
      live: Boolean(file.live),
      time: track.time,
      firstTime: track.firstTime,
      lastTime: track.lastTime,
      clock: clockTime(file.recordedFrom, track.time, { timeStyle: 'medium' }),
      verdict: verdictOf(job, k),
      // Which of Khozo's engines answered about this face, so a card can say why it was not matched.
      engines: job.answers[k]?.engines || [],
      closeness: job.scores[k] ?? null,
      quality: track.quality,
      decision: job.decisions[k] || null,
      picture: `khozo://picture/${job.id}/${index}/${encodeURIComponent(bestPictureOf(job, k, track).replace(/\\/g, '/'))}`,
      // A check against open cases: the cases this face was very close to, with the officer's word on each.
      leads: (job.answers[k]?.leads || []).map((lead) => ({ ...lead, decision: job.decisions[lead.id] || null })),
    };
  }

  /**
   * Seen together (spec F14): for each confirmed moment, the other people
   * on the same camera within ten seconds of it. Shown only; nobody here is
   * searched for.
   */
  function addTogether(people) {
    const confirmed = (p) => p.decision?.decision === 'same' || p.leads.some((l) => l.decision?.decision === 'same');
    for (const p of people) {
      if (!confirmed(p)) continue;
      p.together = people
        .filter((o) => o.fileIndex === p.fileIndex && o.key !== p.key
          && (o.firstTime ?? o.time) <= p.time + TOGETHER_SECONDS && (o.lastTime ?? o.time) >= p.time - TOGETHER_SECONDS)
        .sort((a, b) => a.time - b.time)
        .map((o) => ({ key: o.key, time: o.time, clock: o.clock, picture: o.picture }));
    }
  }

  /**
   * A check against open cases, grouped by case (F17): each case the officer
   * can open with its faces; the faces close to one case outside the
   * officer's area together, under a name from Khozo that does not say which case.
   */
  function groupsOf(people) {
    const groups = [];
    const byCase = new Map();
    for (const p of people) {
      const face = { key: p.key, fileIndex: p.fileIndex, camera: p.camera, time: p.time, clock: p.clock, picture: p.picture, together: p.together || null };
      for (const lead of p.leads) {
        const entry = { ...lead, person: face };
        const inScope = Boolean(lead.inScope && lead.case?.id);
        const groupKey = inScope ? `case:${lead.case.id}` : lead.caseKey ? `outside:${lead.caseKey}` : `lead:${lead.id}`;
        if (!byCase.has(groupKey)) {
          const group = { caseId: inScope ? lead.case.id : null, case: inScope ? lead.case : null, inScope, leads: [] };
          byCase.set(groupKey, group);
          groups.push(group);
        }
        byCase.get(groupKey).leads.push(entry);
      }
    }
    const best = (g) => Math.min(...g.leads.map((l) => l.rank ?? 9));
    for (const g of groups) g.leads.sort((a, b) => a.fileIndex - b.fileIndex || a.person.time - b.person.time);
    return groups.sort((a, b) => Number(b.inScope) - Number(a.inScope) || best(a) - best(b) || a.leads[0].person.time - b.leads[0].person.time);
  }

  /** A job as the window shows it. */
  function view(job) {
    const people = job.files.flatMap((file, index) => tracksOf(file).map((track) => person(job, file, index, track)));
    addTogether(people);
    const openCases = job.mode === 'open_cases';
    const rank = (v) => FIRST_ORDER.indexOf(v);
    const toCheck = people
      .filter((p) => FIRST_ORDER.includes(p.verdict))
      .sort((a, b) => rank(a.verdict) - rank(b.verdict) || (b.closeness ?? -2) - (a.closeness ?? -2) || b.quality - a.quality);
    const answered = people.filter((p) => p.verdict && p.verdict !== 'no_answer' && p.verdict !== 'laptop').length;
    return {
      id: job.id,
      mode: openCases ? 'open_cases' : 'case',
      caseId: job.caseId,
      caseName: job.caseName,
      caseFir: job.caseFir,
      // What a check against open cases searched: the officer's narrowing and how many cases.
      openCases: job.openCases || null,
      groups: openCases ? groupsOf(people) : null,
      // Scenario 8: a case missing for years has a photo at least that old, and its matches are weak.
      photoYears: job.photoYears ?? null,
      // A live camera watched until a set time (spec scenario 11). Never the stream's address with its password.
      live: job.live ? {
        until: job.live.until, startedAt: job.live.startedAt, address: safeAddress(job.live.address),
        stalled: job.live.stalled || null, peopleSeen: job.files[0]?.peopleSeen ?? 0, alerts: Object.keys(job.alerts || {}).length,
      } : null,
      // Faces this laptop finds close that Khozo has not answered yet (no internet), when Khozo allows it.
      laptopAnswers: job.laptopAnswers || null,
      keepsTemplate: Boolean(job.keepsTemplate),
      status: job.status,
      error: job.error || null,
      waiting: job.waiting || null,
      notice: job.notice || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      settings: job.settings,
      model: job.model || null,
      // Khozo's record of the check: kept there, waiting to go, or an older Khozo that keeps none.
      sync: {
        kept: Boolean(job.server?.jobId),
        olderKhozo: job.server?.available === false,
        // Decisions Khozo did not take; one still on its way is not counted.
        decisionsWaiting: Object.values(job.decisions).filter((d) => d.saved === false && d.error && !d.refused).length,
        // Every decision Khozo does not have yet, including one on its way: what deleting the job would lose.
        unsent: unsentOf(job),
        progressWaiting: Boolean(job.sync?.progressPending),
        at: job.sync?.progressAt || null,
      },
      files: job.files.map((file, index) => {
        const own = people.filter((p) => p.fileIndex === index);
        // A live watch: the share of its time gone by.
        const watch = file.live && job.live ? [Date.parse(job.live.startedAt), Date.parse(job.live.until)] : null;
        const span = watch ? (watch[1] - watch[0]) / 1000 : (file.to ?? file.duration ?? 0) - (file.from || 0);
        const reached = watch ? Math.min(span, (Math.min(Date.now(), watch[1]) - watch[0]) / 1000) : (file.scanTo ?? file.from ?? 0) - (file.from || 0);
        return {
          index,
          name: file.name,
          camera: file.camera,
          recordedFrom: file.recordedFrom,
          duration: file.duration,
          from: file.from,
          to: file.to,
          state: file.outside ? 'outside' : file.error ? 'error' : file.scanned ? (file.sent ? 'done' : 'checking') : (active?.id === job.id && active.fileIndex === index ? 'reading' : 'waiting'),
          error: file.error || null,
          progress: span > 0 ? Math.min(1, Math.max(0, reached / span)) : file.scanned ? 1 : 0,
          eta: file.eta ?? null,
          people: file.live ? file.peopleSeen ?? own.length : own.length,
          tooSmall: file.facesTooSmall || 0,
          checked: own.filter((p) => p.verdict && p.verdict !== 'no_answer').length,
        };
      }),
      counts: {
        people: people.length,
        checked: answered,
        likely: people.filter((p) => p.verdict === 'likely').length,
        possible: people.filter((p) => p.verdict === 'possible').length,
        laptop: people.filter((p) => p.verdict === 'laptop').length,
        leads: people.reduce((n, p) => n + p.leads.length, 0),
        tooSmall: job.files.reduce((n, f) => n + (f.facesTooSmall || 0), 0),
      },
      toCheck,
      // The closest faces the engines did not match (CLOSEST_SHOWN), never an answer of their own.
      closest: openCases ? [] : people
        .filter((p) => !FIRST_ORDER.includes(p.verdict) && p.closeness != null)
        .sort((a, b) => b.closeness - a.closeness)
        .slice(0, CLOSEST_SHOWN),
      everyone: people.sort((a, b) => a.fileIndex - b.fileIndex || a.time - b.time),
    };
  }

  function summary(job) {
    const v = view(job);
    return { id: v.id, mode: v.mode, openCases: v.openCases, caseId: v.caseId, caseName: v.caseName, caseFir: v.caseFir, status: v.status, error: v.error, createdAt: v.createdAt, updatedAt: v.updatedAt, files: v.files.length, counts: v.counts, progress: v.files.length ? v.files.reduce((n, f) => n + f.progress, 0) / v.files.length : 0 };
  }

  // ---- the work ----------------------------------------------------------------

  async function scanOne(job, index, worker) {
    const file = job.files[index];
    file.segments ||= [];
    const last = file.segments.at(-1);
    if (last && !last.done) last.done = true; // keep what its last checkpoint saved
    const k = file.segments.length;
    const from = file.scanTo ?? file.from ?? 0;
    const segment = { index: k, from, to: from, done: false, tracks: [] };
    file.segments.push(segment);
    save(job);
    const before = tracksOf(file).length;
    const started = Date.now();
    const result = await worker.request('scan', {
      // A small video keeps the scanner's own smallest face (faces.js minFaceFor), smaller than SMALL_FACE_PX.
      file: file.path, from, to: file.to, fps: job.settings.fps, maxSide: job.settings.maxSide,
      minFace: isSmallVideo(file.width, file.height) ? undefined : job.settings.minFace,
      scoreMin: model?.detectorScore ?? null, detectorPath: finder,
      idPrefix: `s${k}-`, fileDir: fileDir(job.id, index), key, checkpointMs,
    }, (event) => {
      if (event.event === 'progress') {
        file.scanTo = event.t;
        const done = event.t - from;
        const left = (event.to ?? file.duration ?? event.t) - event.t;
        file.eta = done > 0 ? Math.round(((Date.now() - started) / 1000) * (left / done)) : null;
        changed(job, false);
      } else if (event.event === 'checkpoint') {
        segment.tracks = event.tracks;
        segment.to = event.t;
        file.scanTo = event.t;
        file.facesTooSmall = (file.facesTooSmallBefore || 0) + event.facesTooSmall;
        changed(job);
        progressSoon(job);
      }
    });
    segment.tracks = result.tracks;
    segment.to = result.window.to ?? result.duration;
    segment.done = true;
    file.facesTooSmallBefore = (file.facesTooSmallBefore || 0) + result.facesTooSmall;
    file.facesTooSmall = file.facesTooSmallBefore;
    file.scanTo = segment.to;
    file.sha256 = result.sha256;
    file.scanned = true;
    file.eta = null;
    log(`Read ${file.name}: ${tracksOf(file).length - before} more people`);
    changed(job);
  }

  async function signaturesOfCase(job, worker) {
    if (caseSignatures.has(job.id)) return caseSignatures.get(job.id);
    // Kept for the check (no internet now, or the app opened again): the
    // signatures only, never the case's photos; deleted with the check.
    const kept = path.join(dirOf(job.id), TEMPLATE_FILE);
    if (job.keepsTemplate && fs.existsSync(kept)) {
      try {
        const saved = files.readJson(kept);
        caseSignatures.set(job.id, saved.signatures);
        job.model ||= saved.model;
        return saved.signatures;
      } catch (err) {
        log(`The kept case signatures could not be read: ${err.message}`);
      }
    }
    const client = getClient();
    const report = await client.getCase(job.caseId);
    const photos = [];
    for (const photoId of [null, ...(report.extraPhotos || []).map((p) => p.id)]) {
      try { photos.push(await client.photo(job.caseId, photoId)); } catch { /* a photo that cannot be read is left out */ }
    }
    const result = await worker.request('caseSignatures', { photos, card: model.card, detectorPath: finder });
    job.model = { ...result.model, casePhotos: result.signatures.length };
    caseSignatures.set(job.id, result.signatures);
    if (job.keepsTemplate) files.writeJson(kept, { model: job.model, signatures: result.signatures, at: new Date().toISOString() });
    return result.signatures;
  }

  async function scoreOne(job, index, worker) {
    const file = job.files[index];
    const sigs = await signaturesOfCase(job, worker);
    if (!sigs.length) {
      job.notice = 'no_case_face';
      return;
    }
    const tracks = tracksOf(file).filter((t) => job.scores[keyOf(index, t.id)] == null);
    if (tracks.length) {
      const result = await worker.request('signatures', {
        fileDir: fileDir(job.id, index), key, card: model.card, detectorPath: finder,
        caseSignatures: sigs, tracks: tracks.map((t) => ({ key: keyOf(index, t.id), picture: t.picture, pictures: t.pictures, landmarks: t.landmarks })),
      });
      Object.assign(job.scores, result.scores);
      Object.assign(job.bestPicture ||= {}, result.best || {});
    }
    file.scored = true;
    changed(job);
  }

  /**
   * A check against open cases: each person's best picture, clearest first,
   * searched among the open cases on Khozo, one at a time.
   */
  async function sendToOpenCases(job, index, signal) {
    const file = job.files[index];
    const tracks = tracksOf(file).map((t) => ({ ...t, id: keyOf(index, t.id) }));
    const candidates = [...tracks].sort((a, b) => b.quality - a.quality).slice(0, SEND_LIMIT_WITHOUT_MODEL);
    if (tracks.length > SEND_LIMIT_WITHOUT_MODEL) job.notice = 'send_limit';
    const toSend = candidates.filter((t) => !job.answers[t.id] || job.answers[t.id].verdict === 'no_answer');
    if (toSend.length && job.budgetReached) {
      file.sent = true;
      changed(job);
      return;
    }
    if (toSend.length) {
      const jobId = await checkFor(job, signal);
      if (signal.aborted) return;
      let answered = 0;
      try {
        await sendOpenCaseFaces({
          client: getClient(),
          jobId,
          fileKey: index,
          tracks: toSend,
          readPicture: (t) => files.read(path.join(fileDir(job.id, index), t.picture)),
          signal,
          onAnswer: (id, answer) => {
            job.answers[id] = answer;
            job.waiting = null;
            answered += 1;
            // Saved every ten faces, and at once for a face with a lead: a run
            // stopped in between sends at most nine again, answered from Khozo's record.
            changed(job, answered % 10 === 0 || answer.leads.length > 0);
          },
          onWait: (wait) => {
            job.waiting = wait;
            changed(job, false);
          },
        });
      } catch (err) {
        save(job);
        if (err.status !== 409 || err.data?.code !== 'face_budget') throw err;
        job.budgetReached = true;
        job.notice = 'face_budget';
        file.sent = true;
        changed(job);
        return;
      }
    }
    if (!signal.aborted) file.sent = true;
    changed(job);
  }

  async function sendOne(job, index, signal) {
    if (job.mode === 'open_cases') return sendToOpenCases(job, index, signal);
    const file = job.files[index];
    const tracks = tracksOf(file).map((t) => ({ ...t, id: keyOf(index, t.id) }));
    let candidates;
    if (file.scored && Object.keys(job.scores).length) {
      // In a small video the laptop's own scores are weak (faces.js), so more of the closest go to both of Khozo's engines.
      const top = isSmallVideo(file.width, file.height) ? Math.max(job.settings.top, SMALL_VIDEO_TOP) : job.settings.top;
      candidates = chooseToSend(tracks, job.scores, { line: job.settings.line, top });
    } else {
      candidates = [...tracks].sort((a, b) => b.quality - a.quality).slice(0, SEND_LIMIT_WITHOUT_MODEL);
      if (tracks.length > SEND_LIMIT_WITHOUT_MODEL) job.notice = 'send_limit';
    }
    const toSend = candidates.filter((t) => !job.answers[t.id] || job.answers[t.id].verdict === 'no_answer');
    // The check has sent all the faces one check may send: the rest are read, not sent.
    if (toSend.length && job.budgetReached) {
      file.sent = true;
      changed(job);
      return;
    }
    if (toSend.length) {
      file.searchId ||= `vs_${crypto.randomBytes(9).toString('base64url')}`;
      const jobId = await checkFor(job, signal);
      if (signal.aborted) return;
      try {
        await sendFaces({
          job: jobId ? { jobId, fileKey: index } : null,
          client: getClient(),
          caseId: job.caseId,
          record: { name: file.name, bytes: file.bytes, duration: file.duration, sha256: file.sha256, tracks, facesTooSmall: file.facesTooSmall, small: isSmallVideo(file.width, file.height) },
          tracks: toSend,
          camera: file.camera,
          recordedFrom: file.recordedFrom,
          searchId: file.searchId,
          readPicture: (t, picture = t.picture) => files.read(path.join(fileDir(job.id, index), picture)),
          picturesOf: (t) => picturesToSend(job, t.id, t),
          signal,
          onAnswers: (answers) => {
            Object.assign(job.answers, answers);
            job.waiting = null;
            changed(job);
          },
          onWait: (wait) => {
            job.waiting = wait;
            changed(job, false);
          },
        });
      } catch (err) {
        if (err.status !== 409 || err.data?.code !== 'face_budget') throw err;
        // What was answered stays; the officer is told the rest was not sent.
        job.budgetReached = true;
        job.notice = 'face_budget';
        file.sent = true;
        changed(job);
        return;
      }
    }
    if (!signal.aborted) {
      file.sent = true;
      changed(job);
    }
  }

  // ---- a live camera (spec scenario 11) ----------------------------------------

  /** Tells the officer at the desk, once a face, that a live watch saw someone close to the case. */
  function alertOnce(job, k, kind) {
    job.alerts ||= {};
    if (job.alerts[k]) return;
    job.alerts[k] = { at: new Date().toISOString(), kind };
    const file = job.files[0];
    const track = tracksOf(file).find((t) => keyOf(0, t.id) === k);
    if (track) onAlert(job.id, person(job, file, 0, track));
  }

  /** Sends live faces to Khozo one at a time, in the order they were seen; an answer worth a look alerts the desk. */
  function liveSender(job, signal) {
    const queue = [];
    let running = null;
    const file = job.files[0];
    file.searchId ||= `vs_${crypto.randomBytes(9).toString('base64url')}`;
    async function drain() {
      while (queue.length && !signal.aborted) {
        const k = queue.shift();
        const track = tracksOf(file).find((t) => keyOf(0, t.id) === k);
        if (!track || (job.answers[k] && job.answers[k].verdict !== 'no_answer')) continue;
        const jobId = await checkFor(job, signal);
        if (signal.aborted || !jobId) return;
        try {
          await sendFaces({
            job: { jobId, fileKey: 0 },
            client: getClient(),
            caseId: job.caseId,
            record: { name: file.name, bytes: null, duration: null, sha256: null, tracks: tracksOf(file), facesTooSmall: file.facesTooSmall || 0 },
            tracks: [{ ...track, id: k }],
            camera: file.camera,
            recordedFrom: file.recordedFrom,
            searchId: file.searchId,
            readPicture: (t, picture = t.picture) => files.read(path.join(fileDir(job.id, 0), picture)),
            signal,
            onAnswers: (answers) => {
              Object.assign(job.answers, answers);
              job.waiting = null;
              const verdict = answers[k]?.verdict;
              if (['likely', 'possible'].includes(verdict)) alertOnce(job, k, verdict);
              changed(job);
            },
            onWait: (wait) => { job.waiting = wait; changed(job, false); },
          });
        } catch (err) {
          if (err.status === 409 && err.data?.code === 'face_budget') { job.budgetReached = true; job.notice = 'face_budget'; changed(job); return; }
          if (err.status === 409 && err.data?.code === 'live_ended') return;
          throw err;
        }
      }
    }
    return {
      // A face left in the queue when a send stops (an older Khozo, a stop) goes with the next one.
      add(k) {
        queue.push(k);
        running ||= drain().catch((err) => { job.error = err.message; changed(job); }).finally(() => { running = null; });
      },
      done: () => running || Promise.resolve(),
    };
  }

  /** Watches the live camera until its end, its stop, or a problem waiting will not fix. */
  async function runLive(job) {
    const controller = new AbortController();
    const worker = startWorker();
    const started = Date.now();
    active = { id: job.id, controller, worker, fileIndex: 0 };
    job.status = 'running';
    job.error = null;
    job.interrupted = false;
    changed(job);
    const file = job.files[0];
    file.segments ||= [];
    const segment = { index: file.segments.length, from: 0, to: null, done: false, tracks: [] };
    file.segments.push(segment);
    const sender = liveSender(job, controller.signal);
    try {
      if (Date.now() >= Date.parse(job.live.until)) throw Object.assign(new Error('ended'), { ended: true });
      const sigs = await signaturesOfCase(job, worker);
      if (!sigs.length) throw new Error('No face was found in the case photos, so the camera cannot be watched for this person.');
      save(job);
      await worker.request('watch', {
        address: job.live.address,
        until: Date.parse(job.live.until),
        startedAt: Date.parse(job.live.startedAt),
        fps: job.settings.fps,
        maxSide: job.settings.maxSide,
        minFace: job.settings.minFace,
        scoreMin: model?.detectorScore ?? null,
        detectorPath: finder,
        card: model.card,
        caseSignatures: sigs,
        line: job.settings.line,
        idPrefix: `w${segment.index}-`,
        fileDir: fileDir(job.id, 0),
        key,
      }, (event) => {
        if (event.event === 'close') {
          const t = event.track;
          const k = keyOf(0, t.id);
          const at = segment.tracks.findIndex((x) => x.id === t.id);
          if (at >= 0) segment.tracks[at] = t; else segment.tracks.push(t);
          job.scores[k] = t.closeness;
          job.live.stalled = null;
          if (job.laptopAnswers && t.closeness >= job.laptopAnswers.line) alertOnce(job, k, 'laptop');
          changed(job);
          sender.add(k);
        } else if (event.event === 'progress') {
          file.scanTo = event.seconds;
          file.peopleSeen = event.people;
          file.facesTooSmall = event.facesTooSmall;
          job.live.stalled = null;
          changed(job, false);
          progressSoon(job);
        } else if (event.event === 'stall') {
          job.live.stalled = event.error;
          changed(job, false);
        }
      });
      segment.done = true;
      await sender.done();
      job.status = controller.signal.aborted ? 'paused' : 'done';
    } catch (err) {
      if (err.ended || Date.now() >= Date.parse(job.live.until)) job.status = 'done';
      else if (controller.signal.aborted) job.status = 'paused';
      else {
        job.status = 'error';
        job.error = err.status === 401 ? 'signed_out' : err.message;
        if (err.status === 401) signedOut();
      }
    } finally {
      worker.kill();
      segment.done = true;
      job.waiting = null;
      job.scanSeconds = (job.scanSeconds || 0) + (Date.now() - started) / 1000;
      active = null;
      changed(job);
      if (jobs.get(job.id) === job) {
        progressSent.set(job.id, Date.now());
        syncProgress(job).then(() => changed(job));
      }
      next();
    }
  }

  async function run(job) {
    if (job.live) return runLive(job);
    const controller = new AbortController();
    const worker = startWorker();
    const started = Date.now();
    active = { id: job.id, controller, worker, fileIndex: null };
    job.status = 'running';
    job.error = null;
    job.interrupted = false;
    changed(job);
    const sending = [];
    try {
      for (const [index, file] of job.files.entries()) {
        if (controller.signal.aborted) break;
        if (file.outside) continue;
        active.fileIndex = index;
        if (!file.scanned) {
          try {
            await scanOne(job, index, worker);
          } catch (err) {
            if (controller.signal.aborted) break;
            file.error = err.message.split('\n')[0];
            changed(job);
            continue;
          }
        }
        if (controller.signal.aborted) break;
        if (model?.card && job.settings.firstPass && !file.scored) {
          try {
            await scoreOne(job, index, worker);
          } catch (err) {
            // No internet for the case's photos and none kept: this video's faces go to Khozo later, without a first pass.
            if (err.status !== 0) throw err;
            job.waiting = { reason: 'connection', seconds: 30 };
            changed(job, false);
          }
        }
        if (!file.sent) sending.push(sendOne(job, index, controller.signal));
      }
      active.fileIndex = null;
      await Promise.all(sending);
      job.status = controller.signal.aborted ? 'paused' : 'done';
    } catch (err) {
      if (controller.signal.aborted) job.status = 'paused';
      else {
        job.status = 'error';
        job.error = err.status === 401 ? 'signed_out' : err.message;
        if (err.status === 401) signedOut();
      }
    } finally {
      worker.kill();
      job.waiting = null;
      job.scanSeconds = (job.scanSeconds || 0) + (Date.now() - started) / 1000;
      active = null;
      changed(job);
      // Khozo hears where the check stopped: finished, paused or stuck.
      if (jobs.get(job.id) === job) {
        progressSent.set(job.id, Date.now());
        syncProgress(job).then(() => changed(job));
      }
      next();
    }
  }

  function next() {
    if (active) return;
    while (queue.length) {
      const job = jobs.get(queue.shift());
      if (job && job.status === 'queued') {
        run(job);
        return;
      }
    }
  }

  return {
    list: () => [...jobs.values()].map(summary).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    get: (id) => (jobs.has(id) ? view(jobs.get(id)) : null),

    /**
     * A new job for one case and its videos, or, with `openCases` ({ filters,
     * casesSearched, area }) and no case, a check against open cases. It
     * starts as soon as the laptop is free.
     */
    create({ report = null, openCases = null, live = null, files: chosen, window = null, settings = {} }) {
      const id = `job_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`;
      const job = {
        id,
        mode: openCases ? 'open_cases' : 'case',
        caseId: report?.id || null,
        caseName: report ? report.childName || report.name || '' : '',
        caseFir: report ? report.firNo || report.firNumber || '' : '',
        ...(openCases ? { openCases: { filters: openCases.filters || {}, casesSearched: openCases.casesSearched ?? null, area: openCases.area || null } } : {}),
        // How old the case photo is, at least: a case missing for years has a photo from then or before.
        photoYears: report ? yearsSince(report.dateOfMissing || report.createdAt) : null,
        officer: { id: officer.id || null, name: officer.name || null },
        createdAt: new Date().toISOString(),
        status: 'queued',
        window,
        // No case on the laptop for a check against open cases, so no first pass here.
        settings: { fps: 2, maxSide: 960, line: model?.lines?.send ?? 0.25, top: 10, firstPass: Boolean(model?.card) && !openCases, minFace: model?.card ? SMALL_FACE_PX : undefined, ...settings },
        // Where Khozo allows it (shared/desktop-policy.js laptopAnswers): the
        // case's signatures kept encrypted for the check, and a face close on
        // this laptop shown while Khozo has not answered.
        ...(() => {
          const policy = getPolicy() || {};
          const allowed = Boolean(policy.laptopAnswers && model?.card && !openCases);
          // Khozo's laptop line is on Aarakshak's scale; a card for another model carries its own.
          return allowed ? { keepsTemplate: true, laptopAnswers: { line: model?.lines?.laptop ?? (Number(policy.laptopLine) || 0.35) } } : { keepsTemplate: false, laptopAnswers: null };
        })(),
        // A live camera (spec scenario 11): its address stays in this encrypted record and never goes to Khozo.
        live: live ? { address: live.address, until: live.until, startedAt: live.startedAt, stalled: null } : null,
        alerts: {},
        files: live ? [{
          path: null, name: 'Live camera', bytes: null, duration: null, camera: chosen[0].camera, lat: chosen[0].lat ?? null, lng: chosen[0].lng ?? null,
          recordedFrom: live.startedAt, from: 0, to: null, outside: false, live: true, segments: [], scanned: false, scored: true, sent: false, peopleSeen: 0,
        }] : chosen.map((f) => {
          const span = windowFor(f, window);
          return {
            path: f.path, name: f.name, bytes: f.bytes, duration: f.duration, width: f.width, height: f.height, codec: f.codec,
            camera: f.camera, lat: f.lat ?? null, lng: f.lng ?? null, recordedFrom: f.recordedFrom || null,
            from: span.from ?? 0, to: span.to ?? null, outside: Boolean(span.outside),
            segments: [], scanned: false, scored: false, sent: false,
          };
        }),
        scores: {},
        answers: {},
        decisions: {},
      };
      jobs.set(id, job);
      save(job);
      queue.push(id);
      onChange(id);
      next();
      return id;
    },

    start(id) {
      const job = jobs.get(id);
      if (!job || job.status === 'running' || job.status === 'queued') return;
      job.status = 'queued';
      changed(job);
      queue.push(id);
      next();
    },

    pause(id) {
      const job = jobs.get(id);
      if (!job) return;
      if (active?.id === id) {
        active.controller.abort();
        active.worker.kill();
      } else if (job.status === 'queued') {
        job.status = 'paused';
        changed(job);
      }
    },

    /** Deletes a job and every picture it holds from this laptop; its record on Khozo is closed and stays with the case. */
    remove(id) {
      if (active?.id === id) {
        active.controller.abort();
        active.worker.kill();
      }
      const job = jobs.get(id);
      if (job?.server?.jobId) {
        // Kept until Khozo has it: a laptop offline now closes the check when it is back.
        // With it goes when the case's signatures kept for the check were deleted: now, with the folder.
        pendingCloses.push({ mode: job.mode || 'case', caseId: job.caseId, jobId: job.server.jobId, ...(job.keepsTemplate ? { templateDeletedAt: new Date().toISOString() } : {}) });
        saveCloses();
        sendCloses();
      }
      jobs.delete(id);
      caseSignatures.delete(id);
      fs.rmSync(dirOf(id), { recursive: true, force: true });
      onChange(id);
    },

    removeAll() {
      for (const id of [...jobs.keys()]) this.remove(id);
    },

    /** After a crash or power cut: jobs left running carry on. */
    resumeInterrupted() {
      for (const job of jobs.values()) {
        if (job.status === 'running' || job.status === 'queued') {
          job.status = 'queued';
          job.interrupted = true;
          save(job);
          queue.push(job.id);
        }
      }
      next();
    },

    /** Deletes jobs nobody has touched for `days`, once Khozo has everything they hold. */
    sweep(days = 30) {
      const limit = Date.now() - days * 86400000;
      for (const job of [...jobs.values()]) {
        if (Date.parse(job.updatedAt || job.createdAt) >= limit || job.status === 'running') continue;
        // Sent first (syncAll), deleted on a later day.
        if (unsentOf(job) || job.sync?.progressPending) continue;
        this.remove(job.id);
      }
    },

    /**
     * The officer's decision on one person. "same" becomes a sighting of the
     * case on Khozo, waiting for the case's review (a note on an older
     * Khozo); "not" is counted there as a false alarm, with no picture sent.
     * A decision Khozo could not take waits here and goes with syncAll().
     */
    async decide(id, key, decision) {
      const job = jobs.get(id);
      if (!job) throw new Error('No such job');
      if (!['same', 'not'].includes(decision)) throw new Error('Say whether this is the same person');
      const [index, trackId] = [Number(key.split(':')[0]), key.slice(key.indexOf(':') + 1)];
      const file = job.files[index];
      const track = file && tracksOf(file).find((t) => String(t.id) === trackId);
      if (!track) throw new Error('No such person in this job');
      job.decisions[key] = { decision, at: new Date().toISOString(), by: officer.name || null, saved: false };
      changed(job);
      await syncDecision(job, key);
      changed(job);
      return job.decisions[key];
    },

    /**
     * The officer's word on one lead of a check against open cases: "same"
     * sends the face to that case as a sighting, for its officers to review;
     * "not" is counted as a false alarm. Waits here, like any decision, when
     * Khozo cannot be reached.
     */
    async decideLead(id, leadId, decision) {
      const job = jobs.get(id);
      if (!job || job.mode !== 'open_cases') throw new Error('No such check against open cases');
      if (!['same', 'not'].includes(decision)) throw new Error('Say whether to send this face');
      const owner = Object.entries(job.answers).find(([, a]) => (a?.leads || []).some((l) => l.id === leadId));
      if (!owner) throw new Error('No such face in this check');
      job.decisions[leadId] = { decision, at: new Date().toISOString(), by: officer.name || null, saved: false, person: owner[0], leadId };
      changed(job);
      await syncDecision(job, leadId);
      changed(job);
      return job.decisions[leadId];
    },

    /** Sends everything waiting for Khozo: decisions, and where each check stopped. */
    async syncAll() {
      for (const job of [...jobs.values()]) {
        if (jobs.get(job.id) === job) await syncPending(job);
      }
      await sendCloses();
    },

    /** How many decisions Khozo does not have yet: in one job, or in all of them. */
    unsent(id = null) {
      return id ? (jobs.has(id) ? unsentOf(jobs.get(id)) : 0) : [...jobs.values()].reduce((n, job) => n + unsentOf(job), 0);
    },

    /** A face picture of a job, decrypted. */
    picture(id, index, relative) {
      const dir = fileDir(id, index);
      const file = path.resolve(dir, relative);
      if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error('Not a picture of this job');
      return files.read(file);
    },

    /** The whole frame of a person's moment, face marked: kept from a live camera, or read again from the video. */
    async frame(id, key) {
      const found = this.personOf(id, key);
      if (!found) throw new Error('This person is not in the job');
      return frameBytes(jobs.get(id), Number(key.split(':')[0]), found.file, found.track);
    },

    /** The video and the person, for a frame or a clip. */
    personOf(id, key) {
      const job = jobs.get(id);
      if (!job) return null;
      const index = Number(key.split(':')[0]);
      const trackId = key.slice(key.indexOf(':') + 1);
      const file = job.files[index];
      const track = file && tracksOf(file).find((t) => String(t.id) === trackId);
      return track ? { file, track } : null;
    },

    activeId: () => active?.id || null,
  };
}
