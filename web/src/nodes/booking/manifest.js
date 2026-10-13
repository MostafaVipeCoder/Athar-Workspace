import { defineNode, inPort, outPort } from '../_kit/defineNode.js'
import { defaultBookingConfig } from './bookingConfig.js'

/**
 * Booking node (design 01 sections 3.5 / 3.6 / 6.3, 02 section 3.8, 04 section 3.9; decisions 01-1 ONE node type with two
 * sidebar presets, 01-15 tokenised interview links, 02-12 optional schedule, 07-6 Meet at booking time, 07-10 project zone).
 * Providers arrive by reference through `mentors` (a List's `items`); interview invitees through `bookers` (a Selection
 * stage's `interview` port: the tokens are issued by the stage's send). `schedule` (an Agenda's days) feeds the slot
 * generator's day picker. Ports mirror the `node_types.booking` row (m02). The mode (mentor | interview) lives in
 * `booking_settings.mode` (set by the preset through add_node options, editable in Settings).
 */
export default defineNode({
  key: 'booking',
  version: 1,
  name: { en: 'Booking', ar: 'الحجز' },
  icon: 'booking',
  category: 'operations',
  presets: [
    { key: 'mentor', name: { en: 'Mentor booking', ar: 'حجز مع المنتورز' }, config: { mode: 'mentor' } },
    { key: 'interview', name: { en: 'Interview booking', ar: 'حجز مقابلات' }, config: { mode: 'interview' } },
  ],
  defaultConfig: defaultBookingConfig,
  configSchema: { type: 'object', properties: { page: { type: 'object' }, rules: { type: 'object' }, slotDefaults: { type: 'object' }, emails: { type: 'object' } } },
  ports: {
    in: [
      inPort('mentors', ['rows:list-item'], { en: 'Providers', ar: 'مقدمو الجلسات' }, { kind: 'expert', required: true }),
      inPort('bookers', ['rows:list-item'], { en: 'Invitees', ar: 'المدعوون' }, { kind: 'company' }),
      inPort('schedule', ['schedule'], { en: 'Schedule', ar: 'الجدول' }, { cardinality: 'one' }),
    ],
    out: [
      outPort('booking-tab', ['view'], { en: 'Booking tab', ar: 'تبويب الحجز' }),
      outPort('link', ['link'], { en: 'Link', ar: 'الرابط' }, { resolve: () => import('./data.js').then((m) => m.resolveLink) }),
    ],
  },
  visibility: { supported: ['private', 'platform', 'public'], showToParticipants: true },
  emails: [
    { key: 'booking_confirmation', trigger: 'on_booking', templateFields: ['provider_name', 'booker_name', 'first_name', 'company_name', 'booker_email', 'start_time', 'end_time', 'date', 'timezone', 'meet_link', 'cancel_link', 'project_name', 'program_name'] },
    { key: 'booking_cancellation', trigger: 'on_cancel', templateFields: ['provider_name', 'booker_name', 'first_name', 'company_name', 'booker_email', 'start_time', 'end_time', 'date', 'timezone', 'project_name', 'program_name'] },
  ],
  components: {
    Edit: () => import('./Edit.jsx'),
    View: () => import('./View.jsx'),
    Settings: () => import('./Settings.jsx'),
  },
  ownsTables: ['booking_settings', 'booking_providers', 'booking_slots', 'bookings', 'booking_invitations'],
})
