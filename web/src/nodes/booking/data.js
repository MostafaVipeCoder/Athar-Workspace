import { getBookingLink } from '../../data/booking.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'

/** Output-port resolver of `link`: the public booking page URL (Landing page CTA, e-mails) once the PM created the link. */
export async function resolveLink({ node }) {
  const link = await getBookingLink(node.id)
  if (!link?.slug) return { items: [] }
  return { items: [{ kind: 'booking', url: buildPublicUrl('booking', canonicalRef({ slug: link.slug, id: node.id })), label: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, nodeId: node.id }] }
}
