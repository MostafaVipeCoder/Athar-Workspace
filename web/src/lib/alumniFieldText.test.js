import { describe, expect, it } from 'vitest'
import { fieldKind, formatFieldText, isEmptyValue } from './alumniFieldText.js'

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

