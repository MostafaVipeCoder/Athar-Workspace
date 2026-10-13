import { newId } from '../../lib/id.js'
import { PUBLIC_KINDS, buildPublicUrl } from '../../lib/links.js'

/**
 * Pure helpers of the Landing Page node (design 01 section 3.9, 04 section 3.11, 07 section 5/6). No React, no data access.
 *
 * Config (`nodes.config`), tolerant of the migrated shape (m19: `{ title: 'Join Athar', layoutColumns: 2, hero: { coverPath } }`):
 * {
 *   nav:          { enabled, links: [{ id, label{en,ar}, target: 'section:hero|cards|personalize' | 'https://...' }] }   // empty = defaults
 *   hero:         { title{en,ar}, body{en,ar}, coverPath }
 *   cardsSection: { enabled, title{en,ar}, body{en,ar}, layoutColumns: 1..3 }
 *   personalize:  { enabled, title{en,ar}, body{en,ar}, labels: { choose, download, edit, change, placeholder } each {en,ar} (empty = built-in text) }
 *   share:        { channels: ['whatsapp','facebook','linkedin','instagram','telegram','copy', 'x'?] }
 *   seo:          { title{en,ar}, description{en,ar}, imagePath }
 *   analytics:    { enabled }
 * }
 * Cards and frames are NOT in the config: they are rows (landing_cards, landing_share_presets, landing_frames) written by save_node
 * children, so a card keeps its id across saves (analytics survive, docs/04 A-36).
 *
 * Card model (editor draft AND public payload): { id, cover, chip{en,ar}, title{en,ar}, body{en,ar}, seeMoreLines, ctaLabel{en,ar},
 * ctaUrl, ctaNodeId, ctaLink, ctaDot, shareEnabled, shareUrl, shareNodeId, shareLink, presets{platform: text} }.
 * `ctaLink` / `shareLink` are { kind, slug, view_key } descriptors resolved by the DB from `cta_node_id` / `share_node_id` (public side only).
 */
export const MAX_CARDS = 24
export const MAX_FRAMES = 8
export const SHARE_PLATFORMS = ['whatsapp', 'facebook', 'linkedin', 'instagram', 'telegram', 'x', 'copy']
export const DEFAULT_CHANNELS = ['whatsapp', 'facebook', 'linkedin', 'instagram', 'telegram', 'copy']
export const NAV_SECTIONS = ['hero', 'cards', 'personalize']
export const LABEL_KEYS = ['choose', 'download', 'edit', 'change', 'placeholder']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Mirrors `app_private.landing_safe_url`: http(s), mailto, tel, /path, #anchor. Anything else (javascript:, data:) is refused. */
const SAFE_URL_RE = /^(https?:\/\/\S+|mailto:\S+|tel:[+0-9 ()-]+|\/\S*|#\S*)$/i

const text = (v) => (v === null || v === undefined ? '' : String(v))
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const bi = (v) => (v && typeof v === 'object' ? { en: text(v.en), ar: text(v.ar) } : { en: text(v), ar: '' })
export const isUuid = (v) => UUID_RE.test(String(v ?? ''))
export { newId }
export const isSafeUrl = (v) => !v || SAFE_URL_RE.test(String(v).trim())
/** Localised value of an {en, ar} pair with fallback to the other language. */
export const pickBi = (v, lang) => (lang === 'ar' ? v?.ar || v?.en : v?.en || v?.ar) || ''

// ------------------------------------------------------------------ config
export const defaultNavLinks = () => [
  { id: 'cards', label: { en: 'Opportunities', ar: 'الفرص' }, target: 'section:cards' },
  { id: 'personalize', label: { en: 'Your Picture', ar: 'صورتك' }, target: 'section:personalize' },
]

function normNavLink(l, i) {
  const x = obj(l)
  return { id: text(x.id) || `nav-${i}`, label: bi(x.label), target: text(x.target) || 'section:cards' }
}
const clampCols = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 ? Math.min(3, Math.round(n)) : 0
}

