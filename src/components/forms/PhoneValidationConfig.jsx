import { useState } from 'react';
import { Phone, Check, Globe, ShieldCheck } from 'lucide-react';
import { SUPPORTED_COUNTRIES } from '../../lib/phoneValidation';

export default function PhoneValidationConfig({
    allowedCountries = ['EG', 'SA', 'AE'],
    onChange
}) {
    const activeList = Array.isArray(allowedCountries) && allowedCountries.length > 0
        ? allowedCountries
        : ['EG', 'SA', 'AE'];

    const toggleCountry = (code) => {
        let updated;
        if (activeList.includes(code)) {
            // Keep at least 1 country
            if (activeList.length === 1) return;
            updated = activeList.filter(c => c !== code);
        } else {
            updated = [...activeList, code];
        }
        onChange(updated);
    };

    return (
        <div className="p-4 bg-blue-50/40 border border-blue-200/80 rounded-2xl space-y-3 text-right" dir="rtl">
            <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Phone size={14} className="text-blue-600" />
                    <span>فالديشن رقم الهاتف والدول المسموحة (Phone Validation)</span>
                </label>
                <span className="text-[10px] font-bold text-blue-700 bg-blue-100/60 px-2 py-0.5 rounded-md">
                    حفظ بصيغة E.164 الدولية
                </span>
            </div>

            <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                حدد الدول المصرح بها لإدخال الأرقام. يتم تنظيف المدخلات تلقائياً من المسافات والأقواس وتحويل الرقم للصيغة الدولية الرسمية.
            </p>

            {/* Countries Chips Picker */}
            <div className="flex flex-wrap gap-2 pt-1">
                {SUPPORTED_COUNTRIES.map(country => {
                    const isSelected = activeList.includes(country.code);
                    return (
                        <button
                            key={country.code}
                            type="button"
                            onClick={() => toggleCountry(country.code)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                                isSelected
                                    ? 'bg-white border-blue-500 text-blue-800 shadow-xs ring-2 ring-blue-500/10'
                                    : 'bg-slate-100/60 border-slate-200 text-slate-500 hover:bg-white'
                            }`}
                        >
                            <span>{country.flag}</span>
                            <span>{country.name}</span>
                            <span className="text-[10px] font-mono opacity-70" dir="ltr">{country.dialCode}</span>
                            {isSelected && <Check size={13} className="text-blue-600 mr-1" />}
                        </button>
                    );
                })}
            </div>

            {/* Egypt Specific Note if active */}
            {activeList.includes('EG') && (
                <div className="p-2.5 bg-white/90 border border-blue-200 rounded-xl text-[11px] text-slate-600 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-blue-900">
                        <ShieldCheck size={14} className="text-emerald-600" />
                        <span>فالديشن مصر الدقيق مفعل:</span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-500 text-[10px] pr-1">
                        <li>يقبل الأرقام بـ <code className="text-slate-800 font-mono">+20</code> أو <code className="text-slate-800 font-mono">0020</code> أو بدونها (يبدأ بـ 0 أو 1).</li>
                        <li>محمول: يبدأ بـ 010, 011, 012, 015 بطول 11 رقماً (أو 10 أرقام بدون 0).</li>
                        <li>أرضي: يبدأ بأكواد المحافظات (02, 03, إلخ) بطول 9-10 أرقام.</li>
                    </ul>
                </div>
            )}
        </div>
    );
}
