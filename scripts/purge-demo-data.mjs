/**
 * Clears seeded and test records so a deployment shows only real work.
 *
 * Lists by default; deletes only with --apply. What it removes:
 *
 *   * missing-child cases with no photograph — the platform matches faces, so a
 *     case with no face is a placeholder, not a case
 *   * sightings with no photograph AND no reporter detail worth reviewing
 *   * every record produced by the seeders and test runs, identified by the
 *     reporter or registering account rather than by guesswork
 *   * notifications and activity that pointed at anything removed
 *
 * The demo accounts stay: they are how the platform is shown, and removing a
 * user would orphan the audit rows that reference them. The audit log is
 * append-only by database trigger and is never touched here — a child-protection
 * system whose history can be edited to look tidy is worth less than one whose
 * history is inconvenient.
 *
 *   node scripts/purge-demo-data.mjs           # report what would go
 *   node scripts/purge-demo-data.mjs --apply   # remove it
 */

import process from 'node:process';

import pg from 'pg';

import '../server/src/env.js';

const apply = process.argv.includes('--apply');

/** Reporter names the seeders and test scripts write under. */
const SEED_REPORTERS = ['Seed volunteer', 'Pipeline test', 'Deploy check', 'Anonymous Citizen'];

/**
 * Child names the face-match pipeline test registered its fixture cases under.
 * The photographs behind them are stock pictures of adults, so these are not
 * cases in any sense — they are a matcher's input, and they must not sit in a
 * missing-children register.
 */
const FIXTURE_CASE_NAMES = ['Aarav Khan', 'Rohan Kumar', 'Ananya Nair'];

/**
 * `--reset` clears every case and sighting rather than only the ones that match
 * a rule. Use when the database holds nothing but seeded and test content and
 * the platform is about to be shown as live.
 */
const reset = process.argv.includes('--reset');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const summary = [];
const note = (label, rows) => {
  summary.push({ label, rows });
  console.log(`\n${label}: ${rows.length}`);
  for (const row of rows.slice(0, 25)) console.log(`  ${row.id.padEnd(15)} ${row.detail}`);
  if (rows.length > 25) console.log(`  … and ${rows.length - 25} more`);
};

