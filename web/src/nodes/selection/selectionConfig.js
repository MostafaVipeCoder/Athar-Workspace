import { CARD_FIELDS, biPick, isActiveItem } from '../../lib/entities.js'
import { firstName } from '../../lib/contact.js'
import { renderTemplate, sanitizePreviewHtml, unknownPlaceholders as unknownTokens } from '../../lib/email.js'

/**
 * Pure helpers for the Selection node config (`nodes.config`, design 01 section 3.4 shape, trimmed to what the DB
 * helpers honour: `app_private.selection_stage_keys / selection_passing / selection_port_statuses / selection_enrolls`
 * and `send_selection_emails`). Shape:
 * {
 *   stages: [{ key, label:{en,ar}, type: 'inbox'|'stage'|'accept'|'hold'|'reject', tone, email: null|'interview'|'acceptance'|'rejection', requireReason }],
 *   passing: [keys of the `accept` stages],                       // read by the DB (approved port, participants)
 *   participantRule: { onAccept: 'none'|'create_participant' },   // 02 section 7.3 step 1 (the stage's enrol toggle)
 *   emails: { acceptance|rejection|interview: { enabled, subject, body_html, subject_ar, body_html_ar, cc[], admin[] } },
 *   interviewBooking: { linkedBookingNodeId: uuid|null },         // override of the edge-derived Booking node
 *   card: { showFields, accent },                                 // the results tab (view port) card
 *   sheetImport: kept untouched (migrated, never rendered: 01-9 / 08 open decision)
 * }
 * The migrated statuses are exactly the default vocabulary (screening / interview / holding / accepted / rejected,
 * decision 01-16 mapped displayed -> accepted; `overlay.legacy_status` keeps the migration flag).
 */
export const STAGE_TYPES = ['inbox', 'stage', 'accept', 'hold', 'reject']
export const STAGE_TONES = ['neutral', 'blue', 'green', 'amber', 'red', 'purple']
export const EMAIL_KEYS = ['acceptance', 'rejection', 'interview']
export const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/
export const BULK_CONFIRM_THRESHOLD = 100

/** The unified placeholder set (01 section 2.1 + 07 section 1.5). `booking_link` is interview-only. */
export const PLACEHOLDERS = ['founder_name', 'first_name', 'company_name', 'program_name', 'project_name', 'project_manager_name', 'booking_link']
export const PLACEHOLDERS_BY_KEY = {
  acceptance: PLACEHOLDERS.filter((p) => p !== 'booking_link'),
  rejection: PLACEHOLDERS.filter((p) => p !== 'booking_link'),
  interview: PLACEHOLDERS,
}

export const DEFAULT_STAGES = () => [
  { key: 'screening', label: { en: 'Screening', ar: 'الفرز' }, type: 'inbox', tone: 'neutral', email: null, requireReason: false },
  { key: 'interview', label: { en: 'Interview', ar: 'المقابلة' }, type: 'stage', tone: 'blue', email: 'interview', requireReason: false },
  { key: 'holding', label: { en: 'Holding', ar: 'قيد الانتظار' }, type: 'hold', tone: 'amber', email: null, requireReason: true },
  { key: 'accepted', label: { en: 'Accepted', ar: 'مقبول' }, type: 'accept', tone: 'green', email: 'acceptance', requireReason: false },
  { key: 'rejected', label: { en: 'Rejected', ar: 'مرفوض' }, type: 'reject', tone: 'red', email: 'rejection', requireReason: true },
]

/**
 * Seeded from migration.email_template_defaults (the most common legacy variant) + a neutral acceptance text.
 * MUST stay identical to app_private.selection_default_template (m33): the server falls back to it when a stage has no
 * saved override, so what the preview shows is what gets queued.
 */
