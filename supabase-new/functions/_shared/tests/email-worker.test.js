// The e-mail worker's logic against an in-memory twin of the m62 RPCs and a scripted `send` (no network). The same worker against the FAKE Google over HTTP:
// tests/email-worker.fake.test.js. The real SQL: db/verify/v62_email_worker.sql. The whole stack: db/scripts/verify-email-worker.mjs.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleError, ConfigError } from '../google-core.js'
import { MimeError } from '../google-mime.js'
import { parseMime, decodeBase64Url } from '../../../../db/scripts/fake-google/mime-parse.mjs'
import {
  WORKER_DEFAULTS, authorizeWorkerRequest, backoffMs, buildOutgoing, classifySendError, classifyTokenError, cleanCc, describeError, messageIdFor, mimeFailure, msUntil, runEmailWorker, safeEqual,
} from '../email-worker.js'
import { createMemoryOutbox, makeRow } from './helpers/memory-outbox.js'

const T0 = 1_000_000
const quiet = () => {}

function setup({ rows, send, tokens = null, now = { t: T0 }, perMinute = null, failFinish = 0, opts = {} } = {}) {
  const db = createMemoryOutbox({ rows, now, perMinute, failFinish })
  const sent = []
  const defaultSend = async (token, raw) => { sent.push(raw); return { id: `gm-${sent.length}` } }
  const deps = {
    db,
    tokens: tokens ?? { getAccessToken: async () => 'access-token-1', invalidate: () => {} },
    send: send ? async (t, raw) => { sent.push(raw); return send(t, raw, sent.length) } : defaultSend,
    now: () => now.t,
    sleep: async (ms) => { now.t += ms },
    rand: () => 0.5,
    log: quiet,
    workerId: 'worker-A',
  }
  return { db, deps, sent, now, run: (o = {}) => runEmailWorker(deps, { ...opts, ...o }) }
}
const err = (code, o = {}) => new GoogleError(code, o)

describe('pure helpers', () => {
  test('backoffMs: exponential, capped, jittered +-25 %, Retry-After wins, never below one second', () => {
    assert.equal(backoffMs(0, { rand: () => 0.5 }), 30_000)
    assert.equal(backoffMs(1, { rand: () => 0.5 }), 60_000)
    assert.equal(backoffMs(2, { rand: () => 0.5 }), 120_000)
    assert.equal(backoffMs(20, { rand: () => 0.5 }), WORKER_DEFAULTS.backoffMaxMs)
    assert.equal(backoffMs(0, { rand: () => 0 }), 22_500)
    assert.equal(backoffMs(0, { rand: () => 1 }), 37_500)
    assert.equal(backoffMs(0, { rand: () => 0.5, retryAfterMs: 90_000 }), 90_000)
    assert.equal(backoffMs(0, { rand: () => 0.5, retryAfterMs: 99_999_999 }), WORKER_DEFAULTS.retryAfterMaxMs)
    assert.equal(backoffMs(-5, { rand: () => 0.5, base: 100 }), 1000)
    assert.equal(backoffMs(Number.NaN, { rand: () => 0.5 }), 30_000)
  })
  test('msUntil', () => {
    assert.equal(msUntil('2026-10-15T10:00:20Z', '2026-10-15T10:00:00Z'), 20_000)
    assert.equal(msUntil('2026-10-15T10:00:00Z', '2026-10-15T10:00:20Z'), 0)
    assert.equal(msUntil(null, '2026-10-15T10:00:00Z'), null)
    assert.equal(msUntil('garbage', 'garbage'), null)
  })
  test('messageIdFor: outbox id + attempt + sender domain (a resend gets a new id)', () => {
    assert.equal(messageIdFor('abc', 1, 'pm@athareg.com'), '<abc.1@athareg.com>')
    assert.notEqual(messageIdFor('abc', 1, 'pm@athareg.com'), messageIdFor('abc', 2, 'pm@athareg.com'))
    assert.equal(messageIdFor('abc', 1, 'nonsense'), '<abc.1@athareg.com>')
  })
  test('cleanCc drops invalid and duplicate addresses and the recipient itself', () => {
    const r = cleanCc(['A@x.org', 'a@x.org', 'bad address', 'person@example.invalid', '', 'b@y.org', 'evil@x.org\r\nBcc: z@z.z'], 'Person@example.invalid')
    assert.deepEqual(r.valid, ['a@x.org', 'b@y.org'])
    assert.equal(r.dropped, 3)
    assert.deepEqual(cleanCc(null, 'a@b.c'), { valid: [], dropped: 0 })
  })
  test('describeError carries only the code, the status and the reason token', () => {
    assert.equal(describeError(err('rate_limited', { status: 429, reason: 'userRateLimitExceeded' })), 'google rate_limited http 429 userRateLimitExceeded')
    assert.equal(describeError(new ConfigError('missing_env', ['TOKEN_ENC_KEY'])), 'config missing_env TOKEN_ENC_KEY')
    assert.equal(describeError(new Error('secret-token-abc')), 'unexpected error')
  })
  test('mimeFailure maps MIME problems to permanent codes', () => {
    assert.equal(mimeFailure(new MimeError('invalid_address', 'to')), 'invalid_recipient')
    assert.equal(mimeFailure(new MimeError('header_injection', 'to')), 'invalid_recipient')
    assert.equal(mimeFailure(new MimeError('too_large', 'body')), 'message_too_large')
    assert.equal(mimeFailure(new MimeError('too_many_recipients', 'to')), 'too_many_recipients')
    assert.equal(mimeFailure(new MimeError('invalid_address', 'replyTo')), 'invalid_message')
    assert.equal(mimeFailure(Object.assign(new Error('x'), { code: 'no_content' })), 'no_content')
  })
})

