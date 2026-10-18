/**
 * Trafficking signals: a risk prompt on each case, and patterns across cases.
 *
 * A missing-person system finds one person at a time. Trafficking shows up
 * across records: a district that loses four teenage girls in a month, a
 * child who has gone missing before, two cases that share a contact number,
 * children from one district traced to another state. Those are things an
 * Anti Human Trafficking Unit looks for by hand, if at all. This module looks
 * for them in what Khozo already holds, and says why.
 *
 *   assessTraffickingRisk(report, context)
 *       A level (high / elevated / standard), a score and the reasons, for one
 *       case. Stored on the case at registration and verification, and a high
 *       level alerts the AHTU and SJPU desks that can open the case.
 *
 *   detectPatterns({ reports, foundReports, ... })
 *       District surges, repeat disappearances, shared contact numbers,
 *       movement between districts and states, and places where sightings
 *       gather. Served to police and command desks by
 *       GET /api/dashboard/patterns, over the cases they may already see.
 *
 * Neither is a finding. Each is a prompt for an officer, worded as one, and
 * the reasons are always shown: an officer must be able to see why a case was
 * raised and disagree. Nothing here is shown to the public or to families.
 * Only AHTU and SJPU desks are alerted; the patterns page is for police and
 * command desks; CCI, SAA, JJB and DLSA desks do not see the prompt on a case
 * (shared/privacy.js deskCaseView). CWC and DCPU see it, for protection
 * decisions.
 *
 * Pure: reads records, changes nothing.
 */
import { familyPhone, nameOverlap, personCategoryOf } from './case-domain.js';
import { districtKey } from './scope.js';
import { storedAadhaarFingerprint } from './privacy.js';

export const RISK_MODEL_VERSION = 'trafficking-signals-2026-10';

const DAY_MS = 86400000;
const CLOSED = new Set(['found', 'closed']);

/** The reasons a case can be raised for, as officers read them. */
export const RISK_REASONS = {
  flagged_trafficking_risk: 'Registered with a trafficking-risk flag',
  child_labour_risk: 'Registered with a child-labour risk flag',
  abuse_risk: 'Registered with an abuse or exploitation risk flag',
  unaccompanied: 'Unaccompanied when last seen or found',
  adolescent: 'Aged 12 to 17',
  adolescent_girl: 'A girl aged 12 to 17',
  young_woman: 'A woman aged 18 to 25',
  lure_described: 'Circumstances describe a job, marriage, online contact or agent',
  work_mentioned: 'Circumstances mention work or employment',
  left_by_transport: 'Circumstances mention a train, bus or station',
  railway: 'Found or produced through the railway (RPF)',
  previously_missing: 'Has been reported missing before',
  district_cluster: 'Three or more adolescents missing from this district within 30 days',
};

const LEVEL_LABELS = { high: 'High', elevated: 'Elevated', standard: 'Standard' };

// Words that describe how people are recruited. Matched case-insensitively:
// English and romanised Hindi as whole words, Indic scripts as substrings.
const STRONG_LURE_WORDS = [
  'agent', 'broker', 'dalal', 'placement', 'contractor', 'thekedar', 'recruiter', 'promised', 'lured', 'enticed',
  'instagram', 'facebook', 'whatsapp', 'social media', 'online friend', 'met online', 'boyfriend', 'eloped',
  'marriage', 'married', 'wedding', 'shaadi', 'film', 'acting', 'modelling', 'modeling', 'dance bar', 'spa', 'massage',
];
const STRONG_LURE_SCRIPT = [
  'दलाल', 'ठेकेदार', 'एजेंट', 'एजंट', 'बहला', 'फुसला', 'लालच', 'आमिष', 'फूस', 'शादी', 'विवाह', 'लग्न', 'प्रेमी', 'प्रियकर', 'भगा', 'पळवून',
  'દલાલ', 'એજન્ટ', 'લાલચ', 'ફોસલા', 'લગ્ન', 'પ્રેમી', 'ભગાડ',
];
const WORK_WORDS = ['job', 'work', 'employment', 'naukri', 'salary', 'factory', 'hotel', 'domestic help', 'maid'];
const WORK_SCRIPT = ['नौकरी', 'नोकरी', 'काम', 'મજૂરી', 'નોકરી', 'કામ'];
const TRANSPORT_WORDS = ['train', 'railway', 'station', 'bus', 'truck'];
const TRANSPORT_SCRIPT = ['ट्रेन', 'रेल', 'स्टेशन', 'बस', 'ટ્રેન', 'રેલ', 'સ્ટેશન', 'બસ'];

