import { cn } from '../../../lib/cn.js'

/**
 * Base for the brand (Font Awesome 5 Free) glyphs extracted from athareg.com (web/design-system/icons/).
 * The paths are in font units (y grows up), so one transform flips them into SVG space. Single colour through
 * `currentColor`; `size` in px (site: 50 decorative, 20 inline). Decorative by default (aria-hidden) - pass `title`
 * for a meaningful icon. Keep lucide-react for functional UI icons; use these only for brand spots.
 */
export function BrandIcon({ viewBox = '0 0 512 512', size = 20, className, title, children, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
      className={cn('inline-block shrink-0', className)}
      {...rest}
    >
      {title && <title>{title}</title>}
      <g transform="translate(0,448) scale(1,-1)">{children}</g>
    </svg>
  )
}
export default BrandIcon