describe('buildOutgoing', () => {
  test('Arabic subject and body survive; From is the connected account; Message-ID derives from the row; recipients come from the stored row', () => {
    const row = makeRow({ subject: 'مرحباً بك في برنامج أثر', body_html: '<p>عزيزي أحمد</p><p><a href="https://app.example.invalid/book/x?invite=tok">احجز</a></p>', recipient: 'Founder@Example.invalid', cc: ['cc@athareg.com'], reply_to: 'team@athareg.com' })
    const m = buildOutgoing(row, { sendAttempt: 3 })
    assert.equal(m.messageId, `<${row.id}.3@athareg.com>`)
    const p = parseMime(decodeBase64Url(m.raw).toString('utf8'))
    assert.deepEqual(p.problems, [])
    assert.equal(p.headers.subject, 'مرحباً بك في برنامج أثر')
    assert.equal(p.addresses.to[0].email, 'founder@example.invalid')
    assert.equal(p.addresses.cc[0].email, 'cc@athareg.com')
    assert.equal(p.addresses.replyTo[0].email, 'team@athareg.com')
    assert.equal(p.addresses.from[0].email, 'pm.one@athareg.com')
    assert.equal(p.addresses.from[0].name, 'Mona Pm - Athar')
    assert.match(p.html, /عزيزي أحمد/)
    assert.match(p.html, /invite=tok/)
    assert.match(p.text, /احجز/)
    assert.equal(p.headers.messageId, `<${row.id}.3@athareg.com>`)
  })
  test('the system sender is "Athar Startups"; a PM without a profile name is just "Athar"', () => {
    const sys = parseMime(decodeBase64Url(buildOutgoing(makeRow({ sender: { id: 's', email: 'startups@athareg.com', source: 'system', name: null } }), { sendAttempt: 1 }).raw).toString('utf8'))
    assert.equal(sys.addresses.from[0].name, 'Athar Startups')
    const anon = parseMime(decodeBase64Url(buildOutgoing(makeRow({ sender: { id: 's', email: 'pm@athareg.com', source: 'user', name: null } }), { sendAttempt: 1 }).raw).toString('utf8'))
    assert.equal(anon.addresses.from[0].name, 'Athar')
  })
  test('an invalid CC is dropped (the main e-mail still goes), an invalid recipient or an empty body is refused', () => {
    const ok = buildOutgoing(makeRow({ cc: ['bad cc', 'ok@athareg.com'] }), { sendAttempt: 1 })
    assert.equal(ok.ccDropped, 1)
    assert.throws(() => buildOutgoing(makeRow({ recipient: 'not an address' }), { sendAttempt: 1 }), (e) => e instanceof MimeError && e.field === 'to')
    assert.throws(() => buildOutgoing(makeRow({ recipient: 'a@b.co\r\nBcc: x@y.zz' }), { sendAttempt: 1 }), (e) => e instanceof MimeError)
    assert.throws(() => buildOutgoing(makeRow({ body_html: '   ' }), { sendAttempt: 1 }), (e) => e.code === 'no_content')
    assert.throws(() => buildOutgoing(makeRow({ subject: null }), { sendAttempt: 1 }), (e) => e.code === 'no_content')
  })
  test('a subject with a line break cannot inject a header', () => {
    const m = buildOutgoing(makeRow({ subject: 'Hello\r\nBcc: evil@evil.example' }), { sendAttempt: 1 })
    const p = parseMime(decodeBase64Url(m.raw).toString('utf8'))
    assert.deepEqual(p.problems, [])
    assert.equal(p.addresses.cc.length, 0)
    assert.ok(!p.rawHeaders.some(([n]) => n.toLowerCase() === 'bcc'))
  })
})