/** Tolerant read of a stored config; unknown keys are kept for forward compatibility. */
export function normalizeLandingConfig(raw) {
  const c = obj(raw)
  const nav = obj(c.nav)
  const hero = obj(c.hero)
  const cs = obj(c.cardsSection)
  const p = obj(c.personalize)
  const labels = obj(p.labels)
  const sh = obj(c.share)
  const seo = obj(c.seo)
  const an = obj(c.analytics)
  // legacy `title` (join_athar_pages.main_title, a single string) is the hero title until the PM writes one
  const heroTitle = bi(hero.title)
  if (!heroTitle.en && !heroTitle.ar && typeof c.title === 'string') heroTitle.en = c.title
  const channels = Array.isArray(sh.channels) ? sh.channels.filter((x, i, a) => SHARE_PLATFORMS.includes(x) && a.indexOf(x) === i) : null
  return {
    ...c,
    nav: { ...nav, enabled: nav.enabled !== false, links: Array.isArray(nav.links) ? nav.links.map(normNavLink) : [] },
    hero: { ...hero, title: heroTitle, body: bi(hero.body), coverPath: text(hero.coverPath) },
    cardsSection: { ...cs, enabled: cs.enabled !== false, title: bi(cs.title), body: bi(cs.body), layoutColumns: clampCols(cs.layoutColumns ?? c.layoutColumns) },
    personalize: { ...p, enabled: p.enabled === true, title: bi(p.title), body: bi(p.body), labels: Object.fromEntries(LABEL_KEYS.map((k) => [k, bi(labels[k])])) },
    share: { ...sh, channels: channels && channels.length ? channels : [...DEFAULT_CHANNELS] },
    seo: { ...seo, title: bi(seo.title), description: bi(seo.description), imagePath: text(seo.imagePath) },
    analytics: { ...an, enabled: an.enabled !== false },
  }
}

/** True when a node carries no landing content at all (a fresh node): the editor then offers the starter template. */
export function isBlankLanding(config, cards = [], frames = []) {
  const c = normalizeLandingConfig(config)
  const hasText = (v) => Boolean(v.en.trim() || v.ar.trim())
  return !cards.length && !frames.length && !hasText(c.hero.title) && !hasText(c.hero.body) && !c.hero.coverPath && !hasText(c.cardsSection.title) && !hasText(c.cardsSection.body) && !c.personalize.enabled
}

// ------------------------------------------------------------------ cards and frames (rows <-> draft models)
export const emptyCard = (over = {}) => ({
  id: newId(), cover: '', chip: { en: '', ar: '' }, title: { en: '', ar: '' }, body: { en: '', ar: '' }, seeMoreLines: null,
  ctaLabel: { en: '', ar: '' }, ctaUrl: '', ctaNodeId: null, ctaLink: null, ctaDot: true, shareEnabled: true, shareUrl: '', shareNodeId: null, shareLink: null, presets: {},
  ...over,
})

/** A `landing_cards` row (PM read, with `presets`) or a public payload card -> the card model. */
export function fromCardRow(row) {
  const r = obj(row)
  const presets = {}
  for (const [k, v] of Object.entries(obj(r.presets))) if (SHARE_PLATFORMS.includes(k) && typeof v === 'string') presets[k] = v
  return {
    id: r.id,
    cover: text(r.cover_path),
    chip: { en: text(r.chip_label_en), ar: text(r.chip_label_ar) },
    title: { en: text(r.title_en), ar: text(r.title_ar) },
    body: { en: text(r.body_en), ar: text(r.body_ar) },
    seeMoreLines: Number.isInteger(r.see_more_lines) && r.see_more_lines > 0 ? r.see_more_lines : null,
    ctaLabel: { en: text(r.cta_label_en), ar: text(r.cta_label_ar) },
    ctaUrl: text(r.cta_url),
    ctaNodeId: r.cta_node_id ?? null,
    ctaLink: r.cta_link && typeof r.cta_link === 'object' ? r.cta_link : null,
    ctaDot: r.cta_dot === true,
    shareEnabled: r.share_enabled === true,
    shareUrl: text(r.share_url),
    shareNodeId: r.share_node_id ?? null,
    shareLink: r.share_link && typeof r.share_link === 'object' ? r.share_link : null,
    presets,
  }
}

/** The public payload `{ config, cards, frames }` (get_public_landing / get_public_tab) -> the page model every renderer takes. */
export function modelFromPayload(data) {
  const d = obj(data)
  return {
    nodeId: d.node_id ?? null,
    config: normalizeLandingConfig(d.config),
    cards: (Array.isArray(d.cards) ? d.cards : []).map(fromCardRow),
    frames: (Array.isArray(d.frames) ? d.frames : []).map(fromFrameRow),
  }
}

