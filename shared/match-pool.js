// What a face comparison is spent on, in both directions.
//
// Face comparison is one provider call per pair, so every comparison run is
// held to a fixed budget. The pairs inside that budget used to be simply the
// first ones in storage order. Once a state loaded its own register, a sighting
// in Ahmedabad could spend the whole budget on Mumbai cases and never be
// compared with the Ahmedabad children at all.
//
// The budget is now spent nearest-first: records from the same district, then
// the same state, then everywhere else, most recent first within each tier.
// The tally is returned so the engine can say how many records were not
// compared, rather than implying the search covered everything.
//
//   selectMatchCandidates   a new sighting  -> the open cases it is compared with
//   selectSightingCandidates a new case     -> the stored sightings it is compared with
import { sameDistrict } from './scope.js';

const norm = (v) => String(v || '').trim().toLowerCase();

/** A stored timestamp (epoch ms, numeric string or ISO date) as epoch ms, or 0. */
function timeOf(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  const t = Number.isFinite(n) ? n : Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function missingTime(report) {
  const t = Date.parse(report.dateOfMissing || '') || Number(report.createdAt) || 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Ranks `rows` nearest-first against `hints` and keeps the first `max`.
 * Returns the kept rows with their tier, and the tally per tier.
 */
function spendBudget(rows, hints, when, max, fallbackMax) {
  const state = norm(hints.state);
  const district = hints.district;

  const tierOf = (row) => {
    const inState = state && norm(row.state) === state;
    if (inState && district && sameDistrict(row.district, district)) return 0;
    if (inState) return 1;
    return 2;
  };

  const ranked = rows
    .map((row) => ({ row, tier: tierOf(row), when: when(row) }))
    .sort((a, b) => a.tier - b.tier || b.when - a.when);

  const limit = Math.max(1, Number(max) || fallbackMax);
  const selected = ranked.slice(0, limit);
  const count = (tier) => selected.filter((entry) => entry.tier === tier).length;
  return {
    selected: selected.map((entry) => entry.row),
    tally: {
      compared: selected.length,
      notCompared: Math.max(0, rows.length - selected.length),
      sameDistrict: count(0),
      sameState: count(1),
      elsewhere: count(2),
      limit,
    },
  };
}

/**
 * A case registered by a parent or NGO that no officer has verified yet.
 *
 * Not compared with sightings until it is verified (verify-intake then runs the
 * reverse search over everything that arrived meanwhile). Anyone can register
 * as a parent or NGO, so an unverified intake is a photograph and a district
 * chosen by a stranger: comparing it would let them have a face watched for
 * without any officer involved.
 */
function isUnverifiedIntake(report) {
  return report?.status === 'intake_pending' || report?.intakeStatus === 'pending_verification';
}

export function selectMatchCandidates(reports = [], hints = {}, max = 25) {
  const open = reports.filter(
    (r) => r.status !== 'found' && !r.anonymizedAt && r.photoFile && !isUnverifiedIntake(r)
  );
  const { selected, tally } = spendBudget(open, hints, missingTime, max, 25);
  return {
    reports: selected,
    pool: { openWithPhotos: open.length, ...tally },
  };
}

/**
 * Sighting statuses an officer has closed. A sighting reviewed and closed is
 * not reopened by a machine.
 */
const CLOSED_SIGHTING_STATUSES = new Set(['rejected', 'matched']);

/**
 * Whether an officer has already turned down the link between this sighting
 * and this case. A rejected reverse link puts the sighting back where it was
 * (shared/routes/reports.js) and records the case here, so the next search for
 * the same case does not propose the same lookalike again.
 */
export function wasLinkRejected(sighting, reportId) {
  if (!reportId || !Array.isArray(sighting?.rejectedLinks)) return false;
  return sighting.rejectedLinks.some((link) => link?.reportId === reportId);
}

/**
 * Whether a stored sighting may be compared with a newly registered case.
 *
 * A sighting is a candidate while it is still an open question who the person
 * in it is:
 *   - it has a photo (there is nothing to compare otherwise);
 *   - it is not already linked to a case (`matchedReportId`): one sighting is
 *     one person, and an officer is already looking at that link;
 *   - it has not been anonymised, and its retention period has not run out;
 *     a photo kept past its retention date is not one Khozo may still use;
 *   - it has not been closed by an officer, or closed as not showing a
 *     person: a CWC follow-up recorded as duplicate / invalid, or a photo the
 *     face screen found no person in (both engines answer that the same way,
 *     so comparing it again only spends the budget).
 *
 * Its category (child / woman / adult) is deliberately not a filter, for the
 * same reason the forward search ignores it: a reporter's guess at "child" or
 * "woman" for a sixteen-year-old must not narrow the search.
 */
export function isReverseMatchCandidate(sighting, now = Date.now()) {
  if (!sighting?.photoFile) return false;
  if (sighting.matchedReportId) return false;
  if (sighting.anonymizedAt) return false;
  const until = timeOf(sighting.retentionUntil);
  if (until && until < now) return false;
  if (CLOSED_SIGHTING_STATUSES.has(sighting.status)) return false;
  if (sighting.cwcFollowup?.outcome === 'duplicate_or_invalid') return false;
  if (sighting.screening?.verdict === 'no_person') return false;
  return true;
}

/**
 * Which stored sightings a newly registered case's photo is compared against:
 * the eligible ones (see isReverseMatchCandidate), nearest the case's own
 * district and state first, most recently reported first within each tier,
 * held to `max` comparisons (KHOZO_REVERSE_MATCH_CANDIDATES, default 50).
 * `hints.reportId`, when given, leaves out the sightings an officer already
 * rejected for that case.
 */
export function selectSightingCandidates(foundReports = [], hints = {}, max = 50, now = Date.now()) {
  const eligible = foundReports.filter((f) => isReverseMatchCandidate(f, now) && !wasLinkRejected(f, hints.reportId));
  const { selected, tally } = spendBudget(eligible, hints, (f) => timeOf(f.createdAt), max, 50);
  return {
    sightings: selected,
    pool: { eligibleWithPhotos: eligible.length, ...tally },
  };
}
