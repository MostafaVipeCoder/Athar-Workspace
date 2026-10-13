import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, MapPin, Plus, Settings } from 'lucide-react'
import { useProgram, useProjects } from '../../data/programs.js'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Loading, ErrorState, EmptyState } from '../../ui/States.jsx'
import { Button } from '../../ui/Button.jsx'
import { Img } from '../../ui/Img.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { staffPath } from '../../lib/links.js'
import { PROGRAM_TYPES } from '../../lib/constants.js'
import CreateProjectModal from './programs/CreateProjectModal.jsx'

/** Program overview (06 section 2.2): cover, description, projects grid, create project, link to settings. */
export default function ProgramPage() {
  const { programId } = useParams()
  const { t, tn, pick } = useLanguage()
  const program = useProgram(programId)
  const projects = useProjects(programId)
  const [creating, setCreating] = useState(false)

  if (program.isPending || projects.isPending) return <Loading />
  if (program.error || projects.error) return <ErrorState error={program.error ?? projects.error} onRetry={() => { program.refetch(); projects.refetch() }} />
  const g = program.data
  if (!g) return <EmptyState title={t('notfound.title')} body={t('notfound.body')} />
  const description = pick(g, 'description')

  return (
    <div className="space-y-5" data-testid="program-page">
      <div className="panel overflow-hidden">
        {g.cover_path && <Img src={publicImageUrl(g.cover_path)} thumb={publicThumbUrl(g.cover_path)} alt="" aspect="21 / 9" eager />}
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-panel-pad">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <Link to={staffPath.programs()} className="hover:underline">{t('nav.programs')}</Link>
              {g.year ? ` · ${g.year}` : ''}
              {g.program_type ? ` · ${PROGRAM_TYPES.includes(g.program_type) ? t(`programs.type.${g.program_type}`) : g.program_type}` : ''}
            </p>
            <h1 className="text-section-title">{pick(g, 'name')}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{tn('programs.projects', projects.data.length)}</span>
              {g.is_completed && (
                <Badge tone="green">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  {t('programs.completed')}
                </Badge>
              )}
              {g.archived_at && <Badge tone="neutral">{t('programs.archived')}</Badge>}
            </p>
            {description && <p className="mt-2 max-w-prose whitespace-pre-line text-sm">{description}</p>}
          </div>
          <div className="flex gap-2">
            <Link to={staffPath.programSettings(g.id)} className="tap-target inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-300 hover:border-foreground hover:bg-surface">
              <Settings className="h-4 w-4" aria-hidden="true" />
              {t('programs.settings')}
            </Link>
            <Button onClick={() => setCreating(true)} data-testid="create-project">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('projects.create')}
            </Button>
          </div>
        </div>
      </div>

      {projects.data.length === 0 ? (
        <EmptyState title={t('programs.noProjects')} body={t('projects.emptyBody')} action={<Button variant="outline" onClick={() => setCreating(true)}>{t('projects.create')}</Button>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="projects-list">
          {projects.data.map((j) => (
            <li key={j.id} className="panel group overflow-hidden transition-colors duration-300 hover:border-foreground/30">
              <Link to={staffPath.project(j.id)} className="block">
                <Img src={publicThumbUrl(j.cover_path)} variant="thumb" alt="" aspect="16 / 9" />
              </Link>
              <div className="space-y-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={staffPath.project(j.id)} className="font-bold transition-colors duration-300 hover:text-primary">{pick(j, 'name')}</Link>
                  <Badge tone={j.completed_at ? 'green' : 'amber'}>{j.completed_at ? t('programs.completed') : t('programs.active')}</Badge>
                </div>
                <p className="text-xs text-muted-foreground" dir="ltr">{j.timezone}</p>
                {pick(j, 'location') && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" aria-hidden="true" />
                    {pick(j, 'location')}
                  </p>
                )}
                <div className="flex gap-3 pt-1 text-xs">
                  <Link to={staffPath.project(j.id)} className="hover:underline">{t('project.canvas')}</Link>
                  <Link to={staffPath.projectDetails(j.id)} className="hover:underline">{t('project.details')}</Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateProjectModal open onClose={() => setCreating(false)} programId={g.id} />}
    </div>
  )
}
