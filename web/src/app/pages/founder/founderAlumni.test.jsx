import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../AuthContext.js'
import { AppError } from '../../../data/errors.js'
import { cairoToday } from '../../../lib/nationalId.js'
import { COMPANY, COMPANY_PAYLOAD, COMPANY_ROW, FIGURES, FOUNDER, IDENTITY_ID, LOOKUPS, MY_PROFILE, PREVIEW_OK } from '../../../shared/alumni/alumni.fixtures.js'

const mocks = vi.hoisted(() => ({
  me: vi.fn(), company: vi.fn(), saveFounder: vi.fn(), saveMember: vi.fn(), saveCompany: vi.fn(), saveFigures: vi.fn(), figures: vi.fn(), preview: vi.fn(), createInvitation: vi.fn(),
  notifications: vi.fn(), unread: vi.fn(), setRead: vi.fn(), markAll: vi.fn(), opportunities: vi.fn(), applications: vi.fn(), apply: vi.fn(), programs: vi.fn(), certificates: vi.fn(),
}))

vi.mock('../../../data/alumni.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    alumniKeys: { root: () => ['alumni'], lookups: () => ['alumni', 'lookups'], me: () => ['alumni', 'me'], myCompany: (id) => ['alumni', 'company', id], stamps: (id) => ['alumni', 'stamps', id] },
    useAlumniStamps: () => ({ data: null }),
    useAlumniLookups: () => useQuery({ queryKey: ['alumni', 'lookups'], queryFn: async () => (await import('../../../shared/alumni/alumni.fixtures.js')).LOOKUPS, staleTime: Infinity }),
    useMyAlumniProfile: (o = {}) => useQuery({ queryKey: ['alumni', 'me'], queryFn: mocks.me, ...o }),
    useMyCompanyProfile: (id) => useQuery({ queryKey: ['alumni', 'company', id], queryFn: () => mocks.company(id), enabled: Boolean(id) }),
    useAlumniInvitations: () => ({ data: { rows: [] } }),
    getMyAlumniProfile: (...a) => mocks.me(...a),
    getMyCompanyProfile: (...a) => mocks.company(...a),
    saveMyFounderProfileStrict: (...a) => mocks.saveFounder(...a),
    saveCompanyTeamMember: (...a) => mocks.saveMember(...a),
    saveMyCompanyProfile: (...a) => mocks.saveCompany(...a),
    removeCompanyTeamMember: vi.fn(),
    setCompanyCeo: vi.fn(),
    previewNationalId: (...a) => mocks.preview(...a),
    createAlumniInvitation: (...a) => mocks.createInvitation(...a),
    revokeAlumniInvitation: vi.fn(),
  }
})
vi.mock('../../../data/alumniQuarters.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  const wrap = (fn) => ({ mutateAsync: (v) => fn(v), isPending: false })
  return {
    NO_DRAFT: '-infinity',
    getCompanyFigures: (...a) => mocks.figures(...a),
    useCompanyFigures: (id) => useQuery({ queryKey: ['alumni', 'quarters', 'figures', id], queryFn: () => mocks.figures(id), enabled: Boolean(id) }),
    useQuarterMutations: () => ({ saveFigures: wrap(mocks.saveFigures), confirmFigures: wrap(vi.fn()), closeQuarter: wrap(vi.fn()), reopenQuarter: wrap(vi.fn()), correctSnapshot: wrap(vi.fn()), refreezeQuarter: wrap(vi.fn()) }),
  }
})
vi.mock('../../../data/alumniFounder.js', async () => {
  const { useQuery, useMutation } = await import('@tanstack/react-query')
  return {
    FOUNDER_BUCKET: 'founder-assets',
    uploadFounderPhoto: vi.fn(),
    uploadCompanyLogo: vi.fn(),
    useFounderPhotoUrl: () => ({ data: null }),
    useOpportunities: () => useQuery({ queryKey: ['opps'], queryFn: mocks.opportunities }),
    useMyApplications: () => useQuery({ queryKey: ['apps'], queryFn: mocks.applications }),
    useApplyMutation: () => useMutation({ mutationFn: (v) => mocks.apply(v) }),
    useAllMyCertificates: () => useQuery({ queryKey: ['certs'], queryFn: mocks.certificates }),
  }
})
vi.mock('../../../data/founderNotifications.js', async () => {
  const { useQuery, useMutation } = await import('@tanstack/react-query')
  return {
    useUnreadNotifications: () => useQuery({ queryKey: ['unread'], queryFn: mocks.unread }),
    useMyNotifications: (p) => useQuery({ queryKey: ['notifications', p], queryFn: () => mocks.notifications(p) }),
    useNotificationMutations: () => ({
      setRead: useMutation({ mutationFn: (v) => mocks.setRead(v) }),
      markAll: useMutation({ mutationFn: () => mocks.markAll() }),
    }),
  }
})
vi.mock('../../../data/founder.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useMyPrograms: () => useQuery({ queryKey: ['myPrograms'], queryFn: mocks.programs }) }
})
vi.mock('../../../data/storage.js', () => ({ publicImageUrl: (p) => `https://files.test/${p}`, publicThumbUrl: (p) => `https://files.test/${p}`, removeObjects: vi.fn() }))

