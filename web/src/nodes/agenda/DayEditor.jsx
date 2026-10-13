import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { cn } from '../../lib/cn.js'
import { to12h } from '../../lib/time/slots.js'
import { formatCalendarDate } from '../../lib/time/format.js'
import { duplicateSlot, emptySlot, moveItem, shiftSlots, sortSlots } from './agendaLogic.js'

const pickBi = (v, lang) => (lang === 'ar' ? v?.ar || v?.en : v?.en || v?.ar) || ''
const iconBtn = 'h-9 min-h-9 w-9 min-w-9'

/**
 * One day of the editor draft: date + bilingual name, the slot rows (compact line, expandable inline editor), reorder by
 * HTML5 drag or arrows within the day, duplicate, +/-1 h shift, sort by time, add/remove. All edits go to the parent's
 * draft (`onChange(nextDay)`); nothing is written until the frame's Save (no staged-save bypass, docs/03 section 7 #7).
 */
export default function DayEditor({ day, index, count, errors, onChange, onRemove, onDuplicate, onMove, dragHandleProps, dragging }) {
  const { t, lang } = useLanguage()
  const [expanded, setExpanded] = useState(null)
  const [dragSlot, setDragSlot] = useState(null)
  const label = pickBi(day.name, lang) || (day.date ? formatCalendarDate(day.date, { lang }) : t('agenda.edit.day', { n: index + 1 }))
  const patch = (p) => onChange({ ...day, ...p })
  const patchSlots = (fn) => patch({ slots: fn(day.slots) })
  const updateSlot = (next) => patchSlots((slots) => slots.map((s) => (s.id === next.id ? next : s)))
  const addSlot = () => {
    const last = day.slots[day.slots.length - 1]
    const s = emptySlot(last?.end ? { start: last.end } : {})
    patchSlots((slots) => [...slots, s])
    setExpanded(s.id)
  }
  const onDropSlot = (targetId) => {
    if (!dragSlot || dragSlot === targetId) return
    patchSlots((slots) => {
      const from = slots.findIndex((s) => s.id === dragSlot)
      const to = targetId ? slots.findIndex((s) => s.id === targetId) : slots.length - 1
      return moveItem(slots, from, to)
    })
    setDragSlot(null)
  }
  const dayError = errors[day.id]

  return (
    <section className={cn('panel', dayError && 'border-destructive', dragging && 'opacity-50')} data-testid="day-card" aria-label={label}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <button type="button" className="tap-target inline-flex cursor-grab items-center justify-center text-muted-foreground" aria-label={t('agenda.edit.dragHint')} {...dragHandleProps}>
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <h3 className="min-w-0 flex-1 truncate font-semibold">{t('agenda.edit.day', { n: index + 1 })}{pickBi(day.name, lang) ? ` · ${pickBi(day.name, lang)}` : ''}</h3>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => patchSlots((s) => shiftSlots(s, -60))} disabled={!day.slots.length} title={t('agenda.edit.shiftHint')} aria-label={`${t('agenda.edit.shiftHint')}: ${t('agenda.edit.shiftEarlier')}`}>{t('agenda.edit.shiftEarlier')}</Button>
          <Button size="sm" variant="ghost" onClick={() => patchSlots((s) => shiftSlots(s, 60))} disabled={!day.slots.length} title={t('agenda.edit.shiftHint')} aria-label={`${t('agenda.edit.shiftHint')}: ${t('agenda.edit.shiftLater')}`}>{t('agenda.edit.shiftLater')}</Button>
          <Button size="sm" variant="ghost" onClick={() => patchSlots(sortSlots)} disabled={day.slots.length < 2}>{t('agenda.edit.sortByTime')}</Button>
          <Button size="icon" variant="ghost" className={iconBtn} aria-label={t('agenda.edit.moveUp')} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
          <Button size="icon" variant="ghost" className={iconBtn} aria-label={t('agenda.edit.moveDown')} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
          <Button size="icon" variant="ghost" className={iconBtn} aria-label={`${t('agenda.edit.duplicate')}: ${label}`} onClick={onDuplicate}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
          <Button size="icon" variant="ghost" className={cn(iconBtn, 'text-destructive')} aria-label={`${t('agenda.edit.remove')}: ${label}`} onClick={onRemove} data-testid="remove-day"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </header>

      <div className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <Field label={t('agenda.edit.dayDate')} type="date" dir="ltr" value={day.date} onChange={(e) => patch({ date: e.target.value })} error={dayError && dayError !== 'agenda.err.dayEmpty' ? t(dayError) : undefined} data-testid="day-date" />
          <BilingualField label={t('agenda.edit.dayName')} value={day.name} onChange={(name) => patch({ name })} error={dayError === 'agenda.err.dayEmpty' ? t(dayError) : undefined} />
        </div>

        {day.slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('agenda.edit.noSlots')}</p>
        ) : (
          <ol className="space-y-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDropSlot(null) }}>
            {day.slots.map((s, i) => {
              const err = errors[s.id]
              const open = expanded === s.id
              const title = pickBi(s.title, lang) || t('agenda.edit.untitledSlot')
              return (
                <li
                  key={s.id}
                  className={cn('rounded-md border bg-card', err && 'border-destructive', dragSlot === s.id && 'opacity-50')}
                  data-testid="slot-row"
                  draggable
                  onDragStart={() => setDragSlot(s.id)}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropSlot(s.id) }}
                >
                  <div className="flex flex-wrap items-center gap-2 p-2">
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
                    <span className="w-28 shrink-0 text-xs font-semibold text-primary" dir="ltr">{s.start && s.end ? `${to12h(s.start, lang)} - ${to12h(s.end, lang)}` : '--:--'}</span>
                    <button type="button" onClick={() => setExpanded(open ? null : s.id)} className="min-w-0 flex-1 truncate text-start text-sm font-medium" dir="auto" aria-expanded={open}>
                      {title}
                      {s.showPresenter && pickBi(s.presenter, lang) && <span className="ms-2 text-xs font-normal text-muted-foreground">{pickBi(s.presenter, lang)}</span>}
                    </button>
                    {err && <span className="text-xs text-destructive-text">{t(err)}</span>}
                    <div className="flex items-center gap-0.5">
                      <Button size="icon" variant="ghost" className={iconBtn} aria-label={t('agenda.edit.moveUp')} disabled={i === 0} onClick={() => patchSlots((slots) => moveItem(slots, i, i - 1))}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="icon" variant="ghost" className={iconBtn} aria-label={t('agenda.edit.moveDown')} disabled={i === day.slots.length - 1} onClick={() => patchSlots((slots) => moveItem(slots, i, i + 1))}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="icon" variant="ghost" className={iconBtn} aria-label={`${t('agenda.edit.duplicate')}: ${title}`} onClick={() => patchSlots((slots) => duplicateSlot(slots, s.id))}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="icon" variant="ghost" className={cn(iconBtn, 'text-destructive')} aria-label={`${t('agenda.edit.remove')}: ${title}`} onClick={() => onRemoveSlot(s, title)} data-testid="remove-slot"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button size="icon" variant="ghost" className={iconBtn} aria-label={open ? t('agenda.edit.collapse') : t('agenda.edit.expand')} onClick={() => setExpanded(open ? null : s.id)}>{open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}</Button>
                    </div>
                  </div>
                  {open && <SlotEditor slot={s} onChange={updateSlot} />}
                </li>
              )
            })}
          </ol>
        )}
        <Button size="sm" variant="outline" onClick={addSlot} data-testid="add-slot"><Plus className="h-4 w-4" aria-hidden="true" />{t('agenda.edit.addSlot')}</Button>
      </div>
    </section>
  )

  function onRemoveSlot(s, title) {
    onChange({ ...day, slots: day.slots.filter((x) => x.id !== s.id) }, { removedSlot: s, index: day.slots.findIndex((x) => x.id === s.id), label: title })
  }
}

