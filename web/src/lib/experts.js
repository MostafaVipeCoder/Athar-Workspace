/**
 * Pure logic of the Athar Network EXPERTS REGISTRY (m75 - m77): list state <-> URL <-> RPC arguments, the row / profile view models, the create / edit form model
 * (validation mirrors the server: `app_private.expert_clean`), the Excel export / import mapping, the merge field plan. No imports of React, no I/O: unit-tested in experts.test.js.
 *
 * Owner description (docs/13): "the place where every trainer who took part in our programs is gathered, which programs each took part in and how many times, with a profile
 * for mentors and experts". Everything about participation is DERIVED live by the database (app_private.expert_participation); nothing here stores a counter.
 */
import { biPick } from './entities.js'

// ------------------------------------------------------------------ vocabularies
/** Languages an expert speaks: ISO 639-1 codes stored in network_experts.languages (the database accepts any 2-3 letter code, the form offers these). */
export const LANGUAGES = [
  { code: 'ar', en: 'Arabic', ar: 'العربية' },
  { code: 'en', en: 'English', ar: 'الإنجليزية' },
  { code: 'fr', en: 'French', ar: 'الفرنسية' },
  { code: 'de', en: 'German', ar: 'الألمانية' },
  { code: 'es', en: 'Spanish', ar: 'الإسبانية' },
  { code: 'it', en: 'Italian', ar: 'الإيطالية' },
  { code: 'tr', en: 'Turkish', ar: 'التركية' },
  { code: 'ru', en: 'Russian', ar: 'الروسية' },
  { code: 'zh', en: 'Chinese', ar: 'الصينية' },
  { code: 'hi', en: 'Hindi', ar: 'الهندية' },
  { code: 'pt', en: 'Portuguese', ar: 'البرتغالية' },
  { code: 'nl', en: 'Dutch', ar: 'الهولندية' },
]
export function languageName(code, lang) {
  const hit = LANGUAGES.find((l) => l.code === code)
  return hit ? (lang === 'ar' ? hit.ar : hit.en) : String(code ?? '').toUpperCase()
}

export const EXPERT_KINDS = ['expert', 'team']
export const EXPERT_STATES = ['active', 'archived', 'deleted', 'all']
export const EXPERT_SORTS = ['name', 'programs', 'projects', 'sessions', 'last', 'updated', 'created']
/** The direction a sort starts with: names A-Z, every count / date newest or biggest first. */
export const DEFAULT_DIR = { name: 'asc', programs: 'desc', projects: 'desc', sessions: 'desc', last: 'desc', updated: 'desc', created: 'desc' }
export const PAGE_SIZES = [24, 48, 96]
export const LIMITS = { name: 200, short: 200, long: 4000, phone: 40, url: 500, languages: 8, tags: 12, links: 6, tagName: 60 }

/** The ONLY folder of the registry photos (the storage policy, the table CHECK and expert_clean use the same pattern): the full file or its `_t` thumbnail. */
const EXPERT_PHOTO_RE = /^global\/expert-photo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.webp$/
export const isExpertPhotoPath = (path) => typeof path === 'string' && EXPERT_PHOTO_RE.test(path)

/**
 * A link from the database -> something safe to put in an href: an http(s) address as it is, a bare `host/path` (one migrated record has no scheme) with https:// in front; anything
 * else (javascript:, data:, a relative path, a non-string) -> '' (no link is rendered). The database refuses other schemes too (CHECK); this is the second wall.
 */
export function safeHref(value) {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  if (!v || v.length > 500 || /\s/.test(v)) return ''
  if (/^https?:\/\/\S+$/i.test(v)) return v
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i.test(v) ? `https://${v}` : ''
}

/** The "similar record" reasons the server reports (app_private.expert_match), strongest first. */
export const DUPLICATE_REASONS = ['same_linkedin', 'same_email', 'same_name', 'same_name_translit', 'similar_name']
/** A score at or above this blocks a create (the caller has to confirm): the server's own rule, repeated for the wording. */
export const BLOCKING_SCORE = 0.95

// ------------------------------------------------------------------ list state <-> URL <-> RPC
export const DEFAULT_LIST_STATE = Object.freeze({
  q: '', kind: '', state: 'active', photo: '', email: '', tags: [], language: '', program: '', part: '', sort: 'name', dir: 'asc', page: 1, size: 24,
})

