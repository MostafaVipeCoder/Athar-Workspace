import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../AuthContext.js'

const mocks = vi.hoisted(() => ({ list: vi.fn(), ensure: vi.fn(), enrollAccepted: vi.fn(), assign: vi.fn(), setStatus: vi.fn(), markAll: vi.fn(), companies: vi.fn(), withdraw: vi.fn() }))

vi.mock('../guards/ProjectAccess.jsx', () => ({ useProjectContext: () => ({ project: { id: 'P', name_en: 'Cohort A', program_id: 'G' }, projectId: 'P' }) }))
vi.mock('../../data/canvas.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useProjectGraph: (id) => useQuery({ queryKey: ['graph', id], queryFn: async () => ({ nodes: [{ id: 'S', type: 'selection', name_en: 'Final stage' }], edges: [] }) }) }
})
vi.mock('../../data/participants.js', async () => {
  const actual = await vi.importActual('../../data/participants.js')
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    ...actual,
    useParticipants: (id) => useQuery({ queryKey: ['participants', id], queryFn: async () => (await mocks.list(id)).map(actual.normalizeParticipant) }),
    useParticipantMutations: (id) => {
      const qc = useQueryClient()
      const after = () => qc.invalidateQueries({ queryKey: ['participants', id] })
      const materialize = async (p) => p.participantId ?? mocks.ensure(id, p.sourceNodeId, p.companyId, p.formResponseId)
      const useM = (fn) => useMutation({ mutationFn: fn, onSuccess: after })
      const m = useM
      return {
        setStatus: m(async ({ participant, status }) => mocks.setStatus(await materialize(participant), status)),
        enroll: m(({ participant }) => materialize(participant)),
        withdraw: m(async ({ participant, reason }) => mocks.withdraw(await materialize(participant), true, reason ?? null)),
        reinstate: m(async ({ participant }) => mocks.withdraw(await materialize(participant), false, null)),
        enrollAll: m(async ({ selectionNodeIds }) => { let n = 0; for (const s of selectionNodeIds) n += await mocks.enrollAccepted(id, s); return n }),
        assign: m(({ companyId }) => mocks.assign(id, companyId)),
        markAllAttended: m(async ({ selectionNodeIds }) => { for (const s of selectionNodeIds) await mocks.enrollAccepted(id, s); return mocks.markAll(id) }),
      }
    },
  }
})
vi.mock('../../data/people.js', async () => {
  const { useQuery, useMutation } = await import('@tanstack/react-query')
  return {
    useNetworkExperts: () => useQuery({ queryKey: ['experts'], queryFn: async () => [] }),
    useCompanies: () => useQuery({ queryKey: ['companies'], queryFn: () => mocks.companies() }),
    usePeopleMutations: () => ({ createCompany: useMutation({ mutationFn: async () => null }), createExpert: useMutation({ mutationFn: async () => null }) }),
  }
})
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn() }))

import ParticipantsPage from './ParticipantsPage.jsx'

