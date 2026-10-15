import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'

vi.mock('../../data/alumni.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    useAlumniLookups: () => useQuery({ queryKey: ['alumni', 'lookups'], queryFn: async () => (await import('./alumni.fixtures.js')).LOOKUPS, staleTime: Infinity }),
    alumniKeys: { root: () => ['alumni'], lookups: () => ['alumni', 'lookups'] },
  }
})

const { default: StampLine } = await import('./StampLine.jsx')
const { default: ConflictDialog } = await import('./ConflictDialog.jsx')
const { useEditText } = await import('./useEditText.js')

const EN = '/x?lang=en'
const AR = '/x?lang=ar'
const render = (ui, route = EN) => renderWithProviders(<ConfirmProvider>{ui}</ConfirmProvider>, { route })

beforeEach(() => vi.clearAllMocks())

describe('StampLine: "last edited by <who> on <date>"', () => {
  const stamp = { at: '2026-10-12T09:30:00Z', source: 'manager', name: 'Mona Adel' }
  it('a manager sees the NAME with the kind of editor; a founder only the kind ("the Athar team")', () => {
    const { unmount } = render(<StampLine stamp={stamp} audience="manager" />)
    expect(screen.getByTestId('stamp-line')).toHaveTextContent('Last edited by Mona Adel (Athar team) on')
    unmount()
    render(<StampLine stamp={stamp} audience="founder" />)
    expect(screen.getByTestId('stamp-line')).toHaveTextContent('Last edited by the Athar team on')
    expect(screen.getByTestId('stamp-line')).not.toHaveTextContent('Mona')
    expect(screen.getByTestId('stamp-line')).toHaveAttribute('data-source', 'manager')
  })
  it('a founder source reads "a founder of the company" for the other side; system and import have their own words', () => {
    const { unmount } = render(<StampLine stamp={{ at: '2026-10-12T09:30:00Z', source: 'founder' }} audience="founder" />)
    expect(screen.getByTestId('stamp-line')).toHaveTextContent('Last edited by a founder of the company')
    unmount()
    render(<StampLine stamp={{ at: '2026-10-12T09:30:00Z', source: 'import' }} audience="manager" />)
    expect(screen.getByTestId('stamp-line')).toHaveTextContent('Last edited by an import')
  })
  it('nothing without a stamp, unless "none yet" is asked for (a row nobody has edited yet)', () => {
    const { unmount } = render(<StampLine stamp={null} />)
    expect(screen.queryByTestId('stamp-line')).not.toBeInTheDocument()
    expect(document.body.textContent).toBe('')
    unmount()
    render(<StampLine stamp={null} showNone />)
    expect(screen.getByText('No edits recorded yet')).toBeInTheDocument()
  })
  it('in Arabic', () => {
    render(<StampLine stamp={stamp} audience="manager" />, AR)
    expect(screen.getByTestId('stamp-line')).toHaveTextContent('آخر تعديل بواسطة Mona Adel (فريق أثر)')
  })
})

describe('ConflictDialog: neither side overwrites the other unseen', () => {
  const conflicts = [{ key: 'sector', base: 'technology', mine: 'education', theirs: 'retail' }, { key: 'description_en', base: '', mine: 'Mine', theirs: 'Theirs' }]
  function Host({ onResolve = () => {} }) {
    const e = useEditText()
    return <ConflictDialog conflicts={conflicts} who="the Athar team" fieldLabel={e.fieldLabel} valueText={e.valueText} onResolve={onResolve} onCancel={() => {}} />
  }
  it('shows what it was, what you typed and what the other side saved, per field', async () => {
    render(<Host />)
    const dialog = await screen.findByRole('dialog')
    const fields = within(dialog).getAllByTestId('conflict-field')
    expect(fields).toHaveLength(2)
    expect(within(fields[0]).getByText('Sector')).toBeInTheDocument()
    // the lookup labels arrive a moment after the first paint
    await waitFor(() => expect(within(fields[0]).getByText(/It was/)).toHaveTextContent('Technology'))
    expect(within(fields[0]).getByTestId('conflict-mine-value')).toHaveTextContent('Education')
    expect(within(fields[0]).getByTestId('conflict-theirs-value')).toHaveTextContent('retail') // a key the lookups do not know is shown as it is
    expect(within(fields[1]).getByText(/It was/)).toHaveTextContent('(empty)')
  })
  it('"Apply" waits until EVERY conflict has a choice, then hands the choices over', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(<Host onResolve={onResolve} />)
    const dialog = await screen.findByRole('dialog')
    const apply = within(dialog).getByTestId('conflict-apply')
    expect(apply).toBeDisabled()
    const fields = within(dialog).getAllByTestId('conflict-field')
    await user.click(within(fields[0]).getByRole('radio', { name: /Keep my value/ }))
    expect(apply).toBeDisabled()
    await user.click(within(fields[1]).getByRole('radio', { name: /Use their value/ }))
    expect(apply).toBeEnabled()
    await user.click(apply)
    expect(onResolve).toHaveBeenCalledWith({ sector: 'mine', description_en: 'theirs' })
  })
})

