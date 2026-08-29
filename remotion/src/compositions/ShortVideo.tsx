import React from "react";
import {
  AbsoluteFill,
  Html5Video,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";
import type { LayoutConfig, ShortVideoProps, SourceRegion } from "../lib/types";
import { Subtitles } from "./Subtitles";
import { HookOverlay } from "./HookOverlay";
import { VideoEffects } from "./VideoEffects";
import { resolveLayoutAtFrame } from "../lib/layoutSegments";
import {
  cropVideoStyle,
  normalizeRegion,
  resolveGameplayCrop,
} from "../lib/gameplayFraming";

const FACECAM_HEIGHT_RATIOS = {
  small: 0.3,
  medium: 0.38,
  large: 0.46,
} as const;

const sourceAspectRatio = (layout: LayoutConfig | null | undefined) => {
  const width = Number(layout?.source_width);
  const height = Number(layout?.source_height);
  return width > 0 && height > 0 && Number.isFinite(width / height)
    ? width / height
    : 16 / 9;
};

const StreamerPanel: React.FC<{
  videoUrl: string;
  videoStartFrame: number;
  muted: boolean;
  isRendering: boolean;
  heightRatio: number;
  topRatio?: number;
  region?: SourceRegion;
  sourceAspect: number;
  outputWidth: number;
  outputHeight: number;
  zoom?: number;
  focus?: { x: number; y: number };
  standardLayout?: boolean;
  onAutoPlayError?: () => void;
  seekBrowserVideoToMasterOffset?: (
    event: React.SyntheticEvent<HTMLVideoElement>,
  ) => void;
}> = ({
  videoUrl,
  videoStartFrame,
  muted,
  isRendering,
  heightRatio,
  topRatio = 0,
  region,
  sourceAspect,
  outputWidth,
  outputHeight,
  zoom = 1,
  focus,
  standardLayout = false,
  onAutoPlayError,
  seekBrowserVideoToMasterOffset,
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
        resolveGameplayCrop({
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
            focus ||
            (region === undefined && heightRatio < 1
              ? { x: 0.5, y: 0.58 }
              : undefined),
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
        <Html5Video
          key="main-video"
          src={videoUrl}
          trimBefore={videoStartFrame}
          muted={muted}
          onAutoPlayError={onAutoPlayError}
          onLoadedMetadata={seekBrowserVideoToMasterOffset}
          onCanPlay={seekBrowserVideoToMasterOffset}
          style={style}
        />
      )}
    </div>
  );
};

const LayoutVideoLayer: React.FC<{
  segment: { format: "standard" | "streamer_stack" };
  videoUrl: string;
  videoStartFrame: number;
  opacity: number;
  muted: boolean;
  isRendering: boolean;
  onAutoPlayError?: () => void;
  seekBrowserVideoToMasterOffset: (
    event: React.SyntheticEvent<HTMLVideoElement>,
  ) => void;
  layout?: LayoutConfig | null;
  outputWidth: number;
  outputHeight: number;
}> = ({
  segment,
  videoUrl,
  videoStartFrame,
  opacity,
  muted,
  isRendering,
  onAutoPlayError,
  seekBrowserVideoToMasterOffset,
  layout,
  outputWidth,
  outputHeight,
}) => {
  const usesStandardLayout = segment.format === "standard";
  const facecamHeightRatio =
    FACECAM_HEIGHT_RATIOS[layout?.facecam_size || "medium"];
  const gameplayHeightRatio = 1 - facecamHeightRatio;
  const sourceAspect = sourceAspectRatio(layout);
  const gameplayFocus = segment.gameplay_focus ?? layout?.gameplay_focus;
  const gameplayZoom = segment.gameplay_zoom ?? layout?.gameplay_zoom;
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
      <StreamerPanel
        key="main-panel"
        videoUrl={videoUrl}
        videoStartFrame={videoStartFrame}
        muted={muted}
        isRendering={isRendering}
        heightRatio={usesStandardLayout ? 1 : gameplayHeightRatio}
        topRatio={usesStandardLayout ? 0 : facecamHeightRatio}
        region={usesStandardLayout ? undefined : layout?.gameplay_region}
        sourceAspect={sourceAspect}
        outputWidth={outputWidth}
        outputHeight={outputHeight}
        zoom={usesStandardLayout ? 1 : gameplayZoom}
        focus={usesStandardLayout ? undefined : gameplayFocus}
        standardLayout={usesStandardLayout}
        onAutoPlayError={onAutoPlayError}
        seekBrowserVideoToMasterOffset={
          muted ? undefined : seekBrowserVideoToMasterOffset
        }
      />
      {!usesStandardLayout && (
        <StreamerPanel
          key="facecam-panel"
          videoUrl={videoUrl}
          videoStartFrame={videoStartFrame}
          muted
          isRendering={isRendering}
          heightRatio={facecamHeightRatio}
          region={layout?.webcam_region}
          sourceAspect={sourceAspect}
          outputWidth={outputWidth}
          outputHeight={outputHeight}
          onAutoPlayError={onAutoPlayError}
        />
      )}
    </div>
  );
};

/**
 * Main composition that layers all post-processing on top of the base video.
 * Uses @remotion/media Video for browser-side rendering compatibility.
 */
export const ShortVideo: React.FC<Record<string, unknown>> = (rawProps) => {
  const {
    videoUrl,
    videoStartSeconds = 0,
    onAutoPlayError,
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
  const frame = useCurrentFrame();
  const videoConfig = useVideoConfig();
  const videoStartFrame = Math.max(
    0,
    Math.round(Number(videoStartSeconds) * Number(fps)),
  );
  const environment = useRemotionEnvironment();
  const seekBrowserVideoToMasterOffset = (
    event: React.SyntheticEvent<HTMLVideoElement>,
  ) => {
    if (videoStartFrame <= 0) return;
    event.currentTarget.currentTime = Math.max(0, Number(videoStartSeconds));
  };
  const activeTrack = subtitleTracks?.find(
    (track) => track.id === (activeSubtitleTrackId || subtitleTracks[0]?.id)
  );
  const activeSubtitles = activeTrack && subtitles
    ? { ...subtitles, captions: activeTrack.captions, blocks: undefined, style: activeTrack.style || subtitles.style }
    : subtitles;
  const resolvedLayout = resolveLayoutAtFrame(
    layout,
    frame,
    videoConfig.durationInFrames,
    Number(videoConfig.fps || fps),
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {/* Base video with optional zoom/color effects */}
      <VideoEffects config={effects}>
        {(resolvedLayout.previous
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
          : [{ segment: resolvedLayout.active, opacity: 1, muted: false }]
        ).map(({ segment, opacity, muted }) => (
          <LayoutVideoLayer
            key={`${segment.id}-${muted ? "previous" : "active"}`}
            segment={segment}
            videoUrl={videoUrl}
            videoStartFrame={videoStartFrame}
            opacity={opacity}
            muted={muted}
            isRendering={environment.isRendering}
            onAutoPlayError={onAutoPlayError}
            seekBrowserVideoToMasterOffset={seekBrowserVideoToMasterOffset}
            layout={layout}
            outputWidth={Number(videoConfig.width || 1080)}
            outputHeight={Number(videoConfig.height || 1920)}
          />
        ))}
      </VideoEffects>

      {/* Layer 2: Animated subtitles */}
      {activeSubtitles && <Subtitles config={activeSubtitles} />}

      {/* Layer 3: Hook text overlay */}
      {hook && <HookOverlay config={hook} />}
    </AbsoluteFill>
  );
};
