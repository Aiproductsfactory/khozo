/**
 * Checks the gazetteer (shared/geo): that what citizens, officers, registers
 * and OpenStreetMap write for a state or a district - in English, Gujarati,
 * Hindi or Marathi, in any case, misspelt or under an old name - resolves to
 * the one place it means, and that what it does not mean resolves to nothing.
 *
 * No server, no database, no network.
 *
 *   node scripts/geo-smoke.mjs
 */
import process from 'node:process';

import {
  canonicalPlace,
  districtByCode,
  listDistricts,
  listStates,
  resolveDistrict,
  resolveState,
  STATES,
} from '../shared/geo/index.js';
import { DISTRICTS } from '../shared/geo/districts-data.js';
import { geoKey } from '../shared/geo/normalise.js';
import { resolveSightingLocation, reverseGeocode } from '../shared/geocode.js';
import { sameDistrict, sameState } from '../shared/scope.js';
import registerGeoRoutes from '../shared/routes/geo.js';
import registerReportRoutes from '../shared/routes/reports.js';
import registerDashboardRoutes from '../shared/routes/dashboard.js';
import khozoWorker from '../worker/index.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const stateIs = (text, code) => {
  const got = resolveState(text)?.code ?? null;
  check(`state ${JSON.stringify(text)} is ${code ?? 'nothing'}`, got === code, `got ${got}`);
};
const districtIs = (state, text, code) => {
  const got = resolveDistrict(state, text)?.code ?? null;
  check(`district ${JSON.stringify(text)} in ${state ?? 'India'} is ${code ?? 'nothing'}`, got === code, `got ${got}`);
};

console.log('Khozo gazetteer\n');

// --- The data ---------------------------------------------------------------
check('36 states and union territories', STATES.length === 36, String(STATES.length));
check('every state has an LGD code, an ISO code and names in four languages',
  STATES.every((s) => /^\d{1,2}$/.test(s.code) && /^[A-Z]{2}$/.test(s.iso) && s.name && s.gu && s.hi && s.mr));
check('state codes are unique', new Set(STATES.map((s) => s.code)).size === STATES.length);
check('every state has its districts', STATES.every((s) => (DISTRICTS[s.code] || []).length > 0),
  STATES.filter((s) => !(DISTRICTS[s.code] || []).length).map((s) => s.name).join(', '));
const allRows = Object.entries(DISTRICTS).flatMap(([state, rows]) => rows.map((row) => ({ state, row })));
check('every district has a code and names in four languages',
  allRows.every(({ row }) => row[0] && row[1] && row[2] && row[3] && row[4]));
check('district codes are unique across India', new Set(allRows.map(({ row }) => row[0])).size === allRows.length);
check('784 LGD districts', allRows.filter(({ row }) => /^\d+$/.test(row[0])).length === 784, String(allRows.length));
check('Gujarat has its 34 districts (Vav-Tharad included)', DISTRICTS['24'].filter((r) => /^\d+$/.test(r[0])).length === 34);
check('Maharashtra has its 36 districts', DISTRICTS['27'].filter((r) => /^\d+$/.test(r[0])).length === 36);
const strays = allRows.filter(({ state, row }) => resolveDistrict(state, row[1], { fuzzy: false })?.code !== row[0]);
check('every district\'s own English name resolves to it', !strays.length, strays.slice(0, 5).map(({ row }) => row[1]).join(', '));
const strayNames = allRows.flatMap(({ state, row }) => [row[2], row[3], row[4]]
  .filter((name) => resolveDistrict(state, name, { fuzzy: false })?.code !== row[0])
  .map((name) => `${row[1]}: ${name}`));
check('and so do its Gujarati, Hindi and Marathi names', strayNames.length === 0, strayNames.slice(0, 5).join('; '));

