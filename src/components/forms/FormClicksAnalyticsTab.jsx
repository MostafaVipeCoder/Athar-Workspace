import { useState, useEffect, useMemo } from 'react';
import {
    Share2, MousePointerClick, Facebook, MessageCircle,
    Linkedin, Send, Instagram, Sparkles,
    Loader, BarChart2, Globe
} from 'lucide-react';
import { getFormResponses, getFormShareEvents } from '../../lib/api';

export default function FormClicksAnalyticsTab({ form }) {
    const [responses, setResponses] = useState([]);
    const [shareEvents, setShareEvents] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, [form.form_id]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [respData, shareData] = await Promise.all([
                getFormResponses(form.form_id),
                getFormShareEvents(form.form_id)
            ]);
            setResponses(respData || []);
            setShareEvents(shareData || []);
        } catch (err) {
            console.error('Failed to load click analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    // Calculate source and share statistics
    const stats = useMemo(() => {
        const totalSubmissions = responses.length;
        const totalShareClicks = shareEvents.length;

        // 1. Sources breakdown
        const sourceCounts = {};
        responses.forEach(r => {
            const src = (r.source || 'direct').toLowerCase();
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        });

        // 2. Share platform breakdown
        const shareCounts = {
            facebook: 0,
            whatsapp: 0,
            linkedin: 0,
            telegram: 0,
            instagram: 0,
            other: 0
        };

        shareEvents.forEach(evt => {
            const plat = (evt.platform || 'other').toLowerCase();
            if (shareCounts[plat] !== undefined) {
                shareCounts[plat]++;
            } else {
                shareCounts.other++;
            }
        });

        return {
            totalSubmissions,
            totalShareClicks,
            sourceCounts,
            shareCounts
        };
    }, [responses, shareEvents]);

    const platformIcons = {
        facebook: { icon: Facebook, color: 'text-blue-600 bg-blue-50 border-blue-200' },
        whatsapp: { icon: MessageCircle, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
        linkedin: { icon: Linkedin, color: 'text-sky-700 bg-sky-50 border-sky-200' },
        telegram: { icon: Send, color: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
        instagram: { icon: Instagram, color: 'text-pink-600 bg-pink-50 border-pink-200' },
        direct: { icon: Globe, color: 'text-slate-600 bg-slate-50 border-slate-200' },
        other: { icon: Sparkles, color: 'text-purple-600 bg-purple-50 border-purple-200' }
    };

    if (loading) {
        return (
            <div className="py-20 text-center text-slate-400" dir="ltr">
                <Loader size={32} className="animate-spin mx-auto mb-3 text-blue-600" />
                <p className="text-sm font-bold text-slate-600">Analyzing traffic sources and click events...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 text-left" dir="ltr">
            {/* Top Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
                        <Globe size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">Total Attributed Responses</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{stats.totalSubmissions} submissions</h4>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center">
                        <MousePointerClick size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400">Total Viral Share Clicks</p>
                        <h4 className="text-2xl font-black text-slate-900 mt-0.5">{stats.totalShareClicks} clicks</h4>
                    </div>
                </div>
            </div>

            {/* Sources Breakdown (Where submissions came from) */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-black text-slate-900">Traffic & Submissions Breakdown by Source</h4>
                        <p className="text-xs text-slate-400">Origin channel of respondents who submitted</p>
                    </div>
                    <BarChart2 size={18} className="text-slate-400" />
                </div>

                {Object.keys(stats.sourceCounts).length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">No submissions recorded yet</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                        {Object.entries(stats.sourceCounts).map(([src, count]) => {
                            const pct = stats.totalSubmissions > 0 ? Math.round((count / stats.totalSubmissions) * 100) : 0;
                            const meta = platformIcons[src] || platformIcons.other;
                            const Icon = meta.icon;

                            return (
                                <div key={src} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${meta.color}`}>
                                                <Icon size={16} />
                                            </div>
                                            <span className="text-xs font-black text-slate-800 capitalize">{src}</span>
                                        </div>
                                        <span className="text-xs font-mono font-bold text-slate-900">{count}</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                        <div
                                            style={{ width: `${pct}%` }}
                                            className="h-full bg-blue-600 rounded-full"
                                        />
                                    </div>
                                    <div className="flex justify-end text-[10px] font-bold text-slate-400">
                                        {pct}% of submissions
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Share Buttons Clicks (After-submission Viral Activity) */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-black text-slate-900">Post-Submission Viral Share Engagement</h4>
                        <p className="text-xs text-slate-400">Clicks on social share intents from the confirmation screen</p>
                    </div>
                    <Share2 size={18} className="text-slate-400" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-2">
                    {['facebook', 'whatsapp', 'linkedin', 'telegram', 'instagram'].map((plat) => {
                        const count = stats.shareCounts[plat] || 0;
                        const pct = stats.totalShareClicks > 0 ? Math.round((count / stats.totalShareClicks) * 100) : 0;
                        const meta = platformIcons[plat] || platformIcons.other;
                        const Icon = meta.icon;

                        return (
                            <div key={plat} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col justify-between gap-3 text-center">
                                <div className="mx-auto w-10 h-10 rounded-2xl flex items-center justify-center shadow-xs border bg-white">
                                    <Icon size={20} className={meta.color.split(' ')[0]} />
                                </div>
                                <div>
                                    <h5 className="text-xs font-black text-slate-800 capitalize">{plat}</h5>
                                    <p className="text-lg font-black text-purple-700 mt-0.5">{count}</p>
                                    <p className="text-[10px] text-slate-400 font-bold">{pct}% of clicks</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
