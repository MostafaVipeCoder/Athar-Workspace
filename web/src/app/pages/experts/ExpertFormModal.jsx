import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../AuthContext.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { BilingualField } from '../../../ui/BilingualField.jsx'
import { Field, LABEL_CLASS } from '../../../ui/Field.jsx'
import { ImageField } from '../../../ui/ImageField.jsx'
import { publicImageUrl, publicThumbUrl } from '../../../data/storage.js'
import { discardExpertPhoto, uploadExpertPhoto, useExpertActions } from '../../../data/people.js'
import { emptyExpertForm, formFromProfile, formToPayload, isFormDirty, LIMITS, validateExpertForm } from '../../../lib/experts.js'
import { cn } from '../../../lib/cn.js'
import './experts.i18n.js'
import { DuplicatePanel, LanguagePicker, TagPicker } from './formParts.jsx'
import { errorText, serverFieldError } from './hooks.js'

/**
 * Create / edit an expert (the registry record): names, job title, organisation and bio in Arabic and English, a photo (through the central WebP pipeline: 512 px + a thumbnail),
 * contact data (staff only), links, languages, expertise tags and private staff notes. `expert` = a normalised profile (edit) or null (create).
 * Validation mirrors the server; the duplicate check runs while typing and a create over a likely duplicate needs an explicit confirmation. An edit is a PATCH (only what
 * changed) with the `updatedAt` token: if somebody saved in between, the dialog says so instead of overwriting.
 */
