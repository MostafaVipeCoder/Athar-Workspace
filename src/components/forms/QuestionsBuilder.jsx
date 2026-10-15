import { useState, useRef, useEffect } from 'react';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    GripVertical, Plus, Trash2, Save, AlertCircle, Loader,
    Type, FileText, List, Upload, Mail, Hash, Phone, Globe,
    FolderKanban, MoreVertical, Check, ArrowDownUp, ShieldCheck,
    HelpCircle, ChevronRight, Layers, Sparkles, Copy, CheckCircle2
} from 'lucide-react';
import ChipsOptionInput from './ChipsOptionInput';
import PhoneValidationConfig from './PhoneValidationConfig';

const isCoreField = (fieldName) =>
    ['startup_name', 'logo_url', 'expert_name', 'photo_url'].includes(fieldName);

const getIconForType = (type) => {
    switch (type) {
        case 'text': return <Type size={14} />;
        case 'textarea': return <FileText size={14} />;
        case 'select': return <List size={14} />;
        case 'multiselect': return <List size={14} />;
        case 'file': return <Upload size={14} />;
        case 'email': return <Mail size={14} />;
        case 'number': return <Hash size={14} />;
        case 'tel': return <Phone size={14} />;
        case 'url': return <Globe size={14} />;
        default: return <Type size={14} />;
    }
};

/**
 * Sortable Question Card Item with 6-dot drag handle and 3-dots action menu
 */
