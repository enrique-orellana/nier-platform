import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Video } from "@remotion/media";
import {
  AbsoluteFill,
  Internals,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";
import type { LayoutConfig, ShortVideoProps, SourceRegion } from "../lib/types";
import { Subtitles } from "./Subtitles";
import { HookOverlay } from "./HookOverlay";
import { VideoEffects } from "./VideoEffects";
import {
  normalizeLayoutSegments,
  resolveLayoutAtNormalizedSegments,
} from "../lib/layoutSegments";

export const getMediaTimeMs = (
  mediaCurrentTimeSeconds: number,
  videoStartSeconds: number,
): number | null => {
  const mediaTime = Number(mediaCurrentTimeSeconds);
  const startTime = Number(videoStartSeconds);
  if (!Number.isFinite(mediaTime) || !Number.isFinite(startTime)) return null;
  return Math.max(0, (mediaTime - startTime) * 1000);
};

const FACECAM_HEIGHT_RATIOS = {
  small: 0.3,
  medium: 0.38,
  large: 0.46,
} as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const normalizeRegion = (region: SourceRegion | null | undefined) => {
  if (!region) return null;
  const values = [region.x, region.y, region.width, region.height].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = values;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x + width > 1 || y + height > 1) return null;
  return { x, y, width, height };
};

const sourceAspectRatio = (layout: LayoutConfig | null | undefined) => {
  const width = Number(layout?.source_width);
  const height = Number(layout?.source_height);
  return width > 0 && height > 0 && Number.isFinite(width / height)
    ? width / height
    : 16 / 9;
};

const cropRegionToPanel = ({
  region,
  sourceAspect,
  panelAspect,
  zoom = 1,
  focus,
}: {
  region: SourceRegion;
  sourceAspect: number;
  panelAspect: number;
  zoom?: number;
  focus?: { x: number; y: number };
}) => {
  const selectedAspect = (region.width * sourceAspect) / region.height;
  let width = region.width;
  let height = region.height;
  if (selectedAspect >= panelAspect) {
    width = (height * panelAspect) / sourceAspect;
  } else {
    height = (width * sourceAspect) / panelAspect;
  }

  const normalizedZoom = clamp(Number(zoom) || 1, 0.6, 2);
  width = Math.min(region.width, width / normalizedZoom);
  height = Math.min(region.height, height / normalizedZoom);
  const focusX = clamp(
    Number(focus?.x ?? region.x + region.width / 2),
    region.x,
    region.x + region.width,
  );
  const focusY = clamp(
    Number(focus?.y ?? region.y + region.height / 2),
    region.y,
    region.y + region.height,
  );
  const x = clamp(
    focusX - width / 2,
    region.x,
    region.x + region.width - width,
  );
  const y = clamp(
    focusY - height / 2,
    region.y,
    region.y + region.height - height,
  );
  return { x, y, width, height };
};

const cropVideoStyle = (crop: SourceRegion): React.CSSProperties => ({
  position: "absolute",
  width: `${(1 / crop.width) * 100}%`,
  height: `${(1 / crop.height) * 100}%`,
  left: `${(-crop.x / crop.width) * 100}%`,
  top: `${(-crop.y / crop.height) * 100}%`,
  maxWidth: "none",
  maxHeight: "none",
  objectFit: "fill",
});

