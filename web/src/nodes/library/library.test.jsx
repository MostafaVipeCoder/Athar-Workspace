import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import LibraryTab from './LibraryTab.jsx'
import PublicLibraryPage from '../../app/pages/PublicLibraryPage.jsx'
import FounderLibraryButtons from '../../app/pages/founder/FounderLibraryButtons.jsx'
import manifest from './manifest.js'
import { _setLoader } from '../../lib/export/xlsx.js'

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const R3 = '33333333-3333-4333-8333-333333333333'
const C1 = 'c1111111-1111-4111-8111-111111111111'
const base = { category_id: null, description_en: null, description_ar: null, cover_path: null, bytes: null, mime: null, file_path: null, url: null }
const defRows = () => ({
  categories: [{ id: C1, name_en: 'Guides', name_ar: 'أدلة', sort_order: 1 }],
  resources: [
    { ...base, id: R1, category_id: C1, title_en: 'Roadmap', title_ar: 'خارطة الطريق', type: 'readable', visibility: 'public', file_path: 'P/N/a.pdf', mime: 'application/pdf', bytes: 426331, sort_order: 1 },
    { ...base, id: R2, title_en: 'Launch video', title_ar: null, type: 'visual', visibility: 'participants', url: 'https://youtu.be/abc', sort_order: 2 },
    { ...base, id: R3, title_en: 'Internal notes', title_ar: 'ملاحظات', type: 'link', visibility: 'hidden', url: 'https://example.com/n', sort_order: 3 },
  ],
})

const mocks = vi.hoisted(() => ({
  getDef: vi.fn(), getLink: vi.fn(), ensureLink: vi.fn(), upload: vi.fn(), removeFiles: vi.fn(), signed: vi.fn(), signedMany: vi.fn(), publicLib: vi.fn(), founder: vi.fn(),
  uploadImage: vi.fn(), removeImage: vi.fn(),
}))

vi.mock('../../data/library.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    LIBRARY_VIEW_KEY: 'library-tab',
    getLibraryDefinition: mocks.getDef,
    uploadResourceFile: mocks.upload,
    removeResourceFiles: mocks.removeFiles,
    signedResourceUrl: mocks.signed,
    useLibraryDefinition: (id) => useQuery({ queryKey: ['node', id, 'library'], queryFn: () => mocks.getDef(id) }),
    useLibraryLink: (id) => useQuery({ queryKey: ['node', id, 'libraryLink'], queryFn: () => mocks.getLink() }),
    usePublicLibrary: (ref) => useQuery({ queryKey: ['public', 'library', ref], queryFn: () => mocks.publicLib(ref), enabled: Boolean(ref) }),
    useFounderLibraries: (p) => useQuery({ queryKey: ['founderLibraries', p], queryFn: () => mocks.founder(p), enabled: Boolean(p) }),
    useSignedUrls: (paths) => useQuery({ queryKey: ['library', 'signed', paths], queryFn: () => mocks.signedMany(paths), enabled: paths.length > 0 }),
    useLibraryMutations: (id) => {
      const qc = useQueryClient()
      return { ensureLink: useMutation({ mutationFn: () => mocks.ensureLink(), onSuccess: () => qc.invalidateQueries({ queryKey: ['node', id, 'libraryLink'] }) }) }
    },
  }
})
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: mocks.uploadImage, removeImage: mocks.removeImage }))

