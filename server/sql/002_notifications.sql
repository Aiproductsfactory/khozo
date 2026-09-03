-- Authority notifications. Idempotent and non-destructive; safe to re-run.
--
-- One row per recipient rather than one row per event, because the thing the
-- interface needs is per-officer read state: "has this person seen it yet".
-- At a district or state pilot the fan-out is tens of rows per sighting.
--
-- A notification carries where and when a child was seen, never who the child
-- is. The alert goes to every authority so a sighting cannot sit unseen because
-- it landed outside someone's district; opening the record behind it is still
-- gated by the same jurisdiction rules as everything else.

create table if not exists public.notifications (
  id   text primary key,
  data jsonb not null default '{}'::jsonb
);

alter table public.notifications
  add column if not exists ts          bigint,
  add column if not exists user_id     text,
  add column if not exists kind        text,
  add column if not exists read_at     bigint,
  add column if not exists created_at  timestamptz default now();

update public.notifications set
  ts      = coalesce(ts,      (data->>'ts')::bigint),
  user_id = coalesce(user_id, data->>'userId'),
  kind    = coalesce(kind,    data->>'kind'),
  read_at = coalesce(read_at, (data->>'readAt')::bigint)
where ts is null or user_id is null or kind is null;

-- The inbox query is always "this user's notifications, newest first", and the
-- badge is "how many of those are unread".
create index if not exists notifications_user_ts_idx on public.notifications (user_id, ts desc);
create index if not exists notifications_unread_idx  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
