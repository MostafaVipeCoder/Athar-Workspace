/**
 * Copy text to the clipboard: the async Clipboard API (HTTPS / localhost), else a hidden textarea + execCommand (07 section 5.2:
 * "fallback execCommand or a selectable textarea"). Returns true when something was copied. Never throws.
 */
export async function copyText(value) {
  const text = String(value ?? '')
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* permission denied / insecure context: try the fallback */
  }
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.insetInlineStart = '-9999px'
  area.style.top = '0'
  document.body.appendChild(area)
  const active = document.activeElement
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  active?.focus?.()
  return ok
}

/** Web Share API available (https + a mobile-style OS sheet)? */
export const canNativeShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/** Can the browser hand a File to the OS share sheet (Instagram / WhatsApp story ...)? */
export function canShareFiles() {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
    return navigator.canShare({ files: [new File(['x'], 'athar.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}
