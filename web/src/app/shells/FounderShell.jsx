import { Outlet, NavLink } from 'react-router-dom'
import { Home, Layers, Bell, Handshake, UserRound } from 'lucide-react'
import SiteHeader from '../../shared/SiteHeader.jsx'
import LanguageSwitch from '../../shared/LanguageSwitch.jsx'
import UserMenu from '../../shared/UserMenu.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useUnreadNotifications } from '../../data/founderNotifications.js'
import { badgeCount } from '../../lib/badge.js'
import { cn } from '../../lib/cn.js'

/**
 * Founder platform shell, mobile-first: the site header (no nav links; the tabs live in the bottom bar) + a fixed
 * bottom tab bar. The active tab is black + semibold with a 2px yellow indicator on top; labels are never yellow
 * (yellow text on white fails contrast). The Notifications tab carries the unread badge (one HEAD count, refreshed on
 * focus and once a minute; a failure just hides the badge). Progress and the Company page are reached from the Home and the Profile.
 */
export default function FounderShell() {
  const { t } = useLanguage()
  const unread = useUnreadNotifications()
  const count = badgeCount(unread.data)
  const tabs = [
    { to: '/alumni/founder/dashboard', label: t('nav.dashboard'), Icon: Home },
    { to: '/alumni/founder/programs', label: t('nav.programs'), Icon: Layers },
    { to: '/alumni/founder/opportunities', label: t('nav.opportunities'), Icon: Handshake },
    { to: '/alumni/founder/notifications', label: t('nav.notifications'), Icon: Bell, badge: count },
    { to: '/alumni/founder/profile', label: t('nav.profileShort'), Icon: UserRound },
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
      <nav aria-label={t('nav.founder')} className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background safe-bottom">
        <ul className="mx-auto flex max-w-container-narrow">
          {tabs.map(({ to, label, Icon, badge }) => (
            <li key={to} className="min-w-0 flex-1">
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'tap-target relative flex h-14 flex-col items-center justify-center gap-0.5 border-t-2 border-transparent px-0.5 text-[10.5px] leading-tight tracking-tight transition-colors duration-300 sm:text-xs',
                    isActive ? 'border-accent font-semibold text-foreground' : 'text-muted-foreground hover:text-primary',
                  )
                }
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {badge && (
                    <span
                      data-testid="unread-badge"
                      className="absolute -top-1.5 start-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive-text px-1 text-[10px] font-bold leading-none text-white"
                    >
                      <span aria-hidden="true">{badge}</span>
                      <span className="sr-only">{t('nav.unreadCount', { count: unread.data })}</span>
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
