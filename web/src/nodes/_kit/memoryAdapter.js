import { AppError } from '../../data/errors.js'

/**
 * In-memory node adapter with the same contract as the DB adapter. Used by the dev-only Note playground and by tests,
 * so lazy loading / modes / refresh can be proven without writing anything to the database.
 * Mimics save_node (optimistic concurrency, rev bump) and get_graph_revisions (own rev + upstream hash).
 */
export function createMemoryAdapter({ nodes, edges = [], latencyMs = 0 }) {
  const store = new Map(nodes.map((n) => [n.id, { rev: 1, config: {}, ...n }]))
  const wait = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs)) : Promise.resolve())

  function upstream(id, seen = new Set()) {
    if (seen.has(id)) return seen
    seen.add(id)
    for (const e of edges) if (e.to_node_id === id) upstream(e.from_node_id, seen)
    return seen
  }

  return {
    name: 'memory',
    async getNode(id) {
      await wait()
      const n = store.get(id)
      if (!n) throw new AppError('not_found')
      return structuredClone(n)
    },
    async saveNode(id, expectedRev, patch, { children = null } = {}) {
      await wait()
      const n = store.get(id)
      if (!n) throw new AppError('not_found')
      if (n.rev !== expectedRev) throw new AppError('conflict', { detail: String(n.rev) })
      if (patch.config) n.config = structuredClone(patch.config)
      for (const k of ['name_en', 'name_ar', 'visibility', 'show_to_participants']) if (k in patch) n[k] = patch[k]
      if (children) n.children = structuredClone(children) // typed children (questions, days...) as save_node would persist them
      n.rev += 1
      return { rev: n.rev }
    },
    async getRevisions() {
      await wait()
      return [...store.values()].map((n) => ({
        node_id: n.id,
        rev: n.rev,
        eff_rev: [...upstream(n.id)].sort().map((a) => `${a}:${store.get(a)?.rev}`).join(','),
      }))
    },
    /** Test/dev helper: another session saves a node (no expected-rev check). */
    externalSave(id, config) {
      const n = store.get(id)
      n.config = structuredClone(config)
      n.rev += 1
    },
    snapshot: () => ({ nodes: [...store.values()].map((n) => ({ ...n })), edges }),
  }
}
