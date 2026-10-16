import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import { previewAlumniReminderTemplate, useAlumniQuarterSettings, useAlumniReminderCampaigns, useQuarterMutations } from '../../../data/alumniQuarters.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { appBaseUrl } from '../../../lib/links.js'
import { periodLabel } from '../../../lib/alumniQuarters.js'
import { useEditText } from '../../../shared/alumni/useEditText.js'
import { AdminPage, CheckRow, SectionCard, Segmented } from './ui.jsx'
import { useAdminErrorText, useDebounced } from './hooks.js'
import { useQuery } from '@tanstack/react-query'
import './i18n.common.js'
import './quarters.i18n.js'
import './closed.i18n.js'
import '../../../shared/alumni/i18n.quarters.js'
import '../../../shared/alumni/i18n.edit.js'

const FIELDS = [
  { key: 'notif_title', rows: 1, max: 200 }, { key: 'notif_body', rows: 3, max: 1000 },
  { key: 'email_subject', rows: 1, max: 200 }, { key: 'email_body', rows: 9, max: 4000 },
]

/** The schedule: automatic freezing / reminders, the offsets (days before the quarter closes), the hour (Cairo), the address e-mail links start with. */
function ScheduleCard({ s }) {
  const { t, tn, lang } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const qn = (k, n, v) => tn(`alumni.admin.qs.${k}`, n, v)
  const e = useEditText()
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { saveSettings } = useQuarterMutations()
  const [offsets, setOffsets] = useState((s.reminder_offsets ?? []).join(', '))
  const [hour, setHour] = useState(String(s.send_hour))
  const [url, setUrl] = useState(s.app_base_url ?? '')
  const [autoRem, setAutoRem] = useState(Boolean(s.auto_reminders))
  const [autoFreeze, setAutoFreeze] = useState(Boolean(s.auto_freeze))
  const [error, setError] = useState(null)
  const parsed = offsets.split(/[\s,،]+/).filter(Boolean).map(Number)

  async function save(ev) {
    ev.preventDefault()
    setError(null)
    if (parsed.some((n) => !Number.isInteger(n))) { setError(q('sch.badOffsets')); return }
    try {
      await saveSettings.mutateAsync({ auto_reminders: autoRem, auto_freeze: autoFreeze, reminder_offsets: parsed, send_hour: Number(hour), app_base_url: url.trim() === '' ? null : url.trim() })
      toast.success(q('sch.saved'))
    } catch (err) { setError(errorText(err, { reminder_offsets: q('sch.offsets'), send_hour: q('sch.hour'), app_base_url: q('sch.url') })) }
  }
  return (
    <SectionCard id="schedule" title={q('sch.title')} description={q('sch.desc')} testId="schedule-card">
      <form onSubmit={save} className="space-y-4" noValidate>
        <CheckRow checked={autoRem} onChange={setAutoRem} label={q('sch.autoReminders')} hint={q('sch.autoRemindersHint')} />
        <CheckRow checked={autoFreeze} onChange={setAutoFreeze} label={q('sch.autoFreeze')} hint={q('sch.autoFreezeHint')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={q('sch.offsets')} hint={q('sch.offsetsHint')} dir="ltr" inputMode="numeric" value={offsets} onChange={(ev) => setOffsets(ev.target.value)} />
          <Field label={q('sch.hour')} hint={q('sch.hourHint', { zone: s.timezone === 'Africa/Cairo' ? q('zoneCairo') : s.timezone })} dir="ltr" inputMode="numeric" value={hour} onChange={(ev) => setHour(ev.target.value)} />
        </div>
        <Field label={q('sch.url')} hint={s.app_base_url || url ? q('sch.urlHint') : q('sch.urlMissing', { suggestion: appBaseUrl() })} dir="ltr" placeholder={appBaseUrl()} value={url} onChange={(ev) => setUrl(ev.target.value)} />
        {error && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={saveSettings.isPending}><Save className="h-4 w-4" aria-hidden="true" />{t('common.save')}</Button>
          <span className="text-xs text-muted-foreground" data-testid="scheduler-state">{s.scheduler?.enabled ? q('sch.schedulerOn', { when: e.dateTime(s.scheduler.last_run_at) || '-' }) : q('sch.schedulerOff')}</span>
        </div>
      </form>
      <div className="mt-4 space-y-1 text-sm" data-testid="due-list">
        <p className="font-semibold">{q('sch.due', { quarter: periodLabel(s.current_period, lang) })}</p>
        <ul className="space-y-1">
          {(s.due ?? []).map((d) => (
            <li key={d.offset_days} className="flex flex-wrap items-center gap-2">
              <span>{qn('sch.dueRow', d.offset_days, { when: e.dateTime(d.due_at) })}</span>
              {d.sent ? <Badge tone="green">{q('sch.sent')}</Badge> : <Badge tone="outline">{q('sch.pending')}</Badge>}
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  )
}

/** One language of the wording: four editable texts, the placeholders, a LIVE PREVIEW rendered by the server (the same code as the real send: text is escaped, never raw HTML). */
function TemplateEditor({ tpl, placeholders, variant = 'figures' }) {
  const { t } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const { saveTemplate, resetTemplate } = useQuarterMutations()
  const [values, setValues] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, tpl[f.key]])))
  const [finalised, setFinalised] = useState(Boolean(tpl.finalised))
  const [error, setError] = useState(null)
  const dirty = FIELDS.some((f) => values[f.key] !== tpl[f.key]) || finalised !== Boolean(tpl.finalised)
  const debounced = useDebounced(values, 400)
  const preview = useQuery({ queryKey: ['alumni', 'quarters', 'tplPreview', variant, tpl.lang, debounced], queryFn: () => previewAlumniReminderTemplate(tpl.lang, debounced, variant), retry: false, staleTime: 60_000, placeholderData: (p) => p })
  const dir = tpl.lang === 'ar' ? 'rtl' : 'ltr'

  async function save() {
    setError(null)
    try {
      await saveTemplate.mutateAsync({ lang: tpl.lang, variant, patch: { ...Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key]])), finalised } })
      toast.success(q('tpl.saved'))
    } catch (err) { setError(errorText(err, Object.fromEntries(FIELDS.map((f) => [f.key, q(`tpl.${f.key}`)])))) }
  }
  async function reset() {
    if (!(await confirm({ title: q('tpl.resetTitle'), message: q('tpl.resetBody'), confirmLabel: q('tpl.reset'), destructive: true }))) return
    try {
      await resetTemplate.mutateAsync(variant === 'closed' ? { lang: tpl.lang, variant } : tpl.lang)
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, tpl[f.key]])))
      toast.success(q('tpl.resetDone'))
    } catch (err) { toast.error(errorText(err)) }
  }
  const pv = preview.data
  return (
    <div className="grid gap-5 lg:grid-cols-2" data-testid={`template-${tpl.lang}`} data-variant={variant}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="variant-note">{t(`alumni.admin.cl.rem.${variant === 'closed' ? 'closedNote' : 'figuresNote'}`)}</p>
        {!tpl.finalised && <p className="rounded-input border border-accent bg-accent/20 p-3 text-sm" data-testid="not-final">{q('tpl.notFinal')}</p>}
        <p className="flex flex-wrap gap-1 text-xs text-muted-foreground">{q('tpl.placeholders')} {placeholders.map((p) => <code key={p} dir="ltr" className="rounded bg-surface px-1.5 py-0.5">{`{${p}}`}</code>)}</p>
        {FIELDS.map((f) => (
          <Field key={f.key} as={f.rows > 1 ? 'textarea' : 'input'} rows={f.rows} maxLength={f.max} label={q(`tpl.${f.key}`)} dir={dir} value={values[f.key]} onChange={(ev) => setValues((v) => ({ ...v, [f.key]: ev.target.value }))} />
        ))}
        <CheckRow checked={finalised} onChange={setFinalised} label={q('tpl.finalised')} hint={q('tpl.finalisedHint')} />
        {error && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={!dirty} loading={saveTemplate.isPending}><Save className="h-4 w-4" aria-hidden="true" />{t('common.save')}</Button>
          <Button variant="ghost" onClick={reset} disabled={tpl.is_default && !dirty}>{q('tpl.reset')}</Button>
        </div>
      </div>
      <div className="space-y-3" aria-live="polite" data-testid="template-preview">
        <h3 className="text-base font-bold">{q('tpl.preview')}</h3>
        {preview.isError ? <p role="alert" className="text-sm text-destructive-text">{errorText(preview.error)}</p> : !pv ? <Skeleton className="h-40 w-full" /> : (
          <>
            <div className="rounded-card border bg-card p-3" dir={dir}>
              <p className="text-xs font-semibold text-muted-foreground">{q('tpl.previewNotif')}</p>
              <p className="font-bold" data-testid="pv-notif-title">{pv.notif_title}</p>
              <p className="text-sm">{pv.notif_body}</p>
            </div>
            <div className="rounded-card border bg-card p-3">
              <p className="text-xs font-semibold text-muted-foreground">{q('tpl.previewMail')}</p>
              <p className="font-bold" dir={dir} data-testid="pv-mail-subject">{pv.email_subject}</p>
              {/* the preview text is shown as TEXT (the e-mail HTML is built from escaped text on the server); nothing here renders markup */}
              <pre dir={dir} className="mt-2 whitespace-pre-wrap break-words font-sans text-sm" data-testid="pv-mail-text">{pv.email_text}</pre>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Campaigns() {
  const { t, lang } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const e = useEditText()
  const query = useAlumniReminderCampaigns({ limit: 20 })
  const rows = query.data?.rows ?? []
  return (
    <SectionCard id="campaigns" title={q('camp.title')} description={q('camp.desc')} testId="campaigns">
      {query.isPending ? <Skeleton className="h-24 w-full" /> : query.isError ? <ErrorState error={query.error} title={q('loadFailed')} onRetry={() => query.refetch()} /> : rows.length === 0 ? <EmptyState title={q('camp.empty')} /> : (
        <div className="overflow-x-auto rounded-card border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-surface text-xs font-bold text-athar-ink"><tr>{['when', 'quarter', 'kind', 'recipients', 'notified', 'emailed', 'delivery', 'by'].map((c) => <th key={c} scope="col" className="px-3 py-2 text-start">{q(`camp.col.${c}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top" data-testid="campaign-row">
                  <td className="px-3 py-2 text-xs tabular-nums">{e.dateTime(r.created_at)}</td>
                  <td className="px-3 py-2">{periodLabel(r.period_key, lang)}</td>
                  <td className="px-3 py-2"><Badge tone={r.status === 'superseded' ? 'outline' : r.trigger === 'manual' ? 'blue' : 'neutral'}>{r.status === 'superseded' ? q('camp.superseded') : r.trigger === 'manual' ? q('camp.manual') : q('camp.scheduled', { kind: r.kind })}</Badge></td>
                  <td className="px-3 py-2 tabular-nums">{r.recipients}{r.closed_recipients > 0 && <span className="block text-[11px] text-muted-foreground">{t('alumni.admin.cl.rem.closedShare', { count: r.closed_recipients })}</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{r.notified}<span className="block text-[11px] text-muted-foreground">{q('camp.read', { count: r.read ?? 0 })}</span></td>
                  <td className="px-3 py-2 tabular-nums">{r.emailed}{r.no_email > 0 && <span className="block text-[11px] text-muted-foreground">{q('camp.noEmail', { count: r.no_email })}</span>}</td>
                  <td className="px-3 py-2 text-xs">{Object.entries(r.delivery ?? {}).map(([k, n]) => <Badge key={k} tone={k === 'sent' ? 'green' : k === 'queued' ? 'outline' : 'amber'} className="me-1">{['queued', 'sending', 'sent', 'failed', 'dead', 'cancelled', 'needs_review'].includes(k) ? q(`camp.ds.${k}`) : k} {n}</Badge>)}{r.note === 'no_app_url' && <span className="block text-destructive-text">{q('camp.noUrl')}</span>}</td>
                  <td className="px-3 py-2 text-xs">{r.created_by_name ?? q('camp.auto')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

/** /alumni/admin/quarters/reminders: the reminder schedule, the wording (ar / en, live preview), the campaign history. */
export default function RemindersPage() {
  const { t } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const query = useAlumniQuarterSettings()
  const [lang, setLang] = useState('ar')
  const [variant, setVariant] = useState('figures')
  const tpl = useMemo(() => ((variant === 'closed' ? query.data?.closed_templates : query.data?.templates) ?? []).find((x) => x.lang === lang), [query.data, lang, variant])
  const placeholders = variant === 'closed' ? query.data?.closed_placeholders ?? [] : query.data?.placeholders ?? []
  return (
    <AdminPage testId="alumni-admin-reminders" title={q('rem.title')} subtitle={q('rem.subtitle')} actions={<Link to="/alumni/admin/quarters" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{q('rem.back')}</Link>}>
      {query.isPending ? <Skeleton className="h-64 w-full" /> : query.isError ? <ErrorState error={query.error} title={q('loadFailed')} onRetry={() => query.refetch()} /> : (
        <>
          <ScheduleCard key={query.data.app_base_url + String(query.data.send_hour) + query.data.reminder_offsets.join()} s={query.data} />
          <SectionCard id="wording" title={q('tpl.title')} description={q('tpl.desc')}>
            <div className="space-y-4">
              {(query.data.closed_templates ?? []).length > 0 && <Segmented label={t('alumni.admin.cl.rem.audience')} value={variant} onChange={setVariant} options={[{ value: 'figures', label: t('alumni.admin.cl.rem.figures') }, { value: 'closed', label: t('alumni.admin.cl.rem.closed') }]} />}
              <Segmented label={q('tpl.language')} value={lang} onChange={setLang} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
              {tpl && <TemplateEditor key={`${variant}-${tpl.lang}-${tpl.updated_at}`} tpl={tpl} variant={variant} placeholders={placeholders} />}
            </div>
          </SectionCard>
          <Campaigns />
        </>
      )}
    </AdminPage>
  )
}
