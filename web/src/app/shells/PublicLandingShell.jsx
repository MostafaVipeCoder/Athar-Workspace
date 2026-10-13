import { Outlet } from 'react-router-dom'
import SiteHeader from '../../shared/SiteHeader.jsx'
import SiteFooter from '../../shared/SiteFooter.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'

/**
 * The landing page (design 01 section 3.9) is a full-width marketing page: same site chrome as the other public pages (white header +
 * language switch, black footer) but the content spans the whole width (hero pattern, cards, personalise band) instead of the 750 px
 * column; the page's own sticky navigation sits right under the sticky site header.
 */
export default function PublicLandingShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader>
        <LanguageSwitch />
      </SiteHeader>
      <main className="w-full flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
