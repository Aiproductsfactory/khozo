/**
 * CCTV checks made on an officer's laptop (Khozo Desktop), as Khozo keeps
 * them. Pure and dependency-free: the routes (shared/routes/reports.js
 * /:id/video-jobs, shared/routes/dashboard.js /video-checks) and their tests
 * use it.
 *
 * One record per check: the case, the officer, the videos (name, size,
 * fingerprint, where the camera is, when it starts, the part read), how far
 * the laptop got, every batch of faces it sent with what the face engines
 * said, and each face an officer decided on. No picture and no video is kept
 * here: the face pictures are compared in memory and dropped, as for the
 * browser's check, and only a face an officer marks as the same person
 * becomes a sighting, with its own photos and retention.
 *
 * The same records give the command centre its figures: checks, hours of
 * footage, people seen, faces checked, answers, and how often an officer
 * agreed with "likely" or "possibly" or did not (summariseVideoJobs).
 */
import { FRAME_VERDICTS } from './video-search.js';

export const VIDEO_JOB_ID = /^vj_[A-Za-z0-9_-]{6,40}$/;
/** The laptop's own name for a job, a person or a batch, so a retry is recognised. */
const CLIENT_KEY = /^[A-Za-z0-9_.:-]{1,80}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The most videos one check may hold. */
export const MAX_JOB_FILES = 64;
/** The most faces one check may send to the face engines, unless KHOZO_DESKTOP_JOB_FACES says otherwise. */
export const DEFAULT_JOB_FACE_BUDGET = 5000;
/** The answers an officer looks at: what "Look at these first" holds. */
export const OPEN_VERDICTS = ['likely', 'possible', 'not_agreed'];
export const DECISIONS = ['same', 'not'];

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const count = (value) => {
  // Not given is not nought: a window with no end ("to": null) runs to the end of the video.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const round = (n, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
const isoOrNull = (value) => (value && Number.isFinite(Date.parse(value)) ? String(value).slice(0, 40) : null);

/** A camera's place on the map, `{ lat, lng }` to about 10 cm, or null when either is missing or out of range. */
export function coordinatesOf(lat, lng) {
  if (lat === '' || lat == null || lng === '' || lng == null) return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}

export const isClientKey = (value) => CLIENT_KEY.test(String(value ?? ''));

/**
 * A list the laptop sent as JSON text. The report routes refuse a body that
 * holds an object (shared/routes/reports.js), so the videos and their progress
 * travel as text, and are rebuilt field by field here.
 */
export function listFromText(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.length > 200000) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** "0:07", "12:05", "1:02:09": a moment in a video, for people. */
export function videoTimeText(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function zeroCounts() {
  return Object.fromEntries([['faces', 0], ...FRAME_VERDICTS.map((v) => [v, 0])]);
}

/**
 * The videos of a check as the laptop describes them, or `{ error }`: at most
 * MAX_JOB_FILES, each with where its camera is. The key is the laptop's index
 * of the video in the check.
 */
export function jobFilesOf(list) {
  if (!Array.isArray(list) || !list.length) return { error: 'Say which videos this check reads.' };
  if (list.length > MAX_JOB_FILES) return { error: `A check holds at most ${MAX_JOB_FILES} videos.` };
  const files = [];
  for (const [i, f] of list.entries()) {
    const cameraPlace = text(f?.cameraPlace, 200);
    if (cameraPlace.length < 3) return { error: 'Say where each camera is.' };
    const sha = text(f?.sha256, 64).toLowerCase();
    const from = count(f?.from);
    const to = count(f?.to);
    files.push({
      key: Number.isInteger(Number(f?.key)) ? Number(f.key) : i,
      name: text(f?.name, 200) || null,
      bytes: count(f?.bytes),
      seconds: count(f?.seconds),
      sha256: SHA256.test(sha) ? sha : null,
      cameraPlace,
      // Where the camera is on the map, when the officer gave it: the sighting's map point.
      ...(coordinatesOf(f?.lat, f?.lng) || { lat: null, lng: null }),
      recordedFrom: isoOrNull(f?.recordedFrom),
      window: from != null || to != null ? { from: from ?? 0, to } : null,
    });
  }
  return { files };
}

/** A new check's record. `body` is what the laptop sent; the case and the officer come from Khozo. */
export function newVideoJob({ id, report, user, body, files, now = new Date().toISOString() }) {
  // Flat fields: the model on the laptop, if any, and the first pass's line.
  const model = body?.modelName || body?.modelVersion
    ? { name: text(body.modelName, 80) || null, version: text(body.modelVersion, 120) || null }
    : null;
  const line = body?.firstPassLine === '' || body?.firstPassLine == null ? NaN : Number(body.firstPassLine);
  const top = body?.firstPassTop === '' || body?.firstPassTop == null ? NaN : Number(body.firstPassTop);
  return {
    id,
    reportId: report.id,
    jobKey: text(body?.jobKey, 80),
    source: 'desktop',
    appVersion: text(body?.appVersion, 40) || null,
    model: model && (model.name || model.version) ? model : null,
    firstPass: model && Number.isFinite(line) ? { line, top: Number.isFinite(top) ? top : null } : null,
    status: 'open',
    createdById: user.id,
    createdByName: user.name || null,
    createdByRole: user.role || null,
    // Where the officer works: the cameras are usually there, not where the case was filed.
    officerPlace: { state: user.jurisdiction?.state || user.state || null, district: user.jurisdiction?.district || user.district || null },
    // The case's place, which decides who may see the check, as for its sightings.
    scope: { state: report.state || null, district: report.district || null, stateCode: report.stateCode || null, districtCode: report.districtCode || null, reportId: report.id },
    files,
    progress: { status: 'running', files: {} },
    counts: zeroCounts(),
    batches: {},
    decisions: {},
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
}

/** The key a batch is kept under: the video and the laptop's name for the batch. */
export const batchKeyOf = (fileKey, batch) => `${fileKey}|${batch}`;

/**
 * Each face a check has had answered, once: the laptop's name for the person
 * (`key`, the decision's key too), or, from a laptop that sent none, its place
 * in its batch. A face sent again after "no answer" counts once, with its
 * latest answer. Map of face key -> `{ fileKey, face }`.
 */
function answeredFaces(batches) {
  const out = new Map();
  const ordered = Object.entries(batches || {}).sort(([, a], [, b]) => String(a.at).localeCompare(String(b.at)));
  for (const [batchKey, batch] of ordered) {
    const fileKey = batchKey.split('|')[0];
    (batch.faces || []).forEach((face, i) => out.set(`${fileKey}|${face.key || `${batchKey}#${i}`}`, { fileKey, face }));
  }
  return out;
}

function tally(faces) {
  const counts = zeroCounts();
  for (const face of faces) {
    counts.faces += 1;
    if (counts[face.verdict] != null) counts[face.verdict] += 1;
  }
  return counts;
}

/** A check's counts, overall and for each video, from its batches. */
export function countsOfBatches(batches) {
  const answered = [...answeredFaces(batches).values()];
  const fileCounts = {};
  for (const { fileKey } of answered) fileCounts[fileKey] ||= null;
  for (const fileKey of Object.keys(fileCounts)) fileCounts[fileKey] = tally(answered.filter((a) => a.fileKey === fileKey).map((a) => a.face));
  return { counts: tally(answered.map((a) => a.face)), fileCounts };
}

/**
 * The patch that records one batch's answers. `faces` are `{ key, t, verdict,
 * aarakshak, rekognition, engines }` in the order sent. The counts are worked
 * out again from every batch, so a batch recorded twice, or a face sent
 * again, is never counted twice.
 */
export function batchPatch(job, key, faces, now = new Date().toISOString()) {
  const batches = { ...(job.batches || {}), [key]: { at: now, faces } };
  return { batches, ...countsOfBatches(batches), updatedAt: now };
}

/** How many faces a check has had compared so far, each face once. */
export const facesSent = (job) => Number(job?.counts?.faces) || 0;

/** What the engines said about one face of a check, by the laptop's name for it, or by its moment in the video. */
export function answerFor(job, fileKey, { key = null, t = null } = {}) {
  let byTime = null;
  for (const [, { fileKey: fk, face }] of answeredFaces(job.batches)) {
    if (String(fk) !== String(fileKey)) continue;
    if (key && face.key === key) return face;
    if (!byTime && !face.key && t != null && face.t != null && Math.abs(face.t - t) < 0.06) byTime = face;
  }
  return byTime;
}

/**
 * The sighting a face marked "same person" becomes, named from the check and
 * the face: sending the decision again, after a lost answer or a failed
 * write, finds or rewrites the same sighting instead of making a second.
 */
export function sightingIdFor(jobId, key) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const ch of `${jobId}|${key}`) {
    const c = ch.codePointAt(0);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `f_v${a.toString(36)}${b.toString(36)}`.slice(0, 18);
}

/**
 * A closed check keeps what each face was found to be, for its counts, and
 * no longer what each engine scored: nothing more is sent to it or decided
 * on it, so the scores have no more use.
 */
export function closedVideoJobPatch(job, now = new Date().toISOString()) {
  return {
    status: 'closed',
    closedAt: now,
    batches: Object.fromEntries(Object.entries(job.batches || {}).map(([k, b]) => [k, { at: b.at, faces: (b.faces || []).map((f) => ({ key: f.key || null, verdict: f.verdict })) }])),
    updatedAt: now,
  };
}

/**
 * The patch that records how far the laptop got: per video, the seconds read,
 * the people seen and the faces too small, and the check's own state. Only
 * numbers and a few words; never names.
 */
export function progressPatch(job, body, now = new Date().toISOString()) {
  const files = { ...(job.progress?.files || {}) };
  const known = new Map((job.files || []).map((f) => [String(f.key), f]));
  let fileList = job.files || [];
  for (const f of (listFromText(body?.files) || []).slice(0, MAX_JOB_FILES)) {
    const key = String(f?.key);
    if (!known.has(key)) continue;
    files[key] = {
      secondsRead: count(f.secondsRead) ?? files[key]?.secondsRead ?? 0,
      peopleSeen: count(f.peopleSeen) ?? files[key]?.peopleSeen ?? 0,
      facesTooSmall: count(f.facesTooSmall) ?? files[key]?.facesTooSmall ?? 0,
      state: ['waiting', 'reading', 'checking', 'done', 'error', 'outside'].includes(f.state) ? f.state : files[key]?.state || null,
    };
    // The fingerprint is known only once the whole video was read.
    const sha = text(f.sha256, 64).toLowerCase();
    if (SHA256.test(sha)) fileList = fileList.map((x) => (String(x.key) === key && !x.sha256 ? { ...x, sha256: sha } : x));
  }
  const status = ['running', 'paused', 'done', 'error'].includes(body?.status) ? body.status : job.progress?.status || 'running';
  return {
    files: fileList,
    progress: { status, files, scanSeconds: count(body?.scanSeconds) ?? job.progress?.scanSeconds ?? null },
    updatedAt: now,
  };
}

/** The patch that records an officer's decision on one person. */
export function decisionPatch(job, key, decision, now = new Date().toISOString()) {
  return { decisions: { ...(job.decisions || {}), [key]: decision }, updatedAt: now };
}

const hoursOf = (job) => Object.values(job.progress?.files || {}).reduce((n, f) => n + (Number(f.secondsRead) || 0), 0) / 3600;
const peopleOf = (job) => Object.values(job.progress?.files || {}).reduce((n, f) => n + (Number(f.peopleSeen) || 0), 0);
const decisionsOf = (job, decision) => Object.values(job.decisions || {}).filter((d) => d?.decision === decision);

/** A check as the case page and the command centre show it: no face scores, no file fingerprints. */
export function videoJobView(job) {
  return {
    id: job.id,
    reportId: job.reportId,
    status: job.status,
    progressStatus: job.progress?.status || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    closedAt: job.closedAt || null,
    createdByName: job.createdByName,
    createdByRole: job.createdByRole,
    officerPlace: job.officerPlace || null,
    appVersion: job.appVersion,
    model: job.model ? { name: job.model.name } : null,
    videos: (job.files || []).map((f) => ({
      key: f.key,
      name: f.name,
      cameraPlace: f.cameraPlace,
      lat: f.lat ?? null,
      lng: f.lng ?? null,
      recordedFrom: f.recordedFrom,
      seconds: f.seconds,
      window: f.window,
      secondsRead: job.progress?.files?.[String(f.key)]?.secondsRead ?? null,
      peopleSeen: job.progress?.files?.[String(f.key)]?.peopleSeen ?? null,
      state: job.progress?.files?.[String(f.key)]?.state ?? null,
    })),
    hours: round(hoursOf(job), 2),
    peopleSeen: peopleOf(job),
    counts: { ...zeroCounts(), ...(job.counts || {}) },
    confirmed: decisionsOf(job, 'same').length,
    rejected: decisionsOf(job, 'not').length,
    sightings: Object.values(job.decisions || {}).map((d) => d?.sightingId).filter(Boolean),
  };
}

function blank() {
  return { checks: 0, videos: 0, hours: 0, peopleSeen: 0, faces: 0, likely: 0, possible: 0, notAgreed: 0, confirmed: 0, rejected: 0 };
}

function add(into, job) {
  into.checks += 1;
  into.videos += (job.files || []).length;
  into.hours += hoursOf(job);
  into.peopleSeen += peopleOf(job);
  into.faces += Number(job.counts?.faces) || 0;
  into.likely += Number(job.counts?.likely) || 0;
  into.possible += Number(job.counts?.possible) || 0;
  into.notAgreed += Number(job.counts?.not_agreed) || 0;
  into.confirmed += decisionsOf(job, 'same').length;
  into.rejected += decisionsOf(job, 'not').length;
  return into;
}

function finish(row) {
  const decided = row.confirmed + row.rejected;
  return { ...row, hours: round(row.hours, 1), falseAlarmShare: decided ? round(row.rejected / decided, 2) : null };
}

/**
 * The command centre's figures for the checks it may see: totals, then by
 * district (the case's), by camera, and by officer, with the share of the
 * faces an officer looked at and said were not the person (false alarms).
 * The newest checks come with them for the list.
 */
export function summariseVideoJobs(jobs, { recent = 25 } = {}) {
  const totals = blank();
  const officers = new Set();
  const cases = new Set();
  const byDistrict = new Map();
  const byCamera = new Map();
  const byOfficer = new Map();
  const appVersions = {};
  for (const job of jobs) {
    add(totals, job);
    officers.add(job.createdById);
    cases.add(job.reportId);
    const dk = `${job.scope?.state || ''}|${job.scope?.district || ''}`;
    if (!byDistrict.has(dk)) byDistrict.set(dk, { state: job.scope?.state || null, district: job.scope?.district || null, ...blank() });
    add(byDistrict.get(dk), job);
    if (!byOfficer.has(job.createdById)) byOfficer.set(job.createdById, { name: job.createdByName, role: job.createdByRole, district: job.officerPlace?.district || null, ...blank() });
    add(byOfficer.get(job.createdById), job);
    if (job.appVersion) appVersions[job.appVersion] = (appVersions[job.appVersion] || 0) + 1;
    // A camera's own figures: its video's reading, the faces from it, and the decisions on them.
    for (const file of job.files || []) {
      const ck = `${String(file.cameraPlace || '').trim().toLowerCase()}|${job.officerPlace?.district || ''}`;
      if (!byCamera.has(ck)) byCamera.set(ck, { cameraPlace: file.cameraPlace, district: job.officerPlace?.district || null, ...blank() });
      const row = byCamera.get(ck);
      const progress = job.progress?.files?.[String(file.key)] || {};
      row.videos += 1;
      row.hours += (Number(progress.secondsRead) || 0) / 3600;
      row.peopleSeen += Number(progress.peopleSeen) || 0;
      // The video's own counts, kept with the check (the command centre reads checks without their batches).
      const own = (job.fileCounts || countsOfBatches(job.batches).fileCounts)[String(file.key)];
      if (own) {
        row.faces += own.faces || 0;
        row.likely += own.likely || 0;
        row.possible += own.possible || 0;
        row.notAgreed += own.not_agreed || 0;
      }
      for (const d of Object.values(job.decisions || {})) {
        if (String(d?.fileKey) !== String(file.key)) continue;
        if (d.decision === 'same') row.confirmed += 1;
        if (d.decision === 'not') row.rejected += 1;
      }
    }
  }
  const sorted = (map) => [...map.values()].map(finish).sort((a, b) => b.hours - a.hours || b.checks - a.checks);
  return {
    totals: { ...finish(totals), officers: officers.size, cases: cases.size },
    byDistrict: sorted(byDistrict),
    byCamera: sorted(byCamera).slice(0, 50),
    byOfficer: sorted(byOfficer),
    appVersions,
    recent: [...jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, recent).map(videoJobView),
  };
}

/**
 * A check of an anonymised case: the figures stay for the command centre's
 * counts, the file names and recording times (which can say where and when a
 * family was) go.
 */
export function anonymisedVideoJobPatch(job, now = new Date().toISOString()) {
  return {
    files: (job.files || []).map((f) => ({ ...f, name: null, recordedFrom: null })),
    batches: Object.fromEntries(Object.entries(job.batches || {}).map(([k, b]) => [k, { at: b.at, faces: (b.faces || []).map((f) => ({ verdict: f.verdict })) }])),
    anonymizedAt: now,
    updatedAt: now,
  };
}
