#!/usr/bin/env node
// FAKE GOOGLE (local tests only; Node built-ins only). A stand-in for the parts of Google the platform talks to, so the OAuth
// flow, the e-mail worker and the calendar sync can be run end to end WITHOUT ever calling a real Google endpoint.
//
//   OAuth      GET  /o/oauth2/v2/auth   authorize page (auto-approves with a chosen test e-mail; --interactive shows a consent page)
//              POST /token              authorization_code (PKCE S256 checked) and refresh_token grants, id_token, invalid_grant injection
//              GET  /oauth2/v3/userinfo
//              POST /revoke
//   Gmail      POST /gmail/v1/users/me/messages/send   records + DECODES the message (RFC 2047 subjects, multipart parts, problems list)
//   Calendar   POST/GET/PATCH/DELETE /calendar/v3/calendars/{primary|e-mail}/events[/{id}]   idempotent by id (409), Meet link for
//              conferenceData.createRequest (only with conferenceDataVersion=1; pending then success), cancelled events, sendUpdates recorded
//   Control    GET /__state  POST /__reset  GET /__messages  GET /__events  GET /__health
//              POST /__control/next-account | config | inject | expire-access-tokens | revoke-all
//
// Run:  node db/scripts/fake-google/server.mjs --port 54399 [--host 127.0.0.1] [--interactive] [--client-id ID] [--client-secret S]
//                                              [--redirect-uri URL]... [--default-email you@athareg.com]
// (env equivalents: FAKE_GOOGLE_PORT, FAKE_GOOGLE_HOST, FAKE_GOOGLE_CLIENT_ID, FAKE_GOOGLE_CLIENT_SECRET, FAKE_GOOGLE_REDIRECT_URIS, FAKE_GOOGLE_DEFAULT_EMAIL)
// From tests:  const g = await startFakeGoogle({ port: 0 }); g.url; g.state; g.reset(); await g.close()
//
// The tokens it hands out look like Google's but are random and mean nothing anywhere else. It is NOT secure and must never be exposed.

import http from 'node:http'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseMime, decodeBase64Url } from './mime-parse.mjs'

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const rnd = (n = 16) => crypto.randomBytes(n).toString('hex')
const SCOPE_EMAIL_URL = 'https://www.googleapis.com/auth/userinfo.email'
const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.send'
const SCOPE_CAL = 'https://www.googleapis.com/auth/calendar.events'
const EVENT_ID_RE = /^[a-v0-9]{5,1024}$/
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,255}$/

function normalizeScopes(list) {
  const set = new Set(list.map((s) => (s === 'email' ? SCOPE_EMAIL_URL : s)))
  return [...set]
}

const DEFAULT_CONFIG = {
  clientId: null, // null = accept any client id
  clientSecret: null, // null = accept any secret
  redirectUris: null, // null = any http(s) loopback / host.docker.internal URI
  defaultEmail: 'fake.user@athareg.com',
  interactive: false,
  accessTokenTtlSec: 3599,
  meetAsync: true, // a new Meet request is `pending` first
  meetPendingGets: 1, // how many events.get calls still see `pending`
  codeTtlSec: 600,
}

