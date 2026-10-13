import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { AuthContext } from '../../AuthContext.js'
import { AppError } from '../../../data/errors.js'
import FounderProgramsPage from './FounderProgramsPage.jsx'
import FounderProgramPage from './FounderProgramPage.jsx'
import FounderHomePage from './FounderHomePage.jsx'
import FounderProgramRedirect from './FounderProgramRedirect.jsx'

const P = '9166121d-5a85-41dd-adda-23dc3276333b'
const mocks = vi.hoisted(() => ({ list: vi.fn(), page: vi.fn(), block: vi.fn() }))

vi.mock('../../../data/founder.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    getFounderBlock: (...a) => mocks.block(...a),
    useMyPrograms: () => useQuery({ queryKey: ['myPrograms'], queryFn: mocks.list }),
    useFounderProgramPage: (id) => useQuery({ queryKey: ['founderProgram', id], queryFn: () => mocks.page(id) }),
    useFounderBlock: (p, type, node) => useQuery({ queryKey: ['founderProgram', p, 'block', type, node], queryFn: () => mocks.block(p, type, node), enabled: Boolean(p && type && node) }),
  }
})

const founder = { user: { id: 'u1', email: 'f@example.invalid' }, profile: { full_name: 'Salma Hassan' }, roles: ['founder'], areas: ['founder'], status: 'authed', hasRole: () => true, can: () => false, signOut: vi.fn(), reloadRoles: vi.fn() }
const withAuth = (ui) => <AuthContext.Provider value={founder}>{ui}</AuthContext.Provider>

const card = (over = {}) => ({
  participant_id: 'pa1', project_id: P, program_id: 'g1', status: 'accepted', restricted: false, project_name_en: 'Cohort A', project_name_ar: 'الدفعة أ', program_name_en: 'Climate Accelerator',
  program_name_ar: 'مسرّعة المناخ', cover_path: 'g1/cover/a.webp', timezone: 'Asia/Riyadh', completed: false, start_date: '2030-03-10', end_date: '2030-03-12', location_en: 'Riyadh Hall', location_ar: 'قاعة الرياض', withdrawal_requested: false, ...over,
})
const header = (over = {}) => ({
  project: { id: P, name_en: 'Cohort A', name_ar: 'الدفعة أ', program: { id: 'g1', name_en: 'Climate Accelerator', name_ar: 'مسرّعة المناخ' }, cover_path: 'g1/cover/a.webp', timezone: 'Asia/Riyadh', completed: false, start_date: '2030-03-10', end_date: '2030-03-12', ...over.project },
  participant: { id: 'pa1', status: 'accepted', withdrawal_requested: false, ...over.participant },
  restricted: false,
  blocks: over.blocks ?? [],
})

const ROUTE = `/alumni/founder/programs/${P}`
const renderPage = (route = `${ROUTE}?lang=en`) =>
  renderWithProviders(withAuth(<Routes><Route path="/alumni/founder/programs/:projectId" element={<FounderProgramPage />} /></Routes>), { route })

const blockIds = () => screen.queryAllByTestId(/^block-(?!skeleton|error)/).map((n) => n.getAttribute('data-testid').replace('block-', ''))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([])
  mocks.page.mockResolvedValue(header())
  mocks.block.mockResolvedValue(null)
})

