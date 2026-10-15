import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getOpportunities, getFounderProfileByAuth,
  applyToOpportunity
} from '../../lib/api';
import {
  Sparkles, Calendar, DollarSign, ExternalLink,
  CheckCircle2, AlertCircle, Loader2, ArrowUpRight,
  Filter, Tag, Clock
} from 'lucide-react';

const TYPE_CONFIG = {
  grant: { labelAr: 'منحة مالية', labelEn: 'Grant', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  investment: { labelAr: 'فرصة استثمار', labelEn: 'Investment', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  competition: { labelAr: 'مسابقة وجوائز', labelEn: 'Competition', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  event: { labelAr: 'فعالية ومؤتمر', labelEn: 'Event', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  partnership: { labelAr: 'شراكة استراتيجية', labelEn: 'Partnership', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' }
};

export default function FounderOpportunitiesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  const [founder, setFounder] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [selectedType, setSelectedType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState(null);
  const [applyMessage, setApplyMessage] = useState(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const [f, opps] = await Promise.all([
          getFounderProfileByAuth(user.id, user.email),
          getOpportunities()
        ]);
        setFounder(f);
        setOpportunities(opps || []);
      } catch (err) {
        console.error('Error loading opportunities:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleApply = async (opp) => {
    const primaryCompany = founder?.company_founders?.[0]?.company_id;
    if (!primaryCompany) {
      alert(isRtl ? 'يجب تسجيل شركة واحدة على الأقل قبل التقديم' : 'You must register a company first');
      return;
    }

    if (opp.link) {
      window.open(opp.link, '_blank', 'noopener,noreferrer');
      return;
    }

    setApplyingId(opp.opportunity_id);
    try {
      await applyToOpportunity({
        opportunityId: opp.opportunity_id,
        companyId: primaryCompany,
        founderId: founder?.founder_id
      });
      setApplyMessage({ id: opp.opportunity_id, text: isRtl ? 'تم إرسال طلب التقديم بنجاح!' : 'Application submitted successfully!' });
      setTimeout(() => setApplyMessage(null), 3000);
    } catch (err) {
      console.error('Apply error:', err);
      alert(err.message || (isRtl ? 'حدث خطأ أثناء التقديم' : 'Failed to apply'));
    } finally {
      setApplyingId(null);
    }
  };

  const filteredOpps = opportunities.filter(opp => {
    if (selectedType !== 'all' && opp.type !== selectedType) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
        <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
        <p className="text-sm font-bold text-slate-500">
          {isRtl ? 'جاري تحميل الفرص المتاحة...' : 'Loading opportunities...'}
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
            <Sparkles size={14} />
            {isRtl ? 'فرص التمويل والشراكات' : 'Funding & Partnerships'}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            {isRtl ? 'الفرص المتاحة' : 'Opportunities Hub'}
          </h1>
          <p className="text-slate-400 text-sm mt-1 max-w-xl">
            {isRtl
              ? 'فرص حصرية للشركات المتخرجة والملتحقة بمسرعة أثر: منح، جولات استثمارية، مسابقات وشراكات استراتيجية.'
              : 'Exclusive funding grants, investment rounds, and corporate partnerships curated for Athar Alumni.'}
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button
          onClick={() => setSelectedType('all')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 ${
            selectedType === 'all'
              ? 'bg-slate-900 text-white shadow-md'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          {isRtl ? 'جميع الفرص' : 'All Types'} ({opportunities.length})
        </button>
        {Object.entries(TYPE_CONFIG).map(([typeKey, cfg]) => {
          const count = opportunities.filter(o => o.type === typeKey).length;
          return (
            <button
              key={typeKey}
              onClick={() => setSelectedType(typeKey)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 ${
                selectedType === typeKey
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {isRtl ? cfg.labelAr : cfg.labelEn} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      {/* Opportunities Grid */}
      {filteredOpps.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100">
            <Sparkles size={32} />
          </div>
          <h3 className="text-lg font-black text-slate-800 mb-1">
            {isRtl ? 'لا توجد فرص مطابقة حالياً' : 'No opportunities available'}
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {isRtl
              ? 'يتم نشر الفرص الجديدة باستمرار بواسطة فريق إدارة مسرعة أثر، يرجى المتابعة لاحقاً.'
              : 'New grant rounds and investment opportunities are added frequently by the Athar Team.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredOpps.map((opp) => {
            const typeConfig = TYPE_CONFIG[opp.type] || {
              labelAr: opp.type,
              labelEn: opp.type,
              color: 'bg-slate-100 text-slate-700 border-slate-200'
            };

            const title = isRtl ? (opp.title_ar || opp.title_en) : (opp.title_en || opp.title_ar);
            const desc = isRtl ? (opp.description_ar || opp.description_en) : (opp.description_en || opp.description_ar);

            return (
              <div
                key={opp.opportunity_id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all p-6 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider border ${typeConfig.color}`}>
                      {isRtl ? typeConfig.labelAr : typeConfig.labelEn}
                    </span>

                    {opp.deadline && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                        <Clock size={12} />
                        {opp.deadline}
                      </span>
                    )}
                  </div>

                  <div>
                    <h2 className="text-base font-black text-slate-900 leading-snug line-clamp-2">
                      {title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-2 line-clamp-3 leading-relaxed">
                      {desc || (isRtl ? 'لا يوجد وصف متاح' : 'No description provided')}
                    </p>
                  </div>

                  {opp.eligibility && (
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
                      <strong className="text-slate-800 font-bold block mb-0.5">
                        {isRtl ? 'شروط الأهلية:' : 'Eligibility:'}
                      </strong>
                      <span className="line-clamp-2">{opp.eligibility}</span>
                    </div>
                  )}
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100">
                  {applyMessage?.id === opp.opportunity_id ? (
                    <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold text-center flex items-center justify-center gap-1.5">
                      <CheckCircle2 size={15} />
                      <span>{applyMessage.text}</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleApply(opp)}
                      disabled={applyingId === opp.opportunity_id}
                      className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50"
                    >
                      {applyingId === opp.opportunity_id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : opp.link ? (
                        <ExternalLink size={14} className="text-amber-400" />
                      ) : (
                        <ArrowUpRight size={14} className="text-amber-400" />
                      )}
                      <span>
                        {opp.link
                          ? (isRtl ? 'رابط التقديم الخارجي' : 'External Application')
                          : (isRtl ? 'التقديم الآن' : 'Apply Now')}
                      </span>
                    </button>
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
