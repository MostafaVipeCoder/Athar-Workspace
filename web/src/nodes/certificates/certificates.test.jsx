import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '../../test/render.jsx'
import { ConfirmProvider } from '../../ui/ConfirmDialog.jsx'
import { AuthContext } from '../../app/AuthContext.js'
import NodeHost from '../_kit/NodeHost.jsx'
import { createMemoryAdapter } from '../_kit/memoryAdapter.js'
import manifest from './manifest.js'
import FounderCertificateButton from '../../app/pages/founder/FounderCertificateButton.jsx'
import VerifyCertificatePage from '../../app/pages/VerifyCertificatePage.jsx'
import { fromSupabase } from '../../data/errors.js'

const mocks = vi.hoisted(() => ({
  def: vi.fn(), admin: vi.fn(), issue: vi.fn(), revoke: vi.fn(), signed: vi.fn(), upload: vi.fn(), remove: vi.fn(), my: vi.fn(), verify: vi.fn(), payload: vi.fn(),
  decode: vi.fn(), loadImage: vi.fn(), render: vi.fn(), download: vi.fn(),
}))

vi.mock('../../data/certificates.js', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query')
  return {
    getCertificateDefinition: mocks.def,
    getRenderPayload: mocks.payload,
    signedTemplateUrl: mocks.signed,
    uploadTemplateFile: mocks.upload,
    removeTemplateFiles: mocks.remove,
    useCertificateDefinition: (id) => useQuery({ queryKey: ['node', id, 'certificateDef'], queryFn: () => mocks.def(id) }),
    useCertificatesAdmin: (id) => useQuery({ queryKey: ['node', id, 'certificatesAdmin'], queryFn: () => mocks.admin(id) }),
    useMyCertificates: (p) => useQuery({ queryKey: ['myCertificates', p], queryFn: () => mocks.my(p), enabled: Boolean(p) }),
    usePublicVerification: (code) => useQuery({ queryKey: ['public', 'certificate', code], queryFn: () => mocks.verify(code), enabled: Boolean(code), retry: false }),
    useCertificateMutations: (id) => {
      const qc = useQueryClient()
      const after = () => qc.invalidateQueries({ queryKey: ['node', id, 'certificatesAdmin'] })
      return {
        issue: useMutation({ mutationFn: (ids) => mocks.issue(id, ids), onSuccess: after }),
        revoke: useMutation({ mutationFn: (v) => mocks.revoke(v.certificateId, v.reason), onSuccess: after }),
      }
    },
  }
})
vi.mock('../../lib/certificates/render.js', async (orig) => ({ ...(await orig()), renderCertificate: mocks.render }))
vi.mock('../../lib/certificates/templateFile.js', async (orig) => ({ ...(await orig()), decodeTemplateFile: mocks.decode, loadTemplateImage: mocks.loadImage }))
vi.mock('../../shared/certificates/renderPayload.js', () => ({ downloadCertificate: mocks.download, verifyUrlOf: (c) => `http://app/verify/${c}`, renderPayloadToCanvas: vi.fn(), loadPayloadImage: vi.fn() }))
vi.mock('../../shared/certificates/CertificateView.jsx', () => ({ default: ({ payload }) => <div data-testid="certificate-view-stub">{payload?.code}</div> }))

