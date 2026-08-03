import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const STORAGE_KEY = 'khozo.apiBaseUrl';

/**
 * Build-time default, set in app.json under `expo.extra.khozoApiUrl`.
 *
 * Defaults to the production Cloudflare Worker endpoint so APK builds connect out of the box.
 * Users can override it in Settings without a rebuild.
 */
export const DEFAULT_API_URL = 'https://khozo.swastik-kumar.workers.dev';

let currentBaseUrl = DEFAULT_API_URL;

/** Strips trailing slashes and a trailing `/api` so callers can pass either form. */
export function normaliseBaseUrl(input) {
  const trimmed = String(input || '').trim().replace(/\s+/g, '');
  if (!trimmed) return DEFAULT_API_URL;
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
  return DEFAULT_API_URL;
}

export async function loadApiBaseUrl() {
  currentBaseUrl = DEFAULT_API_URL;
  return DEFAULT_API_URL;
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
