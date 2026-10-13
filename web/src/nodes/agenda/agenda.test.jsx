import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useParams } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import { todayInTz } from '../../lib/time/tz.js'
import AgendaTab from './AgendaTab.jsx'
import AgendaHost from '../../app/pages/agenda/AgendaHost.jsx'
import FounderAgendaButtons from '../../app/pages/founder/FounderAgendaButtons.jsx'
import manifest from './manifest.js'
import { resolveSchedule } from './data.js'

const D1 = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const defRows = () => ({ days: [{ id: D1, sort_order: 1, day_date: '2026-11-03', name_en: 'Day 1', name_ar: 'اليوم الأول', slots: [{ id: S1, day_id: D1, sort_order: 1, start_time: '09:00:00', end_time: '09:45:00', title_en: 'Opening', title_ar: 'الافتتاح', presenter_en: 'Ada', presenter_ar: null, presenter_item_id: null, show_presenter: true, bullets: [{ en: 'Welcome', ar: 'مرحباً' }] }] }] })

const mocks = vi.hoisted(() => ({
  getDef: vi.fn(), getLink: vi.fn(), ensureLink: vi.fn(), getProjectLink: vi.fn(), ensureProjectLink: vi.fn(), updateTabs: vi.fn(), setCover: vi.fn(),
  getAgendaView: vi.fn(), getPublicTab: vi.fn(), founderAgendas: vi.fn(),
}))

vi.mock('../../data/agenda.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    AGENDA_LINK_KIND: 'agenda',
    getAgendaDefinition: mocks.getDef, getAgendaLink: mocks.getLink, getAgendaView: mocks.getAgendaView, getPublicTab: mocks.getPublicTab, listFounderAgendas: mocks.founderAgendas,
    useAgendaDefinition: (id) => useQuery({ queryKey: ['node', id, 'agenda'], queryFn: () => mocks.getDef(id) }),
    useAgendaLink: (id) => useQuery({ queryKey: ['node', id, 'agendaLink'], queryFn: () => mocks.getLink() }),
    useProjectPageLink: (p, h, o = {}) => useQuery({ queryKey: ['projectLink', p, h], queryFn: () => mocks.getProjectLink(), ...o }),
    useAgendaView: (ref) => useQuery({ queryKey: ['public', 'agenda', ref], queryFn: () => mocks.getAgendaView(ref), enabled: Boolean(ref) }),
    useFounderAgendas: (p) => useQuery({ queryKey: ['founderAgendas', p], queryFn: () => mocks.founderAgendas(p), enabled: Boolean(p) }),
    useAgendaMutations: (id, projectId) => {
      const qc = useQueryClient()
      return {
        ensureLink: useMutation({ mutationFn: () => mocks.ensureLink(), onSuccess: () => qc.invalidateQueries({ queryKey: ['node', id, 'agendaLink'] }) }),
        ensureProjectLink: useMutation({ mutationFn: () => mocks.ensureProjectLink(), onSuccess: () => qc.invalidateQueries({ queryKey: ['projectLink', projectId] }) }),
        updateTabs: useMutation({ mutationFn: ({ patches }) => mocks.updateTabs(patches) }),
        setCover: useMutation({ mutationFn: ({ coverPath }) => mocks.setCover(coverPath) }),
      }
    },
  }
})
vi.mock('../../data/lists.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    LIST_VIEW_KEY: 'list-tab',
    getPublicTab: mocks.getPublicTab,
    usePublicTab: (ref, edgeId) => useQuery({ queryKey: ['public', 'tab', ref, edgeId ?? 'agenda'], queryFn: () => mocks.getPublicTab(ref, edgeId), enabled: Boolean(ref) }),
  }
})
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn(), removeImage: vi.fn() }))

