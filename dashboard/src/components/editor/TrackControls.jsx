import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../ui";

export default function TrackControls({
  track,
  onChange,
  isCollapsed,
  onToggleCollapse,
}) {
  return (
    <div className="sticky left-0 z-10 flex w-40 shrink-0 items-center gap-1 border-r border-white/10 bg-[#17171b] px-2 text-[10px] text-zinc-300">
      <Button
        variant="ghost"
        type="button"
        onClick={onToggleCollapse}
        className="text-zinc-500 hover:text-white shrink-0"
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </Button>
      <span className="font-mono text-cyan-300 flex-1 truncate">
        {track.name}
      </span>
      <Button
        variant="ghost"
        type="button"
        aria-label={`${track.name} mute`}
        onClick={() => onChange({ ...track, muted: !track.muted })}
        className={
          track.muted
            ? "text-red-300 shrink-0"
            : "text-zinc-500 hover:text-zinc-300 shrink-0"
        }
      >
        M
      </Button>
      <Button
        variant="ghost"
        type="button"
        aria-label={`${track.name} lock`}
        onClick={() => onChange({ ...track, locked: !track.locked })}
        className={
          track.locked
            ? "text-amber-300 shrink-0"
            : "text-zinc-500 hover:text-zinc-300 shrink-0"
        }
      >
        L
      </Button>
      <Button
        variant="ghost"
        type="button"
        aria-label={`${track.name} visibility`}
        onClick={() => onChange({ ...track, visible: track.visible === false })}
        className={
          track.visible === false
            ? "text-zinc-700 shrink-0"
            : "text-zinc-500 hover:text-zinc-300 shrink-0"
        }
      >
        ◉
      </Button>
    </div>
  );
}
