import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ConfigError, GoogleError, b64uToBytes, buildAuthUrl, bytesToB64u, chooseStorageMode, classifyApiError, codeChallengeS256, createAccessTokenProvider, createKeyring,
  createTokenStore, decodeIdTokenClaims, decryptToken, deriveCodeVerifier, encryptToken, generateCodeVerifier, getGoogleConfig, hasRequiredScopes, httpRequest,
  isValidCodeVerifier, newNonce, nonceHash, parseEncKey, parseRetryAfter, safeLog, sanitizeReturnPath, signState, validateIdTokenClaims, verifyState, strToB64u,
  GOOGLE_SCOPES, REQUIRED_SCOPES, normalizeScopes,
} from '../google-core.js'
import { APP_URL, REDIRECT_URI, TEST_CLIENT_ID, TEST_ENC_KEY, TEST_ENC_KEY_2, TEST_STATE_SECRET, makeConfig, makeEnv } from './helpers/env.js'
import { createMemoryDb } from './helpers/memory-db.js'

const UID = '11111111-1111-4111-8111-111111111111'
const NOW = Date.UTC(2026, 9, 15, 10, 0, 0)

async function freshState(extra = {}) {
  const nonce = newNonce()
  const challenge = await codeChallengeS256(await deriveCodeVerifier(TEST_STATE_SECRET, nonce))
  const state = await signState({ secret: TEST_STATE_SECRET, userId: UID, nonce, challenge, now: NOW, ...extra })
  return { nonce, challenge, state }
}

describe('base64url', () => {
  test('round trips every byte value and rejects bad input', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    assert.deepEqual([...b64uToBytes(bytesToB64u(all))], [...all])
    assert.equal(bytesToB64u(new Uint8Array([251, 255])), '-_8')
    assert.throws(() => b64uToBytes('ab+/'), GoogleError)
    assert.throws(() => b64uToBytes('a'), GoogleError)
  })
})

