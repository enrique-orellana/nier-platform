import React from "react";
import TimelineTrack from "./TimelineTrack";

const cuesFromTrack = (track) =>
  (track?.cues || track?.captions || []).map((cue, i) => ({
    ...cue,
    id: cue.id || `${track.id || "track"}-${i}`,
    text: cue.text || cue.words?.map((w) => w.text).join(" ") || "",
  }));

export default function Timeline({
  durationMs,
  tracks = [],
  hook = null,
  selectedCue,
  onSelectCue,
  onChangeCue,
  playheadMs = 0,
  onSeek,
}) {
  const seek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek?.(
      Math.max(
        0,
        Math.min(
          durationMs,
          ((e.clientX - rect.left) / rect.width) * durationMs,
        ),
      ),
    );
  };
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-[#101014]">
      <div
        className="relative h-8 ml-36 border-b border-white/10 cursor-pointer"
        onClick={seek}
      >
        <div
          className="absolute top-0 bottom-0 w-px bg-cyan-300"
          style={{ left: `${(playheadMs / durationMs) * 100}%` }}
        />
      </div>
      <TimelineTrack
        label="Viral Hook"
        durationMs={durationMs}
        cues={
          hook
            ? [
                {
                  ...hook,
                  id: "hook",
                  text: hook.text,
                  startMs: hook.startMs || 0,
                  endMs: hook.endMs || hook.displayDurationSec * 1000,
                },
              ]
            : []
        }
        selectedCueId={selectedCue?.id}
        onSelectCue={onSelectCue}
        onChangeCue={onChangeCue}
        color="#f59e0b"
      />
      {tracks.map((track) => (
        <TimelineTrack
          key={track.id}
          label={track.label || track.language}
          durationMs={durationMs}
          cues={cuesFromTrack(track)}
          selectedCueId={selectedCue?.id}
          onSelectCue={onSelectCue}
          onChangeCue={onChangeCue}
          color={track.origin === "translation" ? "#10b981" : "#8b5cf6"}
        />
      ))}
    </div>
  );
}
