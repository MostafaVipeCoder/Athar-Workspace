// Google integration core (design 07 sections 1-3; owner decision 08 section 20.6). PURE + Deno-compatible: only Web APIs
// (crypto.subtle, fetch, TextEncoder, URL, AbortController, atob/btoa), no Deno-only API, no Node-only API, so the same file
// runs in the Supabase Edge Runtime and under `node --test`.
//
// What is here: errors, base64url, configuration (env only), the signed OAuth `state`, PKCE, the authorization URL, the
// token endpoint calls (code exchange, refresh, revoke) with strict timeouts, ID token validation, AES-256-GCM encryption
// of refresh tokens + the runtime choice between Supabase Vault and AES, the token store and the access-token provider.
//
// Hard rules kept by this file:
//  * Refresh tokens / access tokens / client secret / state secret are NEVER put in an Error message, a log field or a
//    return value that leaves the server (`safeLog` redacts by key name as a second line of defence).
//  * The Google base URLs come from ENV ONLY (never from a request). They may point away from Google only when
//    ALLOW_FAKE_GOOGLE=1 (local tests against db/scripts/fake-google); otherwise a configured override is a config error,
//    so a leftover local env file can never send production tokens to a fake server.

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })

export const SCOPE_OPENID = 'openid'
export const SCOPE_EMAIL = 'email'
export const SCOPE_USERINFO_EMAIL = 'https://www.googleapis.com/auth/userinfo.email' // what Google reports back for `email`
export const SCOPE_GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send'
export const SCOPE_CALENDAR_EVENTS = 'https://www.googleapis.com/auth/calendar.events'
/** The minimal scope set requested on every connect (decision 20.6). */
export const GOOGLE_SCOPES = Object.freeze([SCOPE_OPENID, SCOPE_EMAIL, SCOPE_GMAIL_SEND, SCOPE_CALENDAR_EVENTS])
/** Google's granular consent lets a user untick a scope: a connection without BOTH of these is refused. */
export const REQUIRED_SCOPES = Object.freeze([SCOPE_GMAIL_SEND, SCOPE_CALENDAR_EVENTS])

export const DEFAULTS = Object.freeze({
  authBase: 'https://accounts.google.com',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://www.googleapis.com',
  allowedDomain: 'athareg.com',
  systemSenderEmail: 'startups@athareg.com',
  stateTtlSec: 600,
  tokenTimeoutMs: 10_000,
  apiTimeoutMs: 15_000,
  maxBodyBytes: 1_048_576,
})

// ------------------------------------------------------------------------------------------------ errors
/**
 * One error type for everything that talks to Google. `code` is a stable machine token; the message never carries a secret.
 *  retryable      : the same call may succeed later (timeout, 429, 5xx, rate limits)
 *  outcomeUnknown : the request may have been ACCEPTED although we saw no answer (timeout / reset after sending): never auto-resend a mail
 *  needsReconnect : the user must connect Google again (invalid_grant)
 */
export class GoogleError extends Error {
  constructor(code, { status = null, retryable = false, outcomeUnknown = false, needsReconnect = false, retryAfterMs = null, reason = null, cause } = {}) {
    super(code)
    this.name = 'GoogleError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.outcomeUnknown = outcomeUnknown
    this.needsReconnect = needsReconnect
    this.retryAfterMs = retryAfterMs
    this.reason = reason
    if (cause !== undefined) this.cause = cause
  }
}

export class ConfigError extends Error {
  constructor(code, missing = []) {
    super(code)
    this.name = 'ConfigError'
    this.code = code
    this.missing = missing // env variable NAMES only
  }
}

// ------------------------------------------------------------------------------------------------ encoding
export function bytesToB64u(bytes) {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uToBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new GoogleError('bad_encoding')
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const utf8 = (s) => enc.encode(String(s))
export const utf8Decode = (b) => dec.decode(b)
export const strToB64u = (s) => bytesToB64u(enc.encode(s))
export const b64uToStr = (s) => dec.decode(b64uToBytes(s))

export function bytesToHex(bytes) {
  let h = ''
  for (const b of bytes) h += b.toString(16).padStart(2, '0')
  return h
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^([0-9a-fA-F]{2})*$/.test(hex)) throw new GoogleError('bad_encoding')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function randomBytes(n) {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data))
}
export const sha256Hex = async (data) => bytesToHex(await sha256(data))
export const sha256B64u = async (data) => bytesToB64u(await sha256(data))

