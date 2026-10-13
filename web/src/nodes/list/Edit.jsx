import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Download, Plus, Upload, UserPlus } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { invalidateNodeOutputs } from '../_kit/invalidate.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { useListItems, useListMeta, useListMutations } from '../../data/lists.js'
import { usePeopleMutations } from '../../data/people.js'
import { uploadImage } from '../../data/storage.js'
import { useAuth } from '../../app/AuthContext.js'
import { biPick, isActiveItem } from '../../lib/entities.js'
import { exportRows } from '../../lib/export/xlsx.js'
import { EntityManager } from '../../shared/entities/EntityManager.jsx'
import { useWithdrawFlow } from '../../shared/entities/useWithdrawFlow.jsx'
import { EntityPicker } from '../../shared/entities/EntityPicker.jsx'
import { ItemEditor } from '../../shared/entities/ItemEditor.jsx'
import { ImportItemsModal } from '../../shared/entities/ImportItemsModal.jsx'
import { listItemColumns } from '../../shared/entities/export.js'
import { normalizeListConfig } from './listConfig.js'

/**
 * Edit mode of a List (design 01 section 3.3 / 02 section 3): the list manager. Every write is an immediate
 * row-level save through the RPCs (overlay edits are not drafts, 02 section 6); the DB bumps the list revision so
 * downstream views refresh. Virtual (edge-fed) items get their overlay row lazily on first edit (ensure_item).
 * "Hide" is gone (decision 17.1): the PM marks an item WITHDRAWN (confirmation + optional reason + Undo) and reinstates it; a
 * withdrawn item stays in this manager with its chip and leaves every list / consumer fed by this one. Items hidden with the
 * old Hide keep a "Hidden (legacy)" chip (convert to withdrawn, or restore).
 */