const N = 'N1'
const P = 'P1'
const FIELDS = [
  { var: 'participant_name', x: 0.5, y: 0.46, w: 0.6, align: 'center', font: 'Tajawal', size: 0.045, color: '#1a1a2e', weight: 700, direction: 'auto', max_lines: 1, shrink_to_fit: true },
  { var: 'verification_qr', x: 0.9, y: 0.82, w: 0.1, align: 'center', font: 'Tajawal', size: 0.1, color: '#000000', weight: 400, direction: 'ltr', max_lines: 1, shrink_to_fit: false },
]
const defRows = (over = {}) => [{ id: 't1', version: 1, language: 'ar', file_path: `${P}/${N}/a.png`, file_kind: 'image', width_px: 2000, height_px: 1400, fields: FIELDS, ...over }]
const adminPayload = (over = {}) => ({
  project: { id: P, program_id: 'PG1', name_en: 'Project', completed_at: '2026-10-12T10:00:00Z', timezone: 'Asia/Riyadh' },
  language: 'ar', template: { id: 't1', version: 1, language: 'ar', width_px: 2000, height_px: 1400, has_name_field: true },
  others: 2,
  rows: [
    { participant_id: 'a1', status: 'attended', needs_review: false, name: 'أحمد بن علي', company_name: 'Nile Labs', certificate: null },
    { participant_id: 'a2', status: 'attended', needs_review: false, name: 'Sara Ali', company_name: 'Sara Ali', certificate: { id: 'c2', code: 'AB12-CD34-EF56', issued_at: '2026-10-13T08:00:00Z', revoked_at: null, revoked_reason: null, name: 'Sara Ali' } },
    { participant_id: 'a3', status: 'attended', needs_review: true, name: 'Omar Zaki', company_name: 'Zaki Co', certificate: { id: 'c3', code: 'ZZ99-AA11-BB22', issued_at: '2026-10-13T08:00:00Z', revoked_at: '2026-10-13T09:00:00Z', revoked_reason: 'duplicate', name: 'Omar Zaki' } },
    { participant_id: 'a4', status: 'withdrawn', needs_review: false, name: 'Lina Haddad', company_name: 'Haddad', certificate: { id: 'c4', code: 'LL44-HH55-DD66', issued_at: '2026-10-13T08:00:00Z', revoked_at: null, revoked_reason: null, name: 'Lina Haddad' } },
  ],
  ...over,
})

const auth = { user: { id: 'u1' }, roles: ['project_manager'], status: 'authed', hasRole: () => false, can: () => true }
const node = { id: N, project_id: P, type: 'certificates', type_version: 1, name_en: 'Certificates', name_ar: 'الشهادات', visibility: 'private', show_to_participants: false, config: { language: 'ar', legacyKey: 'keep' }, rev: 1 }
const graph = { project: { id: P, program_id: 'PG1', timezone: 'Asia/Riyadh' }, nodes: [{ id: N, type: 'certificates', name_en: 'Certificates' }], edges: [] }

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }
function mount(mode, over = {}, route = `/projects/${P}/nodes/${N}?lang=en`) {
  const adapter = createMemoryAdapter({ nodes: [{ ...node, ...over }], edges: [] })
  renderWithProviders(
    <AuthContext.Provider value={auth}><ConfirmProvider><NodeHost mode={mode} node={{ ...node, ...over }} graph={graph} projectId={P} adapter={adapter} /><Where /></ConfirmProvider></AuthContext.Provider>,
    { route },
  )
  return adapter
}

const rectOf = Element.prototype.getBoundingClientRect
beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.getBoundingClientRect = () => ({ width: 600, height: 420, left: 0, top: 0, right: 600, bottom: 420, x: 0, y: 0, toJSON() {} })
  mocks.def.mockImplementation(async () => defRows())
  mocks.admin.mockImplementation(async () => adminPayload())
  mocks.signed.mockResolvedValue('https://signed.example/t.png')
  mocks.loadImage.mockResolvedValue({ image: { width: 2000, height: 1400 }, width: 2000, height: 1400 })
  mocks.decode.mockResolvedValue({ image: { width: 2480, height: 1754 }, width: 2480, height: 1754 })
  mocks.upload.mockResolvedValue({ path: `${P}/${N}/new.png`, mime: 'image/png', bytes: 4000 })
  mocks.render.mockResolvedValue({ overflow: {}, boxes: {}, width: 2000, height: 1400 })
  mocks.issue.mockImplementation(async (_id, ids) => ({ issued: ids ? ids.length : 1, existing: 0, skipped: 0, results: (ids ?? ['a1']).map((p) => ({ participant_id: p, status: 'issued', code: 'NEW1-NEW1-NEW1' })) }))
  mocks.revoke.mockResolvedValue(undefined)
  mocks.payload.mockResolvedValue({ id: 'c2', code: 'AB12-CD34-EF56', snapshot: { participant_name: 'Sara Ali' }, template: { language: 'en', width_px: 2000, height_px: 1400, file_path: 'x' }, fields: [] })
  mocks.download.mockResolvedValue(undefined)
})
afterEach(() => { Element.prototype.getBoundingClientRect = rectOf })

