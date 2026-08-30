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
import type {
  FaceTrackingCache,
  LayoutConfig,
  ShortVideoProps,
  SourcePoint,
  SourceRegion,
} from "../lib/types";
import { Subtitles } from "./Subtitles";
import { HookOverlay } from "./HookOverlay";
import { VideoEffects } from "./VideoEffects";
import {
  normalizeLayoutSegments,
  resolveLayoutAtNormalizedSegments,
} from "../lib/layoutSegments";
import {
  cropVideoStyle,
  normalizeRegion,
  resolveGameplayCrop,
} from "../lib/gameplayFraming";
import { faceTrackingRectangleAt } from "../lib/faceTracking";
import GameplayCropEditor from "../components/GameplayCropEditor";

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

const PREVIEW_LAYOUT_CLOCK_UPDATE_MS = 50;

const sourceAspectRatio = (layout: LayoutConfig | null | undefined) => {
  const width = Number(layout?.source_width);
  const height = Number(layout?.source_height);
  return width > 0 && height > 0 && Number.isFinite(width / height)
    ? width / height
    : 16 / 9;
};

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
    const sourceChanged = sourceKey !== lastSourceKeyRef.current;
    const shouldSync = sourceChanged || !timeline.playing;
    if (shouldSync) {
      const targetTime =
        Number(videoStartSeconds) + frame / Number(videoConfig.fps || fps);
      if (
        Number.isFinite(targetTime) &&
        Math.abs(video.currentTime - targetTime) > 0.05
      )
        video.currentTime = Math.max(0, targetTime);
    }
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
  focus?: { x: number; y: number };
  gameplayCropEditing?: boolean;
  onGameplayCropChange?: (next: { focus: SourcePoint; zoom: number }) => void;
  onGameplayCropReset?: () => void;
  onGameplayCropDone?: () => void;
  standardLayout?: boolean;
  muted: boolean;
  isRendering: boolean;
  onAutoPlayError?: () => void;
  onMediaTimeChange?: (mediaTimeMs: number | null) => void;
  reportMediaTime: boolean;
  cropOverride?: SourceRegion;
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
  focus,
  gameplayCropEditing = false,
  onGameplayCropChange,
  onGameplayCropReset,
  onGameplayCropDone,
  standardLayout = false,
  muted,
  isRendering,
  onAutoPlayError,
  onMediaTimeChange,
  reportMediaTime,
  cropOverride,
}) => {
  const gameplayRegion = normalizeRegion(region) || {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
  const panelAspect = outputWidth / (outputHeight * heightRatio);
  const editorRegionAspect =
    (gameplayRegion.width * sourceAspect) / gameplayRegion.height;
  const gameplayCrop = resolveGameplayCrop({
    region: gameplayRegion,
    sourceAspect,
    panelAspect,
    zoom,
    focus:
      focus ||
      (region === undefined && heightRatio < 1
        ? { x: 0.5, y: 0.58 }
        : undefined),
  });
  const style: React.CSSProperties = cropOverride
    ? cropVideoStyle(cropOverride)
    : standardLayout
      ? {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }
      : cropVideoStyle(gameplayCropEditing ? gameplayRegion : gameplayCrop);
  const contentStyle: React.CSSProperties =
    !standardLayout && gameplayCropEditing
      ? editorRegionAspect >= panelAspect
        ? {
            position: "absolute",
            left: 0,
            top: "50%",
            width: "100%",
            height: `${(panelAspect / editorRegionAspect) * 100}%`,
            transform: "translateY(-50%)",
            overflow: "hidden",
          }
        : {
            position: "absolute",
            left: "50%",
            top: 0,
            width: `${(editorRegionAspect / panelAspect) * 100}%`,
            height: "100%",
            transform: "translateX(-50%)",
            overflow: "hidden",
          }
      : {
          position: "absolute",
          inset: 0,
        };

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
      <div style={contentStyle}>
        {isRendering ? (
          <Video
            key="main-video"
            src={videoUrl}
            trimBefore={videoStartFrame}
            objectFit={standardLayout && !cropOverride ? "contain" : undefined}
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
            objectFit={standardLayout && !cropOverride ? "contain" : "fill"}
            style={style}
            muted={muted}
          />
        )}
        {!standardLayout && gameplayCropEditing && !isRendering && (
          <GameplayCropEditor
            region={gameplayRegion}
            sourceAspect={sourceAspect}
            panelAspect={panelAspect}
            focus={focus}
            zoom={zoom}
            onChange={onGameplayCropChange}
            onReset={onGameplayCropReset}
            onDone={onGameplayCropDone}
          />
        )}
      </div>
    </div>
  );
};

const MemoizedStreamerPanel = React.memo(StreamerPanel);

