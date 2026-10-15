import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getFounderProfileByAuth, getFounderPrograms, getCertificates } from '../../lib/api';
import {
  GraduationCap, Award, Calendar, Building2, CheckCircle2,
  Clock, Download, ExternalLink, Loader2, Sparkles, BookOpen
} from 'lucide-react';

export default function FounderProgramsPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  const [founder, setFounder] = useState(null);
  const [participations, setParticipations] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const f = await getFounderProfileByAuth(user.id, user.email);
        setFounder(f);

        if (f?.founder_id) {
          const [parts, certs] = await Promise.all([
            getFounderPrograms(f.founder_id),
            getCertificates(f.founder_id).catch(() => [])
          ]);
          setParticipations(parts || []);
          setCertificates(certs || []);
        }
      } catch (err) {
        console.error('Error loading founder programs:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
        <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
        <p className="text-sm font-bold text-slate-500">
          {isRtl ? 'جاري تحميل البرامج والشهادات...' : 'Loading programs & certificates...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-black uppercase tracking-wider mb-3">
            <GraduationCap size={14} />
            {isRtl ? 'المسار التدريبي والتسريع' : 'Accelerator & Programs'}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            {isRtl ? 'البرامج والشهادات' : 'Programs & Certificates'}
          </h1>
          <p className="text-slate-400 text-sm mt-1 max-w-xl">
            {isRtl
              ? 'سجل البرامج والدفعات التي شاركت بها شركاتك لدى مسرعة وحاضنة أثر، مع إمكانية استعراض وتحميل شهادات التخرج المعتمدة.'
              : 'Record of all programs and cohorts your companies participated in, with certified graduation credentials.'}
          </p>
        </div>
      </div>

      {/* Participations List */}
      {participations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100">
            <BookOpen size={32} />
          </div>
          <h3 className="text-lg font-black text-slate-800 mb-1">
            {isRtl ? 'لا توجد مشاركات مسجلة في البرامج' : 'No program participations found'}
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {isRtl
              ? 'عند انضمام شركاتك إلى إحدى دفعات أو برامج أثر، ستظهر تفاصيل البرنامج وحالة التخرج هنا تلقائياً.'
              : 'When your startups join Athar cohorts or accelerators, participation details will automatically appear here.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {participations.map((part) => {
            const programName = isRtl
              ? (part.programs?.name_ar || part.programs?.name || 'برنامج مسرعة أثر')
              : (part.programs?.name || part.programs?.name_ar || 'Athar Accelerator Program');

            const cohortName = isRtl
              ? (part.events?.event_name_ar || part.events?.event_name || 'الدفعة العامة')
              : (part.events?.event_name || part.events?.event_name_ar || 'General Cohort');

            const companyName = isRtl
              ? (part.companies?.name_ar || part.companies?.name || 'الشركة')
              : (part.companies?.name || part.companies?.name_ar || 'Company');

            // Find matching certificate
            const cert = certificates.find(c => c.program_id === part.program_id);

            const isGraduated = part.graduation_status === 'graduated';

            return (
              <div
                key={part.id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all p-6 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 font-black flex items-center justify-center shadow-sm">
                        <GraduationCap size={24} />
                      </div>
                      <div>
                        <h2 className="text-base font-black text-slate-900 leading-snug">
                          {programName}
                        </h2>
                        <span className="text-xs text-slate-500 font-bold flex items-center gap-1.5 mt-0.5">
                          <Building2 size={13} className="text-slate-400" />
                          {companyName}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider shrink-0 ${
                        isGraduated
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {isGraduated
                        ? (isRtl ? 'تم التخرج' : 'Graduated')
                        : (isRtl ? 'مستمر / نشط' : 'Active')}
                    </span>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-100 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-semibold">{isRtl ? 'الدفعة:' : 'Cohort:'}</span>
                      <span className="font-bold text-slate-800">{cohortName}</span>
                    </div>

                    {part.start_date && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-semibold">{isRtl ? 'فترة المشاركة:' : 'Period:'}</span>
                        <span className="font-bold text-slate-800">
                          {part.start_date} {part.end_date ? `— ${part.end_date}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Certificate Action */}
                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                  {cert?.pdf_url ? (
                    <a
                      href={cert.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md transition-all active:scale-95"
                    >
                      <Download size={14} />
                      <span>{isRtl ? 'تحميل الشهادة' : 'Download Certificate'}</span>
                    </a>
                  ) : isGraduated ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                      <CheckCircle2 size={15} />
                      <span>{isRtl ? 'خريج معتمد (تواصل للحصول على الـ PDF)' : 'Certified Graduate'}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400">
                      <Clock size={14} />
                      <span>{isRtl ? 'الشهادة تصدر عند إتمام التخرج' : 'Certificate issued upon graduation'}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
