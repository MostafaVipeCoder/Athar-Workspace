import { describe, expect, it } from 'vitest'
import { DEFAULT_COLUMNS } from './columns.js'
import { activeFilterCount, deleteView, nextSort, pageCount, pageRange, parseState, readColumns, readViews, saveView, serializeState, toRpcFilters, writeColumns } from './adminState.js'

const fakeStorage = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

describe('directory filters', () => {
  it('cleans them for the RPC: empties dropped, integers / booleans coerced, the scope defaults to alumni, unknown keys ignored', () => {
    expect(toRpcFilters({ q: ' nile ', sector: 'technology', governorate: '25', ceo_governorate: 1, incomplete: 'true', reviewed: false, has_female_founder: '', stage: '', bogus: 'x', national_id: '29501010101234' }))
      .toEqual({ q: 'nile', sector: 'technology', governorate: 25, ceo_governorate: 1, incomplete: true, reviewed: false, scope: 'alumni' })
    expect(toRpcFilters({ scope: 'all' }).scope).toBe('all')
    expect(toRpcFilters({ scope: 'weird' }).scope).toBe('alumni')
    expect(toRpcFilters(undefined)).toEqual({ scope: 'alumni' })
    expect(toRpcFilters({ governorate: 'abc' })).toEqual({ scope: 'alumni' })
  })
  it('knows no personal-number filter (a national ID can never travel in a filter / URL)', () => {
    const f = toRpcFilters({ national_id: '29501010101234', id: '29501010101234', ceo_id: '1' })
    expect(JSON.stringify(f)).not.toMatch(/\d{14}/)
    expect(Object.keys(f)).toEqual(['scope'])
  })
  it('counts the active filters (the search text and the scope are shown apart)', () => {
    expect(activeFilterCount({ q: 'x', scope: 'all' })).toBe(0)
    expect(activeFilterCount({ sector: 'a', stage: 'mvp', incomplete: true })).toBe(3)
  })
})

describe('table state in the URL', () => {
  it('round-trips and writes a clean URL for the defaults', () => {
    expect(serializeState({ filters: { scope: 'alumni' }, sort: 'name', dir: 'asc', page: 1, size: 25, year: null })).toBe('')
    const s = { filters: { scope: 'candidates', sector: 'technology', ceo_gender: 'female', incomplete: true }, sort: 'revenue', dir: 'desc', page: 3, size: 50, year: 2024 }
    const qs = serializeState(s)
    expect(parseState(qs)).toEqual({ ...s, filters: toRpcFilters(s.filters) })
  })
  it('ignores bad values (page, sort, size, year)', () => {
    expect(parseState('page=-2&sort=password&dir=sideways&size=7&year=1800&sector=a')).toEqual({ filters: { sector: 'a', scope: 'alumni' }, sort: 'name', dir: 'asc', page: 1, size: 25, year: null })
  })
  it('clicking a header: the same key flips the direction, a new key starts ascending', () => {
    expect(nextSort({ sort: 'name', dir: 'asc' }, 'name')).toEqual({ sort: 'name', dir: 'desc' })
    expect(nextSort({ sort: 'name', dir: 'desc' }, 'name')).toEqual({ sort: 'name', dir: 'asc' })
    expect(nextSort({ sort: 'name', dir: 'desc' }, 'revenue')).toEqual({ sort: 'revenue', dir: 'asc' })
  })
  it('pages: at least one, the range of a page', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(141, 25)).toBe(6)
    expect(pageRange(141, 6, 25)).toEqual({ from: 126, to: 141 })
    expect(pageRange(0, 1, 25)).toEqual({ from: 0, to: 0 })
  })
})

describe('per-viewer preferences (guarded storage)', () => {
  it('remembers the columns and falls back to the defaults', () => {
    const st = fakeStorage()
    expect(readColumns(st)).toEqual(DEFAULT_COLUMNS)
    writeColumns(['stage', 'startup_name', 'nope'], st)
    expect(readColumns(st)).toEqual(['startup_name', 'stage'])
  })
  it('saved views: newest first, unique names, filters cleaned, deletable', () => {
    const st = fakeStorage()
    saveView({ name: 'Healthcare', filters: { sector: 'healthcare', secret: 'x' }, sort: 'name', dir: 'asc', columns: ['startup_name'] }, st)
    saveView({ name: 'Closed', filters: { operating_status: 'closed' }, sort: 'updated', dir: 'desc', columns: [] }, st)
    let views = readViews(st)
    expect(views.map((v) => v.name)).toEqual(['Closed', 'Healthcare'])
    expect(views[1].filters).toEqual({ sector: 'healthcare', scope: 'alumni' })
    expect(views[0].columns).toEqual(DEFAULT_COLUMNS)
    saveView({ name: 'healthcare', filters: {}, sort: 'name', dir: 'asc', columns: [] }, st)
    views = readViews(st)
    expect(views.map((v) => v.name)).toEqual(['healthcare', 'Closed'])
    expect(deleteView(views[0].id, st).map((v) => v.name)).toEqual(['Closed'])
    expect(saveView({ name: '  ', filters: {} }, st)).toHaveLength(1)
  })
  it('a blocked or corrupt storage never throws', () => {
    const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    expect(readColumns(broken)).toEqual(DEFAULT_COLUMNS)
    expect(readViews(broken)).toEqual([])
    expect(() => writeColumns(['stage'], broken)).not.toThrow()
    expect(readViews({ getItem: () => '{not json', setItem() {} })).toEqual([])
  })
})
