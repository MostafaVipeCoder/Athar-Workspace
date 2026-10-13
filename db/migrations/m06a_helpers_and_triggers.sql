-- m06a_helpers_and_triggers  (05 phase 2 / m06; design 04 5.1, 6.5, 8.3; design 03 8.2, 4.4)
-- app_private helpers used by RLS policies and RPCs, trigger functions and the triggers themselves.
-- Conventions: SECURITY DEFINER where they read tables the caller may not see; SET search_path = ''; every object
-- schema-qualified; auth.uid() always in the "(select auth.uid())" initplan form; STABLE for policy helpers.
set search_path = public, extensions;

begin;

-- ================================================================= role / membership helpers (policies call these)
create or replace function app_private.has_role(r text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = (select auth.uid()) and ur.role_key = r)
$$;

create or replace function app_private.has_any_role(rs text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = (select auth.uid()) and ur.role_key = any (rs))
$$;

create or replace function app_private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = (select auth.uid()) and ur.role_key = 'super_admin')
$$;

create or replace function app_private.is_program_member(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and (
    app_private.is_super_admin()
    or exists (select 1 from public.program_members m where m.program_id = p and m.user_id = (select auth.uid())))
$$;

create or replace function app_private.is_program_owner(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and (
    app_private.is_super_admin()
    or exists (select 1 from public.program_members m where m.program_id = p and m.user_id = (select auth.uid()) and m.member_role = 'owner'))
$$;

-- program visible to: program members, guests of one of its projects, super_admin
create or replace function app_private.can_see_program(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and (
    app_private.is_program_member(p)
    or exists (select 1 from public.projects j join public.project_members m on m.project_id = j.id
               where j.program_id = p and m.user_id = (select auth.uid())))
$$;

-- project member OR member of the owning program OR super_admin  (03 3.2)
create or replace function app_private.is_project_manager(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and (
    app_private.is_super_admin()
    or exists (select 1 from public.project_members m where m.project_id = p and m.user_id = (select auth.uid()))
    or exists (select 1 from public.projects j join public.program_members pm on pm.program_id = j.program_id
               where j.id = p and pm.user_id = (select auth.uid())))
$$;

create or replace function app_private.is_project_owner(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and (
    app_private.is_super_admin()
    or exists (select 1 from public.project_members m where m.project_id = p and m.user_id = (select auth.uid()) and m.member_role = 'owner')
    or exists (select 1 from public.projects j join public.program_members pm on pm.program_id = j.program_id
               where j.id = p and pm.user_id = (select auth.uid()) and pm.member_role = 'owner'))
$$;

create or replace function app_private.my_founder_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select f.id from public.founders f where f.auth_user_id = (select auth.uid()) and f.deleted_at is null
$$;

create or replace function app_private.my_company_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select cf.company_id from public.company_founders cf
  join public.founders f on f.id = cf.founder_id
  where f.auth_user_id = (select auth.uid()) and f.deleted_at is null
$$;

-- participant of the project (status accepted/attended), directly (user_id) or through one of my companies
create or replace function app_private.is_participant(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and exists (
    select 1 from public.participants x
    where x.project_id = p and x.status in ('accepted','attended')
      and (x.user_id = (select auth.uid()) or x.company_id in (select app_private.my_company_ids())))
$$;

-- another user who shares a program/project with me (names/avatars of teammates)
create or replace function app_private.is_teammate(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u is not null and (
    app_private.is_super_admin()
    or exists (select 1 from public.program_members a join public.program_members b on b.program_id = a.program_id
               where a.user_id = (select auth.uid()) and b.user_id = u)
    or exists (select 1 from public.project_members a join public.project_members b on b.project_id = a.project_id
               where a.user_id = (select auth.uid()) and b.user_id = u)
    or exists (select 1 from public.program_members a join public.projects j on j.program_id = a.program_id
               join public.project_members b on b.project_id = j.id
               where a.user_id = (select auth.uid()) and b.user_id = u)
    or exists (select 1 from public.project_members a join public.projects j on j.id = a.project_id
               join public.program_members b on b.program_id = j.program_id
               where a.user_id = (select auth.uid()) and b.user_id = u))
$$;

-- a PM may read a company that is referenced by a list item, a participant row or the origin project of a project they manage
create or replace function app_private.pm_can_read_company(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select c is not null and (
    exists (select 1 from public.list_items li where li.company_id = c and app_private.is_project_manager(li.project_id))
    or exists (select 1 from public.participants pa where pa.company_id = c and app_private.is_project_manager(pa.project_id))
    or exists (select 1 from public.companies co where co.id = c and co.origin_project_id is not null
               and app_private.is_project_manager(co.origin_project_id)))
$$;

-- a PM may read founders linked to companies of their projects
create or replace function app_private.pm_can_read_founder(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select f is not null and exists (
    select 1 from public.company_founders cf where cf.founder_id = f and app_private.pm_can_read_company(cf.company_id))
$$;

create or replace function app_private.node_project(n uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select project_id from public.nodes where id = n
$$;

-- ================================================================= generators
create or replace function app_private.gen_slug() returns text
language plpgsql volatile set search_path = '' as $$
declare alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';   -- 32 symbols (no l, o)
        b bytea := extensions.gen_random_bytes(10); s text := ''; i int;
begin
  for i in 0..9 loop s := s || substr(alphabet, (get_byte(b, i) & 31) + 1, 1); end loop;
  return s;
end $$;

create or replace function app_private.gen_cert_code() returns text
language plpgsql volatile set search_path = '' as $$
declare alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   -- Crockford base32
        b bytea := extensions.gen_random_bytes(12); s text := ''; i int;
begin
  for i in 0..11 loop
    s := s || substr(alphabet, (get_byte(b, i) & 31) + 1, 1);
    if i in (3, 7) then s := s || '-'; end if;
  end loop;
  return s;
end $$;

-- ================================================================= generic trigger functions
create or replace function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create or replace function app_private.forbid_project_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'project_id is immutable on %.%', tg_table_schema, tg_table_name using errcode = '23514';
  end if;
  return new;
end $$;

-- ---- revision counters (04 6.5): statement-level, transition tables, counter only (moves no data)
-- tg_argv[0] = column holding the owner node id in the changed rows
create or replace function app_private.bump_node_revs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app_private.in_save_node', true), '') = '1' then return null; end if;
  execute format($q$
    insert into public.node_revisions (node_id, project_id)
    select n.id, n.project_id from public.nodes n
    where n.id in (select c.%1$I from changed c where c.%1$I is not null)
    on conflict (node_id) do update set rev = public.node_revisions.rev + 1, updated_at = now()
  $q$, coalesce(tg_argv[0], 'node_id'));
  return null;
end $$;

-- variant for leaf tables whose owner node is reached through a parent row:
-- tg_argv = (fk column in the changed rows, parent table in public, node column of the parent)
create or replace function app_private.bump_node_revs_via() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app_private.in_save_node', true), '') = '1' then return null; end if;
  execute format($q$
    insert into public.node_revisions (node_id, project_id)
    select n.id, n.project_id from public.nodes n
    where n.id in (select p.%3$I from public.%2$I p where p.id in (select c.%1$I from changed c where c.%1$I is not null))
    on conflict (node_id) do update set rev = public.node_revisions.rev + 1, updated_at = now()
  $q$, tg_argv[0], tg_argv[1], tg_argv[2]);
  return null;
end $$;

-- participants change what founders see on the project page: bump the project's view_host node(s)
create or replace function app_private.bump_project_host_revs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.node_revisions (node_id, project_id)
  select n.id, n.project_id from public.nodes n
  where n.type = 'view_host' and n.deleted_at is null
    and n.project_id in (select c.project_id from changed c)
  on conflict (node_id) do update set rev = public.node_revisions.rev + 1, updated_at = now();
  return null;
end $$;

-- attach the revision triggers (3 statement triggers per table: insert / update / delete)
do $$
declare
  r record;
  ev text; refclause text; trgname text; fn text;
begin
  for r in select * from (values
      -- table, kind, args...
      ('list_items',            'direct', 'list_node_id', null, null),
      ('forms',                 'direct', 'node_id', null, null),
      ('lists',                 'direct', 'node_id', null, null),
      ('distributions',         'direct', 'node_id', null, null),
      ('booking_settings',      'direct', 'node_id', null, null),
      ('form_responses',        'direct', 'node_id', null, null),
      ('form_sections',         'direct', 'node_id', null, null),
      ('form_questions',        'direct', 'node_id', null, null),
      ('agenda_days',           'direct', 'node_id', null, null),
      ('agenda_slots',          'via',    'day_id',  'agenda_days', 'node_id'),
      ('distribution_days',     'direct', 'node_id', null, null),
      ('distribution_day_mentors','via',  'day_id',  'distribution_days', 'node_id'),
      ('distribution_mentor_rules','direct','node_id', null, null),
      ('distribution_sessions', 'direct', 'node_id', null, null),
      ('landing_cards',         'direct', 'node_id', null, null),
      ('landing_frames',        'direct', 'node_id', null, null),
      ('landing_share_presets', 'via',    'card_id', 'landing_cards', 'node_id'),
      ('resources',             'direct', 'node_id', null, null),
      ('library_selections',    'direct', 'node_id', null, null),
      ('booking_providers',     'direct', 'node_id', null, null),
      ('booking_slots',         'direct', 'node_id', null, null),
      ('bookings',              'direct', 'node_id', null, null),
      ('selection_reviews',     'via',    'item_id', 'list_items', 'list_node_id'),
      ('edges',                 'direct', 'to_node_id', null, null),
      ('participants',          'host',   null, null, null)
    ) as t(tbl, kind, c1, c2, c3)
  loop
    foreach ev in array array['insert','update','delete'] loop
      refclause := case ev when 'insert' then 'new table as changed'
                           when 'update' then 'new table as changed'
                           else 'old table as changed' end;
      trgname := r.tbl || '_rev_' || left(ev, 3);
      execute format('drop trigger if exists %I on public.%I', trgname, r.tbl);
      fn := case r.kind
              when 'direct' then format('app_private.bump_node_revs(%L)', r.c1)
              when 'via'    then format('app_private.bump_node_revs_via(%L,%L,%L)', r.c1, r.c2, r.c3)
              else 'app_private.bump_project_host_revs()' end;
      execute format('create trigger %I after %s on public.%I referencing %s for each statement execute function %s',
                     trgname, ev, r.tbl, refclause, fn);
    end loop;
  end loop;
end $$;

-- ================================================================= nodes: revision row, own-rev bump, soft-delete semantics
create or replace function app_private.nodes_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.node_revisions (node_id, project_id) values (new.id, new.project_id)
  on conflict (node_id) do nothing;
  return null;
end $$;

-- bumps the node's own revision on a direct edit; position-only moves do NOT bump (04 3.4).
-- save_node() sets app_private.in_save_node = '1' and bumps exactly once itself.
create or replace function app_private.nodes_bump_own_rev() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app_private.in_save_node', true), '') = '1' then return null; end if;
  update public.node_revisions set rev = rev + 1, updated_at = now() where node_id = new.id;
  return null;
end $$;

drop trigger if exists nodes_ai_revision on public.nodes;
create trigger nodes_ai_revision after insert on public.nodes
  for each row execute function app_private.nodes_after_insert();
drop trigger if exists nodes_au_bump on public.nodes;
create trigger nodes_au_bump after update on public.nodes
  for each row when (old.name_en is distinct from new.name_en or old.name_ar is distinct from new.name_ar
                  or old.config is distinct from new.config or old.visibility is distinct from new.visibility
                  or old.show_to_participants is distinct from new.show_to_participants
                  or old.type_version is distinct from new.type_version or old.deleted_at is distinct from new.deleted_at)
  execute function app_private.nodes_bump_own_rev();

-- node type and project are immutable (an extension table pins the type; links/edges pin the project)
create or replace function app_private.nodes_forbid_retype() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.type is distinct from old.type then raise exception 'node type is immutable' using errcode = '23514'; end if;
  if new.project_id is distinct from old.project_id then raise exception 'project_id is immutable' using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists nodes_bu_forbid on public.nodes;
create trigger nodes_bu_forbid before update on public.nodes
  for each row execute function app_private.nodes_forbid_retype();

-- ================================================================= edges: validation (ports, family, kind, cardinality, DAG per family)
create or replace function app_private.edge_has_cycle(p_edge_id uuid, p_from uuid, p_to uuid, p_family text) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive walk(n) as (
    select p_to
    union
    select e.to_node_id from public.edges e join walk w on e.from_node_id = w.n
    where e.family = p_family and e.id is distinct from p_edge_id
  )
  select exists (select 1 from walk where n = p_from)
$$;

create or replace function app_private.validate_edge() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_from public.nodes; v_to public.nodes;
  v_fp jsonb; v_tp jsonb; v_fam text; v_fkind text; v_tkind text;
begin
  if tg_op = 'UPDATE' and new.from_node_id = old.from_node_id and new.to_node_id = old.to_node_id
     and new.from_port = old.from_port and new.to_port = old.to_port and new.family = old.family then
    return new;
  end if;
  select * into v_from from public.nodes where id = new.from_node_id and project_id = new.project_id and deleted_at is null;
  if not found then raise exception 'edge: source node not found in this project' using errcode = '23503'; end if;
  select * into v_to from public.nodes where id = new.to_node_id and project_id = new.project_id and deleted_at is null;
  if not found then raise exception 'edge: target node not found in this project' using errcode = '23503'; end if;

  select p into v_fp from public.node_types nt, jsonb_array_elements(nt.ports) p
    where nt.key = v_from.type and p->>'key' = new.from_port and p->>'direction' = 'out';
  if v_fp is null then raise exception 'edge: % has no output port %', v_from.type, new.from_port using errcode = '23514'; end if;
  select p into v_tp from public.node_types nt, jsonb_array_elements(nt.ports) p
    where nt.key = v_to.type and p->>'key' = new.to_port and p->>'direction' = 'in';
  if v_tp is null then raise exception 'edge: % has no input port %', v_to.type, new.to_port using errcode = '23514'; end if;

  v_fam := v_fp->'families'->>0;
  if not (v_tp->'families') ? v_fam then
    raise exception 'edge: port family % is not accepted by %.%', v_fam, v_to.type, new.to_port using errcode = '23514';
  end if;
  if new.family is distinct from v_fam then
    raise exception 'edge: family must be % for this port pair', v_fam using errcode = '23514';
  end if;

  -- list-item kind compatibility (subkind of the source list vs kind required by the target port)
  if v_fam = 'rows:list-item' then
    v_fkind := case when v_fp->>'kind' = 'subkind'
                    then (select l.subkind from public.lists l where l.node_id = v_from.id)
                    else v_fp->>'kind' end;
    v_tkind := v_tp->>'kind';
    if v_tkind is not null and v_fkind is not null and v_fkind <> 'generic' and v_fkind <> v_tkind then
      raise exception 'edge: list kind % does not fit port kind %', v_fkind, v_tkind using errcode = '23514';
    end if;
  end if;

  if v_tp->>'cardinality' = 'one' and exists (
       select 1 from public.edges e where e.to_node_id = new.to_node_id and e.to_port = new.to_port
         and e.id is distinct from new.id) then
    raise exception 'edge: input port %.% accepts a single connection', v_to.type, new.to_port using errcode = '23514';
  end if;

  if app_private.edge_has_cycle(new.id, new.from_node_id, new.to_node_id, new.family) then
    raise exception 'edge: would create a cycle in family %', new.family using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists edges_biu_validate on public.edges;
create trigger edges_biu_validate before insert or update on public.edges
  for each row execute function app_private.validate_edge();

-- deferred re-check (two edges added in one transaction can still close a loop)
create or replace function app_private.edges_recheck_cycle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.edges e where e.id = new.id)
     and app_private.edge_has_cycle(new.id, new.from_node_id, new.to_node_id, new.family) then
    raise exception 'edge: cycle detected in family %', new.family using errcode = '23514';
  end if;
  return null;
end $$;
drop trigger if exists edges_ciu_cycle on public.edges;
create constraint trigger edges_ciu_cycle after insert or update on public.edges
  deferrable initially deferred for each row execute function app_private.edges_recheck_cycle();

-- ================================================================= lists / list_items integrity
create or replace function app_private.lists_forbid_subkind_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.subkind is distinct from old.subkind then raise exception 'list subkind is immutable' using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists lists_bu_subkind on public.lists;
create trigger lists_bu_subkind before update on public.lists
  for each row execute function app_private.lists_forbid_subkind_change();

create or replace function app_private.list_items_check_node() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.nodes n where n.id = new.list_node_id and n.type in ('list','selection')) then
    raise exception 'list_items.list_node_id must be a list or selection node' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists list_items_biu_node on public.list_items;
create trigger list_items_biu_node before insert or update of list_node_id on public.list_items
  for each row execute function app_private.list_items_check_node();

-- ================================================================= tombstones (04 1.3): label of a hard-deleted source
create or replace function app_private.tombstone_form_response() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.list_items set source_label = coalesce(
      nullif(old.answers->>'company_name',''), nullif(old.answers->>'founder_name',''), left(old.id::text, 8))
  where form_response_id = old.id;
  return old;
end $$;
create or replace function app_private.tombstone_network_expert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.list_items set source_label = coalesce(old.name_en, old.name_ar) where network_expert_id = old.id;
  return old;
end $$;
create or replace function app_private.tombstone_company() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.list_items set source_label = coalesce(old.name_en, old.name_ar) where company_id = old.id;
  return old;
end $$;
drop trigger if exists form_responses_bd_tombstone on public.form_responses;
create trigger form_responses_bd_tombstone before delete on public.form_responses
  for each row execute function app_private.tombstone_form_response();
drop trigger if exists network_experts_bd_tombstone on public.network_experts;
create trigger network_experts_bd_tombstone before delete on public.network_experts
  for each row execute function app_private.tombstone_network_expert();
drop trigger if exists companies_bd_tombstone on public.companies;
create trigger companies_bd_tombstone before delete on public.companies
  for each row execute function app_private.tombstone_company();

-- ================================================================= programs / projects
create or replace function app_private.validate_project_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'unknown IANA timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists projects_biu_timezone on public.projects;
create trigger projects_biu_timezone before insert or update of timezone on public.projects
  for each row execute function app_private.validate_project_timezone();

-- the creator becomes owner (only when the caller is the creator, i.e. not for migration loaders)
create or replace function app_private.programs_add_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and new.created_by = (select auth.uid()) then
    insert into public.program_members (program_id, user_id, member_role, added_by)
    values (new.id, new.created_by, 'owner', new.created_by) on conflict do nothing;
  end if;
  return null;
end $$;
create or replace function app_private.projects_add_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and new.created_by = (select auth.uid()) then
    insert into public.project_members (project_id, user_id, member_role, added_by)
    values (new.id, new.created_by, 'owner', new.created_by) on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists programs_ai_owner on public.programs;
create trigger programs_ai_owner after insert on public.programs for each row execute function app_private.programs_add_owner();
drop trigger if exists projects_ai_owner on public.projects;
create trigger projects_ai_owner after insert on public.projects for each row execute function app_private.projects_add_owner();

-- ================================================================= user_roles guard rails (03 2.2)
create or replace function app_private.user_roles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app_private.allow_role_admin', true), '') = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op in ('UPDATE','DELETE') and old.role_key = 'super_admin'
     and (tg_op = 'DELETE' or new.role_key <> 'super_admin' or new.user_id <> old.user_id)
     and not exists (select 1 from public.user_roles r
                     where r.role_key = 'super_admin' and r.user_id <> old.user_id) then
    raise exception 'cannot remove the last super_admin' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists user_roles_bud_guard on public.user_roles;
create trigger user_roles_bud_guard before update or delete on public.user_roles
  for each row execute function app_private.user_roles_guard();

-- ================================================================= participants: status audit
create or replace function app_private.participants_status_audit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := coalesce((select auth.uid()), new.status_changed_by);
  end if;
  return new;
end $$;
drop trigger if exists participants_biu_status on public.participants;
create trigger participants_biu_status before insert or update on public.participants
  for each row execute function app_private.participants_status_audit();

-- ================================================================= certificate templates: immutable once referenced (04 3.13)
create or replace function app_private.cert_template_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tpl uuid;
begin
  if tg_table_name = 'certificate_templates' then
    v_tpl := case when tg_op = 'INSERT' then new.id else old.id end;
  else
    v_tpl := case when tg_op = 'DELETE' then old.template_id else new.template_id end;
  end if;
  if exists (select 1 from public.certificates c where c.template_id = v_tpl) then
    raise exception 'certificate template is referenced by issued certificates and is immutable; create a new version'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists certificate_templates_bud_immutable on public.certificate_templates;
create trigger certificate_templates_bud_immutable before update or delete on public.certificate_templates
  for each row execute function app_private.cert_template_immutable();
drop trigger if exists certificate_template_fields_biud_immutable on public.certificate_template_fields;
create trigger certificate_template_fields_biud_immutable before insert or update or delete on public.certificate_template_fields
  for each row execute function app_private.cert_template_immutable();

-- ================================================================= updated_at on every table that has the column
do $$
declare r record;
begin
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format('drop trigger if exists %I on public.%I', r.table_name || '_bu_touch', r.table_name);
    execute format('create trigger %I before update on public.%I for each row execute function app_private.touch_updated_at()',
                   r.table_name || '_bu_touch', r.table_name);
  end loop;
  -- integration_jobs lives in app_private
  drop trigger if exists integration_jobs_bu_touch on app_private.integration_jobs;
  create trigger integration_jobs_bu_touch before update on app_private.integration_jobs
    for each row execute function app_private.touch_updated_at();
end $$;

-- ================================================================= project_id immutability on every table that has it (not a PK)
do $$
declare r record;
begin
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'project_id'
  loop
    execute format('drop trigger if exists %I on public.%I', r.table_name || '_bu_project', r.table_name);
    execute format('create trigger %I before update of project_id on public.%I for each row execute function app_private.forbid_project_change()',
                   r.table_name || '_bu_project', r.table_name);
  end loop;
end $$;

-- ================================================================= handle_new_user (03 4.4)
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_provisioned boolean;
  v_token text;
  v_inv public.alumni_invitations;
  v_founder uuid;
begin
  v_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'User');
  insert into public.profiles (id, full_name) values (new.id, v_name) on conflict (id) do nothing;

  -- staff accounts are created by the admin API with app_metadata.provisioned = true: no automatic role
  v_provisioned := coalesce((new.raw_app_meta_data->>'provisioned')::boolean, false);
  if v_provisioned then return new; end if;

  -- self signup: the role is ALWAYS the literal 'founder' (never read from user_metadata)
  begin
    insert into public.user_roles (user_id, role_key) values (new.id, 'founder') on conflict do nothing;
    insert into public.founders (name_ar, name_en, email, auth_user_id)
      values (v_name, v_name, new.email, new.id)
      returning id into v_founder;
  exception when others then
    -- never block signup (e.g. an unlinked founders row with the same e-mail exists: no automatic linking by e-mail)
    begin
      insert into public.user_roles (user_id, role_key) values (new.id, 'founder') on conflict do nothing;
    exception when others then null; end;
  end;

  -- optional invitation: token hash, pending, <= 14 days, same e-mail, single use (row lock)
  v_token := new.raw_user_meta_data->>'invitation_token';
  if v_token is not null and v_founder is not null then
    begin
      select * into v_inv from public.alumni_invitations i
       where i.token = encode(extensions.digest(v_token, 'sha256'), 'hex')
         and i.status = 'pending'
         and i.sent_at + interval '14 days' > now()
         and lower(i.founder_email) = lower(coalesce(new.email, ''))
       for update;
      if found then
        insert into public.company_founders (company_id, founder_id, role, is_primary)
          values (v_inv.company_id, v_founder, 'founder', false) on conflict do nothing;
        update public.alumni_invitations set status = 'accepted', accepted_at = now(), founder_id = v_founder where id = v_inv.id;
      end if;
    exception when others then null; end;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

commit;