describe('classification', () => {
  test('unknown outcomes are needs_review, whatever the shape of the error', () => {
    for (const e of [err('timeout', { retryable: true, outcomeUnknown: true }), err('network', { retryable: true, outcomeUnknown: true, reason: 'ECONNRESET' }), err('bad_response', { outcomeUnknown: true }), new TypeError('boom'), new Error('x')]) {
      const c = classifySendError(e)
      assert.equal(c.outcome, 'needs_review', describeError(e))
      assert.equal(c.code, 'unknown_outcome')
    }
  })
  test('429 / rate limits retry with backoff and Retry-After; a daily limit blocks the sender for an hour', () => {
    const a = classifySendError(err('rate_limited', { status: 429, retryable: true, retryAfterMs: 120_000 }), { failStreak: 0, rand: () => 0.5 })
    assert.deepEqual([a.outcome, a.code, a.delayMs, a.circuit], ['retry', 'rate_limited', 120_000, 'limited'])
    const b = classifySendError(err('rate_limited', { status: 403, retryable: true, reason: 'userRateLimitExceeded' }), { failStreak: 2, rand: () => 0.5 })
    assert.deepEqual([b.outcome, b.delayMs], ['retry', 120_000])
    const c = classifySendError(err('rate_limited', { status: 429, retryable: true, reason: 'dailyLimitExceeded' }))
    assert.deepEqual([c.outcome, c.code, c.delayMs, c.circuit], ['blocked', 'daily_cap', 3_600_000, 'capped'])
  })
  test('5xx and a refused connection retry; 400 / 404 / other 4xx are permanent', () => {
    assert.equal(classifySendError(err('server_error', { status: 503, retryable: true })).outcome, 'retry')
    assert.equal(classifySendError(err('network', { retryable: true, outcomeUnknown: false, reason: 'ECONNREFUSED' })).outcome, 'retry')
    assert.deepEqual(['failed', 'rejected_by_gmail'], [classifySendError(err('bad_request', { status: 400 })).outcome, classifySendError(err('bad_request', { status: 400 })).code])
    assert.equal(classifySendError(err('not_found', { status: 404 })).code, 'not_found')
    assert.equal(classifySendError(err('http_418', { status: 418 })).code, 'http_418')
    assert.equal(classifySendError(err('conflict', { status: 409 })).outcome, 'failed')
  })
  test('401 / insufficient scope -> the sender must reconnect (the connection is marked); API disabled -> blocked worker_config; other 403 -> failed', () => {
    const a = classifySendError(err('unauthorized', { status: 401 }))
    assert.deepEqual([a.outcome, a.code, a.markConnection, a.circuit], ['blocked', 'sender_needs_reconnect', 'unauthorized', 'dead'])
    const b = classifySendError(err('forbidden', { status: 403, reason: 'insufficientPermissions' }))
    assert.deepEqual([b.outcome, b.code, b.markConnection], ['blocked', 'sender_needs_reconnect', 'insufficient_scope'])
    const c = classifySendError(err('forbidden', { status: 403, reason: 'accessNotConfigured' }))
    assert.deepEqual([c.outcome, c.code, c.delayMs], ['blocked', 'worker_config', 900_000])
    assert.deepEqual([classifySendError(err('forbidden', { status: 403, reason: 'domainPolicy' })).outcome, 'failed'].slice(0, 2), ['failed', 'failed'])
  })
  test('token errors: invalid_grant / no secret -> reconnect; bad client / config -> worker_config; transient -> retry', () => {
    assert.equal(classifyTokenError(err('invalid_grant', { needsReconnect: true })).code, 'sender_needs_reconnect')
    assert.equal(classifyTokenError(err('no_secret', { needsReconnect: true })).code, 'sender_needs_reconnect')
    assert.equal(classifyTokenError(err('invalid_client')).code, 'worker_config')
    assert.equal(classifyTokenError(new ConfigError('missing_env', ['TOKEN_ENC_KEY'])).code, 'worker_config')
    assert.equal(classifyTokenError(err('server_error', { retryable: true })).outcome, 'retry')
    assert.equal(classifyTokenError(err('timeout', { retryable: true, outcomeUnknown: true })).outcome, 'retry') // a TOKEN timeout: no mail left yet
    assert.equal(classifyTokenError(new Error('x')).outcome, 'retry')
  })
})