export const DEFAULT_TEMPLATES = () => ({
  interview: {
    enabled: true,
    subject: 'Interview Invitation: {{company_name}}',
    body_html: 'Dear {{first_name}},\n\nWe would like to invite {{company_name}} for an interview with the {{program_name}} team.\n\nPlease book your slot here: {{booking_link}}\n\nBest regards,\n{{project_manager_name}}',
    subject_ar: 'دعوة لمقابلة: {{company_name}}',
    body_html_ar: 'عزيزي {{first_name}}،\n\nيسعدنا دعوة {{company_name}} لمقابلة مع فريق {{program_name}}.\n\nيرجى حجز موعدك من هنا: {{booking_link}}\n\nمع أطيب التحيات،\n{{project_manager_name}}',
    cc: [], admin: [],
  },
  acceptance: {
    enabled: true,
    subject: "Congratulations! {{company_name}} has been selected",
    body_html: 'Dear {{first_name}},\n\nCongratulations! We are pleased to inform you that {{company_name}} has been selected to join {{program_name}}.\n\nWe will contact you shortly with the next steps.\n\nBest regards,\n{{project_manager_name}}',
    subject_ar: 'تهانينا! تم اختيار {{company_name}}',
    body_html_ar: 'عزيزي {{first_name}}،\n\nتهانينا! يسعدنا إبلاغك بأن {{company_name}} قد تم اختيارها للانضمام إلى {{program_name}}.\n\nسنتواصل معك قريباً بالخطوات التالية.\n\nمع أطيب التحيات،\n{{project_manager_name}}',
    cc: [], admin: [],
  },
  rejection: {
    enabled: true,
    subject: 'Thank You for Your Application',
    body_html: 'Dear {{founder_name}},\n\nThank you for your application to {{program_name}}. We had the opportunity to review your submission, and while we were impressed with your startup, we have decided not to move forward with your application at this time.\n\nWe received a large number of strong applications, and the selection process was extremely competitive. We encourage you to continue developing your startup and hope you will consider applying again in the future.\n\nBest regards,\n{{project_manager_name}}',
    subject_ar: 'شكراً لتقديمك',
    body_html_ar: 'عزيزي {{founder_name}}،\n\nشكراً لتقديمك إلى {{program_name}}. راجعنا طلبك بعناية، ورغم إعجابنا بشركتك الناشئة فقد قررنا عدم المضي في طلبك هذه المرة.\n\nتلقينا عدداً كبيراً من الطلبات القوية وكانت عملية الاختيار تنافسية للغاية. نشجعك على مواصلة تطوير شركتك ونأمل أن تتقدم مجدداً في المستقبل.\n\nمع أطيب التحيات،\n{{project_manager_name}}',
    cc: [], admin: [],
  },
})

export const DEFAULT_CARD = { showFields: ['image', 'title', 'subtitle', 'bio'], accent: null }

export const defaultSelectionConfig = () => ({
  stages: DEFAULT_STAGES(),
  passing: ['accepted'],
  participantRule: { onAccept: 'none' },
  emails: DEFAULT_TEMPLATES(),
  interviewBooking: { linkedBookingNodeId: null },
  card: { ...DEFAULT_CARD, showFields: [...DEFAULT_CARD.showFields] },
})

const text = (v) => (v === null || v === undefined ? '' : String(v))
const label = (l) => ({ en: text(l?.en), ar: text(l?.ar) })
const strList = (v) => (Array.isArray(v) ? v.map(text).map((s) => s.trim()).filter(Boolean) : [])

/** "key" -> a readable default label ("on_hold" -> "On hold"). */
export const humanizeKey = (k) => String(k ?? '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

function normalizeStage(s) {
  const type = STAGE_TYPES.includes(s.type) ? s.type : 'stage'
  return {
    key: text(s.key),
    label: s.label ? label(s.label) : { en: humanizeKey(s.key), ar: '' },
    type,
    tone: STAGE_TONES.includes(s.tone) ? s.tone : type === 'accept' ? 'green' : type === 'reject' ? 'red' : type === 'hold' ? 'amber' : 'neutral',
    email: EMAIL_KEYS.includes(s.email) ? s.email : null,
    requireReason: Boolean(s.requireReason),
  }
}

function normalizeTemplate(key, raw) {
  const d = DEFAULT_TEMPLATES()[key]
  const t = raw && typeof raw === 'object' ? raw : {}
  // a migrated override has only the legacy English subject/body (+ admin/cc); everything missing falls back to the default
  return {
    enabled: t.enabled !== false,
    subject: text(t.subject ?? d.subject),
    body_html: text(t.body_html ?? d.body_html),
    subject_ar: text(t.subject_ar ?? (t.subject !== undefined ? '' : d.subject_ar)),
    body_html_ar: text(t.body_html_ar ?? (t.body_html !== undefined ? '' : d.body_html_ar)),
    cc: strList(t.cc),
    admin: strList(t.admin),
  }
}

/** Tolerant read of a stored config (migrated nodes have `{}` or only `emails`/`sheetImport`). Unknown keys are kept. */
export function normalizeSelectionConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const stages = (Array.isArray(c.stages) ? c.stages : []).filter((s) => s && typeof s.key === 'string').map(normalizeStage)
  const effStages = stages.length ? stages : DEFAULT_STAGES()
  const card = c.card && typeof c.card === 'object' ? c.card : {}
  return {
    ...c,
    stages: effStages,
    passing: effStages.filter((s) => s.type === 'accept').map((s) => s.key),
    participantRule: { onAccept: c.participantRule?.onAccept === 'create_participant' ? 'create_participant' : 'none' },
    emails: Object.fromEntries(EMAIL_KEYS.map((k) => [k, normalizeTemplate(k, c.emails?.[k])])),
    interviewBooking: { linkedBookingNodeId: typeof c.interviewBooking?.linkedBookingNodeId === 'string' && c.interviewBooking.linkedBookingNodeId ? c.interviewBooking.linkedBookingNodeId : null },
    card: {
      showFields: Array.isArray(card.showFields) ? card.showFields.filter((f) => CARD_FIELDS.includes(f)) : [...DEFAULT_CARD.showFields],
      accent: typeof card.accent === 'string' && /^#[0-9a-f]{6}$/i.test(card.accent) ? card.accent.toLowerCase() : null,
    },
  }
}

