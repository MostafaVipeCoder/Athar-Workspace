import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, ExternalLink, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { NodeIcon } from '../../ui/iconMap.jsx'
import { cn } from '../../lib/cn.js'
import { publicPath, staffPath } from '../../lib/links.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { AUDIENCES, connectedPorts, familyColor, findPort, missingRequiredInputs } from './canvasModel.js'

function nameOf(pick, pickLiteral, node, manifest) {
  return pick(node, 'name') || pickLiteral(manifest?.name) || node?.type || ''
}

/**
 * Inspector side panel (design 06 3.1): node summary + status + ports with their counterparts + quick links + rename /
 * duplicate / delete; or the selected edge (audience, enabled, delete). Desktop: right column; phones: bottom sheet.
 * All writes go through the callbacks (the canvas owns the mutations and their toasts).
 */
export default function NodeInspector({
  projectId,
  graph,
  registry,
  selection,
  revisions,
  status = 'saved',
  flash = false,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  onUpdateEdge,
  onDeleteEdge,
  busy = false,
}) {
  const { t, pick, pickLiteral } = useLanguage()
  const node = selection?.kind === 'node' ? graph.nodes.find((n) => n.id === selection.id) : null
  const edge = selection?.kind === 'edge' ? graph.edges.find((e) => e.id === selection.id) : null

  return (
    <aside
      aria-label={t('canvas.inspector')}
      data-testid="node-inspector"
      className={cn(
        'flex flex-col gap-3 overflow-y-auto border-t bg-background p-3 text-sm',
        'fixed inset-x-0 bottom-0 z-30 max-h-[55dvh] shadow-dropdown safe-bottom',
        'md:static md:z-auto md:max-h-none md:w-80 md:shrink-0 md:border-s md:border-t-0 md:shadow-none',
        !selection && 'hidden md:flex',
      )}
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-semibold">
          {node ? t('canvas.selectedNode') : edge ? t('canvas.selectedEdge') : t('canvas.inspector')}
        </h2>
        {selection && (
          <button type="button" onClick={onClose} aria-label={t('canvas.closeInspector')} className="tap-target -me-2 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-surface">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {!node && !edge && <p className="text-muted-foreground">{t('canvas.nothingSelected')}</p>}

      {node && (
        <NodeDetails
          key={node.id}
          projectId={projectId}
          graph={graph}
          registry={registry}
          node={node}
          rev={revisions.get(node.id)}
          status={status}
          flash={flash}
          busy={busy}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          nameOf={(n, m) => nameOf(pick, pickLiteral, n, m)}
        />
      )}

      {edge && <EdgeDetails key={edge.id} graph={graph} registry={registry} edge={edge} busy={busy} onUpdateEdge={onUpdateEdge} onDeleteEdge={onDeleteEdge} nameOf={(n, m) => nameOf(pick, pickLiteral, n, m)} />}
    </aside>
  )
}

function NodeDetails({ projectId, graph, registry, node, rev, status, flash, busy, onRename, onDuplicate, onDelete, nameOf }) {
  const { t, pickLiteral } = useLanguage()
  const manifest = registry.get(node.type)
  const [editing, setEditing] = useState(false)
  const [nameEn, setNameEn] = useState(node.name_en ?? '')
  const [nameAr, setNameAr] = useState(node.name_ar ?? '')
  const [nameError, setNameError] = useState(null)
  function startEditing() {
    setNameEn(node.name_en ?? '')
    setNameAr(node.name_ar ?? '')
    setNameError(null)
    setEditing(true)
  }

  const ports = connectedPorts(graph, node.id)
  const missing = missingRequiredInputs(manifest, graph, node.id)
  const counterpart = (e, dir) => {
    const otherId = dir === 'in' ? e.from_node_id : e.to_node_id
    const other = graph.nodes.find((n) => n.id === otherId)
    const om = registry.get(other?.type)
    const port = findPort(om, dir === 'in' ? 'out' : 'in', dir === 'in' ? e.from_port : e.to_port)
    return `${nameOf(other, om)} · ${pickLiteral(port?.label) ?? (dir === 'in' ? e.from_port : e.to_port)}`
  }

  async function submitRename(e) {
    e.preventDefault()
    if (!nameEn.trim() && !nameAr.trim()) {
      setNameError(t('auth.fieldRequired'))
      return
    }
    setNameError(null)
    const ok = await onRename(node, { name_en: nameEn.trim() || null, name_ar: nameAr.trim() || null }, rev)
    if (ok) setEditing(false)
  }

  const statusText = status === 'saving' ? t('canvas.statusUnsaved') : status === 'error' ? t('canvas.statusError') : t('canvas.statusSaved', { rev: rev ?? 0 })

  return (
    <div className="space-y-3" data-testid="inspector-node">
      <div className="flex items-start gap-2">
        <NodeIcon name={manifest?.icon} className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          {!editing ? (
            <p className="break-words font-semibold" data-testid="inspector-name">{nameOf(node, manifest)}</p>
          ) : (
            <form onSubmit={submitRename} className="space-y-2" data-testid="rename-form">
              <Field label={t('canvas.nameEn')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" error={nameError} />
              <Field label={t('canvas.nameAr')} value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>{t('common.cancel')}</Button>
                <Button type="submit" size="sm" loading={busy}>{t('common.save')}</Button>
              </div>
            </form>
          )}
          <p className="text-xs text-muted-foreground">
            {t('canvas.type')}: {manifest ? pickLiteral(manifest.name) : node.type} · {t('canvas.version', { version: node.type_version ?? 1 })}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('canvas.status')}</dt>
        <dd data-testid="inspector-status" className={cn(status === 'error' && 'text-destructive', status === 'saving' && 'text-muted-foreground')}>
          {statusText}
          {flash && <span className="ms-2 rounded-full bg-accent/50 px-2 py-0.5">{t('canvas.updatedJustNow')}</span>}
        </dd>
      </dl>

      {node.is_system ? (
        <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t('canvas.systemNode')}</p>
          <p>{t('canvas.systemNodeHint')}</p>
          <Link to={publicPath('agenda', node.id)} className="mt-2 inline-flex items-center gap-1 text-primary hover:underline" data-testid="agenda-link">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {t('canvas.openAgenda')}
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1" aria-label={t('node.view')}>
          {['view', 'edit', 'settings'].map((mode) => (
            <Link key={mode} to={staffPath.node(projectId, node.id, mode)} className="tap-target inline-flex items-center rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">
              {t(`node.${mode}`)}
            </Link>
          ))}
        </div>
      )}

      {missing.length > 0 && <p className="rounded-input border border-accent bg-accent/15 p-2 text-xs text-foreground">{t('canvas.incomplete')}</p>}

      {manifest && (
        <div className="space-y-2">
          {['in', 'out'].map((dir) =>
            manifest.ports[dir].length === 0 ? null : (
              <section key={dir} aria-label={t(dir === 'in' ? 'canvas.inputs' : 'canvas.outputs')}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(dir === 'in' ? 'canvas.inputs' : 'canvas.outputs')}</h3>
                <ul className="mt-1 space-y-1">
                  {manifest.ports[dir].map((p) => {
                    const edges = ports[dir].get(p.key) ?? []
                    return (
                      <li key={p.key} className="rounded-md border p-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: familyColor(p.families[0]) }} aria-hidden="true" />
                          <span className="font-medium">{pickLiteral(p.label)}</span>
                          <span className="text-muted-foreground">{t(`canvas.family.${p.families[0]}`)}</span>
                          {p.required && <span className="ms-auto rounded-full bg-muted px-1.5">{t('canvas.required')}</span>}
                        </div>
                        {edges.length === 0 ? (
                          <p className="mt-1 text-muted-foreground">{t('canvas.notConnected')}</p>
                        ) : (
                          <ul className="mt-1 space-y-0.5">
                            {edges.map((e) => (
                              <li key={e.id} className="truncate">{counterpart(e, dir)}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ),
          )}
        </div>
      )}

      {!node.is_system && (
        <div className="flex flex-wrap gap-1 border-t pt-3">
          <Button size="sm" variant="outline" onClick={startEditing} disabled={busy || editing} data-testid="rename-node">
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            {t('canvas.rename')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDuplicate(node)} disabled={busy} data-testid="duplicate-node">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {t('canvas.duplicate')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(node)} disabled={busy} className="text-destructive hover:bg-destructive/10" data-testid="delete-node">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('canvas.delete')}
          </Button>
        </div>
      )}
    </div>
  )
}

function EdgeDetails({ graph, registry, edge, busy, onUpdateEdge, onDeleteEdge, nameOf }) {
  const { t, pickLiteral } = useLanguage()
  const from = graph.nodes.find((n) => n.id === edge.from_node_id)
  const to = graph.nodes.find((n) => n.id === edge.to_node_id)
  const fm = registry.get(from?.type)
  const tm = registry.get(to?.type)
  const fromPort = findPort(fm, 'out', edge.from_port)
  const toPort = findPort(tm, 'in', edge.to_port)
  return (
    <div className="space-y-3" data-testid="inspector-edge">
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: familyColor(edge.family) }} aria-hidden="true" />
        <span className="font-medium">{t(`canvas.family.${edge.family}`)}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('canvas.from')}</dt>
        <dd className="break-words">{nameOf(from, fm)} · {pickLiteral(fromPort?.label) ?? edge.from_port}</dd>
        <dt className="text-muted-foreground">{t('canvas.to')}</dt>
        <dd className="break-words">{nameOf(to, tm)} · {pickLiteral(toPort?.label) ?? edge.to_port}</dd>
      </dl>
      <Field
        as="select"
        label={t('canvas.audience')}
        value={edge.audience}
        disabled={busy}
        onChange={(e) => onUpdateEdge(edge, { audience: e.target.value })}
        data-testid="edge-audience"
      >
        {AUDIENCES.map((a) => (
          <option key={a} value={a}>{t(`canvas.audience.${a}`)}</option>
        ))}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={edge.is_enabled} disabled={busy} onChange={(e) => onUpdateEdge(edge, { is_enabled: e.target.checked })} data-testid="edge-enabled" />
        {t('canvas.enabled')}
      </label>
      <div className="border-t pt-3">
        <Button size="sm" variant="ghost" onClick={() => onDeleteEdge(edge)} disabled={busy} className="text-destructive hover:bg-destructive/10" data-testid="delete-edge">
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t('canvas.deleteEdge')}
        </Button>
      </div>
    </div>
  )
}
