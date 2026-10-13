/**
 * THE image pipeline (owner decision 08 section 17.3): turn any picked raster into WebP in the browser, with a thumbnail, before
 * anything is uploaded. One function, `convertToWebp(file, { profile })`; `data/storage.js` is the only caller that stores the result.
 *
 * Rules (each one is unit-tested):
 *  - the format comes from the BYTES (`sniff.js`), never from `file.type` / the name; HEIC, PDF, text, a damaged or truncated file are
 *    refused with a specific, translated message and NEVER uploaded as they are;
 *  - EXIF orientation is applied (`createImageBitmap(..., { imageOrientation: 'from-image' })`), transparency is kept (WebP has alpha);
 *  - the longest side is capped by the profile (never upscaled), big reductions go through halving steps;
 *  - quality ladder + size guard: the first quality whose result fits `min(profile.targetBytes, source size)` wins; if none does, the
 *    SMALLEST WebP is kept (a WebP bigger than the original is still the stored format: the server refuses PNG/JPEG);
 *  - an already-WebP source that fits the profile is kept as is (no generational loss, animation intact) unless a re-encode is smaller;
 *  - SVG (vector) is stored untouched for profiles that allow it (logos) after a safety check, refused everywhere else;
 *  - an animated GIF / APNG keeps its FIRST FRAME and the result says so (`report.notices`): WebP from a canvas is a still image, and
 *    an animation is not what covers, photos and logos are for (decision recorded in web/README.md);
 *  - a 320 px thumbnail (`thumb`) is made when the profile asks for one;
 *  - memory: nothing is drawn on a DOM canvas when OffscreenCanvas exists, the decoded bitmap is released before the encode loop.
 */
import { ImageError } from './errors.js'
import { MAX_SOURCE_BYTES, MAX_SOURCE_PIXELS, SVG_MIME, WEBP_MIME, qualityLadder, resolveProfile } from './profiles.js'
import { bytesOf, readHead, sniffImage } from './sniff.js'
import { browserBackend } from './canvas.js'

