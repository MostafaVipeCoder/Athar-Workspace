/**
 * Public URL builders and ref helpers (design 06 sections 6.3 `links.js` and 9). Replaces the 4+ event link builders,
 * the three invitation link builders, `getAppBaseUrl`, `getShareUrl` and the hard-coded share host (P26).
 * Pure: the base URL is passed in (callers use `appBaseUrl()` which reads env + window once).
 */
import { env } from './env.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Slugs are generated short ids (04 OD-8: 10 random chars) with optional vanity: letters, digits, dash, underscore. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/i

/** Kinds of public links and their URL prefix (06 section 2.4). */
export const PUBLIC_KINDS = {
  agenda: '/agenda',
  form: '/forms',
  landing: '/join',
  booking: '/book',
  view: '/view',
  verify: '/verify',
}

export const isUuid = (v) => UUID_RE.test(String(v ?? ''))
export const isSlug = (v) => SLUG_RE.test(String(v ?? ''))

/** Classify a `:ref` route param: { kind: 'uuid'|'slug'|'invalid', value }. */
export function parseRef(ref) {
  const value = String(ref ?? '').trim()
  if (isUuid(value)) return { kind: 'uuid', value: value.toLowerCase() }
  if (isSlug(value)) return { kind: 'slug', value }
  return { kind: 'invalid', value }
}

/** Preferred canonical ref: the slug when known, otherwise the id (06 section 9.1 canonicalisation). */
export function canonicalRef({ slug, id }) {
  return slug && isSlug(slug) ? slug : id
}

function trimSlashes(s) {
  return String(s ?? '').replace(/\/+$/, '')
}

/**
 * Origin + base path of the running app (no trailing slash). Order: VITE_APP_PUBLIC_URL -> window.location.origin + base.
 * Pass `origin` explicitly in tests / server code.
 */
export function appBaseUrl({ publicUrl = env.publicUrl, basePath = env.basePath, origin } = {}) {
  if (publicUrl) return trimSlashes(publicUrl)
  const o = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  const base = trimSlashes(basePath === '/' ? '' : basePath)
  return `${trimSlashes(o)}${base ? (base.startsWith('/') ? base : `/${base}`) : ''}`
}

function query(params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Path only (router-relative) for a public item: publicPath('agenda', slug, { tab: 'experts', lang: 'ar' }). */
export function publicPath(kind, ref, { tab, lang, host, viewKey, ...rest } = {}) {
  const prefix = PUBLIC_KINDS[kind]
  if (!prefix) throw new Error(`unknown public link kind: ${kind}`)
  const r = encodeURIComponent(String(ref ?? '').trim())
  let path = `${prefix}/${r}`
  if (kind === 'agenda' && tab) path += `/${encodeURIComponent(tab)}`
  if (kind === 'booking' && host) path += `/${encodeURIComponent(host)}`
  if (kind === 'view' && viewKey) path += `/${encodeURIComponent(viewKey)}`
  return `${path}${query({ lang, ...rest })}`
}

/** Absolute public URL (share links). */
export function buildPublicUrl(kind, ref, opts = {}) {
  const { base, ...rest } = opts
  return `${base ?? appBaseUrl()}${publicPath(kind, ref, rest)}`
}

/** Founder invitation link (03 section 4.4). */
export function buildInviteUrl(token, { base } = {}) {
  return `${base ?? appBaseUrl()}/invite/${encodeURIComponent(token)}`
}

/** Staff invitation link (08 section 14). */
export function buildStaffInviteUrl(token, { base } = {}) {
  return `${base ?? appBaseUrl()}/invite/staff/${encodeURIComponent(token)}`
}

/** Share text + link per platform (06 section 9.3). Returns { href, copyOnly }. */
export function buildShareUrl(platform, link, text = '') {
  const u = encodeURIComponent(link)
  const t = encodeURIComponent(text ? `${text} ${link}` : link)
  switch (platform) {
    case 'whatsapp': return { href: `https://wa.me/?text=${t}`, copyOnly: false }
    case 'telegram': return { href: `https://t.me/share/url?url=${u}&text=${encodeURIComponent(text)}`, copyOnly: false }
    case 'x': return { href: `https://twitter.com/intent/tweet?text=${t}`, copyOnly: false }
    case 'email': return { href: `mailto:?body=${t}`, copyOnly: false }
    // 07-13: Facebook/LinkedIn ignore prefilled text -> "copy text, then paste"
    case 'facebook': return { href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, copyOnly: true }
    case 'linkedin': return { href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, copyOnly: true }
    default: return { href: link, copyOnly: true }
  }
}

/** Project/node deep links used across the staff app (one place, so a route change is one edit). */
export const staffPath = {
  programs: () => '/programs',
  program: (id) => `/programs/${id}`,
  programSettings: (id) => `/programs/${id}/settings`,
  project: (id) => `/projects/${id}`,
  projectDetails: (id) => `/projects/${id}/details`,
  projectParticipants: (id) => `/projects/${id}/participants`,
  projectOutbox: (id) => `/projects/${id}/outbox`,
  emailHealth: () => '/admin/email',
  company: (id) => `/network/companies/${id}`,
  node: (projectId, nodeId, mode) => `/projects/${projectId}/nodes/${nodeId}${mode && mode !== 'view' ? `/${mode}` : ''}`,
  staff: () => '/admin/staff',
  profile: () => '/profile',
}
