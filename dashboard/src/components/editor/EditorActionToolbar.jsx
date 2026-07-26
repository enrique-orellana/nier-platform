import React from 'react';
import { AlertCircle, Crop, Download, Languages, Loader2, Share2, Type, Wand2 } from 'lucide-react';

const actionButton = 'flex min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60';

export default function EditorActionToolbar({
    onAutoEdit,
    isEditing = false,
    onConvertNativeShort,
    isConvertingNativeShort = false,
    onSubtitles,
    isSubtitling = false,
    onViralHook,
    isHooking = false,
    onDubVoice,
    isTranslating = false,
    onPost,
    onDownload,
    editError,
}) {
    return (
        <div className="fixed left-2 right-2 top-[4.5rem] z-[70] border-b border-white/[0.08] bg-surfaceLight/95 px-3 py-2 shadow-lg backdrop-blur" aria-label="Editor actions" role="region">
            {editError && (
                <div className="mb-2 flex items-center gap-2 text-[11px] text-red-400" role="alert">
                    <AlertCircle size={13} className="shrink-0" />
                    <span className="truncate">{editError}</span>
                </div>
            )}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
                <button type="button" onClick={onAutoEdit} disabled={isEditing} className={`${actionButton} bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500`}>
                    {isEditing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {isEditing ? 'Editing…' : 'Auto Edit'}
                </button>
                <button type="button" onClick={onConvertNativeShort} disabled={isConvertingNativeShort} className={`${actionButton} bg-gradient-to-r from-cyan-600 to-sky-700 hover:from-cyan-500 hover:to-sky-600`}>
                    {isConvertingNativeShort ? <Loader2 size={14} className="animate-spin" /> : <Crop size={14} />}
                    {isConvertingNativeShort ? 'Converting…' : 'Convert to Native Short'}
                </button>
                <button type="button" onClick={onSubtitles} disabled={isSubtitling} className={`${actionButton} bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500`}>
                    {isSubtitling ? <Loader2 size={14} className="animate-spin" /> : <Type size={14} />}
                    {isSubtitling ? 'Adding…' : 'Subtitles'}
                </button>
                <button type="button" onClick={onViralHook} disabled={isHooking} className={`${actionButton} bg-gradient-to-r from-amber-400 to-yellow-500 text-black hover:from-amber-300 hover:to-yellow-400`}>
                    {isHooking ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {isHooking ? 'Adding…' : 'Viral Hook'}
                </button>
                <button type="button" onClick={onDubVoice} disabled={isTranslating} className={`${actionButton} bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-400 hover:to-teal-500`}>
                    {isTranslating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                    {isTranslating ? 'Translating…' : 'Dub Voice'}
                </button>
                <button type="button" onClick={onPost} className={`${actionButton} bg-primary hover:bg-blue-600`}>
                    <Share2 size={14} /> Post
                </button>
                <button type="button" onClick={onDownload} className={`${actionButton} border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white`}>
                    <Download size={14} /> Download
                </button>
            </div>
        </div>
    );
}
