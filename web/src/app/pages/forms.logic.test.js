import { describe, it, expect } from 'vitest'
import { validateProgram, programToValues, programValuesToPatch, validateProjectDetails, validateInviteForm } from './forms.logic.js'
import { fromColumns, toColumns } from '../../lib/bilingual.js'
import { initialsOf, colorFor } from '../../lib/avatar.js'

describe('program form logic', () => {
  it('requires a name in at least one language and a sane year', () => {
    expect(validateProgram({ name: { en: '', ar: '' } })).toEqual({ name: 'programs.form.nameRequired' })
    expect(validateProgram({ name: { en: '', ar: 'برنامج' }, year: '' })).toEqual({})
    expect(validateProgram({ name: { en: 'X', ar: '' }, year: '1999' })).toEqual({ year: 'programs.form.yearInvalid' })
    expect(validateProgram({ name: { en: 'X', ar: '' }, year: '2026' })).toEqual({})
  })
  it('round-trips a DB row through values and patch', () => {
    const row = { name_en: 'Spring', name_ar: null, description_en: 'd', description_ar: '', program_type: 'accelerator', year: 2026, visibility: 'public' }
    const values = programToValues(row)
    expect(values).toEqual({ name: { en: 'Spring', ar: '' }, description: { en: 'd', ar: '' }, program_type: 'accelerator', year: 2026, visibility: 'public' })
    expect(programValuesToPatch(values)).toEqual({ name_en: 'Spring', name_ar: null, description_en: 'd', description_ar: null, program_type: 'accelerator', year: 2026, visibility: 'public' })
    expect(programValuesToPatch({ name: { en: ' a ', ar: '' }, description: {}, program_type: '', year: '', visibility: '' })).toMatchObject({ name_en: 'a', program_type: null, year: null, visibility: 'private' })
  })
  it('bilingual column helpers', () => {
    expect(fromColumns({ x_en: 'a', x_ar: 'ب' }, 'x')).toEqual({ en: 'a', ar: 'ب' })
    expect(fromColumns(null, 'x')).toEqual({ en: '', ar: '' })
    expect(toColumns({ en: '  ', ar: 'ب' }, 'x')).toEqual({ x_en: null, x_ar: 'ب' })
  })
})

describe('project details logic', () => {
  it('validates map link and offline days', () => {
    expect(validateProjectDetails({ name: { en: 'P' }, map_url: 'maps.google.com', offline_days: '' })).toEqual({ map_url: 'projects.form.mapInvalid' })
    expect(validateProjectDetails({ name: { en: 'P' }, map_url: 'https://maps.app.goo.gl/x', offline_days: '3' })).toEqual({})
    expect(validateProjectDetails({ name: { en: 'P' }, map_url: '', offline_days: '-1' })).toEqual({ offline_days: 'projects.form.offlineInvalid' })
    expect(validateProjectDetails({ name: { en: 'P' }, offline_days: '2.5' })).toEqual({ offline_days: 'projects.form.offlineInvalid' })
    expect(validateProjectDetails({ name: { en: '', ar: '' } })).toEqual({ name: 'programs.form.nameRequired' })
  })
})

describe('staff invite form logic', () => {
  it('asks only name + password + colour', () => {
    expect(validateInviteForm({ fullName: 'A', password: 'short', confirm: 'short', color: '#1a27c9' })).toEqual({ fullName: 'invite.nameRequired', password: 'invite.passwordShort' })
    expect(validateInviteForm({ fullName: 'Mona', password: 'longenough1', confirm: 'different', color: '#1a27c9' })).toEqual({ confirm: 'invite.passwordMismatch' })
    expect(validateInviteForm({ fullName: 'Mona', password: 'longenough1', confirm: 'longenough1', color: 'red' })).toEqual({ color: 'invite.colorRequired' })
    expect(validateInviteForm({ fullName: 'Mona', password: 'longenough1', confirm: 'longenough1', color: '#A1B2C3' })).toEqual({})
  })
  it('avatar helpers', () => {
    expect(initialsOf('Mona Fathy Ali')).toBe('MF')
    expect(initialsOf('')).toBe('?')
    expect(colorFor('x', '#123456')).toBe('#123456')
    expect(colorFor('same-id')).toBe(colorFor('same-id'))
    expect(colorFor('a')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
