import { Outlet } from 'react-router-dom'
import SiteHeader from '../../shared/SiteHeader.jsx'
import SiteFooter from '../../shared/SiteFooter.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'

/**
 * Login / invite / reset: the site hero (white page, the grey circle pattern behind the centred card) under the
 * white header and above the black footer. No gradient, no noise (none exist on the site).
 */
export default function AuthShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader>
        <LanguageSwitch />
      </SiteHeader>
      <main className="flex flex-1 items-center justify-center bg-hero-pattern bg-cover bg-center p-4 py-10 sm:py-section-sm">
        <Outlet />
      </main>
      <SiteFooter compact />
    </div>
  )
}
