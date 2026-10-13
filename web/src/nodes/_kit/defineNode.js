/**
 * Manifest helpers. defineNode fills safe defaults so a manifest only states what is specific to the node type.
 * Components default to the shared placeholder (one lazy chunk) until the real Edit/View/Settings exist (step 7).
 */
const placeholder = () => import('./PlaceholderMode.jsx')

export const placeholderComponents = () => ({ Edit: placeholder, View: placeholder, Settings: placeholder })

export const inPort = (key, families, label, opts = {}) => ({ key, families, label, kind: null, required: false, cardinality: 'many', ...opts })
export const outPort = (key, families, label, opts = {}) => ({ key, families, label, kind: null, required: false, cardinality: 'many', ...opts })

export function defineNode(def) {
  return {
    singleton: false,
    configSchema: { type: 'object', additionalProperties: true, properties: {} }, // stub: real JSON Schema per node in step 7
    defaultConfig: () => ({}),
    contributesViews: [],
    visibility: { supported: ['private', 'platform', 'public'], showToParticipants: false },
    emails: [],
    routes: [],
    ownsTables: [],
    components: placeholderComponents(),
    ...def,
    ports: { in: def.ports?.in ?? [], out: def.ports?.out ?? [] },
  }
}
