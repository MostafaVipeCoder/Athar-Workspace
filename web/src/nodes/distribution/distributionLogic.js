/**
 * Pure logic of the Mentoring Distribution node (design 01 section 3.7, decisions 01-7 / 02-12): payload -> model, config + draft
 * (days, per-day mentors, mentor rules), generation input/output mapping (the algorithm itself is `matching.js`), validation of a
 * timetable, matrix building, the shared timer maths (server timestamps -> remaining seconds, no per-second writes), the clock-based
 * round used when no timer round is running, "who do I meet next" for a company, and the Excel sheets.
 * Everything wall-clock goes through `lib/time` with the PROJECT zone (as-is CON-10: "today" came from the UTC calendar).
 */
import { currentSlotIndex, formatHHMM, parseHHMM, roundMinutes, secondsUntilSlotEnd, slotsFrom, slotsPerRound } from '../../lib/time/slots.js'
import { minutesOfDayInTz, resolveTimeZone, secondsOfDayInTz, todayInTz, toInstant } from '../../lib/time/tz.js'

const text = (v) => (v === null || v === undefined ? '' : String(v))
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

// ---------------------------------------------------------------- node config (nodes.config)
export const TIMER_DEFAULTS = Object.freeze({ alertSeconds: 7, sounds: true })

/** Config shape: `timer { alertSeconds (1..30), sounds }`. Unknown keys are kept (forward compatibility). */
export function normalizeDistConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const t = c.timer && typeof c.timer === 'object' ? c.timer : {}
  const alert = Number(t.alertSeconds)
  return { ...c, timer: { alertSeconds: Number.isFinite(alert) ? clamp(Math.round(alert), 1, 30) : TIMER_DEFAULTS.alertSeconds, sounds: t.sounds === undefined ? TIMER_DEFAULTS.sounds : Boolean(t.sounds) } }
}
export const defaultDistributionConfig = () => ({ timer: { ...TIMER_DEFAULTS } })

// ---------------------------------------------------------------- payload -> model
const bi = (en, ar) => ({ en: text(en).trim(), ar: text(ar).trim() })

export function entityFromRow(r) {
  return { id: r.id, name: bi(r.name_en, r.name_ar), sub: bi(r.sub_en, r.sub_ar), image: r.image_path || null, room: text(r.room).trim(), missing: Boolean(r.missing) }
}
/** Display name in `lang`, falling back to the other language. */
export const nameOf = (e, lang = 'en') => (e ? e.name[lang] || e.name.en || e.name.ar || '' : '')

export function dayFromRow(r) {
  const slotMinutes = Number(r.slot_duration_min) || 20
  const gapMinutes = Number(r.gap_min) || 0
  const total = Number(r.total_round_min) || 0
  const start = text(r.start_time).slice(0, 5) || '09:00'
  return {
    id: r.id,
    index: Number(r.day_index) || 0,
    agendaDayId: r.agenda_day_id ?? null,
    date: r.date ?? null,
    name: bi(r.name_en, r.name_ar),
    start,
    startMinutes: parseHHMM(start) ?? 540,
    total,
    slotMinutes,
    gapMinutes,
    slots: r.slots ?? slotsPerRound(total, slotMinutes, gapMinutes),
    locked: Boolean(r.is_locked),
    mentorIds: Array.isArray(r.mentor_ids) ? r.mentor_ids : [],
    own: { start: r.own_start ?? null, slot: r.own_slot ?? null, gap: r.own_gap ?? null, date: r.own_date ?? null },
  }
}

