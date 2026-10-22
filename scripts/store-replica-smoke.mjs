/**
 * Checks the Worker's per-request store replica without a database.
 *
 * The replica is the piece the API smoke suite cannot reach: that suite runs
 * the Worker's routes against the JSON file store, so nothing else verifies
 * that this module hydrates the right rows, keeps reads consistent with writes
 * made earlier in the same request, writes back exactly what changed, and
 * extends the audit hash chain rather than breaking it.
 *
 *   node scripts/store-replica-smoke.mjs
 */

import crypto from 'node:crypto';

import { createRequestStore, tablesForRequest } from '../worker/src/store-sync.js';
import registerDashboardRoutes from '../shared/routes/dashboard.js';
import registerReportRoutes from '../shared/routes/reports.js';
import { createRouter, handleRequest } from '../worker/src/http/router.js';
import { createAuth, createAuditPublicRateLimit, clientIp, fixedWindowRateLimit } from '../worker/src/http/express-compat.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/**
 * An in-memory stand-in for Postgres that records every write it is given.
 *
 * Rows are kept as stored JSON, as Postgres keeps them: a write replaces the
 * stored copy, so a later read sees exactly what was written, and the version
 * that readVersioned / updateIfVersion compare is a hash of the stored row.
 */
function fakeIo(seed = {}) {
  const tables = {
    users: seed.users || [],
    reports: seed.reports || [],
    found_reports: seed.found_reports || [],
    grievances: seed.grievances || [],
    activity: seed.activity || [],
    audit: seed.audit || [],
    notifications: seed.notifications || [],
  };
  const reads = [];
  const writes = [];
  const statements = [];
  const photos = new Map();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const store = (table, record) => {
    if (!tables[table]) tables[table] = [];
    const rows = tables[table];
    const index = rows.findIndex((r) => r.id === record.id);
    if (index >= 0) rows[index] = clone(record);
    else rows.push(clone(record));
  };
  const versionOf = (row) => crypto.createHash('md5').update(JSON.stringify(row)).digest('hex');

  return {
    reads,
    writes,
    statements,
    photos,
    tables,
    async query(_env, sql, params = []) {
      const table = /from public\.(\w+)/.exec(sql)?.[1];
      reads.push(table);
      let rows = tables[table] || [];
      if (/user_id = \$1/.test(sql)) rows = rows.filter((r) => r.userId === params[0]);
      return { rows: rows.map((data) => ({ data: clone(data) })) };
    },
    async upsertRecord(_env, table, record) {
      writes.push({ table, id: record.id, record: clone(record) });
      statements.push({ table, rows: 1 });
      store(table, record);
    },
    async upsertMany(_env, table, records) {
      for (const record of records) {
        writes.push({ table, id: record.id, record: clone(record) });
        store(table, record);
      }
      statements.push({ table, rows: records.length });
    },
    async readVersioned(_env, table, id) {
      const row = (tables[table] || []).find((r) => r.id === id);
      return row ? { data: clone(row), version: versionOf(row) } : null;
    },
    async updateIfVersion(_env, table, record, version) {
      const row = (tables[table] || []).find((r) => r.id === record.id);
      if (!row || versionOf(row) !== version) return false;
      writes.push({ table, id: record.id, record: clone(record), conditional: true });
      statements.push({ table, rows: 1 });
      store(table, record);
      return true;
    },
    async savePhotoBlob(_env, key, buffer, mime) {
      photos.set(key, { buffer, mime });
    },
    async readPhotoBlob(_env, key) {
      return photos.get(key) || null;
    },
    async photoBlobStats() {
      return { count: photos.size, totalBytes: 0 };
    },
  };
}

const seed = {
  users: [
    { id: 'u_1', email: 'Police@Khozo.org', role: 'police', name: 'Station Officer' },
    { id: 'u_2', email: 'parent@khozo.org', role: 'parent', name: 'Parent' },
  ],
  reports: [
    { id: 'r_1', childName: 'Case One', status: 'missing', state: 'Maharashtra', district: 'Mumbai', photoFile: 'r_1' },
    { id: 'r_2', childName: 'Case Two', status: 'missing', state: 'Goa', district: 'North Goa' },
  ],
  found_reports: [{ id: 'f_1', foundLocation: 'Dadar station', status: 'no_match' }],
  grievances: [{ id: 'g_1', status: 'open' }],
};