const LayoutVideoLayer: React.FC<{
  segment: {
    format: "standard" | "streamer_stack";
    layoutSlot: 0 | 1;
    startMs: number;
    gameplay_focus?: SourcePoint;
    gameplay_zoom?: number;
    face_tracking_enabled?: boolean;
    face_tracking_cache?: FaceTrackingCache;
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
  currentTimeSeconds: number;
  layout?: LayoutConfig | null;
  outputWidth: number;
  outputHeight: number;
  gameplayCropEditing?: boolean;
  onGameplayCropChange?: (next: { focus: SourcePoint; zoom: number }) => void;
  onGameplayCropReset?: () => void;
  onGameplayCropDone?: () => void;
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
  currentTimeSeconds,
  layout,
  outputWidth,
  outputHeight,
  gameplayCropEditing = false,
  onGameplayCropChange,
  onGameplayCropReset,
  onGameplayCropDone,
}) => {
  const usesStandardLayout = segment.format === "standard";
  const facecamHeightRatio =
    FACECAM_HEIGHT_RATIOS[layout?.facecam_size || "medium"];
  const gameplayHeightRatio = 1 - facecamHeightRatio;
  const sourceAspect = sourceAspectRatio(layout);
  const gameplayFocus = segment.gameplay_focus ?? layout?.gameplay_focus;
  const gameplayZoom = segment.gameplay_zoom ?? layout?.gameplay_zoom;
  const faceTrackingCrop =
    usesStandardLayout && segment.face_tracking_enabled === true
      ? faceTrackingRectangleAt(
          segment.face_tracking_cache,
          Math.max(0, currentTimeSeconds - segment.startMs / 1000),
        )
      : undefined;
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
        zoom={usesStandardLayout ? 1 : gameplayZoom}
        focus={usesStandardLayout ? undefined : gameplayFocus}
        gameplayCropEditing={usesStandardLayout ? false : gameplayCropEditing}
        onGameplayCropChange={
          usesStandardLayout ? undefined : onGameplayCropChange
        }
        onGameplayCropReset={
          usesStandardLayout ? undefined : onGameplayCropReset
        }
        onGameplayCropDone={usesStandardLayout ? undefined : onGameplayCropDone}
        standardLayout={usesStandardLayout}
        muted={muted}
        isRendering={isRendering}
        onAutoPlayError={onAutoPlayError}
        onMediaTimeChange={onMediaTimeChange}
        reportMediaTime={reportMediaTime && !muted}
        cropOverride={faceTrackingCrop}
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
    gameplayCropEditing,
    onGameplayCropChange,
    onGameplayCropReset,
    onGameplayCropDone,
  } = rawProps as unknown as ShortVideoProps & {
    onAutoPlayError?: () => void;
    gameplayCropEditing?: boolean;
    onGameplayCropChange?: (next: { focus: SourcePoint; zoom: number }) => void;
    onGameplayCropReset?: () => void;
    onGameplayCropDone?: () => void;
  };
  const [mediaTimeMs, setMediaTimeMs] = useState<number | null>(null);
  const [previewMediaTimeMs, setPreviewMediaTimeMs] = useState<number | null>(
    null,
  );
  const previewMediaTimePublishedAtRef = useRef<number | null>(null);
  const previewMediaTimeValueRef = useRef<number | null>(null);
  const frame = useCurrentFrame();
  const frameRef = useRef(frame);
  frameRef.current = frame;
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
  const handleAudioMediaTimeChange = useCallback(
    (nextMediaTimeMs: number | null) => {
      // A newly mounted native element reports 0 before it has applied the
      // current seek. Do not let that bootstrap value overwrite a paused or
      // delayed Remotion frame.
      if (nextMediaTimeMs === 0 && frameRef.current > 0) {
        handleMediaTimeChange(nextMediaTimeMs);
        return;
      }
      const now = performance.now();
      const lastPublishedAt = previewMediaTimePublishedAtRef.current;
      const lastPublishedValue = previewMediaTimeValueRef.current;
      const isSeek =
        nextMediaTimeMs !== null &&
        lastPublishedValue !== null &&
        Math.abs(nextMediaTimeMs - lastPublishedValue) > 100;
      if (
        nextMediaTimeMs === null ||
        lastPublishedAt === null ||
        now - lastPublishedAt >= PREVIEW_LAYOUT_CLOCK_UPDATE_MS ||
        isSeek
      ) {
        previewMediaTimePublishedAtRef.current = now;
        previewMediaTimeValueRef.current = nextMediaTimeMs;
        setPreviewMediaTimeMs(nextMediaTimeMs);
      }
      handleMediaTimeChange(nextMediaTimeMs);
    },
    [handleMediaTimeChange],
  );
  const environment = useRemotionEnvironment();
  const layoutFrame =
    !environment.isRendering && previewMediaTimeMs !== null
      ? (previewMediaTimeMs / 1000) * compositionFps
      : frame;
  const resolvedLayout = resolveLayoutAtNormalizedSegments(
    normalizedLayoutSegments,
    layoutFrame,
    compositionFps,
  );
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
            onMediaTimeChange={handleAudioMediaTimeChange}
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
            gameplayCropEditing={Boolean(gameplayCropEditing)}
            onGameplayCropChange={onGameplayCropChange}
            onGameplayCropReset={onGameplayCropReset}
            onGameplayCropDone={onGameplayCropDone}
            currentTimeSeconds={layoutFrame / compositionFps}
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
