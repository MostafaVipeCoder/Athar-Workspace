import { pickBi, withSource } from './landingLogic.js'

/**
 * Share presets of a landing card (design 07 section 5, decisions 07-13 and 01-13). Pure: no window, no clipboard.
 *
 * - The PM writes ONE text per card per platform; `{link}` (also `{{link}}`) is replaced EVERYWHERE it appears (the as-is page replaced only
 *   the first occurrence, docs/04 A-22). An empty preset = the built-in default "<card title>\n{link}". A preset without any `{link}` still
 *   carries the link (appended on its own line): sharing a text that loses the link is never what a PM wants.
 * - WhatsApp / X: the full text (link included) in the intent URL. Telegram: `url` = the link and `text` = the message WITHOUT the link
 *   (the as-is code passed the whole message as `url`; with both params Telegram would show the link twice if it stayed in the text).
 * - Facebook / LinkedIn cannot prefill text (07-13, accepted by the owner): the intent URL carries the link only and the UI copies the
 *   text first ("copy, then paste").
 * - Instagram has no web share URL: copy the text (+ the Web Share API where the browser has it, + the photo download of the page).
 * - Copy: the text on the clipboard.
 */
const LINK_TOKEN_RE = /\{\{\s*link\s*\}\}|\{\s*link\s*\}/gi

export const hasLinkToken = (s) => new RegExp(LINK_TOKEN_RE.source, 'i').test(String(s ?? ''))

/** Replace EVERY `{link}` / `{{link}}` (a replacer function: `$&` and friends in the link are never interpreted). */
export function fillLink(textValue, link) {
  return String(textValue ?? '').replace(LINK_TOKEN_RE, () => link)
}

/** The message minus the link token, tidied (used where the link travels in its own parameter). */
export function stripLink(textValue) {
  return fillLink(textValue, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

/** "<card title>\n{link}" in the visitor's language (chip label, then body, as fallbacks). */
export function defaultShareText(card, lang) {
  const head = pickBi(card.title, lang) || pickBi(card.chip, lang) || pickBi(card.ctaLabel, lang) || ''
  return head ? `${head}\n{link}` : '{link}'
}

/** The preset a PM wrote for (card, platform), or the default. */
export function presetFor(card, platform, lang) {
  const own = String(card.presets?.[platform] ?? '')
  return own.trim() ? own : defaultShareText(card, lang)
}

/** The final text of a platform with the link filled in everywhere (and appended when the PM's text has no `{link}`). */
export function shareText(card, platform, { lang, link }) {
  const raw = presetFor(card, platform, lang)
  const filled = fillLink(raw, link)
  return hasLinkToken(raw) ? filled : `${filled}\n${link}`
}

const enc = encodeURIComponent

/**
 * One channel of the share dialog:
 * { platform, kind: 'url' | 'copy', href?, text, copyFirst, hint }
 *  - `kind: 'url'` opens `href` in a new tab (an anchor, so no pop-up blocker); `copyFirst` also puts `text` on the clipboard (Facebook / LinkedIn);
 *  - `kind: 'copy'` only copies `text` (Instagram, Copy); `hint` tells the UI what to say ('paste' | 'instagram').
 * `sourceable` adds `?source=<platform>` to the link (our own form pages count submissions by source).
 */
export function buildChannel(platform, { card, lang, link, sourceable = false }) {
  const target = sourceable ? withSource(link, platform) : link
  const text = shareText(card, platform, { lang, link: target })
  switch (platform) {
    case 'whatsapp':
      return { platform, kind: 'url', href: `https://wa.me/?text=${enc(text)}`, text, copyFirst: false, hint: null }
    case 'telegram': {
      const message = stripLink(presetFor(card, platform, lang))
      return { platform, kind: 'url', href: `https://t.me/share/url?url=${enc(target)}${message ? `&text=${enc(message)}` : ''}`, text, copyFirst: false, hint: null }
    }
    case 'x':
      return { platform, kind: 'url', href: `https://twitter.com/intent/tweet?text=${enc(text)}`, text, copyFirst: false, hint: null }
    case 'facebook':
      return { platform, kind: 'url', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(target)}`, text, copyFirst: true, hint: 'paste' }
    case 'linkedin':
      return { platform, kind: 'url', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(target)}`, text, copyFirst: true, hint: 'paste' }
    case 'instagram':
      return { platform, kind: 'copy', text, copyFirst: false, hint: 'instagram' }
    default:
      return { platform: 'copy', kind: 'copy', text, copyFirst: false, hint: null }
  }
}

/** The channels of a card in the page's order (config `share.channels`). */
export function buildChannels(channels, ctx) {
  return channels.map((p) => buildChannel(p, ctx))
}

/** Payload of `navigator.share` (title + message without the link + url: the OS sheet joins them itself). */
export function nativeSharePayload(card, { lang, link }) {
  const title = pickBi(card.title, lang) || pickBi(card.chip, lang) || ''
  const message = stripLink(presetFor(card, 'copy', lang))
  return { title, text: message, url: link }
}
