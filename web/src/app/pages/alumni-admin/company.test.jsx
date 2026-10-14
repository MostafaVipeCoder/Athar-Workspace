import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../AuthContext.js'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import CompanyPage from './CompanyPage.jsx'
import { CertificateLinks } from './CompanyExtras.jsx'

const FULL_ID = '29501010101234'
const NEW_ID = '30303152804527'
const auth = { user: { id: 'u-am' }, roles: ['alumni_manager'], status: 'authed', areas: ['network'], hasRole: () => true, can: () => true, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }

const company = (over = {}) => ({
  id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل للروبوتات', description_en: 'Farm robots', description_ar: null, logo_path: null, startup_type: 'startup', sector: 'technology', subsector: 'robotics', stage: 'mvp', legal_status: 'llc',
  governorate: 25, location_en: 'Assiut', location_ar: null, established_on: '2021-03-01', founding_year: 2021, website_url: 'https://nile.example.com', app_url: null, linkedin_url: null, links: [],
  operating_status: 'open', closed_on: null, closing_reason: null, after_closing: null, closing_note: null, directory_visibility: 'alumni', directory_blocked: false, is_alumni: true,
  legacy: {}, completeness: { percent: 80, missing: ['annual_update'] }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-10T10:00:00Z',
  internal: { hint: 'strong team', directory_hidden: false, reviewed_at: null, reviewed_by: null }, created_by: 'u1', origin_project_id: null, ...over,
})
const PAYLOAD = {
  company: company(),
  team: [
    { founder_id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة علي', role: 'founder', is_primary: true, has_account: true, is_me: false, gender: 'female', age: 31, age_category: 'age_25_34', birth_date: '1995-01-01', source: 'id', governorate: 28, id_masked: '**********1234', email: 'sara@example.com', phone: '+201012345678', education_status: 'graduate' },
    { founder_id: 'f2', name_en: 'Hana Mostafa', name_ar: 'هنا', role: 'co-founder', is_primary: false, has_account: false, is_me: false, gender: 'female', age: 26, age_category: 'age_25_34', birth_date: '2000-04-04', source: 'self', governorate: null, id_masked: null, email: null, phone: null, education_status: null },
  ],
  counts: { team_size: 2, female_founders: 2, founders_under_35: 2 }, ceo_founder_id: 'f1',
  programs: [{ program_id: 'g1', program_name_en: 'Accelerator', program_name_ar: 'مسرعة', program_type: 'accelerator', project_id: 'j1', project_name_en: 'Cohort 1', project_name_ar: 'الدفعة', completed: false, start_date: null, end_date: null, support: ['training'] }],
  snapshots: [{ id: 's1', year: 2024, revenue_total: 910000, funding_raised_total: 400000, employees_total: 11, employees_female: 5, freelancers: 3, traction: '', challenges: null, needs: '', source: 'founder', updated_at: '2026-10-01T00:00:00Z' }],
}

let mock
function setup(extra = {}) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      get_alumni_company: PAYLOAD,
      save_alumni_company: (a) => ({ saved: true, ...PAYLOAD, company: company({ id: a.p_company ?? 'new-co', ...(a.p_patch.name_en ? { name_en: a.p_patch.name_en } : {}), updated_at: '2026-10-14T10:00:00Z' }) }),
      get_alumni_founder: (a) => ({ id: a.p_founder, identity: { id_masked: '**********1234', has_national_id: true, ...(a.p_reveal ? { national_id: FULL_ID } : {}) } }),
      save_alumni_founder: (a) => ({ saved: true, replaced: [], founder: { id: a.p_founder } }),
      save_company_team_member: { saved: true, founder_id: 'f9' },
      set_company_ceo: { saved: true },
      remove_company_team_member: { saved: true },
      preview_national_id: (a) => (a.p_id === NEW_ID ? { valid: true, birth_date: '2003-03-15', age: 23, age_category: 'age_18_24', gender: 'female', governorate: { code: 28, name_en: 'Aswan', name_ar: 'أسوان', is_abroad: false } } : { valid: false, reason: 'length' }),
      list_alumni_invitations: { total: 1, limit: 100, offset: 0, rows: [{ id: 'i1', company_id: 'c1', company_name_en: 'Nile Robotics', company_name_ar: 'نيل', email: 'old@example.com', status: 'pending', effective_status: 'pending', sent_at: '2026-10-10T10:00:00Z', expires_at: '2026-10-24T10:00:00Z' }] },
      create_alumni_invitation: (a) => ({ id: 'i9', company_id: a.p_company, email: a.p_email, token: 'T', link: `${a.p_app_url}/invite/abc`, language: a.p_language, expires_at: '2026-10-28T10:00:00Z' }),
      list_alumni_directory: { audience: 'manager', total: 1, limit: 8, offset: 0, rows: [{ id: 'c7', name_en: 'Nile Robotics Duplicate', name_ar: null, logo_path: null, sector: 'technology', governorate: 25, is_alumni: false }] },
      merge_companies: { moved: 1 },
      upsert_company_snapshot: { saved: true, snapshot: {}, snapshots: [] },
      delete_company_snapshot: { deleted: true, snapshots: [] },
      ...extra,
    },
  })
  h.db = mock.db
}
function renderAt(path) {
  return renderWithProviders(
    <AuthContext.Provider value={auth}><ConfirmProvider><Routes><Route path="/alumni/admin/company/:id" element={<CompanyPage />} /></Routes></ConfirmProvider></AuthContext.Provider>,
    { route: `${path}?lang=en` },
  )
}

