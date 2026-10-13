import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { registry } from '../../nodes/registry.js'
import NodeInspector from './NodeInspector.jsx'

const graph = {
  nodes: [
    { id: 'host', type: 'view_host', name_en: 'Project page', name_ar: 'صفحة المشروع', is_system: true, type_version: 1 },
    { id: 'f1', type: 'form_builder', name_en: 'Mentor application', name_ar: null, is_system: false, type_version: 1 },
    { id: 'l1', type: 'list', name_en: 'Experts', name_ar: 'الخبراء', is_system: false, type_version: 1 },
  ],
  edges: [{ id: 'e1', from_node_id: 'f1', from_port: 'responses', to_node_id: 'l1', to_port: 'items-in', family: 'rows:form-response', is_enabled: true, audience: 'platform' }],
}
const revisions = new Map([['f1', 3], ['l1', 7]])

function setup(selection, props = {}, route = '/projects/p1?lang=en') {
  const handlers = { onClose: vi.fn(), onRename: vi.fn().mockResolvedValue(true), onDuplicate: vi.fn(), onDelete: vi.fn(), onUpdateEdge: vi.fn(), onDeleteEdge: vi.fn() }
  const r = renderWithProviders(<NodeInspector projectId="p1" graph={graph} registry={registry} selection={selection} revisions={revisions} {...handlers} {...props} />, { route })
  return { ...r, handlers }
}

describe('NodeInspector', () => {
  it('shows the hint when nothing is selected', () => {
    setup(null)
    expect(screen.getByText('Select a node or a connection to see its details.')).toBeInTheDocument()
  })

  it('shows node summary, status, ports with counterparts and the three mode links', () => {
    setup({ kind: 'node', id: 'l1' })
    expect(screen.getByTestId('inspector-name')).toHaveTextContent('Experts')
    expect(screen.getByTestId('inspector-status')).toHaveTextContent('Saved (rev 7)')
    const inputs = screen.getByRole('region', { name: 'Inputs' })
    expect(within(inputs).getByText('Mentor application · Responses')).toBeInTheDocument()
    const outputs = screen.getByRole('region', { name: 'Outputs' })
    expect(within(outputs).getAllByText('not connected')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/projects/p1/nodes/l1/edit')
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/projects/p1/nodes/l1')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/projects/p1/nodes/l1/settings')
  })

  it('reflects saving / error status of the selected node', () => {
    setup({ kind: 'node', id: 'l1' }, { status: 'saving' })
    expect(screen.getByTestId('inspector-status')).toHaveTextContent('Saving changes...')
  })

  it('renames through onRename with both names and the revision token', async () => {
    const user = userEvent.setup()
    const { handlers } = setup({ kind: 'node', id: 'l1' })
    await user.click(screen.getByTestId('rename-node'))
    const form = screen.getByTestId('rename-form')
    const en = within(form).getByLabelText('Name (English)')
    await user.clear(en)
    await user.type(en, 'Mentors')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    expect(handlers.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }), { name_en: 'Mentors', name_ar: 'الخبراء' }, 7)
  })

  it('refuses an empty name without calling onRename', async () => {
    const user = userEvent.setup()
    const { handlers } = setup({ kind: 'node', id: 'f1' })
    await user.click(screen.getByTestId('rename-node'))
    const form = screen.getByTestId('rename-form')
    await user.clear(within(form).getByLabelText('Name (English)'))
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    expect(handlers.onRename).not.toHaveBeenCalled()
    expect(within(form).getByText('This field is required.')).toBeInTheDocument()
  })

  it('duplicate and delete call back with the node', async () => {
    const user = userEvent.setup()
    const { handlers } = setup({ kind: 'node', id: 'f1' })
    await user.click(screen.getByTestId('duplicate-node'))
    await user.click(screen.getByTestId('delete-node'))
    expect(handlers.onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }))
    expect(handlers.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }))
  })

  it('the system view host is not deletable and links to the public project page', () => {
    setup({ kind: 'node', id: 'host' })
    expect(screen.queryByTestId('delete-node')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rename-node')).not.toBeInTheDocument()
    expect(screen.getByTestId('agenda-link')).toHaveAttribute('href', '/agenda/host')
    expect(screen.getByText('Every project has this page. Tabs connected to it appear there. It cannot be deleted.')).toBeInTheDocument()
  })

  it('edge: shows endpoints, toggles audience and enabled, deletes', async () => {
    const user = userEvent.setup()
    const { handlers } = setup({ kind: 'edge', id: 'e1' })
    expect(screen.getByTestId('inspector-edge')).toHaveTextContent('Mentor application · Responses')
    expect(screen.getByTestId('inspector-edge')).toHaveTextContent('Experts · Items in')
    await user.selectOptions(screen.getByTestId('edge-audience'), 'public')
    expect(handlers.onUpdateEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), { audience: 'public' })
    await user.click(screen.getByTestId('edge-enabled'))
    expect(handlers.onUpdateEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), { is_enabled: false })
    await user.click(screen.getByTestId('delete-edge'))
    expect(handlers.onDeleteEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))
  })

  it('renders Arabic names in Arabic', () => {
    setup({ kind: 'node', id: 'l1' }, {}, '/projects/p1?lang=ar')
    expect(screen.getByTestId('inspector-name')).toHaveTextContent('الخبراء')
    expect(screen.getByTestId('inspector-status')).toHaveTextContent('محفوظ (مراجعة 7)')
  })
})
