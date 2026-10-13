import { describe, expect, it } from 'vitest'
import {
  applySemantic, buildSteps, cleanAnswers, countsBy, countsByDay, draftFromTemplate, duplicateQuestion, fromQuestionRow, keyFromLabel, normalizeFormConfig,
  parseServerFieldError, prefillFromSearch, renderThankYou, responseDisplay, suggestSemantic, templateFromDraft, toChildren, toQuestionRow, trackingFromSearch,
  validateAnswer, validateAnswers, validateDefinition, withSource, emptyQuestion,
} from './formLogic.js'

const q = (over) => ({ ...emptyQuestion('text'), id: over.key ?? 'x', key: 'x', label: { en: 'X', ar: '' }, ...over })

describe('form config', () => {
  it('normalises the migrated shape (legacy thank_you string, show_in_card dropped) with defaults', () => {
    const c = normalizeFormConfig({ social: { facebook: false, custom: [{ key: 'newsletter', label: 'Newsletter' }] }, thank_you: { message: 'Thanks {name}', show_image: true }, show_in_card: ['a'] })
    expect(c.thank_you.message).toEqual({ en: 'Thanks {name}', ar: '' })
    expect(c.social.facebook).toBe(false)
    expect(c.social.whatsapp).toBe(true)
    expect(c.social.custom).toEqual([{ key: 'newsletter', label: 'Newsletter', active: true }])
    expect(c.show_in_card).toBeUndefined()
    expect(c.notify_pm).toBe(false)
  })
})

describe('keys and semantic roles', () => {
  it('derives a stable key from the English label, unique and never a reserved role name', () => {
    expect(keyFromLabel({ en: 'Startup Name / اسم الشركة', ar: '' })).toBe('startup_name')
    expect(keyFromLabel({ en: 'Company name' }, ['company_name_2'])).toBe('company_name_3') // 'company_name' is reserved for the role
    expect(keyFromLabel({ en: '', ar: 'ما اسمك' }, [], 4)).toBe('q_4')
    expect(keyFromLabel({ en: 'E-mail' }, ['e_mail'])).toBe('e_mail_2')
  })
  it('suggests roles from labels in both languages, respecting the type and taken roles', () => {
    expect(suggestSemantic({ en: 'Startup Name / اسم الشركة' }, 'text')).toBe('company_name')
    expect(suggestSemantic({ en: 'Email / البريد الإلكتروني' }, 'email')).toBe('founder_email')
    expect(suggestSemantic({ en: 'Email' }, 'text')).toBeNull() // role needs an email question
    expect(suggestSemantic({ en: 'Phone Number / رقم المحمول' }, 'tel')).toBe('phone')
    expect(suggestSemantic({ en: '', ar: 'الاسم الكامل' }, 'text')).toBe('founder_name')
    expect(suggestSemantic({ en: 'Describe what your company does' }, 'textarea')).toBe('bio')
    expect(suggestSemantic({ en: 'Company name' }, 'text', ['company_name'])).toBeNull()
    expect(suggestSemantic({ en: 'Hotel name' }, 'text')).toBeNull() // no substring matching on "tel" (docs/04 A-9)
  })
  it('applySemantic makes the key equal to the role (DB CHECK) and clearing keeps the key', () => {
    const a = applySemantic(q({ key: 'q010', type: 'email' }), 'founder_email')
    expect(a.key).toBe('founder_email')
    expect(applySemantic(a, null)).toMatchObject({ key: 'founder_email', semantic: null })
  })
  it('validateDefinition flags labels, keys, duplicate/incompatible roles and empty options', () => {
    const errs = validateDefinition({ questions: [
      q({ id: 'a', key: 'company_name', semantic: 'company_name' }),
      q({ id: 'b', key: 'company_name', label: { en: '', ar: '' } }),
      q({ id: 'c', key: 'Bad Key' }),
      q({ id: 'd', key: 'founder_email', semantic: 'founder_email', type: 'text' }),
      q({ id: 'e', key: 'city', type: 'select', options: [] }),
    ] })
    expect(errs.a).toBeUndefined()
    expect(errs.b).toEqual(expect.arrayContaining(['form.err.labelRequired', 'form.err.keyDuplicate']))
    expect(errs.c).toContain('form.err.keyInvalid')
    expect(errs.d).toContain('form.err.semanticType')
    expect(errs.e).toContain('form.err.optionsRequired')
  })
})

