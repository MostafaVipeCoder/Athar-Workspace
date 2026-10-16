import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { getMessages } from '../../i18n/core.js'

const mocks = vi.hoisted(() => ({ list: vi.fn(), item: vi.fn(), counts: vi.fn(), health: vi.fn(), delivery: vi.fn(), retry: vi.fn(), cancel: vi.fn(), markSent: vi.fn(), resend: vi.fn(), sendNow: vi.fn() }))

vi.mock('../../data/outbox.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    useOutbox: (projectId, filter = {}) => useQuery({ queryKey: ['outbox', projectId, 'list', filter], queryFn: () => mocks.list(projectId, filter), enabled: Boolean(projectId) }),
    useOutboxCounts: (projectId) => useQuery({ queryKey: ['outbox', projectId, 'counts'], queryFn: () => mocks.counts(projectId), enabled: Boolean(projectId) }),
    useOutboxItem: (id) => useQuery({ queryKey: ['outbox', 'item', id], queryFn: () => mocks.item(id), enabled: Boolean(id) }),
    useEmailHealth: () => useQuery({ queryKey: ['emailHealth'], queryFn: () => mocks.health() }),
    useStaffInvitationDelivery: () => useQuery({ queryKey: ['staff', 'invitationDelivery'], queryFn: () => mocks.delivery() }),
    useOutboxMutations: () => {
      const qc = useQueryClient()
      const opts = { onSuccess: () => qc.invalidateQueries({ queryKey: ['outbox'] }) }
      return {
        retry: useMutation({ mutationFn: (o) => mocks.retry(o), ...opts }),
        cancel: useMutation({ mutationFn: (o) => mocks.cancel(o), ...opts }),
        markSent: useMutation({ mutationFn: (o) => mocks.markSent(o), ...opts }),
        resend: useMutation({ mutationFn: (o) => mocks.resend(o), ...opts }),
        sendNow: useMutation({ mutationFn: (o) => mocks.sendNow(o), ...opts }),
      }
    },
  }
})

const { OutboxPanel } = await import('./OutboxPanel.jsx')
const { NodeOutboxSummary } = await import('./NodeOutboxSummary.jsx')
const { EmailHealthPanel } = await import('./EmailHealthPanel.jsx')
const { OutboxStateBadge } = await import('./OutboxStateBadge.jsx')
const { default: InvitationsList } = await import('../../app/pages/staff/InvitationsList.jsx')

const NOW = '2026-10-15T10:00:00Z'
const row = (id, over = {}) => ({
  id, node_id: 'n1', node_name: { en: 'Stage 1', ar: 'المرحلة 1' }, node_type: 'selection', email_key: 'interview', recipient: `${id}@example.org`, cc: [], subject: `Subject ${id}`,
  state: 'sent', status: 'sent', blocked_reason: null, error_code: null, attempts: 1, send_attempt: 1, fail_streak: 0, created_at: '2026-10-15T09:55:00Z', next_attempt_at: '2026-10-15T09:55:00Z',
  sent_at: '2026-10-15T09:56:00Z', last_attempt_at: null, sender_email: 'pm@athareg.com', sender_source: 'user', message_id: `<${id}.1@athareg.com>`, resolution: null, resolved_at: null,
  created_by_name: 'Mona', list_item_id: null, booking_id: null, ...over,
})
const ROWS = [
  row('sent1'),
  row('failed1', { state: 'failed', status: 'failed', error_code: 'rejected_by_gmail', sent_at: null, message_id: null }),
  row('review1', { state: 'needs_review', status: 'needs_review', error_code: 'unknown_outcome', sent_at: null, message_id: null, sender_email: 'pm@athareg.com' }),
  row('blocked1', { state: 'blocked', status: 'queued', blocked_reason: 'rate_limited', sent_at: null, message_id: null, next_attempt_at: '2026-10-15T10:00:20Z' }),
  row('queued1', { state: 'queued', status: 'queued', sent_at: null, message_id: null, next_attempt_at: '2026-10-15T09:59:00Z' }),
  row('retrying1', { state: 'queued', status: 'queued', fail_streak: 2, error_code: 'server_error', sent_at: null, message_id: null, next_attempt_at: '2099-01-01T00:00:00Z' }),
]
const COUNTS = { sent: 1, failed: 1, needs_review: 1, blocked: 1, queued: 2 }
const listOf = (rows = ROWS, counts = COUNTS) => ({ total: rows.length, counts, rows })

