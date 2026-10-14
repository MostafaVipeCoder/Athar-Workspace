import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Award, CheckCircle2, Info, Link2Off, RefreshCw, Users } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { Field } from '../../ui/Field.jsx'
import { SearchBar, matchesTerm } from '../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { cn } from '../../lib/cn.js'
import { staffPath } from '../../lib/links.js'
import { useCertificateMutations, useCertificatesAdmin } from '../../data/certificates.js'
import CertificateActions from '../../shared/certificates/CertificateActions.jsx'
import { WithdrawnChip } from '../../shared/entities/WithdrawnChip.jsx'
import { PERSON_TONES, ROW_TONES, canReissue, canRevokeAll, issuable, issuableInBulk, issueBlocker, rowState, summarize } from './certConfig.js'
import './i18n.js'

const RESULT_TONES = { issued: 'green', authorised: 'blue', existing: 'neutral', not_attended: 'amber', no_name: 'amber', skipped_revoked: 'amber', not_found: 'red', error: 'red' }

/**
 * Issue panel (design 01 section 3.10, decisions 01-11 / 07-9, owner decision 08 section 17.2). A row is a PARTICIPANT (the company that
 * attended the project); the certificates belong to its FOUNDERS: every founder who has an ACCOUNT linked to the company gets a certificate
 * under HIS OWN name (with the company name) and downloads it from his own Program page. The PM's explicit "Issue" action authorises the
 * participant and creates the certificate of every account that is already linked; a founder who links later gets his when he opens the
 * page. The server only allows it after the project is completed and only for `attended` participants; here the button is disabled with the
 * reason shown. "All attended" leaves a participant whose authorisation was revoked alone (it is re-authorised by selecting it); one founder
 * whose certificate was revoked is issued again with his own "Issue again". Revocation is manual, with a warning (07-9), per founder or for
 * the whole participant.
 */
