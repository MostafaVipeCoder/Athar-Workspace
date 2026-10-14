import { useCallback } from 'react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { parseAlumniError } from '../../lib/alumni.js'
import { fieldErrorOf } from '../../lib/alumniForms.js'

/**
 * `(err) => string`: the sentence for a refused save. A refusal about a field reads "<field>: <reason>" (the server's `field:reason`, translated), anything else uses the
 * error's own translated message (data/errors.js tokens, `alumni.err.*`). Never contains a national ID (the server never puts one in a message).
 */
export function useAlumniErrorText() {
  const { t } = useLanguage()
  return useCallback((err) => {
    const fe = fieldErrorOf(parseAlumniError(err))
    if (fe) {
      const known = t(`alumni.field.${fe.field}`)
      return t('alumni.err.field', { field: known === `alumni.field.${fe.field}` ? fe.field : known, reason: t(fe.key) })
    }
    return t(err?.messageKey ?? 'errors.unknown')
  }, [t])
}

/** `{ field: 'translated reason' }` for the form fields a server refusal names (empty when it names none). */
export function useAlumniFieldErrors() {
  const { t } = useLanguage()
  return useCallback((err) => {
    const fe = fieldErrorOf(parseAlumniError(err))
    return fe ? { [fe.field]: t(fe.key) } : {}
  }, [t])
}
