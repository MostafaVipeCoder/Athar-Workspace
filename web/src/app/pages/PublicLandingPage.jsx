import { useEffect, useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { usePublicLanding } from '../../data/landing.js'
import { publicImageUrl } from '../../data/storage.js'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { setPageMeta } from '../../lib/meta.js'
import { parseRef } from '../../lib/links.js'
import LandingPage from '../../nodes/landing-page/LandingPage.jsx'
import { modelFromPayload, pickBi } from '../../nodes/landing-page/landingLogic.js'
import { useLandingTracker } from '../../nodes/landing-page/useLandingTracker.js'
import '../../nodes/landing-page/i18n.js'

/**
 * /view/:nodeRef/landing - the landing page on its own public link (link kind `view`, view_key `landing`; design 01 section 3.9).
 * The DB decides the audience (anon: public nodes; participants: platform; PMs: everything) and whitelists the payload
 * (`get_public_landing`, m37). Title / description / share image come from the node's SEO settings with the hero and the project name
 * as fallbacks. Analytics: one `tab_view` per page view plus CTA / share / photo events (anon RPC, no PII).
 */
export default function PublicLandingPage() {
  const { nodeRef } = useParams()
  const { pathname } = useLocation()
  const { t, lang, pick } = useLanguage()
  const ref = parseRef(nodeRef)
  const query = usePublicLanding(ref.kind === 'invalid' ? null : ref.value)
  const payload = query.data
  const model = useMemo(() => (payload?.data ? modelFromPayload(payload.data) : null), [payload])
  const track = useLandingTracker({ refValue: ref.kind === 'invalid' ? null : ref.value, nodeId: null, analyticsEnabled: model?.config.analytics.enabled ?? true, audience: payload?.viewer, ready: Boolean(model) })

  useEffect(() => {
    if (!model) return
    const seo = model.config.seo
    setPageMeta({
      title: pickBi(seo.title, lang) || pickBi(model.config.hero.title, lang) || pick(payload, 'title') || pick(payload?.project, 'name'),
      description: pickBi(seo.description, lang) || pickBi(model.config.hero.body, lang),
      image: seo.imagePath ? publicImageUrl(seo.imagePath) : model.config.hero.coverPath ? publicImageUrl(model.config.hero.coverPath) : '',
    })
  }, [model, lang, payload, pick])

  if (ref.kind === 'invalid') return <NotAvailable t={t} />
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!payload || !model) return <NotAvailable t={t} />

  return (
    <div data-testid="public-landing-page" data-audience={payload.viewer}>
      <LandingPage model={model} lang={lang} track={track} mode="page" pageUrl={typeof window !== 'undefined' ? `${window.location.origin}${pathname}` : ''} slug={ref.value} />
    </div>
  )
}

function NotAvailable({ t }) {
  return (
    <div className="mx-auto max-w-container-narrow px-4 py-8">
      <EmptyState icon={Lock} title={t('landing.public.notFound')} body={t('landing.public.notFoundBody')} />
    </div>
  )
}
