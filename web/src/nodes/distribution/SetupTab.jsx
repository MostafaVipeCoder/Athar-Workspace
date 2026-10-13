import { Fragment, useState } from 'react'
import { ArrowDown, ArrowUp, Building2, ChevronDown, Lock, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { EmptyState, Loading } from '../../ui/States.jsx'
import { Avatar } from '../../ui/Avatar.jsx'
import { cn } from '../../lib/cn.js'
import { WithdrawnChip } from '../../shared/entities/WithdrawnChip.jsx'
import { formatCalendarDate } from '../../lib/time/format.js'
import { formatHHMM, to12h } from '../../lib/time/slots.js'
import { publicThumbUrl } from '../../data/storage.js'
import { effectiveDay, emptyDay, pickMentoringSlot, totalFromEnd, windowFromAgendaSlot } from './distributionLogic.js'

const bi = (v, lang) => (v?.[lang] || v?.en || v?.ar || '')
const scheduleLabel = (s, lang, t) => bi(s.name, lang) || (s.date ? formatCalendarDate(s.date, { lang }) : t('distribution.day', { n: s.sortOrder }))

/**
 * Setup (Edit mode, design 01 section 3.7 "Edit-mode config"): the round (slot duration, ONE per-day gap, total = slots + gaps), the days
 * (their date comes from the connected Agenda `schedule` BY REFERENCE, else an own date: decision 02-12), who mentors on which day
 * (the connected mentors list by reference) with each mentor's availability (window, max per day, room) and the unique-pairing option.
 * Everything here is a client draft saved by the frame's Save (ONE save_node with `children`; the server validates and the revision
 * check applies). Generation reads the SAVED state, so unsaved edits are never silently ignored (as-is BUG-13): Generate saves first.
 */
export default function SetupTab({ draft, setDraft, errors, model, mentorCands, companyCands, mentorsStatus, companiesStatus, schedule, sharedBookings = [] }) {
  const { t, lang } = useLanguage()
  const confirm = useConfirm()
  const [openRule, setOpenRule] = useState(null)
  const scheduleDays = schedule.status === 'success' ? schedule.items : []
  const usedAgenda = new Set(draft.days.map((d) => d.agendaDayId).filter(Boolean))

  const patch = (p) => setDraft((d) => ({ ...d, ...p }))
  const patchSettings = (p) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...p } }))
  const patchDay = (i, p) => setDraft((d) => ({ ...d, days: d.days.map((x, k) => (k === i ? { ...x, ...p } : x)) }))
  const move = (i, step) => setDraft((d) => {
    const j = i + step
    if (j < 0 || j >= d.days.length) return d
    const days = [...d.days]
    ;[days[i], days[j]] = [days[j], days[i]]
    return { ...d, days }
  })
  async function removeDay(i) {
    const day = draft.days[i]
    const sessions = day.id ? model.sessions.filter((s) => s.dayId === day.id).length : 0
    if (sessions > 0 || day.mentorIds.length > 0) {
      const ok = await confirm({ title: t('distribution.setup.removeDayTitle'), message: t('distribution.setup.removeDayBody', { n: sessions }), destructive: true, confirmLabel: t('distribution.setup.removeDay') })
      if (!ok) return
    }
    patch({ days: draft.days.filter((_, k) => k !== i) })
  }
  const addDay = () => patch({ days: [...draft.days, { ...emptyDay({ start: draft.settings.start }), mentorIds: draft.days.at(-1)?.mentorIds ?? [] }] })
  const addAgendaDays = () => {
    const fresh = scheduleDays.filter((s) => !usedAgenda.has(s.id)).map((s) => {
      const first = pickMentoringSlot(s.slots)
      const w = first ? windowFromAgendaSlot(first) : null
      return { ...emptyDay({ start: draft.settings.start }), agendaDayId: s.id, start: w?.start ?? draft.settings.start, total: w?.total ?? 120, mentorIds: draft.days.at(-1)?.mentorIds ?? [] }
    })
    patch({ days: [...draft.days, ...fresh] })
  }
  const toggleMentor = (key, i, on) => patchDay(i, { mentorIds: on ? [...new Set([...draft.days[i].mentorIds, key])] : draft.days[i].mentorIds.filter((x) => x !== key) })
  const toggleAllForMentor = (key, on) => setDraft((d) => ({ ...d, days: d.days.map((x) => (x.locked ? x : { ...x, mentorIds: on ? [...new Set([...x.mentorIds, key])] : x.mentorIds.filter((m) => m !== key) })) }))
  const toggleAllForDay = (i, on, keys) => patchDay(i, { mentorIds: on ? [...new Set([...draft.days[i].mentorIds, ...keys])] : draft.days[i].mentorIds.filter((m) => !keys.includes(m)) })
  const patchRule = (key, p) => setDraft((d) => {
    const cur = d.rules[key] ?? { days: null, maxSlots: null, from: '', to: '', room: '' }
    return { ...d, rules: { ...d.rules, [key]: { ...cur, ...p } } }
  })

  // rows: connected mentors + mentors already used that are no longer in the connected list (kept visible: never silently dropped)
  const connectedKeys = new Set(mentorCands.map((c) => c.key))
  const rows = [
    ...mentorCands.map((c) => ({ key: c.key, name: c.name, sub: c.sub, image: c.item.entity?.imagePath ?? null, orphan: false })),
    ...[...new Set([...draft.days.flatMap((d) => d.mentorIds), ...Object.keys(draft.rules)])]
      .filter((k) => !connectedKeys.has(k))
      .map((k) => {
        const e = model.mentors.get(k)
        return { key: k, name: e?.name ?? { en: k.slice(0, 8), ar: '' }, sub: e?.sub ?? { en: '', ar: '' }, image: e?.image ?? null, orphan: true, withdrawn: Boolean(e?.withdrawn) }
      }),
  ].sort((a, b) => bi(a.name, lang).localeCompare(bi(b.name, lang), lang))

  return (
    <div className="space-y-8" data-testid="dist-setup">
      <section className="space-y-3" data-testid="setup-round">
        <h3 className="font-display text-card-title">{t('distribution.setup.round')}</h3>
        <p className="text-sm text-muted-foreground">{t('distribution.setup.roundHint')}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t('distribution.setup.slot')} type="number" min="1" dir="ltr" value={draft.settings.slotMinutes} onChange={(e) => patchSettings({ slotMinutes: e.target.value === '' ? '' : Number(e.target.value) })} error={errors['settings.slotMinutes'] && t(`distribution.${errors['settings.slotMinutes']}`)} data-testid="setup-slot" />
          <Field label={t('distribution.setup.gap')} type="number" min="0" dir="ltr" value={draft.settings.gapMinutes} onChange={(e) => patchSettings({ gapMinutes: e.target.value === '' ? '' : Number(e.target.value) })} error={errors['settings.gapMinutes'] && t(`distribution.${errors['settings.gapMinutes']}`)} data-testid="setup-gap" />
          <Field label={t('distribution.setup.start')} type="time" dir="ltr" value={draft.settings.start} onChange={(e) => patchSettings({ start: e.target.value })} error={errors['settings.start'] && t(`distribution.${errors['settings.start']}`)} data-testid="setup-start" />
          <label className="flex min-h-11 items-center gap-2 self-end text-sm">
            <input type="checkbox" className="h-4 w-4" checked={draft.settings.uniquePairing} onChange={(e) => patchSettings({ uniquePairing: e.target.checked })} data-testid="setup-unique" />
            <span>{t('distribution.setup.unique')}</span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t('distribution.setup.uniqueHint')}</p>
      </section>

      <section className="space-y-3" data-testid="setup-days">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-card-title">{t('distribution.setup.days')}</h3>
          <div className="flex flex-wrap gap-2">
            {scheduleDays.some((s) => !usedAgenda.has(s.id)) && <Button variant="outline" size="sm" onClick={addAgendaDays} data-testid="add-agenda-days"><Plus className="h-4 w-4" aria-hidden="true" />{t('distribution.setup.addAgendaDays')}</Button>}
            <Button variant="outline" size="sm" onClick={addDay} data-testid="add-day"><Plus className="h-4 w-4" aria-hidden="true" />{t('distribution.setup.addDay')}</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{scheduleDays.length ? t('distribution.setup.daysHintAgenda') : t('distribution.setup.daysHintOwn')}</p>
        {draft.days.length === 0 && <EmptyState icon={Building2} title={t('distribution.setup.noDays')} body={t('distribution.setup.noDaysBody')} />}
        <ul className="space-y-3">
          {draft.days.map((d, i) => {
            const eff = effectiveDay(d, draft.settings)
            const sched = d.agendaDayId ? scheduleDays.find((s) => s.id === d.agendaDayId) : null
            const locked = d.locked
            return (
              <li key={d.key} className={cn('rounded-card border border-border p-4', locked && 'bg-surface/60')} data-testid="setup-day" data-locked={locked || undefined}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold">{t('distribution.day', { n: i + 1 })}</h4>
                  {locked && <Badge tone="purple"><Lock className="h-3 w-3" aria-hidden="true" />{t('distribution.setup.locked')}</Badge>}
                  <span className="ms-auto flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('distribution.setup.moveUp')}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === draft.days.length - 1} aria-label={t('distribution.setup.moveDown')}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => removeDay(i)} disabled={locked} aria-label={t('distribution.setup.removeDay')} data-testid="remove-day"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </span>
                </div>
                {locked && <p className="mb-3 text-xs text-muted-foreground">{t('distribution.setup.lockedHint')}</p>}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {scheduleDays.length > 0 ? (
                    <Field as="select" label={t('distribution.setup.agendaDay')} value={d.agendaDayId ?? ''} disabled={locked} onChange={(e) => patchDay(i, { agendaDayId: e.target.value || null, ...(e.target.value ? { date: '' } : {}) })} data-testid="day-agenda">
                      <option value="">{t('distribution.setup.ownDate')}</option>
                      {scheduleDays.map((s) => <option key={s.id} value={s.id} disabled={usedAgenda.has(s.id) && s.id !== d.agendaDayId}>{scheduleLabel(s, lang, t)}{s.date ? ` (${s.date})` : ''}</option>)}
                    </Field>
                  ) : null}
                  {!d.agendaDayId && <Field label={t('distribution.setup.date')} type="date" dir="ltr" value={d.date} disabled={locked} onChange={(e) => patchDay(i, { date: e.target.value })} data-testid="day-date" />}
                  {d.agendaDayId && <div className="space-y-1.5 text-sm"><span className="block font-medium">{t('distribution.setup.date')}</span><p className="flex min-h-11 items-center rounded-input bg-surface px-3" dir="ltr" data-testid="day-agenda-date">{sched?.date ?? t('distribution.setup.noDate')}</p></div>}
                  <Field label={t('distribution.setup.dayStart')} type="time" dir="ltr" value={d.start || draft.settings.start} disabled={locked} onChange={(e) => patchDay(i, { start: e.target.value })} error={errors[`days.${i}.start`] && t(`distribution.${errors[`days.${i}.start`]}`)} data-testid="day-start" />
                  <Field label={t('distribution.setup.dayEnd')} type="time" dir="ltr" value={formatHHMM(eff.startMinutes + (Number(d.total) || 0))} disabled={locked} onChange={(e) => patchDay(i, { total: totalFromEnd(d.start || draft.settings.start, e.target.value) })} data-testid="day-end" />
                  <Field label={t('distribution.setup.total')} type="number" min="0" dir="ltr" value={d.total} disabled={locked} onChange={(e) => patchDay(i, { total: e.target.value === '' ? 0 : Number(e.target.value) })} error={errors[`days.${i}.total`] && t(`distribution.${errors[`days.${i}.total`]}`)} hint={t('distribution.setup.totalHint')} data-testid="day-total" />
                </div>
                {sched && sched.slots.length > 0 && !locked && (
                  <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{t('distribution.setup.fromSession')}</span>
                    <select className="min-h-11 rounded-input border border-input bg-input-bg px-3" value="" onChange={(e) => { const s = sched.slots.find((x) => x.id === e.target.value); if (s) patchDay(i, windowFromAgendaSlot(s)) }} data-testid="day-from-session">
                      <option value="">{t('distribution.setup.pickSession')}</option>
                      {sched.slots.map((s) => <option key={s.id} value={s.id}>{s.start}-{s.end} {bi(s.title, lang)}</option>)}
                    </select>
                  </label>
                )}
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer select-none font-medium">{t('distribution.setup.override')}</summary>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:max-w-md">
                    <Field label={t('distribution.setup.slot')} type="number" min="1" dir="ltr" placeholder={String(draft.settings.slotMinutes)} value={d.slotMinutes ?? ''} disabled={locked} onChange={(e) => patchDay(i, { slotMinutes: e.target.value === '' ? null : Number(e.target.value) })} error={errors[`days.${i}.slotMinutes`] && t(`distribution.${errors[`days.${i}.slotMinutes`]}`)} />
                    <Field label={t('distribution.setup.gap')} type="number" min="0" dir="ltr" placeholder={String(draft.settings.gapMinutes)} value={d.gapMinutes ?? ''} disabled={locked} onChange={(e) => patchDay(i, { gapMinutes: e.target.value === '' ? null : Number(e.target.value) })} error={errors[`days.${i}.gapMinutes`] && t(`distribution.${errors[`days.${i}.gapMinutes`]}`)} />
                  </div>
                </details>
                <p className="mt-3 rounded-md bg-surface px-3 py-2 text-sm" data-testid="day-summary" data-slots={eff.slots}>
                  {eff.slots > 0
                    ? t('distribution.setup.summary', { slots: eff.slots, start: to12h(eff.startMinutes, lang), end: to12h(eff.endMinutes, lang), mentors: d.mentorIds.length })
                    : t('distribution.setup.summaryNone')}
                </p>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-3" data-testid="setup-mentors">
        <h3 className="font-display text-card-title">{t('distribution.setup.mentors')}</h3>
        <p className="text-sm text-muted-foreground">{t('distribution.setup.mentorsHint')}</p>
        {sharedBookings.length > 0 && <p className="rounded-md bg-accent/30 px-3 py-2 text-sm" data-testid="booking-overlap">{t('distribution.setup.bookingOverlap', { names: sharedBookings.join(', ') })}</p>}
        {mentorsStatus === 'idle' && rows.length === 0 ? (
          <EmptyState title={t('distribution.setup.noMentorList')} body={t('distribution.setup.noMentorListBody')} />
        ) : mentorsStatus === 'loading' ? <Loading /> : rows.length === 0 ? (
          <EmptyState title={t('distribution.setup.noMentors')} body={t('distribution.setup.noMentorsBody')} />
        ) : draft.days.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('distribution.setup.mentorsNeedDays')}</p>
        ) : (
          <div className="relative overflow-x-auto rounded-card border border-border">
            <table className="w-full border-collapse text-sm" data-testid="mentor-table">
              <thead>
                <tr className="bg-surface">
                  <th scope="col" className="min-w-56 px-3 py-2 text-start font-semibold">{t('distribution.setup.mentor')}</th>
                  {draft.days.map((d, i) => {
                    const keys = rows.map((r) => r.key)
                    const all = keys.every((k) => d.mentorIds.includes(k))
                    return (
                      <th key={d.key} scope="col" className="px-3 py-2 text-center font-semibold">
                        <label className="flex flex-col items-center gap-1">
                          <span>{t('distribution.day', { n: i + 1 })}</span>
                          <input type="checkbox" className="h-4 w-4" checked={all} disabled={d.locked} onChange={(e) => toggleAllForDay(i, e.target.checked, keys)} aria-label={t('distribution.setup.allMentorsDay', { n: i + 1 })} data-testid="mentor-day-all" />
                        </label>
                      </th>
                    )
                  })}
                  <th scope="col" className="px-3 py-2 text-center font-semibold"><span className="sr-only">{t('distribution.setup.availability')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rule = draft.rules[r.key]
                  const hasRule = rule && (rule.maxSlots || rule.from || rule.to || rule.room || Array.isArray(rule.days))
                  const expanded = openRule === r.key
                  const allDays = draft.days.every((d) => d.locked || d.mentorIds.includes(r.key))
                  return (
                    <Fragment key={r.key}>
                      <tr className="border-t border-border" data-testid="mentor-row">
                        <th scope="row" className="px-3 py-2 text-start font-normal">
                          <span className="flex items-center gap-2">
                            <Avatar name={bi(r.name, lang)} id={r.key} src={r.image ? publicThumbUrl(r.image) : undefined} size="sm" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium" dir="auto">{bi(r.name, lang)}</span>
                              {bi(r.sub, lang) && <span className="block truncate text-xs text-muted-foreground" dir="auto">{bi(r.sub, lang)}</span>}
                              {r.withdrawn ? <WithdrawnChip data-testid="mentor-withdrawn" /> : r.orphan && <Badge tone="amber">{t('distribution.setup.orphan')}</Badge>}
                            </span>
                            <label className="ms-auto flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" className="h-4 w-4" checked={allDays} onChange={(e) => toggleAllForMentor(r.key, e.target.checked)} aria-label={t('distribution.setup.allDaysMentor', { name: bi(r.name, lang) })} />{t('distribution.setup.all')}</label>
                          </span>
                        </th>
                        {draft.days.map((d, i) => (
                          <td key={d.key} className="px-3 py-2 text-center">
                            <input type="checkbox" className="h-5 w-5" checked={d.mentorIds.includes(r.key)} disabled={d.locked} onChange={(e) => toggleMentor(r.key, i, e.target.checked)} aria-label={`${bi(r.name, lang)} - ${t('distribution.day', { n: i + 1 })}`} data-testid="mentor-day" />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center">
                          <Button variant={hasRule ? 'secondary' : 'ghost'} size="icon" onClick={() => setOpenRule(expanded ? null : r.key)} aria-expanded={expanded} aria-label={t('distribution.setup.availabilityOf', { name: bi(r.name, lang) })} data-testid="mentor-rule-toggle">
                            {hasRule ? <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />}
                          </Button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-surface/50">
                          <td colSpan={draft.days.length + 2} className="px-3 py-3">
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="mentor-rule">
                              <Field label={t('distribution.setup.from')} type="time" dir="ltr" value={rule?.from ?? ''} onChange={(e) => patchRule(r.key, { from: e.target.value })} error={errors[`rules.${r.key}.window`] && t(`distribution.${errors[`rules.${r.key}.window`]}`)} data-testid="rule-from" />
                              <Field label={t('distribution.setup.to')} type="time" dir="ltr" value={rule?.to ?? ''} onChange={(e) => patchRule(r.key, { to: e.target.value })} data-testid="rule-to" />
                              <Field label={t('distribution.setup.max')} type="number" min="1" dir="ltr" value={rule?.maxSlots ?? ''} onChange={(e) => patchRule(r.key, { maxSlots: e.target.value === '' ? null : Number(e.target.value) })} error={errors[`rules.${r.key}.max`] && t(`distribution.${errors[`rules.${r.key}.max`]}`)} hint={t('distribution.setup.maxHint')} data-testid="rule-max" />
                              <Field label={t('distribution.setup.room')} dir="auto" value={rule?.room ?? ''} maxLength={80} onChange={(e) => patchRule(r.key, { room: e.target.value })} hint={t('distribution.setup.roomHint')} data-testid="rule-room" />
                            </div>
                            {Array.isArray(rule?.days) && (
                              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                {t('distribution.setup.legacyDays', { days: rule.days.map((x) => x + 1).join(', ') || '-' })}
                                <Button variant="ghost" size="sm" onClick={() => patchRule(r.key, { days: null })}>{t('distribution.setup.clearLegacy')}</Button>
                              </p>
                            )}
                            <p className="mt-2 text-xs text-muted-foreground">{t('distribution.setup.ruleHint')}</p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3" data-testid="setup-companies">
        <h3 className="font-display text-card-title">{t('distribution.setup.companies')}</h3>
        {companiesStatus === 'idle' ? (
          <EmptyState title={t('distribution.setup.noCompanyList')} body={t('distribution.setup.noCompanyListBody')} />
        ) : companiesStatus === 'loading' ? <Loading /> : (
          <>
            <p className="text-sm" data-testid="company-count">{t('distribution.setup.companyCount', { n: companyCands.length })}</p>
            <p className="text-xs text-muted-foreground">{t('distribution.setup.companiesHint')}</p>
          </>
        )}
      </section>
    </div>
  )
}
