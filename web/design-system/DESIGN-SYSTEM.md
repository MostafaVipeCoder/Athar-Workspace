# Athar design system — extracted from www.athareg.com

Extracted 2026-10-12 from the live public site (WordPress 6.6.5, Astra theme 4.8.1, Elementor 3.24.2, Essential Addons, Premium Addons gallery, Fluent Forms). Pages inspected:

| Page | URL | Elementor page id |
|---|---|---|
| Home | https://www.athareg.com/ | 1932 |
| Startup Bootcamp | https://www.athareg.com/startup-bootcamp/ | 2323 |
| Startup Incubator | https://www.athareg.com/startup-incubator/ | 2355 |
| Tech Accelerator | https://www.athareg.com/tech-accelerator-2/ | 1952 |
| Climate Action Accelerator | https://www.athareg.com/climate-action-accelerator/ | 2363 |
| On-Demand Consultation | https://www.athareg.com/on-demand-consultation/ | 2368 |
| Digital Skills | https://www.athareg.com/digital-skills/ | 2373 |
| Contact | https://www.athareg.com/contact/ | 2263 |

Method: HTML of all 8 pages fetched with curl; every stylesheet downloaded (`raw/css/`), Elementor per-page rules split into `raw/css/pages/elementor-<id>.css`, Elementor global kit (`elementor-kit-332`) and the Astra inline theme CSS (`raw/css/astra-theme-inline.css`) extracted; computed styles read in the browser with `getComputedStyle` at 1280 px and 375 px; screenshots in `raw/screenshots/`. Every value below cites where it came from. Items marked **[uncertain]** could not be fully verified.

Headline finding: **the live site is black + yellow, not blue.** The "Athar Blue" `#1a27c9` from `athar-branding.md` exists in the Elementor kit as a custom colour (`--e-global-color-211eb06`) and is used in exactly one place on the whole site: the statistic counters on the yellow mission band of the homepage. Everything else (CTAs, hover, accents, mobile toggle, submenu border, mission band) is yellow `#ffe91e` on black/white. The platform's current tokens (blue primary) therefore do not match the website; see `components-map.md`.

---

## 1. Colour palette

### 1.1 Global palette (Astra "Global Colors", mirrored into Elementor as `--e-global-color-astglobalcolorN`)
Source: inline `<style id='astra-theme-css-inline-css'>` on every page, e.g. https://www.athareg.com/ (`:root{--ast-global-color-0:#000000; ...}`).

| Token | Hex | RGB | Role on the site |
|---|---|---|---|
| `ast-0` **Black** | `#000000` | 0 0 0 | Headings, all Elementor paragraph text, hero/card overlays, footer background, mobile hamburger glyph |
| `ast-1` **Yellow** (brand accent, de-facto primary) | `#ffe91e` | 255 233 30 | All CTA buttons, header "Apply Now", link hover, submenu top border, mission band background, mobile menu toggle, form submit, newsletter paragraph on dark |
| `ast-2` Slate | `#0f172a` | 15 23 42 | Text/fill of the homepage hero "Apply Now" buttons only (`post-1932.css` element 814332e) |
| `ast-3` Body grey | `#364151` | 54 65 81 | Astra default body/label colour (`body{color:var(--ast-global-color-3)}`); used by form labels and anything not overridden by Elementor |
| `ast-4` Light grey | `#f2f2f2` | 242 242 242 | Light text on dark heroes & program cards, contact form card background, footer text |
| `ast-5` White | `#ffffff` | 255 255 255 | Page background, header, submenu, mobile menu |
| `ast-6` | `#d1dae5` | 209 218 229 | Defined, not used on inspected pages **[uncertain role; Astra default "border"]** |
| `ast-7` | `#070614` | 7 6 20 | Defined, not used on inspected pages |
| `ast-8` | `#222222` | 34 34 34 | Defined, not used on inspected pages |

