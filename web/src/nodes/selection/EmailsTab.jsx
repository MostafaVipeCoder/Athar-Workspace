import { useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import './i18n.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Field } from '../../ui/Field.jsx'
import { EmptyState, Loading } from '../../ui/States.jsx'
import { materializeItem } from '../../data/lists.js'
import { biPick, isActiveItem } from '../../lib/entities.js'
import { cn } from '../../lib/cn.js'
import { BULK_CONFIRM_THRESHOLD, EMAIL_KEYS, PLACEHOLDERS_BY_KEY, emailIndex, normalizeSelectionConfig, renderTemplate, sampleVars, sanitizePreviewHtml, stageForEmail, toStoredConfig, validateSelectionConfig } from './selectionConfig.js'

const STATUS_TONE = { queued: 'blue', sending: 'blue', sent: 'green', failed: 'red', dead: 'red', cancelled: 'neutral', needs_review: 'amber' }
const RESULT_TONE = { queued: 'green', already_sent: 'neutral', duplicate: 'neutral', no_recipient: 'red', item_not_found: 'red', withdrawn: 'red' }
const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean)

/**
 * E-mails tab of a stage (design 01 section 3.4 "Emails", 07 section 1.5/1.6): the three v1 templates (acceptance /
 * rejection / interview invitation) in English and Arabic with the unified placeholder set, a live preview with a
 * sample applicant, and the send panel: applicants of the mapped stage, already-sent markers from the outbox, select
 * unsent / resend, confirm above 100, ONE server RPC that derives recipients and queues outbox rows; per-recipient
 * status comes back from the outbox (delivery = the worker, not in scope). Templates are node config saved with the
 * revision token (this tab owns its own Save; the board's writes are row-level).
 */
