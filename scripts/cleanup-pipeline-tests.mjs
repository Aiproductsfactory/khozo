import pg from 'pg';
import '../server/src/env.js';

async function cleanup() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('Cleaning up pipeline test records...');

  // 1. Delete photo_blobs associated with pipeline test found_reports
  const testPhotos = await pool.query(
    "select photo_file from public.found_reports where data->>'reporterName' = 'Pipeline test' or data->>'reporterName' iLike '%pipeline%' or id iLike '%test%'"
  );
  const photoKeys = testPhotos.rows.map(r => r.photo_file).filter(Boolean);
  if (photoKeys.length > 0) {
    const deletedPhotos = await pool.query("delete from public.photo_blobs where key = any($1::text[])", [photoKeys]);
    console.log(`Deleted ${deletedPhotos.rowCount} photo blobs associated with pipeline tests.`);
  }

  // 2. Delete found_reports
  const deletedFound = await pool.query(
    "delete from public.found_reports where data->>'reporterName' = 'Pipeline test' or data->>'reporterName' iLike '%pipeline%' or id iLike '%test%'"
  );
  console.log(`Deleted ${deletedFound.rowCount} pipeline test found reports.`);

  // 3. Delete reports with 'pipeline' or 'test' in name
  const deletedReports = await pool.query(
    "delete from public.reports where child_name iLike '%pipeline%' or data->>'childName' iLike '%pipeline%'"
  );
  console.log(`Deleted ${deletedReports.rowCount} pipeline test missing reports.`);

  // 4. Check remaining counts
  const remainingReports = await pool.query("select count(*) from public.reports");
  const remainingFound = await pool.query("select count(*) from public.found_reports");
  console.log(`Remaining Missing Reports: ${remainingReports.rows[0].count}`);
  console.log(`Remaining Found Reports: ${remainingFound.rows[0].count}`);

  await pool.end();
}

cleanup().catch(console.error);
