import { describe, it, expect } from 'vitest'
import { registry } from '../../nodes/registry.js'
import {
  copyName,
  defaultName,
  findSidebarItem,
  missingRequiredInputs,
  nextPosition,
  nodeStatus,
  outPortFamily,
  sidebarGroups,
  toFlowEdges,
  toFlowNodes,
  validateCanvasConnection,
  wouldCycle,
} from './canvasModel.js'

const node = (id, type, extra = {}) => ({ id, type, name_en: `${type} ${id}`, name_ar: null, position_x: 0, position_y: 0, is_system: false, ...extra })
const edge = (id, from, fromPort, to, toPort, family, extra = {}) => ({ id, from_node_id: from, from_port: fromPort, to_node_id: to, to_port: toPort, family, is_enabled: true, audience: 'platform', ...extra })

const graph = () => ({
  nodes: [node('host', 'view_host', { is_system: true }), node('f1', 'form_builder'), node('l1', 'list'), node('l2', 'list'), node('a1', 'agenda'), node('d1', 'distribution'), node('c1', 'certificates'), node('s1', 'selection')],
  edges: [edge('e1', 'f1', 'responses', 'l1', 'items-in', 'rows:form-response')],
  revisions: [{ node_id: 'f1', rev: 3 }],
})

describe('wouldCycle (DAG per port family, 08 decision 02-13)', () => {
  const edges = [edge('x', 'A', 'o', 'B', 'i', 'view'), edge('y', 'B', 'o', 'C', 'i', 'view'), edge('z', 'C', 'o', 'A', 'i', 'schedule')]
  it('detects a loop inside one family', () => {
    expect(wouldCycle(edges, 'view', 'C', 'A')).toBe(true) // A->B->C->A in view
    expect(wouldCycle(edges, 'view', 'B', 'A')).toBe(true)
  })
  it('ignores edges of other families (Agenda<->Distribution pair is legal)', () => {
    expect(wouldCycle(edges, 'schedule', 'A', 'B')).toBe(false) // the view chain A->B->C is not a schedule path
    expect(wouldCycle(edges, 'schedule', 'A', 'C')).toBe(true) // but C->A already exists in schedule
    expect(wouldCycle(edges, 'schedule', 'B', 'A')).toBe(false)
    expect(wouldCycle(edges, 'link', 'C', 'A')).toBe(false)
  })
  it('a self edge is a cycle', () => {
    expect(wouldCycle([], 'view', 'A', 'A')).toBe(true)
  })
})

