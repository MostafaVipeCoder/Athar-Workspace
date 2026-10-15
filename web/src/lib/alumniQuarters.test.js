import { describe, expect, it } from 'vitest'
import {
  comparePeriods, companySheetRows, compactNumber, daysLeft, lastChange, needsUpdate, niceMax, niceTicks, nextPeriod, parsePeriod, periodLabel, periodRange, periodShort,
  portfolioSeries, portfolioSheetRows, prevPeriod, quarterSeries, roundPct, statusTone,
} from './alumniQuarters.js'

describe('quarter keys', () => {
  it('parses, steps across a year and refuses bad keys', () => {
    expect(parsePeriod('2026-Q4')).toEqual({ year: 2026, quarter: 4 })
    expect(parsePeriod('2026-Q5')).toBeNull()
    expect(parsePeriod(null)).toBeNull()
    expect(nextPeriod('2026-Q4')).toBe('2027-Q1')
    expect(prevPeriod('2027-Q1')).toBe('2026-Q4')
    expect(nextPeriod('x')).toBeNull()
    expect(comparePeriods('2026-Q4', '2027-Q1')).toBeLessThan(0)
  })
  it('builds a continuous range', () => {
    expect(periodRange('2025-Q4', '2026-Q2')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2'])
    expect(periodRange('2026-Q2', '2025-Q4')).toEqual([])
  })
  it('labels in both languages', () => {
    expect(periodLabel('2026-Q4', 'en')).toBe('Q4 2026')
    expect(periodLabel('2026-Q4', 'ar')).toBe('الربع الرابع 2026')
    expect(periodShort('2026-Q1', 'en')).toBe("Q1 '26")
    expect(periodShort('2026-Q1', 'ar')).toBe('ر1 26')
  })
})

describe('status', () => {
  it('maps tones and who owes an update', () => {
    expect(statusTone('confirmed')).toBe('green')
    expect(statusTone('weird')).toBe('outline')
    expect(needsUpdate('not_updated')).toBe(true)
    expect(needsUpdate('updated')).toBe(true)
    expect(needsUpdate('confirmed')).toBe(false)
    expect(needsUpdate('closed')).toBe(false)
  })
  it('counts the days left, the deadline day included', () => {
    expect(daysLeft('2026-12-31', new Date(2026, 11, 28))).toBe(4)
    expect(daysLeft('2026-12-31', new Date(2026, 11, 31))).toBe(1)
    expect(daysLeft(null)).toBeNull()
  })
})

const snaps = [
  { period_key: '2026-Q2', reported: true, revenue_total: '300', employees_total: 15, corrected: false },
  { period_key: '2025-Q4', reported: true, revenue_total: '100', employees_total: 10, corrected: true, previous_values: { revenue_total: 10 } },
  { period_key: '2026-Q1', reported: false, revenue_total: '999999', employees_total: 99 }, // carried forward: NOT a data point
]

describe('quarterSeries', () => {
  it('is continuous, oldest first, and an un-reported quarter is a gap (the carried value never shows)', () => {
    const s = quarterSeries(snaps, 'revenue_total')
    expect(s.map((p) => p.key)).toEqual(['2025-Q4', '2026-Q1', '2026-Q2'])
    expect(s.map((p) => p.value)).toEqual([100, null, 300])
  })
  it('keeps the corrected flag and the original frozen value', () => {
    const [first] = quarterSeries(snaps, 'revenue_total')
    expect(first.corrected).toBe(true)
    expect(first.previous).toBe(10)
  })
  it('fills a missing quarter with a gap that does not exist', () => {
    const s = quarterSeries([{ period_key: '2025-Q1', reported: true, revenue_total: 1 }, { period_key: '2025-Q3', reported: true, revenue_total: 2 }], 'revenue_total')
    expect(s.map((p) => [p.key, p.value, p.exists])).toEqual([['2025-Q1', 1, true], ['2025-Q2', null, false], ['2025-Q3', 2, true]])
  })
  it('returns nothing without snapshots', () => {
    expect(quarterSeries([], 'revenue_total')).toEqual([])
    expect(quarterSeries(null, 'revenue_total')).toEqual([])
  })
})

describe('lastChange', () => {
  it('compares the latest value with the previous one that has a value, across a gap', () => {
    const c = lastChange(quarterSeries(snaps, 'revenue_total'))
    expect(c).toMatchObject({ key: '2026-Q2', prevKey: '2025-Q4', delta: 200, pct: 200 })
  })
  it('is null with fewer than two values and has no pct from zero', () => {
    expect(lastChange([{ key: 'a', value: 1 }])).toBeNull()
    expect(lastChange([{ key: 'a', value: 0 }, { key: 'b', value: 5 }]).pct).toBeNull()
  })
})

describe('axis helpers', () => {
  it('rounds the axis up and compacts numbers', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(130)).toBe(200)
    expect(niceMax(2300)).toBe(2500)
    expect(compactNumber(1500)).toBe('1.5K')
    expect(compactNumber(2000000)).toBe('2M')
    expect(compactNumber(42)).toBe('42')
  })
})