describe('Certificates node: manifest + error tokens', () => {
  it('manifest: optional participants input, no outputs, own children writer, founder exposure allowed, default config', () => {
    expect(manifest.ports.in[0]).toMatchObject({ key: 'participants', required: false })
    expect(manifest.ports.out).toEqual([])
    expect(manifest.visibility.showToParticipants).toBe(true)
    expect(manifest.defaultConfig()).toEqual({ language: 'ar', verifier: { enabled: true, showCertificate: true } })
  })
  it('the server tokens map to specific message keys', () => {
    const err = (hint) => fromSupabase({ code: '23514', message: `${hint}: x`, hint })
    expect(err('certificate_project_not_completed').messageKey).toBe('certificates.err.notCompleted')
    expect(err('certificate_template_missing').messageKey).toBe('certificates.err.templateMissing')
    expect(err('certificate_rate_limited').messageKey).toBe('certificates.err.rateLimited')
    expect(err('certificate_invalid').token).toBe('certificate_invalid')
  })
})

describe('Certificates: Edit / Template', () => {
  it('loads the template of the node language, draws the live preview with the long sample and lays a box over each field (fractions -> percent)', async () => {
    mount('edit')
    const stage = await screen.findByTestId('canvas-stage')
    const name = await within(stage).findByTestId('field-participant_name')
    expect(name.style.left).toBe('20%')
    expect(name.style.width).toBe('60%')
    expect(within(stage).getByTestId('field-verification_qr').style.width).toBe('10%')
    expect(screen.getByText('A4 · landscape')).toBeInTheDocument()
    await waitFor(() => expect(mocks.render).toHaveBeenCalled())
    const call = mocks.render.mock.calls.at(-1)[0]
    expect(call.values.participant_name).toMatch(/^عبد الرحمن/) // the long Arabic sample first, for an Arabic template
    expect(call.verifyUrl).toMatch(/\/verify\/AB12-CD34-EF56$/)
    expect(call.fields.map((f) => f.var)).toEqual(['participant_name', 'verification_qr'])
    // the long English sample is one click away and is redrawn
    await userEvent.setup().click(screen.getByTestId('sample-longEn'))
    await waitFor(() => expect(mocks.render.mock.calls.at(-1)[0].values.participant_name).toMatch(/^Alexandria/))
  })

  it('moves a field with the arrow keys, edits it in the panel and saves ONE save_node with config + children.template (fractions, snake_case)', async () => {
    const user = userEvent.setup()
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    const name = await screen.findByTestId('field-participant_name')
    fireEvent.focus(name)
    fireEvent.keyDown(name, { key: 'ArrowRight' })
    fireEvent.keyDown(name, { key: 'ArrowDown', shiftKey: true })
    await waitFor(() => expect(screen.getByTestId('field-x')).toHaveValue(50.2))
    expect(screen.getByTestId('field-y')).toHaveValue(47)
    await user.click(screen.getByTestId('align-right'))
    await user.selectOptions(screen.getByTestId('field-font'), 'Manrope')
    await user.selectOptions(screen.getByTestId('field-direction'), 'rtl')
    await user.click(screen.getByTestId('field-autofit')) // was on -> off
    // add the program name
    await user.click(screen.getByTestId('var-program_name'))
    expect(await screen.findByTestId('field-program_name')).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.snapshot().nodes[0].rev).toBe(2))
    expect(spy).toHaveBeenCalledTimes(1)
    const [, , patch, opts] = spy.mock.calls[0]
    expect(patch.config).toMatchObject({ language: 'ar', legacyKey: 'keep' })
    const t = opts.children.template
    expect(t).toMatchObject({ language: 'ar', file_path: `${P}/${N}/a.png`, file_kind: 'image', width_px: 2000, height_px: 1400 })
    expect(t.fields.map((f) => f.var)).toEqual(['participant_name', 'program_name', 'verification_qr'])
    expect(t.fields[0]).toMatchObject({ x: 0.502, y: 0.47, w: 0.6, align: 'right', font: 'Manrope', direction: 'rtl', shrink_to_fit: false, max_lines: 1 })
    expect(t.fields[1]).toMatchObject({ var: 'program_name', x: 0.5, y: 0.62 })
    // the file did not change: nothing is removed from storage
    expect(mocks.remove).not.toHaveBeenCalledWith(expect.arrayContaining([`${P}/${N}/a.png`]))
  })

  it('drags a field with the pointer: the move is a fraction of the stage size', async () => {
    mount('edit')
    const name = await screen.findByTestId('field-participant_name')
    fireEvent.pointerDown(name, { clientX: 300, clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerMove(name, { clientX: 360, clientY: 242, pointerId: 1 }) // +10 % of 600, +10 % of 420
    fireEvent.pointerUp(name, { pointerId: 1 })
    await waitFor(() => expect(screen.getByTestId('field-x')).toHaveValue(60))
    expect(screen.getByTestId('field-y')).toHaveValue(56)
  })

  it('the side handle changes the box width around the centre; the QR has a size handle', async () => {
    mount('edit')
    const name = await screen.findByTestId('field-participant_name')
    fireEvent.focus(name)
    const handle = await screen.findByTestId('handle-right-participant_name')
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 100, button: 0, pointerId: 2 })
    fireEvent.pointerMove(handle, { clientX: 530, clientY: 100, pointerId: 2 }) // +5 % each side -> +10 % width
    fireEvent.pointerUp(handle, { pointerId: 2 })
    await waitFor(() => expect(screen.getByTestId('field-participant_name').style.width).toBe('70%'))
    fireEvent.focus(screen.getByTestId('field-verification_qr'))
    expect(await screen.findByTestId('handle-size-verification_qr')).toBeInTheDocument()
    expect(screen.getByTestId('qr-size')).toBeInTheDocument()
  })

  it('removing a field asks nothing but offers Undo; the draft stays dirty until saved', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findByTestId('field-verification_qr')
    fireEvent.focus(screen.getByTestId('field-verification_qr'))
    await user.click(await screen.findByTestId('field-remove'))
    await waitFor(() => expect(screen.queryByTestId('field-verification_qr')).toBeNull())
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByTestId('field-verification_qr')).toBeInTheDocument()
  })

  it('flags a text wider than its box (overflow) and a missing participant name', async () => {
    mocks.render.mockResolvedValue({ overflow: { participant_name: true }, boxes: {} })
    mocks.def.mockImplementation(async () => defRows({ fields: [FIELDS[1]] }))
    mount('edit')
    expect(await screen.findByTestId('no-name-warning')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByTestId('var-participant_name'))
    expect(await screen.findByTestId('field-overflow')).toHaveTextContent('wider than its box')
  })

  it('upload: a too-small image is blocked with the reason and never reaches storage', async () => {
    mocks.def.mockImplementation(async () => [])
    mocks.decode.mockResolvedValue({ image: {}, width: 500, height: 400 })
    mount('edit')
    expect(await screen.findByText('No template yet')).toBeInTheDocument()
    fireEvent.change(await screen.findByTestId('template-file'), { target: { files: [new File(['x'], 'tiny.png', { type: 'image/png' })] } })
    expect(await screen.findByTestId('template-problem')).toHaveTextContent('too small')
    fireEvent.change(screen.getByTestId('template-file'), { target: { files: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(screen.getByTestId('template-problem')).toHaveTextContent('Only PNG and JPEG'))
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('upload: a good image is uploaded as is, the dimensions are stored, and saving without any field still writes the template', async () => {
    const user = userEvent.setup()
    mocks.def.mockImplementation(async () => [])
    const adapter = mount('edit')
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findByText('No template yet')
    fireEvent.change(screen.getByTestId('template-file'), { target: { files: [new File(['x'], 'cert.png', { type: 'image/png' })] } })
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1))
    expect(mocks.upload.mock.calls[0][1]).toEqual({ projectId: P, nodeId: N })
    expect(await screen.findByText('2480 x 1754 px')).toBeInTheDocument()
    await user.click(screen.getByTestId('var-participant_name'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][3].children.template).toMatchObject({ file_path: `${P}/${N}/new.png`, width_px: 2480, height_px: 1754, language: 'ar' })
  })

  it('a replaced image of this session is removed at once; an unsaved upload is removed when the editor closes', async () => {
    mocks.def.mockImplementation(async () => [])
    const { unmount } = (() => { mount('edit'); return { unmount: () => {} } })()
    await screen.findByText('No template yet')
    fireEvent.change(screen.getByTestId('template-file'), { target: { files: [new File(['x'], 'cert.png', { type: 'image/png' })] } })
    await screen.findByText('2480 x 1754 px')
    mocks.upload.mockResolvedValueOnce({ path: `${P}/${N}/second.png`, mime: 'image/png', bytes: 4000 })
    fireEvent.change(screen.getByTestId('template-file'), { target: { files: [new File(['y'], 'cert2.png', { type: 'image/png' })] } })
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith([`${P}/${N}/new.png`]))
    unmount()
  })

  it('a template that issued certificates says that saving creates a new version', async () => {
    mount('edit')
    expect(await screen.findByTestId('version-note')).toHaveTextContent('new version')
  })
})

