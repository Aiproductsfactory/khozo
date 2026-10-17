/**
 * Phone-width check of the web app: serves a built copy of web/, opens every
 * public page and the main console screens in headless Chrome at a true phone
 * viewport (DevTools device emulation; --window-size is clamped to >= 500 px in
 * headless Chrome), and for each screen records
 *
 *   - horizontal page overflow (the page must never scroll sideways),
 *   - text smaller than 14 px (16 px for Gujarati / Devanagari body text),
 *   - tap targets smaller than 44 px,
 *
 * and saves a screenshot. Nothing here talks to khozo.org: it needs a local
 * API with seeded data (server/src/index.js with KHOZO_DATA_DIR pointing at a
 * temporary directory and DATABASE_URL unset).
 *
 *   cd web && npx vite build --outDir ../.tmp/build-mobile --emptyOutDir
 *   PORT=4610 KHOZO_DATA_DIR=.tmp/mobile-data DATABASE_URL= node server/src/index.js
 *   node scripts/web-mobile-smoke.mjs --dist .tmp/build-mobile --api http://localhost:4610
 *
 * Options: --out <dir> (default .tmp/mobile-shots), --langs en,gu,
 * --width 360 --height 740, --only <substring of a shot name>, --strict
 * (exit 1 when a screen overflows sideways), --password <local password>.
 */
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const DIST = resolve(arg('dist', '.tmp/build-mobile'));
const API = String(arg('api', 'http://localhost:4610')).replace(/\/+$/, '');
const OUT = resolve(arg('out', '.tmp/mobile-shots'));
const PORT = Number(arg('port', 4611));
const WIDTH = Number(arg('width', 360));
const HEIGHT = Number(arg('height', 740));
const LANGS = String(arg('langs', 'en,gu')).split(',').filter(Boolean);
const ONLY = arg('only', '');
const STRICT = arg('strict', false) === true;
const PASSWORD = String(arg('password', 'khozo123'));
const MAX_SHOT_HEIGHT = Number(arg('max-height', 2600));
// --desktop: a mouse-and-keyboard screen (no touch, no mobile viewport), for
// checking that the desktop layout did not change.
const DESKTOP = arg('desktop', false) === true;
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`No build at ${DIST}. Run: cd web && npx vite build --outDir ../.tmp/build-mobile --emptyOutDir`);
  process.exit(2);
}
if (!CHROME) {
  console.error('Chrome was not found. Set CHROME_PATH.');
  process.exit(2);
}

// ------------------------------------------------------------ what to open

// `setup` runs in the page after it loads (an async function body); `wait`
// is extra settling time in ms after it.
const click = (selector) => `const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return !!el;`;
// eslint-disable-next-line no-unused-vars
const clickText = (text, tag = 'button') => `
  const want = ${JSON.stringify(text)};
  const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find((n) => n.textContent.trim().includes(want) && n.offsetParent !== null);
  if (el) el.click();
  return !!el;`;

const SHOTS = [
  { name: 'landing', path: '/' },
  { name: 'report', path: '/report' },
  { name: 'report-form', path: '/report', setup: click('[data-action="continue-without-photo"]') },
  { name: 'track-sighting', path: '/track-sighting' },
  { name: 'track-case', path: '/track-case' },
  { name: 'services', path: '/services' },
  { name: 'bulletins', path: '/bulletins' },
  { name: 'child-case', path: '/child/r_5' },
  { name: 'grievance', path: '/grievance' },
  { name: 'login', path: '/login' },
  { name: 'register', path: '/register' },
  { name: 'change-password', path: '/change-password', user: 'police@khozo.org' },
  { name: 'app-overview', path: '/app', user: 'police@khozo.org' },
  { name: 'app-menu', path: '/app', user: 'police@khozo.org', setup: click('[data-mobile-menu-button]'), viewport: true },
  { name: 'app-bell', path: '/app', user: 'police@khozo.org', setup: click('[data-notification-bell]'), viewport: true },
  { name: 'app-cases', path: '/app/cases', user: 'police@khozo.org' },
  { name: 'app-case-drawer', path: '/app/cases?id=r_7', user: 'police@khozo.org', wait: 800, viewport: true },
  { name: 'app-case-drawer-full', path: '/app/cases?id=r_7', user: 'police@khozo.org', wait: 800, scrollIn: '[data-case-sheet]' },
  { name: 'app-register', path: '/app/register', user: 'police@khozo.org' },
  { name: 'app-bulk-import', path: '/app/bulk-import', user: 'police@khozo.org' },
  { name: 'app-matches', path: '/app/matches', user: 'superadmin@khozo.org' },
  { name: 'app-sightings', path: '/app/sightings', user: 'superadmin@khozo.org' },
  { name: 'app-sighting-open', path: '/app/sightings?id=f_2', user: 'superadmin@khozo.org', wait: 800 },
  { name: 'app-confirm-dialog', path: '/app/matches?id=f_2', user: 'superadmin@khozo.org', wait: 800, setup: click('[data-action="confirm-match"]'), viewport: true },
  { name: 'app-cci', path: '/app/cci-register', user: 'superadmin@khozo.org' },
  { name: 'app-grievances', path: '/app/grievances', user: 'superadmin@khozo.org' },
  { name: 'app-mis', path: '/app/mis', user: 'superadmin@khozo.org' },
  { name: 'app-audit', path: '/app/audit', user: 'superadmin@khozo.org' },
  { name: 'app-privacy', path: '/app/privacy', user: 'superadmin@khozo.org' },
  { name: 'app-fraud', path: '/app/fraud', user: 'superadmin@khozo.org' },
  { name: 'app-network', path: '/app/network', user: 'superadmin@khozo.org' },
  { name: 'app-simulations', path: '/app/simulations', user: 'superadmin@khozo.org' },
  { name: 'parent-overview', path: '/app', user: 'parent@khozo.org' },
  { name: 'parent-cases', path: '/app/cases', user: 'parent@khozo.org' },
];

