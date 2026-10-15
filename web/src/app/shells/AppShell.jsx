import { Outlet } from 'react-router-dom'
import SiteHeader from '../../shared/SiteHeader.jsx'
import SiteFooter from '../../shared/SiteFooter.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'
import UserMenu from '../../shared/UserMenu.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useAuth } from '../AuthContext.js'
import { buttonClass } from '../../ui/buttonStyles.js'

/**
 * Staff (PM / super_admin) app shell: the site header (white, 80px, logo + nav + language + user, mobile panel),
 * white content on the 1140px container and the black footer.
 */
export default function AppShell() {
  const { t } = useLanguage()
  const { can } = useAuth()
  const items = [
    { to: '/programs', label: t('nav.programs') },
    { to: '/network/experts', label: t('nav.experts') },
    { to: '/network/companies', label: t('nav.companies') },
    { to: '/library', label: t('nav.library') },
    ...(can('form-library:manage') ? [{ to: '/form-library', label: t('nav.formLibrary') }] : []),
    ...(can('staff:manage') ? [{ to: '/admin/staff', label: t('nav.staff') }, { to: '/admin/email', label: t('nav.email') }] : []),
  ]
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a href="#main" className={buttonClass({ size: 'sm', className: 'sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50' })}>
        {t('nav.skip')}
      </a>
      <SiteHeader home="/programs" items={items} navLabel="Main">
        <LanguageSwitch />
        <UserMenu />
      </SiteHeader>
      <main id="main" className="mx-auto w-full max-w-container flex-1 px-4 py-6 sm:py-8">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
