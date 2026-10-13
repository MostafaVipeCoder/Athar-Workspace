import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import PublicFormPage from '../../app/pages/PublicFormPage.jsx'
import manifest from './manifest.js'

const defRows = () => ({
  form: { node_id: 'F', project_id: 'P', is_active: true, opens_at: null, closes_at: null, max_responses: null, one_response_per_email: false, cover_id: null, cover_path: null, export_sheet_id: null, export_sheet_tab: null },
  sections: [],
  questions: [
    { id: '11111111-1111-4111-8111-111111111111', key: 'q010', type: 'email', semantic: null, label_en: 'Email / البريد الإلكتروني', is_required: true, order_index: 0, options: null, validation: null },
    { id: '22222222-2222-4222-8222-222222222222', key: 'company_name', type: 'text', semantic: 'company_name', label_en: 'Company', label_ar: 'الشركة', is_required: true, order_index: 1, options: null, validation: null },
  ],
})
const responseRows = () => [
  { id: 'r1', answers: { company_name: 'Nile Robotics', q010: 'f@x.io' }, source: 'facebook', tracking: { utm_medium: 'paid' }, status: 'submitted', submitted_at: '2026-10-11T10:00:00Z' },
  { id: 'r2', answers: { company_name: 'Delta Farms', q010: 'd@x.io' }, source: null, tracking: {}, status: 'reviewed', submitted_at: '2026-10-10T10:00:00Z' },
]

const mocks = vi.hoisted(() => ({
  getDef: vi.fn(), listResponses: vi.fn(), setStatus: vi.fn(), remove: vi.fn(), restore: vi.fn(), getLink: vi.fn(), ensureLink: vi.fn(), events: vi.fn(), covers: vi.fn(), templates: vi.fn(),
  getPublicForm: vi.fn(), submit: vi.fn(), track: vi.fn(), upload: vi.fn(),
}))

vi.mock('../../data/forms.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    FORM_LINK_KIND: 'form',
    getFormDefinition: mocks.getDef, listResponses: mocks.listResponses, getFormLink: mocks.getLink,
    getPublicForm: mocks.getPublicForm, submitPublicForm: mocks.submit, trackFormEvent: mocks.track, uploadFormFile: mocks.upload, signedFileUrl: async () => 'http://signed',
    useFormDefinition: (id) => useQuery({ queryKey: ['node', id, 'form'], queryFn: () => mocks.getDef(id) }),
    useFormResponses: (id) => useQuery({ queryKey: ['node', id, 'responses'], queryFn: () => mocks.listResponses(id) }),
    useFormEvents: (id) => useQuery({ queryKey: ['node', id, 'events'], queryFn: () => mocks.events() }),
    useFormCovers: (p) => useQuery({ queryKey: ['formCovers', p], queryFn: () => mocks.covers() }),
    useFormTemplates: (p) => useQuery({ queryKey: ['formTemplates', p], queryFn: () => mocks.templates() }),
    useFormLink: (id) => useQuery({ queryKey: ['node', id, 'formLink'], queryFn: () => mocks.getLink() }),
    usePublicForm: (ref) => useQuery({ queryKey: ['public', 'form', ref], queryFn: () => mocks.getPublicForm(ref), enabled: Boolean(ref) }),
    useFormMutations: (id) => {
      const qc = useQueryClient()
      const after = () => qc.invalidateQueries({ queryKey: ['node', id] })
      const useM = (fn) => useMutation({ mutationFn: fn, onSuccess: after })
      const m = useM
      return {
        setStatus: m(({ id: rid, status }) => mocks.setStatus(rid, status)), remove: m(({ id: rid }) => mocks.remove(rid)), restore: m(({ id: rid }) => mocks.restore(rid)),
        ensureLink: useMutation({ mutationFn: () => mocks.ensureLink(), onSuccess: () => qc.invalidateQueries({ queryKey: ['node', id, 'formLink'] }) }),
        createCover: useMutation({ mutationFn: async () => null }), deleteCover: useMutation({ mutationFn: async () => null }),
        createTemplate: useMutation({ mutationFn: async () => null }), deleteTemplate: useMutation({ mutationFn: async () => null }),
      }
    },
  }
})
vi.mock('../../data/storage.js', () => ({ publicImageUrl: (p) => (p ? `http://img/${p}` : ''), publicThumbUrl: (p) => (p ? `http://img/t/${p}` : ''), uploadImage: vi.fn(), removeImage: vi.fn() }))

