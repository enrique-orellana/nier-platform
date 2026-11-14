import React, { useState, useEffect } from "react";
import { Loader2, ArrowLeftRight } from "lucide-react";
import { Badge, Button } from "../ui";

export default function VideoPreview({
  videoRef,
  currentVideoUrl,
  trueOriginalUrl,
  index,
  isEditing,
  isConvertingNativeShort,
  isQualityImproving,
  onPlay,
  onPause,
  clip,
}) {
  const hasEdits =
    trueOriginalUrl && currentVideoUrl && trueOriginalUrl !== currentVideoUrl;
  const [viewOriginal, setViewOriginal] = useState(false);
  const sourcePreview = clip?.source_preview === true;
  const previewStart =
    sourcePreview && Number.isFinite(Number(clip?.start))
      ? Math.max(0, Number(clip.start))
      : 0;
  const previewEnd =
    sourcePreview &&
    Number.isFinite(Number(clip?.end)) &&
    Number(clip.end) > previewStart
      ? Number(clip.end)
      : null;

  // Automatically switch to the edited view if the video URL changes (e.g., after an edit finishes)
  useEffect(() => {
    if (currentVideoUrl) {
      setViewOriginal(false);
    }
  }, [currentVideoUrl]);

  const displayUrl =
    hasEdits && viewOriginal ? trueOriginalUrl : currentVideoUrl;

  const seekToPreviewStart = () => {
    if (!sourcePreview || !videoRef.current) return;
    const duration = Number(videoRef.current.duration);
    videoRef.current.currentTime =
      Number.isFinite(duration) && duration > 0
        ? Math.min(previewStart, duration)
        : previewStart;
  };

  const handleTimeUpdate = () => {
    if (!sourcePreview || !previewEnd || !videoRef.current) return;
    if (videoRef.current.currentTime >= previewEnd) {
      videoRef.current.pause();
      seekToPreviewStart();
    }
  };

  return (
    <div className="group/video relative flex aspect-[9/16] w-full shrink-0 items-center justify-center overflow-hidden bg-muted">
      <video
        ref={videoRef}
        src={displayUrl}
        preload="metadata"
        controls
        className="w-full h-full object-cover"
        playsInline
        onLoadedMetadata={seekToPreviewStart}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => {
          const currentTime = videoRef.current
            ? videoRef.current.currentTime
            : 0;
          onPlay &&
            onPlay(sourcePreview ? currentTime : clip.start + currentTime);
        }}
        onPause={() => onPause && onPause()}
        onEnded={() => {
          if (videoRef.current) {
            videoRef.current.currentTime = sourcePreview ? previewStart : 0;
            videoRef.current.play();
          }
        }}
      />
      <Badge
        variant="secondary"
        className="absolute left-3 top-3 border-border/70 bg-background/80 backdrop-blur-sm"
      >
        Clip {index + 1}
      </Badge>

      {hasEdits && (
        <div className="absolute top-3 right-3">
          <Button
            variant={viewOriginal ? "outline" : "secondary"}
            size="sm"
            onClick={() => setViewOriginal(!viewOriginal)}
            className="border-border/70 bg-background/80 backdrop-blur-sm"
            title="Toggle before/after"
          >
            <ArrowLeftRight className="size-3.5" />
            {viewOriginal ? "Original" : "Edited"}
          </Button>
        </div>
      )}

      {/* Auto Edit Overlay if Processing */}
      {(isEditing || isConvertingNativeShort || isQualityImproving) && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 p-4 text-center backdrop-blur-sm">
          <Loader2 className="mb-3 size-8 animate-spin text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {isConvertingNativeShort
              ? "Converting to Native Short..."
              : isQualityImproving
                ? "Improving Quality..."
                : "AI Magic in Progress..."}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">
            {isConvertingNativeShort
              ? "Rendering master quality"
              : isQualityImproving
                ? "Re-encoding without changing framing"
                : "Applying viral edits & zooms"}
          </span>
        </div>
      )}
    </div>
  );
}
