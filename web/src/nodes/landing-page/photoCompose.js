/**
 * Photo personalisation, browser only (design 07 section 6, 01 section 3.9 decision 01-14; landing-page.html lines 1656-1708).
 * The visitor's photo NEVER leaves the browser: it is decoded, cropped to 4:5 with pan + zoom, composited with the PM's transparent
 * PNG frame on a 1080 x 1350 canvas and exported with toBlob('image/png').
 *
 * Maths are the page's own ("cover" base size, then scale, then a pan from the centre) with ONE change: the pan is stored as a FRACTION
 * of the viewport (nx, ny) instead of pixels, so the crop dialog (any size) and the 1080 x 1350 export always agree.
 * Everything here is pure or takes the canvas / decoder as an argument, so it is unit-testable without a browser.
 */
export const OUT_W = 1080
export const OUT_H = 1350
export const ZOOM_MIN = 1
export const ZOOM_MAX = 3.5
export const MAX_PHOTO_SIDE = 4096
export const FRAME_MAX_BYTES = 5 * 1024 * 1024
export const FRAME_ASPECT = 4 / 5

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Size at which the photo covers a (vpW x vpH) viewport at scale 1 (the page's `baseDrawW/H`). */
export function coverBase(imgW, imgH, vpW, vpH) {
  const imgAspect = imgW / imgH
  const vpAspect = vpW / vpH
  return imgAspect > vpAspect ? { w: vpH * imgAspect, h: vpH } : { w: vpW, h: vpW / imgAspect }
}

/** The transform of a fresh photo: centred, scale 1 (fills the frame, nothing outside). */
export const initialTransform = () => ({ scale: 1, nx: 0, ny: 0 })

/**
 * Keep the photo covering the whole viewport: zoom within [ZOOM_MIN, ZOOM_MAX] and a pan that never reveals the empty side.
 * (The page allowed dragging the photo off the frame, leaving the white fill visible.)
 */
export function clampTransform(t, { imgW, imgH, vpW = OUT_W, vpH = OUT_H }) {
  const scale = clamp(Number.isFinite(t.scale) ? t.scale : 1, ZOOM_MIN, ZOOM_MAX)
  const base = coverBase(imgW, imgH, vpW, vpH)
  const maxX = Math.max(0, (base.w * scale - vpW) / 2 / vpW)
  const maxY = Math.max(0, (base.h * scale - vpH) / 2 / vpH)
  return { scale, nx: clamp(Number.isFinite(t.nx) ? t.nx : 0, -maxX, maxX), ny: clamp(Number.isFinite(t.ny) ? t.ny : 0, -maxY, maxY) }
}

/** Where the photo is drawn on an (outW x outH) canvas for a transform (the page's `drawX/drawY/finalDrawW/H`). */
export function drawRect({ imgW, imgH, scale, nx, ny, outW = OUT_W, outH = OUT_H }) {
  const base = coverBase(imgW, imgH, outW, outH)
  const w = base.w * scale
  const h = base.h * scale
  return { x: outW / 2 - w / 2 + nx * outW, y: outH / 2 - h / 2 + ny * outH, w, h }
}

/**
 * Layer order (07 section 6.2): white fill, [frame below], the photo, [frame above] (default above). `canvas` is any object with
 * width/height/getContext('2d'); the same canvas is returned. `frameLayer: 'below'` is for frames that are backgrounds.
 */
export function composeToCanvas(canvas, { photo, photoW, photoH, transform = initialTransform(), frame = null, frameLayer = 'above' }) {
  canvas.width = OUT_W
  canvas.height = OUT_H
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, OUT_W, OUT_H)
  if (frame && frameLayer === 'below') ctx.drawImage(frame, 0, 0, OUT_W, OUT_H)
  if (photo) {
    const t = clampTransform(transform, { imgW: photoW, imgH: photoH })
    const r = drawRect({ imgW: photoW, imgH: photoH, ...t })
    ctx.drawImage(photo, r.x, r.y, r.w, r.h)
  }
  if (frame && frameLayer !== 'below') ctx.drawImage(frame, 0, 0, OUT_W, OUT_H)
  return canvas
}

/** `toBlob` as a promise (not `toDataURL`: large and synchronous). Rejects when the canvas is tainted or encoding fails. */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png encode failed'))), 'image/png')
    } catch (e) {
      reject(e)
    }
  })
}

/** One call: compose + export. `makeCanvas` is injectable (tests). */
export async function renderPersonalised(opts, makeCanvas = () => document.createElement('canvas')) {
  return canvasToPngBlob(composeToCanvas(makeCanvas(), opts))
}

