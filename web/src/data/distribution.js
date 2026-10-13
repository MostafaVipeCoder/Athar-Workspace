import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { ensureItems } from './lists.js'

/**
 * Mentoring Distribution node data (design 01 section 3.7, 04 sections 3.10 / 3.17, 03 section 9.4; migration m35).
 * - Mentors and companies are REFERENCES to list items of the connected Lists; sessions point at list-item ids, names are resolved by
 *   the DB (`get_distribution_payload` for PMs, `get_distribution_view` / `get_public_tab` for visitors), never stored on a session.
 * - The configuration (settings, days, per-day mentors, mentor rules) is saved with `save_node` + `children` (one transaction, revision
 *   check). Sessions are written ONLY by RPCs that validate server-side: `replace_distribution_sessions` (a generation),
 *   `set_distribution_session_companies` (move / swap / clear, Undo = the inverse), `set_distribution_day_lock`, `set_distribution_published`.
 * - The shared countdown is stored as SERVER TIMESTAMPS (`distribution_timers`): visitors read it through `get_distribution_timer` (a few
 *   hundred bytes, polled lightly while the page is visible) and compute the remaining time locally; the ONLY writer is
 *   `distribution_timer_control`, callable by project managers only. There is no public control channel and no socket.
 */
export const DIST_VIEW_KEYS = ['matrix', 'live']

// ------------------------------------------------------------------ PM reads
export async function getDistributionPayload(nodeId) {
  return unwrap(await db().rpc('get_distribution_payload', { p_node: nodeId }))
}
export async function getDistributionRules(nodeId) {
  return unwrap(await db().from('distribution_mentor_rules').select('mentor_item_id, days, max_slots, available_from, available_to, room').eq('node_id', nodeId)) ?? []
}
export async function getTimerState(nodeId) {
  return unwrap(await db().rpc('get_distribution_timer_state', { p_node: nodeId }))
}

// ------------------------------------------------------------------ PM writes (the config goes through save_node children, see Edit/Setup)
/** One generation: rows = [{ day_id, slot_index, mentor_item_id, company_item_id, is_manual_override }]. scope 'all' | 'unlocked'. */
export async function replaceSessions(nodeId, { scope, days = null, rows, seed = null }) {
  return unwrap(await db().rpc('replace_distribution_sessions', { p_node: nodeId, p_scope: scope, p_days: days, p_sessions: rows, p_seed: seed }))
}
/** changes = [{ session_id, company_item_id|null, is_manual_override? }]. Returns { applied, warnings[] }. */
export async function setSessionCompanies(nodeId, changes) {
  return unwrap(await db().rpc('set_distribution_session_companies', { p_node: nodeId, p_changes: changes }))
}
export async function setDayLock(dayId, locked) {
  unwrap(await db().rpc('set_distribution_day_lock', { p_day: dayId, p_locked: locked }))
}
export async function setPublished(nodeId, published) {
  return unwrap(await db().rpc('set_distribution_published', { p_node: nodeId, p_published: published }))
}
/** action: set_round {day_id, slot_index, run?} | start | resume | pause | adjust {seconds} | reset | next {run?} | previous {run?} | clear. */
export async function timerControl(nodeId, action, args = {}) {
  return unwrap(await db().rpc('distribution_timer_control', { p_node: nodeId, p_action: action, p_args: args }))
}

/**
 * Real list-item ids for candidates (mentors / companies) that are still VIRTUAL (edge-fed, no overlay row yet): one `ensure_items` per
 * source list, in input order. Returns { [candidate.key]: itemId } for every candidate.
 */
export async function materializeCandidates(candidates) {
  const out = {}
  const byList = new Map()
  for (const c of candidates) {
    if (!c.virtual) {
      out[c.key] = c.key
      continue
    }
    const listId = c.item._from
    if (!byList.has(listId)) byList.set(listId, [])
    byList.get(listId).push(c)
  }
  for (const [listId, group] of byList) {
    const ids = await ensureItems(listId, group.map((c) => ({ kind: c.item.source.kind, id: c.item.source.id })))
    group.forEach((c, i) => { out[c.key] = ids[i] })
  }
  return out
}

