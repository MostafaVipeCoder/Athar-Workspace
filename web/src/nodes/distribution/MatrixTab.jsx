import { useMemo, useState } from 'react'
import { CalendarDays, Printer, Search } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Avatar } from '../../ui/Avatar.jsx'
import { Button } from '../../ui/Button.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { SELECT_CLASS } from '../../ui/Field.jsx'
import { cn } from '../../lib/cn.js'
import { to12h } from '../../lib/time/slots.js'
import { describeTimeZone, minutesOfDayInTz, todayInTz } from '../../lib/time/tz.js'
import { publicThumbUrl } from '../../data/storage.js'
import { buildMatrix, defaultDayId, dayEndMinutes, nameOf, normalizePayload } from './distributionLogic.js'
import { dayDate, dayLabel } from './dayLabels.js'
import { TimeRange } from './TimeRange.jsx'
import { useNow } from './useNow.js'

/**
 * The matrix (design 01 section 3.7 view "Distribution", as-is `MentoringMatrixView`): per day a grid of mentors (columns) x rounds
 * (rows) with the company in each cell. Read-only; the same component is the Agenda tab (`sessions-tab`), the public
 * `/view/:ref/matrix` page and the PM preview.
 *
 * CONTRACT for hosts: <MatrixTab data={payload.data} title audience timezone hideTitle /> where `data` is the DB payload of
 * `get_public_tab` / `get_distribution_view` (whitelisted). The PM preview passes the client `model` instead. Never fetches.
 * Rules: the day opened first is today in the PROJECT zone (else the next dated day); the round containing "now" is marked on today;
 * every day prints (landscape); a company can be highlighted to find its rooms; names come from the DB by reference.
 */
