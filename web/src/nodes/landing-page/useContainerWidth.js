import { useLayoutEffect, useState } from 'react'

/**
 * The width of an element, kept up to date (ResizeObserver, else window resize). The landing page decides its layout from ITS OWN
 * width (not the viewport) so the same component is correct as a full page, as a tab of the 750 px agenda page and inside the
 * editor's phone-sized live preview. `null` until the first measurement (jsdom reports 0: callers treat 0/null as "wide").
 */
export function useContainerWidth(ref) {
  const [width, setWidth] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

export const COMPACT_BELOW = 768
export const isCompactWidth = (w) => Boolean(w) && w < COMPACT_BELOW
