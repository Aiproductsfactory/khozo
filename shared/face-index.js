/**
 * The one-to-many face index: "which open cases look like this face?" in one
 * call, instead of one comparison per case.
 *
 * Today a sighting is compared pairwise with at most KHOZO_MATCH_CANDIDATES
 * (25) open cases, nearest first (shared/match-pool.js). That is the active
 * path, and it stays the active path until an index provider is configured.
 * With one, the forward search asks the index for its 50 closest faces across
 * every enrolled case (recall), and then spends the ordinary pairwise
 * comparison and Rekognition confirmation on that shortlist (precision); the
 * officer still decides.
 *
 * The provider is engine-agnostic by design. The owners' decision is that the
 * index will be Aarakshak's own gallery (its enrol/search API is not published
 * yet), and faces are deliberately NOT indexed in AWS Rekognition collections:
 * Rekognition is only ever asked to compare two photos it is shown.
 *
 * Interface, every method async and never throwing:
 *
 *   enroll(caseId, photo)   -> { ok, reason? }      add or replace a case's face
 *   search(photo, topK)     -> [{ caseId, score }] | null
 *                              null means "no answer", and the caller falls
 *                              back to the pairwise budget; [] means the
 *                              index looked and holds nobody similar
 *   remove(caseId)          -> { ok, reason? }      the case is closed, found
 *                                                    or anonymised
 *
 * Providers:
 *   none               the default: disabled, every call a no-op
 *   aarakshak-gallery  enabled only when AARAKSHAK_GALLERY_URL and
 *                      AARAKSHAK_GALLERY_KEY are both set (a skeleton until
 *                      the API shape is published; see the TODOs)
 */
import { imageExtension, detectImageMime } from './photo-format.js';

/** How many faces a forward search asks the index for. */
export const INDEX_TOP_K = 50;

const TIMEOUT_MS = 12000;

const cleanSecret = (value) => String(value || '').trim();