beforeEach(() => setup())

describe('certificates are linked, not rebuilt', () => {
  const programs = [{ program_id: 'g1', project_id: 'j1', project_name_en: 'Cohort 1', project_name_ar: 'الدفعة', support: ['training', 'certification'] }, { program_id: 'g1', project_id: 'j2', project_name_en: 'Cohort 2', support: ['training'] }]
  const renderLinks = (areas) => renderWithProviders(<AuthContext.Provider value={{ ...auth, areas }}><CertificateLinks programs={programs} /></AuthContext.Provider>, { route: '/x?lang=en' })

  it('every manager gets the public verifier; the project of a participation that issues certificates is linked only for staff who can open projects', () => {
    const { unmount } = renderLinks(['network'])
    const box = screen.getByTestId('certificate-links')
    expect(within(box).getByRole('link', { name: 'Verify a certificate' })).toHaveAttribute('href', '/verify')
    expect(within(box).queryByRole('link', { name: /Open the project/ })).toBeNull()
    unmount()
    renderLinks(['network', 'staff'])
    expect(within(screen.getByTestId('certificate-links')).getByRole('link', { name: 'Open the project: Cohort 1' })).toHaveAttribute('href', '/projects/j1')
    expect(screen.queryByRole('link', { name: /Cohort 2/ })).toBeNull() // no certification support
  })
})

