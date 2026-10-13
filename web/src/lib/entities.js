/**
 * ONE normalised shape for people/organisations (design 06 section 5.4): every component sees an `EntityView`, never
 * `expert_id || id`, `startup_name || name` or the three company vocabularies of the old app (docs/03 section 7.4).
 *
 * EntityView = {
 *   id, kind: 'expert'|'company'|'generic',
 *   title:{en,ar}, subtitle:{en,ar}, organization:{en,ar}, bio:{en,ar},
 *   imagePath (storage path in public-assets, or null), links:[{kind:'linkedin'|'website'|'other', url}], email
 * }
 * Sources: network_experts rows, companies rows, resolve_list display objects, manual_fields objects. Pure, no imports.
 */

export const ENTITY_KINDS = ['expert', 'company', 'generic']

/** Card fields every entity card can show; the list config / per-item overlay decide which ones are visible. */
export const CARD_FIELDS = ['image', 'title', 'subtitle', 'organization', 'bio', 'links']

const text = (v) => (v === null || v === undefined ? '' : String(v))
const bi = (obj, base) => ({ en: text(obj?.[`${base}_en`]), ar: text(obj?.[`${base}_ar`]) })
const cleanUrl = (u) => {
  const s = text(u).trim()
  return s && /^https?:\/\//i.test(s) ? s : s ? `https://${s}` : ''
}

export function linksOf({ linkedin_url, website_url, links } = {}) {
  const out = []
  if (linkedin_url) out.push({ kind: 'linkedin', url: cleanUrl(linkedin_url) })
  if (website_url) out.push({ kind: 'website', url: cleanUrl(website_url) })
  for (const l of Array.isArray(links) ? links : []) {
    const url = cleanUrl(typeof l === 'string' ? l : l?.url)
    if (!url || out.some((x) => x.url === url)) continue
    out.push({ kind: typeof l === 'object' && l?.kind ? l.kind : /linkedin\.com/i.test(url) ? 'linkedin' : 'other', url })
  }
  return out
}

/** network_experts row -> EntityView (expert). */
export function normalizeExpert(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: 'expert',
    networkKind: row.kind ?? 'expert',
    title: bi(row, 'name'),
    subtitle: bi(row, 'title'),
    organization: bi(row, 'company'),
    bio: bi(row, 'bio'),
    imagePath: row.photo_path ?? null,
    links: linksOf(row),
    email: text(row.email) || null,
  }
}

/** companies row -> EntityView (company). Industry is the subtitle; location is kept in `extra` for PM screens. */
export function normalizeCompany(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: 'company',
    title: bi(row, 'name'),
    subtitle: bi(row, 'industry'),
    organization: { en: '', ar: '' },
    bio: bi(row, 'description'),
    imagePath: row.logo_path ?? null,
    links: linksOf(row),
    email: null,
    extra: { location: bi(row, 'location'), governorate: bi(row, 'governorate'), stage: text(row.stage), employees: text(row.employees), foundingYear: row.founding_year ?? null },
  }
}

/** A resolve_list `display` object or a `manual_fields` object -> EntityView. */
export function normalizeDisplay(display, kind = 'generic', id = null) {
  const d = display ?? {}
  return {
    id,
    kind,
    title: bi(d, 'title'),
    subtitle: bi(d, 'subtitle'),
    organization: bi(d, 'organization'),
    bio: bi(d, 'bio'),
    imagePath: d.image_path ?? null,
    links: linksOf(d),
    email: text(d.email) || null,
  }
}

/** EntityView -> network_experts columns (create/update). */
export function toExpertRow(v) {
  return {
    name_en: v.title?.en?.trim() || null, name_ar: v.title?.ar?.trim() || null,
    title_en: v.subtitle?.en?.trim() || null, title_ar: v.subtitle?.ar?.trim() || null,
    company_en: v.organization?.en?.trim() || null, company_ar: v.organization?.ar?.trim() || null,
    bio_en: v.bio?.en?.trim() || null, bio_ar: v.bio?.ar?.trim() || null,
    photo_path: v.imagePath || null,
    linkedin_url: v.links?.find((l) => l.kind === 'linkedin')?.url || null,
    email: v.email?.trim() || null,
  }
}

/** EntityView -> companies columns (create/update). */
export function toCompanyRow(v) {
  const other = (v.links ?? []).filter((l) => l.kind !== 'linkedin' && l.kind !== 'website')
  return {
    name_en: v.title?.en?.trim() || null, name_ar: v.title?.ar?.trim() || null,
    industry_en: v.subtitle?.en?.trim() || null, industry_ar: v.subtitle?.ar?.trim() || null,
    description_en: v.bio?.en?.trim() || null, description_ar: v.bio?.ar?.trim() || null,
    logo_path: v.imagePath || null,
    linkedin_url: v.links?.find((l) => l.kind === 'linkedin')?.url || null,
    website_url: v.links?.find((l) => l.kind === 'website')?.url || null,
    links: other.map((l) => ({ kind: l.kind, url: l.url })),
  }
}

