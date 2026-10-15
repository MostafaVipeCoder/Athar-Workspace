import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { LOOKUPS, SNAPSHOTS } from './alumni.fixtures.js'

const mocks = vi.hoisted(() => ({ history: vi.fn() }))
vi.mock('../../data/alumni.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    useAlumniLookups: () => useQuery({ queryKey: ['alumni', 'lookups'], queryFn: async () => (await import('./alumni.fixtures.js')).LOOKUPS, staleTime: Infinity }),
    useAlumniHistory: (params, options = {}) => useQuery({ queryKey: ['alumni', 'history', params], queryFn: () => mocks.history(params), ...options }),
    alumniKeys: { root: () => ['alumni'], lookups: () => ['alumni', 'lookups'] },
  }
})

const { default: StampLine } = await import('./StampLine.jsx')
const { default: ConflictDialog } = await import('./ConflictDialog.jsx')
const { default: HistoryEntries } = await import('./HistoryEntries.jsx')
const { default: FiguresHistory } = await import('./FiguresHistory.jsx')
const { default: MetricsTable } = await import('./MetricsTable.jsx')
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
  it('nothing without a stamp, unless "none yet" is asked for (data that predates the history)', () => {
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

describe('HistoryEntries: the change log as a timeline', () => {
  const rows = [
    { id: 9, at: '2026-10-15T10:00:00Z', last_at: '2026-10-15T10:05:00Z', edits: 3, request_id: 'r3', source: 'manager', entity_type: 'snapshot', entity_id: 'c1', company_id: 'c1', period_key: '2024', field: 'revenue_total', old_value: 100, new_value: 150, redacted: false,
      actor: { role: 'alumni_manager', user_id: 'u1', name: 'Mona Adel' }, company: { name_en: 'Nile Robotics', name_ar: 'نيل' }, reason: 'corrected from the audited accounts' },
    { id: 8, at: '2026-10-15T10:00:00Z', last_at: '2026-10-15T10:00:00Z', edits: 1, request_id: 'r3', source: 'manager', entity_type: 'company', entity_id: 'c1', company_id: 'c1', field: 'sector', old_value: 'technology', new_value: 'education', redacted: false,
      actor: { role: 'alumni_manager', user_id: 'u1', name: 'Mona Adel' }, company: { name_en: 'Nile Robotics' } },
    { id: 7, at: '2026-10-14T08:00:00Z', last_at: '2026-10-14T08:00:00Z', edits: 1, request_id: 'r2', source: 'founder', entity_type: 'founder', entity_id: 'f1', company_id: 'c1', founder_id: 'f1', field: 'phone', old_value: null, new_value: '+**********78', redacted: true,
      actor: { role: 'founder', user_id: 'u2', name: 'Sara Ali' }, founder: { name_en: 'Sara Ali' }, company: { name_en: 'Nile Robotics' } },
    { id: 6, at: '2026-10-14T08:00:00Z', last_at: '2026-10-14T08:00:00Z', edits: 1, request_id: 'r2', source: 'founder', entity_type: 'identity', entity_id: 'f1', company_id: 'c1', founder_id: 'f1', field: 'national_id', old_value: false, new_value: true, redacted: true,
      actor: { role: 'founder', user_id: 'u2', name: 'Sara Ali' }, founder: { name_en: 'Sara Ali' } },
    { id: 5, at: '2026-10-14T07:00:00Z', last_at: '2026-10-14T07:00:00Z', edits: 1, request_id: 'r1', source: 'system', entity_type: 'company', entity_id: 'c1', company_id: 'c1', field: 'description_en', old_value: 'Farm robots', new_value: null, redacted: false, actor: { role: 'system' } },
  ]
  it('groups entries of one save under one line (who, when, how many changes) and shows old -> new in the viewer language', async () => {
    render(<HistoryEntries rows={rows} audience="manager" showCompany />)
    const saves = screen.getAllByTestId('history-save')
    expect(saves).toHaveLength(3)
    expect(within(saves[0]).getByText('Mona Adel')).toBeInTheDocument()
    expect(within(saves[0]).getByText('Alumni manager')).toBeInTheDocument()
    expect(within(saves[0]).getByText('2 changes')).toBeInTheDocument()
    const entries = within(saves[0]).getAllByTestId('history-entry')
    expect(within(entries[0]).getByText('Revenue (2024)')).toBeInTheDocument()
    expect(within(entries[0]).getByTestId('history-before')).toHaveTextContent('EGP 100')
    expect(within(entries[0]).getByTestId('history-after')).toHaveTextContent('EGP 150')
    await waitFor(() => expect(within(entries[1]).getByTestId('history-before')).toHaveTextContent('Technology'))
    expect(within(entries[1]).getByTestId('history-after')).toHaveTextContent('Education')
    expect(within(entries[0]).getByRole('link', { name: 'Nile Robotics' })).toHaveAttribute('href', '/alumni/admin/company/c1')
  })
  it('a coalesced edit says how many saves it merged; the reason is shown to a manager', () => {
    render(<HistoryEntries rows={rows} audience="manager" />)
    const first = screen.getAllByTestId('history-entry')[0]
    expect(within(first).getByText('3 saves')).toBeInTheDocument()
    expect(within(first).getByText('Reason: corrected from the audited accounts')).toBeInTheDocument()
  })
  it('contact details stay partly hidden and say so; the national ID is only "recorded", never a number', () => {
    render(<HistoryEntries rows={rows} audience="manager" />)
    const entries = screen.getAllByTestId('history-entry')
    const phone = entries.find((x) => x.dataset.field === 'phone')
    expect(within(phone).getByTestId('history-after')).toHaveTextContent('+**********78')
    expect(within(phone).getByText('Partly hidden to protect personal data')).toBeInTheDocument()
    const id = entries.find((x) => x.dataset.field === 'national_id')
    expect(id).toHaveTextContent('recorded a national ID (the number is not kept in the history)')
    expect(id.textContent).not.toMatch(/\d{14}/)
    expect(entries.find((x) => x.dataset.field === 'description_en')).toHaveTextContent('(empty)')
  })
  it('a founder gets the kind of editor only: no name, no role, no reason, no company', () => {
    render(<HistoryEntries rows={rows.map((r) => ({ ...r, actor: { role: r.actor.role }, company: undefined, founder: undefined, reason: undefined }))} audience="founder" showPerson={false} />)
    const saves = screen.getAllByTestId('history-save')
    expect(within(saves[0]).getByText('the Athar team')).toBeInTheDocument()
    expect(within(saves[0]).getByText('Athar team')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Mona')
    expect(document.body.textContent).not.toContain('audited accounts')
  })
  it('in Arabic, with the Arabic field labels and the money in pounds', () => {
    render(<HistoryEntries rows={rows} audience="manager" />, AR)
    const first = screen.getAllByTestId('history-entry')[0]
    expect(within(first).getByText('الإيرادات (2024)')).toBeInTheDocument()
    expect(within(first).getByTestId('history-after').textContent).toMatch(/150/)
  })
  it('an empty list says so', () => {
    render(<HistoryEntries rows={[]} audience="manager" />)
    expect(screen.getByText('No changes have been recorded yet.')).toBeInTheDocument()
  })
  it('a field label can be a button (the per-field timeline)', async () => {
    const user = userEvent.setup()
    const onField = vi.fn()
    render(<HistoryEntries rows={rows.slice(1, 2)} audience="manager" onField={onField} />)
    await user.click(screen.getByRole('button', { name: 'Sector' }))
    expect(onField).toHaveBeenCalledWith('sector', expect.objectContaining({ id: 8 }))
  })
})

describe('FiguresHistory: the history of the yearly figures, loaded only when opened', () => {
  const page = (n, total) => ({ total, limit: 50, offset: 0, rows: Array.from({ length: n }, (_, i) => ({ id: n - i, at: '2026-10-15T10:00:00Z', last_at: '2026-10-15T10:00:00Z', edits: 1, request_id: `r${i}`, source: 'founder', entity_type: 'snapshot',
    entity_id: 'c1', company_id: 'c1', period_key: '2024', field: 'revenue_total', old_value: 100 + i, new_value: 200 + i, redacted: false, actor: { role: 'founder' } })) })
  it('asks for the history of the yearly figures of THIS company only after a click, and shows who without a name', async () => {
    const user = userEvent.setup()
    mocks.history.mockResolvedValue(page(2, 2))
    render(<FiguresHistory companyId="c1" audience="founder" />)
    expect(mocks.history).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Show the history' }))
    expect(await screen.findAllByTestId('history-entry')).toHaveLength(2)
    expect(mocks.history).toHaveBeenCalledWith({ filters: { company_id: 'c1', entity_type: 'snapshot' }, limit: 50, offset: 0 })
    expect(screen.getAllByText('a founder of the company').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Show older changes' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide the history' }))
    expect(screen.queryByTestId('history-entries')).not.toBeInTheDocument()
  })
  it('"Show older changes" asks for 50 more', async () => {
    const user = userEvent.setup()
    mocks.history.mockResolvedValue(page(50, 70))
    render(<FiguresHistory companyId="c1" />)
    await user.click(screen.getByRole('button', { name: 'Show the history' }))
    await user.click(await screen.findByRole('button', { name: 'Show older changes' }))
    await waitFor(() => expect(mocks.history).toHaveBeenLastCalledWith({ filters: { company_id: 'c1', entity_type: 'snapshot' }, limit: 100, offset: 0 }))
  })
  it('a failure shows an error with Try again', async () => {
    const user = userEvent.setup()
    mocks.history.mockRejectedValue(new Error('boom'))
    render(<FiguresHistory companyId="c1" />)
    await user.click(screen.getByRole('button', { name: 'Show the history' }))
    expect(await screen.findByText('The history could not be loaded.')).toBeInTheDocument()
  })
})

describe('MetricsTable: who edited each year, the review checkpoint, the reason, and a year somebody saved first', () => {
  const stale = () => Object.assign(new Error('x'), { messageKey: 'alumni.err.stale', cause: { hint: 'alumni_stale', message: 'alumni_stale: reload' } })
  const row = (over = {}) => ({ ...SNAPSHOTS.find((s) => s.year === 2024), ...over })

  it('shows under each year when it was edited, and the review state (reviewed / changed after the review)', () => {
    const snapshots = [row({ reviewed_at: '2026-10-02T00:00:00Z' }), { ...SNAPSHOTS.find((s) => s.year === 2023), reviewed_at: '2025-12-01T00:00:00Z' }]
    render(<MetricsTable snapshots={snapshots} onSave={vi.fn()} audience="manager" yearStamps={[{ year: 2024, name: 'Mona Adel' }]} />)
    const stamps = screen.getAllByTestId('metrics-stamp')
    expect(stamps[0]).toHaveTextContent('Mona Adel')
    expect(screen.getAllByText('Reviewed')).toHaveLength(1) // 2024: reviewed after its last edit
    expect(screen.getAllByText('Changed after the last review')).toHaveLength(1) // 2023: edited after its review
  })

  it('the manager marks a year reviewed or withdraws it (the buttons exist only when onReview is given)', async () => {
    const user = userEvent.setup()
    const onReview = vi.fn()
    const { unmount } = render(<MetricsTable snapshots={[row()]} onSave={vi.fn()} />)
    expect(screen.queryByTestId('metrics-review')).not.toBeInTheDocument()
    unmount()
    render(<MetricsTable snapshots={[row()]} onSave={vi.fn()} onReview={onReview} audience="manager" />)
    await user.click(screen.getByRole('button', { name: 'Mark 2024 as reviewed' }))
    expect(onReview).toHaveBeenCalledWith(2024, true)
  })

  it('a manager can say why (kept in the history); a founder\'s save is exactly (year, patch)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    const { unmount } = render(<MetricsTable snapshots={[row()]} onSave={onSave} audience="manager" />)
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    let dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Freelancers'))
    await user.type(within(dialog).getByLabelText('Freelancers'), '9')
    await user.type(within(dialog).getByLabelText('Reason for this change (optional)'), 'audited')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(2024, { freelancers: '9' }, 'audited'))
    unmount()
    onSave.mockClear()
    render(<MetricsTable snapshots={[row()]} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Reason for this change (optional)')).not.toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Freelancers'))
    await user.type(within(dialog).getByLabelText('Freelancers'), '9')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(2024, { freelancers: '9' }))
  })

  it('somebody saved the year first and changed a DIFFERENT figure: their value is loaded, mine stays, a notice says so, and Save again sends only mine', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue({})
    const onReload = vi.fn().mockResolvedValue(row({ needs: 'More mentors', source: 'manager', updated_at: '2026-10-15T00:00:00Z' }))
    render(<MetricsTable snapshots={[row()]} onSave={onSave} onReload={onReload} audience="founder" />)
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Freelancers'))
    await user.type(within(dialog).getByLabelText('Freelancers'), '9')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByTestId('snapshot-notice')).toHaveTextContent('the Athar team saved other changes meanwhile')
    expect(onReload).toHaveBeenCalledWith(2024)
    expect(within(dialog).getByLabelText('Needs')).toHaveValue('More mentors') // theirs
    expect(within(dialog).getByLabelText('Freelancers')).toHaveValue('9') // mine
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(2024, { freelancers: '9' }))
  })

  it('both changed the SAME figure to different values: the choices are shown inline and nothing is overwritten until I choose', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue({})
    const onReload = vi.fn().mockResolvedValue(row({ revenue_total: 270000, source: 'manager', updated_at: '2026-10-15T00:00:00Z' }))
    render(<MetricsTable snapshots={[row()]} onSave={onSave} onReload={onReload} audience="founder" />)
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Revenue (total of the year)'))
    await user.type(within(dialog).getByLabelText('Revenue (total of the year)'), '300000')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    const box = await within(dialog).findByTestId('snapshot-conflict')
    expect(within(box).getByText('Revenue (total of the year)')).toBeInTheDocument()
    expect(within(box).getByTestId('conflict-mine-value')).toHaveTextContent('300000')
    expect(within(box).getByTestId('conflict-theirs-value')).toHaveTextContent('270000')
    const apply = within(dialog).getByTestId('conflict-apply')
    expect(apply).toBeDisabled()
    await user.click(within(box).getByRole('radio', { name: /Keep my value/ }))
    await user.click(apply)
    expect(await within(dialog).findByTestId('snapshot-notice')).toHaveTextContent('Your choices are applied')
    expect(within(dialog).getByLabelText('Revenue (total of the year)')).toHaveValue('300000')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(2024, { revenue_total: '300000' }))
  })

  it('choosing THEIR value drops my edit: nothing is left to save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValueOnce(stale())
    const onReload = vi.fn().mockResolvedValue(row({ revenue_total: 270000, source: 'manager', updated_at: '2026-10-15T00:00:00Z' }))
    render(<MetricsTable snapshots={[row()]} onSave={onSave} onReload={onReload} audience="founder" />)
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Revenue (total of the year)'))
    await user.type(within(dialog).getByLabelText('Revenue (total of the year)'), '300000')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    const box = await within(dialog).findByTestId('snapshot-conflict')
    await user.click(within(box).getByRole('radio', { name: /Use their value/ }))
    await user.click(within(dialog).getByTestId('conflict-apply'))
    await waitFor(() => expect(within(dialog).getByLabelText('Revenue (total of the year)')).toHaveValue('270000'))
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('the year was deleted meanwhile: the figure I changed is a conflict with "nothing", and after I keep mine the form is a NEW year (the other figures are empty)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue({})
    const onReload = vi.fn().mockResolvedValue(null)
    render(<MetricsTable snapshots={[row()]} onSave={onSave} onReload={onReload} audience="founder" />)
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Freelancers'))
    await user.type(within(dialog).getByLabelText('Freelancers'), '9')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    const box = await within(dialog).findByTestId('snapshot-conflict')
    expect(within(box).getByTestId('conflict-theirs-value')).toHaveTextContent('(empty)')
    await user.click(within(box).getByRole('radio', { name: /Keep my value/ }))
    await user.click(within(dialog).getByTestId('conflict-apply'))
    await within(dialog).findByTestId('snapshot-notice')
    expect(within(dialog).getByLabelText('Freelancers')).toHaveValue('9')
    expect(within(dialog).getByLabelText('Revenue (total of the year)')).toHaveValue('')
  })

  it('a refusal that is not a conflict stays inside the dialog (no reload is attempted)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { messageKey: 'errors.unknown' }))
    const onReload = vi.fn()
    render(<MetricsTable snapshots={[row()]} onSave={onSave} onReload={onReload} />)
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Needs'), ' and mentors')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(onReload).not.toHaveBeenCalled()
  })
})