function mentions(text, words, scriptWords) {
  const lower = String(text || '').toLowerCase();
  if (!lower) return false;
  if (words.some((w) => new RegExp(`(^|[^a-z])${w.replace(/ /g, '\\s+')}([^a-z]|$)`).test(lower))) return true;
  return scriptWords.some((w) => lower.includes(w));
}

const numberOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function missingTime(report) {
  const t = Date.parse(report?.dateOfMissing || '');
  if (Number.isFinite(t)) return t;
  const c = Number(report?.createdAt);
  return Number.isFinite(c) ? c : Date.parse(report?.createdAt || '') || 0;
}

const isOpen = (r) => Boolean(r) && !r.anonymizedAt && !CLOSED.has(r.status);
const isAdolescent = (r) => {
  const age = numberOrNull(r?.age);
  return personCategoryOf(r) === 'child' && age != null && age >= 12 && age <= 17;
};

/**
 * The cases indexed by what identifies a person (Aadhaar fingerprint, family
 * phone) and adolescents by district, each worked out once.
 *
 * Comparing every case with every other recomputed a fingerprint (an HMAC)
 * per pair for cases still holding a whole Aadhaar number: a thousand cases
 * took seconds, two thousand over half a minute. With the index a case is
 * compared only with the cases that share a fingerprint, a phone or a
 * district. Build one per request: records change between requests.
 */
export function buildPersonIndex(reports = [], { aadhaarKey = null, nonFamilyPhones = null } = {}) {
  const fingerprints = new Map();
  const phones = new Map();
  const districts = new Map();
  const byFingerprint = new Map();
  const byPhone = new Map();
  const adolescentsByDistrict = new Map();
  const push = (map, key, row) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };
  const index = {
    fingerprint(r) {
      if (!fingerprints.has(r)) fingerprints.set(r, storedAadhaarFingerprint(r, aadhaarKey));
      return fingerprints.get(r);
    },
    phone(r) {
      if (!phones.has(r)) phones.set(r, familyPhone(r, nonFamilyPhones));
      return phones.get(r);
    },
    district(r) {
      if (!districts.has(r)) districts.set(r, districtKey(r));
      return districts.get(r);
    },
    byFingerprint,
    byPhone,
    adolescentsByDistrict,
  };
  for (const r of reports) {
    if (!r) continue;
    const fp = index.fingerprint(r);
    if (fp) push(byFingerprint, fp, r);
    const phone = index.phone(r);
    if (phone) push(byPhone, phone, r);
    if (isAdolescent(r)) push(adolescentsByDistrict, index.district(r), r);
  }
  return index;
}

function samePersonIn(index, a, b) {
  if (!a || !b || a.id === b.id) return false;
  const fa = index.fingerprint(a);
  const fb = index.fingerprint(b);
  if (fa && fb) return fa === fb;
  const pa = index.phone(a);
  const pb = index.phone(b);
  return Boolean(pa && pb && pa === pb && nameOverlap(a.childName, b.childName) >= 0.6);
}

/** The other indexed cases that could be the same person as `report`. */
function personCandidates(index, report) {
  const out = new Set();
  const fp = index.fingerprint(report);
  if (fp) for (const r of index.byFingerprint.get(fp) || []) out.add(r);
  const phone = index.phone(report);
  if (phone) for (const r of index.byPhone.get(phone) || []) out.add(r);
  return [...out].filter((r) => r.id !== report?.id);
}

/**
 * Whether two cases are the same person: the same Aadhaar fingerprint, or
 * closely matching names with the same family phone.
 */
export function samePerson(a, b, { aadhaarKey = null, nonFamilyPhones = null } = {}) {
  return samePersonIn(buildPersonIndex([], { aadhaarKey, nonFamilyPhones }), a, b);
}

