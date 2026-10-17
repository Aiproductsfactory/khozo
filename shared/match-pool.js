// What a face comparison is spent on, in both directions.
//
// Face comparison is one provider call per pair, so every comparison run is
// held to a fixed budget. The pairs inside that budget used to be simply the
// first ones in storage order. Once a state loaded its own register, a sighting
// in Ahmedabad could spend the whole budget on Mumbai cases and never be
// compared with the Ahmedabad children at all.
//
// The budget is now spent nearest-first: records from the same district, then
// the same state, then everywhere else. Within each tier a record whose sex and
// plausible age today fit the other side comes before one that does not (a
// soft tie-break, never a filter: a reporter's guess at a stranger's age is
// exactly the judgement that must not narrow a search), then most recent first.
// The tally is returned so the engine can say how many records were not
// compared, rather than implying the search covered everything.
//
// With a one-to-many face index configured (shared/face-index.js) the forward
// budget is spent on the index's shortlist first instead, in the index's order.
//
//   selectMatchCandidates    a new sighting  -> the open cases it is compared with
//   selectSightingCandidates a new case      -> the stored sightings (and open
//                                               found-child intakes) it is
//                                               compared with
//
// Pure, and free of Node built-ins, so the console imports expectedAgeAt too.
import { sameDistrict } from './scope.js';

const norm = (v) => String(v || '').trim().toLowerCase();
const YEAR_MS = 365.25 * 86400000;

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

/** A number, or null for blank / non-numeric. `Number(null)` is 0, which is an age. */
function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The age a missing person would be at `at`: their age when they went missing
 * plus the years since. A child reported missing at 9 in 2019 is about 16 now,
 * and a sighting of a 16-year-old must not be ranked as a poor fit for her.
 * Null when the case has no age.
 */
export function expectedAgeAt(report, at = Date.now()) {
  const age = numberOrNull(report?.age);
  if (age == null) return null;
  const since = Date.parse(report?.dateOfMissing || '') || timeOf(report?.createdAt);
  const when = timeOf(at) || Date.now();
  if (!since || when <= since) return Math.floor(age);
  return Math.floor(age + (when - since) / YEAR_MS);
}

function sexOf(value) {
  const v = norm(value);
  if (v === 'male' || v === 'm') return 'male';
  if (v === 'female' || v === 'f') return 'female';
  return null;
}

/**
 * How badly two descriptions disagree: 0 (fit, or unknown), +1 for opposite
 * recorded sexes, +1 for ages further apart than a stranger's estimate can be
 * trusted (four years, or a quarter of the age, whichever is wider).
 */
function fitPenalty(a = {}, b = {}) {
  let penalty = 0;
  const x = sexOf(a.gender);
  const y = sexOf(b.gender);
  if (x && y && x !== y) penalty += 1;
  const ageA = numberOrNull(a.age);
  const ageB = numberOrNull(b.age);
  if (ageA != null && ageB != null) {
    const tolerance = Math.max(4, Math.min(ageA, ageB) * 0.25);
    if (Math.abs(ageA - ageB) > tolerance) penalty += 1;
  }
  return penalty;
}

/**
 * Ranks `rows` nearest-first against `hints` and keeps the first `max`.
 * `fit(row)` is the soft tie-break inside a tier (lower first).
 * Returns the kept rows with their tier, and the tally per tier.
 */
