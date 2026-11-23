export const transcriptToSourceEditorState = (transcript) => {
  const segments = Array.isArray(transcript?.segments)
    ? transcript.segments
    : [];

  return {
    subtitleLanguage: String(transcript?.language || "en").toLowerCase(),
    subtitleCues: segments.flatMap((segment, sourceSegmentIndex) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      const text = String(
        segment?.text ||
          (Array.isArray(segment?.words)
            ? segment.words
                .map((word) => word?.word || word?.text || "")
                .join(" ")
            : ""),
      ).trim();

      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return [];
      }

      return [
        {
          id: `source-segment-${sourceSegmentIndex}`,
          sourceSegmentIndex,
          text,
          startMs: Math.round(start * 1000),
          endMs: Math.round(end * 1000),
        },
      ];
    }),
  };
};

const rescaleWordTimings = (words, oldStart, oldEnd, newStart, newEnd) => {
  const oldDuration = oldEnd - oldStart;
  const newDuration = newEnd - newStart;
  if (oldDuration <= 0 || newDuration <= 0) return words;

  return words.flatMap((word) => {
    const wordStart = Number(word?.start);
    const wordEnd = Number(word?.end);
    if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) return [];

    const startRatio = Math.max(
      0,
      Math.min(1, (wordStart - oldStart) / oldDuration),
    );
    const endRatio = Math.max(
      0,
      Math.min(1, (wordEnd - oldStart) / oldDuration),
    );
    let start = Math.max(
      newStart,
      Math.min(newEnd, newStart + startRatio * newDuration),
    );
    let end = Math.max(
      newStart,
      Math.min(newEnd, newStart + endRatio * newDuration),
    );

    if (end <= start) {
      start = Math.max(newStart, Math.min(start, newEnd - 0.001));
      end = Math.min(newEnd, start + 0.001);
    }

    return [
      {
        ...word,
        start: Math.round(start * 1000) / 1000,
        end: Math.round(end * 1000) / 1000,
      },
    ];
  });
};

export const applySourceEditorCues = (
  transcript,
  cues,
  { useWordLevelTiming = false } = {},
) => {
  const sourceSegments = Array.isArray(transcript?.segments)
    ? transcript.segments
    : [];
  const cuesBySourceSegment = new Map();
  const addedCues = [];

  for (const cue of Array.isArray(cues) ? cues : []) {
    const sourceSegmentIndex = Number(cue?.sourceSegmentIndex);
    if (
      Number.isInteger(sourceSegmentIndex) &&
      sourceSegmentIndex >= 0 &&
      sourceSegmentIndex < sourceSegments.length
    ) {
      cuesBySourceSegment.set(sourceSegmentIndex, cue);
    } else {
      addedCues.push(cue);
    }
  }

  const segments = sourceSegments.flatMap((segment, index) => {
    const cue = cuesBySourceSegment.get(index);
    if (!cue) return [];
    const originalStart = Number(segment.start);
    const originalEnd = Number(segment.end);
    const requestedStart = Number(cue.startMs);
    const requestedEnd = Number(cue.endMs);
    const start = Number.isFinite(requestedStart)
      ? requestedStart / 1000
      : originalStart;
    const end = Number.isFinite(requestedEnd)
      ? requestedEnd / 1000
      : originalEnd;
    const text = String(cue.text || "").trim();
    const textChanged = text !== String(segment.text || "").trim();
    const timingChanged =
      Math.round(originalStart * 1000) !== Math.round(start * 1000) ||
      Math.round(originalEnd * 1000) !== Math.round(end * 1000);
    const updatedSegment = { ...segment, start, end, text };

    if (!useWordLevelTiming && (textChanged || timingChanged)) {
      delete updatedSegment.words;
    } else if (useWordLevelTiming && timingChanged) {
      const words = Array.isArray(segment.words) ? segment.words : [];
      updatedSegment.words = rescaleWordTimings(
        words,
        originalStart,
        originalEnd,
        start,
        end,
      );
    }

    return [updatedSegment];
  });

  for (const cue of addedCues) {
    const start = Number(cue?.startMs) / 1000;
    const end = Number(cue?.endMs) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    const words = (Array.isArray(cue?.captions) ? cue.captions : [])
      .map((caption) => ({
        word: String(caption?.text || "").trim(),
        start: Number(caption?.startMs) / 1000,
        end: Number(caption?.endMs) / 1000,
      }))
      .filter(
        (word) =>
          word.word &&
          Number.isFinite(word.start) &&
          Number.isFinite(word.end) &&
          word.end > word.start,
      );
    segments.push({
      start,
      end,
      text: String(cue.text || "").trim(),
      ...(words.length ? { words } : {}),
    });
  }

  segments.sort((left, right) => Number(left.start) - Number(right.start));
  return { ...transcript, segments };
};