const auth = { user: { id: 'u1' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const node = { id: 'A', project_id: 'P', type: 'agenda', type_version: 1, name_en: 'Agenda', name_ar: 'الأجندة', visibility: 'public', show_to_participants: false, config: { showDayNames: false, header: { brandName: 'Athar', fontFamily: 'legacy' }, legacySheetUrl: 'https://x' }, rev: 1 }
const graph = {
  project: { id: 'P', timezone: 'Africa/Cairo', cover_path: null },
  nodes: [{ id: 'A', type: 'agenda', name_en: 'Agenda' }, { id: 'L', type: 'list', name_en: 'Experts', name_ar: 'الخبراء' }, { id: 'H', type: 'view_host', name_en: 'Project page', is_system: true }],
  edges: [
    { id: 'eL', from_node_id: 'L', from_port: 'list-tab', to_node_id: 'A', to_port: 'tabs', is_enabled: true, audience: 'public', label_en: null, label_ar: null, order_index: 0 },
    { id: 'eA', from_node_id: 'A', from_port: 'agenda', to_node_id: 'H', to_port: 'tabs', is_enabled: true, audience: 'public', label_en: null, label_ar: null, order_index: 0 },
    { id: 'eH', from_node_id: 'L', from_port: 'list-tab', to_node_id: 'H', to_port: 'tabs', is_enabled: true, audience: 'public', label_en: 'Mentors', label_ar: null, order_index: 1 },
  ],
}

function mount(mode, over = {}) {
  const adapter = createMemoryAdapter({ nodes: [{ ...node, ...over }], edges: graph.edges })
  renderWithProviders(
    <AuthContext.Provider value={auth}><ConfirmProvider><NodeHost mode={mode} node={{ ...node, ...over }} graph={graph} projectId="P" adapter={adapter} /></ConfirmProvider></AuthContext.Provider>,
    { route: '/projects/P/nodes/A?lang=en' },
  )
  return adapter
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getDef.mockImplementation(async () => defRows())
  mocks.getLink.mockResolvedValue(null)
  mocks.ensureLink.mockResolvedValue({ linkId: 'lk', slug: 'abc123xyz0', enabled: true })
  mocks.getProjectLink.mockResolvedValue({ linkId: 'pl', slug: 'my-project', enabled: true, kind: 'agenda' })
  mocks.updateTabs.mockResolvedValue(undefined)
  mocks.setCover.mockResolvedValue({ id: 'P' })
})

describe('Agenda node', () => {
  it('manifest: schedule + link resolvers, the agenda contributed view, founder exposure allowed', () => {
    expect(manifest.ports.out.find((p) => p.key === 'schedule').resolve).toBeTypeOf('function')
    expect(manifest.ports.out.find((p) => p.key === 'link').resolve).toBeTypeOf('function')
    expect(manifest.contributesViews[0].key).toBe('agenda')
    expect(manifest.ports.in.map((p) => p.key)).toEqual(['tabs', 'participants'])
    expect(manifest.visibility.showToParticipants).toBe(true)
  })

  it('Edit: loads days, adds a day + session and saves config + children in ONE save_node call (brand name round-trips, legacy keys kept)', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    expect(await screen.findByText(/Day 1 · Day 1/)).toBeInTheDocument()
    expect(screen.getByText('Opening')).toBeInTheDocument()
    await user.click(screen.getByTestId('add-day'))
    const cards = screen.getAllByTestId('day-card')
    expect(cards).toHaveLength(2)
    await user.click(within(cards[1]).getByTestId('add-slot'))
    const editor = within(cards[1]).getByTestId('slot-editor')
    fireEvent.change(within(editor).getByTestId('slot-start'), { target: { value: '10:00' } })
    fireEvent.change(within(editor).getByTestId('slot-end'), { target: { value: '11:30' } })
    await user.type(within(editor).getAllByLabelText('English')[0], 'Workshop')
    await user.clear(screen.getByTestId('brand-name'))
    await user.type(screen.getByTestId('brand-name'), 'Athar 2026')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    expect(spy).toHaveBeenCalledTimes(1)
    const [, , patch, opts] = spy.mock.calls[0]
    expect(patch.config.header.brandName).toBe('Athar 2026')
    expect(patch.config.header.fontFamily).toBe('legacy')
    expect(patch.config.legacySheetUrl).toBe('https://x')
    expect(opts.children.days).toHaveLength(2)
    expect(opts.children.days[0]).toMatchObject({ id: D1, sort_order: 1, slots: [{ id: S1, start_time: '09:00', end_time: '09:45' }] })
    expect(opts.children.days[1]).not.toHaveProperty('id')
    expect(opts.children.days[1]).toMatchObject({ sort_order: 2, day_date: '2026-11-04', slots: [{ sort_order: 1, start_time: '10:00', end_time: '11:30', title_en: 'Workshop' }] })
    expect(await screen.findByText('Agenda saved.')).toBeInTheDocument()
  })

  it('Edit: validation blocks the save (end before start) and the duplicate/remove actions stay in the draft', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findByText('Opening')
    await user.click(screen.getByRole('button', { name: /^Opening/ }))
    const editor = await screen.findByTestId('slot-editor')
    fireEvent.change(within(editor).getByTestId('slot-end'), { target: { value: '08:00' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Fix the highlighted days and sessions first.')).toBeInTheDocument()
    expect(screen.getByText('The end must be after the start.')).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Duplicate: Opening' }))
    expect(screen.getAllByTestId('slot-row')).toHaveLength(2)
    await user.click(screen.getAllByTestId('remove-slot')[1])
    expect(screen.getAllByTestId('slot-row')).toHaveLength(1)
    expect(await screen.findByText('Session "Opening" removed from the draft.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Duplicate: Day 1' }))
    expect(screen.getAllByTestId('day-card')).toHaveLength(2)
    await user.click(screen.getAllByTestId('remove-day')[1])
    const dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getAllByTestId('day-card')).toHaveLength(1))
    expect(spy).not.toHaveBeenCalled()
  })

  it('View: renders the agenda tab (single day: no pills, heading + session with details)', async () => {
    const user = userEvent.setup()
    mount('view')
    const tab = await screen.findByTestId('agenda-tab')
    expect(within(tab).queryAllByTestId('day-pill')).toHaveLength(0)
    expect(within(tab).getByTestId('slot-card')).toHaveTextContent('Opening')
    expect(within(tab).getByTestId('slot-card')).toHaveTextContent('9:00 AM')
    await user.click(within(tab).getByRole('button', { name: 'Details' }))
    expect(within(tab).getByText('Welcome')).toBeVisible()
    expect(screen.getByText('Create the public link in Settings to open the page.')).toBeInTheDocument()
  })

  it('Settings: name/visibility/config in ONE save_node, tab edits through update_edge, both links offered', async () => {
    const user = userEvent.setup()
    const created = { linkId: 'lk', slug: 'abc123xyz0', enabled: true }
    mocks.ensureLink.mockImplementation(async () => { mocks.getLink.mockResolvedValue(created); return created }) // null until "Create link"
    const adapter = mount('settings')
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findByTestId('settings-tabs')
    const own = within(screen.getByTestId('settings-tabs')).getAllByTestId('tab-row')
    expect(own).toHaveLength(1)
    await user.type(within(own[0]).getByLabelText('Label override (English)'), 'Mentors')
    const hostRows = within(screen.getByTestId('settings-host-tabs')).getAllByTestId('tab-row')
    expect(hostRows).toHaveLength(2)
    await user.click(within(hostRows[1]).getByRole('button', { name: 'Move up' }))
    await user.click(screen.getByTestId('show-to-participants'))
    await user.click(screen.getByLabelText('Show day names and dates on the day tabs'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][2]).toMatchObject({ show_to_participants: true, visibility: 'public', name_en: 'Agenda', config: { showDayNames: true } })
    await waitFor(() => expect(mocks.updateTabs).toHaveBeenCalledTimes(1))
    const patches = mocks.updateTabs.mock.calls[0][0]
    expect(patches).toEqual(expect.arrayContaining([{ edgeId: 'eL', patch: { label_en: 'Mentors' } }, { edgeId: 'eH', patch: { order_index: 0 } }, { edgeId: 'eA', patch: { order_index: 1 } }]))
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    await user.click(screen.getByTestId('create-link'))
    await waitFor(() => expect(mocks.ensureLink).toHaveBeenCalled())
    expect(await screen.findByText(/\/agenda\/abc123xyz0/)).toBeInTheDocument()
    expect(screen.getByText(/\/agenda\/my-project/)).toBeInTheDocument()
  })

  it('schedule resolver: one item per day with instants in the project zone', async () => {
    const out = await resolveSchedule({ node: { id: 'A' }, graph: { project: { timezone: 'Africa/Cairo' } } })
    expect(out.timezone).toBe('Africa/Cairo')
    expect(out.items[0]).toMatchObject({ id: D1, kind: 'agenda_day', date: '2026-11-03', start: '09:00', end: '09:45', startsAt: '2026-11-03T07:00:00.000Z', endsAt: '2026-11-03T07:45:00.000Z' })
    expect(out.items[0].slots[0]).toMatchObject({ id: S1, startMinutes: 540, endMinutes: 585 })
  })
})

