import React from "react";
import {
  Loader2,
  Wand2,
  Crop,
  Type,
  FileText,
  Languages,
  Share2,
  Download,
  AlertCircle,
  Clock3,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

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
  setShowClipRangeEditor,
  hasClipRangeEditor = false,
}) {
  return (
    <div className="flex flex-col gap-2.5 mt-auto pt-3 border-t border-white/[0.08]">
      {/* Error Message */}
      {editError && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] rounded-lg flex items-center gap-2">
          <AlertCircle size={12} className="shrink-0" />
          <span className="truncate">{editError}</span>
        </div>
      )}

      {/* Primary Action: Timeline Editor */}
      <button
        type="button"
        onClick={() => setShowClipEditor(true)}
        className="w-full py-2 px-3 bg-white/[0.06] hover:bg-white/[0.12] hover:border-cyan-500/40 border border-white/10 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 group shadow-sm active:scale-[0.99]"
      >
        <Clock3
          size={13}
          className="text-cyan-400 group-hover:scale-110 transition-transform"
        />
        <span>Edit Timeline</span>
      </button>

      {/* AI Studio & Enhancement Tools Grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {/* Auto Edit */}
        <button
          type="button"
          onClick={handleAutoEdit}
          disabled={isEditing}
          className="py-1.5 px-2 bg-white/[0.03] hover:bg-purple-500/10 border border-white/[0.08] hover:border-purple-500/30 text-zinc-200 hover:text-white rounded-lg text-[11px] font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 min-w-0 disabled:opacity-50"
          title="AI Smart Zooms & Edits"
        >
          {isEditing ? (
            <Loader2
              size={11}
              className="animate-spin text-purple-400 shrink-0"
            />
          ) : (
            <Wand2 size={11} className="text-purple-400 shrink-0" />
          )}
          <span className="truncate">
            {isEditing ? "Editing..." : "Auto Edit"}
          </span>
        </button>

        {/* Adjust Range (or Native Short if range editor not available) */}
        {hasClipRangeEditor && setShowClipRangeEditor ? (
          <button
            type="button"
            onClick={() => setShowClipRangeEditor(true)}
            className="py-1.5 px-2 bg-white/[0.03] hover:bg-cyan-500/10 border border-white/[0.08] hover:border-cyan-500/30 text-zinc-200 hover:text-white rounded-lg text-[11px] font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 min-w-0"
            title="Adjust clip start/end timestamps"
          >
            <SlidersHorizontal size={11} className="text-cyan-400 shrink-0" />
            <span className="truncate">Trim Range</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConvertNativeShort}
            disabled={isConvertingNativeShort}
            className="py-1.5 px-2 bg-white/[0.03] hover:bg-sky-500/10 border border-white/[0.08] hover:border-sky-500/30 text-zinc-200 hover:text-white rounded-lg text-[11px] font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 min-w-0 disabled:opacity-50"
            title="Render at full native resolution"
          >
            {isConvertingNativeShort ? (
              <Loader2
                size={11}
                className="animate-spin text-sky-400 shrink-0"
              />
            ) : (
              <Crop size={11} className="text-sky-400 shrink-0" />
            )}
            <span className="truncate">
              {isConvertingNativeShort ? "Converting..." : "Native Short"}
            </span>
          </button>
        )}

        {/* Subtitles (Combined with direct details trigger) */}
        <div className="flex items-stretch rounded-lg border border-white/[0.08] bg-white/[0.03] hover:border-amber-500/30 transition-all overflow-hidden min-w-0">
          <button
            type="button"
            onClick={() => setShowSubtitleModal(true)}
            disabled={isSubtitling}
            className="flex-1 py-1.5 pl-2 pr-1 text-zinc-200 hover:text-white text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 min-w-0 disabled:opacity-50 hover:bg-amber-500/10"
            title="Generate Subtitles"
          >
            {isSubtitling ? (
              <Loader2
                size={11}
                className="animate-spin text-amber-400 shrink-0"
              />
            ) : (
              <Type size={11} className="text-amber-400 shrink-0" />
            )}
            <span className="truncate">
              {isSubtitling ? "Adding..." : "Subtitles"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowSubtitleDetails(true)}
            className="px-1.5 border-l border-white/[0.08] text-zinc-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors flex items-center justify-center shrink-0"
            title="Subtitle details"
            aria-label="Subtitle details"
          >
            <FileText size={11} />
          </button>
        </div>

        {/* Viral Hook */}
        <button
          type="button"
          onClick={() => setShowHookModal(true)}
          disabled={isHooking}
          className="py-1.5 px-2 bg-white/[0.03] hover:bg-yellow-500/10 border border-white/[0.08] hover:border-yellow-500/30 text-zinc-200 hover:text-white rounded-lg text-[11px] font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 min-w-0 disabled:opacity-50"
          title="Generate 3s Viral Intro Hook"
        >
          {isHooking ? (
            <Loader2
              size={11}
              className="animate-spin text-yellow-400 shrink-0"
            />
          ) : (
            <Sparkles size={11} className="text-yellow-400 shrink-0" />
          )}
          <span className="truncate">
            {isHooking ? "Adding..." : "Viral Hook"}
          </span>
        </button>

        {/* Dub Voice */}
        <button
          type="button"
          onClick={() => setShowTranslateModal(true)}
          disabled={isTranslating}
          className="py-1.5 px-2 bg-white/[0.03] hover:bg-emerald-500/10 border border-white/[0.08] hover:border-emerald-500/30 text-zinc-200 hover:text-white rounded-lg text-[11px] font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 min-w-0 disabled:opacity-50"
          title="AI Voice Translation & Dubbing"
        >
          {isTranslating ? (
            <Loader2
              size={11}
              className="animate-spin text-emerald-400 shrink-0"
            />
          ) : (
            <Languages size={11} className="text-emerald-400 shrink-0" />
          )}
          <span className="truncate">
            {isTranslating ? "Translating..." : "Dub Voice"}
          </span>
        </button>

        {/* Native Short (if not placed above) */}
        {hasClipRangeEditor && setShowClipRangeEditor && (
          <button
            type="button"
            onClick={handleConvertNativeShort}
            disabled={isConvertingNativeShort}
            className="py-1.5 px-2 bg-white/[0.03] hover:bg-sky-500/10 border border-white/[0.08] hover:border-sky-500/30 text-zinc-200 hover:text-white rounded-lg text-[11px] font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 min-w-0 disabled:opacity-50"
            title="Convert to Native Short"
          >
            {isConvertingNativeShort ? (
              <Loader2
                size={11}
                className="animate-spin text-sky-400 shrink-0"
              />
            ) : (
              <Crop size={11} className="text-sky-400 shrink-0" />
            )}
            <span className="truncate">
              {isConvertingNativeShort ? "Converting..." : "Native Short"}
            </span>
          </button>
        )}
      </div>

      {/* Bottom Row: Publish & Download */}
      <div className="flex items-center gap-1.5 pt-1 min-w-0">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex-1 min-w-0 py-2 px-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 truncate"
        >
          <Share2 size={13} className="shrink-0" />
          <span className="truncate">Post</span>
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="py-2 px-2.5 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 hover:text-white rounded-xl text-xs font-medium border border-white/10 transition-colors flex items-center justify-center gap-1.5 shrink-0 min-w-0"
          title="Download MP4"
        >
          <Download size={13} className="shrink-0" />
          <span className="truncate">Download</span>
        </button>
      </div>
    </div>
  );
}
