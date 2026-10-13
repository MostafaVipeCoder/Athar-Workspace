import { biPick } from '../../lib/entities.js'
import { firstName } from '../../lib/contact.js'
import { normalizeEmailTemplate, validateEmailTemplate } from '../../lib/email.js'
import { ADVANCE_NOTICE_OPTIONS, DEFAULTS, parseHHMM, slotsBetween } from '../../lib/time/slots.js'
import { dateInTz, resolveTimeZone, timeInTz, toInstant } from '../../lib/time/tz.js'

/**
 * Pure helpers of the Booking node (design 01 section 6.3 trimmed to what the DB honours, 04 section 3.9).
 * The node's own facts: `booking_settings` (mode, default notice, Meet mode + shared link, organizer connection: saved as
 * `children.settings` through save_node), `booking_providers` (list-item references + overlay), `booking_slots`,
 * `bookings`. `nodes.config` holds what is below:
 * {
 *   page: { title:{en,ar}, intro:{en,ar} },                        // texts of the public page
 *   rules: { max_bookings_per_email: null|int },                   // read by create_booking (mentor mode)
 *   slotDefaults: { durationMin, gapMin, from, to },               // the generator's defaults (01-7: lib/time/slots)
 *   emails: { booking_confirmation|booking_cancellation: { enabled, subject, body_html, subject_ar, body_html_ar, cc[], admin[] } },
 * }
 * Migrated nodes have `{}` or `emails.booking_confirmation.{cc,admin}` only (the as-is admin/cc lists).
 */
export const MODES = ['mentor', 'interview']
export const MEET_MODES = ['unique', 'shared']
export const EMAIL_KEYS = ['booking_confirmation', 'booking_cancellation']
export const NOTICE_OPTIONS = ADVANCE_NOTICE_OPTIONS
export { DEFAULTS as SLOT_DEFAULTS }

/** The 07 section 1.5 booking placeholders (= app_private.booking_vars). `cancel_link` exists in the confirmation only. */
export const PLACEHOLDERS = ['provider_name', 'booker_name', 'first_name', 'company_name', 'booker_email', 'start_time', 'end_time', 'date', 'timezone', 'meet_link', 'cancel_link', 'project_name', 'program_name']
export const PLACEHOLDERS_BY_KEY = {
  booking_confirmation: PLACEHOLDERS,
  booking_cancellation: PLACEHOLDERS.filter((p) => p !== 'cancel_link' && p !== 'meet_link'),
}

/** MUST stay identical to app_private.booking_default_template (m34): the server falls back to it. */
export const DEFAULT_TEMPLATES = () => ({
  booking_confirmation: {
    enabled: true,
    subject: 'Your session with {{provider_name}} is confirmed',
    body_html: 'Dear {{booker_name}},\n\nYour session with {{provider_name}} is confirmed.\n\nWhen: {{start_time}} - {{end_time}} ({{timezone}})\nMeeting link: {{meet_link}}\n\nNeed to cancel? {{cancel_link}}\n\nBest regards,\nThe {{project_name}} team',
    subject_ar: 'تأكيد حجزك مع {{provider_name}}',
    body_html_ar: 'عزيزي {{booker_name}}،\n\nتم تأكيد جلستك مع {{provider_name}}.\n\nالموعد: {{start_time}} - {{end_time}} ({{timezone}})\nرابط الاجتماع: {{meet_link}}\n\nلإلغاء الحجز: {{cancel_link}}\n\nمع أطيب التحيات،\nفريق {{project_name}}',
    cc: [], admin: [],
  },
  booking_cancellation: {
    enabled: true,
    subject: 'Your session with {{provider_name}} was cancelled',
    body_html: 'Dear {{booker_name}},\n\nYour session with {{provider_name}} scheduled for {{start_time}} ({{timezone}}) has been cancelled.\n\nYou are welcome to book another slot from the booking page.\n\nBest regards,\nThe {{project_name}} team',
    subject_ar: 'تم إلغاء جلستك مع {{provider_name}}',
    body_html_ar: 'عزيزي {{booker_name}}،\n\nتم إلغاء جلستك مع {{provider_name}} التي كانت مقررة في {{start_time}} ({{timezone}}).\n\nيمكنك حجز موعد آخر من صفحة الحجز.\n\nمع أطيب التحيات،\nفريق {{project_name}}',
    cc: [], admin: [],
  },
})

