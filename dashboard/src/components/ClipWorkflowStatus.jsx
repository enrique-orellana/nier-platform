import React from "react";
import { Clock, Hash } from "lucide-react";
import { CLIP_WORKFLOW_STATUSES } from "./clipWorkflowStatuses";
import { formatClock } from "./local-editor/localEditorExport";
import {
  Badge,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "./ui";

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
    <section className="min-w-0 space-y-4">
      {youtubeTitle && (
        <CardTitle
          className="block text-base leading-snug break-words"
          title={youtubeTitle}
        >
          {youtubeTitle}
        </CardTitle>
      )}

      {clip && (durationSeconds !== null || sourceMetadata.length > 0) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {durationSeconds !== null && (
              <Badge variant="secondary" className="gap-1.5 font-mono">
                <Clock className="size-3.5" />
                {durationSeconds}s
              </Badge>
            )}
            <Badge variant="outline" className="gap-1 font-mono">
              <Hash className="size-3" />
              shorts
            </Badge>
            <Badge variant="outline" className="gap-1 font-mono">
              <Hash className="size-3" />
              viral
            </Badge>
          </div>

          {sourceMetadata.length > 0 && (
            <div
              data-testid="clip-source-range"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
            >
              {sourceMetadata.join(" · ")}
            </div>
          )}
        </div>
      )}

      <Separator />

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Status</span>
        <div className="w-40 shrink-0">
          <Select
            value={currentStatus}
            disabled={saving}
            onValueChange={(nextStatus) => onChange?.(nextStatus)}
          >
            <SelectTrigger aria-label="Clip status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLIP_WORKFLOW_STATUSES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  );
}
