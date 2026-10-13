import { defineNode, inPort, outPort } from '../_kit/defineNode.js'
import { defaultAgendaConfig } from './agendaLogic.js'

/**
 * Dynamic Agenda node (design 01 section 3.1, 02 section 4, 04 section 3.11): the time-table (agenda_days / agenda_slots,
 * saved atomically through save_node children) AND a host of the view page: views connected to `tabs` become tabs of its
 * public page (`/agenda/:ref`, link kind `agenda` on the node). The implicit `view_host` of every project hosts tabs the
 * same way (08 decision 01-3); the agenda contributes its own `agenda` view to it.
 * Outputs: `agenda` (the tab view, rendered by hosts through AgendaTab), `schedule` (days + slot windows + timezone for
 * Booking/Distribution, resolved client-side from the same rows), `link` (the public URL once the PM created it).
 */
export default defineNode({
  key: 'agenda',
  version: 1,
  name: { en: 'Agenda', ar: 'الأجندة' },
  icon: 'agenda',
  category: 'content',
  defaultConfig: defaultAgendaConfig,
  configSchema: { type: 'object', properties: { showDayNames: { type: 'boolean' }, header: { type: 'object' }, theme: { type: 'object' } } },
  ports: {
    in: [
      inPort('tabs', ['view'], { en: 'Tabs', ar: 'التبويبات' }),
      inPort('participants', ['rows:participant'], { en: 'Participants', ar: 'المشاركون' }, { cardinality: 'one' }),
    ],
    out: [
      outPort('agenda', ['view'], { en: 'Agenda', ar: 'الأجندة' }),
      outPort('schedule', ['schedule'], { en: 'Schedule', ar: 'الجدول' }, { resolve: () => import('./data.js').then((m) => m.resolveSchedule) }),
      outPort('link', ['link'], { en: 'Link', ar: 'الرابط' }, { resolve: () => import('./data.js').then((m) => m.resolveLink) }),
    ],
  },
  contributesViews: [{ key: 'agenda', title: { en: 'Agenda', ar: 'الأجندة' }, component: () => import('./AgendaTab.jsx') }],
  visibility: { supported: ['private', 'platform', 'public'], showToParticipants: true },
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: ['agenda_days', 'agenda_slots'],
})
