// Khozo Desktop: the window, the officer's sign-in, and the bridge between the
// screens and the work.
//
// The screens (renderer/) have no access to the computer. They ask for what
// they need through a narrow bridge (preload.cjs): sign in, find a case, pick
// video files, start, pause and delete jobs, decide on a face. Pictures,
// frames and clips reach them through the khozo:// scheme, decrypted or made
// on demand and never written to disk. The officer's sign-in token stays in
// this process, encrypted by Windows for this user account.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, powerSaveBlocker, protocol, safeStorage, shell, utilityProcess } from 'electron';
import { probe } from '../scanner/ffmpeg.js';
import { isStreamAddress, probeStream } from '../scanner/live.js';
import { createClient, KhozoError } from '../scanner/khozo.js';
import { readModelCard } from '../scanner/recognizer.js';
import { clipAround, frameOf } from './clips.js';
import { createJobs } from './jobs.js';
import { canSearchCase, VIDEO_ROLES } from './roles.js';
import { loadKey, secureFiles } from './secure-store.js';
import { runSmoke } from './smoke.js';
import { createUpdates } from './updates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.KHOZO_API || 'https://khozo.org/api';
const resources = app.isPackaged ? process.resourcesPath : path.join(here, '..', 'build', 'resources');
const YUNET = path.join(resources, 'yunet.onnx');
/** A video longer than this needs its recording start (spec F3). */
const LONG_VIDEO_SECONDS = 30 * 60;
const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', '3gp', 'm4v', 'dav', 'ts', 'mpg', 'mpeg', '264', 'h264', '265', 'h265', 'hevc'];

