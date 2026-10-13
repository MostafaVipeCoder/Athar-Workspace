-- m22_asset_map_and_security_checks  (05 phases 13/14 SQL side; STAGE 2a, LOCAL ONLY)
-- 1) asset_map bookkeeping for stage 2b (NOTHING is moved or downloaded here): every storage/external image reference has a row in
--    migration.asset_map (status 'pending') + migration.asset_refs (which target column to fill);
-- 2) metadata-only views of the secret tables (no key / password column);
-- 3) assertions that no secret value (google_settings key material, smtp_settings password) exists anywhere in public / app_private.
set search_path = public, extensions;
\set ON_ERROR_STOP on

begin;
create temp table _r on commit drop as select migration.begin_run('m22_asset_map_and_security_checks') as id;
\o /dev/null

-- ---------------------------------------------------------------- metadata views (secret columns are not selected)
create or replace view migration.v_google_settings_meta as
  select id, event_id, calendar_id, impersonate_email, created_at, updated_at,
         (service_account_key is not null and btrim(service_account_key) <> '') as has_key_in_legacy_archive
  from legacy.google_settings;
create or replace view migration.v_smtp_settings_meta as
  select id, smtp_host, smtp_port, created_at, (smtp_pass is not null and btrim(smtp_pass) <> '') as has_password_in_legacy_archive
  from legacy.smtp_settings;
revoke all on migration.v_google_settings_meta, migration.v_smtp_settings_meta from public, anon, authenticated;

select migration.flag('secret_in_legacy_archive', 'review', 'legacy.google_settings', 'service_account_key',
  'the Google service-account key text (service account deleted by the owner 08 s12) still sits in the closed legacy archive; it is NOT copied. Null it / drop the table at sign-off (05 V14.1)')
where exists (select 1 from legacy.google_settings where service_account_key is not null and btrim(service_account_key) <> '');
select migration.flag('secret_in_legacy_archive', 'review', 'legacy.smtp_settings', 'smtp_pass',
  'the SMTP password sits in the closed legacy archive; it is NOT copied. Move it to Edge Function secrets / Vault by the owner, then null it at sign-off (05 phase 14)')
where exists (select 1 from legacy.smtp_settings where smtp_pass is not null and btrim(smtp_pass) <> '');

-- ---------------------------------------------------------------- asset bookkeeping: every path column resolves in asset_map
create temp table t_paths on commit drop as
select 'projects.cover_path' src, cover_path p from public.projects where cover_path is not null
union all select 'network_experts.photo_path', photo_path from public.network_experts where photo_path is not null
union all select 'companies.logo_path', logo_path from public.companies where logo_path is not null
union all select 'form_covers.image_path', image_path from public.form_covers where image_path is not null
union all select 'landing_cards.cover_path', cover_path from public.landing_cards where cover_path is not null
union all select 'public_links.og_image_path', og_image_path from public.public_links where og_image_path is not null
union all select 'resources.file_path', file_path from public.resources where file_path is not null
union all select 'profiles.avatar_path', avatar_path from public.profiles where avatar_path is not null
union all select 'founders.photo_path', photo_path from public.founders where photo_path is not null
union all select 'nodes.config.paths', v from public.nodes n, jsonb_each_text(n.config) k, lateral (select k.value v where k.key in ('backgroundPath','footerPath')) x
union all select 'nodes.config.hero.coverPath', n.config#>>'{hero,coverPath}' from public.nodes n where n.config#>>'{hero,coverPath}' is not null
union all select 'nodes.config.thank_you.image_path', n.config#>>'{thank_you,image_path}' from public.nodes n where n.config#>>'{thank_you,image_path}' is not null
union all select 'form_responses.answers (logo)', coalesce(r.answers->>'logo', r.answers->>'logo_url') from public.form_responses r where coalesce(r.answers->>'logo', r.answers->>'logo_url') is not null;

select migration.flag('asset_external_pending_2b', 'review', 'migration.asset_map', 'external',
  (select count(*) from migration.asset_map where source = 'external')::text || ' distinct external image URLs (Google Drive etc.) are recorded as pending for stage 2b (download into Storage; failures to be listed for the owner)')
