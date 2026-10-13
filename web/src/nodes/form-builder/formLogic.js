/**
 * Pure logic of the Form Builder node (design 01 section 3.2, 04 section 3.7): question/section models, keys and
 * semantic roles (the `field_semantics` seed the list resolver reads: company_name, founder_name, founder_email, phone,
 * logo, bio), config normalisation, respondent validation/sanitisation, wizard steps, thank-you tokens, template
 * conversion (library), analytics helpers. No React, no data access: unit-tested on its own.
 */
import { isEmail, validatePhone } from '../../lib/contact.js'
import { newId } from '../../lib/id.js'

export const QUESTION_TYPES = ['text', 'textarea', 'email', 'tel', 'number', 'url', 'select', 'multiselect', 'date', 'file', 'hidden']
export const SEMANTICS = ['company_name', 'founder_name', 'founder_email', 'phone', 'logo', 'bio']
/** Question types a semantic role accepts (a role is only offered on compatible types). */
export const SEMANTIC_TYPES = {
  company_name: ['text'], founder_name: ['text'], founder_email: ['email'], phone: ['tel'], logo: ['file', 'url'], bio: ['textarea', 'text'],
}
/** Semantic roles the Lists node needs for a card title/subtitle (shown as "recommended"). */
export const SEMANTICS_RECOMMENDED = ['company_name', 'founder_name', 'founder_email']
export const SOCIAL_PLATFORMS = ['facebook', 'whatsapp', 'linkedin', 'telegram', 'instagram']
/** Platforms with a share intent URL (Instagram has none: it is a source-tracking channel only, docs/04 A-13). */
export const SHARE_PLATFORMS = ['whatsapp', 'facebook', 'linkedin', 'telegram']
export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/
export const DEFAULT_COUNTRIES = ['EG', 'SA', 'AE']

const text = (v) => (v === null || v === undefined ? '' : String(v))
const bi = (v) => (v && typeof v === 'object' ? { en: text(v.en), ar: text(v.ar) } : { en: text(v), ar: '' })
const biCols = (row, base) => ({ en: text(row?.[`${base}_en`]), ar: text(row?.[`${base}_ar`]) })
const nn = (s) => (text(s).trim() ? text(s).trim() : null)
const numOrNull = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

export { newId }

// ------------------------------------------------------------------ config (nodes.config)
export const defaultFormConfig = () => ({
  description: { en: '', ar: '' },
  thank_you: { message: { en: '', ar: '' }, image_path: null, show_image: true },
  social: { facebook: true, whatsapp: true, linkedin: true, telegram: true, instagram: true, custom: [] },
  share: { title: '', description: '', image_path: null },
  notify_pm: false,
})

/** Tolerant read of a stored config (migrated forms carry `social`, `thank_you.show_image`, a legacy `show_in_card`). */
export function normalizeFormConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const d = defaultFormConfig()
  const ty = c.thank_you && typeof c.thank_you === 'object' ? c.thank_you : {}
  const social = c.social && typeof c.social === 'object' ? c.social : {}
  const share = c.share && typeof c.share === 'object' ? c.share : {}
  const out = {
    ...c,
    description: bi(c.description),
    thank_you: { message: bi(ty.message), image_path: nn(ty.image_path), show_image: ty.show_image !== false },
    social: {
      ...Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, social[p] !== false])),
      custom: (Array.isArray(social.custom) ? social.custom : []).filter((x) => x && typeof x.key === 'string').map((x) => ({ key: x.key, label: text(x.label), active: x.active !== false })),
    },
    share: { title: text(share.title), description: text(share.description), image_path: nn(share.image_path) },
    notify_pm: c.notify_pm === true,
  }
  delete out.show_in_card // legacy copy of the list card config (docs/04): the List node owns card fields now
  return { ...d, ...out }
}

// ------------------------------------------------------------------ questions / sections
export const emptyQuestion = (type = 'text', overrides = {}) => ({
  id: newId(), section_id: null, key: '', type, semantic: null,
  label: { en: '', ar: '' }, description: { en: '', ar: '' }, placeholder: { en: '', ar: '' },
  required: false, options: [], validation: { minLength: null, maxLength: null, min: null, max: null, pattern: '', customError: { en: '', ar: '' }, allowedCountries: [...DEFAULT_COUNTRIES] },
  order_index: 0, ...overrides,
})
export const emptySection = (overrides = {}) => ({ id: newId(), title: { en: '', ar: '' }, description: { en: '', ar: '' }, order_index: 0, ...overrides })
export const emptyOption = (value = '') => ({ value, label: { en: value, ar: '' }, is_other: false })

