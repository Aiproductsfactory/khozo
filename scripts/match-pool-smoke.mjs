/**
 * Checks what a face comparison is spent on, in both directions.
 *
 * Each comparison is a provider call, so a sighting is held to a fixed budget.
 * The budget has to be spent on the sighting's own district and state first:
 * spent in storage order, a sighting in Ahmedabad could be compared only with
 * Mumbai cases and miss the child standing in front of the camera.
 *
 * The reverse search - a newly registered case against the stored sightings -
 * is held to the same nearest-first rule, and to which sightings may be
 * compared at all. Its Worker engine is then run end to end against stubbed
 * providers: the same confirmation rule as the forward search, and the
 * sighting photo always sent as the source.
 *
 *   node scripts/match-pool-smoke.mjs
 */
import process from 'node:process';

import { expectedAgeAt, isRematchEligible, selectMatchCandidates, selectSightingCandidates } from '../shared/match-pool.js';
import { configHashOf } from '../shared/match-config.js';
import { detectPerson, matchEngineInfo, rankMatches, rankSightingMatches } from '../worker/src/match.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const report = (id, state, district, dateOfMissing, extra = {}) => ({
  id, state, district, dateOfMissing, status: 'missing', photoFile: `${id}.jpg`, ...extra,
});

// Stored oldest-first and Mumbai-first, the order that used to decide the pool.
const reports = [
  ...Array.from({ length: 30 }, (_, i) => report(`mum${i}`, 'Maharashtra', 'Mumbai', `2026-0${(i % 9) + 1}-01`)),
  report('ahd_old', 'Gujarat', 'Ahmedabad', '2009-03-14'),
  report('ahd_new', 'Gujarat', 'Ahmedabad', '2026-07-06'),
  report('surat', 'Gujarat', 'Surat', '2026-09-15'),
  report('ahd_found', 'Gujarat', 'Ahmedabad', '2026-08-02', { status: 'found' }),
  report('ahd_nophoto', 'Gujarat', 'Ahmedabad', '2026-08-03', { photoFile: null }),
  report('ahd_anon', 'Gujarat', 'Ahmedabad', '2026-08-04', { anonymizedAt: 1 }),
];

const ahmedabad = selectMatchCandidates(reports, { state: 'Gujarat', district: 'Ahmedabad' }, 25);
const ids = ahmedabad.reports.map((r) => r.id);
check('a sighting in a district is compared with that district first', ids[0] === 'ahd_new' && ids[1] === 'ahd_old', ids.slice(0, 3).join(', '));
check('then with the rest of its state', ids[2] === 'surat');
check('then elsewhere, within the budget', ids.length === 25 && ids.slice(3).every((id) => id.startsWith('mum')));
check('found, unphotographed and anonymised cases are never compared',
  !ids.some((id) => ['ahd_found', 'ahd_nophoto', 'ahd_anon'].includes(id)));
check('the pool says how many open cases were not compared',
  ahmedabad.pool.openWithPhotos === 33 && ahmedabad.pool.notCompared === 8 && ahmedabad.pool.sameDistrict === 2 && ahmedabad.pool.sameState === 1,
  JSON.stringify(ahmedabad.pool));

const caseVariant = selectMatchCandidates(reports, { state: ' gujarat ', district: 'ahmedabad' }, 3).reports.map((r) => r.id);
check('state and district names are compared loosely', caseVariant.join() === 'ahd_new,ahd_old,surat', caseVariant.join());

const mumbai = selectMatchCandidates(reports, { state: 'Maharashtra', district: 'Mumbai Suburban' }, 5).reports;
const osm = selectMatchCandidates(reports, { state: 'Gujarat', district: 'Ahmadabad District' }, 2).reports.map((r) => r.id);
check('the geocoder spelling "Ahmadabad" finds the Ahmedabad cases', osm.join() === 'ahd_new,ahd_old', osm.join());

check('Greater Mumbai counts as one jurisdiction', mumbai.every((r) => r.district === 'Mumbai'));

