import React from 'react';

export default function ActiveUsers({ users = [], maxRender = 4, className = '' }) {
  if (!users || users.length === 0) return null;

  const displayUsers = users.slice(0, maxRender);
  const excess = users.length - maxRender;

  const getInitials = (name) => {
    if (!name || typeof name !== 'string') return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex items-center -space-x-2">
        {displayUsers.filter(Boolean).map((u, i) => (
          <div
            key={u.user_id || i}
            className="group relative rounded-full ring-2 ring-white hover:z-10 transition-transform hover:scale-110 cursor-pointer"
            style={{ backgroundColor: u.avatar_color || '#1a27c9' }}
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-black tracking-wider">
              {getInitials(u.full_name)}
            </div>
            
            {/* Tooltip */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20">
              <div className="bg-slate-900 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-xl">
                {u.full_name || 'Active User'}
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45"></div>
              </div>
            </div>
          </div>
        ))}

        {excess > 0 && (
          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 text-[10px] font-black ring-2 ring-white z-0">
            +{excess}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded-full border border-emerald-100">
        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
        <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{users.length} Online</span>
      </div>
    </div>
  );
}
