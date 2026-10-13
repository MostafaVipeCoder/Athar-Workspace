import { describe, expect, it } from 'vitest'
import { generateDistribution, hungarian, mentorAvailableAt, mulberry32, pairKey, summarizeUnmatched } from './matching.js'
import { toMatchingInput, validateTimetable } from './distributionLogic.js'

const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`)
const day = (over = {}) => ({ id: 'd1', dayIndex: 0, slots: 3, startMinutes: 600, slotMinutes: 20, gapMinutes: 5, mentorIds: ids('m', 3), locked: false, ...over })
const filled = (r) => r.sessions.filter((s) => s.companyId)

function checkInvariants(result, { uniquePairing = true } = {}) {
  const slotCompany = new Set()
  const cell = new Set()
  const pairs = new Map()
  for (const s of result.sessions) {
    const ck = `${s.dayId}|${s.slotIndex}|${s.mentorId}`
    expect(cell.has(ck)).toBe(false)
    cell.add(ck)
    if (!s.companyId) continue
    const sk = `${s.dayId}|${s.slotIndex}|${s.companyId}`
    expect(slotCompany.has(sk)).toBe(false)
    slotCompany.add(sk)
    const pk = pairKey(s.mentorId, s.companyId)
    pairs.set(pk, (pairs.get(pk) ?? 0) + 1)
  }
  if (uniquePairing) for (const n of pairs.values()) expect(n).toBe(1)
}

describe('hungarian', () => {
  it('finds the minimum-cost assignment', () => {
    const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]]
    const a = hungarian(cost)
    const total = a.reduce((sum, j, i) => sum + cost[i][j], 0)
    expect(total).toBe(5)
    expect(new Set(a).size).toBe(3)
  })
  it('handles more columns than rows', () => {
    const a = hungarian([[10, 1, 9, 8], [10, 2, 1, 8]])
    expect(a).toEqual([1, 2])
  })
  it('rejects fewer columns than rows', () => {
    expect(() => hungarian([[1], [2]])).toThrow()
  })
})

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const xs = Array.from({ length: 5 }, () => a())
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()))
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
  })
})

describe('generateDistribution', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const input = { days: [day({ slots: 6, mentorIds: ids('m', 6) })], companyIds: ids('c', 12), seed: 7 }
    const a = generateDistribution(input)
    const b = generateDistribution(input)
    expect(a.sessions).toEqual(b.sessions)
    const others = [1, 2, 3, 4].map((seed) => JSON.stringify(generateDistribution({ ...input, seed }).sessions))
    expect(new Set([JSON.stringify(a.sessions), ...others]).size).toBeGreaterThan(1)
  })

  it('builds a perfect Latin square when companies = mentors = slots (every pair once, nobody in two rooms)', () => {
    const r = generateDistribution({ days: [day()], companyIds: ids('c', 3), seed: 3 })
    expect(r.stats).toMatchObject({ cells: 9, filled: 9, unmatched: 0 })
    checkInvariants(r)
    for (const c of ids('c', 3)) expect(new Set(r.sessions.filter((s) => s.companyId === c).map((s) => s.mentorId)).size).toBe(3)
  })

  it('never repeats a pair with unique pairing and keeps the company load even (17 mentors, 20 companies, 3 days)', () => {
    const mentors = ids('m', 17)
    const days = [0, 1, 2].map((i) => day({ id: `d${i}`, dayIndex: i, slots: 4, mentorIds: mentors }))
    const r = generateDistribution({ days, companyIds: ids('c', 20), seed: 11 })
    checkInvariants(r)
    expect(r.stats.unmatched).toBe(0)
    expect(r.stats.maxMeetings - r.stats.minMeetings).toBeLessThanOrEqual(1)
    // each company meets distinct mentors only
    for (const c of ids('c', 20)) {
      const ms = r.sessions.filter((s) => s.companyId === c).map((s) => s.mentorId)
      expect(new Set(ms).size).toBe(ms.length)
    }
  })

  it('matches the size of the migrated node (17 mentors, 71 companies, 28 rounds) with no repeats and no empty cell', () => {
    const mentors = ids('m', 17)
    const slots = [2, 4, 6, 4, 4, 4, 4]
    const days = slots.map((n, i) => day({ id: `d${i}`, dayIndex: i, slots: n, mentorIds: mentors, slotMinutes: 30, gapMinutes: 0 }))
    const r = generateDistribution({ days, companyIds: ids('c', 71), seed: 5, attempts: 3 })
    expect(r.sessions).toHaveLength(17 * 28)
    expect(r.stats.unmatched).toBe(0)
    checkInvariants(r)
  })

  it('never touches locked days but counts their pairs as history', () => {
    const locked = day({ id: 'dl', dayIndex: 0, locked: true, mentorIds: ['m01'], slots: 1 })
    const open = day({ id: 'do', dayIndex: 1, mentorIds: ['m01'], slots: 2 })
    const existing = [{ dayId: 'dl', slotIndex: 0, mentorId: 'm01', companyId: 'c01', manual: false }]
    const r = generateDistribution({ days: [locked, open], companyIds: ['c01', 'c02', 'c03'], existing, seed: 2 })
    expect(r.dayIds).toEqual(['do'])
    expect(r.sessions.every((s) => s.dayId === 'do')).toBe(true)
    expect(r.sessions.some((s) => s.mentorId === 'm01' && s.companyId === 'c01')).toBe(false)
    expect(r.stats.filled).toBe(2)
  })

  it('scope "unlocked" keeps manual pins as fixed cells and fills around them; scope "all" discards them', () => {
    const d = day({ mentorIds: ['m01', 'm02'], slots: 2 })
    const existing = [{ dayId: 'd1', slotIndex: 0, mentorId: 'm01', companyId: 'c01', manual: true }]
    const keep = generateDistribution({ days: [d], companyIds: ['c01', 'c02', 'c03'], existing, scope: 'unlocked', seed: 4 })
    expect(keep.pinned).toHaveLength(1)
    expect(keep.sessions.some((s) => s.slotIndex === 0 && s.mentorId === 'm01')).toBe(false)
    expect(keep.sessions.some((s) => s.slotIndex === 0 && s.companyId === 'c01')).toBe(false) // c01 is busy in slot 0 (pinned)
    expect(keep.sessions.some((s) => s.mentorId === 'm01' && s.companyId === 'c01')).toBe(false) // unique pairing keeps history
    const all = generateDistribution({ days: [d], companyIds: ['c01', 'c02', 'c03'], existing, scope: 'all', seed: 4 })
    expect(all.pinned).toHaveLength(0)
    expect(all.sessions).toHaveLength(4)
  })

  it('honours mentor windows, allowed days and per-day maximum in the same generation path', () => {
    const d0 = day({ id: 'd0', dayIndex: 0, slots: 4, mentorIds: ['m01', 'm02', 'm03'] })
    const d1 = day({ id: 'd1', dayIndex: 1, slots: 4, mentorIds: ['m01', 'm02', 'm03'] })
    const rules = {
      m01: { days: null, maxSlots: null, from: 600 + 2 * 25, to: null }, // starts at slot 2
      m02: { days: [0], maxSlots: null, from: null, to: null }, // day 0 only
      m03: { days: null, maxSlots: 2, from: null, to: null }, // 2 sessions per day
    }
    const r = generateDistribution({ days: [d0, d1], rules, companyIds: ids('c', 10), seed: 9 })
    checkInvariants(r)
    expect(r.sessions.filter((s) => s.mentorId === 'm01').every((s) => s.slotIndex >= 2)).toBe(true)
    expect(r.sessions.some((s) => s.mentorId === 'm02' && s.dayId === 'd1')).toBe(false)
    for (const dayId of ['d0', 'd1']) expect(filled(r).filter((s) => s.mentorId === 'm03' && s.dayId === dayId).length).toBeLessThanOrEqual(2)
    expect(mentorAvailableAt(rules.m01, d0, 1)).toBe(false)
    expect(mentorAvailableAt(rules.m01, d0, 2)).toBe(true)
  })

  it('explains empty cells (not enough companies / unique pairing exhausted)', () => {
    const few = generateDistribution({ days: [day({ slots: 1, mentorIds: ids('m', 3) })], companyIds: ['c01'], seed: 1 })
    expect(few.stats).toMatchObject({ filled: 1, unmatched: 2 })
    expect(summarizeUnmatched(few.unmatched)).toEqual({ not_enough_companies: 2 })
    const exhausted = generateDistribution({ days: [day({ slots: 2, mentorIds: ['m01'] })], companyIds: ['c01'], seed: 1 })
    expect(exhausted.stats).toMatchObject({ filled: 1, unmatched: 1 })
    expect(exhausted.unmatched[0].reason).toBe('already_met')
    const none = generateDistribution({ days: [day({ slots: 1, mentorIds: ['m01'] })], companyIds: [], seed: 1 })
    expect(none.unmatched[0].reason).toBe('no_companies')
  })

  it('without unique pairing a pair may repeat across days but never twice in one day', () => {
    const days = [0, 1].map((i) => day({ id: `d${i}`, dayIndex: i, slots: 2, mentorIds: ['m01'] }))
    const r = generateDistribution({ days, companyIds: ['c01', 'c02'], uniquePairing: false, seed: 1 })
    expect(r.stats.unmatched).toBe(0)
    for (const dayId of ['d0', 'd1']) {
      const cs = r.sessions.filter((s) => s.dayId === dayId).map((s) => s.companyId)
      expect(new Set(cs).size).toBe(cs.length)
    }
  })

  it('a generated timetable always passes the validator (no errors) and targets only the requested days', () => {
    const mentors = ids('m', 5)
    const days = [0, 1].map((i) => day({ id: `d${i}`, dayIndex: i, slots: 3, mentorIds: mentors }))
    const model = { days: days.map((d) => ({ ...d, index: d.dayIndex })), sessions: [] }
    const r = generateDistribution({ days, companyIds: ids('c', 8), seed: 13, targetDayIds: ['d1'] })
    expect(r.dayIds).toEqual(['d1'])
    model.sessions = r.sessions.map((s) => ({ dayId: s.dayId, slot: s.slotIndex, mentorId: s.mentorId, companyId: s.companyId }))
    const v = validateTimetable({ days: model.days, sessions: model.sessions, uniquePairing: true })
    expect(v.errors).toBe(0)
  })

  it('toMatchingInput maps the model and the rule rows (times in minutes)', () => {
    const model = {
      days: [{ id: 'd1', index: 2, slots: 3, startMinutes: 540, slotMinutes: 30, gapMinutes: 0, mentorIds: ['m1'], locked: true }],
      sessions: [{ dayId: 'd1', slot: 1, mentorId: 'm1', companyId: 'c1', manual: true }],
      config: { uniquePairing: false },
    }
    const input = toMatchingInput(model, [{ mentor_item_id: 'm1', days: [2], max_slots: 3, available_from: '09:30:00', available_to: null }], ['c1'], { scope: 'unlocked', seed: 5 })
    expect(input.days[0]).toMatchObject({ id: 'd1', dayIndex: 2, locked: true })
    expect(input.rules.m1).toEqual({ days: [2], maxSlots: 3, from: 570, to: null })
    expect(input.existing[0]).toMatchObject({ dayId: 'd1', slotIndex: 1, manual: true })
    expect(input.uniquePairing).toBe(false)
  })

  it('stays fast for a large event (30 mentors, 100 companies, 3 days x 12 slots)', () => {
    const mentors = ids('m', 30)
    const days = [0, 1, 2].map((i) => day({ id: `d${i}`, dayIndex: i, slots: 12, mentorIds: mentors }))
    const t0 = Date.now()
    const r = generateDistribution({ days, companyIds: ids('c', 100), seed: 1, attempts: 2 })
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(r.stats.unmatched).toBe(0)
    checkInvariants(r)
  })
})
