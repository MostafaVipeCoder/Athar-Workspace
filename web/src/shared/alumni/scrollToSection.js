/** Scroll to a section and move the focus there (a `#hash` link would only change the router location). Used by the completeness meter and by the forms (first invalid field). */
export function scrollToSection(id) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (!el) return
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}
