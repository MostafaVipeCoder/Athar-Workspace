import React, { useState } from 'react';
import { X, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function ChangePasswordModal({ isOpen, onClose }) {
    const { changePassword } = useAuth();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            await changePassword(newPassword);
            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                setNewPassword('');
                setConfirmPassword('');
                onClose();
            }, 1600);
        } catch (err) {
            console.error('Password change error:', err);
            setError(err.message || 'Failed to update password. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        if (loading) return;
        setError(null);
        setSuccess(false);
        setNewPassword('');
        setConfirmPassword('');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-md bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden p-6 text-foreground font-manrope">
                <button
                    onClick={handleClose}
                    disabled={loading}
                    className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-xl transition-colors"
                >
                    <X size={18} />
                </button>

                <div className="flex items-center gap-3 mb-5">
                    <div className="w-11 h-11 rounded-xl bg-athar-blue/10 text-athar-blue flex items-center justify-center border border-athar-blue/20">
                        <Lock size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold">Change Password</h3>
                        <p className="text-xs text-muted-foreground">Enter a new secure password for your account</p>
                    </div>
                </div>

                {success ? (
                    <div className="py-6 flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-200">
                        <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3 border border-emerald-500/20">
                            <CheckCircle2 size={32} />
                        </div>
                        <h4 className="text-base font-bold text-foreground">Password Updated!</h4>
                        <p className="text-xs text-muted-foreground mt-1">Your password has been changed successfully.</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold animate-in fade-in">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                                New Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="At least 6 characters"
                                    required
                                    minLength={6}
                                    disabled={loading}
                                    className="w-full px-3.5 py-2.5 bg-background border border-border/70 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                                Confirm New Password
                            </label>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Re-enter new password"
                                required
                                minLength={6}
                                disabled={loading}
                                className="w-full px-3.5 py-2.5 bg-background border border-border/70 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all"
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/50">
                            <button
                                type="button"
                                onClick={handleClose}
                                disabled={loading}
                                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-athar-blue hover:bg-athar-blue/90 shadow-md shadow-athar-blue/20 transition-all disabled:opacity-50"
                            >
                                {loading && <Loader2 size={14} className="animate-spin" />}
                                <span>{loading ? 'Updating...' : 'Update Password'}</span>
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
