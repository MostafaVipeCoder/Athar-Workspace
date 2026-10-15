import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, ArrowLeft, TrendingUp, Users, Calendar, Filter,
  Building2, Plus, CheckCircle2, Clock, AlertCircle, Search,
  Download, Eye, RefreshCw, ChevronRight, FileText, Check, X
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import {
  getAlumniCompanies, getImpactStats, createSnapshot,
  getCompanySnapshots
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { translations } from '../../lib/translations';
import * as XLSX from 'xlsx';

export default function MEWorkspace() {
  const navigate = useNavigate();
  const lang = 'en';
  const isRtl = false;
  const t = translations.Alumni[lang] || translations.Alumni.ar;

  const [companies, setCompanies] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('tracking');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  // New snapshot modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [snapshotForm, setSnapshotForm] = useState({
    snapshot_type: 'annual_update',
    snapshot_date: new Date().toISOString().split('T')[0],
    revenue_sar: '',
    employees_count: '',
    jobs_created: '',
    funding_raised_sar: '',
    is_active: true,
    milestones: '',
    challenges: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [comps, impact, snapsRes] = await Promise.all([
        getAlumniCompanies(),
        getImpactStats(),
        supabase.from('company_snapshots').select('*, companies(name, industry)').order('snapshot_date', { ascending: false }).limit(100)
      ]);
      setCompanies(comps || []);
      setStats(impact);
      setSnapshots(snapsRes.data || []);
    } catch (err) {
      console.error('Error loading M&E Workspace:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSnapshot = async (e) => {
    e.preventDefault();
    if (!selectedCompany) return;
    try {
      await createSnapshot({
        companyId: selectedCompany.company_id || selectedCompany.id,
        snapshotType: snapshotForm.snapshot_type,
        snapshotDate: snapshotForm.snapshot_date,
        source: 'me_team',
        data: {
          revenue_sar: Number(snapshotForm.revenue_sar) || 0,
          employees_count: Number(snapshotForm.employees_count) || 0,
          jobs_created: Number(snapshotForm.jobs_created) || 0,
          funding_raised_sar: Number(snapshotForm.funding_raised_sar) || 0,
          is_active: snapshotForm.is_active,
          milestones: snapshotForm.milestones,
          challenges: snapshotForm.challenges
        }
      });
      setShowAddModal(false);
      setSelectedCompany(null);
      loadData();
      alert('Snapshot saved successfully');
    } catch (err) {
      console.error('Error adding snapshot:', err);
      alert('Error saving snapshot');
    }
  };

  const exportReport = () => {
    const data = companies.map(c => {
      const snap = snapshots.find(s => s.company_id === (c.company_id || c.id));
      return {
        'Company Name': c.name || c.startup_name,
        'Name AR': c.startup_name_ar || '',
        'Industry': c.industry || '',
        'Stage': c.stage || '',
        'Province': c.province || c.location || '',
        'Last Update Date': snap?.snapshot_date || 'Never',
        'Update Type': snap?.snapshot_type || '',
        'Revenue (SAR)': snap?.data?.revenue_sar || 0,
        'Jobs Created': snap?.data?.jobs_created || 0,
        'Funding (SAR)': snap?.data?.funding_raised_sar || 0,
        'Is Active': snap?.data?.is_active !== false ? 'Yes' : 'No'
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ME Tracking');
    XLSX.writeFile(wb, `Athar_ME_Tracking_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredCompanies = companies.filter(c => {
    const nameMatch =
      c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.startup_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.startup_name_ar?.toLowerCase().includes(searchTerm.toLowerCase());
    return nameMatch;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-athar-blue/20 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-athar-blue/20 border border-athar-blue/40 text-athar-yellow flex items-center justify-center">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-foreground">
              {t.meWorkspace}
            </h1>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              {'Monitoring & Evaluation Team Workspace'}
            </p>
          </div>
        </div>

        <button
          onClick={exportReport}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-bold shadow-md shadow-athar-blue/20 transition-all self-start sm:self-center"
        >
          <Download size={16} />
          <span>{'Export Sheet'}</span>
        </button>
      </div>
      <div>
        {/* KPI Row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
              <div className="text-xs font-bold text-muted-foreground mb-1">{'Tracked Companies'}</div>
              <div className="text-2xl sm:text-3xl font-black text-foreground">{stats.totalAlumniCompanies}</div>
              <div className="text-[10px] text-emerald-600 font-bold mt-1">
                {stats.activeCompanies} {'currently active'}
              </div>
            </div>

            <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
              <div className="text-xs font-bold text-muted-foreground mb-1">{'Annual Response Rate'}</div>
              <div className="text-2xl sm:text-3xl font-black text-foreground">{stats.snapshotsCoverage}%</div>
              <div className="text-[10px] text-muted-foreground font-bold mt-1">
                {'Snapshot coverage'}
              </div>
            </div>

            <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
              <div className="text-xs font-bold text-muted-foreground mb-1">{t.jobsCreated}</div>
              <div className="text-2xl sm:text-3xl font-black text-foreground">{stats.totalJobsCreated.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground font-bold mt-1">
                {'Verified jobs'}
              </div>
            </div>

            <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
              <div className="text-xs font-bold text-muted-foreground mb-1">{t.fundingRaised}</div>
              <div className="text-xl sm:text-2xl font-black text-foreground truncate">
                {stats.totalFundingRaised ? `${(stats.totalFundingRaised / 1000000).toFixed(1)}M SAR` : '0'}
              </div>
              <div className="text-[10px] text-muted-foreground font-bold mt-1">
                {'Total funding'}
              </div>
            </div>
          </div>
        )}

        {/* Tab Selector */}
        <div className="flex items-center gap-2 border-b border-border/50 pb-2">
          <button
            onClick={() => setActiveTab('tracking')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
              activeTab === 'tracking'
                ? 'bg-athar-blue text-foreground shadow'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {'Company Tracking'}
          </button>
          <button
            onClick={() => setActiveTab('snapshots')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
              activeTab === 'snapshots'
                ? 'bg-athar-blue text-foreground shadow'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {'Snapshot Log'}
          </button>
        </div>

        {/* TAB 1: Company Tracking Table */}
        {activeTab === 'tracking' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground ${'left-3'}`} size={16} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className={`w-full py-2 bg-muted/40 border border-border/60 rounded-xl text-xs font-semibold focus:outline-none focus:border-athar-blue ${
                    'pl-9 pr-3'
                  }`}
                />
              </div>
            </div>

            <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right rtl:text-right ltr:text-left">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground font-black text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="p-4">{'Company'}</th>
                      <th className="p-4">{'Sector'}</th>
                      <th className="p-4">{'Stage'}</th>
                      <th className="p-4">{'Last Snapshot'}</th>
                      <th className="p-4 text-center">{'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {filteredCompanies.map(c => {
                      const snap = snapshots.find(s => s.company_id === (c.company_id || c.id));
                      return (
                        <tr key={c.company_id || c.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-4 font-bold text-foreground">
                            {(isRtl && c.startup_name_ar) || c.name || c.startup_name}
                          </td>
                          <td className="p-4 text-muted-foreground">{c.industry || '—'}</td>
                          <td className="p-4">
                            <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-bold">
                              {c.stage || 'Seed'}
                            </span>
                          </td>
                          <td className="p-4">
                            {snap ? (
                              <div className="flex items-center gap-1.5 text-foreground font-semibold">
                                <CheckCircle2 size={13} className="text-emerald-500" />
                                <span>{snap.snapshot_date}</span>
                                <span className="text-[10px] text-muted-foreground">({snap.snapshot_type})</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-amber-500 font-semibold">
                                <Clock size={13} />
                                <span>{'Never'}</span>
                              </div>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => {
                                  setSelectedCompany(c);
                                  setShowAddModal(true);
                                }}
                                className="px-3 py-1 bg-athar-blue/10 hover:bg-athar-blue/20 text-athar-blue rounded-lg text-xs font-bold transition-all"
                              >
                                {'Log Snapshot'}
                              </button>
                              <Link
                                to={`/alumni/admin/company/${c.company_id || c.id}?lang=${lang}`}
                                className="p-1.5 bg-muted hover:bg-muted/80 rounded-lg text-muted-foreground transition-all"
                                title={'Profile'}
                              >
                                <Eye size={14} />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Snapshot Log */}
        {activeTab === 'snapshots' && (
          <div className="space-y-4">
            <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right rtl:text-right ltr:text-left">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground font-black text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="p-4">{'Company'}</th>
                      <th className="p-4">{'Date'}</th>
                      <th className="p-4">{'Type'}</th>
                      <th className="p-4">{t.totalRevenue}</th>
                      <th className="p-4">{t.jobsCreated}</th>
                      <th className="p-4">{t.fundingRaised}</th>
                      <th className="p-4">{'Source'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {snapshots.map(s => (
                      <tr key={s.snapshot_id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-4 font-bold text-foreground">
                          {s.companies?.name || s.companies?.startup_name || 'Startup'}
                        </td>
                        <td className="p-4 font-mono font-bold text-muted-foreground">{s.snapshot_date}</td>
                        <td className="p-4">
                          <span className="px-2 py-0.5 rounded-full bg-athar-blue/10 text-athar-blue text-[10px] font-black uppercase">
                            {s.snapshot_type}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-foreground">
                          {s.data?.revenue_sar ? `${Number(s.data.revenue_sar).toLocaleString()} SAR` : '—'}
                        </td>
                        <td className="p-4 font-bold text-foreground">
                          {s.data?.jobs_created ?? s.data?.employees_count ?? '—'}
                        </td>
                        <td className="p-4 font-bold text-foreground">
                          {s.data?.funding_raised_sar ? `${Number(s.data.funding_raised_sar).toLocaleString()} SAR` : '—'}
                        </td>
                        <td className="p-4 text-muted-foreground">{s.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Add Snapshot */}
      {showAddModal && selectedCompany && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 max-w-lg w-full shadow-sm space-y-4 my-8 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-foreground">
                  {'Log Official Impact Snapshot'}
                </h3>
                <p className="text-xs text-muted-foreground font-bold">
                  {selectedCompany.name || selectedCompany.startup_name}
                </p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveSnapshot} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">{t.snapshotType}</label>
                  <select
                    value={snapshotForm.snapshot_type}
                    onChange={(e) => setSnapshotForm({ ...snapshotForm, snapshot_type: e.target.value })}
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  >
                    <option value="annual_update">{t.annualUpdate}</option>
                    <option value="graduation">{t.graduation}</option>
                    <option value="program_start">{t.programStart}</option>
                    <option value="6_month_followup">{t.sixMonthFollowup}</option>
                    <option value="manual_import">{t.manualImport}</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">{'Date'}</label>
                  <input
                    type="date"
                    value={snapshotForm.snapshot_date}
                    onChange={(e) => setSnapshotForm({ ...snapshotForm, snapshot_date: e.target.value })}
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">{t.totalRevenue} (SAR)</label>
                  <input
                    type="number"
                    value={snapshotForm.revenue_sar}
                    onChange={(e) => setSnapshotForm({ ...snapshotForm, revenue_sar: e.target.value })}
                    placeholder="0"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">{t.fundingRaised} (SAR)</label>
                  <input
                    type="number"
                    value={snapshotForm.funding_raised_sar}
                    onChange={(e) => setSnapshotForm({ ...snapshotForm, funding_raised_sar: e.target.value })}
                    placeholder="0"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">{t.jobsCreated}</label>
                  <input
                    type="number"
                    value={snapshotForm.jobs_created}
                    onChange={(e) => setSnapshotForm({ ...snapshotForm, jobs_created: e.target.value })}
                    placeholder="0"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">{'Employees'}</label>
                  <input
                    type="number"
                    value={snapshotForm.employees_count}
                    onChange={(e) => setSnapshotForm({ ...snapshotForm, employees_count: e.target.value })}
                    placeholder="0"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">{'Milestones & Notes'}</label>
                <textarea
                  value={snapshotForm.milestones}
                  onChange={(e) => setSnapshotForm({ ...snapshotForm, milestones: e.target.value })}
                  rows={2}
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-athar-blue text-foreground rounded-xl text-xs font-black shadow-lg shadow-athar-blue/20"
                >
                  حفظ اللقطة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}



