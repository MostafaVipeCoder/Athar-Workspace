/**
 * The two vector illustrations of landing-page.html, shown on a card without a cover image (the PM uploads a cover to replace
 * them). Drawn with the app tokens (`fill-primary`, `fill-accent`, `fill-background`), no literal colours.
 */
export default function CardArt({ variant = 0, className }) {
  if (variant % 2 === 0) {
    return (
      <svg viewBox="0 0 400 250" fill="none" className={className} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
        <rect width="400" height="250" className="fill-primary/10" />
        <circle cx="200" cy="125" r="95" className="stroke-primary" strokeWidth="1.5" strokeDasharray="6 6" strokeOpacity="0.25" />
        <circle cx="200" cy="125" r="65" className="fill-primary/5" />
        <rect x="160" y="85" width="80" height="80" rx="18" transform="rotate(45 200 125)" className="fill-background stroke-primary" strokeWidth="2.5" />
        <path d="M205 98 L188 126 H203 L195 152 L216 120 H201 L205 98 Z" className="fill-primary" />
        <circle cx="115" cy="100" r="16" className="fill-accent stroke-background" strokeWidth="2" />
        <path d="M115 95 V105 M110 100 H120" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
        <circle cx="285" cy="155" r="18" className="fill-background stroke-primary" strokeWidth="2" />
        <path d="M285 147 C290 151 292 157 285 163 C278 157 280 151 285 147 Z" className="fill-accent stroke-primary" strokeWidth="1.5" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 400 250" fill="none" className={className} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="250" className="fill-primary/10" />
      <circle cx="200" cy="125" r="90" className="fill-primary/5" />
      <circle cx="200" cy="125" r="55" className="fill-primary/10" />
      <path d="M120 150 L200 95 L280 145" className="stroke-primary" strokeWidth="2" strokeDasharray="4 4" strokeOpacity="0.35" />
      <path d="M200 95 L200 165" className="stroke-primary" strokeWidth="2" strokeOpacity="0.25" />
      <rect x="160" y="70" width="80" height="96" rx="12" className="fill-background stroke-primary" strokeWidth="2.5" />
      <rect x="175" y="90" width="50" height="5" rx="2.5" className="fill-primary" />
      <rect x="175" y="103" width="36" height="4" rx="2" className="fill-primary" fillOpacity="0.35" />
      <rect x="175" y="115" width="44" height="4" rx="2" className="fill-primary" fillOpacity="0.35" />
      <rect x="175" y="127" width="28" height="4" rx="2" className="fill-primary" fillOpacity="0.35" />
      <circle cx="225" cy="74" r="14" className="fill-accent stroke-background" strokeWidth="2" />
      <path d="M225 69 L226.5 72.5 L230 74 L226.5 75.5 L225 79 L223.5 75.5 L220 74 L223.5 72.5 Z" className="fill-primary" />
      <circle cx="120" cy="150" r="20" className="fill-background stroke-primary" strokeWidth="2" />
      <circle cx="120" cy="150" r="7" className="fill-primary" />
      <circle cx="280" cy="145" r="22" className="fill-background stroke-primary" strokeWidth="2" />
      <path d="M273 145 H287 M280 138 V152" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
