import { describe, expect, it, vi } from 'vitest'
import { convertToWebp, fitWithin, svgProblem, validateImageFile } from './convert.js'
import { ImageError } from './errors.js'
import { MAX_SOURCE_BYTES, PROFILES } from './profiles.js'
import { gifBytes, heicBytes, jpegBytes, pdfBytes, pngBytes, svgText, toFile, webpBytes } from './testFixtures.js'

/**
 * A fake backend: decode reports `dims`, scale records the target, encode answers a WebP blob whose size is `size(quality, w, h)`.
 * Pixels never exist; what is tested is the pipeline's DECISIONS (sizes, ladder, size guard, keep-as-is, notices, errors).
 */
function fakeBackend({ dims = { width: 4000, height: 3000 }, webp = true, size = (q, w, h) => Math.round(w * h * q * 0.05), decodeError = null } = {}) {
  const log = { decode: [], scale: [], encode: [] }
  const backend = {
    supportsWebp: vi.fn(async () => webp),
    decode: vi.fn(async (file) => {
      log.decode.push(file)
      if (decodeError) throw decodeError
      return { ...dims, source: {}, dispose: vi.fn() }
    }),
    scale: vi.fn(async (_d, width, height) => {
      log.scale.push([width, height])
      return { width, height, source: { width, height }, dispose: vi.fn() }
    }),
    encode: vi.fn(async (surface, { quality }) => {
      log.encode.push({ w: surface.width, h: surface.height, quality })
      return new Blob([new Uint8Array(size(quality, surface.width, surface.height))], { type: 'image/webp' })
    }),
  }
  return { backend, log }
}

// `pad` makes the file that many bytes bigger (inside the image data, so the terminator is still the last thing in the file)
const png = (opts, name = 'photo.png', pad = 0) => toFile(pngBytes({ ...opts, pad }), name, 'image/png')
const jpg = (opts, name = 'photo.jpg', pad = 0) => toFile(jpegBytes({ ...opts, pad }), name, 'image/jpeg')

describe('convertToWebp: PNG / JPEG -> WebP', () => {
  it('caps the longest side by the profile, never upscales, and makes the 320 px thumbnail', async () => {
    const { backend, log } = fakeBackend({ dims: { width: 4000, height: 3000 } })
    const r = await convertToWebp(png({ width: 4000, height: 3000 }, 'big.png', 3_000_000), { profile: 'cover', backend })
    expect(r.full).toMatchObject({ width: 1920, height: 1440, mime: 'image/webp', ext: 'webp' })
    expect(r.thumb).toMatchObject({ width: 320, height: 240, mime: 'image/webp' })
    expect(log.scale).toEqual([[1920, 1440], [320, 240]])
    expect(r.source).toMatchObject({ type: 'png', width: 4000, height: 3000 })
    expect(r.report.notices).toContain('resized')

    const small = fakeBackend({ dims: { width: 800, height: 600 } })
    const s = await convertToWebp(jpg({ width: 800, height: 600 }, 'small.jpg', 100_000), { profile: 'cover', backend: small.backend })
    expect(s.full).toMatchObject({ width: 800, height: 600 })
    expect(s.report.notices).not.toContain('resized')
  })

  it('uses each profile: avatar 512, content 1600, template 4000 without a thumbnail', async () => {
    const run = async (profile, dims) => {
      const { backend } = fakeBackend({ dims })
      return convertToWebp(png({ width: dims.width, height: dims.height }, `${profile}.png`, 500_000), { profile, backend })
    }
    expect((await run('avatar', { width: 3000, height: 2000 })).full.width).toBe(512)
    expect((await run('content', { width: 3000, height: 2000 })).full.width).toBe(1600)
    const t = await run('template', { width: 6000, height: 4000 })
    expect(t.full.width).toBe(4000)
    expect(t.thumb).toBeNull()
  })

  it('the thumbnail of an image that is already small is the image itself (the file must still exist for displays)', async () => {
    const { backend } = fakeBackend({ dims: { width: 200, height: 100 } })
    const r = await convertToWebp(png({ width: 200, height: 100 }, 'tiny.png', 5000), { profile: 'cover', backend })
    expect(r.thumb.blob).toBe(r.full.blob)
    expect(r.thumb).toMatchObject({ width: 200, height: 100 })
  })

  it('EXIF: the backend is asked to decode the file itself (it applies the orientation); the report uses the decoded size', async () => {
    const { backend, log } = fakeBackend({ dims: { width: 2000, height: 3000 } }) // a 3000 x 2000 sensor image rotated upright
    const file = jpg({ width: 3000, height: 2000 }, 'phone.jpg', 800_000)
    const r = await convertToWebp(file, { profile: 'content', backend })
    expect(log.decode).toEqual([file])
    expect(r.source).toMatchObject({ width: 2000, height: 3000 })
    expect(r.full).toMatchObject({ width: 1067, height: 1600 })
  })
})