console.log('Khozo worker store replica\n');

// --- hydration --------------------------------------------------------------
const io = fakeIo(seed);
const { store, flush } = await createRequestStore({}, null, io);

check('hydrates every table', store.listReports().length === 2 && store.listUsers().length === 2);
check('finds a report by id', store.findReport('r_1')?.childName === 'Case One');
check('finds a report by photo key', store.findReport('r_1')?.id === 'r_1');
check('finds a user by email, case-insensitively', store.findUserByEmail('POLICE@khozo.org')?.id === 'u_1');
check('returns null rather than throwing on a missing id', store.findReport('nope') === null);

// --- reads see writes made earlier in the same request ----------------------
store.updateReport('r_1', { status: 'found', foundLocation: 'Kurla' });
check('a later read sees an earlier update', store.findReport('r_1')?.status === 'found');
check('the update merges rather than replaces', store.findReport('r_1')?.childName === 'Case One');
check('the list reflects the update', store.listReports().find((r) => r.id === 'r_1')?.foundLocation === 'Kurla');
check('updating an unknown id reports failure', store.updateReport('nope', { status: 'found' }) === null);

store.addReport({ id: 'r_3', childName: 'Case Three', status: 'missing' });
check('an added report is immediately findable', store.findReport('r_3')?.childName === 'Case Three');

store.addFoundReport({ id: 'f_2', foundLocation: 'Bandra', status: 'pending_review' });
store.updateFoundReport('f_2', { status: 'matched' });
check('a sighting added then updated keeps both changes', store.findFoundReport('f_2')?.status === 'matched');

// A sighting read from the database and changed in this request - what a
// reverse link or an officer's review writes - must be flushed too.
store.updateFoundReport('f_1', { matchedReportId: 'r_1', status: 'pending_review' });

// --- audit chain ------------------------------------------------------------
store.addAudit({ action: 'case.first', actorRole: 'police', summary: 'first' });
store.addAudit({ action: 'case.second', actorRole: 'police', summary: 'second' });
const chain = store.verifyAuditChain();
check('the audit chain verifies after appends', chain.ok, chain.ok ? `${chain.checked} events` : `broke at ${chain.failedId}`);

const tampered = store.listAudit().map((row, i) => (i === 0 ? { ...row, summary: 'edited' } : row));
check('a tampered audit row is detected', store.verifyAuditChain(tampered).ok === false);

// --- photos -----------------------------------------------------------------
await store.savePhoto('r_3', Buffer.from('image-bytes'), 'image/png');
const readBack = await store.readPhoto('r_3');
check('a stored photo reads back intact', Buffer.from(readBack).toString() === 'image-bytes');
check('the photo mime type follows the key extension', store.photoMimeType('r_3.png') === 'image/png');

// --- flush ------------------------------------------------------------------
check('nothing is written before the flush', io.writes.length === 0);
await flush();

const written = io.writes.map((w) => `${w.table}:${w.id}`);
check('the changed report is written', written.includes('reports:r_1'));
check('the new report is written', written.includes('reports:r_3'));
check('the new sighting is written', written.includes('found_reports:f_2'));
const f2Written = io.writes.filter((w) => w.table === 'found_reports' && w.id === 'f_2').at(-1)?.record;
check('the new sighting is written with its later update', f2Written?.status === 'matched', `status ${f2Written?.status}`);
const f1Written = io.writes.filter((w) => w.table === 'found_reports' && w.id === 'f_1').at(-1)?.record;
check(
  'a hydrated sighting changed during the request is written with the change',
  f1Written?.matchedReportId === 'r_1' && f1Written?.status === 'pending_review' && f1Written?.foundLocation === 'Dadar station',
  JSON.stringify(f1Written || null)
);
check('both audit rows are written', io.writes.filter((w) => w.table === 'audit').length === 2);
check('untouched records are not rewritten', !written.includes('reports:r_2') && !written.includes('grievances:g_1'));

