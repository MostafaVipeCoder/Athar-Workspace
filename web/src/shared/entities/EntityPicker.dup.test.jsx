import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'

const mocks = vi.hoisted(() => ({ similar: vi.fn(), onPick: vi.fn(), onCreate: vi.fn() }))
vi.mock('../../data/people.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    useNetworkExperts: () => useQuery({ queryKey: ['experts', 'picker'], queryFn: async () => [] }),
    useCompanies: () => useQuery({ queryKey: ['companies', 'picker'], queryFn: async () => [] }),
    findSimilarExperts: (...a) => mocks.similar(...a),
  }
})
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn() }))

import { EntityPicker } from './EntityPicker.jsx'

const CANDIDATE = { id: 'e9', score: 1, reasons: ['same_name'], blocking: true, kind: 'expert', name: { en: 'Sara Ali', ar: '' }, title: { en: 'CTO', ar: '' }, company: { en: 'Acme', ar: '' }, photoPath: null, archived: false }

async function openCreate(user) {
  renderWithProviders(<EntityPicker kind="expert" existingIds={new Set()} onClose={vi.fn()} onPick={mocks.onPick} onCreate={mocks.onCreate} />, { route: '/projects/p/nodes/n?lang=en' })
  await user.click(await screen.findByTestId('picker-new'))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getAllByLabelText('English')[0], 'Sara Ali')
  return dialog
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.similar.mockResolvedValue([])
  mocks.onCreate.mockResolvedValue({ id: 'new1', title: { en: 'Sara Ali', ar: '' } })
  mocks.onPick.mockResolvedValue(undefined)
})

describe('"Add from the Athar Network": creating an expert from inside a list never duplicates the registry', () => {
  it('no similar record: the profile is created in the registry and added (the shared module keeps working: onCreate gets the EntityView)', async () => {
    const user = userEvent.setup()
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('picker-create'))
    await waitFor(() => expect(mocks.onCreate).toHaveBeenCalledTimes(1))
    expect(mocks.similar).toHaveBeenCalledWith(expect.objectContaining({ nameEn: 'Sara Ali', nameAr: null }))
    expect(mocks.onCreate.mock.calls[0][0]).toMatchObject({ kind: 'expert', title: { en: 'Sara Ali' } })
    await waitFor(() => expect(mocks.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' })))
  })

  it('a similar record exists: NOTHING is created; the existing profile is offered, and "add this profile" adds it by reference', async () => {
    const user = userEvent.setup()
    mocks.similar.mockResolvedValue([CANDIDATE])
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('picker-create'))
    const panel = await within(dialog).findByTestId('picker-dups')
    expect(within(panel).getByText('This person may already be in the Athar Network')).toBeInTheDocument()
    expect(within(panel).getByText('Sara Ali')).toBeInTheDocument()
    expect(within(panel).getByText('CTO · Acme')).toBeInTheDocument()
    expect(mocks.onCreate).not.toHaveBeenCalled()
    await user.click(within(panel).getByTestId('picker-dup-add'))
    await waitFor(() => expect(mocks.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'e9' })))
    expect(mocks.onCreate).not.toHaveBeenCalled()
  })

  it('"it is someone else" creates a new profile on purpose (force), then adds it', async () => {
    const user = userEvent.setup()
    mocks.similar.mockResolvedValue([CANDIDATE])
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('picker-create'))
    await user.click(await within(dialog).findByTestId('picker-dup-anyway'))
    await waitFor(() => expect(mocks.onCreate).toHaveBeenCalledTimes(1))
    expect(mocks.onCreate.mock.calls[0][1]).toEqual({ force: true })
    await waitFor(() => expect(mocks.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' })))
  })

  it('editing the form after the warning clears it (the check runs again on the next create)', async () => {
    const user = userEvent.setup()
    mocks.similar.mockResolvedValue([CANDIDATE])
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('picker-create'))
    await within(dialog).findByTestId('picker-dups')
    await user.type(within(dialog).getAllByLabelText('English')[0], ' Jr')
    expect(within(dialog).queryByTestId('picker-dups')).toBeNull()
  })

  it('a company picker never searches the expert registry', async () => {
    const user = userEvent.setup()
    renderWithProviders(<EntityPicker kind="company" existingIds={new Set()} onClose={vi.fn()} onPick={mocks.onPick} onCreate={mocks.onCreate} />, { route: '/projects/p/nodes/n?lang=en' })
    await user.click(await screen.findByTestId('picker-new'))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getAllByLabelText('English')[0], 'Acme')
    await user.click(within(dialog).getByTestId('picker-create'))
    await waitFor(() => expect(mocks.onCreate).toHaveBeenCalled())
    expect(mocks.similar).not.toHaveBeenCalled()
  })

  it('a FAILING look-alike check says so and creates nothing (it used to be a click that did nothing)', async () => {
    const user = userEvent.setup()
    mocks.similar.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', messageKey: 'errors.unknown' }))
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('picker-create'))
    expect(await within(dialog).findByTestId('picker-create-error')).toBeInTheDocument()
    expect(mocks.onCreate).not.toHaveBeenCalled()
    // the next try works again, and the message goes away
    await user.click(within(dialog).getByTestId('picker-create'))
    await waitFor(() => expect(mocks.onCreate).toHaveBeenCalledTimes(1))
    expect(within(dialog).queryByTestId('picker-create-error')).toBeNull()
  })

  it('the look-alike panel is brought into view when it appears (it is below the form in a scrolling dialog)', async () => {
    const user = userEvent.setup()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    mocks.similar.mockResolvedValue([CANDIDATE])
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('picker-create'))
    await within(dialog).findByTestId('picker-dups')
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    delete Element.prototype.scrollIntoView
  })
})
