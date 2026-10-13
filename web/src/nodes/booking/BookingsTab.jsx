import { useMemo, useState } from 'react'
import { CalendarClock, Download, ExternalLink, RefreshCw, XCircle } from 'lucide-react'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { EmptyState, Loading } from '../../ui/States.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { exportRows } from '../../lib/export/xlsx.js'
import { formatDateTime, formatTime } from '../../lib/time/format.js'
import { cn } from '../../lib/cn.js'
import { bookingColumns, confirmedBySlot, emailIndex, providerName, slotState, syncState } from './bookingConfig.js'

const SYNC_TONE = { synced: 'green', legacy: 'green', pending: 'blue', waiting_connection: 'amber', processing: 'blue', failed: 'red', dead: 'red', cancelled: 'neutral', none: 'outline' }
const EMAIL_TONE = { queued: 'blue', sending: 'blue', sent: 'green', failed: 'red', dead: 'red', cancelled: 'neutral', needs_review: 'amber' }
const FILTERS = ['upcoming', 'past', 'cancelled', 'all']

/**
 * Bookings of the node with the slot they hold, the calendar/Meet sync state from `integration_jobs` (design 07 section
 * 2.2: pending / waiting for a Google connection / synced / failed + retry), the outbox state of the confirmation and
 * cancellation e-mails, cancel (confirm + Undo = restore while the slot is free), reschedule (free slots of the same
 * provider), Meet link, Excel export. Interview mode also lists the invitations the Selection stage issued.
 */
