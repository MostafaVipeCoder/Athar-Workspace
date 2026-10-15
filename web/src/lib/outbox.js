/**
 * The e-mail Outbox, pure helpers (m62, design 07 section 1.6). The database decides the STATE of a row (`state` in every RPC answer:
 * queued | blocked | sending | sent | failed | needs_review | cancelled); this file only maps it to tones, translation keys, which actions
 * a person may take (the same rules as the SQL: db/migrations/m62_email_worker.sql) and how often the screens refresh.
 */

/** The filter chips, in the order a PM reads them ("what needs me" first). `cancelled` appears under "All" only. */
export const FILTER_STATES = ['needs_review', 'failed', 'blocked', 'queued', 'sending', 'sent']
export const ALL_STATES = ['queued', 'blocked', 'sending', 'sent', 'failed', 'needs_review', 'cancelled']

/** Badge tone per state (ui/Badge): attention states are amber / red, done is green, in progress is blue. */
export const STATE_TONE = { queued: 'blue', blocked: 'amber', sending: 'blue', sent: 'green', failed: 'red', needs_review: 'amber', cancelled: 'neutral' }

/** Why a queued row waits (the database column `blocked_reason`). */
export const BLOCKED_REASONS = ['rate_limited', 'daily_cap', 'sender_needs_reconnect', 'no_sender', 'worker_config']

/** The codes the worker / database write to `error_code` (the UI has a human sentence for each; anything else gets the generic one). */
export const ERROR_CODES = [
  'unknown_outcome', 'max_attempts', 'rejected_by_gmail', 'invalid_recipient', 'invalid_message', 'message_too_large', 'too_many_recipients', 'no_content',
  'forbidden', 'not_found', 'rate_limited', 'server_error', 'network', 'sender_needs_reconnect', 'no_sender', 'daily_cap', 'worker_config',
]

/** The state of a row: the server's `state`, else derived from status + blocked_reason (older payloads, the node extras). `dead` reads as failed. */
export function stateOf(row) {
  if (!row) return 'queued'
  if (row.state) return row.state
  const status = row.status ?? 'queued'
  if (status === 'queued' && row.blocked_reason) return 'blocked'
  if (status === 'dead') return 'failed'
  return status
}

/** Translation key of a state label. */
export const stateKey = (state) => `outbox.state.${ALL_STATES.includes(state) ? state : 'queued'}`

/** The human sentence for why a row waits / failed: `outbox.blocked.<reason>` or `outbox.error.<code>` (generic when the code is new). */
export function explanationKey(row) {
  const state = stateOf(row)
  if (state === 'blocked' && BLOCKED_REASONS.includes(row?.blocked_reason)) return `outbox.blocked.${row.blocked_reason}`
  if (row?.error_code && ERROR_CODES.includes(row.error_code)) return `outbox.error.${row.error_code}`
  if (state === 'failed') return 'outbox.error.generic'
  if (state === 'needs_review') return 'outbox.error.unknown_outcome'
  return null
}

/** A queued row that already failed once and waits for its next automatic attempt (a retry, not a block). */
export const isRetryWaiting = (row) => stateOf(row) === 'queued' && Number(row?.fail_streak) > 0

/**
 * What a person may do with a row (the same rules the SQL enforces; the server re-checks, rows that do not qualify are skipped):
 *   retry     failed / dead / queued (waiting or blocked)         -> queued now, a fresh retry budget
 *   cancel    queued / failed / dead / needs_review               -> cancelled (final)
 *   markSent  needs_review / failed / dead                        -> sent (a person knows it went out)
 *   resend    needs_review                                        -> queued again, a NEW request (the only way a possibly delivered mail is sent twice)
 */
export function rowActions(row) {
  const status = row?.status ?? stateOf(row)
  return {
    retry: ['failed', 'dead', 'queued'].includes(status),
    cancel: ['queued', 'failed', 'dead', 'needs_review'].includes(status),
    markSent: ['needs_review', 'failed', 'dead'].includes(status),
    resend: status === 'needs_review',
  }
}