describe('convertToWebp: quality ladder and size guard', () => {
  it('stops at the first quality that fits min(target, source size)', async () => {
    const { backend, log } = fakeBackend({ size: (q) => Math.round(q * 1_000_000) }) // 800 KB at 0.8, 730 KB at 0.73, ...
    const r = await convertToWebp(png({ width: 4000, height: 3000 }, 'p.png', 900_000), { profile: 'cover', backend })
    // target 500 KB: 0.8 -> 800 KB, 0.73 -> 730 KB, 0.66 -> 660 KB, 0.59 -> 590 KB, 0.52 -> 520 KB, 0.5 -> 500 KB (fits)
    expect(r.report.quality).toBe(0.5)
    expect(log.encode.filter((e) => e.w === 1920).map((e) => e.quality)).toEqual([0.8, 0.73, 0.66, 0.59, 0.52, 0.5])
    expect(r.report.attempts).toBe(6)
  })

  it('one attempt when the first quality already fits', async () => {
    const { backend, log } = fakeBackend({ size: () => 90_000 })
    const r = await convertToWebp(jpg({ width: 3000, height: 2000 }, 'p.jpg', 600_000), { profile: 'cover', backend })
    expect(log.encode.filter((e) => e.w === 1920)).toHaveLength(1)
    expect(r.report).toMatchObject({ kind: 'converted', quality: 0.8, bytes: 90_000, sourceBytes: expect.any(Number) })
    expect(r.report.savedBytes).toBe(r.report.sourceBytes - 90_000)
  })

  it('size guard: when no quality beats the source the SMALLEST WebP is kept, still WebP (the original raster is never uploaded)', async () => {
    const { backend } = fakeBackend({ size: (q) => 40_000 + Math.round(q * 10_000) }) // always above the 20 KB source
    const file = png({ width: 600, height: 400 }, 'tiny-logo.png', 15_000)
    const r = await convertToWebp(file, { profile: 'cover', backend })
    expect(r.full.mime).toBe('image/webp')
    expect(r.full.bytes).toBe(40_000 + Math.round(0.5 * 10_000))
    expect(r.report.kind).toBe('converted')
    expect(r.report.savedBytes).toBeLessThan(0)
    expect(r.full.blob).not.toBe(file)
  })

  it('lossless profiles start lossless and only fall back to lossy above the target', async () => {
    const { backend, log } = fakeBackend({ dims: { width: 1080, height: 1350 }, size: (q) => (q === 1 ? 900_000 : 200_000) })
    const r = await convertToWebp(png({ width: 1080, height: 1350 }, 'frame.png', 100_000), { profile: 'frame', backend })
    expect(log.encode.map((e) => e.quality)).toEqual([1, 0.99])
    expect(r.report.lossless).toBe(false)
    const lossless = fakeBackend({ dims: { width: 1080, height: 1350 }, size: () => 60_000 })
    const l = await convertToWebp(png({ width: 1080, height: 1350 }, 'frame2.png', 20_000), { profile: 'frame', backend: lossless.backend })
    expect(l.report).toMatchObject({ lossless: true, quality: 1, bytes: 60_000 }) // bigger than the source PNG, but the frame stays exact
    expect(l.thumb).toBeNull()
  })
})