describe('rows <-> client', () => {
  it('reads a legacy row (camelCase validation, label_en options) and writes the normalised row', () => {
    const row = { id: 'r1', key: 'custom_1', type: 'tel', semantic: null, label_en: 'Phone', options: [{ value: 'a', label_en: 'A' }], validation: { minValue: '', maxValue: '5', customError: 'oops', allowed_countries: ['EG'] }, order_index: 3 }
    const c = fromQuestionRow(row)
    expect(c.validation).toMatchObject({ max: 5, min: null, customError: { en: 'oops', ar: '' }, allowedCountries: ['EG'] })
    const out = toQuestionRow(c, 0)
    expect(out).toMatchObject({ id: 'r1', key: 'custom_1', type: 'tel', label_en: 'Phone', label_ar: null, is_required: false, options: null, validation: { max: 5, customError: { en: 'oops', ar: '' }, allowed_countries: ['EG'] }, order_index: 0 })
    const children = toChildren({ sections: [{ id: 's', title: { en: 'S', ar: '' }, description: { en: '', ar: '' } }], questions: [c], form: { cover_id: null } })
    expect(children.sections[0]).toMatchObject({ id: 's', title_en: 'S', title_ar: null, order_index: 0 })
    expect(children.form).toEqual({ cover_id: null })
  })
})

describe('respondent validation and cleaning', () => {
  const questions = [
    q({ key: 'company_name', semantic: 'company_name', required: true }),
    q({ key: 'founder_email', type: 'email', semantic: 'founder_email', required: true }),
    q({ key: 'phone', type: 'tel', semantic: 'phone', validation: { allowedCountries: ['EG'] } }),
    q({ key: 'employees', type: 'number', validation: { min: 1, max: 100 } }),
    q({ key: 'site', type: 'url' }),
    q({ key: 'city', type: 'select', options: [{ value: 'Cairo', label: { en: 'Cairo', ar: '' }, is_other: false }, { value: 'Other', label: { en: 'Other', ar: '' }, is_other: true }] }),
    q({ key: 'tags', type: 'multiselect', options: [{ value: 'a', label: { en: 'a', ar: '' } }, { value: 'b', label: { en: 'b', ar: '' } }] }),
    q({ key: 'ref', type: 'hidden', required: true }),
  ]
  it('validates each type and treats required hidden questions as optional', () => {
    const errs = validateAnswers(questions, { company_name: '', founder_email: 'nope', phone: '12', employees: '500', site: 'not a url', tags: ['zzz'] }, 'en')
    expect(errs.company_name.key).toBe('form.err.required')
    expect(errs.founder_email.key).toBe('form.err.email')
    expect(errs.phone.key).toMatch(/^phone\./)
    expect(errs.employees).toEqual({ key: 'form.err.max', vars: { n: 100 } })
    expect(errs.site.key).toBe('form.err.url')
    expect(errs.tags.key).toBe('form.err.option')
    expect(errs.ref).toBeUndefined()
    expect(validateAnswer(q({ key: 'x', validation: { customError: { en: 'Custom!', ar: '' }, minLength: 5 } }), 'ab')).toEqual({ key: null, text: 'Custom!' })
  })
  it('cleans answers: trim, lower-case e-mail, E.164 by declared type, numbers, https prefix, other option kept', () => {
    const out = cleanAnswers(questions, { company_name: '  Nile ', founder_email: 'A@B.CO ', phone: '010 1234 5678', employees: '12', site: 'nile.io', city: 'Luxor', tags: ['a', 'a'], ref: '' })
    expect(out).toEqual({ company_name: 'Nile', founder_email: 'a@b.co', phone: '+201012345678', employees: 12, site: 'https://nile.io', city: 'Luxor', tags: ['a'] })
  })
  it('buildSteps: one step without sections; synthetic first step for orphans; hidden questions excluded', () => {
    expect(buildSteps([], questions)).toHaveLength(1)
    expect(buildSteps([], questions)[0].questions.map((x) => x.key)).not.toContain('ref')
    const steps = buildSteps([{ id: 's1', title: { en: 'Company' }, order_index: 0 }], [q({ key: 'a', section_id: 's1' }), q({ key: 'b' })])
    expect(steps.map((s) => s.id)).toEqual(['general', 's1'])
  })
  it('thank-you tokens come from the semantic answers and unknown tokens vanish', () => {
    const answers = { company_name: 'Nile', founder_email: 'f@x.io' }
    expect(renderThankYou('Thanks {name} of {{company}} ({email}) {phone} {{اسم_الشركة}} {weird}', answers, questions)).toBe('Thanks Nile of Nile (f@x.io) Nile')
    expect(responseDisplay({ founder_name: 'Mona' }, [q({ key: 'founder_name', semantic: 'founder_name' })]).subtitle).toBe('Mona')
    expect(responseDisplay({ custom_1: 'First text' }, [q({ key: 'custom_1' })]).title).toBe('First text')
  })
  it('server field errors and tracking/prefill helpers', () => {
    expect(parseServerFieldError('founder_email:email')).toEqual({ key: 'founder_email', reason: 'email', messageKey: 'form.err.email' })
    expect(parseServerFieldError('garbage')).toBeNull()
    expect(trackingFromSearch('?utm_source=fb&utm_medium=paid&x=1', { referrer: 'https://r', lang: 'ar' })).toEqual({ source: 'fb', utm_source: 'fb', utm_medium: 'paid', referrer: 'https://r', lang: 'ar' })
    expect(trackingFromSearch('?source=whatsapp').source).toBe('whatsapp')
    expect(prefillFromSearch(questions, '?ref=abc&company_name=Hack')).toEqual({ ref: 'abc' })
    expect(withSource('https://a/forms/x', 'fb')).toBe('https://a/forms/x?source=fb')
  })
})

