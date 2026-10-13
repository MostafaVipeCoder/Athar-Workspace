import { useMemo, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Download, Mail, Star } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { invalidateNodeOutputs } from '../_kit/invalidate.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { Field } from '../../ui/Field.jsx'
import { materializeItem, useListItems, useListMutations } from '../../data/lists.js'
import { useSelectionExtras, useSelectionMutations } from '../../data/selection.js'
import { getFormDefinition } from '../../data/forms.js'
import { useAuth } from '../../app/AuthContext.js'
import { keys } from '../../data/queryKeys.js'
import { biPick, isActiveItem } from '../../lib/entities.js'
import { exportRows } from '../../lib/export/xlsx.js'
import { staffPath } from '../../lib/links.js'
import { cn } from '../../lib/cn.js'
import { EntityManager } from '../../shared/entities/EntityManager.jsx'
import { useWithdrawFlow } from '../../shared/entities/useWithdrawFlow.jsx'
import { ItemEditor } from '../../shared/entities/ItemEditor.jsx'
import { ApplicantDrawer } from './ApplicantDrawer.jsx'
import { EmailsTab } from './EmailsTab.jsx'
import { boardColumns, effectiveStage, emailIndex, normalizeSelectionConfig, scoreIndex, stageCounts, stageOf, stagesAsStatuses, withdrawnCount } from './selectionConfig.js'

/** The extra pill of the board that shows the applicants marked WITHDRAWN (kept apart from the stage counts). */
const WITHDRAWN_PILL = '__withdrawn'

const STATUS_TONE = { queued: 'blue', sending: 'blue', sent: 'green', failed: 'red', dead: 'red', cancelled: 'neutral', needs_review: 'amber' }

/** Form nodes feeding this stage, directly or through upstream stages (the chain keeps the ORIGINAL response). */
function upstreamForms(graph, nodeId) {
  const edges = (graph?.edges ?? []).filter((e) => e.is_enabled !== false)
  const nodes = graph?.nodes ?? []
  const seen = new Set()
  const forms = []
  const queue = [nodeId]
  while (queue.length) {
    const cur = queue.shift()
    for (const e of edges) {
      if (e.to_node_id !== cur || seen.has(e.from_node_id)) continue
      seen.add(e.from_node_id)
      const n = nodes.find((x) => x.id === e.from_node_id)
      if (!n) continue
      if (n.type === 'form_builder') forms.push(n)
      else if (n.type === 'selection' || n.type === 'list') queue.push(n.id)
    }
  }
  return forms
}

/**
 * Edit mode of a Selection stage (design 01 section 3.4 / 02 section 7): the reviewer board over the stage's
 * applicants (the list resolver: form responses or an upstream stage's accepted items, by reference) with the stage
 * workflow (status = stage key, reason modal for decisions, hold with "move back"), reviewer scores, filters/search/
 * sort, Excel export with labelled answers, the applicant drawer, and the E-mails tab (templates + outbox sends).
 * Every write is an immediate row-level save (02 section 6); the DB bumps the revision so downstream stages refresh.
 * WITHDRAWN (decision 17.1) replaces "Hide": "Mark as withdrawn" (confirmation, optional reason, Undo) keeps the applicant on the
 * board with a red chip and a "Withdrawn" pill, outside the stage counts, and takes it out of this stage's output ports, the
 * e-mail recipients and every later step; "Reinstate" brings it back as it was. Marking it here writes the SAME fact as the
 * Participants page and the lists (the participant row), so the person leaves the whole program at once.
 */
