import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getFounderProfileByAuth, updateFounder, inviteCoFounder,
  uploadImage, getCompanyFounders
} from '../../lib/api';
import {
  User, Mail, Phone, Linkedin, Globe, Building2,
  Upload, Save, UserPlus, CheckCircle2, AlertCircle,
  Loader2, Copy, Check, ExternalLink, Sparkles, Users
} from 'lucide-react';

export default function FounderProfilePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';
  const showWelcome = searchParams.get('welcome') === 'true';

  const [activeTab, setActiveTab] = useState('profile'); // 'profile' | 'partners'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [founder, setFounder] = useState(null);
  const [primaryCompany, setPrimaryCompany] = useState(null);
  const [partners, setPartners] = useState([]);

  // Form fields
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [bioAr, setBioAr] = useState('');
  const [bioEn, setBioEn] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [jobTitle, setJobTitle] = useState('Founder & CEO');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoFile, setPhotoFile] = useState(null);

  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  // Co-Founder Invite Modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadProfile();
  }, [user]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const data = await getFounderProfileByAuth(user.id, user.email);
      if (data) {
        setFounder(data);
        setNameAr(data.name_ar || '');
        setNameEn(data.name_en || '');
        setBioAr(data.bio_ar || '');
        setBioEn(data.bio_en || '');
        setPhone(data.phone || '');
        setLinkedinUrl(data.linkedin_url || '');
        setPhotoUrl(data.photo_url || '');

        const primary = data.company_founders?.[0]?.companies || null;
        setPrimaryCompany(primary);
        if (data.company_founders?.[0]?.role) {
          setJobTitle(data.company_founders[0].role);
        }

        const compId = data.company_founders?.[0]?.company_id;
        if (compId) {
          try {
            const pList = await getCompanyFounders(compId);
            setPartners(pList || []);
          } catch {}
        }
      }
    } catch (err) {
      console.error('Load profile error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadImage(file, 'founder-photos');
      setPhotoUrl(url);
      setPhotoFile(file);
      setStatusMessage({ type: 'success', text: isRtl ? 'تم رفع الصورة، اضغط حفظ لتطبيق التعديلات' : 'Photo uploaded. Click Save to apply.' });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to upload photo' });
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!founder) return;
    setSaving(true);
    setStatusMessage({ type: '', text: '' });

    try {
      const updates = {
        name_ar: nameAr.trim() || nameEn.trim(),
        name_en: nameEn.trim() || nameAr.trim(),
        bio_ar: bioAr.trim(),
        bio_en: bioEn.trim(),
        phone: phone.trim(),
        linkedin_url: linkedinUrl.trim(),
        photo_url: photoUrl
      };

      await updateFounder(founder.founder_id, updates);
      setStatusMessage({
        type: 'success',
        text: isRtl ? 'تم حفظ التعديلات بنجاح' : 'Profile updated successfully'
      });
    } catch (err) {
      console.error('Save profile error:', err);
      setStatusMessage({
        type: 'error',
        text: err.message || (isRtl ? 'حدث خطأ أثناء الحفظ' : 'Failed to save changes')
      });
    } finally {
      setSaving(false);
    }
  };

  const handleInviteCoFounder = async (e) => {
    e.preventDefault();
    if (!primaryCompany?.company_id || !inviteEmail.trim()) return;

    if (inviteEmail.trim().toLowerCase() === user.email?.toLowerCase()) {
      setInviteError(isRtl ? 'لا يمكنك دعوة نفسك' : 'You cannot invite yourself');
      return;
    }

    setInviting(true);
    setInviteError('');
    setInviteResult(null);

    try {
      const res = await inviteCoFounder({
        companyId: primaryCompany.company_id,
        email: inviteEmail.trim(),
        inviterFounderId: founder?.founder_id
      });
      setInviteResult(res);
      setInviteEmail('');
    } catch (err) {
      console.error('Invite error:', err);
      setInviteError(err.message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = () => {
    if (!inviteResult?.inviteLink) return;
    navigator.clipboard.writeText(inviteResult.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 size={36} className="animate-spin text-amber-500 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-500">{isRtl ? 'جاري تحميل الملف الشخصي...' : 'Loading founder profile...'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Welcome Banner if newly joined */}
      {showWelcome && (
        <div className="bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-transparent border border-amber-400/30 rounded-3xl p-6 flex items-start gap-4 shadow-sm">
          <div className="p-3 bg-amber-500 text-slate-950 rounded-2xl shrink-0 font-bold">
            <Sparkles size={22} />
          </div>
          <div>
            <h3 className="font-black text-base text-slate-900 mb-1">
              {isRtl ? 'أهلاً بك في شبكة خريجي أثر!' : 'Welcome to Athar Alumni Platform!'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600">
              {isRtl
                ? 'تم ربط حسابك بنجاح. يرجى إكمال بيانات ملفك الشخصي أدناه والاطلاع على تفاصيل شركتك وشهاداتك.'
                : 'Your founder account is verified and linked. Please complete your profile details and explore your company credentials.'}
            </p>
          </div>
        </div>
      )}

      {/* Profile Header Card */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row items-center md:items-start justify-between gap-6">
        <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-start">
          {/* Avatar with Upload Badge */}
          <div className="relative group">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Profile"
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover ring-4 ring-amber-400/30 shadow-md"
              />
            ) : (
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center font-bold text-3xl">
                <User size={40} />
              </div>
            )}
            <label className="absolute -bottom-2 -right-2 p-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl cursor-pointer shadow-lg transition-transform group-hover:scale-105 border border-slate-700">
              <Upload size={14} />
              <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
            </label>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
              <h1 className="text-2xl font-black text-slate-900">
                {isRtl ? (nameAr || nameEn || 'المؤسس') : (nameEn || nameAr || 'Founder')}
              </h1>
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                {jobTitle || 'Founder'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              {user?.email}
            </p>
            {primaryCompany && (
              <Link
                to={`/alumni/founder/company/${primaryCompany.company_id || primaryCompany.id}?lang=${lang}`}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 hover:text-amber-700 hover:underline pt-1"
              >
                <Building2 size={14} />
                <span>{isRtl ? (primaryCompany.name_ar || primaryCompany.name) : (primaryCompany.name || primaryCompany.name_ar)}</span>
                <ExternalLink size={12} />
              </Link>
            )}
          </div>
        </div>

        {/* Action Button: Invite Co-Founder */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setInviteModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs sm:text-sm font-bold shadow transition-all"
          >
            <UserPlus size={16} className="text-amber-400" />
            <span>{isRtl ? 'دعوة مؤسس آخر' : 'Invite Co-Founder'}</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-slate-100 border border-slate-200 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'profile'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <User size={14} />
          <span>{isRtl ? 'الملف الشخصي' : 'My Profile'}</span>
        </button>
        <button
          onClick={() => setActiveTab('partners')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'partners'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users size={14} />
          <span>{isRtl ? 'الشركاء المؤسسون' : 'Co-Founders'}</span>
          {partners.length > 0 && (
            <span className="bg-amber-500 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none">
              {partners.length}
            </span>
          )}
        </button>
      </div>

      {/* Notification Banner */}
      {statusMessage.text && (
        <div
          className={`p-4 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-2.5 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Form Fields Card — only visible in profile tab */}
      {activeTab === 'profile' && <form onSubmit={handleSave} className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
        <h2 className="text-base font-black text-slate-900 pb-3 border-b border-slate-100 flex items-center gap-2">
          <User size={18} className="text-amber-500" />
          <span>{isRtl ? 'بيانات الملف الشخصي' : 'Personal & Contact Details'}</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              {isRtl ? 'الاسم بالعربية' : 'Arabic Name'}
            </label>
            <input
              type="text"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:bg-white focus:border-amber-400 outline-none"
              placeholder="مثال: سارة العتيبي"
              dir="rtl"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              {isRtl ? 'الاسم بالإنجليزية' : 'English Name'}
            </label>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:bg-white focus:border-amber-400 outline-none"
              placeholder="e.g. Sarah Al-Otaibi"
              dir="ltr"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              {isRtl ? 'البريد الإلكتروني (للقراءة فقط)' : 'Email (Read-Only)'}
            </label>
            <div className="relative">
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full py-2.5 px-3.5 bg-slate-100 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-500 cursor-not-allowed"
                dir="ltr"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              {isRtl ? 'رقم الهاتف' : 'Phone Number'}
            </label>
            <div className="relative">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:bg-white focus:border-amber-400 outline-none"
                placeholder="+966 5x xxx xxxx"
                dir="ltr"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              {isRtl ? 'رابط LinkedIn' : 'LinkedIn URL'}
            </label>
            <input
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:bg-white focus:border-amber-400 outline-none"
              placeholder="https://linkedin.com/in/..."
              dir="ltr"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              {isRtl ? 'المسمى الوظيفي' : 'Job Title / Role'}
            </label>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:bg-white focus:border-amber-400 outline-none"
              placeholder="e.g. Co-Founder & CTO"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-bold text-slate-700 block">
              {isRtl ? 'نبذة تعريفية قصيرة' : 'Short Bio'}
            </label>
            <textarea
              rows={3}
              value={isRtl ? bioAr : (bioEn || bioAr)}
              onChange={(e) => isRtl ? setBioAr(e.target.value) : setBioEn(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:bg-white focus:border-amber-400 outline-none"
              placeholder={isRtl ? 'أدخل نبذة قصيرة عن خبراتك ومسيرتك الريادية...' : 'Brief summary of your background and founder journey...'}
            />
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-2xl text-xs sm:text-sm font-black shadow-md shadow-amber-500/20 transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            <span>{saving ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : (isRtl ? 'حفظ التعديلات' : 'Save Changes')}</span>
          </button>
        </div>
      </form>}

      {/* Partners Tab */}
      {activeTab === 'partners' && (
        <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Users size={18} className="text-amber-500" />
              <span>{isRtl ? 'الشركاء المؤسسون' : 'Co-Founders'}</span>
            </h2>
            {primaryCompany && (
              <button
                onClick={() => setInviteModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
              >
                <UserPlus size={14} className="text-amber-400" />
                <span>{isRtl ? 'دعوة شريك' : 'Invite'}</span>
              </button>
            )}
          </div>

          {partners.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto">
                <Users size={26} className="text-slate-400" />
              </div>
              <p className="text-sm font-bold text-slate-500">
                {isRtl ? 'لا يوجد شركاء مؤسسون حتى الآن' : 'No co-founders yet'}
              </p>
              <p className="text-xs text-slate-400">
                {isRtl ? 'استخدم زر الدعوة أعلاه لإضافة شريك مؤسس' : 'Use the Invite button above to add a co-founder'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {partners.map((p) => {
                const name = isRtl ? (p.name_ar || p.name_en || p.email) : (p.name_en || p.name_ar || p.email);
                const initials = name?.slice(0, 2)?.toUpperCase() || 'CO';
                const isMe = p.auth_user_id === user?.id || p.email === user?.email;
                return (
                  <div
                    key={p.founder_id || p.email}
                    className="flex items-start gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-slate-200 transition-all group"
                  >
                    {p.photo_url ? (
                      <img
                        src={p.photo_url}
                        alt={name}
                        className="w-12 h-12 rounded-2xl object-cover ring-2 ring-amber-300/30 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center font-black text-sm shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-900 truncate">{name}</span>
                        {isMe && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                            {isRtl ? 'أنت' : 'You'}
                          </span>
                        )}
                      </div>
                      {p.role && (
                        <p className="text-[11px] font-bold text-slate-500">{p.role}</p>
                      )}
                      {p.email && (
                        <p className="text-[11px] text-slate-400 truncate" dir="ltr">{p.email}</p>
                      )}
                      {p.linkedin_url && (
                        <a
                          href={p.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline"
                        >
                          <Linkedin size={11} />
                          <span>LinkedIn</span>
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Invite Co-Founder Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setInviteModalOpen(false)}>
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-800">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">
                    {isRtl ? 'دعوة شريك مؤسس' : 'Invite Co-Founder'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {isRtl ? 'إرسال رابط انضمام لنفس الشركة' : 'Send invitation link for this company'}
                  </p>
                </div>
              </div>
              <button onClick={() => setInviteModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">✕</button>
            </div>

            {inviteError && (
              <div className="bg-red-50 text-red-700 p-3 rounded-xl text-xs font-bold flex items-center gap-2 border border-red-200">
                <AlertCircle size={15} />
                <span>{inviteError}</span>
              </div>
            )}

            {inviteResult ? (
              <div className="space-y-4 py-2">
                <div className="p-4 bg-emerald-50 text-emerald-800 rounded-2xl border border-emerald-200 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 size={18} className="shrink-0" />
                  <span>{isRtl ? 'تم إنشاء رابط الدعوة بنجاح!' : 'Invitation generated successfully!'}</span>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase">{isRtl ? 'رابط الانضمام للمؤسس:' : 'Founder Joining Link:'}</label>
                  <div className="flex items-center gap-2 p-2 bg-slate-100 rounded-xl border border-slate-200">
                    <input
                      type="text"
                      readOnly
                      value={inviteResult.inviteLink}
                      className="bg-transparent text-xs font-mono text-slate-700 w-full outline-none"
                    />
                    <button
                      onClick={copyInviteLink}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0"
                    >
                      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      <span>{copied ? (isRtl ? 'تم النسخ' : 'Copied') : (isRtl ? 'نسخ' : 'Copy')}</span>
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => { setInviteResult(null); setInviteModalOpen(false); }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                >
                  {isRtl ? 'إغلاق' : 'Close'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleInviteCoFounder} className="space-y-4">
                <p className="text-xs text-slate-600">
                  {isRtl
                    ? `سيتم إرسال رابط انضمام للمؤسس الشريك لربطه تلقائياً بشركة "${primaryCompany?.name_ar || primaryCompany?.name || 'شركتك'}" دون الحاجة لموافقة إضافية.`
                    : `An invitation link will be created for the co-founder to join "${primaryCompany?.name || primaryCompany?.name_ar || 'your company'}" directly.`}
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    {isRtl ? 'البريد الإلكتروني للشريك المؤسس' : 'Co-Founder Email'} *
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    placeholder="cofounder@company.com"
                    className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:bg-white focus:border-amber-400 outline-none"
                    dir="ltr"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                  >
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition-all shadow disabled:opacity-60"
                  >
                    {inviting ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                    <span>{inviting ? (isRtl ? 'جاري الإرسال...' : 'Sending...') : (isRtl ? 'إرسال الدعوة' : 'Send Invite')}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
