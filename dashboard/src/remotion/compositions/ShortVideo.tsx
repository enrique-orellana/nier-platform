import React from "react";
import { Video } from "@remotion/media";
import { AbsoluteFill, Html5Video, useRemotionEnvironment } from "remotion";
import type { ShortVideoProps } from "../lib/types";
import { Subtitles } from "./Subtitles";
import { HookOverlay } from "./HookOverlay";
import { VideoEffects } from "./VideoEffects";

/**
 * Main composition that layers all post-processing on top of the base video.
 * The renderer uses Remotion's media decoder, while the interactive Player
 * uses one native browser decoder so audio and seeking stay responsive.
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
  const videoStartFrame = Math.max(
    0,
    Math.round(Number(videoStartSeconds) * Number(fps)),
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
  const usesStandardLayout = layout?.format === "standard";
  const environment = useRemotionEnvironment();
  const seekBrowserVideoToMasterOffset = (
    event: React.SyntheticEvent<HTMLVideoElement>,
  ) => {
    if (videoStartFrame <= 0) return;
    const targetSeconds = Math.max(0, Number(videoStartSeconds));
    if (event.currentTarget.currentTime < targetSeconds - 0.05)
      event.currentTarget.currentTime = targetSeconds;
  };
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {usesStandardLayout && environment.isRendering && (
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

      {/* Base video with optional zoom/color effects */}
      <VideoEffects config={effects}>
        {environment.isRendering ? (
          <Video
            src={videoUrl}
            trimBefore={videoStartFrame}
            objectFit={usesStandardLayout ? "contain" : videoFit || "cover"}
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
      </VideoEffects>

      {/* Layer 2: Animated subtitles */}
      {activeSubtitles && <Subtitles config={activeSubtitles} />}

      {/* Layer 3: Hook text overlay */}
      {hook && <HookOverlay config={hook} />}
    </AbsoluteFill>
  );
};
