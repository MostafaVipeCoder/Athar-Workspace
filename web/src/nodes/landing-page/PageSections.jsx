import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button.jsx'
import { Field, SELECT_CLASS, LABEL_CLASS } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { ImageField } from '../../ui/ImageField.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { NAV_SECTIONS, defaultNavLinks, moveItem, newId } from './landingLogic.js'

const Section = ({ title, hint, children, testId }) => (
  <section className="space-y-4 rounded-card border p-4 sm:p-5" data-testid={testId}>
    <div>
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
    </div>
    {children}
  </section>
)

/**
 * The page-level sections of the builder (landing-page.html: nav, hero, the cards section intro): bilingual texts, the hero background
 * image (uploaded immediately) and the sticky navigation (anchors to the sections or any web address). `patch(section, partial)` merges
 * into the config draft; every text is optional (an empty section is simply not rendered).
 */
export default function PageSections({ config, patch, errors, onHeroCover, onClearHeroCover }) {
  const { t } = useLanguage()
  const links = config.nav.links
  const shown = links.length ? links : defaultNavLinks()
  const setLinks = (next) => patch('nav', { links: next })
  const edit = (i, p) => setLinks(shown.map((l, j) => (j === i ? { ...l, ...p } : l)))
  const isSection = (l) => l.target.startsWith('section:')

  return (
    <div className="space-y-5">
      <Section title={t('landing.hero.heading')} hint={t('landing.hero.hint')} testId="hero-editor">
        <BilingualField label={t('landing.hero.title')} value={config.hero.title} onChange={(title) => patch('hero', { title })} />
        <BilingualField label={t('landing.hero.body')} value={config.hero.body} onChange={(body) => patch('hero', { body })} as="textarea" rows={3} />
        <ImageField
          label={t('landing.hero.cover')}
          profile="landing"
          src={config.hero.coverPath ? publicImageUrl(config.hero.coverPath) : ''}
          thumb={config.hero.coverPath ? publicThumbUrl(config.hero.coverPath) : ''}
          aspect="21 / 9"
          onFile={async (file) => { const path = await onHeroCover(file); patch('hero', { coverPath: path }) }}
          onClear={onClearHeroCover}
          labels={{ choose: t('landing.hero.coverChoose'), replace: t('landing.card.coverReplace'), remove: t('landing.card.coverRemove'), hint: t('landing.hero.coverHint') }}
          errorText={(code) => t(code === 'upload' ? 'landing.edit.err.upload' : `errors.${code}`)}
        />
      </Section>

      <Section title={t('landing.nav.heading')} hint={t('landing.nav.hint')} testId="nav-editor">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={config.nav.enabled} onChange={(e) => patch('nav', { enabled: e.target.checked })} data-testid="nav-enabled" />
          {t('landing.nav.enabled')}
        </label>
        {config.nav.enabled && (
          <>
            {!links.length && <p className="rounded-md bg-surface p-3 text-sm text-muted-foreground">{t('landing.nav.defaults')}</p>}
            <ul className="space-y-3">
              {shown.map((l, i) => (
                <li key={l.id} className="space-y-3 rounded-card border bg-surface/40 p-3" data-testid="nav-link">
                  <BilingualField label={t('landing.nav.linkLabel', { n: i + 1 })} value={l.label} onChange={(label) => edit(i, { label })} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor={`nav-target-${l.id}`} className={LABEL_CLASS}>{t('landing.nav.target')}</label>
                      <select id={`nav-target-${l.id}`} className={SELECT_CLASS} value={isSection(l) ? l.target : 'url'} onChange={(e) => edit(i, { target: e.target.value === 'url' ? 'https://' : e.target.value })}>
                        {NAV_SECTIONS.map((s) => <option key={s} value={`section:${s}`}>{t(`landing.nav.section.${s}`)}</option>)}
                        <option value="url">{t('landing.nav.external')}</option>
                      </select>
                    </div>
                    {!isSection(l) && <Field label={t('landing.nav.url')} dir="ltr" inputMode="url" value={l.target} onChange={(e) => edit(i, { target: e.target.value })} error={errors[`nav.${l.id}`] ? t('landing.edit.err.url') : undefined} />}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => setLinks(moveItem(shown, i, i - 1))} aria-label={t('landing.edit.moveUp')}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" disabled={i === shown.length - 1} onClick={() => setLinks(moveItem(shown, i, i + 1))} aria-label={t('landing.edit.moveDown')}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setLinks(shown.filter((_, j) => j !== i))} aria-label={t('landing.edit.remove')}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('landing.edit.remove')}</Button>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={() => setLinks([...shown, { id: newId(), label: { en: '', ar: '' }, target: 'section:cards' }])} data-testid="nav-add"><Plus className="h-4 w-4" aria-hidden="true" />{t('landing.nav.add')}</Button>
          </>
        )}
      </Section>

      <Section title={t('landing.intro.heading')} hint={t('landing.intro.hint')} testId="intro-editor">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={config.cardsSection.enabled} onChange={(e) => patch('cardsSection', { enabled: e.target.checked })} />
          {t('landing.intro.enabled')}
        </label>
        <BilingualField label={t('landing.intro.title')} value={config.cardsSection.title} onChange={(title) => patch('cardsSection', { title })} />
        <BilingualField label={t('landing.intro.body')} value={config.cardsSection.body} onChange={(body) => patch('cardsSection', { body })} as="textarea" rows={3} />
        <div className="max-w-xs space-y-1.5">
          <label htmlFor="landing-columns" className={LABEL_CLASS}>{t('landing.intro.columns')}</label>
          <select id="landing-columns" className={SELECT_CLASS} value={config.cardsSection.layoutColumns || ''} onChange={(e) => patch('cardsSection', { layoutColumns: e.target.value ? Number(e.target.value) : 0 })}>
            <option value="">{t('landing.intro.columnsAuto')}</option>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{t('landing.intro.columnsN', { n })}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">{t('landing.intro.columnsHint')}</p>
        </div>
      </Section>
    </div>
  )
}
