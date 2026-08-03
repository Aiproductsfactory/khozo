import { Client } from '@neondatabase/serverless';
import '../server/src/env.js';

async function test() {
  console.log('Testing @neondatabase/serverless Client over WebSocket...');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query('select data->>\'childName\' as name from public.reports order by created_at desc limit 5');
  console.log('Result:', res.rows);
  await client.end();
}

test().catch(console.error);