try {
  if (process.argv.includes('--all')) {
    // Full inventory, kept records included, so the decision to delete is made
    // against what is actually there rather than against the filter's output.
    const { rows: everySighting } = await client.query(
      `select f.id, (p.key is not null) as has_photo,
              coalesce(f.data->>'status', '?') as status,
              coalesce(f.data->>'reporterName', '(anonymous)') as reporter,
              coalesce(f.data->>'foundLocation', '(no location)') as location
       from public.found_reports f
       left join public.photo_blobs p on p.key = f.data->>'photoFile'
       order by f.created_at desc nulls last`
    );
    console.log(`Every sighting (${everySighting.length}):\n`);
    for (const r of everySighting) {
      console.log(`  ${r.id.padEnd(15)} photo=${String(r.has_photo).padEnd(5)} ${r.status.padEnd(16)} ${r.reporter.padEnd(20)} ${r.location}`);
    }

    const { rows: everyCase } = await client.query(
      `select r.id, (p.key is not null) as has_photo,
              coalesce(r.data->>'childName', '(no name)') as name,
              coalesce(r.data->>'registeredByName', '?') as registered_by
       from public.reports r
       left join public.photo_blobs p on p.key = r.data->>'photoFile'
       order by r.created_at desc nulls last`
    );
    console.log(`\nEvery case (${everyCase.length}):\n`);
    for (const r of everyCase) {
      console.log(`  ${r.id.padEnd(15)} photo=${String(r.has_photo).padEnd(5)} ${r.name.padEnd(24)} registered by ${r.registered_by}`);
    }
    console.log('');
  }

  const { rows: caselessPhotos } = await client.query(
    `select r.id,
            coalesce(r.data->>'childName', '(no name)') || '  ·  ' ||
            coalesce(r.data->>'state', '?') || '/' || coalesce(r.data->>'district', '?') as detail
     from public.reports r
     left join public.photo_blobs p on p.key = r.data->>'photoFile'
     where r.data->>'photoFile' is null or p.key is null
     order by r.created_at desc nulls last`
  );
  note('Missing-child cases with no stored photograph', caselessPhotos);

  const { rows: emptySightings } = await client.query(
    `select f.id,
            coalesce(f.data->>'reporterName', '(anonymous)') || '  ·  ' ||
            coalesce(f.data->>'foundLocation', '(no location)') as detail
     from public.found_reports f
     left join public.photo_blobs p on p.key = f.data->>'photoFile'
     where (f.data->>'photoFile' is null or p.key is null)
       and (f.data->>'reporterName' = any($1::text[])
            or coalesce(f.data->>'note', '') = ''
            or coalesce(f.data->>'foundLocation', '') in ('', 'test', 'Unknown'))
     order by f.created_at desc nulls last`,
    [SEED_REPORTERS]
  );
  note('Sightings with no photograph and nothing to review', emptySightings);

  const { rows: seededSightings } = await client.query(
    `select f.id,
            coalesce(f.data->>'reporterName', '(anonymous)') || '  ·  ' ||
            coalesce(f.data->>'foundLocation', '(no location)') as detail
     from public.found_reports f
     where f.data->>'reporterName' = any($1::text[])
     order by f.created_at desc nulls last`,
    [SEED_REPORTERS]
  );
  note('Sightings created by seeders or test runs', seededSightings);

  const { rows: fixtureCases } = await client.query(
    `select id, coalesce(data->>'childName', '(no name)') || '  ·  registered by the face-match pipeline test' as detail
     from public.reports
     where data->>'childName' = any($1::text[])
     order by created_at desc nulls last`,
    [FIXTURE_CASE_NAMES]
  );
  note('Cases registered by the face-match pipeline test', fixtureCases);

  let extraReports = [];
  let extraSightings = [];
  if (reset) {
    ({ rows: extraReports } = await client.query(
      `select id, coalesce(data->>'childName', '(no name)') || '  ·  cleared by --reset' as detail from public.reports`
    ));
    ({ rows: extraSightings } = await client.query(
      `select id, coalesce(data->>'foundLocation', '(no location)') || '  ·  cleared by --reset' as detail from public.found_reports`
    ));
    note('Everything else, because --reset was given', [
      ...extraReports.filter((r) => !fixtureCases.some((f) => f.id === r.id)),
      ...extraSightings.filter((s) => ![...emptySightings, ...seededSightings].some((k) => k.id === s.id)),
    ]);
  }

  const doomedReports = new Set([...caselessPhotos, ...fixtureCases, ...extraReports].map((r) => r.id));
  const doomedSightings = new Set(
    [...emptySightings, ...seededSightings, ...extraSightings].map((r) => r.id)
  );

  console.log(
    `\nTotal: ${doomedReports.size} case(s) and ${doomedSightings.size} sighting(s)` +
    `${apply ? '' : '\n\nNothing removed. Re-run with --apply to delete.'}`
  );

  if (!apply) process.exit(0);

  const reportIds = [...doomedReports];
  const sightingIds = [...doomedSightings];

  if (reportIds.length) {
    await client.query(
      `delete from public.photo_blobs where key in (
         select data->>'photoFile' from public.reports where id = any($1::text[]) and data->>'photoFile' is not null
       )`,
      [reportIds]
    );
    // A sighting matched to a case being removed loses its match, not itself.
    await client.query(
      `update public.found_reports
       set matched_report_id = null,
           data = data - 'matchedReportId' - 'matchedReport'
       where matched_report_id = any($1::text[])`,
      [reportIds]
    );
    await client.query('delete from public.reports where id = any($1::text[])', [reportIds]);
  }

  if (sightingIds.length) {
    await client.query(
      `delete from public.photo_blobs where key in (
         select data->>'photoFile' from public.found_reports where id = any($1::text[]) and data->>'photoFile' is not null
       )`,
      [sightingIds]
    );
    await client.query('delete from public.found_reports where id = any($1::text[])', [sightingIds]);
  }

  const gone = [...reportIds, ...sightingIds];
  if (gone.length) {
    const { rowCount: notifications } = await client.query(
      `delete from public.notifications
       where data->'scope'->>'foundReportId' = any($1::text[])
          or data->'scope'->>'reportId' = any($1::text[])`,
      [gone]
    );
    const { rowCount: activity } = await client.query(
      `delete from public.activity
       where data->'scope'->>'reportId' = any($1::text[])
          or data->'scope'->>'matchedReportId' = any($1::text[])`,
      [gone]
    );
    console.log(`\nAlso removed ${notifications} notification(s) and ${activity} activity entr(ies).`);
  }

  console.log(`\nRemoved ${reportIds.length} case(s) and ${sightingIds.length} sighting(s).`);
  console.log('The audit log is unchanged: it is append-only, and it is the record of what happened.');
} finally {
  await client.end();
}
