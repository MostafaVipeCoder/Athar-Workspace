import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { FIGURES } from './alumni.fixtures.js'

const mocks = vi.hoisted(() => ({ figures: vi.fn(), save: vi.fn(), confirm: vi.fn(), close: vi.fn(), reopen: vi.fn(), correct: vi.fn(), refreeze: vi.fn(), fetchFresh: vi.fn() }))

vi.mock('../../data/alumni.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    useAlumniLookups: () => useQuery({ queryKey: ['alumni', 'lookups'], queryFn: async () => (await import('./alumni.fixtures.js')).LOOKUPS, staleTime: Infinity }),
    alumniKeys: { root: () => ['alumni'], lookups: () => ['alumni', 'lookups'] },
  }
})
vi.mock('../../data/alumniQuarters.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  const wrap = (fn) => ({ mutateAsync: (v) => fn(v), isPending: false })
  return {
    NO_DRAFT: '-infinity',
    getCompanyFigures: (...a) => mocks.fetchFresh(...a),
    useCompanyFigures: (id) => useQuery({ queryKey: ['alumni', 'quarters', 'figures', id], queryFn: () => mocks.figures(id), enabled: Boolean(id) }),
    useQuarterMutations: () => ({ saveFigures: wrap(mocks.save), confirmFigures: wrap(mocks.confirm), closeQuarter: wrap(mocks.close), reopenQuarter: wrap(mocks.reopen), correctSnapshot: wrap(mocks.correct), refreezeQuarter: wrap(mocks.refreeze) }),
  }
})

const { default: FiguresPanel } = await import('./FiguresPanel.jsx')
const { QuarterChart, QuarterTable } = await import('./QuarterChart.jsx')

const EN = '/x?lang=en'
const AR = '/x?lang=ar'
const render = (ui, route = EN) => renderWithProviders(<ConfirmProvider>{ui}</ConfirmProvider>, { route })
const panel = (audience = 'founder', route = EN) => render(<FiguresPanel companyId="c1" audience={audience} companyName="Nile" />, route)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.figures.mockResolvedValue(FIGURES)
  mocks.save.mockResolvedValue({ saved: true, changed: true, draft: { ...FIGURES.draft, revenue_total: 100000, updated_at: '2026-10-15T09:00:00Z' } })
  mocks.confirm.mockResolvedValue({ confirmed: true })
  mocks.close.mockResolvedValue({ frozen: 1, already_frozen: 0 })
  mocks.reopen.mockResolvedValue({ reopened: 1 })
  mocks.correct.mockResolvedValue({ saved: true })
  mocks.refreeze.mockResolvedValue({ refrozen: 1 })
})

