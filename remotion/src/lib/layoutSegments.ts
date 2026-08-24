import type { LayoutConfig, LayoutFormat, LayoutTransition } from "./types";

export interface LayoutSegment {
  id: string;
  startMs: number;
  endMs: number;
  format: LayoutFormat;
  transition: LayoutTransition;
  transitionDurationMs: number;
}

export interface ResolvedLayout {
  active: LayoutSegment;
  previous: LayoutSegment | null;
  transitionProgress: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const numberOr = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeFormat = (format: unknown, fallback: LayoutFormat): LayoutFormat =>
  format === "streamer_stack" || format === "standard" ? format : fallback;

const normalizeTransition = (transition: unknown): LayoutTransition =>
  transition === "crossfade" ? "crossfade" : "cut";

const normalizeDuration = (
  value: unknown,
  segmentDurationMs: number,
  transition: LayoutTransition,
) => {
  const requested = Math.max(
    0,
    Math.round(numberOr(value, 250) < 0 ? 250 : numberOr(value, 250)),
  );
  return transition === "crossfade"
    ? Math.min(requested, Math.max(0, segmentDurationMs))
    : requested;
};

export const normalizeLayoutSegments = (
  layout: LayoutConfig | null | undefined,
  durationInFrames: number,
  fps: number,
): LayoutSegment[] => {
  const durationMs = Math.max(
    1,
    Math.round((Math.max(1, Number(durationInFrames) || 1) / Number(fps || 30)) * 1000),
  );
  const fallbackFormat = layout?.format === "streamer_stack" ? "streamer_stack" : "standard";
  const source = Array.isArray(layout?.segments) ? layout.segments : [];
  if (!source.length) {
    return [
      {
        id: "layout-1",
        startMs: 0,
        endMs: durationMs,
        format: fallbackFormat,
        transition: "cut",
        transitionDurationMs: 250,
      },
    ];
  }

  const candidates = source
    .map((segment, index) => ({
      segment,
      index,
      startMs: clamp(Math.round(numberOr(segment.startMs, 0)), 0, durationMs),
      endMs: clamp(Math.round(numberOr(segment.endMs, 0)), 0, durationMs),
    }))
    .filter(({ startMs, endMs }) => endMs > startMs)
    .sort((left, right) => left.startMs - right.startMs || left.index - right.index);

  if (!candidates.length) return normalizeLayoutSegments({ format: fallbackFormat }, durationInFrames, fps);

  const usedIds = new Set<string>();
  let cursor = 0;
  const normalized: LayoutSegment[] = [];
  candidates.forEach(({ segment, endMs }, index) => {
    if (cursor >= durationMs) return;
    const nextEnd = Math.min(durationMs, Math.max(cursor, endMs));
    if (nextEnd <= cursor) return;
    let id = typeof segment.id === "string" && segment.id ? segment.id : `layout-${index + 1}`;
    let suffix = 2;
    while (usedIds.has(id)) id = `${id}-${suffix++}`;
    usedIds.add(id);
    const format = normalizeFormat(segment.format, fallbackFormat);
    const transition = normalizeTransition(segment.transition);
    normalized.push({
      id,
      startMs: cursor,
      endMs: nextEnd,
      format,
      transition,
      transitionDurationMs: normalizeDuration(
        segment.transitionDurationMs,
        nextEnd - cursor,
        transition,
      ),
    });
    cursor = nextEnd;
  });

  if (!normalized.length) return normalizeLayoutSegments({ format: fallbackFormat }, durationInFrames, fps);
  if (normalized[normalized.length - 1].endMs < durationMs) {
    const last = normalized[normalized.length - 1];
    normalized[normalized.length - 1] = {
      ...last,
      endMs: durationMs,
      transitionDurationMs: normalizeDuration(
        last.transitionDurationMs,
        durationMs - last.startMs,
        last.transition,
      ),
    };
  }
  return normalized;
};

export const resolveLayoutAtFrame = (
  layout: LayoutConfig | null | undefined,
  frame: number,
  durationInFrames: number,
  fps: number,
): ResolvedLayout => {
  const segments = normalizeLayoutSegments(layout, durationInFrames, fps);
  const timeMs = Math.max(0, (Number(frame) || 0) / Number(fps || 30) * 1000);
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
        (timeMs - active.startMs) /
          Math.max(1, active.transitionDurationMs),
        0,
        1,
      )
    : 1;
  return { active, previous, transitionProgress };
};
