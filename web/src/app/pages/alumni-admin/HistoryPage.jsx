import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, Filter, X } from 'lucide-react'
import { listAlumniHistory, useAlumniCompany, useAlumniHistory } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { SELECT_CLASS, INPUT_CLASS } from '../../../ui/Field.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { dayBound, historyExportRows } from '../../../lib/alumniHistory.js'
import { activeHistoryFilterCount, HISTORY_ENTITIES, HISTORY_FIELDS, HISTORY_ROLES, HISTORY_SOURCES, mergeHistorySearch, parseHistoryState, toRpcHistoryFilters } from '../../../lib/alumniHistoryState.js'
import { cn } from '../../../lib/cn.js'
import HistoryEntries from '../../../shared/alumni/HistoryEntries.jsx'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import { AdminPage, Pagination, SectionCard } from './ui.jsx'
import AreaTabs from './AreaTabs.jsx'
import AsOfPanel from './AsOfPanel.jsx'
import CompanyPicker from './CompanyPicker.jsx'
import { useAdminErrorText, useDebounced } from './hooks.js'
import './i18n.common.js'
import './area.i18n.js'
import './history.i18n.js'
import '../../../shared/alumni/i18n.edit.js'

function Select({ id, label, value, onChange, children }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-athar-ink">{label}</label>
      <select id={id} className={cn(SELECT_CLASS, 'min-h-11')} value={value} onChange={(ev) => onChange(ev.target.value)}>{children}</select>
    </div>
  )
}

/**
 * The history of edits (owner decision 20.4): every change of a company, a founder or a yearly figure, newest first, with who / when / old / new, filters by company, area, field,
 * year, editor and date, a click on a field for ITS timeline, the company at any date (and two dates compared) and an export. The log is written by the database on every
 * save, so nothing here is a copy: it reads the append-only log. National IDs are never in it (only "an ID exists"); contact details are partly hidden.
 */
