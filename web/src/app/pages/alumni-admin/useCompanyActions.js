import { useAlumniRefresh } from '../../../shared/alumni/useAlumniRefresh.js'

/**
 * The actions the manager's company page and the directory drawer share: refreshing the company payload after a save of the team / the profile. (The figures have their own panel,
 * shared/alumni/FiguresPanel.jsx, which owns its queries: owner decision 21 replaced the yearly-row actions that lived here.)
 */
export function useCompanyActions() {
  const { refresh } = useAlumniRefresh()
  return { refresh }
}
