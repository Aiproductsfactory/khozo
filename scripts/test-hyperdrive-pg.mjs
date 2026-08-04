import pg from 'pg';
import '../server/src/env.js';

async function test() {
  console.log('Testing standard pg.Client over Direct Supabase TCP...');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  await client.connect();
  console.log('Connected!');

  const res = await client.query('select key, mime, length(bytes) as len from public.photo_blobs limit 3');
  console.log('Photo blobs sample:', res.rows);

  await client.end();
}

test().catch(console.error);
