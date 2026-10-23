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
    // A live camera watched as it records (desktop-policy.js liveWatch): no file, no length, no fingerprint.
    const live = f?.live === true || f?.live === 'true';
    files.push({
      key: Number.isInteger(Number(f?.key)) ? Number(f.key) : i,
      name: text(f?.name, 200) || null,
      bytes: live ? null : count(f?.bytes),
      seconds: live ? null : count(f?.seconds),
      sha256: !live && SHA256.test(sha) ? sha : null,
      cameraPlace,
      // Where the camera is on the map, when the officer gave it: the sighting's map point.
      ...(coordinatesOf(f?.lat, f?.lng) || { lat: null, lng: null }),
      recordedFrom: isoOrNull(f?.recordedFrom),
      window: !live && (from != null || to != null) ? { from: from ?? 0, to } : null,
      ...(live ? { live: true } : {}),
    });
  }
  return { files };
}

/**
 * A new check's record. `body` is what the laptop sent; the case and the
 * officer come from Khozo. `live` is `{ until }` for a watch of a live camera.
 */
export function newVideoJob({ id, report, user, body, files, live = null, now = new Date().toISOString() }) {
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
    // The laptop's own name, so checks from two laptops on one case can be told apart.
    device: text(body?.device, 80) || null,
    model: model && (model.name || model.version) ? model : null,
    firstPass: model && Number.isFinite(line) ? { line, top: Number.isFinite(top) ? top : null } : null,
    // A live camera watched until a set time, rather than recorded videos.
    live: live ? { until: live.until, startedAt: now } : null,
    // Whether the laptop keeps the case's face signatures, encrypted, for the
    // life of the check (desktop-policy.js laptopAnswers), and when it said it deleted them.
    laptopTemplate: body?.keepsTemplate === 'yes' ? { kept: true, deletedAt: null } : null,
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
  return `f_v${keyHash(`${jobId}|${key}`)}`.slice(0, 18);
}

