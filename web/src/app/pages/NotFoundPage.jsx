import { Link } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'

/** 404 in the site's hero style: pattern background, slab heading, yellow CTA. */
export default function NotFoundPage() {
  const { t } = useLanguage()
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-hero-pattern bg-cover bg-center p-6 text-center">
      <p className="font-display text-hero text-primary" aria-hidden="true">404</p>
      <h1 className="text-section-title">{t('notfound.title')}</h1>
      <p className="max-w-md text-base text-muted-foreground">{t('notfound.body')}</p>
      <Link to="/" className={buttonClass({ className: 'mt-2' })}>
        {t('common.goHome')}
      </Link>
    </main>
  )
}