const { default: FounderProfilePage } = await import('./FounderProfilePage.jsx')
const { default: FounderCompanyPage } = await import('./FounderCompanyPage.jsx')
const { default: FounderCompanyNewPage } = await import('./FounderCompanyNewPage.jsx')
const { default: FounderNotificationsPage } = await import('./FounderNotificationsPage.jsx')
const { default: FounderOpportunitiesPage } = await import('./FounderOpportunitiesPage.jsx')
const { default: FounderProgressPage } = await import('./FounderProgressPage.jsx')
const { default: HomeAlumniCards } = await import('./HomeAlumniCards.jsx')
const { default: FounderShell } = await import('../../shells/FounderShell.jsx')

const auth = { user: { id: 'u1', email: 'sara@example.com' }, profile: { full_name: 'Sara Ali' }, roles: ['founder'], areas: ['founder'], status: 'authed', hasRole: () => true, can: () => false, signOut: vi.fn(), reloadRoles: vi.fn() }
function renderPage(ui, { route = '/alumni/founder/profile?lang=en', path = '/alumni/founder/profile' } = {}) {
  return renderWithProviders(
    <AuthContext.Provider value={auth}>
      <ConfirmProvider>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route },
  )
}
function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}</p>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.me.mockResolvedValue(MY_PROFILE)
  mocks.company.mockResolvedValue(COMPANY_PAYLOAD)
  mocks.figures.mockResolvedValue(FIGURES)
  mocks.preview.mockResolvedValue(PREVIEW_OK)
  mocks.notifications.mockResolvedValue({ rows: [], hasMore: false })
  mocks.unread.mockResolvedValue(0)
  mocks.opportunities.mockResolvedValue([])
  mocks.applications.mockResolvedValue([])
  mocks.programs.mockResolvedValue([])
  mocks.certificates.mockResolvedValue([])
  mocks.setRead.mockResolvedValue()
  mocks.markAll.mockResolvedValue()
})

