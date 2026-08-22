import React from "react";
import {
  HOOK_ENTRANCE_OPTIONS,
  HOOK_SIZE_OPTIONS,
  SUBTITLE_COLOR_PRESETS,
} from "./localEditorStyles";
import { cleanChoiceClass, cleanLabelClass } from "./localEditorUtils";

export default function LocalEditorHookInspector({ hook, onChange, onRemove }) {
  if (!hook)
    return (
      <p className="text-xs text-zinc-500">
        Add a hook to place a bold opening message over the video.
      </p>
    );
  const displayDuration = Math.max(
    2,
    Math.round((hook.endMs - hook.startMs) / 1000),
  );
  const updateDuration = (value) =>
    onChange({
      ...hook,
      endMs: Math.max(hook.startMs + 80, hook.startMs + Number(value) * 1000),
    });
  return (
    <div className="space-y-5">
      <h3 className="text-sm font-bold text-white">Viral Hook</h3>
      <label className="block">
        <span className={cleanLabelClass}>Text</span>
        <textarea
          aria-label="Hook text"
          rows={4}
          value={hook.text}
          onChange={(event) => onChange({ ...hook, text: event.target.value })}
          className="w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 font-serif text-sm text-white placeholder-zinc-600 focus:border-amber-500/50 focus:outline-none"
          placeholder="Enter text that will stop the scroll..."
        />
      </label>
      <div>
        <span className={cleanLabelClass}>Position</span>
        <div className="grid grid-cols-3 gap-2">
          {["top", "center", "bottom"].map((position) => (
            <button
              key={position}
              type="button"
              aria-label={position.charAt(0).toUpperCase() + position.slice(1)}
              onClick={() => onChange({ ...hook, position })}
              className={cleanChoiceClass(hook.position === position)}
            >
              {position}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={cleanLabelClass}>Size</span>
        <div className="grid grid-cols-3 gap-2">
          {HOOK_SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ ...hook, size: option.value })}
              className={cleanChoiceClass((hook.size || "M") === option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={cleanLabelClass}>Entrance</span>
        <div className="grid grid-cols-2 gap-2">
          {HOOK_ENTRANCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                onChange({ ...hook, entranceAnimation: option.value })
              }
              className={cleanChoiceClass(
                (hook.entranceAnimation || "spring") === option.value,
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label
          className={`${cleanLabelClass} flex items-center justify-between`}
        >
          <span>Duration</span>
          <span>{displayDuration}s</span>
        </label>
        <input
          aria-label="Hook duration"
          type="range"
          min="2"
          max="15"
          value={displayDuration}
          onChange={(event) => updateDuration(event.target.value)}
          className="w-full accent-amber-500"
        />
        <div className="flex justify-between text-[10px] text-zinc-500">
          <span>2s</span>
          <span>15s</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-zinc-400">
          Start (ms)
          <input
            aria-label="Hook start"
            type="number"
            value={hook.startMs}
            onChange={(event) =>
              onChange({ ...hook, startMs: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-zinc-400">
          End (ms)
          <input
            aria-label="Hook end"
            type="number"
            value={hook.endMs}
            onChange={(event) =>
              onChange({ ...hook, endMs: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
      </div>
      <div>
        <span className={cleanLabelClass}>Text color</span>
        <div
          className="flex flex-wrap gap-2"
          aria-label="Hook text color presets"
        >
          {SUBTITLE_COLOR_PRESETS.map((preset) => (
            <button
              key={preset.color}
              type="button"
              aria-label={`Use hook text color ${preset.label}`}
              title={preset.label}
              onClick={() => onChange({ ...hook, color: preset.color })}
              className={`h-7 w-7 rounded-full border-2 transition-all ${String(hook.color || "").toUpperCase() === preset.color ? "scale-110 border-white" : "border-white/20 hover:border-white/50"}`}
              style={{ backgroundColor: preset.color }}
            />
          ))}
          <label
            className="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-white/20 transition-all hover:border-white/50"
            title="Custom color"
          >
            <span className="text-[10px] text-zinc-400">+</span>
            <input
              aria-label="Hook text color"
              type="color"
              value={hook.color}
              onChange={(event) =>
                onChange({ ...hook, color: event.target.value })
              }
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-zinc-400">
          Size
          <input
            aria-label="Hook font size"
            type="number"
            min="12"
            max="160"
            value={hook.fontSize}
            onChange={(event) =>
              onChange({ ...hook, fontSize: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Background
          <input
            aria-label="Hook background"
            type="color"
            value={hook.background}
            onChange={(event) =>
              onChange({ ...hook, background: event.target.value })
            }
            className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="w-full rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/10"
      >
        Remove Hook
      </button>
    </div>
  );
}
