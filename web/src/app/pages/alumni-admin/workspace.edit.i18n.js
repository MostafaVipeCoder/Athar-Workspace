import { registerMessages } from '../../../i18n/core.js'

/** What the M&E grid adds in m60 (`alumni.admin.ws.*`): a row somebody else saved first, and who edited a row last. */
registerMessages('alumni.admin.ws', {
  en: {
    rowStale: 'Changed by {who} on {date} while you were editing. Their latest values are loaded; the figures you typed that differ from theirs are marked. Press Save again to keep yours.',
    rowReloaded: 'Changed by {who} on {date} while you were editing. Their latest values are loaded and your edits were the same, so nothing is left to save.',
    nowValue: 'Now: {value}',
    stampLine: '{who} on {date}',
    historyLink: 'Open the full history of the yearly figures',
  },
  ar: {
    rowStale: 'غيّر {who} هذا الصف بتاريخ {date} أثناء تعديلك. حُمّلت أحدث قيمه؛ والأرقام التي كتبتها وتختلف عن قيمه معلَّمة. اضغط حفظ مرة أخرى للإبقاء على أرقامك.',
    rowReloaded: 'غيّر {who} هذا الصف بتاريخ {date} أثناء تعديلك. حُمّلت أحدث قيمه وكانت تعديلاتك مطابقة لها، فلا يوجد ما يُحفظ.',
    nowValue: 'الآن: {value}',
    stampLine: '{who} بتاريخ {date}',
    historyLink: 'فتح السجل الكامل للأرقام السنوية',
  },
})
