import { describe, expect, it } from 'vitest'
import { buildReport, collectEnvironment, isJpegBytes, isProgressiveJpeg, isWebpBytes, orientationVerdict, parseUserAgent, readExifOrientation, runVerdict, stageTimings } from './diagnostics.js'
import { jpegBytes, webpBytes } from './testFixtures.js'

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
}

describe('parseUserAgent', () => {
  it('iPhone Safari: device, iOS version, Safari version, WebKit', () => {
    expect(parseUserAgent(UA.iphoneSafari)).toEqual({ device: 'iPhone', os: 'iOS 17.2', browser: 'Safari 17.2', engine: 'WebKit', mobile: true })
  })
  it('Chrome on an iPhone is still WebKit (every iOS browser is) and says so', () => {
    expect(parseUserAgent(UA.iphoneChrome)).toMatchObject({ device: 'iPhone', os: 'iOS 17.2.1', browser: 'Chrome 120 (iOS, WebKit)', engine: 'WebKit' })
  })
  it('an iPad in desktop mode (a Macintosh UA with touch) is recognised; a real Mac is not', () => {
    expect(parseUserAgent(UA.macSafari, { touchPoints: 5 })).toMatchObject({ device: 'iPad (desktop mode)', os: 'iPadOS', mobile: true })
    expect(parseUserAgent(UA.macSafari)).toMatchObject({ device: 'Mac', browser: 'Safari 17.2', engine: 'WebKit', mobile: false })
  })
  it('Android Chrome, Windows Chrome / Edge / Firefox (Blink, Blink, Gecko)', () => {
    expect(parseUserAgent(UA.androidChrome)).toMatchObject({ os: 'Android 14', browser: 'Chrome 120', engine: 'Blink', mobile: true })
    expect(parseUserAgent(UA.windowsChrome)).toMatchObject({ device: 'Windows PC', browser: 'Chrome 120', engine: 'Blink' })
    expect(parseUserAgent(UA.windowsEdge)).toMatchObject({ browser: 'Edge 120' })
    expect(parseUserAgent(UA.firefox)).toMatchObject({ browser: 'Firefox 121', engine: 'Gecko' })
  })
  it('an empty or odd string never throws', () => {
    expect(parseUserAgent('')).toMatchObject({ device: 'unknown', browser: 'unknown' })
    expect(parseUserAgent(undefined)).toMatchObject({ os: 'unknown' })
  })
})

/** A JPEG whose APP1 segment carries an EXIF orientation (little or big endian TIFF). */
function jpegWithExif(orientation, { little = true, extraBefore = [] } = {}) {
  const u16 = (n) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
  const u32 = (n) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(0x2a), ...u32(8), ...u16(2),
    ...u16(0x010f), ...u16(2), ...u32(0), ...u32(0), // a first entry that is not the orientation
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
    ...u32(0)]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = payload.length + 2
  return Uint8Array.from([0xff, 0xd8, ...extraBefore, 0xff, 0xe1, len >> 8, len & 255, ...payload, 0xff, 0xc0, 0, 11, 8, 0, 8, 0, 8, 1, 1, 0x11, 0, 0xff, 0xd9])
}

