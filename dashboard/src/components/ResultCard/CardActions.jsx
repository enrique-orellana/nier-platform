import React from 'react';
import { Loader2, Wand2, Crop, Sparkles, Type, Languages, Share2, Download, AlertCircle } from 'lucide-react';

export default function CardActions({
    handleAutoEdit,
    isEditing,
    handleConvertNativeShort,
    isConvertingNativeShort,
    handleImproveQuality,
    isQualityImproving,
    setShowSubtitleModal,
    isSubtitling,
    setShowHookModal,
    isHooking,
    setShowTranslateModal,
    isTranslating,
    setShowModal,
    currentVideoUrl,
    index,
    editError
}) {
    return (
        <>
            {/* Error Message */}
            {editError && (
                <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] rounded-lg flex items-center gap-2">
                    <AlertCircle size={12} className="shrink-0" />
                    {editError}
                </div>
            )}

            {/* Actions Footer */}
            <div className="grid grid-cols-2 gap-3 mt-auto pt-4 border-t border-white/5">
                <button
                    onClick={handleAutoEdit}
                    disabled={isEditing}
                    className="col-span-1 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-purple-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                >
                    {isEditing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {isEditing ? 'Editing...' : 'Auto Edit'}
                </button>

                <button
                    onClick={handleConvertNativeShort}
                    disabled={isConvertingNativeShort}
                    className="col-span-1 py-2 bg-gradient-to-r from-cyan-600 to-sky-700 hover:from-cyan-500 hover:to-sky-600 text-white rounded-lg text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                >
                    {isConvertingNativeShort ? <Loader2 size={14} className="animate-spin" /> : <Crop size={14} />}
                    {isConvertingNativeShort ? 'Converting...' : 'Convert to Native Short'}
                </button>

                <button
                    onClick={handleImproveQuality}
                    disabled={isQualityImproving}
                    className="col-span-1 py-2 bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-400 hover:to-cyan-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                >
                    {isQualityImproving ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {isQualityImproving ? 'Improving...' : 'Improve Quality'}
                </button>

                <button
                    onClick={() => setShowSubtitleModal(true)}
                    disabled={isSubtitling}
                    className="col-span-1 py-2 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                >
                    {isSubtitling ? <Loader2 size={14} className="animate-spin" /> : <Type size={14} />}
                    {isSubtitling ? 'Adding...' : 'Subtitles'}
                </button>

                <button
                    onClick={() => setShowHookModal(true)}
                    disabled={isHooking}
                    className="col-span-1 py-2 bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-black rounded-lg text-xs font-bold shadow-lg shadow-yellow-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                >
                    {isHooking ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {isHooking ? 'Adding...' : 'Viral Hook'}
                </button>

                <button
                    onClick={() => setShowTranslateModal(true)}
                    disabled={isTranslating}
                    className="col-span-1 py-2 bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-400 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-green-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                >
                    {isTranslating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                    {isTranslating ? 'Translating...' : 'Dub Voice'}
                </button>

                <button
                    onClick={() => setShowModal(true)}
                    className="col-span-1 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg text-xs font-bold shadow-lg shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 truncate px-2"
                >
                    <Share2 size={14} className="shrink-0" /> Post
                </button>
                <button
                    onClick={async (e) => {
                        e.preventDefault();
                        try {
                            const response = await fetch(currentVideoUrl);
                            if (!response.ok) throw new Error('Download failed');
                            const blob = await response.blob();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.style.display = 'none';
                            a.href = url;
                            a.download = `clip-${index + 1}.mp4`;
                            document.body.appendChild(a);
                            a.click();
                            window.URL.revokeObjectURL(url);
                            document.body.removeChild(a);
                        } catch (err) {
                            console.error('Download error:', err);
                            window.open(currentVideoUrl, '_blank');
                        }
                    }}
                    className="col-span-1 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 border border-white/5 truncate px-2"
                >
                    <Download size={14} className="shrink-0" /> Download
                </button>
            </div>
        </>
    );
}
