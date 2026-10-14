/**
 * Form <-> payload logic of the founder-side Alumni forms (design 09 F4 / F5; contract alumni.contract.md sections 0, 3.2, 3.3).
 *
 * The server returns `null` for "empty"; inputs need strings: `*ToForm` turns the payload into form values, `build*Patch` turns the values back into the PATCH to send
 * (only the keys that changed, `diffPatch` of lib/alumni.js; an empty string is null), `validate*` gives instant feedback with the SAME reason vocabulary the server
 * uses (`alumni.reason.<reason>`), so a refused save and an instant hint read the same. The server stays the authority and re-validates everything.
 *
 * What is NOT here on purpose: any derived value (age, gender, governorate of origin, Program Scope ...) and any national-ID rule beyond the instant checks of
 * lib/nationalId.js.
 */
import { diffPatch } from './alumni.js'
import { cleanPhoneInput, validatePhone } from './contact.js'
import { cairoToday, normalizeNationalId, nationalIdProblem } from './nationalId.js'

export const FOUNDER_KEYS = Object.freeze(['name_en', 'name_ar', 'bio_en', 'bio_ar', 'phone', 'linkedin_url', 'photo_path', 'education_status'])
export const COMPANY_KEYS = Object.freeze([
  'name_en', 'name_ar', 'description_en', 'description_ar', 'logo_path', 'startup_type', 'sector', 'subsector', 'stage', 'legal_status', 'governorate', 'location_en', 'location_ar',
  'established_on', 'website_url', 'app_url', 'linkedin_url', 'links', 'operating_status', 'closed_on', 'closing_reason', 'after_closing', 'closing_note', 'directory_visibility',
])
/** The phone countries the form offers (E.164 is built by lib/contact; the server normalises again). */
export const PHONE_COUNTRIES = Object.freeze(['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO'])

const URL_RE = /^https?:\/\/[^\s]+$/i
const str = (v) => (v === null || v === undefined ? '' : String(v))

// ------------------------------------------------------------------ the founder
/** Payload `founder` -> form values (strings; `national_id` = the saved number the owner sees, '' when none). */
export function founderToForm(founder) {
  const f = founder ?? {}
  const id = f.identity ?? {}
  return {
    name_en: str(f.name_en), name_ar: str(f.name_ar), bio_en: str(f.bio_en), bio_ar: str(f.bio_ar), phone: str(f.phone), linkedin_url: str(f.linkedin_url),
    photo_path: str(f.photo_path), education_status: str(f.education_status),
    national_id: str(id.national_id), self_birth_date: str(id.self_birth_date), self_gender: str(id.self_gender),
  }
}

/** The phone as it will be stored (E.164 when it parses, else what was typed): what two phone values are compared by. */
export function phoneForPatch(raw) {
  const v = validatePhone(raw, PHONE_COUNTRIES)
  return v.valid ? v.sanitized : cleanPhoneInput(raw)
}

/**
 * The patch of `save_my_founder_profile`: changed keys only.
 *  - `national_id`: only when the typed number differs from the saved one ('' = remove it); sent in the body of a POST and nowhere else;
 *  - `self_birth_date` / `self_gender`: only while the form holds NO national ID (the ID wins: the server refuses a typed value next to an ID, and erases the typed
 *    values when an ID is entered, so they are never sent together).
 */
export function buildFounderPatch(base, values) {
  const b = { ...base, phone: phoneForPatch(base?.phone) } // `base` = the FORM values the server state was turned into (founderToForm)
  const v = { ...values, phone: phoneForPatch(values.phone) }
  const patch = diffPatch(b, v, FOUNDER_KEYS)
  const typedId = normalizeNationalId(values.national_id) ?? ''
  const savedId = normalizeNationalId(b.national_id) ?? ''
  if (typedId !== savedId) patch.national_id = typedId === '' ? null : typedId
  if (typedId === '') Object.assign(patch, diffPatch(b, values, ['self_birth_date', 'self_gender']))
  return patch
}

/**
 * Instant checks of the founder form -> `{ field: 'alumni.reason.<reason>' | 'alumni.err.nid.<reason>' }` (an i18n key per failure; empty object = fine).
 * `lookups` supplies the governorate codes for the national ID check (the list lives in the database, not here).
 */