describe('the shared dictionary', () => {
  it('has a label for every field the history can name (no key shows up raw)', async () => {
    const { HISTORY_FIELDS } = await import('../../lib/alumniHistoryState.js')
    const { getMessages } = await import('../../i18n/core.js')
    const en = getMessages('en')
    const ar = getMessages('ar')
    const missing = []
    for (const [, list] of HISTORY_FIELDS) for (const f of list) if (!(`alumni.edit.field.${f}` in en) || !(`alumni.edit.field.${f}` in ar)) missing.push(f)
    for (const k of ['created', 'removed']) if (!(`alumni.edit.field.${k}` in en)) missing.push(k)
    for (const k of ['company', 'internal', 'founder', 'identity', 'team', 'snapshot']) if (!(`alumni.edit.entity.${k}` in en) || !(`alumni.edit.entity.${k}` in ar)) missing.push(`entity.${k}`)
    for (const k of ['super_admin', 'alumni_manager', 'project_manager', 'founder', 'system', 'user']) if (!(`alumni.edit.role.${k}` in en) || !(`alumni.edit.role.${k}` in ar)) missing.push(`role.${k}`)
    for (const k of ['founder', 'manager', 'import', 'system']) if (!(`alumni.edit.source.${k}` in en) || !(`alumni.edit.stamp.who.${k}` in ar)) missing.push(`source.${k}`)
    for (const k of ['created', 'removed', 'member_added', 'member_removed', 'id_set', 'id_changed', 'id_cleared', 'set', 'cleared', 'changed', 'nochange']) if (!(`alumni.edit.did.${k}` in en) || !(`alumni.edit.did.${k}` in ar)) missing.push(`did.${k}`)
    expect(missing).toEqual([])
    expect(LOOKUPS).toBeTruthy()
  })
})
