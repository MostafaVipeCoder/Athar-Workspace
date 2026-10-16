import { registerMessages } from '../../../i18n/core.js'

/**
 * Dictionary of the Athar Network EXPERTS REGISTRY (namespace `experts.*`): the registry page, the profile, the create / edit form, the merge dialog, the duplicate finder and the
 * Excel import. Counts that sit in a sentence are PLURAL entries (Intl.PluralRules categories: Arabic has zero / one / two / few / many / other); everything else puts a number
 * after a label ("Projects involved: 3") so no sentence can disagree with its number. Digits are always Western (formatNumber).
 */
registerMessages('experts', {
  en: {
    title: 'Athar Network experts',
    subtitle: 'Everyone who trained, mentored or presented in an Athar program: which programs each took part in, and how many times.',
    back: 'Experts',
    loadFailed: 'The experts could not be loaded.',
    results: { one: '{count} expert found', other: '{count} experts found' },

    'kind.expert': 'Expert', 'kind.team': 'Athar team', 'kind.expert.long': 'Expert / trainer', 'kind.team.long': 'Athar team member',
    'state.active': 'Active', 'state.archived': 'Archived', 'state.deleted': 'Deleted',
    'view.label': 'Which records', 'view.all': 'All', 'view.expert': 'Experts', 'view.team': 'Athar team', 'view.archived': 'Archived', 'view.deleted': 'Deleted',
    'stat.withoutPhoto': 'Without a photo',

    'action.add': 'Add expert', 'action.import': 'Import', 'action.export': 'Export to Excel', 'action.duplicates': 'Duplicates', 'action.edit': 'Edit', 'action.archive': 'Archive',
    'action.unarchive': 'Unarchive', 'action.merge': 'Merge a duplicate', 'action.delete': 'Delete', 'action.restore': 'Restore', 'action.undo': 'Undo',

    'search.label': 'Search experts', 'search.placeholder': 'Search by name, title, company, e-mail or expertise',
    'sort.label': 'Sort by', 'sort.name': 'Name', 'sort.programs': 'Programs joined', 'sort.projects': 'Projects', 'sort.sessions': 'Sessions', 'sort.last': 'Last participation', 'sort.updated': 'Recently updated', 'sort.created': 'Recently added',
    'sort.asc': 'Ascending: click for descending', 'sort.desc': 'Descending: click for ascending', 'sort.by': 'Sort by {column}',

    'filter.title': 'Filters', 'filter.clear': 'Clear filters', 'filter.any': 'Any',
    'filter.participation': 'Participation', 'filter.participation.yes': 'Took part in a program', 'filter.participation.no': 'Never took part',
    'filter.program': 'Program joined', 'filter.program.hint': 'Only the programs you can see are listed.',
    'filter.language': 'Language', 'filter.photo': 'Photo', 'filter.photo.yes': 'Has a photo', 'filter.photo.no': 'No photo',
    'filter.email': 'E-mail', 'filter.email.yes': 'Has an e-mail', 'filter.email.no': 'No e-mail',
    'filter.tags': 'Expertise', 'filter.tags.none': 'No expertise tags yet. Add them from an expert\'s profile.',

    'col.name': 'Expert', 'col.kind': 'Kind', 'col.tags': 'Expertise', 'col.participation': 'Participation', 'col.programs': 'Programs', 'col.projects': 'Projects', 'col.sessions': 'Sessions',
    'col.bookingSessions': 'Booking sessions', 'col.distributionSessions': 'Mentoring sessions', 'col.first': 'First participation', 'col.last': 'Last participation', 'col.status': 'Status',

    'count.programs': { zero: 'No programs', one: '{count} program', other: '{count} programs' },
    'count.projects': { zero: 'No projects', one: '{count} project', other: '{count} projects' },
    'count.sessions': { zero: 'No sessions', one: '{count} session', other: '{count} sessions' },
    'count.bookingSessions': { one: '{count} booking session', other: '{count} booking sessions' },
    'count.distributionSessions': { one: '{count} mentoring session', other: '{count} mentoring sessions' },
    'participation.none': 'Has not taken part yet',
    'participation.last': 'Last: {date}', 'participation.noDate': 'Date not recorded',
    'participation.title': 'Participation', 'participation.firstLast': 'First participation', 'participation.lastShort': 'Last: {date}',
    'participation.split': '{booking} booking, {distribution} mentoring',
    'participation.derived': 'Worked out live from the program lists, the booking sessions and the mentoring distribution: nothing is typed or stored twice.',

    'pager.label': 'Pages', 'pager.range': '{from} - {to} of {total}', 'pager.perPage': 'Per page', 'pager.prev': 'Previous page', 'pager.next': 'Next page',

    'empty.title': 'No experts yet', 'empty.body': 'Add the first one, or import a sheet of experts from Excel.',
    'empty.filtered.title': 'No expert matches', 'empty.filtered.body': 'Change the search or the filters.',

    'toast.exported': { one: 'Exported {count} expert.', other: 'Exported {count} experts.' },
    'toast.created': 'Expert added.', 'toast.saved': 'Profile saved.', 'toast.archived': '{name} was archived.', 'toast.unarchived': '{name} is active again.',
    'toast.deleted': '{name} was deleted.', 'toast.restored': '{name} was restored.', 'toast.photoSaved': 'Photo saved.', 'toast.photoRemoved': 'Photo removed.',

    // profile
    'profile.details': 'Details', 'profile.expertise': 'Expertise and languages', 'profile.loadFailed': 'This expert could not be loaded.', 'bio.more': 'See more', 'bio.less': 'See less', 'profile.noTags': 'No expertise tags yet.', 'profile.noLanguages': 'No languages listed.', 'profile.noNotes': 'No notes.',
    'profile.added': 'Added {date}', 'profile.updated': 'updated {date}',
    'profile.notFound.title': 'This expert does not exist', 'profile.notFound.body': 'The record may have been deleted. Go back to the registry to find the person.',
    'merged.banner': 'This record was merged into {name}.', 'merged.open': 'Open the kept record', 'deleted.banner': 'This record is deleted. Only a super admin can restore it.',
    'contact.staffOnly': 'Contact details and notes are visible to staff only; the public pages of a program show only what its lists show.', 'contact.none': 'No contact details yet.',
    'history.empty.title': 'Has not taken part in a program yet', 'history.empty.body': 'When this person is added to a program\'s list, a booking page or a mentoring distribution, it appears here.',
    'history.list': 'List', 'history.completed': 'Completed', 'history.withdrawn': 'Withdrawn', 'history.legacyHidden': 'Hidden from the list (legacy)', 'history.notCounted': 'not counted', 'history.noSessions': 'Listed, no sessions yet', 'history.range': '{from} to {to}', 'history.listed': 'Listed on {date}',
    'history.hidden': 'More engagements are counted in the totals but not listed, because you are not a member of those projects: {engagements} (projects: {projects}, programs: {programs}).',
    'role.mentor': 'Mentor', 'role.provider': 'Booking provider', 'role.presenter': 'Presenter', 'role.listed': 'Listed',
    'merge.history': 'Merged records', 'merge.absorbed': '{name} was merged into this record on {date}.',

    // form
    'form.create': 'Add an expert', 'form.edit': 'Edit the profile', 'form.hint': 'Names, title and bio in Arabic and English; contact data and notes are for staff only.',
    'form.save': 'Save changes', 'form.createSave': 'Add expert', 'form.createAnyway': 'Add anyway',
    'form.contact': 'Contact', 'form.contact.hint': 'Visible to staff only.',
    'form.discard.title': 'Discard your changes?', 'form.discard.body': 'What you entered has not been saved.', 'form.discard.confirm': 'Discard',
    'field.kind': 'Kind', 'field.photo': 'Photo', 'field.name': 'Name', 'field.title': 'Job title', 'field.company': 'Company / affiliation', 'field.bio': 'Bio',
    'field.email': 'E-mail', 'field.phone': 'Phone', 'field.linkedin': 'LinkedIn', 'field.website': 'Website', 'field.links': 'Other links', 'field.link': 'Link {n}', 'field.link.add': 'Add a link', 'field.link.remove': 'Remove link {n}',
    'field.languages': 'Languages', 'field.tags': 'Expertise', 'field.tags.hint': 'Type to search; press Enter or pick a suggestion. A new name is added to the shared vocabulary.',
    'field.tags.placeholder': 'e.g. Marketing, Fundraising, AI', 'field.tags.chosen': 'Chosen expertise', 'field.tags.suggestions': 'Suggestions', 'field.tags.create': 'Create "{name}"', 'field.tags.remove': 'Remove {name}',
    'field.notes': 'Staff notes', 'field.notes.hint': 'Private: never shown to founders or on any public page.',
    'photo.add': 'Add a photo', 'photo.change': 'Change the photo', 'photo.remove': 'Remove the photo', 'photo.hint': 'PNG, JPEG or WebP; stored as an optimised WebP.',

    // duplicates while typing
    'dup.blocking': 'This person is probably already in the registry', 'dup.blocking.edit': 'Another record looks like this person', 'dup.blocking.body': 'Same LinkedIn profile, e-mail or name. Open the existing record instead of adding a second one.',
    'dup.warning': 'A similar record exists', 'dup.warning.body': 'Check that this is a different person.', 'dup.open': 'Open', 'dup.confirm': 'It is a different person: add it anyway',
    'dup.reason.same_linkedin': 'Same LinkedIn profile', 'dup.reason.same_email': 'Same e-mail', 'dup.reason.same_name': 'Same name', 'dup.reason.same_name_translit': 'Same name in another script', 'dup.reason.similar_name': 'Very similar name',
    'dup.dismissed': 'Marked as two different people.',

    // duplicates page
    'duplicates.title': 'Probable duplicates', 'duplicates.subtitle': 'Records that look like the same person: the same LinkedIn profile or e-mail, the same name, or one name written in Latin and in Arabic. Review each pair and merge, or say they are different people.',
    'duplicates.empty.title': 'No probable duplicates', 'duplicates.empty.body': 'Nothing in the registry looks like the same person twice.',
    'duplicates.count': { one: '{count} probable pair to review', other: '{count} probable pairs to review' }, 'duplicates.dismissed': 'Marked as different people: {count}',
    'duplicates.merge': 'Compare and merge', 'duplicates.notSame': 'Not the same person', 'duplicates.score': 'Match {score}%',

    // merge dialog
    'merge.title': 'Merge two records of one person', 'merge.hint.pick': 'Choose the other record. One of the two is kept, the other is merged into it and hidden, and every list that used it points to the kept one.',
    'merge.hint.compare': 'Compare the two records, choose what survives, read what will change, then confirm. Nothing is written before you confirm.',
    'merge.keep': 'Record to keep', 'merge.drop': 'Duplicate to merge in', 'merge.swap': 'Keep the other one', 'merge.suggested': 'Suggested', 'merge.search': 'Find another record', 'merge.noResults': 'No record found.',
    'merge.fields': 'Fields', 'merge.fields.hint': 'Where the two differ, choose the value that survives. An empty value never erases a filled one.', 'merge.col.field': 'Field', 'merge.empty': 'Empty',
    'merge.fields.also': 'Also combined: staff notes (both are kept), languages, links and expertise tags.',
    'merge.field.name_en': 'Name (English)', 'merge.field.name_ar': 'Name (Arabic)', 'merge.field.title_en': 'Job title (English)', 'merge.field.title_ar': 'Job title (Arabic)',
    'merge.field.company_en': 'Company (English)', 'merge.field.company_ar': 'Company (Arabic)', 'merge.field.bio_en': 'Bio (English)', 'merge.field.bio_ar': 'Bio (Arabic)',
    'merge.impact.title': 'What will change',
    'merge.impact.items': 'List entries moved to the kept record: {moved} (projects involved: {projects})', 'merge.impact.collapsed': 'Entries found in both records and combined into one: {count}',
    'merge.impact.providers': 'Booking provider records moved or combined: {count}', 'merge.impact.sessions': 'Sessions that stay attached to the person: booking {booking}, mentoring {distribution}',
    'merge.impact.tags': 'Expertise tags added to the kept record: {count}', 'merge.impact.tagsDropped': 'Expertise tags left out (a record holds at most 12): {count}',
    'merge.impact.archive': 'The duplicate is merged into the kept record and hidden from the registry; the merge is recorded in the audit with both full records.',
    'merge.blocked': 'The merge is blocked', 'merge.blocker.withdrawn_mismatch': 'The person is withdrawn in one record and active in the other within the same project. Reinstate or withdraw them first.',
    'merge.blocker.mentor_slot_conflict': 'Both records mentor in the same mentoring slot. Resolve it in the Mentoring Distribution node first.',
    'merge.blocker.provider_slot_conflict': 'Both records are booking providers of one Booking node and their slots overlap.', 'merge.blocker.kind_mismatch': 'An expert and an Athar team member cannot be merged.', 'merge.blocker.other': 'Blocked: {code}',
    'merge.understood': 'I understand that the duplicate will be merged into the kept record and hidden, and every list will use the kept record.', 'merge.run': 'Merge {drop} into {keep}', 'merge.done': 'Merged into {name}.',

    // import
    'import.title': 'Import experts from Excel', 'import.hint': 'One sheet with a header row. You see a preview before anything is added; likely duplicates are skipped unless you say otherwise.',
    'import.columns': 'Columns it understands (English or Arabic): name, name (ar), title, company, e-mail, phone, LinkedIn, website, languages, expertise, bio, notes.',
    'import.choose': 'Choose an Excel file', 'import.change': 'Choose another file', 'import.parseError': 'The file could not be read. Use .xlsx or .csv with a header row.',
    'import.tooBig': 'This file is larger than {max} MB. Split it, or keep only the columns you need.', 'import.partial': 'The import stopped after {created} rows were added (they are saved). {reason}', 'import.progress': 'Checking the rows: {done} of {total}', 'import.progressRun': 'Importing the rows: {done} of {total}',
    'import.noRows': '{file}: no row with a name was found. Check the header row.', 'import.found': '{count} rows with a name.', 'import.skippedNoName': 'Rows without a name were ignored: {count}.',
    'import.unknownLanguages': 'Unknown languages were dropped: {count}.', 'import.truncated': 'Only the first {max} rows are used.',
    'import.count.new': 'New: {count}', 'import.count.duplicate': 'Possible duplicates: {count}', 'import.count.invalid': 'Invalid: {count}',
    'import.duplicates.create': 'Import the possible duplicates too', 'import.preview': 'Preview of the rows', 'import.more': 'And {count} more rows.',
    'import.status.new': 'New', 'import.status.created': 'Added', 'import.status.duplicate': 'Duplicate', 'import.status.invalid': 'Invalid',
    'import.dup.inFile': 'same as an earlier row', 'import.dup.of': 'looks like {name}', 'import.invalid': 'refused: {detail}', 'import.run': { one: 'Import {count} expert', other: 'Import {count} experts' }, 'import.done': 'Import finished: added {created}, skipped {skipped}.',

    // delete
    'delete.title': 'Delete {name}?', 'delete.body': 'A deleted record leaves the registry. An expert that a program list uses cannot be deleted: archive or merge it instead. A super admin can restore it later.',

    // errors
    'err.invalid': 'Some of the data was refused. Check the form and try again.', 'err.notFound': 'This expert does not exist (it may have been deleted or merged).',
    'err.stale.title': 'The profile changed', 'err.stale': 'Somebody saved this profile after you opened it. Reload it to see their changes, then edit again.', 'err.stale.action': 'Reload the profile',
    'err.inUse': 'This expert is used by a program list. Archive the expert instead, or merge it into another record.', 'err.merged': 'A merged record cannot be restored.',
    'err.mergeBlocked': 'The merge is blocked. Fix the points shown in the dialog.', 'err.unavailable': 'This expert was removed.', 'err.duplicate': 'A likely duplicate already exists: confirm below to add anyway.',
    'err.tagArchived': 'This expertise tag was archived by an administrator. Pick another or ask a super admin.', 'err.tooManyNewTags': 'Too many new expertise tags at once. Import in smaller files or reuse existing tags.',
    'err.nameRequired': 'Enter the name in at least one language.', 'err.tooLong': 'This text is too long.', 'err.email': 'Enter a valid e-mail address.', 'err.phone': 'Enter a valid phone number (digits, +, spaces).',
    'err.url': 'Enter a full link starting with http(s)://', 'err.tooMany': 'Too many items.', 'err.photo': 'This photo could not be used.',
  },
  ar: {
    title: 'خبراء شبكة أثر',
    subtitle: 'كل من درّب أو أرشد أو قدّم في برامج أثر: في أي البرامج شارك وكم مرة.',
    back: 'الخبراء',
    loadFailed: 'تعذّر تحميل الخبراء.',
    results: { zero: 'لا نتائج', one: 'تم العثور على خبير واحد', two: 'تم العثور على خبيرين', few: 'تم العثور على {count} خبراء', many: 'تم العثور على {count} خبيرًا', other: 'تم العثور على {count} خبير' },

    'kind.expert': 'خبير', 'kind.team': 'فريق أثر', 'kind.expert.long': 'خبير / مدرّب', 'kind.team.long': 'عضو في فريق أثر',
    'state.active': 'نشط', 'state.archived': 'مؤرشف', 'state.deleted': 'محذوف',
    'view.label': 'أي السجلات', 'view.all': 'الكل', 'view.expert': 'الخبراء', 'view.team': 'فريق أثر', 'view.archived': 'المؤرشفون', 'view.deleted': 'المحذوفون',
    'stat.withoutPhoto': 'بدون صورة',

    'action.add': 'إضافة خبير', 'action.import': 'استيراد', 'action.export': 'تصدير إلى Excel', 'action.duplicates': 'التكرارات', 'action.edit': 'تعديل', 'action.archive': 'أرشفة',
    'action.unarchive': 'إلغاء الأرشفة', 'action.merge': 'دمج سجل مكرر', 'action.delete': 'حذف', 'action.restore': 'استعادة', 'action.undo': 'تراجع',

    'search.label': 'ابحث في الخبراء', 'search.placeholder': 'ابحث بالاسم أو المسمى أو الشركة أو البريد أو الخبرة',
    'sort.label': 'الترتيب حسب', 'sort.name': 'الاسم', 'sort.programs': 'البرامج التي شارك فيها', 'sort.projects': 'المشاريع', 'sort.sessions': 'الجلسات', 'sort.last': 'آخر مشاركة', 'sort.updated': 'الأحدث تعديلًا', 'sort.created': 'الأحدث إضافة',
    'sort.asc': 'تصاعدي: اضغط للترتيب التنازلي', 'sort.desc': 'تنازلي: اضغط للترتيب التصاعدي', 'sort.by': 'الترتيب حسب {column}',

    'filter.title': 'التصفية', 'filter.clear': 'مسح التصفية', 'filter.any': 'أي',
    'filter.participation': 'المشاركة', 'filter.participation.yes': 'شارك في برنامج', 'filter.participation.no': 'لم يشارك بعد',
    'filter.program': 'البرنامج الذي شارك فيه', 'filter.program.hint': 'تظهر فقط البرامج التي يمكنك رؤيتها.',
    'filter.language': 'اللغة', 'filter.photo': 'الصورة', 'filter.photo.yes': 'لديه صورة', 'filter.photo.no': 'بدون صورة',
    'filter.email': 'البريد الإلكتروني', 'filter.email.yes': 'لديه بريد', 'filter.email.no': 'بدون بريد',
    'filter.tags': 'الخبرة', 'filter.tags.none': 'لا توجد وسوم خبرة بعد. أضفها من صفحة الخبير.',

    'col.name': 'الخبير', 'col.kind': 'النوع', 'col.tags': 'الخبرة', 'col.participation': 'المشاركة', 'col.programs': 'البرامج', 'col.projects': 'المشاريع', 'col.sessions': 'الجلسات',
    'col.bookingSessions': 'جلسات الحجز', 'col.distributionSessions': 'جلسات الإرشاد', 'col.first': 'أول مشاركة', 'col.last': 'آخر مشاركة', 'col.status': 'الحالة',

    'count.programs': { zero: 'لا برامج', one: 'برنامج واحد', two: 'برنامجان', few: '{count} برامج', many: '{count} برنامجًا', other: '{count} برنامج' },
    'count.projects': { zero: 'لا مشاريع', one: 'مشروع واحد', two: 'مشروعان', few: '{count} مشاريع', many: '{count} مشروعًا', other: '{count} مشروع' },
    'count.sessions': { zero: 'لا جلسات', one: 'جلسة واحدة', two: 'جلستان', few: '{count} جلسات', many: '{count} جلسة', other: '{count} جلسة' },
    'count.bookingSessions': { zero: 'لا جلسات حجز', one: 'جلسة حجز واحدة', two: 'جلستا حجز', few: '{count} جلسات حجز', many: '{count} جلسة حجز', other: '{count} جلسة حجز' },
    'count.distributionSessions': { zero: 'لا جلسات إرشاد', one: 'جلسة إرشاد واحدة', two: 'جلستا إرشاد', few: '{count} جلسات إرشاد', many: '{count} جلسة إرشاد', other: '{count} جلسة إرشاد' },
    'participation.none': 'لم يشارك بعد',
    'participation.last': 'الأخيرة: {date}', 'participation.noDate': 'التاريخ غير مسجَّل',
    'participation.title': 'المشاركة', 'participation.firstLast': 'أول مشاركة', 'participation.lastShort': 'الأخيرة: {date}',
    'participation.split': 'حجز: {booking}، إرشاد: {distribution}',
    'participation.derived': 'تُحسب مباشرة من قوائم البرامج وجلسات الحجز وتوزيع الإرشاد: لا شيء يُكتب أو يُخزَّن مرتين.',

    'pager.label': 'الصفحات', 'pager.range': '{from} - {to} من {total}', 'pager.perPage': 'في الصفحة', 'pager.prev': 'الصفحة السابقة', 'pager.next': 'الصفحة التالية',

    'empty.title': 'لا يوجد خبراء بعد', 'empty.body': 'أضف أول خبير، أو استورد ملف Excel بقائمة الخبراء.',
    'empty.filtered.title': 'لا يوجد خبير مطابق', 'empty.filtered.body': 'غيّر البحث أو التصفية.',

    'toast.exported': { zero: 'لم يُصدَّر أي خبير.', one: 'تم تصدير خبير واحد.', two: 'تم تصدير خبيرين.', few: 'تم تصدير {count} خبراء.', many: 'تم تصدير {count} خبيرًا.', other: 'تم تصدير {count} خبير.' },
    'toast.created': 'تمت إضافة الخبير.', 'toast.saved': 'تم حفظ الملف.', 'toast.archived': 'تمت أرشفة {name}.', 'toast.unarchived': '{name} نشط من جديد.',
    'toast.deleted': 'تم حذف {name}.', 'toast.restored': 'تمت استعادة {name}.', 'toast.photoSaved': 'تم حفظ الصورة.', 'toast.photoRemoved': 'تمت إزالة الصورة.',

    'profile.details': 'التفاصيل', 'profile.expertise': 'الخبرة واللغات', 'profile.loadFailed': 'تعذّر تحميل هذا الخبير.', 'bio.more': 'عرض المزيد', 'bio.less': 'عرض أقل', 'profile.noTags': 'لا توجد وسوم خبرة بعد.', 'profile.noLanguages': 'لم تُذكر لغات.', 'profile.noNotes': 'لا توجد ملاحظات.',
    'profile.added': 'أُضيف في {date}', 'profile.updated': 'وعُدّل في {date}',
    'profile.notFound.title': 'هذا الخبير غير موجود', 'profile.notFound.body': 'ربما حُذف السجل. ارجع إلى قائمة الخبراء للبحث عن الشخص.',
    'merged.banner': 'تم دمج هذا السجل في {name}.', 'merged.open': 'افتح السجل المُبقى', 'deleted.banner': 'هذا السجل محذوف. يمكن لمدير النظام وحده استعادته.',
    'contact.staffOnly': 'بيانات التواصل والملاحظات تظهر للفريق فقط؛ أما صفحات البرنامج العامة فتعرض ما تعرضه قوائمها فقط.', 'contact.none': 'لا توجد بيانات تواصل بعد.',
    'history.empty.title': 'لم يشارك في أي برنامج بعد', 'history.empty.body': 'عندما يُضاف هذا الشخص إلى قائمة برنامج أو صفحة حجز أو توزيع إرشاد، يظهر هنا.',
    'history.list': 'القائمة', 'history.completed': 'مكتمل', 'history.withdrawn': 'منسحب', 'history.legacyHidden': 'مخفي من القائمة (قديم)', 'history.notCounted': 'غير محسوب', 'history.noSessions': 'مُدرج، بلا جلسات بعد', 'history.range': 'من {from} إلى {to}', 'history.listed': 'أُدرج في {date}',
    'history.hidden': 'مشاركات أخرى محسوبة في الإجمالي لكنها غير معروضة لأنك لست عضوًا في تلك المشاريع: {engagements} (المشاريع: {projects}، البرامج: {programs}).',
    'role.mentor': 'مرشد', 'role.provider': 'مقدّم جلسات حجز', 'role.presenter': 'مقدّم', 'role.listed': 'مُدرج',
    'merge.history': 'السجلات المدموجة', 'merge.absorbed': 'تم دمج {name} في هذا السجل بتاريخ {date}.',

    'form.create': 'إضافة خبير', 'form.edit': 'تعديل الملف', 'form.hint': 'الاسم والمسمى والنبذة بالعربية والإنجليزية؛ بيانات التواصل والملاحظات للفريق فقط.',
    'form.save': 'حفظ التعديلات', 'form.createSave': 'إضافة الخبير', 'form.createAnyway': 'إضافة على أي حال',
    'form.contact': 'التواصل', 'form.contact.hint': 'تظهر للفريق فقط.',
    'form.discard.title': 'تجاهل التعديلات؟', 'form.discard.body': 'ما أدخلته لم يُحفظ بعد.', 'form.discard.confirm': 'تجاهل',
    'field.kind': 'النوع', 'field.photo': 'الصورة', 'field.name': 'الاسم', 'field.title': 'المسمى الوظيفي', 'field.company': 'الشركة / الجهة', 'field.bio': 'النبذة',
    'field.email': 'البريد الإلكتروني', 'field.phone': 'الهاتف', 'field.linkedin': 'لينكدإن', 'field.website': 'الموقع الإلكتروني', 'field.links': 'روابط أخرى', 'field.link': 'الرابط {n}', 'field.link.add': 'إضافة رابط', 'field.link.remove': 'إزالة الرابط {n}',
    'field.languages': 'اللغات', 'field.tags': 'الخبرة', 'field.tags.hint': 'اكتب للبحث ثم اضغط Enter أو اختر اقتراحًا. الاسم الجديد يُضاف إلى المفردات المشتركة.',
    'field.tags.placeholder': 'مثل: التسويق، جمع التمويل، الذكاء الاصطناعي', 'field.tags.chosen': 'الخبرات المختارة', 'field.tags.suggestions': 'اقتراحات', 'field.tags.create': 'إنشاء «{name}»', 'field.tags.remove': 'إزالة {name}',
    'field.notes': 'ملاحظات الفريق', 'field.notes.hint': 'خاصة: لا تظهر أبدًا للمؤسسين ولا في أي صفحة عامة.',
    'photo.add': 'إضافة صورة', 'photo.change': 'تغيير الصورة', 'photo.remove': 'إزالة الصورة', 'photo.hint': 'PNG أو JPEG أو WebP؛ تُحفظ بصيغة WebP محسّنة.',

    'dup.blocking': 'هذا الشخص موجود على الأرجح في السجل', 'dup.blocking.edit': 'يوجد سجل آخر يشبه هذا الشخص', 'dup.blocking.body': 'نفس ملف لينكدإن أو البريد أو الاسم. افتح السجل الموجود بدل إضافة سجل ثانٍ.',
    'dup.warning': 'يوجد سجل مشابه', 'dup.warning.body': 'تأكد أن هذا شخص مختلف.', 'dup.open': 'فتح', 'dup.confirm': 'هو شخص مختلف: أضفه على أي حال',
    'dup.reason.same_linkedin': 'نفس ملف لينكدإن', 'dup.reason.same_email': 'نفس البريد', 'dup.reason.same_name': 'نفس الاسم', 'dup.reason.same_name_translit': 'نفس الاسم بكتابة أخرى', 'dup.reason.similar_name': 'اسم مشابه جدًا',
    'dup.dismissed': 'تم تسجيلهما كشخصين مختلفين.',

    'duplicates.title': 'تكرارات محتملة', 'duplicates.subtitle': 'سجلات تبدو للشخص نفسه: نفس ملف لينكدإن أو البريد، أو نفس الاسم، أو اسم واحد مكتوب بالحروف اللاتينية وبالعربية. راجع كل زوج ثم ادمج أو سجّل أنهما شخصان مختلفان.',
    'duplicates.empty.title': 'لا توجد تكرارات محتملة', 'duplicates.empty.body': 'لا شيء في السجل يبدو كشخص مكرر.',
    'duplicates.count': { zero: 'لا أزواج للمراجعة', one: 'زوج محتمل واحد للمراجعة', two: 'زوجان محتملان للمراجعة', few: '{count} أزواج محتملة للمراجعة', many: '{count} زوجًا محتملًا للمراجعة', other: '{count} زوج محتمل للمراجعة' },
    'duplicates.dismissed': 'سُجّلوا كمختلفين: {count}', 'duplicates.merge': 'قارن وادمج', 'duplicates.notSame': 'ليسا الشخص نفسه', 'duplicates.score': 'التطابق {score}%',

    'merge.title': 'دمج سجلين لشخص واحد', 'merge.hint.pick': 'اختر السجل الآخر. يُبقى أحدهما ويُدمج الآخر فيه ويختفي، وتشير كل قائمة كانت تستخدمه إلى السجل المُبقى.',
    'merge.hint.compare': 'قارن السجلين، واختر ما يبقى، واقرأ ما سيتغير، ثم أكّد. لا يُكتب شيء قبل تأكيدك.',
    'merge.keep': 'السجل المُبقى', 'merge.drop': 'المكرر الذي سيُدمج', 'merge.swap': 'أبقِ الآخر', 'merge.suggested': 'مقترحات', 'merge.search': 'ابحث عن سجل آخر', 'merge.noResults': 'لا يوجد سجل.',
    'merge.fields': 'الحقول', 'merge.fields.hint': 'حيث يختلف السجلان، اختر القيمة التي تبقى. القيمة الفارغة لا تمحو قيمة مملوءة.', 'merge.col.field': 'الحقل', 'merge.empty': 'فارغ',
    'merge.fields.also': 'يُدمج أيضًا: ملاحظات الفريق (يُحتفظ بالاثنتين) واللغات والروابط ووسوم الخبرة.',
    'merge.field.name_en': 'الاسم (إنجليزي)', 'merge.field.name_ar': 'الاسم (عربي)', 'merge.field.title_en': 'المسمى (إنجليزي)', 'merge.field.title_ar': 'المسمى (عربي)',
    'merge.field.company_en': 'الشركة (إنجليزي)', 'merge.field.company_ar': 'الشركة (عربي)', 'merge.field.bio_en': 'النبذة (إنجليزي)', 'merge.field.bio_ar': 'النبذة (عربي)',
    'merge.impact.title': 'ما الذي سيتغير',
    'merge.impact.items': 'عناصر القوائم المنقولة إلى السجل المُبقى: {moved} (المشاريع المعنية: {projects})', 'merge.impact.collapsed': 'عناصر موجودة في السجلين وتُدمج في عنصر واحد: {count}',
    'merge.impact.providers': 'سجلات مقدّمي الحجز المنقولة أو المدموجة: {count}', 'merge.impact.sessions': 'الجلسات التي تبقى مرتبطة بالشخص: حجز {booking}، إرشاد {distribution}',
    'merge.impact.tags': 'وسوم الخبرة المضافة إلى السجل المُبقى: {count}', 'merge.impact.tagsDropped': 'وسوم الخبرة المستبعدة (يحمل السجل 12 وسمًا كحد أقصى): {count}',
    'merge.impact.archive': 'يُدمج المكرر في السجل المُبقى ويختفي من السجل العام، ويُسجَّل الدمج في سجل المراجعة بالسجلين كاملين.',
    'merge.blocked': 'الدمج متوقف', 'merge.blocker.withdrawn_mismatch': 'الشخص منسحب في أحد السجلين ونشط في الآخر داخل المشروع نفسه. أعد تفعيله أو سجّل انسحابه أولًا.',
    'merge.blocker.mentor_slot_conflict': 'السجلان يرشدان في نفس خانة توزيع الإرشاد. عالج ذلك في عقدة توزيع الإرشاد أولًا.',
    'merge.blocker.provider_slot_conflict': 'السجلان مقدّما حجز في عقدة حجز واحدة وتتداخل مواعيدهما.', 'merge.blocker.kind_mismatch': 'لا يمكن دمج خبير مع عضو في فريق أثر.', 'merge.blocker.other': 'متوقف: {code}',
    'merge.understood': 'أفهم أن المكرر سيُدمج في السجل المُبقى ويختفي وأن كل القوائم ستستخدم السجل المُبقى.', 'merge.run': 'ادمج {drop} في {keep}', 'merge.done': 'تم الدمج في {name}.',

    'import.title': 'استيراد خبراء من Excel', 'import.hint': 'ورقة واحدة بصف عناوين. ترى معاينة قبل إضافة أي شيء، ويُتخطى المحتمل تكراره ما لم تقرر غير ذلك.',
    'import.columns': 'الأعمدة المفهومة (بالعربية أو الإنجليزية): الاسم، الاسم (ar)، المسمى، الشركة، البريد، الهاتف، لينكدإن، الموقع، اللغات، الخبرة، النبذة، ملاحظات.',
    'import.choose': 'اختر ملف Excel', 'import.change': 'اختر ملفًا آخر', 'import.parseError': 'تعذّرت قراءة الملف. استخدم .xlsx أو .csv بصف عناوين.',
    'import.tooBig': 'حجم هذا الملف أكبر من {max} ميغابايت. قسّمه أو أبقِ الأعمدة اللازمة فقط.', 'import.partial': 'توقف الاستيراد بعد إضافة {created} صفًا (وهي محفوظة). {reason}', 'import.progress': 'فحص الصفوف: {done} من {total}', 'import.progressRun': 'استيراد الصفوف: {done} من {total}',
    'import.noRows': '{file}: لم يُعثر على أي صف باسم. راجع صف العناوين.', 'import.found': 'صفوف باسم: {count}.', 'import.skippedNoName': 'صفوف بلا اسم تم تجاهلها: {count}.',
    'import.unknownLanguages': 'لغات غير معروفة تم تجاهلها: {count}.', 'import.truncated': 'تُستخدم أول {max} صف فقط.',
    'import.count.new': 'جديد: {count}', 'import.count.duplicate': 'تكرار محتمل: {count}', 'import.count.invalid': 'غير صالح: {count}',
    'import.duplicates.create': 'استورد المحتمل تكراره أيضًا', 'import.preview': 'معاينة الصفوف', 'import.more': 'وصفوف أخرى: {count}.',
    'import.status.new': 'جديد', 'import.status.created': 'أُضيف', 'import.status.duplicate': 'مكرر', 'import.status.invalid': 'غير صالح',
    'import.dup.inFile': 'مثل صف سابق', 'import.dup.of': 'يشبه {name}', 'import.invalid': 'مرفوض: {detail}', 'import.run': { zero: 'لا خبراء للاستيراد', one: 'استيراد خبير واحد', two: 'استيراد خبيرين', few: 'استيراد {count} خبراء', many: 'استيراد {count} خبيرًا', other: 'استيراد {count} خبير' }, 'import.done': 'انتهى الاستيراد: أُضيف {created}، وتم تخطي {skipped}.',

    'delete.title': 'حذف {name}؟', 'delete.body': 'السجل المحذوف يغادر السجل العام. لا يمكن حذف خبير تستخدمه قائمة برنامج: أرشفه أو ادمجه بدلًا من ذلك. ويمكن لمدير النظام استعادته لاحقًا.',

    'err.invalid': 'تم رفض بعض البيانات. راجع النموذج وحاول مرة أخرى.', 'err.notFound': 'هذا الخبير غير موجود (ربما حُذف أو دُمج).',
    'err.stale.title': 'تغيّر الملف', 'err.stale': 'حفظ شخص آخر هذا الملف بعد أن فتحته. أعد تحميله لترى تعديلاته ثم عدّل من جديد.', 'err.stale.action': 'أعد تحميل الملف',
    'err.inUse': 'هذا الخبير مستخدم في قائمة برنامج. أرشفه بدلًا من ذلك، أو ادمجه في سجل آخر.', 'err.merged': 'لا يمكن استعادة سجل مدموج.',
    'err.mergeBlocked': 'الدمج متوقف. عالج النقاط الظاهرة في النافذة.', 'err.unavailable': 'تمت إزالة هذا الخبير.', 'err.duplicate': 'يوجد تكرار محتمل: أكّد أدناه لإضافته على أي حال.',
    'err.tagArchived': 'أرشف مدير النظام وسم الخبرة هذا. اختر وسمًا آخر أو اطلب من مدير النظام.', 'err.tooManyNewTags': 'وسوم خبرة جديدة كثيرة دفعة واحدة. استورد بملفات أصغر أو أعد استخدام الوسوم الموجودة.',
    'err.nameRequired': 'أدخل الاسم بلغة واحدة على الأقل.', 'err.tooLong': 'هذا النص طويل جدًا.', 'err.email': 'أدخل بريدًا إلكترونيًا صحيحًا.', 'err.phone': 'أدخل رقم هاتف صحيحًا (أرقام و + ومسافات).',
    'err.url': 'أدخل رابطًا كاملًا يبدأ بـ http(s)://', 'err.tooMany': 'عدد العناصر أكبر من المسموح.', 'err.photo': 'تعذّر استخدام هذه الصورة.',
  },
})
