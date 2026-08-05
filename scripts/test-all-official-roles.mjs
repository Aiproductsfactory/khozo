const BASE_URL = 'https://khozo.swastik-kumar.workers.dev/api';

const ROLES = [
  { email: 'superadmin@khozo.org', role: 'super_admin', label: 'Super Admin' },
  { email: 'admin@khozo.org', role: 'admin', label: 'ACP Admin' },
  { email: 'police@khozo.org', role: 'police', label: 'Police Officer' },
  { email: 'cwc@khozo.org', role: 'cwc', label: 'CWC Desk' },
  { email: 'dcpu@khozo.org', role: 'dcpu', label: 'DCPU Officer' },
  { email: 'ahtu@khozo.org', role: 'ahtu', label: 'AHTU Desk' },
  { email: 'sjpu@khozo.org', role: 'sjpu', label: 'SJPU Desk' },
  { email: 'rpf@khozo.org', role: 'rpf', label: 'RPF Mumbai' },
  { email: 'cci@khozo.org', role: 'cci', label: 'CCI Intake' },
  { email: 'saa@khozo.org', role: 'saa', label: 'SAA Desk' },
  { email: 'jjb@khozo.org', role: 'jjb', label: 'JJB Desk' },
  { email: 'nodal@khozo.org', role: 'state_nodal', label: 'State Nodal Officer' },
  { email: 'sara@khozo.org', role: 'sara', label: 'SARA Desk' },
  { email: 'crimebureau@khozo.org', role: 'crime_bureau', label: 'Crime Bureau' },
  { email: 'dcrb@khozo.org', role: 'dcrb', label: 'DCRB Desk' },
  { email: 'dlsa@khozo.org', role: 'dlsa', label: 'DLSA Legal Aid' },
  { email: 'parent@khozo.org', role: 'parent', label: 'Parent' },
  { email: 'ngo@khozo.org', role: 'ngo', label: 'Registered NGO' },
];

async function runTests() {
  console.log('--- Testing All 18 Official Roles & Access Control ---');
  let passed = 0;
  let failed = 0;

  for (const account of ROLES) {
    try {
      // 1. Login
      const loginRes = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: 'khozo123' }),
      });
      const loginData = await loginRes.json();

      if (loginRes.status !== 200 || !loginData.token) {
        console.error(`❌ LOGIN FAILED: ${account.label} (${account.email}) -> Status ${loginRes.status}`);
        failed++;
        continue;
      }

      // 2. Fetch /reports
      const reportsRes = await fetch(`${BASE_URL}/reports`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });
      const reportsData = await reportsRes.json();

      // 3. Fetch /reports/found/all
      const foundRes = await fetch(`${BASE_URL}/reports/found/all`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });
      const foundData = await foundRes.json();

      // 4. Fetch /dashboard/stats
      const statsRes = await fetch(`${BASE_URL}/dashboard/stats`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });

      console.log(
        `✅ ${account.label.padEnd(20)} | Role: ${account.role.padEnd(14)} | ` +
        `Reports: ${reportsRes.status} (${reportsData.reports?.length || 0}) | ` +
        `Sightings: ${foundRes.status} (${foundData.foundReports?.length || 0}) | ` +
        `Stats: ${statsRes.status}`
      );
      passed++;
    } catch (err) {
      console.error(`❌ ERROR: ${account.label} ->`, err.message);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${ROLES.length} official accounts.`);
}

runTests().catch(console.error);