// A parent's or NGO's intake no officer has verified is not compared: anyone
// can register one, with any photo and any district, and comparing it would
// let them have a face watched for without an officer involved.
const intake = report('ahd_intake', 'Gujarat', 'Ahmedabad', '2026-10-01', { status: 'intake_pending', intakeStatus: 'pending_verification' });
const withIntake = selectMatchCandidates([...reports, intake], { state: 'Gujarat', district: 'Ahmedabad' }, 25);
check('an unverified citizen or NGO intake is never compared',
  !withIntake.reports.some((r) => r.id === 'ahd_intake') && withIntake.pool.openWithPhotos === 33, JSON.stringify(withIntake.pool));
const verifiedIntake = selectMatchCandidates([{ ...intake, status: 'missing', intakeStatus: 'verified' }], {}, 25);
check('once verified, it is', verifiedIntake.reports.length === 1);

const unlocated = selectMatchCandidates(reports, {}, 2).reports.map((r) => r.id);
check('an unlocated sighting is compared most-recently-missing first', unlocated[0] === 'surat', unlocated.join(', '));

// --- The reverse pool: which stored sightings a new case is compared with ----
const NOW = Date.parse('2026-10-16T12:00:00Z');
const HOUR = 3600000;
const sighting = (id, state, district, ageHours, extra = {}) => ({
  id, state, district,
  createdAt: NOW - ageHours * HOUR,
  status: 'no_match',
  photoFile: `${id}.jpg`,
  retentionUntil: new Date(NOW + 30 * 24 * HOUR).toISOString(),
  screening: { verdict: 'person' },
  ...extra,
});
const sightings = [
  ...Array.from({ length: 60 }, (_, i) => sighting(`mum_s${i}`, 'Maharashtra', 'Mumbai', i + 10)),
  sighting('ahd_s_old', 'Gujarat', 'Ahmadabad', 120),
  sighting('ahd_s_new', 'Gujarat', 'Ahmedabad', 1),
  sighting('surat_s', 'Gujarat', 'Surat', 2),
  sighting('unplaced_s', null, null, 0.5),
  sighting('formal_s', 'Gujarat', 'Ahmedabad', 48, { status: 'formalized_case', formalReportId: 'r_formal' }),
  sighting('unscreened_s', 'Gujarat', 'Ahmedabad', 72, { screening: { verdict: 'unverified' } }),
  sighting('linked_s', 'Gujarat', 'Ahmedabad', 0, { status: 'pending_review', matchedReportId: 'r_x' }),
  sighting('anon_s', 'Gujarat', 'Ahmedabad', 0, { anonymizedAt: '2026-10-10T00:00:00Z' }),
  sighting('expired_s', 'Gujarat', 'Ahmedabad', 0, { retentionUntil: new Date(NOW - 1000).toISOString() }),
  sighting('nophoto_s', 'Gujarat', 'Ahmedabad', 0, { photoFile: null }),
  sighting('rejected_s', 'Gujarat', 'Ahmedabad', 0, { status: 'rejected' }),
  sighting('invalid_s', 'Gujarat', 'Ahmedabad', 0, { status: 'cwc_followup_complete', cwcFollowup: { outcome: 'duplicate_or_invalid' } }),
  sighting('noperson_s', 'Gujarat', 'Ahmedabad', 0, { screening: { verdict: 'no_person' } }),
];
const reverse = selectSightingCandidates(sightings, { state: 'Gujarat', district: 'Ahmedabad' }, undefined, NOW);
const reverseIds = reverse.sightings.map((s) => s.id);
check('a new case is compared with sightings from its own district first, most recent first',
  reverseIds.slice(0, 4).join() === 'ahd_s_new,formal_s,unscreened_s,ahd_s_old', reverseIds.slice(0, 4).join());
check('then with the rest of its state, then elsewhere', reverseIds[4] === 'surat_s' && reverseIds[5] === 'unplaced_s', reverseIds.slice(4, 6).join());
check('linked, anonymised, expired, unphotographed and closed sightings are never compared',
  !reverseIds.some((id) => ['linked_s', 'anon_s', 'expired_s', 'nophoto_s', 'rejected_s', 'invalid_s', 'noperson_s'].includes(id)),
  reverseIds.filter((id) => !/^(mum_s|ahd_s|surat_s|unplaced_s|formal_s|unscreened_s)/.test(id)).join());