// Ordering is checked on this flush, before the fan-out below adds more.
const lastTable = io.writes[io.writes.length - 1]?.table;
check('audit rows are written last', lastTable === 'audit', `last write was ${lastTable}`);

// Reporting a sighting alerts every authority at once. Written a row at a time
// that is one connection and round trip per officer, on the most time-critical
// request in the product.
for (let i = 0; i < 12; i += 1) {
  store.addNotification({ userId: `u_${i}`, kind: 'sighting_reported', title: 'Child spotted', body: 'Seen at the bus stand.' });
}
await flush();
const notificationStatements = io.statements.filter((s) => s.table === 'notifications');
check(
  'a twelve-officer alert fan-out is one statement, not twelve round trips',
  notificationStatements.length === 1 && notificationStatements[0].rows === 12,
  `${notificationStatements.length} statement(s)`
);

await flush();
check('a further flush writes nothing new', io.writes.filter((w) => w.table === 'reports').length === 2);

// --- linking a sighting checks the database, not the request's copy ----------
// The reverse search decides to link a sighting seconds after its request read
// the data. If another request changed the sighting meanwhile - an officer
// anonymised it, or linked it elsewhere - the link must not be written over
// that change, which the flush's whole-row write would otherwise do.
const raceIo = fakeIo({
  found_reports: [
    { id: 's_1', foundLocation: 'Platform 3', status: 'no_match', reporterName: 'Ravi', reporterPhone: '9999999999', photoFile: 's_1' },
    { id: 's_2', foundLocation: 'Bus stand', status: 'no_match', reporterName: 'Asha', photoFile: 's_2' },
  ],
});
const linking = await createRequestStore({}, null, raceIo);
const officer = await createRequestStore({}, null, raceIo);
officer.store.updateFoundReport('s_1', { reporterName: 'Anonymised citizen', reporterPhone: null, anonymizedAt: '2026-10-16T00:00:00.000Z' });
await officer.flush();
const linkable = (row) => !row.anonymizedAt && !row.matchedReportId;
const link = (row) => ({ matchedReportId: 'r_9', status: 'pending_review', previousStatus: row.status });
check('the linking request still holds the stale copy', linkable(linking.store.findFoundReport('s_1')));
const claimedStale = await linking.store.claimFoundReport('s_1', link, linkable);
check('a sighting anonymised by another request is not linked', claimedStale === null);
await linking.flush();
const s1 = raceIo.tables.found_reports.find((r) => r.id === 's_1');
check(
  'the anonymisation is not undone by the linking request',
  Boolean(s1.anonymizedAt) && s1.reporterName === 'Anonymised citizen' && s1.reporterPhone === null && !s1.matchedReportId,
  JSON.stringify(s1)
);
// Read before the link below is made, as a concurrent registration would be.
const second = await createRequestStore({}, null, raceIo);
const claimed = await linking.store.claimFoundReport('s_2', link, linkable);
check('an unchanged sighting is linked', claimed?.matchedReportId === 'r_9' && claimed.previousStatus === 'no_match');
check('the link is written at once, on condition', raceIo.writes.some((w) => w.id === 's_2' && w.conditional && w.record.matchedReportId === 'r_9'));
check('the request reads its own link back', linking.store.findFoundReport('s_2')?.matchedReportId === 'r_9');
const writesBefore = raceIo.writes.length;
await linking.flush();
check('the flush does not write the linked sighting a second time', raceIo.writes.length === writesBefore);
check('the concurrent request still holds the unlinked copy', linkable(second.store.findFoundReport('s_2')));
const otherClaim = await second.store.claimFoundReport('s_2', (row) => ({ matchedReportId: 'r_10', previousStatus: row.status }), linkable);
check(
  'a sighting another request already linked is not taken over',
  otherClaim === null && raceIo.tables.found_reports.find((r) => r.id === 's_2').matchedReportId === 'r_9'
);

