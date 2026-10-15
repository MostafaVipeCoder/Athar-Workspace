import { useState } from 'react';
import {
    BookmarkPlus, Globe, FolderKanban, X,
    AlertCircle, CheckCircle2, Loader
} from 'lucide-react';
import { saveProjectFormToLibrary } from '../../lib/api';

export default function SaveToLibraryModal({
    form,
    eventId,
    isOpen,
    onClose,
    onSuccess
}) {
    const [formName, setFormName] = useState(form?.form_name || '');
    const [formNameAr, setFormNameAr] = useState(form?.form_name_ar || '');
    const [description, setDescription] = useState(form?.description || '');
    const [scope, setScope] = useState('global'); // 'global' | 'specific'
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);

    if (!isOpen || !form) return null;

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formName.trim()) {
            setErrorMsg('يرجى كتابة اسم القالب');
            return;
        }

        try {
            setSaving(true);
            setErrorMsg(null);

            const savedTemplate = await saveProjectFormToLibrary(form.form_id, {
                formName: formName.trim(),
                formNameAr: formNameAr.trim() || null,
                description: description.trim(),
                scope,
                eventId: scope === 'specific' ? eventId : null
            });

            if (onSuccess) {
                onSuccess(savedTemplate);
            }
            onClose();
        } catch (err) {
            console.error('Failed to save form to library:', err);
            setErrorMsg(err.message || 'فشل حفظ القالب في المكتبة. يرجى المحاولة لاحقاً.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" dir="rtl">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
                            <BookmarkPlus size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-black text-slate-900">حفظ كقالب في المكتبة المركزية</h3>
                            <p className="text-xs text-slate-500 font-medium">اجعل هذا النموذج متاحاً لإعادة الاستخدام في المستقبل</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSave} className="p-6 space-y-4">
                    {errorMsg && (
                        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs font-bold flex items-center gap-2">
                            <AlertCircle size={15} className="shrink-0" />
                            <span>{errorMsg}</span>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-1">اسم القالب (Template Name) *</label>
                        <input
                            type="text"
                            required
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="مثال: Registration Application Form"
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium focus:bg-white focus:outline-none focus:border-indigo-600 transition-all"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-1">الاسم بالعربية (اختياري)</label>
                        <input
                            type="text"
                            value={formNameAr}
                            onChange={(e) => setFormNameAr(e.target.value)}
                            placeholder="مثال: استمارة التسجيل والتقديم"
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium focus:bg-white focus:outline-none focus:border-indigo-600 transition-all"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-1">وصف القالب ومجال الاستخدام</label>
                        <textarea
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="اكتب نبذة عن هذا النموذج وما الذي يجمعه من بيانات..."
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium focus:bg-white focus:outline-none focus:border-indigo-600 transition-all"
                        />
                    </div>

                    {/* Scope Selector */}
                    <div>
                        <label className="text-xs font-black text-slate-800 block mb-2">نطاق الظهور في المكتبة (Scope)</label>
                        <div className="grid grid-cols-2 gap-3">
                            <div
                                onClick={() => setScope('global')}
                                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                                    scope === 'global'
                                        ? 'border-indigo-600 bg-indigo-50/40 shadow-sm'
                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <Globe size={16} className={scope === 'global' ? 'text-indigo-600' : 'text-slate-400'} />
                                    <span className="text-xs font-black text-slate-900">عام (Global)</span>
                                </div>
                                <p className="text-[11px] text-slate-500 font-medium">
                                    متاح لجميع المشاريع الحالية والجديدة على المنصة.
                                </p>
                            </div>

                            <div
                                onClick={() => setScope('specific')}
                                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                                    scope === 'specific'
                                        ? 'border-indigo-600 bg-indigo-50/40 shadow-sm'
                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <FolderKanban size={16} className={scope === 'specific' ? 'text-indigo-600' : 'text-slate-400'} />
                                    <span className="text-xs font-black text-slate-900">خاص بالمشروع</span>
                                </div>
                                <p className="text-[11px] text-slate-500 font-medium">
                                    يظهر فقط ضمن هذا المشروع الحالي عند الاستيراد.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                        >
                            إلغاء
                        </button>

                        <button
                            type="submit"
                            disabled={saving}
                            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                            {saving ? (
                                <>
                                    <Loader size={14} className="animate-spin" />
                                    <span>جاري الحفظ...</span>
                                </>
                            ) : (
                                <>
                                    <BookmarkPlus size={15} />
                                    <span>حفظ في المكتبة</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
