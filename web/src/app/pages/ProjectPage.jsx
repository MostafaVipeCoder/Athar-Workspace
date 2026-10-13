import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { Info, Users } from 'lucide-react'
import { staffPath } from '../../lib/links.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useProjectContext } from '../guards/ProjectAccess.jsx'
import { useProjectGraph } from '../../data/canvas.js'
import { ErrorState, Loading } from '../../ui/States.jsx'

// The canvas library (@xyflow/react) lives behind this lazy boundary (design 06 section 3 / 08 P3): only this route loads it.
const ProjectCanvas = lazy(() => import('../canvas/ProjectCanvas.jsx'))

/** Project page: thin header + the lazy canvas (tool library, React Flow, inspector). */
export default function ProjectPage() {
  const { project, projectId } = useProjectContext()
  const { t, pick } = useLanguage()
  const graph = useProjectGraph(projectId)

  return (
    <div className="flex h-full min-h-full flex-col" data-testid="project-page">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h1 className="font-display text-lg font-extrabold">{pick(project, 'name')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={staffPath.projectParticipants(projectId)} className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">
            <Users className="h-4 w-4" aria-hidden="true" />
            {t('project.participants')}
          </Link>
          <Link to={staffPath.projectDetails(projectId)} className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">
            <Info className="h-4 w-4" aria-hidden="true" />
            {t('project.details')}
          </Link>
        </div>
      </div>
      {graph.isError ? (
        <div className="p-4"><ErrorState error={graph.error} onRetry={graph.refetch} /></div>
      ) : graph.isPending ? (
        <Loading />
      ) : (
        <Suspense fallback={<Loading label={t('project.loadingCanvas')} />}>
          <ProjectCanvas projectId={projectId} />
        </Suspense>
      )}
    </div>
  )
}
