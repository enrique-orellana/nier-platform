import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Save } from "lucide-react";
import { getApiUrl } from "../../config";
import {
  manifestWithTranscriptCaptions,
  manifestWithRefreshedSourceRange,
  manifestToRenderProps,
} from "../../editor/designcomboAdapter";
import VersionHistory from "./VersionHistory";
import {
  saveDraftVersion,
  saveAndRenderVersion,
} from "../../editor/renderVersion";
import EditorActionToolbar from "./EditorActionToolbar";
import LocalEditorTab from "../local-editor/LocalEditorTab";
import { DEFAULT_SUBTITLE_STYLE } from "../local-editor/localEditorStyles";
import { readEditorPreferences } from "../local-editor/localEditorPreferences";
import { HOOK_FONT_FAMILY } from "../../remotion/lib/hookVisual";
import {
  resolveMasterVideoUrl,
  useRenewableMediaUrl,
} from "../../lib/videoUrls";
import { resolveLocalEditorSourceUrl } from "./fullScreenEditorSource";
import { normalizeCueCaptions } from "../local-editor/localEditorRender";
import {
  createLayoutSegments,
  normalizeLayoutSegments,
} from "../../editor/layoutTimelineModel";
import {
  normalizeFaceTrackingCache,
  requestFaceTracking,
} from "../../editor/faceTracking";

const defaultSubtitleTrackId = (nextManifest) =>
  nextManifest?.active_subtitle_track_id ||
  nextManifest?.subtitle_tracks?.[0]?.id ||
  (nextManifest?.timeline?.transcript?.segments?.length ? "original" : null);

const hasSubtitleTrackContent = (nextManifest) =>
  Array.isArray(nextManifest?.subtitle_tracks) &&
  nextManifest.subtitle_tracks.some(
    (track) =>
      (Array.isArray(track?.cues) && track.cues.length > 0) ||
      (Array.isArray(track?.captions) && track.captions.length > 0),
  );

const manifestFromClip = (clip = {}) => {
  const start = Number(clip.start);
  const end = Number(clip.end);
  const duration = Number(clip.duration);
  const startSec = Number.isFinite(start) ? start : 0;
  const endSec =
    Number.isFinite(end) && end > startSec
      ? end
      : startSec + (Number.isFinite(duration) && duration > 0 ? duration : 30);
  return {
    timeline: {
      source_video_url: resolveMasterVideoUrl(clip),
      trim: { start_sec: startSec, end_sec: endSec },
    },
    layers: {},
    subtitle_tracks: [],
  };
};

const clipLayoutFromMetadata = (clip = {}) => ({
  ...(clip.layout_format ? { format: clip.layout_format } : {}),
  ...(clip.facecam_size ? { facecam_size: clip.facecam_size } : {}),
  ...(clip.webcam_region ? { webcam_region: clip.webcam_region } : {}),
  ...(clip.gameplay_region ? { gameplay_region: clip.gameplay_region } : {}),
  ...(clip.gameplay_zoom != null ? { gameplay_zoom: clip.gameplay_zoom } : {}),
  ...(typeof clip.streamer_tracking_enabled === "boolean"
    ? { streamer_tracking_enabled: clip.streamer_tracking_enabled }
    : {}),
});

// Clip-region selections live in the generated clip metadata, while editor
// versions store the render layout in the manifest. Keep both sources in sync
// when opening older versions that predate camera-region persistence.
// eslint-disable-next-line react-refresh/only-export-components
export const manifestWithClipLayout = (sourceManifest, clip = {}) => {
  if (!sourceManifest) return sourceManifest;
  const source = sourceManifest;
  const clipLayout = clipLayoutFromMetadata(clip);
  if (!Object.keys(clipLayout).length) return source;
  return {
    ...source,
    layers: {
      ...(source.layers || {}),
      layout: {
        ...clipLayout,
        ...(source.layers?.layout || {}),
      },
    },
  };
};

const manifestDurationMs = (manifest) => {
  const trim = manifest?.timeline?.trim || {};
  const durationSec = Math.max(
    0.001,
    Number(trim.end_sec ?? manifest?.duration_sec ?? 0) -
      Number(trim.start_sec ?? 0),
  );
  return Math.round(durationSec * 1000);
};

const normalizeSourceDimensions = (source) => {
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (
    !Number.isFinite(width) ||
    width < 1 ||
    !Number.isFinite(height) ||
    height < 1
  )
    return null;
  return { width: Math.round(width), height: Math.round(height) };
};

const normalizeRenderSpec = (source) => {
  if (!source) return null;
  const durationInFrames = Number(source.duration_in_frames);
  const fps = Number(source.fps);
  const width = Number(source.width);
  const height = Number(source.height);
  if (
    !Number.isFinite(durationInFrames) ||
    durationInFrames < 1 ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    !Number.isFinite(width) ||
    width < 1 ||
    !Number.isFinite(height) ||
    height < 1
  )
    return null;
  return {
    video_start_seconds: Math.max(0, Number(source.video_start_seconds) || 0),
    duration_in_frames: Math.max(1, Math.round(durationInFrames)),
    fps,
    width: Math.round(width),
    height: Math.round(height),
    video_fit: source.video_fit === "contain" ? "contain" : "cover",
  };
};

const renderSpecToProps = (renderSpec) => ({
  videoStartSeconds: renderSpec.video_start_seconds,
  durationInFrames: renderSpec.duration_in_frames,
  fps: renderSpec.fps,
  width: renderSpec.width,
  height: renderSpec.height,
  videoFit: renderSpec.video_fit,
});

const publishingMetadataFrom = (sourceManifest, clip) => {
  const savedHashtags = sourceManifest?.publishing_metadata?.hashtags;
  const clipHashtags = clip?.hashtags;
  return {
    ...(sourceManifest?.publishing_metadata || {}),
    hashtags:
      Array.isArray(savedHashtags) && savedHashtags.length
        ? savedHashtags
        : Array.isArray(clipHashtags) && clipHashtags.length
          ? clipHashtags
          : ["#shorts", "#viral"],
  };
};

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

