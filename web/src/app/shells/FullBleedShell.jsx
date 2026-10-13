import { Outlet, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import BrandMark from '../../shared/BrandMark.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'
import UserMenu from '../../shared/UserMenu.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/**
 * Full-viewport shell for the project canvas and node pages: a thinner version of the site header (white, 1px
 * #eaeaea border, small logo, back link) so the canvas keeps the height; content fills the rest.
 */
export default function FullBleedShell() {
  const { t } = useLanguage()
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex min-h-14 items-center gap-3 border-b border-border bg-background px-3 safe-top sm:px-5">
        <Link to="/programs" className="tap-target inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-300 hover:text-primary">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          {t('nav.programs')}
        </Link>
        <BrandMark to="/programs" size="sm" className="ms-auto" />
        <div className="ms-auto flex items-center gap-1">
          <LanguageSwitch />
          <UserMenu />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
