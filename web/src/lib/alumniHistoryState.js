/**
 * URL state of the history page (owner decision 20.4): the filters, the page and the size live in the address, so a view can be linked and survives a reload. Pure functions, no React.
 * No national ID or any personal value is ever a filter or enters a URL (the filters are company / person ids, areas, field names, years, kinds of editor and dates).
 */

export const HISTORY_ENTITIES = Object.freeze(['company', 'snapshot', 'founder', 'identity', 'team', 'internal'])
export const HISTORY_SOURCES = Object.freeze(['manager', 'founder', 'import', 'system'])
export const HISTORY_ROLES = Object.freeze(['super_admin', 'alumni_manager', 'project_manager', 'founder', 'system'])
export const HISTORY_PAGE_SIZES = Object.freeze([25, 50, 100])

/** The fields a manager can narrow the history to, with the area each belongs to (the label of a field is `alumni.edit.field.<field>`). */
export const HISTORY_FIELDS = Object.freeze([
  ['company', ['name_en', 'name_ar', 'description_en', 'description_ar', 'logo_path', 'established_on', 'startup_type', 'sector', 'subsector', 'stage', 'legal_status', 'governorate', 'location_en', 'location_ar',
    'website_url', 'app_url', 'linkedin_url', 'links', 'operating_status', 'closed_on', 'closing_reason', 'after_closing', 'closing_note', 'directory_visibility', 'is_alumni', 'deleted_at',
    'founding_year', 'employees', 'industry_en', 'industry_ar', 'governorate_en', 'governorate_ar']],
  ['snapshot', ['revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers', 'traction', 'challenges', 'needs', 'reviewed_at']],
  ['founder', ['name_en', 'name_ar', 'email', 'phone', 'linkedin_url', 'photo_path', 'bio_en', 'bio_ar', 'education_status', 'has_account']],
  ['identity', ['national_id', 'self_birth_date', 'self_gender']],
  ['team', ['member', 'role', 'is_primary']],
  ['internal', ['hint', 'directory_hidden', 'reviewed_at']],
])

const TYPES = Object.freeze({
  company_id: 's', founder_id: 's', entity_type: 's', field: 's', year: 'y', source: 's', actor_role: 's', from: 'd', to: 'd', q: 's',
})
export const HISTORY_FILTER_KEYS = Object.freeze(Object.keys(TYPES))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const empty = (v) => v === undefined || v === null || v === ''

/** Clean filters for the page state: drop empties, keep known keys, validate ids / enums / years / dates. */
export function toHistoryFilters(filters) {
  const out = {}
  for (const k of HISTORY_FILTER_KEYS) {
    const v = filters?.[k]
    if (empty(v)) continue
    const s = String(v).trim()
    if (!s) continue
    if ((k === 'company_id' || k === 'founder_id') && !UUID.test(s)) continue
    if (k === 'entity_type' && !HISTORY_ENTITIES.includes(s)) continue
    if (k === 'source' && !HISTORY_SOURCES.includes(s)) continue
    if (k === 'actor_role' && !HISTORY_ROLES.includes(s)) continue
    if (k === 'year' && !/^(19|20)\d{2}$/.test(s)) continue
    if ((k === 'from' || k === 'to') && !/^\d{4}-\d{2}-\d{2}$/.test(s)) continue
    if (k === 'field' && !/^[a-z_]{2,40}$/.test(s)) continue
    out[k] = k === 'q' ? s.slice(0, 100) : s
  }
  return out
}

const intOr = (v, fb) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : fb
}

/** URLSearchParams / query string -> `{ filters, page, size }`. */
export function parseHistoryState(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''))
  const raw = {}
  for (const k of HISTORY_FILTER_KEYS) if (p.has(k)) raw[k] = p.get(k)
  const size = HISTORY_PAGE_SIZES.includes(intOr(p.get('size'), 0)) ? intOr(p.get('size'), 0) : 25
  return { filters: toHistoryFilters(raw), page: intOr(p.get('page'), 1), size }
}

export function serializeHistoryState(state) {
  const p = new URLSearchParams()
  const f = toHistoryFilters(state?.filters)
  for (const k of HISTORY_FILTER_KEYS) if (k in f) p.set(k, f[k])
  if (state?.page > 1) p.set('page', String(state.page))
  if (state?.size && state.size !== 25) p.set('size', String(state.size))
  return p.toString()
}

const MANAGED = new Set([...HISTORY_FILTER_KEYS, 'page', 'size'])
/** The query string after a change: the managed keys come from `state`, every other parameter (`lang` ...) is kept. */
export function mergeHistorySearch(current, state) {
  const next = new URLSearchParams(serializeHistoryState(state))
  const cur = current instanceof URLSearchParams ? current : new URLSearchParams(String(current ?? ''))
  for (const [k, v] of cur) if (!MANAGED.has(k)) next.set(k, v)
  return next
}

export const activeHistoryFilterCount = (filters) => Object.keys(toHistoryFilters(filters)).filter((k) => k !== 'company_id' && k !== 'q').length

/**
 * The RPC filters from the page filters: the date-only inputs become inclusive instants (start of the first day, end of the last day, the browser's zone), `year` is a text, the empty ones are
 * dropped. `dayBound` is injected (lib/alumniHistory.js) so this module stays dependency-free.
 */
export function toRpcHistoryFilters(filters, dayBound) {
  const f = toHistoryFilters(filters)
  const out = {}
  for (const [k, v] of Object.entries(f)) {
    if (k === 'from') { const b = dayBound(v, 'start'); if (b) out.from = b } else if (k === 'to') { const b = dayBound(v, 'end'); if (b) out.to = b } else out[k] = v
  }
  return out
}
