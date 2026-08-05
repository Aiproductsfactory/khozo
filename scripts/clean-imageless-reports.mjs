import pg from 'pg';
import '../server/src/env.js';

async function cleanupImageless() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('--- Cleaning Imageless Reports from PostgreSQL Database ---');

  // 1. Get all photo_blobs keys
  const blobRes = await pool.query('select key from public.photo_blobs');
  const validBlobKeys = new Set(blobRes.rows.map((r) => r.key));
  console.log(`Total valid photo blobs in DB: ${validBlobKeys.size}`);

  // Helper to check key or key.jpg
  const hasBlob = (key) => {
    if (!key) return false;
    const clean = String(key).trim();
    const alt = clean.endsWith('.jpg') || clean.endsWith('.png') ? clean : `${clean}.jpg`;
    return validBlobKeys.has(clean) || validBlobKeys.has(alt);
  };

  // 2. Filter Missing Reports
  const reportsRes = await pool.query('select id, photo_file, child_name from public.reports');
  const reportsToDelete = [];
  for (const r of reportsRes.rows) {
    if (!r.photo_file || !hasBlob(r.photo_file)) {
      reportsToDelete.push(r.id);
      console.log(`Marking Missing Report for deletion (No valid image): ID ${r.id} (${r.child_name || 'No Name'})`);
    }
  }

  if (reportsToDelete.length > 0) {
    const deleted = await pool.query('delete from public.reports where id = any($1::text[])', [reportsToDelete]);
    console.log(`Deleted ${deleted.rowCount} imageless missing child reports.`);
  } else {
    console.log('All missing child reports have valid photos!');
  }

  // 3. Filter Found Reports (Sightings)
  const foundRes = await pool.query('select id, photo_file from public.found_reports');
  const foundToDelete = [];
  for (const f of foundRes.rows) {
    if (!f.photo_file || !hasBlob(f.photo_file)) {
      foundToDelete.push(f.id);
      console.log(`Marking Sighting Report for deletion (No valid image): ID ${f.id}`);
    }
  }

  if (foundToDelete.length > 0) {
    const deletedFound = await pool.query('delete from public.found_reports where id = any($1::text[])', [foundToDelete]);
    console.log(`Deleted ${deletedFound.rowCount} imageless sighting reports.`);
  } else {
    console.log('All sighting reports have valid photos!');
  }

  // Summary counts
  const finalReports = await pool.query('select count(*) from public.reports');
  const finalFound = await pool.query('select count(*) from public.found_reports');
  console.log(`\nFinal Clean Database Totals:`);
  console.log(`- Authentic Missing Child Reports (with photos): ${finalReports.rows[0].count}`);
  console.log(`- Authentic Sighting Reports (with photos): ${finalFound.rows[0].count}`);

  await pool.end();
}

cleanupImageless().catch(console.error);
