/** Initials + colour for the Avatar (04 section 3.1: colour chosen by the user; fallback derived from the id). */
export function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase()
}

const FALLBACK = ['#1a27c9', '#0f766e', '#b45309', '#be123c', '#6d28d9', '#0369a1']
export function colorFor(id = '', explicit) {
  if (explicit) return explicit
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}

/** True for light fills (e.g. the brand yellow) where text/icons on top must be black, not white. */
export function isLightColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5
}
