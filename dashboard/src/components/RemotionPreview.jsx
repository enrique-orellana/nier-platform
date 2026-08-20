import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Player } from "@remotion/player";
import { ShortVideo } from "../remotion/compositions/ShortVideo";

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
  hook = null,
  effects = null,
  currentFrame = 0,
  playing = true,
  loop = true,
  controls = true,
  onFrameChange,
  onPlayingChange,
  onPlayerReady,
  className = "",
}) {
  const durationInFrames = Math.max(1, Math.round(durationInSeconds * fps));
  const playerRef = useRef(null);
  const playerFrameRef = useRef(null);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);

  const handleAutoPlayError = useCallback(() => {
    setAudioPlaybackBlocked(true);
  }, []);

  const handlePlayWithSound = useCallback((event) => {
    const player = playerRef.current;
    if (!player) return;
    player.pause?.();
    player.unmute?.();
    player.play?.(event);
    setAudioPlaybackBlocked(false);
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const targetFrame = Math.max(
      0,
      Math.min(durationInFrames - 1, Math.round(currentFrame)),
    );
    if (playerFrameRef.current === targetFrame) {
      playerFrameRef.current = null;
      return;
    }
    player.seekTo?.(targetFrame);
  }, [currentFrame, durationInFrames]);

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
      playerFrameRef.current = event.detail.frame;
      onFrameChange?.(event.detail.frame);
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
  }, [onFrameChange, onPlayingChange, onPlayerReady]);

  const inputProps = useMemo(
    () => ({
      videoUrl,
      videoStartSeconds,
      durationInFrames,
      fps,
      width,
      height,
      subtitles,
      subtitleTracks,
      activeSubtitleTrackId,
      hook,
      effects,
      onAutoPlayError: handleAutoPlayError,
    }),
    [
      videoUrl,
      videoStartSeconds,
      durationInFrames,
      fps,
      width,
      height,
      subtitles,
      subtitleTracks,
      activeSubtitleTrackId,
      hook,
      effects,
      handleAutoPlayError,
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
        acknowledgeRemotionLicense={true}
      />
      {audioPlaybackBlocked && (
        <button
          type="button"
          onClick={handlePlayWithSound}
          className="absolute inset-x-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg hover:bg-zinc-200"
        >
          Play with sound
        </button>
      )}
    </div>
  );
}

export default React.memo(RemotionPreview);
