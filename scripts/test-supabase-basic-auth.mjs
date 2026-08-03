async function test() {
  console.log('Testing Supabase REST API with Basic Auth...');
  const credentials = Buffer.from('postgres.txmhuhejxfeskufryoik:Khozo@13131').toString('base64');
  const res = await fetch('https://txmhuhejxfeskufryoik.supabase.co/rest/v1/reports?select=data', {
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.slice(0, 200));
}

test().catch(console.error);
