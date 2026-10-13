import { lazy, Suspense, useMemo, useState } from 'react'
import { Eye } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { useDistributionPayload, useTimerState } from '../../data/distribution.js'
import { normalizePayload } from './distributionLogic.js'
import MatrixTab from './MatrixTab.jsx'
import MyScheduleTab from './MyScheduleTab.jsx'

const LiveBoard = lazy(() => import('./LiveBoard.jsx'))
const VIEWS = ['matrix', 'my', 'live']

/**
 * View mode (PM preview): the three surfaces visitors get, through the SAME components and the SAME payload builder (what the PM sees
 * is what the public/Agenda tab renders): the Matrix, "My schedule / Who do I meet next" and the Live board (read-only here; the timer
 * remote lives in Edit > Live).
 */
export default function DistributionView() {
  const { node } = useNodeContext()
  const { t } = useLanguage()
  const [view, setView] = useState('matrix')
  const payload = useDistributionPayload(node.id)
  const model = useMemo(() => normalizePayload(payload.data), [payload.data])
  const timer = useTimerState(node.id, { enabled: view === 'live' })

  const tabs = (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t('distribution.view.surfaces')}>
      {VIEWS.map((k) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cn('tap-target rounded-md px-3 text-sm', view === k ? 'bg-primary text-primary-foreground' : 'hover:bg-surface')} data-testid={`view-${k}`}>
          {t(`distribution.view.surface.${k}`)}
        </button>
      ))}
    </div>
  )
  return (
    <NodeFrame actions={tabs} showSave={false}>
      <p className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground"><Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('distribution.view.preview')}</p>
      {payload.isPending ? <Loading /> : payload.error ? <ErrorState error={payload.error} onRetry={payload.refetch} /> : !model ? <EmptyState title={t('distribution.view.empty')} /> : (
        <>
          {!model.published && <p className="mb-3 rounded-md bg-accent/30 px-3 py-2 text-sm" data-testid="view-unpublished">{t('distribution.view.previewUnpublished')}</p>}
          {view === 'matrix' && <MatrixTab model={model} audience="pm" hideTitle />}
          {view === 'my' && <MyScheduleTab model={model} audience="pm" hideTitle />}
          {view === 'live' && (
            <Suspense fallback={<Loading />}>
              {timer.data ? <LiveBoard model={model} timer={timer.data} offsetMs={timer.data.server_now ? Date.parse(timer.data.server_now) - timer.dataUpdatedAt : 0} title={null} /> : <Loading />}
            </Suspense>
          )}
        </>
      )}
    </NodeFrame>
  )
}
