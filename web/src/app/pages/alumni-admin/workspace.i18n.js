import { registerMessages } from '../../../i18n/core.js'

registerMessages('alumni.admin.ws', {
  en: {
    title: 'Figures grid', subtitle: 'Type the current quarter\'s figures of many companies in one grid. Only the cells you change are saved, as the draft of the quarter. The quarter\'s close makes the draft official.',
    year: 'Year being logged', search: 'Search companies', searchPlaceholder: 'Search by company name', program: 'Program', anyProgram: 'Any program', onlyIncomplete: 'Only companies with an incomplete profile (includes figures not updated this quarter)', scope: 'Companies', 'scope.alumni': 'Alumni', 'scope.all': 'All',
    colCompany: 'Company', colStatus: 'This quarter', colProfile: 'Profile', 'col.revenue_total': 'Revenue', 'col.funding_raised_total': 'Funding raised', 'col.employees_total': 'Employees', 'col.employees_female': 'Female employees', 'col.freelancers': 'Freelancers', colNotes: 'Notes', colHistory: 'Quarterly figures',
    reported: 'Reported', missing: 'Missing', dirty: 'Changed', cellLabel: '{field}: {company}', 'err.not_a_number': 'Not a number', 'err.negative': 'Cannot be negative', 'err.not_integer': 'Whole numbers only', 'err.exceeds_total': 'More than the total employees', failed: 'Not saved',
    saveAll: { one: 'Save {count} changed row', other: 'Save {count} changed rows' }, saving: 'Saving {done} of {total}...', discard: 'Discard the changes', changedRows: { one: '{count} row changed', other: '{count} rows changed' }, nothingToSave: 'No change yet.',
    saved: { one: '{count} row saved.', other: '{count} rows saved.' }, savedPartly: '{ok} saved, {failed} not saved: see the marked rows.', fixErrors: 'Fix the marked cells first.',
    discardTitle: 'Discard the unsaved changes?', discardBody: 'The figures you typed and did not save will be lost.', discardYes: 'Discard', keep: 'Keep editing',
    empty: 'No company matches.', emptyBody: 'Change the search or the filters.', loadFailed: 'The companies could not be loaded.', snapshotsFailed: 'The figures could not be loaded.',
    quarter: 'Quarter: {quarter}. What you type here is the draft of this quarter; the close makes it official.',
    notesTitle: 'Notes for {quarter}: {company}', traction: 'Traction / validation', challenges: 'Challenges', needs: 'Needs', notesSaved: 'Notes saved.', notesFailed: 'The notes could not be saved.', save: 'Save', cancel: 'Cancel',
    source: 'Source', updated: 'Updated', 'source.founder': 'Founder', 'source.manager': 'Manager', 'source.import': 'Import', 'source.form': 'Form',
    close: 'Close', openCompany: 'Open the company page',
    exportOwner: 'Export the owner\'s Excel',
  },
  ar: {
    title: 'جدول الأرقام', subtitle: 'اكتب أرقام الربع الحالي لعدة شركات في جدول واحد. تُحفظ الخلايا التي تغيّرها فقط، كمسودة للربع. وإغلاق الربع يجعل المسودة رسمية.',
    year: 'السنة المسجَّلة', search: 'بحث في الشركات', searchPlaceholder: 'ابحث باسم الشركة', program: 'البرنامج', anyProgram: 'أي برنامج', onlyIncomplete: 'الشركات ذات الملف غير المكتمل فقط (ويشمل غياب تحديث أرقام هذا الربع)', scope: 'الشركات', 'scope.alumni': 'الخريجون', 'scope.all': 'الكل',
    colCompany: 'الشركة', colStatus: 'هذا الربع', colProfile: 'الملف', 'col.revenue_total': 'الإيرادات', 'col.funding_raised_total': 'التمويل المجمَّع', 'col.employees_total': 'الموظفون', 'col.employees_female': 'الموظفات', 'col.freelancers': 'المستقلون', colNotes: 'ملاحظات', colHistory: 'أرقام الأرباع',
    reported: 'مُبلَّغ', missing: 'ناقص', dirty: 'تغيّر', cellLabel: '{field}: {company}', 'err.not_a_number': 'ليس رقماً', 'err.negative': 'لا يمكن أن يكون سالباً', 'err.not_integer': 'أعداد صحيحة فقط', 'err.exceeds_total': 'أكثر من إجمالي الموظفين', failed: 'لم يُحفظ',
    saveAll: { zero: 'حفظ {count} صف تغيّر', one: 'حفظ صف واحد تغيّر', two: 'حفظ صفين تغيّرا', few: 'حفظ {count} صفوف تغيّرت', many: 'حفظ {count} صفاً تغيّر', other: 'حفظ {count} صف تغيّر' }, saving: 'جارٍ حفظ {done} من {total}...', discard: 'تجاهل التغييرات', changedRows: { zero: 'لا صفوف تغيّرت', one: 'صف واحد تغيّر', two: 'صفان تغيّرا', few: '{count} صفوف تغيّرت', many: '{count} صفاً تغيّر', other: '{count} صف تغيّر' }, nothingToSave: 'لم يتغيّر شيء بعد.',
    saved: { zero: 'لم يُحفظ أي صف.', one: 'تم حفظ صف واحد.', two: 'تم حفظ صفين.', few: 'تم حفظ {count} صفوف.', many: 'تم حفظ {count} صفاً.', other: 'تم حفظ {count} صف.' }, savedPartly: 'تم حفظ {ok} ولم يُحفظ {failed}: راجع الصفوف المعلَّمة.', fixErrors: 'أصلح الخلايا المعلَّمة أولاً.',
    discardTitle: 'تجاهل التغييرات غير المحفوظة؟', discardBody: 'ستضيع الأرقام التي كتبتها ولم تحفظها.', discardYes: 'تجاهل', keep: 'متابعة التحرير',
    empty: 'لا توجد شركة مطابقة.', emptyBody: 'غيّر البحث أو التصفية.', loadFailed: 'تعذّر تحميل الشركات.', snapshotsFailed: 'تعذّر تحميل الأرقام.',
    quarter: 'الربع: {quarter}. ما تكتبه هنا مسودة هذا الربع؛ والإغلاق يجعله رسمياً.',
    notesTitle: 'ملاحظات {quarter}: {company}', traction: 'الإنجازات والتحقق', challenges: 'التحديات', needs: 'الاحتياجات', notesSaved: 'تم حفظ الملاحظات.', notesFailed: 'تعذّر حفظ الملاحظات.', save: 'حفظ', cancel: 'إلغاء',
    source: 'المصدر', updated: 'آخر تحديث', 'source.founder': 'المؤسس', 'source.manager': 'المدير', 'source.import': 'استيراد', 'source.form': 'نموذج',
    close: 'إغلاق', openCompany: 'فتح صفحة الشركة',
    exportOwner: 'تصدير إكسل المالك',
  },
})
