import { useMemo, useState } from 'react'
import { AlertTriangle, Download, Eye, EyeOff, GripVertical, Info, Lock, LockOpen, Pin, Printer, RefreshCw, Shuffle, XCircle } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { Avatar } from '../../ui/Avatar.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { Field, SELECT_CLASS } from '../../ui/Field.jsx'
import { cn } from '../../lib/cn.js'
import { WithdrawnChip } from '../../shared/entities/WithdrawnChip.jsx'
import { to12h } from '../../lib/time/slots.js'
import { publicThumbUrl } from '../../data/storage.js'
import { exportWorkbook } from '../../lib/export/xlsx.js'
import { dayDate, dayLabel } from './dayLabels.js'
import { TimeRange } from './TimeRange.jsx'
import { buildMatrix, dayEndMinutes, defaultDayId, distributionSheets, nameOf, validateTimetable, withdrawnIdsOf } from './distributionLogic.js'
import { summarizeUnmatched } from './matching.js'

const SEVERITY_ICON = { error: XCircle, warning: AlertTriangle, info: Info }

/**
 * Timetable (Edit mode, design 01 section 3.7): generate / regenerate with the ONE algorithm (`matching.js`), the matrix of each day with
 * manual edits (drag a company onto another cell = swap or move; click a cell to assign / clear), lock a day (generation never overwrites
 * it), publish, Excel, print. Every manual edit is ONE `set_distribution_session_companies` call validated by the server and offers Undo
 * (the inverse change). Sessions have DB ids from creation (as-is BUG-3: edits to id-less sessions were never persisted).
 */
