import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, Award, Calendar, Building2, User, CheckCircle2,
  AlertCircle, Search, ArrowLeft, ExternalLink, Download
} from 'lucide-react';
import { verifyCertificate } from '../../lib/api';

export default function CertificateVerifier() {
  const { code: routeCode } = useParams();
  const navigate = useNavigate();
  const [searchCode, setSearchCode] = useState(routeCode || '');
  const [cert, setCert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (routeCode) {
      handleVerify(routeCode);
    }
  }, [routeCode]);

  const handleVerify = async (codeToVerify) => {
    if (!codeToVerify?.trim()) return;
    try {
      setLoading(true);
      setError(null);
      setSearched(true);
      const data = await verifyCertificate(codeToVerify.trim());
      if (!data) {
        setError('لم يتم العثور على شهادة بهذا الرمز. تأكد من إدخال الرمز بشكل صحيح.');
        setCert(null);
      } else {
        setCert(data);
      }
    } catch (err) {
      console.error('Error verifying certificate:', err);
      setError('حدث خطأ أثناء التحقق من الشهادة. يرجى المحاولة لاحقاً.');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (searchCode) {
      navigate(`/verify-certificate/${searchCode.trim()}`);
      handleVerify(searchCode);
    }
  };

  return (
    <div className="min-h-screen bg-background font-manrope text-foreground flex flex-col justify-between" dir="rtl">
      {/* Background radial accent */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-athar-blue/10 via-background to-background" />

      {/* Header */}
      <header className="relative z-10 border-b border-border/50 bg-background/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-athar-blue text-white p-2 rounded-xl shadow-md">
              <Award size={20} />
            </div>
            <div>
              <h1 className="text-base font-black text-foreground">بوابة التحقق من الشهادات والاعتمادات</h1>
              <p className="text-[10px] text-muted-foreground font-semibold">منصة أثر لبرامج ريادة الأعمال</p>
            </div>
          </div>

          <Link
            to="/alumni"
            className="text-xs font-bold text-muted-foreground hover:text-athar-blue flex items-center gap-1"
          >
            <span>دليل الخريجين</span>
            <ArrowLeft size={14} />
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 max-w-2xl mx-auto px-4 py-12 w-full space-y-8 flex-1">
        {/* Search input box */}
        <div className="bg-card border border-border/60 rounded-3xl p-6 sm:p-8 shadow-sm space-y-4">
          <div className="text-center space-y-1">
            <h2 className="text-xl sm:text-2xl font-black text-foreground">التحقق من صحة الشهادة</h2>
            <p className="text-xs text-muted-foreground font-medium">
              أدخل رمز التحقق المكتوب على الشهادة (Verification Code) للتأكد من صحتها واعتمادها من أثر.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              type="text"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              placeholder="مثال: a1b2c3d4e5f6"
              className="flex-1 px-4 py-3 bg-muted/50 border border-border rounded-2xl text-sm font-mono font-bold focus:outline-none focus:border-athar-blue"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-athar-blue text-white rounded-2xl text-xs font-black shadow-lg shadow-athar-blue/20 hover:bg-athar-blue/90 transition-all shrink-0"
            >
              {loading ? '...' : 'تحقق الآن'}
            </button>
          </form>
        </div>

        {/* Verification Result Card */}
        {cert && (
          <div className="bg-card border-2 border-emerald-500/30 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6 relative overflow-hidden animate-in fade-in zoom-in-95">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-emerald-500/10 to-transparent rounded-bl-full pointer-events-none" />

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-emerald-600 font-black text-sm bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                <ShieldCheck size={18} />
                <span>شهادة معتمدة وموثقة رسمياً</span>
              </div>
              <span className="text-xs font-mono font-bold text-muted-foreground">
                #{cert.verification_code}
              </span>
            </div>

            <div className="space-y-4 pt-2">
              <div>
                <span className="text-[11px] text-muted-foreground font-bold block mb-1">اسم المؤسس / الخريج</span>
                <div className="text-xl font-black text-foreground">
                  {cert.founders?.name_ar || cert.founders?.name_en}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-muted/30 p-4 rounded-2xl border border-border/40">
                <div>
                  <span className="text-[11px] text-muted-foreground font-bold block mb-1">البرنامج</span>
                  <div className="text-sm font-bold text-foreground">
                    {cert.programs?.name_ar || cert.programs?.name || 'برنامج أثر'}
                  </div>
                </div>

                {cert.events && (
                  <div>
                    <span className="text-[11px] text-muted-foreground font-bold block mb-1">الدفعة / المشروع</span>
                    <div className="text-sm font-bold text-foreground">
                      {cert.events.event_name_ar || cert.events.event_name}
                    </div>
                  </div>
                )}

                <div>
                  <span className="text-[11px] text-muted-foreground font-bold block mb-1">تاريخ الإصدار</span>
                  <div className="text-sm font-bold text-foreground">
                    {cert.issue_date}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground font-bold block mb-1">الجهة المصدرة</span>
                  <div className="text-sm font-bold text-foreground">
                    {cert.issued_by || 'Athar Acceleration Ecosystem'}
                  </div>
                </div>
              </div>
            </div>

            {cert.pdf_url && (
              <div className="pt-2 flex justify-end">
                <a
                  href={cert.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  <Download size={14} />
                  <span>تحميل النسخة الرقمية (PDF)</span>
                </a>
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {searched && error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl p-6 text-center space-y-2">
            <AlertCircle size={28} className="mx-auto" />
            <p className="text-xs font-bold">{error}</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/50 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Athar Entrepreneurship Ecosystem. All rights reserved.
      </footer>
    </div>
  );
}
