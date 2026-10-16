-- v61_google_oauth  (m61: Google OAuth core: connections, single-use OAuth states, Vault / AES token storage, service-role RPCs, client RPCs, sender resolution)
-- Role-switch tests inside ONE transaction that is ROLLED BACK. Test users / rows / vault secrets never persist. Prints ok / mismatch lines; exits non-zero on any mismatch.
--
-- Fixture (ids ...00000000e61x):  SA = super_admin, PM1 / PM2 = project_manager, AM = alumni_manager, F = founder, NR = no role.
-- Definer helpers live in schema v61_test (created here, dropped by the rollback): cid(owner) = the connection id of an owner, sysid(), vault_n() = Vault secrets of ours.
-- NEVER call an app_private helper while the session role is anon / authenticated (a role-switched call of a function the role may not execute can crash this local
-- Postgres image, m42 / m43 gotcha): denials are tested inside a plpgsql exception block (fails()), or with has_function_privilege().
\set ON_ERROR_STOP on
set search_path = public, extensions;
select set_config('v61.res', '', false) \gset

begin;
create schema v61_test;
grant usage on schema v61_test to public;
create or replace function v61_test.t(p_key text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  perform set_config('v61.res', current_setting('v61.res', true) || case when p_ok then 'ok' else 'mismatch' end || '|' || p_key || '|' || coalesce(p_detail, '') || E'\n', false);
  if not p_ok then raise notice 'FAIL %: %', p_key, p_detail; end if;
end $$;
create or replace function v61_test.val(p_key text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    perform v61_test.t(p_key, v is not distinct from p_expected, 'got ' || coalesce(v, 'NULL') || ', want ' || p_expected);
  exception when others then
    perform v61_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 140));
  end;
end $$;
create or replace function v61_test.fails(p_key text, p_sql text, p_state text default null, p_hint text default null, p_detail text default null) returns void language plpgsql as $$
declare v_hint text; v_detail text;
begin
  begin
    execute p_sql;
    perform v61_test.t(p_key, false, 'expected an error but the statement succeeded');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    perform v61_test.t(p_key, (p_state is null or sqlstate = p_state) and (p_hint is null or v_hint = p_hint) and (p_detail is null or v_detail = p_detail),
      'sqlstate ' || sqlstate || ' hint ' || coalesce(v_hint, '-') || ' detail ' || coalesce(v_detail, '-') || ' msg ' || left(sqlerrm, 80));
  end;
