import { lazy, Suspense, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, ArrowRight, CalendarCheck, Camera, Copy, ExternalLink, FolderKanban, Globe, Info, Layers, Lock, Mail, Pencil, Phone, RotateCcw, Trash2 } from 'lucide-react'
import { useAuth } from '../../AuthContext.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import { Button } from '../../../ui/Button.jsx'
import { buttonClass } from '../../../ui/buttonStyles.js'
import { Badge } from '../../../ui/Badge.jsx'
import { ExpandableText } from '../../../ui/ExpandableText.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States.jsx'
import { useExpertActions, useExpertProfile } from '../../../data/people.js'
import { displayName, groupByProgram, languageName, otherName, roleKeys, roleLine, safeHref, tagName } from '../../../lib/experts.js'
import { biPick } from '../../../lib/entities.js'
import { staffPath } from '../../../lib/links.js'
import { cn } from '../../../lib/cn.js'
import './experts.i18n.js'
import { LinkedinIcon } from './icons.jsx'
import { ArchivedBadge, ExpertPhoto, KindBadge } from './parts.jsx'
import { errorText, fmtDay, useExpertsBase } from './hooks.js'

const ExpertFormModal = lazy(() => import('./ExpertFormModal.jsx'))
const PhotoDialog = lazy(() => import('./PhotoDialog.jsx'))
const MergeDialog = lazy(() => import('./MergeDialog.jsx'))

/**
 * One expert: photo, bilingual name / title / organisation / bio, contact data and staff notes (staff only), languages and expertise tags, and the PARTICIPATION HISTORY,
 * all derived live: per program and project where the person appears (list, roles mentor / provider / presenter, booking and mentoring sessions, dates), the totals and the
 * first / last participation. The totals are GLOBAL; the engagement rows follow the caller's projects (a project manager sees the projects he is a member of, the rest is a count).
 */
export default function ExpertProfilePage() {
  const { expertId } = useParams()
  const { t, lang } = useLanguage()
  const base = useExpertsBase()
  const location = useLocation()
  const q = useExpertProfile(expertId)
  const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft
  const back = `${base}${location.state?.back ?? ''}`

  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
  if (q.isError) {
    return (
      <div className="space-y-4">
        <Link to={base} className={buttonClass({ variant: 'ghost', size: 'sm', className: '-ms-3' })} data-testid="expert-back"><BackIcon className="h-4 w-4" aria-hidden="true" />{t('experts.back')}</Link>
        {q.error?.code === 'not_found' ? (
          <EmptyState titleAs="h1" icon={Info} title={t('experts.profile.notFound.title')} body={t('experts.profile.notFound.body')} />
        ) : (
          <ErrorState titleAs="h1" error={q.error} title={t('experts.profile.loadFailed')} onRetry={() => q.refetch()} />
        )}
      </div>
    )
  }
  const p = q.data
  return (
    <div className="space-y-6" data-testid="expert-profile">
      <Link to={back} className={buttonClass({ variant: 'ghost', size: 'sm', className: '-ms-3' })} data-testid="expert-back">
        <BackIcon className="h-4 w-4" aria-hidden="true" />
        {t('experts.back')}
      </Link>
      <ProfileBody key={p.id} p={p} base={base} lang={lang} />
    </div>
  )
}

