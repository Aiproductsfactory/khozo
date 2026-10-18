/**
 * Checks what happens to an upload between arriving and reaching an officer:
 * whether it is screened as a person, where its jurisdiction comes from, and
 * who is told about it.
 *
 * The sighting endpoint is public and unauthenticated, so it receives whatever
 * a camera was pointed at. Two rules have to hold, and they pull against each
 * other:
 *
 *   * A photo with no person in it must not alert every authority in the
 *     country, or officers learn to ignore the alert that matters.
 *   * It must still reach a human, because the screen can be wrong and a
 *     discarded real sighting is a child nobody looks for.
 *
 * The route handler is called directly with stubbed dependencies, so this runs
 * with no server, no database, no face-recognition provider and no geocoder.
 *
 *   node scripts/intake-screening-smoke.mjs
 */

import process from 'node:process';

import registerReportRoutes from '../shared/routes/reports.js';
import { resolveSightingLocation } from '../shared/geocode.js';
import { screenPhoto } from '../shared/match-pipeline.js';
import { sightingScreenVerdict } from '../shared/face-screen.js';
import { isReverseMatchCandidate } from '../shared/match-pool.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** Captures route registrations so a handler can be called directly. */
function recorder() {
  const routes = [];
  const router = {
    use: () => router,
    ...Object.fromEntries(
      ['get', 'post', 'put', 'patch', 'delete'].map((method) => [
        method,
        (path, ...handlers) => {
          routes.push({ method: method.toUpperCase(), path, handler: handlers.flat().at(-1) });
          return router;
        },
      ])
    ),
  };
  return { router, routes };
}

const AUTHORITIES = [
  { id: 'u_super', role: 'super_admin', name: 'National Desk', jurisdiction: {} },
  { id: 'u_admin', role: 'admin', name: 'State Admin', jurisdiction: { state: 'Assam' } },
  { id: 'u_police', role: 'police', name: 'Station', jurisdiction: { state: 'Assam', district: 'Kamrup Metropolitan' } },
  { id: 'u_cwc', role: 'cwc', name: 'CWC', jurisdiction: { state: 'Assam', district: 'Kamrup Metropolitan' } },
  { id: 'u_ngo', role: 'ngo', name: 'Partner NGO', jurisdiction: {} },
  { id: 'u_parent', role: 'parent', name: 'A parent', jurisdiction: {} },
];

/**
 * Registers the routes with stubs and returns the sighting handler plus the
 * notifications and records it produced.
 */
function harness({ verdict, screen, fetchImpl, matchResult } = {}) {
  const notifications = [];
  const sightings = [];

  const { router, routes } = recorder();
  registerReportRoutes(router, {
    listReports: () => [],
    listFoundReports: () => sightings,
    listUsers: () => AUTHORITIES,
    addFoundReport: (row) => sightings.push(row),
    addActivity: () => {},
    addAudit: () => {},
    addNotification: (row) => notifications.push(row),
    savePhoto: async (key) => key,
    readPhoto: async () => null,
    photoMimeType: () => 'image/jpeg',
    findReport: () => null,
    findFoundReport: (id) => sightings.find((s) => s.id === id) || null,
    addReport: () => {},
    updateReport: () => {},
    updateFoundReport: () => {},
    authRequired: (_req, _res, next) => next(),
    optionalAuth: (_req, _res, next) => next(),
    passwordChangeRequired: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
    auditPublicRateLimit: () => {},
    clientIp: () => 'test',
    fixedWindowRateLimit: () => (_req, _res, next) => next(),
    rankMatches: async () =>
      matchResult || { candidates: [], engine: { provider: 'stub', modelVersion: null, biometric: false } },
    detectPerson: async () => screen || ({ verdict, faces: verdict === 'person' ? 1 : 0, provider: 'stub', checkedAt: Date.now() }),
    upload: { single: () => (_req, _res, next) => next() },
    fetchImpl,
    settings: {},
  });

  const route = routes.find((r) => r.method === 'POST' && r.path === '/found');
  return { handler: route.handler, notifications, sightings };
}

