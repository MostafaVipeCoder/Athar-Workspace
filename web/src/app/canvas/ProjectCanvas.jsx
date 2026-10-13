import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, Loader2, Workflow, XCircle } from 'lucide-react'
import { registry } from '../../nodes/registry.js'
import { dbNodeAdapter, useCanvasMutations, useProjectGraph } from '../../data/canvas.js'
import { useSavedStateRefresh } from '../../nodes/_kit/useSavedStateRefresh.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { cn } from '../../lib/cn.js'
import { log } from '../../lib/log.js'
import ToolSidebar from './ToolSidebar.jsx'
import NodeCard from './NodeCard.jsx'
import NodeInspector from './NodeInspector.jsx'
import {
  COPY_WORD,
  FLOW_NODE_TYPE,
  TOOL_MIME,
  copyName,
  defaultName,
  familyColor,
  findSidebarItem,
  fromFlowConnection,
  nextPosition,
  nodeStatus,
  toFlowEdges,
  toFlowNodes,
  validateCanvasConnection,
} from './canvasModel.js'

const NODE_TYPES = { [FLOW_NODE_TYPE]: NodeCard } // module constant: stable identity for React Flow
const DEFAULT_EDGE = { markerEnd: { type: MarkerType.ArrowClosed } }
const FIT_VIEW = { padding: 0.25, maxZoom: 1 }
const MOVE_DEBOUNCE_MS = 800 // design 06 3.1: layout autosave, positions only
const FLASH_MS = 4000
const NODE_W = 240

/**
 * STEP 6 BOUNDARY: the only chunk that imports @xyflow/react (design 08 P3). Owns the graph query, the mutations and
 * every toast/confirm of the canvas; ToolSidebar / NodeCard / NodeInspector are presentational.
 */