export default function HistoryPage() {
  const { t, tn, pick } = useLanguage()
  const h = (k, v) => t(`alumni.admin.hist.${k}`, v)
  const e = useEditText()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseHistoryState(params), [params])
  const update = (patch) => setParams(mergeHistorySearch(params, { ...state, ...patch }), { replace: true })
  const onFilters = (patch) => update({ filters: { ...state.filters, ...patch }, page: 1 })
  const [filtersOpen, setFiltersOpen] = useState(() => activeHistoryFilterCount(state.filters) > 0)
  const [exporting, setExporting] = useState(false)

  const [qText, setQText] = useState(state.filters.q ?? '')
  const [seenQ, setSeenQ] = useState(state.filters.q ?? '')
  if ((state.filters.q ?? '') !== seenQ) { setSeenQ(state.filters.q ?? ''); setQText(state.filters.q ?? '') }
  const debouncedQ = useDebounced(qText, 300)
  const commitSearch = useEffectEvent((q) => { if (q !== (state.filters.q ?? '')) onFilters({ q }) })
  useEffect(() => { commitSearch(debouncedQ) }, [debouncedQ])

  const rpcFilters = useMemo(() => toRpcHistoryFilters(state.filters, dayBound), [state.filters])
  const q = useAlumniHistory({ filters: rpcFilters, limit: state.size, offset: (state.page - 1) * state.size })
  const rows = q.data?.rows ?? []
  const companyId = state.filters.company_id
  const company = useAlumniCompany(companyId)
  const fieldsOfArea = state.filters.entity_type ? HISTORY_FIELDS.filter(([a]) => a === state.filters.entity_type) : HISTORY_FIELDS
  const thisYear = new Date().getFullYear()

  async function exportAll() {
    setExporting(true)
    try {
      const full = await listAlumniHistory({ filters: rpcFilters, limit: 5000, offset: 0 })
      const { exportRows } = await import('../../../lib/export/xlsx.js')
      const ctx = { ...e.ctx, fieldLabel: e.fieldLabel, entityLabel: e.entityLabel, roleLabel: e.roleLabel, sourceLabel: e.sourceLabel, pickName: (o) => (o ? pick(o, 'name') : '') }
      const cols = ['when', 'first', 'company', 'person', 'who', 'role', 'source', 'area', 'field', 'year', 'before', 'after', 'edits', 'partial', 'reason'].map((k) => ({ key: k, header: h(`col.${k}`), format: k === 'when' || k === 'first' ? (v) => (v ? e.dateTime(v) : '') : undefined }))
      const n = await exportRows(historyExportRows(full.rows, ctx), cols, `alumni-history-${new Date().toISOString().slice(0, 10)}`, { sheetName: h('sheet'), blanks: true })
      toast.success(tn('alumni.admin.hist.exported', n))
    } catch (err) {
      toast.error(`${h('exportFailed')} ${errorText(err)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <AdminPage
      testId="alumni-admin-history"
      title={companyId && company.data ? h('companyMode', { company: pick(company.data.company, 'name') }) : h('title')}
      subtitle={h('subtitle')}
      actions={<Button size="sm" onClick={exportAll} loading={exporting} disabled={!q.data || (q.data.total ?? 0) === 0} title={h('exportHint')} data-testid="history-export"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{h('export')}</Button>}
    >
      <AreaTabs />

      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {companyId ? (
            <div className="flex min-h-11 items-center gap-2 rounded-full border bg-card px-3 text-sm" data-testid="history-company-chip">
              <span className="font-semibold">{company.data ? pick(company.data.company, 'name') : '...'}</span>
              <Link to={`/alumni/admin/company/${companyId}`} className="text-xs text-primary hover:underline">{h('openCompany')}</Link>
              <button type="button" onClick={() => onFilters({ company_id: '' })} className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={h('clearCompany')}><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          ) : (
            <>
              <CompanyPicker label={h('pickCompany')} placeholder={h('pickPlaceholder')} className="min-w-60 sm:w-72" onSelect={(r) => onFilters({ company_id: r.id })} />
              <SearchBar className="min-w-60 flex-1 sm:max-w-xs" label={h('search')} placeholder={h('searchPlaceholder')} value={qText} onChange={setQText} />
            </>
          )}
          <Button variant={filtersOpen ? 'secondary' : 'outline'} size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
            <Filter className="h-4 w-4" aria-hidden="true" />{h('filters')}
            {activeHistoryFilterCount(state.filters) > 0 && <Badge tone="amber" className="ms-1">{activeHistoryFilterCount(state.filters)}</Badge>}
          </Button>
        </div>
        {filtersOpen && (
          <div className="grid gap-3 rounded-card border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="history-filters">
            <Select id="hist-area" label={h('area')} value={state.filters.entity_type ?? ''} onChange={(v) => onFilters({ entity_type: v, field: '' })}>
              <option value="">{h('anyArea')}</option>
              {HISTORY_ENTITIES.map((a) => <option key={a} value={a}>{e.entityLabel(a)}</option>)}
            </Select>
            <Select id="hist-field" label={h('field')} value={state.filters.field ?? ''} onChange={(v) => onFilters({ field: v })}>
              <option value="">{h('anyField')}</option>
              {fieldsOfArea.map(([area, list]) => (
                <optgroup key={area} label={e.entityLabel(area)}>{list.map((f) => <option key={`${area}-${f}`} value={f}>{e.fieldLabel(f)}</option>)}</optgroup>
              ))}
            </Select>
            <Select id="hist-year" label={h('year')} value={state.filters.year ?? ''} onChange={(v) => onFilters({ year: v, entity_type: v ? 'snapshot' : state.filters.entity_type })}>
              <option value="">{h('anyYear')}</option>
              {Array.from({ length: 8 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Select id="hist-source" label={h('source')} value={state.filters.source ?? ''} onChange={(v) => onFilters({ source: v })}>
              <option value="">{h('anySource')}</option>
              {HISTORY_SOURCES.map((s) => <option key={s} value={s}>{e.sourceLabel(s)}</option>)}
            </Select>
            <Select id="hist-role" label={h('role')} value={state.filters.actor_role ?? ''} onChange={(v) => onFilters({ actor_role: v })}>
              <option value="">{h('anyRole')}</option>
              {HISTORY_ROLES.map((r) => <option key={r} value={r}>{e.roleLabel(r)}</option>)}
            </Select>
            <div className="space-y-1"><label htmlFor="hist-from" className="block text-sm font-medium text-athar-ink">{h('from')}</label><input id="hist-from" type="date" className={cn(INPUT_CLASS, 'min-h-11')} value={state.filters.from ?? ''} max={state.filters.to ?? undefined} onChange={(ev) => onFilters({ from: ev.target.value })} /></div>
            <div className="space-y-1"><label htmlFor="hist-to" className="block text-sm font-medium text-athar-ink">{h('to')}</label><input id="hist-to" type="date" className={cn(INPUT_CLASS, 'min-h-11')} value={state.filters.to ?? ''} min={state.filters.from ?? undefined} onChange={(ev) => onFilters({ to: ev.target.value })} /></div>
            <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => update({ filters: companyId ? { company_id: companyId } : {}, page: 1 })}>{h('clearFilters')}</Button></div>
          </div>
        )}
        {state.filters.field && (
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="history-field-banner">
            <Badge tone="blue">{h('fieldBanner', { field: e.fieldLabel(state.filters.field) })}</Badge>
            <Button variant="ghost" size="sm" onClick={() => onFilters({ field: '' })}>{h('clearField')}</Button>
          </p>
        )}
      </div>

      {companyId && (
        <SectionCard id="asof" title={h('asOfTitle')}>
          <AsOfPanel companyId={companyId} />
        </SectionCard>
      )}

      {q.isPending ? <SkeletonList count={5} itemClassName="h-20 w-full" />
        : q.isError ? <ErrorState error={q.error} title={h('loadFailed')} onRetry={() => q.refetch()} />
        : rows.length === 0 ? <EmptyState title={h('empty')} body={h('emptyBody')} />
        : (
          <>
            <p className="text-sm font-semibold" aria-live="polite" data-testid="history-count">{tn('alumni.admin.hist.count', q.data.total)} <span className="font-normal text-muted-foreground">{h('countSaves')}</span></p>
            <div className={cn(q.isFetching && 'opacity-70')}>
              <HistoryEntries rows={rows} audience="manager" showCompany={!companyId} onField={(f) => onFilters({ field: f })} />
            </div>
            <Pagination total={q.data.total} page={state.page} size={state.size} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s, page: 1 })} />
          </>
        )}
    </AdminPage>
  )
}