/** Minimal Express-shaped request/response for one handler call. */
async function submit(handler, { body, file }) {
  const req = { body, file, params: {}, query: {}, headers: {}, user: null };
  let status = 200;
  let payload = null;
  const res = {
    status(code) {
      status = code;
      return res;
    },
    json(data) {
      payload = data;
      return res;
    },
  };
  await handler(req, res);
  return { status, payload };
}

// A JPEG's first bytes, so the upload passes the format check; the stubbed
// engines never decode it.
const photoBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.from('not-really-a-jpeg')]);
const photo = { buffer: photoBytes, mimetype: 'image/jpeg', size: photoBytes.length };
const baseBody = { foundLocation: 'Near the ferry ghat', photoConsent: 'true', reporterName: 'Passer-by' };
const rolesOf = (notifications) =>
  [...new Set(notifications.map((n) => AUTHORITIES.find((u) => u.id === n.userId)?.role))].sort();

console.log('Khozo intake screening and routing\n');

// --- a photo with a person in it -------------------------------------------
{
  const { handler, notifications, sightings } = harness({ verdict: 'person' });
  const res = await submit(handler, { body: { ...baseBody }, file: photo });
  check('a photo with a person is accepted', res.status === 201, `HTTP ${res.status}`);
  check('it is screened as a person', sightings[0]?.screening?.verdict === 'person');
  check('it raises the general alert', sightings[0]?.screening?.raisesAlert === true);
  check(
    'every authority is alerted',
    rolesOf(notifications).join(',') === 'admin,cwc,police,super_admin',
    rolesOf(notifications).join(',')
  );
  check('the parent account is not alerted', !rolesOf(notifications).includes('parent'));
  // Anyone can register an NGO account with a phone number; an inbox of
  // sightings would tell the person who sent one what became of it.
  check('the NGO account is not alerted', !rolesOf(notifications).includes('ngo'));
}

// --- a photo with no person in it ------------------------------------------
{
  const { handler, notifications, sightings } = harness({ verdict: 'no_person' });
  const res = await submit(handler, { body: { ...baseBody }, file: photo });
  check('a photo with no person is still accepted', res.status === 201, `HTTP ${res.status}`);
  check('it is screened as no person', sightings[0]?.screening?.verdict === 'no_person');
  check('it does not raise the general alert', sightings[0]?.screening?.raisesAlert === false);
  check(
    'only the super admin is alerted',
    rolesOf(notifications).join(',') === 'super_admin',
    rolesOf(notifications).join(',') || '(nobody)'
  );
  check('it is not discarded — the record is kept for review', sightings.length === 1);
  check('the alert says why it was held back', /no recognisable person/i.test(notifications[0]?.body || ''));
}

// --- the screen could not run ----------------------------------------------
{
  const { handler, notifications, sightings } = harness({ verdict: 'unverified' });
  await submit(handler, { body: { ...baseBody }, file: photo });
  check('an unscreened photo is treated like an unrecognised one', sightings[0]?.screening?.raisesAlert === false);
  check(
    'and reaches the super admin rather than nobody',
    rolesOf(notifications).join(',') === 'super_admin',
    rolesOf(notifications).join(',') || '(nobody)'
  );
  check('the alert says it could not be screened', /could not be screened/i.test(notifications[0]?.body || ''));
}

// --- a text report has no photo to screen ----------------------------------
{
  const { handler, notifications, sightings } = harness({ verdict: 'no_photo' });
  await submit(handler, { body: { ...baseBody, note: 'Child alone by the gate, about seven.' }, file: null });
  check('a text-only report alerts on its own terms', sightings[0]?.screening?.raisesAlert === true);
  check(
    'so every authority is alerted',
    rolesOf(notifications).join(',') === 'admin,cwc,police,super_admin',
    rolesOf(notifications).join(',')
  );
}

