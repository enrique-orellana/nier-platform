import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Trash2 } from "lucide-react";
import { formatClock } from "./localEditorExport";

const formatTimecode = (value, fps) => formatClock(value, fps);

const parseTimecode = (value, fallback, fps) => {
  const text = String(value || "")
    .trim()
    .replace(",", ".");
  if (!text) return fallback;
  if (/^\d+(?:\.\d+)?$/.test(text))
    return Math.max(0, Math.round(Number(text) * 1000));
  const parts = text.split(":");
  if (parts.length === 4) {
    const frames = Number(parts.pop());
    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = Number(parts.pop());
    if ([hours, minutes, seconds, frames].every(Number.isFinite))
      return Math.max(
        0,
        Math.round(
          (hours * 3600 + minutes * 60 + seconds) * 1000 +
            (frames / Math.max(1, Number(fps) || 30)) * 1000,
        ),
      );
  }
  if (parts.length === 2 || parts.length === 3) {
    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;
    if ([hours, minutes, seconds].every(Number.isFinite))
      return Math.max(
        0,
        Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000),
      );
  }
  return fallback;
};

function CueTimeInput({ cue, field, value, fps, onCommit }) {
  const [draft, setDraft] = useState(formatTimecode(value, fps));
  useEffect(() => setDraft(formatTimecode(value, fps)), [fps, value]);
  return (
    <input
      aria-label={`Subtitle cue ${field} ${cue.id}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setDraft(formatTimecode(value, fps))}
      onBlur={() => {
        const nextValue = parseTimecode(draft, value, fps);
        setDraft(formatTimecode(nextValue, fps));
        onCommit(nextValue);
      }}
      onClick={(event) => event.stopPropagation()}
      className="w-full rounded border border-transparent bg-transparent px-2 py-1 font-mono text-xs text-zinc-200 outline-none hover:border-white/10 focus:border-violet-400 focus:bg-black/20"
    />
  );
}

function CueTextInput({ cue, onCommit }) {
  const [draft, setDraft] = useState(cue.text || "");
  useEffect(() => setDraft(cue.text || ""), [cue.text]);
  return (
    <input
      aria-label={`Subtitle cue text ${cue.id}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 bg-transparent px-2 py-4 text-left text-sm text-white outline-none placeholder:text-zinc-600 focus:bg-black/20"
    />
  );
}

export default function SubtitleCueTable({
  cues = [],
  fps = 30,
  selectedId,
  playheadMs = 0,
  onSelect,
  onChange,
  onDelete,
  followAudio = true,
  scrollToCurrentRef,
}) {
  const rowRefs = useRef(new Map());
  const sortedCues = useMemo(
    () => [...cues].sort((left, right) => left.startMs - right.startMs),
    [cues],
  );

  const scrollToCue = useCallback(
    (cue, select = true) => {
      if (!cue) return;
      if (select)
        onSelect?.(cue, "subtitle", {
          openEditor: false,
        });
      rowRefs.current.get(cue.id)?.scrollIntoView?.({ block: "nearest" });
    },
    [onSelect],
  );

  const currentCue =
    sortedCues.find(
      (cue) => playheadMs >= cue.startMs && playheadMs < cue.endMs,
    ) || null;

  useEffect(() => {
    if (followAudio) scrollToCue(currentCue, false);
  }, [currentCue, followAudio, scrollToCue]);

  const scrollToCurrent = useCallback(
    () => scrollToCue(currentCue || sortedCues[0], false),
    [currentCue, scrollToCue, sortedCues],
  );

  useEffect(() => {
    if (!scrollToCurrentRef) return undefined;
    scrollToCurrentRef.current = scrollToCurrent;
    return () => {
      if (scrollToCurrentRef.current === scrollToCurrent)
        scrollToCurrentRef.current = null;
    };
  }, [scrollToCurrent, scrollToCurrentRef]);

  const updateCue = (cue, field, value) =>
    onChange?.({ ...cue, [field]: value });

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#171719]">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[620px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#39393d] text-[11px] text-zinc-300">
            <tr>
              <th
                scope="col"
                className="w-32 border-r border-white/10 px-2 py-2 text-center font-medium"
              >
                Start
              </th>
              <th
                scope="col"
                className="w-32 border-r border-white/10 px-2 py-2 text-center font-medium"
              >
                End
              </th>
              <th scope="col" className="px-2 py-2 text-center font-medium">
                Text
              </th>
            </tr>
          </thead>
          <tbody>
            {!sortedCues.length && (
              <tr>
                <td
                  colSpan="3"
                  className="px-4 py-10 text-center text-sm text-zinc-500"
                >
                  Import subtitles or add a cue to edit it here.
                </td>
              </tr>
            )}
            {sortedCues.map((cue, index) => {
              const current = cue.id === currentCue?.id;
              const selected = cue.id === selectedId;
              return (
                <tr
                  key={cue.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(cue.id, node);
                    else rowRefs.current.delete(cue.id);
                  }}
                  aria-selected={selected}
                  aria-current={current ? "time" : undefined}
                  data-current-cue={current ? "true" : "false"}
                  tabIndex={0}
                  onClick={() => scrollToCue(cue)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && scrollToCue(cue)
                  }
                  className={`border-b border-white/10 text-white outline-none transition-colors ${current ? "bg-violet-500/20 outline outline-1 outline-violet-300/60 outline-offset-[-1px] shadow-[inset_3px_0_0_rgba(196,181,253,0.85)]" : selected ? "bg-violet-900/70" : index % 2 ? "bg-[#42105d] hover:bg-violet-900/60" : "bg-[#2b2b2d] hover:bg-[#38383b]"}`}
                >
                  <td className="border-r border-white/10 p-0">
                    <CueTimeInput
                      cue={cue}
                      field="start"
                      value={cue.startMs}
                      fps={fps}
                      onCommit={(value) => updateCue(cue, "startMs", value)}
                    />
                  </td>
                  <td className="border-r border-white/10 p-0">
                    <CueTimeInput
                      cue={cue}
                      field="end"
                      value={cue.endMs}
                      fps={fps}
                      onCommit={(value) => updateCue(cue, "endMs", value)}
                    />
                  </td>
                  <td className="p-0">
                    <div className="flex min-w-0 items-center">
                      <CueTextInput
                        cue={cue}
                        onCommit={(value) => updateCue(cue, "text", value)}
                      />
                      {current && (
                        <span className="mr-2 shrink-0 rounded border border-violet-200/50 bg-violet-200/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-100">
                          CURRENT
                        </span>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          aria-label={`Delete subtitle cue ${cue.id}`}
                          title="Delete subtitle cue"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDelete(cue.id);
                          }}
                          className="mr-2 shrink-0 rounded p-1 text-zinc-400 hover:bg-red-500/15 hover:text-red-200"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