// --- States -----------------------------------------------------------------
for (const text of ['Gujarat', 'GUJARAT', 'gujarat ', ' Gujarat State', 'ગુજરાત', 'गुजरात', 'Gujrat', 'GJ', 'IN-GJ', '24']) stateIs(text, '24');
for (const text of ['Maharashtra', 'महाराष्ट्र', 'મહારાષ્ટ્ર', 'Maharastra', 'MH', '27']) stateIs(text, '27');
stateIs('Orissa', '21');
stateIs('Pondicherry', '34');
stateIs('Uttaranchal', '5');
stateIs('NCT of Delhi', '7');
stateIs('IN-TG', '36');
stateIs('Jammu & Kashmir', '1');
stateIs('Dadra and Nagar Haveli', '38');
stateIs('ಕರ್ನಾಟಕ', '29');
stateIs('Atlantis', null);
stateIs('', null);

// --- Districts: Gujarat -----------------------------------------------------
for (const text of ['Ahmedabad', 'AHMEDABAD', 'ahmedabad district', 'Ahmadabad District', 'Ahmadabad', 'Amdavad', 'Ahmdabad', 'Ahemdabad', 'Ahmedabad City', 'અમદાવાદ', 'અમદાવાદ જિલ્લો', 'अहमदाबाद', 'अमदावाद', '438']) {
  districtIs('24', text, '438');
}
districtIs('Gujarat', 'અમદાવાદ', '438');
districtIs('ગુજરાત', 'Ahmadabad', '438');
for (const text of ['Vadodara', 'Baroda', 'Vadodra', 'વડોદરા', 'वडोदरा']) districtIs('24', text, '461');
for (const text of ['Kachchh', 'Kutch', 'કચ્છ', 'कच्छ']) districtIs('24', text, '449');
for (const text of ['Banas Kantha', 'Banaskantha', 'બનાસકાંઠા']) districtIs('24', text, '441');
for (const text of ['Mahesana', 'Mehsana', 'મહેસાણા']) districtIs('24', text, '451');
districtIs('24', 'Surat', '459');
districtIs('24', 'Rajkot District', '457');
districtIs('24', 'રાજકોટ', '457');
districtIs('24', 'Vav-Tharad', '789');
// A separate police jurisdiction, deliberately not Ahmedabad.
districtIs('24', 'Ahmedabad Rural', '24-ahmedabad-rural');
districtIs('24', 'અમદાવાદ ગ્રામ્ય', '24-ahmedabad-rural');
// Not districts of Gujarat, and not guessed at.
districtIs('24', 'Mumbai', null);
districtIs('24', 'Maninagar', null);
districtIs('24', 'Nadiad', null);
districtIs('24', 'Patna', null);
districtIs('24', 'District', null);

// --- Districts: Maharashtra -------------------------------------------------
for (const text of ['Mumbai', 'Mumbai City', 'Bombay', 'Greater Mumbai', 'मुंबई', 'મુંબઈ']) districtIs('27', text, '482');
for (const text of ['Mumbai Suburban', 'Mumbai Suburban District', 'मुंबई उपनगर']) districtIs('27', text, '483');
for (const text of ['Navi Mumbai', 'नवी मुंबई', 'New Bombay']) districtIs('27', text, '27-navi-mumbai');
for (const text of ['Pune', 'Poona', 'पुणे', 'પુણે', 'Pune District']) districtIs('27', text, '490');
for (const text of ['Thane', 'Thana', 'ठाणे', 'થાણે']) districtIs('27', text, '497');
for (const text of ['Chhatrapati Sambhajinagar', 'Aurangabad', 'औरंगाबाद', 'छत्रपती संभाजीनगर']) districtIs('27', text, '469');
for (const text of ['Ahilyanagar', 'Ahmednagar', 'अहमदनगर']) districtIs('27', text, '466');
for (const text of ['Dharashiv', 'Osmanabad']) districtIs('27', text, '488');
for (const text of ['Nagpur', 'नागपूर', 'नागपुर', 'નાગપુર']) districtIs('27', text, '484');
districtIs('27', 'जिल्हा कोल्हापूर', '480');
districtIs('27', 'Kolhapoor', '480');
districtIs('27', 'Sholapur', '496');

