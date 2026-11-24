import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { moveCue, resizeCue } from "../../editor/timelineModel";
import AudioWaveform from "./AudioWaveform";
import SoundEventTrack from "./SoundEventTrack";
import { formatClock } from "./localEditorExport";
import { Button } from "../ui";

const TRACK_LABEL_WIDTH = 144;
const BASE_PIXELS_PER_SECOND = 80;
const MIN_LANE_WIDTH = 760;
const MIN_TIMELINE_ZOOM = 0.0001;
const MAX_TIMELINE_ZOOM = 4;
const CUE_SNAP_THRESHOLD_PX = 10;
const CUE_TRACK_MIN_HEIGHT = 48;
const CUE_BLOCK_HEIGHT = 40;
const CUE_LANE_PITCH = 44;
const CUE_TRACK_INSET = 4;
const TRACK_LABEL_CLASSES =
  "flex w-36 shrink-0 items-center gap-2 border-r border-border bg-muted/40 px-3 text-[11px] font-medium tracking-wide text-muted-foreground";

const getCueBackground = (color) =>
  `color-mix(in srgb, ${color} 60%, hsl(var(--background)))`;

const clampPercent = (value) => Math.max(0, Math.min(100, value));

const getCueLaneLayout = (cues) => {
  const laneEndTimes = [];
  const laneByCueId = new Map();
  const orderedCues = cues
    .map((cue, index) => ({
      cue,
      index,
      startMs: Number(cue?.startMs) || 0,
      endMs: Number(cue?.endMs) || 0,
    }))
    .sort(
      (left, right) =>
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        left.index - right.index,
    );

  for (const { cue, startMs, endMs } of orderedCues) {
    let laneIndex = laneEndTimes.findIndex((laneEndMs) => laneEndMs <= startMs);
    if (laneIndex === -1) laneIndex = laneEndTimes.length;
    laneEndTimes[laneIndex] = endMs;
    laneByCueId.set(cue.id, laneIndex);
  }

  return {
    laneByCueId,
    laneCount: Math.max(1, laneEndTimes.length),
  };
};

const findNearestCueEdge = (
  timeMs,
  cues,
  excludedCueIds,
  thresholdMs,
  targetEdgeKey,
  playheadMs,
) => {
  const playheadPosition = Number(playheadMs);
  if (Number.isFinite(playheadPosition)) {
    const snappedPlayheadPosition = Math.round(playheadPosition);
    if (Math.abs(snappedPlayheadPosition - timeMs) <= thresholdMs)
      return snappedPlayheadPosition;
  }

  let nearestEdge = null;
  let nearestDistance = thresholdMs + 1;

  for (const item of cues) {
    if (excludedCueIds.has(item.id)) continue;
    const edge = item[targetEdgeKey];
    const distance = Math.abs(edge - timeMs);
    if (distance <= thresholdMs && distance < nearestDistance) {
      nearestEdge = edge;
      nearestDistance = distance;
    }
  }
  return nearestEdge;
};

const snapCueRangeDelta = (
  startMs,
  endMs,
  deltaMs,
  cues,
  excludedCueIds,
  thresholdMs,
  minDeltaMs,
  maxDeltaMs,
) => {
  let snappedDelta = deltaMs;
  let nearestDistance = thresholdMs + 1;
  for (const item of cues) {
    if (excludedCueIds.has(item.id)) continue;
    for (const [movingEdge, targetEdge] of [
      [startMs, item.endMs],
      [endMs, item.startMs],
    ]) {
      const candidateDelta = targetEdge - movingEdge;
      const distance = Math.abs(candidateDelta - deltaMs);
      if (
        distance <= thresholdMs &&
        distance < nearestDistance &&
        candidateDelta >= minDeltaMs &&
        candidateDelta <= maxDeltaMs
      ) {
        snappedDelta = candidateDelta;
        nearestDistance = distance;
      }
    }
  }
  return snappedDelta;
};

