/**
 * Pure logic of the "Needs attention" queue (owner decision 20.3, m60): the URL state of the page, the per-viewer choice of which rules count, how a row shows its missing items, and
 * where a click leads. The catalogue itself (keys, required / recommended, the section that fixes an item) comes from the server (`list_alumni_attention().rules`); the texts are i18n.
 *
 * The queue is about DATA THAT IS MISSING wherever the company is, so its default scope is every company (the 141 migrated companies have no CEO yet: they are the queue).
 */

export const ATT_SCOPES = Object.freeze(['all', 'alumni', 'candidates'])
export const ATT_SORTS = Object.freeze(['missing', 'completeness', 'name', 'updated'])
export const ATT_PAGE_SIZES = Object.freeze([25, 50, 100])
const FILTER_TYPES = Object.freeze({ q: 's', scope: 's', program_id: 's', project_id: 's', missing: 's', severity: 's', has_account: 'b', invited: 'b' })
export const ATT_FILTER_KEYS = Object.freeze(Object.keys(FILTER_TYPES))
export const SEVERITIES = Object.freeze(['required', 'recommended'])

/** The section of the company page that fixes each rule of the catalogue (the server sends the same in `rules[].section`; the page needs it for a deep link without the list). */
export const RULE_SECTION = Object.freeze({
  ceo: 'team', ceo_id: 'team', contact: 'team', ceo_education: 'team', sector: 'classification', subsector: 'classification', stage: 'classification', startup_type: 'classification',
  legal_status: 'classification', governorate: 'location', latest_figures: 'metrics', description: 'basics', logo: 'basics', established_on: 'basics', online_presence: 'online',
})

/** The three items that need a CEO (a person) to exist: when the CEO is missing the row shows that one root cause, not three more chips (the server still counts them). */
export const CEO_DEPENDENT = Object.freeze(['ceo_id', 'contact', 'ceo_education'])

const empty = (v) => v === undefined || v === null || v === ''

/** Clean filters for the RPC: drop empties, coerce booleans, keep known keys only; `scope` defaults to 'all'. */
export function toAttFilters(filters) {
  const out = {}
  for (const k of ATT_FILTER_KEYS) {
    const v = filters?.[k]
    if (empty(v)) continue
    if (FILTER_TYPES[k] === 'b') {
      if (v === true || v === 'true') out[k] = true
      else if (v === false || v === 'false') out[k] = false
    } else {
      const s = String(v).trim()
      if (s) out[k] = s
    }
  }
  if (!ATT_SCOPES.includes(out.scope)) out.scope = 'all'
  if (out.severity && !SEVERITIES.includes(out.severity)) delete out.severity
  return out
}

const intOr = (v, fb) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : fb
}

/** URLSearchParams / query string -> `{ filters, sort, page, size }` (unknown keys and bad values are ignored). */
export function parseAttState(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''))
  const raw = {}
  for (const k of ATT_FILTER_KEYS) if (p.has(k)) raw[k] = p.get(k)
  const sort = ATT_SORTS.includes(p.get('sort')) ? p.get('sort') : 'missing'
  const size = ATT_PAGE_SIZES.includes(intOr(p.get('size'), 0)) ? intOr(p.get('size'), 0) : 25
  return { filters: toAttFilters(raw), sort, page: intOr(p.get('page'), 1), size }
}

/** State -> a query string without the defaults. */
export function serializeAttState(state) {
  const p = new URLSearchParams()
  const f = toAttFilters(state?.filters)
  for (const k of ATT_FILTER_KEYS) if (k in f && !(k === 'scope' && f[k] === 'all')) p.set(k, String(f[k]))
  if (state?.sort && state.sort !== 'missing') p.set('sort', state.sort)
  if (state?.page > 1) p.set('page', String(state.page))
  if (state?.size && state.size !== 25) p.set('size', String(state.size))
  return p.toString()
}

const MANAGED = new Set([...ATT_FILTER_KEYS, 'sort', 'page', 'size'])
/** The query string after a state change: the managed keys come from `state`, every other parameter of the URL (`lang`, ...) is kept. */
export function mergeAttSearch(current, state) {
  const next = new URLSearchParams(serializeAttState(state))
  const cur = current instanceof URLSearchParams ? current : new URLSearchParams(String(current ?? ''))
  for (const [k, v] of cur) if (!MANAGED.has(k)) next.set(k, v)
  return next
}

/** How many filters are set besides the search text and the scope (the badge of the filter button). */
export const activeAttFilterCount = (filters) => Object.keys(toAttFilters(filters)).filter((k) => k !== 'q' && k !== 'scope').length

/** The chips of a row: the missing keys, with the CEO-dependent ones folded into the root cause "no CEO". */
export function visibleMissing(missing) {
  const list = Array.isArray(missing) ? missing : []
  return list.includes('ceo') ? list.filter((k) => !CEO_DEPENDENT.includes(k)) : list
}

/** Where "fix this" leads: the company page, scrolled to the section that holds the item and with the item highlighted. A national ID or any personal value never enters the URL. */
export function fixPath(companyId, key, section) {
  const q = key ? `?focus=${encodeURIComponent(key)}` : ''
  return `/alumni/admin/company/${encodeURIComponent(companyId)}${q}${section ? `#${section}` : ''}`
}

// ------------------------------------------------------------------ the rules that count: a per-viewer convenience (browser storage, guarded)
const RULES_KEY = 'athar.alumniAdmin.attentionRules.v1'
function storageOf() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
/** The saved rule keys, or null (= every rule of the catalogue). Keys the catalogue no longer knows are dropped by the caller (`normalizeRules`). */
export function readRules(storage = storageOf()) {
  try {
    const raw = storage?.getItem(RULES_KEY)
    const v = raw ? JSON.parse(raw) : null
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null
  } catch {
    return null
  }
}
export function writeRules(keys, storage = storageOf()) {
  try {
    if (!keys) storage?.removeItem(RULES_KEY)
    else storage?.setItem(RULES_KEY, JSON.stringify(keys))
    return true
  } catch {
    return false
  }
}
/** A saved selection against the catalogue: unknown keys dropped; an empty result falls back to every rule (the server refuses an empty list). `catalog` = the rule keys in order. */
export function normalizeRules(saved, catalog) {
  const all = catalog ?? []
  if (!saved) return all
  const known = saved.filter((k) => all.includes(k))
  return known.length > 0 ? known : all
}

/** The rows of the queue export (one line per company): what is missing is a readable list, the CEO's contact is there for the follow-up (manager only; never an ID). */
export function attentionExportRows(rows, ctx) {
  return (rows ?? []).map((r) => ({
    company: ctx.pickName(r),
    alumni: r.is_alumni ? ctx.yes : ctx.no,
    completeness: r.completeness_percent,
    required: r.required_missing,
    recommended: r.recommended_missing,
    missing: (r.missing ?? []).map(ctx.ruleLabel).join('; '),
    ceo: r.ceo ? ctx.pickName(r.ceo) : '',
    email: r.ceo?.email ?? '',
    phone: r.ceo?.phone ?? '',
    account: r.has_account ? ctx.yes : ctx.no,
    invitation: r.pending_invitations > 0 ? ctx.yes : ctx.no,
    updated: r.last_update?.at ?? '',
    link: ctx.link(r.id),
  }))
}
