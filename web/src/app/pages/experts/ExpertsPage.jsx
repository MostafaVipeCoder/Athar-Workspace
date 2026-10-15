import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, ArrowDown, ArrowUp, Copy, Download, ExternalLink, Filter, ImageOff, Plus, Upload, UserPlus, Users } from 'lucide-react'
import { useAuth } from '../../AuthContext.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { Badge } from '../../../ui/Badge.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { SELECT_CLASS } from '../../../ui/Field.jsx'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { LinkedinIcon } from './icons.jsx'
import { usePrograms } from '../../../data/programs.js'
import { listRegistryForExport, useExpertRegistry, useExpertTags } from '../../../data/people.js'
import { exportRows } from '../../../lib/export/xlsx.js'
import {
  activeFilterCount, DEFAULT_DIR, DEFAULT_LIST_STATE, displayName, EXPERT_SORTS, exportColumns, exportFileName, languageName, LANGUAGES, LIST_PARAM_KEYS, listStateToParams, otherName, PAGE_SIZES,
  parseListState, participationOf, roleLine, safeHref, tagName,
} from '../../../lib/experts.js'
import { cn } from '../../../lib/cn.js'
import './experts.i18n.js'
import { ArchivedBadge, DeletedBadge, ExpertPhoto, KindBadge, ParticipationFigures, RegistryPager, StatTile, TagChips } from './parts.jsx'
import { errorText, useExpertsBase } from './hooks.js'

const ExpertFormModal = lazy(() => import('./ExpertFormModal.jsx'))
const ImportDialog = lazy(() => import('./ImportDialog.jsx'))

const SORT_LABEL = { name: 'experts.sort.name', programs: 'experts.sort.programs', projects: 'experts.sort.projects', sessions: 'experts.sort.sessions', last: 'experts.sort.last', updated: 'experts.sort.updated', created: 'experts.sort.created' }
const triOptions = (t, key) => [['', t('experts.filter.any')], ['yes', t(`experts.filter.${key}.yes`)], ['no', t(`experts.filter.${key}.no`)]]

/**
 * The Athar Network EXPERTS REGISTRY (owner: "where every trainer who took part in our programs is gathered, which programs each took part in and how many times").
 * A searchable, sortable, paged list of every record (experts and Athar team members) with the participation figures derived live by the database, filters (kind, state, programs
 * joined, expertise tags, language, has photo / e-mail, ever took part), Excel export of the whole filtered set, Excel import (preview first) and "add expert".
 * ALL state lives in the URL (search, filters, sort, page): a link is a view, Back works, a refresh keeps the place.
 */
