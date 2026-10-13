import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'

/** Whole graph of a project (nodes without config, edges, revisions). PM only (RPC enforces). */
export async function getProjectGraph(projectId) {
  return unwrap(await db().rpc('get_project_graph', { p_project: projectId }))
}

/** One node including config and its current rev. */
export async function getNode(nodeId) {
  return unwrap(await db().rpc('get_node', { p_node: nodeId }))
}

/** Cheap revision poll: own rev plus a hash of all upstream revisions (eff_rev). PM or participant. */
export async function getGraphRevisions(projectId) {
  return unwrap(await db().rpc('get_graph_revisions', { p_project: projectId })) ?? []
}

/** Explicit save with optimistic-concurrency token. Returns { rev }. */
export async function saveNode(nodeId, expectedRev, patch, { children = null, force = false } = {}) {
  return unwrap(
    await db().rpc('save_node', { p_node: nodeId, p_expected_rev: expectedRev, p_patch: patch, p_children: children, p_force: force }),
  )
}

// ------------------------------------------------------------------ canvas mutations (RPCs of m06b; every one re-checks the PM server-side)
/** Creates a node; the RPC applies the type's default name when `name` is empty and creates the extension row. */
export async function addNode(projectId, type, { name = {}, x = 0, y = 0, options = {} } = {}) {
  return unwrap(await db().rpc('add_node', { p_project: projectId, p_type: type, p_name: name, p_x: x, p_y: y, p_options: options }))
}

/** Layout only: `positions` = [{ id, x, y }]. Never bumps a revision (04 3.4). */
export async function moveNodes(projectId, positions) {
  unwrap(await db().rpc('move_nodes', { p_project: projectId, p_positions: positions }))
}

/** Soft delete (tombstone, 04 3.4). Returns the impact { node_id, edges, public_links, dependents[] }. */
export async function deleteNode(nodeId) {
  return unwrap(await db().rpc('delete_node', { p_node: nodeId }))
}

/** Undo of deleteNode: clears the tombstone; the node's edges come back with it. */
export async function restoreNode(nodeId) {
  unwrap(await db().rpc('restore_node', { p_node: nodeId }))
}

/** Creates an edge; the DB trigger validates ports, family, kind, cardinality and the DAG per family (02 2.5). */
export async function connectNodes(projectId, { from, fromPort, to, toPort, config = {} }) {
  return unwrap(
    await db().rpc('connect', { p_project: projectId, p_from_node: from, p_from_port: fromPort, p_to_node: to, p_to_port: toPort, p_config: config }),
  )
}

/** Patch: { is_enabled, audience, label_en, label_ar, order_index, filter }. */
export async function updateEdge(edgeId, patch) {
  return unwrap(await db().rpc('update_edge', { p_edge: edgeId, p_patch: patch }))
}

export async function disconnectEdge(edgeId) {
  unwrap(await db().rpc('disconnect', { p_edge: edgeId }))
}

/** Rename through save_node (bumps the revision; optimistic-concurrency token from the graph's revisions). */
export async function renameNode(nodeId, expectedRev, { name_en, name_ar }) {
  return saveNode(nodeId, expectedRev, { name_en: name_en ?? null, name_ar: name_ar ?? null })
}

/** Duplicate = add_node of the same type (+ the extension options the RPC accepts) then copy the config through save_node. */
export async function duplicateNode(projectId, nodeId, { name, x, y }) {
  const src = await getNode(nodeId)
  const options = {}
  if (src.type === 'list') {
    const { data } = await db().from('lists').select('subkind').eq('node_id', nodeId).maybeSingle()
    if (data?.subkind) options.subkind = data.subkind
  } else if (src.type === 'booking') {
    const { data } = await db().from('booking_settings').select('mode').eq('node_id', nodeId).maybeSingle()
    if (data?.mode) options.mode = data.mode
  }
  const copy = await addNode(projectId, src.type, { name, x, y, options })
  const config = src.config ?? {}
  if (Object.keys(config).length > 0 || src.visibility !== 'private' || src.show_to_participants) {
    const fresh = await getNode(copy.id) // the extension-row insert may already have bumped the new node's revision
    await saveNode(copy.id, fresh.rev, { config, visibility: src.visibility, show_to_participants: src.show_to_participants })
  }
  return copy
}

/**
 * Canvas mutations with cache maintenance: every success refetches the project graph (prefix ['graph', projectId], which
 * also covers the revision poll); moves are optimistic (positions never change a revision). `meta.silent` because the
 * canvas shows its own errors (toast + inspector status) instead of the global reporter.
 */
export function useCanvasMutations(projectId) {
  const qc = useQueryClient()
  const key = ['canvas', projectId]
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.graph(projectId) })
  const common = { mutationKey: key, onSuccess: invalidate, meta: { silent: true } }
  return {
    addNode: useMutation({ ...common, mutationFn: ({ type, ...rest }) => addNode(projectId, type, rest) }),
    moveNodes: useMutation({
      mutationKey: key,
      meta: { silent: true },
      mutationFn: (positions) => moveNodes(projectId, positions),
      onMutate: (positions) => {
        const byId = new Map(positions.map((p) => [p.id, p]))
        qc.setQueryData(keys.graph(projectId), (g) =>
          g ? { ...g, nodes: g.nodes.map((n) => (byId.has(n.id) ? { ...n, position_x: byId.get(n.id).x, position_y: byId.get(n.id).y } : n)) } : g,
        )
      },
      onError: invalidate,
    }),
    deleteNode: useMutation({ ...common, mutationFn: ({ nodeId }) => deleteNode(nodeId), onError: invalidate }),
    restoreNode: useMutation({ ...common, mutationFn: ({ nodeId }) => restoreNode(nodeId) }),
    connect: useMutation({ ...common, mutationFn: (conn) => connectNodes(projectId, conn) }),
    updateEdge: useMutation({ ...common, mutationFn: ({ edgeId, patch }) => updateEdge(edgeId, patch) }),
    disconnect: useMutation({ ...common, mutationFn: ({ edgeId }) => disconnectEdge(edgeId), onError: invalidate }),
    rename: useMutation({ ...common, mutationFn: ({ nodeId, expectedRev, name_en, name_ar }) => renameNode(nodeId, expectedRev, { name_en, name_ar }) }),
    duplicate: useMutation({ ...common, mutationFn: ({ nodeId, ...rest }) => duplicateNode(projectId, nodeId, rest) }),
  }
}

export async function listNodeTypes() {
  return unwrap(await db().from('node_types').select('key, name_en, name_ar, category, latest_version, is_singleton, is_system, ports'))
}

export const useProjectGraph = (projectId) =>
  useQuery({ queryKey: keys.graph(projectId), queryFn: () => getProjectGraph(projectId), enabled: Boolean(projectId) })

export const useNodeRow = (nodeId) =>
  useQuery({ queryKey: keys.nodeRow(nodeId), queryFn: () => getNode(nodeId), enabled: Boolean(nodeId) })

/**
 * The DB-backed adapter the node kit talks to (dependency inversion: nodes never import Supabase).
 * The dev Note playground swaps this for an in-memory adapter (nodes/_kit/memoryAdapter.js).
 */
export const dbNodeAdapter = {
  name: 'db',
  getNode,
  /** `opts.children` = the typed children payload (questions/sections, days/slots...) saved in the same transaction. */
  saveNode: (nodeId, expectedRev, patch, opts = {}) => saveNode(nodeId, expectedRev, patch, { children: opts.children ?? null }),
  getRevisions: getGraphRevisions,
}
