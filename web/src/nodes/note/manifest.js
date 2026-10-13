import { defineNode, inPort, outPort } from '../_kit/defineNode.js'

/**
 * THROWAWAY dev-only node (design 06 step 4). It exists to prove: lazy per-node chunks, the three modes, error
 * isolation, input-port reading and saved-state refresh. It is registered only in dev builds (category 'dev') and has
 * no row in the database node_types table; it is exercised on /dev/nodes with an in-memory adapter.
 */
export default defineNode({
  key: 'note',
  version: 1,
  name: { en: 'Note (dev)', ar: 'ملاحظة (تجريبي)' },
  icon: 'note',
  category: 'dev',
  defaultConfig: () => ({ text: '' }),
  configSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 2000 } } },
  ports: {
    in: [inPort('text-in', ['dev:text'], { en: 'Text in', ar: 'نص وارد' })],
    out: [outPort('text', ['dev:text'], { en: 'Text', ar: 'النص' }, { resolve: () => import('./data.js').then((m) => m.resolveText) })],
  },
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: [],
})