function normalizeOptions(raw) {
  const list = Array.isArray(raw) ? raw : []
  return list
    .map((o) => {
      if (o === null || o === undefined) return null
      if (typeof o !== 'object') return { value: text(o), label: { en: text(o), ar: '' }, is_other: false }
      const value = text(o.value ?? o.label_en ?? o.label)
      return { value, label: { en: text(o.label_en ?? (typeof o.label === 'object' ? o.label?.en : o.label) ?? value), ar: text(o.label_ar ?? (typeof o.label === 'object' ? o.label?.ar : '')) }, is_other: Boolean(o.is_other) }
    })
    .filter((o) => o && o.value !== '')
}

/** validation jsonb (new or legacy camelCase `minValue/maxValue/customError` string) -> client shape. */
export function normalizeValidation(raw, type) {
  const v = raw && typeof raw === 'object' ? raw : {}
  const countries = Array.isArray(v.allowed_countries ?? v.allowedCountries) ? (v.allowed_countries ?? v.allowedCountries).map((c) => String(c).toUpperCase()) : [...DEFAULT_COUNTRIES]
  return {
    minLength: numOrNull(v.minLength), maxLength: numOrNull(v.maxLength),
    min: numOrNull(v.min ?? v.minValue), max: numOrNull(v.max ?? v.maxValue),
    pattern: text(v.pattern),
    customError: bi(v.customError),
    allowedCountries: type === 'tel' && countries.length ? countries : countries,
  }
}

/** form_questions row -> client question. */
export function fromQuestionRow(row) {
  const type = QUESTION_TYPES.includes(row?.type) ? row.type : 'text'
  return {
    id: row.id, section_id: row.section_id ?? null, key: text(row.key), type, semantic: SEMANTICS.includes(row.semantic) ? row.semantic : null,
    label: biCols(row, 'label'), description: biCols(row, 'description'), placeholder: biCols(row, 'placeholder'),
    required: Boolean(row.is_required), options: normalizeOptions(row.options), validation: normalizeValidation(row.validation, type), order_index: row.order_index ?? 0,
  }
}

/** client question -> form_questions row for save_children_form_builder (nulls for empty strings). */
export function toQuestionRow(q, index) {
  const v = q.validation ?? {}
  const validation = {
    minLength: numOrNull(v.minLength), maxLength: numOrNull(v.maxLength), min: numOrNull(v.min), max: numOrNull(v.max),
    pattern: nn(v.pattern), customError: v.customError?.en?.trim() || v.customError?.ar?.trim() ? { en: text(v.customError.en).trim(), ar: text(v.customError.ar).trim() } : null,
    allowed_countries: q.type === 'tel' ? (Array.isArray(v.allowedCountries) && v.allowedCountries.length ? v.allowedCountries : [...DEFAULT_COUNTRIES]) : null,
  }
  for (const k of Object.keys(validation)) if (validation[k] === null) delete validation[k]
  const hasOptions = q.type === 'select' || q.type === 'multiselect'
  return {
    id: q.id, section_id: q.section_id || null, key: q.key, type: q.type, semantic: q.semantic || null,
    label_en: nn(q.label?.en), label_ar: nn(q.label?.ar), description_en: nn(q.description?.en), description_ar: nn(q.description?.ar),
    placeholder_en: nn(q.placeholder?.en), placeholder_ar: nn(q.placeholder?.ar), is_required: Boolean(q.required),
    options: hasOptions ? (q.options ?? []).filter((o) => text(o.value).trim()).map((o) => ({ value: text(o.value).trim(), label_en: nn(o.label?.en) ?? text(o.value).trim(), label_ar: nn(o.label?.ar), is_other: Boolean(o.is_other) })) : null,
    validation: Object.keys(validation).length ? validation : null,
    order_index: index ?? q.order_index ?? 0,
  }
}

