import { CARD_FIELDS } from '../../lib/entities.js'

/**
 * Pure helpers for the List node config (`nodes.config`, design 01 section 3.3 shape, trimmed to what the DB resolver
 * and the public payload honour). Shape:
 * {
 *   card: { showFields: CARD_FIELDS[], accent: '#rrggbb'|null, expandable: bool, hideTitleOnSingle: bool },
 *   statuses: [{ key, label: {en, ar}, tone }],         // vocabulary of list_items.status for THIS list (none = free)
 *   overlayFields: [{ key, label: {en, ar}, type }],    // custom overlay columns (02 section 3.4), PM-only
 * }
 * The list subkind (expert | company | generic) lives in `lists.subkind` (immutable), not in the config.
 */
export const STATUS_TONES = ['neutral', 'blue', 'green', 'amber', 'red', 'purple']
export const OVERLAY_FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'link', 'select']
export const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/

export const DEFAULT_CARD = { showFields: [...CARD_FIELDS], accent: null, expandable: true, hideTitleOnSingle: true }

export const defaultListConfig = () => ({ card: { ...DEFAULT_CARD, showFields: [...CARD_FIELDS] }, statuses: [], overlayFields: [] })

const text = (v) => (v === null || v === undefined ? '' : String(v))
const label = (l) => ({ en: text(l?.en), ar: text(l?.ar) })

/** Tolerant read of a stored config (migrated lists have `{}`; unknown keys are kept for forward compatibility). */
export function normalizeListConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const card = c.card && typeof c.card === 'object' ? c.card : {}
  const showFields = Array.isArray(card.showFields) ? card.showFields.filter((f) => CARD_FIELDS.includes(f)) : [...CARD_FIELDS]
  return {
    ...c,
    card: {
      showFields,
      accent: typeof card.accent === 'string' && /^#[0-9a-f]{6}$/i.test(card.accent) ? card.accent.toLowerCase() : null,
      expandable: card.expandable !== false,
      hideTitleOnSingle: card.hideTitleOnSingle !== false,
    },
    // rows with an empty key are kept (the Settings draft adds them empty; validateListConfig rejects them at save)
    statuses: (Array.isArray(c.statuses) ? c.statuses : [])
      .filter((s) => s && typeof s.key === 'string')
      .map((s) => ({ key: s.key, label: label(s.label), tone: STATUS_TONES.includes(s.tone) ? s.tone : 'neutral' })),
    overlayFields: (Array.isArray(c.overlayFields) ? c.overlayFields : [])
      .filter((f) => f && typeof f.key === 'string')
      .map((f) => ({ key: f.key, label: label(f.label), type: OVERLAY_FIELD_TYPES.includes(f.type) ? f.type : 'text', options: Array.isArray(f.options) ? f.options.map(text) : [] })),
  }
}

/** Validation of the Settings draft: returns { field: messageKey }. */
export function validateListConfig(config) {
  const errors = {}
  const keys = new Set()
  for (const s of config.statuses ?? []) {
    if (!KEY_RE.test(s.key)) errors.statuses = 'list.settings.keyInvalid'
    else if (keys.has(s.key)) errors.statuses = 'list.settings.keyDuplicate'
    keys.add(s.key)
  }
  const fkeys = new Set()
  for (const f of config.overlayFields ?? []) {
    if (!KEY_RE.test(f.key) || ['status', 'notes', 'card', 'display_override'].includes(f.key)) errors.overlayFields = 'list.settings.keyInvalid'
    else if (fkeys.has(f.key)) errors.overlayFields = 'list.settings.keyDuplicate'
    fkeys.add(f.key)
  }
  if (!config.card?.showFields?.length) errors.card = 'list.settings.showFieldsEmpty'
  return errors
}

/** Status definition for a stored value (unknown values are shown as-is in a neutral badge). */
export function statusOf(config, key) {
  if (!key) return null
  return (config?.statuses ?? []).find((s) => s.key === key) ?? { key, label: { en: key, ar: key }, tone: 'neutral' }
}

/** "key" -> a readable default label ("on_hold" -> "On hold"). */
export const humanizeKey = (k) => String(k ?? '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