export default function ListEdit() {
  const { node, projectId, graph } = useNodeContext()
  const { t, lang, pick } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { user } = useAuth()
  const meta = useListMeta(node.id)
  const kind = meta.data?.subkind ?? 'generic'
  const config = useMemo(() => normalizeListConfig(node.config), [node.config])
  const items = useListItems(node.id, { filter: { include_excluded: true, include_withdrawn: true }, kind }, { enabled: meta.isSuccess })
  const m = useListMutations(node.id, { onChanged: () => invalidateNodeOutputs(qc, graph, node.id, projectId) })
  const people = usePeopleMutations()
  const [picker, setPicker] = useState(null) // 'expert' | 'company'
  const [editor, setEditor] = useState(null) // { item } | { item: null } (new manual)
  const [importing, setImporting] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [saving, setSaving] = useState(false)

  const sources = useMemo(() => {
    const edges = (graph?.edges ?? []).filter((e) => e.to_node_id === node.id && e.to_port === 'items-in' && e.is_enabled !== false)
    return edges.map((e) => (graph?.nodes ?? []).find((n) => n.id === e.from_node_id)).filter(Boolean)
  }, [graph, node.id])
  const existingIds = useMemo(() => new Set((items.data ?? []).map((i) => i.source.id).filter(Boolean)), [items.data])
  const upload = (file) => uploadImage(file, { ownerId: projectId, kind: kind === 'company' ? 'logo' : 'photo' })

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
  const nameOf = (item) => biPick(item.entity.title, lang) || '-'
  const flow = useWithdrawFlow({
    nameOf,
    onWithdraw: (list, reason) => (list.length === 1 ? m.withdraw.mutateAsync({ item: list[0], reason }) : m.bulkWithdraw.mutateAsync({ items: list, reason })),
    onReinstate: (list) => (list.length === 1 ? m.reinstate.mutateAsync({ item: list[0] }) : m.bulkReinstate.mutateAsync({ items: list })),
  })

  const actions = {
    setStatus: (item, status) => run(() => m.setStatus.mutateAsync({ item, status }), { item }),
    patchOverlay: (item, patch) => run(() => m.patchOverlay.mutateAsync({ item, patch }), { item }),
    withdraw: flow.withdraw,
    reinstate: flow.reinstate,
    // LEGACY hidden items only: "Restore to the list" (nothing creates the Hide flag any more)
    exclude: (item, excluded) => run(() => m.exclude.mutateAsync({ item, excluded }), { item, success: t('entity.withdraw.restored') }),
    reorder: (list) => run(() => m.reorder.mutateAsync({ items: list })),
    edit: (item) => setEditor({ item }),
    remove: async (item) => {
      if (!(await confirm({ title: t('list.edit.confirmRemove', { name: nameOf(item) }), message: t('list.edit.confirmRemoveBody'), destructive: true }))) return
      run(() => m.remove.mutateAsync({ item }), { item, success: t('list.edit.removed') })
    },
    detach: async (item) => {
      if (!(await confirm({ title: t('list.edit.confirmDetach', { name: nameOf(item) }), message: t('list.edit.confirmDetachBody'), destructive: true }))) return
      run(() => m.detach.mutateAsync({ item }), { item, success: t('list.edit.detached') })
    },
    bulkStatus: (list, status) => run(() => m.bulkStatus.mutateAsync({ items: list, status }), { success: t('list.edit.statusSet', { count: list.length }) }),
    export: (list) => run(async () => {
      const n = await exportRows(list, listItemColumns(t, config), `${pick(node, 'name') || 'list'}`)
      toast.success(t('list.edit.exported', { count: n }))
    }),
  }

  async function saveEditor({ fields, overlayPatch, status, statusChanged }) {
    setSaving(true)
    try {
      let item = editor.item
      if (!item) {
        const id = await m.addManual.mutateAsync({ fields })
        item = { id, itemId: id, source: { kind: 'manual', id: null } }
      } else if (fields) {
        await m.updateManual.mutateAsync({ item, fields })
      }
      await m.patchOverlay.mutateAsync({ item, patch: overlayPatch })
      if (statusChanged) await m.setStatus.mutateAsync({ item, status })
      toast.success(t('list.edit.saved'))
      setEditor(null)
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    } finally {
      setSaving(false)
    }
  }

  async function importRows(rows, onProgress) {
    let n = 0
    for (const fields of rows) {
      await m.addManual.mutateAsync({ fields })
      n += 1
      onProgress(n)
    }
    toast.success(t('list.edit.imported', { count: n }))
  }

  const toolbar = (
    <>
      <Button size="sm" onClick={() => setEditor({ item: null })} data-testid="add-manual">
        <Plus className="h-4 w-4" aria-hidden="true" />{t('list.edit.addManual')}
      </Button>
      {(kind === 'expert' || kind === 'generic') && (
        <Button size="sm" variant="secondary" onClick={() => setPicker('expert')} data-testid="pick-expert">
          <UserPlus className="h-4 w-4" aria-hidden="true" />{t('list.edit.pickExpert')}
        </Button>
      )}
      {(kind === 'company' || kind === 'generic') && (
        <Button size="sm" variant="secondary" onClick={() => setPicker('company')} data-testid="pick-company">
          <Building2 className="h-4 w-4" aria-hidden="true" />{t('list.edit.pickCompany')}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
        <Upload className="h-4 w-4" aria-hidden="true" />{t('list.edit.import')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => actions.export(items.data ?? [])} disabled={!items.data?.length}>
        <Download className="h-4 w-4" aria-hidden="true" />{t('list.edit.export')}
      </Button>
    </>
  )

  return (
    <NodeFrame showSave={false} subtitle={t('list.edit.subtitle', { kind: t(`list.kind.${kind}`), count: (items.data ?? []).filter(isActiveItem).length, sources: sources.length })}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="list-sources">
        <span className="font-medium">{t('list.edit.sources')}:</span>
        {sources.length === 0 ? <span>{t('list.edit.noSources')}</span> : sources.map((s) => <Badge key={s.id} tone="blue">{pick(s, 'name') || s.type}</Badge>)}
      </div>
      <EntityManager
        items={items.data ?? []}
        kind={kind}
        config={config}
        loading={meta.isPending || items.isPending}
        error={meta.error ?? items.error}
        onRetry={() => { meta.refetch(); items.refetch() }}
        actions={actions}
        toolbar={toolbar}
        busyId={busyId}
      />
      {picker && (
        <EntityPicker
          kind={picker}
          existingIds={existingIds}
          onClose={() => setPicker(null)}
          onUpload={upload}
          onPick={(entity) => run(() => (picker === 'expert' ? m.addNetworkPick.mutateAsync({ expertId: entity.id }) : m.addCompanyPick.mutateAsync({ companyId: entity.id })))}
          onCreate={(view) => run(() => (picker === 'expert' ? people.createExpert.mutateAsync({ view, kind: 'expert' }) : people.createCompany.mutateAsync({ view, originProjectId: projectId, userId: user?.id })))}
        />
      )}
      {flow.dialog}
      {editor && <ItemEditor item={editor.item} kind={kind} config={config} onClose={() => setEditor(null)} onSave={saveEditor} onUpload={upload} saving={saving} />}
      {importing && <ImportItemsModal onClose={() => setImporting(false)} onImport={importRows} />}
    </NodeFrame>
  )
}