export const fromSectionRow = (row) => ({ id: row.id, title: biCols(row, 'title'), description: biCols(row, 'description'), order_index: row.order_index ?? 0 })
export const toSectionRow = (s, index) => ({ id: s.id, title_en: nn(s.title?.en), title_ar: nn(s.title?.ar), description_en: nn(s.description?.en), description_ar: nn(s.description?.ar), order_index: index ?? s.order_index ?? 0 })

/** The children payload of save_node (sections first, questions in display order). */
export function toChildren({ sections, questions, form }) {
  return {
    ...(form ? { form } : {}),
    sections: (sections ?? []).map((s, i) => toSectionRow(s, i)),
    questions: (questions ?? []).map((q, i) => toQuestionRow(q, i)),
  }
}

// ------------------------------------------------------------------ keys and semantic roles
/** Stable key from a label: ascii slug of the English label (max 40; Arabic parts ignored), else q_<n>. Unique among `taken`. */
export function keyFromLabel(label, taken = [], fallbackIndex = 1) {
  const src = text(typeof label === 'object' ? label?.en : label).trim()
  let base = src ? src.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '').slice(0, 40).replace(/_+$/, '') : ''
  if (!base) base = `q_${fallbackIndex}`
  if (!KEY_RE.test(base)) base = `q_${fallbackIndex}`
  const used = new Set(taken)
  let key = base
  let n = 2
  while (used.has(key) || SEMANTICS.includes(key)) {
    key = `${base.slice(0, 36)}_${n}`
    n += 1
  }
  return key
}

const SEMANTIC_KEYWORDS = {
  founder_email: [/e-?mail/i, /بريد/],
  phone: [/\bphone\b/i, /\bmobile\b/i, /whats ?app/i, /\btel\b/i, /هاتف/, /محمول/, /جوال/, /موبايل/, /واتس/],
  company_name: [/\b(company|startup|business|project|organi[sz]ation)\s*(name)?\b/i, /اسم\s*(الشركة|المشروع|الستارت|المؤسسة)/, /الشركة/, /المشروع/],
  founder_name: [/\b(founder|your|full|first|applicant|contact|owner|ceo)\s*(name)\b/i, /^name$/i, /\bfull name\b/i, /اسم(ك| المؤسس| المتقدم| صاحب)/, /الاسم (الكامل|بالكامل|الثلاثي|رباعي)/, /^الاسم$/],
  logo: [/\blogo\b/i, /شعار/, /لوجو/],
  bio: [/\b(bio|about|describe|description|what (does|do) your)\b/i, /نبذة/, /وصف/, /صِف/, /اشرح/],
}

/** Suggest a semantic role from the label (both languages) and, when given, the type. Null when unsure. */
export function suggestSemantic(label, type = null, taken = []) {
  const hay = `${text(label?.en)} ${text(label?.ar)}`.trim()
  if (!hay) return null
  const order = ['founder_email', 'phone', 'logo', 'company_name', 'founder_name', 'bio']
  for (const sem of order) {
    if (taken.includes(sem)) continue
    if (type && !SEMANTIC_TYPES[sem].includes(type)) continue
    if (SEMANTIC_KEYWORDS[sem].some((re) => re.test(hay))) return sem
  }
  return null
}

/** Assign (or clear) a semantic role: the key becomes the role (DB CHECK key = semantic), clearing keeps the key. */
export function applySemantic(question, semantic) {
  if (!semantic) return { ...question, semantic: null }
  return { ...question, semantic, key: semantic }
}

/** Default question type for a semantic role. */
export const typeForSemantic = (semantic) => SEMANTIC_TYPES[semantic]?.[0] ?? 'text'

// ------------------------------------------------------------------ definition validation (builder save)
export function validateDefinition({ questions = [] }) {
  const errors = {}
  const keys = new Set()
  const sems = new Set()
  for (const q of questions) {
    const e = []
    if (!q.label?.en?.trim() && !q.label?.ar?.trim()) e.push('form.err.labelRequired')
    if (!KEY_RE.test(q.key ?? '')) e.push('form.err.keyInvalid')
    else if (keys.has(q.key)) e.push('form.err.keyDuplicate')
    keys.add(q.key)
    if (q.semantic) {
      if (sems.has(q.semantic)) e.push('form.err.semanticDuplicate')
      if (!SEMANTIC_TYPES[q.semantic]?.includes(q.type)) e.push('form.err.semanticType')
      if (q.key !== q.semantic) e.push('form.err.semanticKey')
      sems.add(q.semantic)
    }
    if ((q.type === 'select' || q.type === 'multiselect') && !(q.options ?? []).some((o) => text(o.value).trim())) e.push('form.err.optionsRequired')
    if (e.length) errors[q.id] = e
  }
  return errors
}

