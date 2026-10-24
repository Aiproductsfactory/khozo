// Khozo Desktop's screens. Plain words, few steps, one thing at a time: the
// officers using this are not technical people. Everything goes through
// window.khozo (preload.cjs); nothing here touches the computer directly.
import { LANGUAGES, setLanguage, t } from './i18n.js';

/** The language's own way of writing dates, for the live watch's end. */
const currentLocale = () => ({ hi: 'hi-IN', gu: 'gu-IN' }[S?.state?.language] || 'en-IN');

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
  // Whether this Khozo checks footage against open cases (asked once a visit to the home screen).
  openCases: null,
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
  if (S.screen === 'signin') return renderSignIn(S.signinNote || '');
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
  S.signinNote = '';
  await reload();
}

// ---- home -----------------------------------------------------------------------

function jobProgressChip(j) {
  if (j.status === 'running') return `<span class="chip running">${esc(statusWords('running'))} ${Math.round(j.progress * 100)}%</span>`;
  return `<span class="chip ${esc(j.status)}">${esc(statusWords(j.status))}</span>`;
}

/** A newer Khozo Desktop, when Khozo says one is out (main.js updates). */
function updateBanner() {
  const u = S.state?.update;
  if (!u) return '';
  const head = `<strong>${esc(t('update.ready', { version: u.version }))}</strong>${u.notes ? `<br><span class="small">${esc(u.notes)}</span>` : ''}`;
  let action = '';
  if (!u.canDownload) action = `<p class="small">${esc(t('update.askNodal'))}</p>`;
  else if (u.stage === 'available') action = `<p><button class="btn primary" data-act="update-download" id="update-download">${esc(t('update.download'))}</button></p>`;
  else if (u.stage === 'downloading') action = `<p class="small" id="update-progress">${esc(t('update.downloading', { n: Math.round((u.progress || 0) * 100) }))}</p>`;
  else if (u.stage === 'ready') action = `<p class="small">${esc(t('update.checked'))}</p><p><button class="btn green" data-act="update-install" id="update-install">${esc(t('update.install'))}</button></p>`;
  else if (u.stage === 'failed') action = `<p class="error">${esc(u.error || '')}</p><p><button class="btn" data-act="update-download" id="update-download">${esc(t('update.retry'))}</button></p>`;
  return `<div class="info" role="status" id="update-banner">${head}${action}</div>`;
}

/** A check against open cases has no case photo: a plain tile stands in for it. */
const openTile = (side = 64) => `<div class="thumb open-tile" style="width:${side}px;height:${side}px" aria-hidden="true">⌕</div>`;

/** What a check against open cases was narrowed to, in words. */
function filtersText(f = {}) {
  return [
    f.sex ? t(`open.sex.${f.sex}`) : '',
    f.ageFrom != null || f.ageTo != null ? t('open.sumAge', { from: f.ageFrom ?? 0, to: f.ageTo ?? '…' }) : '',
    f.district || '',
    f.missingFrom || f.missingTo ? t('open.sumMissing', { from: f.missingFrom || '…', to: f.missingTo || '…' }) : '',
  ].filter(Boolean).join(' · ');
}

