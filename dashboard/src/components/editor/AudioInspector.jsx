import React from "react";

export default function AudioInspector({ audio, onChange }) {
  if (!audio)
    return (
      <div className="text-xs text-zinc-500">
        Select an audio clip on the timeline.
      </div>
    );
  const set = (key, value) =>
    onChange?.({
      ...audio,
      [key]:
        key === "volume" || key === "start" || key === "end"
          ? Number(value)
          : value,
    });
  return (
    <div className="space-y-3 text-xs">
      <div className="font-semibold text-zinc-300">Audio clip</div>
      <label className="flex items-center justify-between gap-2">
        <span>Mute</span>
        <input
          type="checkbox"
          checked={Boolean(audio.muted)}
          onChange={(event) => set("muted", event.target.checked)}
          aria-label="Mute audio"
        />
      </label>
      <label className="block">
        Volume
        <input
          aria-label="Volume"
          type="number"
          min="0"
          max="2"
          step="0.05"
          className="mt-1 w-full rounded bg-black/30 p-2"
          value={audio.volume ?? 1}
          onChange={(event) => set("volume", event.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          Start (s)
          <input
            type="number"
            min="0"
            step="0.001"
            className="mt-1 w-full rounded bg-black/30 p-2"
            value={audio.start ?? 0}
            onChange={(event) => set("start", event.target.value)}
          />
        </label>
        <label>
          End (s)
          <input
            type="number"
            min="0"
            step="0.001"
            className="mt-1 w-full rounded bg-black/30 p-2"
            value={audio.end ?? 0}
            onChange={(event) => set("end", event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
