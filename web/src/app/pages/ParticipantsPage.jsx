import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CheckCheck, ExternalLink, UserPlus, Users } from 'lucide-react'
import '../../nodes/selection/i18n.js'
import { useProjectContext } from '../guards/ProjectAccess.jsx'
import { useProjectGraph } from '../../data/canvas.js'
import { PARTICIPANT_STATUSES, useParticipantMutations, useParticipants } from '../../data/participants.js'
import { usePeopleMutations } from '../../data/people.js'
import { publicThumbUrl, uploadImage } from '../../data/storage.js'
import { useAuth } from '../../app/AuthContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { Img } from '../../ui/Img.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { EntityPicker } from '../../shared/entities/EntityPicker.jsx'
import { biPick } from '../../lib/entities.js'
import { staffPath } from '../../lib/links.js'
import { cn } from '../../lib/cn.js'

const STATUS_TONE = { accepted: 'blue', attended: 'green', withdrawn: 'red' }
const selectCls = 'min-h-9 rounded-md border border-input bg-background px-2 text-sm'

/**
 * Project Participants page (design 06 section 2.3 route, 00 section 7, 02 section 7.3, decisions 01-6 / 02-7):
 * participants enrolled through a Selection stage (accepted; lazy rows) or added by hand (a company record), with
 * status accepted / attended / withdrawn, "Enroll all accepted", "Mark all accepted as attended" then unmark the
 * absentees, withdraw / reinstate, and a link to the company record. Certificates read `attended` only.
 */
