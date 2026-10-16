import { describe, expect, it } from 'vitest'
import { completenessTone, diffPatch, digitsOnly, lookupLabel, lookupOptions, parseAlumniError, subsectorOptions } from './alumni.js'

const lookups = {
  governorates: [
    { code: 25, key: 'assiut', name_en: 'Assiut', name_ar: 'أسيوط', is_abroad: false },
    { code: 88, key: 'abroad', name_en: 'Born abroad', name_ar: 'مولود بالخارج', is_abroad: true },
  ],
  sectors: [
    { key: 'technology', label_en: 'Technology', label_ar: 'التكنولوجيا', sort: 40, active: true, subsectors: [
      { key: 'robotics', label_en: 'Robotics', label_ar: 'الروبوتات', sort: 40, active: true },
      { key: 'drones', label_en: 'Drones', label_ar: 'الطائرات المسيّرة', sort: 50, active: false },
    ] },
    { key: 'agriculture', label_en: 'Agriculture', label_ar: 'الزراعة', sort: 10, active: true, subsectors: [] },
  ],
  stages: [{ key: 'mvp', label_en: 'MVP', label_ar: 'منتج أولي', sort: 40, active: true }, { key: 'idea_stage', label_en: 'Idea stage', label_ar: 'الفكرة', sort: 10, active: true }],
  genders: [{ key: 'male', label_en: 'Male', label_ar: 'ذكر', sort: 10, active: true }],
}

describe('digitsOnly (formatting only: the database validates the ID)', () => {
  it('converts Arabic-Indic and Persian digits, drops everything else, clamps to 14', () => {
    expect(digitsOnly('٢٩٥٠١٠١٠١٠١٢٣٤')).toBe('29501010101234')
    expect(digitsOnly('2 9501-01.01 0123 4')).toBe('29501010101234')
    expect(digitsOnly('۲۹۵۰۱۰۱۰۱۰۱۲۳۴۵۶۷')).toBe('29501010101234')
    expect(digitsOnly('abc')).toBe('')
    expect(digitsOnly(null)).toBe('')
    expect(digitsOnly('12345', 3)).toBe('123')
  })
})

describe('lookup labels and options', () => {
  it('labels a value in the UI language and falls back to the key', () => {
    expect(lookupLabel(lookups, 'stage', 'mvp', 'ar')).toBe('منتج أولي')
    expect(lookupLabel(lookups, 'stage', 'unknown_key', 'en')).toBe('unknown_key')
    expect(lookupLabel(lookups, 'sector', 'technology', 'en')).toBe('Technology')
    expect(lookupLabel(lookups, 'subsector', 'robotics', 'ar')).toBe('الروبوتات')
    expect(lookupLabel(lookups, 'governorate', 25, 'ar')).toBe('أسيوط')
    expect(lookupLabel(lookups, 'governorate', '25', 'en')).toBe('Assiut')
    expect(lookupLabel(lookups, 'gender', null, 'en')).toBe('')
    expect(lookupLabel(null, 'stage', 'mvp', 'en')).toBe('mvp')
  })

  it('builds options in the server order, hides inactive values unless current, drops 88 from company locations', () => {
    expect(lookupOptions(lookups, 'stage', 'en').map((o) => o.value)).toEqual(['idea_stage', 'mvp'])
    expect(lookupOptions(lookups, 'sector', 'en').map((o) => o.value)).toEqual(['agriculture', 'technology'])
    expect(lookupOptions(lookups, 'governorate', 'en')).toEqual([{ value: 25, label: 'Assiut' }])
    expect(lookupOptions(lookups, 'governorate', 'ar', { includeAbroad: true }).map((o) => o.value)).toEqual([25, 88])
    expect(subsectorOptions(lookups, 'technology', 'en').map((o) => o.value)).toEqual(['robotics'])
    expect(subsectorOptions(lookups, 'technology', 'en', { current: 'drones' }).map((o) => o.value)).toEqual(['robotics', 'drones'])
    expect(subsectorOptions(lookups, null, 'en')).toEqual([])
    expect(subsectorOptions(lookups, 'agriculture', 'en')).toEqual([])
  })
})

describe('parseAlumniError', () => {
  it('reads the token and field:reason from an AppError built by data/errors.js', () => {
    const err = { cause: { code: '22023', hint: 'alumni_invalid', message: 'alumni_invalid: stage:unknown' }, detail: 'stage:unknown' }
    expect(parseAlumniError(err)).toEqual({ token: 'alumni_invalid', field: 'stage', reason: 'unknown' })
  })
  it('reads a national-id refusal', () => {
    expect(parseAlumniError({ cause: { hint: 'national_id_invalid', message: 'national_id_invalid: length' }, detail: 'national_id:length' }))
      .toEqual({ token: 'national_id_invalid', field: 'national_id', reason: 'length' })
  })
  it('falls back to the message prefix and survives an unknown error', () => {
    expect(parseAlumniError({ message: 'alumni_stale: reload' }).token).toBe('alumni_stale')
    expect(parseAlumniError(new Error('boom'))).toEqual({ token: null, field: null, reason: null })
    expect(parseAlumniError(null)).toEqual({ token: null, field: null, reason: null })
  })
})

describe('diffPatch (forms send only what changed)', () => {
  it('keeps changed keys only, treats empty string as null, compares arrays by value', () => {
    const base = { name_en: 'Nile', stage: 'mvp', links: [{ kind: 'facebook', url: 'u' }], website_url: null }
    const next = { name_en: 'Nile', stage: 'scaling', links: [{ kind: 'facebook', url: 'u' }], website_url: '' }
    expect(diffPatch(base, next, ['name_en', 'stage', 'links', 'website_url'])).toEqual({ stage: 'scaling' })
    expect(diffPatch(base, { ...next, links: [] }, ['links'])).toEqual({ links: [] })
    expect(diffPatch(base, { ...next, name_en: '' }, ['name_en'])).toEqual({ name_en: null })
    expect(diffPatch(undefined, { stage: 'mvp' }, ['stage'])).toEqual({ stage: 'mvp' })
    // key order does not make an unchanged object look changed
    expect(diffPatch({ links: [{ url: 'u', kind: 'facebook', label: 'F' }] }, { links: [{ kind: 'facebook', label: 'F', url: 'u' }] }, ['links'])).toEqual({})
  })
})

describe('small helpers', () => {
  it('tones the completeness meter', () => {
    expect([completenessTone(100), completenessTone(75), completenessTone(30), completenessTone('x')]).toEqual(['success', 'warning', 'danger', 'neutral'])
  })
})
