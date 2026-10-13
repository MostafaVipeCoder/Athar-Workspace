import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronUp, Copy, Eye, GripVertical, Image as ImageIcon, Plus, Save, Trash2 } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { invalidateNodeOutputs } from '../_kit/invalidate.js'
import { useQueryClient } from '@tanstack/react-query'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Img } from '../../ui/Img.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useAuth } from '../../app/AuthContext.js'
import { useFormDefinition, useFormLink, useFormMutations, useFormResponses } from '../../data/forms.js'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { buildPublicUrl, canonicalRef, staffPath } from '../../lib/links.js'
import { resolveTimeZone } from '../../lib/time/tz.js'
import { cn } from '../../lib/cn.js'
import { QuestionEditor } from './QuestionEditor.jsx'
import { ResponsesTab } from './ResponsesTab.jsx'
import { CoverPicker } from './CoverPicker.jsx'
import { ImportTemplateModal, SaveTemplateModal } from './TemplateModals.jsx'
import { SEMANTICS, SEMANTICS_RECOMMENDED, SEMANTIC_TYPES, applySemantic, duplicateQuestion, emptyQuestion, emptySection, fromQuestionRow, fromSectionRow, keyFromLabel, normalizeFormConfig, toChildren, typeForSemantic, validateDefinition } from './formLogic.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const biPick = (p, lang) => (lang === 'ar' ? p?.ar || p?.en : p?.en || p?.ar) || ''

/** Flat question list regrouped: unsectioned first, then each section in order; renumbers order_index. */
function regroup(sections, questions) {
  const ids = new Set(sections.map((s) => s.id))
  const groups = [{ id: null, items: questions.filter((q) => !q.section_id || !ids.has(q.section_id)) }, ...sections.map((s) => ({ id: s.id, items: questions.filter((q) => q.section_id === s.id) }))]
  const flat = groups.flatMap((g) => g.items.map((q) => ({ ...q, section_id: g.id })))
  return { groups, flat: flat.map((q, i) => ({ ...q, order_index: i })) }
}

/**
 * Edit mode = the question builder (design 01 section 3.2): sections, typed questions, semantic roles (the keys the
 * list resolver reads), reorder (drag / arrows), duplicate, validation, cover, description, thank-you, library
 * templates, preview; and the Responses tab. The definition is a client draft saved with ONE save_node call
 * (config + children) under the revision token: nothing is half-written (docs/04 A-28).
 */
