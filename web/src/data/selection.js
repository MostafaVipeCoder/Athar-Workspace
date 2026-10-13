import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { appBaseUrl } from '../lib/links.js'

/**
 * Selection node data (design 01 section 3.4, 02 section 7, 04 sections 3.5 / 5.8; migration m33). The applicants
 * themselves are read through the list resolver (`data/lists.js listItems`, the stage is a list with a pipeline
 * overlay); this module adds the stage-only facts in ONE call (`get_selection_extras`: decision reviews, per-reviewer
 * scores, outbox rows per applicant, participants of accepted items, the connected interview Booking node) and the
 * writes that are not list writes: scores and the e-mail send RPC. Delivery itself is the outbox worker (07).
 */
export async function getSelectionExtras(nodeId) {
  return unwrap(await db().rpc('get_selection_extras', { p_node: nodeId })) ?? {}
}

export async function setSelectionScore(itemId, { score = null, note = null } = {}) {
  unwrap(await db().rpc('set_selection_score', { p_item: itemId, p_score: score, p_note: note }))
}

/**
 * Enqueue one selection e-mail (acceptance | rejection | interview) for the given item ids. Recipients are derived
 * server-side from the item's source answers (never from the client). Returns [{ item_id, outbox_id, status, recipient }]
 * with status queued | already_sent | duplicate | no_recipient | item_not_found. `confirm` must be true above 100 ids.
 */
export async function sendSelectionEmails(nodeId, emailKey, itemIds, { lang = 'en', resend = false, confirm = false } = {}) {
  return unwrap(await db().rpc('send_selection_emails', {
    p_node: nodeId, p_email_key: emailKey, p_item_ids: itemIds, p_lang: lang, p_base_url: appBaseUrl(), p_resend: resend, p_confirm: confirm,
  })) ?? []
}

export const useSelectionExtras = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.selectionExtras(nodeId), queryFn: () => getSelectionExtras(nodeId), enabled: Boolean(nodeId), refetchOnWindowFocus: true, staleTime: 15_000, ...options })

/** Stage-only mutations; each success invalidates the node's cache (items + extras) and calls `onChanged` (graph refresh). */
export function useSelectionMutations(nodeId, { onChanged } = {}) {
  const qc = useQueryClient()
  const after = async () => {
    await qc.invalidateQueries({ queryKey: keys.node(nodeId) })
    await onChanged?.()
  }
  return {
    setScore: useMutation({ mutationFn: ({ itemId, score, note }) => setSelectionScore(itemId, { score, note }), onSuccess: after, meta: { silent: true } }),
    send: useMutation({ mutationFn: ({ emailKey, itemIds, lang, resend, confirm }) => sendSelectionEmails(nodeId, emailKey, itemIds, { lang, resend, confirm }), onSuccess: after, meta: { silent: true } }),
  }
}
