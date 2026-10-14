-- v10_post_load_structure  (STAGE 2a)  = v02_structure with the 'target tables empty' check replaced by V10.4 (target tables hold exactly the loaded data).
-- v02 itself is untouched (it remains the stage-1 clean-slate check). Results go to migration.recon (phase 'stage2a-verify-v10'). Read-only.
\set ON_ERROR_STOP on
set search_path = public, extensions;
begin;
insert into migration.run (phase, status, note) values ('stage2a-verify-v10', 'running', 'target structure + security') returning id as run_id \gset
create temp table chk (key text primary key, expected text, actual text, status text);

-- V02.1 every FK column indexed, no duplicate / redundant index (04 6.2, R5)
-- Coverage rule: some valid index whose leading columns are exactly the FK columns (as a set), or whose columns are ALL inside the FK
-- column set and unique (a unique prefix already identifies the row: e.g. forms(node_id) for the pinned FK (node_id, node_type)).
-- project_id inside a composite (project_id, x) key is structural and functionally determined by x, so the lookup index must lead with x.
-- FKs to auth.users on pure audit columns (created_by, *_by) are reported as 'warn' (indexing them costs writes on tiny tables).
create temp view fkcov as
select c.oid as conoid, cl.relname as tbl, c.conname, c.confrelid,
       (select string_agg(a.attname, ',') from unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
       exists (
         select 1 from pg_index i
         where i.indrelid = c.conrelid and i.indisvalid and (
           ((i.indkey::int2[])[0:cardinality(e.eff) - 1] @> e.eff and e.eff @> (i.indkey::int2[])[0:cardinality(e.eff) - 1])
           or (i.indisunique and i.indpred is null and (i.indkey::int2[]) <@ e.eff))) as indexed
from pg_constraint c
join pg_class cl on cl.oid = c.conrelid
cross join lateral (
  select array_agg(k.attnum::int2 order by k.ord) as eff from unnest(c.conkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where cardinality(c.conkey) = 1 or a.attname <> 'project_id') e
where c.contype = 'f' and cl.relnamespace in ('public'::regnamespace, 'app_private'::regnamespace);

insert into chk
select 'V02.1a FK columns without a leading index (excl. audit FKs)', '0',
       (select count(*) from fkcov where not indexed and not (confrelid = 'auth.users'::regclass and cols ~ '(^|,)(created_by|granted_by|added_by|status_changed_by|reviewed_by|revoked_by|issued_by|cancelled_by|completed_by|sent_by|updated_by|accepted_by|invited_by|withdrawn_by|reviewer_id)$'))::text,
       case when (select count(*) from fkcov where not indexed and not (confrelid = 'auth.users'::regclass and cols ~ '(^|,)(created_by|granted_by|added_by|status_changed_by|reviewed_by|revoked_by|issued_by|cancelled_by|completed_by|sent_by|updated_by|accepted_by|invited_by|withdrawn_by|reviewer_id)$')) = 0 then 'ok' else 'mismatch' end
union all
select 'V02.1b audit FKs to auth.users without index (info)', '0',
       (select count(*) from fkcov where not indexed and (confrelid = 'auth.users'::regclass and cols ~ '(^|,)(created_by|granted_by|added_by|status_changed_by|reviewed_by|revoked_by|issued_by|cancelled_by|completed_by|sent_by|updated_by|accepted_by|invited_by|withdrawn_by|reviewer_id)$'))::text, 'warn';
do $$
declare r record;
begin
  for r in select tbl, conname, cols from fkcov where not indexed
             and not (confrelid = 'auth.users'::regclass and cols ~ '(^|,)(created_by|granted_by|added_by|status_changed_by|reviewed_by|revoked_by|issued_by|cancelled_by|completed_by|sent_by)$')
  loop raise notice 'unindexed FK: %.% (%)', r.tbl, r.conname, r.cols; end loop;
end $$;

-- duplicate (identical) indexes and redundant prefix indexes
with idx as (
  select i.indexrelid, i.indrelid, i.indkey::int2[] as cols, i.indisunique, i.indpred is not null as partial, i.indexprs is not null as expr,
         i.indclass::text as opcls, coalesce(pg_get_expr(i.indpred, i.indrelid), '') as pred, ic.relname as idxname, tc.relname as tbl
  from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class tc on tc.oid = i.indrelid
  where tc.relnamespace in ('public'::regnamespace, 'app_private'::regnamespace) and i.indisvalid
), dup as (
  select a.tbl, a.idxname as a_idx, b.idxname as b_idx from idx a join idx b
    on a.indrelid = b.indrelid and a.indexrelid < b.indexrelid and a.cols = b.cols and a.opcls = b.opcls and a.pred = b.pred and not a.expr
), redundant as (
  select a.tbl, a.idxname as a_idx, b.idxname as b_idx from idx a join idx b
    on a.indrelid = b.indrelid and a.indexrelid <> b.indexrelid and not a.indisunique and not a.partial and not b.partial
   and not a.expr and not b.expr and cardinality(a.cols) < cardinality(b.cols)
   and b.cols[0:cardinality(a.cols) - 1] = a.cols
)
insert into chk
select 'V02.1c duplicate indexes', '0', (select count(*) from dup)::text, case when (select count(*) from dup) = 0 then 'ok' else 'mismatch' end
union all
select 'V02.1d redundant prefix indexes', '0', (select count(*) from redundant)::text, case when (select count(*) from redundant) = 0 then 'ok' else 'mismatch' end;
do $$
declare r record;
begin
  for r in
    with idx as (select i.indexrelid, i.indrelid, i.indkey::int2[] as cols, i.indisunique, i.indpred is not null as partial, i.indexprs is not null as expr, ic.relname as n, tc.relname as t
                 from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class tc on tc.oid = i.indrelid
                 where tc.relnamespace in ('public'::regnamespace,'app_private'::regnamespace) and i.indisvalid)
    select a.t, a.n as a_idx, b.n as b_idx from idx a join idx b on a.indrelid = b.indrelid and a.indexrelid <> b.indexrelid
     and not a.indisunique and not a.partial and not b.partial and not a.expr and not b.expr
     and cardinality(a.cols) < cardinality(b.cols) and b.cols[0:cardinality(a.cols) - 1] = a.cols
  loop raise notice 'redundant index: %.% covered by %', r.t, r.a_idx, r.b_idx; end loop;
end $$;

-- ---------------------------------------------------------------- V02.2 RLS enabled (and forced) on every table of public and app_private
insert into chk select 'V02.2a tables without RLS (public + app_private)', '0',
  (select count(*) from pg_class c where c.relkind in ('r','p') and c.relnamespace in ('public'::regnamespace,'app_private'::regnamespace) and not c.relrowsecurity)::text,
  case when (select count(*) from pg_class c where c.relkind in ('r','p') and c.relnamespace in ('public'::regnamespace,'app_private'::regnamespace) and not c.relrowsecurity) = 0 then 'ok' else 'mismatch' end;
insert into chk select 'V02.2b tables without FORCE RLS', '0',
  (select count(*) from pg_class c where c.relkind in ('r','p') and c.relnamespace in ('public'::regnamespace,'app_private'::regnamespace) and not c.relforcerowsecurity)::text,
  case when (select count(*) from pg_class c where c.relkind in ('r','p') and c.relnamespace in ('public'::regnamespace,'app_private'::regnamespace) and not c.relforcerowsecurity) = 0 then 'ok' else 'mismatch' end;

-- ---------------------------------------------------------------- V02.3 node_types has the 10 keys
insert into chk select 'V02.3 node_types keys', 'agenda,booking,certificates,distribution,form_builder,landing_page,library,list,selection,view_host',
  (select string_agg(key, ',' order by key) from public.node_types),
  case when (select string_agg(key, ',' order by key) from public.node_types) = 'agenda,booking,certificates,distribution,form_builder,landing_page,library,list,selection,view_host' then 'ok' else 'mismatch' end;
insert into chk select 'V02.3b field_semantics seeded', '6', count(*)::text, case when count(*) = 6 then 'ok' else 'mismatch' end from public.field_semantics;

-- ---------------------------------------------------------------- V10.4 (replaces v02's "target tables empty"): the target tables hold the loaded business data
-- Every target table is compared with the number the stage-2a load must produce (05 6.2, adjusted for the 20 company merges);
-- tables that must stay empty (nothing to load / worker tables) are asserted to be empty.
do $$
declare r record; n bigint; bad text := ''; tot int := 0; want bigint; v_m90 timestamptz := (select max(finished_at) from migration.run where phase = 'm90_finalize_stage2a'); v_has_created boolean;
  exp jsonb := jsonb_build_object(
    'agenda_days',37,'agenda_slots',248,'booking_providers',6,'booking_settings',6,'booking_slots',55,'bookings',30,'companies',141,
    'distribution_day_mentors',139,'distribution_days',9,'distribution_mentor_rules',3,'distribution_sessions',716,'distributions',2,'edges',53,
    'form_covers',5,'form_questions',204,'form_responses',384,'form_sections',6,'form_templates',1,'forms',12,'landing_cards',4,'list_items',612,'lists',20,
    'network_experts',44,'node_events',26,'node_revisions',82,'nodes',82,'profiles',12,'programs',4,'projects',16,'public_link_slugs',33,'public_links',33,
    'resources',26,'selection_reviews',201,'user_roles',12,'roles',5,'node_types',10,'field_semantics',6,
    'program_members',44,'founders',3);                          -- (m23 initial memberships, 08 section 14; the three migrated founder accounts)
begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('public','app_private') order by 1, 2 loop
    execute format('select count(*) from %I.%I', r.schemaname, r.tablename) into n;
    tot := tot + 1;
    if r.tablename in ('form_rate_limits', 'certificate_verify_limits', 'image_conversions', 'alumni_probe_limits', 'alumni_lookups') then continue; end if;      -- transient anti-abuse counters, the m45 image-conversion audit and the m49 vocabulary seed / probe limiter: not business data
    want := coalesce((exp ->> r.tablename)::bigint, 0);          -- not listed = no row from the migration
    -- (m52) HERMETIC: rows added by later builds and by real use are legitimate. A migrated table must not LOSE a loaded row (n >= want); a table the migration does not fill
    -- must hold no row that predates the end of the load (where it has a created_at; a table without one cannot be dated and is tolerated).
    if want > 0 then
      if n < want then bad := bad || r.schemaname || '.' || r.tablename || '=' || n || '(want >= ' || want || ') '; end if;
    else
      select exists (select 1 from information_schema.columns c where c.table_schema = r.schemaname and c.table_name = r.tablename and c.column_name = 'created_at') into v_has_created;
      if v_has_created then
        execute format('select count(*) from %I.%I where created_at <= %L', r.schemaname, r.tablename, v_m90) into n;
        if n <> 0 then bad := bad || r.schemaname || '.' || r.tablename || '=' || n || ' rows before the load ended (want 0) '; end if;
      end if;
    end if;
  end loop;
  insert into chk values ('V10.4 target tables hold the loaded data (none lost) and no row of a table the migration does not fill predates the load (' || tot || ' checked)', 'none', coalesce(nullif(bad, ''), 'none'), case when bad = '' then 'ok' else 'mismatch' end);
end $$;

-- ---------------------------------------------------------------- census vs the design (04 section 4.2 / 5)
do $$
declare
  want_pub text[] := array['agenda_days','agenda_slots','alumni_invitations','booking_invitations','booking_providers','booking_settings','booking_slots','bookings',
    'certificate_template_fields','certificate_templates','certificates','companies','company_founders','company_snapshots','distribution_day_mentors',
    'distribution_days','distribution_mentor_rules','distribution_sessions','distributions','edges','field_semantics','form_covers','form_questions','form_responses',
    'form_sections','form_templates','forms','founders','investor_requests','landing_cards','landing_frames','landing_share_presets','library_selections','list_items',
    'lists','network_experts','node_events','node_revisions','node_types','nodes','notifications','opportunities','opportunity_applications','participants','profiles',
    'program_members','programs','project_members','projects','public_link_slugs','public_links','resources','roles','selection_reviews','user_roles'];
  want_priv text[] := array['email_log','email_outbox','google_connections','integration_jobs'];
  have_pub text[]; have_priv text[]; miss text; extra text;
  want_fn text[] := array['create_program','create_project','add_member','get_project_graph','get_node','get_graph_revisions','add_node','save_node','move_nodes',
    'delete_node','restore_node','connect','update_edge','disconnect','ensure_item','ensure_items','resolve_list','patch_item_overlay','set_item_status','reorder_items',
    'exclude_item','add_manual_item','add_network_pick','add_company_pick','detach_item_to_manual','merge_companies','network_expert_usage','list_participants',
    'enroll_accepted','assign_participant','set_participant_status','mark_all_attended','request_withdrawal','complete_project','reopen_project','complete_all_projects',
    'get_my_programs','get_founder_program_page','my_meetings','resolve_ref','ensure_public_link','set_public_slug','rotate_public_link','get_agenda_view','get_public_tab',
    'get_public_form','submit_form_response','track_node_event','get_public_booking_page','create_booking','cancel_booking','create_invitations','issue_certificate',
    'issue_certificates_bulk','revoke_certificate','get_certificate_render_payload','verify_certificate','enqueue_email','claim_email_batch','complete_email','fail_email',
    'claim_integration_jobs','complete_job','fail_job','poller_claim_bookings','poller_complete_booking','poller_fail_booking','validate_invitation','accept_invitation',
    'purge_soft_deleted','prune_email_bodies','report_orphan_assets'];
  have_fn text[];
  want_priv_fn text[] := array['has_role','has_any_role','is_super_admin','is_program_member','is_project_manager','is_project_owner','is_participant','my_company_ids',
    'touch_updated_at','bump_node_revs','gen_slug','gen_cert_code','validate_edge','save_children_agenda','save_children_form_builder','save_children_landing_page',
    'handle_new_user'];
  have_priv_fn text[];
  want_views text[] := array['v_programs','v_network_expert_programs','v_network_expert_usage','v_company_programs','v_company_usage','v_program_participations',
    'v_distribution_sessions','v_booking_slots_open','v_node_event_counts','my_google_connection'];
  have_views text[];
begin
  select array_agg(tablename order by tablename) into have_pub from pg_tables where schemaname = 'public';
  select array_agg(tablename order by tablename) into have_priv from pg_tables where schemaname = 'app_private';
  select string_agg(x, ',') into miss from unnest(want_pub) x where x <> all (have_pub);
  select string_agg(x, ',') into extra from unnest(have_pub) x where x <> all (want_pub);
  -- the 55 designed tables must all exist; the node builds (m24+) added more, which are listed (a build never removes a designed table)
  insert into chk values ('CENSUS public tables: the 55 designed tables are all present', 'none missing',
     coalesce(miss, 'none missing') || ' / total ' || cardinality(have_pub) || ' / added since the design: ' || coalesce(extra, 'none'),
     case when miss is null then 'ok' else 'mismatch' end);
  select string_agg(x, ',') into miss from unnest(want_priv) x where x <> all (have_priv);
  insert into chk values ('CENSUS app_private tables >= 4 (the designed ones; later builds add worker tables)', '>= 4', cardinality(have_priv)::text, case when cardinality(have_priv) >= 4 and miss is null then 'ok' else 'mismatch' end);
  insert into chk values ('CENSUS total tables >= 59 (04 4.2)', '>= 59', (cardinality(have_pub) + cardinality(have_priv))::text,
     case when cardinality(have_pub) + cardinality(have_priv) >= 59 then 'ok' else 'mismatch' end);

  select array_agg(distinct proname::text) into have_fn from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f';
  select string_agg(x, ',') into miss from unnest(want_fn) x where x <> all (have_fn);
  select string_agg(x, ',') into extra from unnest(have_fn) x where x <> all (want_fn);
  insert into chk values ('CENSUS public RPCs (' || cardinality(want_fn) || ' designed)', cardinality(want_fn) || ' / none missing',
     cardinality(have_fn) || ' / ' || coalesce(miss, 'none missing') || ' / extra: ' || coalesce(extra, 'none'),
     case when miss is null and extra is null then 'ok' when miss is null then 'warn' else 'mismatch' end);

  select array_agg(distinct proname::text) into have_priv_fn from pg_proc where pronamespace = 'app_private'::regnamespace;
  select string_agg(x, ',') into miss from unnest(want_priv_fn) x where x <> all (have_priv_fn);
  insert into chk values ('CENSUS app_private functions (design 5.1 present)', 'none missing', coalesce(miss, 'none missing') || ' / total ' || cardinality(have_priv_fn),
     case when miss is null then 'ok' else 'mismatch' end);

  select array_agg(c.relname::text) into have_views from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v';
  select string_agg(x, ',') into miss from unnest(want_views) x where x <> all (coalesce(have_views, '{}'));
  insert into chk values ('CENSUS views (04 3.17)', cardinality(want_views)::text, cardinality(have_views)::text || ' / ' || coalesce('missing ' || miss, 'none missing'),
     case when miss is null and cardinality(have_views) = cardinality(want_views) then 'ok' else 'mismatch' end);
end $$;

insert into chk values ('CENSUS policies (info)', '-', (select count(*) from pg_policies where schemaname = 'public')::text || ' public / '
   || (select count(*) from pg_policies where schemaname = 'storage')::text || ' storage', 'warn');
insert into chk values ('CENSUS triggers on public tables (info)', '-', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal)::text, 'warn');

-- ---------------------------------------------------------------- security assertions
-- no policy with USING true (or WITH CHECK true) remains in public
insert into chk select 'SEC.1 public policies with USING/CHECK true', '0',
  (select count(*) from pg_policies where schemaname = 'public' and (lower(btrim(coalesce(qual, ''))) in ('true','(true)') or lower(btrim(coalesce(with_check, ''))) in ('true','(true)')))::text,
  case when (select count(*) from pg_policies where schemaname = 'public' and (lower(btrim(coalesce(qual, ''))) in ('true','(true)') or lower(btrim(coalesce(with_check, ''))) in ('true','(true)'))) = 0 then 'ok' else 'mismatch' end;
-- every policy is TO authenticated only, per command (no ALL, no PUBLIC)
insert into chk select 'SEC.2 public policies not TO authenticated / FOR ALL', '0',
  (select count(*) from pg_policies where schemaname = 'public' and (roles <> '{authenticated}' or cmd = 'ALL'))::text,
  case when (select count(*) from pg_policies where schemaname = 'public' and (roles <> '{authenticated}' or cmd = 'ALL')) = 0 then 'ok' else 'mismatch' end;
-- anon has no privilege on any relation or column of our schemas
insert into chk select 'SEC.3 anon table/sequence privileges in public/app_private/migration/legacy', '0',
  (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a
    where a.grantee = (select oid from pg_roles where rolname = 'anon') and c.relnamespace in ('public'::regnamespace,'app_private'::regnamespace,'migration'::regnamespace,'legacy'::regnamespace))::text
  , case when (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a
    where a.grantee = (select oid from pg_roles where rolname = 'anon') and c.relnamespace in ('public'::regnamespace,'app_private'::regnamespace,'migration'::regnamespace,'legacy'::regnamespace)) = 0 then 'ok' else 'mismatch' end;
insert into chk select 'SEC.3b anon column-level privileges', '0',
  (select count(*) from pg_attribute at join pg_class c on c.oid = at.attrelid cross join lateral aclexplode(at.attacl) a
    where at.attacl is not null and a.grantee = (select oid from pg_roles where rolname = 'anon') and c.relnamespace = 'public'::regnamespace)::text,
  case when (select count(*) from pg_attribute at join pg_class c on c.oid = at.attrelid cross join lateral aclexplode(at.attacl) a
    where at.attacl is not null and a.grantee = (select oid from pg_roles where rolname = 'anon') and c.relnamespace = 'public'::regnamespace) = 0 then 'ok' else 'mismatch' end;
-- authenticated: nothing on app_private / migration tables
insert into chk select 'SEC.4 authenticated privileges on app_private/migration tables', '0',
  (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a
    where a.grantee = (select oid from pg_roles where rolname = 'authenticated') and c.relnamespace in ('app_private'::regnamespace,'migration'::regnamespace) and c.relkind in ('r','p','v','S'))::text,
  case when (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a
    where a.grantee = (select oid from pg_roles where rolname = 'authenticated') and c.relnamespace in ('app_private'::regnamespace,'migration'::regnamespace) and c.relkind in ('r','p','v','S')) = 0 then 'ok' else 'mismatch' end;
-- the only EXECUTE grants anon has are the exhaustive RPC list of 04 5.9 (PUBLIC execute revoked everywhere)
insert into chk select 'SEC.5 functions anon may execute (04 5.9)',
  'cancel_booking,cert_template_readable,create_booking,form_upload_allowed,get_agenda_view,get_distribution_timer,get_distribution_view,get_public_booking_page,get_public_certificate_verification,get_public_form,get_public_landing,get_public_library,get_public_list,get_public_tab,library_file_readable,list_alumni_lookups,list_public_alumni_directory,resolve_ref,submit_public_form,track_landing_event,track_node_event,validate_invitation,validate_staff_invitation,verify_certificate',
  coalesce((select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace, 'migration'::regnamespace) and has_function_privilege('anon', p.oid, 'EXECUTE')), 'none'),
  case when coalesce((select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace, 'migration'::regnamespace) and has_function_privilege('anon', p.oid, 'EXECUTE')), 'none')
     = 'cancel_booking,cert_template_readable,create_booking,form_upload_allowed,get_agenda_view,get_distribution_timer,get_distribution_view,get_public_booking_page,get_public_certificate_verification,get_public_form,get_public_landing,get_public_library,get_public_list,get_public_tab,library_file_readable,list_alumni_lookups,list_public_alumni_directory,resolve_ref,submit_public_form,track_landing_event,track_node_event,validate_invitation,validate_staff_invitation,verify_certificate' then 'ok' else 'mismatch' end;
