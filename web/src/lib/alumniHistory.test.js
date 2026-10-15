import { describe, expect, it } from 'vitest'
import { dayBound, dayKey, describeEntry, diffRows, fieldKind, formatFieldText, groupByDay, groupSaves, groupState, historyExportRows, isEmptyValue, isoToLocalInput, localInputToIso, parseStateKey } from './alumniHistory.js'

const lookups = {
  sectors: [{ key: 'technology', label_en: 'Technology', label_ar: 'التكنولوجيا', subsectors: [] }],
  stages: [{ key: 'mvp', label_en: 'MVP', label_ar: 'منتج أولي' }],
  governorates: [{ code: 25, name_en: 'Assiut', name_ar: 'أسيوط' }],
}
const t = (k, v) => ({ 'alumni.edit.yes': 'Yes', 'alumni.edit.no': 'No', 'alumni.edit.fileSet': 'An image is set', 'alumni.edit.idExists': 'A national ID is recorded', 'alumni.edit.idNone': 'No national ID', 'alumni.edit.memberAs': `Team member (${v?.role})` }[k] ?? k)
const ctx = { lookups, lang: 'en', t, formatDate: (v) => `D(${String(v).slice(0, 10)})`, formatNumber: (n, o) => (o?.style === 'currency' ? `EGP ${n}` : String(n)) }

describe('fieldKind', () => {
  it('knows how every value is shown', () => {
    expect(fieldKind('sector')).toEqual({ kind: 'lookup', lookup: 'sector' })
    expect(fieldKind('self_gender')).toEqual({ kind: 'lookup', lookup: 'gender' })
    expect(fieldKind('governorate').kind).toBe('governorate')
    expect(fieldKind('is_alumni').kind).toBe('bool')
    expect(fieldKind('established_on').kind).toBe('date')
    expect(fieldKind('reviewed_at').kind).toBe('timestamp')
    expect(fieldKind('revenue_total').kind).toBe('money')
    expect(fieldKind('freelancers').kind).toBe('count')
    expect(fieldKind('logo_path').kind).toBe('file')
    expect(fieldKind('national_id').kind).toBe('idflag')
    expect(fieldKind('description_en').kind).toBe('text')
  })
})

describe('formatFieldText', () => {
  it('lookups use the label in the viewer language, an unknown key is shown as it is', () => {
    expect(formatFieldText('sector', 'technology', ctx)).toBe('Technology')
    expect(formatFieldText('sector', 'technology', { ...ctx, lang: 'ar' })).toBe('التكنولوجيا')
    expect(formatFieldText('stage', 'old_value', ctx)).toBe('old_value')
    expect(formatFieldText('governorate', 25, ctx)).toBe('Assiut')
  })
  it('booleans, dates, money, files and links', () => {
    expect(formatFieldText('is_alumni', true, ctx)).toBe('Yes')
    expect(formatFieldText('directory_hidden', false, ctx)).toBe('No')
    expect(formatFieldText('established_on', '2021-03-01', ctx)).toBe('D(2021-03-01)')
    expect(formatFieldText('revenue_total', '150.00', ctx)).toBe('EGP 150')
    expect(formatFieldText('logo_path', true, ctx)).toBe('An image is set')
    expect(formatFieldText('links', [{ kind: 'facebook', url: 'https://f.example.com' }, { kind: 'other', label: 'Deck', url: 'https://d.example.com' }], ctx)).toBe('facebook: https://f.example.com; Deck: https://d.example.com')
    expect(formatFieldText('member', { role: 'CTO', is_primary: false }, ctx)).toBe('Team member (CTO)')
  })
  it('the national ID is only ever "recorded / not recorded"', () => {
    expect(formatFieldText('national_id', true, ctx)).toBe('A national ID is recorded')
    expect(formatFieldText('national_id', false, ctx)).toBe('No national ID')
  })
  it('empty values are empty strings; false and 0 are values', () => {
    expect(formatFieldText('description_en', null, ctx)).toBe('')
    expect(formatFieldText('description_en', '', ctx)).toBe('')
    expect(formatFieldText('links', [], ctx)).toBe('')
    expect(formatFieldText('employees_total', 0, ctx)).toBe('0')
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue(false)).toBe(false)
  })
})

