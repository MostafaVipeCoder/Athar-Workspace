import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { keys } from '../../data/queryKeys.js'

export const REVISION_POLL_MS = 30_000

/**
 * Saved-state refresh across sessions (design 06 section 5.5 + 08 decision 02-5). A project's revision counters
 * (node_revisions via RPC get_graph_revisions: own rev + a hash of all upstream revs, eff_rev) are polled on window
 * focus and every 30 s; whenever a node's counters change, every cached query of that node is invalidated so views
 * re-render with fresh data. No persistent socket (visitors/founders); PM Realtime is an optional later upgrade.
 *
 * `adapter.getRevisions(projectId)` -> [{ node_id, rev, eff_rev }]
 */
export function useSavedStateRefresh({ projectId, adapter, enabled = true, intervalMs = REVISION_POLL_MS }) {
  const queryClient = useQueryClient()
  const previous = useRef(null)
  const [state, setState] = useState({ changedIds: [], lastRefreshedAt: null })

  const query = useQuery({
    queryKey: keys.graphRevisions(projectId),
    queryFn: () => adapter.getRevisions(projectId),
    enabled: enabled && Boolean(projectId) && Boolean(adapter?.getRevisions),
    refetchInterval: intervalMs,
    refetchOnWindowFocus: true,
    staleTime: 0,
    meta: { silent: true },
  })

  useEffect(() => {
    if (!query.data) return
    const current = new Map(query.data.map((r) => [r.node_id, `${r.rev}:${r.eff_rev}`]))
    const before = previous.current
    previous.current = current
    if (!before) return // first load establishes the baseline
    const changedIds = [...current].filter(([id, sig]) => before.get(id) !== sig).map(([id]) => id)
    if (changedIds.length === 0) return
    for (const id of changedIds) queryClient.invalidateQueries({ queryKey: keys.node(id) })
    setState({ changedIds, lastRefreshedAt: Date.now() })
  }, [query.data, queryClient])

  return { ...state, revisions: query.data ?? null, isLoading: query.isPending }
}