const transcriptCuesForEditor = (manifest) => {
  const transcript = manifest?.timeline?.transcript;
  const segments = Array.isArray(transcript?.segments)
    ? transcript.segments
    : [];
  if (!segments.length) return [];

  const trimStart = Number(manifest.timeline?.trim?.start_sec || 0);
  const trimEnd = Number(
    manifest.timeline?.trim?.end_sec ?? Number.POSITIVE_INFINITY,
  );
  const duration = Math.max(0, trimEnd - trimStart);
  const latestEnd = Math.max(
    ...segments.map((segment) => Number(segment?.end ?? segment?.start ?? 0)),
  );
  if (trimStart <= 0 || latestEnd > duration + 0.001)
    return transcriptCuesRelativeToClip(manifest);

  return segments.flatMap((segment) => {
    const start = Math.max(0, Number(segment?.start || 0));
    const end = Math.min(duration, Number(segment?.end ?? segment?.start ?? 0));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return [];
    const captions = (segment.words || []).flatMap((word) => {
      const wordStart = Math.max(0, Number(word?.start || 0));
      const wordEnd = Math.min(duration, Number(word?.end ?? word?.start ?? 0));
      if (
        !Number.isFinite(wordStart) ||
        !Number.isFinite(wordEnd) ||
        wordEnd <= wordStart
      )
        return [];
      return [
        {
          text: word.word || word.text || "",
          startMs: Math.round(wordStart * 1000),
          endMs: Math.round(wordEnd * 1000),
        },
      ];
    });
    return [
      {
        text: segment.text || captions.map((caption) => caption.text).join(" "),
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        ...(captions.length ? { captions } : {}),
      },
    ];
  });
};