// --- only a face comparison may produce a match -----------------------------
//
// A non-biometric scorer once returned `0.45 + hash(photo bytes) * 0.5` for
// every open case. Those numbers cleared the review threshold and were shown to
// officers as match confidence: an adult man was presented as an 83% match to a
// missing girl, above a button reading "Confirm Match & Reunite".
{
  const { handler, sightings } = harness({
    verdict: 'person',
    matchResult: {
      // A high score from something that did not compare faces.
      candidates: [{ report: { id: 'r_1', childName: 'Some Child', state: 'Assam', district: 'Kamrup Metropolitan' }, score: 0.83 }],
      engine: { provider: 'local-heuristic', modelVersion: 'heuristic', biometric: false },
    },
  });
  await submit(handler, { body: { ...baseBody }, file: photo });
  check('a non-biometric score never becomes a match', sightings[0]?.matchedReportId === null, `got ${sightings[0]?.matchedReportId}`);
  check('and never routes a sighting to police review', sightings[0]?.status === 'no_match', `got ${sightings[0]?.status}`);
  check('the engine that ran is recorded on the sighting', sightings[0]?.matchEngine?.biometric === false);
}

{
  const { handler, sightings, notifications } = harness({
    verdict: 'person',
    matchResult: {
      candidates: [{ report: { id: 'r_1', childName: 'Some Child', state: 'Assam', district: 'Kamrup Metropolitan' }, score: 0.83, confirmed: true }],
      engine: { provider: 'aarakshak-live-v1', modelVersion: 'v1.82', biometric: true },
    },
  });
  const res = await submit(handler, { body: { ...baseBody, state: 'Meghalaya', district: 'East Khasi Hills' }, file: photo });
  check('a biometric score above the threshold does become a match', sightings[0]?.matchedReportId === 'r_1');
  check('and routes to police review', sightings[0]?.status === 'pending_review', `got ${sightings[0]?.status}`);
  check('recording that the comparison was biometric', sightings[0]?.matchEngine?.biometric === true);
  check('the reporter gets the neutral receipt, with their own place', res.payload?.foundReport?.status === 'received' && res.payload.foundReport.district === 'East Khasi Hills', JSON.stringify(res.payload?.foundReport));

  // Only the police officers who can open the matched case are told it may
  // match. Every other desk gets the alert an unmatched sighting raises, worded
  // from where the reporter was; parent and NGO accounts get nothing.
  const byRole = (role) => notifications.filter((n) => AUTHORITIES.find((u) => u.id === n.userId)?.role === role);
  const matchedRoles = [...new Set(notifications.filter((n) => n.scope?.matched === true).map((n) => AUTHORITIES.find((u) => u.id === n.userId)?.role))].sort();
  check("the possible match goes to the case's police officers only", matchedRoles.join(',') === 'admin,police,super_admin', matchedRoles.join(','));
  const cwcAlert = byRole('cwc')[0];
  check(
    'the CWC desk gets the ordinary alert, not the match',
    byRole('cwc').length === 1 && cwcAlert.scope.matched === false && cwcAlert.priority === 'normal' && cwcAlert.title === 'Child spotted',
    JSON.stringify(cwcAlert)
  );
  check(
    "worded from where the reporter was, not the case's district",
    /East Khasi Hills/.test(cwcAlert?.body || '') && !/Kamrup/.test(JSON.stringify(cwcAlert)),
    cwcAlert?.body
  );
  check('no parent or NGO account is alerted', !byRole('ngo').length && !byRole('parent').length);
}

// --- jurisdiction from the phone's coordinates ------------------------------
const nominatim = (address) => async () => ({
  ok: true,
  json: async () => ({ address, display_name: 'somewhere' }),
});

