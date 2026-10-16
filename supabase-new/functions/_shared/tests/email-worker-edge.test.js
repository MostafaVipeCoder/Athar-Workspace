// The email-worker request handler: authentication first (fail closed), body options that can only LOWER the limits, no recipient ever read from the request, a clean
// 503 listing env NAMES when the Google configuration is incomplete. Driven with fakes (no network, no database).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigError } from '../google-core.js'
import { createEmailWorkerHandler, resolveOptions } from '../email-worker-edge.js'
import { createMemoryOutbox, makeRow } from './helpers/memory-outbox.js'

const SECRET = 'worker-secret-0123456789-abcdefghij'
const SERVICE = 'service-role-key-0123456789-abcdefghij'
const ENV = { EMAIL_WORKER_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_URL: 'http://db.invalid' }
const post = (body, headers = { 'x-worker-secret': SECRET }) => new Request('http://fn.invalid/email-worker', { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })

// a createClient whose .rpc routes to the in-memory outbox, and a runtime stub (config + tokens + connection calls)
function harness({ rows = [], env = ENV, runtimeError = null } = {}) {
  const outbox = createMemoryOutbox({ rows })
  const calls = []
  const createClient = () => ({
    rpc: async (fn, a) => {
      calls.push(fn)
      if (fn === 'email_worker_claim') return { data: await outbox.claim({ worker: a.p_worker, limit: a.p_limit, leaseSeconds: a.p_lease_seconds }), error: null }
      if (fn === 'email_worker_mark_sending') return { data: await outbox.markSending(a.p_id, a.p_worker), error: null }
      if (fn === 'email_worker_finish') return { data: await outbox.finish({ id: a.p_id, worker: a.p_worker, outcome: a.p_outcome, code: a.p_code, detail: a.p_detail, delayMs: a.p_delay_ms, gmailMessageId: a.p_gmail_message_id, messageId: a.p_message_id, maxStreak: a.p_max_streak }), error: null }
      if (fn === 'email_worker_heartbeat') { await outbox.heartbeat(a.p_worker, a.p_summary); return { data: null, error: null } }
      return { data: null, error: { message: 'unexpected' } }
    },
  })
  const created = []
  const createEdgeRuntime = (o) => {
    if (runtimeError) throw runtimeError
    created.push(o)
    return {
      getConfig: () => ({ apiBase: 'http://gmail.invalid', apiTimeoutMs: 100 }),
      accessTokens: () => ({ getAccessToken: async () => 'tok', invalidate: () => {} }),
      db: { markConnection: async () => null, touchConnection: async () => null },
    }
  }
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(`gmail:${Buffer.from(body.raw, 'base64url').toString('utf8').match(/^To: (.*)$/m)?.[1] ?? '?'}`)
    return new Response(JSON.stringify({ id: `gm-${calls.length}`, threadId: 't' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const handler = createEmailWorkerHandler({ env: { get: (n) => env[n] }, createClient, createEdgeRuntime, fetch: fetchImpl, log: () => {}, now: () => 1_000_000, sleep: async () => {} })
  return { handler, outbox, calls, created }
}

describe('resolveOptions', () => {
  test('the environment sets the ceilings; a request can only lower them', () => {
    const env = { get: (n) => ({ EMAIL_PER_MINUTE: '40', EMAIL_DAILY_CAP: '1200' })[n] }
    assert.deepEqual(resolveOptions({}, env), { perMinute: 40, dailyCap: 1200, maxRunMs: 100_000, maxMessages: 400, batchLimit: 20 })
    const o = resolveOptions({ perMinute: 10, dailyCap: 5000, maxRunSeconds: 20, maxMessages: 9999, batch: 5 }, env)
    assert.deepEqual(o, { perMinute: 10, dailyCap: 1200, maxRunMs: 20_000, maxMessages: 400, batchLimit: 5 })
    assert.deepEqual(resolveOptions({ perMinute: 'abc', maxMessages: -3 }, { get: () => undefined }), { perMinute: 30, dailyCap: 1500, maxRunMs: 100_000, maxMessages: 400, batchLimit: 20 })
    assert.equal(resolveOptions({}, { get: (n) => (n === 'EMAIL_PER_MINUTE' ? '500' : undefined) }).perMinute, 60, 'never above Gmail\'s 60 a minute')
    assert.equal(resolveOptions(null, { get: () => undefined }).perMinute, 30)
  })
})

describe('handler', () => {
  test('only POST', async () => {
    const { handler } = harness()
    assert.equal((await handler(new Request('http://fn.invalid/email-worker', { method: 'GET' }))).status, 405)
  })
  test('without the secret nothing runs: 401 and no database call at all', async () => {
    const { handler, calls } = harness({ rows: [makeRow()] })
    assert.equal((await handler(post({}, {}))).status, 401)
    assert.equal((await handler(post({}, { 'x-worker-secret': 'wrong' }))).status, 401)
    assert.equal((await handler(post({}, { authorization: 'Bearer some-anon-key-0123456789' }))).status, 401)
    assert.deepEqual(calls, [])
  })
  test('not configured (no secret, no service key) = closed with 503', async () => {
    const { handler, calls } = harness({ env: { SUPABASE_URL: 'http://db.invalid' } })
    const res = await handler(post({}, { 'x-worker-secret': 'anything' }))
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { error: 'not_configured', missing: ['EMAIL_WORKER_SECRET'] })
    assert.deepEqual(calls, [])
  })
  test('an incomplete Google configuration is a 503 that lists env NAMES only', async () => {
    const { handler, calls } = harness({ runtimeError: new ConfigError('missing_env', ['GOOGLE_CLIENT_ID', 'TOKEN_ENC_KEY']) })
    const res = await handler(post({}))
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { error: 'not_configured', missing: ['GOOGLE_CLIENT_ID', 'TOKEN_ENC_KEY'] })
    assert.deepEqual(calls, [])
  })
  test('a bad body is 400; an oversized one too', async () => {
    const { handler } = harness()
    assert.equal((await handler(new Request('http://fn.invalid/e', { method: 'POST', headers: { 'x-worker-secret': SECRET }, body: '{not json' }))).status, 400)
    assert.equal((await handler(new Request('http://fn.invalid/e', { method: 'POST', headers: { 'x-worker-secret': SECRET }, body: 'x'.repeat(2500) }))).status, 400)
  })
  test('with the secret: claims, sends the STORED recipients (never a request field), answers a summary with counts only', async () => {
    const row = makeRow({ recipient: 'stored.person@example.invalid' })
    const { handler, outbox, calls } = harness({ rows: [row] })
    // a hostile body tries to redirect the mail: it is ignored
    const res = await handler(post({ to: 'attacker@evil.invalid', recipient: 'attacker@evil.invalid', cc: ['attacker@evil.invalid'], perMinute: 99999 }))
    assert.equal(res.status, 200)
    const summary = await res.json()
    assert.equal(summary.sent, 1)
    assert.equal(summary.stopped, 'idle')
    assert.ok(calls.includes('gmail:stored.person@example.invalid'))
    assert.ok(!calls.some((c) => c.includes('attacker')))
    assert.equal(outbox.get(row.id).status, 'sent')
    assert.ok(!JSON.stringify(summary).includes('stored.person'), 'the summary holds no address')
    assert.equal(outbox.heartbeats.length, 1)
  })
  test('the service-role key as a Bearer token is accepted too (scripts/trigger-email-worker.sh)', async () => {
    const { handler } = harness()
    assert.equal((await handler(post({}, { authorization: `Bearer ${SERVICE}` }))).status, 200)
  })
})
