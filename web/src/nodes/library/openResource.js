import { signedResourceUrl } from '../../data/library.js'
import { downloadName } from './libraryLogic.js'

/**
 * Open / download a private file through a SHORT-LIVED signed URL (03: never a public URL for a private bucket). The URL is
 * minted at click time, so an old page never holds a stale link; it is used once and dropped.
 */
export async function openFile(resource) {
  // opened synchronously inside the click so popup blockers allow it; the signed URL is put in once it exists
  const win = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null
  try {
    const url = await signedResourceUrl(resource.filePath)
    if (win) {
      win.opener = null
      win.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (e) {
    win?.close()
    throw e
  }
}

export async function downloadFile(resource, lang) {
  const url = await signedResourceUrl(resource.filePath, { download: downloadName(resource, lang) })
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
