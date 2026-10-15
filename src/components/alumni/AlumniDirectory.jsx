import React, { useState, useEffect } from 'react';
import {
  Search, ArrowLeft, LayoutGrid, List, Filter, ExternalLink,
  Building2, Users, TrendingUp, DollarSign, Award, Briefcase,
  MapPin, Calendar, Plus, RefreshCw, ChevronRight, CheckCircle2,
  Sparkles, Globe, Download, ShieldCheck, Shield, User
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { getAlumniCompanies, getPrograms, getImpactStats } from '../../lib/api';
import { translations } from '../../lib/translations';
import * as XLSX from 'xlsx';

export default function AlumniDirectory() {
  const navigate = useNavigate();
  const lang = 'en';
  const t = translations.Alumni[lang] || translations.Alumni.ar;

  const [companies, setCompanies] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedProgram, setSelectedProgram] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [companiesData, programsData, impactStats] = await Promise.all([
        getAlumniCompanies(),
        getPrograms().catch(() => []),
        getImpactStats().catch(() => null)
      ]);
      setCompanies(companiesData || []);
      setPrograms(programsData || []);
      setStats(impactStats);
    } catch (err) {
      console.error('Failed to load alumni directory:', err);
      setError('Failed to load alumni data.');
    } finally {
      setLoading(false);
    }
  };

  const toggleLanguage = () => {
    const nextLang = lang === 'ar' ? 'en' : 'ar';
    setSearchParams({ lang: nextLang });
  };

  // Extract distinct sectors and provinces for filter options
  const sectors = Array.from(new Set(companies.map(c => c.industry).filter(Boolean)));
  const provinces = Array.from(new Set(companies.map(c => c.province || c.location || c.governorate).filter(Boolean)));
  const stages = ['Idea', 'MVP', 'Seed', 'Early Growth', 'Growth', 'Scale'];

  const filteredCompanies = companies.filter(company => {
    const nameMatch =
      company.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      company.startup_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      company.startup_name_ar?.toLowerCase().includes(searchTerm.toLowerCase());
    const sectorMatch = !selectedSector || company.industry === selectedSector;
    const stageMatch = !selectedStage || company.stage?.toLowerCase() === selectedStage.toLowerCase();
    const provinceMatch =
      !selectedProvince ||
      (company.province || company.location || company.governorate) === selectedProvince;

    const foundersList = company.company_founders || [];
    const founderMatch = foundersList.some(cf =>
      cf.founders?.name_ar?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cf.founders?.name_en?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (nameMatch || founderMatch) && sectorMatch && stageMatch && provinceMatch;
  });

  const exportToExcel = () => {
    const exportData = filteredCompanies.map(c => ({
      'Company Name': c.name || c.startup_name,
      'Name (AR)': c.startup_name_ar || '',
      'Industry': c.industry || '',
      'Stage': c.stage || '',
      'Province': c.province || c.location || '',
      'Founding Year': c.founding_year || '',
      'Website': c.website_url || '',
      'Founders': (c.company_founders || []).map(cf => cf.founders?.name_ar || cf.founders?.name_en).filter(Boolean).join(', ')
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Alumni Directory');
    XLSX.writeFile(wb, `Athar_Alumni_Directory_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-indigo-900/40 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-athar-blue/20 border border-athar-blue/40 text-athar-yellow flex items-center justify-center">
            <Building2 size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-foreground">
                {t.directory}
              </h1>
              <span className="text-xs bg-athar-blue/20 text-athar-yellow border border-athar-blue/30 px-2.5 py-0.5 rounded-full font-bold">
                {companies.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              {'Athar Accelerator & Incubator Alumni Network'}
            </p>
          </div>
        </div>

        <button
          onClick={exportToExcel}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-bold shadow-md shadow-athar-blue/20 transition-all self-start sm:self-center"
        >
          <Download size={16} />
          <span>{'Export Excel'}</span>
        </button>
      </div>
        {/* KPI Banner */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 animate-in fade-in duration-500">
            <div className="bg-card/70 backdrop-blur-sm border border-border/60 rounded-2xl p-4 shadow-sm hover:border-athar-blue/30 transition-all">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold mb-1">
                <Building2 size={16} className="text-athar-blue" />
                <span>{t.activeCompanies}</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-foreground">
                {stats.activeCompanies || companies.length}
                <span className="text-xs text-muted-foreground font-semibold mx-1">/ {stats.totalAlumniCompanies || companies.length}</span>
              </div>
              <div className="text-[10px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
                <CheckCircle2 size={12} />
                <span>{stats.survivalRate}% {t.survivalRate}</span>
              </div>
            </div>

            <div className="bg-card/70 backdrop-blur-sm border border-border/60 rounded-2xl p-4 shadow-sm hover:border-athar-blue/30 transition-all">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold mb-1">
                <Users size={16} className="text-emerald-500" />
                <span>{t.jobsCreated}</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-foreground">
                {(stats.totalJobsCreated || 0).toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground font-semibold mt-1">
                {'Direct jobs'}
              </div>
            </div>

            <div className="bg-card/70 backdrop-blur-sm border border-border/60 rounded-2xl p-4 shadow-sm hover:border-athar-blue/30 transition-all">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold mb-1">
                <DollarSign size={16} className="text-amber-500" />
                <span>{t.totalRevenue}</span>
              </div>
              <div className="text-xl sm:text-2xl font-black text-foreground truncate">
                {stats.totalRevenueSar ? `${(stats.totalRevenueSar / 1000000).toFixed(1)}M SAR` : '—'}
              </div>
              <div className="text-[10px] text-muted-foreground font-semibold mt-1">
                {'Annual revenue'}
              </div>
            </div>

            <div className="bg-card/70 backdrop-blur-sm border border-border/60 rounded-2xl p-4 shadow-sm hover:border-athar-blue/30 transition-all">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold mb-1">
                <TrendingUp size={16} className="text-athar-blue" />
                <span>{t.fundingRaised}</span>
              </div>
              <div className="text-xl sm:text-2xl font-black text-foreground truncate">
                {stats.totalFundingRaised ? `${(stats.totalFundingRaised / 1000000).toFixed(1)}M SAR` : '—'}
              </div>
              <div className="text-[10px] text-muted-foreground font-semibold mt-1">
                {'Total raised'}
              </div>
            </div>
          </div>
        )}

        {/* Filter and Search Bar */}
        <div className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground ${'left-3'}`} size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t.searchPlaceholder}
                className={`w-full py-2.5 bg-muted/50 border border-border/60 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-athar-blue/20 focus:border-athar-blue transition-all ${
                  'pl-10 pr-4'
                }`}
              />
            </div>

            {/* View Mode & Filter Toggle */}
            <div className="flex items-center gap-2 self-end md:self-auto">
              <button
                onClick={() => setShowFiltersMobile(!showFiltersMobile)}
                className="md:hidden flex items-center gap-1.5 px-3 py-2 bg-muted rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                <Filter size={14} />
                <span>{'Filters'}</span>
              </button>

              <div className="flex items-center bg-muted/60 p-1 rounded-xl border border-border/50">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-card text-athar-blue shadow-sm' : 'text-muted-foreground'}`}
                  title={'Grid View'}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-card text-athar-blue shadow-sm' : 'text-muted-foreground'}`}
                  title={'List View'}
                >
                  <List size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Filter Pills (Always visible on desktop, toggleable on mobile) */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 ${showFiltersMobile ? 'block' : 'hidden md:grid'}`}>
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:border-athar-blue"
            >
              <option value="">{'All Sectors'}</option>
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:border-athar-blue"
            >
              <option value="">{'All Stages'}</option>
              {stages.map(st => <option key={st} value={st}>{st}</option>)}
            </select>

            <select
              value={selectedProvince}
              onChange={(e) => setSelectedProvince(e.target.value)}
              className="w-full bg-muted/40 border border-border/60 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:border-athar-blue"
            >
              <option value="">{'All Provinces'}</option>
              {provinces.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            {(selectedSector || selectedStage || selectedProvince || searchTerm) && (
              <button
                onClick={() => {
                  setSelectedSector('');
                  setSelectedStage('');
                  setSelectedProvince('');
                  setSearchTerm('');
                }}
                className="w-full px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/10 rounded-xl transition-colors text-center"
              >
                {'Reset Filters'}
              </button>
            )}
          </div>
        </div>

        {/* Content Loading & Error States */}
        {loading && (
          <div className="py-24 text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-athar-blue mx-auto mb-3" />
            <p className="text-sm font-bold text-muted-foreground">{t.loading}</p>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl p-6 text-center max-w-md mx-auto">
            <p className="font-bold text-sm mb-3">{error}</p>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-destructive text-foreground rounded-xl text-xs font-bold"
            >
              {'Retry'}
            </button>
          </div>
        )}

        {/* Companies Grid/List */}
        {!loading && !error && filteredCompanies.length > 0 && (
          <div>
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {filteredCompanies.map(company => (
                  <AlumniCard key={company.company_id || company.id} company={company} isRtl={isRtl} lang={lang} />
                ))}
              </div>
            ) : (
              <div className="bg-card border border-border/60 rounded-2xl overflow-hidden divide-y divide-border/50">
                {filteredCompanies.map(company => (
                  <AlumniListItem key={company.company_id || company.id} company={company} isRtl={isRtl} lang={lang} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filteredCompanies.length === 0 && (
          <div className="bg-card border border-dashed border-border/70 rounded-2xl p-12 text-center max-w-lg mx-auto">
            <Building2 className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="text-base font-extrabold text-foreground mb-1">
              {'No alumni companies found'}
            </h3>
            <p className="text-xs text-muted-foreground font-medium mb-4">
              {'Try adjusting your search criteria'}
            </p>
          </div>
        )}
    </div>
  );
}

// ─── ALUMNI CARD COMPONENT ───────────────────────────────────────────────────
function AlumniCard({ company, isRtl, lang }) {
  const navigate = useNavigate();
  const name = isRtl && company.startup_name_ar ? company.startup_name_ar : company.name || company.startup_name;
  const industry = company.industry || 'Tech';
  const stage = company.stage || 'Seed';
  const province = company.province || company.location || '';
  const founders = company.company_founders || [];

  return (
    <div
      onClick={() => navigate(`/alumni/admin/company/${company.company_id || company.id}?lang=${lang}`)}
      className="group bg-card hover:bg-card/90 border border-border/60 hover:border-athar-blue/40 rounded-2xl p-5 shadow-sm hover:shadow-sm hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col justify-between relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-athar-blue/10 to-transparent rounded-bl-full pointer-events-none" />

      <div>
        {/* Header row: Logo + Industry */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="w-14 h-14 rounded-xl border border-border/80 bg-muted/30 p-2 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
            {company.logo_url ? (
              <img src={company.logo_url} alt={name} className="w-full h-full object-contain" />
            ) : (
              <Building2 className="text-muted-foreground/50" size={24} />
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-athar-blue/10 text-athar-blue border border-athar-blue/20">
              {industry}
            </span>
            {stage && (
              <span className="text-[10px] font-bold text-muted-foreground">
                {stage}
              </span>
            )}
          </div>
        </div>

        {/* Company Name */}
        <h3 className="text-base font-extrabold text-foreground mb-1.5 group-hover:text-athar-blue transition-colors line-clamp-1">
          {name}
        </h3>

        {/* Description */}
        <p className="text-xs text-muted-foreground font-medium line-clamp-2 mb-4 leading-relaxed">
          {(isRtl && company.description_ar) || company.description || ('Athar Alumni Network Company')}
        </p>

        {/* Location & Year */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-semibold mb-4">
          {province && (
            <span className="flex items-center gap-1">
              <MapPin size={12} className="text-athar-blue" />
              <span>{province}</span>
            </span>
          )}
          {company.founding_year && (
            <span className="flex items-center gap-1">
              <Calendar size={12} />
              <span>{company.founding_year}</span>
            </span>
          )}
        </div>
      </div>

      {/* Founders Footer */}
      <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <Users size={14} className="text-muted-foreground" />
          <span className="font-bold text-foreground text-xs line-clamp-1">
            {founders.length > 0
              ? founders.map(f => f.founders?.name_ar || f.founders?.name_en).filter(Boolean).slice(0, 2).join('، ')
              : ('Founders')}
          </span>
        </div>
        <ChevronRight size={16} className={`text-muted-foreground group-hover:text-athar-blue transition-all group-hover:translate-x-1 ${''}`} />
      </div>
    </div>
  );
}

// ─── ALUMNI LIST ITEM COMPONENT ─────────────────────────────────────────────
function AlumniListItem({ company, isRtl, lang }) {
  const navigate = useNavigate();
  const name = isRtl && company.startup_name_ar ? company.startup_name_ar : company.name || company.startup_name;
  const industry = company.industry || 'Tech';
  const stage = company.stage || 'Seed';
  const province = company.province || company.location || '';
  const founders = company.company_founders || [];

  return (
    <div
      onClick={() => navigate(`/alumni/admin/company/${company.company_id || company.id}?lang=${lang}`)}
      className="p-4 hover:bg-muted/40 transition-colors flex items-center justify-between gap-4 cursor-pointer"
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="w-11 h-11 rounded-xl border border-border/80 bg-muted/30 p-1.5 flex items-center justify-center shrink-0">
          {company.logo_url ? (
            <img src={company.logo_url} alt={name} className="w-full h-full object-contain" />
          ) : (
            <Building2 className="text-muted-foreground/50" size={20} />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-extrabold text-sm text-foreground truncate">{name}</h4>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-athar-blue/10 text-athar-blue">
              {industry}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {founders.map(f => f.founders?.name_ar || f.founders?.name_en).filter(Boolean).join(' • ') || stage}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground font-semibold">
        {province && <span className="hidden sm:inline">{province}</span>}
        <ChevronRight size={16} className={''} />
      </div>
    </div>
  );
}


