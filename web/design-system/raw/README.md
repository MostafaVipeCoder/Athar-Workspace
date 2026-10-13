# Raw assets fetched from www.athareg.com

All fetched 2026-10-12 with `curl -A Mozilla/5.0` (read-only; no forms submitted, no cookies accepted). The site is the owner's own company site. Everything here is reference material; nothing is imported by `web/src`.

## css/
| File | Source URL | Notes |
|---|---|---|
| `wp-content_themes_astra_assets_css_minified_main.min.css` | https://www.athareg.com/wp-content/themes/astra/assets/css/minified/main.min.css | Astra theme base (GPL) |
| `astra-theme-inline.css` | `<style id="astra-theme-css-inline-css">` from https://www.athareg.com/ | **Global colours, typography, header/footer, breakpoints** (the most useful file) |
| `wp-content_uploads_elementor_css_post-1932.css` | https://www.athareg.com/wp-content/uploads/elementor/css/post-1932.css | Elementor CSS for the homepage |
| `wp-content_plugins_essential-addons-for-elementor-lite_..._general.min.css` | https://www.athareg.com/wp-content/plugins/essential-addons-for-elementor-lite/assets/front-end/css/view/general.min.css | plugin base |
| `pages/elementor-<id>.css` | split out of the Hummingbird bundles below | Per-page Elementor rules: 1932 home, 2323 bootcamp, 2355 incubator, 1952 tech accelerator, 2363 climate, 2368 on-demand consultation, 2373 digital skills, 2263 contact; `elementor-kit-332.css` = global kit (colours + typography variables) |
| `hummingbird-bundles-removed.txt` | — | Names of the 13 Hummingbird-merged bundles (`https://www.athareg.com/wp-content/uploads/hummingbird-assets/<hash>.css`, 400–510 KB each, mostly Elementor/EAEL/Premium Addons/Fluent Forms vendor CSS). Downloaded, mined into `pages/`, then deleted to keep the repo small. Re-fetch with the URLs in the HTML `<link rel="stylesheet">` tags if needed. |

Google Fonts stylesheets referenced by the site (not stored, dynamic):
- `https://fonts.googleapis.com/css?family=Hepta+Slab:100..900|Questrial|Manrope:100..900|Roboto:100..900&display=auto` (Elementor)
- `https://fonts.googleapis.com/css?family=Manrope:400|Hepta+Slab:600&display=fallback` (Astra)

## fonts/
| File | Notes |
|---|---|
| `google-fonts.css` | `@font-face` CSS returned by `https://fonts.googleapis.com/css?family=Hepta+Slab:100..900|Questrial:400|Manrope:200..800|Roboto:400,500,700&display=swap` (20 faces, `woff2` URLs on fonts.gstatic.com). Licences: Hepta Slab, Manrope, Questrial — **SIL Open Font License 1.1** (self-hosting allowed); Roboto — Apache 2.0 (older) / OFL 1.1 (current). The binary font files were **not** downloaded: either keep the Google Fonts `<link>` (as the site does) or download the OFL files from https://fonts.google.com/ when self-hosting is decided. |
| Font Awesome 5.15.3 SVG fonts | Fetched from `https://www.athareg.com/wp-content/plugins/elementor/assets/lib/font-awesome/webfonts/fa-solid-900.svg` and `fa-regular-400.svg` (OFL 1.1), used to extract the 7 icons in `../icons/`, then deleted (1 MB, not needed). |

## images/
| File | Source | Notes |
|---|---|---|
| `Pattern-Gray-very-small.png` | https://www.athareg.com/wp-content/uploads/2024/09/Pattern-Gray-very-small.png | 4000×1500, 442 KB. Homepage hero background pattern (light-grey geometric circles). Owner's asset. |

Referenced but **not stored** (large photos / artwork; owner's assets, fetch directly if needed):
- `https://www.athareg.com/wp-content/uploads/2024/09/LETS-TALK.png` (3008×2008, 2 MB, "Let's Talk" band artwork)
- `.../2024/09/Main-hero.jpg`, `Program-BG-scaled.jpg`, `Program-BG-2-scaled.jpg`, `Athar-Event.jpg`, `Mentoring-1-scaled.jpg`, `10.png` (program card backgrounds)
- `.../2024/09/business-people-are-brainstorming-small.jpg` (program/contact hero photo)
- Partner logos: `Arilabs.png, Canada.png, DAI.png, EBRD.png, European-union-german-cooperation-01.png, Hivos.png, Mahrosa.png, Nise.png, Owap.png, Tiec.png, US-aid.png, african-crossroads-01.png, creativa.png, embasy-of-finlanda-cairo-01-01.png, enterpreneur-academy-01.png, giz.png, itida.png, medwaves.png, ministero.png, orange.png, plan.png, switchmed.png, usa.png` (all under `/wp-content/uploads/2024/09/`) — third-party marks, not redistributed here.

## logo/ (sibling folder `../logo/`)
| File | Source |
|---|---|
| `Athar-Logo.png` (180×60) | https://www.athareg.com/wp-content/uploads/2024/09/Athar-Logo.png |
| `Athar-Logo-150x50.png` | https://www.athareg.com/wp-content/uploads/2024/09/Athar-Logo-150x50.png (header size) |
| `cropped-site-icon-270x270.png` | https://www.athareg.com/wp-content/uploads/2019/12/cropped-site-icon-270x270.png (favicon/app icon) |

No SVG logo exists on the site.

## screenshots/
Browser captures (Chromium, 1280×609 desktop frame scaled, and 375×812 mobile) taken 2026-10-12 for visual reference: `home-hero-desktop.jpg`, `home-program-cards-and-yellow-band-desktop.jpg` (partial; lazy-load), `home-hero-mobile-375.jpg`, `home-mobile-menu-open-375.jpg`, `bootcamp-hero-desktop.jpg`, `bootcamp-intro-image-desktop.jpg`, `bootcamp-iconboxes-cta-footer-desktop.jpg`, `contact-form-desktop.jpg`.
