// Calendar event builders (design 07 section 2.2; decisions 07-6 and 07-10). PURE: no I/O.
//
//  * the event id is the booking uuid as 32 lowercase hex digits (Google accepts a-v and 0-9, 5-1024 chars; hex is a subset),
//    so an insert repeated by a retry or a second worker answers 409 and the caller ADOPTS the existing event (google-api.js);
//  * start / end carry an RFC 3339 offset computed in the PROJECT time zone AND `timeZone` = that IANA zone (DST-correct);
//  * `unique` Meet mode = conferenceData.createRequest (requestId = booking id) + conferenceDataVersion=1 on the URL;
//    `shared` mode = the node's link in `location` + `description`, NO hand-built conferenceData, and an EMPTY link is an
//    ERROR (never a silent fall back to unique: conflict C-3);
//  * attendees are derived from stored data only: lower-cased, de-duplicated, invalid addresses dropped WITH a reason.

import { isEmailAddress } from './google-core.js'

export class CalendarConfigError extends Error {
  constructor(code, field = null) {
    super(code)
    this.name = 'CalendarConfigError'
    this.code = code
    this.field = field
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_ID_RE = /^[a-v0-9]{5,1024}$/

/** booking uuid -> the 32 hex characters (lower case, no dashes). */
export function eventIdFromBookingId(bookingId) {
  if (typeof bookingId !== 'string' || !UUID_RE.test(bookingId)) throw new CalendarConfigError('invalid_booking_id', 'bookingId')
  return bookingId.replace(/-/g, '').toLowerCase()
}
export const isValidEventId = (id) => typeof id === 'string' && EVENT_ID_RE.test(id)

// ------------------------------------------------------------------------------------------------ time zones
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const dtfCache = new Map()
function dtf(tz) {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    dtfCache.set(tz, f)
  }
  return f
}

/** Wall-clock fields of an instant in a zone. */
export function wallClockParts(ms, tz) {
  const p = {}
  for (const part of dtf(tz).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return p
}

/** UTC offset (minutes, east positive) of a zone at an instant. */
export function offsetMinutesAt(ms, tz) {
  const p = wallClockParts(ms, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
}

/** "2026-07-15T13:00:00+03:00": the instant written in the zone's own offset (what Google wants next to `timeZone`). */
export function formatRfc3339InZone(instant, tz) {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(instant)
  if (!Number.isFinite(ms)) throw new CalendarConfigError('invalid_time', 'instant')
  if (!isValidTimeZone(tz)) throw new CalendarConfigError('invalid_timezone', 'timeZone')
  const p = wallClockParts(ms, tz)
  const off = offsetMinutesAt(ms, tz)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const sign = off < 0 ? '-' : '+'
  const a = Math.abs(off)
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour === 24 ? 0 : p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
}

// ------------------------------------------------------------------------------------------------ attendees
/**
 * sources: { booker, provider, cc: [..], admin: [..] } (strings or arrays; comma / semicolon separated strings are split).
 * -> { attendees: [{ email }], dropped: [{ email, reason: 'invalid' | 'duplicate' | 'limit' }] }  (organizer excluded when given)
 */
export function deriveAttendees({ booker = null, provider = null, cc = [], admin = [] } = {}, { organizerEmail = null, limit = 50 } = {}) {
  const flat = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[;,\n]/) : v ? [v] : [])
  const raw = [...flat(booker), ...flat(provider), ...flat(cc), ...flat(admin)]
  const seen = new Set(organizerEmail ? [String(organizerEmail).toLowerCase()] : [])
  const attendees = []
  const dropped = []
  for (const r of raw) {
    const e = String(r ?? '').trim().toLowerCase()
    if (!e) continue
    if (!isEmailAddress(e)) { dropped.push({ email: e.slice(0, 80), reason: 'invalid' }); continue }
    if (seen.has(e)) { dropped.push({ email: e, reason: 'duplicate' }); continue }
    if (attendees.length >= limit) { dropped.push({ email: e, reason: 'limit' }); continue }
    seen.add(e)
    attendees.push({ email: e })
  }
  return { attendees, dropped }
}

// ------------------------------------------------------------------------------------------------ event bodies
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max)

