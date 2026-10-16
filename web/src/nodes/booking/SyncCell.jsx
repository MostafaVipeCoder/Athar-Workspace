import { CalendarCheck, ExternalLink, Plug, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { formatDateTime, formatRelative } from '../../lib/time/format.js'
import { ltr } from '../../lib/google.js'
import { MAX_SYNC_ATTEMPTS, SYNC_RETRYABLE, SYNC_TONE, googleCalendarEventUrl, syncProblemText } from './bookingConfig.js'

const isStalling = (key) => ['failed', 'dead', 'retrying', 'needs_connection', 'waiting_connection'].includes(key)

/**
 * What the shadow worker WOULD do for a pending job (the plan it logged: create / patch / delete / skip / park / fail), in plain words. Shown as a
 * collapsed <details> so a PM comparing the shadow week with the Apps Script poller can see the summary, the time in the project zone, the guests and the calendar.
 */
function PlanDetails({ plan, tz }) {
  const { t, lang } = useLanguage()
  const ev = plan.event
  return (
    <details className="text-xs" data-testid="sync-plan">
      <summary className="tap-target inline-flex cursor-pointer items-center text-primary underline-offset-4 hover:underline">{t('booking.sync.plan.title')}</summary>
      <ul className="mt-1 space-y-0.5 rounded-md bg-surface p-2">
        <li className="font-semibold" data-testid="sync-plan-action">{t(`booking.sync.plan.action.${plan.action}`)}{plan.skip ? `: ${t(`booking.sync.plan.skip.${plan.skip}`)}` : ''}{plan.code ? `: ${syncProblemText(t, plan.code)}` : ''}</li>
        {ev?.summary && <li dir="auto">{ev.summary}</li>}
        {ev?.start && <li className="tabular-nums">{t('booking.sync.plan.when')}: {formatDateTime(ev.start, { lang, tz })} ({ev.timeZone ?? tz})</li>}
        {ev && <li>{t('booking.sync.plan.attendees', { count: ev.attendee_count ?? ev.attendees?.length ?? 0 })}</li>}
        {ev?.meet && <li>{t(`booking.sync.plan.meet.${ev.meet}`)}</li>}
        {plan.calendar && <li data-testid="sync-plan-calendar">{t('booking.sync.plan.calendar')}: {ltr(plan.calendar)}</li>}
      </ul>
    </details>
  )
}

/**
 * The "Calendar" cell of one booking in the Bookings tab (design 07 section 2.2): the state badge (pending / syncing / retrying / synced / migrated /
 * shadow / off / needs a Google connection / failed ...), the problem in words with what to do, "Retry", "Connect Google", the Meet link and "Open in
 * Google Calendar", the account that holds the event, and in shadow mode the plan. `state` = syncState(...): { key, job, entry }.
 */
export default function SyncCell({ booking, state, tz, onRetry, retrying = false, nameOf }) {
  const { t, lang } = useLanguage()
  const entry = state.entry ?? null
  const code = entry?.code ?? null
  const calendarUrl = entry && ['synced', 'migrated', 'syncing', 'retrying'].includes(state.key) ? googleCalendarEventUrl(entry) : null
  const attempts = state.job?.attempts ?? 0
  const retryLabel = state.key === 'failed' || state.key === 'dead' ? t('booking.bookings.retry') : t('booking.sync.retryNow')
  return (
    <div className="min-w-40 space-y-1" data-testid="sync-cell" data-state={state.key}>
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={SYNC_TONE[state.key]} data-testid="sync-badge">{t(`booking.sync.${state.key}`)}</Badge>
        {state.key === 'retrying' && <span className="text-xs text-muted-foreground" data-testid="sync-attempt">{t('booking.sync.attempt', { n: attempts, max: MAX_SYNC_ATTEMPTS })}{state.job?.next_attempt_at ? ` · ${t('booking.sync.nextTry', { time: formatRelative(state.job.next_attempt_at, { lang }) })}` : ''}</span>}
      </div>
      {isStalling(state.key) && code && <p className="text-xs text-destructive-text" role="status" data-testid="sync-problem">{syncProblemText(t, code)}</p>}
      {isStalling(state.key) && !code && state.job?.error && !entry && <p className="text-xs text-destructive-text" title={state.job.error}>{state.job.error.slice(0, 60)}</p>}
      {entry?.calendar_email && ['synced', 'migrated', 'syncing', 'retrying'].includes(state.key) && <p className="break-words text-xs text-muted-foreground" data-testid="sync-calendar">{t('booking.sync.calendar', { email: ltr(entry.calendar_email) })}</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {SYNC_RETRYABLE.includes(state.key) && onRetry && (
          <Button size="sm" variant="ghost" className="min-h-11 lg:min-h-9" onClick={() => onRetry(booking)} loading={retrying} aria-label={`${retryLabel}: ${nameOf(booking)}`} data-testid="sync-retry">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />{retryLabel}
          </Button>
        )}
        {state.key === 'needs_connection' && (
          <Link to="/profile" className="tap-target inline-flex items-center gap-1 rounded-md px-2 text-xs font-semibold text-primary underline-offset-4 hover:underline" data-testid="sync-connect">
            <Plug className="h-4 w-4" aria-hidden="true" />{t('booking.sync.connectGoogle')}
          </Link>
        )}
        {booking.meet_link && (
          <a href={booking.meet_link} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 text-xs text-primary underline" dir="ltr" data-testid="sync-meet">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('booking.bookings.openMeet')}
          </a>
        )}
        {calendarUrl && (
          <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 text-xs text-primary underline" data-testid="sync-open-calendar">
            <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('booking.sync.openCalendar')}
          </a>
        )}
      </div>
      {state.key === 'shadow' && entry?.plan && <PlanDetails plan={entry.plan} tz={tz} />}
    </div>
  )
}
