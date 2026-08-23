const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));

const trackItems = (track) => {
  const cues = Array.isArray(track?.cues) ? track.cues : [];
  const captions = Array.isArray(track?.captions) ? track.captions : [];
  return cues.length ? cues : captions;
};

const trackCaptions = (track) =>
  trackItems(track).flatMap((cue) => {
    const captions =
      Array.isArray(cue?.captions) && cue.captions.length
        ? cue.captions
        : [cue];
    return captions.map((caption) => ({
      text: caption.text || caption.word || "",
      startMs: Number(caption.startMs || 0),
      endMs: Number(caption.endMs ?? caption.startMs ?? 0),
    }));
  });

const isGeneratedSourceClip = (url) => {
  if (!url) return false;
  try {
    return /(?:^|\/)source_clip_[^/]+\.mp4$/i.test(
      new URL(url, window.location.origin).pathname,
    );
  } catch {
    return /(?:^|\/)source_clip_[^/]+\.mp4(?:[?#]|$)/i.test(String(url));
  }
};

export function manifestToRenderProps(
  manifest = {},
  { activeSubtitleTrackId = manifest.active_subtitle_track_id || null } = {},
) {
  const videoUrl = manifest.timeline?.source_video_url || "";
  const subtitleTracks = Array.isArray(manifest.subtitle_tracks)
    ? manifest.subtitle_tracks
    : [];
  const activeTrack =
    subtitleTracks.find((track) => track.id === activeSubtitleTrackId) || null;
  const activeCaptions = activeTrack ? trackCaptions(activeTrack) : [];
  const subtitles =
    activeTrack && activeCaptions.length
      ? {
          ...(clone(manifest.layers?.subtitles) || {}),
          captions: activeCaptions,
          style: activeTrack.style || manifest.layers?.subtitles?.style,
        }
      : null;
  const layout = manifest.layers?.layout || null;
  return {
    videoUrl,
    // Generated source clips are already trimmed to the clip range. Applying
    // the master-video offset again makes Remotion seek past the file and
    // leaves the encoded video on its first decoded frame.
    videoStartSeconds: isGeneratedSourceClip(videoUrl)
      ? 0
      : Math.max(0, Number(manifest.timeline?.trim?.start_sec) || 0),
    subtitles,
    subtitleTracks,
    activeSubtitleTrackId: subtitles ? activeTrack.id : null,
    layout,
    hook: manifest.layers?.hook || null,
    effects: manifest.layers?.effects || null,
    audio: manifest.layers?.audio || null,
  };
}

const transcriptCuesRelativeToClip = (manifest) => {
  const transcript = manifest?.timeline?.transcript;
  if (!transcript?.segments?.length) return [];
  const trimStart = Number(manifest.timeline?.trim?.start_sec || 0);
  const trimEnd = Number(
    manifest.timeline?.trim?.end_sec ?? Number.POSITIVE_INFINITY,
  );
  return transcript.segments.flatMap((segment) => {
    const segmentStart = Number(segment.start || 0);
    const segmentEnd = Number(segment.end ?? segment.start ?? 0);
    const start = Math.max(segmentStart, trimStart);
    const end = Math.min(segmentEnd, trimEnd);
    if (end <= start) return [];
    const captions = (segment.words || []).flatMap((word) => {
      const wordStart = Math.max(Number(word.start || 0), trimStart);
      const wordEnd = Math.min(Number(word.end ?? word.start ?? 0), trimEnd);
      if (wordEnd <= wordStart) return [];
      return [
        {
          text: word.word || word.text || "",
          startMs: Math.round((wordStart - trimStart) * 1000),
          endMs: Math.round((wordEnd - trimStart) * 1000),
        },
      ];
    });
    return [
      {
        text: segment.text || captions.map((caption) => caption.text).join(" "),
        startMs: Math.round((start - trimStart) * 1000),
        endMs: Math.round((end - trimStart) * 1000),
        ...(captions.length ? { captions } : {}),
      },
    ];
  });
};

const transcriptTrack = (manifest, transcript) => {
  const endpointCues = transcript?.captions?.length
    ? transcript.captions.map((caption) => ({
        text: caption.text || "",
        startMs: Number(caption.startMs || 0),
        endMs: Number(caption.endMs || caption.startMs || 0),
        captions: [
          {
            text: caption.text || "",
            startMs: Number(caption.startMs || 0),
            endMs: Number(caption.endMs || caption.startMs || 0),
          },
        ],
      }))
    : transcriptCuesRelativeToClip(manifest);
  if (!endpointCues.length) return null;
  const language =
    transcript?.language || manifest?.timeline?.transcript?.language || "und";
  return {
    id: "original",
    language,
    label: "Original",
    origin: "original",
    cues: endpointCues,
    captions: endpointCues.flatMap(
      (cue) =>
        cue.captions || [
          { text: cue.text, startMs: cue.startMs, endMs: cue.endMs },
        ],
    ),
  };
};

export function manifestWithTranscriptCaptions(manifest, transcript) {
  if (manifest?.subtitle_tracks_disabled === true) return manifest;
  const track = transcriptTrack(manifest, transcript);
  if (!track) return manifest;

  const existingTracks = Array.isArray(manifest?.subtitle_tracks)
    ? manifest.subtitle_tracks
    : [];
  const originalIndex = existingTracks.findIndex(isOriginalSubtitleTrack);
  if (
    originalIndex >= 0 &&
    trackItems(existingTracks[originalIndex]).length > 0
  )
    return manifest;

  const nextTracks =
    originalIndex >= 0
      ? existingTracks.map((existing, index) =>
          index === originalIndex ? { ...existing, ...track } : existing,
        )
      : [track, ...existingTracks];
  const captions = track.captions || [];
  return {
    ...manifest,
    subtitle_tracks: nextTracks,
    active_subtitle_track_id: manifest.active_subtitle_track_id || track.id,
    timeline: {
      ...(manifest?.timeline || {}),
      ...(manifest?.timeline?.transcript?.segments?.length
        ? {}
        : {
            transcript: {
              language: track.language,
              segments: captions.map((caption) => ({
                start: Number(caption.startMs || 0) / 1000,
                end: Number(caption.endMs || caption.startMs || 0) / 1000,
                text: caption.text || "",
                words: [
                  {
                    start: Number(caption.startMs || 0) / 1000,
                    end: Number(caption.endMs || caption.startMs || 0) / 1000,
                    word: caption.text || "",
                  },
                ],
              })),
            },
          }),
    },
    layers: {
      ...(manifest?.layers || {}),
      subtitles: {
        ...(manifest?.layers?.subtitles || {}),
        language: track.language,
        cues: track.cues,
        captions,
      },
    },
  };
}

const isOriginalSubtitleTrack = (track) =>
  track?.id === "original" ||
  track?.origin === "original" ||
  track?.origin === "generated";

export function manifestWithRefreshedSourceRange(
  manifest,
  { startSec, endSec },
  transcript,
) {
  const source = clone(manifest);
  source.timeline = {
    ...(source.timeline || {}),
    trim: {
      ...(source.timeline?.trim || {}),
      start_sec: Number(startSec),
      end_sec: Number(endSec),
    },
  };
  const refreshedTrack = transcriptTrack(source, transcript);
  if (!refreshedTrack) return source;

  const existingTracks = Array.isArray(source.subtitle_tracks)
    ? source.subtitle_tracks
    : [];
  const originalIndex = existingTracks.findIndex(isOriginalSubtitleTrack);
  const originalTrack =
    originalIndex >= 0 ? existingTracks[originalIndex] : null;
  const nextTrack = { ...originalTrack, ...refreshedTrack };
  source.subtitle_tracks =
    originalIndex >= 0
      ? existingTracks.map((track, index) =>
          index === originalIndex ? nextTrack : track,
        )
      : [nextTrack, ...existingTracks];
  source.active_subtitle_track_id =
    source.active_subtitle_track_id || nextTrack.id;
  source.layers = {
    ...(source.layers || {}),
    subtitles: {
      ...(source.layers?.subtitles || {}),
      language: nextTrack.language,
      cues: nextTrack.cues,
      captions: nextTrack.captions,
    },
  };
  return source;
}

const durationFromManifest = (manifest) => {
  const trim = manifest?.timeline?.trim || {};
  const end = Number(trim.end_sec ?? manifest?.duration_sec ?? 0);
  const start = Number(trim.start_sec ?? 0);
  return Math.max(0, end - start);
};

const cueText = (cue) =>
  cue.text || cue.captions?.map((word) => word.text).join(" ") || "";

const subtitleItems = (track) =>
  trackItems(track).map((cue, index) => ({
    id: `${track.id || "subtitle"}-${index}`,
    type: "subtitle",
    label: cueText(cue),
    text: cueText(cue),
    start: Number(cue.startMs || 0) / 1000,
    end: Number(cue.endMs || cue.startMs || 0) / 1000,
    trackId: `subtitles-${track.id}`,
    cueIndex: index,
    trackIdRef: track.id,
  }));

const transcriptCues = (transcript) =>
  (transcript?.segments || []).map((segment) => ({
    text: segment.text || "",
    startMs: Math.round(Number(segment.start || 0) * 1000),
    endMs: Math.round(Number(segment.end || segment.start || 0) * 1000),
    captions: (segment.words || []).map((word) => ({
      text: word.word || word.text || "",
      startMs: Math.round(Number(word.start || 0) * 1000),
      endMs: Math.round(Number(word.end || word.start || 0) * 1000),
    })),
  }));

const subtitleTracksFromManifest = (manifest) => {
  if (
    Array.isArray(manifest?.subtitle_tracks) &&
    manifest.subtitle_tracks.length
  )
    return manifest.subtitle_tracks;
  const legacy = manifest?.layers?.subtitles;
  if (legacy)
    return [
      {
        id: "original",
        language: legacy.language || "und",
        label: legacy.label || "Original",
        origin: "original",
        cues: legacy.cues || legacy.captions || [],
      },
    ];
  const transcript = manifest?.timeline?.transcript;
  if (transcript?.segments?.length)
    return [
      {
        id: "original",
        language: transcript.language || "und",
        label: "Original",
        origin: "original",
        cues: transcriptCues(transcript),
      },
    ];
  return [];
};

export function manifestToEditorState(manifest, { fps = 30 } = {}) {
  const durationSec = durationFromManifest(manifest);
  const tracks = [
    {
      id: "video-1",
      name: "V1",
      type: "video",
      muted: false,
      locked: false,
      visible: true,
      items: [
        {
          id: "video-1-source",
          type: "video",
          label: "Source video",
          start: 0,
          end: durationSec,
          trackId: "video-1",
          url: manifest?.timeline?.source_video_url || "",
        },
      ],
    },
    {
      id: "audio-1",
      name: "A1",
      type: "audio",
      muted: false,
      locked: false,
      visible: true,
      items: [
        {
          id: "audio-1-source",
          type: "audio",
          label: "Source audio",
          start: 0,
          end: durationSec,
          trackId: "audio-1",
          url: manifest?.timeline?.source_video_url || "",
        },
      ],
    },
  ];

  const hook = manifest?.layers?.hook;
  if (hook)
    tracks.push({
      id: "hook",
      name: "Hook",
      type: "hook",
      muted: false,
      locked: false,
      visible: true,
      items: [
        {
          ...clone(hook),
          id: "hook-1",
          type: "hook",
          label: hook.text || "Hook",
          start: Number(hook.startMs || 0) / 1000,
          end:
            Number(
              hook.endMs ??
                (hook.startMs || 0) + (hook.displayDurationSec || 0) * 1000,
            ) / 1000,
          trackId: "hook",
        },
      ],
    });

  for (const track of subtitleTracksFromManifest(manifest)) {
    tracks.push({
      id: `subtitles-${track.id}`,
      name: track.label || track.language || track.id,
      type: "subtitle",
      language: track.language,
      origin: track.origin,
      muted: false,
      locked: false,
      visible: true,
      items: subtitleItems(track),
    });
  }

  const effects = manifest?.layers?.effects?.segments || [];
  if (effects.length)
    tracks.push({
      id: "effects",
      name: "Effects",
      type: "effects",
      muted: false,
      locked: false,
      visible: true,
      items: effects.map((segment, index) => ({
        ...clone(segment),
        id: `effect-${index}`,
        type: "effect",
        label: "Effect",
        start: Number(segment.startSec || 0),
        end: Number(segment.endSec || 0),
        trackId: "effects",
      })),
    });

  return {
    fps,
    durationSec,
    durationFrames: Math.max(1, Math.round(durationSec * fps)),
    playheadFrame: 0,
    selectedItemId: null,
    tracks,
  };
}

export function editorStateToManifest(state, sourceManifest) {
  const manifest = clone(sourceManifest);
  const hookItem = state.tracks.find((track) => track.id === "hook")?.items[0];
  if (hookItem)
    manifest.layers = {
      ...(manifest.layers || {}),
      hook: {
        ...clone(manifest.layers?.hook),
        ...clone(hookItem),
        startMs: Math.round(hookItem.start * 1000),
        endMs: Math.round(hookItem.end * 1000),
        displayDurationSec: Math.max(0.001, hookItem.end - hookItem.start),
      },
    };

  const subtitleTracks = state.tracks
    .filter((track) => track.type === "subtitle")
    .map((track) => {
      const existing =
        (manifest.subtitle_tracks || []).find(
          (item) =>
            item.id === track.language ||
            item.id === track.id.replace(/^subtitles-/, ""),
        ) || {};
      const cues = track.items.map((item) => ({
        text: item.text || item.label || "",
        startMs: Math.round(item.start * 1000),
        endMs: Math.round(item.end * 1000),
        captions: [
          {
            text: item.text || item.label || "",
            startMs: Math.round(item.start * 1000),
            endMs: Math.round(item.end * 1000),
          },
        ],
      }));
      return {
        ...clone(existing),
        id: existing.id || track.id.replace(/^subtitles-/, ""),
        language: existing.language || track.language,
        label: existing.label || track.name,
        origin: existing.origin || track.origin || "manual",
        cues,
        captions: cues.flatMap((cue) => cue.captions),
      };
    });
  if (subtitleTracks.length) {
    manifest.subtitle_tracks = subtitleTracks;
    const original = state.tracks.find(
      (track) => track.id === "subtitles-original",
    );
    if (original) {
      const legacy = clone(manifest.layers?.subtitles || {});
      const legacyCues = original.items.map((item) => ({
        text: item.text || item.label || "",
        startMs: Math.round(item.start * 1000),
        endMs: Math.round(item.end * 1000),
        captions: [
          {
            text: item.text || item.label || "",
            startMs: Math.round(item.start * 1000),
            endMs: Math.round(item.end * 1000),
          },
        ],
      }));
      manifest.layers = {
        ...(manifest.layers || {}),
        subtitles: {
          ...legacy,
          cues: legacyCues,
          captions: legacyCues.flatMap((cue) => cue.captions),
        },
      };
      const transcript = manifest.timeline?.transcript;
      if (transcript?.segments?.length) {
        const existingSegments = transcript.segments;
        const transcriptOffset = Number(
          manifest.timeline?.trim?.start_sec || 0,
        );
        const segments = original.items.map((item, index) => ({
          ...(existingSegments[index] || {}),
          text: item.text || item.label || "",
          start: item.start + transcriptOffset,
          end: item.end + transcriptOffset,
        }));
        manifest.timeline = {
          ...(manifest.timeline || {}),
          transcript: { ...transcript, segments },
        };
      }
    }
  }
  const effects = state.tracks.find((track) => track.id === "effects");
  if (effects)
    manifest.layers = {
      ...(manifest.layers || {}),
      effects: {
        segments: effects.items.map((item) => ({
          ...clone(item),
          startSec: item.start,
          endSec: item.end,
        })),
      },
    };
  return manifest;
}

export function editorStateToDesignComboItems(state) {
  return state.tracks.flatMap((track) =>
    track.items.map((item) => ({ ...item, trackId: track.id })),
  );
}

export function designComboItemsToEditorState(items, state) {
  const next = clone(state);
  const byTrack = new Map();
  for (const item of items)
    byTrack.set(item.trackId, [...(byTrack.get(item.trackId) || []), item]);
  next.tracks = next.tracks.map((track) => ({
    ...track,
    items: byTrack.get(track.id) || track.items,
  }));
  return next;
}
