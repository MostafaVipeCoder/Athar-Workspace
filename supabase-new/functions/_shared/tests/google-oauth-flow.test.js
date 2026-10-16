// The three OAuth endpoints end to end: real handlers + the real edge wiring (google-edge.js) + the fake Google server + an
// in-memory twin of the m61 RPCs. No real Google endpoint and no database are touched.
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeGoogle } from '../../../../db/scripts/fake-google/server.mjs'
import { DbError, RPC_CONTRACT, createEdgeRuntime, createRpcDb } from '../google-edge.js'
import { REASONS } from '../google-oauth-handlers.js'
import { REQUIRED_SCOPES, verifyState } from '../google-core.js'
import { sendGmailMessage } from '../google-api.js'
import { makeMimeMessage } from '../google-mime.js'
import { resolveSender } from '../google-sender.js'
import { APP_URL, REDIRECT_URI, TEST_CLIENT_ID, TEST_CLIENT_SECRET, TEST_STATE_SECRET, USERS, makeEnv, usersById } from './helpers/env.js'
import { createMemoryDb } from './helpers/memory-db.js'

let fake
const ctl = (path, body) => fetch(`${fake.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json())
const fakeState = () => fetch(`${fake.url}/__state?include_tokens=1`).then((r) => r.json())

before(async () => { fake = await startFakeGoogle({ port: 0, clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET }) })
after(async () => { await fake.close() })
beforeEach(async () => { await fetch(`${fake.url}/__reset`, { method: 'POST' }) })

/** Build the edge runtime exactly as the entry points do, but with a stub supabase-js client over the memory db. */
function makeRuntime({ env = {}, vault = true, now, maxOpenStates } = {}) {
  const clock = { t: Date.now() }
  const db = createMemoryDb({ users: usersById(), vault, maxOpenStates, now: () => (now ? now() : clock.t) })
  const logs = []
  const client = {
    async rpc(name, a) {
      try {
        switch (name) {
          case 'google_storage_capabilities': return { data: await db.storageCapabilities(), error: null }
          case 'google_oauth_begin': return { data: await db.oauthBegin({ userId: a.p_user, nonceHash: a.p_nonce_hash, isSystem: a.p_is_system, expiresAt: a.p_expires_at }), error: null }
          case 'google_oauth_consume': return { data: await db.oauthConsume({ nonceHash: a.p_nonce_hash }), error: null }
          case 'google_connection_upsert': return { data: await db.upsertConnection({ ownerUserId: a.p_owner, actorId: a.p_actor, isSystem: false, email: a.p_email, googleSub: a.p_google_sub, scopes: a.p_scopes, storage: a.p_storage, secret: a.p_secret }), error: null }
          case 'set_system_connection': return { data: await db.upsertConnection({ ownerUserId: null, actorId: a.p_actor, isSystem: true, email: a.p_email, googleSub: a.p_google_sub, scopes: a.p_scopes, storage: a.p_storage, secret: a.p_secret }), error: null }
          case 'google_secret_get': return { data: await db.getSecret(a.p_connection), error: null }
          case 'google_connection_lookup': return { data: await db.lookupConnection({ userId: a.p_user, system: a.p_system }), error: null }
          case 'google_connection_mark': return { data: await db.markConnection(a.p_connection, a.p_status, a.p_error), error: null }
          case 'google_connection_touch': return { data: await db.touchConnection(a.p_connection), error: null }
          case 'resolve_sender_connection': return { data: await db.resolveSender(a.p_user_id), error: null }
          default: return { data: null, error: { message: `unknown rpc ${name}` } }
        }
      } catch (e) {
        return { data: null, error: { hint: e.token, message: `${e.token}: x`, code: 'P0001' } }
      }
    },
    auth: {
      async getUser(jwt) {
        const m = /^test\.([0-9a-f-]{36})\.sig[A-Za-z0-9]+$/.exec(jwt)
        const u = m && Object.values(USERS).find((x) => x.id === m[1])
        return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }
      },
    },
  }
  const runtime = createEdgeRuntime({
    env: { get: (n) => ({ ...makeEnv(fake), SUPABASE_URL: 'http://stub', SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key-not-real', ...env })[n] },
    createClient: () => client,
    now: () => (now ? now() : clock.t),
    log: (event, fields) => logs.push({ event, ...fields }),
  })
  return { runtime, db, logs, clock }
}

const bearer = (u) => ({ authorization: `Bearer test.${u.id}.sigAAAAAAAAAAAAAAAAAAAA` })
const post = (runtime, fn, user, body, headers = {}) =>
  runtime[fn](new Request('http://functions.local/x', { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? bearer(user) : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }))

/** Start -> the authorize URL -> Google (auto approve) -> the callback URL the browser would be sent to. */
async function startFlow(runtime, user, body = {}, account = {}) {
  const res = await post(runtime, 'start', user, body)
  assert.equal(res.status, 200, await res.clone().text())
  const { url } = await res.json()
  if (Object.keys(account).length) await ctl('/__control/next-account', account)
  const a = await fetch(url, { redirect: 'manual' })
  assert.equal(a.status, 302)
  return { url, callbackUrl: a.headers.get('location') }
}
const callback = (runtime, url, init = {}) => runtime.callback(new Request(url, { method: 'GET', ...init }))
const locOf = (res) => new URL(res.headers.get('location'))

describe('google-oauth-start', () => {
  test('requires a signed-in user, POST, and answers the CORS preflight only for the app origin', async () => {
    const { runtime } = makeRuntime()
    assert.equal((await post(runtime, 'start', null, {})).status, 401)
    assert.equal((await runtime.start(new Request('http://f/x', { method: 'GET', headers: bearer(USERS.pm) }))).status, 405)
    assert.equal((await post(runtime, 'start', { id: '99999999-9999-4999-8999-999999999999' }, {})).status, 401)
    const ok = await runtime.start(new Request('http://f/x', { method: 'OPTIONS', headers: { origin: new URL(APP_URL).origin } }))
    assert.equal(ok.status, 204)
    assert.equal(ok.headers.get('access-control-allow-origin'), new URL(APP_URL).origin)
    const evil = await runtime.start(new Request('http://f/x', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))
    assert.equal(evil.headers.get('access-control-allow-origin'), null)
  })

  test('returns a Google URL with PKCE + a verifiable state bound to the user; the nonce is recorded once', async () => {
    const { runtime, db } = makeRuntime()
    const res = await post(runtime, 'start', USERS.pm, { returnTo: '/projects/p1/nodes/n1/settings' })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const body = await res.json()
    const u = new URL(body.url)
    assert.equal(u.searchParams.get('login_hint'), USERS.pm.email)
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
    const v = await verifyState({ secret: TEST_STATE_SECRET, state: u.searchParams.get('state') })
    assert.equal(v.ok, true)
    assert.deepEqual([v.payload.userId, v.payload.system, v.payload.returnTo], [USERS.pm.id, false, '/projects/p1/nodes/n1/settings'])
    assert.equal(db.states.size, 1)
    const [[hash, row]] = [...db.states]
    assert.match(hash, /^[0-9a-f]{64}$/)
    assert.ok(!hash.includes(v.payload.nonce))
    assert.equal(row.userId, USERS.pm.id)
  })

  test('roles: a founder is refused; `system` is for super_admin only (also re-checked in the database)', async () => {
    const { runtime } = makeRuntime()
    assert.equal((await post(runtime, 'start', USERS.founder, {})).status, 403)
    assert.equal((await post(runtime, 'start', USERS.pm, { system: true })).status, 403)
    const sys = await post(runtime, 'start', USERS.admin, { system: true })
    assert.equal(sys.status, 200)
    const u = new URL((await sys.json()).url)
    assert.equal(u.searchParams.has('login_hint'), false)
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: u.searchParams.get('state') })).payload.system, true)
  })

  test('a hostile returnTo becomes /profile; a non-JSON or oversized body is a 400; too many open attempts is a 429', async () => {
    const { runtime } = makeRuntime({ maxOpenStates: 3 })
    for (const bad of ['https://evil.example/x', '//evil.example', '/a/../b']) {
      const u = new URL((await (await post(runtime, 'start', USERS.pm, { returnTo: bad })).json()).url)
      assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: u.searchParams.get('state') })).payload.returnTo, '/profile', bad)
    }
    assert.equal((await post(runtime, 'start', USERS.pm, '{not json')).status, 400)
    assert.equal((await post(runtime, 'start', USERS.pm, '[1,2]')).status, 400)
    assert.equal((await post(runtime, 'start', USERS.pm, { returnTo: 'x'.repeat(3000) })).status, 400)
    assert.equal((await post(runtime, 'start', USERS.pm, {})).status, 429)
  })

  test('an unconfigured function answers 503 and says nothing else', async () => {
    const { runtime } = makeRuntime({ env: { GOOGLE_CLIENT_ID: '' } })
    const res = await post(runtime, 'start', USERS.pm, {})
    assert.deepEqual([res.status, await res.json()], [503, { error: 'not_configured' }])
    assert.equal((await callback(runtime, 'http://f/cb?state=x&code=y')).status, 503)
  })
})

describe('google-oauth-callback: the connect flow', () => {
  for (const [label, opts, storage] of [['Vault', {}, 'vault'], ['AES-256-GCM (no Vault on the image)', { vault: false }, 'aes']]) {
    test(`happy path with ${label}: a connection row, the token stored server-side only, a clean redirect`, async () => {
      const { runtime, db, logs } = makeRuntime(opts)
      const { callbackUrl } = await startFlow(runtime, USERS.pm, { returnTo: '/projects/p1/nodes/n1/settings' })
      const res = await callback(runtime, callbackUrl)
      assert.equal(res.status, 302)
      const loc = locOf(res)
      assert.equal(`${loc.origin}${loc.pathname}`, `${APP_URL}/projects/p1/nodes/n1/settings`)
      assert.equal(loc.search, '?google=connected')
      assert.equal(res.headers.get('cache-control'), 'no-store')
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer')

      const [row] = [...db.connections.values()]
      assert.deepEqual([row.kind, row.owner_user_id, row.email, row.status, row.token_storage, row.last_error], ['user', USERS.pm.id, 'fake.user@athareg.com'.replace('fake.user', 'pm.one'), 'active', storage, null])
      assert.ok(REQUIRED_SCOPES.every((s) => row.scopes.includes(s)))
      const issued = (await fakeState()).refreshTokens[0].token
      const stored = storage === 'vault' ? db.vaultSecrets.get(row.id) : db.ciphertexts.get(row.id)
      if (storage === 'vault') assert.equal(stored, issued)
      else assert.ok(!stored.includes(issued) && /^v1\./.test(stored))
      assert.equal(await (await runtime.getStore()).load(row.id), issued)

      const everything = JSON.stringify({ logs, loc: res.headers.get('location'), row })
      const url = new URL(callbackUrl)
      for (const secret of [issued, url.searchParams.get('code'), url.searchParams.get('state'), TEST_CLIENT_SECRET, TEST_STATE_SECRET]) assert.ok(!everything.includes(secret), 'a secret leaked into a log / redirect / row')
    })
  }

  test('the stored token WORKS: the worker path gets an access token and sends a Gmail message as the connected account; then Google revokes -> needs_reconnect -> system fallback', async () => {
    const { runtime, db } = makeRuntime()
    await runtime.callback(new Request((await startFlow(runtime, USERS.admin, { system: true }, { email: 'startups@athareg.com' })).callbackUrl))
    const { callbackUrl } = await startFlow(runtime, USERS.pm)
    assert.equal(locOf(await callback(runtime, callbackUrl)).searchParams.get('google'), 'connected')
    const pmConn = [...db.connections.values()].find((c) => c.kind === 'user')
    const tokens = runtime.accessTokens()
    const at = await tokens.getAccessToken(pmConn.id)
    const m = makeMimeMessage({ from: { email: pmConn.email }, to: ['founder@example.com'], subject: 'مرحبا', text: 'x', messageId: 'o1@athareg.com' })
    await sendGmailMessage(runtime.getConfig(), at, m.raw)
    assert.equal((await fakeState()).messages[0].account, 'pm.one@athareg.com')
    await ctl('/__control/revoke-all', { email: 'pm.one@athareg.com' })
    await assert.rejects(tokens.getAccessToken(pmConn.id, { force: true }), (e) => e.code === 'invalid_grant' && e.needsReconnect)
    assert.deepEqual([pmConn.status, pmConn.last_error], ['needs_reconnect', 'invalid_grant'])
    const sender = resolveSender({ userId: USERS.pm.id, connections: [...db.connections.values()] })
    assert.deepEqual([sender.source, sender.connection.email, sender.reason], ['system', 'startups@athareg.com', 'user_needs_reconnect'])
    assert.equal(await db.resolveSender(USERS.pm.id), sender.connection.id)
  })

  test('REPLAY: the same callback URL used twice connects once and the second answer is state_replayed', async () => {
    const { runtime, db } = makeRuntime()
    const { callbackUrl } = await startFlow(runtime, USERS.pm)
    assert.equal(locOf(await callback(runtime, callbackUrl)).searchParams.get('google'), 'connected')
    const secretBefore = [...db.vaultSecrets.values()][0]
    const second = locOf(await callback(runtime, callbackUrl))
    assert.deepEqual([second.searchParams.get('google'), second.searchParams.get('reason')], ['error', 'state_replayed'])
    assert.equal(db.connections.size, 1)
    assert.equal([...db.vaultSecrets.values()][0], secretBefore)
  })

  test('EXPIRY: a state older than 10 minutes is refused (state_expired), even with a valid signature', async () => {
    let t = Date.UTC(2026, 9, 15, 10, 0, 0)
    const { runtime, db } = makeRuntime({ now: () => t })
    const { callbackUrl } = await startFlow(runtime, USERS.pm)
    t += 10 * 60 * 1000 + 1000
    const loc = locOf(await callback(runtime, callbackUrl))
    assert.deepEqual([loc.searchParams.get('google'), loc.searchParams.get('reason')], ['error', 'state_expired'])
    assert.equal(db.connections.size, 0)
  })

  test('a state minted for user A cannot be completed as user B, a tampered / missing / foreign state is invalid_state', async () => {
    const { runtime, db } = makeRuntime()
    const { callbackUrl } = await startFlow(runtime, USERS.pm)
    const u = new URL(callbackUrl)
    const state = u.searchParams.get('state')
    const [body, mac] = state.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    const forged = `${Buffer.from(JSON.stringify({ ...payload, u: USERS.pm2.id })).toString('base64url')}.${mac}`
    for (const bad of [forged, '', 'garbage', `${state}x`, state.split('.')[0]]) {
      const x = new URL(callbackUrl)
      x.searchParams.set('state', bad)
      const loc = locOf(await callback(runtime, x.toString()))
      assert.deepEqual([loc.searchParams.get('google'), loc.searchParams.get('reason')], ['error', 'invalid_state'], bad.slice(0, 20))
      assert.equal(`${loc.origin}${loc.pathname}`, `${APP_URL}/profile`)
    }
    const nostate = locOf(await callback(runtime, `${REDIRECT_URI}?code=abc`))
    assert.equal(nostate.searchParams.get('reason'), 'invalid_state')
    assert.equal(db.connections.size, 0)
    // the real one still works afterwards (the failed attempts did not consume the nonce)
    assert.equal(locOf(await callback(runtime, callbackUrl)).searchParams.get('google'), 'connected')
  })

  test('the redirect NEVER reflects request input: error / code / state / reason / returnTo are not echoed, every reason is from the fixed list', async () => {
    const { runtime } = makeRuntime()
    const { callbackUrl } = await startFlow(runtime, USERS.pm)
    const u = new URL(callbackUrl)
    u.searchParams.set('error', '<script>alert(1)</script>')
    u.searchParams.delete('code')
    u.searchParams.set('reason', 'evil')
    u.searchParams.set('returnTo', 'https://evil.example')
    const res = await callback(runtime, u.toString())
    const loc = locOf(res)
    assert.equal(loc.origin, new URL(APP_URL).origin)
    assert.ok(!res.headers.get('location').includes('script') && !res.headers.get('location').includes('evil'))
    assert.ok(REASONS.includes(loc.searchParams.get('reason')))
    assert.deepEqual([...loc.searchParams.keys()].sort(), ['google', 'reason'])
  })

  test('the user denies at Google: access_denied, the nonce is spent', async () => {
    const { runtime, db } = makeRuntime()
    const { callbackUrl } = await startFlow(runtime, USERS.pm, {}, { email: 'pm.one@athareg.com', deny: true })
    const loc = locOf(await callback(runtime, callbackUrl))
    assert.deepEqual([loc.searchParams.get('google'), loc.searchParams.get('reason')], ['error', 'access_denied'])
    assert.equal(db.connections.size, 0)
    assert.equal(locOf(await callback(runtime, callbackUrl)).searchParams.get('reason'), 'state_replayed')
  })

  test('a wrong code is exchange_failed (and nothing is stored)', async () => {
    const { runtime, db } = makeRuntime()
    const { callbackUrl } = await startFlow(runtime, USERS.pm)
    const u = new URL(callbackUrl)
    u.searchParams.set('code', '4/0Afake-not-a-real-code')
    assert.equal(locOf(await callback(runtime, u.toString())).searchParams.get('reason'), 'exchange_failed')
    assert.equal(db.connections.size, 0)
  })

  test('DOMAIN: a non-Workspace account is refused and the grant is revoked at Google', async () => {
    const { runtime, db } = makeRuntime()
    for (const [account, reason] of [[{ email: 'someone@gmail.com', hd: null }, 'wrong_domain'], [{ email: 'x@other.org' }, 'wrong_domain'], [{ email: 'pm.one@athareg.com', email_verified: false }, 'email_unverified']]) {
      await fetch(`${fake.url}/__reset`, { method: 'POST' })
      const { callbackUrl } = await startFlow(runtime, USERS.pm, {}, account)
      const loc = locOf(await callback(runtime, callbackUrl))
      assert.deepEqual([loc.searchParams.get('google'), loc.searchParams.get('reason')], ['error', reason], JSON.stringify(account))
      assert.equal(db.connections.size, 0)
      assert.ok((await fakeState()).refreshTokens.every((r) => r.revoked), 'the refresh token was not revoked')
    }
  })

  test('E-MAIL POLICY (account-linking CSRF): a colleague\'s account on MY link is email_mismatch; same_domain relaxes it', async () => {
    const strict = makeRuntime()
    const a = await startFlow(strict.runtime, USERS.pm, {}, { email: 'pm.two@athareg.com' })
    assert.equal(locOf(await callback(strict.runtime, a.callbackUrl)).searchParams.get('reason'), 'email_mismatch')
    assert.equal(strict.db.connections.size, 0)
    assert.ok((await fakeState()).refreshTokens.every((r) => r.revoked))
    const relaxed = makeRuntime({ env: { GOOGLE_PM_EMAIL_POLICY: 'same_domain' } })
    const b = await startFlow(relaxed.runtime, USERS.pm, {}, { email: 'pm.two@athareg.com' })
    assert.equal(locOf(await callback(relaxed.runtime, b.callbackUrl)).searchParams.get('google'), 'connected')
    assert.equal([...relaxed.db.connections.values()][0].email, 'pm.two@athareg.com')
  })

  test('a Google account can belong to ONE platform user (email_in_use)', async () => {
    const { runtime, db } = makeRuntime({ env: { GOOGLE_PM_EMAIL_POLICY: 'same_domain' } })
    const a = await startFlow(runtime, USERS.pm, {}, { email: 'shared@athareg.com' })
    assert.equal(locOf(await callback(runtime, a.callbackUrl)).searchParams.get('google'), 'connected')
    const b = await startFlow(runtime, USERS.pm2, {}, { email: 'shared@athareg.com' })
    assert.equal(locOf(await callback(runtime, b.callbackUrl)).searchParams.get('reason'), 'email_in_use')
    assert.equal(db.connections.size, 1)
  })

  test('granular consent: without BOTH scopes the connection is refused (missing_scopes) and revoked', async () => {
    for (const denied of ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send']) {
      await fetch(`${fake.url}/__reset`, { method: 'POST' })
      const { runtime, db } = makeRuntime()
      const { callbackUrl } = await startFlow(runtime, USERS.pm, {}, { email: 'pm.one@athareg.com', scopes_denied: [denied] })
      assert.equal(locOf(await callback(runtime, callbackUrl)).searchParams.get('reason'), 'missing_scopes')
      assert.equal(db.connections.size, 0)
      assert.ok((await fakeState()).refreshTokens.every((r) => r.revoked))
    }
  })

  test('no refresh token in the answer: no_refresh_token (the access token is revoked)', async () => {
    const stripping = async (url, init) => {
      const res = await fetch(url, init)
      if (!String(url).endsWith('/token') || !res.ok) return res
      const j = await res.json()
      delete j.refresh_token
      return new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const db = createMemoryDb({ users: usersById() })
    const runtime = createEdgeRuntime({
      env: { get: (n) => makeEnv(fake)[n] },
      createClient: () => ({ rpc: async () => ({ data: null, error: null }) }),
      fetch: stripping,
    })
    // use the handlers with the memory db directly (the stub client above is irrelevant here)
    const { createHandlers } = await import('../google-oauth-handlers.js')
    const { createTokenStore } = await import('../google-core.js')
    const h = createHandlers({ getConfig: runtime.getConfig, authenticate: async () => ({ userId: USERS.pm.id, email: USERS.pm.email }), db, getStore: async () => createTokenStore({ db, mode: 'vault' }), fetch: stripping })
    const started = await (await h.start(new Request('http://f/x', { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{}' }))).json()
    const loc = (await fetch(started.url, { redirect: 'manual' })).headers.get('location')
    assert.equal(locOf(await h.callback(new Request(loc))).searchParams.get('reason'), 'no_refresh_token')
    assert.equal(db.connections.size, 0)
  })

  test('RECONNECT: the same PM connecting again keeps the connection id, replaces the secret and clears needs_reconnect', async () => {
    const { runtime, db } = makeRuntime()
    assert.equal(locOf(await callback(runtime, (await startFlow(runtime, USERS.pm)).callbackUrl)).searchParams.get('google'), 'connected')
    const [row] = [...db.connections.values()]
    const first = db.vaultSecrets.get(row.id)
    await db.markConnection(row.id, 'needs_reconnect', 'invalid_grant')
    assert.equal(locOf(await callback(runtime, (await startFlow(runtime, USERS.pm)).callbackUrl)).searchParams.get('google'), 'connected')
    assert.equal(db.connections.size, 1)
    assert.deepEqual([row.status, row.last_error], ['active', null])
    assert.notEqual(db.vaultSecrets.get(row.id), first)
    // the OLD grant does not stay alive at Google: only the newest refresh token works
    const issued = (await fakeState()).refreshTokens
    assert.deepEqual(issued.map((r) => r.revoked), [true, false])
    assert.equal(first, issued[0].token)
    assert.equal(db.vaultSecrets.get(row.id), issued[1].token)
  })

  test('SYSTEM sender: only startups@athareg.com, only by a super_admin; stored as kind system with no owner; ?target=system', async () => {
    const { runtime, db } = makeRuntime()
    const ok = await startFlow(runtime, USERS.admin, { system: true, returnTo: '/profile' }, { email: 'startups@athareg.com' })
    const res = await callback(runtime, ok.callbackUrl)
    assert.equal(locOf(res).search, '?google=connected&target=system')
    const [row] = [...db.connections.values()]
    assert.deepEqual([row.kind, row.owner_user_id, row.email, row.status], ['system', null, 'startups@athareg.com', 'active'])
    const wrong = await startFlow(runtime, USERS.admin, { system: true }, { email: 'admin@athareg.com' })
    const w = locOf(await callback(runtime, wrong.callbackUrl))
    assert.deepEqual([w.searchParams.get('reason'), w.searchParams.get('target')], ['wrong_system_account', 'system'])
    assert.equal(db.connections.size, 1)
  })
})

describe('google-disconnect', () => {
  async function connected(runtime, user = USERS.pm) {
    assert.equal(locOf(await callback(runtime, (await startFlow(runtime, user)).callbackUrl)).searchParams.get('google'), 'connected')
  }

  test('revokes at Google, deletes the stored secret, marks revoked; a second call is a harmless no-op', async () => {
    const { runtime, db } = makeRuntime()
    await connected(runtime)
    const [row] = [...db.connections.values()]
    const issued = (await fakeState()).refreshTokens[0].token
    const res = await post(runtime, 'disconnect', USERS.pm, {})
    assert.deepEqual(await res.json(), { ok: true, disconnected: true, revoked_at_google: true })
    assert.equal(row.status, 'revoked')
    assert.equal(db.vaultSecrets.size, 0)
    assert.equal((await fakeState()).refreshTokens.find((r) => r.token === issued).revoked, true)
    assert.deepEqual(await (await post(runtime, 'disconnect', USERS.pm, {})).json(), { ok: true, disconnected: false })
    assert.equal(await db.getSecret(row.id), null)
  })

  test('works when Google is unreachable or the secret is already gone (the local state is still cleaned up)', async () => {
    const { runtime, db } = makeRuntime()
    await connected(runtime)
    const [row] = [...db.connections.values()]
    await ctl('/__control/inject', { target: 'revoke', mode: '500' })
    const res = await (await post(runtime, 'disconnect', USERS.pm, {})).json()
    assert.deepEqual([res.ok, res.disconnected, res.revoked_at_google], [true, true, false])
    assert.equal(row.status, 'revoked')
    assert.equal(db.vaultSecrets.size, 0)
  })

  test('auth: anonymous 401; a PM cannot disconnect the system sender (403) but a super_admin can; each user only reaches their own', async () => {
    const { runtime, db } = makeRuntime()
    assert.equal((await post(runtime, 'disconnect', null, {})).status, 401)
    await connected(runtime, USERS.pm)
    assert.equal((await post(runtime, 'disconnect', USERS.pm, { system: true })).status, 403)
    assert.deepEqual(await (await post(runtime, 'disconnect', USERS.pm2, {})).json(), { ok: true, disconnected: false })
    assert.equal([...db.connections.values()][0].status, 'active')
    const sys = await startFlow(runtime, USERS.admin, { system: true }, { email: 'startups@athareg.com' })
    assert.equal(locOf(await callback(runtime, sys.callbackUrl)).searchParams.get('google'), 'connected')
    assert.equal((await (await post(runtime, 'disconnect', USERS.admin, { system: true })).json()).disconnected, true)
    assert.equal([...db.connections.values()].find((c) => c.kind === 'system').status, 'revoked')
    assert.equal([...db.connections.values()].find((c) => c.kind === 'user').status, 'active')
  })
})

describe('the wiring itself', () => {
  test('the RPC adapter sends EXACTLY the argument names of the contract', async () => {
    const seen = {}
    const db = createRpcDb({ rpc: async (name, args) => { seen[name] = Object.keys(args); return { data: null, error: null } } })
    await db.storageCapabilities()
    await db.oauthBegin({ userId: 'u', nonceHash: 'h', isSystem: false, expiresAt: 'x' })
    await db.oauthConsume({ nonceHash: 'h' })
    await db.upsertConnection({ ownerUserId: 'u', actorId: 'u', isSystem: false, email: 'e', googleSub: 's', scopes: [], storage: 'vault', secret: 't' })
    await db.upsertConnection({ ownerUserId: null, actorId: 'u', isSystem: true, email: 'e', googleSub: 's', scopes: [], storage: 'vault', secret: 't' })
    await db.getSecret('c')
    await db.lookupConnection({ userId: 'u', system: false })
    await db.markConnection('c', 'revoked', null)
    await db.touchConnection('c')
    await db.resolveSender('u')
    assert.deepEqual(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v].sort()])), Object.fromEntries(Object.entries(RPC_CONTRACT).map(([k, v]) => [k, [...v].sort()])))
  })

  test('database errors surface as a token (hint / message prefix / 42501), never the message', async () => {
    const mk = (error) => createRpcDb({ rpc: async () => ({ data: null, error }) })
    for (const [error, token] of [[{ hint: 'too_many_attempts', message: 'x' }, 'too_many_attempts'], [{ message: 'email_in_use: already linked' }, 'email_in_use'], [{ code: '42501', message: 'permission denied for table secrets' }, 'forbidden'], [{ message: 'boom with a secret value' }, 'db_error']]) {
      await assert.rejects(mk(error).storageCapabilities(), (e) => e instanceof DbError && e.token === token && !String(e.message).includes('secret'))
    }
  })

  test('the Bearer parser only accepts a plausible JWT', async () => {
    const { runtime } = makeRuntime()
    for (const h of ['', 'Bearer', 'Bearer short', 'Basic abc', `Bearer ${'a'.repeat(5000)}`, 'Bearer a b']) {
      const res = await runtime.start(new Request('http://f/x', { method: 'POST', headers: h ? { authorization: h } : {}, body: '{}' }))
      assert.equal(res.status, 401, h.slice(0, 20))
    }
  })

  test('callback is GET only', async () => {
    const { runtime } = makeRuntime()
    const res = await runtime.callback(new Request('http://f/x?code=a&state=b', { method: 'POST' }))
    assert.equal(res.status, 405)
  })
})
