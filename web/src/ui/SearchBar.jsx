import { useId } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useLanguage } from '../i18n/LanguageProvider.jsx'
import { INPUT_CLASS } from './Field.jsx'

/** Controlled search input with a visible (or sr-only) label and a clear button. Logical spacing for RTL. */
export function SearchBar({ value, onChange, label, placeholder, className, autoFocus = false }) {
  const { t } = useLanguage()
  const id = useId()
  const text = label ?? t('common.search')
  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {text}
      </label>
      <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-athar-grey-500" aria-hidden="true" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? text}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        className={cn(INPUT_CLASS, 'ps-10 pe-10 [&::-webkit-search-cancel-button]:hidden')}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('common.clear')}
          className="absolute end-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Case-insensitive match of a term against several string fields (replaces 7 ad-hoc filters, design 06 P15). */
// eslint-disable-next-line react-refresh/only-export-components
export function matchesTerm(item, fields, term) {
  const q = String(term ?? '').trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => String(typeof f === 'function' ? f(item) : item?.[f] ?? '').toLowerCase().includes(q))
}
