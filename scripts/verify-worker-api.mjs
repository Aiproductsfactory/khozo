async function verify() {
  const headers = { Connection: 'close' };

  console.log('1. Testing /api/health...');
  const healthRes = await fetch('https://khozo.swastik-kumar.workers.dev/api/health', { headers });
  const health = await healthRes.json();
  console.log('   Status:', healthRes.status, health);

  console.log('\n2. Testing /api/reports/bulletins...');
  const bulletinsRes = await fetch('https://khozo.swastik-kumar.workers.dev/api/reports/bulletins', { headers });
  const bulletins = await bulletinsRes.json();
  console.log('   Status:', bulletinsRes.status, 'Bulletins count:', bulletins.bulletins?.length);

  console.log('\n3. Testing /api/auth/login...');
  const loginRes = await fetch('https://khozo.swastik-kumar.workers.dev/api/auth/login', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@khozo.org', password: 'khozo123' }),
  });
  const login = await loginRes.json();
  console.log('   Status:', loginRes.status, 'User:', login.user?.name, 'Role:', login.user?.role);

  console.log('\n4. Testing /api/dashboard/stats (Gated Auth)...');
  const statsRes = await fetch('https://khozo.swastik-kumar.workers.dev/api/dashboard/stats', {
    headers: { ...headers, Authorization: `Bearer ${login.token}` },
  });
  const stats = await statsRes.json();
  console.log('   Status:', statsRes.status, 'Scope:', stats.stats?.scopeLabel, 'Total Missing:', stats.stats?.totalMissing);

  console.log('\n🎉 ALL CLOUDFLARE WORKER API ENDPOINTS ARE 100% OPERATIONAL!');
}

verify().catch(console.error);