/** Fit (w,h) inside maxPx keeping the ratio; never upscales. */
export function fitWithin(width, height, maxPx) {
  const scale = Math.min(1, maxPx / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const DECODABLE = ['png', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic']
const EXT_OK = /\.(png|jpe?g|jfif|webp|gif|avif|bmp|heic|heif|svg)$/i

/**
 * Synchronous first look at a picked file (no bytes read): null = fine, else the legacy key `image.required | image.type | image.size`.
 * `convertToWebp` does the real check on the bytes.
 */
export function validateImageFile(file, profile = 'content') {
  if (!file) return 'image.required'
  const p = resolveProfile(profile)
  const mime = String(file.type ?? '').toLowerCase()
  const looksImage = mime.startsWith('image/') || EXT_OK.test(String(file.name ?? ''))
  if (!looksImage) return 'image.type'
  if ((mime === SVG_MIME || /\.svg$/i.test(String(file.name ?? ''))) && !p.vector) return 'image.type'
  if (file.size > MAX_SOURCE_BYTES) return 'image.size'
  return null
}

/** SVG safety (defence in depth: the bucket is staff-write only and `<img>` never runs scripts): refuse anything active or external. */
export function svgProblem(text) {
  const s = String(text ?? '')
  if (s.length > 1024 * 1024) return 'size'
  if (/<script[\s>]/i.test(s) || /\son[a-z]+\s*=/i.test(s) || /javascript:/i.test(s) || /<foreignObject[\s>]/i.test(s) || /<(iframe|embed|object)[\s>]/i.test(s) || /<!ENTITY/i.test(s)) return 'unsafe'
  if (/(?:xlink:)?href\s*=\s*["'](?!#|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(s)) return 'unsafe'
  return null
}

const progressOf = { checking: 5, decoding: 20, resizing: 35, encoding: 40, thumbnail: 90, done: 100 }

function checkAborted(signal) {
  if (signal?.aborted) throw new ImageError('aborted')
}

/** Truncated / damaged files that some decoders still "half" decode: look at the end of the file for the format's terminator. */
async function integrityProblem(file, info) {
  const tail = await bytesOf(file.slice(Math.max(0, file.size - 4096)))
  if (info.type === 'jpeg') {
    for (let i = tail.length - 2; i >= 0; i -= 1) if (tail[i] === 0xff && tail[i + 1] === 0xd9) return false
    return true
  }
  if (info.type === 'png') {
    const s = String.fromCharCode(...tail.subarray(Math.max(0, tail.length - 8), Math.max(0, tail.length - 4)))
    return s !== 'IEND'
  }
  if (info.type === 'webp') {
    const head = await bytesOf(file.slice(0, 12))
    const riffSize = (head[4] | (head[5] << 8) | (head[6] << 16) | (head[7] << 24)) >>> 0
    return riffSize + 8 > file.size
  }
  return false
}

async function convertVector(file, p, emit) {
  emit('checking')
  const text = new TextDecoder('utf-8').decode(await bytesOf(file))
  const problem = svgProblem(text)
  if (problem) throw new ImageError(problem === 'size' ? 'size' : 'svgUnsafe')
  const blob = file.slice(0, file.size, SVG_MIME)
  emit('done')
  return {
    profile: p.name,
    full: { blob, width: 0, height: 0, bytes: file.size, mime: SVG_MIME, ext: 'svg' },
    thumb: null,
    source: { name: file.name ?? '', type: 'svg', mime: file.type ?? '', bytes: file.size, width: 0, height: 0 },
    report: { kind: 'vector', sourceBytes: file.size, bytes: file.size, savedBytes: 0, quality: null, lossless: false, attempts: 0, width: 0, height: 0, sourceWidth: 0, sourceHeight: 0, notices: [] },
  }
}

async function run(file, p, { onProgress, signal, backend }) {
  const emit = (stage, extra = {}) => onProgress?.({ stage, percent: progressOf[stage] ?? 0, ...extra })
  if (!file) throw new ImageError('required')
  if (!file.size) throw new ImageError('empty')
  if (file.size > MAX_SOURCE_BYTES) throw new ImageError('size')

  emit('checking')
  const info = sniffImage(await readHead(file))
  checkAborted(signal)
  if (info.type === 'svg') {
    if (!p.vector) throw new ImageError('svg')
    return convertVector(file, p, emit)
  }
  if (!DECODABLE.includes(info.type)) throw new ImageError('type')
  if (info.width * info.height > MAX_SOURCE_PIXELS) throw new ImageError('tooLarge')
  if (await integrityProblem(file, info)) throw new ImageError('corrupt')

  const notices = []
  const fitsAsIs = info.type === 'webp' && info.width > 0 && Math.max(info.width, info.height) <= p.maxPx
  const keepAsIs = fitsAsIs && (info.animated || file.size <= p.targetBytes)

  // ---- decode (needed to re-encode and/or to make the thumbnail)
  emit('decoding')
  let decoded
  try {
    decoded = await backend.decode(file)
  } catch (cause) {
    throw new ImageError(info.type === 'heic' ? 'heic' : 'corrupt', { cause })
  }
  if (!decoded || !(decoded.width > 0) || !(decoded.height > 0)) {
    decoded?.dispose?.()
    throw new ImageError(info.type === 'heic' ? 'heic' : 'corrupt')
  }
  checkAborted(signal)
  const sourceWidth = decoded.width
  const sourceHeight = decoded.height
  if (info.animated && !keepAsIs) notices.push('animatedFirstFrame')

  let surface = null
  let thumbSurface = null
  try {
    if ((!keepAsIs || p.thumbPx > 0) && !(await backend.supportsWebp())) throw new ImageError('webpUnsupported')
    const target = fitWithin(sourceWidth, sourceHeight, p.maxPx)
    const resized = target.width !== sourceWidth || target.height !== sourceHeight

    let full
    let quality = null
    let attempts = 0
    if (keepAsIs) {
      full = { blob: file.slice(0, file.size, WEBP_MIME), width: sourceWidth, height: sourceHeight }
    } else {
      emit('resizing')
      surface = await backend.scale(decoded, target.width, target.height)
      if (resized) notices.push('resized')
      // the big bitmap is not needed any more unless a thumbnail of an unchanged-size WebP is still to be made
      const ladder = qualityLadder(p)
      const stopAt = p.lossless ? p.targetBytes : Math.min(p.targetBytes, file.size)
      let best = null
      for (let i = 0; i < ladder.length; i += 1) {
        checkAborted(signal)
        emit('encoding', { attempt: i + 1, attempts: ladder.length, quality: ladder[i], percent: 40 + Math.round(((i + 1) / ladder.length) * 45) })
        const blob = await backend.encode(surface, { quality: ladder[i] })
        if (!blob) throw new ImageError('webpUnsupported')
        attempts += 1
        if (!best || blob.size < best.blob.size) best = { blob, quality: ladder[i] }
        if (blob.size <= stopAt) break
      }
      quality = best.quality
      full = { blob: best.blob, width: target.width, height: target.height }
      // an already-WebP source that no re-encode beats stays as it is
      if (info.type === 'webp' && fitsAsIs && !info.animated && best.blob.size >= file.size) {
        full = { blob: file.slice(0, file.size, WEBP_MIME), width: sourceWidth, height: sourceHeight }
        quality = null
      }
    }

    // ---- thumbnail
    let thumb = null
    if (p.thumbPx > 0) {
      emit('thumbnail')
      const t = fitWithin(full.width, full.height, p.thumbPx)
      if (t.width === full.width && t.height === full.height) {
        thumb = { blob: full.blob, width: t.width, height: t.height }
      } else {
        thumbSurface = await backend.scale(surface ?? decoded, t.width, t.height)
        const blob = await backend.encode(thumbSurface, { quality: 0.75 })
        if (!blob) throw new ImageError('webpUnsupported')
        thumb = { blob, width: t.width, height: t.height }
      }
    }

    const kept = full.blob.size === file.size && info.type === 'webp' && (keepAsIs || quality === null)
    emit('done')
    const wrap = (x) => (x ? { blob: x.blob, width: x.width, height: x.height, bytes: x.blob.size, mime: WEBP_MIME, ext: 'webp' } : null)
    const fullOut = wrap(full)
    return {
      profile: p.name,
      full: fullOut,
      thumb: wrap(thumb),
      source: { name: file.name ?? '', type: info.type, mime: file.type ?? '', bytes: file.size, width: sourceWidth, height: sourceHeight },
      report: {
        kind: kept ? 'kept' : 'converted',
        sourceBytes: file.size,
        bytes: fullOut.bytes,
        savedBytes: file.size - fullOut.bytes,
        quality,
        lossless: quality === 1,
        attempts,
        width: fullOut.width,
        height: fullOut.height,
        sourceWidth,
        sourceHeight,
        notices,
      },
    }
  } finally {
    decoded.dispose?.()
    surface?.dispose?.()
    thumbSurface?.dispose?.()
  }
}

// One conversion per (file, profile): an ImageField converts the moment a file is picked (for the preview and the feedback), and the
// data layer asks for the same result again when the page uploads that same File. Rejections are never cached.
const cache = new WeakMap()

/**
 * Convert a picked image to WebP. Returns { profile, full, thumb, source, report } (see `run`). Throws ImageError.
 * options: { profile = 'content', onProgress({ stage, percent, attempt, attempts, quality }), signal, backend }.
 */
export function convertToWebp(file, options = {}) {
  const p = resolveProfile(options.profile ?? 'content')
  const backend = options.backend ?? browserBackend
  const cacheable = options.backend === undefined && typeof options.profile !== 'object' && file && typeof file === 'object'
  if (cacheable) {
    const hit = cache.get(file)?.get(p.name)
    if (hit) {
      options.onProgress?.({ stage: 'done', percent: 100 })
      return hit
    }
  }
  const promise = run(file, p, { onProgress: options.onProgress, signal: options.signal, backend })
  if (cacheable) {
    const perFile = cache.get(file) ?? new Map()
    perFile.set(p.name, promise)
    cache.set(file, perFile)
    promise.catch(() => perFile.delete(p.name))
  }
  return promise
}
