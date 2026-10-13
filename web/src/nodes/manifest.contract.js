/**
 * Manifest contract (design 06 section 4.2 + 00 section 4). Manifests are tiny and eager: metadata, ports, config
 * schema stub and dynamic-import THUNKS, never React component code, so the sidebar and edge validation work
 * without loading any node.
 */
export const MODES = ['edit', 'view', 'settings']
export const CATEGORIES = ['data', 'content', 'operations', 'system', 'dev']
export const PORT_FAMILIES = ['rows:form-response', 'rows:list-item', 'rows:participant', 'view', 'schedule', 'link', 'dev:text']
export const VISIBILITIES = ['private', 'platform', 'public']
export const MODE_COMPONENT = { edit: 'Edit', view: 'View', settings: 'Settings' }

const isFn = (v) => typeof v === 'function'
const isLocalized = (v) => v && typeof v === 'object' && typeof v.en === 'string' && typeof v.ar === 'string'

/** Returns a list of human-readable problems; empty list means the manifest is valid. */
export function validateManifest(m) {
  const errors = []
  const err = (msg) => errors.push(`${m?.key ?? '<no key>'}: ${msg}`)
  if (!m || typeof m !== 'object') return ['manifest is not an object']

  if (typeof m.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(m.key)) err('key must be snake_case')
  if (!Number.isInteger(m.version) || m.version < 1) err('version must be a positive integer')
  if (!isLocalized(m.name)) err('name needs {en, ar}')
  if (typeof m.icon !== 'string' || !m.icon) err('icon key required')
  if (!CATEGORIES.includes(m.category)) err(`category must be one of ${CATEGORIES.join(', ')}`)
  if (typeof m.singleton !== 'boolean') err('singleton must be boolean')
  if (!isFn(m.defaultConfig)) err('defaultConfig must be a function')
  if (!m.configSchema || typeof m.configSchema !== 'object') err('configSchema stub required')

  for (const dir of ['in', 'out']) {
    const list = m.ports?.[dir]
    if (!Array.isArray(list)) {
      err(`ports.${dir} must be an array`)
      continue
    }
    const seen = new Set()
    for (const p of list) {
      if (!p?.key) err(`a ${dir} port has no key`)
      if (seen.has(p?.key)) err(`duplicate ${dir} port "${p.key}"`)
      seen.add(p?.key)
      if (!Array.isArray(p?.families) || p.families.length === 0) err(`port "${p?.key}" needs families[]`)
      for (const f of p?.families ?? []) if (!PORT_FAMILIES.includes(f)) err(`port "${p.key}" has unknown family "${f}"`)
      if (!['one', 'many'].includes(p?.cardinality)) err(`port "${p?.key}" cardinality must be one|many`)
      if (!isLocalized(p?.label)) err(`port "${p?.key}" needs a bilingual label`)
      if (p?.resolve !== undefined && (dir !== 'out' || !isFn(p.resolve))) err(`port "${p?.key}": resolve is a thunk allowed on out ports only`)
    }
  }

  for (const [mode, name] of Object.entries(MODE_COMPONENT)) {
    if (!isFn(m.components?.[name])) err(`components.${name} (${mode}) must be a dynamic-import thunk`)
  }
  for (const v of m.contributesViews ?? []) {
    if (!v?.key || !isFn(v.component)) err('contributesViews entries need key and component thunk')
  }
  for (const v of m.visibility?.supported ?? []) if (!VISIBILITIES.includes(v)) err(`unknown visibility "${v}"`)
  return errors
}

/** Output port and input port are compatible if they share a family and (when both declare a kind) the same kind. */
export function isCompatible(outPort, inPort) {
  if (!outPort || !inPort) return false
  if (!outPort.families.some((f) => inPort.families.includes(f))) return false
  if (outPort.kind && inPort.kind && outPort.kind !== inPort.kind && outPort.kind !== 'subkind' && inPort.kind !== 'subkind') return false
  return true
}

/**
 * Edge validation used by the canvas (step 6) and tests. `graph.edges` = [{ from_node_id, from_port, to_node_id, to_port }].
 * Returns { ok: true } or { ok: false, reason }. Cycle policy per port family arrives with the canvas.
 */
export function validateConnection(registry, graph, conn) {
  const { from, fromPort, to, toPort } = conn
  if (from === to) return { ok: false, reason: 'self' }
  const nodes = graph.nodes ?? []
  const a = nodes.find((n) => n.id === from)
  const b = nodes.find((n) => n.id === to)
  const ma = a && registry.get(a.type)
  const mb = b && registry.get(b.type)
  if (!ma || !mb) return { ok: false, reason: 'unknown-node' }
  const out = ma.ports.out.find((p) => p.key === fromPort)
  const inn = mb.ports.in.find((p) => p.key === toPort)
  if (!out || !inn) return { ok: false, reason: 'unknown-port' }
  if (!isCompatible(out, inn)) return { ok: false, reason: 'incompatible' }
  const edges = graph.edges ?? []
  if (edges.some((e) => e.from_node_id === from && e.from_port === fromPort && e.to_node_id === to && e.to_port === toPort)) {
    return { ok: false, reason: 'duplicate' }
  }
  if (inn.cardinality === 'one' && edges.some((e) => e.to_node_id === to && e.to_port === toPort)) return { ok: false, reason: 'cardinality' }
  return { ok: true }
}