const BrowserVideo: React.FC<{
  videoUrl: string;
  videoStartSeconds: number;
  playbackRate: number;
  onAutoPlayError?: () => void;
  onMediaTimeChange?: (mediaTimeMs: number | null) => void;
  fps: number;
  objectFit: string;
  style?: React.CSSProperties;
  muted: boolean;
  audioOnly?: boolean;
}> = ({
  videoUrl,
  videoStartSeconds,
  playbackRate,
  onAutoPlayError,
  onMediaTimeChange,
  fps,
  objectFit,
  style,
  muted,
  audioOnly = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoId = useId();
  const frame = useCurrentFrame();
  const videoConfig = useVideoConfig();
  const [playerMuted] = Internals.usePlayerMutedState();
  const timeline = Internals.Timeline.useTimelineContext();
  const lastFrameRef = useRef(frame);
  const lastSourceKeyRef = useRef("");
  const sourceKey = `${videoUrl}:${videoStartSeconds}:${videoConfig.fps || fps}`;
  const effectiveMuted = muted || playerMuted;

  const playVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || !timeline.imperativePlaying.current) return;
    try {
      video.play()?.catch(() => onAutoPlayError?.());
    } catch {
      onAutoPlayError?.();
    }
  }, [onAutoPlayError, timeline.imperativePlaying]);

  useEffect(() => {
    const mediaTags = timeline.audioAndVideoTags.current;
    const tag = { id: videoId, play: playVideo };
    mediaTags.push(tag);
    return () => {
      timeline.audioAndVideoTags.current = mediaTags.filter(
        (mediaTag) => mediaTag.id !== videoId,
      );
    };
  }, [playVideo, timeline.audioAndVideoTags, videoId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
    video.muted = effectiveMuted;
  }, [effectiveMuted, playbackRate, videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!timeline.playing) {
      video.pause();
      return;
    }
    playVideo();
  }, [playVideo, timeline.playing]);

  useEffect(() => {
    if (!timeline.playing || !onMediaTimeChange) {
      onMediaTimeChange?.(null);
      return;
    }

    let animationFrameId: number | null = null;
    const updateMediaTime = () => {
      const video = videoRef.current;
      onMediaTimeChange?.(
        video ? getMediaTimeMs(video.currentTime, videoStartSeconds) : null,
      );
      animationFrameId = requestAnimationFrame(updateMediaTime);
    };

    updateMediaTime();
    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      onMediaTimeChange?.(null);
    };
  }, [onMediaTimeChange, timeline.playing, videoStartSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const frameDelta = Math.abs(frame - lastFrameRef.current);
    const sourceChanged = sourceKey !== lastSourceKeyRef.current;
    const shouldSync =
      sourceChanged || !timeline.playing || (!audioOnly && frameDelta > 3);
    if (shouldSync) {
      const targetTime =
        Number(videoStartSeconds) + frame / Number(videoConfig.fps || fps);
      if (
        Number.isFinite(targetTime) &&
        Math.abs(video.currentTime - targetTime) > 0.05
      )
        video.currentTime = Math.max(0, targetTime);
    }
    lastFrameRef.current = frame;
    lastSourceKeyRef.current = sourceKey;
  }, [
    frame,
    fps,
    sourceKey,
    timeline.playing,
    videoConfig.fps,
    videoStartSeconds,
  ]);

  return (
    <video
      ref={videoRef}
      data-testid={audioOnly ? "native-browser-audio" : "native-browser-video"}
      src={videoUrl}
      preload="auto"
      playsInline
      muted={effectiveMuted}
      aria-hidden={audioOnly || undefined}
      onLoadedMetadata={() => {
        lastSourceKeyRef.current = "";
      }}
      onCanPlay={playVideo}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit,
        ...(audioOnly ? { opacity: 0, pointerEvents: "none" as const } : {}),
        ...style,
      }}
    />
  );
};

const StreamerPanel: React.FC<{
  videoUrl: string;
  videoStartFrame: number;
  videoStartSeconds: number;
  playbackRate: number;
  fps: number;
  outputWidth: number;
  outputHeight: number;
  heightRatio: number;
  topRatio?: number;
  region?: SourceRegion;
  sourceAspect: number;
  zoom?: number;
  standardLayout?: boolean;
  muted: boolean;
  isRendering: boolean;
  onAutoPlayError?: () => void;
  onMediaTimeChange?: (mediaTimeMs: number | null) => void;
  reportMediaTime: boolean;
}> = ({
  videoUrl,
  videoStartFrame,
  videoStartSeconds,
  playbackRate,
  fps,
  outputWidth,
  outputHeight,
  heightRatio,
  topRatio = 0,
  region,
  sourceAspect,
  zoom = 1,
  standardLayout = false,
  muted,
  isRendering,
  onAutoPlayError,
  onMediaTimeChange,
  reportMediaTime,
}) => {
  const style: React.CSSProperties = standardLayout
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
      }
    : cropVideoStyle(
        cropRegionToPanel({
          region: normalizeRegion(region) || {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          sourceAspect,
          panelAspect: outputWidth / (outputHeight * heightRatio),
          zoom,
          focus:
            region === undefined && heightRatio < 1
              ? { x: 0.5, y: 0.58 }
              : undefined,
        }),
      );

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: `${topRatio * 100}%`,
        width: "100%",
        height: `${heightRatio * 100}%`,
        overflow: "hidden",
      }}
    >
      {isRendering ? (
        <Video
          key="main-video"
          src={videoUrl}
          trimBefore={videoStartFrame}
          objectFit={standardLayout ? "contain" : undefined}
          muted={muted}
          style={style}
        />
      ) : (
        <BrowserVideo
          key="main-video"
          videoUrl={videoUrl}
          videoStartSeconds={videoStartSeconds}
          playbackRate={playbackRate}
          onAutoPlayError={onAutoPlayError}
          onMediaTimeChange={reportMediaTime ? onMediaTimeChange : undefined}
          fps={fps}
          objectFit={standardLayout ? "contain" : "fill"}
          style={style}
          muted={muted}
        />
      )}
    </div>
  );
};

