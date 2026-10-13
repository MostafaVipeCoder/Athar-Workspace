import { Languages } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageProvider.jsx'
import { cn } from '../lib/cn.js'

/** Toggles Arabic/English, styled like a nav link. The label shows the language you will SWITCH TO, in its own script (icon-only under 480px; the aria-label carries it). */
export default function LanguageSwitch({ className, tone = 'default' }) {
  const { lang, setLang, t } = useLanguage()
  const next = lang === 'ar' ? 'en' : 'ar'
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      lang={next}
      aria-label={`${t('common.language')}: ${next === 'ar' ? 'العربية' : 'English'}`}
      className={cn(
        'tap-target inline-flex items-center justify-center gap-1.5 rounded-input px-3 text-base font-medium transition-colors duration-300',
        tone === 'inverse' ? 'text-athar-grey-100 hover:text-accent' : 'text-foreground hover:text-primary',
        className,
      )}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="hidden xs:inline">{next === 'ar' ? 'العربية' : 'English'}</span>
    </button>
  )
}
