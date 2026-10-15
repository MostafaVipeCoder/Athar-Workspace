// The fake Google server itself (db/scripts/fake-google/server.mjs): every later test trusts it, so it is tested first.
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { startFakeGoogle } from '../../../../db/scripts/fake-google/server.mjs'
import { codeChallengeS256, generateCodeVerifier } from '../google-core.js'

const CLIENT = 'fake-client'
const REDIRECT = 'http://127.0.0.1:54321/functions/v1/google-oauth-callback'
let g

before(async () => { g = await startFakeGoogle({ port: 0, clientId: CLIENT, clientSecret: 'fake-secret' }) })
after(async () => { await g.close() })
beforeEach(async () => { await fetch(`${g.url}/__reset`, { method: 'POST' }) })

const form = (o) => new URLSearchParams(o).toString()
const post = (path, body, headers = {}) => fetch(`${g.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: typeof body === 'string' ? body : form(body) })
const ctl = (path, body) => fetch(`${g.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json())
const state = () => fetch(`${g.url}/__state?include_tokens=1`).then((r) => r.json())
const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events'

async function authorize(extra = {}, verifier = generateCodeVerifier()) {
  const q = { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES, state: 'st-1', code_challenge: await codeChallengeS256(verifier), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', ...extra }
  const res = await fetch(`${g.url}/o/oauth2/v2/auth?${form(q)}`, { redirect: 'manual' })
  return { res, verifier, loc: res.headers.get('location') ? new URL(res.headers.get('location')) : null }
}
async function tokens(extra = {}) {
  const a = await authorize(extra)
  const code = a.loc.searchParams.get('code')
  const r = await post('/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT, client_secret: 'fake-secret', code_verifier: a.verifier })
  return { ...a, code, body: await r.json(), status: r.status }
}

describe('authorize', () => {
  test('auto-approves with the login_hint account, echoes state, grants the normalised scopes', async () => {
    const { res, loc } = await authorize({ login_hint: 'pm.one@athareg.com' })
    assert.equal(res.status, 302)
    assert.equal(loc.origin + loc.pathname, REDIRECT)
    assert.equal(loc.searchParams.get('state'), 'st-1')
    assert.ok(loc.searchParams.get('code'))
    assert.ok(loc.searchParams.get('scope').includes('https://www.googleapis.com/auth/userinfo.email'))
    assert.equal((await state()).accounts[0].email, 'pm.one@athareg.com')
  })
  test('a queued account (with its own hd / verification) is used once, then the default again', async () => {
    await ctl('/__control/next-account', { email: 'someone@gmail.com', hd: null, email_verified: false })
    const a = await tokens()
    const claims = JSON.parse(Buffer.from(a.body.id_token.split('.')[1], 'base64url').toString())
    assert.equal(claims.email, 'someone@gmail.com')
    assert.equal(claims.email_verified, false)
    assert.equal('hd' in claims, false)
    const b = await tokens()
    assert.equal(JSON.parse(Buffer.from(b.body.id_token.split('.')[1], 'base64url').toString()).email, 'fake.user@athareg.com')
  })
  test('deny and granular consent (a scope un-ticked)', async () => {
    await ctl('/__control/next-account', { email: 'a@athareg.com', deny: true })
    assert.equal((await authorize()).loc.searchParams.get('error'), 'access_denied')
    await ctl('/__control/next-account', { email: 'a@athareg.com', scopes_denied: ['https://www.googleapis.com/auth/calendar.events'] })
    const t = await tokens()
    assert.ok(!t.body.scope.includes('calendar.events'))
    assert.ok(t.body.scope.includes('gmail.send'))
  })
  test('rejects: unknown redirect uri, wrong client id, missing scope, non-S256 PKCE, wrong response type', async () => {
    for (const bad of [{ redirect_uri: 'https://evil.example/cb' }, { client_id: 'other' }, { scope: '' }, { code_challenge_method: 'plain' }, { response_type: 'token' }]) {
      const { res } = await authorize(bad)
      assert.equal(res.status, 400, JSON.stringify(bad))
    }
  })
  test('a registered redirect list is enforced exactly', async () => {
    await ctl('/__control/config', { redirectUris: [REDIRECT] })
    assert.equal((await authorize()).res.status, 302)
    assert.equal((await authorize({ redirect_uri: `${REDIRECT}/` })).res.status, 400)
    await ctl('/__control/config', { redirectUris: null })
  })
  test('interactive mode shows a consent page and honours Deny', async () => {
    await ctl('/__control/config', { interactive: true })
    const page = await fetch(`${g.url}/o/oauth2/v2/auth?${form({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES, state: 'z', login_hint: 'x@athareg.com' })}`)
    const html = await page.text()
    assert.match(html, /Allow/)
    const session = /name="session" value="([^"]+)"/.exec(html)[1]
    const res = await fetch(`${g.url}/o/oauth2/v2/auth/decision`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ session, email: 'x@athareg.com', decision: 'deny' }) })
    assert.equal(res.status, 302)
    assert.equal(new URL(res.headers.get('location')).searchParams.get('error'), 'access_denied')
    // allow with one scope un-ticked
    const page2 = await (await fetch(`${g.url}/o/oauth2/v2/auth?${form({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES, state: 'z2' })}`)).text()
    const session2 = /name="session" value="([^"]+)"/.exec(page2)[1]
    const body = new URLSearchParams({ session: session2, email: 'y@athareg.com', decision: 'allow' })
    for (const s of ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send']) body.append('scope', s)
    const ok = await fetch(`${g.url}/o/oauth2/v2/auth/decision`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })
    const granted = new URL(ok.headers.get('location')).searchParams.get('scope')
    assert.ok(granted.includes('gmail.send') && !granted.includes('calendar.events'))
  })
})