function CueBlock({
  cue,
  laneIndex = 0,
  allCues = [],
  snapEnabled = false,
  durationMs,
  playheadMs,
  color,
  current,
  selected,
  selectedCueGroup = [],
  onSelect,
  onDoubleClick,
  onChange,
  onGroupChange,
  onChangeStart,
  onChangeEnd,
}) {
  const blockRef = useRef(null);
  const suppressClickRef = useRef(false);

  const beginDrag = (event, mode) => {
    event.preventDefault();
    event.stopPropagation();
    onChangeStart?.();
    const originX = event.clientX;
    const group =
      mode === "move" && selected && selectedCueGroup.length > 1
        ? selectedCueGroup.map((item) => ({ ...item }))
        : [{ ...cue }];
    const preserveSelectionOnDrag = selected && selectedCueGroup.length > 1;
    const groupStart = Math.min(...group.map((item) => item.startMs));
    const groupEnd = Math.max(...group.map((item) => item.endMs));
    const groupIds = new Set(group.map((item) => item.id));
    const width =
      blockRef.current?.parentElement?.getBoundingClientRect().width || 1;
    const snapThresholdMs = (CUE_SNAP_THRESHOLD_PX / width) * durationMs;
    let moved = false;
    const update = (moveEvent) => {
      const delta = ((moveEvent.clientX - originX) / width) * durationMs;
      if (Math.abs(moveEvent.clientX - originX) > 1) moved = true;
      if (mode !== "move") {
        const resizedCue = resizeCue(group[0], mode, delta, durationMs);
        if (!snapEnabled) {
          onChange(resizedCue);
          return;
        }
        const edgeMs = mode === "start" ? resizedCue.startMs : resizedCue.endMs;
        const snapEdge = findNearestCueEdge(
          edgeMs,
          allCues,
          groupIds,
          snapThresholdMs,
          mode === "start" ? "endMs" : "startMs",
          playheadMs,
        );
        if (snapEdge === null) {
          onChange(resizedCue);
          return;
        }
        const snapDelta = delta + snapEdge - edgeMs;
        const snappedCue = resizeCue(group[0], mode, snapDelta, durationMs);
        const snappedEdge =
          mode === "start" ? snappedCue.startMs : snappedCue.endMs;
        onChange(snappedEdge === snapEdge ? snappedCue : resizedCue);
        return;
      }

      const minDelta = -groupStart;
      const maxDelta = durationMs - groupEnd;
      const boundedDelta = Math.max(minDelta, Math.min(maxDelta, delta));
      const nextDelta = snapEnabled
        ? snapCueRangeDelta(
            groupStart,
            groupEnd,
            boundedDelta,
            allCues,
            groupIds,
            snapThresholdMs,
            minDelta,
            maxDelta,
          )
        : boundedDelta;
      const updates = group.map((item) => moveCue(item, nextDelta, durationMs));
      if (updates.length > 1) onGroupChange?.(updates);
      else onChange(updates[0]);
    };
    const stop = () => {
      if (moved && preserveSelectionOnDrag) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      window.removeEventListener("pointermove", update);
      onChangeEnd?.();
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const left = clampPercent((cue.startMs / durationMs) * 100);
  const width = Math.max(
    0,
    Math.min(100 - left, ((cue.endMs - cue.startMs) / durationMs) * 100),
  );

  return (
    <div
      ref={blockRef}
      role="button"
      tabIndex={0}
      aria-label={cue.text || "Timeline cue"}
      aria-pressed={selected}
      data-cue-lane={laneIndex}
      data-current-cue={current ? "true" : "false"}
      data-cue-state={
        current && selected
          ? "selected-current"
          : current
            ? "current"
            : selected
              ? "selected"
              : "normal"
      }
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onSelect(cue, event);
      }}
      onDoubleClick={() => onDoubleClick?.(cue)}
      onPointerDown={(event) => beginDrag(event, "move")}
      onKeyDown={(event) => event.key === "Enter" && onSelect(cue, event)}
      className={`group/cue absolute rounded-md border px-2 py-1 text-left text-[11px] font-medium text-white shadow-sm transition-[filter,box-shadow,border-color] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? (current ? "border-primary border-dashed" : "border-white/70 border-dashed") : current ? "border-primary border-solid" : "border-white/20 border-solid hover:border-white/40"}`}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        top: `${CUE_TRACK_INSET + laneIndex * CUE_LANE_PITCH}px`,
        height: `${CUE_BLOCK_HEIGHT}px`,
        background: getCueBackground(color),
        zIndex: selected ? 10 : 1,
      }}
    >
      {!current && !selected && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-1.5 z-0 w-0 border-l border-dashed border-white/55 opacity-0 transition-opacity group-hover/cue:opacity-100"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-1.5 z-0 w-0 border-r border-dashed border-white/55 opacity-0 transition-opacity group-hover/cue:opacity-100"
          />
        </>
      )}
      <span className="pointer-events-none relative z-10 block truncate">
        {cue.text || "Untitled cue"}
      </span>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label="Resize cue start"
        className="absolute inset-y-0 left-0 z-20 h-full min-h-0 min-w-0 cursor-ew-resize rounded-none border-0 bg-transparent p-0 opacity-0 transition-colors group-hover/cue:opacity-100 hover:bg-transparent focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-white/70"
        onPointerDown={(event) => beginDrag(event, "start")}
        style={{ width: "min(12px, 25%)" }}
      />
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label="Resize cue end"
        className="absolute inset-y-0 right-0 z-20 h-full min-h-0 min-w-0 cursor-ew-resize rounded-none border-0 bg-transparent p-0 opacity-0 transition-colors group-hover/cue:opacity-100 hover:bg-transparent focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-white/70"
        onPointerDown={(event) => beginDrag(event, "end")}
        style={{ width: "min(12px, 25%)" }}
      />
    </div>
  );
}