const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback)
const triState = (v) => (v === 'yes' || v === 'no' ? v : '')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** URLSearchParams -> a complete, sanitised list state (an unknown value falls back to its default: a stale or hand-edited link never breaks the page). */
export function parseListState(params) {
  const get = (k) => params?.get?.(k) ?? ''
  const sort = oneOf(get('sort'), EXPERT_SORTS, DEFAULT_LIST_STATE.sort)
  const rawPage = Number.parseInt(get('page'), 10)
  const rawSize = Number.parseInt(get('size'), 10)
  return {
    q: get('q').slice(0, 120),
    kind: oneOf(get('kind'), EXPERT_KINDS, ''),
    state: oneOf(get('state'), EXPERT_STATES, 'active'),
    photo: triState(get('photo')),
    email: triState(get('email')),
    tags: get('tags').split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)).slice(0, 20),
    language: /^[a-z]{2,3}$/.test(get('speaks')) ? get('speaks') : '',
    program: UUID_RE.test(get('program')) ? get('program') : '',
    part: triState(get('part')),
    sort,
    dir: oneOf(get('dir'), ['asc', 'desc'], DEFAULT_DIR[sort]),
    page: Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1,
    size: PAGE_SIZES.includes(rawSize) ? rawSize : DEFAULT_LIST_STATE.size,
  }
}

/** The query-string keys that belong to the list state: any OTHER key of the URL (the app's own ?lang=) is kept when the state changes. */
export const LIST_PARAM_KEYS = ['q', 'kind', 'state', 'photo', 'email', 'tags', 'speaks', 'program', 'part', 'sort', 'dir', 'page', 'size']

/** A list state -> the query string: ONLY what differs from the defaults (a clean URL; the direction only when it is not the sort's own default). */
export function listStateToParams(state) {
  const s = { ...DEFAULT_LIST_STATE, ...state }
  const p = new URLSearchParams()
  if (s.q.trim()) p.set('q', s.q.trim())
  if (s.kind) p.set('kind', s.kind)
  if (s.state !== 'active') p.set('state', s.state)
  if (s.photo) p.set('photo', s.photo)
  if (s.email) p.set('email', s.email)
  if (s.tags.length) p.set('tags', s.tags.join(','))
  if (s.language) p.set('speaks', s.language)
  if (s.program) p.set('program', s.program)
  if (s.part) p.set('part', s.part)
  if (s.sort !== 'name') p.set('sort', s.sort)
  if (s.dir !== DEFAULT_DIR[s.sort]) p.set('dir', s.dir)
  if (s.page > 1) p.set('page', String(s.page))
  if (s.size !== DEFAULT_LIST_STATE.size) p.set('size', String(s.size))
  return p
}

/** How many FILTERS (not the search box, not the sort, not the page) narrow the list: the badge of the filter button. `state` counts when it is not "active". */
export function activeFilterCount(state) {
  const s = { ...DEFAULT_LIST_STATE, ...state }
  return [s.kind, s.state !== 'active' ? s.state : '', s.photo, s.email, s.tags.length ? 'tags' : '', s.language, s.program, s.part].filter(Boolean).length
}

/** The RPC arguments of `list_network_experts` for a list state. `full` = the Excel export (every row, the wide columns). */
export function toListArgs(state, lang = 'en', { full = false } = {}) {
  const s = { ...DEFAULT_LIST_STATE, ...state }
  const filter = {}
  if (s.q.trim()) filter.q = s.q.trim()
  if (s.kind) filter.kind = s.kind
  if (s.state !== 'active') filter.state = s.state
  if (s.photo) filter.has_photo = s.photo === 'yes'
  if (s.email) filter.has_email = s.email === 'yes'
  if (s.tags.length) filter.tag_ids = s.tags
  if (s.language) filter.language = s.language
  if (s.program) filter.program_ids = [s.program]
  if (s.part) filter.participated = s.part
  return {
    p_filter: filter,
    p_sort: s.sort,
    p_dir: s.dir,
    p_limit: full ? 5000 : s.size,
    p_offset: full ? 0 : (Math.max(1, s.page) - 1) * s.size,
    p_lang: lang === 'ar' ? 'ar' : 'en',
    p_full: full,
  }
}

// ------------------------------------------------------------------ view models
const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim())
const pair = (row, base) => ({ en: text(row?.[`${base}_en`]), ar: text(row?.[`${base}_ar`]) })

