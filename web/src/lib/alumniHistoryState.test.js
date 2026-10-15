import { describe, expect, it } from 'vitest'
import { dayBound } from './alumniHistory.js'
import { activeHistoryFilterCount, HISTORY_FIELDS, mergeHistorySearch, parseHistoryState, serializeHistoryState, toHistoryFilters, toRpcHistoryFilters } from './alumniHistoryState.js'

const ID = '00000000-0000-4000-8000-00000000c601'

describe('history URL state', () => {
  it('defaults and a clean URL for them', () => {
    expect(parseHistoryState('')).toEqual({ filters: {}, page: 1, size: 25 })
    expect(serializeHistoryState({ filters: {}, page: 1, size: 25 })).toBe('')
  })
  it('round trip of every filter', () => {
    const s = parseHistoryState(`company_id=${ID}&founder_id=${ID}&entity_type=snapshot&field=revenue_total&year=2024&source=manager&actor_role=alumni_manager&from=2026-01-01&to=2026-10-15&q=nile&page=3&size=50`)
    expect(s.filters).toEqual({ company_id: ID, founder_id: ID, entity_type: 'snapshot', field: 'revenue_total', year: '2024', source: 'manager', actor_role: 'alumni_manager', from: '2026-01-01', to: '2026-10-15', q: 'nile' })
    expect(s.page).toBe(3)
    expect(s.size).toBe(50)
    expect(parseHistoryState(serializeHistoryState(s))).toEqual(s)
  })
  it('bad values are ignored (a made-up id, an unknown area, a year of the wrong shape, a date with a time)', () => {
    expect(toHistoryFilters({ company_id: 'nope', entity_type: 'x', source: 'x', actor_role: 'x', year: '24', from: '2026-01-01T00:00', to: 'tomorrow', field: 'a b', q: '  ' })).toEqual({})
    expect(parseHistoryState('size=7&page=-1')).toEqual({ filters: {}, page: 1, size: 25 })
  })
  it('a filter change keeps the other URL parameters (the language)', () => {
    const next = mergeHistorySearch(new URLSearchParams(`lang=ar&field=sector&page=2`), { filters: { entity_type: 'company' }, page: 1, size: 25 })
    expect(next.get('lang')).toBe('ar')
    expect(next.get('entity_type')).toBe('company')
    expect(next.has('field')).toBe(false)
    expect(next.has('page')).toBe(false)
  })
  it('counts the filters of the panel, not the company and the search text', () => {
    expect(activeHistoryFilterCount({ company_id: ID, q: 'x', source: 'manager', year: '2024' })).toBe(2)
  })
  it('the RPC filters: dates become inclusive instants, everything else is passed as it is', () => {
    const r = toRpcHistoryFilters({ company_id: ID, from: '2026-10-01', to: '2026-10-15', year: '2024' }, dayBound)
    expect(r.company_id).toBe(ID)
    expect(r.year).toBe('2024')
    expect(new Date(r.from).getTime()).toBeLessThan(new Date(r.to).getTime())
    expect(toRpcHistoryFilters({ from: 'x' }, dayBound)).toEqual({})
  })
  it('lists every field a manager can narrow to, grouped by area', () => {
    expect(HISTORY_FIELDS.map(([area]) => area)).toEqual(['company', 'snapshot', 'founder', 'identity', 'team', 'internal'])
    expect(HISTORY_FIELDS.find(([a]) => a === 'identity')[1]).toContain('national_id')
  })
})
