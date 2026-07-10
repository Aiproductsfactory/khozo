const DB_NAME = 'khozo_field_queue';
const DB_VERSION = 1;
const STORE = 'encrypted_sightings';
const KEY_STORE = 'crypto_keys';
const KEY_ID = 'sighting_queue_key';
const SYNC_TAG = 'khozo-sync-sightings';
export const QUEUE_TTL_MS = 72 * 60 * 60 * 1000;
export const QUEUE_LIMIT = 10;

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

function txStore(db, storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getQueueKey() {
  const db = await openDb();
  const existing = await requestToPromise(txStore(db, KEY_STORE).get(KEY_ID));
  if (existing?.key) return existing.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await requestToPromise(txStore(db, KEY_STORE, 'readwrite').put({ id: KEY_ID, key, createdAt: Date.now() }));
  return key;
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptPayload(payload) {
  const key = await getQueueKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { iv: bytesToBase64(iv), payload: bytesToBase64(new Uint8Array(cipher)) };
}

async function decryptPayload(record) {
  const key = await getQueueKey();
  const iv = base64ToBytes(record.iv);
  const cipher = base64ToBytes(record.payload);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

function expiresAt(createdAt) {
  return Number(createdAt || 0) + QUEUE_TTL_MS;
}

function isExpired(record, now = Date.now()) {
  return expiresAt(record.createdAt) <= now;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function queuedToFormData(item) {
  const fd = new FormData();
  if (item.file?.dataUrl) {
    const blob = await fetch(item.file.dataUrl).then((r) => r.blob());
    fd.append('photo', blob, item.file.name || 'queued-sighting.jpg');
  }
  Object.entries(item.form || {}).forEach(([k, v]) => v != null && v !== '' && fd.append(k, v));
  return fd;
}

export async function getQueuedSightings() {
  const db = await openDb();
  const records = await requestToPromise(txStore(db, STORE).getAll());
  const expired = records.filter((record) => isExpired(record));
  await Promise.all(expired.map((record) => requestToPromise(txStore(db, STORE, 'readwrite').delete(record.id))));
  const active = records.filter((record) => !isExpired(record));
  const decrypted = await Promise.all(active.map(async (record) => ({
    id: record.id,
    createdAt: record.createdAt,
    expiresAt: expiresAt(record.createdAt),
    lastAttemptAt: record.lastAttemptAt || null,
    lastError: record.lastError || null,
    encryptedAtRest: true,
    ...(await decryptPayload(record)),
  })));
  return decrypted.sort((a, b) => b.createdAt - a.createdAt);
}

export async function enqueueSighting(form, file) {
  const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = Date.now();
  const encrypted = await encryptPayload({ form, file: await fileToDataUrl(file) });
  const db = await openDb();
  const existing = await requestToPromise(txStore(db, STORE).getAll());
  const expired = existing.filter((record) => isExpired(record));
  const overflow = existing
    .filter((record) => !isExpired(record))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(QUEUE_LIMIT - 1);
  await Promise.all(overflow.map(async (record) => {
    await requestToPromise(txStore(db, STORE, 'readwrite').delete(record.id));
  }));
  await Promise.all(expired.map((record) => requestToPromise(txStore(db, STORE, 'readwrite').delete(record.id))));
  await requestToPromise(txStore(db, STORE, 'readwrite').put({
    id,
    createdAt,
    expiresAt: expiresAt(createdAt),
    lastAttemptAt: null,
    lastError: null,
    ...encrypted,
  }));
  await requestBackgroundSync();
  return getQueuedSightings();
}

export async function removeQueuedSighting(id) {
  const db = await openDb();
  await requestToPromise(txStore(db, STORE, 'readwrite').delete(id));
  return getQueuedSightings();
}

export async function clearQueuedSighting(id) {
  const db = await openDb();
  await requestToPromise(txStore(db, STORE, 'readwrite').delete(id));
}

export async function requestBackgroundSync() {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return false;
  if ('sync' in registration) {
    await registration.sync.register(SYNC_TAG);
    return true;
  }
  registration.active?.postMessage({ type: 'KHOZO_SYNC_SIGHTINGS' });
  return false;
}
