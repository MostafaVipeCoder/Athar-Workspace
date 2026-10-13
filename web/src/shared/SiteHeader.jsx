import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import BrandMark from './BrandMark.jsx'
import NavBar from './NavBar.jsx'
import { useLanguage } from '../i18n/LanguageProvider.jsx'
import { cn } from '../lib/cn.js'

/**
 * The athareg.com header: white bar, 80px, 1px #eaeaea bottom border, logo 150x50 at the start, nav links in the
 * middle, actions (language, user) at the end. Below `lg` (1024px; the site collapses at 922px with 5 links, the staff nav carries up to 7) the nav collapses behind the site's yellow 43x43 toggle
 * (hamburger / close) and opens INLINE under the header as a full-width white panel (not a drawer), like the site.
 * `tone="dark"` = the black band (NetworkShell): same layout on black with #f2f2f2 text.
 */
export default function SiteHeader({ home = '/', items = [], navLabel = 'Main', tone = 'light', children, className }) {
  const { t } = useLanguage()
  const location = useLocation()
  const dark = tone === 'dark'
  const hasNav = items.length > 0
  // The mobile panel is keyed on the pathname: a navigation remounts it closed (no setState in an effect).
  return (
    <header data-surface={dark ? 'dark' : undefined} className={cn('site-header', dark && 'border-b-black bg-black text-athar-grey-100', className)}>
      <MobileMenuFrame key={location.pathname} home={home} items={items} navLabel={navLabel} dark={dark} hasNav={hasNav} t={t}>
        {children}
      </MobileMenuFrame>
    </header>
  )
}

function MobileMenuFrame({ home, items, navLabel, dark, hasNav, t, children }) {
  const [open, setOpen] = useState(false)

  // the panel also closes when the viewport grows past the breakpoint and on Esc
  useEffect(() => {
    if (!open) return undefined
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e) => e.matches && setOpen(false)
    mq.addEventListener?.('change', onChange)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => {
      mq.removeEventListener?.('change', onChange)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <div className="site-header-inner">
        <BrandMark to={home} inverse={dark} />
        {hasNav && (
          <div className="hidden min-w-0 flex-1 lg:block">
            <NavBar items={items} label={navLabel} tone={dark ? 'inverse' : 'default'} />
          </div>
        )}
        <div className={cn('flex items-center gap-1 sm:gap-2', !hasNav && 'ms-auto', hasNav && 'ms-auto lg:ms-0')}>{children}</div>
        {hasNav && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="site-mobile-menu"
            aria-label={open ? t('nav.closeMenu') : t('nav.menu')}
            className="inline-flex h-[43px] w-[43px] shrink-0 items-center justify-center rounded-xs bg-cta text-cta-foreground transition duration-300 hover:brightness-95 lg:hidden"
          >
            {open ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
          </button>
        )}
      </div>
      {/* no enter animation: the site's panel simply appears (a running fade left the panel half-transparent in captures) */}
      {hasNav && (
        <div id="site-mobile-menu" className={cn('border-t border-border bg-background text-foreground lg:hidden', open ? 'block' : 'hidden')}>
          <NavBar items={items} label={navLabel} vertical onNavigate={() => setOpen(false)} />
        </div>
      )}
    </>
  )
}
