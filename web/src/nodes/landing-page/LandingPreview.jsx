import { lazy, Suspense, useState } from 'react'
import { Eye } from 'lucide-react'
import { Button } from '../../ui/Button.jsx'
import { Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

const LandingPage = lazy(() => import('./LandingPage.jsx'))

/**
 * The editor's live preview: the SAME renderer as the public page fed with the unsaved draft, in `preview` mode (nothing is recorded, no
 * link navigates away) inside a phone-sized frame that scrolls on its own (the page decides its layout from its own width, so this IS the
 * mobile layout). The language toggle shows the Arabic / English page whatever the editor's language is.
 */
export default function LandingPreview({ model, pageUrl, slug }) {
  const { t, lang: uiLang } = useLanguage()
  const [lang, setLang] = useState(uiLang === 'ar' ? 'ar' : 'en')
  return (
    <section className="space-y-2" aria-label={t('landing.preview.heading')} data-testid="landing-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Eye className="h-4 w-4" aria-hidden="true" />{t('landing.preview.heading')}</h3>
        <div className="flex gap-1">
          {['en', 'ar'].map((l) => <Button key={l} size="sm" variant={lang === l ? 'secondary' : 'outline'} onClick={() => setLang(l)} aria-pressed={lang === l}>{l === 'en' ? 'EN' : 'AR'}</Button>)}
        </div>
      </div>
      <div className="mx-auto h-[640px] max-w-[420px] overflow-y-auto overscroll-contain rounded-card border bg-background shadow-dropdown" data-testid="preview-frame">
        <Suspense fallback={<Loading />}>
          <LandingPage model={model} lang={lang} mode="preview" pageUrl={pageUrl} slug={slug} />
        </Suspense>
      </div>
      <p className="text-center text-xs text-muted-foreground">{t('landing.preview.note')}</p>
    </section>
  )
}
