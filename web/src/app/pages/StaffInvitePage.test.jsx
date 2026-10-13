import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { AuthContext } from '../AuthContext.js'

const mocks = vi.hoisted(() => ({ validate: vi.fn(), accept: vi.fn(), signUp: vi.fn() }))
vi.mock('../../data/staff.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    validateStaffInvitation: mocks.validate,
    acceptStaffInvitation: mocks.accept,
    useStaffInvitation: (token) => useQuery({ queryKey: ['staffInvitation', token], queryFn: () => mocks.validate(token), retry: false }),
  }
})
vi.mock('../../data/auth.js', () => ({ signUpWithStaffInvitation: mocks.signUp }))

import StaffInvitePage from './StaffInvitePage.jsx'

const anon = { user: null, profile: null, roles: [], areas: [], status: 'anon', hasRole: () => false, can: () => false, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }

function renderPage(authValue = anon) {
  return renderWithProviders(
    <AuthContext.Provider value={authValue}>
      <Routes>
        <Route path="/invite/staff/:token" element={<StaffInvitePage />} />
        <Route path="/" element={<div data-testid="home">home</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: '/invite/staff/tok-1?lang=en' },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validate.mockResolvedValue({ valid: true, email: 'new@example.invalid', inviter_name: 'Admin', expires_at: '2099-01-01T00:00:00Z' })
  mocks.signUp.mockResolvedValue({ user: { id: 'u-new' } })
  mocks.accept.mockResolvedValue({ accepted: true })
})

describe('StaffInvitePage', () => {
  it('shows only e-mail, inviter and expiry; asks name + password + colour; signs up with the token and accepts', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('invite-page')
    expect(screen.getByText('new@example.invalid')).toBeInTheDocument()
    expect(screen.getByText(/Admin invited you/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Full name'), 'New Person')
    await user.type(screen.getByLabelText('Password'), 'longenough1')
    await user.type(screen.getByLabelText('Confirm password'), 'longenough1')
    await user.click(screen.getByLabelText('#0b75d9'))
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({ email: 'new@example.invalid', password: 'longenough1', fullName: 'New Person', profileColor: '#0b75d9', token: 'tok-1' }))
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith('tok-1'))
    await screen.findByTestId('home')
  })

  it('validates before any network call', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('invite-page')
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument()
    expect(mocks.signUp).not.toHaveBeenCalled()
  })

  it('invalid token shows the invalid screen without leaking anything', async () => {
    mocks.validate.mockResolvedValue({ valid: false })
    renderPage()
    expect(await screen.findByTestId('invite-invalid')).toBeInTheDocument()
    expect(screen.queryByText('new@example.invalid')).not.toBeInTheDocument()
  })

  it('signed-in user can accept with the current account; a mismatch is explained', async () => {
    const user = userEvent.setup()
    mocks.accept.mockResolvedValue({ accepted: false, reason: 'email_mismatch' })
    renderPage({ ...anon, status: 'authed', user: { id: 'u-other', email: 'other@example.invalid' }, roles: ['founder'] })
    await screen.findByTestId('invite-signed-in')
    await user.click(screen.getByRole('button', { name: 'Accept with this account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('different e-mail')
    expect(mocks.signUp).not.toHaveBeenCalled()
  })
})