export const defaultBookingConfig = () => ({
  page: { title: { en: '', ar: '' }, intro: { en: '', ar: '' } },
  rules: { max_bookings_per_email: null },
  slotDefaults: { durationMin: DEFAULTS.slotMinutes, gapMin: DEFAULTS.gapMinutes, from: '10:00', to: '13:00' },
  emails: DEFAULT_TEMPLATES(),
})

const text = (v) => (v === null || v === undefined ? '' : String(v))
const bi = (v) => ({ en: text(v?.en), ar: text(v?.ar) })
const posInt = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback }
const nonNegInt = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback }

/** Tolerant read of a stored config; unknown keys are kept. */
export function normalizeBookingConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const d = defaultBookingConfig()
  const sd = c.slotDefaults && typeof c.slotDefaults === 'object' ? c.slotDefaults : {}
  const max = c.rules?.max_bookings_per_email
  const defaults = DEFAULT_TEMPLATES()
  return {
    ...c,
    page: { title: bi(c.page?.title), intro: bi(c.page?.intro) },
    rules: { max_bookings_per_email: max === null || max === undefined || max === '' ? null : posInt(max, null) },
    slotDefaults: {
      durationMin: posInt(sd.durationMin, d.slotDefaults.durationMin),
      gapMin: nonNegInt(sd.gapMin, d.slotDefaults.gapMin),
      from: parseHHMM(sd.from) !== null ? sd.from : d.slotDefaults.from,
      to: parseHHMM(sd.to) !== null ? sd.to : d.slotDefaults.to,
    },
    emails: Object.fromEntries(EMAIL_KEYS.map((k) => [k, normalizeEmailTemplate(c.emails?.[k], defaults[k])])),
  }
}

/** Settings draft validation: { field: messageKey }. `settings` = the booking_settings draft. */
export function validateBookingConfig(config, settings = {}) {
  const errors = {}
  if (settings.meeting_link_mode === 'shared' && !String(settings.shared_meet_link ?? '').trim()) errors.shared_meet_link = 'booking.settings.sharedLinkRequired'
  else if (settings.shared_meet_link && !/^https?:\/\/\S+$/i.test(String(settings.shared_meet_link).trim())) errors.shared_meet_link = 'booking.settings.sharedLinkInvalid'
  if (settings.default_advance_notice_min !== undefined && !(Number(settings.default_advance_notice_min) >= 0)) errors.default_advance_notice_min = 'booking.settings.noticeInvalid'
  if (config.rules?.max_bookings_per_email !== null && config.rules?.max_bookings_per_email !== undefined && !(Number(config.rules.max_bookings_per_email) > 0)) errors.max_bookings_per_email = 'booking.settings.maxInvalid'
  for (const k of EMAIL_KEYS) {
    const err = validateEmailTemplate(config.emails?.[k], PLACEHOLDERS_BY_KEY[k])
    if (err) errors[`emails.${k}`] = `booking.emails.${err}`
  }
  if (!(config.slotDefaults.durationMin > 0)) errors.durationMin = 'booking.slots.durationInvalid'
  return errors
}

// ------------------------------------------------------------------ slots (wall clock in the PROJECT zone -> instants)
/**
 * Plan the slots of ONE day: `from`/`to` are 'HH:MM' wall-clock values in `tz`, `date` is 'YYYY-MM-DD'.
 * Returns [{ start, end, startsAt, endsAt }] (HH:MM + ISO instants). Only whole slots that fit are produced (lib/time/slots).
 */
export function planSlots({ date, from, to, durationMin, gapMin = 0, tz }) {
  const zone = resolveTimeZone(tz)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return []
  return slotsBetween(from, to, durationMin, gapMin)
    .map((s) => ({ start: s.start, end: s.end, startsAt: toInstant(date, s.start, zone)?.toISOString() ?? null, endsAt: toInstant(date, s.end, zone)?.toISOString() ?? null }))
    .filter((s) => s.startsAt && s.endsAt)
}

