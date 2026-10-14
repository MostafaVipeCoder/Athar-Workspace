import { useState } from 'react'
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { missingYears } from '../../lib/alumni.js'
import { buildSnapshotPatch, snapshotToForm, validateSnapshotForm } from '../../lib/alumniForms.js'
import { useAlumniErrorText } from './useAlumniErrorText.js'
import { useMetricFormat } from './useMetricFormat.js'
import './i18n.js'
import './i18n.company.js'

const NUMBER_ROWS = [
  { key: 'revenue_total', unit: 'money' }, { key: 'funding_raised_total', unit: 'money' },
  { key: 'employees_total', unit: 'count' }, { key: 'employees_female', unit: 'count' }, { key: 'freelancers', unit: 'count' },
]
const TEXT_ROWS = ['traction', 'challenges', 'needs']

/** The form of ONE year: the figures and the three text answers. Saving sends only the changed keys (`upsert_company_snapshot` has patch semantics). */
function SnapshotModal({ open, year, years, snapshot, onClose, onSave }) {
  const { t } = useLanguage()
  const errorText = useAlumniErrorText()
  const base = snapshotToForm(snapshot)
  const [chosenYear, setChosenYear] = useState(year ?? years[0] ?? new Date().getFullYear())
  const [values, setValues] = useState(base)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }))
  const patch = buildSnapshotPatch(base, values)

  async function submit(e) {
    e.preventDefault()
    const found = validateSnapshotForm(values)
    setErrors(Object.fromEntries(Object.entries(found).map(([k, key]) => [k, t(key)])))
    setFormError(null)
    if (Object.keys(found).length) return
    if (Object.keys(patch).length === 0) { onClose(); return }
    setBusy(true)
    try {
      await onSave(Number(chosenYear), patch)
      onClose()
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const number = (k, unit) => (
    <Field key={k} label={t(`alumni.common.metric.${k}`)} inputMode={unit === 'money' ? 'decimal' : 'numeric'} dir="ltr" value={values[k]} error={errors[k]} hint={k === 'funding_raised_total' ? t('alumni.common.fundingHint') : undefined} onChange={(e) => set(k, e.target.value)} />
  )
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={snapshot ? t('alumni.common.editYear', { year: chosenYear }) : t('alumni.common.addYearTitle')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="snapshot-form" loading={busy} disabled={Object.keys(patch).length === 0}>{t('common.save')}</Button>
        </>
      }
    >
      <form id="snapshot-form" onSubmit={submit} noValidate className="space-y-field-gap">
        {!snapshot && (
          <Field as="select" label={t('alumni.common.year')} value={chosenYear} onChange={(e) => setChosenYear(e.target.value)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Field>
        )}
        <div className="grid gap-field-gap sm:grid-cols-2">{NUMBER_ROWS.map((r) => number(r.key, r.unit))}</div>
        {TEXT_ROWS.map((k) => (
          <Field key={k} as="textarea" rows={3} label={t(`alumni.common.metric.${k}`)} value={values[k]} error={errors[k]} onChange={(e) => set(k, e.target.value)} />
        ))}
        {formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{formError}</p>}
      </form>
    </Modal>
  )
}

/**
 * The yearly figures of a company: metrics as rows, years as columns (design 09 7), an "add year" action, a per-year edit, `female <= total` checked on the form and by the
 * server. `snapshots` = the payload's `snapshots[]` (newest first). `onSave(year, patch)` / `onDelete(year)` return promises (a refusal is shown in the dialog / as a toast
 * by the page); `onDelete` is given only to managers (a founder cannot delete a year). Money is EGP, funding is cumulative to the end of the year.
 */
export default function MetricsTable({ snapshots = [], canEdit = true, onSave, onDelete, className }) {
  const { t, formatDate } = useLanguage()
  const fmt = useMetricFormat()
  const confirm = useConfirm()
  const [modal, setModal] = useState(null) // { year, snapshot } | { add: true }
  const years = missingYears(snapshots)
  const rows = [...snapshots].sort((a, b) => b.year - a.year)
  const cell = (v, unit) => (v === null || v === undefined || v === '' ? <span className="text-muted-foreground">-</span> : unit ? fmt(unit, Number(v)) : v)

  async function remove(s) {
    const ok = await confirm({ title: t('alumni.common.deleteYearTitle', { year: s.year }), message: t('alumni.common.deleteYearBody'), confirmLabel: t('alumni.common.deleteYear'), destructive: true })
    if (ok) await onDelete(s.year)
  }

  return (
    <div className={className} data-testid="metrics-table">
      {rows.length === 0 ? (
        <EmptyState icon={CalendarPlus} title={t('alumni.common.metricsEmpty')} body={t('alumni.common.metricsEmptyBody')} />
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full min-w-[20rem] border-collapse text-sm">
            <caption className="sr-only">{t('alumni.common.metricsCaption')}</caption>
            <thead>
              <tr className="border-b bg-surface text-start">
                <th scope="col" className="sticky start-0 z-10 bg-surface px-3 py-2 text-start font-semibold">{t('alumni.common.metric')}</th>
                {rows.map((s) => (
                  <th scope="col" key={s.year} className="min-w-28 px-3 py-2 text-start align-top">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-base font-bold" data-testid="metrics-year">{s.year}</span>
                      {canEdit && (
                        <span className="flex">
                          <Button variant="ghost" size="icon" aria-label={t('alumni.common.editYear', { year: s.year })} onClick={() => setModal({ year: s.year, snapshot: s })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                          {onDelete && <Button variant="ghost" size="icon" aria-label={t('alumni.common.deleteYearTitle', { year: s.year })} onClick={() => remove(s)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}
                        </span>
                      )}
                    </div>
                    <Badge tone="outline" className="mt-0.5 font-normal" title={s.updated_at ? formatDate(s.updated_at, { dateStyle: 'medium' }) : undefined}>
                      {t(`alumni.common.source.${s.source === 'manager' ? 'manager' : 'founder'}`)}
                    </Badge>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NUMBER_ROWS.map((r) => (
                <tr key={r.key} className="border-b last:border-b-0">
                  <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-medium">{t(`alumni.common.metric.${r.key}`)}</th>
                  {rows.map((s) => <td key={s.year} className="px-3 py-2 tabular-nums" dir="ltr">{cell(s[r.key], r.unit)}</td>)}
                </tr>
              ))}
              {TEXT_ROWS.map((k) => (
                <tr key={k} className="border-b align-top last:border-b-0">
                  <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-medium">{t(`alumni.common.metric.${k}`)}</th>
                  {rows.map((s) => <td key={s.year} className="px-3 py-2"><span dir="auto" className="line-clamp-4 whitespace-pre-line break-words">{cell(s[k])}</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={years.length === 0} onClick={() => setModal({ add: true })}>
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            {t('alumni.common.addYear')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('alumni.common.currencyNote')}</span>
        </div>
      )}
      {modal && (
        <SnapshotModal
          key={modal.year ?? 'add'}
          open
          year={modal.year}
          years={years}
          snapshot={modal.snapshot}
          onClose={() => setModal(null)}
          onSave={onSave}
        />
      )}
    </div>
  )
}
