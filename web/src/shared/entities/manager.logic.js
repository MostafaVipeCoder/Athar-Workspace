import { biPick, entityMatches } from '../../lib/entities.js'

/** Source filter values offered by the manager. */
export const SOURCE_FILTERS = ['form_response', 'network_expert', 'company', 'manual']
export const SORTS = ['manual', 'title', 'status', 'newest']

export const DEFAULT_MANAGER_STATE = { term: '', status: '', source: '', showHidden: false, sort: 'manual', view: 'table' }

/** Pure filter used by EntityManager: search (both languages + e-mail), status, source kind, hidden items. */
export function filterItems(items, { term = '', status = '', source = '', showHidden = false } = {}) {
  return (items ?? []).filter((it) => {
    if (!showHidden && it.excluded) return false
    if (status === '__none' ? it.status : status && it.status !== status) return false
    if (source && it.source.kind !== source) return false
    if (term && !entityMatches(it.entity, term) && !String(it.overlay?.notes ?? '').toLowerCase().includes(term.toLowerCase())) return false
    return true
  })
}

/** Pure sort. 'manual' keeps the resolver order (sort_order, then key); others are stable client-side sorts. */
export function sortItems(items, sort = 'manual', lang = 'en', statusOrder = []) {
  const list = [...(items ?? [])]
  if (sort === 'title') {
    const collator = new Intl.Collator(lang === 'ar' ? 'ar' : 'en', { sensitivity: 'base' })
    list.sort((a, b) => collator.compare(biPick(a.entity.title, lang), biPick(b.entity.title, lang)))
  } else if (sort === 'status') {
    const rank = (s) => {
      const i = statusOrder.indexOf(s)
      return i === -1 ? statusOrder.length : i
    }
    list.sort((a, b) => rank(a.status) - rank(b.status))
  } else if (sort === 'newest') {
    list.reverse()
  }
  return list
}

/** True when the visible list equals the full list in the resolver order (reordering a filtered subset is forbidden: docs/03 7.3). */
export function canReorder(state) {
  return state.sort === 'manual' && !state.term && !state.status && !state.source
}

/** Move an element and return a new array (used by up/down buttons and drag-and-drop). */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [el] = next.splice(from, 1)
  next.splice(to, 0, el)
  return next
}
