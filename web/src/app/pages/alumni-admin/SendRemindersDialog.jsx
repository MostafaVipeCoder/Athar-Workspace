import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Send } from 'lucide-react'
import { newSendToken, useAlumniQuarterSettings, useQuarterMutations, useReminderPreview } from '../../../data/alumniQuarters.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Field } from '../../../ui/Field.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { ErrorState, Skeleton } from '../../../ui/States.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { periodLabel } from '../../../lib/alumniQuarters.js'
import { appBaseUrl } from '../../../lib/links.js'
import { useAdminErrorText } from './hooks.js'
import './i18n.common.js'
import './quarters.i18n.js'

/**
 * "Send reminders now" / "Resend to unconfirmed" with a RECIPIENTS PREVIEW first (how many founders, how many have an e-mail, who was already reminded this quarter, a sample), and, above
 * 100 recipients, a confirmation that asks for the exact number. One dialog = one token: a double click is one send, a deliberate "Resend" is a new dialog.
 * `scope` = `{ companyIds }` (the selected rows) or `{ filters }` (every company of the current filter) or neither (every unconfirmed alumni company).
 * Delivery: the notification is created now; the e-mail is queued and the outbox worker delivers it.
 */
export default function SendRemindersDialog({ period, scope = {}, onlyNew, onClose }) {
  const { t, tn, lang, pick } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const qn = (k, n, v) => tn(`alumni.admin.qs.${k}`, n, v)
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { sendReminders } = useQuarterMutations()
  const [token] = useState(() => newSendToken())
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const params = { period, companyIds: scope.companyIds ?? null, filters: scope.filters ?? null, onlyNew }
  const preview = useReminderPreview(params, JSON.stringify([period, scope, onlyNew]))
  const p = preview.data
  const settings = useAlumniQuarterSettings()
  const notFinal = (settings.data?.templates ?? []).some((x) => !x.finalised)
  // "Resend" only when somebody in the audience was already reminded; before the count is known the caller's intent decides
  const resend = !onlyNew && (p ? p.already_reminded > 0 : true)
  const big = (p?.recipients ?? 0) > (p?.confirm_above ?? 100)
  const ready = p && p.recipients > 0 && (!big || typed.trim() === String(p.recipients))

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const r = await sendReminders.mutateAsync({ ...params, token, expectedCount: big ? p.recipients : null, appUrl: appBaseUrl() })
      toast.success(q('sentToast', { notifs: qn('sentNotifs', r.sent), mails: qn('sentMails', r.sent - r.no_email) }))
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={q(resend ? 'resendTitle' : 'sendTitle', { quarter: periodLabel(period, lang) })}
      description={q('sendDesc')}
      closeLabel={t('common.close')}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button><Button onClick={send} loading={busy} disabled={!ready} data-testid="send-reminders-go"><Send className="h-4 w-4" aria-hidden="true" />{q('sendNow')}</Button></>}
    >
      <div className="space-y-4" data-testid="send-reminders">
        {notFinal && (
          <p className="rounded-input border border-accent bg-accent/20 p-3 text-sm" data-testid="send-not-final">{q('pv.notFinal')} <Link to="/alumni/admin/quarters/reminders#wording" className="font-semibold text-primary underline-offset-4 hover:underline" onClick={onClose}>{q('pv.editWording')}</Link></p>
        )}
        {preview.isPending ? <Skeleton className="h-24 w-full" /> : preview.isError ? <ErrorState error={preview.error} title={q('previewFailed')} onRetry={() => preview.refetch()} /> : (
          <>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[['recipients', p.recipients], ['withEmail', p.with_email], ['already', p.already_reminded]].map(([k, v]) => (
                <div key={k} className="rounded-card border bg-surface/50 p-3"><dt className="text-xs font-semibold text-muted-foreground">{q(`pv.${k}`)}</dt><dd className="text-2xl font-bold tabular-nums" data-testid={`pv-${k}`}>{v}</dd></div>
              ))}
            </dl>
            {p.recipients === 0 ? <p className="rounded-input bg-surface p-3 text-sm" data-testid="pv-none">{q('pv.none')}</p> : (
              <>
                {p.without_email > 0 && <p className="text-sm text-muted-foreground">{qn('pv.noEmail', p.without_email)}</p>}
                <ul className="space-y-1 text-sm" aria-label={q('pv.sample')}>
                  {(p.sample ?? []).map((s) => (
                    <li key={s.founder_id} className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold">{pick(s, 'name') || '—'}</span><span className="text-muted-foreground">{(lang === 'ar' ? s.companies_ar : s.companies_en)?.join(lang === 'ar' ? '، ' : ', ')}</span>{s.email_masked && <span dir="ltr" className="text-xs text-muted-foreground">{s.email_masked}</span>}</li>
                  ))}
                  {p.recipients > (p.sample ?? []).length && <li className="text-xs text-muted-foreground">{qn('pv.more', p.recipients - (p.sample ?? []).length)}</li>}
                </ul>
                <p className="text-xs text-muted-foreground">{q('pv.delivery')}</p>
                {big && (
                  <div className="space-y-2 rounded-card border border-accent bg-accent/20 p-3" role="group" aria-label={q('pv.bigTitle')}>
                    <p className="text-sm font-bold">{q('pv.bigTitle')}</p>
                    <Field label={q('pv.bigLabel', { count: p.recipients })} inputMode="numeric" dir="ltr" value={typed} onChange={(ev) => setTyped(ev.target.value)} data-testid="pv-confirm-count" />
                  </div>
                )}
              </>
            )}
            {error && <p role="alert" className="rounded-input bg-destructive/10 p-3 text-sm text-destructive-text">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
