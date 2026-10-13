import { useMemo, useState } from 'react'
import { CalendarCheck, CalendarX, Clock, Copy, ExternalLink, Lock, Users } from 'lucide-react'
import './i18n.js'
import { EntityGrid } from '../../shared/entities/EntityGrid.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { Img } from '../../ui/Img.jsx'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { EmptyState } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { cn } from '../../lib/cn.js'
import { isEmail } from '../../lib/contact.js'
import { formatCalendarDate, formatDate, formatTime } from '../../lib/time/format.js'
import { describeTimeZone, resolveTimeZone } from '../../lib/time/tz.js'
import { groupByDay, providerEntity, visitorTimeZone } from './bookingConfig.js'

const pickBi = (v, lang) => (lang === 'ar' ? v?.ar || v?.en : v?.en || v?.ar) || ''

/**
 * The public booking page UI (design 01 section 6.3 "public per-provider page", mobile-first, bilingual) shared by
 * `/book/:ref/:host?` and the PM preview (View mode). Never fetches: `payload` = get_public_booking_page(); `onBook(slotId,
 * booker)` performs the anon RPC and resolves `{ ok, result }` or `{ ok: false, messageKey }`; `preview` disables booking.
 * Flow: provider (skipped when one) -> day pills -> free slot (project time + the visitor's local time) -> details ->
 * confirm -> success (Meet link when known at once, "will follow by e-mail" otherwise, cancel link once).
 */
