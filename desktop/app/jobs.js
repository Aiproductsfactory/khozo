// Jobs: one case, one or more videos, from start to the answers an officer
// looks at. Kept here, free of Electron, so it can be tested on its own.
//
// A job reads each video in turn (the scan worker), compares everyone seen
// with the case on the laptop when Aarakshak's model is here, and sends the
// closest to Khozo while the next video is read. Everything is saved as it
// goes, encrypted (secure-store.js): a job stopped by the officer, a crash or
// a power cut carries on from its last saved point.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { formatVideoTime } from '../../web/src/video/faces.js';
import { FRAME_VERDICTS } from '../../shared/video-search.js';
import { sendFaces } from '../scanner/khozo.js';
import { chooseToSend } from '../scanner/local-match.js';
import { clockTime, VERDICT_WORDS } from '../scanner/review.js';
import { parseTime } from '../scanner/scan.js';

/** Without Aarakshak's model on the laptop, at most this many people a video are sent, clearest first. */
export const SEND_LIMIT_WITHOUT_MODEL = 600;

const JOB_FILE = 'job.bin';
const OPEN_VERDICTS = ['likely', 'possible', 'not_agreed'];

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
const tracksOf = (file) => (file.segments || []).flatMap((s) => s.tracks || []);

/**
 * The jobs of one officer on this laptop.
 *
 *   root           their folder (one per officer, so officers sharing a laptop never see each other's jobs)
 *   files          secureFiles(key), for job records and face pictures
 *   key            the same key, handed to the scan worker
 *   startWorker()  -> { request(type, task, onEvent) -> Promise, kill() }
 *   getClient()    -> the signed-in Khozo client
 *   model          { card, detectorPath, detectorScore, name, version } or null
 *   detectorPath   the YuNet file to find faces with (the app's own copy)
 *   officer        { id, name }
 *   onChange(id)   a job changed; the window asks for it again
 */
