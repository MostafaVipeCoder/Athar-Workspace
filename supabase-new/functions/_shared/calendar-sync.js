// Calendar / Meet sync worker (design 07 section 2; decisions 07-6, 07-10, 08 section 20.6). Pure ESM like the rest of _shared: no Deno-only and no
// Node-only API, so the same code runs in the Edge Runtime (../calendar-sync/index.ts) and under `node --test`.
//
//   planJob(ctx)            PURE: what must happen for one job, decided from stored data only (the database hands over `ctx` = public.calendar_job_context).
//                           Shadow mode logs exactly this plan; live mode executes it: ONE code path, so "shadow" shows what "live" would do.
//   createCalendarWorker    runOnce(): mode off -> nothing; shadow -> plan + log, ZERO Google calls, no lock, no completion; live -> claim, execute, write back.
//   createCalendarDb        the service-role RPC adapter (the exact argument names are pinned by CALENDAR_RPC_CONTRACT and a contract test against m63).
//
// RULES the worker keeps (each one has a test):
//   * the Google event id is the booking's id (uuid) as 32 hex digits (bookings.calendar_event_id; a migrated booking keeps its legacy id): an insert repeated by a retry,
//     a second worker or a timeout after Google accepted it answers 409 and the existing event is ADOPTED, never duplicated;
//   * times are the project time zone (offset + `timeZone`); an invalid / missing zone is a permanent error, never a guess of UTC;
//   * attendees are derived from stored data only (booker, provider e-mail, the node's cc / admin lists), lower-cased and de-duplicated, invalid ones dropped;
//   * `unique` Meet mode asks for a conference with requestId = booking id and waits (bounded) for it, `shared` mode puts the node's link in location / description,
//     an EMPTY shared link is a permanent error (never a silent switch to unique);
//   * the calendar that holds an event never changes silently; no usable connection = the job is PARKED (back to pending, no attempt counted), never lost;
//   * failures are classified: retryable (429 / 5xx / timeout / network / conference not ready) with exponential backoff + jitter (Retry-After honoured) and at most
//     MAX_ATTEMPTS, permanent (400 / 403 / config errors) = dead at once and visible with a Retry button;
//   * a stale worker cannot complete or fail a job that was reclaimed (the attempt number is a fence);
//   * nothing in a log line, a job row or a result carries a token, a secret or an address.

import { GoogleError, safeLog } from './google-core.js'
import { CalendarConfigError, buildEventInsert, buildEventPatch, conferenceStatus, deriveAttendees, extractMeetLink, isValidTimeZone } from './google-calendar.js'
import { calendarDeleteEvent, calendarInsertOrAdopt, calendarPatchEvent, waitForConference } from './google-api.js'
import { DbError } from './google-edge.js'

export const SYNC_MODES = Object.freeze(['off', 'shadow', 'live'])
export const CALENDAR_KINDS = Object.freeze(['calendar_create', 'calendar_update', 'calendar_cancel'])
export const MAX_ATTEMPTS = 6
export const PARK_DELAY_S = 900
export const RECONNECT_RECHECK_S = 30
export const DEFAULT_LIMIT = 10
export const DEFAULT_BUDGET_MS = 100_000
export const BACKOFF_BASE_S = 30
export const BACKOFF_MAX_S = 1800

// ------------------------------------------------------------------------------------------------ backoff and classification
/** 30 s, 60 s, 120 s ... capped at 30 min, with +/- 20 % jitter. attempt = the number of the attempt that just failed (1-based). */
export function backoffSeconds(attempt, rand = Math.random) {
  const base = Math.min(BACKOFF_BASE_S * 2 ** Math.max(0, (Number(attempt) || 1) - 1), BACKOFF_MAX_S)
  return Math.max(1, Math.round(base * (0.8 + rand() * 0.4)))
}

/** A short machine code for a failed job: never a message (messages can contain addresses). */
export function failureCode(err) {
  if (err instanceof CalendarConfigError) return err.code
  if (err instanceof GoogleError) return err.status ? `${err.code}:${err.status}` : err.code
  if (err instanceof DbError || err?.name === 'DbError') return 'db_error'
  return 'internal_error'
}