const auth = { user: { id: 'u1' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const node = { id: 'N', project_id: 'P', type: 'library', type_version: 1, name_en: 'Library', name_ar: 'المكتبة', visibility: 'public', show_to_participants: false, config: { layout: 'grid', legacyKey: 'keep' }, rev: 1 }
const graph = { project: { id: 'P', timezone: 'Africa/Cairo' }, nodes: [{ id: 'N', type: 'library', name_en: 'Library' }], edges: [] }

function mount(mode, over = {}) {
  const adapter = createMemoryAdapter({ nodes: [{ ...node, ...over }], edges: [] })
  renderWithProviders(
    <AuthContext.Provider value={auth}><ConfirmProvider><NodeHost mode={mode} node={{ ...node, ...over }} graph={graph} projectId="P" adapter={adapter} /></ConfirmProvider></AuthContext.Provider>,
    { route: '/projects/P/nodes/N?lang=en' },
  )
  return adapter
}
const titles = () => screen.getAllByTestId('resource-row').map((r) => r.getAttribute('aria-label'))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getDef.mockImplementation(async () => defRows())
  mocks.getLink.mockResolvedValue(null)
  mocks.ensureLink.mockResolvedValue({ linkId: 'lk', slug: 'lib123xyz0', enabled: true })
  mocks.upload.mockResolvedValue({ path: 'P/N/new.pdf', mime: 'application/pdf', bytes: 2048 })
  mocks.signed.mockResolvedValue('https://signed.example/file?token=t')
  mocks.signedMany.mockResolvedValue({})
  mocks.uploadImage.mockResolvedValue('P/library/cover.webp')
})

