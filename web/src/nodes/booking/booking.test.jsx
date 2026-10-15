import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import manifest from './manifest.js'

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), extras: vi.fn(), link: vi.fn(), page: vi.fn(), create: vi.fn(), cancelPublic: vi.fn(),
  upsert: vi.fn(), updateProvider: vi.fn(), addSlots: vi.fn(), deleteSlots: vi.fn(), cancel: vi.fn(), restore: vi.fn(), reschedule: vi.fn(), retry: vi.fn(), ensureLink: vi.fn(),
  listItems: vi.fn(), ensureItem: vi.fn(), google: vi.fn(), calendar: vi.fn(), calMode: vi.fn(), setCalMode: vi.fn(),
}))

vi.mock('../../data/booking.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    getBookingLink: (id) => mocks.link(id),
    getPublicBookingPage: (ref, o) => mocks.page(ref, o),
    createBooking: (ref, slot, booker, invite) => mocks.create(ref, slot, booker, invite),
    cancelBooking: (id, token) => mocks.cancelPublic(id, token),
    useBookingAdmin: (id) => useQuery({ queryKey: ['node', id, 'bookingAdmin'], queryFn: () => mocks.admin(id) }),
    useBookingExtras: (id) => useQuery({ queryKey: ['node', id, 'bookingExtras'], queryFn: () => mocks.extras(id) }),
    useBookingLink: (id) => useQuery({ queryKey: ['node', id, 'bookingLink'], queryFn: () => mocks.link(id) }),
    usePublicBooking: (ref, { host = null, invite = null } = {}) => useQuery({ queryKey: ['public', 'booking', ref, host, invite], queryFn: () => mocks.page(ref, { host, invite }), enabled: Boolean(ref) }),
    useBookingMutations: (id) => {
      const qc = useQueryClient()
      const after = () => qc.invalidateQueries({ queryKey: ['node', id] })
      const useM = (fn) => useMutation({ mutationFn: fn, onSuccess: after })
      const m = useM
      return {
        upsertProvider: m(({ row }) => mocks.upsert(id, row)), updateProvider: m(({ providerId, patch }) => mocks.updateProvider(providerId, patch)), deleteProvider: m(async () => null),
        addSlots: m(({ providerId, slots }) => mocks.addSlots(id, providerId, slots)), setSlotBlocked: m(async () => null), deleteSlots: m(({ ids }) => mocks.deleteSlots(ids)),
        cancel: m(({ bookingId }) => mocks.cancel(bookingId)), restore: m(({ bookingId }) => mocks.restore(bookingId)), reschedule: m(({ bookingId, slotId }) => mocks.reschedule(bookingId, slotId)), retrySync: m(({ bookingId }) => mocks.retry(bookingId)),
        ensureLink: useMutation({ mutationFn: () => mocks.ensureLink(id) }),
      }
    },
  }
})
vi.mock('../../data/lists.js', async () => {
  const { normalizeListItem } = await import('../../lib/entities.js')
  return {
    getListMeta: async () => ({ subkind: 'expert' }),
    listItems: async (id, { kind = 'generic' } = {}) => (await mocks.listItems(id)).map((r) => normalizeListItem(r, kind)),
    materializeItem: async (listId, item) => item.itemId ?? mocks.ensureItem(listId, item.source.kind, item.source.id),
  }
})
vi.mock('../../data/google.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useGoogleStatus: () => useQuery({ queryKey: ['google', 'status'], queryFn: () => mocks.google() }) }
})
vi.mock('../../data/calendarSync.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    hasActiveSync: () => false,
    useCalendarSyncOverview: (id) => useQuery({ queryKey: ['node', id, 'calendarSync'], queryFn: async () => (await mocks.calendar(id)) ?? null }),
    useCalendarSyncMode: () => useQuery({ queryKey: ['calendarSync', 'mode'], queryFn: async () => (await mocks.calMode()) ?? null }),
    useCalendarSyncModeMutation: () => {
      const qc = useQueryClient()
      return useMutation({ mutationFn: (mode) => mocks.setCalMode(mode), onSuccess: () => qc.invalidateQueries({ queryKey: ['calendarSync'] }) })
    },
  }
})
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn() }))

