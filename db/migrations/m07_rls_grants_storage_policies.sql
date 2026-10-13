-- m07_rls_grants_storage_policies  (05 phase 2 / m07; design 03 section 8 and 11.1; design 04 6.9)
-- 1) RLS ENABLE + FORCE on every table of public and app_private;  2) the policy set (dropped and recreated as a set:
-- permissive policies OR together, so no merging with anything old);  3) grants: anon gets NO table privilege, authenticated
-- only the verbs its policies use, EXECUTE only on the listed RPCs;  4) Realtime publication: node_revisions only;
-- 5) storage buckets + policies.  Re-runnable.
set search_path = public, extensions;

begin;

-- ================================================================= small safe helpers used by storage policies / policy text
create or replace function app_private.storage_project_manager(p_folder text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then app_private.is_project_manager(p_folder::uuid) else false end
$$;

-- founders may not re-point their own row to another auth user nor change the e-mail that was linked (03 8.3 "whitelist")
create or replace function app_private.founders_self_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;     -- loaders / service role
  if not app_private.has_any_role(array['alumni_manager','super_admin'])
     and (new.auth_user_id is distinct from old.auth_user_id or new.email is distinct from old.email) then
    raise exception 'auth_user_id and e-mail can only be changed by an alumni manager' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists founders_bu_self_guard on public.founders;
create trigger founders_bu_self_guard before update on public.founders
  for each row execute function app_private.founders_self_guard();

-- ================================================================= 1. RLS on everywhere (ENABLE + FORCE)
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('public','app_private') loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
    execute format('alter table %I.%I force row level security',  r.schemaname, r.tablename);
  end loop;
end $$;

-- ================================================================= 2. policies: drop all, recreate
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname in ('public','app_private') loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- helper: one per-command policy TO authenticated, named <table>_<cmd>_<who>  (removed at the end of this file)
create or replace function app_private._mkpol(p_table text, p_cmd text, p_who text, p_using text, p_check text default null) returns void
language plpgsql set search_path = '' as $$
declare cmd text := upper(p_cmd); sql text;
begin
  sql := format('create policy %I on public.%I for %s to authenticated', p_table || '_' || lower(p_cmd) || '_' || p_who, p_table, cmd);
  if cmd in ('SELECT','DELETE') then sql := sql || format(' using (%s)', p_using);
  elsif cmd = 'INSERT' then sql := sql || format(' with check (%s)', coalesce(p_check, p_using));
  elsif cmd = 'UPDATE' then sql := sql || format(' using (%s) with check (%s)', p_using, coalesce(p_check, p_using));
  else raise exception 'bad cmd'; end if;
  execute sql;
end $$;

-- ---- reusable predicate texts (every call in the "(select ...)" initplan form)
do $$
declare
  uid   constant text := '(select auth.uid())';
  pm    constant text := '(select app_private.is_project_manager(project_id))';
  mgr   constant text := '(select app_private.has_any_role(array[''alumni_manager'',''super_admin'']))';
  sadm  constant text := '(select app_private.is_super_admin())';
  mycos constant text := '(select app_private.my_company_ids())';
  myfs  constant text := '(select app_private.my_founder_ids())';
  t text;
begin
  -- ---------------- ID family
  perform app_private._mkpol('roles', 'select', 'authenticated', uid || ' is not null');
  perform app_private._mkpol('field_semantics', 'select', 'authenticated', uid || ' is not null');
  perform app_private._mkpol('node_types', 'select', 'authenticated', uid || ' is not null');
  perform app_private._mkpol('user_roles', 'select', 'own_or_admin', 'user_id = ' || uid || ' or ' || sadm);
  perform app_private._mkpol('user_roles', 'insert', 'admin', sadm);
  perform app_private._mkpol('user_roles', 'update', 'admin', sadm);
  perform app_private._mkpol('user_roles', 'delete', 'admin', sadm);
  perform app_private._mkpol('profiles', 'select', 'own_or_team', 'id = ' || uid || ' or (select app_private.is_teammate(id))');
  perform app_private._mkpol('profiles', 'update', 'own', 'id = ' || uid);

  -- ---------------- MEMBER family
  perform app_private._mkpol('program_members', 'select', 'member', 'user_id = ' || uid || ' or (select app_private.is_program_member(program_id))');
  perform app_private._mkpol('program_members', 'insert', 'admin', sadm);
  perform app_private._mkpol('program_members', 'update', 'owner', '(select app_private.is_program_owner(program_id))');
  perform app_private._mkpol('program_members', 'delete', 'owner_or_self', '(select app_private.is_program_owner(program_id)) or user_id = ' || uid);
  perform app_private._mkpol('project_members', 'select', 'member', 'user_id = ' || uid || ' or (select app_private.is_project_manager(project_id))');
  perform app_private._mkpol('project_members', 'insert', 'admin', sadm);
  perform app_private._mkpol('project_members', 'update', 'owner', '(select app_private.is_project_owner(project_id))');
  perform app_private._mkpol('project_members', 'delete', 'owner_or_self', '(select app_private.is_project_owner(project_id)) or user_id = ' || uid);

  -- ---------------- STRUCT family
  perform app_private._mkpol('programs', 'select', 'member', '(select app_private.can_see_program(id))');
  perform app_private._mkpol('programs', 'insert', 'pm_role',
    '(select app_private.has_any_role(array[''project_manager'',''super_admin''])) and created_by = ' || uid);
  perform app_private._mkpol('programs', 'update', 'member', '(select app_private.is_program_member(id))');
  perform app_private._mkpol('programs', 'delete', 'owner', '(select app_private.is_program_owner(id))');
  perform app_private._mkpol('projects', 'select', 'pm', '(select app_private.is_project_manager(id))');
  perform app_private._mkpol('projects', 'insert', 'program_member', '(select app_private.is_program_member(program_id)) and created_by = ' || uid);
  perform app_private._mkpol('projects', 'update', 'pm', '(select app_private.is_project_manager(id))');
  perform app_private._mkpol('projects', 'delete', 'owner', '(select app_private.is_project_owner(id))');

  -- ---------------- GRAPH / PM family: PM of project_id for all four commands
  foreach t in array array['nodes','edges','public_links','lists','forms','form_sections','form_questions','list_items',
        'agenda_days','agenda_slots','library_selections','landing_cards','landing_share_presets','landing_frames',
        'distributions','distribution_days','distribution_day_mentors','distribution_mentor_rules','distribution_sessions',
        'booking_settings','booking_providers','booking_slots','certificate_templates','certificate_template_fields'] loop
    perform app_private._mkpol(t, 'select', 'pm', pm);
    perform app_private._mkpol(t, 'insert', 'pm', pm);
    perform app_private._mkpol(t, 'update', 'pm', pm);
    perform app_private._mkpol(t, 'delete', 'pm', pm);
  end loop;
  perform app_private._mkpol('node_revisions', 'select', 'pm', pm);            -- no client writes at all: triggers / RPCs bump
  perform app_private._mkpol('node_events', 'select', 'pm', pm);               -- insert only through track_node_event
  perform app_private._mkpol('selection_reviews', 'select', 'pm', pm);         -- PII family: no client insert (set_item_status)
  perform app_private._mkpol('selection_reviews', 'update', 'pm', pm);
  perform app_private._mkpol('public_link_slugs', 'select', 'pm',
    'exists (select 1 from public.public_links l where l.id = link_id and (select app_private.is_project_manager(l.project_id)))');
  perform app_private._mkpol('public_link_slugs', 'insert', 'pm',
    'exists (select 1 from public.public_links l where l.id = link_id and (select app_private.is_project_manager(l.project_id)))');
  perform app_private._mkpol('public_link_slugs', 'update', 'pm',
    'exists (select 1 from public.public_links l where l.id = link_id and (select app_private.is_project_manager(l.project_id)))');
  perform app_private._mkpol('public_link_slugs', 'delete', 'pm',
    'exists (select 1 from public.public_links l where l.id = link_id and (select app_private.is_project_manager(l.project_id)))');

  -- ---------------- scoped-or-global tables (project_id NULL = global library row)
  foreach t in array array['resources','form_covers','form_templates'] loop
    perform app_private._mkpol(t, 'select', 'pm_or_global',
      '(project_id is not null and ' || pm || ') or (project_id is null and (select app_private.has_any_role(array[''project_manager'',''super_admin''])))');
    perform app_private._mkpol(t, 'insert', 'pm_or_admin', '(project_id is not null and ' || pm || ') or (project_id is null and ' || sadm || ')');
    perform app_private._mkpol(t, 'update', 'pm_or_admin', '(project_id is not null and ' || pm || ') or (project_id is null and ' || sadm || ')');
    perform app_private._mkpol(t, 'delete', 'pm_or_admin', '(project_id is not null and ' || pm || ') or (project_id is null and ' || sadm || ')');
  end loop;

  -- ---------------- PII / participants / bookings / certificates
  perform app_private._mkpol('form_responses', 'select', 'pm_or_own', pm || ' or submitted_by = ' || uid);
  perform app_private._mkpol('form_responses', 'update', 'pm', pm);
  perform app_private._mkpol('form_responses', 'delete', 'owner', '(select app_private.is_project_owner(project_id))');
  perform app_private._mkpol('bookings', 'select', 'pm', pm);
  perform app_private._mkpol('bookings', 'update', 'pm', pm);
  perform app_private._mkpol('bookings', 'delete', 'pm', pm);
  -- booking_invitations and app_private.*: RLS on, no client policy (RPC / service role only)
  perform app_private._mkpol('participants', 'select', 'pm_own_alumni',
    pm || ' or user_id = ' || uid || ' or company_id in ' || mycos || ' or (select app_private.has_role(''alumni_manager''))');
  perform app_private._mkpol('participants', 'insert', 'pm', pm);
  perform app_private._mkpol('participants', 'update', 'pm', pm);
  perform app_private._mkpol('participants', 'delete', 'pm', pm);
  perform app_private._mkpol('certificates', 'select', 'pm_alumni_own',
    pm || ' or (select app_private.has_role(''alumni_manager'')) or (revoked_at is null and exists (select 1 from public.participants pa '
    || 'where pa.id = participant_id and pa.status = ''attended'' and (pa.user_id = ' || uid || ' or pa.company_id in ' || mycos || ')))');
  perform app_private._mkpol('certificates', 'update', 'pm', pm);
  perform app_private._mkpol('certificates', 'delete', 'admin', sadm);

  -- ---------------- NETWORK / ENTITY families
  perform app_private._mkpol('network_experts', 'select', 'staff', '(select app_private.has_any_role(array[''project_manager'',''alumni_manager'',''super_admin'']))');
  perform app_private._mkpol('network_experts', 'insert', 'pm_role', '(select app_private.has_any_role(array[''project_manager'',''super_admin'']))');
  perform app_private._mkpol('network_experts', 'update', 'pm_role', '(select app_private.has_any_role(array[''project_manager'',''super_admin'']))');
  perform app_private._mkpol('network_experts', 'delete', 'admin', sadm);

  perform app_private._mkpol('companies', 'select', 'own_or_staff',
    'id in ' || mycos || ' or created_by = ' || uid || ' or ' || mgr || ' or (select app_private.pm_can_read_company(id))');
  perform app_private._mkpol('companies', 'insert', 'roles',
    'created_by = ' || uid || ' and (select app_private.has_any_role(array[''founder'',''project_manager'',''alumni_manager'',''super_admin'']))');
  perform app_private._mkpol('companies', 'update', 'own_or_mgr', 'id in ' || mycos || ' or ' || mgr);
  perform app_private._mkpol('companies', 'delete', 'mgr', mgr);

  perform app_private._mkpol('founders', 'select', 'self_or_staff',
    'auth_user_id = ' || uid || ' or ' || mgr || ' or (select app_private.pm_can_read_founder(id))');
  perform app_private._mkpol('founders', 'insert', 'mgr', mgr);
  perform app_private._mkpol('founders', 'update', 'self_or_mgr', 'auth_user_id = ' || uid || ' or ' || mgr);
  perform app_private._mkpol('founders', 'delete', 'mgr', mgr);
  perform app_private._mkpol('company_founders', 'select', 'own_or_mgr', 'founder_id in ' || myfs || ' or ' || mgr);
  perform app_private._mkpol('company_founders', 'insert', 'mgr_or_creator',
    mgr || ' or (founder_id in ' || myfs || ' and exists (select 1 from public.companies c where c.id = company_id and c.created_by = ' || uid || '))');
  perform app_private._mkpol('company_founders', 'update', 'mgr', mgr);
  perform app_private._mkpol('company_founders', 'delete', 'mgr', mgr);

  -- ---------------- ALUMNI family
  foreach t in array array['alumni_invitations'] loop
    perform app_private._mkpol(t, 'select', 'mgr', mgr);
    perform app_private._mkpol(t, 'insert', 'mgr', mgr);
    perform app_private._mkpol(t, 'update', 'mgr', mgr);
    perform app_private._mkpol(t, 'delete', 'mgr', mgr);
  end loop;
  perform app_private._mkpol('notifications', 'select', 'own_or_mgr', 'recipient_id = ' || uid || ' or founder_id in ' || myfs || ' or ' || mgr);
  perform app_private._mkpol('notifications', 'insert', 'mgr', mgr);
  perform app_private._mkpol('notifications', 'update', 'own_or_mgr', 'recipient_id = ' || uid || ' or founder_id in ' || myfs || ' or ' || mgr);
  perform app_private._mkpol('opportunities', 'select', 'roles',
    '(select app_private.has_any_role(array[''founder'',''project_manager'',''alumni_manager'',''super_admin''])) and (is_active or ' || mgr || ')');
  perform app_private._mkpol('opportunities', 'insert', 'mgr', mgr);
  perform app_private._mkpol('opportunities', 'update', 'mgr', mgr);
  perform app_private._mkpol('opportunities', 'delete', 'mgr', mgr);
  perform app_private._mkpol('opportunity_applications', 'select', 'own_or_mgr', 'company_id in ' || mycos || ' or ' || mgr);
  perform app_private._mkpol('opportunity_applications', 'insert', 'own',
    'company_id in ' || mycos || ' and (founder_id is null or founder_id in ' || myfs || ')');
  perform app_private._mkpol('opportunity_applications', 'update', 'mgr', mgr);
  perform app_private._mkpol('opportunity_applications', 'delete', 'mgr', mgr);
  perform app_private._mkpol('investor_requests', 'select', 'own_or_mgr', 'company_id in ' || mycos || ' or ' || mgr);
  perform app_private._mkpol('investor_requests', 'insert', 'own_or_mgr', 'company_id in ' || mycos || ' or ' || mgr);
  perform app_private._mkpol('investor_requests', 'update', 'mgr', mgr);
  perform app_private._mkpol('company_snapshots', 'select', 'own_mgr_pm', 'company_id in ' || mycos || ' or ' || mgr || ' or (select app_private.pm_can_read_company(company_id))');
  perform app_private._mkpol('company_snapshots', 'insert', 'own_or_mgr', 'company_id in ' || mycos || ' or ' || mgr);
  perform app_private._mkpol('company_snapshots', 'update', 'mgr', mgr);
end $$;

drop function app_private._mkpol(text, text, text, text, text);

-- ================================================================= 3. grants
-- 3a. wipe: anon and authenticated start from nothing everywhere we own
revoke all on all tables    in schema public      from anon, authenticated;
revoke all on all sequences in schema public      from anon, authenticated;
revoke all on all functions in schema public      from public, anon, authenticated;
revoke all on all tables    in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on all tables    in schema migration   from public, anon, authenticated;
revoke all on all functions in schema migration   from public, anon, authenticated;

-- 3b. authenticated: exactly the verbs its policies use (generated from pg_policies, so they cannot drift apart)
do $$
declare r record;
begin
  for r in
    select p.tablename,
           string_agg(distinct case p.cmd when 'SELECT' then 'select' when 'INSERT' then 'insert' when 'UPDATE' then 'update' when 'DELETE' then 'delete' end, ', ') as verbs
    from pg_policies p
    where p.schemaname = 'public' and p.roles = '{authenticated}' and p.cmd in ('SELECT','INSERT','UPDATE','DELETE')
    group by p.tablename
  loop
    execute format('grant %s on public.%I to authenticated', r.verbs, r.tablename);
  end loop;
end $$;
-- views: security_invoker views inherit RLS of the underlying tables (which carry the grants above)
grant select on public.v_programs, public.v_network_expert_programs, public.v_network_expert_usage, public.v_company_programs,
                public.v_company_usage, public.v_program_participations, public.v_distribution_sessions,
                public.v_node_event_counts, public.my_google_connection to authenticated;

-- 3c. EXECUTE grants.  Policy helpers (called from RLS expressions by the invoking role):
grant execute on function
  app_private.has_role(text), app_private.has_any_role(text[]), app_private.is_super_admin(), app_private.is_program_member(uuid),
  app_private.is_program_owner(uuid), app_private.can_see_program(uuid), app_private.is_project_manager(uuid),
  app_private.is_project_owner(uuid), app_private.my_founder_ids(), app_private.my_company_ids(), app_private.is_participant(uuid),
  app_private.is_teammate(uuid), app_private.pm_can_read_company(uuid), app_private.pm_can_read_founder(uuid),
  app_private.node_project(uuid), app_private.storage_project_manager(text)
  to authenticated;

-- RPCs for signed-in users (each re-checks the caller internally)
grant execute on function
  public.create_program(text,text,text,text,text,smallint), public.create_project(uuid,text,text,text),
  public.add_member(text,uuid,uuid,text), public.get_project_graph(uuid), public.get_node(uuid), public.get_graph_revisions(uuid),
  public.add_node(uuid,text,jsonb,double precision,double precision,jsonb), public.save_node(uuid,bigint,jsonb,jsonb,boolean),
  public.move_nodes(uuid,jsonb), public.delete_node(uuid), public.restore_node(uuid),
  public.connect(uuid,uuid,text,uuid,text,jsonb), public.update_edge(uuid,jsonb), public.disconnect(uuid),
  public.resolve_list(uuid,jsonb,int,jsonb), public.ensure_item(uuid,text,uuid), public.ensure_items(uuid,jsonb),
  public.patch_item_overlay(uuid,jsonb), public.set_item_status(uuid,text,text), public.reorder_items(uuid,uuid[]),
  public.exclude_item(uuid,boolean), public.add_manual_item(uuid,jsonb), public.add_network_pick(uuid,uuid),
  public.add_company_pick(uuid,uuid), public.detach_item_to_manual(uuid), public.merge_companies(uuid,uuid),
  public.network_expert_usage(uuid), public.list_participants(uuid,text), public.enroll_accepted(uuid,uuid),
  public.assign_participant(uuid,uuid,uuid), public.set_participant_status(uuid,text), public.mark_all_attended(uuid),
  public.request_withdrawal(uuid), public.complete_project(uuid), public.reopen_project(uuid), public.complete_all_projects(uuid),
  public.get_my_programs(), public.get_founder_program_page(uuid), public.my_meetings(uuid),
  public.ensure_public_link(uuid,text,text,uuid), public.set_public_slug(uuid,text), public.rotate_public_link(uuid),
  public.issue_certificate(uuid,uuid), public.issue_certificates_bulk(uuid), public.revoke_certificate(uuid,text),
  public.get_certificate_render_payload(uuid), public.enqueue_email(uuid,text,uuid[],int,boolean),
  public.create_invitations(uuid,uuid[]), public.accept_invitation(text),
  public.poller_claim_bookings(int), public.poller_complete_booking(uuid,text,text), public.poller_fail_booking(uuid,text),
  public.purge_soft_deleted(interval), public.prune_email_bodies(interval), public.report_orphan_assets()
  to authenticated;

-- 5.9: the ONLY functions anon may execute (exhaustive), also granted to authenticated
grant execute on function
  public.resolve_ref(text,text), public.get_agenda_view(text), public.get_public_tab(text,uuid,jsonb), public.get_public_form(text),
  public.get_public_booking_page(text,uuid,text), public.create_booking(text,uuid,jsonb,text), public.cancel_booking(uuid,text),
  public.track_node_event(text,text,uuid,text), public.verify_certificate(text), public.validate_invitation(text)
  to anon, authenticated;
-- service role only (edge functions / workers): submit_form_response, claim_*, complete_*, fail_*  (service_role keeps its default grants)

-- ================================================================= 4. Realtime: node_revisions only
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'node_revisions') then
    alter publication supabase_realtime add table public.node_revisions;
  end if;
