// Talking to Khozo from the laptop: the officer's own account, the case, and
// the route the browser's "Check CCTV video" uses to compare faces with a
// case (POST /reports/:id/video-search). The same rules as the browser
// (web/src/video/VideoCaseSearch.jsx): five pictures a request, wait and ask
// once more when no engine answered, one at a time when five were too much.
// The video itself is never sent; only the face pictures and their moments.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { VIDEO_SEARCH_BATCH } from '../../shared/video-search.js';

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
    closeVideoJob: (id, jobId) => call('POST', `/reports/${encodeURIComponent(id)}/video-jobs/${encodeURIComponent(jobId)}/close`, { json: {} }),
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

/** A face picture as the browser names it: face-12_5s.jpg for a face at 12.5 seconds. */
async function faceFile(readPicture, track) {
  const at = Math.round(Number(track.time) * 10) / 10;
  return new File([await readPicture(track)], `face-${String(at).replace('.', '_')}s.jpg`, { type: 'image/jpeg' });
}

/**
 * Sends the people of one scanned file to be compared with a case, five at a
 * time, and resolves to their answers by track id: `{ verdict, engines }`.
 *
 * `record` is the file's entry in the scan's manifest and `dir` its folder;
 * `readPicture(track)` reads a face picture instead (the desktop app keeps
 * them encrypted). `onAnswers(answers)` is called after every request, so the
 * caller can save them and a stopped run picks up where it stopped. Waits,
 * rather than giving up, when Khozo's limit is reached or the connection drops
 * (`onWait` says why); stops with a KhozoError when Khozo refuses for a reason
 * waiting will not change (signed out, no access, a closed case).
 */
export async function sendFaces({
  client, caseId, record, dir, tracks, camera, recordedFrom = null, searchId,
  readPicture = (track) => fs.readFileSync(path.join(dir, track.picture)),
  // With a check on Khozo, `{ jobId, fileKey }`: the faces go to that check
  // (POST /:id/video-jobs/:jobId/faces), each batch named from the faces in it,
  // so a batch sent again is answered from the record, not compared again.
  job = null,
  onAnswers = () => {}, onWait = () => {}, busyWaitMs = 15000, signal,
}) {
  const batches = [];
  for (let i = 0; i < tracks.length; i += VIDEO_SEARCH_BATCH) batches.push(tracks.slice(i, i + VIDEO_SEARCH_BATCH));
  const formFor = async (faces, index) => {
    const form = new FormData();
    const files = await Promise.all(faces.map((track) => faceFile(readPicture, track)));
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
    form.append('times', faces.map((track) => Number(track.time).toFixed(1)).join(','));
    return form;
  };
  const isFault = (err) => [500, 502, 503, 504].includes(err.status) && !err.data?.error;

  // One request, waited through Khozo's limit and lost connections.
  async function post(faces, index) {
    let pause = 30000;
    for (;;) {
      try {
        const form = await formFor(faces, index);
        if (!job) return await client.videoSearch(caseId, form);
        form.append('fileKey', String(job.fileKey));
        // The batch's name replaces its number: a field sent twice may arrive as a list.
        form.set('batch', crypto.createHash('sha1').update(faces.map((t) => t.id).join(',')).digest('hex').slice(0, 24));
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
    const answered = {};
    for (const row of data.results || []) {
      const track = faces[row.index];
      if (track) answered[track.id] = { verdict: row.verdict, engines: row.enginesAnswered || [] };
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
      for (const track of batch.length > 1 ? batch : []) {
        if (signal?.aborted) break;
        try {
          Object.assign(answered, await ask([track], index));
        } catch (single) {
          if (!isFault(single)) throw single;
        }
      }
    }
    // A face with no answer is "not checked yet", to send again next run.
    for (const track of batch) answered[track.id] ||= { verdict: 'no_answer', engines: [] };
    Object.assign(all, answered);
    onAnswers(answered);
  }
  return all;
}
