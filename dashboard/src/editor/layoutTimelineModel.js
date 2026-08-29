export const DEFAULT_LAYOUT_FORMAT = "standard";
export const DEFAULT_LAYOUT_TRANSITION = "cut";
export const DEFAULT_LAYOUT_TRANSITION_DURATION_MS = 250;

const FORMATS = new Set(["standard", "streamer_stack"]);
const TRANSITIONS = new Set(["cut", "crossfade"]);

const numberOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const positiveDuration = (durationMs) =>
  Math.max(1, Math.round(numberOr(durationMs, 1)));

const normalizeFormat = (format, fallback = DEFAULT_LAYOUT_FORMAT) =>
  FORMATS.has(format) ? format : fallback;

const normalizeTransition = (transition) =>
  TRANSITIONS.has(transition) ? transition : DEFAULT_LAYOUT_TRANSITION;

const normalizeTransitionDuration = (
  durationMs,
  segmentDurationMs,
  transition,
) => {
  const rawDuration = numberOr(
    durationMs,
    DEFAULT_LAYOUT_TRANSITION_DURATION_MS,
  );
  const requested = Math.max(
    0,
    Math.round(
      rawDuration < 0 ? DEFAULT_LAYOUT_TRANSITION_DURATION_MS : rawDuration,
    ),
  );
  if (transition !== "crossfade") return requested;
  return Math.min(requested, Math.max(0, segmentDurationMs));
};

const normalizeId = (id, fallback) =>
  typeof id === "string" && id.trim() ? id : fallback;

const normalizeGameplayFocus = (focus) => {
  const x = Number(focus?.x);
  const y = Number(focus?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
};

const normalizeGameplayZoom = (zoom) => {
  if (zoom == null || zoom === "") return undefined;
  const value = Number(zoom);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0.6, Math.min(2, value));
};

const normalizeSegment = (segment, startMs, endMs, fallbackId) => {
  const format = normalizeFormat(segment?.format);
  const transition = normalizeTransition(segment?.transition);
  const normalized = {
    ...segment,
    id: normalizeId(segment?.id, fallbackId),
    startMs,
    endMs,
    format,
    transition,
    transitionDurationMs: normalizeTransitionDuration(
      segment?.transitionDurationMs,
      endMs - startMs,
      transition,
    ),
  };
  const gameplayFocus = normalizeGameplayFocus(segment?.gameplay_focus);
  const gameplayZoom = normalizeGameplayZoom(segment?.gameplay_zoom);
  if (gameplayFocus) normalized.gameplay_focus = gameplayFocus;
  else delete normalized.gameplay_focus;
  if (gameplayZoom !== undefined) normalized.gameplay_zoom = gameplayZoom;
  else delete normalized.gameplay_zoom;
  return normalized;
};

export function createLayoutSegments(
  durationMs,
  format = DEFAULT_LAYOUT_FORMAT,
) {
  const duration = positiveDuration(durationMs);
  return [
    {
      id: "layout-1",
      startMs: 0,
      endMs: duration,
      format: normalizeFormat(format),
      transition: DEFAULT_LAYOUT_TRANSITION,
      transitionDurationMs: DEFAULT_LAYOUT_TRANSITION_DURATION_MS,
    },
  ];
}

