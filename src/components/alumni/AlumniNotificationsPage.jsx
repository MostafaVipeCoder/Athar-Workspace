import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import { useAuth } from '../../contexts/AuthContext';
import {
  Bell, Send, Users, Building2, GraduationCap,
  CheckCircle2, Clock, Eye, AlertCircle, Sparkles,
  RotateCw, Loader2, X, ChevronRight, User
} from 'lucide-react';
import RichTextEditor from '../RichTextEditor';
import {
  sendManagerBroadcastNotification,
  getAlumniManagerNotificationsLog,
  getAlumniFilterOptions,
  getFounders,
  getAlumniCompanies
} from '../../lib/api';

export default function AlumniNotificationsPage() {
  const { user } = useAuth();
  const { lang, isRtl } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);

  // Form State
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audienceType, setAudienceType] = useState('all'); // 'all', 'founder', 'company', 'program'
  const [targetId, setTargetId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [sending, setSending] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Dropdown options
  const [foundersList, setFoundersList] = useState([]);
  const [companiesList, setCompaniesList] = useState([]);
  const [programsList, setProgramsList] = useState([]);

  // Details Modal
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedBroadcast, setSelectedBroadcast] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [logs, founders, comps, filterOpts] = await Promise.all([
        getAlumniManagerNotificationsLog(),
        getFounders(),
        getAlumniCompanies(),
        getAlumniFilterOptions()
      ]);
      setHistory(logs);
      setFoundersList(founders || []);
      setCompaniesList(comps || []);
      setProgramsList(filterOpts.programs || []);
    } catch (err) {
      console.error('Error loading notifications page data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendNotification = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Please provide notification title');
      return;
    }
    if (!body || body.trim() === '<p><br></p>') {
      alert('Please write notification content');
      return;
    }
    if (audienceType !== 'all' && !targetId) {
      alert('Please select target audience entity');
      return;
    }

    try {
      setSending(true);
      const res = await sendManagerBroadcastNotification({
        title: title.trim(),
        body,
        audienceType,
        targetId: audienceType === 'all' ? null : targetId,
        sentBy: user?.id,
        priority
      });

      showToast(`Notification dispatched to ${res.count} recipients`);
      
      // Reset form
      setTitle('');
      setBody('');
      setAudienceType('all');
      setTargetId('');
      
      // Refresh log
      const logs = await getAlumniManagerNotificationsLog();
      setHistory(logs);
    } catch (err) {
      alert(err.message || 'Failed to dispatch notification');
    } finally {
      setSending(false);
    }
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const openDetails = (broadcast) => {
    setSelectedBroadcast(broadcast);
    setDetailsModalOpen(true);
  };

  const getAudienceLabel = (type) => {
    switch (type) {
      case 'all':
        return 'All Founders';
      case 'founder':
        return 'Specific Founder';
      case 'company':
        return 'By Company';
      case 'program':
        return 'By Program';
      default:
        return type;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-athar-blue text-white px-5 py-3 rounded-2xl shadow-sm flex items-center gap-2 text-xs font-bold animate-in slide-in-from-bottom-4">
          <CheckCircle2 size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-athar-blue/20 shadow-sm ">
        <h1 className="text-2xl font-black text-foreground flex items-center gap-2.5">
          <Bell className="text-athar-blue" size={24} />
          <span>{'Notifications Management'}</span>
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">
          {isRtl
            ? 'نشر التنبيهات والإعلانات لمجتمع الخريجين مع استهداف دقيق ومتابعة نسب القراءة والمشاهدة.'
            : 'Broadcast announcements and direct updates to founders with audience targeting and read analytics.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* ── Form Section (المهمة 2.8) ── */}
        <div className="lg:col-span-5 bg-white border border-border/60 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="border-b border-border/60 pb-3">
            <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
              <Send size={18} className="text-athar-blue" />
              <span>{'New Broadcast'}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {'Compose message and define target audience'}
            </p>
          </div>

          <form onSubmit={handleSendNotification} className="space-y-4">
            
            {/* Title */}
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                {'Notification Title'}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={'e.g. New Grant Application Opened...'}
                className="w-full bg-muted/40 border border-border/60 rounded-xl px-3.5 py-2.5 text-xs text-foreground placeholder-slate-500 focus:outline-none focus:border-athar-blue"
              />
            </div>

            {/* Target Audience Dropdown */}
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                {'Audience Target'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'all', label: 'All Founders', icon: Users },
                  { id: 'founder', label: 'Founder', icon: User },
                  { id: 'company', label: 'Company', icon: Building2 },
                  { id: 'program', label: 'Program', icon: GraduationCap }
                ].map(item => {
                  const Icon = item.icon;
                  const isSelected = audienceType === item.id;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setAudienceType(item.id);
                        setTargetId('');
                      }}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition-all text-left ${
                        isSelected
                          ? 'bg-athar-blue/20 border-athar-blue text-foreground'
                          : 'bg-muted/40 border-border/60 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon size={14} className={isSelected ? 'text-athar-yellow' : 'text-muted-foreground/70'} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Target Selection Dropdown (if not all) */}
            {audienceType === 'founder' && (
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                  {'Select Founder'}
                </label>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-athar-blue"
                >
                  <option value="">{'-- Choose founder --'}</option>
                  {foundersList.map(f => (
                    <option key={f.founder_id} value={f.founder_id}>
                      {f.name_ar || f.name_en} ({f.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {audienceType === 'company' && (
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                  {'Select Company'}
                </label>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-indigo-500"
                >
                  <option value="">{'-- Choose company --'}</option>
                  {companiesList.map(c => (
                    <option key={c.company_id} value={c.company_id}>
                      {c.name} ({c.sector || 'Startup'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {audienceType === 'program' && (
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                  {'Select Program'}
                </label>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-indigo-500"
                >
                  <option value="">{'-- Choose program --'}</option>
                  {programsList.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.year ? `(${p.year})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Rich Text Body Editor */}
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                {'Notification Body'}
              </label>
              <div className="bg-muted/40 rounded-2xl border border-border/60 overflow-hidden">
                <RichTextEditor
                  value={body}
                  onChange={setBody}
                  placeholder={'Write message details...'}
                  minHeight="140px"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={sending}
                className="w-full py-3 rounded-2xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-black shadow-lg shadow-athar-blue/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                <span>{'Publish & Dispatch'}</span>
              </button>
            </div>

          </form>
        </div>

        {/* ── Sent Log Table (المهمة 2.9) ── */}
        <div className="lg:col-span-7 bg-white border border-border/60 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
              <div>
                <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
                  <Clock size={18} className="text-athar-blue" />
                  <span>{'Broadcasts History'}</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {'Previous broadcasts and readership tracking'}
                </p>
              </div>
              <button
                onClick={loadData}
                className="p-2 rounded-xl bg-muted/40 hover:bg-slate-800 text-muted-foreground transition-colors"
                title={'Refresh'}
              >
                <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[580px] pr-1">
              {loading ? (
                <div className="py-16 text-center text-muted-foreground/70 text-xs">
                  <Loader2 size={24} className="animate-spin text-athar-blue mx-auto mb-2" />
                  <span>{'Loading log...'}</span>
                </div>
              ) : history.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground/70 text-xs">
                  <Bell size={32} className="mx-auto mb-2 opacity-30 text-athar-blue" />
                  <p className="font-bold">{'No broadcasts yet'}</p>
                </div>
              ) : (
                history.map((item) => {
                  const readPercent = item.totalRecipients > 0 ? Math.round((item.readCount / item.totalRecipients) * 100) : 0;
                  return (
                    <div
                      key={item.broadcastId}
                      className="bg-muted/30 border border-border/60 rounded-2xl p-4 hover:border-athar-blue/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground truncate max-w-[280px]">
                            {item.title}
                          </span>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-athar-blue/10 text-athar-blue border border-athar-blue/20 shrink-0">
                            {getAudienceLabel(item.audienceType)}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-3">
                          <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                          <span>·</span>
                          <span className="text-athar-blue font-semibold font-mono">
                            {item.totalRecipients} {'recipients'}
                          </span>
                          <span>·</span>
                          <span className="text-emerald-400 font-semibold font-mono">
                            {item.readCount} {'read'} ({readPercent}%)
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => openDetails(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-athar-blue hover:text-foreground text-muted-foreground border border-border/60 text-xs font-bold transition-all shrink-0 self-end sm:self-center"
                      >
                        <Eye size={13} />
                        <span>{'Details'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ── Details Modal ── */}
      {detailsModalOpen && selectedBroadcast && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-muted/50 ">
          <div className="bg-white border border-athar-blue/30 rounded-2xl w-full max-w-2xl p-6 shadow-sm relative animate-in zoom-in-95 max-h-[85vh] flex flex-col">
            <button
              onClick={() => setDetailsModalOpen(false)}
              className="absolute top-5 right-5 text-muted-foreground hover:text-foreground"
            >
              <X size={18} />
            </button>

            <h2 className="text-lg font-black text-foreground flex items-center gap-2 mb-1">
              <Eye size={18} className="text-athar-blue" />
              <span>{selectedBroadcast.title}</span>
            </h2>
            <div className="text-[11px] text-muted-foreground flex items-center gap-3 mb-4">
              <span>{getAudienceLabel(selectedBroadcast.audienceType)}</span>
              <span>·</span>
              <span>{new Date(selectedBroadcast.createdAt).toLocaleString()}</span>
            </div>

            {/* Rendered Body */}
            <div className="bg-muted/40 p-4 rounded-2xl border border-border/60 text-xs text-foreground mb-4 max-h-48 overflow-y-auto prose prose-invert prose-xs">
              <div dangerouslySetInnerHTML={{ __html: selectedBroadcast.body }} />
            </div>

            {/* Recipients Read Status */}
            <div className="flex-1 overflow-y-auto border-t border-border/60 pt-3 space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground">
                {'Recipients & Read Status:'}
              </h3>
              <div className="space-y-1.5">
                {(selectedBroadcast.recipients || []).map((rec, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 bg-muted/40/60 border border-border/60/60 rounded-xl text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <User size={13} className="text-muted-foreground" />
                      <span className="font-bold text-foreground">
                        {rec.founder?.name_ar || rec.founder?.name_en || rec.recipientId || 'Founder'}
                      </span>
                      {rec.founder?.email && (
                        <span className="text-[11px] text-muted-foreground/70 font-mono">({rec.founder.email})</span>
                      )}
                    </div>
                    {rec.isRead ? (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                        <CheckCircle2 size={12} />
                        {'Read'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400">
                        <Clock size={12} />
                        {'Unread'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-border/60 flex justify-end">
              <button
                onClick={() => setDetailsModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-foreground text-xs font-bold"
              >
                {'Close'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}