describe('authorizeWorkerRequest / safeEqual', () => {
  const H = (o) => new Headers(o)
  test('constant-time equality', async () => {
    assert.equal(await safeEqual('abc', 'abc'), true)
    assert.equal(await safeEqual('abc', 'abd'), false)
    assert.equal(await safeEqual('abc', ''), false)
    assert.equal(await safeEqual(undefined, undefined), true)
  })
  test('the shared secret or the service key opens it; anything else does not; nothing configured = closed', async () => {
    const secret = 'worker-secret-0123456789-abcdefghij'
    const key = 'service-role-key-0123456789-abcdefghij'
    assert.equal(await authorizeWorkerRequest(H({ 'x-worker-secret': secret }), { workerSecret: secret, serviceKey: key }), 'ok')
    assert.equal(await authorizeWorkerRequest(H({ authorization: `Bearer ${key}` }), { workerSecret: secret, serviceKey: key }), 'ok')
    assert.equal(await authorizeWorkerRequest(H({ authorization: `Bearer ${key}` }), { workerSecret: '', serviceKey: key }), 'ok')
    assert.equal(await authorizeWorkerRequest(H({ 'x-worker-secret': 'nope' }), { workerSecret: secret, serviceKey: key }), 'unauthorized')
    assert.equal(await authorizeWorkerRequest(H({}), { workerSecret: secret, serviceKey: key }), 'unauthorized')
    assert.equal(await authorizeWorkerRequest(H({ authorization: 'Bearer anon-key' }), { workerSecret: secret, serviceKey: key }), 'unauthorized')
    assert.equal(await authorizeWorkerRequest(H({ 'x-worker-secret': '' }), { workerSecret: '', serviceKey: '' }), 'not_configured')
    assert.equal(await authorizeWorkerRequest(H({ 'x-worker-secret': 'short' }), { workerSecret: 'short', serviceKey: '' }), 'not_configured')
  })
})