-- every function of ours has a fixed search_path; every SECURITY DEFINER too
insert into chk select 'SEC.6 functions without fixed search_path (public/app_private/migration)', '0',
  (select count(*) from pg_proc p where p.pronamespace in ('public'::regnamespace,'app_private'::regnamespace,'migration'::regnamespace)
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))::text,
  case when (select count(*) from pg_proc p where p.pronamespace in ('public'::regnamespace,'app_private'::regnamespace,'migration'::regnamespace)
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) = 0 then 'ok' else 'mismatch' end;
-- no authenticated EXECUTE on secret-adjacent / worker RPCs
insert into chk select 'SEC.7 service-role-only RPCs are not executable by authenticated', 'none',
  coalesce((select string_agg(p.proname, ',') from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('submit_form_response','claim_email_batch','complete_email','fail_email','claim_integration_jobs','complete_job','fail_job')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))), 'none'),
  case when not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('submit_form_response','claim_email_batch','complete_email','fail_email','claim_integration_jobs','complete_job','fail_job')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))) then 'ok' else 'mismatch' end;
-- secrets are not carried: no secret-looking column in public / app_private
insert into chk select 'SEC.8 secret-like columns in public (password/secret/api_key/service_account/token)', '0',
  (select count(*) from information_schema.columns where table_schema = 'public' and column_name ~* '(password|passwd|secret|api_key|service_account|smtp_pass|private_key)')::text,
  case when (select count(*) from information_schema.columns where table_schema = 'public' and column_name ~* '(password|passwd|secret|api_key|service_account|smtp_pass|private_key)') = 0 then 'ok' else 'mismatch' end;