describe('Founder Programs list', () => {
  it('lists the participant projects: cover thumbnail, bilingual names, status + completed badges, dates, location, a link into the page', async () => {
    mocks.list.mockResolvedValue([
      card(),
      card({ participant_id: 'pa2', project_id: 'p2', status: 'attended', completed: true, project_name_en: 'Cohort B', cover_path: null, start_date: null, end_date: null, location_en: null, location_ar: null }),
    ])
    renderWithProviders(withAuth(<FounderProgramsPage />), { route: '/alumni/founder/programs?lang=en' })
    const list = await screen.findByTestId('founder-programs')
    const cards = within(list).getAllByTestId('program-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Climate Accelerator')).toBeInTheDocument()
    expect(within(cards[0]).getByRole('heading', { name: 'Cohort A' })).toBeInTheDocument()
    expect(within(cards[0]).getByTestId('status-badge')).toHaveTextContent('Accepted')
    expect(within(cards[0]).queryByTestId('completed-badge')).toBeNull()
    expect(within(cards[0]).getByText('Riyadh Hall')).toBeInTheDocument()
    expect(within(cards[0]).getByText(/10 Mar 2030 - 12 Mar 2030/)).toBeInTheDocument()
    expect(cards[0].querySelector('img')?.getAttribute('src')).toMatch(/g1\/cover\/a_t\.webp$/)
    // review: a full-width cover is the blurred 320 px thumbnail first, then the FULL image (both lazy): the thumbnail alone was upscaled about 2x on a phone
    const covers = cards[0].querySelectorAll('img')
    expect(covers).toHaveLength(2)
    expect(covers[1].getAttribute('src')).toMatch(/g1\/cover\/a\.webp$/)
    expect([...covers].every((i) => i.getAttribute('loading') === 'lazy')).toBe(true)
    expect(within(cards[0]).getByRole('link', { name: 'Open Cohort A' })).toHaveAttribute('href', `/alumni/founder/programs/${P}`)
    expect(within(cards[1]).getByTestId('status-badge')).toHaveTextContent('Attended')
    expect(within(cards[1]).getByTestId('completed-badge')).toHaveTextContent('Completed')
    expect(cards[1].querySelector('img')).toBeNull() // no cover: the dark band, never a missing-image glyph
  })

  it('shows an explained empty state when the founder participates in nothing', async () => {
    renderWithProviders(withAuth(<FounderProgramsPage />), { route: '/alumni/founder/programs?lang=en' })
    expect(await screen.findByText('No programs yet')).toBeInTheDocument()
    expect(screen.getByText(/appears here when the program team adds you, or when your application to a program is accepted/)).toBeInTheDocument()
  })

  it('HIDES withdrawn participations from the list; a collapsed section reveals a STATUS-ONLY card (names + status, no link, no cover)', async () => {
    const user = userEvent.setup()
    mocks.list.mockResolvedValue([card(), { participant_id: 'pa9', project_id: 'p9', program_id: 'g1', status: 'withdrawn', restricted: true, project_name_en: 'Old cohort', program_name_en: 'Climate Accelerator' }])
    renderWithProviders(withAuth(<FounderProgramsPage />), { route: '/alumni/founder/programs?lang=en' })
    const list = await screen.findByTestId('founder-programs')
    expect(within(list).getAllByTestId('program-card')).toHaveLength(1)
    expect(screen.queryByText('Old cohort')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Withdrawn program \(1\)/ }))
    const cards = screen.getAllByTestId('program-card')
    const old = cards.find((c) => c.getAttribute('data-status') === 'withdrawn')
    expect(within(old).getByText('Old cohort')).toBeInTheDocument()
    expect(within(old).getByTestId('status-badge')).toHaveTextContent('Withdrawn')
    expect(within(old).getByTestId('withdrawn-note')).toBeInTheDocument()
    expect(within(old).queryByRole('link')).toBeNull()
    expect(old.querySelector('img')).toBeNull()
  })

  it('shows an error state with retry when the list cannot be loaded', async () => {
    mocks.list.mockRejectedValueOnce(new AppError('network'))
    renderWithProviders(withAuth(<FounderProgramsPage />), { route: '/alumni/founder/programs?lang=en' })
    expect(await screen.findByText('Your programs could not be loaded.')).toBeInTheDocument()
    mocks.list.mockResolvedValueOnce([card()])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('founder-programs')).toBeInTheDocument()
  })

  it('renders in Arabic RTL with the Arabic names and status words', async () => {
    mocks.list.mockResolvedValue([card({ completed: true, status: 'attended' })])
    renderWithProviders(withAuth(<FounderProgramsPage />), { route: '/alumni/founder/programs?lang=ar' })
    const c = await screen.findByTestId('program-card')
    expect(within(c).getByRole('heading', { name: 'الدفعة أ' })).toBeInTheDocument()
    expect(within(c).getByTestId('status-badge')).toHaveTextContent('حضر')
    expect(within(c).getByTestId('completed-badge')).toHaveTextContent('مكتمل')
    expect(within(c).getByText('قاعة الرياض')).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
  })
})

