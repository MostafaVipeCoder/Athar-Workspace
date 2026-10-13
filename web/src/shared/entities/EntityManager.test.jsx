import { describe, expect, it, vi } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { normalizeListItem } from '../../lib/entities.js'
import { EntityManager } from './EntityManager.jsx'
import { EntityCard } from './EntityCard.jsx'

vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : '') }))

const mk = (id, title, extra = {}) => normalizeListItem({ item_id: id, source: { kind: 'network_expert', id: `src-${id}`, state: 'ok' }, display: { title_en: title, subtitle_en: 'CTO' }, overlay: {}, status: null, ...extra }, 'expert')
const items = [mk('a', 'Ada'), mk('b', 'Bob', { status: 'confirmed', overlay: { notes: 'vip' } }), normalizeListItem({ item_id: null, source: { kind: 'form_response', id: 'r1', state: 'ok' }, display: { title_en: 'Cara' }, overlay: {} }, 'expert')]
const config = { statuses: [{ key: 'confirmed', label: { en: 'Confirmed', ar: 'مؤكد' }, tone: 'green' }, { key: 'pending', label: { en: 'Pending', ar: '' }, tone: 'amber' }], card: { showFields: ['image', 'title', 'subtitle', 'bio', 'links'], accent: null, expandable: true }, overlayFields: [] }

function setup(over = {}) {
  const actions = { setStatus: vi.fn(), patchOverlay: vi.fn(), exclude: vi.fn(), reorder: vi.fn(), remove: vi.fn(), detach: vi.fn(), edit: vi.fn(), bulkStatus: vi.fn(), bulkExclude: vi.fn(), export: vi.fn() }
  renderWithProviders(<EntityManager items={items} kind="expert" config={config} actions={actions} {...over} />, { route: '/projects/p?lang=en' })
  return actions
}

describe('EntityManager', () => {
  it('renders every item with source badges; virtual (edge-fed) items show no remove button', () => {
    setup()
    const rows = screen.getAllByTestId('item-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Athar Network')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Form')).toBeInTheDocument()
    expect(within(rows[2]).queryByRole('button', { name: /Remove from list/ })).toBeNull()
    expect(within(rows[0]).getByRole('button', { name: /Remove from list/ })).toBeInTheDocument()
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
  })

  it('search disables reordering and filters rows; status/notes edits call the row-level actions', async () => {
    const user = userEvent.setup()
    const actions = setup()
    expect(screen.getAllByRole('button', { name: /Move up/ })).toHaveLength(3)
    await user.type(screen.getByRole('searchbox'), 'bob')
    expect(screen.getAllByTestId('item-row')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Move up/ })).toBeNull()
    expect(screen.getByText(/Clear the search and filters/)).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status: Bob' }), 'pending')
    expect(actions.setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), 'pending')
    const notes = screen.getByRole('textbox', { name: 'Notes: Bob' })
    expect(notes).toHaveValue('vip')
    await user.clear(notes)
    await user.type(notes, 'call{Enter}')
    expect(actions.patchOverlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), { notes: 'call' })
  })

  it('move down persists the FULL order through reorder (virtual items included)', async () => {
    const user = userEvent.setup()
    const actions = setup()
    await user.click(screen.getByRole('button', { name: 'Move down: Ada' }))
    expect(actions.reorder).toHaveBeenCalledTimes(1)
    expect(actions.reorder.mock.calls[0][0].map((i) => i.id)).toEqual(['b', 'a', 'virtual:form_response:r1'])
    // optimistic: the table shows the new order before the refetch lands
    expect(screen.getAllByTestId('item-row').map((r) => r.dataset.itemId)).toEqual(['b', 'a', 'virtual:form_response:r1'])
  })

  it('drag and drop reorders rows', () => {
    const actions = setup()
    const rows = screen.getAllByTestId('item-row')
    fireEvent.dragStart(rows[2])
    fireEvent.dragOver(rows[0])
    fireEvent.drop(rows[0])
    expect(actions.reorder.mock.calls[0][0].map((i) => i.id)).toEqual(['virtual:form_response:r1', 'a', 'b'])
  })

  it('bulk bar: select all then hide / set status / export', async () => {
    const user = userEvent.setup()
    const actions = setup()
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    const bar = screen.getByTestId('bulk-bar')
    await user.click(within(bar).getByRole('button', { name: 'Hide from list' }))
    expect(actions.bulkExclude).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'a' })]), true)
    expect(actions.bulkExclude.mock.calls[0][0]).toHaveLength(3)
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Set status' }), 'confirmed')
    expect(actions.bulkStatus).toHaveBeenCalledWith(expect.any(Array), 'confirmed')
    await user.click(within(bar).getByRole('button', { name: 'Export selected' }))
    expect(actions.export).toHaveBeenCalled()
  })

  it('hidden items are shown only with the toggle, and cards view uses EntityCard with per-item field choice', async () => {
    const user = userEvent.setup()
    const hidden = mk('h', 'Hidden one', { excluded: true, overlay: { card: { show: { show_name: false } } } }) // legacy key of the migrated data
    setup({ items: [...items, hidden] })
    expect(screen.getAllByTestId('item-row')).toHaveLength(3)
    await user.click(screen.getByLabelText('Show hidden items'))
    expect(screen.getAllByTestId('item-row')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Cards' }))
    const cards = screen.getAllByTestId('entity-card')
    expect(cards).toHaveLength(4)
    expect(within(cards[3]).queryByRole('heading')).toBeNull() // per-item "hide name" honoured
    expect(within(cards[0]).getByRole('heading')).toHaveTextContent('Ada')
  })

  it('empty states: no items vs no match', async () => {
    const user = userEvent.setup()
    setup({ items: [] })
    expect(screen.getByText('No experts in this list yet.')).toBeInTheDocument()
    setup()
    await user.type(screen.getAllByRole('searchbox')[1], 'zzz')
    expect(screen.getByText('No items match these filters.')).toBeInTheDocument()
  })
})

