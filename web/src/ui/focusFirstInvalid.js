/**
 * After a failed submit: move the focus to the FIRST field the form marked `aria-invalid="true"` (and bring it into view) so a keyboard / screen-reader user lands on the problem.
 * Call it after the errors were set (the DOM carries them one tick later): `setErrors(e); focusFirstInvalidSoon(formRef.current)`.
 */
export function focusFirstInvalid(root) {
  const el = root?.querySelector?.('[aria-invalid="true"]')
  if (!el) return false
  el.focus({ preventScroll: true })
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  return true
}

export function focusFirstInvalidSoon(root) {
  setTimeout(() => focusFirstInvalid(root), 0)
}
