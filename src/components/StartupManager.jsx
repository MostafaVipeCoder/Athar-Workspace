import React, { useState, useEffect } from 'react';
import { X as CloseIcon, ArrowLeft, Plus, Search, Trash2, Edit2, Layout, Database, AlertCircle, ExternalLink, Users, Inbox, Clock, Eye, CheckCircle, XCircle, Loader2, Pencil, Upload, Check } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import CompanyCard from './CompanyCard';
import SyncButton from './SyncButton';
import LazyImage from './LazyImage';
import { getGoogleDriveFallbackUrls } from '../lib/utils';
import { getCompanies, createCompany, updateCompany, deleteCompany, uploadImage, getSubmissions, approveSubmission, rejectSubmission, bulkUpdateCompanies, getFormConfig, saveFormConfig } from '../lib/api';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    defaultDropAnimationSideEffects
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToFirstScrollableAncestor } from '@dnd-kit/modifiers';

const StartupManager = ({ isEmbedded = false }) => {
    const { eventId } = useParams();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [editingCompany, setEditingCompany] = useState(null);
    const [activeTab, setActiveTab] = useState('curated'); // 'curated' | 'review'
    const [submissions, setSubmissions] = useState([]);
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [showPreview, setShowPreview] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);
    const [activeId, setActiveId] = useState(null);
    const [formConfig, setFormConfig] = useState([]);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        name_ar: '',
        founder: '',
        founder_ar: '',
        role: '',
        industry: '',
        industry_ar: '',
        stage: '',
        governorate: '',
        governorate_ar: '',
        location_ar: '',
        description: '',
        description_ar: '',
        links: [],
        logo_url: '',
        display_config: {
            show_founder: true,
            show_role: true,
            show_stage: true,
            show_governorate: true,
            show_industry: true,
            show_description: true,
            show_links: true
        }
    });

    const loadData = async () => {
        try {
            setLoading(true);
            const [companiesData, configData] = await Promise.all([
                activeTab === 'curated' ? getCompanies(eventId) : getSubmissions(eventId, 'company', 'pending'),
                getFormConfig(eventId, 'company')
            ]);

            if (activeTab === 'curated') {
                setCompanies(companiesData || []);
            } else {
                setSubmissions(companiesData || []);
            }
            setFormConfig(configData || []);
            setError(null);
        } catch (err) {
            console.error('Error loading data:', err);
            setError(`Failed to fetch ${activeTab === 'curated' ? 'Company Grid' : 'Review Pulse'}.`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [eventId, activeTab]);

    const handleEdit = (company) => {
        setEditingCompany(company);

        // Normalize links: support legacy website_url and new links array
        let links = [];
        let parsedLinks = company.links;
        if (typeof parsedLinks === 'string') {
            try { parsedLinks = JSON.parse(parsedLinks); } catch (e) { parsedLinks = []; }
        }

        if (Array.isArray(parsedLinks) && parsedLinks.length > 0) {
            links = parsedLinks.map(l => ({ ...l, icon: l.icon || 'globe' }));
        } else if (company.website_url) {
            links = [{ label: 'Website', url: company.website_url, icon: 'globe' }];
        }

        setFormData({
            name: company.name || '',
            name_ar: company.name_ar || '',
            founder: company.founder || '',
            founder_ar: company.founder_ar || '',
            role: company.role || '',
            industry: company.industry || '',
            industry_ar: company.industry_ar || '',
            stage: company.stage || '',
            governorate: company.governorate || '',
            governorate_ar: company.governorate_ar || '',
            location_ar: company.location_ar || '',
            description: company.description || '',
            description_ar: company.description_ar || '',
            links,
            logo_url: company.logo_url || '',
            display_config: company.display_config || {
                show_founder: true,
                show_role: true,
                show_stage: true,
                show_governorate: true,
                show_industry: true,
                show_description: true,
                show_links: true
            }
        });
        setShowAddModal(true);
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            setIsUploading(true);
            const url = await uploadImage(file, 'startup-logos');
            setFormData(prev => ({ ...prev, logo_url: url }));
        } catch (err) {
            console.error('Error uploading logo:', err);
            alert('Failed to upload logo.');
        } finally {
            setIsUploading(false);
        }
    };

    const isFieldRequired = (fieldName) => {
        return formConfig.find(f => f.field_name === fieldName)?.is_required;
    };

    const handleApproveCompany = async (submission) => {
        try {
            setActionLoading(submission.submission_id);
            await approveSubmission(submission.submission_id, 'company');
            setSubmissions(prev => prev.filter(s => s.submission_id !== submission.submission_id));
            loadData(); // Reload companies to show the newly approved one
            alert('Company approved and added to ecosystem! ✅');
        } catch (error) {
            console.error('Error approving company:', error);
            alert('Failed to approve registration pulse.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleRejectCompany = async (submission) => {
        const reason = prompt('Reason for rejection? (Optional)');
        if (reason === null) return;

        try {
            setActionLoading(submission.submission_id);
            await rejectSubmission(submission.submission_id, 'company', reason || 'Not specified');
            setSubmissions(prev => prev.filter(s => s.submission_id !== submission.submission_id));
            alert('Registration request rejected.');
        } catch (error) {
            console.error('Error rejecting company:', error);
            alert('Failed to block registration signal.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeleteCompany = async (companyId) => {
        try {
            await deleteCompany(companyId);
            loadData();
        } catch (err) {
            console.error('Error deleting company:', err);
            alert('Failed to delete venture from the grid.');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setIsSubmitting(true);
            if (editingCompany) {
                await updateCompany(editingCompany.company_id || editingCompany.id, {
                    ...formData,
                    event_id: eventId
                });
            } else {
                await createCompany({
                    ...formData,
                    event_id: eventId,
                    sort_order: companies.length + 1
                });
            }
            setShowAddModal(false);
            setEditingCompany(null);
            setFormData({
                name: '',
                name_ar: '',
                founder: '',
                founder_ar: '',
                role: '',
                industry: '',
                industry_ar: '',
                stage: '',
                governorate: '',
                governorate_ar: '',
                location_ar: '',
                description: '',
                description_ar: '',
                links: [],
                logo_url: '',
                display_config: {
                    show_founder: true,
                    show_role: true,
                    show_stage: true,
                    show_governorate: true,
                    show_industry: true,
                    show_description: true,
                    show_links: true
                }
            });
            loadData();
        } catch (err) {
            console.error('Error saving startup:', err);
            alert('Failed to save venture.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);

        if (active.id !== over?.id) {
            const oldIndex = companies.findIndex((c) => (c.company_id || c.id) === active.id);
            const newIndex = companies.findIndex((c) => (c.company_id || c.id) === over.id);

            const newCompanies = arrayMove(companies, oldIndex, newIndex);
            setCompanies(newCompanies);

            try {
                const updates = newCompanies.map((c, index) => ({
                    company_id: c.company_id || c.id,
                    sort_order: index + 1
                }));
                await bulkUpdateCompanies(updates);
            } catch (err) {
                console.error('Error updating company order:', err);
                loadData(); // Revert on failure
            }
        }
    };

    const filteredCompanies = companies.filter(company =>
        company.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        company.industry?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const renderHeaderTop = () => (
        <div className="flex flex-col gap-4">
            {/* Top row: back + title */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(`/event/${eventId}`)}
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-[#059669] hover:border-[#059669] hover:bg-white transition-premium group tap-target shrink-0"
                    >
                        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                    </button>
                    <div>
                        <h1 className="text-xl sm:text-3xl font-black text-[#0d0e0e] tracking-tight">Company Grid</h1>
                        <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Populate your events ecosystem</p>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderActionBar = () => (
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {/* Navigation Tabs */}
            <div className={`flex p-1 bg-slate-100 rounded-2xl shrink-0 ${isSearchExpanded ? 'hidden sm:flex' : 'flex'}`}>
                <button
                    onClick={() => setActiveTab('curated')}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${activeTab === 'curated'
                        ? 'bg-white text-[#059669] shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                        }`}
                >
                    <Layout size={16} />
                    <span className="hidden xs:inline">Company Grid</span>
                </button>
                <button
                    onClick={() => setActiveTab('review')}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${activeTab === 'review'
                        ? 'bg-white text-[#059669] shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                        }`}
                >
                    <Inbox size={16} />
                    <span className="hidden xs:inline">Review Desk</span>
                    {submissions.filter(s => s.status === 'pending').length > 0 && (
                        <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                    )}
                </button>
            </div>

            <div className={`w-px h-8 bg-slate-200 hidden sm:block shrink-0 ${isSearchExpanded ? 'hidden sm:block' : 'hidden sm:block'}`} />

            <div className={`relative group shrink-0 ${isSearchExpanded ? 'flex-1 min-w-[200px]' : 'w-[50px] sm:flex-1 sm:min-w-[160px]'}`}>
                <Search className={`absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#059669] transition-colors ${isSearchExpanded ? 'block' : 'hidden sm:block'}`} size={18} />
                <input
                    type="text"
                    placeholder="Find Startups..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onBlur={() => { if (!searchTerm) setIsSearchExpanded(false) }}
                    className={`pl-12 pr-6 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium w-full ${isSearchExpanded ? 'block' : 'hidden sm:block'}`}
                    autoFocus={isSearchExpanded}
                />
                {!isSearchExpanded && (
                    <button
                        onClick={() => setIsSearchExpanded(true)}
                        className="sm:hidden w-full h-[50px] bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-[#059669] hover:bg-white transition-premium shadow-sm"
                    >
                        <Search size={20} />
                    </button>
                )}
                {isSearchExpanded && (
                    <button
                        onClick={() => { setSearchTerm(''); setIsSearchExpanded(false) }}
                        className="sm:hidden absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500"
                    >
                        <CloseIcon size={16} />
                    </button>
                )}
            </div>

            <div className={`flex items-center gap-2 sm:gap-3 shrink-0 ${isSearchExpanded ? 'hidden sm:flex' : 'flex'}`}>
                <SyncButton
                    eventId={eventId}
                    onSyncComplete={loadData}
                    className="h-[50px] sm:h-[54px]"
                />
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center justify-center w-[50px] sm:w-auto gap-2 sm:gap-3 bg-[#059669] text-white px-0 sm:px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-[#0d0e0e] hover:shadow-2xl hover:shadow-emerald-200 transition-premium group active:scale-95 tap-target"
                >
                    <Plus size={18} className="group-hover:rotate-90 transition-transform duration-500 shrink-0" />
                    <span className="hidden sm:inline">Add Company</span>
                </button>
                <button
                    onClick={() => setShowSettingsModal(true)}
                    className="w-[50px] sm:w-[54px] h-[50px] sm:h-[54px] bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-[#059669] hover:border-[#059669] hover:bg-slate-50 transition-premium shadow-sm tap-target"
                    title="Card Settings"
                >
                    <Layout size={20} />
                </button>
            </div>
        </div>
    );

    return (
        <div className={`${!isEmbedded ? 'min-h-screen bg-gray-100' : ''} font-manrope selection:bg-[#059669]/10 selection:text-[#059669]`}>
            {!isEmbedded ? (
                <div className="bg-white border-b border-slate-100 sticky top-0 z-30 shadow-sm">
                    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
                        <div className="flex flex-col gap-6">
                            {renderHeaderTop()}
                            {renderActionBar()}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-30 px-4 py-4 mb-6 shadow-premium">
                    {renderActionBar()}
                </div>
            )}


            {/* Card Settings Modal */}
            {showSettingsModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/60 backdrop-blur-sm" onClick={() => setShowSettingsModal(false)} />
                    <div className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                        <div className="p-6 md:p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 flex-shrink-0">
                            <div>
                                <h2 className="text-xl md:text-2xl font-black text-[#0d0e0e] tracking-tight">Company Card Settings</h2>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Configure visibility & constraints</p>
                            </div>
                            <button onClick={() => setShowSettingsModal(false)} className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-all">
                                <CloseIcon size={20} />
                            </button>
                        </div>

                        <div className="p-8 max-h-[60vh] overflow-y-auto">
                            <div className="space-y-4">
                                {formConfig.map((field, idx) => (
                                    <div key={field.field_name} className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-100 group hover:border-[#059669]/30 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-white rounded-2xl border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-[#059669] transition-colors">
                                                <Database size={20} />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-[#0d0e0e]">{field.field_label}</h4>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{field.field_name}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-8">
                                            <div className="flex flex-col items-center gap-2">
                                                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Card View</span>
                                                <button
                                                    onClick={() => {
                                                        const newConfig = [...formConfig];
                                                        newConfig[idx].show_in_card = !newConfig[idx].show_in_card;
                                                        setFormConfig(newConfig);
                                                    }}
                                                    className={`w-12 h-6 rounded-full transition-all relative ${field.show_in_card ? 'bg-[#059669]' : 'bg-slate-200'}`}
                                                >
                                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${field.show_in_card ? 'right-1' : 'left-1'}`} />
                                                </button>
                                            </div>
                                            <div className="flex flex-col items-center gap-2">
                                                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Required</span>
                                                <button
                                                    onClick={() => {
                                                        const newConfig = [...formConfig];
                                                        newConfig[idx].is_required = !newConfig[idx].is_required;
                                                        setFormConfig(newConfig);
                                                    }}
                                                    className={`w-12 h-6 rounded-full transition-all relative ${field.is_required ? 'bg-[#059669]' : 'bg-slate-200'}`}
                                                >
                                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${field.is_required ? 'right-1' : 'left-1'}`} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-4">
                            <button
                                onClick={() => setShowSettingsModal(false)}
                                className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all font-manrope"
                            >
                                Discard
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        setSettingsSaving(true);
                                        await saveFormConfig(eventId, 'company', formConfig);
                                        alert('Card settings synchronized! 🚀');
                                        setShowSettingsModal(false);
                                    } catch (err) {
                                        console.error('Error saving config:', err);
                                        alert('Failed to sync settings.');
                                    } finally {
                                        setSettingsSaving(false);
                                    }
                                }}
                                disabled={settingsSaving}
                                className="px-8 py-3 bg-[#0d0e0e] text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-black transition-all shadow-xl disabled:opacity-50 flex items-center gap-2"
                            >
                                {settingsSaving && <Loader2 size={14} className="animate-spin" />}
                                Sync Settings
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 text-center animate-in fade-in duration-700">
                        <div className="w-20 h-20 border-4 border-slate-100 border-t-[#059669] rounded-full animate-spin mb-8"></div>
                        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest animate-pulse">Scanning Ecosystem...</p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-32 text-center animate-in zoom-in duration-500">
                        <div className="w-24 h-24 bg-rose-50 rounded-[2rem] flex items-center justify-center text-rose-500 mb-8 border border-rose-100 shadow-xl shadow-rose-100/20">
                            <AlertCircle size={40} />
                        </div>
                        <h2 className="text-2xl font-black text-[#0d0e0e] tracking-tight mb-2 uppercase">Sync Interrupt</h2>
                        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">{error}</p>
                        <button onClick={() => window.location.reload()} className="mt-8 px-6 py-3 bg-white border border-slate-100 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-premium">Retry Initialization</button>
                    </div>
                ) : activeTab === 'curated' ? (
                    filteredCompanies.length > 0 ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            modifiers={[restrictToFirstScrollableAncestor]}
                        >
                            <SortableContext
                                items={filteredCompanies.map(c => c.company_id || c.id)}
                                strategy={rectSortingStrategy}
                                disabled={searchTerm.length > 0}
                            >
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
                                    {filteredCompanies.map(company => (
                                        <CompanyCard
                                            key={company.company_id || company.id}
                                            company={company}
                                            config={formConfig}
                                            onEdit={handleEdit}
                                            onDelete={handleDeleteCompany}
                                        />
                                    ))}
                                </div>
                            </SortableContext>

                            <DragOverlay dropAnimation={{
                                sideEffects: defaultDropAnimationSideEffects({
                                    styles: {
                                        active: {
                                            opacity: '0.5',
                                        },
                                    },
                                }),
                            }}>
                                {activeId ? (
                                    <div className="w-full max-w-sm opacity-80 pointer-events-none scale-105 transition-transform duration-300">
                                        <CompanyCard
                                            company={companies.find(c => (c.company_id || c.id) === activeId)}
                                            config={formConfig}
                                            previewMode={true}
                                        />
                                    </div>
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-32 text-center">
                            <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center text-slate-300 mb-6 border border-slate-100">
                                <Database size={32} />
                            </div>
                            <h3 className="text-xl font-black text-[#0d0e0e] tracking-tight mb-2 uppercase">Zero Signal</h3>
                            <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">No Startups detected in this quadrant.</p>
                        </div>
                    )
                ) : (
                    <div className="space-y-6">
                        {submissions.length > 0 ? (
                            <div className="grid grid-cols-1 gap-4">
                                {submissions.map((submission) => (
                                    <div key={submission.submission_id} className="bg-white rounded-[2rem] border border-slate-100 p-6 md:p-8 hover:shadow-xl transition-premium group relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1.5 h-full bg-[#059669] opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 md:gap-8">
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-6 flex-1">
                                                <div className="relative w-24 h-24 rounded-[1.5rem] overflow-hidden bg-slate-50 border border-slate-100 group-hover:scale-105 transition-transform flex-shrink-0 self-start sm:self-auto">
                                                    <LazyImage
                                                        src={submission.logo_url ? getGoogleDriveFallbackUrls(submission.logo_url)[0] : null}
                                                        urls={submission.logo_url ? getGoogleDriveFallbackUrls(submission.logo_url) : []}
                                                        alt={submission.startup_name || ''}
                                                        objectFit="contain"
                                                        padding={true}
                                                        fallback={<Database size={40} className="text-slate-200" />}
                                                    />
                                                </div>
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-3 mb-2">
                                                        <h3 className="text-2xl font-black text-[#0d0e0e] tracking-tight">{submission.startup_name}</h3>
                                                        <span className="px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-amber-100 flex items-center gap-1.5">
                                                            <Clock size={12} />
                                                            Pending Pulse
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-slate-400 uppercase tracking-widest">
                                                        <span>{submission.industry || 'Tech'}</span>
                                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                                                        <span>{submission.location || 'Remote'}</span>
                                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                                                        <span className="text-[#059669]">{new Date(submission.submitted_at).toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                                                <button
                                                    onClick={() => {
                                                        setSelectedSubmission(submission);
                                                        setShowPreview(true);
                                                    }}
                                                    className="flex-1 lg:flex-none justify-center px-6 py-4 bg-slate-50 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-premium flex items-center gap-2 border border-transparent hover:border-slate-200"
                                                >
                                                    <Eye size={16} />
                                                    Inspect
                                                </button>
                                                <button
                                                    onClick={() => handleApproveCompany(submission)}
                                                    disabled={actionLoading === submission.submission_id}
                                                    className="flex-1 lg:flex-none justify-center px-6 py-4 bg-[#059669] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-lg hover:shadow-emerald-200 transition-premium flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    {actionLoading === submission.submission_id ? (
                                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    ) : (
                                                        <CheckCircle size={16} />
                                                    )}
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => handleRejectCompany(submission)}
                                                    disabled={actionLoading === submission.submission_id}
                                                    className="flex-1 lg:flex-none justify-center px-6 py-4 bg-white text-rose-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-50 hover:text-rose-600 border border-slate-100 hover:border-rose-100 transition-premium flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    <XCircle size={16} />
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-32 text-center bg-white rounded-[3rem] border border-slate-100 border-dashed">
                                <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center text-slate-200 mb-6">
                                    <Inbox size={32} />
                                </div>
                                <h3 className="text-xl font-black text-[#0d0e0e] tracking-tight mb-2 uppercase">Inbox Balanced</h3>
                                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">No pending Startups awaiting your signal.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Deploy Startup Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-[#0d0e0e]/40 backdrop-blur-md flex items-center justify-center z-[100] p-2 sm:p-4">
                    <div className="bg-white rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-8 md:p-10 lg:p-12 shadow-2xl relative animate-in zoom-in duration-300">
                        <button
                            onClick={() => {
                                setShowAddModal(false);
                                setEditingCompany(null);
                                setFormData({
                                    startup_name: '',
                                    industry: '',
                                    stage: '',
                                    governorate: '',
                                    description: '',
                                    logo_url: '',
                                    links: [],
                                    display_config: {
                                        show_industry: true,
                                        show_stage: true,
                                        show_governorate: true,
                                        show_description: true,
                                        show_logo: true,
                                        show_links: true
                                    }
                                });
                            }}
                            className="absolute top-4 right-4 sm:top-8 sm:right-8 p-2 bg-slate-50 hover:bg-rose-50 rounded-xl text-slate-400 hover:text-rose-500 transition-all z-10"
                        >
                            <CloseIcon size={20} />
                        </button>

                        <div className="mb-6 sm:mb-10">
                            <div className="flex items-center gap-2 sm:gap-3 mb-2">
                                {editingCompany ? <Pencil size={14} className="text-[#059669]" /> : <Plus size={14} className="text-[#059669]" />}
                                <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
                                    {editingCompany ? 'Startup Modification' : 'Venture Entry'}
                                </span>
                            </div>
                            <h2 className="text-2xl sm:text-4xl font-black text-[#0d0e0e] tracking-tight leading-none">
                                {editingCompany ? 'Edit' : 'Deploy'} <span className="text-[#059669]">Startup</span>
                            </h2>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Startup Name {isFieldRequired('name') && '*'}</label>
                                    <input
                                        required={isFieldRequired('name')}
                                        type="text"
                                        placeholder="Name of venture"
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 font-arabic">اسم الشركة (بالعربية)</label>
                                    <input
                                        type="text"
                                        dir="rtl"
                                        placeholder="اسم الشركة"
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium font-arabic"
                                        value={formData.name_ar}
                                        onChange={e => setFormData({ ...formData, name_ar: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Industry / Sector {isFieldRequired('industry') && '*'}</label>
                                        <input
                                            required={isFieldRequired('industry')}
                                            type="text"
                                            placeholder="e.g. Fintech, AI"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium"
                                            value={formData.industry}
                                            onChange={e => setFormData({ ...formData, industry: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 font-arabic">القطاع / الصناعة (بالعربية)</label>
                                        <input
                                            type="text"
                                            dir="rtl"
                                            placeholder="مثال: التكنولوجيا المالية، الذكاء الاصطناعي"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium font-arabic"
                                            value={formData.industry_ar}
                                            onChange={e => setFormData({ ...formData, industry_ar: e.target.value })}
                                        />
                                    </div>
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_industry !== false}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    display_config: { ...formData.display_config, show_industry: e.target.checked }
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#059669] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#059669] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Founder Name {isFieldRequired('founder') && '*'}</label>
                                        <input
                                            required={isFieldRequired('founder')}
                                            type="text"
                                            placeholder="Founder Full Name"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium"
                                            value={formData.founder}
                                            onChange={e => setFormData({ ...formData, founder: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 font-arabic">اسم المؤسس (بالعربية)</label>
                                        <input
                                            type="text"
                                            dir="rtl"
                                            placeholder="اسم المؤسس"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium font-arabic"
                                            value={formData.founder_ar}
                                            onChange={e => setFormData({ ...formData, founder_ar: e.target.value })}
                                        />
                                    </div>
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_founder !== false}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    display_config: { ...formData.display_config, show_founder: e.target.checked }
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#059669] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#059669] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Role in Startup {isFieldRequired('role') && '*'}</label>
                                        <input
                                            required={isFieldRequired('role')}
                                            type="text"
                                            placeholder="e.g. CEO, Founder"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium"
                                            value={formData.role}
                                            onChange={e => setFormData({ ...formData, role: e.target.value })}
                                        />
                                    </div>
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_role !== false}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    display_config: { ...formData.display_config, show_role: e.target.checked }
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#059669] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#059669] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">مرحلة النمو (Stage) {isFieldRequired('stage') && '*'}</label>
                                        <select
                                            required={isFieldRequired('stage')}
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium"
                                            value={formData.stage}
                                            onChange={e => setFormData({ ...formData, stage: e.target.value })}
                                        >
                                            <option value="">Select Stage...</option>
                                            <option value="ideation">Ideation / Discovery (فكرة)</option>
                                            <option value="mvp">Validation / MVP (النموذج الأولي)</option>
                                            <option value="early_traction">Early Traction (بداية الانطلاق)</option>
                                            <option value="scaling">Scaling / Growth (النمو والتوسع)</option>
                                            <option value="mature">Mature / Established (مستقر)</option>
                                            <option value="other">Other / غير ذلك</option>
                                        </select>
                                    </div>
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_stage !== false}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    display_config: { ...formData.display_config, show_stage: e.target.checked }
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#059669] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#059669] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">المحافظة (Governorate) {isFieldRequired('governorate') && '*'}</label>
                                        <select
                                            required={isFieldRequired('governorate')}
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium appearance-none"
                                            value={formData.governorate}
                                            onChange={e => setFormData({ ...formData, governorate: e.target.value })}
                                        >
                                            <option value="">اختر المحافظة...</option>
                                            <option value="القاهرة">القاهرة</option>
                                            <option value="الجيزة">الجيزة</option>
                                            <option value="الإسكندرية">الإسكندرية</option>
                                            <option value="المنوفية">المنوفية</option>
                                            <option value="الشرقية">الشرقية</option>
                                            <option value="القليوبية">القليوبية</option>
                                            <option value="الغربية">الغربية</option>
                                            <option value="كفر الشيخ">كفر الشيخ</option>
                                            <option value="الدقهلية">الدقهلية</option>
                                            <option value="البحيرة">البحيرة</option>
                                            <option value="دمياط">دمياط</option>
                                            <option value="بورسعيد">بورسعيد</option>
                                            <option value="الإسماعيلية">الإسماعيلية</option>
                                            <option value="السويس">السويس</option>
                                            <option value="الفيوم">الفيوم</option>
                                            <option value="بني سويف">بني سويف</option>
                                            <option value="المنيا">المنيا</option>
                                            <option value="أسيوط">أسيوط</option>
                                            <option value="سوهاج">سوهاج</option>
                                            <option value="قنا">قنا</option>
                                            <option value="الأقصر">الأقصر</option>
                                            <option value="أسوان">أسوان</option>
                                            <option value="البحر الأحمر">البحر الأحمر</option>
                                            <option value="الوادي الجديد">الوادي الجديد</option>
                                            <option value="مطروح">مطروح</option>
                                            <option value="شمال سيناء">شمال سيناء</option>
                                            <option value="جنوب سيناء">جنوب سيناء</option>
                                        </select>
                                    </div>
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_governorate !== false}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    display_config: { ...formData.display_config, show_governorate: e.target.checked }
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#059669] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#059669] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Description / Bio {isFieldRequired('description') && '*'}</label>
                                    <textarea
                                        required={isFieldRequired('description')}
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium min-h-[120px]"
                                        placeholder="Describe the disruptive potential..."
                                        value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 font-arabic">الوصف / السيرة الذاتية (بالعربية)</label>
                                    <textarea
                                        dir="rtl"
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium min-h-[120px] font-arabic"
                                        placeholder="وصف الشركة..."
                                        value={formData.description_ar}
                                        onChange={e => setFormData({ ...formData, description_ar: e.target.value })}
                                    />
                                </div>
                                <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={formData.display_config?.show_description !== false}
                                            onChange={e => setFormData({
                                                ...formData,
                                                display_config: { ...formData.display_config, show_description: e.target.checked }
                                            })}
                                        />
                                        <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#059669] transition-all duration-300"></div>
                                        <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                    </div>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#059669] transition-colors">Show on Card / عرض على الكارت</span>
                                </label>
                            </div>

                            {/* Dynamic Links */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Links / روابط</label>
                                        <label className="flex items-center gap-2 cursor-pointer group/toggle opacity-60 hover:opacity-100 transition-opacity">
                                            <div className="relative scale-75 origin-left">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={formData.display_config?.show_links !== false}
                                                    onChange={e => setFormData({
                                                        ...formData,
                                                        display_config: { ...formData.display_config, show_links: e.target.checked }
                                                    })}
                                                />
                                                <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#059669] transition-all duration-300"></div>
                                                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                            </div>
                                            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400 group-hover/toggle:text-[#059669] transition-colors">Visible</span>
                                        </label>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, links: [...(prev.links || []), { label: '', url: '', icon: 'globe' }] }))}
                                        className="text-[10px] font-black uppercase tracking-widest text-[#059669] hover:text-[#0d0e0e] transition-colors flex items-center gap-1 bg-[#059669]/5 px-3 py-1.5 rounded-lg"
                                    >
                                        <Plus size={14} /> Add Link
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {(formData.links || []).map((link, idx) => (
                                        <div key={idx} className="flex gap-2 items-start p-3 bg-slate-50/50 rounded-2xl border border-slate-100/50">
                                            <div className="flex flex-col gap-2 flex-1">
                                                <div className="flex gap-2">
                                                    <select
                                                        className="w-12 px-2 py-3 bg-white border border-slate-100 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#059669]/10 transition-premium shrink-0"
                                                        value={link.icon || 'globe'}
                                                        onChange={e => {
                                                            const updated = [...formData.links];
                                                            updated[idx] = { ...updated[idx], icon: e.target.value };
                                                            setFormData(prev => ({ ...prev, links: updated }));
                                                        }}
                                                    >
                                                        <option value="globe">🌐</option>
                                                        <option value="facebook">📘</option>
                                                        <option value="linkedin">💼</option>
                                                        <option value="twitter">🐦</option>
                                                        <option value="instagram">📸</option>
                                                        <option value="youtube">📺</option>
                                                        <option value="github">💻</option>
                                                    </select>
                                                    <input
                                                        type="text"
                                                        placeholder="Label (e.g. Website)"
                                                        className="flex-1 px-4 py-3 bg-white border border-slate-100 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#059669]/10 transition-premium"
                                                        value={link.label}
                                                        onChange={e => {
                                                            const updated = [...formData.links];
                                                            updated[idx] = { ...updated[idx], label: e.target.value };
                                                            setFormData(prev => ({ ...prev, links: updated }));
                                                        }}
                                                    />
                                                </div>
                                                <input
                                                    type="url"
                                                    placeholder="https://..."
                                                    className="w-full px-4 py-3 bg-white border border-slate-100 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#059669]/10 transition-premium"
                                                    value={link.url}
                                                    onChange={e => {
                                                        const updated = [...formData.links];
                                                        updated[idx] = { ...updated[idx], url: e.target.value };
                                                        setFormData(prev => ({ ...prev, links: updated }));
                                                    }}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setFormData(prev => ({ ...prev, links: prev.links.filter((_, i) => i !== idx) }))}
                                                className="w-10 h-10 rounded-xl bg-white border border-slate-100 text-slate-400 hover:text-rose-500 hover:border-rose-200 transition-all flex items-center justify-center shrink-0 shadow-sm"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                    {(!formData.links || formData.links.length === 0) && (
                                        <p className="text-xs text-slate-400 italic px-2 py-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-center">لا يوجد روابط بعد — اضغط "Add Link" لإضافة رابط</p>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Company Logo {isFieldRequired('logo_url') && '*'}</label>
                                <div className="flex gap-3">
                                    <div className="relative flex-1">
                                        <input
                                            required={isFieldRequired('logo_url')}
                                            type="text"
                                            placeholder="Upload logo or paste URL"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/5 focus:border-[#059669] transition-premium pr-12"
                                            value={formData.logo_url}
                                            onChange={e => setFormData({ ...formData, logo_url: e.target.value })}
                                        />
                                        {formData.logo_url && (
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                                                <Check size={12} />
                                            </div>
                                        )}
                                    </div>
                                    <label className="shrink-0 flex items-center justify-center w-14 h-14 bg-white border border-slate-100 rounded-2xl text-slate-400 hover:text-[#059669] hover:border-[#059669] cursor-pointer transition-premium">
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={handleFileChange}
                                            disabled={isUploading}
                                        />
                                        {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                                    </label>
                                </div>
                            </div>

                            <div className="pt-6 flex flex-col sm:flex-row gap-3 sm:gap-4">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="order-2 sm:order-1 flex-1 px-8 py-4 sm:py-5 bg-white border border-slate-100 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-premium"
                                >
                                    Cancel
                                </button>
                                <button
                                    disabled={isSubmitting}
                                    type="submit"
                                    className="order-1 sm:order-2 flex-[2] px-8 py-4 sm:py-5 bg-[#059669] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#0d0e0e] shadow-2xl shadow-emerald-100 transition-premium flex items-center justify-center gap-3 active:scale-95"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            <span>{editingCompany ? 'Synchronizing...' : 'Deploying Venture...'}</span>
                                        </>
                                    ) : (
                                        <span>{editingCompany ? 'Update Startup' : 'Deploy to Ecosystem'}</span>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Submission Details Preview Modal */}
            {showPreview && selectedSubmission && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/40 backdrop-blur-md" onClick={() => setShowPreview(false)} />
                    <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl relative overflow-hidden animate-in zoom-in duration-300">
                        <div className="h-24 bg-gradient-to-r from-[#059669] to-[#10b981]" />
                        <div className="p-8 sm:p-12 -mt-12 relative">
                            <button
                                onClick={() => setShowPreview(false)}
                                className="absolute top-4 right-4 sm:top-12 sm:right-12 p-3 bg-white hover:bg-slate-100 rounded-2xl text-slate-400 transition-premium shadow-sm z-10"
                            >
                                <XCircle size={20} />
                            </button>
                            <div className="flex flex-col sm:flex-row justify-between items-center sm:items-start mb-6 sm:mb-10 text-center sm:text-left gap-4">
                                <div className="p-2 bg-white rounded-[2rem] shadow-xl">
                                    <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-[1.5rem] bg-slate-50 flex items-center justify-center overflow-hidden border border-slate-100">
                                        <LazyImage
                                            src={selectedSubmission.logo_url ? getGoogleDriveFallbackUrls(selectedSubmission.logo_url)[0] : null}
                                            urls={selectedSubmission.logo_url ? getGoogleDriveFallbackUrls(selectedSubmission.logo_url) : []}
                                            alt={selectedSubmission.startup_name || ''}
                                            objectFit="contain"
                                            padding={true}
                                            fallback={<Database size={40} className="text-slate-200" />}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="mb-8 text-center sm:text-left">
                                <h2 className="text-2xl sm:text-3xl font-black text-[#0d0e0e] tracking-tight mb-2 break-all">{selectedSubmission.startup_name}</h2>
                                <p className="text-slate-500 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
                                    <Clock size={14} /> Submitting Pulse from Form Link
                                </p>
                            </div>
                            <div className="space-y-6 max-h-[40vh] overflow-y-auto pr-4 custom-scrollbar mb-10">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-6 bg-slate-50 rounded-2xl col-span-2">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Company Persona / Description</p>
                                        <p className="font-bold text-[#0d0e0e] leading-relaxed italic">
                                            {selectedSubmission.description || selectedSubmission.additional_data?.description || selectedSubmission.additional_data?.bio || "No description provided."}
                                        </p>
                                    </div>
                                    <div className="p-6 bg-slate-50 rounded-2xl">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Industry</p>
                                        <p className="font-bold text-[#0d0e0e]">{selectedSubmission.industry || 'Not Specified'}</p>
                                    </div>
                                    <div className="p-6 bg-slate-50 rounded-2xl">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Location</p>
                                        <p className="font-bold text-[#0d0e0e]">{selectedSubmission.location || 'Not Specified'}</p>
                                    </div>
                                </div>
                                {selectedSubmission.additional_data && (
                                    <div className="space-y-4">
                                        <p className="text-[10px] font-black text-[#059669] uppercase tracking-[0.2em]">Transmission Payload</p>
                                        <div className="grid grid-cols-1 gap-3">
                                            {Object.entries(selectedSubmission.additional_data).map(([key, value]) => {
                                                if (key === '_column_order' || key === 'description' || key === 'bio' || typeof value === 'object') return null;
                                                return (
                                                    <div key={key} className="p-5 bg-slate-50 border border-slate-100 rounded-2xl">
                                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{key.replace(/_/g, ' ')}</p>
                                                        <p className="font-bold text-[#0d0e0e] break-words">{String(value)}</p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>


                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => {
                                        handleApproveCompany(selectedSubmission);
                                        setShowPreview(false);
                                    }}
                                    className="flex-1 py-5 bg-[#059669] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-[#0d0e0e] transition-premium shadow-xl shadow-emerald-200/50"
                                >
                                    Authorize Entry
                                </button>
                                <button
                                    onClick={() => {
                                        handleRejectCompany(selectedSubmission);
                                        setShowPreview(false);
                                    }}
                                    className="px-10 py-5 bg-white text-rose-500 border border-slate-100 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-rose-50 transition-premium"
                                >
                                    Block
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StartupManager;