describe('token endpoint', () => {
  test('code exchange returns access + refresh + id_token (PKCE checked); the code is single use', async () => {
    const t = await tokens({ login_hint: 'pm.one@athareg.com' })
    assert.equal(t.status, 200)
    assert.match(t.body.access_token, /^ya29\.fake\./)
    assert.match(t.body.refresh_token, /^1\/\/0fake-/)
    assert.equal(t.body.token_type, 'Bearer')
    const claims = JSON.parse(Buffer.from(t.body.id_token.split('.')[1], 'base64url').toString())
    assert.deepEqual([claims.iss, claims.aud, claims.email, claims.hd, claims.email_verified], ['https://accounts.google.com', CLIENT, 'pm.one@athareg.com', 'athareg.com', true])
    const again = await post('/token', { grant_type: 'authorization_code', code: t.code, redirect_uri: REDIRECT, client_id: CLIENT, client_secret: 'fake-secret', code_verifier: t.verifier })
    assert.equal(again.status, 400)
    assert.equal((await again.json()).error, 'invalid_grant')
  })
  test('PKCE: a wrong or missing verifier is invalid_grant; wrong redirect uri / secret / client are refused', async () => {
    const a = await authorize()
    const code = a.loc.searchParams.get('code')
    const base = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT, client_secret: 'fake-secret' }
    assert.equal((await (await post('/token', { ...base, code_verifier: generateCodeVerifier() })).json()).error_description, 'Invalid code verifier.')
    assert.equal((await (await post('/token', base)).json()).error_description, 'Missing code verifier.')
    assert.equal((await post('/token', { ...base, code_verifier: a.verifier, redirect_uri: 'http://127.0.0.1:1/x' })).status, 400)
    assert.equal((await post('/token', { ...base, code_verifier: a.verifier, client_secret: 'wrong' })).status, 401)
    assert.equal((await post('/token', { ...base, code_verifier: a.verifier, client_id: 'other' })).status, 401)
    assert.equal((await post('/token', { ...base, code_verifier: a.verifier })).status, 200)
  })
  test('refresh grant issues a new access token with the same scopes; unknown / revoked tokens are invalid_grant', async () => {
    const t = await tokens()
    const r = await post('/token', { grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: CLIENT, client_secret: 'fake-secret' })
    const b = await r.json()
    assert.equal(r.status, 200)
    assert.notEqual(b.access_token, t.body.access_token)
    assert.equal(b.refresh_token, undefined)
    assert.equal((await post('/token', { grant_type: 'refresh_token', refresh_token: 'nope', client_id: CLIENT, client_secret: 'fake-secret' })).status, 400)
    await ctl('/__control/revoke-all', { email: 'fake.user@athareg.com' })
    const dead = await post('/token', { grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: CLIENT, client_secret: 'fake-secret' })
    assert.deepEqual([dead.status, (await dead.json()).error], [400, 'invalid_grant'])
  })
  test('invalid_grant injection (once), 500 and 429 injection, then normal again', async () => {
    const t = await tokens()
    const refresh = () => post('/token', { grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: CLIENT, client_secret: 'fake-secret' })
    await ctl('/__control/inject', { target: 'token', mode: 'invalid_grant', times: 1 })
    assert.equal((await (await refresh()).json()).error, 'invalid_grant')
    assert.equal((await refresh()).status, 200)
    await ctl('/__control/inject', { target: 'token', mode: '500' })
    assert.equal((await refresh()).status, 500)
    await ctl('/__control/inject', { target: 'token', mode: '429', retryAfter: 7 })
    const r = await refresh()
    assert.deepEqual([r.status, r.headers.get('retry-after')], [429, '7'])
  })
  test('a second consent without prompt=consent issues NO refresh token (like Google); prompt=consent does', async () => {
    await tokens({ login_hint: 'p@athareg.com' })
    const again = await tokens({ login_hint: 'p@athareg.com', prompt: 'select_account' })
    assert.equal(again.body.refresh_token, undefined)
    assert.ok((await tokens({ login_hint: 'p@athareg.com' })).body.refresh_token)
  })
  test('access_type=online never issues a refresh token', async () => {
    assert.equal((await tokens({ access_type: 'online' })).body.refresh_token, undefined)
  })
  test('access tokens expire (control) and then API calls answer 401', async () => {
    const t = await tokens()
    const call = () => fetch(`${g.url}/oauth2/v3/userinfo`, { headers: { authorization: `Bearer ${t.body.access_token}` } })
    assert.equal((await call()).status, 200)
    await ctl('/__control/expire-access-tokens')
    assert.equal((await call()).status, 401)
  })
  test('revoke: refresh token kills its access tokens; an unknown token is invalid_token', async () => {
    const t = await tokens()
    assert.equal((await post('/revoke', { token: t.body.refresh_token })).status, 200)
    assert.equal((await fetch(`${g.url}/oauth2/v3/userinfo`, { headers: { authorization: `Bearer ${t.body.access_token}` } })).status, 401)
    const bad = await post('/revoke', { token: 'nope' })
    assert.deepEqual([bad.status, (await bad.json()).error], [400, 'invalid_token'])
  })
})