end $$;
create or replace function v61_test.okrun(p_key text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql; perform v61_test.t(p_key, true, 'ok');
  exception when others then
    perform v61_test.t(p_key, false, 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
end $$;
-- definer helpers (owner postgres): the only way a role-switched session can see the ids / counts it needs
create or replace function v61_test.cid(p_owner uuid) returns uuid language sql volatile security definer set search_path = '' as $$
  select c.id from app_private.google_connections c where c.kind = 'user' and c.owner_user_id = p_owner
$$;
create or replace function v61_test.sysid() returns uuid language sql volatile security definer set search_path = '' as $$
  select c.id from app_private.google_connections c where c.kind = 'system'
$$;
create or replace function v61_test.vault_n() returns integer language sql volatile security definer set search_path = '' as $$
  select count(*)::integer from vault.secrets where name like 'google-refresh-token:%'
$$;
create or replace function v61_test.cipher_n() returns integer language sql volatile security definer set search_path = '' as $$
  select count(*)::integer from app_private.google_connection_secrets
$$;
create or replace function v61_test.col(p_id uuid, p_col text) returns text language plpgsql volatile security definer set search_path = '' as $$
declare v text;
begin
  execute format('select %I::text from app_private.google_connections where id = $1', p_col) into v using p_id;
  return v;
end $$;
create or replace function v61_test.byemail(p_email text, p_col text) returns text language plpgsql volatile security definer set search_path = '' as $$
declare v text;
begin
  execute format('select %I::text from app_private.google_connections where email::text = $1', p_col) into v using lower(p_email);
  return v;
end $$;
create or replace function v61_test.n_email(p_email text) returns integer language sql volatile security definer set search_path = '' as $$
  select count(*)::integer from app_private.google_connections where email::text = lower(p_email)
$$;
create or replace function v61_test.scopes() returns text[] language sql immutable as $$
  select array['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events']
$$;
create or replace function v61_test.h(p_i integer) returns text language sql immutable as $$ select encode(extensions.digest('v61-nonce-' || p_i::text, 'sha256'), 'hex') $$;
-- an AES-shaped blob (what the edge function stores in AES mode; never a real ciphertext here)
create or replace function v61_test.blob(p_tag text) returns text language sql immutable as $$ select 'v1.0a1b2c3d.' || translate(encode(extensions.digest(p_tag, 'sha256'), 'base64'), '+/=', '-_') || '.' || translate(encode(extensions.digest(p_tag || 'x', 'sha256'), 'base64'), '+/=', '-_') $$;
revoke all on all functions in schema v61_test from public;
grant execute on all functions in schema v61_test to anon, authenticated, service_role;

-- ================================================================= C. catalog (as postgres)
select v61_test.val('C01 google_connections has the finished columns', $q$select count(*)::text from information_schema.columns where table_schema = 'app_private' and table_name = 'google_connections'
  and column_name in ('id','owner_user_id','kind','email','scopes','vault_secret_id','status','last_ok_at','last_error','created_at','connected_at','last_used_at','google_sub','token_storage','status_changed_at','is_system')$q$, '16');
select v61_test.val('C02 no column of google_connections can hold a token: only the vault reference and the storage mode exist', $q$select coalesce(string_agg(column_name, ',' order by column_name), '') from information_schema.columns
  where table_schema = 'app_private' and table_name = 'google_connections' and (column_name ~* '(token|secret|cipher|refresh|password|key)' and column_name not in ('vault_secret_id', 'token_storage'))$q$, '');
select v61_test.val('C03 is_system is generated from kind', $q$select is_generated || '/' || generation_expression from information_schema.columns where table_schema = 'app_private' and table_name = 'google_connections' and column_name = 'is_system'$q$, 'ALWAYS/(kind = ''system''::text)');
select v61_test.val('C04 vault_secret_id may be NULL (AES mode / revoked)', $q$select is_nullable from information_schema.columns where table_schema = 'app_private' and table_name = 'google_connections' and column_name = 'vault_secret_id'$q$, 'YES');
select v61_test.val('C05 the status vocabulary is active | needs_reconnect | revoked', $q$select pg_get_constraintdef(oid) from pg_constraint where conname = 'google_connections_status_check'$q$, $q$CHECK ((status = ANY (ARRAY['active'::text, 'needs_reconnect'::text, 'revoked'::text])))$q$);
select v61_test.val('C06 one system row and one connection per owner are unique indexes', $q$select count(*)::text from pg_indexes where schemaname = 'app_private' and indexname in ('google_connections_one_system_idx', 'google_connections_one_per_owner_idx')$q$, '2');
select v61_test.val('C07 RLS is enabled AND forced on the three Google tables', $q$select count(*)::text from pg_class where relnamespace = 'app_private'::regnamespace and relname in ('google_connections', 'google_connection_secrets', 'google_oauth_states') and relrowsecurity and relforcerowsecurity$q$, '3');
select v61_test.val('C08 no client role (and not even service_role) holds a privilege on the three tables', $q$select count(*)::text from information_schema.role_table_grants where table_schema = 'app_private' and table_name in ('google_connections', 'google_connection_secrets', 'google_oauth_states') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')$q$, '0');
select v61_test.val('C09 the two read policies exist (own row, super_admin)', $q$select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'app_private' and tablename = 'google_connections'$q$, 'google_connections_select_admin,google_connections_select_own');
select v61_test.val('C10 the ten service-role RPCs: SECURITY DEFINER, empty search_path, EXECUTE for service_role and for NO client role', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('google_storage_capabilities','google_oauth_begin','google_oauth_consume','google_connection_upsert','set_system_connection','google_secret_get','google_connection_lookup','google_connection_mark','google_connection_touch','resolve_sender_connection')
  and p.prosecdef and 'search_path=""' = any(p.proconfig) and has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$, '10');
select v61_test.val('C11 the three client RPCs: SECURITY DEFINER, empty search_path, EXECUTE for authenticated only (not anon)', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('list_my_google_connections','get_google_connection_status','list_google_connections_admin') and p.prosecdef and 'search_path=""' = any(p.proconfig)
  and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '3');
select v61_test.val('C12 every app_private helper of m61 is closed to anon and authenticated and has an empty search_path', $q$select count(*)::text from pg_proc p where p.pronamespace = 'app_private'::regnamespace
  and p.proname in ('google_user_is_staff','google_user_is_super_admin','google_vault_available','google_delete_secret','google_resolve_sender','resolve_sender_connection','google_store_connection','google_connections_owner_gone')
  and 'search_path=""' = any(p.proconfig) and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$, '8');
select v61_test.val('C13 Supabase Vault is installed on this image and the database reports it', $q$select (select count(*) from pg_extension where extname = 'supabase_vault')::text || '/' || (public.google_storage_capabilities()->>'vault')$q$, '1/true');
select v61_test.val('C14 anon and authenticated hold no privilege on Vault: no schema usage, no table / view grant', $q$select ((select count(*) from information_schema.role_table_grants where table_schema = 'vault' and grantee in ('anon', 'authenticated', 'PUBLIC'))::text || '/' || has_schema_privilege('authenticated', 'vault', 'USAGE')::text || '/' || has_schema_privilege('anon', 'vault', 'USAGE')::text || '/' || has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT')::text)$q$, '0/false/false/false');
select v61_test.val('C15 no function a client role may execute reads Vault or names the ciphertext table', $q$select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)
  and (p.prosrc ilike '%decrypted_secrets%' or p.prosrc ilike '%google_connection_secrets%') and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$q$, '0');
select v61_test.val('C16 the m06d view of the caller''s own connection exposes no secret column; authenticated may select, anon may not', $q$select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'my_google_connection' and column_name ~* '(secret|cipher|token_storage|google_sub)')::text
  || '/' || has_table_privilege('authenticated', 'public.my_google_connection', 'SELECT')::text || '/' || has_table_privilege('anon', 'public.my_google_connection', 'SELECT')::text$q$, '0/true/false');
select v61_test.val('C17 no row anywhere still says needs_reauth', $q$select count(*)::text from app_private.google_connections where status not in ('active', 'needs_reconnect', 'revoked')$q$, '0');
select v61_test.fails('C18 the old status needs_reauth is refused by the constraint', $q$insert into app_private.google_connections (kind, email, scopes, status, token_storage) values ('user', 'zz-v61-old@example.invalid', '{}', 'needs_reauth', 'aes')$q$, '23514');
select v61_test.fails('C19 last_error is a short CODE: a sentence (or anything with a space) is refused', $q$insert into app_private.google_connections (kind, email, scopes, status, token_storage, last_error) values ('user', 'zz-v61-err@example.invalid', '{}', 'needs_reconnect', 'aes', 'Token has been expired or revoked.')$q$, '23514');
select v61_test.fails('C20 a system row cannot have an owner', $q$insert into app_private.google_connections (kind, email, scopes, status, token_storage, owner_user_id) values ('system', 'zz-v61-so@example.invalid', '{}', 'active', 'aes', '00000000-0000-4000-8000-00000000e611')$q$, '23514');
select v61_test.fails('C21 an active Vault row must reference its secret', $q$insert into app_private.google_connections (kind, email, scopes, status, token_storage, vault_secret_id) values ('user', 'zz-v61-nv@example.invalid', '{}', 'active', 'vault', null)$q$, '23514');
select v61_test.val('C22 vault is the default storage, the baseline has no connection', $q$select (select count(*) from app_private.google_connections)::text || '/' || (select count(*) from app_private.google_oauth_states)::text || '/' || (select count(*) from app_private.google_connection_secrets)::text$q$, '0/0/0');

-- ================================================================= fixture (as postgres)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-00000000e610','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v61-sa@athareg.com','{"provisioned":true}','{"full_name":"V61 Super Admin"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e611','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v61-pm1@athareg.com','{"provisioned":true}','{"full_name":"V61 PM One"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e612','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v61-pm2@athareg.com','{"provisioned":true}','{"full_name":"V61 PM Two"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e613','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v61-am@athareg.com','{"provisioned":true}','{"full_name":"V61 Alumni Manager"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e614','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v61-f@example.invalid','{"provisioned":true}','{"full_name":"V61 Founder"}', now(), now()),
 ('00000000-0000-4000-8000-00000000e615','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-v61-nr@example.invalid','{"provisioned":true}','{"full_name":"V61 No Role"}', now(), now());
insert into public.user_roles (user_id, role_key) values ('00000000-0000-4000-8000-00000000e610','super_admin'), ('00000000-0000-4000-8000-00000000e611','project_manager'),
  ('00000000-0000-4000-8000-00000000e612','project_manager'), ('00000000-0000-4000-8000-00000000e613','alumni_manager'), ('00000000-0000-4000-8000-00000000e614','founder');

-- ================================================================= N. NULL / garbage arguments never succeed (as postgres: the definer functions are tested directly)
select v61_test.fails('N01 oauth_begin(NULL user)', $q$select public.google_oauth_begin(null, v61_test.h(0), false, now() + interval '5 minutes')$q$, '22023', 'google_invalid');
select v61_test.fails('N02 oauth_begin(NULL nonce hash)', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e611', null, false, now() + interval '5 minutes')$q$, '22023', 'google_invalid');
select v61_test.fails('N03 oauth_begin(NULL expiry)', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e611', v61_test.h(0), false, null)$q$, '22023', 'google_invalid');
select v61_test.fails('N04 oauth_begin(a nonce that is not a SHA-256 hex)', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e611', 'not-a-hash', false, now() + interval '5 minutes')$q$, '22023', 'google_invalid');
select v61_test.okrun('N05 oauth_begin(NULL system flag) is treated as FALSE (a PM passes only as a user, never as "system")', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e611', v61_test.h(1), null, now() + interval '5 minutes')$q$);
select v61_test.val('N05b ... and that call stored a NON-system state', $q$select is_system::text from app_private.google_oauth_states where nonce_hash = v61_test.h(1)$q$, 'false');
select v61_test.val('N06 oauth_consume(NULL / garbage) -> NULL', $q$select (public.google_oauth_consume(null) is null)::text || '/' || (public.google_oauth_consume('xyz') is null)::text || '/' || (public.google_oauth_consume(v61_test.h(999)) is null)::text$q$, 'true/true/true');
select v61_test.fails('N07 connection_upsert(NULL owner)', $q$select public.google_connection_upsert(null, '00000000-0000-4000-8000-00000000e611', 'a@athareg.com', 's', v61_test.scopes(), 'aes', v61_test.blob('n7'))$q$, '42501', 'forbidden');
select v61_test.fails('N08 connection_upsert(NULL actor)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', null, 'a@athareg.com', 's', v61_test.scopes(), 'aes', v61_test.blob('n8'))$q$, '42501', 'forbidden');
select v61_test.fails('N09 connection_upsert(owner <> actor): nobody connects for somebody else', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e612', 'a@athareg.com', 's', v61_test.scopes(), 'aes', v61_test.blob('n9'))$q$, '42501', 'forbidden');
select v61_test.fails('N10 connection_upsert(NULL e-mail)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e611', null, 's', v61_test.scopes(), 'aes', v61_test.blob('n10'))$q$, '22023', 'google_invalid');
select v61_test.fails('N11 connection_upsert(NULL scopes)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e611', 'a@athareg.com', 's', null, 'aes', v61_test.blob('n11'))$q$, '22023', 'missing_scopes');
select v61_test.fails('N12 connection_upsert(NULL storage)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e611', 'a@athareg.com', 's', v61_test.scopes(), null, v61_test.blob('n12'))$q$, '22023', 'google_invalid');
select v61_test.fails('N13 connection_upsert(NULL secret)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e611', 'a@athareg.com', 's', v61_test.scopes(), 'vault', null)$q$, '22023', 'google_invalid');
select v61_test.fails('N14 set_system_connection(NULL actor)', $q$select public.set_system_connection(null, 'startups@athareg.com', 's', v61_test.scopes(), 'aes', v61_test.blob('n14'))$q$, '42501', 'forbidden');
select v61_test.fails('N15 secret_get / lookup / mark with NULL', $q$select public.google_connection_lookup(null, null)$q$, '42501', 'forbidden');
select v61_test.val('N16 secret_get(NULL) / secret_get(unknown) -> NULL', $q$select (public.google_secret_get(null) is null)::text || '/' || (public.google_secret_get(gen_random_uuid()) is null)::text$q$, 'true/true');
select v61_test.fails('N17 mark(NULL id)', $q$select public.google_connection_mark(null, 'revoked', null)$q$, '22023', 'google_invalid');
select v61_test.fails('N18 mark(NULL status)', $q$select public.google_connection_mark(gen_random_uuid(), null, null)$q$, '22023', 'google_invalid');
select v61_test.fails('N19 mark(a status outside the vocabulary)', $q$select public.google_connection_mark(gen_random_uuid(), 'needs_reauth', null)$q$, '22023', 'google_invalid');
select v61_test.val('N20 mark(unknown id) is a harmless NULL; touch(NULL) changes nothing', $q$select (public.google_connection_mark(gen_random_uuid(), 'revoked', null) is null)::text || '/' || (select count(*) from app_private.google_connections)::text$q$, 'true/0');
select v61_test.val('N21 resolve_sender_connection(NULL) with nothing connected -> NULL', $q$select (public.resolve_sender_connection(null) is null)::text$q$, 'true');

-- ================================================================= O. OAuth state lifecycle (as service_role)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v61_test.val('O01 a PM starts a user flow: ok, and only the HASH of the nonce is stored', $q$select (public.google_oauth_begin('00000000-0000-4000-8000-00000000e611', v61_test.h(10), false, now() + interval '10 minutes'))->>'ok'$q$, 'true');
select v61_test.fails('O02 the same nonce twice: google_invalid (state:replayed)', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e612', v61_test.h(10), false, now() + interval '10 minutes')$q$, '22023', 'google_invalid', 'state:replayed');
select v61_test.fails('O03 a founder cannot start a flow', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e614', v61_test.h(11), false, now() + interval '10 minutes')$q$, '42501', 'forbidden');
select v61_test.fails('O04 a user without a role cannot start a flow', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e615', v61_test.h(12), false, now() + interval '10 minutes')$q$, '42501', 'forbidden');
select v61_test.fails('O05 an unknown user id cannot start a flow', $q$select public.google_oauth_begin(gen_random_uuid(), v61_test.h(13), false, now() + interval '10 minutes')$q$, '42501', 'forbidden');
select v61_test.fails('O06 a PM cannot start the SYSTEM flow', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e611', v61_test.h(14), true, now() + interval '10 minutes')$q$, '42501', 'forbidden');
select v61_test.val('O07 the super_admin can', $q$select (public.google_oauth_begin('00000000-0000-4000-8000-00000000e610', v61_test.h(15), true, now() + interval '10 minutes'))->>'ok'$q$, 'true');
select v61_test.fails('O08 an expiry in the past is refused', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e611', v61_test.h(16), false, now() - interval '1 second')$q$, '22023', 'google_invalid');
select v61_test.fails('O09 an expiry beyond 15 minutes is refused', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e611', v61_test.h(17), false, now() + interval '16 minutes')$q$, '22023', 'google_invalid');
select v61_test.val('O10 consume returns the user, the system flag and the e-mail (never anything secret)', $q$select r::text from (select public.google_oauth_consume(v61_test.h(10)) r) x$q$,
  '{"user_id": "00000000-0000-4000-8000-00000000e611", "is_system": false, "user_email": "zz-v61-pm1@athareg.com", "is_super_admin": false}');
select v61_test.val('O11 REPLAY: the second consume of the same nonce -> NULL', $q$select (public.google_oauth_consume(v61_test.h(10)) is null)::text$q$, 'true');
select v61_test.val('O12 the system state consumes with its flag and the super_admin mark', $q$select r->>'is_system' || '/' || (r->>'is_super_admin') from (select public.google_oauth_consume(v61_test.h(15)) r) x$q$, 'true/true');
reset role;
-- an EXPIRED state (inserted directly: begin() refuses to create one) and a state whose user lost the right in between
insert into app_private.google_oauth_states (nonce_hash, user_id, is_system, created_at, expires_at) values
  (v61_test.h(20), '00000000-0000-4000-8000-00000000e611', false, now() - interval '20 minutes', now() - interval '10 minutes'),
  (v61_test.h(21), '00000000-0000-4000-8000-00000000e611', true, now(), now() + interval '10 minutes'),
  (v61_test.h(22), '00000000-0000-4000-8000-00000000e614', false, now(), now() + interval '10 minutes');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v61_test.val('O13 EXPIRY: a state past its expiry is not consumable (and stays unused)', $q$select (public.google_oauth_consume(v61_test.h(20)) is null)::text$q$, 'true');
select v61_test.val('O14 a SYSTEM state of a user who is only a PM is refused at consume time (rights are checked again)', $q$select (public.google_oauth_consume(v61_test.h(21)) is null)::text$q$, 'true');
select v61_test.val('O15 a state of a founder (staff role missing) is refused at consume time', $q$select (public.google_oauth_consume(v61_test.h(22)) is null)::text$q$, 'true');
reset role;
select v61_test.val('O16 the refused consumes still SPENT their nonce (no second chance)', $q$select count(*)::text from app_private.google_oauth_states where nonce_hash in (v61_test.h(21), v61_test.h(22)) and consumed_at is not null$q$, '2');
-- rate limit: 20 open states per user
insert into app_private.google_oauth_states (nonce_hash, user_id, expires_at)
  select v61_test.h(100 + i), '00000000-0000-4000-8000-00000000e612', now() + interval '10 minutes' from generate_series(1, 20) i;
-- housekeeping: an old row goes away on the next begin
insert into app_private.google_oauth_states (nonce_hash, user_id, created_at, expires_at) values (v61_test.h(300), '00000000-0000-4000-8000-00000000e613', now() - interval '3 days', now() - interval '3 days' + interval '10 minutes');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v61_test.fails('O17 the 21st open attempt of a user is too_many_attempts', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e612', v61_test.h(400), false, now() + interval '10 minutes')$q$, 'P0001', 'too_many_attempts');
select v61_test.okrun('O18 another user is not affected', $q$select public.google_oauth_begin('00000000-0000-4000-8000-00000000e613', v61_test.h(401), false, now() + interval '10 minutes')$q$);
reset role;
select v61_test.val('O19 housekeeping: a state older than a day was deleted by that begin', $q$select count(*)::text from app_private.google_oauth_states where nonce_hash = v61_test.h(300)$q$, '0');
select v61_test.val('O20 no state row holds the nonce itself, only 64-hex hashes', $q$select count(*)::text from app_private.google_oauth_states where nonce_hash !~ '^[0-9a-f]{64}$'$q$, '0');

-- ================================================================= S. storing connections (as service_role): Vault mode
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v61_test.val('S01 PM1 connects (Vault): the answer has no secret, only ids and metadata', $q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k) from (select public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e611', 'Zz-V61-PM1@Athareg.com', 'sub-pm1', v61_test.scopes(), 'vault', '1//v61-refresh-token-pm1') r) x$q$, 'connection_id,email,kind,status,token_storage');
reset role;
select v61_test.val('S02 the row: user kind, owner, e-mail lower-cased, active, Vault, a Vault reference, no ciphertext row', $q$select concat_ws('|', kind, owner_user_id::text, email::text, status, token_storage, (vault_secret_id is not null)::text, is_system::text) from app_private.google_connections where owner_user_id = '00000000-0000-4000-8000-00000000e611'$q$,
  'user|00000000-0000-4000-8000-00000000e611|zz-v61-pm1@athareg.com|active|vault|true|false');
select v61_test.val('S03 Vault holds the token ENCRYPTED (the stored column differs from the plaintext) and only one Vault secret exists', $q$select (select secret <> '1//v61-refresh-token-pm1' from vault.secrets s join app_private.google_connections c on c.vault_secret_id = s.id where c.owner_user_id = '00000000-0000-4000-8000-00000000e611')::text || '/' || v61_test.vault_n()::text || '/' || v61_test.cipher_n()::text$q$, 'true/1/0');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v61_test.val('S04 google_secret_get returns the Vault plaintext to the service role (the only reader)', $q$select r::text from (select public.google_secret_get(v61_test.cid('00000000-0000-4000-8000-00000000e611')) r) x$q$, '{"email": "zz-v61-pm1@athareg.com", "value": "1//v61-refresh-token-pm1", "storage": "vault"}');
select v61_test.val('S05a RECONNECT (a second connect of the same PM) keeps the connection id', $q$select ((public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e611', 'zz-v61-pm1@athareg.com', 'sub-pm1', v61_test.scopes(), 'vault', '1//v61-second-token')->>'connection_id')::uuid = v61_test.cid('00000000-0000-4000-8000-00000000e611'))::text$q$, 'true');
select v61_test.val('S05b ... the new secret is read back and exactly ONE Vault secret of PM1 remains', $q$select (public.google_secret_get(v61_test.cid('00000000-0000-4000-8000-00000000e611')) ->> 'value') || '/' || v61_test.vault_n()::text$q$, '1//v61-second-token/1');
select v61_test.fails('S06 PM2 cannot connect the SAME Google account (email_in_use)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm1@athareg.com', 'x', v61_test.scopes(), 'vault', '1//other')$q$, 'P0001', 'email_in_use');
select v61_test.fails('S07 granular consent: Gmail send without Calendar is refused', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'x', array['openid','https://www.googleapis.com/auth/gmail.send'], 'vault', '1//t')$q$, '22023', 'missing_scopes');
select v61_test.fails('S08 ... and Calendar without Gmail send', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'x', array['https://www.googleapis.com/auth/calendar.events'], 'vault', '1//t')$q$, '22023', 'missing_scopes');
select v61_test.fails('S09 a malformed e-mail', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'not an email', 'x', v61_test.scopes(), 'vault', '1//t')$q$, '22023', 'google_invalid', 'email:invalid');
select v61_test.fails('S10 an unknown storage mode', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'x', v61_test.scopes(), 'plaintext', '1//t')$q$, '22023', 'google_invalid', 'storage:invalid');
select v61_test.fails('S11 an empty secret / a secret over 4096 characters', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'x', v61_test.scopes(), 'vault', '')$q$, '22023', 'google_invalid', 'secret:invalid');
select v61_test.fails('S12 ... over 4096', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'x', v61_test.scopes(), 'vault', repeat('a', 4097))$q$, '22023', 'google_invalid', 'secret:invalid');
select v61_test.fails('S13 a founder / a user without roles cannot store a connection', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e614', '00000000-0000-4000-8000-00000000e614', 'zz-v61-f@athareg.com', 'x', v61_test.scopes(), 'vault', '1//t')$q$, '42501', 'forbidden');
-- AES mode
select v61_test.fails('S14 AES mode refuses a PLAIN token (only the encrypted blob of the edge function)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'sub-pm2', v61_test.scopes(), 'aes', '1//plain-refresh-token')$q$, '22023', 'google_invalid', 'secret:not_encrypted');
select v61_test.okrun('S15 PM2 connects in AES mode with an encrypted blob', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'sub-pm2', v61_test.scopes(), 'aes', v61_test.blob('pm2'))$q$);
select v61_test.val('S16 google_secret_get returns the AES blob (the edge function decrypts it)', $q$select (public.google_secret_get(v61_test.cid('00000000-0000-4000-8000-00000000e612'))) ->> 'storage' || '/' || ((public.google_secret_get(v61_test.cid('00000000-0000-4000-8000-00000000e612'))) ->> 'value' = v61_test.blob('pm2'))::text$q$, 'aes/true');
reset role;
select v61_test.val('S17 AES rows: no Vault reference, the ciphertext lives in its own table, Vault still has only PM1''s secret', $q$select concat_ws('/', (select vault_secret_id is null from app_private.google_connections where owner_user_id = '00000000-0000-4000-8000-00000000e612')::text, v61_test.cipher_n()::text, v61_test.vault_n()::text)$q$, 'true/1/1');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v61_test.val('S18a PM2 switches AES -> Vault', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'sub-pm2', v61_test.scopes(), 'vault', '1//pm2-vault')->>'token_storage'$q$, 'vault');
select v61_test.val('S18b ... the ciphertext is deleted, Vault holds PM1 and PM2', $q$select v61_test.cipher_n()::text || '/' || v61_test.vault_n()::text$q$, '0/2');
select v61_test.val('S18c and back to AES', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'sub-pm2', v61_test.scopes(), 'aes', v61_test.blob('pm2b'))->>'token_storage'$q$, 'aes');
select v61_test.val('S18d ... the Vault secret of PM2 is deleted, the ciphertext is back', $q$select v61_test.cipher_n()::text || '/' || v61_test.vault_n()::text$q$, '1/1');
-- the system sender
select v61_test.fails('S19 a PM cannot set the system sender', $q$select public.set_system_connection('00000000-0000-4000-8000-00000000e611', 'startups@athareg.com', 'x', v61_test.scopes(), 'vault', '1//sys')$q$, '42501', 'forbidden');
select v61_test.fails('S20 an alumni_manager cannot either', $q$select public.set_system_connection('00000000-0000-4000-8000-00000000e613', 'startups@athareg.com', 'x', v61_test.scopes(), 'vault', '1//sys')$q$, '42501', 'forbidden');
select v61_test.val('S21 the super_admin links startups@: kind system, no owner', $q$select public.set_system_connection('00000000-0000-4000-8000-00000000e610', 'startups@athareg.com', 'sub-sys', v61_test.scopes(), 'vault', '1//sys-token')->>'kind'$q$, 'system');
select v61_test.val('S22 re-linking returns the SAME system row id', $q$select ((public.set_system_connection('00000000-0000-4000-8000-00000000e610', 'startups@athareg.com', 'sub-sys', v61_test.scopes(), 'vault', '1//sys-token-2')->>'connection_id')::uuid = v61_test.sysid())::text$q$, 'true');
reset role;
select v61_test.val('S23 exactly one system row, no owner, is_system true; Vault has PM1 + system', $q$select (select count(*) from app_private.google_connections where kind = 'system')::text || '/' || (select (owner_user_id is null)::text || (is_system)::text from app_private.google_connections where kind = 'system') || '/' || v61_test.vault_n()::text$q$, '1/truetrue/2');
select v61_test.fails('S24 a SECOND system row cannot be inserted directly (unique index)', $q$insert into app_private.google_connections (kind, email, scopes, status, token_storage) values ('system', 'zz-v61-sys2@athareg.com', '{}', 'active', 'aes')$q$, '23505');
select v61_test.fails('S25 a second connection of one owner cannot be inserted directly (unique index)', $q$insert into app_private.google_connections (kind, email, scopes, status, token_storage, owner_user_id) values ('user', 'zz-v61-dup@athareg.com', '{}', 'active', 'aes', '00000000-0000-4000-8000-00000000e611')$q$, '23505');

-- ================================================================= M. state changes and the secret's life (as service_role)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v61_test.okrun('M01a mark PM1 needs_reconnect with the code invalid_grant', $q$select public.google_connection_mark(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'needs_reconnect', 'invalid_grant')$q$);
select v61_test.val('M01b ... a CODE is stored and the status changed', $q$select v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'last_error') || '/' || v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'status')$q$, 'invalid_grant/needs_reconnect');
select v61_test.okrun('M02a mark needs_reconnect with a SENTENCE as the error (a message that could carry a token)', $q$select public.google_connection_mark(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'needs_reconnect', 'Token 1//abc has been expired or revoked')$q$);
select v61_test.val('M02b ... it is never stored: the code falls back to needs_reconnect', $q$select v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'last_error')$q$, 'needs_reconnect');
select v61_test.val('M03 the secret can still be read while the connection needs a reconnect (a disconnect must be able to revoke it at Google)', $q$select (public.google_secret_get(v61_test.cid('00000000-0000-4000-8000-00000000e611')) ->> 'value')$q$, '1//v61-second-token');
select v61_test.okrun('M04a mark active again (the secret still exists)', $q$select public.google_connection_mark(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'active', null)$q$);
select v61_test.val('M04b ... that clears the error', $q$select v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'status') || '/' || coalesce(v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'last_error'), 'NULL')$q$, 'active/NULL');
select v61_test.okrun('M05 touch stamps last_used_at (active only)', $q$select public.google_connection_touch(v61_test.cid('00000000-0000-4000-8000-00000000e611'))$q$);
select v61_test.val('M06 ... it did', $q$select (v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'last_used_at') is not null)::text$q$, 'true');
select v61_test.val('M07 lookup: PM1 finds his own, PM2 his own, the super_admin the system row', $q$select (public.google_connection_lookup('00000000-0000-4000-8000-00000000e611', false)->>'email') || '/' || (public.google_connection_lookup('00000000-0000-4000-8000-00000000e612', null)->>'email') || '/' || (public.google_connection_lookup('00000000-0000-4000-8000-00000000e610', true)->>'email')$q$, 'zz-v61-pm1@athareg.com/zz-v61-pm2@athareg.com/startups@athareg.com');
select v61_test.fails('M08 lookup of the SYSTEM row by a PM is forbidden', $q$select public.google_connection_lookup('00000000-0000-4000-8000-00000000e611', true)$q$, '42501', 'forbidden');
select v61_test.fails('M09 lookup by a founder is forbidden', $q$select public.google_connection_lookup('00000000-0000-4000-8000-00000000e614', false)$q$, '42501', 'forbidden');
select v61_test.val('M10 a user without a connection: lookup -> NULL', $q$select (public.google_connection_lookup('00000000-0000-4000-8000-00000000e613', false) is null)::text$q$, 'true');
-- revoke = the secret is DELETED
select v61_test.okrun('M11a revoke PM1', $q$select public.google_connection_mark(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'revoked', 'invalid_grant')$q$);
select v61_test.val('M11b ... the Vault secret is DELETED, the reference and the error are cleared, the row stays (history, foreign keys)', $q$select v61_test.vault_n()::text || '/' || coalesce(v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'vault_secret_id'), 'NULL') || '/' || coalesce(v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'last_error'), 'NULL') || '/' || v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'status')$q$, '1/NULL/NULL/revoked');
select v61_test.val('M12 a revoked connection has no readable secret', $q$select (public.google_secret_get(v61_test.cid('00000000-0000-4000-8000-00000000e611')) is null)::text$q$, 'true');
select v61_test.okrun('M13a needs_reconnect on a revoked row', $q$select public.google_connection_mark(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'needs_reconnect', 'invalid_grant')$q$);
select v61_test.val('M13b ... a disconnected account stays disconnected', $q$select v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'status')$q$, 'revoked');
select v61_test.fails('M14 active on a revoked row is refused (no_secret): it needs a new connect', $q$select public.google_connection_mark(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'active', null)$q$, 'P0001', 'no_secret');
select v61_test.okrun('M15a touch a revoked row', $q$select public.google_connection_touch(v61_test.cid('00000000-0000-4000-8000-00000000e611'))$q$);
select v61_test.val('M15b ... it stays revoked', $q$select v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'status')$q$, 'revoked');
select v61_test.okrun('M16a revoke PM2 (AES)', $q$select public.google_connection_mark(v61_test.cid('00000000-0000-4000-8000-00000000e612'), 'revoked', null)$q$);
select v61_test.val('M16b ... its ciphertext row is deleted', $q$select v61_test.cipher_n()::text$q$, '0');
-- a revoked row's e-mail can be taken over by a later connect (same mailbox, same history); not by another KIND
select v61_test.val('M17a PM1 reconnects after a revoke: the SAME connection id', $q$select ((public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e611', 'zz-v61-pm1@athareg.com', 'sub-pm1', v61_test.scopes(), 'vault', '1//third')->>'connection_id')::uuid = v61_test.cid('00000000-0000-4000-8000-00000000e611'))::text$q$, 'true');
select v61_test.val('M17b ... active again with a fresh Vault secret', $q$select v61_test.col(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'status') || '/' || v61_test.vault_n()::text$q$, 'active/2');
select v61_test.okrun('M18a revoke PM1 again', $q$select public.google_connection_mark(v61_test.cid('00000000-0000-4000-8000-00000000e611'), 'revoked', null)$q$);
select v61_test.okrun('M18b the alumni_manager connects with PM1''s old (revoked) address: the revoked row is ADOPTED', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e613', '00000000-0000-4000-8000-00000000e613', 'zz-v61-pm1@athareg.com', 'sub-pm1', v61_test.scopes(), 'vault', '1//am')$q$);
select v61_test.val('M18c ... nothing is duplicated: one row, now AM''s and active', $q$select v61_test.byemail('zz-v61-pm1@athareg.com', 'owner_user_id') || '/' || v61_test.byemail('zz-v61-pm1@athareg.com', 'status') || '/' || v61_test.n_email('zz-v61-pm1@athareg.com')::text$q$, '00000000-0000-4000-8000-00000000e613/active/1');
select v61_test.fails('M19 the SYSTEM address cannot be taken by a user (a different kind)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'startups@athareg.com', 'x', v61_test.scopes(), 'vault', '1//t')$q$, 'P0001', 'email_in_use');
reset role;
select v61_test.val('M20 after all that: the connections are PM1-address (now AM''s), PM2 (revoked), system', $q$select (select count(*) from app_private.google_connections)::text$q$, '3');

-- ================================================================= R. sender resolution: the SAME table as tests/google-sender.test.js
-- build every case with direct inserts (as postgres), then read app_private.google_resolve_sender / resolve_sender_connection
delete from vault.secrets where name like 'google-refresh-token:%';
delete from app_private.google_connection_secrets;
delete from app_private.google_connections;
create or replace function v61_test.mk(p_kind text, p_owner uuid, p_email text, p_status text, p_scopes text[] default null) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into app_private.google_connections (id, kind, owner_user_id, email, scopes, status, token_storage) values (v_id, p_kind, p_owner, p_email, coalesce(p_scopes, v61_test.scopes()), p_status, 'aes');
  return v_id;
end $$;
create or replace function v61_test.res(p_user uuid) returns text language sql as $$
  select coalesce(r.source, '-') || '|' || coalesce(r.reason, '-') || '|' || coalesce((select c.email::text from app_private.google_connections c where c.id = r.connection_id), '-') from app_private.google_resolve_sender(p_user) r
$$;
-- case 1: own active + system active -> own
select v61_test.mk('user', '00000000-0000-4000-8000-00000000e611', 'r1-own@athareg.com', 'active') \gset own1_
select v61_test.mk('system', null, 'r1-sys@athareg.com', 'active') \gset sys1_
select v61_test.val('R01 own active wins over the system sender', $q$select v61_test.res('00000000-0000-4000-8000-00000000e611')$q$, 'user|-|r1-own@athareg.com');
select v61_test.val('R02 another PM without a connection gets the system sender, reason user_not_connected', $q$select v61_test.res('00000000-0000-4000-8000-00000000e612')$q$, 'system|user_not_connected|r1-sys@athareg.com');
select v61_test.val('R03 NULL user (no acting PM) -> the system sender', $q$select v61_test.res(null)$q$, 'system|user_not_connected|r1-sys@athareg.com');
update app_private.google_connections set status = 'needs_reconnect' where email = 'r1-own@athareg.com';
select v61_test.val('R04 own needs_reconnect -> system, reason user_needs_reconnect', $q$select v61_test.res('00000000-0000-4000-8000-00000000e611')$q$, 'system|user_needs_reconnect|r1-sys@athareg.com');
update app_private.google_connections set status = 'revoked' where email = 'r1-own@athareg.com';
select v61_test.val('R05 own revoked -> system, reason user_not_connected', $q$select v61_test.res('00000000-0000-4000-8000-00000000e611')$q$, 'system|user_not_connected|r1-sys@athareg.com');
update app_private.google_connections set status = 'needs_reconnect' where email = 'r1-own@athareg.com';
update app_private.google_connections set status = 'needs_reconnect' where email = 'r1-sys@athareg.com';
select v61_test.val('R06 own needs_reconnect and the system sender too -> nobody (user_needs_reconnect_no_system)', $q$select v61_test.res('00000000-0000-4000-8000-00000000e611')$q$, '-|user_needs_reconnect_no_system|-');
select v61_test.val('R07 a PM with nothing, system down -> nobody (no_connection)', $q$select v61_test.res('00000000-0000-4000-8000-00000000e612')$q$, '-|no_connection|-');
select v61_test.val('R08 the SQL function agrees: resolve_sender_connection is NULL', $q$select (app_private.resolve_sender_connection('00000000-0000-4000-8000-00000000e612') is null)::text$q$, 'true');
update app_private.google_connections set status = 'active' where email = 'r1-sys@athareg.com';
update app_private.google_connections set status = 'active' where email = 'r1-own@athareg.com';
delete from app_private.google_connections where kind = 'system';
select v61_test.val('R10 ... (system deleted) PM2 gets nothing although PM1 is connected', $q$select v61_test.res('00000000-0000-4000-8000-00000000e612')$q$, '-|no_connection|-');
select v61_test.mk('system', null, 'r2-sys@athareg.com', 'revoked') \gset sys2_
select v61_test.val('R11 a revoked system sender does not count; own active still wins', $q$select v61_test.res('00000000-0000-4000-8000-00000000e611')$q$, 'user|-|r1-own@athareg.com');
update app_private.google_connections set scopes = array['openid', 'https://www.googleapis.com/auth/gmail.send'] where email = 'r1-own@athareg.com';
select v61_test.val('R12 an active connection WITHOUT the calendar scope is not usable (reason user_needs_reconnect, no system)', $q$select v61_test.res('00000000-0000-4000-8000-00000000e611')$q$, '-|user_needs_reconnect_no_system|-');
update app_private.google_connections set status = 'active' where email = 'r2-sys@athareg.com';
select v61_test.val('R13 ... and with an active system sender it falls back to it', $q$select v61_test.res('00000000-0000-4000-8000-00000000e611')$q$, 'system|user_needs_reconnect|r2-sys@athareg.com');
select v61_test.val('R14 the public wrapper returns the same id', $q$select (public.resolve_sender_connection('00000000-0000-4000-8000-00000000e611') = (select id from app_private.google_connections where email = 'r2-sys@athareg.com'))::text$q$, 'true');
delete from app_private.google_connections;

-- ================================================================= P. client RPCs (authenticated) + RLS second line of defence
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select v61_test.okrun('P00a fixture: PM1 connects (Vault)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e611', '00000000-0000-4000-8000-00000000e611', 'zz-v61-pm1@athareg.com', 'sub-pm1', v61_test.scopes(), 'vault', '1//pm1-secret-VALUE-must-never-leak')$q$);
select v61_test.okrun('P00b fixture: PM2 connects (AES)', $q$select public.google_connection_upsert('00000000-0000-4000-8000-00000000e612', '00000000-0000-4000-8000-00000000e612', 'zz-v61-pm2@athareg.com', 'sub-pm2', v61_test.scopes(), 'aes', v61_test.blob('pm2-client'))$q$);
select v61_test.okrun('P00c fixture: the super_admin links the system sender', $q$select public.set_system_connection('00000000-0000-4000-8000-00000000e610', 'startups@athareg.com', 'sub-sys', v61_test.scopes(), 'vault', '1//sys-secret-VALUE-must-never-leak')$q$);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e611","role":"authenticated"}', true);
set local role authenticated;
select v61_test.val('P01 PM1 lists exactly HIS connection, with metadata keys only', $q$select count(*)::text || '/' || (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(r) k from public.list_my_google_connections() r) q)$q$, '1/connected_at,email,id,is_system,kind,last_error,last_used_at,scopes,status,status_changed_at');
select v61_test.val('P02 ... and it is his', $q$select r->>'email' from public.list_my_google_connections() r$q$, 'zz-v61-pm1@athareg.com');
select v61_test.val('P03 get_google_connection_status: mine, the system sender (e-mail + status only), and what would send now', $q$select (r->'mine'->>'email') || '/' || (r->'system'->>'email') || '/' || (r->'effective'->>'source') || '/' || (r->'effective'->>'email') || '/' || (r->'effective'->>'fallback') || '/' || (r->>'is_super_admin') from (select public.get_google_connection_status() r) x$q$,
  'zz-v61-pm1@athareg.com/startups@athareg.com/user/zz-v61-pm1@athareg.com/false/false');
select v61_test.val('P04 the system part exposes e-mail, status, dates: nothing else', $q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(public.get_google_connection_status()->'system') k)$q$, 'connected_at,email,last_used_at,status');
select v61_test.val('P05 the mine part: no secret reference, no sub, no storage mode', $q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(public.get_google_connection_status()->'mine') k)$q$, 'connected_at,email,id,last_error,last_used_at,scopes_ok,status');
select v61_test.val('P06 NO secret value in ANY client answer', $q$select ((public.get_google_connection_status())::text || (select string_agg(r::text, '') from public.list_my_google_connections() r) || (select coalesce(string_agg(r::text, ''), '') from public.my_google_connection r)) ~* '(secret-VALUE|1//|v1\.0a1b2c3d|vault_secret_id|ciphertext)'$q$, 'false');
select v61_test.val('P07 the view of the caller''s own connection shows one row (his)', $q$select count(*)::text || '/' || min(email) from public.my_google_connection$q$, '1/zz-v61-pm1@athareg.com');
select v61_test.fails('P08 a PM is not a super_admin: list_google_connections_admin is forbidden', $q$select count(*) from public.list_google_connections_admin()$q$, '42501', 'forbidden');
select v61_test.fails('P09 a PM cannot read the table, the secrets table or the states table', $q$select count(*) from app_private.google_connections$q$, '42501');
select v61_test.fails('P10 ... secrets', $q$select count(*) from app_private.google_connection_secrets$q$, '42501');
select v61_test.fails('P11 ... states', $q$select count(*) from app_private.google_oauth_states$q$, '42501');
-- EXECUTE denials are proven with the privilege catalog, NOT by calling the function: executing a function the role may not execute crashes this local image (v03 note)
select v61_test.val('P14 authenticated (PM, founder, super_admin alike) holds EXECUTE on none of the ten service-role RPCs nor on the app_private helpers', $q$select count(*)::text from pg_proc p where ((p.pronamespace = 'app_private'::regnamespace and p.proname in ('google_user_is_staff','google_user_is_super_admin','google_vault_available','google_delete_secret','google_resolve_sender','resolve_sender_connection','google_store_connection','google_connections_owner_gone'))
  or (p.pronamespace = 'public'::regnamespace and p.proname in ('google_storage_capabilities','google_oauth_begin','google_oauth_consume','google_connection_upsert','set_system_connection','google_secret_get','google_connection_lookup','google_connection_mark','google_connection_touch','resolve_sender_connection')))
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$, '0');
select v61_test.val('P15 anon holds EXECUTE on none of the thirteen public RPCs of m61 (client or service)', $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('google_storage_capabilities','google_oauth_begin','google_oauth_consume','google_connection_upsert','set_system_connection','google_secret_get','google_connection_lookup','google_connection_mark','google_connection_touch','resolve_sender_connection','list_my_google_connections','get_google_connection_status','list_google_connections_admin') and has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '0');
select v61_test.val('P16 service_role may execute the ten service-role RPCs and NOT the three client RPCs'' tables: it holds no table privilege on the Google tables', $q$select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('google_storage_capabilities','google_oauth_begin','google_oauth_consume','google_connection_upsert','set_system_connection','google_secret_get','google_connection_lookup','google_connection_mark','google_connection_touch','resolve_sender_connection') and has_function_privilege('service_role', p.oid, 'EXECUTE'))::text
  || '/' || has_table_privilege('service_role', 'app_private.google_connections', 'SELECT')::text || '/' || has_table_privilege('service_role', 'app_private.google_connection_secrets', 'SELECT')::text$q$, '10/false/false');
