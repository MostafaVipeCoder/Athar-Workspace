import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, UserPlus } from 'lucide-react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { Img } from '../../ui/Img.jsx'
import { Loading, ErrorState, EmptyState } from '../../ui/States.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { findSimilarExperts, useCompanies, useNetworkExperts } from '../../data/people.js'
import { publicThumbUrl } from '../../data/storage.js'
import { biPick, emptyEntity, validateEntityView } from '../../lib/entities.js'
import { EntityForm } from './EntityForm.jsx'

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/**
 * "Add from the Athar Network" / "Add an existing company" (design 02 section 3.7): search the registry, add by
 * REFERENCE (duplicate guard: ids already in the list are disabled), or create a new registry record and add it.
 * Props: kind 'expert'|'company'; existingIds Set; onPick(entity) async; onCreate(view) async -> entity; onUpload(file).
 * Mount it only while open (`{open && <EntityPicker .../>}`): its search/draft state lives as long as the dialog.
 */
export function EntityPicker({ open = true, onClose, kind, existingIds, onPick, onCreate, onUpload }) {
  const { t, lang } = useLanguage()
  const [term, setTerm] = useState('')
  const [team, setTeam] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState(() => emptyEntity(kind))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(null) // id being added
  const [added, setAdded] = useState(() => new Set())
  const [dups, setDups] = useState(null) // experts: the registry records that look like the draft (asked before a new profile is created)
  const [createError, setCreateError] = useState(null) // the look-alike check (or the creation) failed: said out loud, never a click that does nothing
  const dupsBox = useRef(null)
  const q = useDebounced(term)
  const experts = useNetworkExperts({ term: q, kind: team ? 'team' : 'expert' }, { enabled: open && kind === 'expert' })
  const companies = useCompanies({ term: q }, { enabled: open && kind === 'company' })
  const query = kind === 'expert' ? experts : companies
  const rows = useMemo(() => query.data ?? [], [query.data])

  async function pick(entity) {
    setBusy(entity.id)
    try {
      await onPick(entity)
      setAdded((s) => new Set(s).add(entity.id))
    } finally {
      setBusy(null)
    }
  }

  // the look-alike panel is below the form: bring it into view when it shows up
  useEffect(() => {
    if (dups) dupsBox.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [dups])

  async function create(force = false) {
    const errs = validateEntityView(draft)
    setErrors(errs)
    setCreateError(null)
    if (Object.keys(errs).length) return
    setBusy('create')
    try {
      // an expert is a record of the shared registry: look for the same person first (same name in either script, e-mail, LinkedIn) so the registry gets no duplicate
      if (kind === 'expert' && !force) {
        const found = await findSimilarExperts({
          nameEn: draft.title?.en?.trim() || null, nameAr: draft.title?.ar?.trim() || null, email: draft.email?.trim() || null,
          linkedin: draft.links?.find((l) => l.kind === 'linkedin')?.url || null,
        })
        if (found.length > 0) {
          setDups(found)
          return
        }
      }
      const entity = await onCreate({ ...draft, kind }, { force: true })
      if (entity) await pick(entity)
      setCreating(false)
      setDups(null)
      setDraft(emptyEntity(kind))
    } catch (e) {
      setCreateError(t(e?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t(`entity.picker.title.${kind}`)} description={t(`entity.picker.hint.${kind}`)} closeLabel={t('common.close')} className="sm:max-w-2xl">
      {creating ? (
        <div className="space-y-4">
          <EntityForm value={draft} onChange={(v) => { setDraft(v); setDups(null) }} kind={kind} onUpload={onUpload} errors={errors} />
          {dups && (
            <section ref={dupsBox} role="alert" className="space-y-2 rounded-card border border-accent bg-accent/20 p-3" data-testid="picker-dups">
              <p className="font-semibold">{t('entity.picker.dup.title')}</p>
              <p className="text-sm text-muted-foreground">{t('entity.picker.dup.body')}</p>
              <ul className="space-y-2">
                {dups.slice(0, 3).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-md border bg-background p-2">
                    <Img src={publicThumbUrl(c.photoPath)} variant="thumb" alt="" aspect="1 / 1" className="h-10 w-10 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" dir="auto">{biPick(c.name, lang) || '-'}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">{[biPick(c.title, lang), biPick(c.company, lang)].filter(Boolean).join(' · ')}</p>
                    </div>
                    <Button size="sm" variant="outline" loading={busy === c.id} onClick={async () => { await pick(c); setCreating(false); setDups(null) }} data-testid="picker-dup-add">{t('entity.picker.dup.add')}</Button>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" onClick={() => create(true)} loading={busy === 'create'} data-testid="picker-dup-anyway">{t('entity.picker.dup.createAnyway')}</Button>
            </section>
          )}
          {createError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive-text" data-testid="picker-create-error">{createError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => { setCreating(false); setDups(null); setCreateError(null) }}>{t('common.back')}</Button>
            <Button onClick={() => create()} loading={busy === 'create'} data-testid="picker-create">{t('entity.picker.create')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <SearchBar value={term} onChange={setTerm} placeholder={t(`entity.picker.search.${kind}`)} />
          {kind === 'expert' && (
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} className="h-4 w-4" />
              {t('entity.picker.team')}
            </label>
          )}
          {query.isPending ? (
            <Loading />
          ) : query.error ? (
            <ErrorState error={query.error} onRetry={query.refetch} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('entity.picker.empty')} />
          ) : (
            <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-md border" data-testid="picker-results">
              {rows.map((e) => {
                const inList = existingIds?.has(e.id) || added.has(e.id)
                return (
                  <li key={e.id} className="flex items-center gap-3 p-2">
                    <Img src={publicThumbUrl(e.imagePath)} variant="thumb" alt="" aspect="1 / 1" className="h-10 w-10 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{biPick(e.title, lang) || '-'}</p>
                      <p className="truncate text-xs text-muted-foreground">{[biPick(e.subtitle, lang), biPick(e.organization, lang)].filter(Boolean).join(' · ')}</p>
                    </div>
                    {inList ? (
                      <Badge tone="green"><Check className="h-3 w-3" aria-hidden="true" />{added.has(e.id) ? t('entity.picker.added') : t('entity.picker.alreadyIn')}</Badge>
                    ) : (
                      <Button size="sm" variant="outline" loading={busy === e.id} onClick={() => pick(e)} aria-label={`${t('entity.picker.add')}: ${biPick(e.title, lang)}`}>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        {t('entity.picker.add')}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {onCreate && (
            <Button variant="secondary" className="w-full" onClick={() => setCreating(true)} data-testid="picker-new">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t(`entity.picker.createNew.${kind}`)}
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
export default EntityPicker
