import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, History, NotebookPen, Save } from 'lucide-react'
import { NEW_ROW, upsertCompanySnapshot } from '../../../data/alumni.js'
import { useAlumniOverview, useAlumniPrograms, useAlumniTable, useSnapshotRows } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { SELECT_CLASS } from '../../../ui/Field.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import UnsavedGuard from '../../../shared/alumni/UnsavedGuard.jsx'
import { cn } from '../../../lib/cn.js'
import { parseAlumniError } from '../../../lib/alumni.js'
import { findConflicts } from '../../../lib/alumniConflicts.js'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import { AdminPage, CheckRow, CompanyLogo, Pagination, Segmented } from './ui.jsx'
import ExportDialog from './ExportDialog.jsx'
import SnapshotNotes from './SnapshotNotes.jsx'
import SnapshotHistory from './SnapshotHistory.jsx'
import { parseState, mergeSearch, toRpcFilters } from './adminState.js'
import { SNAP_FIELDS, defaultSnapshotYear, snapshotPatch, snapshotToForm, validateSnapshotForm, yearOptions } from './adminLogic.js'
import { useAdminErrorText, useDebounced } from './hooks.js'
import './i18n.common.js'
import './workspace.i18n.js'
import './workspace.edit.i18n.js'
import '../../../shared/alumni/i18n.edit.js'

const PAGE_SIZE = 25
const MONEY = new Set(['revenue_total', 'funding_raised_total'])

/**
 * M9: the M&E workspace. One grid, one yearly row per company: type the five figures of the chosen year and save ONLY what changed (each row is one `upsert_company_snapshot`:
 * patch semantics, the database checks female <= total and the amounts). Edits survive paging and searching (they live here until saved or discarded). The yearly text fields
 * (traction, challenges, needs) and the history of a company (every year, source, who) open in dialogs.
 */
