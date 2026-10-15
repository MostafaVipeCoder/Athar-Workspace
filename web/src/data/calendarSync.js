import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'

/**
 * Calendar / Meet sync (design 07 section 2, migration m63). The browser never talks to Google and never sees a token: it reads the sync STATE the database
 * derives (`get_calendar_sync_overview`: one entry per booking), the platform-wide mode flag (`get_calendar_sync_mode`: off | shadow | live) and lets a
 * super_admin switch it. The state of one booking is one of
 *   pending | syncing | retrying | synced | migrated | shadow | off | needs_connection | failed | cancelled | past | none
 * with a short machine CODE for the last problem (the screens translate it; no message, no address ever comes from the server).
 */

/** { mode, can_set_mode, last_run_at, now, bookings: [{ booking_id, state, code, job, event_id, migrated, synced_at, calendar_email, plan }] } (a project member) */
export async function getCalendarSyncOverview(nodeId) {
  return unwrap(await db().rpc('get_calendar_sync_overview', { p_node: nodeId })) ?? null
}

/** { mode, can_set, last_run_at } (any staff account) */
export async function getCalendarSyncMode() {
  return unwrap(await db().rpc('get_calendar_sync_mode')) ?? null
}

/** super_admin only. -> { mode, previous, in_flight } (in_flight = jobs somebody is working on right now: switch to live when it is 0) */
export async function setCalendarSyncMode(mode) {
  return unwrap(await db().rpc('set_calendar_sync_mode', { p_mode: mode }))
}

/** States that change by themselves: the Bookings tab refreshes lightly while one of them is on screen (visibility-gated by TanStack Query, no socket). */
export const ACTIVE_SYNC_STATES = Object.freeze(['pending', 'syncing', 'retrying'])
export const hasActiveSync = (overview) => Boolean(overview?.bookings?.some((b) => ACTIVE_SYNC_STATES.includes(b.state)))

export const useCalendarSyncOverview = (nodeId, options = {}) =>
  useQuery({
    queryKey: keys.calendarSync(nodeId),
    queryFn: () => getCalendarSyncOverview(nodeId),
    enabled: Boolean(nodeId),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (hasActiveSync(query.state.data) && query.state.data?.mode === 'live' ? 15_000 : false),
    ...options,
  })

export const useCalendarSyncMode = ({ enabled = true } = {}) =>
  useQuery({ queryKey: keys.calendarSyncMode(), queryFn: getCalendarSyncMode, enabled, staleTime: 30_000, refetchOnWindowFocus: true })

/** After a switch every Bookings tab must read the new mode: the mode key AND every node's overview are refreshed. */
export function useCalendarSyncModeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mode) => setCalendarSyncMode(mode),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.calendarSyncMode() })
      await qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'node' && q.queryKey[2] === 'calendarSync' })
    },
    meta: { silent: true },
  })
}
