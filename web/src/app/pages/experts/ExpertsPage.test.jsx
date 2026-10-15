import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../AuthContext.js'
import { normalizeRegistryRow } from '../../../lib/experts.js'

const G1 = '33333333-3333-4333-8333-333333333333'
const T1 = '44444444-4444-4444-8444-444444444444'
const T2 = '55555555-5555-4555-8555-555555555555'
const mocks = vi.hoisted(() => ({ registry: vi.fn(), exportAll: vi.fn(), exportRows: vi.fn(), seen: [] }))
vi.mock('../../../data/people.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { keepPreviousData, useQuery } = await import('@tanstack/react-query')
  return {
    ...actual,
    useExpertRegistry: (state, lang) => useQuery({ queryKey: ['experts', 'registry', lang, state], queryFn: () => { mocks.seen.push(state); return mocks.registry(state, lang) }, placeholderData: keepPreviousData }),
    useExpertTags: () => ({ data: [{ id: T1, name: { en: 'Marketing', ar: 'التسويق' }, archived: false }, { id: T2, name: { en: 'Finance', ar: 'المالية' }, archived: false }] }),
    listRegistryForExport: (...a) => mocks.exportAll(...a),
  }
})
vi.mock('../../../data/programs.js', () => ({ usePrograms: () => ({ data: [{ id: G1, name_en: 'Plan Asyut', name_ar: 'خطة أسيوط' }] }) }))
vi.mock('../../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn(), removeImage: vi.fn() }))
vi.mock('../../../lib/export/xlsx.js', () => ({ exportRows: (...a) => mocks.exportRows(...a), parseWorkbook: vi.fn() }))

import ExpertsPage from './ExpertsPage.jsx'

const ROW = (over = {}) => normalizeRegistryRow({
  id: 'e1', kind: 'expert', name_en: 'Alaa\tAfifi', name_ar: 'علاء عفيفي', title_en: 'CEO', company_en: 'Bekia', photo_path: 'global/expert-photo/a.webp', linkedin_url: 'https://linkedin.com/in/a', has_email: true,
  tags: [{ id: T1, name_en: 'Marketing', name_ar: 'التسويق' }], programs_count: 2, projects_count: 3, lists_count: 3, booking_sessions: 1, distribution_sessions: 4, sessions_count: 5, last_session_on: '2026-09-27', ...over,
})
const page = (rows, total = rows.length, counts = { active: 44, expert: 42, team: 2, archived: 1, deleted: 0, without_photo: 6 }) => ({ total, counts, limit: 24, offset: 0, rows })
const pm = { user: { id: 'u1' }, roles: ['project_manager'], areas: ['staff'], status: 'authed', hasRole: () => false, can: () => false, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }
const admin = { ...pm, roles: ['super_admin'], can: (p) => p === 'experts:merge' }

function mount(route, auth = pm) {
  return renderWithProviders(<ConfirmProvider><AuthContext.Provider value={auth}><ExpertsPage /></AuthContext.Provider></ConfirmProvider>, { route })
}
const lastState = () => mocks.seen[mocks.seen.length - 1]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.seen.length = 0
  mocks.registry.mockResolvedValue(page([ROW(), ROW({ id: 'e2', name_en: 'Osama Nageeb', name_ar: null, title_en: null, company_en: null, photo_path: null, tags: [], programs_count: 0, projects_count: 0, lists_count: 0, sessions_count: 0, last_session_on: null, kind: 'team' })]))
  mocks.exportAll.mockResolvedValue([ROW()])
  mocks.exportRows.mockResolvedValue(1)
})

