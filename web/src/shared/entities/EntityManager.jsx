import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, LayoutGrid, Pencil, Table2, Trash2, Unlink, Users } from 'lucide-react'
import './i18n.js'
import { Button } from '../../ui/Button.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { Img } from '../../ui/Img.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { publicThumbUrl } from '../../data/storage.js'
import { biPick, visibleCardFields } from '../../lib/entities.js'
import { cn } from '../../lib/cn.js'
import { EntityCard } from './EntityCard.jsx'
import { DEFAULT_MANAGER_STATE, SORTS, SOURCE_FILTERS, canReorder, filterItems, moveItem, sortItems } from './manager.logic.js'

/** Status select used in the table, the cards and the bulk bar. `statuses` = [{key,label,tone}] from the list config. */
function StatusSelect({ value, statuses, onChange, lang, t, label, className, disabled }) {
  const known = statuses.some((s) => s.key === value)
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn('min-h-9 rounded-md border border-input bg-background px-2 text-sm', className)}
    >
      <option value="">{t('entity.manager.filter.noStatus')}</option>
      {statuses.map((s) => (
        <option key={s.key} value={s.key}>{biPick(s.label, lang) || s.key}</option>
      ))}
      {value && !known && <option value={value}>{value}</option>}
    </select>
  )
}

/** Inline text that saves on blur / Enter when changed (notes column). */
function InlineText({ value, onSave, label, placeholder }) {
  const [v, setV] = useState(value ?? '')
  const [seen, setSeen] = useState(value ?? '')
  if ((value ?? '') !== seen) {
    setSeen(value ?? '')
    setV(value ?? '')
  }
  const commit = () => {
    if (v !== (value ?? '')) onSave(v)
  }
  return (
    <input
      aria-label={label}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setV(value ?? '')
      }}
      className="min-h-9 w-full min-w-28 rounded-md border border-input bg-background px-2 text-sm"
    />
  )
}

function SourceBadges({ item, t }) {
  return (
    <>
      <Badge tone="outline">{t(`entity.source.${item.source.kind}`)}</Badge>
      {item.missing && <Badge tone="red">{t('entity.source.missing')}</Badge>}
      {item.excluded && <Badge tone="amber">{t('entity.source.hidden')}</Badge>}
    </>
  )
}

/**
 * Generic curated-list manager (design 06 section 6.2 EntityManager; replaces ExpertManager + StartupManager). Purely
 * presentational + local UI state: the caller owns the data (ListItemView[] from data/lists) and the writes (`actions`).
 *
 * actions: { setStatus(item, status), patchOverlay(item, patch), exclude(item, excluded), reorder(items), remove(item),
 *            detach(item), edit(item), bulkStatus(items, status), bulkExclude(items, excluded), export(items) }
 * config:  normalised list config ({ statuses, card.showFields }); `toolbar` = extra buttons (add manual, pick, import).
 * Rules preserved from the as-is managers (docs/03 section 7.3) without their bugs: reorder is disabled while a search
 * or filter is active (so a filtered subset never writes unfiltered indexes), order is persisted and read back.
 */
