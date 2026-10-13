/**
 * Certificate layout maths (design 07 section 4.3, decisions 06-5 / 07-8). PURE: no DOM, no canvas. Everything that decides where
 * and how big a field is lives here so the editor overlay, the preview, the founder download and the verifier page draw the SAME
 * certificate and the maths can be unit-tested with a fake `measure(text, font)`.
 *
 * Coordinates are FRACTIONS of the template image, so the preview scale never matters:
 *   x, w   fractions of the template WIDTH  (x = the CENTRE of the field box, w = the box width)
 *   y      fraction of the template HEIGHT  (the vertical CENTRE of the text block)
 *   size   the font size as a fraction of the template WIDTH (for the QR code: its side)
 * Client model (camelCase) <-> DB row (snake_case, `certificate_template_fields`): `fieldFromRow` / `fieldToRow`.
 */

export const VARIABLES = [
  { key: 'person_name', type: 'text', sample: 'personName', snapshot: 'person_name' },
  { key: 'company_name', type: 'text', sample: 'companyName', snapshot: 'company_name' },
  { key: 'program_name', type: 'text', sample: 'programName', snapshot: 'program_name' },
  { key: 'project_name', type: 'text', sample: 'projectName', snapshot: 'project_name' },
  { key: 'completion_date', type: 'date', sample: 'completedOn', snapshot: 'completed_on' },
  { key: 'issue_date', type: 'date', sample: 'issuedOn', snapshot: 'issued_on' },
  { key: 'verification_code', type: 'code', sample: 'code', snapshot: null },
  { key: 'verification_qr', type: 'qr', sample: null, snapshot: null },
]
export const VARIABLE_KEYS = VARIABLES.map((v) => v.key)
/**
 * The template variable of the person is `person_name` (owner decision 08 section 17.2: a certificate carries the PERSON's name and the COMPANY's
 * name, one certificate per founder account). `participant_name` is the m38 spelling: it is read as an alias everywhere (templates saved before
 * m42, snapshots of old certificates) and never written again.
 */
const LEGACY_VARIABLES = { participant_name: 'person_name' }
export const normalizeVar = (key) => LEGACY_VARIABLES[key] ?? key

/** Only fonts the app already loads (index.html): Tajawal covers Arabic + Latin, the others fall back to it for Arabic glyphs. */
export const FONTS = [
  { key: 'Tajawal', label: 'Tajawal', weights: [400, 500, 700, 800], stack: '"Tajawal", sans-serif' },
  { key: 'Manrope', label: 'Manrope', weights: [400, 500, 600, 700], stack: '"Manrope", "Tajawal", sans-serif' },
  { key: 'Hepta Slab', label: 'Hepta Slab', weights: [800], stack: '"Hepta Slab", "Tajawal", serif' },
  { key: 'Questrial', label: 'Questrial', weights: [400], stack: '"Questrial", "Tajawal", sans-serif' },
]
export const fontOf = (key) => FONTS.find((f) => f.key === key) ?? FONTS[0]
export const ALIGNS = ['left', 'center', 'right']
export const DIRECTIONS = ['auto', 'ltr', 'rtl']
const MAX_FIELDS = 12

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback)
const round5 = (v) => Math.round(v * 100000) / 100000

/** Size limits (fraction of the width): text 0.5 % .. 20 %, QR side 3 % .. 50 % (the same as save_children_certificates). */
export const TEXT_SIZE = { min: 0.005, max: 0.2 }
export const QR_SIZE = { min: 0.03, max: 0.5 }
export const WIDTH_RANGE = { min: 0.05, max: 1 }

