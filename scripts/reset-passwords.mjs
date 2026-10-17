import pg from 'pg';
import bcrypt from 'bcryptjs';
import '../server/src/env.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// This sets EVERY account to one well-known password. Run against production
// it re-opens super admin to anyone who has read this repository, so it now
// refuses any database that is not on this machine.
const host = (() => { try { return new URL(process.env.DATABASE_URL || '').hostname; } catch { return ''; } })();
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Refusing to reset passwords on ${host || 'an unknown database'}: this script is for a local development database only.`);
  process.exit(1);
}

async function main() {
  const hash = bcrypt.hashSync('khozo123', 8);
  const { rows } = await pool.query('SELECT data FROM public.users');
  console.log(`Updating passwords for ${rows.length} users...`);

  for (const row of rows) {
    const user = row.data;
    user.passwordHash = hash;
    await pool.query(
      'UPDATE public.users SET data = $1, email = $2 WHERE id = $3',
      [JSON.stringify(user), user.email, user.id]
    );
  }

  console.log('All demo passwords reset to khozo123 in Postgres.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
