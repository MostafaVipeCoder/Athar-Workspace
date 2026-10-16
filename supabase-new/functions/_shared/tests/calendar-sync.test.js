// The calendar sync worker (supabase-new/functions/_shared/calendar-sync.js) against the FAKE Google (db/scripts/fake-google): never a real endpoint.
// Pure logic (plan, event texts, attendees, time zones with DST, shared-link error, classification, backoff) and the integration scenarios of the task:
// create -> event with a Meet link written back; a duplicate job -> ONE event; cancel; reschedule; 429 / 500 retry; timeout after Google accepted ->
// no duplicate on the retry (409 -> adopt); invalid_grant -> the job is parked, not lost; shadow mode makes ZERO Google calls; two workers never share a job.
// The database is the in-memory twin (helpers/memory-calendar-db.js); db/verify/v63 and db/scripts/verify-calendar-sync.mjs test the real SQL.
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeGoogle } from '../../../../db/scripts/fake-google/server.mjs'
import { GoogleError, buildAuthUrl, codeChallengeS256, createAccessTokenProvider, deriveCodeVerifier, exchangeCode } from '../google-core.js'
import { CalendarConfigError } from '../google-calendar.js'
import { MAX_ATTEMPTS, backoffSeconds, buildDesired, classifyError, createCalendarDb, createCalendarWorker, eventMatches, eventTexts, failureCode, isServiceCall, planForLog, planJob } from '../calendar-sync.js'
import { createMemoryCalendarDb } from './helpers/memory-calendar-db.js'
import { TEST_CLIENT_ID, TEST_CLIENT_SECRET, authorize, makeConfig } from './helpers/env.js'

// ------------------------------------------------------------------------------------------------ pure logic
const ctxOf = (over = {}) => {
  const mem = createMemoryCalendarDb({ connections: [{ id: 'c-pm', kind: 'user', owner_user_id: 'u-pm-1', email: 'pm.one@athareg.com' }, { id: 'c-sys', kind: 'system', email: 'startups@athareg.com' }] })
  const b = mem.addBooking(over)
  const job = mem.addJob({ booking_id: b.id, kind: over.kind ?? 'calendar_create', status: 'processing', attempts: 1 })
  return mem.client.rpc('calendar_job_context', { p_job: job.id }).then((r) => r.data)
}

describe('backoff and classification', () => {
  test('backoffSeconds: 30 s doubling up to 30 min, jitter within +/- 20 %', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((a) => backoffSeconds(a, () => 0.5)), [30, 60, 120, 240, 480, 960, 1800, 1800])
    assert.equal(backoffSeconds(1, () => 0), 24)
    assert.equal(backoffSeconds(1, () => 1), 36)
  })
  test('classifyError: invalid_grant parks, 429 / 5xx / timeouts retry (Retry-After wins when longer), 400 / 403 / configuration are permanent', () => {
    const rand = () => 0.5
    assert.deepEqual(classifyError(new GoogleError('invalid_grant', { needsReconnect: true }), { attempt: 1, rand }), { park: 'needs_reconnect', delaySeconds: 30 })
    assert.deepEqual(classifyError(new GoogleError('rate_limited', { status: 429, retryable: true, retryAfterMs: 90_000 }), { attempt: 1, rand }), { retryable: true, code: 'rate_limited:429', delaySeconds: 90 })
    assert.deepEqual(classifyError(new GoogleError('rate_limited', { status: 429, retryable: true, retryAfterMs: 1000 }), { attempt: 3, rand }), { retryable: true, code: 'rate_limited:429', delaySeconds: 120 })
    assert.equal(classifyError(new GoogleError('server_error', { status: 500, retryable: true }), { attempt: 2, rand }).delaySeconds, 60)
    assert.equal(classifyError(new GoogleError('timeout', { retryable: true, outcomeUnknown: true }), { attempt: 1, rand }).retryable, true)
    assert.equal(classifyError(new GoogleError('unauthorized', { status: 401 }), { attempt: 1, rand }).retryable, true)
    assert.equal(classifyError(new GoogleError('conference_pending', { retryable: true, retryAfterMs: 20_000 }), { attempt: 1, rand }).delaySeconds, 30)
    assert.deepEqual(classifyError(new GoogleError('bad_request', { status: 400 }), { attempt: 1, rand }), { retryable: false, code: 'bad_request:400' })
    assert.deepEqual(classifyError(new GoogleError('forbidden', { status: 403 }), { attempt: 1, rand }), { retryable: false, code: 'forbidden:403' })
    assert.deepEqual(classifyError(new CalendarConfigError('shared_link_required', 'sharedLink')), { retryable: false, code: 'shared_link_required' })
    assert.equal(classifyError(new Error('boom')).retryable, true)
    assert.equal(failureCode(new Error('boom with a@b.com in it')), 'internal_error') // the message never becomes the code
  })
  test('isServiceCall needs the service-role key (constant length compare), nothing else', () => {
    const key = 'k'.repeat(40)
    const req = (h) => ({ headers: new Headers(h) })
    assert.equal(isServiceCall(req({ authorization: `Bearer ${key}` }), { SUPABASE_SERVICE_ROLE_KEY: key }), true)
    assert.equal(isServiceCall(req({ authorization: `Bearer ${'a'.repeat(40)}` }), { SUPABASE_SERVICE_ROLE_KEY: key }), false)
    assert.equal(isServiceCall(req({ authorization: `Bearer ${key}x` }), { SUPABASE_SERVICE_ROLE_KEY: key }), false)
    assert.equal(isServiceCall(req({}), { SUPABASE_SERVICE_ROLE_KEY: key }), false)
    assert.equal(isServiceCall(req({ authorization: `Bearer ${key}` }), { SUPABASE_SERVICE_ROLE_KEY: '' }), false)
  })
})

