/**
 * Checks adding police stations, control rooms, CWCs, NGOs and other desks
 * from a sheet (POST /api/dashboard/network/users/bulk,
 * shared/bulk-accounts.js), and activating those accounts:
 *
 *   - a dry run checks every row and changes nothing;
 *   - each desk may add only what it may add one at a time, in its own area;
 *   - a police station row sets the station's location, alert number and
 *     poster codes (shared/station-alerts.js); an NGO needs its registration;
 *   - new accounts get a one-time activation link, never a password; only a
 *     hash of the code is kept, and it works once, for a week;
 *   - uploading again updates contact and station details only, and sends a
 *     fresh link to anyone not yet active;
 *   - an account not yet active cannot sign in, and says why.
 *
 *   node scripts/bulk-accounts-smoke.mjs
 */

import process from 'node:process';

import registerDashboardRoutes from '../shared/routes/dashboard.js';
import registerAuthRoutes from '../shared/routes/auth.js';
import { ACTIVATION_DAYS, BULK_MAX_ROWS, checkActivation, roleFromSheet } from '../shared/bulk-accounts.js';
import { stationDesksFor } from '../shared/station-alerts.js';
import { publicUser } from '../worker/src/http/express-compat.js';
import { csvToSheet, parseCsv } from '../web/src/bulk/csv.js';
import { sheetRows } from '../web/src/bulk/accounts.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('Khozo accounts from a sheet\n');

check('roles are read the way people write them',
  roleFromSheet('Police Station') === 'police' && roleFromSheet('control room') === 'police' && roleFromSheet('C.W.C.') === 'cwc'
  && roleFromSheet('NGO') === 'ngo' && roleFromSheet('Child Welfare Committee') === 'cwc' && roleFromSheet('Sarpanch') === null);

// The console reads the sheet: headers as people write them, a title row
// above, latitude and longitude in columns of their own, blank rows skipped.
{
  const csv = [
    'Ahmedabad stations for Khozo,,,,,,,',
    'Officer name,Desk type,E-mail ID,Mobile No.,State,City,Thana,Latitude,Longitude,CUG,QR codes',
    'PI Naroda,Police station,pi.naroda@gujarat.test,9000000301,Gujarat,Ahmedabad,Naroda,23.0700,72.6550,9000000302,"naroda, naroda-gidc"',
    ',,,,,,,,,,',
    'Ahmedabad CWC,CWC,cwc@gujarat.test,,Gujarat,Ahmedabad,,,,,',
  ].join('\n');
  const read = sheetRows(csvToSheet(parseCsv(csv)));
  const first = read.rows?.[0] || {};
  check('the console finds the header under a title row', read.headerRow === 2 && read.rows.length === 2, JSON.stringify(read));
  check('it reads the columns by the names people use', first.name === 'PI Naroda' && first.role === 'Police station' && first.email === 'pi.naroda@gujarat.test' && first.district === 'Ahmedabad' && first.station === 'Naroda' && first.alertPhone === '9000000302');
  check('latitude and longitude in two columns become the location', first.location === '23.0700, 72.6550' && !('lat' in first));
  check('each row keeps its sheet row number', first.index === 3 && read.rows[1].index === 5);
  check('a sheet with no recognisable header is refused', sheetRows(csvToSheet(parseCsv('a,b,c\n1,2,3'))).error === 'header');
}