export default function TimetableTab({ model, rules, companyIds, onGenerate, generating, lastResult, mutations, seedState, hasCompanies }) {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const [picked, setPicked] = useState(null)
  const [dragFrom, setDragFrom] = useState(null)
  const [editing, setEditing] = useState(null)
  const [focus, setFocus] = useState('')
  const [showIssues, setShowIssues] = useState(false)
  const { seed, setSeed, fixed, setFixed } = seedState

  const dayId = picked && model.days.some((d) => d.id === picked) ? picked : defaultDayId(model.days, model.tz)
  const withdrawnIds = useMemo(() => withdrawnIdsOf(model), [model])
  const report = useMemo(() => validateTimetable({ days: model.days, sessions: model.sessions, rules, uniquePairing: model.config.uniquePairing, companyIds, withdrawn: withdrawnIds }), [model, rules, companyIds, withdrawnIds])
  const problemCells = useMemo(() => new Set(report.issues.filter((i) => i.severity !== 'info' && i.slotIndex !== null).map((i) => `${i.dayId}|${i.slotIndex}|${i.mentorId}`)), [report])
  const reasonByCell = useMemo(() => new Map((lastResult?.unmatched ?? []).map((u) => [`${u.dayId}|${u.slotIndex}|${u.mentorId}`, u.reason])), [lastResult])
  // companies offered to a cell and to the highlight: a withdrawn company can no longer be placed (the DB refuses it)
  const companies = [...model.companies.values()].filter((c) => !c.withdrawn).sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  const lockedCount = model.days.filter((d) => d.locked).length

  async function apply(changes, inverse, doneKey) {
    try {
      const res = await mutations.setCompanies.mutateAsync(changes)
      toast.success(t(doneKey), {
        action: { label: t('distribution.timetable.undo'), onClick: async () => {
          try { await mutations.setCompanies.mutateAsync(inverse); toast.info(t('distribution.timetable.undone')) } catch (e) { toast.error(t(e?.messageKey ?? 'errors.unknown')) }
        } },
        duration: 8000,
      })
      if (res?.warnings?.length) toast.warning(t('distribution.timetable.repeatWarning', { n: res.warnings.length }))
      return true
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
      return false
    }
  }
  const snap = (s) => ({ session_id: s.id, company_item_id: s.companyId, is_manual_override: s.manual })

  function dropOn(target, source) {
    if (!source || source.id === target.id) return
    return apply(
      [{ session_id: target.id, company_item_id: source.companyId }, { session_id: source.id, company_item_id: target.companyId }],
      [snap(target), snap(source)],
      target.companyId && source.companyId ? 'distribution.timetable.swapped' : 'distribution.timetable.moved',
    )
  }
  function assign(cell, companyId) {
    if (companyId === (cell.companyId ?? '')) return Promise.resolve(true)
    if (!companyId) return apply([{ session_id: cell.id, company_item_id: null }], [snap(cell)], 'distribution.timetable.cleared')
    const other = model.sessions.find((s) => s.dayId === cell.dayId && s.slot === cell.slot && s.id !== cell.id && s.companyId === companyId)
    if (other) return apply([{ session_id: cell.id, company_item_id: companyId }, { session_id: other.id, company_item_id: cell.companyId }], [snap(cell), snap(other)], 'distribution.timetable.swapped')
    return apply([{ session_id: cell.id, company_item_id: companyId }], [snap(cell)], 'distribution.timetable.assigned')
  }

  async function toggleLock(day) {
    try {
      await mutations.setLock.mutateAsync({ dayId: day.id, locked: !day.locked })
      toast.success(t(day.locked ? 'distribution.timetable.unlocked' : 'distribution.timetable.lockedDone'))
    } catch (e) { toast.error(t(e?.messageKey ?? 'errors.unknown')) }
  }
  async function togglePublish() {
    try {
      await mutations.setPublished.mutateAsync(!model.published)
      toast.success(t(model.published ? 'distribution.timetable.unpublished' : 'distribution.timetable.published'))
    } catch (e) { toast.error(t(e?.messageKey ?? 'errors.unknown')) }
  }
  async function exportExcel() {
    try {
      const n = await exportWorkbook(distributionSheets(model, { lang, dayLabel: (d) => `${t('distribution.day', { n: d.index + 1 })}` }), `distribution-${(model.name.en || 'mentoring').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
      toast.success(t('distribution.timetable.exported', { n }))
    } catch (e) { toast.error(t(e?.messageKey ?? 'errors.unknown')) }
  }

  const summary = lastResult ? summarizeUnmatched(lastResult.unmatched) : null
  const filledTotal = model.sessions.filter((s) => s.companyId).length

  return (
    <div className="space-y-5" data-testid="dist-timetable">
      <style>{'@media print { @page { size: landscape; margin: 10mm } }'}</style>
      <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="timetable-toolbar">
        <Button onClick={() => onGenerate('all')} loading={generating === 'all'} disabled={Boolean(generating)} data-testid="generate"><Shuffle className="h-4 w-4" aria-hidden="true" />{t('distribution.timetable.generate')}</Button>
        <Button variant="secondary" onClick={() => onGenerate('unlocked')} loading={generating === 'unlocked'} disabled={Boolean(generating)} data-testid="regenerate"><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('distribution.timetable.regenerate')}</Button>
        <span className="ms-auto flex flex-wrap items-center gap-2">
          <Button variant={model.published ? 'outline' : 'primary'} size="sm" onClick={togglePublish} loading={mutations.setPublished.isPending} data-testid="publish-toggle" aria-pressed={model.published}>
            {model.published ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            {model.published ? t('distribution.timetable.unpublish') : t('distribution.timetable.publish')}
          </Button>
          <Button variant="ghost" size="sm" onClick={exportExcel} disabled={model.sessions.length === 0} data-testid="export"><Download className="h-4 w-4" aria-hidden="true" />{t('distribution.timetable.export')}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()} disabled={model.sessions.length === 0}><Printer className="h-4 w-4" aria-hidden="true" />{t('distribution.view.print')}</Button>
        </span>
      </div>
      <p className="text-xs text-muted-foreground print:hidden">{t('distribution.timetable.generateHint')}</p>
      <details className="text-sm print:hidden">
        <summary className="cursor-pointer select-none font-medium">{t('distribution.timetable.advanced')}</summary>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={fixed} onChange={(e) => setFixed(e.target.checked)} data-testid="seed-fixed" />{t('distribution.timetable.fixedSeed')}</label>
          <Field label={t('distribution.timetable.seed')} type="number" dir="ltr" value={seed} disabled={!fixed} onChange={(e) => setSeed(e.target.value === '' ? '' : Number(e.target.value))} className="w-40" data-testid="seed-input" />
          {model.config.seed ? <span className="text-xs text-muted-foreground">{t('distribution.timetable.lastSeed', { seed: model.config.seed })}</span> : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('distribution.timetable.seedHint')}</p>
      </details>

      {!model.published && model.sessions.length > 0 && <p className="rounded-md bg-accent/30 px-3 py-2 text-sm print:hidden" data-testid="unpublished-note">{t('distribution.timetable.unpublishedNote')}</p>}

      {lastResult && (
        <section className="rounded-card border border-border bg-surface/60 p-4 text-sm print:hidden" data-testid="generation-result">
          <p className="font-semibold">{t('distribution.timetable.resultTitle', { filled: lastResult.stats.filled, cells: lastResult.stats.cells })}</p>
          <p className="text-muted-foreground">{t('distribution.timetable.resultBody', { min: lastResult.stats.minMeetings, max: lastResult.stats.maxMeetings, seed: lastResult.stats.seed, locked: lockedCount })}</p>
          {lastResult.stats.unmatched > 0 && (
            <div className="mt-2" data-testid="unmatched-explain">
              <p className="font-semibold">{t('distribution.timetable.unmatchedTitle', { n: lastResult.stats.unmatched })}</p>
              <ul className="ms-5 list-disc">
                {Object.entries(summary).map(([reason, n]) => <li key={reason}>{t(`distribution.reason.${reason}`, { n })}</li>)}
              </ul>
            </div>
          )}
          {lastResult.droppedPins?.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('distribution.timetable.droppedPins', { n: lastResult.droppedPins.length })}</p>}
        </section>
      )}

      {model.sessions.length === 0 ? (
        <EmptyState icon={Shuffle} title={t('distribution.timetable.empty')} body={hasCompanies ? t('distribution.timetable.emptyBody') : t('distribution.timetable.emptyNeedsCompanies')} />
      ) : (
        <>
          <section className="print:hidden" data-testid="issues">
            <button type="button" className="flex items-center gap-2 text-sm font-semibold" onClick={() => setShowIssues((v) => !v)} aria-expanded={showIssues} data-testid="issues-toggle">
              {report.errors > 0 ? <XCircle className="h-4 w-4 text-destructive-text" aria-hidden="true" /> : report.warnings > 0 ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <Info className="h-4 w-4 text-primary" aria-hidden="true" />}
              {t('distribution.timetable.issuesSummary', { errors: report.errors, warnings: report.warnings, empty: report.unmatched, filled: filledTotal })}
            </button>
            {showIssues && (
              <ul className="mt-2 space-y-1 text-sm" data-testid="issues-list">
                {report.issues.slice(0, 60).map((i, k) => {
                  const Icon = SEVERITY_ICON[i.severity]
                  const day = model.days.find((d) => d.id === i.dayId)
                  return (
                    <li key={k} className="flex items-start gap-2" data-severity={i.severity}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t(`distribution.issue.${i.code}`, { day: day ? dayLabel(day, lang, t) : '', slot: i.slotIndex === null ? '' : i.slotIndex + 1, mentor: nameOf(model.mentors.get(i.mentorId), lang), company: nameOf(model.companies.get(i.companyId), lang), n: i.count ?? 0 })}</span>
                    </li>
                  )
                })}
                {report.issues.length === 0 && <li className="text-muted-foreground">{t('distribution.timetable.noIssues')}</li>}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3 print:hidden">
            {model.days.length > 1 && (
              <ul className="flex min-w-0 basis-full gap-2 overflow-x-auto pb-1 sm:flex-1 sm:basis-0" role="tablist" aria-label={t('distribution.view.dayNav')}>
                {model.days.map((d) => (
                  <li key={d.id} className="shrink-0" role="presentation">
                    <button type="button" role="tab" aria-selected={d.id === dayId} onClick={() => setPicked(d.id)} className={cn('tap-target inline-flex items-center gap-1.5 rounded-md border px-4 text-sm font-semibold', d.id === dayId ? 'border-transparent bg-primary text-primary-foreground' : 'border-input hover:border-foreground')} data-testid="timetable-day-pill">
                      {d.locked && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}{dayLabel(d, lang, t)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">{t('distribution.view.highlight')}</span>
              <select value={focus} onChange={(e) => setFocus(e.target.value)} className={cn(SELECT_CLASS, 'min-h-11 w-56 max-w-full')} data-testid="timetable-highlight">
                <option value="">{t('distribution.view.highlight')}</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{nameOf(c, lang)}</option>)}
              </select>
            </label>
          </div>

          {model.days.map((d) => (
            <DayGrid key={d.id} model={model} day={d} hidden={d.id !== dayId} focus={focus} problemCells={problemCells} reasonByCell={reasonByCell}
              dragFrom={dragFrom} setDragFrom={setDragFrom} onDrop={dropOn} onEdit={setEditing} onLock={toggleLock} onRegenerate={() => onGenerate('unlocked', [d.id])} generating={generating} lang={lang} t={t} />
          ))}
        </>
      )}

      <CellDialog cell={editing} model={model} companies={companies} onClose={() => setEditing(null)} onAssign={async (companyId) => { if (await assign(editing, companyId)) setEditing(null) }} lang={lang} t={t} />
    </div>
  )
}

function DayGrid({ model, day, hidden, focus, problemCells, reasonByCell, dragFrom, setDragFrom, onDrop, onEdit, onLock, onRegenerate, generating, lang, t }) {
  const mx = buildMatrix(model, day.id, lang)
  const locked = day.locked
  const filled = mx.filled
  const cellsTotal = model.sessions.filter((s) => s.dayId === day.id).length
  return (
    <section className={cn(hidden && 'hidden print:block', 'space-y-2')} data-testid="timetable-day" data-day={day.id} data-locked={locked || undefined}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-display text-card-title">{dayLabel(day, lang, t)}</h3>
        {day.date && <span className="text-sm text-muted-foreground">{dayDate(day, lang, 'full')}</span>}
        <TimeRange start={day.startMinutes} end={dayEndMinutes(day)} lang={lang} className="text-sm text-muted-foreground" />
        <Badge tone={locked ? 'purple' : 'neutral'}>{locked && <Lock className="h-3 w-3" aria-hidden="true" />}{t('distribution.timetable.dayCount', { filled, total: cellsTotal })}</Badge>
        <span className="ms-auto flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => onLock(day)} aria-pressed={locked} data-testid="lock-day">
            {locked ? <LockOpen className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}{locked ? t('distribution.timetable.unlock') : t('distribution.timetable.lock')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={locked || Boolean(generating)} data-testid="regenerate-day"><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('distribution.timetable.regenerateDay')}</Button>
        </span>
      </header>
      {locked && <p className="text-xs text-muted-foreground print:hidden">{t('distribution.timetable.lockedNote')}</p>}
      {mx.times.length === 0 || mx.mentorIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('distribution.view.dayEmpty')}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-card border border-border print:overflow-visible print:rounded-none">
          <table className="w-full border-collapse text-sm print:text-xs" data-testid="timetable-grid">
            <thead>
              <tr className="bg-surface">
                <th scope="col" className="sticky start-0 z-10 min-w-24 border-b border-e border-border bg-surface px-3 py-2 text-start font-semibold">{t('distribution.view.time')}</th>
                {mx.mentorIds.map((m) => {
                  const e = model.mentors.get(m)
                  return (
                    <th key={m} scope="col" className="min-w-40 border-b border-border px-3 py-2 text-start align-bottom font-semibold">
                      <span className="flex items-center gap-2">
                        <Avatar name={nameOf(e, lang)} id={m} src={e?.image ? publicThumbUrl(e.image) : undefined} size="sm" className="print:hidden" />
                        <span className="min-w-0"><span className="block truncate" dir="auto">{nameOf(e, lang)}</span>{e?.withdrawn && <WithdrawnChip />}{e?.room && <span className="block truncate text-xs font-normal text-muted-foreground" dir="auto">{e.room}</span>}</span>
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {mx.times.map((s) => (
                <tr key={s.index} className="border-b border-border last:border-b-0">
                  <th scope="row" className="sticky start-0 z-10 border-e border-border bg-background px-3 py-2 text-start font-semibold tabular-nums" dir="ltr">
                    <span className="block">{to12h(s.startMinutes, lang)}</span><span className="block text-xs font-normal text-muted-foreground">{to12h(s.endMinutes, lang)}</span>
                  </th>
                  {mx.mentorIds.map((m) => {
                    const cell = mx.cell(s.index, m)
                    const key = `${day.id}|${s.index}|${m}`
                    const company = cell?.companyId ? model.companies.get(cell.companyId) : null
                    const hit = focus && cell?.companyId === focus
                    const reason = reasonByCell.get(key)
                    if (!cell) return <td key={m} className="bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,hsl(var(--border))_6px,hsl(var(--border))_7px)] px-3 py-2 text-center text-muted-foreground" aria-label={t('distribution.timetable.unavailable')}>&nbsp;</td>
                    return (
                      <td
                        key={m}
                        className={cn('p-0 align-top', hit && 'bg-primary/10', dragFrom && dragFrom.id !== cell.id && !locked && 'outline-dashed outline-1 -outline-offset-2 outline-primary/40')}
                        onDragOver={(e) => { if (!locked && dragFrom) e.preventDefault() }}
                        onDrop={(e) => { e.preventDefault(); if (!locked) { const src = dragFrom; setDragFrom(null); onDrop(cell, src) } }}
                      >
                        <button
                          type="button"
                          draggable={!locked && Boolean(cell.companyId)}
                          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', cell.id); setDragFrom(cell) }}
                          onDragEnd={() => setDragFrom(null)}
                          onClick={() => !locked && onEdit(cell)}
                          disabled={locked}
                          aria-label={`${nameOf(model.mentors.get(m), lang)}, ${s.start}-${s.end}: ${company ? nameOf(company, lang) : t('distribution.timetable.freeCell')}`}
                          title={!company && reason ? t(`distribution.reason.${reason}`, { n: 1 }) : undefined}
                          className={cn('flex min-h-14 w-full items-start gap-1 px-3 py-2 text-start transition-colors', !locked && 'hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary', problemCells.has(key) && 'bg-destructive/10 ring-1 ring-inset ring-destructive', hit && 'font-bold ring-2 ring-inset ring-primary')}
                          data-testid="timetable-cell"
                          data-company={cell.companyId ?? undefined}
                          data-session={cell.id}
                        >
                          {company ? (
                            <>
                              {!locked && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground print:hidden" aria-hidden="true" />}
                              <span className="min-w-0 flex-1" dir="auto">{nameOf(company, lang)}{company.withdrawn && <WithdrawnChip className="ms-1" data-testid="cell-withdrawn" />}</span>
                              {cell.manual && <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-label={t('distribution.timetable.manual')} />}
                            </>
                          ) : (
                            <span className="text-muted-foreground">{t('distribution.timetable.freeCell')}</span>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Click on a cell: assign / swap / clear. A company already in another room at that time is offered as a swap. */
function CellDialog({ cell, model, companies, onClose, onAssign, lang, t }) {
  const [term, setTerm] = useState('')
  if (!cell) return null
  const day = model.days.find((d) => d.id === cell.dayId)
  const mentor = model.mentors.get(cell.mentorId)
  const busyBy = new Map(model.sessions.filter((s) => s.dayId === cell.dayId && s.slot === cell.slot && s.id !== cell.id && s.companyId).map((s) => [s.companyId, s]))
  const list = term.trim() ? companies.filter((c) => `${c.name.en} ${c.name.ar}`.toLowerCase().includes(term.trim().toLowerCase())) : companies
  const slot = day ? buildMatrix(model, day.id, lang)?.times[cell.slot] : null
  return (
    <Modal open onClose={() => { setTerm(''); onClose() }} title={t('distribution.timetable.cellTitle', { mentor: nameOf(mentor, lang) })} description={slot ? `${dayLabel(day, lang, t)} - ${to12h(slot.startMinutes, lang)} - ${to12h(slot.endMinutes, lang)}` : ''} closeLabel={t('common.close')}>
      <div className="space-y-3" data-testid="cell-dialog">
        <Field label={t('distribution.my.search')} type="search" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="cell-search" />
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-card border border-border">
          <li>
            <button type="button" className="tap-target flex w-full items-center justify-between px-3 py-2 text-start hover:bg-surface" onClick={() => onAssign(null)} data-testid="cell-clear">
              <span className="text-muted-foreground">{t('distribution.timetable.clearCell')}</span>
            </button>
          </li>
          {list.map((c) => {
            const other = busyBy.get(c.id)
            return (
              <li key={c.id}>
                <button type="button" className={cn('tap-target flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-surface', cell.companyId === c.id && 'bg-primary/10 font-semibold')} onClick={() => onAssign(c.id)} data-testid="cell-option">
                  <span className="min-w-0 truncate" dir="auto">{nameOf(c, lang)}</span>
                  {other && <span className="shrink-0 text-xs text-muted-foreground">{t('distribution.timetable.swapWith', { mentor: nameOf(model.mentors.get(other.mentorId), lang) })}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