/**
 * -> { park: 'needs_reconnect', delaySeconds }                     the connection must be re-linked (invalid_grant): the job waits, nothing is lost
 *  | { retryable: true, code, delaySeconds }                       try again later (429 / 5xx / timeout / network / conference not ready / unexpected)
 *  | { retryable: false, code }                                    permanent: 400, 403, a configuration error, a legacy event that is gone
 */
export function classifyError(err, { attempt = 1, rand = Math.random } = {}) {
  if (err instanceof GoogleError && err.needsReconnect) return { park: 'needs_reconnect', delaySeconds: RECONNECT_RECHECK_S }
  const code = failureCode(err)
  if (err instanceof CalendarConfigError) return { retryable: false, code }
  if (err instanceof GoogleError) {
    // retryable: Google said so (429 / 5xx / timeout / network), a token Google refused once (401), a 409 whose event we could not read back, a Meet link not ready
    const retryable = err.retryable === true || ['unauthorized', 'conflict', 'conference_pending', 'conference_failed'].includes(err.code)
    if (!retryable) return { retryable: false, code } // 400 / 403 / 404 / 410 / a legacy event that is gone / anything unknown: the PM looks at it, "Retry" exists
    const wait = Math.max(Math.ceil((err.retryAfterMs ?? 0) / 1000), backoffSeconds(attempt, rand))
    return { retryable: true, code, delaySeconds: Math.min(wait, 3600) }
  }
  return { retryable: true, code, delaySeconds: backoffSeconds(attempt, rand) }
}

// ------------------------------------------------------------------------------------------------ the plan (pure)
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const countBy = (rows, key) => rows.reduce((o, r) => ({ ...o, [r[key]]: (o[r[key]] ?? 0) + 1 }), {})

/** Summary + description of the event, from stored data (names in the booker's language, the template itself is English like the poller's). */
export function eventTexts(ctx) {
  const b = ctx.booking
  const ar = b.lang === 'ar'
  const who = clean((ar ? b.company_ar || b.company_en : b.company_en || b.company_ar) || b.booker_company_name || b.booker_name || b.booker_email)
  const provider = clean(ar ? ctx.provider?.name_ar || ctx.provider?.name_en : ctx.provider?.name_en || ctx.provider?.name_ar)
  const interview = ctx.node?.mode === 'interview'
  const summary = `${interview ? 'Interview' : 'Mentor Session'}: ${who}${provider ? ` with ${provider}` : ''}`
  const where = [clean(ctx.node?.name_en || ctx.node?.name_ar), clean(ctx.project?.name_en || ctx.project?.name_ar)].filter(Boolean).join(' - ')
  const lines = [where, `Booker: ${clean(b.booker_name) || '-'} (${b.booker_email})`, who && who !== clean(b.booker_name) ? `Company: ${who}` : ''].filter(Boolean)
  return { summary, description: lines.join('\n') }
}

/** Everything `events.insert` / `events.patch` need for this booking; throws CalendarConfigError for a configuration the PM must fix. */
export function buildDesired(ctx, connection = null) {
  const b = ctx.booking
  const timeZone = ctx.project?.timezone
  if (!isValidTimeZone(timeZone)) throw new CalendarConfigError('invalid_timezone', 'timeZone') // never a guess of UTC (decision 07-10)
  const { attendees, dropped } = deriveAttendees(
    { booker: b.booker_email, provider: ctx.provider?.email ?? null, cc: ctx.node?.cc ?? [], admin: ctx.node?.admin ?? [] },
    { organizerEmail: connection?.email ?? null },
  )
  const { summary, description } = eventTexts(ctx)
  const meetMode = ctx.settings?.meeting_link_mode === 'shared' ? 'shared' : 'unique'
  const insert = buildEventInsert({
    bookingId: b.id, summary, description, startsAt: ctx.slot?.starts_at, endsAt: ctx.slot?.ends_at, timeZone, attendees, meetMode,
    sharedLink: ctx.settings?.shared_meet_link ?? null, sendUpdates: 'all',
  })
  return {
    insert, timeZone, attendees, meetMode, summary,
    dropped: countBy(dropped.filter((d) => d.reason !== 'duplicate'), 'reason'),
    view: { summary, start: insert.event.start.dateTime, end: insert.event.end.dateTime, timeZone, attendees: attendees.map((a) => a.email), meet: meetMode, location: insert.event.location ?? null },
  }
}

