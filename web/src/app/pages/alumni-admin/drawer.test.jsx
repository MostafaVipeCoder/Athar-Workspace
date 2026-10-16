import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../AuthContext.js'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import CompanyDrawer from './CompanyDrawer.jsx'

const auth = { user: { id: 'u-am' }, roles: ['alumni_manager'], status: 'authed', areas: ['network'], hasRole: () => true, can: () => true, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }
const COMPANY = {
  id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل للروبوتات', description_en: 'Farm robots', description_ar: null, logo_path: null, startup_type: 'startup', sector: 'technology', subsector: 'robotics', stage: 'mvp', legal_status: 'llc',
  governorate: 25, location_en: 'Assiut', location_ar: null, established_on: '2021-03-01', founding_year: 2021, website_url: null, app_url: null, linkedin_url: null, links: [],
  operating_status: 'open', closed_on: null, closing_reason: null, after_closing: null, closing_note: null, directory_visibility: 'alumni', directory_blocked: false, is_alumni: true,
  legacy: {}, completeness: { percent: 80, missing: [] }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-10T10:00:00Z', updated_source: 'manager',
  internal: { hint: 'strong team', directory_hidden: false, reviewed_at: null, reviewed_by: null }, created_by: 'u1', origin_project_id: null,
}
const PAYLOAD = {
  company: COMPANY,
  team: [{ founder_id: 'f1', name_en: 'Sara Ali', name_ar: 'سارة علي', role: 'founder', is_primary: true, has_account: true, is_me: false, gender: 'female', age: 31, birth_date: '1995-01-01', source: 'id', governorate: 28, id_masked: '**********1234', email: 'sara@example.com', phone: '+201012345678', education_status: 'graduate' }],
  counts: { team_size: 1, female_founders: 1, founders_under_35: 1 }, ceo_founder_id: 'f1', programs: [],
  snapshots: [{ id: 's1', period_key: '2026-Q2', year: 2026, status: 'frozen', reported: true, confirmed: false, corrected: false, previous_values: null, frozen_at: '2026-07-01T00:00:00Z', frozen_source: 'auto', revenue_total: 910000, funding_raised_total: 400000, employees_total: 11, employees_female: 5, freelancers: 3, team_size: 1, female_founders: 1, traction: '', challenges: null, needs: '', operating_status: 'open' }],
}
const STAMPS = {
  company: { updated_at: '2026-10-10T10:00:00Z', source: 'manager', name: 'Mona Adel' }, founders: [{ founder_id: 'f1', updated_at: '2026-10-03T00:00:00Z', source: 'manager' }],
}
const FIGURES = {
  company_id: 'c1', calendar_period: '2026-Q4', target_period: '2026-Q4', deadline: '2026-12-31', period_end: '2026-12-31T22:00:00Z', status: 'updated', target_status: 'updated',
  draft: { period_key: '2026-Q4', revenue_total: 90000, funding_raised_total: 400000, employees_total: 12, employees_female: 5, freelancers: 3, traction: null, challenges: null, needs: null, updated_at: '2026-10-14T08:00:00Z', updated_source: 'founder', updated_by_name: 'Sara Ali', confirmed: false },
  snapshots: PAYLOAD.snapshots,
}

let mock
function setup(extra = {}) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS, get_alumni_company: PAYLOAD, get_alumni_stamps: STAMPS, get_company_figures: FIGURES,
      save_alumni_company: (a) => ({ saved: true, ...PAYLOAD, company: { ...COMPANY, ...(a.p_patch.name_en ? { name_en: a.p_patch.name_en } : {}), updated_at: '2026-10-14T10:00:00Z' } }),
      ...extra,
    },
  })
  h.db = mock.db
}
const row = { id: 'c1', name_en: 'Nile Robotics', name_ar: 'نيل للروبوتات' }
function renderDrawer(onClose = vi.fn(), lang = 'en') {
  renderWithProviders(<AuthContext.Provider value={auth}><ConfirmProvider><CompanyDrawer row={row} onClose={onClose} /></ConfirmProvider></AuthContext.Provider>, { route: `/alumni/admin/directory?lang=${lang}` })
  return onClose
}
const tab = (name) => screen.getByRole('button', { name })

