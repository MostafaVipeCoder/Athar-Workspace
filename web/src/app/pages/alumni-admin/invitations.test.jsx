import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import InvitationsPage from './InvitationsPage.jsx'

const COMPANIES = [
  { id: '11111111-1111-4111-8111-111111111111', name_en: 'Nile Robotics', name_ar: 'نيل', logo_path: null, sector: 'technology', governorate: 25, is_alumni: true },
  { id: '22222222-2222-4222-8222-222222222222', name_en: 'Delta Health', name_ar: 'دلتا', logo_path: null, sector: 'healthcare', governorate: 1, is_alumni: false },
]
const inv = (over) => ({ id: 'i1', company_id: COMPANIES[0].id, company_name_en: 'Nile Robotics', company_name_ar: 'نيل', email: 'sara@example.com', status: 'pending', effective_status: 'pending', sent_at: '2026-10-10T10:00:00Z', expires_at: '2026-10-24T10:00:00Z', accepted_at: null, ...over })

let mock
function setup(extra = {}) {
  mock = makeDb({
    rpc: {
      list_alumni_lookups: LOOKUPS,
      get_alumni_overview: { invitations: { total: 3, pending: 1, accepted: 1, expired: 1, revoked: 0 } },
      list_alumni_invitations: (a) => ({ total: 2, limit: a.p_limit, offset: a.p_offset, rows: [inv(), inv({ id: 'i2', email: 'omar@example.com', status: 'accepted', effective_status: 'accepted', accepted_at: '2026-10-11T10:00:00Z' })] }),
      list_alumni_directory: (a) => ({ audience: 'manager', total: 2, limit: 8, offset: 0, rows: COMPANIES.filter((c) => !a.p_filters.q || c.name_en.toLowerCase().includes(String(a.p_filters.q).toLowerCase())) }),
      create_alumni_invitation: (a) => ({ id: `new-${a.p_email}`, company_id: a.p_company, email: a.p_email, token: 'TOKEN', link: `${a.p_app_url}/invite/tok-${a.p_email}`, language: a.p_language, expires_at: '2026-10-28T10:00:00Z' }),
      revoke_alumni_invitation: null,
      ...extra,
    },
  })
  h.db = mock.db
}
const renderPage = () => renderWithProviders(<ConfirmProvider><InvitationsPage /></ConfirmProvider>, { route: '/alumni/admin/invitations?lang=en' })

beforeEach(() => setup())

