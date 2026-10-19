/**
 * The one-to-many face index, for the national desk:
 *
 *   GET  /api/dashboard/face-index           what the gallery holds, and the
 *                                            open cases it does not
 *   POST /api/dashboard/face-index/backfill  one batch of the work that brings
 *                                            the gallery in line with the cases
 *
 * Registered by shared/routes/dashboard.js after its authentication
 * middleware, on both runtimes. Both answer `{ enabled: false }` and do
 * nothing while no index is configured (shared/face-index.js).
 *
 * A batch removes first and enrols second, so a found or closed child's face
 * never waits behind a backfill:
 *   1. removes the faces of cases that are no longer open (found, closed,
 *      anonymised, a removal that failed) and Khozo case ids the gallery holds
 *      for no case on file;
 *   2. enrols open, verified cases with a photo that the gallery does not hold:
 *      never enrolled, enrolled before the index was switched on, a failure
 *      worth retrying (no answer, rate-limited, 5xx), or marked enrolled but
 *      missing from the gallery's own list.
 * A photo Aarakshak refused (no face, several faces, too small) is not sent
 * again; the case is listed as needing a better photo, and replacing the
 * photo enrols it (POST /api/reports/:id/photo). A photo refused for any
 * other reason is sent again only when the batch is asked to
 * (`retryRefused: true`), for instance once Aarakshak has fixed a fault, or
 * to learn a reason that was not recorded.
 *
 * Aarakshak's pilot allows 30 requests a minute per key, shared with live
 * searches. A batch is at most 20 calls, stops at the first 429, and says how
 * long to wait before the next (`waitMs`), which keeps a backfill near 20 a
 * minute. The caller repeats it until `remaining` is 0, passing back `since`:
 * a case tried since then is not tried again in the same run, so the run ends.
 */
import { isForwardPoolCase } from '../match-pool.js';
import {
  PHOTO_REJECTION_REASONS,
  WEAK_FACE_WARNINGS,
  enrollCaseInIndex,
  isRetryableIndexFailure,
  removeCaseFromIndex,
  safeFaceIndex,
} from '../face-index.js';
import { readFields } from '../case-domain.js';
import { loadPhotos } from '../photo-set.js';

export const INDEX_BATCH_MAX = 20;
const INDEX_BATCH_DEFAULT = 10;
const MS_PER_CALL = 3000;
const RATE_LIMITED_WAIT_MS = 60000;
// A face enrolled this recently may not be in the gallery's list yet.
const LIST_SETTLE_MS = 60000;
// Gallery ids Khozo knows nothing about, when most of the gallery is such ids,
// say more about the list of cases this request loaded than about the
// gallery: none is removed.
const UNKNOWN_GUARD_MIN = 10;
// The shape of a Khozo case id (shared/routes/reports.js). Anything else in
// the gallery is not Khozo's to remove.
const KHOZO_CASE_ID = /^r_[A-Za-z0-9_-]{4,40}$/;

