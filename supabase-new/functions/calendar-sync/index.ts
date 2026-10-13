// calendar-sync (design 07 section 2.2) - SKELETON, NOT DEPLOYED.
//
// ONE server-side path for Google Calendar / Meet: this function claims `app_private.integration_jobs` rows of kind
// calendar_create / calendar_update / calendar_cancel (enqueued by create_booking / reschedule_booking / cancel_booking /
// restore_booking, m06d + m34), creates/patches/deletes the Calendar event AS THE CONNECTION'S OWNER (the PM's own Google
// account, or the startups@ system account) and writes the Meet link back onto the booking. It replaces the as-is
// `process-booking`, `generate-google-meet`, `notify-google-apps-script` and both Apps Script copies (07 section 2.3).
//
// What is implemented here: the job loop, the DB contract (claim / complete / fail RPCs, attendees and times derived
// from stored data), the idempotency rules (event id = the booking id's 32 hex characters, requestId = booking id,
// 409 -> adopt the existing event), the two Meet modes and the cancel/update semantics.
// What is NOT implemented (needs the OAuth work of design 07 section 1.4 and 2.2): obtaining an access token for a
// `google_connections` row (refresh token in Supabase Vault). Until `getAccessToken` exists, a job whose connection is
// missing is left `pending` untouched (never claimed), so the PM UI shows "Waiting for a Google connection".
//
// Run locally later with:  supabase functions serve calendar-sync --env-file ./supabase-new/.env.local
// Trigger: pg_cron every minute (`select net.http_post(...)`) or a kick after enqueue; both call POST /calendar-sync.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

