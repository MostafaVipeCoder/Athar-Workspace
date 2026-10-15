// E-mail outbox worker (design 07 section 1.4 / 1.6, migration m62). PURE and dependency-injected: no Deno API, no Node API, no module-level I/O,
// so the same file runs in the Edge Runtime and under `node --test` (tests/email-worker.test.js, and against the fake Google in tests/email-worker.fake.test.js).
//
// The database (m62) owns every decision about WHICH row is sent and WHEN: claim (advisory lock + FOR UPDATE SKIP LOCKED, lease, per-sender quota,
// sender resolution with the fallback to startups@), mark_sending, finish. This file owns HOW: build the message from the STORED row (recipients are
// never taken from a request), get an access token, send ONE message per recipient, classify the answer.
//
// THE CRITICAL RULES (each has a test):
//  * persist "the request is about to leave" (email_worker_mark_sending) BEFORE the HTTP call; a crash after that point is an unknown outcome (the
//    database turns it into needs_review when the lease expires), a crash before it is a harmless requeue;
//  * an UNKNOWN outcome (a timeout or a connection reset after the request was sent, an answer without a message id, an exception we did not foresee)
//    parks the row as needs_review and is NEVER sent again automatically (only a person can mark it sent or resend it);
//  * 401 (not processed) is retried once with a fresh token; invalid_grant marks the connection needs_reconnect and the rows go back to the queue
//    (the next claim resolves them to the system sender when the template allows it);
//  * 4xx other than the rate limits are permanent (failed, with a code the UI translates); 429 / 5xx / refused connections retry with exponential
//    backoff + jitter (Retry-After honoured) up to a maximum streak;
//  * no recipient address, subject, body, token or secret is ever logged: only ids, counts and fixed codes.

import { ConfigError, GoogleError, safeLog, sha256Hex } from './google-core.js'
import { MimeError, makeMimeMessage, normalizeAddress } from './google-mime.js'
import { senderDisplayName } from './google-sender.js'

export const WORKER_DEFAULTS = Object.freeze({
  batchLimit: 20,
  leaseSeconds: 120,
  perMinute: 30, // Gmail allows about 60 a minute per user through the API: half of it on purpose (design 07 1.6)
  dailyCap: 1500, // below Google's 2,000 a day per user (decision 07-12); the database never accepts more than 1,900
  maxStreak: 6, // consecutive retryable failures before a row is `failed` (code max_attempts)
  maxMessages: 400,
  maxRunMs: 100_000, // the Edge Runtime wall clock is 150 s (free) / 400 s (paid): stop well before it, the next tick continues
  maxIdleWaitMs: 0, // wait at most this long for rows that become ready before giving the run back: 0 = only rows that are due NOW (the next tick continues; two sleeping runs would only overlap)
  backoffBaseMs: 30_000,
  backoffMaxMs: 1_800_000,
  retryAfterMaxMs: 3_600_000,
})

// ------------------------------------------------------------------------------------------------ the database adapter (service-role RPCs of m62)
/** The exact argument names of every worker RPC. tests/email-rpc-contract.test.js compares them with db/migrations/m62_email_worker.sql. */
export const EMAIL_RPC_CONTRACT = Object.freeze({
  email_worker_claim: ['p_worker', 'p_limit', 'p_lease_seconds', 'p_per_minute', 'p_daily_cap'],
  email_worker_mark_sending: ['p_id', 'p_worker'],
  email_worker_finish: ['p_id', 'p_worker', 'p_outcome', 'p_code', 'p_detail', 'p_delay_ms', 'p_gmail_message_id', 'p_message_id', 'p_max_streak'],
  email_worker_heartbeat: ['p_worker', 'p_summary'],
})

export class EmailDbError extends Error {
  constructor(token, { code = null, status = null } = {}) {
    super(token || 'db_error')
    this.name = 'EmailDbError'
    this.token = token || 'db_error'
    this.code = code
    this.status = status
  }
}

function tokenFromError(error) {
  const hint = String(error?.hint ?? '')
  if (/^[a-z][a-z0-9_]{2,40}$/.test(hint)) return hint
  const m = /^([a-z][a-z0-9_]{2,40}):/.exec(String(error?.message ?? ''))
  if (m) return m[1]
  return String(error?.code) === '42501' ? 'forbidden' : 'db_error'
}