// --- Districts elsewhere, and the same name in two states --------------------
districtIs('10', 'Aurangabad', '189');
districtIs('29', 'Bangalore', '525');
districtIs('29', 'Bengaluru', '525');
districtIs('29', 'Bangalore Rural', '526');
districtIs('18', 'Kamrup Metropolitan', '618');
districtIs('33', 'Nilgiris', '587');
districtIs('6', 'Gurgaon', '62');
// With no state, only a name that is one place in all of India resolves.
districtIs(null, 'Ahmedabad', '438');
districtIs(null, 'અમદાવાદ', '438');
districtIs(null, 'Aurangabad', null);
districtIs('Atlantis', 'Ahmedabad', null);

// --- Canonical places, as every write stores them ---------------------------
{
  const place = canonicalPlace({ state: 'ગુજરાત', district: 'Ahmadabad District' });
  check('a Gujarati state and an OpenStreetMap district become canonical names and codes',
    place.state === 'Gujarat' && place.stateCode === '24' && place.district === 'Ahmedabad' && place.districtCode === '438' && place.districtText === null,
    JSON.stringify(place));
}
{
  const place = canonicalPlace({ state: 'GUJARAT', district: 'Maninagar' });
  check('an unrecognised district is kept as text, with the district left empty',
    place.stateCode === '24' && place.district === null && place.districtCode === null && place.districtText === 'Maninagar',
    JSON.stringify(place));
}
{
  const place = canonicalPlace({ district: 'Ahmedabad' });
  check('a district that is one place in India supplies its state', place.stateCode === '24' && place.districtCode === '438', JSON.stringify(place));
}
{
  const place = canonicalPlace({ district: 'Aurangabad' });
  check('an ambiguous district with no state keeps its name and no codes',
    place.state === null && place.district === 'Aurangabad' && !place.districtCode, JSON.stringify(place));
}
{
  const place = canonicalPlace({ state: 'Gujarat', districtCode: '497' });
  check('a district code from another state is not trusted', place.districtCode === null, JSON.stringify(place));
}
check('sameState compares by code', sameState('GUJARAT', 'ગુજરાત') && !sameState('Gujarat', 'Maharashtra'));
check('sameDistrict compares by code across scripts', sameDistrict('અમદાવાદ', 'Ahmedabad') && !sameDistrict('Ahmedabad', 'Surat'));
check('sameDistrict keeps the Mumbai fold', sameDistrict('Mumbai Suburban District', 'Mumbai'));
check('the key folds Gujarati and Devanagari spellings together', geoKey('નાગપુર') === geoKey('नागपूर'));

// --- The geocoder's answers are canonical ------------------------------------
const nominatim = (address) => async () => ({ ok: true, json: async () => ({ address, display_name: 'somewhere' }) });
{
  const got = await reverseGeocode(23.02, 72.57, { fetchImpl: nominatim({ state: 'Gujarat', state_district: 'Ahmadabad District', city: 'Ahmedabad' }) });
  check('an OpenStreetMap district is stored by its LGD code', got?.districtCode === '438' && got.district === 'Ahmedabad', JSON.stringify(got));
}
{
  const got = await reverseGeocode(23.02, 72.57, { fetchImpl: nominatim({ state: 'ગુજરાત', county: 'Daskroi Taluka', city: 'Ahmedabad' }) });
  check('the first address part that is a district wins', got?.stateCode === '24' && got.districtCode === '438', JSON.stringify(got));
}
{
  const got = await resolveSightingLocation({ state: 'Gujarat', lat: 23.02, lng: 72.57 }, { fetchImpl: nominatim({ state: 'Gujarat', state_district: 'Ahmedabad' }) });
  check('a state the reporter chose with "Not sure" for the district takes the phone\'s district', got.stateCode === '24' && got.districtCode === '438', JSON.stringify(got));
}
{
  const got = await resolveSightingLocation({ state: 'Gujarat', lat: 19.07, lng: 72.87 }, { fetchImpl: nominatim({ state: 'Maharashtra', state_district: 'Mumbai Suburban' }) });
  check('but never a district from another state', got.stateCode === '24' && got.districtCode === null, JSON.stringify(got));
}
{
  const got = await resolveSightingLocation({ lat: 23.02, lng: 72.57 }, { fetchImpl: nominatim({ state: 'Gujarat', state_district: 'Ahmedabad' }) });
  check('"Not sure" for both lets the phone decide', got.stateCode === '24' && got.districtCode === '438' && got.source === 'coordinates', JSON.stringify(got));
}
{
  let called = false;
  const got = await resolveSightingLocation({ state: 'Gujarat', district: 'Surat', lat: 23.02, lng: 72.57 }, { fetchImpl: async () => { called = true; return nominatim({})(); } });
  check('a chosen state and district are not looked up at all', !called && got.districtCode === '459' && got.source === 'reporter', JSON.stringify(got));
}