type JobKind = 'calendar_create' | 'calendar_update' | 'calendar_cancel'
interface Job { id: string; kind: JobKind; booking_id: string | null; connection_id: string | null; payload: Record<string, unknown>; attempts: number }
interface BookingRow {
  id: string; status: 'confirmed' | 'cancelled'; booker_email: string; booker_name: string | null; booker_company_name: string | null
  meet_link: string | null; calendar_event_id: string; calendar_owner_connection_id: string | null; lang: string | null
  slot: { starts_at: string; ends_at: string; provider: { booking_email: string | null; list_item: { network_expert: { email: string | null; name_en: string | null } | null } } }
  node: { name_en: string; name_ar: string; config: Record<string, unknown>; project: { timezone: string; name_en: string } }
  settings: { meeting_link_mode: 'unique' | 'shared'; shared_meet_link: string | null; organizer_connection_id: string | null; mode: 'mentor' | 'interview' }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const MAX_PER_RUN = 20
const MEET_POLL_ATTEMPTS = 5

/**
 * TODO (OAuth work, design 07 section 1.4): exchange the connection's refresh token (Vault secret `vault_secret_id`) for
 * an access token with the `calendar.events` scope; on `invalid_grant` mark the connection `needs_reauth` and throw a
 * NonRetryable error so the job pauses ("needs re-authorisation" in the PM UI). Returns null while not implemented.
 */
async function getAccessToken(_db: SupabaseClient, _connectionId: string): Promise<string | null> {
  return null
}

class NonRetryable extends Error {}

function eventBody(b: BookingRow, lang: string) {
  const providerName = b.slot.provider.list_item.network_expert?.name_en ?? ''
  const who = b.booker_company_name ?? b.booker_name ?? b.booker_email
  const summary = b.settings.mode === 'interview' ? `Interview: ${who} with ${providerName}` : `Mentor Session: ${who} with ${providerName}`
  const attendees = [b.booker_email, b.slot.provider.booking_email ?? b.slot.provider.list_item.network_expert?.email]
    .concat(ccListsOf(b.node.config))
    .filter((e): e is string => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    .map((e) => e.toLowerCase())
  const unique = [...new Set(attendees)].map((email) => ({ email }))
  const tz = b.node.project.timezone
  const body: Record<string, unknown> = {
    id: b.calendar_event_id, // idempotent: derived from the booking id (07 2.2)
    summary,
    description: `${b.node.name_en} - ${b.node.project.name_en} (${lang})`,
    start: { dateTime: b.slot.starts_at, timeZone: tz },
    end: { dateTime: b.slot.ends_at, timeZone: tz },
    attendees: unique,
    guestsCanModify: false,
    guestsCanInviteOthers: false,
  }
  if (b.settings.meeting_link_mode === 'shared') {
    if (!b.settings.shared_meet_link) throw new NonRetryable('shared Meet mode without a link (C-3): fix the node settings and retry')
    body.location = b.settings.shared_meet_link
    body.description = `${body.description}\n${b.settings.shared_meet_link}`
  } else {
    body.conferenceData = { createRequest: { requestId: b.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }
  return body
}

/** The node's admin/CC lists (config.emails.booking_confirmation.cc/admin) are calendar attendees too (as-is behaviour). */
function ccListsOf(config: Record<string, unknown>): string[] {
  const tpl = (config?.emails as Record<string, { cc?: unknown; admin?: unknown }> | undefined)?.booking_confirmation
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  return [...list(tpl?.cc), ...list(tpl?.admin)]
}

async function google(token: string, method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  return { status: r.status, json: text ? JSON.parse(text) : null }
}

function meetLinkOf(event: Record<string, unknown> | null): string | null {
  const points = (event?.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined)?.entryPoints ?? []
  return points.find((p) => p.entryPointType === 'video')?.uri ?? (event?.hangoutLink as string | undefined) ?? null
}

async function loadBooking(db: SupabaseClient, id: string): Promise<BookingRow> {
  const { data, error } = await db
    .from('bookings')
    .select('id, status, booker_email, booker_name, booker_company_name, meet_link, calendar_event_id, calendar_owner_connection_id, lang, slot:booking_slots(starts_at, ends_at, provider:booking_providers(booking_email, list_item:list_items(network_expert:network_experts(email, name_en)))), node:nodes(name_en, name_ar, config, project:projects(timezone, name_en)), settings:booking_settings(meeting_link_mode, shared_meet_link, organizer_connection_id, mode)')
    .eq('id', id)
    .single()
  if (error || !data) throw new NonRetryable(`booking ${id} not found: ${error?.message ?? ''}`)
  return data as unknown as BookingRow
}

async function processJob(db: SupabaseClient, job: Job): Promise<Record<string, unknown>> {
  if (!job.booking_id) throw new NonRetryable('job without booking')
  const b = await loadBooking(db, job.booking_id)
  const connectionId = job.connection_id ?? b.calendar_owner_connection_id ?? b.settings.organizer_connection_id
  if (!connectionId) throw new Error('no Google connection: left pending') // never reached: such jobs are not claimed (see handler)
  const token = await getAccessToken(db, connectionId)
  if (!token) throw new Error('OAuth not available yet: left pending')
  const lang = (job.payload?.lang as string | undefined) ?? b.lang ?? 'en'
  const eventUrl = `${CALENDAR_API}/${b.calendar_event_id}`
  const sendUpdates = 'sendUpdates=all'

  if (job.kind === 'calendar_cancel') {
    const r = await google(token, 'DELETE', `${eventUrl}?${sendUpdates}`)
    if (![200, 204, 404, 410].includes(r.status)) throw new Error(`events.delete ${r.status}`) // already gone = success (07 2.2)
    return { deleted: r.status !== 404 && r.status !== 410 }
  }

  const body = eventBody(b, lang)
  let event: Record<string, unknown> | null = null
  if (job.kind === 'calendar_update') {
    const r = await google(token, 'PATCH', `${eventUrl}?${sendUpdates}&conferenceDataVersion=1`, { start: body.start, end: body.end, attendees: body.attendees })
    if (r.status === 404) {
      // the event was never created (e.g. a legacy booking): fall through to create
    } else if (r.status >= 300) throw new Error(`events.patch ${r.status}`)
    else event = r.json
  }
  if (!event) {
    const r = await google(token, 'POST', `${CALENDAR_API}?${sendUpdates}&conferenceDataVersion=1`, body)
    if (r.status === 409) {
      const g = await google(token, 'GET', eventUrl) // adopt the existing event (retry after a lost response)
      if (g.status >= 300) throw new Error(`events.get ${g.status}`)
      event = g.json
    } else if (r.status >= 300) {
      if (r.status === 401 || r.status === 403) throw new Error(`auth ${r.status}`) // retried with backoff; invalid_grant handled in getAccessToken
      throw new Error(`events.insert ${r.status}: ${JSON.stringify(r.json?.error ?? '')}`)
    } else event = r.json
  }

  // unique mode: Meet creation is asynchronous; poll until the entry point exists (bounded)
  let meet = b.settings.meeting_link_mode === 'shared' ? b.settings.shared_meet_link : meetLinkOf(event)
  for (let i = 0; !meet && b.settings.meeting_link_mode === 'unique' && i < MEET_POLL_ATTEMPTS; i += 1) {
    await new Promise((res) => setTimeout(res, 1500))
    const g = await google(token, 'GET', eventUrl)
    meet = meetLinkOf(g.json)
  }
  if (meet || b.meet_link !== meet) {
    const { error } = await db.from('bookings').update({ meet_link: meet ?? b.meet_link, calendar_owner_connection_id: connectionId }).eq('id', b.id)
    if (error) throw new Error(`bookings.update ${error.message}`)
  }
  return { event_id: b.calendar_event_id, meet_link_set: Boolean(meet) }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response('not configured', { status: 500 })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const summary: Record<string, number> = { claimed: 0, done: 0, failed: 0, skipped: 0 }

  for (const kind of ['calendar_cancel', 'calendar_update', 'calendar_create'] as JobKind[]) {
    const { data: jobs, error } = await db.rpc('claim_integration_jobs', { p_kind: kind, p_limit: MAX_PER_RUN })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    for (const job of (jobs ?? []) as Job[]) {
      summary.claimed += 1
      try {
        const result = await processJob(db, job)
        await db.rpc('complete_job', { p_id: job.id, p_result: result })
        summary.done += 1
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/left pending|OAuth not available/.test(msg)) {
          // back to `pending` without counting a failure (m34 release_integration_job): "waiting for a Google connection" in the PM UI
          await db.rpc('release_integration_job', { p_id: job.id, p_note: 'waiting for a Google connection (OAuth not configured)' })
          summary.skipped += 1
        } else {
          await db.rpc('fail_job', { p_id: job.id, p_error: msg })
          summary.failed += 1
        }
      }
    }
  }
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } })
})
