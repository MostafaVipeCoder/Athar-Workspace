import { useState } from 'react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { formatRelative } from '../../lib/time/format.js'
import { useCalendarSyncMode, useCalendarSyncModeMutation } from '../../data/calendarSync.js'

const SYNC_MODE_OPTIONS = ['off', 'shadow', 'live']
const TONE = { off: 'neutral', shadow: 'amber', live: 'green' }

/**
 * Settings > Calendar: the platform-wide calendar sync mode (off | shadow | live) and when the worker last ran. EVERY staff account sees it; only a
 * super_admin gets the switch (the DB re-checks). Going live asks for a confirmation that says what changes (Google starts e-mailing invitations and the
 * Apps Script poller must be off), and the answer of the DB (`in_flight`) is shown when jobs are being processed right now.
 */
export default function CalendarSyncMode() {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const q = useCalendarSyncMode()
  const change = useCalendarSyncModeMutation()
  const [pick, setPick] = useState(null)
  if (q.isPending) return <p role="status" className="text-xs text-muted-foreground" data-testid="sync-mode-loading">…</p>
  if (q.isError || !q.data) return null
  const mode = q.data.mode
  const chosen = pick ?? mode

  async function apply() {
    if (chosen === mode) return
    if (chosen === 'live') {
      const ok = await confirm({ title: t('booking.sync.mode.confirmTitle'), message: t('booking.sync.mode.confirmBody'), destructive: true })
      if (!ok) return
    }
    try {
      const r = await change.mutateAsync(chosen)
      toast.success(t('booking.sync.mode.saved', { mode: t(`booking.sync.mode.${r?.mode ?? chosen}`) }))
      if (chosen === 'live' && r?.in_flight > 0) toast.info(t('booking.sync.mode.inFlight', { count: r.in_flight }))
      setPick(null)
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="sync-mode">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{t('booking.sync.mode.title')}</h4>
        <Badge tone={TONE[mode]} data-testid="sync-mode-badge">{t(`booking.sync.mode.${mode}`)}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{t('booking.sync.mode.intro')}</p>
      <p className="text-xs" data-testid="sync-mode-help">{t(`booking.sync.mode.help.${mode}`)}</p>
      <p className="text-xs text-muted-foreground" data-testid="sync-mode-lastrun">{q.data.last_run_at ? t('booking.sync.mode.lastRun', { time: formatRelative(q.data.last_run_at, { lang }) }) : t('booking.sync.mode.neverRun')}</p>
      {q.data.can_set ? (
        <fieldset className="space-y-1" data-testid="sync-mode-switch">
          <legend className="text-xs font-medium">{t('booking.sync.mode.change')}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {SYNC_MODE_OPTIONS.map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-2 rounded-md border border-input px-3 text-sm lg:min-h-9">
                <input type="radio" name="sync-mode" value={m} checked={chosen === m} onChange={() => setPick(m)} className="h-4 w-4" data-testid={`sync-mode-${m}`} />
                {t(`booking.sync.mode.${m}`)}
              </label>
            ))}
            <Button size="sm" onClick={apply} disabled={chosen === mode} loading={change.isPending} data-testid="sync-mode-apply">{t('booking.sync.mode.apply')}</Button>
          </div>
          {chosen !== mode && <p className="text-xs text-muted-foreground">{t(`booking.sync.mode.help.${chosen}`)}</p>}
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="sync-mode-readonly">{t('booking.sync.mode.readonly')}</p>
      )}
    </div>
  )
}
