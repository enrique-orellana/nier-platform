import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Video } from "@remotion/media";
import {
  AbsoluteFill,
  Internals,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";
import type { ShortVideoProps } from "../lib/types";
import { Subtitles } from "./Subtitles";
import { HookOverlay } from "./HookOverlay";
import { VideoEffects } from "./VideoEffects";

export const getMediaTimeMs = (
  mediaCurrentTimeSeconds: number,
  videoStartSeconds: number,
): number | null => {
  const mediaTime = Number(mediaCurrentTimeSeconds);
  const startTime = Number(videoStartSeconds);
  if (!Number.isFinite(mediaTime) || !Number.isFinite(startTime)) return null;
  return Math.max(0, (mediaTime - startTime) * 1000);
};

const BrowserVideo: React.FC<{
  videoUrl: string;
  videoStartSeconds: number;
  onAutoPlayError?: () => void;
  onMediaTimeChange?: (mediaTimeMs: number | null) => void;
  fps: number;
  objectFit: string;
}> = ({
  videoUrl,
  videoStartSeconds,
  onAutoPlayError,
  onMediaTimeChange,
  fps,
  objectFit,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoId = useId();
  const frame = useCurrentFrame();
  const videoConfig = useVideoConfig();
  const timeline = Internals.Timeline.useTimelineContext();
  const lastFrameRef = useRef(frame);
  const lastSourceKeyRef = useRef("");
  const sourceKey = `${videoUrl}:${videoStartSeconds}:${videoConfig.fps || fps}`;

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
    const shouldSync = sourceChanged || !timeline.playing || frameDelta > 3;
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
      data-testid="native-browser-video"
      src={videoUrl}
      preload="auto"
      playsInline
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
      }}
    />
  );
};

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
  const [mediaTimeMs, setMediaTimeMs] = useState<number | null>(null);
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
          <BrowserVideo
            videoUrl={videoUrl}
            videoStartSeconds={videoStartSeconds}
            onAutoPlayError={onAutoPlayError}
            onMediaTimeChange={activeSubtitles ? setMediaTimeMs : undefined}
            fps={Number(fps)}
            objectFit={usesStandardLayout ? "contain" : videoFit || "cover"}
          />
        )}
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
