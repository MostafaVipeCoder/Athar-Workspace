import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { TrendingUp, Award, Clock, CheckCircle2, Star } from 'lucide-react';

export default function FounderProgressPage() {
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  const milestones = [
    { key: 'signup',     labelAr: 'إنشاء الحساب',          labelEn: 'Account Created',         done: true },
    { key: 'profile',    labelAr: 'إكمال الملف الشخصي',    labelEn: 'Profile Completed',        done: true },
    { key: 'company',    labelAr: 'إضافة بيانات الشركة',   labelEn: 'Company Details Added',    done: false },
    { key: 'programs',   labelAr: 'الانضمام لبرنامج',      labelEn: 'Joined a Program',         done: false },
    { key: 'opportunity',labelAr: 'نشر فرصة',              labelEn: 'Posted an Opportunity',    done: false },
  ];

  const doneCount = milestones.filter(m => m.done).length;
  const progress = Math.round((doneCount / milestones.length) * 100);

  return (
    <div className="space-y-8 animate-in fade-in duration-300" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-200/60 rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-amber-500 text-slate-950 rounded-2xl">
            <TrendingUp size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">
              {isRtl ? 'مسار تقدمك' : 'Your Progress'}
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              {isRtl ? 'تتبع رحلتك كمؤسس في منصة خريجي أثر' : 'Track your journey as a founder in the Athar Alumni Platform'}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              {isRtl ? `${doneCount} من ${milestones.length} مراحل مكتملة` : `${doneCount} of ${milestones.length} milestones completed`}
            </span>
            <span className="text-sm font-black text-amber-600">{progress}%</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-sm space-y-4">
        <h2 className="text-base font-black text-slate-900 flex items-center gap-2 pb-3 border-b border-slate-100">
          <Award size={18} className="text-amber-500" />
          <span>{isRtl ? 'المراحل الرئيسية' : 'Key Milestones'}</span>
        </h2>

        <div className="space-y-3">
          {milestones.map((m, i) => (
            <div
              key={m.key}
              className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                m.done
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-slate-50 border-slate-100'
              }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${
                m.done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {m.done ? <CheckCircle2 size={18} /> : <span>{i + 1}</span>}
              </div>
              <div className="flex-1">
                <p className={`text-sm font-bold ${m.done ? 'text-emerald-800' : 'text-slate-600'}`}>
                  {isRtl ? m.labelAr : m.labelEn}
                </p>
              </div>
              {m.done && (
                <Star size={15} className="text-amber-400 shrink-0" fill="currentColor" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Coming Soon */}
      <div className="bg-slate-50 border border-slate-200/60 rounded-3xl p-6 text-center space-y-2">
        <Clock size={28} className="text-slate-300 mx-auto" />
        <p className="text-sm font-bold text-slate-400">
          {isRtl ? 'المزيد من إحصائيات التقدم قادمة قريباً' : 'More progress analytics coming soon'}
        </p>
      </div>
    </div>
  );
}
