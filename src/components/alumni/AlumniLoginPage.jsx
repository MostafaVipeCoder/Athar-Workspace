import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { GraduationCap, Mail, Lock, Loader2, ArrowRight, ArrowLeft, Globe, AlertCircle } from 'lucide-react';

export default function AlumniLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const { signIn, user, roles, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  const from = location.state?.from?.pathname || '/alumni';

  useEffect(() => {
    if (!authLoading && user) {
      navigate(from, { replace: true });
    }
  }, [authLoading, user, navigate, from]);

  const toggleLang = () => {
    const nextLang = lang === 'ar' ? 'en' : 'ar';
    setSearchParams({ lang: nextLang });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: signInError } = await signIn({ email: email.trim(), password });
      if (signInError) throw signInError;
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        isRtl
          ? (err.message || 'بيانات الدخول غير صحيحة، يرجى المحاولة مرة أخرى.')
          : (err.message || 'Invalid credentials. Please verify your email and password.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6 relative overflow-hidden font-manrope"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Background radial gradients */}
      <div className="absolute top-0 -left-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-40 w-96 h-96 bg-athar-blue/10 rounded-full blur-3xl pointer-events-none" />

      {/* Language Toggle in Top Corner */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold transition-all shadow"
        >
          <Globe size={14} className="text-amber-400" />
          <span>{lang === 'ar' ? 'English' : 'عربي'}</span>
        </button>
      </div>

      <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-500">
        {/* Header and Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-tr from-amber-500 to-amber-300 rounded-3xl shadow-xl shadow-amber-500/20 mb-5 ring-4 ring-amber-400/20">
            <GraduationCap className="text-slate-950 w-10 h-10" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">
            {isRtl ? 'منصة خريجي أثر' : 'Athar Alumni Platform'}
          </h1>
          <p className="text-slate-400 text-sm font-medium">
            {isRtl
              ? 'مرحباً بك مجدداً. سجّل دخولك للوصول إلى شركتك وشهاداتك'
              : 'Welcome back. Access your company profile and verified credentials.'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 sm:p-10 shadow-2xl shadow-black/60 relative">
          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-2xl text-xs font-bold flex items-center gap-2.5">
                <AlertCircle size={18} className="shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 block">
                {isRtl ? 'البريد الإلكتروني' : 'Email Address'}
              </label>
              <div className="relative">
                <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-4' : 'left-0 pl-4'} flex items-center pointer-events-none text-slate-500`}>
                  <Mail size={18} />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`w-full ${isRtl ? 'pr-11 pl-4' : 'pl-11 pr-4'} py-3.5 bg-slate-950 border border-slate-800 rounded-xl focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all outline-none font-medium text-sm text-white placeholder:text-slate-600`}
                  placeholder="founder@company.com"
                  required
                  dir="ltr"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 block">
                  {isRtl ? 'كلمة المرور' : 'Password'}
                </label>
                <button
                  type="button"
                  onClick={() => alert(isRtl ? 'يرجى التواصل مع إدارة أثر لإعادة تعيين كلمة المرور.' : 'Please contact Athar admin to reset your credentials.')}
                  className="text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors"
                >
                  {isRtl ? 'نسيت كلمة المرور؟' : 'Forgot Password?'}
                </button>
              </div>
              <div className="relative">
                <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-4' : 'left-0 pl-4'} flex items-center pointer-events-none text-slate-500`}>
                  <Lock size={18} />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full ${isRtl ? 'pr-11 pl-4' : 'pl-11 pr-4'} py-3.5 bg-slate-950 border border-slate-800 rounded-xl focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all outline-none font-medium text-sm text-white placeholder:text-slate-600`}
                  placeholder="••••••••"
                  required
                  dir="ltr"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black py-3.5 px-6 rounded-xl text-sm shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  <span>{isRtl ? 'دخول المؤسس' : 'Sign In as Founder'}</span>
                  {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
                </>
              )}
            </button>
          </form>

          {/* Invitation Callout */}
          <div className="mt-8 pt-6 border-t border-slate-800 text-center">
            <p className="text-xs text-slate-400 mb-2">
              {isRtl ? 'هل استلمت رابط دعوة للانضمام؟' : 'Have you received an invitation link?'}
            </p>
            <Link
              to="/alumni/signup"
              className="text-xs font-extrabold text-amber-400 hover:text-amber-300 hover:underline"
            >
              {isRtl ? 'تفعيل الحساب برمز الدعوة ←' : 'Activate your account with an invitation →'}
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center mt-6 text-slate-500 text-xs font-semibold">
          &copy; {new Date().getFullYear()} Athar Accelerator &middot; Alumni Network
        </p>
      </div>
    </div>
  );
}
