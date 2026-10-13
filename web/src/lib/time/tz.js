/**
 * Timezone helpers (design 06 section 6.3 `time/tz.js`): ONE explicit IANA timezone per project (08 decision 07-10, 05-a).
 * Rule: store `timestamptz` (UTC); construct and display wall-clock values ONLY through these helpers.
 * Never `new Date('YYYY-MM-DD')` (UTC midnight) nor `new Date(date + 'T00:00:00')` (browser-local midnight): that pair
 * produced CON-1/CON-3/CON-10/CON-11 in the old app. Pure `Intl`, no library.
 */
import { DEFAULT_TIMEZONE } from '../constants.js'

export { DEFAULT_TIMEZONE }

const tzCache = new Map()

/** True when the runtime knows the IANA zone (the DB validates against pg_timezone_names on write). */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false
  if (tzCache.has(tz)) return tzCache.get(tz)
  let ok = false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    ok = true
  } catch {
    ok = false
  }
  tzCache.set(tz, ok)
  return ok
}

/** The project zone, or the default when missing/invalid (never the browser zone silently). */
export function resolveTimeZone(tz) {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE
}

/** All IANA zones the runtime knows (for the Project Details picker); falls back to a short list. */
export function listTimeZones() {
  try {
    const all = Intl.supportedValuesOf?.('timeZone')
    if (Array.isArray(all) && all.length) return all
  } catch {
    /* older runtime */
  }
  return [DEFAULT_TIMEZONE, 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'UTC']
}

const partsFormatterCache = new Map()
function partsFormatter(tz) {
  if (!partsFormatterCache.has(tz)) {
    partsFormatterCache.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
    )
  }
  return partsFormatterCache.get(tz)
}

/** Wall-clock parts of an instant in `tz`: { year, month (1-12), day, hour (0-23), minute, second, weekday (0=Sun) }. */
export function wallClock(instant, tz = DEFAULT_TIMEZONE) {
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) return null
  const zone = resolveTimeZone(tz)
  const map = {}
  for (const p of partsFormatter(zone).formatToParts(d)) if (p.type !== 'literal') map[p.type] = Number(p.value)
  const hour = map.hour === 24 ? 0 : map.hour
  const utcMidday = Date.UTC(map.year, map.month - 1, map.day, 12)
  return { year: map.year, month: map.month, day: map.day, hour, minute: map.minute, second: map.second, weekday: new Date(utcMidday).getUTCDay() }
}

/** Offset of `tz` from UTC at `instant`, in minutes (Cairo in summer = +180). */
export function offsetMinutes(instant, tz = DEFAULT_TIMEZONE) {
  const w = wallClock(instant, tz)
  if (!w) return 0
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime()
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

/**
 * The instant at which the wall clock in `tz` shows `dateStr` `timeStr` ('YYYY-MM-DD', 'HH:MM[:SS]').
 * Handles DST by iterating the offset twice. Returns null for invalid input.
 */
export function toInstant(dateStr, timeStr = '00:00', tz = DEFAULT_TIMEZONE) {
  const dm = DATE_RE.exec(String(dateStr ?? '').trim())
  const tm = TIME_RE.exec(String(timeStr ?? '00:00').trim())
  if (!dm || !tm) return null
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])]
  const [h, mi, s] = [Number(tm[1]), Number(tm[2]), Number(tm[3] ?? 0)]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  const zone = resolveTimeZone(tz)
  const naive = Date.UTC(y, mo - 1, d, h, mi, s)
  let guess = naive - offsetMinutes(new Date(naive), zone) * 60000
  guess = naive - offsetMinutes(new Date(guess), zone) * 60000
  return new Date(guess)
}

const pad = (n) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' of an instant in `tz`. */
export function dateInTz(instant, tz = DEFAULT_TIMEZONE) {
  const w = wallClock(instant, tz)
  return w ? `${w.year}-${pad(w.month)}-${pad(w.day)}` : ''
}

/** 'HH:MM' (24 h) of an instant in `tz`. */
export function timeInTz(instant, tz = DEFAULT_TIMEZONE) {
  const w = wallClock(instant, tz)
  return w ? `${pad(w.hour)}:${pad(w.minute)}` : ''
}

/** Today's date in the project zone (fixes CON-10: "today" was taken from the UTC calendar). */
export function todayInTz(tz = DEFAULT_TIMEZONE, now = new Date()) {
  return dateInTz(now, tz)
}

/** Minutes since midnight of the wall clock in `tz` (used by the live slot pointer). */
export function minutesOfDayInTz(instant, tz = DEFAULT_TIMEZONE) {
  const w = wallClock(instant, tz)
  return w ? w.hour * 60 + w.minute : null
}

/** Seconds since midnight of the wall clock in `tz`. */
export function secondsOfDayInTz(instant, tz = DEFAULT_TIMEZONE) {
  const w = wallClock(instant, tz)
  return w ? w.hour * 3600 + w.minute * 60 + w.second : null
}

/** Locale used for all date formatting (Western digits in Arabic, OD-12). */
export const dateLocale = (lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')

/** Format an instant in `tz` for language `lang` with Intl options (default: medium date + short time). */
export function formatInTz(instant, tz = DEFAULT_TIMEZONE, lang = 'en', opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (instant === null || instant === undefined || instant === '') return ''
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(dateLocale(lang), { ...opts, timeZone: resolveTimeZone(tz) }).format(d)
}

/** Short human label of a zone, e.g. "Africa/Cairo (GMT+3)". */
export function describeTimeZone(tz, lang = 'en', now = new Date()) {
  const zone = resolveTimeZone(tz)
  const off = offsetMinutes(now, zone)
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const label = `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ''}`
  const name = lang === 'ar' ? zone : zone.replace(/_/g, ' ')
  return `${name} (${label})`
}
