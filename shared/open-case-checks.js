/**
 * Checking a video against open cases (Khozo Desktop, "mode 2"; spec F15-F17
 * and K9). Pure and dependency-free apart from the place rules; the routes are
 * in shared/routes/reports.js (/open-case-checks).
 *
 * In "Find this person" (shared/video-jobs.js) the officer starts from one
 * case. Here the officer has footage and no case: a railway station, a bus
 * stand. Each person the laptop saw is searched in Aarakshak's index of open
 * cases, narrowed first by the officer (sex, age, district, missing since),
 * and a case is shown only above a higher bar than mode 1, because a few
 * hundred cases against thousands of passers-by multiply false alarms: the
 * case is among the index's five closest for that face, AND Aarakshak scores
 * the pair at least 0.45, AND AWS at least 0.90 (spec section 11). "Possibly
 * the same person" alone is never shown.
 *
 * A face that clears the bar is a lead. An officer who can open that case
 * sees it beside the case photo and sends it to the case; an officer outside
 * the case's area is told only that a case may match, never which, and can
 * send the face to that case's own officers, who look at it. Either way it
 * arrives as a sighting waiting for the case's review, never as a match.
 *
 * Off unless KHOZO_DESKTOP_OPEN_CASES is on, which waits on Aarakshak's
 * permission to use its gallery live (A3) and the legal advice (spec 16).
 */
import { POLICE_ROLES, canAccessReport, hasJurisdiction, sameDistrict, sameState, sameStatePlace, scopeReports } from './scope.js';
import { expectedAgeAt, isForwardPoolCase } from './match-pool.js';
import { keyHash, zeroCounts } from './video-jobs.js';

/** The bar a face must clear to be shown, unless the settings say otherwise. */
export const OPEN_CASE_BAR = { top: 5, aarakshak: 0.45, rekognition: 0.9 };

/** District desks that may run a check: their own district's cases, or their state's (KHOZO_DESKTOP_OPEN_CASES_AREA). */
const DISTRICT_POLICE = ['police', 'sjpu', 'ahtu', 'dcrb'];

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const isOn = (value) => /^(1|true|on|yes)$/i.test(String(value ?? '').trim());
const numberIn = (value, fallback, lo, hi) => {
  const n = Number(value);
  return value !== '' && value != null && Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
};

/**
 * The switch, the search area for district desks (D2 in the spec: 'state',
 * as proposed, or 'district'), and the bar, from the route settings.
 */
export function openCaseSettingsOf(settings = {}) {
  return {
    on: isOn(settings.openCases),
    area: String(settings.openCasesArea || '').trim().toLowerCase() === 'district' ? 'district' : 'state',
    bar: {
      top: Math.round(numberIn(settings.openCasesTop, OPEN_CASE_BAR.top, 1, 50)),
      aarakshak: numberIn(settings.openCasesAarakshak, OPEN_CASE_BAR.aarakshak, 0, 1),
      rekognition: numberIn(settings.openCasesRekognition, OPEN_CASE_BAR.rekognition, 0, 1),
    },
  };
}

/** Where an officer's check looks: the whole country, a state, or a district. */
export function openCaseArea(user, areaSetting = 'state') {
  const place = user?.jurisdiction || {};
  if (user?.role === 'super_admin') return { kind: 'country', state: null, district: null };
  if (DISTRICT_POLICE.includes(user?.role) && areaSetting !== 'district') return { kind: 'state', state: place.state || null, district: null };
  if (DISTRICT_POLICE.includes(user?.role)) return { kind: 'district', state: place.state || null, district: place.district || null };
  return { kind: 'state', state: place.state || null, district: null };
}

/** The cases inside an officer's search area, whether or not the officer can open each. */
function casesInArea(user, reports, areaSetting) {
  if (!user || !POLICE_ROLES.includes(user.role) || !hasJurisdiction(user)) return [];
  if (user.role === 'super_admin') return reports;
  if (DISTRICT_POLICE.includes(user.role) && areaSetting !== 'district') {
    return reports.filter((r) => sameStatePlace(r, user.jurisdiction));
  }
  return scopeReports(user, reports);
}