/**
 * The trafficking-risk prompt for one case.
 *
 * `context.reports`: every case, for the repeat-disappearance and district
 * checks. Returns { level, label, score, reasons: [{ code, label }],
 * assessedAt, version }.
 */
export function assessTraffickingRisk(report, { reports = [], now = Date.now(), aadhaarKey = null, nonFamilyPhones = null, index = null } = {}) {
  const people = index || buildPersonIndex(reports, { aadhaarKey, nonFamilyPhones });
  const reasons = [];
  const add = (code, points) => reasons.push({ code, label: RISK_REASONS[code], points });
  const categories = new Set(report?.vulnerabilityProfile?.categories || []);
  const category = personCategoryOf(report);
  const age = numberOrNull(report?.age);
  const female = String(report?.gender || '').toLowerCase() === 'female';

  if (categories.has('trafficking_risk')) add('flagged_trafficking_risk', 3);
  if (categories.has('child_labour_risk')) add('child_labour_risk', 2);
  if (categories.has('abuse_risk')) add('abuse_risk', 2);
  if (categories.has('unaccompanied')) add('unaccompanied', 1);

  if (isAdolescent(report)) {
    add('adolescent', 1);
    if (female) add('adolescent_girl', 1);
  } else if (category === 'woman' && age != null && age >= 18 && age <= 25) {
    add('young_woman', 1);
  }

  const circumstances = [report?.vulnerabilityProfile?.circumstances, report?.circumstances].filter(Boolean).join(' ');
  if (mentions(circumstances, STRONG_LURE_WORDS, STRONG_LURE_SCRIPT)) add('lure_described', 2);
  else if (mentions(circumstances, WORK_WORDS, WORK_SCRIPT)) add('work_mentioned', 1);
  if (mentions(circumstances, TRANSPORT_WORDS, TRANSPORT_SCRIPT)) add('left_by_transport', 1);

  if (report?.vulnerabilityProfile?.producedByType === 'rpf') add('railway', 1);

  if (personCandidates(people, report).some((r) => samePersonIn(people, report, r) && (CLOSED.has(r.status) || missingTime(r) < missingTime(report)))) {
    add('previously_missing', 2);
  }

  if (isAdolescent(report)) {
    const when = missingTime(report) || now;
    const nearby = (people.adolescentsByDistrict.get(people.district(report)) || [])
      .filter((r) => r.id !== report?.id && Math.abs(missingTime(r) - when) <= 30 * DAY_MS);
    if (nearby.length >= 2) add('district_cluster', 1);
  }

  const score = reasons.reduce((n, r) => n + r.points, 0);
  const level = score >= 5 ? 'high' : score >= 3 ? 'elevated' : 'standard';
  return {
    level,
    label: LEVEL_LABELS[level],
    score,
    reasons: reasons.map(({ code, label }) => ({ code, label })),
    assessedAt: new Date(now).toISOString(),
    version: RISK_MODEL_VERSION,
  };
}

// ------------------------------------------------------------- patterns ---

const placeKey = (row) => `${row?.stateCode || String(row?.state || '').toLowerCase()}|${row?.districtCode || String(row?.district || '').toLowerCase()}`;
const placeName = (row) => [row?.district, row?.state].filter(Boolean).join(', ') || 'Unplaced';

/** What a pattern says about a case, enough for an officer to open it. */
function caseRef(r) {
  return {
    id: r.id,
    childName: r.childName || null,
    personCategory: personCategoryOf(r),
    age: numberOrNull(r.age),
    gender: r.gender || null,
    state: r.state || null,
    district: r.district || null,
    status: r.status || null,
    dateOfMissing: r.dateOfMissing || null,
    riskLevel: r.traffickingRisk?.level || null,
  };
}

/** A sighting's place as the reporter gave it (never the matched case's). */
function sightingPlace(f) {
  return f?.reportedLocation && (f.reportedLocation.state || f.reportedLocation.district) ? f.reportedLocation : f;
}

