import React from "react";
import { Clock, Hash } from "lucide-react";
import { CLIP_WORKFLOW_STATUSES } from "./clipWorkflowStatuses";
import { formatClock } from "./local-editor/localEditorExport";

const formatSourceTime = (seconds, fps = 30) =>
  formatClock(Math.max(0, Number(seconds) || 0) * 1000, fps);

const hasTimestamp = (value) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value));

export default function ClipWorkflowStatus({
  status = "not_reviewed",
  saving = false,
  onChange,
  clip,
  masterDuration,
}) {
  const currentStatus = CLIP_WORKFLOW_STATUSES.some(
    (item) => item.value === status,
  )
    ? status
    : "not_reviewed";
  const currentDefinition = CLIP_WORKFLOW_STATUSES.find(
    (item) => item.value === currentStatus,
  );

  const fps = clip
    ? Math.max(1, Number(clip.output_fps || clip.fps) || 30)
    : 30;

  const sourceMetadata = clip
    ? [
        hasTimestamp(clip.start)
          ? `Start ${formatSourceTime(clip.start, fps)}`
          : null,
        hasTimestamp(clip.end)
          ? `End ${formatSourceTime(clip.end, fps)}`
          : null,
        hasTimestamp(masterDuration) && Number(masterDuration) > 0
          ? `Master ${formatSourceTime(masterDuration, fps)}`
          : null,
      ].filter(Boolean)
    : [];

  const durationSeconds =
    clip && hasTimestamp(clip.end) && hasTimestamp(clip.start)
      ? Math.max(1, Math.floor(Number(clip.end) - Number(clip.start)))
      : null;

  const youtubeTitle = clip
    ? clip.video_title_for_youtube_short || clip.title || "Viral Short Video"
    : null;

  return (
    <div className="mb-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 min-w-0 space-y-2.5 shadow-sm hover:border-white/12 transition-all">
      {/* 1. Title ABOVE clip status tag */}
      {youtubeTitle && (
        <h3
          className="text-sm font-bold text-white leading-tight break-words tracking-tight group-hover:text-cyan-200 transition-colors"
          title={youtubeTitle}
        >
          {youtubeTitle}
        </h3>
      )}

      {/* 2. Duration & Tag Chips + Timestamps ABOVE clip status tag */}
      {clip && (durationSeconds !== null || sourceMetadata.length > 0) && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            {durationSeconds !== null && (
              <span className="inline-flex items-center gap-1 bg-cyan-500/10 text-cyan-300 px-2 py-0.5 rounded-md border border-cyan-500/20 shrink-0 font-mono font-bold">
                <Clock size={10} className="text-cyan-400" />
                {durationSeconds}s
              </span>
            )}
            <span className="inline-flex items-center gap-0.5 bg-white/[0.04] text-zinc-300 px-2 py-0.5 rounded-md border border-white/5 shrink-0 font-mono font-medium">
              <Hash size={10} className="text-zinc-500" />
              shorts
            </span>
            <span className="inline-flex items-center gap-0.5 bg-white/[0.04] text-zinc-300 px-2 py-0.5 rounded-md border border-white/5 shrink-0 font-mono font-medium">
              <Hash size={10} className="text-zinc-500" />
              viral
            </span>
          </div>

          {sourceMetadata.length > 0 && (
            <div
              data-testid="clip-source-range"
              className="text-zinc-400 font-mono text-[10px] leading-none flex items-center gap-1.5"
            >
              {sourceMetadata.join(" · ")}
            </div>
          )}
        </div>
      )}

      {/* 3. Clip Status Tag & Select Dropdown Row (placed BELOW the title and metadata) */}
      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-white/[0.06] min-w-0">
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider shrink-0 ${currentDefinition.className}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
          <span className="truncate">{currentDefinition.label}</span>
        </span>
        <select
          aria-label="Clip status"
          value={currentStatus}
          disabled={saving}
          onChange={(event) => onChange?.(event.target.value)}
          className="min-w-0 max-w-[125px] sm:max-w-none shrink-0 rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-xs font-medium text-zinc-200 outline-none transition-colors hover:border-white/20 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
        >
          {CLIP_WORKFLOW_STATUSES.map((item) => (
            <option
              key={item.value}
              value={item.value}
              className="bg-zinc-900 text-white"
            >
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