/** Which of the selected rows each bulk action applies to. */
export function bulkTargets(rows) {
  const out = { retry: [], cancel: [], markSent: [], resend: [] }
  for (const r of rows ?? []) {
    const a = rowActions(r)
    for (const k of Object.keys(out)) if (a[k]) out[k].push(r.id)
  }
  return out
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
/** Rows a person should look at: failed + needs_review + blocked. */
export const attentionCount = (counts) => n(counts?.failed) + n(counts?.needs_review) + n(counts?.blocked)
/** Rows still on their way: queued + blocked + sending. */
export const activeCount = (counts) => n(counts?.queued) + n(counts?.blocked) + n(counts?.sending)
export const totalCount = (counts) => ALL_STATES.reduce((s, k) => s + n(counts?.[k]), 0)

/**
 * How often to refresh a list: every 10 s while something is on its way (TanStack pauses it in a hidden tab, and refetches on focus), never when
 * everything is final. No socket: a visitor of this page costs one light RPC per 10 s only while mail is being delivered.
 */
export const POLL_MS = 10_000
export function pollInterval(counts) {
  return activeCount(counts) > 0 ? POLL_MS : false
}

/** The Gmail search a person types to find the message in the sender's Sent folder (the worker sets our own Message-ID). */
export function gmailSearch(messageId) {
  const id = String(messageId ?? '').trim().replace(/^<|>$/g, '')
  return id ? `rfc822msgid:${id}` : ''
}

/** Message-ID of the attempt that may have been delivered: <outbox id.attempt@domain> (the row's message_id is only stored after a confirmed send). */
export function expectedMessageId(row, senderEmail) {
  if (!row?.id) return ''
  const attempt = Number(row.send_attempt) > 0 ? Number(row.send_attempt) : 1
  const domain = String(senderEmail ?? row.sender_email ?? '').split('@')[1] || 'athareg.com'
  return `<${row.id}.${attempt}@${domain}>`
}

/** The audit events a row can have (m62 email_log), for the timeline labels. */
export const EVENT_KEYS = ['queued', 'claimed', 'blocked', 'send_started', 'sent', 'retry_scheduled', 'failed', 'needs_review', 'released', 'lease_expired_requeued', 'manual_retry', 'manual_cancel', 'manual_mark_sent', 'manual_resend']
export const eventKey = (event) => (EVENT_KEYS.includes(event) ? `outbox.event.${event}` : 'outbox.event.other')

/** Group the e-mail keys of the platform: the label key of an email_key. */
export const emailKeyLabel = (key) => `outbox.key.${['acceptance', 'rejection', 'interview', 'booking_confirmation', 'booking_cancellation', 'form_new_response', 'staff_invitation'].includes(key) ? key : 'other'}`

/** Counts of one node out of the project payload (`by_node`). */
export function nodeCounts(payload, nodeId) {
  return (payload?.by_node ?? {})[nodeId] ?? {}
}

/** Health: is the worker overdue? (the scheduler runs every minute: more than 3 minutes of silence with something waiting is a problem) */
export function workerHealth(health) {
  const age = health?.worker?.age_seconds
  const waiting = n(health?.queue?.ready) + n(health?.queue?.waiting) + n(health?.queue?.blocked)
  if (!health?.worker) return 'unknown'
  if (age === null || age === undefined) return waiting > 0 ? 'never' : 'idle'
  if (age > 180 && waiting > 0) return 'stalled'
  return 'ok'
}

/** Per-sender usage against the two limits (the worker's 30 a minute and 1,500 a day). */
export const SENDER_LIMITS = Object.freeze({ perMinute: 30, perDay: 1500 })
export function senderUsage(sender) {
  return {
    minute: n(sender?.started_1m),
    day: n(sender?.started_24h),
    minuteRatio: Math.min(1, n(sender?.started_1m) / SENDER_LIMITS.perMinute),
    dayRatio: Math.min(1, n(sender?.started_24h) / SENDER_LIMITS.perDay),
  }
}