{
  const resolved = await resolveSightingLocation(
    { lat: 26.1445, lng: 91.7362 },
    { fetchImpl: nominatim({ state: 'Assam', state_district: 'Kamrup Metropolitan' }) }
  );
  check('coordinates resolve to a state', resolved.state === 'Assam', `got ${resolved.state}`);
  check('and a district', resolved.district === 'Kamrup Metropolitan', `got ${resolved.district}`);
  check('the source is recorded as the coordinates', resolved.source === 'coordinates');
}

{
  const resolved = await resolveSightingLocation(
    { lat: 26.1445, lng: 91.7362, state: 'Meghalaya' },
    { fetchImpl: nominatim({ state: 'Assam', state_district: 'Kamrup Metropolitan' }) }
  );
  check('what the reporter typed wins over the phone fix', resolved.state === 'Meghalaya', `got ${resolved.state}`);
}

{
  const resolved = await resolveSightingLocation(
    { lat: 19.076, lng: 72.877 },
    { fetchImpl: nominatim({ state: 'Orissa', county: 'Khordha' }) }
  );
  check('an older state spelling is canonicalised', resolved.state === 'Odisha', `got ${resolved.state}`);
}

{
  const failing = async () => {
    throw new Error('network down');
  };
  const resolved = await resolveSightingLocation({ lat: 26.1445, lng: 91.7362 }, { fetchImpl: failing });
  check('a geocoder outage leaves the sighting unlocated rather than failing', resolved.state === null);
}

{
  const resolved = await resolveSightingLocation(
    { lat: 'not-a-number', lng: 91.7362 },
    { fetchImpl: nominatim({ state: 'Assam' }) }
  );
  check('a malformed coordinate is ignored', resolved.state === null);
}

{
  const { handler, sightings } = harness({
    verdict: 'person',
    fetchImpl: nominatim({ state: 'Assam', state_district: 'Kamrup Metropolitan' }),
  });
  await submit(handler, { body: { ...baseBody, lat: '26.1445', lng: '91.7362' }, file: photo });
  check('an uploaded sighting is routed by its coordinates', sightings[0]?.state === 'Assam', `got ${sightings[0]?.state}`);
  check('and records where its location came from', sightings[0]?.locationSource === 'coordinates');
}