describe('the invitations page', () => {
  it('says plainly that the e-mail is NOT sent by the platform, and lists the invitations with their status and the tab counts', async () => {
    renderPage()
    expect(screen.getByText('The e-mail is not sent by the platform yet')).toBeInTheDocument()
    expect(await screen.findByText('sara@example.com')).toBeInTheDocument()
    const list = screen.getByTestId('invitations')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('Pending')).toBeInTheDocument()
    expect(within(list).getByText('Accepted')).toBeInTheDocument()
    expect(within(list).getAllByRole('link', { name: 'Open Nile Robotics' })[0]).toHaveAttribute('href', `/alumni/admin/company/${COMPANIES[0].id}`)
    // an accepted invitation has no actions; a pending one can be re-sent or revoked
    expect(within(list.children[1]).queryByRole('button')).not.toBeInTheDocument()
    expect(within(list.children[0]).getByRole('button', { name: /Send a new link/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Pending\s*1/ })).toBeInTheDocument()
  })

  it('filters by status on the server', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('sara@example.com')
    await user.click(screen.getByRole('button', { name: /Expired/ }))
    await waitFor(() => expect(mock.rpcCalls('list_alumni_invitations').at(-1).args).toMatchObject({ p_status: 'expired', p_offset: 0 }))
  })

  it('an invalid e-mail address says so (on leaving the field) instead of a silently disabled button; the inert language control is gone', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('sara@example.com')
    expect(screen.queryByLabelText('Language of the invitation')).not.toBeInTheDocument()
    const field = screen.getByLabelText("Founder's e-mail")
    await user.type(field, 'not-an-address')
    expect(screen.queryByText('This e-mail address is not valid')).not.toBeInTheDocument() // not while typing
    await user.tab()
    expect(await screen.findByText('This e-mail address is not valid')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('creates ONE invitation for a company found by name and shows the link once, prominently, with a copy button', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue()
    renderPage()
    await screen.findByText('sara@example.com')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await user.type(screen.getByRole('combobox', { name: 'Company' }), 'delta')
    await user.click(await screen.findByRole('option', { name: /Delta Health/ }))
    await user.type(screen.getByLabelText("Founder's e-mail"), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))
    await waitFor(() => expect(mock.rpcCalls('create_alumni_invitation')).toHaveLength(1))
    expect(mock.rpcCalls('create_alumni_invitation')[0].args).toMatchObject({ p_company: COMPANIES[1].id, p_email: 'new@example.com', p_language: 'en' })
    expect(mock.rpcCalls('create_alumni_invitation')[0].args.p_app_url).toMatch(/^https?:\/\//)
    const panel = await screen.findByTestId('created-links')
    expect(within(panel).getByText(/shown ONCE/)).toBeInTheDocument()
    const input = within(panel).getByLabelText('Invitation link for new@example.com')
    expect(input.value).toContain('/invite/tok-new@example.com')
    await user.click(within(panel).getByRole('button', { name: /Copy link/ }))
    expect(writeText).toHaveBeenCalledWith(input.value)
  })

  it('bulk: parses "e-mail, company" lines, resolves the companies, flags the lines that cannot be created, creates the rest', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('sara@example.com')
    await user.click(screen.getByRole('button', { name: 'Several at once' }))
    const box = screen.getByLabelText(/One invitation per line/)
    await user.click(box)
    await user.paste('a@example.com, Nile Robotics\nb@example.com, Nobody Inc\nnot-an-email\nc@example.com')
    await user.click(screen.getByRole('button', { name: 'Check the lines' }))
    expect(await screen.findByText('No company with this name')).toBeInTheDocument()
    expect(screen.getByText('No e-mail address found')).toBeInTheDocument()
    expect(screen.getByText('No company: choose one below')).toBeInTheDocument()
    expect(screen.getByText(/1 ready/)).toBeInTheDocument()
    await user.click(screen.getByTestId('bulk-create'))
    await waitFor(() => expect(mock.rpcCalls('create_alumni_invitation')).toHaveLength(1))
    expect(mock.rpcCalls('create_alumni_invitation')[0].args).toMatchObject({ p_company: COMPANIES[0].id, p_email: 'a@example.com' })
    expect(await screen.findByTestId('created-links')).toBeInTheDocument()
  })

  it('revokes a pending invitation after a confirmation (and says what happens)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('sara@example.com')
    await user.click(within(screen.getByTestId('invitations').children[0]).getByRole('button', { name: /Revoke/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/will no longer be able to use the link/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(mock.rpcCalls('revoke_alumni_invitation')).toHaveLength(1))
    expect(mock.rpcCalls('revoke_alumni_invitation')[0].args).toEqual({ p_id: 'i1' })
  })

  it('"send a new link" on a pending invitation asks first (the old link dies), then creates a new one for the SAME e-mail and company', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('sara@example.com')
    await user.click(within(screen.getByTestId('invitations').children[0]).getByRole('button', { name: /Send a new link/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/stops working at once/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send a new link' }))
    await waitFor(() => expect(mock.rpcCalls('create_alumni_invitation')).toHaveLength(1))
    expect(mock.rpcCalls('create_alumni_invitation')[0].args).toMatchObject({ p_company: COMPANIES[0].id, p_email: 'sara@example.com' })
    expect(await screen.findByTestId('created-links')).toBeInTheDocument()
  })

  it('shows an error state with Try again, and the empty state', async () => {
    setup({ list_alumni_invitations: new Error('boom') })
    const { unmount } = renderPage()
    expect(await screen.findByText('The invitations could not be loaded.')).toBeInTheDocument()
    unmount()
    setup({ list_alumni_invitations: { total: 0, limit: 25, offset: 0, rows: [] } })
    renderPage()
    expect(await screen.findByText('No invitation here yet.')).toBeInTheDocument()
  })
})
