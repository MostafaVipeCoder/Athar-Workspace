import { describe, expect, it } from 'vitest'
import {
  buildCompanyPatch, buildFounderPatch, buildSnapshotPatch, cleanLinks, companyToForm, COMPANY_MISSING_SECTION, FOUNDER_MISSING_SECTION, fieldErrorOf, founderToForm, phoneForPatch,
  snapshotToForm, validateCompanyForm, validateFounderForm, validateSnapshotForm,
} from './alumniForms.js'

const TODAY = '2026-10-14'
const CODES = [1, 2, 25, 28, 88]

const founder = (over = {}) => ({
  id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة علي', email: 'sara@example.com', phone: '+201012345678', linkedin_url: null, photo_path: null, bio_en: null, bio_ar: null, education_status: 'graduate',
  identity: { source: null, has_national_id: false, national_id: null, id_masked: null, self_birth_date: null, self_gender: null, derived: {} },
  ...over,
})
const withId = (id = '29501010101234') => founder({ identity: { source: 'id', has_national_id: true, national_id: id, id_masked: '**********1234', self_birth_date: null, self_gender: null, derived: { birth_date: '1995-01-01' } } })

describe('founder form: payload <-> values', () => {
  it('null becomes an empty string, the saved ID is the owner\'s own number', () => {
    const v = founderToForm(withId())
    expect(v).toMatchObject({ bio_en: '', linkedin_url: '', national_id: '29501010101234', self_birth_date: '', self_gender: '', phone: '+201012345678' })
  })

  it('an untouched form has an empty patch (the phone is compared as stored, not as typed)', () => {
    const base = founderToForm(founder())
    expect(buildFounderPatch(base, { ...base })).toEqual({})
    expect(buildFounderPatch(base, { ...base, phone: '+20 1012345678' })).toEqual({}) // the phone field formats with a space
    expect(buildFounderPatch(base, { ...base, phone: '01012345678' })).toEqual({}) // a national number is the same number
    expect(phoneForPatch('01012345678')).toBe('+201012345678')
  })

  it('only changed keys are sent; an emptied field is null', () => {
    const base = founderToForm(founder({ bio_en: 'Hello' }))
    expect(buildFounderPatch(base, { ...base, name_en: 'Sara A. Ali', bio_en: '' })).toEqual({ name_en: 'Sara A. Ali', bio_en: null })
  })

  it('national ID: sent only when it changed; an emptied field REMOVES it; the typed value is normalised', () => {
    const base = founderToForm(founder())
    expect(buildFounderPatch(base, { ...base, national_id: '2950-1010 1012 34' })).toEqual({ national_id: '29501010101234' })
    const saved = founderToForm(withId())
    expect(buildFounderPatch(saved, { ...saved })).toEqual({})
    expect(buildFounderPatch(saved, { ...saved, national_id: '' })).toEqual({ national_id: null })
    expect(buildFounderPatch(saved, { ...saved, national_id: '30303152804527' })).toEqual({ national_id: '30303152804527' })
  })

  it('the self-declared values are sent ONLY while the form holds no ID (the ID wins: the server refuses both together)', () => {
    const base = founderToForm(founder())
    expect(buildFounderPatch(base, { ...base, self_birth_date: '1990-05-05', self_gender: 'female' })).toEqual({ self_birth_date: '1990-05-05', self_gender: 'female' })
    // an ID typed next to leftover self values: the self values are NOT in the patch (the server erases them and reports `replaced`)
    expect(buildFounderPatch(base, { ...base, national_id: '29501010101234', self_birth_date: '1990-05-05', self_gender: 'female' })).toEqual({ national_id: '29501010101234' })
    // removing the saved ID and typing a fallback in one go is allowed (no ID left)
    const saved = founderToForm(withId())
    expect(buildFounderPatch(saved, { ...saved, national_id: '', self_gender: 'male' })).toEqual({ national_id: null, self_gender: 'male' })
  })
})