/** What is written back on Save: the normalised shape with `passing` derived from the stages. */
export function toStoredConfig(config) {
  const c = normalizeSelectionConfig(config)
  return { ...c, passing: c.stages.filter((s) => s.type === 'accept').map((s) => s.key) }
}

/** Validation of the Settings draft: returns { field: messageKey }. */
export function validateSelectionConfig(config) {
  const errors = {}
  const keys = new Set()
  if (!config.stages?.length) errors.stages = 'selection.settings.stagesEmpty'
  for (const s of config.stages ?? []) {
    if (!KEY_RE.test(s.key)) errors.stages = 'selection.settings.keyInvalid'
    else if (keys.has(s.key)) errors.stages = 'selection.settings.keyDuplicate'
    keys.add(s.key)
  }
  if (config.stages?.length && !config.stages.some((s) => s.type === 'accept')) errors.stages = 'selection.settings.needAccept'
  if (!config.card?.showFields?.length) errors.card = 'selection.settings.showFieldsEmpty'
  for (const k of EMAIL_KEYS) {
    const tpl = config.emails?.[k]
    if (!tpl) continue
    const bad = unknownPlaceholders(k, [tpl.subject, tpl.body_html, tpl.subject_ar, tpl.body_html_ar].join('\n'))
    if (bad.length) errors[`emails.${k}`] = 'selection.emails.unknownPlaceholder'
    const addr = [...tpl.cc, ...tpl.admin].find((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))
    if (addr) errors[`emails.${k}`] = 'selection.emails.badAddress'
  }
  return errors
}

/** Stage definition for a stored status (unknown values render as-is in a neutral badge). */
export function stageOf(config, key) {
  if (!key) return null
  return (config?.stages ?? []).find((s) => s.key === key) ?? { key, label: { en: key, ar: key }, type: 'stage', tone: 'neutral', email: null, requireReason: false }
}

/** The stage whose decision e-mail is `emailKey` (interview / acceptance / rejection); null when none is mapped. */
export const stageForEmail = (config, emailKey) => (config?.stages ?? []).find((s) => s.email === emailKey) ?? null

/** Statuses the output port carries (mirror of app_private.selection_port_statuses). `all` = null (no filter). */
export function portStatuses(config, port) {
  const stages = config?.stages ?? []
  if (port === 'all') return null
  if (port === 'approved') return stages.filter((s) => s.type === 'accept').map((s) => s.key)
  let v = []
  if (port === 'rejected') v = stages.filter((s) => s.type === 'reject').map((s) => s.key)
  else if (port === 'holding') v = stages.filter((s) => s.type === 'hold').map((s) => s.key)
  else if (port === 'interview') v = stages.filter((s) => s.key === 'interview' || s.email === 'interview').map((s) => s.key)
  return v.length ? v : [port]
}

/** Stages as the `config.statuses` vocabulary EntityManager / ItemEditor expect ([{ key, label, tone }]). */
export const stagesAsStatuses = (config) => (config?.stages ?? []).map((s) => ({ key: s.key, label: s.label, tone: s.tone }))

/** `{{key}}` / `{key}` tokens of a template that are not in the catalogue of that e-mail. */
export function unknownPlaceholders(emailKey, template) {
  return unknownTokens(PLACEHOLDERS_BY_KEY[emailKey] ?? PLACEHOLDERS, template)
}

// The renderer and the sanitiser live in lib/email.js (shared with the Booking node); re-exported for the existing callers.
export { renderTemplate, sanitizePreviewHtml }

/** Placeholder values for one applicant (ListItemView) used by the preview; mirrors the server derivation. */
export function sampleVars(item, { pmName = '', programName = '', projectName = '', bookingLink = '', lang = 'en' } = {}) {
  const founder = biPick(item?.entity?.subtitle, lang) || item?.fields?.founder_name || ''
  return {
    founder_name: founder,
    first_name: firstName(founder),
    company_name: biPick(item?.entity?.title, lang) || '',
    program_name: programName,
    project_name: projectName,
    project_manager_name: pmName || 'Athar Team',
    booking_link: bookingLink || 'https://athareg.com/book/<token>',
  }
}

