import { useLanguage } from '../i18n/LanguageProvider.jsx'
import { BRAND } from '../lib/brand.js'
import { cn } from '../lib/cn.js'

/** The site footer: one black band, centred Manrope 17px #f2f2f2 copyright; links are yellow (fine on black). */
export default function SiteFooter({ className, compact = false }) {
  const { t } = useLanguage()
  return (
    <footer data-surface="dark" className={cn('mt-auto bg-black text-athar-grey-100', className)}>
      <div className={cn('mx-auto flex w-full max-w-container-wide flex-col items-center justify-center gap-1 px-5 text-center text-base sm:flex-row sm:gap-4', compact ? 'min-h-12 py-2' : 'min-h-[73px] py-5')}>
        <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
        <a href={BRAND.siteUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline-offset-4 hover:underline" dir="ltr">
          {t('footer.site')}
        </a>
      </div>
    </footer>
  )
}