export default function IssueTab({ node, projectId }) {
  const { t, tn, formatDate } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const q = useCertificatesAdmin(node.id)
  const m = useCertificateMutations(node.id)
  const [selected, setSelected] = useState(() => new Set())
  const [term, setTerm] = useState('')
  const [results, setResults] = useState(null) // { byParticipant, summary }
  const [revoking, setRevoking] = useState(null) // { row, person }
  const [revokingAll, setRevokingAll] = useState(null) // row
  const [reason, setReason] = useState('')

  const admin = q.data
  const rows = useMemo(() => admin?.rows ?? [], [admin])
  const visible = useMemo(() => rows.filter((r) => matchesTerm(r, ['name', 'company_name', (x) => (x.founders ?? []).map((f) => `${f.name} ${f.certificate?.code ?? ''}`).join(' ')], term)), [rows, term])
  const counts = useMemo(() => summarize(rows), [rows])
  const blocker = issueBlocker(admin)
  const reopened = admin && !admin.project.completed_at && counts.issued > 0
  // certificates exist but the node is not shown to participants: the founders' page stays empty (found in review: nothing here said so)
  const hidden = counts.issued > 0 && !node.show_to_participants
  const issuableRows = rows.filter(issuable)
  const bulkRows = rows.filter(issuableInBulk)
  const chosen = issuableRows.filter((r) => selected.has(r.participant_id))
  const langName = admin ? t(`certificates.language.${admin.language}`) : ''
  const disabledReason = blocker ? t(`certificates.issue.blocked.${blocker}`, { language: langName }) : null

  const toggle = (id) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const allSelected = issuableRows.length > 0 && chosen.length === issuableRows.length
  const errorText = (e) => t(e?.messageKey ?? 'errors.unknown')

  async function run(targets, ids) {
    const reissue = targets.filter((r) => rowState(r) === 'revoked').length
    const ok = await confirm({
      title: tn('certificates.issue.confirm.title', targets.length),
      message: `${t('certificates.issue.confirm.body')}${reissue ? ` ${tn('certificates.issue.confirm.reissue', reissue)}` : ''}`,
      confirmLabel: t('certificates.issue.confirm.cta'),
    })
    if (!ok) return
    try {
      const res = await m.issue.mutateAsync(ids)
      const byParticipant = Object.fromEntries((res.results ?? []).map((r) => [r.participant_id, r.status]))
      setResults({ byParticipant, summary: res })
      setSelected(new Set())
      toast.success(t('certificates.issue.done', { authorised: res.authorised, issued: res.issued, existing: res.existing, skipped: res.skipped }))
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  async function reissue(row, person) {
    const ok = await confirm({
      title: t('certificates.issue.reissue.title'),
      message: t('certificates.issue.reissue.body', { name: person.name || row.name }),
      confirmLabel: t('certificates.issue.reissue.cta'),
    })
    if (!ok) return
    try {
      await m.reissue.mutateAsync(person.certificate.id)
      toast.success(t('certificates.issue.reissued'))
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  async function revokePerson() {
    if (!revoking) return
    try {
      await m.revoke.mutateAsync({ certificateId: revoking.person.certificate.id, reason: reason.trim() })
      toast.success(t('certificates.issue.revoked'))
      setRevoking(null)
      setReason('')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  async function revokeAll() {
    if (!revokingAll) return
    try {
      const res = await m.revokeParticipant.mutateAsync({ participantId: revokingAll.participant_id, reason: reason.trim() })
      toast.success(tn('certificates.issue.revokedAll', res?.revoked ?? 0))
      setRevokingAll(null)
      setReason('')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  if (q.isPending) return <Loading />
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />

  const dateOf = (iso) => (iso ? formatDate(iso) : '')
  const tiles = [['attended', counts.attended], ['issued', counts.issued], ['claimable', counts.claimable], ['unlinked', counts.unlinked], ['revoked', counts.revoked]]

  return (
    <div className="space-y-5" data-testid="issue-tab">
      <header className="space-y-1">
        <h3 className="font-display text-lg font-bold">{t('certificates.issue.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('certificates.issue.intro')}</p>
      </header>

      {blocker ? (
        <div role="status" className="flex flex-wrap items-start gap-3 rounded-card border border-accent bg-accent/30 p-4" data-testid="issue-blocked" data-blocker={blocker}>
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">{disabledReason}</p>
          {blocker === 'notCompleted' && admin.project.program_id && (
            <Link to={staffPath.programSettings(admin.project.program_id)} className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('certificates.issue.blocked.notCompleted.action')}</Link>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-success" data-testid="issue-ready"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('certificates.issue.ready')}</p>
      )}
      {hidden && (
        <div role="status" className="flex flex-wrap items-start gap-3 rounded-card border border-accent bg-accent/30 p-3 text-sm" data-testid="issue-hidden">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{t('certificates.issue.hidden')}</p>
          <Link to={staffPath.node(projectId, node.id, 'settings')} className={buttonClass({ variant: 'outline', size: 'sm' })} data-testid="issue-hidden-link">{t('certificates.issue.hidden.action')}</Link>
        </div>
      )}
      {reopened && <p role="status" className="flex items-start gap-2 rounded-card bg-accent/30 p-3 text-sm" data-testid="issue-reopened"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('certificates.issue.reopened')}</p>}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="issue-counts">
        {tiles.map(([k, n]) => (
          <div key={k} className="rounded-card border border-border p-3">
            <dt className="text-xs text-muted-foreground">{t(`certificates.issue.count.${k}`)}</dt>
            <dd className="font-display text-2xl font-bold" data-testid={`count-${k}`}>{n}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={Boolean(blocker) || bulkRows.length === 0} loading={m.issue.isPending} onClick={() => run(bulkRows, null)} data-testid="issue-all">
            <Award className="h-4 w-4" aria-hidden="true" />{t('certificates.issue.all', { count: bulkRows.length })}
          </Button>
          <Button variant="outline" disabled={Boolean(blocker) || chosen.length === 0} loading={m.issue.isPending} onClick={() => run(chosen, chosen.map((r) => r.participant_id))} data-testid="issue-selected">
            {t('certificates.issue.selected', { count: chosen.length })}
          </Button>
        </div>
        {disabledReason ? <p className="text-xs text-muted-foreground" data-testid="issue-disabled-why">{disabledReason}</p>
          : bulkRows.length === 0 && issuableRows.length === 0 && counts.attended > 0 ? <p className="text-xs text-muted-foreground">{t('certificates.issue.noneToIssue')}</p> : null}
      </div>

      {results && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface p-3 text-sm" data-testid="issue-results">
          <span>{t('certificates.issue.done', { authorised: results.summary.authorised, issued: results.summary.issued, existing: results.summary.existing, skipped: results.summary.skipped })}</span>
          <Button size="sm" variant="ghost" onClick={() => setResults(null)}>{t('certificates.issue.result.dismiss')}</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={Users} title={t('certificates.issue.empty.title')} body={t('certificates.issue.empty.body')}
          action={<Link to={staffPath.projectParticipants(projectId)} className={buttonClass({ variant: 'outline', size: 'sm' })}>{t('certificates.issue.others.link')}</Link>} />
      ) : (
        <section className="space-y-2" aria-label={t('certificates.issue.title')}>
          <div className="flex flex-wrap items-center gap-3">
            <SearchBar value={term} onChange={setTerm} label={t('certificates.issue.search')} className="min-w-0 flex-1 sm:max-w-sm" />
            {issuableRows.length > 0 && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(issuableRows.map((r) => r.participant_id)))} data-testid="select-all" />
                {t('certificates.issue.selectAll')}
              </label>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('certificates.issue.nameHint')}</p>
          <ul className="space-y-3" data-testid="issue-rows">
            {visible.length === 0 && <li className="rounded-card border border-border p-4 text-sm text-muted-foreground">{t('certificates.issue.noMatch')}</li>}
            {visible.map((r) => {
              const state = rowState(r)
              const result = results?.byParticipant?.[r.participant_id]
              const title = r.company_name || r.name
              const people = r.founders ?? []
              const flagged = (r.counts?.issued ?? 0) > 0 && r.status !== 'attended'
              return (
                <li key={r.participant_id} className="space-y-3 rounded-card border border-border p-3 sm:p-4" data-testid="issue-row" data-state={state} data-participant={r.participant_id}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex min-h-11 w-11 items-center justify-center">
                      {issuable(r) && (
                        <label className="flex h-11 w-11 cursor-pointer items-center justify-center">
                          <input type="checkbox" className="h-4 w-4" checked={selected.has(r.participant_id)} onChange={() => toggle(r.participant_id)} aria-label={t('certificates.issue.select', { name: title })} data-testid="row-select" />
                        </label>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 basis-48 space-y-1">
                      <p className="break-words font-semibold" dir="auto" data-testid="row-name">{title}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={ROW_TONES[state]} data-testid="row-state">{t(`certificates.issue.state.${state}`)}</Badge>
                        {r.status === 'withdrawn' ? <WithdrawnChip data-testid="row-withdrawn" /> : r.status !== 'attended' && <Badge tone="outline">{t(`certificates.issue.rowStatus.${r.status}`)}</Badge>}
                        {r.needs_review && <Badge tone="amber">{t('certificates.issue.flag.needsReview')}</Badge>}
                        {result && result !== 'existing' && <Badge tone={RESULT_TONES[result] ?? 'neutral'} data-testid="row-result">{t(`certificates.issue.result.${result}`)}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground" data-testid="row-summary">
                        {tn('certificates.issue.people.summary', r.counts?.people ?? people.length, { issued: r.counts?.issued ?? 0, people: r.counts?.people ?? people.length })}
                        {r.grant && ` · ${r.grant.revoked_at ? t('certificates.issue.grant.revokedOn', { date: dateOf(r.grant.revoked_at) }) : t('certificates.issue.grant.on', { date: dateOf(r.grant.granted_at) })}`}
                        {r.grant?.revoked_at && r.grant.revoked_reason ? ` · ${t('certificates.issue.reason', { reason: r.grant.revoked_reason })}` : ''}
                      </p>
                      {flagged && <p className="flex items-start gap-1 text-xs text-muted-foreground" data-testid="row-flag"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(r.status === 'withdrawn' ? 'certificates.issue.flag.withdrawnIssued' : 'certificates.issue.flag.statusChanged')}</p>}
                    </div>
                    {canRevokeAll(r) && (
                      <Button size="sm" variant="destructive" onClick={() => { setRevokingAll(r); setReason('') }} aria-label={t('certificates.issue.revokeAllFor', { name: title })} data-testid="row-revoke-all">{t('certificates.issue.revokeAll')}</Button>
                    )}
                  </div>

                  {people.length > 0 && (
                    <ul className="divide-y divide-border rounded-md border border-border bg-surface/40" aria-label={t('certificates.issue.people.founders')} data-testid="person-list">
                      {people.map((p, i) => {
                        const c = p.certificate
                        const ps = p.state
                        const printed = c?.name || p.name
                        return (
                          <li key={c?.id ?? `${r.participant_id}-${i}`} className="flex flex-wrap items-start gap-3 p-3 sm:items-center" data-testid="person-row" data-state={ps} data-person={p.name}>
                            <div className="min-w-0 flex-1 basis-48 space-y-1">
                              <p className="break-words font-semibold" dir="auto" data-testid="person-name">{printed || '-'}</p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge tone={PERSON_TONES[ps] ?? 'neutral'} data-testid="person-state">{t(`certificates.issue.person.${ps}`)}</Badge>
                                {p.detached && <Badge tone="outline">{t('certificates.issue.person.detached')}</Badge>}
                              </div>
                              {c && (
                                <p className="text-xs text-muted-foreground">
                                  <span dir="ltr" className="font-mono" data-testid="person-code">{c.code}</span>
                                  {' · '}{c.revoked_at ? t('certificates.issue.revokedOn', { date: dateOf(c.revoked_at) }) : t('certificates.issue.issuedOn', { date: dateOf(c.issued_at) })}
                                  {c.revoked_at && c.revoked_reason ? ` · ${t('certificates.issue.reason', { reason: c.revoked_reason })}` : ''}
                                </p>
                              )}
                              {ps === 'not_linked' && <p className="flex items-start gap-1 text-xs text-muted-foreground" data-testid="person-hint"><Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('certificates.issue.person.not_linked.hint')}</p>}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {ps === 'issued' && c && <CertificateActions certificateId={c.id} name={printed} compact />}
                              {ps === 'issued' && c && (
                                <Button size="sm" variant="destructive" onClick={() => { setRevoking({ row: r, person: p }); setReason('') }} aria-label={t('certificates.issue.revokeFor', { name: printed })} data-testid="person-revoke">{t('certificates.issue.revoke')}</Button>
                              )}
                              {canReissue(r, p) && (
                                <Button size="sm" variant="outline" loading={m.reissue.isPending} onClick={() => reissue(r, p)} aria-label={t('certificates.issue.reissueFor', { name: printed })} data-testid="person-reissue">
                                  <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('certificates.issue.reissue')}
                                </Button>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {admin.others > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="issue-others">
          {tn('certificates.issue.others', admin.others)}
          <Link to={staffPath.projectParticipants(projectId)} className="font-semibold text-primary underline-offset-4 hover:underline">{t('certificates.issue.others.link')}</Link>
        </p>
      )}

      <Modal open={Boolean(revoking)} onClose={() => setRevoking(null)} title={t('certificates.issue.revoke.title')} closeLabel={t('common.close')}
        footer={<>
          <Button variant="outline" onClick={() => setRevoking(null)}>{t('common.cancel')}</Button>
          <Button variant="destructive" loading={m.revoke.isPending} onClick={revokePerson} data-testid="confirm-revoke">{t('certificates.issue.revoke.cta')}</Button>
        </>}>
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-text" aria-hidden="true" />{t('certificates.issue.revoke.warning')}</p>
          {revoking && <p className={cn('break-words font-semibold')} dir="auto">{revoking.person.certificate?.name || revoking.person.name}</p>}
          <Field as="textarea" label={t('certificates.issue.revoke.reason')} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="revoke-reason" />
        </div>
      </Modal>

      <Modal open={Boolean(revokingAll)} onClose={() => setRevokingAll(null)} title={t('certificates.issue.revokeAll.title')} closeLabel={t('common.close')}
        footer={<>
          <Button variant="outline" onClick={() => setRevokingAll(null)}>{t('common.cancel')}</Button>
          <Button variant="destructive" loading={m.revokeParticipant.isPending} onClick={revokeAll} data-testid="confirm-revoke-all">{t('certificates.issue.revokeAll.cta')}</Button>
        </>}>
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-text" aria-hidden="true" />{t('certificates.issue.revokeAll.warning')}</p>
          {revokingAll && <p className="break-words font-semibold" dir="auto">{revokingAll.company_name || revokingAll.name}</p>}
          <Field as="textarea" label={t('certificates.issue.revoke.reason')} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="revoke-all-reason" />
        </div>
      </Modal>
    </div>
  )
}
