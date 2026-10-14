import { useEffect, useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { cn } from '../../../lib/cn.js'
import './i18n.js'

/**
 * Section chips under the site header (phones first): one tap scrolls to a block, the chip of the block being read is marked.
 * A plain in-page navigation (no routing, no state in the URL). `sections` = [{ id, label }]. Shown by the page only when the
 * program has three or more blocks. `label` names the navigation for a page that is not a program (the Alumni pages). The marker follows the scroll through an IntersectionObserver where the browser has one.
 */
export default function SectionNav({ sections, label }) {
  const { t } = useLanguage()
  const [active, setActive] = useState(null)
  const idsKey = sections.map((s) => s.id).join('|')

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined
    const seen = new Map()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : null)
        const visible = [...seen.entries()].filter(([, top]) => top !== null).sort((a, b) => a[1] - b[1])
        if (visible.length) setActive(visible[0][0])
      },
      { rootMargin: '-140px 0px -55% 0px' },
    )
    for (const id of idsKey.split('|')) {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [idsKey])

  function go(id) {
    const el = document.getElementById(id)
    if (!el) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    setActive(id)
  }

  return (
    <nav aria-label={label ?? t('founder.nav.label')} className="sticky top-header z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur print:hidden" data-testid="section-nav">
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <button
              type="button"
              onClick={() => go(s.id)}
              aria-current={active === s.id ? 'true' : undefined}
              className={cn('tap-target inline-flex items-center rounded-full border px-4 text-sm font-semibold transition-colors duration-300', active === s.id ? 'border-transparent bg-primary text-primary-foreground' : 'border-input bg-background text-foreground hover:border-foreground')}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
