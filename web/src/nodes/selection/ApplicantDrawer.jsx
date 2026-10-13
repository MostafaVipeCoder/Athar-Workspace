import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Star } from 'lucide-react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Field } from '../../ui/Field.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { biPick } from '../../lib/entities.js'
import { cn } from '../../lib/cn.js'
import { EMAIL_KEYS, effectiveStage, stageOf } from './selectionConfig.js'

const STATUS_TONE = { queued: 'blue', sending: 'blue', sent: 'green', failed: 'red', dead: 'red', cancelled: 'neutral', needs_review: 'amber' }

/** Answer value for display (select arrays joined, objects stringified, files as a short marker). */
function formatValue(v) {
  if (v === null || v === undefined || v === '') return null
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Detail drawer of ONE applicant (as-is "detail modal with question labels, not keys", docs/04 A-19): identity +
 * contact, stage select with origin / move-back, every raw answer labelled through the form schema, the decision
 * review (reason, reviewer), per-reviewer scores with the caller's own score + note, the decision e-mails sent and the
 * participant status. Writes go through the callbacks of the board.
 */
export function ApplicantDrawer({ item, config, fields = [], review = null, score = null, emails = {}, participant = null, sourceLink = null, onClose, onSetStage, onSaveScore, saving = false, formatDate }) {
  const { t, lang } = useLanguage()
  const [myScore, setMyScore] = useState(score?.mine?.score ?? null)
  const [myNote, setMyNote] = useState(score?.mine?.note ?? '')
  const stage = effectiveStage(item, config)
  const stageDef = stageOf(config, stage)
  const title = biPick(item.entity.title, lang) || '-'
  const answers = item.fields ?? {}
  const labelled = fields.filter((f) => f?.name)
  const seen = new Set(labelled.map((f) => f.name))
  const rest = Object.keys(answers).filter((k) => !seen.has(k))
  const scoreRows = score?.all ?? []
  const emailRows = EMAIL_KEYS.flatMap((k) => (emails[k] ? [{ key: k, ...emails[k] }] : []))
  const dirtyScore = (myScore ?? null) !== (score?.mine?.score ?? null) || (myNote ?? '') !== (score?.mine?.note ?? '')

  return (
    <Modal open onClose={onClose} title={title} description={[biPick(item.entity.subtitle, lang), item.contact?.email, item.contact?.phone].filter(Boolean).join(' · ')} closeLabel={t('common.close')} className="sm:max-w-3xl"
      footer={<>
        {sourceLink && (
          <Link to={sourceLink} className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface" data-testid="open-source">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('selection.edit.openSource')}
          </Link>
        )}
        <Button variant="outline" size="sm" onClick={onClose}>{t('common.close')}</Button>
      </>}
    >
      <div className="space-y-5 text-sm" data-testid="applicant-drawer">
        <section className="flex flex-wrap items-center gap-2">
          <Badge tone="outline">{t(`entity.source.${item.source.kind}`)}</Badge>
          {item.missing && <Badge tone="red">{t('entity.source.missing')}</Badge>}
          {item.excluded && <Badge tone="amber">{t('entity.source.hidden')}</Badge>}
          {item.overlay?.legacy_status === 'displayed' && <Badge tone="neutral">{t('selection.edit.legacyDisplayed')}</Badge>}
          {participant && <Badge tone={participant.status === 'attended' ? 'green' : participant.status === 'withdrawn' ? 'red' : 'blue'}>{t('selection.drawer.participant', { status: t(`selection.participants.status.${participant.status}`) })}</Badge>}
          <label className="ms-auto flex items-center gap-2">
            <span className="font-medium">{t('selection.col.stage')}</span>
            <select aria-label={t('selection.col.stage')} value={stage ?? ''} onChange={(e) => onSetStage(item, e.target.value || null)} className="min-h-9 rounded-md border border-input bg-background px-2 text-sm" disabled={saving}>
              {config.stages.map((s) => <option key={s.key} value={s.key}>{biPick(s.label, lang) || s.key}</option>)}
              {stage && !config.stages.some((s) => s.key === stage) && <option value={stage}>{stage}</option>}
            </select>
          </label>
        </section>

        {(review?.reason || review?.origin_stage || review?.reviewed_at) && (
          <section className="rounded-md border bg-surface/60 p-3" data-testid="drawer-review">
            <h3 className="mb-1 font-semibold">{t('selection.drawer.review')}</h3>
            {review.reason && <p className="whitespace-pre-line" dir="auto">{review.reason}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {review.reviewed_at && formatDate?.(review.reviewed_at)}{review.reviewer_name ? ` · ${review.reviewer_name}` : ''}
            </p>
            {stageDef?.type === 'hold' && review.origin_stage && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => onSetStage(item, review.origin_stage, { skipReason: true })} disabled={saving}>
                {t('selection.edit.moveBack', { stage: biPick(stageOf(config, review.origin_stage)?.label, lang) || review.origin_stage })}
              </Button>
            )}
          </section>
        )}

        <section className="space-y-2" data-testid="drawer-scores">
          <h3 className="font-semibold">{t('selection.drawer.scores')}</h3>
          {scoreRows.length === 0 ? <p className="text-xs text-muted-foreground">{t('selection.drawer.noScores')}</p> : (
            <ul className="space-y-1">
              {scoreRows.map((s) => (
                <li key={s.reviewer_id} className="flex flex-wrap items-start gap-2 text-xs">
                  <span className="inline-flex items-center gap-0.5 font-semibold tabular-nums"><Star className="h-3.5 w-3.5 fill-current text-athar-yellow" aria-hidden="true" />{s.score ?? '-'}</span>
                  <span className="font-medium">{s.reviewer_name ?? '-'}</span>
                  {s.note && <span className="text-muted-foreground" dir="auto">{s.note}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <fieldset>
              <legend className="mb-1 text-xs font-medium">{t('selection.drawer.myScore')}</legend>
              <div className="flex gap-1" role="radiogroup" aria-label={t('selection.drawer.myScore')}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={myScore === n} aria-label={String(n)} onClick={() => setMyScore(myScore === n ? null : n)}
                    className={cn('tap-target min-w-11 rounded-md border px-2 text-sm font-semibold', myScore === n ? 'border-foreground bg-accent text-accent-foreground' : 'border-input bg-background hover:bg-surface')}>
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
            <Field label={t('selection.drawer.myNote')} value={myNote} onChange={(e) => setMyNote(e.target.value)} className="min-w-48 flex-1" />
            <Button size="sm" onClick={() => onSaveScore(item, { score: myScore, note: myNote })} disabled={!dirtyScore} loading={saving} data-testid="save-score">{t('selection.drawer.saveScore')}</Button>
          </div>
        </section>

        <section className="space-y-2" data-testid="drawer-emails">
          <h3 className="font-semibold">{t('selection.drawer.emails')}</h3>
          {emailRows.length === 0 ? <p className="text-xs text-muted-foreground">{t('selection.drawer.noEmails')}</p> : (
            <ul className="space-y-1 text-xs">
              {emailRows.map((e) => (
                <li key={e.key} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`selection.email.${e.key}`)}</span>
                  <Badge tone={STATUS_TONE[e.last?.status] ?? 'neutral'}>{t(`selection.status.${e.last?.status ?? 'queued'}`)}</Badge>
                  <span className="text-muted-foreground">x{e.count} · {e.last?.recipient} · {formatDate?.(e.last?.sent_at ?? e.last?.created_at)}</span>
                  {e.last?.error_message && <span className="text-destructive-text">{e.last.error_message}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2" data-testid="drawer-answers">
          <h3 className="font-semibold">{t('selection.drawer.answers')}</h3>
          {item.source.kind !== 'form_response' && <p className="text-xs text-muted-foreground">{t('entity.editor.sourceReadOnly')}</p>}
          <dl className="grid gap-2 sm:grid-cols-2">
            {labelled.map((f) => {
              const v = formatValue(answers[f.name])
              return (
                <div key={f.name} className="rounded-md border p-2">
                  <dt className="text-xs font-medium text-muted-foreground" dir="auto">{(lang === 'ar' ? f.label?.ar || f.label?.en : f.label?.en || f.label?.ar) || f.name}</dt>
                  <dd className="whitespace-pre-line break-words" dir="auto">{v ?? t('selection.drawer.noAnswer')}</dd>
                </div>
              )
            })}
            {rest.map((k) => (
              <div key={k} className="rounded-md border p-2">
                <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
                <dd className="whitespace-pre-line break-words" dir="auto">{formatValue(answers[k]) ?? t('selection.drawer.noAnswer')}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Modal>
  )
}
export default ApplicantDrawer