// --- The API the pickers read -----------------------------------------------
const routes = {};
const router = { get: (path, handler) => { routes[path] = handler; return router; } };
registerGeoRoutes(router);
const call = (path, query = {}) => {
  const out = { status: 200, headers: {}, body: null };
  const res = {
    status(code) { out.status = code; return res; },
    set(name, value) { out.headers[name] = value; return res; },
    json(body) { out.body = body; return res; },
  };
  routes[path]({ query }, res);
  return out;
};
{
  const res = call('/states');
  check('GET /api/geo/states lists 36 with four names each',
    res.status === 200 && res.body.states.length === 36 && res.body.states.every((s) => s.names.en && s.names.gu && s.names.hi && s.names.mr));
  check('and is cacheable', /public/.test(res.headers['Cache-Control'] || ''), res.headers['Cache-Control']);
}
{
  const res = call('/districts', { state: '24' });
  check('GET /api/geo/districts?state=24 lists Gujarat', res.status === 200 && res.body.state.code === '24' && res.body.districts.length === 35, String(res.body?.districts?.length));
  const ahmedabad = res.body.districts.find((d) => d.code === '438');
  check('with each district\'s names in four languages', ahmedabad?.names.gu === 'અમદાવાદ' && ahmedabad.names.hi === 'अहमदाबाद' && ahmedabad.names.mr === 'अहमदाबाद', JSON.stringify(ahmedabad));
  check('and marks a police jurisdiction as one', res.body.districts.find((d) => d.code === '24-ahmedabad-rural')?.kind === 'police');
  check('is cacheable', /max-age=\d+/.test(res.headers['Cache-Control'] || ''));
}
check('a state name works as the parameter too', call('/districts', { state: 'ગુજરાત' }).body?.state?.code === '24');
check('no state is a 400', call('/districts', {}).status === 400);
check('an unknown state is a 404', call('/districts', { state: 'Atlantis' }).status === 404);
{
  // The Worker answers the lists before it loads any store: with no database
  // binding at all, they still come back.
  const res = await khozoWorker.fetch(new Request('https://khozo.test/api/geo/districts?state=27'), {}, { waitUntil() {} });
  const body = await res.json();
  check('the Worker serves the district list without a store', res.status === 200 && body.districts?.length === 37, `HTTP ${res.status}`);
  check('with CORS and caching headers', res.headers.get('access-control-allow-origin') === '*' && /max-age/.test(res.headers.get('cache-control') || ''));
  const missing = await khozoWorker.fetch(new Request('https://khozo.test/api/geo/nothing'), {}, { waitUntil() {} });
  check('and 404s an unknown geo path', missing.status === 404, `HTTP ${missing.status}`);
}
check('listDistricts and listStates agree with the routes', listDistricts('27').length === 37 && listStates().length === 36);
check('districtByCode', districtByCode('438')?.name === 'Ahmedabad' && districtByCode('nope') === null);

