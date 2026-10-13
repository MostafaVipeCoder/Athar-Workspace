import { useMemo, useState } from 'react'
import { Building2, CalendarClock, DoorOpen, UserRound } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Avatar } from '../../ui/Avatar.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { INPUT_CLASS } from '../../ui/Field.jsx'
import { cn } from '../../lib/cn.js'
import { to12h } from '../../lib/time/slots.js'
import { publicThumbUrl } from '../../data/storage.js'
import { dayDate, dayLabel } from './dayLabels.js'
import { TimeRange } from './TimeRange.jsx'
import { mentorMeetings, myMeetings, nameOf, normalizePayload } from './distributionLogic.js'
import { useNow } from './useNow.js'

const storageKey = (nodeId) => `athar.dist.me.${nodeId}`
const readChoice = (nodeId) => { try { return JSON.parse(window.localStorage.getItem(storageKey(nodeId)) ?? 'null') } catch { return null } }
const writeChoice = (nodeId, value) => { try { window.localStorage.setItem(storageKey(nodeId), JSON.stringify(value)) } catch { /* not remembered */ } }
const minutesBetween = (a, b) => Math.max(0, Math.round((b - a) / 60000))

/**
 * "My schedule / Who do I meet next" (docs/13 section 3 and 01 section 3.7): the Agenda tab a founder opens on a phone. Mobile-first.
 * Company mode: a company picker (or, for a signed-in founder participant, their own company preselected) -> the meeting happening NOW,
 * the NEXT one (mentor, room, time, minutes to go) and the whole list. Mentor mode: the companies a mentor meets, in order.
 * Contributed to the Agenda host through the tab contract (`my-meetings-tab`): <MyScheduleTab data audience timezone title hideTitle />
 * with `data` = the whitelisted payload of get_public_tab; the PM preview passes the client `model`. Never fetches. The choice of company
 * is remembered per device (localStorage, guarded). A day without a date cannot be placed on the clock: it is listed in order, no now/next.
 */
export default function MyScheduleTab({ data = null, model: modelProp = null, title, hideTitle = false, audience = 'public' }) {
  const { t, lang } = useLanguage()
  const model = useMemo(() => modelProp ?? normalizePayload(data), [modelProp, data])
  const now = useNow(30_000)
  const [mode, setMode] = useState('company')
  const [chosen, setChosen] = useState(undefined)
  const [mentorId, setMentorId] = useState('')
  const [term, setTerm] = useState('')
  const [changing, setChanging] = useState(false)

  if (!model || model.sessions.length === 0) return <EmptyState icon={CalendarClock} title={t('distribution.my.empty')} body={t('distribution.my.emptyBody')} />

  const own = model.myCompanyIds.find((id) => model.companies.has(id)) ?? null
  const stored = chosen === undefined ? readChoice(model.nodeId) : chosen
  const companyId = stored && model.companies.has(stored) ? stored : own
  const pick = (id) => { setChosen(id); writeChoice(model.nodeId, id); setChanging(false); setTerm('') }

  return (
    <section className="mx-auto max-w-2xl space-y-4" data-testid="my-schedule" data-audience={audience}>
      {title && !hideTitle && <h2 className="text-section-title">{title}</h2>}
      <div className="inline-flex rounded-md border border-input p-0.5" role="tablist" aria-label={t('distribution.my.mode')}>
        {['company', 'mentor'].map((k) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cn('tap-target inline-flex items-center gap-1.5 rounded-sm px-4 text-sm font-semibold', mode === k ? 'bg-primary text-primary-foreground' : 'hover:bg-surface')} data-testid={`my-mode-${k}`}>
            {k === 'company' ? <Building2 className="h-4 w-4" aria-hidden="true" /> : <UserRound className="h-4 w-4" aria-hidden="true" />}
            {t(`distribution.my.mode.${k}`)}
          </button>
        ))}
      </div>

      {mode === 'company' ? (
        <CompanyMode model={model} companyId={companyId} own={own} changing={changing} setChanging={setChanging} term={term} setTerm={setTerm} pick={pick} now={now} lang={lang} t={t} />
      ) : (
        <MentorMode model={model} mentorId={mentorId} setMentorId={setMentorId} lang={lang} t={t} />
      )}
    </section>
  )
}

