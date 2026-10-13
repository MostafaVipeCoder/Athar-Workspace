/** Pure form logic of the step-5 pages (unit-tested; kept out of component files for fast refresh). */
import { fromColumns, toColumns } from '../../lib/bilingual.js'

export function validateProgram(values) {
  const errors = {}
  if (!values.name?.en?.trim() && !values.name?.ar?.trim()) errors.name = 'programs.form.nameRequired'
  if (values.year !== '' && values.year !== null && values.year !== undefined) {
    const y = Number(values.year)
    if (!Number.isInteger(y) || y < 2000 || y > 2100) errors.year = 'programs.form.yearInvalid'
  }
  return errors
}

export function programToValues(row) {
  return {
    name: fromColumns(row, 'name'),
    description: fromColumns(row, 'description'),
    program_type: row?.program_type ?? '',
    year: row?.year ?? '',
    visibility: row?.visibility ?? 'private',
  }
}

export function programValuesToPatch(values) {
  return {
    ...toColumns(values.name, 'name'),
    ...toColumns(values.description, 'description'),
    program_type: values.program_type?.trim() || null,
    year: values.year === '' || values.year === null ? null : Number(values.year),
    visibility: values.visibility || 'private',
  }
}

export function validateProjectDetails(v) {
  const errors = {}
  if (!v.name?.en?.trim() && !v.name?.ar?.trim()) errors.name = 'programs.form.nameRequired'
  if (v.map_url && !/^https?:\/\/\S+$/i.test(v.map_url.trim())) errors.map_url = 'projects.form.mapInvalid'
  if (v.offline_days !== '' && v.offline_days !== null && v.offline_days !== undefined) {
    const n = Number(v.offline_days)
    if (!Number.isInteger(n) || n < 0 || n > 365) errors.offline_days = 'projects.form.offlineInvalid'
  }
  return errors
}

export function validateInviteForm({ fullName, password, confirm, color }) {
  const errors = {}
  if (!fullName?.trim() || fullName.trim().length < 2) errors.fullName = 'invite.nameRequired'
  if (!password || password.length < 8) errors.password = 'invite.passwordShort'
  else if (password !== confirm) errors.confirm = 'invite.passwordMismatch'
  if (!/^#[0-9a-f]{6}$/i.test(color ?? '')) errors.color = 'invite.colorRequired'
  return errors
}
