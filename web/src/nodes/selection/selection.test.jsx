import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import ResultsTab from './ResultsTab.jsx'
import manifest from './manifest.js'

const rows = () => [
  { item_id: 'i1', source: { kind: 'form_response', id: 'r1', state: 'ok' }, display: { title_en: 'Nile Robotics', subtitle_en: 'Abdel Rahman Ali' }, contact: { email: 'f1@x.io' }, fields: { company_name: 'Nile Robotics', founder_name: 'Abdel Rahman Ali', q7: 'yes' }, overlay: {}, status: 'interview', sort_order: null, excluded: false, cursor: { s: 1, k: 'i1' } },
  { item_id: null, source: { kind: 'form_response', id: 'r2', state: 'ok' }, display: { title_en: 'Delta Farms', subtitle_en: 'Mona' }, contact: { email: 'f2@x.io' }, fields: { company_name: 'Delta Farms' }, overlay: {}, status: null, sort_order: null, excluded: false, cursor: { s: 9, k: 'r2' } },
  { item_id: 'i3', source: { kind: 'form_response', id: 'r3', state: 'ok' }, display: { title_en: 'Gone Co' }, contact: {}, fields: {}, overlay: { legacy_status: 'displayed' }, status: 'accepted', sort_order: null, excluded: false, cursor: { s: 2, k: 'i3' } },
]
const extras = () => ({
  reviews: [{ item_id: 'i3', reason: 'strong team', origin_stage: null, reviewed_at: '2026-10-01T10:00:00Z', reviewer_name: 'Mona' }],
  scores: [{ item_id: 'i1', reviewer_id: 'u2', reviewer_name: 'Omar', score: 4, note: 'ok' }],
  emails: [{ id: 'o1', item_id: 'i1', email_key: 'interview', status: 'sent', recipient: 'f1@x.io', created_at: '2026-10-01T10:00:00Z', sent_at: '2026-10-01T10:05:00Z' }],
  participants: [{ participant_id: 'p1', form_response_id: 'r3', company_id: null, status: 'attended', source: 'selection' }],
  booking: { node_id: 'B', name_en: 'Interviews', name_ar: '', slug: 'bk123' },
  enrolls: false, pm_name: 'Mona PM', program_name: { en: 'Prog', ar: '' }, project_name: { en: 'Proj', ar: '' },
})

// an applicant marked WITHDRAWN (m40): still in the stage ("interview"), flagged by the DB, with the PM-only reason
const withdrawnRow = () => ({ item_id: 'i4', source: { kind: 'form_response', id: 'r4', state: 'ok' }, display: { title_en: 'Wadi Labs', subtitle_en: 'Sara' }, contact: { email: 'f4@x.io' }, fields: {}, overlay: {}, status: 'interview', sort_order: null, excluded: false, withdrawn: true, withdrawal: { at: '2026-10-12T09:00:00Z', reason: 'left the program', source: 'participant' }, cursor: { s: 3, k: 'i4' } })

const mocks = vi.hoisted(() => ({ resolveList: vi.fn(), ensureItem: vi.fn(), patch: vi.fn(), setStatus: vi.fn(), exclude: vi.fn(), withdraw: vi.fn(), reinstate: vi.fn(), extras: vi.fn(), setScore: vi.fn(), send: vi.fn(), getDef: vi.fn(), google: vi.fn() }))

