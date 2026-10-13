import { getFormDefinition, getFormLink, listResponses } from '../../data/forms.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import { fromQuestionRow, responseDisplay } from './formLogic.js'

/**
 * Output-port resolver of `responses` (design 02 section 2.3 `rows:form-response`): what a consumer (Selection, a
 * List preview, Distribution later) receives through useInputPort. Rows are REFERENCES (id + answers), never copies;
 * the form's schema (question keys + semantic roles) travels with the result so consumers map columns without
 * guessing (docs/04 A-19). `display` is derived from the semantic roles (company_name / founder_name / founder_email / phone).
 * The DB-side resolver of Lists (`resolve_list`) reads the same canonical keys straight from `answers`.
 */
export async function resolveResponses({ node }) {
  const [def, rows] = await Promise.all([getFormDefinition(node.id), listResponses(node.id)])
  const questions = def.questions.map(fromQuestionRow)
  const schema = { form_id: node.id, fields: questions.map((q) => ({ name: q.key, type: q.type, label: q.label, canonical: q.semantic })) }
  const items = rows.map((r) => ({
    id: r.id,
    kind: 'form_response',
    source: { kind: 'form_response', id: r.id, state: 'ok' },
    answers: r.answers ?? {},
    status: r.status,
    submittedAt: r.submitted_at,
    sourceTag: r.source ?? null,
    display: responseDisplay(r.answers ?? {}, questions),
  }))
  return { items, schema }
}

/** Output-port resolver of `link`: the public form URL (consumed by the Landing page CTA / share). */
export async function resolveLink({ node }) {
  const link = await getFormLink(node.id)
  if (!link?.slug) return { items: [] }
  return { items: [{ kind: 'form', url: buildPublicUrl('form', canonicalRef({ slug: link.slug, id: node.id })), label: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, nodeId: node.id }] }
}
