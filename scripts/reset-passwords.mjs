import pg from 'pg';
import bcrypt from 'bcryptjs';
import '../server/src/env.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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
