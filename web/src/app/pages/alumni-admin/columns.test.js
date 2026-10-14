import { describe, expect, it } from 'vitest'
import { COLUMNS, COLUMN_KEYS, DEFAULT_COLUMNS, OWNER_COLUMNS, cellText, columnHeader, columnOf, governorateOf, normalizeColumns, reviewState } from './columns.js'

const OWNER_HEADERS = ['Startup Name', 'Program Scope', 'Program Name', 'Support provided', 'Startup type', 'Hint', 'Sector', 'Sub sector', 'Description', 'Stage', 'Governerate', 'Date of company established', 'App', 'Website',
  'Social media', 'Traction/Validation', 'CEO Name', 'Phone', 'Email', 'ID', 'CEO Age', 'Age Category', 'Student/Graduate', 'CEO Gender', 'Open/Closed', 'Reason for closing', 'After closing', 'Legal Status',
  'Founding team size', 'Female founders', 'Nu. of founders below 35', 'Nu. of employees', 'Nu. of female employees', 'Number of freelancers', 'Funding raised', 'Revenue (<year>) (Total)', 'Challenges', 'Needs']

const lookups = {
  governorates: [{ code: 1, name_en: 'Cairo', name_ar: 'القاهرة' }, { code: 25, name_en: 'Assiut', name_ar: 'أسيوط' }, { code: 28, name_en: 'Aswan', name_ar: 'أسوان' }],
  sectors: [{ key: 'technology', label_en: 'Technology', label_ar: 'التكنولوجيا', subsectors: [{ key: 'robotics', label_en: 'Robotics', label_ar: 'الروبوتات' }] }],
  stages: [{ key: 'mvp', label_en: 'MVP', label_ar: 'منتج أولي' }], genders: [{ key: 'male', label_en: 'Male', label_ar: 'ذكر' }, { key: 'female', label_en: 'Female', label_ar: 'أنثى' }],
  age_categories: [{ key: 'age_25_34', label_en: '25-34', label_ar: '٢٥-٣٤' }], education_statuses: [{ key: 'graduate', label_en: 'Graduate', label_ar: 'خريج' }],
  operating_statuses: [{ key: 'open', label_en: 'Open', label_ar: 'مفتوحة' }, { key: 'closed', label_en: 'Closed', label_ar: 'مغلقة' }], support_kinds: [{ key: 'training', label_en: 'Training', label_ar: 'تدريب' }],
}
const env = { lookups, lang: 'en', num: (v) => `#${v}`, money: (v) => `$${v}`, date: (v) => `d:${v}` }
const row = {
  id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل', sector: 'technology', subsector: 'robotics', stage: 'mvp', governorate: 25, established_on: '2021-03-01', website_url: 'https://nile.example.com', app_url: null,
  hint: 'strong', social: [{ kind: 'facebook', url: 'https://fb.com/n' }], traction: '12 farms', operating_status: 'open', support: ['training'],
  programs: [{ id: 'g', name_en: 'Accelerator', name_ar: 'مسرعة' }], projects: [{ id: 'j', name_en: 'Cohort 1', name_ar: 'دفعة' }, { id: 'j2', name_en: 'Cohort 1', name_ar: 'دفعة' }],
  ceo: { founder_id: 'f1', name_en: 'Sara', name_ar: 'سارة', phone: '+2010', email: 's@x.io', id_masked: '**********1234', has_national_id: true, age: 31, age_category: 'age_25_34', gender: 'male', governorate: 28, source: 'id', education_status: 'graduate' },
  team: { size: 2, female_founders: 1, under_35: 2 }, metrics: { employees_total: 9, employees_female: 4, freelancers: 3, funding_raised_total: 80000, revenue_total: 250000, challenges: 'hiring', needs: 'seed' },
  completeness: { percent: 80, missing: ['annual_update'] }, is_alumni: true, directory_visibility: 'alumni', reviewed_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-09T00:00:00Z', legacy: {},
}