/** DB payload (get_distribution_payload / get_distribution_view / get_public_tab data) -> client model. */
export function normalizePayload(p) {
  if (!p) return null
  const mentors = new Map((p.mentors ?? []).map((m) => [m.id, entityFromRow(m)]))
  const companies = new Map((p.companies ?? []).map((c) => [c.id, entityFromRow(c)]))
  const days = (p.days ?? []).map(dayFromRow).sort((a, b) => a.index - b.index)
  return {
    nodeId: p.node_id ?? null,
    revision: p.revision ?? 0,
    published: Boolean(p.published),
    name: bi(p.name_en, p.name_ar),
    project: { name: bi(p.project?.name_en, p.project?.name_ar), tz: resolveTimeZone(p.project?.timezone) },
    tz: resolveTimeZone(p.project?.timezone),
    config: { slotMinutes: p.config?.slot_duration_min ?? 20, gapMinutes: p.config?.gap_min ?? 0, start: text(p.config?.start_time).slice(0, 5) || '10:00', uniquePairing: p.config?.unique_pairing !== false, seed: p.config?.seed ?? null, ...normalizeDistConfig(p.config) },
    days,
    mentors,
    companies,
    sessions: (p.sessions ?? []).map((s) => ({ id: s.id ?? null, dayId: s.d, slot: Number(s.s), mentorId: s.m, companyId: s.c ?? null, manual: Boolean(s.manual) })),
    myCompanyIds: Array.isArray(p.my_company_ids) ? p.my_company_ids : [],
    viewer: p.viewer ?? null,
  }
}

// ---------------------------------------------------------------- times of a day
/** Slot list of a day: [{ index, startMinutes, endMinutes, start, end }] (gap between slots, 01-7). */
export const dayTimes = (day) => slotsFrom(day.startMinutes, day.slots, day.slotMinutes, day.gapMinutes)
/** End of the whole round in minutes of day (= start + slots + gaps). */
export const dayEndMinutes = (day) => day.startMinutes + roundMinutes(day.slots, day.slotMinutes, day.gapMinutes)
/** Mentors of a day sorted by display name in `lang`. */
export function sortedMentors(model, day, lang = 'en') {
  return [...day.mentorIds].sort((a, b) => nameOf(model.mentors.get(a), lang).localeCompare(nameOf(model.mentors.get(b), lang), lang) || a.localeCompare(b))
}
/** Index of the day to open first: today in the project zone, else the next dated day, else the first. */
export function defaultDayId(days, tz, now = new Date()) {
  if (!days.length) return null
  const today = todayInTz(tz, now)
  const hit = days.find((d) => d.date === today) ?? days.find((d) => d.date && d.date > today) ?? days[0]
  return hit.id
}

// ---------------------------------------------------------------- Edit: draft (settings + days + per-day mentors + rules)
export const DEFAULT_SETTINGS = Object.freeze({ slotMinutes: 20, gapMinutes: 5, start: '10:00', uniquePairing: true })

let keySeq = 0
export const newKey = () => `k${(keySeq += 1)}`

/** Rules rows (distribution_mentor_rules) -> { [mentorItemId]: { days, maxSlots, from, to, room } } (times 'HH:MM'). */
export function rulesFromRows(rows) {
  const out = {}
  for (const r of rows ?? []) {
    out[r.mentor_item_id] = {
      days: Array.isArray(r.days) ? r.days.map(Number) : null,
      maxSlots: r.max_slots ?? null,
      from: r.available_from ? text(r.available_from).slice(0, 5) : '',
      to: r.available_to ? text(r.available_to).slice(0, 5) : '',
      room: text(r.room),
    }
  }
  return out
}

export function draftFromModel(model, rulesRows) {
  return {
    settings: { slotMinutes: model.config.slotMinutes, gapMinutes: model.config.gapMinutes, start: model.config.start, uniquePairing: model.config.uniquePairing },
    days: model.days.map((d) => ({
      key: d.id, id: d.id, locked: d.locked, agendaDayId: d.agendaDayId, date: d.own.date ?? '', start: d.own.start ?? '', total: d.total || 0,
      slotMinutes: d.own.slot ?? null, gapMinutes: d.own.gap ?? null, mentorIds: [...d.mentorIds],
    })),
    rules: rulesFromRows(rulesRows),
  }
}

export function emptyDay(settings = DEFAULT_SETTINGS) {
  return { key: newKey(), id: null, locked: false, agendaDayId: null, date: '', start: settings.start, total: 120, slotMinutes: null, gapMinutes: null, mentorIds: [] }
}