async function hmacKey(secret, usages = ['sign', 'verify']) {
  return crypto.subtle.importKey('raw', typeof secret === 'string' ? enc.encode(secret) : secret, { name: 'HMAC', hash: 'SHA-256' }, false, usages)
}
export async function hmacSha256(secret, data) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), typeof data === 'string' ? enc.encode(data) : data))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

// ------------------------------------------------------------------------------------------------ logging (no secrets, ever)
const SECRET_KEY_RE = /token|secret|authorization|password|passwd|cookie|credential|api[_-]?key|code_verifier|verifier|ciphertext|^code$|^state$|^raw$|^refresh|^access|^id_token/i

/** Structured log line with secret-looking keys redacted and long values truncated. Returns the object it logged (tests assert on it). */
export function safeLog(event, fields = {}, sink = console.error) {
  const out = { event: String(event).slice(0, 64) }
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY_RE.test(k)) out[k] = '[redacted]'
    else if (typeof v === 'string') out[k] = v.length > 200 ? `${v.slice(0, 200)}...` : v
    else if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else out[k] = '[object]'
  }
  try {
    sink(JSON.stringify(out))
  } catch {
    /* logging must never throw */
  }
  return out
}

// ------------------------------------------------------------------------------------------------ configuration (env only)
const OVERRIDE_VARS = ['GOOGLE_AUTH_BASE', 'GOOGLE_TOKEN_URL', 'GOOGLE_REVOKE_URL', 'GOOGLE_API_BASE']

const trimSlash = (u) => String(u).replace(/\/+$/, '')

function parseUrl(name, value) {
  let u
  try {
    u = new URL(value)
  } catch {
    throw new ConfigError('bad_url', [name])
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ConfigError('bad_url', [name])
  return u
}
const isLoopbackHost = (u) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
/** https everywhere, except a loopback address (Google itself allows http only for localhost) and the explicit fake-Google mode. */
function requireSecureUrl(name, u, fake) {
  if (u.protocol !== 'https:' && !fake && !isLoopbackHost(u)) throw new ConfigError('https_required', [name])
}

/**
 * Read the Google configuration from an env map (`{ get(name) }` or a plain object). Throws ConfigError naming only the
 * variables that are missing or bad. Nothing here ever reads a request.
 *   required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, APP_URL, OAUTH_STATE_SECRET (>= 32 chars)
 *   optional: ALLOWED_GOOGLE_DOMAIN (athareg.com), SYSTEM_SENDER_EMAIL (startups@athareg.com),
 *             GOOGLE_PM_EMAIL_POLICY (same_email | same_domain), GOOGLE_AUTH_BASE / GOOGLE_TOKEN_URL / GOOGLE_REVOKE_URL /
 *             GOOGLE_API_BASE (ONLY with ALLOW_FAKE_GOOGLE=1), ALLOWED_ORIGINS, TOKEN_STORAGE (auto | vault | aes)
 */
export function getGoogleConfig(env) {
  const get = (n) => {
    const v = typeof env?.get === 'function' ? env.get(n) : env?.[n]
    return v === undefined || v === null ? '' : String(v).trim()
  }
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'APP_URL', 'OAUTH_STATE_SECRET'].filter((n) => !get(n))
  if (missing.length) throw new ConfigError('missing_env', missing)
  if (get('OAUTH_STATE_SECRET').length < 32) throw new ConfigError('weak_secret', ['OAUTH_STATE_SECRET'])

  const fake = get('ALLOW_FAKE_GOOGLE') === '1'
  const overridden = OVERRIDE_VARS.filter((n) => get(n))
  if (overridden.length && !fake) throw new ConfigError('override_not_allowed', overridden)

  const redirect = parseUrl('GOOGLE_REDIRECT_URI', get('GOOGLE_REDIRECT_URI'))
  const app = parseUrl('APP_URL', get('APP_URL'))
  requireSecureUrl('GOOGLE_REDIRECT_URI', redirect, fake)
  requireSecureUrl('APP_URL', app, fake)
  const authBase = trimSlash(get('GOOGLE_AUTH_BASE') || DEFAULTS.authBase)
  const tokenUrl = get('GOOGLE_TOKEN_URL') || DEFAULTS.tokenUrl
  const apiBase = trimSlash(get('GOOGLE_API_BASE') || DEFAULTS.apiBase)
  let revokeUrl = get('GOOGLE_REVOKE_URL')
  if (!revokeUrl) revokeUrl = get('GOOGLE_TOKEN_URL') ? tokenUrl.replace(/\/token\/?$/, '/revoke') : DEFAULTS.revokeUrl
  for (const [n, v] of [['GOOGLE_AUTH_BASE', authBase], ['GOOGLE_TOKEN_URL', tokenUrl], ['GOOGLE_REVOKE_URL', revokeUrl], ['GOOGLE_API_BASE', apiBase]]) parseUrl(n, v)

  const policy = get('GOOGLE_PM_EMAIL_POLICY') || 'same_email'
  if (!['same_email', 'same_domain'].includes(policy)) throw new ConfigError('bad_value', ['GOOGLE_PM_EMAIL_POLICY'])
  const origins = (get('ALLOWED_ORIGINS') || app.origin).split(',').map((s) => s.trim()).filter(Boolean)
  const appUrl = trimSlash(`${app.origin}${app.pathname}`)
  return Object.freeze({
    clientId: get('GOOGLE_CLIENT_ID'),
    clientSecret: get('GOOGLE_CLIENT_SECRET'),
    redirectUri: redirect.toString(),
    appUrl,
    stateSecret: get('OAUTH_STATE_SECRET'),
    allowedDomain: (get('ALLOWED_GOOGLE_DOMAIN') || DEFAULTS.allowedDomain).toLowerCase(),
    systemSenderEmail: (get('SYSTEM_SENDER_EMAIL') || DEFAULTS.systemSenderEmail).toLowerCase(),
    emailPolicy: policy,
    authUrl: `${authBase}/o/oauth2/v2/auth`,
    tokenUrl,
    revokeUrl,
    apiBase,
    allowedOrigins: origins,
    tokenStorage: (get('TOKEN_STORAGE') || 'auto').toLowerCase(),
    stateTtlSec: DEFAULTS.stateTtlSec,
    tokenTimeoutMs: DEFAULTS.tokenTimeoutMs,
    apiTimeoutMs: DEFAULTS.apiTimeoutMs,
    fake,
  })
}