const GUJ_ADMIN = { id: 'u_guj', role: 'admin', name: 'Gujarat State Desk', email: 'gujarat.admin@khozo.test', passwordHash: 'x', jurisdiction: { level: 'state', state: 'Gujarat', stateCode: '24' } };
const GUJ_BUREAU = { id: 'u_scrb', role: 'crime_bureau', name: 'Gujarat SCRB', email: 'scrb@khozo.test', passwordHash: 'x', jurisdiction: { level: 'state', state: 'Gujarat', stateCode: '24' } };
const GUJ_NODAL = { id: 'u_nodal', role: 'state_nodal', name: 'Gujarat Nodal', email: 'nodal@khozo.test', passwordHash: 'x', jurisdiction: { level: 'state', state: 'Gujarat', stateCode: '24' } };
const ACTIVE_PI = {
  id: 'u_kal', role: 'police', name: 'PI Kalupur', email: 'pi.kalupur@gujarat.test', passwordHash: 'x', phone: '9000000101',
  jurisdiction: { level: 'station', state: 'Gujarat', district: 'Ahmedabad', station: 'Kalupur' },
};
const MUMBAI = { id: 'u_colaba', role: 'police', name: 'PI Colaba', email: 'pi.colaba@mh.test', passwordHash: 'x', jurisdiction: { level: 'station', state: 'Maharashtra', district: 'Mumbai', station: 'Colaba' } };

function harness() {
  const db = { users: [GUJ_ADMIN, GUJ_BUREAU, GUJ_NODAL, ACTIVE_PI, MUMBAI].map((u) => structuredClone(u)), audit: [] };
  const routes = [];
  const router = {
    use: () => router,
    ...Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) => [
      method,
      (path, ...handlers) => {
        routes.push({ method: method.toUpperCase(), path, handler: handlers.flat().at(-1) });
        return router;
      },
    ])),
  };
  const pass = (_req, _res, next) => next?.();
  const deps = {
    listReports: () => [], listFoundReports: () => [], listActivity: () => [], listAudit: () => db.audit,
    listUsers: () => db.users,
    findUserByEmail: (email) => db.users.find((u) => u.email === String(email).toLowerCase()) || null,
    addUser: (u) => { db.users.push(u); return u; },
    updateUser: (id, patch) => { const u = db.users.find((x) => x.id === id); if (u) Object.assign(u, patch); return u || null; },
    addAudit: (row) => db.audit.push(row),
    addActivity: () => {}, addNotification: () => {},
    listNotifications: async () => [], markNotificationsRead: async () => [],
    authRequired: pass, passwordChangeRequired: pass, requireRole: () => pass, publicUser,
    signToken: async (u) => `token-${u.id}`,
    auditPublicRateLimit: () => {}, clientIp: () => 'test', fixedWindowRateLimit: () => pass,
    settings: {},
  };
  registerDashboardRoutes(router, deps);
  registerAuthRoutes(router, deps);
  const call = async (method, path, { body = {}, params = {}, user = null } = {}) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`no route ${method} ${path}`);
    let status = 200;
    let payload = null;
    const res = {
      status(code) { status = code; return res; }, json(data) { payload = data; return res; },
      set() { return res; }, setHeader() { return res; }, type() { return res; }, send() { return res; }, end() { return res; },
    };
    await route.handler({ body, params, query: {}, headers: {}, user }, res);
    return { status, payload };
  };
  return { db, call, user: (id) => db.users.find((u) => u.id === id) };
}