/** A row of `list_network_experts` -> one flat view model (names collapse their stray whitespace: the migrated records carry tabs). */
export function normalizeRegistryRow(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind ?? 'expert',
    name: pair(row, 'name'),
    title: pair(row, 'title'),
    company: pair(row, 'company'),
    photoPath: row.photo_path ?? null,
    linkedin: row.linkedin_url ?? '',
    website: row.website_url ?? '',
    languages: Array.isArray(row.languages) ? row.languages : [],
    hasEmail: Boolean(row.has_email),
    archived: Boolean(row.archived_at),
    deleted: Boolean(row.deleted_at),
    tags: Array.isArray(row.tags) ? row.tags.map(normalizeTag) : [],
    programs: row.programs_count ?? 0,
    projects: row.projects_count ?? 0,
    lists: row.lists_count ?? 0,
    bookingSessions: row.booking_sessions ?? 0,
    distributionSessions: row.distribution_sessions ?? 0,
    sessions: row.sessions_count ?? 0,
    firstOn: row.first_session_on ?? null,
    lastOn: row.last_session_on ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    // the wide export fields (p_full)
    bio: pair(row, 'bio'),
    email: row.email ?? '',
    phone: row.phone ?? '',
    notes: row.notes ?? '',
  }
}

export function normalizeTag(t) {
  return { id: t.id, name: { en: text(t.name_en), ar: text(t.name_ar) }, archived: Boolean(t.archived), uses: t.uses ?? null }
}

/** The name to show in the UI language, falling back to the other language; '' when the record has none. */
export const displayName = (row, lang) => biPick(row?.name, lang)
/** The OTHER language's name when it differs (shown small under the main one). */
export function otherName(row, lang) {
  const main = displayName(row, lang)
  const other = lang === 'ar' ? row?.name?.en : row?.name?.ar
  return other && other !== main ? other : ''
}
/** "Job title - Company" in the UI language (either part may be missing). */
export const roleLine = (row, lang) => [biPick(row?.title, lang), biPick(row?.company, lang)].filter(Boolean).join(' · ')
export const tagName = (tag, lang) => biPick(tag?.name, lang)

/** Participation numbers of a row or of a profile's totals -> the three figures the UI leads with. */
export function participationOf(row) {
  const programs = row?.programs ?? 0
  const projects = row?.projects ?? 0
  const sessions = row?.sessions ?? 0
  return { programs, projects, sessions, took: (row?.lists ?? 0) > 0 }
}

/**
 * The "other links" of a record -> [{ kind, url }] with a usable address only: the database refuses a malformed array (CHECK), but one element without a string url used to crash
 * the profile page for everybody, so the client also keeps just what it can show (an object with an http(s) / bare-host string url).
 */
export function normalizeLinks(links) {
  if (!Array.isArray(links)) return []
  return links
    .filter((l) => l && typeof l === 'object' && !Array.isArray(l) && safeHref(l.url))
    .map((l) => ({ kind: typeof l.kind === 'string' && l.kind ? l.kind : 'other', url: String(l.url).trim() }))
}

/** The profile payload `get_network_expert` -> a flat model (the form, the header and the history read it). */
export function normalizeProfile(payload) {
  if (!payload?.expert) return null
  const e = payload.expert
  const t = payload.totals ?? {}
  return {
    id: e.id,
    kind: e.kind,
    name: pair(e, 'name'),
    title: pair(e, 'title'),
    company: pair(e, 'company'),
    bio: pair(e, 'bio'),
    photoPath: e.photo_path ?? null,
    linkedin: e.linkedin_url ?? '',
    website: e.website_url ?? '',
    links: normalizeLinks(e.links),
    email: e.email ?? '',
    phone: e.phone ?? '',
    languages: Array.isArray(e.languages) ? e.languages : [],
    notes: e.notes ?? '',
    archivedAt: e.archived_at ?? null,
    deletedAt: e.deleted_at ?? null,
    mergedInto: payload.merged_into ? { id: payload.merged_into.id, name: pair(payload.merged_into, 'name') } : null,
    createdAt: e.created_at ?? null,
    updatedAt: e.updated_at ?? null, // the stale-edit token (sent back untouched)
    tags: (payload.tags ?? []).map(normalizeTag),
    totals: {
      programs: t.programs ?? 0,
      projects: t.projects ?? 0,
      lists: t.lists ?? 0,
      bookingSessions: t.booking_sessions ?? 0,
      distributionSessions: t.distribution_sessions ?? 0,
      sessions: t.sessions ?? 0,
      firstOn: t.first_session_on ?? null,
      lastOn: t.last_session_on ?? null,
      firstListedAt: t.first_listed_at ?? null,
      withdrawn: t.withdrawn ?? 0,
      hiddenNotCounted: t.hidden_not_counted ?? 0,
    },
    history: (payload.participation ?? []).map(normalizeEngagement),
    hidden: { engagements: payload.hidden?.engagements ?? 0, projects: payload.hidden?.projects ?? 0, programs: payload.hidden?.programs ?? 0 },
    absorbed: (payload.absorbed ?? []).map((a) => ({ id: a.merge_id, dropId: a.drop_id, name: a.drop_name ?? '', at: a.merged_at })),
    can: { edit: Boolean(payload.can?.edit), archive: Boolean(payload.can?.archive), merge: Boolean(payload.can?.merge), delete: Boolean(payload.can?.delete), restore: Boolean(payload.can?.restore) },
  }
}