select v61_test.fails('P21 a PM cannot write the table directly either', $q$update app_private.google_connections set status = 'active' where true$q$, '42501');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e612","role":"authenticated"}', true);
set local role authenticated;
select v61_test.val('P22 PM2 sees only HIS connection and the AES one reports no storage detail', $q$select count(*)::text || '/' || min(r->>'email') from public.list_my_google_connections() r$q$, '1/zz-v61-pm2@athareg.com');
select v61_test.val('P23 PM2 status: his own again (not PM1''s)', $q$select (public.get_google_connection_status()->'mine'->>'email')$q$, 'zz-v61-pm2@athareg.com');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e613","role":"authenticated"}', true);
set local role authenticated;
select v61_test.val('P24 an alumni_manager with no connection: status says the system sender would send (fallback true, reason user_not_connected)', $q$select (jsonb_typeof(r->'mine') = 'null')::text || '/' || (r->'effective'->>'source') || '/' || (r->'effective'->>'fallback') || '/' || (r->'effective'->>'reason') from (select public.get_google_connection_status() r) x$q$, 'true/system/true/user_not_connected');
select v61_test.val('P25 ... and an empty own list', $q$select count(*)::text from public.list_my_google_connections()$q$, '0');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e614","role":"authenticated"}', true);
set local role authenticated;
select v61_test.fails('P26 a founder is refused by all three client RPCs: list_my', $q$select count(*) from public.list_my_google_connections()$q$, '42501', 'forbidden');
select v61_test.fails('P27 ... status', $q$select public.get_google_connection_status()$q$, '42501', 'forbidden');
select v61_test.fails('P28 ... admin list', $q$select count(*) from public.list_google_connections_admin()$q$, '42501', 'forbidden');
select v61_test.val('P29 and sees nothing through the view', $q$select count(*)::text from public.my_google_connection$q$, '0');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e615","role":"authenticated"}', true);
set local role authenticated;
select v61_test.fails('P30 a user with no role is refused too', $q$select public.get_google_connection_status()$q$, '42501', 'forbidden');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e610","role":"authenticated"}', true);
set local role authenticated;
select v61_test.val('P31 the super_admin''s admin list shows everybody: 3 rows, system first, with owner names', $q$select count(*)::text || '/' || (min(r->>'email') filter (where (r->>'is_system')::boolean)) || '/' || (min(r->>'owner_name') filter (where r->>'email' = 'zz-v61-pm1@athareg.com')) from public.list_google_connections_admin() r$q$, '3/startups@athareg.com/V61 PM One');
select v61_test.val('P32 ... and the admin list has no secret column either', $q$select (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(r) k from public.list_google_connections_admin() r) q)$q$, 'connected_at,email,id,is_system,kind,last_error,last_used_at,owner_email,owner_id,owner_name,status,status_changed_at');
select v61_test.val('P33 the super_admin''s own status: is_super_admin true, the system sender is his effective fallback', $q$select (r->>'is_super_admin') || '/' || (r->'effective'->>'source') from (select public.get_google_connection_status() r) x$q$, 'true/system');
select v61_test.fails('P34 even the super_admin cannot read the Google tables or Vault directly', $q$select count(*) from app_private.google_connections$q$, '42501');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select v61_test.fails('P39 anon: the view', $q$select count(*) from public.my_google_connection$q$, '42501');
reset role;