export default function WorkspacePage() {
  const { t, tn, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.ws.${k}`, v)
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const errorText = useAdminErrorText()
  const e = useEditText()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseState(params), [params])
  const overview = useAlumniOverview()
  const programs = useAlumniPrograms()
  const year = state.year ?? (overview.data ? defaultSnapshotYear(overview.data.latest_year) : null)
  const filters = useMemo(() => toRpcFilters(state.filters), [state.filters])
  const table = useAlumniTable({ filters, limit: PAGE_SIZE, offset: (state.page - 1) * PAGE_SIZE, sort: 'name', dir: 'asc', year }, { enabled: Boolean(year) })
  const rows = table.data?.rows ?? []
  const ids = rows.map((r) => r.id)
  const snaps = useSnapshotRows(ids, year)
  const snapOf = useMemo(() => new Map((snaps.data ?? []).map((s) => [s.company_id, s])), [snaps.data])
  const [edits, setEdits] = useState({}) // { [companyId]: { name, base: form, changed: { field: 'typed' } } }
  const [rowErrors, setRowErrors] = useState({})
  const [saving, setSaving] = useState(null)
  const [notesOf, setNotesOf] = useState(null)
  const [historyOf, setHistoryOf] = useState(null)
  const [exporting, setExporting] = useState(false)
  const update = (patch) => setParams(mergeSearch(params, { ...state, ...patch }), { replace: true })

  const [qText, setQText] = useState(state.filters.q ?? '')
  const debouncedQ = useDebounced(qText, 300)
  const commitSearch = useEffectEvent((q) => { if (q !== (state.filters.q ?? '')) update({ filters: { ...state.filters, q }, page: 1 }) })
  useEffect(() => { commitSearch(debouncedQ) }, [debouncedQ])

  const dirtyIds = Object.keys(edits).filter((id) => Object.keys(edits[id].changed).length > 0)
  const formOf = (r) => ({ ...(edits[r.id]?.base ?? snapshotToForm(snapOf.get(r.id))), ...(edits[r.id]?.changed ?? {}) })

  function onCell(r, field, value) {
    setEdits((e) => {
      const base = e[r.id]?.base ?? snapshotToForm(snapOf.get(r.id))
      const changed = { ...(e[r.id]?.changed ?? {}), [field]: value }
      if (value === base[field]) delete changed[field]
      const next = { ...e, [r.id]: { name: pick(r, 'name'), base, changed } }
      if (Object.keys(changed).length === 0) delete next[r.id]
      return next
    })
    setRowErrors((x) => { const n = { ...x }; delete n[r.id]; return n })
  }
  async function changeYear(value) {
    if (dirtyIds.length > 0) {
      const ok = await confirm({ title: d('discardTitle'), message: d('discardBody'), confirmLabel: d('discardYes'), cancelLabel: d('keep'), destructive: true })
      if (!ok) return
      setEdits({})
      setRowErrors({})
    }
    update({ year: value ? Number(value) : null, page: 1 })
  }

  async function saveAll() {
    const todo = dirtyIds.map((id) => ({ id, ...edits[id], form: { ...edits[id].base, ...edits[id].changed } }))
    if (todo.some((x) => Object.keys(validateSnapshotForm(x.form)).length > 0)) { toast.warning(d('fixErrors')); return }
    const failed = {}
    const stale = []
    let ok = 0
    for (let i = 0; i < todo.length; i += 1) {
      setSaving({ done: i, total: todo.length })
      const x = todo[i]
      try {
        // each row is saved with the version of the row the grid loaded (NEW_ROW = no row yet): a row a founder saved meanwhile is a conflict, never overwritten unseen
        await upsertCompanySnapshot(x.id, year, snapshotPatch(x.base, x.form), snapOf.get(x.id)?.updated_at ?? NEW_ROW)
        ok += 1
        setEdits((cur) => { const n = { ...cur }; delete n[x.id]; return n })
      } catch (err) {
        if (parseAlumniError(err).token === 'alumni_stale') stale.push(x.id)
        else failed[x.id] = errorText(err)
      }
    }
    setSaving(null)
    // a stale row: load what the other side saved, keep what I typed, mark the figures we BOTH changed to different values
    if (stale.length > 0) {
      const fresh = await snaps.refetch()
      const byCompany = new Map((fresh.data ?? []).map((s) => [s.company_id, s]))
      const notes = {}
      const patchEdits = {}
      const dropIds = []
      for (const id of stale) {
        const cur1 = edits[id]
        if (!cur1) continue
        const row = byCompany.get(id) ?? null
        const freshForm = snapshotToForm(row)
        const mine = { ...cur1.base, ...cur1.changed }
        const conflicts = findConflicts({ base: cur1.base, mine, fresh: freshForm, keys: Object.keys(cur1.changed) }).map((c) => c.key)
        const changed = Object.fromEntries(Object.entries(cur1.changed).filter(([k, v]) => String(v) !== String(freshForm[k] ?? '')))
        if (Object.keys(changed).length === 0) dropIds.push(id)
        else patchEdits[id] = { ...cur1, base: freshForm, changed, conflicts, freshForm }
        notes[id] = { who: e.who({ source: row?.source }, 'manager'), date: row?.updated_at, open: Object.keys(changed).length > 0 }
      }
      setEdits((cur) => { const next = { ...cur, ...patchEdits }; for (const id of dropIds) delete next[id]; return next })
      for (const [id, k] of Object.entries(notes)) failed[id] = t(k.open ? 'alumni.admin.ws.rowStale' : 'alumni.admin.ws.rowReloaded', { who: k.who, date: e.dateTime(k.date) })
    }
    setRowErrors(failed)
    // one refresh for the whole batch (every refresh re-reads the table, the overview and the analytics)
    await qc.invalidateQueries({ queryKey: ['alumni'], predicate: (q) => q.queryKey[1] !== 'lookups' })
    const bad = Object.keys(failed).length
    if (bad === 0) toast.success(tn('alumni.admin.ws.saved', ok))
    else toast.error(d('savedPartly', { ok, failed: bad }))
  }

  const years = yearOptions(overview.data?.latest_year)
  const skeleton = <SkeletonList count={6} />
  return (
    <AdminPage
      testId="alumni-admin-workspace"
      title={d('title')}
      subtitle={d('subtitle')}
      actions={<Button variant="outline" size="sm" onClick={() => setExporting(true)} disabled={(table.data?.total ?? 0) === 0}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{d('exportOwner')}</Button>}
    >
      <UnsavedGuard when={dirtyIds.length > 0} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="ws-year" className="block text-sm font-medium text-athar-ink">{d('year')}</label>
          <select id="ws-year" className={`${SELECT_CLASS} w-auto`} value={year ?? ''} onChange={(e) => changeYear(e.target.value)} disabled={!year}>
            {years.concat(year && !years.includes(year) ? [year] : []).sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <SearchBar className="min-w-60 flex-1 sm:max-w-xs" label={d('search')} placeholder={d('searchPlaceholder')} value={qText} onChange={setQText} />
        <div className="space-y-1">
          <label htmlFor="ws-program" className="block text-sm font-medium text-athar-ink">{d('program')}</label>
          <select id="ws-program" className={`${SELECT_CLASS} w-auto`} value={state.filters.program_id ?? ''} onChange={(e) => update({ filters: { ...state.filters, program_id: e.target.value }, page: 1 })}>
            <option value="">{d('anyProgram')}</option>
            {(programs.data?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{pick(p, 'name')}</option>)}
          </select>
        </div>
        <Segmented label={d('scope')} value={filters.scope === 'all' ? 'all' : 'alumni'} onChange={(v) => update({ filters: { ...state.filters, scope: v }, page: 1 })} options={['alumni', 'all'].map((v) => ({ value: v, label: d(`scope.${v}`) }))} />
      </div>
      <CheckRow checked={filters.incomplete === true} onChange={(v) => update({ filters: { ...state.filters, incomplete: v ? true : '' }, page: 1 })} label={d('onlyIncomplete')} />

      {/* The order matters: a query that FAILED or came back EMPTY must not wait for the next one. useSnapshotRows is disabled while there is no row, so its isPending stays true for ever:
          the snapshots are only waited for when there are rows to show. */}
      {!year && overview.isError ? <ErrorState error={overview.error} title={d('loadFailed')} onRetry={() => overview.refetch()} />
        : !year || table.isPending ? skeleton
        : table.isError ? <ErrorState error={table.error} title={d('loadFailed')} onRetry={() => table.refetch()} />
        : rows.length === 0 ? <EmptyState title={d('empty')} body={d('emptyBody')} />
        : snaps.isError ? <ErrorState error={snaps.error} title={d('snapshotsFailed')} onRetry={() => snaps.refetch()} />
        : snaps.isPending ? skeleton
        : (
          <>
            <div role="region" aria-label={d('title')} className="relative overflow-x-auto rounded-card border bg-card" data-testid="ws-grid">
              <table className="w-full min-w-[60rem] text-sm">
                <thead className="bg-surface text-xs font-bold text-athar-ink">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start">{d('colCompany')}</th>
                    <th scope="col" className="px-3 py-2 text-start">{d('colStatus')} ({year})</th>
                    {SNAP_FIELDS.map((f) => <th key={f} scope="col" className="px-2 py-2 text-start">{d(`col.${f}`)}{MONEY.has(f) ? ` (${t('alumni.admin.common.egp')})` : ''}</th>)}
                    <th scope="col" className="px-3 py-2 text-start"><span className="sr-only">{d('colNotes')} / {d('colHistory')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const name = pick(r, 'name') || '—'
                    const form = formOf(r)
                    const errs = validateSnapshotForm(form)
                    const dirty = Boolean(edits[r.id]) && Object.keys(edits[r.id].changed).length > 0
                    const has = snapOf.has(r.id)
                    return (
                      <tr key={r.id} className={cn('border-t align-top', dirty && 'bg-accent/10', rowErrors[r.id] && 'bg-destructive/5')} data-testid="ws-row" data-dirty={dirty || undefined}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2"><CompanyLogo path={r.logo_path} size={28} /><Link to={`/alumni/admin/company/${r.id}`} className="font-semibold text-primary hover:underline">{name}</Link></span>
                          <span className="mt-1 block text-xs text-muted-foreground">{d('colProfile')}: {r.completeness?.percent ?? 0}%</span>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={has ? 'green' : 'amber'}>{has ? d('reported') : d('missing')}</Badge>
                          {has && snapOf.get(r.id)?.updated_at && <span className="mt-1 block text-[11px] text-muted-foreground" data-testid="ws-stamp">{d('stampLine', { who: e.sourceLabel(snapOf.get(r.id).source), date: e.date(snapOf.get(r.id).updated_at) })}</span>}
                          {dirty && <Badge tone="blue" className="ms-1">{d('dirty')}</Badge>}
                          {rowErrors[r.id] && <p className="mt-1 max-w-48 text-xs text-destructive-text" role="alert">{d('failed')}: {rowErrors[r.id]}</p>}
                        </td>
                        {SNAP_FIELDS.map((f) => (
                          <td key={f} className="px-2 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              aria-label={d('cellLabel', { field: d(`col.${f}`), company: name })}
                              aria-invalid={errs[f] ? true : undefined}
                              aria-describedby={errs[f] ? `ws-${r.id}-${f}-err` : undefined}
                              title={errs[f] ? d(`err.${errs[f]}`) : undefined}
                              value={form[f]}
                              onChange={(e) => onCell(r, f, e.target.value)}
                              className={cn('min-h-11 w-full min-w-24 rounded-input border bg-input-bg px-2 text-end tabular-nums focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20', errs[f] || edits[r.id]?.conflicts?.includes(f) ? 'border-destructive' : 'border-input', edits[r.id]?.changed[f] !== undefined && !edits[r.id]?.conflicts?.includes(f) && 'border-primary')}
                            />
                            {edits[r.id]?.conflicts?.includes(f) && <span className="mt-0.5 block text-xs text-destructive-text" data-testid="ws-conflict-cell">{d('nowValue', { value: edits[r.id].freshForm?.[f] || '-' })}</span>}
                            {errs[f] && <span id={`ws-${r.id}-${f}-err`} role="alert" className="mt-0.5 block text-xs text-destructive-text">{d(`err.${errs[f]}`)}</span>}
                          </td>
                        ))}
                        <td className="px-2 py-2">
                          <span className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setNotesOf({ id: r.id, name, snapshot: snapOf.get(r.id) })} aria-label={`${d('colNotes')}: ${name}`} title={d('colNotes')}><NotebookPen className="h-4 w-4" aria-hidden="true" /></Button>
                            <Button variant="ghost" size="sm" onClick={() => setHistoryOf({ id: r.id, name })} aria-label={`${d('colHistory')}: ${name}`} title={d('colHistory')}><History className="h-4 w-4" aria-hidden="true" /></Button>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={table.data.total} page={state.page} size={PAGE_SIZE} onPage={(p) => update({ page: p })} />
          </>
        )}

      <div className={cn('-mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-3', dirtyIds.length > 0 && 'sticky bottom-0 z-20')} data-testid="ws-savebar">
        <p className={cn('text-sm font-semibold', dirtyIds.length === 0 && 'text-muted-foreground')} aria-live="polite">{dirtyIds.length > 0 ? tn('alumni.admin.ws.changedRows', dirtyIds.length) : d('nothingToSave')}</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setEdits({}); setRowErrors({}) }} disabled={dirtyIds.length === 0 || Boolean(saving)}>{d('discard')}</Button>
          <Button onClick={saveAll} disabled={dirtyIds.length === 0} loading={Boolean(saving)} data-testid="ws-save"><Save className="h-4 w-4" aria-hidden="true" />{saving ? d('saving', saving) : tn('alumni.admin.ws.saveAll', dirtyIds.length)}</Button>
        </div>
      </div>

      {notesOf && <SnapshotNotes key={notesOf.id} year={year} company={notesOf} onClose={() => setNotesOf(null)} />}
      {historyOf && <SnapshotHistory company={historyOf} onClose={() => setHistoryOf(null)} />}
      {exporting && <ExportDialog open onClose={() => setExporting(false)} filters={filters} count={table.data?.total ?? 0} latestYear={year} defaultYear={year} />}
    </AdminPage>
  )
}