const localCuesFromTrack = (track, fallbackCues = []) => {
  const cues = Array.isArray(track?.cues) ? track.cues : [];
  const captions = Array.isArray(track?.captions) ? track.captions : [];
  const toLocalCues = (items, indexOffset = 0) =>
    items.map((cue, index) =>
      normalizeCueCaptions({
        id: cue.id || `${track?.id || "subtitle"}-${index + indexOffset}`,
        type: "subtitle",
        label:
          cue.text || cue.captions?.map((word) => word.text).join(" ") || "",
        text:
          cue.text || cue.captions?.map((word) => word.text).join(" ") || "",
        startMs: Number(cue.startMs || 0),
        endMs: Number(cue.endMs || cue.startMs || 0),
        captions: Array.isArray(cue.captions) ? cue.captions : undefined,
      }),
    );
  const primary = toLocalCues(cues.length ? cues : captions);
  const missing = toLocalCues(fallbackCues, primary.length).filter(
    (candidate) =>
      !primary.some(
        (existing) =>
          Number(existing.startMs) < Number(candidate.endMs) &&
          Number(candidate.startMs) < Number(existing.endMs),
      ),
  );
  return [...primary, ...missing].sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const manifestToLocalEditorState = (
  sourceManifest,
  trackId,
  fallbackHookText = "",
  fallbackLayoutFormat = "standard",
  editorPreferences = null,
) => {
  const source = manifestWithTranscriptCaptions(sourceManifest || {}, null);
  const legacySubtitles = source.layers?.subtitles;
  const tracks =
    Array.isArray(source.subtitle_tracks) && source.subtitle_tracks.length
      ? source.subtitle_tracks
      : legacySubtitles
        ? [
            {
              id: "original",
              language: legacySubtitles.language || "en",
              label: legacySubtitles.label || "Original",
              origin: "original",
              cues: Array.isArray(legacySubtitles.cues)
                ? legacySubtitles.cues
                : legacySubtitles.captions || [],
              style: legacySubtitles.style,
            },
          ]
        : [];
  const activeTrack = tracks.find((track) => track.id === trackId) || tracks[0];
  const rememberedHookDefaults = editorPreferences?.hookDefaults || {};
  const rememberedHookText = String(fallbackHookText || "").trim();
  const hook =
    source.layers?.hook ||
    (rememberedHookText
      ? {
          ...rememberedHookDefaults,
          text: rememberedHookText,
          startMs: 0,
          endMs: Number(rememberedHookDefaults.durationMs) || 2000,
        }
      : null);
  const layout = source.layers?.layout || {};
  const layoutSegments = Array.isArray(layout.segments)
    ? normalizeLayoutSegments(
        layout.segments,
        manifestDurationMs(source),
        layout.format ||
          source.export_policy?.layout_format ||
          fallbackLayoutFormat,
      )
    : createLayoutSegments(
        manifestDurationMs(source),
        layout.format ||
          source.export_policy?.layout_format ||
          fallbackLayoutFormat,
      );
  return {
    subtitleCues: localCuesFromTrack(
      activeTrack,
      transcriptCuesForEditor(source),
    ),
    subtitleStyle:
      activeTrack?.style ||
      source.layers?.subtitles?.style ||
      editorPreferences?.subtitleStyle ||
      DEFAULT_SUBTITLE_STYLE,
    subtitleLanguage:
      activeTrack?.language ||
      source.layers?.subtitles?.language ||
      editorPreferences?.subtitleLanguage ||
      "en",
    hook: hook
      ? {
          id: "hook",
          text: hook.text || "",
          startMs: Number(hook.startMs || 0),
          endMs: Number(
            hook.endMs ||
              (hook.startMs || 0) + (hook.displayDurationSec || 2) * 1000,
          ),
          position: hook.position || "top",
          size: hook.size || "M",
          entranceAnimation: hook.entranceAnimation || "spring",
          color: hook.color || "#FFFFFF",
          fontSize: Number(hook.fontSize || 48),
          background: hook.background || "#111111",
          fontFamily: hook.fontFamily || HOOK_FONT_FAMILY,
          ...(Number.isFinite(Number(hook.positionX))
            ? { positionX: Number(hook.positionX) }
            : {}),
          ...(Number.isFinite(Number(hook.positionY))
            ? { positionY: Number(hook.positionY) }
            : {}),
        }
      : null,
    layoutSegments,
  };
};

// eslint-disable-next-line react-refresh/only-export-components
export const localEditorStateToManifest = (
  sourceManifest,
  localState,
  trackId,
) => {
  const source = JSON.parse(JSON.stringify(sourceManifest || {}));
  const state = localState || manifestToLocalEditorState(source, trackId);
  const nextTrackId = trackId || "original";
  const existingTracks = Array.isArray(source.subtitle_tracks)
    ? source.subtitle_tracks
    : [];
  const existingTrack =
    existingTracks.find((track) => track.id === nextTrackId) || {};
  const cues = (state.subtitleCues || []).map((cue) => {
    const normalizedCue = normalizeCueCaptions(cue);
    return {
      text: normalizedCue.text || normalizedCue.label || "",
      startMs: Math.round(Number(normalizedCue.startMs || 0)),
      endMs: Math.round(
        Number(normalizedCue.endMs || normalizedCue.startMs || 0),
      ),
      ...(Array.isArray(normalizedCue.captions) && normalizedCue.captions.length
        ? { captions: normalizedCue.captions }
        : {}),
    };
  });
  const nextTrack = {
    ...existingTrack,
    id: nextTrackId,
    language: state.subtitleLanguage || existingTrack.language || "en",
    label: existingTrack.label || state.subtitleLanguage || "Original",
    origin: existingTrack.origin || "manual",
    cues,
    captions: cues.flatMap(
      (cue) =>
        cue.captions || [
          { text: cue.text, startMs: cue.startMs, endMs: cue.endMs },
        ],
    ),
    style: state.subtitleStyle || existingTrack.style || DEFAULT_SUBTITLE_STYLE,
  };
  source.subtitle_tracks = cues.length
    ? [...existingTracks.filter((track) => track.id !== nextTrackId), nextTrack]
    : existingTracks.filter((track) => track.id !== nextTrackId);
  source.subtitle_tracks_disabled = !cues.length;
  source.active_subtitle_track_id = cues.length ? nextTrackId : null;
  const persistedHook = state.hook
    ? (() => {
        const { positionX, positionY, ...hookWithoutCoordinates } = state.hook;
        const sourceHookWithoutCoordinates = { ...(source.layers?.hook || {}) };
        delete sourceHookWithoutCoordinates.positionX;
        delete sourceHookWithoutCoordinates.positionY;
        const position = ["top", "center", "bottom", "custom"].includes(
          state.hook.position,
        )
          ? state.hook.position
          : "top";
        return {
          ...sourceHookWithoutCoordinates,
          ...hookWithoutCoordinates,
          position,
          ...(position === "custom" && Number.isFinite(Number(positionX))
            ? { positionX: Number(positionX) }
            : {}),
          ...(position === "custom" && Number.isFinite(Number(positionY))
            ? { positionY: Number(positionY) }
            : {}),
          startMs: Math.round(Number(state.hook.startMs || 0)),
          endMs: Math.round(Number(state.hook.endMs || 0)),
          displayDurationSec: Math.max(
            0.001,
            (Number(state.hook.endMs || 0) - Number(state.hook.startMs || 0)) /
              1000,
          ),
        };
      })()
    : null;
  const sourceLayout = source.layers?.layout || {};
  const fallbackLayoutFormat =
    sourceLayout.format || source.export_policy?.layout_format || "standard";
  const rawLayoutSegments =
    Array.isArray(state.layoutSegments) && state.layoutSegments.length
      ? state.layoutSegments
      : Array.isArray(sourceLayout.segments) && sourceLayout.segments.length
        ? sourceLayout.segments
        : createLayoutSegments(
            manifestDurationMs(source),
            fallbackLayoutFormat,
          );
  const layoutSegments = normalizeLayoutSegments(
    rawLayoutSegments,
    manifestDurationMs(source),
    fallbackLayoutFormat,
  );
  source.layers = {
    ...(source.layers || {}),
    subtitles: cues.length
      ? {
          ...(source.layers?.subtitles || {}),
          captions: nextTrack.captions,
          cues,
          style:
            state.subtitleStyle ||
            source.layers?.subtitles?.style ||
            DEFAULT_SUBTITLE_STYLE,
          language:
            state.subtitleLanguage ||
            source.layers?.subtitles?.language ||
            "en",
        }
      : null,
    hook: persistedHook,
    layout: {
      ...sourceLayout,
      format: sourceLayout.format || fallbackLayoutFormat,
      segments: layoutSegments,
    },
  };
  return source;
};

export default function FullScreenEditor({
  isOpen = true,
  jobId,
  clipIndex,
  clip = {},
  masterDuration = null,
  initialVersion = null,
  initialVersionId = null,
  initialManifest = null,
  onClose,
  onClipInfoChange = null,
  onRendered,
  onVersionChange,
  editorActions = null,
  onSessionReady,
}) {
  const clipManifest = manifestWithClipLayout(manifestFromClip(clip), clip);
  const editorPreferences = useMemo(() => readEditorPreferences(), []);
  const [version, setVersion] = useState(initialVersion);
  const [manifest, setManifest] = useState(() =>
    manifestWithClipLayout(initialManifest, clip),
  );
  const [publishingMetadata, setPublishingMetadata] = useState(() =>
    publishingMetadataFrom(initialManifest, clip),
  );
  const publishingMetadataRef = useRef(publishingMetadata);
  useEffect(() => {
    publishingMetadataRef.current = publishingMetadata;
  }, [publishingMetadata]);
  const [versions, setVersions] = useState(
    initialVersion ? [initialVersion] : [],
  );
  const [renderCompleteNotice, setRenderCompleteNotice] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState(
    defaultSubtitleTrackId(initialManifest),
  );
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(() => isOpen && !initialManifest);
  const [error, setError] = useState(null);
  const [localDraft, setLocalDraft] = useState(() =>
    manifestToLocalEditorState(
      manifestWithClipLayout(initialManifest || clipManifest, clip),
      defaultSubtitleTrackId(initialManifest),
      clip?.viral_hook_text,
      clip?.layout_format || "standard",
      editorPreferences,
    ),
  );
  const [localDraftRevision, setLocalDraftRevision] = useState(0);
  const [renderSpecDirty, setRenderSpecDirty] = useState(false);
  const [detectedSourceDimensions, setDetectedSourceDimensions] = useState(() =>
    normalizeSourceDimensions({
      width: clip.source_width,
      height: clip.source_height,
    }),
  );
  const localDraftRef = useRef(localDraft);
  const versionRef = useRef(version);
  const activeTrackIdRef = useRef(activeTrackId);
  const versionManifestRef = useRef(null);
  const pendingHashtagMetadataRef = useRef(null);
  const handleLocalDraftChange = useCallback((nextDraft) => {
    localDraftRef.current = nextDraft;
    setLocalDraft(nextDraft);
    setRenderSpecDirty(true);
  }, []);
  const applyGeneratedClipInfoToDraft = useCallback((clipInfo) => {
    const hookText = String(clipInfo?.viral_hook_text || "").trim();
    if (!hookText) return;
    const currentDraft = localDraftRef.current;
    const nextHook = currentDraft?.hook
      ? { ...currentDraft.hook, text: hookText }
      : { text: hookText };
    const nextDraft = { ...currentDraft, hook: nextHook };
    localDraftRef.current = nextDraft;
    setLocalDraft(nextDraft);
    setLocalDraftRevision((current) => current + 1);
    setRenderSpecDirty(true);
  }, []);
  const fallbackFps = Number(clip.output_fps) || 30;

  const hydrateManifest = useCallback(
    async (baseManifest) => {
      if (!jobId) return baseManifest;
      const clipStart = Number(clip?.start);
      const clipEnd = Number(clip?.end);
      const trimStart = Number(baseManifest?.timeline?.trim?.start_sec);
      const trimEnd = Number(baseManifest?.timeline?.trim?.end_sec);
      const hasClipRange =
        Number.isFinite(clipStart) && Number.isFinite(clipEnd);
      const rangeChanged =
        hasClipRange &&
        (!Number.isFinite(trimStart) ||
          !Number.isFinite(trimEnd) ||
          Math.abs(trimStart - clipStart) > 0.001 ||
          Math.abs(trimEnd - clipEnd) > 0.001);
      const applyTranscript = (transcript) =>
        rangeChanged
          ? manifestWithRefreshedSourceRange(
              baseManifest,
              { startSec: clipStart, endSec: clipEnd },
              transcript,
            )
          : manifestWithTranscriptCaptions(baseManifest, transcript);
      if (
        !rangeChanged &&
        (baseManifest?.subtitle_tracks_disabled === true ||
          hasSubtitleTrackContent(baseManifest))
      )
        return baseManifest;
      try {
        const response = await fetch(
          getApiUrl(`/api/clip/${jobId}/${clipIndex}/transcript`),
        );
        if (!response.ok) return applyTranscript(null);
        const transcript = await response.json();
        return applyTranscript(transcript);
      } catch {
        return applyTranscript(null);
      }
    },
    [clip?.end, clip?.start, clipIndex, jobId],
  );

  useEffect(() => {
    if (!isOpen || initialManifest) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const load = async () => {
      const historyResponse = await fetch(
        getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions`),
      );
      const history = await historyResponse.json();
      const currentId =
        initialVersionId ||
        history.current_version_id ||
        history.versions?.at(-1)?.version_id;
      let payload;
      if (currentId && !initialVersionId) {
        try {
          const masterResponse = await fetch(
            getApiUrl(`/api/clip/${jobId}/${clipIndex}/manifest`),
          );
          if (masterResponse.ok) {
            const masterPayload = await masterResponse.json();
            if (masterPayload.master_current === false) payload = masterPayload;
          }
        } catch {
          // Fall back to the generated version when the master manifest is unavailable.
        }
      }
      if (!payload && currentId) {
        const versionResponse = await fetch(
          getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/${currentId}`),
        );
        payload = await versionResponse.json();
        if (!versionResponse.ok)
          throw new Error(payload.detail || "Unable to load version");
      } else {
        const manifestResponse = await fetch(
          getApiUrl(`/api/clip/${jobId}/${clipIndex}/manifest`),
        );
        if (manifestResponse.ok) {
          payload = await manifestResponse.json();
        } else if (manifestResponse.status === 404) {
          payload = { manifest: manifestFromClip(clip) };
        } else {
          return;
        }
      }
      if (cancelled) return;
      const hydratedManifest = manifestWithClipLayout(
        await hydrateManifest(payload.manifest),
        clip,
      );
      if (cancelled) return;
      setVersions(history.versions || []);
      const nextVersion = payload.version || null;
      const nextTrackId = defaultSubtitleTrackId(hydratedManifest);
      const nextDraft = manifestToLocalEditorState(
        hydratedManifest,
        nextTrackId,
        clip?.viral_hook_text,
        clip?.layout_format || "standard",
        editorPreferences,
      );
      versionRef.current = nextVersion;
      activeTrackIdRef.current = nextTrackId;
      localDraftRef.current = nextDraft;
      setVersion(nextVersion);
      setManifest(hydratedManifest);
      setPublishingMetadata(publishingMetadataFrom(hydratedManifest, clip));
      setActiveTrackId(nextTrackId);
      setLocalDraft(nextDraft);
      setLocalDraftRevision((current) => current + 1);
    };
    load()
      .catch((loadError) => {
        if (!cancelled)
          setError(loadError.message || "Unable to load the editor");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    clip,
    clip.output_fps,
    clipIndex,
    hydrateManifest,
    initialManifest,
    isOpen,
    initialVersionId,
    jobId,
    editorPreferences,
  ]);

  const currentMasterVideoUrl = resolveLocalEditorSourceUrl({
    clip,
    projectManifest: manifest || initialManifest,
  });
  const { url: refreshedMasterVideoUrl } = useRenewableMediaUrl(
    currentMasterVideoUrl,
  );

  const currentManifest = useMemo(
    () => ({
      ...manifestWithClipLayout(
        manifest || initialManifest || clipManifest,
        clip,
      ),
      active_subtitle_track_id: activeTrackId || null,
      publishing_metadata: publishingMetadata,
    }),
    [
      activeTrackId,
      clip,
      clipManifest,
      initialManifest,
      manifest,
      publishingMetadata,
    ],
  );
  const projectManifest = useMemo(() => {
    const layout =
      currentManifest.layers?.layout ||
      (currentManifest.export_policy?.layout_format
        ? {
            format: currentManifest.export_policy.layout_format,
            facecam_size: currentManifest.export_policy.facecam_size,
          }
        : {
            format: clip.layout_format || "standard",
            facecam_size: clip.facecam_size || "medium",
          });
    return localEditorStateToManifest(
      {
        ...currentManifest,
        layers: { ...(currentManifest.layers || {}), layout },
      },
      localDraft,
      activeTrackId,
    );
  }, [
    activeTrackId,
    clip.facecam_size,
    clip.layout_format,
    currentManifest,
    localDraft,
  ]);
  const masterSourceVideoUrl = resolveMasterVideoUrl(clip);
  // Always render the editable timeline from the original master. Generated
  // source_clip files already contain a baked layout and cannot switch back
  // to Standard when a timeline segment changes layout.
  const projectVideoUrl =
    refreshedMasterVideoUrl ||
    masterSourceVideoUrl ||
    currentMasterVideoUrl ||
    "";
  const projectManifestForRender = useMemo(
    () => ({
      ...projectManifest,
      timeline: {
        ...(projectManifest.timeline || {}),
        source_video_url: projectVideoUrl,
      },
    }),
    [projectManifest, projectVideoUrl],
  );
  const projectInputProps = useMemo(
    () => ({
      ...manifestToRenderProps(projectManifestForRender, {
        activeSubtitleTrackId: activeTrackId,
      }),
      videoUrl: projectVideoUrl,
    }),
    [activeTrackId, projectManifestForRender, projectVideoUrl],
  );
  const projectSourceDimensions = useMemo(
    () =>
      normalizeSourceDimensions({
        width:
          projectInputProps.layout?.source_width ??
          clip.source_width ??
          detectedSourceDimensions?.width,
        height:
          projectInputProps.layout?.source_height ??
          clip.source_height ??
          detectedSourceDimensions?.height,
      }),
    [
      clip.source_height,
      clip.source_width,
      detectedSourceDimensions?.height,
      detectedSourceDimensions?.width,
      projectInputProps.layout?.source_height,
      projectInputProps.layout?.source_width,
    ],
  );
  const handleSourceDimensionsChange = useCallback((dimensions) => {
    const normalized = normalizeSourceDimensions(dimensions);
    if (!normalized) return;
    setDetectedSourceDimensions((current) =>
      current?.width === normalized.width &&
      current?.height === normalized.height
        ? current
        : normalized,
    );
  }, []);
  const requestProjectFaceTracking = useCallback(
    async (segment) => {
      const clipStartSeconds = Number(
        projectManifest.timeline?.trim?.start_sec ?? clip.start ?? 0,
      );
      const sourceWidth = projectSourceDimensions?.width;
      const sourceHeight = projectSourceDimensions?.height;
      if (!sourceWidth || !sourceHeight)
        throw new Error("Source dimensions are not ready for face tracking.");
      return requestFaceTracking({
        jobId,
        clipIndex,
        startSeconds: clipStartSeconds + Number(segment.startMs || 0) / 1000,
        endSeconds: clipStartSeconds + Number(segment.endMs || 0) / 1000,
        sourceWidth,
        sourceHeight,
      });
    },
    [
      clip.start,
      clipIndex,
      jobId,
      projectSourceDimensions,
      projectManifest.timeline?.trim?.start_sec,
    ],
  );
  const fallbackDurationSeconds = Math.max(
    1,
    Number(projectManifest.timeline?.trim?.end_sec || 0) -
      Number(projectManifest.timeline?.trim?.start_sec || 0),
    Number(clip.duration) || 0,
  );
  const fallbackRenderSpec = useMemo(
    () => ({
      video_start_seconds: Math.max(
        0,
        Number(projectInputProps.videoStartSeconds) || 0,
      ),
      duration_in_frames: Math.max(
        1,
        Math.round(fallbackDurationSeconds * fallbackFps),
      ),
      fps: fallbackFps,
      width: Math.round(Number(clip.output_width) || 1080),
      height: Math.round(Number(clip.output_height) || 1920),
      video_fit:
        projectManifest.render_spec?.video_fit === "contain"
          ? "contain"
          : "cover",
    }),
    [
      clip.output_height,
      clip.output_width,
      fallbackDurationSeconds,
      fallbackFps,
      projectInputProps.videoStartSeconds,
      projectManifest.render_spec?.video_fit,
    ],
  );
  const selectedRenderSpec =
    !renderSpecDirty && normalizeRenderSpec(projectManifest.render_spec)
      ? {
          ...normalizeRenderSpec(projectManifest.render_spec),
          // Older versions may have stored 0 here because they rendered a
          // generated clip. The master source must use the clip's trim start.
          video_start_seconds: projectInputProps.videoStartSeconds,
        }
      : fallbackRenderSpec;
  const selectedRenderProps = renderSpecToProps(selectedRenderSpec);
  const durationSeconds =
    selectedRenderSpec.duration_in_frames / selectedRenderSpec.fps;
  const versionManifest = useMemo(
    () => ({
      ...projectManifestForRender,
      active_subtitle_track_id: activeTrackId,
    }),
    [activeTrackId, projectManifestForRender],
  );
  useEffect(() => {
    versionManifestRef.current = versionManifest;
  }, [versionManifest]);
  const ensureFaceTrackingCaches = useCallback(async () => {
    const draft = localDraftRef.current || {};
    const segments = Array.isArray(draft.layoutSegments)
      ? draft.layoutSegments
      : [];
    const clipStartSeconds = Number(
      projectManifest.timeline?.trim?.start_sec ?? clip.start ?? 0,
    );
    const sourceWidth = projectSourceDimensions?.width;
    const sourceHeight = projectSourceDimensions?.height;
    if (
      segments.some(
        (segment) =>
          segment.format === "standard" &&
          segment.face_tracking_enabled === true,
      ) &&
      (!Number.isFinite(clipStartSeconds) || !sourceWidth || !sourceHeight)
    )
      throw new Error("Source dimensions are not ready for face tracking.");

    let changed = false;
    const nextSegments = [];
    for (const segment of segments) {
      if (
        segment.format !== "standard" ||
        segment.face_tracking_enabled !== true
      ) {
        nextSegments.push(segment);
        continue;
      }
      const durationMs = Math.max(1, segment.endMs - segment.startMs);
      const sourceStartSeconds =
        clipStartSeconds + Number(segment.startMs || 0) / 1000;
      const sourceEndSeconds =
        clipStartSeconds + Number(segment.endMs || 0) / 1000;
      const cached = normalizeFaceTrackingCache(segment.face_tracking_cache, {
        durationMs,
        sourceStartSeconds,
        sourceEndSeconds,
        sourceWidth,
        sourceHeight,
      });
      if (cached) {
        nextSegments.push({ ...segment, face_tracking_cache: cached });
        continue;
      }
      const response = await requestProjectFaceTracking(segment);
      const cache = normalizeFaceTrackingCache(response, {
        durationMs,
        sourceStartSeconds,
        sourceEndSeconds,
        sourceWidth,
        sourceHeight,
      });
      if (!cache) throw new Error("Face tracking returned an invalid cache.");
      changed = true;
      nextSegments.push({
        ...segment,
        face_tracking_enabled: true,
        face_tracking_cache: cache,
      });
    }
    if (changed) {
      const nextDraft = { ...draft, layoutSegments: nextSegments };
      localDraftRef.current = nextDraft;
      setLocalDraft(nextDraft);
      setLocalDraftRevision((current) => current + 1);
      setRenderSpecDirty(true);
    }
    return localDraftRef.current;
  }, [
    clip.start,
    projectSourceDimensions,
    projectManifest.timeline?.trim?.start_sec,
    requestProjectFaceTracking,
  ]);
  const getLatestVersionPayload = useCallback(() => {
    const trackId = activeTrackIdRef.current || activeTrackId;
    const baseManifest = versionManifestRef.current || versionManifest;
    const layout =
      baseManifest.layers?.layout ||
      (baseManifest.export_policy?.layout_format
        ? {
            format: baseManifest.export_policy.layout_format,
            facecam_size: baseManifest.export_policy.facecam_size,
          }
        : {
            format: clip.layout_format || "standard",
            facecam_size: clip.facecam_size || "medium",
          });
    const latestManifest = {
      ...localEditorStateToManifest(
        {
          ...baseManifest,
          layers: { ...(baseManifest.layers || {}), layout },
        },
        localDraftRef.current,
        trackId,
      ),
      timeline: {
        ...(baseManifest.timeline || {}),
        source_video_url: projectVideoUrl,
      },
      active_subtitle_track_id: trackId,
    };
    const renderProps = manifestToRenderProps(latestManifest, {
      activeSubtitleTrackId: trackId,
    });
    const latestRenderSpec =
      !renderSpecDirty && normalizeRenderSpec(baseManifest.render_spec)
        ? {
            ...normalizeRenderSpec(baseManifest.render_spec),
            video_start_seconds: renderProps.videoStartSeconds,
          }
        : {
            video_start_seconds: Math.max(
              0,
              Number(renderProps.videoStartSeconds) || 0,
            ),
            duration_in_frames: Math.max(
              1,
              Math.round(fallbackDurationSeconds * fallbackFps),
            ),
            fps: fallbackFps,
            width: Math.round(Number(clip.output_width) || 1080),
            height: Math.round(Number(clip.output_height) || 1920),
            video_fit:
              normalizeRenderSpec(baseManifest.render_spec)?.video_fit ||
              "cover",
          };
    latestManifest.render_spec = latestRenderSpec;
    return {
      manifest: latestManifest,
      props: {
        ...renderProps,
        videoUrl: projectVideoUrl,
        ...renderSpecToProps(latestRenderSpec),
      },
    };
  }, [
    activeTrackId,
    clip.facecam_size,
    clip.layout_format,
    clip.output_height,
    clip.output_width,
    fallbackDurationSeconds,
    fallbackFps,
    projectVideoUrl,
    renderSpecDirty,
    versionManifest,
  ]);
  const previewVideoUrl = projectVideoUrl;
  const previewVideoStartSeconds = selectedRenderProps.videoStartSeconds;
  const localEditorPreviewUrl = useMemo(() => {
    return refreshedMasterVideoUrl || masterSourceVideoUrl || projectVideoUrl;
  }, [projectVideoUrl, refreshedMasterVideoUrl, masterSourceVideoUrl]);
  const currentManifestRef = useRef(currentManifest);
  useEffect(() => {
    currentManifestRef.current = projectManifest;
  }, [projectManifest]);
  useEffect(() => {
    versionRef.current = version;
    activeTrackIdRef.current = activeTrackId;
  }, [activeTrackId, version]);

  const replaceManifest = useCallback(
    (nextManifest, nextTrackId, { dirty = false } = {}) => {
      const trackId = nextTrackId || defaultSubtitleTrackId(nextManifest);
      const hydratedManifest = manifestWithClipLayout(nextManifest, clip);
      const nextDraft = manifestToLocalEditorState(
        hydratedManifest,
        trackId,
        clip?.viral_hook_text,
        clip?.layout_format || "standard",
        editorPreferences,
      );
      currentManifestRef.current = hydratedManifest;
      activeTrackIdRef.current = trackId;
      localDraftRef.current = nextDraft;
      setManifest(hydratedManifest);
      setActiveTrackId(trackId);
      setLocalDraft(nextDraft);
      setLocalDraftRevision((current) => current + 1);
      setRenderSpecDirty(dirty);
    },
    [clip, editorPreferences],
  );

  const applyLayer = useCallback(
    (type, value) => {
      const base = currentManifestRef.current;
      const next = {
        ...base,
        layers: { ...(base.layers || {}), [type]: value },
      };
      if (type === "subtitles" && value) {
        const trackId =
          activeTrackIdRef.current ||
          base.subtitle_tracks?.[0]?.id ||
          "original";
        const existingTracks = base.subtitle_tracks || [];
        const existing = existingTracks.find(
          (track) => track.id === trackId,
        ) || {
          id: trackId,
          language: "und",
          label: "Original",
          origin: "manual",
        };
        const cues = (value.captions || []).map((caption) => ({
          text: caption.text || "",
          startMs: Number(caption.startMs || 0),
          endMs: Number(caption.endMs || caption.startMs || 0),
          captions: [{ ...caption }],
        }));
        next.subtitle_tracks = [
          ...existingTracks.filter((track) => track.id !== trackId),
          {
            ...existing,
            cues,
            captions: cues.flatMap((cue) => cue.captions),
            style: value.style || existing.style,
          },
        ];
        next.active_subtitle_track_id = trackId;
      }
      replaceManifest(next, next.active_subtitle_track_id, { dirty: true });
    },
    [replaceManifest],
  );
  const setSourceVideo = useCallback(
    (url) => {
      if (!url) return;
      const base = currentManifestRef.current;
      const next = {
        ...base,
        timeline: { ...(base.timeline || {}), source_video_url: url },
      };
      replaceManifest(next, activeTrackIdRef.current, { dirty: true });
    },
    [replaceManifest],
  );
  const loadVersion = async (nextVersion) => {
    if (!nextVersion?.version_id) return;
    try {
      const response = await fetch(
        getApiUrl(
          `/api/clip/${jobId}/${clipIndex}/versions/${nextVersion.version_id}`,
        ),
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.detail || "Unable to load version");
      const hydratedManifest = await hydrateManifest(payload.manifest);
      const loadedVersion = payload.version || nextVersion;
      versionRef.current = loadedVersion;
      setVersion(loadedVersion);
      onVersionChange?.(payload.version?.version_id || nextVersion.version_id);
      setPublishingMetadata(publishingMetadataFrom(hydratedManifest, clip));
      replaceManifest(hydratedManifest);
    } catch {
      /* keep the current draft active when a historical version cannot be loaded */
    }
  };
  const branchVersion = async (versionId) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/branch`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version_id: versionId,
            manifest: projectManifest,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Branch failed.");
      const hydratedManifest = await hydrateManifest(payload.manifest);
      versionRef.current = payload.version;
      setVersion(payload.version);
      onVersionChange?.(payload.version?.version_id);
      setPublishingMetadata(publishingMetadataFrom(hydratedManifest, clip));
      replaceManifest(hydratedManifest);
    } catch (branchError) {
      setError(branchError.message);
    } finally {
      setBusy(false);
    }
  };
  const deleteVersion = async (versionId) => {
    if (!window.confirm(`Delete version ${versionId.slice(0, 8)}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/${versionId}`),
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Delete failed.");

      const remainingVersions = versions.filter(
        (candidate) => candidate.version_id !== versionId,
      );
      setVersions(remainingVersions);
      const nextVersionId =
        payload.current_version_id || remainingVersions.at(-1)?.version_id;
      if (nextVersionId) {
        await loadVersion(
          remainingVersions.find(
            (candidate) => candidate.version_id === nextVersionId,
          ) || { version_id: nextVersionId },
        );
      } else {
        setVersion(null);
        setManifest(null);
        setRenderSpecDirty(false);
        setPublishingMetadata(publishingMetadataFrom(null, clip));
      }
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  };
  const saveVersion = useCallback(
    async (metadataOverride = null) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const { manifest: latestManifest } = getLatestVersionPayload();
        const manifestToSave = metadataOverride
          ? { ...latestManifest, publishing_metadata: metadataOverride }
          : latestManifest;
        const result = await saveDraftVersion({
          jobId,
          clipIndex,
          manifest: manifestToSave,
          parentVersionId: versionRef.current?.version_id,
        });
        const nextVersion = result.version || {
          version_id: result.versionId,
          status: "pending",
        };
        if (!nextVersion?.version_id)
          throw new Error("Saved version did not return a version id.");
        setVersions((current) => [
          ...current.filter(
            (candidate) => candidate.version_id !== nextVersion.version_id,
          ),
          nextVersion,
        ]);
        setRenderCompleteNotice(false);
        versionRef.current = nextVersion;
        setVersion(nextVersion);
        setManifest(result.manifest || manifestToSave);
        setRenderSpecDirty(false);
        onVersionChange?.(nextVersion.version_id);
      } catch (saveError) {
        setError(saveError.message || "Could not save the new version.");
      } finally {
        setBusy(false);
      }
    },
    [busy, clipIndex, getLatestVersionPayload, jobId, onVersionChange],
  );

  useEffect(() => {
    if (busy || !pendingHashtagMetadataRef.current) return;
    const pendingMetadata = pendingHashtagMetadataRef.current;
    pendingHashtagMetadataRef.current = null;
    void saveVersion(pendingMetadata);
  }, [busy, saveVersion]);

  const persistProjectClipHashtags = useCallback(
    async (hashtags) => {
      const response = await fetch(
        getApiUrl(
          `/api/projects/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/metadata`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hashtags }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Could not save hashtags.");
      }
    },
    [clipIndex, jobId],
  );

  const persistProjectClipInfo = useCallback(
    async (clipInfo) => {
      const response = await fetch(
        getApiUrl(
          `/api/projects/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/metadata`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(clipInfo),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Could not save clip information.");
      }
    },
    [clipIndex, jobId],
  );

  const saveGeneratedHashtags = useCallback(
    async (hashtags) => {
      const nextMetadata = { ...publishingMetadataRef.current, hashtags };
      publishingMetadataRef.current = nextMetadata;
      setPublishingMetadata(nextMetadata);
      if (versionManifestRef.current) {
        versionManifestRef.current = {
          ...versionManifestRef.current,
          publishing_metadata: nextMetadata,
        };
      }
      if (currentManifestRef.current) {
        currentManifestRef.current = {
          ...currentManifestRef.current,
          publishing_metadata: nextMetadata,
        };
      }
      try {
        await persistProjectClipHashtags(hashtags);
        if (busy) {
          pendingHashtagMetadataRef.current = nextMetadata;
          return;
        }
        await saveVersion(nextMetadata);
      } catch (saveError) {
        setError(saveError.message || "Could not save hashtags.");
      }
    },
    [busy, persistProjectClipHashtags, saveVersion],
  );

  const saveGeneratedClipInfo = useCallback(
    async (clipInfo) => {
      try {
        await persistProjectClipInfo(clipInfo);
        applyGeneratedClipInfoToDraft(clipInfo);
        onClipInfoChange?.(clipInfo);
      } catch (saveError) {
        setError(saveError.message || "Could not save clip information.");
      }
    },
    [applyGeneratedClipInfoToDraft, onClipInfoChange, persistProjectClipInfo],
  );

  const exportVersion = useCallback(
    async ({ onProgress = () => {} } = {}) => {
      if (busy) return null;
      setBusy(true);
      setError(null);
      try {
        await ensureFaceTrackingCaches();
        const { manifest: manifestToRender, props: renderProps } =
          getLatestVersionPayload();
        const result = await saveAndRenderVersion({
          jobId,
          clipIndex,
          manifest: manifestToRender,
          versionId: versionRef.current?.version_id,
          props: renderProps,
          onProgress,
        });
        if (result.status !== "done")
          throw new Error(result.error || "Render failed.");
        const outputUrl = result.outputUrl?.startsWith("http")
          ? result.outputUrl
          : getApiUrl(result.outputUrl);
        const nextVersion = result.version || {
          version_id: result.versionId,
          status: "done",
          output_url: outputUrl,
        };
        if (!nextVersion?.version_id)
          throw new Error("Render completed without a version id.");
        setVersions((current) => [
          ...current.filter(
            (candidate) => candidate.version_id !== nextVersion.version_id,
          ),
          nextVersion,
        ]);
        setRenderCompleteNotice(true);
        versionRef.current = nextVersion;
        setVersion(nextVersion);
        setManifest(manifestToRender);
        setRenderSpecDirty(false);
        onVersionChange?.(nextVersion.version_id);
        onRendered?.(outputUrl);
        return outputUrl;
      } catch (exportError) {
        setError(exportError.message || "Render failed.");
        throw exportError;
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      clipIndex,
      ensureFaceTrackingCaches,
      getLatestVersionPayload,
      jobId,
      onRendered,
      onVersionChange,
    ],
  );

  useEffect(() => {
    if (!isOpen || !onSessionReady) return undefined;
    onSessionReady({
      applyLayer,
      setSourceVideo,
      export: exportVersion,
      save: saveVersion,
      getManifest: () => currentManifestRef.current,
    });
    return () => onSessionReady(null);
  }, [
    applyLayer,
    currentManifest,
    exportVersion,
    isOpen,
    onSessionReady,
    saveVersion,
    setSourceVideo,
  ]);

  if (!isOpen) return null;
  if (isLoading && !initialManifest && !manifest) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0d0d0f] text-white"
        role="status"
        aria-label="Loading editor"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3 text-zinc-300">
          <Loader2
            className="h-8 w-8 animate-spin text-cyan-300"
            aria-hidden="true"
          />
          <span className="text-sm">Loading editor...</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 z-[60] bg-background text-white"
      data-testid="full-screen-editor"
    >
      <LocalEditorTab
        initialVideoUrl={localEditorPreviewUrl}
        initialExportVideoUrl={
          refreshedMasterVideoUrl || masterSourceVideoUrl || projectVideoUrl
        }
        initialVideoName={`clip-${Number(clipIndex) + 1}.mp4`}
        initialProjectId={jobId}
        initialClipIndex={clipIndex}
        onExport={exportVersion}
        initialPlaybackStartMs={Math.max(
          0,
          selectedRenderSpec.video_start_seconds * 1000,
        )}
        initialPlaybackDurationMs={Math.max(
          1,
          Number(durationSeconds || 0) * 1000,
        )}
        remotionPreviewProps={{
          videoUrl: previewVideoUrl,
          videoStartSeconds: previewVideoStartSeconds,
          durationInSeconds: durationSeconds,
          fps: selectedRenderSpec.fps,
          width: selectedRenderSpec.width,
          height: selectedRenderSpec.height,
          videoFit: selectedRenderSpec.video_fit,
          subtitles: projectInputProps.subtitles,
          subtitleTracks: projectInputProps.subtitleTracks,
          activeSubtitleTrackId: projectInputProps.activeSubtitleTrackId,
          layout: projectInputProps.layout,
          hook: projectInputProps.hook,
          effects: projectInputProps.effects,
          onSourceDimensionsChange: handleSourceDimensionsChange,
        }}
        initialEditorState={localDraft}
        initialStateKey={`${version?.version_id || "draft"}:${projectInputProps.videoUrl || "pending"}:${localDraftRevision}`}
        masterDuration={masterDuration}
        clipMetadata={{ ...clip, hashtags: publishingMetadata.hashtags }}
        onHashtagsChange={saveGeneratedHashtags}
        onClipInfoChange={saveGeneratedClipInfo}
        onStateChange={handleLocalDraftChange}
        onFaceTracking={requestProjectFaceTracking}
        faceTrackingReady={Boolean(projectSourceDimensions)}
        persistHistory={false}
        allowLocalUpload={false}
        onClose={onClose}
        headerActions={
          <>
            <button
              type="button"
              onClick={() => saveVersion()}
              disabled={busy}
              className="flex items-center gap-1 rounded-md bg-sky-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              {busy ? "Saving..." : "Save as new version"}
            </button>
            {error && (
              <span className="text-xs text-red-300" role="alert">
                {error}
              </span>
            )}
          </>
        }
        sidePanel={
          editorActions ? <EditorActionToolbar {...editorActions} /> : null
        }
        versionHistoryPanel={
          <VersionHistory
            versions={versions}
            currentVersionId={version?.version_id}
            selectedVersionId={version?.version_id}
            onSelect={loadVersion}
            onBranch={branchVersion}
            onDelete={deleteVersion}
            getVersionPreviewUrl={(versionId) =>
              getApiUrl(
                `/api/clip/${jobId}/${clipIndex}/versions/${versionId}/preview`,
              )
            }
            renderCompleteNotice={renderCompleteNotice}
            onOpen={() => setRenderCompleteNotice(false)}
          />
        }
      />
    </div>
  );
}