check('the reverse budget defaults to 50 and says how many were not compared',
  reverse.sightings.length === 50 && reverse.pool.eligibleWithPhotos === 66 && reverse.pool.notCompared === 16 &&
    reverse.pool.sameDistrict === 4 && reverse.pool.sameState === 1 && reverse.pool.limit === 50,
  JSON.stringify(reverse.pool));
check('the reverse budget can be set', selectSightingCandidates(sightings, {}, 3, NOW).sightings.length === 3);
const turnedDown = sighting('turned_down_s', 'Gujarat', 'Ahmedabad', 1, { status: 'referred_cwc', rejectedLinks: [{ reportId: 'r_lookalike', decision: 'rejected' }] });
check('a sighting an officer unlinked from a case is not proposed for that case again',
  !selectSightingCandidates([turnedDown], { reportId: 'r_lookalike' }, 50, NOW).sightings.length);
check('but is still compared with other cases',
  selectSightingCandidates([turnedDown], { reportId: 'r_other' }, 50, NOW).sightings.length === 1);

// --- What the forward pool leaves out, and the soft tie-break ---------------------
const closedOut = selectMatchCandidates([
  report('open_case', 'Gujarat', 'Ahmedabad', '2026-07-01'),
  report('closed_case', 'Gujarat', 'Ahmedabad', '2026-07-02', { status: 'closed' }),
  report('found_case', 'Gujarat', 'Ahmedabad', '2026-07-03', { status: 'found' }),
  report('intake_case', 'Gujarat', 'Ahmedabad', '2026-07-04', { status: 'under_review', caseOrigin: 'found_child_intake' }),
  report('rejected_case', 'Gujarat', 'Ahmedabad', '2026-07-05'),
], { state: 'Gujarat', district: 'Ahmedabad', excludeReportIds: ['rejected_case'] }, 25).reports.map((r) => r.id);
check('closed and found cases, found-child intakes and rejected pairs are never in the forward pool',
  closedOut.join() === 'open_case', closedOut.join());

const AT = Date.parse('2026-10-17T00:00:00Z');
check('the age a missing child would be now is the age at missing plus the years since',
  expectedAgeAt({ age: 9, dateOfMissing: '2019-10-01' }, AT) === 16 && expectedAgeAt({ age: 9, dateOfMissing: '2026-10-01' }, AT) === 9 && expectedAgeAt({ age: null }, AT) === null);
const fitPool = [
  report('boy_recent', 'Gujarat', 'Ahmedabad', '2026-10-01', { gender: 'Male', age: 9 }),
  report('girl_long_ago', 'Gujarat', 'Ahmedabad', '2019-10-01', { gender: 'Female', age: 9 }),
  report('girl_recent', 'Gujarat', 'Ahmedabad', '2026-09-01', { gender: 'Female', age: 9 }),
  report('surat_girl', 'Gujarat', 'Surat', '2019-10-01', { gender: 'Female', age: 9 }),
];
const fitted = selectMatchCandidates(fitPool, { state: 'Gujarat', district: 'Ahmedabad', gender: 'Female', ageApprox: 16 }, 25, AT).reports.map((r) => r.id);
check('within a tier, a case whose sex and age today fit the sighting comes first',
  fitted[0] === 'girl_long_ago', fitted.join());
check('the tie-break never filters, and never outranks the nearest-first tiers',
  fitted.length === 4 && fitted[3] === 'surat_girl' && fitted.includes('boy_recent'), fitted.join());

// With a one-to-many index: its shortlist first, then the cases it does not hold.
const indexed = (id, extra = {}) => report(id, 'Gujarat', 'Ahmedabad', '2026-08-01', { faceIndex: { provider: 'gallery', status: 'enrolled' }, ...extra });
const shortlisted = selectMatchCandidates(
  [indexed('i1'), indexed('i2'), indexed('i3_closed', { status: 'closed' }), report('not_indexed', 'Gujarat', 'Ahmedabad', '2026-01-01'), indexed('i4')],
  { state: 'Gujarat', district: 'Ahmedabad', shortlist: ['i2', 'i3_closed', 'gone', 'i1'], indexProvider: 'gallery' },
  25
);
check('with an index, its shortlist is compared in its order, cases it does not hold fill the budget, and nothing else',
  shortlisted.reports.map((r) => r.id).join() === 'i2,i1,not_indexed' && shortlisted.pool.source === 'index' && shortlisted.pool.indexHits === 4 && shortlisted.pool.unindexed === 1,
  `${shortlisted.reports.map((r) => r.id).join()} ${JSON.stringify(shortlisted.pool)}`);

