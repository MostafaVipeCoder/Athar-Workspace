import { lazy, Suspense, useState } from 'react'
import { CalendarClock, CalendarPlus, CheckCircle2, Download, Lock, Pencil, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { getCompanyFigures, NO_DRAFT, useCompanyFigures, useQuarterMutations } from '../../data/alumniQuarters.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../ui/States.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { parseAlumniError } from '../../lib/alumni.js'
import { allDecided, findConflicts, keysToKeep } from '../../lib/alumniConflicts.js'
import { buildSnapshotPatch, snapshotToForm, validateSnapshotForm } from '../../lib/alumniForms.js'
import { METRICS, companySheetRows, daysLeft, needsUpdate, periodLabel, quarterSeries, statusTone } from '../../lib/alumniQuarters.js'
import { cn } from '../../lib/cn.js'
import { ConflictList } from './ConflictDialog.jsx'
import StampLine from './StampLine.jsx'
import { useAlumniErrorText } from './useAlumniErrorText.js'
import { useEditText } from './useEditText.js'
import { useQuarterFormat } from './useQuarterFormat.js'
import './i18n.js'
import './i18n.company.js'
import './i18n.edit.js'
import './i18n.quarters.js'

// the chart code (SVG, hover, table toggle) is its own chunk: nothing of it loads until a company with closed quarters is shown
const ChartCard = lazy(() => import('./QuarterChart.jsx'))

const NUMBER_FIELDS = [
  { key: 'revenue_total', unit: 'money' }, { key: 'funding_raised_total', unit: 'money' },
  { key: 'employees_total', unit: 'count' }, { key: 'employees_female', unit: 'count' }, { key: 'freelancers', unit: 'count' },
]
const TEXT_FIELDS = ['traction', 'challenges', 'needs']

/** The status badge of the figures of a quarter (an icon + a word: never colour alone). */
export function FigureStatusBadge({ status, className }) {
  const { t } = useLanguage()
  const Icon = status === 'confirmed' ? CheckCircle2 : status === 'closed' ? Lock : status === 'updated' ? Pencil : TriangleAlert
  return (
    <Badge tone={statusTone(status)} className={className} data-testid="figures-status" data-status={status}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(`alumni.q.status.${status}`)}
    </Badge>
  )
}

/** "Update your figures for Q4 2026 / confirm": the banner of an open quarter whose figures are not confirmed. Shown above the form and on the founder pages. */
export function FiguresBanner({ status, period, deadline, className }) {
  const { t, lang } = useLanguage()
  if (!needsUpdate(status)) return null
  const left = daysLeft(deadline)
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-card border border-accent bg-accent/20 p-3 text-sm', className)} data-testid="figures-banner">
      <CalendarClock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-bold">{t('alumni.q.banner.title', { quarter: periodLabel(period, lang) })}</p>
        <p>{t('alumni.q.banner.body')}{left !== null && left >= 0 ? ` ${t(left === 1 ? 'alumni.q.banner.lastDay' : 'alumni.q.banner.daysLeft', { days: left })}` : ''}</p>
      </div>
    </div>
  )
}

/**
 * The DRAFT form of the quarter a company's figures belong to (owner decision 21): edited any time, no per-edit history (only "last modified"), saved explicitly with the version the form
 * loaded (a stale save refetches and asks only about the figures both of us changed). "Confirm" tells the Athar team the figures are right for the quarter (a founder only).
 */
