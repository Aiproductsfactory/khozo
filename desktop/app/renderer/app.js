// Khozo Desktop's screens. Plain words, few steps, one thing at a time: the
// officers using this are not technical people. Everything goes through
// window.khozo (preload.cjs); nothing here touches the computer directly.
import { LANGUAGES, setLanguage, t } from './i18n.js';

const k = window.khozo;
const app = document.getElementById('app');
const modal = document.getElementById('modal');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLICE = 15 * 60;
const PER_SLICE = 120;

const S = {
  state: null,
  screen: 'loading',
  jobs: [],
  jobId: null,
  job: null,
  tab: 'first',
  camera: 'all',
  shown: {},
  nc: null,
  resultsSig: '',
};

// ---- small helpers ---------------------------------------------------------------

function videoTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function timeLeft(sec) {
  if (sec == null) return '';
  if (sec < 90) return t('time.s', { n: Math.max(1, Math.round(sec)) });
  if (sec < 3600) return t('time.min', { n: Math.round(sec / 60) });
  return t('time.h', { h: Math.floor(sec / 3600), m: Math.round((sec % 3600) / 60) });
}

const size = (bytes) => (bytes > 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round((bytes || 0) / 1048576))} MB`);
const casePhoto = (id) => `khozo://case-photo/${encodeURIComponent(id)}`;
const verdictWords = (v) => t(`verdict.${v || 'no_answer'}`);
const statusWords = (s) => t(`status.${s}`);

function errorText(result) {
  if (!result?.error) return '';
  if (result.status === 401) return t('error.signed_out');
  return t('error.generic', { error: result.error });
}

// ---- the frame of every screen ----------------------------------------------------

function header() {
  const user = S.state?.user;
  const languages = LANGUAGES.map(([code, name]) => `<option value="${code}"${code === S.state?.language ? ' selected' : ''}>${esc(name)}</option>`).join('');
  return `<header class="top">
    <div class="brand">Khozo <span>Desktop</span></div>
    <div class="spacer"></div>
    ${user ? `<span>${esc(user.name || '')}</span>` : ''}
    <label class="hidden" for="lang">${esc(t('lang.label'))}</label>
    <select id="lang" data-change="lang" aria-label="${esc(t('lang.label'))}">${languages}</select>
    ${user ? `<button class="link" data-act="signout">${esc(t('top.signOut'))}</button>` : ''}
  </header>`;
}

function render() {
  if (S.screen === 'signin') return renderSignIn();
  if (S.screen === 'home') return renderHome();
  if (S.screen === 'new') return renderNew();
  if (S.screen === 'job') return renderJob(true);
  app.innerHTML = `${header()}<main><p class="quiet">${esc(t('new.loading'))}</p></main>`;
  return null;
}

// ---- sign in --------------------------------------------------------------------

function renderSignIn(error = '') {
  app.innerHTML = `${header()}
  <div class="signin">
    <h1>${esc(t('app.title'))}</h1>
    <p class="quiet">${esc(t('app.tagline'))}</p>
    <div class="card">
      <form id="signin-form" novalidate>
        <label for="login">${esc(t('signin.login'))}</label>
        <input id="login" type="text" autocomplete="username" required>
        <label for="password">${esc(t('signin.password'))}</label>
        <input id="password" type="password" autocomplete="current-password" required>
        <div class="error${error ? '' : ' hidden'}" id="signin-error" role="alert">${esc(error)}</div>
        <p style="margin-top:16px"><button class="btn primary big" type="submit" id="signin-button">${esc(t('signin.button'))}</button></p>
      </form>
      <p class="small quiet">${esc(t('signin.note'))}</p>
    </div>
  </div>`;
  document.getElementById('login').focus();
}

async function signIn(e) {
  e.preventDefault();
  const button = document.getElementById('signin-button');
  button.disabled = true;
  button.textContent = t('signin.busy');
  const result = await k.signIn({ login: document.getElementById('login').value, password: document.getElementById('password').value });
  if (result?.error) {
    renderSignIn(result.status === 401 ? t('signin.wrong') : result.error);
    return;
  }
  await reload();
}