export default function ProjectCanvas({ projectId }) {
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ projectId }) {
  const { t, pick, pickLiteral } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const rf = useReactFlow()
  const graphQuery = useProjectGraph(projectId)
  const graph = graphQuery.data
  const m = useCanvasMutations(projectId)
  const pendingCount = useIsMutating({ mutationKey: ['canvas', projectId] })
  const wrapperRef = useRef(null)

  const [rawSelection, setSelection] = useState(null) // { kind: 'node'|'edge', id }
  const [pendingIds, setPendingIds] = useState(() => new Set())
  const [errorIds, setErrorIds] = useState(() => new Set())
  const [lastError, setLastError] = useState(null)
  const selectAfterSync = useRef(null)

  const revisions = useMemo(() => new Map((graph?.revisions ?? []).map((r) => [r.node_id, r.rev])), [graph])
  const graphRef = useRef(graph)
  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  // ---------------------------------------------------------------- saved-state refresh (another editor's changes)
  const refresh = useSavedStateRefresh({ projectId, adapter: dbNodeAdapter })
  const seenRevisions = useRef(null)
  const [flashSeen, setFlashSeen] = useState(null) // lastRefreshedAt whose flash already faded
  const flashIds = useMemo(
    () => (refresh.lastRefreshedAt && flashSeen !== refresh.lastRefreshedAt ? new Set(refresh.changedIds) : new Set()),
    [refresh.lastRefreshedAt, refresh.changedIds, flashSeen],
  )
  useEffect(() => {
    if (!refresh.revisions || !graph) return undefined
    const ids = new Set(refresh.revisions.map((r) => r.node_id))
    const graphIds = new Set(graph.nodes.map((n) => n.id))
    const sameSet = ids.size === graphIds.size && [...ids].every((id) => graphIds.has(id))
    const changed = refresh.changedIds.length > 0 && seenRevisions.current !== refresh.lastRefreshedAt
    if (!sameSet || changed) {
      seenRevisions.current = refresh.lastRefreshedAt
      graphQuery.refetch() // a node/edge added, saved or deleted by another editor (or by us) -> reload the graph
    }
    if (!changed) return undefined
    const at = refresh.lastRefreshedAt
    const id = setTimeout(() => setFlashSeen(at), FLASH_MS)
    return () => clearTimeout(id)
  }, [refresh.revisions, refresh.changedIds, refresh.lastRefreshedAt, graph, graphQuery])

  // ---------------------------------------------------------------- React Flow state synced from the graph query
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const decorate = useCallback(
    (node) => ({ rev: revisions.get(node.id) ?? null, status: nodeStatus(node.id, pendingIds, errorIds), flash: flashIds.has(node.id) }),
    [revisions, pendingIds, errorIds, flashIds],
  )
  useEffect(() => {
    if (!graph) return
    setNodes((prev) => {
      const before = new Map(prev.map((n) => [n.id, n]))
      const wanted = selectAfterSync.current
      const next = toFlowNodes(graph, registry, decorate).map((n) => {
        const old = before.get(n.id)
        const selected = wanted ? n.id === wanted : Boolean(old?.selected)
        // a node being dragged keeps its live position until the move is persisted
        return old?.dragging ? { ...n, position: old.position, dragging: true, selected } : { ...n, selected }
      })
      if (wanted && next.some((n) => n.id === wanted)) {
        selectAfterSync.current = null
        setSelection({ kind: 'node', id: wanted })
      }
      return next
    })
    setEdges((prev) => {
      const sel = new Set(prev.filter((e) => e.selected).map((e) => e.id))
      return toFlowEdges(graph).map((e) => ({ ...e, ...DEFAULT_EDGE, selected: sel.has(e.id) }))
    })
  }, [graph, decorate, setNodes, setEdges])

  // the selection must point at something that still exists (another editor may have deleted it): derived, not synced
  const selection = useMemo(() => {
    if (!rawSelection || !graph) return null
    const exists = rawSelection.kind === 'node' ? graph.nodes.some((n) => n.id === rawSelection.id) : graph.edges.some((e) => e.id === rawSelection.id)
    return exists ? rawSelection : null
  }, [rawSelection, graph])

  // ---------------------------------------------------------------- helpers
  const nameOf = useCallback((node) => pick(node, 'name') || pickLiteral(registry.get(node?.type)?.name) || node?.type || '', [pick, pickLiteral])
  const describeError = useCallback((err) => `${t(err?.messageKey ?? 'errors.unknown')}${err?.cause?.message ? ` (${err.cause.message})` : ''}`, [t])
  const trackNode = useCallback(async (nodeId, run) => {
    setPendingIds((s) => new Set(s).add(nodeId))
    setErrorIds((s) => {
      const n = new Set(s)
      n.delete(nodeId)
      return n
    })
    try {
      const out = await run()
      setLastError(null)
      return out
    } catch (err) {
      setErrorIds((s) => new Set(s).add(nodeId))
      setLastError(err)
      throw err
    } finally {
      setPendingIds((s) => {
        const n = new Set(s)
        n.delete(nodeId)
        return n
      })
    }
  }, [])

  // ---------------------------------------------------------------- add (drop or tap)
  const addItem = useCallback(
    async (item, point) => {
      const g = graphRef.current
      const name = defaultName(item.manifest, g?.nodes ?? [], item.preset)
      const pos = nextPosition(g?.nodes ?? [], point)
      try {
        const created = await m.addNode.mutateAsync({ type: item.manifest.key, name, x: pos.x, y: pos.y, options: item.options })
        selectAfterSync.current = created.id
        setLastError(null)
        toast.success(t('canvas.nodeAdded', { name: nameOf(created) }))
      } catch (err) {
        setLastError(err)
        toast.error(describeError(err))
      }
    },
    [m.addNode, toast, t, nameOf, describeError],
  )
  const addAtCenter = useCallback(
    (item) => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      const center = rect ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 }
      return addItem(item, { x: center.x - NODE_W / 2, y: center.y - 40 })
    },
    [rf, addItem],
  )
  const onDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes(TOOL_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }, [])
  const onDrop = useCallback(
    (e) => {
      const key = e.dataTransfer.getData(TOOL_MIME)
      const item = key && findSidebarItem(registry, key)
      if (!item) return
      e.preventDefault()
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addItem(item, { x: p.x - NODE_W / 2, y: p.y - 20 })
    },
    [rf, addItem],
  )

  // ---------------------------------------------------------------- move (debounced, positions only)
  const moveBuffer = useRef(new Map())
  const moveTimer = useRef(null)
  const flushMoves = useCallback(() => {
    moveTimer.current = null
    const positions = [...moveBuffer.current.values()]
    moveBuffer.current = new Map()
    if (positions.length === 0) return
    m.moveNodes.mutateAsync(positions).catch((err) => {
      setLastError(err)
      toast.error(describeError(err))
    })
  }, [m.moveNodes, toast, describeError])
  const onNodeDragStop = useCallback(
    (_event, _node, dragged) => {
      for (const n of dragged ?? [_node]) moveBuffer.current.set(n.id, { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })
      clearTimeout(moveTimer.current)
      moveTimer.current = setTimeout(flushMoves, MOVE_DEBOUNCE_MS)
    },
    [flushMoves],
  )
  useEffect(() => () => {
    if (moveTimer.current) {
      clearTimeout(moveTimer.current)
      flushMoves()
    }
  }, [flushMoves])

  // ---------------------------------------------------------------- connect (client validation mirrors 02, server is the authority)
  const isValidConnection = useCallback((c) => validateCanvasConnection(registry, graphRef.current ?? { nodes: [], edges: [] }, fromFlowConnection(c)).ok, [])
  const explainRejection = useCallback(
    (conn) => {
      const v = validateCanvasConnection(registry, graphRef.current ?? { nodes: [], edges: [] }, conn)
      return t('canvas.connectionRejected', { reason: t(`canvas.invalid.${v.ok ? 'server' : v.reason}`) })
    },
    [t],
  )
  const onConnect = useCallback(
    async (c) => {
      const conn = fromFlowConnection(c)
      const v = validateCanvasConnection(registry, graphRef.current, conn)
      if (!v.ok) {
        toast.warning(explainRejection(conn))
        return
      }
      try {
        await trackNode(conn.to, () => m.connect.mutateAsync(conn))
        toast.success(t('canvas.connected'))
      } catch (err) {
        toast.error(t('canvas.connectionRejected', { reason: err?.cause?.message || t(err?.messageKey ?? 'canvas.invalid.server') }))
      }
    },
    [m.connect, toast, t, trackNode, explainRejection],
  )
  const onConnectEnd = useCallback(
    (_event, state) => {
      // an attempt that ended on a handle but was refused by isValidConnection: say why (02 2.6 "tooltip stating the reason")
      if (!state?.toHandle || state.isValid) return
      const a = state.fromHandle
      const b = state.toHandle
      const src = a.type === 'source' ? a : b
      const tgt = a.type === 'source' ? b : a
      toast.warning(explainRejection({ from: src.nodeId, fromPort: src.id, to: tgt.nodeId, toPort: tgt.id }))
    },
    [toast, explainRejection],
  )

  // ---------------------------------------------------------------- delete (confirm, soft delete, undo)
  const onBeforeDelete = useCallback(
    async ({ nodes: ns, edges: es }) => {
      const deletable = ns.filter((n) => !n.data?.node?.is_system)
      const g = graphRef.current
      if (deletable.length > 0) {
        const n = deletable[0].data.node
        const count = (g?.edges ?? []).filter((e) => deletable.some((d) => d.id === e.from_node_id || d.id === e.to_node_id)).length
        const ok = await confirm({ title: t('canvas.deleteTitle', { name: nameOf(n) }), message: t('canvas.deleteBody', { count }), destructive: true, confirmLabel: t('canvas.delete') })
        return ok ? { nodes: deletable, edges: es } : false
      }
      if (es.length > 0) {
        const ok = await confirm({ title: t('canvas.deleteEdgeTitle'), message: t('canvas.deleteEdgeBody'), destructive: true, confirmLabel: t('canvas.deleteEdge') })
        return ok ? { nodes: [], edges: es } : false
      }
      return false
    },
    [confirm, t, nameOf],
  )
  const onDelete = useCallback(
    async ({ nodes: ns, edges: es }) => {
      const deletedNodeIds = new Set(ns.map((n) => n.id))
      setSelection(null)
      // edges of a deleted node are NOT disconnected: they come back with restore_node (undo)
      for (const e of es.filter((x) => !deletedNodeIds.has(x.source) && !deletedNodeIds.has(x.target))) {
        const edge = e.data?.edge
        try {
          await m.disconnect.mutateAsync({ edgeId: e.id })
          setLastError(null)
          toast.success(t('canvas.edgeDeleted'), {
            duration: 8000,
            action: edge && {
              label: t('canvas.undo'),
              onClick: () =>
                m.connect
                  .mutateAsync({ from: edge.from_node_id, fromPort: edge.from_port, to: edge.to_node_id, toPort: edge.to_port, config: { is_enabled: edge.is_enabled, audience: edge.audience, label_en: edge.label_en, label_ar: edge.label_ar, order_index: edge.order_index, filter: edge.filter } })
                  .then(() => toast.success(t('canvas.edgeRestored')))
                  .catch((err) => toast.error(describeError(err))),
            },
          })
        } catch (err) {
          setLastError(err)
          toast.error(describeError(err))
        }
      }
      for (const n of ns) {
        const node = n.data?.node
        try {
          await trackNode(n.id, () => m.deleteNode.mutateAsync({ nodeId: n.id }))
          toast.success(t('canvas.nodeDeleted', { name: nameOf(node) }), {
            duration: 8000,
            action: {
              label: t('canvas.undo'),
              onClick: () =>
                m.restoreNode
                  .mutateAsync({ nodeId: n.id })
                  .then(() => toast.success(t('canvas.restored')))
                  .catch((err) => toast.error(describeError(err))),
            },
          })
        } catch (err) {
          toast.error(describeError(err))
        }
      }
    },
    [m.disconnect, m.connect, m.deleteNode, m.restoreNode, toast, t, nameOf, trackNode, describeError],
  )

  // ---------------------------------------------------------------- inspector actions
  const rename = useCallback(
    async (node, names, rev) => {
      try {
        await trackNode(node.id, () => m.rename.mutateAsync({ nodeId: node.id, expectedRev: rev, ...names }))
        return true
      } catch (err) {
        toast.error(err?.code === 'conflict' ? t('node.conflict') : describeError(err))
        return false
      }
    },
    [m.rename, toast, t, trackNode, describeError],
  )
  const duplicate = useCallback(
    async (node) => {
      try {
        const copy = await trackNode(node.id, () =>
          m.duplicate.mutateAsync({ nodeId: node.id, name: copyName(node, COPY_WORD), x: (node.position_x ?? 0) + 40, y: (node.position_y ?? 0) + 40 }),
        )
        selectAfterSync.current = copy.id
        toast.success(t('canvas.duplicated', { name: nameOf(node) }))
      } catch (err) {
        toast.error(describeError(err))
      }
    },
    [m.duplicate, toast, t, nameOf, trackNode, describeError],
  )
  const updateEdge = useCallback(
    async (edge, patch) => {
      try {
        await trackNode(edge.to_node_id, () => m.updateEdge.mutateAsync({ edgeId: edge.id, patch }))
        toast.success(t('canvas.edgeSaved'))
      } catch (err) {
        toast.error(describeError(err))
      }
    },
    [m.updateEdge, toast, t, trackNode, describeError],
  )
  const requestDeleteNode = useCallback((node) => rf.deleteElements({ nodes: [{ id: node.id }] }), [rf])
  const requestDeleteEdge = useCallback((edge) => rf.deleteElements({ edges: [{ id: edge.id }] }), [rf])

  const onSelectionChange = useCallback(({ nodes: ns, edges: es }) => {
    setSelection(ns[0] ? { kind: 'node', id: ns[0].id } : es[0] ? { kind: 'edge', id: es[0].id } : null)
  }, [])
  const deselect = useCallback(() => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)))
    setSelection(null)
  }, [setNodes, setEdges])
  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') deselect()
    },
    [deselect],
  )

  const nonSystemCount = (graph?.nodes ?? []).filter((n) => !n.is_system).length
  const saveState = pendingCount > 0 || pendingIds.size > 0 ? 'saving' : lastError ? 'error' : 'saved'
  const selectedStatus = selection?.kind === 'node' ? nodeStatus(selection.id, pendingIds, errorIds) : 'saved'
  if (graphQuery.isError) log.warn('[canvas] graph refetch failed', graphQuery.error?.code)

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row" data-testid="project-canvas">
      <ToolSidebar onAdd={addAtCenter} />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('canvas.canvasLabel')}>
        <div className="flex items-center gap-3 border-b px-3 py-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" data-testid="save-indicator" data-state={saveState}>
            {saveState === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {saveState === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />}
            {saveState === 'error' && <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />}
            {t(saveState === 'saving' ? 'canvas.saving' : saveState === 'error' ? 'canvas.saveFailed' : 'canvas.saved')}
          </span>
          <span className="hidden sm:inline">{t('canvas.shortcuts')}</span>
        </div>
        {/* the canvas world is LTR by design (x grows right); card text follows the UI direction inside NodeCard */}
        <div ref={wrapperRef} dir="ltr" className="relative min-h-[60dvh] flex-1 md:min-h-0" onDrop={onDrop} onDragOver={onDragOver} onKeyDown={onKeyDown} role="presentation">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onBeforeDelete={onBeforeDelete}
            onDelete={onDelete}
            onSelectionChange={onSelectionChange}
            deleteKeyCode={['Delete', 'Backspace']}
            connectionRadius={28}
            defaultEdgeOptions={DEFAULT_EDGE}
            fitView
            fitViewOptions={FIT_VIEW}
            minZoom={0.2}
            maxZoom={2}
            selectNodesOnDrag={false}
            elevateEdgesOnSelect
            zoomOnDoubleClick={false}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (n.data?.node?.is_system ? '#cbd5e1' : familyColor(n.data?.manifest?.ports?.out?.[0]?.families?.[0]))} />
          </ReactFlow>
          {graph && nonSystemCount === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6" data-testid="canvas-empty">
              <EmptyState icon={Workflow} title={t('canvas.addFirst')} body={t('canvas.addFirstBody')} className={cn('bg-background/90')} />
            </div>
          )}
        </div>
      </section>
      {graph && (
        <NodeInspector
          projectId={projectId}
          graph={graph}
          registry={registry}
          selection={selection}
          revisions={revisions}
          status={selectedStatus}
          flash={selection?.kind === 'node' && flashIds.has(selection.id)}
          busy={selection?.kind === 'node' ? pendingIds.has(selection.id) : pendingCount > 0}
          onClose={deselect}
          onRename={rename}
          onDuplicate={duplicate}
          onDelete={requestDeleteNode}
          onUpdateEdge={updateEdge}
          onDeleteEdge={requestDeleteEdge}
        />
      )}
    </div>
  )
}