export const emptyFrame = (over = {}) => ({ id: newId(), name: '', path: '', windowX: null, windowY: null, windowW: null, windowH: null, shape: 'rect', ...over })

export function fromFrameRow(row) {
  const r = obj(row)
  const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null)
  return { id: r.id, name: text(r.name), path: text(r.image_path), windowX: n(r.window_x), windowY: n(r.window_y), windowW: n(r.window_w), windowH: n(r.window_h), shape: r.window_shape === 'circle' ? 'circle' : 'rect' }
}

/** Only non-empty presets of known platforms are sent (the DB replaces the card's set; an empty text = the built-in default). */
export function cleanPresets(presets) {
  const out = {}
  for (const k of SHARE_PLATFORMS) {
    const v = text(obj(presets)[k]).trim()
    if (v) out[k] = text(presets[k])
  }
  return out
}

const nz = (v) => (text(v).trim() ? text(v).trim() : null)

/** The `children` of save_node: stable ids (uuids are always sent; a new card carries a client-made uuid from the start). */
export function toChildren(cards, frames) {
  return {
    cards: cards.map((c, i) => ({
      id: isUuid(c.id) ? c.id : undefined,
      sort_order: i,
      cover_path: nz(c.cover),
      chip_label_en: nz(c.chip.en), chip_label_ar: nz(c.chip.ar),
      title_en: nz(c.title.en), title_ar: nz(c.title.ar),
      body_en: c.body.en.trim() ? c.body.en : null, body_ar: c.body.ar.trim() ? c.body.ar : null,
      see_more_lines: c.seeMoreLines || null,
      cta_label_en: nz(c.ctaLabel.en), cta_label_ar: nz(c.ctaLabel.ar),
      cta_url: c.ctaNodeId ? null : nz(c.ctaUrl),
      cta_node_id: c.ctaNodeId || null,
      cta_dot: Boolean(c.ctaDot),
      share_enabled: Boolean(c.shareEnabled),
      share_url: c.shareNodeId ? null : nz(c.shareUrl),
      share_node_id: c.shareNodeId || null,
      presets: cleanPresets(c.presets),
    })),
    frames: frames.map((f, i) => ({
      id: isUuid(f.id) ? f.id : undefined,
      name: nz(f.name), image_path: f.path, aspect: '4:5',
      window_x: f.windowX, window_y: f.windowY, window_w: f.windowW, window_h: f.windowH,
      window_shape: f.shape === 'circle' ? 'circle' : 'rect', sort_order: i,
    })),
  }
}

/** Validation mirrored from the DB (`save_children_landing_page`): returns { <key>: reason } (empty = ok). */
export function validateLanding({ config, cards, frames }) {
  const errors = {}
  if (cards.length > MAX_CARDS) errors.cards = 'tooMany'
  if (frames.length > MAX_FRAMES) errors.frames = 'tooMany'
  for (const c of cards) {
    if (!isSafeUrl(c.ctaUrl)) errors[`${c.id}.ctaUrl`] = 'url'
    if (!isSafeUrl(c.shareUrl)) errors[`${c.id}.shareUrl`] = 'url'
    if (c.title.en.length > 300 || c.title.ar.length > 300) errors[`${c.id}.title`] = 'long'
    if (c.body.en.length > 5000 || c.body.ar.length > 5000) errors[`${c.id}.body`] = 'long'
    for (const [k, v] of Object.entries(c.presets ?? {})) if (text(v).length > 2000) errors[`${c.id}.preset.${k}`] = 'long'
  }
  for (const l of normalizeLandingConfig(config).nav.links) {
    if (!l.target.startsWith('section:') && !isSafeUrl(l.target)) errors[`nav.${l.id}`] = 'url'
  }
  return errors
}

export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

// ------------------------------------------------------------------ nav
/**
 * The links of the sticky nav. Empty config = the two defaults of landing-page.html (Opportunities / Your Picture); a section link
 * is dropped when its section is not on the page; external links must be safe URLs.
 */
export function resolveNav(config, { hasHero = false, hasCards = false, hasPersonalize = false } = {}) {
  const nav = normalizeLandingConfig(config).nav
  if (!nav.enabled) return []
  const present = { hero: hasHero, cards: hasCards, personalize: hasPersonalize }
  const links = nav.links.length ? nav.links : defaultNavLinks()
  return links
    .filter((l) => (l.target.startsWith('section:') ? present[l.target.slice(8)] : isSafeUrl(l.target) && Boolean(l.target)))
    .map((l) => (l.target.startsWith('section:') ? { id: l.id, label: l.label, section: l.target.slice(8) } : { id: l.id, label: l.label, url: l.target }))
}

