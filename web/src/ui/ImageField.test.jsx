import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/render.jsx'

const mocks = vi.hoisted(() => ({ convert: vi.fn() }))
vi.mock('../lib/image/convert.js', async (importOriginal) => ({ ...(await importOriginal()), convertToWebp: mocks.convert }))

const { ImageField } = await import('./ImageField.jsx')
const { ImageError } = await import('../lib/image/errors.js')

const MB = 1024 * 1024
const result = (over = {}) => ({
  full: { blob: new Blob([new Uint8Array(180 * 1024)], { type: 'image/webp' }), width: 1920, height: 1080, bytes: 180 * 1024, mime: 'image/webp', ext: 'webp' },
  thumb: null,
  report: { kind: 'converted', sourceBytes: 2.1 * MB, bytes: 180 * 1024, notices: [], width: 1920, height: 1080 },
  ...over,
})
const png = () => new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' })
const input = () => document.querySelector('input[type="file"]')

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('ImageField: pick -> convert -> upload feedback', () => {
  it('converts the picked file, uploads the ORIGINAL file object (the data layer reuses the cached conversion) and shows the saving', async () => {
    mocks.convert.mockResolvedValue(result())
    const onFile = vi.fn().mockResolvedValue('P/cover/x.webp')
    renderWithProviders(<ImageField label="Cover" profile="cover" onFile={onFile} />, { route: '/x?lang=en' })
    const file = png()
    fireEvent.change(input(), { target: { files: [file] } })
    expect(await screen.findByTestId('image-report')).toHaveTextContent(/Optimised:.*2\.1 MB.*180 KB.*92%/)
    expect(mocks.convert).toHaveBeenCalledWith(file, expect.objectContaining({ profile: 'cover' }))
    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile.mock.calls[0][0]).toBe(file)
    expect(document.querySelector('img')).toHaveAttribute('src', 'blob:preview') // the preview is the converted image
  })

  it('shows the stage while converting and the upload step while the page stores the image', async () => {
    let finish
    mocks.convert.mockImplementation((_f, { onProgress }) => {
      onProgress({ stage: 'encoding', percent: 60 })
      return new Promise((resolve) => { finish = () => resolve(result()) })
    })
    let done
    const onFile = vi.fn(() => new Promise((resolve) => { done = resolve }))
    renderWithProviders(<ImageField label="Cover" profile="cover" onFile={onFile} />, { route: '/x?lang=en' })
    fireEvent.change(input(), { target: { files: [png()] } })
    expect(await screen.findByTestId('image-progress')).toHaveTextContent('Converting to WebP...')
    await act(async () => finish())
    expect(await screen.findByText('Uploading...')).toBeInTheDocument()
    await act(async () => done('P/cover/x.webp'))
    await waitFor(() => expect(screen.queryByTestId('image-progress')).toBeNull())
    expect(screen.getByTestId('image-report')).toBeInTheDocument()
  })

  it('a SHARED image (cover, share image) also shows the JPEG link-preview line; an ordinary image does not', async () => {
    mocks.convert.mockResolvedValue(result({ report: { kind: 'converted', sourceBytes: 2.1 * MB, bytes: 180 * 1024, notices: [], width: 1920, height: 1080, og: { bytes: 84 * 1024, width: 1200, height: 630, quality: 0.82, progressive: true } } }))
    const { unmount } = renderWithProviders(<ImageField label="Cover" profile="cover" onFile={vi.fn().mockResolvedValue('p')} />, { route: '/x?lang=en' })
    fireEvent.change(input(), { target: { files: [png()] } })
    expect(await screen.findByTestId('image-og')).toHaveTextContent(/Link preview \(JPEG 1200 x 630\):.*84 KB/)
    unmount()

    mocks.convert.mockResolvedValue(result())
    renderWithProviders(<ImageField label="Photo" profile="avatar" onFile={vi.fn().mockResolvedValue('p')} />, { route: '/x?lang=en' })
    fireEvent.change(input(), { target: { files: [png()] } })
    await screen.findByTestId('image-report')
    expect(screen.queryByTestId('image-og')).toBeNull()
  })

  it('says so when the derivative could not be prepared (the cover itself is fine) and speaks Arabic', async () => {
    mocks.convert.mockResolvedValue(result({ report: { kind: 'converted', sourceBytes: 2.1 * MB, bytes: 180 * 1024, notices: ['ogFailed'], width: 1920, height: 1080, og: null } }))
    renderWithProviders(<ImageField label="الغلاف" profile="cover" onFile={vi.fn().mockResolvedValue('p')} />, { route: '/x?lang=ar' })
    fireEvent.change(input(), { target: { files: [png()] } })
    expect(await screen.findByText(/تعذّر تجهيز صورة معاينة الرابط/)).toBeInTheDocument()
  })

  it('speaks Arabic', async () => {
    mocks.convert.mockResolvedValue(result())
    renderWithProviders(<ImageField label="الغلاف" profile="cover" onFile={vi.fn().mockResolvedValue('p')} />, { route: '/x?lang=ar' })
    fireEvent.change(input(), { target: { files: [png()] } })
    expect(await screen.findByTestId('image-report')).toHaveTextContent('تم التحسين')
    expect(screen.getByText(/تُحوَّل تلقائيًا إلى WebP/)).toBeInTheDocument()
  })

  it('"already WebP", the vector note and the animated-GIF notice', async () => {
    mocks.convert.mockResolvedValue(result({ report: { kind: 'kept', sourceBytes: 90 * 1024, bytes: 90 * 1024, notices: [], width: 800, height: 600 } }))
    const { unmount } = renderWithProviders(<ImageField label="Cover" profile="cover" onFile={vi.fn().mockResolvedValue('p')} />, { route: '/x?lang=en' })
    fireEvent.change(input(), { target: { files: [png()] } })
    expect(await screen.findByTestId('image-report')).toHaveTextContent('Already WebP, kept as it is')
    unmount()

    mocks.convert.mockResolvedValue(result({ report: { kind: 'converted', sourceBytes: 400 * 1024, bytes: 60 * 1024, notices: ['animatedFirstFrame'], width: 400, height: 300 } }))
    renderWithProviders(<ImageField label="Cover" profile="cover" onFile={vi.fn().mockResolvedValue('p')} />, { route: '/x?lang=en' })
    fireEvent.change(input(), { target: { files: [new File([new Uint8Array(4)], 'loop.gif', { type: 'image/gif' })] } })
    expect(await screen.findByText('This image is animated: only its first frame was kept.')).toBeInTheDocument()
  })
})

