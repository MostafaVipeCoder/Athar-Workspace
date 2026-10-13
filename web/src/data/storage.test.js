import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ convert: vi.fn(), upload: vi.fn(), remove: vi.fn(), from: vi.fn() }))

vi.mock('./client.js', () => ({
  db: () => ({ storage: { from: (bucket) => { mocks.from(bucket); return { upload: mocks.upload, remove: mocks.remove, getPublicUrl: (p) => ({ data: { publicUrl: `http://files/${bucket}/${p}` } }) } } } }),
}))
vi.mock('../lib/image/convert.js', async (importOriginal) => ({ ...(await importOriginal()), convertToWebp: mocks.convert }))

const { ImageError } = await import('../lib/image/errors.js')
const { AppError } = await import('./errors.js')
const { publicImageUrl, publicThumbUrl, removeImage, storeImage, uploadImage, uploadObject } = await import('./storage.js')

const blob = (n, type = 'image/webp') => new Blob([new Uint8Array(n)], { type })
const converted = (over = {}) => ({
  profile: 'cover',
  full: { blob: blob(900), width: 1920, height: 1080, bytes: 900, mime: 'image/webp', ext: 'webp' },
  thumb: { blob: blob(90), width: 320, height: 180, bytes: 90, mime: 'image/webp', ext: 'webp' },
  source: { bytes: 5000 },
  report: { kind: 'converted', sourceBytes: 5000, bytes: 900 },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
})

describe('uploadImage: every raster is stored as WebP', () => {
  it('uploads the converted full image and its _t thumbnail with immutable caching, never the original file', async () => {
    mocks.convert.mockResolvedValue(converted())
    const original = new File([new Uint8Array(5000)], 'photo.png', { type: 'image/png' })
    const path = await uploadImage(original, { ownerId: 'P1', kind: 'cover' })
    expect(path).toMatch(/^P1\/cover\/[0-9a-f-]{36}\.webp$/)
    expect(mocks.convert).toHaveBeenCalledWith(original, expect.objectContaining({ profile: 'cover' }))
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    const [full, thumb] = mocks.upload.mock.calls
    expect(full[0]).toBe(path)
    expect(thumb[0]).toBe(path.replace('.webp', '_t.webp'))
    for (const call of mocks.upload.mock.calls) {
      expect(call[1]).not.toBe(original)
      expect(call[2]).toEqual({ contentType: 'image/webp', cacheControl: '31536000', upsert: false })
    }
    expect(mocks.from).toHaveBeenCalledWith('public-assets')
  })

  it('derives the profile from the folder kind unless one is given', async () => {
    mocks.convert.mockResolvedValue(converted())
    await uploadImage(new File(['x'], 'a.png'), { ownerId: 'P1', kind: 'photo' })
    await uploadImage(new File(['x'], 'a.png'), { ownerId: 'P1', kind: 'logo' })
    await uploadImage(new File(['x'], 'a.png'), { ownerId: 'P1', kind: 'og' })
    await uploadImage(new File(['x'], 'a.png'), { ownerId: 'P1', kind: 'cover', profile: 'template' })
    expect(mocks.convert.mock.calls.map((c) => c[1].profile)).toEqual(['avatar', 'logo', 'cover', 'template'])
  })

  it('an SVG is stored once, as .svg, without a thumbnail', async () => {
    mocks.convert.mockResolvedValue(converted({ full: { blob: blob(300, 'image/svg+xml'), width: 0, height: 0, bytes: 300, mime: 'image/svg+xml', ext: 'svg' }, thumb: null }))
    const path = await uploadImage(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), { ownerId: 'C1', kind: 'logo' })
    expect(path).toMatch(/^C1\/logo\/[0-9a-f-]{36}\.svg$/)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.upload.mock.calls[0][2].contentType).toBe('image/svg+xml')
  })

  it('a failed thumbnail upload removes the full file again and throws', async () => {
    mocks.convert.mockResolvedValue(converted())
    mocks.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'boom', status: 500 } })
    await expect(uploadImage(new File(['x'], 'a.png'), { ownerId: 'P1', kind: 'cover' })).rejects.toBeInstanceOf(AppError)
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]])
  })

  it('a refused image (corrupt, HEIC, ...) becomes AppError(validation) with the translated key and uploads nothing', async () => {
    mocks.convert.mockRejectedValue(new ImageError('heic'))
    const err = await uploadImage(new File(['x'], 'a.heic'), { ownerId: 'P1', kind: 'cover' }).catch((e) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err).toMatchObject({ code: 'validation', messageKey: 'errors.image.heic', retryable: false })
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('needs an owner and a kind', async () => {
    await expect(uploadImage(new File(['x'], 'a.png'), { kind: 'cover' })).rejects.toBeInstanceOf(AppError)
    await expect(uploadImage(new File(['x'], 'a.png'), { ownerId: 'P1' })).rejects.toBeInstanceOf(AppError)
    expect(mocks.convert).not.toHaveBeenCalled()
  })
})

