import { Activity, CircleCheck, Clock, TriangleAlert } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { formatDateTime } from '../../lib/time/format.js'
import { SENDER_LIMITS, senderUsage, workerHealth } from '../../lib/outbox.js'
import { useEmailHealth } from '../../data/outbox.js'

const nf = (lang, v) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US').format(v ?? 0)

/** "3 minutes" / "45 seconds" / "2 hours" / "1 day" as a duration (no "ago": the sentence adds the context). */
function duration(lang, seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const [unit, value] = s < 90 ? ['second', s] : s < 5400 ? ['minute', Math.round(s / 60)] : s < 129600 ? ['hour', Math.round(s / 3600)] : ['day', Math.round(s / 86400)]
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { style: 'unit', unit, unitDisplay: 'long' }).format(value)
}

function Tile({ label, value, tone = 'neutral', testid }) {
  return (
    <div className={cn('rounded-card border p-3', tone === 'warn' && 'border-accent bg-accent/30', tone === 'bad' && 'border-destructive/40 bg-destructive/5')} data-testid={testid}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-2xl font-extrabold tabular-nums">{value}</p>
    </div>
  )
}

function Meter({ ratio, label, text }) {
  const pct = Math.round(ratio * 100)
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{text}</span></div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-surface">
        <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-destructive-text' : pct >= 70 ? 'bg-accent' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * super_admin: the health of the whole e-mail queue (m62): is the worker running (and is the scheduler on), what is waiting and for how long, what is held back and
 * why, what failed in the last 24 h, and each sender against its two limits (30 a minute, 1,500 a day). Refreshes every 15 s while the tab is visible.
 */
export function EmailHealthPanel({ tz = 'Africa/Cairo' }) {
  const { t, lang } = useLanguage()
  const q = useEmailHealth()
  if (q.isPending) return <Loading />
  if (q.isError) return <ErrorState error={q.error} title={t('outbox.health.err')} onRetry={q.refetch} />
  const h = q.data
  const wh = workerHealth(h)
  const bad = wh === 'stalled' || wh === 'never'
  const s = h.worker?.summary ?? {}
  const blocked = Object.entries(h.blocked_by_reason ?? {})

  return (
    <div className="space-y-6" data-testid="email-health">
      <section className={cn('flex flex-wrap items-start gap-3 rounded-card border p-4', bad ? 'border-destructive/40 bg-destructive/5' : 'bg-card')} aria-labelledby="eh-worker" data-testid="health-worker" data-health={wh}>
        {bad ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive-text" aria-hidden="true" /> : wh === 'ok' ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success-text" aria-hidden="true" /> : <Activity className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="eh-worker" className="font-semibold">{t('outbox.health.worker')}</h2>
          <p className="text-sm" role="status">{t(`outbox.health.worker.${wh}`, { time: duration(lang, h.worker?.age_seconds) })}</p>
          {h.worker?.last_run_at && s && typeof s.sent === 'number' && <p className="text-xs text-muted-foreground">{t('outbox.health.worker.lastRun', { sent: s.sent ?? 0, failed: s.failed ?? 0, review: s.needs_review ?? 0, held: s.held ?? 0 })}</p>}
          {h.worker?.last_run_at && <p className="text-xs text-muted-foreground">{formatDateTime(h.worker.last_run_at, { lang, tz })}</p>}
        </div>
        <Badge tone={h.worker?.scheduler_enabled && h.worker?.cron_scheduled ? 'green' : 'amber'} data-testid="health-scheduler">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />{t(h.worker?.scheduler_enabled && h.worker?.cron_scheduled ? 'outbox.health.scheduler.on' : 'outbox.health.scheduler.offBadge')}
        </Badge>
        {!(h.worker?.scheduler_enabled && h.worker?.cron_scheduled) && (
          <div className="basis-full text-xs text-muted-foreground" data-testid="health-scheduler-off">
            <p>{t('outbox.health.scheduler.off')}</p>
            <details className="mt-1">
              <summary className="cursor-pointer">{t('outbox.health.scheduler.operator')}</summary>
              <p className="mt-1">{t('outbox.health.scheduler.operatorLocal')} <code dir="ltr" className="rounded bg-surface px-1">db/scripts/email-worker-schedule.sh enable</code></p>
              <p>{t('outbox.health.scheduler.operatorProd')}</p>
            </details>
          </div>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="eh-queue">
        <h2 id="eh-queue" className="font-semibold">{t('outbox.health.queue')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Tile label={t('outbox.health.queue.depth')} value={nf(lang, h.queue?.depth)} testid="tile-depth" />
          <Tile label={t('outbox.health.queue.ready')} value={nf(lang, h.queue?.ready)} testid="tile-ready" />
          <Tile label={t('outbox.health.queue.waiting')} value={nf(lang, h.queue?.waiting)} testid="tile-waiting" />
          <Tile label={t('outbox.health.queue.blocked')} value={nf(lang, h.queue?.blocked)} tone={h.queue?.blocked > 0 ? 'warn' : 'neutral'} testid="tile-blocked" />
          <Tile label={t('outbox.health.queue.sending')} value={nf(lang, h.queue?.sending)} testid="tile-sending" />
          <Tile label={t('outbox.health.queue.needs_review')} value={nf(lang, h.queue?.needs_review)} tone={h.queue?.needs_review > 0 ? 'warn' : 'neutral'} testid="tile-review" />
          <Tile label={t('outbox.health.queue.oldest')} value={h.queue?.oldest_age_seconds == null ? t('outbox.health.queue.oldestNone') : duration(lang, h.queue.oldest_age_seconds)} tone={h.queue?.oldest_age_seconds > 900 ? 'bad' : 'neutral'} testid="tile-oldest" />
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="eh-24">
        <h2 id="eh-24" className="font-semibold">{t('outbox.health.last24')}</h2>
        <div className="grid grid-cols-3 gap-2">
          <Tile label={t('outbox.health.last24.sent')} value={nf(lang, h.last_24h?.sent)} testid="tile-24-sent" />
          <Tile label={t('outbox.health.last24.failed')} value={nf(lang, h.last_24h?.failed)} tone={h.last_24h?.failed > 0 ? 'bad' : 'neutral'} testid="tile-24-failed" />
          <Tile label={t('outbox.health.last24.needs_review')} value={nf(lang, h.last_24h?.needs_review)} tone={h.last_24h?.needs_review > 0 ? 'warn' : 'neutral'} testid="tile-24-review" />
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="eh-blocked">
        <h2 id="eh-blocked" className="font-semibold">{t('outbox.health.blockedBy')}</h2>
        {blocked.length === 0 ? <p className="text-sm text-muted-foreground">{t('outbox.health.blockedBy.none')}</p> : (
          <ul className="space-y-1" data-testid="health-blocked">
            {blocked.map(([reason, n]) => (
              <li key={reason} className="flex items-start gap-2 rounded-md border bg-card p-2 text-sm"><Badge tone="amber" className="tabular-nums">{nf(lang, n)}</Badge><span>{t(`outbox.blocked.${reason}`)}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="eh-senders">
        <h2 id="eh-senders" className="font-semibold">{t('outbox.health.senders')}</h2>
        {(h.senders ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t('outbox.health.senders.empty')}</p> : (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="health-senders">
            {h.senders.map((x) => {
              const u = senderUsage(x)
              return (
                <li key={x.id} className="space-y-3 rounded-card border bg-card p-3" data-testid="health-sender" data-status={x.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all font-medium" dir="ltr">{x.email}</span>
                    <Badge tone={x.kind === 'system' ? 'purple' : 'outline'}>{t(x.kind === 'system' ? 'outbox.health.sender.system' : 'outbox.health.sender.user')}</Badge>
                    <Badge tone={x.status === 'active' ? 'green' : 'amber'}>{t(`outbox.health.sender.status.${x.status}`)}</Badge>
                  </div>
                  <Meter ratio={u.minuteRatio} label={t('outbox.health.sender.minute')} text={t('outbox.health.sender.limit', { used: nf(lang, u.minute), limit: nf(lang, SENDER_LIMITS.perMinute) })} />
                  <Meter ratio={u.dayRatio} label={t('outbox.health.sender.day')} text={t('outbox.health.sender.limit', { used: nf(lang, u.day), limit: nf(lang, SENDER_LIMITS.perDay) })} />
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                    {[['queued', x.queued], ['held', x.blocked], ['sent24', x.sent_24h], ['failed24', x.failed_24h]].map(([k, v]) => (
                      <div key={k}><dt className="text-muted-foreground">{t(`outbox.health.sender.${k}`)}</dt><dd className="font-semibold tabular-nums">{nf(lang, v)}</dd></div>
                    ))}
                  </dl>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{t('outbox.health.refresh')}</p>
    </div>
  )
}

export default EmailHealthPanel
