import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Copy, Lock, Paperclip, Trash2 } from 'lucide-react'
import './i18n.js'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { Img } from '../../ui/Img.jsx'
import { PhoneField } from '../../ui/PhoneField.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { buildShareUrl } from '../../lib/links.js'
import { formatInTz } from '../../lib/time/tz.js'
import { cn } from '../../lib/cn.js'
import { SHARE_PLATFORMS, buildSteps, cleanAnswers, fromQuestionRow, fromSectionRow, normalizeFormConfig, renderThankYou, validateAnswers } from './formLogic.js'

const biOf = (row, base, lang) => (lang === 'ar' ? row?.[`${base}_ar`] || row?.[`${base}_en`] : row?.[`${base}_en`] || row?.[`${base}_ar`]) || ''
const pickBi = (pair, lang) => (lang === 'ar' ? pair?.ar || pair?.en : pair?.en || pair?.ar) || ''
const inputCls = 'min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground'

function Label({ id, q, lang, t }) {
  return (
    <label htmlFor={id} className="block text-sm font-medium">
      {pickBi(q.label, lang)}
      {q.required ? <span aria-hidden="true" className="text-destructive"> *</span> : <span className="ms-2 text-xs font-normal text-muted-foreground">{t('form.public.optional')}</span>}
    </label>
  )
}

function ChoiceField({ q, value, onChange, error, lang, t, id }) {
  const multi = q.type === 'multiselect'
  const otherOpt = q.options.find((o) => o.is_other)
  const known = new Set(q.options.filter((o) => !o.is_other).map((o) => o.value))
  const arr = multi ? (Array.isArray(value) ? value : value ? [value] : []) : []
  const otherValue = multi ? arr.find((v) => !known.has(v)) ?? '' : !multi && value && !known.has(value) ? value : ''
  const [otherOn, setOtherOn] = useState(Boolean(otherValue))
  const errId = `${id}-err`
  const label = (o) => pickBi(o.label, lang) || o.value

  if (multi) {
    const toggle = (v, on) => onChange(on ? [...arr.filter((x) => x !== v), v] : arr.filter((x) => x !== v))
    return (
      <fieldset className="space-y-2" aria-describedby={error ? errId : undefined} aria-invalid={error ? true : undefined}>
        <legend className="text-sm font-medium">{pickBi(q.label, lang)}{q.required && <span aria-hidden="true" className="text-destructive"> *</span>}</legend>
        {q.options.filter((o) => !o.is_other).map((o) => (
          <label key={o.value} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={arr.includes(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />{label(o)}
          </label>
        ))}
        {otherOpt && (
          <div className="space-y-2">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={otherOn} onChange={(e) => { setOtherOn(e.target.checked); if (!e.target.checked) onChange(arr.filter((x) => known.has(x))) }} />{label(otherOpt) || t('form.public.other')}
            </label>
            {otherOn && <input aria-label={t('form.public.otherPlaceholder')} placeholder={t('form.public.otherPlaceholder')} className={inputCls} value={otherValue} onChange={(e) => onChange([...arr.filter((x) => known.has(x)), ...(e.target.value ? [e.target.value] : [])])} />}
          </div>
        )}
        {error && <p id={errId} className="text-xs text-destructive">{error}</p>}
      </fieldset>
    )
  }
  const selectValue = otherOn ? '__other__' : value ?? ''
  return (
    <div className="space-y-1.5">
      <Label id={id} q={q} lang={lang} t={t} />
      <select id={id} value={selectValue} aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined} className={cn(inputCls, error && 'border-destructive')} onChange={(e) => {
        if (e.target.value === '__other__') { setOtherOn(true); onChange('') } else { setOtherOn(false); onChange(e.target.value) }
      }}>
        <option value="">{t('form.public.choose')}</option>
        {q.options.filter((o) => !o.is_other).map((o) => <option key={o.value} value={o.value}>{label(o)}</option>)}
        {otherOpt && <option value="__other__">{label(otherOpt) || t('form.public.other')}</option>}
      </select>
      {otherOn && <input aria-label={t('form.public.otherPlaceholder')} placeholder={t('form.public.otherPlaceholder')} className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />}
      {error && <p id={errId} className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function FileField({ q, value, onChange, error, lang, t, id, onUpload, preview }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [uploadError, setUploadError] = useState(null)
  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !onUpload) return
    setBusy(true)
    setUploadError(null)
    try {
      const path = await onUpload(file)
      setName(file.name)
      onChange(path)
    } catch (err) {
      setUploadError(t(err?.messageKey ?? 'form.err.fileUpload'))
    } finally {
      setBusy(false)
    }
  }
  const disabled = preview || !onUpload
  return (
    <div className="space-y-1.5">
      <Label id={id} q={q} lang={lang} t={t} />
      <input ref={inputRef} id={id} type="file" className="sr-only" onChange={pick} disabled={disabled || busy} accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.txt" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" loading={busy} disabled={disabled} onClick={() => inputRef.current?.click()}>
          <Paperclip className="h-4 w-4" aria-hidden="true" />{value ? t('form.public.fileChange') : t('form.public.file')}
        </Button>
        {value && <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{name || t('form.public.fileDone')}</span>}
        {value && <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(''); setName('') }}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('form.public.fileRemove')}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{disabled ? t('form.public.previewUpload') : t('form.public.fileHint')}</p>
      {(error || uploadError) && <p className="text-xs text-destructive">{error ?? uploadError}</p>}
    </div>
  )
}