-- the second line of defence: IF a table privilege were ever granted, the policies still confine a user to his row. Granted here (inside the rolled-back transaction) on the metadata columns only.
grant select (id, owner_user_id, kind, email, status) on app_private.google_connections to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e611","role":"authenticated"}', true);
set local role authenticated;
select v61_test.val('P41 RLS: with a column grant, PM1 still sees only his own row (not PM2, not the system sender)', $q$select count(*)::text || '/' || min(email::text) from app_private.google_connections$q$, '1/zz-v61-pm1@athareg.com');
select v61_test.fails('P42 RLS: the secret reference column stays unreadable even then', $q$select vault_secret_id from app_private.google_connections$q$, '42501');
select v61_test.fails('P43 RLS: so do the storage mode and the account id', $q$select token_storage, google_sub from app_private.google_connections$q$, '42501');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e610","role":"authenticated"}', true);
set local role authenticated;
select v61_test.val('P44 RLS: the super_admin sees all three rows', $q$select count(*)::text from app_private.google_connections$q$, '3');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e611","role":"authenticated"}', true);
set local role authenticated;
select v61_test.val('P45 RLS: a PM never sees the system row (kind = system is not "own")', $q$select count(*)::text from app_private.google_connections where kind = 'system'$q$, '0');
reset role;
revoke select (id, owner_user_id, kind, email, status) on app_private.google_connections from authenticated;
select v61_test.val('P46 the temporary grant is gone', $q$select count(*)::text from information_schema.column_privileges where table_schema = 'app_private' and table_name = 'google_connections' and grantee = 'authenticated'$q$, '0');