/** One engagement of the history: where (program > project > list), in which roles, how many sessions, when. */
export function normalizeEngagement(x) {
  return {
    itemId: x.item_id,
    node: { id: x.node?.id, type: x.node?.type, name: pair(x.node, 'name') },
    project: { id: x.project?.id, name: pair(x.project, 'name'), completedAt: x.project?.completed_at ?? null },
    program: { id: x.program?.id, name: pair(x.program, 'name'), year: x.program?.year ?? null },
    withdrawn: Boolean(x.withdrawn),
    // a legacy HIDDEN list item (the 2 migrated provider items): flagged on the row; `counted` = it takes part in the totals (a withdrawn one, and a hidden one that is only "listed", does not)
    itemHidden: Boolean(x.item_hidden),
    counted: x.counted === undefined ? !x.withdrawn : Boolean(x.counted),
    roles: { provider: Boolean(x.roles?.provider), mentor: Boolean(x.roles?.mentor), presenter: Boolean(x.roles?.presenter) },
    bookingSessions: x.booking_sessions ?? 0,
    distributionSessions: x.distribution_sessions ?? 0,
    firstOn: x.first_session_on ?? null,
    lastOn: x.last_session_on ?? null,
    addedAt: x.added_at ?? null,
  }
}

/** The role keys of an engagement for the chips: mentor (distribution), provider (booking), presenter (agenda); only "listed" when it is just in a list. */
export function roleKeys(roles) {
  const out = []
  if (roles?.mentor) out.push('mentor')
  if (roles?.provider) out.push('provider')
  if (roles?.presenter) out.push('presenter')
  return out.length ? out : ['listed']
}

/** The history grouped by program, newest first (programs keep the order of their most recent engagement). */
export function groupByProgram(history) {
  const groups = new Map()
  for (const h of history ?? []) {
    const g = groups.get(h.program.id) ?? { program: h.program, engagements: [] }
    g.engagements.push(h)
    groups.set(h.program.id, g)
  }
  return [...groups.values()]
}

// ------------------------------------------------------------------ the create / edit form
export const emptyExpertForm = (kind = 'expert') => ({
  kind,
  name: { en: '', ar: '' }, title: { en: '', ar: '' }, company: { en: '', ar: '' }, bio: { en: '', ar: '' },
  photoPath: null, email: '', phone: '', linkedin: '', website: '', languages: [], tags: [], notes: '', links: [],
})

/** A normalised profile -> the form (tags keep their id so a save sends ids, not names). */
export function formFromProfile(p) {
  if (!p) return emptyExpertForm()
  return {
    kind: p.kind ?? 'expert',
    name: { en: p.name.en, ar: p.name.ar }, title: { en: p.title.en, ar: p.title.ar }, company: { en: p.company.en, ar: p.company.ar }, bio: { en: p.bio.en, ar: p.bio.ar },
    photoPath: p.photoPath, email: p.email, phone: p.phone, linkedin: p.linkedin, website: p.website, languages: [...p.languages],
    tags: p.tags.map((t) => ({ id: t.id, name_en: t.name.en, name_ar: t.name.ar })), notes: p.notes, links: p.links.map((l) => ({ kind: l.kind ?? 'other', url: l.url })),
  }
}

