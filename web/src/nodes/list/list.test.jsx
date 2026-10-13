import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import ListTab from './ListTab.jsx'
import manifest from './manifest.js'

const rows = () => [
  { item_id: 'i1', source: { kind: 'network_expert', id: 'e1', state: 'ok' }, display: { title_en: 'Ada', title_ar: 'آدا', subtitle_en: 'CTO', bio_en: 'short bio', linkedin_url: 'https://l.in/ada' }, overlay: { notes: 'vip' }, status: 'confirmed', sort_order: 1, excluded: false, contact: { email: 'a@x.io' }, cursor: { s: 1, k: 'i1' } },
  { item_id: null, source: { kind: 'form_response', id: 'r1', state: 'ok' }, display: { title_en: 'Resp Co' }, overlay: {}, status: null, sort_order: null, excluded: false, cursor: { s: 9, k: 'r1' } },
  { item_id: 'i3', source: { kind: 'network_expert', id: null, state: 'missing' }, display: { title_en: 'Gone' }, overlay: {}, status: null, sort_order: 2, excluded: false, cursor: { s: 2, k: 'i3' } },
]

const mocks = vi.hoisted(() => ({
  resolveList: vi.fn(), ensureItem: vi.fn(), patch: vi.fn(), setStatus: vi.fn(), exclude: vi.fn(), withdraw: vi.fn(), reinstate: vi.fn(), reorder: vi.fn(), addManual: vi.fn(), updateManual: vi.fn(), remove: vi.fn(), detach: vi.fn(), addPick: vi.fn(), ensureItems: vi.fn(),
  viewLink: vi.fn(), ensureViewLink: vi.fn(), getPublicList: vi.fn(),
}))

vi.mock('../../data/lists.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  const { normalizeListItem } = await import('../../lib/entities.js')
  const listItems = async (id, { kind = 'generic' } = {}) => (await mocks.resolveList(id)).map((r) => normalizeListItem(r, kind))
  const materialize = async (listId, item) => item.itemId ?? mocks.ensureItem(listId, item.source.kind, item.source.id)
  return {
    LIST_VIEW_KEY: 'list-tab',
    getListMeta: async () => ({ subkind: 'expert' }),
    listItems,
    getPublicList: mocks.getPublicList,
    useListMeta: (id) => useQuery({ queryKey: ['node', id, 'listMeta'], queryFn: async () => ({ subkind: 'expert' }) }),
    useListItems: (id, { filter = {}, kind } = {}, options = {}) => useQuery({ queryKey: ['node', id, 'items', filter], queryFn: () => listItems(id, { kind }), ...options }),
    useViewLink: (id) => useQuery({ queryKey: ['node', id, 'viewLink'], queryFn: () => mocks.viewLink() }),
    usePublicList: (ref) => useQuery({ queryKey: ['public', 'list', ref], queryFn: () => mocks.getPublicList(ref), enabled: Boolean(ref) }),
    useListMutations: (id) => {
      const qc = useQueryClient()
      const after = () => qc.invalidateQueries({ queryKey: ['node', id] })
      const useM = (fn) => useMutation({ mutationFn: fn, onSuccess: after })
      const m = useM
      return {
        patchOverlay: m(async ({ item, patch }) => mocks.patch(await materialize(id, item), patch)),
        setStatus: m(async ({ item, status }) => mocks.setStatus(await materialize(id, item), status)),
        exclude: m(async ({ item, excluded }) => mocks.exclude(await materialize(id, item), excluded)),
        withdraw: m(async ({ item, reason = null }) => mocks.withdraw(await materialize(id, item), reason)),
        reinstate: m(async ({ item }) => mocks.reinstate(await materialize(id, item))),
        bulkWithdraw: m(async ({ items, reason = null }) => { for (const it of items) await mocks.withdraw(await materialize(id, it), reason) }),
        bulkReinstate: m(async ({ items }) => { for (const it of items) await mocks.reinstate(await materialize(id, it)) }),
        reorder: m(async ({ items }) => mocks.reorder(id, items.map((i) => i.id))),
        addManual: m(({ fields }) => mocks.addManual(id, fields)),
        updateManual: m(({ item, fields }) => mocks.updateManual(item.itemId, fields)),
        remove: m(({ item }) => mocks.remove(item.itemId)),
        addNetworkPick: m(({ expertId }) => mocks.addPick(id, expertId)),
        addCompanyPick: m(({ companyId }) => mocks.addPick(id, companyId)),
        detach: m(async ({ item }) => mocks.detach(await materialize(id, item))),
        bulkStatus: m(async ({ items, status }) => { for (const it of items) await mocks.setStatus(await materialize(id, it), status) }),
        bulkExclude: m(async ({ items, excluded }) => { for (const it of items) await mocks.exclude(await materialize(id, it), excluded) }),
        ensureViewLink: useMutation({ mutationFn: () => mocks.ensureViewLink(), onSuccess: () => qc.invalidateQueries({ queryKey: ['node', id, 'viewLink'] }) }),
      }
    },
  }
})
vi.mock('../../data/people.js', async () => {
  const { useQuery, useMutation } = await import('@tanstack/react-query')
  return {
    useNetworkExperts: () => useQuery({ queryKey: ['experts'], queryFn: async () => [{ id: 'e1', kind: 'expert', title: { en: 'Ada', ar: '' }, subtitle: { en: 'CTO', ar: '' }, organization: { en: '', ar: '' }, bio: { en: '', ar: '' }, imagePath: null, links: [] }, { id: 'e2', kind: 'expert', title: { en: 'Grace', ar: '' }, subtitle: { en: '', ar: '' }, organization: { en: '', ar: '' }, bio: { en: '', ar: '' }, imagePath: null, links: [] }] }),
    useCompanies: () => useQuery({ queryKey: ['companies'], queryFn: async () => [] }),
    usePeopleMutations: () => ({ createExpert: useMutation({ mutationFn: async () => null }), createCompany: useMutation({ mutationFn: async () => null }) }),
  }
})
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn() }))