function mount(ui, route = '/projects/p1/outbox?lang=en') {
  return renderWithProviders(<ConfirmProvider>{ui}</ConfirmProvider>, { route })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue(listOf())
  mocks.counts.mockResolvedValue({ counts: COUNTS, by_node: { n1: { sent: 12, queued: 2, blocked: 1, failed: 1 } }, attention: 3 })
  mocks.item.mockResolvedValue({ ...ROWS[2], body_html: '<p>Dear <b>Ali</b>, book here <a href="https://app.example/book/x?invite=tok">link</a></p><script>alert(1)</script>', events: [
    { at: '2026-10-15T09:55:00Z', event: 'queued', detail: null, attempt: null, status: 'queued', sender_email: null, actor_name: null },
    { at: '2026-10-15T09:56:00Z', event: 'send_started', detail: 'request sent to Gmail', attempt: 1, status: 'sending', sender_email: 'pm@athareg.com', actor_name: null },
    { at: '2026-10-15T09:56:15Z', event: 'needs_review', detail: 'google timeout', attempt: 1, status: 'needs_review', sender_email: 'pm@athareg.com', actor_name: null },
  ] })
  for (const k of ['retry', 'cancel', 'markSent', 'resend']) mocks[k].mockResolvedValue({ requested: 1, updated: 1, skipped: 0 })
  mocks.sendNow.mockResolvedValue({ released: 2, queued: 3, kicked: true })
})

