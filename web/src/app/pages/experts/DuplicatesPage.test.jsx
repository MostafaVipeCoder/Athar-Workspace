import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { normalizePair } from '../../../lib/experts.js'

const mocks = vi.hoisted(() => ({ pairs: vi.fn(), dismiss: vi.fn() }))
vi.mock('../../../data/people.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { useQuery } = await import('@tanstack/react-query')
  return {
    ...actual,
    useDuplicatePairs: () => useQuery({ queryKey: ['experts', 'pairs'], queryFn: async () => { const r = await mocks.pairs(); return { pairs: r.pairs.map(normalizePair), dismissed: r.dismissed } } }),
    useExpertActions: () => ({ dismiss: { mutateAsync: mocks.dismiss }, merge: { mutateAsync: vi.fn(), isPending: false } }),
    useExpertProfile: () => ({ isPending: true }),
  }
})
vi.mock('../../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn(), removeImage: vi.fn() }))

import DuplicatesPage from './DuplicatesPage.jsx'

const PAIR = (over = {}) => ({
  score: 1, reasons: ['same_linkedin', 'same_name_translit'],
  a: { id: 'a1', kind: 'expert', name_en: 'Osama Nageeb', title_en: 'Founder', photo_path: 'global/expert-photo/a.webp' },
  b: { id: 'b1', kind: 'expert', name_en: 'أسامة نجيب', title_en: null, company_en: 'Bosla' }, ...over,
})

function mount(route = '/network/experts/duplicates?lang=en') {
  return renderWithProviders(<Routes><Route path="/network/experts/duplicates" element={<DuplicatesPage />} /></Routes>, { route })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pairs.mockResolvedValue({ pairs: [PAIR(), PAIR({ score: 0.85, reasons: ['same_name_translit'], a: { id: 'a2', name_en: 'Mohamed Elbehery' }, b: { id: 'b2', name_en: 'محمد البحيري' } })], dismissed: 2 })
  mocks.dismiss.mockResolvedValue({ dismissed: true })
})

describe('Probable duplicates page (super_admin)', () => {
  it('lists each pair side by side with the reasons, the match score and a way to open each record', async () => {
    mount()
    const list = await screen.findByTestId('duplicate-pairs')
    const pairs = within(list).getAllByTestId('duplicate-pair')
    expect(pairs).toHaveLength(2)
    expect(within(pairs[0]).getByRole('link', { name: /Osama Nageeb/ })).toHaveAttribute('href', '/network/experts/a1')
    expect(within(pairs[0]).getByRole('link', { name: /أسامة نجيب/ })).toHaveAttribute('href', '/network/experts/b1')
    expect(within(pairs[0]).getByText('Same LinkedIn profile')).toBeInTheDocument()
    expect(within(pairs[0]).getByText('Same name in another script')).toBeInTheDocument()
    expect(within(pairs[0]).getByText('Match 100%')).toBeInTheDocument()
    expect(within(pairs[1]).getByText('Match 85%')).toBeInTheDocument()
    expect(screen.getByText('2 probable pairs to review · Marked as different people: 2')).toBeInTheDocument()
  })

  it('"Not the same person" is remembered (one call), "Compare and merge" opens the merge dialog on that pair', async () => {
    const user = userEvent.setup()
    mount()
    const pairs = await screen.findAllByTestId('duplicate-pair')
    await user.click(within(pairs[0]).getByTestId('duplicate-dismiss'))
    expect(mocks.dismiss).toHaveBeenCalledWith({ a: 'a1', b: 'b1' })
    expect(await screen.findByText('Marked as two different people.')).toBeInTheDocument()
    await user.click(within(pairs[1]).getByTestId('duplicate-merge'))
    expect(await screen.findByRole('dialog', { name: 'Merge two records of one person' })).toBeInTheDocument()
  })

  it('nothing to review is a good-news empty state, not a blank page', async () => {
    mocks.pairs.mockResolvedValue({ pairs: [], dismissed: 0 })
    mount()
    expect(await screen.findByText('No probable duplicates')).toBeInTheDocument()
  })

  it('a failing load shows the error with a retry', async () => {
    const user = userEvent.setup()
    mocks.pairs.mockRejectedValueOnce(Object.assign(new Error('x'), { messageKey: 'errors.unknown', retryable: true }))
    mount()
    expect(await screen.findByText('The experts could not be loaded.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mocks.pairs).toHaveBeenCalledTimes(2))
  })

  it('Arabic: the count is plural-correct ("زوجان محتملان للمراجعة") with Western digits', async () => {
    mount('/network/experts/duplicates?lang=ar')
    expect(await screen.findByText('زوجان محتملان للمراجعة · سُجّلوا كمختلفين: 2')).toBeInTheDocument()
  })
})
