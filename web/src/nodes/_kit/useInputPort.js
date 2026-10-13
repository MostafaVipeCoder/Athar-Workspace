import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useNodeContext } from './NodeContext.js'
import { keys } from '../../data/queryKeys.js'

/**
 * Data arriving over edges into one input port (design 06 section 4.4). For every edge (source, sourcePort) -> this
 * (portKey) it calls the SOURCE manifest's `ports.out[].resolve()` resolver through TanStack Query under the key
 * ['node', sourceId, 'out', sourcePort]. A node can therefore never read another node's tables directly.
 * Returns { status: 'idle'|'loading'|'error'|'success', items, sources, isFetching, error }.
 */
export function useInputPort(portKey) {
  const { node, graph, registry, adapter } = useNodeContext()

  const edges = useMemo(
    () => (graph?.edges ?? []).filter((e) => e.to_node_id === node.id && e.to_port === portKey && e.is_enabled !== false),
    [graph, node.id, portKey],
  )

  const results = useQueries({
    queries: edges.map((edge) => ({
      queryKey: keys.nodeOut(edge.from_node_id, edge.from_port),
      queryFn: async () => {
        const source = (graph?.nodes ?? []).find((n) => n.id === edge.from_node_id)
        const manifest = source && registry.get(source.type)
        const port = manifest?.ports.out.find((p) => p.key === edge.from_port)
        if (!port?.resolve) return { items: [] } // source has no resolver yet (its node is built in a later step)
        const resolver = await port.resolve()
        const out = await resolver({ node: source, port: edge.from_port, adapter, graph })
        // `items` is the contract; anything else the resolver returns (a form's `schema`, a list's `kind`) rides along
        return { ...(out && typeof out === 'object' ? out : {}), items: out?.items ?? [] }
      },
    })),
  })

  if (edges.length === 0) return { status: 'idle', items: [], sources: [], results: [], isFetching: false, error: null }

  const error = results.find((r) => r.isError)?.error ?? null
  const status = error ? 'error' : results.some((r) => r.isPending) ? 'loading' : 'success'
  const items = results.flatMap((r, i) => (r.data?.items ?? []).map((item) => ({ ...item, _from: edges[i].from_node_id })))
  return {
    status,
    items,
    sources: edges.map((e) => e.from_node_id),
    /** Per edge: { sourceId, port, data } (data = the whole resolver result, e.g. a form's `schema`). */
    results: results.map((r, i) => ({ sourceId: edges[i].from_node_id, port: edges[i].from_port, data: r.data ?? null })),
    isFetching: results.some((r) => r.isFetching),
    error,
  }
}
