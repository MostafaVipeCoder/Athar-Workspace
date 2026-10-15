import { useState, useEffect, useMemo } from 'react';
import {
    BarChart3, Globe, Share2, Users, TrendingUp,
    FileText, Loader, ArrowUpRight, CheckCircle2
} from 'lucide-react';
import { getEventForms, getEventFormsResponses, getEventShareEvents } from '../../lib/api';

export default function GlobalFormsAnalytics({ eventId, onSelectForm }) {
    const [forms, setForms] = useState([]);
    const [allResponses, setAllResponses] = useState([]);
    const [allShareEvents, setAllShareEvents] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadGlobalData();
    }, [eventId]);

    const loadGlobalData = async () => {
        try {
            setLoading(true);
            const [formsData, responsesData, shareData] = await Promise.all([
                getEventForms(eventId),
                getEventFormsResponses(eventId),
                getEventShareEvents(eventId)
            ]);
            setForms(formsData || []);
            setAllResponses(responsesData || []);
            setAllShareEvents(shareData || []);
        } catch (err) {
            console.error('Failed to load global analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    const stats = useMemo(() => {
        const totalForms = forms.length;
        const totalSubmissions = allResponses.length;
        const totalShareClicks = allShareEvents.length;

        // Submissions by form
        const formMetrics = forms.map(f => {
            const fResponses = allResponses.filter(r => r.form_id === f.form_id);
            const fShares = allShareEvents.filter(s => s.form_id === f.form_id);
            return {
                ...f,
                responsesCount: fResponses.length,
                sharesCount: fShares.length
            };
        });

        // Global sources breakdown
        const sourceCounts = {};
        allResponses.forEach(r => {
            const src = (r.source || 'direct').toLowerCase();
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        });

        return {
            totalForms,
            totalSubmissions,
            totalShareClicks,
            formMetrics,
            sourceCounts
        };
    }, [forms, allResponses, allShareEvents]);

    if (loading) {
        return (
            <div className="py-20 text-center text-slate-400" dir="ltr">
                <Loader size={32} className="animate-spin mx-auto mb-3 text-blue-600" />
                <p className="text-sm font-bold text-slate-600">Loading project analytics overview...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in" dir="ltr">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center font-black">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">Total Form Submissions</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{stats.totalSubmissions}</h4>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center font-black">
                        <Share2 size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">Total Social Clicks</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{stats.totalShareClicks}</h4>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-black">
                        <FileText size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">Total Project Forms</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{stats.totalForms}</h4>
                    </div>
                </div>
            </div>

            {/* Global Sources Breakdown */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-black text-slate-900">Traffic Sources Breakdown</h4>
                        <p className="text-xs text-slate-400">Aggregated across all active campaign links and referral channels</p>
                    </div>
                    <Globe size={18} className="text-slate-400" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2">
                    {Object.entries(stats.sourceCounts).map(([src, count]) => {
                        const pct = stats.totalSubmissions > 0 ? Math.round((count / stats.totalSubmissions) * 100) : 0;
                        return (
                            <div key={src} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                                <span className="text-xs font-black text-slate-800 capitalize">{src}</span>
                                <p className="text-lg font-black text-blue-600 mt-1">{count}</p>
                                <span className="text-[10px] text-slate-400 font-bold">{pct}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Forms Performance Table */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-6">
                <h4 className="text-sm font-black text-slate-900">Individual Form Performance</h4>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 font-black border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3">Form Name</th>
                                <th className="px-4 py-3">Target Module</th>
                                <th className="px-4 py-3">Submissions</th>
                                <th className="px-4 py-3">Share Clicks</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {stats.formMetrics.map((fm) => (
                                <tr key={fm.form_id} className="hover:bg-slate-50/60 transition-colors">
                                    <td className="px-4 py-3 font-bold text-slate-900" dir="auto">{fm.form_name}</td>
                                    <td className="px-4 py-3 text-slate-500 font-mono">{fm.target_module}</td>
                                    <td className="px-4 py-3 font-mono font-bold text-blue-600">{fm.responsesCount}</td>
                                    <td className="px-4 py-3 font-mono font-bold text-purple-600">{fm.sharesCount}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                            fm.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                        }`}>
                                            {fm.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            type="button"
                                            onClick={() => onSelectForm(fm)}
                                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-xs font-bold transition-all flex items-center gap-1 mx-auto"
                                        >
                                            Manage Form
                                            <ArrowUpRight size={13} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
