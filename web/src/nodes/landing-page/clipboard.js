// the clipboard helper is shared (lib/clipboard.js): the Landing share dialog, the alumni pages and the diagnostics page all copy through it
export { copyText } from '../../lib/clipboard.js'

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
