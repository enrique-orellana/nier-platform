import React from "react";
import {
  DEFAULT_SUBTITLE_REACTION_STYLE,
  normalizeSubtitleReactionStyle,
} from "./subtitleReactions";

const formatCueTime = (milliseconds) => {
  const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  return `${seconds.toFixed(1)}s`;
};

const ReactionReviewRow = ({ suggestion, onChange }) => {
  const update = (patch) =>
    onChange((suggestions) =>
      suggestions.map((item) =>
        item.id === suggestion.id ? { ...item, ...patch } : item,
      ),
    );

  return (
    <div
      className={`rounded-lg border px-3 py-3 ${suggestion.enabled ? "border-violet-400/30 bg-violet-400/[.06]" : "border-white/10 bg-white/[.02] opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-zinc-100">
            {suggestion.text || "Untitled cue"}
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">
            {formatCueTime(suggestion.startMs)} –{" "}
            {formatCueTime(suggestion.endMs)}
          </p>
        </div>
        <button
          type="button"
          aria-label={`${suggestion.enabled ? "Remove" : "Enable"} reaction for ${suggestion.text || "cue"}`}
          onClick={() => update({ enabled: !suggestion.enabled })}
          className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:border-violet-300/40 hover:text-violet-200"
        >
          {suggestion.enabled ? "Remove" : "Enable"}
        </button>
      </div>
      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Emoji reaction
        <input
          aria-label={`Emoji reaction for ${suggestion.text || "cue"}`}
          value={(suggestion.emojis || []).join(" ")}
          onChange={(event) =>
            update({
              emojis: event.target.value
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2),
            })
          }
          className="input-field mt-1.5 text-lg"
          disabled={!suggestion.enabled}
        />
      </label>
    </div>
  );
};

const ReactionStyleControls = ({ value, onChange }) => {
  const current = normalizeSubtitleReactionStyle(value);
  const update = (key, nextValue) => onChange({ ...current, [key]: nextValue });

  return (
    <div className="grid grid-cols-3 gap-2">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Position
        <select
          aria-label="Reaction position"
          value={current.position}
          onChange={(event) => update("position", event.target.value)}
          className="input-field mt-1.5 text-xs"
        >
          <option value="above">Above</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Animation
        <select
          aria-label="Reaction animation"
          value={current.animation}
          onChange={(event) => update("animation", event.target.value)}
          className="input-field mt-1.5 text-xs"
        >
          <option value="pop">Pop</option>
          <option value="shake">Shake</option>
          <option value="fade">Fade</option>
        </select>
      </label>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Size
        <select
          aria-label="Reaction size"
          value={current.scale}
          onChange={(event) => update("scale", Number(event.target.value))}
          className="input-field mt-1.5 text-xs"
        >
          <option value="1">1×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </label>
    </div>
  );
};

export default function SubtitleReactionReviewPanel({
  suggestions = [],
  style = DEFAULT_SUBTITLE_REACTION_STYLE,
  title = "Review reactions",
  description = "Tune the emoji layer before applying it to the full subtitle track.",
  loading = false,
  error = "",
  onChange,
  onStyleChange,
  onRetry,
  onClose,
  onApply,
}) {
  const enabled = suggestions.filter((suggestion) => suggestion.enabled);
  const updateSuggestions = (updater) => {
    const next = typeof updater === "function" ? updater(suggestions) : updater;
    onChange?.(next);
  };

  return (
    <div
      role="dialog"
      aria-label={title}
      className="space-y-3 rounded-xl border border-violet-400/30 bg-[#15121c] p-4 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 text-xs text-zinc-400">{description}</p>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-zinc-400">
          {enabled.length} enabled
        </span>
      </div>

      {loading && (
        <p
          role="status"
          className="rounded-lg bg-white/[.03] p-3 text-xs text-zinc-300"
        >
          Suggesting reactions…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 p-3 text-xs text-red-200"
        >
          {error}
        </p>
      )}
      {!loading && !suggestions.length && (
        <p className="rounded-lg bg-white/[.03] p-3 text-xs text-zinc-400">
          No usable reactions were suggested.
        </p>
      )}
      {!!suggestions.length && (
        <div className="max-h-[48vh] space-y-2 overflow-y-auto">
          {suggestions.map((suggestion) => (
            <ReactionReviewRow
              key={suggestion.id}
              suggestion={suggestion}
              onChange={updateSuggestions}
            />
          ))}
        </div>
      )}

      <ReactionStyleControls
        value={style}
        onChange={onStyleChange || (() => {})}
      />
      <div className="flex gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-violet-300/40 hover:text-violet-200"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-white/25"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onApply?.(enabled, normalizeSubtitleReactionStyle(style))
          }
          disabled={!enabled.length}
          className="rounded-md bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply reactions
        </button>
      </div>
    </div>
  );
}
