import { NavLink } from 'react-router-dom'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { cn } from '../../../lib/cn.js'
import './area.i18n.js'

const TABS = [
  { to: '/alumni/admin/directory', key: 'directory' },
  { to: '/alumni/admin/attention', key: 'attention' },
  { to: '/alumni/admin/history', key: 'history' },
]

/** The three views of the registry as tabs (the header already has seven links; these three belong together: the list, what is missing in it, what changed in it). */
export default function AreaTabs() {
  const { t } = useLanguage()
  return (
    <nav aria-label={t('alumni.admin.area.label')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" data-testid="area-tabs">
      {TABS.map((x) => (
        <NavLink
          key={x.key}
          to={x.to}
          className={({ isActive }) => cn(
            'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive ? 'border-foreground bg-foreground text-background' : 'border-input bg-background text-foreground hover:border-foreground',
          )}
        >
          {t(`alumni.admin.area.${x.key}`)}
        </NavLink>
      ))}
    </nav>
  )
}