/** Effective values of a draft day (own value over the node defaults). */
export function effectiveDay(day, settings) {
  const slotMinutes = day.slotMinutes ?? settings.slotMinutes
  const gapMinutes = day.gapMinutes ?? settings.gapMinutes
  const start = day.start || settings.start
  const startMinutes = parseHHMM(start) ?? 0
  const slots = slotsPerRound(day.total, slotMinutes, gapMinutes)
  return { slotMinutes, gapMinutes, start, startMinutes, slots, endMinutes: startMinutes + roundMinutes(slots, slotMinutes, gapMinutes), total: day.total }
}
/** "End time" field -> total round minutes (the as-is End Time override changed nothing, CON-8: now it sets the round). */
export function totalFromEnd(start, end) {
  const s = parseHHMM(start)
  const e = parseHHMM(end)
  return s === null || e === null || e <= s ? 0 : e - s
}
/** A window taken from an agenda session (the connected schedule): start + total. */
export function windowFromAgendaSlot(slot) {
  return { start: slot.start, total: Math.max(0, slot.endMinutes - slot.startMinutes) }
}

/** The agenda session that most likely holds the mentoring rounds (title mentions mentor/mentoring/منتور), else the first one: the window a new day starts from. */
export function pickMentoringSlot(slots) {
  const list = slots ?? []
  return list.find((s) => /mentor|منتور/i.test(`${s.title?.en ?? ''} ${s.title?.ar ?? ''}`)) ?? list[0] ?? null
}

/** Errors of a draft keyed by field path (values are i18n keys without the namespace). */
export function validateDraft(draft) {
  const errors = {}
  const s = draft.settings
  if (!(Number(s.slotMinutes) >= 1 && Number(s.slotMinutes) <= 600)) errors['settings.slotMinutes'] = 'err.slot'
  if (!(Number(s.gapMinutes) >= 0 && Number(s.gapMinutes) <= 240)) errors['settings.gapMinutes'] = 'err.gap'
  if (parseHHMM(s.start) === null) errors['settings.start'] = 'err.start'
  draft.days.forEach((d, i) => {
    if (d.locked) return
    if (d.start && parseHHMM(d.start) === null) errors[`days.${i}.start`] = 'err.start'
    if (!(Number(d.total) >= 0 && Number(d.total) <= 1440)) errors[`days.${i}.total`] = 'err.total'
    if (d.slotMinutes !== null && !(Number(d.slotMinutes) >= 1 && Number(d.slotMinutes) <= 600)) errors[`days.${i}.slotMinutes`] = 'err.slot'
    if (d.gapMinutes !== null && !(Number(d.gapMinutes) >= 0 && Number(d.gapMinutes) <= 240)) errors[`days.${i}.gapMinutes`] = 'err.gap'
  })
  for (const [id, r] of Object.entries(draft.rules)) {
    const from = r.from ? parseHHMM(r.from) : null
    const to = r.to ? parseHHMM(r.to) : null
    if ((r.from && from === null) || (r.to && to === null) || (from !== null && to !== null && to <= from)) errors[`rules.${id}.window`] = 'err.window'
    if (r.maxSlots !== null && r.maxSlots !== '' && !(Number(r.maxSlots) >= 1)) errors[`rules.${id}.max`] = 'err.max'
  }
  return errors
}

/** The `children` of save_node (m35 save_children_distribution). Only the mentor ids present in `draft.days` / `draft.rules` are sent. */
export function draftToChildren(draft) {
  const days = draft.days.map((d, i) => ({
    ...(d.id ? { id: d.id } : {}),
    day_index: i,
    agenda_day_id: d.agendaDayId ?? null,
    day_date: d.agendaDayId ? null : d.date || null,
    start_time: d.start || null,
    total_round_min: Number(d.total) || 0,
    slot_duration_min: d.slotMinutes === null || d.slotMinutes === '' ? null : Number(d.slotMinutes),
    gap_min: d.gapMinutes === null || d.gapMinutes === '' ? null : Number(d.gapMinutes),
    mentor_item_ids: d.mentorIds,
  }))
  const rules = Object.entries(draft.rules).map(([mentor_item_id, r]) => ({
    mentor_item_id,
    days: Array.isArray(r.days) ? r.days : null,
    max_slots: r.maxSlots === null || r.maxSlots === '' || r.maxSlots === undefined ? null : Number(r.maxSlots),
    available_from: r.from || null,
    available_to: r.to || null,
    room: text(r.room).trim() || null,
  }))
  return { settings: { slot_duration_min: Number(draft.settings.slotMinutes), gap_min: Number(draft.settings.gapMinutes), start_time: draft.settings.start, unique_pairing: Boolean(draft.settings.uniquePairing) }, days, rules }
}