const auth = { user: { id: 'u1' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const node = { id: 'F', project_id: 'P', type: 'form_builder', type_version: 1, name_en: 'Apply form', name_ar: 'نموذج التقديم', visibility: 'public', show_to_participants: false, config: { thank_you: { message: 'Thanks {company}!' } }, rev: 1 }
const graph = { project: { id: 'P', timezone: 'Africa/Cairo' }, nodes: [{ id: 'F', type: 'form_builder' }, { id: 'L', type: 'list' }], edges: [{ from_node_id: 'F', from_port: 'responses', to_node_id: 'L', to_port: 'items-in', is_enabled: true }] }

function mount(mode, over = {}) {
  const adapter = createMemoryAdapter({ nodes: [{ ...node, ...over }], edges: graph.edges })
  renderWithProviders(
    <AuthContext.Provider value={auth}><ConfirmProvider><NodeHost mode={mode} node={{ ...node, ...over }} graph={graph} projectId="P" adapter={adapter} /></ConfirmProvider></AuthContext.Provider>,
    { route: '/projects/P/nodes/F?lang=en' },
  )
  return adapter
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getDef.mockImplementation(async () => defRows())
  mocks.listResponses.mockImplementation(async () => responseRows())
  mocks.events.mockResolvedValue([{ event_type: 'form_view', platform: null }, { event_type: 'form_share', platform: 'whatsapp' }])
  mocks.getLink.mockResolvedValue({ linkId: 'lk', slug: 'abc123xyz0', enabled: true })
  mocks.covers.mockResolvedValue([])
  mocks.templates.mockResolvedValue([])
  mocks.submit.mockResolvedValue({ id: 'new', accepted: true })
})

describe('Form Builder node', () => {
  it('manifest exposes resolvers for responses and link; no inputs', () => {
    expect(manifest.ports.in).toEqual([])
    expect(manifest.ports.out.find((p) => p.key === 'responses').resolve).toBeTypeOf('function')
    expect(manifest.ports.out.find((p) => p.key === 'link').resolve).toBeTypeOf('function')
    expect(manifest.visibility.showToParticipants).toBe(false)
  })

  it('Edit: shows the roles panel, suggests a role from the label and saves config + children in ONE save_node call', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const rows = await screen.findAllByTestId('question-row')
    expect(rows).toHaveLength(2)
    expect(within(screen.getByTestId('semantics-panel')).getByTestId('role-founder_email')).toHaveValue('')
    // expand the e-mail question: the label suggests the founder e-mail role; one click applies it (key becomes the role)
    await user.click(within(rows[0]).getByRole('button', { name: 'Expand' }))
    const suggestion = await screen.findByTestId('semantic-suggestion')
    expect(suggestion).toHaveTextContent('Mark as "Founder e-mail"?')
    await user.click(within(suggestion).getByRole('button', { name: 'Yes, mark it' }))
    expect(screen.getByTestId('role-founder_email')).toHaveValue('11111111-1111-4111-8111-111111111111')
    expect(within(screen.getAllByTestId('question-row')[0]).getByText('founder_email')).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    const saved = adapter.snapshot().nodes[0]
    expect(saved.children.questions.map((q) => [q.key, q.semantic])).toEqual([['founder_email', 'founder_email'], ['company_name', 'company_name']])
    expect(saved.children.form).toEqual({ cover_id: null })
    expect(saved.config.thank_you.message.en).toBe('Thanks {company}!')
    expect(await screen.findByText('Form saved.')).toBeInTheDocument()
  })

  it('Edit: add question, duplicate, remove (confirm) and validation blocks an empty label', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('question-row')
    await user.click(screen.getByTestId('add-question'))
    expect(screen.getAllByTestId('question-row')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Fix the highlighted questions before saving.')).toBeInTheDocument()
    expect(screen.getByText('Enter the question in at least one language.')).toBeInTheDocument()
    await user.click(within(screen.getAllByTestId('question-row')[1]).getByRole('button', { name: 'Duplicate' }))
    expect(screen.getAllByTestId('question-row')).toHaveLength(4)
    expect(within(screen.getAllByTestId('question-row')[2]).getByText('Company (copy)')).toBeInTheDocument()
    await user.click(within(screen.getAllByTestId('question-row')[3]).getByRole('button', { name: /^Remove:/ }))
    const dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getAllByTestId('question-row')).toHaveLength(3))
  })

  it('Edit > Responses: table with semantic title, status change, delete with confirm + undo, analytics and source links', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findAllByTestId('question-row')
    await user.click(screen.getByTestId('tab-responses'))
    const rows = await screen.findAllByTestId('response-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Nile Robotics')).toBeInTheDocument()
    await user.selectOptions(within(rows[0]).getByRole('combobox', { name: /Status: Nile Robotics/ }), 'reviewed')
    await waitFor(() => expect(mocks.setStatus).toHaveBeenCalledWith('r1', 'reviewed'))
    await user.click(within(rows[1]).getByRole('button', { name: 'Delete: Delta Farms' }))
    const dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('r2'))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('r2'))
    await user.click(screen.getByRole('button', { name: 'Analytics' }))
    const analytics = await screen.findByTestId('responses-analytics')
    expect(analytics).toHaveTextContent('1 views · 1 shares')
    expect(within(analytics).getByText('facebook')).toBeInTheDocument()
    expect(within(screen.getByTestId('source-links')).getAllByRole('button').length).toBeGreaterThan(2)
    // drawer
    await user.click(within(rows[0]).getByRole('button', { name: 'Open' }))
    const drawer = await screen.findByTestId('response-drawer')
    expect(drawer).toHaveTextContent('utm_medium=paid')
  })

  it('View: PM preview renders the same renderer; a valid preview submission stores nothing', async () => {
    const user = userEvent.setup()
    mount('view')
    const form = await screen.findByTestId('form-renderer')
    expect(within(form).getByRole('heading', { level: 1 })).toHaveTextContent('Apply form')
    await user.type(within(form).getByLabelText(/Email/), 'a@b.co')
    await user.type(within(form).getByLabelText(/Company/), 'Nile')
    await user.click(screen.getByTestId('form-submit'))
    expect(await screen.findByTestId('form-success')).toHaveTextContent('Thanks Nile!')
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('Settings: saves name/visibility + config + the forms row (children) in one call; creates the link', async () => {
    const user = userEvent.setup()
    const adapter = mount('settings')
    await screen.findByTestId('form-settings')
    await user.click(screen.getByTestId('is-active'))
    await user.click(screen.getByTestId('notify-pm'))
    await user.click(screen.getByLabelText(/Private/))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    const saved = adapter.snapshot().nodes[0]
    expect(saved.visibility).toBe('private')
    expect(saved.config.notify_pm).toBe(true)
    expect(saved.children.form).toMatchObject({ is_active: false, one_response_per_email: false, max_responses: null })
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    expect(screen.getByText(/abc123xyz0/)).toBeInTheDocument()
  })
})