export default function SelectionEdit() {
  const { node, projectId, graph } = useNodeContext()
  const { t, lang, pick, formatDate } = useLanguage()
  const toast = useToast()
  const qc = useQueryClient()
  const { user } = useAuth()
  const config = useMemo(() => normalizeSelectionConfig(node.config), [node.config])
  const items = useListItems(node.id, { filter: { include_excluded: true, include_withdrawn: true, with_fields: true }, kind: 'company' })
  const extras = useSelectionExtras(node.id)
  const onChanged = () => invalidateNodeOutputs(qc, graph, node.id, projectId)
  const m = useListMutations(node.id, { onChanged })
  const sm = useSelectionMutations(node.id, { onChanged })
  const [tab, setTab] = useState('board')
  const [stage, setStage] = useState('')
  const [open, setOpen] = useState(null) // item id of the drawer
  const [editor, setEditor] = useState(null)
  const [reason, setReason] = useState(null) // { items, status, stage }
  const [reasonText, setReasonText] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [preselect, setPreselect] = useState(null)

  const sources = useMemo(() => {
    const edges = (graph?.edges ?? []).filter((e) => e.to_node_id === node.id && e.to_port === 'applicants' && e.is_enabled !== false)
    return edges.map((e) => (graph?.nodes ?? []).find((n) => n.id === e.from_node_id)).filter(Boolean)
  }, [graph, node.id])
  const forms = useMemo(() => upstreamForms(graph, node.id), [graph, node.id])
  const defs = useQueries({ queries: forms.map((f) => ({ queryKey: keys.formDef(f.id), queryFn: () => getFormDefinition(f.id), staleTime: 60_000 })) })
  const fields = useMemo(() => {
    const out = []
    const seen = new Set()
    for (const d of defs) for (const q of d.data?.questions ?? []) {
      if (seen.has(q.key)) continue
      seen.add(q.key)
      out.push({ name: q.key, type: q.type, label: { en: q.label_en ?? '', ar: q.label_ar ?? '' }, canonical: q.semantic ?? null })
    }
    return out
  }, [defs])

  // effective stage: a never-touched applicant waits in the inbox stage
  const rows = useMemo(() => (items.data ?? []).map((i) => ({ ...i, status: effectiveStage(i, config) })), [items.data, config])
  const reviews = useMemo(() => Object.fromEntries((extras.data?.reviews ?? []).map((r) => [r.item_id, r])), [extras.data])
  const scores = useMemo(() => scoreIndex(extras.data?.scores ?? [], user?.id), [extras.data, user?.id])
  const emails = useMemo(() => emailIndex(extras.data?.emails ?? []), [extras.data])
  const participants = useMemo(() => {
    const out = {}
    for (const p of extras.data?.participants ?? []) out[p.form_response_id ?? p.company_id] = p
    return out
  }, [extras.data])
  const counts = useMemo(() => stageCounts(rows, config), [rows, config])
  const nWithdrawn = useMemo(() => withdrawnCount(rows), [rows])
  const nActive = useMemo(() => rows.filter(isActiveItem).length, [rows])
  const statuses = useMemo(() => stagesAsStatuses(config), [config])
  // a virtual applicant changes its client id once its overlay row exists (first edit): match the source as well
  const openItem = open ? rows.find((i) => i.id === open.id || (open.sourceId && i.source.id === open.sourceId)) ?? null : null
  const nameOf = (item) => biPick(item.entity.title, lang) || '-'

  async function run(fn, { item = null, success = null } = {}) {
    if (item) setBusyId(item.id)
    try {
      const out = await fn()
      if (success) toast.success(success)
      return out
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
      return undefined
    } finally {
      if (item) setBusyId(null)
    }
  }

  const flow = useWithdrawFlow({
    nameOf,
    onWithdraw: (list, reason) => (list.length === 1 ? m.withdraw.mutateAsync({ item: list[0], reason }) : m.bulkWithdraw.mutateAsync({ items: list, reason })),
    onReinstate: (list) => (list.length === 1 ? m.reinstate.mutateAsync({ item: list[0] }) : m.bulkReinstate.mutateAsync({ items: list })),
  })

  /** Decision stages (accept / hold / reject, or any stage flagged requireReason) ask for a reason first. */
  function requestStatus(list, status, { skipReason = false } = {}) {
    const def = stageOf(config, status)
    const needs = !skipReason && status && def && (def.requireReason || ['accept', 'hold', 'reject'].includes(def.type))
    if (needs) {
      setReasonText('')
      setReason({ items: list, status, stage: def })
      return
    }
    applyStatus(list, status, null)
  }
  async function applyStatus(list, status, reasonValue) {
    if (list.length === 1) await run(() => m.setStatus.mutateAsync({ item: list[0], status, reason: reasonValue }), { item: list[0] })
    else await run(() => m.bulkStatus.mutateAsync({ items: list, status, reason: reasonValue }), { success: t('selection.edit.statusSet', { count: list.length }) })
    setReason(null)
  }

  const actions = {
    setStatus: (item, status) => requestStatus([item], status),
    patchOverlay: (item, patch) => run(() => m.patchOverlay.mutateAsync({ item, patch }), { item }),
    withdraw: flow.withdraw,
    reinstate: flow.reinstate,
    // LEGACY hidden items only (restore); nothing creates the old Hide flag any more
    exclude: (item, excluded) => run(() => m.exclude.mutateAsync({ item, excluded }), { item, success: t('entity.withdraw.restored') }),
    reorder: (list) => run(() => m.reorder.mutateAsync({ items: list })),
    edit: (item) => setEditor({ item }),
    remove: () => {},
    detach: () => {},
    bulkStatus: (list, status) => requestStatus(list, status),
    export: (list) => run(async () => {
      const n = await exportRows(list, boardColumns(t, lang, { config, reviews, scores, emails, fields }), `${pick(node, 'name') || 'selection'}`)
      toast.success(t('selection.edit.exported', { count: n }))
    }),
  }

  async function saveEditor({ overlayPatch, status, statusChanged }) {
    const item = editor.item
    const ok = await run(() => m.patchOverlay.mutateAsync({ item, patch: overlayPatch }), { item, success: t('selection.edit.saved') })
    setEditor(null)
    if (ok !== undefined && statusChanged) requestStatus([item], status)
  }
  // a score needs the overlay row: virtual applicants are materialised first (ensure_item), like every list write
  const saveScore = (item, { score, note }) =>
    run(async () => sm.setScore.mutateAsync({ itemId: await materializeItem(node.id, item), score, note }), { item, success: t('selection.drawer.scoreSaved') })

  /**
   * Link to the original response in the owning form's Responses tab. The resolver row carries no form id, so the
   * link is offered when exactly one form feeds the chain (the usual case); with several forms it is omitted.
   */
  function sourceLinkOf(item) {
    if (item.source.kind !== 'form_response' || !item.source.id || forms.length !== 1) return null
    return `${staffPath.node(projectId, forms[0].id, 'edit')}?tab=responses&response=${item.source.id}`
  }

  const stagePills = (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('selection.col.stage')}>
      <button type="button" role="tab" aria-selected={stage === ''} onClick={() => setStage('')} className={cn('tap-target rounded-md px-3 text-sm', stage === '' ? 'bg-foreground text-background' : 'hover:bg-surface')}>
        {t('selection.edit.stageAll')} ({nActive})
      </button>
      {config.stages.map((s) => (
        <button key={s.key} type="button" role="tab" aria-selected={stage === s.key} onClick={() => setStage(s.key)} className={cn('tap-target rounded-md px-3 text-sm', stage === s.key ? 'bg-foreground text-background' : 'hover:bg-surface')} data-testid={`stage-${s.key}`}>
          {biPick(s.label, lang) || s.key} ({counts[s.key] ?? 0})
        </button>
      ))}
      {nWithdrawn > 0 && (
        <button type="button" role="tab" aria-selected={stage === WITHDRAWN_PILL} onClick={() => setStage(WITHDRAWN_PILL)} className={cn('tap-target rounded-md px-3 text-sm', stage === WITHDRAWN_PILL ? 'bg-destructive-text text-white' : 'text-destructive-text hover:bg-surface')} data-testid="stage-withdrawn">
          {t('entity.withdraw.chip')} ({nWithdrawn})
        </button>
      )}
    </div>
  )

  const tabs = (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t('selection.edit.tab.board')}>
      {['board', 'emails'].map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('tap-target rounded-md px-3 text-sm', tab === k ? 'bg-primary text-primary-foreground' : 'hover:bg-surface')} data-testid={`tab-${k}`}>
          {t(`selection.edit.tab.${k}`)}
        </button>
      ))}
    </div>
  )

  const lastEmail = (item) => {
    const by = emails[item.itemId] ?? {}
    const last = Object.values(by).map((x) => x.last).filter(Boolean).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
    return last
  }
  const extraColumns = [
    { key: 'score', header: t('selection.col.score'), cell: (item) => { const s = scores[item.itemId]; return s?.avg != null ? <span className="inline-flex items-center gap-1 tabular-nums"><Star className="h-3.5 w-3.5 fill-current text-athar-yellow" aria-hidden="true" />{s.avg} <span className="text-xs text-muted-foreground">({s.count})</span></span> : <span className="text-xs text-muted-foreground">-</span> } },
    { key: 'email', header: t('selection.emails.statusCol'), cell: (item) => { const e = lastEmail(item); return e ? <Badge tone={STATUS_TONE[e.status] ?? 'neutral'}>{t(`selection.email.${e.email_key}`)} · {t(`selection.status.${e.status}`)}</Badge> : <span className="text-xs text-muted-foreground">{t('selection.emails.never')}</span> } },
  ]

  return (
    <NodeFrame showSave={false} actions={tabs} subtitle={t('selection.edit.subtitle', { count: nActive, sources: sources.length })}>
      <div className={cn('space-y-3', tab !== 'board' && 'hidden')}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="selection-sources">
          <span className="font-medium">{t('selection.edit.sources')}:</span>
          {sources.length === 0 ? <span>{t('selection.edit.noSources')}</span> : sources.map((s) => <Badge key={s.id} tone="blue">{pick(s, 'name') || s.type}</Badge>)}
        </div>
        {stagePills}
        <EntityManager
          key={stage}
          items={rows}
          kind="company"
          config={{ statuses, card: config.card, overlayFields: [] }}
          loading={items.isPending}
          error={items.error}
          onRetry={items.refetch}
          actions={actions}
          busyId={busyId}
          initialState={stage === WITHDRAWN_PILL ? { presence: 'withdrawn', sort: 'newest' } : { status: stage, presence: 'active', sort: 'newest' }}
          extraColumns={extraColumns}
          cardExtra={(item) => { const s = scores[item.itemId]; return s?.avg != null ? `${t('selection.col.score')}: ${s.avg} (${s.count})` : null }}
          disabledActions={['detach', 'remove']}
          onOpen={(item) => setOpen({ id: item.id, sourceId: item.source.id })}
          sortExtra={[{ key: 'score', label: t('selection.col.score'), sort: (list) => list.sort((a, b) => (scores[b.itemId]?.avg ?? -1) - (scores[a.itemId]?.avg ?? -1)) }]}
          bulkExtra={(selected) => (
            <Button size="sm" variant="outline" onClick={() => { setPreselect({ ids: selected.map((i) => i.itemId).filter(Boolean), stage: selected[0]?.status }); setTab('emails') }} data-testid="bulk-email">
              <Mail className="h-4 w-4" aria-hidden="true" />{t('selection.edit.sendTo')}
            </Button>
          )}
          toolbar={
            <Button size="sm" variant="outline" onClick={() => actions.export(rows.filter((i) => !i.excluded && (!stage ? !i.withdrawn : stage === WITHDRAWN_PILL ? i.withdrawn : !i.withdrawn && i.status === stage)))} disabled={!rows.length}>
              <Download className="h-4 w-4" aria-hidden="true" />{t('selection.edit.export')}
            </Button>
          }
        />
      </div>
      <div className={cn(tab !== 'emails' && 'hidden')}>
        <EmailsTab node={node} config={config} items={rows} extras={extras.data} loading={extras.isPending} mutations={sm} preselect={preselect} />
      </div>

      {openItem && (
        <ApplicantDrawer
          item={openItem}
          config={config}
          fields={fields}
          review={reviews[openItem.itemId] ?? null}
          score={scores[openItem.itemId] ?? null}
          emails={emails[openItem.itemId] ?? {}}
          participant={participants[openItem.source.id] ?? null}
          sourceLink={sourceLinkOf(openItem)}
          onClose={() => setOpen(null)}
          onSetStage={(item, status, opts) => requestStatus([item], status, opts)}
          onWithdraw={(item) => flow.withdraw(item)}
          onReinstate={(item) => flow.reinstate(item)}
          onSaveScore={saveScore}
          saving={busyId === openItem.id}
          formatDate={(v) => formatDate(v, { dateStyle: 'medium', timeStyle: 'short' })}
        />
      )}
      {flow.dialog}
      {editor && <ItemEditor item={editor.item} kind="company" config={{ statuses, card: config.card, overlayFields: [{ key: 'tech_status', label: { en: t('selection.col.techStatus'), ar: t('selection.col.techStatus') }, type: 'text', options: [] }] }} onClose={() => setEditor(null)} onSave={saveEditor} saving={busyId === editor.item?.id} />}
      {reason && (
        <Modal open onClose={() => setReason(null)} title={t('selection.reason.title', { name: reason.items.length === 1 ? nameOf(reason.items[0]) : `${reason.items.length}`, stage: biPick(reason.stage.label, lang) || reason.stage.key })} closeLabel={t('common.close')}
          footer={<>
            <Button variant="outline" onClick={() => setReason(null)}>{t('common.cancel')}</Button>
            <Button onClick={() => { if (reason.stage.requireReason && !reasonText.trim()) return; applyStatus(reason.items, reason.status, reasonText.trim() || null) }} disabled={reason.stage.requireReason && !reasonText.trim()} data-testid="reason-confirm">{t('selection.reason.confirm')}</Button>
          </>}
        >
          <Field as="textarea" rows={4} label={t('selection.reason.label')} value={reasonText} onChange={(e) => setReasonText(e.target.value)} hint={reason.stage.requireReason ? t('selection.reason.required') : t('selection.reason.hint')} inputClassName="min-h-24 py-2" data-autofocus />
        </Modal>
      )}
    </NodeFrame>
  )
}
