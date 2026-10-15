import { useState } from 'react';
import {
    Share2, Copy, Check, Plus, ExternalLink,
    Facebook, MessageCircle, Instagram, Send, Linkedin,
    Eye, EyeOff, Sparkles, X, CheckCheck
} from 'lucide-react';
import { updateEventForm } from '../../lib/api';
import { getAppBaseUrl } from '../../lib/utils';

const DEFAULT_PLATFORMS = [
    { key: 'facebook', label: 'Facebook', icon: Facebook, color: 'hover:bg-blue-50 text-blue-600 border-blue-200' },
    { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: 'hover:bg-emerald-50 text-emerald-600 border-emerald-200' },
    { key: 'linkedin', label: 'LinkedIn', icon: Linkedin, color: 'hover:bg-sky-700 border-sky-200' },
    { key: 'telegram', label: 'Telegram', icon: Send, color: 'hover:bg-cyan-50 text-cyan-600 border-cyan-200' },
    { key: 'instagram', label: 'Instagram', icon: Instagram, color: 'hover:bg-pink-50 text-pink-600 border-pink-200' },
];

export default function SourceTrackingToolbar({
    form,
    eventId,
    onFormUpdate
}) {
    const [copiedKey, setCopiedKey] = useState(null);
    const [showCustomModal, setShowCustomModal] = useState(false);
    const [customSourceName, setCustomSourceName] = useState('');
    const [customSourceLabel, setCustomSourceLabel] = useState('');
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    const baseUrl = `${getAppBaseUrl()}/#/forms/${eventId}/${form.form_id}`;

    const config = form.social_channels_config || {
        facebook: true,
        whatsapp: true,
        linkedin: true,
        telegram: true,
        instagram: true,
        custom: []
    };

    const copyToClipboard = (sourceKey) => {
        const link = `${baseUrl}?source=${encodeURIComponent(sourceKey)}`;
        navigator.clipboard.writeText(link);
        setCopiedKey(sourceKey);
        setTimeout(() => setCopiedKey(null), 2500);
    };

    const handleTogglePlatform = async (key) => {
        const updatedConfig = {
            ...config,
            [key]: !config[key]
        };

        try {
            setIsSavingConfig(true);
            const updated = await updateEventForm(form.form_id, {
                social_channels_config: updatedConfig
            });
            if (onFormUpdate) onFormUpdate(updated);
        } catch (err) {
            console.error('Failed to toggle platform:', err);
        } finally {
            setIsSavingConfig(false);
        }
    };

    const handleAddCustomSource = async (e) => {
        e.preventDefault();
        const trimmedKey = customSourceName.trim().toLowerCase().replace(/\s+/g, '_');
        const trimmedLabel = customSourceLabel.trim() || customSourceName.trim();
        if (!trimmedKey) return;

        const customList = Array.isArray(config.custom) ? [...config.custom] : [];
        if (!customList.some(c => c.key === trimmedKey)) {
            customList.push({ key: trimmedKey, label: trimmedLabel, active: true });
        }

        const updatedConfig = {
            ...config,
            custom: customList
        };

        try {
            setIsSavingConfig(true);
            const updated = await updateEventForm(form.form_id, {
                social_channels_config: updatedConfig
            });
            if (onFormUpdate) onFormUpdate(updated);
            setShowCustomModal(false);
            setCustomSourceName('');
            setCustomSourceLabel('');
        } catch (err) {
            console.error('Failed to add custom source:', err);
        } finally {
            setIsSavingConfig(false);
        }
    };

    const handleDeleteCustomSource = async (keyToDelete) => {
        const customList = (config.custom || []).filter(c => c.key !== keyToDelete);
        const updatedConfig = {
            ...config,
            custom: customList
        };

        try {
            setIsSavingConfig(true);
            const updated = await updateEventForm(form.form_id, {
                social_channels_config: updatedConfig
            });
            if (onFormUpdate) onFormUpdate(updated);
        } catch (err) {
            console.error('Failed to delete custom source:', err);
        } finally {
            setIsSavingConfig(false);
        }
    };

    return (
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4 text-left" dir="ltr">
            {/* Toolbar Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                        <Share2 size={16} />
                    </div>
                    <div>
                        <h4 className="text-sm font-black text-slate-900">Smart Source Tracking & Campaign Links</h4>
                        <p className="text-[11px] text-slate-500">Copy pre-tagged URLs to automatically track traffic origins when respondents submit.</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowCustomModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                    >
                        <Plus size={14} />
                        Custom Source
                    </button>
                    <a
                        href={baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-xs font-bold transition-all"
                    >
                        <ExternalLink size={13} />
                        Public URL
                    </a>
                </div>
            </div>

            {/* Notification Toast */}
            {copiedKey && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800 animate-in fade-in zoom-in-95">
                    <div className="flex items-center gap-2 font-bold">
                        <CheckCheck size={16} className="text-emerald-600" />
                        Tracking link for source "{copiedKey}" copied to clipboard!
                    </div>
                    <span className="text-[10px] text-emerald-600 font-mono">?source={copiedKey}</span>
                </div>
            )}

            {/* Platform Buttons Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {DEFAULT_PLATFORMS.map((platform) => {
                    const Icon = platform.icon;
                    const isVisible = config[platform.key] !== false;
                    const isCopied = copiedKey === platform.key;

                    return (
                        <div
                            key={platform.key}
                            className={`p-3 rounded-2xl border transition-all flex flex-col justify-between gap-2.5 ${
                                isVisible ? 'bg-slate-50/70 border-slate-200' : 'bg-slate-100/60 border-slate-200 opacity-60'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Icon size={16} className={platform.color.split(' ')[1]} />
                                    <span className="text-xs font-black text-slate-800">{platform.label}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleTogglePlatform(platform.key)}
                                    title={isVisible ? 'Hide channel' : 'Enable channel'}
                                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    {isVisible ? <Eye size={13} className="text-blue-600" /> : <EyeOff size={13} />}
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => copyToClipboard(platform.key)}
                                className={`w-full py-1.5 px-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs ${
                                    isCopied
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                }`}
                            >
                                {isCopied ? <Check size={13} /> : <Copy size={13} />}
                                {isCopied ? 'Copied' : 'Copy Link'}
                            </button>
                        </div>
                    );
                })}

                {/* Custom Platforms */}
                {(config.custom || []).map((custom) => {
                    const isCopied = copiedKey === custom.key;
                    return (
                        <div
                            key={custom.key}
                            className="p-3 rounded-2xl border border-purple-200 bg-purple-50/40 flex flex-col justify-between gap-2.5"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 truncate">
                                    <Sparkles size={14} className="text-purple-600 shrink-0" />
                                    <span className="text-xs font-black text-purple-900 truncate" dir="auto">{custom.label}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteCustomSource(custom.key)}
                                    className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                    title="Delete custom source"
                                >
                                    <X size={12} />
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => copyToClipboard(custom.key)}
                                className={`w-full py-1.5 px-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs ${
                                    isCopied
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-white hover:bg-purple-50 text-purple-700 border border-purple-200'
                                }`}
                            >
                                {isCopied ? <Check size={13} /> : <Copy size={13} />}
                                {isCopied ? 'Copied' : 'Copy Link'}
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Custom Source Modal */}
            {showCustomModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" dir="ltr">
                    <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl w-full max-w-md space-y-4 text-left">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                                <Sparkles size={18} className="text-purple-600" />
                                Add Custom Traffic Source
                            </h3>
                            <button
                                onClick={() => setShowCustomModal(false)}
                                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-xl"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleAddCustomSource} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">
                                    Source Key (in URL query) *
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. newsletter, qr_booth_1, sponsor_x"
                                    value={customSourceName}
                                    onChange={(e) => setCustomSourceName(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-medium focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">Appended as ?source={customSourceName || 'source_key'}</p>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">
                                    Display Label
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Email Newsletter, Booth QR Code"
                                    value={customSourceLabel}
                                    onChange={(e) => setCustomSourceLabel(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                    dir="auto"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCustomModal(false)}
                                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!customSourceName.trim() || isSavingConfig}
                                    className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black transition-all shadow-xs disabled:opacity-50"
                                >
                                    Save & Generate Link
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
