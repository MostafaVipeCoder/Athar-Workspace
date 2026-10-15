import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/render.jsx'
import { AuthContext } from '../../AuthContext.js'
import { LOOKUPS, makeDb } from './testDb.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../data/client.js', () => ({ db: () => h.db, supabase: null, functionUrl: (n) => n }))

import RevealId, { REVEAL_MS } from './RevealId.jsx'
import CompanyPicker from './CompanyPicker.jsx'
import NetworkShell from '../../shells/NetworkShell.jsx'
import { routes } from '../../routes.jsx'

const FULL_ID = '29501010101234'

describe('RevealId (the audited reveal of a national ID)', () => {
  let mock
  beforeEach(() => {
    mock = makeDb({ rpc: { get_alumni_founder: (a) => ({ id: a.p_founder, identity: { id_masked: '**********1234', ...(a.p_reveal ? { national_id: FULL_ID } : {}) } }) } })
    h.db = mock.db
  })
  afterEach(() => vi.useRealTimers())

  it('renders a dash without an ID and never calls the server by itself', () => {
    renderWithProviders(<RevealId masked={null} founderId="f1" hasId={false} />, { route: '/x?lang=en' })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(mock.rpcCalls('get_alumni_founder')).toHaveLength(0)
  })

  it('shows the full number only after the click, hides it again after 30 seconds, on "Hide" and on unmount; nothing is cached or put in a URL', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<RevealId masked="**********1234" founderId="f1" />, { route: '/x?lang=en' })
    expect(screen.getByTestId('id-value')).toHaveTextContent('**********1234')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await user.click(screen.getByRole('button', { name: 'Show the full national ID' }))
    await waitFor(() => expect(screen.getByTestId('id-value')).toHaveTextContent(FULL_ID))
    expect(mock.rpcCalls('get_alumni_founder')[0].args).toEqual({ p_founder: 'f1', p_reveal: true })
    expect(window.location.href).not.toContain(FULL_ID)
    await act(async () => { vi.advanceTimersByTime(REVEAL_MS + 100) })
    expect(screen.getByTestId('id-value')).toHaveTextContent('**********1234')
    await user.click(screen.getByRole('button', { name: 'Show the full national ID' }))
    await waitFor(() => expect(screen.getByTestId('id-value')).toHaveTextContent(FULL_ID))
    await user.click(screen.getByRole('button', { name: 'Hide the national ID' }))
    expect(screen.getByTestId('id-value')).toHaveTextContent('**********1234')
    unmount()
    expect(document.body.textContent).not.toContain(FULL_ID)
  })

  it('a refused reveal keeps the masked value', async () => {
    h.db = makeDb({ rpc: { get_alumni_founder: Object.assign(new Error('forbidden'), { code: '42501' }) } }).db
    const user = userEvent.setup()
    renderWithProviders(<RevealId masked="**********1234" founderId="f1" />, { route: '/x?lang=en' })
    await user.click(screen.getByRole('button', { name: 'Show the full national ID' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show the full national ID' })).toBeEnabled())
    expect(screen.getByTestId('id-value')).toHaveTextContent('**********1234')
  })
})

describe('CompanyPicker', () => {
  it('searches the manager directory (any scope), moves with the arrow keys, chooses with Enter, excludes the given ids', async () => {
    const user = userEvent.setup()
    const mock = makeDb({ rpc: {
      list_alumni_lookups: LOOKUPS,
      list_alumni_directory: { audience: 'manager', total: 3, limit: 8, offset: 0, rows: [
        { id: 'c1', name_en: 'Alpha', name_ar: null, sector: 'technology', governorate: 25, is_alumni: true, logo_path: null },
        { id: 'c2', name_en: 'Alpine', name_ar: null, sector: 'healthcare', governorate: 1, is_alumni: false, logo_path: null },
        { id: 'c3', name_en: 'Excluded', name_ar: null, sector: null, governorate: null, is_alumni: true, logo_path: null }] },
    } })
    h.db = mock.db
    const onSelect = vi.fn()
    renderWithProviders(<CompanyPicker label="Company" onSelect={onSelect} excludeIds={['c3']} />, { route: '/x?lang=en' })
    const input = screen.getByRole('combobox', { name: 'Company' })
    await user.type(input, 'al')
    expect(await screen.findByRole('option', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Excluded/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Alpine/ })).toHaveTextContent('not an alumni yet')
    await waitFor(() => expect(mock.rpcCalls('list_alumni_directory').at(-1).args).toMatchObject({ p_filters: { q: 'al', scope: 'all' }, p_limit: 8 }))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }))
    expect(input).toHaveValue('')
  })
})

