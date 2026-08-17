const nonNegative = (value) => Math.max(0, Number(value) || 0);

export const sourceTimeToClipTime = (sourceTimeMs, clipStartMs = 0, clipDurationMs = Infinity) => {
    const relativeMs = nonNegative(sourceTimeMs) - nonNegative(clipStartMs);
    return Math.min(Math.max(0, relativeMs), nonNegative(clipDurationMs));
};

export const clipTimeToSourceTime = (clipTimeMs, clipStartMs = 0, clipDurationMs = Infinity) => (
    nonNegative(clipStartMs) + Math.min(Math.max(0, Number(clipTimeMs) || 0), nonNegative(clipDurationMs))
);
