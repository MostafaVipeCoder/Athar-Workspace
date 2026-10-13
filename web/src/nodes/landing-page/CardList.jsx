import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, GripVertical, ImageOff, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { publicThumbUrl } from '../../data/storage.js'
import { cn } from '../../lib/cn.js'
import CardEditor from './CardEditor.jsx'
import { MAX_CARDS, emptyCard, moveItem, newId, pickBi } from './landingLogic.js'

/**
 * The cards of the page (N >= 0): drag (HTML5) or arrows to reorder, duplicate, remove (with Undo through the toast of the parent) and an
 * inline editor per card. Ids are uuids from the moment a card exists (a duplicate gets a new one), so a card keeps its identity across saves.
 * `onRemove(card, index)` is the parent's (Undo toast).
 */
export default function CardList({ cards, setCards, errors, linkOptions, onCover, onRemove, onAdded }) {
  const { t, lang } = useLanguage()
  const [open, setOpen] = useState(null)
  const [drag, setDrag] = useState(null)
  const update = (id, patch) => setCards((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const add = () => {
    const card = emptyCard({ ctaLabel: { en: '', ar: '' } })
    setCards((cur) => [...cur, card])
    setOpen(card.id)
    onAdded?.(card)
  }
  const duplicate = (c) => {
    const copy = { ...c, id: newId(), title: { en: c.title.en ? `${c.title.en} (copy)` : '', ar: c.title.ar ? `${c.title.ar} (نسخة)` : '' }, presets: { ...c.presets } }
    setCards((cur) => { const i = cur.findIndex((x) => x.id === c.id); return [...cur.slice(0, i + 1), copy, ...cur.slice(i + 1)] })
    setOpen(copy.id)
  }
  const dropOn = (targetId) => {
    if (!drag || drag === targetId) return
    setCards((cur) => moveItem(cur, cur.findIndex((c) => c.id === drag), cur.findIndex((c) => c.id === targetId)))
    setDrag(null)
  }

  return (
    <section className="space-y-3" data-testid="cards-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-bold">{t('landing.cards.heading')}</h3>
          <p className="text-sm text-muted-foreground">{t('landing.cards.hint')}</p>
        </div>
        <Button onClick={add} disabled={cards.length >= MAX_CARDS} data-testid="add-card"><Plus className="h-4 w-4" aria-hidden="true" />{t('landing.cards.add')}</Button>
      </div>
      {errors.cards && <p role="alert" className="text-sm text-destructive-text">{t('landing.edit.err.tooMany')}</p>}
      {cards.length === 0 ? (
        <EmptyState title={t('landing.cards.empty')} body={t('landing.cards.emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {cards.map((c, i) => {
            const expanded = open === c.id
            const label = pickBi(c.title, lang) || pickBi(c.chip, lang) || t('landing.cards.untitled')
            const hasError = Object.keys(errors).some((k) => k.startsWith(`${c.id}.`))
            return (
              <li
                key={c.id}
                className={cn('rounded-card border bg-card', drag === c.id && 'opacity-50', hasError && 'border-destructive')}
                onDragOver={(e) => { if (drag) e.preventDefault() }}
                onDrop={(e) => { e.preventDefault(); dropOn(c.id) }}
                data-testid="card-row"
                data-card-id={c.id}
              >
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <span draggable onDragStart={(e) => { setDrag(c.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDrag(null)} className="tap-target inline-flex cursor-grab items-center text-muted-foreground active:cursor-grabbing" title={t('landing.edit.dragHint')} aria-hidden="true">
                    <GripVertical className="h-5 w-5" />
                  </span>
                  <span className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface">
                    {c.cover ? <img src={publicThumbUrl(c.cover)} alt="" className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                  </span>
                  <button type="button" onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded} className="min-h-11 min-w-0 flex-1 text-start" data-testid="card-toggle">
                    <span className="block truncate font-semibold" dir="auto">{label}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1.5">
                      {pickBi(c.chip, lang) && <Badge tone="blue">{pickBi(c.chip, lang)}</Badge>}
                      {c.shareEnabled && <Badge tone="neutral">{t('landing.cards.badgeShare')}</Badge>}
                      {(c.ctaNodeId || c.ctaUrl) && <Badge tone="neutral">{t('landing.cards.badgeLink')}</Badge>}
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-0.5">
                    <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => setCards((cur) => moveItem(cur, i, i - 1))} aria-label={t('landing.edit.moveUp')}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" disabled={i === cards.length - 1} onClick={() => setCards((cur) => moveItem(cur, i, i + 1))} aria-label={t('landing.edit.moveDown')}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => duplicate(c)} aria-label={t('landing.edit.duplicate')} disabled={cards.length >= MAX_CARDS}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => onRemove(c, i)} aria-label={t('landing.edit.remove')} data-testid="remove-card"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setOpen(expanded ? null : c.id)} aria-label={t(expanded ? 'landing.edit.collapse' : 'landing.edit.expand')}>
                      {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    </Button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t p-4 sm:p-5">
                    <CardEditor card={c} onChange={(patch) => update(c.id, patch)} errors={errors} linkOptions={linkOptions} onCover={onCover} onClearCover={() => update(c.id, { cover: '' })} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
