import { Outlet } from 'react-router-dom'
import SiteHeader from '../../shared/SiteHeader.jsx'
import SiteFooter from '../../shared/SiteFooter.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'
import UserMenu from '../../shared/UserMenu.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/**
 * Alumni manager / Athar Network shell: the site header on its dark surface (black band, #f2f2f2 text, yellow
 * active underline) - the "black as a secondary touch" of the palette decision. Pages move in step 10.
 */
export default function NetworkShell() {
  const { t } = useLanguage()
  const items = [
    { to: '/alumni/admin/dashboard', label: t('nav.dashboard') },
    { to: '/alumni/admin/invitations', label: t('nav.invitations') },
    { to: '/alumni/admin/opportunities', label: t('nav.opportunities') },
    { to: '/alumni/admin/notifications', label: t('nav.notifications') },
    { to: '/alumni/admin/analytics', label: t('nav.analytics') },
  ]
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader home="/alumni/admin/dashboard" items={items} navLabel="Network" tone="dark">
        <LanguageSwitch tone="inverse" />
        <UserMenu tone="inverse" />
      </SiteHeader>
      <main className="mx-auto w-full max-w-container flex-1 px-4 py-6 sm:py-8">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