describe('Library node', () => {
  it('manifest: the contributed view key equals the out port key, own children writer, founder exposure allowed', () => {
    expect(manifest.ports.out.map((p) => p.key)).toEqual(['library-tab'])
    expect(manifest.contributesViews[0].key).toBe('library-tab')
    expect(manifest.visibility.showToParticipants).toBe(true)
    expect(manifest.defaultConfig()).toEqual({ layout: 'grid', groupBy: 'auto', searchEnabled: true })
  })

  it('Edit: lists the rows with their visibility; add a link + upload a file + a section, ONE save_node carries config + children (order = position)', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    expect(await screen.findAllByTestId('resource-row')).toHaveLength(3)
    expect(titles()).toEqual(['Roadmap', 'Launch video', 'Internal notes'])
    expect(within(screen.getAllByTestId('resource-row')[2]).getByTestId('row-visibility')).toHaveValue('hidden')

    // a section
    await user.click(screen.getByTestId('add-category'))
    const catRows = screen.getAllByTestId('category-row')
    expect(catRows).toHaveLength(2)
    await user.type(within(catRows[1]).getByLabelText('Name (English)'), 'Videos')

    // a link
    await user.click(screen.getByTestId('add-link'))
    const editor = await screen.findByTestId('resource-editor')
    await user.type(within(editor).getAllByLabelText('English')[0], 'Pitch deck')
    fireEvent.change(within(editor).getByTestId('row-url'), { target: { value: 'https://youtube.com/watch?v=1' } })
    expect(within(editor).getByTestId('row-type')).toHaveValue('visual') // suggested from the host
    await user.selectOptions(within(editor).getByTestId('row-category'), 'Videos')

    // an uploaded file
    const input = screen.getByTestId('file-input')
    const pdf = new File(['%PDF-1.4'], 'Workshop-notes.pdf', { type: 'application/pdf' })
    await user.upload(input, pdf)
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1))
    expect(mocks.upload.mock.calls[0][1]).toEqual({ projectId: 'P', nodeId: 'N' })
    await waitFor(() => expect(screen.getAllByTestId('resource-row')).toHaveLength(5))
    expect(titles()[4]).toBe('Workshop notes')

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    expect(spy).toHaveBeenCalledTimes(1)
    const [, , patch, opts] = spy.mock.calls[0]
    expect(patch.config).toMatchObject({ legacyKey: 'keep' })
    expect(opts.children.categories).toEqual([{ id: C1, name_en: 'Guides', name_ar: 'أدلة', sort_order: 1 }, expect.objectContaining({ name_en: 'Videos', sort_order: 2 })])
    expect(opts.children.resources.map((r) => r.sort_order)).toEqual([1, 2, 3, 4, 5])
    expect(opts.children.resources[0]).toMatchObject({ id: R1, category_id: C1, file_path: 'P/N/a.pdf', mime: 'application/pdf', bytes: 426331, url: null })
    expect(opts.children.resources[3]).toMatchObject({ title_en: 'Pitch deck', type: 'visual', url: 'https://youtube.com/watch?v=1', file_path: null, category_id: opts.children.categories[1].id })
    expect(opts.children.resources[4]).toMatchObject({ title_en: 'Workshop notes', type: 'readable', file_path: 'P/N/new.pdf', mime: 'application/pdf', bytes: 2048, url: null })
    // the uploaded file is saved: it is NOT removed afterwards
    expect(mocks.removeFiles).not.toHaveBeenCalledWith(expect.arrayContaining(['P/N/new.pdf']))
  })

  it('Edit: a rejected file type never reaches storage; validation blocks the save (no title, bad link) and nothing is written', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findAllByTestId('resource-row')
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' })] } })
    expect(await screen.findByText(/setup.exe: This file type is not accepted/)).toBeInTheDocument()
    expect(mocks.upload).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('add-link'))
    const editor = await screen.findByTestId('resource-editor')
    fireEvent.change(within(editor).getByTestId('row-url'), { target: { value: 'javascript:alert(1)' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Fix the highlighted resources first.')).toBeInTheDocument()
    expect(screen.getAllByText('Enter a title in at least one language.').length).toBeGreaterThan(0)
    expect(screen.getByText('Enter a full link starting with https://.')).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  it('Edit: removing asks for confirmation, Undo puts the row back where it was, a section with resources asks too and Undo restores the links', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findAllByTestId('resource-row')
    await user.click(within(screen.getAllByTestId('resource-row')[1]).getByTestId('row-remove'))
    let dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('Remove "Launch video"?')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(titles()).toHaveLength(3)
    await user.click(within(screen.getAllByTestId('resource-row')[1]).getByTestId('row-remove'))
    dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(titles()).toEqual(['Roadmap', 'Internal notes']))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(titles()).toEqual(['Roadmap', 'Launch video', 'Internal notes']))

    await user.click(screen.getByTestId('remove-category'))
    dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('1 resources in it become uncategorised.')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryAllByTestId('category-row')).toHaveLength(0))
    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0])
    await waitFor(() => expect(screen.getAllByTestId('category-row')).toHaveLength(1))
    await user.click(within(screen.getAllByTestId('resource-row')[0]).getByTestId('row-expand'))
    expect(within(await screen.findByTestId('resource-editor')).getByTestId('row-category')).toHaveValue(C1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('Edit: reorder with the arrows (order saved as sort_order), visibility per row, reorder disabled while filtering, hidden count', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findAllByTestId('resource-row')
    await user.click(screen.getByRole('button', { name: 'Move up: Internal notes' }))
    await user.selectOptions(within(screen.getAllByTestId('resource-row')[0]).getByTestId('row-visibility'), 'participants')
    expect(titles()).toEqual(['Roadmap', 'Internal notes', 'Launch video'])
    await user.type(screen.getByRole('searchbox', { name: 'Search resources' }), 'launch')
    expect(screen.getByText('Clear the search and filters to reorder.')).toBeInTheDocument()
    expect(within(screen.getByTestId('resources')).queryByRole('button', { name: /^Move up/ })).toBeNull()
    await user.clear(screen.getByRole('searchbox', { name: 'Search resources' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const res = spy.mock.calls[0][3].children.resources
    expect(res.map((r) => [r.id, r.sort_order, r.visibility])).toEqual([[R1, 1, 'participants'], [R3, 2, 'hidden'], [R2, 3, 'participants']])
  })

  it('Edit: exports the index to Excel (PM order, translated headers, one sheet)', async () => {
    const user = userEvent.setup()
    const written = {}
    _setLoader(async () => ({ utils: { book_new: () => ({ sheets: {} }), aoa_to_sheet: (aoa) => aoa, book_append_sheet: (wb, ws, name) => { wb.sheets[name] = ws } }, writeFile: (wb, name) => { written.name = name; written.sheets = wb.sheets } }))
    mount('edit')
    await screen.findAllByTestId('resource-row')
    await user.click(screen.getByTestId('export'))
    await waitFor(() => expect(written.name).toBe('Library-index.xlsx'))
    const rows = written.sheets.Library
    expect(rows[0]).toEqual(['#', 'Title (EN)', 'Title (AR)', 'Description (EN)', 'Description (AR)', 'Type', 'Section', 'Visibility', 'Source', 'Link', 'Size (bytes)'])
    expect(rows.slice(1).map((r) => [r[0], r[1], r[5], r[6], r[7], r[8]])).toEqual([
      [1, 'Roadmap', 'Document', 'Guides', 'Public', 'File'],
      [2, 'Launch video', 'Video / visual', '', 'Participants', 'Link'],
      [3, 'Internal notes', 'Link', '', 'Hidden', 'Link'],
    ])
    expect(rows[2][9]).toBe('https://youtu.be/abc')
    expect(rows[1][10]).toBe(426331)
    _setLoader(() => import('xlsx'))
  })

  it('Edit: replacing the cover and a file of this session removes the previous unsaved upload at once', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('resource-row')
    await user.upload(screen.getByTestId('file-input'), new File(['%PDF'], 'one.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(screen.getAllByTestId('resource-row')).toHaveLength(4))
    const row = screen.getAllByTestId('resource-row')[3]
    mocks.upload.mockResolvedValueOnce({ path: 'P/N/two.pdf', mime: 'application/pdf', bytes: 10 })
    const hidden = within(row).getByTestId('resource-editor').querySelector('input[type="file"]')
    await user.upload(hidden, new File(['%PDF'], 'two.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(mocks.removeFiles).toHaveBeenCalledWith(['P/N/new.pdf', 'P/N/new_t.pdf']))
  })

  it('View: the PM preview shows every resource with hidden/participants marks, grouped by section', async () => {
    mount('view')
    const tab = await screen.findByTestId('library-tab')
    expect(tab).toHaveAttribute('data-audience', 'pm')
    expect(within(tab).getAllByTestId('resource')).toHaveLength(3)
    expect(within(tab).getByText('Hidden')).toBeInTheDocument()
    expect(within(tab).getByText('Participants')).toBeInTheDocument()
    expect(screen.getByText('Create the public link in Settings to open the page.')).toBeInTheDocument()
    expect(within(tab).getAllByTestId('resource-group').map((g) => g.getAttribute('data-group'))).toEqual([`cat:${C1}`, 'cat:none'])
  })

  it('Settings: name, visibility, display and show-to-participants in ONE save_node, the link is created lazily', async () => {
    const user = userEvent.setup()
    mocks.ensureLink.mockImplementation(async () => { mocks.getLink.mockResolvedValue({ linkId: 'lk', slug: 'lib123xyz0', enabled: true }); return { slug: 'lib123xyz0' } })
    const adapter = mount('settings')
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findByTestId('library-settings')
    await user.selectOptions(screen.getByTestId('layout'), 'list')
    await user.selectOptions(screen.getByTestId('group-by'), 'type')
    await user.click(screen.getByTestId('search-enabled'))
    await user.click(screen.getByTestId('show-to-participants'))
    await user.click(screen.getByLabelText(/^Platform/))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][2]).toMatchObject({ visibility: 'platform', show_to_participants: true, name_en: 'Library', config: { layout: 'list', groupBy: 'type', searchEnabled: false, legacyKey: 'keep' } })
    expect(spy.mock.calls[0][3].children).toBeNull()
    await user.click(screen.getByTestId('create-link'))
    expect(await screen.findByText(/\/view\/lib123xyz0\/library-tab/)).toBeInTheDocument()
  })
})

describe('LibraryTab (public payload contract)', () => {
  const data = {
    config: { layout: 'grid', groupBy: 'auto' },
    categories: [],
    resources: [
      { id: 'a', title_en: 'Roadmap', title_ar: 'خارطة', type: 'readable', file_path: 'P/N/a.pdf', has_file: true, mime: 'application/pdf', bytes: 426331, sort_order: 1 },
      { id: 'b', title_en: 'Launch video', title_ar: null, description_en: 'How we launched', type: 'visual', url: 'https://youtu.be/abc', sort_order: 2 },
      { id: 'c', title_en: 'Podcast', title_ar: null, type: 'audible', url: 'https://example.com/p', sort_order: 3 },
      { id: 'd', title_en: 'Bad link', title_ar: null, type: 'link', url: 'javascript:alert(1)', sort_order: 4 },
      { id: 'e', title_en: 'Team photo', title_ar: null, type: 'visual', file_path: 'P/N/e.webp', has_file: true, mime: 'image/webp', bytes: 90000, sort_order: 5 },
    ],
  }

  it('groups by type (the as-is viewer) with counts, filters by type chip and by search (both languages), never renders a non-http link', async () => {
    const user = userEvent.setup()
    mocks.signedMany.mockResolvedValue({ 'P/N/e_t.webp': 'https://signed.example/thumb' })
    renderWithProviders(<LibraryTab data={data} title="Library" audience="public" />, { route: '/x?lang=en' })
    const tab = screen.getByTestId('library-tab')
    expect(within(tab).getAllByTestId('resource-group').map((g) => g.getAttribute('data-group'))).toEqual(['type:readable', 'type:audible', 'type:visual', 'type:link'])
    expect(within(tab).getByRole('heading', { level: 2 })).toHaveTextContent('Library')
    // no visibility badges for visitors
    expect(within(tab).queryByText('Hidden')).toBeNull()
    // the bad link renders no open button
    const bad = within(tab).getAllByTestId('resource').find((r) => within(r).queryByText('Bad link'))
    expect(within(bad).queryByRole('link')).toBeNull()
    const video = within(tab).getAllByTestId('resource').find((r) => within(r).queryByText('Launch video'))
    expect(within(video).getByRole('link', { name: 'Open link: Launch video' })).toHaveAttribute('href', 'https://youtu.be/abc')
    expect(within(video).getByRole('link', { name: /Open link/ })).toHaveAttribute('rel', 'noopener noreferrer')
    // the image resource gets its signed thumbnail
    await waitFor(() => expect(tab.querySelector('img[src="https://signed.example/thumb"]')).not.toBeNull())
    // type chips
    await user.click(within(tab).getByRole('button', { name: /^Audio/ }))
    expect(within(tab).getAllByTestId('resource')).toHaveLength(1)
    await user.click(within(tab).getByRole('button', { name: /^All/ }))
    await user.type(within(tab).getByRole('searchbox', { name: 'Search the library' }), 'launched')
    expect(within(tab).getAllByTestId('resource')).toHaveLength(1)
    await user.clear(within(tab).getByRole('searchbox', { name: 'Search the library' }))
    await user.type(within(tab).getByRole('searchbox', { name: 'Search the library' }), 'zzz')
    expect(await within(tab).findByText('No resources match.')).toBeInTheDocument()
    await user.click(within(tab).getByRole('button', { name: 'Clear filters' }))
    expect(within(tab).getAllByTestId('resource')).toHaveLength(5)
    // layout toggle is remembered per viewer
    await user.click(within(tab).getByRole('button', { name: 'List' }))
    expect(within(tab).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('athar.library.layout')).toBe('list')
  })

  it('a file opens through a signed URL minted at click time (new tab, no public URL); download names the file after the title', async () => {
    const user = userEvent.setup()
    const win = { location: { href: '' }, opener: 'x', close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(win)
    renderWithProviders(<LibraryTab data={data} title="Library" audience="public" />, { route: '/x?lang=en' })
    await user.click(screen.getByRole('button', { name: 'Open: Roadmap' }))
    await waitFor(() => expect(win.location.href).toBe('https://signed.example/file?token=t'))
    expect(mocks.signed).toHaveBeenCalledWith('P/N/a.pdf')
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(win.opener).toBeNull()

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: 'Download: Roadmap' }))
    await waitFor(() => expect(mocks.signed).toHaveBeenCalledWith('P/N/a.pdf', { download: 'Roadmap.pdf' }))
    expect(click).toHaveBeenCalled()

    // a denied file closes the blank window and says so
    mocks.signed.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { messageKey: 'errors.forbidden' }))
    await user.click(screen.getByRole('button', { name: 'Open: Roadmap' }))
    expect(await screen.findByText('You do not have access to this file.')).toBeInTheDocument()
    expect(win.close).toHaveBeenCalled()
    open.mockRestore()
    click.mockRestore()
  })

  it('groups by section when the payload has sections, Arabic names in Arabic, uncategorised last; empty library and no-link states', () => {
    const withCats = { config: {}, categories: [{ id: 'c1', name_en: 'Guides', name_ar: 'أدلة' }], resources: [{ id: 'a', category_id: 'c1', title_en: 'A', type: 'link', url: 'https://x.y' }, { id: 'b', title_en: 'B', type: 'link', url: 'https://x.y' }] }
    const { unmount } = renderWithProviders(<LibraryTab data={withCats} title="Lib" hideTitle audience="public" />, { route: '/x?lang=ar' })
    expect(screen.getAllByTestId('resource-group').map((g) => g.getAttribute('data-group'))).toEqual(['cat:c1', 'cat:none'])
    expect(screen.getByText('أدلة')).toBeInTheDocument()
    expect(screen.getByText('أخرى')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    unmount()
    renderWithProviders(<LibraryTab data={{ resources: [], categories: [] }} title="Lib" audience="public" />, { route: '/x?lang=en' })
    expect(screen.getByText('The library is empty.')).toBeInTheDocument()
  })
})

