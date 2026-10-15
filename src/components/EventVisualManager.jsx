import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Upload,
    Save,
    Loader2,
    Check,
    Eye,
} from 'lucide-react';
import { getEvent, updateEvent, uploadImage, getEventSlug } from '../lib/api';
import { getGoogleDriveDirectLink } from '../lib/utils';

export default function EventVisualManager() {
    const { eventId } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);

    const [event, setEvent] = useState(null);

    const [settings, setSettings] = useState({
        background_image_url: '',
        footer_image_url: '',
    });

    const [uploading, setUploading] = useState({
        background_image_url: false,
        footer_image_url: false,
    });

    useEffect(() => {
        loadEventDetails();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId]);

    const loadEventDetails = async () => {
        try {
            setLoading(true);
            const data = await getEvent(eventId);
            setEvent(data);
            setSettings({
                background_image_url: data.background_image_url || '',
                footer_image_url: data.footer_image_url || '',
            });
        } catch (error) {
            console.error('Error loading event:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e, field) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            setUploading(prev => ({ ...prev, [field]: true }));
            const publicUrl = await uploadImage(file, 'visuals');
            setSettings(prev => ({ ...prev, [field]: publicUrl }));
        } catch (error) {
            console.error('Upload failed:', error);
            alert('Failed to upload image. Please try again.');
        } finally {
            setUploading(prev => ({ ...prev, [field]: false }));
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setSuccess(false);
            await updateEvent(eventId, settings);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (error) {
            console.error('Error saving visuals:', error);
            alert('Failed to save visual settings.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-white font-manrope">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1a27c9]"></div>
            </div>
        );
    }

    const ImageSection = ({ field, label, subtitle, accentClass }) => (
        <section className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
            <div className="flex items-center gap-3 mb-8">
                <div className={`p-3 rounded-2xl ${accentClass}`}>
                    <Upload size={24} />
                </div>
                <div>
                    <h2 className="text-xl font-black text-[#0d0e0e]">{label}</h2>
                    <p className="text-sm text-slate-500 font-medium">{subtitle}</p>
                </div>
            </div>
            <div className="relative group rounded-3xl overflow-hidden border-2 border-dashed border-slate-200 aspect-[3/1] bg-slate-50 flex items-center justify-center">
                {settings[field] ? (
                    <>
                        <img
                            src={getGoogleDriveDirectLink(settings[field])}
                            className="w-full h-full object-cover"
                            alt={label}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                            <label className="cursor-pointer bg-white text-black px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-100 transition-premium">
                                Change Image
                                <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, field)} accept="image/*" />
                            </label>
                            <button
                                onClick={() => setSettings(prev => ({ ...prev, [field]: '' }))}
                                className="bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-600 transition-premium"
                            >
                                Remove
                            </button>
                        </div>
                    </>
                ) : (
                    <label className="cursor-pointer flex flex-col items-center gap-3">
                        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 text-slate-400 group-hover:scale-110 transition-transform">
                            <Upload size={32} />
                        </div>
                        <span className="text-sm font-bold text-slate-400">Click to upload {label.toLowerCase()}</span>
                        <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, field)} accept="image/*" />
                    </label>
                )}
                {uploading[field] && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                        <Loader2 className="animate-spin text-[#1a27c9]" size={40} />
                    </div>
                )}
            </div>
        </section>
    );

    return (
        <div className="min-h-screen bg-gray-200 font-manrope pb-24">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => navigate(`/event/${eventId}`)}
                                className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-500 transition-premium tap-target shrink-0"
                            >
                                <ArrowLeft size={24} />
                            </button>
                            <div>
                                <h1 className="text-lg sm:text-xl font-black text-[#0d0e0e] tracking-tight">Event Visuals</h1>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mt-1">Background & Footer</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                            <a
                                href={`#/agenda/${getEventSlug(event) || eventId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-premium tap-target"
                            >
                                <Eye size={18} />
                                <span className="hidden xs:inline">Preview</span>
                            </a>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 px-4 sm:px-6 py-2.5 bg-[#1a27c9] text-white rounded-xl font-bold hover:shadow-lg hover:shadow-indigo-100 disabled:opacity-50 transition-premium tap-target"
                            >
                                {saving ? <Loader2 className="animate-spin" size={18} /> : (success ? <Check size={18} /> : <Save size={18} />)}
                                <span>{saving ? 'Saving...' : (success ? 'Saved!' : 'Save Changes')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
                <div className="grid grid-cols-1 gap-8">

                    <ImageSection
                        field="background_image_url"
                        label="Background Image"
                        subtitle="الصورة الخلفية لصفحة الأجندة العامة"
                        accentClass="bg-violet-50 text-violet-600"
                    />

                    <ImageSection
                        field="footer_image_url"
                        label="Footer Image"
                        subtitle="صورة أو شعار الفوتر في الصفحة"
                        accentClass="bg-emerald-50 text-emerald-600"
                    />

                </div>
            </div>
        </div>
    );
}