describe('ImageField: refusals', () => {
  it('a HEIC photo gets its own explanation and nothing is uploaded', async () => {
    mocks.convert.mockRejectedValue(new ImageError('heic'))
    const onFile = vi.fn()
    renderWithProviders(<ImageField label="Cover" profile="cover" onFile={onFile} />, { route: '/x?lang=en' })
    fireEvent.change(input(), { target: { files: [new File([new Uint8Array(4)], 'IMG_1.heic', { type: '' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('HEIC/HEIF photos cannot be read by this browser')
    expect(onFile).not.toHaveBeenCalled()
    expect(screen.queryByTestId('image-report')).toBeNull()
  })

  it('a corrupt image is explained in Arabic', async () => {
    mocks.convert.mockRejectedValue(new ImageError('corrupt'))
    renderWithProviders(<ImageField label="الغلاف" profile="cover" onFile={vi.fn()} />, { route: '/x?lang=ar' })
    fireEvent.change(input(), { target: { files: [png()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('تالفة أو ناقصة')
  })

  it('a file that is not an image is refused before any conversion', async () => {
    renderWithProviders(<ImageField label="Cover" profile="cover" onFile={vi.fn()} />, { route: '/x?lang=en' })
    fireEvent.change(input(), { target: { files: [new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Only PNG, JPEG, WebP or GIF images are accepted.')
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('a failed upload shows the page\'s own message (errorText) or the generic one, and drops the preview', async () => {
    mocks.convert.mockResolvedValue(result())
    renderWithProviders(<ImageField label="Cover" profile="cover" onFile={vi.fn().mockRejectedValue(new Error('network'))} errorText={(code) => (code === 'upload' ? 'Could not save the cover' : code)} />, { route: '/x?lang=en' })
    fireEvent.change(input(), { target: { files: [png()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the cover')
    expect(screen.queryByTestId('image-report')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })
})

describe('ImageField: the picker follows the profile', () => {
  it('offers rasters, and SVG only for logos', () => {
    const { unmount } = renderWithProviders(<ImageField label="Cover" profile="cover" onFile={vi.fn()} />, { route: '/x?lang=en' })
    expect(input().getAttribute('accept')).toBe('image/png,image/jpeg,image/webp,image/gif')
    unmount()
    renderWithProviders(<ImageField label="Logo" profile="logo" onFile={vi.fn()} />, { route: '/x?lang=en' })
    expect(input().getAttribute('accept')).toContain('image/svg+xml')
  })
})
