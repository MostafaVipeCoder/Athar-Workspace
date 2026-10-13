import { defineNode, outPort } from '../_kit/defineNode.js'
import { defaultLibraryConfig } from './libraryLogic.js'

/**
 * Resource Library node (design 01 section 3.8, 04 section 3.11): curated resources (links and uploaded files in the private
 * `resources` bucket) in categories, with a per-resource visibility. Rows live in `resources` + `library_categories` and are
 * saved atomically through save_node children (`app_private.save_children_library`, m36). Output `library-tab` is the tab the
 * Agenda host / project page shows (component contract: see LibraryTab.jsx); the library also has its own public page
 * (`/view/:ref/library-tab`, link kind `view`).
 */
export default defineNode({
  key: 'library',
  version: 1,
  name: { en: 'Resource library', ar: 'مكتبة الموارد' },
  icon: 'library',
  category: 'content',
  defaultConfig: defaultLibraryConfig,
  configSchema: { type: 'object', properties: { layout: { type: 'string' }, groupBy: { type: 'string' }, searchEnabled: { type: 'boolean' } } },
  ports: { in: [], out: [outPort('library-tab', ['view'], { en: 'Library tab', ar: 'تبويب المكتبة' })] },
  contributesViews: [{ key: 'library-tab', title: { en: 'Library', ar: 'المكتبة' }, component: () => import('./LibraryTab.jsx') }],
  visibility: { supported: ['private', 'platform', 'public'], showToParticipants: true },
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: ['resources', 'library_categories'],
})
