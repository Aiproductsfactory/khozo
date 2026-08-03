import fs from 'node:fs';

const BASE_URL = 'http://localhost:4000/api';

const ROLES = [
  { role: 'super_admin', email: 'superadmin@khozo.org' },
  { role: 'admin', email: 'admin@khozo.org' },
  { role: 'police', email: 'police@khozo.org' },
  { role: 'sjpu', email: 'sjpu@khozo.org' },
  { role: 'ahtu', email: 'ahtu@khozo.org' },
  { role: 'dcrb', email: 'dcrb@khozo.org' },
  { role: 'dlsa', email: 'dlsa@khozo.org' },
  { role: 'cwc', email: 'cwc@khozo.org' },
  { role: 'dcpu', email: 'dcpu@khozo.org' },
  { role: 'rpf', email: 'rpf@khozo.org' },
  { role: 'cci', email: 'cci@khozo.org' },
  { role: 'saa', email: 'saa@khozo.org' },
  { role: 'jjb', email: 'jjb@khozo.org' },
  { role: 'state_nodal', email: 'nodal@khozo.org' },
  { role: 'sara', email: 'sara@khozo.org' },
  { role: 'crime_bureau', email: 'crimebureau@khozo.org' },
  { role: 'parent', email: 'parent@khozo.org' },
  { role: 'ngo', email: 'ngo@khozo.org' },
];

async function runHumanSim() {
  console.log('================================================================');
  console.log('  HUMAN-LIKE PROFILE END-TO-END TEST SIMULATION (18 ROLES)');
  console.log('================================================================\n');

  const results = [];

  for (const item of ROLES) {
    const startTime = Date.now();
    try {
      // Step 1: Login
      const loginRes = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: item.email, password: 'khozo123' }),
      });

      if (!loginRes.ok) throw new Error(`Login failed HTTP ${loginRes.status}`);
      const { token, user } = await loginRes.json();

      // Step 2: Fetch Scope & Dashboard Stats
      const statsRes = await fetch(`${BASE_URL}/dashboard/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const stats = await statsRes.json();

      // Step 3: Fetch Reports
      const reportsRes = await fetch(`${BASE_URL}/reports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const reportsData = await reportsRes.json();

      const durationMs = Date.now() - startTime;
      results.push({
        role: item.role,
        email: item.email,
        userName: user.name,
        scope: stats.scope || 'Default Scope',
        casesCount: reportsData.reports?.length || 0,
        status: 'PASSED',
        durationMs,
        timestamp: new Date().toISOString(),
      });

      console.log(`[PASS] Role: ${item.role.padEnd(14)} | Scope: ${(stats.scope || 'N/A').padEnd(20)} | User: ${user.name} (${durationMs}ms)`);
    } catch (err) {
      console.error(`[FAIL] Role: ${item.role} - Error: ${err.message}`);
      results.push({
        role: item.role,
        email: item.email,
        status: 'FAILED',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  console.log('\n================================================================');
  console.log(`  SIMULATION COMPLETE: ${results.filter(r => r.status === 'PASSED').length}/18 ROLES VERIFIED`);
  console.log('================================================================\n');
}

runHumanSim();