const SHEET = [
  { name: 'PI Shahibaug', role: 'Police station', email: 'PI.Shahibaug@gujarat.test', phone: '079 2286 1234', state: 'Gujarat', district: 'Ahmedabad', station: 'Shahibaug', location: 'https://www.google.com/maps/@23.0561,72.6001,17z', alertPhone: '+91 90000 00201', posterCodes: 'civil-hospital, shahibaug' },
  { name: 'PSO Shahibaug', role: 'police', email: 'pso.shahibaug@gujarat.test', state: 'Gujarat', district: 'Ahmedabad', station: 'Shahibaug', location: '23.0561, 72.6001', phone: '9000000202' },
  { name: 'Ahmedabad City Control Room', role: 'Control room', email: 'cr.ahmedabad@gujarat.test', state: 'Gujarat', district: 'Ahmedabad', alertPhone: '9000000100' },
  { name: 'Ahmedabad CWC', role: 'CWC', email: 'cwc.ahd@gujarat.test', state: 'Gujarat', district: 'Ahmedabad' },
  { name: 'Saath Trust', role: 'NGO', email: 'saath@ngo.test', state: 'Gujarat', district: 'Ahmedabad', org: 'Saath Charitable Trust', ngoRegistration: 'F/1234/Ahmedabad', ngoDarpanId: 'GJ/2017/0123456' },
  { name: 'No Registration NGO', role: 'NGO', email: 'noreg@ngo.test', state: 'Gujarat', district: 'Ahmedabad' },
  { name: 'Duplicate', role: 'police', email: 'pso.shahibaug@gujarat.test', state: 'Gujarat', district: 'Ahmedabad', station: 'Shahibaug' },
  { name: 'Unknown role', role: 'Sarpanch', email: 'sarpanch@village.test', state: 'Gujarat', district: 'Ahmedabad' },
  { name: 'CWC with a place', role: 'CWC', email: 'cwc.place@gujarat.test', state: 'Gujarat', district: 'Ahmedabad', location: '23.03, 72.60' },
  { name: 'Pune station', role: 'police', email: 'pi.pune@mh.test', state: 'Maharashtra', district: 'Pune', station: 'Shivajinagar' },
  { name: 'Bad district', role: 'police', email: 'pi.nowhere@gujarat.test', state: 'Gujarat', district: 'Atlantis', station: 'Nowhere' },
  { name: 'PI Kalupur', role: 'police', email: 'pi.kalupur@gujarat.test', state: 'Gujarat', district: 'Ahmedabad', station: 'Kalupur', location: '23.0300, 72.6010', alertPhone: '9000000111', posterCodes: 'kalupur' },
];

