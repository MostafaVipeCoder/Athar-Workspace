import { validateConnection as validatePorts } from '../../nodes/manifest.contract.js'
import { matchesTerm } from '../../ui/SearchBar.jsx'

/**
 * Pure canvas logic (no React, no React Flow): the client-side mirror of design 02 section 2.5/2.6 and the DB trigger
 * `validate_edge` (m06a). Everything here is unit-tested; the DB stays the authority (its error is shown when it disagrees).
 */
export const FLOW_NODE_TYPE = 'athar'
export const TOOL_MIME = 'application/x-athar-tool'
export const AUDIENCES = ['public', 'platform', 'participants', 'pms'] // edges.audience CHECK (04 3.4)

/** Stroke colour per port family (edges and handles). */
/**
 * Port/edge colour per family, from the site palette (DESIGN-SYSTEM.md): Athar blue, green, error red, slate, link
 * blue, grey. Yellow is left out on purpose (a yellow handle/edge on the #f8f8f8 canvas is unreadable); the six are
 * distinguishable from each other and from the black selection border.
 */
export const FAMILY_COLORS = {
  'rows:form-response': '#1a27c9',
  'rows:list-item': '#23a455',
  'rows:participant': '#f56c6c',
  view: '#0f172a',
  schedule: '#0b75d9',
  link: '#7a7a7a',
  'dev:text': '#868e96',
}
export const familyColor = (family) => FAMILY_COLORS[family] ?? '#7a7a7a'

export function findPort(manifest, dir, key) {
  return manifest?.ports?.[dir]?.find((p) => p.key === key) ?? null
}

/** The family stored on the edge = the FIRST family of the output port (m06a validate_edge uses families->>0). */
export function outPortFamily(registry, nodes, nodeId, portKey) {
  const node = nodes.find((n) => n.id === nodeId)
  const port = findPort(registry.get(node?.type), 'out', portKey)
  return port?.families?.[0] ?? null
}

/**
 * DAG per port family (08 decision 02-13): adding from -> to in `family` creates a cycle when `from` is reachable from
 * `to` following existing edges of the SAME family (the DB walk ignores is_enabled, so does this one).
 */
export function wouldCycle(edges, family, from, to) {
  if (from === to) return true
  const next = new Map()
  for (const e of edges) {
    if (e.family !== family) continue
    if (!next.has(e.from_node_id)) next.set(e.from_node_id, [])
    next.get(e.from_node_id).push(e.to_node_id)
  }
  const seen = new Set([to])
  const stack = [to]
  while (stack.length) {
    const n = stack.pop()
    for (const m of next.get(n) ?? []) {
      if (m === from) return true
      if (!seen.has(m)) {
        seen.add(m)
        stack.push(m)
      }
    }
  }
  return false
}

/**
 * Full client-side check: ports/families/kind/duplicate/cardinality (manifest.contract) + cycle per family.
 * `conn` = { from, fromPort, to, toPort }. Returns { ok, reason?, family? }.
 */
export function validateCanvasConnection(registry, graph, conn) {
  const base = validatePorts(registry, graph, conn)
  if (!base.ok) return base
  const family = outPortFamily(registry, graph.nodes ?? [], conn.from, conn.fromPort)
  if (wouldCycle(graph.edges ?? [], family, conn.from, conn.to)) return { ok: false, reason: 'cycle', family }
  return { ok: true, family }
}

/** React Flow connection object -> our conn. */
export const fromFlowConnection = (c) => ({ from: c.source, fromPort: c.sourceHandle, to: c.target, toPort: c.targetHandle })

/** Edges grouped by port of one node: { in: Map(portKey -> edges[]), out: Map(portKey -> edges[]) }. */
export function connectedPorts(graph, nodeId) {
  const inn = new Map()
  const out = new Map()
  for (const e of graph.edges ?? []) {
    if (e.to_node_id === nodeId) inn.set(e.to_port, [...(inn.get(e.to_port) ?? []), e])
    if (e.from_node_id === nodeId) out.set(e.from_port, [...(out.get(e.from_port) ?? []), e])
  }
  return { in: inn, out }
}

/** Required inputs without an edge (02 2.4: "incomplete" badge, never blocks saving). */
export function missingRequiredInputs(manifest, graph, nodeId) {
  if (!manifest) return []
  const { in: inn } = connectedPorts(graph, nodeId)
  return manifest.ports.in.filter((p) => p.required && !(inn.get(p.key)?.length > 0)).map((p) => p.key)
}