const sexOf = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'male' || v === 'm') return 'male';
  if (v === 'female' || v === 'f') return 'female';
  return null;
};
const dayOf = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && Number.isFinite(Date.parse(value)) ? String(value) : null);
const ageOf = (value) => (value === '' || value == null ? null : numberIn(value, NaN, 0, 120));

/**
 * The officer's narrowing (F15), or `{ error }`: sex, an age band (the age the
 * person would be today), a state (the super admin only) and a district
 * inside the area, and when they went missing.
 */
export function openCaseFiltersOf(input = {}) {
  const sex = text(input.sex, 10).toLowerCase();
  if (sex && sex !== 'male' && sex !== 'female') return { error: 'Choose male, female, or either.' };
  const ageFrom = ageOf(input.ageFrom);
  const ageTo = ageOf(input.ageTo);
  if (Number.isNaN(ageFrom) || Number.isNaN(ageTo)) return { error: 'An age is a number from 0 to 120.' };
  if (ageFrom != null && ageTo != null && ageFrom > ageTo) return { error: 'The first age must not be more than the second.' };
  const missingFrom = input.missingFrom ? dayOf(input.missingFrom) : null;
  const missingTo = input.missingTo ? dayOf(input.missingTo) : null;
  if ((input.missingFrom && !missingFrom) || (input.missingTo && !missingTo)) return { error: 'Give a date as YYYY-MM-DD.' };
  return {
    filters: {
      sex: sex || null,
      ageFrom,
      ageTo,
      state: text(input.state, 80) || null,
      district: text(input.district, 80) || null,
      missingFrom,
      missingTo,
    },
  };
}

const missingAt = (r) => Date.parse(r.dateOfMissing || '') || Number(r.createdAt) || 0;

/**
 * Whether a case fits the officer's narrowing. A case that does not say its
 * sex or age is kept: leaving it out would miss the person for a gap in the
 * form, and the face comparison decides anyway.
 */
function fits(r, f, now) {
  if (f.sex && sexOf(r.gender) && sexOf(r.gender) !== f.sex) return false;
  if (f.ageFrom != null || f.ageTo != null) {
    const age = expectedAgeAt(r, now);
    if (age != null && ((f.ageFrom != null && age < f.ageFrom) || (f.ageTo != null && age > f.ageTo))) return false;
  }
  if (f.state && !sameState(r.state, f.state)) return false;
  if (f.district && !sameDistrict(r.district, f.district)) return false;
  if ((f.missingFrom || f.missingTo) && missingAt(r)) {
    const at = missingAt(r);
    if (f.missingFrom && at < Date.parse(`${f.missingFrom}T00:00:00+05:30`)) return false;
    if (f.missingTo && at > Date.parse(`${f.missingTo}T23:59:59.999+05:30`)) return false;
  }
  return true;
}

/** Whether a case's faces are in the index this deployment searches. */
const inIndex = (r, indexName) => Boolean(indexName) && r?.faceIndex?.provider === indexName && r.faceIndex.status === 'enrolled';

/**
 * The cases a check would search (F15: "the screen says how many"): open
 * cases with a photo, in the officer's area, that fit the narrowing. Only
 * those in the face index can be found, since the bar asks for the index's
 * closest; `notInIndex` says how many are left out for that.
 */
export function openCasesFor({ user, reports = [], filters = {}, areaSetting = 'state', indexName = null, now = Date.now() }) {
  const open = casesInArea(user, reports, areaSetting).filter((r) => isForwardPoolCase(r) && fits(r, filters, now));
  const searched = open.filter((r) => inIndex(r, indexName));
  return { open, searched, notInIndex: open.length - searched.length };
}

/**
 * Of the index's answer for one face (closest first), the cases this check may
 * show: in the check's own set, at most `top` of them, with each one's place
 * in that order.
 */
export function shortlistOf(hits, allowedIds, top = OPEN_CASE_BAR.top) {
  const out = [];
  for (const hit of Array.isArray(hits) ? hits : []) {
    if (!allowedIds.has(hit.caseId)) continue;
    out.push({ caseId: hit.caseId, rank: out.length + 1, indexScore: hit.score });
    if (out.length >= top) break;
  }
  return out;
}

