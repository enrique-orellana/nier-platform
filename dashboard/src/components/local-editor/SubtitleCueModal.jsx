import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-violet-400";

export default function SubtitleCueModal({ cue, onSave, onClose, onDelete }) {
  const [draft, setDraft] = useState(cue);
  const words = Array.isArray(draft?.captions)
    ? draft.captions.filter((word) => String(word?.text || "").trim())
    : [];

  useEffect(() => setDraft(cue), [cue]);

  if (!cue || !draft) return null;

  const updateWord = (index, field, value) => {
    const captions = words.map((word, wordIndex) =>
      wordIndex === index
        ? { ...word, [field]: field === "text" ? value : Number(value) }
        : word,
    );
    setDraft((current) => ({ ...current, captions }));
  };

  const handleSave = () => onSave({ ...draft, captions: words });

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="subtitle-cue-title"
        className="pointer-events-auto max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950/95 p-6 shadow-2xl shadow-black/50 backdrop-blur-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="subtitle-cue-title"
            className="text-lg font-bold uppercase tracking-[0.2em] text-violet-300"
          >
            Subtitle cue
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cue editor"
            className="rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <label className="block text-sm text-zinc-400">
          Subtitle text
          <textarea
            aria-label="Subtitle text"
            rows={3}
            value={draft.text || ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, text: event.target.value }))
            }
            className={`${inputClass} mt-2 resize-y text-base`}
          />
        </label>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-sm text-zinc-400">
            Start (ms)
            <input
              aria-label="Subtitle start"
              type="number"
              value={draft.startMs}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  startMs: Number(event.target.value),
                }))
              }
              className={`${inputClass} mt-2`}
            />
          </label>
          <label className="text-sm text-zinc-400">
            End (ms)
            <input
              aria-label="Subtitle end"
              type="number"
              value={draft.endMs}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  endMs: Number(event.target.value),
                }))
              }
              className={`${inputClass} mt-2`}
            />
          </label>
        </div>

        <div className="mt-5 border-t border-white/10 pt-5">
          <h3 className="mb-3 text-base font-bold uppercase tracking-[0.16em] text-cyan-200">
            Word timings
          </h3>
          {words.length ? (
            <div className="space-y-2 rounded-xl border border-cyan-300/20 bg-black/20 p-3">
              {words.map((word, index) => (
                <div
                  key={`${word.startMs}-${index}`}
                  className="grid grid-cols-[minmax(0,1fr)_100px_100px] gap-2"
                >
                  <input
                    aria-label={`Word ${index + 1} text`}
                    value={word.text || ""}
                    onChange={(event) =>
                      updateWord(index, "text", event.target.value)
                    }
                    className={inputClass}
                  />
                  <input
                    aria-label={`Word ${index + 1} start`}
                    type="number"
                    value={word.startMs}
                    onChange={(event) =>
                      updateWord(index, "startMs", event.target.value)
                    }
                    className={inputClass}
                  />
                  <input
                    aria-label={`Word ${index + 1} end`}
                    type="number"
                    value={word.endMs}
                    onChange={(event) =>
                      updateWord(index, "endMs", event.target.value)
                    }
                    className={inputClass}
                  />
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_100px_100px] gap-2 px-3 text-[10px] uppercase tracking-wider text-zinc-500">
                <span>Word</span>
                <span>Start</span>
                <span>End</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No word timings attached.</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400"
          >
            Save cue
          </button>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(cue.id)}
            className="mt-3 w-full rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/10"
          >
            Delete subtitle cue
          </button>
        )}
      </div>
    </div>
  );
}
