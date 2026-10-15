import { useState, useEffect, useMemo } from 'react';
import {
    BookOpen, Layers, CheckCircle2, History, Copy,
    Search, Sparkles, X, ChevronRight, AlertCircle,
    FileSpreadsheet, ShieldAlert, ArrowRight, Loader,
    FolderKanban, Globe, Lock
} from 'lucide-react';
import { getLibraryForms, importFormFromLibrary } from '../../lib/api';

export default function ImportFromLibraryModal({
    eventId,
    isOpen,
    onClose,
    onImportSuccess
}) {
    const [libraryForms, setLibraryForms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedForm, setSelectedForm] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedModuleFilter, setSelectedModuleFilter] = useState('all');
    
    // Import configuration
    const [importMode, setImportMode] = useState('with_history'); // 'with_history' | 'blank_copy'
    const [reLinkModule, setReLinkModule] = useState('selection_process');
    const [googleSheetsUrl, setGoogleSheetsUrl] = useState('');
    const [importing, setImporting] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);

    useEffect(() => {
        if (isOpen) {
            loadForms();
            setSelectedForm(null);
            setErrorMsg(null);
            setImportMode('with_history');
        }
    }, [isOpen, eventId]);

    const loadForms = async () => {
        try {
            setLoading(true);
            const data = await getLibraryForms({ eventId });
            setLibraryForms(data || []);
        } catch (err) {
            console.error('Failed to load library forms:', err);
            setErrorMsg('Failed to load templates from the Form Library.');
        } finally {
            setLoading(false);
        }
    };

    const filteredForms = useMemo(() => {
        return libraryForms.filter(form => {
            const matchesQuery = !searchQuery.trim() || 
                (form.form_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (form.form_name_ar || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (form.description || '').toLowerCase().includes(searchQuery.toLowerCase());
            
            const matchesModule = selectedModuleFilter === 'all' || form.target_module === selectedModuleFilter;

            return matchesQuery && matchesModule;
        });
    }, [libraryForms, searchQuery, selectedModuleFilter]);

    const handleSelectForm = (form) => {
        setSelectedForm(form);
        setReLinkModule(form.target_module || 'selection_process');
        if (form.integrations?.google_sheets_url) {
            setGoogleSheetsUrl(form.integrations.google_sheets_url);
        } else {
            setGoogleSheetsUrl('');
        }
    };

    const handleExecuteImport = async () => {
        if (!selectedForm) return;
        try {
            setImporting(true);
            setErrorMsg(null);

            const importedForm = await importFormFromLibrary({
                libraryFormId: selectedForm.id,
                eventId,
                importMode,
                reLinkModule: importMode === 'with_history' ? reLinkModule : selectedForm.target_module,
                googleSheetsUrl: importMode === 'with_history' ? googleSheetsUrl : null
            });

            if (onImportSuccess) {
                onImportSuccess(importedForm);
            }
            onClose();
        } catch (err) {
            console.error('Failed to import form from library:', err);
            setErrorMsg(err.message || 'Failed to import form. Please try again.');
        } finally {
            setImporting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" dir="rtl">
            <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
                            <Layers size={22} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-900">استيراد من مكتبة الفورمز المركزية</h3>
                            <p className="text-xs text-slate-500 font-medium">اختر قالباً جاهزاً وحدد طريقة التعامل مع الردود وعزل البيانات</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {errorMsg && (
                        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs font-bold flex items-center gap-2">
                            <AlertCircle size={16} className="shrink-0" />
                            <span>{errorMsg}</span>
                        </div>
                    )}

                    {!selectedForm ? (
                        /* Step 1: Form Selection Grid */
                        <div className="space-y-4">
                            {/* Search & Filters */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                <div className="relative flex-1">
                                    <Search size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="ابحث بالاسم، الوصف، أو الكلمات المفتاحية..."
                                        className="w-full pr-10 pl-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium focus:bg-white focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 transition-all"
                                    />
                                </div>
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                                    {[
                                        { id: 'all', label: 'الكل' },
                                        { id: 'selection_process', label: 'مسار الاختيار' },
                                        { id: 'companies_list', label: 'الشركات' },
                                        { id: 'mentors_list', label: 'المرشدين' }
                                    ].map(pill => (
                                        <button
                                            key={pill.id}
                                            onClick={() => setSelectedModuleFilter(pill.id)}
                                            className={`px-3 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                                                selectedModuleFilter === pill.id
                                                    ? 'bg-indigo-600 text-white shadow-sm'
                                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}
                                        >
                                            {pill.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Forms Cards */}
                            {loading ? (
                                <div className="py-16 text-center text-slate-400">
                                    <Loader size={30} className="animate-spin mx-auto mb-2 text-indigo-600" />
                                    <p className="text-xs font-bold text-slate-500">جاري تحميل النماذج المتاحة من المكتبة...</p>
                                </div>
                            ) : filteredForms.length === 0 ? (
                                <div className="py-16 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200 p-8">
                                    <BookOpen size={40} className="mx-auto text-slate-300 mb-3" />
                                    <h4 className="text-sm font-black text-slate-700">لا توجد نماذج متطابقة في المكتبة</h4>
                                    <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                                        يمكنك إنشاء نموذج جديد مباشرة أو حفظ أحد النماذج الحالية كقالب في المكتبة لاستخدامه مستقبلاً.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {filteredForms.map(form => (
                                        <div
                                            key={form.id}
                                            onClick={() => handleSelectForm(form)}
                                            className="group relative bg-white border border-slate-200 hover:border-indigo-600 hover:shadow-lg rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between text-right"
                                        >
                                            <div>
                                                {/* Card Top / Tags */}
                                                <div className="flex items-center justify-between gap-2 mb-2.5">
                                                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black ${
                                                        form.scope === 'global'
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                                                    }`}>
                                                        {form.scope === 'global' ? <Globe size={11} /> : <FolderKanban size={11} />}
                                                        {form.scope === 'global' ? 'قالب عام' : 'مخصص للمشروع'}
                                                    </span>

                                                    <span className="text-[11px] font-bold text-slate-400">
                                                        {Array.isArray(form.fields) ? form.fields.length : 0} أسئلة
                                                    </span>
                                                </div>

                                                {/* Title & Description */}
                                                <h4 className="font-black text-slate-900 text-base group-hover:text-indigo-600 transition-colors">
                                                    {form.form_name_ar || form.form_name}
                                                </h4>
                                                {form.form_name_ar && form.form_name && form.form_name_ar !== form.form_name && (
                                                    <p className="text-[11px] text-slate-400 font-medium mt-0.5" dir="ltr">
                                                        {form.form_name}
                                                    </p>
                                                )}
                                                <p className="text-xs text-slate-500 font-medium line-clamp-2 mt-2 leading-relaxed">
                                                    {form.description || 'نموذج جاهز وقابل للتخصيص عبر المكتبة المركزية.'}
                                                </p>
                                            </div>

                                            {/* Card Footer */}
                                            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-slate-400">
                                                    تم الاستيراد: {form.import_count || 0} مرات
                                                </span>
                                                <span className="inline-flex items-center gap-1 text-xs font-black text-indigo-600 group-hover:translate-x-[-3px] transition-transform">
                                                    اختيار القالب
                                                    <ArrowRight size={13} className="rotate-180" />
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Step 2: Configure Import Paths */
                        <div className="space-y-6">
                            {/* Selected Form Banner */}
                            <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-2xl flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black">
                                        <Layers size={20} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-black text-slate-900 text-sm">{selectedForm.form_name_ar || selectedForm.form_name}</h4>
                                            <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-[10px] font-black">
                                                {Array.isArray(selectedForm.fields) ? selectedForm.fields.length : 0} أسئلة
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5">{selectedForm.description || 'قالب من المكتبة المركزية'}</p>
                                    </div>
                                </div>

                                <button
                                    onClick={() => setSelectedForm(null)}
                                    className="px-3 py-1.5 text-xs font-black text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                                >
                                    تغيير القالب
                                </button>
                            </div>

                            {/* Section: Select Import Path */}
                            <div className="space-y-3">
                                <label className="text-xs font-black text-slate-900 block">
                                    اختر مسار الاستيراد وسياسة العزل:
                                </label>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Path 1: With Historical Data */}
                                    <div
                                        onClick={() => setImportMode('with_history')}
                                        className={`p-5 rounded-2xl border-2 transition-all cursor-pointer relative flex flex-col justify-between ${
                                            importMode === 'with_history'
                                                ? 'border-indigo-600 bg-indigo-50/30 shadow-md ring-4 ring-indigo-600/5'
                                                : 'border-slate-200 bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <div>
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-black">
                                                    <History size={18} />
                                                </div>
                                                <input
                                                    type="radio"
                                                    checked={importMode === 'with_history'}
                                                    onChange={() => setImportMode('with_history')}
                                                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                                                />
                                            </div>
                                            <h5 className="font-black text-sm text-slate-900">استيراد مع الردود التاريخية</h5>
                                            <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                                                نسخ النموذج وربطه بالمكتبة المركزية مع جلب كافة الردود السابقة لهذا النموذج، وتفعيل مزامنة التحليلات.
                                            </p>
                                        </div>

                                        <div className="mt-4 pt-3 border-t border-indigo-100/60">
                                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700">
                                                <CheckCircle2 size={13} />
                                                يتضمن إعادة ربط الموديول والردود السابقة
                                            </span>
                                        </div>
                                    </div>

                                    {/* Path 2: Blank Copy */}
                                    <div
                                        onClick={() => setImportMode('blank_copy')}
                                        className={`p-5 rounded-2xl border-2 transition-all cursor-pointer relative flex flex-col justify-between ${
                                            importMode === 'blank_copy'
                                                ? 'border-indigo-600 bg-indigo-50/30 shadow-md ring-4 ring-indigo-600/5'
                                                : 'border-slate-200 bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <div>
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-black">
                                                    <Copy size={18} />
                                                </div>
                                                <input
                                                    type="radio"
                                                    checked={importMode === 'blank_copy'}
                                                    onChange={() => setImportMode('blank_copy')}
                                                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                                                />
                                            </div>
                                            <h5 className="font-black text-sm text-slate-900">استيراد كنسخة فارغة (قالب مستقل)</h5>
                                            <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                                                إنشاء نسخة عميقة ومستقلة تماماً (Deep Clone) من هيكل الأسئلة والإعدادات، بدون أي ردود وبعزل كامل عن المكتبة.
                                            </p>
                                        </div>

                                        <div className="mt-4 pt-3 border-t border-amber-100">
                                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800">
                                                <ShieldAlert size={13} />
                                                عزل تام: أي تعديل لاحق لن يمس المكتبة
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Additional Configuration for Path 1 */}
                            {importMode === 'with_history' && (
                                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 animate-in fade-in">
                                    <div>
                                        <label className="text-xs font-black text-slate-800 block mb-1.5">
                                            إعادة الربط (Re-linking): اختر الموديول المستهدف للردود في هذا المشروع
                                        </label>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                            {[
                                                { id: 'selection_process', label: 'مسار الاختيار والفرز', icon: Layers },
                                                { id: 'companies_list', label: 'قائمة الشركات', icon: FolderKanban },
                                                { id: 'mentors_list', label: 'قائمة المرشدين', icon: CheckCircle2 }
                                            ].map(m => {
                                                const IconComp = m.icon;
                                                return (
                                                    <button
                                                        key={m.id}
                                                        type="button"
                                                        onClick={() => setReLinkModule(m.id)}
                                                        className={`p-3 rounded-xl border text-right transition-all flex items-center gap-2.5 ${
                                                            reLinkModule === m.id
                                                                ? 'border-indigo-600 bg-white text-indigo-700 shadow-sm font-black'
                                                                : 'border-slate-200 bg-slate-100/50 text-slate-600 hover:bg-slate-100 font-bold'
                                                        }`}
                                                    >
                                                        <IconComp size={16} className={reLinkModule === m.id ? 'text-indigo-600' : 'text-slate-400'} />
                                                        <span className="text-xs">{m.label}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs font-black text-slate-800 block mb-1.5">
                                            مزامنة Google Sheets (اختياري)
                                        </label>
                                        <div className="relative">
                                            <FileSpreadsheet size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                type="url"
                                                value={googleSheetsUrl}
                                                onChange={(e) => setGoogleSheetsUrl(e.target.value)}
                                                placeholder="https://docs.google.com/spreadsheets/d/..."
                                                className="w-full pr-9 pl-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-600"
                                                dir="ltr"
                                            />
                                        </div>
                                        <p className="text-[11px] text-slate-400 mt-1">سيتم توجيه الردود الجديدة تلقائياً إلى هذا الجدول بجانب حفظها في المنصة.</p>
                                    </div>
                                </div>
                            )}

                            {/* Questions Summary */}
                            <div className="space-y-2">
                                <label className="text-xs font-black text-slate-700 block">
                                    معاينة أسئلة القالب ({Array.isArray(selectedForm.fields) ? selectedForm.fields.length : 0} أسئلة):
                                </label>
                                <div className="max-h-44 overflow-y-auto space-y-1.5 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                                    {(selectedForm.fields || []).map((f, i) => (
                                        <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-white rounded-lg border border-slate-100 font-medium">
                                            <span className="text-slate-800 font-bold">{i + 1}. {f.field_label || f.field_name}</span>
                                            <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded">
                                                {f.field_type} {f.is_required && '• إلزامي'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={importing}
                        className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-100 transition-all disabled:opacity-50"
                    >
                        إلغاء
                    </button>

                    {selectedForm && (
                        <button
                            type="button"
                            onClick={handleExecuteImport}
                            disabled={importing}
                            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                            {importing ? (
                                <>
                                    <Loader size={16} className="animate-spin" />
                                    <span>جاري الاستيراد...</span>
                                </>
                            ) : (
                                <>
                                    <Layers size={16} />
                                    <span>تأكيد الاستيراد إلى المشروع</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
