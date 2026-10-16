import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { INPUT_CLASS, LABEL_CLASS } from '../../../ui/Field.jsx'
import { useExpertTags, useSimilarExperts } from '../../../data/people.js'
import { displayName, hasDuplicateSignal, LANGUAGES, languageName, LIMITS, tagName } from '../../../lib/experts.js'
import { cn } from '../../../lib/cn.js'
import './experts.i18n.js'
import { ExpertLine, ReasonChips } from './parts.jsx'
import { useDebouncedValue } from './hooks.js'

/** Languages the expert speaks: toggle chips (a code the record already has but the list does not offer stays visible and removable). */
export function LanguagePicker({ value, onChange, error }) {
  const { t, lang } = useLanguage()
  const id = useId()
  const codes = useMemo(() => [...LANGUAGES.map((l) => l.code), ...value.filter((c) => !LANGUAGES.some((l) => l.code === c))], [value])
  return (
    <fieldset className="space-y-1.5" aria-describedby={error ? `${id}-err` : undefined}>
      <legend className={LABEL_CLASS}>{t('experts.field.languages')}</legend>
      <ul className="flex flex-wrap gap-1.5">
        {codes.map((c) => {
          const on = value.includes(c)
          return (
            <li key={c}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-input hover:bg-surface',
                )}
              >
                {languageName(c, lang)}
              </button>
            </li>
          )
        })}
      </ul>
      {error && <p id={`${id}-err`} role="alert" className="text-xs text-destructive-text">{error}</p>}
    </fieldset>
  )
}

/**
 * Expertise tags: the chosen ones as removable chips, a box that filters the vocabulary (both languages), a suggestion list, and "create <typed>" for a tag that does not exist
 * yet (it is created when the expert is saved; the same name in any case / spacing is the same tag). `value` = [{ id?, name_en, name_ar }].
 */
export function TagPicker({ value, onChange, error }) {
  const { t, lang } = useLanguage()
  const id = useId()
  const tags = useExpertTags()
  const [term, setTerm] = useState('')
  const q = term.trim().toLowerCase()
  const chosenIds = new Set(value.map((v) => v.id).filter(Boolean))
  const chosenNames = new Set(value.filter((v) => !v.id).flatMap((v) => [v.name_en, v.name_ar]).filter(Boolean).map((s) => s.toLowerCase()))
  const options = (tags.data ?? [])
    .filter((tg) => !tg.archived && !chosenIds.has(tg.id))
    .filter((tg) => !q || `${tg.name.en} ${tg.name.ar}`.toLowerCase().includes(q))
    .slice(0, 8)
  const exact = (tags.data ?? []).some((tg) => [tg.name.en, tg.name.ar].some((n) => n && n.toLowerCase() === q))
  const canCreate = q.length >= 2 && !exact && !chosenNames.has(q) && value.length < LIMITS.tags
  const add = (item) => {
    onChange([...value, item])
    setTerm('')
  }
  const create = () => {
    const typed = term.trim()
    add(/[؀-ۿ]/.test(typed) ? { name_en: '', name_ar: typed } : { name_en: typed, name_ar: '' })
  }
  const label = (v) => (lang === 'ar' ? v.name_ar || v.name_en : v.name_en || v.name_ar)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>{t('experts.field.tags')}</label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('experts.field.tags.chosen')}>
          {value.map((v, i) => (
            <li key={v.id ?? `new-${i}`}>
              <Badge tone="blue" className="min-h-11 gap-1 ps-3 pe-1 text-sm lg:min-h-8">
                {label(v)}
                <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('experts.field.tags.remove', { name: label(v) })} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-7 lg:w-7">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        type="text"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (options[0] && q) add({ id: options[0].id, name_en: options[0].name.en, name_ar: options[0].name.ar })
            else if (canCreate) create()
          }
        }}
        disabled={value.length >= LIMITS.tags}
        placeholder={t('experts.field.tags.placeholder')}
        autoComplete="off"
        aria-describedby={`${id}-hint`}
        aria-invalid={error ? true : undefined}
        className={INPUT_CLASS}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">{value.length >= LIMITS.tags ? t('experts.err.tooMany') : t('experts.field.tags.hint')}</p>
      {(options.length > 0 || canCreate) && value.length < LIMITS.tags && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('experts.field.tags.suggestions')}>
          {options.map((tg) => (
            <li key={tg.id}>
              <button type="button" onClick={() => add({ id: tg.id, name_en: tg.name.en, name_ar: tg.name.ar })} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-input px-3 text-sm hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {tagName(tg, lang)}
              </button>
            </li>
          ))}
          {canCreate && (
            <li>
              <button type="button" onClick={create} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed border-primary px-3 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="tag-create">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('experts.field.tags.create', { name: term.trim() })}
              </button>
            </li>
          )}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-destructive-text">{error}</p>}
    </div>
  )
}