// --- a change to a case's photos is written on the case as it is now ---------
// Adding photos takes seconds (each is checked for a face). Another officer's
// change to the same case's photos meanwhile must not be written over.
const photoIo = fakeIo({
  reports: [{ id: 'r_p', childName: 'Photo race', photoFile: 'r_p.jpg', extraPhotos: [{ id: 'p_aaaa0001', file: 'r_p_p_aaaa0001.jpg' }] }],
});
const adding = await createRequestStore({}, null, photoIo);
const other = await createRequestStore({}, null, photoIo);
other.store.updateReport('r_p', { extraPhotos: [{ id: 'p_aaaa0001', file: 'r_p_p_aaaa0001.jpg' }, { id: 'p_bbbb0002', file: 'r_p_p_bbbb0002.jpg' }] });
await other.flush();
const addOne = (row) => ({ extraPhotos: [...(row.extraPhotos || []), { id: 'p_cccc0003', file: 'r_p_p_cccc0003.jpg' }] });
const added = await adding.store.claimReport('r_p', addOne, (row) => !row.anonymizedAt);
check(
  'a photo added while another officer added one keeps both',
  added?.extraPhotos?.map((p) => p.id).join() === 'p_aaaa0001,p_bbbb0002,p_cccc0003',
  JSON.stringify(added?.extraPhotos)
);
check('the case is written at once, on condition', photoIo.writes.some((w) => w.table === 'reports' && w.id === 'r_p' && w.conditional));
const anonymiser = await createRequestStore({}, null, photoIo);
anonymiser.store.updateReport('r_p', { anonymizedAt: '2026-10-19T00:00:00.000Z', extraPhotos: [] });
await anonymiser.flush();
const late = await adding.store.claimReport('r_p', addOne, (row) => !row.anonymizedAt);
check('no photo is added to a case anonymised meanwhile', late === null && photoIo.tables.reports.find((r) => r.id === 'r_p').extraPhotos.length === 0);

// --- the alert inbox poll loads only the accounts ----------------------------
// Every open console polls it every twenty seconds. Loading every case,
// sighting and audit row for it was most of the Worker's CPU, and most of the
// requests the Free plan's 10 ms limit cut off.
check('the alert inbox poll needs only the accounts', tablesForRequest('GET', '/api/dashboard/notifications').join() === 'users');
check('marking alerts read still loads everything', tablesForRequest('POST', '/api/dashboard/notifications/read').length === 6);
check('every other request still loads everything', tablesForRequest('GET', '/api/dashboard/stats').length === 6);

const inboxIo = fakeIo({
  ...seed,
  notifications: [
    { id: 'n_1', userId: 'u_1', ts: 2, kind: 'sighting_reported', title: 'Child spotted', readAt: null },
    { id: 'n_2', userId: 'u_1', ts: 1, kind: 'sighting_reported', title: 'Child spotted', readAt: 5 },
    { id: 'n_3', userId: 'u_2', ts: 3, kind: 'sighting_reported', title: 'Child spotted', readAt: null },
  ],
});
const light = await createRequestStore({}, null, inboxIo, { tables: tablesForRequest('GET', '/api/dashboard/notifications') });
check('only the accounts table is read', inboxIo.reads.join() === 'users', inboxIo.reads.join());
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
check('a table left out throws rather than reading as empty', throws(() => light.store.listReports()));
check('an audit row cannot be added to a chain that was not loaded', throws(() => light.store.addAudit({ action: 'case.viewed' })));

// The real inbox route and sign-in check, as the Worker wires them.
const lightAuth = createAuth({}, light.store);
const dashboard = registerDashboardRoutes(createRouter(), {
  ...light.store,
  ...lightAuth,
  isPostgres: true,
  auditPublicRateLimit: createAuditPublicRateLimit(light.store),
  clientIp,
  fixedWindowRateLimit,
  settings: {},
});
const inboxRequest = (token) =>
  new Request('https://khozo.test/api/dashboard/notifications', { headers: token ? { authorization: `Bearer ${token}` } : {} });
