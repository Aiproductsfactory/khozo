import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import { ApiError, submitSighting } from './api';

const QUEUE_KEY = 'khozo.sightingQueue';
const PHOTO_DIR_NAME = 'queued-sightings';

/**
 * Durable outbox for sightings.
 *
 * Field reporting happens in exactly the places with the worst connectivity —
 * railway platforms, bus stands, rural roads. A sighting the reporter believes
 * they submitted must never be lost, so submissions are written to disk first
 * and uploaded opportunistically.
 */

let cache = null;
const listeners = new Set();

function photoDir() {
  const dir = new Directory(Paths.document, PHOTO_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function emit() {
  for (const listener of listeners) listener(cache || []);
}

export function subscribe(listener) {
  listeners.add(listener);
  if (cache) listener(cache);
  return () => listeners.delete(listener);
}

async function persist(items) {
  cache = items;
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  emit();
}

export async function loadQueue() {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch {
    cache = [];
  }
  emit();
  return cache;
}

/**
 * Copies the captured photo out of the cache directory, which Android is free
 * to purge, into app documents so a queued sighting survives a restart.
 */
async function retainPhoto(id, photoUri) {
  if (!photoUri) return null;
  try {
    const source = new File(photoUri);
    if (!source.exists) return null;
    const target = new File(photoDir(), `${id}.jpg`);
    if (target.exists) target.delete();
    await source.copy(target);
    return target.uri;
  } catch {
    // If the copy fails we still queue the sighting; the text detail alone is
    // useful to a CWC reviewer and is better than dropping the report.
    return null;
  }
}

function releasePhoto(uri) {
  if (!uri || !uri.includes(PHOTO_DIR_NAME)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort - an orphaned photo is harmless and gets cleaned on uninstall.
  }
}

/** Adds a sighting to the outbox. Returns the queued entry. */
export async function enqueue(sighting) {
  const items = await loadQueue();
  const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const retainedPhoto = await retainPhoto(id, sighting.photoUri);
  const entry = {
    id,
    payload: { ...sighting, photoUri: retainedPhoto },
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    permanentError: null,
  };
  await persist([...items, entry]);
  return entry;
}

export async function discard(id) {
  const items = await loadQueue();
  const entry = items.find((item) => item.id === id);
  if (entry) releasePhoto(entry.payload?.photoUri);
  await persist(items.filter((item) => item.id !== id));
}

export async function clearQueue() {
  const items = await loadQueue();
  for (const item of items) releasePhoto(item.payload?.photoUri);
  await persist([]);
}

/**
 * Attempts to upload every pending sighting.
 *
 * A 4xx means the server will never accept this payload, so it is parked with a
 * `permanentError` for the user to review instead of being retried forever.
 * Anything else (offline, timeout, 5xx) stays queued for the next attempt.
 */
export async function flush({ token } = {}) {
  const items = await loadQueue();
  const pending = items.filter((item) => !item.permanentError);
  if (pending.length === 0) return { sent: 0, failed: 0, remaining: items.length };

  let sent = 0;
  let failed = 0;
  const next = [...items];

  for (const item of pending) {
    const index = next.findIndex((row) => row.id === item.id);
    try {
      const result = await submitSighting(item.payload, { token });
      releasePhoto(item.payload?.photoUri);
      next.splice(index, 1);
      sent += 1;
      // Keep the receipt so the reporter can track it from the Track tab.
      await rememberReceipt(result?.foundReport, item.payload);
    } catch (error) {
      failed += 1;
      const permanent = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429;
      next[index] = {
        ...item,
        attempts: item.attempts + 1,
        lastError: error.message,
        permanentError: permanent ? error.message : null,
      };
      // A network failure will hit every remaining item too - stop early.
      if (error instanceof ApiError && error.isNetworkError) break;
    }
  }

  await persist(next);
  return { sent, failed, remaining: next.length };
}

// ---- Submitted receipts ---------------------------------------------------

const RECEIPTS_KEY = 'khozo.sightingReceipts';
const MAX_RECEIPTS = 30;

export async function loadReceipts() {
  try {
    const raw = await AsyncStorage.getItem(RECEIPTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Stores a submission receipt locally so the reporter can follow it up later. */
export async function rememberReceipt(foundReport, payload = {}) {
  if (!foundReport?.id) return;
  const receipts = await loadReceipts();
  const entry = {
    id: foundReport.id,
    status: foundReport.status,
    referralStatus: foundReport.referralStatus,
    foundLocation: foundReport.foundLocation || payload.foundLocation || null,
    submittedAt: Date.now(),
  };
  const next = [entry, ...receipts.filter((row) => row.id !== entry.id)].slice(0, MAX_RECEIPTS);
  await AsyncStorage.setItem(RECEIPTS_KEY, JSON.stringify(next));
}

export async function clearReceipts() {
  await AsyncStorage.removeItem(RECEIPTS_KEY);
}
