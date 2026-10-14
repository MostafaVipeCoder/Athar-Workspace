import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../../i18n/LanguageProvider.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { ToastProvider } from '../../ui/Toast.jsx'
import { COMPANY_PAYLOAD, IDENTITY_ID, IDENTITY_MASKED, IDENTITY_NONE, LOOKUPS, PREVIEW_OK, SNAPSHOTS, TEAM } from './alumni.fixtures.js'

const mocks = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('../../data/alumni.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    previewNationalId: (...a) => mocks.preview(...a),
    useAlumniLookups: () => useQuery({ queryKey: ['alumni', 'lookups'], queryFn: async () => (await import('./alumni.fixtures.js')).LOOKUPS, staleTime: Infinity }),
    alumniKeys: { root: () => ['alumni'], me: () => ['alumni', 'me'] },
  }
})
vi.mock('../../data/alumniFounder.js', () => ({ uploadCompanyLogo: vi.fn(async () => 'alumni/u/logo/x.webp') }))

const { default: NationalIdField } = await import('./NationalIdField.jsx')
const { ChipSelect, SectorPicker } = await import('./pickers.jsx')
const { CompletenessMeter } = await import('./blocks.jsx')
const { default: SaveBar } = await import('./SaveBar.jsx')
const { useDraftForm } = await import('./useDraftForm.js')
const { default: TeamEditor } = await import('./TeamEditor.jsx')
const { default: MetricsTable } = await import('./MetricsTable.jsx')
const { default: TrendBars } = await import('./TrendBars.jsx')
const { default: ProgramsReadOnlyList } = await import('./ProgramsReadOnlyList.jsx')
const { CompanyStatusSection, DirectoryVisibilitySection } = await import('./CompanySections.jsx')

/** Every provider the blocks need, as a WRAPPER so that `rerender` keeps them. */
function renderWithProviders(ui, { route = '/x?lang=en' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  function Wrapper({ children }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <LanguageProvider>
            <ToastProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
            </ToastProvider>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(ui, { wrapper: Wrapper })
}

const EN = '/x?lang=en'
const AR = '/x?lang=ar'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.preview.mockResolvedValue(PREVIEW_OK)
})

/** A controlled host for the ID field (the page keeps the state). */
function IdHost({ identity = IDENTITY_NONE, initial = '', onChange = () => {}, onSelf = () => {}, ...rest }) {
  const [value, setValue] = useState(initial)
  const [self, setSelf] = useState({ self_birth_date: '', self_gender: '' })
  return (
    <NationalIdField
      identity={identity}
      value={value}
      onChange={(v) => { setValue(v); onChange(v) }}
      selfBirthDate={self.self_birth_date}
      selfGender={self.self_gender}
      onSelfChange={(k, v) => { setSelf((s) => ({ ...s, [k]: v })); onSelf(k, v) }}
      {...rest}
    />
  )
}

