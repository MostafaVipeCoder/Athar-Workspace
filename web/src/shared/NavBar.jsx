import { NavLink } from 'react-router-dom'
import { cn } from '../lib/cn.js'

/**
 * Site-style nav: Manrope 17px black links, blue on hover, 2px yellow underline when active (`.nav-link`).
 * Horizontal (desktop header, scrolls instead of wrapping) or `vertical` (the mobile panel: full-width rows).
 * items: [{ to, label, end? }]; tone 'default' | 'inverse' (on black).
 */
export default function NavBar({ items, label, tone = 'default', vertical = false, onNavigate, className }) {
  return (
    <nav aria-label={label} className={cn(vertical ? 'flex flex-col' : '-mx-1 flex min-w-0 gap-1 overflow-x-auto', className)}>
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'nav-link shrink-0 whitespace-nowrap',
              tone === 'inverse' && 'nav-link-inverse',
              vertical && 'min-h-14 w-full border-b border-s-0 border-border px-4',
              vertical && isActive && 'border-b-border bg-surface',
              isActive && 'active',
            )
          }
        >
          {it.label}
        </NavLink>
      ))}
    </nav>
  )
}
