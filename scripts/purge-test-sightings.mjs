/**
 * Removes sighting records created by verification runs, so a demo review queue
 * shows real content only.
 *
 * Lists by default and deletes only with --delete, and only rows whose id you
 * name. Nothing here matches on a pattern: the review queue is a child-safety
 * work queue, and a script that guesses which rows are "tests" is a script that
 * eventually deletes a real report of a real child.
 *
 *   node scripts/purge-test-sightings.mjs                       # list recent
 *   node scripts/purge-test-sightings.mjs --delete f_abc,f_def  # remove those
 */

import pg from 'pg';
import process from 'node:process';

import '../server/src/env.js';

const ids = (() => {
  const i = process.argv.indexOf('--delete');
  return i === -1 ? [] : String(process.argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
})();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  if (!ids.length) {
    const { rows } = await client.query(
      `select id,
              data->>'status' as status,
              data->>'reporterName' as reporter,
              data->>'foundLocation' as location,
              data->>'photoFile' as photo
       from public.found_reports
       order by created_at desc
       limit 40`
    );
    console.log(`${rows.length} most recent sighting(s):\n`);
    for (const r of rows) {
      console.log(`  ${r.id.padEnd(14)} ${String(r.status || '').padEnd(16)} ${String(r.reporter || '').padEnd(24)} ${r.location || ''}`);
    }
    console.log('\nTo remove: node scripts/purge-test-sightings.mjs --delete <id>,<id>');
  } else {
    for (const id of ids) {
      const { rows } = await client.query(
        "select data->>'foundLocation' as location, data->>'photoFile' as photo from public.found_reports where id = $1",
        [id]
      );
      if (!rows.length) {
        console.log(`  ${id.padEnd(14)} not found`);
        continue;
      }
      if (rows[0].photo) await client.query('delete from public.photo_blobs where key = $1', [rows[0].photo]);
      await client.query('delete from public.found_reports where id = $1', [id]);
      console.log(`  ${id.padEnd(14)} removed  (${rows[0].location || ''})`);
    }
  }
} finally {
  await client.end();
}
