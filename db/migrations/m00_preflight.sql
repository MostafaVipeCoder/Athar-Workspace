-- m00_preflight  (05 phase 0.4)  -- additive, idempotent, safe to re-run any time.
-- Creates schemas legacy / migration / app_private, extensions, the migration control tables and
-- migration.capture_baseline(); captures the baseline row counts (BEFORE the legacy move).
-- Touches no existing object.
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;

create schema if not exists legacy;
create schema if not exists migration;
create schema if not exists app_private;

-- ---------------------------------------------------------------- extensions (installed in schema "extensions")
create extension if not exists citext      with schema extensions;
create extension if not exists pg_trgm     with schema extensions;
create extension if not exists btree_gist  with schema extensions;
create extension if not exists pgcrypto    with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- optional extensions: 04 OD-9 (pg_jsonschema) and 6.7 (pg_cron). Skipped with a NOTICE if the image lacks them.
do $$
begin
  begin
    create extension if not exists pg_jsonschema with schema extensions;
  exception when others then
    raise notice 'pg_jsonschema not installed (%): save_node falls back to size/top-level validation', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not installed (%): maintenance jobs are not scheduled', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------- schema privileges (nothing exposed)
revoke all on schema legacy    from public, anon, authenticated;
revoke all on schema migration from public, anon, authenticated;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;   -- helpers are called from RLS policies

-- ---------------------------------------------------------------- control tables (05 3.3)
create table if not exists migration.run (
  id          bigint generated always as identity primary key,
  phase       text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text,
  note        text
);
create table if not exists migration.baseline (
  table_name  text primary key,
  row_count   bigint not null,
  captured_at timestamptz not null default now()
);
create table if not exists migration.recon (
  run_id    bigint references migration.run(id) on delete cascade,
  check_key text not null,
  expected  text,
  actual    text,
  status    text check (status in ('ok','mismatch','warn')),
  detail    jsonb,
  primary key (run_id, check_key)
);
create table if not exists migration.id_map (
  entity text not null, old_id text not null, new_id uuid not null, note text,
  primary key (entity, old_id)
);
create table if not exists migration.asset_map (
  old_path text primary key, bucket text, new_path text, kind text, bytes bigint, status text
);
create table if not exists migration.flags (
  id          bigint generated always as identity primary key,
  code        text not null,
  severity    text not null check (severity in ('info','review','blocker')),
  entity      text,
  ref_id      text,
  message     text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create table if not exists migration.fixups (
  entity text not null, ref_id text not null, column_name text not null, new_value text,
  reason text, approved_by text,
  primary key (entity, ref_id, column_name)
);
create table if not exists migration.state (
  key text primary key, value text
);
revoke all on all tables in schema migration from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
-- deterministic UUIDv5 for derived ids (05 3.4); the namespace is fixed for the whole project
create or replace function migration.nid(p_name text) returns uuid
language sql immutable parallel safe set search_path = ''
as $$ select extensions.uuid_generate_v5('6f0b5a0e-3f7a-4d0e-9a41-0a7a2e9c0001'::uuid, p_name) $$;

-- pure helper: storage path of an object that lives in the current public bucket, NULL for external URLs
create or replace function migration.asset_path(p_kind text, p_url text) returns text
language sql immutable parallel safe set search_path = ''
as $$
  select case
    when p_url is null or btrim(p_url) = '' then null
    when p_url like '%/storage/v1/object/public/event-assets/%'
      then substring(p_url from '/storage/v1/object/public/event-assets/(.*)$')
    else null
  end
$$;

-- baseline capture (05 3.3 / phase 1.2).  Counts come from public.<t> before the legacy move and from legacy.<t> after it.
-- Never overwrites an existing baseline row (the freeze-time numbers are the reference).
create or replace function migration.capture_baseline() returns int
language plpgsql set search_path = '' as $$
declare
  t text; sch text; n bigint; k int := 0;
  legacy_tables text[] := array[
    'agenda_slots','alumni_invitations','ather_team_bookings','ather_team_members','ather_team_slots',
    'booking_notifications','bookings','certificates','companies','company_founders','company_snapshots',
    'company_submissions','email_audit_log','event_days','event_forms','events','expert_submissions','experts',
    'form_covers','form_field_configs','form_responses','form_share_events','founders','google_settings',
    'investor_requests','join_athar_analytics','join_athar_cards','join_athar_pages','join_athar_share_presets',
    'library_forms','library_resources','master_experts','mentor_day_config','mentor_slots',
    'mentoring_distribution_config','mentoring_distribution_day_config','mentoring_sessions','mentors',
    'notifications','opportunities','opportunity_applications','profiles','program_participations','programs',
    'project_managers','roles','smtp_settings','user_roles'];
begin
  foreach t in array legacy_tables loop
    if exists (select 1 from migration.baseline b where b.table_name = 'public.' || t) then continue; end if;
    if to_regclass('legacy.' || quote_ident(t)) is not null then sch := 'legacy';
    elsif to_regclass('public.' || quote_ident(t)) is not null then sch := 'public';
    else continue; end if;
    execute format('select count(*) from %I.%I', sch, t) into n;
    insert into migration.baseline(table_name, row_count) values ('public.' || t, n);
    k := k + 1;
  end loop;

  foreach t in array array['auth.users','auth.identities','storage.objects','storage.buckets'] loop
    if not exists (select 1 from migration.baseline b where b.table_name = t) then
      execute format('select count(*) from %s', t) into n;
      insert into migration.baseline(table_name, row_count) values (t, n);
      k := k + 1;
    end if;
  end loop;

  -- V01.4: password-hash fingerprint (never printed, only compared)
  insert into migration.state(key, value)
    select 'auth_pw_md5', md5(coalesce(string_agg(encrypted_password, ',' order by id), ''))
    from auth.users
  on conflict (key) do nothing;
  return k;
end $$;

select migration.capture_baseline() as baseline_rows_captured;
commit;
