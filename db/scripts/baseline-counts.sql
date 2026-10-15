-- Data fingerprint of the local database: row counts only (no personal data, no secrets). Read-only.
--   docker exec -i supabase_db_stack psql -U postgres -d postgres -X -At -F ' ' < db/scripts/baseline-counts.sql
-- Run it before and after anything that restarts the stack or touches many tables and compare the two outputs (diff).
-- Output: one "name count" line per key table, then the exact count of EVERY public / app_private / vault table, then a summary.
select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.user_roles', count(*) from public.user_roles
union all select 'storage.buckets', count(*) from storage.buckets
union all select 'storage.objects', count(*) from storage.objects
union all select 'vault.secrets', count(*) from vault.secrets
union all select 'pg_roles', count(*) from pg_roles
order by 1;

-- exact row count of every base table of the three schemas that hold platform data
select t.table_schema || '.' || t.table_name as tbl,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name), false, true, '')))[1]::text::bigint as n
  from information_schema.tables t
 where t.table_schema in ('public', 'app_private', 'vault') and t.table_type = 'BASE TABLE'
 order by 1;

-- summary: number of tables / functions / policies (schema fingerprint)
select 'public_tables', count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
union all select 'public_functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all select 'app_private_functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private'
union all select 'public_policies', count(*) from pg_policies where schemaname = 'public'
union all select 'storage_policies', count(*) from pg_policies where schemaname = 'storage'
union all select 'extensions', count(*) from pg_extension;
