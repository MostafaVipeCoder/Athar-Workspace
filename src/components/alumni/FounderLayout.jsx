import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getFounderProfileByAuth, getFounderNotifications } from '../../lib/api';
import {
  LayoutDashboard, GraduationCap, Sparkles, Bell, Users,
  TrendingUp, LogOut, Menu, X, Globe, User, Shield, ExternalLink
} from 'lucide-react';

export default function FounderLayout({ children }) {
  const { user, signOut, profile: authProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [founder, setFounder] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const searchParams = new URLSearchParams(location.search);
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  useEffect(() => {
    if (!user) return;
    getFounderProfileByAuth(user.id, user.email)
      .then(f => setFounder(f))
      .catch(() => {});

    getFounderNotifications(user.id)
      .then(notes => {
        const unread = (notes || []).filter(n => !n.is_read).length;
        setUnreadCount(unread);
      })
      .catch(() => {});
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/alumni/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const toggleLang = () => {
    const nextLang = lang === 'ar' ? 'en' : 'ar';
    const params = new URLSearchParams(location.search);
    params.set('lang', nextLang);
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };

  const navItems = [
    {
      to: `/alumni/founder/dashboard?lang=${lang}`,
      label: isRtl ? 'الرئيسية والشركات' : 'Dashboard & Companies',
      icon: LayoutDashboard,
      active: location.pathname === '/alumni/founder/dashboard' || location.pathname === '/alumni/founder'
    },
    {
      to: `/alumni/founder/programs?lang=${lang}`,
      label: isRtl ? 'البرامج والشهادات' : 'Programs & Certificates',
      icon: GraduationCap,
      active: location.pathname === '/alumni/founder/programs'
    },
    {
      to: `/alumni/founder/opportunities?lang=${lang}`,
      label: isRtl ? 'الفرص المتاحة' : 'Opportunities',
      icon: Sparkles,
      active: location.pathname === '/alumni/founder/opportunities'
    },
    {
      to: `/alumni/founder/notifications?lang=${lang}`,
      label: isRtl ? 'الإشعارات' : 'Notifications',
      icon: Bell,
      badge: unreadCount > 0 ? unreadCount : null,
      active: location.pathname === '/alumni/founder/notifications'
    },
    {
      to: `/alumni/founder/profile?lang=${lang}`,
      label: isRtl ? 'الملف الشخصي والشركاء' : 'Profile & Partners',
      icon: Users,
      active: location.pathname === '/alumni/founder/profile'
    },
    {
      to: `/alumni/founder/progress?lang=${lang}`,
      label: isRtl ? 'إحصائيات التقدم' : 'Progress Analytics',
      icon: TrendingUp,
      active: location.pathname === '/alumni/founder/progress'
    }
  ];

  const displayName = founder?.name_ar || founder?.name_en || authProfile?.full_name || user?.email?.split('@')[0] || 'Founder';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-manrope selection:bg-athar-yellow/30 selection:text-athar-black" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-900 text-white border-b border-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <Link to={`/alumni/founder/dashboard?lang=${lang}`} className="flex items-center gap-2.5 group">
              <div className="w-10 h-10 rounded-xl bg-athar-yellow flex items-center justify-center text-athar-black font-black shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform">
                <GraduationCap size={22} />
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold text-base tracking-tight leading-none text-white flex items-center gap-1.5">
                  Athar <span className="text-athar-yellow">Alumni</span>
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Founder
                  </span>
                </span>
                <span className="text-[10px] text-slate-400 font-medium">Founder Portal</span>
              </div>
            </Link>
          </div>

          {/* Desktop Right Actions */}
          <div className="hidden md:flex items-center gap-4">
            {/* Language Toggle */}
            <button
              onClick={toggleLang}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition-colors"
            >
              <Globe size={14} className="text-amber-400" />
              <span>{lang === 'ar' ? 'English' : 'عربي'}</span>
            </button>

            {/* Notifications Shortcut */}
            <Link
              to={`/alumni/founder/notifications?lang=${lang}`}
              className="relative p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60 transition-colors"
              title={isRtl ? 'الإشعارات' : 'Notifications'}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black flex items-center justify-center shadow-md animate-pulse">
                  {unreadCount}
                </span>
              )}
            </Link>

            {/* User Greeting & Logout */}
            <div className="flex items-center gap-3 border-s border-slate-800 ps-4">
              <Link to={`/alumni/founder/profile?lang=${lang}`} className="flex items-center gap-2 group">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 font-black text-xs flex items-center justify-center ring-2 ring-amber-400/20">
                  {displayName.substring(0, 2).toUpperCase()}
                </div>
                <div className="flex flex-col text-start">
                  <span className="text-xs font-bold text-slate-200 group-hover:text-amber-400 transition-colors max-w-[130px] truncate">
                    {displayName}
                  </span>
                  <span className="text-[10px] text-slate-400">Founder</span>
                </div>
              </Link>

              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                title={isRtl ? 'تسجيل الخروج' : 'Log out'}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>

          {/* Mobile Menu Trigger */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={toggleLang}
              className="text-xs font-bold text-slate-300 px-2.5 py-1 rounded bg-slate-800"
            >
              {lang === 'ar' ? 'EN' : 'عربي'}
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-slate-300 hover:text-white"
            >
              {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout Body: Sidebar + Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex-1 w-full py-6 flex flex-col md:flex-row gap-6">
        {/* Desktop Sidebar */}
        <aside className="hidden md:block w-64 shrink-0">
          <div className="sticky top-24 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3 space-y-1">
            <div className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
              {isRtl ? 'لوحة الفاوندر' : 'Founder Menu'}
            </div>
            {navItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <Link
                  key={idx}
                  to={item.to}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-sm transition-all ${
                    item.active
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-black'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className={item.active ? 'text-slate-950' : 'text-slate-400'} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-900 text-amber-400">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}>
            <div
              className={`fixed inset-y-0 ${isRtl ? 'right-0' : 'left-0'} w-72 bg-white p-5 shadow-2xl flex flex-col justify-between`}
              onClick={e => e.stopPropagation()}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <span className="font-extrabold text-slate-900 flex items-center gap-2">
                    <GraduationCap className="text-amber-500" size={20} />
                    Athar Founder Portal
                  </span>
                  <button onClick={() => setIsMobileMenuOpen(false)} className="text-slate-400 p-1">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-1">
                  {navItems.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={idx}
                        to={item.to}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl font-bold text-sm ${
                          item.active
                            ? 'bg-amber-500 text-slate-950 font-black'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Icon size={18} />
                          <span>{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-900 text-amber-400">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-red-600 bg-red-50 font-bold text-sm"
                >
                  <LogOut size={16} />
                  <span>{isRtl ? 'تسجيل الخروج' : 'Log out'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