describe('readExifOrientation', () => {
  it('reads the tag of a little-endian and a big-endian EXIF block, 1 .. 8', () => {
    for (const o of [1, 3, 6, 8]) {
      expect(readExifOrientation(jpegWithExif(o))).toBe(o)
      expect(readExifOrientation(jpegWithExif(o, { little: false }))).toBe(o)
    }
  })
  it('skips other segments before the EXIF one (APP0 JFIF first, as cameras write it)', () => {
    const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
    expect(readExifOrientation(jpegWithExif(6, { extraBefore: app0 }))).toBe(6)
  })
  it('null for a JPEG without EXIF, a value out of range, a truncated block, a PNG, and nothing', () => {
    expect(readExifOrientation(Uint8Array.from(jpegBytes()))).toBeNull()
    expect(readExifOrientation(jpegWithExif(9))).toBeNull()
    expect(readExifOrientation(jpegWithExif(6).slice(0, 24))).toBeNull()
    expect(readExifOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
    expect(readExifOrientation(null)).toBeNull()
  })
})

describe('orientationVerdict', () => {
  const base = { headerWidth: 4032, headerHeight: 3024 }
  it('a portrait phone photo (tag 6, sensor 4032 x 3024) decoded as 3024 x 4032 is upright: ok', () => {
    expect(orientationVerdict({ ...base, exif: 6, decodedWidth: 3024, decodedHeight: 4032 })).toMatchObject({ status: 'ok', exif: 6 })
    expect(orientationVerdict({ ...base, exif: 8, decodedWidth: 3024, decodedHeight: 4032 }).status).toBe('ok')
  })
  it('the same photo decoded at the sensor size means the tag was ignored: FAIL (it would be stored lying down)', () => {
    const v = orientationVerdict({ ...base, exif: 6, decodedWidth: 4032, decodedHeight: 3024 })
    expect(v.status).toBe('fail')
    expect(v.note).toMatch(/IGNORED/)
  })
  it('no tag, or a tag that does not turn the picture, proves nothing (na) and says how to test', () => {
    expect(orientationVerdict({ ...base, exif: null, decodedWidth: 4032, decodedHeight: 3024 })).toMatchObject({ status: 'na', exif: null })
    expect(orientationVerdict({ ...base, exif: 1, decodedWidth: 4032, decodedHeight: 3024 }).note).toMatch(/held upright/)
    expect(orientationVerdict({ ...base, exif: 3, decodedWidth: 4032, decodedHeight: 3024 }).status).toBe('na')
  })
  it('sizes that match neither are "unknown", never a false pass', () => {
    expect(orientationVerdict({ ...base, exif: 6, decodedWidth: 1000, decodedHeight: 900 }).status).toBe('unknown')
    expect(orientationVerdict({ exif: 6, headerWidth: 0, headerHeight: 0, decodedWidth: 1, decodedHeight: 1 }).status).toBe('unknown')
  })
})

describe('byte checks', () => {
  it('WebP / JPEG magic bytes, and progressive vs baseline (SOF2 vs SOF0)', () => {
    expect(isWebpBytes(Uint8Array.from(webpBytes()))).toBe(true)
    expect(isWebpBytes(Uint8Array.from(jpegBytes()))).toBe(false)
    expect(isJpegBytes(Uint8Array.from(jpegBytes()))).toBe(true)
    expect(isJpegBytes(Uint8Array.from(webpBytes()))).toBe(false)
    expect(isProgressiveJpeg(Uint8Array.from(jpegBytes()))).toBe(false) // SOF0 = baseline
    const progressive = Uint8Array.from(jpegBytes())
    const sof = progressive.findIndex((b, i) => b === 0xff && progressive[i + 1] === 0xc0)
    progressive[sof + 1] = 0xc2
    expect(isProgressiveJpeg(progressive)).toBe(true)
    expect(isProgressiveJpeg(Uint8Array.from(webpBytes()))).toBeNull()
  })
})

describe('stageTimings', () => {
  it('a stage lasts until the next one starts; repeated stages (the encode ladder) add up; done is not a stage', () => {
    const events = [{ stage: 'checking', t: 100 }, { stage: 'decoding', t: 110 }, { stage: 'resizing', t: 250 }, { stage: 'encoding', t: 300 }, { stage: 'encoding', t: 420 }, { stage: 'thumbnail', t: 500 }, { stage: 'done', t: 540 }]
    expect(stageTimings(events, 545)).toEqual({
      stages: [{ stage: 'checking', ms: 10 }, { stage: 'decoding', ms: 140 }, { stage: 'resizing', ms: 50 }, { stage: 'encoding', ms: 200 }, { stage: 'thumbnail', ms: 40 }],
      totalMs: 445,
    })
  })
  it('no events: nothing, total from the sum', () => {
    expect(stageTimings([], 10)).toEqual({ stages: [], totalMs: 0 })
    expect(stageTimings(undefined, undefined)).toEqual({ stages: [], totalMs: 0 })
  })
})

describe('collectEnvironment', () => {
  const scope = (over = {}) => ({
    navigator: { userAgent: UA.iphoneSafari, platform: 'iPhone', language: 'ar-EG', maxTouchPoints: 5, hardwareConcurrency: 6, onLine: true },
    screen: { width: 390, height: 844 },
    devicePixelRatio: 3,
    innerWidth: 390,
    innerHeight: 664,
    isSecureContext: false,
    crossOriginIsolated: false,
    createImageBitmap() {},
    OffscreenCanvas: function OffscreenCanvas() {},
    ImageData: function ImageData() {},
    WebAssembly: { validate: () => true },
    ...over,
  })
  it('gathers the browser facts, parses the UA and detects the features', () => {
    const e = collectEnvironment(scope())
    expect(e).toMatchObject({ platform: 'iPhone', language: 'ar-EG', screen: '390x844', pixelRatio: 3, viewport: '390x664', touchPoints: 5, cores: 6, memoryGb: null, secureContext: false })
    expect(e.parsed).toMatchObject({ device: 'iPhone', os: 'iOS 17.2', browser: 'Safari 17.2' })
    expect(e.features).toEqual({ createImageBitmap: true, offscreenCanvas: true, imageData: true, webAssembly: true, wasmSimd: true, clipboardApi: false, share: false })
  })
  it('missing APIs are reported as no, never thrown (an old browser, no WebAssembly, a throwing validate)', () => {
    const e = collectEnvironment({ navigator: {}, screen: {}, WebAssembly: undefined })
    expect(e.features).toMatchObject({ webAssembly: false, wasmSimd: false, createImageBitmap: false, offscreenCanvas: false })
    expect(collectEnvironment({ WebAssembly: { validate() { throw new Error('boom') } } }).features.wasmSimd).toBe(false)
  })
})

// ---------------------------------------------------------------- the report
const env = collectEnvironment({
  navigator: { userAgent: UA.iphoneSafari, platform: 'iPhone', language: 'ar-EG', maxTouchPoints: 5, hardwareConcurrency: 6 },
  screen: { width: 390, height: 844 }, devicePixelRatio: 3, innerWidth: 390, innerHeight: 664, isSecureContext: true,
  createImageBitmap() {}, OffscreenCanvas: function OffscreenCanvas() {}, ImageData: function ImageData() {}, WebAssembly: { validate: () => true },
})
const nativeOk = { ok: true, type: 'image/webp', bytes: 30, ms: 1.2, error: null }
const probesChrome = {
  forcedNoNativeWebp: false,
  nativeWebp: { offscreen: nativeOk, dom: nativeOk },
  nativeJpeg: { offscreen: { ...nativeOk, type: 'image/jpeg' }, dom: { ...nativeOk, type: 'image/jpeg' } },
  wasmWebp: { ok: true, coldMs: 310, warmMs: 4, bytes: 120, magic: true },
  wasmJpeg: { ok: true, coldMs: 220, warmMs: 6, bytes: 300, jpegMagic: true, progressive: true },
  decision: { webp: 'native', jpeg: 'wasm' },
}
const probesSafari = {
  ...probesChrome,
  nativeWebp: { offscreen: { ok: false, type: 'image/png', bytes: 90, ms: 2, error: null }, dom: { ok: false, type: 'image/png', bytes: 90, ms: 2, error: null } },
  decision: { webp: 'wasm', jpeg: 'wasm' },
}
const goodRun = (over = {}) => ({
  id: 1,
  file: { name: 'IMG_0001.JPG', type: 'image/jpeg', bytes: 3_900_000 },
  profile: 'cover',
  headerInfo: { type: 'jpeg', width: 4032, height: 3024 },
  orientation: { status: 'ok', exif: 6, note: 'upright: the 4032 x 3024 sensor image was turned to 3024 x 4032' },
  result: {
    source: { type: 'jpeg', width: 3024, height: 4032, bytes: 3_900_000 },
    full: { width: 1440, height: 1920, bytes: 188 * 1024 },
    thumb: { width: 240, height: 320, bytes: 14 * 1024 },
    og: { width: 1200, height: 630, bytes: 71 * 1024, quality: 0.82, progressive: true },
    report: { kind: 'converted', sourceBytes: 3_900_000, bytes: 188 * 1024, savedBytes: 3_900_000 - 188 * 1024, quality: 0.8, attempts: 1, notices: ['resized'] },
  },
  webpMagicOk: true,
  ogMagicOk: true,
  encoders: { webpNative: 0, webpWasm: 2, jpegNative: 0, jpegWasm: 1 },
  timings: { stages: [{ stage: 'decoding', ms: 120 }, { stage: 'encoding', ms: 320 }], totalMs: 560 },
  error: null,
  ...over,
})

describe('buildReport', () => {
  it('Chrome with everything native: PASS, the whole story in plain text', () => {
    const { text, verdict } = buildReport({ now: '2026-10-14T05:00:00.000Z', page: { url: 'http://192.168.1.7:5400/dev/image-check' }, env, probes: probesChrome, runs: [goodRun({ encoders: { webpNative: 2, webpWasm: 0, jpegNative: 0, jpegWasm: 1 } })] })
    expect(verdict).toBe('pass')
    expect(text).toMatch(/^ATHAR IMAGE CHECK REPORT\nTime: 2026-10-14T05:00:00.000Z\nPage: http:\/\/192\.168\.1\.7:5400\/dev\/image-check\nRESULT: PASS\n/)
    expect(text).toContain('Detected: iPhone, iOS 17.2, Safari 17.2 (WebKit engine)')
    expect(text).toContain('Screen: 390x844 @3x   Viewport: 390x664   Touch points: 5')
    expect(text).toContain('Canvas WebP (OffscreenCanvas): yes (30 B, 1 ms)')
    expect(text).toContain('WebAssembly WebP: OK first run 310 ms (includes loading the codec), warm 4 ms, 120 B, RIFF/WEBP bytes yes')
    expect(text).toContain('WebAssembly JPEG: OK first run 220 ms (includes loading the codec), warm 6 ms, 300 B, progressive yes')
    expect(text).toContain('The pipeline will use: WebP = native, link-preview JPEG = wasm')
    expect(text).toContain('PHOTO 1: PASS')
    expect(text).toContain('Rotation tag: 6 (rotated 90 clockwise (phone held upright)) -> orientation OK')
    expect(text).toContain('WebP: 1440 x 1920, 188 KB (converted, saved 3.5 MB, quality 0.8, 1 encode attempt) bytes valid yes')
    expect(text).toContain('Link-preview JPEG: 1200 x 630, 71 KB, quality 0.82, progressive, bytes valid yes')
    expect(text).toContain('Encoder used: WebP native x2; JPEG wasm x1')
    expect(text).toContain('Time: decoding 120 ms, encoding 320 ms -> total 560 ms')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('iPhone / Safari: the canvas answers PNG, the WebAssembly fallback works: WARN with the reason (expected, not an error)', () => {
    const { text, verdict, summary } = buildReport({ now: 't', env, probes: probesSafari, runs: [goodRun()] })
    expect(verdict).toBe('warn')
    expect(text).toContain('Canvas WebP (OffscreenCanvas): NO (the canvas answered image/png)')
    expect(text).toContain('The pipeline will use: WebP = wasm, link-preview JPEG = wasm')
    expect(text).toContain('WebP is made by the WebAssembly fallback (expected on Safari / iPhone; slower than native)')
    expect(text).toContain('Encoder used: WebP wasm x2; JPEG wasm x1')
    expect(summary.runs).toEqual([{ id: 1, status: 'pass' }])
  })

  it('no way to make WebP: FAIL (no upload would be possible)', () => {
    const probes = { ...probesSafari, wasmWebp: { ok: false, coldMs: null, warmMs: null, bytes: 0, error: 'CompileError: wasm blocked' }, decision: { webp: 'none', jpeg: 'canvas' } }
    const { verdict, text } = buildReport({ now: 't', env, probes, runs: [] })
    expect(verdict).toBe('fail')
    expect(text).toContain('WebAssembly WebP: FAILED [CompileError: wasm blocked]')
    expect(text).toContain('neither the canvas nor the WebAssembly fallback works')
    expect(text).toContain('no photo was converted yet')
  })

  it('the rotation tag ignored = FAIL for that photo and for the report', () => {
    const run = goodRun({ orientation: { status: 'fail', exif: 6, note: 'the rotation tag (rotated 90 clockwise (phone held upright)) was IGNORED: decoded at 4032 x 3024, the photo would be stored lying down' } })
    const { verdict, text } = buildReport({ now: 't', env, probes: probesChrome, runs: [run] })
    expect(verdict).toBe('fail')
    expect(text).toContain('PHOTO 1: FAIL')
    expect(text).toContain('was IGNORED')
  })

  it('a HEIC the browser cannot read is a WARN with the code, not a crash; a refused photo has no result block', () => {
    const run = { id: 2, file: { name: 'IMG_9.HEIC', type: 'image/heic', bytes: 2_000_000 }, profile: 'cover', error: { code: 'heic', message: 'HEIC/HEIF photos cannot be read by this browser.' }, timings: { stages: [], totalMs: 12 } }
    const { verdict, text } = buildReport({ now: 't', env, probes: probesChrome, runs: [run] })
    expect(verdict).toBe('warn')
    expect(text).toContain('PHOTO 2: WARN')
    expect(text).toContain('Refused: heic - HEIC/HEIF photos cannot be read by this browser.')
    expect(text).not.toContain('Decoded:')
    expect(runVerdict(run)).toMatchObject({ status: 'warn' })
  })

  it('invalid output bytes, a failed link-preview and an insecure page each lower the verdict', () => {
    expect(runVerdict(goodRun({ webpMagicOk: false })).status).toBe('fail')
    expect(runVerdict(goodRun({ ogMagicOk: false })).status).toBe('fail')
    const failedOg = goodRun()
    failedOg.result.og = null
    failedOg.result.report.notices = ['ogFailed']
    expect(runVerdict(failedOg).status).toBe('warn')
    const insecure = buildReport({ now: 't', env: { ...env, secureContext: false }, probes: probesChrome, runs: [] })
    expect(insecure.text).toContain('not a secure context')
    expect(insecure.verdict).toBe('warn')
  })

  it('works with nothing at all (the page before anything ran) and never throws', () => {
    const { text, verdict } = buildReport({})
    expect(verdict).toBe('warn')
    expect(text).toContain('the encoding probes did not run')
  })

  it('the DEV switch is stated in the report so nobody mistakes a forced fallback for the browser\'s own', () => {
    const { text } = buildReport({ now: 't', env, probes: { ...probesSafari, forcedNoNativeWebp: true }, runs: [] })
    expect(text).toContain('DEV switch ON: the native WebP encoder is switched off on purpose')
  })
})