export default function ExpertsPage() {
  const { t, tn, lang, formatNumber } = useLanguage()
  const { can } = useAuth()
  const toast = useToast()
  const base = useExpertsBase()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseListState(params), [params])
  const registry = useExpertRegistry(state, lang)
  const programs = usePrograms()
  const tags = useExpertTags()
  const [filtersOpen, setFiltersOpen] = useState(() => activeFilterCount(parseListState(params)) > 0)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [term, setTerm] = useState(state.q)
  const [seenQ, setSeenQ] = useState(state.q)
  const timer = useRef(null)
  const canMerge = can('experts:merge')
  useEffect(() => () => clearTimeout(timer.current), [])

  // the URL is the source of truth: when it changes from outside (Back, "Clear filters"), the box follows
  if (seenQ !== state.q) {
    setSeenQ(state.q)
    setTerm(state.q)
  }

  // write the list state to the URL, keeping the keys that are not ours (the app's ?lang=)
  const write = (next) => {
    const out = listStateToParams(next)
    for (const [k, v] of params) if (!LIST_PARAM_KEYS.includes(k)) out.set(k, v)
    setParams(out, { replace: true })
  }
  const update = (patch, { keepPage = false } = {}) => {
    const next = { ...state, ...patch }
    if (!keepPage && !('page' in patch)) next.page = 1
    write(next)
  }
  const onSearch = (value) => {
    setTerm(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => update({ q: value }), 300)
  }
  const sortBy = (key) => update(state.sort === key ? { dir: state.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: DEFAULT_DIR[key] })
  const clearAll = () => {
    clearTimeout(timer.current)
    setTerm('')
    setSeenQ('')
    write({ ...DEFAULT_LIST_STATE, sort: state.sort, dir: state.dir, size: state.size })
  }

  const data = registry.data
  const rows = data?.rows ?? []
  const counts = data?.counts ?? {}
  const filterCount = activeFilterCount(state)
  const anyNarrowing = filterCount > 0 || state.q.trim() !== ''
  const view = state.state === 'archived' ? 'archived' : state.state === 'deleted' ? 'deleted' : state.kind || 'all'

  const pickView = (v) => {
    if (v === 'archived' || v === 'deleted') update({ state: v, kind: '' })
    else update({ state: 'active', kind: v === 'all' ? '' : v })
  }
  const viewOptions = [
    { value: 'all', label: t('experts.view.all'), count: counts.active },
    { value: 'expert', label: t('experts.view.expert'), count: counts.expert },
    { value: 'team', label: t('experts.view.team'), count: counts.team },
    { value: 'archived', label: t('experts.view.archived'), count: counts.archived },
    ...(canMerge ? [{ value: 'deleted', label: t('experts.view.deleted'), count: counts.deleted }] : []),
  ]

  async function doExport() {
    setExporting(true)
    try {
      const all = await listRegistryForExport(state, lang)
      const n = await exportRows(all, exportColumns(t, lang), exportFileName(), { sheetName: t('experts.title') })
      toast.success(tn('experts.toast.exported', n))
    } catch (e) {
      toast.error(errorText(t, e))
    } finally {
      setExporting(false)
    }
  }

  const programOptions = programs.data ?? []
  const tagOptions = (tags.data ?? []).filter((x) => !x.archived)

  return (
    <div className="space-y-5" data-testid="experts-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-section-title">{t('experts.title')}</h1>
          <p className="mt-1 hidden max-w-2xl text-base text-muted-foreground sm:block">{t('experts.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canMerge && (
            <Link to={`${base}/duplicates`} className={buttonClass({ variant: 'outline', size: 'sm' })} data-testid="experts-duplicates-link">
              <Copy className="h-4 w-4" aria-hidden="true" />
              {t('experts.action.duplicates')}
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={() => setImporting(true)} data-testid="experts-import">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t('experts.action.import')}
          </Button>
          <Button variant="outline" size="sm" onClick={doExport} loading={exporting} disabled={!data || data.total === 0} data-testid="experts-export">
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('experts.action.export')}
          </Button>
          <Button onClick={() => setCreating(true)} data-testid="experts-add">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('experts.action.add')}
          </Button>
        </div>
      </header>

      <div className="hidden grid-cols-2 gap-3 md:grid md:grid-cols-4" data-testid="experts-stats">
        <StatTile label={t('experts.view.expert')} value={formatNumber(counts.expert ?? 0)} icon={Users} onClick={() => pickView('expert')} active={view === 'expert'} />
        <StatTile label={t('experts.view.team')} value={formatNumber(counts.team ?? 0)} icon={UserPlus} onClick={() => pickView('team')} active={view === 'team'} />
        <StatTile label={t('experts.stat.withoutPhoto')} value={formatNumber(counts.without_photo ?? 0)} icon={ImageOff} onClick={() => update({ state: 'active', photo: 'no' })} active={state.photo === 'no'} />
        <StatTile label={t('experts.view.archived')} value={formatNumber(counts.archived ?? 0)} icon={Archive} onClick={() => pickView('archived')} active={view === 'archived'} />
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('experts.view.label')}>
        {viewOptions.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={view === o.value}
            onClick={() => pickView(o.value)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              view === o.value ? 'border-foreground bg-foreground text-background' : 'border-input bg-background text-foreground hover:bg-surface',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn('rounded-full px-1.5 text-xs tabular-nums', view === o.value ? 'bg-background/20' : 'bg-surface')}>{formatNumber(o.count ?? 0)}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBar value={term} onChange={onSearch} label={t('experts.search.label')} placeholder={t('experts.search.placeholder')} className="w-full min-w-0 sm:w-80" />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('experts.sort.label')}</span>
          <select className={cn(SELECT_CLASS, 'min-h-11 w-auto py-1')} value={state.sort} onChange={(e) => update({ sort: e.target.value, dir: DEFAULT_DIR[e.target.value] })} data-testid="experts-sort">
            {EXPERT_SORTS.map((s) => <option key={s} value={s}>{t(SORT_LABEL[s])}</option>)}
          </select>
        </label>
        <Button variant="outline" size="icon" onClick={() => update({ dir: state.dir === 'asc' ? 'desc' : 'asc' })} aria-label={state.dir === 'asc' ? t('experts.sort.asc') : t('experts.sort.desc')} title={state.dir === 'asc' ? t('experts.sort.asc') : t('experts.sort.desc')}>
          {state.dir === 'asc' ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : <ArrowDown className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-controls="experts-filters" data-testid="experts-filters-toggle">
          <Filter className="h-4 w-4" aria-hidden="true" />
          {t('experts.filter.title')}
          {filterCount > 0 && <Badge tone="blue">{formatNumber(filterCount)}</Badge>}
        </Button>
        {anyNarrowing && <Button variant="ghost" size="sm" onClick={clearAll} data-testid="experts-clear">{t('experts.filter.clear')}</Button>}
      </div>

      {filtersOpen && (
        <section id="experts-filters" aria-label={t('experts.filter.title')} className="grid gap-4 rounded-card border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="experts-filters">
          <FilterSelect label={t('experts.filter.participation')} value={state.part} onChange={(v) => update({ part: v })} options={[['', t('experts.filter.any')], ['yes', t('experts.filter.participation.yes')], ['no', t('experts.filter.participation.no')]]} />
          <FilterSelect
            label={t('experts.filter.program')}
            value={state.program}
            onChange={(v) => update({ program: v })}
            options={[['', t('experts.filter.any')], ...programOptions.map((g) => [g.id, (lang === 'ar' ? g.name_ar || g.name_en : g.name_en || g.name_ar) || '-'])]}
            hint={t('experts.filter.program.hint')}
          />
          <FilterSelect label={t('experts.filter.language')} value={state.language} onChange={(v) => update({ language: v })} options={[['', t('experts.filter.any')], ...LANGUAGES.map((l) => [l.code, languageName(l.code, lang)])]} />
          <FilterSelect label={t('experts.filter.photo')} value={state.photo} onChange={(v) => update({ photo: v })} options={triOptions(t, 'photo')} />
          <FilterSelect label={t('experts.filter.email')} value={state.email} onChange={(v) => update({ email: v })} options={triOptions(t, 'email')} />
          <fieldset className="min-w-0 sm:col-span-2 lg:col-span-3">
            <legend className="mb-1.5 text-sm font-medium text-athar-ink">{t('experts.filter.tags')}</legend>
            {tagOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('experts.filter.tags.none')}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {tagOptions.map((tg) => {
                  const on = state.tags.includes(tg.id)
                  return (
                    <li key={tg.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => update({ tags: on ? state.tags.filter((x) => x !== tg.id) : [...state.tags, tg.id] })}
                        className={cn(
                          'inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9',
                          on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-input hover:bg-surface',
                        )}
                      >
                        {tagName(tg, lang)}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </fieldset>
        </section>
      )}

      <p className="sr-only" role="status" aria-live="polite">{data && !registry.isError ? tn('experts.results', data.total) : ''}</p>

      {registry.isPending ? (
        <SkeletonList count={6} itemClassName="h-16 w-full" />
      ) : registry.isError ? (
        <ErrorState error={registry.error} title={t('experts.loadFailed')} onRetry={() => registry.refetch()} />
      ) : data.total === 0 ? (
        anyNarrowing || state.state !== 'active' ? (
          <EmptyState
            icon={Users}
            title={t('experts.empty.filtered.title')}
            body={t('experts.empty.filtered.body')}
            action={<Button variant="outline" onClick={clearAll}>{t('experts.filter.clear')}</Button>}
          />
        ) : (
          <EmptyState
            icon={Users}
            title={t('experts.empty.title')}
            body={t('experts.empty.body')}
            action={
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />{t('experts.action.add')}</Button>
                <Button variant="outline" onClick={() => setImporting(true)}><Upload className="h-4 w-4" aria-hidden="true" />{t('experts.action.import')}</Button>
              </div>
            }
          />
        )
      ) : (
        <div className={cn('space-y-4 transition-opacity', registry.isFetching && 'opacity-60')} aria-busy={registry.isFetching || undefined}>
          {/* desktop: a real table with sortable headers; phone / tablet: cards */}
          <div className="hidden lg:block">
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm" data-testid="experts-table">
              <caption className="sr-only">{t('experts.title')}</caption>
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[22%]" />
                <col className="w-[30%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead>
                <tr className="text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <SortTh label={t('experts.col.name')} sortKey="name" state={state} onSort={sortBy} />
                  <th scope="col" className="border-b px-3 py-2 text-start">{t('experts.col.tags')}</th>
                  <SortTh label={t('experts.col.participation')} sortKey="programs" state={state} onSort={sortBy} />
                  <SortTh label={t('experts.col.last')} sortKey="last" state={state} onSort={sortBy} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <ExpertTableRow key={r.id} row={r} base={base} search={params.toString()} lang={lang} />)}
              </tbody>
            </table>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden" data-testid="experts-cards">
            {rows.map((r) => <ExpertCardItem key={r.id} row={r} base={base} search={params.toString()} lang={lang} />)}
          </ul>
          <RegistryPager total={data.total} page={state.page} size={state.size} onPage={(p) => update({ page: p }, { keepPage: true })} onSize={(s) => update({ size: s, page: 1 })} sizes={PAGE_SIZES} />
        </div>
      )}

      {(creating || importing) && (
        <Suspense fallback={null}>
          {creating && <ExpertFormModal onClose={() => setCreating(false)} base={base} />}
          {importing && <ImportDialog onClose={() => setImporting(false)} />}
        </Suspense>
      )}
    </div>
  )
}

function FilterSelect({ label, value, onChange, options, hint }) {
  return (
    <label className="block min-w-0 space-y-1.5 text-sm">
      <span className="block font-medium text-athar-ink">{label}</span>
      <select className={cn(SELECT_CLASS, 'min-h-11')} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v || 'any'} value={v}>{l}</option>)}
      </select>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** A sortable column header: a button inside the th (keyboard + screen reader: aria-sort on the th). */
