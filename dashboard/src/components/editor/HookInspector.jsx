import React from "react";

export default function HookInspector({ hook, onChange }) {
  if (!hook)
    return (
      <div className="text-xs text-zinc-500">
        Select the hook on the timeline.
      </div>
    );
  const set = (key, value) =>
    onChange({
      ...hook,
      [key]:
        key === "startMs" || key === "endMs" || key === "displayDurationSec"
          ? Number(value)
          : value,
    });
  return (
    <div className="space-y-2 text-xs">
      <label className="block">
        Text
        <input
          className="mt-1 w-full rounded bg-black/30 p-2"
          value={hook.text || ""}
          onChange={(e) => set("text", e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          Start (ms)
          <input
            type="number"
            className="mt-1 w-full rounded bg-black/30 p-2"
            value={hook.startMs || 0}
            onChange={(e) => set("startMs", e.target.value)}
          />
        </label>
        <label>
          End (ms)
          <input
            type="number"
            className="mt-1 w-full rounded bg-black/30 p-2"
            value={hook.endMs || hook.displayDurationSec * 1000 || 1000}
            onChange={(e) => set("endMs", e.target.value)}
          />
        </label>
      </div>
      <label className="block">
        Position
        <select
          className="mt-1 w-full rounded bg-black/30 p-2"
          value={hook.position || "top"}
          onChange={(e) => set("position", e.target.value)}
        >
          <option>top</option>
          <option>center</option>
          <option>bottom</option>
        </select>
      </label>
    </div>
  );
}
