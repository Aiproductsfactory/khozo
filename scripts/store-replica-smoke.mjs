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

import { createRequestStore } from '../worker/src/store-sync.js';

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
  };
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
    writes,
    statements,
    photos,
    tables,
    async query(_env, sql) {
      const table = /from public\.(\w+)/.exec(sql)?.[1];
      return { rows: (tables[table] || []).map((data) => ({ data: clone(data) })) };
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
officer.store.updateFoundReport('s_1', { reporterName: 'Anonymized citizen', reporterPhone: null, anonymizedAt: '2026-10-16T00:00:00.000Z' });
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
  Boolean(s1.anonymizedAt) && s1.reporterName === 'Anonymized citizen' && s1.reporterPhone === null && !s1.matchedReportId,
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

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Worker store replica checks passed.');
