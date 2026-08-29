import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Player } from "@remotion/player";
import { ShortVideo } from "../remotion/compositions/ShortVideo";
import { useRenewableMediaUrl } from "../lib/videoUrls";

/**
 * Wraps Remotion's Player component for real-time preview in modals.
 * Accepts the same ShortVideoProps interface as the Remotion composition.
 *
 * @param {object} props
 * @param {string} props.videoUrl - URL to the base clip video
 * @param {number} props.durationInSeconds - Video duration in seconds
 * @param {object|null} props.subtitles - SubtitleConfig or null
 * @param {object|null} props.hook - HookConfig or null
 * @param {object|null} props.effects - EffectsConfig or null
 * @param {number} [props.playbackRate] - Playback speed multiplier
 * @param {(mediaTimeMs: number|null) => void} [props.onMediaTimeChange] - Native video clock callback
 * @param {boolean} [props.gameplayCropEditing] - Enables the preview-only Streamer framing overlay
 * @param {(next: {focus: {x: number, y: number}, zoom: number}) => void} [props.onGameplayCropChange] - Persists a completed framing drag
 * @param {() => void} [props.onGameplayCropReset] - Clears the selected segment framing override
 * @param {() => void} [props.onGameplayCropDone] - Closes the framing overlay
 * @param {string} [props.className] - Additional CSS classes
 */
function RemotionPreview({
  videoUrl,
  videoStartSeconds = 0,
  durationInSeconds = 30,
  fps = 30,
  width = 1080,
  height = 1920,
  subtitles = null,
  subtitleTracks = [],
  activeSubtitleTrackId = null,
  layout = null,
  hook = null,
  effects = null,
  currentFrame = 0,
  playing = true,
  loop = true,
  playbackRate = 1,
  controls = true,
  onFrameChange,
  onMediaTimeChange,
  gameplayCropEditing = false,
  onGameplayCropChange,
  onGameplayCropReset,
  onGameplayCropDone,
  onPlayingChange,
  onPlayerReady,
  className = "",
}) {
  const { url: resolvedVideoUrl } = useRenewableMediaUrl(videoUrl);
  const durationInFrames = Math.max(1, Math.round(durationInSeconds * fps));
  const playerRef = useRef(null);
  const playerFrameRef = useRef(null);
  const wasPlayingRef = useRef(playing);
  const handleMediaTimeChange = useCallback(
    (mediaTimeMs) => {
      onMediaTimeChange?.(mediaTimeMs);
      const durationMs = durationInSeconds * 1000;
      const finalFrameToleranceMs = 1000 / Math.max(1, Number(fps) || 30);
      if (
        wasPlayingRef.current &&
        !loop &&
        Number.isFinite(mediaTimeMs) &&
        mediaTimeMs >= durationMs - finalFrameToleranceMs
      ) {
        playerRef.current?.pause?.();
        onPlayingChange?.(false);
      }
    },
    [durationInSeconds, fps, loop, onMediaTimeChange, onPlayingChange],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    // The editor receives frame updates from this player and publishes them
    // back on a throttled clock. Seeking from that delayed value while the
    // player is running makes every update jump the media backwards.
    if (playing) {
      wasPlayingRef.current = true;
      return;
    }
    // A temporary media pause (for example while buffering) must not be
    // treated as an external seek. Keep the current media frame intact.
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false;
      return;
    }
    const targetFrame = Math.max(
      0,
      Math.min(durationInFrames - 1, Math.round(currentFrame)),
    );
    if (playerFrameRef.current === targetFrame) {
      playerFrameRef.current = null;
      return;
    }
    player.seekTo?.(targetFrame);
  }, [currentFrame, durationInFrames, playing]);

  useEffect(() => {
    if (playing) playerRef.current?.play?.();
    else playerRef.current?.pause?.();
  }, [playing]);

  useEffect(() => {
    const onPlaybackRequest = (event) => {
      if (event.detail === true) playerRef.current?.play?.();
      if (event.detail === false) playerRef.current?.pause?.();
    };
    window.addEventListener("openshorts:playback-request", onPlaybackRequest);
    return () =>
      window.removeEventListener(
        "openshorts:playback-request",
        onPlaybackRequest,
      );
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return undefined;
    onPlayerReady?.(player);
    const onFrameUpdate = (event) => {
      const frame = event.detail.frame;
      playerFrameRef.current = frame;
      onFrameChange?.(frame);
      if (
        wasPlayingRef.current &&
        !onMediaTimeChange &&
        !loop &&
        frame >= durationInFrames - 1
      ) {
        player.pause?.();
        onPlayingChange?.(false);
      }
    };
    const onPlay = () => onPlayingChange?.(true);
    const onPause = () => onPlayingChange?.(false);
    player.addEventListener("frameupdate", onFrameUpdate);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    return () => {
      player.removeEventListener("frameupdate", onFrameUpdate);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      onPlayerReady?.(null);
    };
  }, [
    durationInFrames,
    loop,
    onFrameChange,
    onMediaTimeChange,
    onPlayingChange,
    onPlayerReady,
  ]);

  const inputProps = useMemo(
    () => ({
      videoUrl: resolvedVideoUrl,
      videoStartSeconds,
      playbackRate,
      durationInFrames,
      fps,
      width,
      height,
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
      onMediaTimeChange: onMediaTimeChange ? handleMediaTimeChange : undefined,
    }),
    [
      resolvedVideoUrl,
      videoStartSeconds,
      playbackRate,
      durationInFrames,
      fps,
      width,
      height,
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
      handleMediaTimeChange,
      onMediaTimeChange,
    ],
  );

  return (
    <div className={`relative w-full h-full ${className}`}>
      <Player
        ref={playerRef}
        component={ShortVideo}
        inputProps={inputProps}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        style={{
          width: "100%",
          height: "100%",
        }}
        controls={controls}
        autoPlay={playing}
        loop={loop}
        playbackRate={playbackRate}
        acknowledgeRemotionLicense={true}
      />
    </div>
  );
}

export default React.memo(RemotionPreview);
