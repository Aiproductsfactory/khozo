import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const offlineQueue = read('web/src/offlineQueue.js');
const serviceWorker = read('web/public/sw.js');
const capture = read('web/src/pages/Capture.jsx');
const index = read('web/index.html');
const manifest = JSON.parse(read('web/public/manifest.webmanifest'));

assert(offlineQueue.includes('export const QUEUE_TTL_MS = 72 * 60 * 60 * 1000'), 'offline queue TTL must be 72 hours');
assert(offlineQueue.includes('export const QUEUE_LIMIT = 10'), 'offline queue limit must be explicit');
assert(offlineQueue.includes('expiresAt(record.createdAt)'), 'offline queue should expose expiry timestamps');
assert(offlineQueue.includes('lastAttemptAt') && offlineQueue.includes('lastError'), 'offline queue should expose retry telemetry');
assert(offlineQueue.includes('isExpired(record)'), 'offline queue should prune expired sightings');
assert(serviceWorker.includes('QUEUE_TTL_MS = 72 * 60 * 60 * 1000'), 'service worker should share the 72-hour TTL');
assert(serviceWorker.includes('markAttempt(record') && serviceWorker.includes('lastError'), 'service worker should record sync telemetry');
assert(serviceWorker.includes('expiresAt(record) <= Date.now()'), 'service worker should remove expired records before sync');
assert(capture.includes('expire after') && capture.includes('Last retry'), 'capture page should show queue expiry and retry telemetry');
assert(index.includes('rel="manifest"') && index.includes('theme-color'), 'index.html should advertise PWA manifest and theme color');
assert(manifest.start_url === '/report', 'PWA manifest should start at field reporting');
assert(manifest.display === 'standalone', 'PWA manifest should use standalone display');
assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'PWA manifest should include an icon');

console.log('PWA/offline queue checks passed.');
