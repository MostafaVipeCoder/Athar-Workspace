import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, UserRound } from 'lucide-react'
import { useAuth } from '../app/AuthContext.js'
import { useLanguage } from '../i18n/LanguageProvider.jsx'
import { AREA_HOME } from '../lib/permissions.js'
import { writeLastArea } from '../app/lastArea.js'
import { Avatar } from '../ui/Avatar.jsx'
import { Badge } from '../ui/Badge.jsx'
import { cn } from '../lib/cn.js'

/**
 * User menu with role labels, AreaSwitcher (only for multi-area users) and sign out. The trigger reads like a nav link;
 * the dropdown is the site's submenu: white, 240px, 2px yellow top border, dropdown shadow, 17px rows.
 */
export default function UserMenu({ tone = 'default' }) {
  const { user, profile, roles, areas, signOut } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = profile?.full_name || user?.email || ''
  async function handleSignOut() {
    setOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }
  const item = 'flex min-h-12 w-full items-center gap-2 px-[17px] text-start text-base text-foreground transition-colors duration-300 hover:bg-surface hover:text-primary'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'tap-target inline-flex max-w-[12rem] items-center gap-2 rounded-input px-2 text-base transition-colors duration-300',
          tone === 'inverse' ? 'text-athar-grey-100 hover:text-accent' : 'text-foreground hover:text-primary',
        )}
      >
        <Avatar name={name} id={user?.id} color={profile?.profile_color} size="sm" className="h-8 w-8 text-[11px]" />
        <span className="hidden truncate sm:inline lg:hidden xl:inline">{name}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform duration-300', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-50 mt-2 w-60 overflow-hidden rounded-b-input border border-t-2 border-border border-t-accent bg-popover py-1 text-popover-foreground shadow-dropdown animate-in fade-in slide-in-from-top-1">
          <p className="truncate px-[17px] pt-2 text-xs text-muted-foreground" dir="ltr">{user?.email}</p>
          <div className="flex flex-wrap gap-1 px-[17px] pb-2 pt-1">
            {roles.map((r) => (
              <Badge key={r} tone="neutral">{t(`role.${r}`)}</Badge>
            ))}
          </div>
          {areas.length > 1 && (
            <div className="border-t py-1">
              <p className="px-[17px] py-1 text-xs font-medium text-muted-foreground">{t('nav.area')}</p>
              {areas.map((a) => (
                <button
                  key={a}
                  role="menuitem"
                  type="button"
                  className={item}
                  onClick={() => {
                    writeLastArea(a)
                    setOpen(false)
                    navigate(AREA_HOME[a])
                  }}
                >
                  {t(`area.${a}`)}
                </button>
              ))}
            </div>
          )}
          <div className="border-t pt-1">
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/profile')
              }}
              className={item}
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
              {t('nav.profile')}
            </button>
            <button role="menuitem" type="button" onClick={handleSignOut} className={item}>
              <LogOut className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              {t('common.signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
