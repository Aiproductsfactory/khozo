// Talking to Khozo from the laptop: the officer's own account, the case, and
// the route the browser's "Check CCTV video" uses to compare faces with a
// case (POST /reports/:id/video-search). The same rules as the browser
// (web/src/video/VideoCaseSearch.jsx): five pictures a request, wait and ask
// once more when no engine answered, one at a time when five were too much.
// The video itself is never sent; only the face pictures and their moments.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FRAME_VERDICTS, VIDEO_SEARCH_BATCH, isSmallVideo } from '../../shared/video-search.js';
import { comparisonCopy } from './compare-copy.js';

export const DESKTOP_VERSION = '0.0.1';

/** An answer from Khozo that was not a success; `status` 0 means no connection. */
export class KhozoError extends Error {
  constructor(message, status, data = {}, retryAfter = null) {
    super(message);
    this.status = status;
    this.data = data;
    this.retryAfter = retryAfter;
  }
}

/** A Khozo client signed in as one officer. */
export function createClient({ api = 'https://khozo.org/api', token = null, fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  const base = api.replace(/\/+$/, '');
  let auth = token;

  async function call(method, route, { json, form, bytes = false } = {}) {
    const headers = { 'X-Khozo-Desktop': DESKTOP_VERSION };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) body = form;
    let res;
    try {
      res = await fetchImpl(base + route, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new KhozoError(`No connection to Khozo (${err.cause?.code || err.name || err.message})`, 0);
    }
    if (bytes && res.ok) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!res.ok) throw new KhozoError(data.error || `Khozo answered ${res.status}`, res.status, data, Number(res.headers.get('retry-after')) || null);
    return data;
  }

  return {
    get token() { return auth; },
    /** Signs in with an email address or a mobile number. The password is not kept. */
    async signIn(login, password) {
      const data = await call('POST', '/auth/login', { json: String(login).includes('@') ? { email: login, password } : { phone: login, password } });
      if (!data.token) throw new KhozoError('Signing in gave no token', 500);
      if (data.user?.mustChangePassword) throw new KhozoError('This account must change its password on khozo.org first', 403);
      auth = data.token;
      return data.user;
    },
    me: async () => { const data = await call('GET', '/auth/me'); return data.user || data; },
    /** The cases this officer can see, as Khozo's case list gives them; `q` searches names, FIR numbers and marks. */
    listCases: async (q = '') => (await call('GET', `/reports${q ? `?q=${encodeURIComponent(q)}` : ''}`)).reports || [],
    getCase: async (id) => (await call('GET', `/reports/${encodeURIComponent(id)}`)).report,
    /** A note on the case, as the browser's "Add to case" writes one. */
    addNote: (id, note) => call('POST', `/reports/${encodeURIComponent(id)}/notes`, { json: { note } }),
    // A check's record on Khozo (shared/routes/reports.js /:id/video-jobs).
    startVideoJob: (id, body) => call('POST', `/reports/${encodeURIComponent(id)}/video-jobs`, { json: body }),
    videoJobFaces: (id, jobId, form) => call('POST', `/reports/${encodeURIComponent(id)}/video-jobs/${encodeURIComponent(jobId)}/faces`, { form }),
    videoJobProgress: (id, jobId, body) => call('POST', `/reports/${encodeURIComponent(id)}/video-jobs/${encodeURIComponent(jobId)}/progress`, { json: body }),
    videoJobDecision: (id, jobId, form) => call('POST', `/reports/${encodeURIComponent(id)}/video-jobs/${encodeURIComponent(jobId)}/decisions`, { form }),
    closeVideoJob: (id, jobId, body = {}) => call('POST', `/reports/${encodeURIComponent(id)}/video-jobs/${encodeURIComponent(jobId)}/close`, { json: body }),
    // A check of footage against open cases (shared/routes/reports.js /open-case-checks).
    /** Whether checks against open cases run on this Khozo, and how many cases a narrowing searches. */
    openCaseCount: (filters = {}) => {
      const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString();
      return call('GET', `/reports/open-case-checks/cases${query ? `?${query}` : ''}`);
    },
    startOpenCaseCheck: (body) => call('POST', '/reports/open-case-checks', { json: body }),
    openCaseFace: (jobId, form) => call('POST', `/reports/open-case-checks/${encodeURIComponent(jobId)}/faces`, { form }),
    openCaseLead: (jobId, leadId, form) => call('POST', `/reports/open-case-checks/${encodeURIComponent(jobId)}/leads/${encodeURIComponent(leadId)}`, { form }),
    openCaseProgress: (jobId, body) => call('POST', `/reports/open-case-checks/${encodeURIComponent(jobId)}/progress`, { json: body }),
    closeOpenCaseCheck: (jobId) => call('POST', `/reports/open-case-checks/${encodeURIComponent(jobId)}/close`, { json: {} }),
    /** The newest Khozo Desktop, as Khozo announces it (GET /dashboard/desktop-version). */
    desktopVersion: () => call('GET', '/dashboard/desktop-version'),
    photo: (id, photoId = null) => call('GET', `/reports/photo/${encodeURIComponent(id)}${photoId ? `?p=${encodeURIComponent(photoId)}` : ''}`, { bytes: true }),
    videoSearch: (id, form) => call('POST', `/reports/${encodeURIComponent(id)}/video-search`, { form }),
  };
}

