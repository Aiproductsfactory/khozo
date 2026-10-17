/**
 * The re-match batch: POST /api/dashboard/rematch-sightings.
 *
 * Registered by shared/routes/dashboard.js after its authentication
 * middleware, on both runtimes. The national operator runs it after a provider
 * outage, after Rekognition or a one-to-many index is switched on, or after a
 * threshold is recalibrated: it re-runs the forward search for the stored
 * sightings whose last search had no biometric answer, compared fewer open
 * cases than a search today would, or ran under other settings (the stored
 * `matchEngine.configHash`, shared/match-config.js).
 *
 * A batch is at most 20 sightings, because each one is up to 25 provider
 * calls inside one request. The caller repeats it until `remaining` is 0,
 * passing back the `since` it was given: a sighting searched since then is not
 * searched again in the same run, even if its search failed again, so the run
 * always ends.
 *
 * A sighting an officer is reviewing (linked to a case) is left alone; its
 * card has "Search again". Nobody outside the police officers of a newly
 * linked case is told anything.
 */
import { createSightingMatcher } from '../sighting-matching.js';
import { readFields } from '../case-domain.js';

export const REMATCH_BATCH_MAX = 20;
const REMATCH_BATCH_DEFAULT = 5;

function timeOf(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  const t = Number.isFinite(n) ? n : Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

export default function registerMatchingAdminRoutes(router, deps) {
  const { listFoundReports, addAudit, requireRole } = deps;
  const matcher = createSightingMatcher(deps);

  router.post('/rematch-sightings', requireRole('super_admin'), async (req, res) => {
    const read = readFields(req.body || {}, { limit: 'number', since: ['text', 40] });
    if (read.error) return res.status(400).json({ error: read.error });
    const limit = Math.max(1, Math.min(REMATCH_BATCH_MAX, Math.floor(Number(read.body.limit) || REMATCH_BATCH_DEFAULT)));
    const since = timeOf(read.body.since) || Date.now();
    const sinceIso = new Date(since).toISOString();

    const current = matcher.currentSearch();
    // Searched, or tried, since this run began: not due again in this run.
    const searchedThisRun = (f) => Math.max(timeOf(f.matchEngine?.searchedAt), timeOf(f.rematchAttemptedAt)) >= since;
    const due = () => listFoundReports()
      .filter((f) => !searchedThisRun(f) && matcher.needsRematch(f, current))
      .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));

    const batch = due().slice(0, limit);
    let processed = 0;
    let linked = 0;
    let failed = 0;
    for (const sighting of batch) {
      // eslint-disable-next-line no-await-in-loop
      const result = await matcher.rematchSighting(sighting, { trigger: 'rematch_batch', actor: req.user });
      processed += 1;
      if (!result.ok) failed += 1;
      else if (result.linked) linked += 1;
    }
    const remaining = due().length;

    addAudit({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'sightings.rematch_batch',
      targetType: 'foundReport',
      summary: `Re-ran the face search for ${processed} stored sighting${processed === 1 ? '' : 's'}: ${linked} linked for review, ${remaining} remaining`,
      scope: {},
      metadata: { processed, linked, failed, remaining, limit, since: sinceIso, configHash: current.configHash, budget: current.budget },
    });

    res.json({ processed, remaining, linked, failed, since: sinceIso, configHash: current.configHash });
  });

  return router;
}
