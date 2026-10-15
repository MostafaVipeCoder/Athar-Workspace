import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'

const mocks = vi.hoisted(() => ({ status: vi.fn(), admin: vi.fn(), start: vi.fn(), disconnect: vi.fn(), redirect: vi.fn() }))

vi.mock('../../data/google.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    startGoogleConnect: (o) => mocks.start(o),
    useGoogleStatus: () => useQuery({ queryKey: ['google', 'status'], queryFn: () => mocks.status() }),
    useGoogleConnectionsAdmin: ({ enabled = true } = {}) => useQuery({ queryKey: ['google', 'admin'], queryFn: () => mocks.admin(), enabled }),
    useGoogleMutations: () => {
      const qc = useQueryClient()
      const refresh = () => qc.invalidateQueries({ queryKey: ['google'] })
      return { disconnect: useMutation({ mutationFn: (o) => mocks.disconnect(o), onSuccess: refresh }), refresh }
    },
  }
})
vi.mock('../../lib/google.js', async (importOriginal) => ({ ...(await importOriginal()), redirectTo: (u) => mocks.redirect(u) }))

const { default: GoogleAccountSection } = await import('./GoogleAccountSection.jsx')
const { SenderNotice } = await import('./SenderNotice.jsx')

const SYS = { email: 'startups@athareg.com', status: 'active', connected_at: '2026-10-01T10:00:00Z', last_used_at: null }
const status = (over = {}) => ({
  mine: null, system: SYS, effective: { source: 'system', email: 'startups@athareg.com', fallback: true, reason: 'user_not_connected' }, is_super_admin: false, ...over,
})
const CONNECTED = { id: 'c1', email: 'pm.one@athareg.com', status: 'active', last_error: null, connected_at: '2026-10-10T09:30:00Z', last_used_at: '2026-10-14T08:00:00Z', scopes_ok: true }
const connectedStatus = (over = {}) => status({ mine: CONNECTED, effective: { source: 'user', email: 'pm.one@athareg.com', fallback: false, reason: null }, ...over })
const reconnectStatus = (over = {}) => status({ mine: { ...CONNECTED, status: 'needs_reconnect', last_error: 'invalid_grant' }, effective: { source: 'system', email: 'startups@athareg.com', fallback: true, reason: 'user_needs_reconnect' }, ...over })

const pm = { user: { id: 'u1', email: 'pm.one@athareg.com' }, profile: null, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
function Probe() {
  const l = useLocation()
  return <output data-testid="location">{l.pathname}{l.search}</output>
}
function mount(ui, route = '/profile?lang=en') {
  return renderWithProviders(<AuthContext.Provider value={pm}><ConfirmProvider>{ui}<Probe /></ConfirmProvider></AuthContext.Provider>, { route })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status.mockResolvedValue(status())
  mocks.admin.mockResolvedValue([])
  mocks.start.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' })
  mocks.disconnect.mockResolvedValue({ ok: true, disconnected: true, revoked_at_google: true })
})