describe('runEmailWorker: the happy path and the audit rules', () => {
  test('sends every queued row once, one message per recipient, marks sent with the Gmail id and the Message-ID, touches the connection, writes a heartbeat', async () => {
    const rows = [makeRow(), makeRow(), makeRow()]
    const t = setup({ rows })
    const s = await t.run()
    assert.equal(s.sent, 3)
    assert.equal(t.sent.length, 3)
    assert.equal(s.stopped, 'idle')
    for (const r of rows) {
      const row = t.db.get(r.id)
      assert.equal(row.status, 'sent')
      assert.match(row.gmail_message_id, /^gm-/)
      assert.equal(row.message_id, `<${r.id}.1@athareg.com>`)
      assert.equal(row.send_attempt, 1)
    }
    assert.equal(t.db.touched.length, 3)
    assert.equal(t.db.heartbeats.length, 1)
    assert.equal(t.db.heartbeats[0].summary.sent, 3)
    // a second run finds nothing: a sent row is never sent again
    const s2 = await t.run()
    assert.equal(s2.claimed, 0)
    assert.equal(t.sent.length, 3)
  })
  test('the order of calls for ONE row: mark_sending happens BEFORE the request, finish after it', async () => {
    const row = makeRow()
    const t = setup({ rows: [row], send: async () => { assert.equal(t.db.get(row.id).send_started_at, T0, 'the marker must be persisted before the request leaves'); return { id: 'gm-1' } } })
    await t.run()
    assert.deepEqual(t.db.log.filter(([id]) => id === row.id).map((l) => l[1]), ['send_started', 'sent'])
  })
  test('what is logged never contains the recipient, the subject, the body or a token', async () => {
    const lines = []
    const row = makeRow({ recipient: 'secret.person@example.invalid', subject: 'Top secret subject', body_html: '<p>Top secret body with token=abc123</p>' })
    const t = setup({ rows: [row], send: async () => { throw err('server_error', { status: 500, retryable: true }) } })
    t.deps.log = (event, fields) => lines.push(JSON.stringify({ event, ...fields }))
    await t.run()
    const all = lines.join('\n') + JSON.stringify(t.db.log) + JSON.stringify(t.db.heartbeats)
    for (const needle of ['secret.person', 'Top secret', 'abc123', 'access-token-1']) assert.ok(!all.includes(needle), `leaked ${needle}`)
  })
})