describe('validateCanvasConnection (mirror of 02 2.5 + validate_edge)', () => {
  it('accepts a compatible pair and reports the stored family', () => {
    expect(validateCanvasConnection(registry, graph(), { from: 'f1', fromPort: 'responses', to: 'l2', toPort: 'items-in' })).toEqual({ ok: true, family: 'rows:form-response' })
    expect(validateCanvasConnection(registry, graph(), { from: 'l1', fromPort: 'list-tab', to: 'a1', toPort: 'tabs' })).toEqual({ ok: true, family: 'view' })
    expect(validateCanvasConnection(registry, graph(), { from: 'l1', fromPort: 'list-tab', to: 'host', toPort: 'tabs' })).toEqual({ ok: true, family: 'view' })
  })
  it('rejects family mismatches', () => {
    expect(validateCanvasConnection(registry, graph(), { from: 'f1', fromPort: 'responses', to: 'a1', toPort: 'tabs' }).reason).toBe('incompatible')
    expect(validateCanvasConnection(registry, graph(), { from: 'a1', fromPort: 'schedule', to: 'l1', toPort: 'items-in' }).reason).toBe('incompatible')
  })
  it('rejects kind mismatches (selection approved = company into distribution mentors = expert)', () => {
    expect(validateCanvasConnection(registry, graph(), { from: 's1', fromPort: 'approved', to: 'd1', toPort: 'mentors' }).reason).toBe('incompatible')
    expect(validateCanvasConnection(registry, graph(), { from: 's1', fromPort: 'approved', to: 'd1', toPort: 'companies' }).ok).toBe(true)
    // a list's items port is "subkind": the client cannot know the list subkind, so it defers to the server
    expect(validateCanvasConnection(registry, graph(), { from: 'l1', fromPort: 'items', to: 'd1', toPort: 'mentors' }).ok).toBe(true)
  })
  it('rejects duplicates, self edges, unknown ports and nodes', () => {
    expect(validateCanvasConnection(registry, graph(), { from: 'f1', fromPort: 'responses', to: 'l1', toPort: 'items-in' }).reason).toBe('duplicate')
    expect(validateCanvasConnection(registry, graph(), { from: 'l1', fromPort: 'items', to: 'l1', toPort: 'items-in' }).reason).toBe('self')
    expect(validateCanvasConnection(registry, graph(), { from: 'f1', fromPort: 'nope', to: 'l1', toPort: 'items-in' }).reason).toBe('unknown-port')
    expect(validateCanvasConnection(registry, graph(), { from: 'zz', fromPort: 'responses', to: 'l1', toPort: 'items-in' }).reason).toBe('unknown-node')
  })
  it('enforces cardinality one', () => {
    const g = graph()
    g.edges.push(edge('e2', 'a1', 'schedule', 'd1', 'schedule', 'schedule'))
    const a2 = node('a2', 'agenda')
    g.nodes.push(a2)
    expect(validateCanvasConnection(registry, g, { from: 'a2', fromPort: 'schedule', to: 'd1', toPort: 'schedule' }).reason).toBe('cardinality')
  })
  it('rejects a cycle within the family and allows the Agenda/Distribution two-way pair', () => {
    const g = graph()
    g.edges.push(edge('e2', 'l1', 'items', 'l2', 'items-in', 'rows:list-item'))
    expect(validateCanvasConnection(registry, g, { from: 'l2', fromPort: 'items', to: 'l1', toPort: 'items-in' }).reason).toBe('cycle')
    g.edges.push(edge('e3', 'a1', 'schedule', 'd1', 'schedule', 'schedule'))
    expect(validateCanvasConnection(registry, g, { from: 'd1', fromPort: 'sessions-tab', to: 'a1', toPort: 'tabs' })).toEqual({ ok: true, family: 'view' })
  })
  it('outPortFamily reads the first family of the output port', () => {
    expect(outPortFamily(registry, graph().nodes, 'l1', 'list-tab')).toBe('view')
    expect(outPortFamily(registry, graph().nodes, 'l1', 'missing')).toBeNull()
  })
})

describe('flow mapping', () => {
  it('maps nodes with deletable=false for system nodes and connected input ports', () => {
    const nodes = toFlowNodes(graph(), registry, (n) => ({ rev: n.id === 'f1' ? 3 : null }))
    const host = nodes.find((n) => n.id === 'host')
    expect(host.deletable).toBe(false)
    expect(host.type).toBe('athar')
    const l1 = nodes.find((n) => n.id === 'l1')
    expect(l1.deletable).toBe(true)
    expect(l1.data.connectedIn.has('items-in')).toBe(true)
    expect(nodes.find((n) => n.id === 'f1').data.rev).toBe(3)
  })
  it('flags missing required inputs', () => {
    expect(missingRequiredInputs(registry.get('distribution'), graph(), 'd1')).toEqual(['mentors', 'companies'])
    expect(missingRequiredInputs(registry.get('list'), graph(), 'l1')).toEqual([])
    // Certificates reads the project's participants itself (m38): its participants input is optional, so it is never flagged
    expect(toFlowNodes(graph(), registry).find((n) => n.id === 'c1').data.incomplete).toEqual([])
    expect(toFlowNodes(graph(), registry).find((n) => n.id === 'd1').data.incomplete).toEqual(['mentors', 'companies'])
  })
  it('maps edges with handles = ports, colour by family, dashed when disabled', () => {
    const g = graph()
    g.edges.push(edge('e2', 'l1', 'list-tab', 'a1', 'tabs', 'view', { is_enabled: false }))
    const [e1, e2] = toFlowEdges(g)
    expect(e1).toMatchObject({ source: 'f1', sourceHandle: 'responses', target: 'l1', targetHandle: 'items-in' })
    expect(e1.style.strokeDasharray).toBeUndefined()
    expect(e2.style.strokeDasharray).toBe('6 4')
    expect(e1.style.stroke).not.toBe(e2.style.stroke)
  })
})