/** Decision e-mail history per item: { [itemId]: { [emailKey]: { count, last: {status, created_at, sent_at, error_message, recipient} } } } */
export function emailIndex(rows = []) {
  const out = {}
  for (const r of rows) {
    if (!r.item_id) continue
    const byKey = (out[r.item_id] ??= {})
    const cur = byKey[r.email_key] ?? { count: 0, last: null }
    cur.count += 1
    if (!cur.last || String(r.created_at) >= String(cur.last.created_at)) cur.last = r
    byKey[r.email_key] = cur
  }
  return out
}

/** Scores per item: { [itemId]: { avg, count, mine: {score, note}|null, all: [...] } } */
export function scoreIndex(rows = [], userId = null) {
  const out = {}
  for (const r of rows) {
    const cur = (out[r.item_id] ??= { sum: 0, count: 0, mine: null, all: [] })
    cur.all.push(r)
    if (r.score !== null && r.score !== undefined) {
      cur.sum += Number(r.score)
      cur.count += 1
    }
    if (userId && r.reviewer_id === userId) cur.mine = r
  }
  for (const v of Object.values(out)) v.avg = v.count ? Math.round((v.sum / v.count) * 10) / 10 : null
  return out
}

/** Sort key helpers for the board's "score" sort. */
export const avgScoreOf = (scores, item) => scores[item.itemId]?.avg ?? null

/**
 * Counts per stage for the stage tabs (status null = "unsorted" = the inbox stage). Withdrawn applicants (m40) keep their
 * stage but are counted apart (`withdrawnCount`): a stage count is the people who are still in the program.
 */
export function stageCounts(items = [], config) {
  const inbox = (config?.stages ?? []).find((s) => s.type === 'inbox')?.key ?? null
  const counts = {}
  for (const it of items) {
    if (!isActiveItem(it)) continue
    const k = it.status ?? inbox ?? '__none'
    counts[k] = (counts[k] ?? 0) + 1
  }
  return counts
}

/** Applicants marked withdrawn (they stay in the board with a chip, outside the stage counts). */
export const withdrawnCount = (items = []) => items.filter((i) => i.withdrawn).length

/** The effective stage of an item: its status, else the inbox stage (a new applicant waits in the inbox). */
export const effectiveStage = (item, config) => item.status ?? (config?.stages ?? []).find((s) => s.type === 'inbox')?.key ?? null

/**
 * Excel columns of the board (lib/export/xlsx descriptor): identity + stage + reviewer data + every raw answer
 * labelled through the form schema (`schema.fields` from the Form resolver), so the PM sees labels, not keys (docs/04 A-19).
 */
export function boardColumns(t, lang, { config, reviews = {}, scores = {}, emails = {}, fields = [] }) {
  const cols = [
    { key: (r) => r.entity.title.en || r.entity.title.ar, header: t('entity.field.title.company') },
    { key: (r) => r.entity.subtitle.en || r.entity.subtitle.ar, header: t('selection.col.founder') },
    { key: (r) => r.contact?.email ?? '', header: t('entity.field.email') },
    { key: (r) => r.contact?.phone ?? '', header: t('entity.field.phone') },
    { key: (r) => { const s = stageOf(config, effectiveStage(r, config)); return s ? biPick(s.label, lang) || s.key : '' }, header: t('selection.col.stage') },
    { key: (r) => (r.withdrawn ? t('entity.export.withdrawn') : ''), header: t('entity.export.presence') },
    { key: (r) => r.withdrawal?.reason ?? '', header: t('entity.withdraw.reason') },
    { key: (r) => reviews[r.itemId]?.reason ?? '', header: t('selection.col.reason') },
    { key: (r) => reviews[r.itemId]?.reviewed_at ?? '', header: t('selection.col.reviewedAt') },
    { key: (r) => scores[r.itemId]?.avg ?? '', header: t('selection.col.score') },
    { key: (r) => scores[r.itemId]?.count ?? 0, header: t('selection.col.scoreCount') },
    { key: (r) => r.overlay?.notes ?? '', header: t('entity.manager.col.notes') },
    { key: (r) => r.overlay?.tech_status ?? '', header: t('selection.col.techStatus') },
  ]
  for (const k of EMAIL_KEYS) cols.push({ key: (r) => emails[r.itemId]?.[k]?.count ?? 0, header: `${t(`selection.email.${k}`)} (${t('selection.col.sent')})` })
  const seen = new Set()
  for (const f of fields) {
    if (!f?.name || seen.has(f.name)) continue
    seen.add(f.name)
    const lbl = (lang === 'ar' ? f.label?.ar || f.label?.en : f.label?.en || f.label?.ar) || f.name
    cols.push({ key: (r) => { const v = r.fields?.[f.name]; return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v) }, header: lbl })
  }
  cols.push({ key: (r) => t(`entity.source.${r.source.kind}`), header: t('entity.manager.col.source') })
  return cols
}
