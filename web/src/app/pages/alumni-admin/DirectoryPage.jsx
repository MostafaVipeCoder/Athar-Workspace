import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bookmark, Columns3, FileSpreadsheet, Filter, Plus, Upload } from 'lucide-react'
import { useAlumniMutations } from '../../../data/alumni.js'
import { useAlumniPrograms, useAlumniTable } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { Badge } from '../../../ui/Badge.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { LABEL_CLASS, SELECT_CLASS } from '../../../ui/Field.jsx'
import { AdminPage, Pagination, Segmented } from './ui.jsx'
import DirectoryFilters from './DirectoryFilters.jsx'
import DirectoryTable from './DirectoryTable.jsx'
import AreaTabs from './AreaTabs.jsx'
import ColumnChooser from './ColumnChooser.jsx'
import CompanyDrawer from './CompanyDrawer.jsx'
import ExportDialog from './ExportDialog.jsx'
import SavedViews from './SavedViews.jsx'
import { SCOPES, activeFilterCount, nextSort, parseState, readColumns, mergeSearch, toRpcFilters, writeColumns } from './adminState.js'
import { yearOptions } from './adminLogic.js'
import { useAdminErrorText, useAdminFormat, useDebounced, useLabels } from './hooks.js'
import './i18n.common.js'
import './directory.i18n.js'
import '../../../shared/alumni/i18n.edit.js'

/**
 * M2: the manager directory. Filters, sort, page and year live in the URL; the columns and the saved views in this browser. ONE page of rows is requested at a time
 * (server-side paging, sorting and filtering: `list_alumni_table`), and the table holds every column of the owner's Excel plus a few extras. The export reuses the same
 * filter. Nothing here derives a national-ID value: the server does.
 */