describe('/forms/:ref public page', () => {
  const payload = (over = {}) => ({
    node_id: 'F', project_id: 'P', name_en: 'Apply form', name_ar: 'نموذج', description_en: 'Tell us about you', audience: 'public', slug: 'abc123xyz0', is_open: true, closed_reason: null, allow_uploads: false,
    thank_you: { message: { en: 'Thanks {company}', ar: 'شكراً {company}' }, show_image: false }, social: { whatsapp: true, facebook: false, linkedin: true, telegram: true, instagram: true, custom: [] },
    sections: [{ id: 's1', title_en: 'Company', order_index: 0 }, { id: 's2', title_en: 'Founder', order_index: 1 }],
    questions: [
      { id: 'q1', section_id: 's1', key: 'company_name', type: 'text', semantic: 'company_name', label_en: 'Company', is_required: true, order_index: 0 },
      { id: 'q2', section_id: 's2', key: 'founder_email', type: 'email', semantic: 'founder_email', label_en: 'E-mail', is_required: true, order_index: 1 },
      { id: 'q3', section_id: 's2', key: 'phone', type: 'tel', semantic: 'phone', label_en: 'Phone', is_required: false, order_index: 2, validation: { allowed_countries: ['EG'] } },
      { id: 'q4', section_id: null, key: 'ref', type: 'hidden', label_en: 'ref', is_required: false, order_index: 3 },
    ],
    ...over,
  })
  const mountPublic = (route = '/forms/abc123xyz0?lang=en') =>
    renderWithProviders(<AuthContext.Provider value={{ status: 'anon' }}><Routes><Route path="/forms/:ref" element={<PublicFormPage />} /></Routes></AuthContext.Provider>, { route })

  it('renders steps, validates per step, submits cleaned answers with tracking + hidden prefill, shows thank-you with share', async () => {
    const user = userEvent.setup()
    mocks.getPublicForm.mockResolvedValue(payload())
    mountPublic('/forms/abc123xyz0?lang=en&utm_source=fb&ref=camp1')
    const form = await screen.findByTestId('form-renderer')
    expect(form).toHaveTextContent('Step 1 of 2')
    expect(mocks.track).toHaveBeenCalledWith('abc123xyz0', 'form_view')
    await user.click(screen.getByTestId('form-next'))
    expect(await screen.findByText('This answer is required.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Company/), '  Nile Robotics ')
    await user.click(screen.getByTestId('form-next'))
    expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/E-mail/), 'Founder@X.IO')
    await user.type(screen.getByLabelText(/Phone/), '01012345678')
    await user.click(screen.getByTestId('form-submit'))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith('abc123xyz0', { company_name: 'Nile Robotics', founder_email: 'founder@x.io', phone: '+201012345678', ref: 'camp1' }, expect.objectContaining({ source: 'fb', utm_source: 'fb', lang: 'en' }), null))
    const success = await screen.findByTestId('form-success')
    expect(success).toHaveTextContent('Thanks Nile Robotics')
    expect(within(success).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', expect.stringContaining('source%3Dwhatsapp'))
    expect(within(success).queryByRole('link', { name: 'Facebook' })).toBeNull()
  })

  it('maps a server field error back onto the question and shows the closed state', async () => {
    const user = userEvent.setup()
    mocks.getPublicForm.mockResolvedValue(payload({ sections: [], questions: [{ id: 'q2', key: 'founder_email', type: 'email', label_en: 'E-mail', is_required: true, order_index: 0 }] }))
    const { AppError } = await import('../../data/errors.js')
    const err = new AppError('validation', { messageKey: 'form.err.invalid', detail: 'founder_email:email' })
    err.token = 'form_invalid'
    mocks.submit.mockRejectedValueOnce(err)
    mountPublic()
    await user.type(await screen.findByLabelText(/E-mail/), 'a@b.co')
    await user.click(screen.getByTestId('form-submit'))
    expect(await screen.findByText('Enter a valid e-mail address.')).toBeInTheDocument()
  })

  it('closed form and unknown ref', async () => {
    mocks.getPublicForm.mockResolvedValueOnce(payload({ is_open: false, closed_reason: 'closed', closes_at: '2026-10-01T10:00:00Z' }))
    mountPublic()
    expect(await screen.findByTestId('form-closed')).toHaveTextContent('This form is closed')
  })

  it('unknown or private form: not available + sign-in hint for anonymous visitors', async () => {
    mocks.getPublicForm.mockResolvedValueOnce(null)
    mountPublic()
    expect(await screen.findByText('This form is not available.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })
})