// ------------------------------------------------------------------ links (the `link` port: a Form / Booking / Agenda page, or any URL)
/** { kind, slug, view_key } (resolved by the DB from a node id) -> an absolute public URL; '' when it cannot be built. */
export function descriptorUrl(desc, { base } = {}) {
  if (desc?.url) return desc.url
  if (!desc || !desc.slug) return ''
  if (desc.kind === 'view') return desc.view_key ? buildPublicUrl('view', desc.slug, { viewKey: desc.view_key, base }) : ''
  if (PUBLIC_KINDS[desc.kind]) return buildPublicUrl(desc.kind, desc.slug, { base })
  return ''
}

/** Absolute URL of a typed link: http(s)/mailto/tel as is, `/path` on the app's origin, `#...` = no target. */
export function absoluteUrl(url, { origin } = {}) {
  const u = text(url).trim()
  if (!u || u.startsWith('#') || !isSafeUrl(u)) return ''
  if (u.startsWith('/')) return `${text(origin).replace(/\/+$/, '')}${u}`
  return u
}

export const withSource = (url, source) => (source && url ? `${url}${url.includes('?') ? '&' : '?'}source=${encodeURIComponent(source)}` : url)

/**
 * Where a card's button goes and what "share" shares (decision 01-13): the CTA is the typed URL, else the bound node's public link;
 * the share target is its own typed URL / bound node, else the CTA target, else the landing page itself.
 * `sourceable` = the target is one of OUR form pages, so a `?source=` tag can be added (form analytics count by source).
 */
export function resolveCardLinks(card, { base, origin, pageUrl = '' } = {}) {
  const ctaTyped = absoluteUrl(card.ctaUrl, { origin })
  const ctaBound = descriptorUrl(card.ctaLink, { base })
  const ctaUrl = ctaTyped || ctaBound
  const ctaForm = !ctaTyped && card.ctaLink?.kind === 'form'
  const shareTyped = absoluteUrl(card.shareUrl, { origin })
  const shareBound = descriptorUrl(card.shareLink, { base })
  let shareUrl = shareTyped || shareBound
  let sourceable = !shareTyped && card.shareLink?.kind === 'form'
  if (!shareUrl) {
    shareUrl = ctaUrl
    sourceable = ctaForm
  }
  if (!shareUrl) {
    shareUrl = pageUrl
    sourceable = false
  }
  return { ctaUrl, ctaHref: ctaUrl || (text(card.ctaUrl).trim().startsWith('#') ? text(card.ctaUrl).trim() : ''), ctaForm, shareUrl, sourceable }
}