/** Western digits for a phone typed with Arabic-Indic ones. */
export const westernDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))

/** "linkedin.com/in/x" -> "https://linkedin.com/in/x"; a value that is not a web address is returned as typed (validation then refuses it). */
export function normalizeUrl(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return /^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s) ? `https://${s}` : s
}

const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_RE = /^\+?[0-9][0-9 ().-]{3,38}$/

/** Form -> { field: messageKey } (empty = valid). The same rules as the server's expert_clean, so a save that passes here is not refused there. */
export function validateExpertForm(form) {
  const e = {}
  const n = (s) => String(s ?? '').trim()
  if (!n(form.name?.en) && !n(form.name?.ar)) e.name = 'experts.err.nameRequired'
  for (const k of ['name', 'title', 'company']) if (n(form[k]?.en).length > LIMITS.short || n(form[k]?.ar).length > LIMITS.short) e[k] = 'experts.err.tooLong'
  for (const k of ['bio']) if (n(form[k]?.en).length > LIMITS.long || n(form[k]?.ar).length > LIMITS.long) e[k] = 'experts.err.tooLong'
  if (n(form.notes).length > LIMITS.long) e.notes = 'experts.err.tooLong'
  if (n(form.email) && (n(form.email).length > 254 || !EMAIL_RE.test(n(form.email)))) e.email = 'experts.err.email'
  if (n(form.phone) && !PHONE_RE.test(westernDigits(n(form.phone)))) e.phone = 'experts.err.phone'
  for (const k of ['linkedin', 'website']) {
    const u = normalizeUrl(form[k])
    if (u && (u.length > LIMITS.url || !URL_RE.test(u))) e[k] = 'experts.err.url'
  }
  for (const l of form.links ?? []) {
    const u = normalizeUrl(l.url)
    if (u && !URL_RE.test(u)) e.links = 'experts.err.url'
  }
  if ((form.links ?? []).length > LIMITS.links) e.links = 'experts.err.tooMany'
  if ((form.languages ?? []).length > LIMITS.languages) e.languages = 'experts.err.tooMany'
  if ((form.tags ?? []).length > LIMITS.tags) e.tags = 'experts.err.tooMany'
  return e
}

/**
 * Form -> the payload of create_network_expert / update_network_expert. Empty strings go as null (a cleared field is cleared). With `original` (a normalised profile) only the
 * keys that CHANGED are sent: a patch, so a field another person edited meanwhile is not overwritten by a stale copy.
 */
export function formToPayload(form, { original = null } = {}) {
  const t = (s) => {
    const v = String(s ?? '').trim()
    return v === '' ? null : v
  }
  const payload = {
    name_en: t(form.name?.en), name_ar: t(form.name?.ar),
    title_en: t(form.title?.en), title_ar: t(form.title?.ar),
    company_en: t(form.company?.en), company_ar: t(form.company?.ar),
    bio_en: t(form.bio?.en), bio_ar: t(form.bio?.ar),
    photo_path: form.photoPath || null,
    email: t(form.email) ? String(form.email).trim().toLowerCase() : null,
    phone: t(westernDigits(form.phone)),
    linkedin_url: t(normalizeUrl(form.linkedin)),
    website_url: t(normalizeUrl(form.website)),
    languages: [...new Set((form.languages ?? []).map((l) => String(l).toLowerCase()))],
    notes: t(form.notes),
    links: (form.links ?? []).map((l) => ({ kind: l.kind || 'other', url: normalizeUrl(l.url) })).filter((l) => l.url),
    tags: (form.tags ?? []).map((tg) => (tg.id ? tg.id : { name_en: t(tg.name_en), name_ar: t(tg.name_ar) })),
    kind: form.kind === 'team' ? 'team' : 'expert',
  }
  if (!original) return payload
  const before = formToPayload(formFromProfile(original))
  const patch = {}
  for (const [k, v] of Object.entries(payload)) {
    if (JSON.stringify(v) !== JSON.stringify(before[k])) patch[k] = v
  }
  return patch
}

/** Has the form changed (the unsaved-changes guard of the dialog)? */
export function isFormDirty(form, original) {
  if (original) return Object.keys(formToPayload(form, { original })).length > 0
  return JSON.stringify(formToPayload(form)) !== JSON.stringify(formToPayload(emptyExpertForm(form.kind)))
}