function renderHome() {
  const model = S.state?.model;
  const cards = S.jobs.map((j) => `
    <div class="card">
      ${j.mode === 'open_cases' ? openTile() : `<img class="thumb" src="${casePhoto(j.caseId)}" alt="">`}
      <div class="grow">
        <div class="row"><strong>${esc(j.mode === 'open_cases' ? t('open.title') : j.caseName || t('job.case', { id: j.caseId }))}</strong> ${jobProgressChip(j)}</div>
        <p class="small quiet">${j.mode === 'open_cases'
    ? esc(t('open.searched', { n: j.openCases?.casesSearched ?? 0 }))
    : `${esc(t('job.case', { id: j.caseId }))}${j.caseFir ? ` · ${esc(t('job.fir', { fir: j.caseFir }))}` : ''}`} · ${esc(new Date(j.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</p>
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
    ${updateBanner()}
    ${S.state?.canCheck ? `<p class="row"><button class="btn primary big" data-act="new">${esc(t('home.new'))}</button>
      ${S.openCases?.enabled ? `<button class="btn big" data-act="new-open" id="new-open">${esc(t('home.openCases'))}</button>` : ''}
      ${S.state?.policy?.liveWatch && S.state?.model ? `<button class="btn big" data-act="new-live" id="new-live">${esc(t('home.live'))}</button>` : ''}</p>
      ${S.openCases?.enabled ? `<p class="small quiet">${esc(t('home.openCasesNote'))}</p>` : ''}` : `<div class="error">${esc(t('home.cannotCheck'))}</div>`}
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
  S.nc = { mode: 'case', q: '', cases: null, caseId, files: [], part: false, from: '', to: '', fps: 2, far: false, error: '', busy: false };
  S.screen = 'new';
  render();
  searchCases('');
}

/** A check of footage against open cases: no case, the officer narrows the cases instead (spec F15). */
function newOpenCheck() {
  S.nc = {
    mode: 'open_cases', filters: { sex: '', ageFrom: '', ageTo: '', district: '', missingFrom: '', missingTo: '' }, count: null,
    files: [], part: false, from: '', to: '', fps: 2, far: false, error: '', busy: false,
  };
  S.screen = 'new';
  render();
  countCases();
}

let countTimer = null;
/** How many open cases the narrowing searches, as Khozo counts them. */
async function countCases() {
  const asked = JSON.stringify(S.nc.filters);
  const result = await k.openCaseCount(S.nc.filters);
  if (S.screen !== 'new' || S.nc.mode !== 'open_cases' || JSON.stringify(S.nc.filters) !== asked) return;
  S.nc.count = result;
  renderCount();
}

function renderCount() {
  const box = document.getElementById('case-count');
  if (!box) return;
  const c = S.nc.count;
  if (!c) {
    box.innerHTML = `<p class="quiet">${esc(t('new.loading'))}</p>`;
    return;
  }
  if (c.error && !('enabled' in c)) {
    box.innerHTML = `<div class="error">${esc(errorText(c))}</div>`;
    return;
  }
  if (!c.enabled) {
    box.innerHTML = `<div class="error">${esc(c.error || t('open.off'))}</div>`;
    return;
  }
  const place = c.area?.kind === 'country' ? t('open.area.country') : c.area?.kind === 'district' ? t('open.area.district', { place: c.area.district || '' }) : t('open.area.state', { place: c.area?.state || '' });
  box.innerHTML = `<div class="info" role="status"><strong id="case-count-n">${esc(c.cases ? t('open.count', { n: c.cases }) : t('open.countNone'))}</strong>
    <br><span class="small">${esc(place)}${c.notInIndex ? ` ${esc(t('open.notInIndex', { n: c.notInIndex }))}` : ''}</span></div>`;
}

function renderFilters() {
  const f = S.nc.filters;
  const sex = ['', 'female', 'male'].map((v) => `<option value="${v}"${f.sex === v ? ' selected' : ''}>${esc(t(`open.sex.${v || 'any'}`))}</option>`).join('');
  return `<div class="filters">
    <label>${esc(t('open.sex'))}<select class="field" data-input="f-sex">${sex}</select></label>
    <label>${esc(t('open.age'))}<span class="row"><input type="number" min="0" max="120" data-input="f-ageFrom" value="${esc(f.ageFrom)}" placeholder="${esc(t('open.ageFrom'))}" aria-label="${esc(t('open.ageFrom'))}" style="width:90px">
      <span>–</span><input type="number" min="0" max="120" data-input="f-ageTo" value="${esc(f.ageTo)}" placeholder="${esc(t('open.ageTo'))}" aria-label="${esc(t('open.ageTo'))}" style="width:90px"></span></label>
    <label>${esc(t('open.district'))}<input type="text" data-input="f-district" value="${esc(f.district)}"></label>
    <label class="wide">${esc(t('open.missing'))}<span class="row"><input type="date" data-input="f-missingFrom" value="${esc(f.missingFrom)}" aria-label="${esc(t('open.missingFrom'))}">
      <span>–</span><input type="date" data-input="f-missingTo" value="${esc(f.missingTo)}" aria-label="${esc(t('open.missingTo'))}"></span></label>
  </div>
  <div id="case-count" style="margin-top:10px"></div>`;
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

/**
 * A map point from what an officer pastes: two numbers ("23.0225, 72.5714"),
 * or a Google Maps link that holds them (…/@23.0225,72.5714,17z or …!3d23.02!4d72.57).
 * A short link (maps.app.goo.gl) holds none.
 */
function pointFrom(value) {
  const s = String(value || '');
  const m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(s) || /(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng) ? { lat, lng } : null;
}

function whereNote(f) {
  if (!String(f.where || '').trim()) return '';
  return f.lat != null ? t('new.whereOk', { lat: f.lat.toFixed(5), lng: f.lng.toFixed(5) }) : t('new.whereBad');
}

/** Longer than this, a video needs its recording start (spec F3), or nothing in it has a date and time. */
const LONG_VIDEO_SECONDS = 30 * 60;

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
      <td>${f.error ? '' : `<input type="text" data-input="camera" data-i="${i}" value="${esc(f.camera || '')}" placeholder="${esc(t('new.cameraHint'))}" aria-label="${esc(t('new.camera'))}">
        <input type="text" data-input="where" data-i="${i}" value="${esc(f.where || '')}" placeholder="${esc(t('new.whereHint'))}" aria-label="${esc(t('new.where'))}" style="margin-top:6px">
        <span class="small quiet" id="where-note-${i}">${esc(whereNote(f))}</span>
        ${i === 0 && S.nc.files.filter((x) => !x.error).length > 1 ? `<br><button class="btn small" data-act="camera-all" data-i="0" id="camera-all">${esc(t('new.cameraAll'))}</button>` : ''}`}</td>
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
  const open = nc.mode === 'open_cases';
  const live = nc.mode === 'live';
  const hours = Number(S.state?.policy?.liveWatchHours) || 12;
  app.innerHTML = `${header()}<main>
    <p><button class="btn" data-act="home">← ${esc(t('job.back'))}</button></p>
    <h1>${esc(open ? t('open.title') : live ? t('live.title') : t('new.title'))}</h1>
    ${open ? `<p class="quiet">${esc(t('home.openCasesNote'))}</p>` : ''}
    ${live ? `<p class="quiet">${esc(t('home.liveNote'))}</p>` : ''}
    <div class="error${nc.error ? '' : ' hidden'}" id="new-error" role="alert">${esc(nc.error)}</div>

    <h2 class="step"><span class="n">1</span>${esc(open ? t('open.step1') : t('new.step1'))}</h2>
    ${open ? renderFilters() : `<input type="search" id="case-search" placeholder="${esc(t('new.search'))}" aria-label="${esc(t('new.search'))}" value="${esc(nc.q)}">
    <div class="cases" id="cases" style="margin-top:10px"></div>`}

    ${live ? `
    <h2 class="step"><span class="n">2</span>${esc(t('live.step2'))}</h2>
    <div class="live-fields">
      <label>${esc(t('new.camera'))}<input type="text" data-input="live-camera" id="live-camera" value="${esc(nc.camera)}" placeholder="${esc(t('new.cameraHint'))}"></label>
      <label>${esc(t('live.address'))}<input type="text" data-input="live-address" id="live-address" value="${esc(nc.address)}" placeholder="rtsp://192.168.1.64:554/Streaming/Channels/101" autocomplete="off" spellcheck="false"></label>
      <span class="small quiet">${esc(t('live.addressHint'))}</span>
      <label>${esc(t('new.where'))}<input type="text" data-input="live-where" id="live-where" value="${esc(nc.where)}" placeholder="${esc(t('new.whereHint'))}"></label>
      <span class="small quiet" id="live-where-note">${esc(whereNote(nc))}</span>
      <label>${esc(t('live.until'))}<input type="datetime-local" data-input="live-until" id="live-until" value="${esc(nc.until)}"></label>
      <span class="small quiet">${esc(t('live.untilHint', { n: hours }))}</span>
    </div>
    <details><summary>${esc(t('new.more'))}</summary>
      <label class="row" style="font-weight:400"><input type="checkbox" data-input="far"${nc.far ? ' checked' : ''}> ${esc(t('new.far'))}</label>
    </details>` : `
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
    </details>`}

    <p class="note">${esc(open ? t('open.lead') : live ? t('live.lead') : t('job.lead'))}</p>
    <p class="row"><button class="btn green big" data-act="start" id="start-button">${esc(live ? t('live.start') : t('new.start'))}</button><button class="btn" data-act="home">${esc(t('new.cancel'))}</button></p>
  </main>`;
  if (open) renderCount();
  else renderCases();
  if (!live) {
    renderFiles();
    renderPartHint();
  }
}

/** A datetime-local value for `ms`, in this computer's time. */
function localValue(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Watching one live camera for one case (spec scenario 11), where Khozo has it switched on. */
function newLiveCheck() {
  S.nc = {
    mode: 'live', q: '', cases: null, caseId: null, files: [], camera: '', address: '', where: '', lat: null, lng: null,
    until: localValue(Date.now() + 2 * 3600 * 1000), far: false, error: '', busy: false,
  };
  S.screen = 'new';
  render();
  searchCases('');
}

/** Starts a live watch, or says what is missing. */
async function startLive() {
  const nc = S.nc;
  const problem = !nc.caseId ? t('new.needCase')
    : String(nc.camera || '').trim().length < 3 ? t('new.needCamera')
      : !String(nc.address || '').trim() ? t('live.needAddress')
        : !nc.until || !Number.isFinite(Date.parse(nc.until)) ? t('live.needUntil')
          : String(nc.where || '').trim() && nc.lat == null ? t('new.whereBad')
            : '';
  const box = document.getElementById('new-error');
  if (problem) {
    box.textContent = problem;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const button = document.getElementById('start-button');
  button.disabled = true;
  button.textContent = t('live.connecting');
  const result = await k.createJob({
    mode: 'live',
    caseId: nc.caseId,
    live: { camera: nc.camera, address: nc.address, lat: nc.lat, lng: nc.lng, until: new Date(Date.parse(nc.until)).toISOString(), farFaces: nc.far },
  });
  if (result?.error) {
    button.disabled = false;
    button.textContent = t('live.start');
    box.textContent = errorText(result);
    box.classList.remove('hidden');
    return;
  }
  await showJob(result.id);
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
  if (nc.mode === 'live') return startLive();
  const usable = nc.files.filter((f) => !f.error);
  const open = nc.mode === 'open_cases';
  const problem = open && nc.count && !nc.count.enabled ? nc.count.error || t('open.off')
    : open && !nc.count?.cases ? t('open.countNone')
      : !open && !nc.caseId ? t('new.needCase')
    : !usable.length ? t('new.needFiles')
      : usable.some((f) => String(f.camera || '').trim().length < 3) ? t('new.needCamera')
        : usable.some((f) => (f.duration || 0) > LONG_VIDEO_SECONDS && !f.recordedFrom) ? t('new.needStart')
          : usable.some((f) => String(f.where || '').trim() && f.lat == null) ? t('new.whereBad')
            : '';
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
    ...(open ? { mode: 'open_cases', filters: nc.filters } : { caseId: nc.caseId }),
    files: usable.map((f) => ({ path: f.path, name: f.name, bytes: f.bytes, duration: f.duration, width: f.width, height: f.height, codec: f.codec, camera: f.camera, lat: f.lat ?? null, lng: f.lng ?? null, recordedFrom: f.recordedFrom || null })),
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

/** Whether Khozo has this check's record, and what is still waiting to go to it. */
function syncNote(job) {
  const sync = job.sync || {};
  if (sync.olderKhozo) return `<p class="small quiet">${esc(t('sync.older'))}</p>`;
  if (sync.decisionsWaiting) return `<div class="info" role="status">${esc(t('sync.waiting', { n: sync.decisionsWaiting }))}</div>`;
  if (sync.kept) return `<p class="small quiet">✓ ${esc(t('sync.kept'))}</p>`;
  return '';
}

/** The part of a job's page that does not change while it runs: built once, so the case photo never flickers. */
function renderJobHead(job) {
  if (job.mode === 'open_cases') {
    const narrowed = filtersText(job.openCases?.filters);
    return `
    <p><button class="btn" data-act="home">← ${esc(t('job.back'))}</button></p>
    <div class="row" style="align-items:flex-start">
      ${openTile(88)}
      <div style="flex:1">
        <h1>${esc(t('open.title'))}</h1>
        <p class="quiet">${esc(t('open.searched', { n: job.openCases?.casesSearched ?? 0 }))}${narrowed ? ` · ${esc(narrowed)}` : ''}</p>
        <p id="job-chip"></p>
      </div>
      <div class="row" id="job-buttons"></div>
    </div>
    <div id="job-live"></div>`;
  }
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
  const watchOver = job.live && Date.parse(job.live.until) <= Date.now();
  return `${['running', 'queued'].includes(job.status) ? `<button class="btn" data-act="pause" data-id="${esc(job.id)}">${esc(t(job.live ? 'live.stop' : 'home.pause'))}</button>` : ''}
    ${['paused', 'error'].includes(job.status) && !watchOver ? `<button class="btn primary" data-act="resume" data-id="${esc(job.id)}">${esc(t(job.live ? 'live.resume' : 'home.resume'))}</button>` : ''}
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
    ${syncNote(job)}
    ${job.notice ? `<div class="info">${esc(t(`notice.${job.notice}`, { n: 600 }))}</div>` : ''}
    ${job.photoYears >= 2 ? `<div class="info" id="old-photo">${esc(t('notice.old_photo', { n: job.photoYears }))}</div>` : ''}
    ${job.live ? `<div class="info live-line" id="live-line">${esc(t('live.watching', { camera: job.files[0]?.camera || '', until: new Date(job.live.until).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }) }))}
      <br><span class="small">${esc(t('live.counts', { n: job.live.peopleSeen || 0, close: job.counts.people }))}</span></div>` : ''}
    ${job.live?.stalled && job.status === 'running' ? `<div class="error" role="status">${esc(t('live.stalled'))}</div>` : ''}
    ${job.counts.laptop ? `<div class="info">${esc(t('laptop.note'))}</div>` : ''}
    <h3>${esc(t('job.files'))}</h3>
    <div class="card files-progress">${files}</div>
    <p class="note">${esc(job.mode === 'open_cases' ? t('open.lead') : t('job.lead'))}</p>`;
}

/**
 * Seen together (spec F14): the people on the same camera within ten
 * seconds of a confirmed moment. Shown only: nobody here is searched for.
 */
function togetherBlock(p) {
  if (!p.together?.length) return '';
  return `<details class="together"><summary>${esc(t('together.title', { n: p.together.length }))}</summary>
    <p class="small quiet">${esc(t('together.note'))}</p>
    <div class="grid">${p.together.map((o) => `<button class="face" data-act="play" data-key="${esc(o.key)}">
      <img src="${esc(o.picture)}" alt="" loading="lazy"><div class="t">${esc(o.clock || videoTime(o.time))}</div></button>`).join('')}</div>
  </details>`;
}

/** One face close to an open case, with the officer's word on it. */
function leadCard(group, lead) {
  const p = lead.person;
  const d = lead.decision;
  const when = p.clock ? `${p.clock} (${t('person.into', { t: videoTime(p.time) })})` : t('person.into', { t: videoTime(p.time) });
  let decided = '';
  if (d?.decision === 'same') {
    decided = d.saved === false && !d.error ? `<p class="quiet" role="status">${esc(t('person.sending'))}</p>`
      : d.saved === false && d.offline ? `<p class="quiet" role="status">${esc(t('person.waitingToSend'))}</p>`
        : d.saved === false ? `<p class="error">${esc(t('open.sendFailed', { error: d.error }))}</p>`
          : `<p class="decided same">✓ ${esc(t(group.inScope ? 'open.sent' : 'open.sentOutside'))}</p>`;
  } else if (d?.decision === 'not') {
    decided = `<p class="decided not">${esc(t(group.inScope ? 'person.markedNot' : 'open.notSent'))}</p>`;
  }
  const scores = group.inScope && lead.aarakshak != null
    ? `<details class="small quiet"><summary>${esc(t('person.details'))}</summary>${esc(t('open.scores', { a: Number(lead.aarakshak).toFixed(2), r: Number(lead.rekognition).toFixed(2), rank: lead.rank }))}</details>`
    : '';
  return `<article class="hit likely" data-lead="${esc(lead.id)}">
    <div class="pair">
      ${group.inScope ? `<figure><img src="${casePhoto(group.caseId)}" alt=""><figcaption>${esc(t('person.caseFace'))}</figcaption></figure>` : ''}
      <figure><img src="${esc(p.picture)}" alt="" loading="lazy"><figcaption>${esc(t('person.videoFace'))}</figcaption></figure>
    </div>
    <div style="flex:1">
      <p>${esc(t('person.seen', { camera: p.camera, when }))}</p>
      ${scores}
      <div class="row" style="margin-top:10px">
        <button class="btn primary" data-act="play" data-key="${esc(p.key)}">▶ ${esc(t('person.play'))}</button>
        <button class="btn" data-act="frame" data-key="${esc(p.key)}">${esc(t('person.frame'))}</button>
        ${d?.decision === 'same' && d.saved !== false ? '' : `<button class="btn green" data-act="lead-same" data-lead="${esc(lead.id)}" data-outside="${group.inScope ? '' : '1'}">${esc(t(group.inScope ? 'open.send' : 'open.sendOutside'))}</button>`}
        ${d?.decision ? '' : `<button class="btn" data-act="lead-not" data-lead="${esc(lead.id)}">${esc(t(group.inScope ? 'person.not' : 'open.dontSend'))}</button>`}
      </div>
      ${decided}
      ${togetherBlock(p)}
    </div>
  </article>`;
}

/** A check against open cases: its faces, grouped by case (spec F17). */
function renderGroups(job) {
  if (!job.groups?.length) {
    const finished = job.status === 'done';
    return `<p class="quiet">${esc(finished ? t('open.noneFound') : t('open.noneYet'))}</p>
      ${finished ? `<p><button class="btn" data-act="tab" data-tab="everyone">${esc(t('job.seeEveryone'))}</button></p>` : ''}`;
  }
  return job.groups.map((g) => (g.inScope
    ? `<section class="card group">
        <div class="row"><img class="thumb" src="${casePhoto(g.caseId)}" alt="">
          <div><strong>${esc(g.case?.name || t('job.case', { id: g.caseId }))}</strong><br>
          <span class="small quiet">${esc([t('job.case', { id: g.caseId }), g.case?.ageNow != null ? t('open.ageNow', { n: g.case.ageNow }) : '', g.case?.gender, g.case?.district].filter(Boolean).join(' · '))}</span></div></div>
        ${g.leads.map((l) => leadCard(g, l)).join('')}
      </section>`
    : `<section class="card group outside">
        <p><strong>${esc(t('open.outsideTitle'))}</strong></p>
        <p class="small">${esc(t('open.outside'))}</p>
        ${g.leads.map((l) => leadCard(g, l)).join('')}
      </section>`)).join('');
}

/** What the officer decided about a face, and whether Khozo has it yet. */
function decidedText(decision) {
  if (decision?.decision === 'same') {
    return decision.saved === false && !decision.error
      ? `<p class="quiet" role="status">${esc(t('person.sending'))}</p>`
      : decision.saved === false && decision.offline
        ? `<p class="quiet" role="status">${esc(t('person.waitingToSend'))}</p>`
        : decision.saved === false
          ? `<p class="error">${esc(t('person.addFailed', { error: decision.error }))}</p>`
        : `<p class="decided same">✓ ${esc(t(decision.via === 'note' ? 'person.added' : 'person.sighting'))}</p>`;
  }
  return decision?.decision === 'not' ? `<p class="decided not">${esc(t('person.markedNot'))}</p>` : '';
}

/** The engines flagged this face ("To look at first"). */
const flagged = (p) => ['likely', 'possible', 'not_agreed', 'laptop'].includes(p.verdict);

/** Why a face is not among those to look at first: what Khozo's engines did with it. */
function enginesText(p) {
  if (p.verdict === 'unlikely') return t((p.engines || []).includes('rekognition') ? 'engines.unlikelyBoth' : 'engines.unlikelyOne');
  if (p.verdict === 'no_face') return t('engines.noFace');
  if (p.verdict === 'no_answer') return t('engines.noAnswer');
  return t('engines.notSent');
}

/** The officer's two buttons for a face, or what they decided. */
function decisionBlock(p) {
  const decision = p.decision;
  const decided = decidedText(decision);
  return `<div class="row" style="margin-top:10px">
      ${decision?.decision === 'same' && decision.saved !== false ? '' : `<button class="btn green" data-act="same" data-key="${esc(p.key)}">${esc(t(flagged(p) ? 'person.same' : 'person.sendForReview'))}</button>`}
      ${decision?.decision ? '' : `<button class="btn" data-act="not" data-key="${esc(p.key)}">${esc(t('person.not'))}</button>`}
    </div>${decided}`;
}

function personCard(job, p) {
  const decision = p.decision;
  const decided = decidedText(decision);
  const when = p.clock ? `${p.clock} (${t('person.into', { t: videoTime(p.time) })})` : t('person.into', { t: videoTime(p.time) });
  return `<article class="hit ${esc(p.verdict)}">
    <div class="pair">
      <figure><img src="${casePhoto(job.caseId)}" alt=""><figcaption>${esc(t('person.caseFace'))}</figcaption></figure>
      <figure><img src="${esc(p.picture)}" alt="" loading="lazy"><figcaption>${esc(t('person.videoFace'))}</figcaption></figure>
    </div>
    <div style="flex:1">
      <div class="verdict">${esc(flagged(p) ? verdictWords(p.verdict) : t('verdict.notMatched'))}</div>
      ${flagged(p) ? '' : `<p class="small quiet">${esc(enginesText(p))}</p>`}
      <p>${esc(t('person.seen', { camera: p.camera, when }))}</p>
      ${p.closeness != null ? `<details class="small quiet"><summary>${esc(t('person.details'))}</summary>${esc(t('person.closeness', { score: p.closeness.toFixed(2) }))}</details>` : ''}
      <div class="row" style="margin-top:10px">
        ${p.live ? '' : `<button class="btn primary" data-act="play" data-key="${esc(p.key)}">▶ ${esc(t('person.play'))}</button>`}
        <button class="btn" data-act="frame" data-key="${esc(p.key)}">${esc(t('person.frame'))}</button>
        ${decision?.decision === 'same' && decision.saved !== false ? '' : `<button class="btn green" data-act="same" data-key="${esc(p.key)}">${esc(t(flagged(p) ? 'person.same' : 'person.sendForReview'))}</button>`}
        ${decision?.decision ? '' : `<button class="btn" data-act="not" data-key="${esc(p.key)}">${esc(t('person.not'))}</button>`}
      </div>
      ${decided}
      ${togetherBlock(p)}
    </div>
  </article>`;
}

function renderFirst(job) {
  if (job.mode === 'open_cases') return renderGroups(job);
  const finished = job.status === 'done';
  // The closest faces the engines did not match, for the officer's own eyes, once the check is done.
  const closest = finished && job.closest?.length
    ? `<h3>${esc(t('job.closestTitle'))}</h3><p class="small quiet">${esc(t('job.closestNote'))}</p>${job.closest.map((p) => personCard(job, p)).join('')}`
    : '';
  if (job.toCheck.length) return job.toCheck.map((p) => personCard(job, p)).join('') + closest;
  // Scenario 8: no close face, perhaps an old photo or a poor camera. Everyone seen is the way through.
  return `<p class="quiet">${esc(finished ? t('job.noneFound') : t('job.noneYet'))}</p>
    ${closest}
    ${finished ? `<p><button class="btn" data-act="tab" data-tab="everyone">${esc(t('job.seeEveryone'))}</button></p>` : ''}`;
}

function renderEveryone(job) {
  if (job.live) return `<p class="info">${esc(t('live.everyone'))}</p>${renderEveryoneFaces(job)}`;
  return renderEveryoneFaces(job);
}

function renderEveryoneFaces(job) {
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
      ${['likely', 'possible', 'not_agreed', 'laptop'].includes(p.verdict) ? `<span class="chip ${esc(p.verdict)}">${esc(t(`chip.${p.verdict}`))}</span>` : ''}
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
  first.textContent = t('job.tabFirst', { n: job.mode === 'open_cases' ? (job.groups || []).reduce((n, g) => n + g.leads.length, 0) : job.toCheck.length });
  everyone.textContent = t('job.tabEveryone', { n: job.everyone.length });
  first.classList.toggle('on', S.tab === 'first');
  everyone.classList.toggle('on', S.tab === 'everyone');
  const sig = JSON.stringify([S.tab, S.camera, S.shown, job.status, job.toCheck.map((p) => [p.key, p.verdict, p.decision?.decision, p.decision?.saved, p.decision?.error, p.decision?.via, p.together?.length]),
    (job.groups || []).map((g) => g.leads.map((l) => [l.id, l.decision?.decision, l.decision?.saved, l.decision?.error, l.decision?.offline, l.person.together?.length])), job.everyone.length, S.state?.language]);
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

/** The case photo to show beside a face: the job's case, or in a check against open cases the case the face is close to, if the officer can open it. */
function casePhotoFor(p) {
  if (S.job?.mode !== 'open_cases') return casePhoto(S.job.caseId);
  const lead = (p.leads || []).find((l) => l.inScope && l.case?.id);
  return lead ? casePhoto(lead.case.id) : null;
}

async function openPerson(key) {
  const p = personByKey(key);
  if (!p) return;
  const photo = casePhotoFor(p);
  modal.innerHTML = `<div class="modal" data-act="close-modal"><div class="box" role="dialog" aria-modal="true">
    <div class="head"><strong class="grow">${esc(t('person.seen', { camera: p.camera, when: p.clock || t('person.into', { t: videoTime(p.time) }) }))}</strong>
      <button class="btn" data-act="close-modal">${esc(t('player.close'))}</button></div>
    <p class="quiet" id="clip-note">${esc(t('player.making'))}</p>
    <div class="row" style="align-items:flex-start">
      <div id="clip-box"></div>
      <div class="pair" style="flex-direction:column">
        ${photo ? `<figure><img src="${photo}" alt=""><figcaption>${esc(t('person.caseFace'))}</figcaption></figure>` : ''}
        <figure><img src="${esc(p.picture)}" alt=""><figcaption>${esc(t('person.videoFace'))}</figcaption></figure>
      </div>
    </div>
    ${S.job.mode === 'open_cases' ? '' : `<div id="clip-decide" data-key="${esc(key)}">${flagged(p) ? '' : `<p class="small quiet">${esc(t('player.notMatched'))} ${esc(enginesText(p))}</p>`}${decisionBlock(p)}</div>`}
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

/** The clip window's buttons, after the officer decided there. */
function refreshClipDecision() {
  const box = document.getElementById('clip-decide');
  const p = box && personByKey(box.dataset.key);
  if (p) box.innerHTML = decisionBlock(p);
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
  if (S.state.user && S.screen === 'home' && S.state.canCheck) askOpenCases();
}

/**
 * Whether this Khozo checks footage against open cases: the home screen
 * offers it only then. Asked after the screen is drawn, so a slow connection
 * never holds it up; the button appears when Khozo answers.
 */
async function askOpenCases() {
  const result = await k.openCaseCount({}).catch(() => null);
  const enabled = Boolean(result && !result.error && result.enabled);
  const changed = enabled !== Boolean(S.openCases?.enabled);
  S.openCases = result && !result.error ? result : null;
  if (changed && S.screen === 'home') render();
}

const actions = {
  async signout() {
    // Signing out deletes every check on this laptop: send what is waiting first, and say if some still cannot go.
    const { unsent = 0 } = (await k.syncNow().catch(() => null)) || {};
    if (!window.confirm(unsent ? t('signout.unsent', { n: unsent }) : t('signout.confirm'))) return;
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
    if (S.state?.canCheck) askOpenCases();
  },
  new() { newCheck(); },
  'new-live'() { newLiveCheck(); },
  async 'alert-open'(el) {
    document.getElementById('alert-banner')?.remove();
    S.tab = 'first';
    await showJob(el.dataset.id);
  },
  'alert-later'() { document.getElementById('alert-banner')?.remove(); },
  'new-open'() { newOpenCheck(); },
  'camera-all'(el) {
    const from = S.nc.files[Number(el.dataset.i)];
    if (!from) return;
    for (const f of S.nc.files) {
      if (f === from || f.error) continue;
      Object.assign(f, { camera: from.camera, where: from.where, lat: from.lat ?? null, lng: from.lng ?? null });
    }
    renderFiles();
  },
  async 'lead-same'(el) {
    if (!window.confirm(t(el.dataset.outside ? 'open.sendOutsideConfirm' : 'open.sendConfirm'))) return;
    el.disabled = true;
    await k.decideLead({ id: S.job.id, leadId: el.dataset.lead, decision: 'same' });
    S.job = await k.getJob(S.job.id);
    renderJob(false);
  },
  async 'lead-not'(el) {
    el.disabled = true;
    await k.decideLead({ id: S.job.id, leadId: el.dataset.lead, decision: 'not' });
    S.job = await k.getJob(S.job.id);
    renderJob(false);
  },
  async open(el) { await showJob(el.dataset.id); },
  async pause(el) { await k.pauseJob(el.dataset.id); },
  async resume(el) { await k.startJob(el.dataset.id); },
  async 'update-download'() {
    const result = await k.downloadUpdate();
    if (result?.error) window.alert(result.error);
    S.state = await k.state();
    if (S.screen === 'home') render();
  },
  async 'update-install'() {
    if (!window.confirm(t('update.confirm'))) return;
    const result = await k.installUpdate();
    if (result?.error) window.alert(result.error);
  },
  async remove(el) {
    const { unsent = 0 } = (await k.syncNow(el.dataset.id).catch(() => null)) || {};
    if (!window.confirm(unsent ? t('home.deleteUnsent', { n: unsent }) : t('home.deleteConfirm'))) return;
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
    const p = personByKey(el.dataset.key);
    if (!window.confirm(t(p && !flagged(p) ? 'person.sendConfirm' : 'person.sameConfirm'))) return;
    el.disabled = true;
    await k.decide({ id: S.job.id, key: el.dataset.key, decision: 'same' });
    S.job = await k.getJob(S.job.id);
    renderJob(false);
    refreshClipDecision();
  },
  async not(el) {
    el.disabled = true;
    await k.decide({ id: S.job.id, key: el.dataset.key, decision: 'not' });
    S.job = await k.getJob(S.job.id);
    renderJob(false);
    refreshClipDecision();
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
  } else if (el.dataset.input === 'f-sex') {
    S.nc.filters.sex = el.value;
    S.nc.count = null;
    renderCount();
    countCases();
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
  } else if (el.dataset.input === 'where') {
    const f = S.nc.files[Number(el.dataset.i)];
    const point = pointFrom(el.value);
    Object.assign(f, { where: el.value, lat: point?.lat ?? null, lng: point?.lng ?? null });
    const note = document.getElementById(`where-note-${el.dataset.i}`);
    if (note) note.textContent = whereNote(f);
  } else if (el.dataset.input === 'live-camera') {
    S.nc.camera = el.value;
  } else if (el.dataset.input === 'live-address') {
    S.nc.address = el.value.trim();
  } else if (el.dataset.input === 'live-until') {
    S.nc.until = el.value;
  } else if (el.dataset.input === 'live-where') {
    const point = pointFrom(el.value);
    Object.assign(S.nc, { where: el.value, lat: point?.lat ?? null, lng: point?.lng ?? null });
    const note = document.getElementById('live-where-note');
    if (note) note.textContent = whereNote(S.nc);
  } else if (el.dataset.input === 'from' || el.dataset.input === 'to') {
    S.nc[el.dataset.input] = el.value;
  } else if (['f-ageFrom', 'f-ageTo', 'f-district', 'f-missingFrom', 'f-missingTo'].includes(el.dataset.input)) {
    S.nc.filters[el.dataset.input.slice(2)] = el.value.trim();
    clearTimeout(countTimer);
    countTimer = setTimeout(countCases, 400);
  }
});

// A newer version is out, or its download moved on: the home screen shows it.
k.onUpdateChanged(async () => {
  S.state = await k.state();
  if (S.screen === 'home') render();
});

// Khozo ended the sign-in while the app was working: sign in again; the checks are kept.
k.onSessionEnded(async () => {
  S.signinNote = t('signin.expired');
  S.screen = 'signin';
  await reload();
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

// A live watch saw a face close to the case: said on every screen until the officer looks or puts it off.
k.onAlert(async ({ jobId, key }) => {
  const job = await k.getJob(jobId);
  if (job?.error || !job) return;
  const p = job.everyone.find((x) => x.key === key) || job.toCheck[0];
  document.getElementById('alert-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'alert-banner';
  banner.className = 'alert-banner';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `<strong>${esc(t('live.alert', { camera: p?.camera || '', when: p?.clock || '' }))}</strong>
    <span class="row"><button class="btn primary" data-act="alert-open" data-id="${esc(jobId)}">${esc(t('live.open'))}</button>
    <button class="btn" data-act="alert-later">${esc(t('live.later'))}</button></span>`;
  document.body.prepend(banner);
  if (S.screen === 'job' && S.jobId === jobId) { S.job = job; renderJob(false); }
});

// A case photo comes from Khozo: with no internet it cannot be shown, and the screen says so instead of a broken picture.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img?.tagName !== 'IMG' || !String(img.getAttribute('src') || '').startsWith('khozo://case-photo/') || !img.closest('.pair')) return;
  const note = document.createElement('div');
  note.className = 'nophoto';
  note.textContent = t('person.noCasePhoto');
  img.replaceWith(note);
}, true);

// For the scripted check of a build (app/smoke.js).
window.__khozo = {
  reload,
  newCheck,
  newLiveCheck,
  newOpenCheck,
  showJob,
  tab: (name) => { S.tab = name; renderJob(false); },
  openPerson,
  closePerson: closeModal,
  openFrame,
};

reload();
