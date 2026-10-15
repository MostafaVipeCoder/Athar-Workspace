import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getFounderNotifications, markAllNotificationsAsRead } from '../../lib/api';
import {
  Bell, CheckCheck, Clock, Inbox, CheckCircle2,
  AlertCircle, Loader2, Sparkles
} from 'lucide-react';

export default function FounderNotificationsPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getFounderNotifications(user.id);
      setNotifications(data || []);
    } catch (err) {
      console.error('Error loading notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [user]);

  const handleMarkAllRead = async () => {
    if (!user || notifications.length === 0) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsAsRead(user.id);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Mark read error:', err);
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
        <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
        <p className="text-sm font-bold text-slate-500">
          {isRtl ? 'جاري تحميل الإشعارات...' : 'Loading notifications...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-black uppercase tracking-wider mb-3">
              <Bell size={14} />
              {isRtl ? 'صندوق الرسائل والتنبيهات' : 'Activity & Alerts'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <span>{isRtl ? 'الإشعارات' : 'Notifications'}</span>
              {unreadCount > 0 && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500 text-slate-950 font-black">
                  {unreadCount} {isRtl ? 'جديد' : 'new'}
                </span>
              )}
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-xl">
              {isRtl
                ? 'متابعة كافة التنبيهات، التحديثات، ورسائل إدارة مسرعة أثر الموجهة لشركاتك.'
                : 'Stay up to date with updates, invitations, and alerts sent by the Athar team.'}
            </p>
          </div>

          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs transition-colors shrink-0 disabled:opacity-50"
            >
              {markingAll ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={16} className="text-amber-400" />}
              <span>{isRtl ? 'تحديد الكل كمقروء' : 'Mark all as read'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100">
            <Inbox size={32} />
          </div>
          <h3 className="text-lg font-black text-slate-800 mb-1">
            {isRtl ? 'صندوق الإشعارات فارغ' : 'No notifications yet'}
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {isRtl
              ? 'عند إرسال أي تنبيه أو فرصة أو دعوة جديدة من قبل المسرعة، ستصلك الإشعارات هنا.'
              : 'You will receive notifications here regarding application status, program announcements, and updates.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notif) => {
            const isUnread = !notif.is_read;
            return (
              <div
                key={notif.id}
                className={`p-5 rounded-2xl border transition-all ${
                  isUnread
                    ? 'bg-amber-50/40 border-amber-200/80 shadow-sm'
                    : 'bg-white border-slate-200/80'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isUnread
                          ? 'bg-amber-500 text-slate-950 font-black'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Bell size={18} />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className={`text-sm ${isUnread ? 'font-black text-slate-900' : 'font-bold text-slate-700'}`}>
                          {notif.title}
                        </h3>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                        {notif.body}
                      </p>
                    </div>
                  </div>

                  <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1 shrink-0">
                    <Clock size={12} />
                    {new Date(notif.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
