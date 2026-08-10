import React, { useState, useEffect, useRef } from 'react';
import {
    ArrowLeft,
    Search,
    Loader2,
    AlertCircle,
    X,
    Eye,
    Check,
    ClipboardList,
    UserCheck,
    PhoneCall,
    PauseCircle,
    Ban,
    Globe,
    ExternalLink,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    Settings,
    Mail,
    Plus,
    Trash2,
    CheckCircle,
    Send,
    Calendar,
    Video
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AtherTeamBookingAdmin from './AtherTeamBookingAdmin';
import {
    getSubmissions,
    updateSubmissionStatus,
    syncSubmissionsFromSheet,
    getEvent,
    updateEvent
} from '../lib/api';

const SelectionProcessManager = () => {
    const { eventId } = useParams();
    const navigate = useNavigate();

    // UI State
    const [activeTab, setActiveTab] = useState('screening');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [_error, setError] = useState(null);
    const [_event, setEvent] = useState(null);
    const [sheetUrl, setSheetUrl] = useState('');

    // Settings State
    const [settingsActiveTab, setSettingsActiveTab] = useState('interview');
    const [savingSettings, setSavingSettings] = useState(false);

    // Interview Email Settings
    const [interviewAdminEmails, setInterviewAdminEmails] = useState([]);
    const [newAdminEmail, setNewAdminEmail] = useState('');
    const [interviewCCEmails, setInterviewCCEmails] = useState([]);
    const [newCCEmail, setNewCCEmail] = useState('');
    const [emailTemplateSubject, setEmailTemplateSubject] = useState('');
    const [emailTemplateBody, setEmailTemplateBody] = useState('');

    // Rejection Email Settings
    const [rejectionAdminEmails, setRejectionAdminEmails] = useState([]);
    const [newRejectionAdminEmail, setNewRejectionAdminEmail] = useState('');
    const [rejectionCCEmails, setRejectionCCEmails] = useState([]);
    const [newRejectionCCEmail, setNewRejectionCCEmail] = useState('');
    const [rejectionEmailTemplateSubject, setRejectionEmailTemplateSubject] = useState('');
    const [rejectionEmailTemplateBody, setRejectionEmailTemplateBody] = useState('');

    // Acceptance Email Settings
    const [acceptanceAdminEmails, setAcceptanceAdminEmails] = useState([]);
    const [newAcceptanceAdminEmail, setNewAcceptanceAdminEmail] = useState('');
    const [acceptanceCCEmails, setAcceptanceCCEmails] = useState([]);
    const [newAcceptanceCCEmail, setNewAcceptanceCCEmail] = useState('');
    const [acceptanceEmailTemplateSubject, setAcceptanceEmailTemplateSubject] = useState('');
    const [acceptanceEmailTemplateBody, setAcceptanceEmailTemplateBody] = useState('');

    // Google Meet Settings
    const [meetingLinkMode, setMeetingLinkMode] = useState('unique');
    const [sharedGoogleMeetLink, setSharedGoogleMeetLink] = useState('');
    const [meetLinkError, setMeetLinkError] = useState('');

    // Sending State
    const [sendingEmail, setSendingEmail] = useState(null);
    const [sendingRejectionEmail, setSendingRejectionEmail] = useState(null);
    const [sendingAcceptanceEmail, setSendingAcceptanceEmail] = useState(null);
    const [bulkEmailLoading, setBulkEmailLoading] = useState(false);
    const [bulkConfirmModal, setBulkConfirmModal] = useState({ show: false, type: null, count: 0 });

    // Data State
    const [submissions, setSubmissions] = useState([]);
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [decisionModal, setDecisionModal] = useState({ show: false, submission: null, newStatus: null, reason: '' });
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

    const currentSubmissions = submissions.filter(s => {
        const matchesTab = s.status === activeTab || (activeTab === 'approved' && s.status === 'displayed');
        const matchesSearch = s.startup_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.industry?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesTab && matchesSearch;
    });

    const lastViewedIndexRef = useRef(-1);

    useEffect(() => {
        if (selectedSubmission) {
            const idx = currentSubmissions.findIndex(s => s.submission_id === selectedSubmission.submission_id);
            if (idx !== -1) {
                lastViewedIndexRef.current = idx;
            }
        }
    }, [selectedSubmission, currentSubmissions]);

    const getNavigationState = () => {
        if (!selectedSubmission) return { hasPrev: false, hasNext: false, prevIdx: -1, nextIdx: -1 };
        const idx = currentSubmissions.findIndex(s => s.submission_id === selectedSubmission.submission_id);
        if (idx !== -1) {
            return {
                hasPrev: idx > 0,
                hasNext: idx < currentSubmissions.length - 1,
                prevIdx: idx - 1,
                nextIdx: idx + 1
            };
        } else {
            const vIdx = lastViewedIndexRef.current;
            return {
                hasPrev: vIdx > 0,
                hasNext: vIdx >= 0 && vIdx < currentSubmissions.length,
                prevIdx: vIdx - 1,
                nextIdx: vIdx
            };
        }
    };

    const navState = getNavigationState();

    const handleNavigate = (direction) => {
        const state = getNavigationState();
        if (direction === 'prev' && state.hasPrev) {
            setSelectedSubmission(currentSubmissions[state.prevIdx]);
        } else if (direction === 'next' && state.hasNext) {
            setSelectedSubmission(currentSubmissions[state.nextIdx]);
        }
    };

    const stages = [
        { id: 'screening', name: 'Screening', icon: <ClipboardList size={18} />, color: 'blue' },
        { id: 'interview', name: 'Interviews', icon: <PhoneCall size={18} />, color: 'purple' },
        { id: 'approved', name: 'Approved', icon: <UserCheck size={18} />, color: 'emerald' },
        { id: 'holding', name: 'Holding', icon: <PauseCircle size={18} />, color: 'amber' },
        { id: 'rejected', name: 'Rejected', icon: <Ban size={18} />, color: 'rose' },
        { id: 'settings', name: '', icon: <Settings size={18} />, color: 'slate' }
    ];

    const loadData = async () => {
        try {
            setLoading(true);
            const [evData, subData] = await Promise.all([
                getEvent(eventId),
                getSubmissions(eventId, 'company')
            ]);
            setEvent(evData);
            setSubmissions(subData || []);
            setSheetUrl(evData.selection_process_gsheets_url || '');

            // Interview emails
            setInterviewAdminEmails(evData.interview_admin_emails || []);
            setInterviewCCEmails(evData.interview_cc_emails || []);
            setEmailTemplateSubject(evData.interview_email_template_subject || 'Interview Invitation: {{company_name}}');
            setEmailTemplateBody(evData.interview_email_template_body || 'Dear {{first_name}},\n\nYou have been invited for an interview. Please book your slot: {{booking_link}}\n\nWarmly,\n{{project_manager_name}}');

            // Rejection emails
            setRejectionAdminEmails(evData.rejection_admin_emails || []);
            setRejectionCCEmails(evData.rejection_cc_emails || []);
            setRejectionEmailTemplateSubject(evData.rejection_email_template_subject || 'Thank You for Your Application');
            setRejectionEmailTemplateBody(evData.rejection_email_template_body || 'Dear {{first_name}},\n\nThank you for applying. We regret to inform you that we will not be moving forward at this time.\n\nBest regards,\nThe Ather Team');

            // Acceptance emails
            setAcceptanceAdminEmails(evData.acceptance_admin_emails || []);
            setAcceptanceCCEmails(evData.acceptance_cc_emails || []);
            setAcceptanceEmailTemplateSubject(evData.acceptance_email_template_subject || "Congratulations! You've been selected - {{company_name}}");
            setAcceptanceEmailTemplateBody(evData.acceptance_email_template_body || 'Dear {{first_name}},\n\nCongratulations! We are thrilled to inform you that {{company_name}} has been selected to join our program.\n\nLooking forward to working with you!\n\nWarmly,\n{{project_manager_name}}');

            // Google Meet settings
            setMeetingLinkMode(evData.meeting_link_mode || 'unique');
            setSharedGoogleMeetLink(evData.shared_google_meet_link || '');
            setMeetLinkError('');

            setError(null);
        } catch (err) {
            console.error('Error loading selection data:', err);
            setError('Failed to establish connection with the selection grid.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [eventId]);

    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000);
    };

    const handleSync = async () => {
        if (!sheetUrl) {
            showToast('Please provide a Google Sheets URL', 'error');
            return;
        }
        try {
            setIsSyncing(true);
            await updateEvent(eventId, { selection_process_gsheets_url: sheetUrl });
            const result = await syncSubmissionsFromSheet(eventId, sheetUrl);
            await loadData();
            let message = `Sync complete!`;
            if (result.inserted > 0 || result.deleted > 0) {
                message = `Sync complete: Added ${result.inserted}, Removed ${result.deleted}`;
            } else {
                message = `Sync complete: No changes detected.`;
            }
            showToast(message, 'success');
        } catch (err) {
            console.error('Sync failed:', err);
            showToast('Sync failed. Please check the URL and permissions.', 'error');
        } finally {
            setIsSyncing(false);
        }
    };

    const handleStatusUpdate = async (submissionId, newStatus, additionalUpdates = {}) => {
        try {
            const submission = submissions.find(s => s.submission_id === submissionId);
            const requiresReason = ['rejected', 'holding', 'approved', 'interview'].includes(newStatus);
            if (requiresReason && !additionalUpdates.reason_provided) {
                setDecisionModal({
                    show: true,
                    submission,
                    newStatus,
                    reason: newStatus === 'interview'
                        ? (submission.additional_data?.tech_status || '')
                        : (submission.additional_data?.[`${newStatus}_reason`] || '')
                });
                return;
            }
            const finalAdditionalData = {
                ...(submission.additional_data || {}),
                ...(additionalUpdates.additional_data || {})
            };
            if (additionalUpdates.reason) {
                if (newStatus === 'interview') {
                    finalAdditionalData.tech_status = additionalUpdates.reason;
                } else {
                    finalAdditionalData[`${newStatus}_reason`] = additionalUpdates.reason;
                }
            }
            await updateSubmissionStatus(submissionId, newStatus, {
                additional_data: finalAdditionalData
            });
            setSubmissions(prev => prev.map(s => {
                if (s.submission_id === submissionId) {
                    const updated = { ...s, status: newStatus, additional_data: finalAdditionalData };
                    if (selectedSubmission?.submission_id === submissionId) {
                        setSelectedSubmission(updated);
                    }
                    return updated;
                }
                return s;
            }));
            setDecisionModal({ show: false, submission: null, newStatus: null, reason: '' });
            showToast(`Submission moved to ${newStatus}`, 'success');
        } catch (err) {
            console.error('Status update failed:', err);
            showToast('Failed to update status.', 'error');
        }
    };

    const handleSaveSettings = async () => {
        if (meetingLinkMode === 'shared') {
            const trimmed = sharedGoogleMeetLink.trim();
            if (!trimmed || !trimmed.startsWith('https://meet.google.com/')) {
                setMeetLinkError('Please enter a valid Google Meet link.');
                showToast('Please enter a valid Google Meet link.', 'error');
                return;
            }
        }
        setMeetLinkError('');

        try {
            setSavingSettings(true);
            await updateEvent(eventId, {
                interview_admin_emails: interviewAdminEmails,
                interview_cc_emails: interviewCCEmails,
                interview_email_template_subject: emailTemplateSubject,
                interview_email_template_body: emailTemplateBody,
                rejection_admin_emails: rejectionAdminEmails,
                rejection_cc_emails: rejectionCCEmails,
                rejection_email_template_subject: rejectionEmailTemplateSubject,
                rejection_email_template_body: rejectionEmailTemplateBody,
                acceptance_admin_emails: acceptanceAdminEmails,
                acceptance_cc_emails: acceptanceCCEmails,
                acceptance_email_template_subject: acceptanceEmailTemplateSubject,
                acceptance_email_template_body: acceptanceEmailTemplateBody,
                meeting_link_mode: meetingLinkMode,
                shared_google_meet_link: sharedGoogleMeetLink.trim()
            });
            showToast('Settings saved successfully!', 'success');
        } catch (err) {
            console.error('Error saving settings:', err);
            showToast('Failed to save settings', 'error');
        } finally {
            setSavingSettings(false);
        }
    };

    const handleSendEmail = async (submission) => {
        try {
            setSendingEmail(submission.submission_id);
            const { data, error } = await supabase.functions.invoke('send-interview-invitations', {
                body: { eventId, submissionIds: [submission.submission_id] }
            });
            if (error || data?.success === false) throw new Error(error?.message || data?.error || 'Failed to send interview email');
            showToast(`Interview email sent to ${submission.startup_name}!`, 'success');
        } catch (err) {
            console.error('Failed to send interview email:', err);
            showToast(err.message || 'Failed to send interview email', 'error');
        } finally {
            setSendingEmail(null);
        }
    };

    const handleSendRejectionEmail = async (submission) => {
        try {
            setSendingRejectionEmail(submission.submission_id);
            const { data, error } = await supabase.functions.invoke('send-rejection-emails', {
                body: { eventId, submissionIds: [submission.submission_id] }
            });
            if (error || data?.success === false) throw new Error(error?.message || data?.error || 'Failed to send rejection email');
            showToast(`Rejection email sent to ${submission.startup_name}!`, 'success');
        } catch (err) {
            console.error('Failed to send rejection email:', err);
            showToast(err.message || 'Failed to send rejection email', 'error');
        } finally {
            setSendingRejectionEmail(null);
        }
    };

    const handleSendAcceptanceEmail = async (submission) => {
        try {
            setSendingAcceptanceEmail(submission.submission_id);
            const { data, error } = await supabase.functions.invoke('send-acceptance-emails', {
                body: { eventId, submissionIds: [submission.submission_id] }
            });
            if (error || data?.success === false) throw new Error(error?.message || data?.error || 'Failed to send acceptance email');
            showToast(`Acceptance email sent to ${submission.startup_name}!`, 'success');
        } catch (err) {
            console.error('Failed to send acceptance email:', err);
            showToast(err.message || 'Failed to send acceptance email', 'error');
        } finally {
            setSendingAcceptanceEmail(null);
        }
    };

    const handleBulkSendEmail = async (type) => {
        try {
            setBulkEmailLoading(true);
            setBulkConfirmModal({ show: false, type: null, count: 0 });
            let functionName = '';
            let targetStatus = '';
            if (type === 'interview') { functionName = 'send-interview-invitations'; targetStatus = 'interview'; }
            else if (type === 'rejection') { functionName = 'send-rejection-emails'; targetStatus = 'rejected'; }
            else if (type === 'acceptance') { functionName = 'send-acceptance-emails'; targetStatus = 'approved'; }
            const targetSubs = submissions.filter(s =>
                s.status === targetStatus || (targetStatus === 'approved' && s.status === 'displayed')
            );
            const submissionIds = targetSubs.map(s => s.submission_id);
            const { data, error } = await supabase.functions.invoke(functionName, {
                body: { eventId, submissionIds }
            });
            if (error || data?.success === false) throw new Error(error?.message || data?.error || 'Bulk email failed');
            showToast(`Bulk ${type} emails sent to ${submissionIds.length} startups!`, 'success');
        } catch (err) {
            console.error('Bulk email failed:', err);
            showToast(err.message || 'Failed to send bulk emails', 'error');
        } finally {
            setBulkEmailLoading(false);
        }
    };

    const formatValue = (val) => {
        if (!val) return '-';
        if (typeof val === 'number' && val > 40000 && val < 60000) {
            const date = new Date((val - 25569) * 86400 * 1000);
            return date.toLocaleDateString();
        }
        if (typeof val === 'string') {
            const date = new Date(val);
            if (!isNaN(date.getTime()) && (val.includes('-') || val.includes('/') || val.includes(':'))) {
                return date.toLocaleDateString();
            }
        }
        return String(val);
    };

    const getColumns = () => {
        const withOrder = currentSubmissions.find(s => s.additional_data?._column_order);
        if (withOrder) return withOrder.additional_data._column_order;
        const keys = new Set(['Startup Name', 'Industry', 'Location']);
        currentSubmissions.forEach(s => {
            if (s.additional_data) {
                Object.keys(s.additional_data).forEach(k => {
                    if (k !== '_column_order') keys.add(k);
                });
            }
        });
        return Array.from(keys);
    };

    const columns = getColumns();

    const approvedCount = submissions.filter(s => s.status === 'approved' || s.status === 'displayed').length;
    const interviewCount = submissions.filter(s => s.status === 'interview').length;
    const rejectedCount = submissions.filter(s => s.status === 'rejected').length;

    return (
        <div className="min-h-screen bg-gray-200 font-manrope selection:bg-[#1a27c9]/10 selection:text-[#1a27c9]">
            {/* Header */}
            <div className="bg-white border-b border-slate-100 sticky top-0 z-30">
                <div className="max-w-[1600px] mx-auto px-6 py-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="flex items-center gap-6">
                            <button
                                onClick={() => navigate(`/event/${eventId}`)}
                                className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-[#1a27c9] hover:border-[#1a27c9] hover:bg-white transition-premium group"
                            >
                                <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                            </button>
                            <div>
                                <h1 className="text-3xl font-black text-[#0d0e0e] tracking-tight">Selection Process</h1>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Manage and screen event applicants</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto mt-4 lg:mt-0">
                            <div className="relative w-full sm:w-auto grow">
                                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Google Sheets URL..."
                                    value={sheetUrl}
                                    onChange={(e) => setSheetUrl(e.target.value)}
                                    className="pl-12 pr-6 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold w-full md:w-80 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>
                            <button
                                onClick={handleSync}
                                disabled={isSyncing}
                                className="flex items-center gap-3 bg-[#1a27c9] text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-[#0d0e0e] transition-premium disabled:opacity-50"
                            >
                                {isSyncing ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                                <span>Sync Sheet</span>
                            </button>
                        </div>
                    </div>

                    {/* Stage Tabs */}
                    <div className="flex gap-4 mt-8 overflow-x-auto pb-2 scrollbar-hide">
                        {stages.map(stage => (
                            <button
                                key={stage.id}
                                onClick={() => setActiveTab(stage.id)}
                                className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest transition-premium shrink-0 ${activeTab === stage.id
                                    ? `text-white shadow-xl`
                                    : 'bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                                    }`}
                                style={{
                                    ...(activeTab === stage.id && {
                                        backgroundColor: stage.color === 'blue' ? '#2563eb' :
                                            stage.color === 'purple' ? '#9333ea' :
                                                stage.color === 'emerald' ? '#059669' :
                                                    stage.color === 'amber' ? '#d97706' :
                                                        stage.color === 'slate' ? '#475569' : '#e11d48'
                                    })
                                }}
                            >
                                {stage.icon}
                                {stage.name && <span>{stage.name}</span>}
                                {stage.id !== 'settings' && (
                                    <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] ${activeTab === stage.id ? 'bg-white/20' : 'bg-slate-200 text-slate-500'}`}>
                                        {submissions.filter(s => s.status === stage.id || (stage.id === 'approved' && s.status === 'displayed')).length}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-[1600px] mx-auto px-6 py-10">

                {/* ── Settings Tab ── */}
                {activeTab === 'settings' && (
                    <div className="space-y-8">
                        {/* Sheet URL */}
                        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-6 md:p-8 shadow-sm">
                            <h2 className="text-2xl font-black text-[#0d0e0e] tracking-tight mb-6">Email Settings</h2>

                            {/* Email Tabs */}
                            <div className="flex border-b border-slate-100 mb-8 overflow-x-auto">
                                <button
                                    onClick={() => setSettingsActiveTab('interview')}
                                    className={`flex items-center gap-3 px-8 py-5 font-black text-xs uppercase tracking-widest transition-all shrink-0 ${settingsActiveTab === 'interview'
                                        ? 'text-[#1a27c9] border-b-4 border-[#1a27c9] bg-[#1a27c9]/5'
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    <Mail size={18} />
                                    Interview Emails
                                </button>
                                <button
                                    onClick={() => setSettingsActiveTab('rejection')}
                                    className={`flex items-center gap-3 px-8 py-5 font-black text-xs uppercase tracking-widest transition-all shrink-0 ${settingsActiveTab === 'rejection'
                                        ? 'text-rose-600 border-b-4 border-rose-500 bg-rose-50'
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    <Ban size={18} />
                                    Rejection Emails
                                </button>
                                <button
                                    onClick={() => setSettingsActiveTab('acceptance')}
                                    className={`flex items-center gap-3 px-8 py-5 font-black text-xs uppercase tracking-widest transition-all shrink-0 ${settingsActiveTab === 'acceptance'
                                        ? 'text-emerald-600 border-b-4 border-emerald-500 bg-emerald-50'
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    <CheckCircle size={18} />
                                    Acceptance Emails
                                </button>
                                <button
                                    onClick={() => setSettingsActiveTab('ather_team')}
                                    className={`flex items-center gap-3 px-8 py-5 font-black text-xs uppercase tracking-widest transition-all shrink-0 ${settingsActiveTab === 'ather_team'
                                        ? 'text-[#1a27c9] border-b-4 border-[#1a27c9] bg-[#1a27c9]/5'
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    <Calendar size={18} />
                                    Ather Team Booking (بوكينج أثر تيم)
                                </button>
                            </div>

                            {/* Interview Tab */}
                            {settingsActiveTab === 'interview' && (
                                <div className="space-y-8">
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-[#1a27c9] uppercase tracking-[0.2em]">Interview Admin Emails</h3>
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={newAdminEmail}
                                                onChange={(e) => setNewAdminEmail(e.target.value)}
                                                placeholder="Enter admin email address"
                                                className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9]/30 transition-all"
                                                onKeyPress={(e) => {
                                                    if (e.key === 'Enter' && newAdminEmail.trim() && !interviewAdminEmails.includes(newAdminEmail.trim())) {
                                                        setInterviewAdminEmails(prev => [...prev, newAdminEmail.trim()]);
                                                        setNewAdminEmail('');
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    if (newAdminEmail.trim() && !interviewAdminEmails.includes(newAdminEmail.trim())) {
                                                        setInterviewAdminEmails(prev => [...prev, newAdminEmail.trim()]);
                                                        setNewAdminEmail('');
                                                    }
                                                }}
                                                className="px-4 py-3 rounded-2xl bg-[#1a27c9] text-white font-black text-sm hover:bg-[#0d0e0e] transition-all"
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {interviewAdminEmails.length === 0 ? (
                                                <p className="text-slate-400 text-sm font-medium">No admin emails added yet</p>
                                            ) : (
                                                interviewAdminEmails.map((email, index) => (
                                                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-2xl px-4 py-3">
                                                        <span className="text-sm font-bold text-slate-700">{email}</span>
                                                        <button onClick={() => setInterviewAdminEmails(prev => prev.filter(e => e !== email))} className="text-rose-500 hover:text-rose-700">
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-[#1a27c9] uppercase tracking-[0.2em]">Interview CC Emails</h3>
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={newCCEmail}
                                                onChange={(e) => setNewCCEmail(e.target.value)}
                                                placeholder="Enter CC email address"
                                                className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9]/30 transition-all"
                                                onKeyPress={(e) => {
                                                    if (e.key === 'Enter' && newCCEmail.trim() && !interviewCCEmails.includes(newCCEmail.trim())) {
                                                        setInterviewCCEmails(prev => [...prev, newCCEmail.trim()]);
                                                        setNewCCEmail('');
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    if (newCCEmail.trim() && !interviewCCEmails.includes(newCCEmail.trim())) {
                                                        setInterviewCCEmails(prev => [...prev, newCCEmail.trim()]);
                                                        setNewCCEmail('');
                                                    }
                                                }}
                                                className="px-4 py-3 rounded-2xl bg-[#1a27c9] text-white font-black text-sm hover:bg-[#0d0e0e] transition-all"
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {interviewCCEmails.length === 0 ? (
                                                <p className="text-slate-400 text-sm font-medium">No CC emails added yet</p>
                                            ) : (
                                                interviewCCEmails.map((email, index) => (
                                                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-2xl px-4 py-3">
                                                        <span className="text-sm font-bold text-slate-700">{email}</span>
                                                        <button onClick={() => setInterviewCCEmails(prev => prev.filter(e => e !== email))} className="text-rose-500 hover:text-rose-700">
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-[#1a27c9] uppercase tracking-[0.2em]">Email Template</h3>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Subject</label>
                                            <input
                                                type="text"
                                                value={emailTemplateSubject}
                                                onChange={(e) => setEmailTemplateSubject(e.target.value)}
                                                placeholder="Interview Invitation: {{company_name}}"
                                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9]/30 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Body</label>
                                            <textarea
                                                value={emailTemplateBody}
                                                onChange={(e) => setEmailTemplateBody(e.target.value)}
                                                rows={8}
                                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9]/30 transition-all resize-none"
                                            />
                                        </div>
                                        <p className="text-xs text-slate-400">Available variables: <code className="bg-slate-100 px-1 rounded">{'{{company_name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{founder_name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{project_manager_name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{booking_link}}'}</code></p>
                                    </div>

                                    {/* Google Meet Settings Section */}
                                    <div className="pt-8 border-t border-slate-100 space-y-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-[#1a27c9]/10 flex items-center justify-center text-[#1a27c9]">
                                                <Video size={20} />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-black text-[#1a27c9] uppercase tracking-[0.2em]">Google Meet Settings</h3>
                                                <p className="text-xs text-slate-400 font-medium">Configure how Google Meet links are generated for interview bookings</p>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                                                Meeting Link Mode
                                            </label>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {/* Option 1: Unique */}
                                                <div
                                                    onClick={() => {
                                                        setMeetingLinkMode('unique');
                                                        setMeetLinkError('');
                                                    }}
                                                    className={`p-5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                                                        meetingLinkMode === 'unique'
                                                            ? 'border-[#1a27c9] bg-[#1a27c9]/5 shadow-sm'
                                                            : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="radio"
                                                                name="meeting_link_mode"
                                                                value="unique"
                                                                checked={meetingLinkMode === 'unique'}
                                                                onChange={() => {
                                                                    setMeetingLinkMode('unique');
                                                                    setMeetLinkError('');
                                                                }}
                                                                className="w-4 h-4 text-[#1a27c9] focus:ring-[#1a27c9]"
                                                            />
                                                            <span className="font-bold text-sm text-slate-800">
                                                                Unique link for each booking
                                                            </span>
                                                        </div>
                                                        {meetingLinkMode === 'unique' && (
                                                            <CheckCircle size={16} className="text-[#1a27c9]" />
                                                        )}
                                                    </div>
                                                    <div className="mt-3 text-xs text-slate-500 space-y-1">
                                                        <p className="font-semibold text-slate-700">Use a different Google Meet link for every booking.</p>
                                                        <p className="text-slate-400 italic">Recommended when interviews are scheduled on different days or with large gaps between appointments.</p>
                                                    </div>
                                                </div>

                                                {/* Option 2: Shared */}
                                                <div
                                                    onClick={() => {
                                                        setMeetingLinkMode('shared');
                                                    }}
                                                    className={`p-5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                                                        meetingLinkMode === 'shared'
                                                            ? 'border-[#1a27c9] bg-[#1a27c9]/5 shadow-sm'
                                                            : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="radio"
                                                                name="meeting_link_mode"
                                                                value="shared"
                                                                checked={meetingLinkMode === 'shared'}
                                                                onChange={() => {
                                                                    setMeetingLinkMode('shared');
                                                                }}
                                                                className="w-4 h-4 text-[#1a27c9] focus:ring-[#1a27c9]"
                                                            />
                                                            <span className="font-bold text-sm text-slate-800">
                                                                Use one shared Google Meet link
                                                            </span>
                                                        </div>
                                                        {meetingLinkMode === 'shared' && (
                                                            <CheckCircle size={16} className="text-[#1a27c9]" />
                                                        )}
                                                    </div>
                                                    <div className="mt-3 text-xs text-slate-500 space-y-1">
                                                        <p className="font-semibold text-slate-700">Use the same Google Meet link for all bookings.</p>
                                                        <p className="text-slate-400 italic">Recommended when one interviewer is conducting consecutive interviews and participants join the same meeting one after another.</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Shared Link Input */}
                                            {meetingLinkMode === 'shared' && (
                                                <div className="mt-4 p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 animate-in fade-in duration-200">
                                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                                                        Google Meet Link <span className="text-rose-500">*</span>
                                                    </label>
                                                    <input
                                                        type="url"
                                                        value={sharedGoogleMeetLink}
                                                        onChange={(e) => {
                                                            setSharedGoogleMeetLink(e.target.value);
                                                            if (meetLinkError) setMeetLinkError('');
                                                        }}
                                                        placeholder="https://meet.google.com/xxxxxxxx"
                                                        className={`w-full bg-white border ${
                                                            meetLinkError ? 'border-rose-500 focus:ring-rose-500/20' : 'border-slate-200 focus:border-[#1a27c9]'
                                                        } rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/10 transition-all`}
                                                    />
                                                    {meetLinkError ? (
                                                        <p className="text-xs font-bold text-rose-500 flex items-center gap-1.5 mt-1">
                                                            <AlertCircle size={14} />
                                                            {meetLinkError}
                                                        </p>
                                                    ) : (
                                                        <p className="text-xs text-slate-400">
                                                            This link will be used in all calendar invitations for new bookings.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Rejection Tab */}
                            {settingsActiveTab === 'rejection' && (
                                <div className="space-y-8">
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-rose-600 uppercase tracking-[0.2em]">Rejection Admin Emails</h3>
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={newRejectionAdminEmail}
                                                onChange={(e) => setNewRejectionAdminEmail(e.target.value)}
                                                placeholder="Enter admin email address"
                                                className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500/30 transition-all"
                                                onKeyPress={(e) => {
                                                    if (e.key === 'Enter' && newRejectionAdminEmail.trim() && !rejectionAdminEmails.includes(newRejectionAdminEmail.trim())) {
                                                        setRejectionAdminEmails(prev => [...prev, newRejectionAdminEmail.trim()]);
                                                        setNewRejectionAdminEmail('');
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    if (newRejectionAdminEmail.trim() && !rejectionAdminEmails.includes(newRejectionAdminEmail.trim())) {
                                                        setRejectionAdminEmails(prev => [...prev, newRejectionAdminEmail.trim()]);
                                                        setNewRejectionAdminEmail('');
                                                    }
                                                }}
                                                className="px-4 py-3 rounded-2xl bg-rose-600 text-white font-black text-sm hover:bg-rose-700 transition-all"
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {rejectionAdminEmails.length === 0 ? (
                                                <p className="text-slate-400 text-sm font-medium">No admin emails added yet</p>
                                            ) : (
                                                rejectionAdminEmails.map((email, index) => (
                                                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-2xl px-4 py-3">
                                                        <span className="text-sm font-bold text-slate-700">{email}</span>
                                                        <button onClick={() => setRejectionAdminEmails(prev => prev.filter(e => e !== email))} className="text-rose-500 hover:text-rose-700">
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-rose-600 uppercase tracking-[0.2em]">Rejection CC Emails</h3>
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={newRejectionCCEmail}
                                                onChange={(e) => setNewRejectionCCEmail(e.target.value)}
                                                placeholder="Enter CC email address"
                                                className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500/30 transition-all"
                                                onKeyPress={(e) => {
                                                    if (e.key === 'Enter' && newRejectionCCEmail.trim() && !rejectionCCEmails.includes(newRejectionCCEmail.trim())) {
                                                        setRejectionCCEmails(prev => [...prev, newRejectionCCEmail.trim()]);
                                                        setNewRejectionCCEmail('');
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    if (newRejectionCCEmail.trim() && !rejectionCCEmails.includes(newRejectionCCEmail.trim())) {
                                                        setRejectionCCEmails(prev => [...prev, newRejectionCCEmail.trim()]);
                                                        setNewRejectionCCEmail('');
                                                    }
                                                }}
                                                className="px-4 py-3 rounded-2xl bg-rose-600 text-white font-black text-sm hover:bg-rose-700 transition-all"
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {rejectionCCEmails.length === 0 ? (
                                                <p className="text-slate-400 text-sm font-medium">No CC emails added yet</p>
                                            ) : (
                                                rejectionCCEmails.map((email, index) => (
                                                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-2xl px-4 py-3">
                                                        <span className="text-sm font-bold text-slate-700">{email}</span>
                                                        <button onClick={() => setRejectionCCEmails(prev => prev.filter(e => e !== email))} className="text-rose-500 hover:text-rose-700">
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-rose-600 uppercase tracking-[0.2em]">Email Template</h3>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Subject</label>
                                            <input
                                                type="text"
                                                value={rejectionEmailTemplateSubject}
                                                onChange={(e) => setRejectionEmailTemplateSubject(e.target.value)}
                                                placeholder="Thank You for Your Application"
                                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500/30 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Body</label>
                                            <textarea
                                                value={rejectionEmailTemplateBody}
                                                onChange={(e) => setRejectionEmailTemplateBody(e.target.value)}
                                                rows={8}
                                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500/30 transition-all resize-none"
                                            />
                                        </div>
                                        <p className="text-xs text-slate-400">Available variables: <code className="bg-slate-100 px-1 rounded">{'{{company_name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{founder_name}}'}</code></p>
                                    </div>
                                </div>
                            )}

                            {/* Acceptance Tab */}
                            {settingsActiveTab === 'acceptance' && (
                                <div className="space-y-8">
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-emerald-600 uppercase tracking-[0.2em]">Acceptance Admin Emails</h3>
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={newAcceptanceAdminEmail}
                                                onChange={(e) => setNewAcceptanceAdminEmail(e.target.value)}
                                                placeholder="Enter admin email address"
                                                className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/30 transition-all"
                                                onKeyPress={(e) => {
                                                    if (e.key === 'Enter' && newAcceptanceAdminEmail.trim() && !acceptanceAdminEmails.includes(newAcceptanceAdminEmail.trim())) {
                                                        setAcceptanceAdminEmails(prev => [...prev, newAcceptanceAdminEmail.trim()]);
                                                        setNewAcceptanceAdminEmail('');
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    if (newAcceptanceAdminEmail.trim() && !acceptanceAdminEmails.includes(newAcceptanceAdminEmail.trim())) {
                                                        setAcceptanceAdminEmails(prev => [...prev, newAcceptanceAdminEmail.trim()]);
                                                        setNewAcceptanceAdminEmail('');
                                                    }
                                                }}
                                                className="px-4 py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 transition-all"
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {acceptanceAdminEmails.length === 0 ? (
                                                <p className="text-slate-400 text-sm font-medium">No admin emails added yet</p>
                                            ) : (
                                                acceptanceAdminEmails.map((email, index) => (
                                                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-2xl px-4 py-3">
                                                        <span className="text-sm font-bold text-slate-700">{email}</span>
                                                        <button onClick={() => setAcceptanceAdminEmails(prev => prev.filter(e => e !== email))} className="text-rose-500 hover:text-rose-700">
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-emerald-600 uppercase tracking-[0.2em]">Acceptance CC Emails</h3>
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={newAcceptanceCCEmail}
                                                onChange={(e) => setNewAcceptanceCCEmail(e.target.value)}
                                                placeholder="Enter CC email address"
                                                className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/30 transition-all"
                                                onKeyPress={(e) => {
                                                    if (e.key === 'Enter' && newAcceptanceCCEmail.trim() && !acceptanceCCEmails.includes(newAcceptanceCCEmail.trim())) {
                                                        setAcceptanceCCEmails(prev => [...prev, newAcceptanceCCEmail.trim()]);
                                                        setNewAcceptanceCCEmail('');
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    if (newAcceptanceCCEmail.trim() && !acceptanceCCEmails.includes(newAcceptanceCCEmail.trim())) {
                                                        setAcceptanceCCEmails(prev => [...prev, newAcceptanceCCEmail.trim()]);
                                                        setNewAcceptanceCCEmail('');
                                                    }
                                                }}
                                                className="px-4 py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 transition-all"
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {acceptanceCCEmails.length === 0 ? (
                                                <p className="text-slate-400 text-sm font-medium">No CC emails added yet</p>
                                            ) : (
                                                acceptanceCCEmails.map((email, index) => (
                                                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-2xl px-4 py-3">
                                                        <span className="text-sm font-bold text-slate-700">{email}</span>
                                                        <button onClick={() => setAcceptanceCCEmails(prev => prev.filter(e => e !== email))} className="text-rose-500 hover:text-rose-700">
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-emerald-600 uppercase tracking-[0.2em]">Email Template</h3>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Subject</label>
                                            <input
                                                type="text"
                                                value={acceptanceEmailTemplateSubject}
                                                onChange={(e) => setAcceptanceEmailTemplateSubject(e.target.value)}
                                                placeholder="Congratulations! You've been selected - {{company_name}}"
                                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/30 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Body</label>
                                            <textarea
                                                value={acceptanceEmailTemplateBody}
                                                onChange={(e) => setAcceptanceEmailTemplateBody(e.target.value)}
                                                rows={8}
                                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/30 transition-all resize-none"
                                            />
                                        </div>
                                        <p className="text-xs text-slate-400">Available variables: <code className="bg-slate-100 px-1 rounded">{'{{company_name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{founder_name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{project_manager_name}}'}</code></p>
                                    </div>
                                </div>
                            )}

                            {/* Ather Team Booking Tab */}
                            {settingsActiveTab === 'ather_team' && (
                                <div className="mt-2">
                                    <AtherTeamBookingAdmin eventId={eventId} isEmbedded={true} />
                                </div>
                            )}

                            {/* Save Button */}
                            {settingsActiveTab !== 'ather_team' && (
                                <div className="pt-8 border-t border-slate-100 mt-8">
                                    <button
                                        onClick={handleSaveSettings}
                                        disabled={savingSettings}
                                        className="w-full bg-[#1a27c9] text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-[#0d0e0e] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {savingSettings ? <Loader2 size={18} className="animate-spin" /> : null}
                                        Save Settings
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Main Stages Table ── */}
                {activeTab !== 'settings' && (
                    <div className="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-sm">
                        {/* Search + Bulk Email Bar */}
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/50 flex-wrap">
                            <div className="relative w-full max-w-md">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Search in this stage..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-12 pr-6 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold w-full focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9] transition-premium"
                                />
                            </div>

                            {/* Bulk email buttons */}
                            {activeTab === 'interview' && interviewCount > 0 && (
                                <button
                                    onClick={() => setBulkConfirmModal({ show: true, type: 'interview', count: interviewCount })}
                                    disabled={bulkEmailLoading}
                                    className="flex items-center gap-2 px-5 py-3 bg-purple-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-purple-700 transition-all shadow-lg shadow-purple-100 disabled:opacity-50"
                                >
                                    {bulkEmailLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    Send Interview Emails to All ({interviewCount})
                                </button>
                            )}
                            {activeTab === 'approved' && approvedCount > 0 && (
                                <button
                                    onClick={() => setBulkConfirmModal({ show: true, type: 'acceptance', count: approvedCount })}
                                    disabled={bulkEmailLoading}
                                    className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50"
                                >
                                    {bulkEmailLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    Send Acceptance Emails to All ({approvedCount})
                                </button>
                            )}
                            {activeTab === 'rejected' && rejectedCount > 0 && (
                                <button
                                    onClick={() => setBulkConfirmModal({ show: true, type: 'rejection', count: rejectedCount })}
                                    disabled={bulkEmailLoading}
                                    className="flex items-center gap-2 px-5 py-3 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-700 transition-all shadow-lg shadow-rose-100 disabled:opacity-50"
                                >
                                    {bulkEmailLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    Send Rejection Emails to All ({rejectedCount})
                                </button>
                            )}
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50/50">
                                        <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 w-16 text-center">View</th>
                                        {columns.slice(0, 5).map((col, idx) => (
                                            <th key={`${col}-${idx}`} className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                                {col}
                                            </th>
                                        ))}
                                        <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr>
                                            <td colSpan={columns.length + 2} className="py-32 text-center">
                                                <Loader2 size={40} className="animate-spin text-[#1a27c9] mx-auto mb-4" />
                                                <p className="text-slate-400 font-black text-xs uppercase tracking-widest">Loading Grid Data...</p>
                                            </td>
                                        </tr>
                                    ) : currentSubmissions.length === 0 ? (
                                        <tr>
                                            <td colSpan={columns.length + 2} className="py-32 text-center">
                                                <AlertCircle size={40} className="text-slate-200 mx-auto mb-4" />
                                                <p className="text-slate-400 font-black text-xs uppercase tracking-widest">No applicants in this stage.</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        currentSubmissions.map(sub => (
                                            <tr key={sub.submission_id} className="hover:bg-slate-50/80 transition-premium group">
                                                <td className="px-6 py-5 border-b border-slate-50 text-center">
                                                    <button
                                                        onClick={() => setSelectedSubmission(sub)}
                                                        className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center hover:bg-[#1a27c9] hover:text-white transition-premium"
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                </td>
                                                {columns.slice(0, 5).map((col, idx) => {
                                                    let val = '';
                                                    const lowCol = col.toLowerCase();
                                                    if (lowCol.includes('name')) val = sub.startup_name;
                                                    else if (lowCol.includes('industry') || lowCol.includes('sector')) val = sub.industry;
                                                    else if (lowCol.includes('location') || lowCol.includes('city')) val = sub.location;
                                                    else val = sub.additional_data?.[col];
                                                    return (
                                                        <td key={`${col}-${idx}`} className="px-6 py-5 border-b border-slate-50 text-sm font-bold text-slate-600 truncate max-w-[200px]">
                                                            {formatValue(val)}
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-6 py-5 border-b border-slate-50 text-right space-x-2 whitespace-nowrap">
                                                    {sub.status === 'screening' && (
                                                        <>
                                                            <button onClick={() => handleStatusUpdate(sub.submission_id, 'interview')} className="px-4 py-2 rounded-xl bg-purple-50 text-purple-600 text-[10px] font-black uppercase tracking-widest hover:bg-purple-600 hover:text-white transition-premium">Interview</button>
                                                            <button onClick={() => handleStatusUpdate(sub.submission_id, 'holding', { additional_data: { ...sub.additional_data, origin_stage: 'screening' } })} className="px-4 py-2 rounded-xl bg-amber-50 text-amber-600 text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 hover:text-white transition-premium">Hold</button>
                                                            <button onClick={() => handleStatusUpdate(sub.submission_id, 'rejected')} className="px-4 py-2 rounded-xl bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-premium">Reject</button>
                                                        </>
                                                    )}
                                                    {sub.status === 'interview' && (
                                                        <>
                                                            <button onClick={() => handleSendEmail(sub)} disabled={sendingEmail === sub.submission_id} className="px-4 py-2 rounded-xl bg-purple-50 text-purple-600 text-[10px] font-black uppercase tracking-widest hover:bg-purple-600 hover:text-white transition-premium disabled:opacity-50 inline-flex items-center gap-1">
                                                                {sendingEmail === sub.submission_id ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Send Email
                                                            </button>
                                                            <button onClick={() => handleStatusUpdate(sub.submission_id, 'approved')} className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-premium">Approve</button>
                                                            <button onClick={() => handleStatusUpdate(sub.submission_id, 'rejected')} className="px-4 py-2 rounded-xl bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-premium">Reject</button>
                                                            <button onClick={() => handleStatusUpdate(sub.submission_id, 'holding', { additional_data: { ...sub.additional_data, origin_stage: 'interview' } })} className="px-4 py-2 rounded-xl bg-amber-50 text-amber-600 text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 hover:text-white transition-premium">Hold</button>
                                                        </>
                                                    )}
                                                    {(sub.status === 'approved' || sub.status === 'displayed') && (
                                                        <div className="flex items-center gap-2 justify-end">
                                                            <button onClick={() => handleSendAcceptanceEmail(sub)} disabled={sendingAcceptanceEmail === sub.submission_id} className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-premium disabled:opacity-50 inline-flex items-center gap-1">
                                                                {sendingAcceptanceEmail === sub.submission_id ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Send Acceptance
                                                            </button>
                                                            {sub.status === 'approved' && (
                                                                <button onClick={() => handleStatusUpdate(sub.submission_id, 'displayed')} className="px-4 py-2 rounded-xl bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-premium">Display</button>
                                                            )}
                                                            {sub.status === 'displayed' && (
                                                                <span className="px-4 py-2 rounded-xl bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest border border-emerald-200">Displayed</span>
                                                            )}
                                                            <button onClick={() => handleStatusUpdate(sub.submission_id, 'rejected')} className="px-4 py-2 rounded-xl bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-premium">Reject</button>
                                                        </div>
                                                    )}
                                                    {sub.status === 'holding' && (
                                                        <button onClick={() => { const origin = sub.additional_data?.origin_stage || 'screening'; handleStatusUpdate(sub.submission_id, origin); }} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-600 hover:text-white transition-premium">
                                                            {sub.additional_data?.origin_stage === 'interview' ? 'Back to Interview' : 'Back to Screening'}
                                                        </button>
                                                    )}
                                                    {sub.status === 'rejected' && (
                                                        <div className="flex items-center gap-2 justify-end">
                                                            <button onClick={() => handleSendRejectionEmail(sub)} disabled={sendingRejectionEmail === sub.submission_id} className="px-4 py-2 rounded-xl bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-premium disabled:opacity-50 inline-flex items-center gap-1">
                                                                {sendingRejectionEmail === sub.submission_id ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Send Rejection
                                                            </button>
                                                            <button onClick={() => handleStatusUpdate(sub.submission_id, 'screening')} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-600 hover:text-white transition-premium">Move back to Screening</button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedSubmission && (
                <div key={selectedSubmission.submission_id} className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[100] p-6">
                    <div className="bg-white rounded-[3rem] w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
                        <div className="p-6 md:p-10 pb-6 border-b border-slate-100 flex flex-col md:flex-row items-center md:items-start justify-between gap-6 relative overflow-hidden bg-gradient-to-br from-slate-50 to-white flex-shrink-0">
                            <div className="flex flex-col sm:flex-row gap-6 items-center text-center sm:text-left relative z-10 w-full">
                                <div className="w-24 h-24 rounded-3xl bg-white border border-slate-200 shadow-xl flex items-center justify-center overflow-hidden p-2 flex-shrink-0">
                                    {selectedSubmission.logo_url ? (
                                        <img src={selectedSubmission.logo_url} alt="Logo" className="w-full h-full object-contain" />
                                    ) : (
                                        <ClipboardList className="text-slate-200" size={40} />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mb-2">
                                        <span className="px-3 py-1 bg-[#1a27c9]/10 text-[#1a27c9] text-[10px] font-black uppercase tracking-widest rounded-lg">{selectedSubmission.status}</span>
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Submitted: {new Date(selectedSubmission.submitted_at).toLocaleDateString()}</span>
                                    </div>
                                    <h2 className="text-2xl md:text-3xl lg:text-4xl font-black text-[#0d0e0e] tracking-tight leading-none truncate whitespace-normal">{selectedSubmission.startup_name}</h2>
                                </div>
                            </div>
                            <div className="flex items-center justify-center md:justify-end gap-2 relative z-10 w-full md:w-auto flex-shrink-0">
                                <button onClick={() => handleNavigate('prev')} disabled={!navState.hasPrev} className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-[#1a27c9] hover:border-[#1a27c9] hover:bg-[#1a27c9]/5 transition-premium disabled:opacity-50 disabled:cursor-not-allowed"><ChevronLeft size={20} /></button>
                                <button onClick={() => handleNavigate('next')} disabled={!navState.hasNext} className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-[#1a27c9] hover:border-[#1a27c9] hover:bg-[#1a27c9]/5 transition-premium disabled:opacity-50 disabled:cursor-not-allowed"><ChevronRight size={20} /></button>
                                <div className="w-px h-8 bg-slate-200 mx-2"></div>
                                <button onClick={() => setSelectedSubmission(null)} className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-rose-500 hover:border-rose-100 hover:bg-rose-50 transition-premium"><X size={20} /></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 md:p-10 bg-white">
                            <div className="max-w-2xl mx-auto space-y-12">
                                <div className="space-y-6">
                                    <h3 className="text-sm font-black text-[#1a27c9] uppercase tracking-[0.2em] flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-[#1a27c9]" /> Review Context
                                    </h3>
                                    <div className="grid grid-cols-1 gap-6">
                                        {selectedSubmission.additional_data?.tech_status && (
                                            <div className="bg-[#1a27c9]/5 p-8 rounded-[2rem] border border-[#1a27c9]/10">
                                                <p className="text-[10px] font-black text-[#1a27c9] uppercase tracking-widest mb-3">Technology Status</p>
                                                <p className="text-lg font-bold text-slate-700 leading-relaxed">{selectedSubmission.additional_data.tech_status}</p>
                                            </div>
                                        )}
                                        {['approved', 'rejected', 'holding', 'displayed'].map(status => {
                                            const reason = selectedSubmission.additional_data?.[`${status}_reason`];
                                            if (!reason) return null;
                                            return (
                                                <div key={status} className="bg-slate-50 p-8 rounded-[2rem] border border-slate-100">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{status} Note</p>
                                                    <p className="text-lg font-bold text-slate-600 leading-relaxed">{reason}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="space-y-8">
                                    <h3 className="text-sm font-black text-emerald-600 uppercase tracking-[0.2em] flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-emerald-600" /> Complete Submission Data
                                    </h3>
                                    <div className="space-y-6">
                                        {(() => {
                                            const order = selectedSubmission.additional_data?._column_order || Object.keys(selectedSubmission.additional_data || {});
                                            return order
                                                .filter(key => key !== '_column_order' && key !== 'tech_status' && !key.endsWith('_reason') && key !== 'origin_stage')
                                                .map((key, idx) => {
                                                    const value = selectedSubmission.additional_data?.[key];
                                                    if (value === undefined || value === '') return null;
                                                    return (
                                                        <div key={`${key}-${idx}`} className="flex flex-col gap-2 border-b border-slate-50 pb-6 text-left">
                                                            <span className="text-[12px] font-black text-slate-400 uppercase tracking-widest">{key}</span>
                                                            <span className="text-lg font-bold text-slate-600 break-words leading-snug">{formatValue(value)}</span>
                                                        </div>
                                                    );
                                                });
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 md:p-8 bg-slate-50 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4 mt-auto flex-shrink-0">
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 w-full md:w-auto">
                                {selectedSubmission.status === 'screening' && (
                                    <>
                                        <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'interview')} className="flex-1 md:flex-none px-4 md:px-6 py-4 rounded-2xl bg-purple-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 transition-premium shadow-lg shadow-purple-100">Move to Interview</button>
                                        <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'holding', { additional_data: { ...selectedSubmission.additional_data, origin_stage: 'screening' } })} className="px-6 py-4 rounded-2xl bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 transition-premium shadow-lg shadow-amber-100">Hold</button>
                                        <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'rejected')} className="px-6 py-4 rounded-2xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-premium shadow-lg shadow-rose-100">Reject</button>
                                    </>
                                )}
                                {selectedSubmission.status === 'interview' && (
                                    <>
                                        <button onClick={() => handleSendEmail(selectedSubmission)} disabled={sendingEmail === selectedSubmission.submission_id} className="px-6 py-4 rounded-2xl bg-purple-100 text-purple-700 text-[10px] font-black uppercase tracking-widest hover:bg-purple-600 hover:text-white transition-premium disabled:opacity-50 flex items-center gap-2">
                                            {sendingEmail === selectedSubmission.submission_id ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send Interview Email
                                        </button>
                                        <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'approved')} className="px-6 py-4 rounded-2xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-premium shadow-lg shadow-emerald-100">Approve Startup</button>
                                        <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'holding', { additional_data: { ...selectedSubmission.additional_data, origin_stage: 'interview' } })} className="px-6 py-4 rounded-2xl bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 transition-premium shadow-lg shadow-amber-100">Move to Hold</button>
                                        <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'rejected')} className="px-6 py-4 rounded-2xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-premium shadow-lg shadow-rose-100">Reject</button>
                                    </>
                                )}
                                {(selectedSubmission.status === 'approved' || selectedSubmission.status === 'displayed') && (
                                    <>
                                        <button onClick={() => handleSendAcceptanceEmail(selectedSubmission)} disabled={sendingAcceptanceEmail === selectedSubmission.submission_id} className="px-6 py-4 rounded-2xl bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-premium disabled:opacity-50 flex items-center gap-2">
                                            {sendingAcceptanceEmail === selectedSubmission.submission_id ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send Acceptance Email
                                        </button>
                                        {selectedSubmission.status === 'approved' && (
                                            <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'displayed')} className="px-6 py-4 rounded-2xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-premium shadow-lg shadow-blue-100">Display Publicly</button>
                                        )}
                                        <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'rejected')} className="px-6 py-4 rounded-2xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-premium shadow-lg shadow-rose-100">Reject</button>
                                    </>
                                )}
                                {selectedSubmission.status === 'holding' && (
                                    <button onClick={() => { const origin = selectedSubmission.additional_data?.origin_stage || 'screening'; handleStatusUpdate(selectedSubmission.submission_id, origin); }} className="px-6 py-4 rounded-2xl bg-slate-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-premium shadow-lg shadow-slate-100">
                                        {selectedSubmission.additional_data?.origin_stage === 'interview' ? 'Return to Interview' : 'Return to Screening'}
                                    </button>
                                )}
                                {selectedSubmission.status === 'rejected' && (
                                    <>
                                        <button onClick={() => handleSendRejectionEmail(selectedSubmission)} disabled={sendingRejectionEmail === selectedSubmission.submission_id} className="px-6 py-4 rounded-2xl bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-premium disabled:opacity-50 flex items-center gap-2">
                                            {sendingRejectionEmail === selectedSubmission.submission_id ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send Rejection Email
                                        </button>
                                        <button onClick={() => handleStatusUpdate(selectedSubmission.submission_id, 'screening')} className="px-6 py-4 rounded-2xl bg-slate-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-premium shadow-lg shadow-slate-100">Restore to Screening</button>
                                    </>
                                )}
                            </div>
                            <button onClick={() => setSelectedSubmission(null)} className="w-full md:w-auto px-8 py-4 bg-white border border-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-premium">Close View</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Decision Reason Modal */}
            {decisionModal.show && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-100 flex flex-col">
                        <div className="p-6 md:p-8 border-b border-slate-50 flex items-start justify-between">
                            <div>
                                <h2 className="text-xl md:text-2xl font-black text-[#0d0e0e] tracking-tight">Decision Context</h2>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                                    {decisionModal.newStatus === 'interview' ? 'Technology Status for Interview' :
                                        decisionModal.newStatus === 'approved' ? 'Reason for Approval' :
                                            decisionModal.newStatus === 'rejected' ? 'Reason for Rejection' : 'Reason for Hold'}
                                </p>
                            </div>
                            <button onClick={() => setDecisionModal({ show: false, submission: null, newStatus: null, reason: '' })} className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-rose-500 hover:border-rose-100 hover:bg-rose-50 transition-premium">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6 md:p-8">
                            <textarea
                                value={decisionModal.reason}
                                onChange={(e) => setDecisionModal(prev => ({ ...prev, reason: e.target.value }))}
                                placeholder={decisionModal.newStatus === 'interview' ? 'e.g. Promising AI-based solution with strong market fit...' : 'Add a note for this decision...'}
                                rows={4}
                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-[#1a27c9]/5 focus:border-[#1a27c9]/30 transition-all resize-none"
                            />
                        </div>
                        <div className="p-6 md:p-8 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
                            <button onClick={() => setDecisionModal({ show: false, submission: null, newStatus: null, reason: '' })} className="w-full sm:flex-1 py-4 bg-white border border-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-100 transition-premium">Cancel</button>
                            <button
                                onClick={() => {
                                    handleStatusUpdate(decisionModal.submission.submission_id, decisionModal.newStatus, {
                                        reason: decisionModal.reason,
                                        reason_provided: true
                                    });
                                }}
                                className={`w-full sm:flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white transition-premium shadow-lg ${decisionModal.newStatus === 'interview' ? 'bg-purple-600 hover:bg-purple-700' :
                                    decisionModal.newStatus === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' :
                                        decisionModal.newStatus === 'rejected' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                            >
                                Confirm Decision
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Confirm Modal */}
            {bulkConfirmModal.show && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md border border-slate-100">
                        <div className="p-6 md:p-8 border-b border-slate-100">
                            <h2 className="text-xl font-black text-[#0d0e0e] tracking-tight mb-2">
                                Confirm Bulk Send
                            </h2>
                            <p className="text-sm font-bold text-slate-600">
                                Are you sure you want to send <strong className="capitalize">{bulkConfirmModal.type} emails</strong> to all <strong className="text-[#1a27c9]">{bulkConfirmModal.count} startups</strong> in this list?
                            </p>
                            <p className="text-xs text-slate-400 mt-2">Each startup will receive a personalized email from your configured template.</p>
                        </div>
                        <div className="p-6 md:p-8 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
                            <button onClick={() => setBulkConfirmModal({ show: false, type: null, count: 0 })} className="w-full sm:flex-1 py-4 bg-white border border-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-100 transition-all">Cancel</button>
                            <button
                                onClick={() => handleBulkSendEmail(bulkConfirmModal.type)}
                                className={`w-full sm:flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white transition-all shadow-lg ${bulkConfirmModal.type === 'interview' ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200' :
                                    bulkConfirmModal.type === 'rejection' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200' :
                                        'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'}`}
                            >
                                Confirm Bulk Send
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast.show && (
                <div className={`fixed bottom-8 right-8 z-[200] flex items-center gap-4 px-6 py-4 rounded-2xl shadow-2xl border animate-slideInRight ${toast.type === 'success' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-rose-600 text-white border-rose-500'}`}>
                    <div className="flex items-center gap-3">
                        {toast.type === 'success' ? <Check size={20} className="shrink-0" /> : <AlertCircle size={20} className="shrink-0" />}
                        <span className="font-extrabold text-sm tracking-tight">{toast.message}</span>
                    </div>
                    <button onClick={() => setToast(prev => ({ ...prev, show: false }))} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                        <X size={16} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default SelectionProcessManager;
