import { MessageCircle, Send, Share2, Copy } from 'lucide-react'

/**
 * lucide has no brand marks, so the three it lacks (Facebook, LinkedIn, Instagram) and X are drawn here as small 24 x 24 glyphs
 * (decorative: every button carries a text label). Telegram / WhatsApp / copy reuse lucide's send / message-circle / copy.
 */
const base = { width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }

const Facebook = (props) => (
  <svg {...base} fill="currentColor" {...props}>
    <path d="M14 8h2.2V5H13.5C11 5 10 6.6 10 8.7V10H8v3h2v6.5h3V13h2.3l.5-3H13V8.9c0-.6.2-.9 1-.9z" />
  </svg>
)
const LinkedIn = (props) => (
  <svg {...base} fill="currentColor" {...props}>
    <path d="M6.2 9.2h2.7V18H6.2zM7.55 5.2a1.55 1.55 0 110 3.1 1.55 1.55 0 010-3.1zM10.9 9.2h2.6v1.2c.4-.8 1.4-1.4 2.8-1.4 2.7 0 3.3 1.8 3.3 4.1V18h-2.7v-4.4c0-1.1 0-2.3-1.5-2.3s-1.7 1.1-1.7 2.2V18h-2.8z" />
  </svg>
)
const Instagram = (props) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none" />
  </svg>
)
const XMark = (props) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...props}>
    <path d="M5 5l14 14M19 5L5 19" />
  </svg>
)

const SOCIAL_ICONS = {
  whatsapp: MessageCircle,
  facebook: Facebook,
  linkedin: LinkedIn,
  instagram: Instagram,
  telegram: Send,
  x: XMark,
  copy: Copy,
  native: Share2,
}

export function ChannelIcon({ platform, className }) {
  const Icon = SOCIAL_ICONS[platform] ?? Share2
  return <Icon className={className} aria-hidden="true" />
}