describe('runEmailWorker: failures', () => {
  test('429 retries with backoff (Retry-After honoured), the other rows of that sender wait (circuit), nothing is lost', async () => {
    const rows = [makeRow(), makeRow(), makeRow()]
    const t = setup({ rows, send: async () => { throw err('rate_limited', { status: 429, retryable: true, retryAfterMs: 90_000 }) } })
    const s = await t.run()
    assert.equal(t.sent.length, 1, 'Google is not hit again for the rest of the batch')
    const [a, b, c] = rows.map((r) => t.db.get(r.id))
    assert.equal(a.status, 'queued'); assert.equal(a.fail_streak, 1); assert.equal(a.next_attempt_at, T0 + 90_000); assert.equal(a.error_code, 'rate_limited')
    for (const x of [b, c]) { assert.equal(x.status, 'queued'); assert.equal(x.blocked_reason, 'rate_limited'); assert.equal(x.fail_streak, 0) }
    assert.equal(s.retried, 1)
    assert.equal(s.blocked, 2)
  })
  test('a retried row is sent later and the streak resets; the sixth consecutive failure is permanent (max_attempts)', async () => {
    const row = makeRow()
    let fail = true
    const t = setup({ rows: [row], send: async () => { if (fail) throw err('server_error', { status: 503, retryable: true }); return { id: 'gm-ok' } } })
    await t.run()
    assert.equal(t.db.get(row.id).status, 'queued')
    assert.equal(t.db.get(row.id).fail_streak, 1)
    fail = false
    t.now.t += 60_000
    await t.run()
    assert.equal(t.db.get(row.id).status, 'sent')
    assert.equal(t.db.get(row.id).fail_streak, 0)
    // always failing: gives up after 6
    const row2 = makeRow()
    const t2 = setup({ rows: [row2], send: async () => { throw err('server_error', { status: 500, retryable: true }) } })
    for (let i = 0; i < 8; i++) { await t2.run(); t2.now.t += 7_200_000 }
    const r = t2.db.get(row2.id)
    assert.equal(r.status, 'failed')
    assert.equal(r.error_code, 'max_attempts')
    assert.equal(r.send_attempt, 6)
  })
  test('a permanent 400 is failed at once with a code, never retried', async () => {
    const row = makeRow()
    const t = setup({ rows: [row], send: async () => { throw err('bad_request', { status: 400 }) } })
    await t.run()
    await t.run()
    assert.equal(t.db.get(row.id).status, 'failed')
    assert.equal(t.db.get(row.id).error_code, 'rejected_by_gmail')
    assert.equal(t.sent.length, 1)
  })
  test('an invalid recipient / an empty body fail BEFORE anything is marked or sent', async () => {
    const bad = makeRow({ recipient: 'not-an-address' })
    const empty = makeRow({ body_html: '' })
    const t = setup({ rows: [bad, empty] })
    const s = await t.run()
    assert.equal(t.sent.length, 0)
    assert.equal(t.db.get(bad.id).error_code, 'invalid_recipient')
    assert.equal(t.db.get(empty.id).error_code, 'no_content')
    assert.equal(t.db.get(bad.id).send_attempt, 0)
    assert.equal(s.failed, 2)
  })
  test('401 once: a fresh token and ONE retry of the same request; 401 twice: the sender needs a reconnect and the connection is marked', async () => {
    const row = makeRow()
    let n = 0
    const tokens = { getAccessToken: async (id, o) => (o?.force ? 'fresh-token' : 'stale-token'), invalidate: () => { n += 1 } }
    const seen = []
    const t = setup({ rows: [row], tokens, send: async (token) => { seen.push(token); if (token === 'stale-token') throw err('unauthorized', { status: 401 }); return { id: 'gm-1' } } })
    await t.run()
    assert.deepEqual(seen, ['stale-token', 'fresh-token'])
    assert.equal(t.db.get(row.id).status, 'sent')
    assert.equal(n, 1)

    const row2 = makeRow()
    const t2 = setup({ rows: [row2], send: async () => { throw err('unauthorized', { status: 401 }) } })
    await t2.run()
    const r = t2.db.get(row2.id)
    assert.equal(r.status, 'queued'); assert.equal(r.blocked_reason, 'sender_needs_reconnect')
    assert.deepEqual(t2.db.connectionMarks, [['conn-pm', 'needs_reconnect', 'unauthorized']])
    assert.equal(t2.sent.length, 2, 'exactly one retry, not a loop')
  })
  test('invalid_grant when getting the token: no request, the row goes back with blocked_reason sender_needs_reconnect, the rest of that sender too', async () => {
    const rows = [makeRow(), makeRow()]
    const tokens = { getAccessToken: async () => { throw err('invalid_grant', { needsReconnect: true }) }, invalidate: () => {} }
    const t = setup({ rows, tokens })
    const s = await t.run()
    assert.equal(t.sent.length, 0)
    for (const r of rows) { const x = t.db.get(r.id); assert.equal(x.status, 'queued'); assert.equal(x.blocked_reason, 'sender_needs_reconnect'); assert.equal(x.send_attempt, 0) }
    assert.ok(s.blocked >= 2)
    assert.equal(t.db.connectionMarks.length, 0, 'the token provider marks the connection itself on invalid_grant')
  })
  test('FALLBACK: once the database resolves the same rows to the system sender they are sent from startups@ (the claimed row carries the new sender)', async () => {
    const rows = [makeRow(), makeRow()]
    let pmDead = true
    const t = setup({ rows, tokens: { getAccessToken: async (id) => { if (id === 'conn-pm') throw err('invalid_grant', { needsReconnect: true }); return 'sys-token' }, invalidate: () => {} } })
    // the database's job: re-resolve blocked rows to the system sender on the next claim
    const claim = t.db.claim.bind(t.db)
    t.db.claim = async (a) => {
      if (pmDead && t.db.connectionMarks.length + [...t.db.table.values()].filter((r) => r.blocked_reason).length > 0) for (const r of t.db.table.values()) r.sender = { id: 'conn-sys', email: 'startups@athareg.com', source: 'system', fallback: true, name: null }
      return claim(a)
    }
    const s = await t.run()
    assert.equal(s.sent, 2)
    for (const r of rows) assert.equal(t.db.get(r.id).status, 'sent')
    const from = t.sent.map((raw) => parseMime(decodeBase64Url(raw).toString('utf8')).addresses.from[0])
    assert.deepEqual(from.map((f) => f.email), ['startups@athareg.com', 'startups@athareg.com'])
    assert.equal(from[0].name, 'Athar Startups')
  })
  test('the database keeps handing out a dead sender in later batches: the worker waits (5 min) instead of spinning', async () => {
    const rows = [makeRow(), makeRow()]
    const tokens = { getAccessToken: async () => { throw err('invalid_grant', { needsReconnect: true }) }, invalidate: () => {} }
    const t = setup({ rows, tokens, opts: { batchLimit: 1 } })
    let claims = 0
    const claim = t.db.claim.bind(t.db)
    t.db.claim = async (a) => { claims += 1; if (claims > 10) throw new Error('spinning'); return claim(a) }
    await t.run()
    assert.ok(claims <= 5, `claims ${claims}`)
    assert.ok(rows.some((r) => t.db.get(r.id).next_attempt_at >= T0 + 300_000))
  })
  test('a token endpoint failure that is transient is a retry; a config failure is blocked worker_config', async () => {
    const a = makeRow()
    const t = setup({ rows: [a], tokens: { getAccessToken: async () => { throw err('server_error', { retryable: true }) }, invalidate: () => {} } })
    await t.run()
    assert.equal(t.db.get(a.id).status, 'queued'); assert.equal(t.db.get(a.id).fail_streak, 1)
    const b = makeRow()
    const t2 = setup({ rows: [b], tokens: { getAccessToken: async () => { throw new ConfigError('missing_env', ['TOKEN_ENC_KEY']) }, invalidate: () => {} } })
    await t2.run()
    assert.equal(t2.db.get(b.id).blocked_reason, 'worker_config')
  })
  test('daily cap reported by Google blocks the sender for an hour (daily_cap), the rest wait too', async () => {
    const rows = [makeRow(), makeRow()]
    const t = setup({ rows, send: async () => { throw err('rate_limited', { status: 429, retryable: true, reason: 'dailyLimitExceeded' }) } })
    await t.run()
    for (const r of rows) { assert.equal(t.db.get(r.id).blocked_reason, 'daily_cap'); assert.equal(t.db.get(r.id).next_attempt_at, T0 + 3_600_000) }
    assert.equal(t.sent.length, 1)
  })
})

