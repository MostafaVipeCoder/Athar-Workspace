import { useState } from 'react'
import { useAlumniPrograms } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { BilingualField } from '../../../ui/BilingualField.jsx'
import { Field } from '../../../ui/Field.jsx'
import { ChipSelect } from '../../../shared/alumni/pickers.jsx'
import { focusFirstInvalidSoon } from '../../../ui/focusFirstInvalid.js'
import { useToast } from '../../../ui/Toast.jsx'
import { OPP_TYPES, emptyOppForm, oppFormToPatch, oppToForm, validateOpp } from './adminLogic.js'
import { useAdminErrorText, useLabels } from './hooks.js'
import './i18n.common.js'
import './opportunities.i18n.js'

/**
 * Create / edit an opportunity (M6). The form works on strings; `oppFormToPatch` turns it into the columns (empty = null, an empty target list is left out). Publishing is NOT
 * here: it is one button on the card, so a draft can be saved half-written. Bilingual title / description / provider; a link instead of an upload (files are not stored here).
 */
export default function OpportunityForm({ opportunity, onClose, onSave }) {
  const { t, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.opp.${k}`, v)
  const labels = useLabels()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const programs = useAlumniPrograms()
  const [form, setForm] = useState(() => (opportunity ? oppToForm(opportunity) : emptyOppForm()))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const errors = validateOpp(form)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setTarget = (key, list) => setForm((f) => ({ ...f, target: { ...f.target, [key]: list } }))
  const err = (k) => (touched && errors[k] ? d(`err.${k}.${errors[k]}`) : null)

  async function submit(e) {
    e.preventDefault()
    setTouched(true)
    if (Object.keys(errors).length > 0) { focusFirstInvalidSoon(e.currentTarget); return }
    setBusy(true)
    try {
      await onSave(oppFormToPatch(form))
      toast.success(d('saved'))
      onClose()
    } catch (e2) {
      toast.error(`${d('actionFailed')} ${errorText(e2, { title_ar: d('titleLabel'), link: d('linkLabel'), deadline: d('deadlineLabel'), target: d('targetTitle') })}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} dismissible={!busy} title={opportunity ? d('formEdit') : d('formNew')} closeLabel={t('common.close')} className="sm:max-w-3xl"
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>{d('cancel')}</Button><Button type="submit" form="opp-form" loading={busy} data-testid="opp-save">{opportunity ? d('save') : d('saveDraft')}</Button></>}>
      <form id="opp-form" onSubmit={submit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field as="select" label={d('type')} value={form.type} onChange={(e) => set({ type: e.target.value })}>
            {OPP_TYPES.map((k) => <option key={k} value={k}>{d(`type.${k}`)}</option>)}
          </Field>
          <Field type="date" dir="ltr" label={d('deadlineLabel')} value={form.deadline} onChange={(e) => set({ deadline: e.target.value })} error={err('deadline')} />
        </div>
        <BilingualField label={d('titleLabel')} required value={{ en: form.title_en, ar: form.title_ar }} onChange={(v) => set({ title_en: v.en, title_ar: v.ar })} error={err('title_ar') ?? err('title_en')} />
        <BilingualField label={d('descriptionLabel')} as="textarea" rows={4} value={{ en: form.description_en, ar: form.description_ar }} onChange={(v) => set({ description_en: v.en, description_ar: v.ar })} error={err('description_ar') ?? err('description_en')} />
        <BilingualField label={d('providerLabel')} value={{ en: form.provider_en, ar: form.provider_ar }} onChange={(v) => set({ provider_en: v.en, provider_ar: v.ar })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field type="url" dir="ltr" label={d('linkLabel')} hint={d('linkHint')} placeholder="https://" value={form.link} onChange={(e) => set({ link: e.target.value })} error={err('link')} />
          <Field type="number" min={0} dir="ltr" label={d('orderLabel')} hint={d('orderHint')} value={form.order_index} onChange={(e) => set({ order_index: e.target.value })} />
        </div>
        <Field as="textarea" rows={3} label={d('eligibilityLabel')} value={form.eligibility} onChange={(e) => set({ eligibility: e.target.value })} error={err('eligibility')} />
        <fieldset className="space-y-3 rounded-card border p-4">
          <legend className="px-1 text-base font-bold">{d('targetTitle')}</legend>
          <p className="text-sm text-muted-foreground">{d('targetHint')}</p>
          <ChipSelect multiple label={d('targetPrograms')} options={(programs.data?.programs ?? []).map((p) => ({ value: p.id, label: pick(p, 'name') }))} value={form.target.program_ids} onChange={(v) => setTarget('program_ids', v)} />
          <ChipSelect multiple label={d('targetSectors')} options={labels.options('sector')} value={form.target.sectors} onChange={(v) => setTarget('sectors', v)} />
          <ChipSelect multiple label={d('targetStages')} options={labels.options('stage')} value={form.target.stages} onChange={(v) => setTarget('stages', v)} />
          <ChipSelect multiple label={d('targetGovernorates')} options={labels.options('governorate')} value={form.target.governorates} onChange={(v) => setTarget('governorates', v)} />
        </fieldset>
      </form>
    </Modal>
  )
}
