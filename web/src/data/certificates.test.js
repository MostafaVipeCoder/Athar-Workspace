import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ convert: vi.fn(), upload: vi.fn(), remove: vi.fn(), from: vi.fn(), rpc: vi.fn() }))

vi.mock('./client.js', () => ({
  db: () => ({
    rpc: mocks.rpc,
    storage: { from: (bucket) => { mocks.from(bucket); return { upload: mocks.upload, remove: mocks.remove } } },
  }),
}))
vi.mock('../lib/image/convert.js', async (importOriginal) => ({ ...(await importOriginal()), convertToWebp: mocks.convert }))

const { ImageError } = await import('../lib/image/errors.js')
const { AppError } = await import('./errors.js')
const { TEMPLATE_BUCKET, claimMyCertificate, issueCertificates, listMyCertificates, reissueCertificate, revokeCertificate, revokeParticipantCertificates, uploadTemplateFile } = await import('./certificates.js')

const blob = (n) => new Blob([new Uint8Array(n)], { type: 'image/webp' })
const converted = (over = {}) => ({
  profile: 'template',
  full: { blob: blob(900), width: 3508, height: 2480, bytes: 900, mime: 'image/webp', ext: 'webp' },
  thumb: null,
  source: { bytes: 50_000 },
  report: { kind: 'converted', sourceBytes: 50_000, bytes: 900 },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
})

describe('certificate template upload (universal WebP, profile "template")', () => {
  it('converts every template to WebP and stores ONLY the WebP, under <project>/<node>/<uuid>.webp, with no thumbnail', async () => {
    mocks.convert.mockResolvedValue(converted())
    const original = new File([new Uint8Array(50_000)], 'design.png', { type: 'image/png' })
    const stored = await uploadTemplateFile(original, { projectId: 'P1', nodeId: 'N1' })
    expect(mocks.convert).toHaveBeenCalledWith(original, expect.objectContaining({ profile: 'template' }))
    expect(stored.path).toMatch(/^P1\/N1\/[0-9a-f-]{36}\.webp$/)
    expect(mocks.from).toHaveBeenCalledWith(TEMPLATE_BUCKET)
    expect(mocks.upload).toHaveBeenCalledTimes(1) // no `_t` thumbnail for a template
    const [path, body, opts] = mocks.upload.mock.calls[0]
    expect(path).toBe(stored.path)
    expect(body).not.toBe(original) // the original PNG / JPEG is never uploaded
    expect(opts).toMatchObject({ contentType: 'image/webp', upsert: false })
  })

  it('returns the STORED image (the converted size, not the decoded source) so the template row keeps what the renderer will draw', async () => {
    mocks.convert.mockResolvedValue(converted({ full: { blob: blob(900), width: 4000, height: 2828, bytes: 900, mime: 'image/webp', ext: 'webp' } }))
    const stored = await uploadTemplateFile(new File(['x'], 'big.jpg', { type: 'image/jpeg' }), { projectId: 'P1', nodeId: 'N1' })
    expect(stored).toMatchObject({ mime: 'image/webp', bytes: 900, width: 4000, height: 2828 })
    expect(stored.report).toMatchObject({ sourceBytes: 50_000, bytes: 900 })
  })

  it('accepts a WebP source (kept as it is when it already fits) and passes the progress callback to the pipeline', async () => {
    mocks.convert.mockResolvedValue(converted({ report: { kind: 'kept', sourceBytes: 900, bytes: 900 } }))
    const onProgress = vi.fn()
    const stored = await uploadTemplateFile(new File(['x'], 'design.webp', { type: 'image/webp' }), { projectId: 'P1', nodeId: 'N1', onProgress })
    expect(mocks.convert.mock.calls[0][1].onProgress).toBe(onProgress)
    expect(stored.report.kind).toBe('kept')
  })

  it('refuses a PDF, an SVG and an empty file BEFORE any conversion or upload (images only, owner decision 17.2)', async () => {
    for (const file of [new File(['x'], 'a.pdf', { type: 'application/pdf' }), new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }), new File([], 'a.png', { type: 'image/png' })]) {
      await expect(uploadTemplateFile(file, { projectId: 'P1', nodeId: 'N1' })).rejects.toMatchObject({ code: 'validation' })
    }
    expect(mocks.convert).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('a damaged image is refused by the pipeline with its message key, and nothing is uploaded', async () => {
    mocks.convert.mockRejectedValue(new ImageError('corrupt'))
    const err = await uploadTemplateFile(new File(['x'], 'broken.png', { type: 'image/png' }), { projectId: 'P1', nodeId: 'N1' }).catch((e) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err.messageKey).toBe('errors.image.corrupt')
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('needs a project and a node (the bucket policy keys on the folder)', async () => {
    await expect(uploadTemplateFile(new File(['x'], 'a.png', { type: 'image/png' }), {})).rejects.toBeInstanceOf(AppError)
    expect(mocks.convert).not.toHaveBeenCalled()
  })
})

describe('certificate RPC wrappers (per founder, m42)', () => {
  it('issue_certificates: all attended (null) or exactly the chosen participants', async () => {
    mocks.rpc.mockResolvedValue({ data: { issued: 2, authorised: 1, existing: 0, skipped: 0, results: [] }, error: null })
    await issueCertificates('N1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('issue_certificates', { p_node: 'N1', p_participants: null })
    const res = await issueCertificates('N1', ['a1', 'a2'])
    expect(mocks.rpc).toHaveBeenLastCalledWith('issue_certificates', { p_node: 'N1', p_participants: ['a1', 'a2'] })
    expect(res.issued).toBe(2)
  })

  it('revokes ONE certificate, or the whole participant, with an optional reason; issues ONE person again', async () => {
    await revokeCertificate('C1', 'typo')
    expect(mocks.rpc).toHaveBeenLastCalledWith('revoke_certificate', { p_cert: 'C1', p_reason: 'typo' })
    await revokeCertificate('C1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('revoke_certificate', { p_cert: 'C1', p_reason: null })
    await revokeParticipantCertificates('N1', 'P1', 'cohort cancelled')
    expect(mocks.rpc).toHaveBeenLastCalledWith('revoke_participant_certificates', { p_node: 'N1', p_participant: 'P1', p_reason: 'cohort cancelled' })
    await reissueCertificate('C1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('reissue_certificate', { p_cert: 'C1' })
  })

  it('the founder opens the block: list_my_certificates (which claims HIS OWN certificate on demand, server side) narrowed to the project', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ certificate_id: 'c1', person_name: 'Sara Ali', company_name: 'Nile Labs' }], error: null })
    const rows = await listMyCertificates('PRJ')
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_my_certificates', { p_project: 'PRJ' })
    expect(rows[0]).toMatchObject({ person_name: 'Sara Ali', company_name: 'Nile Labs' })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await listMyCertificates()).toEqual([])
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_my_certificates', { p_project: null })
  })

  it('claim_my_certificate sends only the node: the account (and so the name) is decided by the server, never by the client', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'issued', certificate_id: 'c1', code: 'AB12-CD34-EF56' }, error: null })
    const res = await claimMyCertificate('N1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('claim_my_certificate', { p_node: 'N1' })
    expect(res.status).toBe('issued')
  })

  it('a forbidden claim (not linked to an attended participant) surfaces as an error, not as an empty success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } })
    await expect(claimMyCertificate('N1')).rejects.toBeInstanceOf(AppError)
  })
})
