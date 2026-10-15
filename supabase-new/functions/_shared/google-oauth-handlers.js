// The three OAuth endpoints as dependency-injected handlers (design 07 section 1.4): google-oauth-start, google-oauth-callback,
// google-disconnect. The Deno entry points (functions/<name>/index.ts) only wire real dependencies; everything that decides
// something lives here so it can be tested with node --test against the fake Google server and an in-memory database.
//
// deps = {
//   getConfig(): Config            (google-core getGoogleConfig; may throw ConfigError)
//   authenticate(req): { userId, email } | null      (verifies the caller's JWT)
//   db: service-role adapter (google-edge.js createRpcDb)
//   getStore(): Promise<TokenStore>                  (vault or aes, chosen at runtime)
//   fetch, now(), rand(n), log(event, fields)
// }
//
// What never happens here: a token, the client secret, the state, the code or a ciphertext in a log line, an error message or a
// response body; an unvalidated request value reflected anywhere (the redirect target is the configured APP_URL + a path
// that came out of the signed state and was sanitised twice; the `reason` is always one of REASONS).

import {
  ConfigError, GoogleError, REQUIRED_SCOPES, buildAuthUrl, codeChallengeS256, decodeIdTokenClaims, deriveCodeVerifier, exchangeCode, hasRequiredScopes,
  newNonce, nonceHash, revokeToken, safeLog, sanitizeReturnPath, signState, validateIdTokenClaims, verifyState,
} from './google-core.js'

/** The complete set of `reason` values the callback can put in the redirect. */
export const REASONS = Object.freeze([
  'access_denied', 'invalid_state', 'state_expired', 'state_replayed', 'exchange_failed', 'id_token_invalid', 'email_unverified', 'wrong_domain',
  'email_mismatch', 'wrong_system_account', 'missing_scopes', 'no_refresh_token', 'email_in_use', 'forbidden', 'server_error', 'not_configured',
])

const DEFAULT_RETURN = '/profile'
const MAX_BODY = 2048

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })

/** CORS for the browser-called functions: only an origin from ALLOWED_ORIGINS (default: the app's own origin) is echoed. */
function corsHeaders(req, cfg) {
  const origin = req.headers.get('origin')
  const h = { vary: 'Origin' }
  if (origin && cfg?.allowedOrigins?.includes(origin)) {
    h['access-control-allow-origin'] = origin
    h['access-control-allow-headers'] = 'authorization, content-type, apikey, x-client-info'
    h['access-control-allow-methods'] = 'POST, OPTIONS'
    h['access-control-max-age'] = '600'
  }
  return h
}

async function readJsonBody(req) {
  const text = await req.text()
  if (text.length > MAX_BODY) return { ok: false }
  if (!text.trim()) return { ok: true, body: {} }
  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' && !Array.isArray(body) ? { ok: true, body } : { ok: false }
  } catch {
    return { ok: false }
  }
}

function tokenOf(e) {
  return typeof e?.token === 'string' ? e.token : typeof e?.hint === 'string' ? e.hint : ''
}