/** Great-circle distance between two { lat, lng }, in kilometres. */
function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (Number(b.lat) - Number(a.lat)) * rad;
  const dLng = (Number(b.lng) - Number(a.lng)) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(Number(a.lat) * rad) * Math.cos(Number(b.lat) * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const normPlaceText = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const GENERIC_PLACE = new Set(['', 'unknown', 'location not specified', 'location removed', 'not specified']);

/**
 * Patterns across the cases and sightings given (already scoped to what the
 * caller may see). `windowDays` is the "recent" period.
 */
export function detectPatterns({ reports = [], foundReports = [], now = Date.now(), windowDays = 30, aadhaarKey = null, nonFamilyPhones = null } = {}) {
  const live = reports.filter((r) => r && !r.anonymizedAt);
  const people = buildPersonIndex(live, { aadhaarKey, nonFamilyPhones });
  const since = now - windowDays * DAY_MS;
  const baselineFrom = since - 180 * DAY_MS;

  // District surges: more people missing recently than the district's usual.
  const byDistrict = new Map();
  for (const r of live) {
    const key = placeKey(r);
    if (!byDistrict.has(key)) byDistrict.set(key, { place: placeName(r), state: r.state || null, district: r.district || null, recent: [], baseline: 0 });
    const t = missingTime(r);
    const entry = byDistrict.get(key);
    if (t >= since && t <= now) entry.recent.push(r);
    else if (t >= baselineFrom && t < since) entry.baseline += 1;
  }
  const surges = [];
  for (const entry of byDistrict.values()) {
    const recent = entry.recent;
    const adolescents = recent.filter(isAdolescent);
    const flagged = recent.filter((r) => ['high', 'elevated'].includes(r.traffickingRisk?.level)
      || (r.vulnerabilityProfile?.categories || []).includes('trafficking_risk'));
    const usual = (entry.baseline / 180) * windowDays;
    const surge = recent.length >= 3 && recent.length >= 2 * Math.max(1, usual);
    if (!(surge || adolescents.length >= 3 || flagged.length >= 2)) continue;
    surges.push({
      place: entry.place,
      state: entry.state,
      district: entry.district,
      recent: recent.length,
      usual: Number(usual.toFixed(1)),
      adolescents: adolescents.length,
      girls: adolescents.filter((r) => String(r.gender).toLowerCase() === 'female').length,
      flagged: flagged.length,
      why: [
        surge ? `${recent.length} missing in ${windowDays} days against about ${Number(usual.toFixed(1))} usually` : null,
        adolescents.length >= 3 ? `${adolescents.length} aged 12 to 17` : null,
        flagged.length >= 2 ? `${flagged.length} raised for trafficking risk` : null,
      ].filter(Boolean),
      cases: recent.map(caseRef),
    });
  }
  surges.sort((a, b) => b.flagged - a.flagged || b.recent - a.recent);

  // Repeat disappearances: the same person reported missing more than once.
  const seen = new Set();
  const repeatMissing = [];
  for (const r of live) {
    if (seen.has(r.id)) continue;
    const group = [r, ...personCandidates(people, r).filter((o) => samePersonIn(people, r, o))];
    if (group.length < 2) continue;
    group.forEach((o) => seen.add(o.id));
    if (!group.some(isOpen)) continue;
    repeatMissing.push({ episodes: group.length, cases: group.sort((a, b) => missingTime(a) - missingTime(b)).map(caseRef) });
  }

  // Shared contact numbers: one family phone on cases of different people.
  // Siblings missing together are a pattern too.
  const byPhone = new Map();
  for (const r of live.filter(isOpen)) {
    const phone = people.phone(r);
    if (!phone) continue;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(r);
  }
  const sharedContacts = [];
  for (const [phone, group] of byPhone) {
    const distinct = group.filter((r, i) => !group.slice(0, i).some((o) => samePersonIn(people, r, o)));
    if (distinct.length < 2) continue;
    sharedContacts.push({ phoneSuffix: phone.replace(/\D/g, '').slice(-4), cases: distinct.map(caseRef) });
  }

  // Movement: where people were reported missing, and where they were seen.
  const casesById = new Map(live.map((r) => [r.id, r]));
  const routes = new Map();
  for (const f of foundReports) {
    if (!f || f.anonymizedAt || !f.matchedReportId || !['pending_review', 'matched'].includes(f.status)) continue;
    const from = casesById.get(f.matchedReportId);
    const to = sightingPlace(f);
    if (!from || !to || (!to.state && !to.district)) continue;
    if (placeKey(from) === placeKey(to)) continue;
    const key = `${placeKey(from)}>${placeKey(to)}`;
    if (!routes.has(key)) {
      routes.set(key, {
        from: placeName(from),
        to: placeName(to),
        interstate: Boolean(from.state && to.state && String(from.state).toLowerCase() !== String(to.state).toLowerCase()),
        sightings: 0,
        confirmed: 0,
        caseIds: new Set(),
      });
    }
    const route = routes.get(key);
    route.sightings += 1;
    if (f.status === 'matched') route.confirmed += 1;
    route.caseIds.add(from.id);
  }
  const corridors = [...routes.values()]
    .map(({ caseIds, ...route }) => ({ ...route, cases: caseIds.size }))
    .sort((a, b) => Number(b.interstate) - Number(a.interstate) || b.cases - a.cases || b.sightings - a.sightings);

  // Hotspots: places where recent sightings of children gather. Sightings
  // with coordinates are grouped by distance (within a kilometre of each
  // other); the rest by the place text the reporter gave, within a district.
  const recentChildSightings = foundReports.filter((f) => {
    if (!f || f.anonymizedAt || personCategoryOf(f) !== 'child') return false;
    const t = Number(f.createdAt) || Date.parse(f.createdAt || '') || 0;
    return t >= since && t <= now;
  });
  const spots = new Map();
  const hasPoint = (f) => f.lat != null && f.lng != null && Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lng));
  const points = recentChildSightings.filter(hasPoint);
  const taken = new Set();
  for (const seed of points) {
    if (taken.has(seed.id)) continue;
    const group = points.filter((f) => !taken.has(f.id) && distanceKm(seed, f) <= 1);
    if (group.length < 3) continue;
    group.forEach((f) => taken.add(f.id));
    const lat = group.reduce((t, f) => t + Number(f.lat), 0) / group.length;
    const lng = group.reduce((t, f) => t + Number(f.lng), 0) / group.length;
    const where = sightingPlace(seed);
    spots.set(`geo:${seed.id}`, {
      place: `${placeName(where)} (around ${lat.toFixed(3)}, ${lng.toFixed(3)})`,
      state: where.state || null,
      district: where.district || null,
      sightings: group.length,
      unmatched: group.filter((f) => !f.matchedReportId).length,
    });
  }
  for (const f of recentChildSightings) {
    if (hasPoint(f)) continue;
    const text = normPlaceText(f.foundLocation);
    if (GENERIC_PLACE.has(text)) continue;
    const where = sightingPlace(f);
    const key = `text:${placeKey(where)}:${text}`;
    if (!spots.has(key)) spots.set(key, { place: `${f.foundLocation}, ${placeName(where)}`, state: where.state || null, district: where.district || null, sightings: 0, unmatched: 0 });
    const spot = spots.get(key);
    spot.sightings += 1;
    if (!f.matchedReportId) spot.unmatched += 1;
  }
  const hotspots = [...spots.values()].filter((s) => s.sightings >= 3).sort((a, b) => b.sightings - a.sightings);

  return {
    generatedAt: new Date(now).toISOString(),
    windowDays,
    version: RISK_MODEL_VERSION,
    counts: {
      surges: surges.length,
      repeatMissing: repeatMissing.length,
      sharedContacts: sharedContacts.length,
      corridors: corridors.length,
      hotspots: hotspots.length,
      highRiskOpen: live.filter((r) => isOpen(r) && r.traffickingRisk?.level === 'high').length,
    },
    highRisk: live.filter((r) => isOpen(r) && r.traffickingRisk?.level === 'high')
      .sort((a, b) => (b.traffickingRisk?.score || 0) - (a.traffickingRisk?.score || 0))
      .slice(0, 25)
      .map((r) => ({ ...caseRef(r), reasons: r.traffickingRisk?.reasons || [] })),
    surges: surges.slice(0, 20),
    repeatMissing: repeatMissing.slice(0, 20),
    sharedContacts: sharedContacts.slice(0, 20),
    corridors: corridors.slice(0, 20),
    hotspots: hotspots.slice(0, 20),
  };
}
