# Extracted icons

Source: Font Awesome Free **5.15.3** as shipped by Elementor on https://www.athareg.com/ (`/wp-content/plugins/elementor/assets/lib/font-awesome/webfonts/fa-solid-900.svg` and `fa-regular-400.svg`, fetched 2026-10-12). Glyphs were pulled from the SVG fonts by `glyph-name` and written as standalone SVGs (`viewBox 0 0 <advance> 512`, path flipped with `translate(0,448) scale(1,-1)` to convert font coordinates; `fill="currentColor"`).

**Licence:** Font Awesome Free — Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT (https://fontawesome.com/license/free). Attribution is required when redistributing the icons: keep the comment inside each SVG or credit "Font Awesome" in the app's licences page.

| File | FA class on site | Where it is used on the site |
|---|---|---|
| `fas-users.svg` | `fas fa-users` | Program pages "Who Should Apply?" → "Committed Team" icon box (50px, `#ffe92c`) |
| `fas-flask.svg` | `fas fa-flask` | "Stage of Development" icon box |
| `fas-share.svg` | `fas fa-share` | "Participation in the Program" icon box (directional arrow — flip in RTL) |
| `fas-laptop-code.svg` | `fas fa-laptop-code` | Tech Accelerator / Digital Skills icon box |
| `far-envelope-open.svg` | `far fa-envelope-open` | Contact page "Support" list (20px, black) |
| `fas-phone-alt.svg` | `fas fa-phone-alt` | Contact page "Support" list (20px, black) |
| `fas-search.svg` | `fas fa-search` | Astra header search icon (rendered hidden; 23 occurrences in markup) |

Not extracted (chrome only, inline in the Astra HTML, GPL theme code): hamburger `ast-menu-svg`, close `ast-close-svg` (24×24), submenu chevron `ast-arrow-svg` (26×16). Use lucide `Menu`, `X`, `ChevronDown` in the app.

Usage guidance: single colour via `currentColor`; 50px yellow (`#ffe92c`/`#ffe91e`) for decorative icon boxes on white, 20px black for inline lists, never yellow on white below ~40px (contrast). The app's primary icon set remains lucide-react; these files exist for parity with marketing pages (see `../components-map.md`, "Icons").
