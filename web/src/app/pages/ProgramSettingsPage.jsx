import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Archive, ArchiveRestore, CheckCheck } from 'lucide-react'
import { useProgram, useProjects, useUpdateProgram, useProjectCompletion, useCompleteAll } from '../../data/programs.js'
import { publicImageUrl, publicThumbUrl, uploadImage, removeImage } from '../../data/storage.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Loading, ErrorState, EmptyState } from '../../ui/States.jsx'
import { Button } from '../../ui/Button.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { staffPath } from '../../lib/links.js'
import ProgramForm from './programs/ProgramForm.jsx'
import { programToValues } from './forms.logic.js'

/**
 * Program Settings (06 section 2.2, 01 section 5, decision 01-11): edit the program, cover upload (immediate), list of
 * projects with per-project completion and "complete all", archive. Completion is per project; the program's completed
 * state is derived (v_programs.is_completed).
 */
export default function ProgramSettingsPage() {
  const { programId } = useParams()
  const { t, pick, formatDate } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const program = useProgram(programId)
  const projects = useProjects(programId)
  const update = useUpdateProgram(programId)
  const completion = useProjectCompletion(programId)
  const completeAll = useCompleteAll(programId)
  const [coverBusy, setCoverBusy] = useState(false)

  if (program.isPending || projects.isPending) return <Loading />
  if (program.error || projects.error) return <ErrorState error={program.error ?? projects.error} onRetry={() => { program.refetch(); projects.refetch() }} />
  const g = program.data
  if (!g) return <EmptyState title={t('notfound.title')} body={t('notfound.body')} />

  async function save(patch) {
    try {
      await update.mutateAsync(patch)
      toast.success(t('programs.saved'))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  async function onCover(file) {
    setCoverBusy(true)
    try {
      const path = await uploadImage(file, { ownerId: g.id, kind: 'cover' })
      const old = g.cover_path
      await update.mutateAsync({ cover_path: path })
      if (old) removeImage(old).catch(() => {})
      toast.success(t('programs.coverSaved'))
    } finally {
      setCoverBusy(false)
    }
  }
  async function clearCover() {
    const old = g.cover_path
    await update.mutateAsync({ cover_path: null })
    if (old) removeImage(old).catch(() => {})
  }

  async function toggleArchive() {
    const archive = !g.archived_at
    if (archive && !(await confirm({ title: t('programs.archiveTitle'), message: t('programs.archiveBody'), confirmLabel: t('programs.archive') }))) return
    await save({ archived_at: archive ? new Date().toISOString() : null })
  }

  async function toggleProject(j) {
    const completed = !j.completed_at
    const ok = await confirm({
      title: completed ? t('projects.completeTitle') : t('projects.reopenTitle'),
      message: completed ? t('projects.completeBody', { name: pick(j, 'name') }) : t('projects.reopenBody', { name: pick(j, 'name') }),
    })
    if (!ok) return
    try {
      await completion.mutateAsync({ projectId: j.id, completed })
      toast.success(completed ? t('projects.completedToast') : t('projects.reopenedToast'))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  async function onCompleteAll() {
    const open = projects.data.filter((j) => !j.completed_at).length
    if (!(await confirm({ title: t('programs.completeAllTitle'), message: t('programs.completeAllBody', { count: open }) }))) return
    try {
      const n = await completeAll.mutateAsync()
      toast.success(t('programs.completeAllDone', { count: n }))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  const openCount = projects.data.filter((j) => !j.completed_at).length

  return (
    <div className="space-y-6" data-testid="program-settings">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link to={staffPath.programs()} className="hover:underline">{t('nav.programs')}</Link>
          {' / '}
          <Link to={staffPath.program(g.id)} className="hover:underline">{pick(g, 'name')}</Link>
        </p>
        <h1 className="text-section-title">{t('programs.settings')}</h1>
      </div>

      <section className="rounded-card border bg-card p-4">
        <h2 className="mb-3 font-semibold">{t('programs.settingsGeneral')}</h2>
        <ProgramForm
          key={g.updated_at ?? g.id}
          initial={programToValues(g)}
          onSubmit={save}
          busy={update.isPending && !coverBusy}
          cover={{ src: publicImageUrl(g.cover_path), thumb: publicThumbUrl(g.cover_path), onFile: onCover, onClear: g.cover_path ? clearCover : undefined }}
        />
      </section>

      <section className="rounded-card border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t('programs.settingsProjects')}</h2>
            <p className="text-xs text-muted-foreground">{t('programs.completionHint')}</p>
          </div>
          {openCount > 0 && (
            <Button variant="outline" size="sm" onClick={onCompleteAll} loading={completeAll.isPending}>
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              {t('programs.completeAll', { count: openCount })}
            </Button>
          )}
        </div>
        {projects.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('programs.noProjects')}</p>
        ) : (
          <ul className="divide-y" data-testid="settings-projects">
            {projects.data.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link to={staffPath.project(j.id)} className="font-medium hover:underline">{pick(j, 'name')}</Link>
                  <p className="text-xs text-muted-foreground">
                    {j.completed_at ? t('projects.completedOn', { date: formatDate(j.completed_at) }) : t('programs.active')}
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={Boolean(j.completed_at)} onChange={() => toggleProject(j)} disabled={completion.isPending} />
                  {t('projects.completedFlag')}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card border border-destructive/30 bg-card p-4">
        <h2 className="font-semibold">{t('programs.settingsArchive')}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{g.archived_at ? t('programs.archivedSince', { date: formatDate(g.archived_at) }) : t('programs.archiveHint')}</p>
        <Button variant={g.archived_at ? 'outline' : 'destructive'} onClick={toggleArchive} loading={update.isPending}>
          {g.archived_at ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
          {g.archived_at ? t('programs.unarchive') : t('programs.archive')}
        </Button>
      </section>
    </div>
  )
}