function CompanyMode({ model, companyId, own, changing, setChanging, term, setTerm, pick, now, lang, t }) {
  const companies = [...model.companies.values()].sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  const matches = term.trim() ? companies.filter((c) => `${c.name.en} ${c.name.ar}`.toLowerCase().includes(term.trim().toLowerCase())) : companies
  const meetings = useMemo(() => myMeetings(model, companyId, now), [model, companyId, now])

  if (!companyId || changing) {
    return (
      <div className="space-y-3" data-testid="company-picker">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t('distribution.my.pickCompany')}</span>
          <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('distribution.my.search')} className={INPUT_CLASS} data-testid="company-search" />
        </label>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-card border border-border" data-testid="company-options">
          {matches.length === 0 && <li className="p-4 text-sm text-muted-foreground">{t('distribution.my.noMatch')}</li>}
          {matches.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => pick(c.id)} className="tap-target flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface" data-testid="company-option">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" dir="auto">{nameOf(c, lang)}</span>
                {c.id === own && <Badge tone="blue">{t('distribution.my.yours')}</Badge>}
              </button>
            </li>
          ))}
        </ul>
        {companyId && <Button variant="ghost" size="sm" onClick={() => setChanging(false)}>{t('common.cancel')}</Button>}
      </div>
    )
  }

  const company = model.companies.get(companyId)
  const { current, next, items } = meetings
  const undated = items.length > 0 && items.every((i) => i.state === 'undated')
  const allPast = items.length > 0 && items.every((i) => i.state === 'past')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-card-title" dir="auto" data-testid="my-company">
          <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
          {nameOf(company, lang)}
          {companyId === own && <Badge tone="blue">{t('distribution.my.yours')}</Badge>}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setChanging(true)} data-testid="change-company">{t('distribution.my.change')}</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t('distribution.my.none')} body={t('distribution.my.noneBody')} />
      ) : (
        <>
          {current && <MeetingCard item={current} tone="now" label={t('distribution.my.now')} extra={t('distribution.my.endsIn', { n: minutesBetween(now.getTime(), Date.parse(current.endsAt)) })} lang={lang} t={t} />}
          {next && <MeetingCard item={next} tone="next" label={t('distribution.my.next')} extra={t('distribution.my.startsIn', { n: minutesBetween(now.getTime(), Date.parse(next.startsAt)) })} lang={lang} t={t} />}
          {!current && !next && allPast && <p className="rounded-card border border-border bg-surface p-4 text-sm" data-testid="my-done">{t('distribution.my.done')}</p>}
          {undated && <p className="rounded-card border border-border bg-surface p-4 text-sm" data-testid="my-undated">{t('distribution.my.undated')}</p>}

          <h4 className="pt-2 text-sm font-semibold text-muted-foreground">{t('distribution.my.all', { n: items.length })}</h4>
          <ol className="space-y-2" data-testid="my-list">
            {items.map((i) => <MeetingRow key={`${i.day.id}-${i.slotIndex}`} item={i} lang={lang} t={t} />)}
          </ol>
        </>
      )}
    </div>
  )
}