beforeEach(() => setup())

describe('the company drawer: every field editable without leaving the list', () => {
  it('opens on the overview, who edited the company last is shown, and the four tabs are there (no history tab any more)', async () => {
    renderDrawer()
    expect(await screen.findByTestId('company-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('stamp-line')).toHaveTextContent('Last edited by the Athar team on')
    for (const name of ['Overview', 'Edit', 'Team', 'Quarterly figures']) expect(tab(name)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
    expect(tab('Overview')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /Open the full page/ })).toHaveAttribute('href', '/alumni/admin/company/c1')
  })

  it('Edit: the full profile form; Save sends ONLY what changed with the version it loaded and the drawer stays open', async () => {
    const user = userEvent.setup()
    const onClose = renderDrawer()
    await screen.findByTestId('company-drawer')
    await user.click(tab('Edit'))
    const form = await screen.findByTestId('company-profile-form')
    expect(within(form).getByTestId('embedded-save')).toHaveTextContent('No unsaved changes')
    const english = within(form).getAllByLabelText('English', { selector: 'input' })[0]
    await user.clear(english)
    await user.type(english, 'Nile Robotics Ltd')
    const bar = within(form).getByTestId('embedded-save')
    expect(bar).toHaveTextContent('1 unsaved changes')
    await user.click(within(bar).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.rpcCalls('save_alumni_company')).toHaveLength(1))
    expect(mock.rpcCalls('save_alumni_company')[0].args).toEqual({ p_company: 'c1', p_patch: { name_en: 'Nile Robotics Ltd' }, p_expected: '2026-10-10T10:00:00Z' })
    await waitFor(() => expect(within(screen.getByTestId('embedded-save')).getByRole('status')).toHaveTextContent('No unsaved changes'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closing with unsaved edits asks first: "Stay" keeps the drawer, "Leave" closes it; a clean drawer closes at once', async () => {
    const user = userEvent.setup()
    const onClose = renderDrawer()
    await screen.findByTestId('company-drawer')
    await user.click(tab('Edit'))
    const form = await screen.findByTestId('company-profile-form')
    await user.type(within(form).getAllByLabelText('English', { selector: 'input' })[0], ' X')
    await user.click(screen.getByRole('button', { name: 'Close the details' }))
    const ask = await screen.findByText('Leave without saving?')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(ask.closest('[role="dialog"]')).getByRole('button', { name: 'Stay and keep editing' }))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close the details' }))
    const ask2 = await screen.findByText('Leave without saving?')
    await user.click(within(ask2.closest('[role="dialog"]')).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('Team lists the founders with who edited each; Quarterly figures shows the draft and the closed quarters of THIS company only', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await screen.findByTestId('company-drawer')
    await user.click(tab('Team'))
    const members = await screen.findAllByTestId('admin-team-member')
    expect(members).toHaveLength(1)
    await waitFor(() => expect(within(members[0]).getByTestId('stamp-line')).toHaveTextContent('Athar team'))

    await user.click(tab('Quarterly figures'))
    expect(await screen.findByTestId('figures-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('quarter-grid')).toHaveTextContent('Q2 2026')
    expect(mock.rpcCalls('get_company_figures')[0].args).toEqual({ p_company: 'c1' })
    expect(mock.rpcCalls('list_alumni_history')).toHaveLength(0)
  })

  it('in Arabic: the tabs and the stamp are Arabic', async () => {
    renderDrawer(vi.fn(), 'ar')
    expect(await screen.findByTestId('company-drawer')).toBeInTheDocument()
    expect(tab('تعديل')).toBeInTheDocument()
    expect(tab('الأرقام الربعية')).toBeInTheDocument()
    expect(screen.getByTestId('stamp-line')).toHaveTextContent('آخر تعديل بواسطة فريق أثر')
  })
})
