import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    ArrowLeft, Plus, Save, Trash2, GripVertical,
    Type, FileText, List, Upload, AlertCircle, Loader, ExternalLink,
    Settings, Users, Building2, ClipboardList,
    ChevronRight, X, BarChart3,
    MousePointerClick, Layers, CopyPlus, Sparkles, Image, Hash, Mail, Phone, Globe,
    BookmarkPlus
} from 'lucide-react';
import {
    getEventForms, createEventForm, deleteEventForm, updateEventForm,
    getFormConfigById, saveFormConfigById, duplicateEventForm,
    getFormSections, saveFormSections
} from '../lib/api';

// Subcomponents for the Engagement Hub
import SourceTrackingToolbar from './forms/SourceTrackingToolbar';
import FormResponsesTab from './forms/FormResponsesTab';
import FormAnalyticsTab from './forms/FormAnalyticsTab';
import FormClicksAnalyticsTab from './forms/FormClicksAnalyticsTab';
import FormIntegrationsTab from './forms/FormIntegrationsTab';
import FormSettingsTab from './forms/FormSettingsTab';
import GlobalFormsAnalytics from './forms/GlobalFormsAnalytics';
import CoverLibraryModal from './forms/CoverLibraryModal';
import ImportFromLibraryModal from './forms/ImportFromLibraryModal';
import SaveToLibraryModal from './forms/SaveToLibraryModal';
import QuestionsBuilder from './forms/QuestionsBuilder';

// ─── Constants ───────────────────────────────────────────────────────────────

const MODULE_META = {
    selection_process: {
        label: 'Engagement & Application Form',
        icon: Sparkles,
        color: 'indigo',
        badge: 'bg-indigo-100 text-indigo-700 border-indigo-200',
        dot: 'bg-indigo-500',
    },
    company: {
        label: 'Company List Form',
        icon: Building2,
        color: 'blue',
        badge: 'bg-blue-100 text-blue-700 border-blue-200',
        dot: 'bg-blue-500',
    },
    expert: {
        label: 'Expert / Mentor Form',
        icon: Users,
        color: 'purple',
        badge: 'bg-purple-100 text-purple-700 border-purple-200',
        dot: 'bg-purple-500',
    }
};

const isCoreField = (fieldName) =>
    ['startup_name', 'logo_url', 'expert_name', 'photo_url'].includes(fieldName);

const getIconForType = (type) => {
    switch (type) {
        case 'text': return <Type size={14} />;
        case 'textarea': return <FileText size={14} />;
        case 'select': return <List size={14} />;
        case 'multiselect': return <List size={14} />;
        case 'file': return <Upload size={14} />;
        case 'email': return <Mail size={14} />;
        case 'number': return <Hash size={14} />;
        case 'tel': return <Phone size={14} />;
        case 'url': return <Globe size={14} />;
        default: return <Type size={14} />;
    }
};

// ─── Create Form Modal ────────────────────────────────────────────────────────

