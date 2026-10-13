import { lazy, Suspense, useMemo, useState } from 'react'
import { ExternalLink, Eye } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useLandingDefinition, useLandingLink } from '../../data/landing.js'
import { Button } from '../../ui/Button.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { buildPublicUrl } from '../../lib/links.js'
import { fromCardRow, fromFrameRow, normalizeLandingConfig } from './landingLogic.js'

const LandingPage = lazy(() => import('./LandingPage.jsx'))

/**
 * View mode (PM preview, design 06 4.3): the SAVED page through the SAME renderer the public sees, in `preview` mode (nothing is recorded,
 * links do not navigate away). Cards and frames are read under RLS; the DB's public payload is not used so a private page can be previewed too.
 */
export default function LandingView() {
  const { node } = useNodeContext()
  const { t, lang: uiLang } = useLanguage()
  const [lang, setLang] = useState(uiLang === 'ar' ? 'ar' : 'en')
  const def = useLandingDefinition(node.id)
  const link = useLandingLink(node.id)
  const model = useMemo(() => (def.data ? { nodeId: node.id, config: normalizeLandingConfig(node.config), cards: def.data.cards.map(fromCardRow), frames: def.data.frames.map(fromFrameRow) } : null), [def.data, node.id, node.config])
  const url = link.data?.slug ? buildPublicUrl('view', link.data.slug, { viewKey: 'landing' }) : null

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="group" aria-label={t('landing.preview.lang')}>
        {['en', 'ar'].map((l) => <Button key={l} size="sm" variant={lang === l ? 'secondary' : 'outline'} onClick={() => setLang(l)} aria-pressed={lang === l}>{l === 'en' ? 'EN' : 'AR'}</Button>)}
      </div>
      {url ? (
        <a href={`${url}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('landing.view.openPage')}
        </a>
      ) : <span className="text-xs text-muted-foreground">{t('landing.view.noLink')}</span>}
    </div>
  )

  return (
    <NodeFrame actions={actions}>
      <p className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('landing.view.preview')}
      </p>
      {def.error ? <ErrorState error={def.error} onRetry={def.refetch} /> : def.isPending || !model ? <Loading /> : (
        <div className="overflow-hidden rounded-card border" data-testid="landing-view">
          <Suspense fallback={<Loading />}>
            <LandingPage model={model} lang={lang} mode="preview" stickyNav={false} pageUrl={url ?? ''} slug={link.data?.slug ?? ''} />
          </Suspense>
        </div>
      )}
    </NodeFrame>
  )
}
