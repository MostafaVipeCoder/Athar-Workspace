import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { makeDb } from '../alumni-admin/testDb.js'
import { COMPANY_ROW, FOUNDER, LOOKUPS } from '../../../shared/alumni/alumni.fixtures.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))
vi.mock('../../../data/founder.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useMyPrograms: () => useQuery({ queryKey: ['myPrograms'], queryFn: async () => [] }) }
})
vi.mock('../../../data/alumniFounder.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useAllMyCertificates: () => useQuery({ queryKey: ['certs'], queryFn: async () => [] }) }
})
vi.mock('../../../data/founderNotifications.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useUnreadNotifications: () => useQuery({ queryKey: ['unread'], queryFn: async () => 0 }) }
})

import FounderAfterClosingPage from './FounderAfterClosingPage.jsx'
import FounderProgressPage from './FounderProgressPage.jsx'
import HomeAlumniCards from './HomeAlumniCards.jsx'

const CLOSED_CO = { ...COMPANY_ROW, id: 'c1', name_en: 'Nile Pay Old', name_ar: 'نايل باي القديمة', operating_status: 'closed', is_alumni: true }
const OPEN_CO = { ...COMPANY_ROW, id: 'c2', name_en: 'Delta Active', name_ar: 'دلتا', operating_status: 'open', is_alumni: true }
const PROFILE = (companies) => ({ founder: FOUNDER, companies })

/** A stateful fake of the two RPCs: the answer saved is the answer read back. */
function setup({ companies = [CLOSED_CO], saveError = null, closed = true, answer = null } = {}) {
  let stored = answer
  const mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      get_my_alumni_profile: PROFILE(companies),
      get_company_after_closing: (a) => ({ company_id: a.p_company, closed, closed_on: '2026-03-01', current_period: '2026-Q4', answered_this_period: Boolean(stored), answer: stored }),
      save_company_after_closing: (a) => {
        if (saveError) return saveError
        const d = a.p_data
        stored = { answer_type: d.answer_type, venture_name: d.venture_name ?? null, field: d.field ?? null, venture_stage: d.venture_stage ?? null, venture_url: d.venture_url ?? null, venture_description: d.venture_description ?? null,
          wants_programs: d.wants_programs === true, employer: d.employer ?? null, job_title: d.job_title ?? null, other_text: d.other_text ?? null, answered_at: '2026-10-15T09:30:00Z', answered_source: 'founder' }
        return { saved: true, company_id: a.p_company, closed: true, answer: stored }
      },
    },
  })
  h.db = mock.db
  return mock
}
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p> }

