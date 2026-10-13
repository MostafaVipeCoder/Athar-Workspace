import { createContext, useContext } from 'react'

/**
 * What a mounted node sees: { node, manifest, mode, config, projectId, graph, adapter, registry, lang }.
 * `adapter` is the ONLY data access a node gets (getNode / saveNode / getRevisions); nodes never import Supabase.
 */
export const NodeContext = createContext(null)

export function useNodeContext() {
  const ctx = useContext(NodeContext)
  if (!ctx) throw new Error('Node hooks must be used inside <NodeHost>')
  return ctx
}
