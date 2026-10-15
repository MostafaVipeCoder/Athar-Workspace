import React, { useState, useEffect } from 'react';
import { useQueryParams } from '../../hooks/useQueryParams';
import { useLanguage } from '../../hooks/useLanguage';
import {
  LineChart, TrendingUp, DollarSign, Users, Award,
  Download, Filter, RotateCw, X, CheckCircle2,
  Building2, PieChart, BarChart3, ShieldCheck,
  ChevronDown, MapPin, Calendar, Sparkles, Loader2
} from 'lucide-react';
import { getAlumniPlatformAnalytics, getAlumniFilterOptions } from '../../lib/api';
import { exportToExcel } from '../../lib/excel';

export default function AlumniAnalyticsPage() {
  const { searchParams, setParam, resetParams, setSearchParams } = useQueryParams();
  const { isRtl } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState({
    totalCompanies: 0,
    activeCount: 0,
    inactiveCount: 0,
    totalRevenue: 0,
    totalJobs: 0,
    survivalRates: { sixMonths: 0, twelveMonths: 0, twentyFourMonths: 0 },
    revenueTimeline: [],
    provinceDistribution: [],
    companiesList: []
  });

  const [filterOptions, setFilterOptions] = useState({
    programs: [],
    sectors: [],
    provinces: [],
    years: [],
    stages: []
  });

  // Extract filters from URL params
  const currentProgram = searchParams.get('program') || 'all';
  const currentSector = searchParams.get('sector') || 'all';
  const currentProvince = searchParams.get('province') || 'all';
  const currentYear = searchParams.get('year') || 'all';
  const currentStage = searchParams.get('stage') || 'all';

  useEffect(() => {
    loadFilterOptions();
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [currentProgram, currentSector, currentProvince, currentYear, currentStage]);

  const loadFilterOptions = async () => {
    try {
      const opts = await getAlumniFilterOptions();
      setFilterOptions(opts);
    } catch (err) {
      console.error('Error fetching filter options:', err);
    }
  };

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const data = await getAlumniPlatformAnalytics({
        programId: currentProgram,
        sector: currentSector,
        province: currentProvince,
        year: currentYear,
        stage: currentStage
      });
      setAnalytics(data);
    } catch (err) {
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateFilter = (key, value) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value === 'all' || !value) {
      nextParams.delete(key);
    } else {
      nextParams.set(key, value);
    }
    setSearchParams(nextParams);
  };

  const clearAllFilters = () => {
    const nextParams = new URLSearchParams();
    if (lang) nextParams.set('lang', lang);
    setSearchParams(nextParams);
  };

  const hasActiveFilters = currentProgram !== 'all' || currentSector !== 'all' || currentProvince !== 'all' || currentYear !== 'all' || currentStage !== 'all';

  const handleExportData = () => {
    if (!analytics.companiesList || analytics.companiesList.length === 0) {
      alert('No data available to export');
      return;
    }

    const exportRows = analytics.companiesList.map(c => {
      const latestSnap = (c.company_snapshots || []).sort((a, b) => new Date(b.snapshot_date) - new Date(a.snapshot_date))[0];
      const snapData = latestSnap?.data || {};

      return {
        'Company Name': c.name || 'Unnamed',
        'Sector': c.sector || 'N/A',
        'Province': c.province || c.location || 'N/A',
        'Stage': snapData.stage || c.stage || 'N/A',
        'Status': snapData.status || c.status || 'Active',
        'Founding Year': c.founding_year || 'N/A',
        'Revenue (IQD/USD)': snapData.revenue || snapData.annual_revenue || 0,
        'Employees / Jobs': snapData.employees || snapData.team_size || 0,
        'Last Update Date': latestSnap?.snapshot_date || c.created_at?.split('T')[0] || 'N/A'
      };
    });

    const dateStr = new Date().toISOString().split('T')[0];
    exportToExcel(exportRows, `Athar_Alumni_Analytics_${dateStr}.xlsx`, 'Alumni Analytics');
  };

  const formatCurrency = (val) => {
    if (!val || isNaN(val)) return '0';
    if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return Number(val).toLocaleString();
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* Header and Export Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-indigo-950/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Sparkles size={13} />
              {'Impact Intelligence'}
            </span>
          </div>
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2.5">
            <LineChart className="text-indigo-400" size={24} />
            <span>{'Platform Analytics & KPIs'}</span>
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1 max-w-xl">
            {isRtl
              ? 'تحليل تطور الشركات، معدلات الاستمرارية، نمو الإيرادات وفرص العمل المولدة عبر شبكة أثر.'
              : 'Analyze venture survival, revenue progression, and job creation across Athar cohorts.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="p-2.5 rounded-2xl bg-muted/40 hover:bg-slate-800 text-muted-foreground border border-indigo-900/30 transition-colors"
            title={'Refresh'}
          >
            <RotateCw size={15} className={loading ? 'animate-spin text-indigo-400' : ''} />
          </button>

          <button
            onClick={handleExportData}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs font-extrabold shadow-lg shadow-emerald-600/30 transition-all hover:scale-102"
          >
            <Download size={14} />
            <span>{'Export to Excel'}</span>
          </button>
        </div>
      </div>

      {/* ── Combinable Filter Bar (المهمة 2.11) ── */}
      <div className="bg-white p-4 rounded-2xl border border-border/60 shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <Filter size={14} className="text-indigo-400" />
            <span>{'Advanced Impact Filters'}</span>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 text-[11px] font-bold text-rose-400 hover:text-rose-300 transition-colors"
            >
              <X size={13} />
              <span>{'Reset Filters'}</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Program Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-muted-foreground/70 mb-1">
              {'Program'}
            </label>
            <select
              value={currentProgram}
              onChange={(e) => updateFilter('program', e.target.value)}
              className="w-full bg-muted/40 border border-border/60 rounded-xl px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-indigo-500"
            >
              <option value="all">{'All Programs'}</option>
              {filterOptions.programs.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Sector Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-muted-foreground/70 mb-1">
              {'Sector'}
            </label>
            <select
              value={currentSector}
              onChange={(e) => updateFilter('sector', e.target.value)}
              className="w-full bg-muted/40 border border-border/60 rounded-xl px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-indigo-500"
            >
              <option value="all">{'All Sectors'}</option>
              {filterOptions.sectors.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Province Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-muted-foreground/70 mb-1">
              {'Province'}
            </label>
            <select
              value={currentProvince}
              onChange={(e) => updateFilter('province', e.target.value)}
              className="w-full bg-muted/40 border border-border/60 rounded-xl px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-indigo-500"
            >
              <option value="all">{'All Provinces'}</option>
              {filterOptions.provinces.map(pr => (
                <option key={pr} value={pr}>{pr}</option>
              ))}
            </select>
          </div>

          {/* Year Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-muted-foreground/70 mb-1">
              {'Year'}
            </label>
            <select
              value={currentYear}
              onChange={(e) => updateFilter('year', e.target.value)}
              className="w-full bg-muted/40 border border-border/60 rounded-xl px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-indigo-500"
            >
              <option value="all">{'All Years'}</option>
              {filterOptions.years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Stage Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-muted-foreground/70 mb-1">
              {'Stage'}
            </label>
            <select
              value={currentStage}
              onChange={(e) => updateFilter('stage', e.target.value)}
              className="w-full bg-muted/40 border border-border/60 rounded-xl px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-indigo-500"
            >
              <option value="all">{'All Stages'}</option>
              {filterOptions.stages.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Impact KPI Cards (المهمة 2.10) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Active vs Inactive Companies */}
        <div className="bg-white border border-border/60 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">
              {'Active Ventures'}
            </span>
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Building2 size={20} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-foreground">
              {loading ? '...' : analytics.activeCount}
              <span className="text-xs font-normal text-muted-foreground ml-1.5">
                / {analytics.totalCompanies}
              </span>
            </div>
            <div className="text-[11px] text-emerald-400 font-semibold mt-1 flex items-center gap-1">
              <CheckCircle2 size={12} />
              <span>
                {isRtl
                  ? `${analytics.inactiveCount} شركة متوقفة`
                  : `${analytics.inactiveCount} inactive / ceased`}
              </span>
            </div>
          </div>
        </div>

        {/* Total Revenue Generated */}
        <div className="bg-white border border-border/60 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">
              {'Aggregated Revenue'}
            </span>
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-foreground">
              {loading ? '...' : `${formatCurrency(analytics.totalRevenue)}`}
            </div>
            <div className="text-[11px] text-muted-foreground font-semibold mt-1">
              {'From verified snapshot data'}
            </div>
          </div>
        </div>

        {/* Total Jobs Created */}
        <div className="bg-white border border-border/60 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">
              {'Jobs Created'}
            </span>
            <div className="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center">
              <Users size={20} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-foreground">
              {loading ? '...' : analytics.totalJobs}
            </div>
            <div className="text-[11px] text-sky-400 font-semibold mt-1">
              {'Direct jobs & team members'}
            </div>
          </div>
        </div>

        {/* 12-Month Survival Rate */}
        <div className="bg-white border border-border/60 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">
              {'12M Survival Rate'}
            </span>
            <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
              <Award size={20} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-foreground">
              {loading ? '...' : `${analytics.survivalRates.twelveMonths}%`}
            </div>
            <div className="text-[11px] text-purple-400 font-semibold mt-1">
              {'Active 12m post-graduation'}
            </div>
          </div>
        </div>

      </div>

      {/* ── Survival Milestones & Revenue Growth Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Survival Milestone Progress Bars */}
        <div className="lg:col-span-4 bg-white border border-border/60 rounded-2xl p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
              <Award size={18} className="text-purple-400" />
              <span>{'Post-Graduation Survival'}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {'Survival rate over 6, 12, and 24 months'}
            </p>
          </div>

          <div className="space-y-4">
            {/* 6 Months */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-muted-foreground">{'After 6 Months'}</span>
                <span className="text-indigo-400 font-mono">{analytics.survivalRates.sixMonths}%</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-700"
                  style={{ width: `${analytics.survivalRates.sixMonths}%` }}
                />
              </div>
            </div>

            {/* 12 Months */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-muted-foreground">{'After 12 Months'}</span>
                <span className="text-purple-400 font-mono">{analytics.survivalRates.twelveMonths}%</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-700"
                  style={{ width: `${analytics.survivalRates.twelveMonths}%` }}
                />
              </div>
            </div>

            {/* 24 Months */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-muted-foreground">{'After 24 Months'}</span>
                <span className="text-emerald-400 font-mono">{analytics.survivalRates.twentyFourMonths}%</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-700"
                  style={{ width: `${analytics.survivalRates.twentyFourMonths}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Revenue Timeline (Line / Bar Visualization) */}
        <div className="lg:col-span-8 bg-white border border-border/60 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <TrendingUp size={18} className="text-emerald-400" />
                <span>{'Revenue Growth Over Time'}</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {'Annual venture revenue aggregate'}
              </p>
            </div>
          </div>

          <div className="h-56 w-full flex items-end gap-3 pt-6 pb-2 px-2">
            {analytics.revenueTimeline.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground/70 text-xs font-medium">
                {'No annual revenue timeline points available'}
              </div>
            ) : (
              analytics.revenueTimeline.map((item, idx) => {
                const maxRev = Math.max(...analytics.revenueTimeline.map(r => r.amount), 1000);
                const heightPercent = Math.max((item.amount / maxRev) * 100, 10);
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold text-emerald-300 bg-slate-800 px-1.5 py-0.5 rounded shadow">
                      {formatCurrency(item.amount)}
                    </div>
                    <div
                      className="w-full max-w-[42px] bg-gradient-to-t from-emerald-600 to-teal-400 rounded-t-xl transition-all group-hover:from-emerald-500 group-hover:to-teal-300 shadow-md shadow-emerald-600/20"
                      style={{ height: `${heightPercent}%` }}
                    />
                    <span className="text-xs font-black text-muted-foreground font-mono">
                      {item.year}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

    </div>
  );
}





