import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null, exportRows: vi.fn() }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))
vi.mock('../../../lib/export/xlsx.js', () => ({ exportRows: (...a) => h.exportRows(...a) }))

import AttentionPage from './AttentionPage.jsx'

const RULES = [
  { key: 'ceo', severity: 'required', section: 'team', selected: true, count: 2 },
  { key: 'ceo_id', severity: 'required', section: 'team', selected: true, count: 3 },
  { key: 'contact', severity: 'required', section: 'team', selected: true, count: 3 },
  { key: 'sector', severity: 'required', section: 'classification', selected: true, count: 1 },
  { key: 'governorate', severity: 'required', section: 'location', selected: true, count: 0 },
  { key: 'latest_figures', severity: 'required', section: 'metrics', selected: true, count: 2 },
  { key: 'description', severity: 'recommended', section: 'basics', selected: true, count: 1 },
  { key: 'logo', severity: 'recommended', section: 'basics', selected: true, count: 3 },
  { key: 'ceo_education', severity: 'recommended', section: 'team', selected: true, count: 3 },
]
const ROWS = [
  { id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل للروبوتات', logo_path: null, is_alumni: false, missing: ['ceo', 'ceo_id', 'contact', 'ceo_education', 'sector', 'latest_figures', 'logo'], required_missing: 5, recommended_missing: 2, completeness_percent: 20,
    last_update: { at: '2026-10-10T10:00:00Z', source: 'manager' }, has_account: false, pending_invitations: 0, ceo: null, programs: [{ program_name_en: 'Accelerator', program_name_ar: 'مسرعة' }] },
  { id: 'c2', name_en: 'Delta Farms', name_ar: null, logo_path: null, is_alumni: true, missing: ['ceo_id', 'logo'], required_missing: 1, recommended_missing: 1, completeness_percent: 78,
    last_update: { at: '2026-10-12T10:00:00Z', source: 'founder' }, has_account: true, pending_invitations: 1, ceo: { founder_id: 'f2', name_en: 'Hana Mostafa', name_ar: 'هنا', email: 'hana@example.com', phone: '+201012345678', has_account: true }, programs: [] },
]
const page = (over = {}) => ({ total: 2, limit: 25, offset: 0, sort: 'missing', as_of: '2026-10-15', rules: RULES, counts: { total: 141, with_issues: 2, complete: 139, by_rule: { ceo: 2, ceo_id: 3, contact: 3, sector: 1, latest_figures: 2, description: 1, logo: 3, ceo_education: 3 } }, rows: ROWS, ...over })

let mock
function setup(over = {}) {
  mock = makeDb({ rpc: { list_alumni_lookups: LOOKUPS, list_alumni_attention: page(), list_alumni_programs: { programs: [{ id: 'g1', name_en: 'Accelerator', name_ar: 'مسرعة', projects: [] }] }, ...over } })
  h.db = mock.db
}
const renderPage = (route = '/alumni/admin/attention?lang=en') => renderWithProviders(<AttentionPage />, { route })
const lastArgs = () => mock.rpcCalls('list_alumni_attention').at(-1).args

beforeEach(() => {
  vi.clearAllMocks()
  try { window.localStorage.clear() } catch { /* storage may be blocked */ }
  setup()
})