// ------------------------------------------------------------------------------------------------ signed state + PKCE
/**
 * Where the browser may be sent back to inside the app: a plain path (letters, digits, `_ - . ~` and `/`), no query, no
 * fragment, no scheme, no `//`, no `..`. Anything else becomes the fallback. Applied when the state is made AND when it is read.
 */
export function sanitizeReturnPath(value, fallback = '/profile') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return fallback
  if (!/^\/(?:[A-Za-z0-9_\-.~]+(?:\/[A-Za-z0-9_\-.~]+)*)?$/.test(value)) return fallback
  if (value.split('/').some((seg) => seg === '..' || seg === '.')) return fallback
  return value
}

const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/

/** PKCE code verifier: 32 random bytes -> 43 unreserved characters (RFC 7636 section 4.1). */
export function generateCodeVerifier(rand = randomBytes) {
  return bytesToB64u(rand(32))
}
export const isValidCodeVerifier = (v) => typeof v === 'string' && /^[A-Za-z0-9\-._~]{43,128}$/.test(v)
/** S256 challenge = base64url(SHA-256(ASCII(verifier))). */
export async function codeChallengeS256(verifier) {
  if (!isValidCodeVerifier(verifier)) throw new GoogleError('bad_verifier')
  return sha256B64u(verifier)
}
/**
 * The verifier is DERIVED (HMAC of the nonce under the state secret) instead of stored: the signed state carries only its
 * hash (the challenge), the callback recomputes the verifier, and nothing secret needs a table. Unguessable without the secret.
 */
export async function deriveCodeVerifier(secret, nonce) {
  return bytesToB64u(await hmacSha256(secret, `athar-pkce-v1|${nonce}`))
}

