import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Building2, Users, Calendar, MapPin, Globe, ExternalLink,
  Award, TrendingUp, DollarSign, Plus, FileText, CheckCircle2,
  Clock, AlertCircle, Share2, Sparkles, ChevronRight, X, Eye, ArrowUpRight
} from 'lucide-react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  getAlumniCompanyProfile, createSnapshot, compareSnapshots,
  linkFounderToCompany, unlinkFounderFromCompany, createFounder,
  submitInvestorRequest, getCompanyApplications, getCertificates
} from '../../lib/api';
import { translations } from '../../lib/translations';

export default function CompanyProfilePage() {
  const params = useParams();
  const companyId = params.companyId || params.id;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';
  const t = translations.Alumni[lang] || translations.Alumni.ar;

  const [profile, setProfile] = useState(null);
  const [applications, setApplications] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Modals state
  const [showAddSnapshotModal, setShowAddSnapshotModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showAddFounderModal, setShowAddFounderModal] = useState(false);
  const [showInvestorRequestModal, setShowInvestorRequestModal] = useState(false);

  // Compare snapshots selection
  const [selectedSnapshot1, setSelectedSnapshot1] = useState('');
  const [selectedSnapshot2, setSelectedSnapshot2] = useState('');
  const [comparisonResult, setComparisonResult] = useState(null);
  const [comparing, setComparing] = useState(false);

  // New snapshot form state
  const [newSnapshot, setNewSnapshot] = useState({
    snapshot_type: 'annual_update',
    snapshot_date: new Date().toISOString().split('T')[0],
    revenue_sar: '',
    employees_count: '',
    jobs_created: '',
    funding_raised_sar: '',
    is_active: true,
    challenges_ar: '',
    milestones_ar: ''
  });

  // Investor request state
  const [investorForm, setInvestorForm] = useState({
    investor_name: '',
    investor_entity: '',
    investor_email: '',
    investor_type: 'angel',
    ticket_size_min_sar: '',
    notes: ''
  });
  const [submittingInvestor, setSubmittingInvestor] = useState(false);

  useEffect(() => {
    if (companyId) loadProfile();
  }, [companyId]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getAlumniCompanyProfile(companyId);
      setProfile(data);

      const apps = await getCompanyApplications(companyId).catch(() => []);
      setApplications(apps || []);

      // If founders exist, fetch certificates
      if (data?.founders?.length > 0) {
        const founderIds = data.founders.map(f => f.founder_id);
        const certsPromises = founderIds.map(id => getCertificates(id).catch(() => []));
        const certsResults = await Promise.all(certsPromises);
        setCertificates(certsResults.flat());
      }
    } catch (err) {
      console.error('Failed to load company profile:', err);
      setError(isRtl ? 'تعذر تحميل ملف الشركة.' : 'Failed to load company profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSnapshot = async (e) => {
    e.preventDefault();
    try {
      await createSnapshot({
        companyId,
        snapshotType: newSnapshot.snapshot_type,
        snapshotDate: newSnapshot.snapshot_date,
        source: 'me_team',
        data: {
          revenue_sar: Number(newSnapshot.revenue_sar) || 0,
          employees_count: Number(newSnapshot.employees_count) || 0,
          jobs_created: Number(newSnapshot.jobs_created) || 0,
          funding_raised_sar: Number(newSnapshot.funding_raised_sar) || 0,
          is_active: newSnapshot.is_active,
          milestones: newSnapshot.milestones_ar,
          challenges: newSnapshot.challenges_ar
        }
      });
      setShowAddSnapshotModal(false);
      setNewSnapshot({
        snapshot_type: 'annual_update',
        snapshot_date: new Date().toISOString().split('T')[0],
        revenue_sar: '',
        employees_count: '',
        jobs_created: '',
        funding_raised_sar: '',
        is_active: true,
        challenges_ar: '',
        milestones_ar: ''
      });
      loadProfile();
    } catch (err) {
      console.error('Error creating snapshot:', err);
      alert(isRtl ? 'حدث خطأ أثناء حفظ اللقطة التاريخية' : 'Error saving snapshot');
    }
  };

  const handleCompareSnapshots = async () => {
    if (!selectedSnapshot1 || !selectedSnapshot2) return;
    try {
      setComparing(true);
      const res = await compareSnapshots(selectedSnapshot1, selectedSnapshot2);
      setComparisonResult(res);
    } catch (err) {
      console.error('Error comparing snapshots:', err);
      alert(isRtl ? 'حدث خطأ أثناء مقارنة اللقطات' : 'Error comparing snapshots');
    } finally {
      setComparing(false);
    }
  };

  const handleInvestorRequest = async (e) => {
    e.preventDefault();
    try {
      setSubmittingInvestor(true);
      await submitInvestorRequest({
        company_id: companyId,
        investor_name: investorForm.investor_name,
        investor_entity: investorForm.investor_entity,
        investor_email: investorForm.investor_email,
        investor_type: investorForm.investor_type,
        ticket_size_min_sar: investorForm.ticket_size_min_sar ? Number(investorForm.ticket_size_min_sar) : null,
        notes: investorForm.notes
      });
      setShowInvestorRequestModal(false);
      alert(isRtl ? 'تم إرسال طلب الربط الاستثماري بنجاح' : 'Investor request submitted successfully');
    } catch (err) {
      console.error('Error submitting investor request:', err);
      alert(isRtl ? 'حدث خطأ أثناء إرسال الطلب' : 'Error submitting request');
    } finally {
      setSubmittingInvestor(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 font-manrope">
        <div className="w-12 h-12 border-4 border-athar-blue/20 border-t-athar-blue rounded-full animate-spin mb-4" />
        <p className="text-sm font-bold text-muted-foreground">{t.loading}</p>
      </div>
    );
  }

  if (error || !profile?.company) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 font-manrope">
        <AlertCircle size={40} className="text-destructive mb-3" />
        <h2 className="text-lg font-black text-foreground mb-2">{error || 'Company not found'}</h2>
        <button
          onClick={() => navigate('/alumni')}
          className="px-4 py-2 bg-muted text-foreground text-xs font-bold rounded-xl"
        >
          {isRtl ? 'العودة للدليل' : 'Back to Directory'}
        </button>
      </div>
    );
  }

  const { company, founders, participations, snapshots } = profile;
  const companyName = (isRtl && company.startup_name_ar) || company.name || company.startup_name;
  const latestSnapshot = snapshots?.[0] || null;

  return (
    <div className={`min-h-screen bg-background font-manrope text-foreground ${isRtl ? 'rtl' : 'ltr'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Background radial accent */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/5 via-background to-background" />

      {/* Header bar */}
      <header className="relative z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 sticky top-0 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/alumni')}
              className="p-2 sm:p-2.5 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground transition-all"
              title={isRtl ? 'رجوع' : 'Back'}
            >
              <ArrowLeft size={18} className={isRtl ? 'rotate-180' : ''} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-bold">{t.directory}</span>
              <ChevronRight size={14} className={`text-muted-foreground ${isRtl ? 'rotate-180' : ''}`} />
              <span className="text-xs font-black text-foreground truncate max-w-[200px]">{companyName}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInvestorRequestModal(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-athar-yellow/20 hover:bg-athar-yellow/30 text-athar-black border border-athar-yellow/40 rounded-xl text-xs font-bold transition-all"
            >
              <Sparkles size={14} className="text-amber-600" />
              <span>{isRtl ? 'طلب ربط استثماري' : 'Request Investor Intro'}</span>
            </button>

            <button
              onClick={() => setShowAddSnapshotModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-athar-blue hover:bg-athar-blue/90 text-white rounded-xl text-xs font-bold shadow-lg shadow-athar-blue/20 transition-all"
            >
              <Plus size={16} />
              <span>{isRtl ? 'تسجيل لقطة أثر' : 'Add Snapshot'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Profile Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Company Hero Card */}
        <div className="bg-card border border-border/60 rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="flex items-start gap-4 sm:gap-6">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border border-border bg-muted/30 p-2.5 flex items-center justify-center shrink-0 shadow-inner">
                {company.logo_url ? (
                  <img src={company.logo_url} alt={companyName} className="w-full h-full object-contain" />
                ) : (
                  <Building2 size={36} className="text-muted-foreground/40" />
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
                    {companyName}
                  </h1>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-athar-blue/10 text-athar-blue border border-athar-blue/20">
                    {company.industry || 'Ecosystem'}
                  </span>
                  {company.stage && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-muted text-muted-foreground border border-border">
                      {company.stage}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-muted-foreground">
                  {(company.province || company.location) && (
                    <span className="flex items-center gap-1">
                      <MapPin size={13} className="text-athar-blue" />
                      <span>{company.province || company.location}</span>
                    </span>
                  )}
                  {company.founding_year && (
                    <span className="flex items-center gap-1">
                      <Calendar size={13} />
                      <span>{isRtl ? `تأسست: ${company.founding_year}` : `Est. ${company.founding_year}`}</span>
                    </span>
                  )}
                  {company.website_url && (
                    <a
                      href={company.website_url.startsWith('http') ? company.website_url : `https://${company.website_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-athar-blue hover:underline font-bold"
                    >
                      <Globe size={13} />
                      <span>{isRtl ? 'الموقع الإلكتروني' : 'Website'}</span>
                      <ArrowUpRight size={12} />
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Quick stats badges */}
            {latestSnapshot && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 bg-muted/40 p-3.5 rounded-2xl border border-border/50 shrink-0">
                <div className="text-center px-2">
                  <div className="text-[10px] text-muted-foreground font-bold">{t.jobsCreated}</div>
                  <div className="text-lg font-black text-foreground">
                    {latestSnapshot.data?.jobs_created || '—'}
                  </div>
                </div>
                <div className="text-center px-2 border-x border-border/50">
                  <div className="text-[10px] text-muted-foreground font-bold">{t.totalRevenue}</div>
                  <div className="text-lg font-black text-foreground">
                    {latestSnapshot.data?.revenue_sar ? `${(Number(latestSnapshot.data.revenue_sar) / 1000).toFixed(0)}k` : '—'}
                  </div>
                </div>
                <div className="text-center px-2 col-span-2 sm:col-span-1">
                  <div className="text-[10px] text-muted-foreground font-bold">{t.fundingRaised}</div>
                  <div className="text-lg font-black text-foreground">
                    {latestSnapshot.data?.funding_raised_sar ? `${(Number(latestSnapshot.data.funding_raised_sar) / 1000).toFixed(0)}k` : '—'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="mt-8 pt-4 border-t border-border/60 flex items-center gap-2 overflow-x-auto">
            {[
              { id: 'overview', label: isRtl ? 'نظرة عامة' : 'Overview', icon: Building2 },
              { id: 'snapshots', label: isRtl ? 'السجل التاريخي (Snapshots)' : 'Growth Snapshots', icon: TrendingUp, count: snapshots.length },
              { id: 'founders', label: isRtl ? 'المؤسسون وفريق العمل' : 'Founders & Team', icon: Users, count: founders.length },
              { id: 'certificates', label: isRtl ? 'الشهادات والاعتمادات' : 'Certificates', icon: Award, count: certificates.length },
              { id: 'opportunities', label: isRtl ? 'التقديمات والفرص' : 'Applications', icon: Sparkles, count: applications.length }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all shrink-0 ${
                    activeTab === tab.id
                      ? 'bg-athar-blue text-white shadow-md shadow-athar-blue/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  }`}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── TAB 1: OVERVIEW ────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Description Card */}
            <div className="bg-card border border-border/60 rounded-3xl p-6 sm:p-8 space-y-4">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <FileText size={18} className="text-athar-blue" />
                <span>{isRtl ? 'نبذة عن الشركة' : 'Company Overview'}</span>
              </h3>
              <p className="text-sm text-foreground/80 leading-relaxed">
                {(isRtl && company.description_ar) || company.description || (isRtl ? 'لا يوجد وصف مسجل بعد' : 'No description provided')}
              </p>
            </div>

            {/* Programs History */}
            <div className="bg-card border border-border/60 rounded-3xl p-6 sm:p-8 space-y-4">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <Award size={18} className="text-athar-blue" />
                <span>{isRtl ? 'سجل البرامج والدفعات' : 'Program Participation History'}</span>
              </h3>

              {participations.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {participations.map(p => (
                    <div key={p.id} className="p-4 rounded-2xl bg-muted/40 border border-border/60 flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-bold text-sm text-foreground mb-1">
                          {(isRtl && p.programs?.name_ar) || p.programs?.name || 'Athar Program'}
                        </h4>
                        {p.events && (
                          <p className="text-xs text-muted-foreground font-semibold">
                            {isRtl ? 'الدفعة: ' : 'Cohort: '}
                            {(isRtl && p.events.event_name_ar) || p.events.event_name}
                          </p>
                        )}
                        {p.start_date && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {p.start_date} {p.end_date ? `— ${p.end_date}` : ''}
                          </p>
                        )}
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                        p.graduation_status === 'graduated'
                          ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                          : 'bg-athar-blue/10 text-athar-blue border border-athar-blue/20'
                      }`}>
                        {p.graduation_status === 'graduated' ? t.graduated : t.active}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{isRtl ? 'لم تسجل مشاركات برامج رسمية بعد' : 'No participations recorded'}</p>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB 2: GROWTH SNAPSHOTS (APPEND-ONLY HISTORY) ───────────────── */}
        {activeTab === 'snapshots' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-extrabold text-foreground">
                  {isRtl ? 'السجل التاريخي لنمو الشركة (Snapshots)' : 'Company Historical Snapshots'}
                </h3>
                <p className="text-xs text-muted-foreground font-semibold">
                  {isRtl ? 'سجل غير قابل للتعديل يوثق تطور الشركة عاماً بعد عام' : 'Append-only immutable record of company growth'}
                </p>
              </div>

              {snapshots.length >= 2 && (
                <button
                  onClick={() => setShowCompareModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-xs font-bold transition-all"
                >
                  <TrendingUp size={14} />
                  <span>{isRtl ? 'مقارنة فترتين' : 'Compare Snapshots'}</span>
                </button>
              )}
            </div>

            {snapshots.length > 0 ? (
              <div className="relative pl-6 rtl:pr-6 rtl:pl-0 space-y-6 border-l-2 rtl:border-r-2 rtl:border-l-0 border-athar-blue/20">
                {snapshots.map((s, idx) => (
                  <div key={s.snapshot_id} className="relative group">
                    {/* Timeline bullet dot */}
                    <div className="absolute -left-[31px] rtl:-right-[31px] top-4 w-4 h-4 rounded-full bg-athar-blue border-4 border-background shadow" />

                    <div className="bg-card border border-border/60 hover:border-athar-blue/30 rounded-2xl p-5 shadow-sm space-y-3 transition-all">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black px-2.5 py-1 rounded-full bg-athar-blue/10 text-athar-blue">
                            {s.snapshot_type === 'program_start' ? t.programStart :
                             s.snapshot_type === 'graduation' ? t.graduation :
                             s.snapshot_type === 'annual_update' ? t.annualUpdate : s.snapshot_type}
                          </span>
                          <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                            <Calendar size={12} />
                            <span>{s.snapshot_date}</span>
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                          {isRtl ? `المصدر: ${s.source}` : `Source: ${s.source}`}
                        </span>
                      </div>

                      {/* Numeric Metrics Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/30 p-3 rounded-xl">
                        <div>
                          <div className="text-[10px] text-muted-foreground font-bold">{t.totalRevenue}</div>
                          <div className="text-sm font-black text-foreground">
                            {s.data?.revenue_sar ? `${Number(s.data.revenue_sar).toLocaleString()} SAR` : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground font-bold">{t.jobsCreated}</div>
                          <div className="text-sm font-black text-foreground">
                            {s.data?.jobs_created ?? s.data?.employees_count ?? '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground font-bold">{t.fundingRaised}</div>
                          <div className="text-sm font-black text-foreground">
                            {s.data?.funding_raised_sar ? `${Number(s.data.funding_raised_sar).toLocaleString()} SAR` : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground font-bold">{isRtl ? 'حالة النشاط' : 'Status'}</div>
                          <div className="text-sm font-black text-foreground">
                            {s.data?.is_active !== false ? (
                              <span className="text-emerald-600 font-bold">{isRtl ? 'نشطة' : 'Active'}</span>
                            ) : (
                              <span className="text-destructive font-bold">{isRtl ? 'متوقفة' : 'Inactive'}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Milestones / Challenges */}
                      {s.data?.milestones && (
                        <div className="text-xs text-foreground/80 bg-background/50 p-2.5 rounded-lg border border-border/40">
                          <strong className="text-foreground font-bold block mb-1">{isRtl ? 'أبرز الإنجازات:' : 'Milestones:'}</strong>
                          {s.data.milestones}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card border border-dashed border-border/70 rounded-3xl p-12 text-center max-w-md mx-auto">
                <TrendingUp className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs font-bold text-muted-foreground mb-4">{t.noSnapshots}</p>
                <button
                  onClick={() => setShowAddSnapshotModal(true)}
                  className="px-4 py-2 bg-athar-blue text-white rounded-xl text-xs font-bold"
                >
                  {isRtl ? 'إضافة أول لقطة تاريخية' : 'Create First Snapshot'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 3: FOUNDERS & TEAM ─────────────────────────────────────── */}
        {activeTab === 'founders' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-extrabold text-foreground">
                  {isRtl ? 'المؤسسون وفريق العمل' : 'Founders & Leadership'}
                </h3>
                <p className="text-xs text-muted-foreground font-semibold">
                  {isRtl ? 'أصحاب المصلحة والمؤسسون المعتمدون للشركة' : 'Primary founders and team members'}
                </p>
              </div>
            </div>

            {founders.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {founders.map(cf => {
                  const f = cf.founders;
                  if (!f) return null;
                  const founderName = (isRtl && f.name_ar) || f.name_en || f.name_ar;
                  return (
                    <div key={cf.id} className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4 relative">
                      {cf.is_primary && (
                        <span className="absolute top-4 right-4 rtl:left-4 rtl:right-auto px-2 py-0.5 rounded-full text-[10px] font-black bg-athar-yellow/30 text-athar-black border border-athar-yellow/50">
                          {isRtl ? 'مؤسس رئيسي' : 'Primary Founder'}
                        </span>
                      )}

                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full border border-border bg-muted/40 flex items-center justify-center font-black text-sm text-foreground overflow-hidden">
                          {f.photo_url ? (
                            <img src={f.photo_url} alt={founderName} className="w-full h-full object-cover" />
                          ) : (
                            founderName.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <div>
                          <h4 className="font-extrabold text-sm text-foreground">{founderName}</h4>
                          <span className="text-xs text-muted-foreground font-semibold capitalize">
                            {cf.role || 'Founder'}
                          </span>
                        </div>
                      </div>

                      {f.bio_ar && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {f.bio_ar}
                        </p>
                      )}

                      <div className="pt-2 border-t border-border/50 flex items-center gap-3 text-xs text-muted-foreground">
                        {f.email && <span className="truncate">{f.email}</span>}
                        {f.linkedin_url && (
                          <a href={f.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-athar-blue hover:underline">
                            LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-card border border-dashed border-border/70 rounded-3xl p-10 text-center max-w-md mx-auto">
                <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs font-bold text-muted-foreground">{isRtl ? 'لا يوجد مؤسسون مسجلون بعد' : 'No founders registered yet'}</p>
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 4: CERTIFICATES & CREDENTIALS ───────────────────────────── */}
        {activeTab === 'certificates' && (
          <div className="space-y-6">
            <h3 className="text-base font-extrabold text-foreground">
              {isRtl ? 'الشهادات والاعتمادات الرسمية' : 'Issued Certificates & Credentials'}
            </h3>

            {certificates.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {certificates.map(cert => (
                  <div key={cert.certificate_id} className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Award size={24} className="text-athar-yellow" />
                        <div>
                          <h4 className="font-black text-sm text-foreground">
                            {(isRtl && cert.programs?.name_ar) || cert.programs?.name || 'Certificate of Completion'}
                          </h4>
                          <p className="text-[11px] text-muted-foreground font-semibold">
                            {t.certNumber}: <span className="font-mono">{cert.verification_code}</span>
                          </p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        {t.verified}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
                      <span className="text-muted-foreground">
                        {t.issuedOn}: {cert.issue_date}
                      </span>
                      <Link
                        to={`/verify-certificate/${cert.verification_code}`}
                        target="_blank"
                        className="text-athar-blue font-bold hover:underline flex items-center gap-1"
                      >
                        <span>{t.verifyCert}</span>
                        <ExternalLink size={12} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card border border-dashed border-border/70 rounded-3xl p-10 text-center max-w-md mx-auto">
                <Award className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs font-bold text-muted-foreground">{t.noCertificates}</p>
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 5: OPPORTUNITIES & APPLICATIONS ─────────────────────────── */}
        {activeTab === 'opportunities' && (
          <div className="space-y-6">
            <h3 className="text-base font-extrabold text-foreground">
              {isRtl ? 'التقديمات على الفرص الاستثمارية والمنح' : 'Opportunity Applications'}
            </h3>

            {applications.length > 0 ? (
              <div className="space-y-3">
                {applications.map(app => (
                  <div key={app.id} className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4">
                    <div>
                      <h4 className="font-extrabold text-sm text-foreground">
                        {(isRtl && app.opportunities?.title_ar) || app.opportunities?.title_en || 'Opportunity'}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isRtl ? 'تاريخ التقديم: ' : 'Applied: '}{app.applied_at?.split('T')[0]}
                      </p>
                    </div>
                    <span className="text-xs font-black uppercase px-3 py-1 rounded-full bg-athar-blue/10 text-athar-blue">
                      {app.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card border border-dashed border-border/70 rounded-3xl p-10 text-center max-w-md mx-auto">
                <Sparkles className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs font-bold text-muted-foreground mb-4">{isRtl ? 'لم يتم التقديم على أي فرص بعد' : 'No applications yet'}</p>
                <Link
                  to={`/alumni/opportunities?lang=${lang}`}
                  className="px-4 py-2 bg-athar-blue text-white rounded-xl text-xs font-bold"
                >
                  {isRtl ? 'استعراض الفرص المتاحة' : 'Browse Opportunities'}
                </Link>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ─── MODAL 1: ADD SNAPSHOT ────────────────────────────────────────── */}
      {showAddSnapshotModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-card border border-border rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-4 my-8 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-foreground">
                {isRtl ? 'تسجيل لقطة أثر جديدة (New Snapshot)' : 'Add New Snapshot'}
              </h3>
              <button onClick={() => setShowAddSnapshotModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateSnapshot} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-muted-foreground block mb-1">{t.snapshotType}</label>
                  <select
                    value={newSnapshot.snapshot_type}
                    onChange={(e) => setNewSnapshot({ ...newSnapshot, snapshot_type: e.target.value })}
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-bold"
                  >
                    <option value="annual_update">{t.annualUpdate}</option>
                    <option value="graduation">{t.graduation}</option>
                    <option value="program_start">{t.programStart}</option>
                    <option value="6_month_followup">{t.sixMonthFollowup}</option>
                    <option value="manual_import">{t.manualImport}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground block mb-1">{isRtl ? 'تاريخ اللقطة' : 'Date'}</label>
                  <input
                    type="date"
                    value={newSnapshot.snapshot_date}
                    onChange={(e) => setNewSnapshot({ ...newSnapshot, snapshot_date: e.target.value })}
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-muted-foreground block mb-1">{t.totalRevenue} (SAR)</label>
                  <input
                    type="number"
                    value={newSnapshot.revenue_sar}
                    onChange={(e) => setNewSnapshot({ ...newSnapshot, revenue_sar: e.target.value })}
                    placeholder="0"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground block mb-1">{t.fundingRaised} (SAR)</label>
                  <input
                    type="number"
                    value={newSnapshot.funding_raised_sar}
                    onChange={(e) => setNewSnapshot({ ...newSnapshot, funding_raised_sar: e.target.value })}
                    placeholder="0"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-muted-foreground block mb-1">{t.jobsCreated}</label>
                  <input
                    type="number"
                    value={newSnapshot.jobs_created}
                    onChange={(e) => setNewSnapshot({ ...newSnapshot, jobs_created: e.target.value })}
                    placeholder="0"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground block mb-1">{isRtl ? 'إجمالي الموظفين' : 'Employees'}</label>
                  <input
                    type="number"
                    value={newSnapshot.employees_count}
                    onChange={(e) => setNewSnapshot({ ...newSnapshot, employees_count: e.target.value })}
                    placeholder="0"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-1">{isRtl ? 'أبرز الإنجازات' : 'Key Milestones'}</label>
                <textarea
                  value={newSnapshot.milestones_ar}
                  onChange={(e) => setNewSnapshot({ ...newSnapshot, milestones_ar: e.target.value })}
                  rows={2}
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSnapshotModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-athar-blue text-white rounded-xl text-xs font-black shadow-lg shadow-athar-blue/20"
                >
                  {isRtl ? 'حفظ اللقطة' : 'Save Snapshot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: COMPARE SNAPSHOTS ──────────────────────────────────── */}
      {showCompareModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-card border border-border rounded-3xl p-6 sm:p-8 max-w-xl w-full shadow-2xl space-y-4 my-8 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-foreground">
                {isRtl ? 'مقارنة فترات النمو' : 'Compare Snapshots Growth'}
              </h3>
              <button onClick={() => { setShowCompareModal(false); setComparisonResult(null); }} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-1">{isRtl ? 'الفترة الأولى' : 'Earlier Snapshot'}</label>
                <select
                  value={selectedSnapshot1}
                  onChange={(e) => setSelectedSnapshot1(e.target.value)}
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-bold"
                >
                  <option value="">{isRtl ? 'اختر الفترة' : 'Select snapshot'}</option>
                  {snapshots.map(s => (
                    <option key={s.snapshot_id} value={s.snapshot_id}>
                      {s.snapshot_date} ({s.snapshot_type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-1">{isRtl ? 'الفترة الثانية' : 'Later Snapshot'}</label>
                <select
                  value={selectedSnapshot2}
                  onChange={(e) => setSelectedSnapshot2(e.target.value)}
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs font-bold"
                >
                  <option value="">{isRtl ? 'اختر الفترة' : 'Select snapshot'}</option>
                  {snapshots.map(s => (
                    <option key={s.snapshot_id} value={s.snapshot_id}>
                      {s.snapshot_date} ({s.snapshot_type})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleCompareSnapshots}
              disabled={!selectedSnapshot1 || !selectedSnapshot2 || comparing}
              className="w-full py-2.5 bg-athar-blue text-white rounded-xl text-xs font-black shadow-lg shadow-athar-blue/20 disabled:opacity-50"
            >
              {comparing ? '...' : (isRtl ? 'حساب الفروق ومعدل النمو' : 'Compare Growth')}
            </button>

            {comparisonResult && (
              <div className="bg-muted/30 border border-border/60 rounded-2xl p-4 space-y-3 mt-4">
                <div className="text-xs font-extrabold text-foreground flex items-center justify-between">
                  <span>{comparisonResult.earlier?.snapshot_date}</span>
                  <ChevronRight size={14} className={isRtl ? 'rotate-180' : ''} />
                  <span>{comparisonResult.later?.snapshot_date}</span>
                </div>

                <div className="space-y-2 pt-2 border-t border-border/40 text-xs">
                  {Object.entries(comparisonResult.diff).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between py-1 border-b border-border/20 last:border-none">
                      <span className="font-semibold text-muted-foreground capitalize">
                        {key.replace(/_/g, ' ')}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-muted-foreground">{val.before} → {val.after}</span>
                        <span className={`font-black font-mono ${val.delta >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                          {val.delta >= 0 ? `+${val.delta}` : val.delta} {val.pctChange ? `(${val.pctChange}%)` : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── MODAL 3: INVESTOR REQUEST ──────────────────────────────────── */}
      {showInvestorRequestModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-card border border-border rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-4 my-8 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-foreground">
                {isRtl ? 'طلب ربط استثماري (Investor Introduction)' : 'Request Investor Intro'}
              </h3>
              <button onClick={() => setShowInvestorRequestModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleInvestorRequest} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-muted-foreground block mb-1">{isRtl ? 'اسم المستثمر / الجهة' : 'Investor Name / Entity'}</label>
                <input
                  type="text"
                  value={investorForm.investor_name}
                  onChange={(e) => setInvestorForm({ ...investorForm, investor_name: e.target.value })}
                  required
                  placeholder="e.g. Athar Angel Fund"
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">{isRtl ? 'نوع المستثمر' : 'Investor Type'}</label>
                  <select
                    value={investorForm.investor_type}
                    onChange={(e) => setInvestorForm({ ...investorForm, investor_type: e.target.value })}
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  >
                    <option value="angel">Angel Investor</option>
                    <option value="vc">VC Fund</option>
                    <option value="family_office">Family Office</option>
                    <option value="corporate">Corporate VC</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-muted-foreground block mb-1">{isRtl ? 'حجم التذكرة المتوقع (SAR)' : 'Target Ticket (SAR)'}</label>
                  <input
                    type="number"
                    value={investorForm.ticket_size_min_sar}
                    onChange={(e) => setInvestorForm({ ...investorForm, ticket_size_min_sar: e.target.value })}
                    placeholder="100,000"
                    className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-muted-foreground block mb-1">{isRtl ? 'ملاحظات وتفاصيل الاحتياج' : 'Notes / Pitch deck link'}</label>
                <textarea
                  value={investorForm.notes}
                  onChange={(e) => setInvestorForm({ ...investorForm, notes: e.target.value })}
                  rows={3}
                  className="w-full bg-muted/50 border border-border rounded-xl p-2.5 font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInvestorRequestModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingInvestor}
                  className="px-5 py-2.5 bg-athar-blue text-white rounded-xl text-xs font-black shadow-lg shadow-athar-blue/20"
                >
                  {submittingInvestor ? '...' : (isRtl ? 'إرسال الطلب' : 'Submit Request')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