export default function ExpertFormModal({ expert = null, onClose, base, onSaved }) {
  const { t } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { can } = useAuth()
  const actions = useExpertActions()
  const qc = useQueryClient()
  const [form, setForm] = useState(() => formFromProfile(expert) ?? emptyExpertForm())
  const [errors, setErrors] = useState({})
  const [stale, setStale] = useState(false)
  const [formError, setFormError] = useState(null)
  const [confirmedDup, setConfirmedDup] = useState(false)
  const [serverDups, setServerDups] = useState(null)
  const [busy, setBusy] = useState(false)
  const alertBox = useRef(null) // the stale / form-level message: at the top of a scrolling dialog, so it is brought into view when it appears
  const uploaded = useRef(null) // a photo uploaded in THIS dialog and not saved yet (removed again when replaced or when the dialog is cancelled)
  const editing = Boolean(expert)
  const dirty = isFormDirty(form, expert ?? undefined)

  const set = (partial) => {
    setForm((f) => ({ ...f, ...partial }))
    setFormError(null)
  }
  const clearError = (...fields) => setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !fields.includes(k))))
  const msg = (key) => (key ? t(key) : undefined)

  async function requestClose() {
    if (busy) return
    if (dirty) {
      const ok = await confirm({ title: t('experts.form.discard.title'), message: t('experts.form.discard.body'), confirmLabel: t('experts.form.discard.confirm'), destructive: true })
      if (!ok) return
    }
    await discardExpertPhoto(uploaded.current)
    uploaded.current = null
    onClose()
  }

  async function onPhoto(file) {
    const path = await uploadExpertPhoto(file)
    const previous = uploaded.current
    uploaded.current = path
    if (previous) await discardExpertPhoto(previous)
    set({ photoPath: path })
    return path
  }
  async function onPhotoClear() {
    await discardExpertPhoto(uploaded.current)
    uploaded.current = null
    set({ photoPath: null })
  }

  async function save() {
    const found = validateExpertForm(form)
    setErrors(found)
    if (Object.keys(found).length) {
      setTimeout(() => document.querySelector('[data-expert-form] [aria-invalid="true"]')?.focus?.(), 0)
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      if (editing) {
        const patch = formToPayload(form, { original: expert })
        if (Object.keys(patch).length === 0) {
          onClose()
          return
        }
        const res = await actions.update.mutateAsync({ id: expert.id, patch, expectedAt: expert.updatedAt })
        uploaded.current = null // saved: the file belongs to the record now
        await discardExpertPhoto(res.oldPhotoPath)
        toast.success(t('experts.toast.saved'))
        onSaved?.(res)
        onClose()
      } else {
        const payload = formToPayload(form)
        const res = await actions.create.mutateAsync({ payload, force: confirmedDup })
        uploaded.current = null
        toast.success(t('experts.toast.created'))
        onSaved?.(res)
        onClose()
        navigate(`${base}/${res.id}`)
      }
    } catch (e) {
      if (e?.token === 'expert_duplicate') {
        setServerDups(e.duplicates)
        setFormError(t('experts.err.duplicate'))
      } else if (e?.token === 'expert_stale') {
        setStale(true)
      } else {
        const fe = serverFieldError(e)
        if (fe) setErrors({ [fe.field]: fe.key })
        else setFormError(errorText(t, e))
      }
    } finally {
      setBusy(false)
    }
  }

  const blockingDup = !editing && serverDups?.some((d) => d.blocking) && !confirmedDup
  const showsAlert = stale || Boolean(formError)
  useEffect(() => {
    if (showsAlert) alertBox.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [showsAlert])

  return (
    <Modal
      open
      onClose={requestClose}
      title={editing ? t('experts.form.edit') : t('experts.form.create')}
      description={t('experts.form.hint')}
      closeLabel={t('common.close')}
      className="sm:max-w-3xl"
      dismissible={!busy}
      footer={
        <>
          <Button variant="outline" onClick={requestClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={save} loading={busy} disabled={stale || (editing && !dirty)} data-testid="expert-save">
            {editing ? t('experts.form.save') : confirmedDup ? t('experts.form.createAnyway') : t('experts.form.createSave')}
          </Button>
        </>
      }
    >
      <form
        data-expert-form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!blockingDup) save()
        }}
        noValidate
      >
        {stale && (
          <div ref={alertBox} role="alert" className="space-y-2 rounded-card border border-destructive/50 bg-destructive/5 p-4" data-testid="expert-stale">
            <p className="font-semibold">{t('experts.err.stale.title')}</p>
            <p className="text-sm text-muted-foreground">{t('experts.err.stale')}</p>
            <Button variant="outline" size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ['experts'] }); onClose() }}>{t('experts.err.stale.action')}</Button>
          </div>
        )}
        {formError && !stale && <p ref={alertBox} role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive-text">{formError}</p>}

        {(!editing || can('experts:merge')) && (
          <fieldset className="space-y-1.5">
            <legend className={LABEL_CLASS}>{t('experts.field.kind')}</legend>
            <div className="flex flex-wrap gap-2">
              {['expert', 'team'].map((k) => (
                <label key={k} className={cn('inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm', form.kind === k ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-input')}>
                  <input type="radio" name="kind" value={k} checked={form.kind === k} onChange={() => set({ kind: k })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                  {t(`experts.kind.${k}.long`)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid gap-5 md:grid-cols-[14rem_minmax(0,1fr)]">
          <ImageField
            label={t('experts.field.photo')}
            profile="avatar"
            aspect="1 / 1"
            src={form.photoPath ? publicImageUrl(form.photoPath) : null}
            thumb={form.photoPath ? publicThumbUrl(form.photoPath) : null}
            onFile={onPhoto}
            onClear={onPhotoClear}
            disabled={busy}
            labels={{ choose: t('experts.photo.add'), replace: t('experts.photo.change'), remove: t('experts.photo.remove'), hint: t('experts.photo.hint') }}
            className="order-last max-w-[14rem] md:order-first"
          />
          <div className="space-y-4">
            <BilingualField label={t('experts.field.name')} required value={form.name} onChange={(name) => { set({ name }); clearError('name') }} error={msg(errors.name)} />
            <BilingualField label={t('experts.field.title')} value={form.title} onChange={(title) => { set({ title }); clearError('title') }} error={msg(errors.title)} />
            <BilingualField label={t('experts.field.company')} value={form.company} onChange={(company) => { set({ company }); clearError('company') }} error={msg(errors.company)} />
          </div>
        </div>

        <DuplicatePanel form={form} exclude={expert?.id ?? null} base={base} confirmed={confirmedDup} onConfirm={setConfirmedDup} serverMatches={serverDups} />

        <BilingualField label={t('experts.field.bio')} as="textarea" rows={4} value={form.bio} onChange={(bio) => { set({ bio }); clearError('bio') }} error={msg(errors.bio)} inputClassName="min-h-24 py-2" />

        <section className="space-y-3 rounded-card border bg-surface/40 p-4" aria-labelledby="expert-contact-title">
          <h3 id="expert-contact-title" className="text-base font-bold">{t('experts.form.contact')}</h3>
          <p className="text-xs text-muted-foreground">{t('experts.form.contact.hint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('experts.field.email')} type="email" dir="ltr" autoComplete="off" value={form.email} onChange={(e) => { set({ email: e.target.value }); clearError('email') }} error={msg(errors.email)} />
            <Field label={t('experts.field.phone')} type="tel" dir="ltr" autoComplete="off" inputMode="tel" value={form.phone} onChange={(e) => { set({ phone: e.target.value }); clearError('phone') }} error={msg(errors.phone)} placeholder="+20 ..." />
            <Field label={t('experts.field.linkedin')} type="url" dir="ltr" value={form.linkedin} onChange={(e) => { set({ linkedin: e.target.value }); clearError('linkedin') }} error={msg(errors.linkedin)} placeholder="https://linkedin.com/in/..." />
            <Field label={t('experts.field.website')} type="url" dir="ltr" value={form.website} onChange={(e) => { set({ website: e.target.value }); clearError('website') }} error={msg(errors.website)} placeholder="https://" />
          </div>
          <OtherLinks value={form.links} onChange={(links) => { set({ links }); clearError('links') }} error={msg(errors.links)} />
        </section>

        <LanguagePicker value={form.languages} onChange={(languages) => { set({ languages }); clearError('languages') }} error={msg(errors.languages)} />
        <TagPicker value={form.tags} onChange={(tags) => { set({ tags }); clearError('tags') }} error={msg(errors.tags)} />

        <Field
          label={t('experts.field.notes')}
          as="textarea"
          rows={3}
          value={form.notes}
          onChange={(e) => { set({ notes: e.target.value }); clearError('notes') }}
          error={msg(errors.notes)}
          hint={t('experts.field.notes.hint')}
          maxLength={LIMITS.long}
        />
        {/* Enter in a single-line field submits (the footer button is outside the form element) */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  )
}

/** Other profile links (at most 6): a small repeater below the two named ones. */
function OtherLinks({ value, onChange, error }) {
  const { t } = useLanguage()
  return (
    <div className="space-y-2">
      <p className={LABEL_CLASS}>{t('experts.field.links')}</p>
      {value.map((l, i) => (
        <div key={i} className="flex items-end gap-2">
          <Field label={t('experts.field.link', { n: i + 1 })} type="url" dir="ltr" className="flex-1" value={l.url} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://" />
          <Button variant="ghost" size="icon" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('experts.field.link.remove', { n: i + 1 })}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {value.length < LIMITS.links && (
        <Button variant="outline" size="sm" onClick={() => onChange([...value, { kind: 'other', url: '' }])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('experts.field.link.add')}
        </Button>
      )}
      {error && <p role="alert" className="text-xs text-destructive-text">{error}</p>}
    </div>
  )
}
