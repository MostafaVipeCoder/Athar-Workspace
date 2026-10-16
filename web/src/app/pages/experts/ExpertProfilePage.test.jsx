import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../AuthContext.js'
import { normalizeProfile } from '../../../lib/experts.js'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), archive: vi.fn(), archiveMutate: vi.fn(), remove: vi.fn(), restore: vi.fn() }))
vi.mock('../../../data/people.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { useQuery } = await import('@tanstack/react-query')
  return {
    ...actual,
    useExpertProfile: (id) => useQuery({ queryKey: ['experts', 'profile', id], queryFn: async () => normalizeProfile(await mocks.profile(id)), retry: false }),
    useExpertActions: () => ({
      archive: { mutateAsync: mocks.archive, mutate: mocks.archiveMutate, isPending: false },
      remove: { mutateAsync: mocks.remove, isPending: false },
      restore: { mutateAsync: mocks.restore, isPending: false },
      update: { mutateAsync: vi.fn(), isPending: false },
    }),
  }
})
vi.mock('../../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn(), removeImage: vi.fn() }))

import ExpertProfilePage from './ExpertProfilePage.jsx'

const ID = 'e1'
const engagement = (over = {}) => ({
  item_id: 'i1', node: { id: 'n1', type: 'list', name_en: 'Experts', name_ar: 'الخبراء' }, project: { id: 'j1', name_en: 'ClimAccelerator', name_ar: 'كلايم', completed_at: '2026-09-30' },
  program: { id: 'g1', name_en: 'Finland', name_ar: 'فنلندا', year: 2026 }, withdrawn: false, roles: { mentor: true, provider: false, presenter: false },
  booking_sessions: 0, distribution_sessions: 22, first_session_on: '2026-08-07', last_session_on: '2026-09-27', added_at: '2026-08-01T10:00:00Z', ...over,
})
const payload = (over = {}) => ({
  expert: {
    id: ID, kind: 'expert', name_en: 'Mostafa Elnaby', name_ar: 'مصطفى النبي', title_en: 'CEO', title_ar: 'رئيس تنفيذي', company_en: 'Baramouda', company_ar: null, bio_en: 'Long bio in English', bio_ar: 'نبذة بالعربية',
    photo_path: 'global/expert-photo/m.webp', linkedin_url: 'https://www.linkedin.com/in/m', website_url: null, links: [], email: 'm@example.invalid', phone: '+20 100 000 0001', languages: ['ar', 'en'],
    notes: 'prefers mornings', archived_at: null, deleted_at: null, merged_into: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  },
  tags: [{ id: 't1', name_en: 'Marketing', name_ar: 'التسويق', archived: false }],
  totals: { programs: 2, projects: 3, lists: 3, booking_sessions: 5, distribution_sessions: 22, sessions: 27, first_session_on: '2026-08-07', last_session_on: '2026-09-27', first_listed_at: '2026-08-01T10:00:00Z', withdrawn: 0 },
  participation: [engagement(), engagement({ item_id: 'i2', project: { id: 'j2', name_en: 'Workshop', name_ar: 'ورشة', completed_at: null }, program: { id: 'g1', name_en: 'Finland', name_ar: 'فنلندا', year: 2026 }, roles: { provider: true }, booking_sessions: 5, distribution_sessions: 0, withdrawn: true })],
  hidden: { engagements: 0, projects: 0, programs: 0 }, merged_into: null, absorbed: [],
  can: { edit: true, archive: true, merge: false, delete: false, restore: false },
  ...over,
})
const pm = { user: { id: 'u1' }, roles: ['project_manager'], areas: ['staff'], status: 'authed', hasRole: () => false, can: () => false, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }
const admin = { ...pm, roles: ['super_admin'], can: (p) => p === 'experts:merge' }

function mount(route = `/network/experts/${ID}?lang=en`, auth = pm, state) {
  return renderWithProviders(
    <ConfirmProvider><AuthContext.Provider value={auth}><Routes><Route path="/network/experts/:expertId" element={<ExpertProfilePage />} /></Routes></AuthContext.Provider></ConfirmProvider>,
    { route: state ? { pathname: route.split('?')[0], search: `?${route.split('?')[1]}`, state } : route },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.profile.mockResolvedValue(payload())
  mocks.archive.mockResolvedValue({})
  mocks.remove.mockResolvedValue({})
  mocks.restore.mockResolvedValue({})
})

describe('Expert profile page', () => {
  it('shows the identity, the global totals and the participation history grouped by program with links to the project and the list', async () => {
    mount()
    expect(await screen.findByRole('heading', { level: 1, name: 'Mostafa Elnaby' })).toBeInTheDocument()
    expect(screen.getByText('مصطفى النبي')).toBeInTheDocument()
    expect(screen.getByText('CEO · Baramouda')).toBeInTheDocument()
    const part = screen.getByTestId('expert-participation')
    const kpis = within(part).getAllByRole('definition')
    expect(kpis.map((k) => k.firstChild.textContent)).toEqual(expect.arrayContaining(['2', '3', '27']))
    expect(within(part).getByText('5 booking, 22 mentoring')).toBeInTheDocument()
    expect(within(part).getByText('Aug 7, 2026')).toBeInTheDocument()
    const history = screen.getByTestId('expert-history')
    expect(within(history).getByRole('link', { name: 'Finland' })).toHaveAttribute('href', '/programs/g1')
    const rows = within(history).getAllByTestId('expert-engagement')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('link', { name: 'ClimAccelerator' })).toHaveAttribute('href', '/projects/j1')
    expect(within(rows[0]).getByRole('link', { name: 'Experts' })).toHaveAttribute('href', '/projects/j1/nodes/n1')
    expect(within(rows[0]).getByText('Mentor')).toBeInTheDocument()
    expect(within(rows[0]).getByText('22 mentoring sessions')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Aug 7, 2026 to Sep 27, 2026')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Completed')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Booking provider')).toBeInTheDocument()
    expect(within(rows[1]).getByText('5 booking sessions')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Withdrawn')).toBeInTheDocument() // listed for the PM, flagged, not counted in the totals
  })

  it('contact data and the private notes are shown with the staff-only notice; links are real links', async () => {
    mount()
    const contact = await screen.findByTestId('expert-contact')
    expect(within(contact).getByRole('link', { name: 'm@example.invalid' })).toHaveAttribute('href', 'mailto:m@example.invalid')
    expect(within(contact).getByRole('link', { name: '+20 100 000 0001' })).toHaveAttribute('href', 'tel:+201000000001')
    const li = within(contact).getByRole('link', { name: 'linkedin.com/in/m' })
    expect(li).toHaveAttribute('href', 'https://www.linkedin.com/in/m')
    expect(li).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(contact).getByText(/visible to staff only/)).toBeInTheDocument()
    expect(within(screen.getByTestId('expert-notes')).getByText('prefers mornings')).toBeInTheDocument()
    expect(screen.getByText('Marketing')).toBeInTheDocument()
    expect(screen.getByText('Arabic')).toBeInTheDocument()
    expect(screen.getAllByText('English').length).toBeGreaterThan(0)
  })

  it('a project manager of other programs sees the engagements he may see AND a plain COUNT of the others (no names)', async () => {
    mocks.profile.mockResolvedValue(payload({ participation: [engagement()], hidden: { engagements: 2, projects: 2, programs: 1 } }))
    mount()
    const note = await screen.findByTestId('expert-hidden-note')
    expect(note).toHaveTextContent('2 (projects: 2, programs: 1)')
    expect(within(screen.getByTestId('expert-history')).getAllByTestId('expert-engagement')).toHaveLength(1)
  })

  it('an expert that never took part: an empty history, zero totals', async () => {
    mocks.profile.mockResolvedValue(payload({ totals: { programs: 0, projects: 0, lists: 0, booking_sessions: 0, distribution_sessions: 0, sessions: 0, first_session_on: null, last_session_on: null, first_listed_at: null, withdrawn: 0 }, participation: [] }))
    mount()
    expect(await screen.findByText('Has not taken part in a program yet')).toBeInTheDocument()
    expect(screen.queryByTestId('expert-history')).toBeNull()
  })

  it('actions follow what the server says the caller can do: a PM edits and archives; merge and delete are the super_admin\'s', async () => {
    const { unmount } = mount()
    await screen.findByTestId('expert-edit')
    expect(screen.getByTestId('expert-archive')).toBeInTheDocument()
    expect(screen.queryByTestId('expert-merge')).toBeNull()
    expect(screen.queryByTestId('expert-delete')).toBeNull()
    unmount()
    mocks.profile.mockResolvedValue(payload({ can: { edit: true, archive: true, merge: true, delete: true, restore: false }, absorbed: [{ merge_id: 'm1', drop_id: 'd', drop_name: 'Old Dup', merged_at: '2026-10-10T00:00:00Z' }] }))
    mount(`/network/experts/${ID}?lang=en`, admin)
    expect(await screen.findByTestId('expert-merge')).toBeInTheDocument()
    expect(screen.getByTestId('expert-delete')).toBeInTheDocument()
    expect(within(screen.getByTestId('expert-absorbed')).getByText(/Old Dup was merged into this record/)).toBeInTheDocument()
  })

  it('archive is one click with an UNDO in the toast (reversible: no confirmation)', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByTestId('expert-archive'))
    expect(mocks.archive).toHaveBeenCalledWith({ id: ID, archived: true })
    expect(await screen.findByText('Mostafa Elnaby was archived.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(mocks.archiveMutate).toHaveBeenCalledWith({ id: ID, archived: false })
  })

  it('delete asks for a confirmation (destructive) and a refusal "in use" is explained, not a crash', async () => {
    const user = userEvent.setup()
    mocks.profile.mockResolvedValue(payload({ can: { edit: true, archive: true, merge: true, delete: true, restore: false } }))
    mocks.remove.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', messageKey: 'experts.err.inUse', token: 'expert_in_use' }))
    mount(`/network/experts/${ID}?lang=en`, admin)
    await user.click(await screen.findByTestId('expert-delete'))
    const dialog = await screen.findByRole('dialog', { name: 'Delete Mostafa Elnaby?' })
    expect(within(dialog).getByText(/cannot be deleted: archive or merge it instead/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(mocks.remove).toHaveBeenCalledWith({ id: ID })
    expect(await screen.findByText(/used by a program list/)).toBeInTheDocument()
  })

  it('a record without a photo shows its initials and an "Add a photo" action (the 3 migrated experts without a photo)', async () => {
    mocks.profile.mockResolvedValue(payload({ expert: { ...payload().expert, photo_path: null } }))
    mount()
    expect(await screen.findByTestId('expert-photo-action')).toHaveTextContent('Add a photo')
    expect(screen.getByTestId('expert-profile').querySelector('header img')).toBeNull()
    expect(screen.getByText('ME')).toBeInTheDocument() // the initials
  })

  it('an Athar team member and an archived record carry their badges', async () => {
    mocks.profile.mockResolvedValue(payload({ expert: { ...payload().expert, kind: 'team', archived_at: '2026-10-10T00:00:00Z' } }))
    mount()
    const header = (await screen.findByRole('heading', { level: 1 })).closest('header')
    expect(within(header).getByText('Athar team')).toBeInTheDocument()
    expect(within(header).getByText('Archived')).toBeInTheDocument()
    expect(within(header).getByTestId('expert-archive')).toHaveTextContent('Unarchive')
  })

  it('a MERGED record says where it went and links to the kept one; a deleted record offers Restore to the super_admin', async () => {
    mocks.profile.mockResolvedValue(payload({ expert: { ...payload().expert, deleted_at: '2026-10-10T00:00:00Z', merged_into: 'k1' }, merged_into: { id: 'k1', name_en: 'Canonical One' }, can: { edit: false, archive: false, merge: false, delete: false, restore: false } }))
    const { unmount } = mount(`/network/experts/${ID}?lang=en`, admin)
    const banner = await screen.findByTestId('expert-merged-banner')
    expect(banner).toHaveTextContent('merged into Canonical One')
    expect(within(banner).getByRole('link', { name: 'Open the kept record' })).toHaveAttribute('href', '/network/experts/k1')
    expect(screen.queryByTestId('expert-edit')).toBeNull()
    unmount()
    mocks.profile.mockResolvedValue(payload({ expert: { ...payload().expert, deleted_at: '2026-10-10T00:00:00Z' }, can: { edit: false, archive: false, merge: false, delete: false, restore: true } }))
    const user = userEvent.setup()
    mount(`/network/experts/${ID}?lang=en`, admin)
    await user.click(await screen.findByRole('button', { name: 'Restore' }))
    expect(mocks.restore).toHaveBeenCalledWith({ id: ID })
  })

  it('an unknown id is an explained empty state with a way back, not an error page', async () => {
    mocks.profile.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', code: 'not_found', messageKey: 'experts.err.notFound', retryable: false }))
    mount()
    expect(await screen.findByText('This expert does not exist')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Experts' })).toHaveAttribute('href', '/network/experts')
  })

  it('the back link restores the list state (search, filters, page) the user came from', async () => {
    mount(`/network/experts/${ID}?lang=en`, pm, { back: '?q=schneider&page=2' })
    const back = await screen.findByTestId('expert-back')
    expect(back).toHaveAttribute('href', '/network/experts?q=schneider&page=2')
  })

  it('Arabic: RTL-ready headings, plural-aware counts with Western digits, the Arabic name first', async () => {
    mount(`/network/experts/${ID}?lang=ar`)
    expect(await screen.findByRole('heading', { level: 1, name: 'مصطفى النبي' })).toBeInTheDocument()
    expect(screen.getByText('Mostafa Elnaby')).toBeInTheDocument()
    expect(screen.getAllByText(/^الأخيرة: /).length).toBeGreaterThan(0)
    const history = screen.getByTestId('expert-history')
    expect(within(history).getByText('22 جلسة إرشاد')).toBeInTheDocument()
    expect(within(history).getByText('5 جلسات حجز')).toBeInTheDocument()
    expect(within(history).getByRole('link', { name: 'فنلندا' })).toBeInTheDocument()
  })
})

describe('waits', () => {
  it('does not render the page twice for one expert (key by id): a quick check that waitFor settles', async () => {
    mount()
    await waitFor(() => expect(mocks.profile).toHaveBeenCalledTimes(1))
  })
})

describe('Expert profile page: review fixes', () => {
  it('the long-bio toggle speaks the registry dictionary: no raw key in English or Arabic (this page does not load the entity dictionary)', async () => {
    const user = userEvent.setup()
    const long = 'A long biography sentence. '.repeat(30)
    mocks.profile.mockResolvedValue(payload({ expert: { ...payload().expert, bio_en: long, bio_ar: null } }))
    const { container, unmount } = mount()
    const more = await screen.findByRole('button', { name: 'See more' })
    expect(container.textContent).not.toMatch(/\b(entity|experts)\.[a-z]+\.[a-zA-Z]+/)
    await user.click(more)
    expect(screen.getByRole('button', { name: 'See less' })).toBeInTheDocument()
    unmount()
    mount(`/network/experts/${ID}?lang=ar`)
    expect(await screen.findByRole('button', { name: 'عرض المزيد' })).toBeInTheDocument()
  })

  it('a record with malformed links / unsafe URLs does not crash the page and renders no unsafe link (it used to throw on l.url.replace for every viewer)', async () => {
    const e = { ...payload().expert, website_url: 'javascript:alert(1)', linkedin_url: 'vbscript:x', links: [{ kind: 'x' }, null, { url: 5 }, { url: 'javascript:alert(1)' }, { kind: 'other', url: 'https://ok.example/a' }] }
    mocks.profile.mockResolvedValue(payload({ expert: e }))
    mount()
    const contact = await screen.findByTestId('expert-contact')
    const hrefs = within(contact).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('https://ok.example/a')
    expect(hrefs.some((h) => /^(javascript|vbscript|data):/i.test(h))).toBe(false)
    expect(screen.getByRole('heading', { level: 1, name: 'Mostafa Elnaby' })).toBeInTheDocument()
  })

  it('a bare linkedin.com/in/... (one migrated record has no scheme) becomes a real https link, not a relative one', async () => {
    mocks.profile.mockResolvedValue(payload({ expert: { ...payload().expert, linkedin_url: 'linkedin.com/in/yomna-el-awamri-7414a127' } }))
    mount()
    const contact = await screen.findByTestId('expert-contact')
    expect(within(contact).getByRole('link', { name: 'linkedin.com/in/yomna-el-awamri-7414a127' })).toHaveAttribute('href', 'https://linkedin.com/in/yomna-el-awamri-7414a127')
  })

  it('a failed load keeps the way back, a retry and the page\'s own heading (the tab title); not found has its heading too', async () => {
    mocks.profile.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', messageKey: 'errors.unknown', retryable: true }))
    mocks.profile.mockResolvedValue(payload())
    const user = userEvent.setup()
    const { unmount } = mount()
    expect(await screen.findByRole('heading', { level: 1, name: 'This expert could not be loaded.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Experts' })).toHaveAttribute('href', '/network/experts')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Mostafa Elnaby' })).toBeInTheDocument()
    unmount()
    mocks.profile.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', code: 'not_found', messageKey: 'experts.err.notFound', retryable: false }))
    mount()
    expect(await screen.findByRole('heading', { level: 1, name: 'This expert does not exist' })).toBeInTheDocument()
  })

  it('a legacy HIDDEN list item is flagged on its row, and a row that is not counted says so', async () => {
    mocks.profile.mockResolvedValue(payload({ participation: [
      engagement({ item_id: 'h1', item_hidden: true, counted: true, roles: { provider: true }, booking_sessions: 2, distribution_sessions: 0 }),
      engagement({ item_id: 'h2', project: { id: 'j9', name_en: 'Old workshop', name_ar: 'ورشة قديمة', completed_at: null }, item_hidden: true, counted: false, roles: {} }),
    ] }))
    mount()
    const rows = await screen.findAllByTestId('expert-engagement')
    expect(within(rows[0]).getByText('Hidden from the list (legacy)')).toBeInTheDocument()
    expect(within(rows[0]).queryByText('not counted')).toBeNull()
    expect(within(rows[1]).getByText('Hidden from the list (legacy)')).toBeInTheDocument()
    expect(within(rows[1]).getByText('not counted')).toBeInTheDocument()
  })

  it('the KPI tiles are valid definition lists: every <dl> child is a <div> holding one <dt> and one <dd> (the hint lives inside the dd)', async () => {
    const { container } = mount()
    await screen.findByTestId('expert-participation')
    const dl = container.querySelector('dl')
    expect([...dl.children].every((c) => c.tagName === 'DIV' && [...c.children].every((x) => ['DT', 'DD'].includes(x.tagName)))).toBe(true)
  })
})
