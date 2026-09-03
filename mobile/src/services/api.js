import { File } from 'expo-file-system';

import { getApiBaseUrl } from './config';

const DEFAULT_TIMEOUT = 15000;
const UPLOAD_TIMEOUT = 45000;

/** Error carrying the HTTP status and the server's message, so screens can react. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = null, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the request never reached the server (airplane mode, wrong host, server down). */
  get isNetworkError() {
    return this.status === 0;
  }
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 300) };
  }
}

/**
 * Single entry point for every server call.
 *
 * Adds the base URL, bearer token, a hard timeout (React Native's fetch has
 * none, so a wrong LAN address would otherwise hang the UI forever), and
 * normalises both transport and application errors into ApiError.
 */
export async function request(path, { method = 'GET', body, token, timeout, signal } = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const controller = new AbortController();
  const timeoutMs = timeout ?? (isFormData ? UPLOAD_TIMEOUT : DEFAULT_TIMEOUT);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onOuterAbort);

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isFormData) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api${path}`, {
      method,
      headers,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    // Keep the underlying reason: "Network request failed" and a permission or
    // file-read failure look identical to the user otherwise, and the outbox is
    // often the only place a field problem can be diagnosed from.
    const cause = error?.message ? ` (${error.message})` : '';
    throw new ApiError(
      aborted
        ? 'The Khozo server did not respond in time. Check your connection and try again — a sighting you submit offline is saved and sent automatically.'
        : `Could not reach the Khozo server. Check your connection and try again.${cause}`,
      { status: 0, code: aborted ? 'TIMEOUT' : 'NETWORK', details: error?.message || null },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onOuterAbort);
  }

  const payload = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, {
      status: response.status,
      code: payload?.code || null,
      details: payload?.errors || null,
    });
  }
  return payload;
}

/** Probes the API. Useful when diagnosing a field device. */
export async function checkHealth(timeout = 6000) {
  const started = Date.now();
  const payload = await request('/health', { timeout });
  return { ok: Boolean(payload?.ok), service: payload?.service, latencyMs: Date.now() - started };
}

// ---- Auth -----------------------------------------------------------------

export const authApi = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: (token) => request('/auth/me', { token }),
  changePassword: (token, currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', token, body: { currentPassword, newPassword } }),
};

// ---- Public (no authentication) -------------------------------------------

function query(params = {}) {
  const search = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return search ? `?${search}` : '';
}

export const publicApi = {
  bulletins: (filters = {}) =>
    request(`/reports/public/bulletins${query(filters)}`).then((r) => r?.bulletins || []),
  search: (filters = {}) => request(`/reports/public/search${query(filters)}`).then((r) => r?.results || []),
  caseStatus: (ref) => request(`/reports/public/status/${encodeURIComponent(ref)}`).then((r) => r?.status),
  sightingStatus: (id) => request(`/reports/found/status/${encodeURIComponent(id)}`).then((r) => r?.status),
};

/**
 * Submits a sighting.
 *
 * The endpoint is intentionally public: a citizen who spots a child must be
 * able to report without an account. The server never returns identifying
 * details of a matched child to the submitter — only a receipt and a review
 * status — so nothing here needs to guard identity on the client.
 */
/**
 * Builds the multipart file part for a local photo URI.
 *
 * Expo SDK 54+ installs its own WinterCG `fetch` over React Native's, and it
 * only understands `string`, `Blob`, or an object exposing `bytes()`. React
 * Native's classic `{ uri, name, type }` part is rejected outright with
 * "Unsupported FormDataPart implementation", so the bytes are read here.
 *
 * `name` and `type` must both survive: without a filename busboy treats the
 * part as a plain field rather than a file, and the server rejects uploads
 * whose mime type is not an allowed image.
 */
async function buildPhotoPart(photoUri, { name, type } = {}) {
  const file = new File(photoUri);
  if (!file.exists) return null;
  return {
    name: name || file.name || 'sighting.jpg',
    type: file.type || type || 'image/jpeg',
    bytes: () => file.bytes(),
  };
}

export async function submitSighting(sighting, { token, signal } = {}) {
  const form = new FormData();
  const append = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    form.append(key, String(value));
  };

  append('foundLocation', sighting.foundLocation);
  append('note', sighting.note);
  append('reporterName', sighting.reporterName);
  append('reporterPhone', sighting.reporterPhone);
  append('confidentialReporter', sighting.confidentialReporter ? 'true' : '');
  append('ageApprox', sighting.ageApprox);
  append('gender', sighting.gender);
  append('state', sighting.state);
  append('district', sighting.district);
  append('lat', sighting.lat);
  append('lng', sighting.lng);
  append('idProofType', sighting.idProofType);
  append('idProofNumber', sighting.idProofNumber);

  if (sighting.photoUri) {
    const photo = await buildPhotoPart(sighting.photoUri, {
      name: sighting.photoName,
      type: sighting.photoType,
    });
    // A queued photo whose file has since disappeared must not block the
    // report - the text detail is still worth sending to a CWC reviewer.
    if (photo) {
      append('photoConsent', 'true');
      form.append('photo', photo);
    }
  }

  return request('/reports/found', { method: 'POST', body: form, token, signal });
}

// ---- Authenticated officer workflows --------------------------------------

export const officerApi = {
  foundReports: (token) => request('/reports/found/all', { token }).then((r) => r?.foundReports || []),
  reviewFound: (token, id, decision, note) =>
    request(`/reports/found/${encodeURIComponent(id)}/review`, { method: 'POST', token, body: { decision, note } }),
  reports: (token, filters = {}) => request(`/reports${query(filters)}`, { token }).then((r) => r?.reports || []),
  report: (token, id) => request(`/reports/${encodeURIComponent(id)}`, { token }),
  stats: (token) => request('/dashboard/stats', { token }),

  /** Alerts raised for this officer, newest first, with the unread count. */
  notifications: (token) => request('/dashboard/notifications', { token }),
  markNotificationsRead: (token, ids) =>
    request('/dashboard/notifications/read', { method: 'POST', token, body: ids ? { ids } : {} }),
};
