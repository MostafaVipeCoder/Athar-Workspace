import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../hooks/useLanguage';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  Mail, Send, RotateCw, Copy, Check, ExternalLink,
  Search, Filter, Plus, Users, CheckCircle2, Clock,
  AlertCircle, XCircle, ChevronLeft, ChevronRight,
  ShieldAlert, Loader2, Sparkles, X, RefreshCw
} from 'lucide-react';
import {
  getAlumniInvitationsList, getUnregisteredFounders,
  sendAlumniInvitation, sendBulkAlumniInvitations,
  resendAlumniInvitation, revokeAlumniInvitation
} from '../../lib/api';

export default function AlumniInvitationsPage() {
  const { user } = useAuth();
  const { lang, isRtl } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [invitations, setInvitations] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 12, total: 0, totalPages: 1 });
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [singleModalOpen, setSingleModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [unregisteredFounders, setUnregisteredFounders] = useState([]);

  // Single Modal state
  const [selectedFounderId, setSelectedFounderId] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualCompanyId, setManualCompanyId] = useState('');
  const [sendingSingle, setSendingSingle] = useState(false);
  const [singleSuccessData, setSingleSuccessData] = useState(null);

  // Bulk Modal state
  const [selectedFounderIds, setSelectedFounderIds] = useState(new Set());
  const [sendingBulk, setSendingBulk] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [bulkCompleted, setBulkCompleted] = useState(false);

  // Interactive feedback
  const [copiedId, setCopiedId] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);

  useEffect(() => {
    loadInvitations();
  }, [statusFilter, pagination.page]);

  const loadInvitations = async () => {
    try {
      setLoading(true);
      const res = await getAlumniInvitationsList({
        status: statusFilter,
        search: searchQuery,
        page: pagination.page,
        limit: pagination.limit
      });
      setInvitations(res.data);
      setPagination(prev => ({
        ...prev,
        total: res.total,
        totalPages: res.totalPages || 1
      }));
    } catch (err) {
      console.error('Error fetching invitations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPagination(p => ({ ...p, page: 1 }));
    loadInvitations();
  };

  const openSingleModal = async () => {
    setSingleSuccessData(null);
    setSelectedFounderId('');
    setManualEmail('');
    setManualCompanyId('');
    setSingleModalOpen(true);
    const unreg = await getUnregisteredFounders();
    setUnregisteredFounders(unreg);
  };

  const openBulkModal = async () => {
    setBulkCompleted(false);
    setBulkProgress({ current: 0, total: 0 });
    setSelectedFounderIds(new Set());
    setBulkModalOpen(true);
    const unreg = await getUnregisteredFounders();
    setUnregisteredFounders(unreg);
    // Pre-select all by default for convenience
    const allIds = new Set(unreg.map(f => f.founder_id));
    setSelectedFounderIds(allIds);
  };

  const handleSendSingle = async (e) => {
    e.preventDefault();
    try {
      setSendingSingle(true);
      let targetCompanyId = manualCompanyId;
      let targetEmail = manualEmail;
      let targetFounderId = selectedFounderId || null;

      if (selectedFounderId) {
        const found = unregisteredFounders.find(f => f.founder_id === selectedFounderId);
        if (found) {
          targetEmail = found.email;
          targetCompanyId = found.company_founders?.[0]?.company_id;
        }
      }

      if (!targetCompanyId || !targetEmail) {
        alert('Please provide a valid company and email');
        return;
      }

      const inv = await sendAlumniInvitation({
        companyId: targetCompanyId,
        founderId: targetFounderId,
        email: targetEmail,
        sentBy: user?.id
      });

      setSingleSuccessData(inv);
      loadInvitations();
    } catch (err) {
      alert(err.message || 'Error creating invitation');
    } finally {
      setSendingSingle(false);
    }
  };

  const handleSendBulk = async () => {
    if (selectedFounderIds.size === 0) return;
    try {
      setSendingBulk(true);
      const targets = [];
      unregisteredFounders.forEach(f => {
        if (selectedFounderIds.has(f.founder_id) && f.email) {
          const compId = f.company_founders?.[0]?.company_id;
          if (compId) {
            targets.push({
              companyId: compId,
              founderId: f.founder_id,
              email: f.email
            });
          }
        }
      });

      setBulkProgress({ current: 0, total: targets.length });

      await sendBulkAlumniInvitations({
        invitations: targets,
        sentBy: user?.id,
        onProgress: (cur, tot) => setBulkProgress({ current: cur, total: tot })
      });

      setBulkCompleted(true);
      loadInvitations();
    } catch (err) {
      alert(err.message || 'Bulk sending failed');
    } finally {
      setSendingBulk(false);
    }
  };

  const handleResend = async (id) => {
    try {
      await resendAlumniInvitation(id);
      showNotice('Invitation renewed and resent');
      loadInvitations();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRevoke = async (id) => {
    if (!confirm('Are you sure you want to revoke this invitation?')) return;
    try {
      await revokeAlumniInvitation(id);
      showNotice('Invitation revoked');
      loadInvitations();
    } catch (err) {
      alert(err.message);
    }
  };

  const copyInviteLink = (token, id) => {
    const origin = window.location.origin;
    const url = `${origin}/#/alumni/signup?token=${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const showNotice = (msg) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3000);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'accepted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 size={12} />
            {'Accepted'}
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle size={12} />
            {'Expired'}
          </span>
        );
      case 'revoked':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-slate-800 text-muted-foreground border border-slate-700">
            <AlertCircle size={12} />
            {'Revoked'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock size={12} />
            {'Pending'}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Toast Notification */}
      {actionNotice && (
        <div className="fixed bottom-6 right-6 z-50 bg-athar-blue text-foreground px-5 py-3 rounded-2xl shadow-sm flex items-center gap-2 text-xs font-bold animate-in slide-in-from-bottom-4">
          <CheckCircle2 size={16} />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Header with Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-indigo-950/80 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2.5">
            <Mail className="text-indigo-400" size={24} />
            <span>{'Founder Invitations'}</span>
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            {isRtl
              ? 'إنشاء ومتابعة دعوات الانضمام للمؤسسين المدخلين يدوياً لإنشاء حساباتهم وربط شركاتهم.'
              : 'Issue and track onboarding invitations for manual founders to link their ventures.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={openBulkModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-foreground text-xs font-extrabold border border-indigo-900/40 transition-all shadow"
          >
            <Users size={14} className="text-indigo-400" />
            <span>{'Bulk Invitations'}</span>
          </button>

          <button
            onClick={openSingleModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-extrabold shadow-lg shadow-athar-blue/30 transition-all"
          >
            <Plus size={15} />
            <span>{'New Invitation'}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white/40 p-4 rounded-2xl border border-border/60">
        {/* Status Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: 'all', label: 'All' },
            { id: 'pending', label: 'Pending' },
            { id: 'accepted', label: 'Accepted' },
            { id: 'expired', label: 'Expired' },
            { id: 'revoked', label: 'Revoked' }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => {
                setStatusFilter(f.id);
                setPagination(p => ({ ...p, page: 1 }));
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                statusFilter === f.id
                  ? 'bg-athar-blue text-foreground shadow'
                  : 'bg-muted/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 min-w-[260px]">
          <div className="relative flex-1">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 left-3 text-muted-foreground/70" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={'Search by email...'}
              className="w-full bg-muted/40 border border-border/60 rounded-xl pl-9 pr-3 py-1.5 text-xs text-foreground placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-foreground text-xs font-bold"
          >
            {'Search'}
          </button>
        </form>
      </div>

      {/* Invitations Table */}
      <div className="bg-white border border-border/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-muted-foreground" dir={'ltr'}>
            <thead className="bg-muted/50 text-[11px] font-black uppercase text-muted-foreground tracking-wider border-b border-border/60">
              <tr>
                <th className="py-4 px-6">{'Company / Founder'}</th>
                <th className="py-4 px-6">{'Email Address'}</th>
                <th className="py-4 px-6">{'Status'}</th>
                <th className="py-4 px-6">{'Sent Date'}</th>
                <th className="py-4 px-6">{'Accepted At'}</th>
                <th className="py-4 px-6 text-center">{'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-muted-foreground/70">
                    <Loader2 size={24} className="animate-spin text-indigo-400 mx-auto mb-2" />
                    <span>{'Loading invitations...'}</span>
                  </td>
                </tr>
              ) : invitations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-muted-foreground/70">
                    <Mail size={32} className="mx-auto mb-2 opacity-30 text-indigo-400" />
                    <p className="font-bold">{'No invitations found'}</p>
                    <p className="text-[11px] text-slate-600 mt-1">
                      {'Create a single or bulk invitation to get started.'}
                    </p>
                  </td>
                </tr>
              ) : (
                invitations.map((inv) => {
                  const companyName = inv.companies?.name || 'Venture';
                  const founderName = inv.founders?.name_ar || inv.founders?.name_en || null;
                  const isCopied = copiedId === inv.id;

                  return (
                    <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-bold text-foreground text-sm">{companyName}</div>
                        {founderName && (
                          <div className="text-[11px] text-muted-foreground font-medium">{founderName}</div>
                        )}
                      </td>
                      <td className="py-4 px-6 font-mono text-muted-foreground text-xs">
                        {inv.founder_email}
                      </td>
                      <td className="py-4 px-6">
                        {getStatusBadge(inv.status)}
                      </td>
                      <td className="py-4 px-6 text-muted-foreground text-xs">
                        {inv.sent_at ? new Date(inv.sent_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-4 px-6 text-muted-foreground text-xs">
                        {inv.accepted_at ? new Date(inv.accepted_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Copy Link Button */}
                          <button
                            onClick={() => copyInviteLink(inv.token, inv.id)}
                            className="p-1.5 rounded-lg bg-muted/40 hover:bg-slate-800 text-muted-foreground border border-border/60 transition-colors"
                            title={'Copy invite link'}
                          >
                            {isCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                          </button>

                          {/* Resend Button */}
                          {(inv.status === 'pending' || inv.status === 'expired') && (
                            <button
                              onClick={() => handleResend(inv.id)}
                              className="p-1.5 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 transition-colors"
                              title={'Resend invitation'}
                            >
                              <RotateCw size={14} />
                            </button>
                          )}

                          {/* Revoke Button */}
                          {inv.status === 'pending' && (
                            <button
                              onClick={() => handleRevoke(inv.id)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 transition-colors"
                              title={'Revoke invitation'}
                            >
                              <XCircle size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {pagination.totalPages > 1 && (
          <div className="p-4 bg-muted/30 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {isRtl
                ? `صفحة ${pagination.page} من ${pagination.totalPages} (${pagination.total} إجمالي)`
                : `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} total)`}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={pagination.page <= 1}
                onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                className="p-1.5 rounded-lg bg-white border border-border/60 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                className="p-1.5 rounded-lg bg-white border border-border/60 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Single Invitation Modal (المهمة 2.6) ── */}
      {singleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-muted/50">
          <div className="bg-white border border-indigo-900/60 rounded-2xl w-full max-w-lg p-6 shadow-sm relative animate-in zoom-in-95">
            <button
              onClick={() => setSingleModalOpen(false)}
              className="absolute top-5 right-5 text-muted-foreground hover:text-foreground"
            >
              <X size={18} />
            </button>

            <h2 className="text-xl font-black text-foreground flex items-center gap-2 mb-1">
              <Plus size={20} className="text-indigo-400" />
              <span>{'Send Individual Invitation'}</span>
            </h2>
            <p className="text-xs text-muted-foreground mb-6">
              {isRtl
                ? 'اختر مؤسساً مسجلاً بدون حساب أو أدخل بريد وشركة يدوياً لإنشاء رابط التفعيل.'
                : 'Select an unregistered founder or input details manually to generate onboarding link.'}
            </p>

            {singleSuccessData ? (
              <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-3">
                <CheckCircle2 size={32} className="text-emerald-400 mx-auto" />
                <h3 className="text-sm font-bold text-foreground">
                  {'Invitation Created Successfully!'}
                </h3>
                <p className="text-xs text-muted-foreground font-mono break-all bg-muted/40 p-2.5 rounded-xl border border-border/60">
                  {`${window.location.origin}/#/alumni/signup?token=${singleSuccessData.token}`}
                </p>
                <button
                  onClick={() => copyInviteLink(singleSuccessData.token, 'modal')}
                  className="w-full py-2.5 rounded-xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-bold transition-all shadow"
                >
                  {copiedId === 'modal' ? ('Copied!') : ('Copy Direct Link')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendSingle} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                    {'Unregistered Founders'}
                  </label>
                  <select
                    value={selectedFounderId}
                    onChange={(e) => setSelectedFounderId(e.target.value)}
                    className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">{'-- Select from list --'}</option>
                    {unregisteredFounders.map(f => (
                      <option key={f.founder_id} value={f.founder_id}>
                        {f.name_ar || f.name_en} ({f.email}) — {f.company_founders?.[0]?.companies?.name || 'No Company'}
                      </option>
                    ))}
                  </select>
                </div>

                {!selectedFounderId && (
                  <>
                    <div className="relative flex py-1 items-center">
                      <div className="flex-grow border-t border-border/60"></div>
                      <span className="flex-shrink mx-3 text-[10px] text-muted-foreground/70 uppercase font-black">
                        {'Or Manual Input'}
                      </span>
                      <div className="flex-grow border-t border-border/60"></div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                        {'Founder Email'}
                      </label>
                      <input
                        type="email"
                        value={manualEmail}
                        onChange={(e) => setManualEmail(e.target.value)}
                        placeholder="founder@example.com"
                        className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2.5 text-xs text-foreground focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                        {'Company ID (UUID)'}
                      </label>
                      <input
                        type="text"
                        value={manualCompanyId}
                        onChange={(e) => setManualCompanyId(e.target.value)}
                        placeholder="Company UUID"
                        className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2.5 text-xs text-foreground font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={sendingSingle}
                    className="w-full py-3 rounded-2xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-black shadow-lg shadow-athar-blue/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {sendingSingle ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    <span>{'Create & Dispatch Invitation'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk Invitations Modal (المهمة 2.7) ── */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-muted/50">
          <div className="bg-white border border-indigo-900/60 rounded-2xl w-full max-w-xl p-6 shadow-sm relative animate-in zoom-in-95 max-h-[90vh] flex flex-col">
            <button
              onClick={() => setBulkModalOpen(false)}
              className="absolute top-5 right-5 text-muted-foreground hover:text-foreground"
            >
              <X size={18} />
            </button>

            <h2 className="text-xl font-black text-foreground flex items-center gap-2 mb-1">
              <Users size={20} className="text-indigo-400" />
              <span>{'Bulk Invitations Dispatch'}</span>
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              {isRtl
                ? 'حدد المؤسسين المدخلين يدوياً لإرسال روابط التسجيل لجميع الشركات دفعة واحدة.'
                : 'Select unregistered founders to batch-generate and dispatch onboarding credentials.'}
            </p>

            {/* Selection Controls */}
            <div className="flex items-center justify-between pb-3 border-b border-border/60 text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedFounderIds(new Set(unregisteredFounders.map(f => f.founder_id)))}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-muted-foreground font-bold"
                >
                  {'Select All'}
                </button>
                <button
                  onClick={() => setSelectedFounderIds(new Set())}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-muted-foreground font-bold"
                >
                  {'Deselect All'}
                </button>
              </div>
              <span className="font-bold text-indigo-400 font-mono">
                {selectedFounderIds.size} / {unregisteredFounders.length} {'selected'}
              </span>
            </div>

            {/* Founders Checkbox List */}
            <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1">
              {unregisteredFounders.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground/70 text-xs">
                  {'No pending founders found.'}
                </div>
              ) : (
                unregisteredFounders.map(f => {
                  const checked = selectedFounderIds.has(f.founder_id);
                  const compName = f.company_founders?.[0]?.companies?.name || 'No company';
                  return (
                    <label
                      key={f.founder_id}
                      className={`flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer ${
                        checked
                          ? 'bg-indigo-950/40 border-indigo-600/50 text-foreground'
                          : 'bg-muted/40/40 border-border/50 text-muted-foreground hover:bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selectedFounderIds);
                          if (e.target.checked) next.add(f.founder_id);
                          else next.delete(f.founder_id);
                          setSelectedFounderIds(next);
                        }}
                        className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate">
                          {f.name_ar || f.name_en || 'Founder'}
                        </div>
                        <div className="text-[11px] text-muted-foreground/70 truncate">
                          {f.email} · <span className="text-indigo-400">{compName}</span>
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* Progress Bar (when sending) */}
            {sendingBulk && (
              <div className="pt-3 border-t border-border/60 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                  <span>{'Sending invitations...'}</span>
                  <span>{bulkProgress.current} / {bulkProgress.total}</span>
                </div>
                <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{
                      width: `${bulkProgress.total ? (bulkProgress.current / bulkProgress.total) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>
            )}

            {/* Completed Feedback */}
            {bulkCompleted && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center text-xs font-bold text-emerald-400 mt-3">
                {'All selected invitations were created successfully!'}
              </div>
            )}

            {/* Modal Actions */}
            <div className="pt-4 border-t border-border/60 flex items-center justify-end gap-2">
              <button
                onClick={() => setBulkModalOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-muted-foreground text-xs font-bold"
              >
                {'Close'}
              </button>
              <button
                onClick={handleSendBulk}
                disabled={sendingBulk || selectedFounderIds.size === 0}
                className="px-5 py-2.5 rounded-xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-black shadow-lg shadow-athar-blue/30 transition-all disabled:opacity-40"
              >
                {sendingBulk ? ('Sending...') : (`Send (${selectedFounderIds.size}) Invites`)}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}