describe('the directory columns', () => {
  it('start with the owner\'s 38 Excel columns in the owner\'s order, headers unchanged (typos included)', () => {
    expect(OWNER_COLUMNS.map((c) => c.header)).toEqual(OWNER_HEADERS)
    expect(OWNER_COLUMNS).toHaveLength(38)
    expect(COLUMN_KEYS.slice(0, 38)).toEqual(OWNER_COLUMNS.map((c) => c.key))
    expect(new Set(COLUMN_KEYS).size).toBe(COLUMNS.length)
  })
  it('carry the year in the revenue header', () => {
    expect(columnHeader(columnOf('revenue'), 2023)).toBe('Revenue (2023) (Total)')
    expect(columnHeader(columnOf('stage'), 2023)).toBe('Stage')
  })
  it('hide the national ID by default (it is a manager-only, sensitive column) but offer it', () => {
    expect(DEFAULT_COLUMNS).not.toContain('national_id')
    expect(columnOf('national_id')).toMatchObject({ sensitive: true, managerOnly: true })
    expect(DEFAULT_COLUMNS).toContain('startup_name')
  })
  it('flag the derived columns (the CEO\'s age / category / gender / governorate and the three counts are never typed)', () => {
    for (const k of ['ceo_age', 'age_category', 'ceo_gender', 'governerate', 'founding_team_size', 'female_founders', 'founders_below_35', 'program_scope', 'program_name', 'support_provided']) expect(columnOf(k).derived).toBe(true)
  })
  it('normalise a stored choice: unknown keys dropped, owner order kept, an empty list falls back to the defaults', () => {
    expect(normalizeColumns(['stage', 'bogus', 'startup_name'])).toEqual(['startup_name', 'stage'])
    expect(normalizeColumns([])).toEqual(DEFAULT_COLUMNS)
    expect(normalizeColumns(null)).toEqual(DEFAULT_COLUMNS)
  })
})

describe('cell text', () => {
  it('renders the owner columns from the typed values and the lookups (labels in the UI language)', () => {
    const t = (k) => cellText(row, k, env)
    expect(t('startup_name')).toBe('Nile Robotics')
    expect(t('sector')).toBe('Technology')
    expect(t('sub_sector')).toBe('Robotics')
    expect(t('stage')).toBe('MVP')
    expect(t('established')).toBe('d:2021-03-01')
    expect(t('website')).toBe('https://nile.example.com')
    expect(t('social_media')).toBe('facebook: https://fb.com/n')
    expect(t('ceo_name')).toBe('Sara')
    expect(t('ceo_age')).toBe('#31')
    expect(t('age_category')).toBe('25-34')
    expect(t('ceo_gender')).toBe('Male')
    expect(t('student_graduate')).toBe('Graduate')
    expect(t('open_closed')).toBe('Open')
    expect(t('founding_team_size')).toBe('#2')
    expect(t('female_founders')).toBe('#1')
    expect(t('founders_below_35')).toBe('#2')
    expect(t('employees')).toBe('#9')
    expect(t('funding_raised')).toBe('$80000')
    expect(t('revenue')).toBe('$250000')
    expect(t('support_provided')).toBe('Training')
    expect(t('hint')).toBe('strong')
    expect(t('completeness')).toBe('80%')
  })
  it('lists a program / project once even when it repeats, in the UI language with a fallback', () => {
    expect(cellText(row, 'program_name', env)).toBe('Cohort 1')
    expect(cellText(row, 'program_scope', { ...env, lang: 'ar' })).toBe('مسرعة')
    expect(cellText({ name_en: '', name_ar: 'اسم' }, 'startup_name', env)).toBe('اسم')
  })
  it('shows the national ID ONLY masked (the table never carries the number)', () => {
    expect(cellText(row, 'national_id', env)).toBe('**********1234')
    expect(JSON.stringify(row)).not.toMatch(/\d{14}/)
  })
  it('the governorate of the owner\'s sheet = the CEO\'s governorate FROM THE ID, then the company\'s, then the old text; the company location is its own column', () => {
    expect(governorateOf(row, lookups, 'en')).toMatchObject({ text: 'Aswan', source: 'id', code: 28 })
    expect(governorateOf({ ...row, ceo: { ...row.ceo, governorate: null } }, lookups, 'en')).toMatchObject({ text: 'Assiut', source: 'company' })
    expect(governorateOf({ governorate: null, legacy: { governorate_en: 'Alex' } }, lookups, 'en')).toMatchObject({ text: 'Alex', source: 'legacy' })
    expect(governorateOf({}, lookups, 'en')).toMatchObject({ text: '', source: null })
    expect(cellText(row, 'governerate', env)).toBe('Aswan')
    expect(cellText(row, 'company_location', env)).toBe('Assiut')
  })
  it('a sector without a key falls back to the old industry text', () => {
    expect(cellText({ legacy: { industry_en: 'Food', industry_ar: 'غذاء' } }, 'sector', env)).toBe('Food')
    expect(cellText({ legacy: { industry_en: 'Food', industry_ar: 'غذاء' } }, 'sector', { ...env, lang: 'ar' })).toBe('غذاء')
  })
  it('empty values are empty text (not "null" or "0")', () => {
    for (const k of ['hint', 'ceo_name', 'ceo_age', 'employees', 'revenue', 'traction', 'app', 'closing', 'reason_for_closing']) expect(cellText({}, k, env)).toBe('')
  })
  it('review state: never / current / changed since the review', () => {
    expect(reviewState({})).toBe('never')
    expect(reviewState({ reviewed_at: '2026-10-10', updated_at: '2026-10-09' })).toBe('current')
    expect(reviewState({ reviewed_at: '2026-10-08', updated_at: '2026-10-09' })).toBe('changed')
  })
})
