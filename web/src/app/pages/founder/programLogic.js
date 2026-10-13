import { parseHHMM } from '../../../lib/time/slots.js'
import { minutesOfDayInTz, todayInTz, resolveTimeZone } from '../../../lib/time/tz.js'
import { publicDays } from '../../../nodes/agenda/agendaLogic.js'

/** Participant status -> Badge tone (accepted = blue, attended = green, withdrawn = red). Unknown -> neutral. */
export const STATUS_TONE = { accepted: 'blue', attended: 'green', withdrawn: 'red' }
export const statusTone = (status) => STATUS_TONE[status] ?? 'neutral'

/** Cards of the Programs list: withdrawn ones are kept apart (hidden by default, 02-7; status-only card, 03-6). */
export function splitPrograms(list) {
  const rows = Array.isArray(list) ? list : []
  return { active: rows.filter((p) => p.status !== 'withdrawn'), withdrawn: rows.filter((p) => p.status === 'withdrawn') }
}

/** Only http(s) map links are ever rendered as links (the DB CHECK enforces it too). */
export const safeMapUrl = (url) => (typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : null)

/**
 * The blocks the page renders: the server order is kept, a block type the client does not know is ignored (forward compatible),
 * and every block gets a stable DOM key / anchor (type + node id when the block belongs to one node, else type).
 */
export function visibleBlocks(blocks, known) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && typeof b.type === 'string' && known(b.type))
    .map((b) => ({ ...b, key: b.node_id ? `${b.type}-${b.node_id}` : b.type }))
}

const text = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * "Next up" for the Agenda block from the agenda days payload (`get_founder_block(... 'agenda')` -> `data.days`).
 * Wall-clock times are in the PROJECT zone (never the browser's). Returns
 *   { kind: 'now', day, slot }       a session is running now
 *   { kind: 'next', day, slot }      the next session today
 *   { kind: 'upcoming', day, slot }  the first session of the next dated day
 *   null                             nothing left (or no dated days)
 * Days without a date are never placed on the clock (as the agenda tab).
 */
export function nextUp(rawDays, timezone, now = new Date()) {
  const tz = resolveTimeZone(timezone)
  const days = publicDays(rawDays).filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date))
  if (!days.length) return null
  const today = todayInTz(tz, now)
  const minutes = minutesOfDayInTz(now, tz)
  const timed = (d) => d.slots.filter((s) => parseHHMM(s.start) !== null).sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start))
  const todayDay = days.find((d) => d.date === today)
  if (todayDay) {
    const slots = timed(todayDay)
    const running = slots.find((s) => parseHHMM(s.end) !== null && minutes >= parseHHMM(s.start) && minutes < parseHHMM(s.end))
    if (running) return { kind: 'now', day: todayDay, slot: running }
    const upcoming = slots.find((s) => parseHHMM(s.start) > minutes)
    if (upcoming) return { kind: 'next', day: todayDay, slot: upcoming }
  }
  for (const d of days) {
    if (d.date <= today) continue
    const first = timed(d)[0]
    if (first) return { kind: 'upcoming', day: d, slot: first }
  }
  return null
}

/** Short bilingual title of a session (agenda rows carry {en,ar}). */
export const slotTitle = (slot, lang) => (lang === 'ar' ? text(slot?.title?.ar) || text(slot?.title?.en) : text(slot?.title?.en) || text(slot?.title?.ar))