/** A short name made from `text`, the same every time: two 32-bit hashes in base 36. */
export function keyHash(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
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
    // A check against open cases keeps which case each lead was, for its decisions, and not the scores.
    ...(job.leads ? { leads: Object.fromEntries(Object.entries(job.leads).map(([id, l]) => [id, { id, fileKey: l.fileKey, faceKey: l.faceKey, t: l.t, caseId: l.caseId, rank: l.rank ?? null }])) } : {}),
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

/** The clock time of a moment `t` seconds into a video that started recording at `recordedFrom`, or null. */
function clockOf(file, t) {
  const start = Date.parse(file?.recordedFrom || '');
  return Number.isFinite(start) && t != null ? new Date(start + t * 1000).toISOString() : null;
}

/**
 * Each decision on a check, in the order the faces were seen: the camera and
 * its map point, the moment, what the engines said, what the officer decided
 * and who. The case page's route view draws the "same person" ones.
 */
export function decisionsOf(job) {
  const files = new Map((job.files || []).map((f) => [String(f.key), f]));
  return Object.entries(job.decisions || {})
    .map(([key, d]) => {
      const file = files.get(String(d?.fileKey));
      const point = coordinatesOf(d?.lat, d?.lng) || coordinatesOf(file?.lat, file?.lng);
      return {
        key,
        decision: d?.decision || null,
        fileKey: d?.fileKey ?? null,
        cameraPlace: file?.cameraPlace || null,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        t: d?.t ?? null,
        videoTime: d?.t != null ? videoTimeText(d.t) : null,
        seenAt: isoOrNull(d?.seenAt) || clockOf(file, d?.t),
        verdict: d?.verdict || null,
        markedBy: d?.byName || null,
        markedAt: d?.at || null,
        sightingId: d?.sightingId || null,
      };
    })
    .sort((a, b) => String(a.seenAt || '').localeCompare(String(b.seenAt || '')) || (a.t ?? 0) - (b.t ?? 0));
}

const hoursOf = (job) => Object.values(job.progress?.files || {}).reduce((n, f) => n + (Number(f.secondsRead) || 0), 0) / 3600;
const peopleOf = (job) => Object.values(job.progress?.files || {}).reduce((n, f) => n + (Number(f.peopleSeen) || 0), 0);
const decidedAs = (job, decision) => Object.values(job.decisions || {}).filter((d) => d?.decision === decision);

/**
 * A check as the case page and the command centre show it: no face scores, no
 * file fingerprints. A check against open cases (shared/open-case-checks.js)
 * has no case, and its view never says which cases its faces were sent to.
 */
export function videoJobView(job) {
  const openCases = job.mode === 'open_cases';
  return {
    id: job.id,
    mode: openCases ? 'open_cases' : 'case',
    reportId: job.reportId ?? null,
    status: job.status,
    progressStatus: job.progress?.status || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    closedAt: job.closedAt || null,
    createdByName: job.createdByName,
    createdByRole: job.createdByRole,
    officerPlace: job.officerPlace || null,
    device: job.device || null,
    live: job.live || null,
    laptopTemplate: job.laptopTemplate || null,
    appVersion: job.appVersion,
    model: job.model ? { name: job.model.name } : null,
    videos: (job.files || []).map((f) => ({
      key: f.key,
      name: f.name,
      live: Boolean(f.live),
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
    confirmed: decidedAs(job, 'same').length,
    rejected: decidedAs(job, 'not').length,
    sightings: openCases ? [] : Object.values(job.decisions || {}).map((d) => d?.sightingId).filter(Boolean),
    decisions: openCases ? decisionsOf(job).map((d) => ({ ...d, sightingId: null })) : decisionsOf(job),
    ...(openCases
      ? { openCases: { area: job.area || null, filters: job.filters || null, casesSearched: job.casesSearched ?? null, leads: Object.keys(job.leads || {}).length } }
      : {}),
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
  into.confirmed += decidedAs(job, 'same').length;
  into.rejected += decidedAs(job, 'not').length;
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
    if (job.reportId) cases.add(job.reportId);
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
 * A CCTV check's report, for a court or an enquiry (spec F19): the case, the
 * officer, each video with its fingerprint, camera, map point and recording
 * start, how much of it was read and what the engines found, and each of the
 * officer's decisions with its moment. No face picture is in it. Signed by
 * the route that sends it.
 */
export function videoJobReport(job, report, now = new Date().toISOString()) {
  const counts = job.fileCounts || countsOfBatches(job.batches).fileCounts;
  const decisions = decisionsOf(job).map(({ key, decision, cameraPlace, videoTime, seenAt, verdict, markedBy, markedAt, sightingId }) => ({
    key, decision, cameraPlace, videoTime, seenAt, verdict, markedBy, markedAt, sightingId,
  }));
  const view = videoJobView(job);
  return {
    title: 'Khozo CCTV check report',
    generatedAt: now,
    case: { id: report.id, name: report.childName || report.name || null, fir: report.firNo || null, state: report.state || null, district: report.district || null },
    check: {
      id: job.id, status: job.status, progressStatus: job.progress?.status || null, startedAt: job.createdAt, closedAt: job.closedAt || null,
      officer: job.createdByName || null, role: job.createdByRole || null, officerPlace: job.officerPlace || null, laptop: job.device || null,
      live: job.live || null, caseTemplateOnLaptop: job.laptopTemplate || null,
      app: job.appVersion || null, model: job.model?.name || null, firstPassLine: job.firstPass?.line ?? null, scanSeconds: job.progress?.scanSeconds ?? null,
    },
    videos: (job.files || []).map((f) => ({
      name: f.name, sha256: f.sha256 || null, cameraPlace: f.cameraPlace, lat: f.lat ?? null, lng: f.lng ?? null,
      recordedFrom: f.recordedFrom || null, seconds: f.seconds ?? null, window: f.window || null,
      secondsRead: job.progress?.files?.[String(f.key)]?.secondsRead ?? null, peopleSeen: job.progress?.files?.[String(f.key)]?.peopleSeen ?? null,
      faces: counts?.[String(f.key)] || zeroCounts(),
    })),
    totals: { hours: view.hours, peopleSeen: view.peopleSeen, faces: view.counts, markedSame: view.confirmed, markedNot: view.rejected },
    decisions,
    note: 'Every result is a lead, not an identification. A face marked as the person is a sighting waiting for the case officer\'s review.',
  };
}

/**
 * A case's route (spec F13): each moment a CCTV check put the person on a
 * camera and an officer sent it to the case, from any laptop and either kind
 * of check, in time order, with the camera's map point. Read from the
 * sightings themselves, so one the case's officers turned down on review
 * (which unlinks it) drops off the route.
 */
export function caseRoute(report, foundReports = []) {
  return foundReports
    .filter((f) => f?.matchedReportId === report.id && f.videoCheck && !f.anonymizedAt && !['rejected', 'dismissed'].includes(f.status))
    .map((f) => {
      const v = f.videoCheck;
      const start = Date.parse(v.recordedFrom || '');
      const seenAt = isoOrNull(v.seenAt) || (Number.isFinite(start) && v.t != null ? new Date(start + v.t * 1000).toISOString() : null);
      const point = coordinatesOf(f.lat, f.lng);
      return {
        sightingId: f.id,
        seenAt,
        cameraPlace: v.cameraPlace || f.foundLocation || null,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        videoName: v.videoName || null,
        videoTime: v.t != null ? videoTimeText(v.t) : null,
        markedBy: v.markedByName || null,
        laptop: v.laptop || null,
        jobId: v.jobId || null,
        fromOpenCases: v.mode === 'open_cases',
        status: f.status || null,
      };
    })
    .sort((a, b) => (a.seenAt == null) - (b.seenAt == null) || String(a.seenAt || '').localeCompare(String(b.seenAt || '')));
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