export function EmailsTab({ node, config: saved, items, extras, loading = false, mutations: sm, preselect = null }) {
  const { t, tn, lang, pick } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const { config: raw, setConfig, dirty, saving, save } = useNodeConfig()
  const draft = useMemo(() => normalizeSelectionConfig(raw), [raw])
  const [key, setKey] = useState('interview')
  const [tplLang, setTplLang] = useState(lang === 'ar' ? 'ar' : 'en')
  const [sendLang, setSendLang] = useState(lang === 'ar' ? 'ar' : 'en')
  const [sampleId, setSampleId] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [resend, setResend] = useState(false)
  const [results, setResults] = useState({})
  const [errors, setErrors] = useState({})

  const tpl = draft.emails[key]
  const stage = stageForEmail(saved, key)
  const recipients = useMemo(() => items.filter((i) => isActiveItem(i) && stage && i.status === stage.key), [items, stage])
  const withdrawnInStage = useMemo(() => items.filter((i) => i.withdrawn && stage && i.status === stage.key).length, [items, stage])
  const emails = useMemo(() => emailIndex(extras?.emails ?? []), [extras])
  const sentOf = (item) => emails[item.itemId]?.[key]?.last ?? null
  const unsent = recipients.filter((i) => !sentOf(i) || ['failed', 'dead', 'cancelled'].includes(sentOf(i).status))
  const sample = items.find((i) => i.id === sampleId) ?? recipients[0] ?? items[0] ?? null
  const booking = extras?.booking ?? null
  const usesBooking = /\{\{?\s*booking_link\s*\}?\}/.test(`${tpl.subject} ${tpl.body_html} ${tpl.subject_ar} ${tpl.body_html_ar}`)

  // "Send e-mail to selected" from the board: adopt the selection once per request (derive-during-render pattern)
  const [seenPreselect, setSeenPreselect] = useState(null)
  if (preselect && preselect !== seenPreselect) {
    setSeenPreselect(preselect)
    const k = saved.stages.find((s) => s.key === preselect.stage)?.email
    if (k) setKey(k)
    setSelected(new Set(preselect.ids))
  }

  const patchTpl = (next) => setConfig({ ...draft, emails: { ...draft.emails, [key]: { ...tpl, ...next } } })
  const subjField = tplLang === 'ar' ? 'subject_ar' : 'subject'
  const bodyField = tplLang === 'ar' ? 'body_html_ar' : 'body_html'
  const insert = (ph) => patchTpl({ [bodyField]: `${tpl[bodyField]}${tpl[bodyField] && !tpl[bodyField].endsWith(' ') ? ' ' : ''}{{${ph}}}` })

  async function onSave() {
    const errs = validateSelectionConfig(draft)
    const own = Object.fromEntries(Object.entries(errs).filter(([k]) => k.startsWith('emails.')))
    setErrors(own)
    if (Object.keys(own).length) return
    const r = await save({ config: toStoredConfig(draft) })
    if (r.ok) toast.success(t('selection.emails.saved'))
  }

  const vars = sample ? sampleVars(sample, { pmName: extras?.pm_name, programName: biPick(extras?.program_name, sendLang), projectName: biPick(extras?.project_name, sendLang), lang: sendLang }) : {}
  const previewSubject = renderTemplate(tplLang === 'ar' ? tpl.subject_ar || tpl.subject : tpl.subject || tpl.subject_ar, vars)
  const previewBody = sanitizePreviewHtml(renderTemplate(tplLang === 'ar' ? tpl.body_html_ar || tpl.body_html : tpl.body_html || tpl.body_html_ar, vars, { html: true }))

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selectedItems = recipients.filter((i) => selected.has(i.itemId) || selected.has(i.id))

  async function send() {
    if (dirty) { toast.warning(t('selection.emails.unsaved')); return }
    if (!selectedItems.length) { toast.info(t('selection.emails.noRecipients')); return }
    if (usesBooking && !booking) { toast.error(t('selection.emails.bookingMissing')); return }
    const needsConfirm = selectedItems.length > BULK_CONFIRM_THRESHOLD
    if (needsConfirm && !(await confirm({ title: t('selection.emails.confirmTitle', { count: selectedItems.length }), message: t('selection.emails.confirmBody') }))) return
    try {
      // the outbox references the stage's overlay row: never-touched (virtual) applicants are materialised first
      const ids = []
      for (const i of selectedItems) ids.push(await materializeItem(node.id, i))
      const out = await sm.send.mutateAsync({ emailKey: key, itemIds: ids, lang: sendLang, resend, confirm: needsConfirm })
      const byId = Object.fromEntries(out.map((r) => [r.item_id, r.status]))
      setResults(byId)
      const queued = out.filter((r) => r.status === 'queued').length
      const failed = out.filter((r) => r.status === 'no_recipient').length
      toast.success(t('selection.emails.sent', { queued, skipped: out.length - queued - failed, failed }))
      setSelected(new Set())
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    }
  }

  if (loading) return <Loading />

  return (
    <div className="space-y-6" data-testid="emails-tab">
      <p className="text-xs text-muted-foreground">{t('selection.emails.hint')}</p>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('selection.emails.template')}>
        {EMAIL_KEYS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={key === k} onClick={() => { setKey(k); setSelected(new Set()); setResults({}) }} className={cn('tap-target rounded-md px-3 text-sm', key === k ? 'bg-foreground text-background' : 'hover:bg-surface')} data-testid={`email-${k}`}>
            {t(`selection.email.${k}`)}{!draft.emails[k].enabled && ' (off)'}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3" data-testid="template-editor">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={tpl.enabled} onChange={(e) => patchTpl({ enabled: e.target.checked })} className="h-4 w-4" />{t('selection.emails.enabled')}</label>
            <div className="ms-auto inline-flex rounded-md border" role="group" aria-label={t('selection.emails.lang.en')}>
              {['en', 'ar'].map((l) => (
                <Button key={l} size="sm" variant={tplLang === l ? 'secondary' : 'ghost'} onClick={() => setTplLang(l)} aria-pressed={tplLang === l}>{t(`selection.emails.lang.${l}`)}</Button>
              ))}
            </div>
          </div>
          <Field label={t('selection.emails.subject')} value={tpl[subjField]} dir={tplLang === 'ar' ? 'rtl' : 'ltr'} onChange={(e) => patchTpl({ [subjField]: e.target.value })} data-testid="tpl-subject" />
          <Field as="textarea" rows={10} label={t('selection.emails.body')} value={tpl[bodyField]} dir={tplLang === 'ar' ? 'rtl' : 'ltr'} onChange={(e) => patchTpl({ [bodyField]: e.target.value })} inputClassName="min-h-48 py-2 font-mono text-sm" data-testid="tpl-body" />
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="me-1 font-medium">{t('selection.emails.placeholders')}:</span>
            {PLACEHOLDERS_BY_KEY[key].map((p) => (
              <button key={p} type="button" onClick={() => insert(p)} className="rounded-full border border-input bg-background px-2 py-0.5 font-mono hover:bg-surface" aria-label={t('selection.emails.insert', { key: p })} dir="ltr">{`{{${p}}}`}</button>
            ))}
          </div>
          <Field label={t('selection.emails.cc')} value={tpl.cc.join(', ')} dir="ltr" onChange={(e) => patchTpl({ cc: list(e.target.value) })} />
          <Field label={t('selection.emails.admin')} value={tpl.admin.join(', ')} dir="ltr" onChange={(e) => patchTpl({ admin: list(e.target.value) })} />
          {errors[`emails.${key}`] && <p className="text-xs text-destructive-text">{t(errors[`emails.${key}`], { list: PLACEHOLDERS_BY_KEY[key].join(', ') })}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onSave} disabled={!dirty} loading={saving} data-testid="save-templates">{t('selection.emails.save')}</Button>
            {dirty && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">{t('node.dirty')}</span>}
          </div>
        </section>

        <section className="space-y-2" data-testid="template-preview">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{t('selection.emails.preview')}</h3>
            {items.length > 0 && (
              <select aria-label={t('selection.emails.previewFor')} value={sample?.id ?? ''} onChange={(e) => setSampleId(e.target.value)} className="ms-auto min-h-9 max-w-64 rounded-md border border-input bg-background px-2 text-sm">
                {items.filter(isActiveItem).slice(0, 200).map((i) => <option key={i.id} value={i.id}>{biPick(i.entity.title, lang) || '-'}</option>)}
              </select>
            )}
          </div>
          {!sample ? <EmptyState title={t('selection.emails.noApplicants')} /> : (
            <div className="rounded-card border bg-surface/60 p-4" dir={tplLang === 'ar' ? 'rtl' : 'ltr'}>
              <p className="mb-2 font-semibold" data-testid="preview-subject">{previewSubject}</p>
              {/* PM-authored template, sanitised (scripts / handlers stripped); values are HTML-escaped by the renderer */}
              <div className="prose prose-sm max-w-none text-sm leading-relaxed" data-testid="preview-body" dangerouslySetInnerHTML={{ __html: previewBody }} />
            </div>
          )}
          {key === 'interview' && (
            <p className={cn('text-xs', booking ? 'text-muted-foreground' : 'text-destructive-text')} data-testid="booking-info">
              {booking ? t('selection.emails.bookingOk', { name: pick(booking, 'name') || '-' }) : t('selection.emails.bookingMissing')}
            </p>
          )}
        </section>
      </div>

      <section className="space-y-2" data-testid="send-panel">
        <h3 className="text-sm font-semibold">{t('selection.emails.recipients')}</h3>
        {!stage ? <p className="text-xs text-destructive-text">{t('selection.emails.noStage')}</p> : (
          <>
            <p className="text-xs text-muted-foreground">{t('selection.emails.recipientsHint', { stage: biPick(stage.label, lang) || stage.key })}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set(unsent.map((i) => i.itemId ?? i.id)))} disabled={!unsent.length}>{t('selection.emails.selectUnsent')} ({unsent.length})</Button>
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set(recipients.map((i) => i.itemId ?? i.id)))} disabled={!recipients.length}>{t('selection.emails.selectAll')} ({recipients.length})</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>{t('selection.emails.clear')}</Button>
              <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} className="h-4 w-4" />{t('selection.emails.resend')}</label>
              <label className="flex min-h-9 items-center gap-2">
                {t('selection.emails.sendLang')}
                <select aria-label={t('selection.emails.sendLang')} value={sendLang} onChange={(e) => setSendLang(e.target.value)} className="min-h-9 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="en">{t('selection.emails.lang.en')}</option>
                  <option value="ar">{t('selection.emails.lang.ar')}</option>
                </select>
              </label>
              <Button size="sm" className="ms-auto" onClick={send} loading={sm.send.isPending} disabled={!selectedItems.length || !tpl.enabled} data-testid="send-emails">
                <Send className="h-4 w-4" aria-hidden="true" />{t('selection.emails.send', { count: selectedItems.length })}
              </Button>
            </div>
            {withdrawnInStage > 0 && <p className="text-xs text-muted-foreground" data-testid="withdrawn-left-out">{tn('selection.emails.withdrawnLeftOut', withdrawnInStage)}</p>}
            {recipients.length === 0 ? <EmptyState title={t('entity.manager.empty')} /> : (
              <div className="overflow-x-auto rounded-input border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-start text-xs font-semibold uppercase text-athar-ink">
                    <tr>
                      <th className="w-8 p-2"><span className="sr-only">{t('entity.manager.select')}</span></th>
                      <th className="p-2 text-start">{t('entity.manager.col.item')}</th>
                      <th className="p-2 text-start">{t('entity.field.email')}</th>
                      <th className="p-2 text-start">{t('selection.emails.statusCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((i) => {
                      const last = sentOf(i)
                      const id = i.itemId ?? i.id
                      const res = results[i.itemId]
                      return (
                        <tr key={i.id} className="border-t" data-testid="recipient-row">
                          <td className="p-2"><input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} className="h-4 w-4" aria-label={`${t('entity.manager.select')}: ${biPick(i.entity.title, lang)}`} /></td>
                          <td className="p-2"><span className="font-medium" dir="auto">{biPick(i.entity.title, lang) || '-'}</span><span className="block text-xs text-muted-foreground" dir="auto">{biPick(i.entity.subtitle, lang)}</span></td>
                          <td className="p-2 text-xs" dir="ltr">{i.contact?.email || <span className="text-destructive-text">{t('selection.result.no_recipient')}</span>}</td>
                          <td className="p-2">
                            <div className="flex flex-wrap items-center gap-1">
                              {last ? <Badge tone={STATUS_TONE[last.status] ?? 'neutral'}>{t(`selection.status.${last.status}`)} ×{emails[i.itemId][key].count}</Badge> : <span className="text-xs text-muted-foreground">{t('selection.emails.never')}</span>}
                              {res && <Badge tone={RESULT_TONE[res] ?? 'neutral'}>{t(`selection.result.${res}`)}</Badge>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
export default EmailsTab
