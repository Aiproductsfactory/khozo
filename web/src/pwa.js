/*
 * The installable app: service worker registration (web/public/sw.js) and the
 * browser's install prompt, shared with InstallPrompt.jsx.
 *
 * Nothing here may break the app: every browser API is feature-checked and
 * every call is wrapped, so a browser without service workers, or one that
 * blocks storage, simply runs the site as a plain web page.
 *
 * A new deploy reaches an open tab without a reload: the browser checks for a
 * new sw.js on every page load, and here again when the tab comes back to the
 * foreground or the phone reconnects (at most every 30 minutes). The new worker
 * takes over at once and caches the new build; the page itself is never
 * reloaded under the reader, because that would wipe a half-filled form. The
 * next page load is the new build (navigations are network-first).
 */

import { saveReceipt } from './myReports.js';

const UPDATE_EVERY_MS = 30 * 60 * 1000;

// ------------------------------------------------------------- install prompt

let deferredPrompt = null;
let installed = false;
const listeners = new Set();

function emit() {
  const state = getInstallState();
  for (const fn of listeners) {
    try { fn(state); } catch {}
  }
}

/** { canPrompt, installed }: canPrompt is true while the browser offers its install dialog. */
export function getInstallState() {
  return { canPrompt: !!deferredPrompt, installed };
}

/** Calls fn with the install state whenever it changes. Returns the unsubscribe function. */
export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Opens the browser's install dialog. Resolves to 'accepted', 'dismissed' or
 * 'unavailable' (no dialog on offer, or the browser refused). The dialog can
 * be shown once per offer, so the offer is spent either way.
 */
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null;
  emit();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}

try {
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (event) => {
      try {
        // Keep Chrome's mini-infobar away; the page offers install inline.
        event.preventDefault();
        deferredPrompt = event;
        emit();
      } catch {}
    });
    window.addEventListener('appinstalled', () => {
      installed = true;
      deferredPrompt = null;
      emit();
    });
  }
} catch {}

// ------------------------------------------------------------- service worker

// Same-origin scripts, styles and images the page loaded before the worker
// controlled it (the first visit, or the visit that installed a new build),
// plus the Google Fonts it used. The worker caches them so the same page,
// in the same language, opens offline next time.
function loadedUrls() {
  try {
    const origin = window.location.origin;
    const urls = new Set();
    for (const entry of performance.getEntriesByType('resource')) {
      let url;
      try { url = new URL(entry.name); } catch { continue; }
      if (url.origin === origin && url.pathname.startsWith('/assets/')) urls.add(url.pathname + url.search);
      else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') urls.add(url.href);
    }
    return [...urls];
  } catch {
    return [];
  }
}

function warmCache(worker) {
  try {
    if (!worker) return;
    const urls = loadedUrls();
    if (urls.length) worker.postMessage({ type: 'KHOZO_CACHE_URLS', urls });
  } catch {}
}

function watchForUpdates(registration) {
  let lastCheck = Date.now();
  const check = () => {
    try {
      if (Date.now() - lastCheck < UPDATE_EVERY_MS) return;
      if (navigator.onLine === false) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    } catch {}
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', check);
}

export function registerServiceWorker() {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const start = () => {
      try {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/', updateViaCache: 'none' })
          .then((registration) => {
            watchForUpdates(registration);
            return navigator.serviceWorker.ready;
          })
          .then((registration) => {
            warmCache(registration.active);
            // Fonts and chunks still downloading at that moment are listed
            // by later passes (the worker skips what it already holds).
            for (const delay of [5000, 20000]) {
              setTimeout(() => warmCache(navigator.serviceWorker.controller || registration.active), delay);
            }
          })
          .catch(() => {});
        // A report that waited in the offline queue was sent in the
        // background: keep its receipt with the others sent from this phone.
        navigator.serviceWorker.addEventListener('message', (event) => {
          try {
            if (event.data?.type === 'KHOZO_SIGHTING_SYNCED' && event.data.receipt?.id) saveReceipt(event.data.receipt);
          } catch {}
        });
        // A new build's worker took over this tab: give it the files this
        // page already has, because it starts with an empty runtime cache.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          warmCache(navigator.serviceWorker.controller);
        });
      } catch {}
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  } catch {}
}
