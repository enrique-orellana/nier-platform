import React from "react";
import { Video } from "@remotion/media";
import { AbsoluteFill } from "remotion";
import type { ShortVideoProps } from "../lib/types";
import { Subtitles } from "./Subtitles";
import { HookOverlay } from "./HookOverlay";
import { VideoEffects } from "./VideoEffects";

/**
 * Main composition that layers all post-processing on top of the base video.
 * Uses Remotion's media decoder in both the Player and renderer. This keeps
 * high-resolution AV1 masters on MinIO while avoiding the browser's slower
 * HTML5 decode path in the interactive preview.
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
    hook,
    effects,
  } = rawProps as unknown as ShortVideoProps;
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
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Layer 1: Base video with optional zoom/color effects */}
      <VideoEffects config={effects}>
        <Video
          src={videoUrl}
          trimBefore={videoStartFrame}
          objectFit={videoFit || "cover"}
          fallbackOffthreadVideoProps={{
            onAutoPlayError,
            pauseWhenBuffering: true,
            useWebAudioApi: true,
          }}
          style={{
            width: "100%",
            height: "100%",
          }}
        />
      </VideoEffects>

      {/* Layer 2: Animated subtitles */}
      {activeSubtitles && <Subtitles config={activeSubtitles} />}

      {/* Layer 3: Hook text overlay */}
      {hook && <HookOverlay config={hook} />}
    </AbsoluteFill>
  );
};