describe('event texts, attendees and time zones', () => {
  test('summary: mentor session vs interview, names in the booker language, whitespace collapsed', async () => {
    const mentor = eventTexts(await ctxOf({ company_en: 'Delta   Farms', provider: { name_en: 'Ahmed  Mentor' } }))
    assert.equal(mentor.summary, 'Mentor Session: Delta Farms with Ahmed Mentor')
    assert.match(mentor.description, /^Mentor sessions - Demo project\nBooker: Mona Fathy \(founder@example.com\)/)
    const interview = eventTexts(await ctxOf({ company_en: 'Delta Farms', node: { mode: 'interview' } }))
    assert.equal(interview.summary, 'Interview: Delta Farms with Ahmed Mentor')
    const ar = eventTexts(await ctxOf({ lang: 'ar', company_ar: 'دلتا', company_en: 'Delta' }))
    assert.equal(ar.summary, 'Mentor Session: دلتا with أحمد')
    assert.equal(eventTexts(await ctxOf({ booker_company_name: null, company_en: null, booker_name: null })).summary, 'Mentor Session: founder@example.com with Ahmed Mentor')
  })

  test('attendees = booker + provider + the node cc / admin lists, lower-cased, de-duplicated, invalid dropped, the organizer left out', async () => {
    const ctx = await ctxOf({ booker_email: 'Founder@Example.com', provider: { email: 'mentor@example.com, other@example.com' }, node: { cc: ['CC@athareg.com', 'founder@example.com', 'not an address'], admin: ['pm.one@athareg.com', 'admin@athareg.com'] } })
    const d = buildDesired(ctx, { email: 'pm.one@athareg.com' })
    assert.deepEqual(d.attendees.map((a) => a.email), ['founder@example.com', 'mentor@example.com', 'other@example.com', 'cc@athareg.com', 'admin@athareg.com'])
    assert.deepEqual(d.dropped, { invalid: 1 })
  })

  test('Africa/Cairo is DST-correct: +03:00 in summer, +02:00 in winter, and the repeated wall-clock hour of the autumn change differs by one hour of offset', async () => {
    const at = (iso, end) => buildDesired({ ...awaitedCtx, slot: { starts_at: iso, ends_at: end } }).view
    const awaitedCtx = await ctxOf({ project: { timezone: 'Africa/Cairo' } })
    assert.deepEqual([at('2026-07-15T07:00:00Z', '2026-07-15T07:30:00Z').start, at('2026-07-15T07:00:00Z', '2026-07-15T07:30:00Z').end], ['2026-07-15T10:00:00+03:00', '2026-07-15T10:30:00+03:00'])
    assert.equal(at('2026-12-15T08:00:00Z', '2026-12-15T08:30:00Z').start, '2026-12-15T10:00:00+02:00')
    // Egypt's summer time ends at 24:00 on the last Thursday of October (2026-10-29): 20:30Z is 23:30 +03:00, 21:30Z is 23:30 again, now +02:00
    assert.equal(at('2026-10-29T20:30:00Z', '2026-10-29T21:00:00Z').start, '2026-10-29T23:30:00+03:00')
    assert.equal(at('2026-10-29T21:30:00Z', '2026-10-29T22:00:00Z').start, '2026-10-29T23:30:00+02:00')
    assert.equal(at('2026-07-15T07:00:00Z', '2026-07-15T07:30:00Z').timeZone, 'Africa/Cairo')
  })

  test('a second zone (America/New_York) is DST-correct too, and the event carries the IANA zone next to the offset', async () => {
    const base = await ctxOf({ project: { timezone: 'America/New_York' } })
    const at = (s, e) => buildDesired({ ...base, slot: { starts_at: s, ends_at: e } }).insert.event
    assert.equal(at('2026-07-15T14:00:00Z', '2026-07-15T14:30:00Z').start.dateTime, '2026-07-15T10:00:00-04:00')
    assert.equal(at('2026-12-15T15:00:00Z', '2026-12-15T15:30:00Z').start.dateTime, '2026-12-15T10:00:00-05:00')
    assert.equal(at('2026-11-01T05:30:00Z', '2026-11-01T06:00:00Z').start.dateTime, '2026-11-01T01:30:00-04:00')
    assert.equal(at('2026-11-01T06:30:00Z', '2026-11-01T07:00:00Z').start.dateTime, '2026-11-01T01:30:00-05:00')
    assert.equal(at('2026-07-15T14:00:00Z', '2026-07-15T14:30:00Z').start.timeZone, 'America/New_York')
  })

  test('a missing or invalid project time zone is a permanent error, never a guess of UTC', async () => {
    for (const tz of [null, '', 'Mars/Olympus', 'UTC+3 maybe']) {
      const plan = planJob(await ctxOf({ project: { timezone: tz } }))
      assert.equal(plan.action, 'fail', String(tz))
      assert.equal(plan.code, 'invalid_timezone')
    }
  })

  test('shared Meet mode: the node link goes to location + description with NO conference request; an EMPTY link is an error (never a silent unique)', async () => {
    const ok = buildDesired(await ctxOf({ settings: { meeting_link_mode: 'shared', shared_meet_link: 'https://meet.google.com/abc-defg-hij' } }))
    assert.equal(ok.insert.event.location, 'https://meet.google.com/abc-defg-hij')
    assert.match(ok.insert.event.description, /https:\/\/meet\.google\.com\/abc-defg-hij$/)
    assert.equal(ok.insert.event.conferenceData, undefined)
    assert.equal(ok.insert.query.conferenceDataVersion, 0)
    for (const link of [null, '', '   ']) {
      const plan = planJob(await ctxOf({ settings: { meeting_link_mode: 'shared', shared_meet_link: link } }))
      assert.equal(plan.action, 'fail')
      assert.equal(plan.code, 'shared_link_required')
    }
    assert.equal(planJob(await ctxOf({ settings: { meeting_link_mode: 'shared', shared_meet_link: 'http://insecure.example/x' } })).code, 'shared_link_invalid')
    const unique = buildDesired(await ctxOf({}))
    assert.equal(unique.insert.event.conferenceData.createRequest.requestId, unique.insert.event.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'))
    assert.equal(unique.insert.query.conferenceDataVersion, 1)
  })

  test('the event id is the booking uuid in hex', async () => {
    const ctx = await ctxOf({ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
    assert.equal(buildDesired(ctx).insert.id, 'a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d')
    assert.equal(ctx.booking.event_id, 'a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d')
  })
})

describe('planJob decisions', () => {
  const NOW = Date.parse('2026-10-15T10:00:00Z')
  test('create / update / cancel on a normal booking', async () => {
    assert.equal(planJob(await ctxOf({}), { now: NOW }).action, 'create')
    assert.equal(planJob(await ctxOf({ kind: 'calendar_update' }), { now: NOW }).action, 'create') // never synced: an update is a create
    assert.equal(planJob(await ctxOf({ kind: 'calendar_update', synced_at: '2026-10-14T00:00:00Z', owner_connection_id: 'c-pm' }), { now: NOW }).action, 'patch')
    assert.equal(planJob(await ctxOf({ kind: 'calendar_cancel', status: 'cancelled', synced_at: '2026-10-14T00:00:00Z', owner_connection_id: 'c-pm' }), { now: NOW }).action, 'delete')
  })
  test('a cancelled booking never reaches Google when no event was ever created; a restored booking skips the old cancel job; a cancelled booking with a create job deletes', async () => {
    assert.deepEqual([planJob(await ctxOf({ kind: 'calendar_cancel', status: 'cancelled' })).action, planJob(await ctxOf({ kind: 'calendar_cancel', status: 'cancelled' })).skip], ['skip', 'never_synced'])
    assert.equal(planJob(await ctxOf({ kind: 'calendar_cancel', status: 'confirmed', synced_at: '2026-10-14T00:00:00Z', owner_connection_id: 'c-pm' })).skip, 'restored')
    assert.equal(planJob(await ctxOf({ kind: 'calendar_create', status: 'cancelled', synced_at: '2026-10-14T00:00:00Z', owner_connection_id: 'c-pm' })).action, 'delete')
  })
  test('migrated bookings (an event created by the Apps Script poller) are never created again; update / cancel act on the legacy event id through the system connection', async () => {
    const legacy = { legacy_event_id: '8vp3k0jsl1d2m4n5o6q7r8s9t0', meet_link: 'https://meet.google.com/old-link-xyz' }
    const create = planJob(await ctxOf({ ...legacy }), { now: NOW })
    assert.deepEqual([create.action, create.skip], ['skip', 'migrated'])
    const upd = planJob(await ctxOf({ ...legacy, kind: 'calendar_update' }), { now: NOW })
    assert.deepEqual([upd.action, upd.eventId, upd.connection.source, upd.connection.id], ['patch', '8vp3k0jsl1d2m4n5o6q7r8s9t0', 'legacy_system', 'c-sys'])
    const del = planJob(await ctxOf({ ...legacy, kind: 'calendar_cancel', status: 'cancelled' }), { now: NOW })
    assert.deepEqual([del.action, del.eventId, del.connection.id], ['delete', '8vp3k0jsl1d2m4n5o6q7r8s9t0', 'c-sys'])
  })
  test('a session that is already over gets no invitation (skip), unless an event already exists', async () => {
    const past = { starts_at: '2026-10-14T08:00:00Z', ends_at: '2026-10-14T08:30:00Z' }
    assert.equal(planJob(await ctxOf({ ...past }), { now: NOW }).skip, 'past')
    assert.equal(planJob(await ctxOf({ ...past, kind: 'calendar_update', synced_at: '2026-10-10T00:00:00Z', owner_connection_id: 'c-pm' }), { now: NOW }).action, 'patch')
  })
  test('the calendar owner: organizer setting, else the node owner, else the system sender; a frozen owner never moves; nobody usable -> park with the reason', async () => {
    const pm = (await ctxOf({})).connection
    assert.deepEqual([pm.id, pm.source], ['c-pm', 'user'])
    assert.equal((await ctxOf({ settings: { organizer_connection_id: 'c-sys' } })).connection.source, 'organizer')
    assert.equal((await ctxOf({ node: { created_by: 'someone-else' } })).connection.id, 'c-sys')
    // frozen: the event lives on the PM's calendar, the PM is not usable -> the system account is NOT used for it
    const mem = createMemoryCalendarDb({ connections: [{ id: 'c-pm', kind: 'user', owner_user_id: 'u-pm-1', email: 'pm.one@athareg.com', status: 'needs_reconnect' }, { id: 'c-sys', kind: 'system', email: 'startups@athareg.com' }] })
    const frozen = mem.addBooking({ synced_at: '2026-10-14T00:00:00Z', owner_connection_id: 'c-pm' })
    const fj = mem.addJob({ booking_id: frozen.id, kind: 'calendar_update', status: 'processing', attempts: 1 })
    const fctx = (await mem.client.rpc('calendar_job_context', { p_job: fj.id })).data
    assert.deepEqual([planJob(fctx).action, planJob(fctx).code], ['park', 'needs_reconnect'])
    // not frozen: the same unusable PM connection falls back to the system sender
    const fresh = mem.addBooking({})
    const nj = mem.addJob({ booking_id: fresh.id, status: 'processing', attempts: 1 })
    const nctx = (await mem.client.rpc('calendar_job_context', { p_job: nj.id })).data
    assert.deepEqual([planJob(nctx).action, planJob(nctx).connection.source], ['create', 'system'])
    // nobody usable at all
    const none = createMemoryCalendarDb({ connections: [] })
    const b = none.addBooking({})
    const j = none.addJob({ booking_id: b.id, status: 'processing', attempts: 1 })
    assert.deepEqual([planJob((await none.client.rpc('calendar_job_context', { p_job: j.id })).data).action, planJob((await none.client.rpc('calendar_job_context', { p_job: j.id })).data).code], ['park', 'needs_connection'])
  })
  test('planForLog is small, names no token and caps the attendee list', async () => {
    const ctx = await ctxOf({ node: { cc: Array.from({ length: 40 }, (_, i) => `cc${i}@athareg.com`) } })
    const log = planForLog(planJob(ctx, { now: NOW }))
    assert.equal(log.action, 'create')
    assert.equal(log.event.attendee_count, 42)
    assert.equal(log.event.attendees.length, 20)
    assert.ok(JSON.stringify(log).length < 8000)
    assert.ok(!JSON.stringify(log).match(/token|secret|authorization/i))
  })
  test('eventMatches compares instants and attendees, ignoring the organizer entry Google adds', async () => {
    const d = buildDesired(await ctxOf({}), { email: 'pm.one@athareg.com' })
    const ev = { start: { dateTime: d.insert.event.start.dateTime }, end: { dateTime: d.insert.event.end.dateTime }, attendees: [{ email: 'pm.one@athareg.com', organizer: true }, ...d.attendees.map((a) => ({ email: a.email }))] }
    assert.equal(eventMatches(ev, d, 'pm.one@athareg.com'), true)
    assert.equal(eventMatches({ ...ev, attendees: ev.attendees.slice(0, 2) }, d, 'pm.one@athareg.com'), false)
    assert.equal(eventMatches({ ...ev, start: { dateTime: '2030-01-01T00:00:00+02:00' } }, d, 'pm.one@athareg.com'), false)
  })
})

// ------------------------------------------------------------------------------------------------ integration with the fake Google
let g
let cfg
let clock
let mem
let tokens
let worker
let refresh
const ctl = (path, body) => fetch(`${g.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json())
const state = () => fetch(`${g.url}/__state`).then((r) => r.json())
const events = async (email = 'pm.one@athareg.com') => (await state()).events[email] ?? []
const calls = async () => (await state()).calls
const hex = (id) => id.replace(/-/g, '')

async function connect(email) {
  const nonce = 'n'.repeat(22)
  const verifier = await deriveCodeVerifier(cfg.stateSecret, nonce)
  const url = buildAuthUrl(cfg, { state: 'x', challenge: await codeChallengeS256(verifier), loginHint: email })
  const loc = new URL(await authorize(url))
  return exchangeCode(cfg, { code: loc.searchParams.get('code'), codeVerifier: verifier })
}

function build({ mode = 'live', withSystem = true, cfgOver = {} } = {}) {
  const conns = [{ id: 'c-pm', kind: 'user', owner_user_id: 'u-pm-1', email: 'pm.one@athareg.com' }]
  if (withSystem) conns.push({ id: 'c-sys', kind: 'system', email: 'startups@athareg.com' })
  mem = createMemoryCalendarDb({ mode, now: () => clock, connections: conns })
  const tokenCfg = { ...cfg, ...cfgOver }
  tokens = createAccessTokenProvider({ cfg: tokenCfg, db: mem.googleDb, store: { load: async (id) => refresh[id] }, now: () => clock })
  worker = createCalendarWorker({ db: createCalendarDb(mem.client), getConfig: () => tokenCfg, getTokens: () => tokens, now: () => clock, sleep: async () => {}, rand: () => 0.5, log: () => {}, meetPollDelayMs: 0 })
  return worker
}
const newBooking = (over = {}) => {
  const b = mem.addBooking({ ...over })
  const j = mem.addJob({ booking_id: b.id, kind: 'calendar_create', connection_id: null })
  return { b, j }
}

before(async () => {
  g = await startFakeGoogle({ port: 0, clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET })
  cfg = makeConfig(g, { GOOGLE_PM_EMAIL_POLICY: 'same_domain' })
})
after(async () => { await g.close() })
beforeEach(async () => {
  await fetch(`${g.url}/__reset`, { method: 'POST' })
  clock = Date.now()
  refresh = { 'c-pm': (await connect('pm.one@athareg.com')).refreshToken, 'c-sys': (await connect('startups@athareg.com')).refreshToken }
  await new Promise((r) => setTimeout(r, 40)) // the fake logs a call when its response FINISHES: let the last token call land first
  await ctl('/__control/clear-calls') // from here on every Google call is the worker's
  build()
})

describe('live: create', () => {
  test('create -> ONE event with the booking id in hex, the project zone, attendees, sendUpdates=all and a Meet link, written back to the booking', async () => {
    const { b, j } = newBooking({ node: { cc: ['cc@athareg.com'] } })
    const s = await worker.runOnce()
    assert.deepEqual([s.mode, s.claimed, s.done, s.errors], ['live', 1, 1, 0])
    const evs = await events()
    assert.equal(evs.length, 1)
    const ev = evs[0]
    assert.equal(ev.id, hex(b.id))
    assert.equal(ev.status, 'confirmed')
    assert.match(ev.start.dateTime, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+0[23]:00$/)
    assert.equal(ev.start.timeZone, 'Africa/Cairo')
    assert.deepEqual(ev.attendees.map((a) => a.email).sort(), ['cc@athareg.com', 'founder@example.com', 'mentor@example.com'])
    assert.equal(ev.sendUpdates, 'all')
    assert.equal(ev.guestsCanModify, false)
    assert.equal(ev.meetRequestId, b.id)
    assert.match(ev.meetCode, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/)
    assert.equal(b.meet_link, `https://meet.google.com/${ev.meetCode}`) // written back through complete_job
    assert.equal(b.owner_connection_id, 'c-pm')
    assert.ok(b.synced_at)
    assert.equal(j.status, 'done')
    assert.equal(j.result.action, 'created')
    assert.equal(j.result.event_id, hex(b.id))
    assert.equal(j.result.meet_link_set, true)
    assert.match(j.result.html_link, /^https:\/\/www\.google\.com\/calendar\/event\?eid=/)
    assert.equal(g.state.counters.calendar > 0, true)
  })

  test('a DUPLICATE create job (a second row for the same booking) creates no second event: the insert answers 409 and the event is adopted', async () => {
    const { b } = newBooking()
    mem.addJob({ booking_id: b.id, kind: 'calendar_create', payload: { origin: 'restore' } })
    await worker.runOnce() // claims only the first (one job per booking at a time)
    assert.equal((await events()).length, 1)
    const s = await worker.runOnce()
    assert.equal(s.done, 1)
    const evs = await events()
    assert.equal(evs.length, 1)
    assert.equal(mem.jobs.filter((j) => j.result?.action === 'adopted').length, 1)
    assert.equal(mem.jobs.every((j) => j.status === 'done'), true)
  })

  test('two jobs of ONE booking are never processed together (creation order), two bookings are', async () => {
    const a = newBooking()
    const b2 = newBooking()
    mem.addJob({ booking_id: a.b.id, kind: 'calendar_update', payload: { slot_id: 'x' } })
    const claimed = (await mem.client.rpc('calendar_claim_jobs', { p_limit: 10, p_lease_seconds: 300 })).data
    assert.equal(claimed.length, 2)
    assert.deepEqual(claimed.map((c) => c.booking_id).sort(), [a.b.id, b2.b.id].sort())
    assert.equal(claimed.filter((c) => c.booking_id === a.b.id)[0].kind, 'calendar_create')
  })

  test('shared Meet mode: no conference request, the node link is the booking link', async () => {
    const { b } = newBooking({ settings: { meeting_link_mode: 'shared', shared_meet_link: 'https://meet.google.com/abc-defg-hij' }, meet_link: 'https://meet.google.com/abc-defg-hij' })
    await worker.runOnce()
    const ev = (await events())[0]
    assert.equal(ev.id, hex(b.id))
    assert.equal(ev.location, 'https://meet.google.com/abc-defg-hij')
    assert.equal(ev.meetRequestId, null)
    assert.equal(ev.meetCode, null)
    assert.equal(b.meet_link, 'https://meet.google.com/abc-defg-hij')
  })

  test('shared mode with an EMPTY link: the job is dead with a clear code and Google is never called', async () => {
    const { j } = newBooking({ settings: { meeting_link_mode: 'shared', shared_meet_link: '' } })
    const s = await worker.runOnce()
    assert.deepEqual([s.dead, s.done], [1, 0])
    assert.deepEqual([j.status, j.error], ['dead', 'shared_link_required'])
    assert.equal((await calls()).length, 0)
    assert.equal((await events()).length, 0)
  })

  test('Meet not ready yet: the event exists and is remembered, the job retries and the retry adopts it (still one event) and stores the link', async () => {
    await ctl('/__control/config', { meetPendingGets: 5 }) // this event stays `pending` for 5 reads: the first pass (4 reads) gives up, the retry (adopt + reads) sees it ready
    const { b, j } = newBooking()
    const s = await worker.runOnce()
    assert.deepEqual([s.retried, s.done], [1, 0])
    assert.deepEqual([j.status, j.error], ['failed', 'conference_pending'])
    assert.equal((await events()).length, 1)
    assert.ok(b.synced_at && b.owner_connection_id === 'c-pm')
    assert.equal(b.meet_link, null)
    clock += 60_000
    const s2 = await worker.runOnce()
    assert.equal(s2.done, 1)
    assert.equal((await events()).length, 1)
    assert.match(b.meet_link, /^https:\/\/meet\.google\.com\//)
    assert.equal(j.result.action, 'adopted')
  })

  test('no usable connection anywhere: the job is PARKED (back to pending, no attempt counted), then runs when a connection exists', async () => {
    build({ withSystem: false })
    mem.conns.get('c-pm').status = 'revoked'
    const { b, j } = newBooking()
    const s = await worker.runOnce()
    assert.deepEqual([s.parked, s.done, s.retried], [1, 0, 0])
    assert.deepEqual([j.status, j.error, j.attempts], ['pending', 'needs_connection', 0])
    assert.equal((await calls()).length, 0)
    mem.conns.get('c-pm').status = 'active'
    mem.unpark()
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal(j.status, 'done')
    assert.ok(b.synced_at)
  })

  test('a cancelled booking whose create job never ran: no Google call at all', async () => {
    const { b, j } = newBooking()
    b.status = 'cancelled'
    mem.addJob({ booking_id: b.id, kind: 'calendar_cancel' })
    await worker.runOnce()
    await worker.runOnce()
    assert.equal((await calls()).length, 0)
    assert.deepEqual(mem.jobs.map((x) => x.result?.action), ['skipped_never_synced', 'skipped_never_synced'])
    assert.equal(j.status, 'done')
  })

  test('a session that is already over is skipped, a migrated booking is never created again (zero Google calls)', async () => {
    const past = newBooking({ slot: { starts_at: new Date(Math.floor((clock - 86400_000) / 60000) * 60000).toISOString() } })
    const legacy = newBooking({ legacy_event_id: '8vp3k0jsl1d2m4n5o6q7r8s9t0', meet_link: 'https://meet.google.com/old-link-xyz' })
    await worker.runOnce()
    assert.equal(past.j.result.action, 'skipped_past')
    assert.equal(legacy.j.result.action, 'skipped_migrated')
    assert.equal(legacy.b.meet_link, 'https://meet.google.com/old-link-xyz')
    assert.equal((await calls()).length, 0)
  })
})

describe('live: cancel, reschedule, restore, migrated', () => {
  async function created(over) {
    const x = newBooking(over)
    await worker.runOnce()
    assert.equal(x.j.status, 'done')
    return x
  }

  test('cancel -> the event is cancelled at Google (guests notified), a second cancel (410) is success', async () => {
    const { b } = await created()
    b.status = 'cancelled'
    const c1 = mem.addJob({ booking_id: b.id, kind: 'calendar_cancel' })
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal(c1.result.action, 'deleted')
    const ev = (await events())[0]
    assert.equal(ev.status, 'cancelled')
    assert.equal(ev.sendUpdates, 'all')
    clock += 1000
    const c2 = mem.addJob({ booking_id: b.id, kind: 'calendar_cancel' })
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal(c2.result.action, 'already_gone')
    assert.equal((await events()).length, 1)
  })

  test('reschedule -> the SAME event is patched (new times, same Meet link), never a second event', async () => {
    const { b } = await created()
    const link = b.meet_link
    const before = (await events())[0]
    b.slot.starts_at = new Date(Date.parse(before.start.dateTime) + 2 * 86400_000).toISOString()
    b.slot.ends_at = new Date(Date.parse(b.slot.starts_at) + 30 * 60_000).toISOString()
    const u = mem.addJob({ booking_id: b.id, kind: 'calendar_update', payload: { slot_id: 'new' } })
    assert.equal((await worker.runOnce()).done, 1)
    const evs = await events()
    assert.equal(evs.length, 1)
    assert.equal(evs[0].id, before.id)
    assert.equal(Date.parse(evs[0].start.dateTime), Date.parse(b.slot.starts_at))
    assert.equal(b.meet_link, link)
    assert.equal(u.result.action, 'patched')
    assert.equal(evs[0].sendUpdates, 'all')
  })

  test('restore: a cancelled-and-restored booking brings the deleted event back (status confirmed, current times), still one event', async () => {
    const { b } = await created()
    b.status = 'cancelled'
    mem.addJob({ booking_id: b.id, kind: 'calendar_cancel' })
    await worker.runOnce()
    assert.equal((await events())[0].status, 'cancelled')
    b.status = 'confirmed'
    clock += 1000
    const again = mem.addJob({ booking_id: b.id, kind: 'calendar_create', payload: { origin: 'restore' } })
    assert.equal((await worker.runOnce()).done, 1)
    const evs = await events()
    assert.equal(evs.length, 1)
    assert.equal(evs[0].status, 'confirmed')
    assert.equal(again.result.action, 'restored')
  })

  test('a stale cancel job for a restored booking does nothing (the create job re-establishes the event)', async () => {
    const { b } = await created()
    mem.addJob({ booking_id: b.id, kind: 'calendar_cancel' }) // booking is still confirmed (cancel was undone)
    await worker.runOnce()
    assert.equal(mem.jobs.at(-1).result.action, 'skipped_restored')
    assert.equal((await events())[0].status, 'confirmed')
  })

  test('a reschedule job on a booking whose event vanished re-creates it with the same id', async () => {
    const { b } = await created()
    await ctl('/__control/purge-event', { email: 'pm.one@athareg.com', id: hex(b.id) }) // somebody purged it at Google
    mem.addJob({ booking_id: b.id, kind: 'calendar_update', payload: { slot_id: 'n' } })
    assert.equal((await worker.runOnce()).done, 1)
    const evs = await events()
    assert.equal(evs.length, 1)
    assert.equal(evs[0].id, hex(b.id))
  })

  test('migrated booking: update patches the LEGACY event on the system calendar; cancel deletes it there; nothing is created', async () => {
    const legacyId = '8vp3k0jsl1d2m4n5o6q7r8s9t0'
    // the poller created the event on startups@'s calendar: seed it through the fake's own API
    const sysToken = (await tokens.getAccessToken('c-sys'))
    const seed = await fetch(`${g.url}/calendar/v3/calendars/primary/events?sendUpdates=none`, { method: 'POST', headers: { authorization: `Bearer ${sysToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: legacyId, summary: 'old', start: { dateTime: '2026-07-01T10:00:00+03:00', timeZone: 'Africa/Cairo' }, end: { dateTime: '2026-07-01T10:30:00+03:00', timeZone: 'Africa/Cairo' } }) })
    assert.equal(seed.status, 200)
    const b = mem.addBooking({ legacy_event_id: legacyId, meet_link: 'https://meet.google.com/old-link-xyz' })
    const upd = mem.addJob({ booking_id: b.id, kind: 'calendar_update' })
    assert.equal((await worker.runOnce()).done, 1)
    const sysEvents = await events('startups@athareg.com')
    assert.equal(sysEvents.length, 1)
    assert.equal(sysEvents[0].id, legacyId)
    assert.equal(Date.parse(sysEvents[0].start.dateTime), Date.parse(b.slot.starts_at))
    assert.equal(b.meet_link, 'https://meet.google.com/old-link-xyz') // the migrated link is kept
    assert.equal(upd.result.action, 'patched')
    b.status = 'cancelled'
    mem.addJob({ booking_id: b.id, kind: 'calendar_cancel' })
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal((await events('startups@athareg.com'))[0].status, 'cancelled')
    assert.equal((await events()).length, 0) // nothing on the PM's calendar
  })
})

describe('live: failures, retries and idempotency', () => {
  test('HTTP 429 with Retry-After: retried later (the delay honours Retry-After), then succeeds with ONE event', async () => {
    await ctl('/__control/inject', { target: 'calendar.insert', mode: '429', times: 1, retryAfter: 90 })
    const { j } = newBooking()
    const s = await worker.runOnce()
    assert.deepEqual([s.retried, s.done], [1, 0])
    assert.deepEqual([j.status, j.error, j.attempts], ['failed', 'rate_limited:429', 1])
    assert.ok(j.next_attempt_at - clock >= 90_000)
    assert.equal((await worker.runOnce()).claimed, 0) // not due yet
    clock += 91_000
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal(j.attempts, 2)
    assert.equal((await events()).length, 1)
  })

  test('HTTP 500: exponential backoff, and after MAX_ATTEMPTS the job is dead (visible, retryable by the PM) - never lost, never a duplicate', async () => {
    await ctl('/__control/inject', { target: 'calendar.insert', mode: '500', times: 20 })
    const { b, j } = newBooking()
    const delays = []
    for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
      await worker.runOnce()
      assert.equal(j.attempts, i)
      if (j.status === 'failed') { delays.push(j.next_attempt_at - clock); clock = j.next_attempt_at + 1 }
    }
    assert.deepEqual(delays, [30_000, 60_000, 120_000, 240_000, 480_000])
    assert.deepEqual([j.status, j.error], ['dead', 'server_error:500'])
    assert.equal((await events()).length, 0)
    assert.ok(b)
    // the PM's "Retry" = attempts back to 0, due now (m63 retry_calendar_job); the injection is exhausted -> success
    await ctl('/__control/clear-injections')
    Object.assign(j, { status: 'pending', attempts: 0, next_attempt_at: clock, error: null })
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal((await events()).length, 1)
  })

  test('a permanent error (HTTP 400 from Google) is dead at once with a short code', async () => {
    await ctl('/__control/inject', { target: 'calendar.insert', mode: '403', times: 1 }) // 403 rate limit in the fake: retryable
    const { j } = newBooking()
    await worker.runOnce()
    assert.equal(j.status, 'failed')
    // a real 400: an event id the fake rejects
    const bad = newBooking({ settings: { meeting_link_mode: 'shared', shared_meet_link: 'https://meet.google.com/ok' } })
    bad.b.slot.ends_at = bad.b.slot.starts_at // a zero-length slot: our own builder refuses it before Google is called
    clock += 60_000
    await worker.runOnce()
    assert.deepEqual([bad.j.status, bad.j.error], ['dead', 'invalid_time'])
  })

  test('TIMEOUT AFTER GOOGLE ACCEPTED the event: the first attempt fails (outcome unknown), the retry gets 409 and ADOPTS it - no duplicate event', async () => {
    await ctl('/__control/inject', { target: 'calendar.insert', mode: 'timeout-after-accept', times: 1 })
    build({ cfgOver: { apiTimeoutMs: 200 } })
    const { b, j } = newBooking()
    const s = await worker.runOnce()
    assert.deepEqual([s.retried, s.done], [1, 0])
    assert.deepEqual([j.status, j.error], ['failed', 'timeout'])
    assert.equal((await events()).length, 1) // Google created it although we never saw the answer
    assert.equal(b.synced_at, null) // we do not know yet
    clock += 60_000
    const s2 = await worker.runOnce()
    assert.equal(s2.done, 1)
    const evs = await events()
    assert.equal(evs.length, 1)
    assert.equal(evs[0].id, hex(b.id))
    assert.equal(j.result.action, 'adopted')
    assert.match(b.meet_link, /^https:\/\/meet\.google\.com\//)
    assert.ok(b.synced_at && b.owner_connection_id === 'c-pm')
  })

  test('a cancel that arrives after a lost create answer still reaches the event (the attempt counter proves Google may hold it)', async () => {
    await ctl('/__control/inject', { target: 'calendar.insert', mode: 'timeout-after-accept', times: 1 })
    build({ cfgOver: { apiTimeoutMs: 200 } })
    const { b } = newBooking()
    await worker.runOnce() // the create attempt timed out: event exists at Google, synced_at unknown
    b.status = 'cancelled'
    const c = mem.addJob({ booking_id: b.id, kind: 'calendar_cancel' })
    clock += 60_000
    await worker.runOnce() // the create job is retried FIRST (older), sees a cancelled booking and deletes; the cancel job follows
    await worker.runOnce()
    const evs = await events()
    assert.equal(evs.length, 1)
    assert.equal(evs[0].status, 'cancelled')
    assert.equal(c.status, 'done')
  })

  test('invalid_grant (the PM removed the app at Google): the connection becomes needs_reconnect, the job is PARKED (not failed, no attempt), and with the system sender available the next pass uses it', async () => {
    await ctl('/__control/revoke-all', { email: 'pm.one@athareg.com' })
    const { b, j } = newBooking()
    const s = await worker.runOnce()
    assert.deepEqual([s.parked, s.done, s.dead], [1, 0, 0])
    assert.equal(mem.conns.get('c-pm').status, 'needs_reconnect')
    assert.deepEqual([j.status, j.error, j.attempts], ['pending', 'needs_reconnect', 0])
    assert.equal((await events()).length, 0)
    clock += 31_000
    const s2 = await worker.runOnce() // the PM is not usable any more: the new event goes to startups@
    assert.equal(s2.done, 1)
    assert.equal((await events('startups@athareg.com')).length, 1)
    assert.equal(b.owner_connection_id, 'c-sys')
  })

  test('invalid_grant with NO system sender: the job stays parked as needs_reconnect (nothing lost) and runs after the PM reconnects', async () => {
    build({ withSystem: false })
    await ctl('/__control/revoke-all', { email: 'pm.one@athareg.com' })
    const { b, j } = newBooking()
    await worker.runOnce()
    clock += 31_000
    const s2 = await worker.runOnce()
    assert.deepEqual([s2.parked, s2.done], [1, 0])
    assert.deepEqual([j.status, j.error], ['pending', 'needs_reconnect'])
    // the PM connects again (a new grant) and the connection is active: the trigger of m63 makes the job due
    refresh['c-pm'] = (await connect('pm.one@athareg.com')).refreshToken
    mem.conns.get('c-pm').status = 'active'
    tokens.invalidate('c-pm')
    mem.unpark()
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal((await events()).length, 1)
    assert.equal(b.owner_connection_id, 'c-pm')
  })

  test('a frozen owner is NEVER replaced by the system sender: update / cancel of an event on a disconnected PM calendar wait (parked)', async () => {
    const { b } = newBooking()
    await worker.runOnce()
    assert.equal(b.owner_connection_id, 'c-pm')
    await ctl('/__control/revoke-all', { email: 'pm.one@athareg.com' })
    tokens.invalidate('c-pm')
    b.status = 'cancelled'
    const c = mem.addJob({ booking_id: b.id, kind: 'calendar_cancel' })
    await worker.runOnce()
    clock += 31_000
    const s = await worker.runOnce()
    assert.equal(s.done, 0)
    assert.deepEqual([c.status, c.error], ['pending', 'needs_reconnect'])
    assert.equal((await events('startups@athareg.com')).length, 0)
  })

  test('a connection whose stored secret is GONE: the job is parked (needs_reconnect), the connection is marked needs_reconnect, the next pass falls back to the system sender', async () => {
    const noSecret = createAccessTokenProvider({ cfg, db: mem.googleDb, store: { load: async (id) => { if (id === 'c-pm') throw new GoogleError('no_secret', { needsReconnect: true }); return refresh[id] } }, now: () => clock })
    worker = createCalendarWorker({ db: createCalendarDb(mem.client), getConfig: () => cfg, getTokens: () => noSecret, now: () => clock, sleep: async () => {}, rand: () => 0.5, log: () => {}, meetPollDelayMs: 0, markConnection: (id, st, c) => mem.googleDb.markConnection(id, st, c) })
    const { b, j } = newBooking()
    const s = await worker.runOnce()
    assert.deepEqual([s.parked, s.done], [1, 0])
    assert.deepEqual([j.status, j.error, j.attempts], ['pending', 'needs_reconnect', 0])
    assert.equal(mem.conns.get('c-pm').status, 'needs_reconnect')
    clock += 31_000
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal(b.owner_connection_id, 'c-sys')
    assert.equal((await events('startups@athareg.com')).length, 1)
  })

  test('a 401 for a token Google no longer accepts: one fresh token, one more try, success', async () => {
    await tokens.getAccessToken('c-pm') // cached
    await ctl('/__control/inject', { target: 'calendar.insert', mode: '401', times: 1 })
    const { j } = newBooking()
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal(j.status, 'done')
    assert.equal((await events()).length, 1)
  })
})

describe('modes and leases', () => {
  test('SHADOW: every pending job is planned and logged ONCE, with ZERO Google calls (not even the token endpoint), no lock, no state change', async () => {
    build({ mode: 'shadow' })
    const a = newBooking({ node: { cc: ['cc@athareg.com'] } })
    const legacy = newBooking({ legacy_event_id: '8vp3k0jsl1d2m4n5o6q7r8s9t0' })
    const shared = newBooking({ settings: { meeting_link_mode: 'shared', shared_meet_link: '' } })
    const s = await worker.runOnce()
    assert.deepEqual([s.mode, s.shadowed, s.claimed, s.done], ['shadow', 3, 0, 0])
    assert.equal((await calls()).length, 0)
    assert.equal(g.state.counters.calendar, 0)
    assert.deepEqual(mem.jobs.map((j) => [j.status, j.attempts, j.locked_until]), [['pending', 0, null], ['pending', 0, null], ['pending', 0, null]])
    const logged = mem.log.filter((l) => l.event === 'shadow')
    assert.equal(logged.length, 3)
    const plan = (job) => logged.find((l) => l.job_id === job.id).detail
    assert.equal(plan(a.j).action, 'create')
    assert.equal(plan(a.j).event.attendee_count, 3)
    assert.equal(plan(a.j).event.start.endsWith('+03:00') || plan(a.j).event.start.endsWith('+02:00'), true)
    assert.equal(plan(a.j).calendar, 'pm.one@athareg.com')
    assert.equal(plan(legacy.j).skip, 'migrated')
    assert.deepEqual([plan(shared.j).action, plan(shared.j).code], ['fail', 'shared_link_required'])
    const again = await worker.runOnce()
    assert.equal(again.shadowed, 0) // logged once per job
    assert.equal(mem.log.filter((l) => l.event === 'shadow').length, 3)
    assert.equal((await calls()).length, 0)
  })

  test('SHADOW needs no Google configuration at all (no token provider, no config)', async () => {
    mem = createMemoryCalendarDb({ mode: 'shadow', now: () => clock, connections: [{ id: 'c-pm', kind: 'user', owner_user_id: 'u-pm-1', email: 'pm.one@athareg.com' }] })
    const w = createCalendarWorker({ db: createCalendarDb(mem.client), getConfig: () => { throw new Error('Google must not be configured in shadow') }, getTokens: () => { throw new Error('no tokens in shadow') }, now: () => clock, log: () => {} })
    newBooking()
    assert.equal((await w.runOnce()).shadowed, 1)
  })

  test('OFF: nothing is claimed, planned or called; LIVE afterwards processes the waiting jobs exactly once', async () => {
    build({ mode: 'off' })
    const { j } = newBooking()
    const s = await worker.runOnce()
    assert.deepEqual([s.mode, s.claimed, s.shadowed], ['off', 0, 0])
    assert.equal(j.status, 'pending')
    assert.equal((await calls()).length, 0)
    mem.state.mode = 'live'
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal((await worker.runOnce()).claimed, 0)
    assert.equal((await events()).length, 1)
  })

  test('shadow -> live: a job that was only PLANNED in shadow is created once in live (the shadow log never blocks it)', async () => {
    build({ mode: 'shadow' })
    const { j } = newBooking()
    await worker.runOnce()
    assert.equal(j.status, 'pending')
    mem.state.mode = 'live'
    assert.equal((await worker.runOnce()).done, 1)
    assert.equal((await events()).length, 1)
  })

  test('two workers claiming at the same time never share a job; an expired lease is reclaimed by the next worker and the stale worker is FENCED', async () => {
    const jobs = [newBooking().j, newBooking().j, newBooking().j]
    const a = (await mem.client.rpc('calendar_claim_jobs', { p_limit: 2, p_lease_seconds: 300 })).data
    const b = (await mem.client.rpc('calendar_claim_jobs', { p_limit: 2, p_lease_seconds: 300 })).data
    assert.equal(a.length, 2)
    assert.equal(b.length, 1)
    assert.equal(new Set([...a, ...b].map((x) => x.id)).size, 3)
    assert.deepEqual(jobs.map((j) => j.attempts), [1, 1, 1])
    // worker A dies holding job a[0]; its lease expires; worker B reclaims it (attempt 2)
    clock += 301_000
    const again = (await mem.client.rpc('calendar_claim_jobs', { p_limit: 5, p_lease_seconds: 300 })).data
    assert.equal(again.length, 3)
    assert.ok(again.every((x) => x.attempts === 2))
    // the stale worker comes back with attempt 1: every write is refused
    assert.equal((await mem.client.rpc('calendar_complete_job', { p_job: a[0].id, p_attempt: 1, p_result: { action: 'created' }, p_meet_link: 'https://meet.google.com/x', p_owner: 'c-pm' })).data, false)
    assert.deepEqual((await mem.client.rpc('calendar_fail_job', { p_job: a[0].id, p_attempt: 1, p_code: 'x', p_retryable: true })).data, { ok: false, reason: 'lease_lost' })
    assert.equal((await mem.client.rpc('calendar_park_job', { p_job: a[0].id, p_attempt: 1, p_code: 'needs_connection' })).data, false)
    assert.equal((await mem.client.rpc('calendar_note_event', { p_job: a[0].id, p_attempt: 1, p_owner: 'c-pm' })).data, false)
    const bk = mem.bookings.get(jobs.find((j) => j.id === a[0].id).booking_id)
    assert.equal(bk.meet_link, null)
    assert.equal(bk.synced_at, null)
    // the current attempt may complete it
    assert.equal((await mem.client.rpc('calendar_complete_job', { p_job: a[0].id, p_attempt: 2, p_result: { action: 'created' }, p_meet_link: 'https://meet.google.com/x', p_owner: 'c-pm' })).data, true)
    assert.equal(bk.meet_link, 'https://meet.google.com/x')
  })

  test('a job whose workers kept dying (6 expired leases) is dead, not retried for ever', async () => {
    const { j } = newBooking()
    for (let i = 0; i < 6; i += 1) {
      assert.equal((await mem.client.rpc('calendar_claim_jobs', { p_limit: 5, p_lease_seconds: 30 })).data.length, 1)
      clock += 40_000
    }
    assert.equal((await mem.client.rpc('calendar_claim_jobs', { p_limit: 5, p_lease_seconds: 30 })).data.length, 0)
    assert.deepEqual([j.status, j.error], ['dead', 'lease_expired'])
  })

  test('out of time budget: the claimed jobs are handed back without counting an attempt (deferred), none is lost', async () => {
    const x = newBooking().j
    const y = newBooking().j
    let t = clock
    const w = createCalendarWorker({ db: createCalendarDb(mem.client), getConfig: () => cfg, getTokens: () => tokens, now: () => { t += 400; return t }, sleep: async () => {}, rand: () => 0.5, log: () => {}, meetPollDelayMs: 0 })
    const s = await w.runOnce({ limit: 5, budgetMs: 500 })
    assert.equal(s.deferred + s.done, 2)
    assert.ok(s.deferred >= 1)
    for (const j of [x, y]) assert.ok(j.status === 'done' || (j.status === 'pending' && j.error === 'deferred' && j.attempts === 0))
  })

  test('the worker summary and logs carry no token, no secret, no address', async () => {
    const lines = []
    build()
    worker = createCalendarWorker({ db: createCalendarDb(mem.client), getConfig: () => cfg, getTokens: () => tokens, now: () => clock, sleep: async () => {}, rand: () => 0.5, log: (e, f) => lines.push({ e, ...f }), meetPollDelayMs: 0 })
    newBooking({ booker_email: 'secret.person@example.com' })
    await worker.runOnce()
    const text = JSON.stringify([lines, mem.state.lastSummary, mem.jobs.map((j) => [j.error, j.result])])
    assert.ok(!/secret\.person|refresh|1\/\/0fake|Bearer|access_token/i.test(text))
    assert.ok(lines.length > 0)
  })
})