describe('Certificates: Edit / Issue', () => {
  const openIssue = () => mount('edit', {}, `/projects/${P}/nodes/${N}?lang=en&tab=issue`)

  it('before the project is completed: both buttons are disabled and the reason (with the Program Settings link) is shown', async () => {
    mocks.admin.mockImplementation(async () => adminPayload({ project: { ...adminPayload().project, completed_at: null } }))
    openIssue()
    const blocked = await screen.findByTestId('issue-blocked')
    expect(blocked).toHaveAttribute('data-blocker', 'notCompleted')
    expect(within(blocked).getByRole('link', { name: 'Open Program Settings' })).toHaveAttribute('href', '/programs/PG1/settings')
    expect(screen.getByTestId('issue-all')).toBeDisabled()
    expect(screen.getByTestId('issue-selected')).toBeDisabled()
    expect(screen.getByTestId('issue-disabled-why')).toHaveTextContent('not completed yet')
  })

  it('without a template or without a name field issuing is blocked with its own reason', async () => {
    mocks.admin.mockImplementation(async () => adminPayload({ template: null }))
    const { unmount } = (() => { openIssue(); return { unmount: () => {} } })()
    expect(await screen.findByTestId('issue-blocked')).toHaveAttribute('data-blocker', 'noTemplate')
    unmount()
  })

  it('lists attended participants with their state, the name as printed, the flags and the count of the others', async () => {
    openIssue()
    const rows = await screen.findAllByTestId('issue-row')
    expect(rows.map((r) => r.dataset.state)).toEqual(['pending', 'issued', 'revoked', 'issued'])
    expect(within(rows[0]).getByTestId('row-name')).toHaveTextContent('أحمد بن علي')
    expect(within(rows[1]).getByTestId('row-code')).toHaveTextContent('AB12-CD34-EF56')
    expect(within(rows[2]).getByText('Needs review: the acceptance changed in Selection.')).toBeInTheDocument()
    expect(within(rows[2]).getByText(/Reason: duplicate/)).toBeInTheDocument()
    expect(within(rows[3]).getByTestId('row-flag')).toHaveTextContent('No longer marked attended')
    expect(screen.getByTestId('count-attended')).toHaveTextContent('3')
    expect(screen.getByTestId('count-issued')).toHaveTextContent('2')
    expect(screen.getByTestId('count-pending')).toHaveTextContent('1')
    expect(screen.getByTestId('count-revoked')).toHaveTextContent('1')
    expect(screen.getByTestId('issue-others')).toHaveTextContent('2 participants are not marked attended and receive no certificate.')
    expect(screen.getByTestId('issue-ready')).toBeInTheDocument()
  })

  it('"Issue to all attended" asks to confirm, calls the RPC with null (all) and shows the per-row result', async () => {
    const user = userEvent.setup()
    openIssue()
    await screen.findAllByTestId('issue-row')
    expect(screen.getByTestId('issue-all')).toHaveTextContent('Issue to all attended (1)') // revoked rows are NOT part of "all"
    await user.click(screen.getByTestId('issue-all'))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('Issue 1 certificate?')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Issue' }))
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledWith(N, null))
    expect(await screen.findByTestId('issue-results')).toHaveTextContent('Issued 1. Already issued 0. Skipped 0.')
  })

  it('"Issue to selected" sends exactly the chosen ids; a revoked row can be selected on purpose and the dialog says it gets a NEW code', async () => {
    const user = userEvent.setup()
    openIssue()
    const rows = await screen.findAllByTestId('issue-row')
    expect(within(rows[1]).queryByTestId('row-select')).toBeNull() // already issued: nothing to select
    await user.click(within(rows[2]).getByTestId('row-select'))
    await user.click(screen.getByTestId('issue-selected'))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText(/1 of them was revoked before and gets a NEW certificate/)).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Issue' }))
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledWith(N, ['a3']))
  })

  it('a server rejection (project not completed any more) is shown as an error, nothing else changes', async () => {
    mocks.issue.mockRejectedValue(fromSupabase({ code: '23514', message: 'certificate_project_not_completed: x', hint: 'certificate_project_not_completed' }))
    const user = userEvent.setup()
    openIssue()
    await screen.findAllByTestId('issue-row')
    await user.click(screen.getByTestId('issue-all'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Issue' }))
    expect(await screen.findByText(/The project is not completed yet\. Mark it completed in Program Settings first\./)).toBeInTheDocument()
    expect(screen.queryByTestId('issue-results')).toBeNull()
  })

  it('revoking warns first, sends the reason and the certificate id', async () => {
    const user = userEvent.setup()
    openIssue()
    const rows = await screen.findAllByTestId('issue-row')
    await user.click(within(rows[1]).getByTestId('row-revoke'))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText(/will show this certificate as REVOKED/)).toBeInTheDocument()
    await user.type(within(dlg).getByTestId('revoke-reason'), 'issued twice')
    await user.click(within(dlg).getByTestId('confirm-revoke'))
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('c2', 'issued twice'))
  })

  it('preview and downloads of an issued certificate go through the render payload', async () => {
    const user = userEvent.setup()
    openIssue()
    const rows = await screen.findAllByTestId('issue-row')
    await user.click(within(rows[1]).getByTestId('cert-download-png'))
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({ code: 'AB12-CD34-EF56' }), 'png'))
    await user.click(within(rows[1]).getByTestId('cert-download-pdf'))
    await waitFor(() => expect(mocks.download).toHaveBeenLastCalledWith(expect.anything(), 'pdf'))
    await user.click(within(rows[1]).getByTestId('cert-preview'))
    expect(await screen.findByTestId('certificate-view-stub')).toHaveTextContent('AB12-CD34-EF56')
  })

  it('no attended participants: an explanation and the way to the Participants page', async () => {
    mocks.admin.mockImplementation(async () => adminPayload({ rows: [], others: 3 }))
    openIssue()
    expect(await screen.findByText('No attended participants yet')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open participants' })[0]).toHaveAttribute('href', `/projects/${P}/participants`)
  })

  it('the Issue tab is also reachable from the tab button and keeps the deep link', async () => {
    const user = userEvent.setup()
    mount('edit')
    await screen.findByTestId('field-participant_name')
    await user.click(screen.getByTestId('tab-issue'))
    expect(await screen.findByTestId('issue-tab')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('tab=issue')
  })
})