const layoutLabel = (format) =>
  format === "streamer_stack" ? "Streamer" : "Standard";

const layoutColor = (format) =>
  format === "streamer_stack" ? "#0e7490" : "#2563eb";

function LayoutSegmentBlock({
  segment,
  durationMs,
  playheadMs,
  selected,
  onSelect,
}) {
  const left = clampPercent((segment.startMs / durationMs) * 100);
  const width = Math.max(
    0,
    Math.min(
      100 - left,
      ((segment.endMs - segment.startMs) / durationMs) * 100,
    ),
  );
  const current = playheadMs >= segment.startMs && playheadMs < segment.endMs;
  const label = layoutLabel(segment.format);
  return (
    <Button
      variant="ghost"
      type="button"
      role="button"
      data-testid="local-editor-layout-segment"
      data-layout-segment-id={segment.id}
      data-layout-format={segment.format}
      data-current-layout={current ? "true" : "false"}
      aria-label={`${label} layout segment`}
      aria-pressed={selected}
      title={`${label} layout · ${segment.startMs}–${segment.endMs} ms`}
      onClick={() => onSelect?.(segment)}
      className={`absolute inset-y-1 overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] font-medium text-white shadow-sm transition-[filter,box-shadow,border-color] hover:border-primary/80 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current ? "border-primary shadow-[inset_0_2px_0_hsl(var(--primary))]" : "border-white/20"} ${selected ? "ring-2 ring-primary" : ""}`}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        background: getCueBackground(layoutColor(segment.format)),
        zIndex: selected ? 10 : 1,
      }}
    >
      <span className="pointer-events-none block truncate">{label}</span>
    </Button>
  );
}

function Track({
  label,
  cues,
  durationMs,
  timelineWidth,
  gridStyle,
  color,
  playheadMs,
  selectedId,
  selectedCueIds = [],
  onSelect,
  onDoubleClick,
  onChange,
  onGroupChange,
  onChangeStart,
  onChangeEnd,
  snapEnabled,
  testId,
}) {
  const { laneByCueId, laneCount } = getCueLaneLayout(cues);
  const trackHeight = Math.max(
    CUE_TRACK_MIN_HEIGHT,
    CUE_TRACK_INSET * 2 +
      laneCount * CUE_BLOCK_HEIGHT +
      (laneCount - 1) * (CUE_LANE_PITCH - CUE_BLOCK_HEIGHT),
  );

  return (
    <div
      data-testid={testId}
      className="flex min-h-12 w-full items-stretch border-b border-border last:border-b-0"
      style={{ minHeight: `${trackHeight}px` }}
    >
      <div
        className={TRACK_LABEL_CLASSES}
        title={
          testId === "local-editor-subtitles-track"
            ? "Shift-click to select a cue range. Ctrl/Cmd-click to add or remove cues. Drag a selected cue to move the group."
            : undefined
        }
      >
        {testId === "local-editor-subtitles-track" ? (
          <div className="min-w-0">
            <div>{label}</div>
            {selectedCueIds.length > 1 && (
              <div className="mt-0.5 text-[9px] leading-tight text-muted-foreground">
                {selectedCueIds.length} selected · drag to move
              </div>
            )}
          </div>
        ) : (
          label
        )}
      </div>
      <div
        className="relative shrink-0 bg-background/60"
        style={{ width: `${timelineWidth}px`, ...gridStyle }}
      >
        {cues.map((cue) => (
          <CueBlock
            key={cue.id}
            cue={cue}
            laneIndex={laneByCueId.get(cue.id) || 0}
            allCues={cues}
            snapEnabled={snapEnabled}
            durationMs={durationMs}
            playheadMs={playheadMs}
            color={color}
            current={playheadMs >= cue.startMs && playheadMs < cue.endMs}
            selected={selectedId === cue.id || selectedCueIds.includes(cue.id)}
            selectedCueIds={selectedCueIds}
            selectedCueGroup={cues.filter((item) =>
              selectedCueIds.includes(item.id),
            )}
            onSelect={onSelect}
            onDoubleClick={onDoubleClick}
            onChange={onChange}
            onGroupChange={onGroupChange}
            onChangeStart={onChangeStart}
            onChangeEnd={onChangeEnd}
          />
        ))}
      </div>
    </div>
  );
}