describe('Founder Home', () => {
  it('greets by name and shows the active programs with a link to the whole list; withdrawn ones are not shown', async () => {
    mocks.list.mockResolvedValue([card(), { participant_id: 'pa9', project_id: 'p9', status: 'withdrawn', restricted: true, project_name_en: 'Old cohort' }])
    renderWithProviders(withAuth(<FounderHomePage />), { route: '/alumni/founder/dashboard?lang=en' })
    expect(await screen.findByRole('heading', { name: 'Hello, Salma Hassan' })).toBeInTheDocument()
    const list = await screen.findByTestId('home-programs')
    expect(within(list).getAllByTestId('program-card')).toHaveLength(1)
    expect(screen.queryByText('Old cohort')).toBeNull()
    expect(screen.getByRole('link', { name: 'See all programs' })).toHaveAttribute('href', '/alumni/founder/programs')
  })
  it('explains the empty state', async () => {
    renderWithProviders(withAuth(<FounderHomePage />), { route: '/alumni/founder/dashboard?lang=en' })
    expect(await screen.findByText('No programs yet')).toBeInTheDocument()
  })
})

describe('Founder Program page', () => {
  it('renders EXACTLY the blocks the server sent, in the server order, and nothing else', async () => {
    mocks.page.mockResolvedValue(header({
      blocks: [
        { type: 'description', data: { description_en: 'A six-week climate programme.', description_ar: 'برنامج مناخي.' } },
        { type: 'details', data: { location_en: 'Riyadh Hall', location_ar: 'قاعة الرياض', map_url: 'https://maps.example.invalid/hall', offline_days: 2, transportation: 'provided' } },
        { type: 'library', data: { items: [{ node_id: 'lib1', name_en: 'Playbook', ref: 'abc123', via: 'node', count: 4 }] } },
      ],
    }))
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Cohort A' })).toBeInTheDocument()
    await screen.findByTestId('location-block')
    expect(blockIds()).toEqual(['description', 'details', 'library'])
    expect(screen.queryByTestId('block-agenda')).toBeNull()
    expect(screen.queryByTestId('block-certificate')).toBeNull()
    expect(screen.getByText('A six-week climate programme.')).toBeInTheDocument()
    // header: status + dates + the project zone
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Accepted')
    expect(screen.getByText(/10 Mar 2030 - 12 Mar 2030/)).toBeInTheDocument()
    expect(screen.getByText(/Times in/)).toBeInTheDocument()
  })

  it('the location block: map link (new tab, noopener), in-person days (plural) and the transportation chip; a javascript: map link is never rendered', async () => {
    mocks.page.mockResolvedValue(header({ blocks: [{ type: 'details', data: { location_en: 'Riyadh Hall', map_url: 'https://maps.example.invalid/hall', offline_days: 2, transportation: 'self_arranged' } }] }))
    renderPage()
    const block = await screen.findByTestId('location-block')
    const map = within(block).getByRole('link', { name: 'Open the map of Riyadh Hall' })
    expect(map).toHaveAttribute('href', 'https://maps.example.invalid/hall')
    expect(map).toHaveAttribute('target', '_blank')
    expect(map.getAttribute('rel')).toContain('noopener')
    expect(within(block).getByText('2 days in person')).toBeInTheDocument()
    expect(within(block).getByText('Everyone arranges their own transportation')).toBeInTheDocument()
  })
  it('a javascript: map link is dropped', async () => {
    mocks.page.mockResolvedValue(header({ blocks: [{ type: 'details', data: { location_en: 'Hall', map_url: 'javascript:alert(1)' } }] }))
    renderPage()
    const block = await screen.findByTestId('location-block')
    expect(within(block).queryByRole('link')).toBeNull()
  })

  it('the agenda block: the "Program Agenda" button opens only this project\'s agenda, and "next up" comes from the project-zone clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-03-10T06:30:00Z')) // 09:30 in Riyadh: the Opening is running
    try {
      mocks.page.mockResolvedValue(header({ blocks: [{ type: 'agenda', data: { items: [{ node_id: 'ag1', name_en: 'Program Agenda', name_ar: 'أجندة', ref: 'agenda-slug', via: 'node' }] } }] }))
      mocks.block.mockResolvedValue({ type: 'agenda', node_id: 'ag1', viewer: 'participant', data: { timezone: 'Asia/Riyadh', days: [{ id: 'd1', sort_order: 0, day_date: '2030-03-10', slots: [{ id: 's1', start_time: '09:00:00', end_time: '10:00:00', title_en: 'Opening', title_ar: 'الافتتاح', bullets: [] }] }] } })
      renderPage()
      const next = await screen.findByTestId('agenda-next-up')
      expect(next).toHaveAttribute('data-kind', 'now')
      expect(within(next).getByText('Opening')).toBeInTheDocument()
      expect(within(next).getByText('Happening now')).toBeInTheDocument()
      const link = within(screen.getByTestId('agenda-block')).getByRole('link', { name: /Open the agenda of/ })
      expect(link.getAttribute('href')).toBe(`/alumni/founder/programs/${P}/agenda?node=ag1&lang=en`)
      expect(mocks.block).toHaveBeenCalledWith(P, 'agenda', 'ag1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the people blocks: mentors then companies, each from its own lazy payload in compact cards; the section title is the fixed word', async () => {
    mocks.page.mockResolvedValue(header({
      blocks: [
        { type: 'mentors', node_id: 'lm', data: { node_id: 'lm', name_en: 'V Mentors' } },
        { type: 'companies', node_id: 'lc', data: { node_id: 'lc', name_en: 'V Companies' } },
      ],
    }))
    mocks.block.mockImplementation(async (p, type) => ({
      type, node_id: type === 'mentors' ? 'lm' : 'lc', viewer: 'participant',
      data: { items: [{ id: `i-${type}`, kind: type === 'mentors' ? 'expert' : 'company', source: { kind: type }, display: { title_en: type === 'mentors' ? 'Mentor Alpha' : 'Company One' }, title_en: type === 'mentors' ? 'Mentor Alpha' : 'Company One', card: {} }], next: null, config: { kind: type === 'mentors' ? 'expert' : 'company', card: {} } },
    }))
    renderPage()
    await screen.findByTestId('block-mentors')
    expect(blockIds()).toEqual(['mentors', 'companies'])
    expect(within(screen.getByTestId('block-mentors')).getByRole('heading', { level: 2, name: 'Mentors' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByTestId('entity-card').length).toBeGreaterThanOrEqual(2))
    expect(mocks.block).toHaveBeenCalledWith(P, 'mentors', 'lm')
    expect(mocks.block).toHaveBeenCalledWith(P, 'companies', 'lc')
  })

  it('the library and landing blocks reuse the existing buttons with the rows that came with the page (no second request)', async () => {
    mocks.page.mockResolvedValue(header({
      blocks: [
        { type: 'library', data: { items: [{ node_id: 'lib1', name_en: 'Playbook', ref: 'abc123', via: 'node', count: 4 }, { node_id: 'lib2', name_en: 'No link', ref: null }] } },
        { type: 'landing', data: { items: [{ node_id: 'ld1', name_en: 'Share the opportunity', ref: 'xyz789' }] } },
      ],
    }))
    renderPage()
    const lib = await screen.findByTestId('library-block')
    await screen.findByTestId('landing-block')
    expect(within(lib).getByRole('link', { name: /Playbook/ })).toHaveAttribute('href', '/view/abc123/library-tab?lang=en')
    expect(within(lib).getAllByRole('link')).toHaveLength(1)
    expect(within(screen.getByTestId('landing-block')).getByRole('link', { name: /Share the opportunity/ })).toHaveAttribute('href', '/view/xyz789/landing?lang=en')
    expect(mocks.block).not.toHaveBeenCalled()
  })

  it('the schedule block renders My schedule from the lazy distribution payload', async () => {
    mocks.page.mockResolvedValue(header({ blocks: [{ type: 'schedule', data: { items: [{ node_id: 'ds1', name_en: 'Mentoring', name_ar: 'الإرشاد' }] } }] }))
    mocks.block.mockResolvedValue({ type: 'schedule', node_id: 'ds1', viewer: 'participant', data: { node_id: 'ds1', published: true, project: { timezone: 'Asia/Riyadh' }, days: [], mentors: [], companies: [], sessions: [], my_company_ids: [] } })
    renderPage()
    expect(await screen.findByText('The schedule is not ready yet')).toBeInTheDocument()
    expect(mocks.block).toHaveBeenCalledWith(P, 'schedule', 'ds1')
  })

  it('the certificate block shows the certificate rows of the page (no teaser logic on the client: the DB already decided)', async () => {
    mocks.page.mockResolvedValue(header({
      project: { completed: true },
      participant: { status: 'attended' },
      blocks: [{ type: 'certificate', data: { items: [{ certificate_id: 'c1', node_id: 'cn1', code: 'AB12-CD34-EF56', issued_at: '2030-03-20T10:00:00Z', person_name: 'Salma Hassan', company_name: 'Palm Tech', program_name: 'Climate Accelerator' }] } }],
    }))
    renderPage()
    expect(await screen.findByTestId('founder-certificate')).toBeInTheDocument()
    expect(screen.getByText('AB12-CD34-EF56', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('founder-certificate-person')).toHaveTextContent('Salma Hassan') // HIS OWN name...
    expect(screen.getByTestId('founder-certificate-company')).toHaveTextContent('Palm Tech') // ...and the company name
    expect(screen.getByTestId('completed-badge')).toHaveTextContent('Completed')
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Attended')
  })

  it('ignores a block type this client does not know (forward compatible)', async () => {
    mocks.page.mockResolvedValue(header({ blocks: [{ type: 'hologram', data: {} }, { type: 'description', data: { description_en: 'Hello' } }] }))
    renderPage()
    await screen.findByText('Hello')
    expect(blockIds()).toEqual(['description'])
  })

  it('isolates a failing block: its section shows its own error + retry, the other blocks keep working', async () => {
    mocks.page.mockResolvedValue(header({
      blocks: [
        { type: 'description', data: { description_en: 'Still here' } },
        { type: 'mentors', node_id: 'lm', data: { node_id: 'lm', name_en: 'Mentors' } },
        { type: 'details', data: { location_en: 'Hall' } },
      ],
    }))
    mocks.block.mockRejectedValueOnce(new AppError('network'))
    renderPage()
    expect(await screen.findByText('Still here')).toBeInTheDocument()
    const section = screen.getByTestId('block-mentors')
    expect(await within(section).findByTestId('block-error')).toBeInTheDocument()
    expect(await screen.findByTestId('location-block')).toBeInTheDocument()
    expect(screen.queryAllByTestId('block-error')).toHaveLength(1)
    mocks.block.mockResolvedValue({ type: 'mentors', node_id: 'lm', viewer: 'participant', data: { items: [], next: null, config: { kind: 'expert', card: {} } } })
    await userEvent.setup().click(within(section).getByRole('button', { name: 'Try again' }))
    expect(await within(section).findByText('Nothing to show here yet.')).toBeInTheDocument()
  })

  it('shows a section nav from three blocks up; a chip scrolls to its section', async () => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    mocks.page.mockResolvedValue(header({
      blocks: [
        { type: 'description', data: { description_en: 'About' } },
        { type: 'details', data: { location_en: 'Hall' } },
        { type: 'library', data: { items: [{ node_id: 'lib1', name_en: 'Playbook', ref: 'abc' }] } },
      ],
    }))
    renderPage()
    const nav = await screen.findByTestId('section-nav')
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['About', 'Location', 'Library'])
    await userEvent.setup().click(within(nav).getByRole('button', { name: 'Location' }))
    expect(scroll).toHaveBeenCalled()
    expect(within(nav).getByRole('button', { name: 'Location' })).toHaveAttribute('aria-current', 'true')
  })
  it('has no section nav below three blocks', async () => {
    mocks.page.mockResolvedValue(header({ blocks: [{ type: 'description', data: { description_en: 'About' } }] }))
    renderPage()
    await screen.findByText('About', { selector: 'p' })
    expect(screen.queryByTestId('section-nav')).toBeNull()
  })

  it('explains an empty program (nothing enabled by the PM: nothing is shown by default)', async () => {
    renderPage()
    expect(await screen.findByText('Nothing to show yet')).toBeInTheDocument()
    expect(screen.getByText(/has not published anything for this program yet/)).toBeInTheDocument()
    expect(blockIds()).toEqual([])
  })

  it('a WITHDRAWN participant sees the header and a status card only: no cover, no dates, no blocks', async () => {
    mocks.page.mockResolvedValue({
      project: { id: P, name_en: 'Cohort A', name_ar: 'الدفعة أ', program: { id: 'g1', name_en: 'Climate Accelerator' } },
      participant: { id: 'pa1', status: 'withdrawn', withdrawal_requested: false }, restricted: true, blocks: [],
    })
    renderPage()
    expect(await screen.findByText('You have withdrawn from this program')).toBeInTheDocument()
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Withdrawn')
    expect(screen.getByTestId('program-header').querySelector('img')).toBeNull()
    expect(screen.queryByText(/Times in/)).toBeNull()
    expect(blockIds()).toEqual([])
  })

  it('a founder who is NOT a participant (forbidden) gets "not available" and nothing of the project', async () => {
    mocks.page.mockRejectedValue(new AppError('forbidden'))
    renderPage()
    expect(await screen.findByText('This program is not available')).toBeInTheDocument()
    expect(screen.queryByTestId('program-header')).toBeNull()
    expect(screen.getByRole('link', { name: 'My programs' })).toHaveAttribute('href', '/alumni/founder/programs')
  })

  it('shows an error with retry for a network failure (not "not available")', async () => {
    mocks.page.mockRejectedValueOnce(new AppError('network'))
    renderPage()
    expect(await screen.findByText('This program could not be loaded.')).toBeInTheDocument()
    mocks.page.mockResolvedValueOnce(header({ blocks: [{ type: 'description', data: { description_en: 'Back' } }] }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Back')).toBeInTheDocument()
  })

  it('Arabic RTL: Arabic names, block titles and the mirrored back arrow', async () => {
    mocks.page.mockResolvedValue(header({
      blocks: [
        { type: 'description', data: { description_en: 'EN text', description_ar: 'نص البرنامج' } },
        { type: 'details', data: { location_en: 'Hall', location_ar: 'قاعة الرياض', offline_days: 2, transportation: 'provided' } },
        { type: 'library', data: { items: [{ node_id: 'lib1', name_en: 'Playbook', name_ar: 'الدليل', ref: 'abc' }] } },
      ],
    }))
    renderPage(`${ROUTE}?lang=ar`)
    expect(await screen.findByRole('heading', { level: 1, name: 'الدفعة أ' })).toBeInTheDocument()
    expect(await screen.findByText('نص البرنامج')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'عن البرنامج' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'الموقع والتنقّل' })).toBeInTheDocument()
    expect(screen.getByText('يومان حضوريان')).toBeInTheDocument()
    expect(screen.getByText('التنقّل مُوفَّر')).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
  })
})

describe('legacy library route', () => {
  it('/alumni/founder/programs/:id/library lands on the Program page (the library is a block there)', async () => {
    mocks.page.mockResolvedValue(header({ blocks: [{ type: 'description', data: { description_en: 'Landed' } }] }))
    renderWithProviders(withAuth(
      <Routes>
        <Route path="/alumni/founder/programs/:projectId" element={<FounderProgramPage />} />
        <Route path="/alumni/founder/programs/:projectId/library" element={<FounderProgramRedirect />} />
      </Routes>,
    ), { route: `${ROUTE}/library?lang=en` })
    expect(await screen.findByText('Landed')).toBeInTheDocument()
  })
})
