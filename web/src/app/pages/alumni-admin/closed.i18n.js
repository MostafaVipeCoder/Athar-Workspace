import { registerMessages } from '../../../i18n/core.js'

/**
 * The manager side of the CLOSED-company follow-up (`alumni.admin.cl.*`; owner decision 22): the follow-up view, the "closed" wording of the reminders next to the active-company one, and the
 * two audiences of the send dialog. (The founder's form and the answer labels are `alumni.closed.*`, shared/alumni/i18n.closed.js.)
 */
const en = {
  title: 'Closed companies follow-up',
  subtitle: 'What the founders of closed companies are doing now: a new venture, a job or something else, and who is interested in joining Athar programs.',
  loadFailed: 'This page could not be loaded',
  export: 'Excel',
  remindersLink: 'Reminder wording',
  sendReminders: 'Remind these founders',
  search: 'Search by company name',
  searchPlaceholder: 'Company name',
  empty: 'No closed company matches',
  emptyBody: 'Change the filters. Companies appear here when they are marked closed.',
  kpi: { total: 'Closed companies', answered: 'Answered', not_answered: 'Not answered yet', new_startup: 'New venture', employed: 'Employed', other: 'Other', interested: 'Interested in programs' },
  of: 'of {count}',
  f: { status: 'Answer', type: 'What they do now', interested: 'Interested in programs', any: 'Any', answered: 'Answered', not_answered: 'Not answered yet', yes: 'Interested', no: 'Not interested' },
  col: { company: 'Company', closedOn: 'Closed on', founder: 'Founder', answer: 'What they do now', details: 'Details', interested: 'Programs', answeredOn: 'Answered on', reminders: 'Reminders' },
  notAnswered: 'Not answered yet',
  interestedBadge: 'Interested',
  detail: { field: 'Field', stage: 'Stage', link: 'Link', role: 'Role', description: 'About' },
  remindersCount: '{count} sent',
  bySource: { founder: 'by the founder', manager: 'by the team' },
  noFounderAccount: 'No account yet',
  xl: { company: 'Company', closedOn: 'Closed on', founder: 'Founder', answerType: 'Answer', venture: 'New venture', field: 'Field / industry', stage: 'Stage', link: 'Link', description: 'Description', interested: 'Interested in programs', employer: 'Employer', role: 'Role', other: 'Other', answeredOn: 'Answered on', answeredBy: 'Entered by', reminders: 'Reminders sent', yes: 'Yes', no: 'No' },
  rem: {
    audience: 'Which reminder',
    figures: 'Active companies: figures',
    closed: 'Closed companies: what are you doing now?',
    closedNote: 'Sent to the founders of CLOSED companies that have not answered "What are you doing now?" this quarter. The link opens that short form instead of the figures page. Placeholders: no {deadline}.',
    figuresNote: 'Sent to the founders of ACTIVE companies whose figures are not confirmed. The link opens the figures page.',
    closedShare: 'closed companies: {count}',
  },
  pv: {
    figuresTitle: 'Active companies',
    figuresHelp: 'Asked to update or confirm their figures',
    closedTitle: 'Closed companies',
    closedHelp: 'Asked "What are you doing now?" (a different message and form)',
    recipients: 'Founders',
    withEmail: 'With e-mail',
    already: 'Already reminded',
    include: 'Send to {audience}',
    noneClosed: 'No closed-company founder to remind (all answered this quarter, or none has an account).',
    noneFigures: 'No active-company founder to remind.',
    total: 'Total to send: {count}',
    descClosed: 'Founders of closed companies that have not answered "What are you doing now?" this quarter get a platform notification and an e-mail.',
    descBoth: 'Founders of active companies that have not confirmed their figures, and founders of closed companies that have not answered "What are you doing now?", get a platform notification and an e-mail (each audience has its own message).',
  },
}
const ar = {
  title: 'متابعة الشركات المُغلقة',
  subtitle: 'ماذا يفعل أصحاب الشركات المُغلقة الآن: مشروع جديد أم وظيفة أم شيء آخر، ومن يرغب في الانضمام إلى برامج أثر.',
  loadFailed: 'تعذر تحميل هذه الصفحة',
  export: 'إكسل',
  remindersLink: 'نص التذكير',
  sendReminders: 'تذكير هؤلاء المؤسسين',
  search: 'بحث باسم الشركة',
  searchPlaceholder: 'اسم الشركة',
  empty: 'لا توجد شركة مُغلقة مطابقة',
  emptyBody: 'غيّر عوامل التصفية. تظهر الشركات هنا عند تحديدها كمُغلقة.',
  kpi: { total: 'الشركات المُغلقة', answered: 'أجابت', not_answered: 'لم تجب بعد', new_startup: 'مشروع جديد', employed: 'موظفون', other: 'أخرى', interested: 'مهتمون بالبرامج' },
  of: 'من {count}',
  f: { status: 'الإجابة', type: 'ماذا يفعلون الآن', interested: 'الاهتمام بالبرامج', any: 'الكل', answered: 'أجابت', not_answered: 'لم تجب بعد', yes: 'مهتم', no: 'غير مهتم' },
  col: { company: 'الشركة', closedOn: 'تاريخ الإغلاق', founder: 'المؤسس', answer: 'ماذا يفعل الآن', details: 'التفاصيل', interested: 'البرامج', answeredOn: 'تاريخ الإجابة', reminders: 'التذكيرات' },
  notAnswered: 'لم يجب بعد',
  interestedBadge: 'مهتم',
  detail: { field: 'المجال', stage: 'المرحلة', link: 'الرابط', role: 'المسمى', description: 'نبذة' },
  remindersCount: 'أُرسل {count}',
  bySource: { founder: 'بواسطة المؤسس', manager: 'بواسطة الفريق' },
  noFounderAccount: 'بلا حساب بعد',
  xl: { company: 'الشركة', closedOn: 'تاريخ الإغلاق', founder: 'المؤسس', answerType: 'الإجابة', venture: 'المشروع الجديد', field: 'المجال / القطاع', stage: 'المرحلة', link: 'الرابط', description: 'الوصف', interested: 'مهتم بالبرامج', employer: 'جهة العمل', role: 'المسمى الوظيفي', other: 'أخرى', answeredOn: 'تاريخ الإجابة', answeredBy: 'أدخلها', reminders: 'التذكيرات المُرسلة', yes: 'نعم', no: 'لا' },
  rem: {
    audience: 'أي تذكير',
    figures: 'الشركات النشطة: الأرقام',
    closed: 'الشركات المُغلقة: ماذا تفعل الآن؟',
    closedNote: 'يُرسل إلى أصحاب الشركات المُغلقة الذين لم يجيبوا عن "ماذا تفعل الآن؟" في هذا الربع. يفتح الرابط هذا النموذج القصير بدلاً من صفحة الأرقام. المتغيرات: بلا {deadline}.',
    figuresNote: 'يُرسل إلى أصحاب الشركات النشطة التي لم تؤكد أرقامها. يفتح الرابط صفحة الأرقام.',
    closedShare: 'الشركات المُغلقة: {count}',
  },
  pv: {
    figuresTitle: 'الشركات النشطة',
    figuresHelp: 'يُطلب منهم تحديث أرقامهم أو تأكيدها',
    closedTitle: 'الشركات المُغلقة',
    closedHelp: 'يُسألون "ماذا تفعل الآن؟" (رسالة ونموذج مختلفان)',
    recipients: 'المؤسسون',
    withEmail: 'لديهم بريد',
    already: 'سبق تذكيرهم',
    include: 'إرسال إلى {audience}',
    noneClosed: 'لا يوجد مؤسس شركة مُغلقة لتذكيره (أجاب الجميع هذا الربع، أو لا حساب لأحد).',
    noneFigures: 'لا يوجد مؤسس شركة نشطة لتذكيره.',
    total: 'الإجمالي للإرسال: {count}',
    descClosed: 'أصحاب الشركات المُغلقة الذين لم يجيبوا عن "ماذا تفعل الآن؟" في هذا الربع يصلهم إشعار على المنصة وبريد إلكتروني.',
    descBoth: 'أصحاب الشركات النشطة التي لم تؤكد أرقامها، وأصحاب الشركات المُغلقة الذين لم يجيبوا عن "ماذا تفعل الآن؟"، يصلهم إشعار على المنصة وبريد إلكتروني (لكل فئة رسالتها).',
  },
}

/** `{ a: { b: 'x' } }` -> `{ 'a.b': 'x' }` (the registry is flat). */
function flat(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flat(v, `${prefix}${k}.`, out)
    else out[`${prefix}${k}`] = v
  }
  return out
}
registerMessages('alumni.admin.cl', { en: flat(en), ar: flat(ar) })
