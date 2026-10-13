import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import './i18n.js'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { SUPPORTED_COUNTRIES } from '../../lib/contact.js'
import { DEFAULT_COUNTRIES, QUESTION_TYPES, SEMANTICS, SEMANTIC_TYPES, applySemantic, emptyOption, keyFromLabel, suggestSemantic } from './formLogic.js'

const selectCls = 'min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm'

/**
 * The expanded editor of ONE question (inside the builder): label/help/placeholder (bilingual), type, semantic role
 * (with a one-click suggestion from the label), key, section, required, options (select/multiselect), validation
 * (lengths, min/max, pattern, custom error, phone countries). Pure controlled component: `onChange(next)`.
 */
export function QuestionEditor({ q, sections, takenKeys, takenSemantics, errors = [], onChange }) {
  const { t } = useLanguage()
  const [showMore, setShowMore] = useState(false)
  const patch = (p) => onChange({ ...q, ...p })
  const otherKeys = takenKeys.filter((k) => k !== q.key)
  const suggestion = !q.semantic ? suggestSemantic(q.label, q.type, takenSemantics.filter((s) => s !== q.semantic)) : null
  const semanticOptions = SEMANTICS.filter((s) => SEMANTIC_TYPES[s].includes(q.type) && (!takenSemantics.includes(s) || s === q.semantic))
  const hasOptions = q.type === 'select' || q.type === 'multiselect'

  function onLabel(label) {
    const next = { ...q, label }
    if (!q.semantic && (!q.key || q.key === keyFromLabel(q.label, otherKeys, 1) || /^q_\d+$/.test(q.key))) next.key = keyFromLabel(label, otherKeys, otherKeys.length + 1)
    onChange(next)
  }
  function onType(type) {
    const next = { ...q, type }
    if (q.semantic && !SEMANTIC_TYPES[q.semantic].includes(type)) { next.semantic = null }
    if (type === 'tel' && !(q.validation?.allowedCountries?.length)) next.validation = { ...q.validation, allowedCountries: [...DEFAULT_COUNTRIES] }
    if ((type === 'select' || type === 'multiselect') && !(q.options?.length)) next.options = [emptyOption('')]
    onChange(next)
  }
  const setOption = (i, p) => patch({ options: q.options.map((o, j) => (j === i ? { ...o, ...p } : o)) })
  const toggleCountry = (code, on) => patch({ validation: { ...q.validation, allowedCountries: on ? [...(q.validation.allowedCountries ?? []), code] : (q.validation.allowedCountries ?? []).filter((c) => c !== code) } })

  return (
    <div className="space-y-4 border-t bg-muted/20 p-3" data-testid={`question-editor-${q.id}`}>
      {errors.length > 0 && <ul className="space-y-0.5 text-xs text-destructive">{errors.map((e) => <li key={e}>{t(e)}</li>)}</ul>}
      <BilingualField label={t('form.edit.label')} value={q.label} onChange={onLabel} required />
      {suggestion && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm" data-testid="semantic-suggestion">
          <span>{t('form.semantic.suggest', { role: t(`form.semantic.${suggestion}`) })}</span>
          <Button size="sm" variant="secondary" onClick={() => onChange(applySemantic(q, suggestion))}>{t('form.semantic.apply')}</Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor={`type-${q.id}`} className="block text-sm font-medium">{t('form.edit.type')}</label>
          <select id={`type-${q.id}`} value={q.type} onChange={(e) => onType(e.target.value)} className={selectCls}>
            {QUESTION_TYPES.map((ty) => <option key={ty} value={ty}>{t(`form.type.${ty}`)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`sem-${q.id}`} className="block text-sm font-medium">{t('form.edit.semantic')}</label>
          <select id={`sem-${q.id}`} value={q.semantic ?? ''} onChange={(e) => onChange(applySemantic(q, e.target.value || null))} className={selectCls} data-testid={`semantic-${q.id}`}>
            <option value="">{t('form.semantic.none')}</option>
            {semanticOptions.map((s) => <option key={s} value={s}>{t(`form.semantic.${s}`)}</option>)}
          </select>
          {q.semantic && <p className="text-xs text-muted-foreground">{t('form.semantic.keyNote', { key: q.semantic })}</p>}
        </div>
        <Field label={t('form.edit.key')} value={q.key} dir="ltr" disabled={Boolean(q.semantic)} onChange={(e) => patch({ key: e.target.value.trim().toLowerCase() })} hint={t('form.edit.keyHint')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`sec-${q.id}`} className="block text-sm font-medium">{t('form.edit.sectionOf')}</label>
          <select id={`sec-${q.id}`} value={q.section_id ?? ''} onChange={(e) => patch({ section_id: e.target.value || null })} className={selectCls}>
            <option value="">{t('form.edit.noSection')}</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.title.en || s.title.ar || t('form.edit.section')}</option>)}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" className="h-4 w-4" checked={q.required} onChange={(e) => patch({ required: e.target.checked })} />{t('form.edit.required')}</label>
      </div>
      {hasOptions && (
        <fieldset className="space-y-2" data-testid="options-editor">
          <legend className="text-sm font-medium">{t('form.edit.options')}</legend>
          {q.options.map((o, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
              <Field label={`${t('form.edit.optionValue')} ${i + 1}`} value={o.value} onChange={(e) => setOption(i, { value: e.target.value, label: { ...o.label, en: o.label.en === o.value || !o.label.en ? e.target.value : o.label.en } })} />
              <Field label={t('form.edit.optionAr')} value={o.label.ar} dir="rtl" onChange={(e) => setOption(i, { label: { ...o.label, ar: e.target.value } })} />
              <label className="flex min-h-11 items-center gap-2 self-end text-sm whitespace-nowrap"><input type="checkbox" className="h-4 w-4" checked={o.is_other} onChange={(e) => setOption(i, { is_other: e.target.checked })} />{t('form.edit.optionOther')}</label>
              <Button variant="ghost" size="icon" className="self-end text-destructive" aria-label={`${t('form.edit.remove')}: ${o.value}`} onClick={() => patch({ options: q.options.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => patch({ options: [...q.options, emptyOption('')] })}><Plus className="h-4 w-4" aria-hidden="true" />{t('form.edit.addOption')}</Button>
            <Field as="textarea" rows={2} className="min-w-64 flex-1" label={t('form.edit.optionsPaste')} value="" onChange={(e) => {
              const lines = e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
              if (lines.length > 1) patch({ options: [...q.options.filter((o) => o.value), ...lines.map((v) => emptyOption(v))] })
            }} />
          </div>
        </fieldset>
      )}
      {q.type === 'file' && <p className="text-xs text-muted-foreground">{t('form.edit.fileHint')}</p>}
      {q.type === 'hidden' && <p className="text-xs text-muted-foreground">{t('form.edit.hiddenHint', { key: q.key })}</p>}
      {q.type === 'tel' && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t('form.edit.countries')}</legend>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_COUNTRIES.map((c) => (
              <label key={c.code} className="flex min-h-9 items-center gap-1 rounded-md border px-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={(q.validation.allowedCountries ?? []).includes(c.code)} onChange={(e) => toggleCountry(c.code, e.target.checked)} />{t(`form.country.${c.code}`)} <span dir="ltr" className="text-muted-foreground">{c.dialCode}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Button variant="link" size="sm" className="px-0" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>{showMore ? t('form.edit.less') : t('form.edit.more')}</Button>
      {showMore && (
        <div className="space-y-3">
          <BilingualField label={t('form.edit.description')} value={q.description} onChange={(description) => patch({ description })} as="textarea" rows={2} />
          <BilingualField label={t('form.edit.placeholder')} value={q.placeholder} onChange={(placeholder) => patch({ placeholder })} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('form.edit.validation')}</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              {(q.type === 'text' || q.type === 'textarea') && (
                <>
                  <Field label={t('form.edit.minLength')} type="number" min="0" value={q.validation.minLength ?? ''} onChange={(e) => patch({ validation: { ...q.validation, minLength: e.target.value === '' ? null : Number(e.target.value) } })} />
                  <Field label={t('form.edit.maxLength')} type="number" min="1" value={q.validation.maxLength ?? ''} onChange={(e) => patch({ validation: { ...q.validation, maxLength: e.target.value === '' ? null : Number(e.target.value) } })} />
                  <Field label={t('form.edit.pattern')} className="sm:col-span-2" dir="ltr" value={q.validation.pattern ?? ''} onChange={(e) => patch({ validation: { ...q.validation, pattern: e.target.value } })} />
                </>
              )}
              {q.type === 'number' && (
                <>
                  <Field label={t('form.edit.min')} type="number" value={q.validation.min ?? ''} onChange={(e) => patch({ validation: { ...q.validation, min: e.target.value === '' ? null : Number(e.target.value) } })} />
                  <Field label={t('form.edit.max')} type="number" value={q.validation.max ?? ''} onChange={(e) => patch({ validation: { ...q.validation, max: e.target.value === '' ? null : Number(e.target.value) } })} />
                </>
              )}
            </div>
            <BilingualField label={t('form.edit.customError')} value={q.validation.customError} onChange={(customError) => patch({ validation: { ...q.validation, customError } })} />
          </fieldset>
        </div>
      )}
    </div>
  )
}
