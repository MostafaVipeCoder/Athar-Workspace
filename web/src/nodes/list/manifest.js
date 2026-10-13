import { defineNode, inPort, outPort } from '../_kit/defineNode.js'
import { defaultListConfig } from './listConfig.js'

/**
 * Lists node (design 01 section 3.3, 02 section 3): items are references (form response / Athar Network expert /
 * company) plus an overlay, or manual items. Subkind (expert | company | generic) lives in `lists.subkind`.
 * Output `items` is read by Distribution/Booking/other lists through `resolveItems`; `list-tab` is the tab view the
 * Agenda host shows (component contract: see ListTab.jsx and web/PROGRESS.md).
 */
export default defineNode({
  key: 'list',
  version: 1,
  name: { en: 'List', ar: 'قائمة' },
  icon: 'list',
  category: 'data',
  defaultConfig: defaultListConfig,
  configSchema: { type: 'object', properties: { card: { type: 'object' }, statuses: { type: 'array' }, overlayFields: { type: 'array' } } },
  ports: {
    in: [inPort('items-in', ['rows:form-response', 'rows:list-item'], { en: 'Items in', ar: 'عناصر واردة' })],
    out: [
      outPort('items', ['rows:list-item'], { en: 'Items', ar: 'العناصر' }, { kind: 'subkind', resolve: () => import('./data.js').then((m) => m.resolveItems) }),
      outPort('list-tab', ['view'], { en: 'List tab', ar: 'تبويب القائمة' }),
    ],
  },
  contributesViews: [{ key: 'list-tab', title: { en: 'List', ar: 'القائمة' }, component: () => import('./ListTab.jsx') }],
  visibility: { supported: ['private', 'platform', 'public'], showToParticipants: true },
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: ['list_items'],
})
