/**
 * ONE id generator for the whole app. Always a valid UUID v4 string (the DB columns are uuid): `crypto.randomUUID()` where it exists, otherwise 16
 * random bytes (`getRandomValues`, else `Math.random`) with the version / variant bits set. Client-generated ids are used for storage file names and
 * for children whose id must be stable before the first save.
 */
export function newId() {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