describe('Profile > Google account', () => {
  it('not connected: says so, names the system sender that sends meanwhile, offers Connect and no Disconnect', async () => {
    mount(<GoogleAccountSection />)
    const section = await screen.findByTestId('google-account')
    expect(await within(section).findByTestId('google-status')).toHaveTextContent('Not connected')
    expect(within(section).getByTestId('google-mine')).toHaveTextContent('You have not connected Google yet.')
    expect(within(section).getByTestId('google-mine')).toHaveTextContent('startups@athareg.com')
    expect(within(section).getByTestId('google-connect')).toHaveTextContent('Connect Google')
    expect(within(section).queryByTestId('google-disconnect')).toBeNull()
    expect(within(section).getByText('What the platform will do from this account')).toBeInTheDocument()
    expect(within(section).getByText(/never reads your inbox/)).toBeInTheDocument()
  })

  it('Connect asks the server for the consent URL (with the current path to come back to) and leaves for Google', async () => {
    const user = userEvent.setup()
    mount(<GoogleAccountSection />)
    await user.click(await screen.findByTestId('google-connect'))
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith({ system: false, returnTo: '/profile' }))
    await waitFor(() => expect(mocks.redirect).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=x'))
  })

  it('a failed start shows the translated reason and re-enables the button (no redirect)', async () => {
    const user = userEvent.setup()
    mocks.start.mockRejectedValueOnce(Object.assign(new Error('x'), { messageKey: 'google.err.not_configured' }))
    mount(<GoogleAccountSection />)
    await user.click(await screen.findByTestId('google-connect'))
    expect(await screen.findByText('Connecting Google is not set up on this server yet. Ask the administrator.')).toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('google-connect')).toBeEnabled())
  })

  it('connected: shows the account, dates and last use; Reconnect and Disconnect are offered; no token is rendered anywhere', async () => {
    mocks.status.mockResolvedValue(connectedStatus())
    mount(<GoogleAccountSection />)
    const mine = await screen.findByTestId('google-mine')
    expect(await screen.findByTestId('google-status')).toHaveTextContent('Connected')
    expect(mine).toHaveTextContent('Connected as pm.one@athareg.com')
    expect(mine).toHaveTextContent('Connected on')
    expect(mine).toHaveTextContent('Last used')
    expect(screen.getByTestId('google-connect')).toHaveTextContent('Reconnect Google')
    expect(screen.getByTestId('google-disconnect')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ciphertext|vault_secret|ya29|1\/\/0/)
  })

  it('Disconnect asks first (destructive confirm), then calls the server and reports success', async () => {
    const user = userEvent.setup()
    mocks.status.mockResolvedValue(connectedStatus())
    mount(<GoogleAccountSection />)
    await user.click(await screen.findByTestId('google-disconnect'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Disconnect Google?')
    expect(dlg).toHaveTextContent('The platform will stop sending as')
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(mocks.disconnect).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('google-disconnect'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledWith({ system: false }))
    expect(await screen.findByText('Google disconnected.')).toBeInTheDocument()
  })

  it('Disconnect when Google could not be reached says so (the local secret is gone, the grant may remain)', async () => {
    const user = userEvent.setup()
    mocks.status.mockResolvedValue(connectedStatus())
    mocks.disconnect.mockResolvedValue({ ok: true, disconnected: true, revoked_at_google: false })
    mount(<GoogleAccountSection />)
    await user.click(await screen.findByTestId('google-disconnect'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText(/Google could not be reached to remove the permission/)).toBeInTheDocument()
  })

  it('needs reconnecting: explains why (the stored CODE as words), keeps Reconnect primary and names the fallback sender', async () => {
    mocks.status.mockResolvedValue(reconnectStatus())
    mount(<GoogleAccountSection />)
    const mine = await screen.findByTestId('google-mine')
    expect(await screen.findByTestId('google-status')).toHaveTextContent('Needs reconnecting')
    expect(mine).toHaveTextContent('Google no longer accepts the saved permission')
    expect(mine).toHaveTextContent('Reason: Google refused the saved permission')
    expect(mine).toHaveTextContent('Meanwhile e-mails and events go out from the system sender (startups@athareg.com).')
    expect(screen.getByTestId('google-connect')).toHaveTextContent('Reconnect Google')
    expect(screen.getByTestId('google-disconnect')).toBeInTheDocument()
  })

  it('no system sender and no own connection: warns that e-mails wait in the outbox', async () => {
    mocks.status.mockResolvedValue(status({ system: null, effective: { source: null, email: null, fallback: false, reason: 'no_connection' } }))
    mount(<GoogleAccountSection />)
    expect(await screen.findByTestId('google-mine')).toHaveTextContent('e-mails wait in the outbox')
  })

  it('the return from Google: success toast once, the URL is cleaned, the status refetches', async () => {
    mount(<GoogleAccountSection />, '/profile?lang=en&google=connected')
    expect(await screen.findByText('Google connected. The platform can now send as you.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/profile?lang=en'))
    expect(screen.getByTestId('location').textContent).not.toContain('google=')
  })

  it('the return from Google with an error shows the translated reason (never the raw query text)', async () => {
    mount(<GoogleAccountSection />, '/profile?lang=en&google=error&reason=wrong_domain')
    expect(await screen.findByText(/Only Athar accounts \(@athareg\.com\) can be connected/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location').textContent).not.toContain('reason='))
  })

  it('a hostile reason in the URL is shown as the generic server error, never as text', async () => {
    mount(<GoogleAccountSection />, `/profile?lang=en&google=error&reason=${encodeURIComponent('<img src=x onerror=alert(1)>')}`)
    expect(await screen.findByText('Something went wrong on our side. Please try again.')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('the status failing shows an error with retry (no crash, nothing connected is claimed)', async () => {
    const user = userEvent.setup()
    mocks.status.mockRejectedValueOnce(Object.assign(new Error('x'), { messageKey: 'errors.network', retryable: true }))
    mount(<GoogleAccountSection />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('google-connect')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('google-connect')).toBeInTheDocument()
  })

  it('Arabic: right-to-left texts, the e-mail stays left-to-right inside its own element', async () => {
    mocks.status.mockResolvedValue(connectedStatus())
    mount(<GoogleAccountSection />, '/profile?lang=ar')
    const mine = await screen.findByTestId('google-mine')
    expect(await screen.findByTestId('google-status')).toHaveTextContent('متصل')
    expect(screen.getByText('حساب Google')).toBeInTheDocument()
    expect(mine).toHaveTextContent('متصل باسم')
    const bdi = within(mine).getByText('pm.one@athareg.com')
    expect(bdi.tagName).toBe('BDI')
    expect(bdi).toHaveAttribute('dir', 'ltr')
    expect(screen.getByTestId('google-disconnect')).toHaveTextContent('فصل الحساب')
  })

  it('a project manager does NOT see the system-sender card; a super_admin does', async () => {
    mount(<GoogleAccountSection />)
    await screen.findByTestId('google-connect')
    expect(screen.queryByTestId('google-system')).toBeNull()
  })
})

describe('System sender (super_admin)', () => {
  const adminStatus = (over = {}) => status({ is_super_admin: true, ...over })

  it('shows the linked startups@ account and its state; Connect / Reconnect / Disconnect act on the SYSTEM connection', async () => {
    const user = userEvent.setup()
    mocks.status.mockResolvedValue(adminStatus())
    mount(<GoogleAccountSection />)
    const card = await screen.findByTestId('google-system')
    expect(within(card).getByRole('heading', { name: 'System sender (startups@athareg.com)' })).toBeInTheDocument()
    expect(within(card).getByTestId('google-system-status')).toHaveTextContent('Connected')
    expect(card).toHaveTextContent('Linked as startups@athareg.com')
    expect(within(card).getByTestId('google-system-connect')).toHaveTextContent('Reconnect the system sender')
    await user.click(within(card).getByTestId('google-system-connect'))
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith({ system: true, returnTo: '/profile' }))
    await user.click(within(card).getByTestId('google-system-disconnect'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledWith({ system: true }))
  })

  it('not linked yet: says so and offers to link it', async () => {
    mocks.status.mockResolvedValue(adminStatus({ system: null, effective: { source: null, email: null, fallback: false, reason: 'no_connection' } }))
    mount(<GoogleAccountSection />)
    const card = await screen.findByTestId('google-system')
    expect(within(card).getByTestId('google-system-status')).toHaveTextContent('Not connected')
    expect(card).toHaveTextContent('No system sender is linked.')
    expect(within(card).getByTestId('google-system-connect')).toHaveTextContent('Link the system sender')
    expect(within(card).queryByTestId('google-system-disconnect')).toBeNull()
  })

  it('needs reconnecting: warns that project managers without their own connection cannot send', async () => {
    mocks.status.mockResolvedValue(adminStatus({ system: { ...SYS, status: 'needs_reconnect' }, effective: { source: null, email: null, fallback: false, reason: 'no_connection' } }))
    mount(<GoogleAccountSection />)
    expect(await screen.findByTestId('google-system')).toHaveTextContent('The system sender needs reconnecting')
  })

  it('the overview of everyone is loaded only when opened, is a real table, and never shows a token', async () => {
    const user = userEvent.setup()
    mocks.status.mockResolvedValue(adminStatus())
    mocks.admin.mockResolvedValue([
      { id: 's', kind: 'system', is_system: true, email: 'startups@athareg.com', status: 'active', last_used_at: null, owner_name: null, owner_email: null },
      { id: 'a', kind: 'user', is_system: false, email: 'pm.one@athareg.com', status: 'active', last_used_at: '2026-10-14T08:00:00Z', owner_name: 'Mona PM', owner_email: 'pm.one@athareg.com' },
      { id: 'b', kind: 'user', is_system: false, email: 'pm.two@athareg.com', status: 'needs_reconnect', last_error: 'invalid_grant', last_used_at: null, owner_name: null, owner_email: 'pm.two@athareg.com' },
      { id: 'c', kind: 'user', is_system: false, email: 'old@athareg.com', status: 'revoked', last_used_at: null, owner_name: 'Gone', owner_email: null },
    ])
    mount(<GoogleAccountSection />)
    const card = await screen.findByTestId('google-system')
    expect(mocks.admin).not.toHaveBeenCalled()
    const toggle = within(card).getByTestId('google-overview-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const table = await within(card).findByTestId('google-overview-table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(5)
    expect(within(rows[1]).getByText('System sender')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Mona PM')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Needs reconnecting')).toBeInTheDocument()
    expect(within(rows[4]).getByText('Disconnected')).toBeInTheDocument()
    expect(table).not.toHaveTextContent(/token|secret|1\/\//i)
  })

  it('an empty overview says nobody has connected yet', async () => {
    const user = userEvent.setup()
    mocks.status.mockResolvedValue(adminStatus())
    mount(<GoogleAccountSection />)
    await user.click(await screen.findByTestId('google-overview-toggle'))
    expect(await screen.findByText('Nobody has connected Google yet.')).toBeInTheDocument()
  })
})

describe('SenderNotice (the real state inside Booking / Selection settings)', () => {
  const kinds = [
    ['mine', connectedStatus(), 'E-mails from this node are sent from your Google account (', 'Google settings'],
    ['fallback', status(), 'You have not connected Google: e-mails from this node go out from the system sender (', 'Connect Google in your profile'],
    ['fallbackReconnect', reconnectStatus(), 'Your Google connection needs reconnecting: until then e-mails go out from the system sender (', 'Reconnect Google in your profile'],
    ['none', status({ system: null, effective: { source: null, email: null, fallback: false, reason: 'no_connection' } }), 'Nobody can send yet', 'Connect Google in your profile'],
    ['noneReconnect', status({ mine: { ...CONNECTED, status: 'needs_reconnect' }, system: null, effective: { source: null, email: null, fallback: false, reason: 'user_needs_reconnect_no_system' } }), 'there is no system sender: e-mails wait in the outbox', 'Reconnect Google in your profile'],
  ]
  for (const [kind, st, text, link] of kinds) {
    it(`${kind}: the e-mail wording and a link to the profile`, async () => {
      mocks.status.mockResolvedValue(st)
      mount(<SenderNotice scope="email" />, '/projects/P/nodes/B?lang=en')
      const n = await screen.findByTestId('sender-notice')
      await waitFor(() => expect(n).toHaveAttribute('data-kind', kind))
      expect(n).toHaveTextContent(text)
      expect(within(n).getByRole('link', { name: link })).toHaveAttribute('href', '/profile')
      expect(n).toHaveAttribute('role', 'status')
    })
  }
  it('the calendar scope says calendar', async () => {
    mocks.status.mockResolvedValue(connectedStatus())
    mount(<SenderNotice scope="calendar" />, '/x?lang=en')
    expect(await screen.findByText(/Calendar events are created in your Google Calendar/)).toBeInTheDocument()
  })
  it('Arabic wording; the address is isolated left-to-right inside the sentence', async () => {
    mocks.status.mockResolvedValue(connectedStatus())
    mount(<SenderNotice scope="email" />, '/x?lang=ar')
    const n = await screen.findByTestId('sender-notice')
    await waitFor(() => expect(n).toHaveTextContent('تُرسل رسائل هذه العقدة من حسابك على Google'))
    expect(n.textContent).toContain('⁦pm.one@athareg.com⁩')
  })
  it('loading then a quiet error (never a crash) when the status cannot be read', async () => {
    mocks.status.mockRejectedValue(new Error('x'))
    mount(<SenderNotice />, '/x?lang=en')
    expect(await screen.findByText('Could not check which Google account sends.')).toBeInTheDocument()
  })
})