describe('FiguresPanel: the draft of the quarter (owner decision 21)', () => {
  it('shows the draft values, the status, the deadline and "last modified" - and no history of edits anywhere', async () => {
    panel()
    expect(await screen.findByTestId('figures-form')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Figures for Q4 2026' })).toBeInTheDocument()
    expect(screen.getByTestId('figures-status')).toHaveAttribute('data-status', 'updated')
    expect(screen.getByRole('textbox', { name: /Revenue/ })).toHaveValue('90000')
    expect(screen.getByTestId('figures-stamp')).toHaveTextContent('Last edited by a founder of the company')
    expect(screen.queryByText(/history of the yearly figures/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show.*history/i })).not.toBeInTheDocument()
  })

  it('the banner asks the founder to update or confirm while the quarter is open and not confirmed; the manager gets no banner', async () => {
    const { unmount } = panel('founder')
    expect(await screen.findByTestId('figures-banner')).toHaveTextContent('Update your figures for Q4 2026')
    unmount()
    panel('manager')
    await screen.findByTestId('figures-form')
    expect(screen.queryByTestId('figures-banner')).not.toBeInTheDocument()
  })

  it('a confirmed quarter shows no banner and the Confirm button says so', async () => {
    mocks.figures.mockResolvedValue({ ...FIGURES, status: 'confirmed', target_status: 'confirmed', draft: { ...FIGURES.draft, confirmed: true, confirmed_at: '2026-10-15T00:00:00Z' } })
    panel()
    await screen.findByTestId('figures-form')
    expect(screen.queryByTestId('figures-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('figures-confirm')).toBeDisabled()
    expect(screen.getByTestId('figures-confirm')).toHaveTextContent('Confirmed')
  })

  it('saving sends ONLY the changed figure with the version the form loaded (typing 100000 over 90000 is one value, not a history)', async () => {
    const user = userEvent.setup()
    panel()
    const revenue = await screen.findByRole('textbox', { name: /Revenue/ })
    expect(screen.getByTestId('figures-save')).toBeDisabled()
    await user.clear(revenue)
    await user.type(revenue, '100000')
    await user.click(screen.getByTestId('figures-save'))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith({ companyId: 'c1', data: { revenue_total: '100000' }, expected: '2026-10-14T08:00:00Z' })
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Revenue/ })).toHaveValue('100000'))
    expect(screen.getByTestId('figures-save')).toBeDisabled()
  })

  it('the figures are checked on the form: female employees cannot exceed the total, nothing is sent', async () => {
    const user = userEvent.setup()
    panel()
    const female = await screen.findByRole('textbox', { name: /Female/ })
    await user.clear(female)
    await user.type(female, '99')
    await user.click(screen.getByTestId('figures-save'))
    expect(await screen.findByText(/more than the total|exceeds/i)).toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('"Confirm" with unsaved changes is "Save and confirm": it saves first, then confirms', async () => {
    const user = userEvent.setup()
    panel()
    const revenue = await screen.findByRole('textbox', { name: /Revenue/ })
    await user.clear(revenue)
    await user.type(revenue, '95000')
    const btn = screen.getByTestId('figures-confirm')
    expect(btn).toHaveTextContent('Save and confirm')
    await user.click(btn)
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith({ companyId: 'c1' }))
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirm.mock.invocationCallOrder[0])
  })

  it('an EMPTY revenue asks before confirming ("Revenue is empty"); going back confirms nothing', async () => {
    const user = userEvent.setup()
    mocks.figures.mockResolvedValue({ ...FIGURES, draft: { ...FIGURES.draft, revenue_total: null } })
    panel()
    await screen.findByTestId('figures-form')
    await user.click(screen.getByTestId('figures-confirm'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Revenue is empty')
    await user.click(within(dlg).getByRole('button', { name: 'Go back' }))
    expect(mocks.confirm).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('figures-confirm'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm anyway' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
  })

  it('a manager has no Confirm button (a founder says his figures are right) but sees who confirmed', async () => {
    mocks.figures.mockResolvedValue({ ...FIGURES, draft: { ...FIGURES.draft, confirmed: true, confirmed_at: '2026-10-15T00:00:00Z', confirmed_by_name: 'Sara Ali', updated_by_name: 'Sara Ali' } })
    panel('manager')
    await screen.findByTestId('figures-form')
    expect(screen.queryByTestId('figures-confirm')).not.toBeInTheDocument()
    expect(screen.getByTestId('figures-confirmed-by')).toHaveTextContent('Sara Ali')
  })

  it('somebody saved first and changed a DIFFERENT figure: theirs is loaded, mine stays, a notice says so', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'conflict', cause: { hint: 'alumni_stale', message: 'alumni_stale: x' } }))
    mocks.fetchFresh.mockResolvedValue({ ...FIGURES, draft: { ...FIGURES.draft, freelancers: 9, updated_at: '2026-10-15T07:00:00Z', updated_source: 'manager' } })
    panel()
    const revenue = await screen.findByRole('textbox', { name: /Revenue/ })
    await user.clear(revenue)
    await user.type(revenue, '100000')
    await user.click(screen.getByTestId('figures-save'))
    expect(await screen.findByTestId('figures-notice')).toHaveTextContent('the Athar team')
    expect(screen.getByRole('textbox', { name: /Revenue/ })).toHaveValue('100000')
    expect(screen.getByRole('textbox', { name: /Freelancers/ })).toHaveValue('9')
  })

  it('both changed the SAME figure: the choices are shown and nothing is overwritten until I choose', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'conflict', cause: { hint: 'alumni_stale', message: 'alumni_stale: x' } }))
    mocks.fetchFresh.mockResolvedValue({ ...FIGURES, draft: { ...FIGURES.draft, revenue_total: 70000, updated_at: '2026-10-15T07:00:00Z', updated_source: 'manager' } })
    panel()
    const revenue = await screen.findByRole('textbox', { name: /Revenue/ })
    await user.clear(revenue)
    await user.type(revenue, '100000')
    await user.click(screen.getByTestId('figures-save'))
    const box = await screen.findByTestId('figures-conflict')
    expect(within(box).getByTestId('conflict-theirs-value')).toHaveTextContent('70000')
    expect(within(box).getByTestId('conflict-mine-value')).toHaveTextContent('100000')
    expect(screen.getByTestId('conflict-apply')).toBeDisabled()
    await user.click(within(box).getByRole('radio', { name: /Keep my value/ }))
    await user.click(screen.getByTestId('conflict-apply'))
    expect(await screen.findByRole('textbox', { name: /Revenue/ })).toHaveValue('100000')
  })
})

