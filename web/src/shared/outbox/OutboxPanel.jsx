import { useDeferredValue, useMemo, useState } from 'react'
import { Mail, RefreshCw, RotateCcw, Send, Trash2, CheckCheck } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Button } from '../../ui/Button.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { formatDateTime, formatRelative } from '../../lib/time/format.js'
import { FILTER_STATES, activeCount, attentionCount, bulkTargets, emailKeyLabel, explanationKey, isRetryWaiting, rowActions, stateOf, totalCount } from '../../lib/outbox.js'
import { useOutbox, useOutboxMutations } from '../../data/outbox.js'
import { OutboxStateBadge } from './OutboxStateBadge.jsx'
import { OutboxDetail } from './OutboxDetail.jsx'
import { sendNowMessage } from './sendNowMessage.js'

const PAGE = 50
const ATTENTION = ['needs_review', 'failed', 'blocked']
const selectCls = 'min-h-11 rounded-md border border-input bg-background px-2 text-sm lg:min-h-9'
const chipCls = (active) => cn('tap-target rounded-md px-3 text-sm transition-colors', active ? 'bg-foreground text-background' : 'hover:bg-surface')

/**
 * The Outbox of a project (m62, design 07 section 1.6): every e-mail the platform queued for it with its REAL delivery state, filters (queued / sending / sent /
 * failed / needs review / waiting), search, per-row details (subject, message, history, Message-ID), and the actions the database allows per state:
 * retry, cancel, mark as sent manually and send again on purpose (each confirmed when it cannot be undone), in bulk too, plus "Send now".
 * Refreshes on focus and every 10 s while mail is on its way (no socket; a hidden tab pauses it).
 *
 * Props: projectId, nodes [{ id, name }] for the node filter, tz (the project's zone), initial { node, state } from the URL.
 */