export function newNonce(rand = randomBytes) {
  return bytesToB64u(rand(16))
}
export const nonceHash = (nonce) => sha256Hex(`athar-oauth-nonce-v1|${nonce}`)

/**
 * state = base64url(JSON) + "." + base64url(HMAC-SHA256(secret, base64url(JSON))).
 * The MAC covers: user id, nonce, the PKCE challenge (hash of the verifier), the expiry, the `system` flag, the return path.
 */
export async function signState({ secret, userId, nonce, challenge, system = false, returnTo = null, now = Date.now(), ttlSec = DEFAULTS.stateTtlSec }) {
  if (!secret || String(secret).length < 32) throw new ConfigError('weak_secret', ['OAUTH_STATE_SECRET'])
  if (!isUuid(userId) || !NONCE_RE.test(nonce ?? '') || !CHALLENGE_RE.test(challenge ?? '')) throw new GoogleError('bad_state_input')
  const payload = { v: 1, u: userId.toLowerCase(), n: nonce, c: challenge, e: Math.floor(now / 1000) + ttlSec, s: system ? 1 : 0 }
  const ret = returnTo === null || returnTo === undefined ? null : sanitizeReturnPath(returnTo, null)
  if (ret) payload.r = ret
  const body = strToB64u(JSON.stringify(payload))
  const mac = bytesToB64u(await hmacSha256(secret, body))
  return `${body}.${mac}`
}

/** -> { ok: true, payload } | { ok: false, reason: 'malformed' | 'bad_signature' | 'unsupported' | 'expired' }. Constant-time MAC check. */
export async function verifyState({ secret, state, now = Date.now() }) {
  if (typeof state !== 'string' || state.length < 20 || state.length > 1024) return { ok: false, reason: 'malformed' }
  const parts = state.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  let macBytes
  try {
    macBytes = b64uToBytes(parts[1])
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const good = await crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), macBytes, enc.encode(parts[0]))
  if (!good) return { ok: false, reason: 'bad_signature' }
  let p
  try {
    p = JSON.parse(b64uToStr(parts[0]))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!p || p.v !== 1 || !isUuid(p.u) || !NONCE_RE.test(p.n ?? '') || !CHALLENGE_RE.test(p.c ?? '') || !Number.isInteger(p.e) || (p.s !== 0 && p.s !== 1)) return { ok: false, reason: 'unsupported' }
  const nowSec = Math.floor(now / 1000)
  if (nowSec >= p.e) return { ok: false, reason: 'expired' }
  if (p.e - nowSec > 3600) return { ok: false, reason: 'unsupported' } // we never sign more than the TTL: a far expiry is not ours
  return { ok: true, payload: { userId: p.u, nonce: p.n, challenge: p.c, system: p.s === 1, returnTo: typeof p.r === 'string' ? sanitizeReturnPath(p.r) : null, expiresAt: p.e * 1000 } }
}

/** The authorization URL (authorization code + PKCE S256, offline access, forced consent so a refresh token is issued). */
export function buildAuthUrl(cfg, { state, challenge, loginHint = null, system = false }) {
  const u = new URL(cfg.authUrl)
  const q = u.searchParams
  q.set('client_id', cfg.clientId)
  q.set('redirect_uri', cfg.redirectUri)
  q.set('response_type', 'code')
  q.set('scope', GOOGLE_SCOPES.join(' '))
  q.set('state', state)
  q.set('code_challenge', challenge)
  q.set('code_challenge_method', 'S256')
  q.set('access_type', 'offline')
  q.set('prompt', system ? 'consent select_account' : 'consent')
  q.set('include_granted_scopes', 'true')
  q.set('hd', cfg.allowedDomain)
  if (loginHint && /^[^\s@<>"]{1,64}@[^\s@<>"]{1,255}$/.test(loginHint)) q.set('login_hint', loginHint)
  return u.toString()
}

// ------------------------------------------------------------------------------------------------ HTTP with strict timeouts
function transportCode(e) {
  const c = e?.cause?.code ?? e?.code
  return typeof c === 'string' ? c : ''
}
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_INVALID_URL'])