/** EntityView -> manual_fields (the resolver display vocabulary, 04 1.3 detach_item_to_manual). */
export function toManualFields(v) {
  const out = {
    title_en: v.title?.en?.trim() || null, title_ar: v.title?.ar?.trim() || null,
    subtitle_en: v.subtitle?.en?.trim() || null, subtitle_ar: v.subtitle?.ar?.trim() || null,
    organization_en: v.organization?.en?.trim() || null, organization_ar: v.organization?.ar?.trim() || null,
    bio_en: v.bio?.en?.trim() || null, bio_ar: v.bio?.ar?.trim() || null,
    image_path: v.imagePath || null,
    linkedin_url: v.links?.find((l) => l.kind === 'linkedin')?.url || null,
    website_url: v.links?.find((l) => l.kind === 'website')?.url || null,
    email: v.email?.trim() || null,
  }
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k]
  return out
}

export const emptyEntity = (kind = 'generic') => ({
  id: null, kind, title: { en: '', ar: '' }, subtitle: { en: '', ar: '' }, organization: { en: '', ar: '' }, bio: { en: '', ar: '' },
  imagePath: null, links: [], email: null,
})

/** The entity has at least a name in one language. */
export const entityHasTitle = (v) => Boolean(v?.title?.en?.trim() || v?.title?.ar?.trim())

/** Localised string of a bilingual pair with fallback to the other language (same rule as i18n pick). */
export function biPick(pair, lang) {
  if (!pair) return ''
  const first = lang === 'ar' ? pair.ar : pair.en
  const second = lang === 'ar' ? pair.en : pair.ar
  return (first && first.trim()) || (second && second.trim()) || ''
}

/**
 * resolve_list row (or a public tab item) -> ListItemView. Virtual items (no overlay row yet) get a stable client key
 * `virtual:<kind>:<source id>`; `itemId` stays null until ensure_item (02 section 3.2).
 */
export function normalizeListItem(row, kind = 'generic') {
  if (!row) return null
  const source = row.source ?? { kind: 'manual', id: null, state: 'ok' }
  const itemId = row.item_id ?? null
  const overlay = row.overlay ?? {}
  return {
    id: itemId ?? `virtual:${source.kind}:${source.id}`,
    itemId,
    virtual: !itemId,
    source,
    missing: source.state === 'missing',
    kind,
    entity: normalizeDisplay(row.display, kind, itemId),
    overlay,
    status: row.status ?? null,
    sortOrder: row.sort_order ?? null,
    excluded: Boolean(row.excluded),
    cursor: row.cursor ?? null,
    contact: row.contact ?? {},
    fields: row.fields ?? null,
    card: cardShowOf(row.card ?? overlay.card),
  }
}

/** Legacy per-item card keys of the migrated data (show_photo, show_description ...) -> CARD_FIELDS keys. */
const LEGACY_CARD_KEYS = {
  show_photo: 'image', show_logo: 'image', image: 'image',
  show_name: 'title', title: 'title',
  show_title: 'subtitle', show_industry: 'subtitle', subtitle: 'subtitle',
  show_company: 'organization', organization: 'organization',
  show_bio: 'bio', show_description: 'bio', bio: 'bio',
  show_links: 'links', show_linkedin: 'links', links: 'links',
}

/** overlay.card -> { field: true|false } (only the fields that have an explicit per-item choice). */
export function cardShowOf(card) {
  const show = card?.show
  if (!show || typeof show !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(show)) {
    const field = LEGACY_CARD_KEYS[k]
    if (field && typeof v === 'boolean') out[field] = v
  }
  return out
}

/** Visible card fields for one item: the list's defaults unless the item has an explicit choice. */
export function visibleCardFields(listShowFields, itemShow = {}) {
  const defaults = Array.isArray(listShowFields) && listShowFields.length ? listShowFields : CARD_FIELDS
  return CARD_FIELDS.filter((f) => (typeof itemShow[f] === 'boolean' ? itemShow[f] : defaults.includes(f)))
}

const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validation of an EntityView form: returns { field: errorKey } using the entity.* dictionary keys. */
export function validateEntityView(v) {
  const errors = {}
  if (!entityHasTitle(v)) errors.title = 'entity.field.titleRequired'
  for (const l of v.links ?? []) if (l.url && !URL_RE.test(l.url.trim())) errors.links = 'entity.field.urlInvalid'
  if (v.email && !EMAIL_RE.test(v.email.trim())) errors.email = 'entity.field.emailInvalid'
  return errors
}

/** Case-insensitive search over both languages of title/subtitle/organization (and e-mail for PM screens). */
export function entityMatches(view, term) {
  const q = String(term ?? '').trim().toLowerCase()
  if (!q) return true
  const hay = [view.title, view.subtitle, view.organization].flatMap((p) => [p?.en, p?.ar]).concat([view.email]).filter(Boolean)
  return hay.some((s) => String(s).toLowerCase().includes(q))
}
