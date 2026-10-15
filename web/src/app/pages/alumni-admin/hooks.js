import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAlumniLookups } from '../../../data/alumni.js'
import { lookupLabel, lookupOptions, parseAlumniError } from '../../../lib/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { copyText } from '../../../lib/clipboard.js'
import './i18n.common.js'
import '../../../shared/alumni/i18n.quarters.js'

/** A value that follows `value` after `ms` of silence (the search boxes: one request per pause, not per key). */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** The vocabulary in the UI language: `label(kind, key)`, `options(kind, opts)`; `ready` when the lookups loaded. (One cached query shared by every page.) */
export function useLabels() {
  const { lang } = useLanguage()
  const q = useAlumniLookups()
  const lookups = q.data
  return useMemo(() => ({
    lookups,
    ready: Boolean(lookups),
    isPending: q.isPending,
    label: (kind, key) => lookupLabel(lookups, kind, key, lang),
    options: (kind, opts) => lookupOptions(lookups, kind, lang, opts),
    lang,
  }), [lookups, q.isPending, lang])
}

/** Number / money / date formatters in the UI language (Western digits in Arabic, owner decision OD-12; EGP everywhere, design 09 open question 4). */
export function useAdminFormat() {
  const { lang, formatNumber, formatDate } = useLanguage()
  return useMemo(() => ({
    num: (v) => (v === null || v === undefined || v === '' ? '' : formatNumber(Number(v))),
    money: (v) => (v === null || v === undefined || v === '' ? '' : formatNumber(Number(v), { style: 'currency', currency: 'EGP', maximumFractionDigits: 0, currencyDisplay: lang === 'ar' ? 'name' : 'code' })),
    compact: (v) => (v === null || v === undefined ? '' : formatNumber(Number(v), { notation: 'compact', maximumFractionDigits: 1 })),
    pct: (v) => (v === null || v === undefined ? '' : `${formatNumber(Number(v), { maximumFractionDigits: 1 })}%`),
    date: (v) => (v ? formatDate(v) : ''),
    dateTime: (v) => (v ? formatDate(v, { dateStyle: 'medium', timeStyle: 'short' }) : ''),
  }), [lang, formatNumber, formatDate])
}

const TOKEN_KEYS = {
  alumni_stale: 'alumni.admin.common.err.stale', alumni_not_found: 'alumni.admin.common.err.notFound', alumni_rate_limited: 'alumni.admin.common.err.rateLimited',
  alumni_in_use: 'alumni.admin.common.err.inUse', national_id_invalid: 'alumni.admin.common.err.nidInvalid', national_id_conflict: 'alumni.admin.common.err.nidConflict',
  alumni_company_exists: 'alumni.admin.common.err.companyExists', opportunity_closed: 'alumni.admin.common.err.opportunityClosed',
  alumni_confirm_required: 'alumni.q.err.confirmRequired', alumni_not_reopened: 'alumni.q.err.notReopened', alumni_quarter_future: 'alumni.q.err.quarterFuture',
}

/**
 * `(err, fieldNames?) => string`: the sentence for a refused write. A refusal about a field reads "<field>: <reason>" (the server's `field:reason`, translated; `fieldNames`
 * maps the server's field to a label), a token has its own sentence, anything else the error's translated message. Never contains a national ID (the server never puts one in a message).
 */
export function useAdminErrorText() {
  const { t } = useLanguage()
  return useCallback((err, fieldNames = {}) => {
    const { token, field, reason } = parseAlumniError(err)
    if (token === 'alumni_invalid' && field && reason) {
      const rKey = `alumni.admin.common.reason.${reason}`
      const rText = t(rKey)
      return t('alumni.admin.common.err.field', { field: fieldNames[field] ?? field.replace(/_/g, ' '), reason: rText === rKey ? reason : rText })
    }
    if (token && TOKEN_KEYS[token]) return t(TOKEN_KEYS[token])
    if (err?.code === 'forbidden') return t('alumni.admin.common.err.forbidden')
    return t(err?.messageKey ?? 'errors.unknown')
  }, [t])
}

/** `copy(text)` -> true / false; shows the translated toast. Clipboard access can be refused (insecure origin, permissions): the caller's UI always shows the text too. */
export function useCopy() {
  const { t } = useLanguage()
  const toast = useToast()
  return useCallback(async (text) => {
    if (await copyText(text)) {
      toast.success(t('alumni.admin.common.copied'), { duration: 2000 })
      return true
    }
    toast.warning(t('alumni.admin.common.copyFailed'))
    return false
  }, [t, toast])
}