function readEnv(env, name) {
  if (env && env[name] != null && env[name] !== '') return env[name];
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

/** The disabled provider: Khozo runs on the pairwise budget alone. */
export function noneFaceIndex() {
  return {
    name: 'none',
    enabled: false,
    async enroll() {
      return { ok: false, reason: 'disabled' };
    },
    async search() {
      return null;
    },
    async remove() {
      return { ok: false, reason: 'disabled' };
    },
  };
}

/**
 * Index answers as Khozo uses them: case ids that are strings, scores clamped
 * to 0..1, best first, at most `topK`. Anything malformed is dropped rather
 * than trusted.
 */
export function normaliseIndexHits(hits, topK = INDEX_TOP_K) {
  if (!Array.isArray(hits)) return null;
  const seen = new Set();
  return hits
    .map((hit) => ({
      caseId: typeof hit?.caseId === 'string' ? hit.caseId.trim() : '',
      score: Number(hit?.score),
    }))
    .filter((hit) => hit.caseId && Number.isFinite(hit.score) && !seen.has(hit.caseId) && seen.add(hit.caseId))
    .map((hit) => ({ caseId: hit.caseId, score: Number(Math.max(0, Math.min(1, hit.score)).toFixed(3)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Number(topK) || INDEX_TOP_K));
}

/** A multipart body with a measured length (see worker/src/match.js for why). */
function multipart(parts) {
  const boundary = `----khozoidx${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const chunks = [];
  const encoder = new TextEncoder();
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n${part.contentType ? `Content-Type: ${part.contentType}\r\n` : ''}\r\n`));
    chunks.push(part.value instanceof Uint8Array ? part.value : encoder.encode(String(part.value)));
    chunks.push(encoder.encode('\r\n'));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function imagePart(name, photo) {
  const bytes = photo instanceof Uint8Array ? photo : new Uint8Array(photo);
  return { name, filename: `${name}.${imageExtension(bytes)}`, contentType: detectImageMime(bytes) || 'image/jpeg', value: bytes };
}

/**
 * Aarakshak's gallery, once its one-to-many API is published.
 *
 * TODO(aarakshak-gallery): every path, field name and response shape below is
 * a placeholder chosen to mirror the 1:1 /api/v1/compare call (multipart,
 * X-API-Key). Replace them with the published contract, and keep the three
 * methods' return shapes: the rest of Khozo depends only on those.
 */
export function aarakshakGalleryIndex({ url, key, gallery = 'khozo-open-cases', fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const apiKey = cleanSecret(key);

  async function call(path, init) {
    try {
      const res = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { 'X-API-Key': apiKey, ...(init.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text().catch(() => '');
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { ok: res.ok, status: res.status, data, text };
    } catch (err) {
      return { ok: false, status: null, data: null, text: `${err?.name || 'Error'}: ${err?.message || err}` };
    }
  }

  return {
    name: 'aarakshak-gallery',
    enabled: true,

    async enroll(caseId, photo) {
      if (!caseId || !photo?.length) return { ok: false, reason: 'no_photo' };
      // TODO(aarakshak-gallery): enrol endpoint and field names.
      const { body, contentType } = multipart([
        { name: 'gallery', value: gallery },
        { name: 'subject_id', value: caseId },
        imagePart('image', photo),
      ]);
      const res = await call('/enroll', { method: 'POST', headers: { 'Content-Type': contentType }, body });
      if (!res.ok) {
        console.warn(`[FaceIndex] enrol ${caseId} failed: ${res.status ?? ''} ${res.text.slice(0, 200)}`);
        return { ok: false, reason: res.status ? `http_${res.status}` : 'no_answer' };
      }
      return { ok: true };
    },

    async search(photo, topK = INDEX_TOP_K) {
      if (!photo?.length) return null;
      // TODO(aarakshak-gallery): search endpoint, request fields and the
      // response's list / id / score names.
      const { body, contentType } = multipart([
        { name: 'gallery', value: gallery },
        { name: 'top_k', value: String(topK) },
        imagePart('image', photo),
      ]);
      const res = await call('/search', { method: 'POST', headers: { 'Content-Type': contentType }, body });
      if (!res.ok) {
        console.warn(`[FaceIndex] search failed: ${res.status ?? ''} ${res.text.slice(0, 200)}`);
        return null;
      }
      const rows = Array.isArray(res.data?.results) ? res.data.results : Array.isArray(res.data?.matches) ? res.data.matches : null;
      if (!rows) return null;
      return normaliseIndexHits(rows.map((row) => ({ caseId: row.subject_id ?? row.caseId, score: row.score ?? row.similarity })), topK);
    },

    async remove(caseId) {
      if (!caseId) return { ok: false, reason: 'no_case' };
      // TODO(aarakshak-gallery): removal endpoint.
      const res = await call('/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gallery, subject_id: caseId }),
      });
      if (!res.ok) {
        console.warn(`[FaceIndex] remove ${caseId} failed: ${res.status ?? ''} ${res.text.slice(0, 200)}`);
        return { ok: false, reason: res.status ? `http_${res.status}` : 'no_answer' };
      }
      return { ok: true };
    },
  };
}

/**
 * The provider this deployment uses: Aarakshak's gallery when both
 * AARAKSHAK_GALLERY_URL and AARAKSHAK_GALLERY_KEY are set, otherwise none.
 * `env` is the Worker's env or Node's process.env.
 */
export function createFaceIndex(env = {}, { fetchImpl } = {}) {
  const url = cleanSecret(readEnv(env, 'AARAKSHAK_GALLERY_URL'));
  const key = cleanSecret(readEnv(env, 'AARAKSHAK_GALLERY_KEY'));
  if (url && key) {
    return aarakshakGalleryIndex({
      url,
      key,
      gallery: cleanSecret(readEnv(env, 'AARAKSHAK_GALLERY_NAME')) || undefined,
      fetchImpl: fetchImpl || ((...args) => fetch(...args)),
    });
  }
  return noneFaceIndex();
}

/**
 * Wraps any provider so that a fault in it can never fail the request that
 * called it: a throw becomes `{ ok: false }` or `null`, logged.
 */
export function safeFaceIndex(provider) {
  const inner = provider && typeof provider === 'object' && typeof provider.search === 'function' ? provider : noneFaceIndex();
  const guard = (fn, fallback) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.warn(`[FaceIndex] ${inner.name} failed:`, err?.message || err);
      return fallback;
    }
  };
  return {
    name: String(inner.name || 'custom'),
    enabled: Boolean(inner.enabled),
    enroll: guard((...a) => inner.enroll(...a), { ok: false, reason: 'error' }),
    search: guard(async (photo, topK) => {
      const hits = await inner.search(photo, topK);
      return hits == null ? null : normaliseIndexHits(hits, topK);
    }, null),
    remove: guard((...a) => inner.remove(...a), { ok: false, reason: 'error' }),
  };
}

/**
 * Enrols a case's photo and records the outcome on the case (`faceIndex`), so
 * the forward search knows which open cases the index holds and fills its
 * budget with the ones it does not (shared/match-pool.js). No-op without an
 * enabled provider.
 */
export async function enrollCaseInIndex(faceIndex, report, photo, updateReport) {
  const index = safeFaceIndex(faceIndex);
  if (!index.enabled || !report?.id) return null;
  if (!photo?.length) return null;
  const res = await index.enroll(report.id, photo);
  const entry = {
    provider: index.name,
    status: res?.ok ? 'enrolled' : 'failed',
    reason: res?.ok ? null : res?.reason || 'error',
    at: new Date().toISOString(),
  };
  if (typeof updateReport === 'function') updateReport(report.id, { faceIndex: entry });
  return entry;
}

/**
 * Removes a case from the index - it was found, closed or anonymised - and
 * records that. Only a case the index was given is removed; no-op otherwise.
 */
export async function removeCaseFromIndex(faceIndex, report, updateReport) {
  const index = safeFaceIndex(faceIndex);
  if (!index.enabled || !report?.id) return null;
  const known = report.faceIndex;
  if (!known || known.provider !== index.name || known.status === 'removed') return null;
  const res = await index.remove(report.id);
  const entry = {
    provider: index.name,
    status: res?.ok ? 'removed' : 'remove_failed',
    reason: res?.ok ? null : res?.reason || 'error',
    at: new Date().toISOString(),
  };
  if (typeof updateReport === 'function') updateReport(report.id, { faceIndex: entry });
  return entry;
}
