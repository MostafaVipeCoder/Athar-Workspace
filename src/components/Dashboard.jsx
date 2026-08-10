import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Calendar, Layout, Trash2, X, AlertCircle, Edit2,
  ExternalLink, Check, Copy, LogOut, Users as UsersIcon, BookOpen,
  ChevronDown, ChevronRight, FolderOpen, Folder, MoreVertical,
  MoveRight, Pencil, FolderPlus
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import {
  getEvents, createEvent, deleteEvent,
  getPrograms, createProgram, updateProgram, deleteProgram, assignEventToProgram
} from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../hooks/usePresence';
import ActiveUsers from './ActiveUsers';
import { prefetch } from '../App';

function cn(...classes) { return classes.filter(Boolean).join(' '); }


function EventCard({ event, programs, copiedId, onManage, onCopy, onDelete, onMove }) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMoveMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div
      className="group bg-card text-card-foreground rounded-xl border border-border/60 p-3 sm:p-5 shadow-md hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 transition-all cursor-pointer relative overflow-hidden flex flex-col"
      onClick={() => onManage(event.event_id)}
      onMouseEnter={() => prefetch.eventDashboard()}
    >
      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/8 to-transparent rounded-bl-full -mr-4 -mt-4 pointer-events-none transition-transform group-hover:scale-110" />
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-primary/40 to-primary opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

      <div className="flex justify-between items-start mb-3 relative z-10">
        <div className="bg-white p-2 sm:p-2.5 rounded-lg group-hover:bg-athar-blue group-hover:text-white transition-all duration-300 border border-border shadow-sm">
          <Calendar size={14} className="sm:hidden" />
          <Calendar size={18} className="hidden sm:block" />
        </div>
        <span className={cn(
          'px-2 py-0.5 rounded-full text-[8px] sm:text-[10px] font-bold uppercase tracking-widest border',
          event.status === 'active'
            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
            : 'bg-muted/50 text-muted-foreground border-border/50'
        )}>
          {event.status || 'Active'}
        </span>
      </div>

      <h3 className="text-[12px] sm:text-base font-bold mb-3 group-hover:text-primary transition-colors line-clamp-2 relative z-10 leading-snug flex-1">
        {event.event_name}
      </h3>

      <div className="h-px w-full bg-border/40 mb-3 relative z-10" />

      <div className="flex items-center gap-1.5 mt-auto relative z-10" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onManage(event.event_id)}
          className="flex-1 flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 bg-primary/5 hover:bg-primary/10 text-primary text-[9px] sm:text-xs font-bold rounded-lg transition-colors border border-primary/10"
        >
          <Edit2 size={11} className="sm:size-[13px]" />
          <span>Manage</span>
        </button>
        <a
          href={`#/agenda/${event.event_id}`}
          target="_blank"
          onClick={(e) => e.stopPropagation()}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/50 bg-background text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all shadow-sm"
          title="View Public Page"
        >
          <ExternalLink size={13} />
        </a>
        <button
          onClick={() => onCopy(event.event_id)}
          className={cn(
            'h-8 w-8 flex items-center justify-center rounded-lg border transition-all shadow-sm',
            copiedId === event.event_id
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
              : 'bg-background border-border/50 text-muted-foreground hover:bg-primary/5 hover:border-primary/30 hover:text-primary'
          )}
          title="Copy Link"
        >
          {copiedId === event.event_id ? <Check size={13} /> : <Copy size={13} />}
        </button>

        {/* Move to Program dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMoveMenu(v => !v)}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/50 bg-background text-muted-foreground hover:text-athar-blue hover:border-athar-blue/30 hover:bg-athar-blue/5 transition-all shadow-sm"
            title="Move to Program"
          >
            <MoveRight size={13} />
          </button>
          {showMoveMenu && (
            <div className="absolute bottom-full right-0 mb-1 w-52 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Move to Program</p>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {programs.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-3">No programs yet</p>
                ) : (
                  <>
                    {event.program_id && (
                      <button
                        onClick={() => { onMove(event.event_id, null); setShowMoveMenu(false); }}
                        className="w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-2 text-muted-foreground"
                      >
                        <X size={12} />
                        Unassign from program
                      </button>
                    )}
                    {programs.map(prog => (
                      <button
                        key={prog.program_id}
                        onClick={() => { onMove(event.event_id, prog.program_id); setShowMoveMenu(false); }}
                        className={cn(
                          'w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-2',
                          event.program_id === prog.program_id ? 'text-primary bg-primary/5' : 'text-foreground'
                        )}
                      >
                        <Folder size={12} />
                        {prog.name}
                        {event.program_id === prog.program_id && <Check size={11} className="ml-auto text-primary" />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => onDelete(event.event_id)}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/50 bg-background text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-all shadow-sm"
          title="Delete Event"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function ProgramCard({
  program, events, allPrograms, copiedId,
  onManageEvent, onCopyEvent, onDeleteEvent, onMoveEvent,
  onAddEventToProgram, onRenameProgram, onDeleteProgram
}) {
  const [expanded, setExpanded] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeCount = events.filter(e => e.status === 'active' || !e.status).length;

  return (
    <div className="mb-6 bg-card rounded-2xl border border-border/60 shadow-md overflow-hidden">
      {/* Program header bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-r from-athar-blue/5 to-transparent border-b border-border/40">
        <button className="flex items-center gap-3 flex-1 text-left group" onClick={() => setExpanded(v => !v)}>
          <div className="p-2 rounded-lg bg-athar-blue/10 text-athar-blue group-hover:bg-athar-blue group-hover:text-white transition-all duration-200">
            {expanded ? <FolderOpen size={18} /> : <Folder size={18} />}
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-foreground tracking-tight leading-tight">{program.name}</h3>
            <p className="text-[10px] sm:text-xs text-muted-foreground font-semibold mt-0.5">
              {events.length} project{events.length !== 1 ? 's' : ''}
              {activeCount > 0 && <span className="ml-1.5 text-emerald-600">· {activeCount} active</span>}
            </p>
          </div>
          <div className="ml-2 text-muted-foreground group-hover:text-athar-blue transition-colors">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onAddEventToProgram(program.program_id)}
            className="flex items-center gap-1.5 px-3 py-2 bg-athar-blue text-white rounded-lg text-[10px] sm:text-xs font-bold hover:opacity-90 transition-all shadow-sm"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">Add Project</span>
          </button>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu(v => !v)}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <MoreVertical size={15} />
            </button>
            {showMenu && (
              <div className="absolute top-full right-0 mt-1 w-44 bg-card border border-border rounded-xl shadow-xl z-40 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                <button
                  onClick={() => { onRenameProgram(program); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-muted flex items-center gap-2 text-foreground"
                >
                  <Pencil size={12} />Rename Program
                </button>
                <button
                  onClick={() => { onDeleteProgram(program.program_id); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-destructive/10 flex items-center gap-2 text-destructive"
                >
                  <Trash2 size={12} />Delete Program
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Events grid */}
      {expanded && (
        <div className="p-4 sm:p-6">
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                <FolderOpen size={24} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground mb-3">No projects yet</p>
              <button
                onClick={() => onAddEventToProgram(program.program_id)}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary/5 hover:bg-primary/10 text-primary rounded-lg text-xs font-bold border border-primary/10 transition-colors"
              >
                <Plus size={13} />Add first project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-4">
              {events.map(event => (
                <EventCard
                  key={event.event_id}
                  event={event}
                  programs={allPrograms}
                  copiedId={copiedId}
                  onManage={onManageEvent}
                  onCopy={onCopyEvent}
                  onDelete={onDeleteEvent}
                  onMove={onMoveEvent}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { activeUsers } = usePresence('global_dashboard');
  const { signOut } = useAuth();

  // Modal visibility
  const [showCreateEventModal, setShowCreateEventModal] = useState(false);
  const [showCreateProgramModal, setShowCreateProgramModal] = useState(false);
  const [showRenameProgramModal, setShowRenameProgramModal] = useState(false);

  // Form state
  const [newEventName, setNewEventName] = useState('');
  const [createEventStatus, setCreateEventStatus] = useState('idle');
  const [targetProgramId, setTargetProgramId] = useState(null);
  const [newProgramName, setNewProgramName] = useState('');
  const [createProgramStatus, setCreateProgramStatus] = useState('idle');
  const [renamingProgram, setRenamingProgram] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const handleSignOut = async () => {
    try { await signOut(); navigate('/login'); } catch (e) { console.error(e); }
  };

  const loadAll = async () => {
    try {
      setLoading(true);
      setError(null);
      const [eventsData, programsData] = await Promise.all([getEvents(), getPrograms()]);
      setEvents(eventsData || []);
      setPrograms(programsData || []);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('فشل الاتصال بـ Supabase. تأكد من إعدادات المشروع ومفاتيح الـ API.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const openAddEvent = (programId = null) => {
    setTargetProgramId(programId);
    setNewEventName('');
    setCreateEventStatus('idle');
    setShowCreateEventModal(true);
  };

  const handleCreateEvent = async () => {
    if (!newEventName.trim()) return;
    try {
      setCreateEventStatus('loading');
      const data = await createEvent({ event_name: newEventName });
      if (targetProgramId && data?.event_id) {
        await assignEventToProgram(data.event_id, targetProgramId);
      }
      setCreateEventStatus('success');
      setTimeout(() => {
        setShowCreateEventModal(false);
        setCreateEventStatus('idle');
        setNewEventName('');
        if (data?.event_id) navigate(`/event/${data.event_id}`);
        else loadAll();
      }, 1500);
    } catch (err) {
      console.error('Error creating event:', err);
      setCreateEventStatus('idle');
      alert('حصل خطأ أثناء الإنشاء');
    }
  };

  const handleDeleteEvent = async (eventId) => {
    if (!confirm('متأكد إنك عايز تمسح الـ Event ده؟')) return;
    try { await deleteEvent(eventId); loadAll(); } catch (err) { console.error(err); }
  };

  const handleCopyLink = (eventId) => {
    navigator.clipboard.writeText(`${window.location.origin}/#/agenda/${eventId}`);
    setCopiedId(eventId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleMoveEvent = async (eventId, programId) => {
    try { await assignEventToProgram(eventId, programId); loadAll(); }
    catch (err) { console.error(err); alert('حصل خطأ أثناء النقل'); }
  };

  const handleCreateProgram = async () => {
    if (!newProgramName.trim()) return;
    try {
      setCreateProgramStatus('loading');
      await createProgram(newProgramName);
      setCreateProgramStatus('success');
      setTimeout(() => {
        setShowCreateProgramModal(false);
        setCreateProgramStatus('idle');
        setNewProgramName('');
        loadAll();
      }, 1000);
    } catch (err) {
      setCreateProgramStatus('idle');
      alert('حصل خطأ أثناء إنشاء البرنامج');
    }
  };

  const handleDeleteProgram = async (programId) => {
    if (!confirm('حذف البرنامج لن يحذف المشاريع، فقط سيتم إلغاء ارتباطها به. هل تريد المتابعة؟')) return;
    try { await deleteProgram(programId); loadAll(); } catch (err) { console.error(err); }
  };

  const openRenameProgram = (program) => {
    setRenamingProgram(program);
    setRenameValue(program.name);
    setShowRenameProgramModal(true);
  };

  const handleRenameProgram = async () => {
    if (!renameValue.trim() || !renamingProgram) return;
    try {
      await updateProgram(renamingProgram.program_id, { name: renameValue.trim() });
      setShowRenameProgramModal(false);
      setRenamingProgram(null);
      loadAll();
    } catch (err) { alert('حصل خطأ أثناء تعديل الاسم'); }
  };

  const unassignedEvents = events.filter(e => !e.program_id);
  const totalActiveEvents = events.filter(e => e.status === 'active' || !e.status).length;
  const getEventsForProgram = (programId) => events.filter(e => e.program_id === programId);

  return (
    <div className="min-h-screen bg-background font-manrope relative overflow-x-hidden text-foreground">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/5 via-background to-background" />
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-10 mix-blend-soft-light"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
      />

      {/* Premium Header */}
      <div className="relative z-10 bg-background/70 backdrop-blur-xl border-b border-border/50 sticky top-0 shadow-sm animate-in fade-in duration-500">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-athar-blue p-2 sm:p-2.5 rounded-xl shadow-lg shadow-athar-blue/20">
                <Layout className="text-white" size={20} />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-extrabold text-athar-black tracking-tight flex items-center gap-2">
                  Athar Programs <span className="text-athar-blue">Management</span>
                </h1>
                <p className="text-[10px] text-athar-black/40 font-bold uppercase tracking-widest mt-0.5">Professional Event Ecosystem</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <div className="hidden sm:block"><ActiveUsers users={activeUsers} /></div>
              <div className="flex items-center gap-2 sm:gap-3 sm:border-l sm:border-border/50 sm:pl-4">
                <Link to="/library" className="flex items-center gap-2 text-muted-foreground hover:text-athar-blue px-3 sm:px-4 py-2 rounded-lg font-bold transition-all hover:bg-athar-blue/5 tap-target">
                  <BookOpen size={18} /><span className="hidden sm:inline">Central Library</span>
                </Link>
                <Link to="/experts" className="flex items-center gap-2 text-muted-foreground hover:text-athar-blue px-3 sm:px-4 py-2 rounded-lg font-bold transition-all hover:bg-athar-blue/5 tap-target">
                  <UsersIcon size={18} /><span className="hidden sm:inline">Athar Experts Network</span>
                </Link>

                {/* Add Program */}
                <button
                  onClick={() => { setNewProgramName(''); setCreateProgramStatus('idle'); setShowCreateProgramModal(true); }}
                  className="group flex items-center gap-2 bg-background border border-border text-foreground px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg font-bold transition-all hover:border-athar-blue/40 hover:bg-athar-blue/5 hover:text-athar-blue shadow-sm"
                >
                  <FolderPlus size={18} /><span className="hidden sm:inline text-sm">Add Program</span>
                </button>

                {/* Create Project */}
                <button
                  onClick={() => openAddEvent(null)}
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

      {/* Main Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Welcome */}
        <div className="mb-8 sm:mb-10 animate-in slide-in-from-bottom-4 duration-700">
          <h2 className="text-2xl sm:text-4xl font-extrabold mb-2 tracking-tight text-foreground">Welcome Back</h2>
          <p className="text-muted-foreground font-medium text-base sm:text-lg flex items-center gap-2 flex-wrap">
            You have{' '}
            <strong className="text-primary">{totalActiveEvents} active event{totalActiveEvents !== 1 ? 's' : ''}</strong>{' '}
            across{' '}
            <strong className="text-athar-blue">{programs.length} program{programs.length !== 1 ? 's' : ''}</strong>{' '}
            under your management.
          </p>
        </div>

        {/* States */}
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 bg-card/50 backdrop-blur-sm text-card-foreground rounded-2xl border border-white/5 shadow-lg animate-in fade-in zoom-in-95 duration-500">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4" />
            <p className="text-muted-foreground font-semibold">Syncing with workspace...</p>
          </div>
        ) : error ? (
          <div className="bg-destructive/5 rounded-2xl border border-destructive/20 p-12 text-center shadow-lg animate-in fade-in zoom-in-95 duration-500 backdrop-blur-sm">
            <div className="mx-auto h-16 w-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mb-5 border border-destructive/20 shadow-inner">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-xl font-bold text-destructive mb-2 font-manrope">Connection Error</h3>
            <p className="text-destructive/80 max-w-md mx-auto mb-8 font-medium">{error}</p>
            <button
              onClick={loadAll}
              className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl text-destructive-foreground bg-destructive hover:bg-destructive/90 transition-all font-semibold shadow-lg shadow-destructive/20"
            >
              Retry Connection
            </button>
          </div>
        ) : programs.length === 0 && events.length === 0 ? (
          /* Empty state */
          <div className="bg-card/50 backdrop-blur-md rounded-3xl border border-white/5 p-16 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-500 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
            <div className="mx-auto h-24 w-24 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-8 border border-primary/20 shadow-xl shadow-primary/5 relative z-10">
              <FolderOpen size={48} />
            </div>
            <h3 className="text-3xl font-bold text-foreground mb-4 relative z-10">Start Organizing Your Work</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-10 text-lg font-medium relative z-10">
              Create a Program to group your projects, or add a standalone project directly.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 relative z-10">
              <button
                onClick={() => { setNewProgramName(''); setCreateProgramStatus('idle'); setShowCreateProgramModal(true); }}
                className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-background border border-border text-foreground font-bold hover:border-athar-blue/40 hover:text-athar-blue transition-all shadow-md"
              >
                <FolderPlus size={20} />Create First Program
              </button>
              <button
                onClick={() => openAddEvent(null)}
                className="group relative overflow-hidden inline-flex items-center gap-3 px-10 py-4 rounded-xl text-primary-foreground bg-primary font-semibold shadow-2xl shadow-primary/30 hover:-translate-y-1 active:scale-95 border border-primary/50"
              >
                <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                <Plus size={22} className="relative z-10" />
                <span className="relative z-10 text-base">Create Project</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Programs */}
            {programs.length > 0 && (
              <div className="mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {programs.map(program => (
                  <ProgramCard
                    key={program.program_id}
                    program={program}
                    events={getEventsForProgram(program.program_id)}
                    allPrograms={programs}
                    copiedId={copiedId}
                    onManageEvent={(id) => navigate(`/event/${id}`)}
                    onCopyEvent={handleCopyLink}
                    onDeleteEvent={handleDeleteEvent}
                    onMoveEvent={handleMoveEvent}
                    onAddEventToProgram={openAddEvent}
                    onRenameProgram={openRenameProgram}
                    onDeleteProgram={handleDeleteProgram}
                  />
                ))}
              </div>
            )}

            {/* Unassigned Projects */}
            {unassignedEvents.length > 0 && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-muted text-muted-foreground"><Calendar size={16} /></div>
                    <h3 className="text-base font-extrabold text-foreground">Unassigned Projects</h3>
                    <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold">{unassignedEvents.length}</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-medium hidden sm:flex items-center gap-1">
                    Use <MoveRight size={11} className="mx-0.5" /> to assign to a program
                  </p>
                </div>
                <div className="bg-card/60 rounded-2xl border border-dashed border-border/60 p-4 sm:p-6">
                  <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-4">
                    {unassignedEvents.map(event => (
                      <EventCard
                        key={event.event_id}
                        event={event}
                        programs={programs}
                        copiedId={copiedId}
                        onManage={(id) => navigate(`/event/${id}`)}
                        onCopy={handleCopyLink}
                        onDelete={handleDeleteEvent}
                        onMove={handleMoveEvent}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Create Event Modal ── */}
      {showCreateEventModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-xl flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card text-card-foreground border border-white/10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg p-6 sm:p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 flex flex-col">
            <div className="absolute -top-32 -right-32 w-64 h-64 bg-athar-blue/20 rounded-full blur-3xl pointer-events-none" />
            <div
              className="pointer-events-none absolute inset-0 z-0 opacity-10 mix-blend-soft-light"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
            />
            <div className="relative z-10 w-full">
              {createEventStatus === 'idle' ? (
                <>
                  <div className="text-center mb-8">
                    <div className="h-20 w-20 bg-primary/10 text-primary border border-primary/20 shadow-inner rounded-2xl flex items-center justify-center mx-auto mb-6">
                      <Calendar size={40} />
                    </div>
                    <h3 className="text-3xl font-extrabold text-foreground tracking-tight">Create New Project</h3>
                    {targetProgramId ? (
                      <p className="text-muted-foreground mt-2 font-medium text-sm">
                        Will be added to: <strong className="text-athar-blue">{programs.find(p => p.program_id === targetProgramId)?.name}</strong>
                      </p>
                    ) : (
                      <p className="text-muted-foreground mt-2 font-medium text-lg">Give your project a descriptive name to get started.</p>
                    )}
                  </div>
                  <div className="mb-8">
                    <label className="block text-sm font-bold text-muted-foreground mb-2 ml-1">Project Name</label>
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
                      onClick={() => setShowCreateEventModal(false)}
                      className="flex-1 bg-muted/50 border border-border/50 text-foreground px-6 py-4 rounded-xl hover:bg-muted transition-colors font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateEvent}
                      className="flex-[2] relative group overflow-hidden bg-primary text-primary-foreground px-6 py-4 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all border border-primary/50"
                    >
                      <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <Plus size={20} />Create Project
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center py-12">
                  {createEventStatus === 'loading' ? (
                    <>
                      <div className="relative mb-8">
                        <div className="absolute inset-0 rounded-full blur-xl bg-primary/30 animate-pulse" />
                        <div className="animate-spin rounded-full h-20 w-20 border-4 border-muted border-t-primary relative z-10" />
                      </div>
                      <p className="text-2xl font-bold text-foreground">Creating your project...</p>
                      <p className="text-muted-foreground mt-2 font-medium">Setting up the workspace</p>
                    </>
                  ) : (
                    <>
                      <div className="relative mb-8">
                        <div className="absolute inset-0 rounded-full blur-xl bg-emerald-500/30 animate-pulse" />
                        <div className="h-24 w-24 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center animate-bounce relative z-10 shadow-inner">
                          <Check size={48} />
                        </div>
                      </div>
                      <p className="text-3xl font-extrabold text-foreground tracking-tight">Project Created!</p>
                      <p className="text-muted-foreground mt-2 font-medium text-lg">Redirecting to dashboard...</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Create Program Modal ── */}
      {showCreateProgramModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-xl flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card text-card-foreground border border-white/10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-6 sm:p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="absolute -top-20 -left-20 w-48 h-48 bg-athar-blue/15 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10">
              {createProgramStatus === 'idle' ? (
                <>
                  <div className="text-center mb-8">
                    <div className="h-16 w-16 bg-athar-blue/10 text-athar-blue border border-athar-blue/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
                      <FolderPlus size={32} />
                    </div>
                    <h3 className="text-2xl font-extrabold text-foreground tracking-tight">Create Program</h3>
                    <p className="text-muted-foreground mt-1.5 font-medium text-sm">Programs group related projects together.</p>
                  </div>
                  <div className="mb-6">
                    <label className="block text-sm font-bold text-muted-foreground mb-2 ml-1">Program Name</label>
                    <input
                      type="text"
                      autoFocus
                      value={newProgramName}
                      onChange={(e) => setNewProgramName(e.target.value)}
                      placeholder="e.g. Technation Hackathons 2026"
                      className="w-full px-5 py-4 bg-background border border-border/50 text-foreground rounded-2xl font-semibold placeholder-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all shadow-sm"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateProgram()}
                    />
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => setShowCreateProgramModal(false)} className="flex-1 bg-muted/50 border border-border/50 text-foreground px-6 py-3.5 rounded-xl hover:bg-muted transition-colors font-bold">
                      Cancel
                    </button>
                    <button onClick={handleCreateProgram} className="flex-[2] bg-athar-blue text-white px-6 py-3.5 rounded-xl font-bold shadow-lg shadow-athar-blue/20 hover:opacity-90 transition-all flex items-center justify-center gap-2">
                      <FolderPlus size={18} />Create Program
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center py-10">
                  {createProgramStatus === 'loading' ? (
                    <>
                      <div className="animate-spin rounded-full h-16 w-16 border-4 border-muted border-t-athar-blue mb-6" />
                      <p className="text-xl font-bold text-foreground">Creating program...</p>
                    </>
                  ) : (
                    <>
                      <div className="h-20 w-20 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mb-6 animate-bounce">
                        <Check size={40} />
                      </div>
                      <p className="text-2xl font-extrabold text-foreground">Program Created!</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Rename Program Modal ── */}
      {showRenameProgramModal && renamingProgram && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-xl flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card text-card-foreground border border-white/10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-6 sm:p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="relative z-10">
              <h3 className="text-xl font-extrabold text-foreground mb-6">Rename Program</h3>
              <div className="mb-6">
                <label className="block text-sm font-bold text-muted-foreground mb-2 ml-1">New Name</label>
                <input
                  type="text"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-full px-5 py-4 bg-background border border-border/50 text-foreground rounded-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleRenameProgram()}
                />
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => { setShowRenameProgramModal(false); setRenamingProgram(null); }}
                  className="flex-1 bg-muted/50 border border-border/50 text-foreground px-6 py-3.5 rounded-xl hover:bg-muted transition-colors font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRenameProgram}
                  className="flex-[2] bg-primary text-primary-foreground px-6 py-3.5 rounded-xl font-bold shadow-lg hover:opacity-90 transition-all flex items-center justify-center gap-2"
                >
                  <Check size={18} />Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