vi.mock('../../data/lists.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  const { normalizeListItem } = await import('../../lib/entities.js')
  const listItems = async (id, { filter = {}, kind = 'generic' } = {}) => {
    const all = (await mocks.resolveList(id)).map((r) => normalizeListItem(r, kind))
    const st = filter.status ? (Array.isArray(filter.status) ? filter.status : [filter.status]) : null
    return all.filter((i) => (!st || st.includes(i.status)) && (filter.include_excluded || !i.excluded) && (filter.include_withdrawn || !i.withdrawn))
  }
  const materializeItem = async (listId, item) => item.itemId ?? mocks.ensureItem(listId, item.source.kind, item.source.id)
  return {
    listItems, materializeItem,
    useListItems: (id, { filter = {}, kind } = {}, options = {}) => useQuery({ queryKey: ['node', id, 'items', filter], queryFn: () => listItems(id, { filter, kind }), ...options }),
    useListMutations: (id) => {
      const qc = useQueryClient()
      const after = () => qc.invalidateQueries({ queryKey: ['node', id] })
      const useM = (fn) => useMutation({ mutationFn: fn, onSuccess: after })
      const m = useM
      return {
        patchOverlay: m(async ({ item, patch }) => mocks.patch(await materializeItem(id, item), patch)),
        setStatus: m(async ({ item, status, reason = null }) => mocks.setStatus(await materializeItem(id, item), status, reason)),
        exclude: m(async ({ item, excluded }) => mocks.exclude(await materializeItem(id, item), excluded)),
        withdraw: m(async ({ item, reason = null }) => mocks.withdraw(await materializeItem(id, item), reason)),
        reinstate: m(async ({ item }) => mocks.reinstate(await materializeItem(id, item))),
        bulkWithdraw: m(async ({ items, reason = null }) => { for (const it of items) await mocks.withdraw(await materializeItem(id, it), reason) }),
        bulkReinstate: m(async ({ items }) => { for (const it of items) await mocks.reinstate(await materializeItem(id, it)) }),
        reorder: m(async () => null), addManual: m(async () => null), updateManual: m(async () => null), remove: m(async () => null), detach: m(async () => null), addNetworkPick: m(async () => null), addCompanyPick: m(async () => null),
        bulkStatus: m(async ({ items, status, reason = null }) => { for (const it of items) await mocks.setStatus(await materializeItem(id, it), status, reason) }),
        bulkExclude: m(async () => null),
      }
    },
  }
})
vi.mock('../../data/selection.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    useSelectionExtras: (id) => useQuery({ queryKey: ['node', id, 'selectionExtras'], queryFn: () => mocks.extras(id) }),
    useSelectionMutations: (id) => {
      const qc = useQueryClient()
      const after = () => qc.invalidateQueries({ queryKey: ['node', id] })
      return {
        setScore: useMutation({ mutationFn: ({ itemId, score, note }) => mocks.setScore(itemId, score, note), onSuccess: after }),
        send: useMutation({ mutationFn: (args) => mocks.send(id, args), onSuccess: after }),
      }
    },
  }
})
vi.mock('../../data/google.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useGoogleStatus: () => useQuery({ queryKey: ['google', 'status'], queryFn: () => mocks.google() }) }
})
vi.mock('../../data/forms.js', () => ({ getFormDefinition: (id) => mocks.getDef(id) }))
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn() }))