export function validateFounderForm(values, { today = cairoToday(), governorateCodes = null } = {}) {
  const e = {}
  if (!values.name_en?.trim() && !values.name_ar?.trim()) e.name_ar = 'alumni.reason.required'
  for (const k of ['name_en', 'name_ar']) if (values[k]?.length > 200) e[k] = 'alumni.reason.too_long'
  for (const k of ['bio_en', 'bio_ar']) if (values[k]?.length > 4000) e[k] = 'alumni.reason.too_long'
  if (values.phone?.trim() && !validatePhone(values.phone, PHONE_COUNTRIES).valid) e.phone = 'alumni.reason.bad_value'
  if (values.linkedin_url?.trim() && (values.linkedin_url.trim().length > 300 || !URL_RE.test(values.linkedin_url.trim()))) e.linkedin_url = 'alumni.reason.bad_url'
  const nid = normalizeNationalId(values.national_id)
  if (nid) {
    const problem = nationalIdProblem(nid, { today, governorateCodes })
    if (problem) e.national_id = `alumni.err.nid.${problem}`
  } else {
    const d = values.self_birth_date?.trim()
    if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today || d < '1900-01-01')) e.self_birth_date = 'alumni.reason.bad_date'
  }
  return e
}

// ------------------------------------------------------------------ the company
/** Payload `company` -> form values. Lookup keys / dates / urls are strings, `governorate` is a number or '', `links` an array. */
export function companyToForm(company) {
  const c = company ?? {}
  const out = {}
  for (const k of COMPANY_KEYS) out[k] = k === 'links' ? (Array.isArray(c.links) ? c.links.map((l) => ({ kind: l.kind, url: l.url, ...(l.label ? { label: l.label } : {}) })) : []) : k === 'governorate' ? (c.governorate ?? '') : str(c[k])
  out.operating_status = c.operating_status ?? 'open'
  out.directory_visibility = c.directory_visibility ?? 'private'
  return out
}

/** Social links without an address are not saved (an "empty row" of the editor). */
export const cleanLinks = (links) => (Array.isArray(links) ? links : []).filter((l) => l && String(l.url ?? '').trim()).map((l) => ({ kind: l.kind, url: String(l.url).trim(), ...(l.label?.trim() ? { label: l.label.trim() } : {}) }))

/** The patch of `save_my_company_profile`: changed keys only (`governorate` is the numeric code, links are compared by value). */
export function buildCompanyPatch(base, values) {
  const b = { ...base } // `base` = the FORM values the server state was turned into (companyToForm)
  const next = { ...values, links: cleanLinks(values.links), governorate: values.governorate === '' || values.governorate === null ? '' : Number(values.governorate) }
  b.links = cleanLinks(b.links)
  return diffPatch(b, next, COMPANY_KEYS)
}

/** Instant checks of the company form (same reasons as the server). `today` = 'YYYY-MM-DD' (Cairo). */
export function validateCompanyForm(values, { today = cairoToday() } = {}) {
  const e = {}
  const has = (k) => Boolean(String(values[k] ?? '').trim())
  if (!has('name_en') && !has('name_ar')) e.name_ar = 'alumni.reason.required'
  for (const k of ['name_en', 'name_ar']) if (String(values[k] ?? '').length > 200) e[k] = 'alumni.reason.too_long'
  for (const k of ['description_en', 'description_ar']) if (String(values[k] ?? '').length > 4000) e[k] = 'alumni.reason.too_long'
  for (const k of ['location_en', 'location_ar']) if (String(values[k] ?? '').length > 300) e[k] = 'alumni.reason.too_long'
  if (String(values.closing_note ?? '').length > 1000) e.closing_note = 'alumni.reason.too_long'
  for (const k of ['website_url', 'app_url', 'linkedin_url']) {
    const u = String(values[k] ?? '').trim()
    if (u && (u.length > 500 || !URL_RE.test(u))) e[k] = 'alumni.reason.bad_url'
  }
  if (values.subsector && !values.sector) e.subsector = 'alumni.reason.needs_sector'
  const est = String(values.established_on ?? '').trim()
  if (est) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(est) || est < '1900-01-01') e.established_on = 'alumni.reason.bad_date'
    else if (est > today) e.established_on = 'alumni.reason.future'
  }
  const closed = String(values.closed_on ?? '').trim()
  if (values.operating_status === 'closed' && closed && (!/^\d{4}-\d{2}-\d{2}$/.test(closed) || closed < '1900-01-01' || closed > today)) e.closed_on = 'alumni.reason.bad_date'
  const links = Array.isArray(values.links) ? values.links : []
  if (links.length > 12) e.links = 'alumni.reason.bad_value'
  links.forEach((l, i) => {
    const u = String(l?.url ?? '').trim()
    if (u && (u.length > 500 || !URL_RE.test(u))) e[`links.${i}`] = 'alumni.reason.bad_url'
  })
  return e
}