/** An EntityView (the Lists node's create form) -> the create payload of the registry (the same canonical fields). */
export function entityViewToPayload(view, kind = 'expert') {
  const t = (s) => {
    const v = String(s ?? '').trim()
    return v === '' ? null : v
  }
  return {
    kind,
    name_en: t(view.title?.en), name_ar: t(view.title?.ar),
    title_en: t(view.subtitle?.en), title_ar: t(view.subtitle?.ar),
    company_en: t(view.organization?.en), company_ar: t(view.organization?.ar),
    bio_en: t(view.bio?.en), bio_ar: t(view.bio?.ar),
    photo_path: view.imagePath || null,
    linkedin_url: t(normalizeUrl(view.links?.find((l) => l.kind === 'linkedin')?.url)),
    website_url: t(normalizeUrl(view.links?.find((l) => l.kind === 'website')?.url)),
    email: t(view.email) ? String(view.email).trim().toLowerCase() : null,
  }
}

// ------------------------------------------------------------------ duplicates
/** Candidates of `find_similar_network_experts` -> [{ id, score, reasons, blocking, name, title, company, photoPath, archived }] */
export function normalizeCandidate(c) {
  const e = c.expert ?? {}
  return {
    id: c.id,
    score: Number(c.score ?? 0),
    reasons: Array.isArray(c.reasons) ? c.reasons : [],
    blocking: Boolean(c.blocking ?? Number(c.score) >= BLOCKING_SCORE),
    kind: e.kind ?? 'expert',
    name: pair(e, 'name'), title: pair(e, 'title'), company: pair(e, 'company'),
    photoPath: e.photo_path ?? null,
    archived: Boolean(e.archived_at),
  }
}

/** Has the form got something worth searching duplicates for (a name of 3+ letters, an e-mail or a link)? */
export function hasDuplicateSignal(form) {
  const n = (s) => String(s ?? '').trim()
  return n(form.name?.en).length >= 3 || n(form.name?.ar).length >= 3 || EMAIL_RE.test(n(form.email)) || URL_RE.test(normalizeUrl(form.linkedin))
}

/** `list_expert_duplicate_pairs` -> [{ score, reasons, a, b }] with the same candidate shape for both sides. */
export function normalizePair(p) {
  const side = (x) => ({ id: x.id, kind: x.kind ?? 'expert', name: pair(x, 'name'), title: pair(x, 'title'), company: pair(x, 'company'), photoPath: x.photo_path ?? null, archived: Boolean(x.archived_at) })
  return { score: Number(p.score ?? 0), reasons: Array.isArray(p.reasons) ? p.reasons : [], a: side(p.a), b: side(p.b) }
}

// ------------------------------------------------------------------ merge
/** The scalar fields a merge can choose between (kept = the canonical record, other = the duplicate). */
export const MERGE_FIELDS = ['name_en', 'name_ar', 'title_en', 'title_ar', 'company_en', 'company_ar', 'bio_en', 'bio_ar', 'photo_path', 'linkedin_url', 'website_url', 'email', 'phone']

/** A normalised profile -> the raw column map the merge rows compare (the database column names). */
export function rawFields(p) {
  return {
    name_en: p?.name?.en ?? '', name_ar: p?.name?.ar ?? '', title_en: p?.title?.en ?? '', title_ar: p?.title?.ar ?? '', company_en: p?.company?.en ?? '', company_ar: p?.company?.ar ?? '',
    bio_en: p?.bio?.en ?? '', bio_ar: p?.bio?.ar ?? '', photo_path: p?.photoPath ?? '', linkedin_url: p?.linkedin ?? '', website_url: p?.website ?? '', email: p?.email ?? '', phone: p?.phone ?? '',
  }
}

/** The value of a field of a profile payload row (`get_network_expert().expert`). */
export const fieldValue = (expert, field) => text(expert?.[field]) || ''

/**
 * Side-by-side rows of the merge dialog: for every field where AT LEAST one side has a value, the two values, whether they differ, and the side the server picks by default
 * (the canonical record's value, else the other's). `choices` = { field: 'keep' | 'drop' } the user clicked.
 */
export function mergeRows(keepExpert, dropExpert, choices = {}) {
  const rows = []
  for (const field of MERGE_FIELDS) {
    const kv = fieldValue(keepExpert, field)
    const dv = fieldValue(dropExpert, field)
    if (!kv && !dv) continue
    const differs = kv !== dv
    const chosen = choices[field] === 'drop' ? (dv ? 'drop' : 'keep') : choices[field] === 'keep' ? (kv ? 'keep' : 'drop') : kv ? 'keep' : 'drop'
    rows.push({ field, keep: kv, drop: dv, differs, chosen })
  }
  return rows
}