// The reverse pool covers open found-child intakes whose sighting is no longer comparable.
const intakeRow = (id, sourceId, extra = {}) => ({ id, caseOrigin: 'found_child_intake', status: 'under_review', state: 'Gujarat', district: 'Ahmedabad', photoFile: `${id}.jpg`, sourceFoundReportId: sourceId, createdAt: NOW - HOUR, ...extra });
const withIntakes = selectSightingCandidates(
  [
    sighting('src_anon', 'Gujarat', 'Ahmedabad', 300, { status: 'formalized_case', anonymizedAt: '2026-10-01' }),
    sighting('src_live', 'Gujarat', 'Ahmedabad', 2, { status: 'formalized_case' }),
    sighting('src_closed', 'Gujarat', 'Ahmedabad', 300, { status: 'formalized_case', anonymizedAt: '2026-10-01' }),
  ],
  { state: 'Gujarat', district: 'Ahmedabad', reportId: 'r_new' },
  50,
  NOW,
  { intakeReports: [intakeRow("in_anon", "src_anon"), intakeRow("in_live", "src_live"), intakeRow("in_closed", "src_closed", { status: "closed" })] }
);
check('the reverse search covers an open found-child intake whose sighting can no longer be compared, once',
  withIntakes.sightings.map((s) => s.id).sort().join() === 'in_anon,src_live' && withIntakes.pool.foundChildIntakes === 1,
  withIntakes.sightings.map((s) => s.id).join());
check('a sighting a screen called "no person" can still be searched again',
  isRematchEligible(sighting('np', 'Gujarat', 'Ahmedabad', 1, { screening: { verdict: 'no_person' } }), NOW) &&
    !isRematchEligible(sighting('closed', 'Gujarat', 'Ahmedabad', 1, { status: 'matched' }), NOW));

