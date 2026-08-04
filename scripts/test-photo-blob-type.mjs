import { Client } from '@neondatabase/serverless';
import '../server/src/env.js';

async function test() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const res = await client.query('select key, mime, bytes, length(bytes) as len from public.photo_blobs limit 1');
  const row = res.rows[0];
  console.log('Row key:', row.key);
  console.log('Row mime:', row.mime);
  console.log('Bytes type:', typeof row.bytes, Object.prototype.toString.call(row.bytes));
  console.log('Is Buffer?', Buffer.isBuffer(row.bytes));
  console.log('Is Uint8Array?', row.bytes instanceof Uint8Array);

  await client.end();
}

test().catch(console.error);