/** The `p_fields` of merge_network_experts: ONLY the choices the user made, and only for fields where both sides have a different value (anything else is decided by the server's default). */
export function mergeChoicePayload(rows, choices = {}) {
  const out = {}
  for (const r of rows) if (r.differs && r.keep && r.drop && (choices[r.field] === 'keep' || choices[r.field] === 'drop')) out[r.field] = choices[r.field]
  return out
}

/** The blockers the server reports -> translation keys. */
export const MERGE_BLOCKERS = ['withdrawn_mismatch', 'mentor_slot_conflict', 'provider_slot_conflict', 'kind_mismatch']

// ------------------------------------------------------------------ Excel export
/** Columns of the registry export (lib/export/xlsx `exportRows` descriptor). `t` translates, `lang` names the languages and tags. Pure. */
export function exportColumns(t, lang) {
  const tags = (r) => r.tags.map((x) => tagName(x, lang)).filter(Boolean).join(', ')
  const langs = (r) => r.languages.map((c) => languageName(c, lang)).join(', ')
  return [
    { key: (r) => r.name.en, header: `${t('experts.col.name')} (EN)` },
    { key: (r) => r.name.ar, header: `${t('experts.col.name')} (AR)` },
    { key: (r) => t(`experts.kind.${r.kind}`), header: t('experts.col.kind') },
    { key: (r) => r.title.en, header: `${t('experts.field.title')} (EN)` },
    { key: (r) => r.title.ar, header: `${t('experts.field.title')} (AR)` },
    { key: (r) => r.company.en, header: `${t('experts.field.company')} (EN)` },
    { key: (r) => r.company.ar, header: `${t('experts.field.company')} (AR)` },
    { key: (r) => r.email, header: t('experts.field.email') },
    { key: (r) => r.phone, header: t('experts.field.phone') },
    { key: (r) => r.linkedin, header: t('experts.field.linkedin') },
    { key: (r) => r.website, header: t('experts.field.website') },
    { key: langs, header: t('experts.field.languages') },
    { key: tags, header: t('experts.field.tags') },
    { key: (r) => r.programs, header: t('experts.col.programs') },
    { key: (r) => r.projects, header: t('experts.col.projects') },
    { key: (r) => r.bookingSessions, header: t('experts.col.bookingSessions') },
    { key: (r) => r.distributionSessions, header: t('experts.col.distributionSessions') },
    { key: (r) => r.sessions, header: t('experts.col.sessions') },
    { key: (r) => r.firstOn ?? '', header: t('experts.col.first') },
    { key: (r) => r.lastOn ?? '', header: t('experts.col.last') },
    { key: (r) => r.notes, header: t('experts.field.notes') },
    { key: (r) => (r.archived ? t('experts.state.archived') : t('experts.state.active')), header: t('experts.col.status') },
  ]
}

/** A readable file name: `athar-network-experts-2026-10-15`. */
export const exportFileName = (date = new Date()) => `athar-network-experts-${date.toISOString().slice(0, 10)}`