describe('runEmailWorker: the CRITICAL rule - an unknown outcome is never sent again', () => {
  for (const [name, e] of [
    ['a timeout after the request was sent', err('timeout', { retryable: true, outcomeUnknown: true })],
    ['a connection reset after the request was sent', err('network', { retryable: true, outcomeUnknown: true, reason: 'ECONNRESET' })],
    ['a 200 without a message id', err('bad_response', { status: 200, outcomeUnknown: true })],
    ['an exception we did not foresee', new TypeError('weird')],
  ]) {
    test(name, async () => {
      const row = makeRow()
      const t = setup({ rows: [row], send: async () => { throw e } })
      const s = await t.run()
      assert.equal(t.db.get(row.id).status, 'needs_review')
      assert.equal(t.db.get(row.id).error_code, 'unknown_outcome')
      assert.equal(s.needs_review, 1)
      for (let i = 0; i < 4; i++) { t.now.t += 3_600_000; await t.run() }
      assert.equal(t.sent.length, 1, 'never auto-resent')
      assert.equal(t.db.get(row.id).status, 'needs_review')
    })
  }
  test('a worker that crashes AFTER the request marker leaves a row that is parked, not resent; one that crashed BEFORE it is requeued', async () => {
    const after = makeRow()
    const before = makeRow()
    const t = setup({ rows: [after, before] })
    // simulate: claim both, mark only `after`, then the process dies
    const c = await t.db.claim({ worker: 'dead-worker', limit: 10, leaseSeconds: 120 })
    assert.equal(c.rows.length, 2)
    await t.db.markSending(after.id, 'dead-worker')
    t.db.expireLeases()
    const s = await t.run()
    assert.equal(t.db.get(after.id).status, 'needs_review', 'a request may have left')
    assert.equal(t.db.get(before.id).status, 'sent', 'it never left, so it is simply sent now')
    assert.equal(t.sent.length, 1)
    assert.equal(s.sent, 1)
  })
  test('a late success of the SAME worker upgrades needs_review to sent (and a stranger cannot finish the row)', async () => {
    const row = makeRow()
    const t = setup({ rows: [row] })
    await t.db.claim({ worker: 'slow', limit: 1, leaseSeconds: 30 })
    await t.db.markSending(row.id, 'slow')
    t.db.expireLeases()
    t.db.reap()
    assert.equal(t.db.get(row.id).status, 'needs_review')
    const stranger = await t.db.finish({ id: row.id, worker: 'other', outcome: 'sent', gmailMessageId: 'x' })
    assert.equal(stranger.ok, false)
    const late = await t.db.finish({ id: row.id, worker: 'slow', outcome: 'sent', gmailMessageId: 'gm-late', messageId: '<m@athareg.com>' })
    assert.deepEqual([late.ok, late.status], [true, 'sent'])
  })
  test('two workers never send the same row: the second claim finds nothing, and a finish by the loser is refused', async () => {
    const rows = [makeRow(), makeRow()]
    const t = setup({ rows })
    const a = await t.db.claim({ worker: 'A', limit: 10, leaseSeconds: 120 })
    const b = await t.db.claim({ worker: 'B', limit: 10, leaseSeconds: 120 })
    assert.equal(a.rows.length, 2)
    assert.equal(b.rows.length, 0)
    assert.deepEqual(await t.db.markSending(rows[0].id, 'B'), { ok: false, reason: 'lease_lost' })
    assert.equal((await t.db.finish({ id: rows[0].id, worker: 'B', outcome: 'sent' })).ok, false)
  })
  test('a lost lease: the worker does nothing for that row (no request)', async () => {
    const row = makeRow()
    const t = setup({ rows: [row] })
    const claim = t.db.claim.bind(t.db)
    t.db.claim = async (a) => { const c = await claim(a); t.db.table.get(row.id).locked_by = 'someone-else'; return c }
    const s = await t.run()
    assert.equal(t.sent.length, 0)
    assert.equal(s.skipped, 1)
  })
})

