import { describe, expect, it } from 'vitest'
import {
  buildMatrix, candidatesFromItems, dayEndMinutes, dayTimes, defaultDayId, distributionSheets, draftFromModel, draftToChildren, effectiveDay, emptyDay, formatMMSS, liveRound,
  mentorMeetings, myMeetings, nameOf, pickMentoringSlot, normalizeDistConfig, normalizePayload, roundNeighbour, roundPairs, roundSequence, rulesFromRows, serverOffsetMs, timerRemaining,
  toReplaceRows, totalFromEnd, toMatchingInput, validateDraft, validateTimetable, windowFromAgendaSlot, withdrawnIdsOf,
} from './distributionLogic.js'

const payload = (over = {}) => ({
  node_id: 'n1', revision: 4, published: true, name_en: 'Mentoring', name_ar: 'التوزيع', project: { name_en: 'P', timezone: 'Asia/Riyadh' },
  config: { slot_duration_min: 20, gap_min: 5, start_time: '10:00', unique_pairing: true, seed: 9, timer: { alertSeconds: 5 } },
  days: [
    { id: 'd1', day_index: 0, date: '2026-10-12', start_time: '10:00', total_round_min: 70, slot_duration_min: 20, gap_min: 5, slots: 3, is_locked: false, mentor_ids: ['m1', 'm2'], own_start: '10:00', own_slot: 20, own_gap: 5, own_date: '2026-10-12' },
    { id: 'd2', day_index: 1, date: null, start_time: '09:00', total_round_min: 30, slot_duration_min: 30, gap_min: 0, slots: 1, mentor_ids: ['m1'] },
  ],
  mentors: [{ id: 'm1', name_en: 'Zed Mentor', name_ar: 'زيد', room: 'Room A' }, { id: 'm2', name_en: 'Amy Mentor', name_ar: '' }],
  companies: [{ id: 'c1', name_en: 'Acme', name_ar: 'أكمي' }, { id: 'c2', name_en: 'Beta', name_ar: '' }],
  sessions: [
    { id: 's1', d: 'd1', s: 0, m: 'm1', c: 'c1', manual: false }, { id: 's2', d: 'd1', s: 0, m: 'm2', c: 'c2', manual: true },
    { id: 's3', d: 'd1', s: 1, m: 'm1', c: 'c2' }, { id: 's4', d: 'd1', s: 1, m: 'm2', c: null },
    { id: 's5', d: 'd2', s: 0, m: 'm1', c: 'c1' },
  ],
  my_company_ids: ['c1'],
  ...over,
})

describe('config + payload model', () => {
  it('normalises the timer config with clamps and defaults', () => {
    expect(normalizeDistConfig({}).timer).toEqual({ alertSeconds: 7, sounds: true })
    expect(normalizeDistConfig({ timer: { alertSeconds: 99, sounds: false } }).timer).toEqual({ alertSeconds: 30, sounds: false })
    expect(normalizeDistConfig({ timer: { alertSeconds: 'x' }, keep: 1 })).toMatchObject({ keep: 1, timer: { alertSeconds: 7 } })
  })

  it('maps the payload (days with gap-aware slots and times, entities, sessions, own company ids)', () => {
    const m = normalizePayload(payload())
    expect(m.tz).toBe('Asia/Riyadh')
    expect(m.config.timer.alertSeconds).toBe(5)
    expect(m.days[0]).toMatchObject({ id: 'd1', index: 0, slots: 3, startMinutes: 600, mentorIds: ['m1', 'm2'] })
    expect(dayTimes(m.days[0]).map((t) => t.start)).toEqual(['10:00', '10:25', '10:50'])
    expect(dayEndMinutes(m.days[0])).toBe(600 + 70) // 3 x 20 + 2 x 5
    expect(m.mentors.get('m1').room).toBe('Room A')
    expect(nameOf(m.mentors.get('m2'), 'ar')).toBe('Amy Mentor') // falls back to the other language
    expect(m.sessions).toHaveLength(5)
    expect(m.myCompanyIds).toEqual(['c1'])
    expect(normalizePayload(null)).toBeNull()
  })

  it('opens the day of today in the project zone, else the next dated day, else the first', () => {
    const m = normalizePayload(payload())
    expect(defaultDayId(m.days, m.tz, new Date('2026-10-12T08:00:00Z'))).toBe('d1')
    expect(defaultDayId(m.days, m.tz, new Date('2026-10-01T08:00:00Z'))).toBe('d1')
    expect(defaultDayId(m.days, m.tz, new Date('2026-12-01T08:00:00Z'))).toBe('d1')
    expect(defaultDayId([], 'Asia/Riyadh')).toBeNull()
  })
})