protocol.registerSchemesAsPrivileged([{ scheme: 'khozo', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// A separate data folder, for checking a build without touching an officer's own.
if (process.env.KHOZO_DESKTOP_USERDATA) app.setPath('userData', process.env.KHOZO_DESKTOP_USERDATA);
if (!app.requestSingleInstanceLock()) app.quit();

const logFile = () => path.join(app.getPath('userData'), 'khozo-desktop.log');
/** A support log with no faces, names or case details: what happened and when. */
function log(message) {
  try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${String(message).replace(/\s+/g, ' ').slice(0, 500)}\n`); } catch { /* the log is best effort */ }
}

// ---- the face model ------------------------------------------------------------

/** Aarakshak's model, when it was installed with the app (resources/model) or named by KHOZO_FACE_MODEL. */
function findModel() {
  const card = [path.join(resources, 'model', 'card.json'), process.env.KHOZO_FACE_MODEL].find((p) => p && fs.existsSync(p));
  if (!card) return null;
  try {
    const c = readModelCard(card);
    return { card, name: c.name, version: c.version, provider: c.provider, detectorPath: c.detectorPath || null, detectorScore: c.detectorScore };
  } catch (err) {
    log(`Face model not used: ${err.message}`);
    return null;
  }
}
const model = findModel();

// ---- settings, key and session ------------------------------------------------

const userFile = (name) => path.join(app.getPath('userData'), name);
const canEncrypt = () => safeStorage.isEncryptionAvailable();
const wrapText = (text) => (canEncrypt() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8'));
const unwrapText = (bytes) => (canEncrypt() ? safeStorage.decryptString(bytes) : bytes.toString('utf8'));

let settings = { language: 'en' };
let key = null;
let files = null;
let session = null; // { token, user }
let client = null;
let jobs = null;
let win = null;
// What Khozo lets this app do (shared/desktop-policy.js): its last answer for
// this officer, kept so a laptop with no internet knows it.
let policy = {};
const casePhotos = new Map();
const clips = new Map();

function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')) }; } catch { /* first run */ }
}
const saveSettings = () => fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings));

function saveSession() {
  if (session) fs.writeFileSync(userFile('session.bin'), wrapText(JSON.stringify(session)));
  else fs.rmSync(userFile('session.bin'), { force: true });
}

function loadSession() {
  try { session = JSON.parse(unwrapText(fs.readFileSync(userFile('session.bin')))); } catch { session = null; }
}

// ---- the scan worker ------------------------------------------------------------

function startWorker() {
  const child = utilityProcess.fork(path.join(here, 'scan-worker.cjs'), [], { serviceName: 'Khozo scanner', stdio: 'pipe' });
  const pending = new Map();
  let alive = true;
  child.stderr?.on('data', (d) => log(`scanner: ${d}`));
  child.on('message', (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.event) p.onEvent?.(m);
    else {
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
    }
  });
  child.on('exit', () => {
    alive = false;
    for (const p of pending.values()) p.reject(new Error('stopped'));
    pending.clear();
  });
  return {
    request(type, task, onEvent) {
      if (!alive) return Promise.reject(new Error('stopped'));
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onEvent });
        child.postMessage({ id, type, ...task });
      });
    },
    kill() {
      if (alive) child.kill();
      alive = false;
    },
  };
}

// ---- jobs ------------------------------------------------------------------------

let awake = null;
const lastStatus = new Map();
const pendingNotices = new Map();

function jobChanged(id) {
  // Keep the laptop awake while a job runs.
  const running = Boolean(jobs?.activeId());
  if (running && awake == null) awake = powerSaveBlocker.start('prevent-app-suspension');
  if (!running && awake != null) { powerSaveBlocker.stop(awake); awake = null; }

  const job = jobs?.get(id);
  if (job && lastStatus.get(id) === 'running' && job.status === 'done' && Notification.isSupported()) {
    const n = job.counts.likely + job.counts.possible;
    const name = job.mode === 'open_cases' ? 'Check against open cases' : job.caseName || job.caseId;
    new Notification({ title: 'Khozo Desktop', body: `${name}: ${n ? `${n} face${n === 1 ? '' : 's'} to look at` : 'the check is finished'}` }).show();
  }
  if (job) lastStatus.set(id, job.status);
  // At most a few updates a second reach the window.
  if (pendingNotices.has(id)) return;
  pendingNotices.set(id, setTimeout(() => {
    pendingNotices.delete(id);
    if (win && !win.isDestroyed()) win.webContents.send('jobs:changed', id);
  }, 300));
}

/** A live watch saw a face close to the case: the officer at the desk is told, even if the window is behind others. */
function alertDesk(jobId, person) {
  const when = person.clock || '';
  if (Notification.isSupported()) {
    const n = new Notification({
      title: 'Khozo Desktop: a face close to the case',
      body: `Seen at ${person.camera}${when ? `, ${when}` : ''}. Look at it now. It is a lead, not an identification.`,
      urgency: 'critical',
      timeoutType: 'never',
    });
    n.on('click', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('jobs:alert', { jobId, key: person.key }); } });
    n.show();
  }
  if (win && !win.isDestroyed()) {
    win.flashFrame(true);
    win.webContents.send('jobs:alert', { jobId, key: person.key });
  }
  log('A live watch saw a face close to the case');
}

function openSession() {
  client = createClient({ api: API, token: session.token });
  const userId = String(session.user.id || 'officer').replace(/[^A-Za-z0-9_-]/g, '_');
  policy = settings.policies?.[userId] || {};
  jobs = createJobs({
    root: userFile(path.join('jobs', userId)),
    files,
    key,
    startWorker,
    getClient: () => client,
    model,
    detectorPath: YUNET,
    officer: session.user,
    appVersion: app.getVersion(),
    // The laptop's own name: checks from two laptops on one case are told apart by it.
    device: os.hostname().slice(0, 80),
    frameOf,
    getPolicy: () => policy,
    onAlert: alertDesk,
    onChange: jobChanged,
    // Khozo no longer takes this sign-in (it expired, or the password changed):
    // back to the sign-in screen, with every job kept for when the officer is back.
    onSignedOut: () => setTimeout(() => {
      if (!session) return;
      log('Khozo ended the sign-in; jobs kept');
      closeSession();
      if (win && !win.isDestroyed()) win.webContents.send('session:ended');
    }, 0),
    log,
  });
  jobs.sweep(30);
  jobs.resumeInterrupted();
  syncSoon();
  watchUpdates();
}

// A newer Khozo Desktop (updates.js): asked at sign-in, then twice a day.
let updates = null;
let updateTimer = null;
function watchUpdates() {
  clearInterval(updateTimer);
  updates = createUpdates({
    getClient: () => client,
    currentVersion: app.getVersion(),
    downloadsDir: path.join(app.getPath('temp'), 'khozo-desktop-updates'),
    onChange: () => { if (win && !win.isDestroyed()) win.webContents.send('update:changed'); },
    // What Khozo lets this app do, kept for this officer for when there is no internet.
    onPolicy: (answer) => {
      policy = answer || {};
      const userId = String(session?.user?.id || 'officer').replace(/[^A-Za-z0-9_-]/g, '_');
      settings.policies = { ...(settings.policies || {}), [userId]: policy };
      saveSettings();
      if (win && !win.isDestroyed()) win.webContents.send('update:changed');
    },
    log,
    launch: (file) => {
      // For trying a release before it goes out: fetched and checked, not run.
      if (process.env.KHOZO_UPDATE_DRY_RUN) {
        log(`Would install ${file}`);
        return { dryRun: true };
      }
      // The installer replaces this app; the jobs carry on when it opens again.
      spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 500);
      return { started: true };
    },
  });
  updates.check();
  updateTimer = setInterval(() => updates?.check(), 12 * 3600 * 1000);
}

// Decisions and progress Khozo could not take wait on the laptop and go
// when it can: at sign-in, then every few minutes.
let syncTimer = null;
let syncing = false;
function syncSoon() {
  clearInterval(syncTimer);
  const sync = async () => {
    if (!jobs || syncing) return;
    syncing = true;
    try { await jobs.syncAll(); } catch (err) { log(`Sending to Khozo failed: ${err.message}`); } finally { syncing = false; }
  };
  sync();
  syncTimer = setInterval(sync, 5 * 60 * 1000);
}

function closeSession({ deleteJobs = false } = {}) {
  if (jobs) {
    for (const j of jobs.list()) if (j.status === 'running' || j.status === 'queued') jobs.pause(j.id);
    if (deleteJobs) jobs.removeAll();
  }
  clearInterval(syncTimer);
  clearInterval(updateTimer);
  updates = null;
  jobs = null;
  client = null;
  session = null;
  casePhotos.clear();
  clips.clear();
  saveSession();
}

// ---- the bridge ------------------------------------------------------------------

/** A handler whose errors reach the window as `{ error, status }` in plain words. */
const handle = (channel, fn) => ipcMain.handle(channel, async (_e, arg) => {
  try {
    return await fn(arg);
  } catch (err) {
    log(`${channel}: ${err.message}`);
    if (err instanceof KhozoError && err.status === 401 && session) closeSession();
    return { error: err.message || 'Something went wrong', status: err.status ?? null };
  }
});

const needJobs = () => {
  if (!jobs) throw new KhozoError('Sign in first', 401);
  return jobs;
};

/** The start of a recording as a datetime-local value, in this computer's time. */
function localInput(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function listVideos(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listVideos(full));
    else if (VIDEO_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase())) out.push(full);
  }
  return out.sort();
}

function registerBridge() {
  handle('app:state', () => ({
    version: app.getVersion(),
    user: session?.user || null,
    canCheck: Boolean(session && VIDEO_ROLES.includes(session.user.role)),
    // Officers see whose model it is, not its internal version (that is in the log).
    model: model ? { label: model.provider || 'Aarakshak' } : null,
    language: settings.language,
    update: updates?.view() || null,
    policy: session ? policy : {},
    api: API,
    dataFolder: app.getPath('userData'),
  }));

  handle('app:setLanguage', (language) => {
    settings.language = ['en', 'hi', 'gu'].includes(language) ? language : 'en';
    saveSettings();
    return settings.language;
  });

  handle('session:signIn', async ({ login, password }) => {
    const c = createClient({ api: API });
    const user = await c.signIn(String(login || '').trim(), String(password || ''));
    if (!VIDEO_ROLES.includes(user.role)) {
      throw new KhozoError('This account cannot check CCTV video. Only police accounts can.', 403);
    }
    session = { token: c.token, user: { id: user.id, name: user.name, role: user.role, state: user.state || user.jurisdiction?.state || null, district: user.district || user.jurisdiction?.district || null } };
    saveSession();
    openSession();
    log(`Signed in (${user.role})`);
    return { user: session.user };
  });

  handle('session:signOut', ({ deleteJobs = false } = {}) => {
    closeSession({ deleteJobs });
    log('Signed out');
    return { ok: true };
  });

  handle('cases:list', async ({ q = '' } = {}) => {
    if (!client) throw new KhozoError('Sign in first', 401);
    const rows = await client.listCases(q);
    return rows.filter(canSearchCase).slice(0, 200).map((r) => ({
      id: r.id, name: r.childName || r.name || '', firNo: r.firNo || '', age: r.age ?? null, gender: r.gender || '',
      district: r.district || '', state: r.state || '', status: r.status, hasPhoto: Boolean(r.photoUrl),
    }));
  });

  handle('cases:get', async (id) => {
    if (!client) throw new KhozoError('Sign in first', 401);
    const r = await client.getCase(id);
    return {
      id: r.id, name: r.childName || r.name || '', firNo: r.firNo || '', age: r.age ?? null, gender: r.gender || '',
      district: r.district || '', status: r.status, canSearch: canSearchCase(r), extraPhotos: (r.extraPhotos || []).map((p) => p.id),
    };
  });

  handle('files:pick', async ({ folder = false } = {}) => {
    const r = await dialog.showOpenDialog(win, folder
      ? { properties: ['openDirectory'] }
      : { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled) return [];
    const paths = folder ? listVideos(r.filePaths[0]) : r.filePaths;
    const out = [];
    for (const p of paths.slice(0, 64)) {
      try {
        const info = await probe(p);
        out.push({ path: p, name: path.basename(p), bytes: info.bytes, duration: info.duration, width: info.width, height: info.height, codec: info.codec, recordedFrom: localInput(info.recordedFrom) });
      } catch (err) {
        out.push({ path: p, name: path.basename(p), error: err.message.split('\n')[0] });
      }
    }
    return out;
  });

  handle('jobs:list', () => needJobs().list());
  handle('jobs:get', (id) => needJobs().get(id));

  // Whether this Khozo checks footage against open cases, and how many cases a narrowing searches.
  handle('openCases:count', async (filters = {}) => {
    if (!client) throw new KhozoError('Sign in first', 401);
    try {
      return await client.openCaseCount(filters);
    } catch (err) {
      // A Khozo without the route (not yet updated): the button is not shown.
      if (err.status === 404 || err.status === 405 || err.status === 501) return { enabled: false, reason: 'older' };
      throw err;
    }
  });

  handle('jobs:create', async ({ mode = 'case', caseId, filters = {}, files: chosen, window = null, settings: options = {}, live = null }) => {
    const j = needJobs();
    if (mode === 'live') return createLiveWatch(j, caseId, live || {});
    const openCases = mode === 'open_cases';
    let report = null;
    let searched = null;
    if (openCases) {
      searched = await client.openCaseCount(filters);
      if (!searched.enabled) throw new Error(searched.error || 'Checking footage against open cases is not switched on in Khozo.');
      if (!searched.cases) throw new Error('No open case fits this choice. Choose fewer limits.');
    } else {
      report = await client.getCase(caseId);
      if (!canSearchCase(report)) throw new Error('This case cannot be checked: it is found, closed, or still waiting to be verified.');
    }
    const good = (chosen || []).filter((f) => f.path && !f.error && String(f.camera || '').trim().length >= 3);
    if (!good.length) throw new Error('Add at least one video and say where its camera is.');
    // Without the start, nothing seen in a long recording has a date and time.
    if (good.some((f) => (f.duration || 0) > LONG_VIDEO_SECONDS && !f.recordedFrom)) throw new Error('Say when each video longer than 30 minutes starts, as the camera clock shows it.');
    const where = (f) => {
      const lat = Number(f.lat);
      const lng = Number(f.lng);
      return f.lat != null && f.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : { lat: null, lng: null };
    };
    const id = j.create({
      report,
      openCases: openCases ? { filters: searched.filters || filters, casesSearched: searched.cases, area: searched.area || null } : null,
      files: good.map((f) => ({ ...f, camera: String(f.camera).trim().slice(0, 200), ...where(f), recordedFrom: f.recordedFrom || null })),
      window,
      settings: {
        fps: [1, 2, 4].includes(Number(options.fps)) ? Number(options.fps) : 2,
        maxSide: options.farFaces ? 1920 : 960,
      },
    });
    log(`Job created with ${good.length} video(s)${openCases ? ` against ${searched.cases} open cases` : ''}`);
    return { id };
  });

  /**
   * A live camera watched for one case until a set time (spec scenario 11),
   * only where Khozo has it switched on. The camera is asked first, so a wrong
   * address is said now, not hours later.
   */
  async function createLiveWatch(j, caseId, live) {
    if (!policy.liveWatch) throw new Error('Watching a live camera is not switched on in Khozo.');
    if (!model) throw new Error('Watching a live camera needs Aarakshak\'s face model on this laptop.');
    const report = await client.getCase(caseId);
    if (!canSearchCase(report)) throw new Error('This case cannot be checked: it is found, closed, or still waiting to be verified.');
    const camera = String(live.camera || '').trim().slice(0, 200);
    if (camera.length < 3) throw new Error('Say where the camera is.');
    const address = String(live.address || '').trim();
    if (!isStreamAddress(address)) throw new Error('Give the camera\'s stream address, for example rtsp://192.168.1.64:554/Streaming/Channels/101');
    const until = Date.parse(live.until || '');
    const hours = Number(policy.liveWatchHours) || 12;
    if (!Number.isFinite(until) || until <= Date.now()) throw new Error('Say until when to watch, later than now.');
    if (until - Date.now() > hours * 3600 * 1000 + 60000) throw new Error(`A camera can be watched for at most ${hours} hours at a time.`);
    await probeStream(address);
    const lat = Number(live.lat);
    const lng = Number(live.lng);
    const point = live.lat != null && live.lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: null, lng: null };
    const id = j.create({
      report,
      live: { address, until: new Date(until).toISOString(), startedAt: new Date().toISOString() },
      files: [{ camera, ...point }],
      settings: { fps: 2, maxSide: live.farFaces ? 1920 : 960 },
    });
    // The address can hold the camera's password: it is never written to the log.
    log('Live watch started');
    return { id };
  }

  handle('jobs:start', (id) => needJobs().start(id));
  handle('jobs:pause', (id) => needJobs().pause(id));
  handle('jobs:remove', (id) => { needJobs().remove(id); return { ok: true }; });
  handle('update:download', async () => {
    if (!updates) throw new KhozoError('Sign in first', 401);
    return updates.download();
  });
  handle('update:install', () => {
    if (!updates) throw new KhozoError('Sign in first', 401);
    return updates.install();
  });

  // Before signing out or deleting a job: send what is waiting, and say what still is.
  handle('jobs:syncNow', async (id = null) => {
    const j = needJobs();
    await j.syncAll();
    return { unsent: j.unsent(id) };
  });
  handle('jobs:decide', ({ id, key: k, decision }) => needJobs().decide(id, k, decision === 'same' ? 'same' : 'not'));
  handle('jobs:decideLead', ({ id, leadId, decision }) => needJobs().decideLead(id, leadId, decision === 'same' ? 'same' : 'not'));

  handle('jobs:clip', async ({ id, key: k }) => {
    const found = needJobs().personOf(id, k);
    if (!found) throw new Error('This person is not in the job');
    if (found.file.live) throw new Error('Nothing is recorded from a live camera. Use "See full picture".');
    if (!fs.existsSync(found.file.path)) throw new Error('The video file is not where it was. Put the pen drive or disk back and try again.');
    const { video, from } = await clipAround(found.file.path, found.track.time);
    const clipId = crypto.randomUUID();
    clips.set(clipId, video);
    while (clips.size > 4) clips.delete(clips.keys().next().value);
    return { url: `khozo://clip/${clipId}`, from, at: found.track.time - from };
  });
}

// ---- khozo:// --------------------------------------------------------------------

function bytesResponse(request, bytes, type) {
  const total = bytes.length;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  if (!range) return new Response(bytes, { headers: { ...headers, 'Content-Length': String(total) } });
  const start = range[1] ? Number(range[1]) : 0;
  const end = Math.min(range[2] ? Number(range[2]) : total - 1, total - 1);
  return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1) } });
}