describe('PublicLibraryPage (/view/:ref/library-tab)', () => {
  function mountPage(ref = 'lib123xyz0') {
    renderWithProviders(<AuthContext.Provider value={{ status: 'anon' }}><Routes><Route path="/view/:nodeRef/library-tab" element={<PublicLibraryPage />} /></Routes></AuthContext.Provider>, { route: `/view/${ref}/library-tab?lang=en` })
  }
  it('renders the DB payload with the audience the DB decided and sets the document title', async () => {
    mocks.publicLib.mockResolvedValue({ type: 'library', node_id: 'N', revision: 4, viewer: 'participant', title_en: 'Program library', title_ar: 'مكتبة البرنامج', data: { config: {}, categories: [], resources: [{ id: 'a', title_en: 'Deck', type: 'link', url: 'https://x.y' }] } })
    mountPage()
    const page = await screen.findByTestId('public-library-page')
    expect(page).toHaveAttribute('data-audience', 'participant')
    expect(await screen.findByTestId('library-tab')).toHaveTextContent('Deck')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Program library')
    expect(document.title).toBe('Program library - Athar')
    expect(mocks.publicLib).toHaveBeenCalledWith('lib123xyz0')
  })
  it('shows the not-available state when the DB answers null or the ref is invalid', async () => {
    mocks.publicLib.mockResolvedValue(null)
    mountPage()
    expect(await screen.findByText('This page is not available.')).toBeInTheDocument()
  })
})

describe('FounderLibraryButtons', () => {
  it('renders one button per exposed library with a ref (node page or host tab), nothing otherwise', async () => {
    mocks.founder.mockResolvedValue([
      { node_id: 'N', name_en: 'Library', name_ar: 'المكتبة', ref: 'lib123xyz0', via: 'node' },
      { node_id: 'M', name_en: 'Second', ref: 'proj', via: 'host' },
      { node_id: 'X', name_en: 'No link', ref: null, via: null },
    ])
    renderWithProviders(<AuthContext.Provider value={auth}><FounderLibraryButtons projectId="P" /></AuthContext.Provider>, { route: '/alumni/founder/programs/P?lang=en' })
    const box = await screen.findByTestId('founder-library-buttons')
    const links = within(box).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/view/lib123xyz0/library-tab?lang=en', '/agenda/proj/library?lang=en'])
    expect(links[0]).toHaveTextContent('Library')
  })
})

