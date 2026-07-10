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

async function itemToFormData(item) {
  const fd = new FormData();
  if (item.file?.dataUrl) {
    const blob = await fetch(item.file.dataUrl).then((res) => res.blob());
    fd.append('photo', blob, item.file.name || 'queued-sighting.jpg');
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
      if (res.ok) await deleteRecord(record.id);
      else await markAttempt(record, `HTTP ${res.status}`);
    } catch {
      await markAttempt(record, 'Sync failed');
      return;
    }
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(syncSightings());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'KHOZO_SYNC_SIGHTINGS') syncSightings();
});
