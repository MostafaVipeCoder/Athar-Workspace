-- m01_freeze_and_isolate_legacy  (05 phase 1)
-- LOCAL ONLY.  Moves the 48 old public tables, their owned sequences, the old functions and the old enums to schema
-- "legacy" (metadata-only), removes the old auth trigger and the old realtime table, and locks "legacy" down so that
-- only the table owner (postgres) can reach it.  Idempotent: objects already in legacy are skipped; new public objects
-- with the same names (created later by m02..m07) are never touched because only objects NOT yet in legacy and
-- listed explicitly here are moved.
set search_path = public, extensions;

begin;

-- 1. baseline (no-op when already captured)
select migration.capture_baseline() as baseline_rows_newly_captured;

-- 2. move the 48 tables (+ owned sequences, indexes, triggers, policies, constraints move with them)
do $$
declare
  t text;
  tabs text[] := array[
    'agenda_slots','alumni_invitations','ather_team_bookings','ather_team_members','ather_team_slots',
    'booking_notifications','bookings','certificates','companies','company_founders','company_snapshots',
    'company_submissions','email_audit_log','event_days','event_forms','events','expert_submissions','experts',
    'form_covers','form_field_configs','form_responses','form_share_events','founders','google_settings',
    'investor_requests','join_athar_analytics','join_athar_cards','join_athar_pages','join_athar_share_presets',
    'library_forms','library_resources','master_experts','mentor_day_config','mentor_slots',
    'mentoring_distribution_config','mentoring_distribution_day_config','mentoring_sessions','mentors',
    'notifications','opportunities','opportunity_applications','profiles','program_participations','programs',
    'project_managers','roles','smtp_settings','user_roles'];
  moved int := 0;
begin
  foreach t in array tabs loop
    if to_regclass('legacy.' || quote_ident(t)) is null and to_regclass('public.' || quote_ident(t)) is not null then
      -- first run only: the public table is the OLD one (the legacy copy does not exist yet)
      execute format('alter table public.%I set schema legacy', t);
      moved := moved + 1;
    end if;
  end loop;
  raise notice 'tables moved to legacy: %', moved;
end $$;

-- 3. old enums
do $$
declare t text;
begin
  foreach t in array array['app_role','project_role'] loop
    if to_regtype('legacy.' || t) is null and to_regtype('public.' || t) is not null then
      execute format('alter type public.%I set schema legacy', t);
    end if;
  end loop;
end $$;

-- 4. old functions (explicit list of the 14 legacy functions; only those not yet in legacy)
do $$
declare r record; moved int := 0;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('broadcast_master_expert_updates','get_user_roles','handle_expert_auto_index','handle_new_user',
                        'has_role','is_project_manager','is_project_owner','is_super_admin',
                        'sync_project_managers_columns','update_md_day_config_updated_at',
                        'update_mentor_day_config_updated_at','update_mentoring_updated_at',
                        'update_programs_updated_at','update_updated_at_column')
      and p.prokind = 'f'
      -- old signatures only (the new model keeps its helpers in app_private; public RPCs use other names)
      and p.pronargs <= 2
      and not exists (select 1 from pg_proc q where q.pronamespace = 'legacy'::regnamespace
                      and q.proname = p.proname and q.proargtypes = p.proargtypes)
  loop
    execute format('alter function %s set schema legacy', r.sig);
    moved := moved + 1;
  end loop;
  raise notice 'functions moved to legacy: %', moved;
end $$;

-- 5. the old auth hook (re-created with the new function in m06) and the old realtime table
drop trigger if exists on_auth_user_created on auth.users;
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'legacy' and tablename = 'company_submissions') then
    alter publication supabase_realtime drop table legacy.company_submissions;
  end if;
end $$;

-- 6. lock the archive down: nobody but the owner.  (Legacy policies stay attached to the tables but are unreachable:
--    no schema USAGE and no table privilege for anon/authenticated/service_role.)
revoke all on schema legacy from public, anon, authenticated, service_role;
revoke all on all tables    in schema legacy from public, anon, authenticated, service_role;
revoke all on all sequences in schema legacy from public, anon, authenticated, service_role;
revoke all on all functions in schema legacy from public, anon, authenticated, service_role;
alter default privileges in schema legacy revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges in schema legacy revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema legacy revoke all on functions from public, anon, authenticated, service_role;

insert into migration.state(key, value) values ('stage1_legacy_isolated_at', now()::text)
  on conflict (key) do nothing;
commit;
