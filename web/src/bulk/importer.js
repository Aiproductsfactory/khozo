// Sends prepared rows to POST /api/reports one at a time, the way
// scripts/import-gujarat-cases.mjs does: a short pause between rows (every
// upload runs face screening), retries with back-off on 429 and 5xx, a row
// already in Khozo is skipped, and the server's duplicate warning is resolved
// only when the flagged cases are clearly other people.
import { clearlyDifferent, matchesExisting } from './records.js';

export class HttpError extends Error {
  constructor(status, payload, message) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

/** Pause / resume / cancel for a running import. */
export function createControl() {
  let paused = false;
  let cancelled = false;
  let wake = null;
  const notify = () => {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  };
  return {
    get paused() {
      return paused;
    },
    get cancelled() {
      return cancelled;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      notify();
    },
    cancel() {
      cancelled = true;
      paused = false;
      notify();
    },
    /** Resolves when not paused (or cancelled). */
    async whilePaused() {
      while (paused && !cancelled) await new Promise((r) => { wake = r; });
    },
    /** A sleep that ends early on cancel. */
    sleep(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve();
        }, ms);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    },
  };
}

/**
 * A JSON / multipart request function with retries.
 *   fetchImpl(url, init), headers() -> extra headers (auth), sleep(ms)
 * request(path, { method, body, form }) resolves to the parsed JSON body or
 * throws HttpError. `form` is a function returning a fresh FormData.
 */
export function makeRequest({ base = '/api', fetchImpl, headers = () => ({}), sleep, onRetry, isCancelled = () => false, maxRetries = 5 }) {
  return async function request(path, { method = 'GET', body, form } = {}) {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0 && isCancelled()) throw new HttpError(0, null, 'Import cancelled');
      const h = { ...headers() };
      if (body) h['Content-Type'] = 'application/json';
      let res;
      try {
        res = await fetchImpl(`${base}${path}`, { method, headers: h, body: form ? form() : body ? JSON.stringify(body) : undefined });
      } catch (err) {
        if (attempt < maxRetries) {
          const wait = 2000 * 2 ** attempt;
          onRetry?.({ status: 0, wait, attempt: attempt + 1 });
          await sleep(wait);
          continue;
        }
        throw new HttpError(0, null, err?.message || 'Network error');
      }
      const text = await res.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { error: text.slice(0, 200) };
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
        onRetry?.({ status: res.status, wait, attempt: attempt + 1 });
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, payload, payload?.error || `Request failed (${res.status})`);
      return payload;
    }
  };
}

/** The multipart body for one row, as the CLI builds it. */
export function buildForm({ fields, categories }, photo, { allowDuplicate = false, photoName = 'photo.jpg' } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) fd.append(k, String(v));
  for (const cat of categories || []) fd.append('vulnerabilityCategories', cat);
  if (allowDuplicate) fd.append('allowDuplicate', 'true');
  if (photo) {
    // The register's photo was not given with anyone's consent; the
    // record says where it came from instead (DPIA G15).
    fd.append('photoBasis', 'department_register');
    fd.append('photo', photo, photoName);
  }
  return fd;
}

/**
 * Imports items in order. Each item is { key, rec, fields, categories,
 * photoName } and gets a result:
 *   { status: 'created' | 'skipped' | 'review' | 'failed', reportId?, message?, candidates?, afterDuplicateWarning? }
 * Items that already have a created/skipped result are passed over, so a
 * stopped run can be started again.
 *
 *   getPhoto(item)  -> Promise<Blob|null>  (downscaled JPEG)
 *   onEvent({ type: 'row' | 'result' | 'retry' | 'stopped', ... })
 */
export async function runImport({ items, request, control, getPhoto, onEvent = () => {}, delayMs = 1200, results = {} }) {
  let existing = (await request('/reports'))?.reports || [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await control.whilePaused();
    if (control.cancelled) break;
    const prior = results[item.key];
    if (prior && (prior.status === 'created' || prior.status === 'skipped')) continue;
    onEvent({ type: 'row', index: i, item });

    let result;
    const already = existing.find((r) => matchesExisting(r, item.rec, item.fields));
    if (already) {
      result = { status: 'skipped', reportId: already.id };
    } else {
      try {
        let photo = null;
        try {
          photo = await getPhoto(item);
        } catch {
          photo = null;
        }
        const post = (allowDuplicate) => request('/reports', {
          method: 'POST',
          form: () => buildForm(item, photo, { allowDuplicate, photoName: item.photoName }),
        });
        let out;
        let afterDuplicateWarning = false;
        let candidates = null;
        try {
          out = await post(item.forceDuplicate === true);
        } catch (err) {
          if (!(err instanceof HttpError) || err.status !== 409 || !err.payload?.duplicateCandidates) throw err;
          candidates = err.payload.duplicateCandidates;
          // Is the flagged case this very person (imported before, by this page or the CLI)?
          existing = (await request('/reports'))?.reports || existing;
          const reports = candidates.map((d) => existing.find((r) => r.id === d.reportId));
          const same = reports.find((r) => r && matchesExisting(r, item.rec, item.fields));
          if (same) {
            result = { status: 'skipped', reportId: same.id };
          } else if (candidates.every((d, k) => clearlyDifferent(d, reports[k], item.rec, item.fields))) {
            await control.sleep(delayMs);
            out = await post(true);
            afterDuplicateWarning = true;
          } else {
            result = { status: 'review', candidates };
          }
        }
        if (out?.report) {
          existing.push(out.report);
          result = { status: 'created', reportId: out.report.id, afterDuplicateWarning, candidates: afterDuplicateWarning ? candidates : undefined, photo: Boolean(photo) };
        }
      } catch (err) {
        result = { status: 'failed', message: err.message, httpStatus: err.status };
        if (err.status === 401) {
          results[item.key] = result;
          onEvent({ type: 'result', index: i, item, result });
          onEvent({ type: 'stopped', reason: 'session' });
          return results;
        }
      }
    }
    results[item.key] = result;
    onEvent({ type: 'result', index: i, item, result });
    if (result.status !== 'skipped' && i < items.length - 1) await control.sleep(delayMs);
  }
  onEvent({ type: 'stopped', reason: control.cancelled ? 'cancelled' : 'done' });
  return results;
}
