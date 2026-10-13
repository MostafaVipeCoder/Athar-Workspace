import { createContext, useContext } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { useProject } from '../../data/programs.js'
import { Loading, ErrorState, EmptyState } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { ShieldOff } from 'lucide-react'

const ProjectContext = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useProjectContext() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProjectContext must be used under <ProjectAccess>')
  return ctx
}

/**
 * Loads the project through RLS. A project the user cannot see comes back as no row, so "forbidden" and "does not
 * exist" look the same (nothing is revealed). Provides the project to the nested routes.
 */
export default function ProjectAccess() {
  const { projectId } = useParams()
  const { t } = useLanguage()
  const { data: project, isPending, isError, error, refetch } = useProject(projectId)

  if (isPending) return <Loading fullScreen />
  if (isError) return <div className="p-6"><ErrorState error={error} onRetry={refetch} /></div>
  if (!project) {
    return (
      <div className="p-6">
        <EmptyState icon={ShieldOff} title={t('project.notFound')} />
      </div>
    )
  }
  return (
    <ProjectContext.Provider value={{ project, projectId }}>
      <Outlet />
    </ProjectContext.Provider>
  )
}
