import React, { useEffect, useRef, useState } from "react";
import { moveCue, resizeCue } from "../../editor/timelineModel";
import AudioWaveform from "./AudioWaveform";
import { formatClock } from "./localEditorExport";

const TRACK_LABEL_WIDTH = 144;
const BASE_PIXELS_PER_SECOND = 80;
const MIN_LANE_WIDTH = 760;

const clampPercent = (value) => Math.max(0, Math.min(100, value));

function CueBlock({
  cue,
  durationMs,
  color,
  current,
  selected,
  onSelect,
  onDoubleClick,
  onChange,
  onChangeStart,
  onChangeEnd,
}) {
  const blockRef = useRef(null);

  const beginDrag = (event, mode) => {
    event.preventDefault();
    event.stopPropagation();
    onChangeStart?.();
    const originX = event.clientX;
    const original = { ...cue };
    const width =
      blockRef.current?.parentElement?.getBoundingClientRect().width || 1;
    const update = (moveEvent) => {
      const delta = ((moveEvent.clientX - originX) / width) * durationMs;
      onChange(
        mode === "move"
          ? moveCue(original, delta, durationMs)
          : resizeCue(original, mode, delta, durationMs),
      );
    };
    const stop = () => {
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
      title={cue.text || "Untitled cue"}
      onClick={() => onSelect(cue)}
      onDoubleClick={() => onDoubleClick?.(cue)}
      onPointerDown={(event) => beginDrag(event, "move")}
      onKeyDown={(event) => event.key === "Enter" && onSelect(cue)}
      className={`absolute inset-y-1 rounded-md border px-2 py-1 text-left text-[10px] text-white opacity-95 shadow-sm transition-[filter,box-shadow,border-color] hover:border-white/80 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${current ? "border-cyan-300 shadow-[inset_0_2px_0_rgba(103,232,249,0.95)]" : "border-white/25"} ${selected ? "ring-2 ring-white" : ""} ${current && selected ? "ring-cyan-300" : ""}`}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        background: color,
        zIndex: selected ? 10 : 1,
      }}
    >
      {current && (
        <span
          data-testid="cue-current-indicator"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-cyan-200"
        />
      )}
      <span className="pointer-events-none block truncate">
        {cue.text || "Untitled cue"}
      </span>
      <button
        type="button"
        aria-label="Resize cue start"
        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize opacity-0 hover:opacity-100 focus-visible:opacity-100"
        onPointerDown={(event) => beginDrag(event, "start")}
      />
      <button
        type="button"
        aria-label="Resize cue end"
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize opacity-0 hover:opacity-100 focus-visible:opacity-100"
        onPointerDown={(event) => beginDrag(event, "end")}
      />
    </div>
  );
}

function Track({
  label,
  cues,
  durationMs,
  timelineWidth,
  color,
  playheadMs,
  selectedId,
  onSelect,
  onDoubleClick,
  onChange,
  onChangeStart,
  onChangeEnd,
  testId,
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-h-12 w-full items-stretch border-b border-white/10 last:border-b-0"
    >
      <div className="flex w-36 shrink-0 items-center bg-white/[.03] px-3 text-[11px] font-medium text-zinc-300">
        {label}
      </div>
      <div
        className="relative shrink-0 bg-black/20"
        style={{ width: `${timelineWidth}px` }}
      >
        {cues.map((cue) => (
          <CueBlock
            key={cue.id}
            cue={cue}
            durationMs={durationMs}
            color={color}
            current={playheadMs >= cue.startMs && playheadMs < cue.endMs}
            selected={selectedId === cue.id}
            onSelect={onSelect}
            onDoubleClick={onDoubleClick}
            onChange={onChange}
            onChangeStart={onChangeStart}
            onChangeEnd={onChangeEnd}
          />
        ))}
      </div>
    </div>
  );
}

export default function LocalEditorTimeline({
  videoUrl = "",
  durationMs = 1,
  fps = 30,
  subtitleCues = [],
  hook = null,
  selectedId,
  onSelect,
  onDoubleClick,
  onChange,
  onChangeStart,
  onChangeEnd,
  playheadMs = 0,
  onSeek,
  timelineZoom = 1,
  markers = [],
  selectedMarkerId = null,
  onMarkerSelect,
  onMarkerMove,
}) {
  const timelineRef = useRef(null);
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

  const seek = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek?.(
      Math.max(
        0,
        Math.min(
          safeDuration,
          ((event.clientX - rect.left) / rect.width) * safeDuration,
        ),
      ),
    );
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
      className="flex h-full min-h-0 flex-col rounded-none border-0 bg-[#101014]"
    >
      <div
        ref={timelineRef}
        data-testid="local-editor-timeline-scroll"
        className="editor-scrollbar min-h-0 flex-1 max-w-full overflow-x-auto overflow-y-hidden"
      >
        <div
          data-testid="local-editor-timeline-canvas"
          className="relative"
          style={{ width: `${canvasWidth}px` }}
        >
          <div
            className="relative ml-36 h-9 cursor-pointer border-b border-white/10"
            style={{ width: `${timelineWidth}px` }}
            onClick={seek}
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
                className="absolute top-2 -translate-x-1/2 text-[9px] text-zinc-600"
                style={{ left: `${mark}%` }}
              >
                {formatClock((safeDuration * mark) / 100, fps)}
              </span>
            ))}
            <div
              className="absolute bottom-0 top-0 w-px bg-cyan-300"
              style={{ left: `${(playheadMs / safeDuration) * 100}%` }}
            />
          </div>
          <Track
            testId="local-editor-hook-track"
            label="Viral Hook"
            cues={hookCues}
            durationMs={safeDuration}
            timelineWidth={timelineWidth}
            color="#f59e0b"
            playheadMs={playheadMs}
            selectedId={selectedId}
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
            color="#8b5cf6"
            playheadMs={playheadMs}
            selectedId={selectedId}
            onSelect={(cue) => onSelect?.(cue, "subtitle")}
            onDoubleClick={(cue) => onDoubleClick?.(cue, "subtitle")}
            onChange={(cue) => onChange?.(cue, "subtitle")}
            onChangeStart={onChangeStart}
            onChangeEnd={onChangeEnd}
          />
          <div
            data-testid="local-editor-audio-track"
            className="flex min-h-12 w-full items-stretch border-b border-white/10 last:border-b-0"
          >
            <div className="flex w-36 shrink-0 items-center bg-white/[.03] px-3 text-[11px] font-medium text-zinc-300">
              Audio
            </div>
            <div
              className="relative shrink-0 bg-black/20"
              style={{ width: `${timelineWidth}px` }}
            >
              <AudioWaveform
                videoUrl={videoUrl}
                durationMs={safeDuration}
                sampleCount={Math.max(
                  96,
                  Math.min(240, Math.ceil(timelineWidth / 4)),
                )}
              />
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
                  <button
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
              className="absolute bottom-0 top-0 z-10 w-px bg-cyan-300/80"
              style={{ left: `${(playheadMs / safeDuration) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
