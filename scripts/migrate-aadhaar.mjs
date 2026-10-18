/**
 * Replaces every Aadhaar number stored whole with its last four digits and a
 * keyed fingerprint (shared/privacy.js, DPIA G2).
 *
 * Cases registered from now on never store the number. Cases registered
 * before still do, in the `reports` table's JSON. This rewrites them the same
 * way registration now writes a new case, so duplicate detection keeps
 * working across old and new records.
 *
 * The fingerprint key must be the one the deployed API uses, or old and new
 * fingerprints will not match: set KHOZO_FIELD_HASH_KEY to the Worker's value,
 * or, if the Worker has none, KHOZO_JWT_SECRET to the Worker's JWT secret (the
 * key is derived from it). The script refuses to run against a real database
 * with the development secret.
 *
 * Lists by default; rewrites only with --apply. Prints case ids and counts,
 * never a number.
 *
 *   node scripts/migrate-aadhaar.mjs           # how many cases hold a whole number
 *   node scripts/migrate-aadhaar.mjs --apply   # rewrite them
 */

import process from 'node:process';

import pg from 'pg';

import '../server/src/env.js';
import { DEV_ROOT_SECRET, aadhaarFields, isFullAadhaar, privacySecrets } from '../shared/privacy.js';

const apply = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
if (!process.env.KHOZO_FIELD_HASH_KEY && (!process.env.KHOZO_JWT_SECRET || process.env.KHOZO_JWT_SECRET === DEV_ROOT_SECRET)) {
  console.error('Set KHOZO_FIELD_HASH_KEY (or KHOZO_JWT_SECRET) to the deployed API\'s value first: fingerprints made with another key will not match new registrations.');
  process.exit(1);
}

const key = privacySecrets(process.env).fieldHashKey;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const { rows } = await client.query('select id, data from public.reports');
  const whole = rows.filter((row) => isFullAadhaar(row.data?.childAadhar));
  console.log(`${rows.length} cases; ${whole.length} hold a whole Aadhaar number.`);
  for (const row of whole.slice(0, 50)) console.log(`  ${row.id}`);
  if (whole.length > 50) console.log(`  … and ${whole.length - 50} more`);

  if (!apply) {
    console.log('\nNothing changed. Run with --apply to rewrite them.');
  } else {
    await client.query('begin');
    for (const row of whole) {
      const data = { ...row.data, ...aadhaarFields(row.data.childAadhar, key) };
      // eslint-disable-next-line no-await-in-loop
      await client.query('update public.reports set data = $2 where id = $1', [row.id, data]);
    }
    await client.query('commit');
    const { rows: after } = await client.query('select data from public.reports');
    const left = after.filter((row) => isFullAadhaar(row.data?.childAadhar)).length;
    console.log(`\nRewrote ${whole.length} cases. Whole numbers left: ${left}.`);
    if (left) process.exitCode = 1;
  }
} catch (err) {
  await client.query('rollback').catch(() => {});
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
