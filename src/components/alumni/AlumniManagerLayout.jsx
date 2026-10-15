import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  LayoutDashboard, MailCheck, BellRing, LineChart,
  Sparkles, BarChart3, ShieldCheck, Building2,
  LogOut, Menu, X, ChevronRight
} from 'lucide-react';

export default function AlumniManagerLayout({ children }) {
  const { user, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/alumni/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const navItems = [
    {
      to: '/alumni/admin/dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      active: location.pathname === '/alumni/admin/dashboard' || location.pathname === '/alumni/admin'
    },
    {
      to: '/alumni/admin/invitations',
      label: 'Invitations',
      icon: MailCheck,
      active: location.pathname === '/alumni/admin/invitations'
    },
    {
      to: '/alumni/admin/notifications',
      label: 'Notifications',
      icon: BellRing,
      active: location.pathname === '/alumni/admin/notifications'
    },
    {
      to: '/alumni/admin/analytics',
      label: 'Platform Analytics',
      icon: LineChart,
      active: location.pathname === '/alumni/admin/analytics'
    },
    {
      to: '/alumni/admin/opportunities',
      label: 'Opportunities',
      icon: Sparkles,
      active: location.pathname === '/alumni/admin/opportunities'
    },
    {
      to: '/alumni/admin/impact',
      label: 'Impact Dashboard',
      icon: BarChart3,
      active: location.pathname === '/alumni/admin/impact'
    },
    {
      to: '/alumni/admin/workspace',
      label: 'M&E Workspace',
      icon: ShieldCheck,
      active: location.pathname === '/alumni/admin/workspace'
    },
    {
      to: '/alumni/admin/directory',
      label: 'Company Directory',
      icon: Building2,
      active: location.pathname === '/alumni/admin/directory' || location.pathname.startsWith('/alumni/admin/company')
    }
  ];

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Manager';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-manrope">

      {/* ── Top Header ── */}
      <header className="sticky top-0 z-40 bg-white border-b border-border/60 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">

          {/* Brand */}
          <Link
            to="/alumni/admin/dashboard"
            className="flex items-center gap-2.5 group shrink-0"
          >
            <div className="w-8 h-8 rounded-lg bg-athar-blue flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all">
              <ShieldCheck size={16} className="text-athar-yellow stroke-[2.5]" />
            </div>
            <span className="font-extrabold text-[15px] tracking-tight text-foreground">
              Athar <span className="text-athar-blue">OS</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1 px-6">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    item.active
                      ? 'bg-athar-blue text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  }`}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-2 shrink-0">

            {/* User Pill */}
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 rounded-lg border border-border/60">
              <div className="w-6 h-6 rounded-md bg-athar-blue text-white font-black text-[10px] flex items-center justify-center shadow-sm">
                {initials}
              </div>
              <span className="text-xs font-semibold text-foreground truncate max-w-[120px]">
                {displayName}
              </span>
              <span className="text-[9px] font-black uppercase tracking-wider text-athar-blue bg-athar-blue/10 px-1.5 py-0.5 rounded">
                MANAGER
              </span>
            </div>

            {/* Sign Out */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background hover:bg-rose-50 text-muted-foreground hover:text-rose-600 border border-border/60 hover:border-rose-200 text-xs font-semibold transition-all"
              title="Sign Out"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>

            {/* Mobile Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground border border-border/60 transition-all"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-border/60 bg-white p-4 space-y-1 animate-in slide-in-from-top-2 duration-200 max-h-[80vh] overflow-y-auto shadow-lg">
            <div className="flex items-center gap-2.5 px-3 py-2.5 bg-muted/40 rounded-xl border border-border/60 mb-3">
              <div className="w-7 h-7 rounded-lg bg-athar-blue text-white font-black text-xs flex items-center justify-center">
                {initials}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-foreground truncate">{displayName}</span>
                <span className="text-[10px] text-athar-blue font-bold uppercase tracking-wider">Alumni Manager</span>
              </div>
            </div>

            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    item.active
                      ? 'bg-athar-blue text-white shadow-sm'
                      : 'text-foreground hover:bg-muted/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </div>
                  <ChevronRight size={15} className="opacity-50" />
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {/* ── Page Content ── */}
      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