describe('signed state', () => {
  test('a fresh state verifies and returns exactly what was signed', async () => {
    const { nonce, challenge, state } = await freshState({ system: true, returnTo: '/projects/abc/nodes/1/settings' })
    const v = await verifyState({ secret: TEST_STATE_SECRET, state, now: NOW + 1000 })
    assert.equal(v.ok, true)
    assert.deepEqual(v.payload, { userId: UID, nonce, challenge, system: true, returnTo: '/projects/abc/nodes/1/settings', expiresAt: NOW + 600_000 })
  })

  test('expires after the TTL (10 minutes), to the second', async () => {
    const { state } = await freshState()
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state, now: NOW + 599_000 })).ok, true)
    assert.deepEqual(await verifyState({ secret: TEST_STATE_SECRET, state, now: NOW + 600_000 }), { ok: false, reason: 'expired' })
    assert.deepEqual(await verifyState({ secret: TEST_STATE_SECRET, state, now: NOW + 86_400_000 }), { ok: false, reason: 'expired' })
  })

  test('any change of the payload or the MAC is rejected (user id, system flag, expiry, nonce)', async () => {
    const { state } = await freshState()
    const [body, mac] = state.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    for (const patch of [{ u: '22222222-2222-4222-8222-222222222222' }, { s: 1 }, { e: payload.e + 3000 }, { n: newNonce() }]) {
      const forged = `${Buffer.from(JSON.stringify({ ...payload, ...patch })).toString('base64url')}.${mac}`
      assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: forged, now: NOW })).reason, 'bad_signature', JSON.stringify(patch))
    }
    const flipped = `${body}.${mac.slice(0, -2)}${mac.endsWith('AA') ? 'BB' : 'AA'}`
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: flipped, now: NOW })).reason, 'bad_signature')
  })

  test('another secret does not verify; garbage is malformed, never an exception', async () => {
    const { state } = await freshState()
    assert.equal((await verifyState({ secret: `${TEST_STATE_SECRET}x`, state, now: NOW })).reason, 'bad_signature')
    for (const bad of ['', 'abc', 'a.b.c', '.', 'x'.repeat(2000), null, undefined, 42, `${'A'.repeat(30)}.${'B'.repeat(30)}`]) {
      const r = await verifyState({ secret: TEST_STATE_SECRET, state: bad, now: NOW })
      assert.equal(r.ok, false, String(bad))
    }
  })

  test('a signature over a payload that is not ours (far expiry, wrong shape) is refused even with a valid MAC', async () => {
    const { hmacSha256 } = await import('../google-core.js')
    const make = async (p) => {
      const body = strToB64u(JSON.stringify(p))
      return `${body}.${bytesToB64u(await hmacSha256(TEST_STATE_SECRET, body))}`
    }
    const good = { v: 1, u: UID, n: newNonce(), c: 'A'.repeat(43), e: Math.floor(NOW / 1000) + 600, s: 0 }
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: await make(good), now: NOW })).ok, true)
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: await make({ ...good, e: good.e + 100_000 }), now: NOW })).reason, 'unsupported')
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: await make({ ...good, v: 2 }), now: NOW })).reason, 'unsupported')
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: await make({ ...good, u: 'not-a-uuid' }), now: NOW })).reason, 'unsupported')
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state: await make({ ...good, s: 2 }), now: NOW })).reason, 'unsupported')
  })

  test('refuses a weak secret and bad inputs when signing', async () => {
    await assert.rejects(signState({ secret: 'short', userId: UID, nonce: newNonce(), challenge: 'A'.repeat(43) }), ConfigError)
    await assert.rejects(signState({ secret: TEST_STATE_SECRET, userId: 'x', nonce: newNonce(), challenge: 'A'.repeat(43) }), GoogleError)
    await assert.rejects(signState({ secret: TEST_STATE_SECRET, userId: UID, nonce: 'short', challenge: 'A'.repeat(43) }), GoogleError)
  })

  test('the return path is sanitised when signed and when read (no open redirect, no query, no scheme)', async () => {
    for (const bad of ['https://evil.example/', '//evil.example', '/\\evil', '/a/../b', '/a?x=1', '/a#b', 'profile', '', '/' + 'a'.repeat(300), '/a b', '/%2e%2e/x', 42, null]) {
      assert.equal(sanitizeReturnPath(bad), '/profile', String(bad))
    }
    assert.equal(sanitizeReturnPath('/projects/9f2c/nodes/12/settings'), '/projects/9f2c/nodes/12/settings')
    assert.equal(sanitizeReturnPath('/', '/x'), '/')
    const { state } = await freshState({ returnTo: 'https://evil.example/' })
    assert.equal((await verifyState({ secret: TEST_STATE_SECRET, state, now: NOW })).payload.returnTo, null)
  })
})

