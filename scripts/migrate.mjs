/**
 * Applies every SQL file in server/sql, in order.
 *
 * Each file is written to be idempotent (`create table if not exists`, `add
 * column if not exists`), so a re-run is a no-op and there is no migration
 * ledger to keep in sync. That is the right trade at this size: one fewer piece
 * of state that can disagree with the database.
 *
 *   node scripts/migrate.mjs             # apply
 *   node scripts/migrate.mjs --dry-run   # list what would run
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import '../server/src/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlDir = path.join(root, 'server', 'sql');
const dryRun = process.argv.includes('--dry-run');

const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();

console.log(`Khozo migrations\n  directory: ${sqlDir}\n  files: ${files.length}\n`);

if (dryRun) {
  for (const file of files) console.log(`  would apply  ${file}`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

let failed = 0;
try {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
    try {
      await client.query(sql);
      console.log(`  applied      ${file}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAILED       ${file}\n               ${err.message}`);
    }
  }
} finally {
  await client.end();
}

console.log(`\n${files.length - failed}/${files.length} applied`);
process.exit(failed ? 1 : 0);
