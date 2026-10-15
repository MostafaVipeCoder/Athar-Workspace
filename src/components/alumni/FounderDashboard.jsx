import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getFounderProfileByAuth,
  updateFounderCompanyWithSnapshot,
  createFounderCompany,
  getFounderPrograms,
  getCertificates,
  getOpportunities
} from '../../lib/api';
import {
  Building2, Plus, Edit3, Users, DollarSign, MapPin,
  Calendar, CheckCircle2, AlertCircle, Loader2, X,
  TrendingUp, Sparkles, Shield, ArrowUpRight, GraduationCap,
  Award, Clock, ExternalLink
} from 'lucide-react';

export default function FounderDashboard() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  const [founder, setFounder] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryStats, setSummaryStats] = useState({
    programsCount: 0,
    certsCount: 0,
    opportunitiesCount: 0
  });

  // Update Company Modal
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateForm, setUpdateForm] = useState({
    name: '',
    name_ar: '',
    employees_count: '',
    revenue_sar: '',
    net_profit_sar: '',
    province: '',
    challenges: '',
    new_products: ''
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(null);
  const [updateError, setUpdateError] = useState(null);

  // Add Company Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    name_ar: '',
    sector: '',
    province: '',
    founding_year: new Date().getFullYear(),
    employees_count: '1',
    revenue_sar: '0',
    website_url: ''
  });
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const f = await getFounderProfileByAuth(user.id, user.email);
      setFounder(f);

      const compList = (f?.company_founders || [])
        .map(cf => ({
          ...cf.companies,
          role_in_company: cf.role_in_company || cf.role,
          is_primary: cf.is_primary
        }))
        .filter(c => c && c.company_id);

      setCompanies(compList);

      if (f?.founder_id) {
        const [programs, certs, opps] = await Promise.all([
          getFounderPrograms(f.founder_id).catch(() => []),
          getCertificates(f.founder_id).catch(() => []),
          getOpportunities().catch(() => [])
        ]);
        setSummaryStats({
          programsCount: (programs || []).length,
          certsCount: (certs || []).length,
          opportunitiesCount: (opps || []).length
        });
      }
    } catch (err) {
      console.error('Error loading founder dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open Update Modal
  const handleOpenUpdate = (company) => {
    setSelectedCompany(company);
    setUpdateForm({
      name: company.name || '',
      name_ar: company.name_ar || '',
      employees_count: company.employees_count || '',
      revenue_sar: company.revenue_sar || company.annual_revenue || '',
      net_profit_sar: company.net_profit_sar || '',
      province: company.province || company.location || '',
      challenges: company.challenges || '',
      new_products: company.new_products || ''
    });
    setUpdateSuccess(null);
    setUpdateError(null);
    setShowUpdateModal(true);
  };

  // Submit Snapshot & Company Update
  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCompany) return;

    setIsUpdating(true);
    setUpdateError(null);
    setUpdateSuccess(null);

    try {
      await updateFounderCompanyWithSnapshot({
        companyId: selectedCompany.company_id,
        founderId: founder?.founder_id,
        name: updateForm.name,
        name_ar: updateForm.name_ar,
        province: updateForm.province,
        employees_count: updateForm.employees_count ? parseInt(updateForm.employees_count, 10) : null,
        annual_revenue: updateForm.revenue_sar ? parseFloat(updateForm.revenue_sar) : null,
        snapshotData: {
          revenue_sar: updateForm.revenue_sar ? parseFloat(updateForm.revenue_sar) : null,
          net_profit_sar: updateForm.net_profit_sar ? parseFloat(updateForm.net_profit_sar) : null,
          employees_count: updateForm.employees_count ? parseInt(updateForm.employees_count, 10) : null,
          challenges: updateForm.challenges,
          new_products: updateForm.new_products,
          province: updateForm.province
        }
      });

      setUpdateSuccess(isRtl ? 'تم تحديث بيانات الشركة وإضافة لقطة الأثر بنجاح!' : 'Company data & impact snapshot updated successfully!');
      setTimeout(() => {
        setShowUpdateModal(false);
        loadData();
      }, 1200);
    } catch (err) {
      console.error('Update company error:', err);
      setUpdateError(err.message || (isRtl ? 'فشل تحديث البيانات' : 'Failed to update company'));
    } finally {
      setIsUpdating(false);
    }
  };

  // Submit New Company
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!founder?.founder_id) return;

    setIsAdding(true);
    setAddError(null);

    try {
      await createFounderCompany({
        founderId: founder.founder_id,
        companyData: {
          name: addForm.name,
          name_ar: addForm.name_ar || addForm.name,
          sector: addForm.sector,
          province: addForm.province,
          founding_year: parseInt(addForm.founding_year, 10),
          website_url: addForm.website_url,
          is_alumni: true,
          stage: 'Early Traction'
        },
        initialSnapshot: {
          employees_count: parseInt(addForm.employees_count, 10) || 1,
          revenue_sar: parseFloat(addForm.revenue_sar) || 0,
          province: addForm.province
        }
      });

      setShowAddModal(false);
      setAddForm({
        name: '',
        name_ar: '',
        sector: '',
        province: '',
        founding_year: new Date().getFullYear(),
        employees_count: '1',
        revenue_sar: '0',
        website_url: ''
      });
      loadData();
    } catch (err) {
      console.error('Add company error:', err);
      setAddError(err.message || (isRtl ? 'فشل إضافة الشركة' : 'Failed to add company'));
    } finally {
      setIsAdding(false);
    }
  };

  const displayName = (isRtl && founder?.name_ar) || founder?.name_en || founder?.name_ar || user?.email?.split('@')[0] || 'Founder';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
        <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
        <p className="text-sm font-bold text-slate-500">
          {isRtl ? 'جاري تحميل لوحة التحكم...' : 'Loading founder dashboard...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-black uppercase tracking-wider mb-3">
              <Sparkles size={14} />
              {isRtl ? 'بوابة المؤسس الرسمية' : 'Official Founder Portal'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              {isRtl ? `مرحباً بك، ${displayName}` : `Welcome back, ${displayName}`}
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-xl">
              {isRtl
                ? 'لوحتك الموحدة لإدارة شركاتك الناشئة، تحديث مؤشرات الأثر، ومتابعة برامج وفرص مسرعة أثر.'
                : 'Your unified dashboard to manage startups, report impact metrics, and access Athar programs and grants.'}
            </p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm px-5 py-3 rounded-xl shadow-lg shadow-amber-500/25 transition-all hover:-translate-y-0.5 active:scale-95 shrink-0"
          >
            <Plus size={18} />
            <span>{isRtl ? 'إضافة شركة جديدة' : 'Add New Company'}</span>
          </button>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
            <Building2 size={20} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400">{isRtl ? 'الشركات' : 'Startups'}</div>
            <div className="text-xl font-black text-slate-900">{companies.length}</div>
          </div>
        </div>

        <Link to={`/alumni/founder/programs?lang=${lang}`} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3 hover:border-amber-400 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-athar-blue/10 text-athar-blue flex items-center justify-center shrink-0 border border-athar-blue/20">
            <GraduationCap size={20} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400">{isRtl ? 'البرامج' : 'Programs'}</div>
            <div className="text-xl font-black text-slate-900">{summaryStats.programsCount}</div>
          </div>
        </Link>

        <Link to={`/alumni/founder/programs?lang=${lang}`} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3 hover:border-amber-400 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
            <Award size={20} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400">{isRtl ? 'الشهادات' : 'Certificates'}</div>
            <div className="text-xl font-black text-slate-900">{summaryStats.certsCount}</div>
          </div>
        </Link>

        <Link to={`/alumni/founder/opportunities?lang=${lang}`} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3 hover:border-amber-400 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-athar-yellow/10 text-athar-yellow flex items-center justify-center shrink-0 border border-athar-yellow/20">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400">{isRtl ? 'الفرص المتاحة' : 'Opportunities'}</div>
            <div className="text-xl font-black text-slate-900">{summaryStats.opportunitiesCount}</div>
          </div>
        </Link>
      </div>

      {/* Companies List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Building2 size={20} className="text-amber-500" />
            <span>{isRtl ? 'شركاتي المسجلة' : 'My Companies'}</span>
          </h2>
          <span className="text-xs font-bold text-slate-400">
            {companies.length} {isRtl ? 'شركة' : 'companies'}
          </span>
        </div>

        {companies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100">
              <Building2 size={32} />
            </div>
            <h3 className="text-lg font-black text-slate-800 mb-1">
              {isRtl ? 'لا توجد شركات مسجلة حتى الآن' : 'No companies registered yet'}
            </h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
              {isRtl
                ? 'أضف شركتك الناشئة الأولى لبدء توثيق تقدمك والوصول إلى برامج وفرص مسرعة أثر.'
                : 'Add your first startup to start recording progress and accessing Athar programs and opportunities.'}
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-black text-sm px-6 py-3 rounded-xl transition-all"
            >
              <Plus size={18} />
              <span>{isRtl ? 'إضافة الشركة الآن' : 'Add Company Now'}</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {companies.map((company) => {
              const compName = (isRtl && company.name_ar) || company.name || company.startup_name;
              const snapshots = company.company_snapshots || [];
              const latestSnap = snapshots.length > 0
                ? [...snapshots].sort((a, b) => new Date(b.snapshot_date) - new Date(a.snapshot_date))[0]
                : null;

              return (
                <div
                  key={company.company_id}
                  className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between"
                >
                  <div className="space-y-4">
                    {/* Top Row: Logo, Name, Role */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 p-2 flex items-center justify-center shrink-0 overflow-hidden">
                          {company.logo_url ? (
                            <img src={company.logo_url} alt={compName} className="w-full h-full object-contain" />
                          ) : (
                            <Building2 size={28} className="text-slate-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-black text-base text-slate-900">{compName}</h3>
                            {company.is_primary && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
                                {isRtl ? 'الأساسية' : 'Primary'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-semibold">
                            <span>{company.sector || company.industry || 'Tech'}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <MapPin size={12} className="text-slate-400" />
                              {company.province || company.location || (isRtl ? 'العراق' : 'Iraq')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <span className="px-2.5 py-1 rounded-xl text-xs font-black bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                        {company.role_in_company || (isRtl ? 'مؤسس' : 'Founder')}
                      </span>
                    </div>

                    {/* Stats summary */}
                    <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{isRtl ? 'فريق العمل' : 'Team'}</div>
                        <div className="text-xs font-black text-slate-800 mt-0.5">
                          {latestSnap?.data?.employees_count || company.employees_count || company.employees || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{isRtl ? 'الإيرادات' : 'Revenue'}</div>
                        <div className="text-xs font-black text-slate-800 mt-0.5">
                          {latestSnap?.data?.revenue_sar != null ? `${Number(latestSnap.data.revenue_sar).toLocaleString()} $` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{isRtl ? 'سنة التأسيس' : 'Founded'}</div>
                        <div className="text-xs font-black text-slate-800 mt-0.5">
                          {company.founding_year || '—'}
                        </div>
                      </div>
                    </div>

                    {/* Latest Snapshot Info */}
                    {latestSnap && (
                      <div className="text-xs text-slate-500 bg-amber-50/60 border border-amber-200/60 rounded-xl p-3 flex items-center justify-between">
                        <span className="font-semibold">
                          {isRtl ? 'آخر لقطة أثر مسجلة:' : 'Latest Snapshot:'} {new Date(latestSnap.snapshot_date).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}
                        </span>
                        <span className="text-[10px] font-black uppercase text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md">
                          {latestSnap.snapshot_type}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                    <Link
                      to={`/alumni/founder/company/${company.company_id}?lang=${lang}`}
                      className="inline-flex items-center gap-1.5 text-xs font-black text-slate-700 hover:text-slate-900 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
                    >
                      <span>{isRtl ? 'الملف الكامل للشركة' : 'View Full Profile'}</span>
                      <ArrowUpRight size={14} />
                    </Link>

                    <button
                      onClick={() => handleOpenUpdate(company)}
                      className="inline-flex items-center gap-1.5 text-xs font-black text-amber-900 bg-amber-100 hover:bg-amber-200 px-3.5 py-2 rounded-xl border border-amber-300 transition-colors"
                    >
                      <Edit3 size={14} />
                      <span>{isRtl ? 'تحديث المؤشرات' : 'Update Metrics'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Update Company Modal */}
      {showUpdateModal && selectedCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Edit3 size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    {isRtl ? 'تحديث مؤشرات الشركة' : 'Update Company Metrics'}
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold">
                    {selectedCompany.name || selectedCompany.startup_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowUpdateModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            {updateError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                <AlertCircle size={16} />
                <span>{updateError}</span>
              </div>
            )}

            {updateSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold flex items-center gap-2">
                <CheckCircle2 size={16} />
                <span>{updateSuccess}</span>
              </div>
            )}

            <form onSubmit={handleUpdateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'اسم الشركة (English)' : 'Company Name (EN)'}
                  </label>
                  <input
                    type="text"
                    value={updateForm.name}
                    onChange={(e) => setUpdateForm({ ...updateForm, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'اسم الشركة (العربية)' : 'Company Name (AR)'}
                  </label>
                  <input
                    type="text"
                    value={updateForm.name_ar}
                    onChange={(e) => setUpdateForm({ ...updateForm, name_ar: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'عدد الموظفين / فريق العمل' : 'Team / Employees'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={updateForm.employees_count}
                    onChange={(e) => setUpdateForm({ ...updateForm, employees_count: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder="e.g. 5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'المحافظة' : 'Province / City'}
                  </label>
                  <input
                    type="text"
                    value={updateForm.province}
                    onChange={(e) => setUpdateForm({ ...updateForm, province: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder="e.g. Baghdad, Erbil..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'الإيرادات السنوية ($)' : 'Annual Revenue ($)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={updateForm.revenue_sar}
                    onChange={(e) => setUpdateForm({ ...updateForm, revenue_sar: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'صافي الربح ($)' : 'Net Profit ($)'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={updateForm.net_profit_sar}
                    onChange={(e) => setUpdateForm({ ...updateForm, net_profit_sar: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  {isRtl ? 'المنتجات والخدمات الجديدة المنجزة' : 'New Products / Milestones'}
                </label>
                <textarea
                  rows="2"
                  value={updateForm.new_products}
                  onChange={(e) => setUpdateForm({ ...updateForm, new_products: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  placeholder={isRtl ? 'إطلاق تطبيق، دخول سوق جديد...' : 'New launches, market entry...'}
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  {isRtl ? 'أبرز التحديات التي تواجهونها' : 'Key Challenges Faced'}
                </label>
                <textarea
                  rows="2"
                  value={updateForm.challenges}
                  onChange={(e) => setUpdateForm({ ...updateForm, challenges: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  placeholder={isRtl ? 'التمويل، التوظيف، التوسع...' : 'Funding, hiring, expansion...'}
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowUpdateModal(false)}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs px-6 py-2.5 rounded-xl shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                >
                  {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  <span>{isUpdating ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : (isRtl ? 'حفظ اللقطة والتحديث' : 'Save Snapshot & Update')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Company Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Plus size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    {isRtl ? 'تسجيل شركة ناشئة جديدة' : 'Register New Startup'}
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold">
                    {isRtl ? 'ربط شركة جديدة بملفك كمؤسس' : 'Link a new company to your founder profile'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            {addError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                <AlertCircle size={16} />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'اسم الشركة (English)' : 'Company Name (EN)'} *
                  </label>
                  <input
                    type="text"
                    value={addForm.name}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder="e.g. Careem"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'اسم الشركة (العربية)' : 'Company Name (AR)'}
                  </label>
                  <input
                    type="text"
                    value={addForm.name_ar}
                    onChange={(e) => setAddForm({ ...addForm, name_ar: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder="كريم"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'القطاع' : 'Sector'} *
                  </label>
                  <input
                    type="text"
                    value={addForm.sector}
                    onChange={(e) => setAddForm({ ...addForm, sector: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder="Fintech, Healthtech, E-commerce..."
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'المحافظة' : 'Province'}
                  </label>
                  <input
                    type="text"
                    value={addForm.province}
                    onChange={(e) => setAddForm({ ...addForm, province: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder="Baghdad, Basra, Erbil..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'سنة التأسيس' : 'Founding Year'}
                  </label>
                  <input
                    type="number"
                    min="1990"
                    max={new Date().getFullYear()}
                    value={addForm.founding_year}
                    onChange={(e) => setAddForm({ ...addForm, founding_year: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    {isRtl ? 'عدد الموظفين الحالي' : 'Employees Count'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={addForm.employees_count}
                    onChange={(e) => setAddForm({ ...addForm, employees_count: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  {isRtl ? 'الموقع الإلكتروني' : 'Website URL'}
                </label>
                <input
                  type="url"
                  value={addForm.website_url}
                  onChange={(e) => setAddForm({ ...addForm, website_url: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  placeholder="https://example.com"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isAdding}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs px-6 py-2.5 rounded-xl shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                >
                  {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  <span>{isAdding ? (isRtl ? 'جاري الإضافة...' : 'Adding...') : (isRtl ? 'إضافة الشركة' : 'Add Company')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
