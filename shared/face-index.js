/**
 * The one-to-many face index: "which open cases look like this face?" in one
 * call, instead of one comparison per case.
 *
 * Without an index, a sighting is compared pairwise with at most
 * KHOZO_MATCH_CANDIDATES (25) open cases, nearest first (shared/match-pool.js).
 * With one, the forward search asks the index for its 50 closest faces across
 * every enrolled case (recall), and then spends the ordinary pairwise
 * comparison and Rekognition confirmation on that shortlist (precision); the
 * officer still decides.
 *
 * The provider is engine-agnostic by design. The owners' decision is that the
 * index is Aarakshak's own gallery, and faces are deliberately NOT indexed in
 * AWS Rekognition collections: Rekognition is only ever asked to compare two
 * photos it is shown.
 *
 * Interface, every method async and never throwing:
 *
 *   enroll(caseId, photo)   -> { ok, reason?, faceId?, quality?, warnings?, requestId? }
 *                              add or replace a case's face
 *   search(photo, topK)     -> [{ caseId, score }] | null
 *                              null means "no answer", and the caller falls
 *                              back to the pairwise budget; [] means the
 *                              index looked and holds nobody similar
 *   remove(caseId)          -> { ok, reason?, receipt? }   the case is closed,
 *                                                          found or anonymised
 *   info()                  -> { galleryId, cases, faces, limits, ... } | null
 *   listCaseIds()           -> [caseId] | null   every case the gallery holds,
 *                                                for reconciliation
 *
 * Providers:
 *   none               the default: disabled, every call a no-op
 *   aarakshak-gallery  enabled only when AARAKSHAK_GALLERY_URL and
 *                      AARAKSHAK_GALLERY_KEY are both set
 */
import { imageExtension, detectImageMime } from './photo-format.js';

/** How many faces a forward search asks the index for. */
export const INDEX_TOP_K = 50;

/**
 * Why a photo could not be enrolled, as Aarakshak reports it. Trying again
 * with the same photo gives the same answer; the case needs a better photo
 * (one face, front-facing, large enough).
 */
export const PHOTO_REJECTION_REASONS = new Set(['no_face', 'multiple_faces', 'face_too_small', 'face_not_found_at_box']);

/**
 * The warnings Aarakshak attaches to a face it enrolled but could barely use.
 * Such a case is in the gallery, and will be matched less reliably than one
 * with a larger, sharper face; the desk is told so.
 */
export const WEAK_FACE_WARNINGS = new Set(['face_too_small', 'face_small_in_frame', 'low_detector_confidence']);

/**
 * The warnings that mean a case photo is worth replacing: the face is too
 * small to match well (shared/photo-need.js). `low_detector_confidence` is
 * not one: it is Aarakshak's face finder being less than 0.9 sure of a face,
 * which happens to faces anyone can see (looking down, a bright window
 * behind), and Aarakshak calls it advisory. On its word alone the desk was
 * told to ask a family for a better photo of a clear face.
 */
export const SMALL_FACE_WARNINGS = new Set(['face_too_small', 'face_small_in_frame']);

/**
 * Whether a failed enrolment is worth trying again as it is: the provider did
 * not answer, was busy or broke, or refused the key (a key problem, not the
 * photo's). A rejected photo, or any other refusal, is not.
 */
export function isRetryableIndexFailure(reason) {
  const r = String(reason || '');
  return r === 'no_answer' || r === 'rate_limited' || r === 'unauthorized' || r === 'error' || /^http_5\d\d$/.test(r);
}

// Aarakshak's refusal codes and messages, read for the photo reasons above.
const PHOTO_REFUSAL_PATTERNS = [
  [/no[_\s-]?faces?\b|face[_\s-]?not[_\s-]?(found|detected)|no[_\s-]?face[_\s-]?detected/i, 'no_face'],
  [/multiple|several|more[_\s-]?than[_\s-]?one|too[_\s-]?many[_\s-]?faces/i, 'multiple_faces'],
  [/too[_\s-]?small|small[_\s-]?face|low[_\s-]?resolution/i, 'face_too_small'],
];

/**
 * Why Aarakshak refused a request, from its error body: its own
 * `{ detail: { code, message } }`, FastAPI's `{ detail: [{ msg }] }`, or a
 * plain `{ detail: "..." }`. A refusal about the face is read as one of the
 * photo reasons; any other keeps Aarakshak's code (`refused_<code>`).
 */
