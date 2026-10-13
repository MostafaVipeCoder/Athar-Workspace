import { cn } from '../lib/cn.js'

/**
 * Button look (site + the owner's palette decision, 08 section 16). Kept out of Button.jsx so that file exports only
 * components (fast refresh) and so links can share the classes through `buttonClass`.
 *  - primary   = the site CTA: yellow fill, black text, radius 8, grow on hover (the only button athareg.com has);
 *  - secondary = Athar blue fill, white text (app-only derivation);
 *  - outline   = black 2px outline that fills black on hover; ghost = text with a soft grey hover; link = blue text;
 *  - destructive = the site error red with white text (text darkened on hover for contrast).
 * Yellow is used ONLY as a fill with black text, never as text on white.
 */
export const BUTTON_VARIANTS = {
  primary: 'bg-cta text-cta-foreground hover:brightness-95',
  secondary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border-2 border-foreground bg-transparent text-foreground hover:bg-foreground hover:text-background',
  ghost: 'bg-transparent text-foreground hover:bg-surface',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive-text',
  link: 'bg-transparent text-primary underline-offset-4 hover:underline',
}

export const BUTTON_SIZES = {
  sm: 'min-h-9 px-4 text-sm',
  md: 'min-h-11 px-6 text-base',
  lg: 'min-h-12 px-6 text-md font-bold',
  icon: 'min-h-11 min-w-11 p-0',
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold leading-none transition duration-300 ease-out hover-grow ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

/** Same look for a react-router <Link>/<a>: `className={buttonClass({ variant, size })}`. */
export function buttonClass({ variant = 'primary', size = 'md', className } = {}) {
  return cn(BASE, BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.primary, BUTTON_SIZES[size] ?? BUTTON_SIZES.md, variant === 'link' && 'hover:transform-none', className)
}
