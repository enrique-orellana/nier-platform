import { useEffect, useMemo, useState } from "react";

const MINIMUM_RANGE_SECONDS = 1;

function numericValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTime(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function ClipSourceRangeEditor({
  isOpen,
  clip,
  masterDuration,
  onSave,
  onClose,
}) {
  const initialStart = numericValue(clip?.start, 0);
  const initialEnd = numericValue(
    clip?.end,
    initialStart + MINIMUM_RANGE_SECONDS,
  );
  const maximum = Math.max(
    numericValue(masterDuration, 0),
    initialEnd,
    initialStart + MINIMUM_RANGE_SECONDS,
  );
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(
    Math.min(
      maximum,
      Math.max(initialEnd, initialStart + MINIMUM_RANGE_SECONDS),
    ),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setStart(initialStart);
    setEnd(
      Math.min(
        maximum,
        Math.max(initialEnd, initialStart + MINIMUM_RANGE_SECONDS),
      ),
    );
    setError("");
  }, [isOpen, initialStart, initialEnd, maximum]);

  const duration = useMemo(
    () => Math.max(MINIMUM_RANGE_SECONDS, end - start),
    [end, start],
  );

  if (!isOpen) return null;

  const handleStartChange = (value) => {
    const next = Math.max(
      0,
      Math.min(Number(value), end - MINIMUM_RANGE_SECONDS),
    );
    setStart(next);
  };

  const handleEndChange = (value) => {
    const next = Math.min(
      maximum,
      Math.max(Number(value), start + MINIMUM_RANGE_SECONDS),
    );
    setEnd(next);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      const saved = await onSave({ start, end });
      if (saved === false) throw new Error("Could not save clip range.");
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Could not save clip range.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Adjust clip range"
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#121214] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Adjust clip range
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Extend or compact the clip before rendering.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
            aria-label="Close clip range editor"
          >
            ×
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <label className="block text-xs text-zinc-300">
            <span className="flex justify-between">
              <span>Start</span>
              <span className="font-mono text-primary">
                {formatTime(start)}
              </span>
            </span>
            <input
              type="range"
              min="0"
              max={maximum}
              step="0.1"
              value={start}
              onChange={(event) =>
                handleStartChange(Number(event.target.value))
              }
              data-testid="clip-range-start"
              className="mt-2 w-full accent-cyan-400"
            />
          </label>

          <label className="block text-xs text-zinc-300">
            <span className="flex justify-between">
              <span>End</span>
              <span className="font-mono text-primary">{formatTime(end)}</span>
            </span>
            <input
              type="range"
              min="0"
              max={maximum}
              step="0.1"
              value={end}
              onChange={(event) => handleEndChange(Number(event.target.value))}
              data-testid="clip-range-end"
              className="mt-2 w-full accent-cyan-400"
            />
          </label>
        </div>

        <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-zinc-300">
          Start {formatTime(start)} · End {formatTime(end)} · Duration{" "}
          {formatTime(duration)} · Master {formatTime(maximum)}
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            aria-label="Save clip range"
          >
            {isSaving ? "Saving…" : "Save clip range"}
          </button>
        </div>
      </div>
    </div>
  );
}
