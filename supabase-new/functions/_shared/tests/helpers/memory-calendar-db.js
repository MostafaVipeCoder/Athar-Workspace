// An in-memory twin of the m63 calendar RPCs (the adapter createCalendarDb talks to `rpc(name, args)`; this object answers them) for the unit and
// integration tests. It mirrors the SEMANTICS of db/migrations/m63_calendar_sync.sql: the mode gate, the claim (one job per booking at a time in
// creation order, a lease, attempts + 1, a job whose lease expired six times is dead), the attempt fence of complete / fail / park / note, park without
// counting an attempt, the shadow log (once per job, no lock), the calendar-owner decision (frozen once an event exists), the write-back of the Meet link.
// db/verify/v63_calendar_sync.sql and db/scripts/verify-calendar-sync.mjs test the real SQL; tests/calendar-rpc-contract.test.js checks names + arguments.
import { DbError } from '../../google-edge.js'

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const KINDS = ['calendar_create', 'calendar_update', 'calendar_cancel']
const code = (c, d = 'error') => (String(c ?? '').toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 64) || d)

export function createMemoryCalendarDb({ mode = 'live', now = () => Date.now(), connections = [] } = {}) {
  const jobs = []
  const bookings = new Map()
  const log = []
  const conns = new Map(connections.map((c) => [c.id, { scopes: [CAL_SCOPE, 'https://www.googleapis.com/auth/gmail.send'], status: 'active', token_storage: 'aes', ...c }]))
  const state = { mode, lastRunAt: null, lastSummary: null }
  const calls = []
  let seq = 0
  const iso = (ms = now()) => new Date(ms).toISOString()
  const usable = (c) => Boolean(c && c.status === 'active' && c.scopes.includes(CAL_SCOPE))
  const mayHost = (c, bk) => c.kind === 'system' || (bk.node.hosts ?? []).includes(c.owner_user_id)

  function pick(b, jobConn) {
    const sys = [...conns.values()].find((c) => c.kind === 'system')
    if (b.synced_at || b.legacy_event_id) {
      const id = b.owner_connection_id ?? (b.legacy_event_id ? sys?.id ?? null : null)
      const c = id ? conns.get(id) : null
      return { id, source: b.owner_connection_id ? 'owner' : 'legacy_system', usable: usable(c), status: c?.status ?? null, reason: usable(c) ? null : !c || c.status === 'revoked' ? 'needs_connection' : 'needs_reconnect', email: c?.email ?? null }
    }
    const cand = [[b.settings.organizer_connection_id, 'organizer'], [b.owner_connection_id, 'booking'], [jobConn, 'job']]
    for (const [id, source] of cand) {
      const c = id ? conns.get(id) : null
      if (c && mayHost(c, b) && usable(c)) return { id, source, usable: true, status: c.status, reason: null, email: c.email }
    }
    const own = [...conns.values()].find((c) => c.kind === 'user' && c.owner_user_id === b.node.created_by && usable(c))
    const fallback = own ?? (usable(sys) ? sys : null)
    if (fallback) return { id: fallback.id, source: own ? 'user' : 'system', usable: true, status: 'active', reason: null, email: fallback.email }
    const needs = [...conns.values()].some((c) => c.status === 'needs_reconnect' && (cand.some(([id]) => id === c.id) || c.owner_user_id === b.node.created_by || c.kind === 'system'))
    return { id: null, source: null, usable: false, status: null, reason: needs ? 'needs_reconnect' : 'needs_connection', email: null }
  }

  const rpc = {
    calendar_worker_begin() {
      state.lastRunAt = iso()
      return { mode: state.mode, now: iso() }
    },
    calendar_worker_finish({ p_summary }) {
      state.lastSummary = p_summary
      return null
    },
    calendar_claim_jobs({ p_limit = 10, p_lease_seconds = 300 }) {
      if (state.mode !== 'live') return []
      for (const j of jobs) if (KINDS.includes(j.kind) && j.status === 'processing' && j.locked_until < now() && j.attempts >= 6) Object.assign(j, { status: 'dead', locked_until: null, error: 'lease_expired' })
      const due = jobs
        .filter((x) => KINDS.includes(x.kind) && x.next_attempt_at <= now() && (['pending', 'failed'].includes(x.status) || (x.status === 'processing' && x.locked_until < now())))
        .filter((x) => !(x.booking_id && jobs.some((e) => e !== x && e.booking_id === x.booking_id && KINDS.includes(e.kind) && ['pending', 'failed', 'processing'].includes(e.status) && e.created_at < x.created_at)))
        .sort((a, b) => a.next_attempt_at - b.next_attempt_at || a.created_at - b.created_at)
        .slice(0, Math.min(Math.max(p_limit, 1), 50))
      return due.map((j) => {
        Object.assign(j, { status: 'processing', attempts: j.attempts + 1, error: null, locked_until: now() + Math.min(Math.max(p_lease_seconds, 30), 900) * 1000 })
        return { id: j.id, kind: j.kind, booking_id: j.booking_id, connection_id: j.connection_id, attempts: j.attempts, payload: j.payload, created_at: iso(j.created_at) }
      })
    },
    calendar_job_context({ p_job }) {
      const j = jobs.find((x) => x.id === p_job)
      if (!j || !KINDS.includes(j.kind)) return null
      const jobView = { id: j.id, kind: j.kind, attempts: j.attempts, status: j.status, payload: j.payload, connection_id: j.connection_id, created_at: iso(j.created_at) }
      const b = bookings.get(j.booking_id)
      if (!b) return { mode: state.mode, now: iso(), booking: null, job: jobView }
      const may = Boolean(b.legacy_event_id || b.synced_at || jobs.some((e) => e.booking_id === b.id && e.kind === 'calendar_create' && e.attempts - (e.id === j.id && e.status === 'processing' ? 1 : 0) > 0 && !(e.status === 'done' && String(e.result?.action ?? '').startsWith('skipped'))))
      const c = pick(b, j.connection_id)
      return {
        mode: state.mode, now: iso(), job: jobView,
        booking: { id: b.id, status: b.status, booker_email: b.booker_email, booker_name: b.booker_name ?? null, booker_company_name: b.booker_company_name ?? null, company_en: b.company_en ?? null, company_ar: b.company_ar ?? null,
          lang: b.lang ?? 'en', meet_link: b.meet_link ?? null, event_id: b.legacy_event_id ?? b.id.replace(/-/g, ''), legacy_event: Boolean(b.legacy_event_id), synced_at: b.synced_at ?? null, owner_connection_id: b.owner_connection_id ?? null, event_may_exist: may },
        slot: { id: b.slot.id, starts_at: b.slot.starts_at, ends_at: b.slot.ends_at },
        provider: { email: b.provider.email ?? null, name_en: b.provider.name_en ?? '', name_ar: b.provider.name_ar ?? '' },
        node: { id: b.node.id, name_en: b.node.name_en ?? null, name_ar: b.node.name_ar ?? null, created_by: b.node.created_by ?? null, mode: b.node.mode ?? 'mentor', cc: b.node.cc ?? [], admin: b.node.admin ?? [] },
        project: { id: b.project.id, name_en: b.project.name_en ?? null, name_ar: b.project.name_ar ?? null, timezone: b.project.timezone },
        settings: { meeting_link_mode: b.settings.meeting_link_mode ?? 'unique', shared_meet_link: b.settings.shared_meet_link ?? null, organizer_connection_id: b.settings.organizer_connection_id ?? null },
        connection: { id: c.id, source: c.source, usable: c.usable, status: c.status, reason: c.reason, email: c.email },
      }
    },
    calendar_note_event({ p_job, p_attempt, p_owner }) {
      const j = jobs.find((x) => x.id === p_job)
      if (!j || j.status !== 'processing' || j.attempts !== p_attempt || !j.booking_id) return false
      const b = bookings.get(j.booking_id)
      if (b && (!b.synced_at || !b.owner_connection_id)) {
        b.owner_connection_id = p_owner ?? b.owner_connection_id
        b.synced_at = b.synced_at ?? iso()
      }
      return true
    },
    calendar_complete_job({ p_job, p_attempt, p_result = {}, p_meet_link = null, p_owner = null }) {
      const j = jobs.find((x) => x.id === p_job)
      if (!j || j.status !== 'processing' || j.attempts !== p_attempt) return false
      const b = j.booking_id ? bookings.get(j.booking_id) : null
      if (b) {
        const link = String(p_meet_link ?? '').trim()
        if (link && /^https:\/\/\S+$/i.test(link) && b.meet_link !== link) b.meet_link = link
        if (p_owner && j.kind !== 'calendar_cancel' && (!b.synced_at || !b.owner_connection_id)) {
          b.owner_connection_id = b.owner_connection_id ?? p_owner
          b.synced_at = b.synced_at ?? iso()
        }
      }
      Object.assign(j, { status: 'done', result: p_result, locked_until: null, error: null })
      log.push({ event: p_result.action ?? 'done', job_id: j.id, booking_id: j.booking_id, detail: p_result })
      return true
    },
    calendar_fail_job({ p_job, p_attempt, p_code, p_retryable = true, p_delay_seconds = 60, p_max_attempts = 6 }) {
      const j = jobs.find((x) => x.id === p_job)
      if (!j || j.status !== 'processing' || j.attempts !== p_attempt) return { ok: false, reason: 'lease_lost' }
      const final = !p_retryable || j.attempts >= Math.max(p_max_attempts, 1)
      Object.assign(j, { status: final ? 'dead' : 'failed', locked_until: null, error: code(p_code), next_attempt_at: final ? j.next_attempt_at : now() + Math.min(Math.max(p_delay_seconds, 0), 86400) * 1000 })
      log.push({ event: final ? 'dead' : 'failed', job_id: j.id, booking_id: j.booking_id, detail: { code: j.error } })
      return { ok: true, status: j.status }
    },
    calendar_park_job({ p_job, p_attempt, p_code = 'needs_connection', p_delay_seconds = 900 }) {
      const j = jobs.find((x) => x.id === p_job)
      if (!j || j.status !== 'processing' || j.attempts !== p_attempt) return false
      const c = code(p_code, 'needs_connection')
      if (j.error !== c) log.push({ event: 'parked', job_id: j.id, booking_id: j.booking_id, detail: { code: c } })
      Object.assign(j, { status: 'pending', locked_until: null, attempts: Math.max(j.attempts - 1, 0), error: c, next_attempt_at: now() + Math.min(Math.max(p_delay_seconds, 1), 86400) * 1000 })
      return true
    },
    calendar_shadow_peek({ p_limit = 20 }) {
      if (state.mode !== 'shadow') return []
      return jobs
        .filter((x) => KINDS.includes(x.kind) && ['pending', 'failed'].includes(x.status) && !log.some((l) => l.job_id === x.id && l.event === 'shadow'))
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, Math.min(Math.max(p_limit, 1), 100))
        .map((x) => ({ id: x.id, kind: x.kind, booking_id: x.booking_id, created_at: iso(x.created_at) }))
    },
    calendar_shadow_record({ p_job, p_plan }) {
      const j = jobs.find((x) => x.id === p_job)
      if (!j || !p_plan || typeof p_plan !== 'object' || JSON.stringify(p_plan).length > 8000) return false
      if (log.some((l) => l.job_id === p_job && l.event === 'shadow')) return false
      log.push({ event: 'shadow', job_id: p_job, booking_id: j.booking_id, detail: p_plan })
      return true
    },
  }

  const api = {
    state, jobs, bookings, log, conns, calls,
    /** The supabase-js-shaped client createCalendarDb wraps. */
    client: {
      async rpc(name, args = {}) {
        calls.push(name)
        const fn = rpc[name]
        if (!fn) return { data: null, error: { code: '42883', message: `no function ${name}` } }
        try {
          return { data: fn(args), error: null }
        } catch (e) {
          if (e instanceof DbError) return { data: null, error: { code: e.code, hint: e.token, message: e.message } }
          throw e
        }
      },
    },
    /** The few RPCs the access-token provider needs (markConnection); the same Map backs the connection decisions. */
    googleDb: {
      async markConnection(id, status, errorCode = null) {
        const c = conns.get(id)
        if (c) Object.assign(c, { status, last_error: errorCode })
        return { ok: true }
      },
      async touchConnection() { return null },
    },
    addConnection(c) {
      conns.set(c.id, { scopes: [CAL_SCOPE, 'https://www.googleapis.com/auth/gmail.send'], status: 'active', token_storage: 'aes', ...c })
      return conns.get(c.id)
    },
    /** A booking with everything the context needs. Returns it (mutate to simulate a PM edit). */
    addBooking(o = {}) {
      const { slot = {}, provider = {}, node = {}, project = {}, settings = {}, ...rest } = o
      const id = rest.id ?? `b0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
      const startsAt = slot.starts_at ?? rest.starts_at ?? iso(Math.floor((now() + 3 * 86400_000) / 60_000) * 60_000)
      const endsAt = slot.ends_at ?? rest.ends_at ?? iso(Date.parse(startsAt) + 30 * 60_000)
      const { starts_at: _s, ends_at: _e, ...fields } = rest
      const b = {
        status: 'confirmed', booker_email: 'founder@example.com', booker_name: 'Mona Fathy', booker_company_name: 'Delta Farms', lang: 'en', meet_link: null,
        legacy_event_id: null, synced_at: null, owner_connection_id: null,
        ...fields,
        id,
        slot: { id: `51000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, ...slot, starts_at: startsAt, ends_at: endsAt },
        provider: { email: 'mentor@example.com', name_en: 'Ahmed Mentor', name_ar: 'أحمد', ...provider },
        node: { id: 'n0000000-0000-4000-8000-000000000001', name_en: 'Mentor sessions', created_by: 'u-pm-1', mode: 'mentor', cc: [], admin: [], hosts: ['u-pm-1'], ...node },
        project: { id: 'p0000000-0000-4000-8000-000000000001', name_en: 'Demo project', timezone: 'Africa/Cairo', ...project },
        settings: { meeting_link_mode: 'unique', shared_meet_link: null, organizer_connection_id: null, ...settings },
      }
      bookings.set(id, b)
      return b
    },
    addJob(o = {}) {
      const j = { id: o.id ?? `70b00000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, kind: 'calendar_create', booking_id: null, connection_id: null, status: 'pending', attempts: 0, next_attempt_at: now(), locked_until: null, error: null, payload: {}, result: null, created_at: now() + seq, ...o }
      jobs.push(j)
      return j
    },
    /** What the trigger of m63 does when a connection becomes active: parked jobs are due now. */
    unpark() {
      for (const j of jobs) if (KINDS.includes(j.kind) && j.status === 'pending' && ['needs_connection', 'needs_reconnect'].includes(j.error) && j.next_attempt_at > now()) j.next_attempt_at = now()
    },
  }
  return api
}
