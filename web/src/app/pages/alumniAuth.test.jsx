import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { AuthContext } from '../AuthContext.js'
import { AppError } from '../../data/errors.js'

const mocks = vi.hoisted(() => ({ signUp: vi.fn(), validate: vi.fn(), accept: vi.fn(), profile: vi.fn() }))
vi.mock('../../data/auth.js', () => ({
  signUpFounder: (...a) => mocks.signUp(...a),
  getSession: vi.fn(), onAuthChange: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), fetchRoles: vi.fn(), fetchProfile: vi.fn(),
}))
vi.mock('../../data/alumni.js', () => ({
  validateInvitation: (...a) => mocks.validate(...a),
  acceptInvitation: (...a) => mocks.accept(...a),
  getMyAlumniProfile: (...a) => mocks.profile(...a),
}))

const { default: SignupPage } = await import('./SignupPage.jsx')
const { default: FounderInvitePage } = await import('./FounderInvitePage.jsx')
const { default: LoginPage } = await import('./LoginPage.jsx')

const anon = { status: 'anon', roles: [], user: null, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }
const authed = (roles, email = 'me@example.com') => ({ status: 'authed', roles, user: { id: 'u1', email }, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() })

function Where() {
  const l = useLocation()
  return <p data-testid="where" data-state={JSON.stringify(l.state ?? null)}>{l.pathname}</p>
}
function renderAt(ui, { auth = anon, path, route }) {
  return renderWithProviders(
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route path={path} element={ui} />
        <Route path="*" element={<Where />} />
      </Routes>
    </AuthContext.Provider>,
    { route },
  )
}

const fill = async (user, { name, email, password, confirm }) => {
  if (name !== undefined) await user.type(screen.getByLabelText(/full name/i), name)
  if (email !== undefined) await user.type(screen.getByLabelText('Email'), email)
  if (password !== undefined) await user.type(screen.getByLabelText('Password'), password)
  if (confirm !== undefined) await user.type(screen.getByLabelText('Confirm password'), confirm)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signUp.mockResolvedValue({ session: { access_token: 'x' }, user: { id: 'u1' } })
})

describe('Open founder sign-up (/signup)', () => {
  const open = (auth) => renderAt(<SignupPage />, { auth, path: '/signup', route: '/signup?lang=en' })

  it('asks for a name, an e-mail and a password; every rule shows its own message and nothing is sent', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText('This field is required.')).toBeInTheDocument()
    expect(screen.getByText('The password must have at least 8 characters.', { selector: 'p.text-destructive-text' })).toBeInTheDocument()
    await fill(user, { name: 'Nour', email: 'not-an-email', password: 'longenough1', confirm: 'different1' })
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(await screen.findByText('Enter a valid e-mail address.')).toBeInTheDocument()
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument()
    expect(mocks.signUp).not.toHaveBeenCalled()
  })

  it('a refused submit moves the focus to the FIRST invalid field and announces every message as an alert', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    await screen.findByText('Enter your name.')
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toHaveFocus())
    expect(screen.getByLabelText(/full name/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter your name.')).toHaveAttribute('role', 'alert')
  })

  it('a valid form signs the founder up (no role in the request) and lands on the profile with the welcome banner', async () => {
    const user = userEvent.setup()
    open()
    await fill(user, { name: 'Nour Hassan', email: 'nour@example.com', password: 'longenough1', confirm: 'longenough1' })
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({ email: 'nour@example.com', password: 'longenough1', fullName: 'Nour Hassan' }))
    const where = await screen.findByTestId('where')
    expect(where).toHaveTextContent('/alumni/founder/profile')
    expect(JSON.parse(where.dataset.state)).toEqual({ welcome: true })
  })

  it('with e-mail confirmation ON (no session) the page says "check your e-mail"', async () => {
    mocks.signUp.mockResolvedValue({ session: null, user: { id: 'u1' } })
    const user = userEvent.setup()
    open()
    await fill(user, { name: 'Nour Hassan', email: 'nour@example.com', password: 'longenough1', confirm: 'longenough1' })
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(await screen.findByTestId('signup-confirm')).toHaveTextContent('nour@example.com')
  })

  it('an e-mail that already has an account: the message and a sign-in link', async () => {
    mocks.signUp.mockRejectedValue(new AppError('conflict', { messageKey: 'alumni.auth.emailTaken', retryable: false }))
    const user = userEvent.setup()
    open()
    await fill(user, { name: 'Nour Hassan', email: 'nour@example.com', password: 'longenough1', confirm: 'longenough1' })
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    const err = await screen.findByTestId('signup-error')
    expect(err).toHaveTextContent('This e-mail already has an account.')
    expect(err.querySelector('a')).toHaveAttribute('href', '/login')
  })

  it('a signed-in account never sees the sign-up form: it goes to its own home (a staff member does not become a founder here)', async () => {
    open(authed(['project_manager']))
    expect(await screen.findByTestId('where')).toHaveTextContent('/programs')
    expect(screen.queryByTestId('signup-page')).not.toBeInTheDocument()
  })

  it('the staff note and the Arabic page', async () => {
    renderAt(<SignupPage />, { path: '/signup', route: '/signup?lang=ar' })
    expect(await screen.findByRole('heading', { name: 'أنشئ حساب المؤسس' })).toBeInTheDocument()
    expect(screen.getByText('حسابات فريق أثر تُنشأ بدعوة وليس من هنا.')).toBeInTheDocument()
  })
})

