-- m90_finalize_stage2a  (05 phase 15 closing step; STAGE 2a, LOCAL ONLY)
-- * normalises every node revision to rev = 2 (one bump after all loaders, so any client cache built before is invalidated; deterministic),
-- * ANALYZEs the target and bookkeeping tables, * records the stage in migration.state.
-- It does NOT drop the legacy schema (that is the owner-approved sign-off step of 05 phase 17, NOT part of stage 2a) and it does NOT set
-- cutover_done.
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m90_finalize_stage2a') as id;
\o /dev/null

update public.node_revisions set rev = 2, updated_at = now() where rev <> 2;

do $$
declare r record;
begin
  for r in select table_schema, table_name from information_schema.tables
           where table_schema in ('public','app_private','migration') and table_type = 'BASE TABLE'
  loop
    execute format('analyze %I.%I', r.table_schema, r.table_name);
  end loop;
end $$;

insert into migration.state(key, value) values ('stage2a_loaded', 'true')
on conflict (key) do update set value = excluded.value;
insert into migration.state(key, value) values ('cutover_done', 'false') on conflict (key) do nothing;

select migration.check((select id from _r), 'V90.1 every node has rev = 2', '0', (select count(*)::text from public.node_revisions where rev <> 2));
select migration.check((select id from _r), 'V90.2 legacy schema still intact (48 tables)', '48',
  (select count(*)::text from information_schema.tables where table_schema = 'legacy' and table_type = 'BASE TABLE'));
select migration.check((select id from _r), 'V90.3 cutover not done', 'false', (select value from migration.state where key = 'cutover_done'));
select migration.check((select id from _r), 'V90.4 open blocker flags', '0', (select count(*)::text from migration.flags where severity = 'blocker' and resolved_at is null));
select migration.check((select id from _r), 'V90.5 recon rows with status mismatch in the latest run of every phase', '0',
  (select count(*)::text from migration.v_recon_latest where status = 'mismatch'));

select migration.finish_run((select id from _r));
\o
select check_key, expected, actual, status from migration.recon where run_id = (select id from _r) order by check_key;
select severity, count(*) filter (where resolved_at is null) open, count(*) filter (where resolved_at is not null) resolved from migration.flags group by 1 order by 1;
commit;
