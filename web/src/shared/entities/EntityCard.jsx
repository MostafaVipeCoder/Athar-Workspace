import { memo } from 'react'
import { Globe, Link2, User, Building2 } from 'lucide-react'
import './i18n.js'
import { Img } from '../../ui/Img.jsx'
import { ExpandableText } from '../../ui/ExpandableText.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { biPick, CARD_FIELDS } from '../../lib/entities.js'
import { cn } from '../../lib/cn.js'

/** lucide-react has no brand icons any more: one tiny inline "in" glyph (same 24 px grid as lucide). */
function LinkedInGlyph({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M6.94 8.5H3.56V20h3.38V8.5zM5.25 3.5a1.97 1.97 0 1 0 0 3.94 1.97 1.97 0 0 0 0-3.94zM20.5 13.1c0-3.3-1.76-4.84-4.1-4.84-1.9 0-2.75 1.04-3.22 1.78V8.5H9.8c.04.95 0 11.5 0 11.5h3.38v-6.42c0-.34.02-.69.12-.93.25-.61.8-1.25 1.74-1.25 1.23 0 1.72.94 1.72 2.31V20h3.38v-6.9z" />
    </svg>
  )
}
const LINK_ICON = { linkedin: LinkedInGlyph, website: Globe, other: Link2 }

/**
 * ONE card for experts, companies and generic items (design 06 section 6.2 EntityCard; replaces ExpertCard +
 * CompanyCard). Presentational: `entity` is an EntityView (lib/entities.js), `show` the visible CARD_FIELDS for this
 * item (list default merged with the per-item choice by the caller), `badges`/`actions` are slots for the PM screens.
 * Mobile-first: full-width card, 44 px link targets, image with reserved aspect (no layout shift), bio clamped with
 * "see more" unless `forceExpanded` (single-item pages). Bilingual: every text goes through biPick(lang).
 * No onClick on the article itself (a11y): interactive things go in `actions`.
 */
function EntityCardImpl({ entity, show = CARD_FIELDS, forceExpanded = false, expandable = true, accent, badges, actions, className, dense = false, muted = false }) {
  const { t, lang } = useLanguage()
  const visible = new Set(show)
  const title = biPick(entity.title, lang)
  const subtitle = biPick(entity.subtitle, lang)
  const organization = biPick(entity.organization, lang)
  const bio = biPick(entity.bio, lang)
  const isCompany = entity.kind === 'company'
  const Fallback = isCompany ? Building2 : User
  const links = visible.has('links') ? entity.links ?? [] : []

  const linkList = links.length > 0 && (
    <ul className="mt-auto flex flex-wrap gap-1 pt-1" aria-label={t('entity.field.links')}>
      {links.map((l) => {
        const Icon = LINK_ICON[l.kind] ?? Link2
        return (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noopener noreferrer" aria-label={t(`entity.card.${l.kind === 'linkedin' ? 'linkedin' : l.kind === 'website' ? 'website' : 'link'}`)} className="tap-target inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </a>
          </li>
        )
      })}
    </ul>
  )

  // compact row (founder Program page lists): a round avatar / logo box beside the text instead of a 3:1 picture band
  if (dense) {
    return (
      <article className={cn('flex h-full items-start gap-3 overflow-hidden rounded-card border border-border bg-card p-3 text-card-foreground', muted && 'bg-surface', className)} style={accent ? { borderInlineStartColor: accent, borderInlineStartWidth: 4 } : undefined} data-testid="entity-card" data-kind={entity.kind} data-dense="true">
        {visible.has('image') && (
          <div className={cn('flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden bg-surface text-muted-foreground', isCompany ? 'rounded-md' : 'rounded-full', muted && 'opacity-60')}>
            {entity.imagePath ? (
              <Img src={publicImageUrl(entity.imagePath)} thumb={publicThumbUrl(entity.imagePath)} alt={title} aspect="1 / 1" fit={isCompany ? 'contain' : 'cover'} className={cn('h-full w-full', isCompany && 'bg-white p-1')} />
            ) : (
              <Fallback className="h-6 w-6" role="img" aria-label={t('entity.card.noImage')} />
            )}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {visible.has('title') && <h3 dir="auto" className={cn('break-words text-base font-bold leading-snug', muted && 'text-muted-foreground')}>{title || '-'}</h3>}
          {visible.has('subtitle') && subtitle && <p dir="auto" className="text-sm font-medium text-primary">{subtitle}</p>}
          {visible.has('organization') && organization && <p dir="auto" className="text-sm text-muted-foreground">{organization}</p>}
          {visible.has('bio') && bio && <ExpandableText text={bio} lines={2} threshold={90} forceExpanded={forceExpanded || !expandable} labels={{ more: t('entity.card.more'), less: t('entity.card.less') }} className="mt-1" />}
          {linkList}
          {actions && <div className="flex flex-wrap gap-1 border-t pt-2">{actions}</div>}
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn('flex h-full flex-col overflow-hidden rounded-card border border-border bg-card text-card-foreground', muted && 'bg-surface', className)}
      style={accent ? { borderTopColor: accent, borderTopWidth: 4 } : undefined}
      data-testid="entity-card"
      data-kind={entity.kind}
    >
      {visible.has('image') && (
        <div className={cn('relative bg-surface', dense ? 'h-28' : '', muted && 'opacity-60')}>
          {entity.imagePath ? (
            <Img src={publicImageUrl(entity.imagePath)} thumb={publicThumbUrl(entity.imagePath)} alt={title} aspect={dense ? '3 / 1' : isCompany ? '16 / 9' : '4 / 3'} fit={isCompany ? 'contain' : 'cover'} className={cn(isCompany && 'bg-white p-3')} />
          ) : (
            <div className="flex items-center justify-center text-muted-foreground" style={{ aspectRatio: dense ? '3 / 1' : isCompany ? '16 / 9' : '4 / 3' }} aria-label={t('entity.card.noImage')} role="img">
              <Fallback className="h-10 w-10" aria-hidden="true" />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {badges && <div className="flex flex-wrap gap-1">{badges}</div>}
        {/* dir="auto": an English bio inside the Arabic UI (or vice versa) keeps its own reading direction */}
        {visible.has('title') && <h3 dir="auto" className={cn('text-base font-bold leading-snug', muted && 'text-muted-foreground')}>{title || '-'}</h3>}
        {visible.has('subtitle') && subtitle && <p dir="auto" className="text-sm font-medium text-primary">{subtitle}</p>}
        {visible.has('organization') && organization && <p dir="auto" className="text-sm text-muted-foreground">{organization}</p>}
        {visible.has('bio') && bio && (
          <ExpandableText text={bio} forceExpanded={forceExpanded || !expandable} labels={{ more: t('entity.card.more'), less: t('entity.card.less') }} className="mt-1" />
        )}
        {links.length > 0 && (
          <ul className="mt-auto flex flex-wrap gap-1 pt-2" aria-label={t('entity.field.links')}>
            {links.map((l) => {
              const Icon = LINK_ICON[l.kind] ?? Link2
              return (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t(`entity.card.${l.kind === 'linkedin' ? 'linkedin' : l.kind === 'website' ? 'website' : 'link'}`)}
                    className="tap-target inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground"
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </a>
                </li>
              )
            })}
          </ul>
        )}
        {actions && <div className="flex flex-wrap gap-1 border-t pt-2">{actions}</div>}
      </div>
    </article>
  )
}

export const EntityCard = memo(EntityCardImpl)
export default EntityCard
