import React, { useState, useEffect } from 'react';
import {
  TrendingUp, ArrowLeft, Building2, Users, DollarSign, Award,
  ShieldCheck, MapPin, PieChart, BarChart3, Download, RefreshCw,
  Sparkles, CheckCircle2, ChevronRight
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { getImpactStats, getAlumniCompanies } from '../../lib/api';
import { translations } from '../../lib/translations';
import * as XLSX from 'xlsx';

export default function ImpactDashboard() {
  const navigate = useNavigate();
  const lang = 'en';
  const isRtl = false;
  const t = translations.Alumni[lang] || translations.Alumni.ar;

  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [impactStats, comps] = await Promise.all([
        getImpactStats(),
        getAlumniCompanies()
      ]);
      setStats(impactStats);
      setCompanies(comps || []);
    } catch (err) {
      console.error('Error loading impact stats:', err);
    } finally {
      setLoading(false);
    }
  };

  // Sector breakdown aggregation
  const sectorCounts = companies.reduce((acc, c) => {
    const s = c.industry || 'Other';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  // Province breakdown aggregation
  const provinceCounts = companies.reduce((acc, c) => {
    const p = c.province || c.location || 'Other';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  const exportImpactReport = () => {
    if (!stats) return;
    const reportData = [
      { Metric: 'Total Alumni Companies', Value: stats.totalAlumniCompanies },
      { Metric: 'Active Companies', Value: stats.activeCompanies },
      { Metric: 'Survival Rate', Value: `${stats.survivalRate}%` },
      { Metric: 'Jobs Created', Value: stats.totalJobsCreated },
      { Metric: 'Total Revenue (SAR)', Value: stats.totalRevenueSar },
      { Metric: 'Total Funding Raised (SAR)', Value: stats.totalFundingRaised },
      { Metric: 'Issued Certificates', Value: stats.totalCertificates },
      { Metric: 'Data Coverage', Value: `${stats.snapshotsCoverage}%` }
    ];

    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Impact Metrics');
    XLSX.writeFile(wb, `Athar_Impact_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-athar-blue/20 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-athar-blue/20 border border-athar-blue/40 text-athar-yellow flex items-center justify-center">
            <BarChart3 size={24} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-foreground">
              {t.impactDashboard}
            </h1>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              {'M&E Cumulative Impact Analytics & Insights'}
            </p>
          </div>
        </div>

        <button
          onClick={exportImpactReport}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-athar-blue hover:bg-athar-blue/90 text-foreground text-xs font-bold shadow-md shadow-athar-blue/20 transition-all self-start sm:self-center"
        >
          <Download size={16} />
          <span>{'Export Report'}</span>
        </button>
      </div>
        {loading && (
          <div className="py-24 text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-athar-blue mx-auto mb-3" />
            <p className="text-sm font-bold text-muted-foreground">{t.loading}</p>
          </div>
        )}

        {!loading && stats && (
          <>
            {/* Top Impact Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold mb-2">
                  <Building2 size={18} className="text-athar-blue" />
                  <span>{t.activeCompanies}</span>
                </div>
                <div className="text-3xl font-black text-foreground">
                  {stats.activeCompanies}
                  <span className="text-xs text-muted-foreground font-semibold mx-1">/ {stats.totalAlumniCompanies}</span>
                </div>
                <div className="text-xs text-emerald-600 font-bold mt-2 flex items-center gap-1">
                  <CheckCircle2 size={13} />
                  <span>{stats.survivalRate}% {t.survivalRate}</span>
                </div>
              </div>

              <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold mb-2">
                  <Users size={18} className="text-emerald-500" />
                  <span>{t.jobsCreated}</span>
                </div>
                <div className="text-3xl font-black text-foreground">
                  {stats.totalJobsCreated.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground font-semibold mt-2">
                  {'Direct sustainable jobs'}
                </div>
              </div>

              <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold mb-2">
                  <DollarSign size={18} className="text-amber-500" />
                  <span>{t.totalRevenue}</span>
                </div>
                <div className="text-2xl font-black text-foreground truncate">
                  {stats.totalRevenueSar ? `${(stats.totalRevenueSar / 1000000).toFixed(1)}M SAR` : '—'}
                </div>
                <div className="text-xs text-muted-foreground font-semibold mt-2">
                  {'Cumulative revenue'}
                </div>
              </div>

              <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold mb-2">
                  <TrendingUp size={18} className="text-athar-blue" />
                  <span>{t.fundingRaised}</span>
                </div>
                <div className="text-2xl font-black text-foreground truncate">
                  {stats.totalFundingRaised ? `${(stats.totalFundingRaised / 1000000).toFixed(1)}M SAR` : '—'}
                </div>
                <div className="text-xs text-muted-foreground font-semibold mt-2">
                  {'Cumulative capital raised'}
                </div>
              </div>
            </div>

            {/* Middle Section: Sector Breakdown & Geographic Spread */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Sector Distribution */}
              <div className="bg-card border border-border/60 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
                <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                  <PieChart size={18} className="text-athar-blue" />
                  <span>{'Sector Breakdown'}</span>
                </h3>

                <div className="space-y-3 pt-2">
                  {Object.entries(sectorCounts).map(([sector, count]) => {
                    const pct = ((count / companies.length) * 100).toFixed(0);
                    return (
                      <div key={sector} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-foreground">{sector}</span>
                          <span className="text-muted-foreground">{count} ({pct}%)</span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-athar-blue rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Geographic Spread */}
              <div className="bg-card border border-border/60 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
                <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                  <MapPin size={18} className="text-athar-blue" />
                  <span>{'Geographic Spread'}</span>
                </h3>

                <div className="space-y-3 pt-2">
                  {Object.entries(provinceCounts).map(([province, count]) => {
                    const pct = ((count / companies.length) * 100).toFixed(0);
                    return (
                      <div key={province} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-foreground">{province}</span>
                          <span className="text-muted-foreground">{count} ({pct}%)</span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-athar-yellow rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* M&E Data Integrity & Snapshot Coverage */}
            <div className="bg-card border border-border/60 rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="space-y-1">
                <h4 className="text-base font-extrabold text-foreground flex items-center gap-2">
                  <ShieldCheck size={20} className="text-emerald-500" />
                  <span>{'Annual Update Snapshot Coverage'}</span>
                </h4>
                <p className="text-xs text-muted-foreground font-semibold">
                  {isRtl
                    ? `تم تسجيل بيانات حديثة لـ ${stats.snapshotsCoverage}% من إجمالي الشركات الخريجة`
                    : `Recent verified snapshots logged for ${stats.snapshotsCoverage}% of alumni`}
                </p>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right rtl:text-left">
                  <div className="text-2xl font-black text-foreground">{stats.snapshotsCoverage}%</div>
                  <div className="text-[10px] text-muted-foreground font-bold">{'Response Rate'}</div>
                </div>
                <Link
                  to="/form-library"
                  className="px-4 py-2.5 bg-athar-blue text-foreground rounded-xl text-xs font-bold shadow-lg shadow-athar-blue/20"
                >
                  {'Manage Update Form'}
                </Link>
              </div>
            </div>
          </>
        )}
    </div>
  );
}