async function readBodyLimited(res, max) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const t = await res.text()
    if (t.length > max) throw new GoogleError('bad_response', { reason: 'too_large' })
    return t
  }
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      try { await reader.cancel() } catch { /* ignore */ }
      throw new GoogleError('bad_response', { reason: 'too_large' })
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let off = 0
  for (const c of chunks) { all.set(c, off); off += c.byteLength }
  return new TextDecoder().decode(all)
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null
  const s = String(value).trim()
  let ms = null
  if (/^\d+$/.test(s)) ms = Number(s) * 1000
  else {
    const t = Date.parse(s)
    if (!Number.isNaN(t)) ms = Math.max(0, t - now)
  }
  return ms === null ? null : Math.min(ms, 3_600_000)
}

/**
 * One HTTP request with a hard timeout (covers connecting AND reading the body), no redirects, a body size cap and a
 * normalised result { status, text, json, retryAfterMs }. Throws GoogleError('timeout' | 'network'); an HTTP error status is
 * NOT thrown here (the callers classify it).
 */
export async function httpRequest(fetchImpl, url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULTS.apiTimeoutMs, maxBytes = DEFAULTS.maxBodyBytes } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { method, headers, body, signal: ctrl.signal, redirect: 'manual' })
    const text = await readBodyLimited(res, maxBytes)
    let json = null
    if (text) {
      try { json = JSON.parse(text) } catch { json = null }
    }
    return { status: res.status, text, json, retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after')) }
  } catch (e) {
    if (e instanceof GoogleError) throw e
    if (ctrl.signal.aborted) throw new GoogleError('timeout', { retryable: true, outcomeUnknown: true, cause: e })
    const never = NEVER_SENT.has(transportCode(e))
    throw new GoogleError('network', { retryable: true, outcomeUnknown: !never, reason: transportCode(e) || null, cause: e })
  } finally {
    clearTimeout(timer)
  }
}

/** Classify a Google API error response (Gmail / Calendar JSON shape `{error:{code,message,errors:[{reason}]}}`) into a GoogleError. */
export function classifyApiError(res) {
  const status = res.status
  const reason = res.json?.error?.errors?.[0]?.reason ?? res.json?.error?.status ?? null
  const retryAfterMs = res.retryAfterMs ?? null
  const base = { status, reason: reason ? String(reason).slice(0, 64) : null, retryAfterMs }
  if (status === 401) return new GoogleError('unauthorized', { ...base, retryable: false })
  if (status === 429 || (status === 403 && /ratelimit|quota|backenderror/i.test(String(reason)))) return new GoogleError('rate_limited', { ...base, retryable: true })
  if (status === 403) return new GoogleError('forbidden', { ...base })
  if (status === 404) return new GoogleError('not_found', { ...base })
  if (status === 409) return new GoogleError('conflict', { ...base })
  if (status === 410) return new GoogleError('gone', { ...base })
  if (status === 400) return new GoogleError('bad_request', { ...base })
  if (status >= 500) return new GoogleError('server_error', { ...base, retryable: true })
  return new GoogleError(`http_${status}`, { ...base })
}

// ------------------------------------------------------------------------------------------------ token endpoint
function normalizeScopes(scopeString) {
  const set = new Set(String(scopeString ?? '').split(/\s+/).filter(Boolean))
  if (set.has(SCOPE_EMAIL)) { set.delete(SCOPE_EMAIL); set.add(SCOPE_USERINFO_EMAIL) }
  return [...set].sort()
}
/** True when every required scope was granted. (`email` and the userinfo.email URL are the same grant.) */
export function hasRequiredScopes(granted, required = REQUIRED_SCOPES) {
  const set = new Set(Array.isArray(granted) ? granted : normalizeScopes(granted))
  return required.every((s) => set.has(s))
}
export { normalizeScopes }

async function tokenCall(cfg, params, fetchImpl) {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }).toString()
  const res = await httpRequest(fetchImpl, cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    timeoutMs: cfg.tokenTimeoutMs,
  })
  if (res.status >= 200 && res.status < 300 && res.json && typeof res.json.access_token === 'string') return res.json
  const err = String(res.json?.error ?? '')
  if (res.status >= 500 || err === 'temporarily_unavailable') throw new GoogleError('server_error', { status: res.status, retryable: true })
  if (res.status === 429) throw new GoogleError('rate_limited', { status: res.status, retryable: true, retryAfterMs: res.retryAfterMs })
  if (err === 'invalid_grant') throw new GoogleError('invalid_grant', { status: res.status, needsReconnect: true })
  if (err === 'invalid_client' || err === 'unauthorized_client') throw new GoogleError('invalid_client', { status: res.status })
  if (err === 'redirect_uri_mismatch') throw new GoogleError('redirect_uri_mismatch', { status: res.status })
  throw new GoogleError(err === 'invalid_request' ? 'invalid_request' : 'bad_response', { status: res.status })
}

