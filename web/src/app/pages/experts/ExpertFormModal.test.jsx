import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../../test/render.jsx'
import { ConfirmProvider } from '../../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../AuthContext.js'
import { normalizeCandidate, normalizeProfile } from '../../../lib/experts.js'

const T1 = '44444444-4444-4444-8444-444444444444'
const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), similar: { data: [] }, discard: vi.fn(), onClose: vi.fn() }))
vi.mock('../../../data/people.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useExpertActions: () => ({ create: { mutateAsync: mocks.create }, update: { mutateAsync: mocks.update } }),
    useSimilarExperts: () => mocks.similar,
    useExpertTags: () => ({ data: [{ id: T1, name: { en: 'Marketing', ar: 'التسويق' }, archived: false }, { id: 'old', name: { en: 'Legacy', ar: '' }, archived: true }] }),
    uploadExpertPhoto: vi.fn(),
    discardExpertPhoto: (...a) => mocks.discard(...a),
  }
})
vi.mock('../../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn(), removeImage: vi.fn() }))

import ExpertFormModal from './ExpertFormModal.jsx'

const profile = () => normalizeProfile({
  expert: { id: 'e1', kind: 'expert', name_en: 'Alaa Afifi', name_ar: 'علاء عفيفي', title_en: 'CEO', email: 'a@x.io', phone: '+20 100 000', linkedin_url: 'https://linkedin.com/in/a', languages: ['ar'], links: [], notes: 'n', photo_path: 'global/expert-photo/old.webp', updated_at: '2026-10-01T10:00:00.123456+00:00' },
  tags: [{ id: T1, name_en: 'Marketing', name_ar: 'التسويق' }],
})
const pm = { user: { id: 'u1' }, roles: ['project_manager'], areas: ['staff'], status: 'authed', hasRole: () => false, can: () => false, signIn: vi.fn(), signOut: vi.fn(), reloadRoles: vi.fn() }
const admin = { ...pm, roles: ['super_admin'], can: (p) => p === 'experts:merge' }

function mount({ expert = null, auth = pm } = {}) {
  return renderWithProviders(
    <ConfirmProvider>
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route path="/network/experts" element={<ExpertFormModal expert={expert} base="/network/experts" onClose={mocks.onClose} />} />
          <Route path="/network/experts/:id" element={<p data-testid="landed">profile page</p>} />
        </Routes>
      </AuthContext.Provider>
    </ConfirmProvider>,
    { route: '/network/experts?lang=en' },
  )
}
const field = (dialog, label, index = 0) => within(dialog).getAllByLabelText(label)[index]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.similar = { data: [] }
  mocks.create.mockResolvedValue({ id: 'new1', updatedAt: 'T' })
  mocks.update.mockResolvedValue({ id: 'e1', updatedAt: 'T2', oldPhotoPath: null })
  mocks.discard.mockResolvedValue(undefined)
})