/** The fields of one session: times (HH:MM, native time inputs in the project zone), bilingual title/presenter, show presenter, bullets (one line per point, per language). */
export function SlotEditor({ slot, onChange }) {
  const { t } = useLanguage()
  const patch = (p) => onChange({ ...slot, ...p })
  const bulletsText = (k) => slot.bullets.map((b) => b[k]).join('\n')
  const setBullets = (k, text) => {
    const lines = text.split('\n')
    const other = k === 'en' ? 'ar' : 'en'
    const n = Math.max(lines.length, slot.bullets.length)
    const next = Array.from({ length: n }, (_, i) => ({ [k]: lines[i] ?? '', [other]: slot.bullets[i]?.[other] ?? '' }))
    // trailing empty pairs are dropped on save (toChildren); keep them while typing so the cursor stays put
    patch({ bullets: next })
  }
  return (
    <div className="space-y-3 border-t border-border bg-surface/50 p-3" data-testid="slot-editor">
      <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
        <Field label={t('agenda.edit.start')} type="time" dir="ltr" step="300" value={slot.start} onChange={(e) => patch({ start: e.target.value })} required data-testid="slot-start" />
        <Field label={t('agenda.edit.end')} type="time" dir="ltr" step="300" value={slot.end} onChange={(e) => patch({ end: e.target.value })} required data-testid="slot-end" />
      </div>
      <BilingualField label={t('agenda.edit.title')} value={slot.title} onChange={(title) => patch({ title })} required />
      <BilingualField label={t('agenda.edit.presenter')} value={slot.presenter} onChange={(presenter) => patch({ presenter })} />
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input type="checkbox" checked={slot.showPresenter} onChange={(e) => patch({ showPresenter: e.target.checked })} />
        {t('agenda.edit.showPresenter')}
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t('agenda.edit.bullets')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="English" as="textarea" rows={3} dir="ltr" lang="en" value={bulletsText('en')} onChange={(e) => setBullets('en', e.target.value)} />
          <Field label="العربية" as="textarea" rows={3} dir="rtl" lang="ar" value={bulletsText('ar')} onChange={(e) => setBullets('ar', e.target.value)} />
        </div>
      </fieldset>
    </div>
  )
}
