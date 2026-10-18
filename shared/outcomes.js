/**
 * Outcome measures: whether people are being found, and how fast.
 *
 * The MIS report counted work (cases, sightings, follow-ups due) but not
 * results. A department deciding whether Khozo is worth running, or which
 * districts need help, needs the results:
 *
 *   recovered            cases found, or closed as restored, repatriated,
 *                        traced, placed in care or adoption (a recorded death
 *                        is not a recovery)
 *   recoveryRate         recovered / registered
 *   medianDaysToRecovery from going missing to recovery
 *   medianDaysToFirstCandidate
 *                        from registration to the first sighting proposed to
 *                        an officer for the case: how quickly matching puts a
 *                        lead in front of someone
 *   openBacklog          open cases by how long the person has been missing
 *   byDistrict           the same, per district
 *
 * A found-child intake (a child found and taken into care) is not a missing
 * person and is left out. Pure.
 */

const DAY_MS = 86400000;
const RECOVERY_CLOSURES = new Set(['restored_family', 'transferred_cci', 'adoption', 'repatriated', 'traced_not_reunited']);
const OPEN = new Set(['missing', 'under_review', 'intake_pending']);

export const BACKLOG_BANDS = [
  { name: 'Under 30 days', maxDays: 30 },
  { name: '30 days to 6 months', maxDays: 182 },
  { name: '6 to 12 months', maxDays: 365 },
  { name: '1 to 5 years', maxDays: 5 * 365 },
  { name: 'Over 5 years', maxDays: Infinity },
];

function timeOf(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  const t = Number.isFinite(n) ? n : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Number(value.toFixed(1));
}

const startOf = (r) => timeOf(r.dateOfMissing) ?? timeOf(r.createdAt);

/** When a case was recovered, or null when it has not been. */
export function recoveredAt(report) {
  if (!report) return null;
  if (report.status === 'found') return timeOf(report.foundAt) ?? timeOf(report.closure?.closedAt) ?? timeOf(report.lastWorkflowAt);
  if (report.status === 'closed' && RECOVERY_CLOSURES.has(report.closure?.reason)) return timeOf(report.closure?.closedAt);
  return null;
}

/** The earliest moment a sighting was proposed to an officer for each case. */
function firstCandidates(foundReports) {
  const first = new Map();
  const note = (id, t) => {
    if (!id || t == null) return;
    if (!first.has(id) || t < first.get(id)) first.set(id, t);
  };
  for (const f of foundReports) {
    if (!f) continue;
    for (const c of Array.isArray(f.matchCandidates) ? f.matchCandidates : []) {
      note(c?.reportId, timeOf(c?.proposedAt) ?? timeOf(f.createdAt));
    }
    if (f.matchedReportId) note(f.matchedReportId, timeOf(f.createdAt));
  }
  return first;
}

function measure(reports, candidates, now) {
  const registered = reports.length;
  const recovered = reports.filter((r) => recoveredAt(r) != null);
  const daysToRecovery = recovered.map((r) => {
    const start = startOf(r);
    const end = recoveredAt(r);
    return start != null && end != null ? Math.max(0, (end - start) / DAY_MS) : null;
  });
  const daysToCandidate = reports
    .filter((r) => candidates.has(r.id))
    .map((r) => {
      const registeredAt = timeOf(r.createdAt) ?? startOf(r);
      return registeredAt != null ? Math.max(0, (candidates.get(r.id) - registeredAt) / DAY_MS) : null;
    });
  return {
    registered,
    recovered: recovered.length,
    recoveryRate: registered ? Number((recovered.length / registered).toFixed(3)) : null,
    medianDaysToRecovery: median(daysToRecovery),
    medianDaysToFirstCandidate: median(daysToCandidate),
    casesWithCandidate: daysToCandidate.length,
    open: reports.filter((r) => OPEN.has(r.status)).length,
    now,
  };
}

/** Outcome measures over the cases and sightings given (already scoped). */
export function outcomeMeasures({ reports = [], foundReports = [], now = Date.now() } = {}) {
  const cases = reports.filter((r) => r && r.caseOrigin !== 'found_child_intake');
  const candidates = firstCandidates(foundReports);
  const { now: _now, ...overall } = measure(cases, candidates, now);

  const openBacklog = BACKLOG_BANDS.map((band) => ({ name: band.name, count: 0 }));
  for (const r of cases.filter((c) => OPEN.has(c.status))) {
    const start = startOf(r);
    const days = start != null ? (now - start) / DAY_MS : 0;
    const index = BACKLOG_BANDS.findIndex((band) => days < band.maxDays);
    openBacklog[index === -1 ? openBacklog.length - 1 : index].count += 1;
  }

  const byPlace = new Map();
  for (const r of cases) {
    const name = r.district ? [r.district, r.state].filter(Boolean).join(', ') : r.state || 'Unplaced';
    if (!byPlace.has(name)) byPlace.set(name, []);
    byPlace.get(name).push(r);
  }
  const byDistrict = [...byPlace.entries()]
    .map(([name, group]) => {
      const { now: _n, ...m } = measure(group, candidates, now);
      return { name, ...m };
    })
    .sort((a, b) => b.registered - a.registered || a.name.localeCompare(b.name))
    .slice(0, 15);

  return { ...overall, openBacklog, byDistrict };
}
