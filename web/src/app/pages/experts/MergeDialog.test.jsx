import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { normalizeCandidate, normalizeProfile, normalizeRegistryRow } from '../../../lib/experts.js'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), preview: vi.fn(), merge: vi.fn(), similar: { data: [] }, registry: vi.fn(), onClose: vi.fn(), onDone: vi.fn() }))
vi.mock('../../../data/people.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { useQuery } = await import('@tanstack/react-query')
  return {
    ...actual,
    useExpertProfile: (id) => useQuery({ queryKey: ['experts', 'profile', id], queryFn: () => mocks.profile(id), enabled: Boolean(id), retry: false }),
    useExpertActions: () => ({ merge: { mutateAsync: mocks.merge, isPending: false } }),
    useSimilarExperts: () => mocks.similar,
    useExpertRegistry: (state) => useQuery({ queryKey: ['experts', 'registry', state], queryFn: () => mocks.registry(state) }),
    previewMerge: (...a) => mocks.preview(...a),
  }
})
vi.mock('../../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn(), removeImage: vi.fn() }))

import MergeDialog from './MergeDialog.jsx'

const base = (id, over = {}) => ({
  expert: { id, kind: 'expert', name_en: null, name_ar: null, title_en: null, title_ar: null, company_en: null, company_ar: null, bio_en: null, bio_ar: null, photo_path: null, linkedin_url: null, website_url: null, links: [], email: null, phone: null, languages: [], notes: null, archived_at: null, deleted_at: null, merged_into: null, created_at: '2026-01-01T00:00:00Z', updated_at: 'T', ...over },
  tags: [], totals: { programs: 1, projects: 1, lists: 1, booking_sessions: 0, distribution_sessions: 0, sessions: 0 }, participation: [], hidden: { engagements: 0 }, can: { edit: true },
})
const KEEP = normalizeProfile(base('k1', { name_en: 'Osama Nageeb', title_en: 'Founder', linkedin_url: 'https://l/in/o' }))
const DROP = normalizeProfile(base('d1', { name_en: 'أسامة نجيب', company_en: 'Bosla', linkedin_url: 'https://l/in/o', email: 'o@x.io', photo_path: 'global/expert-photo/d.webp' }))
const impact = { list_items: 3, items_moved: 2, items_collapsed: 1, projects: 2, booking_providers: 1, booking_sessions: 4, distribution_sessions: 7, tags_added: 2 }
const previewOk = { dry_run: true, blocked: false, blockers: [], impact }

function mount(props) {
  return renderWithProviders(
    <Routes>
      <Route path="/network/experts/*" element={<MergeDialog base="/network/experts" onClose={mocks.onClose} onDone={mocks.onDone} {...props} />} />
      <Route path="/network/experts/k1" element={<p data-testid="landed">kept profile</p>} />
    </Routes>,
    { route: '/network/experts?lang=en' },
  )
}
const pairProps = () => ({ pair: { a: { id: 'k1' }, b: { id: 'd1' } } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.similar = { data: [] }
  mocks.profile.mockImplementation(async (id) => ({ k1: KEEP, d1: DROP }[id]))
  mocks.preview.mockResolvedValue(previewOk)
  mocks.merge.mockResolvedValue({ merged: true, keep_id: 'k1' })
  mocks.registry.mockResolvedValue({ rows: [], total: 0 })
})

describe('Merge dialog: compare, choose, preview, confirm', () => {
  it('shows both records, the fields where they differ with a choice, the filled-in ones, and the DRY-RUN impact', async () => {
    mount(pairProps())
    const compare = await screen.findByTestId('merge-compare')
    expect(within(compare).getByRole('region', { name: 'Record to keep' })).toBeInTheDocument()
    expect(within(compare).getByRole('region', { name: 'Duplicate to merge in' })).toBeInTheDocument()
    const nameRow = within(compare).getByTestId('merge-row-name_en')
    expect(within(nameRow).getAllByRole('radio')).toHaveLength(2) // both sides filled and different: a choice
    expect(within(nameRow).getByLabelText('Name (English): Record to keep')).toBeChecked()
    const companyRow = within(compare).getByTestId('merge-row-company_en')
    expect(within(companyRow).queryAllByRole('radio')).toHaveLength(0) // only the duplicate has it: it simply survives
    expect(within(companyRow).getByText('Bosla')).toBeInTheDocument()
    expect(within(compare).queryByTestId('merge-row-linkedin_url')).not.toBeNull()
    const box = await within(compare).findByTestId('merge-impact')
    await waitFor(() => expect(within(box).getByText(/List entries moved to the kept record: 2 \(projects involved: 2\)/)).toBeInTheDocument())
    expect(within(box).getByText('Entries found in both records and combined into one: 1')).toBeInTheDocument()
    expect(within(box).getByText('Sessions that stay attached to the person: booking 4, mentoring 7')).toBeInTheDocument()
    expect(within(box).getByText(/merged into the kept record and hidden from the registry/)).toBeInTheDocument()
    expect(mocks.preview).toHaveBeenCalledWith('k1', 'd1', {})
  })

  it('choosing the duplicate\'s value changes the preview call; the merge itself needs the confirmation box and sends the same choices', async () => {
    const user = userEvent.setup()
    mount(pairProps())
    const compare = await screen.findByTestId('merge-compare')
    const run = within(screen.getByRole('dialog')).getByTestId('merge-run')
    expect(run).toBeDisabled() // not confirmed yet
    await user.click(within(within(compare).getByTestId('merge-row-name_en')).getByLabelText('Name (English): Duplicate to merge in'))
    await waitFor(() => expect(mocks.preview).toHaveBeenLastCalledWith('k1', 'd1', { name_en: 'drop' }))
    await user.click(within(compare).getByTestId('merge-understood'))
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    await waitFor(() => expect(mocks.merge).toHaveBeenCalledWith({ keepId: 'k1', dropId: 'd1', fields: { name_en: 'drop' } }))
    expect(mocks.onDone).toHaveBeenCalledWith('k1')
    expect(mocks.onClose).toHaveBeenCalled()
    expect(await screen.findByTestId('landed')).toBeInTheDocument()
  })

  it('a BLOCKER from the dry run is explained and the merge button stays disabled even when confirmed', async () => {
    const user = userEvent.setup()
    mocks.preview.mockResolvedValue({ ...previewOk, blocked: true, blockers: ['withdrawn_mismatch', 'mentor_slot_conflict'] })
    mount(pairProps())
    const blockers = await screen.findByTestId('merge-blockers')
    expect(within(blockers).getByText(/withdrawn in one record and active in the other within the same project/)).toBeInTheDocument()
    expect(within(blockers).getByText(/mentor in the same mentoring slot/)).toBeInTheDocument()
    await user.click(screen.getByTestId('merge-understood'))
    expect(screen.getByTestId('merge-run')).toBeDisabled()
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('"Keep the other one" swaps the direction: the preview is asked the other way round and the choices reset', async () => {
    const user = userEvent.setup()
    mount(pairProps())
    await screen.findByTestId('merge-compare')
    await user.click(screen.getByTestId('merge-swap'))
    await waitFor(() => expect(mocks.preview).toHaveBeenLastCalledWith('d1', 'k1', {}))
    expect(screen.getByTestId('merge-run')).toHaveTextContent('Merge Osama Nageeb into أسامة نجيب')
  })

  it('a refusal of the server is shown inside the dialog (nothing is lost, nothing half done)', async () => {
    const user = userEvent.setup()
    mocks.merge.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', messageKey: 'experts.err.mergeBlocked', token: 'expert_merge_blocked' }))
    mount(pairProps())
    await screen.findByTestId('merge-compare')
    await user.click(screen.getByTestId('merge-understood'))
    await waitFor(() => expect(screen.getByTestId('merge-run')).toBeEnabled())
    await user.click(screen.getByTestId('merge-run'))
    expect(await screen.findByText('The merge is blocked. Fix the points shown in the dialog.')).toBeInTheDocument()
    expect(mocks.onClose).not.toHaveBeenCalled()
  })
})

describe('Merge dialog: choosing the other record', () => {
  it('opened from a profile: suggestions with their reasons first, then a search; picking one goes to the comparison', async () => {
    const user = userEvent.setup()
    mocks.similar = { data: [normalizeCandidate({ id: 'd1', score: 1, reasons: ['same_linkedin'], blocking: true, expert: { id: 'd1', name_en: 'أسامة نجيب', title_en: 'Founder' } })] }
    mocks.registry.mockResolvedValue({ total: 1, rows: [normalizeRegistryRow({ id: 'x9', kind: 'expert', name_en: 'Somebody Else' })] })
    mount({ initialKeep: KEEP })
    const picker = await screen.findByTestId('merge-picker')
    expect(within(picker).getByText('Suggested')).toBeInTheDocument()
    expect(within(picker).getByText('Same LinkedIn profile')).toBeInTheDocument()
    await user.type(within(picker).getByRole('searchbox'), 'some')
    expect(await within(picker).findByRole('button', { name: /Somebody Else/ }, { timeout: 4000 })).toBeInTheDocument()
    await user.click(within(picker).getByRole('button', { name: /أسامة نجيب/ }))
    expect(await screen.findByTestId('merge-compare')).toBeInTheDocument()
    expect(mocks.preview).toHaveBeenCalledWith('k1', 'd1', {})
  })
})
