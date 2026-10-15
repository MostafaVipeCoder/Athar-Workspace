import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import '../../shared/outbox/i18n.js'
import { useProjectContext } from '../guards/ProjectAccess.jsx'
import { useProjectGraph } from '../../data/canvas.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { OutboxPanel } from '../../shared/outbox/OutboxPanel.jsx'
import { ALL_STATES } from '../../lib/outbox.js'
import { staffPath } from '../../lib/links.js'

const SENDING_NODES = ['selection', 'booking', 'form_builder']
const VALID_STATES = new Set([...ALL_STATES, 'attention'])

/**
 * /projects/:projectId/outbox (m62, design 07 section 1.6): the project's e-mail Outbox. The filters live in the URL (?node=<node id>&state=<state | attention>) so the
 * links from the Selection / Booking nodes and from the project header land on the right view and a reload keeps it.
 */
export default function OutboxPage() {
  const { project, projectId } = useProjectContext()
  const { t, pick } = useLanguage()
  const graph = useProjectGraph(projectId)
  const [params, setParams] = useSearchParams()
  const nodes = useMemo(() => (graph.data?.nodes ?? []).filter((n) => SENDING_NODES.includes(n.type)).map((n) => ({ id: n.id, name: pick(n, 'name') || n.type })), [graph.data, pick])
  const state = VALID_STATES.has(params.get('state')) ? params.get('state') : null
  const node = params.get('node') || null

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4" data-testid="outbox-page">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link to={staffPath.program(project.program_id)} className="hover:underline">{t('programs.title')}</Link>
          {' / '}
          <Link to={staffPath.project(projectId)} className="hover:underline">{pick(project, 'name')}</Link>
        </p>
        <h1 className="text-section-title">{t('outbox.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('outbox.page.hint')}</p>
      </div>
      <OutboxPanel
        projectId={projectId}
        nodes={nodes}
        tz={project.timezone || 'Africa/Cairo'}
        initial={{ node, state }}
        onFilterChange={(f) => {
          const next = new URLSearchParams(params)
          if (f.node) next.set('node', f.node); else next.delete('node')
          if (f.state) next.set('state', f.state); else next.delete('state')
          setParams(next, { replace: true })
        }}
      />
    </div>
  )
}
