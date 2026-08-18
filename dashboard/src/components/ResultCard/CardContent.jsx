import React, { useState } from "react";
import {
  Youtube,
  Video,
  Instagram,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Hash,
} from "lucide-react";

const formatSourceTime = (seconds) => {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const hasTimestamp = (value) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value));

export default function CardContent({ clip, masterDuration }) {
  const [activeTab, setActiveTab] = useState("youtube");
  const [copiedField, setCopiedField] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const sourceMetadata = [
    hasTimestamp(clip.start) ? `Start ${formatSourceTime(clip.start)}` : null,
    hasTimestamp(clip.end) ? `End ${formatSourceTime(clip.end)}` : null,
    hasTimestamp(masterDuration) && Number(masterDuration) > 0
      ? `Master ${formatSourceTime(masterDuration)}`
      : null,
  ].filter(Boolean);

  const durationSeconds =
    clip.end && clip.start
      ? Math.max(1, Math.floor(clip.end - clip.start))
      : null;
  const youtubeTitle =
    clip.video_title_for_youtube_short || clip.title || "Viral Short Video";
  const socialCaption =
    clip.video_description_for_tiktok ||
    clip.video_description_for_instagram ||
    clip.description ||
    "";

  const handleCopy = async (text, fieldName) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <div className="flex flex-col min-w-0 mb-3">
      {/* Title & Metadata */}
      <div className="mb-3">
        <h3
          className="text-sm font-bold text-white leading-snug line-clamp-2 mb-2 break-words tracking-tight group-hover:text-cyan-200 transition-colors"
          title={youtubeTitle}
        >
          {youtubeTitle}
        </h3>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-zinc-400">
          {durationSeconds && (
            <span className="inline-flex items-center gap-1 bg-white/[0.06] text-zinc-300 px-2 py-0.5 rounded-md border border-white/10 shrink-0 font-mono">
              <Clock size={10} className="text-cyan-400" />
              {durationSeconds}s
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 bg-white/[0.04] text-zinc-400 px-1.5 py-0.5 rounded-md border border-white/5 shrink-0 font-mono">
            <Hash size={10} className="text-zinc-500" />
            shorts
          </span>
          <span className="inline-flex items-center gap-0.5 bg-white/[0.04] text-zinc-400 px-1.5 py-0.5 rounded-md border border-white/5 shrink-0 font-mono">
            <Hash size={10} className="text-zinc-500" />
            viral
          </span>
        </div>

        {sourceMetadata.length > 0 && (
          <div
            data-testid="clip-source-range"
            className="mt-1.5 text-[10px] text-zinc-500 font-mono flex items-center gap-1"
          >
            {sourceMetadata.join(" · ")}
          </div>
        )}
      </div>

      {/* Social Copy Hub */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-2 space-y-1.5 min-w-0">
        {/* Platform Switcher & Copy Trigger */}
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-0.5 bg-black/50 p-0.5 rounded-lg border border-white/5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("youtube")}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition-all ${
                activeTab === "youtube"
                  ? "bg-red-500/20 text-red-300 border border-red-500/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Youtube size={11} className="text-red-400 shrink-0" />
              <span>YouTube</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("tiktok")}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition-all ${
                activeTab === "tiktok"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Instagram size={11} className="text-pink-400 shrink-0" />
              <span>Socials</span>
            </button>
          </div>

          {/* Copy Button */}
          <button
            type="button"
            onClick={() =>
              handleCopy(
                activeTab === "youtube" ? youtubeTitle : socialCaption,
                activeTab,
              )
            }
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/10 transition-all active:scale-95 shrink-0"
            title={`Copy ${activeTab === "youtube" ? "YouTube Title" : "Social Caption"}`}
          >
            {copiedField === activeTab ? (
              <>
                <Check size={11} className="text-emerald-400 shrink-0" />
                <span className="text-emerald-400 font-bold">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={11} className="text-zinc-400 shrink-0" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Content Preview with Expand Option */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="group/text cursor-pointer rounded-lg bg-black/30 p-2 border border-white/5 hover:border-white/10 transition-all text-xs text-zinc-300"
        >
          {activeTab === "youtube" ? (
            <p
              className={`select-all break-words ${isExpanded ? "" : "line-clamp-2"} text-zinc-300 text-[11px] leading-relaxed`}
            >
              {youtubeTitle}
            </p>
          ) : (
            <p
              className={`select-all break-words ${isExpanded ? "" : "line-clamp-2"} text-zinc-300 text-[11px] leading-relaxed`}
            >
              {socialCaption || (
                <span className="italic text-zinc-500">
                  No caption generated
                </span>
              )}
            </p>
          )}

          <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-zinc-500 group-hover/text:text-zinc-400">
            <span>{isExpanded ? "Collapse" : "Expand"}</span>
            {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </div>
        </div>
      </div>
    </div>
  );
}
