import { useMemo, useState } from 'react'
import { Ban, CalendarPlus, Trash2 } from 'lucide-react'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { biPick } from '../../lib/entities.js'
import { parseHHMM } from '../../lib/time/slots.js'
import { formatCalendarDate } from '../../lib/time/format.js'
import { toInstant, todayInTz } from '../../lib/time/tz.js'
import { cn } from '../../lib/cn.js'
import { confirmedBySlot, groupByDay, hhmm, planSlots, providerName, slotState, splitPlan } from './bookingConfig.js'

const STATE_TONE = { free: 'green', booked: 'blue', blocked: 'neutral', past: 'outline' }

/**
 * Availability of one provider: the generator (day from the connected Agenda `schedule` when present, else a date; from /
 * to / duration / gap -> lib/time/slots; instants built with toInstant in the PROJECT zone), a single-slot form, and the
 * slots grouped by day with their state (free / booked / blocked / past), block/unblock, delete with Undo (re-created).
 * Overlaps are previewed client-side and finally decided by the DB GiST guard (skipped, never an error).
 */
export default function SlotsTab({ rows, slots, bookings, schedule, config, tz, mutations: m, run }) {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const providers = useMemo(() => rows.filter((r) => r.provider?.is_active), [rows])
  const [providerId, setProviderId] = useState('')
  const effectiveId = providers.some((r) => r.provider.id === providerId) ? providerId : providers[0]?.provider.id ?? ''
  const current = providers.find((r) => r.provider.id === effectiveId) ?? null
  const agendaDays = useMemo(() => (schedule.status === 'success' ? schedule.items.filter((d) => d.date) : []), [schedule])
  const [dayId, setDayId] = useState('')
  const [date, setDate] = useState(() => todayInTz(tz))
  const [gen, setGen] = useState(() => ({ from: config.slotDefaults.from, to: config.slotDefaults.to, durationMin: config.slotDefaults.durationMin, gapMin: config.slotDefaults.gapMin }))
  const [single, setSingle] = useState({ start: '10:00', end: '10:30' })
  const [showPast, setShowPast] = useState(false)
  const [error, setError] = useState(null)

  const agendaDay = agendaDays.find((d) => d.id === dayId) ?? agendaDays[0] ?? null
  const effectiveDate = agendaDays.length ? agendaDay?.date ?? '' : date
  const ownSlots = useMemo(() => slots.filter((s) => s.provider_id === effectiveId), [slots, effectiveId])
  const bySlot = useMemo(() => confirmedBySlot(bookings), [bookings])
  const plan = useMemo(() => planSlots({ date: effectiveDate, from: gen.from, to: gen.to, durationMin: Number(gen.durationMin), gapMin: Number(gen.gapMin), tz }), [effectiveDate, gen, tz])
  const { fresh, overlapping } = useMemo(() => splitPlan(plan, ownSlots), [plan, ownSlots])
  const today = todayInTz(tz)
  const days = useMemo(() => groupByDay(ownSlots, tz).filter((d) => showPast || d.date >= today), [ownSlots, tz, showPast, today])
  const windowInvalid = parseHHMM(gen.from) === null || parseHHMM(gen.to) === null || parseHHMM(gen.to) <= parseHHMM(gen.from)

  const reportCreated = (r) => toast.success(t('booking.slots.generated', { created: r.created, overlapped: r.overlapped, invalid: r.invalid }))
  async function generate() {
    setError(null)
    if (!(Number(gen.durationMin) > 0)) { setError(t('booking.slots.durationInvalid')); return }
    if (windowInvalid) { setError(t('booking.slots.windowInvalid')); return }
    if (!fresh.length) return
    const r = await run(() => m.addSlots.mutateAsync({ providerId: effectiveId, slots: fresh.map((s) => ({ starts_at: s.startsAt, ends_at: s.endsAt })) }))
    if (r) reportCreated(r)
  }
  async function addSingle() {
    setError(null)
    const s = toInstant(effectiveDate, single.start, tz)
    const e = toInstant(effectiveDate, single.end, tz)
    if (!s || !e || e <= s) { setError(t('booking.slots.windowInvalid')); return }
    const r = await run(() => m.addSlots.mutateAsync({ providerId: effectiveId, slots: [{ starts_at: s.toISOString(), ends_at: e.toISOString() }] }))
    if (r) reportCreated(r)
  }
  /** Delete free slots (booked ones are never touched); Undo re-creates the same windows (new ids). */
  async function remove(list) {
    const free = list.filter((s) => !bySlot[s.id])
    if (!free.length) return
    const r = await run(() => m.deleteSlots.mutateAsync({ ids: free.map((s) => s.id) }))
    if (r === undefined) return
    toast.success(t('booking.slots.deleted', { count: free.length }), {
      action: { label: t('booking.slots.undo'), onClick: () => run(() => m.addSlots.mutateAsync({ providerId: effectiveId, slots: free.map((s) => ({ starts_at: s.starts_at, ends_at: s.ends_at })) })) },
    })
  }

  if (!providers.length) return <EmptyState icon={CalendarPlus} title={t('booking.slots.noProviders')} />

  return (
    <div className="space-y-5" data-testid="slots-tab">
      <p className="text-xs text-muted-foreground">{t('booking.slots.hint', { tz })}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field as="select" label={t('booking.slots.provider')} value={effectiveId} onChange={(e) => setProviderId(e.target.value)} data-testid="slots-provider">
          {providers.map((r) => <option key={r.provider.id} value={r.provider.id}>{providerName(r, lang)}</option>)}
        </Field>
        {agendaDays.length ? (
          <Field as="select" label={t('booking.slots.daySource.agenda')} value={agendaDay?.id ?? ''} onChange={(e) => setDayId(e.target.value)} data-testid="slots-day">
            {agendaDays.map((d) => <option key={d.id} value={d.id}>{biPick(d.name, lang) || formatCalendarDate(d.date, { lang })} · {formatCalendarDate(d.date, { lang })}</option>)}
          </Field>
        ) : (
          <Field label={t('booking.slots.date')} type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} data-testid="slots-date" />
        )}
      </div>

      <section className="panel space-y-3 p-4" data-testid="slot-generator">
        <h3 className="text-sm font-semibold">{t('booking.slots.generate')}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t('booking.slots.from')} type="time" dir="ltr" value={gen.from} onChange={(e) => setGen((g) => ({ ...g, from: e.target.value }))} data-testid="gen-from" />
          <Field label={t('booking.slots.to')} type="time" dir="ltr" value={gen.to} onChange={(e) => setGen((g) => ({ ...g, to: e.target.value }))} data-testid="gen-to" />
          <Field label={t('booking.slots.duration')} type="number" min="5" dir="ltr" value={gen.durationMin} onChange={(e) => setGen((g) => ({ ...g, durationMin: e.target.value }))} data-testid="gen-duration" />
          <Field label={t('booking.slots.gap')} type="number" min="0" dir="ltr" value={gen.gapMin} onChange={(e) => setGen((g) => ({ ...g, gapMin: e.target.value }))} data-testid="gen-gap" />
        </div>
        <p className="text-xs text-muted-foreground" data-testid="gen-preview">{plan.length ? t('booking.slots.preview', { count: fresh.length, skipped: overlapping.length }) : t('booking.slots.previewNone')}</p>
        {error && <p className="text-xs text-destructive-text" role="alert">{error}</p>}
        <div className="flex flex-wrap items-end gap-3">
          <Button size="sm" onClick={generate} disabled={!fresh.length || !effectiveDate} loading={m.addSlots.isPending} data-testid="gen-run"><CalendarPlus className="h-4 w-4" aria-hidden="true" />{t('booking.slots.generate')}</Button>
          <div className="ms-auto flex flex-wrap items-end gap-2">
            <Field label={t('booking.slots.singleStart')} type="time" dir="ltr" value={single.start} onChange={(e) => setSingle((s) => ({ ...s, start: e.target.value }))} className="w-32" />
            <Field label={t('booking.slots.singleEnd')} type="time" dir="ltr" value={single.end} onChange={(e) => setSingle((s) => ({ ...s, end: e.target.value }))} className="w-32" />
            <Button size="sm" variant="outline" onClick={addSingle} disabled={!effectiveDate} data-testid="single-add">{t('booking.slots.add')}</Button>
          </div>
        </div>
      </section>

      <section className="space-y-3" data-testid="slot-list">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{t('booking.slots.list', { name: current ? providerName(current, lang) : '' })}</h3>
          <label className="ms-auto flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />{t('booking.slots.showPast')}</label>
        </div>
        {!days.length ? <EmptyState title={t('booking.slots.empty')} /> : days.map((d) => (
          <div key={d.date} className="rounded-md border p-3" data-testid="slot-day">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="font-medium">{formatCalendarDate(d.date, { lang, style: 'full' })}</p>
              <span className="text-xs text-muted-foreground">{d.slots.length}</span>
              <Button variant="ghost" size="sm" className="ms-auto text-destructive" onClick={() => remove(d.slots)} disabled={!d.slots.some((s) => !bySlot[s.id])}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('booking.slots.deleteDay')}</Button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {d.slots.map((s) => {
                const state = slotState(s, bySlot)
                const b = bySlot[s.id]
                return (
                  <li key={s.id} className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-xs', state === 'past' && 'opacity-60')} data-testid="slot-row" data-state={state}>
                    <span className="font-medium tabular-nums" dir="ltr">{hhmm(s.starts_at, tz)}-{hhmm(s.ends_at, tz)}</span>
                    <Badge tone={STATE_TONE[state]}>{t(`booking.slots.state.${state}`)}</Badge>
                    {b && <span className="max-w-32 truncate" dir="auto" title={b.booker_email}>{b.booker_name || b.booker_email}</span>}
                    {state !== 'booked' && (
                      <>
                        <button type="button" className="tap-target rounded-sm px-1 hover:bg-surface" onClick={() => run(() => m.setSlotBlocked.mutateAsync({ slotId: s.id, blocked: !s.is_blocked }))} aria-label={`${t(s.is_blocked ? 'booking.slots.unblock' : 'booking.slots.block')} ${hhmm(s.starts_at, tz)}`}><Ban className={cn('h-3.5 w-3.5', s.is_blocked && 'text-destructive')} aria-hidden="true" /></button>
                        <button type="button" className="tap-target rounded-sm px-1 text-destructive hover:bg-surface" onClick={() => remove([s])} aria-label={`${t('booking.slots.delete')} ${hhmm(s.starts_at, tz)}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}
