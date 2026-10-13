import { defineNode, inPort, outPort } from '../_kit/defineNode.js'

/**
 * Landing Page node (design 01 section 3.9, 04 section 3.11, 07 sections 5 + 6, decisions 01-13 / 01-14): the public "share the
 * opportunity" page of landing-page.html, edited by the PM (hero, nav, N cards with cover image + CTA + per-platform share presets,
 * the "Personalize the Moment" photo section with PM-uploaded transparent PNG frames).
 * Ports: in `links` (the public links of a Form / Booking / Agenda ... a card's button or share target can be BOUND to instead of a
 * typed URL: the target's link is resolved by the DB, never copied); out `landing-tab` (the page as a tab of an Agenda / the project
 * page, rendered by `LandingTab`), `link` (the page's own public URL, for e-mails or another Landing).
 * Own page: `/view/<slug>/landing` (link kind `view`, view_key `landing`).
 */
export default defineNode({
  key: 'landing_page',
  version: 1,
  name: { en: 'Landing page', ar: 'صفحة الهبوط' },
  icon: 'landing',
  category: 'content',
  // an empty config is a fresh node: the editor offers the starter template explicitly (a migrated node keeps exactly what it has)
  defaultConfig: () => ({}),
  configSchema: { type: 'object', properties: { nav: { type: 'object' }, hero: { type: 'object' }, cardsSection: { type: 'object' }, personalize: { type: 'object' }, share: { type: 'object' }, seo: { type: 'object' }, analytics: { type: 'object' } } },
  ports: {
    in: [inPort('links', ['link'], { en: 'Links', ar: 'الروابط' })],
    out: [
      outPort('landing-tab', ['view'], { en: 'Landing tab', ar: 'تبويب الهبوط' }),
      outPort('link', ['link'], { en: 'Link', ar: 'الرابط' }, { resolve: () => import('./data.js').then((m) => m.resolveLink) }),
    ],
  },
  contributesViews: [{ key: 'landing-tab', title: { en: 'Landing', ar: 'الهبوط' }, component: () => import('./LandingTab.jsx') }],
  visibility: { supported: ['private', 'platform', 'public'], showToParticipants: true },
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: ['landing_cards', 'landing_share_presets', 'landing_frames'],
})