export async function startFakeGoogle(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...Object.fromEntries(Object.entries(options).filter(([k]) => k in DEFAULT_CONFIG && options[k] !== undefined)) }
  const initialConfig = { ...config }
  const host = options.host ?? '127.0.0.1'
  const verbose = Boolean(options.verbose)

  const S = {} // mutable state, replaced by reset()
  function reset() {
    S.accounts = new Map() // email -> { sub, hd, email_verified }
    S.consented = new Set() // `${email}|${clientId}`
    S.codes = new Map()
    S.refresh = new Map() // rt -> { email, scopes, clientId, revoked, nonceIssuedAt }
    S.access = new Map() // at -> { email, scopes, expiresAt, refresh, revoked }
    S.pendingSessions = new Map() // interactive consent sessions
    S.messages = []
    S.events = new Map() // email -> Map(id -> event)
    S.calls = []
    S.injections = []
    S.nextAccounts = []
    S.counters = { token: 0, gmailSend: 0, calendar: 0, revoke: 0, authorize: 0 }
  }
  reset()

  const sockets = new Set()

  // ------------------------------------------------------------------------------------------------ helpers
  const accountFor = (email, overrides = {}) => {
    const e = email.toLowerCase()
    if (!S.accounts.has(e) || Object.keys(overrides).length) {
      const prev = S.accounts.get(e) ?? {}
      S.accounts.set(e, { sub: prev.sub ?? String(100000000000000000000n + BigInt('0x' + rnd(6)) % 900000000000000000000n), hd: e.split('@')[1], email_verified: true, ...prev, ...overrides })
    }
    return S.accounts.get(e)
  }

  function send(res, status, body, headers = {}) {
    const isJson = body !== null && typeof body === 'object'
    const payload = body === null || body === undefined ? '' : isJson ? JSON.stringify(body) : String(body)
    res.writeHead(status, { 'content-type': isJson ? 'application/json; charset=UTF-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers })
    res.end(payload)
  }

  async function readBody(req, limit = 40_000_000) {
    const chunks = []
    let size = 0
    for await (const c of req) {
      size += c.length
      if (size > limit) throw Object.assign(new Error('too large'), { status: 413 })
      chunks.push(c)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  const parseForm = (text) => Object.fromEntries(new URLSearchParams(text))
  const apiError = (res, status, message, reason, extra = {}) =>
    send(res, status, { error: { code: status, message, errors: [{ message, domain: 'global', reason }], status: extra.status ?? undefined } }, extra.headers ?? {})

  const redirectAllowed = (uri) => {
    if (config.redirectUris) return config.redirectUris.includes(uri)
    try {
      const u = new URL(uri)
      return (u.protocol === 'http:' || u.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal'].includes(u.hostname)
    } catch {
      return false
    }
  }

  // ---- failure injection:  { target, mode, times, after, retryAfter, match: { recipient, refreshToken, eventId } }
  function takeInjection(target, ctx = {}) {
    for (const inj of S.injections) {
      if (inj.target !== '*' && inj.target !== target) continue
      if (inj.match?.recipient && !String(ctx.recipient ?? '').includes(inj.match.recipient)) continue
      if (inj.match?.refreshToken && inj.match.refreshToken !== ctx.refreshToken) continue
      if (inj.match?.eventId && inj.match.eventId !== ctx.eventId) continue
      if (inj.after > 0) { inj.after -= 1; continue }
      if (inj.times !== null) {
        if (inj.times <= 0) continue
        inj.times -= 1
      }
      inj.hits += 1
      return inj
    }
    return null
  }
  const hang = (req, res) => { /* never answer; the socket is destroyed by close() or by the client's own timeout */ void req; void res }

  /** Apply a failure mode BEFORE the work. Returns true when the request was fully handled. */
  function failBefore(inj, req, res) {
    if (!inj) return false
    switch (inj.mode) {
      case '401': apiError(res, 401, 'Request had invalid authentication credentials.', 'authError', { status: 'UNAUTHENTICATED' }); return true
      case '403': apiError(res, 403, 'Rate Limit Exceeded', 'userRateLimitExceeded'); return true
      case '429': apiError(res, 429, 'Rate Limit Exceeded', 'rateLimitExceeded', { headers: { 'retry-after': String(inj.retryAfter ?? 2) } }); return true
      case '500': apiError(res, 500, 'Backend Error', 'backendError'); return true
      case '503': apiError(res, 503, 'Service Unavailable', 'backendError'); return true
      case 'timeout-before-accept': hang(req, res); return true
      default: return false
    }
  }
  /** Apply an AFTER-accept failure mode (the work was done and recorded). Returns true when the answer was suppressed. */
  function failAfter(inj, req, res) {
    if (!inj) return false
    if (inj.mode === 'timeout-after-accept') { hang(req, res); return true }
    if (inj.mode === 'reset-after-accept') { req.socket.destroy(); return true }
    return false
  }

  // ---- tokens
  function issueAccess(email, scopes, refresh) {
    const at = `ya29.fake.${b64u(crypto.randomBytes(24))}`
    S.access.set(at, { email, scopes, expiresAt: Date.now() + config.accessTokenTtlSec * 1000, refresh, revoked: false })
    return at
  }

  function idToken({ email, clientId, nonce }) {
    const acct = accountFor(email)
    const iat = Math.floor(Date.now() / 1000)
    const payload = { iss: 'https://accounts.google.com', azp: clientId, aud: clientId, sub: acct.sub, email, email_verified: acct.email_verified, iat, exp: iat + 3600 }
    if (acct.hd) payload.hd = acct.hd
    if (nonce) payload.nonce = nonce
    return `${b64u(JSON.stringify({ alg: 'RS256', kid: 'fake-google', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}.${b64u('fake-signature-not-verifiable')}`
  }

  function bearer(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')
    return m ? m[1] : null
  }
  function authApi(req, res, scope) {
    const rec = S.access.get(bearer(req) ?? '')
    if (!rec || rec.revoked || rec.expiresAt <= Date.now() || S.refresh.get(rec.refresh)?.revoked) {
      apiError(res, 401, 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.', 'authError', { status: 'UNAUTHENTICATED' })
      return null
    }
    if (scope && !rec.scopes.includes(scope)) {
      apiError(res, 403, 'Request had insufficient authentication scopes.', 'insufficientPermissions', { status: 'PERMISSION_DENIED' })
      return null
    }
    return rec
  }

  // ------------------------------------------------------------------------------------------------ OAuth: authorize
  function finishAuthorize(res, p, account, { deny = false, scopesDenied = [] } = {}) {
    const back = new URL(p.redirect_uri)
    if (p.state) back.searchParams.set('state', p.state)
    if (deny) {
      back.searchParams.set('error', 'access_denied')
      res.writeHead(302, { location: back.toString(), 'cache-control': 'no-store' })
      return res.end()
    }
    const requested = normalizeScopes(String(p.scope).split(/\s+/).filter(Boolean))
    const granted = requested.filter((s) => !scopesDenied.map((d) => (d === 'email' ? SCOPE_EMAIL_URL : d)).includes(s))
    const key = `${account.email}|${p.client_id}`
    const prompts = String(p.prompt ?? '').split(/\s+/)
    const consentedBefore = S.consented.has(key)
    const offline = p.access_type === 'offline'
    const issueRefresh = offline && (!consentedBefore || prompts.includes('consent'))
    S.consented.add(key)
    const code = `4/0Afake-${b64u(crypto.randomBytes(24))}`
    S.codes.set(code, {
      email: account.email, clientId: p.client_id, redirectUri: p.redirect_uri, challenge: p.code_challenge ?? null, method: p.code_challenge_method ?? 'plain',
      scopes: granted, issueRefresh, used: false, createdAt: Date.now(), nonce: p.nonce ?? null,
    })
    back.searchParams.set('code', code)
    back.searchParams.set('scope', granted.join(' '))
    back.searchParams.set('authuser', '0')
    res.writeHead(302, { location: back.toString(), 'cache-control': 'no-store' })
    res.end()
  }

  function consentPage(sessionId, p, email) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    const scopes = String(p.scope).split(/\s+/).filter(Boolean)
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fake Google sign-in</title>
<style>body{font-family:system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:.75rem 0 .25rem}input[type=email]{width:100%;padding:.6rem;font-size:1rem}button{padding:.7rem 1.2rem;font-size:1rem;margin-inline-end:.5rem}.warn{background:#fff3cd;padding:.6rem;border-radius:.4rem}</style></head>
<body><h1>Fake Google</h1><p class="warn">Local test server. Nothing here is real Google.</p>
<p>The app <strong>${esc(p.client_id)}</strong> asks for access to:</p><ul>${scopes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<form method="post" action="/o/oauth2/v2/auth/decision"><input type="hidden" name="session" value="${esc(sessionId)}">
<label for="email">Sign in as (test account)</label><input id="email" name="email" type="email" required value="${esc(email)}" autocomplete="off">
<fieldset><legend>Untick a scope to simulate granular consent</legend>${scopes.map((s, i) => `<label><input type="checkbox" name="scope" value="${esc(s)}" checked> ${esc(s)}</label>`).join('')}</fieldset>
<p><button name="decision" value="allow" type="submit">Allow</button><button name="decision" value="deny" type="submit">Deny</button></p></form></body></html>`
  }

  async function handleAuthorize(req, res, url) {
    S.counters.authorize += 1
    const p = Object.fromEntries(url.searchParams)
    const bad = (msg) => send(res, 400, `<!doctype html><title>Error 400</title><h1>Error 400: ${msg}</h1>`)
    if (p.response_type !== 'code') return bad('invalid_request: response_type must be code')
    if (!p.client_id || (config.clientId && p.client_id !== config.clientId)) return bad('invalid_client: unknown client id')
    if (!p.redirect_uri || !redirectAllowed(p.redirect_uri)) return bad('redirect_uri_mismatch')
    if (!p.scope) return bad('invalid_request: missing scope')
    if (p.code_challenge && p.code_challenge_method !== 'S256') return bad('invalid_request: only S256 is accepted')
    let next = S.nextAccounts.shift()
    if (!next) next = { email: EMAIL_RE.test(p.login_hint ?? '') ? p.login_hint : config.defaultEmail }
    const email = String(next.email).toLowerCase()
    const overrides = {}
    for (const k of ['hd', 'email_verified', 'sub']) if (next[k] !== undefined) overrides[k] = next[k]
    const account = { ...accountFor(email, overrides), email }
    if (config.interactive) {
      const id = rnd(12)
      S.pendingSessions.set(id, { p, email })
      return send(res, 200, consentPage(id, p, email))
    }
    return finishAuthorize(res, p, account, { deny: next.deny === true, scopesDenied: next.scopes_denied ?? [] })
  }

  async function handleDecision(req, res) {
    const params = new URLSearchParams(await readBody(req, 100_000))
    const sess = S.pendingSessions.get(params.get('session'))
    if (!sess) return send(res, 400, '<h1>Unknown session</h1>')
    S.pendingSessions.delete(params.get('session'))
    const email = String(params.get('email') || sess.email).toLowerCase()
    const chosen = params.getAll('scope')
    const requested = normalizeScopes(String(sess.p.scope).split(/\s+/).filter(Boolean))
    return finishAuthorize(res, sess.p, { ...accountFor(email), email }, { deny: params.get('decision') === 'deny', scopesDenied: requested.filter((x) => !chosen.includes(x)) })
  }

  // ------------------------------------------------------------------------------------------------ OAuth: token / userinfo / revoke
  async function handleToken(req, res) {
    S.counters.token += 1
    const raw = await readBody(req, 200_000)
    const ct = req.headers['content-type'] ?? ''
    const f = ct.includes('json') ? JSON.parse(raw || '{}') : parseForm(raw)
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')
    if (basic) {
      const [id, secret] = Buffer.from(basic[1], 'base64').toString().split(':')
      f.client_id ??= id
      f.client_secret ??= secret
    }
    const inj = takeInjection('token', { refreshToken: f.refresh_token })
    if (inj) {
      if (inj.mode === 'invalid_grant') return send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      if (failBefore(inj, req, res)) return undefined
    }
    if ((config.clientId && f.client_id !== config.clientId) || (config.clientSecret && f.client_secret !== config.clientSecret)) {
      return send(res, 401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' })
    }
    if (f.grant_type === 'authorization_code') {
      const c = S.codes.get(f.code)
      if (!c || c.used || Date.now() - c.createdAt > config.codeTtlSec * 1000 || c.clientId !== f.client_id) return send(res, 400, { error: 'invalid_grant', error_description: 'Malformed auth code.' })
      if (c.redirectUri !== f.redirect_uri) return send(res, 400, { error: 'redirect_uri_mismatch', error_description: 'Bad Request' })
      if (c.challenge) {
        if (!f.code_verifier) return send(res, 400, { error: 'invalid_grant', error_description: 'Missing code verifier.' })
        const expect = b64u(crypto.createHash('sha256').update(f.code_verifier).digest())
        if (expect !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid code verifier.' })
      }
      c.used = true
      let rt = null
      if (c.issueRefresh) {
        rt = `1//0fake-${b64u(crypto.randomBytes(32))}`
        S.refresh.set(rt, { email: c.email, scopes: c.scopes, clientId: c.clientId, revoked: false })
      }
      const at = issueAccess(c.email, c.scopes, rt ?? [...S.refresh.entries()].find(([, v]) => v.email === c.email && v.clientId === c.clientId && !v.revoked)?.[0] ?? null)
      const out = { access_token: at, expires_in: config.accessTokenTtlSec, scope: [...new Set(['openid', ...c.scopes])].join(' '), token_type: 'Bearer' }
      if (c.scopes.includes('openid')) out.id_token = idToken({ email: c.email, clientId: c.clientId, nonce: c.nonce })
      if (rt) out.refresh_token = rt
      return send(res, 200, out)
    }
    if (f.grant_type === 'refresh_token') {
      const r = S.refresh.get(f.refresh_token)
      if (!r || r.revoked) return send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      if (r.clientId !== f.client_id) return send(res, 401, { error: 'unauthorized_client', error_description: 'Unauthorized' })
      const at = issueAccess(r.email, r.scopes, f.refresh_token)
      return send(res, 200, { access_token: at, expires_in: config.accessTokenTtlSec, scope: [...new Set(['openid', ...r.scopes])].join(' '), token_type: 'Bearer' })
    }
    return send(res, 400, { error: 'unsupported_grant_type', error_description: 'Invalid grant_type' })
  }

  async function handleRevoke(req, res) {
    S.counters.revoke += 1
    const f = parseForm(await readBody(req, 50_000))
    const inj = takeInjection('revoke')
    if (failBefore(inj, req, res)) return undefined
    const t = f.token
    if (S.refresh.has(t)) {
      S.refresh.get(t).revoked = true
      for (const a of S.access.values()) if (a.refresh === t) a.revoked = true
      return send(res, 200, {})
    }
    if (S.access.has(t)) {
      S.access.get(t).revoked = true
      return send(res, 200, {})
    }
    return send(res, 400, { error: 'invalid_token', error_description: 'Token expired or revoked' })
  }

  // ------------------------------------------------------------------------------------------------ Gmail
  async function handleGmailSend(req, res) {
    S.counters.gmailSend += 1
    const who = authApi(req, res, SCOPE_GMAIL)
    if (!who) return undefined
    let body
    try {
      body = JSON.parse(await readBody(req, 50_000_000))
    } catch {
      return apiError(res, 400, 'Invalid JSON payload received.', 'invalid')
    }
    if (typeof body?.raw !== 'string' || !/^[A-Za-z0-9_=-]+$/.test(body.raw)) return apiError(res, 400, 'Invalid value for ByteString', 'invalidArgument')
    const mimeText = decodeBase64Url(body.raw).toString('utf8')
    const decoded = parseMime(mimeText)
    const recipient = [...decoded.addresses.to, ...decoded.addresses.cc].map((a) => a.email).join(',')
    const inj = takeInjection('gmail.send', { recipient })
    if (failBefore(inj, req, res)) return undefined
    const id = rnd(8)
    const msg = { id, threadId: body.threadId ?? id, at: new Date().toISOString(), account: who.email, sizeBytes: Buffer.byteLength(mimeText), mime: mimeText, decoded }
    S.messages.push(msg)
    if (failAfter(inj, req, res)) return undefined
    return send(res, 200, { id, threadId: msg.threadId, labelIds: ['SENT'] })
  }

  // ------------------------------------------------------------------------------------------------ Calendar
  const meetCode = () => {
    const l = 'abcdefghijklmnopqrstuvwxyz'
    const r = (n) => Array.from(crypto.randomBytes(n), (b) => l[b % 26]).join('')
    return `${r(3)}-${r(4)}-${r(3)}`
  }

  function renderEvent(ev, { poll = false } = {}) {
    const out = { ...ev }
    delete out._conf
    delete out._notify
    if (ev._conf) {
      const pending = ev._conf.pendingGets > 0
      if (poll && pending) ev._conf.pendingGets -= 1
      const key = { type: 'hangoutsMeet' }
      if (pending) out.conferenceData = { createRequest: { requestId: ev._conf.requestId, conferenceSolutionKey: key, status: { statusCode: 'pending' } } }
      else {
        const link = `https://meet.google.com/${ev._conf.code}`
        out.conferenceData = {
          createRequest: { requestId: ev._conf.requestId, conferenceSolutionKey: key, status: { statusCode: 'success' } },
          entryPoints: [{ entryPointType: 'video', uri: link, label: `meet.google.com/${ev._conf.code}` }, { entryPointType: 'more', uri: `https://tel.meet/${ev._conf.code}?pin=0000000000`, pin: '0000000000' }],
          conferenceSolution: { key, name: 'Google Meet', iconUri: 'https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v6/web-512dp/logo_meet_2020q4_color_2x_web_512dp.png' },
          conferenceId: ev._conf.code,
        }
        out.hangoutLink = link
      }
    }
    return out
  }

  const calendarOf = (email) => {
    if (!S.events.has(email)) S.events.set(email, new Map())
    return S.events.get(email)
  }

  function validateEventBody(res, b, { partial = false } = {}) {
    const bad = (m, reason = 'invalid') => { apiError(res, 400, m, reason); return false }
    for (const side of ['start', 'end']) {
      if (b[side] === undefined) { if (partial) continue; return bad(`Missing ${side} time.`, 'required') }
      const t = b[side]
      if (!t || typeof t !== 'object' || (!t.dateTime && !t.date)) return bad(`Invalid ${side} time.`)
      if (t.dateTime) {
        if (Number.isNaN(Date.parse(t.dateTime))) return bad(`Invalid ${side} time.`)
        if (!/(Z|[+-]\d\d:\d\d)$/.test(t.dateTime) && !t.timeZone) return bad(`Missing time zone definition for ${side} time.`, 'required')
      }
      if (t.timeZone) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: t.timeZone }) } catch { return bad('Invalid time zone definition for ' + side + ' time.') }
      }
    }
    if (b.start?.dateTime && b.end?.dateTime && Date.parse(b.end.dateTime) <= Date.parse(b.start.dateTime)) return bad('The specified time range is empty.', 'timeRangeEmpty')
    if (b.attendees !== undefined) {
      if (!Array.isArray(b.attendees)) return bad('Invalid attendees.')
      for (const a of b.attendees) if (!EMAIL_RE.test(String(a?.email ?? ''))) return bad('Invalid attendee email.')
    }
    return true
  }

  async function handleCalendar(req, res, url, m) {
    S.counters.calendar += 1
    const who = authApi(req, res, SCOPE_CAL)
    if (!who) return undefined
    const cal = decodeURIComponent(m[1])
    if (cal !== 'primary' && cal.toLowerCase() !== who.email) return apiError(res, 404, 'Not Found', 'notFound')
    const id = m[2] ? decodeURIComponent(m[2]) : null
    const events = calendarOf(who.email)
    const q = url.searchParams

    if (!id && req.method === 'POST') {
      let b
      try { b = JSON.parse(await readBody(req, 2_000_000)) } catch { return apiError(res, 400, 'Invalid JSON payload received.', 'parseError') }
      const inj = takeInjection('calendar.insert', { eventId: b?.id })
      if (failBefore(inj, req, res)) return undefined
      if (!validateEventBody(res, b)) return undefined
      if (b.id !== undefined && !EVENT_ID_RE.test(String(b.id))) return apiError(res, 400, 'Invalid resource id value.', 'invalid')
      const evId = b.id ?? [...crypto.randomBytes(13)].map((x) => '0123456789abcdefghijklmnopqrstuv'[x % 32]).join('')
      if (events.has(evId)) return apiError(res, 409, 'The requested identifier already exists.', 'duplicate')
      const now = new Date().toISOString()
      const ev = {
        kind: 'calendar#event', etag: `"${rnd(6)}"`, id: evId, status: 'confirmed', htmlLink: `https://www.google.com/calendar/event?eid=${b64u(`${evId} ${who.email}`)}`,
        created: now, updated: now, summary: b.summary ?? '', description: b.description, location: b.location, start: b.start, end: b.end,
        creator: { email: who.email, self: true }, organizer: { email: who.email, self: true }, iCalUID: `${evId}@google.com`, sequence: 0,
        attendees: (b.attendees ?? []).map((a) => ({ email: String(a.email).toLowerCase(), responseStatus: 'needsAction' })),
        guestsCanModify: b.guestsCanModify ?? false, guestsCanInviteOthers: b.guestsCanInviteOthers ?? true, reminders: { useDefault: true }, eventType: 'default',
      }
      for (const k of Object.keys(ev)) if (ev[k] === undefined) delete ev[k]
      ev._notify = q.get('sendUpdates') ?? 'none'
      const wantsMeet = q.get('conferenceDataVersion') === '1' && b.conferenceData?.createRequest
      if (wantsMeet) ev._conf = { requestId: String(b.conferenceData.createRequest.requestId ?? ''), code: meetCode(), pendingGets: config.meetAsync ? config.meetPendingGets : 0 }
      events.set(evId, ev)
      if (failAfter(inj, req, res)) return undefined
      return send(res, 200, renderEvent(ev))
    }

    if (!id) return apiError(res, 404, 'Not Found', 'notFound')
    const ev = events.get(id)

    if (req.method === 'GET') {
      const inj = takeInjection('calendar.get', { eventId: id })
      if (failBefore(inj, req, res)) return undefined
      if (!ev) return apiError(res, 404, 'Not Found', 'notFound')
      return send(res, 200, renderEvent(ev, { poll: true }))
    }

    if (req.method === 'PATCH') {
      let b
      try { b = JSON.parse(await readBody(req, 2_000_000)) } catch { return apiError(res, 400, 'Invalid JSON payload received.', 'parseError') }
      const inj = takeInjection('calendar.patch', { eventId: id })
      if (failBefore(inj, req, res)) return undefined
      if (!ev) return apiError(res, 404, 'Not Found', 'notFound')
      if (ev.status === 'cancelled' && b.status !== 'confirmed') return apiError(res, 410, 'Resource has been deleted', 'deleted')
      if (!validateEventBody(res, b, { partial: true })) return undefined
      if (b.start || b.end) {
        const next = { start: b.start ?? ev.start, end: b.end ?? ev.end }
        if (next.start.dateTime && next.end.dateTime && Date.parse(next.end.dateTime) <= Date.parse(next.start.dateTime)) return apiError(res, 400, 'The specified time range is empty.', 'timeRangeEmpty')
      }
      for (const k of ['summary', 'description', 'location', 'start', 'end', 'status', 'guestsCanModify', 'guestsCanInviteOthers']) if (b[k] !== undefined) ev[k] = b[k]
      if (b.attendees !== undefined) {
        const prev = new Map((ev.attendees ?? []).map((a) => [a.email, a]))
        ev.attendees = b.attendees.map((a) => prev.get(String(a.email).toLowerCase()) ?? { email: String(a.email).toLowerCase(), responseStatus: 'needsAction' })
      }
      ev.sequence += 1
      ev.updated = new Date().toISOString()
      ev._notify = q.get('sendUpdates') ?? 'none'
      if (failAfter(inj, req, res)) return undefined
      return send(res, 200, renderEvent(ev))
    }

    if (req.method === 'DELETE') {
      const inj = takeInjection('calendar.delete', { eventId: id })
      if (failBefore(inj, req, res)) return undefined
      if (!ev) return apiError(res, 404, 'Not Found', 'notFound')
      if (ev.status === 'cancelled') return apiError(res, 410, 'Resource has been deleted', 'deleted')
      ev.status = 'cancelled'
      ev.updated = new Date().toISOString()
      ev._notify = q.get('sendUpdates') ?? 'none'
      if (failAfter(inj, req, res)) return undefined
      res.writeHead(204, { 'cache-control': 'no-store' })
      return res.end()
    }
    return apiError(res, 405, 'Method Not Allowed', 'methodNotAllowed')
  }

  // ------------------------------------------------------------------------------------------------ control + inspection
  const mask = (t) => (t.length > 12 ? `${t.slice(0, 8)}...${t.slice(-4)}` : '***')
  function stateView(includeTokens) {
    const tok = (t) => (includeTokens ? t : mask(t))
    const eventsOut = {}
    for (const [email, map] of S.events) eventsOut[email] = [...map.values()].map((e) => ({ ...e, _notify: undefined, _conf: undefined, sendUpdates: e._notify, meetCode: e._conf?.code ?? null, meetRequestId: e._conf?.requestId ?? null }))
    return {
      config: { ...config },
      counters: { ...S.counters },
      accounts: [...S.accounts.entries()].map(([email, a]) => ({ email, ...a })),
      refreshTokens: [...S.refresh.entries()].map(([t, v]) => ({ token: tok(t), email: v.email, scopes: v.scopes, revoked: v.revoked })),
      accessTokens: [...S.access.entries()].map(([t, v]) => ({ token: tok(t), email: v.email, expired: v.expiresAt <= Date.now(), revoked: v.revoked })),
      messages: S.messages.map((m) => ({ id: m.id, at: m.at, account: m.account, sizeBytes: m.sizeBytes, subject: m.decoded.headers.subject, from: m.decoded.addresses.from, to: m.decoded.addresses.to, cc: m.decoded.addresses.cc, replyTo: m.decoded.addresses.replyTo, messageId: m.decoded.headers.messageId, text: m.decoded.text, html: m.decoded.html, problems: m.decoded.problems, mime: m.mime })),
      events: eventsOut,
      injections: S.injections.map((i) => ({ ...i })),
      calls: S.calls.slice(-500),
    }
  }

  async function handleControl(req, res, url) {
    const path = url.pathname
    if (req.method === 'GET' && path === '/__health') return send(res, 200, { ok: true })
    if (req.method === 'GET' && path === '/__state') return send(res, 200, stateView(url.searchParams.get('include_tokens') === '1'))
    if (req.method === 'GET' && path === '/__messages') return send(res, 200, stateView(false).messages)
    if (req.method === 'GET' && path === '/__events') return send(res, 200, stateView(false).events)
    if (req.method === 'POST' && path === '/__reset') { reset(); Object.assign(config, initialConfig); return send(res, 200, { ok: true }) }
    const body = req.method === 'POST' ? JSON.parse((await readBody(req, 100_000)) || '{}') : {}
    if (req.method === 'POST' && path === '/__control/next-account') { S.nextAccounts.push(body); return send(res, 200, { queued: S.nextAccounts.length }) }
    if (req.method === 'POST' && path === '/__control/config') {
      for (const k of Object.keys(DEFAULT_CONFIG)) if (body[k] !== undefined) config[k] = body[k]
      return send(res, 200, { config })
    }
    if (req.method === 'POST' && path === '/__control/inject') {
      const inj = { id: rnd(4), target: body.target ?? '*', mode: body.mode, times: body.times === undefined ? 1 : body.times, after: body.after ?? 0, retryAfter: body.retryAfter ?? 2, match: body.match ?? null, hits: 0 }
      if (!inj.mode) return send(res, 400, { error: 'mode required' })
      S.injections.push(inj)
      return send(res, 200, { id: inj.id })
    }
    if (req.method === 'POST' && path === '/__control/clear-injections') { S.injections = []; return send(res, 200, { ok: true }) }
    if (req.method === 'POST' && path === '/__control/expire-access-tokens') { for (const a of S.access.values()) a.expiresAt = 0; return send(res, 200, { ok: true }) }
    if (req.method === 'POST' && path === '/__control/revoke-all') {
      const email = String(body.email ?? '').toLowerCase()
      let n = 0
      for (const r of S.refresh.values()) if (r.email === email && !r.revoked) { r.revoked = true; n += 1 }
      return send(res, 200, { revoked: n })
    }
    return send(res, 404, { error: 'unknown control endpoint' })
  }

  // ------------------------------------------------------------------------------------------------ router
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    const started = Date.now()
    const isControl = url.pathname.startsWith('/__')
    if (!isControl) res.on('finish', () => S.calls.push({ t: new Date(started).toISOString(), method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started }))
    if (!isControl) res.on('close', () => { if (!res.writableEnded) S.calls.push({ t: new Date(started).toISOString(), method: req.method, path: url.pathname, status: 0, ms: Date.now() - started, note: 'no response sent' }) })
    if (verbose) console.error(`[fake-google] ${req.method} ${url.pathname}`)
    try {
      if (isControl) return await handleControl(req, res, url)
      if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') return await handleAuthorize(req, res, url)
      if (req.method === 'POST' && url.pathname === '/o/oauth2/v2/auth/decision') return await handleDecision(req, res)
      if (req.method === 'POST' && (url.pathname === '/token' || url.pathname === '/oauth2/v4/token')) return await handleToken(req, res)
      if (req.method === 'POST' && url.pathname === '/revoke') return await handleRevoke(req, res)
      if (req.method === 'GET' && (url.pathname === '/oauth2/v3/userinfo' || url.pathname === '/oauth2/v2/userinfo')) {
        const who = authApi(req, res, null)
        if (!who) return undefined
        const a = accountFor(who.email)
        return send(res, 200, { sub: a.sub, email: who.email, email_verified: a.email_verified, hd: a.hd })
      }
      if (req.method === 'POST' && url.pathname === '/gmail/v1/users/me/messages/send') return await handleGmailSend(req, res)
      const cm = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname)
      if (cm) return await handleCalendar(req, res, url, cm)
      return send(res, 404, { error: { code: 404, message: `Not Found: ${url.pathname}` } })
    } catch (e) {
      if (!res.headersSent) return send(res, e.status ?? 500, { error: { code: e.status ?? 500, message: String(e.message ?? e).slice(0, 200) } })
      res.end()
      return undefined
    }
  })
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  server.keepAliveTimeout = 1000

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve) })
  const port = server.address().port
  return {
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    port,
    host,
    config,
    get state() { return stateView(true) },
    reset,
    /** queue the account the NEXT authorize request signs in as. */
    nextAccount: (acct) => S.nextAccounts.push(acct),
    inject: (inj) => S.injections.push({ id: rnd(4), target: '*', times: 1, after: 0, retryAfter: 2, match: null, hits: 0, ...inj }),
    close: () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()) }),
  }
}

