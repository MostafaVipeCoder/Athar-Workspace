import { listItems } from '../../data/lists.js'
import { normalizeSelectionConfig, portStatuses } from './selectionConfig.js'

/**
 * Output-port resolvers of a Selection stage (design 06 section 4.4): consumers (another stage, a List, Booking
 * invitees, Distribution companies) receive ListItemView[] (lib/entities.js normalizeListItem) = references to the
 * ORIGINAL source (the form response / company) plus THIS stage's overlay (status = stage key, notes, reviews live in
 * the extras). Items are always company-shaped. The DB-side resolver of the consuming node applies the same stage
 * filter (`app_private.selection_port_statuses`, m33) so a chained stage never sees an applicant that is not accepted.
 * Virtual (never-touched) applicants carry no status, so they never leave the stage through a decision port.
 */
async function resolvePort(node, port) {
  const config = normalizeSelectionConfig(node.config)
  const statuses = portStatuses(config, port)
  const filter = statuses ? { status: statuses } : {}
  const items = await listItems(node.id, { filter, kind: 'company' })
  return { items: items.map((i) => ({ ...i, stage: i.status, upstream: { nodeId: node.id, port } })), kind: 'company', port, statuses }
}

export const resolveApproved = ({ node }) => resolvePort(node, 'approved')
export const resolveRejected = ({ node }) => resolvePort(node, 'rejected')
export const resolveHolding = ({ node }) => resolvePort(node, 'holding')
export const resolveInterview = ({ node }) => resolvePort(node, 'interview')
export const resolveAll = ({ node }) => resolvePort(node, 'all')