/** Whether a pairwise comparison (shared/match-pipeline.js) clears the bar: both engines, each above its own line. */
export function clearsOpenCaseBar(candidate, bar = OPEN_CASE_BAR) {
  const a = Number(candidate?.primaryScore);
  const r = Number(candidate?.secondOpinionScore);
  return candidate?.primaryScore != null && candidate?.secondOpinionScore != null
    && Number.isFinite(a) && Number.isFinite(r) && a >= bar.aarakshak && r >= bar.rekognition;
}

/** A lead's name, from the check, the face and the case: the same lead is found again, never made twice. */
export const leadIdFor = (jobId, faceKey, caseId) => `ld_${keyHash(`${jobId}|${faceKey}|${caseId}`)}`.slice(0, 20);
export const LEAD_ID = /^ld_[a-z0-9]{4,17}$/;
/**
 * A name for one case within one check that does not say which case: faces
 * close to the same case outside the officer's area are shown together, and
 * nothing in the name leads to the case.
 */
export const caseKeyFor = (jobId, caseId) => `oc_${keyHash(`case|${jobId}|${caseId}`)}`.slice(0, 16);

/**
 * A new check against open cases. `area` and `filters` are what the officer
 * chose; `searched` is how many cases that was when the check started. The
 * officer's place decides who may see the check, as there is no case.
 */
export function newOpenCaseCheck({ id, user, body, files, filters, area, searched, bar, now = new Date().toISOString() }) {
  const place = user.jurisdiction || {};
  return {
    id,
    mode: 'open_cases',
    reportId: null,
    jobKey: text(body?.jobKey, 80),
    source: 'desktop',
    appVersion: text(body?.appVersion, 40) || null,
    device: text(body?.device, 80) || null,
    model: null,
    firstPass: null,
    status: 'open',
    createdById: user.id,
    createdByName: user.name || null,
    createdByRole: user.role || null,
    officerPlace: { state: place.state || user.state || null, district: place.district || user.district || null },
    scope: { state: place.state || null, district: place.district || null, stateCode: place.stateCode || null, districtCode: place.districtCode || null, reportId: null },
    area,
    filters,
    casesSearched: searched,
    bar,
    files,
    progress: { status: 'running', files: {} },
    counts: zeroCounts(),
    batches: {},
    leads: {},
    decisions: {},
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
}

/** The key one face's answer is kept under: the video and the laptop's name for the person. */
export const openCaseFaceKey = (fileKey, faceKey) => `${fileKey}|${faceKey}`;

/**
 * The patch that records one face's answer and its leads. Kept as a batch of
 * one, so the counts are worked out as for any check (shared/video-jobs.js):
 * 'likely' is a face with a lead, 'unlikely' one with none.
 */
export function openCaseFacePatch(job, fileKey, face, leads, now = new Date().toISOString()) {
  const key = openCaseFaceKey(fileKey, face.key);
  return {
    batches: { ...(job.batches || {}), [key]: { at: now, faces: [{ key: face.key, t: face.t, verdict: face.verdict, leads: leads.map((l) => l.id) }] } },
    leads: { ...(job.leads || {}), ...Object.fromEntries(leads.map((l) => [l.id, l])) },
    updatedAt: now,
  };
}

/**
 * A lead as the officer who ran the check sees it. A case the officer can
 * open comes with what the laptop shows beside the face: the case's name, age,
 * place and photo, and the two scores. A case outside the officer's area
 * comes with nothing that says which case it is (F17).
 */
export function leadView(lead, report, viewer, decision = null) {
  const base = {
    id: lead.id,
    fileKey: lead.fileKey,
    faceKey: lead.faceKey,
    t: lead.t,
    caseKey: lead.caseKey || null,
    status: decision ? (decision.decision === 'same' ? 'sent' : 'not') : 'open',
  };
  if (!report || !canAccessReport(viewer, report)) return { ...base, inScope: false };
  return {
    ...base,
    inScope: true,
    rank: lead.rank,
    aarakshak: lead.aarakshak,
    rekognition: lead.rekognition,
    sightingId: decision?.sightingId || null,
    case: {
      id: report.id,
      name: report.childName || report.name || null,
      gender: report.gender || null,
      age: report.age ?? null,
      ageNow: expectedAgeAt(report),
      dateOfMissing: report.dateOfMissing || null,
      state: report.state || null,
      district: report.district || null,
      firNo: report.firNo || null,
    },
  };
}
