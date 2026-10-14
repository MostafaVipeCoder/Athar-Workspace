import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { renderWithProviders } from '../../../test/render.jsx'
import { _setLoader } from '../../../lib/export/xlsx.js'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import AnalyticsPage from './AnalyticsPage.jsx'

const DATA = {
  year: 2024,
  totals: { companies: 4, open: 3, closed: 1, survival_rate: 75, with_program: 3, reporting_year: 2, founders: 6, female_founders: 2, founders_under_35: 4, employees: 40, female_employees: 15, freelancers: 7, funding_raised: 550000, revenue: 1030000 },
  by_sector: [{ key: 'technology', count: 3 }, { key: 'healthcare', count: 1 }], by_stage: [{ key: 'mvp', count: 2 }, { key: null, count: 2 }], by_startup_type: [{ key: 'startup', count: 4 }], by_legal_status: [{ key: 'llc', count: 4 }],
  by_governorate: [{ key: '25', count: 3 }, { key: '1', count: 1 }], by_ceo_governorate: [{ key: '28', count: 2 }, { key: null, count: 2 }], by_ceo_gender: [{ key: 'female', count: 1 }, { key: 'male', count: 2 }, { key: null, count: 1 }],
  by_ceo_age_category: [{ key: 'age_25_34', count: 3 }], by_program: [{ key: 'g1', program_name_en: 'Accelerator', program_name_ar: 'مسرعة', count: 3 }],
  by_year: [{ year: 2023, companies_reporting: 2, revenue: 600000, funding_raised: 150000, employees: 10, female_employees: 5, freelancers: 1 }, { year: 2024, companies_reporting: 2, revenue: 1030000, funding_raised: 550000, employees: 40, female_employees: 15, freelancers: 7 }],
}
let mock
function setup(analytics = DATA) {
  mock = makeDb({ rpc: { list_alumni_lookups: LOOKUPS, list_alumni_programs: { programs: [{ id: 'g1', name_en: 'Accelerator', name_ar: 'مسرعة', projects: [] }] }, get_alumni_analytics: analytics } })
  h.db = mock.db
}
const renderPage = (mode, route) => renderWithProviders(<AnalyticsPage mode={mode} />, { route: route ?? `/alumni/admin/${mode}?lang=en` })

beforeEach(() => setup())
afterEach(() => _setLoader(() => import('xlsx')))

