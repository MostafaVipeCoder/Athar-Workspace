import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthContext } from '../AuthContext.js'
import RequireAccess from './RequireAccess.jsx'
import { routes } from '../routes.jsx'
import { LanguageProvider } from '../../i18n/LanguageProvider.jsx'
import { ToastProvider } from '../../ui/Toast.jsx'

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}</p>
}

/** Both guarded areas side by side, exactly as the route table nests them (founder = area:founder, staff = area:staff). */
function setup(roles, route) {
  render(
    <AuthContext.Provider value={{ status: 'authed', roles, reloadRoles: () => {} }}>
      <MemoryRouter initialEntries={[route]}>
        <LanguageProvider>
          <ToastProvider>
            <Routes>
              <Route element={<RequireAccess area="founder" />}>
                <Route path="/alumni/founder/programs/:projectId" element={<p>founder program</p>} />
                <Route path="/alumni/founder/programs" element={<p>founder programs</p>} />
              </Route>
              <Route element={<RequireAccess area="staff" />}>
                <Route path="/programs" element={<p>staff programs</p>} />
                <Route path="/projects/:id" element={<p>staff project</p>} />
              </Route>
              <Route path="*" element={<Where />} />
            </Routes>
          </ToastProvider>
        </LanguageProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('founder area guard (step 8)', () => {
  it('a founder opens the Programs list and a Program page', () => {
    setup(['founder'], '/alumni/founder/programs')
    expect(screen.getByText('founder programs')).toBeInTheDocument()
  })
  it('a founder opening a program page keeps the project id route', () => {
    setup(['founder'], '/alumni/founder/programs/abc')
    expect(screen.getByText('founder program')).toBeInTheDocument()
  })
  it('a project manager opening the founder area is bounced to the staff home', () => {
    setup(['project_manager'], '/alumni/founder/programs/abc')
    expect(screen.getByText('staff programs')).toBeInTheDocument()
  })
  it('an alumni manager opening the founder area is bounced to their own home, not the founder pages', () => {
    setup(['alumni_manager'], '/alumni/founder/programs')
    expect(screen.queryByText('founder programs')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/alumni/admin/dashboard')
  })
  it('a founder opening a staff route is bounced to the founder home', () => {
    setup(['founder'], '/projects/abc')
    expect(screen.queryByText('staff project')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/alumni/founder/dashboard')
  })
  it('a founder opening the staff Programs page is bounced too', () => {
    setup(['founder'], '/programs')
    expect(screen.queryByText('staff programs')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/alumni/founder/dashboard')
  })
})

describe('route table', () => {
  const flat = (list, out = []) => {
    for (const r of list) {
      if (r.path) out.push(r.path)
      if (r.children) flat(r.children, out)
    }
    return out
  }
  const paths = flat(routes)
  it('serves the Home, the Programs list, the Program page and the agenda of a project inside the founder area', () => {
    expect(paths).toEqual(expect.arrayContaining([
      'alumni/founder/dashboard', 'alumni/founder/programs', 'alumni/founder/programs/:projectId', 'alumni/founder/programs/:projectId/agenda/:tab?',
    ]))
  })
  it('keeps the founder routes under the founder guard and shell (no founder page outside area:founder)', () => {
    const root = routes[0].children
    const guarded = root.find((r) => r.element?.props?.area === 'founder')
    expect(guarded).toBeTruthy()
    const inner = flat(guarded.children)
    expect(inner).toEqual(expect.arrayContaining(['alumni/founder/programs', 'alumni/founder/programs/:projectId']))
    const outside = flat(root.filter((r) => r !== guarded))
    expect(outside.filter((p) => p.startsWith('alumni/founder'))).toEqual([])
  })
})
