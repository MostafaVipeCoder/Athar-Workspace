-- s2b_a_asset_result (STAGE 2b, LOCAL ONLY, idempotent). Not matched by run2a.sh (m[1-9][0-9]) on purpose: run via db/scripts/run-stage2b.sh.
-- Result bookkeeping for the storage phase + private archive bucket for originals of externally fetched images.
\set ON_ERROR_STOP on
begin;
create table if not exists migration.asset_result (
  old_path text primary key references migration.asset_map(old_path) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome text not null check (outcome in ('done','failed')),
  reason text,
  fetch_url text,
  content_type text,
  original_bytes bigint,
  full_bytes bigint,
  thumb_bytes bigint,
  width int, height int,
  archive_path text
);
revoke all on migration.asset_result from public, anon, authenticated;
insert into storage.buckets (id, name, public, file_size_limit)
  values ('migration-archive', 'migration-archive', false, null)
  on conflict (id) do nothing;
commit;
