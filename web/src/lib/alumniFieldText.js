/**
 * How the VALUE of an alumni field is shown as text, in the viewer's language (lookups -> labels, money, dates, a national ID only as "recorded"). Pure, no React.
 * Used by the conflict dialogs (two people edited the same record) through shared/alumni/useEditText.js. (The per-edit history this once served was removed: owner decision 21.)
 */
import { lookupLabel } from './alumni.js'

const LOOKUP_FIELDS = Object.freeze({
  startup_type: 'startup_type', sector: 'sector', subsector: 'subsector', stage: 'stage', legal_status: 'legal_status', closing_reason: 'closing_reason', after_closing: 'after_closing',
  operating_status: 'operating_status', directory_visibility: 'directory_visibility', education_status: 'education_status', self_gender: 'gender',
})
const BOOL_FIELDS = new Set(['is_alumni', 'directory_hidden', 'has_account', 'is_primary'])
const DATE_FIELDS = new Set(['established_on', 'closed_on'])
const TIMESTAMP_FIELDS = new Set(['deleted_at', 'reviewed_at'])
const MONEY_FIELDS = new Set(['revenue_total', 'funding_raised_total'])
const COUNT_FIELDS = new Set(['employees_total', 'employees_female', 'freelancers'])
const FILE_FIELDS = new Set(['logo_path', 'photo_path'])

/** How a field's value is shown: `{ kind: 'lookup', lookup }`, 'governorate', 'bool', 'date', 'timestamp', 'money', 'count', 'file', 'links', 'member', 'idflag' or 'text'. */
export function fieldKind(field) {
  if (field in LOOKUP_FIELDS) return { kind: 'lookup', lookup: LOOKUP_FIELDS[field] }
  if (field === 'governorate') return { kind: 'governorate' }
  if (BOOL_FIELDS.has(field)) return { kind: 'bool' }
  if (DATE_FIELDS.has(field)) return { kind: 'date' }
  if (TIMESTAMP_FIELDS.has(field)) return { kind: 'timestamp' }
  if (MONEY_FIELDS.has(field)) return { kind: 'money' }
  if (COUNT_FIELDS.has(field)) return { kind: 'count' }
  if (FILE_FIELDS.has(field)) return { kind: 'file' }
  if (field === 'links') return { kind: 'links' }
  if (field === 'member') return { kind: 'member' }
  if (field === 'national_id') return { kind: 'idflag' }
  return { kind: 'text' }
}

/** Nothing there: null, an empty string, an empty list. (`false` and `0` are values.) */
export const isEmptyValue = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)

/**
 * The text of a value for a field, in the viewer's language. `ctx` = `{ lookups, lang, t, formatDate(v, opts), formatNumber(n, opts) }`. Empty -> ''. Never throws on an unexpected shape.
 */
export function formatFieldText(field, value, ctx) {
  if (isEmptyValue(value)) return ''
  const { kind, lookup } = fieldKind(field)
  const { lookups, lang = 'en', t } = ctx
  try {
    switch (kind) {
      case 'lookup': return lookupLabel(lookups, lookup, value, lang)
      case 'governorate': return lookupLabel(lookups, 'governorate', value, lang)
      case 'bool': return value ? t('alumni.edit.yes') : t('alumni.edit.no')
      case 'date': return ctx.formatDate(value, { dateStyle: 'medium' })
      case 'timestamp': return ctx.formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
      case 'money': return ctx.formatNumber(Number(value), { style: 'currency', currency: 'EGP', maximumFractionDigits: 0, currencyDisplay: lang === 'ar' ? 'name' : 'code' })
      case 'count': return ctx.formatNumber(Number(value))
      case 'file': return t('alumni.edit.fileSet')
      case 'links': return (Array.isArray(value) ? value : []).map((l) => `${l?.label || l?.kind || ''}: ${l?.url ?? ''}`.trim()).join('; ')
      case 'member': return typeof value === 'object' && value ? t('alumni.edit.memberAs', { role: value.role ?? '' }) : t('alumni.edit.yes')
      case 'idflag': return value ? t('alumni.edit.idExists') : t('alumni.edit.idNone')
      default: return typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
  } catch {
    return String(value)
  }
}
