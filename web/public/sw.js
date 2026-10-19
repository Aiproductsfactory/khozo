/*
 * Khozo service worker.
 *
 * Two jobs:
 *
 * 1. The offline sighting queue. A sighting made without a signal is stored
 *    encrypted in IndexedDB (web/src/offlineQueue.js) and sent from here when
 *    the phone reconnects (Background Sync), or when the page asks.
 *
 * 2. The app shell. Every build rewrites the BUILD line below
 *    (web/vite.config.js, khozoServiceWorker) with its version and the files a
 *    citizen needs offline: the page itself, the app's core script and styles,
 *    and the report, track and home pages. With those cached, /report and
 *    /track-sighting open with no signal at all.
 *
 *    - Page loads are network-first, so a new deploy shows on the next open
 *      while online; the cached shell answers only when the network fails or
 *      is too slow to wait for.
 *    - Hashed scripts and styles (/assets/*.js, *.css) never change under one
 *      name, so they are served from the cache and fetched once on a miss.
 *    - /api/* is never cached or touched: it is personal data and live state.
 *    - Each build has its own caches; activating a build deletes the caches
 *      of every older one. Google Fonts are kept across builds.
 *
 * In `vite dev` the line below stays as written: version 'dev' caches nothing
 * and every request goes straight to the network.
 */
const BUILD = { version: 'dev', precache: [] };

const DB_NAME = 'khozo_field_queue';
const DB_VERSION = 1;
const STORE = 'encrypted_sightings';
const KEY_STORE = 'crypto_keys';
const KEY_ID = 'sighting_queue_key';
const SYNC_TAG = 'khozo-sync-sightings';
const QUEUE_TTL_MS = 72 * 60 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(db, name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function queueKey() {
  const db = await openDb();
  const row = await reqPromise(store(db, KEY_STORE).get(KEY_ID));
  return row?.key || null;
}

async function decrypt(record) {
  const key = await queueKey();
  if (!key) return null;
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.payload)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// The same body web/src/offlineQueue.js queuedToFormData builds: the first
// photo as `photo`, any others as `extraPhotos`.
async function itemToFormData(item) {
  const fd = new FormData();
  if (item.file?.dataUrl) {
    const blob = await fetch(item.file.dataUrl).then((res) => res.blob());
    fd.append('photo', blob, item.file.name || 'queued-sighting.jpg');
    const extraFiles = Array.isArray(item.extraFiles) ? item.extraFiles : [];
    for (let i = 0; i < extraFiles.length; i += 1) {
      if (!extraFiles[i]?.dataUrl) continue;
      // eslint-disable-next-line no-await-in-loop
      const extraBlob = await fetch(extraFiles[i].dataUrl).then((res) => res.blob());
      fd.append('extraPhotos', extraBlob, extraFiles[i].name || `queued-sighting-${i + 2}.jpg`);
    }
  }
  Object.entries(item.form || {}).forEach(([key, value]) => {
    if (value != null && value !== '') fd.append(key, value);
  });
  return fd;
}

async function deleteRecord(id) {
  const db = await openDb();
  await reqPromise(store(db, STORE, 'readwrite').delete(id));
}

function expiresAt(record) {
  return Number(record.createdAt || 0) + QUEUE_TTL_MS;
}

async function markAttempt(record, error = '') {
  const db = await openDb();
  await reqPromise(store(db, STORE, 'readwrite').put({
    ...record,
    expiresAt: expiresAt(record),
    lastAttemptAt: Date.now(),
    lastError: String(error || '').slice(0, 160) || null,
  }));
}

// Tells any open Khozo page that a queued report went through, with its
// receipt number, so the page can keep the receipt on the device (myReports.js)
// just as it does for a report sent directly. Only the receipt travels.
async function announceSynced(res, record, item) {
  try {
    const data = await res.json();
    const id = data?.foundReport?.id;
    if (!id) return;
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const page of pages) {
      page.postMessage({
        type: 'KHOZO_SIGHTING_SYNCED',
        receipt: { id, at: Number(record.createdAt) || Date.now(), personCategory: data.foundReport.personCategory || item?.form?.personCategory || 'child' },
      });
    }
  } catch {}
}