// ------------------------------------------------------------------ links (kind 'view', view_key 'matrix' | 'live')
export async function getDistributionLinks(nodeId) {
  const rows = unwrap(await db().from('public_links').select('id, view_key, is_enabled').eq('node_id', nodeId).eq('kind', 'view').in('view_key', DIST_VIEW_KEYS)) ?? []
  const out = { matrix: null, live: null }
  for (const row of rows) {
    const slug = unwrap(await db().from('public_link_slugs').select('slug').eq('link_id', row.id).eq('is_current', true).maybeSingle())
    out[row.view_key] = { linkId: row.id, slug: slug?.slug ?? null, enabled: row.is_enabled }
  }
  return out
}
export async function ensureDistributionLink(nodeId, viewKey) {
  unwrap(await db().rpc('ensure_public_link', { p_node: nodeId, p_kind: 'view', p_view_key: viewKey, p_project: null }))
  return getDistributionLinks(nodeId)
}

// ------------------------------------------------------------------ public (anon or signed in; the DB decides the audience)
export async function getDistributionView(ref, viewKey) {
  return unwrap(await db().rpc('get_distribution_view', { p_ref: ref, p_view_key: viewKey }))
}
export async function getPublicTimer(ref) {
  return unwrap(await db().rpc('get_distribution_timer', { p_ref: ref }))
}

// ------------------------------------------------------------------ hooks
export const useDistributionPayload = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.distPayload(nodeId), queryFn: () => getDistributionPayload(nodeId), enabled: Boolean(nodeId), refetchOnWindowFocus: true, staleTime: 15_000, ...options })

export const useDistributionRules = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.distRules(nodeId), queryFn: () => getDistributionRules(nodeId), enabled: Boolean(nodeId), staleTime: 15_000, ...options })

export const useDistributionLinks = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.distLinks(nodeId), queryFn: () => getDistributionLinks(nodeId), enabled: Boolean(nodeId), ...options })

/** The PM's own timer read: polled lightly (3 s) only while the tab is visible. */
export const useTimerState = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.distTimer(nodeId), queryFn: () => getTimerState(nodeId), enabled: Boolean(nodeId), refetchInterval: 3000, refetchIntervalInBackground: false, staleTime: 0, ...options })

/** Public matrix / live payload: refetched on focus and when the timer poll reports a newer revision (see the live page). */
export const usePublicDistribution = (ref, viewKey, options = {}) =>
  useQuery({ queryKey: keys.publicDistribution(ref, viewKey), queryFn: () => getDistributionView(ref, viewKey), enabled: Boolean(ref), refetchOnWindowFocus: true, staleTime: 30_000, ...options })

/** The live view's poll: a tiny RPC every `interval` ms while the page is visible (no socket). */
export const usePublicTimer = (ref, { interval = 5000, enabled = true } = {}) =>
  useQuery({ queryKey: keys.publicDistTimer(ref), queryFn: async () => ({ ...(await getPublicTimer(ref)), receivedAt: Date.now() }), enabled: Boolean(ref) && enabled, refetchInterval: interval, refetchIntervalInBackground: false, staleTime: 0 })

/** Every success invalidates the node's cache (payload, rules, outputs) and calls `onChanged` (graph refresh). */
export function useDistributionMutations(nodeId, { onChanged } = {}) {
  const qc = useQueryClient()
  const after = async () => {
    await qc.invalidateQueries({ queryKey: keys.node(nodeId) })
    await onChanged?.()
  }
  const useM = (mutationFn, { refresh = true } = {}) => useMutation({ mutationFn, onSuccess: refresh ? after : undefined, meta: { silent: true } })
  const m = useM
  return {
    replaceSessions: m((args) => replaceSessions(nodeId, args)),
    setCompanies: m((changes) => setSessionCompanies(nodeId, changes)),
    setLock: m(({ dayId, locked }) => setDayLock(dayId, locked)),
    setPublished: m((published) => setPublished(nodeId, published)),
    timer: m(({ action, args }) => timerControl(nodeId, action, args), { refresh: false }),
    ensureLink: useMutation({ mutationFn: (viewKey) => ensureDistributionLink(nodeId, viewKey), onSuccess: () => qc.invalidateQueries({ queryKey: keys.distLinks(nodeId) }), meta: { silent: true } }),
  }
}
