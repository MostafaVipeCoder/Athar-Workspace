import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { alumniKeys } from '../../data/alumni.js'

/**
 * `refresh()`: after a save, everything under ['alumni'] EXCEPT the vocabulary is refetched (a save changes several payloads: profile, company, directory), the same rule
 * as `useAlumniMutations`. Pages that call the data functions directly (to show their own error text instead of the global toast) use this.
 * `fetchFresh(key, fn)` = the fresh payload for a form that must rebase on what the server now holds.
 */
export function useAlumniRefresh() {
  const qc = useQueryClient()
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: alumniKeys.root(), predicate: (q) => q.queryKey[1] !== 'lookups' }), [qc])
  const fetchFresh = useCallback((queryKey, queryFn) => qc.fetchQuery({ queryKey, queryFn, staleTime: 0 }), [qc])
  return { refresh, fetchFresh }
}
