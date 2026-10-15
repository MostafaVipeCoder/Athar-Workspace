import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '../../../test/render.jsx'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import DashboardPage from './DashboardPage.jsx'

const OVERVIEW = {
  as_of: '2026-10-14', latest_year: 2024,
  companies: { total: 141, alumni: 12, candidates: 129, open: 10, closed: 2 },
  review: { current: 5, changed_since: 2, never: 5 },
  completeness: { average: 64, incomplete: 9, complete: 3, missing_by: [{ key: 'annual_update', count: 7 }, { key: 'description', count: 2 }] },
  founders: { total: 30, with_account: 12, alumni_founders: 14, with_national_id: 8, self_declared: 2, no_identity: 20 },
  invitations: { total: 6, pending: 2, accepted: 3, expired: 1, revoked: 0 },
  notifications: { broadcasts_30d: 3, recipients_30d: 40, read_30d: 30 },
}
const ANALYTICS = { year: 2024, totals: { companies: 12, open: 10, closed: 2, survival_rate: 83.3, with_program: 11, reporting_year: 8, founders: 20, female_founders: 6, founders_under_35: 12, employees: 90, female_employees: 40, freelancers: 5, funding_raised: 1, revenue: 2 },
  by_sector: [{ key: 'technology', count: 7 }, { key: 'healthcare', count: 5 }], by_program: [{ key: 'g1', program_name_en: 'Accelerator', program_name_ar: 'مسرعة', count: 11 }], by_year: [] }

function setup(over = {}) {
  h.db = makeDb({ rpc: {
    list_alumni_lookups: LOOKUPS, get_alumni_overview: OVERVIEW, get_alumni_analytics: ANALYTICS,
    list_alumni_quarter_status: { period: { key: '2026-Q4', deadline: '2026-12-31', is_current: true, timezone: 'Africa/Cairo' }, counts: { total: 12, confirmed: 5, updated: 3, not_updated: 4, closed: 0 }, total: 12, rows: [] },
    list_alumni_invitations: { total: 1, limit: 5, offset: 0, rows: [{ id: 'i1', company_id: 'c1', company_name_en: 'Nile Robotics', company_name_ar: 'نيل', email: 'sara@example.com', status: 'pending', effective_status: 'pending', sent_at: '2026-10-12T00:00:00Z', expires_at: '2026-10-26T00:00:00Z' }] },
    list_alumni_broadcasts: { total: 1, limit: 5, offset: 0, rows: [{ broadcast_id: 'b1', sent_at: '2026-10-13T10:00:00Z', audience_type: 'all', title_en: 'Welcome', title_ar: 'مرحباً', body_en: 'x', body_ar: 'y', recipients: 10, reads: 7 }] },
    ...over,
  } }).db
}
const renderPage = (route = '/alumni/admin/dashboard?lang=en') => renderWithProviders(<DashboardPage />, { route })

beforeEach(() => setup())

describe('the manager dashboard', () => {
  it('shows real figures from the database: alumni, operating, programs, founders, completeness, review, invitations, notifications', async () => {
    renderPage()
    expect(await screen.findByTestId('kpi-alumni')).toHaveTextContent('12')
    expect(screen.getByTestId('kpi-alumni')).toHaveTextContent('of 141 companies in the registry')
    expect(screen.getByTestId('kpi-alumni')).toHaveTextContent('129 not marked yet')
    expect(await screen.findByTestId('kpi-operating')).toHaveTextContent('10 open · 2 closed')
    expect(screen.getByTestId('kpi-operating')).toHaveTextContent('83.3% still operating')
    expect(screen.getByTestId('kpi-programs')).toHaveTextContent('1')
    expect(screen.getByTestId('kpi-founders')).toHaveTextContent('12 of 30')
    expect(screen.getByTestId('kpi-founders')).toHaveTextContent('8 with a national ID')
    expect(screen.getByTestId('kpi-completeness')).toHaveTextContent('64%')
    expect(screen.getByTestId('kpi-completeness')).toHaveTextContent('9 incomplete profiles')
    expect(screen.getByTestId('kpi-review')).toHaveTextContent('5 reviewed')
    expect(screen.getByTestId('kpi-report')).toHaveTextContent('8 / 12')
    expect(screen.getByTestId('kpi-invitations')).toHaveTextContent('2 pending')
    expect(screen.getByTestId('kpi-invitations')).toHaveTextContent('50% response') // 3 accepted of 6 answered + waiting
    expect(screen.getByTestId('kpi-notifications')).toHaveTextContent('75% read')
  })

  it('the to-do list links to the list that fixes each item, and leaves out the empty ones', async () => {
    renderPage()
    const todo = await screen.findByTestId('dash-attention')
    expect(within(todo).getByRole('link', { name: /Incomplete profiles/ })).toHaveAttribute('href', '/alumni/admin/directory?incomplete=true')
    expect(within(todo).getByRole('link', { name: /Never reviewed/ })).toHaveAttribute('href', '/alumni/admin/directory?reviewed=false')
    expect(within(todo).getByRole('link', { name: /No figures update/ })).toHaveTextContent('7')
    expect(within(todo).getByRole('link', { name: /No figures update/ })).toHaveAttribute('href', '/alumni/admin/quarters?status=not_updated')
    expect(within(todo).getByRole('link', { name: /Companies not marked as alumni yet/ })).toHaveAttribute('href', '/alumni/admin/directory?scope=candidates')
  })

  it('the quarter status is a card of its own: confirmed or closed of all, with a link to the page', async () => {
    renderPage()
    const k = await screen.findByTestId('kpi-quarter')
    expect(k).toHaveTextContent('Confirmed or closed, Q4 2026')
    expect(k).toHaveTextContent('5 / 12')
    expect(k).toHaveTextContent('3 updated but not confirmed, 4 not updated')
    expect(k.closest('a')).toHaveAttribute('href', '/alumni/admin/quarters')
  })

  it('recent invitations and notifications, and the charts, come from the data (no invented values)', async () => {
    renderPage()
    expect(await screen.findByText('sara@example.com')).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText(/7 of 10 read/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Alumni by sector' })).toHaveTextContent('Technology')
    expect(screen.getByRole('list', { name: 'Alumni by program' })).toHaveTextContent('Accelerator')
    expect(document.body.textContent).not.toMatch(/\b(94|86|74)\s?%/)
  })

  it('an empty registry says so and points at the candidates instead of showing made-up zeros as progress', async () => {
    setup({ get_alumni_overview: { ...OVERVIEW, companies: { total: 141, alumni: 0, candidates: 141, open: 0, closed: 0 }, completeness: { average: null, incomplete: 0, complete: 0, missing_by: [] }, review: { current: 0, changed_since: 0, never: 0 }, latest_year: null } })
    renderPage()
    expect(await screen.findByText('No company is marked as an alumni yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review the candidates' })).toHaveAttribute('href', '/alumni/admin/directory?scope=candidates')
    expect(screen.getByTestId('kpi-completeness')).toHaveTextContent('—')
  })

  it('one failing card does not take the page down (its error says Try again, the rest stays)', async () => {
    setup({ list_alumni_invitations: new Error('boom') })
    renderPage()
    expect(await screen.findByTestId('kpi-alumni')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
  })

  it('reads the Arabic UI', async () => {
    renderPage('/alumni/admin/dashboard?lang=ar')
    expect(await screen.findByRole('heading', { name: 'لوحة الخريجين' })).toBeInTheDocument()
    expect(await screen.findByText('الشركات الخريجة')).toBeInTheDocument()
  })
})