describe('niceTicks: whole, distinct axis labels', () => {
  it('counts get whole-number ticks (never 6.3 / 12.5 / 18.8)', () => {
    expect(niceTicks(25, { integer: true }).ticks).toEqual([0, 10, 20, 30])
    expect(niceTicks(2, { integer: true }).ticks).toEqual([0, 1, 2])
    expect(niceTicks(0, { integer: true }).ticks).toEqual([0, 1])
  })
  it('a small percent keeps decimals so two ticks never print the same label', () => {
    const t = niceTicks(1.2)
    expect(t.ticks).toEqual([0, 0.5, 1, 1.5])
    expect(new Set(t.ticks.map((v) => Math.round(v * 10) / 10)).size).toBe(t.ticks.length)
  })
  it('large money axes stay on 1 / 2 / 5 steps and cover the maximum', () => {
    const t = niceTicks(2300000, { integer: true })
    expect(t.step).toBe(1000000)
    expect(t.max).toBeGreaterThanOrEqual(2300000)
  })
})

describe('roundPct', () => {
  it('whole numbers from 10, one decimal below, and never -100% for a change that is not exactly -100%', () => {
    expect(roundPct(200)).toBe(200)
    expect(roundPct(12.5)).toBe(13)
    expect(roundPct(4.26)).toBe(4.3)
    expect(roundPct(-99.6)).toBe(-99.6)
    expect(roundPct(-99.96)).toBe(-99.9)
    expect(roundPct(-100)).toBe(-100)
    expect(lastChange([{ key: 'a', value: 5000 }, { key: 'b', value: 20 }]).pct).toBe(-99.6)
  })
})

describe('portfolio + sheets', () => {
  const periods = [
    { period_key: '2026-Q1', reporting: 0, revenue_total: null, survival_rate: null, corrected: 0 },
    { period_key: '2026-Q2', reporting: 2, revenue_total: '700', survival_rate: 75, corrected: 1 },
  ]
  it('keeps a period without data as a gap and flags corrections', () => {
    const s = portfolioSeries(periods, 'revenue_total')
    expect(s.map((p) => p.value)).toEqual([null, 700])
    expect(s[1].corrected).toBe(true)
  })
  it('builds the sheets with translated headers and the rows in order', () => {
    const rows = portfolioSheetRows(periods, { period_key: 'Quarter', revenue_total: 'Revenue' })
    expect(rows[0].slice(0, 2)).toEqual(['Quarter', 'companies'])
    expect(rows[2][0]).toBe('2026-Q2')
    const co = companySheetRows(snaps, { period_key: 'Quarter' })
    expect(co.slice(1).map((r) => r[0])).toEqual(['2025-Q4', '2026-Q1', '2026-Q2'])
  })
})
