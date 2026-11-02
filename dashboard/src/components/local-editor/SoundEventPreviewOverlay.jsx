import React from "react";
import { Volume2 } from "lucide-react";

export default function SoundEventPreviewOverlay({ event = null }) {
  if (!event?.label) return null;

  return (
    <div
      data-testid="sound-event-preview-overlay"
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-3 z-30 flex max-w-[88%] -translate-x-1/2 items-center gap-2 rounded-full border border-teal-200/30 bg-black/75 px-3 py-1.5 text-center text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
    >
      <Volume2
        size={13}
        className="shrink-0 text-teal-200"
        aria-hidden="true"
      />
      <span className="truncate">{event.label}</span>
    </div>
  );
}
