import { useState } from 'react';
import { Plus, X, ChevronUp, ChevronDown, Sparkles, ToggleLeft, ToggleRight } from 'lucide-react';

/**
 * Normalizes any option (string or object) to the rich { label, value, is_other? } format.
 */
const normalizeOption = (opt) => {
    if (typeof opt === 'object' && opt !== null) {
        return {
            label: opt.label || opt.value || '',
            value: opt.value !== undefined ? opt.value : (opt.label || ''),
            is_other: !!opt.is_other
        };
    }
    return { label: String(opt), value: String(opt), is_other: false };
};

export default function ChipsOptionInput({
    options = [],
    onChange,
    label = 'خيارات الإجابة (Choices / Options)'
}) {
    const [inputValue, setInputValue] = useState('');

    const normalized = (options || []).map(normalizeOption);
    const hasOtherOption = normalized.some(o => o.is_other);

    const emitChange = (newNormalized) => {
        // Emit as rich objects so is_other is preserved through save/load
        onChange(newNormalized);
    };

    const handleAdd = (e) => {
        if (e) e.preventDefault();
        const trimmed = inputValue.trim();
        if (!trimmed) return;
        if (normalized.some(o => o.label === trimmed && !o.is_other)) {
            setInputValue('');
            return;
        }
        // Insert before the "Other" option if it exists
        const otherIdx = normalized.findIndex(o => o.is_other);
        const newOpt = { label: trimmed, value: trimmed, is_other: false };
        const next = [...normalized];
        if (otherIdx !== -1) {
            next.splice(otherIdx, 0, newOpt);
        } else {
            next.push(newOpt);
        }
        emitChange(next);
        setInputValue('');
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
    };

    const handleRemove = (index) => {
        emitChange(normalized.filter((_, i) => i !== index));
    };

    const handleMove = (index, direction) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= normalized.length) return;
        const next = [...normalized];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        emitChange(next);
    };

    const toggleOtherOption = () => {
        if (hasOtherOption) {
            // Remove the "Other" option
            emitChange(normalized.filter(o => !o.is_other));
        } else {
            // Append "Other" at the end
            emitChange([...normalized, { label: 'أخرى (Other)', value: '__other__', is_other: true }]);
        }
    };

    return (
        <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-3" dir="rtl">
            <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-indigo-600" />
                    <span>{label}</span>
                </label>
                <span className="text-[11px] font-bold text-slate-400">
                    {normalized.filter(o => !o.is_other).length} خيارات مضافة
                </span>
            </div>

            {/* Input Bar */}
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="اكتب الخيار واضغط إضافة أو Enter..."
                    className="flex-1 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 transition-all"
                />
                <button
                    type="button"
                    onClick={handleAdd}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-all shrink-0"
                >
                    <Plus size={14} />
                    <span>إضافة</span>
                </button>
            </div>

            {/* Chips / Pills List */}
            {normalized.length === 0 ? (
                <p className="text-[11px] text-slate-400 font-medium py-1">
                    لم تقم بإضافة أي خيارات بعد. أضف خياراً ليظهر للمستجيب.
                </p>
            ) : (
                <div className="flex flex-wrap gap-2 pt-1">
                    {normalized.map((opt, idx) => (
                        <div
                            key={idx}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 border rounded-xl shadow-2xs hover:border-indigo-300 transition-all group ${
                                opt.is_other
                                    ? 'bg-amber-50 border-amber-200 hover:border-amber-400'
                                    : 'bg-white border-slate-200'
                            }`}
                        >
                            {opt.is_other ? (
                                <span className="text-[10px] font-black text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-md">أخرى</span>
                            ) : (
                                <span className="w-4 h-4 rounded-md bg-slate-100 text-slate-500 text-[10px] font-black flex items-center justify-center">
                                    {idx + 1}
                                </span>
                            )}
                            <span className={`text-xs font-bold ${opt.is_other ? 'text-amber-800' : 'text-slate-800'}`}>
                                {opt.label}
                            </span>

                            {!opt.is_other && (
                                <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                    <button
                                        type="button"
                                        onClick={() => handleMove(idx, -1)}
                                        disabled={idx === 0}
                                        className="p-0.5 text-slate-400 hover:text-indigo-600 disabled:opacity-20"
                                        title="تحريك لأعلى"
                                    >
                                        <ChevronUp size={12} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleMove(idx, 1)}
                                        disabled={idx === normalized.length - 1 || normalized[idx + 1]?.is_other}
                                        className="p-0.5 text-slate-400 hover:text-indigo-600 disabled:opacity-20"
                                        title="تحريك لأسفل"
                                    >
                                        <ChevronDown size={12} />
                                    </button>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => handleRemove(idx)}
                                className="p-0.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                title="حذف هذا الخيار"
                            >
                                <X size={13} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* "Other" Option Toggle */}
            <div className="pt-2 border-t border-slate-200/80">
                <button
                    type="button"
                    onClick={toggleOtherOption}
                    className={`flex items-center gap-2 text-xs font-black transition-colors ${
                        hasOtherOption
                            ? 'text-amber-700 hover:text-amber-900'
                            : 'text-slate-500 hover:text-indigo-700'
                    }`}
                >
                    {hasOtherOption
                        ? <ToggleRight size={18} className="text-amber-500" />
                        : <ToggleLeft size={18} className="text-slate-400" />
                    }
                    <span>
                        {hasOtherOption
                            ? 'إزالة خيار "أخرى" (Remove Other Option)'
                            : 'إضافة خيار "أخرى" (Add Other Option)'}
                    </span>
                </button>
                {hasOtherOption && (
                    <p className="text-[10px] text-amber-600 font-medium mt-1 ms-6">
                        سيظهر للمستجيب حقل نصي عند اختيار هذا الخيار لكتابة إجابته المخصصة.
                    </p>
                )}
            </div>
        </div>
    );
}
