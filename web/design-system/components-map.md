# Components map — athareg.com patterns → `web/src`

How each pattern on the public site maps to the platform's existing UI primitives and shells, and what must change for the app to look like the website. Values come from `DESIGN-SYSTEM.md` (cited there). Nothing here has been applied; this is the change list.

## 0. The three global changes (do these first, everything else follows)

| # | Change | Where | Why |
|---|---|---|---|
| G1 | **Primary becomes yellow-on-black** (`--primary: 54 100% 56%` / `--primary-foreground: 0 0% 0%`), blue `#1a27c9` moves to `--accent` (stats/highlights only), black becomes `--secondary`. | `web/src/styles/index.css` `:root` → replace with `design-system/tokens.css` semantic block | The site's only CTA colour is `#ffe91e` with black text; blue appears once (counters). Current app has blue primary / yellow secondary — inverted relative to the website. |
| G2 | **Headings in Hepta Slab 800**, body Manrope 17px (`html{font-size:106.25%}` or keep 16px and scale), heading tracking `0.8px`, muted text `#7a7a7a`. Load `Hepta+Slab:wght@600;700;800`, `Manrope:wght@400;500;600;700;800`, `Questrial`, `Tajawal:wght@400;500;700;800` from Google Fonts in `web/index.html`. | `web/index.html`, `web/tailwind.config.js` (`fontFamily.display`), `index.css` `@layer base h1..h4` | Site headings are all slab; the app currently uses Manrope for everything. |
| G3 | **Radii**: buttons 8px (`--radius: 8px`), inputs 7px, cards/images/panels **15px**; **no card shadows** (shadow only on images `0 0 10px rgba(0,0,0,.2)` and dropdowns `0 4px 10px -2px rgba(0,0,0,.1)`). Replace `shadow-premium` usage on cards with `border` + `rounded-card`. | `tailwind.config.js` `borderRadius`, `boxShadow`; components below | Site is flat: rounded corners, 1px `#eaeaea` borders, overlays, almost no shadows. |

Secondary global notes: keep `darkMode: ['class']` off (site has no dark mode); add a `[data-surface="dark"]` scope (black bg, `#f2f2f2` text, yellow ring) for dark headers/heroes instead; drop the blue→yellow text/hover gradients and noise overlay from `AuthShell`/`LoginPage`/`ProgramsPage`/`NetworkShell` (none exist on the site).

---

## 1. `web/src/ui` primitives

### Button (`ui/Button.jsx`)
Site reference: section 5 of DESIGN-SYSTEM.md (one variant: yellow/black, radius 6–8, 12px 24px, grow on hover).
- `primary`: `bg-primary text-primary-foreground` now renders yellow/black (via G1). Add `font-bold` (site 700 on program CTAs, 600 header) instead of `font-medium`; `rounded-lg` (8px). Hover: site uses `scale(1.1)`; use `hover:brightness-95 hover:scale-[1.03] active:scale-100 transition duration-300` (keep `transition-transform`). Focus: `focus-visible:ring-2 ring-ring ring-offset-2` with `--ring` black.
- `secondary`: becomes **black/`#f2f2f2`** (`bg-secondary text-secondary-foreground hover:bg-black/85`) — the site's dark-surface look. Not yellow any more.
- `outline`: site has none; derive as `border-2 border-foreground text-foreground hover:bg-foreground hover:text-background` (black outline), radius 8.
- `ghost`: keep, but hover `hover:bg-surface` (`#f2f2f2`) instead of `hover:bg-accent` (accent is now blue).
- `destructive`: `#f56c6c` via `--destructive`; text white.
- `link`: site links hover **yellow** on black text: `text-foreground hover:text-primary underline-offset-4 hover:underline`.
- Sizes: `md` → `min-h-11 px-6 text-base` (site 44px / 12×24), `lg` → `min-h-12 px-6 text-lg font-bold` (program CTA 20px), `sm` → `min-h-9 px-4 text-sm` (header CTA 16px/600). Loader spinner colour inherits (black on yellow is fine).
- Disabled: site shows none; keep `opacity-50`.

