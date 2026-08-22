import React from "react";
import { X } from "lucide-react";

export default function LocalEditorSubtitleInspector({
  cue,
  onChange,
  onDelete,
}) {
  if (!cue)
    return (
      <p className="text-xs text-zinc-500">
        Select a subtitle cue on the timeline to edit it.
      </p>
    );
  const wordTimings = Array.isArray(cue.captions)
    ? cue.captions.filter((word) => String(word?.text || "").trim())
    : [];
  const createWordTimings = () => onChange({ ...cue, captions: undefined });
  const updateWord = (index, field, value) => {
    const captions = wordTimings.map((word, wordIndex) =>
      wordIndex === index
        ? { ...word, [field]: field === "text" ? value : Number(value) }
        : word,
    );
    onChange({
      ...cue,
      text: captions
        .map((word) => word.text || "")
        .join(" ")
        .trim(),
      label: captions
        .map((word) => word.text || "")
        .join(" ")
        .trim(),
      captions,
    });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">
          Subtitle cue
        </h3>
        <button
          type="button"
          onClick={() => onDelete(cue.id)}
          className="text-zinc-500 hover:text-red-300"
          aria-label="Delete subtitle cue"
        >
          <X size={14} />
        </button>
      </div>
      <label className="block text-xs text-zinc-400">
        Subtitle text
        <textarea
          aria-label="Subtitle text"
          rows={3}
          value={cue.text}
          onChange={(event) => onChange({ ...cue, text: event.target.value })}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white outline-none focus:border-violet-400"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-zinc-400">
          Start (ms)
          <input
            aria-label="Subtitle start"
            type="number"
            value={cue.startMs}
            onChange={(event) =>
              onChange({ ...cue, startMs: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-zinc-400">
          End (ms)
          <input
            aria-label="Subtitle end"
            type="number"
            value={cue.endMs}
            onChange={(event) =>
              onChange({ ...cue, endMs: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
      </div>
      <div className="border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
            Word timings
          </h4>
          {!wordTimings.length && (
            <button
              type="button"
              onClick={createWordTimings}
              className="rounded-md border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-400/20"
            >
              Create word timings
            </button>
          )}
        </div>
        {wordTimings.length ? (
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-cyan-300/15 bg-black/20 p-2">
            {wordTimings.map((word, index) => (
              <div
                key={`${word.startMs}-${index}`}
                className="grid grid-cols-[minmax(0,1fr)_74px_74px] gap-1.5"
              >
                <input
                  aria-label={`Word ${index + 1} text`}
                  value={word.text || ""}
                  onChange={(event) =>
                    updateWord(index, "text", event.target.value)
                  }
                  className="min-w-0 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                />
                <input
                  aria-label={`Word ${index + 1} start`}
                  type="number"
                  value={word.startMs}
                  onChange={(event) =>
                    updateWord(index, "startMs", event.target.value)
                  }
                  className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white"
                />
                <input
                  aria-label={`Word ${index + 1} end`}
                  type="number"
                  value={word.endMs}
                  onChange={(event) =>
                    updateWord(index, "endMs", event.target.value)
                  }
                  className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white"
                />
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_74px_74px] gap-1.5 px-2 pt-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
              <span>Word</span>
              <span>Start</span>
              <span>End</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] leading-5 text-zinc-500">
            No word timings are attached to this cue yet. Create them to enable
            word-level highlighting in the preview and export.
          </p>
        )}
      </div>
    </div>
  );
}
