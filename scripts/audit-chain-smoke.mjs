/**
 * Checks that the audit log's tamper check tells concurrency from tampering.
 *
 * On the Worker each request appends to its own replica of the audit log, so
 * two requests served at the same moment both append to the same newest row
 * and the log forks. The old straight-line check reported that as "audit chain
 * failed" (khozo.org, since 1 Aug 2026). A fork must verify; an edited row, a
 * row deleted from the middle and a deleted start must not.
 *
 *   node scripts/audit-chain-smoke.mjs
 */
import process from 'node:process';

import { createRequestStore } from '../worker/src/store-sync.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** Postgres stand-in: audit rows persist across requests, like the real table. */
function sharedDb() {
  const tables = { users: [], reports: [], found_reports: [], grievances: [], activity: [], audit: [], notifications: [] };
  const io = {
    async query(_env, sql) {
      const table = /from public\.(\w+)/.exec(sql)?.[1];
      // Newest first, as the replica expects its audit head at index 0.
      const rows = table === 'audit' ? tables.audit.slice().sort((a, b) => b.ts - a.ts) : tables[table] || [];
      return { rows: rows.map((data) => ({ data })) };
    },
    async upsertRecord(_env, table, record) { upsert(table, record); },
    async upsertMany(_env, table, records) { for (const r of records) upsert(table, r); },
    async savePhotoBlob() {},
    async readPhotoBlob() { return null; },
    async photoBlobStats() { return { count: 0, totalBytes: 0 }; },
  };
  function upsert(table, record) {
    const rows = (tables[table] ||= []);
    const i = rows.findIndex((r) => r.id === record.id);
    if (i === -1) rows.push(structuredClone(record)); else rows[i] = structuredClone(record);
  }
  return { tables, io };
}

const db = sharedDb();
const entry = (n) => ({ actorId: 'u_1', actorName: 'Officer', actorRole: 'police', action: `test.event_${n}`, summary: `Event ${n}` });

// A straight run of requests.
for (let n = 1; n <= 3; n++) {
  const { store, flush } = await createRequestStore({}, null, db.io);
  store.addAudit(entry(n));
  await flush();
}

// Two requests served at the same moment: both hydrate the same head, both append.
const a = await createRequestStore({}, null, db.io);
const b = await createRequestStore({}, null, db.io);
a.store.addAudit(entry('a'));
b.store.addAudit(entry('b'));
await a.flush();
await b.flush();
// And the log carries on after the fork.
{
  const { store, flush } = await createRequestStore({}, null, db.io);
  store.addAudit(entry(6));
  await flush();
}

const verify = async (rows) => {
  const { store } = await createRequestStore({}, null, db.io);
  return store.verifyAuditChain(rows);
};
const rows = (await createRequestStore({}, null, db.io)).store.listAudit();

const forked = await verify(rows);
check('two requests appending at once still verify', forked.ok === true, JSON.stringify(forked));
check('the fork is reported as a concurrent branch, not hidden', forked.concurrentBranches >= 1, `branches ${forked.concurrentBranches}`);
check('every row is checked', forked.checked === rows.length, `${forked.checked}/${rows.length}`);

const edited = rows.map((r, i) => (i === 2 ? { ...r, summary: 'Quietly changed' } : r));
const editedResult = await verify(edited);
check('an edited row is detected', editedResult.ok === false && editedResult.reason === 'content_changed', JSON.stringify(editedResult));

const chronological = rows.slice().sort((x, y) => x.ts - y.ts);
const middle = chronological[1];
const withoutMiddle = rows.filter((r) => r.id !== middle.id);
const missingResult = await verify(withoutMiddle);
check('a row deleted from the middle is detected', missingResult.ok === false && missingResult.reason === 'predecessor_missing', JSON.stringify(missingResult));

const withoutStart = rows.filter((r) => r.id !== chronological[0].id);
const startResult = await verify(withoutStart);
check('a deleted first row is detected', startResult.ok === false, JSON.stringify(startResult));

// A known lost write can be acknowledged by an entry that is itself in the log;
// a gap the acknowledgement does not name still fails.
{
  const { store, flush } = await createRequestStore({}, null, db.io);
  store.addAudit({ ...entry('ack'), action: 'audit.gap_acknowledged', metadata: { missingPrevHashes: [middle.hash], reason: 'lost write' } });
  await flush();
}
const afterAck = (await createRequestStore({}, null, db.io)).store.listAudit();
const ackResult = await verify(afterAck.filter((r) => r.id !== middle.id));
check('an acknowledged gap verifies, and is counted', ackResult.ok === true && ackResult.acknowledgedGaps === 1, JSON.stringify(ackResult));
const otherGap = chronological[2];
const ackOther = await verify(afterAck.filter((r) => r.id !== middle.id && r.id !== otherGap.id));
check('a gap the acknowledgement does not name still fails', ackOther.ok === false && ackOther.reason === 'predecessor_missing', JSON.stringify(ackOther));

const empty = await verify([]);
check('an empty log verifies', empty.ok === true && empty.checked === 0);

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Audit chain checks passed.');