function spendBudget(rows, hints, when, max, fallbackMax, fit = () => 0) {
  const state = norm(hints.state);
  const district = hints.district;

  const tierOf = (row) => {
    const inState = state && norm(row.state) === state;
    if (inState && district && sameDistrict(row.district, district)) return 0;
    if (inState) return 1;
    return 2;
  };

  const ranked = rows
    .map((row) => ({ row, tier: tierOf(row), fit: fit(row), when: when(row) }))
    .sort((a, b) => a.tier - b.tier || a.fit - b.fit || b.when - a.when);

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

/**
 * A record of a child found and taken into care (POST /found/:id/formal-
 * intake), not of a child someone is looking for. A sighting of a missing
 * child is never compared with one; a newly registered missing case is
 * (selectSightingCandidates).
 */
export function isFoundChildIntake(report) {
  return report?.caseOrigin === 'found_child_intake';
}

/** Case statuses that take a case out of the search: the person is no longer missing. */
const CLOSED_CASE_STATUSES = new Set(['found', 'closed']);

/** Whether a case is one a new sighting may be compared with. */
export function isForwardPoolCase(report) {
  return Boolean(
    report &&
    report.photoFile &&
    !report.anonymizedAt &&
    !CLOSED_CASE_STATUSES.has(report.status) &&
    !isUnverifiedIntake(report) &&
    !isFoundChildIntake(report)
  );
}

function idSet(values) {
  if (!values) return new Set();
  if (values instanceof Set) return values;
  return new Set((Array.isArray(values) ? values : [values]).filter(Boolean));
}

/** Whether a case is in the one-to-many index this search used. */
function isIndexed(report, provider) {
  return Boolean(provider) && report?.faceIndex?.provider === provider && report.faceIndex.status === 'enrolled';
}

/**
 * The open cases a sighting is compared with.
 *
 * `hints`: `state`, `district` (where the reporter was), `gender`,
 * `ageApprox` (the reporter's estimate), `excludeReportIds` (cases an officer
 * already rejected for this sighting: never proposed again), and, when a
 * one-to-many index answered, `shortlist` (case ids in the index's order) and
 * `indexProvider`. A shortlist is spent first; open cases the index does not
 * hold yet (registered before it was switched on) fill what budget remains,
 * nearest-first, so switching an index on never shrinks the search.
 */
export function selectMatchCandidates(reports = [], hints = {}, max = 25, now = Date.now()) {
  const excluded = idSet(hints.excludeReportIds);
  const open = reports.filter((r) => isForwardPoolCase(r) && !excluded.has(r.id));
  const sighting = { gender: hints.gender, age: hints.ageApprox };
  const fit = (r) => fitPenalty(sighting, { gender: r.gender, age: expectedAgeAt(r, now) });
  const limit = Math.max(1, Number(max) || 25);

  if (Array.isArray(hints.shortlist)) {
    const byId = new Map(open.map((r) => [r.id, r]));
    const fromIndex = [];
    const seen = new Set();
    for (const id of hints.shortlist) {
      const row = byId.get(id);
      if (row && !seen.has(id)) {
        fromIndex.push(row);
        seen.add(id);
      }
      if (fromIndex.length >= limit) break;
    }
    const unindexed = open.filter((r) => !seen.has(r.id) && !isIndexed(r, hints.indexProvider));
    const rest = limit - fromIndex.length > 0
      ? spendBudget(unindexed, hints, missingTime, limit - fromIndex.length, limit, fit).selected
      : [];
    const selected = [...fromIndex, ...rest];
    return {
      reports: selected,
      pool: {
        openWithPhotos: open.length,
        compared: selected.length,
        notCompared: Math.max(0, open.length - selected.length),
        limit,
        source: 'index',
        indexHits: hints.shortlist.length,
        fromIndex: fromIndex.length,
        unindexed: rest.length,
      },
    };
  }

  const { selected, tally } = spendBudget(open, hints, missingTime, limit, 25, fit);
  return {
    reports: selected,
    pool: { openWithPhotos: open.length, ...tally, source: 'budget' },
  };
}

/**
 * Sighting statuses an officer has closed. A sighting reviewed and closed is
 * not reopened by a machine.
 */
const CLOSED_SIGHTING_STATUSES = new Set(['rejected', 'matched']);

/**
 * The cases an officer has turned down for this sighting, in either direction:
 * a rejected or referred link is recorded in `rejectedLinks` (and the
 * candidate marked rejected), and that pair is never proposed again.
 */
export function rejectedReportIds(sighting) {
  const ids = new Set();
  for (const link of Array.isArray(sighting?.rejectedLinks) ? sighting.rejectedLinks : []) {
    if (link?.reportId) ids.add(link.reportId);
  }
  for (const candidate of Array.isArray(sighting?.matchCandidates) ? sighting.matchCandidates : []) {
    if (candidate?.status === 'rejected' && candidate.reportId) ids.add(candidate.reportId);
  }
  return ids;
}

/** Whether an officer has already turned down the link between this sighting and this case. */
export function wasLinkRejected(sighting, reportId) {
  if (!reportId) return false;
  return rejectedReportIds(sighting).has(reportId);
}

function withinRetention(record, now) {
  const until = timeOf(record?.retentionUntil);
  return !until || until >= now;
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
 *     face screen found no person in.
 *
 * Its category (child / woman / adult) is deliberately not a filter, for the
 * same reason the forward search ignores it: a reporter's guess at "child" or
 * "woman" for a sixteen-year-old must not narrow the search.
 */
export function isReverseMatchCandidate(sighting, now = Date.now()) {
  if (!sighting?.photoFile) return false;
  if (sighting.matchedReportId) return false;
  if (sighting.anonymizedAt) return false;
  if (!withinRetention(sighting, now)) return false;
  if (CLOSED_SIGHTING_STATUSES.has(sighting.status)) return false;
  if (sighting.cwcFollowup?.outcome === 'duplicate_or_invalid') return false;
  if (sighting.screening?.verdict === 'no_person') return false;
  return true;
}

/**
 * Whether a stored sighting's forward search may be run again (POST
 * /found/:id/rematch, and the re-match batch): the same open-question rule as
 * the reverse search, except that a screen which found "no person" does not
 * rule it out. That verdict came from one engine, and a re-match is exactly
 * how a second engine gets to look.
 */
export function isRematchEligible(sighting, now = Date.now()) {
  if (!sighting?.photoFile) return false;
  if (sighting.anonymizedAt) return false;
  if (!withinRetention(sighting, now)) return false;
  if (CLOSED_SIGHTING_STATUSES.has(sighting.status)) return false;
  if (sighting.cwcFollowup?.outcome === 'duplicate_or_invalid') return false;
  return true;
}

/**
 * An open record of a found child in care, as the reverse search compares it.
 * Its photo is a copy of the sighting's, kept for the case retention period,
 * so the child stays findable after the sighting's own retention runs out.
 */
export function isOpenFoundChildIntake(report) {
  return Boolean(
    isFoundChildIntake(report) &&
    report.photoFile &&
    !report.anonymizedAt &&
    !CLOSED_CASE_STATUSES.has(report.status) &&
    report.sourceFoundReportId
  );
}

/**
 * Which stored sightings a newly registered case's photo is compared against:
 * the eligible ones (see isReverseMatchCandidate), plus each open found-child
 * intake whose sighting is not itself eligible any more (its retention ran
 * out, or the screen said "no person" before an officer took the child into
 * care). An intake stands in for its sighting: a match links that sighting.
 *
 * Nearest the case's own district and state first, then by how well the
 * sighting's sex and estimated age fit the case's (its age at missing plus the
 * years to the sighting), then most recently reported, held to `max`
 * comparisons (KHOZO_REVERSE_MATCH_CANDIDATES, default 50). `hints.reportId`,
 * when given, leaves out the sightings an officer already rejected for that
 * case; `hints.subject` is the case, for the tie-break.
 */
export function selectSightingCandidates(foundReports = [], hints = {}, max = 50, now = Date.now(), { intakeReports = [] } = {}) {
  const eligible = foundReports.filter((f) => isReverseMatchCandidate(f, now) && !wasLinkRejected(f, hints.reportId));
  const eligibleIds = new Set(eligible.map((f) => f.id));
  const sightingsById = new Map(foundReports.map((f) => [f.id, f]));
  const standIns = intakeReports.filter((r) => {
    if (!isOpenFoundChildIntake(r) || r.id === hints.reportId) return false;
    if (eligibleIds.has(r.sourceFoundReportId)) return false;
    const source = sightingsById.get(r.sourceFoundReportId);
    return Boolean(source) && !source.matchedReportId && !CLOSED_SIGHTING_STATUSES.has(source.status) && !wasLinkRejected(source, hints.reportId);
  });
  const subject = hints.subject || null;
  const fit = (row) => {
    if (!subject) return 0;
    const at = timeOf(row.createdAt) || now;
    const rowAge = isFoundChildIntake(row) ? row.age : row.ageApprox;
    return fitPenalty({ gender: subject.gender, age: expectedAgeAt(subject, at) }, { gender: row.gender, age: rowAge });
  };
  const rows = [...eligible, ...standIns];
  const { selected, tally } = spendBudget(rows, hints, (f) => timeOf(f.createdAt), max, 50, fit);
  return {
    sightings: selected,
    pool: { eligibleWithPhotos: rows.length, foundChildIntakes: standIns.length, ...tally },
  };
}