-- Realtime: only node_revisions (company_submissions stays out)
insert into chk select 'RT.1 supabase_realtime publication tables', 'public.node_revisions',
  coalesce((select string_agg(schemaname || '.' || tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'), 'none'),
  case when coalesce((select string_agg(schemaname || '.' || tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'), 'none') = 'public.node_revisions' then 'ok' else 'mismatch' end;
-- Storage: new buckets exist, no open policy on event-assets for writing, orphan policies gone
insert into chk select 'ST.1 new buckets present (the 5 designed ones; stage 2b adds the private migration-archive, m45 the public og-images, both ignored here)', 'certificate-templates,form-uploads,founder-assets,public-assets,resources',
  (select string_agg(id, ',' order by id) from storage.buckets where id not in ('event-assets', 'migration-archive', 'og-images')),
  case when (select string_agg(id, ',' order by id) from storage.buckets where id not in ('event-assets', 'migration-archive', 'og-images')) = 'certificate-templates,form-uploads,founder-assets,public-assets,resources' then 'ok' else 'mismatch' end;
insert into chk select 'ST.2 buckets: only public-assets is public (+legacy event-assets, +og-images since m45)', 'event-assets,public-assets',
  (select string_agg(id, ',' order by id) from storage.buckets where public and id <> 'og-images'),
  case when (select string_agg(id, ',' order by id) from storage.buckets where public and id <> 'og-images') = 'event-assets,public-assets' then 'ok' else 'mismatch' end;
-- (restrictive policies - the WebP / extension allow-lists - only NARROW what a permissive one grants: they are not counted; the one permissive anon write is the
--  guarded public form-upload policy form_uploads_insert_public, m31 / m36)
insert into chk select 'ST.3 permissive storage policies that let anon/public write (at most the guarded form upload) or reference event-covers', '<= 1 / 0',
  (select count(*) from pg_policies where schemaname = 'storage' and permissive = 'PERMISSIVE' and cmd in ('INSERT','UPDATE','DELETE') and (roles && array['public','anon']::name[]))::text
    || ' / ' || (select count(*) from pg_policies where schemaname = 'storage' and coalesce(qual,'') || coalesce(with_check,'') like '%event-covers%')::text,
  case when (select count(*) from pg_policies where schemaname = 'storage' and permissive = 'PERMISSIVE' and cmd in ('INSERT','UPDATE','DELETE') and (roles && array['public','anon']::name[])) <= 1
        and (select count(*) from pg_policies where schemaname = 'storage' and coalesce(qual,'') || coalesce(with_check,'') like '%event-covers%') = 0 then 'ok' else 'mismatch' end;
-- extensions (04 2.3)
insert into chk select 'EXT.1 extensions', 'btree_gist,citext,pg_trgm (+pg_jsonschema,pg_cron if available)',
  (select string_agg(extname, ',' order by extname) from pg_extension where extname in ('citext','pg_trgm','btree_gist','pg_jsonschema','pg_cron')),
  case when (select count(*) from pg_extension where extname in ('citext','pg_trgm','btree_gist')) = 3 then 'ok' else 'mismatch' end;
-- no CHECK-constraint loophole: nodes cannot change project or type (triggers present)
insert into chk select 'GUARD.1 immutability / integrity triggers present', '>= 12',
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('nodes_bu_forbid','edges_biu_validate','edges_ciu_cycle','lists_bu_subkind',
     'list_items_biu_node','participants_biu_status','certificate_templates_bud_immutable','certificate_template_fields_biud_immutable','user_roles_bud_guard',
     'projects_biu_timezone','founders_bu_self_guard','on_auth_user_created','nodes_ai_revision','nodes_au_bump'))::text,
  case when (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('nodes_bu_forbid','edges_biu_validate','edges_ciu_cycle','lists_bu_subkind',
     'list_items_biu_node','participants_biu_status','certificate_templates_bud_immutable','certificate_template_fields_biud_immutable','user_roles_bud_guard',
     'projects_biu_timezone','founders_bu_self_guard','on_auth_user_created','nodes_ai_revision','nodes_au_bump')) >= 12 then 'ok' else 'mismatch' end;
insert into chk select 'GUARD.2 revision-counter triggers (>= 25 tables x 3 events; later builds add tables)', '>= 75',
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname ~ '_rev_(ins|upd|del)$')::text,
  case when (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname ~ '_rev_(ins|upd|del)$') >= 75 then 'ok' else 'mismatch' end;

insert into migration.recon (run_id, check_key, expected, actual, status) select :run_id, key, expected, actual, status from chk;
update migration.run set finished_at = now(), status = case when exists (select 1 from chk where status = 'mismatch') then 'FAIL' else 'PASS' end where id = :run_id;
commit;
select status, check_key, expected, actual from migration.recon where run_id = :run_id order by (status = 'ok'), check_key;
select (count(*) filter (where status = 'mismatch') > 0) as failed from migration.recon where run_id = :run_id \gset
\if :failed
  do $$ begin raise exception 'v10: verification FAILED (see migration.recon)'; end $$;
\endif