export const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Mentor / company candidates from a connected list port: only real, non-missing items; key = the DB item id or the virtual id. */
export function candidatesFromItems(items) {
  const seen = new Set()
  const out = []
  for (const it of items ?? []) {
    const key = it.itemId ?? it.id
    if (!key || seen.has(key) || it.missing || it.excluded) continue
    seen.add(key)
    out.push({ key, item: it, name: it.entity?.title ?? { en: '', ar: '' }, sub: it.entity?.subtitle ?? { en: '', ar: '' }, virtual: !it.itemId })
  }
  return out
}

// ---------------------------------------------------------------- generation mapping
/** Model + rules rows -> input of `generateDistribution` (matching.js). */
export function toMatchingInput(model, rulesRows, companyIds, { scope = 'all', targetDayIds = null, seed = 1, attempts = 8 } = {}) {
  const rules = {}
  for (const r of rulesRows ?? []) {
    rules[r.mentor_item_id] = {
      days: Array.isArray(r.days) ? r.days.map(Number) : null,
      maxSlots: r.max_slots ?? null,
      from: r.available_from ? parseHHMM(r.available_from) : null,
      to: r.available_to ? parseHHMM(r.available_to) : null,
    }
  }
  return {
    days: model.days.map((d) => ({ id: d.id, dayIndex: d.index, slots: d.slots, startMinutes: d.startMinutes, slotMinutes: d.slotMinutes, gapMinutes: d.gapMinutes, mentorIds: d.mentorIds, locked: d.locked })),
    rules,
    companyIds,
    existing: model.sessions.map((s) => ({ dayId: s.dayId, slotIndex: s.slot, mentorId: s.mentorId, companyId: s.companyId, manual: s.manual })),
    uniquePairing: model.config.uniquePairing,
    seed,
    scope,
    targetDayIds,
    attempts,
  }
}
/** Result sessions -> rows of the RPC `replace_distribution_sessions`. */
export const toReplaceRows = (sessions) => sessions.map((s) => ({ day_id: s.dayId, slot_index: s.slotIndex, mentor_item_id: s.mentorId, company_item_id: s.companyId, is_manual_override: Boolean(s.manual) }))
/** A fresh random seed for the UI (the ONLY randomness lives here, outside the pure algorithm). */
export const randomSeed = () => Math.floor(Math.random() * 2 ** 31) + 1

// ---------------------------------------------------------------- validation of a stored timetable
/**
 * Issues of a timetable (what the as-is `validateDistribution` was meant to do): hard conflicts are `error`, things to look at are
 * `warning`, `unmatched` cells are `info`. The DB enforces the hard ones (unique indexes + RPC checks); this list also catches state that
 * became inconsistent after a config change (mentor window edited, day shortened, mentor removed from a day, company removed from the list).
 * `rules` = { [mentorId]: { days, maxSlots, from(min), to(min) } } as built by toMatchingInput.
 */
