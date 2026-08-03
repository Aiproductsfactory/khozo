async function main() {
  console.log('Sending login request to Cloudflare Worker...');
  const res = await fetch('https://khozo.swastik-kumar.workers.dev/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'superadmin@khozo.org',
      password: 'khozo123',
    }),
  });

  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response:', data);
}

main().catch(console.error);
