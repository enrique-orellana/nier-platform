import React, { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui";

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const FALLBACK_VIDEO_WIDTH = 1920;
const FALLBACK_VIDEO_HEIGHT = 1080;
const FALLBACK_FRAME_WIDTH = 360;
const FALLBACK_FRAME_HEIGHT = 640;

function hasValidRegion(region) {
  if (!region) return false;
  const values = ["x", "y", "width", "height"].map((key) =>
    Number(region[key]),
  );
  if (values.some((value) => !Number.isFinite(value))) return false;
  const [x, y, width, height] = values;
  return (
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
}

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export default function Standard916Preview({
  videoUrl,
  startTime = 0,
  endTime = null,
  gameplayRegion,
  gameplayZoom = 1,
  onClose,
  onSaveZoom,
  isSavingZoom = false,
  saveError = "",
}) {
  const frameRef = useRef(null);
  const videoRef = useRef(null);
  const [zoom, setZoom] = useState(() => clampZoom(Number(gameplayZoom) || 1));
  const [frameSize, setFrameSize] = useState({
    width: FALLBACK_FRAME_WIDTH,
    height: FALLBACK_FRAME_HEIGHT,
  });
  const [videoSize, setVideoSize] = useState({
    width: FALLBACK_VIDEO_WIDTH,
    height: FALLBACK_VIDEO_HEIGHT,
  });

  useEffect(() => {
    const measure = () => {
      const frame = frameRef.current;
      const video = videoRef.current;
      setFrameSize({
        width: frame?.clientWidth || FALLBACK_FRAME_WIDTH,
        height: frame?.clientHeight || FALLBACK_FRAME_HEIGHT,
      });
      setVideoSize({
        width: video?.videoWidth || FALLBACK_VIDEO_WIDTH,
        height: video?.videoHeight || FALLBACK_VIDEO_HEIGHT,
      });
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const cropStyle = useMemo(() => {
    if (!hasValidRegion(gameplayRegion)) return {};

    const region = {
      x: Number(gameplayRegion.x),
      y: Number(gameplayRegion.y),
      width: Number(gameplayRegion.width),
      height: Number(gameplayRegion.height),
    };
    const scale =
      Math.max(
        frameSize.width / (videoSize.width * region.width),
        frameSize.height / (videoSize.height * region.height),
      ) * zoom;
    const left =
      frameSize.width / 2 -
      (region.x + region.width / 2) * videoSize.width * scale;
    const top =
      frameSize.height / 2 -
      (region.y + region.height / 2) * videoSize.height * scale;

    return {
      height: `${videoSize.height * scale}px`,
      left: 0,
      maxWidth: "none",
      position: "absolute",
      top: 0,
      transform: `translate(${left}px, ${top}px)`,
      transformOrigin: "top left",
      width: `${videoSize.width * scale}px`,
    };
  }, [frameSize, gameplayRegion, videoSize, zoom]);

  const seekToStart = () => {
    const video = videoRef.current;
    const start = Number(startTime);
    if (!video || !Number.isFinite(start)) return;
    video.currentTime = Math.max(0, start);
    setVideoSize({
      width: video.videoWidth || FALLBACK_VIDEO_WIDTH,
      height: video.videoHeight || FALLBACK_VIDEO_HEIGHT,
    });
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    const start = Number(startTime);
    const end = Number(endTime);
    if (!video || !Number.isFinite(end) || end <= start) return;
    if (video.currentTime >= end) {
      video.pause();
      video.currentTime = Number.isFinite(start) ? Math.max(0, start) : 0;
    }
  };

  const changeZoom = (delta) => {
    setZoom((current) => clampZoom(current + delta));
  };

  const handleSaveZoom = async () => {
    if (!onSaveZoom || isSavingZoom) return;
    await onSaveZoom(zoom);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        className="flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex flex-row items-start justify-between gap-4 border-b px-4 py-3 text-left sm:text-left">
          <div>
            <DialogTitle className="text-base">
              Standard 9:16 Preview
            </DialogTitle>
            <DialogDescription>
              Adjust the gameplay framing, then save it for the final render.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            size="icon"
          >
            <X className="size-4" />
          </Button>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto p-4">
          <div
            ref={frameRef}
            data-testid="standard-916-preview"
            data-aspect="9:16"
            className="relative w-full max-w-[360px] shrink-0 overflow-hidden bg-black aspect-[9/16]"
          >
            {hasValidRegion(gameplayRegion) ? (
              <video
                ref={videoRef}
                data-testid="standard-916-preview-video"
                src={videoUrl}
                controls
                playsInline
                preload="metadata"
                className="absolute"
                style={cropStyle}
                onLoadedMetadata={seekToStart}
                onTimeUpdate={handleTimeUpdate}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Select a gameplay area before opening this preview.
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-md border bg-card p-2">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Zoom out"
              onClick={() => changeZoom(-ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
            >
              <Minus className="size-4" />
            </Button>
            <span className="min-w-12 text-center text-sm font-medium">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Zoom in"
              onClick={() => changeZoom(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Reset zoom"
              onClick={() => setZoom(1)}
              disabled={zoom === 1}
            >
              <RotateCcw className="size-4" />
            </Button>
            {onSaveZoom && (
              <Button
                variant="default"
                type="button"
                aria-label="Save zoom"
                onClick={handleSaveZoom}
                disabled={isSavingZoom}
              >
                {isSavingZoom ? "Saving…" : "Save zoom"}
              </Button>
            )}
          </div>
          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
