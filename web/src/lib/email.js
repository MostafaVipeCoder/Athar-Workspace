/**
 * E-mail template helpers shared by every node that owns templates (Selection, Booking; design 07 section 1.5).
 * Pure: the renderer mirrors the DB renderer `app_private.render_email_template` (m33 + m34) so the preview shows
 * exactly what gets queued. Keep the two in sync.
 */

export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Placeholder keys whose value becomes a clickable anchor in HTML mode when it holds a URL (same list as the DB). */
export const LINK_KEYS = ['booking_link', 'cancel_link', 'meet_link']

/**
 * {{key}} and {key} tokens; values escaped in HTML mode; a plain-text body (no tag) gets <br> line breaks; unknown
 * {{tokens}} are removed; link keys become anchors when they are http(s) URLs.
 */
export function renderTemplate(template, vars = {}, { html = false } = {}) {
  let out = String(template ?? '')
  const isHtml = html && /<[a-zA-Z][^>]*>/.test(out)
  if (html && !isHtml) out = out.replace(/\r\n/g, '\n').replace(/\n/g, '<br>')
  for (const [k, raw] of Object.entries(vars)) {
    let v = String(raw ?? '')
    if (html) v = LINK_KEYS.includes(k) && /^https?:\/\//i.test(v) ? `<a href="${escapeHtml(v)}">${escapeHtml(v)}</a>` : escapeHtml(v)
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v).replace(new RegExp(`\\{${k}\\}`, 'g'), v)
  }
  return out.replace(/\{\{\s*[a-zA-Z_]+\s*\}\}/g, '')
}

/** Strips scripts/iframes/event handlers from PM-authored HTML before a live preview renders it. */
export function sanitizePreviewHtml(html) {
  return String(html ?? '')
    .replace(/<(script|iframe|object|embed|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|style)[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
}

/** `{{key}}` / `{key}` tokens of a template that are not in `allowed` (an array or Set of placeholder keys). */
export function unknownPlaceholders(allowed, template) {
  const ok = allowed instanceof Set ? allowed : new Set(allowed ?? [])
  const found = new Set()
  for (const m of String(template ?? '').matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}|\{([a-zA-Z_]+)\}/g)) {
    const k = m[1] ?? m[2]
    if (!ok.has(k)) found.add(k)
  }
  return [...found]
}

export const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Comma/space separated addresses -> trimmed list. */
export const splitAddresses = (s) => String(s ?? '').split(/[,\s;]+/).map((x) => x.trim()).filter(Boolean)

/** One template object in the shape every node stores: en + ar subject/body, cc/admin lists, enabled. */
export function normalizeEmailTemplate(raw, defaults = {}) {
  const t = raw && typeof raw === 'object' ? raw : {}
  const text = (v) => (v === null || v === undefined ? '' : String(v))
  const list = (v) => (Array.isArray(v) ? v.map(text).map((x) => x.trim()).filter(Boolean) : [])
  return {
    enabled: t.enabled !== false,
    subject: text(t.subject ?? defaults.subject),
    body_html: text(t.body_html ?? defaults.body_html),
    // a migrated override only has the English pair: the Arabic side starts empty and the server falls back to English
    subject_ar: text(t.subject_ar ?? (t.subject !== undefined ? '' : defaults.subject_ar)),
    body_html_ar: text(t.body_html_ar ?? (t.body_html !== undefined ? '' : defaults.body_html_ar)),
    cc: list(t.cc),
    admin: list(t.admin),
  }
}

/** Validation of one template: returns null or a message key. */
export function validateEmailTemplate(tpl, allowed) {
  if (!tpl) return null
  if (unknownPlaceholders(allowed, [tpl.subject, tpl.body_html, tpl.subject_ar, tpl.body_html_ar].join('\n')).length) return 'unknownPlaceholder'
  if ([...(tpl.cc ?? []), ...(tpl.admin ?? [])].some((a) => !EMAIL_ADDRESS_RE.test(a))) return 'badAddress'
  return null
}