const auth = { user: { id: 'u1' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const node = { id: 'L', project_id: 'P', type: 'list', type_version: 1, name_en: 'Experts', name_ar: 'الخبراء', visibility: 'public', show_to_participants: false, config: {}, rev: 1 }
const graph = { nodes: [{ id: 'L', type: 'list' }, { id: 'F', type: 'form_builder', name_en: 'Apply form' }], edges: [{ from_node_id: 'F', from_port: 'responses', to_node_id: 'L', to_port: 'items-in', is_enabled: true }] }

function mount(mode, over = {}) {
  const adapter = createMemoryAdapter({ nodes: [{ ...node, ...over }], edges: graph.edges })
  renderWithProviders(
    <AuthContext.Provider value={auth}><ConfirmProvider><NodeHost mode={mode} node={{ ...node, ...over }} graph={graph} projectId="P" adapter={adapter} /></ConfirmProvider></AuthContext.Provider>,
    { route: '/projects/P/nodes/L?lang=en' },
  )
  return adapter
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveList.mockImplementation(async () => rows())
  mocks.ensureItem.mockResolvedValue('new-id')
  mocks.addManual.mockResolvedValue('m1')
  mocks.viewLink.mockResolvedValue(null)
  mocks.ensureViewLink.mockResolvedValue({ linkId: 'lk', slug: 'abc123xyz0', enabled: true })
})

describe('List node', () => {
  it('manifest exposes the items resolver and the list-tab contributed view', () => {
    expect(manifest.ports.out.find((p) => p.key === 'items').resolve).toBeTypeOf('function')
    expect(manifest.contributesViews[0].key).toBe('list-tab')
    expect(manifest.visibility.showToParticipants).toBe(true)
  })

  it('Edit: lists items with the connected source, edits a virtual item lazily through ensure_item', async () => {
    const user = userEvent.setup()
    mount('edit')
    expect(await screen.findByText('Apply form')).toBeInTheDocument()
    const rowsEl = await screen.findAllByTestId('item-row')
    expect(rowsEl).toHaveLength(3)
    expect(within(rowsEl[2]).getByText('Source removed')).toBeInTheDocument()
    const notes = within(rowsEl[1]).getByRole('textbox', { name: /Notes/ })
    await user.type(notes, 'first edit{Enter}')
    await waitFor(() => expect(mocks.ensureItem).toHaveBeenCalledWith('L', 'form_response', 'r1'))
    expect(mocks.patch).toHaveBeenCalledWith('new-id', { notes: 'first edit' })
  })

  it('Edit: WITHDRAWN replaces Hide: a virtual item is materialised, the dialog asks for an optional reason, Undo reinstates; the manager asks for withdrawn items too', async () => {
    const user = userEvent.setup()
    mocks.resolveList.mockImplementation(async () => [...rows(), { item_id: 'i9', source: { kind: 'network_expert', id: 'e9', state: 'ok' }, display: { title_en: 'Wendy' }, overlay: {}, status: null, sort_order: 3, excluded: false, withdrawn: true, withdrawal: { at: '2026-10-12T09:00:00Z', reason: 'cannot attend', source: 'item' }, cursor: { s: 3, k: 'i9' } }])
    mount('edit')
    const rowsEl = await screen.findAllByTestId('item-row')
    expect(rowsEl).toHaveLength(4)
    expect(screen.queryByRole('button', { name: /^Hide/ })).toBeNull()
    expect(screen.getByTestId('presence-filter')).toBeInTheDocument()
    const wendy = rowsEl.find((r) => within(r).queryByText('Wendy'))
    expect(within(wendy).getByTestId('withdrawn-chip')).toBeInTheDocument()
    await user.click(within(wendy).getByTestId('reinstate'))
    await waitFor(() => expect(mocks.reinstate).toHaveBeenCalledWith('i9'))
    expect(await screen.findByText('"Wendy" is reinstated.')).toBeInTheDocument()
    const resp = rowsEl.find((r) => within(r).queryByText('Resp Co'))
    await user.click(within(resp).getByTestId('withdraw'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Mark "Resp Co" as withdrawn?')
    await user.click(within(dlg).getByTestId('withdraw-confirm')) // the reason is optional
    await waitFor(() => expect(mocks.ensureItem).toHaveBeenCalledWith('L', 'form_response', 'r1'))
    expect(mocks.withdraw).toHaveBeenCalledWith('new-id', null)
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mocks.reinstate).toHaveBeenLastCalledWith('new-id'))
  })

  it('ListTab (public / platform): withdrawn items are never rendered, even if a payload carried them', () => {
    const data = { items: [{ display: { title_en: 'Active Ada' }, source: { kind: 'manual', id: null, state: 'ok' }, item_id: 'a' }, { display: { title_en: 'Gone Gus' }, source: { kind: 'manual', id: null, state: 'ok' }, item_id: 'g', withdrawn: true }], config: { kind: 'expert', card: {} } }
    renderWithProviders(<ListTab data={data} audience="public" />, { route: '/x?lang=en' })
    expect(screen.getByText('Active Ada')).toBeInTheDocument()
    expect(screen.queryByText('Gone Gus')).toBeNull()
  })

  it('Edit: add a manual item through the editor (fields + overlay patch)', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('item-row')
    await user.click(screen.getByTestId('add-manual'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByTestId('item-editor-save'))
    expect(await within(dialog).findByText('Enter the name in at least one language.')).toBeInTheDocument()
    await user.type(within(dialog).getAllByLabelText('English')[0], 'Manual Mike')
    await user.type(within(dialog).getByLabelText('Notes'), 'hello')
    await user.click(within(dialog).getByTestId('item-editor-save'))
    await waitFor(() => expect(mocks.addManual).toHaveBeenCalledWith('L', expect.objectContaining({ title_en: 'Manual Mike' })))
    expect(mocks.patch).toHaveBeenCalledWith('m1', expect.objectContaining({ notes: 'hello', card: null }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Edit: detach asks for confirmation and remove is confirmed too; picker adds by reference with a duplicate guard', async () => {
    const user = userEvent.setup()
    mount('edit')
    const rowsEl = await screen.findAllByTestId('item-row')
    await user.click(within(rowsEl[0]).getByRole('button', { name: /Detach to manual item/ }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Detach "Ada" from its source?')
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mocks.detach).toHaveBeenCalledWith('i1'))
    await user.click(screen.getByTestId('pick-expert'))
    const picker = await screen.findByRole('dialog')
    const list = await within(picker).findByTestId('picker-results')
    expect(within(list).getByText('Already in this list')).toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: 'Add: Grace' }))
    await waitFor(() => expect(mocks.addPick).toHaveBeenCalledWith('L', 'e2'))
    expect(await within(list).findByText('Added')).toBeInTheDocument()
  })

  it('View: renders the tab component; missing items are visible to the PM only', async () => {
    mount('view')
    const tab = await screen.findByTestId('list-tab')
    await waitFor(() => expect(within(tab).getAllByTestId('entity-card')).toHaveLength(3))
    expect(within(tab).getByRole('heading', { level: 2 })).toHaveTextContent('Experts')
  })

  it('Settings: saves name/visibility and config in ONE save_node call; creates the public link', async () => {
    const user = userEvent.setup()
    const adapter = mount('settings')
    await screen.findByTestId('settings-card')
    await user.click(screen.getByLabelText('Bio'))
    await user.click(screen.getByLabelText(/Private/))
    await user.type(screen.getAllByLabelText('English')[0], ' 2026')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    expect(adapter.snapshot().nodes[0].config.card.showFields).not.toContain('bio')
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    await user.click(screen.getByTestId('create-link'))
    await waitFor(() => expect(mocks.ensureViewLink).toHaveBeenCalled())
  })
})