function QuestionField({ q, value, onChange, error, lang, t, onUpload, preview }) {
  const id = `q-${q.id}`
  const help = pickBi(q.description, lang)
  const placeholder = pickBi(q.placeholder, lang) || undefined
  let field
  switch (q.type) {
    case 'textarea':
      field = <Field as="textarea" rows={4} label={<>{pickBi(q.label, lang)}{q.required && <span aria-hidden="true" className="text-destructive"> *</span>}</>} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} error={error} hint={help} />
      break
    case 'tel':
      field = <PhoneField label={pickBi(q.label, lang)} required={q.required} value={value ?? ''} onChange={onChange} countries={q.validation?.allowedCountries} error={error} hint={help} lang={lang} />
      break
    case 'select': case 'multiselect':
      field = <ChoiceField q={q} value={value} onChange={onChange} error={error} lang={lang} t={t} id={id} />
      break
    case 'file':
      field = <FileField q={q} value={value} onChange={onChange} error={error} lang={lang} t={t} id={id} onUpload={onUpload} preview={preview} />
      break
    default: {
      const type = q.type === 'email' ? 'email' : q.type === 'number' ? 'text' : q.type === 'url' ? 'url' : q.type === 'date' ? 'date' : 'text'
      const extra = q.type === 'number' ? { inputMode: 'decimal' } : q.type === 'email' ? { inputMode: 'email', autoComplete: 'email', dir: 'ltr' } : q.type === 'url' ? { inputMode: 'url', dir: 'ltr' } : {}
      field = <Field type={type} label={<>{pickBi(q.label, lang)}{q.required ? <span aria-hidden="true" className="text-destructive"> *</span> : <span className="ms-2 text-xs font-normal text-muted-foreground">{t('form.public.optional')}</span>}</>} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} error={error} hint={help} {...extra} />
    }
  }
  return <div data-testid={`field-${q.key}`}>{field}{help && (q.type === 'select' || q.type === 'multiselect' || q.type === 'file') && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}</div>
}

/**
 * The respondent form (design 01 section 3.2): cover, title, description, sections as wizard steps, typed fields with
 * client validation (server validates again), honeypot, closed state and the thank-you screen with share buttons.
 * Used by the public page (/forms/:ref) and by the PM preview (View mode) so "preview = what the visitor sees" holds.
 *
 * Props: form = get_public_form payload (rows); onSubmit(cleanAnswers, { website }) -> { ok, fieldErrors?, message? };
 * onUpload(file) -> storage path (absent = uploads disabled); initialAnswers (URL prefill); publicUrl (share);
 * onShare(platform); preview; tz (project zone for closed dates).
 */