/** True when [aStart, aEnd) and [bStart, bEnd) intersect (ISO strings or Dates). */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  const t = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime())
  return t(aStart) < t(bEnd) && t(bStart) < t(aEnd)
}

/** Splits a plan into the slots that can be created and the ones colliding with existing slots of the provider (client preview; the DB GiST guard decides). */
export function splitPlan(plan, existing = []) {
  const fresh = []
  const overlapping = []
  for (const s of plan) (existing.some((e) => overlaps(s.startsAt, s.endsAt, e.starts_at, e.ends_at)) ? overlapping : fresh).push(s)
  return { fresh, overlapping }
}

/** Groups slot rows by calendar day in `tz`: [{ date, slots: [...sorted] }], days ascending. */
export function groupByDay(slots = [], tz) {
  const zone = resolveTimeZone(tz)
  const map = new Map()
  for (const s of slots) {
    const d = dateInTz(s.starts_at ?? s.startsAt, zone)
    if (!map.has(d)) map.set(d, [])
    map.get(d).push(s)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, slots: list.sort((a, b) => String(a.starts_at ?? a.startsAt).localeCompare(String(b.starts_at ?? b.startsAt))) }))
}

/** 'HH:MM' of an instant in `tz` (one place so screens never format by hand). */
export const hhmm = (instant, tz) => timeInTz(instant, resolveTimeZone(tz))

/** The slot state for the admin table: 'booked' | 'blocked' | 'past' | 'free'. */
export function slotState(slot, bookingsBySlot, now = new Date()) {
  if (bookingsBySlot[slot.id]) return 'booked'
  if (slot.is_blocked) return 'blocked'
  if (new Date(slot.ends_at).getTime() <= now.getTime()) return 'past'
  return 'free'
}

/** { [slot_id]: confirmed booking } */
export function confirmedBySlot(bookings = []) {
  const out = {}
  for (const b of bookings) if (b.status === 'confirmed') out[b.slot_id] = b
  return out
}

// ------------------------------------------------------------------ calendar / e-mail state (design 07 section 2.2)
export const SYNC_STATES = ['synced', 'legacy', 'pending', 'waiting_connection', 'processing', 'failed', 'dead', 'cancelled', 'none']

/**
 * Calendar sync state of one booking from its integration_jobs rows (+ the usable Google connections):
 * { key, job } where key is one of SYNC_STATES. `waiting_connection` = a pending job with no connection to run on (the
 * OAuth work of design 07 has not shipped): it stays pending and the UI says so, never blocks the booking.
 */
export function syncState(booking, jobs = [], connections = []) {
  const own = jobs.filter((j) => j.booking_id === booking.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const last = own[own.length - 1] ?? null
  const hasConnection = connections.some((c) => c.status === 'active')
  if (booking.status === 'cancelled') {
    const cancel = own.filter((j) => j.kind === 'calendar_cancel').pop() ?? null
    if (!cancel) return { key: 'cancelled', job: null }
    if (cancel.status === 'done') return { key: 'cancelled', job: cancel }
    if (cancel.status === 'failed' || cancel.status === 'dead') return { key: cancel.status, job: cancel }
    return { key: hasConnection || cancel.connection_id ? 'pending' : 'waiting_connection', job: cancel }
  }
  if (!last) return { key: booking.legacy_calendar_event_id || booking.meet_link ? 'legacy' : 'none', job: null }
  if (last.status === 'done') return { key: 'synced', job: last }
  if (last.status === 'processing') return { key: 'processing', job: last }
  if (last.status === 'failed' || last.status === 'dead') return { key: last.status, job: last }
  return { key: hasConnection || last.connection_id ? 'pending' : 'waiting_connection', job: last }
}

/** Last outbox row per (booking, key): { [bookingId]: { [emailKey]: { count, last } } } */
export function emailIndex(rows = []) {
  const out = {}
  for (const r of rows) {
    if (!r.booking_id) continue
    const byKey = (out[r.booking_id] ??= {})
    const cur = byKey[r.email_key] ?? { count: 0, last: null }
    cur.count += 1
    if (!cur.last || String(r.created_at) >= String(cur.last.created_at)) cur.last = r
    byKey[r.email_key] = cur
  }
  return out
}

// ------------------------------------------------------------------ providers (list items + overlay)
/**
 * Merge the connected list's items (ListItemView[] from useInputPort('mentors')) with the node's provider rows.
 * Returns [{ item, provider|null, enabled, email, notice, missing }]; rows of providers whose list item is no longer in
 * the list come last as `orphan` (the migrated nodes have none, but a disconnected list leaves them visible).
 */
export function mergeProviders(items = [], providers = []) {
  const byItem = new Map(providers.map((p) => [p.list_item_id, p]))
  const out = items.map((item) => {
    const provider = item.itemId ? byItem.get(item.itemId) ?? null : null
    if (provider) byItem.delete(item.itemId)
    return { key: item.id, item, provider, enabled: Boolean(provider?.is_active), email: provider?.booking_email ?? item.contact?.email ?? item.entity?.email ?? '', notice: provider?.advance_notice_min ?? null, missing: Boolean(item.missing), orphan: false }
  })
  for (const p of byItem.values()) out.push({ key: `orphan:${p.id}`, item: null, provider: p, enabled: Boolean(p.is_active), email: p.booking_email ?? '', notice: p.advance_notice_min ?? null, missing: true, orphan: true })
  return out
}

/** Display name of a provider row for the admin screens (the list item's entity, else the provider id). */
export function providerName(row, lang) {
  if (row?.item) return biPick(row.item.entity.title, lang) || '-'
  return row?.provider?.id ? row.provider.id.slice(0, 8) : '-'
}

// ------------------------------------------------------------------ public page helpers
/** The browser's zone (the visitor's local time is shown next to the project time; 07 section 2.2 "UI nicety"). */
export function visitorTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { return null }
}

