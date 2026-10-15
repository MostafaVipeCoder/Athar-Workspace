// Wiring for the Edge Runtime, still free of Deno-only APIs: the entry points pass `Deno.env`, supabase-js' `createClient` and
// (optionally) a fetch. Everything the functions need from the database goes through SERVICE-ROLE-ONLY RPCs of schema public
// (m61); PostgREST exposes no other schema, and the token tables are not reachable any other way.
//
//   google_storage_capabilities()  google_oauth_begin()  google_oauth_consume()  google_connection_upsert()
//   google_secret_get()  google_connection_lookup()  google_connection_mark()  google_connection_touch()  resolve_sender_connection()

import { ConfigError, chooseStorageMode, createAccessTokenProvider, createKeyring, createTokenStore, getGoogleConfig } from './google-core.js'
import { createHandlers } from './google-oauth-handlers.js'

export class DbError extends Error {
  constructor(token, { code = null, status = null } = {}) {
    super(token || 'db_error')
    this.name = 'DbError'
    this.token = token || 'db_error'
    this.code = code
    this.status = status
  }
}

/** The token a SQL function raised: `hint`, else the `token:` prefix of the message. Never the message itself. */
function tokenFromError(error) {
  const hint = String(error?.hint ?? '')
  if (/^[a-z][a-z0-9_]{2,40}$/.test(hint)) return hint
  const m = /^([a-z][a-z0-9_]{2,40}):/.exec(String(error?.message ?? ''))
  if (m) return m[1]
  return String(error?.code) === '42501' ? 'forbidden' : 'db_error'
}

/** The exact argument names of every service-role RPC (m61). tests/rpc-contract.test.js compares them with the SQL signatures. */
export const RPC_CONTRACT = Object.freeze({
  google_storage_capabilities: [],
  google_oauth_begin: ['p_user', 'p_nonce_hash', 'p_is_system', 'p_expires_at'],
  google_oauth_consume: ['p_nonce_hash'],
  google_connection_upsert: ['p_owner', 'p_actor', 'p_email', 'p_google_sub', 'p_scopes', 'p_storage', 'p_secret'],
  set_system_connection: ['p_actor', 'p_email', 'p_google_sub', 'p_scopes', 'p_storage', 'p_secret'],
  google_secret_get: ['p_connection'],
  google_connection_lookup: ['p_user', 'p_system'],
  google_connection_mark: ['p_connection', 'p_status', 'p_error'],
  google_connection_touch: ['p_connection'],
  resolve_sender_connection: ['p_user_id'],
})

/** Service-role adapter over a supabase-js client (or anything with `rpc(name, args) -> { data, error }`). */
export function createRpcDb(client) {
  async function call(fn, args = {}) {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new DbError(tokenFromError(error), { code: error.code ?? null, status: error.status ?? null })
    return data
  }
  return {
    storageCapabilities: () => call('google_storage_capabilities'),
    oauthBegin: ({ userId, nonceHash, isSystem, expiresAt }) => call('google_oauth_begin', { p_user: userId, p_nonce_hash: nonceHash, p_is_system: Boolean(isSystem), p_expires_at: expiresAt }),
    oauthConsume: ({ nonceHash }) => call('google_oauth_consume', { p_nonce_hash: nonceHash }),
    // a user's own connection, or (super_admin only, re-checked in SQL) the system sender: two RPCs, two authorisation rules
    upsertConnection: ({ ownerUserId, actorId, isSystem, email, googleSub, scopes, storage, secret }) =>
      isSystem
        ? call('set_system_connection', { p_actor: actorId, p_email: email, p_google_sub: googleSub ?? null, p_scopes: scopes, p_storage: storage, p_secret: secret })
        : call('google_connection_upsert', { p_owner: ownerUserId ?? null, p_actor: actorId, p_email: email, p_google_sub: googleSub ?? null, p_scopes: scopes, p_storage: storage, p_secret: secret }),
    getSecret: (connectionId) => call('google_secret_get', { p_connection: connectionId }),
    lookupConnection: ({ userId, system }) => call('google_connection_lookup', { p_user: userId, p_system: Boolean(system) }),
    markConnection: (connectionId, status, errorCode = null) => call('google_connection_mark', { p_connection: connectionId, p_status: status, p_error: errorCode }),
    touchConnection: (connectionId) => call('google_connection_touch', { p_connection: connectionId }),
    resolveSender: (userId) => call('resolve_sender_connection', { p_user_id: userId }),
  }
}

const once = (fn) => {
  let v
  let done = false
  return () => {
    if (!done) { v = fn(); done = true }
    return v
  }
}

/**
 * Everything an entry point needs: the service-role client, the db adapter, the token store (Vault or AES, decided at runtime
 * from TOKEN_STORAGE + what the database reports), an access-token provider for the workers, and the three handlers.
 * `env` = Deno.env (or { get }); `createClient` = supabase-js.
 */
export function createEdgeRuntime({ env, createClient, fetch: fetchImpl = fetch, now = () => Date.now(), log = undefined }) {
  const getConfig = once(() => getGoogleConfig(env))
  const client = once(() => {
    const url = env.get('SUPABASE_URL')
    const key = env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new ConfigError('missing_env', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  })
  const db = createRpcDb({ rpc: (...a) => client().rpc(...a) })

  async function authenticate(req) {
    const h = req.headers.get('authorization') ?? ''
    const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(h)
    if (!m) return null
    const { data, error } = await client().auth.getUser(m[1])
    if (error || !data?.user?.id) return null
    return { userId: data.user.id, email: data.user.email ?? null }
  }

  let store = null
  async function getStore() {
    if (store) return store
    const cfg = getConfig()
    const hasKey = Boolean(String(env.get('TOKEN_ENC_KEY') ?? '').trim())
    const caps = await db.storageCapabilities()
    const mode = chooseStorageMode({ preferred: cfg.tokenStorage, vaultAvailable: caps?.vault === true, hasEncKey: hasKey })
    const keyring = hasKey ? await createKeyring(env) : null
    store = createTokenStore({ db, mode, keyring })
    return store
  }

  const handlers = createHandlers({ getConfig, authenticate, db, getStore, fetch: fetchImpl, now, log })
  return {
    ...handlers,
    getConfig,
    db,
    getStore,
    /** For the e-mail worker and the calendar sync: access tokens by connection id (in memory only). */
    accessTokens: () => createAccessTokenProvider({ cfg: getConfig(), db, store: { load: async (id) => (await getStore()).load(id) }, fetch: fetchImpl, now }),
  }
}