export default function FormRenderer({ form, onSubmit, onUpload, initialAnswers = {}, publicUrl = null, onShare, preview = false, tz = 'Africa/Cairo', hideHeader = false }) {
  const { t, lang } = useLanguage()
  const questions = useMemo(() => (form?.questions ?? []).map(fromQuestionRow), [form])
  const sections = useMemo(() => (form?.sections ?? []).map(fromSectionRow), [form])
  const config = useMemo(() => normalizeFormConfig({ thank_you: form?.thank_you, social: form?.social }), [form])
  const steps = useMemo(() => buildSteps(sections, questions), [sections, questions])
  const [answers, setAnswers] = useState(initialAnswers)
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null) // { answers }
  const [failure, setFailure] = useState(null)
  const [copied, setCopied] = useState(false)
  const website = useRef('')
  const topRef = useRef(null)

  useEffect(() => {
    if (step > 0) topRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [step])

  const title = biOf(form, 'name', lang)
  const description = biOf(form, 'description', lang)
  const cover = form?.cover_path ? publicImageUrl(form.cover_path) : null
  const coverThumb = form?.cover_path ? publicThumbUrl(form.cover_path) : null
  const errText = (e) => (e ? (e.text ?? t(e.key, e.vars)) : null)

  const set = (key, v) => {
    setAnswers((a) => ({ ...a, [key]: v }))
    if (errors[key]) setErrors((e) => { const n = { ...e }; delete n[key]; return n })
  }

  function validateStep(i) {
    const qs = steps[i]?.questions ?? []
    const errs = validateAnswers(qs, answers, lang)
    setErrors((e) => ({ ...Object.fromEntries(Object.entries(e).filter(([k]) => !qs.some((q) => q.key === k))), ...errs }))
    if (Object.keys(errs).length) {
      const first = qs.find((q) => errs[q.key])
      document.querySelector(`[data-testid="field-${first?.key}"] input, [data-testid="field-${first?.key}"] select, [data-testid="field-${first?.key}"] textarea`)?.focus?.()
      return false
    }
    return true
  }

  async function submit(e) {
    e?.preventDefault?.()
    setFailure(null)
    if (!validateStep(step)) return
    const all = validateAnswers(questions, answers, lang)
    if (Object.keys(all).length) {
      setErrors(all)
      const idx = steps.findIndex((s) => s.questions.some((q) => all[q.key]))
      if (idx >= 0) setStep(idx)
      return
    }
    setSubmitting(true)
    try {
      const clean = cleanAnswers(questions, answers)
      const r = await onSubmit(clean, { website: website.current })
      if (r?.ok) {
        setDone({ answers: clean })
      } else {
        if (r?.fieldErrors) {
          const fe = Object.fromEntries(Object.entries(r.fieldErrors).map(([k, mk]) => [k, { key: mk }]))
          setErrors(fe)
          const idx = steps.findIndex((s) => s.questions.some((q) => fe[q.key]))
          if (idx >= 0) setStep(idx)
        }
        setFailure(r?.message === null && r?.fieldErrors ? null : r?.message ?? t('form.public.failed'))
      }
    } catch (err) {
      setFailure(t(err?.messageKey ?? 'form.public.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      onShare?.('copy')
    } catch {
      /* clipboard blocked: the URL is visible on screen */
    }
  }

  if (!form) return null

  // ---- closed
  if (!form.is_open && !preview) {
    const reason = form.closed_reason ?? 'inactive'
    const date = reason === 'not_open' ? form.opens_at : form.closes_at
    return (
      <div className="py-6" data-testid="form-closed">
        {cover && !hideHeader && <Img src={cover} thumb={coverThumb} alt="" aspect="21 / 9" className="mb-4 rounded-card" eager />}
        {!hideHeader && <h1 className="mb-3 text-section-title">{title}</h1>}
        <EmptyState icon={Lock} title={t('form.public.closedTitle')} body={t(`form.public.closed.${reason}`, { date: date ? formatInTz(date, tz, lang) : '' })} />
      </div>
    )
  }

  // ---- thank-you
  if (done) {
    const message = renderThankYou(pickBi(config.thank_you.message, lang), done.answers, questions) || t('form.public.thanksDefault')
    const channels = SHARE_PLATFORMS.filter((p) => config.social[p])
    return (
      <div className="py-6 text-center" data-testid="form-success">
        {config.thank_you.show_image && cover && <Img src={cover} thumb={coverThumb} alt="" aspect="21 / 9" className="mb-4 rounded-card" eager />}
        <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-success" aria-hidden="true" />
        <h1 className="text-section-title">{t('form.public.thanksTitle')}</h1>
        <p className="mx-auto mt-2 max-w-prose whitespace-pre-line text-muted-foreground">{message}</p>
        {publicUrl && (
          <div className="mt-6 space-y-2">
            <p className="text-sm font-medium">{t('form.public.share')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {channels.map((p) => {
                const { href } = buildShareUrl(p, `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}source=${p}`, title)
                return <a key={p} href={href} target="_blank" rel="noopener noreferrer" onClick={() => onShare?.(p)} className="tap-target inline-flex items-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">{t(`form.social.${p}`)}</a>
              })}
              <Button type="button" variant="outline" size="md" onClick={copyLink}><Copy className="h-4 w-4" aria-hidden="true" />{copied ? t('form.public.copied') : t('form.public.copyLink')}</Button>
            </div>
          </div>
        )}
        <Button type="button" variant="link" className="mt-6" onClick={() => { setDone(null); setAnswers(initialAnswers); setErrors({}); setStep(0) }}>{t('form.public.again')}</Button>
      </div>
    )
  }

  const current = steps[step] ?? { questions: [] }
  const last = step === steps.length - 1
  return (
    <form onSubmit={submit} noValidate className="space-y-5 py-4" data-testid="form-renderer" aria-busy={submitting || undefined}>
      <div ref={topRef} />
      {!hideHeader && (
        <header className="space-y-3">
          {cover && <Img src={cover} thumb={coverThumb} alt="" aspect="21 / 9" className="rounded-card" eager />}
          <h1 className="text-section-title">{title}</h1>
          {description && <p className="whitespace-pre-line text-muted-foreground">{description}</p>}
        </header>
      )}
      {steps.length > 1 && (
        <nav aria-label={t('form.public.step', { n: step + 1, total: steps.length })} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t('form.public.step', { n: step + 1, total: steps.length })}</p>
          <ol className="flex gap-1">
            {steps.map((s, i) => <li key={s.id} className={cn('h-1.5 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} aria-current={i === step ? 'step' : undefined} />)}
          </ol>
          {current.title && <h2 className="text-lg font-bold">{pickBi(current.title, lang)}</h2>}
          {current.description && pickBi(current.description, lang) && <p className="text-sm text-muted-foreground">{pickBi(current.description, lang)}</p>}
        </nav>
      )}
      {/* the site's contact-form card: #f2f2f2 panel, 15px radius, fields 20px apart */}
      <div className="space-y-field-gap rounded-card bg-surface p-4 sm:p-panel-pad">
        {current.questions.map((q) => (
          <QuestionField key={q.id} q={q} value={answers[q.key]} onChange={(v) => set(q.key, v)} error={errText(errors[q.key])} lang={lang} t={t} onUpload={preview ? null : onUpload} preview={preview} />
        ))}
      </div>
      {/* honeypot: hidden from people and assistive tech; bots that fill it are dropped server-side */}
      <div className="absolute -start-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="form-website">Website</label>
        <input id="form-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" onChange={(e) => { website.current = e.target.value }} />
      </div>
      {failure && <p role="alert" className="rounded-input border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive-text">{failure}</p>}
      {Object.keys(errors).some((k) => current.questions.some((q) => q.key === k)) && <p role="status" className="text-sm text-destructive-text">{t('form.public.fixErrors')}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        {step > 0 ? <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>{t('form.public.back')}</Button> : <span />}
        {last ? (
          <Button type="submit" size="lg" loading={submitting} className="min-w-40 rounded-sm" data-testid="form-submit">{submitting ? t('form.public.submitting') : t('form.public.submit')}</Button>
        ) : (
          <Button type="button" size="lg" className="min-w-40 rounded-sm" onClick={() => { if (validateStep(step)) setStep((s) => s + 1) }} data-testid="form-next">{t('form.public.next')}</Button>
        )}
      </div>
    </form>
  )
}