async function syncSightings() {
  const db = await openDb();
  const records = await reqPromise(store(db, STORE).getAll());
  for (const record of records.sort((a, b) => a.createdAt - b.createdAt)) {
    try {
      if (expiresAt(record) <= Date.now()) {
        await deleteRecord(record.id);
        continue;
      }
      await markAttempt(record);
      const item = await decrypt(record);
      if (!item) continue;
      const body = await itemToFormData(item);
      const res = await fetch('/api/reports/found', { method: 'POST', body });
      if (res.ok) {
        await deleteRecord(record.id);
        await announceSynced(res, record, item);
      }
      else await markAttempt(record, `HTTP ${res.status}`);
    } catch {
      await markAttempt(record, 'Sync failed');
      return;
    }
  }
}

// ------------------------------------------------------------- app shell

const DEV = BUILD.version === 'dev';
const SHELL = `khozo-shell-${BUILD.version}`;
const RUNTIME = `khozo-runtime-${BUILD.version}`;
const FONTS = 'khozo-fonts';
const FONT_LIMIT = 60;
const RUNTIME_LIMIT = 200;
// How long a page load waits for the network before answering from the cached
// shell. Long enough for a slow 3G round trip; short enough that a phone with
// one bar does not sit on a blank screen.
const NAVIGATION_TIMEOUT_MS = 6000;

const ORIGIN = self.location.origin;
const FONT_CSS_HOST = 'fonts.googleapis.com';
const FONT_FILE_HOST = 'fonts.gstatic.com';

const isApi = (url) => url.origin === ORIGIN && (url.pathname === '/api' || url.pathname.startsWith('/api/'));
const isHashedAsset = (url) => url.origin === ORIGIN && url.pathname.startsWith('/assets/') && /\.(?:js|css)$/.test(url.pathname);

// A response that followed a redirect cannot answer a page load; rebuild it
// without the redirect flag before it goes into the cache.
async function clean(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// A cacheable copy: same-origin or CORS, 200, and for a script or stylesheet
// not an HTML page (a host answering a missing file with the app's index.html
// must never be stored as a script).
function cacheable(response, url) {
  if (!response || response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'cors' && response.type !== 'default') return false;
  if (isHashedAsset(url) && /text\/html/i.test(response.headers.get('content-type') || '')) return false;
  return true;
}

async function trim(cacheName, limit) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
  } catch {}
}

async function put(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {}
}

// This build's own caches only; an older build's files are never served.
async function fromCache(request) {
  for (const name of [RUNTIME, SHELL]) {
    try {
      const cache = await caches.open(name);
      const hit = await cache.match(request);
      if (hit) return hit;
    } catch {}
  }
  return undefined;
}

async function shellResponse() {
  try {
    const cache = await caches.open(SHELL);
    return (await cache.match('/')) || undefined;
  } catch {
    return undefined;
  }
}

// Fetches every shell file this cache does not hold yet. One failed file never
// fails the install: a worker without a complete shell still sends queued
// sightings, and the gaps are filled on the next page load (cacheUrls).
async function precache() {
  const cache = await caches.open(SHELL);
  await Promise.all(BUILD.precache.map(async (path) => {
    try {
      if (await cache.match(path)) return;
      // Bypass the HTTP cache so the shell is exactly this build's files.
      const res = await fetch(new Request(path, { cache: 'reload', credentials: 'same-origin' }));
      if (cacheable(res, new URL(path, ORIGIN))) await cache.put(path, await clean(res));
    } catch {}
  }));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (DEV || !BUILD.precache.length) return;
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names
        .filter((name) => (name.startsWith('khozo-shell-') || name.startsWith('khozo-runtime-')) && name !== SHELL && name !== RUNTIME)
        .map((name) => caches.delete(name)));
    } catch {}
    try {
      // Lets the page request start while the worker boots: network-first
      // page loads cost no extra time.
      if (self.registration.navigationPreload) {
        if (DEV) await self.registration.navigationPreload.disable();
        else await self.registration.navigationPreload.enable();
      }
    } catch {}
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

