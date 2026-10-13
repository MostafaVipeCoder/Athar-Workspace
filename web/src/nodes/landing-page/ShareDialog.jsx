import { useMemo, useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import { Modal } from '../../ui/Modal.jsx'
import { cn } from '../../lib/cn.js'
import { translate } from '../../i18n/core.js'
import { pickBi } from './landingLogic.js'
import { buildChannels, nativeSharePayload } from './shareLogic.js'
import { ChannelIcon } from './socialIcons.jsx'
import { canNativeShare, copyText } from './clipboard.js'
import './i18n.js'

const ROW =
  'flex min-h-12 w-full items-center gap-3 rounded-input border border-border bg-background px-4 text-start text-base font-semibold text-foreground transition-colors duration-300 hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Share dialog of one card (design 07 section 5, decision 07-13): one row per channel of the page (config `share.channels`).
 * WhatsApp / Telegram / X open their intent URL in a new tab (an anchor: no pop-up blocker); Facebook and LinkedIn cannot prefill text, so
 * the text is copied first and the visitor pastes it ("copy, then paste", accepted by the owner); Instagram and Copy only copy;
 * the OS share sheet (Web Share API) is offered first where the browser has it. Every action is counted through `track`.
 * `link` is the share TARGET (decision 01-13: the card's button link unless a share link is set).
 */
export default function ShareDialog({ open, onClose, card, lang, channels, link, sourceable, track }) {
  const tl = useMemo(() => (key, vars) => translate(lang, key, vars), [lang])
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(null)
  const [manual, setManual] = useState('') // text the browser refused to copy: shown selectable
  const list = useMemo(() => (card ? buildChannels(channels, { card, lang, link, sourceable }) : []), [card, channels, lang, link, sourceable])
  if (!card) return null
  const title = pickBi(card.title, lang) || pickBi(card.chip, lang) || tl('landing.share.title')

  async function doCopy(text, key, platform, event = 'share_copy') {
    const ok = await copyText(text)
    setCopied(ok ? key : null)
    setManual(ok ? '' : text)
    setNotice(ok ? tl('landing.share.copied') : tl('landing.share.copyFailed'))
    track?.(event, { cardId: card.id, platform })
    return ok
  }

  async function onChannel(ch, e) {
    if (ch.kind === 'copy') {
      e.preventDefault()
      const ok = await doCopy(ch.text, ch.platform, ch.platform === 'copy' ? 'copy' : ch.platform, ch.platform === 'copy' ? 'share_copy' : 'card_share')
      if (ok && ch.hint === 'instagram') setNotice(tl('landing.share.instagramHint'))
      return
    }
    // url channels: the anchor opens the intent; Facebook / LinkedIn copy the text first (the click stays a user gesture)
    track?.('card_share', { cardId: card.id, platform: ch.platform })
    if (ch.copyFirst) {
      const ok = await copyText(ch.text)
      setNotice(ok ? tl('landing.share.pasteHint', { platform: tl(`landing.channel.${ch.platform}`) }) : tl('landing.share.copyFailed'))
      setCopied(ok ? ch.platform : null)
      setManual(ok ? '' : ch.text)
    }
  }

  async function onNative() {
    try {
      await navigator.share(nativeSharePayload(card, { lang, link }))
      track?.('card_share', { cardId: card.id, platform: 'native' })
    } catch {
      /* the visitor closed the sheet */
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={tl('landing.share.heading')} description={title} closeLabel={tl('landing.close')} className="landing-page sm:max-w-md">
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="space-y-4" data-testid="share-dialog">
        {canNativeShare() && (
          <button type="button" onClick={onNative} className={cn(ROW, 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground')} data-testid="share-native">
            <Share2 className="h-5 w-5" aria-hidden="true" />
            {tl('landing.share.native')}
          </button>
        )}
        <ul className="grid gap-2" aria-label={tl('landing.share.channels')}>
          {list.map((ch) => {
            const label = tl(`landing.channel.${ch.platform}`)
            const inner = (
              <>
                <ChannelIcon platform={ch.platform} className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {copied === ch.platform && <Check className="h-4 w-4 text-success" aria-hidden="true" />}
                {ch.kind === 'copy' && copied !== ch.platform && <Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              </>
            )
            return (
              <li key={ch.platform}>
                {ch.kind === 'url' ? (
                  <a href={ch.href} target="_blank" rel="noopener noreferrer" onClick={(e) => onChannel(ch, e)} className={ROW} data-testid={`share-${ch.platform}`}>
                    {inner}
                  </a>
                ) : (
                  <button type="button" onClick={(e) => onChannel(ch, e)} className={ROW} data-testid={`share-${ch.platform}`}>
                    {inner}
                  </button>
                )}
                {ch.hint === 'paste' && <p className="mt-1 ps-1 text-xs text-muted-foreground">{tl('landing.share.pasteNote')}</p>}
                {ch.hint === 'instagram' && <p className="mt-1 ps-1 text-xs text-muted-foreground">{tl('landing.share.instagramNote')}</p>}
              </li>
            )
          })}
        </ul>
        <div className="space-y-1.5">
          <label htmlFor="landing-share-link" className="text-sm font-medium text-athar-ink">{tl('landing.share.link')}</label>
          <div className="flex gap-2">
            <input id="landing-share-link" readOnly dir="ltr" value={link} onFocus={(e) => e.target.select()} className="min-h-11 min-w-0 flex-1 rounded-input border border-input bg-input-bg px-3 text-sm" />
            <button type="button" onClick={() => doCopy(link, 'link', 'copy')} className="tap-target inline-flex items-center justify-center gap-2 rounded-md border-2 border-foreground px-4 text-sm font-semibold transition-colors hover:bg-foreground hover:text-background" data-testid="share-copy-link">
              <Copy className="h-4 w-4" aria-hidden="true" />
              {tl('landing.share.copyLink')}
            </button>
          </div>
        </div>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-primary" data-testid="share-notice">{notice}</p>
        {manual && <textarea readOnly rows={4} dir="auto" value={manual} onFocus={(e) => e.target.select()} aria-label={tl('landing.share.manualText')} className="w-full rounded-input border border-input bg-input-bg p-3 text-sm" data-testid="share-manual" />}
      </div>
    </Modal>
  )
}
