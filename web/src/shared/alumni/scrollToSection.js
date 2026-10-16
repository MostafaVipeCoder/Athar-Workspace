/** Scroll to a section and move the focus there (a `#hash` link would only change the router location). Used by the completeness meter and by the forms (first invalid field); a deep link passes `{ smooth: false }` (the person asked to be THERE: an animation that a layout shift can interrupt is worse than a jump). */
export function scrollToSection(id, { smooth = true } = {}) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (!el) return
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView?.({ behavior: reduce || !smooth ? 'auto' : 'smooth', block: 'start' })
  el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

/** A short highlight of a section after a deep link ("fix this item" from the needs-attention queue): `data-highlight` is styled by `ProfileSection`; it clears itself. */
export function highlightSection(id, ms = 3500) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (!el) return
  el.setAttribute('data-highlight', 'true')
  setTimeout(() => el.removeAttribute('data-highlight'), ms)
}
