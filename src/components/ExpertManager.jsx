import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Search, Trash2, Edit2, Layout, Database, AlertCircle, ExternalLink, Users, Inbox, Clock, Eye, CheckCircle, XCircle, Loader2, Pencil, Upload, Check, X, Briefcase } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import ExpertCard from './ExpertCard';
import SyncButton from './SyncButton';
import { 
    getExperts, createExpert, updateExpert, deleteExpert, 
    uploadImage, getSubmissions, approveSubmission, rejectSubmission,
    bulkUpdateExperts, getFormConfig, saveFormConfig, getMasterExperts,
    getEvent, updateEvent
} from '../lib/api';
import { getGoogleDriveFallbackUrls } from '../lib/utils';
import LazyImage from './LazyImage';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy as _verticalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToFirstScrollableAncestor } from '@dnd-kit/modifiers';

const ExpertManager = ({ isEmbedded = false }) => {
    const { eventId } = useParams();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [experts, setExperts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [_selectedFile, _setSelectedFile] = useState(null);
    const [editingExpert, setEditingExpert] = useState(null);
    const [activeTab, setActiveTab] = useState('curated'); // 'curated' | 'review'
    const [submissions, setSubmissions] = useState([]);
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [showPreview, setShowPreview] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);
    const [activeId, setActiveId] = useState(null);
    const [formConfig, setFormConfig] = useState([]);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [showLibraryModal, setShowLibraryModal] = useState(false);
    const [libraryExperts, setLibraryExperts] = useState([]);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [isSearchExpanded, _setIsSearchExpanded] = useState(false);

    // Event custom settings states
    const [event, setEvent] = useState(null);
    const [tempLabel, setTempLabel] = useState('');
    const [tempLabelAr, setTempLabelAr] = useState('');
    const [tempHideTitle, setTempHideTitle] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        name_ar: '',
        title: '',
        title_ar: '',
        company: '',
        company_ar: '',
        bio: '',
        bio_ar: '',
        linkedin_url: '',
        photo_url: '',
        display_config: {
            show_title: true,
            show_company: true,
            show_bio: true,
            show_linkedin: true,
            show_photo: true
        }
    });

    // DnD Sensors
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

    const loadData = async () => {
        try {
            setLoading(true);
            const [expertsData, configData, eventData] = await Promise.all([
                activeTab === 'curated' ? getExperts(eventId) : getSubmissions(eventId, 'expert', 'pending'),
                getFormConfig(eventId, 'expert'),
                getEvent(eventId)
            ]);
            
            if (activeTab === 'curated') {
                setExperts(expertsData || []);
            } else {
                setSubmissions(expertsData || []);
            }
            setFormConfig(configData || []);
            setEvent(eventData);
            setError(null);
        } catch (err) {
            console.error('Error loading data:', err);
            setError(`Failed to establish link with ${activeTab === 'curated' ? 'Expert Grid' : 'Review Pulse'}.`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId, activeTab]);

    // Initialize custom event settings when settings modal opens
    useEffect(() => {
        if (showSettingsModal && event) {
            const hs = event.header_settings || {};
            setTempLabel(hs.customExpertsLabel || '');
            setTempLabelAr(hs.customExpertsLabelAr || '');
            setTempHideTitle(!!hs.hideExpertListTitle);
        }
    }, [showSettingsModal, event]);

    const handleEdit = (expert) => {
        setEditingExpert(expert);
        setFormData({
            name: expert.name || '',
            name_ar: expert.name_ar || '',
            title: expert.title || '',
            title_ar: expert.title_ar || '',
            company: expert.company || '',
            company_ar: expert.company_ar || '',
            bio: expert.bio || '',
            bio_ar: expert.bio_ar || '',
            linkedin_url: expert.linkedin_url || '',
            photo_url: expert.photo_url || '',
            display_config: (typeof expert.display_config === 'string' ? JSON.parse(expert.display_config) : expert.display_config) || {
                show_title: true,
                show_company: true,
                show_bio: true,
                show_linkedin: true,
                show_photo: true
            }
        });
        setShowAddModal(true);
    };
    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            setIsUploading(true);
            const publicUrl = await uploadImage(file, `experts/${eventId}`);
            setFormData(prev => ({ ...prev, photo_url: publicUrl }));
        } catch (err) {
            console.error('Error uploading image:', err);
            alert('Failed to upload image. Signal lost.');
        } finally {
            setIsUploading(false);
        }
    };

    const isFieldRequired = (fieldName) => {
        return formConfig.find(f => f.field_name === fieldName)?.is_required;
    };

    const handleDeleteExpert = async (expertId) => {
        try {
            await deleteExpert(expertId);
            loadData();
        } catch (err) {
            console.error('Error deleting expert:', err);
            alert('Failed to delete expert from the grid.');
        }
    };

    const handleApproveExpert = async (submission) => {
        try {
            setActionLoading(submission.submission_id);
            await approveSubmission(submission.submission_id, 'expert');
            setSubmissions(prev => prev.filter(s => s.submission_id !== submission.submission_id));
            alert('Expert approved and added to event! ✅');
        } catch (error) {
            console.error('Error approving expert:', error);
            alert('Failed to approve registration pulse.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleRejectExpert = async (submission) => {
        const reason = prompt('Reason for rejection? (Optional)');
        if (reason === null) return;

        try {
            setActionLoading(submission.submission_id);
            await rejectSubmission(submission.submission_id, 'expert', reason || 'Not specified');
            setSubmissions(prev => prev.filter(s => s.submission_id !== submission.submission_id));
            alert('Registration request rejected.');
        } catch (error) {
            console.error('Error rejecting expert:', error);
            alert('Failed to block registration signal.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleImportFromLibrary = async (masterExpert) => {
        try {
            setActionLoading(masterExpert.id);
            // Check if already in experts
            const exists = experts.some(e => e.master_id === masterExpert.id);
            if (exists) {
                alert('Expert already present in event.');
                return;
            }

            await createExpert({
                name: masterExpert.name,
                name_ar: masterExpert.name_ar,
                title: masterExpert.title,
                title_ar: masterExpert.title_ar,
                company: masterExpert.company,
                company_ar: masterExpert.company_ar,
                bio: masterExpert.bio,
                bio_ar: masterExpert.bio_ar,
                photo_url: masterExpert.photo_url,
                linkedin_url: masterExpert.linkedin_url,
                event_id: eventId,
                master_id: masterExpert.id,
                sort_order: experts.length + 1
            });

            loadData();
            alert(`Sourced ${masterExpert.name} from hub! 🚀`);
        } catch (error) {
            console.error('Error importing from hub:', error);
            alert('Failed to establish hub connection.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setIsSubmitting(true);
            if (editingExpert) {
                await updateExpert(editingExpert.expert_id || editingExpert.id, {
                    ...formData,
                    event_id: eventId
                });
            } else {
                await createExpert({
                    ...formData,
                    event_id: eventId,
                    sort_order: experts.length + 1
                });
            }
            setShowAddModal(false);
            setEditingExpert(null);
            setFormData({ 
                name: '', 
                name_ar: '',
                title: '', 
                title_ar: '',
                company: '', 
                company_ar: '',
                bio: '', 
                bio_ar: '',
                linkedin_url: '', 
                photo_url: '',
                display_config: {
                    show_title: true,
                    show_company: true,
                    show_bio: true,
                    show_linkedin: true,
                    show_photo: true
                }
            });
            loadData();
        } catch (err) {
            console.error('Error saving expert:', err);
            alert('Failed to save expert vision.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const filteredExperts = experts.filter(expert =>
        expert.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        expert.company?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        
        if (!over || active.id === over.id) return;

        const oldIndex = experts.findIndex(e => (e.expert_id || e.id) === active.id);
        const newIndex = experts.findIndex(e => (e.expert_id || e.id) === over.id);

        const newExperts = arrayMove(experts, oldIndex, newIndex);
        setExperts(newExperts);

        // Persist to database
        const updates = newExperts.map((expert, index) => ({
            expert_id: expert.expert_id || expert.id,
            sort_order: index + 1
        }));

        try {
            await bulkUpdateExperts(updates);
        } catch (err) {
            console.error('Failed to sync expert order:', err);
        }
    };

    const renderActionBar = () => (
        <>
            {/* Navigation Tabs */}
            <div className={`flex p-1 bg-slate-100 rounded-2xl shrink-0 ${isSearchExpanded ? 'hidden sm:flex' : 'flex'}`}>
                <button
                    onClick={() => setActiveTab('curated')}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${activeTab === 'curated'
                        ? 'bg-white text-[#1a27c9] shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                        }`}
                >
                    <Users size={16} />
                    <span className="hidden xs:inline">Expert Grid</span>
                </button>
                <button
                    onClick={() => setActiveTab('review')}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${activeTab === 'review'
                        ? 'bg-white text-[#1a27c9] shadow-sm'
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

            <div className={`relative group w-full lg:flex-1 lg:min-w-[200px] order-3 lg:order-2`}>
                <Search className={`absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1a27c9] transition-colors`} size={18} />
                <input
                    type="text"
                    placeholder="Search experts..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={`pl-12 pr-6 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium w-full`}
                />
            </div>

            <div className={`flex items-center gap-2 sm:gap-3 shrink-0 order-2 lg:order-3 ml-auto`}>
                <SyncButton
                    eventId={eventId}
                    onSyncComplete={loadData}
                    className="h-[50px] sm:h-[54px]"
                />
                <button
                    onClick={() => {
                        setShowLibraryModal(true);
                        if (libraryExperts.length === 0) {
                            setLibraryLoading(true);
                            getMasterExperts().then(data => {
                                setLibraryExperts(data || []);
                                setLibraryLoading(false);
                            });
                        }
                    }}
                    className="flex items-center justify-center w-[50px] sm:w-auto gap-2 sm:gap-3 bg-white text-athar-blue border border-athar-blue/20 px-0 sm:px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-athar-blue/5 transition-premium group active:scale-95 shadow-sm tap-target"
                >
                    <Users size={18} className="group-hover:scale-110 transition-transform shrink-0" />
                    <span className="hidden sm:inline">Import from Network</span>
                </button>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center justify-center w-[50px] sm:w-auto gap-2 sm:gap-3 bg-[#1a27c9] text-white px-0 sm:px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-[#0d0e0e] hover:shadow-2xl hover:shadow-indigo-200 transition-premium group active:scale-95 tap-target"
                >
                    <Plus size={18} className="group-hover:rotate-90 transition-transform duration-500 shrink-0" />
                    <span className="hidden sm:inline">Add Expert</span>
                </button>
                <button
                    onClick={() => setShowSettingsModal(true)}
                    className="w-[50px] sm:w-[54px] h-[50px] sm:h-[54px] bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-[#1a27c9] hover:border-[#1a27c9] hover:bg-slate-50 transition-premium shadow-sm tap-target"
                    title="Card Settings"
                >
                    <Layout size={20} />
                </button>
            </div>
        </>
    );

    return (
        <div className={`${!isEmbedded ? 'min-h-screen bg-gray-200' : ''} font-manrope selection:bg-[#1a27c9]/10 selection:text-[#1a27c9]`}>
            {/* Header Area */}
            {!isEmbedded ? (
                <div className="bg-white border-b border-slate-100 sticky top-0 z-30 shadow-sm">
                    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
                        <div className="flex flex-col gap-4">
                            {/* Top row: back + title */}
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => navigate(`/event/${eventId}`)}
                                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-[#1a27c9] hover:border-[#1a27c9] hover:bg-white transition-premium group tap-target shrink-0"
                                    >
                                        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                                    </button>
                                    <div>
                                        <h1 className="text-xl sm:text-3xl font-black text-[#0d0e0e] tracking-tight">Mentors Hub</h1>
                                        <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Curate your events visionaries &amp; speakers</p>
                                    </div>
                                </div>
                            </div>

                            {/* Bottom row: tabs + search + actions */}
                            <div className="flex flex-wrap items-center gap-3 sm:gap-4 pb-2 sm:pb-0">
                                {renderActionBar()}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
                    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                            {renderActionBar()}
                        </div>
                    </div>
                </div>
            )}

            {/* Card Settings Modal */}
            {showSettingsModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/60 backdrop-blur-sm" onClick={() => setShowSettingsModal(false)} />
                    <div className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-[3rem] shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-300 flex flex-col">
                        <div className="p-6 sm:p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 flex-shrink-0">
                            <div>
                                <h2 className="text-xl sm:text-2xl font-black text-[#0d0e0e] tracking-tight">Expert Card Settings</h2>
                                <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Configure visibility & constraints</p>
                            </div>
                            <button onClick={() => setShowSettingsModal(false)} className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-all flex-shrink-0">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 sm:p-8 overflow-y-auto">
                            <div className="space-y-4">
                                {formConfig.map((field, idx) => (
                                    <div key={field.field_name} className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-100 group hover:border-[#1a27c9]/30 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-white rounded-2xl border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-[#1a27c9] transition-colors">
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
                                                    className={`w-12 h-6 rounded-full transition-all relative ${field.show_in_card ? 'bg-[#1a27c9]' : 'bg-slate-200'}`}
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
                                                    className={`w-12 h-6 rounded-full transition-all relative ${field.is_required ? 'bg-[#1a27c9]' : 'bg-slate-200'}`}
                                                >
                                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${field.is_required ? 'right-1' : 'left-1'}`} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                
                                {/* Custom Tab & Title settings */}
                                <div className="space-y-4 pt-6 border-t border-slate-100 mt-6">
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Tab & Header Customization</h3>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Custom Tab Name (EN)</label>
                                            <input
                                                type="text"
                                                value={tempLabel}
                                                onChange={(e) => setTempLabel(e.target.value)}
                                                placeholder="e.g. Experts, Speakers, Mentors"
                                                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-bold text-slate-700 text-sm"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1 text-right">الاسم المخصص للتبويب (AR)</label>
                                            <input
                                                type="text"
                                                value={tempLabelAr}
                                                onChange={(e) => setTempLabelAr(e.target.value)}
                                                placeholder="مثال: الخبراء، المتحدثين، الموجهين"
                                                dir="rtl"
                                                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1a27c9] focus:bg-white transition-premium font-bold text-slate-700 text-sm text-right"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-100 group hover:border-[#1a27c9]/30 transition-all mt-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-white rounded-2xl border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-[#1a27c9] transition-colors">
                                                <Eye size={20} />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-[#0d0e0e]">Hide 'EXPERT LIST' Header</h4>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Do not display the section title header on the public view</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setTempHideTitle(!tempHideTitle)}
                                            className={`w-12 h-6 rounded-full transition-all relative ${tempHideTitle ? 'bg-[#1a27c9]' : 'bg-slate-200'}`}
                                        >
                                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${tempHideTitle ? 'right-1' : 'left-1'}`} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-4 font-manrope">
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
                                        // Save form configuration
                                        await saveFormConfig(eventId, 'expert', formConfig);
                                        
                                        // Save custom event settings
                                        const updatedHeaderSettings = {
                                            ...(event?.header_settings || {}),
                                            customExpertsLabel: tempLabel.trim(),
                                            customExpertsLabelAr: tempLabelAr.trim(),
                                            hideExpertListTitle: tempHideTitle,
                                        };
                                        const updatedEvent = await updateEvent(eventId, { header_settings: updatedHeaderSettings });
                                        setEvent(updatedEvent);

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
                        <div className="w-20 h-20 border-4 border-slate-100 border-t-[#1a27c9] rounded-full animate-spin mb-8"></div>
                        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest animate-pulse">Establishing Visionary Signal...</p>
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
                ) : activeTab === 'curated' && filteredExperts.length > 0 ? (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToFirstScrollableAncestor]}
                    >
                        <SortableContext
                            items={filteredExperts.map(e => e.expert_id || e.id)}
                            strategy={rectSortingStrategy}
                        >
                            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-8">
                                {filteredExperts.map(expert => (
                                    <ExpertCard
                                        key={expert.expert_id || expert.id}
                                        expert={expert}
                                        config={formConfig}
                                        onEdit={handleEdit}
                                        onDelete={handleDeleteExpert}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                        <DragOverlay adjustScale={true}>
                            {activeId && (
                                <ExpertCard
                                    expert={experts.find(e => (e.expert_id || e.id) === activeId)}
                                    config={formConfig}
                                    previewMode={true}
                                />
                            )}
                        </DragOverlay>
                    </DndContext>
                ) : activeTab === 'review' ? (
                    <div className="space-y-6">
                        {submissions.length > 0 ? (
                            <div className="grid grid-cols-1 gap-4">
                                {submissions.map((submission) => (
                                    <div key={submission.submission_id} className="bg-white rounded-[2rem] border border-slate-100 p-8 hover:shadow-xl transition-premium group relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1.5 h-full bg-[#1a27c9] opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                                            <div className="flex items-center gap-6 flex-1">
                                                <div className="relative w-24 h-24 rounded-[1.5rem] overflow-hidden bg-slate-50 border border-slate-100 group-hover:scale-105 transition-transform flex-shrink-0 aspect-square">
                                                    <LazyImage
                                                        src={submission.photo_url ? getGoogleDriveFallbackUrls(submission.photo_url)[0] : null}
                                                        urls={submission.photo_url ? getGoogleDriveFallbackUrls(submission.photo_url) : []}
                                                        alt=""
                                                        objectFit="cover"
                                                        className="w-full h-full"
                                                        fallback={
                                                            <div className="w-full h-full flex items-center justify-center text-slate-200">
                                                                <Users size={40} />
                                                            </div>
                                                        }
                                                    />
                                                </div>
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-3 mb-2">
                                                        <h3 className="text-2xl font-black text-[#0d0e0e] tracking-tight">{submission.expert_name}</h3>
                                                        <span className="px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-amber-100 flex items-center gap-1.5">
                                                            <Clock size={12} />
                                                            Pending Pulse
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-slate-400 uppercase tracking-widest">
                                                        <span>{submission.title}</span>
                                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                                                        <span>{submission.company}</span>
                                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                                                        <span className="text-[#1a27c9]">{new Date(submission.submitted_at).toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-3">
                                                <button
                                                    onClick={() => {
                                                        setSelectedSubmission(submission);
                                                        setShowPreview(true);
                                                    }}
                                                    className="px-6 py-4 bg-slate-50 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-premium flex items-center gap-2 border border-transparent hover:border-slate-200"
                                                >
                                                    <Eye size={16} />
                                                    Inspect
                                                </button>
                                                <button
                                                    onClick={() => handleApproveExpert(submission)}
                                                    disabled={actionLoading === submission.submission_id}
                                                    className="px-6 py-4 bg-emerald-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#0d0e0e] hover:shadow-lg hover:shadow-emerald-200 transition-premium flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    {actionLoading === submission.submission_id ? (
                                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    ) : (
                                                        <CheckCircle size={16} />
                                                    )}
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => handleRejectExpert(submission)}
                                                    disabled={actionLoading === submission.submission_id}
                                                    className="px-6 py-4 bg-white text-rose-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-50 hover:text-rose-600 border border-slate-100 hover:border-rose-100 transition-premium flex items-center gap-2 disabled:opacity-50"
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
                                <h3 className="text-xl font-black text-[#0d0e0e] tracking-tight mb-2 uppercase">Workspace Clear</h3>
                                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">No pending expert signals awaiting your signal.</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-32 text-center">
                        <div className="w-24 h-24 bg-white border-2 border-dashed border-slate-200 rounded-[2rem] flex items-center justify-center text-slate-300 mb-8 animate-pulse">
                            {activeTab === 'curated' ? <Search size={40} /> : <Inbox size={40} />}
                        </div>
                        <h2 className="text-2xl font-black text-[#0d0e0e] tracking-tight mb-2">
                            {activeTab === 'curated' ? 'No Visionaries Detected' : 'Clear Workspace'}
                        </h2>
                        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">
                            {activeTab === 'curated' ? 'The signal is clear but your grid is empty.' : 'All incoming expert signals have been processed.'}
                        </p>
                    </div>
                )}
            </div>

            {/* Deploy Expert Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-[#0d0e0e]/40 backdrop-blur-md flex items-center justify-center z-[100] p-2 sm:p-4">
                    <div className="bg-white rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-8 md:p-10 lg:p-12 shadow-2xl relative animate-in zoom-in duration-300">
                        <button
                            onClick={() => {
                                setShowAddModal(false);
                                setEditingExpert(null);
                                setFormData({ 
                                    name: '', 
                                    name_ar: '',
                                    title: '', 
                                    title_ar: '',
                                    company: '', 
                                    company_ar: '',
                                    bio: '', 
                                    bio_ar: '',
                                    linkedin_url: '', 
                                    photo_url: '',
                                    display_config: {
                                        show_title: true,
                                        show_company: true,
                                        show_bio: true,
                                        show_linkedin: true,
                                        show_photo: true
                                    }
                                });
                            }}
                            className="absolute top-4 right-4 sm:top-8 sm:right-8 p-2 bg-slate-50 hover:bg-rose-50 rounded-xl text-slate-400 hover:text-rose-500 transition-all z-10"
                        >
                            <X size={20} />
                        </button>

                        <div className="mb-6 sm:mb-10">
                            <div className="flex items-center gap-2 sm:gap-3 mb-2">
                                {editingExpert ? <Pencil size={14} className="text-[#1a27c9]" /> : <Plus size={14} className="text-[#1a27c9]" />}
                                <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
                                    {editingExpert ? 'Expert Modification' : 'Expert Entry'}
                                </span>
                            </div>
                            <h2 className="text-2xl sm:text-4xl font-black text-[#0d0e0e] tracking-tight leading-none">
                                {editingExpert ? 'Edit' : 'Deploy'} <span className="text-[#1a27c9]">Expert</span>
                            </h2>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Expert Name {isFieldRequired('name') && '*'}</label>
                                    <input
                                        required={isFieldRequired('name')}
                                        type="text"
                                        placeholder="Name of visionary"
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 font-arabic">اسم الخبير (بالعربية)</label>
                                    <input
                                        type="text"
                                        dir="rtl"
                                        placeholder="اسم الخبير..."
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium font-arabic"
                                        value={formData.name_ar}
                                        onChange={e => setFormData({ ...formData, name_ar: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Title / Role {isFieldRequired('title') && '*'}</label>
                                        <input
                                            required={isFieldRequired('title')}
                                            type="text"
                                            placeholder="e.g. CEO of Growth"
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                            value={formData.title}
                                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 font-arabic">المسمى الوظيفي (بالعربية)</label>
                                        <input
                                            type="text"
                                            dir="rtl"
                                            placeholder="المسمى الوظيفي..."
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium font-arabic"
                                            value={formData.title_ar}
                                            onChange={e => setFormData({ ...formData, title_ar: e.target.value })}
                                        />
                                    </div>
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_title !== false}
                                                onChange={e => setFormData({ 
                                                    ...formData, 
                                                    display_config: { ...formData.display_config, show_title: e.target.checked } 
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#1a27c9] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#1a27c9] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-6">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Company {isFieldRequired('company') && '*'}</label>
                                        <input
                                            required={isFieldRequired('company')}
                                            type="text"
                                            placeholder="e.g. Moonshot Inc."
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                            value={formData.company}
                                            onChange={e => setFormData({ ...formData, company: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 font-arabic">الشركة (بالعربية)</label>
                                        <input
                                            type="text"
                                            dir="rtl"
                                            placeholder="الشركة..."
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium font-arabic"
                                            value={formData.company_ar}
                                            onChange={e => setFormData({ ...formData, company_ar: e.target.value })}
                                        />
                                    </div>
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_company !== false}
                                                onChange={e => setFormData({ 
                                                    ...formData, 
                                                    display_config: { ...formData.display_config, show_company: e.target.checked } 
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#1a27c9] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#1a27c9] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Biography {isFieldRequired('bio') && '*'}</label>
                                    <textarea
                                        required={isFieldRequired('bio')}
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium min-h-[120px]"
                                        placeholder="Write a brief brief pulse on their history..."
                                        value={formData.bio}
                                        onChange={e => setFormData({ ...formData, bio: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 font-arabic">السيرة الذاتية (بالعربية)</label>
                                    <textarea
                                        dir="rtl"
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium min-h-[120px] font-arabic"
                                        placeholder="اكتب نبذة مختصرة..."
                                        value={formData.bio_ar}
                                        onChange={e => setFormData({ ...formData, bio_ar: e.target.value })}
                                    />
                                </div>
                                <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={formData.display_config?.show_bio !== false}
                                            onChange={e => setFormData({ 
                                                ...formData, 
                                                display_config: { ...formData.display_config, show_bio: e.target.checked } 
                                            })}
                                        />
                                        <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#1a27c9] transition-all duration-300"></div>
                                        <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                    </div>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#1a27c9] transition-colors">Show on Card / عرض على الكارت</span>
                                </label>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">LinkedIn URL {isFieldRequired('linkedin_url') && '*'}</label>
                                        <input
                                            required={isFieldRequired('linkedin_url')}
                                            type="url"
                                            placeholder="https://linkedin.com/in/..."
                                            className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                            value={formData.linkedin_url}
                                            onChange={e => setFormData({ ...formData, linkedin_url: e.target.value })}
                                        />
                                    </div>
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_linkedin !== false}
                                                onChange={e => setFormData({ 
                                                    ...formData, 
                                                    display_config: { ...formData.display_config, show_linkedin: e.target.checked } 
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#1a27c9] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#1a27c9] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Profile Photograph {isFieldRequired('photo_url') && '*'}</label>
                                        <div className="flex gap-3">
                                            <div className="relative flex-1">
                                                <input
                                                    required={isFieldRequired('photo_url')}
                                                    type="text"
                                                    placeholder="Upload photo or paste URL"
                                                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium pr-12"
                                                    value={formData.photo_url}
                                                    onChange={e => setFormData({ ...formData, photo_url: e.target.value })}
                                                />
                                                {formData.photo_url && (
                                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                                                        <Check size={12} />
                                                    </div>
                                                )}
                                            </div>
                                            <label className="shrink-0 flex items-center justify-center w-14 h-14 bg-white border border-slate-100 rounded-2xl text-slate-400 hover:text-[#1a27c9] hover:border-[#1a27c9] cursor-pointer transition-premium">
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
                                    <label className="flex items-center gap-3 px-2 cursor-pointer group/toggle">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={formData.display_config?.show_photo !== false}
                                                onChange={e => setFormData({ 
                                                    ...formData, 
                                                    display_config: { ...formData.display_config, show_photo: e.target.checked } 
                                                })}
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-[#1a27c9] transition-all duration-300"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-5 transition-transform duration-300"></div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/toggle:text-[#1a27c9] transition-colors">Show on Card / عرض على الكارت</span>
                                    </label>
                                </div>
                            </div>

                            <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-end gap-3 font-manrope">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowAddModal(false);
                                        setEditingExpert(null);
                                    }}
                                    className="order-2 sm:order-1 w-full sm:w-auto px-8 py-4 bg-white border border-slate-100 text-slate-400 hover:text-slate-600 rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest transition-premium"
                                >
                                    Cancel
                                </button>
                                <button
                                    disabled={isSubmitting}
                                    type="submit"
                                    className="order-1 sm:order-2 w-full sm:flex-[2] px-8 py-4 sm:py-5 bg-[#1a27c9] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#0d0e0e] shadow-2xl shadow-indigo-100 transition-premium flex items-center justify-center gap-3 active:scale-95"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            <span>{editingExpert ? 'Synchronizing...' : 'Establishing Link...'}</span>
                                        </>
                                    ) : (
                                        <span>{editingExpert ? 'Update Expert' : 'Add to Event'}</span>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Removed redundant preview modal */}
            {/* Submission Details Preview Modal */}
            {showPreview && selectedSubmission && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/40 backdrop-blur-md" onClick={() => setShowPreview(false)} />
                    <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl relative overflow-hidden animate-in zoom-in duration-300">
                        <div className="h-24 sm:h-32 bg-gradient-to-r from-[#1a27c9] to-[#4f46e5]" />
                        <div className="p-8 sm:p-12 -mt-12 sm:-mt-16 relative">
                            <button
                                onClick={() => setShowPreview(false)}
                                className="absolute top-4 right-4 sm:top-12 sm:right-12 p-3 bg-white/10 sm:bg-white/10 hover:bg-white/20 sm:hover:bg-white/20 backdrop-blur-sm rounded-2xl text-white transition-premium z-10"
                            >
                                <X size={20} />
                            </button>
                            <div className="flex flex-col sm:flex-row justify-between items-center sm:items-start mb-6 sm:mb-10 text-center sm:text-left gap-4">
                                <div className="p-2 bg-white rounded-[2rem] shadow-xl">
                                    <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-[1.5rem] bg-slate-50 flex items-center justify-center overflow-hidden border border-slate-100 aspect-square">
                                        {selectedSubmission.photo_url ? (
                                            <LazyImage 
                                                src={getGoogleDriveFallbackUrls(selectedSubmission.photo_url)[0]} 
                                                urls={getGoogleDriveFallbackUrls(selectedSubmission.photo_url)}
                                                alt="" 
                                                className="w-full h-full object-cover" 
                                            />
                                        ) : (
                                            <Users size={40} className="text-slate-200" />
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12">
                                <div className="space-y-6 sm:space-y-8">
                                    <div className="text-center sm:text-left">
                                        <h2 className="text-2xl sm:text-3xl font-black text-[#0d0e0e] tracking-tight mb-2 break-words">{selectedSubmission.expert_name}</h2>
                                        <p className="text-slate-500 font-bold uppercase tracking-widest text-xs flex items-center justify-center sm:justify-start gap-2">
                                            <Clock size={14} /> Submitting Pulse from Form Link
                                        </p>
                                    </div>

                                    <div className="space-y-6 max-h-[40vh] overflow-y-auto pr-4 custom-scrollbar">                                         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Title</p>
                                                <p className="font-bold text-[#0d0e0e]">{selectedSubmission.title || 'Expert'}</p>
                                            </div>
                                            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Company</p>
                                                <p className="font-bold text-[#0d0e0e]">{selectedSubmission.company || 'Not Specified'}</p>
                                            </div>
                                        </div>


                                        {selectedSubmission.bio && (
                                            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Biography</p>
                                                <p className="text-sm font-bold text-[#0d0e0e] leading-relaxed italic text-slate-600">"{selectedSubmission.bio}"</p>
                                            </div>
                                        )}

                                        {selectedSubmission.additional_data && (
                                            <div className="space-y-4">
                                                <p className="text-[10px] font-black text-[#1a27c9] uppercase tracking-[0.2em]">Transmission Payload</p>
                                                <div className="grid grid-cols-1 gap-3">
                                                    {Object.entries(selectedSubmission.additional_data).map(([key, value]) => {
                                                        if (key === '_column_order' || typeof value === 'object') return null;
                                                        return (
                                                            <div key={key} className="p-5 bg-white border border-slate-100 rounded-2xl flex justify-between items-center group hover:border-[#1a27c9]/20 transition-premium">
                                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{key.replace(/_/g, ' ')}</p>
                                                                <p className="font-bold text-[#0d0e0e] text-right">{String(value)}</p>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="hidden lg:flex flex-col items-center justify-center bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-200 p-8">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8">Expert Card Preview</p>
                                    <div className="scale-110 pointer-events-none">
                                        <ExpertCard
                                            expert={{
                                                name: selectedSubmission.expert_name,
                                                title: selectedSubmission.title,
                                                company: selectedSubmission.company,
                                                bio: selectedSubmission.bio,
                                                photo_url: selectedSubmission.photo_url
                                            }}
                                            previewMode={true}
                                        />
                                    </div>
                                    <p className="mt-8 text-[10px] font-black text-[#1a27c9] uppercase tracking-[0.2em] animate-pulse">Live Pulse Preview</p>
                                </div>
                            </div>

                            <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
                                <button
                                    onClick={() => {
                                        handleApproveExpert(selectedSubmission);
                                        setShowPreview(false);
                                    }}
                                    className="order-1 w-full sm:flex-1 py-4 sm:py-5 bg-[#1a27c9] text-white rounded-2xl font-black text-[10px] sm:text-xs uppercase tracking-[0.2em] hover:bg-[#0d0e0e] transition-premium shadow-xl shadow-indigo-200/50 flex items-center justify-center gap-2"
                                >
                                    <CheckCircle size={18} />
                                    Authorize Entry
                                </button>
                                <button
                                    onClick={() => {
                                        handleRejectExpert(selectedSubmission);
                                        setShowPreview(false);
                                    }}
                                    className="order-2 w-full sm:px-12 py-4 sm:py-5 bg-white text-rose-500 border border-slate-100 rounded-2xl font-black text-[10px] sm:text-xs uppercase tracking-[0.2em] hover:bg-rose-50 transition-premium flex items-center justify-center gap-2"
                                >
                                    <XCircle size={18} />
                                    Block
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Library / Hub Modal */}
            {showLibraryModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0d0e0e]/60 backdrop-blur-xl" onClick={() => setShowLibraryModal(false)} />
                    <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-[3.5rem] shadow-2xl relative flex flex-col overflow-hidden animate-in zoom-in duration-500">
                        {/* Header Section */}
                        <div className="p-8 sm:p-12 border-b border-slate-100 shrink-0">
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="w-10 h-10 bg-athar-blue/10 rounded-2xl flex items-center justify-center text-athar-blue">
                                            <Database size={20} />
                                        </div>
                                        <h2 className="text-3xl font-black text-[#0d0e0e] tracking-tight uppercase">Athar Network</h2>
                                    </div>
                                    <p className="text-slate-500 font-bold tracking-widest text-[10px] uppercase">Source vetted experts from the global Pulse network</p>
                                </div>
                                <button
                                    onClick={() => setShowLibraryModal(false)}
                                    className="p-4 hover:bg-slate-50 rounded-2xl text-slate-400 transition-premium"
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            {/* Internal Modal Search */}
                            <div className="relative">
                                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                                <input
                                    type="text"
                                    placeholder="Search by name, title or sector..."
                                    className="w-full pl-16 pr-8 py-5 bg-slate-50 border-2 border-slate-50 focus:border-athar-blue/20 rounded-3xl font-bold text-slate-600 transition-all placeholder:text-slate-300"
                                    onChange={(e) => {
                                        const term = e.target.value.toLowerCase();
                                        setLibraryExperts(prev => prev.map(exp => ({
                                            ...exp,
                                            _visible: exp.name.toLowerCase().includes(term) || 
                                                     exp.title?.toLowerCase().includes(term) ||
                                                     exp.company?.toLowerCase().includes(term)
                                        })));
                                    }}
                                />
                            </div>
                        </div>

                        {/* Content Section */}
                        <div className="flex-1 overflow-y-auto p-8 sm:p-12 custom-scrollbar">
                            {libraryLoading ? (
                                <div className="h-64 flex flex-col items-center justify-center gap-4">
                                    <Loader2 className="animate-spin text-athar-blue" size={40} />
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Accessing Hub Database...</p>
                                </div>
                            ) : libraryExperts.length === 0 ? (
                                <div className="h-64 flex flex-col items-center justify-center gap-4 grayscale opacity-40">
                                    <Database size={64} />
                                    <p className="font-black text-slate-400 uppercase tracking-widest">Hub is currently offline</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {libraryExperts.filter(exp => exp._visible !== false).map((expert) => {
                                        const isAlreadyInEvent = experts.some(e => e.master_id === expert.id);
                                        return (
                                            <div 
                                                key={expert.id}
                                                className="group/item relative bg-slate-50 rounded-[2.5rem] border border-slate-100 p-6 hover:shadow-xl hover:bg-white transition-premium cursor-default"
                                            >
                                                <div className="flex items-center gap-6">
                                                    <div className="w-20 h-20 rounded-3xl overflow-hidden shadow-lg border-2 border-white shrink-0 bg-white">
                                                        <LazyImage
                                                            src={expert.photo_url ? getGoogleDriveFallbackUrls(expert.photo_url)[0] : null}
                                                            urls={expert.photo_url ? getGoogleDriveFallbackUrls(expert.photo_url) : []}
                                                            alt={expert.name}
                                                            objectFit="cover"
                                                            className="group-hover/item:scale-110 transition-transform duration-700"
                                                            fallback={
                                                                <div className="w-full h-full flex items-center justify-center bg-athar-blue/5 text-athar-blue font-black text-3xl">
                                                                    {expert.name.charAt(0)}
                                                                </div>
                                                            }
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-black text-lg text-[#0d0e0e] uppercase leading-tight truncate mb-1">{expert.name}</h4>
                                                        <p className="text-[10px] font-bold text-athar-blue uppercase tracking-wider truncate mb-2">{expert.title}</p>
                                                        <div className="flex items-center gap-2">
                                                            <Briefcase size={12} className="text-slate-300" />
                                                            <span className="text-[10px] font-black text-slate-400 uppercase truncate">{expert.company || 'Vetted Pulse'}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <button
                                                    disabled={isAlreadyInEvent || actionLoading === expert.id}
                                                    onClick={() => handleImportFromLibrary(expert)}
                                                    className={`mt-6 w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-premium flex items-center justify-center gap-2 ${
                                                        isAlreadyInEvent 
                                                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                                        : 'bg-white border-2 border-slate-100 text-[#0d0e0e] hover:border-athar-blue hover:text-athar-blue hover:shadow-lg active:scale-95'
                                                    }`}
                                                >
                                                    {actionLoading === expert.id ? (
                                                        <Loader2 size={16} className="animate-spin" />
                                                    ) : isAlreadyInEvent ? (
                                                        <>
                                                            <CheckCircle size={14} />
                                                            Already Added
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Plus size={14} />
                                                            Add to Event
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                      
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExpertManager;