function MeetingCard({ item, tone, label, extra, lang, t }) {
  const mentor = item.mentor
  return (
    <article className={cn('rounded-card border-2 p-4', tone === 'now' ? 'border-primary bg-primary/5' : 'border-border bg-card')} data-testid={`meeting-${tone}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={tone === 'now' ? 'blue' : 'neutral'}>{label}</Badge>
        <span className="text-sm text-muted-foreground">{extra}</span>
      </div>
      <div className="flex items-center gap-3">
        <Avatar name={nameOf(mentor, lang)} id={mentor?.id} src={mentor?.image ? publicThumbUrl(mentor.image) : undefined} size="lg" />
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight" dir="auto">{nameOf(mentor, lang)}</p>
          {mentor?.sub?.[lang] || mentor?.sub?.en ? <p className="truncate text-sm text-muted-foreground" dir="auto">{mentor.sub[lang] || mentor.sub.en}</p> : null}
        </div>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex items-center gap-1.5"><dt className="sr-only">{t('distribution.my.time')}</dt><CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><dd className="font-semibold tabular-nums"><TimeRange start={item.start} end={item.end} lang={lang} /></dd></div>
        {item.room && <div className="flex items-center gap-1.5"><dt className="sr-only">{t('distribution.my.room')}</dt><DoorOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><dd dir="auto" className="font-semibold">{item.room}</dd></div>}
      </dl>
    </article>
  )
}

function MeetingRow({ item, lang, t }) {
  return (
    <li className={cn('flex items-center gap-3 rounded-card border border-border p-3', item.state === 'past' && 'opacity-60', item.state === 'now' && 'border-primary bg-primary/5')} data-testid="my-row" data-state={item.state}>
      <div className="w-24 shrink-0 text-sm tabular-nums" dir="ltr">
        <p className="font-semibold">{to12h(item.start, lang)}</p>
        <p className="text-xs text-muted-foreground">{to12h(item.end, lang)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold" dir="auto">{nameOf(item.mentor, lang)}</p>
        <p className="truncate text-xs text-muted-foreground" dir="auto">
          {dayLabel(item.day, lang, t)}{item.day.date ? ` - ${dayDate(item.day, lang)}` : ` - ${t('distribution.my.noDate')}`}{item.room ? ` - ${item.room}` : ''}
        </p>
      </div>
      {item.state === 'now' && <Badge tone="blue">{t('distribution.my.now')}</Badge>}
      {item.state === 'next' && <Badge tone="neutral">{t('distribution.my.next')}</Badge>}
    </li>
  )
}

function MentorMode({ model, mentorId, setMentorId, lang, t }) {
  const mentors = [...model.mentors.values()].filter((m) => model.sessions.some((s) => s.mentorId === m.id)).sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  const selected = mentorId && model.mentors.has(mentorId) ? mentorId : ''
  const list = selected ? mentorMeetings(model, selected) : []
  const mentor = selected ? model.mentors.get(selected) : null
  return (
    <div className="space-y-3" data-testid="mentor-mode">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t('distribution.my.pickMentor')}</span>
        <select value={selected} onChange={(e) => setMentorId(e.target.value)} className={cn(INPUT_CLASS, 'select-chevron appearance-none pe-9')} data-testid="mentor-select">
          <option value="">{t('distribution.my.pickMentor')}</option>
          {mentors.map((m) => <option key={m.id} value={m.id}>{nameOf(m, lang)}</option>)}
        </select>
      </label>
      {mentor && (
        <>
          <div className="flex items-center gap-3">
            <Avatar name={nameOf(mentor, lang)} id={mentor.id} src={mentor.image ? publicThumbUrl(mentor.image) : undefined} size="lg" />
            <div className="min-w-0">
              <p className="text-lg font-bold" dir="auto">{nameOf(mentor, lang)}</p>
              {mentor.room && <p className="flex items-center gap-1 text-sm text-muted-foreground" dir="auto"><DoorOpen className="h-4 w-4" aria-hidden="true" />{mentor.room}</p>}
            </div>
          </div>
          <ol className="space-y-2" data-testid="mentor-list">
            {list.map((x) => (
              <li key={`${x.day.id}-${x.slotIndex}`} className="flex items-center gap-3 rounded-card border border-border p-3">
                <div className="w-24 shrink-0 text-sm tabular-nums" dir="ltr"><p className="font-semibold">{to12h(x.start, lang)}</p><p className="text-xs text-muted-foreground">{to12h(x.end, lang)}</p></div>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate font-semibold', !x.company && 'text-muted-foreground')} dir="auto">{x.company ? nameOf(x.company, lang) : t('distribution.my.free')}</p>
                  <p className="truncate text-xs text-muted-foreground">{dayLabel(x.day, lang, t)}{x.day.date ? ` - ${dayDate(x.day, lang)}` : ''}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
