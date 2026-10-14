import { describe, expect, it, vi } from 'vitest'
import { convertToWebp } from './convert.js'
import { ImageError } from './errors.js'
import { OG_BUCKET, OG_HEIGHT, OG_MIME, OG_MIN_QUALITY, OG_QUALITY, OG_TARGET_BYTES, OG_WIDTH, PROFILES, ogQualityLadder } from './profiles.js'
import { ogPathOf } from './paths.js'
import { describeOg } from './format.js'
import { jpegBytes, pngBytes, svgText, toFile, webpBytes } from './testFixtures.js'

/**
 * The JPEG link-preview derivative (owner decision 08 section 18.6): what the pipeline decides about it, with a fake backend that has the two
 * optional JPEG capabilities (`coverCrop`, `encodeJpeg`). Pixels never exist; sizes are functions of the quality.
 */
function fakeBackend({ dims = { width: 4000, height: 3000 }, jpegSize = (q) => Math.round(q * 400_000), progressive = true, jpeg = true, cover = true } = {}) {
  const log = { cover: [], jpeg: [], dispose: 0 }
  const backend = {
    supportsWebp: vi.fn(async () => true),
    decode: vi.fn(async () => ({ ...dims, source: {}, dispose: vi.fn() })),
    scale: vi.fn(async (_d, width, height) => ({ width, height, source: {}, dispose: vi.fn() })),
    encode: vi.fn(async (surface) => new Blob([new Uint8Array(Math.max(1, Math.round(surface.width * surface.height * 0.02)))], { type: 'image/webp' })),
  }
  if (cover) {
    backend.coverCrop = vi.fn(async (_d, width, height) => {
      log.cover.push([width, height])
      return { width, height, source: {}, dispose: () => { log.dispose += 1 } }
    })
  }
  if (jpeg) {
    backend.encodeJpeg = vi.fn(async (surface, { quality }) => {
      log.jpeg.push({ w: surface.width, h: surface.height, quality })
      const bytes = jpegSize(quality)
      return bytes == null ? null : { blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), progressive }
    })
  }
  return { backend, log }
}
const png = (opts = {}, name = 'photo.png', pad = 600_000) => toFile(pngBytes({ ...opts, pad }), name, 'image/png')

describe('the shared profiles', () => {
  it('only the profiles of SHARED images ask for the derivative: cover (covers, form cover, share image) and landing', () => {
    expect(Object.entries(PROFILES).filter(([, p]) => p.og).map(([k]) => k).sort()).toEqual(['cover', 'landing'])
    for (const k of ['content', 'avatar', 'logo', 'frame', 'template', 'attachment']) expect(PROFILES[k].og).toBeUndefined()
  })
  it('1200 x 630 JPEG, quality 82, at most 300 KB, in the public og-images bucket', () => {
    expect([OG_WIDTH, OG_HEIGHT, OG_QUALITY, OG_TARGET_BYTES, OG_MIME, OG_BUCKET]).toEqual([1200, 630, 0.82, 300 * 1024, 'image/jpeg', 'og-images'])
  })
  it('the quality ladder steps down from 0.82 to the floor and equals the server backfill ([82, 74, 66, 58, 52])', () => {
    expect(ogQualityLadder()).toEqual([0.82, 0.74, 0.66, 0.58, 0.52])
    expect(ogQualityLadder().at(-1)).toBe(OG_MIN_QUALITY)
  })
})

describe('ogPathOf: the deterministic path (no DB column)', () => {
  it('<owner>/<kind>/<uuid>.webp -> <owner>/<kind>/<uuid>.jpg', () => {
    expect(ogPathOf('P/cover/abc.webp')).toBe('P/cover/abc.jpg')
    expect(ogPathOf('f5223948-3509-414e-8eea-b79ced147826/project-cover/9c2b68b4-66c4-54ec-98ed-146683247672.webp')).toBe('f5223948-3509-414e-8eea-b79ced147826/project-cover/9c2b68b4-66c4-54ec-98ed-146683247672.jpg')
    expect(ogPathOf('P/og/ABC.WEBP')).toBe('P/og/ABC.jpg')
  })
  it('a thumbnail, an SVG, a legacy raster, a double extension and nothing have no derivative', () => {
    for (const p of ['P/cover/abc_t.webp', 'P/logo/abc.svg', 'P/cover/abc.png', 'P/cover/abc.jpg', 'P/cover/abc.webp.bak', '', null, undefined]) expect(ogPathOf(p), String(p)).toBe('')
  })
})

