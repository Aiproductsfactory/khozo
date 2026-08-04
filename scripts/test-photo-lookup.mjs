import { Client } from '@neondatabase/serverless';
import '../server/src/env.js';

async function test() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const key1 = 'f_-MNFT9No';
  const key2 = 'f_-MNFT9No.jpg';

  const res = await client.query('select key, mime, size_bytes from public.photo_blobs where key = $1 or key = $2 limit 1', [key1, key2]);
  console.log('Lookup result for key without extension:', res.rows);

  await client.end();
}

test().catch(console.error);
