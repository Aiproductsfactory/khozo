import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const STORAGE_KEY = 'khozo.apiBaseUrl';

/**
 * Build-time default, set in app.json under `expo.extra.khozoApiUrl`.
 *
 * Defaults to the production Cloudflare Worker endpoint so APK builds connect out of the box.
 * Users can override it in Settings without a rebuild.
 */
export const DEFAULT_API_URL =
  Constants.expoConfig?.extra?.khozoApiUrl || 'https://khozo.swastik-kumar.workers.dev';

/**
 * Addresses tried once on first launch, in order, when the user has not set one.
 */
const CANDIDATE_URLS = [
  DEFAULT_API_URL,
  'https://khozo.swastik-kumar.workers.dev',
  'http://192.168.0.151:4000',
  'http://localhost:4000',
  'http://10.0.2.2:4000',
];

let currentBaseUrl = DEFAULT_API_URL;

/** Strips trailing slashes and a trailing `/api` so callers can pass either form. */
export function normaliseBaseUrl(input) {
  const trimmed = String(input || '').trim().replace(/\s+/g, '');
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '').replace(/\/api$/i, '');
}

export function isValidBaseUrl(input) {
  const normalised = normaliseBaseUrl(input);
  if (!normalised) return false;
  try {
    const url = new URL(normalised);
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function getApiBaseUrl() {
  return currentBaseUrl;
}

/** Returns true when `${url}/api/health` answers within `timeout` ms. */
async function probe(url, timeout = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves the server address at startup: a saved choice always wins, otherwise
 * the candidates are probed once and the first reachable one is remembered.
 */
export async function loadApiBaseUrl() {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && isValidBaseUrl(stored)) {
      currentBaseUrl = normaliseBaseUrl(stored);
      return currentBaseUrl;
    }
  } catch {
    // Fall through to detection.
  }

  const results = await Promise.all(CANDIDATE_URLS.map((candidate) => probe(candidate)));
  const winner = CANDIDATE_URLS.find((_, index) => results[index]);
  if (winner) {
    currentBaseUrl = winner;
    await AsyncStorage.setItem(STORAGE_KEY, winner).catch(() => {});
    return currentBaseUrl;
  }

  currentBaseUrl = DEFAULT_API_URL;
  return currentBaseUrl;
}

export async function setApiBaseUrl(input) {
  const normalised = normaliseBaseUrl(input);
  if (!isValidBaseUrl(normalised)) throw new Error('Enter a valid server address, for example https://khozo.swastik-kumar.workers.dev');
  currentBaseUrl = normalised;
  await AsyncStorage.setItem(STORAGE_KEY, normalised);
  return normalised;
}

export async function resetApiBaseUrl() {
  currentBaseUrl = DEFAULT_API_URL;
  await AsyncStorage.removeItem(STORAGE_KEY);
  return currentBaseUrl;
}

/** Helplines surfaced throughout the app. */
export const HELPLINES = [
  { id: 'childline', label: 'Childline', number: '1098', description: 'Child in distress — 24x7' },
  { id: 'emergency', label: 'Emergency', number: '112', description: 'Police / ambulance / fire' },
  { id: 'women', label: 'Women helpline', number: '181', description: 'Women in distress' },
];
