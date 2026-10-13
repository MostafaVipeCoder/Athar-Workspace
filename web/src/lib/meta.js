/**
 * Document title + Open Graph / description meta for public pages (design 06 section 9.2). The index.html shell carries
 * no <meta og:*> tags, so they are created on demand and updated in place; a server-side OG renderer (docs/04 A-37) can
 * replace this later without touching the pages. Pure DOM, safe to call in tests (no-op without a document).
 */
const TAGS = [
  ['name', 'description', 'description'],
  ['property', 'og:title', 'title'],
  ['property', 'og:description', 'description'],
  ['property', 'og:image', 'image'],
  ['property', 'og:url', 'url'],
  ['property', 'og:type', 'type'],
  ['name', 'twitter:card', 'card'],
]

export function setPageMeta({ title, description, image, url, type = 'website' } = {}) {
  if (typeof document === 'undefined') return
  const head = document.head
  if (!head) return
  const full = title ? `${title} - Athar` : 'Athar'
  document.title = full
  const values = { title: full, description: description || '', image: image || '', url: url || (typeof window !== 'undefined' ? window.location.href : ''), type, card: image ? 'summary_large_image' : 'summary' }
  for (const [attr, key, field] of TAGS) {
    let el = head.querySelector(`meta[${attr}="${key}"]`)
    const value = values[field]
    if (!value) {
      if (el?.dataset.managed === 'athar') el.remove()
      continue
    }
    if (!el) {
      el = document.createElement('meta')
      el.setAttribute(attr, key)
      el.dataset.managed = 'athar'
      head.appendChild(el)
    }
    el.setAttribute('content', value)
  }
}
