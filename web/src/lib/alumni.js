/**
 * Pure helpers of the Alumni pages (design 09, m49). Shared by the founder-side and the manager-side builders.
 *
 * What is NOT here on purpose: any rule of the Egyptian national ID (validity, birth date, age, gender, governorate). The database derives and validates it
 * (`app_private.id_*`); the form asks `preview_national_id`. `digitsOnly` only formats what the person types.
 */

/** `alumni_lookups` kind -> the list name in the `list_alumni_lookups()` payload. */
export const LOOKUP_LISTS = Object.freeze({
  startup_type: 'startup_types',
  stage: 'stages',
  legal_status: 'legal_statuses',
  closing_reason: 'closing_reasons',
  after_closing: 'after_closing',
  support_kind: 'support_kinds',
  age_category: 'age_categories',
  gender: 'genders',
  education_status: 'education_statuses',
  operating_status: 'operating_statuses',
  directory_visibility: 'directory_visibilities',
})

const pickLang = (lang) => (lang === 'ar' ? 'ar' : 'en')

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'

/** Formatting only: Arabic-Indic / Persian digits -> ASCII, everything else dropped, clamped to `max` (14 for a national ID). */
export function digitsOnly(value, max = 14) {
  let out = ''
  for (const ch of String(value ?? '')) {
    const a = ARABIC_INDIC.indexOf(ch)
    const p = PERSIAN.indexOf(ch)
    if (a >= 0) out += String(a)
    else if (p >= 0) out += String(p)
    else if (ch >= '0' && ch <= '9') out += ch
  }
  return out.slice(0, max)
}

/** The sector entries (with `subsectors`) of the lookups payload. */
const sectorsOf = (lookups) => lookups?.sectors ?? []

/** Label of a lookup value in the UI language; falls back to the key (an inactive / unknown legacy value is still shown). `null` key -> ''. */
export function lookupLabel(lookups, kind, key, lang = 'en') {
  if (key === null || key === undefined || key === '') return ''
  const l = pickLang(lang)
  if (kind === 'governorate') {
    const g = (lookups?.governorates ?? []).find((x) => Number(x.code) === Number(key))
    return g ? g[`name_${l}`] : String(key)
  }
  if (kind === 'sector') {
    const s = sectorsOf(lookups).find((x) => x.key === key)
    return s ? s[`label_${l}`] : String(key)
  }
  if (kind === 'subsector') {
    for (const s of sectorsOf(lookups)) {
      const hit = (s.subsectors ?? []).find((x) => x.key === key)
      if (hit) return hit[`label_${l}`]
    }
    return String(key)
  }
  const list = lookups?.[LOOKUP_LISTS[kind]] ?? []
  const hit = list.find((x) => x.key === key)
  return hit ? hit[`label_${l}`] : String(key)
}

/**
 * Options for a select / ChipSelect: `[{ value, label }]` sorted by the server order. Inactive values are hidden unless they are the `current` value
 * (a company that holds a deactivated value must still show it). `kind` is a LOOKUP_LISTS key, 'sector' or 'governorate'.
 */
export function lookupOptions(lookups, kind, lang = 'en', { current = null, includeAbroad = false } = {}) {
  const l = pickLang(lang)
  if (kind === 'governorate') {
    return (lookups?.governorates ?? []).filter((g) => includeAbroad || !g.is_abroad).map((g) => ({ value: g.code, label: g[`name_${l}`] }))
  }
  const list = kind === 'sector' ? sectorsOf(lookups) : lookups?.[LOOKUP_LISTS[kind]] ?? []
  return [...list]
    .filter((x) => x.active !== false || x.key === current)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.key).localeCompare(String(b.key)))
    .map((x) => ({ value: x.key, label: x[`label_${l}`] }))
}

/** Sub sectors of ONE sector (the sub sector select depends on the sector); empty without a sector. */
export function subsectorOptions(lookups, sectorKey, lang = 'en', { current = null } = {}) {
  const l = pickLang(lang)
  const s = sectorsOf(lookups).find((x) => x.key === sectorKey)
  if (!s) return []
  return [...(s.subsectors ?? [])]
    .filter((x) => x.active !== false || x.key === current)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.key).localeCompare(String(b.key)))
    .map((x) => ({ value: x.key, label: x[`label_${l}`] }))
}

/**
 * What an RPC error means for a form. `err` is an AppError from data/ (or a raw PostgREST error): the token is the hint (or the message prefix), `detail` is
 * `field:reason` for `alumni_invalid` and `national_id:<reason>` for `national_id_invalid`.
 * Returns `{ token, field, reason }` (any may be null).
 */
export function parseAlumniError(err) {
  const cause = err?.cause ?? err
  const hint = String(cause?.hint ?? '')
  const message = String(cause?.message ?? err?.message ?? '')
  const token = /^(alumni_[a-z_]+|national_id_[a-z_]+)$/.test(hint) ? hint : (/^(alumni_[a-z_]+|national_id_[a-z_]+):/.exec(message)?.[1] ?? null)
  const detail = String(err?.detail ?? cause?.details ?? cause?.detail ?? '')
  const i = detail.indexOf(':')
  return { token, field: i > 0 ? detail.slice(0, i) : null, reason: i > 0 ? detail.slice(i + 1) : null }
}

const norm = (v) => (v === '' || v === undefined ? null : v)
// key-order independent (the server returns {url,kind,label}, a form may build {kind,url,label})
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v)
const same = (a, b) => JSON.stringify(stable(norm(a))) === JSON.stringify(stable(norm(b)))
/** Two form values are equal when they are the same after the empty-string-is-null and key-order normalisation (what a patch is built from). */
export const sameValue = same

/**
 * The patch to send: ONLY the keys of `keys` whose value changed between `base` (what the server returned) and `next` (the form state); empty strings count as
 * null. The save RPCs take patches (absent key = untouched), so a stale form never overwrites a field the person did not touch.
 */
export function diffPatch(base, next, keys) {
  const out = {}
  for (const k of keys) {
    if (!same(base?.[k], next?.[k])) out[k] = norm(next?.[k])
  }
  return out
}

/** Tone of the completeness meter (the percent comes from the server). */
export function completenessTone(percent) {
  const p = Number(percent)
  if (!Number.isFinite(p)) return 'neutral'
  if (p >= 90) return 'success'
  if (p >= 60) return 'warning'
  return 'danger'
}

/** `Kind: url` pairs of a company's social entries, for display (the export builds its own text on the server). */
const SOCIAL_KINDS = Object.freeze(['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'telegram', 'whatsapp'])
export const LINK_KINDS = Object.freeze([...SOCIAL_KINDS, 'deck', 'video', 'other'])