function FigureForm({ data, audience, canEdit }) {
  const { t, lang } = useLanguage()
  const e = useEditText()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAlumniErrorText()
  const { saveFigures, confirmFigures } = useQuarterMutations()
  const draft = data.draft
  const serverVersion = draft?.updated_at ?? NO_DRAFT
  const [loaded, setLoaded] = useState({ version: serverVersion, base: snapshotToForm(draft) })
  const [seenServer, setSeenServer] = useState(serverVersion)
  const [values, setValues] = useState(loaded.base)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [choices, setChoices] = useState({})
  const [busy, setBusy] = useState(false)
  const patch = buildSnapshotPatch(loaded.base, values)
  const dirty = Object.keys(patch).length > 0
  // somebody else saved while this form was open and untouched: show his version (no effect, no flash)
  // (only when the SERVER's version moved: right after my own save the form already holds the new version, the refetch then confirms it)
  if (serverVersion !== seenServer) {
    setSeenServer(serverVersion)
    if (!dirty && !conflict && serverVersion !== loaded.version) {
      const base = snapshotToForm(draft)
      setLoaded({ version: serverVersion, base })
      setValues(base)
    }
  }
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }))
  const period = data.target_period
  const confirmed = Boolean(draft?.confirmed)

  async function handleStale() {
    const keys = Object.keys(patch)
    let fresh
    try { fresh = await getCompanyFigures(data.company_id) } catch { setFormError(t('alumni.edit.conflict.reloadFailed')); return }
    const freshForm = snapshotToForm(fresh.draft)
    const who = e.who({ source: fresh.draft?.updated_source, name: fresh.draft?.updated_by_name }, audience)
    const conflicts = findConflicts({ base: loaded.base, mine: values, fresh: freshForm, keys })
    const nextLoaded = { version: fresh.draft?.updated_at ?? NO_DRAFT, base: freshForm }
    if (conflicts.length === 0) {
      setLoaded(nextLoaded)
      setValues({ ...freshForm, ...Object.fromEntries(keys.map((k) => [k, values[k]])) })
      setNotice(t('alumni.edit.conflict.merged', { who }))
    } else {
      setConflict({ conflicts, freshForm, nextLoaded, keys, who })
      setChoices({})
    }
  }
  function applyChoices() {
    const keep = keysToKeep({ keys: conflict.keys, conflicts: conflict.conflicts, choices })
    setLoaded(conflict.nextLoaded)
    setValues({ ...conflict.freshForm, ...Object.fromEntries(keep.map((k) => [k, values[k]])) })
    setNotice(t('alumni.edit.conflict.mergedWithChoices'))
    setConflict(null)
  }

  /** Saves what changed; returns true when the draft is saved (or nothing changed). */
  async function save() {
    const found = validateSnapshotForm(values)
    setErrors(Object.fromEntries(Object.entries(found).map(([k, key]) => [k, t(key)])))
    setFormError(null)
    setNotice(null)
    if (Object.keys(found).length) return false
    if (!dirty) return true
    try {
      const r = await saveFigures.mutateAsync({ companyId: data.company_id, data: patch, expected: loaded.version })
      const nextBase = snapshotToForm(r.draft)
      setLoaded({ version: r.draft?.updated_at ?? NO_DRAFT, base: nextBase })
      setValues(nextBase)
      return true
    } catch (err) {
      if (parseAlumniError(err).token === 'alumni_stale') await handleStale()
      else setFormError(errorText(err))
      return false
    }
  }
  async function onSave(ev) {
    ev.preventDefault()
    setBusy(true)
    try { if (await save()) toast.success(t('alumni.q.form.saved')) } finally { setBusy(false) }
  }
  async function onConfirm() {
    const rev = String(dirty ? values.revenue_total : loaded.base.revenue_total).trim()
    if (rev === '') {
      const ok = await confirm({ title: t('alumni.q.confirm.emptyRevenueTitle'), message: t('alumni.q.confirm.emptyRevenueBody', { quarter: periodLabel(period, lang) }), confirmLabel: t('alumni.q.confirm.anyway'), cancelLabel: t('alumni.q.confirm.goBack') })
      if (!ok) return
    }
    setBusy(true)
    try {
      if (!(await save())) return
      await confirmFigures.mutateAsync({ companyId: data.company_id })
      toast.success(t('alumni.q.confirm.done', { quarter: periodLabel(period, lang) }))
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const number = (f) => (
    <Field key={f.key} label={t(`alumni.common.metric.${f.key}`)} inputMode={f.unit === 'money' ? 'decimal' : 'numeric'} dir="ltr" value={values[f.key]} error={errors[f.key]} hint={t(`alumni.q.hint.${f.key}`)} disabled={!canEdit || busy} onChange={(ev) => set(f.key, ev.target.value)} />
  )
  return (
    <form onSubmit={onSave} noValidate className="space-y-field-gap" data-testid="figures-form" aria-label={t('alumni.q.form.title', { quarter: periodLabel(period, lang) })}>
      {conflict ? (
        <div className="space-y-3" role="alert" data-testid="figures-conflict">
          <p className="font-bold">{t('alumni.edit.conflict.title')}</p>
          <p className="text-sm">{t('alumni.edit.conflict.body', { who: conflict.who })}</p>
          <ConflictList conflicts={conflict.conflicts} who={conflict.who} fieldLabel={(k) => t(`alumni.common.metric.${k}`)} valueText={(k, v) => (v === null || v === undefined ? '' : String(v))} choices={choices} onChoose={(k, v) => setChoices((s) => ({ ...s, [k]: v }))} />
          <Button onClick={applyChoices} disabled={!allDecided(conflict.conflicts, choices)} data-testid="conflict-apply">{t('alumni.edit.conflict.apply')}</Button>
        </div>
      ) : (
        <>
          {notice && <p role="status" className="rounded-input bg-accent/20 p-3 text-sm" data-testid="figures-notice">{notice}</p>}
          <div className="grid gap-field-gap sm:grid-cols-2">{NUMBER_FIELDS.map(number)}</div>
          {TEXT_FIELDS.map((k) => (
            <Field key={k} as="textarea" rows={3} label={t(`alumni.common.metric.${k}`)} value={values[k]} error={errors[k]} disabled={!canEdit || busy} onChange={(ev) => set(k, ev.target.value)} />
          ))}
          {formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{formError}</p>}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant={audience === 'founder' && !dirty ? 'outline' : 'primary'} loading={busy && dirty} disabled={!dirty || busy} data-testid="figures-save">{t('alumni.q.form.save')}</Button>
              {audience === 'founder' && (
                <Button type="button" variant={dirty || confirmed ? 'outline' : 'primary'} onClick={onConfirm} disabled={busy || (confirmed && !dirty)} data-testid="figures-confirm">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  {dirty ? t('alumni.q.confirm.saveAndConfirm') : confirmed ? t('alumni.q.confirm.confirmedBtn') : t('alumni.q.confirm.btn', { quarter: periodLabel(period, lang) })}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">{t('alumni.common.currencyNote')}</span>
            </div>
          )}
        </>
      )}
    </form>
  )
}

/** The form of a manager's correction of a CLOSED quarter (or the backfill of a quarter that ended without a snapshot). The original frozen value of each changed figure is kept once. */
function CorrectionDialog({ companyId, snapshot, periods, onClose }) {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const errorText = useAlumniErrorText()
  const { reopenQuarter, correctSnapshot, refreezeQuarter } = useQuarterMutations()
  const isNew = !snapshot
  const [period, setPeriod] = useState(snapshot?.period_key ?? periods[0] ?? '')
  const base = snapshotToForm(snapshot)
  const [values, setValues] = useState(base)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  // the status the company had at the END of the quarter (the closing rates read it): '' = as it was then, worked out by the system
  const baseSt = snapshot?.operating_status ?? ''
  const baseCl = snapshot?.closed_on ?? ''
  const [st, setSt] = useState(baseSt)
  const [cl, setCl] = useState(baseCl)
  const patch = {
    ...buildSnapshotPatch(base, values),
    ...(st !== baseSt ? { operating_status: st === '' ? null : st } : {}),
    ...((st === 'closed' ? cl : '') !== baseCl ? { closed_on: (st === 'closed' ? cl : '') || null } : {}),
  }

  async function submit(ev) {
    ev.preventDefault()
    const found = validateSnapshotForm(values)
    setErrors(Object.fromEntries(Object.entries(found).map(([k, key]) => [k, t(key)])))
    setFormError(null)
    if (Object.keys(found).length || !period) return
    setBusy(true)
    let reopened = false
    try {
      if (!isNew && snapshot.status !== 'reopened') { await reopenQuarter.mutateAsync({ period, companyId }); reopened = true }
      await correctSnapshot.mutateAsync({ companyId, period, data: patch })
      toast.success(t(isNew ? 'alumni.q.correct.addedToast' : 'alumni.q.correct.doneToast', { quarter: periodLabel(period, lang) }))
      onClose()
    } catch (err) {
      if (reopened) { try { await refreezeQuarter.mutateAsync({ period, companyId }) } catch { /* the badge shows "reopened"; the manager can finish it */ } }
      setFormError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('alumni.q.correct.addTitle') : t('alumni.q.correct.title', { quarter: periodLabel(period, lang) })}
      description={isNew ? t('alumni.q.correct.addBody') : t('alumni.q.correct.body')}
      closeLabel={t('common.close')}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button><Button type="submit" form="correct-form" loading={busy} disabled={Object.keys(patch).length === 0 || !period}>{t('alumni.q.correct.save')}</Button></>}
    >
      <form id="correct-form" onSubmit={submit} noValidate className="space-y-field-gap" data-testid="correct-form">
        {isNew && (
          <Field as="select" label={t('alumni.q.correct.quarter')} value={period} onChange={(ev) => setPeriod(ev.target.value)}>
            {periods.map((p) => <option key={p} value={p}>{periodLabel(p, lang)}</option>)}
          </Field>
        )}
        <div className="grid gap-field-gap sm:grid-cols-2">
          {NUMBER_FIELDS.map((f) => (
            <Field key={f.key} label={t(`alumni.common.metric.${f.key}`)} inputMode={f.unit === 'money' ? 'decimal' : 'numeric'} dir="ltr" value={values[f.key]} error={errors[f.key]} onChange={(ev) => setValues((s) => ({ ...s, [f.key]: ev.target.value }))} />
          ))}
        </div>
        <div className="grid gap-field-gap sm:grid-cols-2" data-testid="correct-status">
          <Field as="select" label={t('alumni.q.correct.status')} value={st} onChange={(ev) => { setSt(ev.target.value); if (ev.target.value !== 'closed') setCl('') }}>
            {isNew && <option value="">{t('alumni.q.correct.statusAuto')}</option>}
            <option value="open">{t('alumni.q.correct.statusOpen')}</option>
            <option value="closed">{t('alumni.q.correct.statusClosed')}</option>
          </Field>
          {st === 'closed' && <Field type="date" label={t('alumni.q.correct.closedOn')} dir="ltr" value={cl} onChange={(ev) => setCl(ev.target.value)} />}
        </div>
        {formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{formError}</p>}
      </form>
    </Modal>
  )
}