export function refusalOf(data) {
  const d = data?.detail;
  let code = '';
  let message = '';
  if (Array.isArray(d)) message = d.map((e) => (typeof e?.msg === 'string' ? e.msg : '')).filter(Boolean).join('; ');
  else if (d && typeof d === 'object') {
    code = typeof d.code === 'string' ? d.code : '';
    message = typeof d.message === 'string' ? d.message : '';
  } else if (typeof d === 'string') message = d;
  if (!code && !message) return null;
  const mapped = PHOTO_REJECTION_REASONS.has(code) ? code : PHOTO_REFUSAL_PATTERNS.find(([re]) => re.test(`${code} ${message}`))?.[1];
  const ownCode = code.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  return { reason: mapped || (ownCode ? `refused_${ownCode}` : null), message: message.slice(0, 200) || null };
}

const TIMEOUT_MS = 12000;

const cleanSecret = (value) => String(value || '').trim();

/**
 * An API key as it was meant to be typed. A pasted key can carry more than
 * the byte-order mark trim() removes (worker/src/match.js): a zero-width space
 * from a chat app or an email, a non-breaking space, or the markers a terminal
 * wraps around a paste (ESC[200~ ... ESC[201~). None of them is ever part of a
 * key, so all are removed wherever they are.
 */
export function cleanApiKey(value) {
  return String(value || '')
    .replace(/\u001b\[20[01]~/g, '')
    .replace(/[\p{Cc}\p{Cf}\p{Z}\s]/gu, '');
}

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
    async info() {
      return null;
    },
    async listCaseIds() {
      return null;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Aarakshak's gallery API, v2 (https://aarakshak.com/openapi.json, tag
 * gallery-v2). The key is bound to one gallery - the pilot's is
 * `khozo-sandbox` - so no request names it. AARAKSHAK_GALLERY_NAME is only
 * compared with what GET /api/v2/gallery says, so a key for the wrong gallery
 * shows on the status panel instead of quietly searching someone else's.
 *
 * What Khozo sends, and what it does not:
 *   - the opaque case id (`r_...`) and the photo. Never a name, and none of
 *     the optional metadata (sex, birth year, state, district): Khozo does not
 *     narrow a search by what a family estimated, so it has no use for it.
 *     Aarakshak keeps the face template, not the photo.
 *   - one Idempotency-Key per enrolment, reused by its one retry, so a
 *     retried request cannot enrol a face twice. A later enrolment of the same
 *     case (a reopened case) gets a new key: an old one would replay the old
 *     answer for a face that has since been deleted.
 *
 * The pilot allows 30 requests a minute per key. A 429 is never retried here:
 * a search falls back to the pairwise budget, and an enrolment is recorded as
 * failed for the backfill to pick up (shared/routes/face-index-admin.js). A
 * face is searchable about five seconds after it is enrolled; until then the
 * pool compares a just-enrolled case pairwise (shared/match-pool.js).
 *
 * Every failure is logged with Aarakshak's X-Request-ID, which is what their
 * support asks for.
 */
export function aarakshakGalleryIndex({ url, key, gallery = '', fetchImpl = fetch, timeoutMs = TIMEOUT_MS, retryDelayMs = 1000 } = {}) {
  // The host alone; a URL given with /api/v2 (or v1) on the end is accepted.
  const base = String(url || '').replace(/\/+$/, '').replace(/\/api\/v\d+$/, '');
  const apiKey = cleanApiKey(key);
  const expectedGallery = cleanSecret(gallery);

  async function call(method, path, { headers = {}, body } = {}) {
    try {
      const res = await fetchImpl(`${base}/api/v2${path}`, {
        method,
        headers: { 'X-API-Key': apiKey, Accept: 'application/json', ...headers },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text().catch(() => '');
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      const requestId = res.headers?.get?.('x-request-id') || null;
      return { ok: res.ok, status: res.status, data, text, requestId };
    } catch (err) {
      return { ok: false, status: null, data: null, text: `${err?.name || 'Error'}: ${err?.message || err}`, requestId: null };
    }
  }

  // One retry, after a pause, when Aarakshak did not answer or broke (5xx);
  // never after a 429 or a refusal. The body is a Uint8Array, so it can be sent
  // twice.
  async function callWithRetry(method, path, init) {
    const first = await call(method, path, init);
    if (first.status != null && first.status < 500) return first;
    warn(`${method} ${path}`, first, 'retrying once');
    await sleep(retryDelayMs);
    return call(method, path, init);
  }

  function reasonOf(res) {
    if (res.status == null) return 'no_answer';
    if (res.status === 429) return 'rate_limited';
    if (res.status === 401 || res.status === 403) return 'unauthorized';
    return `http_${res.status}`;
  }

  function warn(what, res, note = '') {
    const ref = res.requestId ? ` (X-Request-ID ${res.requestId})` : '';
    console.warn(`[FaceIndex] ${what} failed: ${res.status ?? 'no answer'}${ref} ${String(res.text || '').slice(0, 200)}${note ? ` - ${note}` : ''}`);
  }

  // The per-photo verdicts, in the order the photos were sent, whether the
  // case was enrolled (201) or refused (a FastAPI error carries them under
  // `detail`). Placed by `photo_index` where Aarakshak gives it.
  function photoResultsOf(data, count) {
    const photos = Array.isArray(data?.photos) ? data.photos : Array.isArray(data?.detail?.photos) ? data.detail.photos : [];
    const out = new Array(count).fill(null);
    photos.forEach((p, i) => {
      if (!p || typeof p !== 'object') return;
      const at = Number.isInteger(p.photo_index) && p.photo_index >= 0 && p.photo_index < count ? p.photo_index : i;
      if (at < count && !out[at]) out[at] = p;
    });
    return out;
  }

  function photoSummaryOf(verdict) {
    return {
      status: typeof verdict?.status === 'string' ? verdict.status : null,
      faceId: typeof verdict?.face_id === 'string' ? verdict.face_id : null,
      quality: Number.isFinite(Number(verdict?.quality_score)) && verdict?.quality_score != null ? Number(verdict.quality_score) : null,
      warnings: Array.isArray(verdict?.warnings) ? verdict.warnings.filter((w) => typeof w === 'string').slice(0, 5) : [],
    };
  }

  return {
    name: 'aarakshak-gallery',
    enabled: true,

    // One photo, or several of the same person sent together as `images`
    // parts: `replace` makes the gallery hold exactly this set of faces. What
    // is returned at the top describes the first photo (the case's main one);
    // `photos` describes each, in the order sent.
    async enroll(caseId, photo) {
      const photos = (Array.isArray(photo) ? photo : [photo]).filter((p) => p?.length);
      if (!caseId || !photos.length) return { ok: false, reason: 'no_photo' };
      const { body, contentType } = multipart([
        { name: 'case_id', value: caseId },
        { name: 'replace', value: 'true' },
        ...photos.map((p) => imagePart('images', p)),
      ]);
      const headers = { 'Content-Type': contentType, 'Idempotency-Key': `khozo-enrol-${caseId}-${crypto.randomUUID()}` };
      const res = await callWithRetry('POST', '/cases', { headers, body });
      const results = photoResultsOf(res.data, photos.length);
      const each = results.map(photoSummaryOf);
      const verdict = results[0];
      const { quality, warnings } = each[0];
      if (res.ok && Number(res.data?.faces_enrolled) > 0) {
        return { ok: true, faceId: each[0].faceId, quality, warnings, photos: each, requestId: res.requestId };
      }
      const status = typeof verdict?.status === 'string' ? verdict.status : '';
      // A refusal (4xx, other than the key or the rate) says why in its body.
      const refusal = !res.ok && res.status >= 400 && res.status < 500 && ![401, 403, 429].includes(res.status) ? refusalOf(res.data) : null;
      const reason = status && status !== 'enrolled' ? status : res.ok ? 'not_enrolled' : refusal?.reason || reasonOf(res);
      warn(`enrol ${caseId}`, res, reason);
      return { ok: false, reason, detail: refusal?.message || null, quality, warnings, photos: each, requestId: res.requestId };
    },

    async search(photo, topK = INDEX_TOP_K) {
      if (!photo?.length) return null;
      const { body, contentType } = multipart([
        { name: 'top_k', value: String(topK) },
        imagePart('image', photo),
      ]);
      // No retry: the sighting is waiting, and the pairwise budget is the
      // fallback.
      const res = await call('POST', '/search', { headers: { 'Content-Type': contentType }, body });
      if (!res.ok) {
        warn('search', res, reasonOf(res));
        return null;
      }
      const faces = Array.isArray(res.data?.faces) ? res.data.faces : null;
      // No face found in the probe is not "nobody similar": the pairwise
      // comparison, with its own detector, decides instead.
      if (!faces || !faces.length) return null;
      // Every face in the probe, largest first - a child photographed beside
      // an adult is searched too - and each case at its best face's score.
      const best = new Map();
      for (const face of faces) {
        for (const match of Array.isArray(face?.matches) ? face.matches : []) {
          const caseId = typeof match?.case_id === 'string' ? match.case_id : '';
          const score = Number(match?.score);
          if (caseId && Number.isFinite(score) && !(best.get(caseId) >= score)) best.set(caseId, score);
        }
      }
      return normaliseIndexHits([...best].map(([caseId, score]) => ({ caseId, score })), topK);
    },

    async remove(caseId) {
      if (!caseId) return { ok: false, reason: 'no_case' };
      const res = await callWithRetry('DELETE', `/cases/${encodeURIComponent(caseId)}`);
      // Already gone is what was asked for.
      if (res.status === 404) return { ok: true, receipt: null };
      if (!res.ok) {
        warn(`remove ${caseId}`, res, reasonOf(res));
        return { ok: false, reason: reasonOf(res), requestId: res.requestId };
      }
      const r = res.data || {};
      // Aarakshak's signed proof that the faces were erased.
      return {
        ok: true,
        receipt: {
          caseIdSha256: typeof r.case_id_sha256 === 'string' ? r.case_id_sha256 : null,
          facesDeleted: Number.isFinite(Number(r.faces_deleted)) ? Number(r.faces_deleted) : null,
          deletedAt: typeof r.deleted_at === 'string' ? r.deleted_at : null,
          signature: typeof r.signature === 'string' ? r.signature : null,
        },
      };
    },

    async info() {
      const res = await call('GET', '/gallery');
      if (!res.ok || !res.data) {
        warn('gallery info', res, reasonOf(res));
        return null;
      }
      const d = res.data;
      return {
        galleryId: typeof d.gallery_id === 'string' ? d.gallery_id : null,
        label: typeof d.label === 'string' ? d.label : null,
        cases: Number(d.case_count) || 0,
        faces: Number(d.face_count) || 0,
        limits: d.limits && typeof d.limits === 'object' ? d.limits : {},
        model: d.model && typeof d.model === 'object'
          ? { version: d.model.model_version || null, embedding: d.model.embedding_model || null, score: d.model.score || null }
          : null,
        expectedGallery: expectedGallery || null,
        galleryMatches: !expectedGallery || d.gallery_id === expectedGallery,
      };
    },

    async listCaseIds({ pageSize = 1000, maxPages = 20 } = {}) {
      const ids = [];
      let offset = 0;
      for (let page = 0; page < maxPages; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await call('GET', `/cases?offset=${offset}&limit=${pageSize}`);
        if (!res.ok || !Array.isArray(res.data?.case_ids)) {
          warn('list cases', res, reasonOf(res));
          return null;
        }
        const pageIds = res.data.case_ids.filter((id) => typeof id === 'string');
        ids.push(...pageIds);
        offset += res.data.case_ids.length;
        if (!res.data.case_ids.length || offset >= Number(res.data.total)) return ids;
      }
      // More pages than a pilot gallery can hold: not a list to reconcile by.
      return null;
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
  const key = cleanApiKey(readEnv(env, 'AARAKSHAK_GALLERY_KEY'));
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
    info: guard(async () => (typeof inner.info === 'function' ? (await inner.info()) || null : null), null),
    listCaseIds: guard(async () => {
      const ids = typeof inner.listCaseIds === 'function' ? await inner.listCaseIds() : null;
      return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : null;
    }, null),
  };
}

/** Whether a face check says a photo is not one face of one person. */
const notOneFace = (check) => check?.verdict === 'no_face' || check?.verdict === 'multiple_faces';

/**
 * The photos of a case worth giving the gallery: an extra photo whose own
 * face check found no face or a group is left out - a group photo would
 * enrol strangers' faces under the case - and so is such a main photo when
 * a better one is there. A case with only one photo sends it as it always
 * has, and the gallery says what it makes of it.
 */
export function enrollablePhotos(photos) {
  const list = (Array.isArray(photos) ? photos : []).filter((p) => p?.buffer?.length);
  const good = list.filter((p) => !notOneFace(p.check));
  if (good.length) return good;
  // Only photos known to show no face or a group: the main one goes, as it
  // always has, and the gallery says what it makes of it. An extra alone -
  // the main photo could not be read - does not: a group photo would enrol
  // strangers' faces under the case.
  return list.filter((p) => !p.id || p.id === 'main').slice(0, 1);
}

/**
 * Enrols a case's photos and records the outcome on the case (`faceIndex`),
 * so the forward search knows which open cases the index holds and fills its
 * budget with the ones it does not (shared/match-pool.js). A refused photo is
 * recorded with the provider's reason, so the desk knows the case needs a
 * better one. No-op without an enabled provider.
 *
 * `photos` is the case's main photo as bytes, or every photo of it as
 * `[{ id, buffer, check }]`, main first (loadPhotos, shared/photo-set.js).
 * A set refused for a reason about a photo is tried again with its first
 * photo alone, so a case is never held less than before it had extras.
 */
export async function enrollCaseInIndex(faceIndex, report, photos, updateReport) {
  const index = safeFaceIndex(faceIndex);
  if (!index.enabled || !report?.id) return null;
  const given = Array.isArray(photos) ? photos : photos?.length ? [{ id: 'main', buffer: photos, check: null }] : [];
  let set = enrollablePhotos(given);
  if (!set.length) {
    if (!given.length) return null;
    // Photos were read, but none the gallery may take: the main photo could
    // not be read and the others show a group or no face. Said on the case,
    // so the desk replaces the photo and the backfill stops trying.
    const entry = { provider: index.name, status: 'failed', reason: 'photo_missing', quality: null, warnings: null, detail: null, requestId: null, photos: [], attempts: 0, at: new Date().toISOString() };
    if (typeof updateReport === 'function') updateReport(report.id, { faceIndex: entry });
    return entry;
  }
  let res = await index.enroll(report.id, set.map((p) => p.buffer));
  // Calls made, for a caller that counts them against Aarakshak's rate.
  let attempts = 1;
  const aboutAPhoto = (reason) => PHOTO_REJECTION_REASONS.has(reason) || String(reason || '').startsWith('refused_');
  if (!res?.ok && set.length > 1 && aboutAPhoto(res?.reason)) {
    set = [set[0]];
    res = await index.enroll(report.id, set.map((p) => p.buffer));
    attempts += 1;
  }
  const each = Array.isArray(res?.photos) ? res.photos : [];
  const entry = {
    provider: index.name,
    status: res?.ok ? 'enrolled' : 'failed',
    reason: res?.ok ? null : res?.reason || 'error',
    quality: Number.isFinite(res?.quality) ? res.quality : null,
    warnings: Array.isArray(res?.warnings) && res.warnings.length ? res.warnings : null,
    // Aarakshak's own words for a refusal, and the id its support asks for.
    detail: res?.ok ? null : res?.detail || null,
    requestId: res?.ok ? null : res?.requestId || null,
    // Which of the case's photos the gallery was given, and what it made of
    // each (shared/photo-set.js ids; 'main' is the main photo).
    photos: set.map((p, i) => ({
      photoId: p.id || null,
      status: each[i]?.status || (res?.ok ? 'enrolled' : null),
      faceId: each[i]?.faceId || null,
      quality: Number.isFinite(each[i]?.quality) ? each[i].quality : null,
      warnings: Array.isArray(each[i]?.warnings) && each[i].warnings.length ? each[i].warnings : null,
    })),
    attempts,
    at: new Date().toISOString(),
  };
  if (typeof updateReport === 'function') updateReport(report.id, { faceIndex: entry });
  return entry;
}

/**
 * Removes a case from the index - it was found, closed or anonymised - and
 * records that, with the provider's signed deletion receipt when it gives one.
 * Only a case the index was given is removed; no-op otherwise.
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
    receipt: res?.ok && res.receipt ? res.receipt : null,
    requestId: res?.ok ? null : res?.requestId || null,
    at: new Date().toISOString(),
  };
  if (typeof updateReport === 'function') updateReport(report.id, { faceIndex: entry });
  return entry;
}
