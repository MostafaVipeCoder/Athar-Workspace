import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthContext } from '../AuthContext.js'
import RequireAccess from './RequireAccess.jsx'
import { LanguageProvider } from '../../i18n/LanguageProvider.jsx'
import { ToastProvider } from '../../ui/Toast.jsx'

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}{l.search}</p>
}

function setup(auth, route = '/projects/1') {
  const value = { reloadRoles: () => {}, ...auth }
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[route]}>
        <LanguageProvider>
          <ToastProvider>
            <Routes>
              <Route element={<RequireAccess area="staff" />}>
                <Route path="/projects/:id" element={<p>secret</p>} />
              </Route>
              <Route path="*" element={<Where />} />
            </Routes>
          </ToastProvider>
        </LanguageProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('RequireAccess', () => {
  it('anonymous goes to /login with next', () => {
    setup({ status: 'anon', roles: [] })
    expect(screen.getByTestId('where')).toHaveTextContent('/login?next=%2Fprojects%2F1')
  })
  it('no roles goes to /no-access', () => {
    setup({ status: 'authed', roles: [] })
    expect(screen.getByTestId('where')).toHaveTextContent('/no-access')
  })
  it('founder-only user is sent to the founder home', () => {
    setup({ status: 'authed', roles: ['founder'] })
    expect(screen.getByTestId('where')).toHaveTextContent('/alumni/founder/dashboard')
  })
  it('PM is allowed', () => {
    setup({ status: 'authed', roles: ['project_manager'] })
    expect(screen.getByText('secret')).toBeInTheDocument()
  })
  it('loading shows a spinner, roles failure shows retry', () => {
    setup({ status: 'loading', roles: [] })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
  it('error state', () => {
    setup({ status: 'error', roles: [] })
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
