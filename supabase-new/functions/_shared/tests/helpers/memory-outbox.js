// An in-memory twin of the m62 worker RPCs (email_worker_claim / mark_sending / finish / heartbeat) for the unit tests of the worker. It mirrors the
// SEMANTICS the worker relies on (FIFO claim, one holder per row, the lease, the in-flight marker, retry streak -> failed, blocked reasons, release,
// late success upgrading needs_review, the reaper) so the worker logic can be tested without a database; db/verify/v62 tests the real SQL and
// db/scripts/verify-email-worker.mjs tests the whole thing end to end. tests/email-rpc-contract.test.js keeps names and arguments in step.

import { EmailDbError } from '../../email-worker.js'

let seq = 0
export function makeRow(over = {}) {
  seq += 1
  const id = over.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
  return {
    id,
    email_key: 'acceptance',
    recipient: `person${seq}@example.invalid`,
    cc: [],
    subject: `Subject ${seq}`,
    body_html: `<p>Body ${seq}</p>`,
    reply_to: null,
    project_id: 'p',
    node_id: 'n',
    created_by: 'u',
    created_at: seq,
    // table state
    status: 'queued',
    attempts: 0,
    send_attempt: 0,
    fail_streak: 0,
    next_attempt_at: 0,
    blocked_reason: null,
    locked_by: null,
    locked_until: null,
    send_started_at: null,
    error_code: null,
    gmail_message_id: null,
    message_id: null,
    sender: { id: 'conn-pm', email: 'pm.one@athareg.com', source: 'user', fallback: false, name: 'Mona Pm' },
    ...over,
  }
}

export function createMemoryOutbox({ rows = [], now = { t: 1_000_000 }, failFinish = 0, perMinute = null } = {}) {
  const table = new Map(rows.map((r) => [r.id, r]))
  const log = []
  const heartbeats = []
  const connectionMarks = []
  const touched = []
  let finishFailures = failFinish
  const started = [] // { t, sender } of every send_started

  const db = {
    table,
    log,
    heartbeats,
    connectionMarks,
    touched,
    now,
    get(id) { return table.get(id) },
    /** a worker that died: its leases expire. `afterSend` = the process died after the request marker was persisted. */
    expireLeases() { for (const r of table.values()) if (r.status === 'sending') r.locked_until = now.t - 1 },
    reap() {
      for (const r of table.values()) {
        if (r.status !== 'sending' || !(r.locked_until == null || r.locked_until < now.t)) continue
        if (r.send_started_at == null) { r.status = 'queued'; r.next_attempt_at = now.t; r.locked_by = null; r.locked_until = null; log.push([r.id, 'lease_expired_requeued']) }
        else { r.status = 'needs_review'; r.error_code = 'unknown_outcome'; r.locked_until = null; log.push([r.id, 'needs_review']) }
      }
    },
    async claim({ worker, limit, leaseSeconds }) {
      db.reap()
      const out = []
      let blocked = 0
      const ready = [...table.values()].filter((r) => r.status === 'queued' && r.next_attempt_at <= now.t).sort((a, b) => a.created_at - b.created_at)
      for (const r of ready) {
        if (out.length >= limit) break
        if (perMinute !== null) {
          const used = started.filter((s) => s.sender === r.sender.id && now.t - s.t < 60_000).length + [...table.values()].filter((x) => x.status === 'sending' && x.sender.id === r.sender.id && x.send_started_at == null).length
          if (used >= perMinute) { r.blocked_reason = 'rate_limited'; r.next_attempt_at = now.t + 20_000; blocked += 1; continue }
        }
        r.status = 'sending'; r.attempts += 1; r.locked_by = worker; r.locked_until = now.t + leaseSeconds * 1000; r.blocked_reason = null; r.send_started_at = null
        out.push(structuredClone(r))
      }
      const next = [...table.values()].filter((r) => r.status === 'queued').map((r) => r.next_attempt_at).sort((a, b) => a - b)[0]
      return { rows: out, claimed: out.length, blocked, has_more: false, requeued: 0, reviewed: 0, next_ready_at: next === undefined ? null : new Date(next).toISOString(), now: new Date(now.t).toISOString() }
    },
    async markSending(id, worker) {
      const r = table.get(id)
      if (!r || r.status !== 'sending' || r.locked_by !== worker || r.locked_until <= now.t || r.send_started_at != null) return { ok: false, reason: 'lease_lost' }
      r.send_started_at = now.t; r.send_attempt += 1; r.locked_until = Math.max(r.locked_until, now.t + 90_000)
      started.push({ t: now.t, sender: r.sender.id })
      log.push([r.id, 'send_started'])
      return { ok: true, send_attempt: r.send_attempt }
    },
    async finish({ id, worker, outcome, code, detail, delayMs, gmailMessageId, messageId, maxStreak }) {
      if (finishFailures > 0) { finishFailures -= 1; throw new EmailDbError('db_error') }
      const r = table.get(id)
      if (!r) return { ok: false, reason: 'not_found' }
      if (r.status === 'sent' && outcome === 'sent') return { ok: true, status: 'sent', already: true }
      const owner = (r.status === 'sending' && r.locked_by === worker) || (r.status === 'needs_review' && r.locked_by === worker && r.error_code === 'unknown_outcome' && outcome === 'sent')
      if (!owner) return { ok: false, reason: 'not_owner', status: r.status }
      const leave = () => { r.locked_by = null; r.locked_until = null }
      if (outcome === 'sent') { r.status = 'sent'; r.gmail_message_id = gmailMessageId; r.message_id = messageId; r.error_code = null; r.fail_streak = 0; leave() }
      else if (outcome === 'retry') {
        r.fail_streak += 1
        if (r.fail_streak >= (maxStreak ?? 6)) { r.status = 'failed'; r.error_code = 'max_attempts' } else { r.status = 'queued'; r.next_attempt_at = now.t + Math.min(Math.max(delayMs ?? 30_000, 1000), 21_600_000); r.error_code = code }
        r.send_started_at = null; leave()
      } else if (outcome === 'failed') { r.status = 'failed'; r.error_code = code ?? 'failed'; r.send_started_at = null; leave() }
      else if (outcome === 'needs_review') { r.status = 'needs_review'; r.error_code = 'unknown_outcome'; r.locked_until = null }
      else if (outcome === 'release') { if (r.send_started_at != null) return { ok: false, reason: 'request_started', status: r.status }; r.status = 'queued'; r.next_attempt_at = now.t; leave() }
      else if (outcome === 'blocked') { r.status = 'queued'; r.blocked_reason = code; r.next_attempt_at = now.t + (delayMs ?? 300_000); r.error_code = code; r.send_started_at = null; leave() }
      log.push([r.id, outcome, code ?? null, detail ?? null])
      return { ok: true, status: r.status }
    },
    async heartbeat(worker, summary) { heartbeats.push({ worker, summary }) },
    async markConnection(id, status, code) { connectionMarks.push([id, status, code]) },
    async touchConnection(id) { touched.push(id) },
  }
  return db
}
