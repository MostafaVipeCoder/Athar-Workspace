import { useState } from 'react'
import { CheckCheck, Copy, RotateCcw, Send, Trash2 } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { Loading } from '../../ui/States.jsx'
import { sanitizePreviewHtml } from '../../lib/email.js'
import { copyText } from '../../lib/clipboard.js'
import { formatDateTime } from '../../lib/time/format.js'
import { emailKeyLabel, eventKey, expectedMessageId, explanationKey, gmailSearch, rowActions, stateOf } from '../../lib/outbox.js'
import { useOutboxItem } from '../../data/outbox.js'
import { OutboxStateBadge } from './OutboxStateBadge.jsx'

function Field({ label, children, testid }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3" data-testid={testid}>
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  )
}

/**
 * One e-mail in full (a drawer): who, what, from which Google account, the state with WHAT HAPPENED in plain words, the Message-ID and the Gmail search to
 * check the Sent folder (for an unknown outcome), the rendered message (sanitised: nothing in it can run) and the history of every step with the person
 * behind a manual one. The actions are the ones the database allows for the state.
 */
export function OutboxDetail({ id, summary = null, tz, onClose, onAction }) {
  const { t, lang } = useLanguage()
  const toast = useToast()
  const q = useOutboxItem(id)
  const [busy, setBusy] = useState(null)
  const item = q.data ? { ...summary, ...q.data } : summary
  const st = item ? stateOf(item) : 'queued'
  const a = rowActions(item)
  const ek = item ? explanationKey(item) : null
  const mid = item ? item.message_id || expectedMessageId(item, item.sender_email) : ''
  const showMid = item && (st === 'needs_review' || st === 'sent')
  const fmt = (v) => (v ? formatDateTime(v, { lang, tz }) : '-')
  const act = async (kind, confirmWith) => {
    setBusy(kind)
    try { await onAction(kind, confirmWith) } finally { setBusy(null) }
  }
  async function copy(text) {
    toast[(await copyText(text)) ? 'success' : 'error'](t('outbox.detail.copied'))
  }

  const footer = item && (
    <>
      <Button variant="ghost" onClick={onClose}>{t('outbox.action.close')}</Button>
      {a.retry && <Button variant="outline" onClick={() => act('retry', null)} loading={busy === 'retry'} data-testid="detail-retry"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('outbox.action.retry')}</Button>}
      {a.markSent && <Button variant="outline" onClick={() => act('markSent', 'markSent')} loading={busy === 'markSent'} data-testid="detail-mark-sent"><CheckCheck className="h-4 w-4" aria-hidden="true" />{t('outbox.action.markSent')}</Button>}
      {a.resend && <Button variant="outline" onClick={() => act('resend', 'resend')} loading={busy === 'resend'} data-testid="detail-resend"><Send className="h-4 w-4" aria-hidden="true" />{t('outbox.action.resend')}</Button>}
      {a.cancel && <Button variant="outline" className="text-destructive-text" onClick={() => act('cancel', 'cancel')} loading={busy === 'cancel'} data-testid="detail-cancel"><Trash2 className="h-4 w-4" aria-hidden="true" />{t('outbox.action.cancel')}</Button>}
    </>
  )

  return (
    <Modal open onClose={onClose} side title={t('outbox.detail.title')} description={item?.recipient} closeLabel={t('outbox.action.close')} footer={footer} className="sm:max-w-2xl">
      <div className="space-y-5" data-testid="outbox-detail">
        {!item ? <Loading label={t('outbox.detail.loading')} /> : (
          <>
            <dl className="space-y-2">
              <Field label={t('outbox.detail.state')} testid="detail-state"><OutboxStateBadge state={st} /> <span className="ms-1 text-xs text-muted-foreground">{t(emailKeyLabel(item.email_key))}</span></Field>
              {ek && <Field label={t('outbox.detail.explain')} testid="detail-explain"><p className={st === 'needs_review' || st === 'failed' ? 'font-medium' : ''}>{t(ek)}</p></Field>}
              <Field label={t('outbox.detail.recipient')}><span dir="ltr">{item.recipient}</span></Field>
              {Array.isArray(item.cc) && item.cc.length > 0 && <Field label={t('outbox.detail.cc')}><span dir="ltr">{item.cc.join(', ')}</span></Field>}
              <Field label={t('outbox.detail.subject')}><span dir="auto">{item.subject || '-'}</span></Field>
              <Field label={t('outbox.detail.sender')}>
                {item.sender_email ? <><span dir="ltr">{item.sender_email}</span>{item.sender_source === 'system' && <span className="ms-2 text-xs text-muted-foreground">({t('outbox.detail.senderSystem')})</span>}</> : <span className="text-muted-foreground">{t('outbox.detail.senderNone')}</span>}
              </Field>
              <Field label={t('outbox.detail.attempts')}><span className="tabular-nums">{item.attempts ?? 0}</span></Field>
              <Field label={t('outbox.detail.created')}>{fmt(item.created_at)}</Field>
              {item.sent_at && <Field label={t('outbox.detail.sent')}>{fmt(item.sent_at)}</Field>}
              {st === 'queued' || st === 'blocked' ? <Field label={t('outbox.detail.next')}>{fmt(item.next_attempt_at)}</Field> : null}
            </dl>

            {showMid && mid && (
              <section className="space-y-2 rounded-md border bg-surface/60 p-3" data-testid="detail-message-id">
                <h3 className="text-sm font-semibold">{t('outbox.detail.messageId')}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-background px-2 py-1 text-xs" dir="ltr">{mid}</code>
                  <Button size="sm" variant="ghost" onClick={() => copy(mid)}><Copy className="h-4 w-4" aria-hidden="true" />{t('outbox.action.copy')}</Button>
                </div>
                {st === 'needs_review' && (
                  <>
                    <p className="text-xs text-muted-foreground">{t('outbox.detail.searchHint')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="break-all rounded bg-background px-2 py-1 text-xs" dir="ltr" data-testid="gmail-search">{gmailSearch(mid)}</code>
                      <Button size="sm" variant="ghost" onClick={() => copy(gmailSearch(mid))}><Copy className="h-4 w-4" aria-hidden="true" />{t('outbox.action.copy')}</Button>
                    </div>
                  </>
                )}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('outbox.detail.body')}</h3>
              {q.isPending ? <Loading label={t('outbox.detail.loading')} className="p-4" /> : q.isError ? <p className="text-sm text-destructive-text" role="alert">{t('outbox.detail.err')}</p>
                : q.data?.body_html ? (
                  // sanitised (scripts, handlers and javascript: removed); the values were HTML-escaped when the e-mail was rendered
                  <div className="max-h-72 overflow-auto rounded-md border bg-background p-3 text-sm leading-relaxed" dir="auto" data-testid="detail-body" dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(q.data.body_html) }} />
                ) : <p className="text-sm text-muted-foreground" data-testid="detail-body-gone">{t('outbox.detail.bodyGone')}</p>}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('outbox.detail.timeline')}</h3>
              {q.data?.events?.length ? (
                <ol className="space-y-1 border-s-2 ps-3" data-testid="detail-timeline">
                  {q.data.events.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="text-xs">
                      <span className="font-medium">{t(eventKey(e.event))}</span>
                      {e.attempt ? <span className="text-muted-foreground"> · {t('outbox.detail.attempt', { n: e.attempt })}</span> : null}
                      {e.actor_name ? <span className="text-muted-foreground"> · {e.actor_name}</span> : null}
                      <span className="block text-muted-foreground" title={e.sender_email ?? undefined}>{fmt(e.at)}{e.sender_email ? ` · ${e.sender_email}` : ''}</span>
                    </li>
                  ))}
                </ol>
              ) : q.isPending ? null : <p className="text-xs text-muted-foreground">-</p>}
            </section>
          </>
        )}
      </div>
    </Modal>
  )
}

export default OutboxDetail