export default function MatrixTab({ data = null, model: modelProp = null, title, hideTitle = false, audience = 'public', showPrint = true }) {
  const { t, lang } = useLanguage()
  const model = useMemo(() => modelProp ?? normalizePayload(data), [modelProp, data])
  const now = useNow(30_000)
  const [picked, setPicked] = useState(null)
  const [focus, setFocus] = useState('')

  if (!model || model.days.length === 0 || model.sessions.length === 0) {
    return <EmptyState icon={CalendarDays} title={t('distribution.view.empty')} body={t('distribution.view.emptyBody')} />
  }
  const dayId = picked && model.days.some((d) => d.id === picked) ? picked : defaultDayId(model.days, model.tz, now)
  const today = todayInTz(model.tz, now)
  const companies = [...model.companies.values()].sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))

  return (
    <section className="dist-matrix space-y-4" data-testid="matrix-tab" data-audience={audience}>
      <style>{'@media print { @page { size: landscape; margin: 10mm } }'}</style>
      {title && !hideTitle && <h2 className="text-section-title">{title}</h2>}

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {model.days.length > 1 && (
          <nav aria-label={t('distribution.view.dayNav')} className="min-w-0 basis-full sm:flex-1 sm:basis-0">
            <ul className="flex gap-2 overflow-x-auto pb-1" role="tablist">
              {model.days.map((d) => {
                const active = d.id === dayId
                return (
                  <li key={d.id} role="presentation" className="shrink-0">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setPicked(d.id)}
                      className={cn('tap-target inline-flex flex-col items-center justify-center rounded-md border px-4 py-1.5 text-sm font-semibold transition-colors duration-300', active ? 'border-transparent bg-primary text-primary-foreground' : 'border-input bg-background text-foreground hover:border-foreground')}
                      data-testid="matrix-day-pill"
                    >
                      <span>{dayLabel(d, lang, t)}</span>
                      {d.date && <span className={cn('text-xs font-normal', active ? 'text-primary-foreground/85' : 'text-muted-foreground')}>{dayDate(d, lang)}</span>}
                      {d.date === today && <span className="sr-only">{t('distribution.view.today')}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">{t('distribution.view.highlight')}</span>
          <select value={focus} onChange={(e) => setFocus(e.target.value)} className={cn(SELECT_CLASS, 'min-h-11 w-56 max-w-full')} data-testid="matrix-highlight">
            <option value="">{t('distribution.view.highlight')}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{nameOf(c, lang)}</option>)}
          </select>
        </label>
        {showPrint && <Button variant="ghost" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden="true" />{t('distribution.view.print')}</Button>}
      </div>

      {model.days.map((d) => (
        <DayGrid key={d.id} model={model} dayId={d.id} hidden={d.id !== dayId} now={now} today={today} focus={focus} lang={lang} t={t} />
      ))}

      <p className="text-xs text-muted-foreground">{t('distribution.view.timezone', { tz: describeTimeZone(model.tz, lang) })}</p>
    </section>
  )
}

function DayGrid({ model, dayId, hidden, now, today, focus, lang, t }) {
  const mx = buildMatrix(model, dayId, lang)
  const { day } = mx
  const isToday = day.date === today
  const mins = isToday ? minutesOfDayInTz(now, model.tz) : null
  const nowIndex = mx.times.findIndex((s) => mins !== null && mins >= s.startMinutes && mins < s.endMinutes)
  const end = dayEndMinutes(day)
  return (
    <div role="tabpanel" className={cn(hidden && 'hidden print:block')} data-testid="matrix-day" data-day={day.id}>
      <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-card-title">{dayLabel(day, lang, t)}</h3>
        {day.date && <span className="text-sm text-muted-foreground">{dayDate(day, lang, 'full')}</span>}
        {isToday && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">{t('distribution.view.today')}</span>}
        <TimeRange start={day.startMinutes} end={end} lang={lang} className="text-sm text-muted-foreground" />
      </header>
      {mx.times.length === 0 || mx.mentorIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('distribution.view.dayEmpty')}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-card border border-border print:overflow-visible print:rounded-none">
          <table className="w-full border-collapse text-sm print:text-xs">
            <thead>
              <tr className="bg-surface">
                <th scope="col" className="sticky start-0 z-10 min-w-24 border-b border-e border-border bg-surface px-3 py-2 text-start font-semibold">{t('distribution.view.time')}</th>
                {mx.mentorIds.map((m) => {
                  const e = model.mentors.get(m)
                  return (
                    <th key={m} scope="col" className="min-w-36 border-b border-border px-3 py-2 text-start align-bottom font-semibold" data-testid="matrix-mentor">
                      <span className="flex items-center gap-2">
                        <Avatar name={nameOf(e, lang)} id={m} src={e?.image ? publicThumbUrl(e.image) : undefined} size="sm" className="print:hidden" />
                        <span className="min-w-0">
                          <span className="block truncate" dir="auto">{nameOf(e, lang)}</span>
                          {e?.room && <span className="block truncate text-xs font-normal text-muted-foreground" dir="auto">{e.room}</span>}
                        </span>
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {mx.times.map((s) => (
                <tr key={s.index} className={cn('border-b border-border last:border-b-0', nowIndex === s.index && 'bg-accent/25')} data-testid="matrix-row" data-now={nowIndex === s.index || undefined}>
                  <th scope="row" className={cn('sticky start-0 z-10 border-e border-border px-3 py-2 text-start font-semibold tabular-nums', nowIndex === s.index ? 'bg-accent/25' : 'bg-background')} dir="ltr">
                    <span className="block">{to12h(s.startMinutes, lang)}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{to12h(s.endMinutes, lang)}</span>
                  </th>
                  {mx.mentorIds.map((m) => {
                    const cell = mx.cell(s.index, m)
                    const c = cell?.companyId ? model.companies.get(cell.companyId) : null
                    const hit = focus && cell?.companyId === focus
                    return (
                      <td key={m} className={cn('px-3 py-2 align-top', hit && 'bg-primary/10 font-bold ring-2 ring-inset ring-primary', focus && !hit && c && 'text-muted-foreground')} data-testid="matrix-cell" data-company={cell?.companyId ?? undefined}>
                        {c ? <span dir="auto">{nameOf(c, lang)}</span> : <span className="text-muted-foreground" aria-label={t('distribution.view.free')}>-</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