### 1.2 Elementor kit colours (`.elementor-kit-332`, from `raw/css/pages/elementor-kit-332.css`, served inside the Hummingbird bundle `wp-content/uploads/hummingbird-assets/0951a0b5...css` on https://www.athareg.com/)

| Kit name | Hex | Used where |
|---|---|---|
| Primary | `#FFE92C` | Icon-box icons on program pages (computed `rgb(255,233,44)`). Note: 10 units lighter than `ast-1`; both yellows coexist. |
| Secondary | `#0B68BA` | Not seen on inspected pages |
| Text | `#7A7A7A` | Questrial paragraphs on the contact page (`rgb(122,122,122)`) = **muted text** |
| Accent | `#45E59D` | Elementor default `.elementor-button:hover` background (never visible: all site buttons override bg) |
| Custom `211eb06` **Athar Blue** | `#1A27C9` | Homepage counters (number + label) on the yellow band — the only blue on the site |
| Custom others | `#4054B2`, `#23A455`, `#1A1A1A`, `#FBED21`, `#E7E1E1`, `#0B75D9`, `#00FFAD`, `#FCF020`, `#1D1D1B` | Defined, unused on inspected pages |

### 1.3 Theme/plugin defaults that leak through (not brand decisions, but what users actually see)
| Value | Where | Source |
|---|---|---|
| Link `#0b75d9` | Astra default `a{color:#0b75d9}`; links inside Elementor text blocks inherit black instead | astra-theme-inline.css |
| Link hover `#ffe91e` | `a:hover,a:focus{color:var(--ast-global-color-1)}` (so nav links hover yellow) | astra-theme-inline.css |
| Header bottom border `#eaeaea` 1px | `.ast-primary-header-bar{border-bottom:1px solid #eaeaea}` | astra-theme-inline.css |
| Section grey `#f8f8f8` | CTA band on every program page (`background-color:#f8f8f8`) | elementor-2323.css etc. |
| Input bg `#fafafa`, border `#dadbdd`, text `#606266`, placeholder `#868e96` | Fluent Forms defaults (`--fluentform-border-color:#dadbdd`) | computed on /contact/ |
| Input focus border `#1a7efb` | `--fluentform-primary` (Fluent default, **not brand**) | computed on /contact/ |
| Error `#f56c6c` | `--fluentform-danger` | computed on /contact/ |
| Success / warning / info | **Not present anywhere on the site.** Fluent defaults are not customised; no toast/alert patterns exist. |

### 1.4 Overlays and gradients
- Image overlay: `::before{background-color:#000}` with `--overlay-opacity:0.7` on program cards (home) and contact hero; `0.8` on program-page heroes (`raw/css/pages/elementor-1932.css`, `elementor-2323.css`, computed `rgb(0,0,0)` opacity `0.7/0.8`).
- Six containers use `linear-gradient(180deg,#000 0%,#000 100%)` as overlay (i.e. solid black, same effect).
- **No colour gradients** (no blue→yellow) anywhere on the site. The gradients in `athar-branding.md` are an internal invention, not website usage.
- Hero background: light-grey geometric circle pattern image `Pattern-Gray-very-small.png` (saved to `raw/images/`), `background-size:cover` on white. Pattern colour measured visually ≈ `#f2f2f2` circles on `#ffffff` **[uncertain: sampled from screenshot]**.

### 1.5 Dark / light usage
There is no dark mode. "Dark" surfaces on the site are: black footer, black-overlaid photo heroes, black-overlaid program cards. On those surfaces text is `#f2f2f2` (not pure white) and accents are yellow `#ffe91e`. Recommended dark-surface rule: bg `#000`, text `#f2f2f2`, accent `#ffe91e`, muted `#7a7a7a`.

---

## 2. Typography

