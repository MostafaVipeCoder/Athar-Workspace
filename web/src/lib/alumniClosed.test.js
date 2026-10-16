import { describe, expect, it } from 'vitest'
import { CLOSED_MAX, CLOSED_TYPES, answerHeadline, answerToForm, buildClosedPayload, closedFormChanged, emptyClosedForm, normalizeUrl, validateClosedForm } from './alumniClosed.js'

const venture = (over = {}) => ({ ...emptyClosedForm(), answer_type: 'new_startup', venture_name: 'Nile Pay', field: 'technology', ...over })

describe('the three answers of a closed company', () => {
  it('are the keys of the after_closing vocabulary', () => {
    expect(CLOSED_TYPES).toEqual(['new_startup', 'employed', 'other'])
  })
})

describe('validateClosedForm', () => {
  it('asks for an answer type first', () => {
    expect(validateClosedForm(emptyClosedForm())).toEqual({ answer_type: 'required' })
    expect(validateClosedForm({ ...emptyClosedForm(), answer_type: 'retired' })).toEqual({ answer_type: 'required' })
  })
  it('a new venture needs its name and field; the rest is optional', () => {
    expect(validateClosedForm(venture({ venture_name: '  ', field: '' }))).toEqual({ venture_name: 'required', field: 'required' })
    expect(validateClosedForm(venture())).toEqual({})
  })
  it('employed needs the employer, the role and the field', () => {
    expect(validateClosedForm({ ...emptyClosedForm(), answer_type: 'employed' })).toEqual({ employer: 'required', job_title: 'required', field: 'required' })
    expect(validateClosedForm({ ...emptyClosedForm(), answer_type: 'employed', employer: 'ACME', job_title: 'Dev', field: 'technology' })).toEqual({})
  })
  it('other needs its text', () => {
    expect(validateClosedForm({ ...emptyClosedForm(), answer_type: 'other', other_text: ' ' })).toEqual({ other_text: 'required' })
    expect(validateClosedForm({ ...emptyClosedForm(), answer_type: 'other', other_text: 'Studying' })).toEqual({})
  })
  it('checks the lengths of the server and the web address', () => {
    expect(validateClosedForm(venture({ venture_name: 'x'.repeat(CLOSED_MAX.venture_name + 1) }))).toEqual({ venture_name: 'too_long' })
    expect(validateClosedForm(venture({ venture_description: 'x'.repeat(1001) }))).toEqual({ venture_description: 'too_long' })
    expect(validateClosedForm(venture({ venture_url: 'javascript:alert(1)' }))).toEqual({ venture_url: 'bad_url' })
    expect(validateClosedForm(venture({ venture_url: 'two words' }))).toEqual({ venture_url: 'bad_url' })
    expect(validateClosedForm(venture({ venture_url: 'venture.example/x' }))).toEqual({})
  })
  it('only the fields of the chosen type count (a leftover of another type is not validated)', () => {
    expect(validateClosedForm({ ...venture(), answer_type: 'other', other_text: 'ok', venture_url: 'javascript:x' })).toEqual({})
  })
})

describe('normalizeUrl', () => {
  it('adds https:// to an address typed without a scheme and leaves a scheme alone', () => {
    expect(normalizeUrl('venture.example')).toBe('https://venture.example')
    expect(normalizeUrl('  //venture.example ')).toBe('https://venture.example')
    expect(normalizeUrl('http://venture.example')).toBe('http://venture.example')
    expect(normalizeUrl('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl(null)).toBe('')
  })
})

describe('buildClosedPayload', () => {
  it('sends the fields of the chosen type only, trimmed; an empty optional field is left out', () => {
    expect(buildClosedPayload(venture({ venture_name: ' Nile Pay ', venture_url: 'nilepay.example', venture_stage: '', employer: 'leftover', other_text: 'leftover', wants_programs: true })))
      .toEqual({ answer_type: 'new_startup', venture_name: 'Nile Pay', field: 'technology', venture_url: 'https://nilepay.example', wants_programs: true })
  })
  it('employed carries no venture field and no interest flag', () => {
    expect(buildClosedPayload({ ...venture(), answer_type: 'employed', employer: 'ACME', job_title: 'Dev', wants_programs: true }))
      .toEqual({ answer_type: 'employed', employer: 'ACME', job_title: 'Dev', field: 'technology' })
  })
  it('other carries the text only', () => {
    expect(buildClosedPayload({ ...venture(), answer_type: 'other', other_text: ' Studying ' })).toEqual({ answer_type: 'other', other_text: 'Studying' })
  })
})

describe('answerToForm / closedFormChanged', () => {
  const stored = { answer_type: 'new_startup', venture_name: 'Nile Pay', field: 'technology', venture_stage: 'mvp', venture_url: 'https://nilepay.example', venture_description: null, wants_programs: true, employer: null }
  it('turns the stored answer into form strings and back into the same payload (nothing to save)', () => {
    const f = answerToForm(stored)
    expect(f).toMatchObject({ answer_type: 'new_startup', venture_name: 'Nile Pay', venture_description: '', wants_programs: true, employer: '' })
    expect(closedFormChanged(stored, f)).toBe(false)
  })
  it('an edit, or a first answer, is a change; no type chosen is not', () => {
    expect(closedFormChanged(stored, { ...answerToForm(stored), venture_name: 'Nile Pay 2' })).toBe(true)
    expect(closedFormChanged(null, venture())).toBe(true)
    expect(closedFormChanged(null, emptyClosedForm())).toBe(false)
    expect(closedFormChanged(stored, { ...answerToForm(stored), answer_type: 'other', other_text: 'x' })).toBe(true)
  })
  it('an unknown stored type gives an empty choice', () => {
    expect(answerToForm({ answer_type: 'seeking' }).answer_type).toBe('')
    expect(answerToForm(null)).toEqual(emptyClosedForm())
  })
})

describe('answerHeadline', () => {
  it('names the venture, the employer or the start of the text', () => {
    expect(answerHeadline({ answer_type: 'new_startup', venture_name: 'Nile Pay' })).toBe('Nile Pay')
    expect(answerHeadline({ answer_type: 'employed', employer: 'ACME' })).toBe('ACME')
    expect(answerHeadline({ answer_type: 'other', other_text: 'x'.repeat(100) }, 10)).toBe('xxxxxxxxx…')
    expect(answerHeadline(null)).toBe('')
  })
})