// ------------------------------------------------------------------ respondent side
/** Wizard steps: no sections = one step; else the sorted sections, with a synthetic first step for orphan questions. */
export function buildSteps(sections = [], questions = []) {
  const qs = [...questions].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
  const visible = qs.filter((q) => q.type !== 'hidden')
  if (!sections.length) return [{ id: 'all', title: null, description: null, questions: visible }]
  const ids = new Set(sections.map((s) => s.id))
  const orphans = visible.filter((q) => !q.section_id || !ids.has(q.section_id))
  const steps = [...sections].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((s) => ({ id: s.id, title: s.title, description: s.description, questions: visible.filter((q) => q.section_id === s.id) }))
  if (orphans.length) steps.unshift({ id: 'general', title: null, description: null, questions: orphans, general: true })
  return steps.filter((s) => s.questions.length)
}

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isEmptyAnswer = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)

/** One answer -> { key: messageKey, vars } or null. `customError` (if set) replaces every message except "required". */
export function validateAnswer(q, value, lang = 'en') {
  const custom = q.validation?.customError?.[lang]?.trim() || q.validation?.customError?.en?.trim() || q.validation?.customError?.ar?.trim() || null
  const fail = (key, vars) => (custom ? { key: null, text: custom } : { key, vars })
  if (isEmptyAnswer(value)) return q.required && q.type !== 'hidden' ? { key: 'form.err.required' } : null
  const v = q.validation ?? {}
  const s = typeof value === 'string' ? value.trim() : value
  switch (q.type) {
    case 'text': case 'textarea': case 'hidden': {
      const len = String(s).length
      if (v.minLength != null && len < v.minLength) return fail('form.err.minLength', { n: v.minLength })
      if (v.maxLength != null && len > v.maxLength) return fail('form.err.maxLength', { n: v.maxLength })
      if (v.pattern) {
        try {
          if (!new RegExp(v.pattern).test(String(s))) return fail('form.err.pattern')
        } catch {
          /* bad pattern configured: ignore */
        }
      }
      return null
    }
    case 'email': return isEmail(s) ? null : fail('form.err.email')
    case 'tel': {
      const r = validatePhone(String(s), v.allowedCountries ?? DEFAULT_COUNTRIES)
      return r.valid ? null : fail(r.errorKey ?? 'phone.general')
    }
    case 'number': {
      const n = Number(s)
      if (!Number.isFinite(n)) return fail('form.err.number')
      if (v.min != null && n < v.min) return fail('form.err.min', { n: v.min })
      if (v.max != null && n > v.max) return fail('form.err.max', { n: v.max })
      return null
    }
    case 'url': return URL_RE.test(/^https?:\/\//i.test(String(s)) ? String(s) : `https://${s}`) ? null : fail('form.err.url')
    case 'date': return DATE_RE.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : fail('form.err.date')
    case 'select': {
      const other = (q.options ?? []).some((o) => o.is_other)
      const known = (q.options ?? []).some((o) => o.value === s)
      return known || other ? null : fail('form.err.option')
    }
    case 'multiselect': {
      const arr = Array.isArray(s) ? s : [s]
      const other = (q.options ?? []).some((o) => o.is_other)
      return arr.every((x) => (q.options ?? []).some((o) => o.value === x) || other) ? null : fail('form.err.option')
    }
    case 'file': return null
    default: return null
  }
}

export function validateAnswers(questions, answers, lang = 'en') {
  const errors = {}
  for (const q of questions) {
    const e = validateAnswer(q, answers?.[q.key], lang)
    if (e) errors[q.key] = e
  }
  return errors
}

/** Answers as sent to the RPC: trimmed, phones in E.164 by the DECLARED type (docs/04 A-9), empties dropped. */
export function cleanAnswers(questions, answers) {
  const out = {}
  for (const q of questions) {
    const raw = answers?.[q.key]
    if (isEmptyAnswer(raw)) continue
    switch (q.type) {
      case 'tel': {
        const r = validatePhone(String(raw), q.validation?.allowedCountries ?? DEFAULT_COUNTRIES)
        out[q.key] = r.valid && r.sanitized ? r.sanitized : String(raw).trim()
        break
      }
      case 'email': out[q.key] = String(raw).trim().toLowerCase(); break
      case 'number': out[q.key] = Number(raw); break
      case 'url': out[q.key] = /^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : `https://${String(raw).trim()}`; break
      case 'multiselect': out[q.key] = [...new Set((Array.isArray(raw) ? raw : [raw]).map((x) => String(x).trim()).filter(Boolean))]; break
      default: out[q.key] = typeof raw === 'string' ? raw.trim() : raw
    }
  }
  return out
}

/** Server field error (hint form_invalid, detail "<key>:<reason>") -> { key, reason }. */
export function parseServerFieldError(detail) {
  const m = /^([^:]+):([a-zA-Z]+)$/.exec(String(detail ?? ''))
  if (!m) return null
  const map = { required: 'form.err.required', email: 'form.err.email', phone: 'phone.general', number: 'form.err.number', min: 'form.err.min', max: 'form.err.max', minLength: 'form.err.minLength', maxLength: 'form.err.maxLength', url: 'form.err.url', date: 'form.err.date', option: 'form.err.option', file: 'form.err.file', unknown: 'form.err.unknownKey' }
  return { key: m[1], reason: m[2], messageKey: map[m[2]] ?? 'errors.validation' }
}

/** Semantic answers of one response: { title, subtitle, email, phone, logo, bio } (fallback: the first text answer). */
export function responseDisplay(answers = {}, questions = []) {
  const bySem = (sem) => {
    const q = questions.find((x) => x.semantic === sem)
    const v = q ? answers[q.key] : answers[sem]
    return v === null || v === undefined ? '' : String(v)
  }
  let title = bySem('company_name')
  if (!title) {
    const first = questions.find((q) => ['text'].includes(q.type) && !isEmptyAnswer(answers[q.key]))
    title = first ? String(answers[first.key]) : ''
  }
  return { title, subtitle: bySem('founder_name'), email: bySem('founder_email'), phone: bySem('phone'), logo: bySem('logo'), bio: bySem('bio') }
}

/** Thank-you text with {name} {company} {email} {phone} (and {{..}} / Arabic legacy tokens) replaced safely. */
export function renderThankYou(template, answers = {}, questions = []) {
  const d = responseDisplay(answers, questions)
  const map = { name: d.subtitle || d.title, company: d.title, email: d.email, phone: d.phone, 'اسم_المشارك': d.subtitle || d.title, 'اسم_الشركة': d.title, 'البريد_الإلكتروني': d.email, 'رقم_الهاتف': d.phone }
  let out = text(template)
  for (const [k, v] of Object.entries(map)) out = out.split(`{{${k}}}`).join(v).split(`{${k}}`).join(v)
  return out.replace(/\{\{?[a-zA-Z_؀-ۿ]+\}?\}/g, '').replace(/\s{2,}/g, ' ').trim()
}

/** Display string of one answer (tables, drawer, export). */
export function formatAnswer(q, value, lang = 'en') {
  if (isEmptyAnswer(value)) return ''
  if (q?.type === 'select' || q?.type === 'multiselect') {
    const arr = Array.isArray(value) ? value : [value]
    return arr.map((v) => {
      const o = (q.options ?? []).find((x) => x.value === v)
      return o ? (lang === 'ar' ? o.label.ar || o.label.en : o.label.en || o.label.ar) || v : v
    }).join(', ')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Tracking payload from the public URL (04 section 3.7: whitelisted keys). */
export function trackingFromSearch(search = '', { referrer = '', lang = '' } = {}) {
  const p = new URLSearchParams(search)
  const get = (k) => p.get(k)?.trim().slice(0, 64) || undefined
  const t = { source: get('source') ?? get('utm_source') ?? get('channel') ?? get('ref') ?? get('from'), utm_source: get('utm_source'), utm_medium: get('utm_medium'), utm_campaign: get('utm_campaign'), utm_content: get('utm_content'), referrer: referrer ? String(referrer).slice(0, 200) : undefined, lang: lang || undefined }
  for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k]
  return t
}

/** Hidden questions take their value from the URL (?key=value), as the old portal did (docs/04 section 4.3). */
export function prefillFromSearch(questions, search = '') {
  const p = new URLSearchParams(search)
  const out = {}
  for (const q of questions) if (q.type === 'hidden' && p.has(q.key)) out[q.key] = p.get(q.key).slice(0, 500)
  return out
}

/** The public URL of a form with a `source` tag (source-tracking links of the old SourceTrackingToolbar). */
export const withSource = (url, source) => (source ? `${url}${url.includes('?') ? '&' : '?'}source=${encodeURIComponent(source)}` : url)

// ------------------------------------------------------------------ responses: analytics + export
/** [{ date: 'YYYY-MM-DD', count }] for the last `days` days (today included), ascending; dates in `tz` (project zone). */
export function countsByDay(responses, { days = 30, now = new Date(), tz = 'UTC' } = {}) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dayOf = (d) => fmt.format(d)
  const counts = new Map()
  for (const r of responses ?? []) {
    const d = new Date(r.submitted_at)
    if (Number.isNaN(d.getTime())) continue
    const k = dayOf(d)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const out = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86400000)
    const k = dayOf(d)
    out.push({ date: k, count: counts.get(k) ?? 0 })
  }
  return out
}