### 2.1 Families (Google Fonts, loaded via `fonts.googleapis.com` on every page; see `raw/fonts/google-fonts.css`)
| Role | Family | Weights loaded | Licence |
|---|---|---|---|
| Display / headings | **Hepta Slab** (slab serif) | 100–900 (site uses 600 default, **800** everywhere visible) | SIL OFL 1.1 |
| Body / UI | **Manrope** (geometric sans) | 100–900 (site uses 400, 500, 600, 700) | SIL OFL 1.1 |
| Secondary body | **Questrial** (single weight 400) | 400 | SIL OFL 1.1 |
| One-off | Roboto 500 | hero "Apply Now" buttons on home only | Apache 2.0 / OFL |

Kit typography (`elementor-kit-332`): primary = Hepta Slab 50px bold ls 0.8px word-spacing 0.1em; secondary = Hepta Slab 32px bold; text = Questrial 400 lh 22px; accent = Hepta Slab 18px 600. Page-level styles override these with the sizes below.

Astra base: `html{font-size:106.25%}` → **17px** root. `body{font-family:'Manrope';font-weight:400;font-size:17px;line-height:1.857 (31.57px);color:#364151}`.

### 2.2 Type scale as actually rendered (computed at 1280 px; mobile at 375 px)
| Style | Family / weight | Desktop | Tablet (≤1024) | Mobile (≤767) | Line-height | Letter-spacing | Colour | Source |
|---|---|---|---|---|---|---|---|---|
| Hero H1 (home) | Hepta Slab 800 | 70px | — | 42px | 1.5em (105px / 63px) | 0.8px | `#000` | 1932 dd897f2, computed |
| Page hero title (programs) | Hepta Slab 800 | 65px (renders 55px at 1280 via tablet rule) | 55px | 40px | 1 | 0.8px | `#f2f2f2` on black overlay | 2323 8ad1bef |
| "Let's Talk!" display | Hepta Slab 800 | 100px → computed 80px | — | — | 1.2em | 4px | `#f2f2f2` | 1932 |
| Section H2 (home: "Our Programs", "Our Partners") | Hepta Slab 800 | 55px | — | — | 1 | 0.8px | `#000` | 1932 c5bb539 |
| Contact page H1 | Hepta Slab 800 | 50px | | | 1 | 0.8px | `#f2f2f2` | 2263 7cf6a3a |
| Contact "Let's Talk!" | Hepta Slab 800 | 45px | | | 1 | 0.8px | `#000` | 2263 858aaf0 |
| Mission band H2 | Hepta Slab 800 | 40px | | | 1.5 (60px) | 0.8px | `#000` on yellow | 1932, computed |
| Program subsection H2 ("What to expect!") | Hepta Slab 800 | 35px | 30px | 30px | 1 | 0.8px | `#000` | 2323 187d3fb |
| Program card title (home) | Manrope 700 | 45px | | 45px | 1.5 (67.5px) | 0.8px | `#f2f2f2` | 1932, computed |
| CTA band title / intro H2 | Manrope 700 | 40px | 35px | 30px | 1.5em | 0.8px | `#000` | 2323 41dfc30 |
| Contact sub-headings ("Our Office") | Manrope 700 | 30px | | | 1 | 0.8px | `#000` | 2263 |
| Icon-box title | Manrope 700 | 22px | | | 1.5em | 0.8px, word-spacing 0.1em | `#000` | 2323 0c5f800 |
| Counter number | Manrope 700 | 70px (computed 42px: tablet rule wins at 1280) | 42px | | 1 | 0.8px | `#1a27c9` | 1932 5f23b79 |
| Counter label | Manrope 700 | 18px (computed 16px) | 16px | | 40px | — | `#1a27c9` | 1932 |
| Lead paragraph (hero) | Manrope 400 | 18px | | 18px | 22px | — | `#000` | 1932 2a353ad |
| Program body paragraph | Manrope 400 | 18px | | | 1.6em (28.8px) | — | `#000` | 2323 4bddb36 |
| Secondary paragraph | Questrial 400 | 17–18px | | | 22px (1.5em in places) | — | `#000` / `#7a7a7a` | 2323 547db7a, 2263 94a4cf2 |
| Icon-box description | Questrial 400 | 17px | | | 22px | — | `#000` | 2323 |
| Nav link | Manrope 400 | 17px | | 17px | 80px (bar height) | — | `#000` | computed header |
| Body default (Astra) | Manrope 400 | 17px | | | 1.857 | — | `#364151` | astra inline |
| Footer copyright | Manrope 400 | 17px | | | 1.857 | — | `#f2f2f2` | computed |
| Form label (hidden on site) | Manrope 500 | 17px | | | inherit | — | `#364151` | computed /contact/ |
| Astra fallback headings (non-Elementor content) | Hepta Slab 600 | h1 40 / h2 32 / h3 26 / h4 24 / h5 20 / h6 16 | h1 30 / h2 25 / h3 20 (≤768) | same | 1.4 / 1.3 / 1.3 / 1.2 / 1.2 / 1.25 | — | `#364151` | astra inline |
| Elementor kit h3 | Hepta Slab 700 | 18px | | | | | | kit-332 |