/** Service-role adapter over a supabase-js client (anything with `rpc(name, args) -> { data, error }`), plus the two connection calls of the Google runtime. */
export function createEmailDb(client, { markConnection = null, touchConnection = null } = {}) {
  async function call(fn, args = {}) {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new EmailDbError(tokenFromError(error), { code: error.code ?? null, status: error.status ?? null })
    return data
  }
  return {
    claim: ({ worker, limit, leaseSeconds, perMinute, dailyCap }) =>
      call('email_worker_claim', { p_worker: worker, p_limit: limit, p_lease_seconds: leaseSeconds, p_per_minute: perMinute, p_daily_cap: dailyCap }),
    markSending: (id, worker) => call('email_worker_mark_sending', { p_id: id, p_worker: worker }),
    finish: ({ id, worker, outcome, code = null, detail = null, delayMs = null, gmailMessageId = null, messageId = null, maxStreak = WORKER_DEFAULTS.maxStreak }) =>
      call('email_worker_finish', { p_id: id, p_worker: worker, p_outcome: outcome, p_code: code, p_detail: detail, p_delay_ms: delayMs, p_gmail_message_id: gmailMessageId, p_message_id: messageId, p_max_streak: maxStreak }),
    heartbeat: (worker, summary) => call('email_worker_heartbeat', { p_worker: worker, p_summary: summary }),
    markConnection: markConnection ?? (async () => null),
    touchConnection: touchConnection ?? (async () => null),
  }
}

// ------------------------------------------------------------------------------------------------ pure helpers
/** Truncated exponential backoff with jitter (Google's recommendation): 30 s, 60 s, 2 min ... capped at 30 min, +-25 %; Retry-After wins when it is longer. */
export function backoffMs(failStreak, { retryAfterMs = null, rand = Math.random, base = WORKER_DEFAULTS.backoffBaseMs, max = WORKER_DEFAULTS.backoffMaxMs } = {}) {
  const n = Math.max(0, Math.min(Number.isFinite(failStreak) ? Math.floor(failStreak) : 0, 12))
  const exp = Math.min(max, base * 2 ** n)
  const jittered = Math.round(exp * (0.75 + 0.5 * Math.min(1, Math.max(0, rand()))))
  const ra = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, WORKER_DEFAULTS.retryAfterMaxMs) : 0
  return Math.max(jittered, ra, 1000)
}

/** Milliseconds from `nowIso` to `atIso` (both ISO strings from the database), null when unknown. */
export function msUntil(atIso, nowIso) {
  const a = Date.parse(atIso ?? '')
  const b = Date.parse(nowIso ?? '')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, a - b)
}

/** The Message-ID of one request: <outbox id.attempt@sender-domain>: a person can search the Sent folder for it (rfc822msgid:), a resend gets a new attempt number. */
export function messageIdFor(outboxId, sendAttempt, senderEmail) {
  const domain = String(senderEmail ?? '').split('@')[1] || 'athareg.com'
  return `<${outboxId}.${sendAttempt}@${domain}>`
}

/** CC list from the stored row: lower-cased, valid addresses only, no duplicates, never the recipient. -> { valid: [...], dropped: n } */
export function cleanCc(cc, recipient) {
  const seen = new Set([String(recipient ?? '').toLowerCase()])
  const valid = []
  let dropped = 0
  for (const x of Array.isArray(cc) ? cc : []) {
    let a
    try {
      a = normalizeAddress(String(x ?? ''), 'cc').email
    } catch {
      dropped += 1
      continue
    }
    if (seen.has(a)) continue
    seen.add(a)
    valid.push(a)
  }
  return { valid, dropped }
}

/**
 * Build the MIME message for a claimed row. Everything comes from the STORED row (`row`), nothing from a request. Throws MimeError (the caller turns it into a
 * permanent failure) or a plain Error('no_content').
 * -> { raw, messageId, size, ccDropped }
 */