describe('EntityCard', () => {
  it('is bilingual and clamps long bios with a toggle', async () => {
    const user = userEvent.setup()
    const entity = { id: 'x', kind: 'company', title: { en: 'Co', ar: 'شركة' }, subtitle: { en: 'Fintech', ar: '' }, organization: { en: '', ar: '' }, bio: { en: 'a'.repeat(400), ar: '' }, imagePath: 'p/logo/x.webp', links: [{ kind: 'website', url: 'https://co.io' }, { kind: 'linkedin', url: 'https://l.in/co' }], email: null }
    renderWithProviders(<EntityCard entity={entity} />, { route: '/x?lang=ar' })
    expect(screen.getByRole('heading')).toHaveTextContent('شركة')
    expect(screen.getByText('Fintech')).toBeInTheDocument() // fallback to the other language
    expect(screen.getByRole('link', { name: 'الموقع الإلكتروني' })).toHaveAttribute('href', 'https://co.io')
    expect(screen.getByRole('link', { name: 'حساب لينكدإن' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'شركة' })).toHaveAttribute('src', 'http://img/p/logo/x.webp')
    const more = screen.getByRole('button', { name: 'عرض المزيد' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(screen.getByRole('button', { name: 'عرض أقل' })).toBeInTheDocument()
  })
  it('compact (dense) mode: an avatar beside the text, no picture band; a mentor without a photo shows the fallback glyph; links stay reachable', () => {
    const mentor = { id: 'm', kind: 'expert', title: { en: 'Dr Maha', ar: 'د. مها' }, subtitle: { en: 'Advisor', ar: '' }, organization: { en: '', ar: '' }, bio: { en: 'Short bio', ar: '' }, imagePath: null, links: [{ kind: 'linkedin', url: 'https://l.in/m' }], email: null }
    const company = { ...mentor, id: 'c', kind: 'company', title: { en: 'Solar Roots', ar: '' }, imagePath: 'p/logo/c.webp', links: [] }
    renderWithProviders(<><EntityCard entity={mentor} dense /><EntityCard entity={company} dense /></>, { route: '/x?lang=en' })
    const cards = screen.getAllByTestId('entity-card')
    expect(cards.every((c) => c.getAttribute('data-dense') === 'true')).toBe(true)
    expect(within(cards[0]).getByRole('heading')).toHaveTextContent('Dr Maha')
    expect(within(cards[0]).getByRole('img', { name: 'No image' })).toBeInTheDocument()
    expect(within(cards[0]).getByRole('link', { name: 'LinkedIn profile' })).toHaveAttribute('href', 'https://l.in/m')
    expect(within(cards[1]).getByRole('img', { name: 'Solar Roots' })).toHaveAttribute('src', 'http://img/p/logo/c.webp')
  })
})
