/**
 * Acting on retention dates (DPIA G3).
 *
 * Every case and sighting carries a `retentionUntil`. Until now nothing acted
 * on it: an expired record was marked "expired" in the privacy queue and kept
 * as it was. This module decides what a date passing means, and carries it
 * out the same way the privacy officer's "Anonymise" button does.
 *
 * The rules (docs/governance/retention-schedule.md):
 *
 *   A sighting past its date is anonymised and its photo deleted, unless it
 *   was escalated: a match an officer confirmed, or a link still waiting for
 *   an officer on an open case. An escalated sighting is kept as long as the
 *   case it belongs to ("retained for 180 days unless escalated", as the
 *   upload form tells the citizen).
 *
 *   A case past its date is anonymised only once it is closed or found. An
 *   open case is a person still missing; it is never removed by a clock. It is
 *   flagged for the nodal officer's review instead.
 *
 * Who runs it:
 *
 *   The Worker's nightly cron (worker/src/ops.js) plans a sweep every night
 *   and tells the super admins what is due. It anonymises only when the
 *   deployment sets KHOZO_RETENTION_ENFORCE=on: the Department approves the
 *   schedule before a machine deletes anything.
 *
 *   A super admin can run the same sweep from the console
 *   (POST /api/dashboard/privacy/retention-sweep), as a dry run or, with an
 *   approval reference, for real.
 */
import { removeCaseFromIndex } from './face-index.js';
import { anonymisedLabel, anonymisedReportPatch, anonymisedSightingPatch } from './privacy.js';

const DAY_MS = 86400000;
const CLOSED_CASE = new Set(['found', 'closed']);

