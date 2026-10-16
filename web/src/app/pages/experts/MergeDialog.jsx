import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeftRight, Check } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { Modal } from '../../../ui/Modal.jsx'
import { Button } from '../../../ui/Button.jsx'
import { SearchBar } from '../../../ui/SearchBar.jsx'
import { ErrorState, Loading, SkeletonList } from '../../../ui/States.jsx'
import { Img } from '../../../ui/Img.jsx'
import { previewMerge, useExpertActions, useExpertProfile, useExpertRegistry, useSimilarExperts } from '../../../data/people.js'
import { publicThumbUrl } from '../../../data/storage.js'
import { displayName, MERGE_BLOCKERS, mergeChoicePayload, mergeRows, rawFields } from '../../../lib/experts.js'
import { keys } from '../../../data/queryKeys.js'
import { cn } from '../../../lib/cn.js'
import './experts.i18n.js'
import { ExpertLine, ParticipationFigures, ReasonChips } from './parts.jsx'
import { errorText, useDebouncedValue } from './hooks.js'

const FIELD_LABEL = {
  name_en: 'experts.merge.field.name_en', name_ar: 'experts.merge.field.name_ar', title_en: 'experts.merge.field.title_en', title_ar: 'experts.merge.field.title_ar',
  company_en: 'experts.merge.field.company_en', company_ar: 'experts.merge.field.company_ar', bio_en: 'experts.merge.field.bio_en', bio_ar: 'experts.merge.field.bio_ar',
  photo_path: 'experts.field.photo', linkedin_url: 'experts.field.linkedin', website_url: 'experts.field.website', email: 'experts.field.email', phone: 'experts.field.phone',
}

/**
 * MERGE two records of the same person (super_admin). One canonical record is kept and every reference of the other (every list item, booking provider, mentoring session,
 * tag ...) is repointed to it in ONE server transaction, so the expert still shows in every program he took part in; the duplicate is archived with its full data (the audit
 * keeps both before-images). The dialog: (1) pick the other record (suggestions first) unless the pair is given, (2) compare side by side and choose the value of every field
 * that differs, (3) read the DRY-RUN impact and any blocker, (4) confirm. Nothing is written until step 4.
 * Props: `initialKeep` = a normalised profile (opened from a profile) | `pair` = { a, b } sides of the duplicate finder; `onDone(id)` after a merge.
 */
