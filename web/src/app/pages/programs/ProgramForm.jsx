import { useState } from 'react'
import { Field } from '../../../ui/Field.jsx'
import { BilingualField } from '../../../ui/BilingualField.jsx'
import { validateProgram, programToValues, programValuesToPatch } from '../forms.logic.js'
import { ImageField } from '../../../ui/ImageField.jsx'
import { Button } from '../../../ui/Button.jsx'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { PROGRAM_TYPES, VISIBILITY } from '../../../lib/constants.js'

/**
 * Program fields (01 section 5): name ar/en, description ar/en, type, year, visibility, cover.
 * `cover`: { src, thumb, onFile, onClear } is provided by the page (create: keeps the File; edit: uploads immediately).
 */
export default function ProgramForm({ initial, onSubmit, submitLabel, busy, cover, onCancel }) {
  const { t } = useLanguage()
  const [values, setValues] = useState(() => initial ?? programToValues(null))
  const [errors, setErrors] = useState({})
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }))

  function submit(e) {
    e.preventDefault()
    const errs = validateProgram(values)
    setErrors(errs)
    if (Object.keys(errs).length) return
    onSubmit(programValuesToPatch(values))
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="program-form">
      <BilingualField label={t('programs.form.name')} required value={values.name} onChange={(v) => set('name', v)} error={errors.name && t(errors.name)} />
      <BilingualField label={t('programs.form.description')} as="textarea" value={values.description} onChange={(v) => set('description', v)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('programs.form.type')} list="program-types" value={values.program_type} onChange={(e) => set('program_type', e.target.value)} />
        <datalist id="program-types">
          {PROGRAM_TYPES.map((x) => (
            <option key={x} value={x}>{t(`programs.type.${x}`)}</option>
          ))}
        </datalist>
        <Field label={t('programs.form.year')} type="number" inputMode="numeric" min="2000" max="2100" dir="ltr" value={values.year} onChange={(e) => set('year', e.target.value)} error={errors.year && t(errors.year)} />
        <Field as="select" label={t('programs.form.visibility')} value={values.visibility} onChange={(e) => set('visibility', e.target.value)} hint={t(`visibility.hint.${values.visibility}`)}>
          {VISIBILITY.map((v) => (
            <option key={v} value={v}>{t(`visibility.${v}`)}</option>
          ))}
        </Field>
      </div>
      {cover && (
        <ImageField
          label={t('programs.form.cover')}
          src={cover.src}
          thumb={cover.thumb}
          onFile={cover.onFile}
          onClear={cover.onClear}
          labels={{ choose: t('image.choose'), replace: t('image.replace'), remove: t('image.remove'), hint: t('image.hint') }}
          errorText={(code) => t(`errors.image.${code}`)}
        />
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
        )}
        <Button type="submit" loading={busy}>{submitLabel ?? t('common.save')}</Button>
      </div>
    </form>
  )
}