/** The shared Meet link: an https URL, else a hard configuration error (never an implicit switch to `unique`). */
export function requireSharedLink(link) {
  const s = String(link ?? '').trim()
  if (!s) throw new CalendarConfigError('shared_link_required', 'sharedLink')
  let u
  try { u = new URL(s) } catch { throw new CalendarConfigError('shared_link_invalid', 'sharedLink') }
  if (u.protocol !== 'https:') throw new CalendarConfigError('shared_link_invalid', 'sharedLink')
  return u.toString()
}

/**
 * Body + query of `events.insert`.
 *   bookingId, summary, description, startsAt / endsAt (ISO instants), timeZone (project IANA zone),
 *   attendees [{email}], meetMode 'unique' | 'shared', sharedLink, sendUpdates (default 'all')
 * -> { id, event, query: { conferenceDataVersion: 0|1, sendUpdates } }
 */
export function buildEventInsert({ bookingId, summary, description = '', startsAt, endsAt, timeZone, attendees = [], meetMode = 'unique', sharedLink = null, sendUpdates = 'all' }) {
  const id = eventIdFromBookingId(bookingId)
  if (!['unique', 'shared'].includes(meetMode)) throw new CalendarConfigError('invalid_meet_mode', 'meetMode')
  const startMs = Date.parse(startsAt)
  const endMs = Date.parse(endsAt)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new CalendarConfigError('invalid_time', 'startsAt')
  if (!isValidTimeZone(timeZone)) throw new CalendarConfigError('invalid_timezone', 'timeZone')
  const event = {
    id,
    summary: cleanText(summary, 250) || 'Athar session',
    description: cleanText(description, 4000),
    start: { dateTime: formatRfc3339InZone(startMs, timeZone), timeZone },
    end: { dateTime: formatRfc3339InZone(endMs, timeZone), timeZone },
    attendees: attendees.map((a) => ({ email: a.email })),
    guestsCanModify: false,
    guestsCanInviteOthers: false,
  }
  if (meetMode === 'shared') {
    const link = requireSharedLink(sharedLink)
    event.location = link
    event.description = event.description ? `${event.description}\n\n${link}` : link
  } else {
    event.conferenceData = { createRequest: { requestId: bookingId.toLowerCase(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }
  return { id, event, query: { conferenceDataVersion: meetMode === 'unique' ? 1 : 0, sendUpdates } }
}

/** Body + query of `events.patch` for a reschedule / attendee change (the Meet link and the event id never change). */
export function buildEventPatch({ startsAt = null, endsAt = null, timeZone = null, attendees = null, summary = null, sendUpdates = 'all' } = {}) {
  const event = {}
  if (startsAt !== null || endsAt !== null) {
    if (startsAt === null || endsAt === null) throw new CalendarConfigError('invalid_time', 'startsAt')
    const s = Date.parse(startsAt)
    const e = Date.parse(endsAt)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw new CalendarConfigError('invalid_time', 'startsAt')
    if (!isValidTimeZone(timeZone)) throw new CalendarConfigError('invalid_timezone', 'timeZone')
    event.start = { dateTime: formatRfc3339InZone(s, timeZone), timeZone }
    event.end = { dateTime: formatRfc3339InZone(e, timeZone), timeZone }
  }
  if (attendees !== null) event.attendees = attendees.map((a) => ({ email: a.email }))
  if (summary !== null) event.summary = cleanText(summary, 250)
  return { event, query: { sendUpdates } }
}

// ------------------------------------------------------------------------------------------------ reading an event back
/** The Meet URL of an event: `hangoutLink`, else the `video` entry point. null while it is not ready. */
export function extractMeetLink(event) {
  if (typeof event?.hangoutLink === 'string' && event.hangoutLink) return event.hangoutLink
  const ep = event?.conferenceData?.entryPoints
  if (Array.isArray(ep)) {
    const v = ep.find((e) => e?.entryPointType === 'video' && typeof e.uri === 'string')
    if (v) return v.uri
  }
  return null
}

/** 'success' | 'pending' | 'failure' | 'none' (no conference requested / not reported). */
export function conferenceStatus(event) {
  const code = event?.conferenceData?.createRequest?.status?.statusCode
  if (code === 'success' || code === 'pending' || code === 'failure') return code
  return extractMeetLink(event) ? 'success' : 'none'
}
