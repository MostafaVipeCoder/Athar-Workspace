import { useState } from 'react'
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { SELECT_CLASS } from '../../ui/Field.jsx'
import { cn } from '../../lib/cn.js'
import { useDistributionMutations } from '../../data/distribution.js'
import { dayLabel } from './dayLabels.js'
import { dayTimes } from './distributionLogic.js'

/**
 * The PM-only remote of the shared timer (design 03 section 9.4: control only for project managers; as-is SEC-5 let ANY holder of the
 * public link broadcast PAUSE/RESET/ADJUST). Every button calls `distribution_timer_control`, which checks the caller is a project manager
 * of the node's project; visitors are never shown this component and have no function to call. The server stores timestamps; every screen
 * (this one included) computes the remaining time locally, so nothing is written per second.
 * Props: nodeId, model (client model, for the round picker), state (the timer payload), onState(next) to refresh the parent's cache.
 */
export default function TimerControls({ nodeId, model, state, onState }) {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const { timer } = useDistributionMutations(nodeId)
  const [busy, setBusy] = useState(false)
  const status = state?.status ?? 'idle'
  const hasRound = status !== 'idle'

  async function run(action, args = {}, okMessage = null) {
    setBusy(true)
    try {
      const next = await timer.mutateAsync({ action, args })
      onState?.(next)
      if (okMessage) toast.success(okMessage)
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  const rounds = model.days.flatMap((d) => dayTimes(d).map((s) => ({ value: `${d.id}|${s.index}`, label: `${dayLabel(d, lang, t)} - ${t('distribution.live.round', { n: s.index + 1 })} (${s.start}-${s.end})` })))
  const current = state?.day_id && state?.slot_index !== null && state?.slot_index !== undefined ? `${state.day_id}|${state.slot_index}` : ''

  const small = 'tap-target min-w-14'
  return (
    <div className="space-y-3 rounded-card border border-border bg-card p-4" data-testid="timer-controls">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 space-y-1.5">
          <span className="text-sm font-medium">{t('distribution.live.pickRound')}</span>
          <select
            value={current}
            onChange={(e) => {
              const [day_id, slot] = e.target.value.split('|')
              if (day_id) run('set_round', { day_id, slot_index: Number(slot) })
            }}
            className={cn(SELECT_CLASS)}
            disabled={busy || rounds.length === 0}
            data-testid="round-select"
          >
            <option value="">{t('distribution.live.noRound')}</option>
            {rounds.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={() => run('clear')} disabled={busy || !hasRound} data-testid="timer-clear"><Square className="h-4 w-4" aria-hidden="true" />{t('distribution.live.clear')}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('distribution.live.controls')}>
        <Button variant="outline" onClick={() => run('previous')} disabled={busy || !hasRound} data-testid="timer-prev"><SkipBack className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t('distribution.live.previous')}</span><span className="sr-only sm:hidden">{t('distribution.live.previous')}</span></Button>
        {status === 'running' ? (
          <Button onClick={() => run('pause')} disabled={busy} data-testid="timer-pause"><Pause className="h-4 w-4" aria-hidden="true" />{t('distribution.live.pause')}</Button>
        ) : (
          <Button onClick={() => run('start')} disabled={busy || !hasRound} data-testid="timer-start"><Play className="h-4 w-4" aria-hidden="true" />{t('distribution.live.start')}</Button>
        )}
        <Button variant="outline" onClick={() => run('next', { run: status === 'running' })} disabled={busy || !hasRound} data-testid="timer-next"><SkipForward className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t('distribution.live.next')}</span><span className="sr-only sm:hidden">{t('distribution.live.next')}</span></Button>
        <Button variant="outline" onClick={() => run('reset')} disabled={busy || !hasRound} data-testid="timer-reset"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('distribution.live.reset')}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('distribution.live.adjust')}>
        <span className="text-sm text-muted-foreground">{t('distribution.live.adjust')}</span>
        {[[-60, '-1:00'], [-10, '-0:10'], [10, '+0:10'], [60, '+1:00']].map(([s, label]) => (
          <Button key={s} variant="outline" size="sm" className={small} onClick={() => run('adjust', { seconds: s })} disabled={busy || !hasRound} data-testid={`timer-adjust-${s}`}><span dir="ltr">{label}</span></Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('distribution.live.controlsHint')}</p>
    </div>
  )
}