export function validateTimetable({ days, sessions, rules = {}, uniquePairing = true, companyIds = null }) {
  const issues = []
  const dayById = new Map(days.map((d) => [d.id, d]))
  const seenCell = new Map()
  const seenCompany = new Map()
  const pairDays = new Map()
  const filled = new Map()
  const unmatched = new Map()
  const known = companyIds ? new Set(companyIds) : null
  const push = (code, severity, s, extra = {}) => issues.push({ code, severity, dayId: s.dayId, slotIndex: s.slot, mentorId: s.mentorId, companyId: s.companyId ?? null, ...extra })

  for (const s of sessions) {
    const day = dayById.get(s.dayId)
    if (!day) continue
    if (s.slot >= day.slots || s.slot < 0) {
      push('beyond_round', 'error', s)
      continue
    }
    if (!day.mentorIds.includes(s.mentorId)) push('mentor_not_in_day', 'error', s)
    const rule = rules[s.mentorId]
    if (rule) {
      const start = day.startMinutes + s.slot * (day.slotMinutes + day.gapMinutes)
      const end = start + day.slotMinutes
      const outside = (Array.isArray(rule.days) && !rule.days.includes(day.index)) || (rule.from !== null && rule.from !== undefined && start < rule.from) || (rule.to !== null && rule.to !== undefined && end > rule.to)
      if (outside) push('outside_window', s.companyId ? 'error' : 'warning', s)
    }
    const ck = `${s.dayId}|${s.slot}|${s.mentorId}`
    seenCell.set(ck, (seenCell.get(ck) ?? 0) + 1)
    if (!s.companyId) {
      unmatched.set(s.dayId, (unmatched.get(s.dayId) ?? 0) + 1)
      continue
    }
    if (known && !known.has(s.companyId)) push('company_missing', 'warning', s)
    const ok = `${s.dayId}|${s.slot}|${s.companyId}`
    if (!seenCompany.has(ok)) seenCompany.set(ok, [])
    seenCompany.get(ok).push(s)
    const pk = `${s.mentorId}|${s.companyId}`
    if (!pairDays.has(pk)) pairDays.set(pk, [])
    pairDays.get(pk).push(s)
    const fk = `${s.dayId}|${s.mentorId}`
    filled.set(fk, (filled.get(fk) ?? 0) + 1)
  }
  for (const [k, n] of seenCell) if (n > 1) {
    const [dayId, slot, mentorId] = k.split('|')
    issues.push({ code: 'mentor_double_booked', severity: 'error', dayId, slotIndex: Number(slot), mentorId, companyId: null })
  }
  for (const list of seenCompany.values()) if (list.length > 1) push('company_double_booked', 'error', list[0], { count: list.length })
  for (const list of pairDays.values()) {
    if (list.length < 2) continue
    if (uniquePairing) push('repeat_pair', 'error', list[0], { count: list.length })
    else if (new Set(list.map((s) => s.dayId)).size < list.length) push('repeat_pair', 'warning', list[0], { count: list.length })
  }
  for (const [k, n] of filled) {
    const [dayId, mentorId] = k.split('|')
    const max = rules[mentorId]?.maxSlots
    if (max && n > max) issues.push({ code: 'over_max', severity: 'error', dayId, slotIndex: null, mentorId, companyId: null, count: n })
  }
  for (const [dayId, n] of unmatched) issues.push({ code: 'unmatched', severity: 'info', dayId, slotIndex: null, mentorId: null, companyId: null, count: n })
  const count = (sev) => issues.filter((i) => i.severity === sev).length
  return { issues, errors: count('error'), warnings: count('warning'), unmatched: [...unmatched.values()].reduce((a, n) => a + n, 0) }
}

// ---------------------------------------------------------------- matrix
/** Matrix of one day: rows = slots (with times), columns = mentors, cell = session | null. */
export function buildMatrix(model, dayId, lang = 'en') {
  const day = model.days.find((d) => d.id === dayId)
  if (!day) return null
  const times = dayTimes(day)
  const mentorIds = sortedMentors(model, day, lang)
  const map = new Map()
  for (const s of model.sessions) if (s.dayId === dayId) map.set(`${s.slot}|${s.mentorId}`, s)
  return { day, times, mentorIds, cell: (slot, mentorId) => map.get(`${slot}|${mentorId}`) ?? null, filled: [...map.values()].filter((s) => s.companyId).length }
}

/** Slot start/end as instants (ISO) in the project zone; null for a day without a date. */
export function slotInstants(day, slotIndex, tz) {
  if (!day.date) return { startsAt: null, endsAt: null }
  const t = dayTimes(day)[slotIndex]
  if (!t) return { startsAt: null, endsAt: null }
  return { startsAt: toInstant(day.date, t.start, tz)?.toISOString() ?? null, endsAt: toInstant(day.date, t.end, tz)?.toISOString() ?? null }
}