describe('ListTab (public payload contract)', () => {
  it('renders get_public_tab data with the card config, hides missing items from the public and offers load more', async () => {
    const onLoadMore = vi.fn()
    const data = { items: [{ item_id: 'i1', source: { kind: 'network_expert', id: 'e1', state: 'ok' }, display: { title_en: 'Ada', bio_en: 'b' }, card: { show: { show_bio: false } } }, { item_id: 'i2', source: { kind: 'network_expert', id: null, state: 'missing' }, display: { title_en: 'Gone' } }], next: { s: 1, k: 'i1' }, config: { kind: 'expert', card: { showFields: ['title', 'bio'], accent: '#1a27c9' } } }
    renderWithProviders(<ListTab data={data} title="Experts" audience="public" onLoadMore={onLoadMore} hasMore />, { route: '/view/x/list-tab?lang=en' })
    const cards = screen.getAllByTestId('entity-card')
    expect(cards).toHaveLength(1)
    expect(within(cards[0]).queryByText('b')).toBeNull()
    expect(cards[0].style.borderTopColor).toBe('rgb(26, 39, 201)')
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull() // one item: title hidden (hideTitleOnSingle)
    await act(async () => screen.getByRole('button', { name: 'Load more' }).click())
    expect(onLoadMore).toHaveBeenCalled()
  })
})
