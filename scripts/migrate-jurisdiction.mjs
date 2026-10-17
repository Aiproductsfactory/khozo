/**
 * Backfills canonical places on existing records: state and district names as
 * the gazetteer spells them, LGD stateCode and districtCode, and districtText
 * for a district the gazetteer cannot place (shared/geo/index.js).
 *
 * Records written before the gazetteer carry whatever was typed or geocoded:
 * "GUJARAT", "ગુજરાત", "Ahmadabad District", "Mumbai Suburban District". The
 * jurisdiction rules already work these codes out on the fly
 * (shared/scope.js), so nothing breaks before this runs; it makes the stored
 * records say what the rules read, so exports, the MIS and the face search's
 * district tiers agree with them.
 *
 *   node scripts/migrate-jurisdiction.mjs --dry-run              # DATABASE_URL, report only
 *   node scripts/migrate-jurisdiction.mjs                        # DATABASE_URL, write
 *   node scripts/migrate-jurisdiction.mjs --json server/data/db.json --dry-run
 *   node scripts/migrate-jurisdiction.mjs --json <copy of db.json>   # write a local JSON store
 *
 * What changes, per table:
 *
 *   reports, found_reports
 *     state/district become canonical with codes. A district that does not
 *     resolve in its state moves to districtText and the district is cleared:
 *     the record is then "state known, district unknown" and reaches every
 *     district desk of the state, instead of none of them. A sighting's
 *     reportedLocation is canonicalised the same way. Postgres's state and
 *     district columns follow the data.
 *   users
 *     An account's jurisdiction gains codes and canonical names. A district
 *     that does not resolve is left exactly as it is and listed: clearing it
 *     would leave a district desk seeing nothing (shared/scope.js fails
 *     closed), so such an account must be re-provisioned by hand.
 *
 * Safe to re-run: a record that is already canonical is not touched. Each
 * Postgres row is written only if it still holds what was read (a running API
 * that changed it meanwhile wins, and the row is reported as skipped; run
 * again). The dry run prints, per table and state, how many records resolved
 * and which district texts did not, and writes nothing.
 *
 * Never point this at a database you have not backed up.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { canonicalPlace } from '../shared/geo/index.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] || null;
};
const dryRun = flag('dry-run');
const jsonFile = option('json');
const databaseUrl = option('database-url') || process.env.DATABASE_URL || '';

if (flag('help')) {
  console.log('Usage: node scripts/migrate-jurisdiction.mjs [--dry-run] [--json <db.json>] [--database-url <url>]');
  process.exit(0);
}

// ---------------------------------------------------------------- planning

const same = (a, b) => (a ?? null) === (b ?? null);

/** The canonical fields for a record's own place, or null when nothing changes. */
function planPlace(row) {
  const hasAny = row.state || row.district || row.stateCode || row.districtCode || row.districtText;
  if (!hasAny) return { outcome: 'no_place', patch: null };
  const place = canonicalPlace({
    state: row.state,
    // An earlier run's districtText is tried again: the gazetteer may have
    // learnt the spelling since.
    district: row.district || row.districtText,
    stateCode: row.stateCode,
    districtCode: row.districtCode,
  });
  const patch = {
    state: place.state,
    stateCode: place.stateCode,
    district: place.district,
    districtCode: place.districtCode,
    districtText: place.districtText,
  };
  const outcome = !place.stateCode
    ? (row.state ? 'state_unresolved' : place.districtCode ? 'resolved' : 'district_only')
    : place.districtCode
      ? 'resolved'
      : place.districtText
        ? 'district_unresolved'
        : 'state_only';
  // Nothing is written for a record whose state cannot be placed: there is no
  // code to add, and its names are what the rules fall back to.
  const changed = Boolean(place.stateCode) && Object.keys(patch).some((key) => !same(row[key] ?? null, patch[key]));
  return { outcome, place, patch: changed ? patch : null };
}

/** A sighting's reportedLocation, canonicalised; null when unchanged. */
function planReportedLocation(row) {
  const where = row.reportedLocation;
  if (!where || typeof where !== 'object' || !(where.state || where.district)) return null;
  const place = canonicalPlace({ state: where.state, district: where.district || where.districtText, stateCode: where.stateCode, districtCode: where.districtCode });
  if (!place.stateCode) return null;
  const next = { state: place.state, stateCode: place.stateCode, district: place.district, districtCode: place.districtCode, districtText: place.districtText };
  return Object.keys(next).some((key) => !same(where[key] ?? null, next[key])) ? next : null;
}

/** An account's jurisdiction with codes; an unresolved district is kept as typed. */
function planUser(user) {
  const j = user.jurisdiction;
  if (!j || typeof j !== 'object' || !(j.state || j.district || j.stateCode)) return { outcome: 'no_place', patch: null };
  const place = canonicalPlace({ state: j.state, district: j.district, stateCode: j.stateCode, districtCode: j.districtCode });
  const next = {
    ...j,
    state: place.state ?? j.state ?? null,
    stateCode: place.stateCode,
    // Never cleared: a district desk without a district sees nothing.
    district: place.districtCode ? place.district : j.district ?? null,
    districtCode: place.districtCode,
  };
  const outcome = !place.stateCode
    ? (j.state ? 'state_unresolved' : 'district_only')
    : j.district
      ? place.districtCode ? 'resolved' : 'district_unresolved'
      : 'state_only';
  const changed = Boolean(place.stateCode)
    && ['state', 'stateCode', 'district', 'districtCode'].some((key) => !same(j[key] ?? null, next[key] ?? null));
  return { outcome, place, patch: changed ? { jurisdiction: next } : null };
}

