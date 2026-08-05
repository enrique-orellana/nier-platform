import React from "react";
import { Video } from "@remotion/media";
import { AbsoluteFill, Html5Video, useRemotionEnvironment } from "remotion";
import type { ShortVideoProps } from "../lib/types";
import { Subtitles } from "./Subtitles";
import { HookOverlay } from "./HookOverlay";
import { VideoEffects } from "./VideoEffects";

/**
 * Main composition that layers all post-processing on top of the base video.
 * Uses native HTML5 media in the Player and the browser-compatible Remotion Video during rendering.
 */
export const ShortVideo: React.FC<Record<string, unknown>> = (rawProps) => {
  const { videoUrl, subtitles, subtitleTracks, activeSubtitleTrackId, hook, effects } =
    rawProps as unknown as ShortVideoProps;
  const environment = useRemotionEnvironment();
  const activeTrack = subtitleTracks?.find(
    (track) => track.id === (activeSubtitleTrackId || subtitleTracks[0]?.id)
  );
  const activeSubtitles = activeTrack && subtitles
    ? { ...subtitles, captions: activeTrack.captions, style: activeTrack.style || subtitles.style }
    : subtitles;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Layer 1: Base video with optional zoom/color effects */}
      <VideoEffects config={effects}>
        {environment.isRendering ? (
            <Video
            src={videoUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <Html5Video
            src={videoUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
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
