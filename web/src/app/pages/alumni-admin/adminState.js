/**
 * State of the manager directory (and the pages that share its filter): the filters, sort and page live in the URL (a view can be linked and survives a reload), the visible
 * columns and the saved views live in the viewer's browser (per-viewer conveniences only; every read / write is guarded because storage can be blocked).
 *
 * Filter keys are exactly the ones of `alumni_filter_ids` (m49 + m51's `education_status`). No national ID or any other personal number is a filter or ever enters a URL.
 */
import { normalizeColumns, DEFAULT_COLUMNS } from './columns.js'

export const SCOPES = Object.freeze(['alumni', 'candidates', 'all'])
export const SORT_KEYS = Object.freeze(['name', 'updated', 'created', 'established', 'completeness', 'age', 'employees', 'funding', 'revenue', 'sector', 'stage'])
export const PAGE_SIZES = Object.freeze([25, 50, 100])

/** type: s = string, i = integer, b = boolean (a tri-state: absent / true / false). */
export const FILTER_TYPES = Object.freeze({
  q: 's', scope: 's', program_id: 's', project_id: 's', sector: 's', subsector: 's', stage: 's', startup_type: 's', legal_status: 's', governorate: 'i', operating_status: 's',
  ceo_governorate: 'i', ceo_gender: 's', age_category: 's', education_status: 's', has_female_founder: 'b', reviewed: 'b', directory_visibility: 's', directory_hidden: 'b', incomplete: 'b',
})
export const FILTER_KEYS = Object.freeze(Object.keys(FILTER_TYPES))

export const DEFAULT_STATE = Object.freeze({ filters: { scope: 'alumni' }, sort: 'name', dir: 'asc', page: 1, size: 25, year: null })

const isEmpty = (v) => v === undefined || v === null || v === ''

/** Clean filters for the RPC: drop empties, coerce integers / booleans, keep only known keys. `scope` defaults to 'alumni'. */
export function toRpcFilters(filters) {
  const out = {}
  for (const k of FILTER_KEYS) {
    const v = filters?.[k]
    if (isEmpty(v)) continue
    const type = FILTER_TYPES[k]
    if (type === 'i') {
      const n = Number(v)
      if (Number.isInteger(n)) out[k] = n
    } else if (type === 'b') {
      if (v === true || v === 'true') out[k] = true
      else if (v === false || v === 'false') out[k] = false
    } else {
      const s = String(v).trim()
      if (s) out[k] = s
    }
  }
  if (!SCOPES.includes(out.scope)) out.scope = 'alumni'
  return out
}

/** How many filters are active (the search text and the scope are shown outside the filter panel and do not count). */
export function activeFilterCount(filters) {
  const f = toRpcFilters(filters)
  return Object.keys(f).filter((k) => k !== 'q' && k !== 'scope').length
}

const intOr = (v, fallback) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** URLSearchParams (or a query string) -> the table state. Unknown keys and bad values are ignored. */
export function parseState(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''))
  const raw = {}
  for (const k of FILTER_KEYS) if (p.has(k)) raw[k] = p.get(k)
  const filters = toRpcFilters(raw)
  const sort = SORT_KEYS.includes(p.get('sort')) ? p.get('sort') : DEFAULT_STATE.sort
  const dir = p.get('dir') === 'desc' ? 'desc' : 'asc'
  const size = PAGE_SIZES.includes(intOr(p.get('size'), 0)) ? intOr(p.get('size'), 0) : DEFAULT_STATE.size
  const year = intOr(p.get('year'), 0)
  return { filters, sort, dir, page: intOr(p.get('page'), 1), size, year: year >= 1990 && year <= 2100 ? year : null }
}

/** The table state -> a query string without the defaults (a clean URL for the default view). */
export function serializeState(state) {
  const p = new URLSearchParams()
  const f = toRpcFilters(state?.filters)
  for (const k of FILTER_KEYS) if (k in f && !(k === 'scope' && f[k] === 'alumni')) p.set(k, String(f[k]))
  if (state?.sort && state.sort !== DEFAULT_STATE.sort) p.set('sort', state.sort)
  if (state?.dir === 'desc') p.set('dir', 'desc')
  if (state?.page > 1) p.set('page', String(state.page))
  if (state?.size && state.size !== DEFAULT_STATE.size) p.set('size', String(state.size))
  if (state?.year) p.set('year', String(state.year))
  return p.toString()
}

const MANAGED = new Set([...FILTER_KEYS, 'sort', 'dir', 'page', 'size', 'year'])
/**
 * The query string after a state change: the managed keys come from `state`, every OTHER parameter of the current URL (`lang`, a deep-link flag ...) is kept as it is,
 * so changing a filter never drops the language the link was opened with.
 */
export function mergeSearch(current, state) {
  const next = new URLSearchParams(serializeState(state))
  const cur = current instanceof URLSearchParams ? current : new URLSearchParams(String(current ?? ''))
  for (const [k, v] of cur) if (!MANAGED.has(k)) next.set(k, v)
  return next
}

/** Clicking a sortable header: the same key flips the direction, a new key starts ascending. */
export function nextSort(current, key) {
  if (current?.sort === key) return { sort: key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { sort: key, dir: 'asc' }
}

export const pageCount = (total, size) => Math.max(1, Math.ceil((Number(total) || 0) / (Number(size) || DEFAULT_STATE.size)))
export const pageRange = (total, page, size) => {
  const t = Number(total) || 0
  if (t === 0) return { from: 0, to: 0 }
  const from = (page - 1) * size + 1
  return { from, to: Math.min(t, page * size) }
}

// ------------------------------------------------------------------ per-viewer preferences (localStorage, guarded)
const COLUMNS_KEY = 'athar.alumniAdmin.columns.v1'
const VIEWS_KEY = 'athar.alumniAdmin.views.v1'

function storageOf() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
function readJson(key, fallback, storage = storageOf()) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key, value, storage = storageOf()) {
  try {
    storage?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const readColumns = (storage) => normalizeColumns(readJson(COLUMNS_KEY, null, storage) ?? DEFAULT_COLUMNS)
export const writeColumns = (keys, storage) => writeJson(COLUMNS_KEY, normalizeColumns(keys), storage)

/** Saved views: `[{ id, name, filters, sort, dir, columns }]` (a name is unique, newest first, at most 20). */
export const readViews = (storage) => {
  const v = readJson(VIEWS_KEY, [], storage)
  return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string' && x.id) : []
}
export function saveView(view, storage) {
  const name = String(view?.name ?? '').trim().slice(0, 60)
  if (!name) return readViews(storage)
  const entry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, filters: toRpcFilters(view.filters), sort: view.sort, dir: view.dir, columns: normalizeColumns(view.columns) }
  const next = [entry, ...readViews(storage).filter((x) => x.name.toLowerCase() !== name.toLowerCase())].slice(0, 20)
  writeJson(VIEWS_KEY, next, storage)
  return next
}
export function deleteView(id, storage) {
  const next = readViews(storage).filter((x) => x.id !== id)
  writeJson(VIEWS_KEY, next, storage)
  return next
}
