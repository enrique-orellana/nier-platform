const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const soundEventId = (label, startMs, endMs, index) =>
  `sound-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.round(startMs)}-${Math.round(endMs)}-${index}`;

export function normalizeSoundEvents(events, durationMs) {
  if (!Array.isArray(events)) return [];

  const safeDurationMs = Math.max(1, Number(durationMs) || 1);
  return events
    .flatMap((event, index) => {
      const label = String(event?.label || "").trim();
      const start = Number(event?.start);
      const end = Number(event?.end);
      if (
        !label ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start
      ) {
        return [];
      }

      const startMs = clamp(start * 1000, 0, safeDurationMs);
      const endMs = clamp(end * 1000, 0, safeDurationMs);
      if (endMs <= startMs) return [];

      const confidence = Number(event?.confidence);
      return [
        {
          ...event,
          id: soundEventId(label, startMs, endMs, index),
          label,
          startMs,
          endMs,
          confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : 0,
        },
      ];
    })
    .sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    );
}

export function activeSoundEventAt(events, playheadMs) {
  const time = Number(playheadMs);
  if (!Array.isArray(events) || !Number.isFinite(time)) return null;

  return events
    .filter((event) => time >= event.startMs && time < event.endMs)
    .reduce((active, event) => {
      if (!active || event.confidence > active.confidence) return event;
      return active;
    }, null);
}