// --- a face in the background is not a person in the photo -----------------
//
// A photo of a signboard on a pavement, with passers-by thirty metres behind
// it, was screened as "person detected": Aarakshak found one of their faces.
// A face the engine itself calls small or unclear counts only when a second
// engine also finds one, and an officer's own reading overrides either.
{
  const face = (extra = {}) => ({ status: 'answered', score: 1, sourceFaces: 1, targetFaces: 1, sourceQuality: 0.9, warnings: [], ...extra });
  const engine = (result) => ({ ready: true, calls: 0, async compare() { this.calls += 1; return result; } });
  const off = { ready: false, async compare() { throw new Error('not configured'); } };

  const clear = await screenPhoto(photoBytes, { aarakshak: engine(face()), rekognition: off });
  check('a clear face is a person', clear.verdict === 'person' && clear.clearFace === true && sightingScreenVerdict(clear) === 'person');

  const small = await screenPhoto(photoBytes, { aarakshak: engine(face({ warnings: ['face_small_in_frame'] })), rekognition: off });
  check('a face the engine calls small, with no second engine, is not a clear person', small.clearFace === false && sightingScreenVerdict(small) === 'unclear_face', JSON.stringify({ clearFace: small.clearFace }));

  const faint = await screenPhoto(photoBytes, { aarakshak: engine(face({ sourceQuality: 0.21 })), rekognition: off });
  check('a low-quality face is not a clear person', sightingScreenVerdict(faint) === 'unclear_face');

  const second = engine(face());
  const confirmed = await screenPhoto(photoBytes, { aarakshak: engine(face({ warnings: ['low_detector_confidence'] })), rekognition: second });
  check('a weak face a second engine also finds is a person', sightingScreenVerdict(confirmed) === 'person' && second.calls === 1);

  const disputed = await screenPhoto(photoBytes, {
    aarakshak: engine(face({ warnings: ['face_too_small'] })),
    rekognition: engine({ status: 'no_face', warnings: ['no_face_detected'] }),
  });
  check('a weak face a second engine cannot find is not a person', sightingScreenVerdict(disputed) === 'unclear_face' && disputed.secondEngine?.status === 'no_face');

  const unasked = engine(face());
  await screenPhoto(photoBytes, { aarakshak: engine(face()), rekognition: unasked });
  check('a clear face does not spend a second engine call', unasked.calls === 0);

  check('a record screened before clearFace existed is judged by its stored quality',
    sightingScreenVerdict({ verdict: 'person', faces: 1, quality: 0.3, warnings: [] }) === 'unclear_face'
    && sightingScreenVerdict({ verdict: 'person', faces: 1, quality: 0.92, warnings: [] }) === 'person');

  // The route: an unclear face reaches one reviewer, not every desk.
  const { handler, notifications, sightings } = harness({ screen: small });
  await submit(handler, { body: { ...baseBody }, file: photo });
  check('an unclear face does not raise the general alert', sightings[0]?.screening?.raisesAlert === false);
  check('it reaches the super admin for review', rolesOf(notifications).join(',') === 'super_admin', rolesOf(notifications).join(',') || '(nobody)');
  check('the alert says there was no clear person', /no clear person/i.test(notifications[0]?.body || ''), notifications[0]?.body);

  // The officer's correction, recorded over the engine's reading.
  const officer = { id: 'u_police', role: 'police', name: 'PSI Station', jurisdiction: { state: 'Assam', district: 'Kamrup Metropolitan' } };
  const sighting = { id: 'f_board', status: 'pending_review', state: 'Assam', district: 'Kamrup Metropolitan', photoFile: 'f_board.jpg', screening: { ...clear } };
  const audit = [];
  const { router, routes } = recorder();
  registerReportRoutes(router, {
    listReports: () => [],
    listFoundReports: () => [sighting],
    listUsers: () => AUTHORITIES,
    findFoundReport: (id) => (id === sighting.id ? sighting : null),
    updateFoundReport: (_id, patch) => Object.assign(sighting, patch),
    addAudit: (row) => audit.push(row),
    addActivity: () => {},
    addNotification: () => {},
    authRequired: (_req, _res, next) => next(),
    optionalAuth: (_req, _res, next) => next(),
    passwordChangeRequired: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
    fixedWindowRateLimit: () => (_req, _res, next) => next(),
    upload: { single: () => (_req, _res, next) => next() },
    settings: {},
  });
  const correct = routes.find((r) => r.method === 'POST' && r.path === '/found/:id/screening').handler;
  const call = async (verdict) => {
    let status = 200;
    let payload = null;
    const res = { status(c) { status = c; return res; }, json(d) { payload = d; return res; } };
    await correct({ params: { id: sighting.id }, body: { verdict }, user: officer, query: {}, headers: {} }, res);
    return { status, payload };
  };
  const marked = await call('no_person');
  check('an officer can record that a photo shows no person', marked.status === 200 && sightingScreenVerdict(sighting.screening) === 'no_person', `HTTP ${marked.status}`);
  check('the correction names the officer and is audited', sighting.screening.officer?.byName === 'PSI Station' && audit.some((a) => a.action === 'sighting.screening_corrected'));
  check('the engine\'s own reading is kept beneath it', sighting.screening.verdict === 'person' && sighting.screening.clearFace === true);
  check('a sighting marked "no person" leaves the reverse search', !isReverseMatchCandidate({ ...sighting, createdAt: Date.now(), retentionUntil: new Date(Date.now() + 86400000).toISOString() }));
  const bad = await call('maybe');
  check('an unknown reading is refused', bad.status === 400);
  await call(null);
  check('withdrawing the correction restores the engine\'s reading', !sighting.screening.officer && sightingScreenVerdict(sighting.screening) === 'person');
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Intake screening checks passed.');
