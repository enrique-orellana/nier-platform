import React from "react";
import {
  AbsoluteFill,
  Html5Video,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";
import type { ShortVideoProps } from "../lib/types";
import { Subtitles } from "./Subtitles";
import { HookOverlay } from "./HookOverlay";
import { VideoEffects } from "./VideoEffects";
import { resolveLayoutAtFrame } from "../lib/layoutSegments";

const LayoutVideoLayer: React.FC<{
  segment: { format: "standard" | "streamer_stack" };
  videoUrl: string;
  videoStartFrame: number;
  videoFit?: "cover" | "contain";
  opacity: number;
  muted: boolean;
  isRendering: boolean;
  onAutoPlayError?: () => void;
  seekBrowserVideoToMasterOffset: (
    event: React.SyntheticEvent<HTMLVideoElement>,
  ) => void;
}> = ({
  segment,
  videoUrl,
  videoStartFrame,
  videoFit,
  opacity,
  muted,
  isRendering,
  onAutoPlayError,
  seekBrowserVideoToMasterOffset,
}) => {
  const usesStandardLayout = segment.format === "standard";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        pointerEvents: opacity > 0 ? "auto" : "none",
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
      {isRendering ? (
        <Video
          src={videoUrl}
          trimBefore={videoStartFrame}
          objectFit={usesStandardLayout ? "contain" : videoFit || "cover"}
          muted={muted}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />
      ) : (
        <Html5Video
          src={videoUrl}
          trimBefore={videoStartFrame}
          muted={muted}
          onAutoPlayError={onAutoPlayError}
          onLoadedMetadata={seekBrowserVideoToMasterOffset}
          onCanPlay={seekBrowserVideoToMasterOffset}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: usesStandardLayout ? "contain" : videoFit || "cover",
          }}
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
    videoFit,
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
            videoFit={videoFit}
            opacity={opacity}
            muted={muted}
            isRendering={environment.isRendering}
            onAutoPlayError={onAutoPlayError}
            seekBrowserVideoToMasterOffset={seekBrowserVideoToMasterOffset}
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