describe('convertToWebp: an image that is already WebP', () => {
  it('is kept as it is when it fits the profile (no generational loss), thumbnail still made', async () => {
    const { backend, log } = fakeBackend({ dims: { width: 1200, height: 800 } })
    const file = toFile(webpBytes({ kind: 'VP8X', width: 1200, height: 800, pad: 50_000 }), 'ok.webp', 'image/webp')
    const r = await convertToWebp(file, { profile: 'content', backend })
    expect(r.report.kind).toBe('kept')
    expect(r.full.bytes).toBe(file.size)
    expect(r.full.mime).toBe('image/webp')
    expect(log.encode).toHaveLength(1) // only the thumbnail
    expect(r.thumb).toMatchObject({ width: 320, height: 213 })
  })

  it('is re-encoded when it is too large for the profile (dimensions), and the smaller of the two wins', async () => {
    const { backend } = fakeBackend({ dims: { width: 3200, height: 2400 }, size: () => 90_000 })
    const big = toFile(webpBytes({ kind: 'VP8X', width: 3200, height: 2400, pad: 400_000 }), 'big.webp', 'image/webp')
    const r = await convertToWebp(big, { profile: 'content', backend })
    expect(r.report.kind).toBe('converted')
    expect(r.full).toMatchObject({ width: 1600, height: 1200, bytes: 90_000 })
  })

  it('keeps the source when a re-encode of a fitting but heavy WebP is not smaller', async () => {
    const { backend } = fakeBackend({ dims: { width: 1000, height: 800 }, size: () => 900_000 })
    const heavy = toFile(webpBytes({ kind: 'VP8X', width: 1000, height: 800, pad: 600_000 }), 'heavy.webp', 'image/webp')
    const r = await convertToWebp(heavy, { profile: 'content', backend })
    expect(r.report.kind).toBe('kept')
    expect(r.full.bytes).toBe(heavy.size)
  })

  it('an animated WebP that fits is kept as it is (the animation survives)', async () => {
    const { backend } = fakeBackend({ dims: { width: 500, height: 500 } })
    const anim = toFile(webpBytes({ kind: 'VP8X', width: 500, height: 500, animated: true, pad: 900_000 }), 'anim.webp', 'image/webp')
    const r = await convertToWebp(anim, { profile: 'content', backend })
    expect(r.report.kind).toBe('kept')
    expect(r.report.notices).toEqual([])
  })
})

describe('convertToWebp: animated GIF', () => {
  it('keeps the FIRST FRAME and says so; a still GIF has no notice', async () => {
    const { backend } = fakeBackend({ dims: { width: 400, height: 300 } })
    const anim = toFile(gifBytes({ width: 400, height: 300, frames: 3 }), 'loop.gif', 'image/gif')
    const r = await convertToWebp(anim, { profile: 'content', backend })
    expect(r.full.mime).toBe('image/webp')
    expect(r.report.notices).toContain('animatedFirstFrame')
    const still = await convertToWebp(toFile(gifBytes({ width: 400, height: 300, frames: 1 }), 'still.gif', 'image/gif'), { profile: 'content', backend: fakeBackend({ dims: { width: 400, height: 300 } }).backend })
    expect(still.report.notices).not.toContain('animatedFirstFrame')
  })
})

describe('convertToWebp: SVG (vector)', () => {
  it('is stored untouched for the logo profile: no decode, no thumbnail, .svg', async () => {
    const { backend } = fakeBackend()
    const file = new File([svgText()], 'logo.svg', { type: 'image/svg+xml' })
    const r = await convertToWebp(file, { profile: 'logo', backend })
    expect(r.report.kind).toBe('vector')
    expect(r.full).toMatchObject({ mime: 'image/svg+xml', ext: 'svg', bytes: file.size })
    expect(r.thumb).toBeNull()
    expect(backend.decode).not.toHaveBeenCalled()
  })

  it('is refused by every other profile', async () => {
    for (const profile of ['cover', 'content', 'avatar', 'frame', 'template', 'landing']) {
      const file = new File([svgText()], 'x.svg', { type: 'image/svg+xml' })
      await expect(convertToWebp(file, { profile, backend: fakeBackend().backend })).rejects.toMatchObject({ code: 'svg' })
    }
  })

  it('refuses an SVG with scripts, handlers or external references', async () => {
    for (const inner of ['<script>alert(1)</script>', '<rect onload="x()" width="1" height="1"/>', '<a href="https://evil.example/x"><rect/></a>', '<foreignObject><div/></foreignObject>']) {
      const file = new File([svgText(inner)], 'bad.svg', { type: 'image/svg+xml' })
      await expect(convertToWebp(file, { profile: 'logo', backend: fakeBackend().backend })).rejects.toMatchObject({ code: 'svgUnsafe' })
    }
    expect(svgProblem(svgText())).toBeNull()
    expect(svgProblem(svgText('<use href="#a"/>'))).toBeNull()
  })
})