where exists (select 1 from migration.asset_map where source = 'external');
select migration.flag('asset_bucket_pending_2b', 'review', 'migration.asset_map', 'bucket',
  (select count(*) from migration.asset_map where source = 'bucket')::text || ' event-assets objects are recorded as pending for stage 2b (copy/resize to the new buckets; paths are already written in the *_path columns)')
where exists (select 1 from migration.asset_map where source = 'bucket');

-- ================================================================= verification
select migration.check((select id from _r), 'V13.0 every non-NULL path in the new schema is registered in asset_map', '0',
  (select count(*)::text from t_paths t where not exists (select 1 from migration.asset_map m where m.new_path = t.p)));
select migration.check((select id from _r), 'V13.0 no asset_map record without a status', '0', (select count(*)::text from migration.asset_map where status is null));
select migration.check((select id from _r), 'V13.0 no file moved in stage 2a (status never copied/failed)', '0',
  (select count(*)::text from migration.asset_map where status not in ('pending','skipped_static','unreferenced')));
select migration.check((select id from _r), 'V13.0 storage.objects untouched (count = baseline)', (select row_count::text from migration.baseline where table_name = 'storage.objects'),
  (select count(*)::text from storage.objects));
select migration.check((select id from _r), 'V13.0 bucket references: distinct objects registered exist as storage.objects (event-assets)', '0',
  (select count(*)::text from migration.asset_map m where m.source = 'bucket' and not exists (select 1 from storage.objects o where o.bucket_id = 'event-assets' and o.name = m.old_path)));

-- secrets: compare against the legacy values WITHOUT printing them
do $$
declare
  v_run bigint := (select id from _r); vals text[]; r record; n bigint; total bigint := 0; scanned int := 0;
begin
  select coalesce(array_agg(x), '{}') into vals from (
    select (case when s.service_account_key ~ '^\s*\{' then (s.service_account_key::jsonb)->>'private_key_id' end) x from legacy.google_settings s
    union select (case when s.service_account_key ~ '^\s*\{' then (s.service_account_key::jsonb)->>'client_email' end) from legacy.google_settings s
    union select (case when s.service_account_key ~ '^\s*\{' then left((s.service_account_key::jsonb)->>'private_key', 80) end) from legacy.google_settings s
    union select p.smtp_pass from legacy.smtp_settings p where length(coalesce(p.smtp_pass, '')) >= 6) q
  where x is not null and length(x) >= 6;
  for r in select c.table_schema, c.table_name, c.column_name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           where c.table_schema in ('public','app_private') and c.data_type in ('text','character varying','jsonb','json','USER-DEFINED','ARRAY')
  loop
    execute format('select count(*) from %I.%I t where exists (select 1 from unnest($1) v where position(v in t.%I::text) > 0)', r.table_schema, r.table_name, r.column_name)
      into n using vals;
    total := total + n; scanned := scanned + 1;
  end loop;
  perform migration.check(v_run, 'V14.2 no secret value (Google key material, SMTP password) in public / app_private text columns', '0', total::text,
                          jsonb_build_object('columns_scanned', scanned, 'patterns', cardinality(vals)));
end $$;

select migration.check_design((select id from _r), 'V14.2 columns with secret-like names (alumni_invitations.token = sha256 hash, google_connections.vault_secret_id = vault reference)', '2',
  (select count(*)::text from information_schema.columns where table_schema in ('public','app_private')
    and (column_name ~* '(pass(word)?$|secret|private_key|service_account|smtp)' or column_name = 'token')
    and table_name in (select table_name from information_schema.tables where table_type = 'BASE TABLE')));
select migration.check((select id from _r), 'V14.3 google_connections / email_outbox hold no loaded rows', '0',
  (select ((select count(*) from app_private.google_connections) + (select count(*) from app_private.email_outbox))::text));

select migration.finish_run((select id from _r));
\o
select check_key, left(expected, 40) expected, left(actual, 40) actual, status from migration.recon where run_id = (select id from _r) order by check_key;
select source, status, count(*) objects, sum(bytes) bytes from migration.asset_map group by 1, 2 order by 1, 2;
select (select count(*) from migration.asset_refs) refs, (select count(*) from migration.asset_refs where new_path is not null) refs_with_target;
commit;