describe('storeImage: other buckets and paths', () => {
  it('stores into the given bucket under the path the caller builds from the stored extension, thumbnail optional', async () => {
    mocks.convert.mockResolvedValue(converted({ thumb: null }))
    const r = await storeImage(new File(['x'], 'frame.png'), { bucket: 'resources', path: (ext) => `proj/node/abc.${ext}`, profile: 'content', cacheControl: '3600' })
    expect(r).toMatchObject({ path: 'proj/node/abc.webp', thumbPath: null, mime: 'image/webp', bytes: 900 })
    expect(mocks.from).toHaveBeenCalledWith('resources')
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.upload.mock.calls[0][2].cacheControl).toBe('3600')
    expect(r.report.kind).toBe('converted')
  })
})

describe('uploadObject: files that are not images', () => {
  it('stores a PDF as is', async () => {
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    expect(await uploadObject('resources', 'p/n/a.pdf', file, { contentType: 'application/pdf' })).toBe('p/n/a.pdf')
    expect(mocks.upload).toHaveBeenCalledWith('p/n/a.pdf', file, { contentType: 'application/pdf', cacheControl: '3600', upsert: false })
  })
  it('refuses an image content type: images go through storeImage', async () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    await expect(uploadObject('resources', 'p/n/a.png', png, { contentType: 'image/png' })).rejects.toMatchObject({ messageKey: 'errors.image.type' })
    await expect(uploadObject('resources', 'p/n/a.png', png)).rejects.toBeInstanceOf(AppError)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('refuses an image whose declared type is NOT an image: the BYTES decide (review: application/octet-stream passed the client check)', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8, 8, 6, 0, 0, 0])
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 8, 0, 8, 1, 1, 0x11, 0])
    const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')
    for (const [name, bytes] of [['a.bin', png], ['a.dat', jpeg], ['a.txt', svg]]) {
      const file = new File([bytes], name, { type: 'application/octet-stream' })
      await expect(uploadObject('resources', 'p/n/' + name, file, { contentType: 'application/octet-stream' })).rejects.toMatchObject({ messageKey: 'errors.image.type' })
    }
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('lets real documents through: PDF, an Office (zip) file, plain text, an MP4 (ISO media, not a HEIC brand)', async () => {
    const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d])
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 8, 0])
    for (const [name, bytes, type] of [['a.pdf', new TextEncoder().encode('%PDF-1.4'), 'application/pdf'], ['a.docx', zip, ''], ['a.txt', new TextEncoder().encode('hello'), 'text/plain'], ['a.mp4', mp4, 'video/mp4']]) {
      const file = new File([bytes], name, { type })
      await expect(uploadObject('resources', 'p/n/' + name, file, { contentType: type || undefined })).resolves.toBe('p/n/' + name)
    }
    expect(mocks.upload).toHaveBeenCalledTimes(4)
  })
})

describe('urls and removal', () => {
  it('the thumbnail URL follows the _t convention; an SVG or legacy raster is its own thumbnail', () => {
    expect(publicImageUrl('a/b.webp')).toBe('http://files/public-assets/a/b.webp')
    expect(publicThumbUrl('a/b.webp')).toBe('http://files/public-assets/a/b_t.webp')
    expect(publicThumbUrl('a/b.svg')).toBe('http://files/public-assets/a/b.svg')
    expect(publicThumbUrl('a/b.png')).toBe('http://files/public-assets/a/b.png')
    expect(publicThumbUrl('')).toBe('')
  })
  it('removeImage removes the file and its thumbnail once', async () => {
    await removeImage('a/b.webp')
    expect(mocks.remove).toHaveBeenCalledWith(['a/b.webp', 'a/b_t.webp'])
    await removeImage('a/c.svg')
    expect(mocks.remove).toHaveBeenLastCalledWith(['a/c.svg'])
    await removeImage('')
    expect(mocks.remove).toHaveBeenCalledTimes(2)
  })
})