describe('the closed quarters', () => {
  it('a quarter per column: reported figures, the "Corrected" mark and the ORIGINAL frozen value; no reported quarter = dashes', async () => {
    mocks.figures.mockResolvedValue({ ...FIGURES, snapshots: [...FIGURES.snapshots, { id: 's0', period_key: '2025-Q4', year: 2025, status: 'frozen', reported: false, corrected: false, previous_values: null, frozen_at: '2026-01-01T00:00:00Z', frozen_source: 'auto', revenue_total: 999999, employees_total: 99, team_size: 3, female_founders: 1 }] })
    panel()
    const grid = await screen.findByTestId('quarter-grid')
    expect(within(grid).getAllByTestId('grid-quarter').map((x) => x.textContent)).toEqual(['Q2 2026', 'Q1 2026', 'Q4 2025'])
    expect(within(grid).getByText('Corrected')).toBeInTheDocument()
    expect(within(grid).getByTestId('previous-value')).toHaveTextContent('was')
    expect(within(grid).getByTestId('previous-value')).toHaveTextContent('12,000')
    // the carried-forward numbers of a quarter nobody reported are NOT shown
    expect(grid).not.toHaveTextContent('999,999')
    expect(grid).toHaveTextContent('Not reported')
  })

  it('no closed quarter yet: an empty state with the date of the first close', async () => {
    mocks.figures.mockResolvedValue({ ...FIGURES, snapshots: [] })
    panel()
    expect(await screen.findByText('No quarter is closed yet')).toBeInTheDocument()
    expect(screen.queryByTestId('quarter-grid')).not.toBeInTheDocument()
  })

  it('the graphs are lazy-loaded and each has a table alternative one click away', async () => {
    const user = userEvent.setup()
    panel()
    const cards = await screen.findAllByTestId('chart-card')
    expect(cards.length).toBe(3)
    await user.click(within(cards[0]).getByRole('button', { name: 'Table' }))
    expect(within(cards[0]).getByTestId('quarter-table')).toBeInTheDocument()
    expect(within(cards[0]).getByTestId('quarter-table')).toHaveTextContent('Q2 2026')
  })

  it('a founder has no correction tools; a manager can correct a quarter (reopen first, then the patch), and sees "Close now"', async () => {
    const user = userEvent.setup()
    const { unmount } = panel('founder')
    await screen.findByTestId('quarter-grid')
    expect(screen.queryByTestId('correct-quarter')).not.toBeInTheDocument()
    expect(screen.queryByTestId('close-quarter-now')).not.toBeInTheDocument()
    unmount()
    panel('manager')
    await screen.findByTestId('quarter-grid')
    await user.click(screen.getAllByTestId('correct-quarter')[0])
    const dlg = await screen.findByTestId('correct-form')
    const revenue = within(dlg).getByRole('textbox', { name: /Revenue/ })
    await user.clear(revenue)
    await user.type(revenue, '270000')
    await user.click(screen.getByRole('button', { name: 'Save the correction' }))
    await waitFor(() => expect(mocks.correct).toHaveBeenCalledTimes(1))
    expect(mocks.reopen).toHaveBeenCalledWith({ period: '2026-Q2', companyId: 'c1' })
    expect(mocks.correct).toHaveBeenCalledWith({ companyId: 'c1', period: '2026-Q2', data: { revenue_total: '270000' } })
    expect(mocks.reopen.mock.invocationCallOrder[0]).toBeLessThan(mocks.correct.mock.invocationCallOrder[0])
  })

  it('a failed correction closes the quarter again (it is not left reopened)', async () => {
    const user = userEvent.setup()
    mocks.correct.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'validation', detail: 'revenue_total:out_of_range', cause: { hint: 'alumni_invalid', details: 'revenue_total:out_of_range' } }))
    panel('manager')
    await screen.findByTestId('quarter-grid')
    await user.click(screen.getAllByTestId('correct-quarter')[0])
    const dlg = await screen.findByTestId('correct-form')
    const revenue = within(dlg).getByRole('textbox', { name: /Revenue/ })
    await user.clear(revenue)
    await user.type(revenue, '5')
    await user.click(screen.getByRole('button', { name: 'Save the correction' }))
    await waitFor(() => expect(mocks.refreeze).toHaveBeenCalledWith({ period: '2026-Q2', companyId: 'c1' }))
  })

  it('"Close Q4 2026 now" asks first and names the consequence; confirming calls the close for THIS company', async () => {
    const user = userEvent.setup()
    panel('manager')
    await user.click(await screen.findByTestId('close-quarter-now'))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('never overwritten')
    expect(mocks.close).not.toHaveBeenCalled()
    await user.click(within(dlg).getByRole('button', { name: 'Close the quarter' }))
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith({ period: '2026-Q4', companyId: 'c1' }))
  })

  it('in Arabic: the quarter label, the status and the banner', async () => {
    panel('founder', AR)
    expect(await screen.findByRole('heading', { name: 'أرقام الربع الرابع 2026' })).toBeInTheDocument()
    expect(screen.getByTestId('figures-banner')).toHaveTextContent('حدّث أرقام شركتك عن الربع الرابع 2026')
    expect(screen.getByTestId('figures-status')).toHaveTextContent('محدَّثة وغير مؤكَّدة')
  })
})