describe('describeEntry', () => {
  const e = (field, old_value, new_value) => ({ field, old_value, new_value })
  it('says what happened', () => {
    expect(describeEntry(e('created', null, { name_en: 'X' }))).toBe('created')
    expect(describeEntry(e('removed', { name_en: 'X' }, null))).toBe('removed')
    expect(describeEntry(e('member', null, { role: 'CTO' }))).toBe('member_added')
    expect(describeEntry(e('member', { role: 'CTO' }, null))).toBe('member_removed')
    expect(describeEntry(e('national_id', false, true))).toBe('id_set')
    expect(describeEntry(e('national_id', true, true))).toBe('id_changed')
    expect(describeEntry(e('national_id', true, false))).toBe('id_cleared')
    expect(describeEntry(e('sector', null, 'technology'))).toBe('set')
    expect(describeEntry(e('sector', 'technology', null))).toBe('cleared')
    expect(describeEntry(e('sector', 'technology', 'retail'))).toBe('changed')
    expect(describeEntry(e('app_url', 'https://a.example.com', 'https://a.example.com'))).toBe('nochange')
  })
})

describe('grouping', () => {
  const rows = [
    { id: 5, at: '2026-10-15T10:00:00Z', last_at: '2026-10-15T10:00:00Z', request_id: 'r2', source: 'manager', actor: { user_id: 'u1', role: 'alumni_manager' }, field: 'stage' },
    { id: 4, at: '2026-10-15T10:00:00Z', last_at: '2026-10-15T10:00:00Z', request_id: 'r2', source: 'manager', actor: { user_id: 'u1', role: 'alumni_manager' }, field: 'sector' },
    { id: 3, at: '2026-10-15T09:00:00Z', last_at: '2026-10-15T09:00:00Z', request_id: 'r1', source: 'founder', actor: { user_id: 'u2', role: 'founder' }, field: 'sector' },
    { id: 2, at: '2026-10-14T23:30:00Z', last_at: '2026-10-14T23:30:00Z', request_id: null, source: 'system', actor: { role: 'system' }, field: 'created' },
  ]
  it('entries of one save (same request and editor) become one group', () => {
    const g = groupSaves(rows)
    expect(g.map((x) => x.rows.map((r) => r.id))).toEqual([[5, 4], [3], [2]])
  })
  it('a different editor in the same request is a different group; a missing request id never merges', () => {
    expect(groupSaves([{ ...rows[0] }, { ...rows[1], actor: { user_id: 'u9', role: 'founder' } }])).toHaveLength(2)
    expect(groupSaves([{ ...rows[3], id: 7 }, { ...rows[3], id: 8 }])).toHaveLength(2)
  })
  it('days follow the Cairo calendar (23:30 UTC is already the next day in Cairo)', () => {
    expect(dayKey('2026-10-14T23:30:00Z')).toBe('2026-10-15')
    expect(dayKey('2026-10-14T23:30:00Z', 'UTC')).toBe('2026-10-14')
    expect(groupByDay(groupSaves(rows)).map((d) => [d.day, d.groups.length])).toEqual([['2026-10-15', 3]])
    expect(dayKey('not a date')).toBe('')
  })
})