export function buildOutgoing(row, { sendAttempt, now = new Date() } = {}) {
  if (typeof row?.subject !== 'string' || !row.subject.trim() || typeof row?.body_html !== 'string' || !row.body_html.trim()) {
    const e = new Error('no_content')
    e.code = 'no_content'
    throw e
  }
  const sender = row.sender
  const messageId = messageIdFor(row.id, sendAttempt, sender?.email)
  const { valid, dropped } = cleanCc(row.cc, row.recipient)
  const built = makeMimeMessage({
    from: { email: sender.email, name: senderDisplayName({ source: sender.source, pmName: sender.name ?? '' }) },
    to: [{ email: row.recipient }],
    cc: valid.map((email) => ({ email })),
    replyTo: row.reply_to ? { email: row.reply_to } : null,
    subject: row.subject,
    html: row.body_html,
    messageId,
    date: now,
    headers: { 'X-Athar-Outbox': row.id },
  })
  return { raw: built.raw, messageId: built.messageId, size: built.size, ccDropped: dropped }
}

/** A MimeError -> a permanent failure code the UI translates. */
export function mimeFailure(e) {
  if (e instanceof MimeError) {
    if ((e.code === 'invalid_address' || e.code === 'header_injection') && e.field === 'to') return 'invalid_recipient'
    if (e.code === 'invalid_address' || e.code === 'header_injection') return 'invalid_message'
    if (e.code === 'too_large') return 'message_too_large'
    if (e.code === 'too_many_recipients') return 'too_many_recipients'
    return 'invalid_message'
  }
  return e?.code === 'no_content' ? 'no_content' : 'invalid_message'
}

const DAILY_REASONS = /^(dailylimitexceeded|quotaexceeded|sendlimitexceeded|dailysendlimit)/i
const SCOPE_REASONS = /^(insufficientpermissions|insufficientscopes|forbidden_scope|autherror)/i
const NOT_ENABLED_REASONS = /^(accessnotconfigured|service_disabled|apinotenabled|projectnotlinked)/i

/** A short, secret-free description of a GoogleError (code, HTTP status and Google's reason token only; never Google's message). */
export function describeError(e) {
  if (e instanceof GoogleError) return `google ${e.code}${e.status ? ` http ${e.status}` : ''}${e.reason ? ` ${e.reason}` : ''}`.slice(0, 200)
  if (e instanceof ConfigError) return `config ${e.code} ${(e.missing ?? []).join(',')}`.slice(0, 200)
  return 'unexpected error'
}

/**
 * What to do with the row after the SEND REQUEST failed (the marker was already persisted).
 * -> { outcome: 'retry' | 'failed' | 'needs_review' | 'blocked', code, detail, delayMs?, markConnection?: code, circuit?: 'dead' | 'limited' | 'capped' }
 * Anything we do not recognise is an unknown outcome: needs_review (never resent automatically).
 */
export function classifySendError(e, { failStreak = 0, rand = Math.random } = {}) {
  const detail = describeError(e)
  if (!(e instanceof GoogleError)) return { outcome: 'needs_review', code: 'unknown_outcome', detail }
  if (e.outcomeUnknown) return { outcome: 'needs_review', code: 'unknown_outcome', detail }
  const reason = String(e.reason ?? '')
  switch (e.code) {
    case 'unauthorized':
      return { outcome: 'blocked', code: 'sender_needs_reconnect', detail, delayMs: 0, markConnection: 'unauthorized', circuit: 'dead' }
    case 'rate_limited':
      if (DAILY_REASONS.test(reason)) return { outcome: 'blocked', code: 'daily_cap', detail, delayMs: 3_600_000, circuit: 'capped' }
      return { outcome: 'retry', code: 'rate_limited', detail, delayMs: backoffMs(failStreak, { retryAfterMs: e.retryAfterMs, rand }), circuit: 'limited', retryAfterMs: e.retryAfterMs ?? null }
    case 'server_error':
      return { outcome: 'retry', code: 'server_error', detail, delayMs: backoffMs(failStreak, { retryAfterMs: e.retryAfterMs, rand }) }
    case 'network':
      return { outcome: 'retry', code: 'network', detail, delayMs: backoffMs(failStreak, { rand }) }
    case 'forbidden':
      if (SCOPE_REASONS.test(reason)) return { outcome: 'blocked', code: 'sender_needs_reconnect', detail, delayMs: 0, markConnection: 'insufficient_scope', circuit: 'dead' }
      if (NOT_ENABLED_REASONS.test(reason)) return { outcome: 'blocked', code: 'worker_config', detail, delayMs: 900_000 }
      return { outcome: 'failed', code: 'forbidden', detail }
    case 'bad_request':
      return { outcome: 'failed', code: 'rejected_by_gmail', detail }
    case 'not_found':
      return { outcome: 'failed', code: 'not_found', detail }
    default:
      return { outcome: 'failed', code: /^http_\d{3}$/.test(e.code) ? e.code : 'rejected_by_gmail', detail }
  }
}

