import { useState, useEffect, useMemo } from 'react';
import {
    BarChart3, Layers, Users, FolderKanban,
    Globe, TrendingUp, Sparkles, RefreshCw,
    Search, ArrowUpRight, CheckCircle2, Loader,
    FileText, Calendar, PieChart
} from 'lucide-react';
import { getLibraryAnalytics } from '../../lib/api';

export default function LibraryAnalyticsDashboard({ onSelectForm }) {
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [searchFilter, setSearchFilter] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await getLibraryAnalytics();
            setAnalytics(data);
        } catch (err) {
            console.error('Failed to load library analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    const filteredForms = useMemo(() => {
        if (!analytics?.formStats) return [];
        if (!searchFilter.trim()) return analytics.formStats;

        const q = searchFilter.toLowerCase();
        return analytics.formStats.filter(f =>
            (f.form_name || '').toLowerCase().includes(q) ||
            (f.form_name_ar || '').toLowerCase().includes(q) ||
            (f.target_module || '').toLowerCase().includes(q)
        );
    }, [analytics, searchFilter]);

    if (loading) {
        return (
            <div className="py-24 text-center" dir="rtl">
                <Loader size={36} className="animate-spin mx-auto mb-3 text-indigo-600" />
                <p className="text-sm font-bold text-slate-600">جاري تجميع تحليلات مكتبة الفورمز المركزية عبر جميع المشاريع...</p>
            </div>
        );
    }

    const { totalForms = 0, totalImports = 0, totalResponses = 0, projectActivity = {} } = analytics || {};
    const sortedProjects = Object.entries(projectActivity).sort((a, b) => b[1] - a[1]);

    return (
        <div className="space-y-8 animate-in fade-in" dir="rtl">
            {/* Top KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black">
                        <Layers size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">إجمالي نماذج المكتبة</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{totalForms}</h4>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-black">
                        <FolderKanban size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">مرات الاستيراد للمشاريع</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{totalImports}</h4>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">إجمالي الردود المجمعة</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{totalResponses}</h4>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-black">
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">متوسط الردود لكل نموذج</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">
                            {totalForms > 0 ? (totalResponses / totalForms).toFixed(1) : '0'}
                        </h4>
                    </div>
                </div>
            </div>

            {/* Project Adoption Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                                <PieChart size={18} className="text-indigo-600" />
                                توزيع الردود حسب المشاريع
                            </h3>
                        </div>

                        {sortedProjects.length === 0 ? (
                            <p className="text-xs text-slate-400 py-8 text-center font-medium">
                                لم يتم تسجيل أي ردود حتى الآن في المشاريع المرتبطة.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {sortedProjects.map(([projName, count]) => {
                                    const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;
                                    return (
                                        <div key={projName} className="space-y-1">
                                            <div className="flex justify-between text-xs font-bold text-slate-700">
                                                <span>{projName}</span>
                                                <span className="text-slate-500">{count} رد ({pct}%)</span>
                                            </div>
                                            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                                <div
                                                    className="bg-indigo-600 h-2 rounded-full transition-all duration-500"
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-100 text-[11px] text-slate-400 font-medium">
                        تتجمع هذه الردود تلقائياً من أي مشروع استورد النموذج مع خيار ربط الردود.
                    </div>
                </div>

                {/* Form Performance Detailed Breakdown */}
                <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                                <BarChart3 size={18} className="text-indigo-600" />
                                أداء النماذج ومعدلات الاستيراد عبر المنصة
                            </h3>

                            <div className="relative">
                                <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    placeholder="بحث في النماذج..."
                                    className="pr-8 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:border-indigo-600"
                                />
                            </div>
                        </div>

                        {filteredForms.length === 0 ? (
                            <div className="py-12 text-center text-slate-400 text-xs font-bold">
                                لا توجد نماذج متطابقة مع البحث
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-right text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-slate-400 font-bold">
                                            <th className="pb-3 pr-2">اسم النموذج</th>
                                            <th className="pb-3 px-2">النطاق</th>
                                            <th className="pb-3 px-2 text-center">مرات الاستيراد</th>
                                            <th className="pb-3 px-2 text-center">إجمالي الردود</th>
                                            <th className="pb-3 px-2">أعلى مشروع نشاطاً</th>
                                            <th className="pb-3 pl-2 text-left">إجراء</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                                        {filteredForms.map(form => {
                                            const projEntries = Object.entries(form.projectDistribution || {}).sort((a, b) => b[1] - a[1]);
                                            const topProject = projEntries.length > 0 ? `${projEntries[0][0]} (${projEntries[0][1]})` : '—';

                                            return (
                                                <tr key={form.id} className="hover:bg-slate-50/70 transition-colors">
                                                    <td className="py-3.5 pr-2 font-black text-slate-900">
                                                        <div>{form.form_name_ar || form.form_name}</div>
                                                        {form.form_name_ar && form.form_name && form.form_name_ar !== form.form_name && (
                                                            <div className="text-[10px] text-slate-400 font-mono" dir="ltr">{form.form_name}</div>
                                                        )}
                                                    </td>
                                                    <td className="py-3.5 px-2">
                                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black ${
                                                            form.scope === 'global'
                                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                                                        }`}>
                                                            {form.scope === 'global' ? <Globe size={10} /> : <FolderKanban size={10} />}
                                                            {form.scope === 'global' ? 'عام' : 'مخصص'}
                                                        </span>
                                                    </td>
                                                    <td className="py-3.5 px-2 text-center font-black text-indigo-600">
                                                        {form.totalImports || 0}
                                                    </td>
                                                    <td className="py-3.5 px-2 text-center font-black text-emerald-600">
                                                        {form.totalResponses || 0}
                                                    </td>
                                                    <td className="py-3.5 px-2 text-slate-500 text-[11px] font-bold">
                                                        {topProject}
                                                    </td>
                                                    <td className="py-3.5 pl-2 text-left">
                                                        <button
                                                            onClick={() => onSelectForm && onSelectForm(form)}
                                                            className="px-2.5 py-1 text-[11px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                                                        >
                                                            عرض الردود
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

                    <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-xs text-slate-400 font-medium">
                        <span>إجمالي النماذج المعروضة: {filteredForms.length}</span>
                        <button
                            onClick={loadData}
                            className="inline-flex items-center gap-1 text-slate-600 hover:text-indigo-600 font-bold transition-colors"
                        >
                            <RefreshCw size={13} />
                            تحديث البيانات
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