// --- The Worker engine, both directions, against stubbed providers -----------
// Photos are marker strings: "FACE:<person>:<case|sighting>". Aarakshak scores
// the same person 0.9; Rekognition agrees (95%) except for person Q, where it
// disagrees (40%) and the candidate must be withheld.
// A JPEG's first bytes, then the marker: Rekognition is only asked about
// photos it can read (JPEG or PNG), so the stand-in photos must look like one.
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const photo = (person, role) => Buffer.concat([JPEG_HEAD, Buffer.from(`FACE:${person}:${role};`)]);
const facesIn = (text) => [...text.matchAll(/FACE:(\w+):(\w+);/g)].map((m) => ({ person: m[1], role: m[2] }));
const sent = [];
// How many Aarakshak calls are open at once, and faces whose call fails: the
// Worker holds at most six outbound connections and queues the rest with their
// abort timers running, so the engine must keep its own calls to five.
let inFlight = 0;
let maxInFlight = 0;
const failingFaces = new Set();
// Faces Aarakshak finds no face in; faces Rekognition fails on; Aarakshak
// calls that fail once (a transient fault); faces with two people in them.
const aarakshakNoFace = new Set();
const rekognitionFails = new Set();
let aarakshakFailOnce = 0;
const groupFaces = new Set();
const aarakshakTypes = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  if (target.includes('aarakshak')) {
    const faces = facesIn(Buffer.from(init.body).toString('latin1'));
    sent.push({ provider: 'aarakshak', roles: faces.map((f) => f.role) });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 3));
      aarakshakTypes.push(...[...Buffer.from(init.body).toString('latin1').matchAll(/Content-Type: (image\/\w+)/g)].map((m) => m[1]));
      if (aarakshakFailOnce > 0) {
        aarakshakFailOnce -= 1;
        return new Response('temporarily unavailable', { status: 503 });
      }
      if (faces.some((face) => failingFaces.has(face.person))) return new Response('upstream error', { status: 500 });
      if (faces.some((face) => aarakshakNoFace.has(face.person))) return new Response(JSON.stringify({ detail: 'No detectable face in one of the images' }), { status: 422 });
      const same = faces.length === 2 && faces[0].person === faces[1].person;
      const group = faces.some((face) => groupFaces.has(face.person));
      return new Response(JSON.stringify({ score: same ? 0.9 : 0.02, source_faces: group ? [{}, {}] : [{}], target_faces: [{}] }), { status: 200 });
    } finally {
      inFlight -= 1;
    }
  }
  if (target.includes('amazonaws.com')) {
    const body = JSON.parse(init.body);
    const faces = [body.SourceImage.Bytes, body.TargetImage.Bytes].map((b) => facesIn(Buffer.from(b, 'base64').toString('latin1'))[0]);
    sent.push({ provider: 'rekognition', roles: faces.map((f) => f.role) });
    if (faces.some((face) => rekognitionFails.has(face.person))) return new Response('{"__type":"InternalServerError"}', { status: 500 });
    const same = faces[0].person === faces[1].person;
    const similarity = same ? (faces[0].person === 'Q' ? 40 : 95) : 1;
    return new Response(JSON.stringify({ SourceImageFace: {}, FaceMatches: similarity > 1 ? [{ Similarity: similarity }] : [] }), { status: 200 });
  }
  throw new Error(`unexpected fetch to ${target}`);
};
for (const key of [
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AARAKSHAK_API_KEY', 'AARAKSHAK_API_URL', 'KHOZO_REVERSE_MATCH_CANDIDATES',
  'KHOZO_MATCH_CANDIDATES', 'KHOZO_REKOGNITION_ENDPOINT', 'KHOZO_REKOGNITION_CONFIRM', 'KHOZO_SECOND_OPINION_TOP_N', 'AARAKSHAK_THRESHOLD',
]) delete process.env[key];

const store = new Map();
const caseRow = (id, person) => {
  store.set(`${id}.jpg`, photo(person, 'case'));
  return { id, status: 'missing', state: 'Gujarat', district: 'Ahmedabad', photoFile: `${id}.jpg` };
};
const sightingRow = (id, person) => {
  store.set(`${id}.jpg`, photo(person, 'sighting'));
  return sighting(id, 'Gujarat', 'Ahmedabad', 1, { photoFile: `${id}.jpg` });
};
const readPhoto = async (key) => store.get(key) || null;
const engineCases = [caseRow('r_P', 'P'), caseRow('r_Q', 'Q'), caseRow('r_R', 'R')];
const engineSightings = [sightingRow('f_P', 'P'), sightingRow('f_Q', 'Q'), sightingRow('f_S', 'S')];
const hints = { state: 'Gujarat', district: 'Ahmedabad' };
const both = { AARAKSHAK_API_KEY: 'k', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's' };