/** Authorization-code exchange with the PKCE verifier. -> { accessToken, refreshToken|null, expiresAt, scopes[], idToken|null } */
export async function exchangeCode(cfg, { code, codeVerifier }, { fetch: fetchImpl = fetch, now = Date.now() } = {}) {
  if (typeof code !== 'string' || !code || code.length > 2048) throw new GoogleError('invalid_request')
  if (!isValidCodeVerifier(codeVerifier)) throw new GoogleError('bad_verifier')
  const j = await tokenCall(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: codeVerifier }, fetchImpl)
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : null,
    expiresAt: now + Math.max(0, Number(j.expires_in) || 3600) * 1000,
    scopes: normalizeScopes(j.scope),
    idToken: typeof j.id_token === 'string' ? j.id_token : null,
  }
}

/** Refresh grant. invalid_grant -> GoogleError('invalid_grant', { needsReconnect: true }). -> { accessToken, expiresAt, scopes[] } */
export async function refreshAccessToken(cfg, refreshToken, { fetch: fetchImpl = fetch, now = Date.now() } = {}) {
  if (typeof refreshToken !== 'string' || !refreshToken) throw new GoogleError('invalid_grant', { needsReconnect: true })
  const j = await tokenCall(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl)
  return { accessToken: j.access_token, expiresAt: now + Math.max(0, Number(j.expires_in) || 3600) * 1000, scopes: normalizeScopes(j.scope) }
}

/** Best-effort revoke (refresh or access token). Never throws. -> { revoked: boolean } */
export async function revokeToken(cfg, token, { fetch: fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token) return { revoked: false }
  try {
    const res = await httpRequest(fetchImpl, cfg.revokeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      timeoutMs: cfg.tokenTimeoutMs,
    })
    return { revoked: res.status >= 200 && res.status < 300 }
  } catch {
    return { revoked: false }
  }
}

// ------------------------------------------------------------------------------------------------ ID token
/**
 * The ID token arrives straight from Google's token endpoint over TLS, so (OpenID Connect Core 3.1.3.7) the TLS check of
 * the issuer replaces the signature check: we decode the payload and validate the claims; we do NOT trust a token that came
 * from anywhere else. Returns the claims or throws GoogleError('id_token_invalid').
 */
export function decodeIdTokenClaims(idToken) {
  if (typeof idToken !== 'string') throw new GoogleError('id_token_invalid')
  const parts = idToken.split('.')
  if (parts.length !== 3 || parts[0].length > 2048 || parts[1].length > 8192) throw new GoogleError('id_token_invalid')
  try {
    const claims = JSON.parse(b64uToStr(parts[1]))
    if (!claims || typeof claims !== 'object') throw new Error('claims')
    return claims
  } catch (e) {
    throw new GoogleError('id_token_invalid', { cause: e })
  }
}

const EMAIL_RE = /^[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i
export const isEmailAddress = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v)
export const emailDomain = (email) => String(email ?? '').toLowerCase().split('@').pop()

/**
 * -> { ok: true, email, sub, hd } | { ok: false, reason: 'id_token_invalid' | 'email_unverified' | 'wrong_domain' }.
 * `requireDomain` = the allowed Workspace domain: the e-mail domain AND the hosted-domain claim must both match it
 * (the `hd` claim alone can be absent, the e-mail alone can be a consumer alias).
 */
