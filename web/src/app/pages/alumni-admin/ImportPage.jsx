import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileUp, Plus } from 'lucide-react'
import { useAlumniMutations } from '../../../data/alumni.js'
import { importAlumniPreview } from '../../../data/alumniAdmin.js'
import { parseWorkbook } from '../../../lib/export/xlsx.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { Field } from '../../../ui/Field.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { AdminPage, KpiCard, Segmented, SectionCard } from './ui.jsx'
import { chunkRows, filterPreviewRows, issueLevelRank, lookupKeyFromLabel, mergePreviews, toImportRows } from './adminLogic.js'
import { useAdminErrorText, useLabels } from './hooks.js'
import './i18n.common.js'
import './import.i18n.js'

const MAX_ROWS = 5000
const SHOW = 50
const KIND_LISTS = { startup_type: 'startup_types', sector: 'sectors', stage: 'stages', legal_status: 'legal_statuses', closing_reason: 'closing_reasons', after_closing: 'after_closing' }
const tone = (level) => (level === 'error' ? 'red' : level === 'warning' ? 'amber' : 'outline')

/** One value that matches no list: add it to the vocabulary (labels in both languages, a generated ASCII key) through the existing manager RPC; the sheet is then checked again. */
function Proposal({ p, d, lookups, onAdded }) {
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { saveLookup } = useAlumniMutations()
  const [open, setOpen] = useState(false)
  const [en, setEn] = useState(p.value)
  const [ar, setAr] = useState(p.value)
  const [done, setDone] = useState(false)
  const list = KIND_LISTS[p.kind]
  const taken = p.kind === 'subsector' ? (lookups?.sectors ?? []).flatMap((s) => s.subsectors.map((x) => x.key)) : (lookups?.[list] ?? []).map((x) => x.key)
  const blocked = p.kind === 'subsector' && !p.parent

  async function add() {
    try {
      const patch = { label_en: en.trim(), label_ar: ar.trim(), ...(p.kind === 'subsector' ? { parent_key: p.parent } : {}) }
      await saveLookup.mutateAsync({ kind: p.kind, key: lookupKeyFromLabel(en || p.value, taken), patch })
      toast.success(d('added'))
      setDone(true)
      setOpen(false)
      onAdded()
    } catch (e) {
      toast.error(`${d('addFailed')} ${errorText(e)}`)
    }
  }
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">{d(`kind_${p.kind}`)}</td>
      <td className="px-3 py-2 font-semibold">{p.value}</td>
      <td className="px-3 py-2 tabular-nums">{p.count}</td>
      <td className="px-3 py-2">
        {done ? <Badge tone="green">{d('addedTag')}</Badge> : blocked ? <span className="text-xs text-muted-foreground">{d('needsSector')}</span> : open ? (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); add() }} aria-label={d('addTitle', { value: p.value, kind: d(`kind_${p.kind}`) })}>
            <Field label={d('labelEn')} dir="ltr" value={en} onChange={(e) => setEn(e.target.value)} maxLength={120} />
            <Field label={d('labelAr')} dir="rtl" value={ar} onChange={(e) => setAr(e.target.value)} maxLength={120} />
            <div className="flex gap-2"><Button type="submit" size="sm" disabled={!en.trim() || !ar.trim()} loading={saveLookup.isPending}>{d('save')}</Button><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{d('cancel')}</Button></div>
          </form>
        ) : <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />{d('addValue')}</Button>}
      </td>
    </tr>
  )
}

/**
 * M11: a CHECK of the owner's Excel (design 09 section 13). The file is read in this browser, sent 500 rows at a time to `import_alumni_preview` (a dry run: nothing is written)
 * and the plan comes back per row: create / update / fix first, every finding, the values that match no list (to add to the vocabulary), the missing / unknown / calculated columns.
 * The national ID of a row is validated by the database and never shown (a masked value and the derived age / gender / governorate only). The final load is a documented hook.
 */
