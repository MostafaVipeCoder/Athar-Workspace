// The e-mail worker against the FAKE Google over real HTTP (db/scripts/fake-google): the real token provider, the real Gmail wrapper, the real MIME builder; only the
// database is the in-memory twin. Proves what travels on the wire: the decoded Arabic subject, the recipients, the Message-ID, and every failure mode of the fake.
// NEVER talks to a real Google endpoint (ALLOW_FAKE_GOOGLE, loopback only).
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeGoogle } from '../../../../db/scripts/fake-google/server.mjs'
import { buildAuthUrl, codeChallengeS256, createAccessTokenProvider, deriveCodeVerifier, exchangeCode } from '../google-core.js'
import { sendGmailMessage } from '../google-api.js'
import { runEmailWorker } from '../email-worker.js'
import { TEST_CLIENT_ID, TEST_CLIENT_SECRET, authorize, makeConfig } from './helpers/env.js'
import { createMemoryOutbox, makeRow } from './helpers/memory-outbox.js'

let g
let cfg
const refresh = {} // connection id -> refresh token (the "Vault")
const ctl = (path, body) => fetch(`${g.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json())
const quiet = () => {}

async function connect(email) {
  const nonce = `${email}-nonce-0123456789abcdef`.slice(0, 40).padEnd(22, 'x')
  const verifier = await deriveCodeVerifier(cfg.stateSecret, nonce)
  const url = buildAuthUrl(cfg, { state: 'x', challenge: await codeChallengeS256(verifier), loginHint: email })
  const loc = new URL(await authorize(url))
  return exchangeCode(cfg, { code: loc.searchParams.get('code'), codeVerifier: verifier })
}

const SENDERS = {
  pm: { id: 'conn-pm', email: 'pm.one@athareg.com', source: 'user', fallback: false, name: 'Mona Pm' },
  sys: { id: 'conn-sys', email: 'startups@athareg.com', source: 'system', fallback: true, name: null },
}

before(async () => {
  g = await startFakeGoogle({ port: 0, clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET })
  cfg = { ...makeConfig(g, { GOOGLE_PM_EMAIL_POLICY: 'same_domain' }), apiTimeoutMs: 400 }
})
after(async () => { await g.close() })
beforeEach(async () => {
  await fetch(`${g.url}/__reset`, { method: 'POST' })
  refresh['conn-pm'] = (await connect('pm.one@athareg.com')).refreshToken
  refresh['conn-sys'] = (await connect('startups@athareg.com')).refreshToken
})

function rig(rows, { now = { t: 5_000_000 } } = {}) {
  const db = createMemoryOutbox({ rows, now })
  const tokens = createAccessTokenProvider({ cfg, db, store: { load: async (id) => refresh[id] }, now: () => Date.now() })
  const deps = { db, tokens, send: (token, raw) => sendGmailMessage(cfg, token, raw), now: () => now.t, sleep: async (ms) => { now.t += ms }, rand: () => 0.5, log: quiet, workerId: 'w-fake' }
  return { db, deps, now, run: (o = {}) => runEmailWorker(deps, o) }
}
const messages = () => g.state.messages

describe('on the wire', () => {
  test('an Arabic interview invitation: decoded subject, recipients, tokenised link, Message-ID, sender, no RFC problems', async () => {
    const row = makeRow({
      email_key: 'interview', recipient: 'Founder.One@Example.invalid', cc: ['admin@athareg.com'],
      subject: 'دعوة لمقابلة: شركة النور', body_html: '<p>عزيزي أحمد،</p><p>احجز موعدك: <a href="https://app.example.invalid/book/interviews?invite=Tk3n_abc-123">رابط الحجز</a></p>', sender: SENDERS.pm,
    })
    const t = rig([row])
    const s = await t.run()
    assert.equal(s.sent, 1)
    assert.equal(messages().length, 1)
    const m = messages()[0]
    assert.equal(m.account, 'pm.one@athareg.com')
    assert.deepEqual(m.problems, [])
    assert.equal(m.subject, 'دعوة لمقابلة: شركة النور')
    assert.deepEqual(m.to.map((a) => a.email), ['founder.one@example.invalid'])
    assert.deepEqual(m.cc.map((a) => a.email), ['admin@athareg.com'])
    assert.equal(m.from[0].email, 'pm.one@athareg.com')
    assert.equal(m.messageId, `<${row.id}.1@athareg.com>`)
    assert.match(m.html, /invite=Tk3n_abc-123/)
    assert.match(m.text, /احجز موعدك/)
    assert.equal(t.db.get(row.id).gmail_message_id, m.id)
  })
  test('one Gmail message per recipient (never a Bcc blast)', async () => {
    const rows = ['a', 'b', 'c'].map((x) => makeRow({ recipient: `${x}@example.invalid`, sender: SENDERS.pm }))
    await rig(rows).run()
    assert.equal(messages().length, 3)
    for (const m of messages()) assert.equal(m.to.length, 1)
    assert.deepEqual(messages().map((m) => m.to[0].email).sort(), ['a@example.invalid', 'b@example.invalid', 'c@example.invalid'])
  })
})

describe('failure modes of the fake', () => {
  test('timeout AFTER Google accepted: the message exists once, the row is needs_review, and it is never sent again', async () => {
    const row = makeRow({ sender: SENDERS.pm })
    await ctl('/__control/inject', { target: 'gmail.send', mode: 'timeout-after-accept' })
    const t = rig([row])
    const s = await t.run()
    assert.equal(messages().length, 1, 'Google accepted it')
    assert.equal(t.db.get(row.id).status, 'needs_review')
    assert.equal(s.needs_review, 1)
    for (let i = 0; i < 3; i++) { t.now.t += 3_600_000; await t.run() }
    assert.equal(messages().length, 1, 'never auto-resent')
  })
  test('connection reset after Google accepted: the same', async () => {
    const row = makeRow({ sender: SENDERS.pm })
    await ctl('/__control/inject', { target: 'gmail.send', mode: 'reset-after-accept' })
    const t = rig([row])
    await t.run()
    assert.equal(messages().length, 1)
    assert.equal(t.db.get(row.id).status, 'needs_review')
    await t.run()
    assert.equal(messages().length, 1)
  })
  test('timeout BEFORE Google accepted is ALSO needs_review (the worker cannot tell the two apart): nothing is resent', async () => {
    const row = makeRow({ sender: SENDERS.pm })
    await ctl('/__control/inject', { target: 'gmail.send', mode: 'timeout-before-accept' })
    const t = rig([row])
    await t.run()
    assert.equal(messages().length, 0)
    assert.equal(t.db.get(row.id).status, 'needs_review')
  })
  test('429 + Retry-After: nothing recorded, the row waits at least that long, then goes out', async () => {
    const row = makeRow({ sender: SENDERS.pm })
    await ctl('/__control/inject', { target: 'gmail.send', mode: '429', retryAfter: 120 })
    const t = rig([row])
    await t.run()
    assert.equal(messages().length, 0)
    const r = t.db.get(row.id)
    assert.equal(r.status, 'queued')
    assert.ok(r.next_attempt_at >= 5_000_000 + 120_000, `next ${r.next_attempt_at}`)
    t.now.t += 130_000
    const s = await t.run()
    assert.equal(s.sent, 1)
    assert.equal(messages().length, 1)
  })
  test('a 503 is retried with backoff and delivered the second time (once, never twice)', async () => {
    const row = makeRow({ sender: SENDERS.pm })
    await ctl('/__control/inject', { target: 'gmail.send', mode: '503' })
    const t = rig([row])
    await t.run()
    assert.equal(t.db.get(row.id).status, 'queued')
    t.now.t += 60_000
    await t.run()
    assert.equal(t.db.get(row.id).status, 'sent')
    assert.equal(messages().length, 1)
  })
  test('401 from Gmail: a fresh token and ONE retry; the mail arrives once', async () => {
    const row = makeRow({ sender: SENDERS.pm })
    await ctl('/__control/inject', { target: 'gmail.send', mode: '401' })
    const t = rig([row])
    const s = await t.run()
    assert.equal(s.sent, 1)
    assert.equal(messages().length, 1)
  })
  test('invalid_grant (the user removed the app at Google): the connection is marked needs_reconnect, the rows return to the queue, then go out from the system sender', async () => {
    const rows = [makeRow({ sender: SENDERS.pm }), makeRow({ sender: SENDERS.pm })]
    await ctl('/__control/revoke-all', { email: 'pm.one@athareg.com' })
    const t = rig(rows)
    // the database's job: after needs_reconnect, resolve the rows to the system sender (startups@)
    const claim = t.db.claim.bind(t.db)
    t.db.claim = async (a) => {
      if (t.db.connectionMarks.length) for (const r of t.db.table.values()) if (r.sender.id === 'conn-pm') r.sender = SENDERS.sys
      return claim(a)
    }
    const s = await t.run()
    assert.deepEqual(t.db.connectionMarks, [['conn-pm', 'needs_reconnect', 'invalid_grant']])
    assert.equal(s.sent, 2)
    assert.deepEqual(messages().map((m) => m.account), ['startups@athareg.com', 'startups@athareg.com'])
    assert.equal(messages()[0].from[0].name, 'Athar Startups')
  })
  test('a recipient-specific failure only hits that recipient', async () => {
    const bad = makeRow({ recipient: 'bad@example.invalid', sender: SENDERS.pm })
    const good = makeRow({ recipient: 'good@example.invalid', sender: SENDERS.pm })
    await ctl('/__control/inject', { target: 'gmail.send', mode: '503', times: 5, match: { recipient: 'bad@' } })
    const t = rig([bad, good])
    await t.run()
    assert.equal(t.db.get(good.id).status, 'sent')
    assert.equal(t.db.get(bad.id).status, 'queued')
    assert.equal(messages().length, 1)
  })
})