Observations: headings are **tight** (line-height 1 on 35–55px slab headings), hero copy is **loose** (1.5). Letter-spacing `0.8px` is applied to nearly every heading and should become a token. No `text-transform:uppercase` anywhere.

### 2.3 Arabic typography
The site is **English only** (`<html lang="en">` on all 8 pages, zero Arabic characters). No Arabic font is loaded, so the website gives no guidance. Recommendation for the platform **[uncertain, design decision]**: keep **Tajawal** (already in `web/tailwind.config.js`) for Arabic body at 400/500/700, and use **Tajawal 800** or **Noto Kufi Arabic 700–800** for Arabic headings in place of Hepta Slab (there is no Arabic slab that pairs well). Reduce Arabic heading letter-spacing to `0` (never apply the 0.8px tracking to Arabic script) and raise Arabic line-height to ≥1.3 on headings and ≥1.7 on body.

---

## 3. Spacing, layout, breakpoints

Source: `astra-theme-inline.css` (`--ast-container-width:1200px`, `--ast-normal-container-width:1200px`, `--ast-narrow-container-width:750px`) and Elementor rules (`--content-width:1140px` on every `.e-con.e-parent`), computed `containerWidth = 1140px / 1265 viewport`.

| Token | Value | Source |
|---|---|---|
| Content container | **1140px** max, centred; outer sections are full-bleed with `padding:0 10px` | Elementor `--container-max-width:1140px`, computed |
| Astra container | 1200px (header uses it; header bar padding 20px left/right) | astra inline |
| Narrow container | 750px | astra inline |
| Header height | 80px min (`min-height:80px`), renders 85px with border; 82px on mobile | astra inline, computed |
| Logo | 150×50 px (source PNG 180×60) | `header .custom-logo-link img{max-width:150px;width:150px}` |
| Section vertical padding | hero 50px top/bottom (min-height 650px); "Our Programs" 35/25px (min-height 260); contact rows 100px top / 100px bottom; program intro `margin-top:60px`; icon grid `margin-bottom:80px`; two-column rows `margin:100px 0` | elementor-1932 / 2263 / 2323 |
| Section gaps | `--gap:0px 0px` on most rows (spacing done with inner padding), `0px 30px` on a few | per-page css |
| Card inner padding | 10px (program cards), 25px (contact form card, partner logo cell) | computed |
| Two-column split | 50% / 50% (contact, program intro), 60% / 40% (program "what to expect") | `--width:50%`, `--width:60%` |
| Grid | icon boxes `repeat(3,1fr)` → `repeat(1,1fr)` on mobile; secondary grids `repeat(2,1fr)` → 1 | elementor-2323 6a961e7 / 6574aca |
| Form field gap | 20px between groups | computed `.ff-el-group{margin-bottom:20px}` |
| Icon-box icon gap | 15px (`--icon-box-icon-margin`) | elementor-2323 |
| Footer padding | 20px top/bottom, row padding 35px sides | astra inline |