### Field (`ui/Field.jsx`), SearchBar (`ui/SearchBar.jsx`), BilingualField, ImageField inputs
Site reference: section 7 (Fluent Forms on /contact/).
- Input: `rounded-input` (7px), `border border-input` (`#dadbdd`), `bg-[hsl(var(--input-background))]` (`#fafafa`), `px-[15px] py-[11px]` (≈ min-h-11 = 46px site), `text-base` 17px, `text-athar-grey-700`, `placeholder:text-athar-grey-500` (`#868e96`). Font stays Manrope (site uses system font in inputs — treat that as a Fluent default, not a design choice).
- Focus: `focus:bg-background focus:border-foreground focus:ring-2 focus:ring-ring/20` (black). Do **not** copy the site's `#1a7efb` focus (plugin default).
- Error: `border-destructive` (`#f56c6c`), message `text-xs text-destructive mt-1` (12px / 4px) — current Field already does this; only the colour token changes.
- Label: `text-base font-medium text-athar-ink` (17px/500/`#364151`); keep labels **visible** in the app (site hides them, which is an a11y regression we should not copy).
- Group gap: `space-y-5` (20px) in forms (`LoginPage`, `EntityForm`, `ProgramForm`).
- SearchBar: same input styles; icon `text-athar-grey-500`; keep `ps-9 pe-10` logical padding.
- Textarea: `min-h-[90px]`, `rows=4`.
- Checkbox/radio (`ProgramsPage` "show archived", `ColorSwatches`): no site pattern; use `accent-athar-yellow` is unreadable for a check mark → use `accent-black` (`accent-foreground`), 2px black border when custom.

### Badge (`ui/Badge.jsx`)
No badges on the site. Re-map `BADGE_TONES` onto the palette: `neutral: bg-surface text-foreground` (`#f2f2f2`), `blue: bg-accent/10 text-accent` (`#1a27c9`), `green: bg-success/10 text-success` (`#23a455`), `amber: bg-primary text-primary-foreground` (yellow/black — the brand "attention" tone), `red: bg-destructive/10 text-destructive`, `purple` → drop or map to `bg-athar-slate text-white`, `outline: border border-input text-muted-foreground`. Keep `rounded-full px-2 py-0.5 text-xs font-medium`.

### Toast (`ui/Toast.jsx`)
No toasts on the site. Make them read as site chrome: `rounded-card` (15px), `border`, **no `shadow-premium`** → `shadow-dropdown`, white bg, left 4px colour bar per tone (`border-s-4`): success `#23a455`, error `#f56c6c`, warning yellow `#ffe91e`, info `#0b75d9`. Icons from lucide stay (see Icons below). Text black 17px → `text-base`.

### Modal / ConfirmDialog (`ui/Modal.jsx`, `ui/ConfirmDialog.jsx`)
No modals on the site. Panel: `rounded-card` (15px; mobile sheet `rounded-t-[15px]`), `bg-card`, `shadow-dropdown` (drop `shadow-premium`), 1px `border`. Backdrop: `bg-black/70` (= site card overlay opacity). Title: `font-display font-extrabold text-2xl tracking-heading` (Hepta Slab 30px). Footer buttons: primary yellow + `outline` black. Keep `animate-in fade-in zoom-in-95`.

### States (`ui/States.jsx`)
`Loading`: spinner `text-foreground` (black) not `text-primary` (yellow spinner on white is low contrast). `Skeleton`: `bg-surface rounded-input`. `EmptyState`: `rounded-card border border-dashed border-input bg-surface/60`, title `font-display font-bold`. `ErrorState`: `border-destructive/40 bg-destructive/5`.

### Img (`ui/Img.jsx`)
Site images: radius 15px + `shadow-image` on content images, `cover` with black overlay for hero/cards. Add props/classes: default wrapper `rounded-card`, optional `shadow-image` when standalone (program photos), and an `overlay` prop (`after:absolute after:inset-0 after:bg-black/70`) for text-over-image cards. Keep aspect reservation; site photos are ~3:2 — default `aspect="3 / 2"` for content images, `16 / 9` for covers.

### Avatar (`ui/Avatar.jsx`)
No avatars on the site. Keep initials; ring `ring-2 ring-background` and text white; fallback colour palette should avoid pure yellow (unreadable initials) — see ColorSwatches.

