import { useState } from 'react';
import {
    Settings, Image, MessageSquare,
    Save, Loader, Eye, EyeOff, Share2, Tag
} from 'lucide-react';
import { updateEventForm, uploadImage } from '../../lib/api';
import { getGoogleDriveDirectLink } from '../../lib/utils';
import CoverLibraryModal from './CoverLibraryModal';

export default function FormSettingsTab({
    form,
    eventId,
    fields = [],
    onFormUpdate
}) {
    const [formName, setFormName] = useState(form.form_name || '');
    const [description, setDescription] = useState(form.description || '');
    const [isActive, setIsActive] = useState(form.is_active ?? true);
    const [selectedCover, setSelectedCover] = useState(form.form_covers || (form.cover_id ? { cover_id: form.cover_id, image_url: form.cover_image_url } : null));
    const [showCoverModal, setShowCoverModal] = useState(false);

    // Thank You page settings
    const [thankYouMessage, setThankYouMessage] = useState(
        form.thank_you_message || 'Thank you {name}! Your submission has been received successfully.'
    );
    const [thankYouImageUrl, setThankYouImageUrl] = useState(form.thank_you_image_url || '');
    const [showThankYouImage, setShowThankYouImage] = useState(form.show_thank_you_image ?? true);
    const [uploadingThankYouImg, setUploadingThankYouImg] = useState(false);

    // Social Share & OG settings
    const [shareTitle, setShareTitle] = useState(form.share_title || form.form_name || '');
    const [shareDescription, setShareDescription] = useState(
        form.share_description || 'Join us and take part in this opportunity! Click the link to submit now.'
    );
    const [shareImageUrl, setShareImageUrl] = useState(form.share_image_url || form.cover_image_url || '');
    const [uploadingShareImg, setUploadingShareImg] = useState(false);

    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const handleSave = async () => {
        try {
            setSaving(true);
            const updates = {
                form_name: formName.trim(),
                description: description.trim() || null,
                is_active: isActive,
                cover_id: selectedCover?.cover_id || null,
                cover_image_url: selectedCover?.image_url || null,
                thank_you_message: thankYouMessage,
                thank_you_image_url: thankYouImageUrl,
                show_thank_you_image: showThankYouImage,
                share_title: shareTitle,
                share_description: shareDescription,
                share_image_url: shareImageUrl
            };

            const updated = await updateEventForm(form.form_id, updates);
            if (onFormUpdate) onFormUpdate(updated);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err) {
            console.error('Failed to save form settings:', err);
            alert('Failed to save settings. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const handleUploadThankYouImage = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            setUploadingThankYouImg(true);
            const url = await uploadImage(file, 'posters');
            setThankYouImageUrl(url);
        } catch (err) {
            console.error('Thank you image upload failed:', err);
        } finally {
            setUploadingThankYouImg(false);
        }
    };

    const handleUploadShareImage = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            setUploadingShareImg(true);
            const url = await uploadImage(file, 'og-images');
            setShareImageUrl(url);
        } catch (err) {
            console.error('Share image upload failed:', err);
        } finally {
            setUploadingShareImg(false);
        }
    };

    // Insert variable pill into thank you message
    const insertVariable = (varName) => {
        setThankYouMessage(prev => `${prev} {${varName}} `);
    };

    return (
        <div className="space-y-6 max-w-4xl text-left" dir="ltr">
            {/* Action Bar */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                    <h3 className="text-base font-black text-slate-900">Form Settings & Post-Submission Experience</h3>
                    <p className="text-xs text-slate-500">Configure form identity, cover images, thank you screens, and viral share cards.</p>
                </div>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-xs disabled:opacity-50 shrink-0"
                >
                    {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                    {saveSuccess ? 'Saved Successfully!' : 'Save Settings'}
                </button>
            </div>

            {/* Basic Info */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Settings size={14} className="text-blue-600" />
                    Basic Details & Status
                </h4>

                <div className="space-y-3">
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Form Title *</label>
                        <input
                            type="text"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder="Form Title"
                            dir="auto"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Form Description</label>
                        <textarea
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional instructions or overview displayed at the top of the form"
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 leading-relaxed"
                            dir="auto"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <div>
                        <span className="text-xs font-bold text-slate-800">Form Availability Status</span>
                        <p className="text-[11px] text-slate-400">When disabled, visitors see a message indicating the form is currently closed.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsActive(!isActive)}
                        className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                            isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}
                    >
                        {isActive ? 'Form Active' : 'Form Inactive (Closed)'}
                    </button>
                </div>
            </div>

            {/* Independent Cover Section */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <Image size={14} className="text-indigo-600" />
                            Form Cover Image
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Select a shared visual cover from your project's Cover Library.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowCoverModal(true)}
                        className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                    >
                        <Image size={14} />
                        {selectedCover ? 'Change Cover' : 'Select Cover'}
                    </button>
                </div>

                {selectedCover?.image_url ? (
                    <div className="relative rounded-2xl overflow-hidden border border-slate-200 h-44 group">
                        <img
                            src={getGoogleDriveDirectLink(selectedCover.image_url)}
                            alt="Form Cover"
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button
                                type="button"
                                onClick={() => setShowCoverModal(true)}
                                className="px-4 py-2 bg-white text-slate-900 rounded-xl text-xs font-bold shadow-lg hover:bg-slate-100"
                            >
                                Change Cover
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelectedCover(null)}
                                className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold shadow-lg hover:bg-red-700"
                            >
                                Remove Cover
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        onClick={() => setShowCoverModal(true)}
                        className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/20 transition-all"
                    >
                        <Image size={32} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-xs font-bold text-slate-600">No cover image selected</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Click here to pick or upload a banner from the Cover Library.</p>
                    </div>
                )}
            </div>

            {/* Thank You Page Experience */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div>
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <MessageSquare size={14} className="text-emerald-600" />
                        Thank You Page Experience
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Customize post-submission confirmation messages, dynamic answer tokens, and badges.
                    </p>
                </div>

                {/* Variable Pills */}
                <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-600">Dynamic Tokens:</span>
                    <div className="flex flex-wrap gap-1.5">
                        {['name', 'company', 'email', 'phone'].map(v => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => insertVariable(v)}
                                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold border border-emerald-200 transition-all flex items-center gap-1"
                            >
                                <Tag size={11} />
                                {`{${v}}`}
                            </button>
                        ))}
                        {fields.slice(0, 5).map(f => (
                            <button
                                key={f.field_name}
                                type="button"
                                onClick={() => insertVariable(f.field_label || f.field_name)}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 transition-all"
                                dir="auto"
                            >
                                {`{${f.field_label || f.field_name}}`}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Message Textarea */}
                <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Confirmation Message *</label>
                    <textarea
                        rows={4}
                        value={thankYouMessage}
                        onChange={(e) => setThankYouMessage(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 leading-relaxed"
                        dir="auto"
                    />
                </div>

                {/* Uploaded Visual Design / Poster */}
                <div className="pt-2 border-t border-slate-100 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-xs font-bold text-slate-800">Visual Poster / Badge Image</span>
                            <p className="text-[11px] text-slate-400">Optional graphic displayed directly beneath the confirmation message.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowThankYouImage(!showThankYouImage)}
                            className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700"
                        >
                            {showThankYouImage ? <Eye size={14} className="text-emerald-600" /> : <EyeOff size={14} />}
                            {showThankYouImage ? 'Shown on thank you screen' : 'Hidden'}
                        </button>
                    </div>

                    <div className="flex items-center gap-4">
                        {thankYouImageUrl && (
                            <img
                                src={getGoogleDriveDirectLink(thankYouImageUrl)}
                                alt="Thank you visual"
                                className="w-20 h-20 rounded-2xl object-cover border border-slate-200 shrink-0"
                            />
                        )}
                        <div className="flex-1">
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleUploadThankYouImage}
                                className="text-xs text-slate-600 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer"
                            />
                            {uploadingThankYouImg && <p className="text-[10px] text-emerald-600 mt-1">Uploading image...</p>}
                        </div>
                    </div>
                </div>
            </div>

            {/* Social Share Content & OG Meta */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div>
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <Share2 size={14} className="text-purple-600" />
                        Social Share Metadata & Preview
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Customize what appears when visitors share your form on social media.
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">Share Title</label>
                            <input
                                type="text"
                                value={shareTitle}
                                onChange={(e) => setShareTitle(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                dir="auto"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">Share Description</label>
                            <textarea
                                rows={3}
                                value={shareDescription}
                                onChange={(e) => setShareDescription(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 leading-relaxed"
                                dir="auto"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">Social Preview Image (OG Image)</label>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleUploadShareImage}
                                className="text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                            />
                            {uploadingShareImg && <p className="text-[10px] text-purple-600 mt-1">Uploading preview image...</p>}
                        </div>
                    </div>

                    {/* Social Post Preview Card */}
                    <div className="space-y-1.5">
                        <span className="text-xs font-bold text-slate-500">Social Post Preview:</span>
                        <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50 shadow-xs">
                            {shareImageUrl ? (
                                <img
                                    src={getGoogleDriveDirectLink(shareImageUrl)}
                                    alt="Share preview"
                                    className="w-full h-32 object-cover border-b border-slate-200"
                                />
                            ) : (
                                <div className="w-full h-32 bg-slate-200 flex items-center justify-center text-slate-400 text-xs">
                                    Preview Image
                                </div>
                            )}
                            <div className="p-3 space-y-1 bg-white">
                                <p className="text-xs font-bold text-slate-900 truncate" dir="auto">{shareTitle || 'Post Title'}</p>
                                <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed" dir="auto">
                                    {shareDescription || 'Description text that will accompany shared links...'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Cover Library Modal */}
            {showCoverModal && (
                <CoverLibraryModal
                    eventId={eventId}
                    selectedCoverId={selectedCover?.cover_id}
                    onSelectCover={(cover) => setSelectedCover(cover)}
                    onClose={() => setShowCoverModal(false)}
                />
            )}
        </div>
    );
}