const officerToken = await lightAuth.signToken(light.store.findUserById('u_1'));
const inboxResponse = await handleRequest(dashboard, inboxRequest(officerToken), { basePath: '/api/dashboard' });
const inbox = await inboxResponse.json();
check(
  'the inbox route answers from the accounts alone',
  inboxResponse.status === 200 && inbox.notifications?.length === 2 && inbox.unread === 1,
  `${inboxResponse.status} ${JSON.stringify(inbox).slice(0, 120)}`
);
check('it lists only that officer\'s alerts', inbox.notifications.every((n) => n.userId === 'u_1'));
check('it reads nothing but the accounts and that officer\'s alerts', inboxIo.reads.join() === 'users,notifications', inboxIo.reads.join());
const anonymous = await handleRequest(dashboard, inboxRequest(null), { basePath: '/api/dashboard' });
check('it still refuses a request without a sign-in', anonymous.status === 401, `status ${anonymous.status}`);
await light.flush();
check('it writes nothing', inboxIo.writes.length === 0);

// --- a photo loads only the accounts, the cases and the sightings ------------
// The Sightings page asks for one photo per sighting and per case, thirty or
// more at once, and each loaded every grievance, activity and audit row.
const PHOTO_TABLES = 'users,reports,foundReports';
check('a photo needs only the accounts, the cases and the sightings', tablesForRequest('GET', '/api/reports/photo/f_9').join() === PHOTO_TABLES);
check('only for reading a photo, and only under /photo/',
  tablesForRequest('POST', '/api/reports/photo/f_9').length === 6
  && tablesForRequest('GET', '/api/reports/photos').length === 6
  && tablesForRequest('GET', '/api/reports/found/all').length === 6);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const servingIo = fakeIo({
  ...seed,
  users: [
    ...seed.users,
    { id: 'u_mum', email: 'mumbai@khozo.org', role: 'police', name: 'Mumbai Desk', jurisdiction: { state: 'Maharashtra', district: 'Mumbai' } },
    { id: 'u_goa', email: 'goa@khozo.org', role: 'police', name: 'Goa Desk', jurisdiction: { state: 'Goa', district: 'North Goa' } },
  ],
  found_reports: [
    ...seed.found_reports,
    {
      id: 'f_9', foundLocation: 'Dadar station', status: 'pending_review', state: 'Maharashtra', district: 'Mumbai',
      matchedReportId: 'r_1', photoFile: 'f_9.jpg', extraPhotos: [{ id: 'p_abc12345', file: 'f_9_p_abc12345.png' }],
    },
  ],
  activity: [{ id: 'a_1', ts: 1, action: 'x' }],
  audit: [{ id: 'au_1', ts: 1, action: 'x' }],
});
servingIo.photos.set('r_1', { buffer: JPEG, mime: 'image/jpeg' });
servingIo.photos.set('f_9.jpg', { buffer: JPEG, mime: 'image/jpeg' });
servingIo.photos.set('f_9_p_abc12345.png', { buffer: PNG, mime: 'image/png' });

