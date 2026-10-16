import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { pollInterval } from '../lib/outbox.js'

/**
 * The e-mail Outbox (migration m62, design 07 section 1.6). Every call is an RPC of the database that re-checks the caller (a PM of the project; a
 * staff-invitation row and the health panel belong to super_admin): the client only renders. Delivery itself is the `email-worker` edge function
 * (scheduled by the database); the browser never sends mail and never sees a token, a body of somebody else's project or a secret.
 *
 *   list_email_outbox(p_project, p_states, p_node, p_search, p_limit, p_offset) -> { total, counts: { state: n }, rows: [...] }   (no body)
 *   get_email_outbox_item(p_id)         -> one row in full: subject, rendered body, timeline
 *   get_email_outbox_counts(p_project)  -> { counts, by_node: { node_id: { state: n } }, attention }
 *   email_outbox_retry / _cancel / _mark_sent / _resend (p_ids)  -> { requested, updated, skipped }
 *   email_outbox_send_now(p_project)    -> { released, queued, kicked }
 *   get_email_health()                  -> the super_admin panel;   list_staff_invitation_delivery() -> the state of every invitation e-mail
 */
const clampIds = (ids) => [...new Set((ids ?? []).filter(Boolean))].slice(0, 500)

export async function listOutbox(projectId, { states = null, nodeId = null, search = '', limit = 50, offset = 0 } = {}) {
  const out = unwrap(await db().rpc('list_email_outbox', {
    p_project: projectId,
    p_states: states && states.length ? states : null,
    p_node: nodeId ?? null,
    p_search: String(search ?? '').trim() || null,
    p_limit: limit,
    p_offset: offset,
  }))
  return { total: out?.total ?? 0, counts: out?.counts ?? {}, rows: out?.rows ?? [] }
}

export async function getOutboxItem(id) {
  return unwrap(await db().rpc('get_email_outbox_item', { p_id: id }))
}

export async function getOutboxCounts(projectId) {
  const out = unwrap(await db().rpc('get_email_outbox_counts', { p_project: projectId }))
  return { counts: out?.counts ?? {}, by_node: out?.by_node ?? {}, attention: out?.attention ?? 0 }
}

const action = (fn) => async (ids) => {
  const list = clampIds(ids)
  if (list.length === 0) return { requested: 0, updated: 0, skipped: 0 }
  return unwrap(await db().rpc(fn, { p_ids: list }))
}
export const retryEmails = action('email_outbox_retry')
export const cancelEmails = action('email_outbox_cancel')
export const markEmailsSent = action('email_outbox_mark_sent')
export const resendEmails = action('email_outbox_resend')

export async function sendNow(projectId) {
  return unwrap(await db().rpc('email_outbox_send_now', { p_project: projectId }))
}

export async function getEmailHealth() {
  return unwrap(await db().rpc('get_email_health'))
}

export async function listStaffInvitationDelivery() {
  return unwrap(await db().rpc('list_staff_invitation_delivery')) ?? []
}

// ------------------------------------------------------------------ hooks
/**
 * One page of the Outbox of a project (filters: states, node, search). Refreshes on focus and every 10 s while something is on its way (a hidden tab
 * pauses it; nothing polls when everything is final): no socket, one light RPC.
 */
export const useOutbox = (projectId, filter = {}, { enabled = true } = {}) =>
  useQuery({
    queryKey: keys.outbox(projectId, filter),
    queryFn: () => listOutbox(projectId, filter),
    enabled: enabled && Boolean(projectId),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => pollInterval(query.state.data?.counts),
  })

/** The badge numbers of a project (and of each node): failed + needs review + blocked ask for attention. */
export const useOutboxCounts = (projectId, { enabled = true } = {}) =>
  useQuery({
    queryKey: keys.outboxCounts(projectId),
    queryFn: () => getOutboxCounts(projectId),
    enabled: enabled && Boolean(projectId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => pollInterval(query.state.data?.counts),
  })

export const useOutboxItem = (id, { enabled = true } = {}) =>
  useQuery({ queryKey: keys.outboxItem(id), queryFn: () => getOutboxItem(id), enabled: enabled && Boolean(id), staleTime: 5_000 })

/** super_admin: the health of the whole queue; refreshes every 15 s while the tab is visible. */
export const useEmailHealth = ({ enabled = true } = {}) =>
  useQuery({ queryKey: keys.emailHealth(), queryFn: getEmailHealth, enabled, staleTime: 5_000, refetchOnWindowFocus: true, refetchInterval: 15_000 })

/** super_admin: the delivery state of each staff invitation e-mail (the invitations list shows it). */
export const useStaffInvitationDelivery = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: keys.staffInvitationDelivery(),
    queryFn: listStaffInvitationDelivery,
    enabled,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => ((query.state.data ?? []).some((d) => ['queued', 'blocked', 'sending'].includes(d.state)) ? 10_000 : false),
  })

/** The five actions; each refreshes every list / count of the project (`['outbox', projectId]`), the health panel and the staff delivery list. */
export function useOutboxMutations(projectId = null) {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: projectId ? ['outbox', projectId] : ['outbox'] })
    qc.invalidateQueries({ queryKey: ['outbox', 'item'] })
    qc.invalidateQueries({ queryKey: keys.emailHealth() })
    qc.invalidateQueries({ queryKey: keys.staffInvitationDelivery() })
  }
  const opts = { onSuccess: refresh }
  return {
    retry: useMutation({ mutationFn: ({ ids }) => retryEmails(ids), ...opts }),
    cancel: useMutation({ mutationFn: ({ ids }) => cancelEmails(ids), ...opts }),
    markSent: useMutation({ mutationFn: ({ ids }) => markEmailsSent(ids), ...opts }),
    resend: useMutation({ mutationFn: ({ ids }) => resendEmails(ids), ...opts }),
    sendNow: useMutation({ mutationFn: ({ project }) => sendNow(project ?? projectId), ...opts }),
  }
}
