import { useState, useEffect } from 'react';
import { Image, Plus, Trash2, Check, X, Loader, Upload, Sparkles } from 'lucide-react';
import { getEventCovers, createFormCover, deleteFormCover, uploadImage } from '../../lib/api';
import { getGoogleDriveDirectLink } from '../../lib/utils';

export default function CoverLibraryModal({
    eventId,
    selectedCoverId,
    onSelectCover,
    onClose
}) {
    const [covers, setCovers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [coverName, setCoverName] = useState('');
    const [previewFile, setPreviewFile] = useState(null);
    const [showUploadForm, setShowUploadForm] = useState(false);

    useEffect(() => {
        loadCovers();
    }, [eventId]);

    const loadCovers = async () => {
        try {
            setLoading(true);
            const data = await getEventCovers(eventId);
            setCovers(data || []);
        } catch (err) {
            console.error('Failed to load covers:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!previewFile) return;

        try {
            setUploading(true);
            const nameToUse = coverName.trim() || previewFile.name.replace(/\.[^/.]+$/, '');
            const publicUrl = await uploadImage(previewFile, 'covers');
            const newCover = await createFormCover(eventId, nameToUse, publicUrl);
            setCovers(prev => [newCover, ...prev]);
            setShowUploadForm(false);
            setCoverName('');
            setPreviewFile(null);
            if (onSelectCover) {
                onSelectCover(newCover);
            }
        } catch (err) {
            console.error('Failed to upload cover:', err);
            alert('Error uploading cover. Please try again.');
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (e, coverId) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this cover from the library?')) return;
        try {
            await deleteFormCover(coverId);
            setCovers(prev => prev.filter(c => c.cover_id !== coverId));
            if (selectedCoverId === coverId && onSelectCover) {
                onSelectCover(null);
            }
        } catch (err) {
            console.error('Failed to delete cover:', err);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" dir="ltr">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shadow-xs">
                            <Image size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-900">Form Covers Library</h3>
                            <p className="text-xs text-slate-500">Choose a shared cover or upload a new one to use across your forms</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {/* Action Bar */}
                    <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-slate-500">
                            Available Covers ({covers.length})
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowUploadForm(!showUploadForm)}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                        >
                            {showUploadForm ? <X size={14} /> : <Plus size={14} />}
                            {showUploadForm ? 'Cancel' : 'Upload New Cover'}
                        </button>
                    </div>

                    {/* Upload Box */}
                    {showUploadForm && (
                        <form onSubmit={handleUpload} className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-2">
                            <h4 className="text-xs font-black text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                                <Sparkles size={14} className="text-indigo-600" />
                                Add New Cover to Library
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Cover Name (Optional)</label>
                                    <input
                                        type="text"
                                        value={coverName}
                                        onChange={(e) => setCoverName(e.target.value)}
                                        placeholder="e.g. Main Summit Cover 2026"
                                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Select Image File *</label>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        required
                                        onChange={(e) => setPreviewFile(e.target.files[0])}
                                        className="w-full text-xs text-slate-600 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    disabled={uploading || !previewFile}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all disabled:opacity-50"
                                >
                                    {uploading ? (
                                        <>
                                            <Loader size={14} className="animate-spin" />
                                            Uploading & Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Upload size={14} />
                                            Save to Library
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* Covers Grid */}
                    {loading ? (
                        <div className="py-16 text-center text-slate-400">
                            <Loader size={28} className="animate-spin mx-auto mb-2 text-indigo-500" />
                            <p className="text-xs font-medium">Loading covers...</p>
                        </div>
                    ) : covers.length === 0 ? (
                        <div className="py-12 border-2 border-dashed border-slate-200 rounded-2xl text-center">
                            <Image size={36} className="mx-auto text-slate-300 mb-2" />
                            <p className="text-sm font-bold text-slate-600">No covers in library yet</p>
                            <p className="text-xs text-slate-400 mt-0.5">Upload your first cover to share across all forms</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                            {/* Option to clear cover */}
                            <div
                                onClick={() => {
                                    onSelectCover(null);
                                    onClose();
                                }}
                                className={`group cursor-pointer border-2 rounded-2xl p-4 flex flex-col items-center justify-center text-center transition-all h-44 ${
                                    !selectedCoverId
                                        ? 'border-indigo-600 bg-indigo-50/40 text-indigo-900 ring-2 ring-indigo-500/20'
                                        : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-500'
                                }`}
                            >
                                <div className="w-10 h-10 rounded-full bg-slate-200/60 flex items-center justify-center mb-2">
                                    <X size={18} />
                                </div>
                                <span className="text-xs font-bold">No Cover</span>
                                <span className="text-[10px] text-slate-400 mt-1">Remove cover from this form</span>
                            </div>

                            {/* Covers items */}
                            {covers.map((cover) => {
                                const isSelected = selectedCoverId === cover.cover_id;
                                const directUrl = getGoogleDriveDirectLink(cover.image_url);

                                return (
                                    <div
                                        key={cover.cover_id}
                                        onClick={() => {
                                            onSelectCover(cover);
                                            onClose();
                                        }}
                                        className={`group relative rounded-2xl overflow-hidden border-2 cursor-pointer transition-all h-44 flex flex-col justify-end p-3 ${
                                            isSelected
                                                ? 'border-indigo-600 ring-4 ring-indigo-500/20 shadow-md'
                                                : 'border-slate-200 hover:border-indigo-400 shadow-xs'
                                        }`}
                                    >
                                        <img
                                            src={directUrl}
                                            alt={cover.name}
                                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                                        {/* Badges / Actions */}
                                        <div className="relative z-10 flex items-center justify-between">
                                            <div className="truncate text-left">
                                                <p className="text-white text-xs font-bold truncate drop-shadow-xs">{cover.name}</p>
                                                <p className="text-[10px] text-slate-300">
                                                    {new Date(cover.created_at).toLocaleDateString('en-US')}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {isSelected && (
                                                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                                                        <Check size={14} />
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleDelete(e, cover.cover_id)}
                                                    className="w-6 h-6 rounded-full bg-black/40 hover:bg-red-600 text-white flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Delete from library"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                    <p className="text-xs text-slate-500">
                        Changes to a library cover immediately reflect across all linked forms.
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
