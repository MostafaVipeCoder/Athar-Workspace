import { registerMessages } from '../../../i18n/core.js'

registerMessages('alumni.admin.ws', {
  en: {
    title: 'M&E workspace', subtitle: 'Log the yearly figures of the companies in one grid. Only the cells you change are saved, one yearly row per company and year (revenue is the year\'s total, funding is cumulative to the end of the year, all in EGP).',
    year: 'Year being logged', search: 'Search companies', searchPlaceholder: 'Search by company name', program: 'Program', anyProgram: 'Any program', onlyIncomplete: 'Only companies with an incomplete profile (includes a missing annual update)', scope: 'Companies', 'scope.alumni': 'Alumni', 'scope.all': 'All',
    colCompany: 'Company', colStatus: 'This year', colProfile: 'Profile', 'col.revenue_total': 'Revenue', 'col.funding_raised_total': 'Funding raised', 'col.employees_total': 'Employees', 'col.employees_female': 'Female employees', 'col.freelancers': 'Freelancers', colNotes: 'Notes', colHistory: 'History',
    reported: 'Reported', missing: 'Missing', dirty: 'Changed', cellLabel: '{field}: {company}', 'err.not_a_number': 'Not a number', 'err.negative': 'Cannot be negative', 'err.not_integer': 'Whole numbers only', 'err.exceeds_total': 'More than the total employees', failed: 'Not saved',
    saveAll: { one: 'Save {count} changed row', other: 'Save {count} changed rows' }, saving: 'Saving {done} of {total}...', discard: 'Discard the changes', changedRows: { one: '{count} row changed', other: '{count} rows changed' }, nothingToSave: 'No change yet.',
    saved: { one: '{count} row saved.', other: '{count} rows saved.' }, savedPartly: '{ok} saved, {failed} not saved: see the marked rows.', fixErrors: 'Fix the marked cells first.',
    discardTitle: 'Discard the unsaved changes?', discardBody: 'The figures you typed and did not save will be lost.', discardYes: 'Discard', keep: 'Keep editing',
    empty: 'No company matches.', emptyBody: 'Change the search or the filters.', loadFailed: 'The companies could not be loaded.', snapshotsFailed: 'The yearly figures could not be loaded.',
    notesTitle: 'Notes of {year}: {company}', traction: 'Traction / validation', challenges: 'Challenges', needs: 'Needs', notesSaved: 'Notes saved.', notesFailed: 'The notes could not be saved.', save: 'Save', cancel: 'Cancel',
    historyTitle: 'Yearly figures: {company}', historyEmpty: 'No yearly row yet.', historyFailed: 'The history could not be loaded.', source: 'Source', updated: 'Updated', 'source.founder': 'Founder', 'source.manager': 'Manager', 'source.import': 'Import', 'source.form': 'Form',
    deleteYear: 'Delete {year}', deleteTitle: 'Delete the figures of {year}?', deleteBody: 'The yearly row of {company} for {year} is removed (revenue, funding, headcount and notes). This cannot be undone.', deleted: 'The yearly row was deleted.', close: 'Close', openCompany: 'Open the company page',
    exportOwner: 'Export the owner\'s Excel',
  },
  ar: {
    title: 'المتابعة والتقييم', subtitle: 'سجّل الأرقام السنوية للشركات في جدول واحد. تُحفظ الخلايا التي غيّرتها فقط، بصف سنوي واحد لكل شركة وسنة (الإيرادات إجمالي السنة، والتمويل تراكمي حتى نهاية السنة، وكله بالجنيه).',
    year: 'السنة المسجَّلة', search: 'بحث في الشركات', searchPlaceholder: 'ابحث باسم الشركة', program: 'البرنامج', anyProgram: 'أي برنامج', onlyIncomplete: 'الشركات ذات الملف غير المكتمل فقط (ويشمل غياب التحديث السنوي)', scope: 'الشركات', 'scope.alumni': 'الخريجون', 'scope.all': 'الكل',
    colCompany: 'الشركة', colStatus: 'هذه السنة', colProfile: 'الملف', 'col.revenue_total': 'الإيرادات', 'col.funding_raised_total': 'التمويل المجمَّع', 'col.employees_total': 'الموظفون', 'col.employees_female': 'الموظفات', 'col.freelancers': 'المستقلون', colNotes: 'ملاحظات', colHistory: 'السجل',
    reported: 'مُبلَّغ', missing: 'ناقص', dirty: 'تغيّر', cellLabel: '{field}: {company}', 'err.not_a_number': 'ليس رقماً', 'err.negative': 'لا يمكن أن يكون سالباً', 'err.not_integer': 'أعداد صحيحة فقط', 'err.exceeds_total': 'أكثر من إجمالي الموظفين', failed: 'لم يُحفظ',
    saveAll: { zero: 'حفظ {count} صف تغيّر', one: 'حفظ صف واحد تغيّر', two: 'حفظ صفين تغيّرا', few: 'حفظ {count} صفوف تغيّرت', many: 'حفظ {count} صفاً تغيّر', other: 'حفظ {count} صف تغيّر' }, saving: 'جارٍ حفظ {done} من {total}...', discard: 'تجاهل التغييرات', changedRows: { zero: 'لا صفوف تغيّرت', one: 'صف واحد تغيّر', two: 'صفان تغيّرا', few: '{count} صفوف تغيّرت', many: '{count} صفاً تغيّر', other: '{count} صف تغيّر' }, nothingToSave: 'لم يتغيّر شيء بعد.',
    saved: { zero: 'لم يُحفظ أي صف.', one: 'تم حفظ صف واحد.', two: 'تم حفظ صفين.', few: 'تم حفظ {count} صفوف.', many: 'تم حفظ {count} صفاً.', other: 'تم حفظ {count} صف.' }, savedPartly: 'تم حفظ {ok} ولم يُحفظ {failed}: راجع الصفوف المعلَّمة.', fixErrors: 'أصلح الخلايا المعلَّمة أولاً.',
    discardTitle: 'تجاهل التغييرات غير المحفوظة؟', discardBody: 'ستضيع الأرقام التي كتبتها ولم تحفظها.', discardYes: 'تجاهل', keep: 'متابعة التحرير',
    empty: 'لا توجد شركة مطابقة.', emptyBody: 'غيّر البحث أو التصفية.', loadFailed: 'تعذّر تحميل الشركات.', snapshotsFailed: 'تعذّر تحميل الأرقام السنوية.',
    notesTitle: 'ملاحظات {year}: {company}', traction: 'الإنجازات والتحقق', challenges: 'التحديات', needs: 'الاحتياجات', notesSaved: 'تم حفظ الملاحظات.', notesFailed: 'تعذّر حفظ الملاحظات.', save: 'حفظ', cancel: 'إلغاء',
    historyTitle: 'الأرقام السنوية: {company}', historyEmpty: 'لا يوجد صف سنوي بعد.', historyFailed: 'تعذّر تحميل السجل.', source: 'المصدر', updated: 'آخر تحديث', 'source.founder': 'المؤسس', 'source.manager': 'المدير', 'source.import': 'استيراد', 'source.form': 'نموذج',
    deleteYear: 'حذف {year}', deleteTitle: 'حذف أرقام {year}؟', deleteBody: 'سيُحذف الصف السنوي لشركة {company} عن {year} (الإيرادات والتمويل وعدد الموظفين والملاحظات). لا يمكن التراجع.', deleted: 'تم حذف الصف السنوي.', close: 'إغلاق', openCompany: 'فتح صفحة الشركة',
    exportOwner: 'تصدير إكسل المالك',
  },
})