describe('runEmailWorker: limits and housekeeping', () => {
  test('the per-minute quota: only that many go out, the rest are blocked with a visible reason and sent when the window slides (the worker waits for it)', async () => {
    const rows = Array.from({ length: 5 }, () => makeRow())
    const now = { t: T0 }
    const t = setup({ rows, now, perMinute: 2, opts: { maxIdleWaitMs: 0, maxRunMs: 5_000 } })
    const s = await t.run()
    assert.equal(s.sent, 2)
    assert.equal(rows.filter((r) => t.db.get(r.id).blocked_reason === 'rate_limited').length, 3)
    assert.equal(t.sent.length, 2)
    now.t += 61_000
    const s2 = await t.run({ maxRunMs: 5_000 })
    assert.equal(s2.sent, 2)
    now.t += 61_000
    await t.run({ maxRunMs: 5_000 })
    assert.equal(t.sent.length, 5)
    assert.ok(rows.every((r) => t.db.get(r.id).status === 'sent'))
  })
  test('maxMessages bounds one run', async () => {
    const rows = Array.from({ length: 7 }, () => makeRow())
    const t = setup({ rows, opts: { maxMessages: 3, batchLimit: 2 } })
    const s = await t.run()
    assert.equal(s.claimed, 3)
    assert.equal(s.stopped, 'max_messages')
    assert.equal(rows.filter((r) => t.db.get(r.id).status === 'queued').length, 4)
  })
  test('out of time: the untouched rows of the batch are RELEASED (never one whose request started)', async () => {
    const rows = [makeRow(), makeRow(), makeRow()]
    const now = { t: T0 }
    const t = setup({ rows, now, send: async () => { now.t += 70_000; return { id: 'gm-1' } } })
    const s = await t.run({ maxRunMs: 60_000 })
    assert.equal(t.sent.length, 1)
    assert.equal(s.stopped, 'deadline')
    assert.equal(s.released, 2)
    assert.deepEqual(rows.map((r) => t.db.get(r.id).status), ['sent', 'queued', 'queued'])
    assert.ok(rows.every((r) => t.db.get(r.id).locked_by === null))
  })
  test('a database blip on finish is retried (a delivered message must not be left as needs_review)', async () => {
    const row = makeRow()
    const t = setup({ rows: [row], failFinish: 2 })
    await t.run()
    assert.equal(t.db.get(row.id).status, 'sent')
  })
  test('one row that throws does not stop the batch (and is never lost)', async () => {
    const broken = makeRow({ sender: null })
    const ok = makeRow()
    const t = setup({ rows: [broken, ok] })
    const s = await t.run()
    assert.equal(s.skipped, 1)
    assert.equal(s.sent, 1)
    t.db.expireLeases()
    t.db.reap()
    assert.equal(t.db.get(broken.id).status, 'queued', 'the lease expired with no marker: requeued')
  })
})