### ColorSwatches (`ui/ColorSwatches.jsx`)
Brand palette options should become `['#000000','#1a27c9','#0b75d9','#23a455','#364151','#7a7a7a']` plus yellow `#ffe91e` only if the check mark switches to black on light swatches. Selected ring: `border-foreground` already; focus ring black.

### ExpandableText
"See more" toggle: `text-foreground hover:text-primary font-semibold` (site link behaviour) instead of `text-primary`.

### Icons (`ui/iconMap.jsx`, lucide everywhere)
Site icon set is Font Awesome 5 Free solid (50px yellow in icon boxes, 20px black in lists). The app uses lucide-react (MIT) — keep lucide for app chrome (lighter, consistent stroke) and use the 7 extracted FA SVGs (`design-system/icons/`) only where marketing parity matters (public landing pages / `PublicShell` hero icon boxes). Style rule for both: single colour, `currentColor`, yellow only on large decorative icons, black for functional icons. Add to `iconMap` the FA equivalents as lucide picks: users→`Users`, flask→`FlaskConical`, share→`Share2`, laptop-code→`Laptop`, envelope-open→`MailOpen`, phone-alt→`Phone`, search→`Search`.

---

## 2. Shells and pages

### AppShell (`app/shells/AppShell.jsx`) — staff header + nav
Site reference: section 10 desktop header. Header: `bg-background border-b border-border` (`#eaeaea`) — already a border, keep; height `h-20` (80px) on desktop / `h-[82px]` mobile; container `max-w-container-wide px-5` (1200 / 20px). Remove `backdrop-blur` and `bg-background/95` (site header is solid white). Replace `bg-muted/40` page background with plain white `bg-background` (site content sits on white; use `bg-surface-2` `#f8f8f8` only for CTA/summary bands). Main container `max-w-container` (1140) `px-4`.
- `shared/NavBar.jsx`: links `text-base text-foreground font-normal px-[17px]` (17px black), **hover `text-primary`** (yellow text, no background pill), active: `font-semibold border-b-2 border-primary` (derived from the submenu's 2px yellow border; the site has no active style). Drop `bg-accent` hover (accent is now blue).
- `shared/UserMenu.jsx`: trigger like a nav link; dropdown = site submenu: `w-60 bg-popover border-t-2 border-primary shadow-dropdown rounded-none` (or `rounded-b-input`), items `px-[17px] py-[15px] text-base`, hover `text-primary`. Role chips → Badge neutral.
- `shared/LanguageSwitch.jsx`: nav-link style; on dark tone `text-athar-grey-100 hover:text-primary`.
- "Skip to content" link: style as primary button.
- `shared/BrandMark.jsx`: replace the text+dot mark with the real logo `design-system/logo/Athar-Logo.png` (150×50, `alt="Athar"`); the `inverse` variant has no official asset — until one exists, render the PNG on a white rounded pill (`bg-white rounded-input px-2`) on dark headers, or keep the black wordmark only on white. Do **not** use blue text for the brand.

### FounderShell (`app/shells/FounderShell.jsx`) — mobile-first founder app
Header same as AppShell mobile (82px, logo 150px, white, bottom border). Bottom tab bar: `bg-background border-t border-border`; active tab `text-foreground font-semibold` with a 2px yellow top indicator (`before:bg-primary`) — yellow text on white fails contrast, so never colour the label yellow. Inactive `text-muted-foreground` (`#7a7a7a`). Page bg white.

### NetworkShell (`app/shells/NetworkShell.jsx`) — alumni/admin
Currently a blue→black gradient header. Site equivalent is the **black footer / dark hero** surface: `bg-athar-black text-athar-grey-100` (`data-surface="dark"`), no gradient, no noise. Nav links `text-athar-grey-100/80 hover:text-primary`, active `text-primary border-b-2 border-primary`. Yellow "primary" buttons work unchanged on black. The white `UserMenu` wrapper can go (menu trigger inherits light text).

### AuthShell + LoginPage (`app/shells/AuthShell.jsx`, `app/pages/LoginPage.jsx`)
Replace gradient + noise with the site **hero**: `bg-background bg-hero-pattern bg-cover` (pattern from `raw/images/Pattern-Gray-very-small.png`; copy to `web/public/` when applying — do not import from design-system) or plain white with a black hero band. Card: `bg-card rounded-card border shadow-dropdown p-6` (drop `shadow-premium`). Title: `font-display font-extrabold text-[35px] leading-none tracking-heading` black — remove the gradient text. Submit: full-width yellow button `size="lg"`. Error box: `bg-destructive/10 text-destructive rounded-input`.

### PublicShell (`app/shells/PublicShell.jsx`) — public forms/agenda/booking
This is the closest to the marketing site, so match it exactly: white header 80px with real logo + language switch, 1px `#eaeaea` border; remove the radial blue gradient; optional pattern hero band (`min-h-[300px]` with Hepta Slab 800 title 40–55px) above the content; content `max-w-container-narrow` (750) or 1140 for agendas; footer: black band, `#f2f2f2` 17px centred "© {year} Athar Accelerator". Public form pages reuse Field specs above inside a `bg-surface rounded-card p-[25px]` panel (contact-form card).

### FullBleedShell (`app/shells/FullBleedShell.jsx`) — canvas chrome
Thin header: same tokens as AppShell (white, border `#eaeaea`), back link `text-muted-foreground hover:text-primary`. Canvas background: `bg-surface-2` (`#f8f8f8`) with dot grid — keep neutral so yellow nodes/handles stand out.

### ProgramsPage (`app/pages/ProgramsPage.jsx`) — program cards
Site reference: program cards (section 8) + CTA band. Card: `rounded-card border border-border bg-card` (15px, no shadow); remove the gradient hover underline; hover `border-foreground/30` + `transition-colors duration-300`. Cover thumb: `rounded-input` → when a cover exists, offer the site look: image `cover` + `bg-black/70` overlay with the program name in `#f2f2f2` `font-bold text-xl tracking-heading` bottom-start (`justify-end`). Page title `h1`: `font-display font-extrabold text-[35px] leading-none tracking-heading`. Status pills → Badge tones (completed = green, archived = neutral, active = amber/yellow). Create button = yellow primary with `Plus` icon.

### ProgramPage / ProjectPage / NodePage headers, NodeFrame (`nodes/_kit/NodeFrame.jsx`)
Section container: `rounded-card border bg-card` (15px). Header row: title `font-display font-bold text-xl` (Hepta Slab 22px) or Manrope 700 22px tracking 0.8px (icon-box title); status chip "unsaved" = yellow Badge (`bg-primary text-primary-foreground`), "saved" = neutral. Save button yellow `size="sm"`. Body padding `p-[25px]` on ≥sm (site panel padding), `p-4` mobile.

### Canvas chrome (`app/canvas/NodeCard.jsx`, `ToolSidebar.jsx`, `NodeInspector.jsx`)
- NodeCard: `rounded-input` (7–8px, keep small for density) `border-2 border-border bg-card`, selected `border-foreground` (black) instead of blue, `shadow-dropdown` when selected; flash `ring-2 ring-primary` (yellow) is already on-brand. Icon colour `text-foreground` (black) not blue; system nodes `bg-surface`. Port handle colours (`familyColor`) should come from the palette: `#1a27c9`, `#0b75d9`, `#23a455`, `#ffe91e`, `#7a7a7a`, `#0f172a`.
- ToolSidebar: `bg-background border-e border-border`; group labels `text-xs font-semibold uppercase tracking-wide text-muted-foreground` is fine (site has no uppercase, but sidebars need it); tool rows `rounded-input border bg-card hover:border-foreground/40`; "+" hover `text-foreground` not blue.
- NodeInspector: panel `bg-background border-s border-border`, section titles Manrope 700 17px, inputs per Field.

### EntityCard / EntityGrid / EntityManager (`shared/entities/*`)
Card: `rounded-card border bg-card` (15px), **remove `shadow-sm`**; the `accent` top border stays (4px) but default accent is yellow. Image: `rounded-t-card`, people photos `aspect 4/3 cover`, company logos `contain` on white `p-3` (same as the site's partner logo cells, 25px padding at larger sizes). Title `font-bold text-lg leading-snug` (Manrope 700 — site card titles are Manrope, not slab); subtitle `text-accent` (`#1a27c9`, the one legit use of blue for emphasis) or `text-foreground font-semibold`; organisation `text-muted-foreground`. Link icons `text-muted-foreground hover:text-primary`. Actions row `border-t border-border`.
- EntityForm / ItemEditor / ImportItemsModal: Field + Button rules; dialogs per Modal.

### Lists, tables, forms inside nodes (`nodes/*`)
Table header: `bg-surface text-athar-ink text-sm font-semibold` (`#f2f2f2` / `#364151`), rows `border-b border-border`, hover `bg-surface-2`. Row actions ghost buttons. Public form portal (`nodes/form-builder` view, `PublicListPage`): form card `bg-surface rounded-card p-[25px]`, fields 20px apart, submit full-width yellow `rounded-sm` (6px) 45px — exactly the contact form.

### Landing-page node (`nodes/landing-page`)
Use the site's section recipe directly: hero (pattern or photo + `bg-black/80` overlay, Hepta Slab 800 55–70px `#f2f2f2`/black, lead 18/22, yellow button), 3-column icon boxes (50px yellow icon, 22px/700 title, Questrial 17/22), `#f8f8f8` CTA band (40px/700 title left, yellow button right), black footer. Containers `max-w-container` (1140), vertical rhythm 100px / 50px / 25px.

---

## 3. RTL / Arabic typography guidance (site has none; platform rules)
- Direction already comes from `html[dir]`; keep logical utilities (`ps-/pe-/start-/end-`) which the components already use.
- Fonts: `html[lang='ar'] body { font-family: Tajawal, Manrope }` exists; add `html[lang='ar'] .font-display { font-family: Tajawal, 'Noto Kufi Arabic' }` and `font-weight: 800` so Arabic headings carry the same weight as Hepta Slab 800. Do not fall back to Hepta Slab for Arabic glyphs (it has none → browser default serif).
- Tracking: `letter-spacing: 0` for any Arabic text (the 0.8px / 4px heading tracking breaks Arabic joining) — `tokens.css` does this under `:lang(ar)`.
- Line-height: headings ≥ 1.25 (slab headings use 1.0 in Latin; Arabic ascenders/descenders clip), body 1.8.
- Sizes: Tajawal renders ~8 % smaller than Manrope at equal px; bump Arabic body to 18px and headings +2px, or set `font-size-adjust` where supported.
- Numerals: keep Western digits for stats/IDs (site counters "+300"); format with `Intl.NumberFormat(lang)` only where the dictionary already does.
- Icons that imply direction (back arrows, chevrons, "share") flip with `rtl:-scale-x-100` (already used in `FullBleedShell`); FA `share` arrow is directional.
- Bilingual fields (`BilingualField`): Arabic input `dir="rtl" lang="ar"` already; apply the Arabic font per input via `lang` (`:lang(ar)` in tokens.css covers it).
- Mixed-script buttons/nav: keep Manrope for Latin words inside Arabic UI via `font-feature-settings` fallback chain (`Tajawal, Manrope` already orders Arabic first; Tajawal's Latin is acceptable for short labels).

## 4. Order of work (recommended)
1. Merge `tokens.css` `:root` into `web/src/styles/index.css` and `tailwind.tokens.js` into `web/tailwind.config.js` (G1–G3); add the font `<link>` to `web/index.html`; copy `logo/Athar-Logo.png` and `raw/images/Pattern-Gray-very-small.png` into `web/public/brand/`.
2. Update `ui/Button.jsx`, `ui/Field.jsx`, `ui/Badge.jsx`, `ui/Modal.jsx`, `ui/Toast.jsx`, `ui/States.jsx` (one PR; snapshot the storybook-less pages manually).
3. Shells: `BrandMark`, `NavBar`, `UserMenu`, then `AppShell`, `PublicShell`, `AuthShell`/`LoginPage`, `FounderShell`, `NetworkShell`, `FullBleedShell`.
4. Pages/cards: `ProgramsPage`, `EntityCard`, `NodeFrame`, canvas chrome.
5. Arabic pass: `:lang(ar)` overrides, heading font, tracking 0, visual QA on `?lang=ar`.
