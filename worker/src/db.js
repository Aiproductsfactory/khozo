import pg from 'pg';

export async function query(env, text, params, ctx) {
  let connectionString =
    env?.HYPERDRIVE?.connectionString ||
    env?.DATABASE_URL ||
    process.env.DATABASE_URL ||
    '';

  connectionString = String(connectionString || '').trim().replace(/^["']|["']$/g, '');

  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured in Cloudflare Worker environment.');
  }

  const isHyperdrive = connectionString.includes('hyperdrive.local');
  const client = new pg.Client({
    connectionString,
    ssl: isHyperdrive ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  await client.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    const endPromise = client.end().catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(endPromise);
    } else {
      await endPromise;
    }
  }
}

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
  // CCTV checks made on laptops (shared/video-jobs.js).
  video_jobs: (r) => ({
    id: r.id,
    report_id: r.reportId || null,
    created_by_id: r.createdById || null,
    status: r.status || 'open',
  }),
  notifications: (r) => ({
    id: r.id,
    ts: Number(r.ts) || Date.now(),
    user_id: r.userId || null,
    kind: r.kind || null,
    read_at: r.readAt ? Number(r.readAt) : null,
  }),
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

export async function upsertRecord(env, table, record, ctx) {
  if (!record?.id) return;
  const { text, values } = upsertSql(table, record);
  await query(env, text, values, ctx);
}

/**
 * Writes many rows of one table in a single statement.
 *
 * Every query here opens its own connection, so a row-at-a-time loop costs a
 * round trip each. Reporting a sighting alerts every authority account at once,
 * which made the most time-critical request in the product the one that paid
 * that cost most: one insert per officer, in series, before the citizen saw
 * their receipt.
 */
export async function upsertMany(env, table, records, ctx) {
  const rows = records.filter((r) => r?.id);
  if (!rows.length) return;
  if (rows.length === 1) return upsertRecord(env, table, rows[0], ctx);

  const names = Object.keys({ ...TABLES[table](rows[0]), data: rows[0] });
  const values = [];
  const tuples = rows.map((record) => {
    const cols = { ...TABLES[table](record), data: record };
    const placeholders = names.map((name) => {
      values.push(cols[name]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const conflict =
    table === 'audit'
      ? 'do nothing'
      : `do update set ${names.filter((n) => n !== 'id').map((n) => `${n} = excluded.${n}`).join(', ')}`;

  await query(
    env,
    `insert into public.${table} (${names.join(', ')}) values ${tuples.join(', ')}
     on conflict (id) ${conflict}`,
    values,
    ctx,
  );
}

/**
 * Reads one row as it is in the database right now, with a version: the md5 of
 * its stored JSON. `updateIfVersion` writes only while that version still
 * holds.
 */
export async function readVersioned(env, table, id, ctx) {
  const { rows } = await query(
    env,
    `select data, md5(data::text) as version from public.${table} where id = $1`,
    [id],
    ctx,
  );
  return rows.length && rows[0].data ? { data: rows[0].data, version: rows[0].version } : null;
}

/**
 * Writes `record` over its row only if the row is still the version that was
 * read (readVersioned): a compare-and-set, for a change that is only right if
 * nobody else changed the row in between. Returns whether it was written.
 */
export async function updateIfVersion(env, table, record, version, ctx) {
  if (!record?.id || !version) return false;
  const cols = { ...TABLES[table](record), data: record };
  const names = Object.keys(cols).filter((name) => name !== 'id');
  const values = names.map((name) => cols[name]);
  const sets = names.map((name, i) => `${name} = $${i + 1}`);
  values.push(record.id, version);
  const { rowCount } = await query(
    env,
    `update public.${table} set ${sets.join(', ')}
     where id = $${names.length + 1} and md5(data::text) = $${names.length + 2}`,
    values,
    ctx,
  );
  return rowCount === 1;
}

export async function savePhotoBlob(env, key, buffer, mime, ctx) {
  await query(
    env,
    `insert into public.photo_blobs (key, mime, bytes, size_bytes)
     values ($1, $2, $3, $4)
     on conflict (key) do update set mime = excluded.mime, bytes = excluded.bytes, size_bytes = excluded.size_bytes`,
    [key, mime || 'image/jpeg', buffer, buffer.length],
    ctx,
  );
  return true;
}

export async function readPhotoBlob(env, key, ctx) {
  const clean = String(key || '').trim();
  const alt = clean.endsWith('.jpg') || clean.endsWith('.png') ? clean : `${clean}.jpg`;
  const { rows } = await query(
    env,
    'select mime, bytes from public.photo_blobs where key = $1 or key = $2 limit 1',
    [clean, alt],
    ctx,
  );
  return rows.length ? { mime: rows[0].mime, buffer: rows[0].bytes } : null;
}

/** Deletes a photo under the same two spellings readPhotoBlob finds it by. */
export async function deletePhotoBlob(env, key, ctx) {
  const clean = String(key || '').trim();
  if (!clean) return false;
  const alt = clean.endsWith('.jpg') || clean.endsWith('.png') ? clean : `${clean}.jpg`;
  const { rowCount } = await query(env, 'delete from public.photo_blobs where key = $1 or key = $2', [clean, alt], ctx);
  return rowCount > 0;
}

export async function photoBlobStats(env, ctx) {
  const { rows } = await query(
    env,
    'select count(*)::int as count, coalesce(sum(size_bytes),0)::bigint as total_bytes from public.photo_blobs',
    [],
    ctx,
  );
  return { count: rows[0].count, totalBytes: Number(rows[0].total_bytes) };
}

/**
 * The CCTV checks' table (server/sql/003_video_jobs.sql), made by the Worker
 * itself when it is missing: a deploy whose migration was forgotten would
 * otherwise leave Khozo Desktop's checks switched off without a word. The
 * same statements as the SQL file, kept in step by scripts/store-replica-smoke.mjs.
 */
export const VIDEO_JOBS_DDL = `
create table if not exists public.video_jobs (
  id   text primary key,
  data jsonb not null default '{}'::jsonb
);

alter table public.video_jobs
  add column if not exists report_id     text,
  add column if not exists created_by_id text,
  add column if not exists status        text,
  add column if not exists created_at    timestamptz default now();

update public.video_jobs set
  report_id     = coalesce(report_id,     data->>'reportId'),
  created_by_id = coalesce(created_by_id, data->>'createdById'),
  status        = coalesce(status,        data->>'status')
where report_id is null or created_by_id is null or status is null;

create index if not exists video_jobs_report_idx  on public.video_jobs (report_id);
create index if not exists video_jobs_creator_idx on public.video_jobs (created_by_id);

create unique index if not exists video_jobs_job_key_idx on public.video_jobs (report_id, created_by_id, (data->>'jobKey'));

alter table public.video_jobs enable row level security;
`;

let videoJobsTable = null; // this isolate's answer, once known
/**
 * Makes the CCTV checks' table if it is not there. Resolves to whether it is
 * there now; a refusal (a database user without the right to make tables) is
 * logged, and the check routes stay off as before.
 */
export function ensureVideoJobsTable(env, ctx) {
  videoJobsTable ||= (async () => {
    const { rows } = await query(env, "select to_regclass('public.video_jobs') is not null as present", [], ctx);
    if (rows?.[0]?.present) return true;
    await query(env, VIDEO_JOBS_DDL, undefined, ctx);
    console.warn('[db] made public.video_jobs (server/sql/003_video_jobs.sql had not been run)');
    return true;
  })().catch((err) => {
    videoJobsTable = null;
    console.error('[db] could not make public.video_jobs:', err?.message || err);
    return false;
  });
  return videoJobsTable;
}