describe('naming and placement', () => {
  it('first node of a type gets the type name from the RPC ({}), later ones a counter', () => {
    const list = registry.get('list')
    expect(defaultName(list, [])).toEqual({})
    expect(defaultName(list, graph().nodes)).toEqual({ en: 'List 3', ar: 'قائمة 3' })
  })
  it('presets name the node even when first', () => {
    const booking = registry.get('booking')
    expect(defaultName(booking, [], booking.presets[1])).toEqual({ en: 'Interview booking', ar: 'حجز مقابلات' })
  })
  it('copyName keeps nulls', () => {
    expect(copyName({ name_en: 'Experts', name_ar: null }, { en: 'copy', ar: 'نسخة' })).toEqual({ en: 'Experts (copy)', ar: null })
  })
  it('nextPosition steps below cards that would overlap the point', () => {
    expect(nextPosition([], { x: 10.4, y: 20.6 })).toEqual({ x: 10, y: 21 })
    expect(nextPosition([{ position_x: 12, position_y: 18 }], { x: 10, y: 20 })).toEqual({ x: 10, y: 170 })
    expect(nextPosition([{ position_x: 12, position_y: 18 }, { position_x: 0, position_y: 170 }], { x: 10, y: 20 })).toEqual({ x: 10, y: 320 })
    expect(nextPosition([{ position_x: 300, position_y: 20 }], { x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
  })
  it('nodeStatus prefers saving over error', () => {
    expect(nodeStatus('a', new Set(['a']), new Set(['a']))).toBe('saving')
    expect(nodeStatus('a', new Set(), new Set(['a']))).toBe('error')
    expect(nodeStatus('a', new Set(), new Set())).toBe('saved')
  })
})

describe('sidebar items', () => {
  it('lists the addable types grouped by category with booking presets expanded and no system/dev types', () => {
    const groups = sidebarGroups(registry)
    const keys = groups.flatMap((g) => g.items.map((i) => i.key))
    expect(groups.map((g) => g.category)).toEqual(['data', 'content', 'operations'])
    expect(keys).toContain('booking:mentor')
    expect(keys).toContain('booking:interview')
    expect(keys).not.toContain('booking')
    expect(keys).not.toContain('view_host')
    expect(keys).not.toContain('note')
    expect(keys).toHaveLength(10) // 9 addable types, booking counted twice
  })
  it('filters by English, Arabic and key', () => {
    expect(sidebarGroups(registry, 'حجز').flatMap((g) => g.items).map((i) => i.key)).toEqual(['booking:mentor', 'booking:interview'])
    expect(sidebarGroups(registry, 'form_b').flatMap((g) => g.items).map((i) => i.key)).toEqual(['form_builder'])
    expect(sidebarGroups(registry, 'zzz')).toEqual([])
  })
  it('resolves an item key back to manifest + options', () => {
    expect(findSidebarItem(registry, 'booking:interview')).toMatchObject({ manifest: { key: 'booking' }, options: { mode: 'interview' } })
    expect(findSidebarItem(registry, 'list')).toMatchObject({ manifest: { key: 'list' }, preset: null, options: {} })
    expect(findSidebarItem(registry, 'nope')).toBeNull()
  })
})
