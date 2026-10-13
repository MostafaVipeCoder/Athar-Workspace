import { defineNode, inPort, outPort } from '../_kit/defineNode.js'

/** System node (08 decision 01-3): every project has an implicit view-page host; the Agenda node is just one tab. Hidden from the sidebar. */
export default defineNode({
  key: 'view_host',
  version: 1,
  name: { en: 'View page host', ar: 'صفحة العرض' },
  icon: 'host',
  category: 'system',
  singleton: true,
  ports: {
    in: [inPort('tabs', ['view'], { en: 'Tabs', ar: 'التبويبات' })],
    out: [outPort('link', ['link'], { en: 'Link', ar: 'الرابط' })],
  },
})
