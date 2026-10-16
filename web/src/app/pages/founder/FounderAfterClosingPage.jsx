import { useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, CheckCircle2, Compass } from 'lucide-react'
import { useMyAlumniProfile } from '../../../data/alumni.js'
import { useCompanyAfterClosing, useSaveAfterClosing } from '../../../data/alumniClosed.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { Field } from '../../../ui/Field.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { CLOSED_MAX, CLOSED_TYPES, answerToForm, buildClosedPayload, closedFormChanged, validateClosedForm } from '../../../lib/alumniClosed.js'
import { parseAlumniError } from '../../../lib/alumni.js'
import { fieldErrorOf } from '../../../lib/alumniForms.js'
import { cn } from '../../../lib/cn.js'
import { ChipSelect, LookupSelect } from '../../../shared/alumni/pickers.jsx'
import { useAlumniErrorText } from '../../../shared/alumni/useAlumniErrorText.js'
import './i18n.js'
import './alumni.i18n.js'
import '../../../shared/alumni/i18n.js'
import '../../../shared/alumni/i18n.closed.js'

/** A checkbox row of 44 px (the interest flag). */
function CheckBox({ checked, onChange, label, hint }) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-start gap-2.5 rounded-input border bg-surface/40 p-3">
      <input id={id} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-semibold">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

/** The form of ONE closed company: the three kinds of answer, the fields of the chosen one, validation, save, and when it was last answered. */
function AnswerForm({ company, data }) {
  const { t, formatDate } = useLanguage()
  const toast = useToast()
  const errorText = useAlumniErrorText()
  const save = useSaveAfterClosing()
  const answer = data.answer
  const [form, setForm] = useState(() => answerToForm(answer))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const c = (k, v) => t(`alumni.closed.${k}`, v)
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setErrors({}); setFormError(null) }
  const type = form.answer_type
  const changed = closedFormChanged(answer, form)
  const fieldError = (k, label) => (errors[k] ? t('alumni.err.field', { field: label, reason: t(`alumni.reason.${errors[k]}`) }) : undefined)

  async function submit(ev) {
    ev.preventDefault()
    const found = validateClosedForm(form)
    if (Object.keys(found).length > 0) { setErrors(found); setFormError(c('fixErrors')); return }
    try {
      await save.mutateAsync({ companyId: company.id, data: buildClosedPayload(form) })
      toast.success(c('saved'))
    } catch (err) {
      const fe = fieldErrorOf(parseAlumniError(err))
      if (fe) setErrors({ [fe.field]: String(fe.key).replace('alumni.reason.', '') })
      setFormError(errorText(err))
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-card border bg-card p-4 sm:p-5" data-testid="after-closing-form">
      <div className="space-y-1" aria-live="polite">
        {answer ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="last-answered">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <span className="font-semibold">{c('lastAnswered', { date: formatDate(answer.answered_at, { dateStyle: 'medium' }) })}</span>
          </p>
        ) : <p className="text-sm text-muted-foreground" data-testid="not-answered">{c('notAnswered')}</p>}
        {data.answered_this_period && <p className="text-xs text-muted-foreground">{c('answeredThisQuarter')}</p>}
      </div>

      <ChipSelect
        label={c('question')}
        required
        value={type}
        onChange={(v) => set({ answer_type: v })}
        options={CLOSED_TYPES.map((k) => ({ value: k, label: c(`type.${k}`) }))}
        hint={type ? c(`typeHint.${type}`) : undefined}
        error={errors.answer_type ? t('alumni.err.field', { field: c('question'), reason: t(`alumni.reason.${errors.answer_type}`) }) : undefined}
      />

      {type === 'new_startup' && (
        <div className="space-y-4" data-testid="fields-new_startup">
          <Field label={`${c('field.venture_name')} *`} value={form.venture_name} maxLength={CLOSED_MAX.venture_name} onChange={(e) => set({ venture_name: e.target.value })} error={fieldError('venture_name', c('field.venture_name'))} autoComplete="off" />
          <LookupSelect kind="sector" required label={c('field.field')} value={form.field} onChange={(v) => set({ field: v })} error={fieldError('field', c('field.field'))} />
          <LookupSelect kind="stage" label={c('field.venture_stage')} value={form.venture_stage} onChange={(v) => set({ venture_stage: v })} error={fieldError('venture_stage', c('field.venture_stage'))} />
          <Field label={c('field.venture_url')} hint={c('hint.venture_url')} dir="ltr" inputMode="url" autoCapitalize="none" autoCorrect="off" value={form.venture_url} maxLength={CLOSED_MAX.venture_url} onChange={(e) => set({ venture_url: e.target.value })} error={fieldError('venture_url', c('field.venture_url'))} />
          <Field as="textarea" rows={3} label={c('field.venture_description')} hint={c('hint.venture_description')} value={form.venture_description} maxLength={CLOSED_MAX.venture_description} onChange={(e) => set({ venture_description: e.target.value })} error={fieldError('venture_description', c('field.venture_description'))} />
          <CheckBox checked={form.wants_programs} onChange={(v) => set({ wants_programs: v })} label={c('field.wants_programs')} hint={c('hint.wants_programs')} />
        </div>
      )}
      {type === 'employed' && (
        <div className="space-y-4" data-testid="fields-employed">
          <Field label={`${c('field.employer')} *`} value={form.employer} maxLength={CLOSED_MAX.employer} onChange={(e) => set({ employer: e.target.value })} error={fieldError('employer', c('field.employer'))} autoComplete="organization" />
          <Field label={`${c('field.job_title')} *`} value={form.job_title} maxLength={CLOSED_MAX.job_title} onChange={(e) => set({ job_title: e.target.value })} error={fieldError('job_title', c('field.job_title'))} autoComplete="organization-title" />
          <LookupSelect kind="sector" required label={c('field.employedField')} value={form.field} onChange={(v) => set({ field: v })} error={fieldError('field', c('field.employedField'))} />
        </div>
      )}
      {type === 'other' && (
        <div className="space-y-4" data-testid="fields-other">
          <Field as="textarea" rows={4} label={`${c('field.other_text')} *`} hint={c('hint.other_text')} value={form.other_text} maxLength={CLOSED_MAX.other_text} onChange={(e) => set({ other_text: e.target.value })} error={fieldError('other_text', c('field.other_text'))} />
        </div>
      )}

      {formError && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text" data-testid="form-error">{formError}</p>}
      <div className="space-y-2">
        <Button type="submit" className="w-full sm:w-auto" loading={save.isPending} disabled={!changed}>{c('save')}</Button>
        <p className="text-xs text-muted-foreground">{c('quarterlyNote')}</p>
      </div>
    </form>
  )
}

