/** Pure i18n core (design 06 section 7): dictionaries, interpolation, plurals via Intl, bilingual field picking. */
export const LANGS = ['ar', 'en']
export const DEFAULT_LANG = 'ar'
export const STORAGE_KEY = 'athar.lang'

export const dirOf = (lang) => (lang === 'ar' ? 'rtl' : 'ltr')
export const isLang = (v) => LANGS.includes(v)

// namespace registry: node chunks register their own messages when they load
const messages = { ar: {}, en: {} }
const listeners = new Set()
let version = 0

export function registerMessages(namespace, dict) {
  for (const lang of LANGS) {
    const src = dict?.[lang]
    if (!src) continue
    for (const [k, v] of Object.entries(src)) messages[lang][`${namespace}.${k}`] = v
  }
  version += 1
  listeners.forEach((l) => l())
}

/** Register already-prefixed (flat dotted) dictionaries, e.g. the base app dictionary. */
export function registerFlat(dict) {
  for (const lang of LANGS) Object.assign(messages[lang], dict?.[lang] ?? {})
  version += 1
  listeners.forEach((l) => l())
}

export const subscribeMessages = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const getMessagesVersion = () => version
export const getMessages = (lang) => messages[lang]

function interpolate(template, vars) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined || vars[name] === null ? m : String(vars[name])))
}

/** Missing key -> English fallback -> the key itself (with a dev warning from the provider). */
export function translate(lang, key, vars, onMissing) {
  const hit = messages[lang]?.[key]
  if (typeof hit === 'string') return interpolate(hit, vars)
  const fallback = messages.en?.[key]
  if (typeof fallback === 'string') {
    onMissing?.(key, lang)
    return interpolate(fallback, vars)
  }
  onMissing?.(key, lang)
  return key
}

/** Plural: dictionary entry is an object keyed by Intl.PluralRules categories (zero/one/two/few/many/other). */
export function translatePlural(lang, key, count, vars, onMissing) {
  const entry = messages[lang]?.[key] ?? messages.en?.[key]
  if (entry && typeof entry === 'object') {
    const cat = new Intl.PluralRules(lang).select(count)
    const template = entry[cat] ?? entry.other
    if (typeof template === 'string') return interpolate(template, { count: formatNumber(lang, count), ...vars })
  }
  return translate(lang, key, { count: formatNumber(lang, count), ...vars }, onMissing)
}

/** OD-12 recommendation: Western digits in the Arabic UI. */
export const numberLocale = (lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US')

export function formatNumber(lang, value, opts) {
  return new Intl.NumberFormat(numberLocale(lang), opts).format(value)
}

export function formatDate(lang, value, opts = { dateStyle: 'medium' }) {
  if (value === null || value === undefined || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(numberLocale(lang), opts).format(d)
}

/** pick({name, name_ar}, 'name', 'ar') -> localized value with fallback to the other language. */
export function pick(obj, base, lang) {
  if (!obj) return ''
  const en = obj[`${base}_en`] ?? obj[base]
  const ar = obj[`${base}_ar`]
  const first = lang === 'ar' ? ar : en
  const second = lang === 'ar' ? en : ar
  return (first && String(first).trim()) || (second && String(second).trim()) || ''
}

/** Localised {en, ar} literal object (manifest names etc.). */
export function pickLiteral(literal, lang) {
  if (!literal) return ''
  if (typeof literal === 'string') return literal
  return literal[lang] || literal[lang === 'ar' ? 'en' : 'ar'] || ''
}

const STAFF_PREFIXES = ['/programs', '/projects', '/network', '/library', '/form-library', '/team', '/profile', '/dev']

/** Default language per area: staff app English, public/founder/auth Arabic (06 section 7.1). */
export function defaultLangForPath(pathname = '/') {
  return STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ? 'en' : 'ar'
}

/** Resolution order: ?lang= (not persisted) -> stored choice -> default by area. */
export function resolveLang({ search = '', stored = null, pathname = '/' }) {
  const fromUrl = new URLSearchParams(search).get('lang')
  if (isLang(fromUrl)) return { lang: fromUrl, source: 'url' }
  if (isLang(stored)) return { lang: stored, source: 'stored' }
  return { lang: defaultLangForPath(pathname), source: 'default' }
}