// ---------------------------------------------------------------- rounds, clock and timer
/** Every (day, slot) of the schedule in order: the sequence the timer's next/previous walks. */
export function roundSequence(days) {
  return days.flatMap((d) => Array.from({ length: d.slots }, (_, i) => ({ dayId: d.id, slotIndex: i })))
}
export function roundNeighbour(days, dayId, slotIndex, step = 1) {
  const seq = roundSequence(days)
  const i = seq.findIndex((r) => r.dayId === dayId && r.slotIndex === slotIndex)
  return i === -1 ? null : seq[i + step] ?? null
}

/** Offset (ms) to add to the local clock to get the server clock, from a payload carrying `server_now` received at `receivedAt`. */
export function serverOffsetMs(serverNow, receivedAt = Date.now()) {
  const t = Date.parse(serverNow)
  return Number.isNaN(t) ? 0 : t - receivedAt
}
/** Remaining seconds of the shared timer (null when idle). Computed locally from the server timestamps: nothing is written per second. */
export function timerRemaining(timer, nowMs = Date.now(), offsetMs = 0) {
  if (!timer || timer.status === 'idle') return null
  if (timer.status === 'paused') return Math.max(0, Number(timer.remaining_s) || 0)
  const end = Date.parse(timer.ends_at)
  return Number.isNaN(end) ? null : Math.max(0, (end - (nowMs + offsetMs)) / 1000)
}
/** 'M:SS' / 'MM:SS' of a number of seconds (rounded UP: the display reaches 0:00 exactly when the round ends). */
export function formatMMSS(seconds) {
  const s = Math.max(0, Math.ceil(Number(seconds) || 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The round the live view shows. A running/paused timer round (PM controlled) wins; otherwise the round is derived from the wall
 * clock in the project zone ("today" through lib/time, not UTC): { source, dayId, slotIndex, state: 'in'|'before'|'between'|'after'|'no_day', secondsLeft }.
 */
export function liveRound(model, timer, now = new Date(), offsetMs = 0) {
  if (timer && timer.status !== 'idle' && timer.day_id) {
    const day = model.days.find((d) => d.id === timer.day_id)
    if (day && timer.slot_index !== null && timer.slot_index < day.slots) {
      return { source: 'timer', dayId: day.id, slotIndex: timer.slot_index, state: 'in', status: timer.status, secondsLeft: timerRemaining(timer, now.getTime(), offsetMs), duration: timer.duration_s }
    }
  }
  const today = todayInTz(model.tz, now)
  const day = model.days.find((d) => d.date === today)
  if (!day) return { source: 'clock', dayId: null, slotIndex: null, state: 'no_day', secondsLeft: null }
  const slots = dayTimes(day)
  const mins = minutesOfDayInTz(now, model.tz)
  const idx = currentSlotIndex(slots, mins)
  if (idx !== null) return { source: 'clock', dayId: day.id, slotIndex: idx, state: 'in', status: 'clock', secondsLeft: secondsUntilSlotEnd(slots[idx], secondsOfDayInTz(now, model.tz)), duration: day.slotMinutes * 60 }
  const upcoming = slots.findIndex((s) => s.startMinutes > mins)
  if (upcoming !== -1) return { source: 'clock', dayId: day.id, slotIndex: upcoming, state: upcoming === 0 ? 'before' : 'between', secondsLeft: Math.max(0, slots[upcoming].startMinutes * 60 - secondsOfDayInTz(now, model.tz)), duration: day.slotMinutes * 60 }
  return { source: 'clock', dayId: day.id, slotIndex: null, state: 'after', secondsLeft: null }
}

/** Sessions with a company in one round, sorted by mentor name: the cards of the live board. */
export function roundPairs(model, dayId, slotIndex, lang = 'en') {
  if (dayId === null || slotIndex === null || slotIndex === undefined) return []
  return model.sessions
    .filter((s) => s.dayId === dayId && s.slot === slotIndex && s.companyId)
    .map((s) => ({ session: s, mentor: model.mentors.get(s.mentorId), company: model.companies.get(s.companyId) }))
    .sort((a, b) => nameOf(a.mentor, lang).localeCompare(nameOf(b.mentor, lang), lang))
}

// ---------------------------------------------------------------- "who do I meet next"
/**
 * Meetings of one company in schedule order with a state against `now` (project zone): 'past' | 'now' | 'next' | 'upcoming' | 'undated'
 * (a day without a date cannot be placed on the clock: it is listed in order with no now/next). Also returns `current` and `next`.
 */
export function myMeetings(model, companyId, now = new Date()) {
  if (!companyId) return { items: [], current: null, next: null }
  const nowMs = now.getTime()
  const items = model.sessions
    .filter((s) => s.companyId === companyId)
    .map((s) => {
      const day = model.days.find((d) => d.id === s.dayId)
      if (!day) return null
      const t = dayTimes(day)[s.slot]
      const { startsAt, endsAt } = slotInstants(day, s.slot, model.tz)
      return { session: s, day, slotIndex: s.slot, start: t?.start ?? '', end: t?.end ?? '', startsAt, endsAt, mentor: model.mentors.get(s.mentorId), room: model.mentors.get(s.mentorId)?.room ?? '', state: 'undated' }
    })
    .filter(Boolean)
    .sort((a, b) => a.day.index - b.day.index || a.slotIndex - b.slotIndex)
  let nextSet = false
  for (const it of items) {
    if (!it.startsAt) continue
    const s = Date.parse(it.startsAt)
    const e = Date.parse(it.endsAt)
    if (nowMs >= e) it.state = 'past'
    else if (nowMs >= s) it.state = 'now'
    else if (!nextSet) {
      it.state = 'next'
      nextSet = true
    } else it.state = 'upcoming'
  }
  return { items, current: items.find((i) => i.state === 'now') ?? null, next: items.find((i) => i.state === 'next') ?? null }
}

/** Sessions of one mentor in order (the mentor-centric view): the companies they meet. */
export function mentorMeetings(model, mentorId) {
  return model.sessions
    .filter((s) => s.mentorId === mentorId)
    .map((s) => {
      const day = model.days.find((d) => d.id === s.dayId)
      const t = day ? dayTimes(day)[s.slot] : null
      return day ? { session: s, day, slotIndex: s.slot, start: t?.start ?? '', end: t?.end ?? '', company: s.companyId ? model.companies.get(s.companyId) : null } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.day.index - b.day.index || a.slotIndex - b.slotIndex)
}

// ---------------------------------------------------------------- Excel
/** Sheets for `exportWorkbook`: a flat list + one matrix per day. `label(day)` names a day (translated by the caller). */
export function distributionSheets(model, { lang = 'en', dayLabel = (d) => `Day ${d.index + 1}` } = {}) {
  const list = []
  const sheets = {}
  for (const day of model.days) {
    const times = dayTimes(day)
    const label = dayLabel(day)
    const mentorIds = sortedMentors(model, day, lang)
    const bySlot = new Map(model.sessions.filter((s) => s.dayId === day.id).map((s) => [`${s.slot}|${s.mentorId}`, s]))
    const matrix = times.map((t) => {
      const row = { Time: `${t.start}-${t.end}` }
      for (const m of mentorIds) row[nameOf(model.mentors.get(m), lang) || m] = nameOf(model.companies.get(bySlot.get(`${t.index}|${m}`)?.companyId), lang)
      return row
    })
    sheets[label] = matrix.length ? matrix : [{ Time: '' }]
    for (const s of model.sessions.filter((x) => x.dayId === day.id).sort((a, b) => a.slot - b.slot)) {
      const t = times[s.slot]
      list.push({ Day: label, Date: day.date ?? '', Start: t?.start ?? '', End: t?.end ?? '', Mentor: nameOf(model.mentors.get(s.mentorId), lang), Room: model.mentors.get(s.mentorId)?.room ?? '', Company: nameOf(model.companies.get(s.companyId), lang) })
    }
  }
  return { Sessions: list.length ? list : [{ Day: '' }], ...sheets }
}

export { formatHHMM, parseHHMM }
