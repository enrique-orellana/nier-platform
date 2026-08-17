import React from 'react';
import { Loader2, Wand2, Crop, Type, FileText, Languages, Share2, Download, AlertCircle, Clock3 } from 'lucide-react';

export default function CardActions({
    handleAutoEdit,
    isEditing,
    handleConvertNativeShort,
    isConvertingNativeShort,
    setShowSubtitleModal,
    setShowSubtitleDetails,
    isSubtitling,
    setShowHookModal,
    isHooking,
    setShowTranslateModal,
    isTranslating,
    setShowModal,
    editError,
    setShowClipEditor,
    handleDownload,
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
                <button onClick={() => setShowClipEditor(true)} className="col-span-2 py-2 bg-white/10 hover:bg-white/15 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"><Clock3 size={14} /> Edit Timeline</button>
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
                    onClick={() => setShowSubtitleModal(true)}
                    disabled={isSubtitling}
                    className="col-span-1 py-2 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                >
                    {isSubtitling ? <Loader2 size={14} className="animate-spin" /> : <Type size={14} />}
                    {isSubtitling ? 'Adding...' : 'Subtitles'}
                </button>

                <button
                    onClick={() => setShowSubtitleDetails(true)}
                    className="col-span-2 mb-1 flex items-center justify-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 py-2 text-xs font-semibold text-cyan-200 transition-all hover:bg-cyan-400/10"
                >
                    <FileText size={14} /> Subtitle details
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
                    onClick={handleDownload}
                    className="col-span-1 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 border border-white/5 truncate px-2"
                >
                    <Download size={14} className="shrink-0" /> Download
                </button>
            </div>
        </>
    );
}
