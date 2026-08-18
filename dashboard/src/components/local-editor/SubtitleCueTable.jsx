import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const formatTimecode = (value) => {
  const milliseconds = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
};

const parseTimecode = (value, fallback) => {
  const text = String(value || "")
    .trim()
    .replace(",", ".");
  if (!text) return fallback;
  if (/^\d+(?:\.\d+)?$/.test(text))
    return Math.max(0, Math.round(Number(text) * 1000));
  const parts = text.split(":");
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

function CueTimeInput({ cue, field, value, onCommit }) {
  const [draft, setDraft] = useState(formatTimecode(value));
  useEffect(() => setDraft(formatTimecode(value)), [value]);
  return (
    <input
      aria-label={`Subtitle cue ${field} ${cue.id}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setDraft(formatTimecode(value))}
      onBlur={() => {
        const nextValue = parseTimecode(draft, value);
        setDraft(formatTimecode(nextValue));
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
  selectedId,
  playheadMs = 0,
  onSelect,
  onChange,
  loopSegment = false,
  onLoopSegmentChange,
  onSpeedChange,
}) {
  const [followAudio, setFollowAudio] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [fontScale, setFontScale] = useState(1);
  const rowRefs = useRef(new Map());
  const sortedCues = useMemo(
    () => [...cues].sort((left, right) => left.startMs - right.startMs),
    [cues],
  );

  const scrollToCue = useCallback(
    (cue, select = true) => {
      if (!cue) return;
      if (select) onSelect?.(cue, "subtitle");
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

  const updateCue = (cue, field, value) =>
    onChange?.({ ...cue, [field]: value });

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#171719]">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#222225] px-3 py-2 text-xs text-zinc-300">
        <span className="font-semibold text-white">Playback Controls:</span>
        <label className="flex items-center gap-1">
          <input
            aria-label="Loop segment"
            type="checkbox"
            checked={loopSegment}
            onChange={(event) => onLoopSegmentChange?.(event.target.checked)}
            className="accent-violet-400"
          />
          Loop Segment
        </label>
        <label className="flex items-center gap-1">
          <input
            aria-label="Follow audio"
            type="checkbox"
            checked={followAudio}
            onChange={(event) => setFollowAudio(event.target.checked)}
            className="accent-violet-400"
          />
          Follow Audio
        </label>
        <span className="h-5 w-px bg-white/15" />
        <label className="flex items-center gap-1">
          Speed:
          <select
            aria-label="Subtitle table speed"
            value={speed}
            onChange={(event) => {
              const nextSpeed = Number(event.target.value);
              setSpeed(nextSpeed);
              onSpeedChange?.(nextSpeed);
            }}
            className="rounded border border-white/15 bg-[#303034] px-1.5 py-1 text-xs text-white"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((option) => (
              <option key={option} value={option}>
                {option.toFixed(2)}x
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Decrease subtitle table size"
          onClick={() =>
            setFontScale((current) => Math.max(0.85, current - 0.1))
          }
          className="rounded border border-white/15 bg-[#303034] px-3 py-1 text-white hover:bg-white/10"
        >
          −
        </button>
        <button
          type="button"
          aria-label="Increase subtitle table size"
          onClick={() =>
            setFontScale((current) => Math.min(1.3, current + 0.1))
          }
          className="rounded border border-white/15 bg-[#303034] px-3 py-1 text-white hover:bg-white/10"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Scroll to current subtitle"
          onClick={() => scrollToCue(currentCue || sortedCues[0])}
          className="ml-auto rounded border border-white/15 bg-[#303034] px-3 py-1 text-white hover:bg-white/10"
        >
          ◉ Scroll to Current
        </button>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table
          className="w-full min-w-[620px] border-collapse text-left"
          style={{ fontSize: `${fontScale}rem` }}
        >
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
                      onCommit={(value) => updateCue(cue, "startMs", value)}
                    />
                  </td>
                  <td className="border-r border-white/10 p-0">
                    <CueTimeInput
                      cue={cue}
                      field="end"
                      value={cue.endMs}
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
