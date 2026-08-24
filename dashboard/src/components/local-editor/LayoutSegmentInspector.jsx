import React from "react";

const layoutOptions = [
  { value: "standard", label: "Standard" },
  { value: "streamer_stack", label: "Streamer" },
];

const transitionOptions = [
  { value: "cut", label: "Cut" },
  { value: "crossfade", label: "Crossfade" },
];

export default function LayoutSegmentInspector({
  segment = null,
  onChange,
  onSplit,
  disabled = false,
}) {
  if (!segment)
    return (
      <section
        aria-label="Layout segment settings"
        className="rounded-xl border border-white/10 bg-white/[.02] p-4"
      >
        <p className="text-xs leading-5 text-zinc-500">
          Select a Layout segment to edit its video format and transition.
        </p>
      </section>
    );

  return (
    <section
      aria-label="Layout segment settings"
      className="rounded-xl border border-white/10 bg-white/[.02] p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">
            Layout segment
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            Only the video layout changes. Subtitles and hooks stay continuous.
          </p>
        </div>
        <button
          type="button"
          onClick={onSplit}
          disabled={disabled}
          className="rounded-md border border-cyan-300/30 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Split at playhead
        </button>
      </div>

      <div className="space-y-3">
        <fieldset>
          <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Video layout
          </legend>
          <div className="grid grid-cols-2 gap-1.5">
            {layoutOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={segment.format === option.value}
                onClick={() => onChange?.({ format: option.value })}
                className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${segment.format === option.value ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100" : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Transition into segment
          </legend>
          <div className="grid grid-cols-2 gap-1.5">
            {transitionOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={segment.transition === option.value}
                onClick={() => onChange?.({ transition: option.value })}
                className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${segment.transition === option.value ? "border-violet-300/60 bg-violet-300/15 text-violet-100" : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        {segment.transition === "crossfade" && (
          <label className="block text-[11px] text-zinc-400">
            Crossfade duration (ms)
            <input
              type="number"
              min="1"
              max="2000"
              step="10"
              aria-label="Crossfade duration (ms)"
              value={segment.transitionDurationMs ?? 250}
              onChange={(event) =>
                onChange?.({
                  transitionDurationMs: Number(event.target.value) || 0,
                })
              }
              className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-300/60"
            />
          </label>
        )}
      </div>
    </section>
  );
}