export function createHandlers(deps) {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((event, fields) => safeLog(event, fields))
  const fetchImpl = deps.fetch ?? fetch

  function loadConfig() {
    try {
      return { cfg: deps.getConfig() }
    } catch (e) {
      log('google_config_error', { code: e instanceof ConfigError ? e.code : 'unknown', missing: e instanceof ConfigError ? e.missing.join(',') : '' })
      return { cfg: null }
    }
  }

  // ---------------------------------------------------------------------------------------------- google-oauth-start
  async function start(req) {
    const { cfg } = loadConfig()
    const cors = corsHeaders(req, cfg)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors)
    if (!cfg) return json({ error: 'not_configured' }, 503, cors)
    try {
      const user = await deps.authenticate(req)
      if (!user?.userId) return json({ error: 'unauthenticated' }, 401, cors)
      const parsed = await readJsonBody(req)
      if (!parsed.ok) return json({ error: 'bad_request' }, 400, cors)
      const system = parsed.body.system === true
      const returnTo = sanitizeReturnPath(parsed.body.returnTo, DEFAULT_RETURN)

      const nonce = newNonce(deps.rand)
      const verifier = await deriveCodeVerifier(cfg.stateSecret, nonce)
      const challenge = await codeChallengeS256(verifier)
      const state = await signState({ secret: cfg.stateSecret, userId: user.userId, nonce, challenge, system, returnTo, now: now(), ttlSec: cfg.stateTtlSec })
      // the database re-checks the role (staff; super_admin for `system`) and records the nonce so it can be used ONCE
      await deps.db.oauthBegin({ userId: user.userId, nonceHash: await nonceHash(nonce), isSystem: system, expiresAt: new Date(now() + cfg.stateTtlSec * 1000).toISOString() })
      const url = buildAuthUrl(cfg, { state, challenge, loginHint: system ? null : user.email ?? null, system })
      log('google_oauth_start', { user: user.userId, system })
      return json({ url, system, expires_in: cfg.stateTtlSec }, 200, cors)
    } catch (e) {
      const t = tokenOf(e)
      if (t === 'forbidden') return json({ error: 'forbidden' }, 403, cors)
      if (t === 'too_many_attempts') return json({ error: 'too_many_attempts' }, 429, cors)
      log('google_oauth_start_error', { code: e?.code ?? t ?? 'unknown' })
      return json({ error: 'server_error' }, 500, cors)
    }
  }

  // ---------------------------------------------------------------------------------------------- google-oauth-callback
  async function callback(req) {
    const { cfg } = loadConfig()
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } })
    if (!cfg) return new Response('Google integration is not configured.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

    const redirect = (ret, ok, reason = null, system = false) => {
      const r = REASONS.includes(reason) ? reason : 'server_error'
      const q = ok ? `google=connected${system ? '&target=system' : ''}` : `google=error&reason=${r}${system ? '&target=system' : ''}`
      return new Response(null, { status: 302, headers: { location: `${cfg.appUrl}${sanitizeReturnPath(ret, DEFAULT_RETURN)}?${q}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
    }

    const url = new URL(req.url)
    const state = url.searchParams.get('state') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const providerError = url.searchParams.get('error')

    let st
    try {
      st = await verifyState({ secret: cfg.stateSecret, state, now: now() })
    } catch {
      st = { ok: false, reason: 'malformed' }
    }
    if (!st.ok) {
      log('google_oauth_callback_rejected', { why: st.reason })
      return redirect(DEFAULT_RETURN, false, st.reason === 'expired' ? 'state_expired' : 'invalid_state')
    }
    const p = st.payload
    const ret = p.returnTo ?? DEFAULT_RETURN
    const fail = (reason) => redirect(ret, false, reason, p.system)
    let refreshToUndo = null
    try {
      // one-time use: the first callback consumes the nonce, any replay finds nothing
      const row = await deps.db.oauthConsume({ nonceHash: await nonceHash(p.nonce) })
      if (!row) return fail('state_replayed')
      if (row.user_id !== p.userId || Boolean(row.is_system) !== p.system) return fail('invalid_state')
      if (providerError) return fail(providerError === 'access_denied' ? 'access_denied' : 'exchange_failed')
      if (!code) return fail('exchange_failed')

      const verifier = await deriveCodeVerifier(cfg.stateSecret, p.nonce)
      if ((await codeChallengeS256(verifier)) !== p.challenge) return fail('invalid_state')
      let tokens
      try {
        tokens = await exchangeCode(cfg, { code, codeVerifier: verifier }, { fetch: fetchImpl, now: now() })
      } catch (e) {
        log('google_oauth_exchange_failed', { code: e instanceof GoogleError ? e.code : 'unknown' })
        return fail('exchange_failed')
      }
      refreshToUndo = tokens.refreshToken ?? tokens.accessToken

      let claims
      try {
        claims = decodeIdTokenClaims(tokens.idToken)
      } catch {
        await revokeToken(cfg, refreshToUndo, { fetch: fetchImpl })
        return fail('id_token_invalid')
      }
      const idv = validateIdTokenClaims(claims, { clientId: cfg.clientId, requireDomain: cfg.allowedDomain, now: now() })
      if (!idv.ok) {
        await revokeToken(cfg, refreshToUndo, { fetch: fetchImpl })
        return fail(idv.reason)
      }
      if (p.system) {
        if (idv.email !== cfg.systemSenderEmail) { await revokeToken(cfg, refreshToUndo, { fetch: fetchImpl }); return fail('wrong_system_account') }
      } else if (cfg.emailPolicy === 'same_email' && idv.email !== String(row.user_email ?? '').toLowerCase()) {
        // closes the account-linking CSRF: a link started by one staff member and completed by a colleague would otherwise attach
        // the colleague's mailbox to the first one's account
        await revokeToken(cfg, refreshToUndo, { fetch: fetchImpl })
        return fail('email_mismatch')
      }
      if (!hasRequiredScopes(tokens.scopes, REQUIRED_SCOPES)) { await revokeToken(cfg, refreshToUndo, { fetch: fetchImpl }); return fail('missing_scopes') }
      if (!tokens.refreshToken) { await revokeToken(cfg, tokens.accessToken, { fetch: fetchImpl }); return fail('no_refresh_token') }

      const store = await deps.getStore()
      // a reconnect replaces the stored token: the OLD grant is revoked at Google afterwards (best effort), so no live grant is left behind
      let previous = null
      try {
        const existing = await deps.db.lookupConnection({ userId: p.userId, system: p.system })
        if (existing && existing.status !== 'revoked') previous = await store.load(existing.id)
      } catch {
        previous = null
      }
      try {
        await store.save({ ownerUserId: p.system ? null : p.userId, actorId: p.userId, isSystem: p.system, email: idv.email, googleSub: idv.sub, scopes: tokens.scopes, refreshToken: tokens.refreshToken })
      } catch (e) {
        await revokeToken(cfg, tokens.refreshToken, { fetch: fetchImpl })
        const t = tokenOf(e)
        if (t === 'email_in_use') return fail('email_in_use')
        if (t === 'forbidden') return fail('forbidden')
        throw e
      }
      if (previous && previous !== tokens.refreshToken) await revokeToken(cfg, previous, { fetch: fetchImpl })
      log('google_oauth_connected', { user: p.userId, system: p.system })
      return redirect(ret, true, null, p.system)
    } catch (e) {
      log('google_oauth_callback_error', { code: e?.code ?? tokenOf(e) ?? 'unknown' })
      return fail(e instanceof ConfigError ? 'not_configured' : 'server_error')
    }
  }

  // ---------------------------------------------------------------------------------------------- google-disconnect
  async function disconnect(req) {
    const { cfg } = loadConfig()
    const cors = corsHeaders(req, cfg)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors)
    if (!cfg) return json({ error: 'not_configured' }, 503, cors)
    try {
      const user = await deps.authenticate(req)
      if (!user?.userId) return json({ error: 'unauthenticated' }, 401, cors)
      const parsed = await readJsonBody(req)
      if (!parsed.ok) return json({ error: 'bad_request' }, 400, cors)
      const system = parsed.body.system === true
      const conn = await deps.db.lookupConnection({ userId: user.userId, system })
      if (!conn || conn.status === 'revoked') return json({ ok: true, disconnected: false }, 200, cors)
      let revoked = false
      try {
        const store = await deps.getStore()
        revoked = (await revokeToken(cfg, await store.load(conn.id), { fetch: fetchImpl })).revoked
      } catch (e) {
        log('google_disconnect_revoke_skipped', { code: e?.code ?? 'unknown' }) // the secret may already be gone: disconnecting must still work
      }
      await deps.db.markConnection(conn.id, 'revoked', null) // the database deletes the stored secret in the same transaction
      log('google_disconnected', { user: user.userId, system, revoked_at_google: revoked })
      return json({ ok: true, disconnected: true, revoked_at_google: revoked }, 200, cors)
    } catch (e) {
      const t = tokenOf(e)
      if (t === 'forbidden') return json({ error: 'forbidden' }, 403, cors)
      log('google_disconnect_error', { code: e?.code ?? t ?? 'unknown' })
      return json({ error: 'server_error' }, 500, cors)
    }
  }

  return { start, callback, disconnect }
}