describe('draft (settings + days + mentors + rules)', () => {
  it('round-trips the model into the save_node children and back', () => {
    const m = normalizePayload(payload())
    const draft = draftFromModel(m, [{ mentor_item_id: 'm1', days: null, max_slots: 4, available_from: '10:30:00', available_to: null, room: 'A' }])
    expect(draft.days[0]).toMatchObject({ id: 'd1', start: '10:00', total: 70, slotMinutes: 20, gapMinutes: 5, date: '2026-10-12', mentorIds: ['m1', 'm2'] })
    const children = draftToChildren(draft)
    expect(children.settings).toEqual({ slot_duration_min: 20, gap_min: 5, start_time: '10:00', unique_pairing: true })
    expect(children.days[0]).toMatchObject({ id: 'd1', day_index: 0, day_date: '2026-10-12', agenda_day_id: null, total_round_min: 70, mentor_item_ids: ['m1', 'm2'] })
    expect(children.rules[0]).toEqual({ mentor_item_id: 'm1', days: null, max_slots: 4, available_from: '10:30', available_to: null, room: 'A' })
  })

  it('a day linked to an agenda day sends the reference and no date (the CHECK of distribution_days)', () => {
    const draft = { settings: { slotMinutes: 20, gapMinutes: 5, start: '10:00', uniquePairing: true }, days: [{ ...emptyDay(), agendaDayId: 'ag1', date: '2026-01-01' }], rules: {} }
    expect(draftToChildren(draft).days[0]).toMatchObject({ agenda_day_id: 'ag1', day_date: null })
  })

  it('slots per round include the gaps and the end time sets the round (as-is CON-8/CON-9 fixed)', () => {
    const settings = { slotMinutes: 20, gapMinutes: 5, start: '10:00', uniquePairing: true }
    const day = { ...emptyDay(settings), start: '10:00', total: 70 }
    expect(effectiveDay(day, settings)).toMatchObject({ slots: 3, endMinutes: 670 })
    expect(effectiveDay({ ...day, total: 69 }, settings).slots).toBe(2)
    expect(totalFromEnd('10:00', '11:55')).toBe(115)
    expect(totalFromEnd('10:00', '09:00')).toBe(0)
    expect(windowFromAgendaSlot({ start: '13:00', startMinutes: 780, endMinutes: 840 })).toEqual({ start: '13:00', total: 60 })
    const slots = [{ id: 'a', title: { en: 'Opening', ar: '' } }, { id: 'b', title: { en: '', ar: 'جولات المنتورينج' } }, { id: 'c', title: { en: 'Mentoring rounds', ar: '' } }]
    expect(pickMentoringSlot(slots).id).toBe('b')
    expect(pickMentoringSlot(slots.slice(0, 1)).id).toBe('a')
    expect(pickMentoringSlot([])).toBeNull()
  })

  it('validates settings, day timing and mentor windows', () => {
    const settings = { slotMinutes: 0, gapMinutes: -1, start: '25:00', uniquePairing: true }
    const draft = { settings, days: [{ ...emptyDay(), start: 'xx', total: 5000 }], rules: { m1: { days: null, maxSlots: 0, from: '12:00', to: '11:00', room: '' } } }
    const errs = validateDraft(draft)
    expect(Object.keys(errs).sort()).toEqual(['days.0.start', 'days.0.total', 'rules.m1.max', 'rules.m1.window', 'settings.gapMinutes', 'settings.slotMinutes', 'settings.start'])
    expect(validateDraft({ settings: { slotMinutes: 20, gapMinutes: 5, start: '10:00' }, days: [], rules: {} })).toEqual({})
  })

  it('reads the rule rows (smallint days, time with seconds)', () => {
    expect(rulesFromRows([{ mentor_item_id: 'm', days: [0, 2], max_slots: null, available_from: '09:00:00', available_to: '12:30:00', room: null }]).m).toEqual({ days: [0, 2], maxSlots: null, from: '09:00', to: '12:30', room: '' })
  })

  it('candidates keep real and virtual items once, skipping missing/hidden ones', () => {
    const items = [{ itemId: 'a', entity: { title: { en: 'A', ar: '' } } }, { id: 'virtual:expert:x', itemId: null, entity: { title: { en: 'X', ar: '' } } }, { itemId: 'a' }, { itemId: 'gone', missing: true }, { itemId: 'h', excluded: true }]
    expect(candidatesFromItems(items).map((c) => [c.key, c.virtual])).toEqual([['a', false], ['virtual:expert:x', true]])
  })

  it('maps generated sessions to the RPC rows', () => {
    expect(toReplaceRows([{ dayId: 'd', slotIndex: 1, mentorId: 'm', companyId: null, manual: false }])).toEqual([{ day_id: 'd', slot_index: 1, mentor_item_id: 'm', company_item_id: null, is_manual_override: false }])
  })
})

