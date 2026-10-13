import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Share2 } from 'lucide-react'
import './landing.css'
import './i18n.js'
import { Img } from '../../ui/Img.jsx'
import { cn } from '../../lib/cn.js'
import { BRAND } from '../../lib/brand.js'
import { dirOf, translate } from '../../i18n/core.js'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { framePublicUrl } from '../../data/landing.js'
import { appBaseUrl } from '../../lib/links.js'
import CardArt from './CardArt.jsx'
import { isCompactWidth, useContainerWidth } from './useContainerWidth.js'
import { pickBi, resolveCardLinks, resolveNav } from './landingLogic.js'

const ShareDialog = lazy(() => import('./ShareDialog.jsx'))
const PersonalizeSection = lazy(() => import('./PersonalizeSection.jsx'))

const originOf = () => (typeof window !== 'undefined' ? window.location.origin : '')
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * THE landing page renderer (landing-page.html, restyled with the platform tokens): used by the public page `/view/:ref/landing`, the
 * Agenda / project-page tab, the node's View mode and the editor's live preview, so what the PM previews is what a visitor gets.
 * It never fetches. Layout decisions use the component's OWN width (`compact` < 768 px), not the viewport, so it is right as a full
 * page, as a tab of the 750 px agenda page and inside the editor's phone-sized preview.
 *
 * Props:
 *  model     { config, cards, frames } (see `modelFromPayload`)
 *  lang      'ar' | 'en' (the page language; fixed texts come from the dictionary, content from the model with fallback)
 *  track     (type, { cardId, platform }) => void  analytics sink (omit = nothing recorded)
 *  mode      'page' (full page, sticky nav under the site header) | 'tab' (inside the agenda page: no nav) | 'preview' (editor / View mode: nothing recorded, no navigation away)
 *  pageUrl   absolute URL of the page (the share target when a card has none)
 *  slug      used for the download file name
 */
