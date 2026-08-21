import React, { useCallback, useEffect } from "react";

const clampFrame = (frame, durationFrames) =>
  Math.max(0, Math.min(durationFrames - 1, frame));

export default function TransportControls({
  currentFrame,
  durationFrames,
  fps,
  playing,
  onPlayingChange,
  onFrameChange,
  zoom,
  onZoomChange,
}) {
  const requestPlayback = useCallback(
    (nextPlaying) => {
      window.dispatchEvent(
        new CustomEvent("openshorts:playback-request", { detail: nextPlaying }),
      );
      onPlayingChange(nextPlaying);
    },
    [onPlayingChange],
  );
  useEffect(() => {
    const onKey = (event) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.key === " ") {
        event.preventDefault();
        requestPlayback(!playing);
      }
      if (event.key === "ArrowLeft")
        onFrameChange(clampFrame(currentFrame - 1, durationFrames));
      if (event.key === "ArrowRight")
        onFrameChange(clampFrame(currentFrame + 1, durationFrames));
      if (event.key.toLowerCase() === "k") requestPlayback(false);
      if (event.key.toLowerCase() === "l") requestPlayback(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentFrame, durationFrames, onFrameChange, playing, requestPlayback]);
  const time = `${Math.floor(currentFrame / fps / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((currentFrame / fps) % 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(currentFrame % fps)
    .toString()
    .padStart(2, "0")}`;
  return (
    <div className="flex items-center gap-2 border-b border-white/10 bg-[#19191d] px-3 py-2 text-xs">
      <button
        type="button"
        aria-label="previous frame"
        onClick={() =>
          onFrameChange(clampFrame(currentFrame - 1, durationFrames))
        }
        className="rounded px-2 py-1 text-zinc-300 hover:bg-white/10"
      >
        ◀|
      </button>
      <button
        type="button"
        aria-label={playing ? "pause" : "play"}
        onClick={() => requestPlayback(!playing)}
        className="rounded bg-white/10 px-3 py-1 text-white"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <button
        type="button"
        aria-label="next frame"
        onClick={() =>
          onFrameChange(clampFrame(currentFrame + 1, durationFrames))
        }
        className="rounded px-2 py-1 text-zinc-300 hover:bg-white/10"
      >
        |▶
      </button>
      <span className="ml-2 font-mono text-cyan-300">{time}</span>
      <select
        aria-label="Timeline zoom"
        value={zoom}
        onChange={(event) => onZoomChange(Number(event.target.value))}
        className="ml-auto rounded bg-black/30 px-2 py-1 text-zinc-300"
      >
        <option value="0.25">25%</option>
        <option value="0.5">50%</option>
        <option value="1">100%</option>
        <option value="2">200%</option>
        <option value="4">400%</option>
        <option value="8">800%</option>
      </select>
    </div>
  );
}
