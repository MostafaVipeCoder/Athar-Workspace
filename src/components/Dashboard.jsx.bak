import React, { useState, useEffect } from 'react';
import { Plus, Calendar, ChevronRight, Layout, Trash2, X, AlertCircle, Edit2, ExternalLink, Check, Copy, LogOut, Users as UsersIcon, BookOpen } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { getEvents, createEvent, deleteEvent } from '../lib/api';
import { formatDate } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../hooks/usePresence';
import ActiveUsers from './ActiveUsers';
import { prefetch } from '../App';

export default function Dashboard() {
    const navigate = useNavigate();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newEventName, setNewEventName] = useState('');
    const { activeUsers } = usePresence('global_dashboard');
    const [createStatus, setCreateStatus] = useState('idle'); // idle, loading, success
    const [error, setError] = useState(null);
    const { signOut } = useAuth();

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate('/login');
        } catch (error) {
            console.error('Error signing out:', error);
        }
    };

    useEffect(() => {
        loadEvents();
    }, []);

    const loadEvents = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await getEvents();
            setEvents(data || []);
        } catch (error) {
            console.error('Error loading events:', error);
            setError('فشل الاتصال بـ Supabase. تأكد من إعدادات المشروع ومفاتيح الـ API.');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateEvent = async () => {
        if (!newEventName.trim()) return;

        try {
            setCreateStatus('loading');
            const data = await createEvent({ event_name: newEventName });

            setCreateStatus('success');
            // Wait a bit to show success message
            setTimeout(() => {
                setNewEventName('');
                setShowCreateModal(false);
                setCreateStatus('idle');
                if (data && data.event_id) {
                    navigate(`/event/${data.event_id}`);
                } else {
                    loadEvents();
                }
            }, 1500);
        } catch (error) {
            console.error('Error creating event:', error);
            setCreateStatus('idle');
            alert('حصل خطأ أثناء الإنشاء');
        }
    };

    const handleDeleteEvent = async (eventId) => {
        if (!confirm('متأكد إنك عايز تمسح الـ Event ده؟')) return;

        try {
            await deleteEvent(eventId);
            loadEvents();
        } catch (error) {
            console.error('Error deleting event:', error);
        }
    };

    const handleEditEvent = (eventId) => {
        navigate(`/event/${eventId}`);
    };

    const [copiedId, setCopiedId] = useState(null);
    const handleCopyLink = (eventId) => {
        const url = `${window.location.origin}/#/agenda/${eventId}`;
        navigator.clipboard.writeText(url);
        setCopiedId(eventId);
        setTimeout(() => setCopiedId(null), 2000);
    };

    return (
        <div className="min-h-screen bg-background font-manrope relative overflow-x-hidden text-foreground">
            {/* Page Background Gradients and Noise */}
            <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/5 via-background to-background" />
            <div 
                className="pointer-events-none fixed inset-0 z-0 opacity-10 mix-blend-soft-light" 
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
            />

            {/* Premium Header */}
            <div className="relative z-10 bg-background/70 backdrop-blur-xl border-b border-border/50 sticky top-0 shadow-sm animate-in fade-in duration-500">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex items-center justify-between gap-3">
                        {/* Logo */}
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="bg-athar-blue p-2 sm:p-2.5 rounded-xl shadow-lg shadow-athar-blue/20">
                                <Layout className="text-white" size={20} />
                            </div>
                            <div className="hidden sm:block">
                                <h1 className="text-lg font-extrabold text-athar-black tracking-tight flex items-center gap-2">
                                    Athar <span className="text-athar-blue">Planner</span>
                                </h1>
                                <p className="text-[10px] text-athar-black/40 font-bold uppercase tracking-widest mt-0.5">Professional Event Ecosystem</p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 sm:gap-4">
                            <div className="hidden sm:block">
                                <ActiveUsers users={activeUsers} />
                            </div>

                            <div className="flex items-center gap-2 sm:gap-3 sm:border-l sm:border-border/50 sm:pl-4">
                                <Link
                                    to="/library"
                                    className="flex items-center gap-2 text-muted-foreground hover:text-athar-blue px-3 sm:px-4 py-2 rounded-lg font-bold transition-all hover:bg-athar-blue/5 tap-target"
                                >
                                    <BookOpen size={18} />
                                    <span className="hidden sm:inline">Central Library</span>
                                </Link>

                                <Link
                                    to="/experts"
                                    className="flex items-center gap-2 text-muted-foreground hover:text-athar-blue px-3 sm:px-4 py-2 rounded-lg font-bold transition-all hover:bg-athar-blue/5 tap-target"
                                >
                                    <UsersIcon size={18} />
                                    <span className="hidden sm:inline">Athar Experts Network</span>
                                </Link>

                                <Link
                                    to="/mentor-booking-admin"
                                    className="flex items-center gap-2 text-muted-foreground hover:text-athar-blue px-3 sm:px-4 py-2 rounded-lg font-bold transition-all hover:bg-athar-blue/5 tap-target"
                                >
                                    <Calendar size={18} />
                                    <span className="hidden sm:inline">Mentor Booking</span>
                                </Link>

                                <button
                                    onClick={() => setShowCreateModal(true)}
                                    className="group relative overflow-hidden flex items-center gap-2 bg-gradient-to-r from-athar-blue to-athar-black text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-athar-blue/20 hover:-translate-y-0.5 active:scale-95"
                                >
                                    <Plus size={18} className="relative z-10" />
                                    <span className="relative z-10 hidden sm:inline">Create Project</span>
                                </button>

                                <button
                                    onClick={handleSignOut}
                                    className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-all border border-transparent hover:border-destructive/20 tap-target"
                                    title="Sign Out"
                                >
                                    <LogOut size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
                {/* Stats / Welcome Section */}
                <div className="mb-8 sm:mb-12 animate-in slide-in-from-bottom-4 duration-700">
                    <h2 className="text-2xl sm:text-4xl font-extrabold mb-2 tracking-tight text-foreground">Welcome Back</h2>
                    <p className="text-muted-foreground font-medium text-base sm:text-lg flex items-center gap-2">
                        You have <strong className="text-primary">{events.length} active event{events.length !== 1 ? 's' : ''}</strong> under your management.
                    </p>
                </div>

                {/* Grid */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-64 bg-card/50 backdrop-blur-sm text-card-foreground rounded-2xl border border-white/5 shadow-lg animate-in fade-in zoom-in-95 duration-500">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                        <p className="text-muted-foreground font-semibold">Syncing with workspace...</p>
                    </div>
                ) : error ? (
                    <div className="bg-destructive/5 rounded-2xl border border-destructive/20 p-12 text-center shadow-lg animate-in fade-in zoom-in-95 duration-500 backdrop-blur-sm">
                        <div className="mx-auto h-16 w-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mb-5 border border-destructive/20 shadow-inner">
                            <AlertCircle size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-destructive mb-2 font-manrope">Connection Error</h3>
                        <p className="text-destructive/80 max-w-md mx-auto mb-8 font-medium">
                            {error}
                        </p>
                        <button
                            onClick={loadEvents}
                            className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl text-destructive-foreground bg-destructive hover:bg-destructive/90 transition-premium font-semibold shadow-lg shadow-destructive/20"
                        >
                            Retry Connection
                        </button>
                    </div>
                ) : events.length === 0 ? (
                    <div className="bg-card/50 backdrop-blur-md rounded-3xl border border-white/5 p-16 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-500 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
                        
                        <div className="mx-auto h-24 w-24 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-8 border border-primary/20 shadow-xl shadow-primary/5 relative z-10">
                            <Calendar size={48} />
                        </div>
                        <h3 className="text-3xl font-bold text-foreground mb-4 relative z-10">Your Event List is Empty</h3>
                        <p className="text-muted-foreground max-w-md mx-auto mb-10 text-lg font-medium relative z-10">
                            Get started by creating your first event agenda. It only takes a few seconds to sync and build your ecosystem.
                        </p>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="group relative overflow-hidden inline-flex items-center justify-center gap-3 px-10 py-4 rounded-xl text-primary-foreground bg-primary transition-premium font-semibold shadow-2xl shadow-primary/30 hover:-translate-y-1 active:scale-95 border border-primary/50 relative z-10"
                        >
                            <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <Plus size={24} className="relative z-10" />
                            <span className="relative z-10 text-lg">Create First Event</span>
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-6 lg:gap-8">
                        {events.map((event, index) => (
                            <div
                                key={event.event_id}
                                onClick={() => navigate(`/event/${event.event_id}`)}
                                onMouseEnter={() => prefetch.eventDashboard()}
                                style={{ animationDelay: `${index * 50}ms` }}
                                className="group bg-card text-card-foreground rounded-xl sm:rounded-3xl border border-white/5 p-3 sm:p-7 shadow-xl hover:shadow-2xl hover:border-primary/40 hover:-translate-y-1 transition-premium cursor-pointer relative overflow-hidden flex flex-col h-full animate-in fade-in zoom-in-95"
                            >
                                {/* Decorative elements */}
                                <div className="absolute top-0 right-0 w-24 h-24 sm:w-40 sm:h-40 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full -mr-6 -mt-6 sm:-mr-10 sm:-mt-10 transition-transform group-hover:scale-110 pointer-events-none"></div>
                                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-gradient-to-r from-primary/50 to-primary opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>

                                <div className="flex justify-between items-start mb-3 sm:mb-6 relative z-10">
                                    <div className="bg-white p-2 sm:p-3.5 rounded-lg group-hover:bg-athar-blue group-hover:text-white transition-all duration-300 border border-border shadow-sm">
                                        <Calendar size={14} className="sm:hidden" />
                                        <Calendar size={22} className="hidden sm:block" />
                                    </div>
                                    <span className={`px-1.5 py-0.5 sm:px-3.5 sm:py-1.5 rounded-full text-[7px] sm:text-[10px] font-bold uppercase tracking-widest border backdrop-blur-md ${event.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted/50 text-muted-foreground border-border/50'
                                        }`}>
                                        {event.status || 'Active'}
                                    </span>
                                </div>

                                <h3 className="text-[13px] sm:text-2xl font-bold mb-1.5 sm:mb-3 group-hover:text-primary transition-colors line-clamp-2 relative z-10 leading-tight">
                                    {event.event_name}
                                </h3>

                                <div className="h-px w-full bg-border/50 my-3 sm:my-6 relative z-10" />

                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2.5 mt-auto relative z-10">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); navigate(`/event/${event.event_id}`); }}
                                        className="flex-1 flex items-center justify-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 bg-primary/5 hover:bg-primary/10 text-primary text-[9px] sm:text-sm font-bold rounded-lg sm:rounded-xl transition-colors border border-primary/10"
                                    >
                                        <Edit2 size={12} className="sm:size-[16px]" />
                                        <span>Manage</span>
                                    </button>

                                    <div className="flex gap-1 sm:gap-1.5 justify-center">
                                        <a
                                            href={`#/agenda/${event.event_id}`}
                                            target="_blank"
                                            onClick={(e) => e.stopPropagation()}
                                            className="h-8 w-8 sm:h-11 sm:w-11 flex items-center justify-center rounded-lg sm:rounded-xl border border-border/50 bg-background text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all shadow-sm"
                                            title="View Public Page"
                                        >
                                            <ExternalLink size={14} className="sm:size-[18px]" />
                                        </a>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleCopyLink(event.event_id); }}
                                            className={`h-8 w-8 sm:h-11 sm:w-11 flex items-center justify-center rounded-lg sm:rounded-xl border transition-all shadow-sm ${copiedId === event.event_id
                                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                                                : 'bg-background border-border/50 text-muted-foreground hover:bg-primary/5 hover:border-primary/30 hover:text-primary'
                                                }`}
                                            title="Copy Link"
                                        >
                                            {copiedId === event.event_id ? <Check size={14} className="sm:size-[18px]" /> : <Copy size={14} className="sm:size-[18px]" />}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteEvent(event.event_id); }}
                                            className="h-8 w-8 sm:h-11 sm:w-11 flex items-center justify-center rounded-lg sm:rounded-xl border border-border/50 bg-background text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-all shadow-sm"
                                            title="Delete Event"
                                        >
                                            <Trash2 size={14} className="sm:size-[18px]" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Project Modal */}
            {
                showCreateModal && (
                    <div className="fixed inset-0 bg-background/80 backdrop-blur-xl flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
                        <div className="bg-card text-card-foreground border border-white/10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg p-6 sm:p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 flex flex-col">
                            {/* Glassmorphism accents */}
                            <div className="absolute -top-32 -right-32 w-64 h-64 bg-athar-blue/20 rounded-full blur-3xl pointer-events-none"></div>
                            <div 
                                className="pointer-events-none absolute inset-0 z-0 opacity-10 mix-blend-soft-light" 
                                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
                            />
                            
                            <div className="relative z-10 w-full">
                                {createStatus === 'idle' ? (
                                    <>
                                        <div className="text-center mb-8">
                                            <div className="h-20 w-20 bg-primary/10 text-primary border border-primary/20 shadow-inner rounded-2xl flex items-center justify-center mx-auto mb-6">
                                                <Calendar size={40} />
                                            </div>
                                            <h3 className="text-3xl font-extrabold text-foreground tracking-tight">Create New Event</h3>
                                            <p className="text-muted-foreground mt-2 font-medium text-lg">Give your event a descriptive name to get started.</p>
                                        </div>
                                        <div className="mb-8">
                                            <label className="block text-sm font-bold text-muted-foreground mb-2 ml-1">Event Name</label>
                                            <input
                                                type="text"
                                                autoFocus
                                                value={newEventName}
                                                onChange={(e) => setNewEventName(e.target.value)}
                                                placeholder="e.g. Q4 Marketing Summit"
                                                className="w-full px-5 py-4 bg-background border border-border/50 text-foreground rounded-2xl font-semibold placeholder-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-sm"
                                                onKeyDown={(e) => e.key === 'Enter' && handleCreateEvent()}
                                            />
                                        </div>
                                        <div className="flex gap-4">
                                            <button
                                                onClick={() => setShowCreateModal(false)}
                                                className="flex-1 bg-muted/50 border border-border/50 text-foreground px-6 py-4 rounded-xl hover:bg-muted transition-colors font-bold"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleCreateEvent}
                                                className="flex-[2] relative group overflow-hidden bg-primary text-primary-foreground px-6 py-4 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all border border-primary/50"
                                            >
                                                <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                                <span className="relative z-10 flex items-center justify-center gap-2">
                                                    <Plus size={20} />
                                                    Create Project
                                                </span>
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center py-12">
                                        {createStatus === 'loading' ? (
                                            <>
                                                <div className="relative mb-8">
                                                    <div className="absolute inset-0 rounded-full blur-xl bg-primary/30 animate-pulse"></div>
                                                    <div className="animate-spin rounded-full h-20 w-20 border-4 border-muted border-t-primary relative z-10"></div>
                                                </div>
                                                <p className="text-2xl font-bold text-foreground">Creating your event...</p>
                                                <p className="text-muted-foreground mt-2 font-medium">Setting up the workspace</p>
                                            </>
                                        ) : (
                                            <>
                                                <div className="relative mb-8">
                                                    <div className="absolute inset-0 rounded-full blur-xl bg-emerald-500/30 animate-pulse"></div>
                                                    <div className="h-24 w-24 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center animate-bounce relative z-10 shadow-inner">
                                                        <Check size={48} />
                                                    </div>
                                                </div>
                                                <p className="text-3xl font-extrabold text-foreground tracking-tight">Event Created!</p>
                                                <p className="text-muted-foreground mt-2 font-medium text-lg">Redirecting you to the dashboard...</p>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