describe('the manager company page', () => {
  it('shows the company as a manager sees it: header badges, completeness, the manager panel, the derived team, the programs, the yearly figures', async () => {
    renderAt('/alumni/admin/company/c1')
    expect(await screen.findByRole('heading', { name: 'Nile Robotics', level: 1 })).toBeInTheDocument()
    const header = screen.getByTestId('company-header')
    expect(within(header).getByText('Alumni')).toBeInTheDocument()
    expect(within(header).getByText('Not reviewed')).toBeInTheDocument()
    expect(screen.getByTestId('completeness-meter')).toHaveTextContent('80%')
    expect(screen.getByTestId('manager-fields')).toBeInTheDocument()
    const team = screen.getByTestId('admin-team')
    expect(within(team).getByText('Team size 2 · female 2 · below 35: 2')).toBeInTheDocument()
    const members = within(team).getAllByTestId('admin-team-member')
    expect(within(members[0]).getByText('CEO')).toBeInTheDocument()
    expect(within(members[0]).getAllByText('from the national ID').length).toBeGreaterThan(0)
    expect(await within(members[0]).findByText('Aswan')).toBeInTheDocument()
    expect(within(members[1]).getAllByText('self-declared').length).toBeGreaterThan(0)
    expect(within(members[1]).getByText('no account')).toBeInTheDocument()
    expect(screen.getByTestId('programs-list')).toHaveTextContent('Cohort 1')
    expect(screen.getByTestId('metrics-table')).toHaveTextContent('2024')
    expect(document.body.textContent).not.toContain(FULL_ID)
  })

  it('shows the national ID masked and only an explicit click asks the server for the full number (audited reveal)', async () => {
    const user = userEvent.setup()
    renderAt('/alumni/admin/company/c1')
    const member = (await screen.findAllByTestId('admin-team-member'))[0]
    expect(within(member).getByText('**********1234')).toBeInTheDocument()
    expect(mock.rpcCalls('get_alumni_founder')).toHaveLength(0)
    await user.click(within(member).getByRole('button', { name: 'Show the full national ID' }))
    await waitFor(() => expect(within(member).getByTestId('id-value')).toHaveTextContent(FULL_ID))
    expect(mock.rpcCalls('get_alumni_founder')[0].args).toEqual({ p_founder: 'f1', p_reveal: true })
  })

  it('saves ONLY the changed profile field, with the version the form loaded (the concurrency token)', async () => {
    const user = userEvent.setup()
    renderAt('/alumni/admin/company/c1')
    await screen.findByRole('heading', { name: 'Nile Robotics', level: 1 })
    const english = screen.getAllByLabelText('English', { selector: 'input' })[0]
    await user.clear(english)
    await user.type(english, 'Nile Robotics Ltd')
    const bar = await screen.findByTestId('save-bar')
    expect(bar).toHaveTextContent('1 change')
    await user.click(within(bar).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_company')).toHaveLength(1))
    expect(mock.rpcCalls('save_alumni_company')[0].args).toEqual({ p_company: 'c1', p_patch: { name_en: 'Nile Robotics Ltd' }, p_expected: '2026-10-10T10:00:00Z' })
  })

  it('a stale save (someone else saved first) shows the reload banner and keeps the edit', async () => {
    const user = userEvent.setup()
    setup({ save_alumni_company: Object.assign(new Error('alumni_stale: reload'), { code: 'P0001', hint: 'alumni_stale' }) })
    renderAt('/alumni/admin/company/c1')
    await screen.findByRole('heading', { name: 'Nile Robotics', level: 1 })
    const english = screen.getAllByLabelText('English', { selector: 'input' })[0]
    await user.type(english, ' X')
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    const banner = await screen.findByTestId('stale-banner')
    expect(within(banner).getByRole('button', { name: 'Reload and keep my edits' })).toBeInTheDocument()
    expect(english).toHaveValue('Nile Robotics X')
  })

  it('the manager-owned fields save at once, each as a patch of one key: the alumni mark, the hint, the review stamp, the veto', async () => {
    const user = userEvent.setup()
    renderAt('/alumni/admin/company/c1')
    const panel = await screen.findByTestId('manager-fields')
    await user.click(within(panel).getByRole('checkbox', { name: 'Alumni' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_company')).toHaveLength(1))
    expect(mock.rpcCalls('save_alumni_company')[0].args).toEqual({ p_company: 'c1', p_patch: { is_alumni: false }, p_expected: null })
    const hint = within(panel).getByLabelText(/Hint \(a private note/)
    await user.clear(hint)
    await user.type(hint, 'call in January')
    await user.click(within(panel).getByRole('button', { name: 'Save the note' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_company')).toHaveLength(2))
    expect(mock.rpcCalls('save_alumni_company')[1].args.p_patch).toEqual({ internal: { hint: 'call in January' } })
    await user.click(within(panel).getByRole('button', { name: 'Mark as reviewed' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_company')).toHaveLength(3))
    expect(mock.rpcCalls('save_alumni_company')[2].args.p_patch).toEqual({ internal: { reviewed: true } })
    await user.click(within(panel).getByRole('checkbox', { name: 'Hide from the member directory' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_company')).toHaveLength(4))
    expect(mock.rpcCalls('save_alumni_company')[3].args.p_patch).toEqual({ internal: { directory_hidden: true } })
  })

  it('a manager enters a founder\'s national ID in the ONE ID field (the server previews and derives); the number is sent in the body only and never shown back', async () => {
    const user = userEvent.setup()
    renderAt('/alumni/admin/company/c1')
    const members = await screen.findAllByTestId('admin-team-member')
    await user.click(within(members[1]).getByRole('button', { name: /Edit details and national ID/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('National ID'), NEW_ID)
    expect(await within(dialog).findByText(/Aswan/)).toBeInTheDocument()
    expect(mock.rpcCalls('preview_national_id')[0].args).toEqual({ p_id: NEW_ID })
    await user.click(within(dialog).getByTestId('founder-save'))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_founder')).toHaveLength(1))
    expect(mock.rpcCalls('save_alumni_founder')[0].args).toEqual({ p_founder: 'f2', p_patch: { national_id: NEW_ID } })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.body.textContent).not.toContain(NEW_ID)
  })

  it('team actions: make CEO, remove (asks first), add a record without an account', async () => {
    const user = userEvent.setup()
    renderAt('/alumni/admin/company/c1')
    const members = await screen.findAllByTestId('admin-team-member')
    await user.click(within(members[1]).getByRole('button', { name: /Make CEO/ }))
    await waitFor(() => expect(mock.rpcCalls('set_company_ceo')).toHaveLength(1))
    expect(mock.rpcCalls('set_company_ceo')[0].args).toEqual({ p_company: 'c1', p_founder: 'f2' })
    await user.click(within(members[1]).getByRole('button', { name: /Remove from the company/ }))
    const confirmDialog = await screen.findByRole('dialog')
    expect(within(confirmDialog).getByText('Remove Hana Mostafa from this company?')).toBeInTheDocument()
    await user.click(within(confirmDialog).getByRole('button', { name: 'Remove from the company' }))
    await waitFor(() => expect(mock.rpcCalls('remove_company_team_member')).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Add a team member without an account' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name in English'), 'Karim Nabil')
    await user.click(within(dialog).getByTestId('founder-save'))
    await waitFor(() => expect(mock.rpcCalls('save_company_team_member')).toHaveLength(1))
    expect(mock.rpcCalls('save_company_team_member')[0].args).toEqual({ p_company: 'c1', p_founder: null, p_patch: { name_en: 'Karim Nabil' } })
  })

  it('the yearly figures: a manager can correct and DELETE a year (confirmed), through the shared metrics table', async () => {
    const user = userEvent.setup()
    renderAt('/alumni/admin/company/c1')
    await screen.findByTestId('metrics-table')
    await user.click(screen.getByRole('button', { name: 'Delete 2024' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getAllByRole('button').at(-1))
    await waitFor(() => expect(mock.rpcCalls('delete_company_snapshot')).toHaveLength(1))
    expect(mock.rpcCalls('delete_company_snapshot')[0].args).toEqual({ p_company: 'c1', p_year: 2024 })
  })

  it('invites a founder to THIS company (the link is shown once) and merges a duplicate INTO it after a confirmation', async () => {
    const user = userEvent.setup()
    renderAt('/alumni/admin/company/c1')
    const inv = await screen.findByTestId('company-invitations')
    expect(await within(inv).findByText('old@example.com')).toBeInTheDocument()
    await user.type(within(inv).getByLabelText("Founder's e-mail"), 'new@example.com')
    await user.click(within(inv).getByRole('button', { name: 'Create the invitation' }))
    await waitFor(() => expect(mock.rpcCalls('create_alumni_invitation')).toHaveLength(1))
    expect(mock.rpcCalls('create_alumni_invitation')[0].args).toMatchObject({ p_company: 'c1', p_email: 'new@example.com' })
    expect(await within(inv).findByText('The link is shown once. Copy it now.')).toBeInTheDocument()

    const merge = screen.getByTestId('company-merge')
    await user.type(within(merge).getByRole('combobox'), 'nile')
    await user.click(await screen.findByRole('option', { name: /Nile Robotics Duplicate/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Merge "Nile Robotics Duplicate" into "Nile Robotics"?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(mock.rpcCalls('merge_companies')).toHaveLength(1))
    expect(mock.rpcCalls('merge_companies')[0].args).toEqual({ p_keep: 'c1', p_drop: 'c7' })
  })

  it('creates a company: /company/new has only the profile sections; Save creates it (a null company id)', async () => {
    const user = userEvent.setup()
    renderAt('/alumni/admin/company/new')
    expect(await screen.findByRole('heading', { name: 'New company' })).toBeInTheDocument()
    expect(screen.queryByTestId('manager-fields')).not.toBeInTheDocument()
    const english = screen.getAllByLabelText('English', { selector: 'input' })[0]
    await user.type(english, 'Fresh Startup')
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Create the company' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_company')).toHaveLength(1))
    expect(mock.rpcCalls('save_alumni_company')[0].args).toMatchObject({ p_company: null, p_patch: { name_en: 'Fresh Startup' } })
  })

  it('a company that does not exist says so with a way back', async () => {
    setup({ get_alumni_company: Object.assign(new Error('alumni_not_found'), { code: 'P0002', hint: 'alumni_not_found' }) })
    renderAt('/alumni/admin/company/ghost')
    expect(await screen.findByText('This company does not exist (any more).')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the directory' })).toHaveAttribute('href', '/alumni/admin/directory')
  })
})
