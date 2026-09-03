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

import { createRequestStore } from '../worker/src/store-sync.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** An in-memory stand-in for Postgres that records every write it is given. */
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
  const photos = new Map();

  return {
    writes,
    photos,
    async query(_env, sql) {
      const table = /from public\.(\w+)/.exec(sql)?.[1];
      return { rows: (tables[table] || []).map((data) => ({ data })) };
    },
    async upsertRecord(_env, table, record) {
      writes.push({ table, id: record.id });
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
check('both audit rows are written', io.writes.filter((w) => w.table === 'audit').length === 2);
check('untouched records are not rewritten', !written.includes('reports:r_2') && !written.includes('grievances:g_1'));

const lastTable = io.writes[io.writes.length - 1]?.table;
check('audit rows are written last', lastTable === 'audit', `last write was ${lastTable}`);

await flush();
check('a second flush writes nothing', io.writes.filter((w) => w.table === 'reports').length === 2);

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Worker store replica checks passed.');
