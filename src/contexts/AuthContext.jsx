import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getUserRoles, getUserProfile, updateUserProfile } from '../lib/api';

const AuthContext = createContext({});

const ROLE_PRIORITY = {
    super_admin: 4,
    project_manager: 3,
    alumni_manager: 2,
    founder: 1
};

// Safely extract a plain string[] from whatever shape the cache holds.
// getUserRoles stores: { roles: string[], timestamp: number }
// Old code stored: string[]
// This handles both + any unexpected shape.
const parseCachedRoles = (raw) => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.roles)) return parsed.roles;
    } catch {}
    return [];
};

// Guarantee that whatever comes out of getUserRoles() is always a plain string[].
const safeRoles = (value) => (Array.isArray(value) ? value : []);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadUserData = useCallback(async (authUser) => {
        if (!authUser) {
            setProfile(null);
            setRoles([]);
            return;
        }

        // Fast-path: immediately restore roles from localStorage or sessionStorage to avoid layout flashing
        const cachedRaw = sessionStorage.getItem(`user_roles_${authUser.id}`) || localStorage.getItem(`user_roles_${authUser.id}`);
        const cachedRoles = parseCachedRoles(cachedRaw);
        if (cachedRoles.length > 0) {
            setRoles(safeRoles(cachedRoles));
        }

        try {
            const timeoutPromise = new Promise((resolve) =>
                setTimeout(() => resolve('timeout'), 9000)
            );

            const fetchOnce = () => Promise.all([
                getUserRoles(authUser.id),
                getUserProfile(authUser.id)
            ]);

            // Retry once on failure before giving up
            const fetchWithRetry = fetchOnce().catch(() => {
                console.warn('[AuthContext] First fetch attempt failed, retrying...');
                return fetchOnce();
            });

            const res = await Promise.race([fetchWithRetry, timeoutPromise]);

            if (res === 'timeout') {
                console.warn('[AuthContext] loadUserData network wait exceeded, preserving cache');
                const raw = sessionStorage.getItem(`user_roles_${authUser.id}`) || localStorage.getItem(`user_roles_${authUser.id}`);
                setRoles(parseCachedRoles(raw));
                return;
            }

            const [userRoles, userProfile] = res;
            const finalRoles = safeRoles(userRoles);
            if (finalRoles.length > 0 || cachedRoles.length === 0) {
                setRoles(finalRoles);
                try {
                    localStorage.setItem(`user_roles_${authUser.id}`, JSON.stringify({ roles: finalRoles, timestamp: Date.now() }));
                } catch {}
            }
            setProfile(userProfile || {
                id: authUser.id,
                full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0],
                avatar_color: '#059669',
                avatar_url: null
            });
        } catch (err) {
            console.error('Error loading user roles/profile:', err);
            const raw = sessionStorage.getItem(`user_roles_${authUser.id}`) || localStorage.getItem(`user_roles_${authUser.id}`);
            setRoles(parseCachedRoles(raw));
        }
    }, []);

    const refreshAuth = useCallback(async () => {
        if (!user) return;
        try {
            sessionStorage.removeItem(`user_roles_${user.id}`);
            sessionStorage.removeItem(`user_profile_${user.id}`);
            localStorage.removeItem(`user_roles_${user.id}`);
        } catch {}
        await loadUserData(user);
    }, [user, loadUserData]);

    useEffect(() => {
        let mounted = true;
        let isHandled = false;

        const syncSession = async (session) => {
            const currentUser = session?.user ?? null;
            if (!mounted) return;
            setUser(currentUser);
            if (currentUser) {
                await loadUserData(currentUser);
            } else {
                setRoles([]);
                setProfile(null);
            }
            if (mounted) setLoading(false);
            isHandled = true;
        };

        const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!mounted) return;
            if (event === 'SIGNED_OUT') {
                setUser(null);
                setRoles([]);
                setProfile(null);
                if (mounted) setLoading(false);
                return;
            }
            await syncSession(session);
        });

        // Initial session retrieval if onAuthStateChange has not resolved yet
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!mounted || isHandled) return;
            syncSession(session);
        }).catch(err => {
            console.error('[AuthContext] getSession error:', err);
            if (mounted && !isHandled) setLoading(false);
        });

        return () => {
            mounted = false;
            listener?.subscription?.unsubscribe();
        };
    }, [loadUserData]);

    // roles is guaranteed to be string[] — spread is always safe.
    const primaryRole = useMemo(() => {
        if (roles.length === 0) return null;
        return [...roles].sort((a, b) => (ROLE_PRIORITY[b] || 0) - (ROLE_PRIORITY[a] || 0))[0] || roles[0];
    }, [roles]);

    const hasRole = useCallback((roleOrRoles) => {
        if (roles.length === 0) return false;
        if (roles.includes('super_admin')) return true;
        if (Array.isArray(roleOrRoles)) return roleOrRoles.some(r => roles.includes(r));
        return roles.includes(roleOrRoles);
    }, [roles]);

    const isSuperAdmin = useMemo(() => roles.includes('super_admin'), [roles]);
    const isProjectManager = useMemo(() => roles.includes('project_manager') || roles.includes('super_admin'), [roles]);
    const isAlumniManager = useMemo(() => roles.includes('alumni_manager') || roles.includes('super_admin'), [roles]);
    const isFounder = useMemo(() => roles.includes('founder') || roles.includes('super_admin'), [roles]);

    const changePassword = async (newPassword) => {
        if (!newPassword || newPassword.length < 6) {
            throw new Error('Password must be at least 6 characters long');
        }
        const { data, error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        return data;
    };

    const updateProfile = async (updates) => {
        if (!user) throw new Error('Not authenticated');
        const updated = await updateUserProfile(user.id, updates);
        setProfile(prev => ({ ...prev, ...updated }));
        return updated;
    };

    const signOut = async () => {
        try {
            if (user) {
                sessionStorage.removeItem(`user_roles_${user.id}`);
                sessionStorage.removeItem(`user_profile_${user.id}`);
                localStorage.removeItem(`user_roles_${user.id}`);
            }
        } catch {}
        setRoles([]);
        setProfile(null);
        return supabase.auth.signOut();
    };

    const value = {
        signUp: (data) => supabase.auth.signUp(data),
        signIn: (data) => supabase.auth.signInWithPassword(data),
        signOut,
        changePassword,
        updateProfile,
        refreshAuth,
        user,
        profile,
        roles,
        primaryRole,
        hasRole,
        isSuperAdmin,
        isProjectManager,
        isAlumniManager,
        isFounder,
        loading
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    return useContext(AuthContext);
};
