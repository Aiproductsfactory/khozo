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
 * fingerprints will not match: set KHOZO_FIELD_HASH_KEY as a Worker secret
 * first, then run this with the same value. The readiness report (super admin)
 * counts whole numbers left and fingerprints made under another key.
 *
 * Run it only after the code that reads fingerprints is deployed. The code
 * before it compares Aadhaar values as plain text, so it would read two
 * masked "XXXX XXXX 1234" values as the same child and raise false duplicate
 * warnings. --apply therefore also needs --confirm-deployed.
 *
 * Counts by default, which needs no key and changes nothing. Prints case ids
 * and counts, never a number.
 *
 *   node scripts/migrate-aadhaar.mjs                                # how many cases hold a whole number
 *   node scripts/migrate-aadhaar.mjs --apply --confirm-deployed     # rewrite them
 *
 * In PowerShell, set the variables first:
 *
 *   $env:DATABASE_URL = "postgres://..."
 *   $env:KHOZO_FIELD_HASH_KEY = "<the Worker's KHOZO_FIELD_HASH_KEY>"
 */

import process from 'node:process';

import pg from 'pg';

import '../server/src/env.js';
import { aadhaarFields, isFullAadhaar, privacySecrets } from '../shared/privacy.js';

const apply = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
if (apply) {
  if (!process.argv.includes('--confirm-deployed')) {
    console.error('Rewrite only after the code that reads Aadhaar fingerprints is deployed (branch dpia-and-trafficking-fixes or later). The code before it would read masked numbers as duplicates. When it is live, add --confirm-deployed.');
    process.exit(1);
  }
  // An explicit key only. A key derived from the JWT secret would change the
  // day that secret is rotated, and every fingerprint written here would stop
  // matching. Set the same value as a Worker secret first.
  if (!process.env.KHOZO_FIELD_HASH_KEY) {
    console.error('Set KHOZO_FIELD_HASH_KEY to the value the deployed API uses (npx wrangler secret put KHOZO_FIELD_HASH_KEY) before rewriting.');
    process.exit(1);
  }
}

const key = apply ? privacySecrets(process.env).fieldHashKey : null;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const { rows } = await client.query('select id, data from public.reports');
  const whole = rows.filter((row) => isFullAadhaar(row.data?.childAadhar));
  console.log(`${rows.length} cases; ${whole.length} hold a whole Aadhaar number.`);
  for (const row of whole.slice(0, 50)) console.log(`  ${row.id}`);
  if (whole.length > 50) console.log(`  … and ${whole.length - 50} more`);

  if (!apply) {
    console.log(whole.length
      ? '\nNothing changed. After the new code is deployed, rewrite them with --apply --confirm-deployed.'
      : '\nNothing to migrate.');
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