// --- On write: registration, provisioning and the intake alert ---------------
// The route handlers, called directly with stubbed storage.
function recorder() {
  const handlers = [];
  const r = {
    use: () => r,
    ...Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) => [
      method,
      (path, ...rest) => {
        handlers.push({ method: method.toUpperCase(), path, handler: rest.flat().at(-1) });
        return r;
      },
    ])),
  };
  return { router: r, find: (method, path) => handlers.find((h) => h.method === method && h.path === path)?.handler };
}
async function invoke(handler, { user, body = {}, query = {}, params = {} }) {
  const out = { status: 200, body: null };
  const res = {
    status(code) { out.status = code; return res; },
    set() { return res; },
    json(payload) { out.body = payload; return res; },
  };
  await handler({ user, body, query, params, headers: {}, file: null }, res);
  return out;
}
const HOURS = 3600000;
const USERS = [
  { id: 'u_super', role: 'super_admin', name: 'National desk', jurisdiction: {} },
  { id: 'u_gj_admin', role: 'admin', name: 'Gujarat admin', jurisdiction: { state: 'Gujarat' } },
  { id: 'u_ahd_police', role: 'police', name: 'Ahmedabad station', phone: '0790000001', jurisdiction: { state: 'Gujarat', district: 'Ahmedabad' } },
  // Provisioned before codes existed, in Gujarati.
  { id: 'u_ahd_cwc', role: 'cwc', name: 'Ahmedabad CWC', jurisdiction: { state: 'ગુજરાત', district: 'અમદાવાદ' } },
  { id: 'u_ahd_dcpu', role: 'dcpu', name: 'Ahmedabad DCPU', jurisdiction: { state: 'Gujarat', district: 'Ahmedabad' } },
  { id: 'u_surat_police', role: 'police', name: 'Surat station', jurisdiction: { state: 'Gujarat', district: 'Surat' } },
  { id: 'u_mum_police', role: 'police', name: 'Mumbai station', jurisdiction: { state: 'Maharashtra', district: 'Mumbai' } },
  { id: 'u_parent', role: 'parent', name: 'A parent', phone: '9800000001', jurisdiction: { state: 'Gujarat', district: 'Ahmedabad' } },
  { id: 'u_ngo', role: 'ngo', name: 'An NGO', phone: '9800000002', jurisdiction: {} },
];
const byId = Object.fromEntries(USERS.map((u) => [u.id, u]));
const store = { reports: [], notifications: [], users: [...USERS] };
const deps = {
  listReports: () => store.reports,
  addReport: (row) => store.reports.push(row),
  findReport: (id) => store.reports.find((r) => r.id === id) || null,
  updateReport: (id, patch) => Object.assign(store.reports.find((r) => r.id === id) || {}, patch),
  listFoundReports: () => [],
  addFoundReport: () => {},
  findFoundReport: () => null,
  updateFoundReport: () => {},
  listUsers: () => store.users,
  addUser: (u) => { store.users.push(u); return u; },
  findUserByEmail: (email) => store.users.find((u) => u.email === email) || null,
  publicUser: (u) => ({ id: u.id, role: u.role, name: u.name, jurisdiction: u.jurisdiction }),
  addActivity: () => {},
  addAudit: () => ({}),
  addNotification: (row) => store.notifications.push(row),
  listNotifications: async (userId) => store.notifications.filter((n) => n.userId === userId),
  markNotificationsRead: async () => [],
  listActivity: () => [],
  listAudit: () => [],
  verifyAuditChain: () => ({ ok: true }),
  savePhoto: async (key) => key,
  readPhoto: async () => null,
  photoMimeType: () => 'image/jpeg',
  authRequired: (_q, _s, next) => next(),
  optionalAuth: (_q, _s, next) => next(),
  passwordChangeRequired: (_q, _s, next) => next(),
  requireRole: () => (_q, _s, next) => next(),
  auditPublicRateLimit: () => {},
  clientIp: () => 'test',
  fixedWindowRateLimit: () => (_q, _s, next) => next(),
  rankMatches: async () => ({ candidates: [], engine: { provider: 'stub', biometric: false } }),
  rankSightingMatches: async () => ({ candidates: [], engine: { provider: 'stub', biometric: false } }),
  detectPerson: async () => ({ verdict: 'person', faces: 1, provider: 'stub' }),
  matchEngineInfo: () => ({}),
  probeMatchProviders: async () => [],
  upload: { single: () => (_q, _s, next) => next() },
  fetchImpl: async () => { throw new Error('no network in tests'); },
  settings: {},
};
const reports = recorder();
registerReportRoutes(reports.router, deps);
const dashboard = recorder();
registerDashboardRoutes(dashboard.router, deps);
const registerCase = (userId, fields) => invoke(reports.find('POST', '/'), {
  user: byId[userId],
  body: {
    childName: `Smoke ${Math.random().toString(36).slice(2, 8)}`,
    age: '9',
    declarationAccepted: 'true',
    declarationSignerName: 'Smoke',
    relationshipToChild: 'parent',
    ...fields,
  },
});
const alertedFor = (reportId) => store.notifications.filter((n) => n.scope?.reportId === reportId && n.kind === 'intake_pending');

