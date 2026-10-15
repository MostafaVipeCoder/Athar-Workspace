-- m61_google_oauth.sql  (Google OAuth core for per-PM Gmail + Calendar; owner decision 08 section 20.6; design 07 sections 1-3 and 8)
-- Re-runnable (create ... if not exists / create or replace / drop ... if exists / every data step checks itself). Local DB only.
-- Run AFTER m04 / m05 (google_connections), m06d, m34 and m52. Verify with db/verify/v61_google_oauth.sql.
--
-- WHAT THIS ADDS
--  1. app_private.google_connections is finished: connected_at, last_used_at, google_sub, token_storage ('vault' | 'aes'), status_changed_at, is_system
--     (generated from kind), the status vocabulary is now active | needs_reconnect | revoked (needs_reauth rows are converted), vault_secret_id may be
--     NULL (AES mode / revoked), last_error holds a short CODE only (never a message), one system row, one user connection per owner. The table keeps
--     FORCE ROW LEVEL SECURITY: policies "own row" and "super_admin sees all" are defined as the second line of defence; NO client role holds any table
--     privilege (the schema is closed: every client read goes through the definer RPCs below, which return metadata only).
--  2. app_private.google_connection_secrets (AES-256-GCM ciphertext, written only by the definer RPCs) and app_private.google_oauth_states (single-use,
--     expiring OAuth nonces; only the SHA-256 of the nonce is stored). Neither is granted to any role.
--  3. TOKEN STORAGE behind one interface: Supabase Vault when the extension exists (this image: supabase_vault 0.3.1), else the AES ciphertext produced by the
--     edge function (key in the function secret TOKEN_ENC_KEY). The refresh token never appears in any RPC result that a client role can call, in a view,
--     in last_error or in a log line; the only reader is google_secret_get, executable by service_role only.
--  4. SERVICE-ROLE RPCs for the edge functions (SECURITY DEFINER, search_path = '', EXECUTE for service_role only):
--       google_storage_capabilities, google_oauth_begin, google_oauth_consume, google_connection_upsert (a user's own connection), set_system_connection
--       (the startups@ sender, super_admin only), google_secret_get, google_connection_lookup, google_connection_mark (active | needs_reconnect | revoked; revoked
--       deletes the secret), google_connection_touch, resolve_sender_connection(user_id).
--  5. CLIENT RPCs (authenticated staff): list_my_google_connections, get_google_connection_status (mine + the system sender + which one would send now),
--     list_google_connections_admin (super_admin: everybody's metadata).
--  6. app_private.resolve_sender_connection(user_id) = the acting user's active connection, else the system one, else NULL (decision 07-3). m62 / m63 call it.
--
-- NULL SAFETY: every guard is written so that a NULL argument can never be "not false": `p_x is null or ...` first, `coalesce(..., false)` around every
-- boolean that may be NULL, `is distinct from` instead of `<>` on nullable columns (the m43 / m52 reviews found three-valued-logic holes in IF guards).
-- Error tokens (message prefix = hint): forbidden (42501), too_many_attempts (P0001), google_invalid (22023, detail field:reason), email_in_use (P0001),
-- missing_scopes (22023), storage_unavailable (P0001), no_secret (P0001).
set search_path = public, extensions;

begin;

-- ================================================================= 1. google_connections: the finished shape
alter table app_private.google_connections add column if not exists connected_at timestamptz not null default now();
alter table app_private.google_connections add column if not exists last_used_at timestamptz;
alter table app_private.google_connections add column if not exists google_sub text;
alter table app_private.google_connections add column if not exists token_storage text not null default 'vault';
alter table app_private.google_connections add column if not exists status_changed_at timestamptz not null default now();
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'google_connections' and column_name = 'is_system') then
    alter table app_private.google_connections add column is_system boolean generated always as (kind = 'system') stored;
  end if;
end $$;
alter table app_private.google_connections alter column vault_secret_id drop not null;

-- status vocabulary: needs_reauth (m04) -> needs_reconnect
alter table app_private.google_connections drop constraint if exists google_connections_status_check;
update app_private.google_connections set status = 'needs_reconnect' where status = 'needs_reauth';
alter table app_private.google_connections add constraint google_connections_status_check check (status in ('active', 'needs_reconnect', 'revoked'));

alter table app_private.google_connections drop constraint if exists google_connections_storage_check;
alter table app_private.google_connections add constraint google_connections_storage_check check (token_storage in ('vault', 'aes'));
alter table app_private.google_connections drop constraint if exists google_connections_secret_ref_check;
alter table app_private.google_connections add constraint google_connections_secret_ref_check check (status = 'revoked' or token_storage = 'aes' or vault_secret_id is not null);
alter table app_private.google_connections drop constraint if exists google_connections_last_error_check;
alter table app_private.google_connections add constraint google_connections_last_error_check check (last_error is null or last_error ~ '^[a-z][a-z0-9_.:-]{0,63}$');
alter table app_private.google_connections drop constraint if exists google_connections_system_owner_check;
alter table app_private.google_connections add constraint google_connections_system_owner_check check (kind <> 'system' or owner_user_id is null);

-- one system sender, one connection per user
create unique index if not exists google_connections_one_system_idx on app_private.google_connections ((true)) where kind = 'system';
create unique index if not exists google_connections_one_per_owner_idx on app_private.google_connections (owner_user_id) where kind = 'user' and owner_user_id is not null;
create index if not exists google_connections_status_idx on app_private.google_connections (status);

-- the ciphertext of the AES mode: its own table, so google_connections stays metadata only
create table if not exists app_private.google_connection_secrets (
  connection_id uuid primary key references app_private.google_connections(id) on delete cascade,
  ciphertext    text not null check (octet_length(ciphertext) between 40 and 4096),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- single-use OAuth nonces (only the SHA-256 of the nonce is stored)
create table if not exists app_private.google_oauth_states (
  nonce_hash  text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid not null references auth.users(id) on delete cascade,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index if not exists google_oauth_states_open_idx on app_private.google_oauth_states (user_id, expires_at) where consumed_at is null;
create index if not exists google_oauth_states_expiry_idx on app_private.google_oauth_states (expires_at);

-- RLS + grants: nobody but the definer functions (owned by postgres, BYPASSRLS) touches these tables
alter table app_private.google_connections enable row level security;
alter table app_private.google_connections force row level security;
alter table app_private.google_connection_secrets enable row level security;
alter table app_private.google_connection_secrets force row level security;
alter table app_private.google_oauth_states enable row level security;
alter table app_private.google_oauth_states force row level security;
revoke all on app_private.google_connections, app_private.google_connection_secrets, app_private.google_oauth_states from public, anon, authenticated, service_role;

-- the second line of defence (inert while no role holds a privilege): a user reads only his own metadata, a super_admin reads all
drop policy if exists google_connections_select_own on app_private.google_connections;
create policy google_connections_select_own on app_private.google_connections for select to authenticated
  using (kind = 'user' and owner_user_id = (select auth.uid()));
drop policy if exists google_connections_select_admin on app_private.google_connections;
create policy google_connections_select_admin on app_private.google_connections for select to authenticated
  using ((select app_private.is_super_admin()));

-- ================================================================= 2. internal helpers (never callable by a client role)
create or replace function app_private.google_user_is_staff(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (select 1 from public.user_roles r join public.roles ro on ro.key = r.role_key where r.user_id = p_user and ro.is_staff)
$$;

create or replace function app_private.google_user_is_super_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (select 1 from public.user_roles r where r.user_id = p_user and r.role_key = 'super_admin')
$$;

create or replace function app_private.google_vault_available() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_extension where extname = 'supabase_vault') and to_regprocedure('vault.create_secret(text,text,text,uuid)') is not null
$$;

-- deletes the stored secret objects of a connection (Vault row + AES ciphertext). The CALLER fixes the columns in the same statement.
create or replace function app_private.google_delete_secret(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_vault uuid;
begin
  if p_connection is null then return; end if;
  select c.vault_secret_id into v_vault from app_private.google_connections c where c.id = p_connection;
  if v_vault is not null and app_private.google_vault_available() then
    delete from vault.secrets where id = v_vault;
  end if;
  delete from app_private.google_connection_secrets where connection_id = p_connection;
end $$;

-- the acting user's usable connection, else the system one, else nothing; `reason` says why the user's own was not used
create or replace function app_private.google_resolve_sender(p_user uuid) returns table (connection_id uuid, source text, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_need text[] := array['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events'];
  v_own_id uuid; v_own_status text; v_own_usable boolean := false; v_sys uuid; v_reason text;
begin
  select c.id, c.status, (c.status = 'active' and c.scopes @> v_need and (c.token_storage = 'aes' or c.vault_secret_id is not null))
    into v_own_id, v_own_status, v_own_usable
    from app_private.google_connections c
   where p_user is not null and c.kind = 'user' and c.owner_user_id = p_user
   order by (c.status = 'active') desc, c.status_changed_at desc limit 1;
  if v_own_id is not null and coalesce(v_own_usable, false) then
    connection_id := v_own_id; source := 'user'; reason := null; return next; return;
  end if;
  v_reason := case when v_own_id is null or v_own_status = 'revoked' then 'user_not_connected' else 'user_needs_reconnect' end;
  select c.id into v_sys from app_private.google_connections c
   where c.kind = 'system' and c.status = 'active' and c.scopes @> v_need and (c.token_storage = 'aes' or c.vault_secret_id is not null) limit 1;
  if v_sys is not null then
    connection_id := v_sys; source := 'system'; reason := v_reason; return next; return;
  end if;
  connection_id := null; source := null;
  reason := case when v_reason = 'user_needs_reconnect' then 'user_needs_reconnect_no_system' else 'no_connection' end;
  return next;
end $$;

-- THE function m62 (e-mail worker) and m63 (calendar sync) call: acting PM's active connection, else the system one, else NULL
create or replace function app_private.resolve_sender_connection(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.connection_id from app_private.google_resolve_sender(p_user) r
$$;

-- the whole write path of a connection (user or system) in one place: validated, atomic, one secret
create or replace function app_private.google_store_connection(p_kind text, p_owner uuid, p_email text, p_google_sub text, p_scopes text[], p_storage text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_need text[] := array['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events'];
  v_email text; v_row app_private.google_connections; v_clash app_private.google_connections; v_id uuid; v_vault uuid;
begin
  if p_kind is null or p_kind not in ('user', 'system') or (p_kind = 'user' and p_owner is null) then
    raise exception 'google_invalid: kind / owner' using errcode = '22023', hint = 'google_invalid', detail = 'kind:invalid';
  end if;
  if p_email is null or length(p_email) > 254 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'google_invalid: e-mail' using errcode = '22023', hint = 'google_invalid', detail = 'email:invalid';
  end if;
  if p_scopes is null or not (p_scopes @> v_need) then
    raise exception 'missing_scopes: both Gmail send and Calendar events must be granted' using errcode = '22023', hint = 'missing_scopes';
  end if;
  if p_storage is null or p_storage not in ('vault', 'aes') then
    raise exception 'google_invalid: storage' using errcode = '22023', hint = 'google_invalid', detail = 'storage:invalid';
  end if;
  if p_secret is null or length(p_secret) < 1 or length(p_secret) > 4096 then
    raise exception 'google_invalid: secret' using errcode = '22023', hint = 'google_invalid', detail = 'secret:invalid';
  end if;
  if p_storage = 'vault' and not app_private.google_vault_available() then
    raise exception 'storage_unavailable: Supabase Vault is not installed' using errcode = 'P0001', hint = 'storage_unavailable';
  end if;
  -- AES mode stores ONLY the blob the edge function encrypted (v1.<key id>.<iv>.<ciphertext>): a plain token is refused
  if p_storage = 'aes' and p_secret !~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    raise exception 'google_invalid: the AES secret is not an encrypted blob' using errcode = '22023', hint = 'google_invalid', detail = 'secret:not_encrypted';
  end if;
  v_email := lower(p_email);
  perform pg_advisory_xact_lock(hashtextextended('google_connection:' || coalesce(p_owner::text, 'system'), 0));

  if p_kind = 'system' then
    select * into v_row from app_private.google_connections c where c.kind = 'system' for update;
  else
    select * into v_row from app_private.google_connections c where c.kind = 'user' and c.owner_user_id = p_owner for update;
  end if;
  select * into v_clash from app_private.google_connections c where c.email::text = v_email for update;
  if v_clash.id is not null and v_clash.id is distinct from v_row.id then
    -- the e-mail already belongs to another row: only a REVOKED row of the same kind may be taken over (same mailbox, same history)
    if v_clash.kind is distinct from p_kind or v_clash.status <> 'revoked' then
      raise exception 'email_in_use: this Google account is already connected' using errcode = 'P0001', hint = 'email_in_use';
    end if;
    if v_row.id is not null then
      update app_private.google_connections set owner_user_id = null where id = v_row.id and kind = 'user';
    end if;
    v_row := v_clash;
  end if;

  if v_row.id is not null then
    perform app_private.google_delete_secret(v_row.id);
    v_id := v_row.id;
  else
    v_id := gen_random_uuid();
  end if;
  if p_storage = 'vault' then
    v_vault := vault.create_secret(p_secret, 'google-refresh-token:' || v_id::text, 'Google refresh token (m61)', null);
  end if;

  if v_row.id is null then
    insert into app_private.google_connections (id, owner_user_id, kind, email, scopes, vault_secret_id, status, last_ok_at, last_error, connected_at, last_used_at, google_sub, token_storage, status_changed_at)
    values (v_id, case when p_kind = 'user' then p_owner end, p_kind, v_email, p_scopes, v_vault, 'active', null, null, now(), null, p_google_sub, p_storage, now());
  else
    update app_private.google_connections
       set owner_user_id = case when p_kind = 'user' then p_owner end, email = v_email, scopes = p_scopes, vault_secret_id = v_vault, status = 'active', last_ok_at = null,
           last_error = null, connected_at = now(), google_sub = p_google_sub, token_storage = p_storage, status_changed_at = now()
     where id = v_id;
  end if;
  if p_storage = 'aes' then
    insert into app_private.google_connection_secrets (connection_id, ciphertext) values (v_id, p_secret)
    on conflict (connection_id) do update set ciphertext = excluded.ciphertext, updated_at = now();
  end if;
  return jsonb_build_object('connection_id', v_id, 'kind', p_kind, 'email', v_email, 'status', 'active', 'token_storage', p_storage);
end $$;

-- a user whose account is deleted loses the connection: FK ON DELETE SET NULL turns owner_user_id NULL; the secret goes with it
create or replace function app_private.google_connections_owner_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.owner_user_id is not null and new.owner_user_id is null and new.kind = 'user' and new.status <> 'revoked' then
    perform app_private.google_delete_secret(new.id);
    new.vault_secret_id := null;
    new.status := 'revoked';
    new.last_error := null;
    new.status_changed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists google_connections_bu_owner_gone on app_private.google_connections;
create trigger google_connections_bu_owner_gone before update of owner_user_id on app_private.google_connections
  for each row execute function app_private.google_connections_owner_gone();

-- ================================================================= 3. service-role RPCs (the edge functions)
create or replace function public.google_storage_capabilities() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('vault', app_private.google_vault_available())
$$;

-- google-oauth-start: record a single-use nonce for a staff user (super_admin for the system sender)
create or replace function public.google_oauth_begin(p_user uuid, p_nonce_hash text, p_is_system boolean, p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_system boolean := coalesce(p_is_system, false); v_open integer;
begin
  if p_user is null or p_nonce_hash is null or p_expires_at is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'google_invalid: state' using errcode = '22023', hint = 'google_invalid', detail = 'state:invalid';
  end if;
  if not app_private.google_user_is_staff(p_user) or (v_system and not app_private.google_user_is_super_admin(p_user)) then
    raise exception 'forbidden' using errcode = '42501', hint = 'forbidden';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then
    raise exception 'google_invalid: expiry' using errcode = '22023', hint = 'google_invalid', detail = 'expires_at:invalid';
  end if;
  delete from app_private.google_oauth_states where nonce_hash in (select s.nonce_hash from app_private.google_oauth_states s where s.expires_at < now() - interval '1 day' limit 200);
  select count(*) into v_open from app_private.google_oauth_states s where s.user_id = p_user and s.consumed_at is null and s.expires_at > now();
  if v_open >= 20 then
    raise exception 'too_many_attempts: finish or wait for the open connect attempts' using errcode = 'P0001', hint = 'too_many_attempts';
  end if;
  insert into app_private.google_oauth_states (nonce_hash, user_id, is_system, expires_at) values (p_nonce_hash, p_user, v_system, p_expires_at);
  return jsonb_build_object('ok', true);
exception when unique_violation then
  raise exception 'google_invalid: state' using errcode = '22023', hint = 'google_invalid', detail = 'state:replayed';
end $$;

-- google-oauth-callback: consume the nonce ONCE (atomic UPDATE ... WHERE consumed_at IS NULL); NULL = unknown / used / expired / no longer allowed
create or replace function public.google_oauth_consume(p_nonce_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_system boolean;
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  update app_private.google_oauth_states s set consumed_at = now()
   where s.nonce_hash = p_nonce_hash and s.consumed_at is null and s.expires_at > now()
  returning s.user_id, s.is_system into v_user, v_system;
  if v_user is null then return null; end if;
  -- the rights are checked AGAIN now: a role removed between start and callback ends the attempt
  if not app_private.google_user_is_staff(v_user) or (coalesce(v_system, false) and not app_private.google_user_is_super_admin(v_user)) then return null; end if;
  return jsonb_build_object('user_id', v_user, 'is_system', coalesce(v_system, false),
    'user_email', (select lower(u.email::text) from auth.users u where u.id = v_user), 'is_super_admin', app_private.google_user_is_super_admin(v_user));
end $$;

-- a staff user stores THEIR OWN connection (the actor must be the owner)
create or replace function public.google_connection_upsert(p_owner uuid, p_actor uuid, p_email text, p_google_sub text, p_scopes text[], p_storage text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is null or p_actor is null or p_owner is distinct from p_actor or not app_private.google_user_is_staff(p_actor) then
    raise exception 'forbidden' using errcode = '42501', hint = 'forbidden';
  end if;
  return app_private.google_store_connection('user', p_owner, p_email, p_google_sub, p_scopes, p_storage, p_secret);
end $$;

-- the system sender (startups@athareg.com): super_admin only; there is ONE system row, re-linking replaces its secret
create or replace function public.set_system_connection(p_actor uuid, p_email text, p_google_sub text, p_scopes text[], p_storage text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not app_private.google_user_is_super_admin(p_actor) then
    raise exception 'forbidden' using errcode = '42501', hint = 'forbidden';
  end if;
  return app_private.google_store_connection('system', null, p_email, p_google_sub, p_scopes, p_storage, p_secret);
end $$;

-- THE ONLY reader of a token: { storage, value, email } (value = the Vault plaintext or the AES blob); NULL when there is nothing to read
create or replace function public.google_secret_get(p_connection uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c app_private.google_connections; v_value text;
begin
  if p_connection is null then return null; end if;
  select * into c from app_private.google_connections x where x.id = p_connection;
  if c.id is null or c.status = 'revoked' then return null; end if;
  if c.token_storage = 'vault' then
    if c.vault_secret_id is null or not app_private.google_vault_available() then return null; end if;
    select d.decrypted_secret into v_value from vault.decrypted_secrets d where d.id = c.vault_secret_id;
  else
    select s.ciphertext into v_value from app_private.google_connection_secrets s where s.connection_id = c.id;
  end if;
  if v_value is null then return null; end if;
  return jsonb_build_object('storage', c.token_storage, 'value', v_value, 'email', c.email::text);
end $$;

-- disconnect: which connection does this user mean? (system = the startups@ row, super_admin only). Metadata only.
create or replace function public.google_connection_lookup(p_user uuid, p_system boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c app_private.google_connections;
begin
  if p_user is null or not app_private.google_user_is_staff(p_user) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  if coalesce(p_system, false) then
    if not app_private.google_user_is_super_admin(p_user) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
    select * into c from app_private.google_connections x where x.kind = 'system';
  else
    select * into c from app_private.google_connections x where x.kind = 'user' and x.owner_user_id = p_user;
  end if;
  if c.id is null then return null; end if;
  return jsonb_build_object('id', c.id, 'status', c.status, 'email', c.email::text, 'token_storage', c.token_storage);
end $$;

-- the state changes: needs_reconnect (a refresh answered invalid_grant), revoked (disconnect: the secret is DELETED), active (only with a secret). A CODE, never a message.
create or replace function public.google_connection_mark(p_connection uuid, p_status text, p_error text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c app_private.google_connections; v_err text := case when p_error is not null and p_error ~ '^[a-z][a-z0-9_.:-]{0,63}$' then p_error end;
begin
  if p_connection is null or p_status is null or p_status not in ('active', 'needs_reconnect', 'revoked') then
    raise exception 'google_invalid: status' using errcode = '22023', hint = 'google_invalid', detail = 'status:invalid';
  end if;
  select * into c from app_private.google_connections x where x.id = p_connection for update;
  if c.id is null then return null; end if;
  if p_status = 'revoked' then
    perform app_private.google_delete_secret(c.id);
    update app_private.google_connections set status = 'revoked', vault_secret_id = null, last_error = null, status_changed_at = now() where id = c.id;
  elsif p_status = 'needs_reconnect' then
    if c.status = 'revoked' then return jsonb_build_object('ok', true, 'status', 'revoked'); end if; -- a disconnected account stays disconnected
    update app_private.google_connections set status = 'needs_reconnect', last_error = coalesce(v_err, 'needs_reconnect'), status_changed_at = case when status = 'needs_reconnect' then status_changed_at else now() end where id = c.id;
  else
    if c.status = 'revoked' or not (c.token_storage = 'aes' and exists (select 1 from app_private.google_connection_secrets s where s.connection_id = c.id) or c.token_storage = 'vault' and c.vault_secret_id is not null) then
      raise exception 'no_secret: connect Google again' using errcode = 'P0001', hint = 'no_secret';
    end if;
    update app_private.google_connections set status = 'active', last_error = null, status_changed_at = case when status = 'active' then status_changed_at else now() end where id = c.id;
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- the workers call it after a successful use
create or replace function public.google_connection_touch(p_connection uuid) returns void
language sql security definer set search_path = '' as $$
  update app_private.google_connections set last_used_at = now(), last_ok_at = now(), last_error = null where id = p_connection and status = 'active'
$$;

create or replace function public.resolve_sender_connection(p_user_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select app_private.resolve_sender_connection(p_user_id)
$$;

-- ================================================================= 4. client RPCs (authenticated staff): metadata only
create or replace function public.list_my_google_connections() returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not app_private.google_user_is_staff(v_uid) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  return query
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'is_system', c.is_system, 'email', c.email::text, 'scopes', to_jsonb(c.scopes), 'status', c.status, 'last_error', c.last_error,
                              'connected_at', c.connected_at, 'last_used_at', c.last_used_at, 'status_changed_at', c.status_changed_at)
      from app_private.google_connections c
     where c.kind = 'user' and c.owner_user_id = v_uid
     order by c.connected_at desc;
end $$;

create or replace function public.get_google_connection_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_mine jsonb; v_sys jsonb; v_res record; v_eff_email text;
begin
  if v_uid is null or not app_private.google_user_is_staff(v_uid) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  select jsonb_build_object('id', c.id, 'email', c.email::text, 'status', c.status, 'last_error', c.last_error, 'connected_at', c.connected_at, 'last_used_at', c.last_used_at,
                            'scopes_ok', c.scopes @> array['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events'])
    into v_mine from app_private.google_connections c where c.kind = 'user' and c.owner_user_id = v_uid and c.status <> 'revoked';
  select jsonb_build_object('email', c.email::text, 'status', c.status, 'connected_at', c.connected_at, 'last_used_at', c.last_used_at)
    into v_sys from app_private.google_connections c where c.kind = 'system' and c.status <> 'revoked';
  select * into v_res from app_private.google_resolve_sender(v_uid);
  select c.email::text into v_eff_email from app_private.google_connections c where c.id = v_res.connection_id;
  return jsonb_build_object('mine', v_mine, 'system', v_sys,
    'effective', jsonb_build_object('source', v_res.source, 'email', v_eff_email, 'fallback', coalesce(v_res.source = 'system', false), 'reason', v_res.reason),
    'is_super_admin', app_private.google_user_is_super_admin(v_uid));
end $$;

create or replace function public.list_google_connections_admin() returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select app_private.is_super_admin()), false) then raise exception 'forbidden' using errcode = '42501', hint = 'forbidden'; end if;
  return query
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'is_system', c.is_system, 'email', c.email::text, 'status', c.status, 'last_error', c.last_error,
                              'connected_at', c.connected_at, 'last_used_at', c.last_used_at, 'status_changed_at', c.status_changed_at,
                              'owner_id', c.owner_user_id, 'owner_name', p.full_name, 'owner_email', u.email::text)
      from app_private.google_connections c
      left join auth.users u on u.id = c.owner_user_id
      left join public.profiles p on p.id = c.owner_user_id
     order by c.is_system desc, lower(c.email::text);
end $$;

-- the m06d view of the caller's own connection: metadata only, now with the new columns at the end (no token column exists on the table any more than before)
create or replace view public.my_google_connection with (security_barrier = true) as
select c.id, c.email::text as email, c.kind, c.scopes, c.status, c.last_ok_at, c.last_error, c.created_at, c.connected_at, c.last_used_at
from app_private.google_connections c where c.owner_user_id = (select auth.uid());

-- ================================================================= 5. grants: service-role functions are closed to every client role
do $$
declare f regprocedure;
begin
  foreach f in array array[
    'app_private.google_user_is_staff(uuid)'::regprocedure, 'app_private.google_user_is_super_admin(uuid)'::regprocedure, 'app_private.google_vault_available()'::regprocedure,
    'app_private.google_delete_secret(uuid)'::regprocedure, 'app_private.google_resolve_sender(uuid)'::regprocedure, 'app_private.resolve_sender_connection(uuid)'::regprocedure,
    'app_private.google_store_connection(text,uuid,text,text,text[],text,text)'::regprocedure, 'app_private.google_connections_owner_gone()'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.google_storage_capabilities()'::regprocedure, 'public.google_oauth_begin(uuid,text,boolean,timestamptz)'::regprocedure, 'public.google_oauth_consume(text)'::regprocedure,
    'public.google_connection_upsert(uuid,uuid,text,text,text[],text,text)'::regprocedure, 'public.set_system_connection(uuid,text,text,text[],text,text)'::regprocedure,
    'public.google_secret_get(uuid)'::regprocedure, 'public.google_connection_lookup(uuid,boolean)'::regprocedure, 'public.google_connection_mark(uuid,text,text)'::regprocedure,
    'public.google_connection_touch(uuid)'::regprocedure, 'public.resolve_sender_connection(uuid)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.list_my_google_connections()'::regprocedure, 'public.get_google_connection_status()'::regprocedure, 'public.list_google_connections_admin()'::regprocedure] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on public.my_google_connection from public, anon;
grant select on public.my_google_connection to authenticated;

-- ================================================================= self-check
do $$
begin
  if exists (select 1 from app_private.google_connections where status not in ('active', 'needs_reconnect', 'revoked')) then raise exception 'm61: a connection has an unknown status'; end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('google_storage_capabilities', 'google_oauth_begin', 'google_oauth_consume',
      'google_connection_upsert', 'set_system_connection', 'google_secret_get', 'google_connection_lookup', 'google_connection_mark', 'google_connection_touch', 'resolve_sender_connection',
      'list_my_google_connections', 'get_google_connection_status', 'list_google_connections_admin') and p.prosecdef and 'search_path=""' = any(p.proconfig)) <> 13 then
    raise exception 'm61: a function is missing or lacks SECURITY DEFINER / search_path = ''''';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'app_private' and table_name in ('google_connections', 'google_connection_secrets', 'google_oauth_states') and grantee in ('anon', 'authenticated', 'service_role', 'public')) then
    raise exception 'm61: a client role holds a privilege on a Google table';
  end if;
end $$;

commit;
