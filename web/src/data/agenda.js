import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'
import { updateEdge } from './canvas.js'
import { updateProject } from './programs.js'
import { getPublicTab } from './lists.js'

/**
 * Dynamic Agenda node data (design 01 section 3.1, 02 section 4, 04 sections 3.11 + 5.5):
 * - the PM reads days/slots under RLS (raw rows) and writes them ONLY through save_node children
 *   (`app_private.save_children_agenda`, one transaction with the config: useNodeConfig().save(extraPatch, { children }));
 * - the public view page reads `get_agenda_view(ref)` (host + tabs + project) and one `get_public_tab(ref, edge)` per tab,
 *   both anon-callable and audience-decided by the DB (m06d/m30/m32);
 * - links: the node's own page (kind 'agenda' on the node) and the implicit project page (kind 'project', no node; the
 *   migrated projects carry a kind 'agenda' link on their view_host instead);
 * - founder exposure: `list_founder_agendas(project)` (m32).
 */
export const AGENDA_LINK_KIND = 'agenda'

// ------------------------------------------------------------------ PM reads
export async function getAgendaDefinition(nodeId) {
  const days = unwrap(await db().from('agenda_days').select('id, sort_order, day_date, name_en, name_ar').eq('node_id', nodeId).order('sort_order')) ?? []
  if (!days.length) return { days: [] }
  const slots = unwrap(await db().from('agenda_slots').select('id, day_id, sort_order, start_time, end_time, title_en, title_ar, presenter_en, presenter_ar, presenter_item_id, show_presenter, bullets').in('day_id', days.map((d) => d.id)).order('sort_order').order('start_time')) ?? []
  const byDay = new Map(days.map((d) => [d.id, []]))
  for (const s of slots) byDay.get(s.day_id)?.push(s)
  return { days: days.map((d) => ({ ...d, slots: byDay.get(d.id) ?? [] })) }
}

async function slugOf(linkId) {
  const slug = unwrap(await db().from('public_link_slugs').select('slug').eq('link_id', linkId).eq('is_current', true).maybeSingle())
  return slug?.slug ?? null
}
/** The node's own public page link (kind 'agenda', no view key). */
export async function getAgendaLink(nodeId) {
  const link = unwrap(await db().from('public_links').select('id, is_enabled').eq('node_id', nodeId).eq('kind', AGENDA_LINK_KIND).is('view_key', null).maybeSingle())
  if (!link) return null
  return { linkId: link.id, slug: await slugOf(link.id), enabled: link.is_enabled }
}
export async function ensureAgendaLink(nodeId) {
  unwrap(await db().rpc('ensure_public_link', { p_node: nodeId, p_kind: AGENDA_LINK_KIND, p_view_key: null, p_project: null }))
  return getAgendaLink(nodeId)
}
/**
 * The project page link: kind 'project' with no node (new projects) or the migrated kind 'agenda' link on the view_host.
 * `hostId` = the view_host node id (from the graph) so the migrated shape is found too.
 */
export async function getProjectPageLink(projectId, hostId = null) {
  const rows = unwrap(await db().from('public_links').select('id, kind, node_id, is_enabled').eq('project_id', projectId).in('kind', ['project', 'agenda'])) ?? []
  const link = rows.find((l) => l.kind === 'project' && !l.node_id) ?? rows.find((l) => l.kind === 'agenda' && hostId && l.node_id === hostId) ?? null
  if (!link) return null
  return { linkId: link.id, slug: await slugOf(link.id), enabled: link.is_enabled, kind: link.kind }
}
export async function ensureProjectPageLink(projectId, hostId = null) {
  const existing = await getProjectPageLink(projectId, hostId)
  if (existing) return existing
  unwrap(await db().rpc('ensure_public_link', { p_node: null, p_kind: 'project', p_view_key: null, p_project: projectId }))
  return getProjectPageLink(projectId, hostId)
}

/** Tab bar edits (label override, order, enabled, audience) are edge rows: one update_edge per changed edge (RPC re-checks the PM). */
export async function updateTabEdges(patches) {
  for (const { edgeId, patch } of patches) await updateEdge(edgeId, patch)
}

/** The agenda cover IS the project cover (08 decision 01-2). */
export async function setProjectCover(projectId, coverPath) {
  return updateProject(projectId, { cover_path: coverPath })
}

// ------------------------------------------------------------------ public / founder reads (the DB decides the audience)
export async function getAgendaView(ref) {
  return unwrap(await db().rpc('get_agenda_view', { p_ref: ref }))
}
export { getPublicTab }
export async function listFounderAgendas(projectId) {
  return unwrap(await db().rpc('list_founder_agendas', { p_project: projectId })) ?? []
}

// ------------------------------------------------------------------ hooks
export const useAgendaDefinition = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.agendaDef(nodeId), queryFn: () => getAgendaDefinition(nodeId), enabled: Boolean(nodeId), ...options })

export const useAgendaLink = (nodeId, options = {}) =>
  useQuery({ queryKey: keys.agendaLink(nodeId), queryFn: () => getAgendaLink(nodeId), enabled: Boolean(nodeId), ...options })

export const useProjectPageLink = (projectId, hostId, options = {}) =>
  useQuery({ queryKey: [...keys.projectLink(projectId), hostId ?? null], queryFn: () => getProjectPageLink(projectId, hostId), enabled: Boolean(projectId), ...options })

/** The host page: refetched on focus and every minute while visible (the as-is viewer polled every 30 s; 02 decision 02-5). */
export const useAgendaView = (ref, options = {}) =>
  useQuery({ queryKey: keys.agendaView(ref), queryFn: () => getAgendaView(ref), enabled: Boolean(ref), refetchOnWindowFocus: true, staleTime: 30_000, refetchInterval: 60_000, ...options })

export const useFounderAgendas = (projectId, options = {}) =>
  useQuery({ queryKey: keys.founderAgendas(projectId), queryFn: () => listFounderAgendas(projectId), enabled: Boolean(projectId), ...options })

export function useAgendaMutations(nodeId, projectId, { onChanged } = {}) {
  const qc = useQueryClient()
  return {
    ensureLink: useMutation({ mutationFn: () => ensureAgendaLink(nodeId), onSuccess: () => qc.invalidateQueries({ queryKey: keys.agendaLink(nodeId) }), meta: { silent: true } }),
    ensureProjectLink: useMutation({ mutationFn: ({ hostId }) => ensureProjectPageLink(projectId, hostId), onSuccess: () => qc.invalidateQueries({ queryKey: keys.projectLink(projectId) }), meta: { silent: true } }),
    updateTabs: useMutation({
      mutationFn: ({ patches }) => updateTabEdges(patches),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: keys.graph(projectId) })
        await onChanged?.()
      },
      meta: { silent: true },
    }),
    setCover: useMutation({
      mutationFn: ({ coverPath }) => setProjectCover(projectId, coverPath),
      onSuccess: async () => {
        await Promise.all([qc.invalidateQueries({ queryKey: keys.graph(projectId) }), qc.invalidateQueries({ queryKey: keys.project(projectId) })])
      },
      meta: { silent: true },
    }),
  }
}
