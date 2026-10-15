import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Lock, LogOut, ChevronDown, ShieldCheck, Briefcase, GraduationCap, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ChangePasswordModal from './ChangePasswordModal';

export const ROLE_LABELS = {
    super_admin: {
        en: 'Super Admin',
        ar: 'مدير النظام',
        color: 'bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-400/10 dark:text-amber-300',
        icon: ShieldCheck
    },
    project_manager: {
        en: 'Project Manager',
        ar: 'مدير المشروعات',
        color: 'bg-athar-blue/10 text-athar-blue border-athar-blue/30 dark:bg-athar-blue/20 dark:text-blue-300',
        icon: Briefcase
    },
    alumni_manager: {
        en: 'Alumni Manager',
        ar: 'مسؤول الخريجين',
        color: 'bg-purple-500/10 text-purple-600 border-purple-500/30 dark:bg-purple-400/10 dark:text-purple-300',
        icon: GraduationCap
    },
    founder: {
        en: 'Founder',
        ar: 'مؤسس',
        color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:bg-emerald-400/10 dark:text-emerald-300',
        icon: Sparkles
    }
};

export default function UserNavDropdown({ compact = false, className = '' }) {
    const { user, profile, primaryRole, roles, signOut } = useAuth();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        const handler = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (!user) return null;

    const roleConfig = ROLE_LABELS[primaryRole] || {
        en: primaryRole || 'Member',
        ar: primaryRole || 'عضو',
        color: 'bg-muted text-muted-foreground border-border',
        icon: User
    };
    const RoleIcon = roleConfig.icon;

    const displayName = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
    const initials = displayName
        .split(' ')
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
    const avatarColor = profile?.avatar_color || '#059669';

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate('/login');
        } catch (err) {
            console.error('Sign out error:', err);
        }
    };

    return (
        <>
            <div className={`relative ${className}`} ref={menuRef}>
                <button
                    onClick={() => setOpen(!open)}
                    className="flex items-center gap-2.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border border-border/60 bg-card hover:bg-muted/50 hover:border-athar-blue/30 transition-all text-foreground group text-left shadow-sm tap-target"
                    title={displayName}
                >
                    {/* Avatar */}
                    {profile?.avatar_url ? (
                        <img
                            src={profile.avatar_url}
                            alt={displayName}
                            className="w-8 h-8 rounded-lg object-cover ring-1 ring-border shrink-0 shadow-sm"
                        />
                    ) : (
                        <div
                            className="w-8 h-8 rounded-lg text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105"
                            style={{ backgroundColor: avatarColor }}
                        >
                            {initials}
                        </div>
                    )}

                    {!compact && (
                        <div className="hidden md:flex flex-col min-w-0 max-w-[130px]">
                            <span className="text-xs font-bold truncate leading-tight">
                                {displayName}
                            </span>
                            <div className="flex items-center gap-1 mt-0.5">
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase tracking-wide border ${roleConfig.color}`}>
                                    <RoleIcon size={10} className="shrink-0" />
                                    <span className="truncate">{roleConfig.en}</span>
                                </span>
                            </div>
                        </div>
                    )}

                    <ChevronDown
                        size={14}
                        className={`text-muted-foreground transition-transform duration-200 shrink-0 ${open ? 'rotate-180 text-foreground' : ''}`}
                    />
                </button>

                {/* Dropdown Menu */}
                {open && (
                    <div className="absolute right-0 top-full mt-2 w-60 bg-card border border-border/80 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150 font-manrope">
                        {/* User Summary Header */}
                        <div className="px-3 py-2.5 border-b border-border/50 mb-1">
                            <p className="text-xs font-bold text-foreground truncate">{displayName}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                            <div className="mt-2 flex items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${roleConfig.color}`}>
                                    <RoleIcon size={11} />
                                    <span>{roleConfig.en}</span>
                                </span>
                            </div>
                        </div>

                        {/* Navigation Items */}
                        <div className="space-y-0.5">
                            {(primaryRole === 'founder' || (roles || []).includes('founder')) && (
                                <Link
                                    to="/alumni/founder/dashboard"
                                    onClick={() => setOpen(false)}
                                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs font-bold text-foreground hover:bg-emerald-500/10 hover:text-emerald-600 transition-colors"
                                >
                                    <Sparkles size={15} />
                                    <span>Founder Portal / بوابة الرواد</span>
                                </Link>
                            )}

                            {(primaryRole === 'alumni_manager' || (roles || []).includes('alumni_manager') || (roles || []).includes('super_admin')) && (
                                <Link
                                    to="/alumni/admin/dashboard"
                                    onClick={() => setOpen(false)}
                                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs font-bold text-foreground hover:bg-purple-500/10 hover:text-purple-600 transition-colors"
                                >
                                    <GraduationCap size={15} />
                                    <span>Alumni Portal / بوابة الخريجين</span>
                                </Link>
                            )}

                            <Link
                                to="/profile"
                                onClick={() => setOpen(false)}
                                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs font-bold text-foreground hover:bg-athar-blue/10 hover:text-athar-blue transition-colors"
                            >
                                <User size={15} />
                                <span>Profile / الملف الشخصي</span>
                            </Link>

                            <button
                                onClick={() => {
                                    setOpen(false);
                                    setShowPasswordModal(true);
                                }}
                                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs font-bold text-foreground hover:bg-muted/70 transition-colors text-left"
                            >
                                <Lock size={15} />
                                <span>Change Password / تغيير كلمة المرور</span>
                            </button>
                        </div>

                        <div className="h-px bg-border/50 my-1.5" />

                        {/* Sign Out */}
                        <button
                            onClick={handleSignOut}
                            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs font-bold text-destructive hover:bg-destructive/10 transition-colors text-left"
                        >
                            <LogOut size={15} />
                            <span>Sign Out / تسجيل الخروج</span>
                        </button>
                    </div>
                )}
            </div>

            <ChangePasswordModal
                isOpen={showPasswordModal}
                onClose={() => setShowPasswordModal(false)}
            />
        </>
    );
}