Breakpoints:
| Name | Value | Source |
|---|---|---|
| Elementor mobile | ≤ 767px | Elementor defaults (per-page `@media(max-width:767px)` rules) |
| Elementor tablet | ≤ 1024px | Elementor defaults (the tablet rules are what you actually see at 1280 for some headings: `font-size:55px` instead of 65px — check the raw files before copying a desktop value) |
| Astra header break (hamburger) | ≤ 921px | Astra default; body gets `ast-header-break-point` at 375 (verified) **[921 is Astra default, not read from CSS]** |
| Astra typography steps | ≤ 768px and ≤ 544px | astra inline |
| Astra wide | ≥ 1201px | astra inline |

---

## 4. Radii, shadows, borders

| Token | Value | Where | Source |
|---|---|---|---|
| `radius-card` | **15px** | program cards, contact form card, program-page images, every `--border-radius` on containers (13 occurrences) | per-page css |
| `radius-button-lg` | **8px** | program-page "Apply Now", header "Apply Now" | 2323 db11505, astra `.ast-custom-button` |
| `radius-button` | **6px** | homepage hero buttons, contact submit | 1932 814332e, computed |
| `radius-input` | **7px** | Fluent inputs (`--fluentform-border-radius:7px`), newsletter submit | computed |
| `radius-sm` | 5px | mobile menu toggle | astra inline |
| `radius-xs` | 3px / 2px | Astra default button / search toggle (not visible) | astra inline |
| `shadow-image` | `0 0 10px 0 rgba(0,0,0,.2)` | program-page images (`img{border-radius:15px;box-shadow:...}`) | 2323 18d413e, 2368 62d22f5d |
| `shadow-dropdown` | `0 4px 10px -2px rgba(0,0,0,.1)` | header submenu | computed |
| Cards / buttons | **no shadow** | | computed |
| `border-header` | 1px solid `#eaeaea` bottom | header bar | astra inline |
| `border-submenu` | 2px solid `#ffe91e` top | desktop dropdown | astra inline `.ast-builder-menu-1 .sub-menu{border-top-width:2px;border-color:var(--ast-global-color-1)}` |
| `border-input` | 1px solid `#dadbdd` | inputs | computed |
| `border-footer` | 1px solid `#000` top (invisible on black) | footer | astra inline |
| Focus (Astra default) | `outline:thin dotted inherit` on links/buttons; inputs `border:thin dotted` | astra inline | theme default, **not a brand decision** |

---

## 5. Buttons

All real buttons on the site are **one variant: solid yellow, dark text, no border, no shadow**. There is no secondary / outline / ghost / link button pattern on the site. Sizes and exact CSS:

| Instance | Font | Colour | Background | Radius | Padding | Height | Hover / active | Source |
|---|---|---|---|---|---|---|---|---|
| Hero "Apply Now" (home ×2) | Roboto 500 18px, lh 1 | `#0f172a` | `#ffe91e` | 6px | 12px 24px | 42px | `transform:scale(1.1)`, `transition:transform .3s` (`.elementor-animation-grow`), on `:hover,:focus,:active` | post-1932.css 814332e, computed |
| Program "Apply Now" (6 program pages) | Manrope 700 20px, lh 1 | `#000` | `#ffe91e` | 8px | 12px 24px | 44px | same grow animation | elementor-2323 db11505, computed |
| Header "Apply Now" (Astra button) | Manrope 600 16px | `#000` | `#ffe91e` | 8px | 10px 20px | ~50px | Astra default hover (rule truncated in source) **[uncertain: likely same colours]** | astra inline `.ast-custom-button`, computed |
| Contact "Submit Form" (`ff-btn-lg`) | Manrope 500 18px, lh 1.5 | `#040404` | `#ffe91e` | 6px | 8px 16px | 45px, `width:100%` | `transition` none set; Fluent default hover darkens **[uncertain]** | computed /contact/, `fluentform_custom_css_4` |
| Newsletter "Subscribe" (home, `ff-btn-md`) | Manrope 500 16px, lh 1.5 | `#000` | `#ffe91e` | 7px | 8px 20px | 42px, full width | | computed / |
| Mobile menu toggle | icon 24px | `#000` | `#ffe91e` | 5px | ~11.6px | 43×43px | | computed at 375 |

