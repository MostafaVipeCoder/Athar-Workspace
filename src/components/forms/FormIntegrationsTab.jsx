import { useState } from 'react';
import {
    FileSpreadsheet, ClipboardList, Building2, Users,
    ToggleLeft, ToggleRight, ShieldCheck, ArrowLeftRight,
    Save, Loader, ExternalLink, Check
} from 'lucide-react';
import { updateEventForm } from '../../lib/api';

export default function FormIntegrationsTab({ form, onFormUpdate }) {
    const [integrations, setIntegrations] = useState(form.integrations || {
        google_sheets: false,
        google_sheets_url: '',
        selection_process: form.target_module === 'selection_process',
        companies_list: false,
        mentors_list: false,
        attendees_list: false
    });
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);

    const handleToggle = (key) => {
        setIntegrations(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    const handleUrlChange = (val) => {
        setIntegrations(prev => ({
            ...prev,
            google_sheets_url: val
        }));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            const updated = await updateEventForm(form.form_id, {
                integrations: {
                    ...integrations,
                    // Keep mentors_list and attendees_list synced for backward compatibility
                    attendees_list: integrations.mentors_list || integrations.attendees_list
                }
            });
            if (onFormUpdate) onFormUpdate(updated);
            setSavedSuccess(true);
            setTimeout(() => setSavedSuccess(false), 3000);
        } catch (err) {
            console.error('Failed to update integrations:', err);
            alert('Failed to save integration settings. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6 max-w-4xl text-left" dir="ltr">
            {/* Header Box */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                            <ArrowLeftRight size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-black text-slate-900">Integrations & Response Routing</h3>
                            <p className="text-xs text-slate-500">
                                Route incoming form submissions to external tools or internal modules independently.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 shrink-0"
                    >
                        {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                        {savedSuccess ? 'Saved Successfully!' : 'Save Integrations'}
                    </button>
                </div>

                {/* Async Architecture Notice */}
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-start gap-2.5 text-xs text-slate-600">
                    <ShieldCheck size={18} className="text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                        <span className="font-bold text-slate-800">Decoupled Asynchronous Flow:</span>
                        <p className="mt-0.5 text-slate-500">
                            Responses are always recorded first in the primary form database. Active integrations receive synchronized copies in the background without impacting respondent speed or confirmation.
                        </p>
                    </div>
                </div>
            </div>

            {/* Integration Cards */}
            <div className="space-y-4">
                {/* 1. Google Sheets Integration */}
                <div className={`p-6 rounded-3xl border-2 transition-all ${
                    integrations.google_sheets ? 'border-emerald-400 bg-emerald-50/20 shadow-xs' : 'border-slate-200 bg-white'
                }`}>
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                                integrations.google_sheets ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                            }`}>
                                <FileSpreadsheet size={24} />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-black text-slate-900">Google Sheets Sync</h4>
                                    {integrations.google_sheets && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Active</span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    Automatically append new submissions as new rows to a Google Spreadsheet in real-time.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleToggle('google_sheets')}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 shrink-0"
                            aria-label="Toggle Google Sheets integration"
                        >
                            {integrations.google_sheets ? (
                                <ToggleRight size={34} className="text-emerald-600" />
                            ) : (
                                <ToggleLeft size={34} className="text-slate-300" />
                            )}
                        </button>
                    </div>

                    {/* Google Sheet URL Input Field */}
                    {integrations.google_sheets && (
                        <div className="mt-4 pt-4 border-t border-emerald-100/60 space-y-2 animate-in fade-in">
                            <label className="block text-xs font-bold text-slate-700">
                                Google Spreadsheet URL
                            </label>
                            <input
                                type="url"
                                value={integrations.google_sheets_url || ''}
                                onChange={(e) => handleUrlChange(e.target.value)}
                                placeholder="https://docs.google.com/spreadsheets/d/your-sheet-id/edit"
                                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                            />
                            <p className="text-[11px] text-slate-400">
                                Tip: Ensure the spreadsheet is accessible or shared with edit permissions with your service account.
                            </p>
                        </div>
                    )}
                </div>

                {/* 2. Selection Process Integration */}
                <div className={`p-6 rounded-3xl border-2 transition-all ${
                    integrations.selection_process ? 'border-amber-400 bg-amber-50/20 shadow-xs' : 'border-slate-200 bg-white'
                }`}>
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                                integrations.selection_process ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
                            }`}>
                                <ClipboardList size={24} />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-black text-slate-900">Selection Process Sync</h4>
                                    {integrations.selection_process && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Active</span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    Send a copy of incoming responses to the Selection Process screening board for candidate evaluation and interviews.
                                </p>
                                <p className="text-[11px] text-slate-400 pt-0.5">
                                    Disabling this stops new copies from being routed to Selection Process; past candidates already on the board remain intact.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleToggle('selection_process')}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 shrink-0"
                            aria-label="Toggle Selection Process integration"
                        >
                            {integrations.selection_process ? (
                                <ToggleRight size={34} className="text-amber-500" />
                            ) : (
                                <ToggleLeft size={34} className="text-slate-300" />
                            )}
                        </button>
                    </div>
                </div>

                {/* 3. Companies List Integration */}
                <div className={`p-6 rounded-3xl border-2 transition-all ${
                    integrations.companies_list ? 'border-blue-400 bg-blue-50/20 shadow-xs' : 'border-slate-200 bg-white'
                }`}>
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                                integrations.companies_list ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'
                            }`}>
                                <Building2 size={24} />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-black text-slate-900">Agenda Companies List</h4>
                                    {integrations.companies_list && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">Active</span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    Route startup and company submission details directly into the project's Agenda Companies directory.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleToggle('companies_list')}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 shrink-0"
                            aria-label="Toggle Companies List integration"
                        >
                            {integrations.companies_list ? (
                                <ToggleRight size={34} className="text-blue-600" />
                            ) : (
                                <ToggleLeft size={34} className="text-slate-300" />
                            )}
                        </button>
                    </div>
                </div>

                {/* 4. Mentors / Attendees List Integration */}
                <div className={`p-6 rounded-3xl border-2 transition-all ${
                    (integrations.mentors_list || integrations.attendees_list) ? 'border-purple-400 bg-purple-50/20 shadow-xs' : 'border-slate-200 bg-white'
                }`}>
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                                (integrations.mentors_list || integrations.attendees_list) ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-400'
                            }`}>
                                <Users size={24} />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-black text-slate-900">Mentors & Experts List</h4>
                                    {(integrations.mentors_list || integrations.attendees_list) && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">Active</span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    Route registrations for mentors, experts, and attendees directly into the event's Experts and Mentors directory.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                const nextVal = !(integrations.mentors_list || integrations.attendees_list);
                                setIntegrations(prev => ({
                                    ...prev,
                                    mentors_list: nextVal,
                                    attendees_list: nextVal
                                }));
                            }}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 shrink-0"
                            aria-label="Toggle Mentors List integration"
                        >
                            {(integrations.mentors_list || integrations.attendees_list) ? (
                                <ToggleRight size={34} className="text-purple-600" />
                            ) : (
                                <ToggleLeft size={34} className="text-slate-300" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