describe('analytics, templates, reorder', () => {
  it('countsByDay / countsBy', () => {
    const now = new Date('2026-10-12T12:00:00Z')
    const rows = [{ submitted_at: '2026-10-12T01:00:00Z', source: 'fb' }, { submitted_at: '2026-10-11T23:00:00Z', source: '' }, { submitted_at: '2026-10-01T00:00:00Z', source: 'fb' }]
    const days = countsByDay(rows, { days: 3, now, tz: 'UTC' })
    expect(days.map((d) => d.count)).toEqual([0, 1, 1])
    expect(countsBy(rows, (r) => r.source)).toEqual([{ key: 'fb', count: 2 }, { key: 'direct', count: 1 }])
  })
  it('template round trip keeps sections by reference and gives fresh ids; legacy library definitions import too', () => {
    const draft = { config: { thank_you: { message: { en: 'T', ar: '' } } }, sections: [{ id: 's1', title: { en: 'S', ar: '' }, description: { en: '', ar: '' } }], questions: [q({ key: 'company_name', semantic: 'company_name', section_id: 's1' }), q({ key: 'other' })] }
    const def = templateFromDraft(draft)
    expect(def.schema_version).toBe(2)
    expect(def.questions[0]).toMatchObject({ key: 'company_name', section_ref: 0 })
    expect(def.questions[0].id).toBeUndefined()
    const back = draftFromTemplate(def)
    expect(back.sections).toHaveLength(1)
    expect(back.questions[0].section_id).toBe(back.sections[0].id)
    expect(back.questions[0].id).not.toBe('company_name')
    expect(back.config.thank_you.message.en).toBe('T')
    const legacy = draftFromTemplate({ settings: { thank_you: { message: 'Thank you {name}' } }, questions: [
      { field_name: 'custom_1', field_type: 'text', field_label: 'Startup Name', is_required: true, display_order: 0, validation_rules: { section_id: 'sec_1', allowed_countries: ['EG'] } },
      { field_name: 'custom_2', field_type: 'phone', field_label: 'Phone', display_order: 1, validation_rules: { section_id: 'sec_1' } },
      { field_name: 'custom_3', field_type: 'select', field_label: 'City', field_options: [{ label: 'Cairo', value: 'Cairo' }], display_order: 2 },
    ] })
    expect(legacy.sections).toHaveLength(1)
    expect(legacy.questions.map((x) => x.type)).toEqual(['text', 'tel', 'select']) // orphan `phone` type repaired (docs/04 A-11)
    expect(legacy.questions.map((x) => x.key)).toEqual(['startup_name', 'phone_2', 'city']) // 'phone' is reserved for the role
    expect(legacy.questions[0].section_id).toBe(legacy.sections[0].id)
    expect(legacy.questions[2].options[0]).toMatchObject({ value: 'Cairo' })
  })
  it('duplicateQuestion inserts a copy after the source without the role', () => {
    const list = [q({ id: 'a', key: 'company_name', semantic: 'company_name', label: { en: 'Company', ar: 'شركة' } }), q({ id: 'b', key: 'b' })]
    const out = duplicateQuestion(list, 'a')
    expect(out).toHaveLength(3)
    expect(out[1]).toMatchObject({ semantic: null, key: 'company', label: { en: 'Company (copy)', ar: 'شركة (نسخة)' }, order_index: 1 })
    expect(out[1].id).not.toBe('a')
  })
})
