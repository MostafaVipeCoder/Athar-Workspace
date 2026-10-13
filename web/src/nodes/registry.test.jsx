import { describe, expect, it } from 'vitest'
import { Suspense } from 'react'
import { screen, act, waitFor, fireEvent } from '@testing-library/react'
import { registry, createRegistry } from './registry.js'
import { validateManifest, validateConnection, isCompatible } from './manifest.contract.js'
import { defineNode } from './_kit/defineNode.js'
import NodeHost from './_kit/NodeHost.jsx'
import { createMemoryAdapter } from './_kit/memoryAdapter.js'
import { renderWithProviders } from '../test/render.jsx'

const EXPECTED = ['agenda', 'booking', 'certificates', 'distribution', 'form_builder', 'landing_page', 'library', 'list', 'selection', 'view_host']

describe('registry', () => {
  it('has the 10 DB node types plus the dev Note', () => {
    expect(registry.keys().sort()).toEqual([...EXPECTED, 'note'].sort())
  })
  it('every manifest satisfies the contract', () => {
    for (const k of registry.keys()) expect(validateManifest(registry.get(k)), k).toEqual([])
  })
  it('sidebar hides the system node and shows dev only in dev', () => {
    const keys = registry.list().map((m) => m.key)
    expect(keys).not.toContain('view_host')
    expect(keys).toContain('note')
    expect(registry.list({ includeDev: false }).map((m) => m.key)).not.toContain('note')
    expect(registry.groups().map((g) => g.category)).toEqual(['data', 'content', 'operations', 'dev'])
  })
  it('lazy component identity is stable per (type, mode)', () => {
    expect(registry.getComponent('list', 'edit')).toBe(registry.getComponent('list', 'edit'))
    expect(registry.getComponent('list', 'edit')).not.toBe(registry.getComponent('list', 'view'))
    expect(registry.getComponent('nope', 'edit')).toBeNull()
  })
  it('rejects invalid and duplicate manifests', () => {
    expect(() => createRegistry([{ key: 'x' }], { validate: true })).toThrow(/Invalid node manifest/)
    const m = defineNode({ key: 'dup', version: 1, name: { en: 'a', ar: 'ب' }, icon: 'x', category: 'data' })
    expect(() => createRegistry([m, m])).toThrow(/Duplicate/)
  })
  it('connection validation', () => {
    const graph = {
      nodes: [{ id: 'f', type: 'form_builder' }, { id: 'l', type: 'list' }, { id: 'c', type: 'certificates' }],
      edges: [],
    }
    expect(validateConnection(registry, graph, { from: 'f', fromPort: 'responses', to: 'l', toPort: 'items-in' })).toEqual({ ok: true })
    expect(validateConnection(registry, graph, { from: 'f', fromPort: 'responses', to: 'c', toPort: 'participants' }).reason).toBe('incompatible')
    expect(validateConnection(registry, graph, { from: 'f', fromPort: 'responses', to: 'f', toPort: 'x' }).reason).toBe('self')
    const withEdge = { ...graph, edges: [{ from_node_id: 'f', from_port: 'responses', to_node_id: 'l', to_port: 'items-in' }] }
    expect(validateConnection(registry, withEdge, { from: 'f', fromPort: 'responses', to: 'l', toPort: 'items-in' }).reason).toBe('duplicate')
    expect(isCompatible(registry.get('selection').ports.out[0], registry.get('list').ports.in[0])).toBe(true)
  })
})

function fixture() {
  const nodes = [
    { id: 'a', project_id: 'p', type: 'note', type_version: 1, name_en: 'Note A', config: { text: 'from A' } },
    { id: 'b', project_id: 'p', type: 'note', type_version: 1, name_en: 'Note B', config: { text: 'B own' } },
  ]
  const edges = [{ from_node_id: 'a', from_port: 'text', to_node_id: 'b', to_port: 'text-in', is_enabled: true }]
  const adapter = createMemoryAdapter({ nodes, edges })
  const graph = { nodes: nodes.map(({ id, type }) => ({ id, type })), edges }
  return { adapter, graph, nodes }
}

