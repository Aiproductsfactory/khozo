import pg from 'pg';
import '../server/src/env.js';

async function check() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('--- Checking Missing Reports ---');
  const reports = await pool.query("select id, child_name, data->>'childName' as name, data->>'registeredByName' as by from public.reports");
  console.log('Total reports count:', reports.rowCount);
  const testReports = reports.rows.filter(r => 
    /pipeline|test|dummy|mock/i.test(r.child_name || r.name || r.id)
  );
  console.log('Test Reports found:', testReports.length, testReports);

  console.log('--- Checking Found Reports ---');
  const found = await pool.query("select id, status, data->>'reporterName' as reporter from public.found_reports");
  console.log('Total found reports count:', found.rowCount);
  const testFound = found.rows.filter(r => 
    /pipeline|test|dummy|mock/i.test(r.reporter || r.id || r.status)
  );
  console.log('Test Found Reports found:', testFound.length, testFound);

  console.log('--- Checking Users ---');
  const users = await pool.query("select id, email, role, name, org from public.users");
  console.log('Total users count:', users.rowCount);
  console.log('User roles breakdown:', users.rows.map(u => ({ id: u.id, email: u.email, role: u.role, name: u.name, org: u.org })));

  await pool.end();
}

check().catch(console.error);
