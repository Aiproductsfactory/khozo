import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import '../server/src/env.js';

async function test() {
  const secret = process.env.KHOZO_JWT_SECRET;
  console.log('Generating Supabase service_role token...');
  const token = jwt.sign(
    { role: 'service_role', iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 },
    secret
  );

  const supabaseUrl = 'https://txmhuhejxfeskufryoik.supabase.co';
  const supabase = createClient(supabaseUrl, token);

  console.log('Querying public.users via Supabase JS...');
  const { data, error } = await supabase.from('users').select('data').limit(5);
  if (error) {
    console.error('Supabase Error:', error);
  } else {
    console.log('Success! Users count:', data.length);
    console.log('Sample user:', data[0]?.data?.email);
  }
}

test().catch(console.error);