export function validateIdTokenClaims(claims, { clientId, requireDomain = null, now = Date.now() }) {
  const aud = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud]
  if (!claims || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || !aud.includes(clientId)) return { ok: false, reason: 'id_token_invalid' }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) return { ok: false, reason: 'id_token_invalid' }
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now) return { ok: false, reason: 'id_token_invalid' }
  if (!isEmailAddress(claims.email)) return { ok: false, reason: 'id_token_invalid' }
  if (claims.email_verified !== true && claims.email_verified !== 'true') return { ok: false, reason: 'email_unverified' }
  const email = claims.email.toLowerCase()
  if (requireDomain) {
    const d = String(requireDomain).toLowerCase()
    if (emailDomain(email) !== d || String(claims.hd ?? '').toLowerCase() !== d) return { ok: false, reason: 'wrong_domain' }
  }
  return { ok: true, email, sub: claims.sub, hd: claims.hd ? String(claims.hd).toLowerCase() : null }
}

// ------------------------------------------------------------------------------------------------ AES-256-GCM (the storage used when Vault is not available)
/** TOKEN_ENC_KEY: 32 bytes as 64 hex characters or base64 / base64url. */
export function parseEncKey(value) {
  const s = String(value ?? '').trim()
  let bytes = null
  if (/^[0-9a-fA-F]{64}$/.test(s)) bytes = hexToBytes(s)
  else if (/^[A-Za-z0-9_\-+/]{43}={0,1}$/.test(s)) {
    try { bytes = b64uToBytes(s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')) } catch { bytes = null }
  }
  if (!bytes || bytes.length !== 32) throw new ConfigError('bad_enc_key', ['TOKEN_ENC_KEY'])
  return bytes
}

export async function keyFingerprint(keyBytes) {
  return (await sha256Hex(keyBytes)).slice(0, 8)
}

const AAD_PREFIX = 'athar:google-refresh-token:v1:'

/**
 * Keyring from env: TOKEN_ENC_KEY (current) and optionally TOKEN_ENC_KEY_OLD (for rotation: decrypt-only).
 * -> { current: {kid, bytes}, all: Map(kid -> bytes) }.
 */
export async function createKeyring(env) {
  const get = (n) => (typeof env?.get === 'function' ? env.get(n) : env?.[n]) ?? ''
  if (!String(get('TOKEN_ENC_KEY')).trim()) throw new ConfigError('missing_env', ['TOKEN_ENC_KEY'])
  const cur = parseEncKey(get('TOKEN_ENC_KEY'))
  const all = new Map()
  const current = { kid: await keyFingerprint(cur), bytes: cur }
  all.set(current.kid, cur)
  if (String(get('TOKEN_ENC_KEY_OLD')).trim()) {
    const old = parseEncKey(get('TOKEN_ENC_KEY_OLD'))
    all.set(await keyFingerprint(old), old)
  }
  return { current, all }
}

async function aesKey(bytes, usage) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [usage])
}

/** -> "v1.<kid>.<iv>.<ciphertext+tag>" (base64url parts). The AAD binds the blob to ONE account e-mail: a blob copied to another row does not decrypt. */
export async function encryptToken(plain, keyring, { aad }) {
  if (typeof plain !== 'string' || !plain) throw new GoogleError('bad_secret')
  const iv = randomBytes(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(AAD_PREFIX + String(aad).toLowerCase()), tagLength: 128 }, await aesKey(keyring.current.bytes, 'encrypt'), utf8(plain)))
  return `v1.${keyring.current.kid}.${bytesToB64u(iv)}.${bytesToB64u(ct)}`
}

export async function decryptToken(blob, keyring, { aad }) {
  const parts = String(blob ?? '').split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new GoogleError('bad_ciphertext')
  const key = keyring.all.get(parts[1])
  if (!key) throw new GoogleError('unknown_key', { reason: 'kid' })
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uToBytes(parts[2]), additionalData: utf8(AAD_PREFIX + String(aad).toLowerCase()), tagLength: 128 }, await aesKey(key, 'decrypt'), b64uToBytes(parts[3]))
    return utf8Decode(new Uint8Array(pt))
  } catch (e) {
    throw new GoogleError('bad_ciphertext', { cause: e })
  }
}

// ------------------------------------------------------------------------------------------------ token store: Vault or AES behind ONE interface
/**
 * Runtime choice. `preferred`: 'auto' (Vault when the database offers it, else AES), 'vault', 'aes'.
 * -> 'vault' | 'aes'; throws ConfigError when the choice cannot be honoured.
 */
