import { describe, expect, it, vi } from 'vitest'
import { OUT_H, OUT_W, ZOOM_MAX, analyzeAlpha, canvasToPngBlob, clampTransform, composeToCanvas, coverBase, drawRect, frameProblems, initialTransform, renderPersonalised, windowFromBBox } from './photoCompose.js'

function fakeCanvas() {
  const calls = []
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    fillStyle: '',
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    drawImage: (img, ...a) => calls.push(['drawImage', img.name ?? 'img', ...a]),
  }
  return { width: 0, height: 0, calls, ctx, getContext: () => ctx, toBlob: (cb, type) => cb(new Blob(['x'], { type })) }
}

describe('cover + pan/zoom maths (the page own maths, pan as a fraction)', () => {
  it('a landscape photo is as tall as the viewport, a portrait one as wide', () => {
    expect(coverBase(2000, 1000, 400, 500)).toEqual({ w: 1000, h: 500 })
    expect(coverBase(1000, 2000, 400, 500)).toEqual({ w: 400, h: 800 })
    expect(coverBase(800, 1000, 400, 500)).toEqual({ w: 400, h: 500 })
  })
  it('draws a centred photo at the canvas centre and scales about it', () => {
    expect(drawRect({ imgW: 1080, imgH: 1350, scale: 1, nx: 0, ny: 0 })).toEqual({ x: 0, y: 0, w: 1080, h: 1350 })
    expect(drawRect({ imgW: 1080, imgH: 1350, scale: 2, nx: 0, ny: 0 })).toEqual({ x: -540, y: -675, w: 2160, h: 2700 })
    const p = drawRect({ imgW: 1080, imgH: 1350, scale: 2, nx: 0.25, ny: -0.1 })
    expect(p.x).toBe(-540 + 270)
    expect(p.y).toBe(-675 - 135)
  })
  it('clamps the zoom to 1..3.5 and the pan so the photo always covers the frame', () => {
    const geo = { imgW: 1080, imgH: 1350 }
    expect(clampTransform({ scale: 9, nx: 0, ny: 0 }, geo).scale).toBe(ZOOM_MAX)
    expect(clampTransform({ scale: 0.2, nx: 5, ny: 5 }, geo)).toEqual({ scale: 1, nx: 0, ny: 0 }) // nothing to pan at scale 1 (same aspect)
    const z2 = clampTransform({ scale: 2, nx: 5, ny: -5 }, geo)
    expect(z2.nx).toBeCloseTo(0.5) // (2160 - 1080) / 2 / 1080
    expect(z2.ny).toBeCloseTo(-0.5)
    // a wide photo can be panned sideways at scale 1
    expect(clampTransform({ scale: 1, nx: 1, ny: 1 }, { imgW: 3000, imgH: 1350 }).nx).toBeGreaterThan(0.5)
    expect(clampTransform({ scale: NaN, nx: NaN, ny: NaN }, geo)).toEqual({ scale: 1, nx: 0, ny: 0 })
  })
})