function timeOf(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  const t = Number.isFinite(n) ? n : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

const isOpenCase = (report) => Boolean(report) && !report.anonymizedAt && !CLOSED_CASE.has(report.status);

/**
 * Why a sighting past its date is kept, and with which case, or null when it
 * is not: `{ reason, caseId }`. `casesById` maps case ids to cases.
 *
 *   confirmed_match              an officer confirmed it matches a case
 *   linked_to_open_case          a link waiting on an officer, for an open case
 *   intake_relies_on_sighting_photo
 *                                a found-child intake opened from it has no
 *                                photo of its own (intakes made before photos
 *                                were copied, or a copy that failed) and shows
 *                                the sighting's: deleting it would leave a
 *                                child in care with no photograph
 */
export function sightingEscalation(sighting, casesById) {
  const intake = sighting.formalReportId ? casesById.get(sighting.formalReportId) : null;
  if (intake && isOpenCase(intake) && !intake.photoFile) {
    return { reason: 'intake_relies_on_sighting_photo', caseId: intake.id };
  }
  if (sighting.status === 'matched' && sighting.matchedReportId) return { reason: 'confirmed_match', caseId: sighting.matchedReportId };
  const linked = sighting.matchedReportId ? casesById.get(sighting.matchedReportId) : null;
  if (linked && isOpenCase(linked) && sighting.status === 'pending_review') return { reason: 'linked_to_open_case', caseId: linked.id };
  return null;
}

/**
 * What a sweep at `now` would do. Pure: reads the records, changes nothing.
 *
 *   sightings.anonymise   expired, not escalated
 *   sightings.extend      expired but escalated: kept with their case
 *   cases.anonymise       expired and closed or found
 *   cases.review          expired but still open: a person still missing
 *   dueSoon               not expired, but within `dueSoonDays`
 */
export function planRetention({ reports = [], foundReports = [], now = Date.now(), dueSoonDays = 30 } = {}) {
  const casesById = new Map(reports.map((r) => [r.id, r]));
  const plan = {
    at: new Date(now).toISOString(),
    sightings: { anonymise: [], extend: [] },
    cases: { anonymise: [], review: [] },
    dueSoon: { sightings: 0, cases: 0 },
  };
  const soon = now + dueSoonDays * DAY_MS;

  for (const f of foundReports) {
    if (!f || f.anonymizedAt) continue;
    const until = timeOf(f.retentionUntil);
    if (until == null) continue;
    if (until > now) {
      if (until <= soon) plan.dueSoon.sightings += 1;
      continue;
    }
    // An escalated sighting lives as long as its case: to the case's own
    // date, or (for a case still open past that date, which is under review)
    // another 180 days. One whose case has itself ended goes with it.
    const escalation = sightingEscalation(f, casesById);
    const linked = escalation ? casesById.get(escalation.caseId) : null;
    const linkedUntil = timeOf(linked?.retentionUntil);
    const caseLives = linked && !linked.anonymizedAt && (isOpenCase(linked) || (linkedUntil != null && linkedUntil > now));
    if (escalation && caseLives) {
      const until = linkedUntil != null && linkedUntil > now ? linked.retentionUntil : new Date(now + 180 * DAY_MS).toISOString();
      plan.sightings.extend.push({ id: f.id, reason: escalation.reason, caseId: linked.id, until });
    } else {
      plan.sightings.anonymise.push({ id: f.id, reason: escalation ? 'case_ended' : 'retention_expired' });
    }
  }

  for (const r of reports) {
    if (!r || r.anonymizedAt) continue;
    const until = timeOf(r.retentionUntil);
    if (until == null) continue;
    if (until > now) {
      if (until <= soon) plan.dueSoon.cases += 1;
      continue;
    }
    if (isOpenCase(r)) plan.cases.review.push({ id: r.id, reason: 'open_case_past_retention' });
    else plan.cases.anonymise.push({ id: r.id, reason: 'retention_expired' });
  }
  return plan;
}

/** Counts, for alerts and audit rows. */
export function planSummary(plan) {
  return {
    sightingsToAnonymise: plan.sightings.anonymise.length,
    sightingsKeptWithCase: plan.sightings.extend.length,
    casesToAnonymise: plan.cases.anonymise.length,
    openCasesToReview: plan.cases.review.length,
    dueSoonSightings: plan.dueSoon.sightings,
    dueSoonCases: plan.dueSoon.cases,
  };
}

/**
 * Anonymises one case the way the privacy officer's button does: the
 * allow-list patch, out of the face index, the photograph deleted, and the
 * activity feed rewritten. Returns the patch. The caller writes the audit row.
 */
export async function anonymiseCase(deps, report, { now = Date.now(), approval = null } = {}) {
  // A store may update the record in place, so what is about to be cleared
  // is read first.
  const before = { ...report, faceIndex: report.faceIndex ? { ...report.faceIndex } : report.faceIndex };
  const patch = anonymisedReportPatch(before, { now, approval });
  deps.updateReport(before.id, patch);
  await removeCaseFromIndex(deps.faceIndex, before, deps.updateReport);
  if (before.photoFile && typeof deps.deletePhoto === 'function') {
    await Promise.resolve(deps.deletePhoto(before.photoFile)).catch(() => false);
  }
  if (typeof deps.rewriteActivity === 'function') {
    const label = anonymisedLabel('report', before.id);
    // A parent or NGO who registered the case is named as the actor of its
    // rows; officers are not data subjects here and stay named.
    const citizenActor = ['parent', 'ngo'].includes(before.registeredByRole) ? before.registeredById : null;
    const names = [before.childName, before.parentName].filter((n) => typeof n === 'string' && n.trim().length >= 2);
    deps.rewriteActivity((row) => {
      if (row?.scope?.reportId !== before.id) return null;
      const change = { target: label };
      if ((citizenActor && row.actorId === citizenActor) || names.includes(row.actor)) change.actor = 'Anonymized';
      const action = withoutNames(row.action, names);
      if (action !== row.action) change.action = action;
      return change;
    });
  }
  return patch;
}

/** `text` with each of `names` replaced, for an activity row's wording. */
function withoutNames(text, names) {
  if (typeof text !== 'string') return text;
  return names.reduce((out, name) => out.split(name).join('[removed]'), text);
}

const GENERIC_PLACES = new Set(['', 'unknown', 'location not specified', 'location under review', 'not specified', 'location removed']);

/** As anonymiseCase, for a sighting. */
export async function anonymiseSighting(deps, sighting, { now = Date.now(), approval = null } = {}) {
  const before = { ...sighting };
  const patch = anonymisedSightingPatch(before, { now, approval });
  deps.updateFoundReport(before.id, patch);
  if (before.photoFile && typeof deps.deletePhoto === 'function') {
    await Promise.resolve(deps.deletePhoto(before.photoFile)).catch(() => false);
  }
  if (typeof deps.rewriteActivity === 'function') {
    const label = anonymisedLabel('foundReport', before.id);
    const place = String(before.foundLocation || '').trim();
    const placeIdentifies = Boolean(place) && !GENERIC_PLACES.has(place.toLowerCase());
    const reporter = [before.reporterName, before.reporterDisplayName]
      .filter((n) => typeof n === 'string' && n.trim().length >= 2 && !/^(anonymous|confidential|anonymized) citizen$/i.test(n.trim()));
    deps.rewriteActivity((row) => {
      if (row?.scope?.foundReportId === before.id) {
        // The citizen who sent it is the actor of its "uploaded" row.
        return reporter.includes(row.actor) ? { target: label, actor: 'Anonymized citizen' } : { target: label };
      }
      // Rows written before they carried the sighting id show its place; the
      // place is removed wherever it appears, never attributed elsewhere.
      if (placeIdentifies && row?.target === place) return { target: 'Location removed' };
      return null;
    });
  }
  return patch;
}

/**
 * Plans a sweep and, when `apply`, carries it out: expired sightings and
 * closed cases anonymised, escalated sightings kept as long as their case.
 * Every record changed gets its own audit row, by id. Returns the plan and
 * what was done.
 *
 * `deps`: listReports, listFoundReports, updateReport, updateFoundReport,
 * addAudit, and optionally deletePhoto, rewriteActivity, faceIndex.
 */
export async function runRetentionSweep(deps, { now = Date.now(), apply = false, approval = null, actor = null } = {}) {
  const plan = planRetention({ reports: deps.listReports(), foundReports: deps.listFoundReports(), now });
  const done = { sightingsAnonymised: 0, sightingsExtended: 0, casesAnonymised: 0 };
  if (!apply) return { plan, summary: planSummary(plan), applied: false, done };

  const who = {
    actorId: actor?.id || null,
    actorName: actor?.name || 'Khozo retention job',
    actorRole: actor?.role || 'system',
  };
  const approvalRecord = approval || { type: 'retention_schedule', reference: 'retention-schedule', noteLength: 0 };
  const findReport = (id) => deps.listReports().find((r) => r.id === id);
  const findFound = (id) => deps.listFoundReports().find((f) => f.id === id);

  for (const item of plan.sightings.extend) {
    const sighting = findFound(item.id);
    if (!sighting || !item.until) continue;
    deps.updateFoundReport(sighting.id, { retentionUntil: item.until, privacyReviewStatus: 'retention_extended_with_case', retentionExtendedReason: item.reason });
    done.sightingsExtended += 1;
    deps.addAudit({
      ...who,
      action: 'privacy.retention_extended',
      targetType: 'foundReport',
      targetId: sighting.id,
      summary: `Kept sighting ${sighting.id} with case ${item.caseId} (${item.reason})`,
      scope: { state: sighting.state, district: sighting.district, matchedReportId: sighting.matchedReportId || null },
      metadata: { reason: item.reason, caseId: item.caseId, retentionUntil: item.until, automatic: !actor },
    });
  }

  for (const item of plan.sightings.anonymise) {
    const sighting = findFound(item.id);
    if (!sighting) continue;
    const hadPhoto = Boolean(sighting.photoFile);
    // eslint-disable-next-line no-await-in-loop
    await anonymiseSighting(deps, sighting, { now, approval: approvalRecord });
    done.sightingsAnonymised += 1;
    deps.addAudit({
      ...who,
      action: 'privacy.record_anonymized',
      targetType: 'foundReport',
      targetId: sighting.id,
      summary: `Anonymised sighting ${sighting.id}: retention period ended`,
      scope: { state: sighting.state, district: sighting.district, matchedReportId: sighting.matchedReportId || null },
      metadata: { reason: item.reason, approvalType: approvalRecord.type, approvalReference: approvalRecord.reference, photoDeleted: hadPhoto, automatic: !actor },
    });
  }

  for (const item of plan.cases.anonymise) {
    const report = findReport(item.id);
    if (!report) continue;
    const hadPhoto = Boolean(report.photoFile);
    // eslint-disable-next-line no-await-in-loop
    await anonymiseCase(deps, report, { now, approval: approvalRecord });
    done.casesAnonymised += 1;
    deps.addAudit({
      ...who,
      action: 'privacy.record_anonymized',
      targetType: 'report',
      targetId: report.id,
      summary: `Anonymised case ${report.id}: retention period ended after closure`,
      scope: { state: report.state, district: report.district, reportId: report.id },
      metadata: { reason: item.reason, approvalType: approvalRecord.type, approvalReference: approvalRecord.reference, photoDeleted: hadPhoto, automatic: !actor },
    });
  }

  return { plan, summary: planSummary(plan), applied: true, done };
}