Elementor base button (applies under the overrides): `.elementor-button{display:inline-flex;align-items:center;line-height:1;font-size:15px;padding:12px 24px;border-radius:3px;transition:all .3s;text-align:center}`; `.elementor-size-sm` is the size used. Icon placement: no icons inside buttons on the site. Disabled state: none observed (no disabled buttons rendered).

Recommended normalised button spec for the platform (derived, see components-map): Manrope 600–700, 16–18px, `#000` on `#ffe91e`, radius 8px, padding 12px 24px, min-height 44px, hover `scale(1.03)` + `brightness(.95)` (toned down from the site's 1.1 grow which is too much for dense app UI), focus ring 2px `#000` offset 2px.

---

## 6. Links
- Astra default `a{color:#0b75d9}`, `a:hover,a:focus{color:#ffe91e}` (astra inline). Visible effect: nav links are black and turn yellow on hover; underline none.
- Inside Elementor text blocks links inherit the paragraph colour (black) — no distinct link style on content pages.
- Footer has no links. Contact "Hello@athareg.com" / phone are plain text in an icon list (black, 18px Manrope, 20px FA icons).

## 7. Form controls (contact page, Fluent Forms id 4)
Source: computed styles on https://www.athareg.com/contact/ and `raw/css/pages/elementor-2263.css`.

| Part | Spec |
|---|---|
| Wrapper card | bg `#f2f2f2`, radius 15px, padding 25px, 50% column |
| Layout | First/Last name on one row (two 215px inputs), then Email, Subject, Message full width; groups 20px apart |
| Label | **visually hidden** (`ff-el-form-hide_label`); placeholder carries the label text. Label style if shown: Manrope 500 17px `#364151` |
| Input / textarea | bg `#fafafa`, 1px solid `#dadbdd`, radius 7px, padding 11px 15px, font `system-ui` 17px (NOT brand font), lh 1, colour `#606266`, placeholder `#868e96`, height 46px; textarea `rows=4`, min-height 90px, resizable |
| Focus | border `#1a7efb`, bg `#fff`, no outline, transition `border-color .15s, box-shadow .15s` (Fluent default; in practice the browser outline is `none`) |
| Invalid | `.ff-el-is-error .ff-el-form-control{border-color:#f56c6c}`, message `.text-danger` 12px, 4px below |
| Checkbox / radio / select | **not present** on the site. Astra defaults: checked `background:#0b75d9` (`input[type=checkbox]:checked{border-color:#0b75d9;background-color:#0b75d9}`) — not brand. |
| Submit | see buttons: full-width yellow, 45px, radius 6 |

## 8. Cards

**Program card (home, 6 of them in a 2-column grid):** `.e-con.e-child` 470×400px, `background-image` photo `cover`, `::before` overlay black 0.7, `--border-radius:15px`, padding 10px, flex column `justify-content:flex-end` (title sits bottom-left), title Manrope 700 45px lh 1.5 `#f2f2f2` wrapped in a link to the program page. No hover state (only `--background-transition:0.3s`). On mobile the card is 355px wide × 400px tall, one column. (Source: elementor-1932 e80c552 / 47001c4 / 9148f25 / b24b965 / 6a78908 / 9d3a104; computed.)

**Contact form card:** `#f2f2f2`, radius 15, padding 25 (elementor-2263 9376e47).

**Partner logo cell (Premium Gallery, "Our Partners"):** white, padding 25px, 4 columns (`premium_gallery_image_cell:4`), full-colour PNG logos, no filter, no radius, no hover overlay (`overlay:false`, `light_box:yes`). ~24 logos.

**Icon box (program pages, 3-column):** centred, FA solid icon 50px `#ffe92c`, 15px gap, title Manrope 700 22px, description Questrial 17/22 black. No background, no border.

**Images:** program-page photos radius 15px + shadow `0 0 10px rgba(0,0,0,.2)`, 465×310 (3:2-ish, `object-fit:fill` i.e. natural ratio). Hero backgrounds `cover`, `center center`, overlay black .8. Partner logos natural ratio.

## 9. Badges / tags
None on the site.

## 10. Navigation

**Desktop header** (Astra header builder, computed at 1280): white bar, 85px, 1px `#eaeaea` bottom border, 20px side padding, container 1200. Left: logo 150×50. Right: menu `Home | Programs ▾ | Contact` — Manrope 400 17px black, `padding:0 17px`, line-height 80px, hover yellow; then yellow "Apply Now" button (Manrope 600 16px, radius 8, 10px 20px). Dropdown "Programs": white, 240px wide, 2px yellow top border, shadow `0 4px 10px -2px rgba(0,0,0,.1)`, items 17px black `padding:15.3px 17px` (55px rows), 6 items (Startup Bootcamp, Startup Incubator, Tech Accelerator, Climate Action Accelerator, On-Demand Consultation, Digital Skills).

**Mobile header** (375px, screenshot `raw/screenshots/home-mobile-menu-open-375.jpg`): logo left (150px), yellow 43×43 toggle radius 5 with black hamburger/close SVG right (Astra inline SVGs). Menu opens **inline below the header** (not a drawer): white bg, items `Home / Programs ▾ / Contact` 17px black, ~75px rows, chevron for the submenu, no "Apply Now" in the mobile menu. Hero starts right under it.

**Footer:** single "below footer" row, bg `#000`, 1px black top border, padding 20px 35px, min-height 50 (renders 73px), centred text `Copyright © 2026 | Athar Accelerator` Manrope 17px `#f2f2f2`. No columns, no links, no social icons.

## 11. Hero sections
- **Home:** pattern background (`Pattern-Gray-very-small.png`, cover), min-height 650, content centred, padding 50px; H1 Hepta Slab 800 70px/1.5 black → 42px mobile; lead Manrope 18/22 black; yellow button; no image. Entrance `fadeInUp`.
- **Program pages:** photo (`business-people-are-brainstorming-small.jpg`) cover + black .8 overlay, min-height 400, centred H1 Hepta Slab 800 65→55→40 `#f2f2f2`.
- **Contact:** same photo, overlay .7, min-height 300, H1 50px `#f2f2f2`.
- **"Let's Talk!" band (home):** `LETS-TALK.png` artwork as background (top centre, cover, min-height 800) with Hepta Slab 80px ls 4px `#f2f2f2` heading, yellow paragraph 18/22, and the newsletter form on the right.

## 12. Section headers & dividers
Section headers are a single centred Hepta Slab 800 heading (55px home, 35px program pages) followed by content; a Questrial 18/22 centred subline on "Who Should Apply?". No eyebrow labels, no underline accents, no dividers anywhere (the only "rule" is the 1px header border).

## 13. Mission / stats band (home)
Full-width `#ffe91e` section, 843px tall: left column Hepta Slab 800 40px/60px black heading "We are on a mission to unlock potential!", right column 2×2 counters in `#1a27c9` (Manrope 700, number 42px, label 16px/40px) — "+300 Startup Founders, +1200 Digital Talents, +900 Jobs Created, +10000 Community Members". Above it, a photo container with black .7 overlay (min-height 800). This is the single place blue is used.

## 14. CTA band (program pages)
`#f8f8f8` full-width, 165px: left Manrope 700 40→35→30 heading ("We are on a mission to unlock your startup potential"), right yellow "Apply Now" (Manrope 700 20px, radius 8).

## 15. Motion
| Effect | Spec | Source |
|---|---|---|
| Entrance | Elementor `fadeInUp` (animate.css keyframes: translate3d(0,100%,0)→0, opacity 0→1), Elementor default duration 1.25s **[uncertain: default, not overridden]**, triggered on scroll (`elementor-invisible` until in view) | `data-settings="{"_animation":"fadeInUp"}"` on headings/text |
| Button hover | `scale(1.1)`, `transition: transform .3s` | `.elementor-animation-grow` |
| Container bg/border | `--background-transition:0.3s; --border-transition:0.3s` | every container |
| Icon list colour | `transition: color .3s` / `fill .3s` | elementor-2263 |
| Elementor button | `transition:all .3s` | base |
| Inputs | `border-color .15s ease-in-out, box-shadow .15s ease-in-out` | Fluent |
| Search slide | `.2s` | Astra |

Easing is browser default (`ease`) everywhere; no custom cubic-beziers on the site.

## 16. Iconography
- Icon set: **Font Awesome 5 Free 5.15.3** (solid + regular), shipped by Elementor (`/wp-content/plugins/elementor/assets/lib/font-awesome/`), licence Icons CC BY 4.0 / Fonts SIL OFL 1.1 / Code MIT. Also Elementor `eicons` and Astra inline SVGs (menu, close, dropdown arrow) for chrome only.
- Icons actually used (class → where): `fas fa-users` (Committed Team), `fas fa-flask` (Stage of Development), `fas fa-share` (Participation in the Program), `fas fa-laptop-code` (Digital Skills / tech pages), `far fa-envelope-open` (contact email), `fas fa-phone-alt` (contact phone), `fas fa-search` (Astra search icon, hidden). All extracted as SVG into `web/design-system/icons/` (see its README).
- Usage style: single colour, yellow `#ffe92c` at 50px in icon boxes; black 20px in icon lists. No outlined/duotone icons, no icon backgrounds or circles.
- Astra chrome SVGs: hamburger (3 bars, 24px), close (X, 24px), submenu arrow (26×16 chevron) — inline in HTML, `fill:currentColor`.

## 17. Illustration & imagery
- Photography: real workshop/co-working photos (people at laptops, sticky-note planning, event audience), warm, candid, always behind a 70–80 % black overlay when text sits on top; otherwise shown as rounded (15px) shadowed images beside text.
- One abstract brand graphic: geometric quarter/half-circle pattern in light grey (hero), and the "LETS-TALK.png" artwork (yellow/black, 3008×2008, 2 MB, not stored — see raw/README).
- Partner logos shown in full colour on white.
- No illustrations, no 3D, no icons-as-illustration.

## 18. Logo
- File: `Athar-Logo.png` 180×60 (header serves `Athar-Logo-150x50.png`). Both saved in `web/design-system/logo/`. **No SVG exists on the site** (searched all 8 pages and uploads references). Favicon `cropped-site-icon-270x270.png` also saved.
- Appearance: lowercase wordmark **"athar"** in a heavy geometric sans (custom lettering, black `#000`), with a **yellow dot (`#ffe91e`) floating above the "h"** (replacing the ascender's top, reads like a sun/idea). Single variant only (black on white). On dark backgrounds the site never shows the logo (footer has text only) — a white-text variant would need to be created **[uncertain]**.
- Clear space: not documented on site; recommend ≥ the dot diameter (≈ 1/5 of the wordmark height) on all sides; minimum width 100px (dot stays visible).

---

## 19. What could not be determined
- Hover colour of the Astra header button (rule truncated in minified source; visually unchanged in a quick check).
- Exact animate.css durations (Elementor default assumed).
- Pattern image exact greys (sampled).
- Any Arabic typography (site has none).
- Any success/warning/info semantics, badges, tabs, tables, modals, toasts — none exist on the marketing site; the platform must invent them inside the palette (see components-map.md for the proposed derived tones).
