import { useState, useEffect, useMemo } from 'react';
import {
    BarChart3, TrendingUp, Users, CheckCircle2,
    Calendar, Loader
} from 'lucide-react';
import { getFormResponses } from '../../lib/api';

export default function FormAnalyticsTab({ form, fields = [] }) {
    const [responses, setResponses] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, [form.form_id]);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await getFormResponses(form.form_id);
            setResponses(data || []);
        } catch (err) {
            console.error('Failed to load analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    // Calculate response statistics
    const stats = useMemo(() => {
        const total = responses.length;
        if (!total) return null;

        // Submissions over last 7 days
        const last7Days = {};
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            last7Days[key] = 0;
        }

        responses.forEach(r => {
            const dateKey = (r.submitted_at || r.created_at || '').slice(0, 10);
            if (last7Days[dateKey] !== undefined) {
                last7Days[dateKey]++;
            }
        });

        // Field completion rates
        const fieldCompletion = fields.map(f => {
            const filledCount = responses.filter(r => {
                const ans = r.answers?.[f.field_name];
                return ans !== undefined && ans !== null && ans !== '' && (!Array.isArray(ans) || ans.length > 0);
            }).length;
            const rate = Math.round((filledCount / total) * 100);
            return {
                name: f.field_label || f.field_name,
                type: f.field_type,
                filledCount,
                rate
            };
        });

        // Distribution for select / multiselect fields
        const choiceDistributions = fields
            .filter(f => ['select', 'multiselect'].includes(f.field_type))
            .map(f => {
                const counts = {};
                (f.field_options || []).forEach(opt => {
                    const label = typeof opt === 'object' ? (opt.label || opt.value) : opt;
                    counts[label] = 0;
                });

                responses.forEach(r => {
                    const ans = r.answers?.[f.field_name];
                    if (!ans) return;
                    const items = Array.isArray(ans) ? ans : [ans];
                    items.forEach(val => {
                        const matchedOpt = (f.field_options || []).find(o => (typeof o === 'object' ? o.value : o) === val);
                        const label = matchedOpt ? (typeof matchedOpt === 'object' ? (matchedOpt.label || matchedOpt.value) : matchedOpt) : val;
                        counts[label] = (counts[label] || 0) + 1;
                    });
                });

                return {
                    fieldLabel: f.field_label || f.field_name,
                    counts
                };
            });

        return {
            total,
            last7Days,
            fieldCompletion,
            choiceDistributions
        };
    }, [responses, fields]);

    if (loading) {
        return (
            <div className="py-20 text-center text-slate-400" dir="ltr">
                <Loader size={32} className="animate-spin mx-auto mb-3 text-blue-600" />
                <p className="text-sm font-bold text-slate-600">Calculating response analytics...</p>
            </div>
        );
    }

    if (!stats || stats.total === 0) {
        return (
            <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center" dir="ltr">
                <BarChart3 size={40} className="mx-auto text-slate-300 mb-3" />
                <h3 className="text-base font-black text-slate-800">No responses recorded yet</h3>
                <p className="text-xs text-slate-400 mt-1">Once visitors start submitting this form, completion metrics and charts will appear here automatically.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 text-left" dir="ltr">
            {/* Top Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">Total Submissions</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{stats.total}</h4>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">Average Field Completion</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">
                            {Math.round(stats.fieldCompletion.reduce((acc, curr) => acc + curr.rate, 0) / (stats.fieldCompletion.length || 1))}%
                        </h4>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center">
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">Active Questions</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{fields.length}</h4>
                    </div>
                </div>
            </div>

            {/* Submissions Timeline (Last 7 Days) */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-black text-slate-900">Submissions Over Last 7 Days</h4>
                        <p className="text-xs text-slate-400">Daily response intake trend</p>
                    </div>
                    <Calendar size={16} className="text-slate-400" />
                </div>

                <div className="grid grid-cols-7 gap-2 pt-4 items-end h-44 border-b border-slate-100 pb-3">
                    {Object.entries(stats.last7Days).map(([date, count]) => {
                        const maxVal = Math.max(...Object.values(stats.last7Days), 1);
                        const heightPct = Math.max((count / maxVal) * 100, 8);
                        const dayLabel = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });

                        return (
                            <div key={date} className="flex flex-col items-center gap-2 h-full justify-end group">
                                <span className="text-[11px] font-bold text-blue-600 group-hover:scale-110 transition-transform">
                                    {count}
                                </span>
                                <div
                                    style={{ height: `${heightPct}%` }}
                                    className="w-full max-w-[36px] bg-gradient-to-t from-blue-600 to-indigo-500 rounded-t-xl group-hover:brightness-110 transition-all shadow-xs"
                                />
                                <span className="text-[10px] font-bold text-slate-400">{dayLabel}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Field Completion Rates */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div>
                    <h4 className="text-sm font-black text-slate-900">Per-Question Completion Rates</h4>
                    <p className="text-xs text-slate-400">Percentage of participants who answered each field</p>
                </div>

                <div className="space-y-3">
                    {stats.fieldCompletion.map((fc, i) => (
                        <div key={i} className="space-y-1.5">
                            <div className="flex justify-between text-xs font-bold">
                                <span className="text-slate-700 truncate max-w-xs" dir="auto">{fc.name}</span>
                                <span className="text-blue-600">{fc.rate}% ({fc.filledCount} responses)</span>
                            </div>
                            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    style={{ width: `${fc.rate}%` }}
                                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500"
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Choice Breakdown */}
            {stats.choiceDistributions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {stats.choiceDistributions.map((cd, i) => (
                        <div key={i} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                            <h4 className="text-xs font-black text-slate-900 truncate" dir="auto">
                                Choice Distribution: {cd.fieldLabel}
                            </h4>
                            <div className="space-y-2">
                                {Object.entries(cd.counts).map(([choice, count]) => {
                                    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                                    return (
                                        <div key={choice} className="space-y-1">
                                            <div className="flex justify-between text-xs">
                                                <span className="font-semibold text-slate-700 truncate" dir="auto">{choice}</span>
                                                <span className="font-mono text-slate-500">{count} ({pct}%)</span>
                                            </div>
                                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    style={{ width: `${pct}%` }}
                                                    className="h-full bg-indigo-500 rounded-full"
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
