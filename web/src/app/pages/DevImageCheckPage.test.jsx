import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '../../test/render.jsx'

/**
 * The DEV-only image diagnostics page (/dev/image-check): the pipeline and the browser probes are mocked (jsdom has no canvas / WebAssembly codecs), so
 * these tests prove the PAGE: it probes on load, runs a picked photo through the pipeline, judges the orientation, builds the English report and copies it.
 */
const mocks = vi.hoisted(() => ({ convert: vi.fn(), probes: vi.fn() }))
vi.mock('../../lib/image/convert.js', async (importOriginal) => ({ ...(await importOriginal()), convertToWebp: mocks.convert }))
vi.mock('../../lib/image/probe.js', () => ({ runProbes: mocks.probes }))

const { default: DevImageCheckPage } = await import('./DevImageCheckPage.jsx')
const { ImageError } = await import('../../lib/image/errors.js')

const ok = { ok: true, type: 'image/webp', bytes: 30, ms: 1, error: null }
const probes = (over = {}) => ({
  forcedNoNativeWebp: false,
  nativeWebp: { offscreen: ok, dom: ok },
  nativeJpeg: { offscreen: { ...ok, type: 'image/jpeg' }, dom: { ...ok, type: 'image/jpeg' } },
  wasmWebp: { ok: true, coldMs: 300, warmMs: 4, bytes: 100, magic: true },
  wasmJpeg: { ok: true, coldMs: 200, warmMs: 5, bytes: 300, jpegMagic: true, progressive: true },
  decision: { webp: 'native', jpeg: 'wasm' },
  ...over,
})

/** A JPEG whose header says 4032 x 3024 and whose EXIF orientation is `orientation` (a phone photo held upright = 6). */
function phoneJpeg(orientation) {
  const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = payload.length + 2
  const be16 = (n) => [n >> 8, n & 255]
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, ...be16(len), ...payload, 0xff, 0xc0, ...be16(17), 8, ...be16(3024), ...be16(4032), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9])
}
const photo = (orientation = 6, name = 'IMG_0001.JPG') => new File([phoneJpeg(orientation)], name, { type: 'image/jpeg' })
const converted = (over = {}) => ({
  source: { type: 'jpeg', width: 3024, height: 4032, bytes: 3_900_000 },
  full: { blob: new Blob([Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], { type: 'image/webp' }), width: 1440, height: 1920, bytes: 188 * 1024 },
  thumb: { blob: new Blob(['t']), width: 240, height: 320, bytes: 14 * 1024 },
  og: { blob: new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), width: 1200, height: 630, bytes: 71 * 1024, quality: 0.82, progressive: true },
  report: { kind: 'converted', sourceBytes: 3_900_000, bytes: 188 * 1024, savedBytes: 3_900_000 - 188 * 1024, quality: 0.8, attempts: 1, notices: ['resized'] },
  ...over,
})
const input = () => screen.getByTestId('photo-input')
const report = () => screen.getByTestId('report-text').value