describe('Gmail send', () => {
  const mime = (to = 'a@example.com', subject = 'Hi') => Buffer.from(`From: pm@athareg.com\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: Thu, 15 Oct 2026 10:00:00 +0000\r\nMessage-ID: <m1@athareg.com>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nbody`).toString('base64url')
  const send = (at, raw) => fetch(`${g.url}/gmail/v1/users/me/messages/send`, { method: 'POST', headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) })
  test('records and decodes the message; needs a valid token with the gmail.send scope', async () => {
    const t = await tokens({ login_hint: 'pm@athareg.com' })
    const r = await send(t.body.access_token, mime('a@example.com'))
    assert.equal(r.status, 200)
    const body = await r.json()
    assert.ok(body.id)
    const msgs = (await state()).messages
    assert.equal(msgs.length, 1)
    assert.deepEqual([msgs[0].account, msgs[0].subject, msgs[0].to[0].email, msgs[0].messageId], ['pm@athareg.com', 'Hi', 'a@example.com', '<m1@athareg.com>'])
    assert.equal((await send('bad', mime())).status, 401)
    await ctl('/__control/next-account', { email: 'n@athareg.com', scopes_denied: ['https://www.googleapis.com/auth/gmail.send'] })
    const no = await tokens()
    const forbidden = await send(no.body.access_token, mime())
    assert.equal(forbidden.status, 403)
    assert.equal((await forbidden.json()).error.errors[0].reason, 'insufficientPermissions')
  })
  test('rejects a body that is not base64url', async () => {
    const t = await tokens()
    assert.equal((await send(t.body.access_token, 'not base64!')).status, 400)
  })
  test('injection: 401 / 429+Retry-After / 500 do NOT record; match on the recipient; times and after', async () => {
    const t = await tokens()
    await ctl('/__control/inject', { target: 'gmail.send', mode: '429', retryAfter: 3, match: { recipient: 'slow@example.com' } })
    assert.equal((await send(t.body.access_token, mime('fine@example.com'))).status, 200)
    const limited = await send(t.body.access_token, mime('slow@example.com'))
    assert.deepEqual([limited.status, limited.headers.get('retry-after')], [429, '3'])
    assert.equal((await send(t.body.access_token, mime('slow@example.com'))).status, 200)
    await ctl('/__control/inject', { target: 'gmail.send', mode: '500', after: 1, times: 2 })
    assert.deepEqual([(await send(t.body.access_token, mime('p1@example.com'))).status, (await send(t.body.access_token, mime('p2@example.com'))).status, (await send(t.body.access_token, mime('p3@example.com'))).status, (await send(t.body.access_token, mime('p4@example.com'))).status], [200, 500, 500, 200])
    assert.equal((await state()).messages.length, 4) // fine, slow(2nd), p1, p4 -> the failed ones were never recorded
  })
  test('timeout-after-accept RECORDS the message and never answers (the client must treat the outcome as unknown); reset-after-accept too', async () => {
    const t = await tokens()
    await ctl('/__control/inject', { target: 'gmail.send', mode: 'timeout-after-accept' })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 150)
    await assert.rejects(fetch(`${g.url}/gmail/v1/users/me/messages/send`, { method: 'POST', headers: { authorization: `Bearer ${t.body.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw: mime('late@example.com') }), signal: ctrl.signal }))
    clearTimeout(timer)
    assert.equal((await state()).messages.length, 1)
    await ctl('/__control/inject', { target: 'gmail.send', mode: 'reset-after-accept' })
    await assert.rejects(send(t.body.access_token, mime('reset@example.com')))
    assert.equal((await state()).messages.length, 2)
  })
  test('timeout-before-accept records nothing', async () => {
    const t = await tokens()
    await ctl('/__control/inject', { target: 'gmail.send', mode: 'timeout-before-accept' })
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 100)
    await assert.rejects(fetch(`${g.url}/gmail/v1/users/me/messages/send`, { method: 'POST', headers: { authorization: `Bearer ${t.body.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw: mime() }), signal: ctrl.signal }))
    assert.equal((await state()).messages.length, 0)
  })
})