end $$;

-- ================================================================= 5. storage: split buckets and policies (04 6.9, 03 11.1)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-assets',         'public-assets',         true,  5242880,  array['image/png','image/jpeg','image/webp','image/gif']),
  ('form-uploads',          'form-uploads',          false, 10485760, array['image/png','image/jpeg','image/webp','image/gif','application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain']),
  ('founder-assets',        'founder-assets',        false, 2097152,  array['image/png','image/jpeg','image/webp']),
  ('certificate-templates', 'certificate-templates', false, 10485760, array['image/png','image/jpeg','application/pdf']),
  ('resources',             'resources',             false, 52428800, array['application/pdf','audio/mpeg','audio/mp4','audio/wav','audio/ogg','image/png','image/jpeg','image/webp','video/mp4'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- remove the open/orphan policies of the old model: public upload to event-assets and the three policies of the non-existent event-covers
drop policy if exists "Allow All Uploads" on storage.objects;
drop policy if exists join_athar_select   on storage.objects;
drop policy if exists join_athar_update   on storage.objects;
drop policy if exists join_athar_upload   on storage.objects;
-- "Public Access" (SELECT on event-assets) stays until the stage-2 storage move; the bucket itself is public-read by design.

-- new policy set (named <bucket>_<cmd>_<who>); dropped and recreated so reruns are exact
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname ~ '^(public_assets|form_uploads|founder_assets|certificate_templates|resources)_' loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- public-assets: world-readable; writes only under <project_id>/... of a project the caller manages, or global/... for super_admin
create policy public_assets_select_all on storage.objects for select to anon, authenticated
  using (bucket_id = 'public-assets');
create policy public_assets_insert_pm on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
              or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));