export function createJobs({ root, files, key, startWorker, getClient, model = null, detectorPath = null, officer = {}, onChange = () => {}, checkpointMs = 30000, log = () => {} }) {
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

  const dirOf = (id) => path.join(root, id);
  const fileDir = (id, index) => path.join(dirOf(id), 'files', String(index));
  const save = (job) => {
    job.updatedAt = new Date().toISOString();
    files.writeJson(path.join(dirOf(job.id), JOB_FILE), job);
  };
  const changed = (job, persist = true) => {
    if (persist) save(job);
    onChange(job.id);
  };

  function person(job, file, index, track) {
    const k = keyOf(index, track.id);
    return {
      key: k,
      fileIndex: index,
      camera: file.camera,
      time: track.time,
      firstTime: track.firstTime,
      lastTime: track.lastTime,
      clock: clockTime(file.recordedFrom, track.time, { timeStyle: 'medium' }),
      verdict: job.answers[k]?.verdict || null,
      closeness: job.scores[k] ?? null,
      quality: track.quality,
      decision: job.decisions[k] || null,
      picture: `khozo://picture/${job.id}/${index}/${encodeURIComponent(track.picture.replace(/\\/g, '/'))}`,
    };
  }

  /** A job as the window shows it. */
  function view(job) {
    const people = job.files.flatMap((file, index) => tracksOf(file).map((track) => person(job, file, index, track)));
    const rank = (v) => FRAME_VERDICTS.indexOf(v);
    const toCheck = people
      .filter((p) => OPEN_VERDICTS.includes(p.verdict))
      .sort((a, b) => rank(a.verdict) - rank(b.verdict) || (b.closeness ?? -2) - (a.closeness ?? -2) || b.quality - a.quality);
    const answered = people.filter((p) => p.verdict && p.verdict !== 'no_answer').length;
    return {
      id: job.id,
      caseId: job.caseId,
      caseName: job.caseName,
      caseFir: job.caseFir,
      status: job.status,
      error: job.error || null,
      waiting: job.waiting || null,
      notice: job.notice || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      settings: job.settings,
      model: job.model || null,
      files: job.files.map((file, index) => {
        const own = people.filter((p) => p.fileIndex === index);
        const span = (file.to ?? file.duration ?? 0) - (file.from || 0);
        const reached = (file.scanTo ?? file.from ?? 0) - (file.from || 0);
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
          people: own.length,
          tooSmall: file.facesTooSmall || 0,
          checked: own.filter((p) => p.verdict && p.verdict !== 'no_answer').length,
        };
      }),
      counts: {
        people: people.length,
        checked: answered,
        likely: people.filter((p) => p.verdict === 'likely').length,
        possible: people.filter((p) => p.verdict === 'possible').length,
        tooSmall: job.files.reduce((n, f) => n + (f.facesTooSmall || 0), 0),
      },
      toCheck,
      everyone: people.sort((a, b) => a.fileIndex - b.fileIndex || a.time - b.time),
    };
  }

  function summary(job) {
    const v = view(job);
    return { id: v.id, caseId: v.caseId, caseName: v.caseName, caseFir: v.caseFir, status: v.status, error: v.error, createdAt: v.createdAt, updatedAt: v.updatedAt, files: v.files.length, counts: v.counts, progress: v.files.length ? v.files.reduce((n, f) => n + f.progress, 0) / v.files.length : 0 };
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
      file: file.path, from, to: file.to, fps: job.settings.fps, maxSide: job.settings.maxSide,
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
    const client = getClient();
    const report = await client.getCase(job.caseId);
    const photos = [];
    for (const photoId of [null, ...(report.extraPhotos || []).map((p) => p.id)]) {
      try { photos.push(await client.photo(job.caseId, photoId)); } catch { /* a photo that cannot be read is left out */ }
    }
    const result = await worker.request('caseSignatures', { photos, card: model.card, detectorPath: finder });
    job.model = { ...result.model, casePhotos: result.signatures.length };
    caseSignatures.set(job.id, result.signatures);
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
        caseSignatures: sigs, tracks: tracks.map((t) => ({ key: keyOf(index, t.id), picture: t.picture, landmarks: t.landmarks })),
      });
      Object.assign(job.scores, result.scores);
    }
    file.scored = true;
    changed(job);
  }

  async function sendOne(job, index, signal) {
    const file = job.files[index];
    const tracks = tracksOf(file).map((t) => ({ ...t, id: keyOf(index, t.id) }));
    let candidates;
    if (file.scored && Object.keys(job.scores).length) {
      candidates = chooseToSend(tracks, job.scores, { line: job.settings.line, top: job.settings.top });
    } else {
      candidates = [...tracks].sort((a, b) => b.quality - a.quality).slice(0, SEND_LIMIT_WITHOUT_MODEL);
      if (tracks.length > SEND_LIMIT_WITHOUT_MODEL) job.notice = 'send_limit';
    }
    const toSend = candidates.filter((t) => !job.answers[t.id] || job.answers[t.id].verdict === 'no_answer');
    if (toSend.length) {
      file.searchId ||= `vs_${crypto.randomBytes(9).toString('base64url')}`;
      await sendFaces({
        client: getClient(),
        caseId: job.caseId,
        record: { name: file.name, bytes: file.bytes, duration: file.duration, sha256: file.sha256, tracks, facesTooSmall: file.facesTooSmall },
        tracks: toSend,
        camera: file.camera,
        recordedFrom: file.recordedFrom,
        searchId: file.searchId,
        readPicture: (t) => files.read(path.join(fileDir(job.id, index), t.picture)),
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
    }
    if (!signal.aborted) {
      file.sent = true;
      changed(job);
    }
  }

  async function run(job) {
    const controller = new AbortController();
    const worker = startWorker();
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
        if (model?.card && job.settings.firstPass && !file.scored) await scoreOne(job, index, worker);
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
      }
    } finally {
      worker.kill();
      job.waiting = null;
      active = null;
      changed(job);
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

    /** A new job for one case and its videos; it starts as soon as the laptop is free. */
    create({ report, files: chosen, window = null, settings = {} }) {
      const id = `job_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`;
      const job = {
        id,
        caseId: report.id,
        caseName: report.childName || report.name || '',
        caseFir: report.firNo || report.firNumber || '',
        officer: { id: officer.id || null, name: officer.name || null },
        createdAt: new Date().toISOString(),
        status: 'queued',
        window,
        settings: { fps: 2, maxSide: 960, line: 0.25, top: 10, firstPass: Boolean(model?.card), ...settings },
        files: chosen.map((f) => {
          const span = windowFor(f, window);
          return {
            path: f.path, name: f.name, bytes: f.bytes, duration: f.duration, width: f.width, height: f.height, codec: f.codec,
            camera: f.camera, recordedFrom: f.recordedFrom || null,
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

    /** Deletes a job and every picture it holds from this laptop. */
    remove(id) {
      if (active?.id === id) {
        active.controller.abort();
        active.worker.kill();
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

    /** Deletes jobs nobody has touched for `days`. */
    sweep(days = 30) {
      const limit = Date.now() - days * 86400000;
      for (const job of [...jobs.values()]) {
        if (Date.parse(job.updatedAt || job.createdAt) < limit && job.status !== 'running') this.remove(job.id);
      }
    },

    /** The officer's decision on one person: "same" adds a note to the case, "not" is kept here. */
    async decide(id, key, decision) {
      const job = jobs.get(id);
      if (!job) throw new Error('No such job');
      const [index, trackId] = [Number(key.split(':')[0]), key.slice(key.indexOf(':') + 1)];
      const file = job.files[index];
      const track = tracksOf(file).find((t) => String(t.id) === trackId);
      if (!track) throw new Error('No such person in this job');
      job.decisions[key] = { decision, at: new Date().toISOString(), by: officer.name || null };
      if (decision === 'same') {
        try {
          await getClient().addNote(job.caseId, noteFor({ job, file, track, verdict: job.answers[key]?.verdict, officer }));
          job.decisions[key].saved = true;
        } catch (err) {
          job.decisions[key].saved = false;
          job.decisions[key].error = err.message;
        }
      }
      changed(job);
      return job.decisions[key];
    },

    /** A face picture of a job, decrypted. */
    picture(id, index, relative) {
      const dir = fileDir(id, index);
      const file = path.resolve(dir, relative);
      if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error('Not a picture of this job');
      return files.read(file);
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