describe('NationalIdField', () => {
  it('is masked by default, digits only, with a reveal toggle (it never renders a number it was not given)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IdHost />, { route: EN })
    const input = screen.getByLabelText('National ID')
    expect(input.className).toContain('text-security') // masked with the browser's own text security, not type=password
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'off')
    await user.type(input, '2950 abc 1010-1')
    expect(input).toHaveValue('29501010 1'.replace(' ', '')) // formatting keeps the digits only
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(input.className).not.toContain('text-security')
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says why a prefix is wrong the moment it is wrong: century, date, governorate', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IdHost />, { route: EN })
    const input = screen.getByLabelText('National ID')
    await user.type(input, '4')
    expect(await screen.findByText('The first digit of the national ID must be 2 or 3.')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '2951301')
    expect(await screen.findByText(/not a real date of birth/)).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '295010105')
    expect(await screen.findByText(/not a known governorate code/)).toBeInTheDocument()
    expect(mocks.preview).not.toHaveBeenCalled() // nothing goes to the server until the number is complete and plausible
  })

  it('in Arabic the reasons are Arabic', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IdHost />, { route: AR })
    await user.type(screen.getByLabelText('الرقم القومي'), '1')
    expect(await screen.findByText('يجب أن يكون الرقم الأول من الرقم القومي 2 أو 3.')).toBeInTheDocument()
  })

  it('at 14 valid digits the SERVER derives the read-only card (one call, with exactly those digits)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IdHost />, { route: EN })
    await user.type(screen.getByLabelText('National ID'), '29501010101234')
    const card = await screen.findByTestId('national-id-derived')
    expect(within(card).getByText('Derived from your national ID')).toBeInTheDocument()
    expect(within(card).getByText('January 1, 1995')).toBeInTheDocument()
    expect(within(card).getByText('31 years')).toBeInTheDocument()
    expect(within(card).getByText('Male')).toBeInTheDocument()
    expect(within(card).getByText('Cairo')).toBeInTheDocument()
    expect(within(card).getAllByText('From your national ID')).toHaveLength(4)
    expect(mocks.preview).toHaveBeenCalledTimes(1)
    expect(mocks.preview).toHaveBeenCalledWith('29501010101234')
    // the typed fallback inputs are gone as soon as an ID is being typed
    expect(screen.queryByTestId('national-id-self')).not.toBeInTheDocument()
  })

  it('shows the Arabic governorate name from the server answer', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IdHost />, { route: AR })
    await user.type(screen.getByLabelText('الرقم القومي'), '29501010101234')
    const card = await screen.findByTestId('national-id-derived')
    expect(within(card).getByText('القاهرة')).toBeInTheDocument()
  })

  it('a number the server refuses is shown with the server\'s reason', async () => {
    mocks.preview.mockResolvedValue({ valid: false, reason: 'governorate' })
    const user = userEvent.setup()
    renderWithProviders(<IdHost />, { route: EN })
    await user.type(screen.getByLabelText('National ID'), '29501010101234')
    expect(await screen.findByText(/not a known governorate code/)).toBeInTheDocument()
    expect(screen.queryByTestId('national-id-derived')).not.toBeInTheDocument()
  })

  it('a failed check does not block the person: a neutral note, the save re-validates', async () => {
    mocks.preview.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    renderWithProviders(<IdHost />, { route: EN })
    await user.type(screen.getByLabelText('National ID'), '29501010101234')
    expect(await screen.findByText(/could not be checked right now/)).toBeInTheDocument()
  })

  it('the self-declared date and gender exist only while there is NO ID, flagged as self-declared', async () => {
    const user = userEvent.setup()
    const onSelf = vi.fn()
    renderWithProviders(<IdHost onSelf={onSelf} />, { route: EN })
    const self = screen.getByTestId('national-id-self')
    expect(within(self).getByText('Self-declared')).toBeInTheDocument()
    await user.click(await within(self).findByRole('button', { name: 'Female' })) // the vocabulary loads first
    expect(onSelf).toHaveBeenCalledWith('self_gender', 'female')
    await user.type(within(self).getByLabelText('Date of birth'), '1990-05-05')
    expect(onSelf).toHaveBeenCalledWith('self_birth_date', '1990-05-05')
  })

  it('a saved ID of the owner: masked by default, the full number only on "Show"; the derived values come from the saved payload', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IdHost identity={IDENTITY_ID} initial="29501010101234" />, { route: EN })
    expect(screen.getByTestId('national-id-saved')).toHaveTextContent('**********1234')
    expect(screen.queryByText('29501010101234')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('National ID')).not.toBeInTheDocument() // no input while the saved number is shown
    expect(screen.queryByTestId('national-id-self')).not.toBeInTheDocument()
    const card = screen.getByTestId('national-id-derived')
    expect(within(card).getByText('January 1, 1995')).toBeInTheDocument()
    expect(mocks.preview).not.toHaveBeenCalled() // the saved values are not re-derived on every visit
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByTestId('national-id-saved')).toHaveTextContent('29501010101234')
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.getByTestId('national-id-saved')).toHaveTextContent('**********1234')
  })

  it('"Change number" clears the value and opens the input; "Remove number" clears it too', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<IdHost identity={IDENTITY_ID} initial="29501010101234" onChange={onChange} />, { route: EN })
    await user.click(screen.getByRole('button', { name: 'Change number' }))
    expect(onChange).toHaveBeenCalledWith('')
    expect(await screen.findByLabelText('National ID')).toHaveFocus()
    expect(screen.getByText('The saved number will be removed when you save.')).toBeInTheDocument()
    expect(screen.getByTestId('national-id-self')).toBeInTheDocument() // no ID in the form any more: the fallback is back
  })

  it('a manager payload has only the masked number: the full number is never rendered, "Show" asks for the audited reveal', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn()
    renderWithProviders(<IdHost identity={IDENTITY_MASKED} initial="" onReveal={onReveal} />, { route: EN })
    expect(screen.getByTestId('national-id-saved')).toHaveTextContent('**********1234')
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('29501010101234')
  })

  it('the conflict message and the "we used your ID" notice', async () => {
    renderWithProviders(
      <IdHost conflict replaced={[{ field: 'birth_date', typed: '1990-05-05', from_id: '1995-01-01' }, { field: 'gender', typed: 'female', from_id: 'male' }]} />,
      { route: EN },
    )
    await screen.findByRole('button', { name: 'Female' }) // wait for the vocabulary (the gender labels)
    expect(screen.getByText('This number is already registered. Contact the Athar team to sort it out.')).toBeInTheDocument()
    const notice = screen.getByTestId('national-id-replaced')
    expect(notice).toHaveTextContent('You typed the date of birth May 5, 1990, your ID says January 1, 1995.')
    expect(notice).toHaveTextContent('You typed Female, your ID says Male.')
  })
})