{
  const h = harness();
  const before = h.db.users.length;
  const dry = await h.call('POST', '/network/users/bulk', { body: { rows: SHEET, dryRun: true }, user: h.user('u_guj') });
  const byEmail = (r, email) => r.payload?.results?.find((x) => x.email === email.toLowerCase());
  check('a dry run checks every row', dry.status === 200 && dry.payload.results.length === SHEET.length, `HTTP ${dry.status} ${dry.payload?.error || ''}`);
  check('and changes nothing', h.db.users.length === before && h.db.audit.length === 0 && !h.user('u_kal').stationDesk);
  const s = dry.payload.summary;
  check('it says what would happen', s.create === 5 && s.update === 1 && s.error === 6, JSON.stringify(s));
  check('an NGO with no registration number is refused', /registration/.test(byEmail(dry, 'noreg@ngo.test')?.errors?.join()));
  check('an email twice in the sheet is refused', /another row/.test(byEmail(dry, 'pso.shahibaug@gujarat.test')?.errors?.join() || dry.payload.results[6]?.errors?.join()));
  check('a role Khozo does not know is refused', /Sarpanch/.test(byEmail(dry, 'sarpanch@village.test')?.errors?.join()));
  check('a CWC cannot be given a station location', /Only a police station/.test(byEmail(dry, 'cwc.place@gujarat.test')?.errors?.join()));
  check('a Gujarat desk cannot add a Pune station', byEmail(dry, 'pi.pune@mh.test')?.action === 'error');
  check('a district that does not exist is refused', byEmail(dry, 'pi.nowhere@gujarat.test')?.action === 'error', byEmail(dry, 'pi.nowhere@gujarat.test')?.errors?.join());
  check('a row for an existing station updates it', byEmail(dry, 'pi.kalupur@gujarat.test')?.action === 'update' && byEmail(dry, 'pi.kalupur@gujarat.test').changes.includes('stationDesk'));
  check('a police login with no station is noted as district-wide', byEmail(dry, 'cr.ahmedabad@gujarat.test')?.action === 'create' && !byEmail(dry, 'cr.ahmedabad@gujarat.test').warnings.length);

  const run = await h.call('POST', '/network/users/bulk', { body: { rows: SHEET }, user: h.user('u_guj') });
  check('the good rows are created and the rest skipped', run.status === 200 && run.payload.summary.create === 5 && run.payload.summary.error === 6, JSON.stringify(run.payload?.summary));
  const pi = h.db.users.find((u) => u.email === 'pi.shahibaug@gujarat.test');
  check('the email is kept in lower case', Boolean(pi));
  check('no password is set or returned', pi && pi.passwordHash === null && !JSON.stringify(run.payload).match(/password/i));
  check('only a hash of the activation code is kept', pi?.activation?.codeHash?.length === 64 && !JSON.stringify(pi).includes(new URL(byEmail(run, 'pi.shahibaug@gujarat.test').activationLink).searchParams.get('c')));
  const link = byEmail(run, 'pi.shahibaug@gujarat.test')?.activationLink || '';
  check('each new account gets an activation link for a week', /^https:\/\/khozo\.org\/activate\?e=pi\.shahibaug%40gujarat\.test&c=/.test(link) && Math.round((byEmail(run, 'pi.shahibaug@gujarat.test').activationExpiresAt - Date.now()) / 86400000) === ACTIVATION_DAYS, link);
  check('the station gets its location, alert number and poster codes', pi?.stationDesk?.lat === 23.0561 && pi.alertPhone === '+919000000201' && pi.stationDesk.posterCodes.join() === 'civil-hospital,shahibaug' && pi.phone === '07922861234');
  check('the control room covers the district with no station', h.db.users.find((u) => u.email === 'cr.ahmedabad@gujarat.test')?.jurisdiction?.station === null);
  const ngo = h.db.users.find((u) => u.email === 'saath@ngo.test');
  check('the NGO is recorded with its registration, vouched for by the desk that added it', ngo?.ngo?.registrationNo === 'F/1234/Ahmedabad' && ngo.ngo.darpanId === 'GJ/2017/0123456' && ngo.ngo.verifiedById === 'u_guj');
  check('the existing Kalupur station gets its location and number, nothing else', h.user('u_kal').stationDesk?.lat === 23.03 && h.user('u_kal').alertPhone === '9000000111' && h.user('u_kal').name === 'PI Kalupur' && h.user('u_kal').passwordHash === 'x');
  check('and no new link, being already active', !byEmail(run, 'pi.kalupur@gujarat.test')?.activationLink);
  check('every change is audited', h.db.audit.filter((a) => a.action === 'auth.privileged_user_provisioned' && a.metadata?.bulk).length === 5 && h.db.audit.some((a) => a.action === 'auth.user_updated_from_sheet'));
  check('a sighting near Shahibaug now goes to both its logins', stationDesksFor({ lat: 23.057, lng: 72.6 }, h.db.users).map((p) => p.user.email).sort().join() === 'pi.shahibaug@gujarat.test,pso.shahibaug@gujarat.test');

  const roster = await h.call('GET', '/network', { user: h.user('u_guj') });
  const row = roster.payload?.users?.find((u) => u.email === 'pi.shahibaug@gujarat.test');
  check('the roster shows who has not activated yet', row?.awaitingActivation === true && row.activationExpiresAt > Date.now() && !JSON.stringify(roster.payload).includes('codeHash'));

  // Signing in and activating.
  const login = await h.call('POST', '/login', { body: { email: 'pi.shahibaug@gujarat.test', password: 'anything-at-all' } });
  check('an account not yet active cannot sign in, and is told why', login.status === 403 && login.payload?.code === 'activation_required');
  const code = new URL(link).searchParams.get('c');
  const wrong = await h.call('POST', '/activate/check', { body: { email: 'pi.shahibaug@gujarat.test', code: 'not-the-code' } });
  check('a wrong code does not work', wrong.status === 404);
  const look = await h.call('POST', '/activate/check', { body: { email: 'PI.Shahibaug@gujarat.test', code } });
  check('the link names the account before the password is set', look.status === 200 && look.payload?.name === 'PI Shahibaug' && /Shahibaug/.test(look.payload.place));
  const short = await h.call('POST', '/activate', { body: { email: 'pi.shahibaug@gujarat.test', code, password: 'short' } });
  check('a short password is refused', short.status === 400);
  const done = await h.call('POST', '/activate', { body: { email: 'pi.shahibaug@gujarat.test', code, password: 'Kalupur#2026safe' } });
  check('the officer sets a password and is signed in', done.status === 200 && done.payload?.token === `token-${pi.id}` && pi.passwordHash && pi.activation === null);
  check('the API never returns the activation record', !('activation' in (done.payload?.user || {})));
  const again = await h.call('POST', '/activate', { body: { email: 'pi.shahibaug@gujarat.test', code, password: 'Another#2026pass' } });
  check('the link works once', again.status === 404);
  const signIn = await h.call('POST', '/login', { body: { email: 'pi.shahibaug@gujarat.test', password: 'Kalupur#2026safe' } });
  check('they then sign in as usual', signIn.status === 200);
  check('activation is audited', h.db.audit.some((a) => a.action === 'auth.account_activated' && a.targetId === pi.id));

  // A lapsed link, and the sheet uploaded again.
  const pso = h.db.users.find((u) => u.email === 'pso.shahibaug@gujarat.test');
  const oldCode = new URL(byEmail(run, 'pso.shahibaug@gujarat.test').activationLink).searchParams.get('c');
  pso.activation.expiresAt = Date.now() - 1000;
  const lapsed = await h.call('POST', '/activate', { body: { email: pso.email, code: oldCode, password: 'Whatever#2026' } });
  check('a link older than a week has expired', lapsed.status === 410 && lapsed.payload?.code === 'activation_expired');
  const reupload = await h.call('POST', '/network/users/bulk', { body: { rows: SHEET.slice(0, 2) }, user: h.user('u_guj') });
  const fresh = byEmail(reupload, 'pso.shahibaug@gujarat.test');
  check('uploading again sends a fresh link to whoever is not active', fresh?.action === 'update' && /activate/.test(fresh.activationLink || '') && checkActivation(pso, oldCode) === 'invalid');
  check('and nothing to someone already active', byEmail(reupload, 'pi.shahibaug@gujarat.test')?.action === 'unchanged' && !byEmail(reupload, 'pi.shahibaug@gujarat.test').activationLink);
}