describe('AgendaTab (public payload contract)', () => {
  it('renders get_public_tab data: day pills, today opened first with the current session marked, hidden presenter, print-ready bullets', () => {
    const today = todayInTz('Africa/Cairo')
    const data = {
      timezone: 'Africa/Cairo',
      config: { showDayNames: true, theme: { accent: '#23a455' } },
      days: [
        { id: 'd0', sort_order: 1, day_date: '2000-01-01', name_en: 'Past', slots: [{ id: 's0', start_time: '09:00:00', end_time: '10:00:00', title_en: 'Old', bullets: [] }] },
        { id: 'd1', sort_order: 2, day_date: today, name_en: 'Today', name_ar: 'اليوم', slots: [{ id: 's1', start_time: '00:00:00', end_time: '23:59:00', title_en: 'All day', presenter_en: null, bullets: [{ en: 'Point', ar: '' }] }] },
      ],
    }
    renderWithProviders(<AgendaTab data={data} title="Agenda" audience="public" />, { route: '/agenda/x?lang=en' })
    const pills = screen.getAllByTestId('day-pill')
    expect(pills).toHaveLength(2)
    expect(pills[1]).toHaveAttribute('aria-selected', 'true')
    expect(pills[1].style.getPropertyValue('--agenda-accent') || screen.getByTestId('agenda-tab').style.getPropertyValue('--agenda-accent')).toBe('#23a455')
    const panel = screen.getAllByTestId('day-panel').find((p) => !p.classList.contains('hidden'))
    expect(panel).toHaveTextContent('All day')
    expect(within(panel).getByTestId('slot-card')).toHaveAttribute('data-state', 'now')
    expect(within(panel).getByText('Now')).toBeInTheDocument()
    expect(within(panel).queryByText('Presenter')).toBeNull()
    expect(within(panel).getByText('Point').closest('ul')).toHaveClass('print:block')
    fireEvent.click(pills[0])
    expect(pills[0]).toHaveAttribute('aria-selected', 'true')
  })
})

