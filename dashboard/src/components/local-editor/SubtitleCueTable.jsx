import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Trash2 } from "lucide-react";
import { formatClock } from "./localEditorExport";
import { Badge, Button, Input } from "../ui";

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
    <Input
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
      className="h-8 w-full px-2 py-1 font-mono text-xs"
    />
  );
}

function CueTextInput({ cue, onCommit }) {
  const [draft, setDraft] = useState(cue.text || "");
  useEffect(() => setDraft(cue.text || ""), [cue.text]);
  return (
    <Input
      aria-label={`Subtitle cue text ${cue.id}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 border-0 bg-transparent px-2 py-3 text-left text-sm shadow-none focus-visible:ring-0"
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
    <div
      data-testid="local-editor-cue-table"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="editor-scrollbar max-h-[420px] overflow-auto">
        <table className="w-full min-w-[620px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
            <tr>
              <th
                scope="col"
                className="w-32 border-r border-border px-3 py-2 text-center font-medium"
              >
                Start
              </th>
              <th
                scope="col"
                className="w-32 border-r border-border px-3 py-2 text-center font-medium"
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
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  Import subtitles or add a cue to edit it here.
                </td>
              </tr>
            )}
            {sortedCues.map((cue, index) => {
              const current = cue.id === currentCue?.id;
              const selected = cue.id === selectedId;
              const cueState =
                current && selected
                  ? "selected-current"
                  : current
                    ? "current"
                    : selected
                      ? "selected"
                      : "normal";
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
                  data-cue-state={cueState}
                  tabIndex={0}
                  onClick={() => scrollToCue(cue)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && scrollToCue(cue)
                  }
                  className={`border-b border-border text-foreground outline-none transition-colors hover:bg-muted ${current ? "bg-accent shadow-[inset_2px_0_0_hsl(var(--primary))]" : selected ? "bg-secondary" : index % 2 ? "bg-muted/40" : "bg-background"}`}
                >
                  <td className="border-r border-border p-0">
                    <CueTimeInput
                      cue={cue}
                      field="start"
                      value={cue.startMs}
                      fps={fps}
                      onCommit={(value) => updateCue(cue, "startMs", value)}
                    />
                  </td>
                  <td className="border-r border-border p-0">
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
                        <Badge
                          variant="secondary"
                          className="mr-2 shrink-0 text-[10px] font-medium"
                        >
                          CURRENT
                        </Badge>
                      )}
                      {onDelete && (
                        <Button
                          variant="destructive"
                          size="icon"
                          type="button"
                          aria-label={`Delete subtitle cue ${cue.id}`}
                          title="Delete subtitle cue"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDelete(cue.id);
                          }}
                          className="mr-2 size-8 shrink-0"
                        >
                          <Trash2 size={14} />
                        </Button>
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
