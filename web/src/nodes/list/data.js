import { getListMeta, listItems } from '../../data/lists.js'

/**
 * Output-port resolver of `items` (design 06 section 4.4): what a consumer node (Distribution, Booking, another
 * List...) receives through useInputPort. Items are ListItemView objects (lib/entities.js normalizeListItem): references
 * + overlay, never copies. Virtual items (no overlay row yet) carry `itemId: null`; a consumer that must POINT at an
 * item calls data/lists `materializeItem(listId, item)` (= ensure_item) first.
 * Excluded ("hidden") items are omitted; `missing` ones are included and must be treated as inactive (02 section 3.6).
 */
export async function resolveItems({ node }) {
  const { subkind } = await getListMeta(node.id)
  const items = await listItems(node.id, { kind: subkind })
  return { items, kind: subkind }
}
