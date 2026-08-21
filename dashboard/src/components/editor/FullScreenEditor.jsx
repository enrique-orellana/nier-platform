import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Download, X, Save } from "lucide-react";
import { getApiUrl } from "../../config";
import RemotionPreview from "../RemotionPreview";
import {
  manifestToEditorState,
  editorStateToManifest,
  manifestWithTranscriptCaptions,
  manifestWithRefreshedSourceRange,
  manifestToRenderProps,
} from "../../editor/designcomboAdapter";
import { createSubtitleCue } from "../../editor/timelineModel";
import TransportControls from "./TransportControls";
import VersionHistory from "./VersionHistory";
import DesignComboTimeline from "./DesignComboTimeline";
import MediaPool from "./MediaPool";
import InspectorPanel from "./InspectorPanel";
import SubtitleTranslationPanel from "../SubtitleTranslationPanel";
import {
  saveDraftVersion,
  saveAndRenderVersion,
} from "../../editor/renderVersion";
import EditorActionToolbar from "./EditorActionToolbar";
import LocalEditorTab from "../local-editor/LocalEditorTab";
import { DEFAULT_SUBTITLE_STYLE } from "../local-editor/localEditorStyles";
import { formatClock } from "../local-editor/localEditorExport";
import { HOOK_FONT_FAMILY } from "../../remotion/lib/hookVisual";
import { resolvePreviewStartSeconds } from "../../lib/videoUrls";
import { resolveLocalEditorSourceUrl } from "./fullScreenEditorSource";

const proxyUrl = (url) => {
  return url;
};

const PRESIGNED_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const parseAmzDate = (value) => {
  const match = String(value || "").match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );
  if (!match) return NaN;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
};

const shouldRefreshPresignedVideoUrl = (url) => {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    const signedAt = parsed.searchParams.get("X-Amz-Date");
    const expiresInSeconds = parsed.searchParams.get("X-Amz-Expires");
    if (!signedAt && expiresInSeconds === null && /^https?:\/\//i.test(url))
      return false;

    const expiresAt = parseAmzDate(signedAt) + Number(expiresInSeconds) * 1000;
    if (!Number.isFinite(expiresAt)) return true;
    return Date.now() >= expiresAt - PRESIGNED_URL_REFRESH_BUFFER_MS;
  } catch {
    return true;
  }
};

const isPresignedVideoUrl = (url) => {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return Boolean(
      parsed.searchParams.get("X-Amz-Date") ||
      parsed.searchParams.get("X-Amz-Expires") !== null,
    );
  } catch {
    return false;
  }
};

const videoPath = (url) => {
  if (!url) return "";
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return String(url).split("?")[0].split("#")[0];
  }
};

const generatedClipVideoUrl = (clip, projectManifest) => {
  const candidate = clip?.video_url || clip?.url || "";
  if (!candidate) return "";
  const sourcePaths = [
    clip?.source_video_url,
    clip?.original_video_url,
    projectManifest?.timeline?.source_video_url,
  ]
    .map(videoPath)
    .filter(Boolean);
  if (!sourcePaths.length) return candidate;
  return sourcePaths.includes(videoPath(candidate)) ? "" : candidate;
};

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
      source_video_url: clip.source_video_url || clip.video_url || "",
      trim: { start_sec: startSec, end_sec: endSec },
    },
    layers: {},
    subtitle_tracks: [],
  };
};

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

const localCuesFromTrack = (track) => {
  const cues = Array.isArray(track?.cues) ? track.cues : [];
  const captions = Array.isArray(track?.captions) ? track.captions : [];
  return (cues.length ? cues : captions).map((cue, index) => ({
    id: cue.id || `${track?.id || "subtitle"}-${index}`,
    type: "subtitle",
    label: cue.text || cue.captions?.map((word) => word.text).join(" ") || "",
    text: cue.text || cue.captions?.map((word) => word.text).join(" ") || "",
    startMs: Number(cue.startMs || 0),
    endMs: Number(cue.endMs || cue.startMs || 0),
    captions: Array.isArray(cue.captions) ? cue.captions : undefined,
  }));
};