describe('the needs-attention queue', () => {
  it('asks the server for the first page of EVERY company with every rule counting, the worst first', async () => {
    renderPage()
    expect(await screen.findAllByTestId('attention-row')).toHaveLength(2)
    expect(lastArgs()).toEqual({ p_filters: { scope: 'all' }, p_rules: null, p_limit: 25, p_offset: 0, p_sort: 'missing' })
    const kpis = screen.getByTestId('attention-kpis')
    expect(kpis).toHaveTextContent('141')
    expect(kpis).toHaveTextContent('2')
    expect(kpis).toHaveTextContent('139')
  })

  it('a row shows the company, the completeness, the CEO and his contact, who edited last, and one chip per missing item (the CEO-dependent ones fold into "no CEO")', async () => {
    renderPage()
    const rows = await screen.findAllByTestId('attention-row')
    const first = rows[0]
    expect(within(first).getByRole('link', { name: 'Nile Robotics' })).toHaveAttribute('href', '/alumni/admin/company/c1')
    expect(within(first).getByText('20% complete')).toBeInTheDocument()
    expect(within(first).getByText('5 required items missing')).toBeInTheDocument()
    expect(within(first).getByTestId('attention-ceo')).toHaveTextContent('No CEO recorded: add the founder or invite him.')
    const chips = within(first).getAllByTestId('attention-chip').map((c) => c.dataset.rule)
    expect(chips).toEqual(['ceo', 'sector', 'latest_figures', 'logo']) // ceo_id / contact / ceo_education are folded into the root cause
    expect(within(first).getByTestId('stamp-line')).toHaveTextContent('Last edited by the Athar team')
    const second = rows[1]
    expect(within(second).getByTestId('attention-ceo')).toHaveTextContent('CEO: Hana Mostafa')
    expect(within(second).getByTestId('attention-ceo')).toHaveTextContent('hana@example.com')
    expect(within(second).getByText('Invitation pending')).toBeInTheDocument()
    expect(within(second).getByTestId('stamp-line')).toHaveTextContent('Last edited by a founder of the company')
  })

  it('every chip and the Fix button jump to the section that fixes the item, with the item in the URL (one click)', async () => {
    renderPage()
    const first = (await screen.findAllByTestId('attention-row'))[0]
    const links = within(first).getAllByTestId('attention-chip')
    expect(links[0]).toHaveAttribute('href', '/alumni/admin/company/c1?focus=ceo#team')
    expect(links[1]).toHaveAttribute('href', '/alumni/admin/company/c1?focus=sector#classification')
    expect(links[2]).toHaveAttribute('href', '/alumni/admin/company/c1?focus=latest_figures#metrics')
    expect(within(first).getByTestId('attention-fix')).toHaveAttribute('href', '/alumni/admin/company/c1?focus=ceo#team') // the first REQUIRED item
    const second = screen.getAllByTestId('attention-row')[1]
    expect(within(second).getByTestId('attention-fix')).toHaveAttribute('href', '/alumni/admin/company/c2?focus=ceo_id#team')
  })

  it('the per-item counts are filters: a click lists only the companies missing it (and again to clear)', async () => {
    const user = userEvent.setup()
    renderPage()
    const box = await screen.findByTestId('attention-by-rule')
    await user.click(within(box).getByRole('button', { name: /Sector missing/ }))
    await waitFor(() => expect(lastArgs().p_filters).toEqual({ scope: 'all', missing: 'sector' }))
    expect(within(screen.getByTestId('attention-by-rule')).getByRole('button', { name: /Sector missing/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Show every company again' }))
    // the unfiltered list is already cached (no new request): the filter is off and the button is gone
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show every company again' })).not.toBeInTheDocument())
    expect(within(screen.getByTestId('attention-by-rule')).getByRole('button', { name: /Sector missing/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('the scope, importance, founder account and invitation filters reach the server', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('attention-row')
    await user.click(screen.getByRole('button', { name: 'Alumni' }))
    await waitFor(() => expect(lastArgs().p_filters.scope).toBe('alumni'))
    await user.click(screen.getByRole('button', { name: /Filters/ }))
    await user.selectOptions(screen.getByLabelText('Importance'), 'required')
    await waitFor(() => expect(lastArgs().p_filters.severity).toBe('required'))
    await user.selectOptions(screen.getByLabelText('Founder account'), 'no')
    await waitFor(() => expect(lastArgs().p_filters.has_account).toBe(false))
    await user.selectOptions(screen.getByLabelText('Invitation'), 'yes')
    await waitFor(() => expect(lastArgs().p_filters.invited).toBe(true))
    await user.selectOptions(screen.getByLabelText('Order'), 'completeness')
    await waitFor(() => expect(lastArgs().p_sort).toBe('completeness'))
  })

  it('the manager chooses which items count: remembered in this browser, sent as the rules, reset with one click', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('attention-row')
    await user.click(screen.getByTestId('rules-open'))
    const dialog = await screen.findByTestId('rules-dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /^No logo/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /^CEO student/ }))
    await user.click(screen.getByTestId('rules-apply'))
    await waitFor(() => expect(lastArgs().p_rules).toEqual(['ceo', 'ceo_id', 'contact', 'sector', 'governorate', 'latest_figures', 'description']))
    expect(JSON.parse(window.localStorage.getItem('athar.alumniAdmin.attentionRules.v1'))).toHaveLength(7)
    await user.click(screen.getByTestId('rules-open'))
    await screen.findByTestId('rules-dialog')
    await user.click(screen.getByRole('button', { name: 'Back to every item' }))
    await waitFor(() => expect(window.localStorage.getItem('athar.alumniAdmin.attentionRules.v1')).toBeNull()) // the all-items query is cached: no new request
    await waitFor(() => expect(screen.queryByTestId('rules-dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('athar.alumniAdmin.attentionRules.v1')).toBeNull()
  })

  it('at least one item must stay on (the server refuses an empty list)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('attention-row')
    await user.click(screen.getByTestId('rules-open'))
    const dialog = await screen.findByTestId('rules-dialog')
    for (const box of within(dialog).getAllByRole('checkbox')) await user.click(box)
    expect(within(dialog).getByText('Keep at least one item.')).toBeInTheDocument()
    expect(screen.getByTestId('rules-apply')).toBeDisabled()
  })

  it('exports the WHOLE filtered list (up to 5000 rows in one call) to Excel with the contact of the CEO and a link back, never a national ID', async () => {
    const user = userEvent.setup()
    h.exportRows.mockResolvedValue(2)
    renderPage('/alumni/admin/attention?lang=en&scope=candidates')
    await screen.findAllByTestId('attention-row')
    await user.click(screen.getByTestId('attention-export'))
    await waitFor(() => expect(h.exportRows).toHaveBeenCalledTimes(1))
    expect(lastArgs()).toEqual({ p_filters: { scope: 'candidates' }, p_rules: null, p_limit: 5000, p_offset: 0, p_sort: 'missing' })
    const [rows, cols, name, opts] = h.exportRows.mock.calls[0]
    expect(cols.map((c) => c.header)).toEqual(['Company', 'Alumni', 'Completeness %', 'Required missing', 'Recommended missing', 'What is missing', 'CEO', 'CEO e-mail', 'CEO phone', 'Founder account', 'Invitation pending', 'Last edited', 'Link'])
    expect(rows[0]).toMatchObject({ company: 'Nile Robotics', completeness: 20, ceo: '', account: 'No', link: expect.stringContaining('/alumni/admin/company/c1') })
    expect(rows[0].missing).toContain('No CEO or team recorded; CEO national ID missing')
    expect(rows[1]).toMatchObject({ ceo: 'Hana Mostafa', email: 'hana@example.com', phone: '+201012345678', account: 'Yes', invitation: 'Yes' })
    expect(JSON.stringify(rows)).not.toMatch(/\d{14}/)
    expect(name).toMatch(/^needs-attention-\d{4}-\d{2}-\d{2}$/)
    expect(opts).toMatchObject({ blanks: true })
  })

  it('an empty result says so (with a way to clear the filters); a failure shows Try again', async () => {
    const user = userEvent.setup()
    setup({ list_alumni_attention: page({ total: 0, rows: [], counts: { total: 0, with_issues: 0, complete: 0, by_rule: {} } }) })
    const { unmount } = renderPage('/alumni/admin/attention?lang=en&q=zzz')
    expect(await screen.findByText('Nothing to show with these filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    unmount()
    setup({ list_alumni_attention: Object.assign(new Error('boom'), { code: '500' }) })
    renderPage()
    expect(await screen.findByText('The list could not be loaded.')).toBeInTheDocument()
    setup()
    await user.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findAllByTestId('attention-row')).toHaveLength(2)
  })

  it('works in Arabic (title, the chips, the completeness) and shows no raw key', async () => {
    renderPage('/alumni/admin/attention?lang=ar')
    expect(await screen.findByRole('heading', { name: 'تحتاج إلى متابعة', level: 1 })).toBeInTheDocument()
    const first = (await screen.findAllByTestId('attention-row'))[0]
    expect(within(first).getByText('مكتملة بنسبة 20%')).toBeInTheDocument()
    expect(within(first).getByText('لا يوجد رئيس تنفيذي أو فريق مسجّل')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/alumni\.admin\.att\./)
  })

  it('the registry views are tabs: directory, needs attention, quarter status, performance', async () => {
    renderPage()
    const tabs = await screen.findByTestId('area-tabs')
    expect(within(tabs).getByRole('link', { name: 'Directory' })).toHaveAttribute('href', '/alumni/admin/directory')
    expect(within(tabs).getByRole('link', { name: 'Needs attention' })).toHaveAttribute('href', '/alumni/admin/attention')
    expect(within(tabs).getByRole('link', { name: 'Quarter status' })).toHaveAttribute('href', '/alumni/admin/quarters')
    expect(within(tabs).getByRole('link', { name: 'Performance' })).toHaveAttribute('href', '/alumni/admin/performance')
    expect(within(tabs).queryByRole('link', { name: 'History' })).not.toBeInTheDocument()
  })
})
