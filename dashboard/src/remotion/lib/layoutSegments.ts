import type {
  LayoutConfig,
  LayoutFormat,
  LayoutSegmentConfig,
  LayoutTransition,
  SourcePoint,
} from "./types";

export interface ResolvedLayoutSegment {
  id: string;
  startMs: number;
  endMs: number;
  format: LayoutFormat;
  transition: LayoutTransition;
  transitionDurationMs: number;
  layoutSlot: 0 | 1;
  gameplay_focus?: SourcePoint;
  gameplay_zoom?: number;
}

export interface ResolvedLayout {
  active: ResolvedLayoutSegment;
  previous: ResolvedLayoutSegment | null;
  transitionProgress: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const numberOr = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeGameplayFocus = (focus: unknown): SourcePoint | undefined => {
  const point = focus as Partial<SourcePoint> | null | undefined;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
};

const normalizeGameplayZoom = (zoom: unknown) => {
  if (zoom == null || zoom === "") return undefined;
  const value = Number(zoom);
  return Number.isFinite(value) ? clamp(value, 0.6, 2) : undefined;
};

const segmentFraming = (
  segment: LayoutSegmentConfig,
): Pick<ResolvedLayoutSegment, "gameplay_focus" | "gameplay_zoom"> => {
  const framing: Pick<
    ResolvedLayoutSegment,
    "gameplay_focus" | "gameplay_zoom"
  > = {};
  const focus = normalizeGameplayFocus(segment.gameplay_focus);
  const zoom = normalizeGameplayZoom(segment.gameplay_zoom);
  if (focus) framing.gameplay_focus = focus;
  if (zoom !== undefined) framing.gameplay_zoom = zoom;
  return framing;
};

const normalizeSegments = (
  layout: LayoutConfig | null | undefined,
  durationInFrames: number,
  fps: number,
): ResolvedLayoutSegment[] => {
  const durationMs = Math.max(
    1,
    Math.round(
      (Math.max(1, Number(durationInFrames) || 1) / Number(fps || 30)) * 1000,
    ),
  );
  const fallbackFormat: LayoutFormat =
    layout?.format === "streamer_stack" ? "streamer_stack" : "standard";
  const source = Array.isArray(layout?.segments) ? layout.segments : [];
  if (!source.length)
    return [
      {
        id: "layout-1",
        startMs: 0,
        endMs: durationMs,
        format: fallbackFormat,
        transition: "cut",
        transitionDurationMs: 250,
        layoutSlot: 0,
      },
    ];

  const candidates = source
    .map((segment, index) => ({
      segment,
      index,
      startMs: clamp(Math.round(numberOr(segment.startMs, 0)), 0, durationMs),
      endMs: clamp(Math.round(numberOr(segment.endMs, 0)), 0, durationMs),
    }))
    .filter(({ startMs, endMs }) => endMs > startMs)
    .sort(
      (left, right) => left.startMs - right.startMs || left.index - right.index,
    );
  if (!candidates.length)
    return normalizeSegments({ format: fallbackFormat }, durationInFrames, fps);

  const usedIds = new Set<string>();
  let cursor = 0;
  let layoutSlot: 0 | 1 = 0;
  const normalized: ResolvedLayoutSegment[] = [];
  candidates.forEach(({ segment, endMs }, index) => {
    if (cursor >= durationMs) return;
    const nextEnd = Math.min(durationMs, Math.max(cursor, endMs));
    if (nextEnd <= cursor) return;
    let id = segment.id || `layout-${index + 1}`;
    let suffix = 2;
    while (usedIds.has(id)) id = `${id}-${suffix++}`;
    usedIds.add(id);
    const format: LayoutFormat =
      segment.format === "streamer_stack" ? "streamer_stack" : "standard";
    const transition: LayoutTransition =
      segment.transition === "crossfade" ? "crossfade" : "cut";
    if (transition === "crossfade") layoutSlot = layoutSlot === 0 ? 1 : 0;
    const rawTransitionDuration = numberOr(segment.transitionDurationMs, 250);
    normalized.push({
      ...segmentFraming(segment),
      id,
      startMs: cursor,
      endMs: nextEnd,
      format,
      transition,
      transitionDurationMs:
        transition === "crossfade"
          ? Math.min(
              Math.max(
                0,
                Math.round(
                  rawTransitionDuration < 0 ? 250 : rawTransitionDuration,
                ),
              ),
              nextEnd - cursor,
            )
          : Math.max(
              0,
              Math.round(
                rawTransitionDuration < 0 ? 250 : rawTransitionDuration,
              ),
            ),
      layoutSlot,
    });
    cursor = nextEnd;
  });
  if (!normalized.length)
    return normalizeSegments({ format: fallbackFormat }, durationInFrames, fps);
  if (normalized[normalized.length - 1].endMs < durationMs) {
    normalized[normalized.length - 1] = {
      ...normalized[normalized.length - 1],
      endMs: durationMs,
    };
  }
  return normalized;
};

export const normalizeLayoutSegments = normalizeSegments;

export const resolveLayoutAtNormalizedSegments = (
  segments: ResolvedLayoutSegment[],
  frame: number,
  fps: number,
): ResolvedLayout => {
  const timeMs = Math.max(0, ((Number(frame) || 0) / Number(fps || 30)) * 1000);
  let activeIndex = segments.findIndex(
    (segment) => timeMs >= segment.startMs && timeMs < segment.endMs,
  );
  if (activeIndex < 0 && timeMs >= segments[segments.length - 1].endMs)
    activeIndex = segments.length - 1;
  if (activeIndex < 0) activeIndex = 0;
  const active = segments[activeIndex];
  const previous =
    active.transition === "crossfade" && activeIndex > 0
      ? segments[activeIndex - 1]
      : null;
  const transitionProgress = previous
    ? clamp(
        (timeMs - active.startMs) / Math.max(1, active.transitionDurationMs),
        0,
        1,
      )
    : 1;
  return { active, previous, transitionProgress };
};

export const resolveLayoutAtFrame = (
  layout: LayoutConfig | null | undefined,
  frame: number,
  durationInFrames: number,
  fps: number,
): ResolvedLayout =>
  resolveLayoutAtNormalizedSegments(
    normalizeSegments(layout, durationInFrames, fps),
    frame,
    fps,
  );

export const layoutSegmentInput = (
  segment: LayoutSegmentConfig,
): ResolvedLayoutSegment => ({
  ...segmentFraming(segment),
  id: segment.id,
  startMs: segment.startMs,
  endMs: segment.endMs,
  format: segment.format,
  transition: segment.transition || "cut",
  transitionDurationMs: segment.transitionDurationMs ?? 250,
  layoutSlot: 0,
});
