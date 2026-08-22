import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

const inputClass =
  "w-full rounded-md border border-white/10 bg-[#111114] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-1 focus:ring-violet-400/20";

export default function SubtitleCueModal({ cue, onSave, onClose }) {
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
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="subtitle-cue-title"
        className="pointer-events-auto max-h-[82vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/15 bg-[#0d0d10]/[.98] p-5 shadow-2xl shadow-black/50"
      >
        <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
          <h2
            id="subtitle-cue-title"
            className="text-base font-bold uppercase tracking-[0.18em] text-violet-300"
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

        <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
          Subtitle text
          <textarea
            aria-label="Subtitle text"
            rows={2}
            value={draft.text || ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, text: event.target.value }))
            }
            className={`${inputClass} mt-1.5 resize-y text-sm normal-case tracking-normal`}
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">
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
              className={`${inputClass} mt-1.5 normal-case tracking-normal`}
            />
          </label>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">
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
              className={`${inputClass} mt-1.5 normal-case tracking-normal`}
            />
          </label>
        </div>

        <div className="mt-4 border-t border-white/10 pt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
            Word timings
          </h3>
          {words.length ? (
            <div className="space-y-2 rounded-lg border border-cyan-300/20 bg-black/20 p-2">
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

        <div className="mt-4 flex justify-end gap-2 border-t border-white/10 pt-4">
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
      </div>
    </div>
  );
}
