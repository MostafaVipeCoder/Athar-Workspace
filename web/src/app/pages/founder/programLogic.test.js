import { describe, expect, it } from 'vitest'
import { nextUp, safeMapUrl, slotTitle, splitPrograms, statusTone, visibleBlocks } from './programLogic.js'

const slot = (id, start, end, en, ar = '') => ({ id, start_time: `${start}:00`, end_time: end ? `${end}:00` : null, title_en: en, title_ar: ar, bullets: [] })
const day = (id, date, slots, name = '') => ({ id, sort_order: 0, day_date: date, name_en: name, name_ar: null, slots })
const DAYS = [
  day('d1', '2030-03-10', [slot('s1', '09:00', '10:00', 'Opening', 'الافتتاح'), slot('s2', '10:30', '12:00', 'Workshop')]),
  day('d2', '2030-03-12', [slot('s3', '09:30', '10:30', 'Demo day')]),
  day('d0', null, [slot('s0', '08:00', '09:00', 'No date')]),
]
// Asia/Riyadh = UTC+3, no DST: 2030-03-10 09:30 local = 06:30Z
const at = (iso) => new Date(iso)

describe('statusTone / splitPrograms / safeMapUrl', () => {
  it('maps the three participant statuses to tones, unknown to neutral', () => {
    expect([statusTone('accepted'), statusTone('attended'), statusTone('withdrawn'), statusTone('x')]).toEqual(['blue', 'green', 'red', 'neutral'])
  })
  it('keeps withdrawn participations apart from the list', () => {
    const { active, withdrawn } = splitPrograms([{ project_id: 'a', status: 'accepted' }, { project_id: 'b', status: 'withdrawn' }, { project_id: 'c', status: 'attended' }])
    expect(active.map((p) => p.project_id)).toEqual(['a', 'c'])
    expect(withdrawn.map((p) => p.project_id)).toEqual(['b'])
    expect(splitPrograms(null)).toEqual({ active: [], withdrawn: [] })
  })
  it('renders only http(s) map links', () => {
    expect(safeMapUrl(' https://maps.example/x ')).toBe('https://maps.example/x')
    expect(safeMapUrl('javascript:alert(1)')).toBeNull()
    expect(safeMapUrl('data:text/html,x')).toBeNull()
    expect(safeMapUrl(null)).toBeNull()
  })
})

describe('visibleBlocks', () => {
  const known = (t) => ['description', 'agenda', 'mentors'].includes(t)
  it('keeps the server order, ignores unknown types and gives a stable key', () => {
    const out = visibleBlocks([{ type: 'agenda', data: {} }, { type: 'hologram', data: {} }, { type: 'mentors', node_id: 'n1', data: {} }, null, { type: 'description', data: {} }], known)
    expect(out.map((b) => b.key)).toEqual(['agenda', 'mentors-n1', 'description'])
  })
  it('tolerates a missing list', () => {
    expect(visibleBlocks(undefined, known)).toEqual([])
  })
})

describe('nextUp (project-zone clock)', () => {
  it('is "now" while a session is running (09:30 in Riyadh on day 1 = the Opening)', () => {
    const n = nextUp(DAYS, 'Asia/Riyadh', at('2030-03-10T06:30:00Z'))
    expect(n.kind).toBe('now')
    expect(n.slot.title.en).toBe('Opening')
  })
  it('is "next" between two sessions of today', () => {
    const n = nextUp(DAYS, 'Asia/Riyadh', at('2030-03-10T07:15:00Z')) // 10:15 local
    expect(n.kind).toBe('next')
    expect(n.slot.title.en).toBe('Workshop')
  })
  it('is "upcoming" with the first session of the next dated day once today is over, and before the first day', () => {
    expect(nextUp(DAYS, 'Asia/Riyadh', at('2030-03-10T12:00:00Z'))).toMatchObject({ kind: 'upcoming', day: { date: '2030-03-12' }, slot: { title: { en: 'Demo day' } } })
    expect(nextUp(DAYS, 'Asia/Riyadh', at('2030-03-01T12:00:00Z'))).toMatchObject({ kind: 'upcoming', day: { date: '2030-03-10' } })
  })
  it('uses the PROJECT zone, not the browser zone: 23:30Z on the 9th is already 02:30 on the 10th in Riyadh', () => {
    expect(nextUp(DAYS, 'Asia/Riyadh', at('2030-03-09T23:30:00Z'))).toMatchObject({ kind: 'next', day: { date: '2030-03-10' }, slot: { title: { en: 'Opening' } } })
    // in Los Angeles 06:30Z on the 10th is still the 9th evening: the Opening (09:30 Riyadh) is NOT running there, it is only upcoming
    expect(nextUp(DAYS, 'America/Los_Angeles', at('2030-03-10T06:30:00Z'))?.kind).toBe('upcoming')
  })
  it('is null when everything is over, when there are no days, and days without a date are never placed on the clock', () => {
    expect(nextUp(DAYS, 'Asia/Riyadh', at('2030-04-01T00:00:00Z'))).toBeNull()
    expect(nextUp([], 'Asia/Riyadh')).toBeNull()
    expect(nextUp([day('x', null, [slot('q', '09:00', '10:00', 'Undated')])], 'Asia/Riyadh')).toBeNull()
  })
  it('picks the Arabic title when asked', () => {
    const n = nextUp(DAYS, 'Asia/Riyadh', at('2030-03-10T06:30:00Z'))
    expect(slotTitle(n.slot, 'ar')).toBe('الافتتاح')
    expect(slotTitle(n.slot, 'en')).toBe('Opening')
    expect(slotTitle({ title: { en: 'Only English', ar: '' } }, 'ar')).toBe('Only English')
  })
})
