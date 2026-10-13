/**
 * Brand assets served from web/public/brand/ (copied from web/design-system/logo and raw/images; owner's assets).
 * Paths honour VITE_BASE_PATH (Vite's BASE_URL) so the app works under a sub-path.
 */
const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')

export const BRAND = {
  /** Wordmark 180x60 (black "athar" + yellow dot); shown at 150x50 like the site header. */
  logo: `${base}brand/athar-logo.png`,
  /** The header-size file the site serves (150x50). */
  logoSmall: `${base}brand/athar-logo-150x50.png`,
  /** Light-grey geometric circle pattern used behind the site hero (login, public pages). */
  pattern: `${base}brand/pattern.png`,
  favicon: `${base}brand/favicon.png`,
  siteUrl: 'https://www.athareg.com/',
}

export const LOGO_WIDTH = 150
export const LOGO_HEIGHT = 50