{
  const res = await registerCase('u_ahd_police', { state: 'GUJARAT', district: 'Ahmdabad', gender: 'Male' });
  const r = res.body?.report;
  check('an officer\'s "GUJARAT" / "Ahmdabad" is stored as Gujarat / Ahmedabad with codes',
    res.status === 201 && r.state === 'Gujarat' && r.stateCode === '24' && r.district === 'Ahmedabad' && r.districtCode === '438',
    JSON.stringify({ status: res.status, state: r?.state, district: r?.district, codes: [r?.stateCode, r?.districtCode] }));
}
{
  const res = await registerCase('u_ahd_police', { state: 'Gujarat', district: 'Maninagar', gender: 'Female' });
  check('an officer\'s unknown district is refused with the list to choose from',
    res.status === 400 && res.body.code === 'unknown_district' && res.body.options === '/api/geo/districts?state=24', JSON.stringify(res.body));
}
{
  const res = await registerCase('u_ahd_police', { state: 'Atlantis', district: 'Ahmedabad', gender: 'Female' });
  check('and an unknown state with the state list', res.status === 400 && res.body.code === 'unknown_state' && res.body.options === '/api/geo/states', JSON.stringify(res.body));
}
{
  const res = await registerCase('u_ahd_police', { gender: 'Female', childName: 'Smoke Own District' });
  check('with no place an officer\'s case is filed in the officer\'s own district', res.body?.report?.districtCode === '438', JSON.stringify(res.body?.report?.district));
}
{
  const res = await registerCase('u_ahd_police', { state: 'Maharashtra', gender: 'Female', childName: 'Smoke Other State' });
  check('an officer\'s district is not lent to a case in another state', res.status === 201 && res.body.report.stateCode === '27' && res.body.report.district === null, JSON.stringify(res.body?.report?.district));
}
{
  const before = store.notifications.length;
  const res = await registerCase('u_parent', { state: 'Gujarat', district: 'Ahmedabad', gender: 'Female', childName: 'Kavya Desai', parentPhone: '9811100001' });
  const id = res.body?.report?.id;
  const told = alertedFor(id).map((n) => n.userId).sort().join();
  check('a family\'s report is accepted for verification', res.status === 201 && res.body.report.status === 'intake_pending');
  check('and alerts the district\'s police and CWC desks (the CWC account written in Gujarati too)', told === 'u_ahd_cwc,u_ahd_police', told);
  const alert = alertedFor(id)[0];
  check('the alert names no person', alert && !JSON.stringify(alert).includes('Kavya') && alert.body.includes(id), alert?.body);
  check('and is high priority and opens the case', alert?.priority === 'high' && alert.scope.reportId === id);
  check('nobody else is told', store.notifications.length - before === 2, String(store.notifications.length - before));
}
{
  const res = await registerCase('u_parent', { state: 'Gujarat', district: 'Maninagar', childName: 'Ishaan Mehta', age: '4', parentPhone: '9811100002' });
  const r = res.body?.report;
  check('a family\'s unrecognised district is kept, not refused', res.status === 201 && r.district === null && r.districtText === 'Maninagar' && r.stateCode === '24', JSON.stringify(r && { district: r.district, districtText: r.districtText }));
  check('a family\'s report with no gender records Unknown, not Male', r?.gender === 'Unknown', r?.gender);
  const told = alertedFor(r?.id).map((n) => n.userId).sort().join();
  check('and alerts every district desk of the state', told === 'u_ahd_cwc,u_ahd_police,u_surat_police', told);
}
{
  const res = await registerCase('u_ngo', { childName: 'Riya Parmar', age: '13', gender: 'Unknown' });
  const told = alertedFor(res.body?.report?.id).map((n) => n.userId).join();
  check('a report placed nowhere still alerts someone (the national desk)', res.status === 201 && told === 'u_super', told);
  check('Unknown is an accepted gender', res.body?.report?.gender === 'Unknown');
}
{
  const res = await registerCase('u_parent', { state: 'Gujarat', district: 'Ahmedabad', gender: 'Boy' });
  check('a gender outside the list is refused', res.status === 400, String(res.status));
}
{
  // One intake that has waited a day and a half.
  const old = store.reports.find((r) => r.childName === 'Kavya Desai');
  old.createdAt = Date.now() - 36 * HOURS;
  const stats = await invoke(dashboard.find('GET', '/stats'), { user: byId.u_ahd_police });
  const intakes = stats.body?.intakes;
  check('the station overview counts the intakes waiting on it', intakes?.pending === 2 && stats.body.cards.intakesToVerify === 2, JSON.stringify(intakes && { pending: intakes.pending }));
  check('and the overdue one', intakes?.overdue === 1 && intakes.oldest[0].id === old.id && intakes.oldest[0].overdue === true, JSON.stringify(intakes?.oldest?.[0]));
  check('the list names no person', !JSON.stringify(intakes).includes('Kavya') && !JSON.stringify(intakes).includes('Ishaan'), '');
  const surat = await invoke(dashboard.find('GET', '/stats'), { user: byId.u_surat_police });
  check('another district\'s station counts only the unplaced one', surat.body?.intakes?.pending === 1, String(surat.body?.intakes?.pending));
  const family = await invoke(dashboard.find('GET', '/stats'), { user: byId.u_parent });
  check('a family has no intake queue', family.body?.intakes === null);
  const followups = await invoke(dashboard.find('GET', '/followups'), { user: byId.u_ahd_police });
  const overdue = (followups.body?.alerts || []).filter((a) => a.type === 'intake_overdue');
  check('an intake waiting over 24 hours raises a follow-up alert', overdue.length === 1 && overdue[0].priority === 'high' && overdue[0].reportId === old.id, JSON.stringify(overdue));
  check('which names no person', overdue[0] && !JSON.stringify(overdue[0]).includes('Kavya'));
  check('and is counted', followups.body?.totals?.intakeOverdue === 1);
}
{
  const provision = (userId, body) => invoke(dashboard.find('POST', '/network/users'), { user: byId[userId], body: { name: 'Smoke Desk', email: `smoke.${Math.random().toString(36).slice(2, 8)}@khozo.org`, ...body } });
  const ok = await provision('u_super', { role: 'cwc', state: 'ગુજરાત', district: 'Ahmadabad' });
  const j = ok.body?.user?.jurisdiction;
  check('a desk provisioned as "ગુજરાત" / "Ahmadabad" is stored canonical with codes',
    ok.status === 201 && j.state === 'Gujarat' && j.stateCode === '24' && j.district === 'Ahmedabad' && j.districtCode === '438', JSON.stringify(j));
  const bad = await provision('u_super', { role: 'cwc', state: 'Gujarat', district: 'Nowhere' });
  check('an unknown district is refused with the list', bad.status === 400 && bad.body.code === 'unknown_district', JSON.stringify(bad.body));
  const noState = await provision('u_super', { role: 'police', district: 'Pune' });
  check('a state is never guessed for an account', noState.status === 400 && noState.body.error === 'A state is required for this role', JSON.stringify(noState.body));
  const outside = await provision('u_gj_admin', { role: 'cwc', state: 'Maharashtra', district: 'Pune' });
  check('a state admin provisions only in its state', outside.status === 403);
  const inside = await provision('u_gj_admin', { role: 'police', state: 'GUJARAT', district: 'Surat' });
  check('which it may name in any spelling', inside.status === 201 && inside.body.user.jurisdiction.districtCode === '459', JSON.stringify(inside.body));
}
{
  const res = await invoke(dashboard.find('POST', '/network/alerts'), {
    user: byId.u_gj_admin,
    body: { audience: 'welfare', district: 'Ahmedabad', subject: 'Smoke alert', message: 'A coordination message for the district' },
  });
  const ids = (res.body?.recipients || []).map((u) => u.id);
  check('a network alert for "Ahmedabad" reaches the desk provisioned as "અમદાવાદ"', res.status === 201 && ids.includes('u_ahd_cwc') && ids.includes('u_ahd_dcpu'), ids.join());
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Gazetteer checks passed.');
