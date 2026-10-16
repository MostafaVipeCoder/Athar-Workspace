/**
 * Pure helpers of the "What are you doing now?" form of a CLOSED company (owner decision 22; m70 `public.company_after_closing`).
 * Three answers, the keys of the `after_closing` vocabulary: `new_startup` (a new venture), `employed` (a job), `other` (free text). The server owns the rules; this file only shapes the
 * form (strings), checks what the person sees at once (required / length / web address) and builds the payload of `save_company_after_closing`: ONLY the fields of the chosen type.
 */
export const CLOSED_TYPES = Object.freeze(['new_startup', 'employed', 'other'])

/** Server limits (m70 `company_after_closing_len_chk`). */
export const CLOSED_MAX = Object.freeze({ venture_name: 150, employer: 150, job_title: 150, venture_description: 1000, other_text: 1000, venture_url: 500 })

const REQUIRED = Object.freeze({
  new_startup: ['venture_name', 'field'],
  employed: ['employer', 'job_title', 'field'],
  other: ['other_text'],
})
const FIELDS = Object.freeze({
  new_startup: ['venture_name', 'field', 'venture_stage', 'venture_url', 'venture_description'],
  employed: ['employer', 'job_title', 'field'],
  other: ['other_text'],
})

const str = (v) => (v === null || v === undefined ? '' : String(v))

export const emptyClosedForm = () => ({
  answer_type: '', venture_name: '', field: '', venture_stage: '', venture_url: '', venture_description: '', wants_programs: false, employer: '', job_title: '', other_text: '',
})

/** The stored answer (or nothing) -> form values. */
export function answerToForm(answer) {
  const f = emptyClosedForm()
  if (!answer) return f
  f.answer_type = CLOSED_TYPES.includes(answer.answer_type) ? answer.answer_type : ''
  for (const k of ['venture_name', 'field', 'venture_stage', 'venture_url', 'venture_description', 'employer', 'job_title', 'other_text']) f[k] = str(answer[k])
  f.wants_programs = answer.answer_type === 'new_startup' && answer.wants_programs === true
  return f
}

/** "venture.example" -> "https://venture.example" (a web address typed without its scheme); a value that already has a scheme (even a refused one) is left for the server to judge. */
export function normalizeUrl(value) {
  const v = str(value).trim()
  if (v === '') return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v
  if (/\s/.test(v)) return v
  return `https://${v.replace(/^\/+/, '')}`
}

/** `{ field: 'required' | 'too_long' | 'bad_url' }` (the reason keys of `alumni.reason.*`); empty = nothing to fix. */
export function validateClosedForm(form) {
  const errors = {}
  const type = form?.answer_type
  if (!CLOSED_TYPES.includes(type)) return { answer_type: 'required' }
  for (const k of REQUIRED[type]) if (str(form[k]).trim() === '') errors[k] = 'required'
  for (const k of FIELDS[type]) {
    if (errors[k]) continue
    const v = k === 'venture_url' ? normalizeUrl(form[k]) : str(form[k]).trim()
    if (CLOSED_MAX[k] && v.length > CLOSED_MAX[k]) errors[k] = 'too_long'
    else if (k === 'venture_url' && v !== '' && !/^https?:\/\/\S+$/i.test(v)) errors[k] = 'bad_url'
  }
  return errors
}

/** The `data` of `save_company_after_closing`: the fields of the chosen type only (an empty optional one is left out); the interest flag only for a new venture. */
export function buildClosedPayload(form) {
  const type = form.answer_type
  const out = { answer_type: type }
  for (const k of FIELDS[type] ?? []) {
    const v = k === 'venture_url' ? normalizeUrl(form[k]) : str(form[k]).trim()
    if (v !== '') out[k] = v
  }
  if (type === 'new_startup') out.wants_programs = Boolean(form.wants_programs)
  return out
}

const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))

/** True when the payload differs from what is stored (the Save button is idle otherwise). */
export function closedFormChanged(answer, form) {
  if (!CLOSED_TYPES.includes(form?.answer_type)) return false
  if (!answer) return true
  return JSON.stringify(sortKeys(buildClosedPayload(answerToForm(answer)))) !== JSON.stringify(sortKeys(buildClosedPayload(form)))
}

/** The part of an answer worth a table cell: the venture's name / the employer / the start of the free text. */
export function answerHeadline(answer, max = 60) {
  if (!answer) return ''
  const v = answer.answer_type === 'new_startup' ? answer.venture_name : answer.answer_type === 'employed' ? answer.employer : answer.other_text
  const s = str(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
