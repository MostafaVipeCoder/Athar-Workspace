/**
 * Slot math (design 06 section 6.3 `time/slots.js`). Replaces the duplicated as-is logic listed in docs/05 section 6:
 * DUP-1/2 (notice options + window), DUP-11/12 (defaults), DUP-13 (HH:MM helpers x3), DUP-14 (two `calculateDaySlotTimes`),
 * DUP-15 (12-hour formatter x3), DUP-16 (current slot x3), DUP-17 (seconds until end x3), DUP-18 (per-day config).
 * Everything here works on MINUTES OF DAY (wall clock in the project zone); instants come from `tz.js`.
 */

/** Advance-notice presets in minutes (DUP-1). Labels are translated by the UI (`slots.notice.<value>`). */
export const ADVANCE_NOTICE_OPTIONS = [0, 30, 60, 120, 360, 720, 1440, 2880]

/** Defaults (DUP-11/12): notice 24 h; slot 30 min, gap 5 min, 1 seat. */
export const DEFAULTS = Object.freeze({ noticeMinutes: 1440, slotMinutes: 30, gapMinutes: 5, seats: 1 })

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

/** 'HH:MM' -> minutes since midnight; null when malformed (callers decide; the old code silently returned 0). */
export function parseHHMM(value) {
  const m = TIME_RE.exec(String(value ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

/** minutes since midnight -> 'HH:MM' (wraps past 24 h like the as-is helpers, so 1500 -> '01:00'). */
export function formatHHMM(totalMinutes) {
  const t = Math.round(Number(totalMinutes) || 0)
  const norm = ((t % 1440) + 1440) % 1440
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`
}

/** 'HH:MM' or minutes -> 12-hour text; Arabic uses ص/م (DUP-15). */
export function to12h(value, lang = 'en') {
  const minutes = typeof value === 'number' ? value : parseHHMM(value)
  if (minutes === null || minutes === undefined) return ''
  const norm = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(norm / 60)
  const m = norm % 60
  const pm = h >= 12
  const h12 = h % 12 || 12
  const suffix = lang === 'ar' ? (pm ? 'م' : 'ص') : pm ? 'PM' : 'AM'
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/**
 * Slots between two wall-clock times (DUP-14, unified): returns [{ index, startMinutes, endMinutes, start, end }].
 * Only whole slots that fit before `end` are produced; `gapMinutes` is inserted BETWEEN slots (01-7: per-day gap only).
 */
export function slotsBetween(start, end, slotMinutes = DEFAULTS.slotMinutes, gapMinutes = 0) {
  const s = typeof start === 'number' ? start : parseHHMM(start)
  const e = typeof end === 'number' ? end : parseHHMM(end)
  const dur = Number(slotMinutes)
  const gap = Math.max(0, Number(gapMinutes) || 0)
  if (s === null || e === null || !(dur > 0) || e <= s) return []
  const out = []
  let cursor = s
  while (cursor + dur <= e) {
    out.push({ index: out.length, startMinutes: cursor, endMinutes: cursor + dur, start: formatHHMM(cursor), end: formatHHMM(cursor + dur) })
    cursor += dur + gap
  }
  return out
}

/** Distribution variant: a fixed COUNT of slots from a start time (DUP-14 second signature). */
export function slotsFrom(start, count, slotMinutes = DEFAULTS.slotMinutes, gapMinutes = 0) {
  const s = typeof start === 'number' ? start : parseHHMM(start)
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const dur = Number(slotMinutes)
  if (s === null || !(dur > 0)) return []
  const gap = Math.max(0, Number(gapMinutes) || 0)
  return Array.from({ length: n }, (_, i) => {
    const startMinutes = s + i * (dur + gap)
    return { index: i, startMinutes, endMinutes: startMinutes + dur, start: formatHHMM(startMinutes), end: formatHHMM(startMinutes + dur) }
  })
}

/** Total round = slots + gaps (01-7). */
export function roundMinutes(count, slotMinutes = DEFAULTS.slotMinutes, gapMinutes = 0) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n === 0) return 0
  return n * Number(slotMinutes) + (n - 1) * Math.max(0, Number(gapMinutes) || 0)
}

/** How many slots fit in a round (as-is `calcSlotsPerDay`, now gap-aware). */
export function slotsPerRound(totalMinutes, slotMinutes = DEFAULTS.slotMinutes, gapMinutes = 0) {
  const total = Number(totalMinutes)
  const dur = Number(slotMinutes)
  if (!(total > 0) || !(dur > 0)) return 0
  const gap = Math.max(0, Number(gapMinutes) || 0)
  return Math.max(0, Math.floor((total + gap) / (dur + gap)))
}

/** True when the slot starts in less than the required notice (DUP-2). `now` and `slotStart` are instants. */
export function isWithinNotice(slotStart, noticeMinutes = DEFAULTS.noticeMinutes, now = new Date()) {
  if (!slotStart) return false
  const start = slotStart instanceof Date ? slotStart.getTime() : new Date(slotStart).getTime()
  if (Number.isNaN(start)) return false
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const notice = noticeMinutes === null || noticeMinutes === undefined ? DEFAULTS.noticeMinutes : Number(noticeMinutes)
  return start - nowMs < notice * 60000
}

/** Index of the slot containing `minutesOfDay` (from tz.minutesOfDayInTz), or null (DUP-16). */
export function currentSlotIndex(slots, minutesOfDay) {
  if (!Array.isArray(slots) || minutesOfDay === null || minutesOfDay === undefined) return null
  const i = slots.findIndex((s) => minutesOfDay >= s.startMinutes && minutesOfDay < s.endMinutes)
  return i === -1 ? null : i
}

/** Seconds until the slot ends given `secondsOfDay` (from tz.secondsOfDayInTz) (DUP-17). */
export function secondsUntilSlotEnd(slot, secondsOfDay) {
  if (!slot || secondsOfDay === null || secondsOfDay === undefined) return null
  return Math.max(0, slot.endMinutes * 60 - secondsOfDay)
}

/**
 * Per-day effective config (DUP-18): a day may override any of the global keys; `mentorIds` on the day restricts the
 * global availability list. Returns a plain object with the resolved keys.
 */
export function resolveDayConfig(global = {}, day = {}) {
  const g = global ?? {}
  const d = day ?? {}
  const pickNum = (k, fallback) => {
    const v = d[k] ?? g[k]
    return v === null || v === undefined || v === '' ? fallback : Number(v)
  }
  const start = d.start ?? g.start ?? '09:00'
  const slotMinutes = pickNum('slotMinutes', DEFAULTS.slotMinutes)
  const gapMinutes = pickNum('gapMinutes', 0)
  const count = d.count ?? g.count
  const resolvedCount = count === null || count === undefined || count === '' ? (d.end ?? g.end ? slotsBetween(start, d.end ?? g.end, slotMinutes, gapMinutes).length : 0) : Number(count)
  const mentorIds = Array.isArray(d.mentorIds) ? d.mentorIds : Array.isArray(g.mentorIds) ? g.mentorIds : null
  return { start, slotMinutes, gapMinutes, count: resolvedCount, mentorIds, locked: Boolean(d.locked) }
}