export function normalizeLayoutSegments(
  segments,
  durationMs,
  fallbackFormat = DEFAULT_LAYOUT_FORMAT,
) {
  const duration = positiveDuration(durationMs);
  if (!Array.isArray(segments) || segments.length === 0) {
    return createLayoutSegments(duration, fallbackFormat);
  }

  const usedIds = new Set();
  const candidates = segments
    .map((segment, index) => {
      const startMs = Math.max(
        0,
        Math.min(duration, Math.round(numberOr(segment?.startMs, 0))),
      );
      const endMs = Math.max(
        0,
        Math.min(duration, Math.round(numberOr(segment?.endMs, startMs))),
      );
      return { segment, index, startMs, endMs };
    })
    .filter(({ startMs, endMs }) => endMs > startMs)
    .sort(
      (left, right) => left.startMs - right.startMs || left.index - right.index,
    );

  if (candidates.length === 0)
    return createLayoutSegments(duration, fallbackFormat);

  let cursor = 0;
  const normalized = [];
  candidates.forEach(({ segment, endMs }, index) => {
    if (cursor >= duration) return;
    const nextEnd = Math.min(duration, Math.max(cursor, endMs));
    if (nextEnd <= cursor) return;
    let id = normalizeId(segment?.id, `layout-${index + 1}`);
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) suffix += 1;
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);
    normalized.push(normalizeSegment(segment, cursor, nextEnd, id));
    cursor = nextEnd;
  });

  if (normalized.length === 0)
    return createLayoutSegments(duration, fallbackFormat);
  if (normalized[normalized.length - 1].endMs < duration) {
    normalized[normalized.length - 1] = normalizeSegment(
      normalized[normalized.length - 1],
      normalized[normalized.length - 1].startMs,
      duration,
      normalized[normalized.length - 1].id,
    );
  }
  return normalized;
}

export function splitLayoutSegment(segments, segmentId, playheadMs) {
  if (!Array.isArray(segments)) return null;
  const index = segments.findIndex((segment) => segment?.id === segmentId);
  if (index < 0) return null;
  const segment = segments[index];
  const startMs = numberOr(segment.startMs, 0);
  const endMs = numberOr(segment.endMs, startMs);
  const splitMs = Math.round(numberOr(playheadMs, startMs));
  if (!(startMs < splitMs && splitMs < endMs)) return null;

  const usedIds = new Set(segments.map((item) => item?.id));
  let suffix = 1;
  let splitId = `${segment.id}-split-${suffix}`;
  while (usedIds.has(splitId)) {
    suffix += 1;
    splitId = `${segment.id}-split-${suffix}`;
  }

  const next = segments.slice();
  next.splice(
    index,
    1,
    { ...segment, endMs: splitMs },
    { ...segment, id: splitId, startMs: splitMs },
  );
  return next;
}

export function updateLayoutSegment(segments, segmentId, changes = {}) {
  if (!Array.isArray(segments)) return segments;
  const duration = segments.reduce(
    (largest, segment) => Math.max(largest, numberOr(segment?.endMs, 0)),
    1,
  );
  return segments.map((segment) => {
    if (segment?.id !== segmentId) return segment;
    const next = { ...segment, ...changes };
    const startMs = Math.max(0, numberOr(next.startMs, 0));
    const endMs = Math.max(
      startMs,
      Math.min(duration, numberOr(next.endMs, startMs)),
    );
    const transition = normalizeTransition(next.transition);
    return {
      ...next,
      startMs,
      endMs,
      format: normalizeFormat(next.format),
      transition,
      transitionDurationMs: normalizeTransitionDuration(
        next.transitionDurationMs,
        endMs - startMs,
        transition,
      ),
    };
  });
}

export function clearLayoutSegmentFraming(segments, segmentId) {
  if (!Array.isArray(segments)) return segments;
  return segments.map((segment) => {
    if (segment?.id !== segmentId) return segment;
    const next = { ...segment };
    delete next.gameplay_focus;
    delete next.gameplay_zoom;
    return next;
  });
}

export function getLayoutSegmentAt(segments, playheadMs) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const timeMs = numberOr(playheadMs, 0);
  const ordered = segments
    .filter(
      (segment) => numberOr(segment?.endMs, 0) > numberOr(segment?.startMs, 0),
    )
    .slice()
    .sort(
      (left, right) => numberOr(left.startMs, 0) - numberOr(right.startMs, 0),
    );
  const active = ordered.find(
    (segment) =>
      timeMs >= numberOr(segment.startMs, 0) &&
      timeMs < numberOr(segment.endMs, 0),
  );
  if (active) return active;
  const last = ordered[ordered.length - 1];
  return last && timeMs === numberOr(last.endMs, 0) ? last : null;
}