describe('the replayed state', () => {
  it('parses every kind of key', () => {
    expect(parseStateKey('company.sector')).toEqual({ scope: 'company', field: 'sector' })
    expect(parseStateKey('internal.hint')).toEqual({ scope: 'internal', field: 'hint' })
    expect(parseStateKey('year.2024.revenue_total')).toEqual({ scope: 'year', year: 2024, field: 'revenue_total' })
    expect(parseStateKey('team.00000000-0000-4000-8000-00000000f601.role')).toEqual({ scope: 'team', founderId: '00000000-0000-4000-8000-00000000f601', field: 'role' })
    expect(parseStateKey('founder.00000000-0000-4000-8000-00000000f601.phone').scope).toBe('founder')
    expect(parseStateKey('nope')).toBeNull()
    expect(parseStateKey('year.24.x.y')).toBeNull()
  })
  it('groups a flat map into company / internal / years (newest first) / the team (CEO first, only members)', () => {
    const fields = {
      'company.stage': 'mvp', 'company.name_en': 'Nile', 'company.sector': 'technology', 'internal.hint': 'strong',
      'year.2023.revenue_total': 50, 'year.2024.revenue_total': 150, 'year.2024.employees_total': 5,
      'team.f1.member': true, 'team.f1.role': 'CEO', 'team.f1.is_primary': true, 'founder.f1.name_en': 'Sara',
      'team.f2.member': true, 'team.f2.role': 'CTO', 'team.f2.is_primary': false,
      'founder.f3.name_en': 'Left', 'team.f3.role': 'old',
    }
    const g = groupState(fields)
    expect(g.company.map((r) => r.field)).toEqual(['name_en', 'sector', 'stage'])
    expect(g.internal).toEqual([{ field: 'hint', value: 'strong' }])
    expect(g.years.map((y) => [y.year, y.rows.length])).toEqual([[2024, 2], [2023, 1]])
    expect(g.team.map((p) => [p.founderId, p.role, p.is_primary, p.rows.length])).toEqual([['f1', 'CEO', true, 1], ['f2', 'CTO', false, 0]])
  })
  it('turns a diff into rows with the kind of change', () => {
    const rows = diffRows([{ key: 'company.sector', from: 'technology', to: 'retail' }, { key: 'internal.hint', from: null, to: 'H1' }, { key: 'year.2024.freelancers', from: 2, to: null }, { key: 'garbage', from: 1, to: 2 }])
    expect(rows.map((r) => [r.key, r.kind])).toEqual([['company.sector', 'changed'], ['internal.hint', 'added'], ['year.2024.freelancers', 'removed']])
    expect(rows[2].year).toBe(2024)
  })
})

describe('date helpers', () => {
  it('datetime-local <-> ISO round trip', () => {
    const iso = localInputToIso('2026-10-15T09:30')
    expect(iso).toMatch(/^2026-10-1[45]T/)
    expect(isoToLocalInput(iso)).toBe('2026-10-15T09:30')
    expect(localInputToIso('')).toBeNull()
    expect(localInputToIso('garbage')).toBeNull()
    expect(isoToLocalInput('garbage')).toBe('')
  })
  it('day bounds are inclusive instants', () => {
    expect(dayBound('2026-10-15', 'start')).not.toBeNull()
    expect(new Date(dayBound('2026-10-15', 'end')) > new Date(dayBound('2026-10-15', 'start'))).toBe(true)
    expect(dayBound('15/10/2026')).toBeNull()
    expect(dayBound('')).toBeNull()
  })
})

describe('the export rows', () => {
  it('one line per entry with readable before / after, the partial flag and the reason', () => {
    const rows = [{ id: 1, at: '2026-10-15T10:00:00Z', last_at: '2026-10-15T10:05:00Z', edits: 2, source: 'manager', entity_type: 'snapshot', period_key: '2024', field: 'revenue_total', old_value: 100, new_value: 150, redacted: false,
      actor: { role: 'alumni_manager', name: 'Mona' }, company: { name_en: 'Nile', name_ar: 'النيل' }, founder: null, reason: 'audited' },
    { id: 2, at: '2026-10-15T10:00:00Z', last_at: '2026-10-15T10:00:00Z', edits: 1, source: 'founder', entity_type: 'founder', field: 'phone', old_value: null, new_value: '+**********78', redacted: true, actor: { role: 'founder' }, company: { name_en: 'Nile' }, founder: { name_en: 'Sara' } }]
    const out = historyExportRows(rows, { ...ctx, fieldLabel: (f) => `L:${f}`, entityLabel: (e) => `E:${e}`, roleLabel: (r) => `R:${r}`, sourceLabel: (s) => `S:${s}` })
    expect(out[0]).toMatchObject({ when: '2026-10-15T10:05:00Z', company: 'Nile', who: 'Mona', role: 'R:alumni_manager', source: 'S:manager', area: 'E:snapshot', field: 'L:revenue_total', year: '2024', before: 'EGP 100', after: 'EGP 150', edits: 2, partial: '', reason: 'audited' })
    expect(out[1]).toMatchObject({ person: 'Sara', before: '', after: '+**********78', partial: '*' })
  })
})
