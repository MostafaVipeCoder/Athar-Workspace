import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, Clock, UserRound } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { Img } from '../../ui/Img.jsx'
import { cn } from '../../lib/cn.js'
import { to12h } from '../../lib/time/slots.js'
import { formatCalendarDate } from '../../lib/time/format.js'
import { describeTimeZone, minutesOfDayInTz, resolveTimeZone, todayInTz } from '../../lib/time/tz.js'
import { publicImageUrl } from '../../data/storage.js'
import { defaultDayIndex, liveState, normalizeAgendaConfig, publicDays } from './agendaLogic.js'

/**
 * The Agenda node's contributed tab view (manifest.contributesViews 'agenda'): day pills + the sessions of one day.
 *
 * CONTRACT for hosts (the project view page, the agenda's own page, the founder page, the PM preview):
 *   <AgendaTab data={payload.data} title="..." audience="public|participant|pm" timezone={project.timezone} />
 * where `payload` = get_public_tab(ref, edgeId | null) and `data = { days, config, timezone }` (DB rows, whitelisted:
 * presenters already hidden when show_presenter is false). The component never fetches. For the PM preview pass the
 * client models instead: `days` (Day[]) + `config` (the node config) + `timezone`.
 * Rules: day pills only when there is more than one day; the day opened first is today in the PROJECT zone (else the next
 * upcoming day); the session containing "now" is marked, the next one too; bullets collapse behind "Details" and are all
 * printed; the whole agenda (every day) prints.
 */
const pickBi = (v, lang) => (lang === 'ar' ? v?.ar || v?.en : v?.en || v?.ar) || ''

