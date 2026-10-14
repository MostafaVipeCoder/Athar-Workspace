import { Link } from 'react-router-dom'
import { cn } from '../lib/cn.js'
import { BRAND, LOGO_HEIGHT, LOGO_WIDTH } from '../lib/brand.js'

/**
 * The real Athar wordmark (black "athar" + yellow dot, web/public/brand/athar-logo.png) at the site's header size
 * 150x50. The site never shows the logo on dark surfaces and has no inverse file, so `inverse` renders the same PNG
 * on a white rounded pill. `size="sm"` = 120x40 for thin headers. Below `sm` the logo shrinks (120 / 110), and below 360px again (96 / 88) so the phone header
 * (logo + language + user + toggle) fits in 375px AND in 320px (the manager header's menu button was 7px off-screen there).
 */
export default function BrandMark({ to = '/', className, inverse = false, size = 'md' }) {
  const w = size === 'sm' ? 120 : LOGO_WIDTH
  const h = size === 'sm' ? 40 : LOGO_HEIGHT
  return (
    <Link to={to} className={cn('inline-flex shrink-0 items-center rounded-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', inverse && 'bg-white px-2 py-1', className)} aria-label="Athar">
      <img src={BRAND.logo} width={w} height={h} alt="Athar" decoding="async" fetchPriority="high" className={cn('block h-auto', size === 'sm' ? 'w-[88px] min-[360px]:w-[110px] sm:w-[120px]' : 'w-[96px] min-[360px]:w-[120px] sm:w-[150px]')} />
    </Link>
  )
}
