/**
 * Byte-exact miniature image files for the unit tests (headers only, no pixels): enough for the sniffer and the integrity checks, and the
 * tests decode through a FAKE backend. Not imported by app code.
 */
const ascii = (s) => [...s].map((c) => c.charCodeAt(0))
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const be16 = (n) => [(n >> 8) & 255, n & 255]
const le16 = (n) => [n & 255, (n >> 8) & 255]
const le24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255]
const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]

export const toFile = (bytes, name, type) => new File([Array.isArray(bytes) ? Uint8Array.from(bytes) : bytes], name, { type })

/** A PNG: signature + IHDR (+ acTL for APNG) + one tiny IDAT + IEND. `truncated` drops the IEND chunk. */
export function pngBytes({ width = 8, height = 6, animated = false, truncated = false, pad = 0 } = {}) {
  const chunk = (type, data) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0]
  return [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    ...(animated ? chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]) : []),
    ...chunk('IDAT', [1, 2, 3, 4, ...new Array(pad).fill(0)]),
    ...(truncated ? [] : chunk('IEND', [])),
  ]
}

/** A JPEG: SOI + APP0 + SOF0 (the size) + EOI. `truncated` drops the EOI. */
export function jpegBytes({ width = 8, height = 6, truncated = false, pad = 0 } = {}) {
  return [
    0xff, 0xd8,
    0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xda, ...be16(8), 1, 1, 0, 0, 63, 0, 0x11, 0x22, ...new Array(pad).fill(0x55),
    ...(truncated ? [] : [0xff, 0xd9]),
  ]
}

/** A GIF with `frames` image descriptors (2+ = animated). */
export function gifBytes({ width = 8, height = 6, frames = 1 } = {}) {
  const frame = [0x2c, 0, 0, 0, 0, ...le16(width), ...le16(height), 0, 2, 1, 0x44, 0]
  const gce = [0x21, 0xf9, 4, 0, 10, 0, 0, 0]
  const body = []
  for (let i = 0; i < frames; i += 1) body.push(...gce, ...frame)
  return [...ascii('GIF89a'), ...le16(width), ...le16(height), 0, 0, 0, ...body, 0x3b]
}

/** A lossy/lossless/extended WebP header (RIFF size correct so the integrity check passes). */
export function webpBytes({ width = 8, height = 6, kind = 'VP8X', animated = false, pad = 0 } = {}) {
  let payload
  if (kind === 'VP8X') payload = [...ascii('VP8X'), ...le32(10), animated ? 0x02 : 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]
  else if (kind === 'VP8L') {
    const bits = (width - 1) | ((height - 1) << 14)
    payload = [...ascii('VP8L'), ...le32(5), 0x2f, ...le32(bits)]
  } else payload = [...ascii('VP8 '), ...le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height)]
  const body = [...payload, ...new Array(pad).fill(0)]
  return [...ascii('RIFF'), ...le32(body.length + 4), ...ascii('WEBP'), ...body]
}

export const heicBytes = () => [0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')]
export const avifBytes = () => [0, 0, 0, 24, ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('mif1avif')]
export const pdfBytes = () => ascii('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')
export const svgText = (inner = '<rect width="10" height="10" fill="#1a27c9"/>') => `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`