export default function ImportPage() {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.imp.${k}`, v)
  const labels = useLabels()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [sheet, setSheet] = useState('')
  const [result, setResult] = useState(null)
  const [progress, setProgress] = useState(null)
  const [filter, setFilter] = useState('all')
  const [shown, setShown] = useState(SHOW)
  const [truncated, setTruncated] = useState(false)

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const sheets = await parseWorkbook(f)
      const names = Object.keys(sheets)
      if (names.length === 0) throw new Error('empty')
      setFile({ name: f.name, sheets })
      setSheet(names[0])
      setResult(null)
    } catch {
      toast.error(d('parseFailed'))
    }
  }
  async function run() {
    const all = toImportRows(file.sheets[sheet])
    if (all.length === 0) { toast.warning(d('noRows')); return }
    setTruncated(all.length > MAX_ROWS)
    const chunks = chunkRows(all.slice(0, MAX_ROWS))
    const parts = []
    try {
      for (let i = 0; i < chunks.length; i += 1) {
        setProgress({ done: i * 500, total: Math.min(all.length, MAX_ROWS) })
        parts.push(await importAlumniPreview(chunks[i]))
      }
      setResult(mergePreviews(parts, chunks.map((c) => c.length)))
      setFilter('all')
      setShown(SHOW)
    } catch (e) {
      toast.error(`${d('checkFailed')} ${errorText(e)}`)
    } finally {
      setProgress(null)
    }
  }

  const issueText = (i) => {
    const value = i.code === 'invalid_id' ? d(`idReason.${i.value}`) : i.value
    return d(`code.${i.code}`, { field: i.field, value })
  }
  const rows = result ? filterPreviewRows(result.rows, filter) : []
  const govName = (code) => labels.label('governorate', code)

  return (
    <AdminPage testId="alumni-admin-import" title={d('title')} subtitle={d('subtitle')}
      actions={<Link to="/alumni/admin/directory" className={buttonClass({ variant: 'outline', size: 'sm' })}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{d('back')}</Link>}>
      <SectionCard id="file" title={d('stepFile')}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <span className="block text-sm font-medium text-athar-ink">{d('fileLabel')}</span>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={onFile} aria-label={d('fileLabel')} tabIndex={-1} data-testid="import-file" />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" aria-hidden="true" />{file ? file.name : d('fileLabel')}</Button>
          </div>
          {file && Object.keys(file.sheets).length > 1 && (
            <Field as="select" label={d('sheet')} value={sheet} onChange={(e) => { setSheet(e.target.value); setResult(null) }}>
              {Object.keys(file.sheets).map((n) => <option key={n} value={n}>{n}</option>)}
            </Field>
          )}
          {file && <Button onClick={run} loading={Boolean(progress)} data-testid="import-run">{progress ? d('running', progress) : result ? d('again') : d('run')}</Button>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{d('fileHint')}</p>
        {truncated && <p className="mt-1 text-xs font-semibold">{d('tooMany')}</p>}
      </SectionCard>

      {result && (
        <>
          <SectionCard id="result" title={d('stepResult')} testId="import-result">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label={d('rows')} value={result.count} />
              <KpiCard label={d('create')} value={result.summary.create} tone="good" />
              <KpiCard label={d('update')} value={result.summary.update} />
              <KpiCard label={d('errors')} value={result.summary.error} tone={result.summary.error ? 'bad' : 'default'} />
              <KpiCard label={d('warnings')} value={result.summary.warnings} />
            </div>
          </SectionCard>

          <SectionCard id="headers" title={d('stepHeaders')}>
            <div className="grid gap-4 lg:grid-cols-3">
              <div><h3 className="mb-1 text-sm font-bold">{d('missingHeaders')}</h3>{result.headers.missing.length === 0 ? <p className="text-sm text-muted-foreground">{d('noMissing')}</p> : <ul className="flex flex-wrap gap-1">{result.headers.missing.map((h) => <li key={h}><Badge tone="amber"><span dir="ltr">{h}</span></Badge></li>)}</ul>}</div>
              <div><h3 className="mb-1 text-sm font-bold">{d('unknownHeaders')}</h3>{result.headers.unknown.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ul className="flex flex-wrap gap-1">{result.headers.unknown.map((h) => <li key={h}><Badge tone="outline"><span dir="ltr">{h}</span></Badge></li>)}</ul>}</div>
              <div><h3 className="mb-1 text-sm font-bold">{d('ignoredDerived')}</h3>{result.headers.ignored_derived.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ul className="flex flex-wrap gap-1">{result.headers.ignored_derived.map((h) => <li key={h}><Badge tone="blue"><span dir="ltr">{h}</span></Badge></li>)}</ul>}</div>
            </div>
          </SectionCard>

          {result.proposed_lookups.length > 0 && (
            <SectionCard id="vocab" title={d('stepVocab')} description={d('vocabHint')} testId="import-vocab">
              <div className="overflow-x-auto rounded-card border" role="region" aria-label={d('stepVocab')}>
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="bg-surface text-xs font-bold text-athar-ink"><tr><th scope="col" className="px-3 py-2 text-start">{d('vocabKind')}</th><th scope="col" className="px-3 py-2 text-start">{d('vocabValue')}</th><th scope="col" className="px-3 py-2 text-start">{d('vocabCount')}</th><th scope="col" className="px-3 py-2"><span className="sr-only">{d('addValue')}</span></th></tr></thead>
                  <tbody>{result.proposed_lookups.map((p) => <Proposal key={`${p.kind}|${p.value}|${p.parent ?? ''}`} p={p} d={d} lookups={labels.lookups} onAdded={() => {}} />)}</tbody>
                </table>
              </div>
            </SectionCard>
          )}

          <SectionCard id="rows" title={d('stepRows')} testId="import-rows">
            <Segmented label={d('filter')} value={filter} onChange={(f) => { setFilter(f); setShown(SHOW) }} options={['all', 'errors', 'warnings', 'ok'].map((f) => ({ value: f, label: d(`f.${f}`), count: filterPreviewRows(result.rows, f).length }))} />
            {rows.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{d('emptyRows')}</p> : (
              <div className="mt-3 overflow-x-auto rounded-card border" role="region" aria-label={d('stepRows')}>
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-surface text-xs font-bold text-athar-ink"><tr><th scope="col" className="px-3 py-2 text-start">{d('colRow')}</th><th scope="col" className="px-3 py-2 text-start">{d('colName')}</th><th scope="col" className="px-3 py-2 text-start">{d('colPlan')}</th><th scope="col" className="px-3 py-2 text-start">{d('colIssues')}</th></tr></thead>
                  <tbody>
                    {rows.slice(0, shown).map((r) => (
                      <tr key={r.row} className="border-t align-top" data-plan={r.plan}>
                        <td className="px-3 py-2 tabular-nums">{r.row}</td>
                        <td className="px-3 py-2">
                          <span className="font-semibold">{r.name || '—'}</span>
                          {r.company_id && <span className="block text-xs text-muted-foreground">{d('matched', { name: pick({ name_en: r.company_name_en, name_ar: r.company_name_ar }, 'name') })}</span>}
                          {r.ceo && <span className="block text-xs text-muted-foreground"><span dir="ltr">{r.ceo.id_masked}</span> · {d('derivedLine', { age: r.ceo.age, gender: labels.label('gender', r.ceo.gender), gov: govName(r.ceo.governorate) })}</span>}
                        </td>
                        <td className="px-3 py-2"><Badge tone={r.plan === 'create' ? 'green' : r.plan === 'update' ? 'blue' : 'red'}>{d(`plan.${r.plan}`)}</Badge></td>
                        <td className="px-3 py-2">
                          {r.issues.length === 0 ? <span className="text-xs text-muted-foreground">{d('noIssues')}</span> : (
                            <ul className="space-y-1">
                              {[...r.issues].sort((a, b) => issueLevelRank(a.level) - issueLevelRank(b.level)).map((i, k) => (
                                <li key={`${i.field}-${i.code}-${k}`} className="flex items-start gap-1.5"><Badge tone={tone(i.level)} className="shrink-0">{d(`level.${i.level}`)}</Badge><span className="min-w-0 break-words">{issueText(i)}</span></li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > shown && <div className="mt-3 flex justify-center"><Button variant="outline" onClick={() => setShown((n) => n + SHOW)}>{d('showMore', { count: rows.length - shown })}</Button></div>}
          </SectionCard>

          <SectionCard id="apply" title={d('applyTitle')}>
            <p id="apply-note" className="text-sm text-muted-foreground">{d('applyBody')}</p>
            <div className="mt-3"><Button disabled aria-describedby="apply-note">{d('applyButton')}</Button></div>
          </SectionCard>
        </>
      )}
    </AdminPage>
  )
}