export function EntityManager({ items, kind = 'generic', config, loading = false, error = null, onRetry, actions, toolbar, busyId = null, initialState, extraColumns = [], cardExtra = null, extraRowActions = null, disabledActions = [], bulkExtra = null, onOpen = null, sortExtra = null }) {
  const { t, lang } = useLanguage()
  const [state, setState] = useState(() => ({ ...DEFAULT_MANAGER_STATE, ...(initialState ?? {}) }))
  const [selected, setSelected] = useState(() => new Set())
  const [dragId, setDragId] = useState(null)
  const [override, setOverride] = useState(null) // optimistic order until the refetch lands
  const set = (partial) => setState((s) => ({ ...s, ...partial }))
  const statuses = useMemo(() => config?.statuses ?? [], [config])
  const hasStatuses = statuses.length > 0

  if (override && override.base !== items) setOverride(null)
  const base = useMemo(() => override?.list ?? items ?? [], [override, items])
  const visible = useMemo(() => {
    const filtered = filterItems(base, state)
    const extra = sortExtra?.find((s) => s.key === state.sort)
    return extra ? extra.sort([...filtered]) : sortItems(filtered, state.sort, lang, statuses.map((s) => s.key))
  }, [base, state, lang, statuses, sortExtra])
  const off = useMemo(() => new Set(disabledActions), [disabledActions])
  const reorderable = canReorder(state) && !loading
  const selectedItems = visible.filter((i) => selected.has(i.id))
  const allSelected = visible.length > 0 && selectedItems.length === visible.length
  const toggle = (id) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  function commitOrder(next) {
    setOverride({ base: items, list: next })
    actions.reorder(next)
  }
  function move(from, to) {
    const next = moveItem(base, from, to)
    if (next !== base) commitOrder(next)
  }
  function onDrop(targetId) {
    if (!dragId || dragId === targetId) return
    const from = base.findIndex((i) => i.id === dragId)
    const to = base.findIndex((i) => i.id === targetId)
    setDragId(null)
    if (from >= 0 && to >= 0) move(from, to)
  }

  const rowActions = (item) => (
    <div className="flex flex-nowrap items-center gap-1">
      {extraRowActions?.(item)}
      {!off.has('edit') && (
        <Button size="icon" variant="ghost" onClick={() => actions.edit(item)} aria-label={`${t('common.edit')}: ${biPick(item.entity.title, lang)}`} title={t('common.edit')} disabled={busyId === item.id}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      {!off.has('hide') && (
        <Button size="icon" variant="ghost" onClick={() => actions.exclude(item, !item.excluded)} aria-label={`${item.excluded ? t('entity.bulk.unhide') : t('entity.bulk.hide')}: ${biPick(item.entity.title, lang)}`} title={item.excluded ? t('entity.bulk.unhide') : t('entity.bulk.hide')} disabled={busyId === item.id}>
          {item.excluded ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
        </Button>
      )}
      {!off.has('detach') && item.source.kind !== 'manual' && (
        <Button size="icon" variant="ghost" onClick={() => actions.detach(item)} aria-label={`${t('entity.manager.detach')}: ${biPick(item.entity.title, lang)}`} title={t('entity.manager.detach')} disabled={busyId === item.id}>
          <Unlink className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      {!off.has('remove') && item.source.kind !== 'form_response' && item.itemId && (
        <Button size="icon" variant="ghost" onClick={() => actions.remove(item)} aria-label={`${t('entity.manager.remove')}: ${biPick(item.entity.title, lang)}`} title={t('entity.manager.remove')} disabled={busyId === item.id} className="text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )

  return (
    <div className="space-y-3" data-testid="entity-manager">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchBar value={state.term} onChange={(term) => set({ term })} placeholder={t('entity.manager.search')} className="min-w-56 flex-1" />
        {hasStatuses && (
          <select aria-label={t('entity.manager.filter.status')} value={state.status} onChange={(e) => set({ status: e.target.value })} className="min-h-11 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">{t('entity.manager.filter.anyStatus')}</option>
            <option value="__none">{t('entity.manager.filter.noStatus')}</option>
            {statuses.map((s) => <option key={s.key} value={s.key}>{biPick(s.label, lang) || s.key}</option>)}
          </select>
        )}
        <select aria-label={t('entity.manager.filter.source')} value={state.source} onChange={(e) => set({ source: e.target.value })} className="min-h-11 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">{t('entity.manager.filter.anySource')}</option>
          {SOURCE_FILTERS.map((s) => <option key={s} value={s}>{t(`entity.source.${s}`)}</option>)}
        </select>
        <select aria-label={t('entity.manager.sort')} value={state.sort} onChange={(e) => set({ sort: e.target.value })} className="min-h-11 rounded-md border border-input bg-background px-2 text-sm">
          {SORTS.filter((s) => s !== 'status' || hasStatuses).map((s) => <option key={s} value={s}>{t(`entity.manager.sort.${s}`)}</option>)}
          {(sortExtra ?? []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={state.showHidden} onChange={(e) => set({ showHidden: e.target.checked })} className="h-4 w-4" />
          {t('entity.manager.filter.showHidden')}
        </label>
        <div className="inline-flex rounded-md border" role="group" aria-label={t('entity.manager.viewMode')}>
          <Button size="sm" variant={state.view === 'table' ? 'secondary' : 'ghost'} onClick={() => set({ view: 'table' })} aria-pressed={state.view === 'table'}>
            <Table2 className="h-4 w-4" aria-hidden="true" />{t('entity.manager.table')}
          </Button>
          <Button size="sm" variant={state.view === 'cards' ? 'secondary' : 'ghost'} onClick={() => set({ view: 'cards' })} aria-pressed={state.view === 'cards'}>
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />{t('entity.manager.cards')}
          </Button>
        </div>
        {toolbar}
      </div>

      {/* selection / bulk bar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex min-h-9 items-center gap-2">
          <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((i) => i.id)) : new Set())} className="h-4 w-4" aria-label={t('entity.manager.selectAll')} disabled={visible.length === 0} />
          {selectedItems.length > 0 ? t('entity.manager.selected', { count: selectedItems.length }) : t('entity.manager.selectAll')}
        </label>
        <span className="text-muted-foreground">{t('entity.manager.count', { shown: visible.length, total: base.length })}</span>
        {selectedItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" data-testid="bulk-bar">
            {hasStatuses && <StatusSelect value="" statuses={statuses} lang={lang} t={t} label={t('entity.bulk.setStatus')} onChange={(s) => s && actions.bulkStatus(selectedItems, s)} />}
            {bulkExtra?.(selectedItems)}
            {!off.has('hide') && <Button size="sm" variant="outline" onClick={() => actions.bulkExclude(selectedItems, true)}>{t('entity.bulk.hide')}</Button>}
            {!off.has('hide') && <Button size="sm" variant="outline" onClick={() => actions.bulkExclude(selectedItems, false)}>{t('entity.bulk.unhide')}</Button>}
            {actions.export && <Button size="sm" variant="outline" onClick={() => actions.export(selectedItems)}>{t('entity.bulk.export')}</Button>}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t('entity.manager.clearSelection')}</Button>
          </div>
        )}
        {!reorderable && state.view === 'table' && !loading && base.length > 1 && <span className="text-xs text-muted-foreground">{t('entity.manager.reorderDisabled')}</span>}
      </div>

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : visible.length === 0 ? (
        <EmptyState icon={Users} title={base.length === 0 ? t(`entity.manager.emptyList.${kind}`) : t('entity.manager.empty')} body={base.length === 0 ? t('entity.manager.emptyListBody') : undefined} />
      ) : state.view === 'table' ? (
        <div className="overflow-x-auto rounded-input border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-start text-xs font-semibold uppercase text-athar-ink">
              <tr>
                <th className="w-8 p-2"><span className="sr-only">{t('entity.manager.selectAll')}</span></th>
                {reorderable && <th className="w-16 p-2"><span className="sr-only">{t('entity.manager.sort.manual')}</span></th>}
                <th className="p-2 text-start">{t('entity.manager.col.item')}</th>
                {hasStatuses && <th className="p-2 text-start">{t('entity.manager.col.status')}</th>}
                {extraColumns.map((c) => <th key={c.key} className="p-2 text-start">{c.header}</th>)}
                <th className="p-2 text-start">{t('entity.manager.col.notes')}</th>
                <th className="p-2 text-start">{t('entity.manager.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item, idx) => {
                const title = biPick(item.entity.title, lang) || '-'
                const sub = [biPick(item.entity.subtitle, lang), biPick(item.entity.organization, lang)].filter(Boolean).join(' · ')
                return (
                  <tr
                    key={item.id}
                    data-testid="item-row"
                    data-item-id={item.id}
                    className={cn('border-t align-middle', item.excluded && 'opacity-60', dragId === item.id && 'bg-accent/40', busyId === item.id && 'animate-pulse')}
                    draggable={reorderable}
                    onDragStart={reorderable ? () => setDragId(item.id) : undefined}
                    onDragOver={reorderable ? (e) => e.preventDefault() : undefined}
                    onDrop={reorderable ? () => onDrop(item.id) : undefined}
                    onDragEnd={() => setDragId(null)}
                  >
                    <td className="p-2"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="h-4 w-4" aria-label={`${t('entity.manager.select')}: ${title}`} /></td>
                    {reorderable && (
                      <td className="p-1">
                        <div className="flex items-center">
                          <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden="true" title={t('entity.manager.dragHandle')} />
                          <div className="flex flex-col">
                            <button type="button" className="rounded p-0.5 hover:bg-surface disabled:opacity-30" onClick={() => move(base.indexOf(item), base.indexOf(item) - 1)} disabled={idx === 0} aria-label={`${t('entity.manager.moveUp')}: ${title}`}><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
                            <button type="button" className="rounded p-0.5 hover:bg-surface disabled:opacity-30" onClick={() => move(base.indexOf(item), base.indexOf(item) + 1)} disabled={idx === visible.length - 1} aria-label={`${t('entity.manager.moveDown')}: ${title}`}><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
                          </div>
                        </div>
                      </td>
                    )}
                    <td className="p-2">
                      <div className="flex items-center gap-3">
                        <Img src={publicThumbUrl(item.entity.imagePath)} variant="thumb" alt="" aspect="1 / 1" className={cn('h-10 w-10 shrink-0', kind === 'company' ? 'rounded-md' : 'rounded-full')} fit={kind === 'company' ? 'contain' : 'cover'} />
                        <div className="min-w-0">
                          {onOpen ? (
                            <button type="button" className="text-start font-medium hover:underline" onClick={() => onOpen(item)}>{title}</button>
                          ) : (
                            <p className="font-medium">{title}</p>
                          )}
                          {sub && <p className="line-clamp-2 text-xs text-muted-foreground">{sub}</p>}
                          <div className="mt-1 flex flex-wrap gap-1"><SourceBadges item={item} t={t} /></div>
                        </div>
                      </div>
                    </td>
                    {hasStatuses && (
                      <td className="p-2">
                        <StatusSelect value={item.status} statuses={statuses} lang={lang} t={t} label={`${t('entity.manager.col.status')}: ${title}`} onChange={(s) => actions.setStatus(item, s)} disabled={busyId === item.id} />
                      </td>
                    )}
                    {extraColumns.map((c) => <td key={c.key} className="p-2 text-sm">{c.cell(item)}</td>)}
                    <td className="p-2">
                      <InlineText value={item.overlay?.notes ?? ''} label={`${t('entity.manager.col.notes')}: ${title}`} placeholder={t('entity.manager.notesPlaceholder')} onSave={(notes) => actions.patchOverlay(item, { notes: notes.trim() || null })} />
                    </td>
                    <td className="w-1 whitespace-nowrap p-2">{rowActions(item)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="manager-cards">
          {visible.map((item) => {
            const title = biPick(item.entity.title, lang) || '-'
            return (
              <li key={item.id} className="min-w-0" data-testid="item-card">
                <EntityCard
                  entity={item.entity}
                  show={visibleCardFields(config?.card?.showFields, item.card)}
                  accent={config?.card?.accent ?? undefined}
                  muted={item.excluded || item.missing}
                  badges={
                    <>
                      <label className="me-1 inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="h-4 w-4" aria-label={`${t('entity.manager.select')}: ${title}`} /></label>
                      <SourceBadges item={item} t={t} />
                    </>
                  }
                  actions={
                    <div className="flex w-full flex-wrap items-center gap-1">
                      {cardExtra && <div className="w-full text-xs text-muted-foreground">{cardExtra(item)}</div>}
                      {hasStatuses && <StatusSelect value={item.status} statuses={statuses} lang={lang} t={t} label={`${t('entity.manager.col.status')}: ${title}`} onChange={(s) => actions.setStatus(item, s)} className="flex-1" />}
                      {rowActions(item)}
                    </div>
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
export default EntityManager