const manifestToLocalEditorState = (sourceManifest, trackId) => {
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
  const hook = source.layers?.hook;
  return {
    subtitleCues: localCuesFromTrack(activeTrack),
    subtitleStyle:
      activeTrack?.style ||
      source.layers?.subtitles?.style ||
      DEFAULT_SUBTITLE_STYLE,
    subtitleLanguage:
      activeTrack?.language || source.layers?.subtitles?.language || "en",
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
        }
      : null,
  };
};

const localEditorStateToManifest = (sourceManifest, localState, trackId) => {
  const source = JSON.parse(JSON.stringify(sourceManifest || {}));
  const state = localState || manifestToLocalEditorState(source, trackId);
  const nextTrackId = trackId || "original";
  const existingTracks = Array.isArray(source.subtitle_tracks)
    ? source.subtitle_tracks
    : [];
  const existingTrack =
    existingTracks.find((track) => track.id === nextTrackId) || {};
  const cues = (state.subtitleCues || []).map((cue) => ({
    text: cue.text || cue.label || "",
    startMs: Math.round(Number(cue.startMs || 0)),
    endMs: Math.round(Number(cue.endMs || cue.startMs || 0)),
    ...(Array.isArray(cue.captions) && cue.captions.length
      ? { captions: cue.captions }
      : {}),
  }));
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
    hook: state.hook
      ? {
          ...(source.layers?.hook || {}),
          ...state.hook,
          startMs: Math.round(Number(state.hook.startMs || 0)),
          endMs: Math.round(Number(state.hook.endMs || 0)),
          displayDurationSec: Math.max(
            0.001,
            (Number(state.hook.endMs || 0) - Number(state.hook.startMs || 0)) /
              1000,
          ),
        }
      : null,
  };
  return source;
};

