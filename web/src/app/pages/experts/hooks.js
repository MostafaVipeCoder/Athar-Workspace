import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Where the registry lives for the CURRENT shell: the staff app (Programs / Experts / Companies ... tabs) mounts it at /network/experts, the Alumni manager's shell at
 * /alumni/admin/experts (the same pages, the same components: only the base of the links differs).
 */
export function useExpertsBase() {
  const { pathname } = useLocation()
  return pathname.startsWith('/alumni/admin') ? '/alumni/admin/experts' : '/network/experts'
}

/** A value that follows `value` after `ms` of quiet (the search box, the duplicate check while typing). */
export function useDebouncedValue(value, ms = 400) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** A calendar DAY from the database ('2026-09-27'): formatted in UTC so no time zone moves it to the neighbouring day. */
export const fmtDay = (formatDate, value) => (value ? formatDate(value, { dateStyle: 'medium', timeZone: 'UTC' }) : '')

const SERVER_FIELD = {
  name: 'name', name_en: 'name', name_ar: 'name', title_en: 'title', title_ar: 'title', company_en: 'company', company_ar: 'company', bio_en: 'bio', bio_ar: 'bio',
  email: 'email', phone: 'phone', linkedin_url: 'linkedin', website_url: 'website', links: 'links', languages: 'languages', tags: 'tags', notes: 'notes', photo_path: 'photo', kind: 'kind',
}
const REASON_KEY = { required: 'experts.err.nameRequired', too_long: 'experts.err.tooLong', invalid: null, too_many: 'experts.err.tooMany', archived: 'experts.err.tagArchived', too_many_new: 'experts.err.tooManyNewTags' }

/** A server refusal `expert_invalid` (detail "field:reason") -> { field, key } for the form; null for any other error. */
export function serverFieldError(error) {
  if (error?.token !== 'expert_invalid' || typeof error.detail !== 'string') return null
  const [rawField, reason] = error.detail.split(':')
  const field = SERVER_FIELD[rawField]
  if (!field) return null
  const byReason = REASON_KEY[reason]
  const fallback = { email: 'experts.err.email', phone: 'experts.err.phone', linkedin: 'experts.err.url', website: 'experts.err.url', links: 'experts.err.url', photo: 'experts.err.photo' }[field]
  return { field, key: byReason ?? fallback ?? 'experts.err.invalid' }
}

/** The text of any error for a toast / inline alert (the form field errors are handled by `serverFieldError`). */
export function errorText(t, error) {
  const field = serverFieldError(error)
  if (field) return t(field.key)
  return t(error?.messageKey ?? 'errors.unknown')
}
