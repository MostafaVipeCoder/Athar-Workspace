-- v01_legacy_isolation  (05 phase 1 verification V01.1 - V01.4).  Read-only.  Records into migration.recon; fails (exit 1) on mismatch.
\set ON_ERROR_STOP on
set search_path = public, extensions;
begin;
insert into migration.run (phase, status, note) values ('stage1-verify-v01', 'running', 'legacy isolation') returning id as run_id \gset

create temp table chk (key text primary key, expected text, actual text, status text);

-- V01.1 the 48 old tables live in legacy and none of them is left in public under its old shape
insert into chk select 'V01.1 legacy has 48 tables', '48', count(*)::text,
       case when count(*) = 48 then 'ok' else 'mismatch' end from pg_tables where schemaname = 'legacy';

-- V01.2 every migration.baseline row equals count(*) of the archived table (nothing changed during the move)
do $$
declare r record; n bigint; bad int := 0; total int := 0;
begin
  for r in select table_name, row_count from migration.baseline where table_name like 'public.%' loop
    execute format('select count(*) from legacy.%I', substr(r.table_name, 8)) into n;
    total := total + 1;
    if n <> r.row_count then bad := bad + 1; raise notice 'baseline mismatch: % baseline % now %', r.table_name, r.row_count, n; end if;
  end loop;
  insert into chk values ('V01.2 baseline == legacy counts (48 tables)', total || ' tables / 0 diffs', total || ' tables / ' || bad || ' diffs',
                          case when total = 48 and bad = 0 then 'ok' else 'mismatch' end);
end $$;

-- V01.3 the archive is closed to anon / authenticated / service_role
insert into chk select 'V01.3 legacy schema closed to API roles', 'false/false/false',
  has_schema_privilege('anon','legacy','USAGE') || '/' || has_schema_privilege('authenticated','legacy','USAGE') || '/' || has_schema_privilege('service_role','legacy','USAGE'),
  case when not has_schema_privilege('anon','legacy','USAGE') and not has_schema_privilege('authenticated','legacy','USAGE')
        and not has_schema_privilege('service_role','legacy','USAGE') then 'ok' else 'mismatch' end;
insert into chk select 'V01.3b no table privilege on legacy.* for anon/authenticated', '0',
  (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'legacy'::regnamespace and r.rolname in ('anon','authenticated','service_role'))::text,
  case when (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'legacy'::regnamespace and r.rolname in ('anon','authenticated','service_role')) = 0 then 'ok' else 'mismatch' end;

-- V01.4 auth data untouched: row counts equal the baseline and the password-hash fingerprint is unchanged (never printed)
insert into chk select 'V01.4a auth.users count == baseline', b.row_count::text, (select count(*) from auth.users)::text,
  case when b.row_count = (select count(*) from auth.users) then 'ok' else 'mismatch' end
  from migration.baseline b where b.table_name = 'auth.users';
insert into chk select 'V01.4b auth.users password fingerprint unchanged', 'same', case when s.value = (select md5(coalesce(string_agg(encrypted_password, ',' order by id), '')) from auth.users) then 'same' else 'DIFFERENT' end,
  case when s.value = (select md5(coalesce(string_agg(encrypted_password, ',' order by id), '')) from auth.users) then 'ok' else 'mismatch' end
  from migration.state s where s.key = 'auth_pw_md5';
-- (stage 1 deletes no storage object: the count never drops below the baseline; stage 2b and the node builds only ADD objects)
insert into chk select 'V01.4c storage.objects count >= baseline (stage 1 deletes nothing)', '>= ' || b.row_count::text, (select count(*) from storage.objects)::text,
  case when b.row_count <= (select count(*) from storage.objects) then 'ok' else 'mismatch' end
  from migration.baseline b where b.table_name = 'storage.objects';

insert into migration.recon (run_id, check_key, expected, actual, status) select :run_id, key, expected, actual, status from chk;
update migration.run set finished_at = now(), status = case when exists (select 1 from chk where status <> 'ok') then 'FAIL' else 'PASS' end where id = :run_id;
commit;
select status, check_key, expected, actual from migration.recon where run_id = :run_id order by check_key;
select (count(*) filter (where status <> 'ok') > 0) as failed from migration.recon where run_id = :run_id \gset
\if :failed
  do $$ begin raise exception 'v01: verification FAILED (see migration.recon)'; end $$;
\endif
