import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export default function RoleGuard({ children, allowedRoles = [] }) {
    const { user, roles, primaryRole, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 font-manrope">
                <div className="relative">
                    <div className="w-12 h-12 border-4 border-athar-blue/20 border-t-athar-blue rounded-full animate-spin"></div>
                    <Loader2 className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-athar-blue animate-pulse" size={20} />
                </div>
            </div>
        );
    }

    const isAlumniPath = location.pathname.startsWith('/alumni');

    // 1. Unauthenticated users
    if (!user) {
        const loginTarget = isAlumniPath ? '/alumni/login' : '/login';
        return <Navigate to={loginTarget} state={{ from: location }} replace />;
    }

    // 2. Super Admin always bypasses all role guards
    if (roles.includes('super_admin')) {
        return children;
    }

    const isFounderPath = location.pathname.startsWith('/alumni/founder');
    const isManagerPath = location.pathname.startsWith('/alumni/admin');

    // 3. Founder attempting to access admin/manager route or main platform
    if (primaryRole === 'founder') {
        if (isManagerPath || !isAlumniPath) {
            return <Navigate to="/alumni/founder/dashboard" replace />;
        }
    }

    // 4. Alumni Manager attempting to access founder route or main platform
    if (primaryRole === 'alumni_manager') {
        if (isFounderPath || !isAlumniPath) {
            return <Navigate to="/alumni/admin/dashboard" replace />;
        }
    }

    // 5. If specific allowedRoles are given, verify membership
    if (allowedRoles && allowedRoles.length > 0) {
        const hasPermission = allowedRoles.some(r => roles.includes(r));
        if (!hasPermission) {
            // Unauthorized redirect based on role
            if (roles.includes('founder')) {
                return <Navigate to="/alumni/founder/dashboard" replace />;
            }
            if (roles.includes('alumni_manager')) {
                return <Navigate to="/alumni/admin/dashboard" replace />;
            }
            if (roles.includes('project_manager')) {
                return <Navigate to="/" replace />;
            }
            return <Navigate to="/" replace />;
        }
    }

    return children;
}
