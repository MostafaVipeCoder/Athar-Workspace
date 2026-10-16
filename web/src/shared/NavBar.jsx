import { useEffect, useId, useRef, useState } from 'react'
import { NavLink, matchPath, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn.js'

/**
 * Site-style nav: Manrope 17px black links, blue on hover, 2px yellow underline when active (`.nav-link`).
 * Horizontal (desktop header, scrolls instead of wrapping) or `vertical` (the mobile panel: full-width rows).
 * items: [{ to, label, end?, more? }]; tone 'default' | 'inverse' (on black).
 * `more: true` items (horizontal layout only) sit in a "More" menu at the end of the row: a long nav (the Alumni manager's has nine links) would otherwise overflow its slot and hide its
 * last links behind a scrollbar. The menu button shows the label of the CURRENT page when that page is one of them (the active underline is always visible). The links stay in the DOM
 * (closed = hidden), the vertical panel lists every item flat. `moreLabel` = the button's label.
 */
export default function NavBar({ items, label, tone = 'default', vertical = false, onNavigate, className, moreLabel = 'More' }) {
  const main = vertical ? items : items.filter((it) => !it.more)
  const more = vertical ? [] : items.filter((it) => it.more)
  const linkClass = ({ isActive }) =>
    cn(
      'nav-link shrink-0 whitespace-nowrap',
      tone === 'inverse' && 'nav-link-inverse',
      vertical && 'min-h-14 w-full border-b border-s-0 border-border px-4',
      vertical && isActive && 'border-b-border bg-surface',
      isActive && 'active',
    )
  return (
    <nav aria-label={label} className={cn(vertical ? 'flex flex-col' : more.length ? '-mx-1 flex min-w-0 gap-1' : '-mx-1 flex min-w-0 gap-1 overflow-x-auto', className)}>
      {main.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate} className={linkClass}>
          {it.label}
        </NavLink>
      ))}
      {more.length > 0 && <NavMore items={more} label={moreLabel} tone={tone} />}
    </nav>
  )
}

/** Keyed on the pathname: a navigation remounts the menu closed (no setState in an effect). */
function NavMore(props) {
  const { pathname } = useLocation()
  return <NavMoreMenu key={pathname} pathname={pathname} {...props} />
}

function NavMoreMenu({ items, label, tone, pathname }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const id = useId()
  const current = items.find((it) => matchPath({ path: it.to, end: it.end ?? false }, pathname))
  // outside click and Esc close the menu
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={current ? `${label}: ${current.label}` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn('nav-link gap-1 whitespace-nowrap', tone === 'inverse' && 'nav-link-inverse', current && 'active')}
      >
        {current ? current.label : label}
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <ul id={id} hidden={!open} className="absolute end-0 top-full z-40 mt-1 min-w-48 rounded-card border border-border bg-background p-1 text-foreground shadow-lg">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn('flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-base hover:bg-muted hover:text-primary', isActive && 'bg-muted font-semibold')}
            >
              {it.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}