describe('OutboxPanel', () => {
  it('lists every e-mail with its state word, the human explanation for what needs attention, and the filter counts', async () => {
    mount(<OutboxPanel projectId="p1" nodes={[{ id: 'n1', name: 'Stage 1' }]} />)
    const rows = await screen.findAllByTestId('outbox-row')
    expect(rows).toHaveLength(6)
    const by = (id) => rows.find((r) => r.dataset.id === id)
    expect(within(by('sent1')).getByTestId('row-state')).toHaveTextContent('Sent')
    expect(within(by('failed1')).getByTestId('row-state')).toHaveTextContent('Failed')
    expect(within(by('failed1')).getByTestId('row-explain')).toHaveTextContent('Gmail refused the message')
    expect(within(by('review1')).getByTestId('row-explain')).toHaveTextContent('could not confirm whether this was sent')
    expect(within(by('blocked1')).getByTestId('row-state')).toHaveTextContent('Waiting')
    expect(within(by('blocked1')).getByTestId('row-explain')).toHaveTextContent('30 e-mails a minute')
    expect(within(by('retrying1')).getByTestId('row-state')).toHaveTextContent('Queued')
    expect(by('retrying1')).toHaveTextContent('Google was busy: trying again')
    expect(screen.getByTestId('outbox-filter-failed')).toHaveTextContent('Failed (1)')
    expect(screen.getByTestId('outbox-filter-all')).toHaveTextContent('(6)')
    expect(screen.getByTestId('outbox-filter-attention')).toHaveTextContent('Needs attention (3)')
  })

  it('every state has its own icon AND its own word (colour is never the only signal)', () => {
    const { container } = mount(<div>{['queued', 'blocked', 'sending', 'sent', 'failed', 'needs_review', 'cancelled'].map((s) => <OutboxStateBadge key={s} state={s} />)}</div>)
    const badges = [...container.querySelectorAll('[data-state]')]
    expect(badges.map((b) => b.textContent)).toEqual(['Queued', 'Waiting', 'Sending', 'Sent', 'Failed', 'Needs review', 'Cancelled'])
    for (const b of badges) expect(b.querySelector('svg')).not.toBeNull()
  })

  it('a filter chip asks the server for that state; the search is passed on; the node filter too', async () => {
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" nodes={[{ id: 'n1', name: 'Stage 1' }]} />)
    await screen.findAllByTestId('outbox-row')
    await user.click(screen.getByTestId('outbox-filter-failed'))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith('p1', expect.objectContaining({ states: ['failed'], nodeId: null, search: '', limit: 50 })))
    await user.click(screen.getByTestId('outbox-filter-attention'))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith('p1', expect.objectContaining({ states: ['needs_review', 'failed', 'blocked'] })))
    await user.selectOptions(screen.getByTestId('outbox-node-filter'), 'n1')
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith('p1', expect.objectContaining({ nodeId: 'n1' })))
    await user.type(screen.getByRole('searchbox'), 'ali')
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith('p1', expect.objectContaining({ search: 'ali' })))
  })

  it('starts on the filter it is given (the link from a node: ?node=&state=attention)', async () => {
    mount(<OutboxPanel projectId="p1" nodes={[{ id: 'n1', name: 'Stage 1' }]} initial={{ node: 'n1', state: 'attention' }} />)
    await screen.findAllByTestId('outbox-row')
    expect(mocks.list).toHaveBeenCalledWith('p1', expect.objectContaining({ states: ['needs_review', 'failed', 'blocked'], nodeId: 'n1' }))
    expect(screen.getByTestId('outbox-filter-attention')).toHaveAttribute('aria-selected', 'true')
  })

  it('per-row retry calls the action with that id and says so', async () => {
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    const failed = (await screen.findAllByTestId('outbox-row')).find((r) => r.dataset.id === 'failed1')
    await user.click(within(failed).getByTestId('row-retry'))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith({ ids: ['failed1'] }))
    expect(await screen.findByText('1 updated.')).toBeInTheDocument()
  })

  it('bulk actions only count the rows that allow them; cancel and mark-as-sent ask for confirmation first, retry does not', async () => {
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    const rows = await screen.findAllByTestId('outbox-row')
    for (const id of ['sent1', 'failed1', 'review1', 'queued1']) await user.click(within(rows.find((r) => r.dataset.id === id)).getByRole('checkbox'))
    const bulk = screen.getByTestId('outbox-bulk')
    expect(bulk).toHaveTextContent('4 selected')
    expect(within(bulk).getByTestId('bulk-retry')).toHaveTextContent('Retry 2')        // failed + queued
    expect(within(bulk).getByTestId('bulk-mark-sent')).toHaveTextContent('Mark 2 as sent') // failed + needs_review
    expect(within(bulk).getByTestId('bulk-resend')).toHaveTextContent('Send 1 again')   // needs_review only
    expect(within(bulk).getByTestId('bulk-cancel')).toHaveTextContent('Cancel 3')       // failed + needs_review + queued (never the sent one)
    await user.click(within(bulk).getByTestId('bulk-retry'))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith({ ids: ['failed1', 'queued1'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mark as sent is confirmed (what it means is spelled out); declining does nothing', async () => {
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    const rows = await screen.findAllByTestId('outbox-row')
    await user.click(within(rows.find((r) => r.dataset.id === 'review1')).getByRole('checkbox'))
    await user.click(screen.getByTestId('bulk-mark-sent'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Mark 1 e-mail(s) as sent?')
    expect(dlg).toHaveTextContent('never send it again')
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(mocks.markSent).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('bulk-mark-sent'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mocks.markSent).toHaveBeenCalledWith({ ids: ['review1'] }))
  })

  it('send again warns that the first copy may already have arrived and uses its own button label', async () => {
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    const rows = await screen.findAllByTestId('outbox-row')
    await user.click(within(rows.find((r) => r.dataset.id === 'review1')).getByRole('checkbox'))
    await user.click(screen.getByTestId('bulk-resend'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('may already have reached the recipient')
    await user.click(within(dlg).getByRole('button', { name: 'Send again' }))
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledWith({ ids: ['review1'] }))
  })

  it('a partial result says how many were skipped', async () => {
    mocks.retry.mockResolvedValueOnce({ requested: 2, updated: 1, skipped: 1 })
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    const rows = await screen.findAllByTestId('outbox-row')
    await user.click(within(rows.find((r) => r.dataset.id === 'failed1')).getByTestId('row-retry'))
    expect(await screen.findByText('1 updated, 1 skipped (not allowed in their current state).')).toBeInTheDocument()
  })

  it('"Send now" appears while something waits, releases the rows and tells the person the worker was started', async () => {
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    await screen.findAllByTestId('outbox-row')
    await user.click(screen.getByTestId('outbox-send-now'))
    await waitFor(() => expect(mocks.sendNow).toHaveBeenCalledWith({ project: 'p1' }))
    expect(await screen.findByText(/Released 2 waiting e-mail\(s\)\. The platform is sending them now\./)).toBeInTheDocument()
  })

  it('no "Send now" when nothing waits', async () => {
    mocks.list.mockResolvedValue(listOf([row('sent1')], { sent: 1 }))
    mount(<OutboxPanel projectId="p1" />)
    await screen.findAllByTestId('outbox-row')
    expect(screen.queryByTestId('outbox-send-now')).toBeNull()
  })

  it('an empty outbox explains what will appear; an empty filter says nothing matches', async () => {
    mocks.list.mockResolvedValue(listOf([], {}))
    const { unmount } = mount(<OutboxPanel projectId="p1" />)
    expect(await screen.findByText('No e-mails yet')).toBeInTheDocument()
    unmount()
    mocks.list.mockResolvedValue(listOf([], { sent: 3 }))
    mount(<OutboxPanel projectId="p1" />)
    expect(await screen.findByText('No e-mail matches this filter.')).toBeInTheDocument()
  })

  it('a failed load shows an error with a retry button', async () => {
    mocks.list.mockRejectedValue(Object.assign(new Error('x'), { messageKey: 'errors.network', retryable: true }))
    mount(<OutboxPanel projectId="p1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The outbox could not be loaded')
  })

  it('"Show more" asks for the next page', async () => {
    mocks.list.mockResolvedValue({ total: 120, counts: COUNTS, rows: ROWS })
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    await user.click(await screen.findByTestId('outbox-more'))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith('p1', expect.objectContaining({ limit: 100 })))
  })

  it('Arabic: RTL-friendly texts, the same states, addresses stay left-to-right', async () => {
    mount(<OutboxPanel projectId="p1" />, '/projects/p1/outbox?lang=ar')
    const rows = await screen.findAllByTestId('outbox-row')
    expect(within(rows.find((r) => r.dataset.id === 'failed1')).getByTestId('row-state')).toHaveTextContent('فشلت')
    expect(within(rows.find((r) => r.dataset.id === 'review1')).getByTestId('row-explain')).toHaveTextContent('لم نستطع التأكد')
    expect(within(rows[0]).getByText('sent1@example.org')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByTestId('outbox-filter-failed')).toHaveTextContent('فشلت')
  })
})

describe('OutboxDetail (opened from a row)', () => {
  it('needs review: the explanation, the Message-ID and the Gmail search to check the Sent folder, the sanitised message, the history; actions per state', async () => {
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    const rows = await screen.findAllByTestId('outbox-row')
    await user.click(within(rows.find((r) => r.dataset.id === 'review1')).getByTestId('row-details'))
    const d = await screen.findByTestId('outbox-detail')
    expect(await within(d).findByTestId('detail-explain')).toHaveTextContent('NOT sent again')
    expect(within(d).getByTestId('gmail-search')).toHaveTextContent('rfc822msgid:review1.1@athareg.com')
    const body = await within(d).findByTestId('detail-body')
    expect(body).toHaveTextContent('Dear Ali')
    expect(body.innerHTML).not.toContain('<script')
    const tl = await within(d).findByTestId('detail-timeline')
    expect(within(tl).getAllByRole('listitem')).toHaveLength(3)
    expect(tl).toHaveTextContent('Outcome unknown: needs review')
    expect(screen.getByTestId('detail-mark-sent')).toBeInTheDocument()
    expect(screen.getByTestId('detail-resend')).toBeInTheDocument()
    expect(screen.getByTestId('detail-cancel')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-retry')).toBeNull()
    await user.click(screen.getByTestId('detail-mark-sent'))
    await user.click(within(await screen.findByRole('dialog', { name: /Mark 1 e-mail/ })).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mocks.markSent).toHaveBeenCalledWith({ ids: ['review1'] }))
  })

  it('a message whose text was removed says why instead of showing an empty box', async () => {
    mocks.item.mockResolvedValue({ ...ROWS[0], body_html: null, events: [] })
    const user = userEvent.setup()
    mount(<OutboxPanel projectId="p1" />)
    const rows = await screen.findAllByTestId('outbox-row')
    await user.click(within(rows.find((r) => r.dataset.id === 'sent1')).getByTestId('row-details'))
    expect(await screen.findByTestId('detail-body-gone')).toHaveTextContent('no longer stored')
  })
})

describe('NodeOutboxSummary', () => {
  it('"12 sent, 3 on the way, 2 need attention": a link into the Outbox filtered to this node and to what needs attention, and "Send waiting e-mails now"', async () => {
    const user = userEvent.setup()
    mount(<NodeOutboxSummary projectId="p1" nodeId="n1" />)
    const box = await screen.findByTestId('node-outbox')
    expect(within(box).getByTestId('node-outbox-line')).toHaveTextContent('12 sent, 2 on the way, 2 need attention')
    expect(box).toHaveAttribute('data-attention', '2')
    expect(within(box).getByTestId('node-outbox-open')).toHaveAttribute('href', '/projects/p1/outbox?node=n1&state=attention')
    await user.click(within(box).getByTestId('node-outbox-send-now'))
    await waitFor(() => expect(mocks.sendNow).toHaveBeenCalledWith({ project: 'p1' }))
  })
  it('nothing sent yet says so; no attention links to the plain Outbox; an unreadable count shows nothing', async () => {
    mocks.counts.mockResolvedValue({ counts: {}, by_node: {}, attention: 0 })
    const { unmount } = mount(<NodeOutboxSummary projectId="p1" nodeId="n1" />)
    expect(await screen.findByTestId('node-outbox-none')).toHaveTextContent('Nothing sent from here yet.')
    unmount()
    mocks.counts.mockResolvedValue({ counts: { sent: 2 }, by_node: { n1: { sent: 2 } }, attention: 0 })
    const { unmount: u2 } = mount(<NodeOutboxSummary projectId="p1" nodeId="n1" />)
    expect(await screen.findByTestId('node-outbox-open')).toHaveAttribute('href', '/projects/p1/outbox?node=n1')
    expect(screen.queryByTestId('node-outbox-send-now')).toBeNull()
    u2()
    mocks.counts.mockRejectedValue(new Error('boom'))
    const { container } = mount(<NodeOutboxSummary projectId="p1" nodeId="n1" />)
    await waitFor(() => expect(mocks.counts).toHaveBeenCalled())
    expect(container.querySelector('[data-testid]')).toBeNull()
  })
})

describe('EmailHealthPanel (super_admin)', () => {
  const HEALTH = {
    queue: { depth: 7, ready: 3, waiting: 1, blocked: 2, sending: 1, needs_review: 1, oldest_queued_at: '2026-10-15T09:00:00Z', oldest_age_seconds: 3600 },
    last_24h: { sent: 40, failed: 2, needs_review: 1 },
    blocked_by_reason: { rate_limited: 2 },
    senders: [
      { id: 's1', email: 'startups@athareg.com', kind: 'system', status: 'active', last_error: null, queued: 1, blocked: 0, sent_24h: 30, failed_24h: 0, started_1m: 15, started_24h: 300, last_used_at: null },
      { id: 's2', email: 'pm@athareg.com', kind: 'user', status: 'needs_reconnect', last_error: 'invalid_grant', queued: 6, blocked: 2, sent_24h: 10, failed_24h: 2, started_1m: 0, started_24h: 12, last_used_at: null },
    ],
    worker: { last_run_at: '2026-10-15T09:59:30Z', age_seconds: 30, summary: { sent: 5, failed: 0, needs_review: 0, held: 2 }, scheduler_enabled: true, cron_scheduled: true },
    now: NOW,
  }
  it('the worker is running: queue tiles, last 24 h, why mail is held back, each sender against its two limits', async () => {
    mocks.health.mockResolvedValue(HEALTH)
    mount(<EmailHealthPanel />, '/admin/email?lang=en')
    const wk = await screen.findByTestId('health-worker')
    expect(wk).toHaveAttribute('data-health', 'ok')
    expect(wk).toHaveTextContent('The worker ran 30 seconds')
    expect(within(wk).getByTestId('health-scheduler')).toHaveTextContent('Scheduler on')
    expect(screen.getByTestId('tile-depth')).toHaveTextContent('7')
    expect(screen.getByTestId('tile-blocked')).toHaveTextContent('2')
    expect(screen.getByTestId('tile-oldest')).toHaveTextContent('60 minutes')
    expect(screen.getByTestId('tile-24-failed')).toHaveTextContent('2')
    expect(screen.getByTestId('health-blocked')).toHaveTextContent('30 e-mails a minute')
    const senders = screen.getAllByTestId('health-sender')
    expect(senders).toHaveLength(2)
    expect(senders[0]).toHaveTextContent('System sender')
    expect(within(senders[0]).getByRole('meter', { name: 'Last minute' })).toHaveAttribute('aria-valuenow', '50')
    expect(within(senders[0]).getByRole('meter', { name: 'Last 24 h' })).toHaveAttribute('aria-valuenow', '20')
    expect(senders[1]).toHaveTextContent('Needs reconnecting')
  })
  it('the scheduler is off, or the worker is silent while mail waits: it says so and what to do', async () => {
    mocks.health.mockResolvedValue({ ...HEALTH, worker: { last_run_at: '2026-10-15T08:00:00Z', age_seconds: 7200, summary: {}, scheduler_enabled: false, cron_scheduled: false } })
    mount(<EmailHealthPanel />, '/admin/email?lang=en')
    const wk = await screen.findByTestId('health-worker')
    expect(wk).toHaveAttribute('data-health', 'stalled')
    expect(wk).toHaveTextContent('has not run for 2 hours')
    expect(screen.getByTestId('health-scheduler-off')).toHaveTextContent('email-worker-schedule.sh enable')
  })
  it('Arabic', async () => {
    mocks.health.mockResolvedValue(HEALTH)
    mount(<EmailHealthPanel />, '/admin/email?lang=ar')
    expect(await screen.findByTestId('health-worker')).toHaveTextContent('عمل العامل')
    expect(screen.getAllByTestId('health-sender')[1]).toHaveTextContent('يحتاج إعادة ربط')
  })
})

describe('staff invitations: the delivery state of the e-mail', () => {
  const query = (data) => ({ isError: false, data, refetch: vi.fn() })
  const INV = { id: 'i1', email: 'new@athareg.com', roles: ['project_manager'], program_ids: [], status: 'pending', expires_at: '2099-01-01T00:00:00Z' }
  const DEL = (over) => ({ invitation_id: 'i1', outbox_id: 'o1', state: 'sent', status: 'sent', blocked_reason: null, error_code: null, attempts: 1, sent_at: NOW, sender_email: 'startups@athareg.com', ...over })
  it('sent: shows who sent it; failed: a plain reason, "the link above still works" and a retry button that retries the outbox row', async () => {
    const user = userEvent.setup()
    mocks.delivery.mockResolvedValue([DEL()])
    const { unmount } = mount(<InvitationsList query={query([INV])} programName={() => ''} onRevoke={vi.fn()} />, '/admin/staff?lang=en')
    expect(await screen.findByTestId('invitation-delivery-state')).toHaveTextContent('Sent')
    expect(screen.getByTestId('invitation-delivery')).toHaveTextContent('sent from startups@athareg.com')
    expect(screen.queryByTestId('invitation-retry-mail')).toBeNull()
    unmount()
    mocks.delivery.mockResolvedValue([DEL({ state: 'failed', status: 'failed', error_code: 'rejected_by_gmail', sent_at: null })])
    mount(<InvitationsList query={query([INV])} programName={() => ''} onRevoke={vi.fn()} />, '/admin/staff?lang=en')
    expect(await screen.findByTestId('invitation-delivery-why')).toHaveTextContent('Gmail refused the message')
    expect(screen.getByTestId('invitation-delivery-why')).toHaveTextContent('still works')
    await user.click(screen.getByTestId('invitation-retry-mail'))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith({ ids: ['o1'] }))
  })
  it('an unknown outcome is sent again only after a confirmation', async () => {
    const user = userEvent.setup()
    mocks.delivery.mockResolvedValue([DEL({ state: 'needs_review', status: 'needs_review', error_code: 'unknown_outcome', sent_at: null })])
    mount(<InvitationsList query={query([INV])} programName={() => ''} onRevoke={vi.fn()} />, '/admin/staff?lang=en')
    await user.click(await screen.findByTestId('invitation-retry-mail'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('second copy')
    expect(mocks.resend).not.toHaveBeenCalled()
    await user.click(within(dlg).getByRole('button', { name: 'Send again' }))
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledWith({ ids: ['o1'] }))
  })
  it('no chip for an accepted invitation, nothing breaks when the delivery list cannot be read', async () => {
    mocks.delivery.mockRejectedValue(new Error('forbidden'))
    mount(<InvitationsList query={query([INV, { ...INV, id: 'i2', status: 'accepted' }])} programName={() => ''} onRevoke={vi.fn()} />, '/admin/staff?lang=en')
    await waitFor(() => expect(mocks.delivery).toHaveBeenCalled())
    expect(screen.getAllByText('new@athareg.com')).toHaveLength(2)
    expect(screen.queryByTestId('invitation-delivery')).toBeNull()
  })
})

describe('translations', () => {
  it('every outbox key exists in English AND Arabic, and every placeholder of a sentence appears in both', () => {
    const en = Object.entries(getMessages('en')).filter(([k]) => k.startsWith('outbox.'))
    const ar = getMessages('ar')
    expect(en.length).toBeGreaterThan(150)
    const missing = en.filter(([k]) => typeof ar[k] !== 'string').map(([k]) => k)
    expect(missing).toEqual([])
    const arOnly = Object.keys(ar).filter((k) => k.startsWith('outbox.') && typeof getMessages('en')[k] !== 'string')
    expect(arOnly).toEqual([])
    const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    const mismatched = en.filter(([k, v]) => vars(v) !== vars(ar[k])).map(([k]) => k)
    expect(mismatched).toEqual([])
  })
  it('every state, blocked reason and error code the logic knows has a sentence', async () => {
    const { ALL_STATES, BLOCKED_REASONS, ERROR_CODES, EVENT_KEYS } = await import('../../lib/outbox.js')
    const en = getMessages('en')
    for (const s of ALL_STATES) expect(en[`outbox.state.${s}`], s).toBeTruthy()
    for (const r of BLOCKED_REASONS) expect(en[`outbox.blocked.${r}`], r).toBeTruthy()
    for (const c of ERROR_CODES) expect(en[`outbox.error.${c}`], c).toBeTruthy()
    for (const e of EVENT_KEYS) expect(en[`outbox.event.${e}`], e).toBeTruthy()
    for (const k of ['acceptance', 'rejection', 'interview', 'booking_confirmation', 'booking_cancellation', 'form_new_response', 'staff_invitation', 'other']) expect(en[`outbox.key.${k}`], k).toBeTruthy()
  })
})