/** What to do after getting an ACCESS TOKEN failed (no request has left yet: the row is simply returned or blocked). */
export function classifyTokenError(e, { failStreak = 0, rand = Math.random } = {}) {
  const detail = describeError(e)
  if (e instanceof ConfigError) return { outcome: 'blocked', code: 'worker_config', detail, delayMs: 900_000 }
  if (e instanceof GoogleError) {
    if (e.needsReconnect || e.code === 'invalid_grant' || e.code === 'no_secret') return { outcome: 'blocked', code: 'sender_needs_reconnect', detail, delayMs: 0, circuit: 'dead' }
    if (e.code === 'invalid_client' || e.code === 'redirect_uri_mismatch') return { outcome: 'blocked', code: 'worker_config', detail, delayMs: 900_000 }
    return { outcome: 'retry', code: e.code === 'rate_limited' ? 'rate_limited' : e.code === 'server_error' ? 'server_error' : 'network', detail, delayMs: backoffMs(failStreak, { retryAfterMs: e.retryAfterMs, rand }) }
  }
  return { outcome: 'retry', code: 'network', detail, delayMs: backoffMs(failStreak, { rand }) }
}

// ------------------------------------------------------------------------------------------------ the worker
// `blocked` = rows the worker itself returned to the queue with a reason (a sender that failed); `held` = rows the DATABASE held back at claim time (rate limit, daily cap, no sender)
const emptySummary = (worker) => ({ worker, runs: 0, claimed: 0, sent: 0, retried: 0, failed: 0, needs_review: 0, blocked: 0, held: 0, released: 0, skipped: 0, requeued: 0, reviewed: 0, stopped: 'idle' })

/**
 * deps = {
 *   db        createEmailDb(...)            claim / markSending / finish / heartbeat / markConnection / touchConnection
 *   tokens    { getAccessToken(id, {force}), invalidate(id) }   the Google access-token provider (in memory only)
 *   send      async (accessToken, raw) -> { id }  | throws GoogleError          sendGmailMessage bound to the config
 *   now       () => ms     sleep (ms) => Promise     rand () => [0,1)     log (event, fields)
 *   workerId  string
 * }
 * opts = WORKER_DEFAULTS overrides.  -> the summary (counts only).
 */
