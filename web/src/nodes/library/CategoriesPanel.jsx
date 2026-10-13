import { ArrowDown, ArrowUp, FolderPlus, Trash2 } from 'lucide-react'
import './i18n.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { categoryName } from './libraryLogic.js'

/**
 * The sections of the library (ar/en names, ordered). Draft only: the parent keeps the list and saves it with the resources.
 * A category with resources can be removed (they become uncategorised); the parent asks for a confirmation first.
 */
export default function CategoriesPanel({ categories, counts, errors, onChange, onAdd, onRemove, onMove }) {
  const { t, tn, lang } = useLanguage()
  return (
    <section className="space-y-3" data-testid="categories-panel" aria-labelledby="library-categories-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="library-categories-title" className="text-sm font-semibold">{t('library.edit.categories')}</h3>
          <p className="text-xs text-muted-foreground">{t('library.edit.categoriesHint')}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onAdd} data-testid="add-category"><FolderPlus className="h-4 w-4" aria-hidden="true" />{t('library.edit.addCategory')}</Button>
      </div>
      {categories.length > 0 && (
        <ul className="space-y-2">
          {categories.map((c, i) => {
            const label = categoryName(c, lang) || t('library.edit.untitledCategory')
            const err = errors?.[`cat:${c.id}`]
            return (
              <li key={c.id} className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-card p-3" data-testid="category-row">
                <Field className="min-w-0 flex-1 basis-40" label={t('library.edit.categoryEn')} dir="ltr" lang="en" value={c.name.en} error={err ? t('library.err.categoryName') : undefined} onChange={(e) => onChange({ ...c, name: { ...c.name, en: e.target.value } })} />
                <Field className="min-w-0 flex-1 basis-40" label={t('library.edit.categoryAr')} dir="rtl" lang="ar" value={c.name.ar} onChange={(e) => onChange({ ...c, name: { ...c.name, ar: e.target.value } })} />
                <span className="pb-3 text-xs text-muted-foreground">{tn('library.edit.categoryCount', counts[c.id] ?? 0)}</span>
                <div className="flex items-center gap-1 pb-0.5">
                  <Button size="icon" variant="ghost" aria-label={`${t('library.edit.moveUp')}: ${label}`} disabled={i === 0} onClick={() => onMove(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`${t('library.edit.moveDown')}: ${label}`} disabled={i === categories.length - 1} onClick={() => onMove(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="icon" variant="ghost" className="text-destructive" aria-label={`${t('library.edit.remove')}: ${label}`} onClick={() => onRemove(c)} data-testid="remove-category"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