// ------------------------------------------------------------ static server

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.woff2', 'font/woff2'],
]);

async function proxy(req, res) {
  const chunks = [];
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  const upstream = await fetch(`${API}${req.url}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const out = Object.fromEntries(upstream.headers);
  delete out['content-encoding'];
  delete out['content-length'];
  res.writeHead(upstream.status, out);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url || '/';
    if (url.startsWith('/api/')) return await proxy(req, res);
    const rawPath = decodeURIComponent(url.split('?')[0]);
    let file = join(DIST, rawPath);
    if (!file.startsWith(DIST + sep) && file !== DIST) throw new Error('Bad path');
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(DIST, 'index.html');
    } catch {
      if (extname(rawPath)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Not found');
      }
      file = join(DIST, 'index.html');
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES.get(extname(file)) || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err.stack || err));
  }
});

// ------------------------------------------------------------ CDP client

function launchChrome(userDataDir) {
  return new Promise((resolveLaunch, reject) => {
    const child = spawn(CHROME, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-extensions',
      '--lang=en-IN',
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start: ${buf}`)), 20000);
    child.stderr.on('data', (d) => {
      buf += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolveLaunch({ child, wsUrl: m[1] });
      }
    });
    child.on('exit', (code) => reject(new Error(`Chrome exited ${code}: ${buf}`)));
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: ok, reject: fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) fail(new Error(`${msg.error.message}`));
        else ok(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  await s('Page.enable');
  await s('Network.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: DESKTOP ? 1 : 2, mobile: !DESKTOP });
  if (!DESKTOP) {
    await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await s('Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    });
  }
  // Google Fonts are not needed for layout checks and must not slow the run.
  await s('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });

  let inflight = 0;
  let lastActivity = Date.now();
  const requests = [];
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Network.requestWillBeSent') {
      inflight += 1;
      lastActivity = Date.now();
      requests.push(msg.params.request.url);
    }
    if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
      inflight = Math.max(0, inflight - 1);
      lastActivity = Date.now();
    }
  });
  const idle = async (quiet = 500, max = 10000) => {
    const start = Date.now();
    while (Date.now() - start < max) {
      if (inflight === 0 && Date.now() - lastActivity > quiet) return;
      await sleep(100);
    }
  };
  const evaluate = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const navigate = async (url) => {
    inflight = 0;
    await s('Page.navigate', { url });
    await sleep(300);
    await idle();
  };
  return { s, evaluate, navigate, idle, requests, sessionId, targetId };
}

// ------------------------------------------------------------ page checks

const MEASURE = `(() => {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - vw;
  const describe = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return el.tagName.toLowerCase() + id + cls + (text ? ' "' + text + '"' : '');
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  // Clipped by an ancestor that scrolls or hides overflow on purpose.
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return p;
    }
    return null;
  };
  const wide = [];
  const sideScrollers = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2 && r.width > 0) {
      sideScrollers.push(describe(el) + ' (' + el.scrollWidth + '>' + el.clientWidth + ')');
    }
    if (r.right > vw + 1 || r.left < -1) {
      if (clipped(el)) continue;
      const kidWide = [...el.children].some((c) => { const cr = c.getBoundingClientRect(); return cr.right > vw + 1; });
      if (!kidWide) wide.push(describe(el) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
    }
  }
  const lang = document.documentElement.lang || 'en';
  const indic = lang === 'gu' || lang === 'hi' || lang === 'mr';
  const smallText = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const size = parseFloat(getComputedStyle(el).fontSize);
    const isIndic = /[\\u0900-\\u097F\\u0A80-\\u0AFF]/.test(text);
    // Body text (a sentence in a paragraph, list item or cell) in Gujarati or
    // Devanagari is read at 16 px; labels, badges and buttons at 14.
    const body = ['P', 'LI', 'DD', 'TD', 'BLOCKQUOTE'].includes(el.tagName) && text.length > 20;
    const min = indic && isIndic && body ? 16 : 14;
    if (size < min - 0.01) smallText.push(Math.round(size * 10) / 10 + 'px ' + describe(el));
  }
  const targets = [];
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], summary')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    let w = r.width, h = r.height;
    // A checkbox or radio inside its label is tapped through the label.
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) {
      const lr = el.closest('label').getBoundingClientRect();
      w = lr.width; h = lr.height;
    }
    // Inline links inside running text are exempt (WCAG 2.5.8 inline exception).
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
    if (w < 43.5 || h < 43.5) targets.push(Math.round(w) + 'x' + Math.round(h) + ' ' + describe(el));
  }
  return {
    overflow,
    pageHeight: Math.max(doc.scrollHeight, document.body.scrollHeight),
    wide: wide.slice(0, 12),
    sideScrollers: sideScrollers.slice(0, 12),
    smallTextCount: smallText.length,
    smallText: smallText.slice(0, 25),
    smallTargetCount: targets.length,
    smallTargets: targets.slice(0, 25),
  };
})()`;

