import React from "react";
import { Volume2 } from "lucide-react";

const clampPercent = (value) => Math.max(0, Math.min(100, value));

function eventTitle(event) {
  return `${event.label} · ${Math.round(event.confidence * 100)}% confidence`;
}

export default function SoundEventTrack({
  events = [],
  durationMs = 1,
  timelineWidth = 760,
  playheadMs = 0,
  selectedId = null,
  showInPreview = true,
  onSelect,
  onTogglePreview,
}) {
  const safeDurationMs = Math.max(1, Number(durationMs) || 1);

  return (
    <div
      data-testid="local-editor-sound-events-track"
      className="flex min-h-12 w-full items-stretch border-b border-white/10 last:border-b-0"
    >
      <div className="flex w-36 shrink-0 items-center justify-between gap-1 bg-white/[.03] px-2 text-[11px] font-medium text-zinc-300">
        <span className="flex min-w-0 items-center gap-1 truncate">
          <Volume2 size={12} className="shrink-0 text-teal-300" />
          Sounds
        </span>
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1 text-[9px] text-zinc-400"
          title="Show detected sound labels over the preview only"
        >
          <input
            type="checkbox"
            aria-label="Show sound labels in preview"
            checked={showInPreview}
            onChange={(event) => onTogglePreview?.(event.target.checked)}
            className="h-3 w-3 rounded border-zinc-600 bg-zinc-900 text-teal-400 focus:ring-teal-300/30"
          />
          Preview
        </label>
      </div>
      <div
        className="relative shrink-0 bg-black/20"
        style={{ width: `${timelineWidth}px` }}
      >
        {events.length === 0 ? (
          <span className="absolute inset-y-0 left-3 flex items-center text-[10px] text-zinc-600">
            No sound events detected
          </span>
        ) : (
          events.map((event) => {
            const left = clampPercent((event.startMs / safeDurationMs) * 100);
            const width = Math.max(
              1.5,
              Math.min(
                100 - left,
                ((event.endMs - event.startMs) / safeDurationMs) * 100,
              ),
            );
            const active =
              playheadMs >= event.startMs && playheadMs < event.endMs;
            const selected = selectedId === event.id;

            return (
              <button
                key={event.id}
                type="button"
                data-testid="local-editor-sound-event"
                data-current-sound-event={active ? "true" : "false"}
                aria-label={eventTitle(event)}
                aria-pressed={selected}
                title={eventTitle(event)}
                onClick={() => onSelect?.(event)}
                className={`absolute inset-y-1 overflow-hidden rounded-md border px-1.5 text-left text-[10px] text-white shadow-sm transition-colors hover:border-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200 ${active ? "border-teal-200" : "border-teal-100/30"} ${selected ? "ring-2 ring-white" : ""}`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: "#0f766e",
                }}
              >
                <span className="block truncate">{event.label}</span>
              </button>
            );
          })
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-cyan-300"
          style={{
            left: `${clampPercent((playheadMs / safeDurationMs) * 100)}%`,
          }}
        />
      </div>
    </div>
  );
}
