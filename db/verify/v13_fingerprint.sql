-- v13_fingerprint  (STAGE 2a)  Read-only.  Prints a deterministic fingerprint of one database: catalog objects, row counts and
-- content checksums (volatile columns such as created_at / updated_at / identity ids are excluded).  Run it against two databases and diff:
--   bash db/test-stage2a-from-scratch.sh   (does exactly that for the real DB vs a scratch DB restored from the pre-stage2a checkpoint)
\pset tuples_only on
\pset format unaligned
\pset footer off
-- ---------------------------------------------------------------- catalog
select 'CAT table ' || n.nspname || '.' || c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','app_private','legacy','migration') order by 1;
select 'CAT view ' || n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'v' and n.nspname in ('public','app_private','legacy','migration') order by 1;
select 'CAT func ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') secdef=' || p.prosecdef || ' cfg=' || coalesce(p.proconfig::text, '') || ' acl=' || coalesce(p.proacl::text, '')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app_private','migration') order by 1;
select 'CAT policy ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' ' || roles::text from pg_policies where schemaname in ('public','storage') order by 1;
select 'CAT index ' || schemaname || '.' || indexname || ' ' || indexdef from pg_indexes where schemaname in ('public','app_private','migration') order by 1;
select 'CAT trigger ' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname in ('public','app_private','migration','auth') order by 1;
select 'CAT constraint ' || n.nspname || '.' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(c.oid)
from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('public','app_private','migration') order by 1;
select 'CAT bucket ' || id || ' public=' || public from storage.buckets order by 1;
select 'CAT publication ' || p.pubname || ' ' || coalesce(string_agg(pt.schemaname || '.' || pt.tablename, ',' order by pt.tablename), '') from pg_publication p left join pg_publication_tables pt on pt.pubname = p.pubname group by p.pubname order by 1;
select 'CAT relacl ' || n.nspname || '.' || c.relname || ' ' || replace(coalesce(c.relacl::text, ''), '{postgres=arwdDxtm/postgres}', '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','v') and n.nspname in ('public','app_private','migration','legacy') order by 1;
-- ---------------------------------------------------------------- counts + content checksums (every table of the 4 schemas)
do $$
declare r record; n bigint; h text; drop_cols text[] := array['updated_at','created_at','published_at','resolved_at','merged_at','computed_at','started_at','finished_at'];
begin
  create temp table fp (line text);
  for r in select table_schema s, table_name t from information_schema.tables
           where table_schema in ('public','app_private','legacy','migration') and table_type = 'BASE TABLE'
             and table_name not in ('run','recon') order by 1, 2 loop
    execute format('select count(*) from %I.%I', r.s, r.t) into n;
    execute format($q$select md5(coalesce(string_agg(x, E'\n' order by x), '')) from (select ((to_jsonb(t) - $1) - (case when %L in ('flags','node_events') then 'id' else 'zz' end))::text x from %I.%I t) q$q$, r.t, r.s, r.t)
      into h using drop_cols;
    insert into fp values ('DATA ' || r.s || '.' || r.t || ' rows=' || n || ' md5=' || h);
  end loop;
end $$;
select line from fp order by line;