/** Where a variable lands when the PM adds it (a sensible A4 composition). */
const DEFAULTS = {
  person_name: { x: 0.5, y: 0.46, w: 0.6, size: 0.045, weight: 700, shrinkToFit: true },
  company_name: { x: 0.5, y: 0.54, w: 0.5, size: 0.028, weight: 500, shrinkToFit: true },
  program_name: { x: 0.5, y: 0.63, w: 0.7, size: 0.026, weight: 500, shrinkToFit: true, maxLines: 2 },
  project_name: { x: 0.5, y: 0.715, w: 0.5, size: 0.02, weight: 400, shrinkToFit: true },
  completion_date: { x: 0.25, y: 0.84, w: 0.25, size: 0.02, weight: 500, shrinkToFit: true },
  issue_date: { x: 0.75, y: 0.84, w: 0.25, size: 0.02, weight: 500, shrinkToFit: true },
  verification_code: { x: 0.82, y: 0.95, w: 0.22, size: 0.014, weight: 500, shrinkToFit: true, font: 'Manrope', align: 'center' },
  verification_qr: { x: 0.9, y: 0.82, w: 0.1, size: 0.1 },
}

export function defaultField(key) {
  const d = DEFAULTS[normalizeVar(key)] ?? DEFAULTS.person_name
  return normalizeField({
    var: normalizeVar(key), align: 'center', font: 'Tajawal', color: '#1a1a2e', weight: 700, direction: 'auto', maxLines: 1, shrinkToFit: false, ...d,
  })
}

/** Clamp every number into its legal range, fill defaults, keep the QR square (w = size). */
export function normalizeField(input) {
  const f = { ...input, var: normalizeVar(input.var) }
  const isQr = f.var === 'verification_qr'
  const font = fontOf(f.font)
  const weight = font.weights.includes(Number(f.weight)) ? Number(f.weight) : font.weights.reduce((a, b) => (Math.abs(b - 700) < Math.abs(a - 700) ? b : a), font.weights[0])
  const color = /^#[0-9a-f]{6}$/i.test(String(f.color ?? '')) ? String(f.color).toLowerCase() : '#1a1a2e'
  const x = round5(clamp(num(f.x, 0.5), 0, 1))
  const y = round5(clamp(num(f.y, 0.5), 0, 1))
  if (isQr) {
    const side = round5(clamp(num(f.w, num(f.size, 0.1)), QR_SIZE.min, QR_SIZE.max))
    return { var: f.var, x, y, w: side, size: side, align: 'center', font: font.key, color: '#000000', weight: 400, direction: 'ltr', maxLines: 1, shrinkToFit: false }
  }
  return {
    var: f.var, x, y,
    w: round5(clamp(num(f.w, 0.5), WIDTH_RANGE.min, WIDTH_RANGE.max)),
    size: round5(clamp(num(f.size, 0.03), TEXT_SIZE.min, TEXT_SIZE.max)),
    align: ALIGNS.includes(f.align) ? f.align : 'center',
    font: font.key, color, weight,
    direction: DIRECTIONS.includes(f.direction) ? f.direction : 'auto',
    maxLines: clamp(Math.round(num(f.maxLines, 1)), 1, 4),
    shrinkToFit: Boolean(f.shrinkToFit),
  }
}

/** DB row (certificate_template_fields / render payload `fields[]`) -> client field. */
export function fieldFromRow(row) {
  return normalizeField({
    var: row.var, x: row.x, y: row.y, w: row.w, align: row.align, font: row.font, size: row.size, color: row.color, weight: row.weight,
    direction: row.direction, maxLines: row.max_lines, shrinkToFit: row.shrink_to_fit,
  })
}
/** Client field -> the `children.template.fields[]` shape of save_children_certificates. */
export function fieldToRow(field) {
  const f = normalizeField(field)
  return { var: f.var, x: f.x, y: f.y, w: f.w, align: f.align, font: f.font, size: f.size, color: f.color, weight: f.weight, direction: f.direction, max_lines: f.maxLines, shrink_to_fit: f.shrinkToFit }
}

/** Fields in a stable order (by variable) so a draft compares equal to what was loaded. */
export const sortFields = (fields) => [...fields].sort((a, b) => VARIABLE_KEYS.indexOf(a.var) - VARIABLE_KEYS.indexOf(b.var))