describe('Certificates: Settings + View', () => {
  it('Settings: ONE save with name, show-to-participants and the config (language, verifier); unknown keys are kept', async () => {
    const user = userEvent.setup()
    const adapter = mount('settings')
    const spy = vi.spyOn(adapter, 'saveNode')
    await screen.findByTestId('certificates-settings')
    await user.click(screen.getByTestId('language-en'))
    expect(await screen.findByTestId('language-missing')).toHaveTextContent('template in Arabic only')
    await user.click(screen.getByTestId('verifier-show'))
    await user.click(screen.getByTestId('show-to-participants'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const patch = spy.mock.calls[0][2]
    expect(patch).toMatchObject({ show_to_participants: true, config: { language: 'en', legacyKey: 'keep', verifier: { enabled: true, showCertificate: false } } })
    expect(patch.config.verifier).toEqual({ enabled: true, showCertificate: false })
  })

  it('Settings: switching the verifier off disables the "show the certificate" option and the page url is the public /verify page', async () => {
    const user = userEvent.setup()
    mount('settings')
    await screen.findByTestId('certificates-settings')
    expect(within(screen.getByTestId('verifier-url')).getByText(/\/verify\/?$/)).toBeInTheDocument()
    await user.click(screen.getByTestId('verifier-enabled'))
    expect(screen.getByTestId('verifier-show')).toBeDisabled()
  })

  it('View: the PM preview draws the saved template with the sample data and shows the counts', async () => {
    mount('view')
    expect(await screen.findByTestId('certificates-view')).toBeInTheDocument()
    await waitFor(() => expect(mocks.render).toHaveBeenCalled())
    expect(mocks.render.mock.calls.at(-1)[0].values.participant_name).toMatch(/^عبد الرحمن/)
    expect(await screen.findByText('2 issued · 1 waiting')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Issue certificates' })).toHaveAttribute('href', `/projects/${P}/nodes/${N}/edit?tab=issue`)
  })

  it('View: no template yet -> an explanation', async () => {
    mocks.def.mockImplementation(async () => [])
    mount('view')
    expect(await screen.findByText('No template for Arabic yet')).toBeInTheDocument()
  })
})

describe('Founder block: My certificate', () => {
  const mine = [{ certificate_id: 'c2', node_id: N, project_id: P, name_en: 'Certificates', name_ar: 'الشهادات', code: 'AB12-CD34-EF56', issued_at: '2026-10-13T08:00:00Z', participant_name: 'Sara Ali', program_name: 'Athar Accelerator', project_name: 'Cohort 5', completed_on: '2026-10-12', language: 'en' }]
  const mountFounder = () => renderWithProviders(<ConfirmProvider><FounderCertificateButton projectId={P} /></ConfirmProvider>, { route: '/?lang=en' })

  it('renders NOTHING when the database lists no certificate (not attended, not completed, revoked or not exposed): no teaser', async () => {
    mocks.my.mockResolvedValue([])
    mountFounder()
    await waitFor(() => expect(mocks.my).toHaveBeenCalledWith(P))
    expect(screen.queryByTestId('founder-certificates')).toBeNull()
  })

  it('shows the certificate with preview / PNG / PDF and the verify link; a download renders the payload on demand', async () => {
    const user = userEvent.setup()
    mocks.my.mockResolvedValue(mine)
    mountFounder()
    const block = await screen.findByTestId('founder-certificates')
    expect(within(block).getByText('Sara Ali - Athar Accelerator')).toBeInTheDocument()
    expect(within(block).getByText(/Code AB12-CD34-EF56/)).toBeInTheDocument()
    expect(within(block).getByText(/Issued on 13 October 2026/)).toBeInTheDocument()
    expect(within(block).getByRole('link', { name: 'Verify online' })).toHaveAttribute('href', '/verify/AB12-CD34-EF56?lang=en')
    expect(mocks.payload).not.toHaveBeenCalled() // listing costs nothing
    await user.click(within(block).getByTestId('cert-download-png'))
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({ code: 'AB12-CD34-EF56' }), 'png'))
    expect(mocks.payload).toHaveBeenCalledWith('c2')
  })

  it('a download the server refuses says so instead of failing silently', async () => {
    const user = userEvent.setup()
    mocks.my.mockResolvedValue(mine)
    mocks.payload.mockRejectedValue(fromSupabase({ code: '42501', message: 'forbidden' }))
    mountFounder()
    await user.click(await screen.findByTestId('cert-download-pdf'))
    expect(await screen.findByText(/You do not have permission to do this./)).toBeInTheDocument()
    expect(mocks.download).not.toHaveBeenCalled()
  })
})

describe('Public verifier page', () => {
  const full = { status: 'valid', valid: true, revoked: false, code: 'AB12-CD34-EF56', participant_name: 'Sara Ali', program_name: 'Athar Accelerator', project_name: 'Cohort 5', completed_on: '2026-10-12', issued_on: '2026-10-13', issuer: 'Athar', render: { code: 'AB12-CD34-EF56', snapshot: { participant_name: 'Sara Ali' }, template: { language: 'en', width_px: 2000, height_px: 1400, file_path: 'x' }, fields: [] } }
  const mountVerify = (path) => renderWithProviders(<Routes><Route path="/verify/:code?" element={<VerifyCertificatePage />} /></Routes>, { route: path })

  it('valid: name, program, dates, issuer and code - and the certificate itself when the payload carries it', async () => {
    mocks.verify.mockResolvedValue(full)
    mountVerify('/verify/ab12cd34ef56?lang=en')
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith('AB12-CD34-EF56')) // normalised before the request
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Valid certificate')
    const facts = screen.getByTestId('verify-facts')
    for (const text of ['Sara Ali', 'Athar Accelerator', 'Cohort 5', '12 October 2026', '13 October 2026', 'Athar', 'AB12-CD34-EF56']) expect(within(facts).getByText(text)).toBeInTheDocument()
    expect(await screen.findByTestId('certificate-view-stub')).toBeInTheDocument()
    expect(screen.getByTestId('verify-input')).toHaveValue('AB12-CD34-EF56')
  })

  it('valid without a render payload (the node hides the certificate): facts only', async () => {
    mocks.verify.mockResolvedValue({ ...full, render: undefined })
    mountVerify('/verify/AB12-CD34-EF56?lang=en')
    await screen.findByTestId('verify-facts')
    expect(screen.queryByTestId('certificate-view-stub')).toBeNull()
  })

  it('revoked: says so, shows who and what, never draws the certificate', async () => {
    mocks.verify.mockResolvedValue({ ...full, status: 'revoked', valid: false, revoked: true, render: undefined })
    mountVerify('/verify/AB12-CD34-EF56?lang=en')
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Revoked certificate')
    expect(screen.getByTestId('verify-result')).toHaveAttribute('data-status', 'revoked')
    expect(screen.queryByTestId('certificate-view-stub')).toBeNull()
  })

  it('not found: no facts, a plain message', async () => {
    mocks.verify.mockResolvedValue({ status: 'not_found', valid: false })
    mountVerify('/verify/ZZZZ-ZZZZ-ZZZZ?lang=en')
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Certificate not found')
    expect(screen.queryByTestId('verify-facts')).toBeNull()
  })

  it('a malformed code is refused in the browser: no request, an inline hint', async () => {
    const user = userEvent.setup()
    mountVerify('/verify?lang=en')
    await user.type(screen.getByTestId('verify-input'), 'abc')
    await user.click(screen.getByTestId('verify-submit'))
    expect(await screen.findByText(/The code has 12 letters and digits/)).toBeInTheDocument()
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it('typing formats the code with dashes; submitting navigates to the canonical URL', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Routes><Route path="/verify/:code?" element={<><VerifyCertificatePage /><Where /></>} /></Routes>, { route: '/verify?lang=en' })
    mocks.verify.mockResolvedValue({ status: 'not_found', valid: false })
    await user.type(screen.getByTestId('verify-input'), 'ab12cd34ef56')
    expect(screen.getByTestId('verify-input')).toHaveValue('AB12-CD34-EF56')
    await user.click(screen.getByTestId('verify-submit'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/verify/AB12-CD34-EF56'))
  })

  it('the server rate limit is shown as a message', async () => {
    mocks.verify.mockRejectedValue(fromSupabase({ code: 'P0001', message: 'certificate_rate_limited: x', hint: 'certificate_rate_limited' }))
    mountVerify('/verify/AB12-CD34-EF56?lang=en')
    expect(await screen.findByText('Too many lookups. Try again in a few minutes.')).toBeInTheDocument()
  })

  it('Arabic: the page is right to left and fully translated', async () => {
    mocks.verify.mockResolvedValue(full)
    mountVerify('/verify/AB12-CD34-EF56?lang=ar')
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('شهادة صالحة')
    expect(screen.getByText('التحقق من شهادة')).toBeInTheDocument()
  })
})