const LocalEditorTimeline = forwardRef(function LocalEditorTimeline(
  {
    videoUrl = "",
    durationMs = 1,
    fps = 30,
    subtitleCues = [],
    soundEvents = [],
    selectedSoundEventId = null,
    showSoundEventsInPreview = true,
    onSoundEventSelect,
    onSoundEventsPreviewChange,
    hook = null,
    layoutSegments = [],
    selectedLayoutSegmentId = null,
    onLayoutSelect,
    onLayoutDeselect,
    selectedId,
    selectedCueIds = [],
    onSelect,
    onDoubleClick,
    onChange,
    onGroupChange,
    onChangeStart,
    onChangeEnd,
    playheadMs = 0,
    onSeek,
    timelineZoom = 1,
    onTimelineZoomChange,
    snapCues = true,
    markers = [],
    selectedMarkerId = null,
    onMarkerSelect,
    onMarkerMove,
  },
  apiRef,
) {
  const timelineRef = useRef(null);
  const seekRulerRef = useRef(null);
  const playheadDragRef = useRef(null);
  const suppressSeekClickRef = useRef(false);
  const markerDragRef = useRef(null);
  const suppressMarkerClickRef = useRef(null);
  const [draggedMarker, setDraggedMarker] = useState(null);
  const safeDuration = Math.max(1, durationMs);
  const timelineWidth = Math.max(
    MIN_LANE_WIDTH,
    Math.ceil((safeDuration / 1000) * BASE_PIXELS_PER_SECOND * timelineZoom),
  );
  const canvasWidth = TRACK_LABEL_WIDTH + timelineWidth;
  const durationSeconds = safeDuration / 1000;
  const tickCount = Math.min(
    12,
    Math.max(2, Math.ceil(durationSeconds / 5) + 1),
  );
  const hookCues = hook ? [hook] : [];
  const rulerMarks = Array.from(
    { length: tickCount },
    (_, index) => (index / (tickCount - 1)) * 100,
  );
  const gridStyle = {
    backgroundImage:
      "linear-gradient(to right, hsl(var(--border) / 0.45) 1px, transparent 1px)",
    backgroundSize: `${timelineWidth / (tickCount - 1)}px 100%`,
  };

  const zoomToFit = useCallback(() => {
    const visibleWidth = timelineRef.current?.clientWidth || 0;
    if (!visibleWidth) return;
    const availableTimelineWidth = Math.max(
      1,
      visibleWidth - TRACK_LABEL_WIDTH - 16,
    );
    const baseTimelineWidth = Math.max(
      MIN_LANE_WIDTH,
      Math.ceil(durationSeconds * BASE_PIXELS_PER_SECOND),
    );
    const nextZoom = Math.max(
      MIN_TIMELINE_ZOOM,
      Math.min(MAX_TIMELINE_ZOOM, availableTimelineWidth / baseTimelineWidth),
    );
    onTimelineZoomChange?.(Number(nextZoom.toPrecision(6)));
  }, [durationSeconds, onTimelineZoomChange]);

  useImperativeHandle(apiRef, () => ({ zoomToFit }), [zoomToFit]);

  useEffect(() => {
    const container = timelineRef.current;
    if (!container?.clientWidth) return;
    const playheadX =
      TRACK_LABEL_WIDTH +
      (Math.max(0, Math.min(safeDuration, playheadMs)) / safeDuration) *
        timelineWidth;
    const visibleStart = container.scrollLeft + TRACK_LABEL_WIDTH;
    const visibleEnd = container.scrollLeft + container.clientWidth - 24;
    if (playheadX < visibleStart || playheadX > visibleEnd) {
      container.scrollLeft = Math.max(
        0,
        playheadX - container.clientWidth * 0.5,
      );
    }
  }, [playheadMs, safeDuration, timelineWidth]);

  const seekAtClientX = (clientX, rect) => {
    const timeMs = Math.max(
      0,
      Math.min(
        safeDuration,
        ((clientX - rect.left) / rect.width) * safeDuration,
      ),
    );
    onSeek?.(timeMs);
  };

  const seek = (event) => {
    if (suppressSeekClickRef.current && event.detail > 0) {
      suppressSeekClickRef.current = false;
      return;
    }
    onLayoutDeselect?.();
    seekAtClientX(
      event.clientX,
      (seekRulerRef.current || event.currentTarget).getBoundingClientRect(),
    );
  };

  const beginPlayheadDrag = (event) => {
    if (event.button !== 0) return;
    const ruler = event.currentTarget;
    playheadDragRef.current = event.pointerId;
    suppressSeekClickRef.current = true;
    ruler.setPointerCapture?.(event.pointerId);
    onLayoutDeselect?.();
    seekAtClientX(
      event.clientX,
      (seekRulerRef.current || ruler).getBoundingClientRect(),
    );
  };

  const updatePlayheadDrag = (event) => {
    if (playheadDragRef.current !== event.pointerId) return;
    seekAtClientX(
      event.clientX,
      (seekRulerRef.current || event.currentTarget).getBoundingClientRect(),
    );
  };

  const endPlayheadDrag = (event) => {
    if (playheadDragRef.current !== event.pointerId) return;
    playheadDragRef.current = null;
    window.setTimeout(() => {
      suppressSeekClickRef.current = false;
    }, 0);
  };

  const markerTimeFromClientX = (clientX) => {
    const canvas = timelineRef.current?.querySelector(
      '[data-testid="local-editor-timeline-canvas"]',
    );
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        safeDuration,
        ((clientX - rect.left - TRACK_LABEL_WIDTH) / timelineWidth) *
          safeDuration,
      ),
    );
  };

  const beginMarkerDrag = (event, markerId, markerTimeMs) => {
    if (markerDragRef.current) return;
    event.stopPropagation();
    const drag = {
      markerId,
      originTimeMs: markerTimeMs,
      moved: false,
      eventPrefix: event.type.startsWith("pointer") ? "pointer" : "mouse",
    };
    markerDragRef.current = drag;
    setDraggedMarker({ id: markerId, timeMs: markerTimeMs });

    const update = (moveEvent) => {
      if (markerDragRef.current !== drag) return;
      const nextTimeMs = markerTimeFromClientX(moveEvent.clientX);
      if (Math.abs(nextTimeMs - drag.originTimeMs) > 1) {
        drag.moved = true;
        moveEvent.preventDefault();
      }
      setDraggedMarker({ id: markerId, timeMs: nextTimeMs });
    };
    const stop = (upEvent) => {
      if (markerDragRef.current !== drag) return;
      const nextTimeMs = markerTimeFromClientX(upEvent.clientX);
      if (Math.abs(nextTimeMs - drag.originTimeMs) > 1) drag.moved = true;
      if (drag.moved) {
        suppressMarkerClickRef.current = markerId;
        onMarkerMove?.(markerId, nextTimeMs);
        window.setTimeout(() => {
          if (suppressMarkerClickRef.current === markerId)
            suppressMarkerClickRef.current = null;
        }, 0);
      }
      markerDragRef.current = null;
      setDraggedMarker(null);
      window.removeEventListener(`${drag.eventPrefix}move`, update);
      window.removeEventListener(`${drag.eventPrefix}up`, stop);
      if (drag.eventPrefix === "pointer")
        window.removeEventListener("pointercancel", cancel);
    };
    const cancel = () => {
      if (markerDragRef.current !== drag) return;
      markerDragRef.current = null;
      setDraggedMarker(null);
      window.removeEventListener(`${drag.eventPrefix}move`, update);
      window.removeEventListener(`${drag.eventPrefix}up`, stop);
      if (drag.eventPrefix === "pointer")
        window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener(`${drag.eventPrefix}move`, update);
    window.addEventListener(`${drag.eventPrefix}up`, stop);
    if (drag.eventPrefix === "pointer")
      window.addEventListener("pointercancel", cancel);
  };

  return (
    <div
      data-testid="local-editor-timeline"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div
        ref={timelineRef}
        data-testid="local-editor-timeline-scroll"
        className="editor-scrollbar min-h-0 flex-1 max-w-full overflow-x-auto overflow-y-auto"
      >
        <div
          data-testid="local-editor-timeline-canvas"
          className="relative"
          style={{ width: `${canvasWidth}px` }}
        >
          <div className="flex h-9 border-b border-border bg-muted/20">
            <div className="flex w-36 shrink-0 items-center border-r border-border bg-muted/60 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Time
            </div>
            <div
              ref={seekRulerRef}
              className="relative h-full shrink-0 cursor-ew-resize select-none touch-none bg-muted/20"
              style={{ width: `${timelineWidth}px`, ...gridStyle }}
              onClick={seek}
              onPointerDown={beginPlayheadDrag}
              onPointerMove={updatePlayheadDrag}
              onPointerUp={endPlayheadDrag}
              onPointerCancel={endPlayheadDrag}
              title="Drag playhead to seek"
              role="slider"
              aria-label="Timeline seek"
              aria-valuemin={0}
              aria-valuemax={safeDuration}
              aria-valuenow={playheadMs}
              tabIndex={0}
            >
              {rulerMarks.map((mark) => (
                <span
                  key={mark}
                  className="absolute top-2 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
                  style={{ left: `${mark}%` }}
                >
                  {formatClock((safeDuration * mark) / 100, fps)}
                </span>
              ))}
              <div
                className="absolute bottom-0 top-0 w-px bg-primary"
                style={{ left: `${(playheadMs / safeDuration) * 100}%` }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 z-20 h-2.5 w-3 -translate-x-1/2 rounded-b-sm bg-primary"
                style={{ left: `${(playheadMs / safeDuration) * 100}%` }}
              />
            </div>
          </div>
          <Track
            testId="local-editor-hook-track"
            label="Viral Hook"
            cues={hookCues}
            durationMs={safeDuration}
            timelineWidth={timelineWidth}
            gridStyle={gridStyle}
            color="#f59e0b"
            playheadMs={playheadMs}
            selectedId={selectedId}
            snapEnabled={false}
            onSelect={(cue) => onSelect?.(cue, "hook")}
            onDoubleClick={(cue) => onDoubleClick?.(cue, "hook")}
            onChange={(cue) => onChange?.(cue, "hook")}
            onChangeStart={onChangeStart}
            onChangeEnd={onChangeEnd}
          />
          <Track
            testId="local-editor-subtitles-track"
            label="Subtitles"
            cues={subtitleCues}
            durationMs={safeDuration}
            timelineWidth={timelineWidth}
            gridStyle={gridStyle}
            color="#8b5cf6"
            playheadMs={playheadMs}
            selectedId={selectedId}
            selectedCueIds={selectedCueIds}
            snapEnabled={snapCues}
            onSelect={(cue, event) => onSelect?.(cue, "subtitle", event)}
            onDoubleClick={(cue) => onDoubleClick?.(cue, "subtitle")}
            onChange={(cue) => onChange?.(cue, "subtitle")}
            onGroupChange={(cues) => onGroupChange?.(cues, "subtitle")}
            onChangeStart={onChangeStart}
            onChangeEnd={onChangeEnd}
          />
          <SoundEventTrack
            events={soundEvents}
            durationMs={safeDuration}
            timelineWidth={timelineWidth}
            gridStyle={gridStyle}
            playheadMs={playheadMs}
            selectedId={selectedSoundEventId}
            showInPreview={showSoundEventsInPreview}
            onSelect={onSoundEventSelect}
            onTogglePreview={onSoundEventsPreviewChange}
          />
          <div
            data-testid="local-editor-audio-track"
            className="flex min-h-12 w-full items-stretch border-b border-border last:border-b-0"
          >
            <div className={TRACK_LABEL_CLASSES}>Audio</div>
            <div
              className="relative shrink-0 bg-background/60"
              style={{ width: `${timelineWidth}px`, ...gridStyle }}
            >
              <AudioWaveform
                videoUrl={videoUrl}
                durationMs={safeDuration}
                sampleCount={Math.max(
                  512,
                  Math.min(4_096, Math.ceil((safeDuration / 1000) * 12)),
                )}
              />
            </div>
          </div>
          <div
            data-testid="local-editor-layout-track"
            className="flex min-h-12 w-full items-stretch border-b border-border last:border-b-0"
          >
            <div
              data-testid="local-editor-layout-track-label"
              className={TRACK_LABEL_CLASSES}
              onClick={() => onLayoutDeselect?.()}
            >
              Layout
            </div>
            <div
              className="relative shrink-0 bg-background/60"
              style={{ width: `${timelineWidth}px`, ...gridStyle }}
              onClick={(event) => {
                if (event.target === event.currentTarget) onLayoutDeselect?.();
              }}
            >
              {layoutSegments.map((segment) => (
                <LayoutSegmentBlock
                  key={segment.id}
                  segment={segment}
                  durationMs={safeDuration}
                  playheadMs={playheadMs}
                  selected={selectedLayoutSegmentId === segment.id}
                  onSelect={onLayoutSelect}
                />
              ))}
            </div>
          </div>
          <div
            className="pointer-events-none absolute bottom-0 top-0 ml-36"
            style={{ width: `${timelineWidth}px` }}
          >
            {markers.map((marker, index) => {
              const markerId = marker.id || `marker-${index}`;
              const markerTimeMs = Math.max(
                0,
                Math.min(safeDuration, Number(marker.timeMs) || 0),
              );
              const displayTimeMs =
                draggedMarker?.id === markerId
                  ? draggedMarker.timeMs
                  : markerTimeMs;
              return (
                <div
                  key={markerId}
                  className="absolute bottom-0 top-0 z-20 w-px bg-amber-300/90"
                  style={{ left: `${(displayTimeMs / safeDuration) * 100}%` }}
                >
                  <Button
                    variant="ghost"
                    type="button"
                    data-testid="local-editor-marker"
                    aria-label={marker.label || "Timeline marker"}
                    aria-pressed={selectedMarkerId === markerId}
                    aria-grabbed={draggedMarker?.id === markerId}
                    title={
                      selectedMarkerId === markerId
                        ? "Selected marker. Drag to move or press Delete to remove"
                        : "Select or drag marker"
                    }
                    onMouseDown={(event) =>
                      beginMarkerDrag(event, markerId, markerTimeMs)
                    }
                    onPointerDown={(event) =>
                      beginMarkerDrag(event, markerId, markerTimeMs)
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressMarkerClickRef.current === markerId) {
                        suppressMarkerClickRef.current = null;
                        return;
                      }
                      onMarkerSelect?.(markerId, markerTimeMs);
                    }}
                    className={`pointer-events-auto absolute -left-1.5 -top-0.5 h-3 w-3 rotate-45 cursor-grab bg-amber-300 ${selectedMarkerId === markerId ? "ring-2 ring-white" : ""} ${draggedMarker?.id === markerId ? "cursor-grabbing" : ""}`}
                  />
                </div>
              );
            })}
            <div
              className="absolute bottom-0 top-0 z-10 w-px bg-primary/80"
              style={{ left: `${(playheadMs / safeDuration) * 100}%` }}
            />
            <div
              aria-hidden="true"
              data-testid="local-editor-playhead-drag-handle"
              title="Drag playhead to seek"
              onPointerDown={beginPlayheadDrag}
              onPointerMove={updatePlayheadDrag}
              onPointerUp={endPlayheadDrag}
              onPointerCancel={endPlayheadDrag}
              className="pointer-events-auto absolute bottom-0 top-0 z-0 w-3 -translate-x-1/2 cursor-ew-resize touch-none bg-transparent"
              style={{ left: `${(playheadMs / safeDuration) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

export default LocalEditorTimeline;
