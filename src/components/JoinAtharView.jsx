import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, Share2, Download, Loader2, Heart, Globe, MessageSquare, ImageIcon, X } from 'lucide-react';
import { getJoinAtharPage, trackJoinAtharEvent } from '../lib/api';

function cn(...classes) { return classes.filter(Boolean).join(' '); }

const PLATFORM_META = {
    whatsapp:  { label: 'WhatsApp',  color: '#25D366', buildUrl: (text) => `https://wa.me/?text=${encodeURIComponent(text)}` },
    twitter:   { label: 'Twitter/X', color: '#1DA1F2', buildUrl: (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}` },
    linkedin:  { label: 'LinkedIn',  color: '#0A66C2', buildUrl: (_text, url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
    instagram: { label: 'Instagram', color: '#E1306C', buildUrl: null },
    telegram:  { label: 'Telegram',  color: '#2CA5E0', buildUrl: (text) => `https://t.me/share/url?url=${encodeURIComponent(text)}` },
};

const COL_CLASS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' };

export default function JoinAtharView() {
    const { eventId } = useParams();
    const [searchParams] = useSearchParams();
    const lang = searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const isRtl = lang === 'ar';

    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [shareCard, setShareCard] = useState(null);
    const [userPhoto, setUserPhoto] = useState(null);
    const [photoPreview, setPhotoPreview] = useState(null);
    const [generating, setGenerating] = useState(false);
    const canvasRef = useRef(null);
    const photoInputRef = useRef(null);

    useEffect(() => {
        const loadPage = async () => {
            try {
                setLoading(true);
                const data = await getJoinAtharPage(eventId);
                setPage(data);
                if (data?.id) {
                    trackJoinAtharEvent(data.id, 'tab_view');
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        if (eventId) loadPage();
    }, [eventId]);

    const pageUrl = `${window.location.origin}${window.location.pathname}?agenda=${eventId}&lang=${lang}&tabs=join-athar`;

    const buildShareMessage = (card, platform) => {
        const preset = page?.presets?.[platform];
        if (preset) return preset.replace('{link}', pageUrl);
        return `${card?.title || 'Join Athar'}\n${pageUrl}`;
    };

    const handleShare = (card, platform) => {
        if (!page?.id) return;
        trackJoinAtharEvent(page.id, 'card_share', card?.id, platform);
        const meta = PLATFORM_META[platform];
        if (!meta) return;

        if (platform === 'instagram') {
            navigator.clipboard.writeText(buildShareMessage(card, 'instagram'));
            return;
        }
        const shareUrl = meta.buildUrl(buildShareMessage(card, platform), pageUrl);
        window.open(shareUrl, '_blank', 'noopener,noreferrer');
    };

    const openShareModal = (card) => {
        setShareCard(card);
        setUserPhoto(null);
        setPhotoPreview(null);
    };

    const handlePhotoUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUserPhoto(file);
        setPhotoPreview(URL.createObjectURL(file));
    };

    const generateImage = async () => {
        if (!shareCard || !photoPreview || !canvasRef.current) return;
        try {
            setGenerating(true);
            trackJoinAtharEvent(page?.id, 'image_upload', shareCard?.id);

            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            canvas.width = 1080;
            canvas.height = 1080;

            const loadImg = (src) =>
                new Promise((resolve, reject) => {
                    const img = new window.Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = src;
                });

            // Fill background
            ctx.fillStyle = '#0f0f1a';
            ctx.fillRect(0, 0, 1080, 1080);

            // Draw card image as blurred background if available
            if (shareCard.image_url) {
                try {
                    const bgImg = await loadImg(shareCard.image_url);
                    ctx.save();
                    ctx.filter = 'blur(30px)';
                    ctx.globalAlpha = 0.3;
                    ctx.drawImage(bgImg, -50, -50, 1180, 1180);
                    ctx.restore();
                } catch {}
            }

            // Gradient overlay
            const grad = ctx.createLinearGradient(0, 0, 0, 1080);
            grad.addColorStop(0, 'rgba(15,15,26,0.5)');
            grad.addColorStop(1, 'rgba(15,15,26,0.95)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1080, 1080);

            // User photo — circular crop
            const userImg = await loadImg(photoPreview);
            const circleDiam = 340;
            const circleX = (1080 - circleDiam) / 2;
            const circleY = 160;
            ctx.save();
            ctx.beginPath();
            ctx.arc(circleX + circleDiam / 2, circleY + circleDiam / 2, circleDiam / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(userImg, circleX, circleY, circleDiam, circleDiam);
            ctx.restore();

            // Circle border
            ctx.save();
            ctx.beginPath();
            ctx.arc(circleX + circleDiam / 2, circleY + circleDiam / 2, circleDiam / 2 + 4, 0, Math.PI * 2);
            ctx.strokeStyle = '#7c3aed';
            ctx.lineWidth = 6;
            ctx.stroke();
            ctx.restore();

            // Card title
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 52px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(shareCard.title || 'Join Athar', 540, 580);

            // Page title / event label
            ctx.fillStyle = '#a78bfa';
            ctx.font = '600 30px system-ui, sans-serif';
            ctx.fillText(page?.main_title || 'Join Athar', 540, 640);

            // Description (truncated)
            if (shareCard.description) {
                const maxW = 800;
                ctx.fillStyle = '#94a3b8';
                ctx.font = '400 26px system-ui, sans-serif';
                const words = shareCard.description.split(' ');
                let line = '';
                let y = 700;
                for (const word of words) {
                    const test = line + word + ' ';
                    if (ctx.measureText(test).width > maxW && line !== '') {
                        ctx.fillText(line, 540, y);
                        line = word + ' ';
                        y += 40;
                        if (y > 760) { ctx.fillText('...', 540, y); break; }
                    } else {
                        line = test;
                    }
                }
                if (y <= 760) ctx.fillText(line, 540, y);
            }

            // URL watermark
            ctx.fillStyle = '#475569';
            ctx.font = '400 22px system-ui, sans-serif';
            ctx.fillText(pageUrl.replace('https://', ''), 540, 960);

            // Download
            const link = document.createElement('a');
            link.download = `join-athar-${shareCard.title?.replace(/\s+/g, '-').toLowerCase() || 'card'}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            trackJoinAtharEvent(page?.id, 'image_download', shareCard?.id);
        } catch (err) {
            console.error('Image generation failed', err);
        } finally {
            setGenerating(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-violet-600 animate-spin" />
            </div>
        );
    }

    if (!page || (!page.cover_url && !page.cards?.length)) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-center p-8">
                <div className="w-20 h-20 rounded-2xl bg-violet-100 flex items-center justify-center mb-5">
                    <Heart size={36} className="text-violet-500" />
                </div>
                <h2 className="text-2xl font-black text-slate-800 mb-2">{lang === 'ar' ? 'انضم لأثر' : 'Join Athar'}</h2>
                <p className="text-slate-500 text-sm font-medium max-w-sm">
                    {lang === 'ar' ? 'محتوى هذه الصفحة قيد الإعداد.' : 'This page is being set up. Check back soon.'}
                </p>
            </div>
        );
    }

    const cols = page.layout_columns || 3;
    const colClass = COL_CLASS[cols] || COL_CLASS[3];

    return (
        <div dir={isRtl ? 'rtl' : 'ltr'} className={`min-h-screen bg-slate-50 ${isRtl ? 'font-arabic' : 'font-manrope'}`}>
            {/* Cover */}
            {page.cover_url && (
                <div className="relative h-52 sm:h-72 overflow-hidden">
                    <img
                        src={page.cover_url}
                        alt="Cover"
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-50" />
                </div>
            )}

            {/* Main Content */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
                {/* Title */}
                <div className="text-center mb-10">
                    <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                        {page.main_title || (lang === 'ar' ? 'انضم لأثر' : 'Join Athar')}
                    </h1>
                    <div className="mt-3 flex items-center justify-center gap-2">
                        <div className="h-1 w-12 rounded-full bg-violet-500" />
                        <div className="h-1 w-4 rounded-full bg-violet-300" />
                    </div>
                </div>

                {/* Cards Grid */}
                {page.cards?.length > 0 && (
                    <div className={cn('grid grid-cols-1 gap-6', colClass)}>
                        {page.cards.map((card) => (
                            <div
                                key={card.id}
                                className="group bg-white rounded-2xl border border-slate-100 shadow-md hover:shadow-xl hover:-translate-y-1 transition-all overflow-hidden flex flex-col"
                            >
                                {card.image_url ? (
                                    <div className="relative h-48 overflow-hidden">
                                        <img
                                            src={card.image_url}
                                            alt={card.title}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                                    </div>
                                ) : (
                                    <div className="h-24 bg-gradient-to-br from-violet-50 to-indigo-50 flex items-center justify-center">
                                        <ImageIcon size={28} className="text-violet-300" />
                                    </div>
                                )}

                                <div className="p-5 flex flex-col flex-1">
                                    <h3 className="text-base font-black text-slate-900 mb-2 leading-snug">{card.title}</h3>
                                    {card.description && (
                                        <p className="text-sm text-slate-500 font-medium leading-relaxed mb-4 flex-1">{card.description}</p>
                                    )}

                                    <div className="mt-auto flex gap-2 flex-wrap">
                                        {card.button_url && (
                                            <a
                                                href={card.button_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-violet-700 text-white text-xs font-bold rounded-xl hover:-translate-y-0.5 active:scale-95 transition-all shadow-md shadow-violet-500/20"
                                            >
                                                {card.button_text || 'Join Now'}
                                                <ExternalLink size={12} />
                                            </a>
                                        )}
                                        <button
                                            onClick={() => openShareModal(card)}
                                            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-50 text-slate-500 border border-slate-200 text-xs font-bold rounded-xl hover:bg-violet-50 hover:text-violet-600 hover:border-violet-200 transition-all"
                                        >
                                            <Share2 size={13} />
                                            {lang === 'ar' ? 'شارك' : 'Share'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Hidden canvas for image generation */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Share / Image Modal */}
            {shareCard && (
                <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in"
                    onClick={e => { if (e.target === e.currentTarget) setShareCard(null); }}
                >
                    <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 overflow-hidden">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-black text-slate-900">{lang === 'ar' ? 'شارك' : 'Share'}</h3>
                                <p className="text-xs text-slate-400 mt-0.5 font-semibold line-clamp-1">{shareCard.title}</p>
                            </div>
                            <button
                                onClick={() => setShareCard(null)}
                                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* Platform share buttons */}
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                                    {lang === 'ar' ? 'شارك على' : 'Share on'}
                                </p>
                                <div className="grid grid-cols-3 gap-2">
                                    {Object.entries(PLATFORM_META).map(([platform, meta]) => (
                                        <button
                                            key={platform}
                                            onClick={() => handleShare(shareCard, platform)}
                                            className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-all"
                                        >
                                            <div className="w-7 h-7 rounded-full" style={{ backgroundColor: meta.color }} />
                                            <span className="text-[10px] font-bold text-slate-600">{meta.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Custom image maker */}
                            <div className="border-t border-slate-100 pt-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                                    {lang === 'ar' ? 'أنشئ صورة خاصة بك' : 'Create your image'}
                                </p>

                                {photoPreview ? (
                                    <div className="flex items-center gap-3 mb-3">
                                        <img src={photoPreview} alt="Your photo" className="w-14 h-14 rounded-xl object-cover border-2 border-violet-200" />
                                        <div className="flex-1">
                                            <p className="text-xs font-bold text-slate-700">
                                                {lang === 'ar' ? 'صورتك جاهزة!' : 'Your photo is ready!'}
                                            </p>
                                            <button
                                                onClick={() => { setUserPhoto(null); setPhotoPreview(null); }}
                                                className="text-[11px] text-slate-400 hover:text-red-500 transition-colors mt-0.5"
                                            >
                                                {lang === 'ar' ? 'إزالة' : 'Remove'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => photoInputRef.current?.click()}
                                        className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition-all"
                                    >
                                        <ImageIcon size={15} />
                                        {lang === 'ar' ? 'ارفع صورتك' : 'Upload your photo'}
                                    </button>
                                )}
                                <input
                                    ref={photoInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handlePhotoUpload}
                                />

                                {photoPreview && (
                                    <button
                                        onClick={generateImage}
                                        disabled={generating}
                                        className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-violet-600 to-violet-800 text-white text-xs font-bold rounded-xl hover:-translate-y-0.5 active:scale-95 transition-all shadow-md shadow-violet-500/20 disabled:opacity-60 mt-2"
                                    >
                                        {generating
                                            ? <><Loader2 size={14} className="animate-spin" /> {lang === 'ar' ? 'جاري الإنشاء...' : 'Generating...'}</>
                                            : <><Download size={14} /> {lang === 'ar' ? 'تحميل الصورة' : 'Download Image'}</>
                                        }
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