export default function DirectoryPage() {
  const { t, tn, lang } = useLanguage()
  const d = (k, v) => t(`alumni.admin.dir.${k}`, v)
  const labels = useLabels()
  const fmt = useAdminFormat()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const { markAlumni } = useAlumniMutations()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseState(params), [params])
  const update = (patch) => setParams(mergeSearch(params, { ...state, ...patch }), { replace: true })

  const [columns, setColumns] = useState(() => readColumns())
  const [filtersOpen, setFiltersOpen] = useState(() => activeFilterCount(state.filters) > 0)
  const [chooser, setChooser] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [drawerRow, setDrawerRow] = useState(null)
  const [selection, setSelection] = useState({ key: '', ids: [] })

  const programs = useAlumniPrograms()
  const rpcFilters = useMemo(() => toRpcFilters(state.filters), [state.filters])
  const table = useAlumniTable({ filters: rpcFilters, limit: state.size, offset: (state.page - 1) * state.size, sort: state.sort, dir: state.dir, year: state.year })

  // the search box: typing is local, one URL change per pause
  const [qText, setQText] = useState(state.filters.q ?? '')
  const [seenQ, setSeenQ] = useState(state.filters.q ?? '')
  if ((state.filters.q ?? '') !== seenQ) { setSeenQ(state.filters.q ?? ''); setQText(state.filters.q ?? '') }
  const debouncedQ = useDebounced(qText, 300)
  const commitSearch = useEffectEvent((q) => { if (q !== (state.filters.q ?? '')) update({ filters: { ...state.filters, q }, page: 1 }) })
  useEffect(() => { commitSearch(debouncedQ) }, [debouncedQ])

  // a selection belongs to the filter it was made under (a bulk action never reaches rows the manager cannot see)
  const selKey = JSON.stringify([rpcFilters, state.sort, state.dir])
  const selected = new Set(selection.key === selKey ? selection.ids : [])
  const setSelected = (ids) => setSelection({ key: selKey, ids: [...ids] })

  const rows = table.data?.rows ?? []
  const total = table.data?.total ?? 0
  const year = table.data?.year ?? null
  const env = useMemo(() => ({ lookups: labels.lookups, lang, t, num: fmt.num, money: fmt.money, date: fmt.date }), [labels.lookups, lang, t, fmt])
  const hasFilters = activeFilterCount(state.filters) > 0 || Boolean(state.filters.q)

  const onFilters = (patch) => update({ filters: { ...state.filters, ...patch }, page: 1 })
  function toggle(id) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  function toggleAll() {
    const ids = rows.map((r) => r.id)
    setSelected(ids.every((id) => selected.has(id)) ? [...selected].filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])])
  }
  function onColumns(keys) {
    setColumns(keys)
    writeColumns(keys)
  }
  function applyView(v) {
    onColumns(v.columns)
    setParams(mergeSearch(params, { filters: v.filters, sort: v.sort, dir: v.dir, page: 1, size: state.size, year: state.year }), { replace: true })
    setViewsOpen(false)
  }

  async function mark(value) {
    const ids = [...selected]
    const ok = await confirm({
      title: tn(value ? 'alumni.admin.dir.markConfirmTitle' : 'alumni.admin.dir.unmarkConfirmTitle', ids.length),
      message: d(value ? 'markConfirmBody' : 'unmarkConfirmBody'),
      confirmLabel: value ? d('markAlumni') : d('unmarkAlumni'),
      destructive: !value,
    })
    if (!ok) return
    try {
      const r = await markAlumni.mutateAsync({ ids, value })
      toast.success(tn(value ? 'alumni.admin.dir.marked' : 'alumni.admin.dir.unmarked', r.changed))
      setSelected([])
    } catch (e) {
      toast.error(`${d('markFailed')} ${errorText(e)}`)
    }
  }

  const years = yearOptions(year)
  return (
    <AdminPage
      testId="alumni-admin-directory"
      title={d('title')}
      subtitle={d('subtitle')}
      actions={
        <>
          <Link to="/alumni/admin/company/new" className={buttonClass({ variant: 'outline', size: 'sm' })}><Plus className="h-4 w-4" aria-hidden="true" />{d('newCompany')}</Link>
          <Link to="/alumni/admin/directory/import" className={buttonClass({ variant: 'outline', size: 'sm' })}><Upload className="h-4 w-4" aria-hidden="true" />{d('importExcel')}</Link>
          <Button size="sm" onClick={() => setExporting(true)} disabled={total === 0} data-testid="export-open"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{d('export')}</Button>
        </>
      }
    >
      <AreaTabs />

      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchBar className="min-w-60 flex-1 sm:max-w-sm" label={d('searchLabel')} placeholder={d('searchPlaceholder')} value={qText} onChange={setQText} />
          <Segmented label={d('scope')} value={rpcFilters.scope} onChange={(v) => onFilters({ scope: v })} options={SCOPES.map((s) => ({ value: s, label: d(`scope.${s}`) }))} />
          <Button variant={filtersOpen ? 'secondary' : 'outline'} size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
            <Filter className="h-4 w-4" aria-hidden="true" />{d('filters')}
            {activeFilterCount(state.filters) > 0 && <Badge tone="amber" className="ms-1">{activeFilterCount(state.filters)}</Badge>}
          </Button>
          <div className="space-y-1">
            <label htmlFor="dir-year" className={`${LABEL_CLASS} sr-only`}>{d('year')}</label>
            <select id="dir-year" className={`${SELECT_CLASS} min-h-11 w-auto py-1`} value={state.year ?? ''} onChange={(e) => update({ year: e.target.value ? Number(e.target.value) : null })} title={d('year')}>
              <option value="">{d('yearLatest')}{year && !state.year ? ` (${year})` : ''}</option>
              {years.map((y) => <option key={y} value={y}>{d('year')}: {y}</option>)}
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={() => setChooser(true)}><Columns3 className="h-4 w-4" aria-hidden="true" />{d('columns')}</Button>
          <Button variant="outline" size="sm" onClick={() => setViewsOpen(true)}><Bookmark className="h-4 w-4" aria-hidden="true" />{d('views')}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{d(`scopeHint.${rpcFilters.scope}`)}</p>
        {filtersOpen && <DirectoryFilters filters={rpcFilters} onChange={onFilters} programs={programs.data?.programs ?? []} labels={labels} onClear={() => update({ filters: { scope: rpcFilters.scope }, page: 1 })} />}
      </div>

      {selected.size > 0 && (
        <div role="region" aria-label={d('bulkActions')} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-primary/40 bg-primary/5 px-4 py-2" data-testid="bulk-bar">
          <p className="text-sm font-semibold" aria-live="polite">{tn('alumni.admin.common.selectedCount', selected.size)}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => mark(true)} loading={markAlumni.isPending}>{d('markAlumni')}</Button>
            <Button variant="outline" size="sm" onClick={() => mark(false)} disabled={markAlumni.isPending}>{d('unmarkAlumni')}</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>{d('clearSelection')}</Button>
          </div>
        </div>
      )}

      {table.isPending ? (
        <SkeletonList count={6} itemClassName="h-12 w-full" />
      ) : table.isError ? (
        <ErrorState error={table.error} title={d('loadFailed')} onRetry={() => table.refetch()} />
      ) : rows.length === 0 ? (
        rpcFilters.scope === 'alumni' && !hasFilters ? (
          <EmptyState title={d('emptyAlumniTitle')} body={d('emptyAlumniBody')} action={<Button onClick={() => onFilters({ scope: 'candidates' })}>{d('emptyAlumniAction')}</Button>} />
        ) : (
          <EmptyState title={d('emptyTitle')} body={d('emptyBody')} action={hasFilters ? <Button variant="outline" onClick={() => update({ filters: { scope: rpcFilters.scope }, page: 1 })}>{d('clearFilters')}</Button> : null} />
        )
      ) : (
        <>
          <DirectoryTable rows={rows} columns={columns} year={year} sort={state.sort} dir={state.dir} onSort={(k) => update({ ...nextSort(state, k), page: 1 })}
            selected={selected} onToggle={toggle} onToggleAll={toggleAll} onOpen={setDrawerRow} env={env} busy={table.isFetching} />
          <Pagination total={total} page={state.page} size={state.size} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s, page: 1 })} />
        </>
      )}

      <ColumnChooser open={chooser} onClose={() => setChooser(false)} columns={columns} onChange={onColumns} year={year} />
      {viewsOpen && <SavedViews open onClose={() => setViewsOpen(false)} current={{ filters: rpcFilters, sort: state.sort, dir: state.dir, columns }} onApply={applyView} onNotify={(m) => toast.success(m)} />}
      {exporting && <ExportDialog open onClose={() => setExporting(false)} filters={rpcFilters} count={total} latestYear={year} defaultYear={state.year} />}
      {drawerRow && <CompanyDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />}
    </AdminPage>
  )
}