export function OutboxPanel({ projectId, nodes = [], tz = 'Africa/Cairo', initial = {}, onFilterChange = null }) {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const m = useOutboxMutations(projectId)
  const [stateFilter, setStateFilter] = useState(initial.state ?? null) // null | 'attention' | one state
  const [nodeId, setNodeId] = useState(initial.node ?? '')
  const [term, setTerm] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState(() => new Set())
  const [openId, setOpenId] = useState(null)
  const search = useDeferredValue(term)

  const states = stateFilter === 'attention' ? ATTENTION : stateFilter ? [stateFilter] : null
  const q = useOutbox(projectId, { states, nodeId: nodeId || null, search, limit })
  const counts = q.data?.counts ?? {}
  const rows = useMemo(() => q.data?.rows ?? [], [q.data])
  const total = q.data?.total ?? 0
  const selectedRows = rows.filter((r) => selected.has(r.id))
  const targets = bulkTargets(selectedRows)
  const attention = attentionCount(counts)
  const waiting = (counts.queued ?? 0) + (counts.blocked ?? 0)
  const nodeName = (id) => nodes.find((n) => n.id === id)?.name ?? ''

  const change = (next) => {
    setSelected(new Set())
    setLimit(PAGE)
    onFilterChange?.(next)
  }
  const pickState = (s) => { setStateFilter(s); change({ node: nodeId || null, state: s }) }
  const pickNode = (id) => { setNodeId(id); change({ node: id || null, state: stateFilter }) }
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  async function run(kind, ids, { confirmWith = null } = {}) {
    if (ids.length === 0) { toast.info(t('outbox.toast.none')); return null }
    if (confirmWith && !(await confirm({ title: t(`outbox.confirm.${confirmWith}.title`, { count: ids.length }), message: t(`outbox.confirm.${confirmWith}.body`), destructive: confirmWith === 'cancel' || confirmWith === 'resend', confirmLabel: confirmWith === 'resend' ? t('outbox.confirm.resend.action') : undefined }))) return null
    try {
      const r = await m[kind].mutateAsync({ ids })
      toast[r?.skipped ? 'warning' : 'success'](t(r?.skipped ? 'outbox.toast.partial' : 'outbox.toast.done', { updated: r?.updated ?? 0, skipped: r?.skipped ?? 0 }))
      setSelected(new Set())
      return r
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
      return null
    }
  }
  async function sendNow() {
    try {
      const r = await m.sendNow.mutateAsync({ project: projectId })
      toast.success(t(sendNowMessage(r), { released: r?.released ?? 0 }))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    }
  }

  // "now" for the relative texts = the moment of the last fetch (a render must stay pure; the list refetches while mail is on its way)
  const now = q.dataUpdatedAt || 0
  const when = (r) => {
    const st = stateOf(r)
    if (st === 'sent' && r.sent_at) return { text: t('outbox.when.sent', { time: formatRelative(r.sent_at, { lang, now: new Date(now) }) }), title: formatDateTime(r.sent_at, { lang, tz }) }
    if (st === 'queued' && new Date(r.next_attempt_at).getTime() > now + 2_000) return { text: t(isRetryWaiting(r) ? 'outbox.when.retry' : 'outbox.when.next', { time: formatRelative(r.next_attempt_at, { lang, now: new Date(now) }) }), title: formatDateTime(r.next_attempt_at, { lang, tz }) }
    if (st === 'blocked' && new Date(r.next_attempt_at).getTime() > now) return { text: t('outbox.when.next', { time: formatRelative(r.next_attempt_at, { lang, now: new Date(now) }) }), title: formatDateTime(r.next_attempt_at, { lang, tz }) }
    return { text: t('outbox.when.created', { time: formatRelative(r.created_at, { lang, now: new Date(now) }) }), title: formatDateTime(r.created_at, { lang, tz }) }
  }

  const chips = [
    { key: null, label: t('outbox.filter.all'), count: totalCount(counts) },
    ...(attention > 0 || stateFilter === 'attention' ? [{ key: 'attention', label: t('outbox.filter.attention'), count: attention }] : []),
    ...FILTER_STATES.map((s) => ({ key: s, label: t(`outbox.state.${s}`), count: counts[s] ?? 0 })),
  ]

  return (
    <div className="space-y-4" data-testid="outbox-panel">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBar value={term} onChange={(v) => { setTerm(v); setLimit(PAGE); setSelected(new Set()) }} label={t('outbox.search.label')} className="min-w-56 flex-1" />
        {nodes.length > 0 && (
          <select aria-label={t('outbox.node.label')} value={nodeId} onChange={(e) => pickNode(e.target.value)} className={selectCls} data-testid="outbox-node-filter">
            <option value="">{t('outbox.node.all')}</option>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        )}
        <Button size="sm" variant="outline" onClick={() => q.refetch()} loading={q.isFetching && !q.isPending} aria-label={t('outbox.action.refresh')} data-testid="outbox-refresh">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('outbox.action.refresh')}
        </Button>
        {waiting > 0 && (
          <Button size="sm" onClick={sendNow} loading={m.sendNow.isPending} data-testid="outbox-send-now">
            <Send className="h-4 w-4" aria-hidden="true" />{t('outbox.action.sendNow')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t('outbox.filter.label')}>
        {chips.map((c) => (
          <button key={String(c.key)} type="button" role="tab" aria-selected={stateFilter === c.key} onClick={() => pickState(c.key)} className={chipCls(stateFilter === c.key)} data-testid={`outbox-filter-${c.key ?? 'all'}`}>
            {c.label} <span className="tabular-nums opacity-80">({c.count})</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" role="status" data-testid="outbox-live">
        {q.dataUpdatedAt ? t('outbox.updated.at', { time: formatDateTime(q.dataUpdatedAt, { lang, tz, dateStyle: undefined, timeStyle: 'medium' }) }) : ''}
        {activeCount(counts) > 0 ? ` · ${t('outbox.live.on')}` : ''}
      </p>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-surface px-3 py-2" role="region" aria-label={t('outbox.bulk.selected', { count: selected.size })} data-testid="outbox-bulk">
          <span className="text-sm font-semibold">{t('outbox.bulk.selected', { count: selected.size })}</span>
          <Button size="sm" variant="outline" disabled={targets.retry.length === 0} onClick={() => run('retry', targets.retry)} data-testid="bulk-retry"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('outbox.bulk.retry', { count: targets.retry.length })}</Button>
          <Button size="sm" variant="outline" disabled={targets.markSent.length === 0} onClick={() => run('markSent', targets.markSent, { confirmWith: 'markSent' })} data-testid="bulk-mark-sent"><CheckCheck className="h-4 w-4" aria-hidden="true" />{t('outbox.bulk.markSent', { count: targets.markSent.length })}</Button>
          <Button size="sm" variant="outline" disabled={targets.resend.length === 0} onClick={() => run('resend', targets.resend, { confirmWith: 'resend' })} data-testid="bulk-resend"><Send className="h-4 w-4" aria-hidden="true" />{t('outbox.bulk.resend', { count: targets.resend.length })}</Button>
          <Button size="sm" variant="outline" className="text-destructive-text" disabled={targets.cancel.length === 0} onClick={() => run('cancel', targets.cancel, { confirmWith: 'cancel' })} data-testid="bulk-cancel"><Trash2 className="h-4 w-4" aria-hidden="true" />{t('outbox.bulk.cancel', { count: targets.cancel.length })}</Button>
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setSelected(new Set())}>{t('outbox.bulk.clear')}</Button>
        </div>
      )}

      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} title={t('outbox.error.title')} onRetry={q.refetch} /> : rows.length === 0 ? (
        <EmptyState icon={Mail} title={t(totalCount(counts) === 0 && !search && !nodeId ? 'outbox.empty.title' : 'outbox.empty.filtered')} body={totalCount(counts) === 0 && !search && !nodeId ? t('outbox.empty.body') : undefined} />
      ) : (
        <>
          <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="h-4 w-4" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} data-testid="outbox-select-all" />
            {t('outbox.bulk.selectAll')}
          </label>
          <ul className="divide-y rounded-card border bg-card" data-testid="outbox-list">
            {rows.map((r) => {
              const st = stateOf(r)
              const w = when(r)
              const ek = explanationKey(r)
              const a = rowActions(r)
              const person = r.created_by_name
              return (
                <li key={r.id} className={cn('flex flex-col gap-2 p-3 md:grid md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-start md:gap-4', selected.has(r.id) && 'bg-primary/5')} data-testid="outbox-row" data-state={st} data-id={r.id}>
                  <label className="grid min-h-11 min-w-11 place-items-center md:self-start"><input type="checkbox" className="h-4 w-4" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={t('outbox.row.select', { name: r.recipient })} /></label>
                  <div className="min-w-0">
                    <p className="truncate font-medium" dir="ltr" title={r.recipient}>{r.recipient}</p>
                    <p className="truncate text-xs text-muted-foreground" dir="auto" title={r.subject ?? ''}>{r.subject ?? '-'}</p>
                    {Array.isArray(r.cc) && r.cc.length > 0 && <p className="text-xs text-muted-foreground">{t('outbox.row.cc', { count: r.cc.length })}</p>}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <OutboxStateBadge state={st} data-testid="row-state" />
                      {r.attempts > 1 && <span className="text-xs text-muted-foreground tabular-nums">{t('outbox.row.attempts', { count: r.attempts })}</span>}
                      {r.sender_source === 'system' && st === 'sent' && <span className="text-xs text-muted-foreground">{t('outbox.row.fallback')}</span>}
                    </div>
                    {ek && <p className={cn('line-clamp-3 text-xs', st === 'needs_review' || st === 'failed' ? 'text-foreground' : 'text-muted-foreground')} data-testid="row-explain">{t(ek)}</p>}
                  </div>
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">{t(emailKeyLabel(r.email_key))}</p>
                    {nodeName(r.node_id) || r.node_name?.[lang] || r.node_name?.en ? <p className="truncate" dir="auto">{t('outbox.row.fromNode', { node: nodeName(r.node_id) || r.node_name?.[lang] || r.node_name?.en })}</p> : null}
                    <p title={w.title}>{w.text}</p>
                    {r.resolution && <p>{person ? t(`outbox.when.manual.${r.resolution}`, { name: person }) : t('outbox.when.manual.unknown')}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 md:justify-end">
                    {a.retry && <Button size="sm" variant="ghost" onClick={() => run('retry', [r.id])} aria-label={`${t('outbox.action.retry')}: ${r.recipient}`} data-testid="row-retry"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('outbox.action.retry')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setOpenId(r.id)} aria-label={`${t('outbox.action.details')}: ${r.recipient}`} data-testid="row-details">{t('outbox.action.details')}</Button>
                  </div>
                </li>
              )
            })}
          </ul>
          {total > rows.length && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)} loading={q.isFetching} data-testid="outbox-more">{t('outbox.loadMore', { shown: rows.length, total })}</Button>
            </div>
          )}
        </>
      )}

      {openId && (
        <OutboxDetail
          id={openId}
          summary={rows.find((r) => r.id === openId) ?? null}
          tz={tz}
          onClose={() => setOpenId(null)}
          onAction={async (kind, confirmWith) => {
            const r = await run(kind, [openId], { confirmWith })
            if (r && r.updated > 0 && kind !== 'retry') setOpenId(null)
          }}
        />
      )}
    </div>
  )
}

export default OutboxPanel
