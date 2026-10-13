import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, FolderKanban, Plus, Settings } from 'lucide-react'
import { usePrograms, useProjects } from '../../data/programs.js'
import { publicThumbUrl } from '../../data/storage.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Loading, ErrorState, EmptyState } from '../../ui/States.jsx'
import { SearchBar, matchesTerm } from '../../ui/SearchBar.jsx'
import { Button } from '../../ui/Button.jsx'
import { Img } from '../../ui/Img.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { cn } from '../../lib/cn.js'
import { useAuth } from '../AuthContext.js'
import { staffPath } from '../../lib/links.js'
import CreateProgramModal from './programs/CreateProgramModal.jsx'

/** Programs with the projects the signed-in user can see. Visibility is entirely RLS: nothing is filtered client-side. */
export default function ProgramsPage() {
  const { t, tn, pick, formatDate } = useLanguage()
  const { can } = useAuth()
  const programs = usePrograms()
  const projects = useProjects()
  const [term, setTerm] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)

  const byProgram = useMemo(() => {
    const map = new Map()
    for (const p of projects.data ?? []) map.set(p.program_id, [...(map.get(p.program_id) ?? []), p])
    return map
  }, [projects.data])

  const visible = useMemo(
    () =>
      (programs.data ?? [])
        .filter((g) => showArchived || !g.archived_at)
        .filter((g) => matchesTerm(g, [(x) => pick(x, 'name'), (x) => (byProgram.get(x.id) ?? []).map((j) => pick(j, 'name')).join(' ')], term)),
    [programs.data, byProgram, term, pick, showArchived],
  )
  const archivedCount = (programs.data ?? []).filter((g) => g.archived_at).length

  if (programs.isPending || projects.isPending) return <Loading />
  const failure = programs.error ?? projects.error
  if (failure) return <ErrorState error={failure} title={t('programs.loadFailed')} onRetry={() => { programs.refetch(); projects.refetch() }} />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-section-title">{t('programs.title')}</h1>
          <p className="mt-1 text-base text-muted-foreground">{t('programs.subtitle')}</p>
        </div>
        {can('program:create') && (
          <Button onClick={() => setCreating(true)} data-testid="create-program">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('programs.create')}
          </Button>
        )}
      </div>

      {(programs.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <SearchBar value={term} onChange={setTerm} className="w-full max-w-md" />
          {archivedCount > 0 && (
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              {t('programs.showArchived', { count: archivedCount })}
            </label>
          )}
        </div>
      )}

      {(programs.data?.length ?? 0) === 0 ? (
        <EmptyState icon={FolderKanban} title={t('programs.empty')} body={can('program:create') ? t('programs.emptyCreate') : t('programs.emptyBody')} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="programs-list">
          {visible.map((g) => {
            const list = byProgram.get(g.id) ?? []
            return (
              <li key={g.id} className="panel group overflow-hidden transition-colors duration-300 hover:border-foreground/30">
                {/* the site's program card: cover + black 0.7 overlay + white bold title at the bottom start */}
                <Link to={staffPath.program(g.id)} className="relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                  {/* without a cover the card keeps the dark band (ink) instead of a "missing image" glyph */}
                  <Img src={publicThumbUrl(g.cover_path)} variant="thumb" alt="" aspect="3 / 1" overlay="card" className={cn(!g.cover_path && 'bg-athar-ink [&>div:first-child]:hidden')} imgClassName="transition-transform duration-300 group-hover:scale-105">
                    <div className="relative z-10 flex items-end justify-between gap-2 p-4">
                      <h2 className="font-sans text-xl font-bold leading-snug tracking-heading text-athar-grey-100">{pick(g, 'name')}</h2>
                      <span className="shrink-0 text-xs text-athar-grey-100/80">{g.year ?? formatDate(g.created_at, { year: 'numeric' })}</span>
                    </div>
                  </Img>
                </Link>
                <div className="flex items-center gap-2 px-4 pt-3">
                  <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{tn('programs.projects', list.length)}</span>
                    {g.is_completed && <Badge tone="green">{t('programs.completed')}</Badge>}
                    {g.archived_at && (
                      <Badge tone="neutral">
                        <Archive className="h-3 w-3" aria-hidden="true" />
                        {t('programs.archived')}
                      </Badge>
                    )}
                  </p>
                  <Link to={staffPath.programSettings(g.id)} aria-label={t('programs.settings')} className="tap-target inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-300 hover:bg-surface hover:text-primary">
                    <Settings className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                {list.length === 0 ? (
                  <p className="px-4 pb-4 pt-1 text-sm text-muted-foreground">{t('programs.noProjects')}</p>
                ) : (
                  <ul className="space-y-1 px-2 pb-3 pt-1">
                    {list.map((j) => (
                      <li key={j.id}>
                        <Link to={staffPath.project(j.id)} className="tap-target flex items-center justify-between gap-2 rounded-md px-2 text-sm transition-colors duration-300 hover:bg-surface hover:text-primary">
                          <span className="truncate">{pick(j, 'name')}</span>
                          <Badge tone={j.completed_at ? 'green' : 'amber'}>{j.completed_at ? t('programs.completed') : t('programs.active')}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {creating && <CreateProgramModal open onClose={() => setCreating(false)} />}
    </div>
  )
}