describe('NodeHost', () => {
  it('lazy-loads the three modes', async () => {
    const { adapter, graph, nodes } = fixture()
    const node = { ...nodes[0], rev: 1 }
    const { rerender } = renderWithProviders(<NodeHost mode="edit" node={node} graph={graph} projectId="p" adapter={adapter} />)
    expect(await screen.findByLabelText('Note text')).toBeInTheDocument()
    rerender(<span />) // unmount cleanly; modes are exercised via separate renders below
  })
  it('view mode is read-only and settings mode renders', async () => {
    const { adapter, graph, nodes } = fixture()
    renderWithProviders(<NodeHost mode="view" node={{ ...nodes[0], rev: 1 }} graph={graph} projectId="p" adapter={adapter} />)
    expect(await screen.findByTestId('note-text')).toHaveTextContent('from A')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
  it('settings mode', async () => {
    const { adapter, graph, nodes } = fixture()
    renderWithProviders(<NodeHost mode="settings" node={{ ...nodes[0], rev: 1 }} graph={graph} projectId="p" adapter={adapter} />)
    expect(await screen.findByText('visibility')).toBeInTheDocument()
  })
  it('unknown or newer node types show UnsupportedNode instead of crashing', () => {
    const { adapter } = fixture()
    renderWithProviders(<NodeHost mode="view" node={{ id: 'x', type: 'future', name_en: 'Ghost' }} adapter={adapter} />)
    expect(screen.getByText(/Unsupported node/)).toBeInTheDocument()
    renderWithProviders(<NodeHost mode="view" node={{ id: 'y', type: 'note', type_version: 99, name_en: 'New' }} adapter={adapter} />)
    expect(screen.getAllByText(/Unsupported node/).length).toBe(2)
  })
  it('isolates a crashing node inside its own boundary', async () => {
    const { adapter, graph, nodes } = fixture()
    renderWithProviders(
      <div>
        <p>page survives</p>
        <NodeHost mode="edit" node={{ ...nodes[0], rev: 1 }} graph={graph} projectId="p" adapter={adapter} />
      </div>,
    )
    const btn = await screen.findByRole('button', { name: /Crash this node/ })
    const spy = console.error
    console.error = () => {}
    await act(async () => fireEvent.click(btn))
    console.error = spy
    expect(await screen.findByTestId('node-error')).toBeInTheDocument()
    expect(screen.getByText('page survives')).toBeInTheDocument()
  })
  it('reads the input port through the source resolver', async () => {
    const { adapter, graph, nodes } = fixture()
    renderWithProviders(<NodeHost mode="view" node={{ ...nodes[1], rev: 1 }} graph={graph} projectId="p" adapter={adapter} />)
    const box = await screen.findByTestId('note-inputs')
    await waitFor(() => expect(box).toHaveTextContent('from A'))
  })
  it('refreshes dependent views after a save (saved-state refresh)', async () => {
    const { adapter, graph, nodes } = fixture()
    renderWithProviders(
      <Suspense fallback={null}>
        <NodeHost mode="edit" node={{ ...nodes[0], rev: 1 }} graph={graph} projectId="p" adapter={adapter} />
        <NodeHost mode="view" node={{ ...nodes[1], rev: 1 }} graph={graph} projectId="p" adapter={adapter} />
      </Suspense>,
    )
    const input = await screen.findByLabelText('Note text')
    await waitFor(() => expect(screen.getAllByTestId('note-inputs')[1]).toHaveTextContent('from A'))
    fireEvent.change(input, { target: { value: 'saved text' } })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    await waitFor(() => expect(screen.getAllByTestId('note-inputs')[1]).toHaveTextContent('saved text'))
    expect(adapter.snapshot().nodes.find((n) => n.id === 'a').rev).toBe(2)
    expect(await screen.findByText('All changes saved')).toBeInTheDocument()
  })
})
