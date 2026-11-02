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

export const applySourceEditorCues = (transcript, cues) => {
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
    return [{ ...segment, text: String(cue.text || "").trim() }];
  });

  for (const cue of addedCues) {
    const start = Number(cue?.startMs) / 1000;
    const end = Number(cue?.endMs) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    segments.push({ start, end, text: String(cue.text || "").trim() });
  }

  segments.sort((left, right) => Number(left.start) - Number(right.start));
  return { ...transcript, segments };
};
