/**
 * Language-driven date/time formatting (design 06 section 6.3 `time/format.js`). Thin wrappers over tz.js so that every
 * page formats through the same locale rule (Western digits in Arabic) and the project zone.
 */
import { formatInTz, dateLocale, resolveTimeZone, DEFAULT_TIMEZONE } from './tz.js'

export function formatDate(instant, { lang = 'en', tz = DEFAULT_TIMEZONE, style = 'medium' } = {}) {
  return formatInTz(instant, tz, lang, { dateStyle: style })
}

export function formatTime(instant, { lang = 'en', tz = DEFAULT_TIMEZONE } = {}) {
  return formatInTz(instant, tz, lang, { timeStyle: 'short' })
}

export function formatDateTime(instant, { lang = 'en', tz = DEFAULT_TIMEZONE, dateStyle = 'medium', timeStyle = 'short' } = {}) {
  return formatInTz(instant, tz, lang, { dateStyle, timeStyle })
}

/** 'YYYY-MM-DD' (a calendar date, no zone) -> localised date text. Never goes through `new Date(dateStr)`. */
export function formatCalendarDate(dateStr, { lang = 'en', style = 'medium' } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? '').trim())
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return new Intl.DateTimeFormat(dateLocale(lang), { dateStyle: style, timeZone: 'UTC' }).format(d)
}

/** Relative "x minutes ago / in x days" using Intl.RelativeTimeFormat. */
export function formatRelative(instant, { lang = 'en', now = new Date() } = {}) {
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) return ''
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(dateLocale(lang), { numeric: 'auto' })
  if (abs < 60) return rtf.format(diffSec, 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  return rtf.format(Math.round(diffSec / 86400), 'day')
}

export { resolveTimeZone }
