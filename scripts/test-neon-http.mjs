import { neon } from '@neondatabase/serverless';
import '../server/src/env.js';

async function test() {
  console.log('Testing neon HTTP fetch query...');
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`select data->>'email' as email from public.users limit 5`;
  console.log('Result:', rows);
}

test().catch(console.error);