function ProfileBody({ p, base, lang }) {
  const { t, formatDate } = useLanguage()
  const { can } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const actions = useExpertActions()
  const [editing, setEditing] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const name = displayName(p, lang) || '-'
  const other = otherName(p, lang)
  const role = roleLine(p, lang)
  const archived = Boolean(p.archivedAt)
  const deleted = Boolean(p.deletedAt)

  async function toggleArchive() {
    const next = !archived
    try {
      await actions.archive.mutateAsync({ id: p.id, archived: next })
      toast.success(next ? t('experts.toast.archived', { name }) : t('experts.toast.unarchived', { name }), {
        action: { label: t('experts.action.undo'), onClick: () => actions.archive.mutate({ id: p.id, archived: !next }) },
      })
    } catch (e) {
      toast.error(errorText(t, e))
    }
  }
  async function remove() {
    const ok = await confirm({ title: t('experts.delete.title', { name }), message: t('experts.delete.body'), confirmLabel: t('experts.action.delete'), destructive: true })
    if (!ok) return
    try {
      await actions.remove.mutateAsync({ id: p.id })
      toast.success(t('experts.toast.deleted', { name }))
    } catch (e) {
      toast.error(errorText(t, e))
    }
  }
  async function restore() {
    try {
      await actions.restore.mutateAsync({ id: p.id })
      toast.success(t('experts.toast.restored', { name }))
    } catch (e) {
      toast.error(errorText(t, e))
    }
  }

  const groups = groupByProgram(p.history)
  const tot = p.totals
  const linkedin = safeHref(p.linkedin)
  const website = safeHref(p.website)
  const others = p.links.map((l) => ({ href: safeHref(l.url) })).filter((l) => l.href)
  return (
    <>
      {p.mergedInto && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-card border border-accent bg-accent/20 p-4 text-sm" data-testid="expert-merged-banner">
          <Info className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{t('experts.merged.banner', { name: biPick(p.mergedInto.name, lang) })}</span>
          <Link to={`${base}/${p.mergedInto.id}`} className="font-semibold text-primary underline-offset-4 hover:underline">{t('experts.merged.open')}</Link>
        </div>
      )}
      {deleted && !p.mergedInto && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <span className="flex items-center gap-2"><Trash2 className="h-5 w-5 shrink-0 text-destructive-text" aria-hidden="true" />{t('experts.deleted.banner')}</span>
          {p.can.restore && <Button variant="outline" size="sm" onClick={restore} loading={actions.restore.isPending}>{t('experts.action.restore')}</Button>}
        </div>
      )}

      <header className="flex flex-col items-center gap-4 rounded-card border bg-card p-5 sm:flex-row sm:items-start sm:gap-5">
        <div className="flex flex-col items-center gap-2">
          <ExpertPhoto expert={p} size="lg" />
          {p.can.edit && (
            <Button variant="ghost" size="sm" onClick={() => setPhotoOpen(true)} data-testid="expert-photo-action">
              <Camera className="h-4 w-4" aria-hidden="true" />
              {p.photoPath ? t('experts.photo.change') : t('experts.photo.add')}
            </Button>
          )}
        </div>
        <div className="w-full min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-page-title break-words" dir="auto">{name}</h1>
            <KindBadge kind={p.kind} />
            {archived && <ArchivedBadge />}
          </div>
          {other && <p className="text-lg text-muted-foreground ltr:text-left rtl:text-right" dir="auto" lang={lang === 'ar' ? 'en' : 'ar'}>{other}</p>}
          {role && <p className="text-base ltr:text-left rtl:text-right" dir="auto">{role}</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            {p.can.edit && <Button onClick={() => setEditing(true)} data-testid="expert-edit"><Pencil className="h-4 w-4" aria-hidden="true" />{t('experts.action.edit')}</Button>}
            {p.can.archive && (
              <Button variant="outline" onClick={toggleArchive} loading={actions.archive.isPending} data-testid="expert-archive">
                {archived ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                {archived ? t('experts.action.unarchive') : t('experts.action.archive')}
              </Button>
            )}
            {p.can.merge && <Button variant="outline" onClick={() => setMergeOpen(true)} data-testid="expert-merge"><Copy className="h-4 w-4" aria-hidden="true" />{t('experts.action.merge')}</Button>}
            {p.can.delete && <Button variant="ghost" onClick={remove} data-testid="expert-delete" className="text-destructive-text hover:bg-destructive/10"><Trash2 className="h-4 w-4" aria-hidden="true" />{t('experts.action.delete')}</Button>}
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="expert-participation-title" className="space-y-3" data-testid="expert-participation">
            <h2 id="expert-participation-title" className="text-card-title">{t('experts.participation.title')}</h2>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi icon={Layers} label={t('experts.col.programs')} value={tot.programs} />
              <Kpi icon={FolderKanban} label={t('experts.col.projects')} value={tot.projects} />
              <Kpi icon={CalendarCheck} label={t('experts.col.sessions')} value={tot.sessions} hint={tot.sessions > 0 ? t('experts.participation.split', { booking: tot.bookingSessions, distribution: tot.distributionSessions }) : null} />
              <Kpi
                icon={CalendarCheck}
                label={t('experts.participation.firstLast')}
                value={tot.firstOn ? fmtDay(formatDate, tot.firstOn) : tot.firstListedAt ? formatDate(tot.firstListedAt, { dateStyle: 'medium' }) : '-'}
                hint={tot.lastOn && tot.lastOn !== tot.firstOn ? t('experts.participation.lastShort', { date: fmtDay(formatDate, tot.lastOn) }) : null}
                small
              />
            </dl>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('experts.participation.derived')}</p>

            {groups.length === 0 && p.hidden.engagements === 0 ? (
              <EmptyState icon={Layers} title={t('experts.history.empty.title')} body={t('experts.history.empty.body')} className="p-6" />
            ) : (
              <div className="space-y-4" data-testid="expert-history">
                {groups.map((g) => (
                  <section key={g.program.id} aria-label={biPick(g.program.name, lang)} className="overflow-hidden rounded-card border bg-card">
                    <h3 className="flex flex-wrap items-baseline gap-2 border-b bg-surface/60 px-4 py-2.5 text-base font-bold">
                      <Layers className="h-4 w-4 shrink-0 self-center text-primary" aria-hidden="true" />
                      <Link to={staffPath.program(g.program.id)} className="inline-flex min-h-11 items-center hover:text-primary hover:underline lg:min-h-0" dir="auto">{biPick(g.program.name, lang) || '-'}</Link>
                      {g.program.year && <span className="text-sm font-normal text-muted-foreground tabular-nums">{g.program.year}</span>}
                    </h3>
                    <ul className="divide-y">
                      {g.engagements.map((h) => <Engagement key={h.itemId} h={h} lang={lang} />)}
                    </ul>
                  </section>
                ))}
                {p.hidden.engagements > 0 && (
                  <p className="flex items-start gap-2 rounded-card border border-dashed p-3 text-sm text-muted-foreground" data-testid="expert-hidden-note">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{t('experts.history.hidden', { engagements: p.hidden.engagements, projects: p.hidden.projects, programs: p.hidden.programs })}</span>
                  </p>
                )}
              </div>
            )}
          </section>

          {(p.bio.en || p.bio.ar) && (
            <section aria-labelledby="expert-bio-title" className="space-y-2">
              <h2 id="expert-bio-title" className="text-card-title">{t('experts.field.bio')}</h2>
              {(lang === 'ar' ? ['ar', 'en'] : ['en', 'ar']).filter((l) => p.bio[l]).map((l) => (
                <div key={l} className="rounded-card border bg-card p-4">
                  {p.bio.en && p.bio.ar && <p className="mb-1 text-xs font-semibold text-muted-foreground">{l === 'ar' ? 'العربية' : 'English'}</p>}
                  <div dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l}>
                    <ExpandableText text={p.bio[l]} lines={6} threshold={400} labels={{ more: t('experts.bio.more'), less: t('experts.bio.less') }} />
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="space-y-4" aria-label={t('experts.profile.details')}>
          <section className="space-y-3 rounded-card border bg-card p-4" aria-labelledby="expert-contact-card" data-testid="expert-contact">
            <h2 id="expert-contact-card" className="flex items-center gap-2 text-base font-bold"><Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('experts.form.contact')}</h2>
            <p className="text-xs text-muted-foreground">{t('experts.contact.staffOnly')}</p>
            <ul className="space-y-2 text-sm">
              {p.email && <ContactRow icon={Mail} href={`mailto:${p.email}`} text={p.email} />}
              {p.phone && <ContactRow icon={Phone} href={`tel:${p.phone.replace(/[^+\d]/g, '')}`} text={p.phone} />}
              {linkedin && <ContactRow icon={LinkedinIcon} href={linkedin} text={shortLink(linkedin)} external />}
              {website && <ContactRow icon={Globe} href={website} text={shortLink(website)} external />}
              {others.map((l) => <ContactRow key={l.href} icon={ExternalLink} href={l.href} text={shortLink(l.href)} external />)}
              {!p.email && !p.phone && !linkedin && !website && others.length === 0 && <li className="text-muted-foreground">{t('experts.contact.none')}</li>}
            </ul>
          </section>

          <section className="space-y-3 rounded-card border bg-card p-4" aria-labelledby="expert-expertise-card">
            <h2 id="expert-expertise-card" className="text-base font-bold">{t('experts.profile.expertise')}</h2>
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">{t('experts.field.tags')}</p>
              {p.tags.length ? (
                <ul className="flex flex-wrap gap-1.5">{p.tags.map((tg) => <li key={tg.id}><Badge tone="blue" className="text-sm">{tagName(tg, lang)}</Badge></li>)}</ul>
              ) : <p className="text-sm text-muted-foreground">{t('experts.profile.noTags')}</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">{t('experts.field.languages')}</p>
              {p.languages.length ? (
                <ul className="flex flex-wrap gap-1.5">{p.languages.map((c) => <li key={c}><Badge tone="outline" className="text-sm">{languageName(c, lang)}</Badge></li>)}</ul>
              ) : <p className="text-sm text-muted-foreground">{t('experts.profile.noLanguages')}</p>}
            </div>
          </section>

          <section className="space-y-2 rounded-card border border-dashed bg-surface/40 p-4" aria-labelledby="expert-notes-card" data-testid="expert-notes">
            <h2 id="expert-notes-card" className="flex items-center gap-2 text-base font-bold"><Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('experts.field.notes')}</h2>
            <p className="text-xs text-muted-foreground">{t('experts.field.notes.hint')}</p>
            {p.notes ? <p className="whitespace-pre-line text-sm" dir="auto">{p.notes}</p> : <p className="text-sm text-muted-foreground">{t('experts.profile.noNotes')}</p>}
          </section>

          <p className="px-1 text-xs text-muted-foreground">
            {t('experts.profile.added', { date: formatDate(p.createdAt, { dateStyle: 'medium' }) })} · {t('experts.profile.updated', { date: formatDate(p.updatedAt, { dateStyle: 'medium' }) })}
          </p>

          {p.can.merge && p.absorbed.length > 0 && (
            <section className="space-y-2 rounded-card border bg-card p-4" aria-labelledby="expert-merged-card" data-testid="expert-absorbed">
              <h2 id="expert-merged-card" className="text-base font-bold">{t('experts.merge.history')}</h2>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {p.absorbed.map((a) => <li key={a.id}>{t('experts.merge.absorbed', { name: a.name, date: formatDate(a.at, { dateStyle: 'medium' }) })}</li>)}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {(editing || photoOpen || mergeOpen) && (
        <Suspense fallback={null}>
          {editing && <ExpertFormModal expert={p} base={base} onClose={() => setEditing(false)} />}
          {photoOpen && <PhotoDialog expert={p} onClose={() => setPhotoOpen(false)} />}
          {mergeOpen && <MergeDialog initialKeep={p} base={base} onClose={() => setMergeOpen(false)} can={can('experts:merge')} />}
        </Suspense>
      )}
    </>
  )
}

/** A link as it is shown: no scheme, no www. */
const shortLink = (href) => href.replace(/^https?:\/\/(www\.)?/, '')

function Kpi({ icon: Icon, label, value, hint, small = false }) {
  const { formatNumber } = useLanguage()
  return (
    <div className="min-w-0 rounded-card border bg-card p-4">
      <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{label}</dt>
      <dd className="mt-1">
        <span className={cn('block font-display font-bold tabular-nums', small ? 'text-lg' : 'text-3xl')}>{typeof value === 'number' ? formatNumber(value) : value}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  )
}

function ContactRow({ icon: Icon, href, text, external = false }) {
  return (
    <li>
      <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="flex min-h-11 items-center gap-2 break-all text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>{text}</span>
      </a>
    </li>
  )
}

/** One engagement: project > list, the roles, the sessions and the dates. The project and the list are links (this row exists only for a project the caller manages). */
function Engagement({ h, lang }) {
  const { t, tn, formatDate } = useLanguage()
  const roles = roleKeys(h.roles)
  const when = h.firstOn
    ? h.lastOn && h.lastOn !== h.firstOn ? t('experts.history.range', { from: fmtDay(formatDate, h.firstOn), to: fmtDay(formatDate, h.lastOn) }) : fmtDay(formatDate, h.firstOn)
    : t('experts.history.listed', { date: formatDate(h.addedAt, { dateStyle: 'medium' }) })
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3" data-testid="expert-engagement">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Link to={staffPath.project(h.project.id)} className="inline-flex min-h-11 items-center hover:text-primary hover:underline lg:min-h-0" dir="auto">{biPick(h.project.name, lang) || '-'}</Link>
          {h.project.completedAt && <Badge tone="green">{t('experts.history.completed')}</Badge>}
          {h.withdrawn && <Badge tone="red">{t('experts.history.withdrawn')}</Badge>}
          {h.itemHidden && <Badge tone="outline">{t('experts.history.legacyHidden')}</Badge>}
          {!h.counted && !h.withdrawn && <Badge tone="neutral">{t('experts.history.notCounted')}</Badge>}
        </p>
        <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          {t('experts.history.list')}:
          <Link to={staffPath.node(h.project.id, h.node.id)} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline lg:min-h-0" dir="auto">{biPick(h.node.name, lang) || '-'}</Link>
        </p>
        <ul className="flex flex-wrap gap-1">{roles.map((r) => <li key={r}><Badge tone={r === 'listed' ? 'outline' : 'blue'}>{t(`experts.role.${r}`)}</Badge></li>)}</ul>
      </div>
      <div className="space-y-1 text-sm sm:text-end">
        {(h.bookingSessions > 0 || h.distributionSessions > 0) ? (
          <p>
            {h.bookingSessions > 0 && <span className="block">{tn('experts.count.bookingSessions', h.bookingSessions)}</span>}
            {h.distributionSessions > 0 && <span className="block">{tn('experts.count.distributionSessions', h.distributionSessions)}</span>}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('experts.history.noSessions')}</p>
        )}
        <p className="text-xs text-muted-foreground tabular-nums">{when}</p>
      </div>
    </li>
  )
}