describe('validateTimetable', () => {
  const days = [{ id: 'd1', index: 0, slots: 2, startMinutes: 600, slotMinutes: 20, gapMinutes: 0, mentorIds: ['m1', 'm2'] }]
  const s = (slot, mentorId, companyId) => ({ dayId: 'd1', slot, mentorId, companyId })

  it('reports each kind of conflict with its severity', () => {
    const sessions = [s(0, 'm1', 'c1'), s(0, 'm2', 'c1'), s(1, 'm1', 'c1'), s(2, 'm1', 'c2'), s(1, 'm3', 'c3'), s(0, 'm1', 'c4')]
    const v = validateTimetable({ days, sessions, rules: { m2: { days: null, maxSlots: null, from: 610, to: null } }, uniquePairing: true, companyIds: ['c1', 'c2', 'c3'] })
    const codes = (sev) => [...new Set(v.issues.filter((i) => i.severity === sev).map((i) => i.code))].sort()
    expect(codes('error')).toEqual(['beyond_round', 'company_double_booked', 'mentor_double_booked', 'mentor_not_in_day', 'outside_window', 'repeat_pair'])
    expect(codes('warning')).toEqual(['company_missing'])
    expect(v.errors).toBeGreaterThan(0)
  })

  it('counts unmatched cells per day and over-max mentors; repeat pairs are warnings only within a day without unique pairing', () => {
    const sessions = [s(0, 'm1', 'c1'), s(1, 'm1', 'c2'), s(0, 'm2', null), s(1, 'm2', null)]
    const v = validateTimetable({ days, sessions, rules: { m1: { days: null, maxSlots: 1, from: null, to: null } }, uniquePairing: false })
    expect(v.issues.find((i) => i.code === 'over_max')).toMatchObject({ mentorId: 'm1', count: 2 })
    expect(v.issues.find((i) => i.code === 'unmatched')).toMatchObject({ count: 2, severity: 'info' })
    expect(v.unmatched).toBe(2)
    const rep = validateTimetable({ days, sessions: [s(0, 'm1', 'c1'), s(1, 'm1', 'c1')], uniquePairing: false })
    expect(rep.issues.find((i) => i.code === 'repeat_pair')).toMatchObject({ severity: 'warning' })
  })
})