/**
 * What must happen for one job. `ctx` = public.calendar_job_context(job). Never does I/O, never throws for a data problem (it returns `fail`).
 *   action: 'create' | 'patch' | 'delete' | 'skip' | 'park' | 'fail'
 *   skip  : booking_gone | restored | never_synced | migrated | past
 *   code  : park -> needs_connection | needs_reconnect ; fail -> the CalendarConfigError code
 */
export function planJob(ctx, { now = Date.now() } = {}) {
  const base = { kind: ctx?.job?.kind ?? null, sendUpdates: 'all' }
  const b = ctx?.booking
  if (!b) return { ...base, action: 'skip', skip: 'booking_gone' }
  const conn = ctx.connection ?? {}
  const connection = conn.id ? { id: conn.id, email: conn.email ?? null, source: conn.source ?? null } : null
  const common = { ...base, eventId: b.event_id, connection }
  const parkIfUnusable = () => (conn.id && conn.usable ? null : { ...common, action: 'park', code: conn.reason === 'needs_reconnect' ? 'needs_reconnect' : 'needs_connection' })

  // 1. the event must NOT exist: the booking is cancelled, or this is the cancel job
  if (ctx.job.kind === 'calendar_cancel' || b.status !== 'confirmed') {
    if (ctx.job.kind === 'calendar_cancel' && b.status === 'confirmed') return { ...common, action: 'skip', skip: 'restored' } // restored meanwhile: the create job re-establishes the event
    if (!b.event_may_exist) return { ...common, action: 'skip', skip: 'never_synced' } // Google never saw it: nothing to delete, no call
    return parkIfUnusable() ?? { ...common, action: 'delete' }
  }

  // 2. the event must exist
  if (ctx.job.kind === 'calendar_create' && b.legacy_event) return { ...common, action: 'skip', skip: 'migrated' } // created by the Apps Script poller: never created again
  const endMs = Date.parse(ctx.slot?.ends_at)
  if (!b.event_may_exist && Number.isFinite(endMs) && endMs < now) return { ...common, action: 'skip', skip: 'past' } // no invitation for a session that is over
  let desired
  try {
    desired = buildDesired(ctx, connection)
  } catch (e) {
    if (e instanceof CalendarConfigError) return { ...common, action: 'fail', code: e.code, field: e.field }
    throw e
  }
  const parked = parkIfUnusable()
  if (parked) return { ...parked, event: desired.view }
  const patch = ctx.job.kind === 'calendar_update' && (b.event_may_exist || b.legacy_event)
  return { ...common, action: patch ? 'patch' : 'create', event: desired.view, desired, dropped: desired.dropped }
}

const WOULD_CALL = { create: ['events.insert (409 -> events.get)', 'events.get (Meet status)'], patch: ['events.patch'], delete: ['events.delete'], skip: [], park: [], fail: [] }

/** The shadow-log record of a plan (what the worker WOULD do): small, no tokens; attendee addresses are the booking's own (PM-only, app_private). */
export function planForLog(plan) {
  const out = { action: plan.action, kind: plan.kind, event_id: plan.eventId ?? null, source: plan.connection?.source ?? null, calendar: plan.connection?.email ?? null, would_call: WOULD_CALL[plan.action] ?? [] }
  if (plan.skip) out.skip = plan.skip
  if (plan.code) out.code = plan.code
  if (plan.field) out.field = plan.field
  if (plan.event) {
    const { attendees = [], ...rest } = plan.event
    out.event = { ...rest, attendee_count: attendees.length, attendees: attendees.slice(0, 20) }
  }
  if (plan.dropped && Object.keys(plan.dropped).length) out.dropped = plan.dropped
  return out
}