/** [{ key, count }] sorted by count desc; `pick(row)` chooses the grouping value ('' -> 'direct'). */
export function countsBy(rows, pick, fallback = 'direct') {
  const m = new Map()
  for (const r of rows ?? []) {
    const k = text(pick(r)).trim() || fallback
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

/** Excel columns for responses (lib/export/xlsx exportRows descriptor). */
export function responseColumns(questions, lang, t, { tz } = {}) {
  const cols = [
    { key: (r) => r.submitted_at, header: t('form.responses.col.submitted'), format: (v) => (v ? new Intl.DateTimeFormat('en-GB', { timeZone: tz ?? 'UTC', dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '') },
    { key: (r) => r.status, header: t('form.responses.col.status') },
    { key: (r) => r.source ?? '', header: t('form.responses.col.source') },
  ]
  for (const q of questions) cols.push({ key: (r) => formatAnswer(q, r.answers?.[q.key], lang), header: (lang === 'ar' ? q.label.ar || q.label.en : q.label.en || q.label.ar) || q.key })
  cols.push(
    { key: (r) => r.tracking?.utm_medium ?? '', header: 'utm_medium' },
    { key: (r) => r.tracking?.utm_campaign ?? '', header: 'utm_campaign' },
    { key: (r) => r.tracking?.referrer ?? '', header: t('form.responses.col.referrer') },
  )
  return cols
}

/** Case-insensitive search over all answer values + source. */
export function responseMatches(r, term) {
  const q = text(term).trim().toLowerCase()
  if (!q) return true
  const vals = Object.values(r.answers ?? {}).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')))
  return [...vals, r.source ?? ''].some((s) => s.toLowerCase().includes(q))
}

// ------------------------------------------------------------------ templates (form_templates.definition)
export const TEMPLATE_SCHEMA_VERSION = 2

/** Draft -> portable definition (no ids; sections referenced by index). */
export function templateFromDraft({ config, sections = [], questions = [] }) {
  const sIndex = new Map(sections.map((s, i) => [s.id, i]))
  return {
    schema_version: TEMPLATE_SCHEMA_VERSION,
    settings: normalizeFormConfig(config),
    sections: sections.map((s, i) => ({ ref: i, ...toSectionRow(s, i), id: undefined })),
    questions: questions.map((q, i) => ({ ...toQuestionRow(q, i), id: undefined, section_id: undefined, section_ref: q.section_id != null && sIndex.has(q.section_id) ? sIndex.get(q.section_id) : null })),
  }
}

/** Legacy question object of the old library (`field_name`, `field_type`, `validation_rules`...) -> row-like object. */
function legacyQuestionToRow(lq, i) {
  const type = lq.field_type === 'phone' ? 'tel' : QUESTION_TYPES.includes(lq.field_type) ? lq.field_type : 'text'
  const vr = lq.validation_rules && typeof lq.validation_rules === 'object' ? lq.validation_rules : {}
  const opts = Array.isArray(lq.field_options) ? lq.field_options.map((o) => (typeof o === 'object' ? { value: o.value ?? o.label, label_en: o.label ?? o.value, is_other: Boolean(o.is_other) } : { value: String(o), label_en: String(o) })) : []
  return {
    key: null, type, semantic: null, label_en: lq.field_label ?? lq.label ?? null, label_ar: lq.field_label_ar ?? null,
    description_en: lq.description || lq.help_text || null, placeholder_en: lq.placeholder || null, is_required: Boolean(lq.is_required),
    options: opts, validation: { minLength: vr.minLength, maxLength: vr.maxLength, min: vr.minValue ?? vr.min, max: vr.maxValue ?? vr.max, customError: vr.customError, allowed_countries: vr.allowed_countries },
    order_index: lq.display_order ?? i, section_ref: null, legacy_section: vr.section_id ?? lq.section_id ?? null,
  }
}

/** Definition (v2 or legacy library shape) -> fresh draft { config, sections, questions } with NEW ids. */
export function draftFromTemplate(definition) {
  const def = definition && typeof definition === 'object' ? definition : {}
  const legacy = !Array.isArray(def.sections) && Array.isArray(def.questions) && def.questions.some((q) => q && 'field_name' in q)
  const config = normalizeFormConfig(def.settings)
  const sections = []
  const sectionByRef = new Map()
  if (Array.isArray(def.sections)) {
    def.sections.forEach((s, i) => {
      const sec = { ...fromSectionRow({ ...s, id: newId() }), order_index: i }
      sections.push(sec)
      sectionByRef.set(s.ref ?? i, sec.id)
    })
  }
  const legacySections = new Map()
  const rows = (Array.isArray(def.questions) ? def.questions : []).map((q, i) => (legacy ? legacyQuestionToRow(q, i) : { ...q }))
  const taken = []
  const questions = rows.map((row, i) => {
    let sectionId = null
    if (row.section_ref != null && sectionByRef.has(row.section_ref)) sectionId = sectionByRef.get(row.section_ref)
    else if (row.legacy_section) {
      if (!legacySections.has(row.legacy_section)) {
        const sec = emptySection({ title: { en: `Section ${legacySections.size + 1}`, ar: `القسم ${legacySections.size + 1}` }, order_index: sections.length })
        sections.push(sec)
        legacySections.set(row.legacy_section, sec.id)
      }
      sectionId = legacySections.get(row.legacy_section)
    }
    const q = fromQuestionRow({ ...row, id: newId(), section_id: sectionId, order_index: i })
    if (!KEY_RE.test(q.key) || taken.includes(q.key)) q.key = keyFromLabel(q.label, taken, i + 1)
    if (q.semantic) q.key = q.semantic
    taken.push(q.key)
    return q
  })
  return { config, sections, questions }
}

/** Reorder helper: move item at `from` to `to` inside a list, returning a new array with order_index renumbered. */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it)
  return next.map((x, i) => ({ ...x, order_index: i }))
}

/** Duplicate a question right after itself with a fresh id, a unique key and no semantic (roles are unique). */
export function duplicateQuestion(list, id) {
  const i = list.findIndex((q) => q.id === id)
  if (i < 0) return list
  const src = list[i]
  const copy = { ...src, id: newId(), semantic: null, key: keyFromLabel(src.label, list.map((q) => q.key), list.length + 1), label: { en: src.label.en ? `${src.label.en} (copy)` : '', ar: src.label.ar ? `${src.label.ar} (نسخة)` : '' }, options: (src.options ?? []).map((o) => ({ ...o, label: { ...o.label } })), validation: { ...src.validation, customError: { ...src.validation?.customError }, allowedCountries: [...(src.validation?.allowedCountries ?? [])] } }
  const next = [...list]
  next.splice(i + 1, 0, copy)
  return next.map((x, k) => ({ ...x, order_index: k }))
}
