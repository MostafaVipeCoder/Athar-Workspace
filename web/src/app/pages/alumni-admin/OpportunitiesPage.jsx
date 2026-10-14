import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ArchiveRestore, Bell, CalendarClock, Eye, EyeOff, Inbox, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAdminMutations, useAlumniPrograms, useOpportunities } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { EmptyState, ErrorState, SkeletonList } from '../../../ui/States.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { AdminPage, Segmented } from './ui.jsx'
import OpportunityForm from './OpportunityForm.jsx'
import OpportunityApplications from './OpportunityApplications.jsx'
import { OPP_TABS, archivePatch, deadlineState, oppStatus, oppStatusTone, publishPatch, restorePatch, unpublishPatch } from './adminLogic.js'
import { useAdminErrorText, useAdminFormat, useLabels } from './hooks.js'
import './i18n.common.js'
import './opportunities.i18n.js'

const countOf = (o) => o.apps?.[0]?.count ?? 0

/** The chips that say who an opportunity is for (programs, sectors, stages, locations): plain text, so it reads the same to everybody. */
function TargetChips({ target, programs, labels, d, pick }) {
  const groups = [
    ['programs', (target.program_ids ?? []).map((id) => { const p = programs.find((x) => x.id === id); return p ? pick(p, 'name') : null }).filter(Boolean), 'targetPrograms'],
    ['sectors', (target.sectors ?? []).map((k) => labels.label('sector', k)), 'targetSectors'],
    ['stages', (target.stages ?? []).map((k) => labels.label('stage', k)), 'targetStages'],
    ['gov', (target.governorates ?? []).map((k) => labels.label('governorate', k)), 'targetGovernorates'],
  ].filter(([, list]) => list.length > 0)
  if (groups.length === 0) return <p className="text-xs text-muted-foreground">{d('everyone')}</p>
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs">
      <Badge tone="amber">{d('targeted')}</Badge>
      {groups.map(([k, list, label]) => <span key={k} className="text-muted-foreground"><span className="font-semibold text-foreground">{d(label)}:</span> {list.join('، ')}</span>)}
    </p>
  )
}