create policy public_assets_update_pm on storage.objects for update to authenticated
  using (bucket_id = 'public-assets' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
              or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))))
  with check (bucket_id = 'public-assets' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
              or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));
create policy public_assets_delete_pm on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
              or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));

-- form-uploads: no direct write policy (signed upload URLs from an edge function); PMs read files of their project
create policy form_uploads_select_pm on storage.objects for select to authenticated
  using (bucket_id = 'form-uploads' and (select app_private.storage_project_manager((storage.foldername(name))[1])));

-- founder-assets: founders/<auth.uid()>/<file>; alumni managers and super_admin read
create policy founder_assets_select_own on storage.objects for select to authenticated
  using (bucket_id = 'founder-assets' and (((storage.foldername(name))[1] = 'founders' and (storage.foldername(name))[2] = (select auth.uid())::text)
         or (select app_private.has_any_role(array['alumni_manager','super_admin']))));
create policy founder_assets_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'founder-assets' and (storage.foldername(name))[1] = 'founders' and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy founder_assets_update_own on storage.objects for update to authenticated
  using (bucket_id = 'founder-assets' and (storage.foldername(name))[1] = 'founders' and (storage.foldername(name))[2] = (select auth.uid())::text)
  with check (bucket_id = 'founder-assets' and (storage.foldername(name))[1] = 'founders' and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy founder_assets_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'founder-assets' and (storage.foldername(name))[1] = 'founders' and (storage.foldername(name))[2] = (select auth.uid())::text);