/** Signs in from the environment: KHOZO_TOKEN, or KHOZO_LOGIN and KHOZO_PASSWORD (or the private helper's KHOZO_DEMO_*). */
export async function signInFromEnv(client, env = process.env) {
  if (env.KHOZO_TOKEN) return null;
  const login = env.KHOZO_LOGIN || env.KHOZO_DEMO_EMAIL;
  const password = env.KHOZO_PASSWORD || env.KHOZO_DEMO_PASSWORD;
  if (!login || !password) throw new KhozoError('Sign in first: set KHOZO_TOKEN, or KHOZO_LOGIN and KHOZO_PASSWORD', 401);
  return client.signIn(login, password);
}

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * A face picture as the browser names it (face-12_5s.jpg for a face at 12.5
 * seconds), at the size the face engines find faces best
 * (web/src/video/faces.js COMPARE_SIDE). The picture kept on the laptop, and
 * sent with "Same person", is not changed.
 */
async function faceFile(readPicture, track, file = track.picture) {
  const at = Math.round(Number(track.time) * 10) / 10;
  const picture = await readPicture(track, file);
  // The copy the laptop's own first pass signed too (local-match.js), so both look at the same picture.
  const copy = await comparisonCopy(picture).catch(() => picture);
  return new File([copy], `face-${String(at).replace('.', '_')}s.jpg`, { type: 'image/jpeg' });
}

/** Whether Khozo broke on a request (no words of its own), rather than refused it. */
const isFault = (err) => [500, 502, 503, 504].includes(err.status) && !err.data?.error;

/**
 * Sends the people of one scanned file to be searched among the open cases
 * (a check against open cases), one at a time, each under the laptop's name
 * for the person, and calls `onAnswer(id, { verdict, leads })` after each. A
 * face sent again is answered from Khozo's record. Waits through Khozo's
 * limit and lost connections (`onWait` says why); when five faces in a row
 * get no answer, the engines are taken to be busy and it waits a while. A
 * face with no answer stays "not checked yet", to send again next run.
 * Stops with a KhozoError when Khozo refuses for a reason waiting will not
 * change (signed out, the face budget, a closed check).
 */
export async function sendOpenCaseFaces({
  client, jobId, fileKey, tracks, readPicture, onAnswer = () => {}, onWait = () => {}, busyWaitMs = 15000, signal,
}) {
  async function ask(track) {
    let pause = 30000;
    for (;;) {
      try {
        const form = new FormData();
        form.append('photo', await faceFile(readPicture, track));
        form.append('fileKey', String(fileKey));
        form.append('key', track.id);
        form.append('t', Number(track.time).toFixed(1));
        const data = await client.openCaseFace(jobId, form);
        return { verdict: data.verdict || 'no_answer', leads: Array.isArray(data.leads) ? data.leads : [] };
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err.status === 429) {
          const seconds = err.retryAfter || 60;
          onWait({ reason: 'limit', seconds });
          await sleep(seconds * 1000, signal);
        } else if (err.status === 0) {
          onWait({ reason: 'connection', seconds: pause / 1000 });
          await sleep(pause, signal);
          pause = Math.min(pause * 2, 300000);
        } else if (isFault(err)) {
          return { verdict: 'no_answer', leads: [] };
        } else throw err;
      }
    }
  }

  let unanswered = 0;
  for (const track of tracks) {
    if (signal?.aborted) break;
    const answer = await ask(track);
    if (signal?.aborted) break;
    onAnswer(track.id, answer);
    unanswered = answer.verdict === 'no_answer' ? unanswered + 1 : 0;
    if (unanswered >= 5) {
      unanswered = 0;
      onWait({ reason: 'engines', seconds: busyWaitMs / 1000 });
      await sleep(busyWaitMs, signal);
    }
  }
}

/**
 * Sends the people of one scanned file to be compared with a case, five at a
 * time, and resolves to their answers by track id: `{ verdict, engines }`.
 *
 * `record` is the file's entry in the scan's manifest and `dir` its folder;
 * `readPicture(track, file)` reads a face picture instead (the desktop app
 * keeps them encrypted). `picturesOf(track)` names the pictures of a person
 * to send (one by default; the app sends up to three, the one its first pass
 * scored best first), all under the person's one name, and the person's
 * answer is the best of them. `onAnswers(answers)` is called after every request, so the
 * caller can save them and a stopped run picks up where it stopped. Waits,
 * rather than giving up, when Khozo's limit is reached or the connection drops
 * (`onWait` says why); stops with a KhozoError when Khozo refuses for a reason
 * waiting will not change (signed out, no access, a closed case).
 */