// ----------------------------------------------------------------- summary

const summary = new Map();
const unresolvedTexts = new Map();

function tally(table, stateLabel, outcome, changed, text) {
  const key = `${table}\u0000${stateLabel}`;
  if (!summary.has(key)) summary.set(key, { table, state: stateLabel, total: 0, resolved: 0, district_unresolved: 0, state_only: 0, state_unresolved: 0, district_only: 0, no_place: 0, changes: 0 });
  const row = summary.get(key);
  row.total += 1;
  row[outcome] = (row[outcome] || 0) + 1;
  if (changed) row.changes += 1;
  if (text) {
    const textKey = `${table}\u0000${stateLabel}\u0000${text}`;
    unresolvedTexts.set(textKey, (unresolvedTexts.get(textKey) || 0) + 1);
  }
}

function stateLabelOf(planned, row) {
  if (planned.place?.state && planned.place?.stateCode) return planned.place.state;
  const raw = row.state ?? row.jurisdiction?.state;
  return raw ? `(unresolved: ${String(raw).slice(0, 40)})` : '(no state)';
}

function printSummary() {
  const rows = [...summary.values()].sort((a, b) => a.table.localeCompare(b.table) || b.total - a.total);
  const headers = ['table', 'state', 'total', 'resolved', 'district?', 'state only', 'state?', 'district only', 'no place', 'to write'];
  const lines = rows.map((r) => [r.table, r.state, r.total, r.resolved, r.district_unresolved, r.state_only, r.state_unresolved, r.district_only, r.no_place, r.changes].map(String));
  const widths = headers.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells) => cells.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(fmt(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const line of lines) console.log(fmt(line));
  console.log('\n  district?  district text that is not a district of its state (kept as districtText; users keep it as typed)');
  console.log('  state?     state text that is no Indian state or UT');
  if (unresolvedTexts.size) {
    console.log('\nUnresolved district texts (most frequent first):');
    const texts = [...unresolvedTexts.entries()]
      .map(([key, count]) => ({ parts: key.split('\u0000'), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 40);
    for (const { parts: [table, state, text], count } of texts) console.log(`  ${String(count).padStart(5)}  ${table.padEnd(13)} ${state.padEnd(22)} ${text}`);
  }
}

// ------------------------------------------------------------------ apply

function planAll(data) {
  const work = [];
  for (const [table, rows] of [['reports', data.reports], ['found_reports', data.foundReports]]) {
    for (const row of rows || []) {
      const planned = planPlace(row);
      const reportedLocation = table === 'found_reports' ? planReportedLocation(row) : null;
      const patch = planned.patch || reportedLocation ? { ...(planned.patch || {}), ...(reportedLocation ? { reportedLocation } : {}) } : null;
      tally(table, stateLabelOf(planned, row), planned.outcome, Boolean(patch), planned.outcome === 'district_unresolved' ? planned.place.districtText : null);
      if (patch) work.push({ table, row, patch });
    }
  }
  for (const user of data.users || []) {
    const planned = planUser(user);
    tally('users', stateLabelOf(planned, user), planned.outcome, Boolean(planned.patch), planned.outcome === 'district_unresolved' ? user.jurisdiction.district : null);
    if (planned.patch) work.push({ table: 'users', row: user, patch: planned.patch });
  }
  return work;
}

async function fromJson(file) {
  const target = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(target, 'utf8'));
  const work = planAll(data);
  printSummary();
  if (dryRun) {
    console.log(`\nDry run: ${work.length} record(s) would change in ${target}. Nothing was written.`);
    return;
  }
  for (const { row, patch } of work) Object.assign(row, patch);
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  console.log(`\nWrote ${work.length} record(s) to ${target}.`);
}

async function fromPostgres(url) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const read = async (table) => (await client.query(`select id, data from public.${table}`)).rows.map((r) => ({ ...r.data, id: r.id, __data: r.data }));
    const data = { reports: await read('reports'), foundReports: await read('found_reports'), users: await read('users') };
    const work = planAll(data);
    printSummary();
    if (dryRun) {
      console.log(`\nDry run: ${work.length} row(s) would change. Nothing was written.`);
      return;
    }
    let written = 0;
    let skipped = 0;
    for (const { table, row, patch } of work) {
      const before = row.__data;
      const after = { ...before, ...patch };
      const placeColumns = table === 'users' ? '' : ', state = $3, district = $4';
      const params = table === 'users'
        ? [row.id, JSON.stringify(after), JSON.stringify(before)]
        : [row.id, JSON.stringify(after), after.state ?? null, after.district ?? null, JSON.stringify(before)];
      const guard = table === 'users' ? '$3::jsonb' : '$5::jsonb';
      const res = await client.query(
        `update public.${table} set data = $2::jsonb${placeColumns} where id = $1 and data = ${guard}`,
        params
      );
      if (res.rowCount === 1) written += 1;
      else skipped += 1;
    }
    console.log(`\nWrote ${written} row(s).${skipped ? ` Skipped ${skipped} that changed while this ran; run again.` : ''}`);
  } finally {
    await client.end();
  }
}

if (jsonFile) {
  await fromJson(jsonFile);
} else if (databaseUrl) {
  await fromPostgres(databaseUrl);
} else {
  console.error('Give DATABASE_URL (or --database-url), or --json <db.json> for a local JSON store. Add --dry-run to only report.');
  process.exit(1);
}
