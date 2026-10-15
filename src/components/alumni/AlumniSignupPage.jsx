import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { validateInvitationToken, acceptInvitation, uploadImage } from '../../lib/api';
import {
  GraduationCap, Building2, CheckCircle2, AlertCircle,
  Loader2, Lock, User, Mail, Phone, Linkedin, Upload,
  ArrowRight, ArrowLeft, Globe, Award
} from 'lucide-react';

export default function AlumniSignupPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const tokenParam = searchParams.get('token') || searchParams.get('invitation_id') || '';
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  const [tokenInput, setTokenInput] = useState(tokenParam);
  const [tokenLoading, setTokenLoading] = useState(!!tokenParam);
  const [invitationData, setInvitationData] = useState(null);
  const [tokenError, setTokenError] = useState('');

  // Form states
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const toggleLang = () => {
    const nextLang = lang === 'ar' ? 'en' : 'ar';
    const params = new URLSearchParams(searchParams);
    params.set('lang', nextLang);
    setSearchParams(params);
  };

  useEffect(() => {
    if (!tokenParam) {
      setTokenLoading(false);
      return;
    }
    verifyToken(tokenParam);
  }, [tokenParam]);

  const verifyToken = async (t) => {
    try {
      setTokenLoading(true);
      setTokenError('');
      const res = await validateInvitationToken(t);
      if (res.valid) {
        setInvitationData(res.invitation);
        if (res.invitation.founder_email) {
          // Pre-populate name guess from email if empty
          const namePart = res.invitation.founder_email.split('@')[0].replace(/[._]/g, ' ');
          setFullName(namePart.charAt(0).toUpperCase() + namePart.slice(1));
        }
      } else {
        if (res.reason === 'already_used') {
          setTokenError(
            isRtl
              ? 'تم استخدام رمز الدعوة هذا مسبقاً. يمكنك تسجيل الدخول مباشرة.'
              : 'This invitation link has already been used. Please log in directly.'
          );
        } else if (res.reason === 'expired') {
          setTokenError(
            isRtl
              ? 'انتهت صلاحية هذا الرابط (صلاحية الدعوة 14 يوماً). يرجى التواصل مع فريق أثر لإعادة إرسال الدعوة.'
              : 'This invitation link has expired (14-day validity). Please contact Athar team to resend.'
          );
        } else {
          setTokenError(
            isRtl
              ? 'رمز الدعوة غير صالح أو غير موجود. يرجى التحقق من الرابط.'
              : 'Invalid or missing invitation token. Please verify your invitation link.'
          );
        }
      }
    } catch (err) {
      setTokenError(err.message || 'Error validating token');
    } finally {
      setTokenLoading(false);
    }
  };

  const handleManualTokenSubmit = (e) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setSearchParams({ token: tokenInput.trim(), lang });
    verifyToken(tokenInput.trim());
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    if (password !== confirmPassword) {
      setSubmitError(isRtl ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setSubmitError(isRtl ? 'كلمة المرور يجب أن لا تقل عن 6 خانات' : 'Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      let photoUrl = '';
      if (photoFile) {
        photoUrl = await uploadImage(photoFile, 'founder-photos');
      }

      await acceptInvitation({
        token: tokenParam || tokenInput,
        fullName: fullName.trim(),
        password,
        photoUrl,
        phone: phone.trim(),
        linkedinUrl: linkedinUrl.trim(),
        bio: ''
      });

      // Redirect to founder profile with welcome toast flag
      navigate('/alumni/founder/profile?welcome=true', { replace: true });
    } catch (err) {
      console.error('Accept invitation error:', err);
      setSubmitError(err.message || (isRtl ? 'فشل إنشاء الحساب، يرجى المحاولة مرة أخرى.' : 'Failed to register account. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const company = invitationData?.companies;
  const programs = company?.program_participations || [];

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden font-manrope"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="absolute top-0 -left-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-40 w-96 h-96 bg-athar-blue/10 rounded-full blur-3xl pointer-events-none" />

      {/* Language Switch */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold transition-all shadow"
        >
          <Globe size={14} className="text-amber-400" />
          <span>{lang === 'ar' ? 'English' : 'عربي'}</span>
        </button>
      </div>

      <div className="w-full max-w-xl relative z-10 py-8 animate-in fade-in zoom-in-95 duration-500">
        {/* Branding */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-tr from-amber-500 to-amber-300 rounded-2xl shadow-xl shadow-amber-500/20 mb-3 ring-4 ring-amber-400/20">
            <GraduationCap className="text-slate-950 w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-1">
            {isRtl ? 'انضم إلى مجتمع خريجي أثر' : 'Join Athar Alumni Network'}
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm font-medium">
            {isRtl ? 'تفعيل حساب المؤسس وربطه بسجلات الشركة' : 'Founder onboarding and verified company account setup'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/60 relative">
          {tokenLoading ? (
            <div className="py-16 text-center space-y-3">
              <Loader2 size={32} className="animate-spin text-amber-400 mx-auto" />
              <p className="text-sm font-bold text-slate-300">
                {isRtl ? 'جاري التحقق من رمز الدعوة...' : 'Verifying your invitation token...'}
              </p>
            </div>
          ) : tokenError ? (
            <div className="py-8 text-center space-y-5">
              <div className="w-14 h-14 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto border border-red-500/30">
                <AlertCircle size={28} />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">
                  {isRtl ? 'تعذر استخدام الرابط' : 'Invitation Invalid'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                  {tokenError}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
                <Link
                  to="/alumni/login"
                  className="px-6 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all"
                >
                  {isRtl ? 'تسجيل الدخول' : 'Go to Login'}
                </Link>
                <button
                  onClick={() => { setTokenError(''); setInvitationData(null); }}
                  className="px-6 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700 transition-all border border-slate-700"
                >
                  {isRtl ? 'إدخال رمز يدوي' : 'Enter Token Manually'}
                </button>
              </div>
            </div>
          ) : !invitationData ? (
            /* Manual Token Entry Form */
            <form onSubmit={handleManualTokenSubmit} className="space-y-4 py-4">
              <div className="text-center mb-4">
                <p className="text-xs text-slate-300 font-medium">
                  {isRtl ? 'أدخل رمز الدعوة (Token) الذي وصلك في البريد الإلكتروني:' : 'Please enter the invitation token sent to your email:'}
                </p>
              </div>
              <div>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="e.g. 9b1deb4d3b7d4bad..."
                  className="w-full py-3 px-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-sm text-amber-300 text-center outline-none focus:border-amber-400"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-sm transition-all shadow"
              >
                {isRtl ? 'تحقق من الدعوة' : 'Validate Invitation'}
              </button>
              <div className="text-center pt-2">
                <Link to="/alumni/login" className="text-xs text-slate-400 hover:text-white">
                  {isRtl ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'Already have an account? Sign in'}
                </Link>
              </div>
            </form>
          ) : (
            /* Invitation Validated -> Account Setup Form */
            <div className="space-y-6">
              {/* Company Info Box */}
              <div className="bg-slate-950/70 border border-amber-500/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
                {company?.logo_url ? (
                  <img
                    src={company.logo_url}
                    alt={company.name}
                    className="w-14 h-14 rounded-xl object-contain bg-white p-1 ring-1 ring-slate-800"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-slate-800 text-amber-400 flex items-center justify-center font-black text-xl">
                    <Building2 size={24} />
                  </div>
                )}
                <div className="flex-1 text-center sm:text-start">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <h3 className="font-extrabold text-base text-white">
                      {isRtl ? (company?.name_ar || company?.name) : (company?.name || company?.name_ar)}
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      {isRtl ? 'شركة معتمدة' : 'Verified Company'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {isRtl ? 'البريد المدعو:' : 'Invited Email:'} <span className="text-amber-300 font-semibold">{invitationData.founder_email}</span>
                  </p>
                </div>
              </div>

              {/* Participating Programs preview */}
              {programs.length > 0 && (
                <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Award size={13} className="text-amber-400" />
                    {isRtl ? 'البرامج المشارك بها مسبقاً' : 'Participating Programs'}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {programs.map((p, idx) => (
                      <span key={idx} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 border border-slate-700">
                        {isRtl ? (p.programs?.name_ar || p.programs?.name) : (p.programs?.name || p.programs?.name_ar)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Signup Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {submitError && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl text-xs font-bold flex items-center gap-2">
                    <AlertCircle size={16} className="shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-bold text-slate-300 block">
                      {isRtl ? 'الاسم الكامل' : 'Full Name'} *
                    </label>
                    <div className="relative">
                      <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-slate-500`}>
                        <User size={16} />
                      </div>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className={`w-full ${isRtl ? 'pr-10 pl-3.5' : 'pl-10 pr-3.5'} py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white focus:border-amber-400 outline-none`}
                        placeholder="e.g. Sarah Al-Otaibi"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 block">
                      {isRtl ? 'كلمة المرور' : 'Password'} *
                    </label>
                    <div className="relative">
                      <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-slate-500`}>
                        <Lock size={16} />
                      </div>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`w-full ${isRtl ? 'pr-10 pl-3.5' : 'pl-10 pr-3.5'} py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white focus:border-amber-400 outline-none`}
                        placeholder="••••••••"
                        required
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 block">
                      {isRtl ? 'تأكيد كلمة المرور' : 'Confirm Password'} *
                    </label>
                    <div className="relative">
                      <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-slate-500`}>
                        <Lock size={16} />
                      </div>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`w-full ${isRtl ? 'pr-10 pl-3.5' : 'pl-10 pr-3.5'} py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white focus:border-amber-400 outline-none`}
                        placeholder="••••••••"
                        required
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 block">
                      {isRtl ? 'رقم الهاتف (اختياري)' : 'Phone Number (Optional)'}
                    </label>
                    <div className="relative">
                      <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-slate-500`}>
                        <Phone size={16} />
                      </div>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={`w-full ${isRtl ? 'pr-10 pl-3.5' : 'pl-10 pr-3.5'} py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white focus:border-amber-400 outline-none`}
                        placeholder="+966 5x xxx xxxx"
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 block">
                      {isRtl ? 'رابط LinkedIn (اختياري)' : 'LinkedIn URL (Optional)'}
                    </label>
                    <div className="relative">
                      <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-slate-500`}>
                        <Linkedin size={16} />
                      </div>
                      <input
                        type="url"
                        value={linkedinUrl}
                        onChange={(e) => setLinkedinUrl(e.target.value)}
                        className={`w-full ${isRtl ? 'pr-10 pl-3.5' : 'pl-10 pr-3.5'} py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white focus:border-amber-400 outline-none`}
                        placeholder="https://linkedin.com/in/..."
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>

                {/* Profile Photo */}
                <div className="space-y-1.5 pt-2">
                  <label className="text-xs font-bold text-slate-300 block">
                    {isRtl ? 'الصورة الشخصية (اختياري)' : 'Profile Photo (Optional)'}
                  </label>
                  <div className="flex items-center gap-3">
                    {photoPreview ? (
                      <img src={photoPreview} alt="Preview" className="w-12 h-12 rounded-xl object-cover ring-2 ring-amber-400/40" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-600">
                        <User size={20} />
                      </div>
                    )}
                    <label className="cursor-pointer px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition-colors flex items-center gap-2">
                      <Upload size={14} />
                      <span>{isRtl ? 'اختيار صورة' : 'Choose Photo'}</span>
                      <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-4 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black py-3.5 px-6 rounded-xl text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      <span>{isRtl ? 'تفعيل الحساب والانتقال للملف الشخصي' : 'Complete Registration & Access Profile'}</span>
                      {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
