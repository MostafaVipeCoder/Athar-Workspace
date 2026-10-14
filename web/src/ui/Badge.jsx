import { cn } from '../lib/cn.js'

/**
 * Named tones so status colours are chosen once (list statuses, participant status, tombstones). The site has no
 * badges: tones are derived from the palette (blue primary, yellow = the brand "attention" fill with black text,
 * green/red = status, ink = dark neutral; `purple` kept as a key for stored list configs and mapped onto ink).
 */
// eslint-disable-next-line react-refresh/only-export-components
export const BADGE_TONES = {
  neutral: 'bg-surface text-foreground',
  blue: 'bg-primary/10 text-primary',
  green: 'bg-success/10 text-success-text',
  amber: 'bg-accent text-accent-foreground',
  red: 'bg-destructive/15 text-destructive-text',
  purple: 'bg-athar-ink text-white',
  outline: 'border border-input bg-background text-muted-foreground',
}

/** Small pill. `tone` is a key of BADGE_TONES (unknown -> neutral). */
export function Badge({ tone = 'neutral', className, children, ...rest }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold leading-5', BADGE_TONES[tone] ?? BADGE_TONES.neutral, className)} {...rest}>
      {children}
    </span>
  )
}