-- ================================================================= D. an account that is deleted loses its connection AND its secret
select v61_test.val('D01 before: PM2 has a connection with a ciphertext, PM1 a Vault secret', $q$select v61_test.cipher_n()::text || '/' || v61_test.vault_n()::text$q$, '1/2');
delete from auth.users where id = '00000000-0000-4000-8000-00000000e612';
select v61_test.val('D02 PM2 deleted: the row stays (outbox history), revoked, ownerless, and the ciphertext is gone', $q$select coalesce(v61_test.col((select id from app_private.google_connections where email = 'zz-v61-pm2@athareg.com'), 'status'), 'none')
  || '/' || coalesce(v61_test.col((select id from app_private.google_connections where email = 'zz-v61-pm2@athareg.com'), 'owner_user_id'), 'NULL') || '/' || v61_test.cipher_n()::text$q$, 'revoked/NULL/0');
delete from auth.users where id = '00000000-0000-4000-8000-00000000e611';
select v61_test.val('D03 PM1 deleted: the Vault secret is deleted with it', $q$select v61_test.vault_n()::text || '/' || coalesce(v61_test.col((select id from app_private.google_connections where email = 'zz-v61-pm1@athareg.com'), 'status'), 'none')$q$, '1/revoked');
select v61_test.val('D04 the system sender is untouched', $q$select status from app_private.google_connections where kind = 'system'$q$, 'active');