const MemoizedStreamerPanel = React.memo(StreamerPanel);

const LayoutVideoLayer: React.FC<{
  segment: {
    format: "standard" | "streamer_stack";
    layoutSlot: 0 | 1;
  };
  videoUrl: string;
  videoStartFrame: number;
  videoStartSeconds: number;
  playbackRate: number;
  fps: number;
  opacity: number;
  muted: boolean;
  isRendering: boolean;
  onAutoPlayError?: () => void;
  onMediaTimeChange?: (mediaTimeMs: number | null) => void;
  reportMediaTime: boolean;
  layout?: LayoutConfig | null;
  outputWidth: number;
  outputHeight: number;
}> = ({
  segment,
  videoUrl,
  videoStartFrame,
  videoStartSeconds,
  playbackRate,
  fps,
  opacity,
  muted,
  isRendering,
  onAutoPlayError,
  onMediaTimeChange,
  reportMediaTime,
  layout,
  outputWidth,
  outputHeight,
}) => {
  const usesStandardLayout = segment.format === "standard";
  const facecamHeightRatio =
    FACECAM_HEIGHT_RATIOS[layout?.facecam_size || "medium"];
  const gameplayHeightRatio = 1 - facecamHeightRatio;
  const sourceAspect = sourceAspectRatio(layout);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        pointerEvents: opacity > 0 ? "auto" : "none",
        background: "#000",
      }}
    >
      {usesStandardLayout && isRendering && (
        <Video
          src={videoUrl}
          trimBefore={videoStartFrame}
          objectFit="cover"
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            filter: "blur(24px)",
            transform: "scale(1.08)",
          }}
        />
      )}
      <MemoizedStreamerPanel
        key="main-panel"
        videoUrl={videoUrl}
        videoStartFrame={videoStartFrame}
        videoStartSeconds={videoStartSeconds}
        playbackRate={playbackRate}
        fps={fps}
        outputWidth={outputWidth}
        outputHeight={outputHeight}
        heightRatio={usesStandardLayout ? 1 : gameplayHeightRatio}
        topRatio={usesStandardLayout ? 0 : facecamHeightRatio}
        region={usesStandardLayout ? undefined : layout?.gameplay_region}
        sourceAspect={sourceAspect}
        zoom={usesStandardLayout ? 1 : layout?.gameplay_zoom}
        standardLayout={usesStandardLayout}
        muted={muted}
        isRendering={isRendering}
        onAutoPlayError={onAutoPlayError}
        onMediaTimeChange={onMediaTimeChange}
        reportMediaTime={reportMediaTime && !muted}
      />
      {!usesStandardLayout && (
        <MemoizedStreamerPanel
          key="facecam-panel"
          videoUrl={videoUrl}
          videoStartFrame={videoStartFrame}
          videoStartSeconds={videoStartSeconds}
          playbackRate={playbackRate}
          fps={fps}
          outputWidth={outputWidth}
          outputHeight={outputHeight}
          heightRatio={facecamHeightRatio}
          region={layout?.webcam_region}
          sourceAspect={sourceAspect}
          muted
          isRendering={isRendering}
          onAutoPlayError={onAutoPlayError}
          reportMediaTime={false}
        />
      )}
    </div>
  );
};

const MemoizedLayoutVideoLayer = React.memo(LayoutVideoLayer);