export function chooseStorageMode({ preferred = 'auto', vaultAvailable = false, hasEncKey = false }) {
  const p = String(preferred ?? 'auto').toLowerCase()
  if (!['auto', 'vault', 'aes'].includes(p)) throw new ConfigError('bad_value', ['TOKEN_STORAGE'])
  if (p === 'vault') {
    if (!vaultAvailable) throw new ConfigError('vault_unavailable', ['TOKEN_STORAGE'])
    return 'vault'
  }
  if (p === 'aes') {
    if (!hasEncKey) throw new ConfigError('missing_env', ['TOKEN_ENC_KEY'])
    return 'aes'
  }
  if (vaultAvailable) return 'vault'
  if (hasEncKey) return 'aes'
  throw new ConfigError('no_token_storage', ['TOKEN_ENC_KEY'])
}

/**
 * The one interface the functions use. `db` is the service-role adapter (see google-edge.js):
 *   db.upsertConnection({ ..., storage, secret }) / db.getSecret(connectionId) -> { storage, value, email }.
 * save(): seals the refresh token for the chosen mode (Vault: the DB stores the plaintext INSIDE Vault; AES: we encrypt here
 *         and the DB stores only the ciphertext) and upserts the connection in one call.
 * load(): reads the secret row and returns the refresh token (decrypting AES), honouring the storage the row was saved with.
 */
export function createTokenStore({ db, mode, keyring = null }) {
  if (!['vault', 'aes'].includes(mode)) throw new ConfigError('bad_value', ['TOKEN_STORAGE'])
  return {
    mode,
    async save({ ownerUserId, actorId, isSystem, email, googleSub, scopes, refreshToken }) {
      if (typeof refreshToken !== 'string' || !refreshToken) throw new GoogleError('no_refresh_token')
      let secret = refreshToken
      if (mode === 'aes') {
        if (!keyring) throw new ConfigError('missing_env', ['TOKEN_ENC_KEY'])
        secret = await encryptToken(refreshToken, keyring, { aad: email })
      }
      return db.upsertConnection({ ownerUserId, actorId, isSystem, email, googleSub, scopes, storage: mode, secret })
    },
    async load(connectionId) {
      const row = await db.getSecret(connectionId)
      if (!row || typeof row.value !== 'string' || !row.value) throw new GoogleError('no_secret', { needsReconnect: true })
      if (row.storage === 'vault') return row.value
      if (row.storage === 'aes') {
        if (!keyring) throw new ConfigError('missing_env', ['TOKEN_ENC_KEY'])
        return decryptToken(row.value, keyring, { aad: row.email })
      }
      throw new GoogleError('bad_storage')
    },
  }
}

// ------------------------------------------------------------------------------------------------ access tokens for workers
/**
 * Access tokens for the e-mail worker and the calendar sync: in-memory only (never persisted), refreshed 60 s before expiry,
 * concurrent refreshes of one connection share ONE request. On invalid_grant the connection is marked needs_reconnect
 * (db.markConnection) and the error is rethrown with needsReconnect = true so the caller parks its job.
 */
export function createAccessTokenProvider({ cfg, db, store, fetch: fetchImpl = fetch, now = () => Date.now() }) {
  const cache = new Map()
  const inflight = new Map()
  async function fetchToken(connectionId) {
    const refresh = await store.load(connectionId)
    try {
      const t = await refreshAccessToken(cfg, refresh, { fetch: fetchImpl, now: now() })
      cache.set(connectionId, { accessToken: t.accessToken, expiresAt: t.expiresAt, scopes: t.scopes })
      return cache.get(connectionId)
    } catch (e) {
      cache.delete(connectionId)
      if (e instanceof GoogleError && e.code === 'invalid_grant') await db.markConnection(connectionId, 'needs_reconnect', 'invalid_grant')
      throw e
    }
  }
  return {
    async getAccessToken(connectionId, { force = false } = {}) {
      const hit = cache.get(connectionId)
      if (!force && hit && hit.expiresAt - now() > 60_000) return hit.accessToken
      if (!inflight.has(connectionId)) inflight.set(connectionId, fetchToken(connectionId).finally(() => inflight.delete(connectionId)))
      return (await inflight.get(connectionId)).accessToken
    },
    invalidate(connectionId) {
      cache.delete(connectionId)
    },
  }
}