// ------------------------------------------------------------------ frame validation (07 section 6.1)
/**
 * Alpha statistics of RGBA pixels: ratios of transparent (a < 16), visible (a >= 128) pixels and the bounding box of the
 * "window" (a < 32) in the sample's own pixel grid. Pure: takes the ImageData array.
 */
export function analyzeAlpha(data, w, h) {
  let transparent = 0
  let visible = 0
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = data[(y * w + x) * 4 + 3]
      if (a < 16) transparent += 1
      if (a >= 128) visible += 1
      if (a < 32) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  const total = w * h
  return {
    total,
    transparentRatio: total ? transparent / total : 0,
    visibleRatio: total ? visible / total : 0,
    bbox: x1 >= x0 && y1 >= y0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  }
}

/**
 * The problems of a frame candidate, as tokens (`landing.frames.err.<token>`): not a PNG, > 5 MB, not 4:5 (1% tolerance), smaller than
 * 1080 x 1350, no transparent window, no visible artwork. Empty array = accepted.
 */
export function frameProblems({ type, bytes, width, height, alpha }) {
  const problems = []
  if (type !== 'image/png') problems.push('type')
  if (bytes > FRAME_MAX_BYTES) problems.push('size')
  if (width && height) {
    if (Math.abs(width / height - FRAME_ASPECT) > 0.01 * FRAME_ASPECT) problems.push('aspect')
    else if (width < OUT_W || height < OUT_H) problems.push('small')
  } else {
    problems.push('decode')
  }
  if (alpha) {
    if (alpha.transparentRatio < 0.02) problems.push('noWindow')
    if (alpha.visibleRatio < 0.001) problems.push('noArtwork')
  }
  return problems
}

/** The window of a frame in 1080 x 1350 coordinates from the sample grid's bounding box. */
export function windowFromBBox(bbox, sampleW, sampleH) {
  if (!bbox) return null
  const sx = OUT_W / sampleW
  const sy = OUT_H / sampleH
  return { x: Math.round(bbox.x * sx), y: Math.round(bbox.y * sy), w: Math.round(bbox.w * sx), h: Math.round(bbox.h * sy) }
}

// ------------------------------------------------------------------ browser decoders (not unit-tested: they need a real canvas / decoder)
/**
 * Decode a visitor's photo honouring EXIF rotation; photos larger than 4096 px on the long side are decoded downscaled (mobile memory).
 * Returns { bitmap, width, height }. Falls back to an <img> for browsers without createImageBitmap options.
 */
export async function decodePhoto(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      let bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      const long = Math.max(bitmap.width, bitmap.height)
      if (long > MAX_PHOTO_SIDE) {
        const k = MAX_PHOTO_SIDE / long
        const small = await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * k), resizeHeight: Math.round(bitmap.height * k), resizeQuality: 'high' })
        bitmap.close?.()
        bitmap = small
      }
      return { bitmap, width: bitmap.width, height: bitmap.height }
    } catch {
      /* fall through to the <img> decoder */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image decode failed'))
      el.src = url
    })
    return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Load a frame from its public URL without tainting the canvas: fetch (CORS) -> bitmap, else <img crossOrigin="anonymous">. */
export async function loadFrameImage(url) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(`frame ${res.status}`)
    const blob = await res.blob()
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob)
    return await loadImgElement(URL.createObjectURL(blob), true)
  } catch {
    return loadImgElement(url, false)
  }
}
function loadImgElement(src, revoke) {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => {
      if (revoke) URL.revokeObjectURL(src)
      resolve(el)
    }
    el.onerror = () => {
      if (revoke) URL.revokeObjectURL(src)
      reject(new Error('frame load failed'))
    }
    el.src = src
  })
}

/**
 * Inspect a frame file chosen by a PM: decode, check dimensions and alpha, find the window. Returns
 * { problems: string[], width, height, window: {x,y,w,h}|null }. The alpha is sampled on a downscaled copy (<= 540 x 675) for speed.
 */
export async function inspectFrameFile(file, makeCanvas = () => document.createElement('canvas')) {
  let bitmap = null
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { problems: frameProblems({ type: file.type, bytes: file.size, width: 0, height: 0 }), width: 0, height: 0, window: null }
  }
  try {
    const { width, height } = bitmap
    const k = Math.min(1, 540 / width, 675 / height)
    const sw = Math.max(1, Math.round(width * k))
    const sh = Math.max(1, Math.round(height * k))
    const canvas = makeCanvas()
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0, sw, sh)
    const alpha = analyzeAlpha(ctx.getImageData(0, 0, sw, sh).data, sw, sh)
    return { problems: frameProblems({ type: file.type, bytes: file.size, width, height, alpha }), width, height, window: windowFromBBox(alpha.bbox, sw, sh) }
  } finally {
    bitmap.close?.()
  }
}