describe('convertToWebp: refusals (never an upload of the original)', () => {
  const refuse = async (file, code, opts = {}) => {
    const err = await convertToWebp(file, { profile: 'cover', backend: fakeBackend(opts).backend }).catch((e) => e)
    expect(err).toBeInstanceOf(ImageError)
    expect(err.code).toBe(code)
    expect(err.messageKey).toBe(`errors.image.${code}`)
  }

  it('no file / an empty file / a huge file', async () => {
    await refuse(null, 'required')
    await refuse(new File([], 'a.png', { type: 'image/png' }), 'empty')
    const huge = png({}, 'huge.png')
    Object.defineProperty(huge, 'size', { value: MAX_SOURCE_BYTES + 1 })
    await refuse(huge, 'size')
  })

  it('not an image: a PDF or plain text, even when named .png', async () => {
    await refuse(toFile(pdfBytes(), 'doc.png', 'image/png'), 'type')
    await refuse(toFile([...new TextEncoder().encode('hello world, not an image')], 'a.jpg', 'image/jpeg'), 'type')
  })

  it('a damaged or truncated file is "corrupt" (the browser may half-decode it, we do not)', async () => {
    await refuse(toFile(pngBytes({ truncated: true }), 'cut.png', 'image/png'), 'corrupt')
    await refuse(toFile(jpegBytes({ truncated: true }), 'cut.jpg', 'image/jpeg'), 'corrupt')
    await refuse(png({}, 'bad.png'), 'corrupt', { decodeError: new Error('The source image could not be decoded') })
  })

  it('HEIC: refused with its own message when the browser cannot decode it', async () => {
    await refuse(toFile(heicBytes(), 'IMG_0001.heic', ''), 'heic', { decodeError: new Error('decode') })
  })

  it('too many pixels', async () => {
    await refuse(toFile(pngBytes({ width: 20000, height: 20000 }), 'huge.png', 'image/png'), 'tooLarge')
  })

  it('a browser that cannot encode WebP (Safari answers PNG): clear error, nothing is uploaded', async () => {
    await refuse(png({}, 'a.png', 1000), 'webpUnsupported', { webp: false })
    const { backend } = fakeBackend()
    backend.encode = vi.fn(async () => null)
    await expect(convertToWebp(png({}, 'a.png', 1000), { profile: 'cover', backend })).rejects.toMatchObject({ code: 'webpUnsupported' })
  })
})

describe('convertToWebp: progress, abort, cache', () => {
  it('reports checking -> decoding -> resizing -> encoding -> thumbnail -> done', async () => {
    const { backend } = fakeBackend({ size: () => 50_000 })
    const stages = []
    await convertToWebp(png({}, 'a.png', 200_000), { profile: 'cover', backend, onProgress: (p) => stages.push(p.stage) })
    expect(stages).toEqual(['checking', 'decoding', 'resizing', 'encoding', 'thumbnail', 'done'])
  })

  it('aborts between steps with ImageError aborted', async () => {
    const controller = new AbortController()
    const { backend } = fakeBackend()
    backend.decode = vi.fn(async () => {
      controller.abort()
      return { width: 100, height: 100, source: {}, dispose: vi.fn() }
    })
    await expect(convertToWebp(png({}, 'a.png', 50_000), { profile: 'cover', backend, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
  })

  it('releases the decoded bitmap and the canvases', async () => {
    const disposed = []
    const backend = {
      supportsWebp: async () => true,
      decode: async () => ({ width: 3000, height: 2000, source: {}, dispose: () => disposed.push('bitmap') }),
      scale: async (_d, width, height) => ({ width, height, source: {}, dispose: () => disposed.push(`canvas ${width}`) }),
      encode: async () => new Blob([new Uint8Array(1000)], { type: 'image/webp' }),
    }
    await convertToWebp(png({}, 'a.png', 90_000), { profile: 'cover', backend })
    expect(disposed).toEqual(expect.arrayContaining(['bitmap', 'canvas 1920', 'canvas 320']))
  })
})

describe('validateImageFile / fitWithin', () => {
  it('first look: image-ish name or type, 25 MB, SVG only where it is kept', () => {
    expect(validateImageFile(null)).toBe('image.required')
    expect(validateImageFile({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toBe('image.type')
    expect(validateImageFile({ name: 'IMG.HEIC', type: '', size: 10 })).toBeNull() // some systems give HEIC no type: the bytes decide later
    expect(validateImageFile({ name: 'a.png', type: 'image/png', size: MAX_SOURCE_BYTES + 1 })).toBe('image.size')
    expect(validateImageFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 }, 'cover')).toBe('image.type')
    expect(validateImageFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 }, 'logo')).toBeNull()
  })
  it('fitWithin never upscales', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 })
    expect(fitWithin(300, 200, 1600)).toEqual({ width: 300, height: 200 })
    expect(PROFILES.avatar.maxPx).toBe(512)
  })
})