describe('analytics', () => {
  it('shows the numbers the database returned (survival, closing rate, founders, jobs, revenue, funding) and says how many companies reported', async () => {
    renderPage('analytics')
    const kpis = await screen.findByTestId('analytics-kpis')
    expect(within(screen.getByTestId('ana-companies')).getByText('4')).toBeInTheDocument()
    expect(within(screen.getByTestId('ana-survival')).getByText('75%')).toBeInTheDocument()
    expect(within(screen.getByTestId('ana-closing')).getByText('25%')).toBeInTheDocument() // 1 of 4 closed
    expect(within(screen.getByTestId('ana-jobs')).getByText('40')).toBeInTheDocument()
    expect(within(screen.getByTestId('ana-jobs')).getByText(/15 women \(37.5%\)/)).toBeInTheDocument()
    expect(within(screen.getByTestId('ana-founders')).getByText(/2 female \(33.3%\)/)).toBeInTheDocument()
    expect(within(screen.getByTestId('ana-revenue')).getByText('Revenue 2024')).toBeInTheDocument()
    expect(within(kpis).getAllByText(/EGP/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('coverage')).toHaveTextContent('2 of 4 companies reported figures for 2024. Totals count only what was reported.')
    expect(mock.rpcCalls('get_alumni_analytics')[0].args).toEqual({ p_filters: { scope: 'alumni' }, p_year: null })
  })

  it('breakdowns carry the labels of the vocabulary (the CEO governorate comes from the national ID) and a null key reads "not specified"', async () => {
    renderPage('analytics')
    await screen.findByTestId('analytics-kpis')
    expect(screen.getByRole('list', { name: 'By sector' })).toHaveTextContent('Technology')
    expect(screen.getByRole('list', { name: 'By CEO governorate (from the national ID)' })).toHaveTextContent('Aswan')
    expect(screen.getByRole('list', { name: 'By CEO governorate (from the national ID)' })).toHaveTextContent('Not specified')
    expect(screen.getByRole('list', { name: 'By company location' })).toHaveTextContent('Assiut')
    expect(screen.getByRole('list', { name: 'By program' })).toHaveTextContent('Accelerator')
  })

  it('NEVER invents a number: with no yearly figures the money and jobs cards are empty, not zero, and no percentage is made up', async () => {
    setup({ ...DATA, by_year: [], totals: { ...DATA.totals, reporting_year: 0, employees: 0, funding_raised: 0, revenue: 0, survival_rate: null } })
    renderPage('analytics')
    await screen.findByTestId('analytics-kpis')
    expect(within(screen.getByTestId('ana-jobs')).getByText('—')).toBeInTheDocument()
    expect(within(screen.getByTestId('ana-revenue')).getByText('—')).toBeInTheDocument()
    expect(within(screen.getByTestId('ana-funding')).getByText('—')).toBeInTheDocument()
    expect(within(screen.getByTestId('ana-survival')).getByText('—')).toBeInTheDocument()
    expect(screen.getByTestId('coverage')).toHaveTextContent(/not zero/)
    expect(document.body.textContent).not.toMatch(/\b(94|86|74)\s?%/) // the as-is page invented 94 / 86 / 74
  })

  it('a year nobody reported a figure for is a dash in the yearly chart, never a bar or a real zero', async () => {
    setup({ ...DATA, by_year: [{ year: 2024, companies_reporting: 2, revenue: 1030000, funding_raised: null, employees: 40, female_employees: 15, freelancers: 7 }] })
    renderPage('analytics')
    const funding = await screen.findByRole('list', { name: 'Funding raised (cumulative)' })
    const item = within(funding).getByRole('listitem')
    expect(within(item).getByLabelText('Not reported')).toHaveTextContent('—')
    expect(item).not.toHaveTextContent(/^0/)
    const revenue = screen.getByRole('list', { name: 'Revenue' })
    expect(within(within(revenue).getByRole('listitem')).queryByLabelText('Not reported')).toBeNull()
  })

  it('an empty registry shows an empty state with a way forward', async () => {
    setup({ ...DATA, totals: { ...DATA.totals, companies: 0 } })
    renderPage('analytics')
    expect(await screen.findByText('No alumni company matches')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Show the candidates' })).toHaveAttribute('href', '/alumni/admin/directory?scope=candidates')
  })

  it('analytics filters (incl. the CEO governorate and gender) and the year go to the server and stay in the URL', async () => {
    const user = userEvent.setup()
    renderPage('analytics')
    await screen.findByTestId('analytics-kpis')
    await user.click(screen.getByRole('button', { name: /Filters/ }))
    await user.selectOptions(screen.getByLabelText('Governorate (from national ID)'), '28')
    await user.selectOptions(screen.getByLabelText('CEO gender'), 'female')
    await waitFor(() => expect(mock.rpcCalls('get_alumni_analytics').at(-1).args.p_filters).toEqual({ scope: 'alumni', ceo_governorate: 28, ceo_gender: 'female' }))
    await user.selectOptions(screen.getByLabelText('Figures of the year'), '2023')
    await waitFor(() => expect(mock.rpcCalls('get_alumni_analytics').at(-1).args.p_year).toBe(2023))
  })

  it('Impact is the cumulative view of ALL alumni: no filters, a switch back to Analytics', async () => {
    renderPage('impact')
    await screen.findByTestId('analytics-kpis')
    expect(screen.getByRole('heading', { name: 'Impact' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Filters/ })).not.toBeInTheDocument()
    expect(mock.rpcCalls('get_alumni_analytics')[0].args.p_filters).toEqual({ scope: 'alumni' })
    expect(screen.getByRole('link', { name: 'Analytics (with filters)' })).toHaveAttribute('href', '/alumni/admin/analytics')
    expect(screen.getByRole('link', { name: 'Impact (all alumni)' })).toHaveAttribute('aria-current', 'page')
  })

  it('exports a workbook: a summary, one sheet per breakdown (labels, not keys) and the yearly table', async () => {
    const user = userEvent.setup()
    let captured = null
    const lib = XLSX.default ?? XLSX
    _setLoader(async () => ({ utils: lib.utils, writeFile: (wb, name) => { captured = { wb, name } } }))
    renderPage('analytics')
    await screen.findByTestId('analytics-kpis')
    await user.click(screen.getByRole('button', { name: 'Export to Excel' }))
    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured.wb.SheetNames).toEqual(['Summary', 'Sector', 'Stage', 'Startup type', 'Legal status', 'Company location', 'CEO governorate (national ID)', 'CEO gender', 'CEO age category', 'Program', 'By year'])
    const sector = lib.utils.sheet_to_json(captured.wb.Sheets.Sector)
    expect(sector).toEqual([{ Label: 'Technology', Companies: 3 }, { Label: 'Healthcare', Companies: 1 }])
    const summary = lib.utils.sheet_to_json(captured.wb.Sheets.Summary)
    expect(summary.find((r) => r.Metric === 'Funding raised (EGP)').Value).toBe(550000)
  })

  it('reads the Arabic UI', async () => {
    renderPage('analytics', '/alumni/admin/analytics?lang=ar')
    expect(await screen.findByRole('heading', { name: 'التحليلات' })).toBeInTheDocument()
    expect(await screen.findByText('الشركات الخريجة')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'حسب القطاع' })).toHaveTextContent('التكنولوجيا')
  })
})