const googleFallback = () => ({ mine: null, system: { email: 'startups@athareg.com', status: 'active' }, effective: { source: 'system', email: 'startups@athareg.com', fallback: true, reason: 'user_not_connected' }, is_super_admin: false })
const auth = { user: { id: 'u1', email: 'pm@x.io' }, profile: { full_name: 'Mona PM' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const anon = { user: null, profile: null, roles: [], status: 'anon', hasRole: () => false, can: () => false }
const node = { id: 'B', project_id: 'P', type: 'booking', type_version: 1, name_en: 'Mentor sessions', name_ar: 'جلسات', visibility: 'public', show_to_participants: false, config: {}, rev: 1 }
const graph = {
  project: { id: 'P', timezone: 'Africa/Cairo' },
  nodes: [{ id: 'B', type: 'booking', name_en: 'Mentor sessions' }, { id: 'L', type: 'list', name_en: 'Mentors' }],
  edges: [{ from_node_id: 'L', from_port: 'items', to_node_id: 'B', to_port: 'mentors', is_enabled: true }],
}
const adminData = () => ({
  settings: { node_id: 'B', mode: 'mentor', default_advance_notice_min: 1440, meeting_link_mode: 'unique', shared_meet_link: null, organizer_connection_id: null },
  providers: [{ id: 'p1', list_item_id: 'li1', advance_notice_min: null, booking_email: 'book@x.io', is_active: true, sort_order: null, created_at: '1' }],
  slots: [
    { id: 's1', provider_id: 'p1', starts_at: '2027-03-10T08:00:00Z', ends_at: '2027-03-10T08:30:00Z', is_blocked: false },
    { id: 's2', provider_id: 'p1', starts_at: '2027-03-10T08:35:00Z', ends_at: '2027-03-10T09:05:00Z', is_blocked: false },
  ],
  bookings: [{ id: 'b1', slot_id: 's1', status: 'confirmed', booker_email: 'f@x.io', booker_name: 'Mona Fathy', booker_company_name: 'Delta Farms', meet_link: null, legacy_calendar_event_id: null, lang: 'en', created_at: '2026-10-01T10:00:00Z' }],
})
const extrasData = () => ({ jobs: [{ id: 'j1', booking_id: 'b1', kind: 'calendar_create', status: 'pending', connection_id: null, created_at: '1' }], emails: [{ id: 'o1', booking_id: 'b1', email_key: 'booking_confirmation', status: 'queued', created_at: '1' }], invitations: [], connections: [], pm_name: 'Mona PM', program_name: { en: 'Prog', ar: '' }, project_name: { en: 'Proj', ar: '' }, timezone: 'Africa/Cairo' })
const listRows = () => [
  { item_id: 'li1', source: { kind: 'network_expert', id: 'e1', state: 'ok' }, display: { title_en: 'Mentor One', subtitle_en: 'CEO' }, contact: { email: 'm1@x.io' }, overlay: {}, status: null, sort_order: 1, excluded: false },
  { item_id: null, source: { kind: 'network_expert', id: 'e2', state: 'ok' }, display: { title_en: 'Mentor Two' }, contact: { email: 'm2@x.io' }, overlay: {}, status: null, sort_order: null, excluded: false },
]
const pagePayload = (over = {}) => ({
  status: 'open', mode: 'mentor', node_id: 'B', name_en: 'Mentor sessions', name_ar: '', slug: 'bk1', audience: 'public', timezone: 'Africa/Cairo', default_advance_notice_min: 1440, meeting_link_mode: 'unique',
  config: { page: { title: { en: 'Book a mentor', ar: '' }, intro: { en: '', ar: '' } } }, invitee: null,
  providers: [{ id: 'p1', name_en: 'Mentor One', name_ar: 'منتور', title_en: 'CEO', photo_path: null }],
  slots: [{ id: 's1', provider_id: 'p1', starts_at: '2027-03-10T08:00:00Z', ends_at: '2027-03-10T08:30:00Z' }, { id: 's3', provider_id: 'p1', starts_at: '2027-03-11T08:00:00Z', ends_at: '2027-03-11T08:30:00Z' }],
  ...over,
})

function mount(mode, over = {}, lang = 'en') {
  const adapter = createMemoryAdapter({ nodes: [{ ...node, ...over }], edges: graph.edges })
  renderWithProviders(
    <AuthContext.Provider value={auth}><ConfirmProvider><NodeHost mode={mode} node={{ ...node, ...over }} graph={graph} projectId="P" adapter={adapter} /></ConfirmProvider></AuthContext.Provider>,
    { route: `/projects/P/nodes/B?lang=${lang}` },
  )
  return adapter
}
async function mountPublic(route, authValue = anon) {
  const { default: PublicBookingPage } = await import('../../app/pages/PublicBookingPage.jsx')
  renderWithProviders(
    <AuthContext.Provider value={authValue}><Routes><Route path="/book/:nodeRef/:hostRef?" element={<PublicBookingPage />} /></Routes></AuthContext.Provider>,
    { route },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin.mockImplementation(async () => adminData())
  mocks.google.mockImplementation(async () => googleFallback())
  mocks.extras.mockImplementation(async () => extrasData())
  mocks.calendar.mockResolvedValue(null)
  mocks.calMode.mockResolvedValue({ mode: 'shadow', can_set: false, last_run_at: null })
  mocks.setCalMode.mockResolvedValue({ mode: 'live', previous: 'shadow', in_flight: 0 })
  mocks.retry.mockResolvedValue(1)
  mocks.link.mockResolvedValue({ linkId: 'l1', slug: 'bk1', enabled: true })
  mocks.listItems.mockImplementation(async () => listRows())
  mocks.ensureItem.mockResolvedValue('li2')
  mocks.upsert.mockResolvedValue({ id: 'p2' })
  mocks.updateProvider.mockResolvedValue(null)
  mocks.addSlots.mockResolvedValue({ created: 2, overlapped: 0, invalid: 0, ids: [] })
  mocks.deleteSlots.mockResolvedValue(null)
  mocks.cancel.mockResolvedValue(null)
  mocks.restore.mockResolvedValue(null)
  mocks.reschedule.mockResolvedValue({ changed: true })
  mocks.page.mockImplementation(async () => pagePayload())
  mocks.create.mockResolvedValue({ booking_id: 'b9', slot_id: 's1', starts_at: '2027-03-10T08:00:00Z', ends_at: '2027-03-10T08:30:00Z', status: 'confirmed', meet_link: null, cancel_token: 'tok123', lang: 'en' })
  mocks.cancelPublic.mockResolvedValue(null)
})

describe('Booking node', () => {
  it('manifest: two presets, link resolver, the two v1 e-mails, ports mirror the DB row', () => {
    expect(manifest.presets.map((p) => p.key)).toEqual(['mentor', 'interview'])
    expect(manifest.ports.out.find((p) => p.key === 'link').resolve).toBeTypeOf('function')
    expect(manifest.ports.in.map((p) => p.key)).toEqual(['mentors', 'bookers', 'schedule'])
    expect(manifest.emails.map((e) => e.key)).toEqual(['booking_confirmation', 'booking_cancellation'])
  })

  it('Edit / Providers: the connected list items by reference; enabling a virtual item materialises it then creates the overlay row', async () => {
    const user = userEvent.setup()
    mount('edit')
    const rows = await screen.findAllByTestId('provider-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Mentor One')).toBeInTheDocument()
    expect(within(rows[0]).getByTestId('provider-enabled')).toBeChecked()
    expect(within(rows[0]).getByTestId('provider-email')).toHaveValue('book@x.io')
    await user.click(within(rows[1]).getByTestId('provider-enabled'))
    await waitFor(() => expect(mocks.ensureItem).toHaveBeenCalledWith('L', 'network_expert', 'e2'))
    expect(mocks.upsert).toHaveBeenCalledWith('B', { list_item_id: 'li2', is_active: true, booking_email: 'm2@x.io' })
    fireEvent.change(within(rows[0]).getByTestId('provider-email'), { target: { value: 'other@x.io' } })
    fireEvent.blur(within(rows[0]).getByTestId('provider-email'))
    await waitFor(() => expect(mocks.updateProvider).toHaveBeenCalledWith('p1', { booking_email: 'other@x.io' }))
  })

  it('Edit (m40 withdrawn): a provider whose item was withdrawn stays as a NAMED "Withdrawn" row (no longer an anonymous orphan), cannot be switched on; a withdrawn booker is flagged for the PM and nothing is cancelled', async () => {
    const user = userEvent.setup()
    mocks.admin.mockImplementation(async () => {
      const a = adminData()
      a.providers = [...a.providers, { id: 'p9', list_item_id: 'w1', advance_notice_min: null, booking_email: null, is_active: false, sort_order: null, created_at: '2' }]
      a.bookings = [{ ...a.bookings[0], booker_item_id: 'wb1' }]
      return a
    })
    mocks.extras.mockImplementation(async () => ({ ...extrasData(), withdrawn_items: [{ id: 'w1', name_en: 'Walid Mentor', name_ar: 'وليد' }, { id: 'wb1', name_en: 'Delta Farms', name_ar: '' }], invitations: [{ id: 'iv1', booker_item_id: 'wb1', company_en: 'Delta Farms', company_ar: '', email: 'f@x.io', used: false, revoked_at: null, withdrawn: true }] }))
    mount('edit')
    const rows = await screen.findAllByTestId('provider-row')
    expect(rows).toHaveLength(3)
    const walid = rows.find((r) => within(r).queryByText('Walid Mentor'))
    expect(within(walid).getByTestId('provider-withdrawn')).toHaveTextContent('Withdrawn')
    expect(within(walid).getByText('Not offered on the public page')).toBeInTheDocument()
    expect(within(walid).queryByText('Not in the connected list any more')).toBeNull()
    expect(within(walid).getByTestId('provider-enabled')).toBeDisabled()
    await user.click(screen.getByTestId('tab-bookings'))
    const row = await screen.findByTestId('booking-row')
    expect(within(row).getByTestId('booker-withdrawn')).toHaveTextContent('Withdrawn')
    expect(within(row).getByRole('button', { name: /Cancel/ })).toBeEnabled() // the PM decides; nothing is cancelled automatically
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('Edit / Availability: the generator previews whole slots in the project zone, skips overlaps and creates ISO instants', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('provider-row')
    await user.click(screen.getByTestId('tab-slots'))
    fireEvent.change(screen.getByTestId('slots-date'), { target: { value: '2027-03-10' } })
    fireEvent.change(screen.getByTestId('gen-from'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByTestId('gen-to'), { target: { value: '12:00' } })
    // 10:00-10:30, 10:35-11:05 exist already (08:00Z / 08:35Z in March = UTC+2): 11:10-11:40 is the only fresh one
    expect(screen.getByTestId('gen-preview')).toHaveTextContent('1 slots will be created (2 overlap')
    await user.click(screen.getByTestId('gen-run'))
    await waitFor(() => expect(mocks.addSlots).toHaveBeenCalledWith('B', 'p1', [{ starts_at: '2027-03-10T09:10:00.000Z', ends_at: '2027-03-10T09:40:00.000Z' }]))
    const day = await screen.findByTestId('slot-day')
    const slotRows = within(day).getAllByTestId('slot-row')
    expect(slotRows.map((r) => r.dataset.state)).toEqual(['booked', 'free'])
    await user.click(within(slotRows[1]).getByRole('button', { name: /Delete 10:35/ }))
    await waitFor(() => expect(mocks.deleteSlots).toHaveBeenCalledWith(['s2']))
    expect(await screen.findByText('1 slots deleted.')).toBeInTheDocument()
  })

  it('Edit / Bookings: sync state from the queue, cancel with confirm + Undo (restore), reschedule to a free slot', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('provider-row')
    await user.click(screen.getByTestId('tab-bookings'))
    const row = await screen.findByTestId('booking-row')
    expect(within(row).getByText('Mona Fathy')).toBeInTheDocument()
    expect(within(row).getByText('Mentor One')).toBeInTheDocument()
    expect(within(row).getByTestId('sync-badge')).toHaveTextContent('Waiting for a Google connection')
    expect(screen.getByTestId('waiting-connection')).toBeInTheDocument()
    expect(within(row).getByText(/Confirmation · Queued/)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /Reschedule/ }))
    const dlg = await screen.findByRole('dialog')
    const free = within(dlg).getAllByTestId('move-slot')
    expect(free).toHaveLength(1) // s2 is the only free slot of p1
    await user.click(free[0])
    await waitFor(() => expect(mocks.reschedule).toHaveBeenCalledWith('b1', 's2'))
    await user.click(within(row).getByRole('button', { name: /Cancel booking/ }))
    const confirmDlg = await screen.findByRole('dialog')
    expect(confirmDlg).toHaveTextContent('Cancel the booking of "Mona Fathy"?')
    await user.click(within(confirmDlg).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('b1'))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('b1'))
  })

  // ---- m63: the calendar sync state of every booking, in the words of the PM
  const ENTRY = (id, state, over = {}) => ({ booking_id: id, state, code: null, job: null, event_id: null, migrated: false, synced_at: null, calendar_email: null, plan: null, ...over })
  const overview = (entries, over = {}) => ({ mode: 'live', can_set_mode: false, last_run_at: '2026-10-15T10:00:00Z', now: '2026-10-15T10:01:00Z', bookings: entries, ...over })
  const manyBookings = (ids) => ids.map((id, i) => ({ id, slot_id: 's1', status: 'confirmed', booker_email: `f${i}@x.io`, booker_name: `Booker ${i}`, booker_company_name: `Co ${i}`, meet_link: id === 'b-synced' ? 'https://meet.google.com/abc-defg-hij' : null, legacy_calendar_event_id: null, lang: 'en', created_at: `2026-10-0${i + 1}T10:00:00Z` }))
  const rowOf = (rows, name) => rows.find((r) => within(r).queryByText(name))

  it('Edit / Bookings (m63): every sync state in words - synced (open in Google Calendar), migrated, queued, syncing, retrying, shadow + plan, off, needs a connection, failed', async () => {
    const ids = ['b-synced', 'b-migrated', 'b-pending', 'b-syncing', 'b-retrying', 'b-shadow', 'b-off', 'b-needs', 'b-failed', 'b-past', 'b-none']
    mocks.admin.mockImplementation(async () => ({ ...adminData(), bookings: manyBookings(ids) }))
    mocks.calendar.mockResolvedValue(overview([
      ENTRY('b-synced', 'synced', { event_id: 'e0e0e0', calendar_email: 'pm@athareg.com', job: { id: 'j', kind: 'calendar_create', status: 'done', attempts: 1, html_link: null } }),
      ENTRY('b-migrated', 'migrated', { event_id: '8vp3k0jsl1d2m4n5o6q7r8s9t0', calendar_email: 'startups@athareg.com', migrated: true }),
      ENTRY('b-pending', 'pending', { job: { id: 'j', kind: 'calendar_create', status: 'pending', attempts: 0 } }),
      ENTRY('b-syncing', 'syncing', { job: { id: 'j', kind: 'calendar_create', status: 'processing', attempts: 1 } }),
      ENTRY('b-retrying', 'retrying', { code: 'rate_limited:429', job: { id: 'j', kind: 'calendar_create', status: 'failed', attempts: 2, next_attempt_at: '2026-10-15T10:05:00Z' } }),
      ENTRY('b-shadow', 'shadow', { plan: { action: 'create', kind: 'calendar_create', calendar: 'pm@athareg.com', event: { summary: 'Mentor Session: Co 5 with Mentor One', start: '2027-03-10T10:00:00+02:00', timeZone: 'Africa/Cairo', attendee_count: 2, attendees: ['a@x.io', 'b@x.io'], meet: 'unique' } } }),
      ENTRY('b-off', 'off'),
      ENTRY('b-needs', 'needs_connection', { code: 'needs_reconnect', job: { id: 'j', kind: 'calendar_create', status: 'pending', attempts: 0 } }),
      ENTRY('b-failed', 'failed', { code: 'shared_link_required', job: { id: 'j', kind: 'calendar_create', status: 'dead', attempts: 1 } }),
      ENTRY('b-past', 'past'),
      ENTRY('b-none', 'none'),
    ]))
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('provider-row')
    await user.click(screen.getByTestId('tab-bookings'))
    const rows = await screen.findAllByTestId('booking-row')
    expect(rows).toHaveLength(ids.length)
    const cell = (name) => within(rowOf(rows, name)).getByTestId('sync-cell')
    const badge = (name) => within(cell(name)).getByTestId('sync-badge')
    expect(badge('Booker 0')).toHaveTextContent('Synced')
    expect(within(cell('Booker 0')).getByTestId('sync-calendar')).toHaveTextContent('pm@athareg.com')
    const open = within(cell('Booker 0')).getByTestId('sync-open-calendar')
    expect(open.getAttribute('href')).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/event\?eid=/)
    expect(decodeURIComponent(open.getAttribute('href').split('eid=')[1])).not.toContain('=')
    expect(within(cell('Booker 0')).getByTestId('sync-meet')).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij')
    expect(badge('Booker 1')).toHaveTextContent('Synced (migrated)')
    expect(within(cell('Booker 1')).getByTestId('sync-calendar')).toHaveTextContent('startups@athareg.com')
    expect(badge('Booker 2')).toHaveTextContent('Queued')
    expect(badge('Booker 3')).toHaveTextContent('Syncing')
    expect(badge('Booker 4')).toHaveTextContent('Retrying')
    expect(within(cell('Booker 4')).getByTestId('sync-attempt')).toHaveTextContent('Attempt 2 of 6')
    expect(within(cell('Booker 4')).getByTestId('sync-problem')).toHaveTextContent('Google is limiting requests right now')
    expect(within(cell('Booker 4')).getByTestId('sync-retry')).toHaveTextContent('Retry now')
    expect(badge('Booker 5')).toHaveTextContent('Shadow (not sent to Google)')
    const plan = within(cell('Booker 5')).getByTestId('sync-plan')
    expect(within(plan).getByTestId('sync-plan-action')).toHaveTextContent('Create the event')
    expect(plan).toHaveTextContent('Mentor Session: Co 5 with Mentor One')
    expect(plan).toHaveTextContent('Guests (2)')
    expect(plan).toHaveTextContent('A new Meet link is created with the event')
    expect(plan).toHaveTextContent('pm@athareg.com')
    expect(badge('Booker 6')).toHaveTextContent('Sync is off')
    expect(badge('Booker 7')).toHaveTextContent('Needs a Google connection')
    expect(within(cell('Booker 7')).getByTestId('sync-problem')).toHaveTextContent('must be connected again')
    expect(within(cell('Booker 7')).getByTestId('sync-connect')).toHaveAttribute('href', '/profile')
    expect(badge('Booker 8')).toHaveTextContent('Sync failed')
    expect(within(cell('Booker 8')).getByTestId('sync-problem')).toHaveTextContent('Shared Meet mode needs a link')
    expect(badge('Booker 9')).toHaveTextContent('Not synced (session over)')
    expect(badge('Booker 10')).toHaveTextContent('Not synced')
    // Retry on the failed one calls the RPC for THAT booking; the booking e-mail column and the other actions are untouched
    await user.click(within(cell('Booker 8')).getByTestId('sync-retry'))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('b-failed'))
    expect(await screen.findByText('Sync queued again.')).toBeInTheDocument()
    expect(within(cell('Booker 0')).queryByTestId('sync-retry')).toBeNull() // a synced booking has no Retry
  })

  it('Edit / Bookings (m63): shadow mode says nothing is sent to Google yet (and a worker that ran a minute ago is not called silent)', async () => {
    mocks.admin.mockImplementation(async () => ({ ...adminData(), bookings: manyBookings(['b-a']) }))
    mocks.calendar.mockResolvedValue(overview([ENTRY('b-a', 'shadow')], { mode: 'shadow' }))
    const user = userEvent.setup()
    const first = mount('edit')
    void first
    await screen.findAllByTestId('provider-row')
    await user.click(screen.getByTestId('tab-bookings'))
    expect(await screen.findByTestId('sync-banner-shadow')).toHaveTextContent('Shadow mode: the new sync only PLANS')
    expect(screen.queryByTestId('sync-banner-stale')).toBeNull() // the worker ran a minute ago
  })

  it('Edit / Bookings (m63): live with waiting jobs and a worker silent for 20 minutes is called out', async () => {
    mocks.admin.mockImplementation(async () => ({ ...adminData(), bookings: manyBookings(['b-a']) }))
    mocks.calendar.mockResolvedValue(overview([ENTRY('b-a', 'pending')], { mode: 'live', last_run_at: '2026-10-15T09:41:00Z' }))
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('provider-row')
    await user.click(screen.getByTestId('tab-bookings'))
    expect(await screen.findByTestId('sync-banner-stale')).toHaveTextContent('has not run for 20 minutes')
  })

  it('Edit / Bookings (m63): a worker that never reported a run is called out', async () => {
    mocks.admin.mockImplementation(async () => ({ ...adminData(), bookings: manyBookings(['b-a']) }))
    mocks.calendar.mockResolvedValue(overview([ENTRY('b-a', 'pending')], { mode: 'live', last_run_at: null }))
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('provider-row')
    await user.click(screen.getByTestId('tab-bookings'))
    expect(await screen.findByTestId('sync-banner-stale')).toHaveTextContent('has not reported a run yet')
  })

  it('Edit / Bookings (m63): mode off explains why nothing reaches Google', async () => {
    mocks.admin.mockImplementation(async () => ({ ...adminData(), bookings: manyBookings(['b-a']) }))
    mocks.calendar.mockResolvedValue(overview([ENTRY('b-a', 'off')], { mode: 'off' }))
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('provider-row')
    await user.click(screen.getByTestId('tab-bookings'))
    expect(await screen.findByTestId('sync-banner-off')).toHaveTextContent('Calendar sync is switched off')
    expect(screen.queryByTestId('sync-banner-shadow')).toBeNull()
  })

  it('Edit / Bookings (m63, Arabic): the states and the problems read in Arabic, the retry control keeps its 44 px height class', async () => {
    mocks.admin.mockImplementation(async () => ({ ...adminData(), bookings: manyBookings(['b-a', 'b-b']) }))
    mocks.calendar.mockResolvedValue(overview([ENTRY('b-a', 'failed', { code: 'invalid_timezone', job: { id: 'j', kind: 'calendar_create', status: 'dead', attempts: 1 } }), ENTRY('b-b', 'migrated', { migrated: true, event_id: 'abc12', calendar_email: 'startups@athareg.com' })], { mode: 'live' }))
    const user = userEvent.setup()
    mount('edit', {}, 'ar')
    await screen.findAllByTestId('provider-row')
    await user.click(screen.getByTestId('tab-bookings'))
    const rows = await screen.findAllByTestId('booking-row')
    const a = within(rows[0]).getByTestId('sync-cell')
    expect(within(a).getByTestId('sync-badge')).toHaveTextContent('فشلت المزامنة')
    expect(within(a).getByTestId('sync-problem')).toHaveTextContent('المنطقة الزمنية للمشروع ليست منطقة صالحة')
    expect(within(a).getByTestId('sync-retry').className).toContain('min-h-11')
    expect(within(within(rows[1]).getByTestId('sync-cell')).getByTestId('sync-badge')).toHaveTextContent('متزامن (مرحّل)')
    expect(within(within(rows[1]).getByTestId('sync-cell')).getByTestId('sync-open-calendar')).toHaveTextContent('فتح في Google Calendar')
  })

  it('Settings (m63): a project manager SEES the calendar sync mode and when the worker ran, but cannot change it', async () => {
    mocks.calMode.mockResolvedValue({ mode: 'shadow', can_set: false, last_run_at: new Date(Date.now() - 3 * 60_000).toISOString() })
    mount('settings')
    const card = await screen.findByTestId('sync-mode')
    expect(within(card).getByTestId('sync-mode-badge')).toHaveTextContent('Shadow')
    expect(within(card).getByTestId('sync-mode-help')).toHaveTextContent('plans every pending job')
    expect(within(card).getByTestId('sync-mode-lastrun')).toHaveTextContent(/The worker last ran/)
    expect(within(card).getByTestId('sync-mode-readonly')).toHaveTextContent('Only a super admin can change the mode.')
    expect(within(card).queryByTestId('sync-mode-switch')).toBeNull()
  })

  it('Settings (m63): the super admin switches the mode; going LIVE asks first (and says the Apps Script poller must be off), the others apply at once', async () => {
    mocks.calMode.mockResolvedValue({ mode: 'shadow', can_set: true, last_run_at: null })
    const user = userEvent.setup()
    mount('settings')
    const card = await screen.findByTestId('sync-mode')
    expect(within(card).getByTestId('sync-mode-lastrun')).toHaveTextContent('has not reported a run yet')
    const apply = within(card).getByTestId('sync-mode-apply')
    expect(apply).toBeDisabled() // nothing picked yet
    await user.click(within(card).getByTestId('sync-mode-live'))
    await user.click(apply)
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Switch the calendar sync to LIVE?')
    expect(dlg).toHaveTextContent('Apps Script poller')
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(mocks.setCalMode).not.toHaveBeenCalled()
    await user.click(apply)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mocks.setCalMode).toHaveBeenCalledWith('live'))
    expect(await screen.findByText('Calendar sync mode: Live.')).toBeInTheDocument()
    // off needs no confirmation
    await user.click(within(card).getByTestId('sync-mode-off'))
    await user.click(within(card).getByTestId('sync-mode-apply'))
    await waitFor(() => expect(mocks.setCalMode).toHaveBeenCalledWith('off'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Settings (m63): going live while jobs are being processed warns with the count the database reported', async () => {
    mocks.calMode.mockResolvedValue({ mode: 'shadow', can_set: true, last_run_at: null })
    mocks.setCalMode.mockResolvedValue({ mode: 'live', previous: 'shadow', in_flight: 3 })
    const user = userEvent.setup()
    mount('settings')
    const card = await screen.findByTestId('sync-mode')
    await user.click(within(card).getByTestId('sync-mode-live'))
    await user.click(within(card).getByTestId('sync-mode-apply'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/3 calendar jobs are being processed right now/)).toBeInTheDocument()
  })

  it('Settings: ONE save carries name + visibility + config + children.settings; shared mode without a link is blocked inline', async () => {
    const user = userEvent.setup()
    const adapter = mount('settings')
    await screen.findByTestId('booking-settings')
    expect(screen.getByTestId('who-can-book')).toHaveTextContent('Anyone with the link')
    await user.selectOptions(screen.getByTestId('settings-mode'), 'interview')
    expect(screen.getByTestId('who-can-book')).toHaveTextContent('Invited companies only')
    await user.click(screen.getByLabelText(/One shared link/))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Shared mode needs a link.')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('settings-shared-link'), { target: { value: 'https://meet.google.com/abc-defg-hij' } })
    await user.click(screen.getByLabelText(/Public \(anyone/))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    const saved = adapter.snapshot().nodes[0]
    expect(saved.visibility).toBe('public')
    expect(saved.children.settings).toMatchObject({ mode: 'interview', meeting_link_mode: 'shared', shared_meet_link: 'https://meet.google.com/abc-defg-hij', organizer_connection_id: null, default_advance_notice_min: 1440 })
    expect(saved.config.emails.booking_confirmation.subject).toContain('{{provider_name}}')
    expect(screen.getByTestId('settings-connection')).toHaveValue('')
  })

  it('Settings shows the REAL Google state of the acting user in the Calendar and E-mails sections (no more placeholder)', async () => {
    mount('settings')
    const calendar = await screen.findByTestId('settings-calendar')
    expect(await within(calendar).findByTestId('sender-notice')).toHaveAttribute('data-kind', 'fallback')
    expect(within(calendar).getByTestId('sender-notice')).toHaveTextContent('You have not connected Google: calendar events are created in the system calendar (')
    expect(within(calendar).getByRole('link', { name: 'Connect Google in your profile' })).toHaveAttribute('href', '/profile')
    const emails = screen.getByTestId('settings-emails')
    expect(within(emails).getByTestId('sender-notice')).toHaveAttribute('data-kind', 'fallback')
  })

  it('Settings: connected, needs-reconnect and nobody-can-send states of the acting user', async () => {
    mocks.google.mockImplementation(async () => ({ mine: { status: 'active', email: 'pm@athareg.com', scopes_ok: true }, system: null, effective: { source: 'user', email: 'pm@athareg.com', fallback: false, reason: null }, is_super_admin: false }))
    const first = mount('settings')
    void first
    const calendar = await screen.findByTestId('settings-calendar')
    expect(await within(calendar).findByTestId('sender-notice')).toHaveAttribute('data-kind', 'mine')
    expect(within(calendar).getByTestId('sender-notice')).toHaveTextContent('pm@athareg.com')
    expect(within(calendar).getByRole('link', { name: 'Google settings' })).toHaveAttribute('href', '/profile')
  })

  it('Settings: a stopped connection with no system sender says the e-mails wait in the outbox', async () => {
    mocks.google.mockImplementation(async () => ({ mine: { status: 'needs_reconnect', email: 'pm@athareg.com' }, system: null, effective: { source: null, email: null, fallback: false, reason: 'user_needs_reconnect_no_system' }, is_super_admin: false }))
    mount('settings')
    const emails = await screen.findByTestId('settings-emails')
    expect(await within(emails).findByTestId('sender-notice')).toHaveAttribute('data-kind', 'noneReconnect')
    expect(within(emails).getByTestId('sender-notice')).toHaveTextContent('e-mails wait in the outbox')
    expect(within(emails).getByRole('link', { name: 'Reconnect Google in your profile' })).toBeInTheDocument()
  })

  it('View: the PM preview renders the public page through the same component with booking disabled', async () => {
    mount('view')
    expect(await screen.findByTestId('booking-page')).toBeInTheDocument()
    expect(mocks.page).toHaveBeenCalledWith('bk1', { host: null, invite: null })
    expect(screen.getByText('Book a mentor')).toBeInTheDocument()
    expect(screen.getAllByTestId('day-pill')).toHaveLength(2)
  })

  it('Public page: slot -> details (prefilled for a signed-in founder) -> create_booking with the invitation token -> success without a Meet link', async () => {
    const user = userEvent.setup()
    mocks.page.mockImplementation(async () => pagePayload({ mode: 'interview', invitee: { item_id: 'li9', company_en: 'Nile Robotics', company_ar: '', name: 'Abdel Rahman Ali', email: 'ar@x.io' } }))
    await mountPublic('/book/bk1?invite=tok&lang=en')
    expect(await screen.findByTestId('booking-page')).toBeInTheDocument()
    expect(mocks.page).toHaveBeenCalledWith('bk1', { host: null, invite: 'tok' })
    await user.click(screen.getAllByTestId('day-pill')[0])
    await user.click(screen.getAllByTestId('slot-button')[0])
    const form = await screen.findByTestId('booking-form')
    expect(within(form).getByLabelText('Full name')).toHaveValue('Abdel Rahman Ali')
    expect(within(form).getByLabelText('E-mail')).toHaveValue('ar@x.io')
    expect(form).toHaveTextContent('Nile Robotics')
    await user.click(within(form).getByTestId('confirm-booking'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('bk1', 's1', { name: 'Abdel Rahman Ali', email: 'ar@x.io', lang: 'en' }, 'tok'))
    expect(await screen.findByTestId('booking-success')).toBeInTheDocument()
    expect(screen.getByTestId('meet-later')).toBeInTheDocument()
    expect(screen.getByText(/\?cancel=b9&token=tok123/)).toBeInTheDocument()
    // the booked slot must leave the list: the page payload is fetched again and the success card survives the refresh
    await waitFor(() => expect(mocks.page.mock.calls.length).toBeGreaterThan(1))
    expect(screen.getByTestId('booking-success')).toBeInTheDocument()
  })

  it('Public page: a server rejection (slot taken) is shown and the slot is released; invitation_required and the cancel link flow', async () => {
    const user = userEvent.setup()
    const { AppError } = await import('../../data/errors.js')
    const err = new AppError('validation', { messageKey: 'booking.err.slotUnavailable' })
    err.token = 'slot_unavailable'
    mocks.create.mockRejectedValueOnce(err)
    await mountPublic('/book/bk1?lang=en', auth)
    await screen.findByTestId('booking-page')
    await user.click(screen.getAllByTestId('slot-button')[0])
    const form = await screen.findByTestId('booking-form')
    expect(within(form).getByLabelText('Full name')).toHaveValue('Mona PM')
    expect(within(form).getByLabelText('E-mail')).toHaveValue('pm@x.io')
    await user.type(within(form).getByLabelText('Company'), 'Delta Farms')
    await user.click(within(form).getByTestId('confirm-booking'))
    expect(await screen.findByTestId('booking-error')).toHaveTextContent('This time was just taken')
    expect(mocks.create).toHaveBeenCalledWith('bk1', 's1', { name: 'Mona PM', email: 'pm@x.io', company_name: 'Delta Farms', lang: 'en' }, null)
    expect(screen.queryByTestId('booking-form')).not.toBeInTheDocument()
  })

  it('Public page: invitation_required state', async () => {
    mocks.page.mockImplementation(async () => ({ status: 'invitation_required', mode: 'interview', name_en: 'Interviews', config: {} }))
    await mountPublic('/book/bk2?lang=en')
    expect(await screen.findByText('A personal invitation is needed')).toBeInTheDocument()
  })

  it('Public page: the cancel link asks once then calls cancel_booking with the token', async () => {
    const user = userEvent.setup()
    await mountPublic('/book/bk1?cancel=b9&token=tok123&lang=en')
    const flow = await screen.findByTestId('cancel-flow')
    await user.click(within(flow).getByTestId('cancel-confirm'))
    await waitFor(() => expect(mocks.cancelPublic).toHaveBeenCalledWith('b9', 'tok123'))
    expect(await screen.findByText('Your booking was cancelled.')).toBeInTheDocument()
  })
})