describe('QuarterChart: one point per reported quarter, a gap for the rest', () => {
  const owner = [{ key: '2026-Q4', value: 100000, reported: true, corrected: false, previous: null, exists: true }]
  it('the owner\'s scenario: 10,000 then 100,000 in one open quarter is ONE point of 100,000 and no growth line', () => {
    const { container } = render(<QuarterChart title="Revenue" unit="money" kind="bar" points={owner} />)
    expect(container.querySelectorAll('rect.fill-primary')).toHaveLength(1)
    expect(screen.getByTestId('quarter-chart')).toHaveTextContent('EGP 100,000')
    expect(screen.queryByTestId('chart-change')).not.toBeInTheDocument()
    expect(screen.getByRole('img').querySelector('title')).toHaveTextContent('Revenue: Q4 2026 EGP 100,000')
  })
  it('a gap is not a zero: the quarter without a value draws nothing and the line is broken', () => {
    const pts = [
      { key: '2026-Q1', value: 10, reported: true, exists: true }, { key: '2026-Q2', value: null, reported: false, exists: true }, { key: '2026-Q3', value: 30, reported: true, exists: true },
    ]
    const { container } = render(<QuarterChart title="Employees" unit="count" kind="line" points={pts} />)
    expect(container.querySelectorAll('circle')).toHaveLength(2)
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
    expect(screen.getByTestId('chart-change')).toHaveTextContent('+200% vs Q1 2026')
  })
  it('a corrected quarter carries a marker and the note; the table says what it was', () => {
    const pts = [{ key: '2026-Q1', value: 120000, reported: true, corrected: true, previous: 12000, exists: true }]
    const { container } = render(<QuarterChart title="Revenue" unit="money" kind="bar" points={pts} />)
    expect(container.querySelector('path.fill-accent')).not.toBeNull()
    expect(screen.getByTestId('chart-corrected-note')).toBeInTheDocument()
    render(<QuarterTable title="Revenue" unit="money" points={pts} />)
    expect(screen.getByTestId('quarter-table')).toHaveTextContent('was EGP 12,000')
  })
  it('is drawn at its own width: 1 SVG unit = 1 pixel, so the 12px axis text is never scaled down; the plot is a keyboard stop', () => {
    const pts = [{ key: '2026-Q1', value: 10, reported: true, exists: true }, { key: '2026-Q2', value: 25, reported: true, exists: true }]
    const { container } = render(<QuarterChart title="Employees" unit="count" kind="line" points={pts} />)
    const svg = screen.getByTestId('chart-plot')
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`)
    expect(svg).toHaveAttribute('tabindex', '0')
    expect(container.querySelector('text').getAttribute('font-size')).toBe('12')
    const labels = [...container.querySelectorAll('g[aria-hidden] text')].map((x) => x.textContent)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.every((x) => /^[0-9]+$/.test(x))).toBe(true)
  })
  it('the arrow keys move a tooltip over the quarters (no pointer needed)', () => {
    const pts = [{ key: '2026-Q1', value: 10, reported: true, exists: true }, { key: '2026-Q2', value: 25, reported: true, exists: true }]
    render(<QuarterChart title="Employees" unit="count" kind="line" points={pts} />)
    const svg = screen.getByTestId('chart-plot')
    fireEvent.focus(svg)
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Q2 2026')
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Q1 2026')
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Q2 2026')
    fireEvent.blur(svg)
    expect(screen.queryByTestId('chart-tooltip')).not.toBeInTheDocument()
  })
  it('no data: a sentence, no plot', () => {
    const { container } = render(<QuarterChart title="Funding" unit="money" kind="line" points={[]} />)
    expect(screen.getByText('No reported quarter yet')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })
})