// ------------------------------------------------------------------------------------------------ CLI
function argv(name, multi = false) {
  const out = []
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}`) {
      if (!multi && (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--'))) return true
      out.push(process.argv[++i])
    }
  }
  return multi ? out : out[0]
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const redirects = [...argv('redirect-uri', true), ...String(process.env.FAKE_GOOGLE_REDIRECT_URIS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]
  const g = await startFakeGoogle({
    port: Number(argv('port') ?? process.env.FAKE_GOOGLE_PORT ?? 54399),
    host: argv('host') ?? process.env.FAKE_GOOGLE_HOST ?? '127.0.0.1',
    clientId: argv('client-id') ?? process.env.FAKE_GOOGLE_CLIENT_ID ?? null,
    clientSecret: argv('client-secret') ?? process.env.FAKE_GOOGLE_CLIENT_SECRET ?? null,
    redirectUris: redirects.length ? redirects : null,
    defaultEmail: argv('default-email') ?? process.env.FAKE_GOOGLE_DEFAULT_EMAIL ?? undefined,
    interactive: argv('interactive') === true,
    verbose: argv('verbose') === true,
  })
  console.log(`fake-google listening on ${g.url} (bound to ${g.host}). Local tests only: this is NOT Google.`)
  const stop = async () => { await g.close(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
