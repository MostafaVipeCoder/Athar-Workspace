/**
 * The founder's notifications (design 09 F7): direct table access under RLS (a founder reads and marks read only his own; m50: only `is_read` can change).
 * A module of its own because the founder SHELL imports it for the unread badge: it must stay tiny (no image, no certificate code).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { fromSupabase, unwrap } from './errors.js'

export const notificationKeys = {
  list: (params = {}) => ['alumniFounder', 'notifications', params],
  unread: () => ['alumniFounder', 'unread'],
}

const COLUMNS = 'id, title, body, is_read, created_at, audience_type, metadata'

/** Newest first. `unreadOnly` filters on the server; `limit` rows (+1 is fetched to know whether there are more). -> `{ rows, hasMore }`. */
export async function listMyNotifications({ unreadOnly = false, limit = 30 } = {}) {
  let q = db().from('notifications').select(COLUMNS).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
  if (unreadOnly) q = q.eq('is_read', false)
  const rows = unwrap(await q) ?? []
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit }
}

/** The unread badge: a HEAD request with an exact count (no rows travel). */
export async function countMyUnreadNotifications() {
  const { count, error } = await db().from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false)
  if (error) throw fromSupabase(error)
  return count ?? 0
}

export async function setNotificationRead(id, read = true) {
  unwrap(await db().from('notifications').update({ is_read: read }).eq('id', id))
}

/** One statement over the caller's own unread rows (RLS keeps everybody else's untouched). */
export async function markAllNotificationsRead() {
  unwrap(await db().from('notifications').update({ is_read: true }).eq('is_read', false))
}

/** The unread count for the shell badge: refreshed on focus and once a minute while the tab is visible (no socket, goal G2). A failure is silent (no badge). */
export const useUnreadNotifications = (options = {}) =>
  useQuery({ queryKey: notificationKeys.unread(), queryFn: countMyUnreadNotifications, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true, meta: { silent: true }, ...options })

export const useMyNotifications = (params = {}, options = {}) =>
  useQuery({ queryKey: notificationKeys.list(params), queryFn: () => listMyNotifications(params), staleTime: 15_000, placeholderData: keepPreviousData, refetchOnWindowFocus: true, ...options })

export function useNotificationMutations() {
  const qc = useQueryClient()
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['alumniFounder', 'notifications'] }),
    qc.invalidateQueries({ queryKey: notificationKeys.unread() }),
  ])
  return {
    setRead: useMutation({ mutationFn: ({ id, read }) => setNotificationRead(id, read), onSuccess: refresh, meta: { silent: true } }),
    markAll: useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh, meta: { silent: true } }),
  }
}