describe('PKCE', () => {
  test('RFC 7636 appendix B test vector', async () => {
    assert.equal(await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  test('generated and derived verifiers are valid, distinct per nonce and stable per nonce', async () => {
    const v = generateCodeVerifier()
    assert.equal(isValidCodeVerifier(v), true)
    assert.equal(v.length, 43)
    const a = await deriveCodeVerifier(TEST_STATE_SECRET, 'nonce-a')
    assert.equal(a, await deriveCodeVerifier(TEST_STATE_SECRET, 'nonce-a'))
    assert.notEqual(a, await deriveCodeVerifier(TEST_STATE_SECRET, 'nonce-b'))
    assert.notEqual(a, await deriveCodeVerifier(`${TEST_STATE_SECRET}!`, 'nonce-a'))
    assert.equal(isValidCodeVerifier(a), true)
    await assert.rejects(codeChallengeS256('too short'), GoogleError)
  })
  test('nonces are random and their hash is a 64-char hex that is not the nonce', async () => {
    const n = newNonce()
    assert.notEqual(n, newNonce())
    const h = await nonceHash(n)
    assert.match(h, /^[0-9a-f]{64}$/)
    assert.ok(!h.includes(n))
  })
})

describe('authorization URL', () => {
  test('asks for code + PKCE S256 + offline + forced consent + the minimal scopes + the hosted domain', async () => {
    const cfg = makeConfig(null)
    const u = new URL(buildAuthUrl(cfg, { state: 'st', challenge: 'c'.repeat(43), loginHint: 'pm.one@athareg.com' }))
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth'.replace('https://accounts.google.com', u.origin))
    const q = Object.fromEntries(u.searchParams)
    assert.equal(q.response_type, 'code')
    assert.equal(q.client_id, TEST_CLIENT_ID)
    assert.equal(q.redirect_uri, REDIRECT_URI)
    assert.equal(q.code_challenge_method, 'S256')
    assert.equal(q.access_type, 'offline')
    assert.equal(q.prompt, 'consent')
    assert.equal(q.hd, 'athareg.com')
    assert.equal(q.login_hint, 'pm.one@athareg.com')
    assert.deepEqual(q.scope.split(' '), [...GOOGLE_SCOPES])
    assert.deepEqual(q.scope.split(' ').sort(), ['email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send', 'openid'])
    assert.ok(!('client_secret' in q))
  })
  test('the system flow lets the admin pick the account; a hostile login hint is dropped', () => {
    const cfg = makeConfig(null)
    const sys = new URL(buildAuthUrl(cfg, { state: 's', challenge: 'c'.repeat(43), system: true }))
    assert.equal(sys.searchParams.get('prompt'), 'consent select_account')
    const bad = new URL(buildAuthUrl(cfg, { state: 's', challenge: 'c'.repeat(43), loginHint: 'a@b.c&scope=evil' }))
    assert.equal(bad.searchParams.has('login_hint'), false)
  })
})

describe('configuration (environment only)', () => {
  test('production defaults point at Google; every required variable is named when missing', () => {
    const cfg = getGoogleConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'https://x.supabase.co/functions/v1/google-oauth-callback', APP_URL: 'https://app.athareg.com/platform/', OAUTH_STATE_SECRET: TEST_STATE_SECRET })
    assert.equal(cfg.authUrl, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(cfg.tokenUrl, 'https://oauth2.googleapis.com/token')
    assert.equal(cfg.revokeUrl, 'https://oauth2.googleapis.com/revoke')
    assert.equal(cfg.apiBase, 'https://www.googleapis.com')
    assert.equal(cfg.allowedDomain, 'athareg.com')
    assert.equal(cfg.systemSenderEmail, 'startups@athareg.com')
    assert.equal(cfg.emailPolicy, 'same_email')
    assert.equal(cfg.appUrl, 'https://app.athareg.com/platform')
    assert.deepEqual(cfg.allowedOrigins, ['https://app.athareg.com'])
    assert.equal(cfg.fake, false)
    const e = assert.throws(() => getGoogleConfig({}), ConfigError)
    void e
    try { getGoogleConfig({ GOOGLE_CLIENT_ID: 'x' }) } catch (err) { assert.deepEqual(err.missing, ['GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'APP_URL', 'OAUTH_STATE_SECRET']) }
  })
  test('a weak state secret is refused', () => {
    assert.throws(() => getGoogleConfig({ ...makeEnv(null), OAUTH_STATE_SECRET: 'tooshort' }), (e) => e.code === 'weak_secret')
  })
  test('base URL overrides are refused unless ALLOW_FAKE_GOOGLE=1 (a leftover local env cannot redirect production tokens)', () => {
    const base = makeEnv(null)
    delete base.ALLOW_FAKE_GOOGLE
    for (const v of ['GOOGLE_AUTH_BASE', 'GOOGLE_TOKEN_URL', 'GOOGLE_API_BASE', 'GOOGLE_REVOKE_URL']) {
      assert.throws(() => getGoogleConfig({ ...base, [v]: 'http://evil.example' }), (e) => e.code === 'override_not_allowed' && e.missing.includes(v), v)
    }
    const ok = getGoogleConfig({ ...base, ALLOW_FAKE_GOOGLE: '1', GOOGLE_TOKEN_URL: 'http://127.0.0.1:9/token', GOOGLE_AUTH_BASE: 'http://127.0.0.1:9/', GOOGLE_API_BASE: 'http://127.0.0.1:9' })
    assert.equal(ok.revokeUrl, 'http://127.0.0.1:9/revoke')
    assert.equal(ok.authUrl, 'http://127.0.0.1:9/o/oauth2/v2/auth')
    assert.equal(ok.fake, true)
  })
  test('http is accepted only for loopback; non-http schemes are refused', () => {
    const base = makeEnv(null)
    delete base.ALLOW_FAKE_GOOGLE
    assert.throws(() => getGoogleConfig({ ...base, GOOGLE_REDIRECT_URI: 'http://app.example.com/cb' }), (e) => e.code === 'https_required')
    assert.throws(() => getGoogleConfig({ ...base, APP_URL: 'http://app.example.com' }), (e) => e.code === 'https_required')
    assert.throws(() => getGoogleConfig({ ...base, APP_URL: 'javascript:alert(1)' }), (e) => e.code === 'bad_url')
    assert.equal(getGoogleConfig(base).redirectUri, REDIRECT_URI)
    assert.equal(getGoogleConfig(base).appUrl, APP_URL)
  })
  test('the e-mail policy and the domain can be configured; bad values are refused', () => {
    assert.equal(getGoogleConfig({ ...makeEnv(null), GOOGLE_PM_EMAIL_POLICY: 'same_domain', ALLOWED_GOOGLE_DOMAIN: 'Athareg.COM', SYSTEM_SENDER_EMAIL: 'Startups@Athareg.com' }).emailPolicy, 'same_domain')
    assert.throws(() => getGoogleConfig({ ...makeEnv(null), GOOGLE_PM_EMAIL_POLICY: 'anything' }), ConfigError)
    const c = getGoogleConfig({ ...makeEnv(null), ALLOWED_GOOGLE_DOMAIN: 'Athareg.COM', SYSTEM_SENDER_EMAIL: 'Startups@Athareg.com' })
    assert.equal(c.allowedDomain, 'athareg.com')
    assert.equal(c.systemSenderEmail, 'startups@athareg.com')
  })
  test('accepts a Deno.env-like object with get()', () => {
    const env = makeEnv(null)
    assert.equal(getGoogleConfig({ get: (n) => env[n] }).clientId, TEST_CLIENT_ID)
  })
})

describe('ID token', () => {
  const claims = (over = {}) => ({ iss: 'https://accounts.google.com', aud: TEST_CLIENT_ID, sub: '1234567890', email: 'Pm.One@Athareg.com', email_verified: true, hd: 'athareg.com', exp: Math.floor(NOW / 1000) + 3000, ...over })
  const opts = { clientId: TEST_CLIENT_ID, requireDomain: 'athareg.com', now: NOW }
  const token = (c) => `${strToB64u('{"alg":"none"}')}.${strToB64u(JSON.stringify(c))}.sig`
  test('a Workspace token is accepted and the e-mail is lower-cased', () => {
    assert.deepEqual(validateIdTokenClaims(claims(), opts), { ok: true, email: 'pm.one@athareg.com', sub: '1234567890', hd: 'athareg.com' })
    assert.equal(validateIdTokenClaims(claims({ iss: 'accounts.google.com' }), opts).ok, true)
    assert.equal(validateIdTokenClaims(claims({ aud: ['x', TEST_CLIENT_ID] }), opts).ok, true)
  })
  test('rejects: wrong issuer / audience, expired, no sub, unverified e-mail, other domain, missing hd, domain only in the e-mail', () => {
    const r = (over) => validateIdTokenClaims(claims(over), opts)
    assert.equal(r({ iss: 'https://evil.example' }).reason, 'id_token_invalid')
    assert.equal(r({ aud: 'another-client' }).reason, 'id_token_invalid')
    assert.equal(r({ exp: Math.floor(NOW / 1000) - 1 }).reason, 'id_token_invalid')
    assert.equal(r({ sub: '' }).reason, 'id_token_invalid')
    assert.equal(r({ email: 'not-an-email' }).reason, 'id_token_invalid')
    assert.equal(r({ email_verified: false }).reason, 'email_unverified')
    assert.equal(r({ email: 'someone@gmail.com', hd: undefined }).reason, 'wrong_domain')
    assert.equal(r({ email: 'someone@other.org', hd: 'other.org' }).reason, 'wrong_domain')
    assert.equal(r({ hd: undefined }).reason, 'wrong_domain') // an athareg.com address without the hosted-domain claim is not a Workspace account
    assert.equal(r({ email: 'x@athareg.com.evil.example', hd: 'athareg.com' }).reason, 'wrong_domain')
    assert.equal(r({ email: 'x@evil-athareg.com', hd: 'athareg.com' }).reason, 'wrong_domain')
    assert.equal(validateIdTokenClaims(null, opts).ok, false)
  })
  test('decodeIdTokenClaims only reads well-formed tokens', () => {
    assert.equal(decodeIdTokenClaims(token(claims())).email, 'Pm.One@Athareg.com')
    for (const bad of ['', 'a.b', 'a.b.c.d', null, undefined, `${strToB64u('{}')}.${'@@'}.x`, `${strToB64u('{}')}.${strToB64u('[1]')}.x`]) assert.throws(() => decodeIdTokenClaims(bad), GoogleError, String(bad))
  })
  test('scopes: the userinfo.email URL and `email` are the same grant; both required scopes are needed', () => {
    assert.deepEqual(normalizeScopes('openid email https://www.googleapis.com/auth/gmail.send'), ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email', 'openid'])
    assert.equal(hasRequiredScopes('openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events'), true)
    assert.equal(hasRequiredScopes('openid email https://www.googleapis.com/auth/gmail.send'), false)
    assert.equal(hasRequiredScopes(REQUIRED_SCOPES), true)
    assert.equal(hasRequiredScopes([]), false)
  })
})

describe('AES-256-GCM token encryption', () => {
  test('round trips, is randomised, and never contains the plaintext', async () => {
    const ring = await createKeyring({ TOKEN_ENC_KEY: TEST_ENC_KEY })
    const a = await encryptToken('1//refresh-token-value', ring, { aad: 'pm.one@athareg.com' })
    const b = await encryptToken('1//refresh-token-value', ring, { aad: 'pm.one@athareg.com' })
    assert.notEqual(a, b)
    assert.ok(!a.includes('refresh-token-value'))
    assert.match(a, /^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    assert.equal(await decryptToken(a, ring, { aad: 'PM.one@athareg.com' }), '1//refresh-token-value')
  })
  test('a blob moved to another account, tampered, truncated or from another key does not decrypt', async () => {
    const ring = await createKeyring({ TOKEN_ENC_KEY: TEST_ENC_KEY })
    const blob = await encryptToken('secret-token', ring, { aad: 'a@athareg.com' })
    await assert.rejects(decryptToken(blob, ring, { aad: 'b@athareg.com' }), (e) => e.code === 'bad_ciphertext')
    const parts = blob.split('.')
    const last = parts[3]
    const tampered = [...parts.slice(0, 3), (last[0] === 'A' ? 'B' : 'A') + last.slice(1)].join('.')
    await assert.rejects(decryptToken(tampered, ring, { aad: 'a@athareg.com' }), (e) => e.code === 'bad_ciphertext')
    await assert.rejects(decryptToken(parts.slice(0, 3).join('.'), ring, { aad: 'a@athareg.com' }), (e) => e.code === 'bad_ciphertext')
    await assert.rejects(decryptToken('', ring, { aad: 'a@athareg.com' }), GoogleError)
    const other = await createKeyring({ TOKEN_ENC_KEY: TEST_ENC_KEY_2 })
    await assert.rejects(decryptToken(blob, other, { aad: 'a@athareg.com' }), (e) => e.code === 'unknown_key')
  })
  test('key rotation: the old key still decrypts, new writes use the new key', async () => {
    const oldRing = await createKeyring({ TOKEN_ENC_KEY: TEST_ENC_KEY })
    const blob = await encryptToken('tok', oldRing, { aad: 'a@athareg.com' })
    const rotated = await createKeyring({ TOKEN_ENC_KEY: TEST_ENC_KEY_2, TOKEN_ENC_KEY_OLD: TEST_ENC_KEY })
    assert.equal(await decryptToken(blob, rotated, { aad: 'a@athareg.com' }), 'tok')
    const fresh = await encryptToken('tok', rotated, { aad: 'a@athareg.com' })
    assert.notEqual(fresh.split('.')[1], blob.split('.')[1])
  })
  test('key formats: 64 hex, base64, base64url; anything else is refused with the variable name', () => {
    assert.equal(parseEncKey(TEST_ENC_KEY).length, 32)
    const b = Buffer.from(TEST_ENC_KEY, 'hex')
    assert.deepEqual([...parseEncKey(b.toString('base64'))], [...b])
    assert.deepEqual([...parseEncKey(b.toString('base64url'))], [...b])
    for (const bad of ['', 'abc', 'zz'.repeat(32), 'a'.repeat(63), null]) assert.throws(() => parseEncKey(bad), (e) => e instanceof ConfigError && e.missing[0] === 'TOKEN_ENC_KEY', String(bad))
  })
  test('refuses to encrypt an empty secret', async () => {
    await assert.rejects(encryptToken('', await createKeyring({ TOKEN_ENC_KEY: TEST_ENC_KEY }), { aad: 'a' }), GoogleError)
  })
})

describe('storage choice and the token store', () => {
  test('auto prefers Vault, falls back to AES, and says why when neither is possible', () => {
    assert.equal(chooseStorageMode({ preferred: 'auto', vaultAvailable: true, hasEncKey: true }), 'vault')
    assert.equal(chooseStorageMode({ preferred: 'auto', vaultAvailable: false, hasEncKey: true }), 'aes')
    assert.throws(() => chooseStorageMode({ preferred: 'auto', vaultAvailable: false, hasEncKey: false }), (e) => e.code === 'no_token_storage')
    assert.equal(chooseStorageMode({ preferred: 'aes', vaultAvailable: true, hasEncKey: true }), 'aes')
    assert.throws(() => chooseStorageMode({ preferred: 'aes', vaultAvailable: true, hasEncKey: false }), (e) => e.code === 'missing_env')
    assert.throws(() => chooseStorageMode({ preferred: 'vault', vaultAvailable: false, hasEncKey: true }), (e) => e.code === 'vault_unavailable')
    assert.throws(() => chooseStorageMode({ preferred: 'nope' }), ConfigError)
  })

  const owner = { id: UID, email: 'pm.one@athareg.com', roles: ['project_manager'] }
  for (const mode of ['vault', 'aes']) {
    test(`${mode}: save + load round trip through the same interface; the database never holds the AES plaintext`, async () => {
      const db = createMemoryDb({ users: { [owner.id]: owner } })
      const keyring = await createKeyring({ TOKEN_ENC_KEY: TEST_ENC_KEY })
      const store = createTokenStore({ db, mode, keyring })
      const { connection_id: id } = await store.save({ ownerUserId: UID, actorId: UID, isSystem: false, email: 'pm.one@athareg.com', googleSub: '1', scopes: [...REQUIRED_SCOPES], refreshToken: '1//the-refresh-token' })
      assert.equal(await store.load(id), '1//the-refresh-token')
      if (mode === 'aes') {
        assert.ok(!db.ciphertexts.get(id).includes('the-refresh-token'))
        assert.equal(db.vaultSecrets.size, 0)
      } else {
        assert.equal(db.vaultSecrets.get(id), '1//the-refresh-token')
        assert.equal(db.ciphertexts.size, 0)
      }
    })
  }
  test('a connection saved as AES is still read as AES after the runtime switches to Vault', async () => {
    const db = createMemoryDb({ users: { [owner.id]: owner } })
    const keyring = await createKeyring({ TOKEN_ENC_KEY: TEST_ENC_KEY })
    const { connection_id: id } = await createTokenStore({ db, mode: 'aes', keyring }).save({ ownerUserId: UID, actorId: UID, isSystem: false, email: 'pm.one@athareg.com', googleSub: '1', scopes: [], refreshToken: 'rt-1' })
    assert.equal(await createTokenStore({ db, mode: 'vault', keyring }).load(id), 'rt-1')
  })
  test('loading a revoked / unknown connection says reconnect', async () => {
    const db = createMemoryDb({ users: { [owner.id]: owner } })
    const store = createTokenStore({ db, mode: 'vault' })
    await assert.rejects(store.load('00000000-0000-4000-8000-000000000999'), (e) => e.code === 'no_secret' && e.needsReconnect)
  })
})

describe('http helper, classification, retry-after', () => {
  test('a hung server hits the timeout (covering the body read) and is flagged outcome-unknown', async () => {
    const hangs = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const t0 = Date.now()
    await assert.rejects(httpRequest(hangs, 'http://x.invalid/', { timeoutMs: 40 }), (e) => e.code === 'timeout' && e.retryable && e.outcomeUnknown)
    assert.ok(Date.now() - t0 < 1000)
  })
  test('a refused connection is a network error that was NEVER sent; a reset is unknown', async () => {
    const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }
    const reset = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }) }
    await assert.rejects(httpRequest(refused, 'http://x.invalid/'), (e) => e.code === 'network' && !e.outcomeUnknown && e.retryable)
    await assert.rejects(httpRequest(reset, 'http://x.invalid/'), (e) => e.code === 'network' && e.outcomeUnknown)
  })
  test('redirects are not followed and oversized bodies are refused', async () => {
    let seen
    const f = async (url, init) => { seen = init; return new Response('x'.repeat(100), { status: 200 }) }
    await assert.rejects(httpRequest(f, 'http://x.invalid/', { maxBytes: 10 }), (e) => e.code === 'bad_response')
    assert.equal(seen.redirect, 'manual')
  })
  test('classifyApiError: 401 / 429 / 403 rate limit / 403 / 404 / 409 / 410 / 5xx', () => {
    const c = (status, reason, extra = {}) => classifyApiError({ status, json: reason ? { error: { errors: [{ reason }] } } : null, ...extra })
    assert.equal(c(401).code, 'unauthorized')
    assert.deepEqual([c(429, 'rateLimitExceeded', { retryAfterMs: 5000 }).code, c(429, null, { retryAfterMs: 5000 }).retryAfterMs, c(429).retryable], ['rate_limited', 5000, true])
    assert.equal(c(403, 'userRateLimitExceeded').code, 'rate_limited')
    assert.equal(c(403, 'insufficientPermissions').code, 'forbidden')
    assert.equal(c(403, 'insufficientPermissions').retryable, false)
    assert.deepEqual([c(404).code, c(409).code, c(410).code, c(400).code], ['not_found', 'conflict', 'gone', 'bad_request'])
    assert.deepEqual([c(500).code, c(503).retryable], ['server_error', true])
  })
  test('parseRetryAfter: seconds, HTTP date, junk, clamp', () => {
    assert.equal(parseRetryAfter('7'), 7000)
    assert.equal(parseRetryAfter(new Date(NOW + 4000).toUTCString(), NOW), 4000)
    assert.equal(parseRetryAfter('soon'), null)
    assert.equal(parseRetryAfter(null), null)
    assert.equal(parseRetryAfter('999999'), 3_600_000)
  })
})

describe('logging never carries a secret', () => {
  test('redacts by key name and truncates', () => {
    const lines = []
    const out = safeLog('test', { user: 'u1', refresh_token: 'SECRET', access_token: 'SECRET', code: 'SECRET', state: 'SECRET', client_secret: 'SECRET', authorization: 'Bearer SECRET', raw: 'SECRET', ciphertext: 'SECRET', long: 'x'.repeat(500), nested: { a: 1 }, n: 3 }, (l) => lines.push(l))
    assert.ok(!lines[0].includes('SECRET'))
    assert.equal(out.refresh_token, '[redacted]')
    assert.equal(out.long.length, 203)
    assert.equal(out.nested, '[object]')
    assert.equal(out.user, 'u1')
  })
})

describe('access tokens for workers', () => {
  const owner = { id: UID, email: 'pm.one@athareg.com', roles: ['project_manager'] }
  function setup() {
    const db = createMemoryDb({ users: { [owner.id]: owner } })
    const store = createTokenStore({ db, mode: 'vault' })
    let refreshCalls = 0
    let clock = NOW
    let mode = 'ok'
    const fetchImpl = async (url, init) => {
      refreshCalls += 1
      await new Promise((r) => setTimeout(r, 5))
      if (mode === 'invalid_grant') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } })
      assert.ok(String(init.body).includes('grant_type=refresh_token'))
      return new Response(JSON.stringify({ access_token: `at-${refreshCalls}`, expires_in: 3599, scope: 'openid' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const cfg = makeConfig(null)
    const provider = createAccessTokenProvider({ cfg, db, store, fetch: fetchImpl, now: () => clock })
    return { db, store, provider, calls: () => refreshCalls, tick: (ms) => { clock += ms }, setMode: (m) => { mode = m } }
  }
  async function connect(ctx) {
    return (await ctx.store.save({ ownerUserId: UID, actorId: UID, isSystem: false, email: 'pm.one@athareg.com', googleSub: '1', scopes: [], refreshToken: 'rt' })).connection_id
  }
  test('caches until 60 s before expiry, then refreshes; concurrent callers share ONE refresh', async () => {
    const ctx = setup()
    const id = await connect(ctx)
    const [a, b, c] = await Promise.all([ctx.provider.getAccessToken(id), ctx.provider.getAccessToken(id), ctx.provider.getAccessToken(id)])
    assert.deepEqual([a, b, c], ['at-1', 'at-1', 'at-1'])
    assert.equal(ctx.calls(), 1)
    ctx.tick(3_000_000)
    assert.equal(await ctx.provider.getAccessToken(id), 'at-1')
    ctx.tick(540_000)
    assert.equal(await ctx.provider.getAccessToken(id), 'at-2')
    assert.equal(await ctx.provider.getAccessToken(id, { force: true }), 'at-3')
  })
  test('invalid_grant marks the connection needs_reconnect (code only) and surfaces needsReconnect', async () => {
    const ctx = setup()
    const id = await connect(ctx)
    ctx.setMode('invalid_grant')
    await assert.rejects(ctx.provider.getAccessToken(id), (e) => e.code === 'invalid_grant' && e.needsReconnect === true)
    assert.equal(ctx.db.connections.get(id).status, 'needs_reconnect')
    assert.equal(ctx.db.connections.get(id).last_error, 'invalid_grant')
  })
  test('a revoked connection has no token to refresh', async () => {
    const ctx = setup()
    const id = await connect(ctx)
    await ctx.db.markConnection(id, 'revoked')
    await assert.rejects(ctx.provider.getAccessToken(id), (e) => e.code === 'no_secret' && e.needsReconnect)
    assert.equal(ctx.calls(), 0)
  })
})
