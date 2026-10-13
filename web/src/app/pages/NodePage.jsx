import { Link, useParams } from 'react-router-dom'
import { useProjectContext } from '../guards/ProjectAccess.jsx'
import { useProjectGraph, useNodeRow } from '../../data/canvas.js'
import NodeHost from '../../nodes/_kit/NodeHost.jsx'
import { Loading, ErrorState } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** /projects/:projectId/nodes/:nodeId[/edit|/settings] - mounts the node through NodeHost in the route's mode. */
export default function NodePage({ mode }) {
  const { projectId } = useProjectContext()
  const { nodeId } = useParams()
  const { t } = useLanguage()
  const graph = useProjectGraph(projectId)
  const row = useNodeRow(nodeId)

  if (row.isPending || graph.isPending) return <Loading />
  const failure = row.error ?? graph.error
  if (failure) return <div className="p-4"><ErrorState error={failure} onRetry={() => { row.refetch(); graph.refetch() }} /></div>
  if (row.data.project_id !== projectId) return <div className="p-4"><ErrorState error={{ messageKey: 'errors.not_found', retryable: false }} /></div>

  const modes = [['view', ''], ['edit', '/edit'], ['settings', '/settings']]
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <nav aria-label="Node modes" className="flex gap-1">
        <Link to={`/projects/${projectId}`} className="tap-target me-auto inline-flex items-center text-sm text-muted-foreground hover:underline">
          {t('project.canvas')}
        </Link>
        {modes.map(([m, suffix]) => (
          <Link
            key={m}
            to={`/projects/${projectId}/nodes/${nodeId}${suffix}`}
            aria-current={m === mode ? 'page' : undefined}
            className={`tap-target inline-flex items-center rounded-md px-3 text-sm ${m === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-surface'}`}
          >
            {t(`node.${m}`)}
          </Link>
        ))}
      </nav>
      <NodeHost mode={mode} node={row.data} graph={graph.data} projectId={projectId} />
    </div>
  )
}
