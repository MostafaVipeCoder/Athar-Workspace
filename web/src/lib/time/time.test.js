import { describe, it, expect } from 'vitest'
import {
  isValidTimeZone, resolveTimeZone, toInstant, dateInTz, timeInTz, todayInTz, offsetMinutes, wallClock, minutesOfDayInTz,
  secondsOfDayInTz, formatInTz, describeTimeZone, DEFAULT_TIMEZONE,
} from './tz.js'
import {
  parseHHMM, formatHHMM, to12h, slotsBetween, slotsFrom, roundMinutes, slotsPerRound, isWithinNotice, currentSlotIndex,
  secondsUntilSlotEnd, resolveDayConfig, ADVANCE_NOTICE_OPTIONS, DEFAULTS,
} from './slots.js'
import { formatCalendarDate, formatDateTime, formatRelative } from './format.js'

describe('tz', () => {
  it('validates IANA zones and falls back to the project default', () => {
    expect(isValidTimeZone('Africa/Cairo')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(resolveTimeZone('Mars/Olympus')).toBe(DEFAULT_TIMEZONE)
    expect(resolveTimeZone(undefined)).toBe('Africa/Cairo')
  })

  it('toInstant builds the instant of a wall-clock time in the PROJECT zone (CON-1 fix), not UTC/browser midnight', () => {
    // Cairo is UTC+2 in January 2026 (no DST then)
    expect(toInstant('2026-01-15', '09:30', 'Africa/Cairo').toISOString()).toBe('2026-01-15T07:30:00.000Z')
    // and UTC+3 in July (DST since 2023)
    expect(toInstant('2026-07-15', '09:30', 'Africa/Cairo').toISOString()).toBe('2026-07-15T06:30:00.000Z')
    expect(toInstant('2026-07-15', '09:30', 'UTC').toISOString()).toBe('2026-07-15T09:30:00.000Z')
    expect(toInstant('2026-07-15', '09:30', 'Asia/Riyadh').toISOString()).toBe('2026-07-15T06:30:00.000Z')
    expect(toInstant('2026-07-15', undefined, 'UTC').toISOString()).toBe('2026-07-15T00:00:00.000Z')
  })

  it('toInstant rejects malformed input', () => {
    expect(toInstant('15/07/2026', '09:30')).toBeNull()
    expect(toInstant('2026-07-15', '25:00')).toBeNull()
    expect(toInstant('', '09:30')).toBeNull()
  })

  it('round-trips instant -> wall clock in the zone', () => {
    const i = toInstant('2026-09-10', '13:30', 'Africa/Cairo')
    expect(dateInTz(i, 'Africa/Cairo')).toBe('2026-09-10')
    expect(timeInTz(i, 'Africa/Cairo')).toBe('13:30')
    expect(timeInTz(i, 'UTC')).toBe('10:30')
    expect(wallClock(i, 'Africa/Cairo')).toMatchObject({ year: 2026, month: 9, day: 10, hour: 13, minute: 30, weekday: 4 })
    expect(minutesOfDayInTz(i, 'Africa/Cairo')).toBe(13 * 60 + 30)
    expect(secondsOfDayInTz(i, 'Africa/Cairo')).toBe((13 * 60 + 30) * 60)
  })

  it('"today" follows the project zone (CON-10): 23:30 UTC is already tomorrow in Cairo', () => {
    const now = new Date('2026-03-01T23:30:00Z')
    expect(todayInTz('Africa/Cairo', now)).toBe('2026-03-02')
    expect(todayInTz('UTC', now)).toBe('2026-03-01')
  })

  it('offsets and midnight edge (hour 24 -> 0)', () => {
    expect(offsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Africa/Cairo')).toBe(120)
    expect(offsetMinutes(new Date('2026-07-15T00:00:00Z'), 'Africa/Cairo')).toBe(180)
    expect(timeInTz(new Date('2026-01-14T22:00:00Z'), 'Africa/Cairo')).toBe('00:00')
  })

  it('formats for ar/en with Western digits', () => {
    const i = toInstant('2026-09-10', '13:30', 'Africa/Cairo')
    expect(formatInTz(i, 'Africa/Cairo', 'en', { timeStyle: 'short' })).toMatch(/13:30/)
    const ar = formatInTz(i, 'Africa/Cairo', 'ar', { dateStyle: 'medium' })
    expect(ar).toMatch(/2026/)
    expect(ar).not.toMatch(/[٠-٩]/)
    expect(formatInTz(null, 'Africa/Cairo', 'en')).toBe('')
    expect(formatInTz('garbage', 'Africa/Cairo', 'en')).toBe('')
    expect(describeTimeZone('Africa/Cairo', 'en', new Date('2026-07-01T00:00:00Z'))).toBe('Africa/Cairo (GMT+3)')
  })
})

describe('slots', () => {
  it('constants match the as-is vocabulary', () => {
    expect(ADVANCE_NOTICE_OPTIONS).toEqual([0, 30, 60, 120, 360, 720, 1440, 2880])
    expect(DEFAULTS).toEqual({ noticeMinutes: 1440, slotMinutes: 30, gapMinutes: 5, seats: 1 })
  })

  it('HH:MM parse/format and 12-hour text', () => {
    expect(parseHHMM('09:05')).toBe(545)
    expect(parseHHMM('9:05:30')).toBe(545)
    expect(parseHHMM('24:00')).toBeNull()
    expect(parseHHMM('abc')).toBeNull()
    expect(formatHHMM(545)).toBe('09:05')
    expect(formatHHMM(1500)).toBe('01:00')
    expect(to12h('13:30')).toBe('1:30 PM')
    expect(to12h('00:15')).toBe('12:15 AM')
    expect(to12h('12:00', 'ar')).toBe('12:00 م')
    expect(to12h(9 * 60, 'ar')).toBe('9:00 ص')
    expect(to12h('x')).toBe('')
  })

  it('slotsBetween inserts gaps between slots and keeps only whole slots', () => {
    const s = slotsBetween('09:00', '10:30', 30, 15)
    expect(s.map((x) => [x.start, x.end])).toEqual([['09:00', '09:30'], ['09:45', '10:15']])
    expect(slotsBetween('09:00', '09:00', 30)).toEqual([])
    expect(slotsBetween('10:00', '09:00', 30)).toEqual([])
    expect(slotsBetween('09:00', '10:00', 0)).toEqual([])
    expect(slotsBetween(540, 600, 30, 0)).toHaveLength(2)
  })

  it('slotsFrom / roundMinutes / slotsPerRound agree (01-7: round = slots + gaps)', () => {
    const s = slotsFrom('10:00', 3, 20, 5)
    expect(s.map((x) => x.start)).toEqual(['10:00', '10:25', '10:50'])
    expect(roundMinutes(3, 20, 5)).toBe(70)
    expect(slotsPerRound(70, 20, 5)).toBe(3)
    expect(slotsPerRound(60, 30, 0)).toBe(2)
    expect(roundMinutes(0, 20, 5)).toBe(0)
  })

  it('notice window', () => {
    const now = new Date('2026-05-01T10:00:00Z')
    expect(isWithinNotice(new Date('2026-05-01T12:00:00Z'), 60, now)).toBe(false)
    expect(isWithinNotice(new Date('2026-05-01T10:30:00Z'), 60, now)).toBe(true)
    expect(isWithinNotice(new Date('2026-05-03T10:00:00Z'), undefined, now)).toBe(false) // default 24 h
    expect(isWithinNotice(null, 60, now)).toBe(false)
  })

  it('current slot and seconds until end work on project wall-clock minutes', () => {
    const slots = slotsBetween('09:00', '10:00', 30, 0)
    expect(currentSlotIndex(slots, 9 * 60 + 10)).toBe(0)
    expect(currentSlotIndex(slots, 9 * 60 + 30)).toBe(1)
    expect(currentSlotIndex(slots, 10 * 60)).toBeNull()
    expect(currentSlotIndex(slots, null)).toBeNull()
    expect(secondsUntilSlotEnd(slots[0], (9 * 60 + 29) * 60 + 30)).toBe(30)
    expect(secondsUntilSlotEnd(slots[0], 10 * 3600)).toBe(0)
  })

  it('resolveDayConfig: day overrides win, count derived from end when absent', () => {
    const g = { start: '09:00', slotMinutes: 30, gapMinutes: 5, end: '11:00', mentorIds: ['a', 'b'] }
    expect(resolveDayConfig(g, {})).toEqual({ start: '09:00', slotMinutes: 30, gapMinutes: 5, count: 3, mentorIds: ['a', 'b'], locked: false })
    expect(resolveDayConfig(g, { start: '10:00', count: 2, mentorIds: ['a'], locked: true })).toMatchObject({ start: '10:00', count: 2, mentorIds: ['a'], locked: true })
    expect(resolveDayConfig(undefined, undefined).count).toBe(0)
  })
})

describe('format', () => {
  it('calendar dates never pass through new Date(dateStr)', () => {
    expect(formatCalendarDate('2026-09-10', { lang: 'en' })).toMatch(/10 Sept? 2026|Sept? 10, 2026/)
    expect(formatCalendarDate('bad')).toBe('')
  })
  it('date-time in the project zone', () => {
    expect(formatDateTime('2026-09-10T10:30:00Z', { lang: 'en', tz: 'Africa/Cairo' })).toMatch(/13:30/)
  })
  it('relative time', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(formatRelative('2026-01-01T00:00:30Z', { lang: 'en', now })).toMatch(/30 seconds/)
    expect(formatRelative('2026-01-03T00:00:00Z', { lang: 'en', now })).toMatch(/2 days/)
  })
})
