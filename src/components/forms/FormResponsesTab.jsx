import { useState, useEffect, useMemo } from 'react';
import {
    Search, Download, Trash2, Eye, RefreshCw,
    AlertCircle, XCircle, Loader
} from 'lucide-react';
import { getFormResponses, deleteFormResponse, updateFormResponseStatus } from '../../lib/api';

export default function FormResponsesTab({ form, fields = [] }) {
    const [responses, setResponses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSource, setSelectedSource] = useState('all');
    const [selectedStatus, setSelectedStatus] = useState('all');
    const [activeResponse, setActiveResponse] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    useEffect(() => {
        loadResponses();
    }, [form.form_id]);

    const loadResponses = async () => {
        try {
            setLoading(true);
            const data = await getFormResponses(form.form_id);
            setResponses(data || []);
        } catch (err) {
            console.error('Failed to load responses:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (e, responseId) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to permanently delete this response?')) return;

        try {
            setDeletingId(responseId);
            await deleteFormResponse(responseId);
            setResponses(prev => prev.filter(r => r.response_id !== responseId));
            if (activeResponse?.response_id === responseId) {
                setActiveResponse(null);
            }
        } catch (err) {
            console.error('Failed to delete response:', err);
        } finally {
            setDeletingId(null);
        }
    };

    const handleStatusChange = async (responseId, newStatus) => {
        try {
            await updateFormResponseStatus(responseId, newStatus);
            setResponses(prev => prev.map(r => r.response_id === responseId ? { ...r, status: newStatus } : r));
            if (activeResponse?.response_id === responseId) {
                setActiveResponse(prev => ({ ...prev, status: newStatus }));
            }
        } catch (err) {
            console.error('Failed to update response status:', err);
        }
    };

    // Extract unique sources for filtering
    const uniqueSources = useMemo(() => {
        const set = new Set();
        responses.forEach(r => {
            if (r.source) set.add(r.source);
        });
        return Array.from(set);
    }, [responses]);

    // Filter responses
    const filteredResponses = useMemo(() => {
        return responses.filter(r => {
            if (selectedSource !== 'all' && (r.source || 'direct') !== selectedSource) {
                return false;
            }
            if (selectedStatus !== 'all' && r.status !== selectedStatus) {
                return false;
            }
            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase();
                const answersStr = JSON.stringify(r.answers || {}).toLowerCase();
                const sourceStr = (r.source || '').toLowerCase();
                const trackingStr = JSON.stringify(r.tracking_data || {}).toLowerCase();
                return answersStr.includes(query) || sourceStr.includes(query) || trackingStr.includes(query);
            }
            return true;
        });
    }, [responses, selectedSource, selectedStatus, searchQuery]);

    // Export to CSV
    const handleExportCSV = () => {
        if (!responses.length) return;

        const fieldKeys = fields.map(f => f.field_name);
        const fieldLabels = fields.map(f => f.field_label || f.field_name);
        const headers = ['ID', 'Source', 'Status', 'Submitted At', ...fieldLabels];

        const rows = filteredResponses.map(r => {
            const rowData = [
                r.response_id,
                r.source || 'direct',
                r.status || 'submitted',
                new Date(r.submitted_at || r.created_at).toLocaleString('en-US'),
                ...fieldKeys.map(k => {
                    const val = r.answers?.[k];
                    if (val === undefined || val === null) return '';
                    if (typeof val === 'object') return JSON.stringify(val);
                    return String(val).replace(/"/g, '""');
                })
            ];
            return rowData.map(v => `"${v}"`).join(',');
        });

        const csvContent = '\uFEFF' + [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `responses_${form.form_name}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="space-y-5 text-left" dir="ltr">
            {/* Action Bar & Stats */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center font-black">
                            {responses.length}
                        </div>
                        <div>
                            <h3 className="text-base font-black text-slate-900">Form Responses (Primary Store)</h3>
                            <p className="text-xs text-slate-500">
                                Single source of truth for this form ({filteredResponses.length} of {responses.length} responses shown)
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={loadResponses}
                            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                            title="Refresh responses"
                        >
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            Refresh
                        </button>

                        <button
                            type="button"
                            onClick={handleExportCSV}
                            disabled={!filteredResponses.length}
                            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs disabled:opacity-50"
                        >
                            <Download size={14} />
                            Export CSV
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                    <div className="relative">
                        <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search answers, sources, or tracking..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                    </div>

                    <div>
                        <select
                            value={selectedSource}
                            onChange={(e) => setSelectedSource(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        >
                            <option value="all">All Sources ({uniqueSources.length})</option>
                            {uniqueSources.map(src => (
                                <option key={src} value={src}>Source: {src}</option>
                            ))}
                        </select>
                    </div>

                </div>
            </div>

            {/* Responses Table */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="py-20 text-center text-slate-400">
                        <Loader size={32} className="animate-spin mx-auto mb-3 text-blue-600" />
                        <p className="text-sm font-bold text-slate-600">Loading responses...</p>
                    </div>
                ) : filteredResponses.length === 0 ? (
                    <div className="py-16 text-center text-slate-400">
                        <AlertCircle size={36} className="mx-auto mb-2 text-slate-300" />
                        <p className="text-sm font-bold text-slate-700">No responses matching current criteria</p>
                        <p className="text-xs text-slate-400 mt-1">New responses will appear here as soon as they are submitted.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50/80 text-slate-600 font-black border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-3.5">#</th>
                                    <th className="px-4 py-3.5">Source</th>
                                    <th className="px-4 py-3.5">Submitted At</th>
                                    {/* Show first 3-4 fields dynamically */}
                                    {fields.slice(0, 4).map(f => (
                                        <th key={f.field_name} className="px-4 py-3.5 truncate max-w-[180px]">
                                            {f.field_label || f.field_name}
                                        </th>
                                    ))}
                                    <th className="px-4 py-3.5">Status</th>
                                    <th className="px-4 py-3.5 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredResponses.map((response, idx) => {
                                    const source = response.source || 'direct';
                                    const sourceColors = {
                                        facebook: 'bg-blue-100 text-blue-700 border-blue-200',
                                        whatsapp: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                                        linkedin: 'bg-sky-100 text-sky-800 border-sky-200',
                                        instagram: 'bg-pink-100 text-pink-700 border-pink-200',
                                        telegram: 'bg-cyan-100 text-cyan-700 border-cyan-200',
                                        direct: 'bg-slate-100 text-slate-600 border-slate-200'
                                    };
                                    const badgeClass = sourceColors[source.toLowerCase()] || 'bg-purple-100 text-purple-700 border-purple-200';

                                    return (
                                        <tr
                                            key={response.response_id}
                                            onClick={() => setActiveResponse(response)}
                                            className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-3 font-mono text-slate-400">{idx + 1}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeClass}`}>
                                                    {source}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                                                {new Date(response.submitted_at || response.created_at).toLocaleString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </td>

                                            {/* Dynamic preview values with dir="auto" */}
                                            {fields.slice(0, 4).map(f => {
                                                const val = response.answers?.[f.field_name];
                                                const displayVal = val !== undefined && val !== null
                                                    ? (typeof val === 'object' ? JSON.stringify(val) : String(val))
                                                    : '-';
                                                return (
                                                    <td key={f.field_name} className="px-4 py-3 text-slate-800 font-medium truncate max-w-[180px]" dir="auto">
                                                        {displayVal}
                                                    </td>
                                                );
                                            })}

                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold capitalize ${
                                                    response.status === 'approved' ? 'bg-green-100 text-green-700' :
                                                    response.status === 'rejected' ? 'bg-red-100 text-red-700' :
                                                    response.status === 'reviewed' ? 'bg-amber-100 text-amber-700' :
                                                    'bg-slate-100 text-slate-600'
                                                }`}>
                                                    {response.status || 'submitted'}
                                                </span>
                                            </td>

                                            <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveResponse(response)}
                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                        title="View full details"
                                                    >
                                                        <Eye size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={deletingId === response.response_id}
                                                        onClick={(e) => handleDelete(e, response.response_id)}
                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                                        title="Delete response"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Response Details Modal */}
            {activeResponse && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" dir="ltr">
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                                    Response Details
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">
                                        Source: {activeResponse.source || 'direct'}
                                    </span>
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Submitted on {new Date(activeResponse.submitted_at || activeResponse.created_at).toLocaleString('en-US')}
                                </p>
                            </div>

                            <button
                                onClick={() => setActiveResponse(null)}
                                className="p-2 rounded-xl text-slate-400 hover:bg-slate-200 transition-colors"
                            >
                                <XCircle size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto flex-1 space-y-6">
                        

                            {/* Answers List with dir="auto" */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                                    Submission Answers ({Object.keys(activeResponse.answers || {}).length})
                                </h4>
                                <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden bg-white">
                                    {fields.map(field => {
                                        const ans = activeResponse.answers?.[field.field_name];
                                        return (
                                            <div key={field.field_name} className="p-4 flex flex-col gap-1 hover:bg-slate-50/50">
                                                <span className="text-xs font-bold text-slate-500" dir="auto">
                                                    {field.field_label || field.field_name}
                                                </span>
                                                <div className="text-sm font-semibold text-slate-900 mt-0.5" dir="auto">
                                                    {ans !== undefined && ans !== null && ans !== '' ? (
                                                        typeof ans === 'object' ? (
                                                            <pre className="text-xs bg-slate-50 p-2 rounded-xl border font-mono whitespace-pre-wrap text-left">
                                                                {JSON.stringify(ans, null, 2)}
                                                            </pre>
                                                        ) : (
                                                            String(ans)
                                                        )
                                                    ) : (
                                                        <span className="text-slate-400 italic text-xs font-normal">No response</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Any leftover answer keys not defined in fields */}
                                    {Object.entries(activeResponse.answers || {})
                                        .filter(([k]) => !fields.some(f => f.field_name === k))
                                        .map(([k, v]) => (
                                            <div key={k} className="p-4 flex flex-col gap-1 hover:bg-slate-50/50">
                                                <span className="text-xs font-bold text-slate-500" dir="auto">{k}</span>
                                                <div className="text-sm font-semibold text-slate-900" dir="auto">
                                                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>

                            {/* Tracking Data */}
                            {activeResponse.tracking_data && Object.keys(activeResponse.tracking_data).length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                                        Campaign & UTM Tracking Data
                                    </h4>
                                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs font-mono space-y-1">
                                        {Object.entries(activeResponse.tracking_data).map(([k, v]) => v ? (
                                            <div key={k} className="flex justify-between">
                                                <span className="text-slate-500">{k}:</span>
                                                <span className="text-slate-800 font-bold">{String(v)}</span>
                                            </div>
                                        ) : null)}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                            <button
                                type="button"
                                onClick={(e) => handleDelete(e, activeResponse.response_id)}
                                className="text-xs font-bold text-red-600 hover:text-red-700 flex items-center gap-1.5"
                            >
                                <Trash2 size={14} />
                                Delete Response
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveResponse(null)}
                                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
