-- CCTV checks made on officers' laptops (Khozo Desktop, shared/video-jobs.js).
-- Idempotent and non-destructive; safe to re-run.
--
-- One row per check: the case, the officer, the videos (names, sizes,
-- fingerprints, camera places; never the video), how far the laptop got,
-- each batch of faces with what the face engines said, and the officer's
-- decisions. No picture is kept here: a face an officer marks as the same
-- person becomes a sighting (public.found_reports) with its own retention.

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

-- A case's checks, and an officer's.
create index if not exists video_jobs_report_idx  on public.video_jobs (report_id);
create index if not exists video_jobs_creator_idx on public.video_jobs (created_by_id);

-- One check per job on a laptop: a start sent twice at once cannot make two.
create unique index if not exists video_jobs_job_key_idx on public.video_jobs (report_id, created_by_id, (data->>'jobKey'));

alter table public.video_jobs enable row level security;