// ---- home -----------------------------------------------------------------------

function jobProgressChip(j) {
  if (j.status === 'running') return `<span class="chip running">${esc(statusWords('running'))} ${Math.round(j.progress * 100)}%</span>`;
  return `<span class="chip ${esc(j.status)}">${esc(statusWords(j.status))}</span>`;
}

function renderHome() {
  const model = S.state?.model;
  const cards = S.jobs.map((j) => `
    <div class="card">
      <img class="thumb" src="${casePhoto(j.caseId)}" alt="">
      <div class="grow">
        <div class="row"><strong>${esc(j.caseName || t('job.case', { id: j.caseId }))}</strong> ${jobProgressChip(j)}</div>
        <p class="small quiet">${esc(t('job.case', { id: j.caseId }))}${j.caseFir ? ` · ${esc(t('job.fir', { fir: j.caseFir }))}` : ''} · ${esc(new Date(j.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</p>
        <p class="small">${esc(t('counts.people', { n: j.counts.people }))} · <strong>${esc(t('counts.toLook', { n: j.counts.likely + j.counts.possible }))}</strong></p>
        ${j.status === 'running' ? `<div class="bar"><div style="width:${Math.round(j.progress * 100)}%"></div></div>` : ''}
      </div>
      <div class="row">
        <button class="btn primary" data-act="open" data-id="${esc(j.id)}">${esc(t('home.open'))}</button>
        ${['running', 'queued'].includes(j.status) ? `<button class="btn" data-act="pause" data-id="${esc(j.id)}">${esc(t('home.pause'))}</button>` : ''}
        ${['paused', 'error'].includes(j.status) ? `<button class="btn" data-act="resume" data-id="${esc(j.id)}">${esc(t('home.resume'))}</button>` : ''}
        <button class="btn danger" data-act="remove" data-id="${esc(j.id)}">${esc(t('home.delete'))}</button>
      </div>
    </div>`).join('');
  app.innerHTML = `${header()}<main>
    ${S.state?.canCheck ? `<p><button class="btn primary big" data-act="new">${esc(t('home.new'))}</button></p>` : `<div class="error">${esc(t('home.cannotCheck'))}</div>`}
    <h2>${esc(t('home.title'))}</h2>
    <div class="jobs">${cards || `<p class="quiet">${esc(t('home.empty'))}</p>`}</div>
    <div class="footer">
      <p>${esc(model ? t('home.model.on', { name: model.label }) : t('home.model.off'))}</p>
      <p>${esc(t('footer.version', { version: S.state?.version || '' }))} · ${esc(S.state?.api || '')}</p>
    </div>
  </main>`;
}

// ---- a new check ----------------------------------------------------------------

function newCheck(caseId = null) {
  S.nc = { q: '', cases: null, caseId, files: [], part: false, from: '', to: '', fps: 2, far: false, error: '', busy: false };
  S.screen = 'new';
  render();
  searchCases('');
}

let searchTimer = null;
async function searchCases(q) {
  S.nc.q = q;
  const box = document.getElementById('cases');
  if (box) box.innerHTML = `<p class="quiet">${esc(t('new.loading'))}</p>`;
  const result = await k.listCases({ q });
  if (S.screen !== 'new' || S.nc.q !== q) return;
  S.nc.cases = Array.isArray(result) ? result : [];
  if (result?.error) S.nc.error = errorText(result);
  renderCases();
}

