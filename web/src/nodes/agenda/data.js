import { getAgendaDefinition, getAgendaLink } from '../../data/agenda.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import { resolveTimeZone, toInstant } from '../../lib/time/tz.js'
import { parseHHMM } from '../../lib/time/slots.js'
import { fromDayRow } from './agendaLogic.js'

/**
 * Output-port resolver of `schedule` (design 01 section 3.1 / 02 section 2.3 `schedule`): what Booking and Distribution
 * receive through useInputPort. One item per DAY: { id, kind: 'agenda_day', date: 'YYYY-MM-DD'|null, name{en,ar},
 * sortOrder, timezone, start: 'HH:MM'|null, end: 'HH:MM'|null (first start / last end of the day's sessions),
 * startsAt/endsAt (ISO instants in the project zone), slots: [{ id, start, end, startMinutes, endMinutes, startsAt, endsAt, title{en,ar} }] }.
 * Rows are read by reference, never copied; consumers keep `id` (= agenda_days.id, the FK distribution_days.agenda_day_id).
 * `timezone` travels with every item so a consumer never guesses the zone (08 decision 05-a).
 */
export async function resolveSchedule({ node, graph }) {
  const tz = resolveTimeZone(graph?.project?.timezone)
  const { days } = await getAgendaDefinition(node.id)
  const items = days.map((row, i) => {
    const d = fromDayRow(row, row.slots ?? [])
    const slots = d.slots
      .filter((s) => parseHHMM(s.start) !== null && parseHHMM(s.end) !== null)
      .map((s) => ({
        id: s.id, start: s.start, end: s.end, startMinutes: parseHHMM(s.start), endMinutes: parseHHMM(s.end), title: s.title,
        startsAt: d.date ? toInstant(d.date, s.start, tz)?.toISOString() ?? null : null,
        endsAt: d.date ? toInstant(d.date, s.end, tz)?.toISOString() ?? null : null,
      }))
    const start = slots.length ? slots.reduce((m, s) => (s.startMinutes < m.startMinutes ? s : m)).start : null
    const end = slots.length ? slots.reduce((m, s) => (s.endMinutes > m.endMinutes ? s : m)).end : null
    return {
      id: d.id, kind: 'agenda_day', date: d.date || null, name: d.name, sortOrder: row.sort_order ?? i + 1, timezone: tz,
      start, end,
      startsAt: d.date && start ? toInstant(d.date, start, tz)?.toISOString() ?? null : null,
      endsAt: d.date && end ? toInstant(d.date, end, tz)?.toISOString() ?? null : null,
      slots,
    }
  })
  return { items, timezone: tz }
}

/** Output-port resolver of `link`: the public URL of this agenda's own page (Landing page CTA, e-mails). */
export async function resolveLink({ node }) {
  const link = await getAgendaLink(node.id)
  if (!link?.slug) return { items: [] }
  return { items: [{ kind: 'agenda', url: buildPublicUrl('agenda', canonicalRef({ slug: link.slug, id: node.id })), label: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, nodeId: node.id }] }
}