// ------------------------------------------------------------------------------------------------ executing a plan (live)
function emailSet(event, organizerEmail) {
  const org = String(organizerEmail ?? '').toLowerCase()
  return new Set((event?.attendees ?? []).filter((a) => !a.organizer && !a.self && String(a.email ?? '').toLowerCase() !== org).map((a) => String(a.email).toLowerCase()))
}
/** Does the event Google holds already say what we want? (an adopted event is only patched when it differs: no pointless invitation e-mails) */
export function eventMatches(event, desired, organizerEmail) {
  const ev = desired.insert.event
  if (Date.parse(event?.start?.dateTime) !== Date.parse(ev.start.dateTime) || Date.parse(event?.end?.dateTime) !== Date.parse(ev.end.dateTime)) return false
  const have = emailSet(event, organizerEmail)
  const want = new Set(desired.attendees.map((a) => a.email))
  return have.size === want.size && [...want].every((e) => have.has(e))
}

async function withToken(d, connectionId, fn) {
  const tokens = d.tokens()
  let token = await tokens.getAccessToken(connectionId)
  try {
    return await fn(token)
  } catch (e) {
    if (e instanceof GoogleError && e.code === 'unauthorized') {
      // a cached token Google no longer accepts: one fresh token, one more try (a refresh that answers invalid_grant parks the job)
      tokens.invalidate(connectionId)
      token = await tokens.getAccessToken(connectionId, { force: true })
      return fn(token)
    }
    throw e
  }
}

/** Unique mode: make sure the event carries a Meet link (ask for one if it has none, wait a bounded time for the asynchronous creation). */
async function ensureMeet(d, token, event, { id, bookingId, attempt }) {
  const cfg = d.cfg()
  let st = conferenceStatus(event)
  let ev = event
  const ask = async (requestId) => {
    ev = await calendarPatchEvent(cfg, token, id, buildEventPatch({ conferenceRequestId: requestId, sendUpdates: 'none' }), { fetch: d.fetch })
    st = conferenceStatus(ev)
  }
  if (st === 'none') await ask(bookingId)
  if (st === 'failure') await ask(`${bookingId}-${attempt}`)
  if (st === 'pending') {
    const w = await waitForConference(cfg, token, id, { attempts: d.meetPollAttempts, delayMs: d.meetPollDelayMs, sleep: d.sleep, fetch: d.fetch })
    ev = w.event ?? ev
    st = w.status
  }
  if (st === 'success' && extractMeetLink(ev)) return { event: ev, link: extractMeetLink(ev) }
  throw new GoogleError(st === 'failure' ? 'conference_failed' : 'conference_pending', { retryable: true, retryAfterMs: 20_000 })
}

function resultOf(action, plan, event, link) {
  return {
    action, event_id: plan.eventId, html_link: typeof event?.htmlLink === 'string' ? event.htmlLink.slice(0, 500) : null,
    meet: plan.desired?.meetMode ?? null, meet_link_set: Boolean(link), attendees: plan.desired?.attendees?.length ?? null,
    dropped: plan.dropped && Object.keys(plan.dropped).length ? plan.dropped : undefined, tz: plan.desired?.timeZone ?? null, source: plan.connection?.source ?? null,
  }
}

async function doCreate(d, ctx, plan, job, token) {
  const cfg = d.cfg()
  const { insert, meetMode, timeZone, attendees } = plan.desired
  const b = ctx.booking
  const r = await calendarInsertOrAdopt(cfg, token, insert, { fetch: d.fetch })
  await d.db.noteEvent(job.id, job.attempts, plan.connection.id) // Google holds the event now: its calendar is frozen from here on
  let event = r.event
  let action = r.status === 'created' ? 'created' : 'adopted'
  const times = { startsAt: ctx.slot.starts_at, endsAt: ctx.slot.ends_at, timeZone, attendees }
  if (r.cancelled) {
    // the event was deleted earlier (the booking was cancelled and restored, or somebody removed it): bring it back with the CURRENT data
    event = await calendarPatchEvent(cfg, token, insert.id, buildEventPatch({ ...times, status: 'confirmed' }), { fetch: d.fetch })
    action = 'restored'
  } else if (r.status === 'adopted' && !eventMatches(event, plan.desired, plan.connection.email)) {
    event = await calendarPatchEvent(cfg, token, insert.id, buildEventPatch(times), { fetch: d.fetch })
    action = 'adopted_updated'
  }
  let link = meetMode === 'shared' ? plan.desired.insert.event.location : null
  if (meetMode === 'unique') {
    const m = await ensureMeet(d, token, event, { id: insert.id, bookingId: b.id, attempt: job.attempts })
    event = m.event
    link = m.link
  }
  return { result: resultOf(action, plan, event, link), meetLink: link }
}