/** One closed company: loads its answer and shows the form (or says it is not closed). */
function CompanyAnswer({ company }) {
  const { t } = useLanguage()
  const q = useCompanyAfterClosing(company.id)
  if (q.isPending) return <div role="status" aria-busy="true"><Skeleton className="h-64 w-full" /></div>
  if (q.isError) return <ErrorState error={q.error} title={t('alumni.closed.loadFailed')} onRetry={() => q.refetch()} />
  if (!q.data.closed) {
    return (
      <EmptyState
        icon={Building2}
        title={t('alumni.closed.notClosedTitle')}
        body={t('alumni.closed.notClosedBody')}
        action={<Link to={`/alumni/founder/progress?company=${company.id}`} className={buttonClass({ className: 'mt-2' })}>{t('alumni.closed.toProgress')}</Link>}
      />
    )
  }
  // a saved answer starts a fresh form (its date and values come from the server)
  return <AnswerForm key={`${company.id}:${q.data.answer?.answered_at ?? 'none'}`} company={company} data={q.data} />
}

/**
 * /alumni/founder/after-closing?company=<id>: the page the reminder of a CLOSED company opens (owner decision 22). "What are you doing now?": a new venture (name, field, stage, link,
 * description, interested in joining Athar programs), a job (employer, role, the industry) or something else. The latest answer is kept with its date and can be changed any time.
 */
export default function FounderAfterClosingPage() {
  const { t, pick } = useLanguage()
  const [search, setSearch] = useSearchParams()
  const profileQ = useMyAlumniProfile()
  if (profileQ.isPending) return <div className="space-y-4" role="status" aria-busy="true"><span className="sr-only">{t('common.loading')}</span><Skeleton className="h-10 w-1/2" /><Skeleton className="h-64 w-full" /></div>
  if (profileQ.error) return <ErrorState error={profileQ.error} title={t('alumni.closed.loadFailed')} onRetry={profileQ.refetch} />

  const companies = profileQ.data?.companies ?? []
  const closed = companies.filter((x) => x.operating_status === 'closed')
  const asked = companies.find((x) => x.id === search.get('company'))
  const current = asked ?? closed[0]
  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="founder-after-closing">
      <div>
        <h1 className="text-section-title">{t('alumni.closed.title')}</h1>
        {current && <p className="mt-1 text-sm text-muted-foreground">{t('alumni.closed.subtitle', { company: pick(current, 'name') })}</p>}
      </div>
      {!current ? (
        <EmptyState icon={Compass} title={t('alumni.closed.noClosedTitle')} body={t('alumni.closed.noClosedBody')} action={<Link to="/alumni/founder/dashboard" className={buttonClass({ className: 'mt-2' })}>{t('alumni.closed.toHome')}</Link>} />
      ) : (
        <>
          {closed.length > 1 && (
            <div role="tablist" aria-label={t('alumni.closed.pickCompany')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {closed.map((x) => (
                <button key={x.id} role="tab" type="button" aria-selected={x.id === current.id} onClick={() => setSearch({ company: x.id }, { replace: true })} className={cn('inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', x.id === current.id ? 'border-foreground bg-foreground text-background' : 'border-input bg-background hover:border-foreground')}>
                  {pick(x, 'name')}
                </button>
              ))}
            </div>
          )}
          {closed.length === 1 && <p className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4" aria-hidden="true" />{pick(current, 'name')}<Badge tone="red">{t('alumni.closed.closedBadge')}</Badge></p>}
          <CompanyAnswer key={current.id} company={current} />
        </>
      )}
    </div>
  )
}