describe('validateFounderForm (instant, same reasons as the server)', () => {
  const ok = founderToForm(founder())
  it('a complete form is valid', () => expect(validateFounderForm(ok, { today: TODAY, governorateCodes: CODES })).toEqual({}))
  it('a name in at least one language is required', () => {
    expect(validateFounderForm({ ...ok, name_en: '', name_ar: '' }, { today: TODAY })).toEqual({ name_ar: 'alumni.reason.required' })
    expect(validateFounderForm({ ...ok, name_en: '', name_ar: 'سارة' }, { today: TODAY })).toEqual({})
  })
  it('phone, LinkedIn, bio length', () => {
    expect(validateFounderForm({ ...ok, phone: '123' }, { today: TODAY }).phone).toBe('alumni.reason.bad_value')
    expect(validateFounderForm({ ...ok, linkedin_url: 'javascript:alert(1)' }, { today: TODAY }).linkedin_url).toBe('alumni.reason.bad_url')
    expect(validateFounderForm({ ...ok, linkedin_url: 'https://www.linkedin.com/in/sara' }, { today: TODAY })).toEqual({})
    expect(validateFounderForm({ ...ok, bio_en: 'x'.repeat(4001) }, { today: TODAY }).bio_en).toBe('alumni.reason.too_long')
  })
  it('a typed national ID gets one clear reason per failure', () => {
    const reason = (id) => validateFounderForm({ ...ok, national_id: id }, { today: TODAY, governorateCodes: CODES }).national_id
    expect(reason('49501010101234')).toBe('alumni.err.nid.century')
    expect(reason('29513010101234')).toBe('alumni.err.nid.date')
    expect(reason('39912310101234')).toBe('alumni.err.nid.future')
    expect(reason('29501010501234')).toBe('alumni.err.nid.governorate')
    expect(reason('2950101010123')).toBe('alumni.err.nid.length')
    expect(reason('29501010101234')).toBeUndefined()
  })
  it('the self-declared date is checked only while there is no ID', () => {
    expect(validateFounderForm({ ...ok, self_birth_date: '2099-01-01' }, { today: TODAY }).self_birth_date).toBe('alumni.reason.bad_date')
    expect(validateFounderForm({ ...ok, national_id: '29501010101234', self_birth_date: '2099-01-01' }, { today: TODAY, governorateCodes: CODES })).toEqual({})
  })
})

const company = (over = {}) => ({
  id: 'c1', name_en: 'Nile Labs', name_ar: null, description_en: 'Water tech', description_ar: null, logo_path: null, startup_type: 'startup', sector: 'technology', subsector: 'robotics', stage: 'mvp', legal_status: null,
  governorate: 25, location_en: null, location_ar: null, established_on: '2021-03-01', website_url: 'https://nile.example.com', app_url: null, linkedin_url: null,
  links: [{ kind: 'facebook', url: 'https://facebook.com/nile', label: 'Facebook' }], operating_status: 'open', closed_on: null, closing_reason: null, after_closing: null, closing_note: null, directory_visibility: 'private', ...over,
})

describe('company form: payload <-> values', () => {
  it('maps every key, the governorate stays a number, links are copied', () => {
    const v = companyToForm(company())
    expect(v.governorate).toBe(25)
    expect(v.name_ar).toBe('')
    expect(v.links).toEqual([{ kind: 'facebook', url: 'https://facebook.com/nile', label: 'Facebook' }])
    expect(v.operating_status).toBe('open')
  })

  it('an untouched form has an empty patch', () => {
    const base = companyToForm(company())
    expect(buildCompanyPatch(base, { ...base })).toEqual({})
    expect(buildCompanyPatch(base, { ...base, governorate: '25' })).toEqual({}) // a select returns a string
  })

  it('changed keys only; a cleared lookup is null; the governorate is sent as a number', () => {
    const base = companyToForm(company())
    expect(buildCompanyPatch(base, { ...base, stage: '', governorate: '1', name_ar: 'نيل' })).toEqual({ stage: null, governorate: 1, name_ar: 'نيل' })
  })

  it('links: an empty row is not saved and key order does not matter', () => {
    const base = companyToForm(company())
    expect(cleanLinks([{ kind: 'x', url: '  ' }, { kind: 'x', url: ' https://x.com/n ' }])).toEqual([{ kind: 'x', url: 'https://x.com/n' }])
    expect(buildCompanyPatch(base, { ...base, links: [...base.links, { kind: 'youtube', url: '' }] })).toEqual({})
    expect(buildCompanyPatch(base, { ...base, links: [{ url: 'https://facebook.com/nile', label: 'Facebook', kind: 'facebook' }] })).toEqual({})
    expect(buildCompanyPatch(base, { ...base, links: [] })).toEqual({ links: [] })
  })

  it('closing a company sends the status; re-opening clears the four closing fields', () => {
    const closed = companyToForm(company({ operating_status: 'closed', closed_on: '2025-01-01', closing_reason: 'market', after_closing: 'employed', closing_note: 'x' }))
    const reopened = { ...closed, operating_status: 'open', closed_on: '', closing_reason: '', after_closing: '', closing_note: '' }
    expect(buildCompanyPatch(closed, reopened)).toEqual({ operating_status: 'open', closed_on: null, closing_reason: null, after_closing: null, closing_note: null })
  })
})