describe('convertToWebp: the link-preview JPEG of a shared image', () => {
  it('a cover gets a 1200 x 630 cover crop, JPEG, progressive, at quality 0.82 when that already fits 300 KB', async () => {
    const { backend, log } = fakeBackend({ jpegSize: () => 80_000 })
    const r = await convertToWebp(png(), { profile: 'cover', backend })
    expect(log.cover).toEqual([[1200, 630]])
    expect(log.jpeg).toEqual([{ w: 1200, h: 630, quality: 0.82 }])
    expect(r.og).toMatchObject({ width: 1200, height: 630, bytes: 80_000, mime: 'image/jpeg', ext: 'jpg', quality: 0.82, progressive: true })
    expect(r.og.blob.type).toBe('image/jpeg')
    expect(r.report.og).toEqual({ bytes: 80_000, width: 1200, height: 630, quality: 0.82, progressive: true })
    expect(r.full.mime).toBe('image/webp') // WebP stays the stored / displayed format
    expect(r.report.notices).not.toContain('ogFailed')
    expect(log.dispose).toBe(1) // the crop surface is released
  })

  it('steps the quality down until it fits 300 KB (WhatsApp ignores a bigger preview); else the SMALLEST is kept', async () => {
    const stepped = fakeBackend({ jpegSize: (q) => Math.round(q * 500_000) }) // 410 KB at 0.82, 370 at 0.74, 330 at 0.66, 290 at 0.58
    const a = await convertToWebp(png(), { profile: 'cover', backend: stepped.backend })
    expect(stepped.log.jpeg.map((j) => j.quality)).toEqual([0.82, 0.74, 0.66, 0.58])
    expect(a.og).toMatchObject({ quality: 0.58, bytes: 290_000 })
    const huge = fakeBackend({ jpegSize: (q) => Math.round(q * 2_000_000) }) // never fits
    const b = await convertToWebp(png(), { profile: 'cover', backend: huge.backend })
    expect(huge.log.jpeg.map((j) => j.quality)).toEqual([0.82, 0.74, 0.66, 0.58, 0.52])
    expect(b.og).toMatchObject({ quality: 0.52, bytes: 1_040_000 })
  })

  it('reports the baseline fallback honestly (progressive: false when only the canvas encoder was available)', async () => {
    const { backend } = fakeBackend({ progressive: false, jpegSize: () => 60_000 })
    const r = await convertToWebp(png(), { profile: 'landing', backend })
    expect(r.og.progressive).toBe(false)
    expect(r.report.og.progressive).toBe(false)
  })

  it('every other profile makes none (library, avatars, logos, frames, certificate templates, respondent files)', async () => {
    for (const profile of ['content', 'avatar', 'logo', 'frame', 'template', 'attachment']) {
      const { backend, log } = fakeBackend()
      const r = await convertToWebp(png({}, `${profile}.png`), { profile, backend })
      expect(r.og, profile).toBeNull()
      expect(r.report.og, profile).toBeNull()
      expect(log.cover, profile).toEqual([])
    }
  })

  it('an already-WebP cover that is kept as it is still gets its derivative (the crawler needs a JPEG whatever the stored format)', async () => {
    const { backend } = fakeBackend({ dims: { width: 1200, height: 800 }, jpegSize: () => 50_000 })
    const file = toFile(webpBytes({ kind: 'VP8X', width: 1200, height: 800, pad: 50_000 }), 'ok.webp', 'image/webp')
    const r = await convertToWebp(file, { profile: 'cover', backend })
    expect(r.report.kind).toBe('kept')
    expect(r.og).toMatchObject({ width: 1200, height: 630, bytes: 50_000 })
  })

  it('a JPEG source works the same (the common phone cover)', async () => {
    const { backend } = fakeBackend({ jpegSize: () => 70_000 })
    const r = await convertToWebp(toFile(jpegBytes({ width: 4000, height: 3000, pad: 800_000 }), 'IMG_1.jpg', 'image/jpeg'), { profile: 'cover', backend })
    expect(r.og.bytes).toBe(70_000)
  })

  it('NEVER blocks the WebP: an encoder that fails or throws leaves og null, the notice ogFailed, and a complete WebP result', async () => {
    const nothing = fakeBackend({ jpegSize: () => null })
    const a = await convertToWebp(png(), { profile: 'cover', backend: nothing.backend })
    expect(a.og).toBeNull()
    expect(a.report.notices).toContain('ogFailed')
    expect(a.full.mime).toBe('image/webp')
    expect(a.thumb).not.toBeNull()

    const throwing = fakeBackend()
    throwing.backend.coverCrop = vi.fn(async () => { throw new Error('out of memory') })
    const b = await convertToWebp(png({}, 'b.png'), { profile: 'cover', backend: throwing.backend })
    expect(b.og).toBeNull()
    expect(b.report.notices).toContain('ogFailed')
  })

  it('a backend without the JPEG capability makes none and says nothing (an older fake / an exotic runtime)', async () => {
    for (const opts of [{ jpeg: false }, { cover: false }]) {
      const { backend } = fakeBackend(opts)
      const r = await convertToWebp(png(), { profile: 'cover', backend })
      expect(r.og).toBeNull()
      expect(r.report.notices).not.toContain('ogFailed')
    }
  })

  it('an abort while the derivative is encoded still aborts the conversion', async () => {
    const controller = new AbortController()
    const { backend } = fakeBackend()
    backend.encodeJpeg = vi.fn(async () => { controller.abort(); return { blob: new Blob([new Uint8Array(500_000)], { type: 'image/jpeg' }), progressive: true } })
    const err = await convertToWebp(png(), { profile: 'cover', backend, signal: controller.signal }).catch((e) => e)
    expect(err).toBeInstanceOf(ImageError)
    expect(err.code).toBe('aborted')
  })

  it('SVG (a vector logo) has none', async () => {
    const { backend } = fakeBackend()
    const r = await convertToWebp(new File([svgText()], 'logo.svg', { type: 'image/svg+xml' }), { profile: 'logo', backend })
    expect(r.og).toBeNull()
  })

  it('announces the stage so the field can show "Preparing the link-preview image"', async () => {
    const { backend } = fakeBackend({ jpegSize: () => 50_000 })
    const stages = []
    await convertToWebp(png(), { profile: 'cover', backend, onProgress: (e) => stages.push(e.stage) })
    expect(stages.indexOf('og')).toBeGreaterThan(stages.indexOf('thumbnail'))
    expect(stages.at(-1)).toBe('done')
  })
})

describe('describeOg', () => {
  it('the feedback line of the derivative, or null', () => {
    expect(describeOg({ og: { bytes: 84 * 1024, width: 1200, height: 630 } })).toMatchObject({ key: 'image.og', vars: { w: 1200, h: 630 } })
    expect(describeOg({ og: { bytes: 84 * 1024, width: 1200, height: 630 } }).vars.size).toContain('84 KB')
    expect(describeOg({ og: null })).toBeNull()
    expect(describeOg(undefined)).toBeNull()
  })
})
