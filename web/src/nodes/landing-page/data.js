import { getLandingLink } from '../../data/landing.js'
import { buildPublicUrl } from '../../lib/links.js'

/**
 * Output-port resolver of `link`: the landing page's own public URL (`/view/<slug>/landing`) once the PM created it in Settings
 * (consumers: e-mails, another Landing page's card, the founder page). `kind: 'landing'` describes what the URL shows.
 */
export async function resolveLink({ node }) {
  const link = await getLandingLink(node.id)
  if (!link?.slug) return { items: [] }
  return { items: [{ kind: 'landing', url: buildPublicUrl('view', link.slug, { viewKey: 'landing' }), label: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, nodeId: node.id }] }
}
