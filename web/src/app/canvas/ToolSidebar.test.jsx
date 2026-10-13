import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import ToolSidebar from './ToolSidebar.jsx'
import { TOOL_MIME } from './canvasModel.js'

describe('ToolSidebar', () => {
  it('lists the addable tools grouped, with both booking presets, and filters by search', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ToolSidebar onAdd={vi.fn()} />, { route: '/projects/p1?lang=en' })
    expect(screen.getByRole('region', { name: 'Data' })).toBeInTheDocument()
    expect(screen.getByTestId('tool-booking:mentor')).toHaveTextContent('Mentor booking')
    expect(screen.getByTestId('tool-booking:interview')).toHaveTextContent('Interview booking')
    expect(screen.queryByTestId('tool-view_host')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Search tools'), 'agenda')
    expect(screen.getByTestId('tool-agenda')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-list')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search tools'))
    await user.type(screen.getByLabelText('Search tools'), 'zzz')
    expect(screen.getByText('No tool matches your search.')).toBeInTheDocument()
  })

  it('tap + adds the item; drag start carries the tool key', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    renderWithProviders(<ToolSidebar onAdd={onAdd} />, { route: '/projects/p1?lang=en' })
    const li = screen.getByTestId('tool-list')
    await user.click(within(li).getByRole('button', { name: 'Add List' }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ key: 'list', manifest: expect.objectContaining({ key: 'list' }) }))
    const store = {}
    const dataTransfer = { setData: (k, v) => (store[k] = v), effectAllowed: null, types: [] }
    fireEvent.dragStart(li, { dataTransfer })
    expect(store[TOOL_MIME]).toBe('list')
  })

  it('shows Arabic names in RTL', () => {
    renderWithProviders(<ToolSidebar onAdd={vi.fn()} />, { route: '/projects/p1?lang=ar' })
    expect(screen.getByTestId('tool-list')).toHaveTextContent('قائمة')
    expect(screen.getByRole('button', { name: 'إضافة قائمة' })).toBeInTheDocument()
  })
})
