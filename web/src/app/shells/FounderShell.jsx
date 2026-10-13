import { Outlet, NavLink } from 'react-router-dom'
import { Home, Layers, Bell, UserRound } from 'lucide-react'
import SiteHeader from '../../shared/SiteHeader.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'
import UserMenu from '../../shared/UserMenu.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { cn } from '../../lib/cn.js'

/**
 * Founder platform shell, mobile-first: the site header (no nav links; the tabs live in the bottom bar) + a fixed
 * bottom tab bar. The active tab is black + semibold with a 2px yellow indicator on top; labels are never yellow
 * (yellow text on white fails contrast).
 */
export default function FounderShell() {
  const { t } = useLanguage()
  const tabs = [
    { to: '/alumni/founder/dashboard', label: t('nav.dashboard'), Icon: Home },
    { to: '/alumni/founder/programs', label: t('nav.programs'), Icon: Layers },
    { to: '/alumni/founder/notifications', label: t('nav.notifications'), Icon: Bell },
    { to: '/alumni/founder/profile', label: t('nav.profile'), Icon: UserRound },
  ]
  return (
    <div className="flex min-h-dvh flex-col bg-background pb-16">
      <SiteHeader home="/alumni/founder/dashboard">
        <LanguageSwitch />
        <UserMenu />
      </SiteHeader>
      <main className="mx-auto w-full max-w-container-narrow flex-1 px-4 py-4">
        <Outlet />
      </main>
      <nav aria-label="Founder" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background safe-bottom">
        <ul className="mx-auto flex max-w-container-narrow">
          {tabs.map(({ to, label, Icon }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'tap-target relative flex h-14 flex-col items-center justify-center gap-0.5 border-t-2 border-transparent text-xs transition-colors duration-300',
                    isActive ? 'border-accent font-semibold text-foreground' : 'text-muted-foreground hover:text-primary',
                  )
                }
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
