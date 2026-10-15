// Gmail + Calendar wrappers against the FAKE Google server (never a real Google endpoint).
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeGoogle } from '../../../../db/scripts/fake-google/server.mjs'
import { parseMime, decodeBase64Url } from '../../../../db/scripts/fake-google/mime-parse.mjs'
import { GoogleError, buildAuthUrl, codeChallengeS256, deriveCodeVerifier, exchangeCode, refreshAccessToken, revokeToken } from '../google-core.js'
import { sendGmailMessage, calendarDeleteEvent, calendarGetEvent, calendarInsertOrAdopt, calendarPatchEvent, waitForConference } from '../google-api.js'
import { buildEventInsert, buildEventPatch, extractMeetLink } from '../google-calendar.js'
import { makeMimeMessage } from '../google-mime.js'
import { TEST_CLIENT_ID, TEST_CLIENT_SECRET, authorize, makeConfig } from './helpers/env.js'

let g
let cfg
let token
const BOOKING = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const ctl = (path, body) => fetch(`${g.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json())
const state = () => fetch(`${g.url}/__state?include_tokens=1`).then((r) => r.json())

async function connect(email = 'pm.one@athareg.com') {
  const nonce = 'n'.repeat(22)
  const verifier = await deriveCodeVerifier(cfg.stateSecret, nonce)
  const url = buildAuthUrl(cfg, { state: 'x', challenge: await codeChallengeS256(verifier), loginHint: email })
  const loc = new URL(await authorize(url))
  return exchangeCode(cfg, { code: loc.searchParams.get('code'), codeVerifier: verifier })
}

before(async () => {
  g = await startFakeGoogle({ port: 0, clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET })
  cfg = makeConfig(g, { GOOGLE_PM_EMAIL_POLICY: 'same_domain' })
})
after(async () => { await g.close() })
beforeEach(async () => {
  await fetch(`${g.url}/__reset`, { method: 'POST' })
  token = (await connect()).accessToken
})

describe('OAuth calls', () => {
  test('exchangeCode returns the refresh token, normalised scopes and a decodable id token; refresh and revoke work', async () => {
    const t = await connect('someone@athareg.com')
    assert.match(t.refreshToken, /^1\/\/0fake-/)
    assert.ok(t.scopes.includes('https://www.googleapis.com/auth/gmail.send'))
    assert.ok(t.scopes.includes('https://www.googleapis.com/auth/userinfo.email'))
    assert.ok(t.expiresAt > Date.now())
    const r = await refreshAccessToken(cfg, t.refreshToken)
    assert.notEqual(r.accessToken, t.accessToken)
    assert.deepEqual((await revokeToken(cfg, t.refreshToken)), { revoked: true })
    await assert.rejects(refreshAccessToken(cfg, t.refreshToken), (e) => e.code === 'invalid_grant' && e.needsReconnect === true && e.retryable === false)
    assert.deepEqual(await revokeToken(cfg, 'unknown'), { revoked: false })
    assert.deepEqual(await revokeToken(cfg, ''), { revoked: false })
  })
  test('a wrong verifier, a reused code and a wrong client secret are reported without leaking anything', async () => {
    const nonce = 'q'.repeat(22)
    const verifier = await deriveCodeVerifier(cfg.stateSecret, nonce)
    const loc = new URL(await authorize(buildAuthUrl(cfg, { state: 'x', challenge: await codeChallengeS256(verifier) })))
    const code = loc.searchParams.get('code')
    const other = await deriveCodeVerifier(cfg.stateSecret, 'z'.repeat(22))
    await assert.rejects(exchangeCode(cfg, { code, codeVerifier: other }), (e) => e.code === 'invalid_grant' && !String(e.message).includes(code))
    await assert.rejects(exchangeCode({ ...cfg, clientSecret: 'wrong' }, { code, codeVerifier: verifier }), (e) => e.code === 'invalid_client')
    assert.ok((await exchangeCode(cfg, { code, codeVerifier: verifier })).refreshToken)
    await assert.rejects(exchangeCode(cfg, { code, codeVerifier: verifier }), (e) => e.code === 'invalid_grant')
  })
  test('token endpoint 5xx / 429 are retryable; an injected invalid_grant needs a reconnect', async () => {
    const t = await connect('r@athareg.com')
    await ctl('/__control/inject', { target: 'token', mode: '500' })
    await assert.rejects(refreshAccessToken(cfg, t.refreshToken), (e) => e.code === 'server_error' && e.retryable)
    await ctl('/__control/inject', { target: 'token', mode: '429', retryAfter: 4 })
    await assert.rejects(refreshAccessToken(cfg, t.refreshToken), (e) => e.code === 'rate_limited' && e.retryAfterMs === 4000)
    await ctl('/__control/inject', { target: 'token', mode: 'invalid_grant' })
    await assert.rejects(refreshAccessToken(cfg, t.refreshToken), (e) => e.code === 'invalid_grant' && e.needsReconnect)
  })
  test('a token endpoint that hangs times out quickly', async () => {
    const t = await connect('h@athareg.com')
    await ctl('/__control/inject', { target: 'token', mode: 'timeout-before-accept' })
    const t0 = Date.now()
    await assert.rejects(refreshAccessToken({ ...cfg, tokenTimeoutMs: 120 }, t.refreshToken), (e) => e.code === 'timeout')
    assert.ok(Date.now() - t0 < 2000)
  })
})

describe('Gmail send', () => {
  const message = (to = 'founder@example.com', extra = {}) => makeMimeMessage({ from: { email: 'pm.one@athareg.com', name: 'منى - Athar' }, to: [to], subject: 'دعوة لمقابلة', html: '<p>مرحباً</p>', messageId: `m-${Math.random().toString(16).slice(2, 10)}@athareg.com`, ...extra })

  test('sends and the fake Gmail receives the decoded message: Arabic subject, recipients, ids, no RFC problems', async () => {
    const m = message('علي@example.com'.replace('علي', 'ali'), { cc: ['admin@athareg.com'], replyTo: { email: 'pm.one@athareg.com' } })
    const r = await sendGmailMessage(cfg, token, m.raw)
    assert.ok(r.id)
    const got = (await state()).messages[0]
    assert.equal(got.subject, 'دعوة لمقابلة')
    assert.deepEqual(got.to.map((a) => a.email), ['ali@example.com'])
    assert.deepEqual(got.cc.map((a) => a.email), ['admin@athareg.com'])
    assert.equal(got.messageId, m.messageId)
    assert.deepEqual(got.problems, [])
    assert.equal(got.account, 'pm.one@athareg.com')
    assert.equal(got.html, '<p>مرحباً</p>')
  })
  test('401 (expired / revoked token) -> unauthorized, not retryable by itself; nothing recorded', async () => {
    await ctl('/__control/expire-access-tokens')
    await assert.rejects(sendGmailMessage(cfg, token, message().raw), (e) => e.code === 'unauthorized' && e.status === 401 && !e.retryable && !e.outcomeUnknown)
    assert.equal((await state()).messages.length, 0)
    await assert.rejects(sendGmailMessage(cfg, '', message().raw), (e) => e.code === 'unauthorized')
  })
  test('429 carries Retry-After and is retryable; a 403 rate limit too; a 500 is retryable and NOT outcome-unknown (Google answered)', async () => {
    await ctl('/__control/inject', { target: 'gmail.send', mode: '429', retryAfter: 9 })
    await assert.rejects(sendGmailMessage(cfg, token, message().raw), (e) => e.code === 'rate_limited' && e.retryable && e.retryAfterMs === 9000 && !e.outcomeUnknown)
    await ctl('/__control/inject', { target: 'gmail.send', mode: '403' })
    await assert.rejects(sendGmailMessage(cfg, token, message().raw), (e) => e.code === 'rate_limited' && e.retryable)
    await ctl('/__control/inject', { target: 'gmail.send', mode: '500' })
    await assert.rejects(sendGmailMessage(cfg, token, message().raw), (e) => e.code === 'server_error' && e.retryable && !e.outcomeUnknown)
    assert.equal((await state()).messages.length, 0)
  })
  test('a missing scope is a permanent 403 forbidden', async () => {
    await ctl('/__control/next-account', { email: 'ns@athareg.com', scopes_denied: ['https://www.googleapis.com/auth/gmail.send'] })
    const t = await connect('ns@athareg.com')
    await assert.rejects(sendGmailMessage(cfg, t.accessToken, message().raw), (e) => e.code === 'forbidden' && !e.retryable && e.reason === 'insufficientPermissions')
  })
  test('TIMEOUT AFTER ACCEPT: the error says the outcome is unknown (never auto-resend) and the message really was delivered once', async () => {
    await ctl('/__control/inject', { target: 'gmail.send', mode: 'timeout-after-accept' })
    await assert.rejects(sendGmailMessage({ ...cfg, apiTimeoutMs: 150 }, token, message('once@example.com').raw), (e) => e.code === 'timeout' && e.outcomeUnknown === true && e.retryable === true)
    assert.equal((await state()).messages.length, 1)
  })
  test('connection reset after accept -> network + outcome unknown; connection refused -> network + NOT unknown', async () => {
    await ctl('/__control/inject', { target: 'gmail.send', mode: 'reset-after-accept' })
    await assert.rejects(sendGmailMessage(cfg, token, message().raw), (e) => e.code === 'network' && e.outcomeUnknown === true)
    const dead = await startFakeGoogle({ port: 0 })
    const url = dead.url
    await dead.close()
    await assert.rejects(sendGmailMessage({ ...cfg, apiBase: url }, token, message().raw), (e) => e.code === 'network' && e.outcomeUnknown === false)
  })
  test('refuses a non-string / empty raw', async () => {
    for (const bad of [undefined, '', 42]) await assert.rejects(sendGmailMessage(cfg, token, bad), (e) => e.code === 'bad_request')
  })
})

describe('Calendar', () => {
  const common = { bookingId: BOOKING, summary: 'Mentor Session: Nile Co with Dr. Mona', description: 'Node A', startsAt: '2026-07-15T10:00:00Z', endsAt: '2026-07-15T10:30:00Z', timeZone: 'Africa/Cairo', attendees: [{ email: 'founder@example.com' }, { email: 'mentor@athareg.com' }] }

  test('create with a Meet request: created, pending, then the link appears; the stored event has the Cairo offset and the hex id', async () => {
    const built = buildEventInsert({ ...common, meetMode: 'unique' })
    const r = await calendarInsertOrAdopt(cfg, token, built)
    assert.equal(r.status, 'created')
    assert.equal(r.event.id, 'a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d')
    assert.equal(extractMeetLink(r.event), null)
    const done = await waitForConference(cfg, token, built.id, { attempts: 4, delayMs: 1, sleep: async () => {} })
    assert.equal(done.status, 'success')
    assert.match(done.link, /^https:\/\/meet\.google\.com\//)
    const stored = (await state()).events['pm.one@athareg.com'][0]
    assert.equal(stored.start.dateTime, '2026-07-15T13:00:00+03:00')
    assert.equal(stored.sendUpdates, 'all')
    assert.equal(stored.meetRequestId, BOOKING)
  })
  test('IDEMPOTENT: inserting the same booking twice yields ONE event (the 409 is adopted)', async () => {
    const built = buildEventInsert({ ...common, meetMode: 'unique' })
    const a = await calendarInsertOrAdopt(cfg, token, built)
    const b = await calendarInsertOrAdopt(cfg, token, built)
    assert.deepEqual([a.status, b.status], ['created', 'adopted'])
    assert.equal(b.event.id, a.event.id)
    assert.equal(b.cancelled, false)
    assert.equal((await state()).events['pm.one@athareg.com'].length, 1)
  })
  test('TIMEOUT AFTER ACCEPT on insert: the retry adopts the event Google already created (no duplicate)', async () => {
    const built = buildEventInsert({ ...common, meetMode: 'unique' })
    await ctl('/__control/inject', { target: 'calendar.insert', mode: 'timeout-after-accept' })
    await assert.rejects(calendarInsertOrAdopt({ ...cfg, apiTimeoutMs: 150 }, token, built), (e) => e.code === 'timeout' && e.outcomeUnknown)
    const retry = await calendarInsertOrAdopt(cfg, token, built)
    assert.equal(retry.status, 'adopted')
    assert.equal((await state()).events['pm.one@athareg.com'].length, 1)
  })
  test('without conferenceDataVersion=1 Google ignores conferenceData (our builder always sends it for unique mode)', async () => {
    const built = buildEventInsert({ ...common, meetMode: 'unique' })
    const r = await calendarInsertOrAdopt(cfg, token, { event: built.event, query: { sendUpdates: 'all' } })
    assert.equal(r.event.conferenceData, undefined)
    const w = await waitForConference(cfg, token, built.id, { attempts: 2, delayMs: 1, sleep: async () => {} })
    assert.equal(w.status, 'none')
  })
  test('shared mode: link in location + description, no conference, no waiting', async () => {
    const built = buildEventInsert({ ...common, meetMode: 'shared', sharedLink: 'https://meet.google.com/abc-defg-hij' })
    const r = await calendarInsertOrAdopt(cfg, token, built)
    assert.equal(r.event.location, 'https://meet.google.com/abc-defg-hij')
    assert.equal(r.event.conferenceData, undefined)
    assert.equal((await waitForConference(cfg, token, built.id, { attempts: 1 })).status, 'none')
  })
  test('reschedule patches the SAME event: new time in the project zone, same Meet link, same id', async () => {
    const built = buildEventInsert({ ...common, meetMode: 'unique' })
    await calendarInsertOrAdopt(cfg, token, built)
    const ready = await waitForConference(cfg, token, built.id, { attempts: 4, delayMs: 1, sleep: async () => {} })
    const patch = buildEventPatch({ startsAt: '2026-12-01T09:00:00Z', endsAt: '2026-12-01T09:30:00Z', timeZone: 'Africa/Cairo', attendees: [...common.attendees, { email: 'new@example.com' }] })
    const updated = await calendarPatchEvent(cfg, token, built.id, patch)
    assert.equal(updated.start.dateTime, '2026-12-01T11:00:00+02:00')
    assert.equal(extractMeetLink(updated), ready.link)
    assert.equal(updated.attendees.length, 3)
    await assert.rejects(calendarPatchEvent(cfg, token, 'doesnotexist1', patch), (e) => e.code === 'not_found')
  })
  test('cancel: events.delete with sendUpdates; already gone (404 / 410) counts as success; the cancelled id cannot be re-created but is ADOPTED and flagged', async () => {
    const built = buildEventInsert({ ...common, meetMode: 'unique' })
    await calendarInsertOrAdopt(cfg, token, built)
    assert.deepEqual(await calendarDeleteEvent(cfg, token, built.id), { deleted: true, alreadyGone: false })
    assert.equal((await state()).events['pm.one@athareg.com'][0].sendUpdates, 'all')
    assert.deepEqual(await calendarDeleteEvent(cfg, token, built.id), { deleted: false, alreadyGone: true }) // 410
    assert.deepEqual(await calendarDeleteEvent(cfg, token, 'neverexisted1'), { deleted: false, alreadyGone: true }) // 404
    const again = await calendarInsertOrAdopt(cfg, token, built)
    assert.deepEqual([again.status, again.cancelled], ['adopted', true])
    assert.equal(await calendarGetEvent(cfg, token, 'neverexisted1'), null)
  })
  test('failures are classified: 401 / 429 / 500 on insert, get, patch and delete', async () => {
    const built = buildEventInsert({ ...common, meetMode: 'unique' })
    await ctl('/__control/inject', { target: 'calendar.insert', mode: '429', retryAfter: 5 })
    await assert.rejects(calendarInsertOrAdopt(cfg, token, built), (e) => e.code === 'rate_limited' && e.retryAfterMs === 5000)
    await ctl('/__control/inject', { target: 'calendar.insert', mode: '500' })
    await assert.rejects(calendarInsertOrAdopt(cfg, token, built), (e) => e.code === 'server_error' && e.retryable)
    assert.equal(((await state()).events['pm.one@athareg.com'] ?? []).length, 0)
    await calendarInsertOrAdopt(cfg, token, built)
    await ctl('/__control/inject', { target: 'calendar.get', mode: '401' })
    await assert.rejects(calendarGetEvent(cfg, token, built.id), (e) => e.code === 'unauthorized')
    await ctl('/__control/inject', { target: 'calendar.delete', mode: '500' })
    await assert.rejects(calendarDeleteEvent(cfg, token, built.id), (e) => e.code === 'server_error')
    await ctl('/__control/inject', { target: 'calendar.patch', mode: '429' })
    await assert.rejects(calendarPatchEvent(cfg, token, built.id, { event: { summary: 'x' } }), (e) => e.code === 'rate_limited')
  })
  test('a token without the calendar scope is forbidden (permanent)', async () => {
    await ctl('/__control/next-account', { email: 'nc@athareg.com', scopes_denied: ['https://www.googleapis.com/auth/calendar.events'] })
    const t = await connect('nc@athareg.com')
    await assert.rejects(calendarInsertOrAdopt(cfg, t.accessToken, buildEventInsert({ ...common, meetMode: 'unique' })), (e) => e instanceof GoogleError && e.code === 'forbidden' && !e.retryable)
  })
  test('waitForConference gives up as pending when Google is slow (the job is retried later)', async () => {
    await ctl('/__control/config', { meetPendingGets: 50 })
    const built = buildEventInsert({ ...common, meetMode: 'unique' })
    await calendarInsertOrAdopt(cfg, token, built)
    const w = await waitForConference(cfg, token, built.id, { attempts: 3, delayMs: 1, sleep: async () => {} })
    assert.equal(w.status, 'pending')
    assert.equal(w.link, null)
  })
})

test('the decoded MIME helper agrees with the library (sanity of the shared helpers)', () => {
  const m = makeMimeMessage({ from: { email: 'a@athareg.com' }, to: ['b@example.com'], subject: 's', text: 't', messageId: 'x@athareg.com' })
  assert.deepEqual(parseMime(decodeBase64Url(m.raw).toString()).problems, [])
})