// ------------------------------------------------------------------ starter template (the copy of landing-page.html, EN + AR)
/** The two-card page of landing-page.html as editable content; offered explicitly on an empty node (never applied silently). */
export function starterTemplate() {
  const card = (over) => emptyCard({ shareEnabled: true, ctaDot: true, ...over })
  return {
    config: {
      nav: { enabled: true, links: defaultNavLinks() },
      hero: {
        title: { en: 'Help Someone Find Their Next Opportunity.', ar: 'ساعد شخصًا ما على إيجاد فرصته القادمة.' },
        body: {
          en: 'You know the difference between building alone and getting the right support in the hard journey of building a startup. Now, help someone in your network discover the right opportunity through Athar.',
          ar: 'أنت تعرف الفرق بين أن تبني وحدك وأن تحصل على الدعم المناسب في رحلة بناء شركة ناشئة. الآن، ساعد شخصًا من شبكتك على اكتشاف الفرصة المناسبة عبر أثر.',
        },
        coverPath: '',
      },
      cardsSection: {
        enabled: true,
        title: { en: 'Two ways to pass the opportunity on.', ar: 'طريقتان لتمرير الفرصة.' },
        body: {
          en: 'Whether you know someone who’s ready for an opportunity now or a founder who could be a great fit for Athar in the future, you can help them get connected.\nChoose the option that fits them best below.',
          ar: 'سواء كنت تعرف شخصًا جاهزًا للفرصة الآن، أو مؤسسًا قد يكون مناسبًا لأثر في المستقبل، يمكنك مساعدته على التواصل.\nاختر الخيار الأنسب له أدناه.',
        },
        layoutColumns: 2,
      },
      personalize: {
        enabled: true,
        title: { en: 'Personalize the Moment', ar: 'خصّص اللحظة' },
        body: { en: 'Upload your photo to create your personalized design and share it on your social media.', ar: 'ارفع صورتك لتصميم لمسة شخصية وشاركها على حساباتك على وسائل التواصل.' },
        labels: Object.fromEntries(LABEL_KEYS.map((k) => [k, { en: '', ar: '' }])),
      },
      share: { channels: [...DEFAULT_CHANNELS] },
      analytics: { enabled: true },
    },
    cards: [
      card({
        chip: { en: 'Upcoming Program', ar: 'البرنامج القادم' },
        title: { en: 'Do you know a founder needs support?', ar: 'هل تعرف مؤسسًا يحتاج إلى دعم؟' },
        body: { en: 'Share the program with a founder in your network who’s building a startup, developing an idea or looking for the right support to grow.', ar: 'شارك البرنامج مع مؤسس في شبكتك يبني شركة ناشئة أو يطوّر فكرة أو يبحث عن الدعم المناسب لينمو.' },
        ctaLabel: { en: 'Share the upcoming program', ar: 'شارك البرنامج القادم' },
      }),
      card({
        chip: { en: 'Wait List', ar: 'قائمة الانتظار' },
        title: { en: 'Not this opportunity? Maybe the next one.', ar: 'ليست هذه الفرصة؟ ربما التالية.' },
        body: {
          en: 'Know a founder in your circle who could be a great fit for Athar, but not for the current program?\n\nShare the application for the waiting list. They’ll be notified when an opportunity that fits them opens and get the chance to accelerate their growth too.',
          ar: 'هل تعرف مؤسسًا في دائرتك قد يكون مناسبًا لأثر، لكن ليس للبرنامج الحالي؟\n\nشارك طلب الانضمام إلى قائمة الانتظار. سيصلهم إشعار عند فتح فرصة تناسبهم، وستتاح لهم فرصة تسريع نموهم أيضًا.',
        },
        ctaLabel: { en: 'Share the waiting list', ar: 'شارك قائمة الانتظار' },
      }),
    ],
  }
}

// ------------------------------------------------------------------ analytics rows (get_landing_analytics) -> view models
export const EVENT_TYPES = ['tab_view', 'cta_click', 'card_share', 'share_copy', 'image_upload', 'image_download']

/** Per card: { cardId, counts{type: n} } sorted by the card order; events of removed cards (card_id null) are only in the totals. */
export function analyticsByCard(rows, cards) {
  const map = new Map(cards.map((c) => [c.id, {}]))
  for (const r of rows ?? []) if (map.has(r.card_id)) map.get(r.card_id)[r.event_type] = (map.get(r.card_id)[r.event_type] ?? 0) + Number(r.n)
  return cards.map((c) => ({ cardId: c.id, counts: map.get(c.id) ?? {} }))
}

/** Daily series of ONE event type over the last `days` days (UTC dates, missing days = 0). `today` is injectable for tests. */
export function analyticsSeries(rows, type, days = 14, today = new Date()) {
  const byDay = new Map()
  for (const r of rows ?? []) if (r.event_type === type) byDay.set(String(r.day).slice(0, 10), (byDay.get(String(r.day).slice(0, 10)) ?? 0) + Number(r.n))
  const out = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    const key = d.toISOString().slice(0, 10)
    out.push({ day: key, n: byDay.get(key) ?? 0 })
  }
  return out
}

/**
 * The editor's cards know their targets by NODE id; the public payload carries DB-resolved descriptors. For the editor's previews
 * (share texts, the live preview) the connected links' URLs are attached as `{ kind, url }` descriptors (`descriptorUrl` accepts a ready
 * `url`), so one resolver (`resolveCardLinks`) serves both worlds.
 */
export function withResolvedLinks(card, optionsByNode) {
  const desc = (nodeId) => {
    const o = nodeId ? optionsByNode.get(nodeId) : null
    return o ? { kind: o.kind, url: o.url } : null
  }
  return { ...card, ctaLink: desc(card.ctaNodeId) ?? card.ctaLink, shareLink: desc(card.shareNodeId) ?? card.shareLink }
}
