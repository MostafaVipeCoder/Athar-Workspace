import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    ArrowLeft, Save, Plus, Trash2, Loader2, Upload, X, Image as ImageIcon,
    ExternalLink, BarChart3, Eye, Share2, Download, Grid3X3, LayoutGrid,
    ChevronUp, ChevronDown, Globe, MessageSquare, Heart, MousePointerClick,
    AlertCircle, RefreshCw, Link2, Type, SquareArrowOutUpRight
} from 'lucide-react';
import { getJoinAtharPage, saveJoinAtharPage, getJoinAtharAnalytics, uploadImage as apiUploadImage } from '../lib/api';

function cn(...classes) { return classes.filter(Boolean).join(' '); }

const EMPTY_CARD = () => ({
    _key: Math.random().toString(36).slice(2),
    image_url: '',
    title: '',
    description: '',
    button_text: 'Join Now',
    button_url: '',
});

const PLATFORM_META = {
    whatsapp:  { label: 'WhatsApp',  color: '#25D366' },
    twitter:   { label: 'Twitter/X', color: '#1DA1F2' },
    linkedin:  { label: 'LinkedIn',  color: '#0A66C2' },
    instagram: { label: 'Instagram', color: '#E1306C' },
    telegram:  { label: 'Telegram',  color: '#2CA5E0' },
};