export default function FullScreenEditor({
  isOpen = true,
  jobId,
  clipIndex,
  clip = {},
  initialVersion = null,
  initialVersionId = null,
  initialManifest = null,
  onClose,
  onRendered,
  onVersionChange,
  editorActions = null,
  onSessionReady,
  useLocalEditor = false,
}) {
  const [version, setVersion] = useState(initialVersion);
  const [manifest, setManifest] = useState(initialManifest);
  const [publishingMetadata, setPublishingMetadata] = useState(() =>
    publishingMetadataFrom(initialManifest, clip),
  );
  const [versions, setVersions] = useState(
    initialVersion ? [initialVersion] : [],
  );
  const [renderCompleteNotice, setRenderCompleteNotice] = useState(false);
  const [editorState, setEditorState] = useState(() =>
    manifestToEditorState(initialManifest || manifestFromClip(clip), {
      fps: clip.output_fps || 30,
    }),
  );
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeTrackId, setActiveTrackId] = useState(
    defaultSubtitleTrackId(initialManifest),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [localDraft, setLocalDraft] = useState(() =>
    manifestToLocalEditorState(
      initialManifest,
      defaultSubtitleTrackId(initialManifest),
    ),
  );
  const [localDraftRevision, setLocalDraftRevision] = useState(0);
  const [refreshedMasterVideoUrl, setRefreshedMasterVideoUrl] = useState("");
  const durationSeconds = editorState.durationSec || 30;
  const fps = editorState.fps || clip.output_fps || 30;

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
    if (!isOpen || initialManifest) return;
    let cancelled = false;
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
      const hydratedManifest = await hydrateManifest(payload.manifest);
      if (cancelled) return;
      setVersions(history.versions || []);
      setVersion(payload.version || null);
      setManifest(hydratedManifest);
      setPublishingMetadata(publishingMetadataFrom(hydratedManifest, clip));
      setEditorState(
        manifestToEditorState(hydratedManifest, { fps: clip.output_fps || 30 }),
      );
      const nextTrackId = defaultSubtitleTrackId(hydratedManifest);
      setActiveTrackId(nextTrackId);
      setLocalDraft(manifestToLocalEditorState(hydratedManifest, nextTrackId));
      setLocalDraftRevision((current) => current + 1);
    };
    load().catch(() => {});
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
  ]);

  const currentMasterVideoUrl =
    clip?.source_video_url || clip?.original_video_url || clip?.video_url;

  useEffect(() => {
    if (!isOpen || !useLocalEditor || !jobId) return undefined;
    if (!shouldRefreshPresignedVideoUrl(currentMasterVideoUrl))
      return undefined;
    let cancelled = false;
    const refreshMasterVideoUrl = async () => {
      try {
        const response = await fetch(
          getApiUrl(
            `/api/projects/clips/${encodeURIComponent(jobId)}?refresh=true`,
          ),
        );
        if (!response.ok) return;
        const payload = await response.json();
        const clips = Array.isArray(payload.clips) ? payload.clips : [];
        const clipPosition = Number(clipIndex);
        const refreshedClip = clips.find(
          (candidate, index) =>
            Number(candidate?.index) === clipPosition || index === clipPosition,
        );
        const nextUrl =
          refreshedClip?.source_video_url ||
          refreshedClip?.original_video_url ||
          "";
        if (!cancelled && nextUrl) setRefreshedMasterVideoUrl(nextUrl);
      } catch {
        // Keep the URL already present in the manifest as a fallback.
      }
    };
    void refreshMasterVideoUrl();
    return () => {
      cancelled = true;
    };
  }, [clipIndex, currentMasterVideoUrl, isOpen, jobId, useLocalEditor]);

  const inputProps = useMemo(() => {
    const nextManifest = editorStateToManifest(
      editorState,
      manifest || initialManifest || {},
    );
    return {
      ...manifestToRenderProps(nextManifest, {
        activeSubtitleTrackId: activeTrackId,
      }),
      videoUrl: proxyUrl(
        nextManifest.timeline?.source_video_url || clip.video_url,
      ),
    };
  }, [activeTrackId, clip.video_url, editorState, initialManifest, manifest]);

  const currentManifest = useMemo(
    () => ({
      ...editorStateToManifest(
        editorState,
        manifest || initialManifest || manifestFromClip(clip),
      ),
      active_subtitle_track_id: activeTrackId || null,
      publishing_metadata: publishingMetadata,
    }),
    [
      activeTrackId,
      clip,
      editorState,
      initialManifest,
      manifest,
      publishingMetadata,
    ],
  );
  const projectManifest = useMemo(() => {
    if (!useLocalEditor) return currentManifest;
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
    useLocalEditor,
  ]);
  const projectInputProps = useMemo(
    () => ({
      ...manifestToRenderProps(projectManifest, {
        activeSubtitleTrackId: activeTrackId,
      }),
      videoUrl: proxyUrl(
        projectManifest.timeline?.source_video_url || clip.video_url,
      ),
    }),
    [activeTrackId, clip.video_url, projectManifest],
  );
  const masterVideoRefreshPending =
    isPresignedVideoUrl(currentMasterVideoUrl) &&
    shouldRefreshPresignedVideoUrl(currentMasterVideoUrl) &&
    !refreshedMasterVideoUrl;
  const projectVideoUrl = refreshedMasterVideoUrl || projectInputProps.videoUrl;
  const versionManifest = useMemo(
    () => ({
      ...projectManifest,
      timeline: useLocalEditor
        ? {
            ...(projectManifest.timeline || {}),
            source_video_url: projectVideoUrl,
          }
        : projectManifest.timeline,
      active_subtitle_track_id: activeTrackId,
    }),
    [activeTrackId, projectManifest, projectVideoUrl, useLocalEditor],
  );
  const versionRenderProps = useMemo(
    () => ({
      ...(useLocalEditor
        ? { ...projectInputProps, videoUrl: projectVideoUrl }
        : inputProps),
      durationInFrames: editorState.durationFrames,
      fps,
      width: clip.output_width || 1080,
      height: clip.output_height || 1920,
    }),
    [
      clip.output_height,
      clip.output_width,
      editorState.durationFrames,
      fps,
      inputProps,
      projectInputProps,
      projectVideoUrl,
      useLocalEditor,
    ],
  );
  const generatedClipUrl = generatedClipVideoUrl(clip, projectManifest);
  const previewVideoUrl =
    generatedClipUrl || (masterVideoRefreshPending ? "" : projectVideoUrl);
  const previewVideoStartSeconds = generatedClipUrl
    ? 0
    : projectInputProps.videoStartSeconds;
  const localEditorPreviewUrl = useMemo(() => {
    if (masterVideoRefreshPending) return "";
    return proxyUrl(
      resolveLocalEditorSourceUrl({
        refreshedMasterVideoUrl,
        clip,
        projectManifest,
      }),
    );
  }, [
    clip,
    masterVideoRefreshPending,
    projectManifest,
    refreshedMasterVideoUrl,
  ]);
  const currentManifestRef = useRef(currentManifest);
  useEffect(() => {
    currentManifestRef.current = currentManifest;
  }, [currentManifest]);
  const subtitleTracks = useMemo(
    () => currentManifest.subtitle_tracks || [],
    [currentManifest],
  );
  const applyLayer = useCallback(
    (type, value) => {
      const base = currentManifestRef.current;
      const next = {
        ...base,
        layers: { ...(base.layers || {}), [type]: value },
      };
      if (type === "subtitles" && value) {
        const trackId = activeTrackId || subtitleTracks[0]?.id || "original";
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
      currentManifestRef.current = next;
      setManifest(next);
      setEditorState(manifestToEditorState(next, { fps }));
      if (type === "subtitles") setActiveTrackId(next.active_subtitle_track_id);
    },
    [activeTrackId, fps, subtitleTracks],
  );
  const setSourceVideo = useCallback(
    (url) => {
      if (!url) return;
      const base = currentManifestRef.current;
      const next = {
        ...base,
        timeline: { ...(base.timeline || {}), source_video_url: url },
      };
      currentManifestRef.current = next;
      setManifest(next);
      setEditorState(manifestToEditorState(next, { fps }));
    },
    [fps],
  );
  const deleteSubtitleTrack = useCallback(
    (trackId) => {
      const base = currentManifestRef.current;
      const nextTracks = (base.subtitle_tracks || []).filter(
        (track) => track.id !== trackId,
      );
      const nextActiveTrackId =
        activeTrackId === trackId
          ? nextTracks.find((track) => track.origin !== "translation")?.id ||
            nextTracks[0]?.id ||
            null
          : activeTrackId;
      const next = {
        ...base,
        subtitle_tracks: nextTracks,
        active_subtitle_track_id: nextActiveTrackId,
      };
      currentManifestRef.current = next;
      setManifest(next);
      setEditorState(manifestToEditorState(next, { fps }));
      setActiveTrackId(nextActiveTrackId);
      setSelectedItem(null);
    },
    [activeTrackId, fps],
  );
  const updateSelectedItem = (nextItem) => {
    if (nextItem.__delete) {
      deleteSelectedItem(nextItem);
      return;
    }
    setSelectedItem(nextItem);
    setEditorState((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) =>
          item.id === nextItem.id ? nextItem : item,
        ),
      })),
    }));
  };
  const deleteSelectedItem = (item) => {
    setEditorState((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track) => ({
        ...track,
        items: track.items.filter((candidate) => candidate.id !== item.id),
      })),
    }));
    setSelectedItem(null);
  };
  const addSubtitleCue = useCallback(() => {
    const subtitleTrack =
      editorState.tracks.find(
        (track) =>
          track.type === "subtitle" &&
          track.id === `subtitles-${activeTrackId}`,
      ) || editorState.tracks.find((track) => track.type === "subtitle");
    if (!subtitleTrack) return;
    const cue = createSubtitleCue({
      playheadMs: Math.round((currentFrame / fps) * 1000),
      durationMs: Math.round(editorState.durationSec * 1000),
      fps,
      existingIds: subtitleTrack.items.map((item) => item.id),
    });
    const selectedCue = { ...cue, trackId: subtitleTrack.id, isNew: true };
    setEditorState((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track) =>
        track.id === subtitleTrack.id
          ? { ...track, items: [...track.items, selectedCue] }
          : track,
      ),
    }));
    setActiveTrackId(subtitleTrack.id.replace(/^subtitles-/, ""));
    setSelectedItem(selectedCue);
  }, [activeTrackId, currentFrame, editorState, fps]);
  useEffect(() => {
    const handleAddSubtitleCue = () => addSubtitleCue();
    window.addEventListener(
      "openshorts:add-subtitle-cue",
      handleAddSubtitleCue,
    );
    return () =>
      window.removeEventListener(
        "openshorts:add-subtitle-cue",
        handleAddSubtitleCue,
      );
  }, [addSubtitleCue]);
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
      setVersion(payload.version || nextVersion);
      onVersionChange?.(payload.version?.version_id || nextVersion.version_id);
      setManifest(hydratedManifest);
      setPublishingMetadata(publishingMetadataFrom(hydratedManifest, clip));
      setEditorState(
        manifestToEditorState(hydratedManifest, { fps: clip.output_fps || 30 }),
      );
      const nextTrackId = defaultSubtitleTrackId(hydratedManifest);
      setActiveTrackId(nextTrackId);
      setLocalDraft(manifestToLocalEditorState(hydratedManifest, nextTrackId));
      setLocalDraftRevision((current) => current + 1);
      setSelectedItem(null);
    } catch {
      /* keep the current draft active when a historical version cannot be loaded */
    }
  };
  const translationPanel = (
    <SubtitleTranslationPanel
      jobId={jobId}
      clipIndex={clipIndex}
      versionId={version?.version_id}
      tracks={subtitleTracks}
      activeTrackId={activeTrackId}
      onSelectTrack={setActiveTrackId}
      onTrackAdded={(track, nextManifest, mergedTracks) => {
        const next = nextManifest || {
          ...currentManifest,
          subtitle_tracks: mergedTracks || [...subtitleTracks, track],
        };
        setManifest(next);
        setEditorState(manifestToEditorState(next, { fps }));
        setActiveTrackId(track?.id || activeTrackId);
      }}
      onTrackRemoved={deleteSubtitleTrack}
    />
  );
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
            manifest: useLocalEditor ? projectManifest : currentManifest,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Branch failed.");
      const hydratedManifest = await hydrateManifest(payload.manifest);
      setVersion(payload.version);
      onVersionChange?.(payload.version?.version_id);
      setManifest(hydratedManifest);
      setPublishingMetadata(publishingMetadataFrom(hydratedManifest, clip));
      setEditorState(manifestToEditorState(hydratedManifest, { fps }));
      const nextTrackId = defaultSubtitleTrackId(hydratedManifest);
      setActiveTrackId(nextTrackId);
      setLocalDraft(manifestToLocalEditorState(hydratedManifest, nextTrackId));
      setLocalDraftRevision((current) => current + 1);
      setSelectedItem(null);
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
        setPublishingMetadata(publishingMetadataFrom(null, clip));
      }
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  };
  const saveVersion = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveDraftVersion({
        jobId,
        clipIndex,
        manifest: versionManifest,
        parentVersionId: version?.version_id,
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
      setVersion(nextVersion);
      setManifest(result.manifest || versionManifest);
      onVersionChange?.(nextVersion.version_id);
    } catch (saveError) {
      setError(saveError.message || "Could not save the new version.");
    } finally {
      setBusy(false);
    }
  }, [busy, clipIndex, jobId, onVersionChange, versionManifest, version]);

  const exportVersion = useCallback(async () => {
    if (busy) return null;
    setBusy(true);
    setError(null);
    try {
      const result = await saveAndRenderVersion({
        jobId,
        clipIndex,
        manifest: versionManifest,
        parentVersionId: version?.version_id,
        props: versionRenderProps,
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
      setVersion(nextVersion);
      setManifest(versionManifest);
      onVersionChange?.(nextVersion.version_id);
      onRendered?.(outputUrl);
      return outputUrl;
    } catch (exportError) {
      setError(exportError.message || "Render failed.");
      throw exportError;
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    clipIndex,
    jobId,
    onRendered,
    onVersionChange,
    version,
    versionManifest,
    versionRenderProps,
  ]);

  const downloadVersion = async () => {
    if (!version?.output_url || version.status !== "done") return;
    const downloadUrl = getApiUrl(
      `/api/clip/${encodeURIComponent(jobId)}/${encodeURIComponent(clipIndex)}/versions/${encodeURIComponent(version.version_id)}/download`,
    );
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `clip-${Number(clipIndex) + 1}-${version.version_id.slice(0, 8)}.mp4`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

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
  if (useLocalEditor) {
    return (
      <div
        className="fixed inset-0 z-[60] bg-background text-white"
        data-testid="full-screen-editor"
      >
        <LocalEditorTab
          initialVideoUrl={localEditorPreviewUrl}
          initialExportVideoUrl={
            masterVideoRefreshPending
              ? ""
              : proxyUrl(
                  resolveLocalEditorSourceUrl({
                    refreshedMasterVideoUrl,
                    clip,
                    projectManifest,
                  }) || projectInputProps.videoUrl,
                )
          }
          initialVideoName={`clip-${Number(clipIndex) + 1}.mp4`}
          initialProjectId={jobId}
          initialClipIndex={clipIndex}
          onExport={exportVersion}
          initialPlaybackStartMs={Math.max(
            0,
            resolvePreviewStartSeconds(clip) * 1000,
          )}
          initialPlaybackDurationMs={Math.max(
            1,
            Number(durationSeconds || 0) * 1000,
          )}
          remotionPreviewProps={{
            videoUrl: previewVideoUrl,
            videoStartSeconds: previewVideoStartSeconds,
            durationInSeconds: durationSeconds,
            fps,
            width: clip.output_width || 1080,
            height: clip.output_height || 1920,
            subtitles: projectInputProps.subtitles,
            subtitleTracks: projectInputProps.subtitleTracks,
            activeSubtitleTrackId: projectInputProps.activeSubtitleTrackId,
            layout: projectInputProps.layout,
            hook: projectInputProps.hook,
            effects: projectInputProps.effects,
          }}
          initialEditorState={localDraft}
          initialStateKey={`${version?.version_id || "draft"}:${projectInputProps.videoUrl || "pending"}:${localDraftRevision}`}
          clipMetadata={{ ...clip, hashtags: publishingMetadata.hashtags }}
          onHashtagsChange={(hashtags) =>
            setPublishingMetadata((current) => ({ ...current, hashtags }))
          }
          onStateChange={setLocalDraft}
          persistHistory={false}
          allowLocalUpload={false}
          onClose={onClose}
          headerActions={null}
          sidePanel={
            <>
              {editorActions && <EditorActionToolbar {...editorActions} />}
              <section
                className="rounded-xl border border-white/10 bg-white/[.02] p-4"
                aria-label="Version history"
              >
                <VersionHistory
                  versions={versions}
                  currentVersionId={version?.version_id}
                  selectedVersionId={version?.version_id}
                  onSelect={loadVersion}
                  onBranch={branchVersion}
                  onDelete={deleteVersion}
                  renderCompleteNotice={renderCompleteNotice}
                  onOpen={() => setRenderCompleteNotice(false)}
                />
              </section>
            </>
          }
          footer={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-red-300" role="alert">
                {error}
              </span>
              <button
                type="button"
                onClick={downloadVersion}
                disabled={
                  !version?.output_url || version.status !== "done" || busy
                }
                className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download version
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveVersion}
                disabled={busy}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save as new version"}
              </button>
            </div>
          }
        />
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background text-white"
      data-testid="full-screen-editor"
    >
      <header className="glass-panel flex h-16 shrink-0 items-center justify-between px-6 m-2 mb-0 z-10">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight text-white drop-shadow-sm">
            OpenShorts Editor
          </span>
          <span className="rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary drop-shadow-sm border border-primary/30">
            {version ? `Version ${version.version_id.slice(0, 8)}` : "Draft"}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close editor"
          className="rounded-full p-2.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={20} />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_320px] grid-rows-[minmax(320px,1fr)_minmax(220px,38vh)] gap-2 p-2">
        <section
          className="glass-panel row-span-2 flex flex-col overflow-auto p-5 shadow-lg"
          aria-label="Media Pool"
        >
          <h2 className="mb-5 text-xs font-bold uppercase tracking-widest text-primary drop-shadow-sm">
            Media Pool
          </h2>
          <MediaPool
            sourceUrl={inputProps.videoUrl}
            versions={versions}
            tracks={subtitleTracks}
            onSelectVersion={loadVersion}
            onSelectTrack={setActiveTrackId}
          />
        </section>
        <section
          className="glass-panel min-w-0 overflow-hidden relative shadow-inner border border-white/[0.05] bg-black"
          aria-label="Viewer"
        >
          <RemotionPreview
            videoUrl={inputProps.videoUrl}
            videoStartSeconds={inputProps.videoStartSeconds}
            durationInSeconds={durationSeconds}
            fps={fps}
            width={clip.output_width || 1080}
            height={clip.output_height || 1920}
            subtitles={inputProps.subtitles}
            subtitleTracks={inputProps.subtitleTracks}
            activeSubtitleTrackId={
              activeTrackId || inputProps.activeSubtitleTrackId
            }
            hook={inputProps.hook}
            effects={inputProps.effects}
            currentFrame={currentFrame}
            playing={playing}
            onFrameChange={setCurrentFrame}
            onPlayingChange={setPlaying}
          />
        </section>
        <aside
          className="glass-panel row-span-2 flex flex-col overflow-auto p-5 shadow-lg"
          aria-label="Inspector"
        >
          {editorActions && <EditorActionToolbar {...editorActions} />}
          <h2 className="mb-5 mt-5 text-xs font-bold uppercase tracking-widest text-primary drop-shadow-sm">
            Inspector
          </h2>
          <InspectorPanel
            selectedItem={selectedItem}
            editorState={editorState}
            activeTrackId={activeTrackId}
            onTrackChange={setActiveTrackId}
            onItemChange={updateSelectedItem}
            translationPanel={translationPanel}
          />
          <div className="mt-8 pt-6 border-t border-white/[0.08]">
            <h3 className="mb-4 text-xs font-bold tracking-widest text-zinc-500 uppercase">
              Version History
            </h3>
            <VersionHistory
              versions={versions}
              currentVersionId={version?.version_id}
              selectedVersionId={version?.version_id}
              onSelect={loadVersion}
              onBranch={branchVersion}
              onDelete={deleteVersion}
            />
          </div>
        </aside>
        <section
          className="glass-panel min-w-0 overflow-hidden flex flex-col shadow-inner"
          aria-label="Timeline"
        >
          <div className="border-b border-white/[0.08] bg-surfaceLight/40 px-3 py-2">
            <TransportControls
              currentFrame={currentFrame}
              durationFrames={editorState.durationFrames}
              fps={fps}
              playing={playing}
              onPlayingChange={setPlaying}
              onFrameChange={setCurrentFrame}
              zoom={zoom}
              onZoomChange={setZoom}
            />
          </div>
          <div className="flex-1 overflow-auto p-4 custom-scrollbar bg-black/20 inset-shadow-sm">
            <div className="mb-2 flex min-w-[760px] items-center justify-between text-xs text-primary/70 font-semibold tracking-wide">
              <span>{formatClock((currentFrame / fps) * 1000, fps)}</span>
              <span>{formatClock(durationSeconds * 1000, fps)}</span>
            </div>
            <DesignComboTimeline
              state={editorState}
              onStateChange={setEditorState}
              onSelectItem={(item, track) => {
                setActiveTrackId(
                  track.type === "subtitle"
                    ? track.id.replace(/^subtitles-/, "")
                    : activeTrackId,
                );
                setSelectedItem({ ...item, trackId: track.id });
              }}
              playheadFrame={currentFrame}
              onSeek={(seconds) => setCurrentFrame(Math.round(seconds * fps))}
              zoom={zoom}
            />
          </div>
        </section>
      </div>
      <footer className="glass-panel flex h-16 shrink-0 items-center justify-end gap-3 m-2 mt-0 z-10 px-6">
        <span
          className="mr-auto max-w-[48%] truncate text-sm font-medium text-red-400"
          role="alert"
        >
          {error}
        </span>
        <button
          type="button"
          onClick={downloadVersion}
          disabled={!version?.output_url || version.status !== "done" || busy}
          aria-label="Download saved version"
          className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={16} className="mr-2 inline" /> Download version
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:text-white hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={saveVersion}
          disabled={busy}
          className="btn-primary flex items-center gap-2 drop-shadow-md"
        >
          <Save size={16} /> {busy ? "Saving…" : "Save as new version"}
        </button>
      </footer>
    </div>
  );
}