describe('Experts registry page', () => {
  it('lists the experts with names (whitespace collapsed), role line, tags and the LIVE participation figures; counts in the header', async () => {
    mount('/network/experts?lang=en')
    const table = await screen.findByTestId('experts-table')
    const rows = within(table).getAllByTestId('expert-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('link', { name: 'Alaa Afifi' })).toHaveAttribute('href', '/network/experts/e1')
    expect(within(rows[0]).getByText('علاء عفيفي')).toBeInTheDocument() // the other language, small
    expect(within(rows[0]).getByText('CEO · Bekia')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Marketing')).toBeInTheDocument()
    expect(within(rows[0]).getByText('2 programs')).toBeInTheDocument()
    expect(within(rows[0]).getByText('3 projects')).toBeInTheDocument()
    expect(within(rows[0]).getByText('5 sessions')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Sep 27, 2026')).toBeInTheDocument()
    expect(rows[0].querySelector('img')?.getAttribute('src')).toBe('http://img/t/global/expert-photo/a.webp') // the lazy THUMBNAIL, never the full image
    expect(within(rows[1]).getByText('Has not taken part yet')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Athar team')).toBeInTheDocument()
    expect(within(screen.getByTestId('experts-stats')).getByText('42')).toBeInTheDocument()
    expect(within(screen.getByTestId('experts-stats')).getByText('6')).toBeInTheDocument()
  })

  it('the first request is the default list state; the Arabic UI asks for Arabic-first sorting and has Western digits', async () => {
    mount('/network/experts?lang=ar')
    await screen.findByTestId('experts-table')
    expect(lastState()).toMatchObject({ q: '', kind: '', state: 'active', sort: 'name', dir: 'asc', page: 1, size: 24 })
    expect(mocks.registry).toHaveBeenCalledWith(expect.anything(), 'ar')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('خبراء شبكة أثر')
    expect(within(screen.getByTestId('experts-stats')).getByText('42')).toBeInTheDocument()
  })

  it('searching updates the URL state (debounced) and asks the server; the app\'s own ?lang= is kept', async () => {
    const user = userEvent.setup()
    mount('/network/experts?lang=en')
    await screen.findByTestId('experts-table')
    await user.type(screen.getByRole('searchbox', { name: 'Search experts' }), 'schneider')
    await waitFor(() => expect(lastState()).toMatchObject({ q: 'schneider', page: 1 }))
    expect(screen.getByRole('searchbox', { name: 'Search experts' })).toHaveValue('schneider')
  })

  it('the sort select and the column headers drive the server sort; a header toggles the direction', async () => {
    const user = userEvent.setup()
    mount('/network/experts?lang=en')
    await screen.findByTestId('experts-table')
    await user.selectOptions(screen.getByTestId('experts-sort'), 'sessions')
    await waitFor(() => expect(lastState()).toMatchObject({ sort: 'sessions', dir: 'desc' }))
    await user.click(screen.getAllByRole('button', { name: 'Participation' })[0])
    await waitFor(() => expect(lastState()).toMatchObject({ sort: 'programs', dir: 'desc' }))
    await user.click(screen.getAllByRole('button', { name: 'Participation' })[0])
    await waitFor(() => expect(lastState()).toMatchObject({ sort: 'programs', dir: 'asc' }))
    expect(screen.getAllByRole('columnheader').some((h) => h.getAttribute('aria-sort') === 'ascending')).toBe(true)
  })

  it('filters: kind pills, the photo tile, program / language / tags; the badge counts them; "Clear filters" resets', async () => {
    const user = userEvent.setup()
    mount('/network/experts?lang=en')
    await screen.findByTestId('experts-table')
    await user.click(screen.getByRole('button', { name: /^Athar team/ }))
    await waitFor(() => expect(lastState()).toMatchObject({ kind: 'team', state: 'active' }))
    await user.click(screen.getByTestId('experts-filters-toggle'))
    const panel = await screen.findByTestId('experts-filters')
    await user.selectOptions(within(panel).getByLabelText(/Program joined/), G1)
    await waitFor(() => expect(lastState()).toMatchObject({ program: G1 }))
    await user.selectOptions(within(panel).getByLabelText(/^Language/), 'ar')
    await waitFor(() => expect(lastState()).toMatchObject({ language: 'ar' }))
    await user.click(within(panel).getByRole('button', { name: 'Marketing' }))
    await waitFor(() => expect(lastState()).toMatchObject({ tags: [T1] }))
    await user.selectOptions(within(panel).getByLabelText(/^Photo/), 'no')
    await waitFor(() => expect(lastState()).toMatchObject({ kind: 'team', program: G1, language: 'ar', tags: [T1], photo: 'no' }))
    expect(within(screen.getByTestId('experts-filters-toggle')).getByText('5')).toBeInTheDocument()
    await user.click(screen.getByTestId('experts-clear'))
    await waitFor(() => expect(lastState()).toMatchObject({ kind: '', program: '', language: '', tags: [], photo: '', state: 'active' }))
  })

  it('the Archived pill asks for the archived view; the Deleted pill and the Duplicates link exist for a super_admin only', async () => {
    const user = userEvent.setup()
    mount('/network/experts?lang=en')
    await screen.findByTestId('experts-table')
    expect(screen.queryByRole('button', { name: /^Deleted/ })).toBeNull()
    expect(screen.queryByTestId('experts-duplicates-link')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Archived/ }))
    await waitFor(() => expect(lastState()).toMatchObject({ state: 'archived' }))
  })

  it('a super_admin sees the Deleted view and the link to the duplicate finder', async () => {
    mount('/network/experts?lang=en', admin)
    await screen.findByTestId('experts-table')
    expect(screen.getByRole('button', { name: /^Deleted/ })).toBeInTheDocument()
    expect(screen.getByTestId('experts-duplicates-link')).toHaveAttribute('href', '/network/experts/duplicates')
  })

  it('inside the Alumni manager\'s shell the links follow the shell (/alumni/admin/experts)', async () => {
    mount('/alumni/admin/experts?lang=en', admin)
    const table = await screen.findByTestId('experts-table')
    expect(within(table).getByRole('link', { name: 'Alaa Afifi' })).toHaveAttribute('href', '/alumni/admin/experts/e1')
    expect(screen.getByTestId('experts-duplicates-link')).toHaveAttribute('href', '/alumni/admin/experts/duplicates')
  })

  it('Excel export: asks the server for EVERY row of the current filter (the wide columns) and hands them to the lazy xlsx writer', async () => {
    const user = userEvent.setup()
    mount('/network/experts?lang=en&q=alaa')
    await screen.findByTestId('experts-table')
    await user.click(screen.getByTestId('experts-export'))
    await waitFor(() => expect(mocks.exportRows).toHaveBeenCalledTimes(1))
    expect(mocks.exportAll).toHaveBeenCalledWith(expect.objectContaining({ q: 'alaa' }), 'en')
    const [rows, columns, filename] = mocks.exportRows.mock.calls[0]
    expect(rows).toHaveLength(1)
    expect(columns.length).toBeGreaterThan(15)
    expect(filename).toMatch(/^athar-network-experts-\d{4}-\d{2}-\d{2}$/)
    expect(await screen.findByText('Exported 1 expert.')).toBeInTheDocument()
  })

  it('paging: the range, the page size and next / previous follow the server total', async () => {
    const user = userEvent.setup()
    mocks.registry.mockResolvedValue(page([ROW()], 60))
    mount('/network/experts?lang=en')
    const nav = await screen.findByRole('navigation', { name: 'Pages' })
    expect(within(nav).getByText('1 - 24 of 60')).toBeInTheDocument()
    await user.click(within(nav).getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(lastState()).toMatchObject({ page: 2 }))
    await user.selectOptions(within(await screen.findByRole('navigation', { name: 'Pages' })).getByRole('combobox'), '48')
    await waitFor(() => expect(lastState()).toMatchObject({ size: 48, page: 1 }))
  })

  it('empty registry: a call to add or import; empty filtered result: a way back; failure: an error with Try again', async () => {
    mocks.registry.mockResolvedValue(page([], 0))
    const { unmount } = mount('/network/experts?lang=en')
    expect(await screen.findByText('No experts yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Add expert/ }).length).toBeGreaterThan(0)
    unmount()
    mount('/network/experts?lang=en&q=zzz')
    expect(await screen.findByText('No expert matches')).toBeInTheDocument()
  })

  it('a failing server shows the error state with a retry', async () => {
    const user = userEvent.setup()
    mocks.registry.mockRejectedValueOnce(Object.assign(new Error('x'), { messageKey: 'errors.unknown', retryable: true }))
    mocks.registry.mockResolvedValue(page([ROW()]))
    mount('/network/experts?lang=en')
    expect(await screen.findByText('The experts could not be loaded.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('experts-table')).toBeInTheDocument()
  })

  it('opens the add dialog (a lazy chunk) from the header', async () => {
    const user = userEvent.setup()
    mount('/network/experts?lang=en')
    await screen.findByTestId('experts-table')
    await user.click(screen.getByTestId('experts-add'))
    const dialog = await screen.findByRole('dialog', { name: 'Add an expert' })
    expect(within(dialog).getByText('Job title')).toBeInTheDocument()
  })
})

describe('Experts registry page: review fixes', () => {
  it('the phone card list has ONE shrinkable column track (grid-cols-1) and min-w-0 cards, so a long title can never push the cards past the screen edge', async () => {
    mount('/network/experts?lang=en')
    const cards = await screen.findByTestId('experts-cards')
    expect(cards.className).toMatch(/\bgrid-cols-1\b/)
    for (const li of within(cards).getAllByTestId('expert-card')) expect(li.className).toMatch(/\bmin-w-0\b/)
  })

  it('the results count is a live region that is mounted from the start (a region inserted together with its content is not announced)', async () => {
    mount('/network/experts?lang=en')
    const region = document.querySelector('p.sr-only[role="status"][aria-live="polite"]')
    expect(region).not.toBeNull()
    await screen.findByTestId('experts-table')
    await waitFor(() => expect(region).toHaveTextContent('2 experts found'))
    expect(document.querySelector('p.sr-only[role="status"][aria-live="polite"]')).toBe(region) // the same node: updated, not replaced
  })

  it('leaving the page clears the pending search debounce (it used to append ?q= to the profile URL it navigated to)', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = mount('/network/experts?lang=en')
    const box = await screen.findByLabelText('Search experts')
    fireEvent.change(box, { target: { value: 'ahmed' } })
    clear.mockClear()
    unmount()
    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })

  it('a deleted record is badged Deleted (not Archived); sessions without a recorded date say so instead of "-"', async () => {
    mocks.registry.mockResolvedValue(page([ROW({ id: 'd1', name_en: 'Removed Person', deleted_at: '2026-10-01', archived_at: null, last_session_on: null, sessions_count: 20 })]))
    mount('/network/experts?lang=en&state=deleted', admin)
    const row = (await screen.findAllByTestId('expert-row'))[0]
    expect(within(row).getByText('Deleted')).toBeInTheDocument()
    expect(within(row).queryByText('Archived')).toBeNull()
    expect(within(row).getByText('Date not recorded')).toBeInTheDocument()
  })

  it('the LinkedIn / website icon buttons carry the name in the UI language and only safe links are rendered', async () => {
    mocks.registry.mockResolvedValue(page([ROW({ linkedin_url: 'https://linkedin.com/in/a', website_url: 'javascript:alert(1)' }), ROW({ id: 'e3', name_en: 'Bare Link', name_ar: 'رابط', linkedin_url: 'linkedin.com/in/bare', website_url: null })]))
    mount('/network/experts?lang=ar')
    const links = await screen.findAllByLabelText('لينكدإن: علاء عفيفي')
    expect(links.length).toBeGreaterThan(0)
    expect(screen.queryAllByLabelText(/^الموقع الإلكتروني/)).toHaveLength(0) // the javascript: website is not a link
    const bare = await screen.findAllByLabelText('لينكدإن: رابط')
    expect(bare[0]).toHaveAttribute('href', 'https://linkedin.com/in/bare')
  })

  it('a phone hides the subtitle (the first result is above the fold); the desktop keeps it', async () => {
    mount('/network/experts?lang=en')
    const sub = await screen.findByText(/Everyone who trained, mentored or presented/)
    expect(sub.className).toMatch(/\bhidden\b/)
    expect(sub.className).toMatch(/\bsm:block\b/)
  })
})