function SortTh({ label, sortKey, state, onSort }) {
  const { t } = useLanguage()
  const active = state.sort === sortKey
  return (
    <th scope="col" aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="border-b px-3 py-1 text-start">
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex min-h-9 items-center gap-1 rounded-sm font-semibold uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={t('experts.sort.by', { column: label })}>
        {label}
        {active && (state.dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />)}
      </button>
    </th>
  )
}

function Identity({ row, base, search, lang, size = 'sm', stretch = false }) {
  const name = displayName(row, lang) || '-'
  const other = otherName(row, lang)
  const role = roleLine(row, lang)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ExpertPhoto expert={row} size={size} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5">
          <Link to={`${base}/${row.id}`} state={{ back: search ? `?${search}` : '' }} className={cn('inline-flex min-h-11 max-w-full items-center truncate font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9 ltr:text-left rtl:text-right', stretch && "after:absolute after:inset-0 after:content-['']")} dir="auto" data-testid="expert-link">{name}</Link>
          <KindBadge kind={row.kind} />
          {row.deleted ? <DeletedBadge /> : row.archived && <ArchivedBadge />}
        </p>
        {other && <p className="truncate text-xs text-muted-foreground ltr:text-left rtl:text-right" dir="auto">{other}</p>}
        {role && <p className="truncate text-xs text-muted-foreground ltr:text-left rtl:text-right" dir="auto">{role}</p>}
      </div>
    </div>
  )
}