/** What is wrong with a draft's fields (the person's name is what makes a certificate a certificate; the company name is optional). */
export function validateFields(fields) {
  const issues = []
  if (!fields.some((f) => normalizeVar(f.var) === 'person_name')) issues.push({ code: 'noName' })
  if (fields.length > MAX_FIELDS) issues.push({ code: 'tooMany' })
  const seen = new Set()
  for (const f of fields) {
    const key = normalizeVar(f.var)
    if (!VARIABLE_KEYS.includes(key)) issues.push({ code: 'unknownVar', var: f.var })
    if (seen.has(key)) issues.push({ code: 'duplicate', var: f.var })
    seen.add(key)
  }
  return issues
}

// ------------------------------------------------------------------ text direction + font strings
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LATIN_CHARS = /[A-Za-z]/
/** `auto` picks the direction of the first strong character (so an Arabic name is right-to-left, an English one left-to-right). */
export function detectDirection(text, preference = 'auto') {
  if (preference === 'rtl' || preference === 'ltr') return preference
  for (const ch of String(text ?? '')) {
    if (RTL_CHARS.test(ch)) return 'rtl'
    if (LATIN_CHARS.test(ch)) return 'ltr'
  }
  return 'ltr'
}
export const fontString = (field, px) => `${field.weight} ${Math.max(1, Math.round(px * 100) / 100)}px ${fontOf(field.font).stack}`

// ------------------------------------------------------------------ geometry
const LINE_HEIGHT = { ltr: 1.25, rtl: 1.45 }

/** The field box in pixels of a W x H canvas. */
export function fieldBox(field, W, H) {
  const cx = field.x * W
  const cy = field.y * H
  if (field.var === 'verification_qr') {
    const side = field.w * W
    return { cx, cy, width: side, height: side, left: cx - side / 2, top: cy - side / 2, fontPx: 0, lineHeight: 0 }
  }
  const width = field.w * W
  const fontPx = field.size * W
  const lineHeight = fontPx * LINE_HEIGHT.rtl
  return { cx, cy, width, height: lineHeight * field.maxLines, left: cx - width / 2, top: cy - (lineHeight * field.maxLines) / 2, fontPx, lineHeight }
}

/** Greedy word wrap by measured width. A single word wider than the box stays on its own line (never cut mid-word). */
export function wrapLines(measure, text, maxWidth, maxLines = 1) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (maxLines <= 1) return [clean]
  const words = clean.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (!line || measure(candidate) <= maxWidth) line = candidate
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Lay a text out inside its box. `measure(text, fontPx)` returns the width in px. With `shrinkToFit` the font shrinks (never below
 * 35 % of the base size) until every line fits the box and the line count respects `maxLines`; without it the text keeps its size and
 * `overflow` tells the editor it is wider than the box. Returns { lines: [{ text, width }], fontPx, lineHeight, direction, overflow }.
 */
export function layoutText(measure, text, field, W, H) {
  const box = fieldBox(field, W, H)
  const direction = detectDirection(text, field.direction)
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return { lines: [], fontPx: box.fontPx, lineHeight: box.lineHeight, direction, overflow: false, box }
  let fontPx = box.fontPx
  const fits = (px) => {
    const m = (s) => measure(s, px)
    const lines = wrapLines(m, clean, box.width, field.maxLines)
    return { lines, ok: lines.length <= field.maxLines && lines.every((l) => m(l) <= box.width + 0.5) }
  }
  let probe = fits(fontPx)
  if (!probe.ok && field.shrinkToFit) {
    const floor = box.fontPx * 0.35
    while (!probe.ok && fontPx > floor) {
      fontPx = Math.max(floor, fontPx * 0.96)
      probe = fits(fontPx)
    }
  }
  const lineHeight = fontPx * LINE_HEIGHT[direction]
  return {
    lines: probe.lines.map((s) => ({ text: s, width: measure(s, fontPx) })),
    fontPx, lineHeight, direction, overflow: !probe.ok, box,
  }
}

