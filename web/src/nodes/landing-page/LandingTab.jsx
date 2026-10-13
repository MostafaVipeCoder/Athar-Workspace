import { useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import LandingPage from './LandingPage.jsx'
import { modelFromPayload } from './landingLogic.js'
import { useLandingTracker } from './useLandingTracker.js'

/**
 * The contributed view of the landing node (`contributesViews 'landing-tab'`): the host (agenda / project page, app/pages/agenda/AgendaHost)
 * hands it the `get_public_tab` payload `data = { node_id, config, cards, frames }` and it NEVER fetches. Same renderer as the node's own
 * public page, in `tab` mode (no sticky nav: the host's tab bar is the navigation). Analytics use the host's ref from the route.
 */
export default function LandingTab({ data, audience = 'public' }) {
  const { lang } = useLanguage()
  const { ref } = useParams()
  const { pathname } = useLocation()
  const model = useMemo(() => modelFromPayload(data), [data])
  const track = useLandingTracker({ refValue: ref, nodeId: model.nodeId, analyticsEnabled: model.config.analytics.enabled, audience })
  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}${pathname}` : ''
  return <LandingPage model={model} lang={lang} track={track} mode="tab" pageUrl={pageUrl} slug={ref ?? ''} />
}