const auth = { user: { id: 'u1' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const rows = () => [
  { participant_id: 'p1', virtual: false, source: 'manual', status: 'accepted', company_id: 'c1', user_id: null, form_response_id: null, source_node_id: null, needs_review: false, withdrawal_requested_at: null, created_at: '2026-10-01T00:00:00Z', email: 'a@x.io', display: { name_en: 'Alpha Co', name_ar: '', logo_path: 'c1/logo/a.webp' } },
  { participant_id: null, virtual: true, source: 'selection', status: 'accepted', company_id: null, user_id: null, form_response_id: 'r9', source_node_id: 'S', needs_review: false, withdrawal_requested_at: null, created_at: '2026-10-02T00:00:00Z', email: 'b@x.io', display: { name_en: 'Beta Startup', name_ar: '', logo_path: null } },
  { participant_id: 'p3', virtual: false, source: 'selection', status: 'withdrawn', company_id: null, user_id: null, form_response_id: 'r8', source_node_id: 'S', needs_review: true, withdrawal_requested_at: null, created_at: '2026-10-03T00:00:00Z', email: null, withdrawal_reason: 'left the cohort', display: { name_en: 'Gamma', name_ar: '', logo_path: null } },
]

function mount() {
  renderWithProviders(<AuthContext.Provider value={auth}><ConfirmProvider><ParticipantsPage /></ConfirmProvider></AuthContext.Provider>, { route: '/projects/P/participants?lang=en' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockImplementation(async () => rows())
  mocks.ensure.mockResolvedValue('new-p')
  mocks.enrollAccepted.mockResolvedValue(1)
  mocks.markAll.mockResolvedValue(2)
  mocks.assign.mockResolvedValue({ id: 'p4' })
  mocks.companies.mockResolvedValue([{ id: 'c1', kind: 'company', title: { en: 'Alpha Co', ar: '' }, subtitle: { en: '', ar: '' }, organization: { en: '', ar: '' }, bio: { en: '', ar: '' }, imagePath: null, links: [] }, { id: 'c2', kind: 'company', title: { en: 'Zeta Ltd', ar: '' }, subtitle: { en: '', ar: '' }, organization: { en: '', ar: '' }, bio: { en: '', ar: '' }, imagePath: null, links: [] }])
})

describe('ParticipantsPage', () => {
  it('lists enrolled and eligible (virtual) participants with source, stage link and flags; a status change on a virtual row enrols it first', async () => {
    const user = userEvent.setup()
    mount()
    const list = await screen.findAllByTestId('participant-row')
    expect(list).toHaveLength(3)
    expect(screen.getByTestId('participants-summary')).toHaveTextContent('2 accepted · 0 attended · 1 withdrawn')
    const beta = list.find((r) => within(r).queryByText('Beta Startup'))
    expect(within(beta).getByText('Eligible (not enrolled yet)')).toBeInTheDocument()
    expect(within(beta).getByRole('link', { name: 'Final stage' })).toHaveAttribute('href', '/projects/P/nodes/S/edit')
    expect(within(list.find((r) => within(r).queryByText('Gamma'))).getByText('No longer accepted upstream')).toBeInTheDocument()
    expect(within(list[0]).getByRole('link', { name: 'Company record' })).toHaveAttribute('href', '/network/companies/c1')
    await user.selectOptions(within(beta).getByRole('combobox', { name: /Status: Beta Startup/ }), 'attended')
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledWith('P', 'S', null, 'r9'))
    expect(mocks.setStatus).toHaveBeenCalledWith('new-p', 'attended')
  })

  it('mark all accepted as attended asks first, enrols the eligible stages, then calls the bulk RPC', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findAllByTestId('participant-row')
    await user.click(screen.getByTestId('mark-all'))
    const dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mocks.markAll).toHaveBeenCalledWith('P'))
    expect(mocks.enrollAccepted).toHaveBeenCalledWith('P', 'S')
    expect(await screen.findByText('2 marked as attended. Unmark the absentees below.')).toBeInTheDocument()
  })

  it('WITHDRAWN is an explicit action: confirmation with what happens + an optional reason, an Undo toast, "Reinstate" on a withdrawn row; the status select no longer offers it', async () => {
    const user = userEvent.setup()
    mount()
    const list = await screen.findAllByTestId('participant-row')
    const alpha = list[0]
    const select = within(alpha).getByRole('combobox', { name: /Status: Alpha Co/ })
    expect([...select.options].map((o) => o.value)).toEqual(['accepted', 'attended'])
    await user.click(within(alpha).getByTestId('participant-withdraw'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Mark "Alpha Co" as withdrawn?')
    expect(dlg).toHaveTextContent('disappear from every accepted or active list')
    await user.type(within(dlg).getByTestId('withdraw-reason'), '  closed the company ')
    await user.click(within(dlg).getByTestId('withdraw-confirm'))
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledWith('p1', true, 'closed the company'))
    expect(await screen.findByText('"Alpha Co" is marked as withdrawn.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' })) // Undo = reinstate
    await waitFor(() => expect(mocks.withdraw).toHaveBeenLastCalledWith('p1', false, null))
    // a withdrawn row: red chip, the reason, Reinstate (no status select, no Mark as withdrawn)
    const gamma = list.find((r) => within(r).queryByText('Gamma'))
    expect(within(gamma).getByTestId('status-withdrawn')).toHaveTextContent('Withdrawn')
    expect(within(gamma).getByTestId('participant-withdrawal-reason')).toHaveTextContent('Reason: left the cohort')
    expect(within(gamma).queryByRole('combobox')).toBeNull()
    expect(within(gamma).queryByTestId('participant-withdraw')).toBeNull()
    await user.click(within(gamma).getByTestId('participant-reinstate'))
    await waitFor(() => expect(mocks.withdraw).toHaveBeenLastCalledWith('p3', false, null))
  })

  it('withdrawing an eligible (not yet enrolled) applicant enrols it first, then records the withdrawal', async () => {
    const user = userEvent.setup()
    mount()
    const list = await screen.findAllByTestId('participant-row')
    const beta = list.find((r) => within(r).queryByText('Beta Startup'))
    await user.click(within(beta).getByTestId('participant-withdraw'))
    await user.click(within(await screen.findByRole('dialog')).getByTestId('withdraw-confirm'))
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledWith('P', 'S', null, 'r9'))
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledWith('new-p', true, null))
  })

  it('adds a company by reference through the picker (duplicate guard on companies already enrolled)', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findAllByTestId('participant-row')
    await user.click(screen.getByTestId('add-company'))
    const picker = await screen.findByRole('dialog')
    const results = await within(picker).findByTestId('picker-results')
    expect(within(results).getByText('Already in this list')).toBeInTheDocument()
    await user.click(within(results).getByRole('button', { name: 'Add: Zeta Ltd' }))
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('P', 'c2'))
    expect(await screen.findByText('Participant added.')).toBeInTheDocument()
  })
})