try {
  sent.length = 0;
  const reverseOnly = await rankSightingMatches({ AARAKSHAK_API_KEY: 'k' }, photo('P', 'case'), hints, { foundReports: engineSightings, readPhoto });
  check('reverse, Aarakshak only: the matching sighting is proposed first',
    reverseOnly.candidates[0]?.sighting?.id === 'f_P' && reverseOnly.candidates[0].score === 0.9 && reverseOnly.engine.biometric === true,
    reverseOnly.candidates.map((c) => `${c.sighting.id}:${c.score}`).join());
  check('reverse: the sighting photo is always the source',
    sent.length === 3 && sent.every((call) => call.roles.join() === 'sighting,case'), JSON.stringify(sent));
  check('reverse: the pool is reported', reverseOnly.engine.pool?.eligibleWithPhotos === 3, JSON.stringify(reverseOnly.engine.pool));

  sent.length = 0;
  const reverseConfirmed = await rankSightingMatches(both, photo('P', 'case'), hints, { foundReports: engineSightings, readPhoto });
  check('reverse, Rekognition configured: a candidate it confirms is kept',
    reverseConfirmed.candidates.map((c) => c.sighting.id).join() === 'f_P' && reverseConfirmed.engine.corroborated === true,
    reverseConfirmed.candidates.map((c) => c.sighting.id).join());
  check('reverse: the second opinion is asked the same way round',
    sent.filter((c) => c.provider === 'rekognition').every((c) => c.roles.join() === 'sighting,case'), JSON.stringify(sent));

  const reverseWithheld = await rankSightingMatches(both, photo('Q', 'case'), hints, { foundReports: engineSightings, readPhoto });
  check('reverse: a face Rekognition does not confirm is withheld', reverseWithheld.candidates.length === 0,
    reverseWithheld.candidates.map((c) => `${c.sighting.id}:${c.score}`).join());

  const forwardWithheld = await rankMatches(both, photo('Q', 'sighting'), hints, { reports: engineCases, readPhoto });
  check('forward: the same face is withheld the same way', forwardWithheld.candidates.length === 0);
  sent.length = 0;
  const forwardConfirmed = await rankMatches(both, photo('P', 'sighting'), hints, { reports: engineCases, readPhoto });
  check('forward: a confirmed face is kept, with the same score as the reverse search gave it',
    forwardConfirmed.candidates[0]?.report?.id === 'r_P' && forwardConfirmed.candidates[0].score === reverseConfirmed.candidates[0].score,
    `${forwardConfirmed.candidates[0]?.score} vs ${reverseConfirmed.candidates[0]?.score}`);
  check('forward: the sighting photo is the source', sent.every((call) => call.roles.join() === 'sighting,case'), JSON.stringify(sent));

  // Twelve stored sightings, one of whose comparisons fails.
  const many = Array.from({ length: 12 }, (_, i) => sightingRow(`f_many${i}`, i === 3 ? 'FAILS' : `M${i}`));
  failingFaces.add('FAILS');
  maxInFlight = 0;
  const realWarn = console.warn;
  console.warn = () => {};
  let wide;
  try {
    wide = await rankSightingMatches({ AARAKSHAK_API_KEY: 'k' }, photo('M0', 'case'), hints, { foundReports: many, readPhoto });
  } finally {
    console.warn = realWarn;
    failingFaces.clear();
  }
  check('the Worker engine keeps at most five provider calls in flight', maxInFlight >= 2 && maxInFlight <= 5, `max ${maxInFlight}`);
  check('it still compares every sighting in the budget', wide.engine.pool?.compared === 12 && wide.candidates[0]?.sighting?.id === 'f_many0',
    JSON.stringify(wide.engine.pool));
  check('and reports the comparisons that answered, not the ones attempted', wide.engine.comparedAgainst === 11, `comparedAgainst ${wide.engine.comparedAgainst}`);

  const nothingToCompare = await rankSightingMatches({ AARAKSHAK_API_KEY: 'k' }, photo('P', 'case'), hints, { foundReports: [], readPhoto });
  check('reverse with no stored sighting photos says so', nothingToCompare.candidates.length === 0 &&
    /No stored sighting photos/.test(nothingToCompare.engine.reason || ''), nothingToCompare.engine.reason);

  // --- No single-engine veto, and the "not checked" lane ---------------------------
  const quiet = console.warn;
  console.warn = () => {};
  try {
    // Aarakshak finds no face in the sighting: unknown, not a score of 0.
    // Rekognition compares it on its own, held to its confirmation bar.
    const noFaceCases = [...engineCases, caseRow('r_NF', 'NF')];
    aarakshakNoFace.add('NF');
    const noVeto = await rankMatches(both, photo('NF', 'sighting'), hints, { reports: noFaceCases, readPhoto });
    const lead = noVeto.candidates.find((c) => c.report.id === 'r_NF');
    check('Aarakshak finding no face is not a veto: Rekognition compares instead',
      lead?.secondOpinion === 'sole_engine' && lead.score === 0.95 && lead.engines?.aarakshak === 'no_face' && lead.engines?.rekognition === 'answered' &&
        lead.enginesAnswered.join() === 'rekognition' && noVeto.engine.biometric === true,
      JSON.stringify(lead || noVeto.engine));
    const aloneOnly = await rankMatches({ AARAKSHAK_API_KEY: 'k' }, photo('NF', 'sighting'), hints, { reports: noFaceCases.slice(0, 1), readPhoto });
    aarakshakNoFace.clear();
    check('with no second engine, "no face" everywhere is said as such, not as an outage',
      aloneOnly.candidates.length === 0 && aloneOnly.engine.biometric === false && aloneOnly.engine.noFace === true &&
        /No face could be found/.test(aloneOnly.engine.reason), JSON.stringify(aloneOnly.engine));

    // Rekognition is configured but does not answer: kept, flagged, never confirmed.
    rekognitionFails.add('P');
    const unanswered = await rankMatches(both, photo('P', 'sighting'), hints, { reports: engineCases, readPhoto });
    rekognitionFails.clear();
    const notChecked = unanswered.candidates.find((c) => c.report.id === 'r_P');
    check('a candidate Rekognition did not answer for is kept as an uncorroborated lead, flagged "not checked"',
      notChecked?.notChecked === true && notChecked.notCheckedReason === 'no_answer' && notChecked.corroborated === false && notChecked.confirmed === false &&
        notChecked.score === 0.9 && notChecked.enginesAnswered.join() === 'aarakshak' && unanswered.engine.secondOpinion?.notChecked >= 1,
      JSON.stringify(notChecked));

    // A WebP Rekognition cannot read: not asked, and said so.
    const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
    const webp = Buffer.concat([WEBP_HEAD, Buffer.from('FACE:P:sighting;')]);
    aarakshakTypes.length = 0;
    sent.length = 0;
    const webpResult = await rankMatches(both, webp, hints, { reports: engineCases, readPhoto });
    const webpLead = webpResult.candidates.find((c) => c.report.id === 'r_P');
    check('a WebP photo is matched by Aarakshak and lands in the "not checked" lane for Rekognition',
      webpLead?.notChecked === true && webpLead.notCheckedReason === 'unsupported_format' && !sent.some((c) => c.provider === 'rekognition'),
      JSON.stringify(webpLead));
    check('and is sent to Aarakshak as what it is', aarakshakTypes.includes('image/webp'), aarakshakTypes.slice(0, 4).join());

    // One transient fault is retried rather than losing the comparison.
    aarakshakFailOnce = 1;
    const retried = await rankMatches({ AARAKSHAK_API_KEY: 'k' }, photo('P', 'sighting'), hints, { reports: engineCases.slice(0, 1), readPhoto });
    check('the Worker retries Aarakshak once on a 5xx', retried.candidates[0]?.report?.id === 'r_P' && retried.engine.comparedAgainst === 1, JSON.stringify(retried.engine));
    aarakshakFailOnce = 0;
  } finally {
    console.warn = quiet;
  }

  // Every result carries the thresholds and settings it was produced under.
  const info = matchEngineInfo(both);
  check('every result is stored with its thresholds and engine settings',
    forwardConfirmed.engine.thresholds?.review === 0.35 && forwardConfirmed.engine.thresholds?.rekognitionConfirm === 0.8 &&
      configHashOf(forwardConfirmed.engine.settings) === configHashOf(info.settings) &&
      configHashOf(info.settings) !== configHashOf(matchEngineInfo({ AARAKSHAK_API_KEY: 'k' }).settings),
    JSON.stringify(forwardConfirmed.engine.thresholds));

  // The face screen: no single-engine veto there either, and it counts faces.
  aarakshakNoFace.add('SC');
  const screened = await detectPerson(both, photo('SC', 'case'));
  aarakshakNoFace.clear();
  check('the screen asks Rekognition when Aarakshak sees no face', screened.verdict === 'person' && screened.provider === 'aws-rekognition', JSON.stringify(screened));
  groupFaces.add('GR');
  const group = await detectPerson({ AARAKSHAK_API_KEY: 'k' }, photo('GR', 'case'));
  groupFaces.clear();
  check('the screen counts the faces in a group photo', group.verdict === 'person' && group.faces === 2, JSON.stringify(group));
} finally {
  globalThis.fetch = realFetch;
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Match pool checks passed.');
