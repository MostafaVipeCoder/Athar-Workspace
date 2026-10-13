import { cn } from '../lib/cn.js'

import { colorFor, initialsOf, isLightColor } from '../lib/avatar.js'

/** Initials on the user's profile colour (see lib/avatar.js); black initials on light colours (yellow), white otherwise. */
export function Avatar({ name, id, color, src, size = 'md', className }) {
  const dim = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm'
  const px = size === 'sm' ? 32 : size === 'lg' ? 56 : 40
  if (src) return <img src={src} alt="" width={px} height={px} loading="lazy" decoding="async" className={cn('shrink-0 rounded-full object-cover ring-2 ring-background', dim, className)} />
  const bg = colorFor(id, color)
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: bg }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-2 ring-background', isLightColor(bg) ? 'text-black' : 'text-white', dim, className)}
    >
      {initialsOf(name)}
    </span>
  )
}