function ContactIcons({ row }) {
  const { t, lang } = useLanguage()
  const who = displayName(row, lang)
  const linkedin = safeHref(row.linkedin)
  const website = safeHref(row.website)
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {linkedin && (
        <a href={linkedin} target="_blank" rel="noopener noreferrer" className="relative z-10 inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface lg:h-9 lg:w-9 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${t('experts.field.linkedin')}: ${who}`}>
          <LinkedinIcon className="h-4 w-4" />
        </a>
      )}
      {website && (
        <a href={website} target="_blank" rel="noopener noreferrer" className="relative z-10 inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface lg:h-9 lg:w-9 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${t('experts.field.website')}: ${who}`}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      )}
    </span>
  )
}

function ExpertTableRow({ row, base, search, lang }) {
  return (
    <tr className="align-top transition-colors hover:bg-surface/60" data-testid="expert-row">
      <td className="border-b px-3 py-3"><Identity row={row} base={base} search={search} lang={lang} /></td>
      <td className="border-b px-3 py-3"><TagChips tags={row.tags} max={3} /></td>
      <td className="border-b px-3 py-3"><ParticipationFigures row={participationOf(row)} showLast={false} /></td>
      <td className="border-b px-3 py-3">
        <LastCell row={row} />
        <ContactIcons row={row} />
      </td>
    </tr>
  )
}

function LastCell({ row }) {
  const { t, formatDate } = useLanguage()
  return <span className="block text-xs text-muted-foreground tabular-nums">{row.lastOn ? formatDate(row.lastOn, { dateStyle: 'medium', timeZone: 'UTC' }) : row.sessions > 0 ? t('experts.participation.noDate') : '-'}</span>
}

function ExpertCardItem({ row, base, search, lang }) {
  return (
    <li className="relative min-w-0 space-y-3 rounded-card border bg-card p-4 transition-colors hover:border-foreground/40" data-testid="expert-card">
      <Identity row={row} base={base} search={search} lang={lang} size="md" stretch />
      <TagChips tags={row.tags} max={3} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <ParticipationFigures row={participationOf({ ...row })} />
        <ContactIcons row={row} />
      </div>
    </li>
  )
}