// Who may add what.
{
  const h = harness();
  const bureau = await h.call('POST', '/network/users/bulk', { body: { rows: [{ name: 'CWC', role: 'cwc', email: 'cwc2@gujarat.test', state: 'Gujarat', district: 'Ahmedabad' }] }, user: h.user('u_scrb') });
  check('the crime records bureau adds police desks, not a CWC', bureau.payload?.results?.[0]?.action === 'error');
  const nodal = await h.call('POST', '/network/users/bulk', { body: { rows: [{ name: 'PS', role: 'police', email: 'ps2@gujarat.test', state: 'Gujarat', district: 'Ahmedabad', station: 'Naroda' }] }, user: h.user('u_nodal') });
  check('the state nodal officer adds welfare desks, never a police login', nodal.payload?.results?.[0]?.action === 'error');
  const nodalNgo = await h.call('POST', '/network/users/bulk', { body: { rows: [{ name: 'NGO', role: 'ngo', email: 'ngo2@ngo.test', state: 'Gujarat', district: 'Ahmedabad', ngoRegistration: 'E/99/AHD' }] }, user: h.user('u_nodal') });
  check('but may add a verified NGO', nodalNgo.payload?.results?.[0]?.action === 'create', JSON.stringify(nodalNgo.payload?.results?.[0]?.errors));
  const outside = await h.call('POST', '/network/users/bulk', { body: { rows: [{ name: 'PI Colaba', role: 'police', email: 'pi.colaba@mh.test', alertPhone: '9000000999' }] }, user: h.user('u_guj') });
  check('a Gujarat desk cannot change a Mumbai station by naming its email', outside.payload?.results?.[0]?.action === 'error' && !h.user('u_colaba').alertPhone);
  const tooMany = await h.call('POST', '/network/users/bulk', { body: { rows: Array.from({ length: BULK_MAX_ROWS + 1 }, (_, i) => ({ name: `x${i}` })) }, user: h.user('u_guj') });
  check(`at most ${BULK_MAX_ROWS} rows a request`, tooMany.status === 400);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
