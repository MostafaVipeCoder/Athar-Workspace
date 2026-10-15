import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, UserCheck, Building2, Clock, MailCheck,
  TrendingUp, RotateCw, Sparkles,
  PieChart, BarChart3, AlertCircle, CheckCircle2,
  Send
} from 'lucide-react';
import { getAlumniManagerDashboardStats, getAlumniManagerChartsData } from '../../lib/api';

export default function AlumniManagerDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    registeredFoundersCount: 0,
    manualFoundersCount: 0,
    totalCompaniesCount: 0,
    recentlyUpdatedCompaniesCount: 0,
    invitations: { total: 0, accepted: 0, pending: 0, expired: 0, responseRate: 0 }
  });

  const [chartsData, setChartsData] = useState({
    registrationTrends: [],
    sectorDistribution: [],
    provinceDistribution: []
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [st, ch] = await Promise.all([
        getAlumniManagerDashboardStats(),
        getAlumniManagerChartsData()
      ]);
      setStats(st);
      setChartsData(ch);
    } catch (err) {
      console.error('Failed to load manager dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const SECTOR_COLORS = [
    '#3B6FE8', '#F59E0B', '#10B981', '#EC4899',
    '#8B5CF6', '#14B8A6', '#F43F5E', '#6366F1'
  ];

  const kpiCards = [
    {
      label: 'Active Founders',
      value: stats.registeredFoundersCount,
      sub: 'Auth accounts created',
      icon: UserCheck,
      color: 'emerald',
      iconClass: 'bg-emerald-50 border-emerald-100 text-emerald-600',
      subClass: 'text-emerald-600',
      SubIcon: CheckCircle2,
    },
    {
      label: 'Manual Founders',
      value: stats.manualFoundersCount,
      sub: 'Eligible for invitation',
      icon: Users,
      color: 'amber',
      iconClass: 'bg-amber-50 border-amber-100 text-amber-600',
      subClass: 'text-amber-600',
      SubIcon: AlertCircle,
    },
    {
      label: 'Total Companies',
      value: stats.totalCompaniesCount,
      sub: 'Registered alumni ventures',
      icon: Building2,
      iconClass: 'bg-athar-blue/10 border-athar-blue/20 text-athar-blue',
      subClass: 'text-athar-blue',
      SubIcon: null,
    },
    {
      label: 'Updated (30d)',
      value: stats.recentlyUpdatedCompaniesCount,
      sub: 'Active data submissions',
      icon: Clock,
      iconClass: 'bg-sky-50 border-sky-100 text-sky-600',
      subClass: 'text-sky-600',
      SubIcon: null,
    },
    {
      label: 'Invite Response',
      value: `${stats.invitations.responseRate}%`,
      sub: `${stats.invitations.pending} pending · ${stats.invitations.expired} expired`,
      icon: MailCheck,
      iconClass: 'bg-athar-yellow/10 border-athar-yellow/20 text-athar-yellow',
      subClass: 'text-muted-foreground',
      SubIcon: null,
      extra: `(${stats.invitations.accepted}/${stats.invitations.total})`,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl border border-border/60 p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-athar-blue/10 text-athar-blue border border-athar-blue/20">
              <Sparkles size={12} />
              Executive Overview
            </span>
          </div>
          <h1 className="text-2xl font-black text-foreground tracking-tight">
            Alumni Network Overview
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-xl">
            Monitor founder onboarding rate, data freshness, and invitation conversion across Athar network.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={loadDashboardData}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-background hover:bg-muted border border-border/60 text-xs font-semibold text-muted-foreground transition-all disabled:opacity-50"
          >
            <RotateCw size={13} className={loading ? 'animate-spin text-athar-blue' : ''} />
            Refresh
          </button>
          <Link
            to="/alumni/admin/invitations"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-athar-blue hover:bg-athar-blue/90 text-white text-xs font-bold shadow-sm shadow-athar-blue/20 transition-all"
          >
            <Send size={13} />
            Send Invitations
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpiCards.map((card, idx) => {
          const Icon = card.icon;
          const SubIcon = card.SubIcon;
          return (
            <div
              key={idx}
              className="bg-white rounded-2xl border border-border/60 p-5 shadow-sm hover:shadow-md hover:border-border transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">{card.label}</span>
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${card.iconClass}`}>
                  <Icon size={18} />
                </div>
              </div>
              <div className="mt-4">
                <div className="text-3xl font-black text-foreground tracking-tight flex items-baseline gap-1.5">
                  {loading ? <span className="text-muted-foreground text-lg">—</span> : card.value}
                  {card.extra && !loading && (
                    <span className="text-xs font-normal text-muted-foreground">{card.extra}</span>
                  )}
                </div>
                <div className={`flex items-center gap-1 text-[11px] font-semibold mt-1 ${card.subClass}`}>
                  {SubIcon && <SubIcon size={11} />}
                  <span>{card.sub}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Monthly Registrations Bar Chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border/60 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <TrendingUp size={15} className="text-athar-blue" />
                Monthly Founder Registrations
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Last 12 months registration velocity</p>
            </div>
          </div>

          <div className="h-52 w-full flex items-end gap-1.5 pb-4 px-1">
            {chartsData.registrationTrends.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                No registration history yet
              </div>
            ) : (
              chartsData.registrationTrends.map((item, idx) => {
                const maxCount = Math.max(...chartsData.registrationTrends.map(t => t.count), 5);
                const heightPercent = Math.max((item.count / maxCount) * 100, 6);
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 group h-full justify-end">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold text-white bg-athar-blue px-1.5 py-0.5 rounded shadow">
                      {item.count}
                    </div>
                    <div
                      className="w-full max-w-[24px] bg-athar-blue/20 group-hover:bg-athar-blue rounded-t-md transition-all duration-200"
                      style={{ height: `${heightPercent}%` }}
                    />
                    <span className="text-[9px] font-semibold text-muted-foreground truncate max-w-full">
                      {item.label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Sector Breakdown */}
        <div className="bg-white rounded-2xl border border-border/60 p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <PieChart size={15} className="text-athar-yellow" />
              Sector Breakdown
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Venture concentration by industry</p>
          </div>

          <div className="space-y-3 max-h-52 overflow-y-auto">
            {chartsData.sectorDistribution.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-xs">
                No sector data available
              </div>
            ) : (
              chartsData.sectorDistribution.slice(0, 6).map((item, idx) => {
                const total = chartsData.sectorDistribution.reduce((acc, curr) => acc + curr.count, 0) || 1;
                const pct = Math.round((item.count / total) * 100);
                const color = SECTOR_COLORS[idx % SECTOR_COLORS.length];
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="truncate max-w-[130px]">{item.sector}</span>
                      </span>
                      <span className="font-mono text-muted-foreground text-[11px]">{item.count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Province Distribution */}
      <div className="bg-white rounded-2xl border border-border/60 p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <BarChart3 size={15} className="text-sky-500" />
            Geographic Distribution by Province
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Venture locations across governorates</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {chartsData.provinceDistribution.length === 0 ? (
            <div className="col-span-full py-8 text-center text-muted-foreground text-xs">
              No geographic data available
            </div>
          ) : (
            chartsData.provinceDistribution.map((item, idx) => (
              <div
                key={idx}
                className="bg-muted/40 border border-border/60 rounded-xl p-3.5 flex flex-col justify-between hover:border-athar-blue/30 hover:bg-athar-blue/5 transition-all group"
              >
                <div className="text-xs font-semibold text-foreground truncate" title={item.province}>
                  {item.province}
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-xl font-black text-foreground group-hover:text-athar-blue transition-colors">
                    {item.count}
                  </span>
                  <span className="text-[9px] text-muted-foreground font-bold uppercase">
                    Ventures
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