describe('the "What are you doing now?" page of a closed company', () => {
  let mock
  beforeEach(() => { mock = setup() })

  it('shows the question, the company and the three kinds of answer; nothing is asked before a kind is chosen', async () => {
    renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=en&company=c1' })
    expect(await screen.findByRole('heading', { name: 'What are you doing now?', level: 1 })).toBeInTheDocument()
    expect(await screen.findByTestId('after-closing-form')).toBeInTheDocument()
    expect(screen.getByText('Nile Pay Old', { selector: 'p' })).toBeInTheDocument()
    const group = screen.getByRole('group', { name: /I am now/ })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Working on a new venture', 'Employed', 'Doing something else'])
    expect(screen.queryByTestId('fields-new_startup')).toBeNull()
    expect(screen.getByTestId('not-answered')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save my answer' })).toBeDisabled()
  })

  it('a NEW VENTURE: name, field, stage, link, description and the interest in Athar programs; required ones are checked before the call; the payload holds this kind only', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=en&company=c1' })
    await screen.findByTestId('after-closing-form')
    await user.click(screen.getByRole('button', { name: 'Working on a new venture' }))
    const f = screen.getByTestId('fields-new_startup')
    await user.click(screen.getByRole('button', { name: 'Save my answer' }))
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Please complete the highlighted fields')
    expect(within(f).getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/Name of the new venture: is required/)
    expect(mock.rpcCalls('save_company_after_closing')).toHaveLength(0)
    await user.type(within(f).getByLabelText(/Name of the new venture/), '  Nile Pay 2 ')
    await user.selectOptions(within(f).getByLabelText(/Field \/ sector/), 'technology')
    await user.selectOptions(within(f).getByLabelText('Stage'), 'mvp')
    await user.type(within(f).getByLabelText('Website or link'), 'nilepay2.example')
    await user.type(within(f).getByLabelText('Short description'), 'Payments for farms')
    await user.click(within(f).getByRole('checkbox', { name: 'I am interested in joining Athar programs with this new project' }))
    await user.click(screen.getByRole('button', { name: 'Save my answer' }))
    await waitFor(() => expect(mock.rpcCalls('save_company_after_closing')).toHaveLength(1))
    expect(mock.rpcCalls('save_company_after_closing')[0].args).toEqual({
      p_company: 'c1',
      p_data: { answer_type: 'new_startup', venture_name: 'Nile Pay 2', field: 'technology', venture_stage: 'mvp', venture_url: 'https://nilepay2.example', venture_description: 'Payments for farms', wants_programs: true },
    })
  })

  it('after saving it says when he last answered, the form is idle again and the answer can be changed later (EMPLOYED replaces it: no venture field travels)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=en&company=c1' })
    await screen.findByTestId('after-closing-form')
    await user.click(screen.getByRole('button', { name: 'Employed' }))
    const f = screen.getByTestId('fields-employed')
    await user.type(within(f).getByLabelText(/Employer/), 'ACME Health')
    await user.type(within(f).getByLabelText(/Your role/), 'Data analyst')
    await user.selectOptions(within(f).getByLabelText(/The industry you settled in/), 'technology')
    await user.click(screen.getByRole('button', { name: 'Save my answer' }))
    expect(await screen.findByTestId('last-answered')).toHaveTextContent('Last answered on')
    expect(screen.getByTestId('last-answered')).toHaveTextContent('2026')
    expect(screen.getByRole('button', { name: 'Save my answer' })).toBeDisabled()
    expect(screen.getByLabelText(/Employer/)).toHaveValue('ACME Health')
    expect(screen.getByText('We will ask again every quarter. If nothing changed, you do not need to do anything.')).toBeInTheDocument()
    // later: something else
    await user.click(screen.getByRole('button', { name: 'Doing something else' }))
    expect(screen.getByRole('button', { name: 'Save my answer' })).toBeEnabled()
    await user.type(screen.getByLabelText(/Tell us in a few words/), 'Studying abroad')
    await user.click(screen.getByRole('button', { name: 'Save my answer' }))
    await waitFor(() => expect(mock.rpcCalls('save_company_after_closing')).toHaveLength(2))
    expect(mock.rpcCalls('save_company_after_closing')[0].args.p_data).toEqual({ answer_type: 'employed', employer: 'ACME Health', job_title: 'Data analyst', field: 'technology' })
    expect(mock.rpcCalls('save_company_after_closing')[1].args.p_data).toEqual({ answer_type: 'other', other_text: 'Studying abroad' })
  })

  it('an answer given earlier is shown in the form with its date (this quarter already answered)', async () => {
    mock = setup({ answer: { answer_type: 'new_startup', venture_name: 'Nile Pay 2', field: 'technology', venture_stage: null, venture_url: null, venture_description: null, wants_programs: true, employer: null, job_title: null, other_text: null, answered_at: '2026-10-10T08:00:00Z', answered_source: 'founder' } })
    renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=en&company=c1' })
    expect(await screen.findByTestId('last-answered')).toHaveTextContent('Last answered on')
    expect(screen.getByLabelText(/Name of the new venture/)).toHaveValue('Nile Pay 2')
    expect(screen.getByRole('checkbox', { name: /interested in joining Athar programs/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Working on a new venture' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/you already answered this quarter/)).toBeInTheDocument()
  })

  it('shows what the server refused (an ID-shaped number, a bad link) on the form and keeps what was typed', async () => {
    const user = userEvent.setup()
    mock = setup({ saveError: Object.assign(new Error('alumni_invalid: venture_description:contains_id'), { code: '22023', hint: 'alumni_invalid', details: 'venture_description:contains_id' }) })
    renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=en&company=c1' })
    await screen.findByTestId('after-closing-form')
    await user.click(screen.getByRole('button', { name: 'Working on a new venture' }))
    await user.type(screen.getByLabelText(/Name of the new venture/), 'X')
    await user.selectOptions(screen.getByLabelText(/Field \/ sector/), 'technology')
    await user.type(screen.getByLabelText('Short description'), 'my id')
    await user.click(screen.getByRole('button', { name: 'Save my answer' }))
    expect(await screen.findByTestId('form-error')).toHaveTextContent('must not contain an ID number')
    expect(screen.getByLabelText('Short description')).toHaveValue('my id')
  })

  it('a client-side bad link is refused before the call', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=en&company=c1' })
    await screen.findByTestId('after-closing-form')
    await user.click(screen.getByRole('button', { name: 'Working on a new venture' }))
    await user.type(screen.getByLabelText(/Name of the new venture/), 'X')
    await user.selectOptions(screen.getByLabelText(/Field \/ sector/), 'technology')
    await user.type(screen.getByLabelText('Website or link'), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Save my answer' }))
    expect(await screen.findByText(/Website or link: must be a web address/)).toBeInTheDocument()
    expect(mock.rpcCalls('save_company_after_closing')).toHaveLength(0)
  })

  it('a company that is not closed says so and points to the figures; a founder with no closed company gets an empty state', async () => {
    mock = setup({ companies: [OPEN_CO], closed: false })
    const view = renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=en&company=c2' })
    expect(await screen.findByText('This company is not closed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Progress' })).toHaveAttribute('href', '/alumni/founder/progress?company=c2')
    view.unmount()
    mock = setup({ companies: [OPEN_CO] })
    renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=en' })
    expect(await screen.findByText('No closed company')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Home' })).toBeInTheDocument()
  })

  it('with two closed companies each has its tab and its own answer', async () => {
    const user = userEvent.setup()
    mock = setup({ companies: [CLOSED_CO, { ...CLOSED_CO, id: 'c3', name_en: 'Giza Old', name_ar: 'جيزة' }] })
    renderWithProviders(<><FounderAfterClosingPage /><Where /></>, { route: '/alumni/founder/after-closing?lang=en&company=c1' })
    await screen.findByTestId('after-closing-form')
    await user.click(screen.getByRole('tab', { name: 'Giza Old' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('company=c3'))
    await waitFor(() => expect(mock.rpcCalls('get_company_after_closing').map((c) => c.args.p_company)).toEqual(['c1', 'c3']))
  })

  it('works in Arabic', async () => {
    renderWithProviders(<FounderAfterClosingPage />, { route: '/alumni/founder/after-closing?lang=ar&company=c1' })
    expect(await screen.findByRole('heading', { name: 'ماذا تفعل الآن؟', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'أعمل على مشروع جديد' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'حفظ إجابتي' })).toBeDisabled()
  })
})

describe('the figures page and the Home of a founder with a closed company', () => {
  it('the link of a closed company\'s reminder (the figures address) lands on the question', async () => {
    setup({ companies: [CLOSED_CO, OPEN_CO] })
    renderWithProviders(
      <Routes><Route path="/alumni/founder/progress" element={<FounderProgressPage />} /><Route path="/alumni/founder/after-closing" element={<><p>question page</p><Where /></>} /></Routes>,
      { route: '/alumni/founder/progress?lang=en&company=c1' },
    )
    expect(await screen.findByText('question page')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/alumni/founder/after-closing?company=c1')
  })

  it('the Progress page offers the question instead of figures for a closed company', async () => {
    setup({ companies: [CLOSED_CO] })
    renderWithProviders(<FounderProgressPage />, { route: '/alumni/founder/progress?lang=en' })
    const card = await screen.findByTestId('progress-company-closed')
    expect(card).toHaveTextContent('This company is closed')
    expect(within(card).getByRole('link', { name: 'Answer in a minute' })).toHaveAttribute('href', '/alumni/founder/after-closing?company=c1')
    expect(screen.queryByTestId('progress-company')).toBeNull()
  })

  it('Home: a closed company gets the question tile and is never asked for figures', async () => {
    setup({ companies: [{ ...CLOSED_CO, figures: { status: 'not_updated', period: '2026-Q4', deadline: '2026-12-31' } }] })
    renderWithProviders(<HomeAlumniCards />, { route: '/alumni/founder/dashboard?lang=en' })
    const tile = await screen.findByTestId('home-after-closing')
    expect(tile).toHaveAttribute('href', '/alumni/founder/after-closing?company=c1')
    expect(tile).toHaveTextContent('What are you doing now? (Nile Pay Old)')
    expect(screen.queryByTestId('annual-due')).toBeNull()
  })
})