function registerScheme() {
  protocol.handle('khozo', async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (url.hostname === 'picture') {
        const [jobId, index, ...rest] = parts;
        return bytesResponse(request, needJobs().picture(jobId, Number(index), rest.join('/')), 'image/jpeg');
      }
      if (url.hostname === 'case-photo') {
        if (!client) throw new Error('Sign in first');
        const photoId = url.searchParams.get('p') || null;
        const k = `${parts[0]}|${photoId || ''}`;
        if (!casePhotos.has(k)) casePhotos.set(k, await client.photo(parts[0], photoId));
        return bytesResponse(request, casePhotos.get(k), 'image/jpeg');
      }
      if (url.hostname === 'frame') {
        const [jobId, k] = parts;
        return bytesResponse(request, await needJobs().frame(jobId, k), 'image/jpeg');
      }
      if (url.hostname === 'clip') {
        const clip = clips.get(parts[0]);
        if (!clip) throw new Error('This clip is no longer here');
        return bytesResponse(request, clip, 'video/mp4');
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      return new Response(err.message, { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
  });
}

// ---- the window ------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Khozo Desktop',
    backgroundColor: '#f5f7fa',
    show: !process.env.KHOZO_DESKTOP_SMOKE,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // A scripted check runs the window hidden; it must still draw.
      backgroundThrottling: !process.env.KHOZO_DESKTOP_SMOKE,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!jobs?.activeId() || process.env.KHOZO_DESKTOP_SMOKE) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Keep checking', 'Close'],
      defaultId: 0,
      cancelId: 0,
      message: 'A check is still running.',
      detail: 'If you close Khozo Desktop now, the check stops. It carries on from where it stopped when you open Khozo Desktop again.',
    });
    if (choice === 0) e.preventDefault();
  });
  win.loadFile(path.join(here, 'renderer', 'index.html'));
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  loadSettings();
  key = loadKey(userFile('key.bin'), {
    wrap: (k) => wrapText(k.toString('base64')),
    unwrap: (b) => Buffer.from(unwrapText(b), 'base64'),
  });
  files = secureFiles(key);
  loadSession();
  if (session) {
    openSession();
    // A token that Khozo no longer accepts (password changed, account stopped) signs the laptop out.
    client.me().catch((err) => {
      if (err.status === 401) closeSession();
    });
  }
  registerBridge();
  registerScheme();
  createWindow();
  log(`Started ${app.getVersion()}${model ? ` with ${model.name} ${model.version}` : ' without a face model'}`);
  if (process.env.KHOZO_DESKTOP_SMOKE) {
    runSmoke({
      win,
      out: process.env.KHOZO_DESKTOP_SMOKE,
      signIn: async () => {
        if (session) return;
        const c = createClient({ api: API });
        const user = await c.signIn(process.env.KHOZO_DEMO_EMAIL || process.env.KHOZO_LOGIN, process.env.KHOZO_DEMO_PASSWORD || process.env.KHOZO_PASSWORD);
        session = { token: c.token, user: { id: user.id, name: user.name, role: user.role } };
        saveSession();
        openSession();
      },
      jobs: () => jobs,
      getCase: (id) => client.getCase(id),
      probe,
      log,
    }).finally(() => app.quit());
  }
});

app.on('window-all-closed', () => app.quit());