-- certificate-templates: <project_id>/<node_id>/v<version>.<ext>, PM only (founders get signed URLs through the render payload)
create policy certificate_templates_select_pm on storage.objects for select to authenticated
  using (bucket_id = 'certificate-templates' and (select app_private.storage_project_manager((storage.foldername(name))[1])));
create policy certificate_templates_insert_pm on storage.objects for insert to authenticated
  with check (bucket_id = 'certificate-templates' and (select app_private.storage_project_manager((storage.foldername(name))[1])));
create policy certificate_templates_update_pm on storage.objects for update to authenticated
  using (bucket_id = 'certificate-templates' and (select app_private.storage_project_manager((storage.foldername(name))[1])))
  with check (bucket_id = 'certificate-templates' and (select app_private.storage_project_manager((storage.foldername(name))[1])));
create policy certificate_templates_delete_pm on storage.objects for delete to authenticated
  using (bucket_id = 'certificate-templates' and (select app_private.storage_project_manager((storage.foldername(name))[1])));

-- resources: <project_id>/<node_id>/<uuid> (PM) and global/... (read: PM role holders, write: super_admin)
create policy resources_select_pm on storage.objects for select to authenticated
  using (bucket_id = 'resources' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.has_any_role(array['project_manager','super_admin'])))));
create policy resources_insert_pm on storage.objects for insert to authenticated
  with check (bucket_id = 'resources' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));
create policy resources_update_pm on storage.objects for update to authenticated
  using (bucket_id = 'resources' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))))
  with check (bucket_id = 'resources' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));
create policy resources_delete_pm on storage.objects for delete to authenticated
  using (bucket_id = 'resources' and ((select app_private.storage_project_manager((storage.foldername(name))[1]))
         or ((storage.foldername(name))[1] = 'global' and (select app_private.is_super_admin()))));

commit;