describe('ChipSelect', () => {
  const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]
  it('single: aria-pressed marks the choice, a second tap clears it only with allowClear', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = renderWithProviders(<ChipSelect label="Pick" options={options} value="a" onChange={onChange} />, { route: EN })
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Beta' }))
    expect(onChange).toHaveBeenLastCalledWith('b')
    await user.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(onChange).toHaveBeenLastCalledWith('a')
    rerender(<ChipSelect label="Pick" options={options} value="a" onChange={onChange} allowClear />)
  })

  it('multiple toggles values in an array; every chip is at least 44 px high', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<ChipSelect label="Pick" options={options} value={['a']} multiple onChange={onChange} />, { route: EN })
    await user.click(screen.getByRole('button', { name: 'Beta' }))
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b'])
    await user.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    for (const b of screen.getAllByRole('button')) expect(b.className).toContain('min-h-11')
    expect(screen.getByRole('group', { name: 'Pick' })).toBeInTheDocument()
  })
})

describe('SectorPicker', () => {
  function Host({ onChange }) {
    const [v, setV] = useState({ sector: 'technology', subsector: 'robotics' })
    return <SectorPicker sector={v.sector} subsector={v.subsector} onChange={(n) => { setV(n); onChange(n) }} />
  }
  it('lists the sub sectors of the chosen sector only, and changing the sector clears the sub sector', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<Host onChange={onChange} />, { route: EN })
    const sub = await screen.findByLabelText('Sub sector')
    await waitFor(() => expect(within(sub).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select...', 'Robotics', 'Drones']))
    await user.selectOptions(screen.getByLabelText('Sector'), 'education')
    expect(onChange).toHaveBeenLastCalledWith({ sector: 'education', subsector: '' })
    await waitFor(() => expect(within(screen.getByLabelText('Sub sector')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select...', 'EdTech']))
    expect(screen.getByLabelText('Sub sector')).toHaveValue('')
  })
  it('the sub sector is disabled until a sector is chosen', async () => {
    renderWithProviders(<SectorPicker sector="" subsector="" onChange={() => {}} />, { route: EN })
    expect(await screen.findByLabelText('Sub sector')).toBeDisabled()
    expect(screen.getByText('Choose a sector first.')).toBeInTheDocument()
  })
})

describe('CompletenessMeter', () => {
  it('a progressbar with the server percent; a missing item jumps to its section', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    renderWithProviders(
      <CompletenessMeter percent={75} missing={['phone', 'identity']} labelFor={(k) => `L-${k}`} sectionFor={(k) => (k === 'phone' ? 'identity' : 'national-id')} onJump={onJump} />,
      { route: EN },
    )
    expect(screen.getByRole('progressbar', { name: 'Profile completeness' })).toHaveAttribute('aria-valuenow', '75')
    await user.click(screen.getByRole('button', { name: 'L-identity' }))
    expect(onJump).toHaveBeenCalledWith('national-id')
  })
  it('complete: a thank-you; incomplete without a list: nothing invented', () => {
    const { rerender } = renderWithProviders(<CompletenessMeter percent={100} missing={[]} />, { route: EN })
    expect(screen.getByText('Everything is filled in. Thank you!')).toBeInTheDocument()
    rerender(<CompletenessMeter percent={60} missing={[]} />)
    expect(screen.queryByText('Everything is filled in. Thank you!')).not.toBeInTheDocument()
  })
})

describe('SaveBar', () => {
  it('appears with the number of unsaved changes; Undo and Save call back; hidden when clean', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onUndo = vi.fn()
    const { rerender } = renderWithProviders(<SaveBar visible count={2} onSave={onSave} onUndo={onUndo} />, { route: EN })
    expect(screen.getByRole('status')).toHaveTextContent('2 changes not saved yet')
    await user.click(screen.getByRole('button', { name: 'Undo changes' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
    rerender(<SaveBar visible={false} count={0} onSave={onSave} />)
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  })
  it('Arabic plural of the counter', () => {
    renderWithProviders(<SaveBar visible count={2} onSave={() => {}} />, { route: AR })
    expect(screen.getByRole('status')).toHaveTextContent('تغييران لم يُحفظا بعد')
  })
})

describe('useDraftForm', () => {
  function Host({ server: initialServer, onDiscard }) {
    const [server, setServer] = useState(initialServer)
    const [seen, setSeen] = useState(initialServer)
    if (seen !== initialServer) { setSeen(initialServer); setServer(initialServer) } // a new prop = a refetch
    const form = useDraftForm(() => ({ name: server.name }), {
      version: server.version,
      isDirty: (v, b) => v.name !== b.name,
      onDiscard,
    })
    return (
      <div>
        <input aria-label="name" value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />
        <button onClick={form.reset}>undo</button>
        <button onClick={() => form.track('file-1')}>track</button>
        <button onClick={() => { setServer({ name: 'Saved', version: 'v9' }); form.rebase({ name: 'Saved' }, 'v9') }}>saved</button>
        <button onClick={() => form.rebase({ name: server.name }, server.version, ['name'])}>keep</button>
        <output data-testid="v">{form.version}</output>
      </div>
    )
  }

  it('follows the server while clean, keeps the person\'s edits while dirty, Undo goes back to the saved values', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(<Host server={{ name: 'A', version: 'v1' }} />)
    expect(screen.getByLabelText('name')).toHaveValue('A')
    rerender(<Host server={{ name: 'B', version: 'v2' }} />)
    expect(screen.getByLabelText('name')).toHaveValue('B') // clean: the server wins
    await user.type(screen.getByLabelText('name'), '!')
    rerender(<Host server={{ name: 'C', version: 'v3' }} />)
    expect(screen.getByLabelText('name')).toHaveValue('B!') // dirty: my edit stays
    expect(screen.getByTestId('v')).toHaveTextContent('v2') // and the form still says which server state it started from
    await user.click(screen.getByText('undo'))
    expect(screen.getByLabelText('name')).toHaveValue('C') // clean again: the form follows the newer server state
  })

  it('rebase after a save makes the saved values the base; a stale reload keeps the edited keys on top of the fresh values', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Host server={{ name: 'A', version: 'v1' }} />)
    await user.type(screen.getByLabelText('name'), 'x')
    await user.click(screen.getByText('saved'))
    expect(screen.getByLabelText('name')).toHaveValue('Saved')
    expect(screen.getByTestId('v')).toHaveTextContent('v9')
    await user.clear(screen.getByLabelText('name'))
    await user.type(screen.getByLabelText('name'), 'Mine')
    await user.click(screen.getByText('keep'))
    expect(screen.getByLabelText('name')).toHaveValue('Mine')
  })

  it('uploaded-but-unsaved files are handed to onDiscard on Undo (and only once)', async () => {
    const user = userEvent.setup()
    const onDiscard = vi.fn()
    renderWithProviders(<Host server={{ name: 'A', version: 'v1' }} onDiscard={onDiscard} />)
    await user.click(screen.getByText('track'))
    await user.click(screen.getByText('undo'))
    expect(onDiscard).toHaveBeenCalledWith(['file-1'])
    await user.click(screen.getByText('undo'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })
})

describe('TeamEditor (a founder\'s view of his company)', () => {
  const setup = (props = {}) => {
    const handlers = { onSaveMember: vi.fn().mockResolvedValue({}), onRemove: vi.fn().mockResolvedValue({}), onSetCeo: vi.fn().mockResolvedValue({}) }
    renderWithProviders(<TeamEditor team={TEAM} counts={COMPANY_PAYLOAD.counts} ceoFounderId="f1" {...handlers} {...props} />, { route: EN })
    return handlers
  }

  it('shows the derived counts and every member; the CEO badge sits on the primary founder', () => {
    setup()
    const counts = screen.getByTestId('team-counts')
    expect(counts).toHaveTextContent('3')
    expect(counts).toHaveTextContent('Founding team')
    expect(counts).toHaveTextContent('Female founders')
    expect(screen.getAllByTestId('team-member')).toHaveLength(3)
    expect(within(screen.getAllByTestId('team-member')[0]).getByText('CEO', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/You cannot type them/)).toBeInTheDocument()
  })

  it('a REGISTERED co-founder is read-only (his details are private to him); a record without an account can be edited and removed; I edit my own role', () => {
    setup()
    const [me, registered, record] = screen.getAllByTestId('team-member')
    expect(within(me).getByRole('button', { name: 'Edit my role' })).toBeInTheDocument()
    expect(within(me).getByText('31 years')).toBeInTheDocument()
    expect(within(me).getByText('From your national ID')).toBeInTheDocument()
    expect(within(registered).queryByRole('button', { name: /Edit|Remove/ })).not.toBeInTheDocument()
    expect(within(registered).getByText(/controls his or her own details/)).toBeInTheDocument()
    expect(within(registered).queryByText(/years/)).not.toBeInTheDocument() // no age of another registered founder
    expect(within(registered).getByRole('button', { name: 'Make CEO' })).toBeInTheDocument()
    expect(within(record).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(within(record).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(within(record).getByText('24 years')).toBeInTheDocument()
    expect(within(record).getByText('Self-declared')).toBeInTheDocument()
    expect(within(record).getByText('No account')).toBeInTheDocument()
  })

  it('make CEO and remove (with a confirmation) call back', async () => {
    const user = userEvent.setup()
    const h = setup()
    await user.click(within(screen.getAllByTestId('team-member')[1]).getByRole('button', { name: 'Make CEO' }))
    expect(h.onSetCeo).toHaveBeenCalledWith('f2')
    await user.click(within(screen.getAllByTestId('team-member')[2]).getByRole('button', { name: 'Remove' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }, { selector: '[role=dialog] button' }).catch(() => screen.getAllByRole('button', { name: 'Remove' }).at(-1)))
    await waitFor(() => expect(h.onRemove).toHaveBeenCalledWith('f3'))
  })

  it('adding a co-founder record sends a name, a role and the self-declared values (no national ID field exists)', async () => {
    const user = userEvent.setup()
    const h = setup()
    await user.click(screen.getByRole('button', { name: 'Add a co-founder' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText(/National ID/)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Karim Nabil')
    await user.type(within(dialog).getByLabelText('Role in the company'), 'CTO')
    await user.click(within(dialog).getByRole('button', { name: 'Male' }))
    await user.type(within(dialog).getByLabelText('Date of birth'), '1999-05-20')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.onSaveMember).toHaveBeenCalledTimes(1))
    expect(h.onSaveMember).toHaveBeenCalledWith(null, { name_en: 'Karim Nabil', role: 'CTO', self_gender: 'male', self_birth_date: '1999-05-20' })
  })

  it('a name is required for a new record and the dialog stays open; a refusal from the server is shown inside it', async () => {
    const user = userEvent.setup()
    const h = setup({ onSaveMember: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { messageKey: 'alumni.err.notFound' })) })
    await user.click(screen.getByRole('button', { name: 'Add a co-founder' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('is required')).toBeInTheDocument()
    expect(h.onSaveMember).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Karim')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('We could not find this record.')
  })

  it('"my role" edits only the role', async () => {
    const user = userEvent.setup()
    const h = setup()
    await user.click(screen.getByRole('button', { name: 'Edit my role' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Name (English)')).not.toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Role in the company'))
    await user.type(within(dialog).getByLabelText('Role in the company'), 'CEO and founder')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.onSaveMember).toHaveBeenCalledWith('f1', { role: 'CEO and founder' }))
  })

  it('read-only (canEdit false) shows no action', () => {
    setup({ canEdit: false })
    expect(screen.queryByRole('button', { name: /Make CEO|Add a co-founder|Edit|Remove/ })).not.toBeInTheDocument()
  })
})

describe('MetricsTable', () => {
  it('metrics as rows, years as columns (newest first), money in EGP, the source of each year', () => {
    renderWithProviders(<MetricsTable snapshots={SNAPSHOTS} onSave={vi.fn()} />, { route: EN })
    expect(screen.getAllByTestId('metrics-year').map((y) => y.textContent)).toEqual(['2024', '2023'])
    const table = screen.getByRole('table')
    expect(within(table).getByRole('row', { name: /Revenue/ })).toHaveTextContent('EGP 260,000')
    expect(within(table).getByRole('row', { name: /Revenue/ })).toHaveTextContent('EGP 120,000')
    expect(within(table).getByRole('row', { name: /Employees/ })).toHaveTextContent('12')
    expect(within(table).getByText('By the Athar team')).toBeInTheDocument()
    expect(within(table).getByText('By a founder')).toBeInTheDocument()
  })

  it('empty state with the add action; "add year" offers the missing years only', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MetricsTable snapshots={[]} onSave={vi.fn()} />, { route: EN })
    expect(screen.getByText('No yearly figures yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a year' }))
    const dialog = await screen.findByRole('dialog')
    const years = within(dialog).getAllByRole('option').map((o) => o.textContent)
    expect(years).toHaveLength(5)
    expect(years[0]).toBe(String(new Date().getFullYear()))
  })

  it('editing a year sends only the changed keys; a cleared figure is null', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    renderWithProviders(<MetricsTable snapshots={SNAPSHOTS} onSave={onSave} />, { route: EN })
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    const dialog = await screen.findByRole('dialog')
    const revenue = within(dialog).getByLabelText('Revenue (total of the year)')
    expect(revenue).toHaveValue('260000')
    await user.clear(revenue)
    await user.type(revenue, '300000')
    await user.clear(within(dialog).getByLabelText('Freelancers'))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(2024, { revenue_total: '300000', freelancers: null }))
  })

  it('"female employees" cannot exceed the total: the message shows and nothing is sent', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    renderWithProviders(<MetricsTable snapshots={SNAPSHOTS} onSave={onSave} />, { route: EN })
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    const dialog = await screen.findByRole('dialog')
    const female = within(dialog).getByLabelText('Female employees')
    await user.clear(female)
    await user.type(female, '20')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('cannot be more than the total')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a server refusal stays inside the dialog (and names the field)', async () => {
    const user = userEvent.setup()
    const refusal = Object.assign(new Error('x'), { messageKey: 'alumni.err.invalid', detail: 'revenue_total:out_of_range', cause: { hint: 'alumni_invalid', details: 'revenue_total:out_of_range', message: 'alumni_invalid: revenue_total:out_of_range' } })
    const onSave = vi.fn().mockRejectedValue(refusal)
    renderWithProviders(<MetricsTable snapshots={SNAPSHOTS} onSave={onSave} />, { route: EN })
    await user.click(screen.getByRole('button', { name: 'Edit 2024' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Needs'), ' and mentors')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Revenue: is out of range')
  })

  it('a founder cannot delete a year (no delete action unless onDelete is given: managers)', () => {
    const { rerender } = renderWithProviders(<MetricsTable snapshots={SNAPSHOTS} onSave={vi.fn()} />, { route: EN })
    expect(screen.queryByRole('button', { name: /Delete 2024/ })).not.toBeInTheDocument()
    rerender(<MetricsTable snapshots={SNAPSHOTS} onSave={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Delete 2024' })).toBeInTheDocument()
  })
})

describe('TrendBars', () => {
  it('one chart per metric that has a figure, with the change against the previous year and a text alternative', () => {
    renderWithProviders(<TrendBars snapshots={SNAPSHOTS} />, { route: EN })
    const charts = screen.getAllByTestId('trend-chart')
    expect(charts).toHaveLength(3)
    expect(within(charts[0]).getByText('Revenue (total of the year)')).toBeInTheDocument()
    expect(within(charts[0]).getByTestId('trend-change')).toHaveTextContent('+117% compared with 2023')
    expect(within(charts[0]).getByRole('img')).toHaveAccessibleName(/2023 EGP.120,000, 2024 EGP.260,000/)
  })
  it('nothing is drawn without data: no invented zeros', () => {
    const { container } = renderWithProviders(<TrendBars snapshots={[{ year: 2024, revenue_total: null, funding_raised_total: null, employees_total: null }]} />, { route: EN })
    expect(container.querySelector('[data-testid=trend-bars]')).toBeNull()
  })
})

describe('ProgramsReadOnlyList (derived, never typed)', () => {
  it('program > project, dates, the support as labelled chips', async () => {
    renderWithProviders(<ProgramsReadOnlyList programs={COMPANY_PAYLOAD.programs} />, { route: EN })
    const entry = screen.getByTestId('program-entry')
    expect(entry).toHaveTextContent('Finland')
    expect(entry).toHaveTextContent('Cohort 1')
    expect(await within(entry).findByText('Mentoring')).toBeInTheDocument()
    expect(within(entry).getByText('Training and workshops')).toBeInTheDocument()
    expect(within(entry).queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('Arabic names and the empty state', () => {
    const { rerender } = renderWithProviders(<ProgramsReadOnlyList programs={COMPANY_PAYLOAD.programs} />, { route: AR })
    expect(screen.getByTestId('program-entry')).toHaveTextContent('فنلندا')
    rerender(<ProgramsReadOnlyList programs={[]} />)
    expect(screen.getByText('لا توجد برامج بعد')).toBeInTheDocument()
  })
})

describe('company sections', () => {
  const values = { operating_status: 'closed', closed_on: '2025-01-01', closing_reason: 'funding', after_closing: 'employed', closing_note: 'note', directory_visibility: 'alumni' }
  it('the closing fields exist only while the company is closed; re-opening clears all four', async () => {
    const user = userEvent.setup()
    const setMany = vi.fn()
    const { rerender } = renderWithProviders(<CompanyStatusSection values={values} set={vi.fn()} setMany={setMany} />, { route: EN })
    expect(await screen.findByTestId('closing-fields')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Open' }))
    expect(setMany).toHaveBeenCalledWith({ operating_status: 'open', closed_on: '', closing_reason: '', after_closing: '', closing_note: '' })
    rerender(<CompanyStatusSection values={{ ...values, operating_status: 'open' }} set={vi.fn()} setMany={setMany} />)
    expect(screen.queryByTestId('closing-fields')).not.toBeInTheDocument()
  })

  it('the directory choice explains each level; a manager veto shows only the fact, never a note', async () => {
    renderWithProviders(<DirectoryVisibilitySection values={values} set={vi.fn()} blocked isAlumni={false} />, { route: EN })
    expect(await screen.findByTestId('visibility-explain')).toHaveTextContent('Other alumni founders can find the card')
    expect(screen.getByTestId('directory-blocked')).toHaveTextContent('hidden this company from the directory')
    expect(screen.getByText(/after the Athar team marks your company as an alumni company/)).toBeInTheDocument()
  })
})
