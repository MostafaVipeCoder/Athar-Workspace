import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Layers, Plus, Search, Filter, Globe, FolderKanban,
    Copy, Trash2, Edit3, Eye, BarChart3, Users,
    ArrowLeft, CheckCircle2, AlertCircle, X, Download,
    FileSpreadsheet, Sparkles, Loader, ChevronDown,
    Settings2, MessageSquare, History, BookmarkPlus,
    Save, ArrowRight
} from 'lucide-react';
import {
    getLibraryForms,
    createLibraryForm,
    updateLibraryForm,
    deleteLibraryForm,
    duplicateLibraryForm,
    getLibraryFormResponses,
    getEvents
} from '../lib/api';
import LibraryAnalyticsDashboard from './forms/LibraryAnalyticsDashboard';
import ChipsOptionInput from './forms/ChipsOptionInput';
import PhoneValidationConfig from './forms/PhoneValidationConfig';

export default function FormLibraryManager() {
    const navigate = useNavigate();

    // Data states
    const [forms, setForms] = useState([]);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('directory'); // 'directory' | 'analytics'
    
    // Filtering
    const [searchQuery, setSearchQuery] = useState('');
    const [scopeFilter, setScopeFilter] = useState('all'); // 'all' | 'global' | 'specific'
    const [moduleFilter, setModuleFilter] = useState('all');

    // Modals & Single Form View
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [activeForm, setActiveForm] = useState(null); // When set, views single form manager
    const [singleFormTab, setSingleFormTab] = useState('questions'); // 'questions' | 'responses'
    const [responsesList, setResponsesList] = useState([]);
    const [loadingResponses, setLoadingResponses] = useState(false);
    const [viewingResponse, setViewingResponse] = useState(null);

    // Save states
    const [savingForm, setSavingForm] = useState(false);
    const [successFeedback, setSuccessFeedback] = useState(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [formsData, eventsData] = await Promise.all([
                getLibraryForms(),
                getEvents().catch(() => [])
            ]);
            setForms(formsData || []);
            setEvents(eventsData || []);
        } catch (err) {
            console.error('Failed to load library data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenFormDetails = async (form, tab = 'questions') => {
        setActiveForm(form);
        setSingleFormTab(tab);
        if (tab === 'responses') {
            loadFormResponses(form.id);
        }
    };

    const loadFormResponses = async (formId) => {
        try {
            setLoadingResponses(true);
            const resps = await getLibraryFormResponses(formId);
            setResponsesList(resps || []);
        } catch (err) {
            console.error('Failed to load library form responses:', err);
        } finally {
            setLoadingResponses(false);
        }
    };

    const handleDeleteForm = async (e, formId) => {
        e.stopPropagation();
        if (!window.confirm('هل أنت متأكد من حذف هذا النموذج من المكتبة المركزية؟ (لن يتم حذف النسخ التي تم استيرادها مسبقاً في المشاريع)')) {
            return;
        }

        try {
            await deleteLibraryForm(formId);
            setForms(prev => prev.filter(f => f.id !== formId));
            if (activeForm?.id === formId) {
                setActiveForm(null);
            }
        } catch (err) {
            console.error('Failed to delete form:', err);
            alert('حدث خطأ أثناء حذف النموذج');
        }
    };

    const handleDuplicateForm = async (e, formId) => {
        e.stopPropagation();
        try {
            const duplicated = await duplicateLibraryForm(formId);
            setForms(prev => [duplicated, ...prev]);
        } catch (err) {
            console.error('Failed to duplicate form:', err);
            alert('حدث خطأ أثناء نسخ النموذج');
        }
    };

    const handleSaveFormEdits = async () => {
        if (!activeForm) return;
        try {
            setSavingForm(true);
            const updated = await updateLibraryForm(activeForm.id, activeForm);
            setForms(prev => prev.map(f => f.id === updated.id ? updated : f));
            setActiveForm(updated);
            setSuccessFeedback('تم حفظ التعديلات في المكتبة بنجاح');
            setTimeout(() => setSuccessFeedback(null), 3500);
        } catch (err) {
            console.error('Failed to update form:', err);
            alert('حدث خطأ أثناء حفظ التعديلات');
        } finally {
            setSavingForm(false);
        }
    };

    // Filtered Forms List
    const filteredForms = useMemo(() => {
        return forms.filter(form => {
            const matchesQuery = !searchQuery.trim() ||
                (form.form_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (form.form_name_ar || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (form.description || '').toLowerCase().includes(searchQuery.toLowerCase());

            const matchesScope = scopeFilter === 'all' || form.scope === scopeFilter;
            const matchesModule = moduleFilter === 'all' || form.target_module === moduleFilter;

            return matchesQuery && matchesScope && matchesModule;
        });
    }, [forms, searchQuery, scopeFilter, moduleFilter]);

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 font-sans" dir="rtl">
            {/* Top Navigation Bar */}
            <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/80 px-6 py-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/')}
                            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors flex items-center gap-1 text-xs font-bold"
                            title="العودة للوحة التحكم"
                        >
                            <ArrowRight size={18} />
                            <span>الرئيسية</span>
                        </button>

                        <div className="h-6 w-px bg-slate-200" />

                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/20">
                                <Layers size={22} />
                            </div>
                            <div>
                                <h1 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                                    مكتبة الفورمز المركزية
                                    <span className="text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full">
                                        Central Library
                                    </span>
                                </h1>
                                <p className="text-xs text-slate-500 font-medium">مستودع النماذج العامة وإعادة استخدامها عبر المشاريع مع تحليلات مجمعة</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsCreateModalOpen(true)}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2"
                        >
                            <Plus size={16} />
                            <span>إنشاء قالب جديد</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Container */}
            <main className="max-w-7xl mx-auto px-6 pt-8 space-y-6">
                {/* Secondary Tab Switcher */}
                {!activeForm && (
                    <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setActiveTab('directory')}
                                className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                                    activeTab === 'directory'
                                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                                }`}
                            >
                                <Layers size={16} />
                                <span>قوالب النماذج ({forms.length})</span>
                            </button>

                            <button
                                onClick={() => setActiveTab('analytics')}
                                className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                                    activeTab === 'analytics'
                                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                                }`}
                            >
                                <BarChart3 size={16} />
                                <span>لوحة التحليلات العامة للمنصة</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* VIEW 1: SINGLE FORM INSPECTOR & BUILDER */}
                {activeForm ? (
                    <div className="space-y-6 animate-in fade-in">
                        {/* Single Form Header Bar */}
                        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => setActiveForm(null)}
                                    className="p-2 text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                                >
                                    <ArrowRight size={18} />
                                </button>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-xl font-black text-slate-900">
                                            {activeForm.form_name_ar || activeForm.form_name}
                                        </h2>
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                                            activeForm.scope === 'global'
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                                        }`}>
                                            {activeForm.scope === 'global' ? <Globe size={11} /> : <FolderKanban size={11} />}
                                            {activeForm.scope === 'global' ? 'قالب عام' : 'مخصص لمشروع'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-400 font-medium mt-1">
                                        {activeForm.description || 'قالب مركزي قابل للاستيراد في المشاريع'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {successFeedback && (
                                    <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 animate-in fade-in">
                                        <CheckCircle2 size={14} />
                                        {successFeedback}
                                    </span>
                                )}

                                <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                                    <button
                                        onClick={() => {
                                            setSingleFormTab('questions');
                                        }}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                            singleFormTab === 'questions' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600'
                                        }`}
                                    >
                                        الأسئلة والإعدادات
                                    </button>
                                    <button
                                        onClick={() => {
                                            setSingleFormTab('responses');
                                            loadFormResponses(activeForm.id);
                                        }}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
                                            singleFormTab === 'responses' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600'
                                        }`}
                                    >
                                        <span>الردود المجمعة</span>
                                        <span className="text-[10px] px-1.5 py-0.2 bg-indigo-50 text-indigo-700 rounded-md font-black">
                                            {responsesList.length}
                                        </span>
                                    </button>
                                </div>

                                {singleFormTab === 'questions' && (
                                    <button
                                        onClick={handleSaveFormEdits}
                                        disabled={savingForm}
                                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        {savingForm ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                                        <span>حفظ التعديلات</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Sub-tab 1: Form Questions & Template Metadata */}
                        {singleFormTab === 'questions' && (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Left Column: Meta & Scope Controls */}
                                <div className="lg:col-span-1 space-y-6">
                                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                                        <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                                            <Settings2 size={16} className="text-indigo-600" />
                                            بيانات وهوية القالب
                                        </h3>

                                        <div>
                                            <label className="text-xs font-black text-slate-700 block mb-1">اسم النموذج (EN)</label>
                                            <input
                                                type="text"
                                                value={activeForm.form_name || ''}
                                                onChange={(e) => setActiveForm({ ...activeForm, form_name: e.target.value })}
                                                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:border-indigo-600"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs font-black text-slate-700 block mb-1">الاسم بالعربية</label>
                                            <input
                                                type="text"
                                                value={activeForm.form_name_ar || ''}
                                                onChange={(e) => setActiveForm({ ...activeForm, form_name_ar: e.target.value })}
                                                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:border-indigo-600"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs font-black text-slate-700 block mb-1">وصف القالب</label>
                                            <textarea
                                                rows={3}
                                                value={activeForm.description || ''}
                                                onChange={(e) => setActiveForm({ ...activeForm, description: e.target.value })}
                                                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:border-indigo-600"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs font-black text-slate-700 block mb-1">نطاق الظهور (Scope)</label>
                                            <select
                                                value={activeForm.scope || 'global'}
                                                onChange={(e) => setActiveForm({ ...activeForm, scope: e.target.value })}
                                                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white focus:outline-none focus:border-indigo-600"
                                            >
                                                <option value="global">عام (متاح لجميع المشاريع)</option>
                                                <option value="specific">خاص بمشروع محدد</option>
                                            </select>
                                        </div>

                                        {activeForm.scope === 'specific' && (
                                            <div>
                                                <label className="text-xs font-black text-slate-700 block mb-1">المشروع المستهدف</label>
                                                <select
                                                    value={activeForm.event_id || ''}
                                                    onChange={(e) => setActiveForm({ ...activeForm, event_id: e.target.value })}
                                                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white focus:outline-none focus:border-indigo-600"
                                                >
                                                    <option value="">اختر المشروع...</option>
                                                    {events.map(ev => (
                                                        <option key={ev.event_id} value={ev.event_id}>{ev.title}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Right Column: Fields / Questions Builder in Library */}
                                <div className="lg:col-span-2 space-y-4">
                                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                                                <Layers size={18} className="text-indigo-600" />
                                                هيكل الأسئلة في هذا القالب ({Array.isArray(activeForm.fields) ? activeForm.fields.length : 0})
                                            </h3>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newField = {
                                                        field_name: `question_${Date.now()}`,
                                                        field_label: 'سؤال جديد',
                                                        field_type: 'text',
                                                        is_required: false,
                                                        field_options: []
                                                    };
                                                    setActiveForm({
                                                        ...activeForm,
                                                        fields: [...(activeForm.fields || []), newField]
                                                    });
                                                }}
                                                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black flex items-center gap-1 transition-all"
                                            >
                                                <Plus size={14} />
                                                <span>إضافة حقل/سؤال</span>
                                            </button>
                                        </div>

                                        {(!activeForm.fields || activeForm.fields.length === 0) ? (
                                            <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                                لا توجد أسئلة مضافة بعد. أضف أسئلة ليتم نسخها عند استيراد القالب.
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {activeForm.fields.map((field, idx) => (
                                                    <div key={idx} className="p-4 bg-slate-50/70 border border-slate-200 rounded-2xl space-y-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="flex items-center gap-2 flex-1">
                                                                <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-black flex items-center justify-center shrink-0">
                                                                    {idx + 1}
                                                                </span>
                                                                <input
                                                                    type="text"
                                                                    value={field.field_label || ''}
                                                                    onChange={(e) => {
                                                                        const updated = [...activeForm.fields];
                                                                        updated[idx].field_label = e.target.value;
                                                                        setActiveForm({ ...activeForm, fields: updated });
                                                                    }}
                                                                    placeholder="عنوان السؤال أو الحقل..."
                                                                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-600"
                                                                />
                                                            </div>

                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <select
                                                                    value={field.field_type || 'text'}
                                                                    onChange={(e) => {
                                                                        const updated = [...activeForm.fields];
                                                                        updated[idx].field_type = e.target.value;
                                                                        setActiveForm({ ...activeForm, fields: updated });
                                                                    }}
                                                                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-black focus:outline-none"
                                                                >
                                                                    <option value="text">نص قصير (Text)</option>
                                                                    <option value="textarea">نص طويل (Paragraph)</option>
                                                                    <option value="email">بريد إلكتروني (Email)</option>
                                                                    <option value="phone">رقم هاتف (Phone)</option>
                                                                    <option value="number">رقم (Number)</option>
                                                                    <option value="select">اختيار من متعدد (Select)</option>
                                                                    <option value="url">رابط ويب (URL)</option>
                                                                    <option value="file">ملف / صورة (File/Image)</option>
                                                                </select>

                                                                <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={!!field.is_required}
                                                                        onChange={(e) => {
                                                                            const updated = [...activeForm.fields];
                                                                            updated[idx].is_required = e.target.checked;
                                                                            setActiveForm({ ...activeForm, fields: updated });
                                                                        }}
                                                                        className="rounded text-indigo-600"
                                                                    />
                                                                    <span>إلزامي</span>
                                                                </label>

                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const updated = activeForm.fields.filter((_, i) => i !== idx);
                                                                        setActiveForm({ ...activeForm, fields: updated });
                                                                    }}
                                                                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Options editor for Select types */}
                                                        {['select', 'multiselect'].includes(field.field_type) && (
                                                            <ChipsOptionInput
                                                                options={field.field_options || []}
                                                                onChange={(opts) => {
                                                                    const updated = [...activeForm.fields];
                                                                    updated[idx].field_options = opts;
                                                                    setActiveForm({ ...activeForm, fields: updated });
                                                                }}
                                                            />
                                                        )}

                                                        {/* Phone validation config */}
                                                        {['phone', 'tel'].includes(field.field_type) && (
                                                            <PhoneValidationConfig
                                                                allowedCountries={field.validation_rules?.allowed_countries}
                                                                onChange={(countries) => {
                                                                    const updated = [...activeForm.fields];
                                                                    const currentRules = updated[idx].validation_rules || {};
                                                                    updated[idx].validation_rules = { ...currentRules, allowed_countries: countries };
                                                                    setActiveForm({ ...activeForm, fields: updated });
                                                                }}
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Sub-tab 2: Aggregated Form Responses */}
                        {singleFormTab === 'responses' && (
                            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                                            <Users size={18} className="text-indigo-600" />
                                            الردود المجمعة عبر المشاريع ({responsesList.length})
                                        </h3>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            يعرض جميع الردود المستلمة من كل المشاريع التي استوردت هذا النموذج مع تفعيل ربط الردود
                                        </p>
                                    </div>

                                    <button
                                        onClick={() => loadFormResponses(activeForm.id)}
                                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
                                    >
                                        تحديث الردود
                                    </button>
                                </div>

                                {loadingResponses ? (
                                    <div className="py-16 text-center text-slate-400">
                                        <Loader size={30} className="animate-spin mx-auto mb-2 text-indigo-600" />
                                        <p className="text-xs font-bold">جاري جلب الردود من المشاريع...</p>
                                    </div>
                                ) : responsesList.length === 0 ? (
                                    <div className="py-16 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                        <MessageSquare size={36} className="mx-auto text-slate-300 mb-2" />
                                        <p className="text-xs font-bold text-slate-500">لا توجد ردود مسجلة لهذا النموذج حتى الآن</p>
                                        <p className="text-[11px] text-slate-400 mt-1">
                                            ستظهر الردود هنا تلقائياً بمجرد إرسالها من صفحات المشاريع المرتبطة بهذا القالب.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-right text-xs">
                                            <thead>
                                                <tr className="border-b border-slate-100 text-slate-400 font-bold">
                                                    <th className="pb-3 pr-3">المشروع</th>
                                                    <th className="pb-3 px-3">تاريخ الإرسال</th>
                                                    <th className="pb-3 px-3">المصدر</th>
                                                    <th className="pb-3 px-3">عينة الإجابة</th>
                                                    <th className="pb-3 pl-3 text-left">التفاصيل</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                                                {responsesList.map(r => {
                                                    const answersObj = r.answers || {};
                                                    const firstAnswer = Object.values(answersObj)[0] || '—';
                                                    const previewText = typeof firstAnswer === 'object' ? JSON.stringify(firstAnswer) : String(firstAnswer);

                                                    return (
                                                        <tr key={r.response_id} className="hover:bg-slate-50 transition-colors">
                                                            <td className="py-3.5 pr-3 font-black text-slate-900">
                                                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px]">
                                                                    <FolderKanban size={12} className="text-indigo-600" />
                                                                    {r.event_title || 'مشروع غير مسمى'}
                                                                </span>
                                                            </td>
                                                            <td className="py-3.5 px-3 text-slate-500 font-mono text-[11px]" dir="ltr">
                                                                {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—'}
                                                            </td>
                                                            <td className="py-3.5 px-3">
                                                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                                                                    {r.source || 'direct'}
                                                                </span>
                                                            </td>
                                                            <td className="py-3.5 px-3 text-slate-600 max-w-xs truncate">
                                                                {previewText}
                                                            </td>
                                                            <td className="py-3.5 pl-3 text-left">
                                                                <button
                                                                    onClick={() => setViewingResponse(r)}
                                                                    className="px-2.5 py-1 text-[11px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors inline-flex items-center gap-1"
                                                                >
                                                                    <Eye size={12} />
                                                                    <span>عرض</span>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    /* VIEW 2: TEMPLATES DIRECTORY OR ANALYTICS TAB */
                    <>
                        {activeTab === 'analytics' ? (
                            <LibraryAnalyticsDashboard
                                onSelectForm={(form) => handleOpenFormDetails(form, 'responses')}
                            />
                        ) : (
                            /* Directory View */
                            <div className="space-y-6">
                                {/* Search & Filters Bar */}
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
                                    <div className="relative w-full md:w-96">
                                        <Search size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="ابحث في قوالب المكتبة..."
                                            className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium focus:bg-white focus:outline-none focus:border-indigo-600 transition-all"
                                        />
                                    </div>

                                    <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto">
                                        {/* Scope Filter */}
                                        <div className="flex items-center bg-slate-100 p-1 rounded-2xl text-xs font-black">
                                            <button
                                                onClick={() => setScopeFilter('all')}
                                                className={`px-3 py-1.5 rounded-xl transition-all ${scopeFilter === 'all' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600'}`}
                                            >
                                                الكل
                                            </button>
                                            <button
                                                onClick={() => setScopeFilter('global')}
                                                className={`px-3 py-1.5 rounded-xl transition-all ${scopeFilter === 'global' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-600'}`}
                                            >
                                                قوالب عامة
                                            </button>
                                            <button
                                                onClick={() => setScopeFilter('specific')}
                                                className={`px-3 py-1.5 rounded-xl transition-all ${scopeFilter === 'specific' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600'}`}
                                            >
                                                خاصة بمشاريع
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Forms Grid */}
                                {loading ? (
                                    <div className="py-24 text-center text-slate-400">
                                        <Loader size={36} className="animate-spin mx-auto mb-3 text-indigo-600" />
                                        <p className="text-xs font-bold text-slate-500">جاري تحميل قوالب المكتبة المركزية...</p>
                                    </div>
                                ) : filteredForms.length === 0 ? (
                                    <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-slate-200 p-8 space-y-3">
                                        <Layers size={48} className="mx-auto text-slate-300" />
                                        <h3 className="text-base font-black text-slate-800">لا توجد قوالب متطابقة</h3>
                                        <p className="text-xs text-slate-500 max-w-md mx-auto">
                                            يمكنك البدء بإنشاء قالب مركزي جديد أو تصفح المشاريع وحفظ نماذجها إلى المكتبة.
                                        </p>
                                        <button
                                            onClick={() => setIsCreateModalOpen(true)}
                                            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black inline-flex items-center gap-2 shadow-md shadow-indigo-600/20"
                                        >
                                            <Plus size={15} />
                                            <span>إنشاء قالب الآن</span>
                                        </button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {filteredForms.map(form => (
                                            <div
                                                key={form.id}
                                                className="bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-400 transition-all p-5 flex flex-col justify-between group"
                                            >
                                                <div>
                                                    {/* Card Header Tags */}
                                                    <div className="flex items-center justify-between gap-2 mb-3">
                                                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black ${
                                                            form.scope === 'global'
                                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                                                        }`}>
                                                            {form.scope === 'global' ? <Globe size={11} /> : <FolderKanban size={11} />}
                                                            {form.scope === 'global' ? 'قالب عام' : 'مخصص لمشروع'}
                                                        </span>

                                                        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                                                            <span>{Array.isArray(form.fields) ? form.fields.length : 0} أسئلة</span>
                                                        </div>
                                                    </div>

                                                    {/* Card Title & Description */}
                                                    <h3 className="font-black text-base text-slate-900 group-hover:text-indigo-600 transition-colors">
                                                        {form.form_name_ar || form.form_name}
                                                    </h3>
                                                    {form.form_name_ar && form.form_name && form.form_name_ar !== form.form_name && (
                                                        <p className="text-[11px] text-slate-400 font-mono mt-0.5" dir="ltr">
                                                            {form.form_name}
                                                        </p>
                                                    )}

                                                    <p className="text-xs text-slate-500 font-medium line-clamp-2 mt-2 leading-relaxed">
                                                        {form.description || 'نموذج مركزي قابل للاستيراد في المشاريع.'}
                                                    </p>

                                                    {/* Metrics Bar */}
                                                    <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-100">
                                                        <div className="bg-slate-50 p-2 rounded-xl text-center">
                                                            <span className="text-[10px] font-bold text-slate-400 block">مرات الاستيراد</span>
                                                            <span className="text-xs font-black text-slate-800">{form.import_count || 0}</span>
                                                        </div>

                                                        <div className="bg-slate-50 p-2 rounded-xl text-center">
                                                            <span className="text-[10px] font-bold text-slate-400 block">الموديول</span>
                                                            <span className="text-[10px] font-black text-indigo-700 truncate block">
                                                                {form.target_module === 'companies_list' ? 'الشركات' :
                                                                 form.target_module === 'mentors_list' ? 'المرشدين' : 'مسار الاختيار'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Card Actions */}
                                                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={(e) => handleDuplicateForm(e, form.id)}
                                                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                                            title="نسخ القالب"
                                                        >
                                                            <Copy size={15} />
                                                        </button>

                                                        <button
                                                            onClick={(e) => handleDeleteForm(e, form.id)}
                                                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                                            title="حذف القالب"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleOpenFormDetails(form, 'responses')}
                                                            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition-colors"
                                                        >
                                                            الردود
                                                        </button>

                                                        <button
                                                            onClick={() => handleOpenFormDetails(form, 'questions')}
                                                            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-sm transition-all"
                                                        >
                                                            تعديل القالب
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* CREATE NEW LIBRARY FORM MODAL */}
            {isCreateModalOpen && (
                <CreateLibraryFormModal
                    isOpen={isCreateModalOpen}
                    onClose={() => setIsCreateModalOpen(false)}
                    events={events}
                    onCreated={(newForm) => {
                        setForms(prev => [newForm, ...prev]);
                        setActiveForm(newForm);
                        setSingleFormTab('questions');
                    }}
                />
            )}

            {/* RESPONSE DETAILS MODAL */}
            {viewingResponse && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" dir="rtl">
                    <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <div>
                                <h3 className="text-sm font-black text-slate-900">تفاصيل الرد المسجل</h3>
                                <p className="text-[11px] text-slate-500 font-medium">مشروع: {viewingResponse.event_title}</p>
                            </div>
                            <button
                                onClick={() => setViewingResponse(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-3">
                            {Object.entries(viewingResponse.answers || {}).map(([key, val], idx) => (
                                <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                                    <span className="text-[11px] font-bold text-slate-400 block">{key}</span>
                                    <span className="text-xs font-black text-slate-800 break-words block">
                                        {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Sub-component: Modal to create a new form directly in the Central Library
function CreateLibraryFormModal({ isOpen, onClose, events = [], onCreated }) {
    const [formName, setFormName] = useState('');
    const [formNameAr, setFormNameAr] = useState('');
    const [description, setDescription] = useState('');
    const [scope, setScope] = useState('global');
    const [eventId, setEventId] = useState('');
    const [targetModule, setTargetModule] = useState('selection_process');
    const [creating, setCreating] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formName.trim()) return;

        try {
            setCreating(true);
            const created = await createLibraryForm({
                form_name: formName.trim(),
                form_name_ar: formNameAr.trim() || null,
                description: description.trim(),
                scope,
                event_id: scope === 'specific' ? eventId : null,
                target_module: targetModule,
                fields: [
                    { field_name: 'full_name', field_label: 'الاسم الكامل', field_type: 'text', is_required: true },
                    { field_name: 'email', field_label: 'البريد الإلكتروني', field_type: 'email', is_required: true },
                    { field_name: 'phone', field_label: 'رقم الهاتف', field_type: 'phone', is_required: false }
                ]
            });

            if (onCreated) onCreated(created);
            onClose();
        } catch (err) {
            console.error('Failed to create library form:', err);
            alert('حدث خطأ أثناء إنشاء النموذج');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" dir="rtl">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <h3 className="text-sm font-black text-slate-900">إنشاء قالب نموذج جديد في المكتبة المركزية</h3>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-1">اسم القالب (EN) *</label>
                        <input
                            type="text"
                            required
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="مثال: Accelerator Application Template"
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-600"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-1">الاسم بالعربية</label>
                        <input
                            type="text"
                            value={formNameAr}
                            onChange={(e) => setFormNameAr(e.target.value)}
                            placeholder="مثال: استمارة التقديم لمسرعة الأعمال"
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-600"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-1">الموديول المستهدف</label>
                        <select
                            value={targetModule}
                            onChange={(e) => setTargetModule(e.target.value)}
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-600"
                        >
                            <option value="selection_process">مسار الاختيار والفرز (Selection Process)</option>
                            <option value="companies_list">قائمة الشركات (Companies List)</option>
                            <option value="mentors_list">قائمة المرشدين والخبراء (Mentors)</option>
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-1">النطاق (Scope)</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => setScope('global')}
                                className={`p-3 rounded-xl border text-center transition-all ${
                                    scope === 'global' ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-black' : 'border-slate-200 text-slate-600 font-bold'
                                }`}
                            >
                                عام (جميع المشاريع)
                            </button>
                            <button
                                type="button"
                                onClick={() => setScope('specific')}
                                className={`p-3 rounded-xl border text-center transition-all ${
                                    scope === 'specific' ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-black' : 'border-slate-200 text-slate-600 font-bold'
                                }`}
                            >
                                خاص بمشروع محدد
                            </button>
                        </div>
                    </div>

                    {scope === 'specific' && (
                        <div>
                            <label className="text-xs font-black text-slate-800 block mb-1">اختر المشروع</label>
                            <select
                                required
                                value={eventId}
                                onChange={(e) => setEventId(e.target.value)}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                            >
                                <option value="">اختر مشروع...</option>
                                {events.map(ev => (
                                    <option key={ev.event_id} value={ev.event_id}>{ev.title}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-1">الوصف</label>
                        <textarea
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="وصف مختصر لمجال استخدام هذا النموذج..."
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                        />
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-100 rounded-xl"
                        >
                            إلغاء
                        </button>
                        <button
                            type="submit"
                            disabled={creating}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {creating ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                            <span>إنشاء القالب</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