export default function BookingsTab({ node, rows, slots, bookings, extras, loadingExtras, settings, tz, mutations: m, run }) {
  const { t, lang, pick } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const [filter, setFilter] = useState('upcoming')
  const [moving, setMoving] = useState(null)
  const slotById = useMemo(() => Object.fromEntries(slots.map((s) => [s.id, s])), [slots])
  const providerNames = useMemo(() => Object.fromEntries(rows.filter((r) => r.provider).map((r) => [r.provider.id, providerName(r, lang)])), [rows, lang])
  const emails = useMemo(() => emailIndex(extras?.emails ?? []), [extras])
  const bySlot = useMemo(() => confirmedBySlot(bookings), [bookings])
  const [now] = useState(() => Date.now()) // "upcoming / past" split as of mount; the lists refetch on focus anyway
  const list = useMemo(() => bookings.map((b) => {
    const s = slotById[b.slot_id]
    return { ...b, starts_at: s?.starts_at ?? null, ends_at: s?.ends_at ?? null, provider_id: s?.provider_id ?? null, company: b.booker_company_name ?? '' }
  }), [bookings, slotById])
  const sync = useMemo(() => Object.fromEntries(list.map((b) => [b.id, syncState(b, extras?.jobs ?? [], extras?.connections ?? [])])), [list, extras])
  const visible = list.filter((b) => {
    if (filter === 'cancelled') return b.status === 'cancelled'
    if (b.status === 'cancelled') return filter === 'all'
    const past = b.ends_at && new Date(b.ends_at).getTime() < now
    return filter === 'all' || (filter === 'past' ? past : !past)
  }).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
  const counts = { upcoming: list.filter((b) => b.status === 'confirmed' && !(b.ends_at && new Date(b.ends_at).getTime() < now)).length, past: list.filter((b) => b.status === 'confirmed' && b.ends_at && new Date(b.ends_at).getTime() < now).length, cancelled: list.filter((b) => b.status === 'cancelled').length, all: list.length }
  const nameOf = (b) => b.booker_name || b.booker_email

  async function cancel(b) {
    const ok = await confirm({ title: t('booking.bookings.cancelTitle', { name: nameOf(b) }), message: t('booking.bookings.cancelBody'), destructive: true })
    if (!ok) return
    const r = await run(() => m.cancel.mutateAsync({ bookingId: b.id }))
    if (r === undefined) return
    toast.success(t('booking.bookings.cancelled'), { action: { label: t('booking.bookings.undo'), onClick: () => run(() => m.restore.mutateAsync({ bookingId: b.id }), { success: t('booking.bookings.restored') }) } })
  }
  const freeSlotsOf = (providerId) => slots.filter((s) => s.provider_id === providerId && slotState(s, bySlot) === 'free')
  async function move(b, slotId) {
    const r = await run(() => m.reschedule.mutateAsync({ bookingId: b.id, slotId }), { success: t('booking.bookings.rescheduled') })
    if (r !== undefined) setMoving(null)
  }
  const retry = (b) => run(() => m.retrySync.mutateAsync({ bookingId: b.id }), { success: t('booking.bookings.retried') })
  const exportXlsx = () => run(async () => {
    const n = await exportRows(visible, bookingColumns(t, lang, { tz, providerNames, sync }), `${pick(node, 'name') || 'bookings'}`)
    toast.success(t('booking.bookings.exported', { count: n }))
  })
  const waiting = Object.values(sync).some((s) => s.key === 'waiting_connection')

  return (
    <div className="space-y-3" data-testid="bookings-tab">
      <p className="text-xs text-muted-foreground">{t('booking.bookings.hint')}</p>
      {waiting && <p className="rounded-md bg-accent/40 p-2 text-xs" data-testid="waiting-connection">{t('booking.sync.waitingHint')}</p>}
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t('booking.col.status')}>
        {FILTERS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn('tap-target rounded-md px-3 text-sm', filter === k ? 'bg-foreground text-background' : 'hover:bg-surface')} data-testid={`filter-${k}`}>
            {t(`booking.bookings.filter.${k}`)} ({counts[k]})
          </button>
        ))}
        <Button size="sm" variant="outline" className="ms-auto" onClick={exportXlsx} disabled={!visible.length}><Download className="h-4 w-4" aria-hidden="true" />{t('booking.bookings.export')}</Button>
      </div>
      {loadingExtras && <Loading />}
      {!visible.length ? <EmptyState title={t('booking.bookings.empty')} /> : (
        <div className="overflow-x-auto rounded-input border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-semibold uppercase text-athar-ink">
              <tr>
                <th className="p-2 text-start">{t('booking.col.booker')}</th>
                <th className="p-2 text-start">{t('booking.col.provider')}</th>
                <th className="p-2 text-start">{t('booking.col.when')}</th>
                <th className="p-2 text-start">{t('booking.col.status')}</th>
                <th className="p-2 text-start">{t('booking.col.sync')}</th>
                <th className="p-2 text-start">{t('booking.col.emails')}</th>
                <th className="p-2"><span className="sr-only">{t('booking.col.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => {
                const st = sync[b.id]
                const em = emails[b.id] ?? {}
                return (
                  <tr key={b.id} className="border-t align-top" data-testid="booking-row" data-status={b.status}>
                    <td className="p-2">
                      <p className="font-medium" dir="auto">{b.booker_name || '-'}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">{b.booker_email}</p>
                      {b.company && <p className="text-xs" dir="auto">{b.company}</p>}
                    </td>
                    <td className="p-2" dir="auto">{providerNames[b.provider_id] ?? '-'}</td>
                    <td className="p-2 tabular-nums">{b.starts_at ? <>{formatDateTime(b.starts_at, { lang, tz })} - {formatTime(b.ends_at, { lang, tz })}</> : '-'}</td>
                    <td className="p-2"><Badge tone={b.status === 'confirmed' ? 'green' : 'neutral'}>{t(`booking.status.${b.status}`)}</Badge></td>
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={SYNC_TONE[st.key]} data-testid="sync-badge">{t(`booking.sync.${st.key}`)}</Badge>
                        {st.job?.error && <span className="text-xs text-destructive-text" title={st.job.error}>{st.job.error.slice(0, 60)}</span>}
                        {(st.key === 'failed' || st.key === 'dead') && <Button size="sm" variant="ghost" onClick={() => retry(b)} aria-label={`${t('booking.bookings.retry')}: ${nameOf(b)}`}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('booking.bookings.retry')}</Button>}
                        {b.meet_link && <a href={b.meet_link} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 text-xs text-primary underline" dir="ltr"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('booking.bookings.openMeet')}</a>}
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(em).length === 0 ? <span className="text-xs text-muted-foreground">{t('booking.bookings.noEmails')}</span> : Object.entries(em).map(([k, v]) => (
                          <Badge key={k} tone={EMAIL_TONE[v.last?.status] ?? 'neutral'}>{t(`booking.email.${k}`)} · {t(`booking.emailStatus.${v.last?.status}`)}{v.count > 1 ? ` ×${v.count}` : ''}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-2">
                      {b.status === 'confirmed' && (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setMoving(b)} aria-label={`${t('booking.bookings.reschedule')}: ${nameOf(b)}`}><CalendarClock className="h-4 w-4" aria-hidden="true" />{t('booking.bookings.reschedule')}</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel(b)} aria-label={`${t('booking.bookings.cancel')}: ${nameOf(b)}`}><XCircle className="h-4 w-4" aria-hidden="true" />{t('booking.bookings.cancel')}</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {settings?.mode === 'interview' && extras?.invitations?.length > 0 && (
        <section className="space-y-1" data-testid="invitations">
          <h3 className="text-sm font-semibold">{t('booking.bookings.invitations')}</h3>
          <ul className="flex flex-wrap gap-1 text-xs">
            {extras.invitations.map((i) => (
              <li key={i.id}><Badge tone={i.used ? 'green' : i.revoked_at ? 'neutral' : 'blue'}>{pick(i, 'company') || i.email || i.booker_item_id.slice(0, 8)}{i.used ? ' ✓' : ''}</Badge></li>
            ))}
          </ul>
        </section>
      )}

      {moving && (
        <Modal open onClose={() => setMoving(null)} title={t('booking.bookings.rescheduleTitle', { name: nameOf(moving) })} description={t('booking.bookings.rescheduleBody')} closeLabel={t('common.close')}>
          {freeSlotsOf(moving.provider_id).length === 0 ? <EmptyState title={t('booking.bookings.rescheduleNone')} /> : (
            <ul className="grid grid-cols-2 gap-2">
              {freeSlotsOf(moving.provider_id).map((s) => (
                <li key={s.id}>
                  <button type="button" className="tap-target w-full rounded-md border border-input px-2 py-1 text-sm hover:border-foreground" onClick={() => move(moving, s.id)} data-testid="move-slot">
                    <span className="block text-xs text-muted-foreground">{formatDateTime(s.starts_at, { lang, tz, dateStyle: 'medium', timeStyle: 'short' })}</span>
                    <span className="font-medium tabular-nums">{formatTime(s.starts_at, { lang, tz })} - {formatTime(s.ends_at, { lang, tz })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  )
}