/**
 * The CLOSED quarters of a company: a graph per metric (frozen snapshots only, a quarter nobody reported is a gap) with its table alternative, and one table with every quarter.
 * A quarter a manager corrected carries a "Corrected" mark and the original frozen value. A manager can correct / add a quarter and export the table.
 */
export function QuarterHistory({ data, audience, companyName }) {
  const { t, lang } = useLanguage()
  const e = useEditText()
  const fmt = useQuarterFormat()
  const [dialog, setDialog] = useState(null) // { snapshot } | { add: true }
  const { refreezeQuarter } = useQuarterMutations()
  const toast = useToast()
  const errorText = useAlumniErrorText()
  const snaps = [...(data.snapshots ?? [])].sort((a, b) => b.period_key.localeCompare(a.period_key))
  const manager = audience === 'manager'
  const have = new Set(snaps.map((s) => s.period_key))
  // quarters that already ended and have no snapshot (the backfill list): the last 8 before the calendar quarter
  const missing = []
  if (data.calendar_period) {
    let i = Number(data.calendar_period.slice(0, 4)) * 4 + Number(data.calendar_period.slice(6)) - 1
    for (let n = 0; n < 8; n += 1) { i -= 1; const k = `${Math.floor(i / 4)}-Q${(i % 4) + 1}`; if (!have.has(k)) missing.push(k) }
  }
  const cell = (v, unit) => (v === null || v === undefined || v === '' ? <span className="text-muted-foreground">-</span> : unit ? fmt(unit, Number(v)) : v)

  async function finish(s) {
    try { await refreezeQuarter.mutateAsync({ period: s.period_key, companyId: data.company_id }); toast.success(t('alumni.q.correct.finished')) } catch (err) { toast.error(errorText(err)) }
  }
  async function exportXlsx() {
    const { exportRows } = await import('../../lib/export/xlsx.js')
    const labels = Object.fromEntries(['period_key', 'reported', 'revenue_total', 'employees_total', 'employees_female', 'freelancers', 'funding_raised_total', 'team_size', 'female_founders', 'operating_status', 'corrected', 'frozen_at'].map((k) => [k, t(`alumni.q.export.${k}`)]))
    const [header, ...rows] = companySheetRows(snaps, labels)
    await exportRows(rows, header.map((h, i) => ({ key: (r) => r[i], header: h })), `${(companyName || 'company').replace(/[^\p{L}\p{N}_-]+/gu, '-')}-quarters.xlsx`, { sheetName: 'Quarters', blanks: true })
  }

  return (
    <div className="space-y-4" data-testid="quarter-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">{t('alumni.q.history.title')}</h3>
        <div className="flex flex-wrap gap-2">
          {manager && missing.length > 0 && <Button variant="outline" size="sm" onClick={() => setDialog({ add: true })} data-testid="add-quarter"><CalendarPlus className="h-4 w-4" aria-hidden="true" />{t('alumni.q.correct.addBtn')}</Button>}
          {manager && snaps.length > 0 && <Button variant="outline" size="sm" onClick={exportXlsx}><Download className="h-4 w-4" aria-hidden="true" />{t('alumni.q.history.export')}</Button>}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t('alumni.q.history.intro')}</p>
      {snaps.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t('alumni.q.history.empty')} body={t('alumni.q.history.emptyBody', { date: e.date(data.period_end) })} />
      ) : (
        <>
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="history-charts">
              {METRICS.map((m) => <ChartCard key={m.key} title={t(`alumni.common.metric.${m.key}`)} unit={m.unit} kind={m.chart} points={quarterSeries(snaps, m.key)} />)}
            </div>
          </Suspense>
          <div className="overflow-x-auto rounded-card border bg-card">
            <table className="w-full min-w-[20rem] border-collapse text-sm" data-testid="quarter-grid">
              <caption className="sr-only">{t('alumni.q.history.caption')}</caption>
              <thead>
                <tr className="border-b bg-surface text-start">
                  <th scope="col" className="sticky start-0 z-10 bg-surface px-3 py-2 text-start font-semibold">{t('alumni.common.metric')}</th>
                  {snaps.map((s) => (
                    <th scope="col" key={s.period_key} className="min-w-36 px-3 py-2 text-start align-top">
                      <span className="block text-base font-bold" data-testid="grid-quarter">{periodLabel(s.period_key, lang)}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {s.reported ? <Badge tone="green">{t('alumni.q.history.reported')}</Badge> : <Badge tone="outline">{t('alumni.q.history.notReported')}</Badge>}
                        {s.corrected && <Badge tone="amber" title={s.corrected_at ? e.dateTime(s.corrected_at) : undefined}>{t('alumni.q.history.corrected')}</Badge>}
                        {s.status === 'reopened' && <Badge tone="red">{t('alumni.q.history.reopened')}</Badge>}
                      </span>
                      <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{t('alumni.q.history.frozenOn', { date: e.date(s.frozen_at), how: t(`alumni.q.history.how.${s.frozen_source}`) })}</span>
                      {manager && (
                        <span className="mt-1 flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setDialog({ snapshot: s })} aria-label={t('alumni.q.correct.title', { quarter: periodLabel(s.period_key, lang) })} data-testid="correct-quarter"><Pencil className="h-4 w-4" aria-hidden="true" />{t('alumni.q.correct.btn')}</Button>
                          {s.status === 'reopened' && <Button variant="ghost" size="sm" onClick={() => finish(s)}><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('alumni.q.correct.finish')}</Button>}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...NUMBER_FIELDS, { key: 'team_size', unit: 'count' }].map((f) => (
                  <tr key={f.key} className="border-b last:border-b-0">
                    <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-medium">{t(f.key === 'team_size' ? 'alumni.q.history.teamSize' : `alumni.common.metric.${f.key}`)}</th>
                    {snaps.map((s) => {
                      const hasPrev = s.previous_values && Object.prototype.hasOwnProperty.call(s.previous_values, f.key)
                      const visible = s.reported || f.key === 'team_size'
                      return (
                        <td key={s.period_key} className="px-3 py-2 tabular-nums" dir="ltr">
                          {visible ? cell(s[f.key], f.unit) : <span className="text-muted-foreground">-</span>}
                          {visible && hasPrev && <span className="block text-[11px] text-muted-foreground" data-testid="previous-value">{t('alumni.q.chart.was', { value: s.previous_values[f.key] === null ? t('alumni.q.history.empty2') : fmt(f.unit, Number(s.previous_values[f.key])) })}</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {TEXT_FIELDS.map((k) => (
                  <tr key={k} className="border-b align-top last:border-b-0">
                    <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-medium">{t(`alumni.common.metric.${k}`)}</th>
                    {snaps.map((s) => <td key={s.period_key} className="px-3 py-2"><span dir="auto" className="line-clamp-3 whitespace-pre-line break-words">{s.reported ? cell(s[k]) : <span className="text-muted-foreground">-</span>}</span></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t('alumni.q.history.semantics')}</p>
        </>
      )}
      {dialog && <CorrectionDialog key={dialog.snapshot?.period_key ?? 'add'} companyId={data.company_id} snapshot={dialog.snapshot ?? null} periods={missing} onClose={() => setDialog(null)} />}
    </div>
  )
}

/**
 * Everything about the figures of ONE company (founder and manager): the status of the quarter (confirmed / updated / not updated, the deadline, "last modified"), the "update or
 * confirm" banner, the draft form, and the closed quarters with their graphs. `audience` 'manager' adds "close this quarter now" and the correction tools.
 */
export default function FiguresPanel({ companyId, audience = 'founder', companyName, className }) {
  const { t, lang } = useLanguage()
  const e = useEditText()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAlumniErrorText()
  const q = useCompanyFigures(companyId)
  const { closeQuarter } = useQuarterMutations()
  if (q.isPending) return <Skeleton className="h-48 w-full" />
  if (q.isError) return <ErrorState error={q.error} title={t('alumni.q.loadFailed')} onRetry={() => q.refetch()} />
  const data = q.data
  const manager = audience === 'manager'
  const cal = data.calendar_period
  const closed = data.status === 'closed'

  async function closeNow() {
    const ok = await confirm({ title: t('alumni.q.close.title', { quarter: periodLabel(cal, lang) }), message: t('alumni.q.close.body', { quarter: periodLabel(cal, lang) }), confirmLabel: t('alumni.q.close.confirm'), destructive: true })
    if (!ok) return
    try {
      const r = await closeQuarter.mutateAsync({ period: cal, companyId: data.company_id })
      toast.success(t(r.frozen > 0 ? 'alumni.q.close.done' : 'alumni.q.close.nothing', { quarter: periodLabel(cal, lang) }))
    } catch (err) { toast.error(errorText(err)) }
  }

  return (
    <div className={cn('space-y-5', className)} data-testid="figures-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-bold">{t('alumni.q.form.title', { quarter: periodLabel(data.target_period, lang) })}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <FigureStatusBadge status={data.target_status === 'closed' ? data.status : data.target_status} />
            <span className="text-xs text-muted-foreground">{t('alumni.q.form.deadline', { date: e.date(data.deadline) })}</span>
          </div>
          {data.draft?.updated_at
            ? <StampLine audience={audience} stamp={{ at: data.draft.updated_at, source: data.draft.updated_source, name: data.draft.updated_by_name }} testId="figures-stamp" />
            : <p className="text-xs text-muted-foreground" data-testid="figures-stamp">{t('alumni.q.form.neverModified')}</p>}
          {manager && data.draft?.confirmed && (
            <p className="text-xs text-muted-foreground" data-testid="figures-confirmed-by">{t('alumni.q.form.confirmedBy', { who: data.draft.confirmed_by_name ?? t('alumni.edit.stamp.who.founder'), date: e.dateTime(data.draft.confirmed_at) })}</p>
          )}
        </div>
        {manager && !closed && (
          <Button variant="outline" size="sm" onClick={closeNow} data-testid="close-quarter-now"><Lock className="h-4 w-4" aria-hidden="true" />{t('alumni.q.close.btn', { quarter: periodLabel(cal, lang) })}</Button>
        )}
      </div>
      {closed && <p className="rounded-input bg-surface p-3 text-sm" data-testid="figures-closed-note">{t('alumni.q.form.closedNote', { quarter: periodLabel(cal, lang), next: periodLabel(data.target_period, lang) })}</p>}
      {audience === 'founder' && <FiguresBanner status={data.status} period={cal} deadline={data.deadline} />}
      <FigureForm key={companyId} data={data} audience={audience} canEdit />
      <QuarterHistory data={data} audience={audience} companyName={companyName} />
    </div>
  )
}
