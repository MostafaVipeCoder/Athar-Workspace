import { Outlet } from 'react-router-dom'
import SiteHeader from '../../shared/SiteHeader.jsx'
import SiteFooter from '../../shared/SiteFooter.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'
import UserMenu from '../../shared/UserMenu.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/**
 * Alumni manager / Athar Network shell: the site header on its dark surface (black band, #f2f2f2 text, yellow
 * active underline) - the "black as a secondary touch" of the palette decision. The manager pages live in pages/alumni-admin (step 10).
 */
export default function NetworkShell() {
  const { t } = useLanguage()
  // step 10 (manager side): the directory and the M&E workspace join the old five; Impact is a view of Analytics (a switch inside that page), the company page
  // and the Excel import are opened from the directory
  const items = [
    { to: '/alumni/admin/dashboard', label: t('nav.dashboard') },
    { to: '/alumni/admin/directory', label: t('nav.directory') },
    { to: '/alumni/admin/invitations', label: t('nav.invitations') },
    { to: '/alumni/admin/opportunities', label: t('nav.opportunities') },
    { to: '/alumni/admin/notifications', label: t('nav.notifications') },
    { to: '/alumni/admin/analytics', label: t('nav.analytics') },
    { to: '/alumni/admin/workspace', label: t('nav.workspace') },
  ]
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader home="/alumni/admin/dashboard" items={items} navLabel="Network" tone="dark" collapseAt="xl">
        <LanguageSwitch tone="inverse" />
        <UserMenu tone="inverse" />
      </SiteHeader>
      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6 sm:py-8">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