describe('Calendar', () => {
  const ID = crypto.randomUUID().replace(/-/g, '')
  const ev = (over = {}) => ({ id: ID, summary: 'S', start: { dateTime: '2026-07-15T13:00:00+03:00', timeZone: 'Africa/Cairo' }, end: { dateTime: '2026-07-15T13:30:00+03:00', timeZone: 'Africa/Cairo' }, attendees: [{ email: 'a@example.com' }], conferenceData: { createRequest: { requestId: 'req-1', conferenceSolutionKey: { type: 'hangoutsMeet' } } }, ...over })
  const api = (at, method, path = '', body, query = '') => fetch(`${g.url}/calendar/v3/calendars/primary/events${path}${query}`, { method, headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  let at
  beforeEach(async () => { at = (await tokens({ login_hint: 'cal@athareg.com' })).body.access_token })

  test('insert: 200, attendees get needsAction, sendUpdates recorded; a duplicate id (even cancelled) is 409', async () => {
    const r = await api(at, 'POST', '', ev({ conferenceData: undefined }), '?sendUpdates=all')
    assert.equal(r.status, 200)
    const b = await r.json()
    assert.deepEqual([b.id, b.status, b.attendees[0].responseStatus, b.organizer.email], [ID, 'confirmed', 'needsAction', 'cal@athareg.com'])
    assert.equal((await state()).events['cal@athareg.com'][0].sendUpdates, 'all')
    const dup = await api(at, 'POST', '', ev({ conferenceData: undefined }))
    assert.equal(dup.status, 409)
    assert.equal((await dup.json()).error.errors[0].reason, 'duplicate')
    assert.equal((await api(at, 'DELETE', `/${ID}`)).status, 204)
    assert.equal((await api(at, 'POST', '', ev({ conferenceData: undefined }))).status, 409)
  })
  test('Meet: only with conferenceDataVersion=1; pending first, then success with a video entry point and hangoutLink', async () => {
    const without = await (await api(at, 'POST', '', ev({ id: 'aaaaa1' }))).json()
    assert.equal(without.conferenceData, undefined)
    const created = await (await api(at, 'POST', '', ev(), '?conferenceDataVersion=1')).json()
    assert.equal(created.conferenceData.createRequest.status.statusCode, 'pending')
    assert.equal(created.hangoutLink, undefined)
    const first = await (await api(at, 'GET', `/${ID}`)).json()
    assert.equal(first.conferenceData.createRequest.status.statusCode, 'pending')
    const second = await (await api(at, 'GET', `/${ID}`)).json()
    assert.equal(second.conferenceData.createRequest.status.statusCode, 'success')
    assert.match(second.hangoutLink, /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/)
    assert.equal(second.conferenceData.entryPoints.find((e) => e.entryPointType === 'video').uri, second.hangoutLink)
    assert.equal(second.conferenceData.createRequest.requestId, 'req-1')
  })
  test('meetAsync=false: the link is there at once', async () => {
    await ctl('/__control/config', { meetAsync: false })
    const created = await (await api(at, 'POST', '', ev(), '?conferenceDataVersion=1')).json()
    assert.equal(created.conferenceData.createRequest.status.statusCode, 'success')
    assert.ok(created.hangoutLink)
    await ctl('/__control/config', { meetAsync: true })
  })
  test('validation mirrors Google: id alphabet, missing time zone, empty range, bad attendee', async () => {
    const code = async (body) => (await api(at, 'POST', '', body)).status
    assert.equal(await code(ev({ id: 'NOT-VALID!' })), 400)
    assert.equal(await code(ev({ id: 'w'.repeat(10) })), 400)
    assert.equal(await code(ev({ start: { dateTime: '2026-07-15T13:00:00' }, end: { dateTime: '2026-07-15T13:30:00' } })), 400)
    assert.equal(await code(ev({ start: { dateTime: '2026-07-15T13:30:00Z' }, end: { dateTime: '2026-07-15T13:00:00Z' } })), 400)
    assert.equal(await code(ev({ attendees: [{ email: 'nope' }] })), 400)
    assert.equal(await code({ id: 'abcde1' }), 400)
    assert.equal(await code(ev({ start: { dateTime: '2026-07-15T13:00:00', timeZone: 'Mars/Base' }, end: { dateTime: '2026-07-15T13:30:00', timeZone: 'Mars/Base' } })), 400)
    assert.equal(await code(ev({ conferenceData: undefined })), 200)
  })
  test('get 404; patch updates times / attendees (sequence++), keeps the Meet link; delete -> 204, cancelled event reads as cancelled, 410 on a second delete', async () => {
    assert.equal((await api(at, 'GET', '/unknown1')).status, 404)
    await api(at, 'POST', '', ev(), '?conferenceDataVersion=1')
    await api(at, 'GET', `/${ID}`)
    const before = await (await api(at, 'GET', `/${ID}`)).json()
    const patched = await (await api(at, 'PATCH', `/${ID}`, { start: { dateTime: '2026-07-16T13:00:00+03:00', timeZone: 'Africa/Cairo' }, end: { dateTime: '2026-07-16T13:30:00+03:00', timeZone: 'Africa/Cairo' }, attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }] }, '?sendUpdates=all')).json()
    assert.equal(patched.start.dateTime, '2026-07-16T13:00:00+03:00')
    assert.equal(patched.sequence, 1)
    assert.equal(patched.hangoutLink, before.hangoutLink)
    assert.deepEqual(patched.attendees.map((a) => a.email), ['a@example.com', 'b@example.com'])
    assert.equal((await api(at, 'PATCH', `/${ID}`, { end: { dateTime: '2026-07-16T12:00:00+03:00', timeZone: 'Africa/Cairo' } })).status, 400)
    assert.equal((await api(at, 'DELETE', `/${ID}`, undefined, '?sendUpdates=all')).status, 204)
    assert.equal((await (await api(at, 'GET', `/${ID}`)).json()).status, 'cancelled')
    assert.equal((await api(at, 'DELETE', `/${ID}`)).status, 410)
    assert.equal((await api(at, 'PATCH', `/${ID}`, { summary: 'x' })).status, 410)
    const restored = await api(at, 'PATCH', `/${ID}`, { status: 'confirmed' })
    assert.equal((await restored.json()).status, 'confirmed')
    assert.equal((await api(at, 'DELETE', '/unknown1')).status, 404)
  })
  test('events are per account; another account cannot see them', async () => {
    await api(at, 'POST', '', ev({ conferenceData: undefined }))
    const other = (await tokens({ login_hint: 'other@athareg.com' })).body.access_token
    assert.equal((await api(other, 'GET', `/${ID}`)).status, 404)
    assert.equal((await fetch(`${g.url}/calendar/v3/calendars/cal@athareg.com/events/${ID}`, { headers: { authorization: `Bearer ${other}` } })).status, 404)
  })
  test('timeout-after-accept on insert still CREATES the event: the retry sees 409 (the idempotent path)', async () => {
    await ctl('/__control/inject', { target: 'calendar.insert', mode: 'timeout-after-accept' })
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 120)
    await assert.rejects(fetch(`${g.url}/calendar/v3/calendars/primary/events`, { method: 'POST', headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' }, body: JSON.stringify(ev({ conferenceData: undefined })), signal: ctrl.signal }))
    assert.equal((await api(at, 'POST', '', ev({ conferenceData: undefined }))).status, 409)
    assert.equal((await state()).events['cal@athareg.com'].length, 1)
  })
})

describe('control + inspection', () => {
  test('/__state counts calls, never lists /__ endpoints, masks tokens by default; /__reset clears everything', async () => {
    const t = await tokens()
    const masked = await fetch(`${g.url}/__state`).then((r) => r.json())
    assert.ok(masked.refreshTokens[0].token.includes('...'))
    assert.ok(!JSON.stringify(masked).includes(t.body.refresh_token))
    assert.ok(masked.counters.token >= 1)
    assert.ok(masked.calls.every((c) => !c.path.startsWith('/__')))
    await fetch(`${g.url}/__reset`, { method: 'POST' })
    const empty = await state()
    assert.deepEqual([empty.accounts.length, empty.refreshTokens.length, empty.calls.length, empty.counters.token], [0, 0, 0, 0])
  })
  test('unknown routes answer 404 JSON; health answers ok', async () => {
    assert.equal((await fetch(`${g.url}/nope`)).status, 404)
    assert.deepEqual(await fetch(`${g.url}/__health`).then((r) => r.json()), { ok: true })
  })
})