function timeOf(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  const t = Number.isFinite(n) ? n : Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/** Whether a refused enrolment needs a new photo rather than another try. */
const needsPhoto = (reason) => PHOTO_REJECTION_REASONS.has(reason) || reason === 'photo_missing';

/**
 * Where a case stands with the index `provider`:
 *   enrolled     open, and in the gallery
 *   pending      open, and due to be enrolled
 *   needs_photo  open, and its photo was refused
 *   refused      open, and enrolment was refused for another reason
 *   to_remove    no longer open, and its face may still be in the gallery
 *   out          neither open nor in the gallery
 */
export function indexStateOf(report, provider) {
  const entry = report?.faceIndex?.provider === provider ? report.faceIndex : null;
  if (!isForwardPoolCase(report)) {
    return entry && (entry.status === 'enrolled' || entry.status === 'remove_failed') ? 'to_remove' : 'out';
  }
  if (!entry) return 'pending';
  if (entry.status === 'enrolled') return 'enrolled';
  if (entry.status === 'failed') {
    if (needsPhoto(entry.reason)) return 'needs_photo';
    if (!isRetryableIndexFailure(entry.reason)) return 'refused';
  }
  return 'pending';
}

export default function registerFaceIndexAdminRoutes(router, deps) {
  const { listReports, findReport, updateReport, readPhoto, addAudit, requireRole } = deps;
  const index = safeFaceIndex(deps.faceIndex);

  function tally(reports, galleryIds = null, now = Date.now()) {
    const inGallery = galleryIds ? new Set(galleryIds) : null;
    const counts = { open: 0, enrolled: 0, weak: 0, pending: 0, needsPhoto: 0, refused: 0, toRemove: 0, missingFromGallery: 0 };
    const rows = { pending: [], needsPhoto: [], refused: [], toRemove: [] };
    for (const report of reports) {
      let state = indexStateOf(report, index.name);
      if (state === 'enrolled' && inGallery && !inGallery.has(report.id) && now - timeOf(report.faceIndex?.at) > LIST_SETTLE_MS) {
        counts.missingFromGallery += 1;
        state = 'pending';
      }
      if (state !== 'out' && state !== 'to_remove') counts.open += 1;
      if (state === 'enrolled') {
        counts.enrolled += 1;
        // In the gallery, but with a face Aarakshak could barely use.
        if ((report.faceIndex?.warnings || []).some((w) => WEAK_FACE_WARNINGS.has(w))) counts.weak += 1;
      } else if (state === 'pending') {
        counts.pending += 1;
        rows.pending.push(report);
      } else if (state === 'needs_photo') {
        counts.needsPhoto += 1;
        rows.needsPhoto.push(report);
      } else if (state === 'refused') {
        counts.refused += 1;
        rows.refused.push(report);
      } else if (state === 'to_remove') {
        counts.toRemove += 1;
        rows.toRemove.push(report);
      }
    }
    return { counts, rows };
  }

  // Khozo case ids the gallery holds that are not open cases: closed ones are
  // removed with their record; ids with no case on file are removed unless
  // they are most of the gallery (see UNKNOWN_GUARD_MIN).
  function strays(reports, galleryIds) {
    if (!galleryIds) return { closed: [], unknown: [], guarded: false };
    const byId = new Map(reports.map((r) => [r.id, r]));
    const closed = [];
    const unknown = [];
    for (const id of galleryIds) {
      if (!KHOZO_CASE_ID.test(id)) continue;
      const report = byId.get(id);
      if (!report) unknown.push(id);
      else if (!isForwardPoolCase(report)) closed.push(report);
    }
    const guarded = unknown.length >= UNKNOWN_GUARD_MIN && unknown.length * 2 > galleryIds.length;
    return { closed, unknown: guarded ? [] : unknown, guarded, unknownCount: unknown.length };
  }

  router.get('/face-index', requireRole('super_admin'), async (_req, res) => {
    if (!index.enabled) return res.json({ provider: index.name, enabled: false });
    const [gallery, galleryIds] = await Promise.all([index.info(), index.listCaseIds()]);
    const reports = listReports();
    const { counts, rows } = tally(reports, galleryIds);
    const stray = strays(reports, galleryIds);
    res.json({
      provider: index.name,
      enabled: true,
      gallery,
      reconciled: Boolean(galleryIds),
      counts: { ...counts, strays: stray.closed.length + (stray.unknownCount || 0) },
      // Case ids and the provider's reason only: the desk opens the case.
      needsPhoto: rows.needsPhoto.slice(0, 200).map((r) => ({ id: r.id, reason: r.faceIndex?.reason || null, at: r.faceIndex?.at || null })),
      refused: rows.refused.slice(0, 200).map((r) => ({
        id: r.id,
        reason: r.faceIndex?.reason || null,
        detail: r.faceIndex?.detail || null,
        requestId: r.faceIndex?.requestId || null,
        at: r.faceIndex?.at || null,
      })),
    });
  });

  router.post('/face-index/backfill', requireRole('super_admin'), async (req, res) => {
    if (!index.enabled) return res.json({ enabled: false, processed: 0, remaining: 0 });
    const read = readFields(req.body || {}, { limit: 'number', since: ['text', 40], retryRefused: 'flag' });
    if (read.error) return res.status(400).json({ error: read.error });
    const limit = Math.max(1, Math.min(INDEX_BATCH_MAX, Math.floor(Number(read.body.limit) || INDEX_BATCH_DEFAULT)));
    const retryRefused = read.body.retryRefused === true || read.body.retryRefused === 'true';
    // Open cases due for enrolment: those the gallery lacks, and, when asked,
    // those whose photo was refused for a reason other than the face.
    const dueForEnrolment = (rows) => (retryRefused ? [...rows.pending, ...rows.refused] : rows.pending);
    const since = timeOf(read.body.since) || Date.now();
    const sinceIso = new Date(since).toISOString();
    const started = Date.now();
    // Tried since the run began, except a try the rate limit stopped: that
    // one is due again once the caller has waited.
    const triedThisRun = (r) =>
      r?.faceIndex?.provider === index.name && timeOf(r.faceIndex.at) >= since && r.faceIndex.reason !== 'rate_limited';

    let calls = 0;
    let enrolled = 0;
    let removed = 0;
    let failed = 0;
    let rejected = 0;
    let rateLimited = false;
    const budget = () => limit - enrolled - removed - failed - rejected;

    const galleryIds = await index.listCaseIds();
    calls += 1;
    const inGallery = galleryIds ? new Set(galleryIds) : null;
    const reports = listReports();
    const stray = strays(reports, galleryIds);
    const removedUnknown = new Set();

    // 1. Faces that should no longer be in the gallery.
    const toRemove = [
      ...tally(reports).rows.toRemove,
      ...stray.closed.filter((r) => indexStateOf(r, index.name) !== 'to_remove'),
    ].filter((r) => !triedThisRun(r));
    for (const report of toRemove) {
      if (budget() <= 0 || rateLimited) break;
      // The gallery's own list says it is not there: recorded as removed
      // without spending a call.
      if (inGallery && !inGallery.has(report.id) && Date.now() - timeOf(report.faceIndex?.at) > LIST_SETTLE_MS) {
        updateReport(report.id, {
          faceIndex: { provider: index.name, status: 'removed', reason: null, receipt: null, requestId: null, at: new Date().toISOString() },
        });
        removed += 1;
        continue;
      }
      // A record that never says it was enrolled: removed all the same, and
      // recorded as removed.
      const known = report.faceIndex?.provider === index.name && report.faceIndex.status !== 'removed'
        ? report
        : { ...report, faceIndex: { provider: index.name, status: 'enrolled' } };
      // eslint-disable-next-line no-await-in-loop
      const entry = await removeCaseFromIndex(index, known, updateReport);
      calls += 1;
      if (entry?.status === 'removed') removed += 1;
      else {
        failed += 1;
        if (entry?.reason === 'rate_limited') rateLimited = true;
      }
    }
    for (const id of stray.unknown) {
      if (budget() <= 0 || rateLimited) break;
      // eslint-disable-next-line no-await-in-loop
      const result = await index.remove(id);
      calls += 1;
      if (result?.ok) {
        removed += 1;
        removedUnknown.add(id);
      } else {
        failed += 1;
        if (result?.reason === 'rate_limited') rateLimited = true;
        // Not on file, so nowhere to record that it was tried: the batch stops
        // here rather than retrying it in a loop.
        break;
      }
    }

    // 2. Open cases the gallery does not hold, the most recently registered
    // first.
    const pending = dueForEnrolment(tally(reports, galleryIds).rows)
      .filter((r) => !triedThisRun(r))
      .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
    for (const report of pending) {
      if (budget() <= 0 || rateLimited) break;
      // Every photo of the case, the main one first (shared/photo-set.js).
      // eslint-disable-next-line no-await-in-loop
      const photos = await loadPhotos(report, readPhoto).catch(() => []);
      if (!photos.length) {
        updateReport(report.id, { faceIndex: { provider: index.name, status: 'failed', reason: 'photo_missing', at: new Date().toISOString() } });
        rejected += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const entry = await enrollCaseInIndex(index, findReport(report.id) || report, photos, updateReport);
      calls += 1;
      if (entry?.status === 'enrolled') enrolled += 1;
      else if (entry && !isRetryableIndexFailure(entry.reason)) rejected += 1;
      else {
        failed += 1;
        if (entry?.reason === 'rate_limited') rateLimited = true;
      }
    }

    // What is left for this run.
    const after = listReports();
    const remaining =
      tally(after).rows.toRemove.filter((r) => !triedThisRun(r)).length +
      dueForEnrolment(tally(after, galleryIds).rows).filter((r) => !triedThisRun(r)).length +
      stray.unknown.filter((id) => !removedUnknown.has(id)).length;

    const processed = enrolled + removed + failed + rejected;
    const waitMs = rateLimited ? RATE_LIMITED_WAIT_MS : Math.max(0, calls * MS_PER_CALL - (Date.now() - started));

    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'face_index.backfill',
      targetType: 'report',
      summary: `Face index batch: ${enrolled} enrolled, ${removed} removed, ${rejected} refused, ${failed} failed, ${remaining} remaining`,
      scope: {},
      metadata: {
        provider: index.name,
        enrolled,
        removed,
        rejected,
        failed,
        rateLimited,
        remaining,
        reconciled: Boolean(galleryIds),
        unknownGuarded: stray.guarded,
        retryRefused,
        limit,
        since: sinceIso,
      },
    });

    res.json({
      enabled: true,
      processed,
      enrolled,
      removed,
      rejected,
      failed,
      rateLimited,
      remaining,
      reconciled: Boolean(galleryIds),
      unknownGuarded: stray.guarded,
      waitMs,
      since: sinceIso,
    });
  });

  return router;
}