function renderCases() {
  const box = document.getElementById('cases');
  if (!box) return;
  const list = S.nc.cases || [];
  if (S.nc.caseId && !list.some((c) => c.id === S.nc.caseId)) list.unshift({ id: S.nc.caseId, name: '', firNo: '' });
  box.innerHTML = list.length ? list.map((c) => `
    <button class="case${c.id === S.nc.caseId ? ' chosen' : ''}" data-act="choose-case" data-id="${esc(c.id)}">
      <img class="thumb" src="${casePhoto(c.id)}" alt="" loading="lazy">
      <span>
        <strong>${esc(c.name || c.id)}</strong><br>
        <span class="small quiet">${esc([c.firNo && t('job.fir', { fir: c.firNo }), c.age != null && c.age !== '' ? `${c.age}` : '', c.gender, c.district].filter(Boolean).join(' · '))}</span><br>
        <span class="small quiet">${esc(t('job.case', { id: c.id }))}</span>
      </span>
    </button>`).join('') : `<p class="quiet">${esc(t('new.noCases'))}</p>`;
}

function filesHaveStarts() {
  return S.nc.files.filter((f) => !f.error).every((f) => f.recordedFrom);
}

function renderFiles() {
  const box = document.getElementById('files');
  if (!box) return;
  if (!S.nc.files.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<table class="files">
    <thead><tr><th>${esc(t('new.file'))}</th><th>${esc(t('new.length'))}</th><th>${esc(t('new.camera'))}</th><th>${esc(t('new.starts'))}</th><th></th></tr></thead>
    <tbody>${S.nc.files.map((f, i) => `<tr>
      <td><strong>${esc(f.name)}</strong><br><span class="small quiet">${f.error ? esc(t('new.unreadable', { error: f.error })) : `${esc(size(f.bytes))} · ${esc(f.width)}x${esc(f.height)} · ${esc(f.codec || '')}`}</span></td>
      <td>${f.error ? '' : esc(videoTime(f.duration))}</td>
      <td>${f.error ? '' : `<input type="text" data-input="camera" data-i="${i}" value="${esc(f.camera || '')}" placeholder="${esc(t('new.cameraHint'))}" aria-label="${esc(t('new.camera'))}">`}</td>
      <td>${f.error ? '' : `<input type="datetime-local" step="1" data-input="recordedFrom" data-i="${i}" value="${esc(f.recordedFrom || '')}" aria-label="${esc(t('new.starts'))}">`}</td>
      <td><button class="btn danger" data-act="remove-file" data-i="${i}">${esc(t('new.remove'))}</button></td>
    </tr>`).join('')}</tbody></table>`;
  renderPartHint();
}

function renderPartHint() {
  const hint = document.getElementById('part-hint');
  if (hint) hint.textContent = filesHaveStarts() ? t('new.partHint') : t('new.partVideoHint');
}

function renderNew() {
  const nc = S.nc;
  app.innerHTML = `${header()}<main>
    <p><button class="btn" data-act="home">← ${esc(t('job.back'))}</button></p>
    <h1>${esc(t('new.title'))}</h1>
    <div class="error${nc.error ? '' : ' hidden'}" id="new-error" role="alert">${esc(nc.error)}</div>

    <h2 class="step"><span class="n">1</span>${esc(t('new.step1'))}</h2>
    <input type="search" id="case-search" placeholder="${esc(t('new.search'))}" aria-label="${esc(t('new.search'))}" value="${esc(nc.q)}">
    <div class="cases" id="cases" style="margin-top:10px"></div>

    <h2 class="step"><span class="n">2</span>${esc(t('new.step2'))}</h2>
    <div class="row"><button class="btn" data-act="add-files">${esc(t('new.addFiles'))}</button><button class="btn" data-act="add-folder">${esc(t('new.addFolder'))}</button></div>
    <div id="files" style="margin-top:10px"></div>

    <h2 class="step"><span class="n">3</span>${esc(t('new.step3'))}</h2>
    <label class="row" style="font-weight:600"><input type="checkbox" data-input="part"${nc.part ? ' checked' : ''}> ${esc(t('new.part'))}</label>
    <div class="row${nc.part ? '' : ' hidden'}" id="part-times">
      <span>${esc(t('new.from'))}</span><input type="time" step="1" data-input="from" value="${esc(nc.from)}" style="width:150px">
      <span>${esc(t('new.to'))}</span><input type="time" step="1" data-input="to" value="${esc(nc.to)}" style="width:150px">
      <span class="small quiet" id="part-hint"></span>
    </div>

    <details><summary>${esc(t('new.more'))}</summary>
      <label for="speed">${esc(t('new.speed'))}</label>
      <select class="field" id="speed" data-input="fps" style="max-width:360px">
        <option value="2"${nc.fps === 2 ? ' selected' : ''}>${esc(t('new.speed.normal'))}</option>
        <option value="1"${nc.fps === 1 ? ' selected' : ''}>${esc(t('new.speed.quick'))}</option>
        <option value="4"${nc.fps === 4 ? ' selected' : ''}>${esc(t('new.speed.careful'))}</option>
      </select>
      <label class="row" style="font-weight:400"><input type="checkbox" data-input="far"${nc.far ? ' checked' : ''}> ${esc(t('new.far'))}</label>
    </details>

    <p class="note">${esc(t('job.lead'))}</p>
    <p class="row"><button class="btn green big" data-act="start" id="start-button">${esc(t('new.start'))}</button><button class="btn" data-act="home">${esc(t('new.cancel'))}</button></p>
  </main>`;
  renderCases();
  renderFiles();
  renderPartHint();
}

async function addFiles(folder) {
  const picked = await k.pickFiles({ folder });
  if (!Array.isArray(picked)) return;
  const known = new Set(S.nc.files.map((f) => f.path));
  for (const f of picked) if (!known.has(f.path)) S.nc.files.push({ ...f, camera: '' });
  renderFiles();
}

async function startCheck() {
  const nc = S.nc;
  const usable = nc.files.filter((f) => !f.error);
  const problem = !nc.caseId ? t('new.needCase') : !usable.length ? t('new.needFiles') : usable.some((f) => String(f.camera || '').trim().length < 3) ? t('new.needCamera') : '';
  const box = document.getElementById('new-error');
  if (problem) {
    box.textContent = problem;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const button = document.getElementById('start-button');
  button.disabled = true;
  const result = await k.createJob({
    caseId: nc.caseId,
    files: usable.map((f) => ({ path: f.path, name: f.name, bytes: f.bytes, duration: f.duration, width: f.width, height: f.height, codec: f.codec, camera: f.camera, recordedFrom: f.recordedFrom || null })),
    window: nc.part && (nc.from || nc.to) ? { mode: filesHaveStarts() ? 'clock' : 'video', from: nc.from, to: nc.to } : null,
    settings: { fps: nc.fps, farFaces: nc.far },
  });
  if (result?.error) {
    button.disabled = false;
    box.textContent = errorText(result);
    box.classList.remove('hidden');
    return;
  }
  await showJob(result.id);
}

// ---- a job ----------------------------------------------------------------------

async function showJob(id) {
  if (S.jobId !== id) {
    S.tab = 'first';
    S.camera = 'all';
    S.shown = {};
  }
  S.jobId = id;
  S.screen = 'job';
  S.resultsSig = '';
  const job = await k.getJob(id);
  if (job?.error && job.status === 401) return reload();
  S.job = job;
  renderJob(true);
}

function stateWords(f) {
  return t(`job.state.${f.state}`);
}

function waitingNote(job) {
  if (!job.waiting) return '';
  const time = timeLeft(job.waiting.seconds);
  return `<div class="info" role="status">${esc(t(`wait.${job.waiting.reason}`, { time }))}</div>`;
}

/** The part of a job's page that does not change while it runs: built once, so the case photo never flickers. */
function renderJobHead(job) {
  return `
    <p><button class="btn" data-act="home">← ${esc(t('job.back'))}</button></p>
    <div class="row" style="align-items:flex-start">
      <img class="thumb" src="${casePhoto(job.caseId)}" alt="" style="width:88px;height:88px">
      <div style="flex:1">
        <h1>${esc(job.caseName || t('job.case', { id: job.caseId }))}</h1>
        <p class="quiet">${esc(t('job.case', { id: job.caseId }))}${job.caseFir ? ` · ${esc(t('job.fir', { fir: job.caseFir }))}` : ''}</p>
        <p id="job-chip"></p>
      </div>
      <div class="row" id="job-buttons"></div>
    </div>
    <div id="job-live"></div>`;
}

function renderJobButtons(job) {
  return `${['running', 'queued'].includes(job.status) ? `<button class="btn" data-act="pause" data-id="${esc(job.id)}">${esc(t('home.pause'))}</button>` : ''}
    ${['paused', 'error'].includes(job.status) ? `<button class="btn primary" data-act="resume" data-id="${esc(job.id)}">${esc(t('home.resume'))}</button>` : ''}
    <button class="btn danger" data-act="remove" data-id="${esc(job.id)}">${esc(t('home.delete'))}</button>`;
}

/** The parts of a job's page that change as it runs: the videos' progress and any message. */
function renderJobLive(job) {
  const files = job.files.map((f) => `
    <div class="file">
      <div><strong>${esc(f.camera)}</strong> <span class="small quiet">${esc(f.name)}</span>
        <div class="bar" style="margin-top:6px"><div style="width:${Math.round(f.progress * 100)}%"></div></div></div>
      <div class="small">
        <span class="chip ${esc(f.state)}">${esc(stateWords(f))}${f.state === 'reading' ? ` ${Math.round(f.progress * 100)}%` : ''}</span><br>
        ${f.state === 'reading' && f.eta != null ? `${esc(t('job.left', { time: timeLeft(f.eta) }))}<br>` : ''}
        ${esc(t('job.peopleSeen', { n: f.people }))}${f.tooSmall ? `<br><span class="quiet">${esc(t('job.tooSmall', { n: f.tooSmall }))}</span>` : ''}
        ${f.error ? `<br><span class="quiet">${esc(f.error)}</span>` : ''}
      </div>
    </div>`).join('');
  const error = job.error === 'signed_out' ? t('error.signed_out') : job.error ? t('error.generic', { error: job.error }) : '';
  return `
    ${error ? `<div class="error" role="alert">${esc(error)}</div>` : ''}
    ${waitingNote(job)}
    ${job.notice ? `<div class="info">${esc(t(`notice.${job.notice}`, { n: 600 }))}</div>` : ''}
    <h3>${esc(t('job.files'))}</h3>
    <div class="card files-progress">${files}</div>
    <p class="note">${esc(t('job.lead'))}</p>`;
}

function personCard(job, p) {
  const decision = p.decision;
  let decided = '';
  if (decision?.decision === 'same') {
    decided = decision.saved === false
      ? `<p class="error">${esc(t('person.addFailed', { error: decision.error || '' }))}</p>`
      : `<p class="decided same">✓ ${esc(t('person.added'))}</p>`;
  } else if (decision?.decision === 'not') {
    decided = `<p class="decided not">${esc(t('person.markedNot'))}</p>`;
  }
  const when = p.clock ? `${p.clock} (${t('person.into', { t: videoTime(p.time) })})` : t('person.into', { t: videoTime(p.time) });
  return `<article class="hit ${esc(p.verdict)}">
    <div class="pair">
      <figure><img src="${casePhoto(job.caseId)}" alt=""><figcaption>${esc(t('person.caseFace'))}</figcaption></figure>
      <figure><img src="${esc(p.picture)}" alt="" loading="lazy"><figcaption>${esc(t('person.videoFace'))}</figcaption></figure>
    </div>
    <div style="flex:1">
      <div class="verdict">${esc(verdictWords(p.verdict))}</div>
      <p>${esc(t('person.seen', { camera: p.camera, when }))}</p>
      ${p.closeness != null ? `<p class="small quiet">${esc(t('person.closeness', { score: p.closeness.toFixed(2) }))}</p>` : ''}
      <div class="row" style="margin-top:10px">
        <button class="btn primary" data-act="play" data-key="${esc(p.key)}">▶ ${esc(t('person.play'))}</button>
        <button class="btn" data-act="frame" data-key="${esc(p.key)}">${esc(t('person.frame'))}</button>
        ${decision?.decision === 'same' && decision.saved !== false ? '' : `<button class="btn green" data-act="same" data-key="${esc(p.key)}">${esc(t('person.same'))}</button>`}
        ${decision?.decision ? '' : `<button class="btn" data-act="not" data-key="${esc(p.key)}">${esc(t('person.not'))}</button>`}
      </div>
      ${decided}
    </div>
  </article>`;
}

function renderFirst(job) {
  if (job.toCheck.length) return job.toCheck.map((p) => personCard(job, p)).join('');
  const finished = job.status === 'done';
  return `<p class="quiet">${esc(finished ? t('job.noneFound') : t('job.noneYet'))}</p>`;
}

function renderEveryone(job) {
  const cameras = job.files.map((f) => `<option value="${f.index}"${String(S.camera) === String(f.index) ? ' selected' : ''}>${esc(f.camera)} (${esc(f.name)})</option>`).join('');
  const people = job.everyone.filter((p) => S.camera === 'all' || String(p.fileIndex) === String(S.camera));
  const groups = new Map();
  for (const p of people) {
    const slice = Math.floor(p.time / SLICE);
    const groupKey = `${p.fileIndex}|${slice}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(p);
  }
  const blocks = [...groups.entries()].map(([groupKey, list]) => {
    const [fileIndex, slice] = groupKey.split('|').map(Number);
    const file = job.files[fileIndex];
    const from = slice * SLICE;
    const label = `${file.camera} · ${videoTime(from)} – ${videoTime(from + SLICE)}`;
    const limit = S.shown[groupKey] || PER_SLICE;
    const faces = list.slice(0, limit).map((p) => `<button class="face" data-act="play" data-key="${esc(p.key)}" title="${esc(verdictWords(p.verdict))}">
      <img src="${esc(p.picture)}" alt="" loading="lazy">
      <div class="t">${esc(p.clock || videoTime(p.time))}</div>
      ${['likely', 'possible', 'not_agreed'].includes(p.verdict) ? `<span class="chip ${esc(p.verdict)}">${esc(t(`chip.${p.verdict}`))}</span>` : ''}
    </button>`).join('');
    const more = list.length > limit ? `<p><button class="btn" data-act="more" data-group="${esc(groupKey)}">${esc(t('job.showMore', { n: Math.min(PER_SLICE, list.length - limit) }))}</button></p>` : '';
    return `<h3>${esc(label)} <span class="quiet small">(${esc(t('job.peopleSeen', { n: list.length }))})</span></h3><div class="grid">${faces}</div>${more}`;
  }).join('');
  return `<p class="row"><select class="field" data-change="camera" style="max-width:420px" aria-label="${esc(t('job.allCameras'))}"><option value="all">${esc(t('job.allCameras'))}</option>${cameras}</select></p>${blocks || `<p class="quiet">${esc(t('job.noneYet'))}</p>`}`;
}