-- ================================================================= E. compatibility with what existed before (m06d / m34 consumers)
select v61_test.val('E01 get_booking_extras and the booking RPCs still compile against the new vocabulary (needs_reauth is nowhere in SQL)', $q$select count(*)::text from pg_proc where pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) and prosrc like '%needs_reauth%'$q$, '0');
select v61_test.val('E02 no foreign key to google_connections lost its action (outbox RESTRICT, the others SET NULL)', $q$select string_agg(distinct confdeltype::text, ',' order by confdeltype::text) from pg_constraint where confrelid = 'app_private.google_connections'::regclass and contype = 'f' and conrelid <> 'app_private.google_connection_secrets'::regclass$q$, 'n,r');
select v61_test.val('E03 the secrets table cascades with its connection', $q$select confdeltype::text from pg_constraint where conrelid = 'app_private.google_connection_secrets'::regclass and contype = 'f'$q$, 'c');

-- ================================================================= final state check
select current_setting('v61.res', true) as res \gset
rollback;

-- the baseline is back (the whole test ran in a rolled-back transaction)
select (select count(*) from app_private.google_connections) + (select count(*) from app_private.google_oauth_states) + (select count(*) from app_private.google_connection_secrets)
       + (select count(*) from vault.secrets where name like 'google-refresh-token:%') + (select count(*) from auth.users where email like 'zz-v61-%') as leftovers \gset
select :leftovers = 0 as baseline_restored;

-- ================================================================= report
select split_part(line, '|', 1) as status, split_part(line, '|', 2) as check_key, split_part(line, '|', 3) as detail
from regexp_split_to_table(:'res', E'\n') line where line <> '' order by (split_part(line, '|', 1) = 'ok'), 2;
select count(*) filter (where split_part(line, '|', 1) = 'ok') as passed, count(*) filter (where split_part(line, '|', 1) <> 'ok') as failed
from regexp_split_to_table(:'res', E'\n') line where line <> '';
select (count(*) filter (where split_part(line, '|', 1) <> 'ok') > 0 or :leftovers <> 0) as failed from regexp_split_to_table(:'res', E'\n') line where line <> '' \gset
\if :failed
  do $$ begin raise exception 'v61: Google OAuth core tests FAILED'; end $$;
\endif
