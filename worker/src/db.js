import { Client } from '@neondatabase/serverless';

export async function query(env, text, params) {
  let connectionString =
    env?.DATABASE_URL ||
    env?.HYPERDRIVE?.connectionString ||
    process.env.DATABASE_URL ||
    '';

  connectionString = String(connectionString || '').trim().replace(/^["']|["']$/g, '');

  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured in Cloudflare Worker environment.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    await client.end().catch(() => {});
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

export async function upsertRecord(env, table, record) {
  if (!record?.id) return;
  const { text, values } = upsertSql(table, record);
  await query(env, text, values);
}

export async function savePhotoBlob(env, key, buffer, mime) {
  await query(
    env,
    `insert into public.photo_blobs (key, mime, bytes, size_bytes)
     values ($1, $2, $3, $4)
     on conflict (key) do update set mime = excluded.mime, bytes = excluded.bytes, size_bytes = excluded.size_bytes`,
    [key, mime || 'image/jpeg', buffer, buffer.length],
  );
  return true;
}

export async function readPhotoBlob(env, key) {
  const { rows } = await query(env, 'select mime, bytes from public.photo_blobs where key = $1', [key]);
  return rows.length ? { mime: rows[0].mime, buffer: rows[0].bytes } : null;
}

export async function deletePhotoBlob(env, key) {
  const { rowCount } = await query(env, 'delete from public.photo_blobs where key = $1', [key]);
  return rowCount > 0;
}

export async function photoBlobStats(env) {
  const { rows } = await query(
    env,
    'select count(*)::int as count, coalesce(sum(size_bytes),0)::bigint as total_bytes from public.photo_blobs',
  );
  return { count: rows[0].count, totalBytes: Number(rows[0].total_bytes) };
}