describe('Expert form: create', () => {
  it('refuses a form without a name (inline, in the field group) and does not call the server', async () => {
    const user = userEvent.setup()
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Add an expert' })
    await user.click(within(dialog).getByTestId('expert-save'))
    expect(await within(dialog).findByText('Enter the name in at least one language.')).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('creates the record from the cleaned form (e-mail lower-cased, link completed) and lands on the new profile', async () => {
    const user = userEvent.setup()
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Add an expert' })
    await user.type(field(dialog, 'English', 0), '  Sara  Ali ')
    await user.type(field(dialog, 'English', 1), 'CTO')
    await user.type(within(dialog).getByLabelText('E-mail'), ' SARA@Acme.IO ')
    await user.type(within(dialog).getByLabelText('LinkedIn'), 'linkedin.com/in/sara')
    await user.click(within(dialog).getByRole('button', { name: 'Arabic' }))
    await user.click(within(dialog).getByTestId('expert-save'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    const { payload, force } = mocks.create.mock.calls[0][0]
    expect(force).toBe(false)
    expect(payload).toMatchObject({ name_en: 'Sara  Ali', title_en: 'CTO', name_ar: null, email: 'sara@acme.io', linkedin_url: 'https://linkedin.com/in/sara', languages: ['ar'], kind: 'expert', tags: [] })
    expect(await screen.findByTestId('landed')).toBeInTheDocument()
    expect(mocks.onClose).toHaveBeenCalled()
    expect(await screen.findByText('Expert added.')).toBeInTheDocument()
  })

  it('tags: pick an existing suggestion, or create a new one by name; archived tags are not offered; the payload carries ids and new names', async () => {
    const user = userEvent.setup()
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Add an expert' })
    await user.type(field(dialog, 'English', 0), 'Tag Person')
    const tagBox = within(dialog).getByRole('textbox', { name: 'Expertise' })
    await user.click(within(dialog).getByRole('button', { name: 'Marketing' })) // the suggestion list
    expect(within(dialog).queryByRole('button', { name: 'Legacy' })).toBeNull()
    await user.type(tagBox, 'Space Law')
    await user.click(within(dialog).getByTestId('tag-create'))
    expect(within(dialog).getAllByRole('listitem').some((li) => li.textContent.includes('Space Law'))).toBe(true)
    await user.click(within(dialog).getByTestId('expert-save'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalled())
    expect(mocks.create.mock.calls[0][0].payload.tags).toEqual([T1, { name_en: 'Space Law', name_ar: null }])
  })

  it('a LIKELY DUPLICATE is shown while typing; the first save is refused by the server, then "add anyway" is a deliberate choice sent as force', async () => {
    const user = userEvent.setup()
    const dup = normalizeCandidate({ id: 'e9', score: 1, reasons: ['same_linkedin', 'same_name'], blocking: true, expert: { id: 'e9', kind: 'expert', name_en: 'Sara Ali', title_en: 'CTO' } })
    mocks.similar = { data: [dup] }
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', token: 'expert_duplicate', duplicates: [dup] }))
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Add an expert' })
    await user.type(field(dialog, 'English', 0), 'Sara Ali')
    const panel = await within(dialog).findByTestId('duplicate-panel')
    expect(within(panel).getByText('This person is probably already in the registry')).toBeInTheDocument()
    expect(within(panel).getByText('Same LinkedIn profile')).toBeInTheDocument()
    expect(within(panel).getAllByRole('link', { name: /Sara Ali/ })[0]).toHaveAttribute('href', '/network/experts/e9')
    await user.click(within(dialog).getByTestId('expert-save'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create.mock.calls[0][0].force).toBe(false)
    expect(await within(dialog).findByText(/A likely duplicate already exists/)).toBeInTheDocument()
    expect(mocks.onClose).not.toHaveBeenCalled()
    await user.click(within(dialog).getByTestId('duplicate-confirm'))
    await user.click(within(dialog).getByTestId('expert-save'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(mocks.create.mock.calls[1][0].force).toBe(true)
  })

  it('the kind (expert / Athar team member) is chosen when creating; an edit hides it from a project manager', async () => {
    const user = userEvent.setup()
    const { unmount } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'Add an expert' })
    await user.click(within(dialog).getByLabelText('Athar team member'))
    await user.type(field(dialog, 'English', 0), 'Team Person')
    await user.click(within(dialog).getByTestId('expert-save'))
    await waitFor(() => expect(mocks.create.mock.calls[0][0].payload.kind).toBe('team'))
    unmount()
    mount({ expert: profile() })
    const edit = await screen.findByRole('dialog', { name: 'Edit the profile' })
    expect(within(edit).queryByLabelText('Athar team member')).toBeNull()
  })

  it('closing a dirty form asks to discard; a clean one closes at once', async () => {
    const user = userEvent.setup()
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Add an expert' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
    mocks.onClose.mockClear()
    await user.type(field(dialog, 'English', 0), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    const ask = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    expect(mocks.onClose).not.toHaveBeenCalled()
    await user.click(within(ask).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1))
  })
})

describe('Expert form: edit', () => {
  it('opens prefilled; Save stays disabled until something changes; sends ONLY the changed keys with the loaded updated_at token', async () => {
    const user = userEvent.setup()
    mount({ expert: profile() })
    const dialog = await screen.findByRole('dialog', { name: 'Edit the profile' })
    expect(field(dialog, 'English', 0)).toHaveValue('Alaa Afifi')
    expect(within(dialog).getByLabelText('E-mail')).toHaveValue('a@x.io')
    const save = within(dialog).getByTestId('expert-save')
    expect(save).toBeDisabled()
    await user.clear(field(dialog, 'English', 1))
    await user.type(field(dialog, 'English', 1), 'Founder')
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    expect(mocks.update.mock.calls[0][0]).toEqual({ id: 'e1', patch: { title_en: 'Founder' }, expectedAt: '2026-10-01T10:00:00.123456+00:00' })
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalled())
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
  })

  it('a replaced photo: the OLD files are removed after the save (best effort)', async () => {
    const user = userEvent.setup()
    mocks.update.mockResolvedValueOnce({ id: 'e1', updatedAt: 'T2', oldPhotoPath: 'global/expert-photo/old.webp' })
    mount({ expert: profile() })
    const dialog = await screen.findByRole('dialog', { name: 'Edit the profile' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove the photo' }))
    await user.click(within(dialog).getByTestId('expert-save'))
    await waitFor(() => expect(mocks.update).toHaveBeenCalled())
    expect(mocks.update.mock.calls[0][0].patch).toEqual({ photo_path: null })
    await waitFor(() => expect(mocks.discard).toHaveBeenCalledWith('global/expert-photo/old.webp'))
  })

  it('somebody saved first: the dialog explains it and offers to reload instead of overwriting', async () => {
    const user = userEvent.setup()
    mocks.update.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', token: 'expert_stale', code: 'conflict' }))
    mount({ expert: profile() })
    const dialog = await screen.findByRole('dialog', { name: 'Edit the profile' })
    await user.type(within(dialog).getByLabelText('Phone'), '1')
    await user.click(within(dialog).getByTestId('expert-save'))
    const stale = await within(dialog).findByTestId('expert-stale')
    expect(within(stale).getByText('The profile changed')).toBeInTheDocument()
    expect(within(dialog).getByTestId('expert-save')).toBeDisabled()
    await user.click(within(stale).getByRole('button', { name: 'Reload the profile' }))
    expect(mocks.onClose).toHaveBeenCalled()
  })

  it('a field refusal of the server (expert_invalid, detail "email:invalid") is shown under THAT field', async () => {
    const user = userEvent.setup()
    mocks.update.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', token: 'expert_invalid', detail: 'email:invalid' }))
    mount({ expert: profile() })
    const dialog = await screen.findByRole('dialog', { name: 'Edit the profile' })
    await user.type(within(dialog).getByLabelText('Phone'), '1')
    await user.click(within(dialog).getByTestId('expert-save'))
    expect(await within(dialog).findByText('Enter a valid e-mail address.')).toBeInTheDocument()
  })

  it('client validation: a bad e-mail / phone / link is explained before any call', async () => {
    const user = userEvent.setup()
    mount({ expert: profile() })
    const dialog = await screen.findByRole('dialog', { name: 'Edit the profile' })
    await user.clear(within(dialog).getByLabelText('E-mail'))
    await user.type(within(dialog).getByLabelText('E-mail'), 'nope')
    await user.clear(within(dialog).getByLabelText('Phone'))
    await user.type(within(dialog).getByLabelText('Phone'), 'call me')
    await user.click(within(dialog).getByTestId('expert-save'))
    expect(await within(dialog).findByText('Enter a valid e-mail address.')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter a valid phone number (digits, +, spaces).')).toBeInTheDocument()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('the private notes field says it is private; a super_admin may change the kind', async () => {
    mount({ expert: profile(), auth: admin })
    const dialog = await screen.findByRole('dialog', { name: 'Edit the profile' })
    expect(within(dialog).getByText(/Private: never shown to founders/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Athar team member')).toBeInTheDocument()
  })

  it('the stale-profile notice is brought into view when it appears (Save is at the bottom of a scrolling dialog: the reason must not stay out of sight)', async () => {
    const user = userEvent.setup()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    mocks.update.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AppError', token: 'expert_stale', code: 'conflict' }))
    mount({ expert: profile() })
    const dialog = await screen.findByRole('dialog', { name: 'Edit the profile' })
    await user.type(within(dialog).getByLabelText('Phone'), '1')
    await user.click(within(dialog).getByTestId('expert-save'))
    await within(dialog).findByTestId('expert-stale')
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    delete Element.prototype.scrollIntoView
  })

  it('a duplicate match offers ONE named "Open" link (its accessible name says whose record) with a 44 px target, next to the record line', async () => {
    const user = userEvent.setup()
    mocks.similar = { data: [normalizeCandidate({ id: 'e9', score: 0.8, reasons: ['similar_name'], blocking: false, expert: { id: 'e9', kind: 'expert', name_en: 'Sara Ali', title_en: 'CTO' } })] }
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Add an expert' })
    await user.type(field(dialog, 'English', 0), 'Sara Alii')
    const panel = await within(dialog).findByTestId('duplicate-panel')
    const open = within(panel).getByRole('link', { name: 'Open: Sara Ali' })
    expect(open).toHaveAttribute('href', '/network/experts/e9')
    expect(open.className).toMatch(/min-h-11/)
  })
})
