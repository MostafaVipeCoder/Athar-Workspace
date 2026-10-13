import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { normalizeListItem } from '../lib/entities.js'

/**
 * List node data (design 02 section 3, 04 section 5.3): membership is virtual, an overlay row exists only after
 * ensure_item; the ONE resolver `resolve_list` returns reference + overlay rows for PMs; `get_public_tab` /
 * `get_public_list` (m30) return the whitelisted public payload. Every write here is an immediate row-level save
 * (02 section 6: overlay edits are not drafts) and bumps the list revision in the DB.
 */
const PAGE = 200

export async function getListMeta(nodeId) {
  const row = unwrap(await db().from('lists').select('node_id, subkind').eq('node_id', nodeId).maybeSingle())
  return { subkind: row?.subkind ?? 'generic' }
}

/** One page of resolve_list (raw rows). filter: { include_excluded, status, with_fields }. */
export async function resolveList(nodeId, { filter = {}, limit = PAGE, after = null } = {}) {
  return unwrap(await db().rpc('resolve_list', { p_list: nodeId, p_filter: filter, p_limit: limit, p_after: after })) ?? []
}

/** All items of a list (follows the keyset cursor), normalised. `kind` = the list subkind for the entity shape. */
export async function listItems(nodeId, { filter = {}, kind = 'generic' } = {}) {
  const out = []
  let after = null
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await resolveList(nodeId, { filter, limit: PAGE, after })
    out.push(...page)
    if (page.length < PAGE) break
    after = page[page.length - 1]?.cursor ?? null
    if (!after) break
  }
  return out.map((r) => normalizeListItem(r, kind))
}

// ------------------------------------------------------------------ writes (RPCs of m06c + m30; each re-checks the PM)
export async function ensureItem(listId, kind, sourceId) {
  return unwrap(await db().rpc('ensure_item', { p_list: listId, p_kind: kind, p_source: sourceId }))
}
export async function ensureItems(listId, sources) {
  return unwrap(await db().rpc('ensure_items', { p_list: listId, p_sources: sources })) ?? []
}
/** Returns the DB id of an item, creating the overlay row lazily for virtual (edge-fed) items. */
export async function materializeItem(listId, item) {
  if (item.itemId) return item.itemId
  return ensureItem(listId, item.source.kind, item.source.id)
}
export async function patchItemOverlay(itemId, patch) {
  unwrap(await db().rpc('patch_item_overlay', { p_item: itemId, p_patch: patch }))
}
export async function setItemStatus(itemId, status, reason = null) {
  unwrap(await db().rpc('set_item_status', { p_item: itemId, p_status: status, p_reason: reason }))
}
export async function reorderItems(listId, ids) {
  unwrap(await db().rpc('reorder_items', { p_list: listId, p_ids: ids }))
}
export async function excludeItem(itemId, excluded = true) {
  unwrap(await db().rpc('exclude_item', { p_item: itemId, p_excluded: excluded }))
}
export async function addManualItem(listId, fields) {
  return unwrap(await db().rpc('add_manual_item', { p_list: listId, p_fields: fields }))
}
export async function updateManualItem(itemId, fields) {
  unwrap(await db().rpc('update_manual_item', { p_item: itemId, p_fields: fields }))
}
export async function deleteListItem(itemId) {
  unwrap(await db().rpc('delete_list_item', { p_item: itemId }))
}
export async function addNetworkPick(listId, expertId) {
  return unwrap(await db().rpc('add_network_pick', { p_list: listId, p_expert: expertId }))
}
export async function addCompanyPick(listId, companyId) {
  return unwrap(await db().rpc('add_company_pick', { p_list: listId, p_company: companyId }))
}
export async function detachItemToManual(itemId) {
  unwrap(await db().rpc('detach_item_to_manual', { p_item: itemId }))
}

// ------------------------------------------------------------------ public payloads (anon or signed in; the DB decides the audience)
export async function getPublicList(ref, after = null) {
  return unwrap(await db().rpc('get_public_list', { p_ref: ref, p_after: after }))
}
export async function getPublicTab(ref, edgeId, after = null) {
  return unwrap(await db().rpc('get_public_tab', { p_ref: ref, p_edge: edgeId ?? null, p_after: after }))
}

// ------------------------------------------------------------------ public link of the list's own view page (kind 'view', view_key 'list-tab')
export const LIST_VIEW_KEY = 'list-tab'