export default function MergeDialog({ onClose, base, initialKeep = null, pair = null, onDone }) {
  const { t, lang, formatNumber } = useLanguage()
  const toast = useToast()
  const navigate = useNavigate()
  const actions = useExpertActions()
  const [keepId, setKeepId] = useState(pair?.a?.id ?? initialKeep?.id ?? null)
  const [dropId, setDropId] = useState(pair?.b?.id ?? null)
  const [choices, setChoices] = useState({})
  const [understood, setUnderstood] = useState(false)
  const [error, setError] = useState(null)
  const keepQ = useExpertProfile(keepId)
  const dropQ = useExpertProfile(dropId)
  const keep = keepQ.data
  const drop = dropQ.data
  const rows = useMemo(() => (keep && drop ? mergeRows(rawFields(keep), rawFields(drop), choices) : []), [keep, drop, choices])
  const fieldPayload = useMemo(() => mergeChoicePayload(rows, choices), [rows, choices])
  const preview = useQuery({
    queryKey: [...keys.expertMerges(`${keepId}:${dropId}`), 'preview', fieldPayload],
    queryFn: () => previewMerge(keepId, dropId, fieldPayload),
    enabled: Boolean(keep && drop),
    staleTime: 0,
    gcTime: 0,
  })

  const swap = () => {
    setKeepId(dropId)
    setDropId(keepId)
    setChoices({})
    setUnderstood(false)
  }
  async function run() {
    setError(null)
    try {
      await actions.merge.mutateAsync({ keepId, dropId, fields: fieldPayload })
      toast.success(t('experts.merge.done', { name: displayName(keep, lang) }))
      onDone?.(keepId)
      onClose()
      navigate(`${base}/${keepId}`)
    } catch (e) {
      setError(errorText(t, e))
    }
  }

  const blockers = preview.data?.blockers ?? []
  const impact = preview.data?.impact
  const ready = Boolean(keep && drop)
  return (
    <Modal
      open
      onClose={onClose}
      title={t('experts.merge.title')}
      description={ready ? t('experts.merge.hint.compare') : t('experts.merge.hint.pick')}
      closeLabel={t('common.close')}
      className="sm:max-w-4xl"
      dismissible={!actions.merge.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={actions.merge.isPending}>{t('common.cancel')}</Button>
          {ready && (
            <Button onClick={run} loading={actions.merge.isPending} disabled={!understood || preview.isPending || preview.isError || blockers.length > 0} data-testid="merge-run">
              {t('experts.merge.run', { keep: displayName(keep, lang), drop: displayName(drop, lang) })}
            </Button>
          )}
        </>
      }
    >
      {!keepId || !dropId ? (
        <Picker keepProfile={keep} keepQ={keepQ} onPick={(id) => setDropId(id)} base={base} />
      ) : keepQ.isPending || dropQ.isPending ? (
        <Loading />
      ) : keepQ.isError || dropQ.isError ? (
        <ErrorState error={keepQ.error ?? dropQ.error} onRetry={() => { keepQ.refetch(); dropQ.refetch() }} />
      ) : (
        <div className="space-y-5" data-testid="merge-compare">
          {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive-text">{error}</p>}

          <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Side title={t('experts.merge.keep')} tone="keep" p={keep} />
            <div className="flex items-center justify-center">
              <Button variant="outline" size="sm" onClick={swap} data-testid="merge-swap" aria-label={t('experts.merge.swap')} title={t('experts.merge.swap')}>
                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                <span className="hidden md:inline">{t('experts.merge.swap')}</span>
              </Button>
            </div>
            <Side title={t('experts.merge.drop')} tone="drop" p={drop} />
          </div>

          <section aria-labelledby="merge-fields-title" className="space-y-2">
            <h3 id="merge-fields-title" className="text-base font-bold">{t('experts.merge.fields')}</h3>
            <p className="text-sm text-muted-foreground">{t('experts.merge.fields.hint')}</p>
            <div className="overflow-hidden rounded-card border">
              <table className="w-full table-fixed text-sm">
                <caption className="sr-only">{t('experts.merge.fields')}</caption>
                <thead className="bg-surface/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-1/5 px-3 py-2 text-start">{t('experts.merge.col.field')}</th>
                    <th scope="col" className="w-2/5 px-3 py-2 text-start">{t('experts.merge.keep')}</th>
                    <th scope="col" className="w-2/5 px-3 py-2 text-start">{t('experts.merge.drop')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.field} className="border-t align-top" data-testid={`merge-row-${r.field}`}>
                      <th scope="row" className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground">{t(FIELD_LABEL[r.field])}</th>
                      <td className="px-3 py-2"><ChoiceCell row={r} side="keep" onChoose={(side) => setChoices((c) => ({ ...c, [r.field]: side }))} /></td>
                      <td className="px-3 py-2"><ChoiceCell row={r} side="drop" onChoose={(side) => setChoices((c) => ({ ...c, [r.field]: side }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{t('experts.merge.fields.also')}</p>
          </section>

          <section aria-labelledby="merge-impact-title" className="space-y-2 rounded-card border bg-surface/40 p-4" data-testid="merge-impact">
            <h3 id="merge-impact-title" className="text-base font-bold">{t('experts.merge.impact.title')}</h3>
            {preview.isPending ? (
              <SkeletonList count={2} itemClassName="h-5 w-3/4" />
            ) : preview.isError ? (
              <ErrorState error={preview.error} onRetry={() => preview.refetch()} className="p-4" />
            ) : (
              <>
                <ul className="list-inside list-disc space-y-1 text-sm">
                  <li>{t('experts.merge.impact.items', { moved: formatNumber(impact.items_moved ?? impact.list_items), projects: formatNumber(impact.projects) })}</li>
                  {impact.items_collapsed > 0 && <li>{t('experts.merge.impact.collapsed', { count: formatNumber(impact.items_collapsed) })}</li>}
                  {impact.booking_providers > 0 && <li>{t('experts.merge.impact.providers', { count: formatNumber(impact.booking_providers) })}</li>}
                  {(impact.booking_sessions > 0 || impact.distribution_sessions > 0) && <li>{t('experts.merge.impact.sessions', { booking: formatNumber(impact.booking_sessions), distribution: formatNumber(impact.distribution_sessions) })}</li>}
                  {impact.tags_added > 0 && <li>{t('experts.merge.impact.tags', { count: formatNumber(impact.tags_added) })}</li>}
                  {impact.tags_dropped > 0 && <li>{t('experts.merge.impact.tagsDropped', { count: formatNumber(impact.tags_dropped) })}</li>}
                  <li>{t('experts.merge.impact.archive')}</li>
                </ul>
                {blockers.length > 0 && (
                  <div role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm" data-testid="merge-blockers">
                    <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-destructive-text" aria-hidden="true" />{t('experts.merge.blocked')}</p>
                    <ul className="list-inside list-disc">{blockers.map((b) => <li key={b}>{t(MERGE_BLOCKERS.includes(b) ? `experts.merge.blocker.${b}` : 'experts.merge.blocker.other', { code: b })}</li>)}</ul>
                  </div>
                )}
              </>
            )}
          </section>

          <label className="flex min-h-11 items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="merge-understood" />
            <span>{t('experts.merge.understood')}</span>
          </label>
        </div>
      )}
    </Modal>
  )
}

/** One record of the pair: photo, name, role line, the participation figures. */
function Side({ title, tone, p }) {
  return (
    <section className={cn('min-w-0 space-y-2 rounded-card border p-3', tone === 'keep' ? 'border-primary bg-primary/5' : 'bg-card')} aria-label={title}>
      <p className={cn('text-xs font-bold uppercase tracking-wide', tone === 'keep' ? 'text-primary' : 'text-muted-foreground')}>{title}</p>
      <ExpertLine expert={p} />
      <ParticipationFigures row={{ programs: p.totals.programs, projects: p.totals.projects, sessions: p.totals.sessions, lastOn: p.totals.lastOn, took: p.totals.lists > 0 }} compact />
    </section>
  )
}

/** A value cell: with a radio when the two sides differ (the value that survives), plain text when they agree or one is empty. */
function ChoiceCell({ row, side, onChoose }) {
  const { t } = useLanguage()
  const value = side === 'keep' ? row.keep : row.drop
  const chosen = row.chosen === side
  const content = !value ? <span className="text-muted-foreground">{t('experts.merge.empty')}</span> : row.field === 'photo_path' ? (
    <Img variant="thumb" src={publicThumbUrl(value)} thumb={publicThumbUrl(value)} aspect="1 / 1" alt="" className="h-14 w-14 rounded-full" />
  ) : (
    <span className="break-words" dir="auto">{value}</span>
  )
  if (!row.differs || !row.keep || !row.drop) {
    return <div className={cn('flex min-h-9 items-start gap-2', !value && 'opacity-80')}>{chosen && value && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}{content}</div>
  }
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-start gap-2 rounded-md p-1', chosen && 'bg-primary/10')}>
      <input type="radio" name={`merge-${row.field}`} checked={chosen} onChange={() => onChoose(side)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" aria-label={`${t(FIELD_LABEL[row.field])}: ${side === 'keep' ? t('experts.merge.keep') : t('experts.merge.drop')}`} />
      <span className="min-w-0">{content}</span>
    </label>
  )
}

/** Step 1: the other record. The server's suggestions (same link / e-mail / name in any script) first, then a search over the whole registry. */
function Picker({ keepProfile, keepQ, onPick, base }) {
  const { t, lang } = useLanguage()
  const [term, setTerm] = useState('')
  const q = useDebouncedValue(term, 300)
  const suggestions = useSimilarExperts(
    { nameEn: keepProfile?.name.en || null, nameAr: keepProfile?.name.ar || null, email: keepProfile?.email || null, linkedin: keepProfile?.linkedin || null, exclude: keepProfile?.id ?? null, kind: keepProfile?.kind ?? 'expert', limit: 6 },
    { enabled: Boolean(keepProfile) },
  )
  const state = useMemo(() => ({ q, kind: keepProfile?.kind ?? '', state: 'all', sort: 'name', dir: 'asc', page: 1, size: 24, tags: [], photo: '', email: '', language: '', program: '', part: '' }), [q, keepProfile?.kind])
  const results = useExpertRegistry(state, lang, { enabled: q.trim().length >= 2 })
  if (keepQ.isPending) return <Loading />
  if (keepQ.isError) return <ErrorState error={keepQ.error} onRetry={() => keepQ.refetch()} />
  const sug = suggestions.data ?? []
  const found = (results.data?.rows ?? []).filter((r) => r.id !== keepProfile.id)
  return (
    <div className="space-y-4" data-testid="merge-picker">
      <div className="rounded-card border border-primary bg-primary/5 p-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-primary">{t('experts.merge.keep')}</p>
        <ExpertLine expert={keepProfile} to={`${base}/${keepProfile.id}`} />
      </div>
      {sug.length > 0 && (
        <section className="space-y-2" aria-labelledby="merge-suggested">
          <h3 id="merge-suggested" className="text-base font-bold">{t('experts.merge.suggested')}</h3>
          <ul className="space-y-2">
            {sug.map((m) => (
              <li key={m.id} className="space-y-1 rounded-md border p-2">
                <ExpertLine expert={m} onClick={() => onPick(m.id)} />
                <div className="ps-1"><ReasonChips reasons={m.reasons} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-2" aria-labelledby="merge-search">
        <h3 id="merge-search" className="text-base font-bold">{t('experts.merge.search')}</h3>
        <SearchBar value={term} onChange={setTerm} label={t('experts.merge.search')} placeholder={t('experts.search.placeholder')} />
        {q.trim().length >= 2 && (
          results.isPending ? <Loading /> : found.length === 0 ? <p className="text-sm text-muted-foreground">{t('experts.merge.noResults')}</p> : (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-1" data-testid="merge-results">
              {found.map((r) => <li key={r.id}><ExpertLine expert={r} onClick={() => onPick(r.id)} /></li>)}
            </ul>
          )
        )}
      </section>
    </div>
  )
}
