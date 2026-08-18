import React, { useState, useEffect } from "react";
import { Loader2, ArrowLeftRight } from "lucide-react";

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
    <div className="w-full bg-black relative shrink-0 aspect-[9/16] flex items-center justify-center overflow-hidden group/video">
      <video
        ref={videoRef}
        src={displayUrl}
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
      <div className="absolute top-3 left-3 flex gap-2">
        <span className="bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-md border border-white/10 uppercase tracking-wide">
          Clip {index + 1}
        </span>
      </div>

      {hasEdits && (
        <div className="absolute top-3 right-3">
          <button
            onClick={() => setViewOriginal(!viewOriginal)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide border transition-all backdrop-blur-md ${
              viewOriginal
                ? "bg-zinc-800/80 text-zinc-300 border-zinc-700/50 hover:bg-zinc-700/80"
                : "bg-primary/80 text-white border-primary/50 hover:bg-primary/90"
            }`}
            title="Toggle before/after"
          >
            <ArrowLeftRight size={12} />
            {viewOriginal ? "Original" : "Edited"}
          </button>
        </div>
      )}

      {/* Auto Edit Overlay if Processing */}
      {(isEditing || isConvertingNativeShort || isQualityImproving) && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-10 p-4 text-center">
          <Loader2 size={32} className="text-primary animate-spin mb-3" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            {isConvertingNativeShort
              ? "Converting to Native Short..."
              : isQualityImproving
                ? "Improving Quality..."
                : "AI Magic in Progress..."}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1">
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