// ------------------------------------------------------------------ completeness: which section fixes a missing item
export const FOUNDER_MISSING_SECTION = Object.freeze({ name: 'identity', phone: 'identity', education_status: 'identity', identity: 'national-id' })
export const COMPANY_MISSING_SECTION = Object.freeze({
  name: 'basics', description: 'basics', established_on: 'basics', startup_type: 'classification', sector: 'classification', stage: 'classification', legal_status: 'classification',
  governorate: 'location', online_presence: 'online', annual_update: 'metrics',
})

// ------------------------------------------------------------------ server refusals -> a field and a reason
/** Server field names that the forms call differently. */
const SERVER_FIELD = { name: 'name_ar', closing: 'closed_on' }

/**
 * `parseAlumniError(err)` (`{ token, field, reason }`) -> `{ field, key }`: the form field to mark and the i18n key of the reason, or null when the refusal is not about a field.
 * `national_id_invalid` -> `alumni.err.nid.<reason>` on `national_id`; `alumni_invalid` -> `alumni.reason.<reason>` on the field of the detail (`links.<i>` for a link).
 */
export function fieldErrorOf(parsed) {
  if (!parsed?.token) return null
  if (parsed.token === 'national_id_invalid') return { field: 'national_id', key: `alumni.err.nid.${parsed.reason ?? 'digits'}` }
  if (parsed.token === 'alumni_invalid' && parsed.field) return { field: SERVER_FIELD[parsed.field] ?? parsed.field, key: `alumni.reason.${parsed.reason ?? 'bad_value'}` }
  return null
}

// ------------------------------------------------------------------ the yearly row (company_snapshots)
export const SNAPSHOT_NUMBER_KEYS = Object.freeze(['revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers'])
export const SNAPSHOT_TEXT_KEYS = Object.freeze(['traction', 'challenges', 'needs'])
export const SNAPSHOT_KEYS = Object.freeze([...SNAPSHOT_NUMBER_KEYS, ...SNAPSHOT_TEXT_KEYS])
const COUNT_KEYS = ['employees_total', 'employees_female', 'freelancers']

/** One yearly row of the payload (or nothing = a new year) -> form values (strings). */
export function snapshotToForm(snapshot) {
  const out = {}
  for (const k of SNAPSHOT_KEYS) out[k] = str(snapshot?.[k])
  return out
}

/** The `data` of `upsert_company_snapshot`: changed keys only; numbers are sent as trimmed strings (the server parses them), an emptied field is null. */
export function buildSnapshotPatch(base, values) {
  const norm = (v) => (typeof v === 'string' ? v.trim() : v)
  const next = Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, norm(values[k])]))
  const b = Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, norm(base?.[k])]))
  return diffPatch(b, next, SNAPSHOT_KEYS)
}

/** Instant checks of the yearly form (reasons as the server: not_a_number, out_of_range, exceeds_total, too_long). */
export function validateSnapshotForm(values) {
  const e = {}
  for (const k of SNAPSHOT_NUMBER_KEYS) {
    const v = String(values[k] ?? '').trim()
    if (!v) continue
    if (COUNT_KEYS.includes(k)) {
      if (!/^[0-9]+$/.test(v)) e[k] = 'alumni.reason.not_a_number'
      else if (v.length > 7 || Number(v) > 1_000_000) e[k] = 'alumni.reason.out_of_range'
    } else if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(v)) e[k] = 'alumni.reason.not_a_number'
    else if (Number(v) > 1_000_000_000_000) e[k] = 'alumni.reason.out_of_range'
  }
  const total = String(values.employees_total ?? '').trim()
  const female = String(values.employees_female ?? '').trim()
  if (!e.employees_total && !e.employees_female && total && female && Number(female) > Number(total)) e.employees_female = 'alumni.reason.exceeds_total'
  for (const k of SNAPSHOT_TEXT_KEYS) if (String(values[k] ?? '').length > 4000) e[k] = 'alumni.reason.too_long'
  return e
}
