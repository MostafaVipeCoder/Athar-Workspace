import { Outlet } from 'react-router-dom'
import SiteHeader from '../../shared/SiteHeader.jsx'
import SiteFooter from '../../shared/SiteFooter.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'

/**
 * Public pages that need width (the distribution matrix: up to ~20 mentor columns, the live board on a TV): same chrome as
 * PublicShell, content on the 1200px wide container instead of the 750px narrow one.
 */
export default function PublicWideShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader>
        <LanguageSwitch />
      </SiteHeader>
      <main className="mx-auto w-full max-w-container-wide flex-1 px-4 pb-section-sm pt-4">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