// Page loads: network first, so a deploy is picked up on the next open; the
// cached shell when the network fails, errors, or is too slow. The app is a
// single-page app, so the shell renders /report, /track-sighting and the rest.
async function navigation(event) {
  const network = (async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
    } catch {}
    return fetch(event.request);
  })();
  // Keep the worker alive for the network answer even after the shell has
  // answered, so the preload is not cancelled mid-flight.
  event.waitUntil(network.then(() => {}, () => {}));
  try {
    const res = await Promise.race([network, timeout(NAVIGATION_TIMEOUT_MS)]);
    if (res.status >= 500) {
      const shell = await shellResponse();
      if (shell) return shell;
    }
    return res;
  } catch {
    const shell = await shellResponse();
    if (shell) return shell;
    return network;
  }
}

// Hashed scripts and styles: the cache, then the network once.
async function cacheFirst(request, url) {
  const hit = await fromCache(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res, url)) await put(RUNTIME, request, res.clone());
  return res;
}

// Everything else on this origin (manifest, icons, photos in /assets): the
// network, and the last good copy when there is none.
async function networkFirst(request, url) {
  try {
    const res = await fetch(request);
    if (cacheable(res, url)) {
      await put(RUNTIME, request, res.clone());
      trim(RUNTIME, RUNTIME_LIMIT);
    }
    return res;
  } catch (err) {
    const hit = await fromCache(request);
    if (hit) return hit;
    throw err;
  }
}

// Google Fonts. Font files never change under one URL: cache first. The
// stylesheet answers from the cache and is refreshed in the background. The
// stylesheet is fetched in CORS mode so the copy is readable and storable
// (the page's own request for it is no-cors, which would be opaque).
async function fonts(event, request, url) {
  const cache = await caches.open(FONTS);
  const key = url.href;
  const hit = await cache.match(key);
  if (url.hostname === FONT_FILE_HOST) {
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok && (res.type === 'cors' || res.type === 'basic')) {
      await cache.put(key, res.clone());
      trim(FONTS, FONT_LIMIT);
    }
    return res;
  }
  const refresh = fetch(new Request(key, { mode: 'cors', credentials: 'omit' }))
    .then(async (res) => {
      if (res.ok) {
        await cache.put(key, res.clone());
        trim(FONTS, FONT_LIMIT);
      }
      return res;
    });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh.catch(() => fetch(request));
}

self.addEventListener('fetch', (event) => {
  if (DEV) return;
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isApi(url)) return;
  if (request.headers.has('range')) return;

  if (url.hostname === FONT_CSS_HOST || url.hostname === FONT_FILE_HOST) {
    event.respondWith(fonts(event, request, url).catch(() => fetch(request)));
    return;
  }
  if (url.origin !== ORIGIN) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigation(event));
    return;
  }
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, url));
    return;
  }
  event.respondWith(networkFirst(request, url));
});

// The page lists what it loaded before this worker controlled it (its route
// chunks, its language's dictionary, the fonts it used), so those open
// offline too.
async function cacheUrls(urls) {
  await precache();
  const list = Array.isArray(urls) ? urls.slice(0, 120) : [];
  for (const raw of list) {
    let url;
    try {
      url = new URL(String(raw), ORIGIN);
    } catch {
      continue;
    }
    try {
      if (url.hostname === FONT_CSS_HOST || url.hostname === FONT_FILE_HOST) {
        const cache = await caches.open(FONTS);
        if (await cache.match(url.href)) continue;
        const res = await fetch(new Request(url.href, { mode: 'cors', credentials: 'omit' }));
        if (res.ok) await cache.put(url.href, res);
        continue;
      }
      if (url.origin !== ORIGIN || isApi(url) || !url.pathname.startsWith('/assets/')) continue;
      if (await fromCache(url.href)) continue;
      const res = await fetch(url.href, { credentials: 'same-origin' });
      if (cacheable(res, url)) await put(RUNTIME, url.href, res);
    } catch {}
  }
  trim(FONTS, FONT_LIMIT);
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(syncSightings());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'KHOZO_SYNC_SIGHTINGS') event.waitUntil(syncSightings().catch(() => {}));
  if (event.data?.type === 'KHOZO_CACHE_URLS' && !DEV) event.waitUntil(cacheUrls(event.data.urls));
});