/** Wall-clock "now" in the project zone, refreshed every 30 s while mounted (no socket; the as-is viewer polled too). */
function useNow(tz, intervalMs = 30_000) {
  const compute = () => ({ today: todayInTz(tz), minutes: minutesOfDayInTz(new Date(), tz) })
  const [now, setNow] = useState(compute)
  useEffect(() => {
    const id = setInterval(() => setNow(compute()), intervalMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `compute` closes over tz only
  }, [tz, intervalMs])
  return now
}

export default function AgendaTab({ data = null, days: daysProp = null, config: configProp = null, title, timezone, audience = 'public', hideTitle = false, printAll = true }) {
  const { t, lang } = useLanguage()
  const tz = resolveTimeZone(timezone ?? data?.timezone)
  const config = useMemo(() => normalizeAgendaConfig(configProp ?? data?.config ?? {}), [configProp, data])
  const days = useMemo(() => daysProp ?? publicDays(data?.days), [daysProp, data])
  const now = useNow(tz)
  const [picked, setPicked] = useState(null)
  const dayKey = days.map((d) => d.id).join(',')
  const [seenKey, setSeenKey] = useState(dayKey)
  if (seenKey !== dayKey) {
    setSeenKey(dayKey)
    setPicked(null)
  }
  const index = picked !== null && picked < days.length ? picked : defaultDayIndex(days, now.today)
  const accent = config.theme.accent
  const accentStyle = accent ? { '--agenda-accent': accent } : undefined

  if (!days.length) return <EmptyState icon={CalendarDays} title={t('agenda.view.empty')} body={t('agenda.view.emptyBody')} />

  const dayLabel = (d, i) => pickBi(d.name, lang) || (d.date ? formatCalendarDate(d.date, { lang, style: 'medium' }) : t('agenda.edit.day', { n: i + 1 }))

  return (
    <section className="space-y-4 agenda-tab" style={accentStyle} data-testid="agenda-tab" data-audience={audience}>
      {title && !hideTitle && <h2 className="text-section-title">{title}</h2>}

      {days.length > 1 && (
        <nav aria-label={t('agenda.view.dayNav')} className="sticky top-header z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur print:hidden">
          <ul className="flex gap-2 overflow-x-auto pb-1" role="tablist">
            {days.map((d, i) => {
              const active = i === index
              const isToday = Boolean(d.date) && d.date === now.today
              return (
                <li key={d.id} role="presentation" className="shrink-0">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setPicked(i)}
                    className={cn('tap-target inline-flex flex-col items-center justify-center rounded-md border px-4 py-1.5 text-sm font-semibold transition-colors duration-300', active ? 'border-transparent bg-[var(--agenda-accent,hsl(var(--primary)))] text-white' : 'border-input bg-background text-foreground hover:border-foreground')}
                    data-testid="day-pill"
                  >
                    <span>{config.showDayNames ? dayLabel(d, i) : t('agenda.edit.day', { n: i + 1 })}</span>
                    {config.showDayNames && d.date && pickBi(d.name, lang) && <span className={cn('text-xs font-normal', active ? 'text-white/85' : 'text-muted-foreground')}>{formatCalendarDate(d.date, { lang, style: 'medium' })}</span>}
                    {isToday && <span className="sr-only">{t('agenda.view.today')}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      {days.map((d, i) => (
        <DayPanel key={d.id} day={d} index={i} hidden={i !== index} printAll={printAll} label={dayLabel(d, i)} showDate={config.showDayNames} now={now} lang={lang} t={t} single={days.length === 1} />
      ))}

      <p className="text-xs text-muted-foreground">{t('agenda.view.timezone', { tz: describeTimeZone(tz, lang) })}</p>
      {config.footerPath && (
        <div className="print:hidden">
          <Img src={publicImageUrl(config.footerPath)} alt="" aspect="4 / 1" rounded fit="contain" />
        </div>
      )}
    </section>
  )
}

function DayPanel({ day, index, hidden, printAll, label, showDate, now, lang, t, single }) {
  const live = liveState(day, now.today, now.minutes)
  return (
    <div role="tabpanel" className={cn(hidden && 'hidden', hidden && printAll && 'print:block')} data-testid="day-panel" data-day={day.id}>
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-card-title">{single && !showDate ? t('agenda.edit.day', { n: index + 1 }) : label}</h3>
        {day.date && (showDate || single) && pickBi(day.name, lang) && <span className="text-sm text-muted-foreground">{formatCalendarDate(day.date, { lang, style: 'full' })}</span>}
        {live.isToday && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">{t('agenda.view.today')}</span>}
      </header>
      {day.slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agenda.edit.noSlots')}</p>
      ) : (
        <ol className="space-y-3">
          {day.slots.map((s, i) => (
            <SlotCard key={s.id} slot={s} state={live.nowIndex === i ? 'now' : live.nextIndex === i ? 'next' : null} lang={lang} t={t} />
          ))}
        </ol>
      )}
    </div>
  )
}

function SlotCard({ slot, state, lang, t }) {
  const [open, setOpen] = useState(false)
  const title = pickBi(slot.title, lang) || t('agenda.edit.untitledSlot')
  const presenter = slot.showPresenter ? pickBi(slot.presenter, lang) : ''
  const bullets = slot.bullets.map((b) => pickBi(b, lang)).filter(Boolean)
  return (
    <li
      className={cn('panel relative p-4 transition-colors duration-300 print:break-inside-avoid', state === 'now' && 'border-[var(--agenda-accent,hsl(var(--primary)))] shadow-dropdown ring-1 ring-[var(--agenda-accent,hsl(var(--primary)))]')}
      data-testid="slot-card"
      data-state={state ?? undefined}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <p className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--agenda-accent,hsl(var(--primary)))]" dir="ltr">
          <Clock className="h-4 w-4" aria-hidden="true" />
          <time>{to12h(slot.start, lang)}</time>
          <span aria-hidden="true">-</span>
          <time>{to12h(slot.end, lang)}</time>
        </p>
        {state === 'now' && <span className="rounded-full bg-[var(--agenda-accent,hsl(var(--primary)))] px-2 py-0.5 text-xs font-semibold text-white">{t('agenda.view.now')}</span>}
        {state === 'next' && <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-foreground">{t('agenda.view.next')}</span>}
      </div>
      <h4 className="mt-1 text-base font-bold" dir="auto">{title}</h4>
      {presenter && (
        <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground" dir="auto">
          <UserRound className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('agenda.view.presenter')}: </span>
          {presenter}
        </p>
      )}
      {bullets.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline print:hidden">
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')} aria-hidden="true" />
            {open ? t('agenda.view.hideDetails') : t('agenda.view.details')}
          </button>
          <ul className={cn('ms-5 mt-1 list-disc space-y-0.5 font-questrial text-sm leading-relaxed', open ? 'block' : 'hidden print:block')} dir="auto">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}
    </li>
  )
}
