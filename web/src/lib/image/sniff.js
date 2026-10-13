/**
 * Byte-level inspection of an image file (pure, no DOM): the REAL format from the magic bytes (a file's `type` and name can lie or be
 * empty), its pixel size when the header says it, and whether it is animated. Used before decoding: to refuse what we cannot or must not
 * decode (HEIC on browsers without a decoder, an SVG where only rasters belong, 100 MP images), to detect an animated GIF, and to keep
 * an already-optimised WebP as it is.
 *
 * Returns { type, width, height, animated, frames, truncated } where `type` is one of
 * 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'avif' | 'heic' | 'bmp' | 'tiff' | 'pdf' | 'unknown'; width/height are 0 when not found.
 */
export const SNIFF_BYTES = 256 * 1024

const u16be = (b, i) => (b[i] << 8) | b[i + 1]
const u16le = (b, i) => b[i] | (b[i + 1] << 8)
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n))
const starts = (b, sig) => sig.every((v, i) => b[i] === v)

function pngInfo(b) {
  const width = b.length >= 24 ? u32be(b, 16) : 0
  const height = b.length >= 24 ? u32be(b, 20) : 0
  // APNG: an `acTL` chunk before the first IDAT
  let animated = false
  let pos = 8
  while (pos + 8 <= b.length) {
    const len = u32be(b, pos)
    const name = ascii(b, pos + 4, 4)
    if (name === 'acTL') {
      animated = true
      break
    }
    if (name === 'IDAT' || name === 'IEND') break
    pos += 12 + len
  }
  return { type: 'png', width, height, animated, frames: animated ? 2 : 1 }
}

function jpegInfo(b) {
  let pos = 2
  let width = 0
  let height = 0
  while (pos + 9 < b.length) {
    if (b[pos] !== 0xff) {
      pos += 1
      continue
    }
    const marker = b[pos + 1]
    if (marker === 0xff) {
      pos += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2
      continue
    }
    const segLen = u16be(b, pos + 2)
    // SOFn (not DHT 0xC4, JPG 0xC8, DAC 0xCC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = u16be(b, pos + 5)
      width = u16be(b, pos + 7)
      break
    }
    pos += 2 + segLen
  }
  return { type: 'jpeg', width, height, animated: false, frames: 1 }
}

/** Counts the image frames of a GIF (stops at 2: all we need to know is "animated or not"). `truncated` = ran out of bytes first. */
export function gifFrames(b) {
  const flags = b[10]
  let pos = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0)
  let frames = 0
  const skipBlocks = () => {
    while (pos < b.length && b[pos] !== 0) pos += b[pos] + 1
    pos += 1
  }
  while (pos < b.length) {
    const t = b[pos++]
    if (t === 0x3b) return { frames, truncated: false }
    if (t === 0x21) {
      pos += 1
      skipBlocks()
    } else if (t === 0x2c) {
      frames += 1
      if (frames > 1) return { frames, truncated: false }
      pos += 8
      const f = b[pos++]
      if (f & 0x80) pos += 3 * (1 << ((f & 7) + 1))
      pos += 1
      skipBlocks()
    } else {
      return { frames, truncated: false }
    }
  }
  return { frames, truncated: true }
}

function gifInfo(b) {
  const { frames, truncated } = gifFrames(b)
  return { type: 'gif', width: u16le(b, 6), height: u16le(b, 8), animated: frames > 1 || truncated, frames: truncated ? 2 : Math.max(1, frames), truncated }
}

function webpInfo(b) {
  const chunk = ascii(b, 12, 4)
  let width = 0
  let height = 0
  let animated = false
  if (chunk === 'VP8X' && b.length >= 30) {
    animated = Boolean(b[20] & 0x02)
    width = 1 + u24le(b, 24)
    height = 1 + u24le(b, 27)
  } else if (chunk === 'VP8L' && b.length >= 25) {
    width = 1 + (b[21] | ((b[22] & 0x3f) << 8))
    height = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10))
  } else if (chunk === 'VP8 ' && b.length >= 30) {
    width = u16le(b, 26) & 0x3fff
    height = u16le(b, 28) & 0x3fff
  }
  return { type: 'webp', width, height, animated, frames: animated ? 2 : 1 }
}

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']

/** Text that looks like an SVG document (BOM / XML prolog / comments / doctype before the root are skipped). */
export function looksLikeSvg(text) {
  const head = String(text ?? '').slice(0, 2048)
  const body = head.charCodeAt(0) === 0xfeff ? head.slice(1) : head
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s/>]/i.test(body)
}

export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])
  const none = { type: 'unknown', width: 0, height: 0, animated: false, frames: 1 }
  if (b.length < 4) return none
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return pngInfo(b)
  if (b[0] === 0xff && b[1] === 0xd8) return jpegInfo(b)
  if (ascii(b, 0, 3) === 'GIF') return gifInfo(b)
  if (b.length >= 20 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webpInfo(b)
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4)
    if (brand === 'avif' || brand === 'avis') return { ...none, type: 'avif' }
    if (HEIC_BRANDS.includes(brand)) return { ...none, type: 'heic' }
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return { ...none, type: 'bmp' }
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return { ...none, type: 'tiff' }
  if (ascii(b, 0, 4) === '%PDF') return { ...none, type: 'pdf' }
  let head = ''
  try {
    head = new TextDecoder('utf-8').decode(b.subarray(0, 2048))
  } catch {
    head = ''
  }
  if (looksLikeSvg(head)) return { ...none, type: 'svg' }
  return none
}

/** The bytes of a Blob/File (`arrayBuffer()` where the engine has it, FileReader otherwise: old Safari, jsdom). */
export function bytesOf(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((b) => new Uint8Array(b))
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

/** Reads the leading bytes of a File/Blob (all of a GIF, whose frame count needs a walk through the file). */
export async function readHead(file, limit = SNIFF_BYTES) {
  const bytes = await bytesOf(file.slice(0, limit))
  if (bytes.length >= 6 && ascii(bytes, 0, 3) === 'GIF' && file.size > bytes.length && file.size <= 25 * 1024 * 1024) return bytesOf(file)
  return bytes
}
