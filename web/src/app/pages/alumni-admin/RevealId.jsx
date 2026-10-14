import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { getAlumniFounder } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { cn } from '../../../lib/cn.js'
import { useAdminErrorText } from './hooks.js'
import './i18n.common.js'
import './reveal.i18n.js'

/** How long a revealed number stays on screen without another click (it hides itself; it is never cached, never in a URL or a query key). */
export const REVEAL_MS = 30_000

/**
 * A national ID as a manager sees it: MASKED (`**********1234`, from the server) with an explicit "Show" that asks the server for the full number (an AUDITED read:
 * who / when / which founder, never the number). The number lives only in this component's state: it hides again after 30 s, on "Hide" and on unmount, and it is not
 * copied anywhere. `hasId` false (no national ID) renders a dash.
 */
export default function RevealId({ masked, founderId, hasId = true, className, onRevealed }) {
  const { t } = useLanguage()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const [full, setFull] = useState(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function show() {
    setBusy(true)
    try {
      const r = await getAlumniFounder(founderId, { reveal: true })
      const value = r?.identity?.national_id ?? null
      setFull(value)
      onRevealed?.()
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setFull(null), REVEAL_MS)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  function hide() {
    clearTimeout(timer.current)
    setFull(null)
  }

  if (!hasId || !masked) return <span className={cn('text-muted-foreground', className)}>{t('alumni.admin.common.dash')}</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span dir="ltr" className="font-mono text-sm tabular-nums" data-testid="id-value">{full ?? masked}</span>
      {full === null ? (
        <button
          type="button"
          onClick={show}
          disabled={busy || !founderId}
          title={t('alumni.admin.reveal.logged')}
          aria-label={t('alumni.admin.reveal.show')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={hide}
          aria-label={t('alumni.admin.reveal.hide')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