/** Anchor x for a physical `textAlign` inside the box. */
export function anchorX(field, box) {
  if (field.align === 'left') return box.left
  if (field.align === 'right') return box.left + box.width
  return box.cx
}

// ------------------------------------------------------------------ editing helpers (fractions)
export const moveField = (field, dx, dy) => normalizeField({ ...field, x: field.x + dx, y: field.y + dy })
/** Resize around the centre: dw is the change of the width fraction. */
export const resizeField = (field, dw) => normalizeField({ ...field, w: field.w + dw, size: field.var === 'verification_qr' ? field.w + dw : field.size })
export const nudge = (field, key, step) => (key === 'ArrowLeft' ? moveField(field, -step, 0) : key === 'ArrowRight' ? moveField(field, step, 0) : key === 'ArrowUp' ? moveField(field, 0, -step) : key === 'ArrowDown' ? moveField(field, 0, step) : field)

// ------------------------------------------------------------------ values (what each variable prints)
const DATE_LOCALE = { ar: 'ar-EG-u-nu-latn', en: 'en-GB' }
/** 'YYYY-MM-DD' (or an ISO instant) -> "12 October 2026" / "12 أكتوبر 2026" in the TEMPLATE language, Western digits. */
export function formatCertDate(value, lang = 'en') {
  if (!value) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(DATE_LOCALE[lang] ?? DATE_LOCALE.en, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
}

/** The printed value of each variable from an issued certificate's snapshot + code. The QR carries no text value. */
export function certValues(snapshot, code, lang = 'en') {
  const s = snapshot ?? {}
  return {
    person_name: s.person_name ?? s.participant_name ?? '',
    company_name: s.company_name ?? '',
    program_name: s.program_name ?? '',
    project_name: s.project_name ?? '',
    completion_date: formatCertDate(s.completed_on, lang),
    issue_date: formatCertDate(s.issued_on, lang),
    verification_code: code ?? '',
  }
}

/**
 * Sample data for the editor: a long Arabic and a long Latin PERSON name AND COMPANY name stress the overflow / auto-fit rules (decision 07-8);
 * the two mixed samples stress one box at a time (a long person with a short company, a short person with a long company).
 */
const COMMON = { program_name: 'Athar Accelerator Program for Climate Startups', project_name: 'Cohort Five', completed_on: '2026-10-12', issued_on: '2026-10-13' }
const COMMON_AR = { program_name: 'برنامج أثر لتسريع الشركات الناشئة في مجال المناخ', project_name: 'الدفعة الخامسة', completed_on: '2026-10-12', issued_on: '2026-10-13' }
const CODE = 'AB12-CD34-EF56'
export const SAMPLES = {
  longAr: { snapshot: { person_name: 'عبد الرحمن بن محمد الفاتح الإدريسي المقدسي', company_name: 'شركة الأفق الرقمي للحلول التقنية المتقدمة والخدمات السحابية', ...COMMON_AR }, code: CODE },
  longEn: { snapshot: { person_name: 'Alexandria Maximilian Wolfeschlegelstein-Hartmann III', company_name: 'International Sustainable Renewable Energy Solutions and Services Ltd', ...COMMON }, code: CODE },
  longPerson: { snapshot: { person_name: 'Alexandria Maximilian Wolfeschlegelstein-Hartmann III', company_name: 'Nile Labs', ...COMMON }, code: CODE },
  longCompany: { snapshot: { person_name: 'Sara Ali', company_name: 'International Sustainable Renewable Energy Solutions and Services Ltd', ...COMMON }, code: CODE },
  short: { snapshot: { person_name: 'Sara Ali', company_name: 'Nile Labs', program_name: 'Athar Accelerator', project_name: 'Cohort 5', completed_on: '2026-10-12', issued_on: '2026-10-13' }, code: CODE },
}
export const SAMPLE_KEYS = Object.keys(SAMPLES)