beforeEach(() => {
  vi.clearAllMocks()
  mocks.probes.mockResolvedValue(probes())
  mocks.convert.mockImplementation(async (_f, { onProgress }) => {
    onProgress?.({ stage: 'decoding', percent: 20 })
    onProgress?.({ stage: 'encoding', percent: 60 })
    return converted()
  })
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:preview-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DevImageCheckPage: the diagnostics page for iPhone / Safari', () => {
  it('probes the browser on load: the three states, what the app will use, and the device facts', async () => {
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    expect(screen.getByTestId('verdict')).toHaveAttribute('data-verdict', 'wait')
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveAttribute('data-verdict', 'warn')) // not a secure context in jsdom + no photo yet
    expect(mocks.probes).toHaveBeenCalledWith({ forceNoNativeWebp: false })
    expect(screen.getByTestId('probe-canvasWebp')).toHaveAttribute('data-state', 'ok')
    expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok')
    expect(screen.getByTestId('probe-wasmJpeg')).toHaveTextContent('first run 200 ms')
    expect(screen.getByTestId('probe-used')).toHaveTextContent('WebP with: the browser itself. Link-preview JPEG with: the WebAssembly fallback')
    expect(screen.getByTestId('device-browser')).toBeInTheDocument()
    expect(report()).toMatch(/^ATHAR IMAGE CHECK REPORT\n/)
    expect(report()).toContain('The pipeline will use: WebP = native, link-preview JPEG = wasm')
  })

  it('on Safari the canvas cannot make WebP: the fallback row says it is the one in use and the verdict is a WARN with the reason, not an error', async () => {
    mocks.probes.mockResolvedValue(probes({ nativeWebp: { offscreen: { ok: false, type: 'image/png', bytes: 90, ms: 2, error: null }, dom: { ok: false, type: 'image/png', bytes: 90, ms: 2, error: null } }, decision: { webp: 'wasm', jpeg: 'wasm' } }))
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('probe-canvasWebp')).toHaveAttribute('data-state', 'no'))
    expect(screen.getByTestId('probe-canvasWebp')).toHaveTextContent('answered image/png')
    expect(screen.getByTestId('probe-used')).toHaveTextContent('WebP with: the WebAssembly fallback')
    expect(screen.getByTestId('verdict')).toHaveAttribute('data-verdict', 'warn')
    expect(report()).toContain('WebP is made by the WebAssembly fallback (expected on Safari / iPhone; slower than native)')
  })

  it('no way to make WebP at all: the verdict is a FAIL', async () => {
    mocks.probes.mockResolvedValue(probes({ wasmWebp: { ok: false, coldMs: null, warmMs: null, bytes: 0, error: 'CompileError' }, decision: { webp: 'none', jpeg: 'canvas' } }))
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveAttribute('data-verdict', 'fail'))
    expect(screen.getByTestId('verdict')).toHaveTextContent('There is a problem on this device')
  })

  it('a picked portrait phone photo goes through the real pipeline call: timings, before / after, orientation OK, link preview, and the report says so', async () => {
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok'))
    fireEvent.change(input(), { target: { files: [photo(6)] } })
    const run = await screen.findByTestId('run-1')
    expect(mocks.convert).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ profile: 'cover' }))
    expect(run).toHaveAttribute('data-status', 'pass')
    expect(within(run).getByTestId('run-1-orientation')).toHaveAttribute('data-status', 'ok')
    expect(within(run).getByTestId('run-1-orientation')).toHaveTextContent('Orientation correct (Rotation tag: 6)')
    expect(within(run).getByTestId('run-1-webp')).toHaveTextContent('1440 x 1920')
    expect(within(run).getByTestId('run-1-og-info')).toHaveTextContent('1200 x 630')
    expect(within(run).getByTestId('run-1-og-info')).toHaveTextContent('progressive')
    expect(within(run).getByTestId('run-1-time')).toHaveTextContent(/decoding .* ms/)
    expect(within(run).getByTestId('run-1-original')).toHaveAttribute('src', expect.stringMatching(/^blob:preview/))
    expect(within(run).getByTestId('run-1-after')).toBeInTheDocument()
    expect(within(run).getByTestId('run-1-og')).toBeInTheDocument()
    expect(report()).toContain('PHOTO 1: PASS')
    expect(report()).toContain('File: IMG_0001.JPG   image/jpeg')
    expect(report()).toContain('Source: jpeg 4032 x 3024')
    expect(report()).toContain('Rotation tag: 6')
    expect(report()).toContain('orientation OK')
    expect(report()).toContain('Link-preview JPEG: 1200 x 630')
  })

  it('a conversion that ignored the rotation tag is flagged WRONG and fails the report', async () => {
    mocks.convert.mockResolvedValue(converted({ source: { type: 'jpeg', width: 4032, height: 3024, bytes: 3_900_000 } })) // decoded at the sensor size
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok'))
    fireEvent.change(input(), { target: { files: [photo(6)] } })
    const run = await screen.findByTestId('run-1')
    expect(within(run).getByTestId('run-1-orientation')).toHaveAttribute('data-status', 'fail')
    expect(within(run).getByTestId('run-1-orientation')).toHaveTextContent('Orientation WRONG')
    expect(run).toHaveAttribute('data-status', 'fail')
    expect(screen.getByTestId('verdict')).toHaveAttribute('data-verdict', 'fail')
    expect(report()).toContain('was IGNORED')
  })

  it('a photo the browser cannot read (HEIC) is shown as refused with the translated reason and goes into the report', async () => {
    mocks.convert.mockRejectedValue(new ImageError('heic'))
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok'))
    fireEvent.click(screen.getByTestId('any-type'))
    expect(input()).toHaveAttribute('accept', 'image/*')
    fireEvent.change(input(), { target: { files: [new File([Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])], 'IMG_9.HEIC', { type: 'image/heic' })] } })
    expect(await screen.findByTestId('run-1-error')).toHaveTextContent(/HEIC\/HEIF photos cannot be read/)
    expect(report()).toContain('Refused: heic - HEIC/HEIF photos cannot be read by this browser.')
    expect(screen.getByTestId('run-1')).toHaveAttribute('data-status', 'warn')
  })

  it('the profile choice is passed to the pipeline; a repeated run converts again (a new File object: the pipeline caches one result per File)', async () => {
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok'))
    fireEvent.change(screen.getByTestId('profile'), { target: { value: 'avatar' } })
    const file = photo(1)
    fireEvent.change(input(), { target: { files: [file] } })
    await screen.findByTestId('run-1')
    fireEvent.change(input(), { target: { files: [file] } })
    await screen.findByTestId('run-2')
    expect(mocks.convert).toHaveBeenCalledTimes(2)
    expect(mocks.convert.mock.calls[0][1].profile).toBe('avatar')
    expect(mocks.convert.mock.calls[0][0]).not.toBe(mocks.convert.mock.calls[1][0])
    expect(report()).toContain('PHOTO 2')
    expect(report()).toContain('PHOTO 1')
  })

  it('the built-in test image runs the pipeline without a photo', async () => {
    const ctx = { createLinearGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, fillText: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {}, fill: () => {} }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' })))
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok'))
    fireEvent.click(screen.getByTestId('test-image'))
    await screen.findByTestId('run-1')
    expect(mocks.convert.mock.calls[0][0]).toMatchObject({ name: 'built-in-test.png', type: 'image/png' })
    expect(report()).toContain('File: built-in-test.png')
  })

  it('"Check again" probes again; the developer switch asks the probes to pretend the browser cannot make WebP', async () => {
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok'))
    fireEvent.click(screen.getByTestId('reprobe'))
    await waitFor(() => expect(mocks.probes).toHaveBeenCalledTimes(2))
    mocks.probes.mockResolvedValue(probes({ forcedNoNativeWebp: true, decision: { webp: 'wasm', jpeg: 'wasm' } }))
    fireEvent.click(screen.getByTestId('force-fallback'))
    await waitFor(() => expect(mocks.probes).toHaveBeenLastCalledWith({ forceNoNativeWebp: true }))
    await waitFor(() => expect(report()).toContain('DEV switch ON'))
  })

  it('copies the report with the clipboard API; when that is missing (an http page on the LAN) it selects the text and tells the user what to do', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=en' })
    await waitFor(() => expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok'))
    fireEvent.click(screen.getByTestId('copy-report'))
    await waitFor(() => expect(screen.getByTestId('copy-status')).toHaveTextContent('Copied. Paste it in the chat.'))
    expect(writeText).toHaveBeenCalledWith(report())

    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    document.execCommand = vi.fn(() => false)
    fireEvent.click(screen.getByTestId('copy-report'))
    await waitFor(() => expect(screen.getByTestId('copy-status')).toHaveTextContent('Could not copy automatically'))
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('clears the photo results and speaks Arabic (RTL page, English report)', async () => {
    renderWithProviders(<DevImageCheckPage />, { route: '/dev/image-check?lang=ar' })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('فحص الصور على هذا الجهاز')
    await waitFor(() => expect(screen.getByTestId('probe-wasmWebp')).toHaveAttribute('data-state', 'ok'))
    expect(screen.getByTestId('probe-used')).toHaveTextContent('سينتج التطبيق WebP عبر')
    fireEvent.change(input(), { target: { files: [photo(6)] } })
    await screen.findByTestId('run-1')
    expect(screen.getByTestId('run-1-orientation')).toHaveTextContent('الاتجاه صحيح')
    expect(report()).toContain('PHOTO 1: PASS') // the report stays English
    fireEvent.click(screen.getByTestId('clear-runs'))
    expect(screen.queryByTestId('run-1')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })
})