function StatCard({ icon: Icon, label, value, sub, color }) {
    return (
        <div className="bg-card border border-border/60 rounded-2xl p-5 flex flex-col gap-2 relative overflow-hidden">
            <div
                className="absolute top-0 right-0 w-24 h-24 rounded-bl-full -mr-6 -mt-6 pointer-events-none opacity-50"
                style={{ background: `radial-gradient(circle, ${color}20 0%, transparent 70%)` }}
            />
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${color}15`, color }}>
                    <Icon size={18} />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
            </div>
            <p className="text-3xl font-black text-foreground tracking-tight">{value}</p>
            {sub && <p className="text-xs text-muted-foreground font-semibold">{sub}</p>}
        </div>
    );
}

export default function JoinAtharDashboard() {
    const params = useParams();
    const eventId = params.eventId || params.id;

    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('builder');
    const [toast, setToast] = useState(null);

    const [mainTitle, setMainTitle] = useState('Join Athar');
    const [coverUrl, setCoverUrl] = useState('');
    const [layoutColumns, setLayoutColumns] = useState(3);
    const [cards, setCards] = useState([EMPTY_CARD()]);
    const [presets, setPresets] = useState({});

    const [uploadingCover, setUploadingCover] = useState(false);
    const [uploadingCardIdx, setUploadingCardIdx] = useState(null);
    const coverInputRef = useRef(null);
    const cardInputRefs = useRef({});

    const [analytics, setAnalytics] = useState(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);

    const showToast = useCallback((msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    useEffect(() => { loadPage(); }, [eventId]);

    const loadPage = async () => {
        try {
            setLoading(true);
            const data = await getJoinAtharPage(eventId);
            if (data) {
                setPage(data);
                setMainTitle(data.main_title || 'Join Athar');
                setCoverUrl(data.cover_url || '');
                setLayoutColumns(data.layout_columns || 3);
                setCards(
                    data.cards?.length
                        ? data.cards.map(c => ({ ...c, _key: c.id || Math.random().toString(36).slice(2) }))
                        : [EMPTY_CARD()]
                );
                setPresets(data.presets || {});
            }
        } catch (e) {
            console.error(e);
            showToast('Failed to load page data', 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadAnalytics = async () => {
        if (!page?.id) return;
        try {
            setAnalyticsLoading(true);
            const data = await getJoinAtharAnalytics(page.id);
            setAnalytics(data);
        } catch (e) {
            console.error(e);
        } finally {
            setAnalyticsLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'analytics') loadAnalytics();
    }, [activeTab, page?.id]);

    const uploadImage = async (file) => {
        return await apiUploadImage(file, `join-athar/${eventId}`);
    };

    const handleCoverUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            setUploadingCover(true);
            const url = await uploadImage(file);
            setCoverUrl(url);
        } catch (err) {
            console.error('Cover upload failed:', err);
            showToast('Cover upload failed', 'error');
        } finally {
            setUploadingCover(false);
            if (coverInputRef.current) coverInputRef.current.value = '';
        }
    };

    const handleCardImageUpload = async (e, idx) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            setUploadingCardIdx(idx);
            const url = await uploadImage(file);
            setCards(prev => prev.map((c, i) => i === idx ? { ...c, image_url: url } : c));
        } catch (err) {
            console.error('Image upload failed:', err);
            showToast('Image upload failed', 'error');
        } finally {
            setUploadingCardIdx(null);
        }
    };

    const updateCard = (idx, field, value) =>
        setCards(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));

    const addCard = () => setCards(prev => [...prev, EMPTY_CARD()]);

    const removeCard = (idx) => setCards(prev => prev.filter((_, i) => i !== idx));

    const moveCard = (idx, dir) => {
        setCards(prev => {
            const next = [...prev];
            const target = idx + dir;
            if (target < 0 || target >= next.length) return prev;
            [next[idx], next[target]] = [next[target], next[idx]];
            return next;
        });
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            const saved = await saveJoinAtharPage(eventId, {
                main_title: mainTitle,
                cover_url: coverUrl || null,
                layout_columns: layoutColumns,
                cards: cards.map(({ _key, id, page_id, ...rest }) => rest),
                presets,
            });
            setPage(saved);
            showToast('Saved successfully \u2713');
        } catch (err) {
            console.error(err);
            showToast('Failed to save', 'error');
        } finally {
            setSaving(false);
        }
    };

    const publicUrl = `${window.location.origin}${window.location.pathname}#/view/${eventId}/join-athar`;

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-violet-600 animate-spin" />
            </div>
        );
    }

    const TABS = [
        { id: 'builder',   label: 'Page Builder',  icon: LayoutGrid },
        { id: 'share',     label: 'Share Presets', icon: Share2 },
        { id: 'analytics', label: 'Analytics',     icon: BarChart3 },
    ];

    return (
        <div className="min-h-screen bg-background font-manrope text-foreground relative overflow-x-hidden pb-24">
            <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-500/5 via-background to-background" />

            {/* Header */}
            <div className="relative z-20 bg-background/70 backdrop-blur-xl border-b border-border/50 sticky top-0 shadow-sm">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <Link
                            to={`/event/${eventId}`}
                            className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10 text-violet-600 hover:bg-violet-600 hover:text-white transition-all border border-violet-500/20 shrink-0"
                        >
                            <ArrowLeft size={18} />
                        </Link>
                        <div>
                            <h1 className="text-base sm:text-xl font-extrabold text-foreground tracking-tight">Join Athar</h1>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest leading-none mt-0.5 hidden sm:block">
                                Landing Page Builder
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <a
                            href={publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-border/60 bg-background text-muted-foreground hover:text-violet-600 hover:border-violet-500/30 transition-all"
                        >
                            <Eye size={14} />
                            <span>Preview</span>
                        </a>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-violet-600 to-violet-800 text-white shadow-md shadow-violet-500/20 hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-60"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            <span>{saving ? 'Saving...' : 'Save'}</span>
                        </button>
                    </div>
                </div>

                <div className="max-w-6xl mx-auto px-4 sm:px-6 border-t border-border/30 flex items-center gap-1 overflow-x-auto">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                'flex items-center gap-1.5 px-4 py-3 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all whitespace-nowrap',
                                activeTab === tab.id
                                    ? 'border-violet-600 text-violet-600'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <tab.icon size={13} />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-8">

                {/* ── Builder Tab ── */}
                {activeTab === 'builder' && (
                    <div className="space-y-8">
                        {/* Page Settings */}
                        <section className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-5 flex items-center gap-2">
                                <Type size={14} />
                                Page Settings
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-xs font-black uppercase tracking-widest text-muted-foreground mb-1.5">Page Title</label>
                                    <input
                                        type="text"
                                        value={mainTitle}
                                        onChange={e => setMainTitle(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
                                        placeholder="Join Athar"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black uppercase tracking-widest text-muted-foreground mb-1.5">Card Columns</label>
                                    <div className="flex gap-2">
                                        {[2, 3, 4].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setLayoutColumns(n)}
                                                className={cn(
                                                    'flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-bold transition-all',
                                                    layoutColumns === n
                                                        ? 'border-violet-500 bg-violet-500/10 text-violet-700'
                                                        : 'border-border/60 text-muted-foreground hover:border-violet-400/40 hover:text-violet-600'
                                                )}
                                            >
                                                <Grid3X3 size={16} />
                                                {n} Cols
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Cover Image */}
                        <section className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-5 flex items-center gap-2">
                                <ImageIcon size={14} />
                                Cover Image
                            </h2>
                            <div className="flex flex-col sm:flex-row gap-5 items-start">
                                {coverUrl ? (
                                    <div className="relative group shrink-0">
                                        <img
                                            src={coverUrl}
                                            alt="Cover"
                                            className="w-full sm:w-72 h-40 object-cover rounded-xl border border-border/60"
                                        />
                                        <button
                                            onClick={() => setCoverUrl('')}
                                            className="absolute top-2 right-2 p-1.5 bg-black/60 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                ) : (
                                    <div
                                        onClick={() => coverInputRef.current?.click()}
                                        className="w-full sm:w-72 h-40 border-2 border-dashed border-border/60 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-violet-400/60 hover:bg-violet-500/5 transition-all group"
                                    >
                                        {uploadingCover
                                            ? <Loader2 size={24} className="text-violet-500 animate-spin" />
                                            : <Upload size={24} className="text-muted-foreground group-hover:text-violet-500 transition-colors" />
                                        }
                                        <span className="text-xs font-semibold text-muted-foreground">
                                            {uploadingCover ? 'Uploading...' : 'Upload Cover'}
                                        </span>
                                    </div>
                                )}
                                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />

                                <div className="flex-1 space-y-2">
                                    <p className="text-xs text-muted-foreground font-semibold">Or paste an image URL directly:</p>
                                    <div className="flex gap-2">
                                        <input
                                            type="url"
                                            value={coverUrl}
                                            onChange={e => setCoverUrl(e.target.value)}
                                            placeholder="https://..."
                                            className="flex-1 px-3 py-2 bg-background border border-border/60 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
                                        />
                                        {!coverUrl && (
                                            <button
                                                onClick={() => coverInputRef.current?.click()}
                                                className="px-3 py-2 bg-violet-500/10 text-violet-600 border border-violet-500/20 rounded-lg text-xs font-bold hover:bg-violet-500/20 transition-all"
                                            >
                                                Upload
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">Recommended: 1200x400px, aspect ratio 3:1</p>
                                </div>
                            </div>
                        </section>

                        {/* Cards */}
                        <section className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-5">
                                <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                    <LayoutGrid size={14} />
                                    Opportunity Cards ({cards.length})
                                </h2>
                                <button
                                    onClick={addCard}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-violet-600 bg-violet-500/10 border border-violet-500/20 rounded-lg hover:bg-violet-500/20 transition-all"
                                >
                                    <Plus size={14} />
                                    Add Card
                                </button>
                            </div>

                            <div className="space-y-5">
                                {cards.map((card, idx) => (
                                    <div key={card._key} className="border border-border/60 rounded-xl p-5 bg-background/50">
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Card {idx + 1}</span>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => moveCard(idx, -1)} disabled={idx === 0} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-all">
                                                    <ChevronUp size={14} />
                                                </button>
                                                <button onClick={() => moveCard(idx, 1)} disabled={idx === cards.length - 1} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-all">
                                                    <ChevronDown size={14} />
                                                </button>
                                                <button onClick={() => removeCard(idx)} className="p-1 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div>
                                                <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Card Image</label>
                                                {card.image_url ? (
                                                    <div className="relative group/img">
                                                        <img src={card.image_url} alt="" className="w-full h-28 object-cover rounded-lg border border-border/60" />
                                                        <button
                                                            onClick={() => updateCard(idx, 'image_url', '')}
                                                            className="absolute top-1.5 right-1.5 p-1 bg-black/60 text-white rounded-md opacity-0 group-hover/img:opacity-100 hover:bg-red-600 transition-all"
                                                        >
                                                            <X size={11} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div
                                                        onClick={() => cardInputRefs.current[idx]?.click()}
                                                        className="w-full h-28 border-2 border-dashed border-border/60 rounded-lg flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-violet-400/60 hover:bg-violet-500/5 transition-all"
                                                    >
                                                        {uploadingCardIdx === idx
                                                            ? <Loader2 size={18} className="text-violet-500 animate-spin" />
                                                            : <Upload size={18} className="text-muted-foreground" />
                                                        }
                                                        <span className="text-[10px] font-semibold text-muted-foreground">
                                                            {uploadingCardIdx === idx ? 'Uploading...' : 'Upload Image'}
                                                        </span>
                                                    </div>
                                                )}
                                                <input
                                                    ref={el => { cardInputRefs.current[idx] = el; }}
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={e => handleCardImageUpload(e, idx)}
                                                />
                                                <input
                                                    type="url"
                                                    value={card.image_url}
                                                    onChange={e => updateCard(idx, 'image_url', e.target.value)}
                                                    placeholder="or paste URL..."
                                                    className="mt-1.5 w-full px-2.5 py-1.5 bg-background border border-border/60 rounded-lg text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-violet-400 transition-all"
                                                />
                                            </div>

                                            <div className="md:col-span-2 grid grid-cols-1 gap-3">
                                                <div>
                                                    <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Title</label>
                                                    <input
                                                        type="text"
                                                        value={card.title}
                                                        onChange={e => updateCard(idx, 'title', e.target.value)}
                                                        placeholder="e.g. Become a Mentor"
                                                        className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-violet-400 transition-all"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Description</label>
                                                    <textarea
                                                        rows={2}
                                                        value={card.description}
                                                        onChange={e => updateCard(idx, 'description', e.target.value)}
                                                        placeholder="Brief description of this opportunity..."
                                                        className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-violet-400 transition-all resize-none"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Button Text</label>
                                                        <input
                                                            type="text"
                                                            value={card.button_text}
                                                            onChange={e => updateCard(idx, 'button_text', e.target.value)}
                                                            placeholder="Apply Now"
                                                            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-violet-400 transition-all"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Button URL</label>
                                                        <input
                                                            type="url"
                                                            value={card.button_url}
                                                            onChange={e => updateCard(idx, 'button_url', e.target.value)}
                                                            placeholder="https://..."
                                                            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-violet-400 transition-all"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {cards.length === 0 && (
                                    <div className="text-center py-12 border-2 border-dashed border-border/60 rounded-xl">
                                        <LayoutGrid size={32} className="mx-auto text-muted-foreground/40 mb-3" />
                                        <p className="text-sm font-semibold text-muted-foreground">No cards yet</p>
                                        <button onClick={addCard} className="mt-3 text-xs font-bold text-violet-600 hover:text-violet-700 transition-colors">
                                            + Add your first card
                                        </button>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Public Link */}
                        <section className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                                <Link2 size={14} />
                                Public Link
                            </h2>
                            <div className="flex gap-2">
                                <input
                                    readOnly
                                    value={publicUrl}
                                    className="flex-1 px-3 py-2.5 bg-muted/40 border border-border/60 rounded-xl text-xs font-mono text-muted-foreground"
                                />
                                <button
                                    onClick={() => { navigator.clipboard.writeText(publicUrl); showToast('Copied!'); }}
                                    className="px-4 py-2.5 bg-violet-500/10 text-violet-600 border border-violet-500/20 rounded-xl text-xs font-bold hover:bg-violet-500/20 transition-all"
                                >
                                    Copy
                                </button>
                                <a
                                    href={publicUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-2.5 bg-background border border-border/60 rounded-xl text-muted-foreground hover:text-violet-600 hover:border-violet-400/40 transition-all"
                                >
                                    <SquareArrowOutUpRight size={14} />
                                </a>
                            </div>
                        </section>
                    </div>
                )}

                {/* ── Share Presets Tab ── */}
                {activeTab === 'share' && (
                    <div className="space-y-5">
                        <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-2">
                                <Share2 size={14} />
                                Share Message Presets
                            </h2>
                            <p className="text-xs text-muted-foreground font-semibold mb-6">
                                Pre-fill social share messages. Use <code className="bg-muted px-1 py-0.5 rounded text-[10px]">{'{link}'}</code> to insert the public page URL.
                            </p>
                            <div className="space-y-5">
                                {Object.entries(PLATFORM_META).map(([platform, meta]) => (
                                    <div key={platform} className="space-y-1.5">
                                        <label className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
                                            <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: meta.color }} />
                                            {meta.label}
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={presets[platform] || ''}
                                            onChange={e => setPresets(prev => ({ ...prev, [platform]: e.target.value }))}
                                            placeholder={`Share message for ${meta.label}... (include {link})`}
                                            className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all resize-none"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-violet-600 to-violet-800 text-white shadow-md shadow-violet-500/20 hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-60"
                            >
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                Save Presets
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Analytics Tab ── */}
                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        {analyticsLoading ? (
                            <div className="flex flex-col items-center justify-center py-24">
                                <Loader2 className="w-10 h-10 text-violet-600 animate-spin mb-4" />
                                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Loading analytics...</p>
                            </div>
                        ) : !analytics || analytics.tabViews === 0 ? (
                            <div className="text-center py-20 bg-card border border-border/60 rounded-2xl">
                                <BarChart3 className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                                <h3 className="text-xl font-black text-foreground tracking-tight">No Data Yet</h3>
                                <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                                    Analytics will populate once visitors start interacting with your Join Athar page.
                                </p>
                                <button
                                    onClick={loadAnalytics}
                                    className="mt-6 flex items-center gap-2 mx-auto px-4 py-2 text-xs font-bold text-violet-600 bg-violet-500/10 rounded-lg hover:bg-violet-500/20 transition-all"
                                >
                                    <RefreshCw size={13} />
                                    Refresh
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <StatCard icon={Eye}                label="Tab Views"    value={analytics.tabViews}        color="#7c3aed" />
                                    <StatCard icon={Share2}             label="Card Shares"  value={analytics.cardShares}      color="#2563eb" />
                                    <StatCard icon={Download}           label="Downloads"    value={analytics.imageDownloads}  color="#059669" />
                                    <StatCard icon={MousePointerClick}  label="Conversion"   value={`${analytics.conversionRate}%`} sub="views to downloads" color="#ea580c" />
                                </div>

                                {Object.keys(analytics.byPlatform).length > 0 && (
                                    <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
                                        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-5">Shares by Platform</h3>
                                        <div className="space-y-3">
                                            {Object.entries(analytics.byPlatform)
                                                .sort(([, a], [, b]) => b - a)
                                                .map(([platform, count]) => {
                                                    const meta = PLATFORM_META[platform] || { label: platform, color: '#6b7280' };
                                                    const max = Math.max(...Object.values(analytics.byPlatform));
                                                    const pct = Math.round((count / max) * 100);
                                                    return (
                                                        <div key={platform} className="flex items-center gap-3">
                                                            <span className="text-xs font-bold text-foreground w-24 shrink-0">{meta.label}</span>
                                                            <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full transition-all duration-700"
                                                                    style={{ width: `${pct}%`, backgroundColor: meta.color }}
                                                                />
                                                            </div>
                                                            <span className="text-xs font-black text-foreground w-8 text-right">{count}</span>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {toast && (
                <div className={cn(
                    'fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-sm font-bold shadow-2xl animate-in slide-in-from-bottom-4 duration-300 flex items-center gap-2',
                    toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
                )}>
                    {toast.type === 'error' && <AlertCircle size={15} />}
                    {toast.msg}
                </div>
            )}
        </div>
    );
}
