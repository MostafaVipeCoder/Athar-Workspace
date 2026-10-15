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
import { CheckRow } from './ui.jsx'
import './i18n.common.js'
import './quarters.i18n.js'
import './closed.i18n.js'

/** One audience of the preview: its three counts, who is in it (a sample, e-mails masked) and, when two audiences are shown, a switch to leave it out of the send. */
function AudienceBlock({ prefix = '', data, title, help, none, toggle }) {
  const { t, tn, lang, pick } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const qn = (k, n, v) => tn(`alumni.admin.qs.${k}`, n, v)
  return (
    <section className="space-y-3" data-testid={prefix ? 'pv-closed' : 'pv-figures'} aria-label={title}>
      {title && (
        <div>
          <h3 className="text-base font-bold">{title}</h3>
          <p className="text-xs text-muted-foreground">{help}</p>
        </div>
      )}
      <dl className="grid grid-cols-3 gap-3 text-center">
        {[['recipients', data.recipients], ['withEmail', data.with_email], ['already', data.already_reminded]].map(([k, v]) => (
          <div key={k} className="rounded-card border bg-surface/50 p-3"><dt className="text-xs font-semibold text-muted-foreground">{q(`pv.${k}`)}</dt><dd className="text-2xl font-bold tabular-nums" data-testid={`pv-${prefix}${k}`}>{v}</dd></div>
        ))}
      </dl>
      {data.recipients === 0 ? <p className="rounded-input bg-surface p-3 text-sm" data-testid={`pv-${prefix}none`}>{none}</p> : (
        <>
          {toggle}
          {data.without_email > 0 && <p className="text-sm text-muted-foreground">{qn('pv.noEmail', data.without_email)}</p>}
          <ul className="space-y-1 text-sm" aria-label={q('pv.sample')}>
            {(data.sample ?? []).map((s) => (
              <li key={s.founder_id} className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold">{pick(s, 'name') || '—'}</span><span className="text-muted-foreground">{(lang === 'ar' ? s.companies_ar : s.companies_en)?.join(lang === 'ar' ? '، ' : ', ')}</span>{s.email_masked && <span dir="ltr" className="text-xs text-muted-foreground">{s.email_masked}</span>}</li>
            ))}
            {data.recipients > (data.sample ?? []).length && <li className="text-xs text-muted-foreground">{qn('pv.more', data.recipients - (data.sample ?? []).length)}</li>}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * "Send reminders now" / "Resend to unconfirmed" with a RECIPIENTS PREVIEW first, the TWO AUDIENCES SEPARATELY (owner decision 22): founders of ACTIVE companies (asked to update / confirm their
 * figures) and founders of CLOSED companies (asked "What are you doing now?": another message, another form). Each shows how many founders, how many have an e-mail, who was already reminded this
 * quarter and a sample; when both have somebody each can be left out. Above 100 recipients in total, a confirmation that asks for the exact number. One dialog = one token: a double click is one
 * send, a deliberate "Resend" is a new dialog.
 * `scope` = `{ companyIds }` (the selected rows) or `{ filters }` (every company of the current filter) or neither (every unconfirmed alumni company). `audience` = all (default) | figures | closed.
 * Delivery: the notification is created now; the e-mail is queued and the outbox worker delivers it.
 */
export default function SendRemindersDialog({ period, scope = {}, onlyNew, audience = 'all', onClose }) {
  const { t, tn, lang } = useLanguage()
  const q = (k, v) => t(`alumni.admin.qs.${k}`, v)
  const qn = (k, n, v) => tn(`alumni.admin.qs.${k}`, n, v)
  const cl = (k, v) => t(`alumni.admin.cl.${k}`, v)
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { sendReminders } = useQuarterMutations()
  const [token] = useState(() => newSendToken())
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [skip, setSkip] = useState({ figures: false, closed: false })
  const params = { period, companyIds: scope.companyIds ?? null, filters: scope.filters ?? null, onlyNew, audience }
  const preview = useReminderPreview(params, JSON.stringify([period, scope, onlyNew, audience]))
  const p = preview.data
  const closed = p?.closed
  const settings = useAlumniQuarterSettings()
  // an audience takes part when it is shown, has somebody and is not switched off
  const showFigures = audience !== 'closed'
  const showClosed = audience !== 'figures' && Boolean(closed)
  const twoAudiences = showFigures && showClosed
  const useFigures = showFigures && !skip.figures
  const useClosed = showClosed && !skip.closed
  const nFigures = useFigures ? p?.recipients ?? 0 : 0
  const nClosed = useClosed ? closed?.recipients ?? 0 : 0
  const total = nFigures + nClosed
  const sendAudience = useFigures && useClosed ? 'all' : useClosed ? 'closed' : 'figures'
  const templates = settings.data?.templates ?? []
  const closedTemplates = settings.data?.closed_templates ?? []
  const notFinal = (useFigures && templates.some((x) => !x.finalised)) || (useClosed && closedTemplates.some((x) => !x.finalised))
  // "Resend" only when somebody in the audience was already reminded; before the count is known the caller's intent decides
  const alreadyN = (useFigures ? p?.already_reminded ?? 0 : 0) + (useClosed ? closed?.already_reminded ?? 0 : 0)
  const resend = !onlyNew && (p ? alreadyN > 0 : true)
  const big = total > (p?.confirm_above ?? 100)
  const ready = Boolean(p) && total > 0 && (!big || typed.trim() === String(total))

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const r = await sendReminders.mutateAsync({ ...params, audience: sendAudience, token, expectedCount: big ? total : null, appUrl: appBaseUrl() })
      toast.success(q('sentToast', { notifs: qn('sentNotifs', r.sent), mails: qn('sentMails', r.sent - r.no_email) }))
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleFor = (key, label) => (twoAudiences
    ? <CheckRow checked={!skip[key]} onChange={(v) => setSkip((s) => ({ ...s, [key]: !v }))} label={cl('pv.include', { audience: label })} />
    : null)

  return (
    <Modal
      open
      onClose={onClose}
      title={q(resend ? 'resendTitle' : 'sendTitle', { quarter: periodLabel(period, lang) })}
      description={audience === 'closed' ? cl('pv.descClosed') : showClosed ? cl('pv.descBoth') : q('sendDesc')}
      closeLabel={t('common.close')}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button><Button onClick={send} loading={busy} disabled={!ready} data-testid="send-reminders-go"><Send className="h-4 w-4" aria-hidden="true" />{q('sendNow')}</Button></>}
    >
      <div className="space-y-4" data-testid="send-reminders">
        {notFinal && (
          <p className="rounded-input border border-accent bg-accent/20 p-3 text-sm" data-testid="send-not-final">{q('pv.notFinal')} <Link to="/alumni/admin/quarters/reminders#wording" className="font-semibold text-primary underline-offset-4 hover:underline" onClick={onClose}>{q('pv.editWording')}</Link></p>
        )}
        {preview.isPending ? <Skeleton className="h-24 w-full" /> : preview.isError ? <ErrorState error={preview.error} title={q('previewFailed')} onRetry={() => preview.refetch()} /> : (
          <>
            {showFigures && (
              <AudienceBlock data={p} title={showClosed ? cl('pv.figuresTitle') : null} help={cl('pv.figuresHelp')} none={q('pv.none')} toggle={toggleFor('figures', cl('pv.figuresTitle'))} />
            )}
            {showClosed && (
              <AudienceBlock prefix="closed-" data={closed} title={cl('pv.closedTitle')} help={cl('pv.closedHelp')} none={cl('pv.noneClosed')} toggle={toggleFor('closed', cl('pv.closedTitle'))} />
            )}
            {total > 0 && (
              <>
                {twoAudiences && <p className="text-sm font-semibold" data-testid="pv-total">{cl('pv.total', { count: total })}</p>}
                <p className="text-xs text-muted-foreground">{q('pv.delivery')}</p>
                {big && (
                  <div className="space-y-2 rounded-card border border-accent bg-accent/20 p-3" role="group" aria-label={q('pv.bigTitle')}>
                    <p className="text-sm font-bold">{q('pv.bigTitle')}</p>
                    <Field label={q('pv.bigLabel', { count: total })} inputMode="numeric" dir="ltr" value={typed} onChange={(ev) => setTyped(ev.target.value)} data-testid="pv-confirm-count" />
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