function renderJob(full) {
  const job = S.job;
  if (!job) {
    app.innerHTML = `${header()}<main><p class="quiet">${esc(t('new.loading'))}</p></main>`;
    return;
  }
  if (full || !document.getElementById('job-top') || document.getElementById('job-top').dataset.id !== job.id) {
    app.innerHTML = `${header()}<main>
      <div id="job-top" data-id="${esc(job.id)}">${renderJobHead(job)}</div>
      <div class="tabs" role="tablist">
        <button role="tab" data-act="tab" data-tab="first" id="tab-first"></button>
        <button role="tab" data-act="tab" data-tab="everyone" id="tab-everyone"></button>
      </div>
      <div id="results"></div>
    </main>`;
    S.resultsSig = '';
  }
  const progress = job.files.length ? job.files.reduce((n, f) => n + f.progress, 0) / job.files.length : 0;
  document.getElementById('job-chip').innerHTML = jobProgressChip({ status: job.status, progress });
  document.getElementById('job-buttons').innerHTML = renderJobButtons(job);
  document.getElementById('job-live').innerHTML = renderJobLive(job);
  const first = document.getElementById('tab-first');
  const everyone = document.getElementById('tab-everyone');
  first.textContent = t('job.tabFirst', { n: job.toCheck.length });
  everyone.textContent = t('job.tabEveryone', { n: job.everyone.length });
  first.classList.toggle('on', S.tab === 'first');
  everyone.classList.toggle('on', S.tab === 'everyone');
  const sig = JSON.stringify([S.tab, S.camera, S.shown, job.status, job.toCheck.map((p) => [p.key, p.verdict, p.decision?.decision, p.decision?.saved]), job.everyone.length, S.state?.language]);
  if (sig !== S.resultsSig) {
    S.resultsSig = sig;
    document.getElementById('results').innerHTML = S.tab === 'first' ? renderFirst(job) : renderEveryone(job);
  }
}