export default function LandingPage({ model, lang, track, mode = 'page', pageUrl = '', slug = '', stickyNav = true }) {
  const { config, cards, frames } = model
  const tl = useMemo(() => (key, vars) => translate(lang, key, vars), [lang])
  const rootRef = useRef(null)
  const width = useContainerWidth(rootRef)
  const compact = isCompactWidth(width)
  const preview = mode === 'preview'
  const [shareId, setShareId] = useState(null)
  const base = appBaseUrl()
  const origin = originOf()
  const frameUrl = useCallback((f) => framePublicUrl(f.path), [])
  const sink = useMemo(() => (preview ? undefined : track), [preview, track])

  const heroTitle = pickBi(config.hero.title, lang)
  const heroBody = pickBi(config.hero.body, lang)
  const heroCover = config.hero.coverPath
  const hasHero = Boolean(heroTitle || heroBody || heroCover)
  const personalizeOn = config.personalize.enabled
  const showCards = config.cardsSection.enabled && cards.length > 0
  const sectionTitle = pickBi(config.cardsSection.title, lang)
  const sectionBody = pickBi(config.cardsSection.body, lang)
  const nav = useMemo(() => resolveNav(config, { hasHero, hasCards: showCards, hasPersonalize: personalizeOn }), [config, hasHero, showCards, personalizeOn])
  const embedded = mode === 'tab'
  const columns = Math.max(1, Math.min(config.cardsSection.layoutColumns || Math.min(cards.length, 3), cards.length || 1, 3))
  const shareCard = cards.find((c) => c.id === shareId) ?? null
  const shareLinks = shareCard ? resolveCardLinks(shareCard, { base, origin, pageUrl }) : null

  const goTo = (e, section) => {
    e.preventDefault()
    const el = rootRef.current?.querySelector(`#landing-${section}`)
    el?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    if (mode === 'page' && typeof history !== 'undefined') history.replaceState(null, '', `#landing-${section}`)
  }

  useEffect(() => {
    if (mode !== 'page' || typeof window === 'undefined' || !window.location.hash.startsWith('#landing-')) return
    const el = rootRef.current?.querySelector(window.location.hash)
    el?.scrollIntoView?.({ block: 'start' })
  }, [mode, width])

  const scrollMt = mode === 'page' ? 'scroll-mt-36' : 'scroll-mt-16'

  return (
    <div ref={rootRef} dir={dirOf(lang)} lang={lang} className="landing-page w-full overflow-x-clip bg-background text-foreground" data-testid="landing-page" data-mode={mode} data-compact={compact ? 'true' : 'false'}>
      {/* ---------------------------------------------------------------- NAV */}
      {!embedded && nav.length > 0 && (
        <nav aria-label={tl('landing.nav.label')} className={cn('z-20 border-b border-primary/10 bg-background/95 shadow-[0_4px_20px_-2px_hsl(var(--primary)/0.04)] backdrop-blur', stickyNav && (mode === 'page' ? 'sticky top-header' : 'sticky top-0'), compact ? 'px-4 py-2.5' : 'px-6 py-3.5')}>
          <ul className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-center gap-2 sm:gap-3.5">
            {nav.map((l) => (
              <li key={l.id} className={compact ? 'max-w-[170px] flex-1' : undefined}>
                {l.section ? (
                  <a href={`#landing-${l.section}`} onClick={(e) => goTo(e, l.section)} className={cn('inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-[14px] border-[1.5px] border-primary/25 bg-background font-bold text-primary shadow-[0_2px_6px_hsl(var(--primary)/0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground hover:shadow-[0_6px_18px_hsl(var(--primary)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', compact ? 'px-3 text-[0.85rem]' : 'px-6 text-[0.94rem]')} data-testid={`nav-${l.section}`}>
                    {pickBi(l.label, lang) || tl(`landing.nav.default.${l.section}`)}
                  </a>
                ) : (
                  <a href={l.url} target="_blank" rel="noopener noreferrer" onClick={preview ? (e) => e.preventDefault() : undefined} className={cn('inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-[14px] border-[1.5px] border-primary/25 bg-background font-bold text-primary transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', compact ? 'px-3 text-[0.85rem]' : 'px-6 text-[0.94rem]')}>
                    {pickBi(l.label, lang)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* ---------------------------------------------------------------- HERO */}
      {hasHero && (
        <header id="landing-hero" className={cn('relative isolate flex flex-col items-center justify-center overflow-hidden text-center', scrollMt, embedded ? 'min-h-[220px] px-4 py-10' : compact ? 'min-h-[300px] px-4 py-12' : 'min-h-[440px] px-6 pb-16 pt-24')} style={heroCover ? undefined : { backgroundImage: `url(${BRAND.pattern})`, backgroundSize: compact ? '300px auto' : '800px auto', backgroundPosition: 'center top' }} data-testid="landing-hero">
          {heroCover && (
            <>
              <Img src={publicImageUrl(heroCover)} thumb={publicThumbUrl(heroCover)} alt="" aspect="auto" priority className="absolute inset-0 -z-10 h-full w-full" />
              <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/55" />
            </>
          )}
          <div className="mx-auto max-w-[860px]">
            {heroTitle && <h1 dir="auto" className={`${cn('font-display text-balance', heroCover ? 'text-white' : 'text-primary')} ${embedded ? 'text-page-title' : compact ? 'text-[2.1rem] leading-[1.15]' : 'text-hero'}`}>{heroTitle}</h1>}
            {heroBody && <p dir="auto" className={cn('mx-auto mt-5 max-w-[760px] text-pretty font-medium leading-relaxed', heroCover ? 'text-white/90' : 'text-muted-foreground', compact ? 'text-base' : 'text-[1.25rem]')}>{heroBody}</p>}
          </div>
        </header>
      )}

      {/* ---------------------------------------------------------------- CARDS */}
      {showCards && (
        <section id="landing-cards" aria-label={sectionTitle || tl('landing.cards.section')} className={cn('relative bg-background', scrollMt, compact ? 'pb-14 pt-8' : 'pb-[90px] pt-10')} data-testid="landing-cards">
          {(sectionTitle || sectionBody) && (
            <div className={cn('mx-auto mb-10 max-w-[800px] px-5', compact ? 'text-start' : 'text-center')}>
              {sectionTitle && <h2 dir="auto" className="mb-3 font-display text-section-title text-balance text-primary">{sectionTitle}</h2>}
              {sectionBody && <p dir="auto" className="whitespace-pre-line text-pretty text-md text-muted-foreground">{sectionBody}</p>}
            </div>
          )}
          <div
            className={cn(compact && cards.length > 1 ? 'landing-carousel flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto px-5 pb-6 pt-1.5' : 'mx-auto grid max-w-[1060px] justify-center gap-8 px-5 sm:px-6')}
            style={compact && cards.length > 1 ? { scrollPaddingInlineStart: '20px' } : { gridTemplateColumns: `repeat(${compact ? 1 : columns}, minmax(0, 495px))` }}
            data-testid="card-list"
          >
            {cards.map((card, i) => (
              <LandingCard key={card.id} card={card} index={i} lang={lang} tl={tl} compact={compact} carousel={compact && cards.length > 1} preview={preview} links={resolveCardLinks(card, { base, origin, pageUrl })} track={sink} onShare={() => setShareId(card.id)} />
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- PERSONALIZE */}
      {personalizeOn && (
        <Suspense fallback={<div className="min-h-[300px]" aria-hidden="true" />}>
          <PersonalizeSection config={config.personalize} frames={frames} frameUrl={frameUrl} lang={lang} compact={compact} track={sink} slug={slug} preview={preview} scrollMt={scrollMt} />
        </Suspense>
      )}

      {shareCard && (
        <Suspense fallback={null}>
          <ShareDialog open onClose={() => setShareId(null)} card={shareCard} lang={lang} channels={config.share.channels} link={shareLinks.shareUrl} sourceable={shareLinks.sourceable} track={sink} />
        </Suspense>
      )}
    </div>
  )
}

function LandingCard({ card, index, lang, tl, compact, carousel, preview, links, track, onShare }) {
  const [open, setOpen] = useState(false)
  const [overflow, setOverflow] = useState(null)
  const textRef = useRef(null)
  const textId = `landing-card-text-${card.id}`
  const chip = pickBi(card.chip, lang)
  const title = pickBi(card.title, lang)
  const body = pickBi(card.body, lang)
  const ctaLabel = pickBi(card.ctaLabel, lang)
  const lines = card.seeMoreLines || 3

  // "See more" is offered only when the clamped text really overflows (measured); before layout / without layout (tests) a length heuristic decides
  useEffect(() => {
    const el = textRef.current
    if (!el || open) return
    if (el.clientHeight > 0) setOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [body, lines, compact, lang, open])
  const needsToggle = overflow ?? body.length > 110

  const external = /^https?:\/\//i.test(links.ctaUrl) || links.ctaUrl.startsWith('mailto:') || links.ctaUrl.startsWith('tel:')
  const sameOrigin = links.ctaUrl.startsWith(originOf()) && originOf() !== ''
  const newTab = external && !sameOrigin
  const sameTab = !newTab && /^(https?:\/\/|\/)/i.test(links.ctaUrl)

  return (
    <article className={cn('group/card flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-primary/10 bg-surface shadow-[0_4px_20px_-4px_hsl(var(--primary)/0.06),0_16px_36px_-8px_hsl(var(--primary)/0.04)] transition duration-300 hover:-translate-y-1.5 hover:border-primary/25 hover:shadow-[0_12px_32px_-4px_hsl(var(--primary)/0.12),0_24px_48px_-8px_hsl(var(--primary)/0.08)] md:rounded-[28px]', carousel && 'min-w-[275px] max-w-[320px] shrink-0 basis-[82%] snap-start')} data-testid="landing-card" data-card-id={card.id}>
      <div className={cn('relative w-full overflow-hidden bg-primary/10', compact ? 'aspect-[16/11]' : 'aspect-[16/10]')}>
        {card.cover ? (
          <Img src={publicImageUrl(card.cover)} thumb={publicThumbUrl(card.cover)} alt="" aspect="auto" eager={index < 2} className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover/card:scale-[1.03]" />
        ) : (
          <CardArt variant={index} className="h-full w-full transition-transform duration-500 group-hover/card:scale-[1.03]" />
        )}
        {chip && <span className="absolute start-[18px] top-[18px] z-[3] select-none rounded-full border border-white/25 bg-primary/95 px-3.5 py-1.5 text-[0.74rem] font-bold uppercase tracking-wider text-primary-foreground shadow-[0_4px_14px_hsl(var(--primary)/0.3)] backdrop-blur rtl:tracking-normal">{chip}</span>}
        {card.shareEnabled && (
          <button type="button" onClick={onShare} aria-label={tl('landing.card.shareAria', { name: title || chip })} title={tl('landing.card.shareAria', { name: title || chip })} className="landing-wiggle absolute end-[18px] top-[18px] z-[3] flex h-12 w-12 items-center justify-center rounded-[15px] border border-white/90 bg-white/85 text-primary shadow-[0_4px_16px_rgb(0_0_0/0.08)] backdrop-blur-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" data-testid="card-share">
            <Share2 className="h-[21px] w-[21px]" strokeWidth={2.2} aria-hidden="true" />
            <span aria-hidden="true" className="absolute -end-[3px] -top-[3px] h-3.5 w-3.5 rounded-full border-[2.5px] border-white bg-accent shadow-[0_2px_6px_rgb(0_0_0/0.22)]" />
          </button>
        )}
      </div>

      <div className={cn('flex flex-1 flex-col', compact ? 'px-5 pt-5' : 'px-[26px] pt-[26px]')}>
        {title && <h3 dir="auto" className="mb-2.5 font-display text-[1.3rem] leading-[1.3] text-foreground">{title}</h3>}
        {body && (
          <>
            <p ref={textRef} id={textId} dir="auto" className={cn('whitespace-pre-line font-questrial text-[0.94rem] leading-[1.65] text-muted-foreground', !open && 'landing-clamp')} style={open ? undefined : { WebkitLineClamp: lines }} data-testid="card-text">{body}</p>
            {needsToggle && (
              <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={textId} className="mt-2.5 inline-flex min-h-9 items-center self-start px-0 text-[0.86rem] font-bold text-primary transition-colors hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="card-see-more">
                {open ? tl('landing.card.seeLess') : tl('landing.card.seeMore')}
              </button>
            )}
          </>
        )}
      </div>

      {ctaLabel && (
        <div className={cn('mt-auto', compact ? 'px-5 pb-5 pt-4' : 'px-[26px] pb-[26px] pt-[22px]')}>
          {links.ctaHref ? (
            <a
              href={links.ctaHref}
              {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              onClick={(e) => {
                if (preview) {
                  e.preventDefault()
                  return
                }
                const sent = track?.('cta_click', { cardId: card.id })
                // a same-tab navigation would cancel the request: wait for it (at most ~400 ms), then go
                if (sent && sameTab && !e.defaultPrevented && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
                  e.preventDefault()
                  const href = links.ctaHref
                  Promise.race([sent, new Promise((r) => setTimeout(r, 400))]).finally(() => window.location.assign(href))
                }
              }}
              className="landing-pulse relative flex min-h-[50px] w-full items-center justify-center rounded-[14px] border-[1.5px] border-primary/35 bg-background px-5 py-3.5 text-[0.98rem] font-bold text-primary shadow-[0_2px_8px_hsl(var(--primary)/0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground hover:shadow-[0_8px_22px_hsl(var(--primary)/0.26)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&:hover_.landing-dot]:border-primary"
              data-testid="card-cta"
            >
              <span className="relative inline-block leading-none">
                {card.ctaDot && <span aria-hidden="true" className="landing-dot absolute -start-[3px] -top-3 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent shadow-[0_1px_4px_rgb(0_0_0/0.2)] transition-colors" />}
                {ctaLabel}
              </span>
            </a>
          ) : (
            <span aria-disabled="true" className="flex min-h-[50px] w-full items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-primary/25 px-5 py-3.5 text-[0.98rem] font-bold text-primary/60" data-testid="card-cta-empty">
              <span className="relative inline-block leading-none">{ctaLabel}</span>
            </span>
          )}
        </div>
      )}
    </article>
  )
}
