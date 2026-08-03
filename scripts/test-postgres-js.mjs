import postgres from 'postgres';
import '../server/src/env.js';

async function test() {
  console.log('Testing postgres.js driver...');
  const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });
  const rows = await sql`select data->>'childName' as name from public.reports order by created_at desc limit 5`;
  console.log('Reports sample:', rows);
  await sql.end();
}

test().catch(console.error);