export async function runEmailWorker(deps, opts = {}) {
  const o = { ...WORKER_DEFAULTS, ...opts }
  const { db, tokens, send } = deps
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const rand = deps.rand ?? Math.random
  const log = deps.log ?? ((event, fields) => safeLog(event, fields))
  const worker = deps.workerId
  const started = now()
  const deadline = started + o.maxRunMs
  const summary = emptySummary(worker)
  const circuits = new Map() // sender id -> { kind: 'dead' | 'limited' | 'capped', code, delayMs, batch }
  let batchNo = 0

  // a finished row must reach the database even after a blip (a lost `sent` would leave a delivered message as needs_review): three tries
  async function finish(row, outcome, extra = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.finish({ id: row.id, worker, outcome, code: extra.code ?? null, detail: extra.detail ?? null, delayMs: extra.delayMs ?? null, gmailMessageId: extra.gmailMessageId ?? null, messageId: extra.messageId ?? null, maxStreak: o.maxStreak })
      } catch (e) {
        if (attempt === 2 || (e?.token ?? 'db_error') !== 'db_error') {
          log('email_finish_failed', { id: row.id, outcome, token: e?.token ?? 'db_error' })
          return null
        }
        await sleep(400 * (attempt + 1))
      }
    }
    return null
  }

  async function processRow(row) {
    const sender = row.sender
    // 1. a sender that already failed in this run: do not hit Google again for it (the rest of its rows wait / re-resolve)
    const circuit = circuits.get(sender.id)
    if (circuit) {
      summary.blocked += 1
      // the database handed the same dead sender out again in a LATER batch (it still thinks it is usable): wait, do not spin
      const delayMs = circuit.kind === 'dead' && circuit.batch < batchNo ? Math.max(circuit.delayMs, 300_000) : circuit.delayMs
      await finish(row, 'blocked', { code: circuit.code, detail: 'sender unavailable earlier in this run', delayMs })
      return
    }
    // 2. build the message from the stored row (validation errors are permanent and happen BEFORE anything is marked)
    let msg
    try {
      msg = buildOutgoing(row, { sendAttempt: (row.send_attempt ?? 0) + 1, now: new Date(now()) })
    } catch (e) {
      summary.failed += 1
      await finish(row, 'failed', { code: mimeFailure(e), detail: e instanceof MimeError ? `mime ${e.code} ${e.field ?? ''}`.trim() : 'no content' })
      return
    }
    // 3. an access token (in memory only); failures here happened BEFORE any request: nothing can have been sent
    let accessToken
    try {
      accessToken = await tokens.getAccessToken(sender.id)
    } catch (e) {
      const c = classifyTokenError(e, { failStreak: row.fail_streak ?? 0, rand })
      if (c.circuit) circuits.set(sender.id, { kind: c.circuit, code: c.code, delayMs: c.delayMs ?? 0, batch: batchNo })
      if (c.outcome === 'retry') summary.retried += 1
      else summary.blocked += 1
      await finish(row, c.outcome, { code: c.code, detail: c.detail, delayMs: c.delayMs })
      log('email_token_failed', { id: row.id, code: c.code })
      return
    }
    // 4. persist the marker: from here on a crash means "unknown outcome". A lost lease means another worker owns the row: do nothing.
    let marked
    try {
      marked = await db.markSending(row.id, worker)
    } catch (e) {
      log('email_mark_failed', { id: row.id, token: e?.token ?? 'db_error' })
      summary.skipped += 1
      return
    }
    if (!marked?.ok) {
      summary.skipped += 1
      log('email_lease_lost', { id: row.id })
      return
    }
    if (marked.send_attempt !== (row.send_attempt ?? 0) + 1) {
      try {
        msg = buildOutgoing(row, { sendAttempt: marked.send_attempt, now: new Date(now()) })
      } catch (e) {
        summary.failed += 1
        await finish(row, 'failed', { code: mimeFailure(e), detail: 'mime' })
        return
      }
    }
    // 5. the request. 401 = rejected before processing: one retry with a fresh token. Anything unknown after this point is needs_review.
    let result = null
    let err = null
    let tokenFailure = false
    for (let tries = 0; tries < 2; tries++) {
      try {
        result = await send(accessToken, msg.raw)
        err = null
        break
      } catch (e) {
        err = e
        if (e instanceof GoogleError && e.code === 'unauthorized' && tries === 0) {
          tokens.invalidate?.(sender.id)
          try {
            accessToken = await tokens.getAccessToken(sender.id, { force: true })
            continue
          } catch (e2) {
            err = e2
            tokenFailure = true
            break
          }
        }
        break
      }
    }
    if (!err && result?.id) {
      summary.sent += 1
      await finish(row, 'sent', { code: null, detail: msg.ccDropped ? `cc_dropped:${msg.ccDropped}` : null, gmailMessageId: result.id, messageId: msg.messageId })
      await Promise.resolve(db.touchConnection(sender.id)).catch(() => {})
      return
    }
    // a failed refresh in step 5 was a token problem (the 401 was not processed); everything else comes from the send itself
    const c = tokenFailure ? classifyTokenError(err, { failStreak: row.fail_streak ?? 0, rand }) : classifySendError(err ?? new Error('no result'), { failStreak: row.fail_streak ?? 0, rand })
    if (c.markConnection) await Promise.resolve(db.markConnection(sender.id, 'needs_reconnect', c.markConnection)).catch(() => {})
    if (c.circuit) circuits.set(sender.id, { kind: c.circuit, code: c.outcome === 'retry' ? 'rate_limited' : c.code, delayMs: c.outcome === 'retry' ? (c.delayMs ?? 60_000) : (c.delayMs ?? 0), batch: batchNo })
    if (c.outcome === 'retry') summary.retried += 1
    else if (c.outcome === 'failed') summary.failed += 1
    else if (c.outcome === 'needs_review') summary.needs_review += 1
    else summary.blocked += 1
    await finish(row, c.outcome, { code: c.code, detail: c.detail, delayMs: c.delayMs })
    log('email_not_sent', { id: row.id, outcome: c.outcome, code: c.code })
  }

  try {
    for (;;) {
      if (summary.claimed >= o.maxMessages) { summary.stopped = 'max_messages'; break }
      if (now() >= deadline) { summary.stopped = 'deadline'; break }
      const claim = await db.claim({ worker, limit: Math.min(o.batchLimit, o.maxMessages - summary.claimed), leaseSeconds: o.leaseSeconds, perMinute: o.perMinute, dailyCap: o.dailyCap })
      summary.runs += 1
      batchNo += 1
      summary.held += claim?.blocked ?? 0
      summary.requeued += claim?.requeued ?? 0
      summary.reviewed += claim?.reviewed ?? 0
      const rows = Array.isArray(claim?.rows) ? claim.rows : []
      if (rows.length === 0) {
        if (claim?.has_more && summary.runs < 50) continue // the candidate window was full of blocked rows: look further
        const wait = msUntil(claim?.next_ready_at, claim?.now)
        if (wait !== null && wait <= o.maxIdleWaitMs && now() + wait + 3000 < deadline && (claim?.blocked ?? 0) > 0) {
          await sleep(wait + 250)
          continue
        }
        break
      }
      summary.claimed += rows.length
      for (let i = 0; i < rows.length; i++) {
        if (now() >= deadline) {
          // out of time: give the untouched rows back (never a row whose request started: the database refuses that)
          for (const rest of rows.slice(i)) {
            summary.released += 1
            await finish(rest, 'release', { detail: 'worker out of time' })
          }
          summary.stopped = 'deadline'
          break
        }
        try {
          await processRow(rows[i])
        } catch (e) {
          // a bug must never lose a row: a marked row becomes needs_review when its lease expires, an unmarked one is requeued
          summary.skipped += 1
          log('email_row_error', { id: rows[i]?.id ?? null, name: e?.name ?? 'Error' })
        }
      }
      if (summary.stopped === 'deadline') break
    }
  } catch (e) {
    summary.stopped = 'error'
    log('email_worker_error', { token: e?.token ?? 'error', name: e?.name ?? 'Error' })
  }
  summary.elapsed_ms = now() - started
  try {
    await db.heartbeat(worker, summary)
  } catch {
    /* the heartbeat is informational */
  }
  return summary
}

// ------------------------------------------------------------------------------------------------ request authorisation (the function is public at the gateway: it checks its own secret)
const enc = new TextEncoder()
/** Constant-time string comparison through two SHA-256 digests (equal length, no early exit). */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256Hex(enc.encode(String(a ?? ''))), sha256Hex(enc.encode(String(b ?? '')))])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0 && x.length === y.length
}

/**
 * The email-worker is called by pg_cron / pg_net (header `x-worker-secret`), by a script with the service key (Bearer) or by nobody else.
 * -> 'ok' | 'not_configured' | 'unauthorized'.  With neither secret configured it is closed (fail closed).
 */
export async function authorizeWorkerRequest(headers, { workerSecret, serviceKey }) {
  const secret = String(workerSecret ?? '').trim()
  const key = String(serviceKey ?? '').trim()
  if (secret.length < 24 && !key) return 'not_configured'
  const given = String(headers.get('x-worker-secret') ?? '').trim()
  if (secret.length >= 24 && given && (await safeEqual(given, secret))) return 'ok'
  const m = /^Bearer\s+(.+)$/i.exec(String(headers.get('authorization') ?? '').trim())
  if (key && m && (await safeEqual(m[1], key))) return 'ok'
  return 'unauthorized'
}
