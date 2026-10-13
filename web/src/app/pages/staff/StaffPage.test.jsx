import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { AuthContext } from '../../AuthContext.js'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'

const staffMock = vi.hoisted(() => ({
  listStaff: vi.fn(),
  listStaffInvitations: vi.fn(),
  setStaffRoles: vi.fn(),
  setProgramMemberships: vi.fn(),
  removeStaff: vi.fn(),
  createStaffInvitation: vi.fn(),
  revokeStaffInvitation: vi.fn(),
  validateStaffInvitation: vi.fn(),
  acceptStaffInvitation: vi.fn(),
}))
vi.mock('../../../data/staff.js', async () => {
  const { useQuery, useMutation } = await import('@tanstack/react-query')
  return {
    ...staffMock,
    useStaff: () => useQuery({ queryKey: ['staff'], queryFn: staffMock.listStaff }),
    useStaffInvitations: () => useQuery({ queryKey: ['staff', 'invitations'], queryFn: staffMock.listStaffInvitations }),
    useStaffMutations: () => ({
      setRoles: useMutation({ mutationFn: ({ userId, roles }) => staffMock.setStaffRoles(userId, roles) }),
      setMemberships: useMutation({ mutationFn: ({ userId, programIds }) => staffMock.setProgramMemberships(userId, programIds) }),
      remove: useMutation({ mutationFn: ({ userId }) => staffMock.removeStaff(userId) }),
      invite: useMutation({ mutationFn: staffMock.createStaffInvitation }),
      revoke: useMutation({ mutationFn: ({ id }) => staffMock.revokeStaffInvitation(id) }),
    }),
  }
})
vi.mock('../../../data/programs.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  const listPrograms = async () => [{ id: 'g1', name_en: 'Spring 2026', name_ar: null }, { id: 'g2', name_en: 'Legacy', name_ar: null, archived_at: '2026-01-01' }]
  return { listPrograms, usePrograms: () => useQuery({ queryKey: ['programs'], queryFn: listPrograms }) }
})

import StaffPage from './StaffPage.jsx'

const ADMIN = { id: 'u-admin', email: 'admin@example.invalid' }
const auth = { user: ADMIN, profile: null, roles: ['super_admin'], areas: ['staff'], status: 'authed', hasRole: () => true, can: () => true, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }

function renderPage() {
  return renderWithProviders(
    <AuthContext.Provider value={auth}>
      <ConfirmProvider>
        <StaffPage />
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route: '/admin/staff?lang=en' },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  staffMock.listStaff.mockResolvedValue([
    { id: 'u-admin', email: 'admin@example.invalid', full_name: 'Admin', profile_color: '#1a27c9', roles: ['super_admin'], programs: [] },
    { id: 'u-pm', email: 'pm@example.invalid', full_name: 'Pat PM', profile_color: null, roles: ['project_manager'], programs: [{ program_id: 'g1', member_role: 'manager' }] },
  ])
  staffMock.listStaffInvitations.mockResolvedValue([
    { id: 'i1', email: 'new@example.invalid', roles: ['project_manager'], program_ids: ['g1'], status: 'pending', expires_at: '2099-01-01T00:00:00Z', created_at: '2026-01-01' },
  ])
  staffMock.setProgramMemberships.mockResolvedValue(undefined)
  staffMock.setStaffRoles.mockResolvedValue(undefined)
  staffMock.createStaffInvitation.mockResolvedValue({ id: 'i2', email: 'x@example.invalid', token: 'tok123', expires_at: '2099-01-01T00:00:00Z', roles: ['project_manager'], program_ids: [] })
})

describe('StaffPage', () => {
  it('lists staff with roles and programs; self cannot edit own roles or be removed', async () => {
    renderPage()
    const rows = await screen.findAllByTestId('staff-row')
    expect(rows).toHaveLength(2)
    const admin = rows.find((r) => r.dataset.email === 'admin@example.invalid')
    expect(within(admin).getByText('you')).toBeInTheDocument()
    expect(within(admin).getByRole('button', { name: 'Change roles' })).toBeDisabled()
    expect(within(admin).getByRole('button', { name: /Remove/ })).toBeDisabled()
    const pm = rows.find((r) => r.dataset.email === 'pm@example.invalid')
    expect(within(pm).getByText('Project Manager')).toBeInTheDocument()
    expect(within(pm).getByText('Spring 2026')).toBeInTheDocument()
    expect(screen.getByTestId('invitations')).toHaveTextContent('new@example.invalid')
  })

  it('changes a PM membership through the RPC', async () => {
    const user = userEvent.setup()
    renderPage()
    const rows = await screen.findAllByTestId('staff-row')
    const pm = rows.find((r) => r.dataset.email === 'pm@example.invalid')
    await user.click(within(pm).getByRole('button', { name: 'Program access' }))
    const dialog = await screen.findByRole('dialog')
    const legacy = within(dialog).getByRole('checkbox', { name: /Legacy/ })
    expect(within(dialog).getByRole('checkbox', { name: /Spring 2026/ })).toBeChecked()
    await user.click(legacy)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(staffMock.setProgramMemberships).toHaveBeenCalledWith('u-pm', ['g1', 'g2']))
  })

  it('creates an invitation and shows the copyable link once', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('staff-row')
    await user.click(screen.getByTestId('invite-staff'))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Email'), 'x@example.invalid')
    await user.click(within(dialog).getByRole('checkbox', { name: /Spring 2026/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Create invitation' }))
    await screen.findByTestId('invite-result')
    expect(staffMock.createStaffInvitation).toHaveBeenCalledWith(expect.objectContaining({ email: 'x@example.invalid', roles: ['project_manager'], programIds: ['g1'] }), expect.anything())
    expect(screen.getByLabelText('Invitation link').value).toContain('/invite/staff/tok123')
    expect(screen.getByTestId('copy-link')).toBeInTheDocument()
  })

  it('shows the staff/founder exclusivity error from the server when roles are rejected (08 section 15)', async () => {
    const { AppError } = await import('../../../data/errors.js')
    staffMock.setStaffRoles.mockRejectedValue(new AppError('validation', { messageKey: 'errors.staffFounderExclusive', retryable: false }))
    const user = userEvent.setup()
    renderPage()
    const rows = await screen.findAllByTestId('staff-row')
    const pm = rows.find((r) => r.dataset.email === 'pm@example.invalid')
    await user.click(within(pm).getByRole('button', { name: 'Change roles' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Alumni Manager/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByTestId('roles-error')).toHaveTextContent('A staff member cannot also be a founder')
    expect(staffMock.setStaffRoles).toHaveBeenCalledWith('u-pm', ['project_manager', 'alumni_manager'])
  })

  it('maps the m25 server token to the specific message', async () => {
    const { fromSupabase } = await import('../../../data/errors.js')
    const e = fromSupabase({ code: '23514', message: 'staff_founder_exclusive: a founder account cannot hold a staff role', hint: 'staff_founder_exclusive', details: 'user x' })
    expect(e.code).toBe('validation')
    expect(e.messageKey).toBe('errors.staffFounderExclusive')
  })

  it('rejects an invalid e-mail before calling the RPC', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('staff-row')
    await user.click(screen.getByTestId('invite-staff'))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Email'), 'nope')
    await user.click(within(dialog).getByRole('button', { name: 'Create invitation' }))
    expect(await within(dialog).findByText('Enter a valid e-mail address.')).toBeInTheDocument()
    expect(staffMock.createStaffInvitation).not.toHaveBeenCalled()
  })
})