async function doPatch(d, ctx, plan, job, token) {
  const cfg = d.cfg()
  const b = ctx.booking
  const { timeZone, attendees, meetMode } = plan.desired
  let event
  try {
    event = await calendarPatchEvent(cfg, token, plan.eventId, buildEventPatch({ startsAt: ctx.slot.starts_at, endsAt: ctx.slot.ends_at, timeZone, attendees, status: 'confirmed' }), { fetch: d.fetch })
  } catch (e) {
    if (e instanceof GoogleError && (e.code === 'not_found' || e.code === 'gone')) {
      if (b.legacy_event) throw new GoogleError('legacy_event_missing', { status: e.status }) // we never re-create a migrated event: the PM decides
      return doCreate(d, ctx, plan, job, token) // the event vanished: insert it again (the id is the booking's)
    }
    throw e
  }
  let link = meetMode === 'shared' ? plan.desired.insert.event.location : extractMeetLink(event)
  if (meetMode === 'unique' && !link && !b.legacy_event) {
    const m = await ensureMeet(d, token, event, { id: plan.eventId, bookingId: b.id, attempt: job.attempts })
    event = m.event
    link = m.link
  }
  // a migrated booking keeps the link it has; for the others the link of the event is the truth
  if (b.legacy_event && b.meet_link) link = null
  return { result: resultOf('patched', plan, event, link), meetLink: link }
}

async function doDelete(d, plan, token) {
  const r = await calendarDeleteEvent(d.cfg(), token, plan.eventId, { sendUpdates: 'all', fetch: d.fetch })
  return { result: { action: r.alreadyGone ? 'already_gone' : 'deleted', event_id: plan.eventId, source: plan.connection?.source ?? null }, meetLink: null }
}

// ------------------------------------------------------------------------------------------------ the database adapter
/** The exact argument names of the m63 service-role RPCs (tests/calendar-rpc-contract.test.js compares them with the SQL). */
export const CALENDAR_RPC_CONTRACT = Object.freeze({
  calendar_worker_begin: [],
  calendar_worker_finish: ['p_summary'],
  calendar_claim_jobs: ['p_limit', 'p_lease_seconds'],
  calendar_job_context: ['p_job'],
  calendar_note_event: ['p_job', 'p_attempt', 'p_owner'],
  calendar_complete_job: ['p_job', 'p_attempt', 'p_result', 'p_meet_link', 'p_owner'],
  calendar_fail_job: ['p_job', 'p_attempt', 'p_code', 'p_retryable', 'p_delay_seconds', 'p_max_attempts'],
  calendar_park_job: ['p_job', 'p_attempt', 'p_code', 'p_delay_seconds'],
  calendar_shadow_peek: ['p_limit'],
  calendar_shadow_record: ['p_job', 'p_plan'],
})

function tokenFromError(error) {
  const hint = String(error?.hint ?? '')
  if (/^[a-z][a-z0-9_]{2,40}$/.test(hint)) return hint
  return String(error?.code) === '42501' ? 'forbidden' : 'db_error'
}