describe('AgendaHost (/agenda/:ref/:tab?)', () => {
  const view = () => ({
    viewer: 'public',
    project: { id: 'P', name_en: 'ClimAccelerator', name_ar: 'كليم', cover_path: 'P/cover/x.webp', timezone: 'Africa/Cairo', completed: false },
    host: { id: 'H', type: 'view_host', name_en: 'Project page' },
    tabs: [
      { edge_id: 'eA', node_id: 'A', type: 'agenda', view_key: 'agenda', title_en: 'Agenda', title_ar: 'الأجندة', order: 0 },
      { edge_id: 'eH', node_id: 'L', type: 'list', view_key: 'list-tab', title_en: 'Experts', title_ar: 'الخبراء', order: 1 },
      { edge_id: 'eB', node_id: 'B', type: 'booking', view_key: 'booking-tab', title_en: 'Booking', title_ar: 'الحجز', order: 2 },
    ],
    revisions: [],
  })
  const tabPayload = (ref, edgeId) => {
    if (edgeId === 'eA') return { type: 'agenda', node_id: 'A', revision: 3, data: { timezone: 'Africa/Cairo', config: { header: { brandName: 'GIZ', title: { en: 'Welcome to Cairo', ar: '' }, dim: 0.5 } }, days: defRows().days } }
    if (edgeId === 'eH') return { type: 'list', node_id: 'L', revision: 1, data: { items: [{ item_id: 'i1', source: { kind: 'network_expert', id: 'e1', state: 'ok' }, display: { title_en: 'Ada' } }], next: null, config: { kind: 'expert', card: {} } } }
    return { type: 'booking', node_id: 'B', revision: 1, data: { note: 'no public data for this node type' } }
  }
  function mountHost(route) {
    renderWithProviders(
      <AuthContext.Provider value={{ status: 'anon' }}>
        <Routes>
          <Route path="/agenda/:ref/:tab?" element={<HostRoute />} />
        </Routes>
      </AuthContext.Provider>,
      { route },
    )
  }
  function HostRoute() {
    const { tab } = useParams()
    return <AgendaHost refValue="climaccelerator" tabParam={tab ?? null} basePath="/agenda/climaccelerator" signInPath="/login" />
  }

  it('renders the cover header with the project name and the agenda node header settings, the tab bar and the agenda tab; deep links another tab', async () => {
    const user = userEvent.setup()
    mocks.getAgendaView.mockResolvedValue(view())
    mocks.getPublicTab.mockImplementation(async (ref, edgeId) => tabPayload(ref, edgeId))
    mountHost('/agenda/climaccelerator?lang=en')
    const host = await screen.findByTestId('agenda-host')
    expect(host).toHaveAttribute('data-audience', 'public')
    await waitFor(() => expect(within(screen.getByTestId('agenda-cover')).getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to Cairo'))
    expect(screen.getByText('GIZ')).toBeInTheDocument()
    const tabs = screen.getAllByTestId('host-tab')
    expect(tabs.map((a) => a.textContent)).toEqual(['Agenda', 'Experts', 'Booking'])
    expect(tabs[1]).toHaveAttribute('href', '/agenda/climaccelerator/experts?lang=en')
    expect(await screen.findByTestId('agenda-tab')).toHaveTextContent('Opening')
    expect(document.title).toBe('ClimAccelerator - Athar')
    expect(document.head.querySelector('meta[property="og:image"]').getAttribute('content')).toBe('http://img/P/cover/x.webp')
    await user.click(tabs[1])
    await waitFor(() => expect(screen.getByTestId('tab-panel')).toHaveAttribute('data-view', 'list-tab'))
    expect(await screen.findByTestId('list-tab')).toHaveTextContent('Ada')
    expect(document.title).toBe('Experts - ClimAccelerator - Athar')
    await user.click(screen.getAllByTestId('host-tab')[2])
    expect(await screen.findByText('This section is not available yet.')).toBeInTheDocument()
  })

  it('shows the not-available state (with sign-in) when the DB answers null', async () => {
    mocks.getAgendaView.mockResolvedValue(null)
    mountHost('/agenda/climaccelerator?lang=en')
    expect(await screen.findByText('This page is not available.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })
})

describe('FounderAgendaButtons', () => {
  it('renders one button per exposed agenda with a ref, nothing otherwise', async () => {
    mocks.founderAgendas.mockResolvedValue([{ node_id: 'A', name_en: 'Agenda', name_ar: 'الأجندة', ref: 'climaccelerator', via: 'host' }, { node_id: 'B', name_en: 'Hidden', ref: null, via: null }])
    renderWithProviders(<AuthContext.Provider value={auth}><FounderAgendaButtons projectId="P" /></AuthContext.Provider>, { route: '/alumni/founder/programs/P?lang=en' })
    const box = await screen.findByTestId('founder-agenda-buttons')
    const links = within(box).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/alumni/founder/programs/P/agenda?node=A&lang=en')
    expect(links[0]).toHaveTextContent('Agenda')
  })
})
