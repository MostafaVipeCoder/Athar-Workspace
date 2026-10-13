import { keys } from '../../data/queryKeys.js'

/** Node ids reachable downstream of `nodeId` along enabled edges (excluding the node itself). */
export function downstreamOf(graph, nodeId) {
  const edges = (graph?.edges ?? []).filter((e) => e.is_enabled !== false)
  const seen = new Set()
  const queue = [nodeId]
  while (queue.length) {
    const cur = queue.shift()
    for (const e of edges) {
      if (e.from_node_id === cur && !seen.has(e.to_node_id) && e.to_node_id !== nodeId) {
        seen.add(e.to_node_id)
        queue.push(e.to_node_id)
      }
    }
  }
  return [...seen]
}

/**
 * Saved-state refresh after a save (design 06 section 5.5): invalidate the source's outputs and the inputs/outputs of
 * everything downstream, plus the revision poll, so views mounted in this session re-render with fresh data.
 * Returns how many downstream nodes were affected (shown as "refreshed N views").
 */
export async function invalidateNodeOutputs(queryClient, graph, nodeId, projectId) {
  const downstream = downstreamOf(graph, nodeId)
  const jobs = [
    queryClient.invalidateQueries({ queryKey: [...keys.node(nodeId), 'out'] }),
    queryClient.invalidateQueries({ queryKey: keys.nodeRow(nodeId) }),
  ]
  for (const id of downstream) jobs.push(queryClient.invalidateQueries({ queryKey: keys.node(id) }))
  if (projectId) jobs.push(queryClient.invalidateQueries({ queryKey: keys.graphRevisions(projectId) }))
  await Promise.all(jobs)
  return downstream.length
}