describe('Login links to the founder sign-up', () => {
  it('"Create a founder account" points at /signup', () => {
    renderAt(<LoginPage />, { path: '/login', route: '/login?lang=en' })
    expect(screen.getByRole('link', { name: 'Create a founder account' })).toHaveAttribute('href', '/signup')
  })
})

describe('Founder invitation (/invite/:token)', () => {
  const VALID = { valid: true, company_name: 'Nile Labs', company_name_en: 'Nile Labs', company_name_ar: 'مختبرات النيل', masked_email: 'n***@example.com', inviter_name: 'Salma Hassan', expires_at: '2026-10-28T00:00:00Z' }
  const open = (auth = anon, route = '/invite/tok-1?lang=en') => renderAt(<FounderInvitePage />, { auth, path: '/invite/:token', route })

  it('a bad, expired or used link: one clear page, no form', async () => {
    mocks.validate.mockResolvedValue({ valid: false })
    open()
    expect(await screen.findByTestId('invite-invalid')).toHaveTextContent('This invitation is not valid')
    expect(screen.queryByTestId('invite-form')).not.toBeInTheDocument()
  })

  it('a validation failure (network) is the same page, never a crash', async () => {
    mocks.validate.mockRejectedValue(new AppError('network'))
    open()
    expect(await screen.findByTestId('invite-invalid')).toBeInTheDocument()
  })

  it('shows the company, who invited and until when; the e-mail is masked', async () => {
    mocks.validate.mockResolvedValue(VALID)
    open()
    expect(await screen.findByTestId('invite-company')).toHaveTextContent('You are invited to join Nile Labs')
    expect(screen.getByText('Invited by Salma Hassan')).toBeInTheDocument()
    expect(screen.getByText('Invitation for n***@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Valid until/)).toBeInTheDocument()
    expect(mocks.validate).toHaveBeenCalledWith('tok-1')
  })

  it('the Arabic page names the company in Arabic', async () => {
    mocks.validate.mockResolvedValue(VALID)
    open(anon, '/invite/tok-1?lang=ar')
    expect(await screen.findByTestId('invite-company')).toHaveTextContent('أنت مدعو للانضمام إلى مختبرات النيل')
  })

  it('creating the account sends the token (the trigger links the company) and lands on the profile as an INVITED founder', async () => {
    mocks.validate.mockResolvedValue(VALID)
    mocks.profile.mockResolvedValue({ founder: { id: 'f1' }, companies: [{ id: 'c1' }] })
    const user = userEvent.setup()
    open()
    await screen.findByTestId('invite-form')
    await fill(user, { name: 'Karim Nabil', email: 'karim@example.com', password: 'longenough1', confirm: 'longenough1' })
    await user.click(screen.getByRole('button', { name: 'Create my account and join' }))
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({ email: 'karim@example.com', password: 'longenough1', fullName: 'Karim Nabil', invitationToken: 'tok-1' }))
    const where = await screen.findByTestId('where')
    expect(where).toHaveTextContent('/alumni/founder/profile')
    expect(JSON.parse(where.dataset.state)).toEqual({ invited: true })
  })

  it('an account created with ANOTHER e-mail is not linked: the page says so instead of pretending', async () => {
    mocks.validate.mockResolvedValue(VALID)
    mocks.profile.mockResolvedValue({ founder: { id: 'f1' }, companies: [] })
    const user = userEvent.setup()
    open()
    await screen.findByTestId('invite-form')
    await fill(user, { name: 'Karim Nabil', email: 'other@example.com', password: 'longenough1', confirm: 'longenough1' })
    await user.click(screen.getByRole('button', { name: 'Create my account and join' }))
    expect(await screen.findByTestId('invite-not-linked')).toHaveTextContent('it is not linked to the company')
  })

  it('"Sign in to accept" goes through the login page and comes back here', async () => {
    mocks.validate.mockResolvedValue(VALID)
    open()
    expect(await screen.findByTestId('invite-signin')).toHaveAttribute('href', '/login?next=%2Finvite%2Ftok-1')
  })

  it('signed in as a founder: accept with this account, then the profile', async () => {
    mocks.validate.mockResolvedValue(VALID)
    mocks.accept.mockResolvedValue({ accepted: true, company_id: 'c1' })
    const user = userEvent.setup()
    open(authed(['founder'], 'karim@example.com'))
    expect(await screen.findByTestId('invite-signed-in')).toHaveTextContent('You are signed in as karim@example.com.')
    await user.click(screen.getByRole('button', { name: 'Join Nile Labs' }))
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith('tok-1'))
    expect(JSON.parse((await screen.findByTestId('where')).dataset.state)).toEqual({ invited: true })
  })

  it('an invitation for another e-mail (or already used) is explained, with a way out', async () => {
    mocks.validate.mockResolvedValue(VALID)
    mocks.accept.mockResolvedValue({ accepted: false })
    const user = userEvent.setup()
    const a = authed(['founder'])
    open(a)
    await user.click(await screen.findByRole('button', { name: 'Join Nile Labs' }))
    expect(await screen.findByTestId('invite-error')).toHaveTextContent('sent to a different e-mail address')
    await user.click(screen.getByRole('button', { name: 'Sign out and use another account' }))
    expect(a.signOut).toHaveBeenCalled()
  })

  it('a STAFF session cannot accept (staff and founder are exclusive): the explanation and sign out only, no accept button', async () => {
    mocks.validate.mockResolvedValue(VALID)
    open(authed(['alumni_manager']))
    expect(await screen.findByTestId('invite-staff')).toHaveTextContent('This is a staff account')
    expect(screen.queryByRole('button', { name: /Join Nile Labs/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(mocks.accept).not.toHaveBeenCalled()
  })

  it('the server\'s own exclusivity refusal is translated too', async () => {
    mocks.validate.mockResolvedValue(VALID)
    mocks.accept.mockRejectedValue(new AppError('validation', { messageKey: 'errors.staffFounderExclusive', retryable: false }))
    const user = userEvent.setup()
    open(authed(['founder']))
    await user.click(await screen.findByRole('button', { name: 'Join Nile Labs' }))
    expect(await screen.findByTestId('invite-error')).toHaveTextContent('A staff member cannot also be a founder.')
  })
})