// ---- the player and the full picture --------------------------------------------------

function closeModal() {
  const video = modal.querySelector('video');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  modal.innerHTML = '';
}

function personByKey(key) {
  return S.job?.everyone.find((p) => p.key === key) || null;
}

async function openPerson(key) {
  const p = personByKey(key);
  if (!p) return;
  modal.innerHTML = `<div class="modal" data-act="close-modal"><div class="box" role="dialog" aria-modal="true">
    <div class="head"><strong class="grow">${esc(t('person.seen', { camera: p.camera, when: p.clock || t('person.into', { t: videoTime(p.time) }) }))}</strong>
      <button class="btn" data-act="close-modal">${esc(t('player.close'))}</button></div>
    <p class="quiet" id="clip-note">${esc(t('player.making'))}</p>
    <div class="row" style="align-items:flex-start">
      <div id="clip-box"></div>
      <div class="pair" style="flex-direction:column">
        <figure><img src="${casePhoto(S.job.caseId)}" alt=""><figcaption>${esc(t('person.caseFace'))}</figcaption></figure>
        <figure><img src="${esc(p.picture)}" alt=""><figcaption>${esc(t('person.videoFace'))}</figcaption></figure>
      </div>
    </div>
  </div></div>`;
  const clip = await k.clip({ id: S.job.id, key });
  const note = document.getElementById('clip-note');
  if (!note) return;
  if (clip?.error) {
    note.textContent = t('error.generic', { error: clip.error });
    return;
  }
  note.textContent = t('player.at', { t: videoTime(clip.at) });
  document.getElementById('clip-box').innerHTML = `<video src="${esc(clip.url)}" controls autoplay muted playsinline></video>`;
}