/**
 * Main composition that layers all post-processing on top of the base video.
 * The renderer uses Remotion's media decoder, while the interactive Player
 * uses one native browser decoder so audio and seeking stay responsive.
 */
export const ShortVideo: React.FC<Record<string, unknown>> = (rawProps) => {
  const {
    videoUrl,
    videoStartSeconds = 0,
    playbackRate = 1,
    onAutoPlayError,
    onMediaTimeChange,
    fps = 30,
    subtitles,
    subtitleTracks,
    activeSubtitleTrackId,
    layout,
    hook,
    effects,
  } = rawProps as unknown as ShortVideoProps & {
    onAutoPlayError?: () => void;
  };
  const [mediaTimeMs, setMediaTimeMs] = useState<number | null>(null);
  const frame = useCurrentFrame();
  const videoConfig = useVideoConfig();
  const compositionFps = Number(videoConfig.fps || fps);
  const videoStartFrame = Math.max(
    0,
    Math.round(Number(videoStartSeconds) * Number(fps)),
  );
  const normalizedLayoutSegments = useMemo(
    () =>
      normalizeLayoutSegments(
        layout,
        videoConfig.durationInFrames,
        compositionFps,
      ),
    [compositionFps, layout, videoConfig.durationInFrames],
  );
  const activeTrack = subtitleTracks?.find(
    (track) => track.id === (activeSubtitleTrackId || subtitleTracks[0]?.id),
  );
  const activeSubtitles =
    activeTrack && subtitles
      ? {
          ...subtitles,
          captions: activeTrack.captions,
          blocks: undefined,
          style: activeTrack.style || subtitles.style,
        }
      : subtitles;
  const hasActiveSubtitles = Boolean(activeSubtitles);
  const handleMediaTimeChange = useCallback(
    (nextMediaTimeMs: number | null) => {
      if (hasActiveSubtitles) setMediaTimeMs(nextMediaTimeMs);
      onMediaTimeChange?.(nextMediaTimeMs);
    },
    [hasActiveSubtitles, onMediaTimeChange],
  );
  const resolvedLayout = resolveLayoutAtNormalizedSegments(
    normalizedLayoutSegments,
    frame,
    compositionFps,
  );
  const environment = useRemotionEnvironment();
  const layoutLayers = resolvedLayout.previous
    ? [
        {
          segment: resolvedLayout.previous,
          opacity: 1 - resolvedLayout.transitionProgress,
          muted: true,
        },
        {
          segment: resolvedLayout.active,
          opacity: resolvedLayout.transitionProgress,
          muted: false,
        },
      ]
    : [{ segment: resolvedLayout.active, opacity: 1, muted: false }];
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {/* Base video with optional zoom/color effects */}
      <VideoEffects config={effects}>
        {!environment.isRendering && (
          <BrowserVideo
            videoUrl={videoUrl}
            videoStartSeconds={videoStartSeconds}
            playbackRate={playbackRate}
            onAutoPlayError={onAutoPlayError}
            onMediaTimeChange={handleMediaTimeChange}
            fps={Number(fps)}
            objectFit="contain"
            style={{ opacity: 0, pointerEvents: "none" }}
            muted={false}
            audioOnly
          />
        )}
        {layoutLayers.map(({ segment, opacity }) => (
          <MemoizedLayoutVideoLayer
            key={`layout-slot-${segment.layoutSlot}`}
            segment={segment}
            videoUrl={videoUrl}
            videoStartFrame={videoStartFrame}
            videoStartSeconds={videoStartSeconds}
            playbackRate={playbackRate}
            fps={Number(fps)}
            opacity={opacity}
            muted
            isRendering={environment.isRendering}
            onAutoPlayError={onAutoPlayError}
            onMediaTimeChange={handleMediaTimeChange}
            reportMediaTime={hasActiveSubtitles || Boolean(onMediaTimeChange)}
            layout={layout}
            outputWidth={Number(videoConfig.width || 1080)}
            outputHeight={Number(videoConfig.height || 1920)}
          />
        ))}
      </VideoEffects>

      {/* Layer 2: Animated subtitles */}
      {activeSubtitles && (
        <Subtitles config={activeSubtitles} mediaTimeMs={mediaTimeMs} />
      )}

      {/* Layer 3: Hook text overlay */}
      {hook && <HookOverlay config={hook} />}
    </AbsoluteFill>
  );
};
