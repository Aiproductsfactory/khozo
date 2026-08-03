// Postgres persistence for the Khozo store.
//
// WHY THIS SHAPE
//
// The application reads its data synchronously in 262 places, many of them
// inside `.filter()` callbacks in the jurisdiction-scoping logic (`scope.js`).
// Making those async would touch every route handler and every access-control
// helper - the highest-risk code in a child-protection system - for no gain at
// this data volume.
//
// So Postgres is the durable system of record, and the process keeps the whole
// dataset in memory as a read replica:
//
//   reads   -> synchronous, from memory (store.js, unchanged)
//   writes  -> applied to memory, then queued as a serialized Postgres upsert
//   boot    -> hydrate memory from Postgres
//
// TRADE-OFFS, stated plainly:
//   * Single writer. Two API instances would each hold a cache and diverge.
//     Run one instance, or move reads to async queries before scaling out.
//   * A hard crash can lose writes queued in the last few milliseconds.
//     `flushPending()` is called on SIGINT/SIGTERM so ordinary restarts and
//     deploys do not.
//   * Memory holds the full dataset. Fine for a district or state pilot;
//     revisit past ~10^5 cases.
//
// Without DATABASE_URL the store falls back to the JSON file, so local
// development and the existing tests keep working untouched.

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || '';
export const isPostgres = Boolean(DATABASE_URL);

let pool = null;
if (isPostgres) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    // Supabase's pooler terminates TLS with a certificate chain Node does not
    // ship a root for; the connection is still encrypted.
    ssl: DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
}

/**
 * Indexed columns per table. The complete record always goes into `data`;
 * these are mirrored out of it so Postgres can index and constrain them.
 */
const TABLES = {
  users: (r) => ({ id: r.id, email: r.email, role: r.role, name: r.name || null, phone: r.phone || null, org: r.org || null }),
  reports: (r) => ({
    id: r.id,
    child_name: r.childName || null,
    status: r.status || 'missing',
    state: r.state || null,
    district: r.district || null,
    fir_no: r.firNo || null,
    registered_by_id: r.registeredById || null,
    photo_file: r.photoFile || null,
    anonymized_at: r.anonymizedAt ? new Date(r.anonymizedAt) : null,
  }),
  found_reports: (r) => ({
    id: r.id,
    status: r.status || 'pending_review',
    state: r.state || null,
    district: r.district || null,
    matched_report_id: r.matchedReportId || null,
    match_score: typeof r.matchScore === 'number' ? r.matchScore : null,
    photo_file: r.photoFile || null,
  }),
  grievances: (r) => ({ id: r.id, status: r.status || 'open' }),
  activity: (r) => ({ id: r.id, ts: Number(r.ts) || Date.now(), actor_id: r.actorId || null }),
  audit: (r) => ({
    id: r.id,
    ts: Number(r.ts) || Date.now(),
    actor_id: r.actorId || null,
    actor_role: r.actorRole || null,
    action: r.action,
    target_type: r.targetType || null,
    target_id: r.targetId || null,
    hash: r.hash,
    prev_hash: r.prevHash || null,
  }),
};

function upsertSql(table, record) {
  const cols = { ...TABLES[table](record), data: record };
  const names = Object.keys(cols);
  const params = names.map((_, i) => `$${i + 1}`);
  // The audit trigger rejects UPDATE, so a replayed insert must be a no-op
  // rather than an error.
  const conflict =
    table === 'audit'
      ? 'do nothing'
      : `do update set ${names.filter((n) => n !== 'id').map((n) => `${n} = excluded.${n}`).join(', ')}`;
  return {
    text: `insert into public.${table} (${names.join(', ')}) values (${params.join(', ')})
           on conflict (id) ${conflict}`,
    values: names.map((n) => cols[n]),
  };
}

// Writes are serialized so rows land in the order the application produced them,
// which the audit hash chain depends on.
let writeChain = Promise.resolve();
let queuedWrites = 0;
let lastWriteError = null;

/** Queues a durable write. Returns immediately; callers stay synchronous. */
export function enqueueUpsert(table, record) {
  if (!pool || !record?.id) return;
  queuedWrites += 1;
  writeChain = writeChain
    .then(async () => {
      const { text, values } = upsertSql(table, record);
      await pool.query(text, values);
      lastWriteError = null;
    })
    .catch((err) => {
      lastWriteError = err;
      // Swallowed so one bad row cannot stall every later write. Surfaced via
      // pendingWrites() and logged for the operator.
      console.error(`[db] write failed for ${table}/${record.id}:`, err.message);
    })
    .finally(() => {
      queuedWrites -= 1;
    });
}

/** Waits for every queued write to land. Call before exiting. */
export async function flushPending() {
  await writeChain;
  return { pending: queuedWrites, lastError: lastWriteError?.message || null };
}

export function pendingWrites() {
  return { queued: queuedWrites, lastError: lastWriteError?.message || null };
}

/** Loads the full dataset into memory at boot. */
export async function hydrate() {
  if (!pool) return null;
  const read = async (table, order = '') => {
    const { rows } = await pool.query(`select data from public.${table} ${order}`);
    return rows.map((row) => row.data);
  };
  const [users, reports, foundReports, grievances, activity, audit] = await Promise.all([
    read('users'),
    read('reports', 'order by created_at desc'),
    read('found_reports', 'order by created_at desc'),
    read('grievances', 'order by created_at desc'),
    read('activity', 'order by ts desc'),
    // store.js keeps the audit log newest-first and reverses it to verify.
    read('audit', 'order by ts desc'),
  ]);
  return { users, reports, foundReports, grievances, activity, audit };
}

// --- Photo storage ---------------------------------------------------------
// Images live in Postgres, not on the API server's disk: hosts like Render have
// an ephemeral filesystem, so a redeploy would silently destroy every photo
// attached to an open case.

export async function savePhotoBlob(key, buffer, mime) {
  if (!pool) return false;
  await pool.query(
    `insert into public.photo_blobs (key, mime, bytes, size_bytes)
     values ($1, $2, $3, $4)
     on conflict (key) do update set mime = excluded.mime, bytes = excluded.bytes, size_bytes = excluded.size_bytes`,
    [key, mime || 'image/jpeg', buffer, buffer.length],
  );
  return true;
}

export async function readPhotoBlob(key) {
  if (!pool) return null;
  const { rows } = await pool.query('select mime, bytes from public.photo_blobs where key = $1', [key]);
  return rows.length ? { mime: rows[0].mime, buffer: rows[0].bytes } : null;
}

export async function deletePhotoBlob(key) {
  if (!pool) return false;
  const { rowCount } = await pool.query('delete from public.photo_blobs where key = $1', [key]);
  return rowCount > 0;
}

export async function photoBlobStats() {
  if (!pool) return null;
  const { rows } = await pool.query(
    'select count(*)::int as count, coalesce(sum(size_bytes),0)::bigint as total_bytes from public.photo_blobs',
  );
  return { count: rows[0].count, totalBytes: Number(rows[0].total_bytes) };
}

export async function ping() {
  if (!pool) return { ok: false, reason: 'DATABASE_URL not set' };
  try {
    const { rows } = await pool.query('select count(*)::int as n from public.reports');
    return { ok: true, reports: rows[0].n };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function closePool() {
  await flushPending();
  if (pool) await pool.end();
}