const googleFallback = () => ({ mine: null, system: { email: 'startups@athareg.com', status: 'active' }, effective: { source: 'system', email: 'startups@athareg.com', fallback: true, reason: 'user_not_connected' }, is_super_admin: false })
const auth = { user: { id: 'u1' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const node = { id: 'S', project_id: 'P', type: 'selection', type_version: 1, name_en: 'Stage 1', name_ar: 'المرحلة 1', visibility: 'private', show_to_participants: false, config: {}, rev: 1 }
const graph = {
  project: { id: 'P', timezone: 'Africa/Cairo' },
  nodes: [{ id: 'S', type: 'selection', name_en: 'Stage 1' }, { id: 'F', type: 'form_builder', name_en: 'Apply form' }, { id: 'B', type: 'booking', name_en: 'Interviews' }],
  edges: [{ from_node_id: 'F', from_port: 'responses', to_node_id: 'S', to_port: 'applicants', is_enabled: true }, { from_node_id: 'S', from_port: 'interview', to_node_id: 'B', to_port: 'bookers', is_enabled: true }],
}

function mount(mode, over = {}) {
  const adapter = createMemoryAdapter({ nodes: [{ ...node, ...over }], edges: graph.edges })
  renderWithProviders(
    <AuthContext.Provider value={auth}><ConfirmProvider><NodeHost mode={mode} node={{ ...node, ...over }} graph={graph} projectId="P" adapter={adapter} /></ConfirmProvider></AuthContext.Provider>,
    { route: '/projects/P/nodes/S?lang=en' },
  )
  return adapter
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveList.mockImplementation(async () => rows())
  mocks.extras.mockImplementation(async () => extras())
  mocks.google.mockImplementation(async () => googleFallback())
  mocks.ensureItem.mockResolvedValue('new-id')
  mocks.getDef.mockResolvedValue({ form: {}, sections: [], questions: [{ id: 'q1', key: 'company_name', type: 'text', semantic: 'company_name', label_en: 'Company' }, { id: 'q2', key: 'q7', type: 'text', semantic: null, label_en: 'Pitch ready?', label_ar: 'جاهز؟' }] })
  mocks.send.mockResolvedValue([{ item_id: 'i1', outbox_id: 'o2', status: 'queued', recipient: 'f1@x.io' }])
})

describe('Selection node', () => {
  it('manifest: every data port has a resolver and the results tab is contributed', () => {
    for (const k of ['approved', 'rejected', 'holding', 'interview', 'all']) expect(manifest.ports.out.find((p) => p.key === k).resolve).toBeTypeOf('function')
    expect(manifest.contributesViews[0].key).toBe('results-tab')
    expect(manifest.emails.map((e) => e.key)).toEqual(['acceptance', 'rejection', 'interview'])
  })

  it('resolvers filter the stage items by the configured statuses and keep the ORIGINAL source', async () => {
    const { resolveApproved, resolveAll } = await import('./data.js')
    const approved = await resolveApproved({ node })
    expect(approved.items.map((i) => i.source.id)).toEqual(['r3'])
    expect(approved.items[0].stage).toBe('accepted')
    expect((await resolveAll({ node })).items).toHaveLength(3)
  })

  it('Edit: board with stage pills, a never-touched applicant sits in the inbox, a decision asks for a reason and writes status + reason', async () => {
    const user = userEvent.setup()
    mount('edit')
    expect(await screen.findByText('Apply form')).toBeInTheDocument()
    expect(await screen.findByTestId('stage-screening')).toHaveTextContent('Screening (1)')
    expect(screen.getByTestId('stage-interview')).toHaveTextContent('Interview (1)')
    const rowsEl = await screen.findAllByTestId('item-row')
    expect(rowsEl).toHaveLength(3)
    const delta = rowsEl.find((r) => within(r).queryByText('Delta Farms'))
    expect(within(delta).getByRole('combobox', { name: /Status/ })).toHaveValue('screening')
    expect(within(rowsEl.find((r) => within(r).queryByText('Nile Robotics'))).getByText(/Interview invitation · Sent/)).toBeInTheDocument()
    await user.selectOptions(within(delta).getByRole('combobox', { name: /Status/ }), 'rejected')
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Move "Delta Farms" to Rejected')
    expect(within(dlg).getByTestId('reason-confirm')).toBeDisabled() // rejected requires a reason
    await user.type(within(dlg).getByLabelText('Reason'), 'out of scope')
    await user.click(within(dlg).getByTestId('reason-confirm'))
    await waitFor(() => expect(mocks.ensureItem).toHaveBeenCalledWith('S', 'form_response', 'r2'))
    expect(mocks.setStatus).toHaveBeenCalledWith('new-id', 'rejected', 'out of scope')
  })

  it('Edit: WITHDRAWN applicants stay on the board with a red chip OUTSIDE the stage counts; the "Withdrawn" pill narrows to them; the resolver default (consumers) never returns them', async () => {
    const user = userEvent.setup()
    mocks.resolveList.mockImplementation(async () => [...rows(), withdrawnRow()])
    mount('edit')
    await waitFor(() => expect(screen.getByTestId('stage-interview')).toHaveTextContent('Interview (1)')) // Nile only: Wadi is withdrawn
    expect(await screen.findByTestId('stage-withdrawn')).toHaveTextContent('Withdrawn (1)')
    expect(await screen.findAllByTestId('item-row')).toHaveLength(3) // the stage pills list the people still in the program, matching their counts
    await user.selectOptions(screen.getByTestId('presence-filter'), '') // ... and the PM can still see everybody
    const rowsEl = await screen.findAllByTestId('item-row')
    expect(rowsEl).toHaveLength(4)
    const wadi = rowsEl.find((r) => within(r).queryByText('Wadi Labs'))
    expect(within(wadi).getByTestId('withdrawn-chip')).toHaveTextContent('Withdrawn')
    expect(within(wadi).getByTestId('withdrawn-reason')).toHaveTextContent('Reason: left the program')
    expect(within(wadi).queryByTestId('withdraw')).toBeNull()
    await user.click(screen.getByTestId('stage-withdrawn'))
    await waitFor(() => expect(screen.getAllByTestId('item-row')).toHaveLength(1))
    expect(within(screen.getByTestId('item-row')).getByText('Wadi Labs')).toBeInTheDocument()
    const { listItems } = await import('../../data/lists.js')
    expect((await listItems('S', { filter: {} })).map((i) => i.source.id)).not.toContain('r4') // default = what the next steps get
    expect((await listItems('S', { filter: { include_withdrawn: true } })).map((i) => i.source.id)).toContain('r4')
  })

  it('Edit: "Mark as withdrawn" asks (what happens + an optional reason), materialises a virtual applicant, and its Undo reinstates', async () => {
    const user = userEvent.setup()
    mount('edit')
    const rowsEl = await screen.findAllByTestId('item-row')
    expect(screen.queryByTestId('stage-withdrawn')).toBeNull() // nobody withdrawn: no pill
    expect(screen.queryByRole('button', { name: /Hide/ })).toBeNull()
    const delta = rowsEl.find((r) => within(r).queryByText('Delta Farms'))
    await user.click(within(delta).getByTestId('withdraw'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Mark "Delta Farms" as withdrawn?')
    expect(dlg).toHaveTextContent('no e-mail is sent')
    await user.type(within(dlg).getByTestId('withdraw-reason'), 'not interested any more')
    await user.click(within(dlg).getByTestId('withdraw-confirm'))
    await waitFor(() => expect(mocks.ensureItem).toHaveBeenCalledWith('S', 'form_response', 'r2'))
    expect(mocks.withdraw).toHaveBeenCalledWith('new-id', 'not interested any more')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mocks.reinstate).toHaveBeenCalledWith('new-id'))
  })

  it('Edit: the drawer of a withdrawn applicant explains it, shows the reason and offers Reinstate; an active one offers Mark as withdrawn', async () => {
    const user = userEvent.setup()
    mocks.resolveList.mockImplementation(async () => [...rows(), withdrawnRow()])
    mount('edit')
    await screen.findAllByTestId('item-row')
    await user.click(await screen.findByTestId('stage-withdrawn'))
    await user.click(await screen.findByRole('button', { name: 'Wadi Labs' }))
    const drawer = await screen.findByTestId('applicant-drawer')
    expect(within(drawer).getByTestId('drawer-withdrawn')).toHaveTextContent('Withdrawn')
    expect(within(drawer).getByTestId('drawer-withdrawn-box')).toHaveTextContent('Reason: left the program')
    expect(screen.queryByTestId('drawer-withdraw')).toBeNull()
    await user.click(within(drawer).getByTestId('drawer-reinstate'))
    await waitFor(() => expect(mocks.reinstate).toHaveBeenCalledWith('i4'))
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0])
    await user.click(screen.getByRole('tab', { name: /^All stages/ }))
    await user.click(await screen.findByRole('button', { name: 'Delta Farms' }))
    expect(await screen.findByTestId('drawer-withdraw')).toBeInTheDocument()
  })

  it('Edit: the e-mails tab shows the REAL Google sender of the acting manager (own account, system fallback, nobody)', async () => {
    const user = userEvent.setup()
    mocks.google.mockImplementation(async () => ({ mine: { status: 'active', email: 'pm@athareg.com', scopes_ok: true }, system: { email: 'startups@athareg.com', status: 'active' }, effective: { source: 'user', email: 'pm@athareg.com', fallback: false, reason: null }, is_super_admin: false }))
    mount('edit')
    await screen.findAllByTestId('item-row')
    await user.click(screen.getByTestId('tab-emails'))
    const notice = await within(screen.getByTestId('emails-tab')).findByTestId('sender-notice')
    expect(notice).toHaveAttribute('data-kind', 'mine')
    expect(notice).toHaveTextContent('E-mails from this node are sent from your Google account (')
    expect(notice).toHaveTextContent('pm@athareg.com')
  })

  it('Edit: the e-mails tab leaves withdrawn applicants out of the recipients (and says so)', async () => {
    const user = userEvent.setup()
    mocks.resolveList.mockImplementation(async () => [...rows(), withdrawnRow()])
    mount('edit')
    await screen.findAllByTestId('item-row')
    await user.click(screen.getByTestId('tab-emails'))
    const tab = screen.getByTestId('emails-tab')
    expect(within(tab).getAllByTestId('recipient-row')).toHaveLength(1) // Nile only: Wadi (interview stage) is withdrawn
    expect(within(tab).getByTestId('withdrawn-left-out')).toHaveTextContent('1 withdrawn applicant of this stage is left out.')
  })

  it('Edit: the drawer shows labelled answers, the review, scores and e-mails; saving my score materialises first', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('item-row')
    await user.click(screen.getByRole('button', { name: 'Delta Farms' }))
    const drawer = await screen.findByTestId('applicant-drawer')
    expect(within(drawer).getByText('Pitch ready?')).toBeInTheDocument()
    expect(screen.getByTestId('open-source')).toHaveAttribute('href', '/projects/P/nodes/F/edit?tab=responses&response=r2')
    await user.click(within(drawer).getByRole('radio', { name: '5' }))
    await user.click(within(drawer).getByTestId('save-score'))
    await waitFor(() => expect(mocks.setScore).toHaveBeenCalledWith('new-id', 5, ''))
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0])
    await user.click(screen.getByRole('button', { name: 'Gone Co' }))
    const d2 = await screen.findByTestId('applicant-drawer')
    expect(within(d2).getByText('strong team')).toBeInTheDocument()
    expect(within(d2).getByText('Participant: Attended')).toBeInTheDocument()
    expect(within(d2).getByText('Was "displayed" before the migration')).toBeInTheDocument()
  })

  it('Edit: the e-mails tab previews a template with a sample applicant and sends to the selected recipients of the mapped stage', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('item-row')
    await user.click(screen.getByTestId('tab-emails'))
    const tab = screen.getByTestId('emails-tab')
    expect(within(tab).getByTestId('booking-info')).toHaveTextContent('Interviews')
    expect(within(tab).getByTestId('preview-subject')).toHaveTextContent('Interview Invitation: Nile Robotics')
    expect(within(tab).getByTestId('preview-body').innerHTML).toContain('Dear Abdel Rahman,')
    const recips = within(tab).getAllByTestId('recipient-row')
    expect(recips).toHaveLength(1) // only the interview stage
    expect(within(recips[0]).getByText(/Sent ×1/)).toBeInTheDocument()
    await user.click(within(tab).getByRole('button', { name: /Select all/ }))
    await user.click(within(tab).getByTestId('send-emails'))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('S', expect.objectContaining({ emailKey: 'interview', itemIds: ['i1'], lang: 'en', resend: false, confirm: false })))
    expect(await within(tab).findByText('queued')).toBeInTheDocument()
    expect(await screen.findByText('1 queued, 0 skipped, 0 without address.')).toBeInTheDocument()
  })

  it('Edit: template edits are saved as config in one save_node call and validated', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    await screen.findAllByTestId('item-row')
    await user.click(screen.getByTestId('tab-emails'))
    await user.click(screen.getByTestId('email-acceptance'))
    const subject = screen.getByTestId('tpl-subject')
    await user.clear(subject)
    await user.type(subject, 'Welcome {{{{company_name}} {{{{nope}}') // user-event escapes "{{" only
    await user.click(screen.getByTestId('save-templates'))
    expect(await screen.findByText(/placeholder that does not exist/)).toBeInTheDocument()
    expect(adapter.snapshot().nodes[0].rev).toBe(1)
    await user.clear(subject)
    await user.type(subject, 'Welcome {{{{company_name}}')
    await user.click(screen.getByTestId('save-templates'))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    expect(adapter.snapshot().nodes[0].config.emails.acceptance.subject).toBe('Welcome {{company_name}}')
    expect(adapter.snapshot().nodes[0].config.passing).toEqual(['accepted'])
  })

  it('View: previews the results tab with accepted applicants only', async () => {
    mount('view')
    const tab = await screen.findByTestId('results-tab')
    await waitFor(() => expect(within(tab).getAllByTestId('entity-card')).toHaveLength(1))
    expect(within(tab).getByText('Gone Co')).toBeInTheDocument()
  })

  it('Settings: saves name, the enrol toggle and the stage vocabulary in ONE save_node call', async () => {
    const user = userEvent.setup()
    const adapter = mount('settings')
    await screen.findByTestId('settings-stages')
    await user.click(screen.getByTestId('enroll-toggle'))
    await user.type(screen.getAllByLabelText('English')[0], ' B')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    const saved = adapter.snapshot().nodes[0]
    expect(saved.name_en).toBe('Stage 1 B')
    expect(saved.config.participantRule.onAccept).toBe('create_participant')
    expect(saved.config.stages.map((s) => s.key)).toEqual(['screening', 'interview', 'holding', 'accepted', 'rejected'])
    expect(saved.config.passing).toEqual(['accepted'])
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
  })
})

describe('ResultsTab (public payload contract)', () => {
  it('renders get_public_tab data of a selection branch with the card config', () => {
    const data = { items: [{ item_id: 'i3', source: { kind: 'form_response', id: 'r3', state: 'ok' }, display: { title_en: 'Gone Co', bio_en: 'b' } }], next: null, config: { kind: 'generic', card: { showFields: ['title'], accent: '#1a27c9' } } }
    renderWithProviders(<ResultsTab data={data} title="Accepted" audience="public" />, { route: '/agenda/x/accepted?lang=en' })
    const cards = screen.getAllByTestId('entity-card')
    expect(cards).toHaveLength(1)
    expect(within(cards[0]).queryByText('b')).toBeNull()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Accepted')
  })
})