/**
 * "Does this person already exist?": while the form is being filled (debounced), the registry is searched for the same name in either script, the same e-mail and the same
 * LinkedIn link. A BLOCKING match (same link / e-mail / name) is shown as "probably the same person" and the create needs an explicit "Create anyway"; the weaker ones are a
 * heads-up. `confirmed` / `onConfirm` carry that explicit choice to the form. `exclude` = the record being edited.
 */
export function DuplicatePanel({ form, exclude = null, base, confirmed, onConfirm, serverMatches = null }) {
  const { t, lang } = useLanguage()
  const panel = useRef(null)
  const raw = useMemo(
    () => ({ nameEn: form.name.en.trim() || null, nameAr: form.name.ar.trim() || null, email: form.email.trim() || null, linkedin: form.linkedin.trim() || null }),
    [form.name.en, form.name.ar, form.email, form.linkedin],
  )
  const debounced = useDebouncedValue(raw, 600)
  const signal = hasDuplicateSignal({ name: { en: debounced.nameEn ?? '', ar: debounced.nameAr ?? '' }, email: debounced.email ?? '', linkedin: debounced.linkedin ?? '' })
  const q = useSimilarExperts({ ...debounced, exclude, kind: form.kind }, { enabled: signal })
  const matches = serverMatches ?? (signal ? q.data ?? [] : [])
  const shown = matches.length > 0
  // the panel appears at the top of a scrolling dialog: bring it into view when it shows up (the user may be pressing Save at the bottom)
  useEffect(() => {
    if (shown) panel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [shown, serverMatches])
  if (!shown) return null
  const blocking = matches.some((m) => m.blocking)
  return (
    <section ref={panel} role="alert" className={cn('space-y-3 rounded-card border p-4', blocking ? 'border-destructive/50 bg-destructive/5' : 'border-accent bg-accent/20')} data-testid="duplicate-panel">
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn('mt-0.5 h-5 w-5 shrink-0', blocking ? 'text-destructive-text' : 'text-foreground')} aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{blocking ? (exclude ? t('experts.dup.blocking.edit') : t('experts.dup.blocking')) : t('experts.dup.warning')}</p>
          <p className="text-sm text-muted-foreground">{blocking ? t('experts.dup.blocking.body') : t('experts.dup.warning.body')}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {matches.slice(0, 4).map((m) => (
          <li key={m.id} className="space-y-1 rounded-md border bg-background p-2">
            <ExpertLine expert={m} to={`${base}/${m.id}`} />
            <div className="flex flex-wrap items-center gap-2 ps-1">
              <ReasonChips reasons={m.reasons} />
              {m.archived && <Badge tone="amber">{t('experts.state.archived')}</Badge>}
              <Link to={`${base}/${m.id}`} target="_blank" rel="noopener noreferrer" aria-label={`${t('experts.dup.open')}: ${displayName(m, lang) || '-'}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline">{t('experts.dup.open')}</Link>
            </div>
          </li>
        ))}
      </ul>
      {blocking && !exclude && (
        <label className="flex min-h-11 items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} data-testid="duplicate-confirm" />
          <span>{t('experts.dup.confirm')}</span>
        </label>
      )}
    </section>
  )
}
