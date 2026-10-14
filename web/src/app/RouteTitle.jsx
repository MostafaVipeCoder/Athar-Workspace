import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageProvider.jsx'

const BASE = 'Athar'
/** The title of a page = its heading (WCAG 2.4.2: tabs, history and screen readers must tell the pages apart). */
const titleOf = (heading) => `${heading} - ${BASE}`

/**
 * Sets `document.title` from the page's own first <h1> after every navigation or language change (the heading is rendered after the lazy chunk and the data arrive, so a MutationObserver
 * waits for it, for at most 4 s). A page that sets its OWN title (the public pages, `lib/meta.js` setPageMeta) is left alone: if the title changed since the navigation started, this does nothing.
 */
export default function RouteTitle() {
  const { pathname } = useLocation()
  const { lang } = useLanguage()
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const before = document.title
    const apply = () => {
      if (document.title !== before) return true // somebody else named the page: done
      const text = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim()
      if (!text) return false
      document.title = titleOf(text)
      return true
    }
    if (apply()) return undefined
    const observer = new MutationObserver(() => { if (apply()) observer.disconnect() })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    const timer = setTimeout(() => observer.disconnect(), 4000)
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [pathname, lang])
  return null
}