export default function BookingPageView({ payload, host = null, prefill = null, onBook, preview = false, invite = null }) {
  const { t, lang, pick } = useLanguage()
  const tz = resolveTimeZone(payload?.timezone)
  const local = useMemo(() => visitorTimeZone(), [])
  const providers = useMemo(() => payload?.providers ?? [], [payload])
  // the visitor's own time is shown only when it differs from the project's wall clock for at least one offered slot
  const showLocal = useMemo(() => Boolean(local) && local !== tz && (payload?.slots ?? []).some((s) => formatTime(s.starts_at, { lang: 'en', tz }) !== formatTime(s.starts_at, { lang: 'en', tz: local })), [payload, local, tz])
  const [providerId, setProviderId] = useState(host && providers.some((p) => p.id === host) ? host : providers.length === 1 ? providers[0].id : null)
  const [day, setDay] = useState(null)
  const [slotId, setSlotId] = useState(null)
  const invitee = payload?.invitee ?? null
  const [form, setForm] = useState({ name: invitee?.name || prefill?.name || '', email: invitee?.email || prefill?.email || '', company: prefill?.company || '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState(null)
  const [done, setDone] = useState(null)

  // a payload refresh (focus refetch) may remove the slot we are holding: fall back gracefully
  const slots = useMemo(() => (payload?.slots ?? []).filter((s) => s.provider_id === providerId), [payload, providerId])
  const days = useMemo(() => groupByDay(slots, tz), [slots, tz])
  const dayIndex = day !== null && day < days.length ? day : 0
  const daySlots = days[dayIndex]?.slots ?? []
  const slot = slots.find((s) => s.id === slotId) ?? null
  const provider = providers.find((p) => p.id === providerId) ?? null
  const title = pickBi(payload?.config?.page?.title, lang) || pick(payload, 'name') || t('booking.public.title')
  const intro = pickBi(payload?.config?.page?.intro, lang) || t('booking.public.intro')

  if (!payload) return null
  if (done) {
    return (
      <PageShell title={title} intro={null}>
        <SuccessCard result={done} provider={done.providerSnap ?? provider} tz={tz} local={showLocal ? local : null} lang={lang} email={form.email} onAnother={() => { setDone(null); setSlotId(null); setServerError(null) }} />
      </PageShell>
    )
  }
  if (payload.status === 'invitation_required') {
    return (
      <PageShell title={title} intro={null}>
        <EmptyState icon={Lock} title={t('booking.public.invitationRequired')} body={t('booking.public.invitationRequiredBody')} />
      </PageShell>
    )
  }
  if (payload.status === 'already_booked') {
    const b = payload.booking
    return (
      <PageShell title={title} intro={null}>
        <div className="panel space-y-3 p-5" data-testid="already-booked">
          <h2 className="flex items-center gap-2 text-card-title font-bold"><CalendarCheck className="h-5 w-5 text-success" aria-hidden="true" />{t('booking.public.alreadyBooked')}</h2>
          <p className="text-sm text-muted-foreground">{t('booking.public.alreadyBookedBody')}</p>
          <TimeBlock startsAt={b.starts_at} endsAt={b.ends_at} tz={tz} local={showLocal ? local : null} lang={lang} />
          <p className="text-sm">{t('booking.public.with', { name: pick(b, 'provider_name') || '-' })}</p>
          {b.meet_link && <a href={b.meet_link} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-2 text-primary underline" dir="ltr"><ExternalLink className="h-4 w-4" aria-hidden="true" />{b.meet_link}</a>}
        </div>
      </PageShell>
    )
  }


  async function submit(e) {
    e.preventDefault()
    const errs = {}
    if (!form.name.trim()) errs.name = t('booking.public.nameRequired')
    if (!isEmail(form.email)) errs.email = t('booking.public.emailInvalid')
    setErrors(errs)
    if (Object.keys(errs).length || !slot || preview) return
    setBusy(true)
    setServerError(null)
    try {
      const r = await onBook(slot.id, { name: form.name.trim(), email: form.email.trim(), company_name: invitee ? undefined : form.company.trim() || undefined, lang }, invite)
      if (r?.ok) setDone({ ...r.result, starts_at: r.result?.starts_at ?? slot.starts_at, ends_at: r.result?.ends_at ?? slot.ends_at, providerSnap: provider })
      else {
        setServerError(r?.messageKey ? t(r.messageKey) : t('errors.unknown'))
        if (r?.messageKey === 'booking.err.slotUnavailable' || r?.messageKey === 'booking.err.slotTooSoon') setSlotId(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const errorLine = serverError ? <p className="rounded-md border border-destructive-text/40 bg-destructive/10 p-3 text-sm text-destructive-text" role="alert" data-testid="booking-error">{serverError}</p> : null

  return (
    <PageShell title={title} intro={intro}>
      {/* 1. provider */}
      {providers.length === 0 ? <EmptyState icon={Users} title={t('booking.public.noSlots')} body={t('booking.public.noSlotsBody')} /> : null}
      {providers.length > 1 && !provider && (
        <section className="space-y-3" data-testid="provider-step">
          <h2 className="text-card-title font-bold">{t('booking.public.providers')}</h2>
          <EntityGrid
            cards={providers.map((p) => ({ key: p.id, entity: providerEntity(p), show: ['image', 'title', 'subtitle', 'organization', 'bio'], actions: <Button size="sm" onClick={() => { setProviderId(p.id); setDay(null); setSlotId(null) }} data-testid={`choose-${p.id}`}>{t('booking.public.choose')}</Button> }))}
            emptyTitle={t('booking.public.noSlots')}
          />
        </section>
      )}
      {provider && (
        <>
          <section className="panel flex items-center gap-3 p-3" data-testid="provider-chosen">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-surface">
              {provider.photo_path && <Img src={publicImageUrl(provider.photo_path)} thumb={publicThumbUrl(provider.photo_path)} variant="thumb" alt="" aspect="1 / 1" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold" dir="auto">{pick(provider, 'name')}</p>
              <p className="text-sm text-primary" dir="auto">{pick(provider, 'title')}</p>
              <p className="text-xs text-muted-foreground" dir="auto">{pick(provider, 'organization')}</p>
            </div>
            {providers.length > 1 && <Button variant="ghost" size="sm" onClick={() => { setProviderId(null); setSlotId(null) }}>{t('booking.public.back')}</Button>}
          </section>

          {/* 2. day + slot */}
          <section className="space-y-3" data-testid="slot-step">
            <h2 className="text-card-title font-bold">{t('booking.public.slots')}</h2>
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground" data-testid="zone-note">
              {showLocal ? (
                <>
                  <span>{t('booking.public.projectTime')}: <bdi dir="ltr">{describeTimeZone(tz, lang)}</bdi></span>
                  <span>{t('booking.public.localTime')}: <bdi dir="ltr">{describeTimeZone(local, lang)}</bdi></span>
                </>
              ) : <span>{t('booking.public.sameZone')} <bdi dir="ltr">{describeTimeZone(tz, lang)}</bdi></span>}
            </p>
            {!slot && errorLine}
            {days.length === 0 ? <EmptyState icon={Clock} title={t('booking.public.noSlots')} body={t('booking.public.noSlotsBody')} /> : (
              <>
                {days.length > 1 && (
                  <nav aria-label={t('booking.public.days')}>
                    <ul className="flex gap-2 overflow-x-auto pb-1" role="tablist">
                      {days.map((d, i) => (
                        <li key={d.date} role="presentation" className="shrink-0">
                          <button type="button" role="tab" aria-selected={i === dayIndex} onClick={() => { setDay(i); setSlotId(null) }} className={cn('tap-target rounded-md border px-4 py-1.5 text-sm font-semibold transition-colors duration-300', i === dayIndex ? 'border-transparent bg-primary text-primary-foreground' : 'border-input bg-background hover:border-foreground')} data-testid="day-pill">
                            {formatCalendarDate(d.date, { lang, style: 'medium' })}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}
                {days.length === 1 && <p className="text-sm font-semibold">{formatCalendarDate(days[0].date, { lang, style: 'full' })}</p>}
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" aria-label={t('booking.public.slots')}>
                  {daySlots.map((s) => {
                    const active = s.id === slotId
                    return (
                      <li key={s.id}>
                        <button type="button" aria-pressed={active} onClick={() => { setSlotId(s.id); setServerError(null) }} className={cn('tap-target flex w-full flex-col items-center rounded-md border px-2 py-2 text-sm transition-colors duration-300', active ? 'border-transparent bg-cta text-cta-foreground' : 'border-input bg-background hover:border-foreground')} data-testid="slot-button">
                          <span className="font-semibold tabular-nums">{formatTime(s.starts_at, { lang, tz })} - {formatTime(s.ends_at, { lang, tz })}</span>
                          {showLocal && <span className="text-xs opacity-80 tabular-nums">{formatTime(s.starts_at, { lang, tz: local })} - {formatTime(s.ends_at, { lang, tz: local })}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>

          {/* 3. details + confirm */}
          {slot && (
            <form onSubmit={submit} className="panel space-y-4 p-5" data-testid="booking-form" noValidate>
              <h2 className="text-card-title font-bold">{t('booking.public.form')}</h2>
              <div className="rounded-md bg-surface p-3 text-sm">
                <span className="block text-xs font-medium text-muted-foreground">{t('booking.public.selected')}</span>
                <TimeBlock startsAt={slot.starts_at} endsAt={slot.ends_at} tz={tz} local={showLocal ? local : null} lang={lang} />
                <span className="block">{t('booking.public.with', { name: pick(provider, 'name') })}</span>
              </div>
              {invitee && (
                <p className="text-sm"><span className="font-medium">{t('booking.public.companyFixed')}:</span> <span dir="auto">{pick(invitee, 'company') || '-'}</span></p>
              )}
              <Field label={t('booking.public.name')} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name} autoComplete="name" required />
              <Field label={t('booking.public.email')} type="email" dir="ltr" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} error={errors.email} autoComplete="email" required />
              {!invitee && <Field label={t('booking.public.company')} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} autoComplete="organization" />}
              {errorLine}
              <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy} disabled={preview} data-testid="confirm-booking">{busy ? t('booking.public.booking') : t('booking.public.confirm')}</Button>
            </form>
          )}
        </>
      )}
    </PageShell>
  )
}

function PageShell({ title, intro, children }) {
  return (
    <div className="mx-auto max-w-container space-y-6 px-4 py-6" data-testid="booking-page">
      <header className="space-y-1">
        <h1 className="text-page-title font-display" dir="auto">{title}</h1>
        {intro && <p className="text-muted-foreground" dir="auto">{intro}</p>}
      </header>
      {children}
    </div>
  )
}

function TimeBlock({ startsAt, endsAt, tz, local, lang }) {
  // date on its own line, the time range isolated (bdi) so the dash never flips in RTL
  const range = (zone) => <bdi className="tabular-nums">{formatTime(startsAt, { lang, tz: zone })} – {formatTime(endsAt, { lang, tz: zone })}</bdi>
  return (
    <div className="space-y-0.5" data-testid="time-block">
      <p className="font-semibold">{formatDate(startsAt, { lang, tz, style: 'full' })}</p>
      <p className="font-semibold">{range(tz)} <span className="text-xs font-normal text-muted-foreground"><bdi dir="ltr">({tz})</bdi></span></p>
      {local && <p className="text-xs text-muted-foreground">{range(local)} <bdi dir="ltr">({local})</bdi></p>}
    </div>
  )
}

function SuccessCard({ result, provider, tz, local, lang, email, onAnother }) {
  const { t, pick } = useLanguage()
  const [copied, setCopied] = useState(false)
  const cancelUrl = result.cancelUrl ?? null
  async function copy() {
    try { await navigator.clipboard.writeText(cancelUrl); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <div className="panel space-y-4 p-5" data-testid="booking-success">
      <h2 className="flex items-center gap-2 text-card-title font-bold"><CalendarCheck className="h-6 w-6 text-success" aria-hidden="true" />{t('booking.public.successTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('booking.public.successBody', { email })}</p>
      <TimeBlock startsAt={result.starts_at} endsAt={result.ends_at} tz={tz} local={local} lang={lang} />
      {provider && <p className="text-sm">{t('booking.public.with', { name: pick(provider, 'name') })}</p>}
      {result.meet_link ? (
        <p className="text-sm"><span className="font-medium">{t('booking.public.meetLink')}:</span> <a href={result.meet_link} target="_blank" rel="noopener noreferrer" className="text-primary underline" dir="ltr">{result.meet_link}</a></p>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="meet-later">{t('booking.public.meetLater')}</p>
      )}
      {cancelUrl && (
        <div className="space-y-1 rounded-md bg-surface p-3 text-sm">
          <p className="font-medium"><CalendarX className="me-1 inline h-4 w-4" aria-hidden="true" />{t('booking.public.cancelLink')}</p>
          <p className="text-xs text-muted-foreground">{t('booking.public.cancelLinkHint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded-xs bg-background px-2 py-1 text-xs" dir="ltr">{cancelUrl}</code>
            <Button size="sm" variant="outline" onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" />{copied ? t('booking.settings.copied') : t('booking.public.copyCancel')}</Button>
          </div>
        </div>
      )}
      {onAnother && <Button variant="ghost" size="sm" onClick={onAnother}>{t('booking.public.bookAnother')}</Button>}
    </div>
  )
}
