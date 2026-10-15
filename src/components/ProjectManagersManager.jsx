import React, { useState, useEffect, useCallback } from 'react';
import {
    Users, Plus, Trash2, Shield, AlertCircle,
    Check, X, Loader2, UserCheck, Crown
} from 'lucide-react';
import {
    getProjectManagers,
    assignProjectManager,
    removeProjectManager,
    updateProjectManagerRole,
    getAllEligibleProjectManagers
} from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export default function ProjectManagersManager({ eventId, eventName }) {
    const { user, isSuperAdmin } = useAuth();
    const [managers, setManagers] = useState([]);
    const [eligibleUsers, setEligibleUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [selectedRole, setSelectedRole] = useState('collaborator');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [actionError, setActionError] = useState(null);
    const [actionSuccess, setActionSuccess] = useState(null);

    const loadManagers = useCallback(async () => {
        if (!eventId) return;
        setLoading(true);
        try {
            const data = await getProjectManagers(eventId);
            setManagers(data || []);
        } catch (err) {
            console.error('Error loading project managers:', err);
        } finally {
            setLoading(false);
        }
    }, [eventId]);

    const loadEligible = async () => {
        try {
            const data = await getAllEligibleProjectManagers();
            setEligibleUsers(data || []);
        } catch (err) {
            console.error('Error loading eligible PMs:', err);
        }
    };

    useEffect(() => {
        if (isSuperAdmin) {
            loadManagers();
        }
    }, [isSuperAdmin, loadManagers]);

    // Only visible to Super Admin
    if (!isSuperAdmin) return null;

    const handleOpenAddModal = async () => {
        setSelectedUserId('');
        setSelectedRole('collaborator');
        setActionError(null);
        await loadEligible();
        setShowAddModal(true);
    };

    const handleAssign = async (e) => {
        e.preventDefault();
        if (!selectedUserId) {
            setActionError('Please select a project manager to add.');
            return;
        }

        setIsSubmitting(true);
        setActionError(null);

        try {
            await assignProjectManager({
                eventId,
                userId: selectedUserId,
                roleInProject: selectedRole,
                assignedBy: user?.id
            });

            setActionSuccess('Project manager assigned successfully!');
            setTimeout(() => setActionSuccess(null), 3000);
            setShowAddModal(false);
            await loadManagers();
        } catch (err) {
            console.error('Assign error:', err);
            setActionError(err.message || 'Failed to assign project manager.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRemove = async (managerUserId, managerName) => {
        if (!window.confirm(`Are you sure you want to remove "${managerName || 'this manager'}" from this project?`)) {
            return;
        }

        try {
            await removeProjectManager(eventId, managerUserId);
            setActionSuccess('Project manager removed.');
            setTimeout(() => setActionSuccess(null), 3000);
            await loadManagers();
        } catch (err) {
            console.error('Remove error:', err);
            alert('Failed to remove project manager: ' + err.message);
        }
    };

    const handleToggleRole = async (manager) => {
        const nextRole = manager.role_in_project === 'owner' ? 'collaborator' : 'owner';
        try {
            await updateProjectManagerRole({
                eventId,
                userId: manager.user_id,
                roleInProject: nextRole
            });
            await loadManagers();
        } catch (err) {
            console.error('Role update error:', err);
            alert('Failed to update role: ' + err.message);
        }
    };

    // Filter out already assigned managers from eligible list
    const assignedUserIds = new Set(managers.map(m => m.user_id));
    const availableUsers = eligibleUsers.filter(u => !assignedUserIds.has(u.id));

    return (
        <div className="bg-card border border-border/80 rounded-2xl p-5 sm:p-6 shadow-sm mb-6 font-manrope">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-border/50">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-athar-blue/10 text-athar-blue flex items-center justify-center border border-athar-blue/20">
                        <Users size={18} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-foreground">Project Managers</h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                Super Admin Only
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground">Manage which team members can administer this project</p>
                    </div>
                </div>

                <button
                    onClick={handleOpenAddModal}
                    className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-athar-blue hover:bg-athar-blue/90 shadow-sm shadow-athar-blue/20 transition-all self-start sm:self-auto"
                >
                    <Plus size={15} />
                    <span>Add Project Manager</span>
                </button>
            </div>

            {/* Notification messages */}
            {actionSuccess && (
                <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-2 animate-in fade-in">
                    <Check size={16} />
                    <span>{actionSuccess}</span>
                </div>
            )}

            {/* Managers List */}
            {loading ? (
                <div className="py-8 flex flex-col items-center justify-center text-muted-foreground">
                    <Loader2 size={24} className="animate-spin mb-2 text-athar-blue" />
                    <p className="text-xs font-semibold">Loading project managers...</p>
                </div>
            ) : managers.length === 0 ? (
                <div className="py-8 text-center bg-muted/20 rounded-xl border border-dashed border-border/70 p-6">
                    <div className="w-12 h-12 rounded-xl bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-3">
                        <UserCheck size={22} />
                    </div>
                    <p className="text-sm font-bold text-foreground mb-1">No Dedicated Project Managers Assigned</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
                        All Super Admins can access this project by default. Add Project Managers to grant them access to this project.
                    </p>
                    <button
                        onClick={handleOpenAddModal}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-athar-blue bg-athar-blue/10 hover:bg-athar-blue/20 transition-colors"
                    >
                        <Plus size={14} />
                        <span>Assign First Manager</span>
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {managers.map(mgr => {
                        const profile = mgr.profile;
                        const name = profile?.full_name || 'Manager';
                        const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
                        const isOwner = mgr.role_in_project === 'owner';

                        return (
                            <div
                                key={mgr.id}
                                className="flex items-center justify-between p-3.5 rounded-xl border border-border/70 bg-card hover:border-athar-blue/30 transition-all shadow-sm group"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    {profile?.avatar_url ? (
                                        <img
                                            src={profile.avatar_url}
                                            alt={name}
                                            className="w-10 h-10 rounded-xl object-cover ring-1 ring-border shrink-0"
                                        />
                                    ) : (
                                        <div
                                            className="w-10 h-10 rounded-xl text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm"
                                            style={{ backgroundColor: profile?.avatar_color || '#2563eb' }}
                                        >
                                            {initials}
                                        </div>
                                    )}

                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-foreground truncate">{name}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <button
                                                onClick={() => handleToggleRole(mgr)}
                                                title="Click to toggle Owner / Collaborator"
                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide border transition-all ${
                                                    isOwner
                                                        ? 'bg-amber-500/10 text-amber-600 border-amber-500/30 hover:bg-amber-500/20'
                                                        : 'bg-athar-blue/10 text-athar-blue border-athar-blue/30 hover:bg-athar-blue/20'
                                                }`}
                                            >
                                                {isOwner ? <Crown size={10} /> : <Shield size={10} />}
                                                <span>{mgr.role_in_project}</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={() => handleRemove(mgr.user_id, name)}
                                    className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors ml-2"
                                    title="Remove Manager"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add PM Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="relative w-full max-w-md bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden p-6 text-foreground font-manrope">
                        <button
                            onClick={() => setShowAddModal(false)}
                            className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-xl transition-colors"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex items-center gap-3 mb-5">
                            <div className="w-10 h-10 rounded-xl bg-athar-blue/10 text-athar-blue flex items-center justify-center border border-athar-blue/20">
                                <Users size={18} />
                            </div>
                            <div>
                                <h3 className="text-base font-bold">Assign Project Manager</h3>
                                <p className="text-xs text-muted-foreground">Select a registered user to manage this project</p>
                            </div>
                        </div>

                        {actionError && (
                            <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
                                <AlertCircle size={15} className="shrink-0" />
                                <span>{actionError}</span>
                            </div>
                        )}

                        <form onSubmit={handleAssign} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                                    Select Team Member
                                </label>
                                {availableUsers.length === 0 ? (
                                    <p className="text-xs text-muted-foreground p-3 rounded-xl bg-muted/40 border border-border">
                                        No unassigned project managers found. All eligible users are already assigned or no users have the project_manager role.
                                    </p>
                                ) : (
                                    <select
                                        value={selectedUserId}
                                        onChange={(e) => setSelectedUserId(e.target.value)}
                                        required
                                        className="w-full px-3.5 py-2.5 bg-background border border-border/70 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all"
                                    >
                                        <option value="">-- Choose a manager --</option>
                                        {availableUsers.map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.full_name} ({u.roles?.join(', ') || 'user'})
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                                    Project Role
                                </label>
                                <select
                                    value={selectedRole}
                                    onChange={(e) => setSelectedRole(e.target.value)}
                                    className="w-full px-3.5 py-2.5 bg-background border border-border/70 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-athar-blue focus:border-transparent transition-all"
                                >
                                    <option value="collaborator">Collaborator (Standard Manager)</option>
                                    <option value="owner">Owner (Can manage other PMs)</option>
                                </select>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/50">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    disabled={isSubmitting}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted/70 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting || availableUsers.length === 0}
                                    className="flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-athar-blue hover:bg-athar-blue/90 shadow-md shadow-athar-blue/20 transition-all disabled:opacity-50"
                                >
                                    {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                                    <span>{isSubmitting ? 'Assigning...' : 'Assign Manager'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
