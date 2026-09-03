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
function harness({ verdict, fetchImpl } = {}) {
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
    rankMatches: async () => ({ candidates: [], engine: { provider: 'stub', modelVersion: null, biometric: false } }),
    detectPerson: async () => ({ verdict, faces: verdict === 'person' ? 1 : 0, provider: 'stub', checkedAt: Date.now() }),
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

const photo = { buffer: Buffer.from('not-really-a-jpeg-but-a-buffer'), mimetype: 'image/jpeg', size: 30 };
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
    rolesOf(notifications).join(',') === 'admin,cwc,ngo,police,super_admin',
    rolesOf(notifications).join(',')
  );
  check('the parent account is not alerted', !rolesOf(notifications).includes('parent'));
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
    rolesOf(notifications).join(',') === 'admin,cwc,ngo,police,super_admin',
    rolesOf(notifications).join(',')
  );
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

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Intake screening checks passed.');