describe('composition (1080 x 1350 PNG, frame on top)', () => {
  it('sets the output size and draws white, photo, then frame in that order', () => {
    const canvas = fakeCanvas()
    const photo = { name: 'photo' }
    const frame = { name: 'frame' }
    composeToCanvas(canvas, { photo, photoW: 2000, photoH: 1000, transform: { scale: 1, nx: 0, ny: 0 }, frame })
    expect([canvas.width, canvas.height]).toEqual([OUT_W, OUT_H])
    expect([OUT_W, OUT_H]).toEqual([1080, 1350])
    expect(canvas.ctx.imageSmoothingQuality).toBe('high')
    const order = canvas.calls.map((c) => c[0] + (c[1] ? `:${c[1]}` : ''))
    expect(order).toEqual(['fillRect', 'drawImage:photo', 'drawImage:frame'])
    expect(canvas.calls[0]).toEqual(['fillRect', 0, 0, 1080, 1350])
    expect(canvas.calls[1].slice(2)).toEqual([-(1350 * 2 - 1080) / 2, 0, 2700, 1350]) // cover of a 2:1 photo
    expect(canvas.calls[2]).toEqual(['drawImage', 'frame', 0, 0, 1080, 1350])
  })
  it('a "below" frame is drawn before the photo; no frame / no photo are fine', () => {
    const below = fakeCanvas()
    composeToCanvas(below, { photo: { name: 'photo' }, photoW: 800, photoH: 1000, frame: { name: 'frame' }, frameLayer: 'below' })
    expect(below.calls.map((c) => c[1])).toEqual([0, 'frame', 'photo'])
    const bare = fakeCanvas()
    composeToCanvas(bare, { photo: { name: 'p' }, photoW: 800, photoH: 1000 })
    expect(bare.calls.map((c) => c[0])).toEqual(['fillRect', 'drawImage'])
    const empty = fakeCanvas()
    composeToCanvas(empty, { frame: { name: 'f' } })
    expect(empty.calls.map((c) => c[0])).toEqual(['fillRect', 'drawImage'])
  })
  it('an out-of-range transform is clamped before drawing (no white edge)', () => {
    const c = fakeCanvas()
    composeToCanvas(c, { photo: { name: 'p' }, photoW: 1080, photoH: 1350, transform: { scale: 1, nx: 3, ny: 3 } })
    expect(c.calls[1].slice(2)).toEqual([0, 0, 1080, 1350])
  })
  it('exports with toBlob as image/png', async () => {
    const c = fakeCanvas()
    const spy = vi.spyOn(c, 'toBlob')
    const blob = await renderPersonalised({ photo: { name: 'p' }, photoW: 800, photoH: 1000, transform: initialTransform() }, () => c)
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    expect(blob.type).toBe('image/png')
    await expect(canvasToPngBlob({ toBlob: (cb) => cb(null) })).rejects.toThrow('png encode failed')
    await expect(canvasToPngBlob({ toBlob: () => { throw new Error('tainted') } })).rejects.toThrow('tainted')
  })
})

describe('frame validation (07 section 6.1)', () => {
  const rgba = (w, h, fn) => {
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) d[(y * w + x) * 4 + 3] = fn(x, y)
    return d
  }
  it('finds the transparent window and the artwork', () => {
    // 20 x 25 sample: opaque border of 3px, transparent middle
    const data = rgba(20, 25, (x, y) => (x < 3 || x >= 17 || y < 3 || y >= 22 ? 255 : 0))
    const a = analyzeAlpha(data, 20, 25)
    expect(a.bbox).toEqual({ x: 3, y: 3, w: 14, h: 19 })
    expect(a.transparentRatio).toBeCloseTo((14 * 19) / 500)
    expect(a.visibleRatio).toBeCloseTo(1 - (14 * 19) / 500)
    expect(windowFromBBox(a.bbox, 20, 25)).toEqual({ x: 162, y: 162, w: 756, h: 1026 })
    expect(windowFromBBox(null, 20, 25)).toBeNull()
  })
  it('accepts a good frame and rejects each defect with its token', () => {
    const good = { type: 'image/png', bytes: 100000, width: 1080, height: 1350, alpha: { transparentRatio: 0.4, visibleRatio: 0.5 } }
    expect(frameProblems(good)).toEqual([])
    expect(frameProblems({ ...good, width: 2160, height: 2700 })).toEqual([]) // any 4:5 size >= 1080 x 1350
    expect(frameProblems({ ...good, type: 'image/jpeg' })).toEqual(['type'])
    expect(frameProblems({ ...good, bytes: 6 * 1024 * 1024 })).toEqual(['size'])
    expect(frameProblems({ ...good, width: 1080, height: 1080 })).toEqual(['aspect'])
    expect(frameProblems({ ...good, width: 540, height: 675 })).toEqual(['small'])
    expect(frameProblems({ ...good, alpha: { transparentRatio: 0, visibleRatio: 1 } })).toEqual(['noWindow'])
    expect(frameProblems({ ...good, alpha: { transparentRatio: 1, visibleRatio: 0 } })).toEqual(['noArtwork'])
    expect(frameProblems({ ...good, width: 0, height: 0, alpha: null })).toEqual(['decode'])
  })
})