export async function getViewLink(nodeId) {
  const link = unwrap(await db().from('public_links').select('id, is_enabled').eq('node_id', nodeId).eq('kind', 'view').eq('view_key', LIST_VIEW_KEY).maybeSingle())
  if (!link) return null
  const slug = unwrap(await db().from('public_link_slugs').select('slug').eq('link_id', link.id).eq('is_current', true).maybeSingle())
  return { linkId: link.id, slug: slug?.slug ?? null, enabled: link.is_enabled }
}
export async function ensureViewLink(nodeId) {
  unwrap(await db().rpc('ensure_public_link', { p_node: nodeId, p_kind: 'view', p_view_key: LIST_VIEW_KEY, p_project: null }))
  return getViewLink(nodeId)
}

// ------------------------------------------------------------------ hooks
export const useListMeta = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.listMeta(nodeId), queryFn: () => getListMeta(nodeId), enabled: Boolean(nodeId), staleTime: 5 * 60_000, ...options })

export const useListItems = (nodeId, { filter = {}, kind = 'generic' } = {}, options = {}) =>
  useQuery({ queryKey: keys.listItems(nodeId, filter), queryFn: () => listItems(nodeId, { filter, kind }), enabled: Boolean(nodeId), ...options })

export const useViewLink = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.viewLink(nodeId), queryFn: () => getViewLink(nodeId), enabled: Boolean(nodeId), ...options })

export const usePublicList = (ref, options = {}) =>
  useQuery({ queryKey: keys.publicList(ref), queryFn: () => getPublicList(ref), enabled: Boolean(ref), refetchOnWindowFocus: true, staleTime: 30_000, ...options })

export const usePublicTab = (ref, edgeId, options = {}) =>
  useQuery({ queryKey: keys.publicTab(ref, edgeId), queryFn: () => getPublicTab(ref, edgeId), enabled: Boolean(ref), refetchOnWindowFocus: true, staleTime: 30_000, ...options })

/**
 * Item mutations of one list. Each success invalidates everything cached under the node (items, outputs) so the Edit
 * page, the View page and downstream consumers mounted in this session re-render; `onChanged` lets the caller add the
 * saved-state refresh of the graph (invalidateNodeOutputs). Virtual items are materialised first where the RPC needs a row.
 */
export function useListMutations(nodeId, { onChanged } = {}) {
  const qc = useQueryClient()
  const after = async () => {
    await qc.invalidateQueries({ queryKey: keys.node(nodeId) })
    await onChanged?.()
  }
  // a tiny custom hook (constant call count) so the rules-of-hooks lint is satisfied
  const useM = (mutationFn) => useMutation({ mutationFn, onSuccess: after, meta: { silent: true } })
  const m = useM
  return {
    patchOverlay: m(async ({ item, patch }) => patchItemOverlay(await materializeItem(nodeId, item), patch)),
    /** `reason` is stored by the DB for selection stages only (selection_reviews); lists ignore it. */
    setStatus: m(async ({ item, status, reason = null }) => setItemStatus(await materializeItem(nodeId, item), status, reason)),
    exclude: m(async ({ item, excluded }) => excludeItem(await materializeItem(nodeId, item), excluded)),
    /** `items` = the FULL ordered list (every item, filtered views must not reorder: docs/03 section 7.3). */
    reorder: m(async ({ items }) => {
      const virtual = items.filter((i) => !i.itemId)
      const ids = new Map()
      if (virtual.length) {
        const created = await ensureItems(nodeId, virtual.map((i) => ({ kind: i.source.kind, id: i.source.id })))
        virtual.forEach((i, idx) => ids.set(i.id, created[idx]))
      }
      await reorderItems(nodeId, items.map((i) => i.itemId ?? ids.get(i.id)))
    }),
    addManual: m(({ fields }) => addManualItem(nodeId, fields)),
    updateManual: m(({ item, fields }) => updateManualItem(item.itemId, fields)),
    remove: m(({ item }) => deleteListItem(item.itemId)),
    addNetworkPick: m(({ expertId }) => addNetworkPick(nodeId, expertId)),
    addCompanyPick: m(({ companyId }) => addCompanyPick(nodeId, companyId)),
    detach: m(async ({ item }) => detachItemToManual(await materializeItem(nodeId, item))),
    bulkStatus: m(async ({ items, status, reason = null }) => {
      for (const item of items) await setItemStatus(await materializeItem(nodeId, item), status, reason)
    }),
    bulkExclude: m(async ({ items, excluded }) => {
      for (const item of items) await excludeItem(await materializeItem(nodeId, item), excluded)
    }),
    ensureViewLink: useMutation({ mutationFn: () => ensureViewLink(nodeId), onSuccess: () => qc.invalidateQueries({ queryKey: keys.viewLink(nodeId) }), meta: { silent: true } }),
  }
}