describe('validateCompanyForm', () => {
  const ok = companyToForm(company())
  it('a valid company has no errors', () => expect(validateCompanyForm(ok, { today: TODAY })).toEqual({}))
  it('a name in some language, URLs, the date rules', () => {
    expect(validateCompanyForm({ ...ok, name_en: '', name_ar: '' }, { today: TODAY }).name_ar).toBe('alumni.reason.required')
    expect(validateCompanyForm({ ...ok, website_url: 'ftp://x' }, { today: TODAY }).website_url).toBe('alumni.reason.bad_url')
    expect(validateCompanyForm({ ...ok, established_on: '2099-01-01' }, { today: TODAY }).established_on).toBe('alumni.reason.future')
    expect(validateCompanyForm({ ...ok, established_on: '1800-01-01' }, { today: TODAY }).established_on).toBe('alumni.reason.bad_date')
    expect(validateCompanyForm({ ...ok, subsector: 'robotics', sector: '' }, { today: TODAY }).subsector).toBe('alumni.reason.needs_sector')
  })
  it('social links are checked one by one', () => {
    const e = validateCompanyForm({ ...ok, links: [{ kind: 'facebook', url: 'https://ok.com' }, { kind: 'x', url: 'javascript:1' }] }, { today: TODAY })
    expect(e).toEqual({ 'links.1': 'alumni.reason.bad_url' })
  })
  it('the closing date is only checked on a closed company', () => {
    expect(validateCompanyForm({ ...ok, closed_on: '2099-01-01' }, { today: TODAY })).toEqual({})
    expect(validateCompanyForm({ ...ok, operating_status: 'closed', closed_on: '2099-01-01' }, { today: TODAY }).closed_on).toBe('alumni.reason.bad_date')
  })
})

describe('the yearly row', () => {
  const snap = { year: 2024, revenue_total: 260000, funding_raised_total: 100000, employees_total: 12, employees_female: 4, freelancers: 3, traction: 'x', challenges: null, needs: '' }
  it('numbers become strings, null becomes empty', () => {
    expect(snapshotToForm(snap)).toMatchObject({ revenue_total: '260000', employees_total: '12', challenges: '', needs: '' })
    expect(snapshotToForm(null).revenue_total).toBe('')
  })
  it('a new year sends only what was filled; an edit sends only what changed; an emptied number is null', () => {
    expect(buildSnapshotPatch(null, { ...snapshotToForm(null), revenue_total: ' 5000 ', traction: 'pilot' })).toEqual({ revenue_total: '5000', traction: 'pilot' })
    const base = snapshotToForm(snap)
    expect(buildSnapshotPatch(base, { ...base })).toEqual({})
    expect(buildSnapshotPatch(base, { ...base, freelancers: '', needs: 'funding' })).toEqual({ freelancers: null, needs: 'funding' })
  })
  it('validation: numbers, ranges, female <= total (same reasons as the server)', () => {
    const f = (o) => validateSnapshotForm({ ...snapshotToForm(null), ...o })
    expect(f({ revenue_total: '12.5' })).toEqual({})
    expect(f({ revenue_total: '12.555' }).revenue_total).toBe('alumni.reason.not_a_number')
    expect(f({ revenue_total: 'abc' }).revenue_total).toBe('alumni.reason.not_a_number')
    expect(f({ revenue_total: '1000000000001' }).revenue_total).toBe('alumni.reason.out_of_range')
    expect(f({ employees_total: '2.5' }).employees_total).toBe('alumni.reason.not_a_number')
    expect(f({ employees_total: '1000001' }).employees_total).toBe('alumni.reason.out_of_range')
    expect(f({ employees_total: '10', employees_female: '11' }).employees_female).toBe('alumni.reason.exceeds_total')
    expect(f({ employees_total: '10', employees_female: '10' })).toEqual({})
    expect(f({ employees_female: '5' })).toEqual({}) // no total yet: nothing to compare with
    expect(f({ needs: 'x'.repeat(4001) }).needs).toBe('alumni.reason.too_long')
  })
})

describe('server refusals -> a field', () => {
  it('alumni_invalid names the field and the reason; national_id_invalid the ID reason', () => {
    expect(fieldErrorOf({ token: 'alumni_invalid', field: 'website_url', reason: 'bad_url' })).toEqual({ field: 'website_url', key: 'alumni.reason.bad_url' })
    expect(fieldErrorOf({ token: 'alumni_invalid', field: 'name', reason: 'required' })).toEqual({ field: 'name_ar', key: 'alumni.reason.required' })
    expect(fieldErrorOf({ token: 'alumni_invalid', field: 'closing', reason: 'requires_closed' })).toEqual({ field: 'closed_on', key: 'alumni.reason.requires_closed' })
    expect(fieldErrorOf({ token: 'national_id_invalid', field: 'national_id', reason: 'future' })).toEqual({ field: 'national_id', key: 'alumni.err.nid.future' })
  })
  it('anything else is not about a field', () => {
    expect(fieldErrorOf({ token: 'alumni_stale', field: null, reason: null })).toBeNull()
    expect(fieldErrorOf({ token: null })).toBeNull()
    expect(fieldErrorOf(null)).toBeNull()
  })
})

describe('completeness: every missing key the server can name has a section', () => {
  it('founder keys', () => {
    for (const k of ['name', 'phone', 'identity', 'education_status']) expect(FOUNDER_MISSING_SECTION[k], k).toBeTruthy()
  })
  it('company keys', () => {
    for (const k of ['name', 'description', 'startup_type', 'sector', 'stage', 'legal_status', 'governorate', 'established_on', 'online_presence', 'annual_update']) expect(COMPANY_MISSING_SECTION[k], k).toBeTruthy()
  })
})