function SortableQuestionCard({
    id,
    field,
    index,
    sections,
    onFieldChange,
    onValidationChange,
    onRemoveField,
    onMoveToSection,
    onDuplicateField
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const [showActionMenu, setShowActionMenu] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowActionMenu(false);
            }
        };
        if (showActionMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showActionMenu]);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 50 : 1
    };

    const validationRules = field.validation_rules || {};

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 hover:border-slate-300 transition-colors relative"
        >
            {/* Card Header & Controls */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                    {/* ⠿ 6-Dots Drag Handle */}
                    <button
                        type="button"
                        {...attributes}
                        {...listeners}
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-800 cursor-grab active:cursor-grabbing transition-colors"
                        title="اسحب لإعادة الترتيب (Drag to Reorder)"
                    >
                        <GripVertical size={16} />
                    </button>

                    <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100 flex items-center gap-1.5 capitalize">
                            {getIconForType(field.field_type)}
                            {field.field_type === 'tel' ? 'Phone Number' : field.field_type}
                        </span>

                        {isCoreField(field.field_name) && (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-md uppercase">Core</span>
                        )}

                        {field.section_id && (
                            <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-100 text-[10px] font-bold rounded-md flex items-center gap-1">
                                <FolderKanban size={11} />
                                {sections.find(s => s.id === field.section_id)?.title || 'قسم مخصص'}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    {/* 3-Dots Action Menu */}
                    <div className="relative" ref={menuRef}>
                        <button
                            type="button"
                            onClick={() => setShowActionMenu(prev => !prev)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
                            title="خيارات إضافية"
                        >
                            <MoreVertical size={16} />
                        </button>

                        {showActionMenu && (
                            <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-30 text-right text-xs animate-in fade-in" dir="rtl">
                                <button
                                    type="button"
                                    onClick={() => {
                                        onDuplicateField(index);
                                        setShowActionMenu(false);
                                    }}
                                    className="w-full px-3 py-2 text-right font-bold hover:bg-indigo-50 flex items-center gap-2 text-slate-700 hover:text-indigo-600 border-b border-slate-100 transition-colors"
                                >
                                    <Copy size={14} className="text-slate-400" />
                                    <span>نسخ السؤال (Duplicate)</span>
                                </button>

                                <div className="px-3 py-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">
                                    نقل السؤال إلى قسم:
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        onMoveToSection(field.field_name, null);
                                        setShowActionMenu(false);
                                    }}
                                    className={`w-full px-3 py-2 text-right font-bold hover:bg-slate-50 flex items-center justify-between ${
                                        !field.section_id ? 'text-blue-600 bg-blue-50/50' : 'text-slate-700'
                                    }`}
                                >
                                    <span>عام / بدون قسم (Root Level)</span>
                                    {!field.section_id && <Check size={14} />}
                                </button>

                                {sections.map(sec => (
                                    <button
                                        key={sec.id}
                                        type="button"
                                        onClick={() => {
                                            onMoveToSection(field.field_name, sec.id);
                                            setShowActionMenu(false);
                                        }}
                                        className={`w-full px-3 py-2 text-right font-bold hover:bg-slate-50 flex items-center justify-between ${
                                            field.section_id === sec.id ? 'text-blue-600 bg-blue-50/50' : 'text-slate-700'
                                        }`}
                                    >
                                        <span className="truncate">{sec.title}</span>
                                        {field.section_id === sec.id && <Check size={14} />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {!isCoreField(field.field_name) && (
                        <button
                            type="button"
                            onClick={() => onRemoveField(index)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                            title="حذف السؤال"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Question Details Grid */}
            <div className="space-y-4 text-left" dir="ltr">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Question Label *</label>
                        <input
                            type="text"
                            value={field.field_label || ''}
                            onChange={(e) => onFieldChange(index, 'field_label', e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder="e.g. What is your full name?"
                            dir="auto"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Input Field Type</label>
                        <select
                            disabled={isCoreField(field.field_name)}
                            value={field.field_type}
                            onChange={(e) => onFieldChange(index, 'field_type', e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        >
                            <option value="text">Short Text</option>
                            <option value="textarea">Paragraph / Long Text</option>
                            <option value="email">Email Address</option>
                            <option value="tel">Phone Number (مع التحقق المتقدم)</option>
                            <option value="number">Number</option>
                            <option value="url">Website URL</option>
                            <option value="select">Dropdown (Single Select)</option>
                            <option value="multiselect">Multiple Select (Checkboxes)</option>
                            <option value="file">File / Image Upload</option>
                        </select>
                    </div>
                </div>

                {/* Question Description */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-bold text-slate-700">
                            Question Description / وصف السؤال (يظهر تحت السؤال)
                        </label>
                        <span className="text-[10px] text-slate-400 font-medium">
                            يظهر للمستجيب أسفل السؤال بخط أصغر بنصف الحجم
                        </span>
                    </div>
                    <textarea
                        rows={2}
                        value={field.description !== undefined ? field.description : (field.help_text || '')}
                        onChange={(e) => onFieldChange(index, 'description', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-y"
                        placeholder="أدخل وصفاً أو توضيحاً إضافياً يظهر تحت السؤال لمساعدة المستجيب..."
                        dir="auto"
                    />
                </div>

                {/* Placeholder */}
                <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Placeholder (النص التوضيحي داخل الحقل)</label>
                    <input
                        type="text"
                        value={field.placeholder || ''}
                        onChange={(e) => onFieldChange(index, 'placeholder', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        placeholder="e.g. Enter answer here..."
                        dir="auto"
                    />
                </div>
            </div>

            {/* Chips Option Input for Select & Multiselect */}
            {['select', 'multiselect'].includes(field.field_type) && (
                <ChipsOptionInput
                    options={field.field_options || []}
                    onChange={(opts) => onFieldChange(index, 'field_options', opts)}
                    label={field.field_type === 'select' ? 'خيارات القائمة المنسدلة (Dropdown Choices)' : 'خيارات الاختيار المتعدد (Checkbox Choices)'}
                />
            )}

            {/* Phone Validation Config for Tel / Phone */}
            {field.field_type === 'tel' && (
                <PhoneValidationConfig
                    allowedCountries={validationRules.allowed_countries}
                    onChange={(countries) => onValidationChange(index, 'allowed_countries', countries)}
                />
            )}

            {/* Validation Rules Section */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 text-left" dir="ltr">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-slate-700">Validation Rules & Constraints</span>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={field.is_required || false}
                            onChange={(e) => onFieldChange(index, 'is_required', e.target.checked)}
                            className="w-4 h-4 rounded text-blue-600"
                        />
                        <span className="text-xs font-bold text-slate-700">Required Field</span>
                    </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            Custom Error Message
                        </label>
                        <input
                            type="text"
                            value={validationRules.customError || ''}
                            onChange={(e) => onValidationChange(index, 'customError', e.target.value)}
                            placeholder="e.g. This question is required"
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs"
                            dir="auto"
                        />
                    </div>

                    {field.field_type === 'number' && (
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className="block text-[11px] font-bold text-slate-500 mb-1">Min Value</label>
                                <input
                                    type="number"
                                    value={validationRules.minValue || ''}
                                    onChange={(e) => onValidationChange(index, 'minValue', e.target.value)}
                                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-[11px] font-bold text-slate-500 mb-1">Max Value</label>
                                <input
                                    type="number"
                                    value={validationRules.maxValue || ''}
                                    onChange={(e) => onValidationChange(index, 'maxValue', e.target.value)}
                                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs"
                                />
                            </div>
                        </div>
                    )}

                    {['text', 'textarea'].includes(field.field_type) && (
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className="block text-[11px] font-bold text-slate-500 mb-1">Min Length</label>
                                <input
                                    type="number"
                                    value={validationRules.minLength || ''}
                                    onChange={(e) => onValidationChange(index, 'minLength', e.target.value)}
                                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-[11px] font-bold text-slate-500 mb-1">Max Length</label>
                                <input
                                    type="number"
                                    value={validationRules.maxLength || ''}
                                    onChange={(e) => onValidationChange(index, 'maxLength', e.target.value)}
                                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * Main QuestionsBuilder Component
 */
export default function QuestionsBuilder({
    form,
    fields = [],
    setFields,
    sections = [],
    setSections,
    saving,
    onSave,
    success,
    error
}) {
    const [toastMessage, setToastMessage] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 6, // Prevents triggering drag on button/input clicks
            },
        })
    );

    const handleDuplicateField = (index) => {
        const source = fields[index];
        if (!source) return;

        const duplicatedField = {
            ...JSON.parse(JSON.stringify(source)),
            id: undefined,
            config_id: undefined,
            field_name: `custom_${Date.now()}`,
            field_label: `${source.field_label || 'Question'} (نسخة)`,
            display_order: index + 1
        };

        const updated = [...fields];
        updated.splice(index + 1, 0, duplicatedField);

        const withIndices = updated.map((f, i) => ({ ...f, display_order: i }));
        setFields(withIndices);

        setToastMessage(`تم نسخ السؤال "${source.field_label || ''}" بنجاح`);
        setTimeout(() => {
            setToastMessage(null);
        }, 3000);
    };

    const handleAddField = (targetSectionId = null) => {
        const newFieldName = `custom_${Date.now()}`;
        const newField = {
            field_name: newFieldName,
            field_label: 'New Question',
            field_label_ar: '',
            field_type: 'text',
            is_required: false,
            placeholder: '',
            description: '',
            help_text: '',
            is_custom: true,
            display_order: fields.length,
            section_id: targetSectionId || null,
            field_options: [],
            validation_rules: {
                customError: '',
                minLength: '',
                maxLength: '',
                minValue: '',
                maxValue: '',
                allowed_countries: ['EG', 'SA', 'AE']
            }
        };
        setFields([...fields, newField]);
    };

    const handleAddSection = () => {
        const newSection = {
            id: `sec_${Date.now()}`,
            title: `قسم جديد ${sections.length + 1}`,
            order_index: sections.length
        };
        setSections([...sections, newSection]);
    };

    const handleRemoveSection = (sectionId) => {
        if (!window.confirm('هل أنت متأكد من حذف هذا القسم؟ (الأسئلة التي بداخله ستتحول إلى أسئلة عامة ولن تُحذف)')) return;
        // Unlink questions from this section
        setFields(fields.map(f => f.section_id === sectionId ? { ...f, section_id: null } : f));
        setSections(sections.filter(s => s.id !== sectionId));
    };

    const handleSectionTitleChange = (sectionId, newTitle) => {
        setSections(sections.map(s => s.id === sectionId ? { ...s, title: newTitle } : s));
    };

    const handleRemoveField = (index) => {
        if (isCoreField(fields[index].field_name)) {
            alert('Core system fields cannot be deleted.');
            return;
        }
        setFields(fields.filter((_, i) => i !== index));
    };

    const handleFieldChange = (index, key, value) => {
        setFields(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [key]: value };
            return updated;
        });
    };

    const handleValidationChange = (index, ruleKey, value) => {
        const updated = [...fields];
        const currentRules = updated[index].validation_rules || {};
        updated[index] = {
            ...updated[index],
            validation_rules: {
                ...currentRules,
                [ruleKey]: value
            }
        };
        setFields(updated);
    };

    const handleMoveToSection = (fieldName, targetSectionId) => {
        setFields(fields.map(f => f.field_name === fieldName ? { ...f, section_id: targetSectionId } : f));
    };

    // Dnd-Kit Reorder Handler
    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = fields.findIndex(f => f.field_name === active.id);
        const newIndex = fields.findIndex(f => f.field_name === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
            // Adopt the target section if dragged into another section
            const targetField = fields[newIndex];
            const reordered = arrayMove(fields, oldIndex, newIndex);

            if (targetField) {
                reordered[newIndex] = {
                    ...reordered[newIndex],
                    section_id: targetField.section_id || null
                };
            }

            // Reassign display_order indices
            const withIndices = reordered.map((f, i) => ({ ...f, display_order: i }));
            setFields(withIndices);
        }
    };

    // Group fields into Sections & Root questions
    const rootFields = fields.filter(f => !f.section_id);

    return (
        <div className="space-y-6 max-w-7xl text-left" dir="ltr">
            {/* Action Bar */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h3 className="text-base font-black text-slate-900">Questions & Sections Builder</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {fields.length} questions organized in {sections.length} sections with drag-and-drop ordering
                    </p>
                </div>

                <div className="flex items-center gap-2.5">
                    <button
                        type="button"
                        onClick={handleAddSection}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                    >
                        <FolderKanban size={15} className="text-indigo-600" />
                        <span>إضافة قسم جديد (Add Section)</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleAddField(null)}
                        className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                    >
                        <Plus size={15} />
                        <span>إضافة سؤال (Add Question)</span>
                    </button>

                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving}
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
                    >
                        {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                        <span>{success ? 'Saved!' : 'Save Structure'}</span>
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-100 text-red-700 rounded-2xl flex items-center gap-3 border border-red-200 text-xs font-bold">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {/* DND Context for Questions Reordering */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={fields.map(f => f.field_name)}
                    strategy={verticalListSortingStrategy}
                >
                    <div className="space-y-8">
                        {/* Sections List */}
                        {sections.map((sec, secIdx) => {
                            const secQuestions = fields.filter(f => f.section_id === sec.id);

                            return (
                                <div
                                    key={sec.id}
                                    className="bg-slate-100/70 border-2 border-indigo-200/80 rounded-3xl p-5 space-y-4"
                                >
                                    {/* Section Header */}
                                    <div className="flex items-center justify-between gap-3 border-b border-indigo-100 pb-3">
                                        <div className="flex items-center gap-3 flex-1">
                                            <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0">
                                                {secIdx + 1}
                                            </span>
                                            <input
                                                type="text"
                                                value={sec.title}
                                                onChange={(e) => handleSectionTitleChange(sec.id, e.target.value)}
                                                placeholder="اسم القسم (Section Title)..."
                                                className="px-3 py-1.5 bg-white border border-indigo-200 rounded-xl text-sm font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 max-w-sm"
                                                dir="auto"
                                            />
                                            <span className="text-[11px] font-bold text-slate-500 bg-white/80 px-2.5 py-1 rounded-lg border border-slate-200">
                                                {secQuestions.length} أسئلة
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleAddField(sec.id)}
                                                className="px-3 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-black flex items-center gap-1 transition-all"
                                            >
                                                <Plus size={13} />
                                                <span>إضافة سؤال هنا</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => handleRemoveSection(sec.id)}
                                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                                                title="حذف هذا القسم"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Questions inside this Section */}
                                    {secQuestions.length === 0 ? (
                                        <div className="py-8 text-center bg-white/60 border border-dashed border-indigo-200 rounded-2xl text-xs font-bold text-slate-400">
                                            لا توجد أسئلة في هذا القسم بعد. اضغط "إضافة سؤال هنا" أو انقل سؤالاً لهذا القسم من خيارات الـ 3 نقاط.
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {secQuestions.map((field) => {
                                                const fieldIndex = fields.findIndex(f => f.field_name === field.field_name);
                                                return (
                                                    <SortableQuestionCard
                                                        key={field.field_name}
                                                        id={field.field_name}
                                                        field={field}
                                                        index={fieldIndex}
                                                        sections={sections}
                                                        onFieldChange={handleFieldChange}
                                                        onValidationChange={handleValidationChange}
                                                        onRemoveField={handleRemoveField}
                                                        onMoveToSection={handleMoveToSection}
                                                        onDuplicateField={handleDuplicateField}
                                                    />
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Root Questions (Not in any section) */}
                        {rootFields.length > 0 && (
                            <div className="space-y-3">
                                {sections.length > 0 && (
                                    <div className="flex items-center gap-2 px-2 pt-2 text-xs font-black text-slate-500 uppercase tracking-wider">
                                        <Layers size={14} className="text-slate-400" />
                                        <span>أسئلة عامة (بدون قسم / Root Level)</span>
                                    </div>
                                )}

                                {rootFields.map((field) => {
                                    const fieldIndex = fields.findIndex(f => f.field_name === field.field_name);
                                    return (
                                        <SortableQuestionCard
                                            key={field.field_name}
                                            id={field.field_name}
                                            field={field}
                                            index={fieldIndex}
                                            sections={sections}
                                            onFieldChange={handleFieldChange}
                                            onValidationChange={handleValidationChange}
                                            onRemoveField={handleRemoveField}
                                            onMoveToSection={handleMoveToSection}
                                            onDuplicateField={handleDuplicateField}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </SortableContext>
            </DndContext>

            {/* Bottom Add Question Button (Point 5) */}
            <div className="pt-2 flex items-center justify-center">
                <button
                    type="button"
                    onClick={() => handleAddField(null)}
                    className="w-full py-4 px-6 bg-white hover:bg-indigo-50/70 text-indigo-700 border-2 border-dashed border-indigo-200 hover:border-indigo-400 rounded-3xl text-xs font-black transition-all flex items-center justify-center gap-2.5 shadow-xs cursor-pointer group"
                >
                    <div className="w-6 h-6 rounded-lg bg-indigo-100 group-hover:bg-indigo-600 text-indigo-600 group-hover:text-white flex items-center justify-center transition-colors">
                        <Plus size={15} />
                    </div>
                    <span>إضافة سؤال جديد في الأسفل (Add Question)</span>
                </button>
            </div>

            {/* Success Toast Notification */}
            {toastMessage && (
                <div className="fixed bottom-6 right-6 z-50 bg-slate-900/95 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-3 backdrop-blur-sm border border-slate-800" dir="rtl">
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    <span>{toastMessage}</span>
                </div>
            )}
        </div>
    );
}
