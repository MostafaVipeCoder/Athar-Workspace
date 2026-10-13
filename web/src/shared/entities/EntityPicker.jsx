import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, UserPlus } from 'lucide-react'
import './i18n.js'
import { Modal } from '../../ui/Modal.jsx'
import { Button } from '../../ui/Button.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { Img } from '../../ui/Img.jsx'
import { Loading, ErrorState, EmptyState } from '../../ui/States.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useCompanies, useNetworkExperts } from '../../data/people.js'
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

  async function create() {
    const errs = validateEntityView(draft)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy('create')
    try {
      const entity = await onCreate({ ...draft, kind })
      if (entity) await pick(entity)
      setCreating(false)
      setDraft(emptyEntity(kind))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t(`entity.picker.title.${kind}`)} description={t(`entity.picker.hint.${kind}`)} closeLabel={t('common.close')} className="sm:max-w-2xl">
      {creating ? (
        <div className="space-y-4">
          <EntityForm value={draft} onChange={setDraft} kind={kind} onUpload={onUpload} errors={errors} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>{t('common.back')}</Button>
            <Button onClick={create} loading={busy === 'create'} data-testid="picker-create">{t('entity.picker.create')}</Button>
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