/** Service-role adapter over anything with `rpc(name, args) -> { data, error }` (a supabase-js client, or the in-memory twin of the tests). */
export function createCalendarDb(client) {
  async function call(fn, args = {}) {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new DbError(tokenFromError(error), { code: error.code ?? null, status: error.status ?? null })
    return data
  }
  return {
    workerBegin: () => call('calendar_worker_begin'),
    workerFinish: (summary) => call('calendar_worker_finish', { p_summary: summary ?? null }),
    claimJobs: async ({ limit = DEFAULT_LIMIT, leaseSeconds = 300 } = {}) => (await call('calendar_claim_jobs', { p_limit: limit, p_lease_seconds: leaseSeconds })) ?? [],
    jobContext: (jobId) => call('calendar_job_context', { p_job: jobId }),
    noteEvent: (jobId, attempt, ownerId) => call('calendar_note_event', { p_job: jobId, p_attempt: attempt, p_owner: ownerId ?? null }),
    completeJob: (jobId, attempt, result, meetLink = null, ownerId = null) => call('calendar_complete_job', { p_job: jobId, p_attempt: attempt, p_result: result ?? {}, p_meet_link: meetLink, p_owner: ownerId }),
    failJob: (jobId, attempt, code, retryable, delaySeconds, maxAttempts = MAX_ATTEMPTS) => call('calendar_fail_job', { p_job: jobId, p_attempt: attempt, p_code: code, p_retryable: Boolean(retryable), p_delay_seconds: delaySeconds ?? 60, p_max_attempts: maxAttempts }),
    parkJob: (jobId, attempt, code, delaySeconds = PARK_DELAY_S) => call('calendar_park_job', { p_job: jobId, p_attempt: attempt, p_code: code, p_delay_seconds: delaySeconds }),
    shadowPeek: async (limit = 50) => (await call('calendar_shadow_peek', { p_limit: limit })) ?? [],
    shadowRecord: (jobId, plan) => call('calendar_shadow_record', { p_job: jobId, p_plan: plan }),
  }
}

// ------------------------------------------------------------------------------------------------ the worker
const lazy = (fn) => {
  let v
  let done = false
  return () => {
    if (!done) { v = fn(); done = true }
    return v
  }
}

/**
 * deps: { db (createCalendarDb), getConfig () -> Google config, getTokens () -> { getAccessToken(id, {force}), invalidate(id) },
 *         fetch, now () -> ms, sleep (ms), log (event, fields), rand, meetPollAttempts, meetPollDelayMs, touchConnection (id),
 *         markConnection (id, status, code) (a connection whose stored secret is gone becomes needs_reconnect) }
 * Google config and tokens are created LAZILY: shadow and off mode never need them (no Google credentials are required to run in shadow).
 */