describe('WITHDRAWN (m40)', () => {
  const days = [{ id: 'd1', index: 0, slots: 2, startMinutes: 600, slotMinutes: 20, gapMinutes: 0, mentorIds: ['m1', 'm2'] }]
  const s = (slot, mentorId, companyId) => ({ dayId: 'd1', slot, mentorId, companyId })

  it('the PM payload flags withdrawn mentors / companies; withdrawnIdsOf collects them; candidates never include them', () => {
    const model = normalizePayload(payload({ mentors: [{ id: 'm1', name_en: 'A' }, { id: 'm2', name_en: 'B', withdrawn: true }], companies: [{ id: 'c1', name_en: 'Co', withdrawn: true }, { id: 'c2', name_en: 'Co 2' }] }))
    expect([...withdrawnIdsOf(model)].sort()).toEqual(['c1', 'm2'])
    expect(model.mentors.get('m1').withdrawn).toBe(false)
    expect(candidatesFromItems([{ itemId: 'x', withdrawn: true, entity: { title: { en: 'W' } } }, { itemId: 'y', entity: { title: { en: 'Y' } } }]).map((c) => c.key)).toEqual(['y'])
    expect(withdrawnIdsOf(null).size).toBe(0)
  })

  it('a stored timetable with a withdrawn company / mentor reports a WARNING (not "no longer in the list"); a clean one reports nothing', () => {
    const v = validateTimetable({ days, sessions: [s(0, 'm1', 'c1'), s(0, 'm2', 'c2'), s(1, 'm1', 'c2')], uniquePairing: false, companyIds: ['c2'], withdrawn: new Set(['c1', 'm2']) })
    const codes = v.issues.map((i) => i.code).sort()
    expect(codes).toEqual(['company_withdrawn', 'mentor_withdrawn'])
    expect(v.issues.every((i) => i.severity === 'warning')).toBe(true)
    expect(v.issues.find((i) => i.code === 'company_withdrawn')).toMatchObject({ companyId: 'c1', slotIndex: 0 })
    expect(validateTimetable({ days, sessions: [s(0, 'm1', 'c2')], uniquePairing: false, companyIds: ['c2'], withdrawn: new Set() }).issues).toEqual([])
  })

  it('the generator input leaves withdrawn mentors out of every day (the DB would refuse them)', () => {
    const model = normalizePayload(payload({ mentors: [{ id: 'm1', name_en: 'A' }, { id: 'm2', name_en: 'B', withdrawn: true }] }))
    const input = toMatchingInput(model, [], ['c1'], {})
    expect(input.days[0].mentorIds).toEqual(['m1'])
    expect(model.days[0].mentorIds).toEqual(['m1', 'm2']) // the model itself is untouched: the Setup keeps showing the withdrawn mentor with a chip
  })
})

describe('matrix, rounds and timer', () => {
  const model = normalizePayload(payload())

  it('builds the matrix of a day with mentors sorted by name and the cell lookup', () => {
    const mx = buildMatrix(model, 'd1', 'en')
    expect(mx.mentorIds).toEqual(['m2', 'm1']) // Amy before Zed
    expect(mx.times).toHaveLength(3)
    expect(mx.cell(0, 'm1').companyId).toBe('c1')
    expect(mx.cell(2, 'm1')).toBeNull()
    expect(mx.filled).toBe(3)
    expect(buildMatrix(model, 'nope')).toBeNull()
  })

  it('walks the whole schedule round by round', () => {
    expect(roundSequence(model.days)).toHaveLength(4)
    expect(roundNeighbour(model.days, 'd1', 2, 1)).toEqual({ dayId: 'd2', slotIndex: 0 })
    expect(roundNeighbour(model.days, 'd1', 0, -1)).toBeNull()
    expect(roundNeighbour(model.days, 'd2', 0, 1)).toBeNull()
  })

  it('computes the remaining time from server timestamps (running, paused, idle) and formats it', () => {
    const now = Date.parse('2026-10-12T10:00:00Z')
    const running = { status: 'running', ends_at: '2026-10-12T10:01:30Z' }
    expect(timerRemaining(running, now, 0)).toBe(90)
    expect(timerRemaining(running, now, 5000)).toBe(85) // the server clock is 5 s ahead of this device
    expect(timerRemaining({ status: 'running', ends_at: '2026-10-12T09:59:00Z' }, now)).toBe(0)
    expect(timerRemaining({ status: 'paused', remaining_s: 42 }, now)).toBe(42)
    expect(timerRemaining({ status: 'idle' }, now)).toBeNull()
    expect(serverOffsetMs('2026-10-12T10:00:05Z', now)).toBe(5000)
    expect(formatMMSS(90)).toBe('1:30')
    expect(formatMMSS(0.2)).toBe('0:01')
    expect(formatMMSS(0)).toBe('0:00')
  })

  it('liveRound: a timer round wins; otherwise the wall clock in the PROJECT zone (not UTC)', () => {
    // 2026-10-12 10:05 Riyadh (UTC+3) = 07:05 UTC: slot 0 (10:00-10:20) of d1
    const nowIn = new Date('2026-10-12T07:05:00Z')
    expect(liveRound(model, null, nowIn)).toMatchObject({ source: 'clock', dayId: 'd1', slotIndex: 0, state: 'in', secondsLeft: 15 * 60 })
    // between slot 0 and 1 (10:22, slot 1 starts 10:25)
    expect(liveRound(model, null, new Date('2026-10-12T07:22:00Z'))).toMatchObject({ slotIndex: 1, state: 'between', secondsLeft: 180 })
    expect(liveRound(model, null, new Date('2026-10-12T06:30:00Z'))).toMatchObject({ slotIndex: 0, state: 'before' })
    expect(liveRound(model, null, new Date('2026-10-12T20:00:00Z'))).toMatchObject({ state: 'after', slotIndex: null })
    expect(liveRound(model, null, new Date('2026-10-20T07:00:00Z'))).toMatchObject({ state: 'no_day' })
    const timer = { status: 'running', day_id: 'd2', slot_index: 0, ends_at: '2026-10-12T07:07:00Z', duration_s: 1800 }
    expect(liveRound(model, timer, nowIn)).toMatchObject({ source: 'timer', dayId: 'd2', slotIndex: 0, status: 'running', secondsLeft: 120 })
    expect(liveRound(model, { status: 'paused', day_id: 'gone', slot_index: 0, remaining_s: 1 }, nowIn).source).toBe('clock') // stale pointer falls back
  })

  it('lists the pairs of a round (with a company) sorted by mentor name', () => {
    expect(roundPairs(model, 'd1', 0, 'en').map((p) => p.mentor.id)).toEqual(['m2', 'm1'])
    expect(roundPairs(model, 'd1', 1, 'en')).toHaveLength(1) // m2 has no company in slot 1
    expect(roundPairs(model, null, 0)).toEqual([])
  })

  it('the live board never announces a withdrawn company or mentor (the PM payload still carries them, flagged)', () => {
    const m = normalizePayload(payload({ mentors: [{ id: 'm1', name_en: 'Zed Mentor' }, { id: 'm2', name_en: 'Amy Mentor', withdrawn: true }], companies: [{ id: 'c1', name_en: 'Acme', withdrawn: true }, { id: 'c2', name_en: 'Beta' }] }))
    // slot 0: m1 + c1 (company withdrawn) and m2 (mentor withdrawn) + c2; slot 1: m1 + c2 stays
    expect(roundPairs(m, 'd1', 0, 'en')).toEqual([])
    expect(roundPairs(m, 'd1', 1, 'en').map((p) => p.mentor.id + '/' + p.company.id)).toEqual(['m1/c2'])
  })
})

