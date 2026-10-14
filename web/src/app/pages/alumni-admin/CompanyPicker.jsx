import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { listAlumniDirectory } from '../../../data/alumni.js'
import { adminKeys } from '../../../data/alumniAdmin.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { INPUT_CLASS, LABEL_CLASS } from '../../../ui/Field.jsx'
import { cn } from '../../../lib/cn.js'
import { useDebounced, useLabels } from './hooks.js'
import { CompanyLogo } from './ui.jsx'
import './i18n.common.js'
import './picker.i18n.js'

/**
 * Find a company by name (a combobox over the manager directory, `scope: all`, 8 results per pause in typing). `onSelect(company)` gets the directory row; the parent decides
 * what a selection means (invite, notify, merge, apply). Arrow keys move, Enter chooses, Esc closes; results are announced.
 */
export default function CompanyPicker({ onSelect, label, placeholder, excludeIds = [], scope = 'all', className, inputId }) {
  const { t, tn, pick } = useLanguage()
  const labels = useLabels()
  const fallbackId = useId()
  const id = inputId ?? fallbackId
  const listId = `${id}-list`
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef(null)
  const debounced = useDebounced(text.trim(), 250)
  const q = useQuery({
    queryKey: adminKeys.companyPick({ q: debounced, scope }),
    queryFn: () => listAlumniDirectory({ filters: { q: debounced, scope }, limit: 8, sort: 'name' }),
    enabled: open,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
  const rows = (q.data?.rows ?? []).filter((r) => !excludeIds.includes(r.id))

  // close on an outside click / focus leaving (the listbox is part of the same box)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function choose(row) {
    onSelect(row)
    setText('')
    setOpen(false)
    setActive(0)
  }
  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(rows.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter' && open && rows[active]) { e.preventDefault(); choose(rows[active]) }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
  }
  const nameOf = (r) => pick(r, 'name')
  // the list closes when focus LEAVES the box by keyboard too (Tab / Shift+Tab), not only on an outside click
  const onBlur = (e) => { if (!boxRef.current?.contains(e.relatedTarget)) setOpen(false) }

  return (
    <div ref={boxRef} className={cn('relative space-y-1.5', className)} onBlur={onBlur}>
      <label htmlFor={id} className={LABEL_CLASS}>{label ?? t('alumni.admin.picker.label')}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-athar-grey-500" aria-hidden="true" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[active] ? `${id}-opt-${rows[active].id}` : undefined}
          autoComplete="off"
          value={text}
          placeholder={placeholder ?? t('alumni.admin.picker.placeholder')}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(INPUT_CLASS, 'ps-10')}
        />
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label={label ?? t('alumni.admin.picker.label')} onMouseDown={(e) => e.preventDefault()} className="absolute inset-x-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border bg-popover p-1 shadow-dropdown">
          {q.isPending && <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">{t('common.loading')}</li>}
          {!q.isPending && rows.length === 0 && <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">{t('alumni.admin.picker.none')}</li>}
          {rows.map((r, i) => (
            <li
              key={r.id}
              id={`${id}-opt-${r.id}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); choose(r) }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-1.5', i === active && 'bg-surface')}
            >
              <CompanyLogo path={r.logo_path} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{nameOf(r)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[labels.label('sector', r.sector), labels.label('governorate', r.governorate)].filter(Boolean).join(' · ')}
                  {!r.is_alumni && <span> · {t('alumni.admin.picker.candidate')}</span>}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only" aria-live="polite">{open && !q.isPending ? tn('alumni.admin.picker.count', rows.length) : ''}</p>
    </div>
  )
}