// ------------------------------------------------------------------ Excel import
/** Header texts (lower-cased) accepted for each import field, English and Arabic. */
export const IMPORT_ALIASES = {
  name_en: ['name', 'name (en)', 'name_en', 'full name', 'name en', 'expert', 'الاسم بالإنجليزية'],
  name_ar: ['name (ar)', 'name_ar', 'name ar', 'الاسم', 'اسم', 'الاسم بالعربية'],
  title_en: ['title', 'job title', 'title (en)', 'title_en', 'position', 'role'],
  title_ar: ['title (ar)', 'title_ar', 'المسمى الوظيفي', 'المسمى'],
  company_en: ['company', 'organization', 'organisation', 'company (en)', 'company_en', 'affiliation'],
  company_ar: ['company (ar)', 'company_ar', 'الجهة', 'الشركة'],
  email: ['email', 'e-mail', 'mail', 'البريد', 'البريد الإلكتروني'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'الهاتف', 'الموبايل', 'رقم الهاتف'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin_url', 'لينكدإن'],
  website_url: ['website', 'url', 'site', 'website_url', 'الموقع'],
  languages: ['languages', 'language', 'اللغات', 'اللغة'],
  tags: ['tags', 'expertise', 'skills', 'topics', 'الخبرات', 'المجالات', 'الوسوم'],
  bio_en: ['bio', 'bio (en)', 'bio_en', 'about', 'description'],
  bio_ar: ['bio (ar)', 'bio_ar', 'نبذة', 'الوصف'],
  notes: ['notes', 'note', 'ملاحظات'],
}
const LANGUAGE_BY_NAME = Object.fromEntries(LANGUAGES.flatMap((l) => [[l.code, l.code], [l.en.toLowerCase(), l.code], [l.ar, l.code]]))

const splitList = (v) => String(v ?? '').split(/[,;،/|\n]+/).map((s) => s.trim()).filter(Boolean)
// a TAG may contain a slash ("Finance / Fundraising"): tags split on the other separators only
const splitTags = (v) => String(v ?? '').split(/[,;،|\n]+/).map((s) => s.trim()).filter(Boolean)

/**
 * The rows of a parsed sheet (objects keyed by header) -> the `import_network_experts` rows. A row without any name is skipped (and counted); a language column accepts codes or
 * names ("Arabic, English" / "عربي"), a tags column a list; unknown languages are dropped with a warning count. Returns { rows, skipped, unknownLanguages }.
 */
export function sheetToImportRows(sheetRows) {
  const rows = []
  let skipped = 0
  let unknownLanguages = 0
  for (const raw of sheetRows ?? []) {
    const byHeader = new Map(Object.entries(raw ?? {}).map(([h, v]) => [String(h).trim().toLowerCase(), v]))
    const row = {}
    for (const [key, aliases] of Object.entries(IMPORT_ALIASES)) {
      for (const a of aliases) {
        const v = byHeader.get(a)
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          row[key] = String(v).trim()
          break
        }
      }
    }
    if (!row.name_en && !row.name_ar) {
      if (Object.keys(row).length) skipped += 1
      continue
    }
    if (row.languages) {
      const codes = []
      for (const part of splitList(row.languages)) {
        const code = LANGUAGE_BY_NAME[part.toLowerCase()] ?? LANGUAGE_BY_NAME[part]
        if (code) codes.push(code)
        else unknownLanguages += 1
      }
      row.languages = [...new Set(codes)]
    }
    if (row.tags) row.tags = splitTags(row.tags).slice(0, LIMITS.tags)
    if (row.linkedin_url) row.linkedin_url = normalizeUrl(row.linkedin_url)
    if (row.website_url) row.website_url = normalizeUrl(row.website_url)
    if (row.phone) row.phone = westernDigits(row.phone)
    if (row.email) row.email = row.email.toLowerCase()
    rows.push(row)
  }
  return { rows, skipped, unknownLanguages }
}

/** The import preview's counts -> a one-line summary object for the dialog. */
export function importCounts(preview) {
  const c = preview?.counts ?? {}
  return { new: c.new ?? 0, duplicate: c.duplicate ?? 0, invalid: c.invalid ?? 0, created: c.created ?? 0 }
}

/** An import goes to the server in CHUNKS (each call must stay far below the 8 s API timeout); a file is read only up to this size (the parser is a third-party library). */
export const IMPORT_CHUNK = 50
export const IMPORT_MAX_ROWS = 500
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024

/** [a, b, c, d, e] with size 2 -> [[a, b], [c, d], [e]] */
export function chunkRows(rows, size = IMPORT_CHUNK) {
  const out = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/**
 * The answers of several `import_network_experts` calls (one per chunk) -> ONE answer shaped like a single call: the row indexes continue across chunks (`offsets[i]` = the number of
 * rows before chunk i), the counts are summed. `seen` (the keys of the rows so far) is what the next chunk of a PREVIEW is given so a repeat across chunks is still found.
 */
export function mergeImportResults(results, offsets) {
  const counts = { new: 0, duplicate: 0, invalid: 0, created: 0 }
  const rows = []
  results.forEach((res, i) => {
    const c = importCounts(res)
    for (const k of Object.keys(counts)) counts[k] += c[k]
    for (const r of res?.rows ?? []) rows.push({ ...r, index: (r.index ?? 0) + (offsets[i] ?? 0) })
  })
  return { counts, rows, seen: results.at(-1)?.seen ?? null }
}
