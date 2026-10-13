import { lazy } from 'react'
import { registry } from '../../../nodes/registry.js'

/**
 * The generic tab registry of the view page (design 02 section 4.4): a tab of get_agenda_view is { type, view_key }
 * and its component is the SOURCE node type's `manifest.contributesViews[key].component` (a lazy default export that
 * never fetches; the host hands it the get_public_tab payload). Memoised per (type, view_key) so the lazy identity is
 * stable across renders. A type whose view is still the placeholder (Library, Landing, Distribution...) returns null
 * and the host shows "not available yet" - no code change here when those nodes ship their views.
 */
const cache = new Map()

export function tabViewComponent(type, viewKey) {
  const id = `${type}:${viewKey}`
  if (cache.has(id)) return cache.get(id)
  const view = registry.get(type)?.contributesViews?.find((v) => v.key === viewKey) ?? null
  const isPlaceholder = !view || String(view.component).includes('PlaceholderMode')
  const Comp = isPlaceholder ? null : lazy(view.component)
  cache.set(id, Comp)
  return Comp
}

/** Payloads whose `data.items` + `data.next` follow the list contract get host-side pagination. */
export const PUBLIC_PAGE_SIZE = 100
export const isPaginated = (payload) => Array.isArray(payload?.data?.items) && 'next' in (payload?.data ?? {})
