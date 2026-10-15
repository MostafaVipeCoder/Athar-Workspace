import React, { useState, useEffect } from 'react';
import {
  Sparkles, ArrowLeft, Filter, Calendar, Clock, DollarSign,
  Building2, Plus, ExternalLink, CheckCircle2, ChevronRight, X,
  Search, Users, Briefcase
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import {
  getOpportunities, createOpportunity, getAlumniCompanies,
  applyToOpportunity, getOpportunityApplications, updateApplicationStatus
} from '../../lib/api';
import { translations } from '../../lib/translations';

export default function OpportunitiesHub() {
  const navigate = useNavigate();
  const lang = 'en';
  const isRtl = false;
  const t = translations.Alumni[lang] || translations.Alumni.ar;

  const [opportunities, setOpportunities] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showApplicationsModal, setShowApplicationsModal] = useState(false);
  const [activeOpportunity, setActiveOpportunity] = useState(null);
  const [opportunityApplications, setOpportunityApplications] = useState([]);
  const [loadingApps, setLoadingApps] = useState(false);

  // Apply form
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [applying, setApplying] = useState(false);

  // Create Opportunity form
  const [newOpp, setNewOpp] = useState({
    type: 'grant',
    title_ar: '',
    title_en: '',
    provider: '',
    description_ar: '',
    description_en: '',
    amount_sar: '',
    deadline: '',
    eligibility_criteria_ar: '',
    external_url: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [opps, comps] = await Promise.all([
        getOpportunities().catch(() => []),
        getAlumniCompanies().catch(() => [])
      ]);
      setOpportunities(opps || []);
      setCompanies(comps || []);
    } catch (err) {
      console.error('Error loading opportunities:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createOpportunity({
        type: newOpp.type,
        title_ar: newOpp.title_ar,
        title_en: newOpp.title_en || newOpp.title_ar,
        provider: newOpp.provider,
        description_ar: newOpp.description_ar,
        description_en: newOpp.description_en || newOpp.description_ar,
        amount_sar: newOpp.amount_sar ? Number(newOpp.amount_sar) : null,
        deadline: newOpp.deadline || null,
        eligibility_criteria_ar: newOpp.eligibility_criteria_ar,
        external_url: newOpp.external_url || null
      });
      setShowCreateModal(false);
      setNewOpp({
        type: 'grant',
        title_ar: '',
        title_en: '',
        provider: '',
        description_ar: '',
        description_en: '',
        amount_sar: '',
        deadline: '',
        eligibility_criteria_ar: '',
        external_url: ''
      });
      loadData();
    } catch (err) {
      console.error('Error creating opportunity:', err);
      alert('Error adding opportunity');
    }
  };

  const handleApply = async () => {
    if (!selectedCompanyId || !activeOpportunity) return;
    try {
      setApplying(true);
      await applyToOpportunity({
        opportunityId: activeOpportunity.opportunity_id,
        companyId: selectedCompanyId
      });
      alert('Applied successfully!');
      setShowApplyModal(false);
      setActiveOpportunity(null);
    } catch (err) {
      console.error('Error applying:', err);
      alert('Error applying');
    } finally {
      setApplying(false);
    }
  };

  const openApplicationsViewer = async (opp) => {
    try {
      setActiveOpportunity(opp);
      setShowApplicationsModal(true);
      setLoadingApps(true);
      const apps = await getOpportunityApplications(opp.opportunity_id);
      setOpportunityApplications(apps || []);
    } catch (err) {
      console.error('Error loading applications:', err);
    } finally {
      setLoadingApps(false);
    }
  };

  const handleStatusChange = async (appId, newStatus) => {
    try {
      await updateApplicationStatus(appId, newStatus);
      const apps = await getOpportunityApplications(activeOpportunity.opportunity_id);
      setOpportunityApplications(apps || []);
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const filteredOpps = opportunities.filter(o => {
    const typeMatch = !selectedType || o.type === selectedType;
    const searchMatch =
      o.title_ar?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.title_en?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.provider?.toLowerCase().includes(searchTerm.toLowerCase());
    return typeMatch && searchMatch;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-athar-blue/20 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-athar-blue/20 border border-athar-blue/40 text-athar-yellow flex items-center justify-center">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-foreground">
              {t.opportunities}
            </h1>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              {'Grants, funding & partnership opportunities for alumni'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-bold shadow-md shadow-athar-blue/20 transition-all self-start sm:self-center"
        >
          <Plus size={16} />
          <span>{'Add Opportunity'}</span>
        </button>
      </div>
        {/* Search & Filters */}
        <div className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground ${'left-3'}`} size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={'Search opportunities...'}
              className={`w-full py-2 bg-muted/40 border border-border/60 rounded-xl text-xs font-semibold focus:outline-none focus:border-athar-blue ${
                'pl-9 pr-3'
              }`}
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            {['', 'grant', 'investment', 'competition', 'partnership'].map(type => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 capitalize ${
                  selectedType === type
                    ? 'bg-athar-blue text-foreground shadow-sm'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {type === '' ? ('All') :
                 type === 'grant' ? t.grant :
                 type === 'investment' ? t.investment :
                 type === 'competition' ? t.competition : t.partnership}
              </button>
            ))}
          </div>
        </div>

        {/* Opportunities Grid */}
        {!loading && filteredOpps.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredOpps.map(opp => {
              const title = (isRtl && opp.title_ar) || opp.title_en;
              const desc = (isRtl && opp.description_ar) || opp.description_en;
              return (
                <div key={opp.opportunity_id} className="bg-card border border-border/60 hover:border-athar-blue/30 rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full bg-athar-yellow/20 text-athar-black border border-athar-yellow/40">
                        {opp.type}
                      </span>
                      {opp.deadline && (
                        <span className="text-[11px] text-muted-foreground font-bold flex items-center gap-1">
                          <Clock size={12} />
                          <span>{opp.deadline}</span>
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-base font-extrabold text-foreground line-clamp-1">{title}</h3>
                      {opp.provider && (
                        <p className="text-xs text-muted-foreground font-semibold mt-0.5">{opp.provider}</p>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {desc}
                    </p>

                    {opp.amount_sar && (
                      <div className="flex items-center gap-1.5 text-xs font-black text-emerald-600 bg-emerald-500/10 px-3 py-1.5 rounded-xl w-fit">
                        <DollarSign size={14} />
                        <span>{Number(opp.amount_sar).toLocaleString()} SAR</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                    <button
                      onClick={() => openApplicationsViewer(opp)}
                      className="text-xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <Users size={14} />
                      <span>{'Applications'}</span>
                    </button>

                    <button
                      onClick={() => {
                        setActiveOpportunity(opp);
                        setShowApplyModal(true);
                      }}
                      className="px-4 py-2 bg-athar-blue hover:bg-athar-blue/90 text-foreground rounded-xl text-xs font-black shadow transition-all"
                    >
                      {t.applyNow}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredOpps.length === 0 && (
          <div className="bg-card border border-dashed border-border/70 rounded-2xl p-12 text-center max-w-md mx-auto">
            <Sparkles className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs font-bold text-muted-foreground">{t.noOpportunities}</p>
          </div>
        )}


      {/* ─── MODAL 1: CREATE OPPORTUNITY ──────────────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 max-w-lg w-full shadow-sm space-y-4 my-8 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-foreground">{'Add Opportunity'}</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">النوع / Type</label>
                  <select
                    value={newOpp.type}
                    onChange={(e) => setNewOpp({ ...newOpp, type: e.target.value })}
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  >
                    <option value="grant">Grant (منحة)</option>
                    <option value="investment">Investment (استثمار)</option>
                    <option value="competition">Competition (مسابقة)</option>
                    <option value="partnership">Partnership (شراكة)</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">الموعد النهائي / Deadline</label>
                  <input
                    type="date"
                    value={newOpp.deadline}
                    onChange={(e) => setNewOpp({ ...newOpp, deadline: e.target.value })}
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">عنوان الفرصة (عربي)</label>
                <input
                  type="text"
                  value={newOpp.title_ar}
                  onChange={(e) => setNewOpp({ ...newOpp, title_ar: e.target.value })}
                  required
                  placeholder="مثال: منحة دعم الابتكار 2026"
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">الجهة المانحة / Provider</label>
                <input
                  type="text"
                  value={newOpp.provider}
                  onChange={(e) => setNewOpp({ ...newOpp, provider: e.target.value })}
                  placeholder="e.g. Athar Impact Fund"
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">المبلغ المالي التقديري (SAR)</label>
                <input
                  type="number"
                  value={newOpp.amount_sar}
                  onChange={(e) => setNewOpp({ ...newOpp, amount_sar: e.target.value })}
                  placeholder="50,000"
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">الوصف والشروط</label>
                <textarea
                  value={newOpp.description_ar}
                  onChange={(e) => setNewOpp({ ...newOpp, description_ar: e.target.value })}
                  rows={3}
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-athar-blue text-foreground rounded-xl text-xs font-black shadow-lg shadow-athar-blue/20"
                >
                  حفظ ونشر الفرصة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: APPLY FOR OPPORTUNITY ─────────────────────────────────── */}
      {showApplyModal && activeOpportunity && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-sm space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-foreground">
                {'Apply for Opportunity'}
              </h3>
              <button onClick={() => setShowApplyModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <p className="text-xs font-bold text-foreground">
              {(isRtl && activeOpportunity.title_ar) || activeOpportunity.title_en}
            </p>

            <div className="space-y-2 text-xs">
              <label className="font-bold text-muted-foreground block">
                {'Select Company:'}
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
              >
                <option value="">{'Select company...'}</option>
                {companies.map(c => (
                  <option key={c.company_id || c.id} value={c.company_id || c.id}>
                    {c.startup_name_ar || c.name || c.startup_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!selectedCompanyId || applying}
                className="px-5 py-2.5 bg-athar-blue text-foreground rounded-xl text-xs font-black shadow-lg shadow-athar-blue/20 disabled:opacity-50"
              >
                {applying ? '...' : ('Submit Application')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 3: VIEW APPLICATIONS (ADMIN) ─────────────────────────────── */}
      {showApplicationsModal && activeOpportunity && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 max-w-xl w-full shadow-sm space-y-4 animate-in zoom-in-95 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-black text-foreground">
                  {'Applicants'}
                </h3>
                <p className="text-xs text-muted-foreground truncate">
                  {(isRtl && activeOpportunity.title_ar) || activeOpportunity.title_en}
                </p>
              </div>
              <button onClick={() => setShowApplicationsModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2 flex-1 pt-2">
              {loadingApps ? (
                <div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>
              ) : opportunityApplications.length > 0 ? (
                opportunityApplications.map(app => (
                  <div key={app.id} className="p-3 rounded-xl bg-muted/40 border border-border/50 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <h5 className="font-black text-foreground">
                        {app.companies?.name || app.companies?.startup_name}
                      </h5>
                      <p className="text-[11px] text-muted-foreground">
                        {app.applied_at?.split('T')[0]}
                      </p>
                    </div>

                    <select
                      value={app.status}
                      onChange={(e) => handleStatusChange(app.id, e.target.value)}
                      className="bg-card border border-border rounded-lg px-2 py-1 font-bold text-xs"
                    >
                      <option value="applied">Applied</option>
                      <option value="reviewing">Reviewing</option>
                      <option value="accepted">Accepted</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {'No applications recorded yet'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





