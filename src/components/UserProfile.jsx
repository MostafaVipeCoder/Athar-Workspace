import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    User, Mail, Shield, Lock, LogOut, ArrowLeft,
    Check, AlertCircle, Loader2, Sparkles, Camera,
    Palette, Building2, Calendar
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ChangePasswordModal from './ChangePasswordModal';
import { ROLE_LABELS } from './UserNavDropdown';

const PRESET_AVATAR_COLORS = [
    '#059669', // Emerald
    '#2563eb', // Athar Blue
    '#7c3aed', // Violet
    '#db2777', // Pink
    '#d97706', // Amber
    '#dc2626', // Red
    '#0891b2', // Cyan
    '#475569'  // Slate
];

export default function UserProfile() {
    const { user, profile, roles, primaryRole, updateProfile, signOut } = useAuth();
    const navigate = useNavigate();

    const [fullName, setFullName] = useState('');
    const [avatarColor, setAvatarColor] = useState('#059669');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);
    const [saveError, setSaveError] = useState(null);

    useEffect(() => {
        if (profile) {
            setFullName(profile.full_name || '');
            setAvatarColor(profile.avatar_color || '#059669');
            setAvatarUrl(profile.avatar_url || '');
        } else if (user) {
            setFullName(user.user_metadata?.full_name || user.email?.split('@')[0] || '');
        }
    }, [profile, user]);

    const roleConfig = ROLE_LABELS[primaryRole] || {
        en: primaryRole || 'Member',
        ar: primaryRole || 'عضو',
        color: 'bg-muted text-muted-foreground border-border',
        icon: User
    };
    const RoleIcon = roleConfig.icon;

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveMessage(null);
        setSaveError(null);

        try {
            await updateProfile({
                full_name: fullName.trim(),
                avatar_color: avatarColor,
                avatar_url: avatarUrl.trim() || null
            });
            setSaveMessage('Profile updated successfully!');
            setTimeout(() => setSaveMessage(null), 3500);
        } catch (err) {
            console.error('Error saving profile:', err);
            setSaveError(err.message || 'Failed to update profile.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate('/login');
        } catch (err) {
            console.error('Sign out error:', err);
        }
    };

    const initials = (fullName || user?.email || 'U')
        .split(' ')
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    return (
        <div className="min-h-screen bg-background font-manrope text-foreground pb-20 relative overflow-x-hidden">
            {/* Ambient Background Glow */}
            <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-athar-blue/10 via-background to-background" />

            {/* Top Navigation */}
            <header className="relative z-20 bg-background/80 backdrop-blur-xl border-b border-border/50 sticky top-0 shadow-sm">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="flex items-center justify-center w-10 h-10 rounded-xl bg-athar-blue/10 text-athar-blue hover:bg-athar-blue hover:text-white transition-all border border-athar-blue/20 shadow-sm"
                            title="Back to Dashboard"
                        >
                            <ArrowLeft size={18} />
                        </Link>
                        <div>
                            <h1 className="text-lg font-black tracking-tight">Account & Profile</h1>
                            <p className="text-[11px] text-muted-foreground font-semibold">Manage your profile, credentials, and permissions</p>
                        </div>
                    </div>

                    <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-destructive/20 text-destructive bg-destructive/5 hover:bg-destructive/15 text-xs font-bold transition-colors"
                    >
                        <LogOut size={14} />
                        <span className="hidden sm:inline">Sign Out</span>
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
                {/* Hero Profile Banner */}
                <div className="bg-card border border-border/70 rounded-3xl p-6 sm:p-8 shadow-xl shadow-athar-blue/5 mb-8 overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-athar-blue/10 via-transparent to-transparent rounded-bl-full pointer-events-none" />

                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 relative z-10">
                        {/* Avatar Showcase */}
                        <div className="relative group shrink-0">
                            {avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt={fullName}
                                    className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover ring-4 ring-border shadow-xl"
                                />
                            ) : (
                                <div
                                    className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl text-white font-black text-3xl sm:text-4xl flex items-center justify-center shadow-xl ring-4 ring-border/80 transition-transform group-hover:scale-105"
                                    style={{ backgroundColor: avatarColor }}
                                >
                                    {initials}
                                </div>
                            )}
                            <div className="absolute -bottom-2 -right-2 p-1.5 bg-card rounded-xl border border-border shadow-md text-athar-blue">
                                <Sparkles size={16} />
                            </div>
                        </div>

                        {/* User Summary */}
                        <div className="flex-1 text-center sm:text-left min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mb-2">
                                <h2 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight truncate">
                                    {fullName || 'Welcome to Athar'}
                                </h2>
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider border shadow-sm w-fit mx-auto sm:mx-0 ${roleConfig.color}`}>
                                    <RoleIcon size={14} />
                                    <span>{roleConfig.en}</span>
                                    <span className="opacity-60 text-[10px]">({roleConfig.ar})</span>
                                </span>
                            </div>

                            <p className="text-sm font-semibold text-muted-foreground flex items-center justify-center sm:justify-start gap-2 mb-4">
                                <Mail size={15} className="shrink-0" />
                                <span>{user?.email}</span>
                            </p>

                            {/* Multi-role badges if user holds more than one role */}
                            {roles.length > 1 && (
                                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 pt-2 border-t border-border/50">
                                    <span className="text-[11px] font-bold text-muted-foreground">All Assigned Roles:</span>
                                    {roles.map(r => {
                                        const cfg = ROLE_LABELS[r];
                                        return (
                                            <span key={r} className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${cfg?.color || 'bg-muted text-muted-foreground'}`}>
                                                {cfg?.en || r}
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Feedback Alerts */}
                {saveMessage && (
                    <div className="mb-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-sm font-bold flex items-center gap-3 animate-in fade-in">
                        <Check size={18} className="shrink-0" />
                        <span>{saveMessage}</span>
                    </div>
                )}
                {saveError && (
                    <div className="mb-6 p-4 rounded-2xl bg-destructive/10 border border-destructive/30 text-destructive text-sm font-bold flex items-center gap-3 animate-in fade-in">
                        <AlertCircle size={18} className="shrink-0" />
                        <span>{saveError}</span>
                    </div>
                )}

                {/* Settings Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Left Column: Profile Details Form (2 Cols) */}
                    <div className="md:col-span-2 space-y-6">
                        <div className="bg-card border border-border/70 rounded-2xl p-6 sm:p-7 shadow-sm">
                            <h3 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
                                <User size={18} className="text-athar-blue" />
                                <span>Personal Information</span>
                            </h3>
                            <p className="text-xs text-muted-foreground mb-6">Update your display name and avatar preferences</p>

                            <form onSubmit={handleSave} className="space-y-5">
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                                        Full Name
                                    </label>
                                    <input
                                        type="text"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        placeholder="e.g. Mostafa Hassan"
                                        required
                                        className="w-full px-4 py-2.5 bg-background border border-border/70 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                                        Email Address (Read-only)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="email"
                                            value={user?.email || ''}
                                            disabled
                                            className="w-full px-4 py-2.5 bg-muted/40 border border-border/50 rounded-xl text-sm font-medium text-muted-foreground cursor-not-allowed pr-10"
                                        />
                                        <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mt-1">Managed via Supabase Authentication</p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                                        Avatar Image URL (Optional)
                                    </label>
                                    <input
                                        type="url"
                                        value={avatarUrl}
                                        onChange={(e) => setAvatarUrl(e.target.value)}
                                        placeholder="https://example.com/avatar.jpg"
                                        className="w-full px-4 py-2.5 bg-background border border-border/70 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <Palette size={14} />
                                        <span>Avatar Preset Color</span>
                                    </label>
                                    <div className="flex flex-wrap items-center gap-2.5">
                                        {PRESET_AVATAR_COLORS.map(color => (
                                            <button
                                                key={color}
                                                type="button"
                                                onClick={() => setAvatarColor(color)}
                                                className={`w-8 h-8 rounded-xl transition-all shadow-sm flex items-center justify-center ${
                                                    avatarColor === color ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'
                                                }`}
                                                style={{ backgroundColor: color }}
                                            >
                                                {avatarColor === color && <Check size={14} className="text-white drop-shadow" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-border/50 flex items-center justify-end">
                                    <button
                                        type="submit"
                                        disabled={isSaving}
                                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-athar-blue hover:bg-athar-blue/90 shadow-md shadow-athar-blue/20 transition-all disabled:opacity-50"
                                    >
                                        {isSaving && <Loader2 size={16} className="animate-spin" />}
                                        <span>{isSaving ? 'Saving Changes...' : 'Save Profile'}</span>
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    {/* Right Column: Security & Role Info (1 Col) */}
                    <div className="space-y-6">
                        {/* Security Card */}
                        <div className="bg-card border border-border/70 rounded-2xl p-6 shadow-sm">
                            <h3 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
                                <Lock size={18} className="text-amber-500" />
                                <span>Security</span>
                            </h3>
                            <p className="text-xs text-muted-foreground mb-5">Keep your account credentials safe</p>

                            <button
                                onClick={() => setShowPasswordModal(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-background hover:bg-muted font-bold text-xs transition-colors shadow-sm"
                            >
                                <Lock size={15} />
                                <span>Change Password</span>
                            </button>
                        </div>

                        {/* Role Details Card */}
                        <div className="bg-card border border-border/70 rounded-2xl p-6 shadow-sm">
                            <h3 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
                                <Shield size={18} className="text-primary" />
                                <span>Assigned Role</span>
                            </h3>
                            <p className="text-xs text-muted-foreground mb-4">Role permissions are verified on the backend</p>

                            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <RoleIcon size={16} className="text-primary" />
                                    <span className="text-xs font-black">{roleConfig.en}</span>
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    {primaryRole === 'super_admin' && 'Full administrative access across all projects, events, and the Alumni network.'}
                                    {primaryRole === 'project_manager' && 'Manage your assigned events, startups, mentors, agendas, and selection processes.'}
                                    {primaryRole === 'alumni_manager' && 'Manage the Athar Alumni platform, cohorts, invitations, and directory.'}
                                    {primaryRole === 'founder' && 'Manage your startup alumni profile, opportunities, and company information.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <ChangePasswordModal
                isOpen={showPasswordModal}
                onClose={() => setShowPasswordModal(false)}
            />
        </div>
    );
}