export default function ParticipantsPage() {
  const { project, projectId } = useProjectContext()
  const { t, lang, pick, formatDate } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const graph = useProjectGraph(projectId)
  const rows = useParticipants(projectId)
  const m = useParticipantMutations(projectId)
  const people = usePeopleMutations()
  const [term, setTerm] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [picker, setPicker] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const stages = useMemo(() => (graph.data?.nodes ?? []).filter((n) => n.type === 'selection'), [graph.data])
  const enrollingStages = useMemo(() => [...new Set((rows.data ?? []).filter((p) => p.virtual && p.sourceNodeId).map((p) => p.sourceNodeId))], [rows.data])
  const list = useMemo(() => (rows.data ?? []).filter((p) => {
    if (status && p.status !== status) return false
    if (source && p.source !== source) return false
    const q = term.trim().toLowerCase()
    if (q && ![p.name.en, p.name.ar, p.email].filter(Boolean).some((s) => String(s).toLowerCase().includes(q))) return false
    return true
  }), [rows.data, status, source, term])
  const summary = useMemo(() => {
    const c = { accepted: 0, attended: 0, withdrawn: 0 }
    for (const p of rows.data ?? []) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [rows.data])
  const existingCompanies = useMemo(() => new Set((rows.data ?? []).map((p) => p.companyId).filter(Boolean)), [rows.data])

  async function run(fn, { id = null, success = null } = {}) {
    if (id) setBusyId(id)
    try {
      const out = await fn()
      if (success) toast.success(typeof success === 'function' ? success(out) : success)
      return out
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
      return undefined
    } finally {
      if (id) setBusyId(null)
    }
  }
  const setPStatus = (p, s) => run(() => m.setStatus.mutateAsync({ participant: p, status: s }), { id: p.id, success: t('selection.participants.statusSet') })
  async function withdraw(p) {
    if (!(await confirm({ title: t('selection.participants.withdrawTitle', { name: biPick(p.name, lang) || '-' }), message: t('selection.participants.withdrawBody'), destructive: true }))) return
    setPStatus(p, 'withdrawn')
  }
  async function markAll() {
    if (!(await confirm({ title: t('selection.participants.markAll'), message: t('selection.participants.markAllBody') }))) return
    run(() => m.markAllAttended.mutateAsync({ selectionNodeIds: enrollingStages }), { success: (n) => t('selection.participants.marked', { count: n }) })
  }
  const enrollAll = () => run(() => m.enrollAll.mutateAsync({ selectionNodeIds: enrollingStages }), { success: (n) => t('selection.participants.enrolled', { count: n }) })

  const stageName = (id) => { const n = stages.find((s) => s.id === id); return n ? pick(n, 'name') || n.type : null }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4" data-testid="participants-page">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link to={staffPath.program(project.program_id)} className="hover:underline">{t('programs.title')}</Link>
          {' / '}
          <Link to={staffPath.project(projectId)} className="hover:underline">{pick(project, 'name')}</Link>
        </p>
        <h1 className="text-section-title">{t('selection.participants.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('selection.participants.hint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBar value={term} onChange={setTerm} label={t('selection.participants.search')} className="min-w-56 flex-1" />
        <select aria-label={t('selection.participants.filter.status')} value={status} onChange={(e) => setStatus(e.target.value)} className={cn(selectCls, 'min-h-11')}>
          <option value="">{t('selection.participants.filter.any')}</option>
          {PARTICIPANT_STATUSES.map((s) => <option key={s} value={s}>{t(`selection.participants.status.${s}`)}</option>)}
        </select>
        <select aria-label={t('selection.participants.filter.source')} value={source} onChange={(e) => setSource(e.target.value)} className={cn(selectCls, 'min-h-11')}>
          <option value="">{t('selection.participants.filter.anySource')}</option>
          <option value="selection">{t('selection.participants.source.selection')}</option>
          <option value="manual">{t('selection.participants.source.manual')}</option>
        </select>
        <Button size="sm" onClick={() => setPicker(true)} data-testid="add-company"><UserPlus className="h-4 w-4" aria-hidden="true" />{t('selection.participants.add')}</Button>
        {enrollingStages.length > 0 && <Button size="sm" variant="secondary" onClick={enrollAll} loading={m.enrollAll.isPending} data-testid="enroll-all">{t('selection.participants.enrollAll')}</Button>}
        <Button size="sm" variant="outline" onClick={markAll} loading={m.markAllAttended.isPending} disabled={!rows.data?.some((p) => p.status === 'accepted')} data-testid="mark-all"><CheckCheck className="h-4 w-4" aria-hidden="true" />{t('selection.participants.markAll')}</Button>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="participants-summary">{t('selection.participants.summary', summary)} · {t('selection.participants.count', { shown: list.length, total: rows.data?.length ?? 0 })}</p>

      {rows.isPending ? <Loading /> : rows.error ? <ErrorState error={rows.error} onRetry={rows.refetch} /> : (rows.data ?? []).length === 0 ? (
        <EmptyState icon={Users} title={t('selection.participants.empty')} body={t('selection.participants.emptyBody')} />
      ) : list.length === 0 ? <EmptyState title={t('selection.participants.noMatch')} /> : (
        <div className="overflow-x-auto rounded-input border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-start text-xs font-semibold uppercase text-athar-ink">
              <tr>
                <th className="p-2 text-start">{t('selection.participants.col.name')}</th>
                <th className="p-2 text-start">{t('selection.participants.col.source')}</th>
                <th className="p-2 text-start">{t('selection.participants.col.status')}</th>
                <th className="p-2 text-start">{t('selection.participants.col.since')}</th>
                <th className="p-2 text-start">{t('selection.participants.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const name = biPick(p.name, lang) || '-'
                const busy = busyId === p.id
                return (
                  <tr key={p.id} className={cn('border-t align-middle', p.status === 'withdrawn' && 'opacity-60', busy && 'animate-pulse')} data-testid="participant-row">
                    <td className="p-2">
                      <div className="flex items-center gap-3">
                        <Img src={publicThumbUrl(p.logoPath)} variant="thumb" alt="" aspect="1 / 1" className="h-10 w-10 shrink-0 rounded-md" fit="contain" />
                        <div className="min-w-0">
                          <p className="font-medium" dir="auto">{name}</p>
                          {p.email && <p className="text-xs text-muted-foreground" dir="ltr">{p.email}</p>}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {p.needsReview && <Badge tone="amber">{t('selection.participants.needsReview')}</Badge>}
                            {p.withdrawalRequestedAt && <Badge tone="amber">{t('selection.participants.withdrawalRequested')}</Badge>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone="outline">{t(`selection.participants.source.${p.source}`)}</Badge>
                        {p.virtual && <Badge tone="neutral">{t('selection.participants.eligible')}</Badge>}
                        {p.sourceNodeId && stageName(p.sourceNodeId) && (
                          <Link to={staffPath.node(projectId, p.sourceNodeId, 'edit')} className="text-xs text-primary hover:underline">{stageName(p.sourceNodeId)}</Link>
                        )}
                      </div>
                    </td>
                    <td className="p-2">
                      <select aria-label={`${t('selection.participants.col.status')}: ${name}`} value={p.status} disabled={busy} onChange={(e) => setPStatus(p, e.target.value)} className={selectCls}>
                        {PARTICIPANT_STATUSES.map((s) => <option key={s} value={s}>{t(`selection.participants.status.${s}`)}</option>)}
                      </select>
                      <Badge tone={STATUS_TONE[p.status]} className="ms-2 hidden sm:inline-flex">{t(`selection.participants.status.${p.status}`)}</Badge>
                    </td>
                    <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">{p.createdAt ? formatDate(p.createdAt) : '-'}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {p.virtual && <Button size="sm" variant="outline" onClick={() => run(() => m.enroll.mutateAsync({ participant: p }), { id: p.id, success: t('selection.participants.enrolled', { count: 1 }) })} disabled={busy}>{t('selection.participants.enroll')}</Button>}
                        {p.status !== 'withdrawn' ? (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => withdraw(p)} disabled={busy}>{t('selection.participants.withdraw')}</Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setPStatus(p, 'accepted')} disabled={busy}>{t('selection.participants.reinstate')}</Button>
                        )}
                        {p.companyId && (
                          <Link to={staffPath.company(p.companyId)} className="tap-target inline-flex items-center gap-1 rounded-md px-2 text-xs text-primary hover:underline" title={t('selection.participants.company')}>
                            <Building2 className="h-4 w-4" aria-hidden="true" /><ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('selection.participants.founderNote')}</p>

      {picker && (
        <EntityPicker
          kind="company"
          existingIds={existingCompanies}
          onClose={() => setPicker(false)}
          onUpload={(file) => uploadImage(file, { ownerId: projectId, kind: 'logo' })}
          onPick={(entity) => run(() => m.assign.mutateAsync({ companyId: entity.id }), { success: t('selection.participants.added') })}
          onCreate={(view) => run(() => people.createCompany.mutateAsync({ view, originProjectId: projectId, userId: user?.id }))}
        />
      )}
    </div>
  )
}