/** M6: the opportunities hub. Create / edit (a draft until published), publish, archive, delete; the applications and their status workflow open in a drawer. */
export default function OpportunitiesPage() {
  const { t, tn, pick } = useLanguage()
  const d = (k, v) => t(`alumni.admin.opp.${k}`, v)
  const fmt = useAdminFormat()
  const labels = useLabels()
  const toast = useToast()
  const confirm = useConfirm()
  const errorText = useAdminErrorText()
  const { saveOpportunity, deleteOpportunity } = useAdminMutations()
  const q = useOpportunities()
  const programs = useAlumniPrograms()
  const [tab, setTab] = useState('all')
  const [editing, setEditing] = useState(null) // { opportunity|null }
  const [appsId, setAppsId] = useState(null)
  const appsOf = (q.data ?? []).find((o) => o.opportunity_id === appsId) ?? null
  const list = useMemo(() => (q.data ?? []).filter((o) => tab === 'all' || oppStatus(o) === tab), [q.data, tab])
  const counts = useMemo(() => {
    const c = { all: (q.data ?? []).length, published: 0, draft: 0, archived: 0 }
    for (const o of q.data ?? []) c[oppStatus(o)] += 1
    return c
  }, [q.data])

  async function patch(o, p, ok) {
    try {
      await saveOpportunity.mutateAsync({ id: o.opportunity_id, patch: p })
      toast.success(ok)
    } catch (e) {
      toast.error(`${d('actionFailed')} ${errorText(e)}`)
    }
  }
  async function remove(o) {
    const n = countOf(o)
    const yes = await confirm({ title: d('deleteTitle'), message: n > 0 ? tn('alumni.admin.opp.deleteBody', n) : d('deleteBodyNone'), confirmLabel: d('delete'), destructive: true })
    if (!yes) return
    try {
      await deleteOpportunity.mutateAsync(o.opportunity_id)
      toast.success(d('deleted'))
    } catch (e) {
      toast.error(`${d('actionFailed')} ${errorText(e)}`)
    }
  }

  return (
    <AdminPage testId="alumni-admin-opportunities" title={d('title')} subtitle={d('subtitle')} actions={<Button onClick={() => setEditing({ opportunity: null })} data-testid="opp-new"><Plus className="h-4 w-4" aria-hidden="true" />{d('new')}</Button>}>
      <Segmented label={d('tabs')} value={tab} onChange={setTab} options={OPP_TABS.map((k) => ({ value: k, label: d(`tab.${k}`), count: q.data ? counts[k] : undefined }))} />
      {q.isPending ? <SkeletonList count={3} className="space-y-3" itemClassName="h-28 w-full" />
        : q.isError ? <ErrorState error={q.error} title={d('loadFailed')} onRetry={() => q.refetch()} />
        : list.length === 0 ? <EmptyState icon={Inbox} title={d('empty')} body={d('emptyBody')} action={<Button onClick={() => setEditing({ opportunity: null })}>{d('new')}</Button>} />
        : (
          <ul className="space-y-3" data-testid="opportunities">
            {list.map((o) => {
              const status = oppStatus(o)
              const dl = deadlineState(o.deadline)
              const providerName = pick(o, 'provider')
              return (
                <li key={o.opportunity_id} className="space-y-3 rounded-card border bg-card p-4" data-status={status}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={oppStatusTone(status)}>{d(`status.${status}`)}</Badge>
                        <Badge tone="blue">{d(`type.${o.type}`)}</Badge>
                      </div>
                      <h2 className="text-card-title">{pick(o, 'title')}</h2>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        {providerName && <span>{d('provider', { name: providerName })}</span>}
                        <span className="inline-flex items-center gap-1"><CalendarClock className="h-4 w-4" aria-hidden="true" />{o.deadline ? d('deadline', { date: fmt.date(o.deadline) }) : d('noDeadline')}</span>
                        {dl === 'passed' && <Badge tone="red">{d('deadline.passed')}</Badge>}
                        {dl === 'soon' && <Badge tone="amber">{d('deadline.soon')}</Badge>}
                      </p>
                      <TargetChips target={o.target ?? {}} programs={programs.data?.programs ?? []} labels={labels} d={d} pick={pick} />
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setAppsId(o.opportunity_id)} data-testid="opp-apps">{d('openApplications')} · {tn('alumni.admin.opp.applications', countOf(o))}</Button>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button variant="outline" size="sm" onClick={() => setEditing({ opportunity: o })}><Pencil className="h-4 w-4" aria-hidden="true" />{d('edit')}</Button>
                    {status === 'draft' && <Button size="sm" onClick={() => patch(o, publishPatch(), d('published'))} data-testid="opp-publish"><Eye className="h-4 w-4" aria-hidden="true" />{d('publish')}</Button>}
                    {status === 'published' && <Link to={`/alumni/admin/notifications?opportunity=${o.opportunity_id}`} className={buttonClass({ variant: 'outline', size: 'sm' })}><Bell className="h-4 w-4" aria-hidden="true" />{d('notify')}</Link>}
                    {status === 'published' && <Button variant="outline" size="sm" onClick={() => patch(o, unpublishPatch(), d('unpublished'))}><EyeOff className="h-4 w-4" aria-hidden="true" />{d('unpublish')}</Button>}
                    {status !== 'archived' && <Button variant="ghost" size="sm" onClick={() => patch(o, archivePatch(), d('archived'))}><Archive className="h-4 w-4" aria-hidden="true" />{d('archive')}</Button>}
                    {status === 'archived' && <Button variant="ghost" size="sm" onClick={() => patch(o, restorePatch(), d('restored'))}><ArchiveRestore className="h-4 w-4" aria-hidden="true" />{d('restore')}</Button>}
                    <Button variant="ghost" size="sm" className="ms-auto text-destructive-text" onClick={() => remove(o)}><Trash2 className="h-4 w-4" aria-hidden="true" />{d('delete')}</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      {editing && (
        <OpportunityForm opportunity={editing.opportunity} onClose={() => setEditing(null)}
          onSave={(p) => saveOpportunity.mutateAsync({ id: editing.opportunity?.opportunity_id ?? null, patch: editing.opportunity ? p : { ...p, is_active: false } })} />
      )}
      {appsOf && <OpportunityApplications opportunity={appsOf} onClose={() => setAppsId(null)} />}
    </AdminPage>
  )
}
