import { Client } from '@neondatabase/serverless';
import '../server/src/env.js';

async function test() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const id = 'r_z1KBSyJM';
  const res = await client.query(
    'select id, data->>\'childName\' as name, data->\'bulletin\' as bulletin from public.reports where id = $1 or photo_file = $1 or data->>\'id\' = $1 or data->>\'photoFile\' = $1 limit 1',
    [id]
  );
  console.log('Report lookup result:', res.rows);

  await client.end();
}

test().catch(console.error);
