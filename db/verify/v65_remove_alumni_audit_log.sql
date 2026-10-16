-- v65_remove_alumni_audit_log  (m65: owner decision 21 removed the per-edit audit log of m60 / m64)
-- Read-only catalog proofs (no fixtures, nothing is written). Prints ok / mismatch lines; exits non-zero on any mismatch.
-- The behaviour around it (manager editing, "last modified", concurrency) is proved by v60 (trimmed to what stayed) and the new model by v66 / v67 / v68.
\set ON_ERROR_STOP on
set search_path = public, extensions;

create temp table v65_res (key text, ok boolean, detail text);
create or replace function pg_temp.t(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    insert into v65_res values (p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    insert into v65_res values (p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;

select pg_temp.t('A01 the log table, its epoch table and every logging trigger are gone', $q$select concat_ws('|', (to_regclass('public.alumni_change_log') is null)::text, (to_regclass('app_private.alumni_log_epoch') is null)::text,
  (select count(*) from pg_trigger t where not t.tgisinternal and (t.tgname like '%alumni%log%' or t.tgfoid::regproc::text like '%alumni_log%'))::text)$q$, 'true|true|0');
select pg_temp.t('A02 no logger / replay / viewer function is left (alumni_log_*, alumni_request_id, alumni_section_of, alumni_state_*, list_alumni_history)', $q$select count(*)::text from pg_proc p
  where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and (p.proname like 'alumni\_log\_%' escape '\' or p.proname in ('alumni_request_id', 'alumni_section_of', 'alumni_state_current', 'alumni_state_flat', 'alumni_state_as_of', 'alumni_state_diff', 'list_alumni_history'))$q$, '0');
select pg_temp.t('A03 no function of public / app_private mentions the log, its epoch or its GUCs (app.alumni_reason, app.alumni_coalesce_seconds, app.alumni_log_merge)', $q$select count(*)::text from pg_proc p
  where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and (p.prosrc ilike '%alumni\_change\_log%' escape '\' or p.prosrc ilike '%alumni_log_epoch%' or p.prosrc ilike '%app.alumni_reason%'
        or p.prosrc ilike '%alumni_coalesce_seconds%' or p.prosrc ilike '%alumni_log_merge%')$q$, '0');
select pg_temp.t('A04 the yearly-row writers and the log-only `reason` argument are gone', $q$select concat_ws('|',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('upsert_company_snapshot', 'review_company_snapshot', 'delete_company_snapshot'))::text,
  (to_regprocedure('public.save_alumni_company(uuid,jsonb,timestamptz)') is not null)::text, (to_regprocedure('public.save_alumni_founder(uuid,jsonb,timestamptz)') is not null)::text,
  (to_regprocedure('public.save_alumni_company(uuid,jsonb,timestamptz,text)') is null)::text, (to_regprocedure('public.save_alumni_founder(uuid,jsonb,timestamptz,text)') is null)::text)$q$, '0|true|true|true|true');
select pg_temp.t('A05 the "last modified" machinery stays: five stamp triggers, the three no-op aware touch triggers, the actor helper', $q$select concat_ws('|',
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_biu_stamp', 'founders_biu_stamp', 'company_founders_biu_stamp', 'company_internal_biu_stamp', 'founder_identities_biu_stamp'))::text,
  (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('companies_bu_touch', 'founders_bu_touch', 'company_founders_bu_touch'))::text,
  (to_regprocedure('app_private.alumni_actor()') is not null)::text, (to_regprocedure('public.get_alumni_stamps(uuid)') is not null)::text)$q$, '5|3|true|true');
select pg_temp.t('A06 get_alumni_stamps answers from the rows: company + founders (no per-section stamps)', $q$select (pg_get_functiondef('public.get_alumni_stamps(uuid)'::regprocedure) not like '%sections%')::text$q$, 'true');
select pg_temp.t('A07 the two storage proof functions no longer name the log table', $q$select concat_ws('|', (pg_get_functiondef('app_private.rewrite_storage_refs(text,text)'::regprocedure) not like '%alumni_change_log%')::text,
  (pg_get_functiondef('app_private.storage_dangling_refs()'::regprocedure) not like '%alumni_change_log%')::text)$q$, 'true|true');
select pg_temp.t('A08 NATIONAL IDS: the at-rest proof query finds no ID-shaped value in any text / jsonb column of public (except founder_identities, by design) - so no copy of an ID exists outside the identity table', $q$select count(*)::text from app_private.scan_id_shaped_values()$q$, '0');
select pg_temp.t('A09 the new tables (draft, reminder log / campaigns / templates / settings) hold no national-ID column and the templates reject ID-shaped text', $q$select concat_ws('|',
  (select count(*) from information_schema.columns c where c.table_schema in ('public', 'app_private') and c.table_name in ('company_figures', 'alumni_reminder_log', 'alumni_reminder_campaigns', 'alumni_reminder_templates', 'alumni_quarter_settings') and c.column_name ilike '%national%')::text,
  (select count(*) from pg_proc p where p.proname = 'alumni_template_check' and p.prosrc like '%contains_id%')::text)$q$, '0|1');

select key as check_key, detail from v65_res where not ok order by key;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from v65_res;
select (count(*) filter (where not ok) > 0) as failed from v65_res \gset
\if :failed
  do $$ begin raise exception 'v65: audit-log removal tests FAILED'; end $$;
\endif