export async function sendFaces({
  client, caseId, record, dir, tracks, camera, recordedFrom = null, searchId,
  readPicture = (track, file = track.picture) => fs.readFileSync(path.join(dir, file)),
  picturesOf = (track) => [track.picture],
  // With a check on Khozo, `{ jobId, fileKey }`: the faces go to that check
  // (POST /:id/video-jobs/:jobId/faces), each batch named from the faces in it,
  // so a batch sent again is answered from the record, not compared again.
  job = null,
  onAnswers = () => {}, onWait = () => {}, busyWaitMs = 15000, signal,
}) {
  // Each picture to send, with its person: up to VIDEO_SEARCH_BATCH a request,
  // and a person's pictures always in one request, so that Khozo records the
  // best of them (a later request would replace an earlier answer).
  const batches = [];
  for (const track of tracks) {
    const mine = picturesOf(track).slice(0, VIDEO_SEARCH_BATCH).map((file) => ({ track, file }));
    const last = batches.at(-1);
    if (last && last.length + mine.length <= VIDEO_SEARCH_BATCH) last.push(...mine);
    else batches.push(mine);
  }
  const rank = (verdict) => { const i = FRAME_VERDICTS.indexOf(verdict); return i < 0 ? FRAME_VERDICTS.length : i; };
  const formFor = async (faces, index) => {
    const form = new FormData();
    const files = await Promise.all(faces.map(({ track, file }) => faceFile(readPicture, track, file)));
    files.forEach((file, i) => form.append(i === 0 ? 'photo' : 'extraPhotos', file));
    form.append('searchId', searchId);
    form.append('videoName', String(record.name || '').slice(0, 200));
    form.append('videoBytes', String(record.bytes || 0));
    form.append('videoSeconds', String(Math.round(record.duration || 0)));
    if (record.sha256) form.append('videoSha256', record.sha256);
    form.append('cameraPlace', String(camera).trim().slice(0, 200));
    if (recordedFrom) form.append('recordedFrom', recordedFrom);
    form.append('batch', String(index + 1));
    form.append('batches', String(batches.length));
    form.append('facesFound', String(record.tracks?.length ?? faces.length));
    form.append('facesTooSmall', String(record.facesTooSmall || 0));
    form.append('times', faces.map(({ track }) => Number(track.time).toFixed(1)).join(','));
    // Faces from a small video are put to both face engines (shared/match-pipeline.js).
    form.append('smallVideo', (record.small ?? isSmallVideo(record.width, record.height)) ? '1' : '0');
    return form;
  };
  // One request, waited through Khozo's limit and lost connections.
  async function post(faces, index) {
    let pause = 30000;
    for (;;) {
      try {
        const form = await formFor(faces, index);
        if (!job) return await client.videoSearch(caseId, form);
        form.append('fileKey', String(job.fileKey));
        // The laptop's name for each person: what the officer's decision on them is sent under.
        form.append('keys', faces.map(({ track }) => track.id).join(','));
        // The batch's name replaces its number: a field sent twice may arrive as a list.
        form.set('batch', crypto.createHash('sha1').update(faces.map(({ track, file }) => `${track.id}|${file}`).join(',')).digest('hex').slice(0, 24));
        return await client.videoJobFaces(caseId, job.jobId, form);
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err.status === 429) {
          const seconds = err.retryAfter || 60;
          onWait({ reason: 'limit', seconds });
          await sleep(seconds * 1000, signal);
        } else if (err.status === 0) {
          onWait({ reason: 'connection', seconds: pause / 1000 });
          await sleep(pause, signal);
          pause = Math.min(pause * 2, 300000);
        } else throw err;
      }
    }
  }

  // One batch: when no engine answered for any face, wait and ask once more.
  async function ask(faces, index) {
    let data = await post(faces, index);
    const rows = data.results || [];
    if (rows.length && rows.every((row) => row.verdict === 'no_answer') && !signal?.aborted) {
      onWait({ reason: 'engines', seconds: busyWaitMs / 1000 });
      await sleep(busyWaitMs, signal);
      if (!signal?.aborted) data = await post(faces, index);
    }
    // A person's answer is the best over their pictures.
    const answered = {};
    for (const row of data.results || []) {
      const item = faces[row.index];
      if (!item) continue;
      const got = { verdict: row.verdict, engines: row.enginesAnswered || [] };
      const have = answered[item.track.id];
      if (!have || rank(got.verdict) < rank(have.verdict)) answered[item.track.id] = got;
    }
    return answered;
  }

  const all = {};
  for (const [index, batch] of batches.entries()) {
    if (signal?.aborted) break;
    const answered = {};
    try {
      Object.assign(answered, await ask(batch, index));
    } catch (err) {
      if (!isFault(err)) throw err;
      // Several at once were too much for the server: one at a time. A face
      // the server cannot take even alone stays "not checked yet".
      for (const item of batch.length > 1 ? batch : []) {
        if (signal?.aborted) break;
        try {
          const one = await ask([item], index);
          for (const [id, got] of Object.entries(one)) if (!answered[id] || rank(got.verdict) < rank(answered[id].verdict)) answered[id] = got;
        } catch (single) {
          if (!isFault(single)) throw single;
        }
      }
    }
    // A face with no answer is "not checked yet", to send again next run.
    for (const { track } of batch) answered[track.id] ||= { verdict: 'no_answer', engines: [] };
    Object.assign(all, answered);
    onAnswers(answered);
  }
  return all;
}