export default function FormEdit() {
  const { node, projectId, graph } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { user, hasRole } = useAuth()
  const { config: rawConfig, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeFormConfig(rawConfig), [rawConfig])
  const def = useFormDefinition(node.id)
  const responses = useFormResponses(node.id)
  const link = useFormLink(node.id)
  const m = useFormMutations(node.id, projectId, { onChanged: () => invalidateNodeOutputs(qc, graph, node.id, projectId) })
  const tz = resolveTimeZone(graph?.project?.timezone)
  // deep link from a Selection stage ("open original response"): ?tab=responses&response=<id>
  const [params] = useSearchParams()
  const [tab, setTab] = useState(() => (params.get('tab') === 'responses' ? 'responses' : 'questions'))
  const [base, setBase] = useState(null)
  const [draft, setDraft] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [errors, setErrors] = useState({})
  const [modal, setModal] = useState(null) // 'cover' | 'import' | 'template'
  const [dragId, setDragId] = useState(null)

  // adopt the loaded definition (and newer saved states from outside) unless the user has unsaved edits
  const loaded = useMemo(() => (def.data ? { sections: def.data.sections.map(fromSectionRow), questions: def.data.questions.map(fromQuestionRow), coverId: def.data.form.cover_id ?? null, coverPath: def.data.form.cover_path ?? null } : null), [def.data])
  const childrenDirty = draft && base && !same(draft, base)
  if (loaded && (!base || (!same(loaded, base) && !childrenDirty))) {
    setBase(loaded)
    setDraft(loaded)
  }
  const dirty = configDirty || Boolean(childrenDirty)
  const d = draft ?? loaded ?? { sections: [], questions: [], coverId: null, coverPath: null }
  const { groups } = useMemo(() => regroup(d.sections, d.questions), [d.sections, d.questions])
  const patchDraft = (fn) => setDraft((cur) => { const next = fn(cur ?? d); return { ...next, questions: regroup(next.sections, next.questions).flat } })
  const patchConfig = (p) => setConfig({ ...config, ...p })
  const takenSemantics = d.questions.map((q) => q.semantic).filter(Boolean)
  const url = link.data?.slug ? buildPublicUrl('form', canonicalRef({ slug: link.data.slug, id: node.id })) : null

  // ---- question operations
  function addQuestion(sectionId = null, semantic = null) {
    const q = emptyQuestion(semantic ? typeForSemantic(semantic) : 'text', { section_id: sectionId })
    const withKey = { ...q, key: keyFromLabel('', d.questions.map((x) => x.key), d.questions.length + 1) }
    const next = semantic ? applySemantic(withKey, semantic) : withKey
    patchDraft((cur) => ({ ...cur, questions: [...cur.questions, next] }))
    setExpanded(next.id)
  }
  const updateQuestion = (next) => patchDraft((cur) => ({ ...cur, questions: cur.questions.map((q) => (q.id === next.id ? next : q)) }))
  async function removeQuestion(q) {
    if (!(await confirm({ title: t('form.edit.removeQuestion', { label: biPick(q.label, lang) || q.key }), message: t('form.edit.removeQuestionBody', { key: q.key }), destructive: true }))) return
    patchDraft((cur) => ({ ...cur, questions: cur.questions.filter((x) => x.id !== q.id) }))
  }
  function moveInGroup(q, dir) {
    patchDraft((cur) => {
      const { groups: gs } = regroup(cur.sections, cur.questions)
      const g = gs.find((x) => x.items.some((i) => i.id === q.id))
      const i = g.items.findIndex((x) => x.id === q.id)
      const j = i + dir
      if (j < 0 || j >= g.items.length) return cur
      const items = [...g.items];
      [items[i], items[j]] = [items[j], items[i]]
      const flat = gs.flatMap((x) => (x === g ? items : x.items))
      return { ...cur, questions: flat }
    })
  }
  function onDrop(targetId, targetSection) {
    if (!dragId || dragId === targetId) return
    patchDraft((cur) => {
      const moving = cur.questions.find((q) => q.id === dragId)
      if (!moving) return cur
      const rest = cur.questions.filter((q) => q.id !== dragId)
      const moved = { ...moving, section_id: targetSection }
      if (!targetId) return { ...cur, questions: [...rest, moved] }
      const idx = rest.findIndex((q) => q.id === targetId)
      rest.splice(idx, 0, moved)
      return { ...cur, questions: rest }
    })
    setDragId(null)
  }
  function assignRole(sem, questionId) {
    patchDraft((cur) => ({ ...cur, questions: cur.questions.map((q) => (q.semantic === sem && q.id !== questionId ? { ...q, semantic: null } : q.id === questionId ? applySemantic(q, sem) : q)) }))
  }
  const addSection = () => patchDraft((cur) => ({ ...cur, sections: [...cur.sections, emptySection({ order_index: cur.sections.length })] }))
  const updateSection = (s) => patchDraft((cur) => ({ ...cur, sections: cur.sections.map((x) => (x.id === s.id ? s : x)) }))
  async function removeSection(s) {
    if (!(await confirm({ title: t('form.edit.removeSection'), message: t('form.edit.removeSectionBody'), destructive: true }))) return
    patchDraft((cur) => ({ ...cur, sections: cur.sections.filter((x) => x.id !== s.id), questions: cur.questions.map((q) => (q.section_id === s.id ? { ...q, section_id: null } : q)) }))
  }

  async function onSave() {
    const errs = validateDefinition(d)
    setErrors(errs)
    if (Object.keys(errs).length) {
      setExpanded(Object.keys(errs)[0])
      toast.error(t('form.edit.invalid'))
      return
    }
    const children = toChildren({ sections: d.sections, questions: d.questions, form: { cover_id: d.coverId } })
    const r = await save({ config }, { children }) // the normalised config shape is written back (legacy string messages become {en, ar})
    if (r.ok) {
      setBase(d)
      setDraft(d)
      qc.invalidateQueries({ queryKey: ['node', node.id] })
      toast.success(t('form.edit.saved'))
    }
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t('form.edit.tab.questions')}>
      {['questions', 'responses'].map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('tap-target rounded-md px-3 text-sm', tab === k ? 'bg-primary text-primary-foreground' : 'hover:bg-surface')} data-testid={`tab-${k}`}>
          {t(`form.edit.tab.${k}`)}{k === 'responses' && responses.data ? ` (${responses.data.length})` : ''}
        </button>
      ))}
    </div>
  )

  if (def.isPending) return <NodeFrame showSave={false}><Loading /></NodeFrame>
  if (def.error) return <NodeFrame showSave={false}><ErrorState error={def.error} onRetry={def.refetch} /></NodeFrame>

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave} showSave={tab === 'questions'} actions={actions} subtitle={t('form.edit.subtitle', { questions: d.questions.length, sections: d.sections.length, responses: responses.data?.length ?? 0 })}>
      {tab === 'responses' ? (
        <ResponsesTab node={node} questions={d.questions} tz={tz} publicUrl={url} social={config.social} mutations={m} initialOpenId={params.get('response')} />
      ) : (
        <div className="space-y-6" data-testid="form-builder">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => addQuestion(null)} data-testid="add-question"><Plus className="h-4 w-4" aria-hidden="true" />{t('form.edit.addQuestion')}</Button>
            <Button size="sm" variant="secondary" onClick={addSection}><Plus className="h-4 w-4" aria-hidden="true" />{t('form.edit.addSection')}</Button>
            <Button size="sm" variant="outline" onClick={() => setModal('import')}><BookOpen className="h-4 w-4" aria-hidden="true" />{t('form.edit.import')}</Button>
            <Button size="sm" variant="outline" onClick={() => setModal('template')} disabled={!d.questions.length}><Save className="h-4 w-4" aria-hidden="true" />{t('form.edit.saveTemplate')}</Button>
            <Link to={staffPath.node(projectId, node.id, 'view')} className="tap-target inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface"><Eye className="h-4 w-4" aria-hidden="true" />{t('form.edit.preview')}</Link>
          </div>

          {/* semantic roles: the obvious place to see/assign which question feeds connected lists */}
          <section className="rounded-md border p-3" data-testid="semantics-panel">
            <h3 className="text-sm font-semibold">{t('form.semantic.title')}</h3>
            <p className="mb-2 text-xs text-muted-foreground">{t('form.semantic.hint')}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SEMANTICS.map((sem) => {
                const assigned = d.questions.find((q) => q.semantic === sem)
                const candidates = d.questions.filter((q) => SEMANTIC_TYPES[sem].includes(q.type) && (!q.semantic || q.semantic === sem))
                return (
                  <div key={sem} className={cn('rounded-md border p-2', !assigned && SEMANTICS_RECOMMENDED.includes(sem) && 'border-accent bg-accent/10')}>
                    <div className="mb-1 flex items-center gap-2 text-sm">
                      <span className="font-medium">{t(`form.semantic.${sem}`)}</span>
                      {!assigned && SEMANTICS_RECOMMENDED.includes(sem) && <Badge tone="amber">{t('form.semantic.recommended')}</Badge>}
                    </div>
                    <div className="flex gap-1">
                      <select aria-label={t(`form.semantic.${sem}`)} value={assigned?.id ?? ''} onChange={(e) => (e.target.value ? assignRole(sem, e.target.value) : assigned && updateQuestion(applySemantic(assigned, null)))} className="min-h-9 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid={`role-${sem}`}>
                        <option value="">{t('form.semantic.missing')}</option>
                        {candidates.map((q) => <option key={q.id} value={q.id}>{biPick(q.label, lang) || q.key}</option>)}
                      </select>
                      {!assigned && <Button size="sm" variant="outline" aria-label={`${t('form.edit.addQuestion')}: ${t(`form.semantic.${sem}`)}`} onClick={() => addQuestion(null, sem)}><Plus className="h-4 w-4" aria-hidden="true" /></Button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* appearance: cover, description, thank-you */}
          <section className="grid gap-4 rounded-md border p-3 lg:grid-cols-[16rem_1fr]" data-testid="appearance">
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t('form.edit.cover')}</p>
              <div className="overflow-hidden rounded-md border">
                {d.coverPath ? <Img src={publicImageUrl(d.coverPath)} thumb={publicThumbUrl(d.coverPath)} alt="" aspect="16 / 9" /> : <div className="flex aspect-video items-center justify-center bg-muted text-muted-foreground"><ImageIcon className="h-6 w-6" aria-hidden="true" /></div>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setModal('cover')}>{t('form.edit.chooseCover')}</Button>
                {d.coverId && <Button size="sm" variant="ghost" onClick={() => patchDraft((cur) => ({ ...cur, coverId: null, coverPath: null }))}>{t('form.edit.removeCover')}</Button>}
              </div>
              <p className="text-xs text-muted-foreground">{t('form.edit.coverHint')}</p>
            </div>
            <div className="space-y-3">
              <BilingualField label={t('form.edit.description.form')} value={config.description} onChange={(description) => patchConfig({ description })} as="textarea" rows={2} />
              <BilingualField label={t('form.edit.thankYou')} value={config.thank_you.message} onChange={(message) => patchConfig({ thank_you: { ...config.thank_you, message } })} as="textarea" rows={2} />
              <p className="text-xs text-muted-foreground">{t('form.edit.thankYouHint')}</p>
              <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={config.thank_you.show_image} onChange={(e) => patchConfig({ thank_you: { ...config.thank_you, show_image: e.target.checked } })} />{t('form.edit.thankYouImage')}</label>
            </div>
          </section>

          {/* the questions, grouped by section */}
          {d.questions.length === 0 && d.sections.length === 0 ? (
            <EmptyState title={t('form.edit.empty')} body={t('form.edit.emptyBody')} action={<Button size="sm" onClick={() => addQuestion(null)}><Plus className="h-4 w-4" aria-hidden="true" />{t('form.edit.addQuestion')}</Button>} />
          ) : groups.map((g) => {
            const section = g.id ? d.sections.find((s) => s.id === g.id) : null
            if (!section && g.items.length === 0 && d.sections.length) return null
            return (
              <section key={g.id ?? 'none'} className="space-y-2" data-testid={`group-${g.id ?? 'none'}`}
                onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(null, g.id)}>
                {section ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Badge tone="purple">{t('form.edit.section')} {d.sections.indexOf(section) + 1}</Badge>
                      <span className="flex-1" />
                      <Button size="icon" variant="ghost" className="text-destructive" aria-label={`${t('form.edit.removeSection')}: ${biPick(section.title, lang)}`} onClick={() => removeSection(section)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                    </div>
                    <BilingualField label={t('form.edit.sectionTitle')} value={section.title} onChange={(title) => updateSection({ ...section, title })} />
                    <BilingualField className="mt-2" label={t('form.edit.sectionDescription')} value={section.description} onChange={(description) => updateSection({ ...section, description })} />
                  </div>
                ) : d.sections.length > 0 ? (
                  <p className="text-xs font-medium text-muted-foreground">{t('form.edit.noSection')} - {t('form.edit.noSectionHint')}</p>
                ) : null}
                <ul className="space-y-2">
                  {g.items.map((q, i) => {
                    const open = expanded === q.id
                    const errs = errors[q.id] ?? []
                    return (
                      <li key={q.id} className={cn('rounded-md border bg-card', errs.length && 'border-destructive', dragId === q.id && 'opacity-50')} data-testid="question-row"
                        draggable onDragStart={() => setDragId(q.id)} onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }} onDrop={(e) => { e.stopPropagation(); onDrop(q.id, g.id) }}>
                        <div className="flex flex-wrap items-center gap-2 p-2">
                          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" title={t('form.edit.dragHint')} />
                          <button type="button" className="min-w-0 flex-1 basis-48 text-start" onClick={() => setExpanded(open ? null : q.id)} aria-expanded={open}>
                            <span className="block truncate font-medium" dir="auto">{biPick(q.label, lang) || <span className="text-muted-foreground">{t('form.edit.label')}</span>}{q.required && <span className="text-destructive"> *</span>}</span>
                            <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
                              <Badge tone="outline">{t(`form.type.${q.type}`)}</Badge>
                              <code dir="ltr" className="inline-block max-w-full truncate align-bottom">{q.key}</code>
                              {q.semantic && <Badge tone="green">{t(`form.semantic.${q.semantic}`)}</Badge>}
                            </span>
                          </button>
                          <div className="ms-auto flex shrink-0 items-center">
                            <Button size="icon" variant="ghost" className="h-9 min-h-9 w-9 min-w-9" aria-label={t('form.edit.moveUp')} disabled={i === 0} onClick={() => moveInGroup(q, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                            <Button size="icon" variant="ghost" className="h-9 min-h-9 w-9 min-w-9" aria-label={t('form.edit.moveDown')} disabled={i === g.items.length - 1} onClick={() => moveInGroup(q, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                            <Button size="icon" variant="ghost" className="h-9 min-h-9 w-9 min-w-9" aria-label={t('form.edit.duplicate')} onClick={() => patchDraft((cur) => ({ ...cur, questions: duplicateQuestion(cur.questions, q.id) }))}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
                            <Button size="icon" variant="ghost" className="h-9 min-h-9 w-9 min-w-9 text-destructive" aria-label={`${t('form.edit.remove')}: ${biPick(q.label, lang) || q.key}`} onClick={() => removeQuestion(q)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                            <Button size="icon" variant="ghost" className="h-9 min-h-9 w-9 min-w-9" aria-label={open ? t('form.edit.collapse') : t('form.edit.expand')} onClick={() => setExpanded(open ? null : q.id)}>{open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}</Button>
                          </div>
                        </div>
                        {open && <QuestionEditor q={q} sections={d.sections} takenKeys={d.questions.map((x) => x.key)} takenSemantics={takenSemantics} errors={errs} onChange={updateQuestion} />}
                      </li>
                    )
                  })}
                </ul>
                <Button size="sm" variant="ghost" onClick={() => addQuestion(g.id)}><Plus className="h-4 w-4" aria-hidden="true" />{t('form.edit.addQuestion')}</Button>
              </section>
            )
          })}
        </div>
      )}

      {modal === 'cover' && <CoverPicker projectId={projectId} nodeId={node.id} userId={user?.id} currentId={d.coverId} onClose={() => setModal(null)} onSelect={(c) => { patchDraft((cur) => ({ ...cur, coverId: c?.id ?? null, coverPath: c?.image_path ?? null })); setModal(null) }} />}
      {modal === 'import' && <ImportTemplateModal projectId={projectId} nodeId={node.id} currentCount={d.questions.length} canDeleteGlobal={hasRole?.('super_admin')} onClose={() => setModal(null)} onImport={(tpl) => { patchDraft((cur) => ({ ...cur, sections: tpl.sections, questions: tpl.questions })); setConfig({ ...config, description: tpl.config.description, thank_you: tpl.config.thank_you, social: tpl.config.social, share: tpl.config.share }); setExpanded(null); setErrors({}) }} />}
      {modal === 'template' && <SaveTemplateModal projectId={projectId} nodeId={node.id} userId={user?.id} canGlobal={hasRole?.('super_admin')} coverId={d.coverId} draft={{ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, config, sections: d.sections, questions: d.questions }} onClose={() => setModal(null)} />}
    </NodeFrame>
  )
}