/** Graph -> React Flow nodes. `decorate(node)` adds per-node UI state (rev, flash, status); selection is kept by the caller. */
export function toFlowNodes(graph, registry, decorate = () => ({})) {
  return (graph?.nodes ?? []).map((node) => {
    const manifest = registry.get(node.type)
    const connectedIn = new Set((graph.edges ?? []).filter((e) => e.to_node_id === node.id).map((e) => e.to_port))
    return {
      id: node.id,
      type: FLOW_NODE_TYPE,
      position: { x: node.position_x ?? 0, y: node.position_y ?? 0 },
      deletable: !node.is_system,
      data: { node, manifest, connectedIn, incomplete: missingRequiredInputs(manifest, graph, node.id), ...decorate(node) },
    }
  })
}

/** Suffix of a duplicated node's name, both languages (names are stored bilingually, independent of the UI language). */
export const COPY_WORD = { en: 'copy', ar: 'نسخة' }

/** Graph -> React Flow edges (colour by family; disabled edges are dashed). */
export function toFlowEdges(graph) {
  return (graph?.edges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.from_node_id,
    sourceHandle: edge.from_port,
    target: edge.to_node_id,
    targetHandle: edge.to_port,
    data: { edge },
    style: { stroke: familyColor(edge.family), strokeWidth: 2, strokeDasharray: edge.is_enabled ? undefined : '6 4' },
  }))
}

/**
 * Default name of a new node (06 3.1): the type (or preset) name, suffixed " N" when the project already holds N-1 of
 * that type. Returns {} for the first one so the RPC applies the type's own bilingual name.
 */
export function defaultName(manifest, nodes, preset = null) {
  const count = nodes.filter((n) => n.type === manifest.key && !n.is_system).length
  const base = preset?.name ?? manifest.name
  if (count === 0 && !preset) return {}
  const suffix = count === 0 ? '' : ` ${count + 1}`
  return { en: `${base.en}${suffix}`, ar: `${base.ar}${suffix}` }
}

/** Name of a duplicate: "<name> (copy)" in both languages (copy word localised by the caller). */
export function copyName(node, copyWord) {
  return { en: node.name_en ? `${node.name_en} (${copyWord.en})` : null, ar: node.name_ar ? `${node.name_ar} (${copyWord.ar})` : null }
}

export const CARD_W = 240
export const CARD_H = 130 // typical card height; only used to avoid stacking a new card on an existing one

/** Avoid stacking: step the point down by one card height while it overlaps an existing card (bounded). */
export function nextPosition(nodes, point) {
  const overlaps = (p) => nodes.some((n) => Math.abs((n.position_x ?? 0) - p.x) < CARD_W && Math.abs((n.position_y ?? 0) - p.y) < CARD_H)
  let p = { x: Math.round(point.x), y: Math.round(point.y) }
  for (let i = 0; i < 20 && overlaps(p); i += 1) p = { x: p.x, y: p.y + CARD_H + 20 }
  return p
}

/**
 * Sidebar items: registry groups (no system / dev types, which have no node_types row) with presets expanded
 * (08 01-1: one booking node, two sidebar presets). Each item: { key, manifest, preset, name:{en,ar}, options }.
 */
export function sidebarGroups(registry, term = '') {
  return registry
    .groups({ includeSystem: false, includeDev: false })
    .map((g) => ({
      category: g.category,
      items: g.items
        .flatMap((m) =>
          m.presets?.length
            ? m.presets.map((p) => ({ key: `${m.key}:${p.key}`, manifest: m, preset: p, name: p.name, options: p.config ?? {} }))
            : [{ key: m.key, manifest: m, preset: null, name: m.name, options: {} }],
        )
        .filter((it) => matchesTerm(it, [(x) => x.name.en, (x) => x.name.ar, (x) => x.manifest.key], term)),
    }))
    .filter((g) => g.items.length > 0)
}

/** Resolve a sidebar item key ("list", "booking:mentor") back to an item. */
export function findSidebarItem(registry, key) {
  for (const g of sidebarGroups(registry)) for (const it of g.items) if (it.key === key) return it
  return null
}

/** Status of a node for the inspector/card: 'saving' | 'error' | 'saved'. */
export function nodeStatus(nodeId, pendingIds, errorIds) {
  if (pendingIds.has(nodeId)) return 'saving'
  if (errorIds.has(nodeId)) return 'error'
  return 'saved'
}
