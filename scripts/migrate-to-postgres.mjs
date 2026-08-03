/**
 * Migrates the JSON file store into Postgres (Supabase).
 *
 *   node scripts/migrate-to-postgres.mjs --check     # connectivity + schema only
 *   node scripts/migrate-to-postgres.mjs --schema    # apply server/sql/001_schema.sql
 *   node scripts/migrate-to-postgres.mjs             # migrate db.json
 *   node scripts/migrate-to-postgres.mjs --verify    # compare row counts afterwards
 *
 * Requires DATABASE_URL (Supabase → Project Settings → Database → Connection
 * string → URI, using the *session* pooler on port 5432 for DDL).
 *
 * Safe to re-run: every row is an upsert keyed by id, except `audit`, which is
 * append-only and uses ON CONFLICT DO NOTHING.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import '../server/src/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'server', 'data', 'db.json');
const SCHEMA_FILE = path.join(ROOT, 'server', 'sql', '001_schema.sql');

const flag = (name) => process.argv.includes(`--${name}`);
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set.\n\n' +
      'Add it to .env:\n' +
      '  DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres\n\n' +
      'Supabase → Project Settings → Database → Connection string → URI.',
  );
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  max: 4,
  connectionTimeoutMillis: 15000,
});

const TABLES = {
  users: (r) => ({ id: r.id, email: r.email, role: r.role, name: r.name || null, phone: r.phone || null, org: r.org || null }),
  reports: (r) => ({
    id: r.id, child_name: r.childName || null, status: r.status || 'missing',
    state: r.state || null, district: r.district || null, fir_no: r.firNo || null,
    registered_by_id: r.registeredById || null, photo_file: r.photoFile || null,
    anonymized_at: r.anonymizedAt ? new Date(r.anonymizedAt) : null,
  }),
  found_reports: (r) => ({
    id: r.id, status: r.status || 'pending_review', state: r.state || null, district: r.district || null,
    matched_report_id: r.matchedReportId || null,
    match_score: typeof r.matchScore === 'number' ? r.matchScore : null,
    photo_file: r.photoFile || null,
  }),
  grievances: (r) => ({ id: r.id, status: r.status || 'open' }),
  activity: (r) => ({ id: r.id, ts: Number(r.ts) || Date.now(), actor_id: r.actorId || null }),
  audit: (r) => ({
    id: r.id, ts: Number(r.ts) || Date.now(), actor_id: r.actorId || null, actor_role: r.actorRole || null,
    action: r.action, target_type: r.targetType || null, target_id: r.targetId || null,
    hash: r.hash, prev_hash: r.prevHash || null,
  }),
};

async function tablesPresent(client) {
  const { rows } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1)`,
    [Object.keys(TABLES)],
  );
  return rows.map((r) => r.table_name);
}

async function applySchema(client) {
  console.log('Applying schema...');
  await client.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  console.log(`  created/verified ${Object.keys(TABLES).length} tables, RLS enabled, audit trigger installed`);
}

async function insertRows(client, table, rows) {
  if (!rows.length) return 0;
  let written = 0;
  for (const record of rows) {
    if (!record?.id) continue;
    const cols = { ...TABLES[table](record), data: record };
    const names = Object.keys(cols);
    const params = names.map((_, i) => `$${i + 1}`);
    const conflict =
      table === 'audit'
        ? 'do nothing'
        : `do update set ${names.filter((n) => n !== 'id').map((n) => `${n} = excluded.${n}`).join(', ')}`;
    await client.query(
      `insert into public.${table} (${names.join(', ')}) values (${params.join(', ')}) on conflict (id) ${conflict}`,
      names.map((n) => cols[n]),
    );
    written += 1;
  }
  return written;
}

async function counts(client) {
  const out = {};
  for (const table of Object.keys(TABLES)) {
    const { rows } = await client.query(`select count(*)::int as n from public.${table}`);
    out[table] = rows[0].n;
  }
  return out;
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows: version } = await client.query('select version()');
    console.log(`Connected: ${version[0].version.split(',')[0]}\n`);

    if (flag('schema')) {
      await applySchema(client);
      return;
    }

    const present = await tablesPresent(client);
    if (flag('check')) {
      console.log(`Tables present: ${present.length ? present.join(', ') : '(none)'}`);
      const missing = Object.keys(TABLES).filter((t) => !present.includes(t));
      console.log(missing.length ? `Missing: ${missing.join(', ')} — run with --schema` : 'Schema is complete.');
      return;
    }

    if (flag('verify')) {
      console.table(await counts(client));
      return;
    }

    const missing = Object.keys(TABLES).filter((t) => !present.includes(t));
    if (missing.length) {
      console.error(`Missing tables: ${missing.join(', ')}\nRun: node scripts/migrate-to-postgres.mjs --schema`);
      process.exitCode = 1;
      return;
    }

    if (!fs.existsSync(DB_FILE)) {
      console.error(`No JSON store at ${DB_FILE} — nothing to migrate.`);
      process.exitCode = 1;
      return;
    }

    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // Audit rows go oldest-first: the hash chain is order-dependent.
    const plan = [
      ['users', db.users || []],
      ['reports', db.reports || []],
      ['found_reports', db.foundReports || []],
      ['grievances', db.grievances || []],
      ['activity', db.activity || []],
      ['audit', (db.audit || []).slice().reverse()],
    ];

    console.log('Migrating db.json -> Postgres\n');
    // One transaction: a partial migration is worse than none.
    await client.query('begin');
    try {
      for (const [table, rows] of plan) {
        const written = await insertRows(client, table, rows);
        console.log(`  ${table.padEnd(14)} ${String(written).padStart(5)} rows`);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    }

    console.log('\nRow counts now in Postgres:');
    console.table(await counts(client));
    console.log('\nNext: set DATABASE_URL in the API environment and restart. Photos in');
    console.log('server/data/uploads still live on disk — see docs/DEPLOYMENT.md §Storage.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}`);
  process.exit(1);
});