function openFrame(key) {
  const p = personByKey(key);
  if (!p) return;
  modal.innerHTML = `<div class="modal" data-act="close-modal"><div class="box" role="dialog" aria-modal="true">
    <div class="head"><strong class="grow">${esc(t('person.seen', { camera: p.camera, when: p.clock || t('person.into', { t: videoTime(p.time) }) }))}</strong>
      <button class="btn" data-act="close-modal">${esc(t('player.close'))}</button></div>
    <img id="frame-img" src="khozo://frame/${encodeURIComponent(S.job.id)}/${encodeURIComponent(key)}" alt="">
  </div></div>`;
}

// ---- events ---------------------------------------------------------------------

async function loadJobs() {
  const list = await k.listJobs();
  S.jobs = Array.isArray(list) ? list : [];
}

async function reload() {
  S.state = await k.state();
  setLanguage(S.state.language);
  document.documentElement.lang = S.state.language;
  if (!S.state.user) {
    S.screen = 'signin';
  } else if (S.screen === 'signin' || S.screen === 'loading') {
    await loadJobs();
    S.screen = 'home';
  } else if (S.screen === 'home') {
    await loadJobs();
  }
  render();
}

const actions = {
  async signout() {
    if (!window.confirm(t('signout.confirm'))) return;
    await k.signOut({ deleteJobs: true });
    S.screen = 'signin';
    await reload();
  },
  async home() {
    S.screen = 'home';
    S.jobId = null;
    S.job = null;
    await loadJobs();
    render();
  },
  new() { newCheck(); },
  async open(el) { await showJob(el.dataset.id); },
  async pause(el) { await k.pauseJob(el.dataset.id); },
  async resume(el) { await k.startJob(el.dataset.id); },
  async remove(el) {
    if (!window.confirm(t('home.deleteConfirm'))) return;
    await k.removeJob(el.dataset.id);
    if (S.jobId === el.dataset.id) await actions.home();
    else { await loadJobs(); render(); }
  },
  'choose-case'(el) {
    S.nc.caseId = el.dataset.id;
    renderCases();
  },
  async 'add-files'() { await addFiles(false); },
  async 'add-folder'() { await addFiles(true); },
  'remove-file'(el) {
    S.nc.files.splice(Number(el.dataset.i), 1);
    renderFiles();
  },
  async start() { await startCheck(); },
  tab(el) {
    S.tab = el.dataset.tab;
    renderJob(false);
  },
  more(el) {
    S.shown[el.dataset.group] = (S.shown[el.dataset.group] || PER_SLICE) + PER_SLICE;
    renderJob(false);
  },
  async play(el) { await openPerson(el.dataset.key); },
  frame(el) { openFrame(el.dataset.key); },
  async same(el) {
    if (!window.confirm(t('person.sameConfirm'))) return;
    el.disabled = true;
    await k.decide({ id: S.job.id, key: el.dataset.key, decision: 'same' });
    S.job = await k.getJob(S.job.id);
    renderJob(false);
  },
  async not(el) {
    el.disabled = true;
    await k.decide({ id: S.job.id, key: el.dataset.key, decision: 'not' });
    S.job = await k.getJob(S.job.id);
    renderJob(false);
  },
  'close-modal'(el, e) {
    if (e.target !== el && el.classList.contains('modal')) return;
    closeModal();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = actions[el.dataset.act];
  if (act) act(el, e);
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'signin-form') signIn(e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.innerHTML) closeModal();
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.change === 'lang') {
    await k.setLanguage(el.value);
    S.resultsSig = '';
    await reload();
  } else if (el.dataset.change === 'camera') {
    S.camera = el.value;
    renderJob(false);
  } else if (el.dataset.input === 'part') {
    S.nc.part = el.checked;
    document.getElementById('part-times').classList.toggle('hidden', !el.checked);
  } else if (el.dataset.input === 'fps') {
    S.nc.fps = Number(el.value);
  } else if (el.dataset.input === 'far') {
    S.nc.far = el.checked;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'case-search') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchCases(el.value.trim()), 350);
  } else if (el.dataset.input === 'camera' || el.dataset.input === 'recordedFrom') {
    S.nc.files[Number(el.dataset.i)][el.dataset.input] = el.value;
    if (el.dataset.input === 'recordedFrom') renderPartHint();
  } else if (el.dataset.input === 'from' || el.dataset.input === 'to') {
    S.nc[el.dataset.input] = el.value;
  }
});

k.onJobChanged(async (id) => {
  if (S.screen === 'job' && S.jobId === id) {
    const job = await k.getJob(id);
    if (job?.error) return;
    S.job = job;
    renderJob(false);
  } else if (S.screen === 'home') {
    await loadJobs();
    render();
  }
});

// For the scripted check of a build (app/smoke.js).
window.__khozo = {
  reload,
  newCheck,
  showJob,
  tab: (name) => { S.tab = name; renderJob(false); },
  openPerson,
  closePerson: closeModal,
  openFrame,
};

reload();