export function createCalendarWorker({ db, getConfig, getTokens, fetch: fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = safeLog, rand = Math.random, meetPollAttempts = 4, meetPollDelayMs = 800, touchConnection = null, markConnection = null }) {
  const d = { db, cfg: lazy(getConfig), tokens: lazy(getTokens), fetch: fetchImpl, sleep, meetPollAttempts, meetPollDelayMs }

  async function execute(ctx, plan, job) {
    const connId = plan.connection.id
    const out = await withToken(d, connId, (token) => (plan.action === 'create' ? doCreate(d, ctx, plan, job, token) : plan.action === 'patch' ? doPatch(d, ctx, plan, job, token) : doDelete(d, plan, token)))
    return out
  }

  async function runJob(job, summary) {
    let ctx
    try {
      ctx = await db.jobContext(job.id)
    } catch (e) {
      const c = classifyError(e, { attempt: job.attempts, rand })
      await db.failJob(job.id, job.attempts, c.code, true, c.delaySeconds ?? backoffSeconds(job.attempts, rand))
      summary.retried += 1
      return
    }
    const plan = planJob(ctx, { now: Date.parse(ctx?.now) || now() })
    const note = { job: job.id, kind: job.kind, action: plan.action, attempt: job.attempts }
    try {
      if (plan.action === 'skip') {
        const ok = await db.completeJob(job.id, job.attempts, { action: `skipped_${plan.skip}`, event_id: plan.eventId ?? null })
        summary[ok === false ? 'lease_lost' : 'skipped'] += 1
        log('calendar_job', { ...note, outcome: `skipped_${plan.skip}` })
        return
      }
      if (plan.action === 'park') {
        const ok = await db.parkJob(job.id, job.attempts, plan.code, PARK_DELAY_S)
        summary[ok === false ? 'lease_lost' : 'parked'] += 1
        log('calendar_job', { ...note, outcome: 'parked', reason: plan.code })
        return
      }
      if (plan.action === 'fail') {
        const r = await db.failJob(job.id, job.attempts, plan.code, false, 0)
        summary[r?.ok === false ? 'lease_lost' : 'dead'] += 1
        log('calendar_job', { ...note, outcome: 'dead', reason: plan.code })
        return
      }
      const out = await execute(ctx, plan, job)
      const ok = await db.completeJob(job.id, job.attempts, out.result, out.meetLink ?? null, plan.action === 'delete' ? null : plan.connection.id)
      summary[ok === false ? 'lease_lost' : 'done'] += 1
      if (ok !== false && touchConnection) await touchConnection(plan.connection.id).catch(() => {})
      log('calendar_job', { ...note, outcome: out.result.action })
    } catch (err) {
      const c = classifyError(err, { attempt: job.attempts, rand })
      // the secret of the connection is gone (Vault / AES row deleted): the account must be linked again, and the next pass must not pick it any more
      if (err instanceof GoogleError && err.code === 'no_secret' && markConnection && plan.connection?.id) await markConnection(plan.connection.id, 'needs_reconnect', 'no_secret').catch(() => {})
      if (c.park) {
        const ok = await db.parkJob(job.id, job.attempts, c.park, c.delaySeconds)
        summary[ok === false ? 'lease_lost' : 'parked'] += 1
        log('calendar_job', { ...note, outcome: 'parked', reason: c.park })
        return
      }
      const r = await db.failJob(job.id, job.attempts, c.code, c.retryable, c.delaySeconds ?? 0, MAX_ATTEMPTS)
      if (r?.ok === false) summary.lease_lost += 1
      else if (r?.status === 'dead') summary.dead += 1
      else summary.retried += 1
      log('calendar_job', { ...note, outcome: r?.status ?? 'failed', reason: c.code })
    }
  }

  async function runLive({ limit, budgetMs }, summary, started) {
    d.cfg() // a missing Google configuration is a deployment error: refuse BEFORE a single job is claimed
    const jobs = await db.claimJobs({ limit })
    for (const job of jobs) {
      summary.claimed += 1
      if (now() - started > budgetMs) {
        await db.parkJob(job.id, job.attempts, 'deferred', 5) // out of time: hand the job back without counting an attempt
        summary.deferred += 1
        continue
      }
      try {
        await runJob(job, summary)
      } catch (e) {
        summary.errors += 1
        log('calendar_job_error', { job: job.id, reason: failureCode(e) })
      }
    }
  }

  async function runShadow({ limit }, summary) {
    const jobs = await db.shadowPeek(Math.max(limit, 50))
    for (const j of jobs) {
      try {
        const ctx = await db.jobContext(j.id)
        const plan = planJob(ctx, { now: Date.parse(ctx?.now) || now() })
        if (await db.shadowRecord(j.id, planForLog(plan))) summary.shadowed += 1
      } catch (e) {
        summary.errors += 1
        log('calendar_shadow_error', { job: j.id, reason: failureCode(e) })
      }
    }
  }

  /** One pass. Never throws for a job problem; throws only for a database / configuration problem of the pass itself. */
  async function runOnce({ limit = DEFAULT_LIMIT, budgetMs = DEFAULT_BUDGET_MS } = {}) {
    const started = now()
    const summary = { mode: 'off', claimed: 0, done: 0, skipped: 0, retried: 0, parked: 0, dead: 0, deferred: 0, lease_lost: 0, shadowed: 0, errors: 0 }
    const begin = await db.workerBegin()
    summary.mode = SYNC_MODES.includes(begin?.mode) ? begin.mode : 'off'
    try {
      if (summary.mode === 'live') await runLive({ limit, budgetMs }, summary, started)
      else if (summary.mode === 'shadow') await runShadow({ limit }, summary)
    } finally {
      await db.workerFinish({ ...summary, at: new Date(now()).toISOString() }).catch(() => {})
    }
    return summary
  }

  return { runOnce, runJob }
}

// ------------------------------------------------------------------------------------------------ calling the function
/** Constant-time check that the request carries the SERVICE ROLE key (the only caller: pg_cron / an operator). The gateway only checks that the JWT is valid, an anon key is too. */
export function isServiceCall(req, env) {
  const key = String(typeof env?.get === 'function' ? env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' : env?.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const m = /^Bearer\s+(\S{20,4096})$/.exec(req.headers.get('authorization') ?? '')
  if (!key || !m || m[1].length !== key.length) return false
  let diff = 0
  for (let i = 0; i < key.length; i += 1) diff |= m[1].charCodeAt(i) ^ key.charCodeAt(i)
  return diff === 0
}