describe('CompanyPicker keyboard behaviour', () => {
  it('the listbox closes when focus leaves the box by keyboard (Tab), and stays while focus is inside', async () => {
    const user = userEvent.setup()
    const mock = makeDb({ rpc: { list_alumni_lookups: LOOKUPS, list_alumni_directory: { audience: 'manager', total: 1, limit: 8, offset: 0, rows: [{ id: 'c1', name_en: 'Alpha', name_ar: null, sector: null, governorate: null, is_alumni: true, logo_path: null }] } } })
    h.db = mock.db
    renderWithProviders(<><CompanyPicker label="Company" onSelect={() => {}} /><button type="button">After</button></>, { route: '/x?lang=en' })
    const input = screen.getByRole('combobox', { name: 'Company' })
    await user.click(input)
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('the manager area wiring', () => {
  it('the shell links to every built page of the area', () => {
    const auth = { user: { id: 'u' }, profile: null, roles: ['alumni_manager'], areas: ['network'], status: 'authed', hasRole: () => true, can: () => true, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }
    renderWithProviders(<AuthContext.Provider value={auth}><NetworkShell /></AuthContext.Provider>, { route: '/alumni/admin/dashboard?lang=en' })
    const nav = screen.getAllByRole('navigation', { name: 'Network' })[0]
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/alumni/admin/dashboard', '/alumni/admin/directory', '/alumni/admin/invitations', '/alumni/admin/opportunities', '/alumni/admin/notifications', '/alumni/admin/quarters', '/alumni/admin/analytics', '/alumni/admin/workspace'])
  })

  it('the eight-link nav leaves the burger at 1280px (xl), not 1024px: it only fits on one line from there', () => {
    const auth = { user: { id: 'u' }, profile: null, roles: ['alumni_manager'], areas: ['network'], status: 'authed', hasRole: () => true, can: () => true, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }
    renderWithProviders(<AuthContext.Provider value={auth}><NetworkShell /></AuthContext.Provider>, { route: '/alumni/admin/dashboard?lang=en' })
    const burger = screen.getByRole('button', { name: 'Menu' })
    expect(burger.className).toContain('xl:hidden')
    expect(burger.className).not.toContain('lg:hidden')
    expect(screen.getAllByRole('navigation', { name: 'Network' })[0].parentElement.className).toContain('xl:block')
  })

  it('no manager route is a "coming soon" placeholder any more (each is a lazy page), incl. the company page, the import and Impact', () => {
    const flat = []
    const walk = (list, prefix = '') => list.forEach((r) => { if (r.children) walk(r.children, prefix); if (r.path) flat.push(r) })
    walk(routes)
    const admin = flat.filter((r) => r.path.startsWith('alumni/admin/'))
    expect(admin.map((r) => r.path).sort()).toEqual(['alumni/admin/analytics', 'alumni/admin/attention', 'alumni/admin/company/:id', 'alumni/admin/dashboard', 'alumni/admin/directory', 'alumni/admin/directory/import', 'alumni/admin/history', 'alumni/admin/impact',
      'alumni/admin/invitations', 'alumni/admin/notifications', 'alumni/admin/opportunities', 'alumni/admin/performance', 'alumni/admin/quarters', 'alumni/admin/quarters/reminders', 'alumni/admin/workspace'])
    // the per-edit history viewer is gone (owner decision 21): its old address only redirects
    for (const r of admin) expect(r.path === 'alumni/admin/history' ? Boolean(r.element) : typeof r.lazy === 'function').toBe(true)
  })
})
