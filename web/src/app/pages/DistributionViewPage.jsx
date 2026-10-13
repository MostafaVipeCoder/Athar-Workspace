import { lazy, Suspense, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Lock, EyeOff } from 'lucide-react'
import { usePublicDistribution, usePublicTimer } from '../../data/distribution.js'
import { keys } from '../../data/queryKeys.js'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { parseRef } from '../../lib/links.js'
import { setPageMeta } from '../../lib/meta.js'
import { normalizePayload, serverOffsetMs } from '../../nodes/distribution/distributionLogic.js'
import '../../nodes/distribution/i18n.js'

const MatrixTab = lazy(() => import('../../nodes/distribution/MatrixTab.jsx'))
const LiveBoard = lazy(() => import('../../nodes/distribution/LiveBoard.jsx'))
const TimerControls = lazy(() => import('../../nodes/distribution/TimerControls.jsx'))

/**
 * /view/:nodeRef/matrix and /view/:nodeRef/live - the two public surfaces of a Distribution node (design 01 section 3.7, 03 section 9.4).
 * The DB decides the audience from the link + the node's visibility and ENFORCES the publish flag (an unpublished node answers
 * `published: false`, nothing else). Matrix = the whitelisted payload through the same MatrixTab the Agenda hosts. Live = the same payload
 * (refetched only when the timer poll reports a newer revision) + the tiny timer RPC polled while the page is visible; the countdown is
 * computed locally from server timestamps. Viewers are READ-ONLY: the timer remote is rendered only when the DB says the viewer is a
 * project manager (`viewer === 'pm'`), and the RPC behind it re-checks that.
 */
export default function DistributionViewPage({ viewKey }) {
  const { nodeRef } = useParams()
  const { t, pick } = useLanguage()
  const qc = useQueryClient()
  const ref = parseRef(nodeRef)
  const refValue = ref.kind === 'invalid' ? null : ref.value
  const query = usePublicDistribution(refValue, viewKey)
  const payload = query.data
  const live = viewKey === 'live'
  const available = Boolean(payload) && payload.published !== false
  const model = useMemo(() => (available ? normalizePayload(payload) : null), [available, payload])
  const timerQuery = usePublicTimer(refValue, { enabled: live && available })

  const name = payload ? pick(payload, 'name') : ''
  useEffect(() => {
    if (payload) setPageMeta({ title: [name, pick(payload.project ?? {}, 'name')].filter(Boolean).join(' - ') })
  }, [payload, name, pick])

  // a newer revision (sessions regenerated / edited) -> fetch the full payload again; otherwise only the tiny poll runs
  const polledRevision = timerQuery.data?.revision
  const { refetch } = query
  useEffect(() => {
    if (model && polledRevision !== undefined && polledRevision !== null && polledRevision > model.revision) refetch()
  }, [polledRevision, model, refetch])

  if (!refValue) return <Unavailable t={t} />
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!payload) return <Unavailable t={t} />
  if (payload.published === false) return <EmptyState icon={EyeOff} title={t('distribution.view.notPublished')} body={t('distribution.view.notPublishedBody')} />

  const projectName = pick(payload.project ?? {}, 'name')
  if (!live) {
    return (
      <div className="space-y-4 py-2" data-testid="distribution-matrix-page" data-audience={payload.viewer}>
        <header>
          <h1 className="text-page-title" dir="auto">{name || t('distribution.name')}</h1>
          {projectName && <p className="text-muted-foreground" dir="auto">{projectName}</p>}
        </header>
        <Suspense fallback={<Loading />}><MatrixTab model={model} audience={payload.viewer} hideTitle /></Suspense>
      </div>
    )
  }

  const timer = timerQuery.data ?? { ...payload.timer, receivedAt: query.dataUpdatedAt }
  const offset = serverOffsetMs(timer.server_now, timer.receivedAt)
  const isPm = payload.viewer === 'pm'
  const controls = isPm ? (
    <Suspense fallback={<Loading />}>
      <TimerControls nodeId={payload.node_id} model={model} state={timer} onState={(s) => qc.setQueryData(keys.publicDistTimer(refValue), { ...s, published: true, revision: model.revision, viewer: 'pm', receivedAt: Date.now() })} />
    </Suspense>
  ) : null
  return (
    <div className="py-2" data-testid="distribution-live-page" data-audience={payload.viewer}>
      <Suspense fallback={<Loading />}>
        <LiveBoard model={model} timer={timer} offsetMs={offset} controls={controls} title={name || projectName} />
      </Suspense>
      {isPm && <p className="mt-4 text-xs text-muted-foreground">{t('distribution.live.pmNote')}</p>}
    </div>
  )
}

function Unavailable({ t }) {
  return <EmptyState icon={Lock} title={t('distribution.view.notFound')} body={t('distribution.view.notFoundBody')} />
}
