import { Outlet } from 'react-router-dom'
import SiteHeader from '../../shared/SiteHeader.jsx'
import SiteFooter from '../../shared/SiteFooter.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'

/**
 * Public pages (forms, lists, agenda, booking, verify): the closest thing to the marketing site, so it matches it:
 * white 80px header with the real logo + language switch, white content on the 750px narrow container, black footer.
 */
export default function PublicShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader>
        <LanguageSwitch />
      </SiteHeader>
      <main className="mx-auto w-full max-w-container-narrow flex-1 px-4 pb-section-sm pt-4">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
