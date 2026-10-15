import { describe, expect, it, vi } from 'vitest'
import { activeAttFilterCount, attentionExportRows, fixPath, mergeAttSearch, normalizeRules, parseAttState, readRules, serializeAttState, toAttFilters, visibleMissing, writeRules } from './alumniAttention.js'

describe('URL state', () => {
  it('defaults: every company, the worst first, page 1 of 25; a clean URL for the default view', () => {
    const s = parseAttState('')
    expect(s).toEqual({ filters: { scope: 'all' }, sort: 'missing', page: 1, size: 25 })
    expect(serializeAttState(s)).toBe('')
  })
  it('round trip of every filter; unknown keys and bad values are ignored', () => {
    const s = parseAttState('scope=candidates&q=nile&missing=sector&severity=required&has_account=false&invited=true&sort=name&page=3&size=50&zzz=1&program_id=abc')
    expect(s).toEqual({ filters: { scope: 'candidates', q: 'nile', missing: 'sector', severity: 'required', has_account: false, invited: true, program_id: 'abc' }, sort: 'name', page: 3, size: 50 })
    expect(parseAttState(serializeAttState(s))).toEqual(s)
    expect(parseAttState('scope=nope&severity=huge&sort=nope&size=7&page=-2&has_account=maybe').filters).toEqual({ scope: 'all' })
    expect(parseAttState('sort=nope&size=7&page=-2')).toMatchObject({ sort: 'missing', size: 25, page: 1 })
  })
  it('a filter change keeps the unmanaged parameters (the language of the link)', () => {
    const next = mergeAttSearch(new URLSearchParams('lang=ar&missing=sector&page=2'), { filters: { scope: 'all', q: 'x' }, sort: 'missing', page: 1, size: 25 })
    expect(next.get('lang')).toBe('ar')
    expect(next.get('q')).toBe('x')
    expect(next.has('missing')).toBe(false)
    expect(next.has('page')).toBe(false)
  })
  it('counts the filters of the panel, not the search text or the scope', () => {
    expect(activeAttFilterCount({ scope: 'alumni', q: 'x', missing: 'sector', invited: true })).toBe(2)
    expect(toAttFilters({ has_account: 'true' })).toEqual({ scope: 'all', has_account: true })
  })
})

describe('chips and links', () => {
  it('a missing CEO hides the three items that depend on him (one root cause)', () => {
    expect(visibleMissing(['ceo', 'ceo_id', 'contact', 'sector', 'ceo_education'])).toEqual(['ceo', 'sector'])
    expect(visibleMissing(['ceo_id', 'sector'])).toEqual(['ceo_id', 'sector'])
    expect(visibleMissing(null)).toEqual([])
  })
  it('fix links go to the section and carry the rule key, never a personal value', () => {
    expect(fixPath('c1', 'sector', 'classification')).toBe('/alumni/admin/company/c1?focus=sector#classification')
    expect(fixPath('c 1', null, null)).toBe('/alumni/admin/company/c%201')
  })
})

describe('the rules that count (a per-viewer choice in the browser)', () => {
  const catalog = ['ceo', 'sector', 'logo']
  it('no saved choice = every rule; unknown keys are dropped; an empty result falls back to every rule', () => {
    expect(normalizeRules(null, catalog)).toEqual(catalog)
    expect(normalizeRules(['sector', 'gone'], catalog)).toEqual(['sector'])
    expect(normalizeRules(['gone'], catalog)).toEqual(catalog)
  })
  it('reads and writes through a storage that may refuse (private window): never throws', () => {
    const mem = new Map()
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) }
    expect(readRules(storage)).toBeNull()
    expect(writeRules(['sector'], storage)).toBe(true)
    expect(readRules(storage)).toEqual(['sector'])
    expect(writeRules(null, storage)).toBe(true)
    expect(readRules(storage)).toBeNull()
    const blocked = { getItem: vi.fn(() => { throw new Error('blocked') }), setItem: vi.fn(() => { throw new Error('blocked') }), removeItem: vi.fn(() => { throw new Error('blocked') }) }
    expect(readRules(blocked)).toBeNull()
    expect(writeRules(['sector'], blocked)).toBe(false)
    mem.set('athar.alumniAdmin.attentionRules.v1', '{"not":"a list"}')
    expect(readRules(storage)).toBeNull()
  })
})

describe('the export rows', () => {
  it('one line per company with a readable list, the contact of the CEO for the follow-up and a link back', () => {
    const ctx = { pickName: (o) => o.name_en ?? '', yes: 'Yes', no: 'No', ruleLabel: (k) => `L:${k}`, link: (id) => `https://app.example.com/alumni/admin/company/${id}` }
    const rows = [{ id: 'c1', name_en: 'Nile', is_alumni: false, completeness_percent: 33, required_missing: 2, recommended_missing: 8, missing: ['ceo', 'sector'], ceo: { name_en: 'Sara', email: 's@example.com', phone: '+20101' }, has_account: false, pending_invitations: 1, last_update: { at: '2026-10-10T00:00:00Z' } },
      { id: 'c2', name_en: 'Delta', is_alumni: true, completeness_percent: 100, required_missing: 0, recommended_missing: 0, missing: [], ceo: null, has_account: true, pending_invitations: 0, last_update: null }]
    expect(attentionExportRows(rows, ctx)).toEqual([
      { company: 'Nile', alumni: 'No', completeness: 33, required: 2, recommended: 8, missing: 'L:ceo; L:sector', ceo: 'Sara', email: 's@example.com', phone: '+20101', account: 'No', invitation: 'Yes', updated: '2026-10-10T00:00:00Z', link: 'https://app.example.com/alumni/admin/company/c1' },
      { company: 'Delta', alumni: 'Yes', completeness: 100, required: 0, recommended: 0, missing: '', ceo: '', email: '', phone: '', account: 'Yes', invitation: 'No', updated: '', link: 'https://app.example.com/alumni/admin/company/c2' },
    ])
  })
})