/** One photo request through the real report routes and sign-in check, on a replica holding only what the Worker loads for it. */
async function photoRequest(path, userId) {
  const reads = servingIo.reads.length;
  const { store: s, flush: done } = await createRequestStore({}, null, servingIo, { tables: tablesForRequest('GET', new URL(path, 'https://khozo.test').pathname) });
  const auth = createAuth({}, s);
  const router = createRouter();
  registerReportRoutes(router, {
    ...s,
    ...auth,
    isPostgres: true,
    auditPublicRateLimit: createAuditPublicRateLimit(s),
    clientIp,
    fixedWindowRateLimit,
    upload: { single: () => (_req, _res, next) => next() },
    rankMatches: async () => ({ candidates: [], engine: { provider: 'stub', biometric: false } }),
    detectPerson: async () => ({ verdict: 'unverified', faces: null }),
    settings: {},
  });
  const token = userId ? await auth.signToken(s.findUserById(userId)) : null;
  const response = await handleRequest(router, new Request(`https://khozo.test${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), { basePath: '/api/reports' });
  const body = Buffer.from(await response.arrayBuffer());
  await done();
  return { status: response.status, type: response.headers.get('content-type') || '', body, tables: [...new Set(servingIo.reads.slice(reads))].sort().join() };
}

const sightingPhoto = await photoRequest('/api/reports/photo/f_9', 'u_mum');
check('a sighting photo is served from the accounts, cases and sightings alone',
  sightingPhoto.status === 200 && sightingPhoto.body.equals(JPEG) && sightingPhoto.type.includes('image/jpeg'),
  `${sightingPhoto.status} ${sightingPhoto.type}`);
check('and nothing else is read for it', sightingPhoto.tables === 'found_reports,reports,users', sightingPhoto.tables);
const casePhoto = await photoRequest('/api/reports/photo/r_1', 'u_mum');
check('a case photo too', casePhoto.status === 200 && casePhoto.body.equals(JPEG), `${casePhoto.status}`);
const extraPhoto = await photoRequest('/api/reports/photo/f_9?p=p_abc12345', 'u_mum');
check('an extra photo too', extraPhoto.status === 200 && extraPhoto.body.equals(PNG) && extraPhoto.type.includes('image/png'), `${extraPhoto.status} ${extraPhoto.type}`);
check('a desk outside the district is still refused', (await photoRequest('/api/reports/photo/f_9', 'u_goa')).status === 403);
check('no photo is served without a sign-in', (await photoRequest('/api/reports/photo/f_9', null)).status === 401);
check('an unknown photo is still not found', (await photoRequest('/api/reports/photo/f_nope', 'u_mum')).status === 404);
check('a sighting with no photo is still not found', (await photoRequest('/api/reports/photo/f_1', 'u_mum')).status === 404);
check('serving photos writes nothing', servingIo.writes.length === 0, `${servingIo.writes.length} writes`);

// --- a video search loads the accounts, the cases and the end of the audit chain ---
// Up to sixty requests a search, each appending one audit row: the whole
// log is not read for that, only its newest rows, which hold the chain's head.
const VIDEO_TABLES = 'users,reports,auditTail';
check('a video search needs the accounts, the cases and the end of the audit chain',
  tablesForRequest('POST', '/api/reports/r_1/video-search').join() === VIDEO_TABLES, tablesForRequest('POST', '/api/reports/r_1/video-search').join());
check('only that route', tablesForRequest('GET', '/api/reports/r_1/video-search').length === 6 && tablesForRequest('POST', '/api/reports/r_1/rematch').length === 6);

// A whole (1 x 1) PNG: the route checks that each face picture is an image.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
const searchIo = fakeIo({
  users: [
    { id: 'u_mum', email: 'mumbai@khozo.org', role: 'police', name: 'Mumbai Desk', jurisdiction: { state: 'Maharashtra', district: 'Mumbai' } },
    { id: 'u_goa', email: 'goa@khozo.org', role: 'police', name: 'Goa Desk', jurisdiction: { state: 'Goa', district: 'North Goa' } },
  ],
  reports: [{ id: 'r_vs', status: 'missing', state: 'Maharashtra', district: 'Mumbai', childName: 'Video Search', photoFile: 'r_vs.jpg', createdAt: 1 }],
  found_reports: [{ id: 'f_1', status: 'no_match' }],
  grievances: [{ id: 'g_1' }],
  activity: [{ id: 'a_1', ts: 1, action: 'x' }],
  // A chain of two rows, oldest first in the file, newest first as read.
  audit: [
    { id: 'au_new', ts: 2, action: 'x', hash: 'h2', prevHash: 'h1' },
    { id: 'au_old', ts: 1, action: 'x', hash: 'h1', prevHash: null },
  ],
});
searchIo.photos.set('r_vs.jpg', { buffer: JPEG, mime: 'image/jpeg' });

const tail = await createRequestStore({}, null, searchIo, { tables: tablesForRequest('POST', '/api/reports/r_vs/video-search') });
check('the audit table is read as its newest rows only', searchIo.reads.join() === 'users,reports,audit' && searchIo.statements.length === 0, searchIo.reads.join());
check('the log cannot be listed or checked from its end alone', throws(() => tail.store.listAudit()) && throws(() => tail.store.verifyAuditChain()));
check('the sightings and the rest still throw', throws(() => tail.store.listFoundReports()) && throws(() => tail.store.listGrievances()));
const appended = tail.store.addAudit({ action: 'case.video_searched', targetType: 'report', targetId: 'r_vs' });
check('an audit row still follows the chain’s newest row', appended.prevHash === 'h2' && typeof appended.hash === 'string', JSON.stringify({ prev: appended.prevHash }));
await tail.flush();
check('and is written', searchIo.writes.some((w) => w.table === 'audit' && w.id === appended.id));

/** One video-search request through the real report routes on such a replica. */
async function videoSearch(userId, { faces = 1, fields = {} } = {}) {
  const reads = searchIo.reads.length;
  const writes = searchIo.writes.length;
  const { store: s, flush: done } = await createRequestStore({}, null, searchIo, { tables: tablesForRequest('POST', '/api/reports/r_vs/video-search') });
  const auth = createAuth({}, s);
  const router = createRouter();
  const compared = [];
  registerReportRoutes(router, {
    ...s,
    ...auth,
    isPostgres: true,
    auditPublicRateLimit: createAuditPublicRateLimit(s),
    clientIp,
    fixedWindowRateLimit,
    upload: { single: () => (_req, _res, next) => next() },
    rankMatches: async () => ({ candidates: [], engine: { provider: 'stub', biometric: false } }),
    detectPerson: async () => ({ verdict: 'unverified', faces: null }),
    compareFramesWithCase: async (casePhoto, frames) => {
      compared.push({ casePhoto: casePhoto.equals(JPEG), frames: frames.length });
      return { results: frames.map((f) => ({ id: f.id, verdict: 'likely', aarakshakScore: 0.9, rekognitionScore: 0.95, enginesAnswered: ['aarakshak', 'rekognition'] })), engines: { aarakshak: true, rekognition: true } };
    },
    settings: {},
  });
  const body = new FormData();
  for (let i = 0; i < faces; i += 1) body.append(i === 0 ? 'photo' : 'extraPhotos', new File([TINY_PNG], `face-${i}.png`, { type: 'image/png' }));
  for (const [k, v] of Object.entries({ searchId: 'vs_replica1', cameraPlace: 'Dadar station, gate 2', times: Array.from({ length: faces }, (_, i) => String(i * 2)).join(','), ...fields })) body.set(k, v);
  const token = userId ? await auth.signToken(s.findUserById(userId)) : null;
  const response = await handleRequest(router, new Request('https://khozo.test/api/reports/r_vs/video-search', { method: 'POST', body, headers: token ? { authorization: `Bearer ${token}` } : {} }), { basePath: '/api/reports' });
  const data = await response.json().catch(() => ({}));
  await done();
  return { status: response.status, data, compared, tables: [...new Set(searchIo.reads.slice(reads))].sort().join(), writes: searchIo.writes.slice(writes) };
}

const searched = await videoSearch('u_mum', { faces: 3 });
check('a video search is answered from the accounts, the cases and the end of the audit chain',
  searched.status === 200 && searched.data.results?.length === 3 && searched.data.counts?.likely === 3, `${searched.status} ${JSON.stringify(searched.data).slice(0, 160)}`);
check('it compares the case photo with every face', searched.compared.length === 1 && searched.compared[0].casePhoto && searched.compared[0].frames === 3, JSON.stringify(searched.compared));
check('it reads nothing else', searched.tables === 'audit,reports,users', searched.tables);
const auditRows = searched.writes.filter((w) => w.table === 'audit');
check('it writes one audit row that follows the chain, and nothing else',
  // The chain's newest row is now the one appended above.
  searched.writes.length === 1 && auditRows.length === 1 && auditRows[0].record.action === 'case.video_searched' && auditRows[0].record.prevHash === appended.hash
  && auditRows[0].record.metadata?.cameraPlace === 'Dadar station, gate 2' && auditRows[0].record.metadata?.faces?.length === 3,
  JSON.stringify(searched.writes.map((w) => [w.table, w.record.action, w.record.prevHash])));
check('a desk outside the district is refused', (await videoSearch('u_goa')).status === 403);
check('no search without a sign-in', (await videoSearch(null)).status === 401);
check('a search that does not say where the camera is, is refused', (await videoSearch('u_mum', { fields: { cameraPlace: '' } })).status === 400);

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Worker store replica checks passed.');