describe('who do I meet next', () => {
  const model = normalizePayload(payload())

  it('classifies a company\'s meetings against the clock (project zone) and finds now / next', () => {
    const during = myMeetings(model, 'c1', new Date('2026-10-12T07:05:00Z')) // 10:05 Riyadh
    expect(during.items.map((i) => [i.start, i.state])).toEqual([['10:00', 'now'], ['09:00', 'undated']])
    expect(during.current.mentor.id).toBe('m1')
    expect(during.current.room).toBe('Room A')
    const c2 = myMeetings(model, 'c2', new Date('2026-10-12T07:05:00Z'))
    expect(c2.items.map((i) => i.state)).toEqual(['now', 'next'])
    expect(c2.next.start).toBe('10:25')
    const after = myMeetings(model, 'c2', new Date('2026-10-12T20:00:00Z'))
    expect(after.items.every((i) => i.state === 'past')).toBe(true)
    expect(after.next).toBeNull()
    expect(myMeetings(model, null).items).toEqual([])
  })

  it('mentor-centric view lists the companies in order', () => {
    expect(mentorMeetings(model, 'm1').map((x) => [x.day.id, x.slotIndex, x.company?.id])).toEqual([['d1', 0, 'c1'], ['d1', 1, 'c2'], ['d2', 0, 'c1']])
  })
})

describe('Excel sheets', () => {
  it('has a flat list and one matrix per day with unique sheet names', () => {
    const model = normalizePayload(payload())
    const sheets = distributionSheets(model, { lang: 'en', dayLabel: (d) => `Day ${d.index + 1}` })
    expect(Object.keys(sheets)).toEqual(['Sessions', 'Day 1', 'Day 2'])
    expect(sheets.Sessions).toHaveLength(5)
    expect(sheets.Sessions[0]).toMatchObject({ Day: 'Day 1', Start: '10:00', Mentor: 'Zed Mentor', Company: 'Acme' })
    expect(sheets['Day 1'][0]).toMatchObject({ Time: '10:00-10:20', 'Zed Mentor': 'Acme', 'Amy Mentor': 'Beta' })
  })
})