/** Provider of the public payload -> EntityView for EntityCard. */
export function providerEntity(p) {
  return {
    id: p.id, kind: 'expert',
    title: { en: text(p.name_en), ar: text(p.name_ar) }, subtitle: { en: text(p.title_en), ar: text(p.title_ar) },
    organization: { en: text(p.organization_en), ar: text(p.organization_ar) }, bio: { en: text(p.bio_en), ar: text(p.bio_ar) },
    imagePath: p.photo_path ?? null, links: [], email: null,
  }
}

/** Placeholder values of a sample booking for the template preview (mirrors app_private.booking_vars). */
export function sampleVars({ providerName: pn = 'Mentor Name', bookerName = 'Mona Fathy', company = 'Delta Farms', email = 'founder@example.com', tz = 'Africa/Cairo', projectName = '', programName = '', lang = 'en' } = {}) {
  return {
    provider_name: pn, booker_name: bookerName, first_name: firstName(bookerName), company_name: company, booker_email: email,
    start_time: lang === 'ar' ? '15/11/2026 10:00' : '15 Nov 2026, 10:00', end_time: '10:30', date: '2026-11-15', timezone: tz,
    meet_link: 'https://meet.google.com/abc-defg-hij', cancel_link: 'https://athareg.com/book/<slug>?cancel=<id>&token=<token>',
    project_name: projectName, program_name: programName,
  }
}

/** Excel columns of the bookings table (lib/export/xlsx descriptor). */
export function bookingColumns(t, lang, { tz, providerNames = {}, sync = {} }) {
  return [
    { key: (b) => b.booker_name ?? '', header: t('booking.col.booker') },
    { key: (b) => b.booker_email ?? '', header: t('booking.col.email') },
    { key: (b) => b.company ?? '', header: t('booking.col.company') },
    { key: (b) => providerNames[b.provider_id] ?? '', header: t('booking.col.provider') },
    { key: (b) => (b.starts_at ? `${dateInTz(b.starts_at, tz)} ${hhmm(b.starts_at, tz)}` : ''), header: `${t('booking.col.when')} (${tz})` },
    { key: (b) => (b.ends_at ? hhmm(b.ends_at, tz) : ''), header: t('booking.col.end') },
    { key: (b) => t(`booking.status.${b.status}`), header: t('booking.col.status') },
    { key: (b) => t(`booking.sync.${sync[b.id]?.key ?? 'none'}`), header: t('booking.col.sync') },
    { key: (b) => b.meet_link ?? '', header: t('booking.col.meet') },
    { key: (b) => b.created_at ?? '', header: t('booking.col.created') },
  ]
}