// ------------------------------------------------------------ run

// Tokens are reused across runs (the API rate-limits sign-ins), in a file
// beside the screenshots, and checked before use.
const TOKEN_FILE = resolve('.tmp', 'mobile-smoke-tokens.json');
async function cachedTokens() {
  try {
    return JSON.parse(await readFile(TOKEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function login(email) {
  const cache = await cachedTokens();
  const key = `${API} ${email}`;
  if (cache[key]) {
    const me = await fetch(`${API}/api/auth/me`, { headers: { authorization: `Bearer ${cache[key]}` } }).catch(() => null);
    if (me?.ok) return cache[key];
  }
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`);
  const token = (await res.json()).token;
  cache[key] = token;
  await writeFile(TOKEN_FILE, JSON.stringify(cache, null, 2)).catch(() => {});
  return token;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await new Promise((r) => server.listen(PORT, r));
  const origin = `http://localhost:${PORT}`;
  const userDataDir = resolve('.tmp', `chrome-mobile-${process.pid}`);
  const { child, wsUrl } = await launchChrome(userDataDir);
  const cdp = new Cdp(wsUrl);
  await cdp.ready;
  const tokens = {};
  const report = [];
  let overflowing = 0;
  try {
    const page = await openPage(cdp);
    for (const lang of LANGS) {
      for (const shot of SHOTS) {
        const name = `${shot.name}-${lang}`;
        if (ONLY && !name.includes(ONLY)) continue;
        if (shot.user && !tokens[shot.user]) tokens[shot.user] = await login(shot.user);
        // Seed the session on the origin, then open the page itself.
        await page.navigate(`${origin}/manifest.webmanifest`);
        await page.evaluate(`(() => {
          localStorage.clear();
          localStorage.setItem('khozo.lang', ${JSON.stringify(lang)});
          localStorage.setItem('khozo.installHint.dismissed', '1');
          ${shot.user ? `localStorage.setItem('khozo_token', ${JSON.stringify(tokens[shot.user])});` : ''}
          return true;
        })()`);
        page.requests.length = 0;
        await page.navigate(`${origin}${shot.path}`);
        await sleep(400);
        if (shot.setup) {
          const ok = await page.evaluate(`(async () => { ${shot.setup} })()`).catch((e) => `setup error: ${e.message}`);
          if (ok !== true) console.warn(`  ${name}: setup returned ${ok}`);
          await sleep(300);
          await page.idle(400, 5000);
        }
        if (shot.wait) await sleep(shot.wait);
        const m = await page.evaluate(MEASURE);
        let shotRes;
        if (shot.viewport) {
          // An overlay (menu, dialog, sheet) is judged as the phone shows it.
          shotRes = await page.s('Page.captureScreenshot', { format: 'png' });
        } else if (shot.scrollIn) {
          // A scrolling sheet: stretch the viewport to the sheet's content so
          // the whole of it is captured, then put the phone size back.
          const inner = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(shot.scrollIn)}); return el ? el.scrollHeight : 0; })()`);
          const h = Math.min(Math.max(inner, HEIGHT), MAX_SHOT_HEIGHT);
          await page.s('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: h, deviceScaleFactor: DESKTOP ? 1 : 2, mobile: !DESKTOP });
          await sleep(400);
          shotRes = await page.s('Page.captureScreenshot', { format: 'png' });
          await page.s('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: DESKTOP ? 1 : 2, mobile: !DESKTOP });
        } else {
          const height = Math.min(m.pageHeight, MAX_SHOT_HEIGHT);
          shotRes = await page.s('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 },
          });
        }
        const file = join(OUT, `${name}.png`);
        await writeFile(file, Buffer.from(shotRes.data, 'base64'));
        if (m.overflow > 1) overflowing += 1;
        report.push({ name, path: shot.path, file, ...m });
        const flag = m.overflow > 1 ? `OVERFLOW ${m.overflow}px` : 'ok';
        console.log(`${name.padEnd(28)} ${flag.padEnd(16)} small-text ${String(m.smallTextCount).padStart(3)}  small-targets ${String(m.smallTargetCount).padStart(3)}  h=${m.pageHeight}`);
      }
    }
    await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`\n${report.length} screens, ${overflowing} with horizontal overflow. Details: ${join(OUT, 'report.json')}`);
  } finally {
    try { await cdp.send('Browser.close'); } catch {}
    child.kill();
    server.close();
    await sleep(500);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  if (STRICT && overflowing) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