// ============================================================================ profile
describe('Founder profile page', () => {
  const profileWith = (over = {}, companies = MY_PROFILE.companies) => ({ founder: { ...FOUNDER, ...over }, companies })

  it('shows the account, the completeness, the self-declared fallback (no ID yet) and the companies with the role', async () => {
    renderPage(<FounderProfilePage />)
    expect(await screen.findByRole('heading', { name: 'My profile' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Email')).toHaveValue('sara@example.com')
    expect(screen.getByRole('progressbar', { name: 'My profile' })).toHaveAttribute('aria-valuenow', '75')
    expect(screen.getByTestId('national-id-self')).toBeInTheDocument()
    const company = screen.getByTestId('profile-company')
    expect(within(company).getByText('Nile Labs')).toBeInTheDocument()
    expect(within(company).getByLabelText('Your role in Nile Labs')).toHaveValue('founder')
    expect(within(company).getByRole('link', { name: 'Open the company' })).toHaveAttribute('href', '/alumni/founder/company/c1')
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument() // nothing to save yet
  })

  it('a founder with no company is invited to create one (self-registered)', async () => {
    mocks.me.mockResolvedValue(profileWith({}, []))
    renderPage(<FounderProfilePage />)
    expect(await screen.findByText('You have no company yet')).toBeInTheDocument()
    expect(screen.getByTestId('create-company-cta')).toHaveAttribute('href', '/alumni/founder/company/new')
  })

  it('editing marks the form dirty; Save sends ONLY the changed keys and rebases; Undo goes back', async () => {
    const user = userEvent.setup()
    mocks.saveFounder.mockResolvedValue({ saved: true, replaced: [], founder: FOUNDER })
    renderPage(<FounderProfilePage />)
    const name = (await screen.findAllByLabelText('English'))[0]
    await user.clear(name)
    await user.type(name, 'Sara A. Ali')
    expect(await screen.findByTestId('save-bar')).toHaveTextContent('1 change not saved yet')
    await user.click(screen.getByRole('button', { name: 'Undo changes' }))
    expect(name).toHaveValue('Sara Ali')
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
    await user.clear(name)
    await user.type(name, 'Sara A. Ali')
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.saveFounder).toHaveBeenCalledTimes(1))
    expect(mocks.saveFounder).toHaveBeenCalledWith({ name_en: 'Sara A. Ali' }, FOUNDER.updated_at) // + the version of the profile the form loaded (m60)
  })

  it('the role in a company is saved through the team member RPC (role only), in the same Save', async () => {
    const user = userEvent.setup()
    mocks.saveMember.mockResolvedValue({})
    renderPage(<FounderProfilePage />)
    const role = await screen.findByLabelText('Your role in Nile Labs')
    await user.clear(role)
    await user.type(role, 'CEO and founder')
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.saveMember).toHaveBeenCalledWith('c1', 'f1', { role: 'CEO and founder' }))
    expect(mocks.saveFounder).not.toHaveBeenCalled()
  })

  it('a typed national ID: instant reason, nothing sent while it is wrong; a valid one is sent in the patch with no self-declared values', async () => {
    const user = userEvent.setup()
    mocks.saveFounder.mockResolvedValue({ saved: true, replaced: [{ field: 'birth_date', typed: '1990-05-05', from_id: '1995-01-01' }], founder: FOUNDER })
    renderPage(<FounderProfilePage />)
    const id = await screen.findByRole('textbox', { name: 'National ID' })
    await user.type(id, '49501010101234')
    expect(await screen.findByText('The first digit of the national ID must be 2 or 3.')).toBeInTheDocument()
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    expect(mocks.saveFounder).not.toHaveBeenCalled()
    await user.clear(id)
    await user.type(id, '29501010101234')
    expect(await screen.findByTestId('national-id-derived')).toHaveTextContent('January 1, 1995')
    await user.click(within(screen.getByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.saveFounder).toHaveBeenCalledWith({ national_id: '29501010101234' }, FOUNDER.updated_at))
  })

  it('a number that belongs to somebody else is a conflict message, and the form keeps the edits', async () => {
    const user = userEvent.setup()
    const conflict = Object.assign(new AppError('conflict', { messageKey: 'alumni.err.nidConflict', retryable: false }), { token: 'national_id_conflict' })
    mocks.saveFounder.mockRejectedValue(conflict)
    renderPage(<FounderProfilePage />)
    await user.type(await screen.findByRole('textbox', { name: 'National ID' }), '29501010101234')
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This number is already registered. Contact the Athar team to sort it out.', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByTestId('save-bar')).toBeInTheDocument()
  })

  it('a refusal from the server names the field it is about', async () => {
    const user = userEvent.setup()
    mocks.saveFounder.mockRejectedValue(Object.assign(new AppError('validation', { messageKey: 'alumni.err.invalid', detail: 'linkedin_url:bad_url' }), { cause: { hint: 'alumni_invalid', message: 'alumni_invalid: linkedin_url:bad_url', details: 'linkedin_url:bad_url' } }))
    renderPage(<FounderProfilePage />)
    await user.type(await screen.findByLabelText('Your LinkedIn profile'), 'https://ok.example.com/in/x')
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('must be a web address starting with http:// or https://')).toBeInTheDocument()
  })

  it('with a saved ID the number is masked and the typed fallback is gone', async () => {
    mocks.me.mockResolvedValue(profileWith({ identity: IDENTITY_ID, completeness: { percent: 100, missing: [] } }))
    renderPage(<FounderProfilePage />)
    expect(await screen.findByTestId('national-id-saved')).toHaveTextContent('**********1234')
    expect(screen.queryByTestId('national-id-self')).not.toBeInTheDocument()
    expect(screen.getByTestId('national-id-derived')).toBeInTheDocument()
  })

  it('welcome banners: an invited founder is told the company is linked', async () => {
    renderPage(<FounderProfilePage />, { route: { pathname: '/alumni/founder/profile', search: '?lang=en', state: { invited: true } } })
    expect(await screen.findByText('Your account is ready and your company is linked')).toBeInTheDocument()
  })

  it('Arabic: RTL labels', async () => {
    renderPage(<FounderProfilePage />, { route: '/alumni/founder/profile?lang=ar' })
    expect(await screen.findByRole('heading', { name: 'ملفي الشخصي' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'الرقم القومي' })).toBeInTheDocument()
  })

  it('load error with retry', async () => {
    mocks.me.mockRejectedValueOnce(new AppError('network'))
    renderPage(<FounderProfilePage />)
    expect(await screen.findByText('Your profile could not be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

// ============================================================================ company
describe('Founder company page', () => {
  const ROUTE = '/alumni/founder/company/c1?lang=en'
  const PATH = '/alumni/founder/company/:id'

  it('the company card, the completeness, the team, the quarterly figures with the banner and the DERIVED programs', async () => {
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    expect(await screen.findByTestId('company-name')).toHaveTextContent('Nile Labs')
    const card = screen.getByTestId('company-card')
    expect(await within(card).findByText('Technology')).toBeInTheDocument() // the vocabulary loads after the page
    expect(within(card).getByText('MVP')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Website' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('progressbar', { name: 'Company profile' })).toHaveAttribute('aria-valuenow', '90')
    expect(screen.getAllByTestId('team-member')).toHaveLength(3)
    expect(await screen.findByTestId('figures-panel')).toBeInTheDocument()
    expect((await screen.findAllByTestId('grid-quarter')).map((y) => y.textContent)).toEqual(['Q2 2026', 'Q1 2026'])
    expect(screen.getAllByTestId('figures-banner')).toHaveLength(2) // the company page top + the figures panel: both say "update or confirm"
    expect(await screen.findByTestId('program-entry')).toHaveTextContent('Finland')
    // no manager-only value is ever rendered
    expect(document.body.textContent).not.toMatch(/Hint|reviewed|directory_hidden/)
  })

  it('a company of somebody else: "not available" (the RPC says forbidden), no data', async () => {
    mocks.company.mockRejectedValue(new AppError('forbidden', { retryable: false }))
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    expect(await screen.findByText('This company is not available')).toBeInTheDocument()
    expect(screen.queryByTestId('company-card')).not.toBeInTheDocument()
  })

  it('Save sends only the changed keys with the version the form loaded (optimistic concurrency)', async () => {
    const user = userEvent.setup()
    mocks.saveCompany.mockResolvedValue({ saved: true, ...COMPANY_PAYLOAD, company: { ...COMPANY, stage: 'idea_stage', updated_at: '2026-10-14T09:00:00Z' } })
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    await screen.findByTestId('company-name')
    await user.selectOptions(await screen.findByLabelText('Stage'), 'idea_stage')
    expect(await screen.findByTestId('save-bar')).toHaveTextContent('1 change not saved yet')
    await user.click(within(screen.getByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.saveCompany).toHaveBeenCalledWith('c1', { stage: 'idea_stage' }, COMPANY.updated_at))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
  })

  it('invalid values are caught before anything is sent (URL, date in the future)', async () => {
    const user = userEvent.setup()
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    await screen.findByTestId('company-name')
    const site = await screen.findByLabelText('Website')
    await user.clear(site)
    await user.type(site, 'javascript:alert(1)')
    expect(await screen.findByText('must be a web address starting with http:// or https://')).toBeInTheDocument()
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    expect(mocks.saveCompany).not.toHaveBeenCalled()
  })

  it('somebody else saved first (alumni_stale): the page says so and "reload" puts MY edits back on top of the fresh values', async () => {
    const user = userEvent.setup()
    const stale = Object.assign(new AppError('validation', { messageKey: 'alumni.err.stale' }), { cause: { hint: 'alumni_stale', message: 'alumni_stale: reload' } })
    mocks.saveCompany.mockRejectedValue(stale)
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    await screen.findByTestId('company-name')
    await user.selectOptions(await screen.findByLabelText('Stage'), 'idea_stage')
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    expect(await screen.findByTestId('stale-banner')).toHaveTextContent('Someone else changed this company')
    // the other founder changed the address meanwhile
    mocks.company.mockResolvedValue({ ...COMPANY_PAYLOAD, company: { ...COMPANY, location_en: 'Cairo office', updated_at: '2026-10-14T09:30:00Z' } })
    await user.click(within(screen.getByTestId('stale-banner')).getByRole('button', { name: 'Reload and keep my changes' }))
    await waitFor(() => expect(screen.queryByTestId('stale-banner')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Stage')).toHaveValue('idea_stage') // mine
    expect(screen.getAllByLabelText('English').some((el) => el.value === 'Cairo office')).toBe(true) // theirs
    mocks.saveCompany.mockResolvedValue({ saved: true, ...COMPANY_PAYLOAD })
    await user.click(within(screen.getByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.saveCompany).toHaveBeenLastCalledWith('c1', { stage: 'idea_stage' }, '2026-10-14T09:30:00Z'))
  })

  it('a refusal about a field is shown under that field', async () => {
    const user = userEvent.setup()
    mocks.saveCompany.mockRejectedValue(Object.assign(new AppError('validation', { messageKey: 'alumni.err.invalid', detail: 'app_url:bad_url' }), { cause: { hint: 'alumni_invalid', message: 'alumni_invalid: app_url:bad_url', details: 'app_url:bad_url' } }))
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    await screen.findByTestId('company-name')
    await user.type(await screen.findByLabelText('App link'), 'https://app.example.com')
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    expect(await screen.findAllByText('must be a web address starting with http:// or https://')).not.toHaveLength(0)
  })

  it('re-opening a closed company clears the closing fields in the patch', async () => {
    const user = userEvent.setup()
    mocks.company.mockResolvedValue({ ...COMPANY_PAYLOAD, company: { ...COMPANY, operating_status: 'closed', closed_on: '2025-01-01', closing_reason: 'funding', after_closing: 'employed', closing_note: 'note' } })
    mocks.saveCompany.mockResolvedValue({ saved: true, ...COMPANY_PAYLOAD })
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    await screen.findByTestId('company-name')
    expect(await screen.findByTestId('closing-fields')).toBeInTheDocument()
    await user.click(within(screen.getByTestId('section-status')).getByRole('button', { name: 'Open' }))
    expect(screen.queryByTestId('closing-fields')).not.toBeInTheDocument()
    await user.click(within(await screen.findByTestId('save-bar')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.saveCompany).toHaveBeenCalledWith('c1', { operating_status: 'open', closed_on: null, closing_reason: null, after_closing: null, closing_note: null }, expect.any(String)))
  })

  it('the figures of the quarter are saved through their own call with only the changed keys and the version of the draft; the invitation of a co-founder shows the link once', async () => {
    const user = userEvent.setup()
    mocks.saveFigures.mockResolvedValue({ saved: true, changed: true, draft: { ...FIGURES.draft, challenges: 'Hiring', updated_at: '2026-10-15T09:00:00Z' } })
    mocks.createInvitation.mockResolvedValue({ id: 'i1', email: 'karim@example.com', link: 'http://app.test/invite/tok', expires_at: '2026-10-28T00:00:00Z' })
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    await screen.findByTestId('company-name')
    const form = await screen.findByTestId('figures-form')
    await user.type(within(form).getByLabelText('Challenges'), 'Hiring')
    await user.click(within(form).getByTestId('figures-save'))
    await waitFor(() => expect(mocks.saveFigures).toHaveBeenCalledWith({ companyId: 'c1', data: { challenges: 'Hiring' }, expected: FIGURES.draft.updated_at })) // + the version of the draft the form loaded

    await user.type(screen.getByLabelText("Co-founder's e-mail"), 'karim@example.com')
    await user.click(screen.getByRole('button', { name: 'Create invitation link' }))
    expect(await screen.findByTestId('invite-link')).toHaveTextContent('http://app.test/invite/tok')
    expect(mocks.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'c1', email: 'karim@example.com', language: 'en' }))
  })

  it('an invalid e-mail never reaches the server', async () => {
    const user = userEvent.setup()
    renderPage(<FounderCompanyPage />, { route: ROUTE, path: PATH })
    await screen.findByTestId('company-name')
    await user.type(screen.getByLabelText("Co-founder's e-mail"), 'nope')
    await user.click(screen.getByRole('button', { name: 'Create invitation link' }))
    expect(await screen.findByText('Enter a valid e-mail address.')).toBeInTheDocument()
    expect(mocks.createInvitation).not.toHaveBeenCalled()
  })
})

describe('Create your company', () => {
  it('needs a name, is created with the essentials only, then lands on the company page', async () => {
    const user = userEvent.setup()
    mocks.saveCompany.mockResolvedValue({ saved: true, ...COMPANY_PAYLOAD, company: { ...COMPANY, id: 'new-1' } })
    renderPage(<FounderCompanyNewPage />, { route: '/alumni/founder/company/new?lang=en', path: '/alumni/founder/company/new' })
    expect(await screen.findByRole('heading', { name: 'Create your company' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create company' }))
    expect(mocks.saveCompany).not.toHaveBeenCalled() // the name is required
    expect(await screen.findAllByText('is required')).not.toHaveLength(0)
    await user.type((await screen.findAllByLabelText('English'))[0], 'Nile Labs')
    await user.selectOptions(screen.getByLabelText('Sector'), 'technology')
    await user.click(screen.getByRole('button', { name: 'Create company' }))
    await waitFor(() => expect(mocks.saveCompany).toHaveBeenCalledWith(null, { name_en: 'Nile Labs', sector: 'technology' }, null))
    expect(await screen.findByTestId('where')).toHaveTextContent('/alumni/founder/company/new-1')
  })

  it('a name that already exists is refused without saying who owns it', async () => {
    const user = userEvent.setup()
    mocks.saveCompany.mockRejectedValue(Object.assign(new AppError('conflict', { messageKey: 'alumni.err.companyExists' }), { cause: { hint: 'alumni_company_exists', message: 'alumni_company_exists: x' } }))
    renderPage(<FounderCompanyNewPage />, { route: '/alumni/founder/company/new?lang=en', path: '/alumni/founder/company/new' })
    await user.type((await screen.findAllByLabelText('English'))[0], 'Nile Labs')
    await user.click(screen.getByRole('button', { name: 'Create company' }))
    expect(await screen.findAllByText(/A company with this name is already registered/)).not.toHaveLength(0)
    expect(screen.queryByTestId('where')).not.toBeInTheDocument()
  })
})

// ============================================================================ notifications
describe('Founder notifications page', () => {
  const rows = [
    { id: 'n1', title: 'New grant', body: 'A grant is open.', is_read: false, created_at: '2026-10-14T10:00:00Z', metadata: { opportunity_id: '9166121d-5a85-41dd-adda-23dc3276333b' } },
    { id: 'n2', title: 'Recording', body: 'Online now.', is_read: true, created_at: '2026-10-12T10:00:00Z', metadata: { url: 'https://example.com/rec' } },
    { id: 'n3', title: 'Plain', body: 'x'.repeat(300), is_read: false, created_at: '2026-10-11T10:00:00Z', metadata: {} },
  ]
  const open = () => renderPage(<FounderNotificationsPage />, { route: '/alumni/founder/notifications?lang=en', path: '/alumni/founder/notifications' })

  it('newest first, unread marked, the linked item opens (internal link or a safe external one)', async () => {
    mocks.notifications.mockResolvedValue({ rows, hasMore: false })
    open()
    const items = await screen.findAllByTestId('notification')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveAttribute('data-unread')
    expect(items[1]).not.toHaveAttribute('data-unread')
    expect(within(items[0]).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/alumni/founder/opportunities?open=9166121d-5a85-41dd-adda-23dc3276333b')
    const ext = within(items[1]).getByRole('link', { name: 'Open' })
    expect(ext).toHaveAttribute('href', 'https://example.com/rec')
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(items[2]).queryByRole('link')).not.toBeInTheDocument()
    expect(within(items[2]).getByRole('button', { name: 'See more' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('a broadcast carrying both languages is shown in the language of the page, not the one chosen at send time', async () => {
    mocks.notifications.mockResolvedValue({ rows: [{ id: 'n9', title: 'إشعار مراجعة', body: 'يرجى المراجعة.', is_read: false, created_at: '2026-10-14T10:00:00Z', metadata: { title_en: 'Review notice', title_ar: 'إشعار مراجعة', body_en: 'Please review.', body_ar: 'يرجى المراجعة.' } }], hasMore: false })
    open()
    const [item] = await screen.findAllByTestId('notification')
    expect(within(item).getByRole('heading', { name: /Review notice/ })).toBeInTheDocument()
    expect(within(item).getByText('Please review.')).toBeInTheDocument()
    expect(within(item).queryByText('إشعار مراجعة')).not.toBeInTheDocument()
  })

  it('mark read / unread, mark all, the "unread" filter is a server filter', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue({ rows, hasMore: false })
    open()
    const items = await screen.findAllByTestId('notification')
    await user.click(within(items[0]).getByRole('button', { name: 'Mark as read' }))
    await waitFor(() => expect(mocks.setRead).toHaveBeenCalledWith({ id: 'n1', read: true }))
    await user.click(within(items[1]).getByRole('button', { name: 'Mark as unread' }))
    await waitFor(() => expect(mocks.setRead).toHaveBeenCalledWith({ id: 'n2', read: false }))
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(mocks.markAll).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Unread' }))
    await waitFor(() => expect(mocks.notifications).toHaveBeenLastCalledWith({ unreadOnly: true, limit: 30 }))
  })

  it('opening a linked unread item marks it read', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue({ rows, hasMore: false })
    open()
    const items = await screen.findAllByTestId('notification')
    await user.click(within(items[0]).getByRole('link', { name: 'Open' }))
    await waitFor(() => expect(mocks.setRead).toHaveBeenCalledWith({ id: 'n1', read: true }))
  })

  it('empty states (all / unread) and "show older"', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unread' }))
    expect(await screen.findByText('Nothing unread')).toBeInTheDocument()
  })

  it('Arabic and the show-more button', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue({ rows, hasMore: true })
    renderPage(<FounderNotificationsPage />, { route: '/alumni/founder/notifications?lang=ar', path: '/alumni/founder/notifications' })
    expect(await screen.findByRole('heading', { name: 'الإشعارات' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'عرض الإشعارات الأقدم' }))
    await waitFor(() => expect(mocks.notifications).toHaveBeenLastCalledWith({ unreadOnly: false, limit: 60 }))
  })
})

// ============================================================================ opportunities
describe('Founder opportunities page', () => {
  // deadlines on the calendar basis the page counts from (today in Cairo), so the count never depends on the machine's time zone or time of day
  const future = (days) => {
    const [y, m, d] = cairoToday().split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
  }
  const list = [
    { opportunity_id: 'o1', type: 'grant', title_en: 'Startup Grant', title_ar: 'منحة', description_en: 'Cash for pilots', description_ar: null, deadline: future(30), eligibility: 'Registered startups', link: null, image_url: null, order_index: 1 },
    { opportunity_id: 'o2', type: 'investment', title_en: 'Angel Round', title_ar: 'جولة', description_en: 'Pitch', description_ar: null, deadline: future(3), eligibility: null, link: 'https://example.com/angels', image_url: null, order_index: 2 },
    { opportunity_id: 'o3', type: 'event', title_en: 'Old Conference', title_ar: 'مؤتمر', description_en: 'Past', description_ar: null, deadline: '2020-01-01', eligibility: null, link: null, image_url: null, order_index: 3 },
  ]
  const open = (route = '/alumni/founder/opportunities?lang=en') => renderPage(<FounderOpportunitiesPage />, { route, path: '/alumni/founder/opportunities' })

  it('open opportunities first (nearest deadline), expired ones hidden by default and shown (as closed) under "All"', async () => {
    const user = userEvent.setup()
    mocks.opportunities.mockResolvedValue(list)
    open()
    const cards = await screen.findAllByTestId('opportunity')
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual(['Angel Round', 'Startup Grant'])
    expect(within(cards[0]).getByText('3 days left')).toBeInTheDocument()
    expect(within(cards[1]).getByText(/Registered startups/)).toBeInTheDocument()
    expect(within(cards[0]).getByRole('link', { name: 'More information' })).toHaveAttribute('rel', 'noopener noreferrer')
    await user.click(screen.getByRole('button', { name: 'All' }))
    const all = await screen.findAllByTestId('opportunity')
    expect(all).toHaveLength(3)
    expect(within(all[2]).getByText('Closed')).toBeInTheDocument()
    expect(within(all[2]).queryByTestId('apply-button')).not.toBeInTheDocument() // no application for a closed opportunity
  })

  it('filter by type and search', async () => {
    const user = userEvent.setup()
    mocks.opportunities.mockResolvedValue(list)
    open()
    await screen.findAllByTestId('opportunity')
    await user.click(screen.getByRole('button', { name: 'Grant' }))
    expect(screen.getAllByTestId('opportunity')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'All types' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search opportunities' }), 'angel')
    expect(screen.getAllByTestId('opportunity')).toHaveLength(1)
    await user.clear(screen.getByRole('searchbox', { name: 'Search opportunities' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search opportunities' }), 'zzz')
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument()
  })

  it('apply with the company and a note: the application carries only those; a success closes the dialog', async () => {
    const user = userEvent.setup()
    mocks.opportunities.mockResolvedValue(list)
    mocks.apply.mockResolvedValue({ id: 'a1', status: 'applied' })
    open()
    const card = (await screen.findAllByTestId('opportunity'))[1]
    await user.click(within(card).getByTestId('apply-button'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Applying with Nile Labs.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('A note for the Athar team (optional)'), 'We run pilots')
    await user.click(within(dialog).getByRole('button', { name: 'Send application' }))
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ opportunityId: 'o1', companyId: 'c1', notes: 'We run pilots' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('a refused application (already applied / closed) stays in the dialog with the message', async () => {
    const user = userEvent.setup()
    mocks.opportunities.mockResolvedValue(list)
    mocks.apply.mockRejectedValue(new AppError('conflict', { messageKey: 'alumni.opp.alreadyApplied', retryable: false }))
    open()
    await user.click(within((await screen.findAllByTestId('opportunity'))[0]).getByTestId('apply-button'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Send application' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Your company has already applied to this opportunity.')
  })

  it('the status of an application is shown, with the company and the date; no second apply button', async () => {
    mocks.opportunities.mockResolvedValue(list)
    mocks.applications.mockResolvedValue([{ id: 'a1', opportunity_id: 'o1', company_id: 'c1', status: 'shortlisted', applied_at: '2026-10-10T00:00:00Z' }])
    open()
    const card = (await screen.findAllByTestId('opportunity'))[1]
    expect(await within(card).findByTestId('application-status')).toHaveTextContent('Shortlisted')
    expect(within(card).getByText(/Applied on .* with Nile Labs\./)).toBeInTheDocument()
    expect(within(card).queryByTestId('apply-button')).not.toBeInTheDocument()
  })

  it('a founder without a company is sent to create one instead of applying', async () => {
    mocks.opportunities.mockResolvedValue(list)
    mocks.me.mockResolvedValue({ founder: FOUNDER, companies: [] })
    open()
    const card = (await screen.findAllByTestId('opportunity'))[0]
    expect(await within(card).findByRole('link', { name: 'Add your company to apply' })).toHaveAttribute('href', '/alumni/founder/company/new')
  })

  it('?open=<id> (a notification) shows that opportunity even when it is closed', async () => {
    mocks.opportunities.mockResolvedValue(list)
    open('/alumni/founder/opportunities?lang=en&open=o3')
    expect(await screen.findByText('Old Conference')).toBeInTheDocument()
  })

  it('empty state', async () => {
    open()
    expect(await screen.findByText('No opportunities right now')).toBeInTheDocument()
  })
})

// ============================================================================ progress
describe('Founder progress page (real data only)', () => {
  const open = () => renderPage(<FounderProgressPage />, { route: '/alumni/founder/progress?lang=en', path: '/alumni/founder/progress' })

  it('milestones come from the server: a new founder with an incomplete profile has the account only', async () => {
    mocks.me.mockResolvedValue({ founder: { ...FOUNDER, completeness: { percent: 25, missing: ['phone'] } }, companies: [] })
    open()
    const items = await screen.findAllByTestId('milestone')
    expect(items.filter((i) => i.dataset.done === 'true')).toHaveLength(1)
    expect(screen.getByTestId('journey-percent')).toHaveTextContent('14%')
    expect(screen.getByTestId('next-step')).toHaveTextContent('Complete your profile')
    expect(screen.getByText('No company yet')).toBeInTheDocument()
  })

  it('programs, certificates and the quarterly figures of a complete founder; nothing is invented', async () => {
    mocks.me.mockResolvedValue({ founder: { ...FOUNDER, completeness: { percent: 100, missing: [] } }, companies: [{ ...COMPANY_ROW, completeness: { percent: 100, missing: [] } }] })
    mocks.programs.mockResolvedValue([{ project_id: 'p1', status: 'attended', completed: true, project_name_en: 'Cohort 1', project_name_ar: 'الدفعة 1', program_name_en: 'Finland', program_name_ar: 'فنلندا' }])
    mocks.certificates.mockResolvedValue([{ certificate_id: 'ce1', project_id: 'p1', project_name: 'Cohort 1', program_name: 'Finland', issued_at: '2026-04-01T00:00:00Z', code: 'ABC' }])
    open()
    await screen.findAllByTestId('milestone')
    await waitFor(() => expect(screen.getByTestId('journey-percent')).toHaveTextContent('100%'))
    expect(screen.queryByTestId('next-step')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('progress-programs')).getByText('Cohort 1')).toBeInTheDocument()
    expect(within(screen.getByTestId('progress-certificates')).getByText('Cohort 1')).toBeInTheDocument()
    expect(await screen.findByTestId('figures-panel')).toBeInTheDocument()
    expect((await screen.findAllByTestId('chart-card')).length).toBe(3)
  })

  it('a withdrawn program does not count as joined; no certificates is said plainly', async () => {
    mocks.programs.mockResolvedValue([{ project_id: 'p1', status: 'withdrawn', project_name_en: 'X', program_name_en: 'Y' }])
    open()
    await screen.findAllByTestId('milestone')
    expect(screen.getByTestId('no-certificates')).toBeInTheDocument()
    expect(screen.queryByTestId('progress-programs')).not.toBeInTheDocument()
  })
})

// ============================================================================ home + shell
describe('Home Alumni cards', () => {
  const open = () => renderPage(<HomeAlumniCards />, { route: '/alumni/founder/dashboard?lang=en', path: '/alumni/founder/dashboard' })

  it('the next step is the profile first; the unread count and the shortcuts', async () => {
    mocks.unread.mockResolvedValue(3)
    open()
    expect(await screen.findByTestId('home-next-step')).toHaveTextContent('Complete your profile')
    expect(screen.getByTestId('home-next-step')).toHaveAttribute('href', '/alumni/founder/profile')
    expect(await screen.findByTestId('home-unread')).toHaveTextContent('3 unread')
    expect(screen.getByRole('link', { name: 'My progress' })).toHaveAttribute('href', '/alumni/founder/progress')
  })

  it('"update your figures for Q4 2026" appears when the quarter is open and not confirmed; the next step then points at the figures of that company', async () => {
    mocks.me.mockResolvedValue({ founder: { ...FOUNDER, completeness: { percent: 100, missing: [] } }, companies: [{ ...COMPANY_ROW, completeness: { percent: 90, missing: ['annual_update'] }, figures: { status: 'not_updated', period: '2026-Q4', deadline: '2026-12-31', updated_at: null } }] })
    open()
    expect(await screen.findByTestId('annual-due')).toHaveTextContent('Update your figures for Q4 2026')
    expect(screen.getByTestId('home-next-step')).toHaveAttribute('href', '/alumni/founder/progress?company=c1')
  })

  it('a founder with no company is pointed at "create your company"', async () => {
    mocks.me.mockResolvedValue({ founder: { ...FOUNDER, completeness: { percent: 100, missing: [] } }, companies: [] })
    open()
    expect(await screen.findByTestId('home-next-step')).toHaveAttribute('href', '/alumni/founder/company/new')
  })

  it('a failed query never takes the page down: the shortcuts stay, the unread badge hides, and the summary says it failed with a retry (it used to vanish silently)', async () => {
    const user = userEvent.setup()
    mocks.me.mockRejectedValueOnce(new AppError('network'))
    mocks.unread.mockRejectedValue(new AppError('network'))
    open()
    expect(await screen.findByRole('link', { name: 'Opportunities' })).toBeInTheDocument()
    expect(await screen.findByTestId('home-alumni-failed')).toHaveTextContent('Your profile summary could not be loaded.')
    expect(screen.queryByTestId('home-next-step')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-unread')).not.toBeInTheDocument()
    mocks.me.mockResolvedValue({ founder: { ...FOUNDER, completeness: { percent: 100, missing: [] } }, companies: [] })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('home-next-step')).toBeInTheDocument()
    expect(screen.queryByTestId('home-alumni-failed')).not.toBeInTheDocument()
  })

  it('while the summary loads there is a placeholder (the cards no longer pop in)', async () => {
    mocks.me.mockReturnValue(new Promise(() => {})) // never settles
    open()
    expect(await screen.findByRole('heading', { name: 'My profile and company' })).toBeInTheDocument()
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})

describe('Founder shell navigation', () => {
  const shell = () => renderWithProviders(<AuthContext.Provider value={auth}><Routes><Route element={<FounderShell />}><Route path="*" element={<p>page</p>} /></Route></Routes></AuthContext.Provider>, { route: '/alumni/founder/dashboard?lang=en' })

  it('five tabs; the unread badge sits on Notifications with a text alternative', async () => {
    mocks.unread.mockResolvedValue(5)
    shell()
    const nav = screen.getByRole('navigation', { name: 'Founder' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent.replace(/\d+ unread/, '').replace(/^\d+/, '').trim())).toEqual(['Dashboard', 'Programs', 'Opportunities', 'Notifications', 'Profile'])
    expect(await within(nav).findByTestId('unread-badge')).toHaveTextContent('5')
    expect(within(nav).getByTestId('unread-badge')).toHaveTextContent('5 unread')
  })

  it('no badge for zero or a failed count; 100+ is capped', async () => {
    mocks.unread.mockResolvedValue(0)
    const { unmount } = shell()
    await waitFor(() => expect(mocks.unread).toHaveBeenCalled())
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument()
    unmount()
    mocks.unread.mockResolvedValue(250)
    shell()
    expect(await screen.findByTestId('unread-badge')).toHaveTextContent('99+')
  })
})

// the sample payloads must stay what the contract says (a drift in the fixtures would make every test above meaningless)
describe('fixtures', () => {
  it('follow the contract', () => {
    expect(Object.keys(LOOKUPS)).toEqual(expect.arrayContaining(['governorates', 'sectors', 'stages', 'startup_types', 'legal_statuses', 'genders']))
    expect(FIGURES.snapshots[0]).toHaveProperty('revenue_total')
    expect(COMPANY_PAYLOAD.company).not.toHaveProperty('internal')
  })
})
