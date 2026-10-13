import { useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'
import { Button } from '../../ui/Button.jsx'
import { EmptyState } from '../../ui/States.jsx'
import { LABEL_CLASS, INPUT_CLASS } from '../../ui/Field.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { cn } from '../../lib/cn.js'
import { appBaseUrl } from '../../lib/links.js'
import { SHARE_PLATFORMS, pickBi, resolveCardLinks, withResolvedLinks } from './landingLogic.js'
import { buildChannel, defaultShareText, hasLinkToken } from './shareLogic.js'
import { ChannelIcon } from './socialIcons.jsx'

/**
 * Share tab (design 07 section 5.2, decision 01-13): which channels the dialog offers (page level) and, per card and per channel, the text the
 * PM wants posted, with `{link}` replaced everywhere it appears. An empty text = the built-in default (card title + link). Every textarea
 * shows the FINAL text and the exact URL the visitor's click opens, in the language chosen at the top, so nothing is a surprise.
 * Facebook / LinkedIn cannot prefill text (07-13): the visitor's browser copies the text, then they paste it; the editor says so.
 */
export default function ShareEditor({ config, patchShare, cards, setCards, linkOptions, pageUrl }) {
  const { t, lang: uiLang } = useLanguage()
  const [previewLang, setPreviewLang] = useState(uiLang === 'ar' ? 'ar' : 'en')
  const optionsByNode = useMemo(() => new Map(linkOptions.map((o) => [o.nodeId, o])), [linkOptions])
  const channels = config.share.channels
  const toggleChannel = (p) => patchShare({ channels: channels.includes(p) ? channels.filter((x) => x !== p) : SHARE_PLATFORMS.filter((x) => channels.includes(x) || x === p) })
  const setPreset = (id, platform, value) => setCards((cur) => cur.map((c) => (c.id === id ? { ...c, presets: { ...c.presets, [platform]: value } } : c)))
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const base = appBaseUrl()

  return (
    <div className="space-y-5" data-testid="share-editor">
      <section className="space-y-3 rounded-card border p-4 sm:p-5">
        <div>
          <h3 className="font-display text-lg font-bold">{t('landing.share.channelsHeading')}</h3>
          <p className="text-sm text-muted-foreground">{t('landing.share.channelsHint')}</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {SHARE_PLATFORMS.map((p) => (
            <label key={p} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={channels.includes(p)} onChange={() => toggleChannel(p)} data-testid={`channel-${p}`} />
              <ChannelIcon platform={p} className="h-4 w-4 text-primary" />
              {t(`landing.channel.${p}`)}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t('landing.share.previewIn')}</span>
          {['en', 'ar'].map((l) => (
            <Button key={l} size="sm" variant={previewLang === l ? 'secondary' : 'outline'} onClick={() => setPreviewLang(l)} aria-pressed={previewLang === l}>{l === 'en' ? 'English' : 'العربية'}</Button>
          ))}
        </div>
      </section>

      {cards.length === 0 && <EmptyState title={t('landing.share.noCards')} />}

      {cards.map((card) => {
        const resolved = withResolvedLinks(card, optionsByNode)
        const links = resolveCardLinks(resolved, { base, origin, pageUrl })
        const name = pickBi(card.title, previewLang) || pickBi(card.chip, previewLang) || t('landing.cards.untitled')
        return (
          <section key={card.id} className="space-y-4 rounded-card border p-4 sm:p-5" data-testid="share-card" data-card-id={card.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-display text-lg font-bold" dir="auto">{name}</h3>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('landing.share.target')}: <code dir="ltr" className="min-w-0 truncate rounded-xs bg-surface px-1.5 py-0.5">{links.shareUrl || t('landing.share.noTarget')}</code></p>
              </div>
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={card.shareEnabled} onChange={(e) => setCards((cur) => cur.map((c) => (c.id === card.id ? { ...c, shareEnabled: e.target.checked } : c)))} />
                {t('landing.card.shareEnabled')}
              </label>
            </div>
            {card.shareEnabled && channels.length === 0 && <p className="text-sm text-muted-foreground">{t('landing.share.noChannels')}</p>}
            {card.shareEnabled && channels.map((p) => {
              const own = card.presets?.[p] ?? ''
              const link = links.shareUrl || 'https://…'
              const ch = buildChannel(p, { card: resolved, lang: previewLang, link, sourceable: links.sourceable })
              const id = `preset-${card.id}-${p}`
              return (
                <div key={p} className="space-y-1.5" data-testid={`preset-${p}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor={id} className={cn(LABEL_CLASS, 'inline-flex items-center gap-2')}><ChannelIcon platform={p} className="h-4 w-4 text-primary" />{t(`landing.channel.${p}`)}</label>
                    <Button variant="ghost" size="sm" onClick={() => setPreset(card.id, p, `${own}${own && !own.endsWith(' ') && !own.endsWith('\n') ? ' ' : ''}{link}`)}>{t('landing.share.insertLink')}</Button>
                  </div>
                  <textarea id={id} rows={3} className={cn(INPUT_CLASS, 'min-h-[84px] leading-relaxed')} value={own} placeholder={defaultShareText(card, previewLang)} onChange={(e) => setPreset(card.id, p, e.target.value)} dir="auto" />
                  {own.trim() && !hasLinkToken(own) && <p className="text-xs text-muted-foreground">{t('landing.share.noToken')}</p>}
                  <div className="rounded-md bg-surface p-3 text-sm" aria-live="polite">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('landing.share.finalText')}</p>
                    <p className="mt-1 whitespace-pre-line break-words" dir="auto" data-testid={`final-${p}`}>{ch.text}</p>
                    {ch.href && <p className="mt-2 break-all text-xs text-muted-foreground" dir="ltr" data-testid={`href-${p}`}>{ch.href}</p>}
                    {ch.hint === 'paste' && <p className="mt-2 text-xs text-muted-foreground">{t('landing.share.pasteNote')}</p>}
                    {ch.hint === 'instagram' && <p className="mt-2 text-xs text-muted-foreground">{t('landing.share.instagramNote')}</p>}
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