const CreateFormModal = ({ onClose, onCreate, loading }) => {
    const [formName, setFormName] = useState('');
    const [targetModule, setTargetModule] = useState('selection_process');

    const handleSubmit = () => {
        if (!formName.trim()) return;
        onCreate(formName.trim(), targetModule);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" dir="ltr">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 sm:p-8 flex flex-col text-left">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-black text-slate-900">Create New Form</h2>
                        <p className="text-xs text-slate-400 mt-0.5">Build a standalone form and route its submissions.</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Form Name</label>
                        <input
                            type="text"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="e.g. Program Application, Mentorship Booking, Event Registration"
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-xs"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={!formName.trim() || loading}
                            onClick={handleSubmit}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
                        >
                            {loading ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                            Create Form
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Main FormEditor Engagement Hub Screen ────────────────────────────────────

export default function FormEditor() {
    const params = useParams();
    const eventId = params.eventId || params.id;
    const [forms, setForms] = useState([]);
    const [fieldCounts, setFieldCounts] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [creating, setCreating] = useState(false);
    const [duplicatingId, setDuplicatingId] = useState(null);
    const [showCoverLibraryModal, setShowCoverLibraryModal] = useState(false);
    const [showImportFromLibraryModal, setShowImportFromLibraryModal] = useState(false);
    const [showSaveToLibraryModal, setShowSaveToLibraryModal] = useState(false);
    const [libraryToast, setLibraryToast] = useState(null);

    // Navigation & editing states
    const [editingForm, setEditingForm] = useState(null);
    const [activeMainTab, setActiveMainTab] = useState('forms'); // 'forms' | 'global_analytics'
    const [activeFormTab, setActiveFormTab] = useState('questions'); 
    // Unified 6 tabs: 'questions' | 'settings' | 'responses' | 'response_analytics' | 'clicks_analytics' | 'integrations'

    // Form fields & sections state when editing a form
    const [formFields, setFormFields] = useState([]);
    const [sections, setSections] = useState([]);
    const [fieldsLoading, setFieldsLoading] = useState(false);
    const [fieldsSaving, setFieldsSaving] = useState(false);
    const [fieldsSuccess, setFieldsSuccess] = useState(false);

    useEffect(() => {
        loadForms();
    }, [eventId]);

    useEffect(() => {
        if (editingForm) {
            loadFormFields(editingForm.form_id);
        }
    }, [editingForm?.form_id]);

    const loadForms = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await getEventForms(eventId);
            setForms(data || []);

            // Load question counts in parallel
            const counts = await Promise.all(
                (data || []).map(f => getFormConfigById(f.form_id).then(fields => ({ id: f.form_id, count: fields.length })))
            );
            const countsMap = {};
            counts.forEach(({ id, count }) => { countsMap[id] = count; });
            setFieldCounts(countsMap);
        } catch (err) {
            console.error('Failed to load forms:', err);
            setError('Failed to load forms. Please try refreshing.');
        } finally {
            setLoading(false);
        }
    };

    const loadFormFields = async (formId) => {
        try {
            setFieldsLoading(true);
            const [fields, secs] = await Promise.all([
                getFormConfigById(formId),
                getFormSections(formId)
            ]);
            setFormFields(fields || []);
            setSections(secs || []);
        } catch (err) {
            console.error('Failed to load form fields and sections:', err);
        } finally {
            setFieldsLoading(false);
        }
    };

    const handleCreateForm = async (formName, targetModule) => {
        try {
            setCreating(true);
            const newForm = await createEventForm(eventId, formName, targetModule);
            setShowCreateModal(false);
            await loadForms();
            setEditingForm(newForm);
            setActiveFormTab('questions');
        } catch (err) {
            console.error('Create form failed:', err);
        } finally {
            setCreating(false);
        }
    };

    const handleDuplicate = async (e, form) => {
        e.stopPropagation();
        try {
            setDuplicatingId(form.form_id);
            const cloned = await duplicateEventForm(form.form_id);
            await loadForms();
            setEditingForm(cloned);
            setActiveFormTab('questions');
        } catch (err) {
            console.error('Duplicate form failed:', err);
            alert('Failed to duplicate form. Please try again.');
        } finally {
            setDuplicatingId(null);
        }
    };

    const handleDeleteForm = async (e, form) => {
        e.stopPropagation();
        if (!window.confirm(`Are you sure you want to delete form "${form.form_name}"?`)) return;
        try {
            await deleteEventForm(form.form_id);
            if (editingForm?.form_id === form.form_id) {
                setEditingForm(null);
            }
            await loadForms();
        } catch (err) {
            console.error('Delete form failed:', err);
        }
    };

    const handleToggleActive = async (e, form) => {
        e.stopPropagation();
        try {
            const updated = await updateEventForm(form.form_id, { is_active: !form.is_active });
            setForms(prev => prev.map(f => f.form_id === form.form_id ? { ...f, is_active: updated.is_active } : f));
            if (editingForm?.form_id === form.form_id) {
                setEditingForm(prev => ({ ...prev, is_active: updated.is_active }));
            }
        } catch (err) {
            console.error('Toggle form status failed:', err);
        }
    };

    const handleSaveQuestions = async () => {
        if (!editingForm) return;
        try {
            setFieldsSaving(true);
            setFieldsSuccess(false);
            const ordered = formFields.map((f, i) => ({ ...f, display_order: i }));
            await Promise.all([
                saveFormConfigById(editingForm.form_id, eventId, editingForm.target_module, ordered),
                saveFormSections(editingForm.form_id, sections)
            ]);
            setFieldsSuccess(true);
            setTimeout(() => setFieldsSuccess(false), 3000);
            setFieldCounts(prev => ({ ...prev, [editingForm.form_id]: ordered.length }));
        } catch (err) {
            console.error('Save questions failed:', err);
            alert('Failed to save questions.');
        } finally {
            setFieldsSaving(false);
        }
    };

    // ─── Render: Single Form Management (Unified 6 Tabs) ─────────────────────────

    if (editingForm) {
        return (
            <div className="min-h-screen bg-slate-50/70 pb-20 font-manrope text-left" dir="ltr">
                {/* Sticky Header */}
                <div className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-xs">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="flex items-center justify-between py-4">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setEditingForm(null)}
                                    className="p-2.5 rounded-2xl bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors flex items-center gap-1.5 text-xs font-bold"
                                >
                                    <ArrowLeft size={16} />
                                    <span>Back to Forms</span>
                                </button>

                                <div>
                                    <h1 className="text-lg font-black text-slate-900 truncate" dir="auto">{editingForm.form_name}</h1>
                                    <p className="text-[11px] font-bold text-slate-400">
                                        {formFields.length} questions configured
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowSaveToLibraryModal(true)}
                                    className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all border border-indigo-200"
                                    title="Save as template in Central Library"
                                >
                                    <BookmarkPlus size={14} />
                                    <span>Save to Library</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={(e) => handleDuplicate(e, editingForm)}
                                    disabled={duplicatingId === editingForm.form_id}
                                    className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                                >
                                    {duplicatingId === editingForm.form_id ? <Loader size={14} className="animate-spin" /> : <CopyPlus size={14} />}
                                    Duplicate
                                </button>

                                <a
                                    href={`#/forms/${eventId}/${editingForm.form_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-xs font-bold transition-all"
                                >
                                    <ExternalLink size={14} />
                                    Preview Form
                                </a>
                            </div>
                        </div>

                        {/* Unified 6 Tabs */}
                        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-slate-100 pt-1">
                            {[
                                { key: 'questions', label: 'Questions', icon: Type },
                                { key: 'settings', label: 'Settings & Cover', icon: Settings },
                                { key: 'responses', label: 'Responses', icon: ClipboardList },
                                { key: 'response_analytics', label: 'Response Analytics', icon: BarChart3 },
                                { key: 'clicks_analytics', label: 'Clicks & Sources', icon: MousePointerClick },
                                { key: 'integrations', label: 'Integrations', icon: Layers }
                            ].map((tab) => {
                                const Icon = tab.icon;
                                const isActive = activeFormTab === tab.key;
                                return (
                                    <button
                                        key={tab.key}
                                        type="button"
                                        onClick={() => setActiveFormTab(tab.key)}
                                        className={`flex items-center gap-2 px-4 py-3 border-b-2 text-xs font-bold whitespace-nowrap transition-all ${
                                            isActive
                                                ? 'border-blue-600 text-blue-600'
                                                : 'border-transparent text-slate-500 hover:text-slate-800'
                                        }`}
                                    >
                                        <Icon size={15} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
                    {/* Source Tracking Toolbar */}
                    <SourceTrackingToolbar
                        form={editingForm}
                        eventId={eventId}
                        onFormUpdate={(updated) => setEditingForm(updated)}
                    />

                    {/* Tab Views */}
                    {activeFormTab === 'questions' && (
                        <QuestionsBuilder
                            form={editingForm}
                            fields={formFields}
                            setFields={setFormFields}
                            sections={sections}
                            setSections={setSections}
                            saving={fieldsSaving}
                            onSave={handleSaveQuestions}
                            success={fieldsSuccess}
                            error={error}
                        />
                    )}

                    {activeFormTab === 'settings' && (
                        <FormSettingsTab
                            form={editingForm}
                            eventId={eventId}
                            fields={formFields}
                            onFormUpdate={(updated) => {
                                setEditingForm(updated);
                                setForms(prev => prev.map(f => f.form_id === updated.form_id ? updated : f));
                            }}
                        />
                    )}

                    {activeFormTab === 'responses' && (
                        <FormResponsesTab
                            form={editingForm}
                            fields={formFields}
                        />
                    )}

                    {activeFormTab === 'response_analytics' && (
                        <FormAnalyticsTab
                            form={editingForm}
                            fields={formFields}
                        />
                    )}

                    {activeFormTab === 'clicks_analytics' && (
                        <FormClicksAnalyticsTab
                            form={editingForm}
                        />
                    )}

                    {activeFormTab === 'integrations' && (
                        <FormIntegrationsTab
                            form={editingForm}
                            onFormUpdate={(updated) => setEditingForm(updated)}
                        />
                    )}
                </div>

                {/* Save to Central Library Modal */}
                {showSaveToLibraryModal && (
                    <SaveToLibraryModal
                        form={editingForm}
                        eventId={eventId}
                        isOpen={showSaveToLibraryModal}
                        onClose={() => setShowSaveToLibraryModal(false)}
                        onSuccess={(saved) => {
                            setShowSaveToLibraryModal(false);
                            setLibraryToast(`✅ تم حفظ الفورم "‎${saved?.form_name || editingForm.form_name}" في المكتبة بنجاح`);
                            setTimeout(() => setLibraryToast(null), 4000);
                        }}
                    />
                )}

                {/* Library Save Toast */}
                {libraryToast && (
                    <div
                        className="fixed bottom-6 right-6 z-[100] bg-slate-900/95 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold animate-in fade-in slide-in-from-bottom-3 backdrop-blur-sm border border-slate-700/50"
                        dir="rtl"
                    >
                        <span>{libraryToast}</span>
                    </div>
                )}
            </div>
        );
    }

    // ─── Render: Dashboard Overview Screen (Forms List + Global Project Analytics) ─

    return (
        <div className="min-h-screen bg-slate-50/70 pb-20 font-manrope text-left" dir="ltr">
            {/* Top Navigation */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-xs">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between py-5">
                        <div className="flex items-center gap-3">
                            <Link
                                to={`/events/${eventId}`}
                                className="p-2.5 rounded-2xl bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors"
                            >
                                <ArrowLeft size={18} />
                            </Link>
                            <div>
                                <h1 className="text-xl font-black text-slate-900">Form Builder & Engagement Hub</h1>
                                <p className="text-xs text-slate-500 mt-0.5">Manage custom forms, visitor tracking, and multi-channel response routing.</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setShowImportFromLibraryModal(true)}
                                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-all shadow-xs"
                            >
                                <Layers size={15} />
                                Import from Library
                            </button>

                            <button
                                type="button"
                                onClick={() => setShowCoverLibraryModal(true)}
                                className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all"
                            >
                                <Image size={15} />
                                Cover Library
                            </button>

                            <button
                                type="button"
                                onClick={() => setShowCreateModal(true)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-all shadow-md"
                            >
                                <Plus size={16} />
                                New Form
                            </button>
                        </div>
                    </div>

                    {/* Main Nav Tabs */}
                    <div className="flex items-center gap-4 border-t border-slate-100 pt-2">
                        <button
                            type="button"
                            onClick={() => setActiveMainTab('forms')}
                            className={`pb-3 text-xs font-bold border-b-2 transition-all ${
                                activeMainTab === 'forms' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            Forms Directory ({forms.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveMainTab('global_analytics')}
                            className={`pb-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                                activeMainTab === 'global_analytics' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            <BarChart3 size={14} />
                            Project Engagement Analytics
                        </button>
                    </div>
                </div>
            </div>

            {/* Dashboard Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
                {activeMainTab === 'global_analytics' ? (
                    <GlobalFormsAnalytics
                        eventId={eventId}
                        onSelectForm={(form) => {
                            setEditingForm(form);
                            setActiveFormTab('questions');
                        }}
                    />
                ) : (
                    <>
                        {loading ? (
                            <div className="py-24 text-center text-slate-400">
                                <Loader size={36} className="animate-spin mx-auto mb-3 text-blue-600" />
                                <p className="text-sm font-bold text-slate-600">Loading forms...</p>
                            </div>
                        ) : forms.length === 0 ? (
                            <div className="bg-white rounded-3xl p-16 text-center border-2 border-dashed border-slate-200">
                                <Sparkles size={48} className="mx-auto text-blue-500 mb-4" />
                                <h3 className="text-lg font-black text-slate-900 mb-1">No forms created yet</h3>
                                <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
                                    Start by creating an interactive form to collect registrations, feedback, or applications with full source tracking.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(true)}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black shadow-lg shadow-blue-500/20"
                                >
                                    Create First Form
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                {forms.map((form) => {
                                    const meta = MODULE_META[form.target_module] || MODULE_META.selection_process;
                                    const Icon = meta.icon;
                                    const qCount = fieldCounts[form.form_id] || 0;

                                    return (
                                        <div
                                            key={form.form_id}
                                            onClick={() => {
                                                setEditingForm(form);
                                                setActiveFormTab('questions');
                                            }}
                                            className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 cursor-pointer transition-all flex flex-col justify-between group space-y-5"
                                        >
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${meta.badge}`}>
                                                        <Icon size={18} />
                                                    </div>

                                                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleToggleActive(e, form)}
                                                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                                                                form.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                                                            }`}
                                                        >
                                                            {form.is_active ? 'Active' : 'Inactive'}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleDuplicate(e, form)}
                                                            disabled={duplicatingId === form.form_id}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                            title="Duplicate Form"
                                                        >
                                                            <CopyPlus size={15} />
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleDeleteForm(e, form)}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                            title="Delete Form"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </div>
                                                </div>

                                                <div>
                                                    <h3 className="text-base font-black text-slate-900 group-hover:text-blue-600 transition-colors" dir="auto">
                                                        {form.form_name}
                                                    </h3>
                                                    {form.description && (
                                                        <p className="text-xs text-slate-500 mt-1 line-clamp-2" dir="auto">
                                                            {form.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                                                <span className="font-bold">{qCount} questions</span>
                                                <span className="text-blue-600 font-bold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                                                    Manage & Responses
                                                    <ChevronRight size={14} />
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Create Form Modal */}
            {showCreateModal && (
                <CreateFormModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleCreateForm}
                    loading={creating}
                />
            )}

            {/* Cover Library Modal */}
            {showCoverLibraryModal && (
                <CoverLibraryModal
                    eventId={eventId}
                    onClose={() => setShowCoverLibraryModal(false)}
                />
            )}

            {/* Central Form Library Import Modal */}
            {showImportFromLibraryModal && (
                <ImportFromLibraryModal
                    eventId={eventId}
                    isOpen={showImportFromLibraryModal}
                    onClose={() => setShowImportFromLibraryModal(false)}
                    onImportSuccess={(newForm) => {
                        loadForms();
                        if (newForm) {
                            setEditingForm(newForm);
                            setActiveFormTab('questions');
                        }
                    }}
                />
            )}

            {/* Save to Central Library Modal */}
            {showSaveToLibraryModal && editingForm && (
                <SaveToLibraryModal
                    form={editingForm}
                    eventId={eventId}
                    isOpen={showSaveToLibraryModal}
                    onClose={() => setShowSaveToLibraryModal(false)}
                    onSuccess={(saved) => {
                        setShowSaveToLibraryModal(false);
                        setLibraryToast(`✅ تم حفظ الفورم "‎${saved?.form_name || editingForm.form_name}" في المكتبة بنجاح`);
                        setTimeout(() => setLibraryToast(null), 4000);
                    }}
                />
            )}

            {/* Library Save Toast */}
            {libraryToast && (
                <div
                    className="fixed bottom-6 right-6 z-[100] bg-slate-900/95 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold animate-in fade-in slide-in-from-bottom-3 backdrop-blur-sm border border-slate-700/50"
                    dir="rtl"
                >
                    <span>{libraryToast}</span>
                </div>
            )}
        </div>
    );
}
