-- Khozo schema. Idempotent and non-destructive.
--
-- Handles two starting points:
--   * a fresh database, and
--   * the earlier `id + data jsonb` tables written by the old background sync,
--     which hold records that exist nowhere else.
--
-- Nothing is ever dropped: columns are added, then backfilled out of `data`.
-- Re-running is safe.
--
-- Design notes:
--  * Identifying and queryable fields are real columns so they can be indexed.
--    Everything else stays in `data` jsonb, so record shapes can evolve without
--    a migration per field.
--  * RLS is enabled with NO policies. The API connects as the service role,
--    which bypasses RLS, and enforces the 16-role jurisdiction rules in code.
--    Anything reaching Postgres with the anon key sees nothing.

-- ---------------------------------------------------------------------------
-- Base tables (no-ops where the sync already created them)
-- ---------------------------------------------------------------------------
create table if not exists public.users         (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.reports       (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.found_reports (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.grievances    (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.activity      (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.audit         (id text primary key, data jsonb not null default '{}'::jsonb);

-- Photo bytes. Deliberately a separate table: the API hydrates every other
-- table into memory at boot, and image data must never be part of that.
-- Rows are fetched only by key, on demand.
create table if not exists public.photo_blobs (
  key        text primary key,
  mime       text not null default 'image/jpeg',
  bytes      bytea not null,
  size_bytes integer,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists email      text,
  add column if not exists role       text,
  add column if not exists name       text,
  add column if not exists phone      text,
  add column if not exists org        text,
  add column if not exists created_at timestamptz default now();

alter table public.reports
  add column if not exists child_name       text,
  add column if not exists status           text,
  add column if not exists state            text,
  add column if not exists district         text,
  add column if not exists fir_no           text,
  add column if not exists registered_by_id text,
  add column if not exists photo_file       text,
  add column if not exists anonymized_at    timestamptz,
  add column if not exists created_at       timestamptz default now();

alter table public.found_reports
  add column if not exists status            text,
  add column if not exists state             text,
  add column if not exists district          text,
  add column if not exists matched_report_id text,
  add column if not exists match_score       double precision,
  add column if not exists photo_file        text,
  add column if not exists created_at        timestamptz default now();

alter table public.grievances
  add column if not exists status     text,
  add column if not exists created_at timestamptz default now();

alter table public.activity
  add column if not exists ts       bigint,
  add column if not exists actor_id text;

alter table public.audit
  add column if not exists ts          bigint,
  add column if not exists actor_id    text,
  add column if not exists actor_role  text,
  add column if not exists action      text,
  add column if not exists target_type text,
  add column if not exists target_id   text,
  add column if not exists hash        text,
  add column if not exists prev_hash   text;

-- ---------------------------------------------------------------------------
-- Backfill from the jsonb payload.
--
-- The append-only trigger is dropped first and recreated at the end: without
-- this, re-running the script fails against its own guard on public.audit.
-- The window is inside this script's implicit transaction, so the audit log is
-- never unprotected to anything else.
-- ---------------------------------------------------------------------------
drop trigger if exists audit_no_update on public.audit;

update public.users set
  email      = coalesce(email, data->>'email'),
  role       = coalesce(role, data->>'role'),
  name       = coalesce(name, data->>'name'),
  phone      = coalesce(phone, data->>'phone'),
  org        = coalesce(org, data->>'org'),
  -- Not coalesced: `add column ... default now()` stamps existing rows on the
  -- spot, so the real creation time must be taken from `data` unconditionally.
  created_at = case
    when data->>'createdAt' ~ '^[0-9]+$' then to_timestamp((data->>'createdAt')::bigint / 1000.0)
    else created_at
  end;

update public.reports set
  child_name       = coalesce(child_name, data->>'childName'),
  status           = coalesce(status, data->>'status', 'missing'),
  state            = coalesce(state, data->>'state'),
  district         = coalesce(district, data->>'district'),
  fir_no           = coalesce(fir_no, data->>'firNo'),
  registered_by_id = coalesce(registered_by_id, data->>'registeredById'),
  photo_file       = coalesce(photo_file, data->>'photoFile'),
  created_at = case
    when data->>'createdAt' ~ '^[0-9]+$' then to_timestamp((data->>'createdAt')::bigint / 1000.0)
    else created_at
  end;

update public.found_reports set
  status            = coalesce(status, data->>'status', 'pending_review'),
  state             = coalesce(state, data->>'state'),
  district          = coalesce(district, data->>'district'),
  matched_report_id = coalesce(matched_report_id, data->>'matchedReportId'),
  match_score       = coalesce(match_score, (data->>'matchScore')::double precision),
  photo_file        = coalesce(photo_file, data->>'photoFile'),
  created_at = case
    when data->>'createdAt' ~ '^[0-9]+$' then to_timestamp((data->>'createdAt')::bigint / 1000.0)
    else created_at
  end;

update public.grievances set
  status     = coalesce(status, data->>'status', 'open'),
  -- Not coalesced: `add column ... default now()` stamps existing rows on the
  -- spot, so the real creation time must be taken from `data` unconditionally.
  created_at = case
    when data->>'createdAt' ~ '^[0-9]+$' then to_timestamp((data->>'createdAt')::bigint / 1000.0)
    else created_at
  end;

update public.activity set
  ts       = coalesce(ts, (data->>'ts')::bigint, extract(epoch from now())::bigint * 1000),
  actor_id = coalesce(actor_id, data->>'actorId');

update public.audit set
  ts          = coalesce(ts, (data->>'ts')::bigint, extract(epoch from now())::bigint * 1000),
  actor_id    = coalesce(actor_id, data->>'actorId'),
  actor_role  = coalesce(actor_role, data->>'actorRole'),
  action      = coalesce(action, data->>'action', 'unknown'),
  target_type = coalesce(target_type, data->>'targetType'),
  target_id   = coalesce(target_id, data->>'targetId'),
  hash        = coalesce(hash, data->>'hash'),
  prev_hash   = coalesce(prev_hash, data->>'prevHash');

-- ---------------------------------------------------------------------------
-- Constraints and indexes
-- ---------------------------------------------------------------------------
create unique index if not exists users_email_key   on public.users (email) where email is not null;
create index        if not exists users_role_idx    on public.users (role);

create index if not exists reports_status_idx     on public.reports (status);
create index if not exists reports_scope_idx      on public.reports (state, district);
create index if not exists reports_openphoto_idx  on public.reports (status) where photo_file is not null;

create index if not exists found_status_idx  on public.found_reports (status);
create index if not exists found_scope_idx   on public.found_reports (state, district);
create index if not exists found_matched_idx on public.found_reports (matched_report_id);

create index if not exists activity_ts_idx   on public.activity (ts desc);
create index if not exists audit_ts_idx      on public.audit (ts desc);
create index if not exists audit_target_idx  on public.audit (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Access control: deny everything to anon/authenticated. The API uses the
-- service role key, which bypasses RLS; no policy is created deliberately.
-- ---------------------------------------------------------------------------
alter table public.photo_blobs   enable row level security;
alter table public.users         enable row level security;
alter table public.reports       enable row level security;
alter table public.found_reports enable row level security;
alter table public.grievances    enable row level security;
alter table public.activity      enable row level security;
alter table public.audit         enable row level security;

-- ---------------------------------------------------------------------------
-- Audit log is append-only, enforced in the database so an application bug
-- cannot rewrite history. Created last: it blocks the backfill UPDATE above.
-- ---------------------------------------------------------------------------
create or replace function public.audit_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit log is append-only (attempted % on %)', tg_op, tg_table_name;
end;
$$;

drop trigger if exists audit_no_update on public.audit;
create trigger audit_no_update before update or delete on public.audit
  for each row execute function public.audit_is_append_only();
