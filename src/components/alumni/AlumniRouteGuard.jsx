import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export default function AlumniRouteGuard({ children, requireAdmin = false }) {
  const { user, roles, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 size={32} className="animate-spin text-amber-500" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/alumni/login" state={{ from: location }} replace />;
  }

  const userRoles = roles || [];
  const isSuperAdmin = userRoles.includes('super_admin');
  const isAlumniManager = userRoles.includes('alumni_manager');
  const isFounder = userRoles.includes('founder');

  const pathname = location.pathname.replace(/\/+$/, '');

  // 1. Root redirect (/alumni or /alumni/)
  if (pathname === '/alumni') {
    if (isSuperAdmin || isAlumniManager) {
      return <Navigate to="/alumni/admin/dashboard" replace />;
    }
    return <Navigate to="/alumni/founder/dashboard" replace />;
  }

  // 2. Super admin has full access to both portals
  if (isSuperAdmin) {
    return children;
  }

  // 3. Manager routes (/alumni/admin/*)
  if (pathname.startsWith('/alumni/admin') || requireAdmin) {
    if (!isAlumniManager) {
      // If founder tries to access manager routes, redirect to founder portal
      return <Navigate to="/alumni/founder/dashboard" replace />;
    }
    return children;
  }

  // 4. Founder routes (/alumni/founder/*)
  if (pathname.startsWith('/alumni/founder')) {
    if (!isFounder && isAlumniManager) {
      // If manager tries to access founder routes, redirect to manager portal
      return <Navigate to="/alumni/admin/dashboard" replace />;
    }
    return children;
  }

  return children;
}
